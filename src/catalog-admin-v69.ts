import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import {
  defaultCatalogPolicyV69,
  validEanV69,
  validateCatalogPolicyV69,
  type CatalogPolicyV69,
} from "./catalog-policy-v69.js";
import { loadExclusionsV69 } from "./data-v69.js";

export type CatalogAdminMemoryTypeV69 =
  | "navigation"
  | "ean"
  | "operation"
  | "deploy"
  | "rollback";

export type CatalogAdminMemoryEntryV69 = {
  id: string;
  at: string;
  actor: string;
  type: CatalogAdminMemoryTypeV69;
  summary: string;
  revision: number;
  details: Record<string, string | number | boolean | null>;
};

export type CatalogAdminSnapshotV69 = {
  revision: number;
  at: string;
  actor: string;
  policy: CatalogPolicyV69;
};

export type CatalogAdminDocumentV69 = {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  policy: CatalogPolicyV69;
  memory: CatalogAdminMemoryEntryV69[];
  snapshots: CatalogAdminSnapshotV69[];
};

export type CatalogAdminStoreValueV69 = {
  document: CatalogAdminDocumentV69;
  generation: string;
};

export type CatalogAdminStoreV69 = {
  load(): Promise<CatalogAdminStoreValueV69 | null>;
  save(document: CatalogAdminDocumentV69, expectedGeneration: string): Promise<CatalogAdminStoreValueV69>;
};

export type CatalogAdminActorV69 = {
  subject: string;
  email: string;
};

export type CatalogAdminEnvironmentV69 = Readonly<Record<string, string | undefined>>;

type CatalogAdminRuntimeDependenciesV69 = {
  store?: CatalogAdminStoreV69 | null;
  now?: () => Date;
  verifyAdminToken?: (token: string) => Promise<CatalogAdminActorV69>;
};

const GCS_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EXCLUSIONS = path.join(ROOT, "data", "catalog-exclusions-v69.local.json");
const CACHE_MS = 30_000;
const MAX_MEMORY = 100;
const MAX_SNAPSHOTS = 20;
const MAX_ADMIN_BYTES = 2_000_000;

export class CatalogAdminConflictV69 extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogAdminConflictV69";
  }
}

export class CatalogAdminRuntimeV69 {
  readonly #environment: CatalogAdminEnvironmentV69;
  readonly #store: CatalogAdminStoreV69 | null;
  readonly #now: () => Date;
  readonly #verifyAdminToken: (token: string) => Promise<CatalogAdminActorV69>;
  #cache: CatalogAdminStoreValueV69 | null = null;
  #cacheAt = 0;

  constructor(
    environment: CatalogAdminEnvironmentV69 = process.env,
    dependencies: CatalogAdminRuntimeDependenciesV69 = {},
  ) {
    this.#environment = environment;
    this.#store = dependencies.store === undefined ? createCatalogAdminStoreV69(environment) : dependencies.store;
    this.#now = dependencies.now || (() => new Date());
    this.#verifyAdminToken = dependencies.verifyAdminToken || ((token) => verifyCatalogAdminTokenV69(token, environment));
  }

  get configured() {
    return Boolean(this.#store);
  }

  get authenticationConfigured() {
    if (this.#environment.NODE_ENV !== "production" && this.#environment.V69_ADMIN_LOCAL_TOKEN?.trim()) return true;
    return Boolean(
      this.#environment.V69_ADMIN_GOOGLE_CLIENT_ID?.trim() &&
      parseAllowedEmails(this.#environment.V69_ADMIN_ALLOWED_EMAILS).length,
    );
  }

  googleClientId() {
    return this.#environment.V69_ADMIN_GOOGLE_CLIENT_ID?.trim() || "";
  }

  async policy() {
    return (await this.current()).document.policy;
  }

  async current(force = false): Promise<CatalogAdminStoreValueV69> {
    const nowMs = this.#now().getTime();
    if (!force && this.#cache && nowMs - this.#cacheAt < CACHE_MS) return this.#cache;
    const loaded = this.#store ? await this.#store.load() : null;
    this.#cache = loaded
      ? {
          document: validateCatalogAdminDocumentV69(loaded.document),
          generation: loaded.generation,
        }
      : { document: await defaultCatalogAdminDocumentFromEnvironmentV69(this.#environment, this.#now()), generation: "0" };
    this.#cacheAt = nowMs;
    return this.#cache;
  }

  async authorize(header: string | undefined) {
    const match = String(header || "").match(/^Bearer ([A-Za-z0-9._~+/=-]+)$/);
    if (!match) throw new Error("Autenticación administrativa requerida.");
    return this.#verifyAdminToken(match[1]);
  }

  async publishPolicy({
    policy,
    expectedRevision,
    actor,
    summary,
    type = "navigation",
  }: {
    policy: unknown;
    expectedRevision: number;
    actor: CatalogAdminActorV69;
    summary: string;
    type?: CatalogAdminMemoryTypeV69;
  }) {
    if (!this.#store) throw new Error("El almacenamiento administrativo no está configurado.");
    const current = await this.current(true);
    if (current.document.revision !== expectedRevision) {
      throw new CatalogAdminConflictV69("La configuración cambió en otra sesión; recargá antes de publicar.");
    }
    const validatedPolicy = validateCatalogPolicyV69(policy);
    const nextRevision = current.document.revision + 1;
    const at = this.#now().toISOString();
    const previousSnapshot: CatalogAdminSnapshotV69 = {
      revision: current.document.revision,
      at: current.document.updatedAt,
      actor: current.document.updatedBy,
      policy: current.document.policy,
    };
    const next = validateCatalogAdminDocumentV69({
      ...current.document,
      revision: nextRevision,
      updatedAt: at,
      updatedBy: actor.email,
      policy: validatedPolicy,
      snapshots: [...current.document.snapshots, previousSnapshot].slice(-MAX_SNAPSHOTS),
      memory: [
        ...current.document.memory,
        memoryEntry({ at, actor: actor.email, type, summary, revision: nextRevision }),
      ].slice(-MAX_MEMORY),
    });
    const saved = await this.#store.save(next, current.generation);
    this.#cache = saved;
    this.#cacheAt = this.#now().getTime();
    return saved;
  }

  async rollback({
    targetRevision,
    expectedRevision,
    actor,
  }: {
    targetRevision: number;
    expectedRevision: number;
    actor: CatalogAdminActorV69;
  }) {
    const current = await this.current(true);
    if (current.document.revision !== expectedRevision) {
      throw new CatalogAdminConflictV69("La configuración cambió; recargá antes de deshacer.");
    }
    const target = current.document.snapshots.find((entry) => entry.revision === targetRevision);
    if (!target) throw new Error("La revisión solicitada ya no está disponible en la memoria operativa.");
    return this.publishPolicy({
      policy: target.policy,
      expectedRevision,
      actor,
      summary: `Rollback administrativo a revisión ${targetRevision}.`,
      type: "rollback",
    });
  }

  async recordMemory({
    actor,
    type,
    summary,
    details = {},
  }: {
    actor: CatalogAdminActorV69;
    type: CatalogAdminMemoryTypeV69;
    summary: string;
    details?: Record<string, string | number | boolean | null>;
  }) {
    if (!this.#store) throw new Error("El almacenamiento administrativo no está configurado.");
    const current = await this.current(true);
    const at = this.#now().toISOString();
    const next = validateCatalogAdminDocumentV69({
      ...current.document,
      updatedAt: at,
      updatedBy: actor.email,
      memory: [
        ...current.document.memory,
        memoryEntry({
          at,
          actor: actor.email,
          type,
          summary,
          revision: current.document.revision,
          details,
        }),
      ].slice(-MAX_MEMORY),
    });
    const saved = await this.#store.save(next, current.generation);
    this.#cache = saved;
    this.#cacheAt = this.#now().getTime();
    return saved;
  }
}

export function createCatalogAdminRuntimeV69(
  environment: CatalogAdminEnvironmentV69 = process.env,
  dependencies: CatalogAdminRuntimeDependenciesV69 = {},
) {
  return new CatalogAdminRuntimeV69(environment, dependencies);
}

export function defaultCatalogAdminDocumentV69(
  now = new Date(),
  policy: CatalogPolicyV69 = defaultCatalogPolicyV69(),
): CatalogAdminDocumentV69 {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: now.toISOString(),
    updatedBy: "system",
    policy,
    memory: [],
    snapshots: [],
  };
}

export async function defaultCatalogAdminDocumentFromEnvironmentV69(
  environment: CatalogAdminEnvironmentV69,
  now = new Date(),
) {
  const policy = defaultCatalogPolicyV69();
  const exclusionsPath = environment.V69_EXCLUSIONS_FILE?.trim() || DEFAULT_EXCLUSIONS;
  const exclusions = await loadExclusionsV69(exclusionsPath, false).catch(() => null);
  if (!exclusions) return defaultCatalogAdminDocumentV69(now, policy);
  const createdAt = now.toISOString();
  policy.eanRules.exclude = [...new Set(exclusions.barcodes)]
    .filter(validEanV69)
    .map((ean) => ({
      ean,
      note: "Migrado de exclusiones legacy.",
      createdAt,
    }));
  return defaultCatalogAdminDocumentV69(now, validateCatalogPolicyV69(policy));
}

export function validateCatalogAdminDocumentV69(value: unknown): CatalogAdminDocumentV69 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("El documento administrativo V6.9 es inválido.");
  }
  const raw = value as Record<string, unknown>;
  const revision = integer(raw.revision, "revision", 0, Number.MAX_SAFE_INTEGER);
  const updatedAt = timestamp(raw.updatedAt, "updatedAt");
  const updatedBy = text(raw.updatedBy, "updatedBy", 160);
  const memory = list(raw.memory, "memory").slice(-MAX_MEMORY).map((entry, index) => {
    const item = object(entry, `memory[${index}]`);
    const type = text(item.type, `memory[${index}].type`, 32) as CatalogAdminMemoryTypeV69;
    if (!["navigation", "ean", "operation", "deploy", "rollback"].includes(type)) {
      throw new Error("La memoria administrativa contiene otro tipo de evento.");
    }
    return {
      id: text(item.id, `memory[${index}].id`, 80),
      at: timestamp(item.at, `memory[${index}].at`),
      actor: text(item.actor, `memory[${index}].actor`, 160),
      type,
      summary: text(item.summary, `memory[${index}].summary`, 300),
      revision: integer(item.revision, `memory[${index}].revision`, 0, Number.MAX_SAFE_INTEGER),
      details: validateDetails(item.details, `memory[${index}].details`),
    };
  });
  const snapshots = list(raw.snapshots, "snapshots").slice(-MAX_SNAPSHOTS).map((entry, index) => {
    const item = object(entry, `snapshots[${index}]`);
    return {
      revision: integer(item.revision, `snapshots[${index}].revision`, 0, Number.MAX_SAFE_INTEGER),
      at: timestamp(item.at, `snapshots[${index}].at`),
      actor: text(item.actor, `snapshots[${index}].actor`, 160),
      policy: validateCatalogPolicyV69(item.policy),
    };
  });
  return {
    schemaVersion: 1,
    revision,
    updatedAt,
    updatedBy,
    policy: validateCatalogPolicyV69(raw.policy),
    memory,
    snapshots,
  };
}

export function createCatalogAdminStoreV69(environment: CatalogAdminEnvironmentV69): CatalogAdminStoreV69 | null {
  const filePath = environment.V69_ADMIN_CONFIG_FILE?.trim();
  if (filePath) return createFileCatalogAdminStoreV69(filePath);
  const bucket = environment.V69_ADMIN_GCS_BUCKET?.trim() || environment.V69_SYNC_GCS_BUCKET?.trim();
  const objectName =
    environment.V69_ADMIN_GCS_OBJECT?.trim() ||
    defaultAdminObjectName(environment.V69_SYNC_GCS_OBJECT?.trim());
  if (bucket && objectName) return createGcsCatalogAdminStoreV69(bucket, objectName);
  if (environment.NODE_ENV !== "production") return createMemoryCatalogAdminStoreV69();
  return null;
}

export function createMemoryCatalogAdminStoreV69(
  initial: CatalogAdminDocumentV69 | null = null,
): CatalogAdminStoreV69 {
  let current = initial ? validateCatalogAdminDocumentV69(initial) : null;
  let generation = current ? "1" : "0";
  return {
    async load() {
      return current ? { document: structuredClone(current), generation } : null;
    },
    async save(document, expectedGeneration) {
      if (generation !== expectedGeneration) throw new CatalogAdminConflictV69("La generación administrativa cambió.");
      current = validateCatalogAdminDocumentV69(document);
      generation = String(Number(generation) + 1);
      return { document: structuredClone(current), generation };
    },
  };
}

export function createFileCatalogAdminStoreV69(filePath: string): CatalogAdminStoreV69 {
  const resolved = path.resolve(filePath);
  return {
    async load() {
      try {
        const [raw, stats] = await Promise.all([fs.readFile(resolved, "utf8"), fs.stat(resolved)]);
        return {
          document: validateCatalogAdminDocumentV69(JSON.parse(raw)),
          generation: fileGeneration(stats),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(document, expectedGeneration) {
      const current = await this.load();
      const generation = current?.generation || "0";
      if (generation !== expectedGeneration) throw new CatalogAdminConflictV69("El archivo administrativo cambió.");
      const body = `${JSON.stringify(validateCatalogAdminDocumentV69(document), null, 2)}\n`;
      if (Buffer.byteLength(body) > MAX_ADMIN_BYTES) throw new Error("La configuración administrativa excede el límite.");
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      const temporary = `${resolved}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fs.rename(temporary, resolved);
      const stats = await fs.stat(resolved);
      return { document: validateCatalogAdminDocumentV69(document), generation: fileGeneration(stats) };
    },
  };
}

export function createGcsCatalogAdminStoreV69(bucket: string, objectName: string): CatalogAdminStoreV69 {
  validateGcsTarget(bucket, objectName);
  const auth = new GoogleAuth({ scopes: [GCS_SCOPE] });
  const bucketKey = encodeURIComponent(bucket);
  const objectKey = encodeURIComponent(objectName);
  const metadataUrl = `https://storage.googleapis.com/storage/v1/b/${bucketKey}/o/${objectKey}`;
  const mediaUrl = `${metadataUrl}?alt=media`;
  async function authorization() {
    const token = await auth.getAccessToken();
    if (!token) throw new Error("GCS no entregó credenciales administrativas.");
    return `Bearer ${token}`;
  }
  return {
    async load() {
      const response = await fetch(mediaUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { authorization: await authorization() },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`GCS config admin HTTP ${response.status}.`);
      const body = await response.text();
      if (Buffer.byteLength(body) > MAX_ADMIN_BYTES) throw new Error("La configuración administrativa excede el límite.");
      let generation = response.headers.get("x-goog-generation") || "";
      if (!generation) {
        const metadata = await fetch(metadataUrl, {
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          headers: { authorization: await authorization() },
        });
        if (!metadata.ok) throw new Error(`GCS metadata admin HTTP ${metadata.status}.`);
        generation = String((await metadata.json() as { generation?: string }).generation || "");
      }
      if (!/^\d+$/.test(generation)) throw new Error("GCS no informó generación administrativa.");
      return { document: validateCatalogAdminDocumentV69(JSON.parse(body)), generation };
    },
    async save(document, expectedGeneration) {
      if (!/^\d+$/.test(expectedGeneration)) throw new Error("La generación administrativa es inválida.");
      const body = `${JSON.stringify(validateCatalogAdminDocumentV69(document))}\n`;
      if (Buffer.byteLength(body) > MAX_ADMIN_BYTES) throw new Error("La configuración administrativa excede el límite.");
      const uploadUrl =
        `https://storage.googleapis.com/upload/storage/v1/b/${bucketKey}/o` +
        `?uploadType=media&name=${objectKey}&ifGenerationMatch=${encodeURIComponent(expectedGeneration)}`;
      const response = await fetch(uploadUrl, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          authorization: await authorization(),
          "content-type": "application/json; charset=utf-8",
        },
        body,
      });
      if (response.status === 412) throw new CatalogAdminConflictV69("La configuración cambió en GCS.");
      if (!response.ok) throw new Error(`GCS save admin HTTP ${response.status}.`);
      const metadata = await response.json() as { generation?: string };
      const generation = String(metadata.generation || "");
      if (!/^\d+$/.test(generation)) throw new Error("GCS no confirmó la generación administrativa.");
      return { document: validateCatalogAdminDocumentV69(document), generation };
    },
  };
}

export async function verifyCatalogAdminTokenV69(
  token: string,
  environment: CatalogAdminEnvironmentV69,
): Promise<CatalogAdminActorV69> {
  const localToken = environment.V69_ADMIN_LOCAL_TOKEN?.trim();
  if (environment.NODE_ENV !== "production" && localToken && timingSafeEqual(token, localToken)) {
    return { subject: "local-admin", email: "local-admin" };
  }
  const clientId = environment.V69_ADMIN_GOOGLE_CLIENT_ID?.trim();
  const allowedEmails = parseAllowedEmails(environment.V69_ADMIN_ALLOWED_EMAILS);
  if (!clientId || !allowedEmails.length) throw new Error("La autenticación Google del panel no está configurada.");
  const ticket = await new OAuth2Client().verifyIdToken({ idToken: token, audience: clientId });
  const payload = ticket.getPayload();
  const email = String(payload?.email || "").trim().toLowerCase();
  if (!payload?.sub || payload.email_verified !== true || !allowedEmails.includes(email)) {
    throw new Error("La cuenta Google no está autorizada para este panel.");
  }
  return { subject: payload.sub, email };
}

function memoryEntry({
  at,
  actor,
  type,
  summary,
  revision,
  details = {},
}: {
  at: string;
  actor: string;
  type: CatalogAdminMemoryTypeV69;
  summary: string;
  revision: number;
  details?: Record<string, string | number | boolean | null>;
}): CatalogAdminMemoryEntryV69 {
  return {
    id: crypto.createHash("sha256").update(`${at}|${actor}|${type}|${summary}`).digest("hex").slice(0, 16),
    at,
    actor,
    type,
    summary: text(summary, "summary", 300),
    revision,
    details: validateDetails(details, "details"),
  };
}

function defaultAdminObjectName(syncObject: string | undefined) {
  if (!syncObject) return "";
  const directory = syncObject.includes("/") ? syncObject.slice(0, syncObject.lastIndexOf("/")) : "";
  return `${directory ? `${directory}/` : ""}catalog-admin-v69.json`;
}

function parseAllowedEmails(value: string | undefined) {
  return [...new Set(String(value || "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

function validateDetails(value: unknown, field: string) {
  const raw = value === undefined ? {} : object(value, field);
  const entries = Object.entries(raw);
  if (entries.length > 24) throw new Error(`El campo ${field} tiene demasiados detalles.`);
  return Object.fromEntries(entries.map(([key, detail]) => {
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(key)) throw new Error(`La clave ${key} de ${field} es inválida.`);
    if (detail === null || typeof detail === "boolean") return [key, detail];
    if (typeof detail === "number" && Number.isFinite(detail)) return [key, detail];
    if (typeof detail === "string" && detail.length <= 300 && !/[\u0000-\u001f\u007f]/.test(detail)) return [key, detail];
    throw new Error(`El detalle ${key} de ${field} es inválido.`);
  })) as Record<string, string | number | boolean | null>;
}

function validateGcsTarget(bucket: string, objectName: string) {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/i.test(bucket)) throw new Error("Bucket admin inválido.");
  if (!objectName || objectName.startsWith("/") || objectName.includes("..") || /[\u0000-\u001f\u007f]/.test(objectName)) {
    throw new Error("Objeto admin inválido.");
  }
}

function fileGeneration(stats: { size: number; mtimeMs: number }) {
  return `${Math.round(stats.mtimeMs)}-${stats.size}`;
}

function timingSafeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function object(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`El campo ${field} debe ser un objeto.`);
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new Error(`El campo ${field} debe ser una lista.`);
  return value;
}

function text(value: unknown, field: string, max: number) {
  if (typeof value !== "string") throw new Error(`El campo ${field} debe ser texto.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || /[\u0000-\u001f\u007f]/.test(cleaned)) throw new Error(`El campo ${field} es inválido.`);
  return cleaned;
}

function timestamp(value: unknown, field: string) {
  const raw = text(value, field, 64);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`El campo ${field} debe ser una fecha.`);
  return date.toISOString();
}

function integer(value: unknown, field: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`El campo ${field} es inválido.`);
  return parsed;
}
