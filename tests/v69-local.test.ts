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
  filterProductsBySearchV69,
  homePageV69,
  isSearchQueryReadyV69,
  normalizeQueryTermsV69,
  productPageV69,
  publicCatalogV69,
  robotsTxtV69,
  searchTextV69,
  sitemapLastmodV69,
  sitemapXmlV69,
  sortProductsV69,
  validGtinV69,
  type SortV69,
} from "../src/render-v69.js";
import { app } from "../src/server.js";
import {
  catalogHealthV69,
  catalogReadyForRuntimeV69,
  normalizeMetaEventV69,
  responsiveImagesReadyV691,
  schedulerIdempotencyKeyV69,
  sourceImageBridgeEnabled,
} from "../src/server-v69.js";
import {
  applyCatalogPolicyV69,
  defaultCatalogPolicyV69,
  navigationBrandsV69,
} from "../src/catalog-policy-v69.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog-v69.json");
const SORTS: SortV69[] = ["relevancia", "marca", "disponibilidad", "sin-stock", "descuento", "precio-asc", "precio-desc", "nombre"];

test("V6.9 normaliza eventos CAPI sin aceptar orígenes, eventos ni datos arbitrarios", () => {
  const normalized = normalizeMetaEventV69(
    {
      event_name: "CatalogFilterSelect",
      event_time: 1_787_350_000,
      event_id: "fg-v69:test-1",
      event_source_url: "https://farmagreenrosario.web.app/catalogo?scope=todo",
      fbp: "fb.1.1787350000000.123456789",
      fbc: "fb.1.1787350000000.Abc-123_xyz",
      custom_data: {
        filter_type: "order",
        filter_value: "precio-asc",
        ignored_private_field: "no debe salir",
      },
    },
    "https://farmagreenrosario.web.app",
    1_787_350_000,
  );
  assert.equal(normalized.event_name, "CatalogFilterSelect");
  assert.equal(normalized.event_id, "fg-v69:test-1");
  assert.equal(normalized.action_source, "website");
  assert.deepEqual(normalized.custom_data, { filter_value: "precio-asc", filter_type: "order" });
  assert.throws(
    () => normalizeMetaEventV69({ ...normalized, event_source_url: "https://example.com/" }, "https://farmagreenrosario.web.app"),
    /Origen de evento inválido/,
  );
  assert.throws(
    () => normalizeMetaEventV69({ ...normalized, event_name: "Purchase" }, "https://farmagreenrosario.web.app"),
    /Evento no permitido/,
  );
});

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
          reason: "Discontinuado",
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
    magentoCategoryPaths?: Record<string, string[]>;
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

function structuredData(html: string) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) =>
    JSON.parse(match[1]) as Record<string, unknown>,
  );
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

test("cada horario del Scheduler tiene identidad propia y la ausencia de horario no bloquea futuras corridas", () => {
  const request = (headers: Record<string, string>) =>
    ({ headers }) as Parameters<typeof schedulerIdempotencyKeyV69>[0];
  const jobName = "projects/test/locations/test/jobs/fg-v69-preprod-sync-0700-art";

  assert.equal(
    schedulerIdempotencyKeyV69(request({
      "x-cloudscheduler-jobname": jobName,
      "x-cloudscheduler-schedule-time": "2026-08-13T10:00:00Z",
    })),
    `${jobName}|2026-08-13T10:00:00Z`,
  );
  assert.equal(
    schedulerIdempotencyKeyV69(request({
      "x-cloudscheduler-jobname": jobName,
      "x-cloudscheduler-schedule-time": "2026-08-13T17:00:00Z",
    })),
    `${jobName}|2026-08-13T17:00:00Z`,
  );
  assert.equal(schedulerIdempotencyKeyV69(request({ "x-cloudscheduler-jobname": jobName })), "");
  assert.equal(
    schedulerIdempotencyKeyV69(request({ "x-cloudscheduler-schedule-time": "2026-08-13T17:00:00Z" })),
    "",
  );
});

test("V6.9 conserva el snapshot completo y sus métricas coinciden con sus fichas", async () => {
  const raw = JSON.parse(await readFile(CATALOG_FILE, "utf8")) as {
    products: ProductV69[];
    commerceSync?: { metrics?: Record<string, number> };
  };
  assert.ok(raw.products.length >= 688);
  const availability = availabilityCounts(raw.products);
  assert.equal(availability.limited + availability.out_of_stock + availability.unknown, raw.products.length);
  assert.equal(raw.commerceSync?.metrics?.catalogProducts, raw.products.length);
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
    assert.equal(visible.products.length, base.products.length - fixture.excludedIds.length);
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
    assert.equal(publicCatalog.totalProducts, visible.products.length);
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

test("el buscador semántico se activa con tres caracteres en la primera palabra útil", async () => {
  const catalog = await baseCatalog();
  const matches = (query: string) => filterProductsBySearchV69(catalog.products, query);
  const ids = (query: string) => matches(query).map((product) => product.publicId).sort();

  assert.equal(isSearchQueryReadyV69("cr"), false);
  assert.equal(isSearchQueryReadyV69("la cr"), false);
  assert.equal(isSearchQueryReadyV69("cre"), true);
  assert.equal(isSearchQueryReadyV69("la crema"), true);
  assert.equal(isSearchQueryReadyV69("ENA"), true);
  assert.equal(isSearchQueryReadyV69("LRP"), true);
  assert.equal(isSearchQueryReadyV69("7790000000069"), true);
  assert.equal(matches("cr").length, 0);
  assert.deepEqual(normalizeQueryTermsV69("crema par arruga"), ["crema", "arruga"]);
  assert.deepEqual(normalizeQueryTermsV69("crema gel b5 50"), ["crema", "gel", "b5", "50"]);
  assert.deepEqual(ids("crema par arruga"), ids("crema arruga"));
  assert.ok(matches("crema par arruga").length > 0);
  assert.ok(matches("cre").length > 0);
  assert.deepEqual(ids("Vichi"), ids("Vichy"));
  assert.deepEqual(ids("Vichg"), ids("Vichy"));

  const powder = matches("colageno polvo");
  assert.ok(powder.length >= 2);
  assert.ok(powder.every((product) => product.needs.includes("nutricion")));
  assert.ok(powder.every((product) => /\b\d+(?:[.,]\d+)?\s*(g|gr|grs|kg)\b/i.test(product.name)));
  assert.ok(powder.every((product) => !/(caps|comprim|tableta|sobre|gomita|unidad)/i.test(product.name)));

  const bodyMoisturizers = matches("crema hidratante para el cuerpo");
  assert.ok(bodyMoisturizers.length > 0);
  assert.ok(bodyMoisturizers.some((product) => /loción corporal hidratante/i.test(product.name)));
  assert.ok(bodyMoisturizers.every((product) => !product.needs.includes("nutricion")));

  const antiAge = ids("arrugas");
  assert.ok(antiAge.length > 0);
  assert.deepEqual(ids("arrug"), antiAge);
  assert.deepEqual(ids("lineas de expresion"), antiAge);
  assert.deepEqual(ids("flex"), antiAge);

  const scars = ids("cicatrices");
  assert.ok(scars.length > 0);
  assert.deepEqual(ids("marcas"), scars);

  const drySkin = ids("piel reseca");
  assert.ok(drySkin.length > 0);
  assert.deepEqual(ids("agriatado"), ids("seco"));
  assert.deepEqual(ids("reseco"), ids("seco"));

  const serumWrinkles = matches("serum arrugas");
  assert.ok(serumWrinkles.length > 0);
  assert.ok(
    serumWrinkles.every((product) =>
      /(serum|sérum|suero|concentr|booster|ampolla)/i.test(`${product.name} ${product.line}`),
    ),
  );

  assert.equal(matches("protetor solar bebe").length, 2);
  assert.equal(matches("infantil").length, 5);
});

test("V6.9.1 publica imágenes responsivas con dimensiones y prioridad sólo para la primera", async () => {
  const catalog = await baseCatalog();
  const responsive = {
    width: 1000,
    height: 1000,
    webp: {
      "320": "https://storage.googleapis.com/farmagreen-catalog-images/v69/sample-320.webp",
      "640": "https://storage.googleapis.com/farmagreen-catalog-images/v69/sample-640.webp",
    },
    avif: {
      "320": "https://storage.googleapis.com/farmagreen-catalog-images/v69/sample-320.avif",
      "640": "https://storage.googleapis.com/farmagreen-catalog-images/v69/sample-640.avif",
    },
  };
  const prepared = {
    ...catalog,
    products: catalog.products.map((product) => ({
      ...product,
      images: { ...product.images, responsive: { card: responsive, detail: responsive } },
    })),
  };
  const html = catalogPageV69(prepared, new URLSearchParams({ scope: "todo" }), "https://farmagreenrosario.web.app");
  assert.match(html, /<source type="image\/avif" srcset="[^"]+320w, [^"]+640w" sizes="[^"]+">/);
  assert.match(html, /<source type="image\/webp" srcset="[^"]+320w, [^"]+640w" sizes="[^"]+">/);
  assert.match(html, /<img [^>]*width="1000" height="1000"[^>]*loading="eager" fetchpriority="high">/);
  assert.match(html, /<img [^>]*width="1000" height="1000"[^>]*loading="lazy">/);
  const api = publicCatalogV69(prepared);
  assert.deepEqual(api.products[0].images.responsive?.card, responsive);
});

test("SSR V6.9 respeta los órdenes, filtra sin stock y mantiene marca/necesidad mutuamente exclusivas", async () => {
  const catalog = await baseCatalog();
  const defaultHtml = catalogPageV69(
    catalog,
    new URLSearchParams({ scope: "todo" }),
    "http://127.0.0.1:8109",
  );
  assert.equal(bootPayload(defaultHtml).context.sort, "relevancia");
  assert.match(defaultHtml, /<option value="relevancia" selected>Relevancia<\/option>/);
  assert.match(defaultHtml, /id="catalogTitleV69" class="v69-title-all">Todos los productos<\/h1>/);

  for (const sort of SORTS) {
    const html = catalogPageV69(
      catalog,
      new URLSearchParams({ scope: "todo", orden: sort }),
      "http://127.0.0.1:8109",
    );
    assert.equal(bootPayload(html).context.sort, sort);
    const sortable = sort === "sin-stock"
      ? catalog.products.filter((product) => product.availability === "out_of_stock")
      : catalog.products;
    assert.equal(firstGridProductId(html), sortProductsV69(sortable, sort)[0].publicId, sort);
    if (sort === "sin-stock") {
      assert.equal(bootPayload(html).context.scope, "todo");
      assert.match(html, /id="catalogTitleV69">Sin stock<\/h1>/);
      assert.doesNotMatch(html, /Disponible para Entrega/);
    }
    assert.match(html, /id="sortV69" name="orden"/);
    assert.match(html, /app-v6-9-11\.js/);
    assert.match(html, /styles-v6-9-2\.css/);
    assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1);
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

test("Productos Saludables se integra como paraguas y preserva las marcas legacy", async () => {
  const base = await baseCatalog();
  const selected = {
    ...base.products[0],
    brand: { id: "6312", slug: "vitamin-way", name: "Vitamin Way", aliases: ["vitamin way"] },
    catalogFacets: [{
      slug: "productos-saludables",
      name: "Productos Saludables",
      aliases: ["saludables"],
      kind: "collection" as const,
    }],
  };
  const other = { ...base.products[1], publicId: "outside-view", catalogFacets: [] };
  const catalog = { ...base, totalProducts: 2, products: [selected, other] };
  const html = catalogPageV69(
    catalog,
    new URLSearchParams({ scope: "todo", view: "productos-saludables" }),
    "http://127.0.0.1:8109",
  );
  assert.equal(bootPayload(html).context.view, "productos-saludables");
  assert.equal(firstGridProductId(html), selected.publicId);
  assert.match(html, /class="v67-brand-option on"[^>]*data-view="productos-saludables"/);
  assert.match(html, /<strong>Productos Saludables<\/strong><small>1 productos · paraguas<\/small>/);
  assert.doesNotMatch(html, /Vistas vivas/);
  const api = publicCatalogV69(catalog);
  assert.deepEqual(api.products[0].catalogViews, [{
    slug: "productos-saludables",
    name: "Productos Saludables",
    kind: "collection",
  }]);
  assert.equal(api.products[0].brand.name, "Vitamin Way");
  assert.equal(api.navigation.brands.at(-1)?.name, "Productos Saludables");
});

test("la búsqueda por ID de categoría muestra únicamente su ruta jerárquica pura", async () => {
  const catalog = await baseCatalog();
  const html = catalogPageV69(
    catalog,
    new URLSearchParams({ scope: "todo", q: "6380", orden: "disponibilidad" }),
    "http://127.0.0.1:8109",
  );
  assert.match(html, /id="catalogTitleV69">Cuidado de la Piel › Faciales<\/h1>/);
  assert.match(html, /id="modeV69" hidden><\/p>/);
  assert.doesNotMatch(html, /Resultados para [“\"]6380/);
  assert.doesNotMatch(html, />CATEGORÍAS › Cuidado de la Piel/);
  assert.deepEqual(bootPayload(html).magentoCategoryPaths?.["6380"], ["Cuidado de la Piel", "Faciales"]);
  assert.deepEqual(publicCatalogV69(catalog).magentoCategoryPaths["6380"], ["Cuidado de la Piel", "Faciales"]);

  const regular = catalogPageV69(catalog, new URLSearchParams({ scope: "todo", q: "hidratante" }));
  assert.match(regular, /Resultados para “hidratante”/);
});

test("la home V6.9 organiza dos filas por marca con disponibilidad primero", async () => {
  const catalog = await baseCatalog();
  const html = homePageV69(catalog, "http://127.0.0.1:8109");
  assert.equal((html.match(/class="v69-home-brand"/g) || []).length, 16);
  assert.equal((html.match(/class="v65-grid v69-home-grid"/g) || []).length, 16);
  assert.equal((html.match(/class="v66-card(?: |")/g) || []).length, 150);
  assert.match(html, /<p class="v65-k">Paraguas<\/p><h2[^>]*>Productos Saludables<\/h2>/);
  assert.match(html, /id="buscar-v69"/);
  assert.match(html, /<span>Buscá<\/span> <span>como<\/span> <span>hablás<\/span>/);
  assert.match(html, /id="needSummaryV69">Todas<\/strong>/);
  assert.match(html, /<span class="v67-menu-label">Elegir Marca<\/span>\s*<strong id="brandSummaryV69">Todas<\/strong>/);
  assert.doesNotMatch(html, /id="brandSummaryV69">[^<]*·\s*\d+/);
  assert.match(html, /id="sortV69" name="orden"/);
  assert.match(html, /data-filter-menu-trigger="need"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /id="needMenuV69" data-filter-menu-popover[^>]*role="dialog"/);
  assert.match(html, /data-filter-menu-trigger="brand"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /id="brandMenuV69" data-filter-menu-popover[^>]*role="dialog"/);
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
  assert.match(html, /<h1 class="v67-visually-hidden">Farmagreen Rosario: catálogo de precios y promociones<\/h1>/);
  assert.match(html, /class="v69-footer"/);
  assert.match(html, /Bv\. Avellaneda Bis 524, Rosario, Santa Fe/);
  assert.match(html, /Horarios: consultá por WhatsApp/);
  const pharmacy = structuredData(html).find((entry) => entry["@type"] === "Pharmacy");
  assert.ok(pharmacy);
  assert.equal(pharmacy.name, "Farmagreen Rosario");
  assert.deepEqual(pharmacy.address, {
    "@type": "PostalAddress",
    streetAddress: "Bv. Avellaneda Bis 524",
    addressLocality: "Rosario",
    addressRegion: "Santa Fe",
    addressCountry: "AR",
  });
  assert.equal("openingHours" in pharmacy, false);
  assert.doesNotMatch(html, /gpsfarma|provider|"sku"|"source"/i);

  const policy = defaultCatalogPolicyV69();
  const presented = applyCatalogPolicyV69(catalog, policy);
  for (const brand of navigationBrandsV69(catalog, policy)) {
    const brandProducts = sortProductsV69(
      presented.products.filter((product) => brand.kind === "collection"
        ? (product.catalogFacets || []).some((entry) => entry.kind === "collection" && entry.slug === brand.slug)
        : product.brand.name === brand.name),
      "disponibilidad",
    );
    const sectionStart = html.indexOf(`id="${brand.kind === "collection" ? "coleccion" : "marca"}-${brand.slug}"`);
    const sectionEnd = html.indexOf('<section class="v69-home-brand"', sectionStart + 1);
    const section = html.slice(sectionStart, sectionEnd < 0 ? undefined : sectionEnd);
    if (brandProducts.length) assert.match(section, new RegExp(`/p/${brandProducts[0].publicId}`), brand.name);
    assert.equal((section.match(/class="v66-card(?: |")/g) || []).length, Math.min(10, brandProducts.length), brand.name);
  }
});

test("V6.9.1 publica robots y un sitemap completo con fecha de sincronización", async () => {
  const catalog = await baseCatalog();
  const origin = "https://farmagreenrosario.web.app";
  const robots = robotsTxtV69(origin);
  const sitemap = sitemapXmlV69(catalog, origin);
  assert.equal(robots, `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  assert.equal((sitemap.match(/<url>/g) || []).length, catalog.products.length + 2);
  assert.equal((sitemap.match(/<loc>/g) || []).length, catalog.products.length + 2);
  assert.match(sitemap, new RegExp(`<loc>${origin}/<\\/loc>`));
  assert.match(sitemap, new RegExp(`<loc>${origin}/catalogo<\\/loc>`));
  assert.ok(catalog.products.every((product) => sitemap.includes(`<loc>${origin}/p/${product.publicId}</loc>`)));
  assert.equal((sitemap.match(new RegExp(`<lastmod>${sitemapLastmodV69(catalog)}</lastmod>`, "g")) || []).length, catalog.products.length + 2);
});

test("V6.9.1 valida GTIN antes de publicarlo como dato estructurado", () => {
  assert.deepEqual(validGtinV69("4005800269776"), { key: "gtin13", value: "4005800269776" });
  assert.equal(validGtinV69("4005800269777"), null);
  assert.equal(validGtinV69("123"), null);
});

test("V6.9.1 consolida los cuatro CSS y conserva la paleta visual aprobada", async () => {
  const css = await readFile(path.join(ROOT, "public", "styles-v6-9-1.css"), "utf8");
  const markers = ["styles-v6-5.css", "styles-v6-6.css", "styles-v6-7.css", "styles-v6-9.css"];
  const positions = markers.map((marker) => css.indexOf(`/* ${marker} */`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.doesNotMatch(css, /@import\s/i);
  assert.match(css, /--v691-cta:#25d366/);
  assert.match(css, /--v691-badge:#ff5c2d/);
  assert.match(css, /background:var\(--v69-consult\)!important/);
  assert.match(css, /color:#fff!important/);
  assert.match(css, /:focus-visible/);
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
    const [rootResponse, homeResponse, catalogAliasResponse, catalogResponse, apiResponse, healthResponse, appResponse, analyticsResponse, metaPixelResponse, cssResponse, socialImageResponse, robotsResponse, sitemapResponse] = await Promise.all([
      fetch(`${origin}/`),
      fetch(`${origin}/inicio-v6-9/`),
      fetch(`${origin}/catalogo/`),
      fetch(`${origin}/catalogo-v6-9/`),
      fetch(`${origin}/api/catalog-v6-9`),
      fetch(`${origin}/api/catalog-v6-9/health`),
      fetch(`${origin}/app-v6-9-11.js`),
      fetch(`${origin}/analytics-v69-3.js`),
      fetch(`${origin}/meta-pixel-v69-2.js`),
      fetch(`${origin}/styles-v6-9-2.css`),
      fetch(`${origin}/farmagreen-social-preview-v69-social-2.png`),
      fetch(`${origin}/robots.txt`),
      fetch(`${origin}/sitemap.xml`),
    ]);
    assert.equal(rootResponse.status, 200);
    assert.equal(homeResponse.status, 200);
    assert.equal(catalogAliasResponse.status, 200);
    assert.equal(catalogResponse.status, 200);
    assert.equal(apiResponse.status, 200);
    assert.equal(healthResponse.status, 200);
    assert.equal(appResponse.status, 200);
    assert.equal(appResponse.headers.get("cache-control"), "no-store");
    assert.equal(analyticsResponse.status, 200);
    assert.equal(analyticsResponse.headers.get("cache-control"), "no-store");
    assert.equal(metaPixelResponse.status, 200);
    assert.equal(metaPixelResponse.headers.get("cache-control"), "no-store");
    assert.equal(cssResponse.status, 200);
    assert.equal(cssResponse.headers.get("cache-control"), "no-store");
    assert.equal(socialImageResponse.status, 200);
    assert.equal(robotsResponse.status, 200);
    assert.equal(sitemapResponse.status, 200);
    assert.equal(robotsResponse.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(sitemapResponse.headers.get("content-type"), "application/xml; charset=utf-8");
    assert.equal(robotsResponse.headers.get("cache-control"), "public, max-age=300, s-maxage=3600, stale-while-revalidate=300");
    assert.equal(sitemapResponse.headers.get("cache-control"), "public, max-age=300, s-maxage=3600, stale-while-revalidate=300");
    assert.equal(socialImageResponse.headers.get("content-type"), "image/png");
    assert.equal(apiResponse.headers.get("cache-control"), "public, max-age=0, s-maxage=60, stale-while-revalidate=30");
    assert.equal(healthResponse.headers.get("cache-control"), "no-store");

    const root = await rootResponse.text();
    const home = await homeResponse.text();
    const html = await catalogResponse.text();
    const apiText = await apiResponse.text();
    const health = await healthResponse.json() as ReturnType<typeof catalogHealthV69>;
    const appSource = await appResponse.text();
    const analyticsSource = await analyticsResponse.text();
    const metaPixelSource = await metaPixelResponse.text();
    const robots = await robotsResponse.text();
    const sitemap = await sitemapResponse.text();
    const api = JSON.parse(apiText) as ReturnType<typeof publicCatalogV69>;
    assert.equal(api.totalProducts, base.products.length - fixture.excludedIds.length);
    assert.deepEqual(api.availabilitySummary, publicAvailabilitySummary(api.products));
    assert.deepEqual(Object.keys(api).sort(), [
      "availabilityReferenceAt",
      "availabilitySummary",
      "commerceSyncedAt",
      "magentoCategoryPaths",
      "navigation",
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
      "catalogViews",
      "discountPercent",
      "images",
      "line",
      "listPrice",
      "magentoCategories",
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
    assert.equal(health.totalProducts, api.totalProducts);
    assert.deepEqual(health.availabilitySummary, publicAvailabilitySummary(api.products));
    assert.doesNotMatch(html, /gpsfarma/i);
    assert.match(home, /class="v69-home-sections"/);
    assert.match(root, /id="gridV69"/);
    assert.match(root, /id="buscar-v69"/);
    assert.doesNotMatch(root, /class="v69-home-sections"/);
    assert.match(root, /<meta name="robots" content="index,follow">/);
    assert.match(root, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/">/);
    assert.match(home, /Farmacia y Dermocosmetica, Catalogo de Precios y Promociones/);
    assert.match(home, /farmagreen-social-preview-v69-social-2\.png/);
    assert.equal((root.match(/<link rel="stylesheet"/g) || []).length, 1);
    assert.match(root, /styles-v6-9-2\.css/);
    assert.match(root, /app-v6-9-11\.js/);
    assert.match(root, /analytics-v69-3\.js/);
    assert.match(root, /meta-pixel-v69-2\.js/);
    assert.ok(root.indexOf("analytics-v69-3.js") < root.indexOf("meta-pixel-v69-2.js"));
    assert.ok(root.indexOf("meta-pixel-v69-2.js") < root.indexOf("app-v6-9-11.js"));
    assert.match(robots, new RegExp(`Sitemap: ${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sitemap\\.xml`));
    assert.equal((sitemap.match(/<url>/g) || []).length, api.totalProducts + 2);
    assert.ok(api.products.every((product) => sitemap.includes(`<loc>${origin}/p/${product.publicId}</loc>`)));
    assert.doesNotMatch(root, /"products":\[/);
    assert.doesNotMatch(html, /"products":\[/);
    assert.equal(bootPayload(root).totalProducts, api.totalProducts);
    assert.equal(bootPayload(root).catalogRoute, "/");
    assert.equal(bootPayload(html).dataEndpoint, "/api/catalog-v6-9");
    assert.equal(bootPayload(html).catalogRoute, "/catalogo");
    assert.ok(Buffer.byteLength(root) < 180_000, "La portada-catálogo no debe incrustar todos los productos.");
    assert.ok(Buffer.byteLength(html) < 180_000, "El catálogo no debe volver a incrustar todos los productos.");
    assert.match(home, /<meta property="og:image:width" content="1200">/);
    assert.match(home, /<meta property="og:image:height" content="630">/);
    assert.match(root, /class="brandmark"/);
    assert.match(root, /class="brandmark"[^>]*>/);
    assert.match(home, /class="v69-home-sections" id="marcas-inicio-v69"/);
    assert.doesNotMatch(home, /v69-home-brand-index/);
    assert.doesNotMatch(home, /gpsfarma|provider|"sku"|"source"/i);
    assert.doesNotMatch(appSource, /gpsfarma/i);
    assert.match(analyticsSource, /G-SL7GG138WV/);
    assert.match(analyticsSource, /AW-18405204387/);
    assert.match(analyticsSource, /fgTrackGaV69/);
    assert.match(analyticsSource, /allow_google_signals: false/);
    assert.match(analyticsSource, /allow_ad_personalization_signals: false/);
    assert.match(metaPixelSource, /1198250568817946/);
    assert.match(metaPixelSource, /fbq\("init", META_PIXEL_ID_V69\)/);
    assert.match(metaPixelSource, /fgTrackMetaV69\("PageView"\)/);
    assert.match(metaPixelSource, /eventID: eventId/);
    assert.match(metaPixelSource, /\/api\/meta-events-v6-9/);
    assert.match(metaPixelSource, /__FG_META_QUEUE/);
    assert.match(appSource, /trackMeta\("ViewContent"/);
    assert.match(appSource, /trackMeta\("Search"/);
    assert.match(appSource, /trackMeta\("Contact"/);
    assert.match(appSource, /trackMeta\("Lead"/);
    assert.match(appSource, /trackMeta\("CatalogFilterOpen"/);
    assert.match(appSource, /trackMeta\("CatalogFilterSelect"/);
    assert.match(appSource, /trackGa\("filter_open"/);
    assert.match(appSource, /trackGa\("filter_select"/);
    assert.match(root, /facebook\.com\/tr\?id=1198250568817946&amp;ev=PageView&amp;noscript=1/i);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/connect\.facebook\.net/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/www\.facebook\.com/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/www\.googletagmanager\.com/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/\*\.google-analytics\.com/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/analytics\.google\.com/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/\*\.analytics\.google\.com/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/www\.googleadservices\.com/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/\*\.g\.doubleclick\.net/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /https:\/\/pagead2\.googlesyndication\.com/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /form-action 'self' https:\/\/www\.facebook\.com/);
    assert.match(catalogResponse.headers.get("content-security-policy") || "", /frame-src https:\/\/www\.facebook\.com/);
    assert.doesNotMatch(catalogResponse.headers.get("content-security-policy") || "", /gpsfarma|unsafe-inline/i);
    assert.match(html, /id="availabilityV69"/);
    assert.match(html, /id="sortV69" name="orden"/);
    assert.match(html, /class="v65-link-button"[^>]*id="showAllV69"/);

    const disabledCapiResponse = await fetch(`${origin}/api/meta-events-v6-9`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_name: "CatalogFilterSelect",
        event_time: Math.floor(Date.now() / 1_000),
        event_id: "fg-v69-local-test",
        event_source_url: `${origin}/catalogo-v6-9/`,
        custom_data: { filter_type: "order", filter_value: "precio-desc" },
      }),
    });
    assert.equal(disabledCapiResponse.status, 204);
    const capiMethodResponse = await fetch(`${origin}/api/meta-events-v6-9`);
    assert.equal(capiMethodResponse.status, 405);

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
    assert.match(pdp, /class="crumb v65-crumb v69-pdp-crumb"/);
    assert.match(pdp, /<a href="\/catalogo#productos-v69">Volver al catálogo<\/a>/);
    assert.match(pdp, /class="v69-crumb-context"/);
    assert.match(pdp, new RegExp(`>${unavailable.brand.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/a>`));
    assert.doesNotMatch(pdp, /gpsfarma|provider|"sku"|"source"/i);
    assert.match(pdp, new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/p/${unavailable.publicId}`));
    assert.match(pdp, /class="brandmark"/);
    assert.match(pdp, /class="v69-footer"/);
    const pdpBoot = bootPayload(pdp);
    assert.equal(pdpBoot.page, "product");
    assert.deepEqual(Object.keys(pdpBoot.product).sort(), [
      "brand",
      "listPrice",
      "name",
      "offerPrice",
      "primaryCategory",
      "publicId",
    ]);
    assert.equal(pdpBoot.product.publicId, unavailable.publicId);
    assert.doesNotMatch(JSON.stringify(pdpBoot.product), /gpsfarma|provider|"sku"|"source"/i);
    const pdpSchema = structuredData(pdp).find((entry) => Array.isArray(entry["@graph"]));
    assert.ok(pdpSchema);
    const graph = pdpSchema["@graph"] as Array<Record<string, unknown>>;
    const productNode = graph.find((entry) => entry["@type"] === "Product");
    const breadcrumbNode = graph.find((entry) => entry["@type"] === "BreadcrumbList");
    assert.ok(productNode);
    assert.ok(breadcrumbNode);
    assert.equal((productNode.offers as Record<string, unknown>).availability, "https://schema.org/OutOfStock");
    const gtin = validGtinV69(unavailable.barcode);
    if (gtin) assert.equal(productNode[gtin.key], gtin.value);
    assert.equal((breadcrumbNode.itemListElement as unknown[]).length, 3);
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
  assert.equal(responsiveImagesReadyV691(productionReady.products[0]), false);
  assert.equal(
    catalogReadyForRuntimeV69(productionReady, {
      NODE_ENV: "production",
      V69_ENABLE_PRODUCTION: "1",
      V691_REQUIRE_RESPONSIVE_IMAGES: "1",
      PUBLIC_ORIGIN: "https://farmagreen-v69-preprod.example",
    }),
    false,
  );
  const responsiveReady = {
    ...productionReady,
    products: productionReady.products.map((product) => ({
      ...product,
      images: {
        ...product.images,
        responsive: {
          card: {
            width: 1000,
            height: 1000,
            webp: { "320": "https://storage.googleapis.com/farmagreen-catalog-images/v69/card-320.webp" },
            avif: { "320": "https://storage.googleapis.com/farmagreen-catalog-images/v69/card-320.avif" },
          },
          detail: {
            width: 1000,
            height: 1000,
            webp: { "320": "https://storage.googleapis.com/farmagreen-catalog-images/v69/detail-320.webp" },
            avif: { "320": "https://storage.googleapis.com/farmagreen-catalog-images/v69/detail-320.avif" },
          },
        },
      },
    })),
  };
  assert.equal(responsiveImagesReadyV691(responsiveReady.products[0]), true);
  assert.equal(
    catalogReadyForRuntimeV69(responsiveReady, {
      NODE_ENV: "production",
      V69_ENABLE_PRODUCTION: "1",
      V691_REQUIRE_RESPONSIVE_IMAGES: "1",
      PUBLIC_ORIGIN: "https://farmagreen-v69-preprod.example",
    }),
    true,
  );
  assert.equal(sourceImageBridgeEnabled({ NODE_ENV: "production", V69_LOCAL_PREVIEW: "1" }), false);
});
