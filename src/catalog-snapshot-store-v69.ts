import crypto from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import type { RuntimeEnvironmentV69, SnapshotStoreV69, SyncedCatalogV69 } from "./commerce-runtime-v69.js";

export class SnapshotConflictV69 extends Error {
  constructor() { super("La generación GCS cambió durante la sincronización."); this.name = "SnapshotConflictV69"; }
}

export class SnapshotWriteUncertainV69 extends Error {
  constructor(cause: unknown) {
    super("GCS no confirmó la generación publicada; volver a leer antes de reintentar.", { cause });
    this.name = "SnapshotWriteUncertainV69";
  }
}

export function gcsSnapshotStoreV69(
  environment: RuntimeEnvironmentV69,
  dependencies: { fetch?: typeof fetch; token?: () => Promise<string | null> } = {},
): SnapshotStoreV69 | null {
  const bucket = environment.V69_SYNC_GCS_BUCKET?.trim();
  const object = environment.V69_SYNC_GCS_OBJECT?.trim();
  if (!bucket && !object) return null;
  if (!bucket || !object || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/i.test(bucket) ||
      object.startsWith("/") || object.includes("..") || /[\u0000-\u001f\u007f]/.test(object)) {
    throw new Error("Configuración GCS V6.9 inválida.");
  }
  const bucketKey = encodeURIComponent(bucket);
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] });
  const fetchImpl = dependencies.fetch || fetch;
  const token = dependencies.token || (() => auth.getAccessToken());
  const metadataUrl = (name: string) => `https://storage.googleapis.com/storage/v1/b/${bucketKey}/o/${encodeURIComponent(name)}`;
  const request = async (url: string, init: RequestInit = {}) => {
    const access = await token();
    if (!access) throw new Error("GCS no entregó credenciales de aplicación.");
    return fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json", ...init.headers } });
  };
  const fail = (response: Response) => {
    if (response.status === 412) throw new SnapshotConflictV69();
    throw new Error(`GCS snapshot HTTP ${response.status}.`);
  };
  async function head(name = object!) {
    const response = await request(`${metadataUrl(name)}?fields=generation`);
    if (response.status === 404) return "0";
    if (!response.ok) fail(response);
    const { generation } = await response.json() as { generation: string };
    if (!/^\d+$/.test(generation)) throw new Error("Generación GCS inválida.");
    return generation;
  }
  async function read(name: string, generation?: string) {
    const response = await request(`${metadataUrl(name)}?alt=media${generation ? `&generation=${generation}` : ""}`);
    if (generation && response.status === 404) throw new SnapshotConflictV69();
    if (!response.ok) fail(response);
    if (Number(response.headers.get("content-length")) > 20_000_000) throw new Error("Snapshot GCS demasiado grande.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Snapshot GCS sin cuerpo.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 20_000_000) throw new Error("Snapshot GCS demasiado grande.");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async function upload(name: string, value: unknown, expectedGeneration: string, immutable = false) {
    if (!/^\d+$/.test(expectedGeneration)) throw new Error("Publicación GCS sin generación esperada.");
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > 20_000_000) throw new Error("Snapshot GCS demasiado grande.");
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucketKey}/o?uploadType=media&name=${encodeURIComponent(name)}&ifGenerationMatch=${expectedGeneration}`;
    const response = await request(url, { method: "POST", body });
    if (immutable && response.status === 412) return;
    if (!response.ok) fail(response);
    try {
      const generation = String((await response.json() as { generation?: string }).generation || "");
      if (!/^\d+$/.test(generation)) throw new Error("Respuesta GCS sin generación.");
      return generation;
    } catch (error) { throw new SnapshotWriteUncertainV69(error); }
  }
  const loadVersioned = async () => {
    const generation = await head();
    return { catalog: generation === "0" ? null : await read(object!, generation), generation };
  };
  const receiptName = (key: string) => `${object}.rejected/${crypto.createHash("sha256").update(key).digest("hex")}.json`;
  return {
    load: async () => (await loadVersioned()).catalog,
    loadVersioned,
    generation: () => head(),
    async loadPrevious(catalog) {
      const name = (catalog as { publicationV69?: { previousObject?: string } })?.publicationV69?.previousObject;
      if (!name || !name.startsWith(`${object}.history/`) || !/^\d+\.json$/.test(name.slice(`${object}.history/`.length))) return null;
      return read(name);
    },
    async save(catalog: SyncedCatalogV69, expectedGeneration?: string, idempotencyKey = "") {
      if (!expectedGeneration) throw new Error("Publicación GCS sin lectura versionada previa.");
      let previousObject: string | null = null;
      if (expectedGeneration !== "0") {
        // Archive the exact generation used to compute the candidate. The final
        // conditional write, not this read, arbitrates concurrent publishers.
        const previous = await read(object!, expectedGeneration);
        previousObject = `${object}.history/${expectedGeneration}.json`;
        await upload(previousObject, previous, "0", true);
      }
      return upload(object!, { ...catalog, publicationV69: { previousObject,
        idempotencyKeyHash: idempotencyKey ? crypto.createHash("sha256").update(idempotencyKey).digest("hex") : null,
        codeRevision: environment.V69_CODE_REVISION || "unknown" } }, expectedGeneration);
    },
    async wasRejected(key) { return (await head(receiptName(key))) !== "0"; },
    async recordRejection(key, failure, candidate) {
      let candidateObject: string | null = null;
      if (candidate) {
        const digest = crypto.createHash("sha256").update(JSON.stringify(candidate)).digest("hex");
        candidateObject = `${object}.candidates/${digest}.json`;
        await upload(candidateObject, candidate, "0", true);
      }
      await upload(receiptName(key), { failure, candidateObject }, "0", true);
    },
  };
}
