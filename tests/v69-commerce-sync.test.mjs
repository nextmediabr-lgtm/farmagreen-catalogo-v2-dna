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

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PAGE_1 = await fs.readFile(path.join(FIXTURES, "gpsfarma-list-page-1.html"), "utf8");
const PAGE_2 = await fs.readFile(path.join(FIXTURES, "gpsfarma-list-page-2.html"), "utf8");
const EUCERIN = GPS_SOURCES_V69.find((source) => source.id === "5930");

test("declara exactamente las 11 fuentes comerciales de V6.9", () => {
  assert.equal(GPS_SOURCES_V69.length, 11);
  assert.deepEqual(
    GPS_SOURCES_V69.map((source) => source.id),
    ["5930", "5808", "5751", "6048", "6301", "6023", "5756", "5697", "5911", "9100", "revitalift"],
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
