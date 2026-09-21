import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import {
  loadBaseCatalogV69,
  prepareCatalogV69Data,
  activatePreparedCatalogV69,
  type CatalogV69,
} from "./data-v69.js";
import { gcsSnapshotStoreV69, SnapshotConflictV69, SnapshotWriteUncertainV69 } from "./catalog-snapshot-store-v69.js";
import { preparePublicationV69, assertCatalogTransitionV69 } from "./catalog-validation-v69.js";

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

type DiscoverySyncV69 = {
  completedAt: string;
  status: "completed";
  activationReady: true;
  searchIndexedAt: string;
  needsIndexedAt: string;
  taxonomyIndexedAt: string;
  imagesPreparedAt: string;
};

export type SyncedCatalogV69 = CatalogV69 & {
  commerceSync: CommerceSyncV69;
  discoverySync?: DiscoverySyncV69;
};

export type SnapshotStoreV69 = {
  load(): Promise<unknown | null>;
  save(catalog: SyncedCatalogV69, expectedGeneration?: string, idempotencyKey?: string): Promise<string | void>;
  loadVersioned?(): Promise<{ catalog: unknown | null; generation: string }>;
  generation?(): Promise<string>;
  loadPrevious?(catalog: unknown): Promise<unknown | null>;
  wasRejected?(key: string): Promise<boolean>;
  recordRejection?(key: string, failure: unknown, candidate?: unknown): Promise<void>;
};

export type RuntimeDependenciesV69 = {
  loadBaseCatalog: () => Promise<unknown>;
  prepareCatalog: (catalog: unknown) => Promise<() => void>;
  runSync: (baseCatalog: unknown) => Promise<unknown>;
  runDiscovery?: (baseCatalog: unknown) => Promise<unknown>;
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
  discoveryConfigured: boolean;
  lastDiscoveryAt: string | null;
  snapshotGeneration: string | null;
  codeRevision: string;
  lastFailure: Omit<ReturnType<typeof syncFailureV69>, "causes"> | null;
};

export type RefreshResultV69 = {
  status: "updated" | "already_processed";
  products: number;
  commerceSyncedAt: string;
  reused: boolean;
  mode: "commerce" | "discovery";
};

const EXPECTED_SOURCE_COUNT = 16;
const DEFAULT_MIN_COVERAGE = 0.95;
const DEFAULT_MIN_PRICE_COVERAGE = 0.95;
const DEFAULT_MIN_AVAILABILITY_COVERAGE = 1;

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
  #lastDiscoveryAt: string | null = null;
  #lastIdempotencyKey: string | null = null;
  #generation: string | undefined;
  #checkedAt = 0;
  #checkPromise: Promise<void> | null = null;
  #retryInitializeAt = 0;
  #lastRejectedKey: string | null = null;
  #lastFailure: ReturnType<typeof syncFailureV69> | null = null;

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

  get discoveryConfigured() {
    return (
      this.syncConfigured &&
      Boolean(this.#environment.V69_DISCOVERY_SCHEDULER_JOB?.trim()) &&
      Boolean(this.#environment.V69_IMAGE_GCS_BUCKET?.trim()) &&
      typeof this.#dependencies.runDiscovery === "function"
    );
  }

  async initialize() {
    if (!this.#initializePromise) {
      if (this.#nowMs() < this.#retryInitializeAt) throw new RuntimeHttpErrorV69(503, "Reintentando inicialización.");
      this.#initializePromise = this.#initializeOnce().catch((error) => {
        this.#initializePromise = null;
        this.#retryInitializeAt = this.#nowMs() + 5_000;
        this.#logFailure(error, "initialize", crypto.randomUUID());
        throw error;
      });
    }
    await this.#initializePromise;
  }

  #nowMs() { return (this.#dependencies.now?.() || new Date()).getTime(); }

  async ensureCurrent() {
    await this.initialize();
    if (!this.#dependencies.snapshotStore || this.#refreshPromise || this.#nowMs() - this.#checkedAt < 30_000) return;
    if (!this.#checkPromise) {
      this.#checkedAt = this.#nowMs();
      this.#checkPromise = this.#adoptStoredSnapshotIfNewer().catch((error) => {
        this.#logFailure(error, "reload", crypto.randomUUID());
      }).finally(() => { this.#checkPromise = null; });
    }
    await this.#checkPromise;
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
    const mode = this.#refreshMode(normalizedKey);
    if (mode === "discovery" && !this.discoveryConfigured) {
      throw new RuntimeHttpErrorV69(503, "Scan semanal no configurado.");
    }
    if (normalizedKey && normalizedKey === this.#lastIdempotencyKey) {
      const snapshot = this.#validate(this.#activeCatalog);
      return refreshSummary(snapshot, "already_processed", false, mode);
    }
    if (this.#refreshPromise) {
      const result = await this.#refreshPromise;
      return { ...result, reused: true };
    }

    if (normalizedKey && this.#lastRejectedKey === normalizedKey) {
      throw new RuntimeHttpErrorV69(422, "Ejecución ya rechazada; requiere revisión de datos.");
    }

    const operation = this.#performRefresh(normalizedKey, mode);
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
      discoveryConfigured: this.discoveryConfigured,
      lastDiscoveryAt: this.#lastDiscoveryAt,
      snapshotGeneration: this.#generation || null,
      codeRevision: this.#environment.V69_CODE_REVISION || "unknown",
      lastFailure: this.#lastFailure ? {
        event: this.#lastFailure.event, severity: this.#lastFailure.severity,
        phase: this.#lastFailure.phase, runId: this.#lastFailure.runId,
        codeRevision: this.#lastFailure.codeRevision, retryable: this.#lastFailure.retryable,
      } : null,
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
    if (this.#dependencies.snapshotStore) {
      let stored: unknown;
      try {
        stored = await this.#loadStored();
        if (stored) {
          const snapshot = this.#validate(stored);
          (await this.#dependencies.prepareCatalog(snapshot))();
          this.#activeCatalog = snapshot;
          this.#lastSuccessAt = snapshot.commerceSync.completedAt;
          this.#lastDiscoveryAt = validTimestamp(snapshot.discoverySync?.completedAt)
            ? new Date(snapshot.discoverySync.completedAt).toISOString()
            : null;
          this.#state = this.syncConfigured ? "ready" : "degraded";
          this.#checkedAt = this.#nowMs();
          this.#dependencies.log?.("info", "V6.9 inicializada desde el último snapshot sano.");
          return;
        }
      } catch (error) {
        this.#generation = undefined;
        this.#logFailure(error, "load_snapshot", crypto.randomUUID());
        this.#lastFailureAt = (this.#dependencies.now?.() || new Date()).toISOString();
        this.#dependencies.log?.(
          "warn",
          "No se pudo activar el snapshot remoto; V6.9 usa el catálogo base.",
        );
        try {
          const previous = await this.#dependencies.snapshotStore.loadPrevious?.(stored);
          if (previous) {
            const snapshot = this.#validate(previous);
            (await this.#dependencies.prepareCatalog(snapshot))();
            this.#activeCatalog = snapshot;
            this.#lastSuccessAt = snapshot.commerceSync.completedAt;
            this.#checkedAt = this.#nowMs();
            return;
          }
        } catch (previousError) { this.#logFailure(previousError, "load_previous", crypto.randomUUID()); }
      }
    }

    const baseCatalog = await this.#dependencies.loadBaseCatalog();
    (await this.#dependencies.prepareCatalog(baseCatalog))();
    this.#activeCatalog = baseCatalog;
    this.#checkedAt = this.#nowMs();
  }

  async #loadStored() {
    const store = this.#dependencies.snapshotStore!;
    if (!store.loadVersioned) return store.load();
    const loaded = await store.loadVersioned();
    this.#generation = loaded.generation;
    return loaded.catalog;
  }

  #logFailure(error: unknown, phase: string, runId: string) {
    this.#lastFailureAt = new Date(this.#nowMs()).toISOString();
    this.#state = "degraded";
    this.#lastFailure = syncFailureV69(error, phase, runId, this.#environment.V69_CODE_REVISION);
    this.#dependencies.log?.("error", JSON.stringify(this.#lastFailure));
    return this.#lastFailure;
  }

  async #performRefresh(
    idempotencyKey: string,
    mode: "commerce" | "discovery",
  ): Promise<RefreshResultV69> {
    let previousCatalog = this.#activeCatalog;
    const runId = crypto.randomUUID();
    let phase = "adopt";
    let candidate: unknown;
    try {
      if (this.#checkPromise) await this.#checkPromise;
      await this.#adoptStoredSnapshotIfNewer();
      previousCatalog = this.#activeCatalog;
      if (alreadyPublishedV69(previousCatalog, idempotencyKey)) {
        return refreshSummary(this.#validate(previousCatalog), "already_processed", false, mode);
      }
      phase = "receipt";
      if (idempotencyKey && await this.#dependencies.snapshotStore!.wasRejected?.(idempotencyKey)) {
        throw new Error("Ejecución ya rechazada; requiere revisión de datos.");
      }
      const expectedGeneration = this.#generation;
      phase = "crawl";
      candidate =
        mode === "discovery"
          ? await this.#dependencies.runDiscovery!(previousCatalog)
          : await this.#dependencies.runSync(previousCatalog);
      phase = "validate";
      const snapshot = this.#validate(candidate);
      assertCatalogTransitionV69(previousCatalog, snapshot);
      const activate = await this.#dependencies.prepareCatalog(snapshot);
      phase = "publish";
      const generation = await this.#dependencies.snapshotStore!.save(snapshot, expectedGeneration, idempotencyKey);
      // The prepared commit is a synchronous assignment; no I/O or validation
      // remains after the durable conditional publication succeeds.
      activate();
      if (generation) this.#generation = generation;
      this.#activeCatalog = snapshot;
      this.#lastSuccessAt = snapshot.commerceSync.completedAt;
      this.#lastFailureAt = null;
      this.#lastFailure = null;
      this.#checkedAt = this.#nowMs();
      if (mode === "discovery") this.#lastDiscoveryAt = snapshot.discoverySync!.completedAt;
      this.#lastIdempotencyKey = idempotencyKey || null;
      this.#state = "ready";
      this.#dependencies.log?.("info", JSON.stringify({ event: "catalog_sync_completed", severity: "INFO",
        phase: "activate", runId, mode, codeRevision: this.#environment.V69_CODE_REVISION || "unknown",
        generation: this.#generation || null, products: snapshot.products.length,
        commerceSyncedAt: snapshot.commerceSync.completedAt }));
      return refreshSummary(snapshot, "updated", false, mode);
    } catch (error) {
      this.#activeCatalog = previousCatalog;
      const failure = this.#logFailure(error, phase, runId);
      if (idempotencyKey && !failure.retryable) {
        this.#lastRejectedKey = idempotencyKey;
        await this.#dependencies.snapshotStore?.recordRejection?.(idempotencyKey, failure, candidate).catch((recordError) => {
          this.#dependencies.log?.("error", JSON.stringify(syncFailureV69(recordError, "record_failure", runId)));
        });
      }
      const detail = phase === "receipt" && !failure.retryable ? "Ejecución ya rechazada; " : "";
      throw new RuntimeHttpErrorV69(failure.retryable ? 503 : 422, `${detail}actualización rechazada (${runId}); se conserva el catálogo anterior.`);
    }
  }

  async #adoptStoredSnapshotIfNewer() {
    if (!this.#dependencies.snapshotStore) return;
    if (this.#dependencies.snapshotStore.generation && this.#generation &&
        await this.#dependencies.snapshotStore.generation() === this.#generation) {
      if (this.#lastFailure?.phase === "reload") {
        this.#state = this.syncConfigured ? "ready" : "degraded";
        this.#lastFailureAt = null;
        this.#lastFailure = null;
      }
      return;
    }
    const previousGeneration = this.#generation;
    const stored = await this.#loadStored();
    if (!stored) return;
    let snapshot: SyncedCatalogV69;
    let activate: () => void;
    try {
      snapshot = this.#validate(stored);
      activate = await this.#dependencies.prepareCatalog(snapshot);
    } catch (error) {
      this.#generation = previousGeneration;
      throw error;
    }
    const activeTimestamp = catalogSummary(this.#activeCatalog).commerceSyncedAt;
    if (
      previousGeneration === this.#generation && activeTimestamp &&
      new Date(snapshot.commerceSync.completedAt).getTime() <= new Date(activeTimestamp).getTime()
    ) {
      return;
    }
    activate();
    this.#activeCatalog = snapshot;
    this.#lastSuccessAt = snapshot.commerceSync.completedAt;
    this.#state = this.syncConfigured ? "ready" : "degraded";
    this.#lastFailureAt = null;
    this.#lastFailure = null;
    if (snapshot.discoverySync) this.#lastDiscoveryAt = snapshot.discoverySync.completedAt;
    this.#dependencies.log?.("info", "V6.9 adoptó un snapshot GCS más reciente antes del refresh.");
  }

  #refreshMode(idempotencyKey: string): "commerce" | "discovery" {
    const discoveryJob = this.#environment.V69_DISCOVERY_SCHEDULER_JOB?.trim();
    const schedulerJob = idempotencyKey.split("|", 1)[0];
    return discoveryJob && schedulerJob === discoveryJob ? "discovery" : "commerce";
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
    loadBaseCatalog: overrides.loadBaseCatalog || (() => loadBaseCatalogV69(environment as NodeJS.ProcessEnv)),
    prepareCatalog: overrides.prepareCatalog || (async (catalog) => {
      const prepared = environment.NODE_ENV === "production"
        ? await preparePublicationV69(catalog, environment)
        : await prepareCatalogV69Data(catalog, environment as NodeJS.ProcessEnv);
      return () => { activatePreparedCatalogV69(prepared); };
    }),
    runSync: overrides.runSync || defaultRunSyncV69,
    runDiscovery:
      overrides.runDiscovery ||
      ((baseCatalog) => defaultRunDiscoveryV69(baseCatalog, environment)),
    snapshotStore,
    verifyOidcToken: overrides.verifyOidcToken || verifyOidcTokenV69,
    now: overrides.now || (() => new Date()),
    log:
      overrides.log ||
      ((level, message) => {
        const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
        logger(message.startsWith("{") ? message : `[v69-commerce] ${message}`);
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
  const discovery = candidate.discoverySync;
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
  if (
    discovery &&
    (discovery.status !== "completed" ||
      discovery.activationReady !== true ||
      !validTimestamp(discovery.completedAt) ||
      !validTimestamp(discovery.searchIndexedAt) ||
      !validTimestamp(discovery.needsIndexedAt) ||
      !validTimestamp(discovery.taxonomyIndexedAt) ||
      !validTimestamp(discovery.imagesPreparedAt))
  ) {
    throw new Error("Snapshot semanal V6.9 incompleto.");
  }
  return candidate as SyncedCatalogV69;
}

export const createGcsSnapshotStoreV69 = gcsSnapshotStoreV69;

export function alreadyPublishedV69(catalog: unknown, key: string) {
  const hash = (catalog as { publicationV69?: { idempotencyKeyHash?: string } })?.publicationV69?.idempotencyKeyHash;
  return Boolean(key && hash && hash === crypto.createHash("sha256").update(key).digest("hex"));
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

async function defaultRunDiscoveryV69(
  baseCatalog: unknown,
  environment: RuntimeEnvironmentV69,
) {
  // @ts-expect-error El módulo MJS se copia junto al runtime y tiene tests propios.
  const module = await import("../scripts/scan-catalog-v69.mjs");
  const scanned = await module.runCatalogDiscoveryV69({
    providedBaseCatalog: baseCatalog,
  });
  const finalized = await module.finalizeCatalogDiscoveryV69({
    catalog: scanned.catalog,
    environment,
  });
  return finalized.catalog;
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
  mode: RefreshResultV69["mode"],
): RefreshResultV69 {
  return {
    status,
    products: catalog.products.length,
    commerceSyncedAt: new Date(catalog.commerceSync.completedAt).toISOString(),
    reused,
    mode,
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

export function syncFailureV69(error: unknown, phase: string, runId: string, codeRevision = "unknown") {
  const causes: Array<{ name: string; message: string }> = [];
  let current = error;
  let retryable = error instanceof SnapshotConflictV69 || error instanceof SnapshotWriteUncertainV69;
  for (let depth = 0; current && depth < 4; depth++) {
    const name = current instanceof Error ? current.name : "Error";
    const raw = current instanceof Error ? current.message : String(current);
    if (/TimeoutError|AbortError/.test(name) || /(?:HTTP\s*|^)(?:408|429|500|502|503|504)\b|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(raw)) retryable = true;
    const message = raw.replace(/https?:\/\/\S+/gi, "[url]")
      .replace(/Bearer\s+\S+|(?:token|secret|password|cookie|authorization)\s*[:=]\s*\S+/gi, "[redacted]")
      .replace(/\b\d{8,}\b/g, "[id]").replace(/\bSKU\s+[^\s.,]+/gi, "SKU [id]").slice(0, 500);
    causes.push({ name, message });
    current = current instanceof Error ? current.cause : null;
  }
  return { event: "catalog_sync_failed", severity: "ERROR", phase, runId, codeRevision, retryable, causes };
}
