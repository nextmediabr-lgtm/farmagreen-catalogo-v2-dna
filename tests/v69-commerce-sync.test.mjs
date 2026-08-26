import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bestProductCandidate,
  candidateBrandMatchesProduct,
  normalizeProductText,
  productTitleMatchScore,
} from "../scripts/gpsfarma-listing.mjs";
import {
  DEFAULT_INVENTORY_SCOPE_V69,
  GPS_SOURCES_V69,
  crawlSource,
  inventoryScopeV69,
  normalizeGpsImagePath,
  normalizeGpsProductUrl,
  enrichCatalogIdentitiesV69,
  parseListingProducts,
  parseNextPageUrl,
  parseProductIdentityV69,
  runCommercialSync,
  sourceStartUrl,
  synchronizeCatalog,
  trustedGpsUrl,
  writeJsonAtomically,
} from "../scripts/sync-catalog-commerce-v69.mjs";
import {
  consolidateDetailedGroupsV69,
  enrichListingGroupsV69,
  inferTaxonomyV69,
  newProductFromSourceGroupV69,
  parseProductDetailV69,
} from "../scripts/build-local-v7-beta.mjs";
import {
  assertRuntimeAssetsV69,
  assertUniqueCanonicalProductsV69,
  attachMagentoTaxonomyV69,
  discoverySourcesV69,
  finalizeCatalogDiscoveryV69,
  reconcileCatalogChangesV69,
  reindexCatalogV69,
} from "../scripts/scan-catalog-v69.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PAGE_1 = await fs.readFile(path.join(FIXTURES, "gpsfarma-list-page-1.html"), "utf8");
const PAGE_2 = await fs.readFile(path.join(FIXTURES, "gpsfarma-list-page-2.html"), "utf8");
const EUCERIN = GPS_SOURCES_V69.find((source) => source.id === "5930");

test("declara exactamente las 16 fuentes comerciales de V6.9 con las marcas incorporadas en STOM", () => {
  assert.equal(GPS_SOURCES_V69.length, 16);
  assert.deepEqual(
    GPS_SOURCES_V69.map((source) => source.id),
    ["5930", "5704", "6827", "6116", "6312", "5745", "5808", "5751", "6048", "6301", "6023", "5756", "5697", "5911", "9100", "revitalift"],
  );
  const bagovit = GPS_SOURCES_V69.find((source) => source.id === "5704");
  assert.equal(bagovit.catalogBrandName, "Bagóvit");
  assert.equal(bagovit.importCatalog, true);
  assert.deepEqual(bagovit.facet.aliases, ["bagovit", "bagóvit"]);
  const cerave = GPS_SOURCES_V69.find((source) => source.id === "6827");
  assert.equal(cerave.catalogBrandName, "CeraVe");
  assert.equal(cerave.importCatalog, true);
  assert.deepEqual(cerave.facet.aliases, ["cerave", "cera ve"]);
  assert.deepEqual(
    GPS_SOURCES_V69.filter((source) => ["6116", "6312", "5745"].includes(source.id)).map((source) => ({
      id: source.id,
      name: source.catalogBrandName,
      aliases: source.facet.aliases,
      importCatalog: source.importCatalog,
      importAvailableOnly: Boolean(source.importAvailableOnly),
    })),
    [
      { id: "6116", name: "Neutrogena", aliases: ["neutrogena"], importCatalog: true, importAvailableOnly: false },
      { id: "6312", name: "Vitamin Way", aliases: ["vitamin way", "vitaminway"], importCatalog: true, importAvailableOnly: true },
      { id: "5745", name: "Capilatis", aliases: ["capilatis"], importCatalog: true, importAvailableOnly: true },
    ],
  );
});

test("Bagóvit conserva marca, posición, búsqueda y usos determinísticos", () => {
  const completedAt = "2026-08-11T12:00:00.000Z";
  const group = {
    members: [{
      sourceId: "5704",
      catalogBrandId: "5704",
      catalogBrandName: "Bagóvit",
      catalogFacet: { slug: "bagovit", name: "Bagóvit", aliases: ["bagovit", "bagóvit"], kind: "brand" },
      sourceUrl: "https://gpsfarma.com/bagovit-protector-solar-fps-45.html",
      sourceName: "Protector Solar Facial Con Color FPS 45 x 50 gr",
      sourceBrand: "Bagóvit",
      listedBrand: "Bagóvit",
      imageUrl: "https://gpsfarma.com/media/catalog/product/b/a/bagovit.jpg",
      sku: "287293",
      availability: "available",
      listPrice: 100,
      offerPrice: 80,
      savingAmount: 20,
      discountPercent: 20,
      position: 4,
    }],
    detail: { sku: "287293", barcode: "7790000005704", description: "Protección solar facial." },
  };
  const product = newProductFromSourceGroupV69(group, completedAt);
  assert.deepEqual(product.brand, {
    id: "5704",
    slug: "bagovit",
    name: "Bagóvit",
    aliases: ["Bagóvit", "bagovit", "bagóvit"],
  });
  assert.equal(product.primaryCategory, "solares");
  assert.deepEqual(product.needs, ["solares"]);
  assert.equal(product.catalogPositions.bagovit, 4);
  assert.ok(product.aliases.includes("bagovit"));
  assert.equal(inferTaxonomyV69("Shampoo Bagovit Plasma Vegetal x 350 ml", "Bagóvit").primaryCategory, "capilar");
  assert.equal(inferTaxonomyV69("Crema corporal Bagovit x 200 ml", "Bagóvit").primaryCategory, "cuerpo");
  assert.equal(inferTaxonomyV69("Gel de limpieza Bagovit Pro Esencial", "Bagóvit").primaryCategory, "limpieza");
  assert.deepEqual(inferTaxonomyV69("Serum Facial Colágeno Puro x 30 ml", "Bagóvit"), {
    primaryCategory: "rostro",
    needs: ["antiedad"],
    audit: {
      reasonerVersion: "v69.2-expansion-source-position",
      evidenceScope: ["name", "brand"],
      selected: [{ need: "antiedad", source: "deterministic-title-rule" }],
      rejected: [],
    },
  });
  assert.deepEqual(
    inferTaxonomyV69("Bagovit Crema Nutritiva Reparadora Pura Vitamina A x 400 gr", "Bagóvit"),
    {
      primaryCategory: "cuerpo",
      needs: ["reparacion"],
      audit: {
        reasonerVersion: "v69.2-expansion-source-position",
        evidenceScope: ["name", "brand"],
        selected: [{ need: "reparacion", source: "deterministic-title-rule" }],
        rejected: [],
      },
    },
  );
  assert.equal(inferTaxonomyV69("Emulsión Hidratante Autobronceante x 200 g", "Bagóvit").primaryCategory, "solares");
  assert.equal(inferTaxonomyV69("Bagóvit Facial Espuma Microexfoliante x 100 ml", "Bagóvit").primaryCategory, "limpieza");
});

test("CeraVe conserva marca, posición, búsqueda y usos determinísticos", () => {
  const completedAt = "2026-08-11T12:00:00.000Z";
  const group = {
    members: [{
      sourceId: "6827",
      catalogBrandId: "6827",
      catalogBrandName: "CeraVe",
      catalogFacet: { slug: "cerave", name: "CeraVe", aliases: ["cerave", "cera ve"], kind: "brand" },
      sourceUrl: "https://gpsfarma.com/cerave-locion-facial-hidratante-x-52-ml.html",
      sourceName: "Loción Facial Hidratante x 52 ml",
      sourceBrand: "Cerave",
      listedBrand: "Cerave",
      imageUrl: "https://gpsfarma.com/media/catalog/product/c/e/cerave.jpg",
      sku: "CERAVE-1",
      availability: "available",
      listPrice: 100,
      offerPrice: 80,
      savingAmount: 20,
      discountPercent: 20,
      position: 7,
    }],
    detail: { sku: "CERAVE-1", barcode: "3337875597197", description: "Hidratación facial." },
  };
  const product = newProductFromSourceGroupV69(group, completedAt);
  assert.deepEqual(product.brand, {
    id: "6827",
    slug: "cerave",
    name: "CeraVe",
    aliases: ["CeraVe", "cerave", "cera ve"],
  });
  assert.equal(product.primaryCategory, "rostro");
  assert.deepEqual(product.needs, ["hidratacion"]);
  assert.equal(product.catalogPositions.cerave, 7);
  assert.ok(product.aliases.includes("cera ve"));
  assert.equal(inferTaxonomyV69("Gel Limpiador Facial Espumoso x 473 ml", "CeraVe").primaryCategory, "limpieza");
  assert.deepEqual(inferTaxonomyV69("Crema Reparadora de Manos x 50 ml", "CeraVe").needs, ["reparacion"]);
  assert.deepEqual(inferTaxonomyV69("Loción Facial Hidratante SPF25 x 52 ml", "CeraVe"), {
    primaryCategory: "rostro",
    needs: ["hidratacion"],
    audit: {
      reasonerVersion: "v69.2-expansion-source-position",
      evidenceScope: ["name", "brand"],
      selected: [{ need: "hidratacion", source: "deterministic-title-rule" }],
      rejected: [],
    },
  });
  assert.deepEqual(inferTaxonomyV69("Crema Facial Anti-Rugosidades x 340 gr", "CeraVe").needs, ["reparacion"]);
});

test("Neutrogena, Vitamin Way y Capilatis conservan familias y usos determinísticos", () => {
  assert.deepEqual(inferTaxonomyV69("Crema Facial Hydro Boost FPS 25 Water Gel x 40 gr", "Neutrogena").needs, ["hidratacion"]);
  assert.equal(inferTaxonomyV69("Toallitas Desmaquillantes Night Calming x 25 un.", "Neutrogena").primaryCategory, "limpieza");
  assert.equal(inferTaxonomyV69("Gel de Limpeza Deep Clean Intensive x 150 gr", "Neutrogena").primaryCategory, "limpieza");
  assert.deepEqual(inferTaxonomyV69("Citrato de Magnesio x 30 cápsulas vegetales", "Vitamin Way"), {
    primaryCategory: "nutricion",
    needs: ["nutricion"],
    audit: {
      reasonerVersion: "v69.2-expansion-source-position",
      evidenceScope: ["name", "brand"],
      selected: [{ need: "nutricion", source: "deterministic-title-rule" }],
      rejected: [],
    },
  });
  assert.equal(inferTaxonomyV69("Crema de Peinar Antifrizz Para Rulos x 230 ml", "Capilatis").primaryCategory, "capilar");
  assert.equal(inferTaxonomyV69("Enjuague con Manzanilla x 500 ml", "Capilatis").primaryCategory, "capilar");
  assert.equal(inferTaxonomyV69("Crema para manos y uñas Bodytherapy x 100 g", "Capilatis").primaryCategory, "cuerpo");
});

test("Productos Saludables es una vista transversal y la ficha canónica sigue siendo única por SKU", async () => {
  const sources = discoverySourcesV69();
  const healthy = sources.find((source) => source.id === "9100");
  assert.equal(healthy.membershipOnly, true);
  assert.equal(healthy.facet.kind, "collection");

  const completedAt = "2026-08-25T12:00:00.000Z";
  const base = discoveryBaseCatalog([
    product("p-vw", "Magnesio Vitamin Way x 30 cápsulas", {
      sku: "VW-1",
      barcode: "7790000000001",
      brand: { id: "6312", slug: "vitamin-way", name: "Vitamin Way", aliases: ["vitamin way"] },
      source: { url: "https://gpsfarma.com/magnesio-vitamin-way.html" },
    }),
  ], completedAt);
  const result = await reconcileCatalogChangesV69({
    baseCatalog: base,
    completedAt,
    sources,
    detailedGroups: [
      {
        baseIndex: 0,
        detail: {},
        members: [
          listingMember("6312", "VW-1", "Magnesio Vitamin Way x 30 cápsulas", 2),
          listingMember("9100", "VW-1", "Magnesio Vitamin Way x 30 cápsulas", 18, {
            listedBrand: "Vitamin Way",
          }),
        ],
      },
      {
        baseIndex: null,
        detail: {
          sku: "LRP-RETINOL",
          barcode: "3337875694469",
          description: "Serum con retinol y vitamina B3.",
          image: "https://gpsfarma.com/media/catalog/product/l/r/lrp-retinol.jpg",
        },
        members: [
          listingMember("6048", "LRP-RETINOL", "Retinol B3 La Roche Posay x 30 ml", 8, {
            catalogBrandId: "6048",
            catalogBrandName: "La Roche Posay",
            sourceBrand: "La Roche Posay",
            listedBrand: "La Roche Posay",
            imageUrl: "https://gpsfarma.com/media/catalog/product/l/r/lrp-retinol.jpg",
          }),
        ],
      },
    ],
  });

  assert.equal(result.catalog.products.length, 2);
  assertUniqueCanonicalProductsV69(result.catalog.products);
  const existing = result.catalog.products.find((entry) => entry.sku === "VW-1");
  assert.deepEqual(existing.sourceMemberships.map((entry) => entry.sourceId).sort(), ["6312", "9100"]);
  assert.equal(existing.catalogFacets.find((entry) => entry.slug === "productos-saludables").kind, "collection");
  assert.equal(existing.brand.name, "Vitamin Way");

  const added = result.catalog.products.find((entry) => entry.sku === "LRP-RETINOL");
  assert.equal(added.barcode, "3337875694469");
  assert.equal(added.brand.name, "La Roche Posay");
  assert.deepEqual(added.needs, ["antiedad"]);
  assert.ok(added.aliases.some((alias) => /retinol/i.test(alias)));
  assert.equal(result.discoverySync.metrics.positive, 1);
  assert.equal(result.discoverySync.metrics.negative, 0);
  assert.equal(result.discoverySync.activationReady, false);
});

test("la ficha técnica resuelve la marca real y repara el legado de Productos Saludables", async () => {
  const completedAt = "2026-08-25T12:00:00.000Z";
  const detail = parseProductDetailV69(`
    <table><tbody><tr>
      <th class="col label" scope="row">Marca</th>
      <td class="col data" data-th="Marca">Supradyn</td>
    </tr></tbody></table>
  `);
  assert.equal(detail.brand, "Supradyn");

  const base = discoveryBaseCatalog([
    product("p-legacy-healthy", "Suplemento Dietario Supradyn x 30 comp", {
      sku: "HEALTHY-LEGACY-1",
      brand: {
        id: "9100",
        slug: "productos-saludables",
        name: "Productos Saludables",
        aliases: ["productos saludables"],
      },
      line: "Productos Saludables",
      aliases: ["Productos Saludables"],
      source: { url: "https://gpsfarma.com/supradyn-30.html" },
    }),
  ], completedAt);
  const member = listingMember(
    "9100",
    "HEALTHY-LEGACY-1",
    "Suplemento Dietario Supradyn x 30 comp",
    4,
  );
  const enriched = await enrichListingGroupsV69(
    [{ baseIndex: 0, members: [member], detail: {} }],
    {
      baseCatalog: base,
      fetchHtml: async () => `
        <table><tbody>
          <tr><th>SKU</th><td>HEALTHY-LEGACY-1</td></tr>
          <tr><th>Marca</th><td data-th="Marca">Supradyn</td></tr>
        </tbody></table>
      `,
    },
  );
  enriched[0].detail = {
    ...enriched[0].detail,
    sku: "HEALTHY-LEGACY-1",
    brand: "Supradyn",
  };
  const result = await reconcileCatalogChangesV69({
    baseCatalog: base,
    detailedGroups: enriched,
    completedAt,
    sources: discoverySourcesV69(),
  });
  const repaired = result.catalog.products[0];
  assert.equal(repaired.brand.name, "Supradyn");
  assert.notEqual(repaired.brand.id, "9100");
  assert.equal(repaired.line, "Supradyn");
  assert.equal(
    repaired.catalogFacets.find((entry) => entry.slug === "productos-saludables")?.kind,
    "collection",
  );
  assert.equal(result.discoverySync.metrics.positive, 0);
});

test("VitaminWay se canoniza como Vitamin Way sin crear otra marca", () => {
  const product = newProductFromSourceGroupV69(
    {
      detail: {
        sku: "VITAMIN-WAY-COMPACT",
        barcode: "7790000000999",
        brand: "VitaminWay",
        image: "https://gpsfarma.com/media/catalog/product/vitamin-way.jpg",
      },
      members: [
        listingMember("9100", "VITAMIN-WAY-COMPACT", "Vitamina C x 30 cápsulas", 9, {
          imageUrl: "https://gpsfarma.com/media/catalog/product/vitamin-way.jpg",
        }),
      ],
    },
    "2026-08-25T12:00:00.000Z",
  );
  assert.equal(product.brand.name, "Vitamin Way");
  assert.equal(product.brand.id, "6312");
  assert.equal(
    product.catalogFacets.find((entry) => entry.slug === "productos-saludables")?.kind,
    "collection",
  );
});

test("un título idéntico nunca fusiona dos fichas base cuando un listing no expone SKU", () => {
  const title = "Crema Facial Pro Lifting De Día x 55 g";
  const groups = consolidateDetailedGroupsV69([
    {
      baseIndex: 2,
      detail: {},
      members: [listingMember("5704", "BAGOVIT-A", title, 1)],
    },
    {
      baseIndex: 7,
      detail: {},
      members: [listingMember("5704", "", title, 2, {
        sourceUrl: "https://gpsfarma.com/bagovit-pro-lifting-alternativa.html",
        availability: "unavailable",
      })],
    },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.baseIndex).sort((a, b) => a - b), [2, 7]);
});

test("el scan semanal elimina sólo una baja 404/410 y aborta ante una ausencia ambigua", async () => {
  const completedAt = "2026-08-25T12:00:00.000Z";
  const retained = product("p-retained", "Producto vigente x 30 ml", {
    sku: "KEEP-1",
    barcode: "7790000000100",
    source: { url: "https://gpsfarma.com/vigente.html" },
  });
  const removed = product("p-removed", "Producto discontinuado x 30 ml", {
    sku: "DROP-1",
    barcode: "7790000000101",
    source: { url: "https://gpsfarma.com/discontinuado.html" },
  });
  const base = discoveryBaseCatalog([retained, removed], completedAt);
  const matched = {
    baseIndex: 0,
    detail: {},
    members: [listingMember("5930", "KEEP-1", retained.name, 1)],
  };
  const removedResult = await reconcileCatalogChangesV69({
    baseCatalog: base,
    detailedGroups: [matched],
    completedAt,
    fetchHtml: async () => {
      throw new Error("404 Not Found: https://gpsfarma.com/discontinuado.html");
    },
  });
  assert.deepEqual(removedResult.catalog.products.map((entry) => entry.publicId), ["p-retained"]);
  assert.equal(removedResult.discoverySync.metrics.negative, 1);

  await assert.rejects(
    reconcileCatalogChangesV69({
      baseCatalog: base,
      detailedGroups: [matched],
      completedAt,
      fetchHtml: async () => {
        throw new Error("503 Service Unavailable");
      },
    }),
    /No se pudo confirmar una baja V6.9/,
  );
});

test("el reindexado semanal reconstruye necesidades desde evidencia viva", () => {
  const indexedAt = "2026-08-25T12:00:00.000Z";
  const catalog = reindexCatalogV69({
    version: 6.9,
    products: [
      product("p-index", "Retinol B3 Serum x 30 ml", {
        sku: "INDEX-1",
        needs: ["cuidado-diario"],
        aliases: ["serum"],
        magentoCategories: [{ id: "1", name: "Tratamiento Anti-Edad" }],
      }),
    ],
  }, indexedAt);
  assert.deepEqual(catalog.products[0].needs, ["antiedad"]);
  assert.equal(catalog.products[0].primaryCategory, "rostro");
  assert.ok(catalog.products[0].aliases.includes("Tratamiento Anti-Edad"));
  assert.equal(catalog.products[0].taxonomy.indexedAt, indexedAt);
  assert.equal(catalog.searchIndexedAt, indexedAt);
  assert.equal(catalog.needsIndexedAt, indexedAt);
});

test("el candidato semanal sólo queda activable después de imágenes GCS y taxonomía embebida", async () => {
  const completedAt = "2026-08-25T12:00:00.000Z";
  const base = discoveryBaseCatalog([
    product("p-weekly", "Retinol B3 Serum x 30 ml", {
      sku: "WEEKLY-1",
      barcode: "3337875694469",
      images: {
        card: "https://gpsfarma.com/media/catalog/product/weekly.jpg",
        detail: "https://gpsfarma.com/media/catalog/product/weekly.jpg",
        original: "https://gpsfarma.com/media/catalog/product/weekly.jpg",
      },
    }),
  ], completedAt);
  base.discoverySync = {
    completedAt,
    status: "completed",
    metrics: { positive: 1 },
    addedPublicIds: ["p-weekly"],
    removedPublicIds: [],
    negativePendingPublicIds: [],
    activationReady: false,
  };
  const result = await finalizeCatalogDiscoveryV69({
    catalog: base,
    prepareImages: async ({ catalog }) => ({
      ...catalog,
      products: catalog.products.map((entry) => ({
        ...entry,
        images: responsiveGcsImages("weekly"),
      })),
    }),
    rebuildTaxonomy: async ({ catalog }) => attachMagentoTaxonomyV69(catalog, {
      categories: [{ id: 8504, name: "Tratamiento Anti-Edad", breadcrumbs: [] }],
      products: [{ publicId: "p-weekly", categoryIds: [8504] }],
    }),
  });
  assert.equal(result.discoverySync.activationReady, true);
  assert.equal(result.catalog.products[0].magentoTaxonomyAttached, true);
  assert.deepEqual(result.catalog.products[0].needs, ["antiedad"]);
  assertRuntimeAssetsV69(result.catalog.products);
});

test("el candidato semanal aborta si conserva cambios pendientes", async () => {
  const completedAt = "2026-08-25T12:00:00.000Z";
  const base = discoveryBaseCatalog([
    product("p-pending", "Producto pendiente x 30 ml", {
      sku: "PENDING-1",
      images: responsiveGcsImages("pending"),
    }),
  ], completedAt);
  base.discoverySync = {
    completedAt,
    status: "completed",
    metrics: { positive: 0, positivePending: 1, negativePending: 0 },
    addedPublicIds: [],
    removedPublicIds: [],
    negativePendingPublicIds: [],
    activationReady: false,
  };
  await assert.rejects(
    finalizeCatalogDiscoveryV69({ catalog: base }),
    /cambios positivos o negativos pendientes/,
  );
});

test("parser de listing conserva URL confiable y calcula oferta/descuento", () => {
  const products = parseListingProducts(PAGE_1, EUCERIN);
  assert.equal(products.length, 1);
  assert.equal(products[0].sourceName, "Sérum Eucerin Demo x 30 ml");
  assert.equal(products[0].sourceBrand, "Eucerin");
  assert.equal(products[0].listPrice, 10000);
  assert.equal(products[0].offerPrice, 7000);
  assert.equal(products[0].savingAmount, 3000);
  assert.equal(products[0].discountPercent, 30);
  assert.equal(products[0].availability, "available");
  assert.equal(
    normalizeGpsImagePath(products[0].imageUrl),
    "/media/catalog/product/demo/serum-30.jpg",
  );
  assert.equal(
    normalizeGpsProductUrl(products[0].sourceUrl),
    "gpsfarma.com/eucerin-serum-demo-30-ml.html",
  );
});

test("parser acepta precio regular y detecta el enlace siguiente", () => {
  const products = parseListingProducts(PAGE_2, EUCERIN);
  assert.equal(products.length, 1);
  assert.equal(products[0].listPrice, 12500.5);
  assert.equal(products[0].offerPrice, 12500.5);
  assert.equal(products[0].discountPercent, 0);
  assert.equal(products[0].availability, "available");
  assert.match(parseNextPageUrl(PAGE_1), /[?&]p=2(?:&|$)/);
  assert.equal(parseNextPageUrl(PAGE_2), null);
});

test("el parser usa sólo los marcadores explícitos del listado para disponibilidad", () => {
  const products = parseListingProducts(
    `
      <li class="item product product-item">
        <a class="product-item-link" href="/con-stock.html">Con stock</a>
        <form data-role="tocart-form" data-product-sku="SKU-CON-STOCK" action="/checkout/cart/add/uenc/aHR0cHM6Ly8/"></form>
      </li>
      <li class="item product product-item">
        <a class="product-item-link" href="/sin-stock.html">Sin stock</a>
        <div class="stock unavailable"><span>Sin stock</span></div>
        <script type="text/x-magento-init">{ "[data-role=tocart-form]": { "catalogAddToCart": { "product_sku": "SKU-SIN-STOCK" } } }</script>
      </li>
      <li class="item product product-item">
        <a class="product-item-link" href="/a-confirmar.html">A confirmar</a>
      </li>
    `,
    EUCERIN,
  );

  assert.deepEqual(
    products.map((product) => product.availability),
    ["available", "unavailable", "unknown"],
  );
  assert.deepEqual(
    products.map((product) => product.sku),
    ["SKU-CON-STOCK", "SKU-SIN-STOCK", ""],
  );
});

test("la ficha técnica conserva SKU privado y código de barras validado", () => {
  const identity = parseProductIdentityV69(`
    <table><tbody>
      <tr><th>SKU</th><td>216771</td></tr>
      <tr><th>Código de barra</th><td data-th="C&#xF3;digo&#x20;de&#x20;barra">3337875731409</td></tr>
    </tbody></table>
  `);
  assert.deepEqual(identity, { sku: "216771", barcode: "3337875731409" });
  assert.deepEqual(
    parseProductIdentityV69(`<tr><th>Código de barra</th><td>123</td></tr>`),
    { sku: "", barcode: "" },
  );
});

test("la identidad se completa sin modificar fichas ni aceptar contradicciones", async () => {
  const base = {
    version: 6.9,
    products: [
      product("p-identidad", "Producto con identidad", {
        source: { url: "https://gpsfarma.com/producto-identidad.html" },
      }),
    ],
  };
  const enriched = await enrichCatalogIdentitiesV69(base, {
    fetchHtml: async () => `
      <tr><th>SKU</th><td>248860</td></tr>
      <tr><th>Código de barras</th><td>3337875533713</td></tr>
    `,
    onProgress: () => {},
  });
  assert.equal(enriched.catalog.products[0].sku, "248860");
  assert.equal(enriched.catalog.products[0].barcode, "3337875533713");
  assert.equal(enriched.metrics.coverage, 1);

  await assert.rejects(
    enrichCatalogIdentitiesV69(
      { ...base, products: [{ ...base.products[0], sku: "OTRO" }] },
      {
        fetchHtml: async () => `<tr><th>SKU</th><td>248860</td></tr><tr><th>Código de barra</th><td>3337875533713</td></tr>`,
        onProgress: () => {},
      },
    ),
    /contradice 1 producto/i,
  );
});

test("la ubicación comercial por defecto es Rosario y valida sus identificadores", () => {
  assert.deepEqual(DEFAULT_INVENTORY_SCOPE_V69, {
    label: "Rosario",
    regionId: 722,
    cityId: 152,
    inventorySource: "STOM",
  });
  assert.deepEqual(inventoryScopeV69({}), DEFAULT_INVENTORY_SCOPE_V69);
  assert.throws(
    () => inventoryScopeV69({ V69_SYNC_LOCATION_REGION_ID: "Rosario" }),
    /V69_SYNC_LOCATION_REGION_ID debe ser un entero positivo/,
  );
  assert.throws(
    () => inventoryScopeV69({ V69_SYNC_INVENTORY_SOURCE: "AVELL" }),
    /sólo admite la fuente de inventario STOM/,
  );
  assert.throws(
    () => inventoryScopeV69({ V69_SYNC_LOCATION_CITY_ID: "124" }),
    /sólo admite la localidad Rosario configurada para STOM/,
  );
});

test("la frontera HTTPS rechaza host, protocolo y credenciales ajenos", () => {
  assert.match(trustedGpsUrl("/categorias.html"), /^https:\/\/gpsfarma\.com\//);
  assert.throws(() => trustedGpsUrl("http://gpsfarma.com/categorias.html"), /no permitido/i);
  assert.throws(() => trustedGpsUrl("https://evil.example/categorias.html"), /no permitido/i);
  assert.throws(() => trustedGpsUrl("https://user:pass@gpsfarma.com/"), /no permitido/i);
});

test("normaliza el separador opcional antes de una medida sin perder la variante", () => {
  const catalogTitle = "Mascarilla Capilar Vichy Dercos Kera Solutions 200ml";
  const listingTitle = "Mascarilla Capilar Vichy Dercos Kera Solutions x 200 ml";
  assert.equal(normalizeProductText(catalogTitle), normalizeProductText(listingTitle));
  assert.equal(productTitleMatchScore(catalogTitle, listingTitle), 1);
});

test("Productos Saludables acepta título exacto de otra marca, pero no uno difuso", () => {
  const healthyProduct = product("p-saludable", "Colágeno + Hialurónico VWN x 30 Cápsulas", {
    brand: {
      id: "9100",
      slug: "productos-saludables",
      name: "Productos Saludables",
      aliases: [],
    },
  });
  const exactCandidate = {
    sourceUrl: "https://gpsfarma.com/colageno-hialuronico-vwn.html",
    sourceName: "Colágeno + Hialurónico VWN 30 Cápsulas",
    sourceBrand: "Vitamin Way",
  };
  const fuzzyCandidate = {
    ...exactCandidate,
    sourceUrl: "https://gpsfarma.com/colageno-hialuronico-otra-marca.html",
    sourceName: "Colágeno + Hialurónico Otra Marca 30 Cápsulas",
  };

  assert.equal(candidateBrandMatchesProduct(healthyProduct, exactCandidate), true);
  assert.equal(candidateBrandMatchesProduct(healthyProduct, fuzzyCandidate), false);
  assert.equal(bestProductCandidate(healthyProduct, [exactCandidate])?.confidence, 1);
  assert.equal(bestProductCandidate(healthyProduct, [fuzzyCandidate]), null);
});

test("un candidato reservado por URL no puede reutilizarse por título", () => {
  const sharedUrl = "https://gpsfarma.com/colageno-hialuronico-vwn.html";
  const virtualBrand = {
    id: "9100",
    slug: "productos-saludables",
    name: "Productos Saludables",
    aliases: [],
  };
  const result = synchronizeCatalog(
    {
      version: 6.8,
      products: [
        product("p-sin-url", "Colágeno + Hialurónico VWN x 30 Cápsulas", {
          brand: virtualBrand,
          source: {},
        }),
        product("p-con-url", "Colágeno + Hialurónico VWN x 30 Cápsulas", {
          brand: virtualBrand,
          source: { url: sharedUrl },
        }),
      ],
    },
    [
      {
        id: "9100",
        catalogBrandId: "9100",
        catalogBrandName: "Productos Saludables",
        status: "completed",
        pages: [{ page: 1 }],
        products: [
          {
            sourceUrl: sharedUrl,
            sourceName: "Colágeno + Hialurónico VWN 30 Cápsulas",
            sourceBrand: "Vitamin Way",
            availability: "available",
            listPrice: 100,
            offerPrice: 100,
            savingAmount: 0,
            discountPercent: 0,
          },
        ],
      },
    ],
    {
      minCoverage: 0.5,
      minPriceCoverage: 1,
      expectedSourceIds: ["9100"],
    },
  );

  assert.equal(result.products[0].availability, "unknown");
  assert.equal(result.products[1].availability, "limited");
  assert.equal(result.commerceSync.metrics.matched, 1);
});

test("el refresh comercial sigue la membresía transversal sin convertir la vista en marca", () => {
  const sourceUrl = "https://gpsfarma.com/magnesio-vitamin-way.html";
  const result = synchronizeCatalog(
    {
      version: 6.9,
      products: [
        product("p-cross-view", "Magnesio Vitamin Way x 30 cápsulas", {
          sku: "VW-CROSS-1",
          brand: { id: "6312", slug: "vitamin-way", name: "Vitamin Way", aliases: ["vitamin way"] },
          source: { url: sourceUrl },
          sourceMemberships: [{
            sourceId: "9100",
            viewSlug: "productos-saludables",
            viewName: "Productos Saludables",
            viewKind: "collection",
            membershipOnly: true,
            position: 5,
          }],
        }),
      ],
    },
    [
      {
        id: "9100",
        catalogBrandId: "9100",
        catalogBrandName: "Productos Saludables",
        status: "completed",
        pages: [{ page: 1 }],
        products: [{
          sourceUrl,
          sourceName: "Magnesio Vitamin Way x 30 cápsulas",
          sourceBrand: "Vitamin Way",
          sku: "VW-CROSS-1",
          availability: "available",
          listPrice: 1000,
          offerPrice: 900,
          savingAmount: 100,
          discountPercent: 10,
        }],
      },
    ],
    {
      completedAt: "2026-08-25T12:00:00.000Z",
      minCoverage: 1,
      minPriceCoverage: 1,
      expectedSourceIds: ["9100"],
    },
  );
  assert.equal(result.products[0].availability, "limited");
  assert.equal(result.products[0].brand.name, "Vitamin Way");
  assert.equal(result.commerceSync.metrics.matchedByUrl, 1);
});

test("crawl sigue todo el paginado y termina sin duplicar productos", async () => {
  const firstUrl = sourceStartUrl(EUCERIN);
  const requested = [];
  const result = await crawlSource(EUCERIN, {
    delayMs: 0,
    fetchHtml: async (url) => {
      requested.push(url);
      return url === firstUrl ? PAGE_1 : PAGE_2;
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.pages.length, 2);
  assert.equal(result.products.length, 2);
  assert.equal(requested.length, 2);
});

test("crawl falla visiblemente ante loop de URL o página repetida", async () => {
  const selfLoop = PAGE_1.replace(/href="https:\/\/gpsfarma\.com\/categorias\.html\?[^"]+"/, `href="${sourceStartUrl(EUCERIN).replaceAll("&", "&amp;")}"`);
  await assert.rejects(
    crawlSource(EUCERIN, { delayMs: 0, fetchHtml: async () => selfLoop }),
    /Bucle de paginación/i,
  );

  const pageTwoWithNext = PAGE_1.replaceAll(
    "eucerin-serum-demo-30-ml",
    "eucerin-serum-demo-30-ml",
  );
  let calls = 0;
  await assert.rejects(
    crawlSource(EUCERIN, {
      delayMs: 0,
      fetchHtml: async () => {
        calls += 1;
        return calls === 1 ? PAGE_1 : pageTwoWithNext;
      },
    }),
    /Página repetida/i,
  );
});

test("sincroniza URL primero, título confiable después y no autoagrega candidatos", () => {
  const description = "Texto médico estructurado que debe permanecer exactamente igual.";
  const taxonomy = { reasonerVersion: "v68-test", selected: [{ need: "hidratacion" }] };
  const base = {
    version: 6.8,
    syncedAt: "2026-07-25T06:39:05.518Z",
    totalProducts: 4,
    products: [
      product("p-url", "Sérum Eucerin Demo x 30 ml", {
        source: { url: "https://gpsfarma.com/eucerin-serum-demo-30-ml.html" },
        description,
        taxonomy,
      }),
      product("p-out", "Producto Eucerin Retirado x 40 ml", {
        source: { url: "https://gpsfarma.com/categorias/producto-retirado-40-ml.html" },
      }),
      product("p-title", "Crema Eucerin Demo x 50 ml"),
      product("p-unknown", "Producto Eucerin sin vínculo x 77 ml"),
    ],
  };
  const result = synchronizeCatalog(
    base,
    [
      {
        id: "5930",
        catalogBrandId: "5930",
        catalogBrandName: "Eucerin",
        status: "completed",
        pages: [{ page: 1 }],
        products: [
          ...parseListingProducts(PAGE_1, EUCERIN),
          ...parseListingProducts(PAGE_2, EUCERIN),
          {
            sourceId: "5930",
            catalogBrandId: "5930",
            catalogBrandName: "Eucerin",
            sourceUrl: "https://gpsfarma.com/candidato-nuevo.html",
            sourceName: "Producto Eucerin Nuevo x 90 ml",
            sourceBrand: "Eucerin",
            listPrice: 5000,
            offerPrice: 4500,
            savingAmount: 500,
            discountPercent: 10,
          },
        ],
      },
    ],
    {
      completedAt: "2026-07-30T12:00:00.000Z",
      minCoverage: 0.5,
      minPriceCoverage: 0.8,
      expectedSourceIds: ["5930"],
    },
  );

  assert.equal(result.version, 6.9);
  assert.equal(result.products.length, 4);
  assert.equal(result.products[0].availability, "limited");
  assert.equal(result.products[0].offerPrice, 7000);
  assert.equal(result.products[0].description, description);
  assert.deepEqual(result.products[0].taxonomy, taxonomy);
  assert.equal(result.products[1].availability, "unknown");
  assert.equal(result.products[2].availability, "limited");
  assert.equal(result.products[2].offerPrice, 12500.5);
  assert.equal(result.products[3].availability, "unknown");
  assert.equal(result.products[3].availabilityCheckedAt, null);
  assert.deepEqual(result.commerceSync.metrics, {
    catalogProducts: 4,
    listedProducts: 3,
    matchedByUrl: 1,
    matchedByImage: 0,
    matchedByTitle: 1,
    matched: 2,
    available: 2,
    unavailable: 0,
    unverified: 2,
    verified: 2,
    availabilityCoverage: 0.5,
    pricesUpdated: 2,
    newCandidates: 1,
    coverage: 0.5,
    priceCoverage: 1,
    inventoryLocation: "Rosario",
  });
});

test("una ausencia del listado no se publica como sin stock", () => {
  const result = synchronizeCatalog(
    {
      version: 6.8,
      products: [
        product("p-no-listado", "Producto sin coincidencia x 50 ml", {
          source: { url: "https://gpsfarma.com/no-listado.html" },
        }),
      ],
    },
    [
      {
        id: "5930",
        catalogBrandId: "5930",
        catalogBrandName: "Eucerin",
        status: "completed",
        pages: [{ page: 1 }],
        products: [
          {
            sourceId: "5930",
            catalogBrandId: "5930",
            catalogBrandName: "Eucerin",
            sourceUrl: "https://gpsfarma.com/otro-producto.html",
            sourceName: "Otro producto x 99 ml",
            sourceBrand: "Eucerin",
            availability: "available",
            listPrice: 100,
            offerPrice: 100,
            savingAmount: 0,
            discountPercent: 0,
          },
        ],
      },
    ],
    { minCoverage: 0, minPriceCoverage: 0, expectedSourceIds: ["5930"] },
  );

  assert.equal(result.products[0].availability, "unknown");
  assert.equal(result.products[0].availabilityCheckedAt, null);
  assert.equal(result.commerceSync.metrics.unavailable, 0);
});

test("un marcador explícito de sin stock se conserva", () => {
  const result = synchronizeCatalog(
    {
      version: 6.8,
      products: [
        product("p-sin-stock", "Producto sin stock x 50 ml", {
          source: { url: "https://gpsfarma.com/sin-stock.html" },
        }),
      ],
    },
    [
      {
        id: "5930",
        catalogBrandId: "5930",
        catalogBrandName: "Eucerin",
        status: "completed",
        pages: [{ page: 1 }],
        products: [
          {
            sourceId: "5930",
            catalogBrandId: "5930",
            catalogBrandName: "Eucerin",
            sourceUrl: "https://gpsfarma.com/sin-stock.html",
            sourceName: "Producto sin stock x 50 ml",
            sourceBrand: "Eucerin",
            availability: "unavailable",
            listPrice: 100,
            offerPrice: 100,
            savingAmount: 0,
            discountPercent: 0,
          },
        ],
      },
    ],
    {
      completedAt: "2026-07-30T12:00:00.000Z",
      minCoverage: 1,
      minPriceCoverage: 1,
      expectedSourceIds: ["5930"],
    },
  );

  assert.equal(result.products[0].availability, "out_of_stock");
  assert.equal(result.products[0].availabilityCheckedAt, "2026-07-30T12:00:00.000Z");
  assert.equal(result.commerceSync.metrics.unavailable, 1);
});

test("una URL migrada conserva disponibilidad si imagen o título identifican el producto", () => {
  const result = synchronizeCatalog(
    {
      version: 6.8,
      products: [
        product("p-moved", "Sérum Eucerin Demo x 30 ml", {
          source: { url: "https://gpsfarma.com/url-anterior-serum-demo.html" },
          images: {
            card: "https://gpsfarma.com/media/catalog/product/anterior.jpg",
            detail: "https://gpsfarma.com/media/catalog/product/anterior.jpg",
            original: "https://gpsfarma.com/media/catalog/product/anterior.jpg",
          },
        }),
      ],
    },
    [
      {
        id: "5930",
        catalogBrandId: "5930",
        catalogBrandName: "Eucerin",
        status: "completed",
        pages: [{ page: 1 }],
        products: parseListingProducts(PAGE_1, EUCERIN),
      },
    ],
    {
      completedAt: "2026-07-30T12:00:00.000Z",
      minCoverage: 1,
      minPriceCoverage: 1,
      expectedSourceIds: ["5930"],
    },
  );

  assert.equal(result.products[0].availability, "limited");
  assert.equal(
    normalizeGpsProductUrl(result.products[0].source.url),
    "gpsfarma.com/eucerin-serum-demo-30-ml.html",
  );
  assert.equal(result.commerceSync.metrics.matchedByTitle, 1);
  assert.equal(result.commerceSync.metrics.unavailable, 0);
});

test("una fuente incompleta o una cobertura baja abortan el dataset", () => {
  const base = {
    version: 6.8,
    products: [product("p1", "Sérum Eucerin Demo x 30 ml")],
  };
  assert.throws(
    () =>
      synchronizeCatalog(base, [
        {
          id: "5930",
          catalogBrandId: "5930",
          catalogBrandName: "Eucerin",
          status: "failed",
          pages: [],
          products: [],
        },
      ]),
    /incompleta/i,
  );
  assert.throws(
    () =>
      synchronizeCatalog(
        base,
        [
          {
            id: "5930",
            catalogBrandId: "5930",
            catalogBrandName: "Eucerin",
            status: "completed",
            pages: [{ page: 1 }],
            products: [
              {
                sourceUrl: "https://gpsfarma.com/otro-producto.html",
                sourceName: "Otro producto x 99 ml",
                sourceBrand: "Eucerin",
                listPrice: 100,
                offerPrice: 100,
              },
            ],
          },
        ],
        { minCoverage: 0.9, minPriceCoverage: 0, expectedSourceIds: ["5930"] },
      ),
    /Cobertura comercial insuficiente/i,
  );
});

test("rechaza una corrida que no complete exactamente el conjunto esperado de fuentes", () => {
  const source = {
    id: "5930",
    catalogBrandId: "5930",
    catalogBrandName: "Eucerin",
    status: "completed",
    pages: [{ page: 1 }],
    products: parseListingProducts(PAGE_1, EUCERIN),
  };
  assert.throws(
    () =>
      synchronizeCatalog(
        { version: 6.8, products: [product("p1", "Sérum Eucerin Demo x 30 ml")] },
        [source],
        { expectedSourceIds: ["5930", "5808"], minCoverage: 0, minPriceCoverage: 0 },
      ),
    /exactamente 2 fuentes/i,
  );
});

test("dry-run es el default operativo y no llama a la escritura", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "fg-v69-sync-test-"));
  await fs.mkdir(path.join(rootDir, "data"));
  await fs.writeFile(
    path.join(rootDir, "data", "catalog-v68.json"),
    JSON.stringify({
      version: 6.8,
      products: [
        product("p1", "Sérum Eucerin Demo x 30 ml", {
          source: { url: "https://gpsfarma.com/categorias/eucerin-serum-demo-30-ml.html" },
        }),
      ],
    }),
  );
  let writes = 0;
  try {
    const result = await runCommercialSync({
      rootDir,
      sources: [EUCERIN],
      fetchHtml: async () => PAGE_1.replace(/<ul class="items pages-items">[\s\S]*?<\/ul>/, ""),
      minCoverage: 1,
      minPriceCoverage: 1,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      onProgress: () => {},
      writeCatalog: async () => {
        writes += 1;
      },
    });
    assert.equal(result.mode, "dry-run");
    assert.equal(result.written, false);
    assert.equal(writes, 0);
    await assert.rejects(fs.access(path.join(rootDir, "data", "catalog-v69.json")));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("escritura JSON atómica deja un archivo completo sin temporales", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "fg-v69-atomic-test-"));
  const output = path.join(rootDir, "data", "catalog-v69.json");
  try {
    await writeJsonAtomically(output, { version: 6.9, products: [{ publicId: "p1" }] });
    assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), {
      version: 6.9,
      products: [{ publicId: "p1" }],
    });
    assert.deepEqual(
      (await fs.readdir(path.dirname(output))).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

function product(publicId, name, overrides = {}) {
  return {
    publicId,
    slug: `${publicId}-slug`,
    name,
    brand: { id: "5930", slug: "eucerin", name: "Eucerin", aliases: ["eucerin"] },
    line: "Eucerin",
    primaryCategory: "rostro",
    categorySlugs: ["rostro"],
    needs: ["hidratacion"],
    aliases: [],
    description: "Descripción original.",
    listPrice: 1000,
    offerPrice: 900,
    savingAmount: 100,
    discountPercent: 10,
    availability: "unknown",
    images: { card: "/card.jpg", detail: "/detail.jpg", original: "/original.jpg" },
    ...overrides,
  };
}

function listingMember(sourceId, sku, sourceName, position, overrides = {}) {
  const source = discoverySourcesV69().find((entry) => String(entry.id) === String(sourceId));
  const slug = String(sku).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    sourceId: String(source.id),
    catalogBrandId: source.catalogBrandId,
    catalogBrandName: source.catalogBrandName,
    catalogFacet: source.facet,
    sourceMembershipOnly: Boolean(source.membershipOnly),
    sourceUrl: "https://gpsfarma.com/" + slug + ".html",
    sourceName,
    sourceBrand: source.catalogBrandName,
    listedBrand: source.catalogBrandName,
    imageUrl: "https://gpsfarma.com/media/catalog/product/" + slug + ".jpg",
    sku,
    availability: "available",
    listPrice: 1000,
    offerPrice: 900,
    savingAmount: 100,
    discountPercent: 10,
    position,
    ...overrides,
  };
}

function discoveryBaseCatalog(products, completedAt) {
  const readyProducts = products.map((entry) => ({
    ...entry,
    availability: "limited",
    availabilityCheckedAt: completedAt,
  }));
  return {
    version: 6.9,
    syncedAt: completedAt,
    commerceSyncedAt: completedAt,
    availabilityReferenceAt: completedAt,
    totalProducts: readyProducts.length,
    products: readyProducts,
    commerceSync: {
      completedAt,
      status: "completed",
      sources: discoverySourcesV69().map((source) => ({
        id: String(source.id),
        status: "completed",
      })),
      metrics: {
        catalogProducts: readyProducts.length,
        matched: readyProducts.length,
        available: readyProducts.length,
        unavailable: 0,
        unverified: 0,
        verified: readyProducts.length,
        availabilityCoverage: 1,
        pricesUpdated: readyProducts.length,
        coverage: 1,
        priceCoverage: 1,
      },
    },
  };
}

function responsiveGcsImages(slug) {
  const original = "https://storage.googleapis.com/test-images/v69/" + slug + ".jpg";
  const variants = {
    width: 1000,
    height: 1000,
    webp: { "320": "https://storage.googleapis.com/test-images/v69/" + slug + "-320.webp" },
    avif: { "320": "https://storage.googleapis.com/test-images/v69/" + slug + "-320.avif" },
  };
  return {
    card: original,
    detail: original,
    original,
    responsive: { card: variants, detail: variants },
  };
}
