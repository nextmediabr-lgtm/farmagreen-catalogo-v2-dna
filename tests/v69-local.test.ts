import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  catalogV69Data,
  isExcludedV69,
  loadExclusionsV69,
  resetCatalogV69CacheForTests,
  type CatalogV69,
  type ProductV69,
} from "../src/data-v69.js";
import {
  catalogPageV69,
  productPageV69,
  publicCatalogV69,
  sortProductsV69,
  type SortV69,
} from "../src/render-v69.js";
import { app } from "../src/server.js";
import {
  catalogHealthV69,
  catalogReadyForRuntimeV69,
  sourceImageBridgeEnabled,
} from "../src/server-v69.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog-v69.json");
const SORTS: SortV69[] = ["relevancia", "descuento", "precio-asc", "precio-desc", "nombre"];

async function baseCatalog() {
  resetCatalogV69CacheForTests();
  return catalogV69Data({
    ...process.env,
    V69_CATALOG_FILE: CATALOG_FILE,
    V69_EXCLUSIONS_FILE: path.join(tmpdir(), "farmagreen-v69-no-exclusions.json"),
  });
}

async function privateFixture(catalog: CatalogV69) {
  const directory = await mkdtemp(path.join(tmpdir(), "farmagreen-v69-exclusions-"));
  const file = path.join(directory, "catalog-exclusions-v69.local.json");
  const candidates = catalog.products.filter(
    (product) => product.availability === "limited" && typeof product.source?.url === "string",
  );
  assert.ok(candidates.length >= 2);
  const byUrl = candidates[0];
  const hidden = candidates[1];
  const privateSku = "PRIVATE-SKU-V69-DO-NOT-PUBLISH";
  const privateBarcode = "000000000069";
  const privateUrl = `${byUrl.source?.url}?private_fixture=1`;
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      notes: "fixture privado temporal",
      skus: [privateSku],
      barcodes: [privateBarcode],
      urls: [privateUrl],
      hidden: {
        [hidden.publicId]: {
          reason: "No vender",
          at: "2026-07-30T00:00:00.000Z",
        },
      },
    }),
    "utf8",
  );
  return {
    directory,
    file,
    excludedIds: [byUrl.publicId, hidden.publicId],
    privateSku,
    privateBarcode,
    privateUrl,
  };
}

function bootPayload(html: string) {
  const encoded = html.match(/<script type="application\/json" id="fg69-data">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(encoded, "Falta el payload público V6.9.");
  return JSON.parse(encoded) as {
    context: { brand: string; need: string; scope: string; sort: SortV69 };
    products: Array<Record<string, unknown>>;
  };
}

function firstGridSlug(html: string) {
  const grid = html.match(/<section class="v65-grid" id="gridV69">([\s\S]*?)<\/section>/)?.[1] || "";
  const slug = grid.match(/href="\/producto-v6-9\/([^/"]+)\/"/)?.[1];
  assert.ok(slug, "La grilla SSR V6.9 no contiene productos.");
  return slug;
}

async function listen(server: ReturnType<typeof app>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: ReturnType<typeof app>) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("V6.9 conserva el snapshot base de 688 y distingue 674/6/8 antes de exclusiones", async () => {
  const raw = JSON.parse(await readFile(CATALOG_FILE, "utf8")) as {
    products: ProductV69[];
    commerceSync?: { metrics?: Record<string, number> };
  };
  assert.equal(raw.products.length, 688);
  assert.deepEqual(
    raw.products.reduce(
      (counts, product) => {
        counts[product.availability] += 1;
        return counts;
      },
      { limited: 0, out_of_stock: 0, unknown: 0 },
    ),
    { limited: 674, out_of_stock: 6, unknown: 8 },
  );
  assert.equal(raw.commerceSync?.metrics?.catalogProducts, 688);
  assert.equal(raw.commerceSync?.metrics?.available, 674);
  assert.equal(raw.commerceSync?.metrics?.unavailable, 6);
  assert.equal(raw.commerceSync?.metrics?.unverified, 8);
});

test("fallback sin verificación real queda no verificado y un snapshot atómico se activa sin reiniciar", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "farmagreen-v69-reload-"));
  const catalogFile = path.join(directory, "catalog-v69.json");
  const exclusionsFile = path.join(directory, "missing-exclusions.json");
  const raw = JSON.parse(await readFile(CATALOG_FILE, "utf8")) as Record<string, unknown> & {
    products: ProductV69[];
  };
  const sample = { ...raw.products[0], availability: "limited", availabilityCheckedAt: null };
  const initial = {
    ...raw,
    commerceSyncedAt: null,
    commerceSync: undefined,
    totalProducts: 1,
    products: [sample],
  };
  await writeFile(catalogFile, JSON.stringify(initial));

  try {
    resetCatalogV69CacheForTests();
    const environment = {
      ...process.env,
      V69_CATALOG_FILE: catalogFile,
      V69_EXCLUSIONS_FILE: exclusionsFile,
    };
    const before = await catalogV69Data(environment);
    assert.equal(before.products[0].availability, "unknown");
    assert.equal(before.products[0].availabilityCheckedAt, null);
    assert.equal(before.availabilityReferenceAt, null);

    const checkedAt = new Date().toISOString();
    const nextFile = `${catalogFile}.next`;
    await writeFile(
      nextFile,
      JSON.stringify({
        ...initial,
        commerceSyncedAt: checkedAt,
        commerceSync: { completedAt: checkedAt },
        products: [{ ...sample, availability: "limited", availabilityCheckedAt: checkedAt }],
      }),
    );
    await rename(nextFile, catalogFile);

    const after = await catalogV69Data(environment);
    assert.equal(after.products[0].availability, "limited");
    assert.equal(after.products[0].availabilityCheckedAt, checkedAt);
    assert.equal(after.commerceSyncedAt, checkedAt);
    assert.equal(catalogHealthV69(after, new Date(checkedAt)).status, "ready");
  } finally {
    resetCatalogV69CacheForTests();
    await rm(directory, { recursive: true, force: true });
  }
});

test("la lista privada excluye antes de publicar y nunca filtra sus identificadores al DTO", async () => {
  const base = await baseCatalog();
  const fixture = await privateFixture(base);
  try {
    resetCatalogV69CacheForTests();
    const visible = await catalogV69Data({
      ...process.env,
      V69_CATALOG_FILE: CATALOG_FILE,
      V69_EXCLUSIONS_FILE: fixture.file,
      V69_REQUIRE_EXCLUSIONS: "1",
    });
    assert.equal(visible.products.length, 686);
    assert.ok(fixture.excludedIds.every((id) => !visible.products.some((product) => product.publicId === id)));

    const availability = visible.products.reduce(
      (counts, product) => {
        counts[product.availability] += 1;
        return counts;
      },
      { limited: 0, out_of_stock: 0, unknown: 0 },
    );
    assert.deepEqual(availability, { limited: 672, out_of_stock: 6, unknown: 8 });

    const rules = await loadExclusionsV69(fixture.file, true);
    const sample = base.products.find((product) => !fixture.excludedIds.includes(product.publicId));
    assert.ok(sample);
    assert.equal(isExcludedV69({ ...sample, sku: ` ${fixture.privateSku} ` }, rules), true);
    assert.equal(isExcludedV69({ ...sample, barcode: "00-0000-0000-69" }, rules), true);

    const publicCatalog = publicCatalogV69(visible);
    assert.equal(publicCatalog.totalProducts, 686);
    assert.deepEqual(publicCatalog.availabilitySummary, {
      available: 672,
      unavailable: 6,
      unverified: 8,
    });
    const serialized = JSON.stringify(publicCatalog);
    for (const secret of [fixture.privateSku, fixture.privateBarcode, fixture.privateUrl]) {
      assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(serialized, /gpsfarma|provider|barcode|"sku"|"source"/i);
    assert.ok(
      publicCatalog.products.every(
        (product) =>
          product.images.card.startsWith("/media-v6-9/") ||
          product.images.card.startsWith("https://storage.googleapis.com/"),
      ),
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("SSR V6.9 respeta los cinco órdenes y mantiene marca/necesidad mutuamente exclusivas", async () => {
  const catalog = await baseCatalog();
  for (const sort of SORTS) {
    const html = catalogPageV69(
      catalog,
      new URLSearchParams({ scope: "todo", orden: sort }),
      "http://127.0.0.1:8109",
    );
    assert.equal(bootPayload(html).context.sort, sort);
    assert.equal(firstGridSlug(html), sortProductsV69(catalog.products, sort)[0].slug, sort);
    assert.match(html, /id="sortV69" name="orden"/);
    assert.match(html, /app-v6-9\.js/);
    assert.match(html, /styles-v6-9\.css/);
    assert.doesNotMatch(html, /app-v6-8\.js|styles-v6-8\.css/i);
    assert.doesNotMatch(html, /gpsfarma/i);
  }

  const exclusive = catalogPageV69(
    catalog,
    new URLSearchParams({ scope: "todo", marca: "ISDIN", need: "solares" }),
    "http://127.0.0.1:8109",
  );
  assert.deepEqual(
    {
      brand: bootPayload(exclusive).context.brand,
      need: bootPayload(exclusive).context.need,
      scope: bootPayload(exclusive).context.scope,
    },
    { brand: "ISDIN", need: "Todas", scope: "todo" },
  );
});

test("servidor V6.9 local publica API mínima, PDP de disponibilidad y rechaza producción", async () => {
  const base = await baseCatalog();
  const fixture = await privateFixture(base);
  const previous = {
    catalog: process.env.V69_CATALOG_FILE,
    exclusions: process.env.V69_EXCLUSIONS_FILE,
    required: process.env.V69_REQUIRE_EXCLUSIONS,
  };
  process.env.V69_CATALOG_FILE = CATALOG_FILE;
  process.env.V69_EXCLUSIONS_FILE = fixture.file;
  process.env.V69_REQUIRE_EXCLUSIONS = "1";
  resetCatalogV69CacheForTests();

  const server = app({ ...process.env, NODE_ENV: "test", V69_LOCAL_PREVIEW: "1" });
  const origin = await listen(server);
  try {
    const [catalogResponse, apiResponse, healthResponse, appResponse, cssResponse] = await Promise.all([
      fetch(`${origin}/catalogo-v6-9/`),
      fetch(`${origin}/api/catalog-v6-9`),
      fetch(`${origin}/api/catalog-v6-9/health`),
      fetch(`${origin}/app-v6-9.js`),
      fetch(`${origin}/styles-v6-9.css`),
    ]);
    assert.equal(catalogResponse.status, 200);
    assert.equal(apiResponse.status, 200);
    assert.equal(healthResponse.status, 200);
    assert.equal(appResponse.status, 200);
    assert.equal(cssResponse.status, 200);
    assert.equal(apiResponse.headers.get("cache-control"), "no-store");
    assert.equal(healthResponse.headers.get("cache-control"), "no-store");

    const html = await catalogResponse.text();
    const apiText = await apiResponse.text();
    const health = await healthResponse.json() as ReturnType<typeof catalogHealthV69>;
    const appSource = await appResponse.text();
    const api = JSON.parse(apiText) as ReturnType<typeof publicCatalogV69>;
    assert.equal(api.totalProducts, 686);
    assert.deepEqual(api.availabilitySummary, { available: 672, unavailable: 6, unverified: 8 });
    assert.deepEqual(Object.keys(api).sort(), [
      "availabilityReferenceAt",
      "availabilitySummary",
      "commerceSyncedAt",
      "products",
      "syncedAt",
      "totalProducts",
      "version",
    ]);
    const productKeys = [
      "aliases",
      "availability",
      "availabilityCheckedAt",
      "brand",
      "discountPercent",
      "images",
      "line",
      "listPrice",
      "name",
      "needs",
      "offerPrice",
      "primaryCategory",
      "publicId",
      "savingAmount",
      "slug",
    ];
    assert.ok(
      api.products.every((product) => {
        assert.deepEqual(Object.keys(product).sort(), productKeys);
        return !["description", "detail", "source", "provider", "sku", "barcode", "syncedAt", "taxonomy"].some(
          (key) => key in product,
        );
      }),
    );
    assert.doesNotMatch(apiText, /gpsfarma|provider|barcode|"sku"|"source"/i);
    assert.equal(health.status, "ready");
    assert.equal(health.totalProducts, 686);
    assert.deepEqual(health.availabilitySummary, { available: 672, unavailable: 6, unverified: 8 });
    assert.doesNotMatch(html, /gpsfarma/i);
    assert.doesNotMatch(appSource, /gpsfarma/i);
    assert.doesNotMatch(catalogResponse.headers.get("content-security-policy") || "", /gpsfarma|unsafe-inline/i);
    assert.match(html, /id="availabilityV69"/);
    assert.match(html, /id="sortV69" name="orden"/);

    const unavailable = api.products.find((product) => product.availability === "unavailable_reference");
    assert.ok(unavailable);
    const pdpResponse = await fetch(`${origin}/producto-v6-9/${unavailable.slug}/`);
    assert.equal(pdpResponse.status, 200);
    const pdp = await pdpResponse.text();
    assert.match(pdp, /class="v69-stock is-unavailable is-pdp"/);
    assert.match(pdp, /Consultar disponibilidad o alternativa/);
    assert.doesNotMatch(pdp, /gpsfarma|provider|barcode|"sku"|"source"/i);
    assert.match(pdp, new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/producto-v6-9/`));
  } finally {
    await close(server);
  }

  const production = app({ ...process.env, NODE_ENV: "production", V69_LOCAL_PREVIEW: "1" });
  const productionOrigin = await listen(production);
  try {
    const response = await fetch(`${productionOrigin}/catalogo-v6-9/`);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /únicamente como revisión local/);
  } finally {
    await close(production);
    if (previous.catalog === undefined) delete process.env.V69_CATALOG_FILE;
    else process.env.V69_CATALOG_FILE = previous.catalog;
    if (previous.exclusions === undefined) delete process.env.V69_EXCLUSIONS_FILE;
    else process.env.V69_EXCLUSIONS_FILE = previous.exclusions;
    if (previous.required === undefined) delete process.env.V69_REQUIRE_EXCLUSIONS;
    else process.env.V69_REQUIRE_EXCLUSIONS = previous.required;
    resetCatalogV69CacheForTests();
    await rm(fixture.directory, { recursive: true, force: true });
  }

  assert.equal(catalogReadyForRuntimeV69(base, { NODE_ENV: "test", V69_LOCAL_PREVIEW: "1" }), true);
  assert.equal(catalogReadyForRuntimeV69(base, { NODE_ENV: "production", V69_LOCAL_PREVIEW: "1" }), false);
  assert.equal(sourceImageBridgeEnabled({ NODE_ENV: "production", V69_LOCAL_PREVIEW: "1" }), false);
});
