import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import type http from "node:http";
import { spawnSync } from "node:child_process";
import { CatalogAdminRuntimeV69, defaultCatalogAdminDocumentV69 } from "../src/catalog-admin-v69.js";
import { assertCatalogPublicationV69, preparePublicationV69 } from "../src/catalog-validation-v69.js";
import { activatePreparedCatalogV69 } from "../src/data-v69.js";
import { CommerceRuntimeV69 } from "../src/commerce-runtime-v69.js";
import { handleV69Request } from "../src/server-v69.js";
import { publicCatalogV69, catalogPageV69, sortProductsV69, compileSearchPlanV69, searchRelevanceV69 } from "../src/render-v69.js";

test("lecturas públicas vencidas comparten una sola consulta administrativa", async () => {
  let clock = 0;
  let reads = 0;
  let release!: () => void;
  let gate = Promise.resolve();
  const value = { document: defaultCatalogAdminDocumentV69(), generation: "1" };
  const runtime = new CatalogAdminRuntimeV69({}, {
    now: () => new Date(clock),
    store: { load: async () => { reads++; await gate; return value; }, save: async () => value },
  });
  await runtime.current();
  clock = 31_000;
  gate = new Promise(resolve => { release = resolve; });
  const pending = Array.from({ length: 5 }, () => runtime.current());
  release();
  const results = await Promise.all(pending);
  assert.equal(reads, 2);
  assert.ok(results.every(result => result === results[0]));
});

test("una lectura vieja no pisa una publicación administrativa nueva", async () => {
  let clock = 0;
  let reads = 0;
  let release!: () => void;
  const old = { document: defaultCatalogAdminDocumentV69(), generation: "1" };
  const runtime = new CatalogAdminRuntimeV69({}, {
    now: () => new Date(clock),
    store: {
      load: async () => { reads++; if (reads === 2) await new Promise<void>(resolve => { release = resolve; }); return old; },
      save: async document => ({ document, generation: "2" }),
    },
  });
  await runtime.current();
  clock = 31_000;
  const pending = runtime.current();
  const policy = structuredClone(old.document.policy);
  policy.navigation.defaultSort = "nombre";
  const saved = await runtime.publishPolicy({ policy, expectedRevision: 0,
    actor: { subject: "test", email: "test@example.test" }, summary: "Prueba" });
  release();
  assert.equal((await pending).document.revision, saved.document.revision);
  assert.equal((await runtime.current()).document.revision, 1);
});

test("fallo de lectura libera la consulta compartida y permite reintento", async () => {
  let fail = true;
  const value = { document: defaultCatalogAdminDocumentV69(), generation: "1" };
  const runtime = new CatalogAdminRuntimeV69({}, {
    store: { load: async () => { if (fail) throw new Error("fallo de origen"); return value; }, save: async () => value },
  });
  const failed = await Promise.allSettled([runtime.current(), runtime.current()]);
  assert.ok(failed.every(result => result.status === "rejected"));
  fail = false;
  assert.equal((await runtime.current()).generation, "1");
});


const directory = await mkdtemp(path.join(tmpdir(), "v69-opening-"));
after(() => rm(directory, { recursive: true, force: true }));
const at = new Date().toISOString();
const variant = { width: 640, height: 640, webp: { "320": "https://storage.googleapis.com/test/card.webp" },
  avif: { "320": "https://storage.googleapis.com/test/card.avif" },
  jpeg: { "320": "https://storage.googleapis.com/test/320.jpg", "640": "https://storage.googleapis.com/test/640.jpg" } };
const raw = { version: 6.9, syncedAt: at, commerceSyncedAt: at, availabilityReferenceAt: at, totalProducts: 3,
  products: ["Eucerin", "Neutrogena", "Dermaglos"].map((name, i) => ({
    publicId: "opening-" + i, sku: "opening-" + i, name: "Crema hidratante " + name,
    brand: { id: name.toLowerCase(), slug: name.toLowerCase(), name, aliases: [] }, line: "",
    primaryCategory: "rostro", categorySlugs: ["rostro"], needs: ["hidratacion"], aliases: [],
    availability: "limited", availabilityCheckedAt: at,
    listPrice: 100, offerPrice: i === 0 ? 80 : 100, discountPercent: i === 0 ? 20 : 0, savingAmount: i === 0 ? 20 : 0,
    ...(i === 2 ? { promotion: { type: "two_for_one", buyQuantity: 2, payQuantity: 1, unitPrice: 100,
      bundlePrice: 100, bundleSaving: 100 } } : {}),
    magentoTaxonomyAttached: true, magentoCategories: [{ id: "123", name: "Cuidado facial" }],
    images: { card: "https://storage.googleapis.com/test/card.jpg", detail: "https://storage.googleapis.com/test/card.jpg",
      responsive: { card: structuredClone(variant), detail: structuredClone(variant) } },
  })) };
const exclusionsFile = path.join(directory, "exclusions.json");
const taxonomyFile = path.join(directory, "taxonomy.json");
await writeFile(exclusionsFile, JSON.stringify({ skus: [], barcodes: [], urls: [], hidden: {} }));
await writeFile(taxonomyFile, JSON.stringify({ schemaVersion: 1,
  source: { platform: "Magento 2", endpoint: "https://gpsfarma.com/graphql", extractedAt: at, maxNormalizedLevel: 7 },
  catalog: { version: 6.9, sourceProducts: 3, visibleProducts: 3 }, categories: [], products: [] }));
async function fixture() {
  const environment = { NODE_ENV: "test", V69_LOCAL_PREVIEW: "1",
    V69_EXCLUSIONS_FILE: exclusionsFile, V69_MAGENTO_TAXONOMY_FILE: taxonomyFile };
  return { catalog: await preparePublicationV69(structuredClone(raw), environment),
    document: defaultCatalogAdminDocumentV69(), environment };
}

test("HTTP público inicia catálogo y política juntos, antes de terminar la primera lectura", async () => {
  const { catalog, document, environment } = await fixture();
  activatePreparedCatalogV69(catalog);
  let release!: () => void;
  let policyReads = 0;
  const commerce = new CommerceRuntimeV69(environment);
  commerce.ensureCurrent = async () => { await new Promise<void>(resolve => { release = resolve; }); };
  const admin = new CatalogAdminRuntimeV69(environment, { store: {
    load: async () => { policyReads++; return { document, generation: "1" }; },
    save: async () => { throw new Error("Escrituras prohibidas"); },
  } });
  let status = 0;
  const response = { writeHead: (code: number) => { status = code; }, end: () => {} } as unknown as http.ServerResponse;
  const url = new URL("/catalogo?scope=todo", "http://127.0.0.1");
  const pending = handleV69Request(response, url, url.pathname, environment, commerce, undefined, admin);
  try { assert.equal(policyReads, 1); }
  finally { release(); await pending; }
  assert.equal(status, 200);
});

test("caché de presentación conserva DTO/HTML e invalida política y snapshot", async () => {
  const { catalog, document } = await fixture();
  const policy = structuredClone(document.policy);
  const first = publicCatalogV69(catalog, policy);
  const html = catalogPageV69(catalog, new URLSearchParams("scope=todo"), "https://example.test", { policy });
  assert.deepEqual(publicCatalogV69(catalog, policy), first);
  assert.equal(catalogPageV69(catalog, new URLSearchParams("scope=todo"), "https://example.test", { policy }), html);
  // Returned navigation is not the cache's writable backing array.
  first.navigation.brands[0].count = -1;
  assert.ok(publicCatalogV69(catalog, policy).navigation.brands[0].count >= 0);
  policy.navigation.defaultSort = "nombre";
  assert.deepEqual(publicCatalogV69(catalog, policy), publicCatalogV69(structuredClone(catalog), policy));
  const changed = structuredClone(catalog);
  changed.products[0].name = "Producto modificado para prueba";
  assert.deepEqual(publicCatalogV69(changed, policy), publicCatalogV69(structuredClone(changed), policy));
  assert.notDeepEqual(publicCatalogV69(changed, policy), publicCatalogV69(catalog, policy));
});

test("relevancia sin búsqueda conserva el orden previo, incluidos descuentos y 2×1", async () => {
  const { catalog } = await fixture();
  const products = catalog.products;
  const plan = compileSearchPlanV69([...products], "");
  assert.ok(products.every(product => searchRelevanceV69(product, plan).every(score => score === 0)));
  const rank = (product: typeof products[number]) => product.promotion?.type === "two_for_one" ? 50 : Number(product.discountPercent || 0);
  const saving = (product: typeof products[number]) => product.promotion?.type === "two_for_one" ? Number(product.promotion.bundleSaving || 0) : Number(product.savingAmount || 0);
  const expected = [...products].sort((left, right) => rank(right) - rank(left) || saving(right) - saving(left) ||
    String(left.name || "").localeCompare(String(right.name || ""), "es") || String(left.publicId || "").localeCompare(String(right.publicId || ""), "es"));
  for (const query of ["", " "]) assert.deepEqual(sortProductsV69(products, "relevancia", query).map(product => product.publicId), expected.map(product => product.publicId));
});

test("validación memoizada sólo para snapshots inmutables; no congela el candidato del sincronizador", async () => {
  const { environment } = await fixture();
  const candidate = structuredClone(raw);
  const prepared = await preparePublicationV69(candidate, environment);
  assert.equal(Object.isFrozen(prepared.products[0].images), true);
  assert.equal(Object.isFrozen(candidate.products[0].images), false);
  assert.throws(() => { prepared.products[0].offerPrice = 0; }, TypeError);
  assert.doesNotThrow(() => assertCatalogPublicationV69(prepared, environment));
  const corrupt = structuredClone(prepared);
  corrupt.products[0].offerPrice = 0;
  assert.throws(() => assertCatalogPublicationV69(corrupt, environment), /Precios/);
});

test("copia publicable mantiene acotada la memoria de variantes con claves numéricas", async () => {
  // Real snapshots are JSON. Numeric image-width keys must not grow into large
  // sparse backing stores when copied, even though their values are identical.
  const file = path.join(directory, "memory-catalog.json");
  await writeFile(file, JSON.stringify({ ...raw, products: Array.from({ length: 2_400 }, (_, i) => ({
    ...raw.products[0], publicId: `memory-${i}`, sku: `memory-${i}`,
  })) }));
  const result = spawnSync(process.execPath, ["--expose-gc", "--max-old-space-size=256", "--import", "tsx",
    "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { preparePublicationV69 } from './src/catalog-validation-v69.ts';
      import { publicCatalogV69 } from './src/render-v69.ts';
      const raw = JSON.parse(fs.readFileSync(process.env.V69_MEMORY_FIXTURE, 'utf8'));
      global.gc(); const before = process.memoryUsage().heapUsed;
      const prepared = await preparePublicationV69(raw, process.env);
      global.gc(); const increase = process.memoryUsage().heapUsed - before;
      assert.equal(prepared.products.length, raw.products.length);
      assert.ok(Object.isFrozen(prepared.products[0].images));
      assert.ok(!Object.isFrozen(raw.products[0].images));
      assert.deepEqual(prepared.products[0].images, raw.products[0].images);
      assert.ok(increase < 64 * 1024 * 1024, 'Publication copy retained ' + Math.round(increase / 1048576) + ' MiB');
      const dtoBefore = process.memoryUsage().heapUsed;
      const dto = publicCatalogV69(prepared);
      global.gc(); const dtoIncrease = process.memoryUsage().heapUsed - dtoBefore;
      assert.equal(dto.products.length, raw.products.length);
      assert.deepEqual(dto.products[0].images.responsive, raw.products[0].images.responsive);
      assert.ok(dtoIncrease < 64 * 1024 * 1024, 'Public DTO retained ' + Math.round(dtoIncrease / 1048576) + ' MiB');
      console.log(JSON.stringify({ retainedCopyMiB: increase / 1048576 }));
    `], { encoding: "utf8", timeout: 30_000, env: { ...process.env, V69_MEMORY_FIXTURE: file,
      V69_EXCLUSIONS_FILE: exclusionsFile, V69_MAGENTO_TAXONOMY_FILE: taxonomyFile } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("otra publicación y cambios de exclusión/promociones invalidan la presentación", async () => {
  const { catalog, document, environment } = await fixture();
  const policy = structuredClone(document.policy);
  const before = publicCatalogV69(catalog, policy);
  const candidate = structuredClone(raw);
  candidate.products[0].name = "Crema hidratante actualizada";
  candidate.products[0].offerPrice = 70;
  candidate.products[0].discountPercent = 30;
  candidate.products[0].savingAmount = 30;
  const next = await preparePublicationV69(candidate, environment);
  const after = publicCatalogV69(next, policy);
  assert.notDeepEqual(after, before);
  assert.equal(after.products.find(p => p.publicId === "opening-0")?.offerPrice, 70);
  policy.navigation.excludedBrandSlugs = ["neutrogena"];
  policy.navigation.promotionBrandSlugs = [];
  const changed = publicCatalogV69(next, policy);
  assert.ok(!changed.products.some(p => p.brand.slug === "neutrogena"));
  assert.ok(changed.products.every(p => p.discountPercent === 0 && !p.promotion));
  assert.deepEqual(changed, publicCatalogV69(structuredClone(next), policy));
});
