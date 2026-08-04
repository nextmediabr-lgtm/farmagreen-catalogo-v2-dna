import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  filterExcludedProductsV69,
  imageObjectNameV69,
  prepareGcpCatalogV69,
  privateImageUrlV69,
  responsiveObjectNameV69,
  rewriteCatalogImagesV69,
} from "../scripts/prepare-gcp-catalog-v69.mjs";

test("la preparación GCP excluye por identidad privada sin publicar el SKU", () => {
  const catalog = fixtureCatalog();
  const filtered = filterExcludedProductsV69(catalog, {
    products: [{ sku: "PRIVATE-2", barcode: "222", url: "https://gpsfarma.com/p2.html" }],
    hidden: {},
  });
  assert.equal(filtered.products.length, 1);
  assert.equal(filtered.products[0].publicId, "p1");
  assert.equal(filtered.totalProducts, 1);
  assert.equal(filtered.commerceSync.metrics.unverified, 0);
  assert.equal(filtered.commerceSync.metrics.availabilityCoverage, 1);
});

test("las imágenes nuevas usan un prefijo V6.9 determinista", () => {
  const source = "https://gpsfarma.com/media/catalog/product/a/b/example.jpg";
  assert.equal(privateImageUrlV69(source), true);
  assert.equal(privateImageUrlV69("https://storage.googleapis.com/bucket/image.jpg"), false);
  const objectName = imageObjectNameV69(source, "v69/catalog-images", "image/jpeg");
  assert.match(objectName, /^v69\/catalog-images\/[a-f0-9]{32}\.jpg$/);
  assert.equal(objectName, imageObjectNameV69(source, "v69/catalog-images", "image/jpeg"));
  assert.match(responsiveObjectNameV69(source, "v69/catalog-images", 320, "webp"), /^v69\/catalog-images\/[a-f0-9]{32}-320\.webp$/);
  assert.throws(() => responsiveObjectNameV69(source, "v69/catalog-images", 500, "webp"), /Ancho responsivo inválido/);
});

test("la reescritura no altera imágenes existentes del Store compartido", () => {
  const catalog = fixtureCatalog();
  const source = catalog.products[0].images.card;
  const replacement = "https://storage.googleapis.com/shared/v69/catalog-images/replaced.jpg";
  const rewritten = rewriteCatalogImagesV69(catalog, new Map([[source, replacement]]));
  assert.equal(rewritten.products[0].images.card, replacement);
  assert.equal(
    rewritten.products[1].images.card,
    "https://storage.googleapis.com/shared/lab-publisher-hd/existing.jpg",
  );
});

test("la preparación local conserva originales y genera WebP/AVIF 320, 640 y 1000", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "farmagreen-v691-images-"));
  const inputPath = path.join(directory, "catalog.json");
  const exclusionsPath = path.join(directory, "exclusions.json");
  const outputPath = path.join(directory, "prepared.json");
  const storeDirectory = path.join(directory, "store");
  const fixture = fixtureCatalog();
  const image = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 245, g: 245, b: 245 } },
  }).png().toBuffer();
  await writeFile(inputPath, JSON.stringify(fixture));
  await writeFile(exclusionsPath, JSON.stringify({ products: [], skus: [], barcodes: [], urls: [], hidden: {} }));

  try {
    const result = await prepareGcpCatalogV69({
      inputPath,
      exclusionsPath,
      outputPath,
      storeDirectory,
      bucket: "farmagreen-test-images",
      prefix: "v69/catalog-images",
      concurrency: 2,
      fetchImpl: async () => new Response(image, { status: 200, headers: { "content-type": "image/png" } }),
    });
    assert.equal(result.products, 2);
    assert.equal(result.downloadedImages, 2);
    assert.equal(result.generatedDerivatives, 12);
    const prepared = JSON.parse(await readFile(outputPath, "utf8"));
    assert.doesNotMatch(JSON.stringify(prepared.products.map((product) => product.images)), /gpsfarma/i);
    for (const product of prepared.products) {
      for (const kind of ["card", "detail"]) {
        const set = product.images.responsive[kind];
        assert.deepEqual(Object.keys(set.webp), ["320", "640", "1000"]);
        assert.deepEqual(Object.keys(set.avif), ["320", "640", "1000"]);
        assert.equal(set.width, 1200);
        assert.equal(set.height, 800);
      }
    }
    assert.equal((await readdir(storeDirectory)).length, 13);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function fixtureCatalog() {
  const completedAt = "2026-08-03T10:00:00.000Z";
  return {
    version: 6.9,
    totalProducts: 2,
    products: [
      {
        publicId: "p1",
        sku: "PRIVATE-1",
        barcode: "111",
        availability: "limited",
        availabilityCheckedAt: completedAt,
        source: { url: "https://gpsfarma.com/p1.html" },
        images: {
          card: "https://gpsfarma.com/media/catalog/product/p1.jpg",
          detail: "https://gpsfarma.com/media/catalog/product/p1.jpg",
        },
        listPrice: 100,
        offerPrice: 80,
      },
      {
        publicId: "p2",
        sku: "PRIVATE-2",
        barcode: "222",
        availability: "out_of_stock",
        availabilityCheckedAt: completedAt,
        source: { url: "https://gpsfarma.com/p2.html" },
        images: {
          card: "https://storage.googleapis.com/shared/lab-publisher-hd/existing.jpg",
          detail: "https://storage.googleapis.com/shared/lab-publisher-hd/existing.jpg",
        },
        listPrice: 100,
        offerPrice: 80,
      },
    ],
    commerceSync: {
      completedAt,
      status: "completed",
      sources: Array.from({ length: 11 }, (_, index) => ({ id: String(index), status: "completed" })),
      metrics: {
        coverage: 1,
        priceCoverage: 1,
        availabilityCoverage: 1,
        unverified: 0,
      },
    },
  };
}
