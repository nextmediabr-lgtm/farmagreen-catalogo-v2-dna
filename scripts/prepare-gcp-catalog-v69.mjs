import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_IMAGE_BYTES = 12_000_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_DERIVATIVE_BYTES = 4_000_000;
const DEFAULT_CONCURRENCY = 8;
const RESPONSIVE_WIDTHS = [320, 640, 1000];
const JPEG_RESPONSIVE_WIDTHS = [320, 640];

export function privateImageUrlV69(value) {
  try {
    const parsed = new URL(String(value || ""));
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      (hostname === "gpsfarma.com" || hostname.endsWith(".gpsfarma.com"))
    );
  } catch {
    return false;
  }
}

export function filterExcludedProductsV69(catalog, exclusions) {
  const hidden = exclusions?.hidden && typeof exclusions.hidden === "object" ? exclusions.hidden : {};
  const identities = Array.isArray(exclusions?.products) ? exclusions.products : [];
  const skus = new Set(
    [...(Array.isArray(exclusions?.skus) ? exclusions.skus : []), ...identities.map((item) => item?.sku)]
      .map(normalizeSku)
      .filter(Boolean),
  );
  const barcodes = new Set(
    [...(Array.isArray(exclusions?.barcodes) ? exclusions.barcodes : []), ...identities.map((item) => item?.barcode)]
      .map(normalizeBarcode)
      .filter(Boolean),
  );
  const urls = new Set(
    [...(Array.isArray(exclusions?.urls) ? exclusions.urls : []), ...identities.map((item) => item?.url)]
      .map(normalizeSourceUrl)
      .filter(Boolean),
  );
  const products = catalog.products.filter((product) => {
    if (hidden[product.publicId]) return false;
    if (product.sku && skus.has(normalizeSku(product.sku))) return false;
    if (product.barcode && barcodes.has(normalizeBarcode(product.barcode))) return false;
    return !(product?.source?.url && urls.has(normalizeSourceUrl(product.source.url)));
  });
  return recalculateSnapshotV69({ ...catalog, products, totalProducts: products.length });
}

export function recalculateSnapshotV69(catalog) {
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  const available = products.filter((product) => product.availability === "limited").length;
  const unavailable = products.filter((product) => product.availability === "out_of_stock").length;
  const unverified = products.length - available - unavailable;
  const verified = available + unavailable;
  const priced = products.filter(
    (product) => Number(product.offerPrice || product.listPrice) > 0,
  ).length;
  const metrics = {
    ...(catalog?.commerceSync?.metrics || {}),
    catalogProducts: products.length,
    matched: verified,
    available,
    unavailable,
    unverified,
    verified,
    availabilityCoverage: products.length ? verified / products.length : 0,
    pricesUpdated: priced,
    coverage: products.length ? verified / products.length : 0,
    priceCoverage: products.length ? priced / products.length : 0,
  };
  return {
    ...catalog,
    version: 6.9,
    totalProducts: products.length,
    commerceSync: {
      ...catalog.commerceSync,
      metrics,
      coverage: metrics.coverage,
    },
    products,
  };
}

export function imageObjectNameV69(sourceUrl, prefix, contentType) {
  const extension = extensionForContentType(contentType);
  const digest = crypto.createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32);
  return `${cleanPrefix(prefix)}/${digest}.${extension}`;
}

export function responsiveObjectNameV69(sourceUrl, prefix, width, format) {
  if (!RESPONSIVE_WIDTHS.includes(Number(width))) throw new Error(`Ancho responsivo inválido: ${width}`);
  if (!["webp", "avif", "jpeg"].includes(format)) throw new Error(`Formato responsivo inválido: ${format}`);
  const digest = crypto.createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32);
  return `${cleanPrefix(prefix)}/${digest}-${width}.${format === "jpeg" ? "jpg" : format}`;
}

export function rewriteCatalogImagesV69(catalog, replacements, responsiveBySource = new Map()) {
  return {
    ...catalog,
    products: catalog.products.map((product) => {
      const sourceImages = product.images || {};
      const images = { ...sourceImages };
      for (const kind of ["card", "detail", "original"]) {
        const value = sourceImages[kind];
        if (typeof value === "string") images[kind] = replacements.get(value) || value;
      }
      const responsive = {};
      for (const kind of ["card", "detail"]) {
        const value = sourceImages[kind];
        const variants = typeof value === "string" ? responsiveBySource.get(value) : undefined;
        if (variants) responsive[kind] = variants;
      }
      if (Object.keys(responsive).length) images.responsive = responsive;
      return { ...product, images };
    }),
  };
}

export async function prepareGcpCatalogV69({
  inputPath,
  exclusionsPath,
  outputPath,
  storeDirectory,
  bucket,
  prefix,
  concurrency = DEFAULT_CONCURRENCY,
  maxImagePixels = MAX_IMAGE_PIXELS,
  maxImageDimension = MAX_IMAGE_DIMENSION,
  maxDerivativeBytes = MAX_DERIVATIVE_BYTES,
  fetchImpl = globalThis.fetch,
}) {
  validateBucket(bucket);
  const pixelLimit = positiveInteger(maxImagePixels, "Límite de píxeles");
  const dimensionLimit = positiveInteger(maxImageDimension, "Límite de dimensión");
  const derivativeLimit = positiveInteger(maxDerivativeBytes, "Límite de derivado");
  const catalog = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const exclusions = JSON.parse(await fs.readFile(exclusionsPath, "utf8"));
  const filtered = filterExcludedProductsV69(catalog, exclusions);
  if (!filtered.products.length || filtered.products.some((product) => product.availability === "unknown")) {
    throw new Error("El snapshot V6.9 contiene disponibilidad sin verificar.");
  }

  const sourceUrls = [
    ...new Set(
      filtered.products
        .flatMap((product) => [product.images?.card, product.images?.detail])
        .map((value) => String(value || ""))
        .filter(publicSourceImageUrlV69),
    ),
  ];
  const replacements = new Map();
  const responsiveBySource = new Map();
  let generatedDerivatives = 0;
  await fs.mkdir(storeDirectory, { recursive: true });

  await mapLimit(sourceUrls, Math.min(DEFAULT_CONCURRENCY, positiveInteger(concurrency, "Concurrencia")), async (sourceUrl) => {
    const response = await fetchImpl(sourceUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
        "user-agent": "Mozilla/5.0 FarmagreenCatalog/6.9",
      },
    });
    if (!response.ok) throw new Error(`Imagen HTTP ${response.status}: ${sourceUrl}`);
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim();
    if (!contentType.startsWith("image/")) throw new Error(`Contenido no visual: ${sourceUrl}`);
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) throw new Error(`Imagen demasiado grande: ${sourceUrl}`);
    const body = await readBodyWithinLimit(response, MAX_IMAGE_BYTES);
    if (!body.length || body.length > MAX_IMAGE_BYTES) throw new Error(`Imagen inválida: ${sourceUrl}`);
    const inputOptions = { failOn: "error", limitInputPixels: pixelLimit };
    let metadata;
    try {
      metadata = await sharp(body, inputOptions).metadata();
    } catch (error) {
      throw new Error(`Imagen excede el presupuesto de decodificación: ${sourceUrl}`, { cause: error });
    }
    const sourceWidth = Number(metadata.autoOrient?.width || metadata.width || 0);
    const sourceHeight = Number(metadata.autoOrient?.height || metadata.height || 0);
    if (!sourceWidth || !sourceHeight) throw new Error(`Dimensiones de imagen inválidas: ${sourceUrl}`);
    if (
      sourceWidth > dimensionLimit ||
      sourceHeight > dimensionLimit ||
      sourceWidth * sourceHeight > pixelLimit
    ) {
      throw new Error(`Imagen excede el presupuesto de decodificación: ${sourceUrl}`);
    }
    if (privateImageUrlV69(sourceUrl)) {
      const objectName = imageObjectNameV69(sourceUrl, prefix, contentType);
      await writePreparedAsset(path.join(storeDirectory, path.basename(objectName)), body);
      replacements.set(sourceUrl, `https://storage.googleapis.com/${bucket}/${objectName}`);
    }
    const variants = { width: sourceWidth, height: sourceHeight, webp: {}, avif: {}, jpeg: {} };
    for (const requestedWidth of RESPONSIVE_WIDTHS) {
      const width = Math.min(requestedWidth, sourceWidth);
      if (variants.webp[String(width)] && variants.avif[String(width)]) continue;
      for (const format of ["webp", "avif"]) {
        const pipeline = sharp(body, inputOptions).rotate().resize({ width, withoutEnlargement: true });
        const { data, info } = await (format === "webp"
          ? pipeline.webp({ quality: 82, effort: 4 })
          : pipeline.avif({ quality: 62, effort: 4 })).toBuffer({ resolveWithObject: true });
        if (!data.length || data.length > derivativeLimit) {
          throw new Error(`Derivado de imagen demasiado grande: ${sourceUrl}`);
        }
        const objectName = responsiveObjectNameV69(sourceUrl, prefix, requestedWidth, format);
        await writePreparedAsset(path.join(storeDirectory, path.basename(objectName)), data);
        generatedDerivatives += 1;
        variants[format][String(info.width)] = `https://storage.googleapis.com/${bucket}/${objectName}`;
      }
    }
    for (const requestedWidth of JPEG_RESPONSIVE_WIDTHS) {
      const width = Math.min(requestedWidth, sourceWidth);
      if (variants.jpeg[String(width)]) continue;
      const pipeline = sharp(body, inputOptions).rotate().resize({ width, withoutEnlargement: true });
      const { data, info } = await pipeline
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (!data.length || data.length > derivativeLimit) {
        throw new Error(`Derivado de imagen demasiado grande: ${sourceUrl}`);
      }
      const objectName = responsiveObjectNameV69(sourceUrl, prefix, requestedWidth, "jpeg");
      await writePreparedAsset(path.join(storeDirectory, path.basename(objectName)), data);
      generatedDerivatives += 1;
      variants.jpeg[String(info.width)] = `https://storage.googleapis.com/${bucket}/${objectName}`;
    }
    responsiveBySource.set(sourceUrl, variants);
  });

  const rewritten = rewriteCatalogImagesV69(filtered, replacements, responsiveBySource);
  const invalidImages = rewritten.products.flatMap((product) =>
    [product.images?.card, product.images?.detail].filter((value) => {
      try {
        const image = new URL(String(value || ""));
        return image.protocol !== "https:" || image.hostname !== "storage.googleapis.com";
      } catch {
        return true;
      }
    }),
  );
  if (invalidImages.length) throw new Error(`Quedaron ${invalidImages.length} imágenes fuera de GCS.`);
  const incompleteResponsive = rewritten.products.filter((product) =>
    [product.images?.responsive?.card, product.images?.responsive?.detail].some(
      (set) => !set?.width || !set?.height || Object.keys(set.webp || {}).length < 1 || Object.keys(set.avif || {}).length < 1 || Object.keys(set.jpeg || {}).length < 1,
    ),
  );
  if (incompleteResponsive.length) {
    throw new Error(`Quedaron ${incompleteResponsive.length} productos sin derivados responsivos completos.`);
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(rewritten)}\n`, { encoding: "utf8" });
  return {
    catalog: rewritten,
    products: rewritten.products.length,
    downloadedImages: sourceUrls.length,
    generatedDerivatives,
    outputPath,
    storeDirectory,
  };
}

async function readBodyWithinLimit(response, limit) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("Imagen comprimida demasiado grande.");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function publicSourceImageUrlV69(value) {
  if (privateImageUrlV69(value)) return true;
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && parsed.hostname === "storage.googleapis.com" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

async function writePreparedAsset(filePath, body) {
  await fs.writeFile(filePath, body, { flag: "wx" }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fs.readFile(filePath);
    if (!existing.equals(body)) throw new Error(`Colisión de imagen: ${filePath}`);
  });
}

function normalizeSku(value) {
  return String(value || "").trim();
}

function normalizeBarcode(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeSourceUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    const pathname = parsed.pathname.replace(/^\/categorias\//i, "/").replace(/\/+$/, "") || "/";
    return `${parsed.hostname.toLowerCase()}${pathname.toLowerCase()}`;
  } catch {
    return "";
  }
}

function extensionForContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/avif") return "avif";
  if (normalized === "image/gif") return "gif";
  if (["image/jpeg", "image/jpg", "image/pjpeg"].includes(normalized)) return "jpg";
  throw new Error(`Tipo de imagen no admitido: ${contentType}`);
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
  const count = Math.min(Math.max(1, Number(limit) || 1), items.length || 1);
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
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`Argumentos inválidos: ${flag || ""}`);
    values.set(flag.slice(2), value);
  }
  return {
    inputPath: path.resolve(values.get("input") || path.join(ROOT, "data", "catalog-v69.json")),
    exclusionsPath: path.resolve(values.get("exclusions") || path.join(ROOT, "data", "catalog-exclusions-v69.local.json")),
    outputPath: path.resolve(values.get("output") || path.join(ROOT, ".gcp-v69", "catalog-v69-gcp.json")),
    storeDirectory: path.resolve(values.get("store-dir") || path.join(ROOT, ".gcp-v69", "store")),
    bucket: values.get("bucket") || process.env.V69_IMAGE_GCS_BUCKET || "",
    prefix: values.get("prefix") || "v69/catalog-images",
    concurrency: Number(values.get("concurrency") || DEFAULT_CONCURRENCY),
  };
}

async function main(argv = process.argv.slice(2)) {
  const result = await prepareGcpCatalogV69(cliOptions(argv));
  process.stdout.write(
    `${JSON.stringify({
      products: result.products,
      downloadedImages: result.downloadedImages,
      generatedDerivatives: result.generatedDerivatives,
      output: path.relative(ROOT, result.outputPath),
      store: path.relative(ROOT, result.storeDirectory),
    })}\n`,
  );
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[prepare-gcp-v69] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
