import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const MAX_IMAGE_BYTES = 12_000_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_DERIVATIVE_BYTES = 4_000_000;
const DEFAULT_CONCURRENCY = 8;
const JPEG_WIDTHS = [320, 640];

export function gcsImageObjectV69(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error("La imagen del backfill no es una URL válida.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "storage.googleapis.com" || parsed.username || parsed.password) {
    throw new Error("El backfill JPEG sólo acepta imágenes HTTPS de Google Cloud Storage.");
  }
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  const separator = pathname.indexOf("/");
  if (separator < 1 || separator === pathname.length - 1) throw new Error("La URL GCS del backfill es inválida.");
  return { bucket: pathname.slice(0, separator), objectName: pathname.slice(separator + 1) };
}

export function responsiveDigestV69(set, imageBucket, imagePrefix) {
  const prefix = cleanPrefix(imagePrefix);
  const digests = new Set();
  for (const format of ["avif", "webp"]) {
    const variants = set?.[format];
    if (!variants || typeof variants !== "object" || Array.isArray(variants) || !Object.keys(variants).length) {
      throw new Error(`Faltan variantes ${format.toUpperCase()} para derivar el JPEG.`);
    }
    for (const value of Object.values(variants)) {
      const descriptor = gcsImageObjectV69(value);
      if (descriptor.bucket !== imageBucket || !descriptor.objectName.startsWith(`${prefix}/`)) {
        throw new Error("Una variante responsive pertenece a otro bucket o prefijo.");
      }
      const filename = path.posix.basename(descriptor.objectName);
      const match = filename.match(/^([a-f0-9]{32})-(320|640|1000)\.(?:avif|webp)$/);
      if (!match) throw new Error(`Nombre responsive V6.9 inesperado: ${filename}`);
      digests.add(match[1]);
    }
  }
  if (digests.size !== 1) throw new Error("Las variantes AVIF/WebP no comparten una identidad única.");
  return [...digests][0];
}

export function expectedJpegVariantsV69(set, imageBucket, imagePrefix, digest) {
  const sourceWidth = positiveInteger(set?.width, "Ancho responsive");
  const variants = {};
  for (const requestedWidth of JPEG_WIDTHS) {
    const actualWidth = Math.min(requestedWidth, sourceWidth);
    if (variants[String(actualWidth)]) continue;
    const objectName = `${cleanPrefix(imagePrefix)}/${digest}-${requestedWidth}.jpg`;
    variants[String(actualWidth)] = `https://storage.googleapis.com/${imageBucket}/${objectName}`;
  }
  return variants;
}

export async function prepareResponsiveJpegBackfillV69({
  inputPath,
  outputPath,
  storeDirectory,
  imageBucket,
  imagePrefix = "v69/catalog-images",
  concurrency = DEFAULT_CONCURRENCY,
  maxImagePixels = MAX_IMAGE_PIXELS,
  maxImageDimension = MAX_IMAGE_DIMENSION,
  maxDerivativeBytes = MAX_DERIVATIVE_BYTES,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
} = {}) {
  validateBucket(imageBucket);
  const pixelLimit = positiveInteger(maxImagePixels, "Límite de píxeles");
  const dimensionLimit = positiveInteger(maxImageDimension, "Límite de dimensión");
  const derivativeLimit = positiveInteger(maxDerivativeBytes, "Límite de derivado");
  const catalog = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (Number(catalog?.version) !== 6.9 || !Array.isArray(catalog?.products) || !catalog.products.length) {
    throw new Error("El snapshot del backfill JPEG no es un catálogo V6.9 válido.");
  }
  const rewritten = structuredClone(catalog);
  const jobs = new Map();
  let responsiveSets = 0;
  let alreadyCompleteSets = 0;

  for (const product of rewritten.products) {
    for (const kind of ["card", "detail"]) {
      const set = product.images?.responsive?.[kind];
      if (!set || typeof set !== "object") throw new Error(`Falta responsive ${kind} para ${product.publicId}.`);
      responsiveSets += 1;
      const digest = responsiveDigestV69(set, imageBucket, imagePrefix);
      const expected = expectedJpegVariantsV69(set, imageBucket, imagePrefix, digest);
      const existing = set.jpeg === undefined ? {} : set.jpeg;
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        throw new Error(`JPEG responsive inválido para ${product.publicId}.`);
      }
      if (Object.keys(existing).length) {
        if (JSON.stringify(existing) !== JSON.stringify(expected)) {
          throw new Error(`JPEG responsive parcial o contradictorio para ${product.publicId}.`);
        }
        alreadyCompleteSets += 1;
        continue;
      }

      const sourceUrl = String(product.images?.[kind] || "");
      const sourceObject = gcsImageObjectV69(sourceUrl);
      const width = positiveInteger(set.width, "Ancho responsive");
      const height = positiveInteger(set.height, "Alto responsive");
      const key = `${sourceUrl}\n${digest}\n${width}x${height}`;
      const job = jobs.get(key) || { sourceUrl, digest, width, height, targets: [] };
      job.targets.push({ publicId: product.publicId, kind, set });
      jobs.set(key, job);
      if (!sourceObject.objectName) throw new Error(`Imagen fuente vacía para ${product.publicId}.`);
    }
  }

  await fs.mkdir(storeDirectory, { recursive: true });
  let generatedAssets = 0;
  let downloadedImages = 0;
  let setsUpdated = 0;
  let completedJobs = 0;
  await mapLimit([...jobs.values()], positiveInteger(concurrency, "Concurrencia"), async (job) => {
    const response = await fetchImpl(job.sourceUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
        "user-agent": "Mozilla/5.0 FarmagreenCatalog/JpegBackfill-6.9",
      },
    });
    if (!response.ok) throw new Error(`Imagen HTTP ${response.status}: ${job.sourceUrl}`);
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim();
    if (!contentType.startsWith("image/")) throw new Error(`Contenido no visual: ${job.sourceUrl}`);
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) throw new Error(`Imagen demasiado grande: ${job.sourceUrl}`);
    const body = await readBodyWithinLimit(response, MAX_IMAGE_BYTES);
    downloadedImages += 1;
    const inputOptions = { failOn: "error", limitInputPixels: pixelLimit };
    const metadata = await sharp(body, inputOptions).metadata().catch((error) => {
      throw new Error(`Imagen excede el presupuesto de decodificación: ${job.sourceUrl}`, { cause: error });
    });
    const sourceWidth = Number(metadata.autoOrient?.width || metadata.width || 0);
    const sourceHeight = Number(metadata.autoOrient?.height || metadata.height || 0);
    if (
      !sourceWidth || !sourceHeight ||
      sourceWidth > dimensionLimit || sourceHeight > dimensionLimit || sourceWidth * sourceHeight > pixelLimit
    ) {
      throw new Error(`Imagen excede el presupuesto de decodificación: ${job.sourceUrl}`);
    }
    if (sourceWidth !== job.width || sourceHeight !== job.height) {
      throw new Error(`Las dimensiones fuente cambiaron para ${job.targets[0].publicId}.`);
    }

    const jpeg = {};
    for (const requestedWidth of JPEG_WIDTHS) {
      const width = Math.min(requestedWidth, sourceWidth);
      if (jpeg[String(width)]) continue;
      const { data, info } = await sharp(body, inputOptions)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (!data.length || data.length > derivativeLimit) throw new Error(`JPEG demasiado grande: ${job.sourceUrl}`);
      const filename = `${job.digest}-${requestedWidth}.jpg`;
      await writePreparedAsset(path.join(storeDirectory, filename), data);
      generatedAssets += 1;
      jpeg[String(info.width)] = `https://storage.googleapis.com/${imageBucket}/${cleanPrefix(imagePrefix)}/${filename}`;
    }
    for (const target of job.targets) {
      target.set.jpeg = { ...jpeg };
      setsUpdated += 1;
    }
    completedJobs += 1;
    onProgress({ completed: completedJobs, total: jobs.size, generatedAssets, setsUpdated });
  });

  const incomplete = rewritten.products.flatMap((product) => ["card", "detail"].map((kind) => ({ product, kind })))
    .filter(({ product, kind }) => {
      const set = product.images?.responsive?.[kind];
      if (!set) return true;
      const digest = responsiveDigestV69(set, imageBucket, imagePrefix);
      return JSON.stringify(set.jpeg || {}) !== JSON.stringify(expectedJpegVariantsV69(set, imageBucket, imagePrefix, digest));
    });
  if (incomplete.length) throw new Error(`Quedaron ${incomplete.length} sets sin JPEG completo.`);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(rewritten)}\n`, "utf8");
  return {
    catalog: rewritten,
    products: rewritten.products.length,
    responsiveSets,
    alreadyCompleteSets,
    setsUpdated,
    uniqueImages: jobs.size,
    downloadedImages,
    generatedAssets,
    outputPath,
    storeDirectory,
  };
}

async function readBodyWithinLimit(response, limit) {
  if (!response.body) throw new Error("La imagen no entregó contenido.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.byteLength;
      if (total > limit) throw new Error("Imagen comprimida demasiado grande.");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function writePreparedAsset(filePath, body) {
  await fs.writeFile(filePath, body, { flag: "wx" }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fs.readFile(filePath);
    if (!existing.equals(body)) throw new Error(`Colisión de JPEG: ${filePath}`);
  });
}

function cleanPrefix(value) {
  const prefix = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.includes("..") || /[\u0000-\u001f\u007f]/.test(prefix)) {
    throw new Error("Prefijo GCS inválido.");
  }
  return prefix;
}

function validateBucket(value) {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/i.test(String(value || ""))) {
    throw new Error("Bucket GCS inválido.");
  }
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} inválido.`);
  return parsed;
}

async function mapLimit(items, limit, worker) {
  const count = Math.min(Math.max(1, limit), items.length || 1);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: count }, run));
}

function cliOptions(argv) {
  const values = new Map();
  for (const argument of argv) {
    const match = String(argument).match(/^--([a-z-]+)=(.+)$/);
    if (!match || values.has(match[1])) throw new Error("Argumentos JPEG inválidos o repetidos.");
    values.set(match[1], match[2]);
  }
  const required = (name) => {
    const value = String(values.get(name) || "").trim();
    if (!value) throw new Error(`Falta --${name}.`);
    return value;
  };
  return {
    inputPath: required("input"),
    outputPath: required("output"),
    storeDirectory: required("store-dir"),
    imageBucket: required("image-bucket"),
    imagePrefix: values.get("image-prefix") || "v69/catalog-images",
    concurrency: Number(values.get("concurrency") || DEFAULT_CONCURRENCY),
  };
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const options = cliOptions(process.argv.slice(2));
  let lastReported = 0;
  prepareResponsiveJpegBackfillV69({
    ...options,
    onProgress(progress) {
      if (progress.completed === progress.total || progress.completed - lastReported >= 100) {
        lastReported = progress.completed;
        process.stderr.write(`[jpeg-v69] ${progress.completed}/${progress.total} imágenes\n`);
      }
    },
  }).then((result) => {
    process.stdout.write(`${JSON.stringify({
      products: result.products,
      responsiveSets: result.responsiveSets,
      setsUpdated: result.setsUpdated,
      uniqueImages: result.uniqueImages,
      generatedAssets: result.generatedAssets,
      outputPath: result.outputPath,
      storeDirectory: result.storeDirectory,
    })}\n`);
  }).catch((error) => {
    process.stderr.write(`[jpeg-v69] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
