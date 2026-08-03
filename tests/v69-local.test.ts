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
  homePageV69,
  productPageV69,
  publicCatalogV69,
  searchTextV69,
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
const SORTS: SortV69[] = ["relevancia", "disponibilidad", "descuento", "precio-asc", "precio-desc", "nombre"];

async function baseCatalog() {
  resetCatalogV69CacheForTests();
  return catalogV69Data({
    ...process.env,
    V69_CATALOG_FILE: CATALOG_FILE,
    V69_EXCLUSIONS_FILE: path.join(tmpdir(), "farmagreen-v69-no-exclusions.json"),
  });
}

function availabilityCounts(products: Pick<ProductV69, "availability">[]) {
  return products.reduce(
    (counts, product) => {
      counts[product.availability] += 1;
      return counts;
    },
    { limited: 0, out_of_stock: 0, unknown: 0 },
  );
}

function publicAvailabilitySummary(products: Array<{ availability: string }>) {
  return products.reduce(
    (summary, product) => {
      if (product.availability === "available_reference" || product.availability === "limited") {
        summary.available += 1;
      } else if (product.availability === "unavailable_reference" || product.availability === "out_of_stock") {
        summary.unavailable += 1;
      } else {
        summary.unverified += 1;
      }
      return summary;
    },
    { available: 0, unavailable: 0, unverified: 0 },
  );
}

test("V6.9 trata FPS como atributo y conserva la intención principal explícita", async () => {
  const catalog = await baseCatalog();
  const revised = catalog.products.filter(
    (product) => (product.taxonomy as { reasonerVersion?: string } | undefined)?.reasonerVersion === "v69.1-fps-primary-intent",
  );
  assert.equal(revised.length, 27);
  assert.deepEqual(
    revised.reduce<Record<string, number>>((counts, product) => {
      counts[product.needs[0]] = (counts[product.needs[0]] || 0) + 1;
      return counts;
    }, {}),
    { manchas: 3, antiedad: 15, hidratacion: 9 },
  );
  assert.ok(revised.every((product) => product.primaryCategory === "rostro" && !product.needs.includes("solares")));

  const antiPigment = catalog.products.find((product) => product.publicId === "4415c97e870c");
  const antiAge = catalog.products.find((product) => product.publicId === "d619540a5259");
  const hydration = catalog.products.find((product) => product.publicId === "4919a122cd84");
  const trueSolar = catalog.products.find((product) => product.publicId === "43e4da205cb5");
  assert.deepEqual(antiPigment?.needs, ["manchas"]);
  assert.deepEqual(antiAge?.needs, ["antiedad"]);
  assert.deepEqual(hydration?.needs, ["hidratacion"]);
  assert.deepEqual(trueSolar?.needs, ["solares"]);
  assert.equal(trueSolar?.primaryCategory, "solares");
});

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
      schemaVersion: 2,
      notes: "fixture privado temporal",
      products: [{ sku: privateSku, barcode: privateBarcode, url: privateUrl }],
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
    products?: Array<Record<string, unknown>>;
    totalProducts?: number;
    dataEndpoint?: string;
  };
}

function firstGridProductId(html: string) {
  const grid = html.match(/<section class="v65-grid" id="gridV69">([\s\S]*?)<\/section>/)?.[1] || "";
  const publicId = grid.match(/href="\/p\/([^/"]+)"/)?.[1];
  assert.ok(publicId, "La grilla SSR V6.9 no contiene productos.");
  return publicId;
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

test("V6.9 conserva las 688 fichas y sus métricas coinciden con el snapshot local", async () => {
  const raw = JSON.parse(await readFile(CATALOG_FILE, "utf8")) as {
    products: ProductV69[];
    commerceSync?: { metrics?: Record<string, number> };
  };
  assert.equal(raw.products.length, 688);
  const availability = availabilityCounts(raw.products);
  assert.equal(availability.limited + availability.out_of_stock + availability.unknown, raw.products.length);
  assert.equal(raw.commerceSync?.metrics?.catalogProducts, 688);
  assert.equal(raw.commerceSync?.metrics?.available, availability.limited);
  assert.equal(raw.commerceSync?.metrics?.unavailable, availability.out_of_stock);
  assert.equal(raw.commerceSync?.metrics?.unverified, availability.unknown);
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

    const availability = availabilityCounts(visible.products);
    assert.equal(availability.limited + availability.out_of_stock + availability.unknown, visible.products.length);

    const rules = await loadExclusionsV69(fixture.file, true);
    assert.deepEqual(rules.products, [{ sku: fixture.privateSku, barcode: fixture.privateBarcode, url: fixture.privateUrl }]);
    const sample = base.products.find((product) => !fixture.excludedIds.includes(product.publicId));
    assert.ok(sample);
    assert.equal(isExcludedV69({ ...sample, sku: ` ${fixture.privateSku} ` }, rules), true);
    assert.equal(isExcludedV69({ ...sample, barcode: "00-0000-0000-69" }, rules), true);

    const publicCatalog = publicCatalogV69(visible);
    assert.equal(publicCatalog.totalProducts, 686);
    assert.deepEqual(publicCatalog.availabilitySummary, publicAvailabilitySummary(visible.products));
    const serialized = JSON.stringify(publicCatalog);
    for (const secret of [fixture.privateSku, fixture.privateBarcode, fixture.privateUrl]) {
      assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(serialized, /gpsfarma|provider|"sku"|"source"/i);
    assert.ok(publicCatalog.products.every((product) => typeof product.barcode === "string"));
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

test("la ficha desktop puede mostrar código de barras sin publicar el SKU privado", async () => {
  const catalog = await baseCatalog();
  const sample = catalog.products.find((product) => product.availability === "limited");
  assert.ok(sample);
  const html = productPageV69(
    { ...sample, barcode: "7790000000069", sku: "SKU-PRIVADO-NO-PUBLICAR" },
    [],
    "http://127.0.0.1:8109",
  );
  assert.match(html, /class="v69-barcode"><span>Código de barras<\/span><strong>7790000000069<\/strong>/);
  assert.doesNotMatch(html, /SKU-PRIVADO-NO-PUBLICAR|class="v69-sku"/);
  assert.match(searchTextV69({ ...sample, barcode: "7790000000069" }), /7790000000069/);
});

test("SSR V6.9 respeta los seis órdenes y mantiene marca/necesidad mutuamente exclusivas", async () => {
  const catalog = await baseCatalog();
  const defaultHtml = catalogPageV69(
    catalog,
    new URLSearchParams({ scope: "todo" }),
    "http://127.0.0.1:8109",
  );
  assert.equal(bootPayload(defaultHtml).context.sort, "descuento");
  assert.match(defaultHtml, /<option value="descuento" selected>Descuento<\/option>/);
  assert.match(defaultHtml, /id="catalogTitleV69" class="v69-title-all">Todos los productos<\/h1>/);

  for (const sort of SORTS) {
    const html = catalogPageV69(
      catalog,
      new URLSearchParams({ scope: "todo", orden: sort }),
      "http://127.0.0.1:8109",
    );
    assert.equal(bootPayload(html).context.sort, sort);
    assert.equal(firstGridProductId(html), sortProductsV69(catalog.products, sort)[0].publicId, sort);
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

test("la home V6.9 organiza dos filas por marca con disponibilidad primero", async () => {
  const catalog = await baseCatalog();
  const html = homePageV69(catalog, "http://127.0.0.1:8109");
  const brands = [...new Set(catalog.products.map((product) => product.brand.name))];
  assert.equal((html.match(/class="v69-home-brand"/g) || []).length, brands.length);
  assert.equal((html.match(/class="v65-grid v69-home-grid"/g) || []).length, brands.length);
  assert.equal((html.match(/class="v66-card(?: |")/g) || []).length, brands.length * 10);
  assert.match(html, /id="buscar-v69"/);
  assert.match(html, /<span>Buscá como<\/span> <span>hablás<\/span>/);
  assert.match(html, /id="needSummaryV69">Todas<\/strong>/);
  assert.match(html, new RegExp(`id="brandSummaryV69">Todas · ${catalog.totalProducts}<\\/strong>`));
  assert.match(html, /id="sortV69" name="orden"/);
  assert.match(html, /Ver toda la marca/);
  assert.match(
    html,
    /<meta property="og:description" content="Farmacia y Dermocosmetica, Catalogo de Precios y Promociones">/,
  );
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/farmagreenrosario\.web\.app\/farmagreen-social-preview-v69-social-2\.png">/,
  );
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
  assert.match(html, /<meta property="og:image:type" content="image\/png">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.doesNotMatch(html, /gpsfarma|provider|"sku"|"source"/i);

  for (const brand of brands) {
    const brandProducts = sortProductsV69(
      catalog.products.filter((product) => product.brand.name === brand),
      "disponibilidad",
    );
    const sectionStart = html.indexOf(`id="marca-${brandProducts[0].brand.slug}"`);
    const sectionEnd = html.indexOf('<section class="v69-home-brand"', sectionStart + 1);
    const section = html.slice(sectionStart, sectionEnd < 0 ? undefined : sectionEnd);
    assert.match(section, new RegExp(`/p/${brandProducts[0].publicId}`), brand);
    assert.equal((section.match(/class="v66-card(?: |")/g) || []).length, 10, brand);
  }
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
    const [rootResponse, homeResponse, catalogAliasResponse, catalogResponse, apiResponse, healthResponse, appResponse, cssResponse, socialImageResponse] = await Promise.all([
      fetch(`${origin}/`),
      fetch(`${origin}/inicio-v6-9/`),
      fetch(`${origin}/catalogo/`),
      fetch(`${origin}/catalogo-v6-9/`),
      fetch(`${origin}/api/catalog-v6-9`),
      fetch(`${origin}/api/catalog-v6-9/health`),
      fetch(`${origin}/app-v6-9.js`),
      fetch(`${origin}/styles-v6-9.css`),
      fetch(`${origin}/farmagreen-social-preview-v69-social-2.png`),
    ]);
    assert.equal(rootResponse.status, 200);
    assert.equal(homeResponse.status, 200);
    assert.equal(catalogAliasResponse.status, 200);
    assert.equal(catalogResponse.status, 200);
    assert.equal(apiResponse.status, 200);
    assert.equal(healthResponse.status, 200);
    assert.equal(appResponse.status, 200);
    assert.equal(cssResponse.status, 200);
    assert.equal(socialImageResponse.status, 200);
    assert.equal(socialImageResponse.headers.get("content-type"), "image/png");
    assert.equal(apiResponse.headers.get("cache-control"), "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
    assert.equal(healthResponse.headers.get("cache-control"), "no-store");

    const root = await rootResponse.text();
    const home = await homeResponse.text();
    const html = await catalogResponse.text();
    const apiText = await apiResponse.text();
    const health = await healthResponse.json() as ReturnType<typeof catalogHealthV69>;
    const appSource = await appResponse.text();
    const api = JSON.parse(apiText) as ReturnType<typeof publicCatalogV69>;
    assert.equal(api.totalProducts, base.products.length - fixture.excludedIds.length);
    assert.deepEqual(api.availabilitySummary, publicAvailabilitySummary(api.products));
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
      "barcode",
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
        return !["description", "detail", "source", "provider", "sku", "syncedAt", "taxonomy"].some(
          (key) => key in product,
        );
      }),
    );
    assert.doesNotMatch(apiText, /gpsfarma|provider|"sku"|"source"/i);
    assert.ok(api.products.every((product) => typeof product.barcode === "string"));
    assert.equal(health.status, "ready");
    assert.equal(health.totalProducts, 686);
    assert.deepEqual(health.availabilitySummary, publicAvailabilitySummary(api.products));
    assert.doesNotMatch(html, /gpsfarma/i);
    assert.match(home, /class="v69-home-sections"/);
    assert.match(root, /class="v69-home-sections"/);
    assert.match(root, /<meta name="robots" content="index,follow">/);
    assert.match(root, /id="marca-eucerin"/);
    assert.ok(
      root.indexOf('id="marca-eucerin"') < root.indexOf('id="marca-dermaglos"'),
      "La home definitiva debe comenzar por Eucerin y conservar las marcas apiladas.",
    );
    assert.match(root, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/">/);
    assert.match(root, /Farmacia y Dermocosmetica, Catalogo de Precios y Promociones/);
    assert.match(root, /farmagreen-social-preview-v69-social-2\.png/);
    assert.doesNotMatch(root, /"products":\[/);
    assert.doesNotMatch(html, /"products":\[/);
    assert.equal(bootPayload(root).totalProducts, api.totalProducts);
    assert.equal(bootPayload(html).dataEndpoint, "/api/catalog-v6-9");
    assert.ok(Buffer.byteLength(root) < 250_000, "La home no debe volver a incrustar el catálogo completo.");
    assert.ok(Buffer.byteLength(html) < 180_000, "El catálogo no debe volver a incrustar todos los productos.");
    assert.match(root, /<meta property="og:image:width" content="1200">/);
    assert.match(root, /<meta property="og:image:height" content="630">/);
    assert.match(root, /class="brandmark"/);
    assert.match(root, /class="brandmark"[^>]*>/);
    assert.match(home, /class="v69-home-sections" id="marcas-inicio-v69"/);
    assert.doesNotMatch(home, /v69-home-brand-index/);
    assert.doesNotMatch(home, /gpsfarma|provider|"sku"|"source"/i);
    assert.doesNotMatch(appSource, /gpsfarma/i);
    assert.doesNotMatch(catalogResponse.headers.get("content-security-policy") || "", /gpsfarma|unsafe-inline/i);
    assert.match(html, /id="availabilityV69"/);
    assert.match(html, /id="sortV69" name="orden"/);

    const unavailable = api.products.find((product) => product.availability === "unavailable_reference");
    assert.ok(unavailable);
    const pdpResponse = await fetch(`${origin}/p/${unavailable.publicId}/`);
    assert.equal(pdpResponse.status, 200);
    const pdp = await pdpResponse.text();
    assert.match(pdp, /class="v69-stock is-unavailable is-pdp"/);
    assert.match(pdp, /Consultar Disponibilidad/);
    assert.match(pdp, /class="cta v69-ask-unavailable"[^>]*>Consultar<\/a>/);
    assert.match(pdp, /Consulta Personalizada por WhatsApp\./);
    assert.match(pdp, /Coordinamos Retiro o Envío, Consultar formas de Pago\./);
    assert.doesNotMatch(pdp, /gpsfarma|provider|"sku"|"source"/i);
    assert.match(pdp, new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/p/${unavailable.publicId}`));
    assert.match(pdp, /class="brandmark"/);
  } finally {
    await close(server);
  }

  const production = app({ ...process.env, NODE_ENV: "production", V69_LOCAL_PREVIEW: "1" });
  const productionOrigin = await listen(production);
  try {
    const response = await fetch(`${productionOrigin}/catalogo-v6-9/`);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /todavía no está habilitada/);
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
  const productionReady = {
    ...base,
    version: 6.9 as const,
    commerceSyncedAt: "2026-08-03T10:00:00.000Z",
    products: base.products.map((product) => ({
      ...product,
      availability: "limited" as const,
      availabilityCheckedAt: "2026-08-03T10:00:00.000Z",
      images: {
        ...product.images,
        card: "https://storage.googleapis.com/farmagreen-catalog-images/v69/card.jpg",
        detail: "https://storage.googleapis.com/farmagreen-catalog-images/v69/detail.jpg",
      },
    })),
  };
  assert.equal(
    catalogReadyForRuntimeV69(productionReady, {
      NODE_ENV: "production",
      V69_ENABLE_PRODUCTION: "1",
      PUBLIC_ORIGIN: "https://farmagreen-v69-preprod.example",
    }),
    true,
  );
  assert.equal(sourceImageBridgeEnabled({ NODE_ENV: "production", V69_LOCAL_PREVIEW: "1" }), false);
});
