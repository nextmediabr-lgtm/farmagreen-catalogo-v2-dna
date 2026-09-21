import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { CommerceRuntimeV69, RuntimeHttpErrorV69, syncFailureV69, validateSyncedCatalogV69, type RuntimeDependenciesV69, type SnapshotStoreV69, type SyncedCatalogV69 } from "../src/commerce-runtime-v69.js";
import { SnapshotConflictV69, gcsSnapshotStoreV69 } from "../src/catalog-snapshot-store-v69.js";
import { assertCatalogPublicationV69, assertCatalogTransitionV69, candidateDigestV69 } from "../src/catalog-validation-v69.js";
import { runCatalogDiscoveryJobV69, DiscoveryJobFailureV69 } from "../src/catalog-discovery-job-v69.js";
import { catalogHealthV69 } from "../src/server-v69.js";
import { catalogPageV69 } from "../src/render-v69.js";
import { reviewCatalogCandidateV69 } from "../src/catalog-candidate-review-v69.js";

const ENV = { V69_SYNC_ENABLED: "1", V69_SYNC_OIDC_AUDIENCE: "https://test.example/refresh", V69_SYNC_OIDC_SERVICE_ACCOUNT_EMAIL: "test@example.com", V69_CODE_REVISION: "abc123" };
const old = snapshot("2026-09-19T10:00:00Z");
const next = snapshot("2026-09-19T17:00:00Z");

function snapshot(at: string): SyncedCatalogV69 {
  const variant = { width: 640, height: 640, webp: { "320": "https://storage.googleapis.com/test/image.webp" }, avif: { "320": "https://storage.googleapis.com/test/image.avif" }, jpeg: { "320": "https://storage.googleapis.com/test/image-320.jpg", "640": "https://storage.googleapis.com/test/image-640.jpg" } };
  return { version: 6.9, syncedAt: at, commerceSyncedAt: at, availabilityReferenceAt: at, totalProducts: 1,
    products: [{ publicId: "p1", sku: "test-1", slug: "producto", name: "Producto de prueba", brand: { id: "ena", name: "ENA", slug: "ena", aliases: [] }, line: "", primaryCategory: "nutricion", categorySlugs: ["nutricion"], needs: ["nutricion"], aliases: [],
      availability: "limited", availabilityCheckedAt: at, listPrice: 100, offerPrice: 100, discountPercent: 0, savingAmount: 0,
      magentoTaxonomyAttached: true, magentoCategories: [{ id: "7160", name: "Nutrición" }], images: { card: "https://storage.googleapis.com/test/image.jpg", detail: "https://storage.googleapis.com/test/image.jpg", responsive: { card: structuredClone(variant), detail: structuredClone(variant) } } }],
    commerceSync: { status: "completed", completedAt: at, sources: Array.from({ length: 16 }, (_, i) => ({ id: String(i), status: "completed" })), metrics: { coverage: 1, priceCoverage: 1, availabilityCoverage: 1, unverified: 0 } },
  } as SyncedCatalogV69;
}

function harness(overrides: Partial<RuntimeDependenciesV69> = {}) {
  let activated: unknown;
  let stored: unknown = old;
  let generation = "1";
  let clock = Date.parse("2026-09-19T18:00:00Z");
  const calls = { save: 0, load: 0, head: 0, scan: 0 };
  const rejected = new Set<string>();
  const store: SnapshotStoreV69 = {
    load: async () => stored,
    loadVersioned: async () => { calls.load++; return { catalog: stored, generation }; },
    generation: async () => { calls.head++; return generation; },
    save: async (candidate, expected, key) => {
      assert.equal(expected, generation);
      calls.save++;
      stored = { ...candidate, publicationV69: { idempotencyKeyHash: crypto.createHash("sha256").update(key || "").digest("hex") } };
      generation = String(Number(generation) + 1);
      return generation;
    },
    wasRejected: async (key) => rejected.has(key),
    recordRejection: async (key) => { rejected.add(key); },
  };
  const dependencies: RuntimeDependenciesV69 = {
    loadBaseCatalog: async () => old,
    prepareCatalog: async (candidate) => () => { activated = candidate; },
    runSync: async () => { calls.scan++; return next; },
    snapshotStore: store, verifyOidcToken: async () => {}, now: () => new Date(clock), ...overrides,
  };
  const runtime = new CommerceRuntimeV69(ENV, dependencies);
  return { runtime, dependencies, store, calls, rejected, active: () => activated,
    advance: () => { clock += 31_000; }, replace: (catalog: unknown) => { stored = catalog; generation = String(Number(generation) + 1); } };
}

test("preparación fallida no publica ni activa y el mismo horario no repite crawl", async () => {
  const h = harness({ prepareCatalog: async (candidate) => { if (candidate === next) throw new Error("JPEG incompleto"); return () => {}; } });
  await h.runtime.initialize();
  await assert.rejects(h.runtime.refresh("job|14"), (e: unknown) => e instanceof RuntimeHttpErrorV69 && e.status === 422);
  await assert.rejects(h.runtime.refresh("job|14"), /ya rechazada/);
  const other = new CommerceRuntimeV69(ENV, h.dependencies);
  await assert.rejects(other.refresh("job|14"), /ya rechazada/);
  assert.equal(h.calls.scan, 1);
  assert.equal(h.calls.save, 0);
  assert.equal(h.runtime.health().commerceSyncedAt, new Date(old.commerceSyncedAt!).toISOString());
  await assert.rejects(other.refresh("job|next-day"));
  assert.equal(h.calls.scan, 2);
});

test("conflicto de publicación conserva el activo y permite reintento transitorio", async () => {
  const h = harness();
  h.store.save = async () => { throw new SnapshotConflictV69(); };
  await h.runtime.initialize();
  await assert.rejects(h.runtime.refresh("job|14"), (e: unknown) => e instanceof RuntimeHttpErrorV69 && e.status === 503);
  assert.equal(h.active(), old);
  assert.equal(h.rejected.size, 0);
  assert.equal(h.runtime.health().lastFailure?.phase, "publish");
});

test("arranque fallido se puede reintentar sin reiniciar el proceso", async () => {
  let attempts = 0;
  const h = harness({ snapshotStore: null, prepareCatalog: async () => { if (++attempts === 1) throw new Error("archivo temporalmente ausente"); return () => {}; } });
  await assert.rejects(h.runtime.initialize());
  await assert.rejects(h.runtime.initialize(), /Reintentando/);
  h.advance();
  await h.runtime.initialize();
  assert.equal(attempts, 2);
  assert.equal(h.runtime.health().products, 1);
});

test("respaldo remoto válido recupera el arranque; respaldo inválido permite fallback local", async () => {
  for (const previous of [old, { broken: true }]) {
    const h = harness();
    h.replace({ broken: true });
    h.store.loadPrevious = async () => previous;
    await h.runtime.initialize();
    assert.equal(h.active(), old);
    assert.equal(h.runtime.health().status, "degraded");
  }
});

test("dos instancias convergen por generación incluso con timestamp idéntico, sin descargar si no cambia", async () => {
  const h = harness();
  const other = new CommerceRuntimeV69(ENV, h.dependencies);
  await Promise.all([h.runtime.initialize(), other.initialize()]);
  assert.equal(h.calls.load, 2);
  h.advance();
  await h.runtime.ensureCurrent();
  assert.equal(h.calls.load, 2);
  h.replace({ ...old, products: [...old.products, { ...old.products[0], publicId: "p2" }], totalProducts: 2 });
  h.advance();
  await Promise.all([h.runtime.ensureCurrent(), other.ensureCurrent()]);
  assert.equal(h.runtime.health().products, 2);
  assert.equal(other.health().products, 2);
  assert.equal(h.calls.load, 4);
});

test("recupera salud tras error temporal de metadata y conserva snapshot ante candidato corrupto", async () => {
  const h = harness();
  await h.runtime.initialize();
  const head = h.store.generation!;
  h.store.generation = async () => { throw new Error("GCS HTTP 503"); };
  h.advance(); await h.runtime.ensureCurrent();
  assert.equal(h.runtime.health().status, "degraded");
  h.store.generation = head;
  h.advance(); await h.runtime.ensureCurrent();
  assert.equal(h.runtime.health().status, "ready");
  h.replace({ broken: true });
  h.advance(); await h.runtime.ensureCurrent();
  assert.equal(h.active(), old);
  assert.equal(h.runtime.health().snapshotGeneration, "1");
});

test("una réplica no vuelve a ejecutar un horario ya publicado en GCS", async () => {
  const h = harness();
  await h.runtime.refresh("job|14");
  const other = new CommerceRuntimeV69(ENV, h.dependencies);
  assert.equal((await other.refresh("job|14")).status, "already_processed");
  assert.equal(h.calls.scan, 1);
  assert.equal(h.calls.save, 1);
});

test("el gate común rechaza imágenes incompletas, precio falso y SKU duplicado", () => {
  const env = { V691_REQUIRE_JPEG_RESPONSIVE_IMAGES: "1", V691_REQUIRE_RESPONSIVE_IMAGES: "1", V69_REQUIRE_MAGENTO_TAXONOMY: "1" };
  assert.doesNotThrow(() => assertCatalogPublicationV69(next, env));
  const invalid = structuredClone(next);
  delete invalid.products[0].images.responsive!.card!.jpeg!["640"];
  assert.throws(() => assertCatalogPublicationV69(invalid, env), /Imágenes/);
  assert.throws(() => assertCatalogPublicationV69({ ...next, products: [{ ...next.products[0], discountPercent: 50 }] }, env), /Precios/);
  assert.throws(() => assertCatalogPublicationV69({ ...next, products: [...next.products, { ...next.products[0], publicId: "p2" }] }, env), /duplicada/);
  const small = structuredClone(next);
  for (const kind of ["card", "detail"] as const) {
    const set = small.products[0].images.responsive![kind]!;
    set.width = 621;
    set.jpeg!["621"] = set.jpeg!["640"];
    delete set.jpeg!["640"];
  }
  assert.doesNotThrow(() => assertCatalogPublicationV69(small, env));
});

test("anomalías requieren aprobar exactamente el candidato y nunca permiten retroceder su fecha", () => {
  const before = { ...old, products: Array.from({ length: 100 }, (_, i) => ({ ...old.products[0], publicId: String(i), discountPercent: 50 })) };
  const after = { ...next, products: before.products.map(p => ({ ...p, discountPercent: 0 })) };
  assert.throws(() => assertCatalogTransitionV69(before, after), /offer_drop/);
  assert.throws(() => assertCatalogTransitionV69(before, after, "no-es-el-digest"), /offer_drop/);
  assert.doesNotThrow(() => assertCatalogTransitionV69(before, after, candidateDigestV69(after)));
  assert.throws(() => assertCatalogTransitionV69(next, old, candidateDigestV69(old)), /no avanza/);
});

test("el Job semanal valida antes de guardar y distingue la fase que falla", async () => {
  const h = harness();
  let scans = 0;
  const deps = { snapshotStore: h.store, environment: { CLOUD_RUN_EXECUTION: "execution-1" }, loadFallbackCatalog: async () => old,
    scanCatalog: async () => { scans++; return { catalog: next, discoverySync: {} }; },
    finalizeCatalog: async () => ({ catalog: next, discoverySync: {} }),
    validateCatalog: async (value: unknown) => { assertCatalogPublicationV69({ ...next, products: [] }, {}); return validateSyncedCatalogV69(value); } };
  await assert.rejects(runCatalogDiscoveryJobV69(deps), (e: unknown) => e instanceof DiscoveryJobFailureV69 && e.failure.phase === "validate");
  await assert.rejects(runCatalogDiscoveryJobV69(deps), /ya rechazada/);
  assert.equal(scans, 1);
  assert.equal(h.calls.save, 0);
});

test("errores estructurados conservan causa útil sin URL, token ni EAN", () => {
  const failure = syncFailureV69(new Error("fuente falló", { cause: new Error("HTTP 502 https://private.example/?token=x Bearer abc 7791234567890") }), "crawl", "run-1", "revision");
  assert.equal(failure.retryable, true);
  assert.match(JSON.stringify(failure), /HTTP 502/);
  assert.doesNotMatch(JSON.stringify(failure), /private\.example|Bearer abc|7791234567890/);
  assert.equal(syncFailureV69(new Error("Identidad incorrecta"), "validate", "run").retryable, false);
});

test("sin ofertas la home muestra catálogo utilizable; health rechaza catálogo vacío", () => {
  const html = catalogPageV69(next, new URLSearchParams(), "https://test.example");
  assert.match(html, /No hay ofertas verificadas/);
  assert.match(html, /id="gridV69"[\s\S]*Producto de prueba/);
  const health = catalogHealthV69(next, new Date(next.commerceSyncedAt!));
  assert.equal(health.status, "ready");
  assert.equal(health.offers, 0);
  assert.equal(catalogHealthV69({ ...next, products: [] }).status, "degraded");
});

test("GCS archiva generación exacta antes del CAS y rechaza carreras o guardados sin versión", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  let conflict = false;
  const store = gcsSnapshotStoreV69({ V69_SYNC_GCS_BUCKET: "test-bucket", V69_SYNC_GCS_OBJECT: "snapshots/v69.json" }, {
    token: async () => "test-token",
    fetch: async (input, init = {}) => {
      const url = new URL(String(input)); calls.push({ url, init });
      if (init.method === "POST") return new Response(JSON.stringify({ generation: "2" }), { status: conflict && url.searchParams.get("ifGenerationMatch") === "1" ? 412 : 200 });
      return new Response(JSON.stringify(url.searchParams.has("alt") ? old : { generation: "1" }));
    },
  })!;
  await assert.rejects(store.save(next), /lectura versionada/);
  await store.save(next, "1", "job|14");
  assert.equal(calls[0].url.searchParams.get("generation"), "1");
  assert.equal(calls[1].url.searchParams.get("name"), "snapshots/v69.json.history/1.json");
  assert.equal(calls[1].url.searchParams.get("ifGenerationMatch"), "0");
  assert.equal(calls[2].url.searchParams.get("ifGenerationMatch"), "1");
  const written = JSON.parse(String(calls[2].init.body));
  assert.equal(written.publicationV69.previousObject, "snapshots/v69.json.history/1.json");
  assert.equal(written.publicationV69.idempotencyKeyHash, crypto.createHash("sha256").update("job|14").digest("hex"));
  conflict = true;
  await assert.rejects(store.save(next, "1"), SnapshotConflictV69);
});

test("GCS detecta lectura de generación desaparecida y rechaza punteros de respaldo ajenos", async () => {
  let reads = 0;
  const store = gcsSnapshotStoreV69({ V69_SYNC_GCS_BUCKET: "test-bucket", V69_SYNC_GCS_OBJECT: "snapshots/v69.json" }, {
    token: async () => "token", fetch: async (input) => {
      reads++; return new URL(String(input)).searchParams.has("alt") ? new Response("", { status: 404 }) : Response.json({ generation: "1" });
    },
  })!;
  assert.equal(await store.loadPrevious!({ publicationV69: { previousObject: "other/private.json" } }), null);
  assert.equal(reads, 0);
  await assert.rejects(store.loadVersioned!(), SnapshotConflictV69);
});

test("revisión manual es sólo lectura y exige digest más generación sin evitar JPEG ni fecha", async () => {
  const h = harness();
  const preview = await reviewCatalogCandidateV69({ candidate: next, store: h.store });
  assert.equal(preview.status, "preview");
  assert.equal(h.calls.save, 0);
  await assert.rejects(reviewCatalogCandidateV69({ candidate: next, store: h.store, apply: true, approvedDigest: "otro", expectedGeneration: "1" }), /aprobación/);
  await assert.rejects(reviewCatalogCandidateV69({ candidate: next, store: h.store, apply: true, approvedDigest: preview.digest, expectedGeneration: "2" }), SnapshotConflictV69);
  const invalid = structuredClone(next);
  delete invalid.products[0].images.responsive!.card!.jpeg!["640"];
  await assert.rejects(reviewCatalogCandidateV69({ candidate: invalid, store: h.store, apply: true, approvedDigest: candidateDigestV69(invalid), expectedGeneration: "1" }), /Imágenes/);
  assert.equal(h.calls.save, 0);
  assert.equal((await reviewCatalogCandidateV69({ candidate: next, store: h.store, apply: true, approvedDigest: preview.digest, expectedGeneration: "1" })).status, "published");
  assert.equal(h.calls.save, 1);
  await assert.rejects(reviewCatalogCandidateV69({ candidate: old, store: h.store, apply: true, approvedDigest: candidateDigestV69(old), expectedGeneration: "2" }), /no avanza/);
});
