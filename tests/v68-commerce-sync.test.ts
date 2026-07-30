import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MIN_COVERAGE,
  DEFAULT_MIN_PRICE_COVERAGE,
  GPS_SOURCES_V68,
  synchronizeCatalog,
} from "../scripts/sync-catalog-commerce-v68.mjs";

test("V6.8 conserva contenido, no autoagrega candidatos y produce triestado", () => {
  const sources = completeSources();
  sources[0].products = [
    candidate("https://gpsfarma.com/catalogo/producto-disponible.html", "Producto disponible"),
  ];
  const base = {
    version: 6.8,
    syncedAt: "2026-07-25T06:39:05.518Z",
    totalProducts: 3,
    products: [
      product("p1", "Producto disponible", {
        source: { url: "https://gpsfarma.com/catalogo/producto-disponible.html" },
        description: "Descripción editorial completa.",
        taxonomy: { confidence: 0.97 },
      }),
      product("p2", "Producto retirado", {
        source: { url: "https://gpsfarma.com/catalogo/producto-retirado.html" },
      }),
      product("p3", "Nombre sin coincidencia", {}),
    ],
  };

  const result = synchronizeCatalog(base, sources, {
    completedAt: "2026-07-30T08:00:00.000Z",
    minCoverage: 0.6,
    minPriceCoverage: 0.95,
  });

  assert.equal(result.version, 6.8);
  assert.equal(result.products.length, 3);
  assert.equal(result.totalProducts, 3);
  assert.equal(result.commerceSyncedAt, "2026-07-30T08:00:00.000Z");
  assert.equal(result.products[0].availability, "limited");
  assert.equal(result.products[1].availability, "out_of_stock");
  assert.equal(result.products[2].availability, "unknown");
  assert.equal(result.products[0].description, "Descripción editorial completa.");
  assert.deepEqual(result.products[0].taxonomy, { confidence: 0.97 });
  assert.equal(result.commerceSync.sources.length, 11);
  assert.equal(result.commerceSync.metrics.newCandidates, 10);
});

test("los gates 95% cobertura y 95% precios son el default", () => {
  assert.equal(DEFAULT_MIN_COVERAGE, 0.95);
  assert.equal(DEFAULT_MIN_PRICE_COVERAGE, 0.95);
  const sources = completeSources();
  sources[0].products = [
    candidate("https://gpsfarma.com/catalogo/producto-disponible.html", "Producto disponible"),
  ];
  const base = {
    version: 6.8,
    syncedAt: "2026-07-25T06:39:05.518Z",
    totalProducts: 3,
    products: [
      product("p1", "Producto disponible", {
        source: { url: "https://gpsfarma.com/catalogo/producto-disponible.html" },
      }),
      product("p2", "Producto retirado", {
        source: { url: "https://gpsfarma.com/catalogo/producto-retirado.html" },
      }),
      product("p3", "Nombre sin coincidencia", {}),
    ],
  };
  assert.throws(() => synchronizeCatalog(base, sources), /Cobertura comercial insuficiente/);

  const oneProductBase = {
    ...base,
    totalProducts: 1,
    products: [base.products[0]],
  };
  sources[0].products = [
    {
      ...candidate(
        "https://gpsfarma.com/catalogo/producto-disponible.html",
        "Producto disponible",
      ),
      listPrice: 0,
      offerPrice: 0,
    },
  ];
  assert.throws(
    () => synchronizeCatalog(oneProductBase, sources),
    /Cobertura de precios insuficiente/,
  );
});

test("exige exactamente las 11 fuentes completas", () => {
  const base = {
    version: 6.8,
    syncedAt: "2026-07-25T06:39:05.518Z",
    totalProducts: 1,
    products: [
      product("p1", "Producto disponible", {
        source: { url: "https://gpsfarma.com/catalogo/producto-disponible.html" },
      }),
    ],
  };
  assert.throws(
    () => synchronizeCatalog(base, completeSources().slice(0, 10)),
    /exactamente 11 fuentes/,
  );
});

function completeSources() {
  return GPS_SOURCES_V68.map((source, index) => ({
    id: source.id,
    catalogBrandId: source.catalogBrandId,
    catalogBrandName: source.catalogBrandName,
    status: "completed",
    pages: [{ page: 1 }],
    products: [
      candidate(
        `https://gpsfarma.com/catalogo/candidato-${index + 1}.html`,
        `Candidato ${index + 1}`,
        source.catalogBrandId,
        source.catalogBrandName,
      ),
    ],
  }));
}

function product(
  publicId: string,
  name: string,
  extra: Record<string, unknown>,
) {
  return {
    publicId,
    slug: publicId,
    name,
    brand: {
      id: GPS_SOURCES_V68[0].catalogBrandId,
      slug: "eucerin",
      name: GPS_SOURCES_V68[0].catalogBrandName,
      aliases: ["Eucerin"],
    },
    line: "",
    primaryCategory: "Cuidado",
    categorySlugs: ["cuidado"],
    needs: ["cuidado-diario"],
    aliases: [],
    description: "Detalle conservado.",
    listPrice: 100,
    offerPrice: 80,
    savingAmount: 20,
    discountPercent: 20,
    availability: "unknown",
    images: { card: "", detail: "" },
    ...extra,
  };
}

function candidate(
  sourceUrl: string,
  sourceName: string,
  catalogBrandId = GPS_SOURCES_V68[0].catalogBrandId,
  catalogBrandName = GPS_SOURCES_V68[0].catalogBrandName,
) {
  return {
    sourceId: catalogBrandId,
    catalogBrandId,
    catalogBrandName,
    sourceUrl,
    sourceName,
    sourceBrand: catalogBrandName,
    listedBrand: catalogBrandName,
    imageUrl: "",
    listPrice: 100,
    offerPrice: 80,
    savingAmount: 20,
    discountPercent: 20,
  };
}
