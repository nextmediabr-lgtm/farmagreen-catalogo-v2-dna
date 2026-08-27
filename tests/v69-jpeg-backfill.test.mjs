import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  gcsImageObjectV69,
  prepareResponsiveJpegBackfillV69,
  responsiveDigestV69,
} from "../scripts/backfill-responsive-jpeg-v69.mjs";

const BUCKET = "farmagreen-catalog-images-test";
const PREFIX = "v69/catalog-images";
const DIGEST = "0123456789abcdef0123456789abcdef";
const SOURCE = `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}.png`;

test("el backfill JPEG completa card/detail una vez por imagen y conserva identidad responsive", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fg-v69-jpeg-"));
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "output.json");
  const storeDirectory = path.join(directory, "store");
  const image = await sharp({
    create: { width: 900, height: 700, channels: 3, background: { r: 240, g: 240, b: 240 } },
  }).png().toBuffer();
  await writeFile(inputPath, JSON.stringify(fixtureCatalog()));
  let fetches = 0;
  try {
    const result = await prepareResponsiveJpegBackfillV69({
      inputPath,
      outputPath,
      storeDirectory,
      imageBucket: BUCKET,
      imagePrefix: PREFIX,
      fetchImpl: async () => {
        fetches += 1;
        return new Response(image, { status: 200, headers: { "content-type": "image/png" } });
      },
    });
    assert.equal(fetches, 1);
    assert.equal(result.products, 2);
    assert.equal(result.responsiveSets, 4);
    assert.equal(result.setsUpdated, 4);
    assert.equal(result.uniqueImages, 1);
    assert.equal(result.generatedAssets, 2);
    assert.deepEqual((await readdir(storeDirectory)).sort(), [`${DIGEST}-320.jpg`, `${DIGEST}-640.jpg`]);
    const prepared = JSON.parse(await readFile(outputPath, "utf8"));
    const expected = {
      "320": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-320.jpg`,
      "640": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-640.jpg`,
    };
    for (const product of prepared.products) {
      assert.deepEqual(product.images.responsive.card.jpeg, expected);
      assert.deepEqual(product.images.responsive.detail.jpeg, expected);
    }
    assert.deepEqual(await sharp(path.join(storeDirectory, `${DIGEST}-320.jpg`)).metadata().then(({ width, height, format }) => ({ width, height, format })), {
      width: 320,
      height: 249,
      format: "jpeg",
    });
    assert.deepEqual(await sharp(path.join(storeDirectory, `${DIGEST}-640.jpg`)).metadata().then(({ width, height, format }) => ({ width, height, format })), {
      width: 640,
      height: 498,
      format: "jpeg",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("el backfill es idempotente cuando el snapshot ya contiene JPEG completos", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fg-v69-jpeg-idempotent-"));
  const inputPath = path.join(directory, "input.json");
  const outputPath = path.join(directory, "output.json");
  const storeDirectory = path.join(directory, "store");
  const catalog = fixtureCatalog();
  const jpeg = {
    "320": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-320.jpg`,
    "640": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-640.jpg`,
  };
  for (const product of catalog.products) {
    product.images.responsive.card.jpeg = jpeg;
    product.images.responsive.detail.jpeg = jpeg;
  }
  await writeFile(inputPath, JSON.stringify(catalog));
  try {
    const result = await prepareResponsiveJpegBackfillV69({
      inputPath,
      outputPath,
      storeDirectory,
      imageBucket: BUCKET,
      fetchImpl: async () => {
        throw new Error("No debe descargar imágenes completas.");
      },
    });
    assert.equal(result.alreadyCompleteSets, 4);
    assert.equal(result.setsUpdated, 0);
    assert.equal(result.generatedAssets, 0);
    assert.deepEqual(await readdir(storeDirectory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("el backfill rechaza buckets externos e identidades responsive contradictorias", () => {
  assert.throws(() => gcsImageObjectV69("https://example.com/image.jpg"), /Google Cloud Storage/);
  const set = responsiveSet();
  set.webp["640"] = `https://storage.googleapis.com/${BUCKET}/${PREFIX}/ffffffffffffffffffffffffffffffff-640.webp`;
  assert.throws(() => responsiveDigestV69(set, BUCKET, PREFIX), /identidad única/);
});

function fixtureCatalog() {
  return {
    version: 6.9,
    totalProducts: 2,
    products: ["one", "two"].map((publicId) => ({
      publicId,
      images: {
        card: SOURCE,
        detail: SOURCE,
        responsive: { card: responsiveSet(), detail: responsiveSet() },
      },
    })),
  };
}

function responsiveSet() {
  return {
    width: 900,
    height: 700,
    avif: {
      "320": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-320.avif`,
      "640": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-640.avif`,
      "900": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-1000.avif`,
    },
    webp: {
      "320": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-320.webp`,
      "640": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-640.webp`,
      "900": `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${DIGEST}-1000.webp`,
    },
  };
}
