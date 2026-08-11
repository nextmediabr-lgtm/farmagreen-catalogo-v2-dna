import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyMagentoTaxonomyV69, catalogV69Data, resetCatalogV69CacheForTests, type ProductV69 } from "../src/data-v69.js";
import { loadMagentoTaxonomyV69, validateMagentoTaxonomyV69 } from "../src/magento-taxonomy-v69.js";
import { extractMagentoTaxonomyV69, urlKeyFromProductUrlV69 } from "../scripts/extract-magento-taxonomy-v69.mjs";

const category = {
  id: 7160,
  uid: "NzE2MA==",
  name: "Contorno de Ojos",
  level: 6,
  path: "1/2/6314/6332/6335/6338/7160",
  url_key: "contorno-de-ojos",
  url_path: "categorias/dermocosmetica/faciales/hidratacion/contorno-de-ojos",
  breadcrumbs: [{
    category_id: 6338,
    category_name: "Hidratación",
    category_level: 5,
    category_url_key: "hidratacion",
    category_url_path: "categorias/dermocosmetica/faciales/hidratacion",
  }],
};

test("extrae categorías Magento puras hasta level 7 después de aplicar exclusiones", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "farmagreen-v69-taxonomy-"));
  const inputPath = path.join(directory, "catalog.json");
  const exclusionsPath = path.join(directory, "exclusions.json");
  const outputPath = path.join(directory, "taxonomy.json");
  const productUrl = "https://gpsfarma.com/catalog/product/view/id/19691/s/gel-crema-ureadin-contorno-de-ojos-x-15-ml/category/7160/";
  const products = [
    fixtureProduct("visible", "SKU-1", "7790000000001", productUrl),
    fixtureProduct("hidden", "SKU-2", "7790000000002", "https://gpsfarma.com/oculto.html"),
  ];
  await writeFile(inputPath, JSON.stringify({ version: 6.9, syncedAt: "2026-08-01T00:00:00.000Z", products }));
  await writeFile(exclusionsPath, JSON.stringify({ products: [], skus: ["SKU-2"], barcodes: [], urls: [], hidden: {} }));

  try {
    let requestedKeys: string[] = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      requestedKeys = body.variables.keys;
      return new Response(JSON.stringify({
        data: {
          products: {
            items: [{
              id: 19691,
              sku: "SKU-1",
              name: "Gel Crema Ureadin Contorno de Ojos x 15 ml",
              url_key: requestedKeys[0],
              categories: [category, { ...category, id: 9999, uid: "OTk5OQ==", level: 8, path: "1/2/3/4/5/6/7/8/9999" }],
            }],
          },
        },
      }), { headers: { "content-type": "application/json" } });
    };
    const { artifact } = await extractMagentoTaxonomyV69({
      inputPath,
      exclusionsPath,
      outputPath,
      fetchImpl,
      now: () => new Date("2026-08-11T20:00:00.000Z"),
    });
    assert.deepEqual(requestedKeys, ["gel-crema-ureadin-contorno-de-ojos-x-15-ml"]);
    assert.equal(artifact.catalog.sourceProducts, 2);
    assert.equal(artifact.catalog.visibleProducts, 1);
    assert.deepEqual(artifact.categories.map((entry) => entry.id), [7160]);
    assert.equal(artifact.categories[0].name, "Contorno de Ojos");
    assert.equal(artifact.categories[0].path, "1/2/6314/6332/6335/6338/7160");
    assert.deepEqual(artifact.products[0].categoryIds, [7160]);
    assert.doesNotMatch(await readFile(outputPath, "utf8"), /9999/);

    const loaded = await loadMagentoTaxonomyV69(outputPath, true);
    assert.ok(loaded);
    const enriched = applyMagentoTaxonomyV69([products[0] as ProductV69], loaded, true);
    assert.deepEqual(enriched[0].magentoCategories, [{ id: "7160", name: "Contorno de Ojos" }]);
    assert.equal(enriched[0].primaryCategory, "rostro");
    assert.deepEqual(enriched[0].needs, ["hidratacion"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rechaza una asociación Magento cuya identidad privada no coincide", () => {
  const product = fixtureProduct("visible", "SKU-1", "7790000000001", "https://gpsfarma.com/producto.html") as ProductV69;
  const taxonomy = validateMagentoTaxonomyV69({
    schemaVersion: 1,
    source: { platform: "Magento 2", endpoint: "https://gpsfarma.com/graphql", extractedAt: "2026-08-11T20:00:00.000Z", maxNormalizedLevel: 7 },
    catalog: { version: 6.9, syncedAt: "", commerceSyncedAt: "", sourceProducts: 1, visibleProducts: 1 },
    categories: [{ id: 7160, uid: "NzE2MA==", name: "Contorno de Ojos", level: 6, path: "1/2/7160", urlKey: "contorno-de-ojos", urlPath: "categorias/contorno-de-ojos", breadcrumbs: [] }],
    products: [{ publicId: "visible", sku: "OTRO-SKU", barcode: "7790000000001", productUrl: "https://gpsfarma.com/producto.html", urlKey: "producto", magentoProductId: 1, categoryIds: [7160] }],
  });
  assert.throws(() => applyMagentoTaxonomyV69([product], taxonomy, true), /identidad Magento no coincide/);
});

test("el catálogo base de contingencia puede completar SKU/barcode ausentes sin relajar URL ni publicId", () => {
  const product = fixtureProduct("visible", "", "", "https://gpsfarma.com/producto.html") as ProductV69;
  const taxonomy = validateMagentoTaxonomyV69({
    schemaVersion: 1,
    source: { platform: "Magento 2", endpoint: "https://gpsfarma.com/graphql", extractedAt: "2026-08-11T20:00:00.000Z", maxNormalizedLevel: 7 },
    catalog: { version: 6.9, syncedAt: "", commerceSyncedAt: "", sourceProducts: 1, visibleProducts: 1 },
    categories: [{ id: 7160, uid: "NzE2MA==", name: "Contorno de Ojos", level: 6, path: "1/2/7160", urlKey: "contorno-de-ojos", urlPath: "categorias/contorno-de-ojos", breadcrumbs: [] }],
    products: [{ publicId: "visible", sku: "SKU-1", barcode: "7790000000001", productUrl: "https://gpsfarma.com/producto.html", urlKey: "producto", magentoProductId: 1, categoryIds: [7160] }],
  });
  assert.equal(applyMagentoTaxonomyV69([product], taxonomy, true)[0].magentoTaxonomyAttached, true);
  assert.throws(
    () => applyMagentoTaxonomyV69([{ ...product, source: { url: "https://gpsfarma.com/otra-ficha.html" } }], taxonomy, true),
    /identidad Magento no coincide/,
  );
});

test("obtiene url_key tanto de URL canónica como de ruta interna Magento", () => {
  assert.equal(urlKeyFromProductUrlV69("https://gpsfarma.com/serum-hyalluronic-concentrate-50ml.html"), "serum-hyalluronic-concentrate-50ml");
  assert.equal(urlKeyFromProductUrlV69("https://gpsfarma.com/catalog/product/view/id/19691/s/gel-crema-ureadin-contorno-de-ojos-x-15-ml/category/7160/"), "gel-crema-ureadin-contorno-de-ojos-x-15-ml");
});

test("el artefacto vigente cubre todas las fichas públicas después de las exclusiones", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  resetCatalogV69CacheForTests();
  const catalog = await catalogV69Data({
    ...process.env,
    V69_CATALOG_FILE: path.join(root, "data", "catalog-v69.json"),
    V69_EXCLUSIONS_FILE: path.join(root, "data", "catalog-exclusions-v69.local.json"),
    V69_REQUIRE_EXCLUSIONS: "1",
    V69_MAGENTO_TAXONOMY_FILE: path.join(root, "data", "catalog-taxonomy-v69.local.json"),
    V69_REQUIRE_MAGENTO_TAXONOMY: "1",
  });
  assert.equal(catalog.products.length, 692);
  assert.equal(catalog.products.filter((product) => product.magentoTaxonomyAttached).length, 692);
  assert.ok(catalog.products.every((product) => Array.isArray(product.magentoCategories)));
  assert.ok(
    ["7790375003142", "7790375269326", "7790375001292"].every(
      (barcode) => !catalog.products.some((product) => product.barcode === barcode),
    ),
  );
});

test("el contexto Cloud Build incluye catálogo y taxonomía coherentes para arrancar antes de GCS", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const cloudIgnore = await readFile(path.join(root, ".gcloudignore"), "utf8");
  assert.doesNotMatch(cloudIgnore, /^data\/catalog-v69\.json$/m);
  assert.doesNotMatch(cloudIgnore, /^data\/catalog-taxonomy-v69\.local\.json$/m);
});

function fixtureProduct(publicId: string, sku: string, barcode: string, url: string) {
  return {
    publicId,
    slug: publicId,
    name: `Producto ${publicId}`,
    brand: { id: "test", slug: "test", name: "Test", aliases: [] },
    line: "",
    primaryCategory: "rostro",
    categorySlugs: ["rostro"],
    needs: ["hidratacion"],
    aliases: [],
    listPrice: 100,
    offerPrice: 90,
    savingAmount: 10,
    discountPercent: 10,
    availability: "limited",
    availabilityCheckedAt: "2026-08-11T18:00:00.000Z",
    sku,
    barcode,
    source: { url },
    images: { card: "/image.jpg", detail: "/image.jpg" },
  };
}
