import { GoogleAuth, OAuth2Client } from "google-auth-library";
import {
  catalogV69Data,
  setCatalogV69Data,
  type CatalogV69,
} from "./data-v69.js";

export type RuntimeEnvironmentV69 = Readonly<Record<string, string | undefined>>;

type CommerceSyncV69 = {
  completedAt: string;
  status: "completed";
  sources: Array<{ id: string; status: "completed" }>;
  metrics: {
    coverage: number;
    priceCoverage: number;
    availabilityCoverage: number;
    unverified: number;
    [key: string]: unknown;
  };
};

export type SyncedCatalogV69 = CatalogV69 & {
  commerceSync: CommerceSyncV69;
};

export type SnapshotStoreV69 = {
  load(): Promise<unknown | null>;
  save(catalog: SyncedCatalogV69): Promise<void>;
};

export type RuntimeDependenciesV69 = {
  loadBaseCatalog: () => Promise<unknown>;
  activateCatalog: (catalog: unknown) => void | Promise<void>;
  runSync: (baseCatalog: unknown) => Promise<unknown>;
  snapshotStore: SnapshotStoreV69 | null;
  verifyOidcToken: (token: string, audience: string, expectedEmail: string) => Promise<void>;
  now?: () => Date;
  log?: (level: "info" | "warn" | "error", message: string) => void;
};

export type RuntimeHealthV69 = {
  status: "ready" | "degraded" | "refreshing";
  catalogVersion: 6.9;
  products: number;
  commerceSyncedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  syncConfigured: boolean;
};

export type RefreshResultV69 = {
  status: "updated" | "already_processed";
  products: number;
  commerceSyncedAt: string;
  reused: boolean;
};

const EXPECTED_SOURCE_COUNT = 11;
const DEFAULT_MIN_COVERAGE = 0.95;
const DEFAULT_MIN_PRICE_COVERAGE = 0.95;
const DEFAULT_MIN_AVAILABILITY_COVERAGE = 1;
const MAX_SNAPSHOT_BYTES = 20_000_000;
const GCS_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

export class CommerceRuntimeV69 {
  readonly #environment: RuntimeEnvironmentV69;
  readonly #dependencies: RuntimeDependenciesV69;
  readonly #minimumCoverage: number;
  readonly #minimumPriceCoverage: number;
  readonly #minimumAvailabilityCoverage: number;
  #initializePromise: Promise<void> | null = null;
  #refreshPromise: Promise<RefreshResultV69> | null = null;
  #activeCatalog: unknown = null;
  #state: "ready" | "degraded" = "degraded";
  #lastSuccessAt: string | null = null;
  #lastFailureAt: string | null = null;
  #lastIdempotencyKey: string | null = null;

  constructor(
    environment: RuntimeEnvironmentV69,
    dependencies: RuntimeDependenciesV69,
  ) {
    this.#environment = environment;
    this.#dependencies = dependencies;
    this.#minimumCoverage = positiveRatio(
      environment.V69_MIN_SYNC_COVERAGE,
      DEFAULT_MIN_COVERAGE,
    );
    this.#minimumPriceCoverage = positiveRatio(
      environment.V69_MIN_PRICE_COVERAGE,
      DEFAULT_MIN_PRICE_COVERAGE,
    );
    this.#minimumAvailabilityCoverage = positiveRatio(
      environment.V69_MIN_AVAILABILITY_COVERAGE,
      DEFAULT_MIN_AVAILABILITY_COVERAGE,
    );
  }

  get syncConfigured() {
    return (
      this.#environment.V69_SYNC_ENABLED === "1" &&
      Boolean(this.#dependencies.snapshotStore) &&
      Boolean(this.#environment.V69_SYNC_OIDC_AUDIENCE?.trim()) &&
      Boolean(this.#environment.V69_SYNC_OIDC_SERVICE_ACCOUNT_EMAIL?.trim())
    );
  }

  async initialize() {
    if (!this.#initializePromise) this.#initializePromise = this.#initializeOnce();
    await this.#initializePromise;
  }

  async authorizeSchedulerRequest(authorizationHeader: string | undefined) {
    const audience = this.#environment.V69_SYNC_OIDC_AUDIENCE?.trim();
    const expectedEmail =
      this.#environment.V69_SYNC_OIDC_SERVICE_ACCOUNT_EMAIL?.trim().toLowerCase();
    if (!this.syncConfigured || !audience || !expectedEmail) {
      throw new RuntimeHttpErrorV69(503, "Sincronización no configurada.");
    }
    const match = authorizationHeader?.match(/^Bearer ([A-Za-z0-9._~+/=-]+)$/);
    if (!match) throw new RuntimeHttpErrorV69(401, "Autenticación requerida.");
    try {
      await this.#dependencies.verifyOidcToken(match[1], audience, expectedEmail);
    } catch {
      throw new RuntimeHttpErrorV69(403, "Autenticación inválida.");
    }
  }

  async refresh(idempotencyKey = ""): Promise<RefreshResultV69> {
    await this.initialize();
    if (!this.syncConfigured || !this.#dependencies.snapshotStore) {
      throw new RuntimeHttpErrorV69(503, "Sincronización no configurada.");
    }
    const normalizedKey = idempotencyKey.trim().slice(0, 256);
    if (normalizedKey && normalizedKey === this.#lastIdempotencyKey) {
      const snapshot = this.#validate(this.#activeCatalog);
      return refreshSummary(snapshot, "already_processed", false);
    }
    if (this.#refreshPromise) {
      const result = await this.#refreshPromise;
      return { ...result, reused: true };
    }

    const operation = this.#performRefresh(normalizedKey);
    this.#refreshPromise = operation;
    try {
      return await operation;
    } finally {
      this.#refreshPromise = null;
    }
  }

  health(): RuntimeHealthV69 {
    const catalog = catalogSummary(this.#activeCatalog);
    return {
      status: this.#refreshPromise ? "refreshing" : this.#state,
      catalogVersion: 6.9,
      products: catalog.products,
      commerceSyncedAt: catalog.commerceSyncedAt,
      lastSuccessAt: this.#lastSuccessAt,
      lastFailureAt: this.#lastFailureAt,
      syncConfigured: this.syncConfigured,
    };
  }

  #validate(value: unknown) {
    return validateSyncedCatalogV69(
      value,
      this.#minimumCoverage,
      this.#minimumPriceCoverage,
      this.#minimumAvailabilityCoverage,
    );
  }

  async #initializeOnce() {
    const baseCatalog = await this.#dependencies.loadBaseCatalog();
    this.#activeCatalog = baseCatalog;
    await this.#dependencies.activateCatalog(baseCatalog);

    if (!this.#dependencies.snapshotStore) return;

    try {
      const stored = await this.#dependencies.snapshotStore.load();
      if (!stored) return;
      const snapshot = this.#validate(stored);
      await this.#dependencies.activateCatalog(snapshot);
      this.#activeCatalog = snapshot;
      this.#lastSuccessAt = snapshot.commerceSync.completedAt;
      this.#state = this.syncConfigured ? "ready" : "degraded";
      this.#dependencies.log?.("info", "V6.9 inicializada desde el último snapshot sano.");
    } catch {
      this.#lastFailureAt = (this.#dependencies.now?.() || new Date()).toISOString();
      this.#dependencies.log?.(
        "warn",
        "No se pudo activar el snapshot remoto; V6.9 conserva el catálogo base.",
      );
    }
  }

  async #performRefresh(idempotencyKey: string): Promise<RefreshResultV69> {
    const previousCatalog = this.#activeCatalog;
    try {
      const candidate = await this.#dependencies.runSync(previousCatalog);
      const snapshot = this.#validate(candidate);
      await this.#dependencies.snapshotStore!.save(snapshot);
      await this.#dependencies.activateCatalog(snapshot);
      this.#activeCatalog = snapshot;
      this.#lastSuccessAt = snapshot.commerceSync.completedAt;
      this.#lastFailureAt = null;
      this.#lastIdempotencyKey = idempotencyKey || null;
      this.#state = "ready";
      this.#dependencies.log?.("info", "Snapshot comercial V6.9 publicado y activado.");
      return refreshSummary(snapshot, "updated", false);
    } catch (error) {
      this.#activeCatalog = previousCatalog;
      this.#lastFailureAt = (this.#dependencies.now?.() || new Date()).toISOString();
      this.#state = "degraded";
      this.#dependencies.log?.(
        "error",
        `Falló la actualización V6.9; se conserva last-known-good: ${safeErrorName(error)}.`,
      );
      throw new RuntimeHttpErrorV69(502, "La actualización no superó la verificación.");
    }
  }
}

export class RuntimeHttpErrorV69 extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeHttpErrorV69";
  }
}

export function createCommerceRuntimeV69(
  environment: RuntimeEnvironmentV69 = process.env,
  overrides: Partial<RuntimeDependenciesV69> = {},
) {
  const snapshotStore =
    overrides.snapshotStore === undefined
      ? createGcsSnapshotStoreV69(environment)
      : overrides.snapshotStore;
  return new CommerceRuntimeV69(environment, {
    loadBaseCatalog: overrides.loadBaseCatalog || (() => catalogV69Data(environment as NodeJS.ProcessEnv)),
    activateCatalog:
      overrides.activateCatalog ||
      (async (catalog) => {
        await setCatalogV69Data(catalog, environment as NodeJS.ProcessEnv);
      }),
    runSync: overrides.runSync || defaultRunSyncV69,
    snapshotStore,
    verifyOidcToken: overrides.verifyOidcToken || verifyOidcTokenV69,
    now: overrides.now || (() => new Date()),
    log:
      overrides.log ||
      ((level, message) => {
        const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
        logger(`[v69-commerce] ${message}`);
      }),
  });
}

export function validateSyncedCatalogV69(
  value: unknown,
  minimumCoverage = DEFAULT_MIN_COVERAGE,
  minimumPriceCoverage = DEFAULT_MIN_PRICE_COVERAGE,
  minimumAvailabilityCoverage = DEFAULT_MIN_AVAILABILITY_COVERAGE,
): SyncedCatalogV69 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Snapshot V6.9 inválido.");
  }
  const candidate = value as Partial<SyncedCatalogV69>;
  const sync = candidate.commerceSync;
  if (
    Number(candidate.version) !== 6.9 ||
    !Array.isArray(candidate.products) ||
    !candidate.products.length ||
    Number(candidate.totalProducts) !== candidate.products.length ||
    !sync ||
    sync.status !== "completed" ||
    !validTimestamp(sync.completedAt) ||
    !Array.isArray(sync.sources) ||
    sync.sources.length !== EXPECTED_SOURCE_COUNT ||
    new Set(sync.sources.map((source) => String(source.id))).size !== EXPECTED_SOURCE_COUNT ||
    sync.sources.some((source) => source.status !== "completed")
  ) {
    throw new Error("Snapshot V6.9 incompleto.");
  }
  const coverage = Number(sync.metrics?.coverage);
  const priceCoverage = Number(sync.metrics?.priceCoverage);
  const availabilityCoverage = Number(sync.metrics?.availabilityCoverage);
  if (
    !Number.isFinite(coverage) ||
    coverage < minimumCoverage ||
    !Number.isFinite(priceCoverage) ||
    priceCoverage < minimumPriceCoverage ||
    !Number.isFinite(availabilityCoverage) ||
    availabilityCoverage < minimumAvailabilityCoverage ||
    Number(sync.metrics?.unverified) !== 0 ||
    candidate.products.some(
      (product) =>
        !["limited", "out_of_stock"].includes(String(product.availability)) ||
        !validTimestamp(product.availabilityCheckedAt),
    )
  ) {
    throw new Error("Snapshot V6.9 por debajo de los umbrales.");
  }
  return candidate as SyncedCatalogV69;
}

export function createGcsSnapshotStoreV69(
  environment: RuntimeEnvironmentV69,
): SnapshotStoreV69 | null {
  const bucketName = environment.V69_SYNC_GCS_BUCKET?.trim();
  const objectName = environment.V69_SYNC_GCS_OBJECT?.trim();
  if (!bucketName && !objectName) return null;
  if (
    !bucketName ||
    !objectName ||
    !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/i.test(bucketName) ||
    objectName.startsWith("/") ||
    objectName.includes("..") ||
    /[\u0000-\u001f\u007f]/.test(objectName)
  ) {
    throw new Error("Configuración GCS V6.9 inválida.");
  }
  const auth = new GoogleAuth({ scopes: [GCS_SCOPE] });
  const objectKey = encodeURIComponent(objectName);
  const bucketKey = encodeURIComponent(bucketName);
  const mediaUrl = `https://storage.googleapis.com/storage/v1/b/${bucketKey}/o/${objectKey}?alt=media`;
  const uploadUrl =
    `https://storage.googleapis.com/upload/storage/v1/b/${bucketKey}/o` +
    `?uploadType=media&name=${objectKey}`;

  async function authorizationHeader() {
    const token = await auth.getAccessToken();
    if (!token) throw new Error("GCS no entregó credenciales de aplicación.");
    return `Bearer ${token}`;
  }

  return {
    async load() {
      const response = await fetch(mediaUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { authorization: await authorizationHeader() },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`GCS snapshot HTTP ${response.status}.`);
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_SNAPSHOT_BYTES) throw new Error("Snapshot GCS demasiado grande.");
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_SNAPSHOT_BYTES) throw new Error("Snapshot GCS demasiado grande.");
      return JSON.parse(body.toString("utf8"));
    },
    async save(catalog) {
      const body = `${JSON.stringify(catalog)}\n`;
      if (Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES) {
        throw new Error("Snapshot V6.9 demasiado grande.");
      }
      const response = await fetch(uploadUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: await authorizationHeader(),
          "content-type": "application/json; charset=utf-8",
        },
        body,
      });
      if (!response.ok) throw new Error(`GCS upload HTTP ${response.status}.`);
    },
  };
}

async function defaultRunSyncV69(baseCatalog: unknown) {
  // @ts-expect-error El módulo MJS se copia junto al runtime y tiene tests propios.
  const module = await import("../scripts/sync-catalog-commerce-v69.mjs");
  const result = await module.runCommercialSync({
    apply: false,
    providedBaseCatalog: baseCatalog,
  });
  return result.catalog;
}

async function verifyOidcTokenV69(
  token: string,
  audience: string,
  expectedEmail: string,
) {
  const ticket = await new OAuth2Client().verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload();
  if (
    !payload ||
    payload.email_verified !== true ||
    payload.email?.trim().toLowerCase() !== expectedEmail
  ) {
    throw new Error("Identidad OIDC no autorizada.");
  }
}

function catalogSummary(value: unknown) {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<SyncedCatalogV69>)
      : {};
  return {
    products: Array.isArray(candidate.products) ? candidate.products.length : 0,
    commerceSyncedAt: validTimestamp(candidate.commerceSync?.completedAt)
      ? new Date(candidate.commerceSync.completedAt).toISOString()
      : validTimestamp(candidate.commerceSyncedAt)
        ? new Date(candidate.commerceSyncedAt).toISOString()
        : null,
  };
}

function refreshSummary(
  catalog: SyncedCatalogV69,
  status: RefreshResultV69["status"],
  reused: boolean,
): RefreshResultV69 {
  return {
    status,
    products: catalog.products.length,
    commerceSyncedAt: new Date(catalog.commerceSync.completedAt).toISOString(),
    reused,
  };
}

function positiveRatio(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function safeErrorName(error: unknown) {
  return error instanceof Error && error.name ? error.name : "Error";
}
