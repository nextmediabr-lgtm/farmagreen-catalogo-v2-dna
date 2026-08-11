import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addDirectBaseFallbacksV7Beta,
  crawlSourceV7Beta,
  consolidateDetailedGroupsV69,
  groupSourceListingsV69,
  mergeCatalogV7Beta,
  parseProductPageCommerceV7Beta,
  sourceStartUrlV7Beta,
  validateSourceResultsV7Beta,
} from "../scripts/build-local-v7-beta.mjs";
import { GPS_EXPANSION_SOURCES_V7_BETA, GPS_SOURCES_V7_BETA } from "../scripts/catalog-sources-v7-beta.mjs";
import { resetCatalogV69CacheForTests } from "../src/data-v7-beta.js";
import {
  catalogPageV69,
  catalogFacetStatsV69,
  filterProductsBySearchV69,
  productMatchesCatalogFacetV69,
  publicCatalogV69,
  sortProductsV69,
} from "../src/render-v7-beta.js";
import { appV7BetaLocal } from "../src/server-v7-beta-local.js";

const COMPLETED_AT = "2026-08-07T20:00:00.000Z";

test("V7 Beta declara las cinco incorporaciones sin alterar las once fuentes V6.9", () => {
  assert.equal(GPS_SOURCES_V7_BETA.length, 16);
  assert.deepEqual(
    GPS_EXPANSION_SOURCES_V7_BETA.map((source) => source.id),
    ["6116", "7236", "6827", "dermocosmetica-activa", "cuidado-de-la-piel"],
  );
  assert.deepEqual(
    GPS_EXPANSION_SOURCES_V7_BETA.filter((source) => source.membershipOnly).map((source) => source.catalogBrandName),
    ["Dermocosmetica Activa", "Cuidado de la Piel"],
  );
  assert.ok(GPS_EXPANSION_SOURCES_V7_BETA.every((source) => source.facet.kind === "brand"));
});

test("V7 Beta importa Posición por fuente STOM y no reemplaza Relevancia", async () => {
  const source = GPS_SOURCES_V7_BETA.find((candidate) => candidate.id === "6116");
  assert.ok(source);
  const start = sourceStartUrlV7Beta(source);
  assert.equal(new URL(start).searchParams.get("product_list_order"), "position");
  const result = await crawlSourceV7Beta(source, {
    delayMs: 0,
    fetchHtml: async () => listingHtml([
      { sku: "NEU-1", name: "Neutrogena Gel 1", url: "/neutrogena-gel-1.html" },
      { sku: "NEU-2", name: "Neutrogena Gel 2", url: "/neutrogena-gel-2.html" },
    ]),
  });
  assert.deepEqual(result.products.map((product) => product.position), [1, 2]);
  assert.ok(result.products.every((product) => product.catalogFacet.name === "Neutrogena"));
  await assert.rejects(
    () => crawlSourceV7Beta(source, { delayMs: 0, fetchHtml: async () => listingHtml([]) }),
    /fuente Neutrogena terminó vacía/,
  );
});

test("V7 Beta exige las 16 fuentes completas antes de construir el snapshot", () => {
  const complete = GPS_SOURCES_V7_BETA.map((source, index) =>
    sourceResult(source, [member(source, `SOURCE-${index}`, `${source.catalogBrandName} Producto`, 1)]));
  assert.equal(validateSourceResultsV7Beta(complete).length, GPS_SOURCES_V7_BETA.length);
  assert.throws(() => validateSourceResultsV7Beta(complete.slice(1)), /faltantes=5930/);
  assert.throws(
    () => validateSourceResultsV7Beta(complete.map((result, index) => index === 0 ? { ...result, products: [] } : result)),
    /vacías\/fallidas=5930/,
  );
});

test("la ficha directa sólo completa base con precio y disponibilidad STOM explícitos", async () => {
  const availableHtml = productPageCommerceHtml({ sku: "BASE-1", finalPrice: 750, oldPrice: 1000, available: true });
  const parsed = parseProductPageCommerceV7Beta(availableHtml, { sku: "BASE-1" });
  assert.equal(parsed.availability, "available");
  assert.equal(parsed.offerPrice, 750);
  assert.equal(parsed.listPrice, 1000);
  assert.equal(parsed.discountPercent, 25);

  const unavailable = parseProductPageCommerceV7Beta(
    productPageCommerceHtml({ sku: "BASE-1", finalPrice: 750, oldPrice: 1000, available: false }),
    { sku: "BASE-1" },
  );
  assert.equal(unavailable.availability, "unavailable");
  assert.throws(
    () => parseProductPageCommerceV7Beta(
      productPageCommerceHtml({ sku: "OTRO", finalPrice: 750, oldPrice: 1000, available: true }),
      { sku: "BASE-1" },
    ),
    /no corresponde al SKU esperado/,
  );

  const base = baseCatalog();
  const fallback = await addDirectBaseFallbacksV7Beta(
    base,
    [],
    { products: [], skus: [], barcodes: [], urls: [], hidden: { "base-hidden": { reason: "Discontinuado", at: COMPLETED_AT } } },
    { fetchHtml: async () => availableHtml },
  );
  assert.equal(fallback.added, 1);
  assert.equal(fallback.detailedGroups[0].baseIndex, 0);
  assert.equal(fallback.detailedGroups[0].members[0].sourceFallbackDirect, true);
});

test("una ficha compartida por marca y HTML conserva una identidad y dos posiciones", () => {
  const direct = GPS_SOURCES_V7_BETA.find((source) => source.id === "6116");
  const group = GPS_SOURCES_V7_BETA.find((source) => source.id === "cuidado-de-la-piel");
  assert.ok(direct && group);
  const grouped = groupSourceListingsV69([
    sourceResult(direct, [member(direct, "SKU-COMPARTIDO", "Producto compartido", 2)]),
    sourceResult(group, [member(group, "SKU-COMPARTIDO", "Producto compartido", 18)]),
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].members.length, 2);
});

test("el dedupe falla cerrado ante una cadena transitiva que termina en dos SKU", () => {
  const direct = GPS_SOURCES_V7_BETA.find((source) => source.id === "6116");
  const collection = GPS_SOURCES_V7_BETA.find((source) => source.id === "cuidado-de-la-piel");
  assert.ok(direct && collection);
  const first = member(direct, "SKU-X", "Producto X", 1);
  const bridge = {
    ...member(collection, "", "Producto puente", 2),
    sourceUrl: "https://gpsfarma.com/ficha-puente.html",
    imageUrl: first.imageUrl,
  };
  const last = {
    ...member(collection, "SKU-Y", "Producto Y", 3),
    sourceUrl: bridge.sourceUrl,
    imageUrl: "https://gpsfarma.com/media/catalog/product/otra/y.jpg",
  };
  assert.throws(
    () => groupSourceListingsV69([
      sourceResult(direct, [first]),
      sourceResult(collection, [bridge, last]),
    ]),
    /Conflicto de identidad.*2 SKU/,
  );
});

test("el fallback exacto marca+título consolida faltantes sin fusionar variantes identificadas", () => {
  const direct = GPS_SOURCES_V7_BETA.find((source) => source.id === "6116");
  assert.ok(direct);
  const unknownA = {
    ...member(direct, "", "Neutrogena Gel Facial 50 ml", 1),
    sourceUrl: "https://gpsfarma.com/neutrogena-gel-alias-a.html",
    imageUrl: "https://gpsfarma.com/media/catalog/product/alias/a.jpg",
  };
  const unknownB = {
    ...member(direct, "", "Neutrogena Gel Facial 50 ml", 2),
    sourceUrl: "https://gpsfarma.com/neutrogena-gel-alias-b.html",
    imageUrl: "https://gpsfarma.com/media/catalog/product/alias/b.jpg",
  };
  assert.equal(
    consolidateDetailedGroupsV69([
      { members: [unknownA], detail: {} },
      { members: [unknownB], detail: {} },
    ]).length,
    1,
  );

  const variantA = { ...unknownA, sku: "VAR-A" };
  const variantB = { ...unknownB, sku: "VAR-B" };
  assert.equal(
    consolidateDetailedGroupsV69([
      { members: [variantA], detail: {} },
      { members: [variantB], detail: {} },
    ]).length,
    2,
  );

  const byBaseIndex = consolidateDetailedGroupsV69([
    { members: [{ ...variantA, sourceName: "Nombre en marca" }], detail: {}, baseIndex: 7 },
    { members: [{ ...variantA, sourceName: "Nombre en colección", sourceUrl: unknownB.sourceUrl }], detail: {}, baseIndex: 7 },
  ]);
  assert.equal(byBaseIndex.length, 1);
  assert.equal(byBaseIndex[0].members.length, 2);
  assert.throws(
    () => consolidateDetailedGroupsV69([
      { members: [variantA], detail: {}, baseIndex: 7 },
      { members: [variantB], detail: {}, baseIndex: 7 },
    ]),
    /ficha base contienen identidades incompatibles/,
  );
});

test("merge V7 aplica exclusiones al final y no fusiona variantes con barcode compartido", () => {
  const cuidado = GPS_SOURCES_V7_BETA.find((source) => source.id === "cuidado-de-la-piel");
  const neutrogena = GPS_SOURCES_V7_BETA.find((source) => source.id === "6116");
  const omron = GPS_SOURCES_V7_BETA.find((source) => source.id === "7236");
  assert.ok(cuidado && neutrogena && omron);
  const base = baseCatalog();
  const groups = [
    {
      members: [member(cuidado, "BASE-1", "Producto base tono 1", 9)],
      detail: {},
    },
    {
      members: [
        member(neutrogena, "NEW-1", "Neutrogena Hydro Boost Gel 50 ml", 3),
        member(cuidado, "NEW-1", "Neutrogena Hydro Boost Gel 50 ml", 21),
      ],
      detail: { sku: "NEW-1", barcode: "7500000000001", description: "Gel hidratante facial de la fuente." },
    },
    {
      members: [member(omron, "DROP-1", "Omron Producto Excluido", 1)],
      detail: { sku: "DROP-1", barcode: "7500000000002", description: "Producto de la fuente." },
    },
  ];
  const catalog = mergeCatalogV7Beta(
    base,
    groups,
    {
      products: [],
      skus: [],
      barcodes: ["7500000000002"],
      urls: [],
      hidden: { "base-hidden": { reason: "Discontinuado", at: COMPLETED_AT } },
    },
    { completedAt: COMPLETED_AT, requireCompleteSources: false },
  );

  assert.equal(catalog.version, 7);
  assert.equal(catalog.releaseChannel, "beta-local");
  assert.equal(catalog.products.length, 2);
  assert.equal(catalog.products.some((product: any) => product.sku === "DROP-1"), false);
  assert.equal(catalog.products.some((product: any) => product.publicId === "base-hidden"), false);
  const baseVisible = catalog.products.find((product: any) => product.publicId === "base-visible");
  assert.ok(baseVisible);
  assert.ok(productMatchesCatalogFacetV69(baseVisible, "Cuidado de la Piel"));
  assert.equal(baseVisible.catalogPositions["cuidado-de-la-piel"], 9);
  const added = catalog.products.find((product: any) => product.sku === "NEW-1");
  assert.ok(added);
  assert.deepEqual(
    added.catalogFacets.map((facet: any) => facet.name),
    ["Neutrogena", "Cuidado de la Piel"],
  );
  assert.deepEqual(added.catalogPositions, { neutrogena: 3, "cuidado-de-la-piel": 21 });
  assert.equal(catalog.v7Beta.excluded, 2);
  assert.equal(catalog.v7Beta.currentCycleCoverage, 1);
  assert.equal(catalog.v7Beta.sourcesComplete, false);
  assert.ok(catalog.v7Beta.missingSourceIds.includes("5930"));
  assert.ok(catalog.products.every((product: any) => product.availabilityCheckedAt === COMPLETED_AT));

  const facets = catalogFacetStatsV69(catalog.products as any);
  assert.ok(facets.some((facet) => facet.name === "Neutrogena" && facet.count === 1));
  assert.ok(facets.some((facet) => facet.name === "Cuidado de la Piel" && facet.count === 2));
  assert.equal(sortProductsV69(catalog.products as any, "posicion", "", "Neutrogena")[0].publicId, added.publicId);

  const html = catalogPageV69(
    catalog as any,
    new URLSearchParams({ scope: "todo", marca: "Cuidado de la Piel", orden: "posicion" }),
    "http://127.0.0.1:8113",
  );
  assert.match(html, /V7 Beta Local/);
  assert.match(html, /<option value="relevancia">Relevancia<\/option>/);
  assert.match(html, /<option value="posicion" selected>Posición<\/option>/);
  assert.match(html, /data-brand="Cuidado de la Piel"/);

  const defaultHtml = catalogPageV69(
    catalog as any,
    new URLSearchParams({ scope: "todo" }),
    "http://127.0.0.1:8113",
  );
  assert.match(defaultHtml, /<option value="relevancia" selected>Relevancia<\/option>/);
  assert.doesNotMatch(defaultHtml, /<option value="posicion" selected>/);

  const publicCatalog = publicCatalogV69(catalog as any);
  const serialized = JSON.stringify(publicCatalog);
  assert.equal(publicCatalog.releaseChannel, "beta-local");
  assert.doesNotMatch(serialized, /"sku"|"source"|gpsfarma\.com/i);
  assert.ok(publicCatalog.products.every((product) => Array.isArray(product.catalogFacets)));
});

test("una URL excluida en cualquier membresía elimina la ficha canónica completa", () => {
  const direct = GPS_SOURCES_V7_BETA.find((source) => source.id === "6116");
  const collection = GPS_SOURCES_V7_BETA.find((source) => source.id === "cuidado-de-la-piel");
  assert.ok(direct && collection);
  const alias = member(collection, "BASE-1", "Producto base tono 1", 8);
  const catalog = mergeCatalogV7Beta(
    baseCatalog(),
    [
      {
        members: [member(direct, "BASE-1", "Producto base tono 1", 2), alias],
        detail: {},
      },
      {
        members: [member(direct, "BASE-2", "Producto base tono 2", 3)],
        detail: {},
      },
    ],
    { products: [], skus: [], barcodes: [], urls: [alias.sourceUrl], hidden: {} },
    { completedAt: COMPLETED_AT, requireCompleteSources: false },
  );
  assert.deepEqual(catalog.products.map((product: any) => product.publicId), ["base-hidden"]);
  assert.equal(catalog.v7Beta.excluded, 1);
});

test("dos aliases resueltos por URL y SKU actualizan una sola ficha base", () => {
  const dermaglos = GPS_SOURCES_V7_BETA.find((source) => source.id === "5808");
  const collection = GPS_SOURCES_V7_BETA.find((source) => source.id === "cuidado-de-la-piel");
  assert.ok(dermaglos && collection);
  const byUrl = {
    ...member(dermaglos, "", "Alias listado por URL", 4),
    sourceUrl: "https://gpsfarma.com/base-visible.html",
  };
  const bySku = member(collection, "BASE-1", "Alias listado por SKU", 11);
  const catalog = mergeCatalogV7Beta(
    baseCatalog(),
    [
      { members: [byUrl], detail: {}, baseIndex: 0 },
      { members: [bySku], detail: { sku: "BASE-1" } },
    ],
    {
      products: [],
      skus: [],
      barcodes: [],
      urls: [],
      hidden: { "base-hidden": { reason: "Discontinuado", at: COMPLETED_AT } },
    },
    { completedAt: COMPLETED_AT, requireCompleteSources: false },
  );
  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.v7Beta.matchedExisting, 1);
  assert.equal(catalog.products[0].catalogPositions.dermaglos, 4);
  assert.equal(catalog.products[0].catalogPositions["cuidado-de-la-piel"], 11);
});

test("un producto base no verificado en el ciclo actual impide declarar sync completo", () => {
  const direct = GPS_SOURCES_V7_BETA.find((source) => source.id === "6116");
  assert.ok(direct);
  const base = baseCatalog();
  base.products[1].availabilityCheckedAt = "2026-07-01T00:00:00.000Z";
  assert.throws(
    () => mergeCatalogV7Beta(
      base,
      [{ members: [member(direct, "BASE-1", "Producto base tono 1", 1)], detail: {} }],
      { products: [], skus: [], barcodes: [], urls: [], hidden: {} },
      { completedAt: COMPLETED_AT, requireCompleteSources: false },
    ),
    /Cobertura STOM actual incompleta: 1 producto/,
  );
});

test("un producto descubierto sólo por HTML conserva marca canónica configurada y marca virtual", () => {
  const direct = GPS_SOURCES_V7_BETA.find((source) => source.id === "6116");
  const collection = GPS_SOURCES_V7_BETA.find((source) => source.id === "cuidado-de-la-piel");
  assert.ok(direct && collection);
  const catalog = mergeCatalogV7Beta(
    baseCatalog(),
    [
      { members: [member(direct, "BASE-1", "Producto base tono 1", 1)], detail: {} },
      {
        members: [member(collection, "HTML-ONLY", "Neutrogena Hydro Boost Water Gel 50 ml", 12)],
        detail: { sku: "HTML-ONLY", barcode: "7500000000099", description: "Gel facial hidratante." },
      },
    ],
    {
      products: [],
      skus: [],
      barcodes: [],
      urls: [],
      hidden: { "base-hidden": { reason: "Discontinuado", at: COMPLETED_AT } },
    },
    { completedAt: COMPLETED_AT, requireCompleteSources: false },
  );
  const product = catalog.products.find((candidate: any) => candidate.sku === "HTML-ONLY");
  assert.ok(product);
  assert.equal(product.brand.name, "Neutrogena");
  assert.deepEqual(
    product.catalogFacets.map((facet: any) => facet.name),
    ["Neutrogena", "Cuidado de la Piel"],
  );
  assert.ok(productMatchesCatalogFacetV69(product, "Neutrogena"));
  assert.ok(productMatchesCatalogFacetV69(product, "Cuidado de la Piel"));
});

test("una marca interna de los HTML sigue siendo buscable sin convertirse en marca del menú", () => {
  const direct = GPS_SOURCES_V7_BETA.find((source) => source.id === "6116");
  const virtualBrand = GPS_SOURCES_V7_BETA.find((source) => source.id === "cuidado-de-la-piel");
  assert.ok(direct && virtualBrand);
  const niveaMember = {
    ...member(virtualBrand, "HTML-NIVEA", "Nivea Crema Facial 50 ml", 27),
    sourceBrand: "Nivea",
    listedBrand: "Nivea",
  };
  const catalog = mergeCatalogV7Beta(
    baseCatalog(),
    [
      { members: [member(direct, "BASE-1", "Producto base tono 1", 1)], detail: {} },
      {
        members: [niveaMember],
        detail: { sku: "HTML-NIVEA", barcode: "7500000000198", description: "Crema facial hidratante." },
      },
    ],
    {
      products: [],
      skus: [],
      barcodes: [],
      urls: [],
      hidden: { "base-hidden": { reason: "Discontinuado", at: COMPLETED_AT } },
    },
    { completedAt: COMPLETED_AT, requireCompleteSources: false },
  );
  const product = catalog.products.find((candidate: any) => candidate.sku === "HTML-NIVEA");
  assert.ok(product);
  assert.equal(product.brand.name, "Nivea");
  assert.deepEqual(product.catalogFacets.map((facet: any) => facet.name), ["Cuidado de la Piel"]);
  assert.equal(productMatchesCatalogFacetV69(product, "Nivea"), false);
  assert.equal(productMatchesCatalogFacetV69(product, "Cuidado de la Piel"), true);
  assert.deepEqual(filterProductsBySearchV69(catalog.products as any, "Nivea").map((item) => item.publicId), [product.publicId]);
  assert.equal(catalogFacetStatsV69(catalog.products as any).some((facet) => facet.name === "Nivea"), false);
});

test("servidor V7 Beta queda local, noindex y expone el snapshot sin SKU", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "farmagreen-v7-beta-test-"));
  const catalogFile = path.join(directory, "catalog.json");
  const exclusionsFile = path.join(directory, "exclusions.json");
  const catalog = {
    ...baseCatalog(),
    version: 7,
    releaseChannel: "beta-local",
    totalProducts: 1,
    v7Beta: {
      completedAt: COMPLETED_AT,
      inventoryLocation: "Rosario",
      inventorySource: "STOM",
      sourceIds: GPS_SOURCES_V7_BETA.map((source) => source.id),
      expectedSourceCount: GPS_SOURCES_V7_BETA.length,
      sourceCoverage: 1,
      missingSourceIds: [],
      missingFacetSlugs: [],
      currentCycleCoverage: 1,
      sourcesComplete: true,
    },
    products: [{
      ...baseCatalog().products[0],
      catalogFacets: GPS_EXPANSION_SOURCES_V7_BETA.map((source) => source.facet),
    }],
  };
  await writeFile(catalogFile, JSON.stringify(catalog));
  await writeFile(exclusionsFile, JSON.stringify({ products: [], skus: [], barcodes: [], urls: [], hidden: {} }));
  const previousCatalog = process.env.V7_BETA_CATALOG_FILE;
  const previousExclusions = process.env.V7_BETA_EXCLUSIONS_FILE;
  process.env.V7_BETA_CATALOG_FILE = catalogFile;
  process.env.V7_BETA_EXCLUSIONS_FILE = exclusionsFile;
  resetCatalogV69CacheForTests();
  const server = appV7BetaLocal({ ...process.env, NODE_ENV: "test" });
  const origin = await listen(server);
  try {
    const [pageResponse, apiResponse, healthResponse, robotsResponse, assetResponse] = await Promise.all([
      fetch(`${origin}/catalogo-v7-beta?scope=todo`),
      fetch(`${origin}/api/catalog-v7-beta`),
      fetch(`${origin}/api/catalog-v7-beta/health`),
      fetch(`${origin}/robots.txt`),
      fetch(`${origin}/app-v7-beta.js`),
    ]);
    assert.equal(pageResponse.status, 200);
    assert.equal(apiResponse.status, 200);
    assert.equal(healthResponse.status, 200);
    assert.equal(assetResponse.status, 200);
    assert.match(pageResponse.headers.get("x-robots-tag") || "", /noindex/);
    assert.match(await pageResponse.text(), /V7 Beta Local/);
    assert.match(await robotsResponse.text(), /Disallow: \//);
    const apiText = await apiResponse.text();
    assert.doesNotMatch(apiText, /"sku"|"source"/i);
    const health = await healthResponse.json() as any;
    assert.equal(health.status, "ready");
    assert.equal(health.version, 7);
    assert.equal(health.inventorySource, "STOM");

    await writeFile(catalogFile, JSON.stringify({
      ...catalog,
      v7Beta: {
        ...catalog.v7Beta,
        sourceIds: ["5930"],
        sourceCoverage: 1 / GPS_SOURCES_V7_BETA.length,
        missingSourceIds: GPS_SOURCES_V7_BETA.slice(1).map((source) => source.id),
        sourcesComplete: false,
      },
    }));
    resetCatalogV69CacheForTests();
    const incompleteHealthResponse = await fetch(`${origin}/api/catalog-v7-beta/health`);
    assert.equal(incompleteHealthResponse.status, 503);
    assert.equal((await incompleteHealthResponse.json() as any).status, "not_ready");
  } finally {
    await close(server);
    if (previousCatalog === undefined) delete process.env.V7_BETA_CATALOG_FILE;
    else process.env.V7_BETA_CATALOG_FILE = previousCatalog;
    if (previousExclusions === undefined) delete process.env.V7_BETA_EXCLUSIONS_FILE;
    else process.env.V7_BETA_EXCLUSIONS_FILE = previousExclusions;
    resetCatalogV69CacheForTests();
    await rm(directory, { recursive: true, force: true });
  }

  const production = appV7BetaLocal({ NODE_ENV: "production" });
  const productionOrigin = await listen(production);
  try {
    const response = await fetch(`${productionOrigin}/catalogo-v7-beta`);
    assert.equal(response.status, 503);
  } finally {
    await close(production);
  }
});

function sourceResult(source: any, products: any[]) {
  return {
    id: source.id,
    catalogBrandId: source.catalogBrandId,
    catalogBrandName: source.catalogBrandName,
    facet: source.facet,
    membershipOnly: Boolean(source.membershipOnly),
    status: "completed",
    pages: [{ page: 1 }],
    products,
  };
}

function member(source: any, sku: string, name: string, position: number) {
  return {
    sourceId: source.id,
    catalogBrandId: source.catalogBrandId,
    catalogBrandName: source.catalogBrandName,
    catalogFacet: source.facet,
    sourceMembershipOnly: Boolean(source.membershipOnly),
    sourceUrl: `https://gpsfarma.com/${source.id}-${sku.toLowerCase()}.html`,
    sourceName: name,
    sourceBrand: source.membershipOnly ? "Neutrogena" : source.catalogBrandName,
    listedBrand: source.membershipOnly ? "Neutrogena" : source.catalogBrandName,
    imageUrl: `https://gpsfarma.com/media/catalog/product/${source.id}/${sku.toLowerCase()}.jpg`,
    sku,
    position,
    availability: "available",
    listPrice: 1000,
    offerPrice: 900,
    savingAmount: 100,
    discountPercent: 10,
  };
}

function baseCatalog() {
  const sharedBarcode = "7793742004858";
  return {
    version: 6.9,
    syncedAt: COMPLETED_AT,
    commerceSyncedAt: COMPLETED_AT,
    availabilityReferenceAt: COMPLETED_AT,
    totalProducts: 2,
    commerceSync: { completedAt: COMPLETED_AT, status: "completed", metrics: {} },
    products: [
      baseProduct("base-visible", "BASE-1", sharedBarcode, "Producto base tono 1"),
      baseProduct("base-hidden", "BASE-2", sharedBarcode, "Producto base tono 2"),
    ],
  };
}

function baseProduct(publicId: string, sku: string, barcode: string, name: string) {
  return {
    publicId,
    slug: `${publicId}--${publicId}`,
    name,
    brand: { id: "5808", slug: "dermaglos", name: "Dermaglos", aliases: ["dermaglos"] },
    line: "Dermaglos",
    primaryCategory: "rostro",
    categorySlugs: ["rostro"],
    needs: ["cuidado-diario"],
    aliases: [name, "Dermaglos"],
    description: "Descripción de producto base.",
    listPrice: 1000,
    offerPrice: 900,
    savingAmount: 100,
    discountPercent: 10,
    availability: "limited",
    availabilityCheckedAt: COMPLETED_AT,
    images: {
      card: "https://storage.googleapis.com/farmagreen-catalog-images/base.jpg",
      detail: "https://storage.googleapis.com/farmagreen-catalog-images/base.jpg",
    },
    source: { provider: "GPSFarma", url: `https://gpsfarma.com/${publicId}.html`, retrievedAt: COMPLETED_AT },
    sku,
    barcode,
  };
}

function listingHtml(products: Array<{ sku: string; name: string; url: string }>) {
  return `<ul>${products.map((product, index) => `
    <li class="item product product-item">
      <a class="product-item-photo" href="https://gpsfarma.com${product.url}"><img class="product-image-photo" src="https://gpsfarma.com/media/catalog/product/demo/${index}.jpg"></a>
      <div class="product-item-brand">Neutrogena</div>
      <a class="product-item-link" href="https://gpsfarma.com${product.url}">${product.name}</a>
      <span data-price-type="finalPrice" data-price-amount="900" id="product-price-${index}"></span>
      <span data-price-type="oldPrice" data-price-amount="1000" id="old-price-${index}"></span>
      <form data-role="tocart-form" data-product-sku="${product.sku}" action="/checkout/cart/add/"></form>
    </li>`).join("")}</ul>`;
}

function productPageCommerceHtml({
  sku,
  finalPrice,
  oldPrice,
  available,
}: {
  sku: string;
  finalPrice: number;
  oldPrice: number;
  available: boolean;
}) {
  return `<html><head><meta property="og:image" content="https://gpsfarma.com/media/catalog/product/demo/product.jpg"></head><body>
    <div data-product-sku="${sku}"></div>
    <span data-price-amount="${oldPrice}" data-price-type="oldPrice"></span>
    <span data-price-type="finalPrice" data-price-amount="${finalPrice}"></span>
    ${available
      ? `<form data-product-sku="${sku}" data-role="tocart-form" action="https://gpsfarma.com/checkout/cart/add/"></form>`
      : `<div class="stock unavailable">Sin disponibilidad</div>`}
  </body></html>`;
}

function listen(server: http.Server) {
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Puerto de prueba inválido."));
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
