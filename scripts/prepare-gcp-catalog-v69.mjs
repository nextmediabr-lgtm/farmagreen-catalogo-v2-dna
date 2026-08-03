import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_IMAGE_BYTES = 12_000_000;
const DEFAULT_CONCURRENCY = 8;

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

export function rewriteCatalogImagesV69(catalog, replacements) {
  return {
    ...catalog,
    products: catalog.products.map((product) => ({
      ...product,
      images: Object.fromEntries(
        Object.entries(product.images || {}).map(([kind, value]) => [
          kind,
          replacements.get(String(value || "")) || value,
        ]),
      ),
    })),
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
  fetchImpl = globalThis.fetch,
}) {
  validateBucket(bucket);
  const catalog = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const exclusions = JSON.parse(await fs.readFile(exclusionsPath, "utf8"));
  const filtered = filterExcludedProductsV69(catalog, exclusions);
  if (!filtered.products.length || filtered.products.some((product) => product.availability === "unknown")) {
    throw new Error("El snapshot V6.9 contiene disponibilidad sin verificar.");
  }

  const sourceUrls = [
    ...new Set(
      filtered.products
        .flatMap((product) => Object.values(product.images || {}))
        .map((value) => String(value || ""))
        .filter(privateImageUrlV69),
    ),
  ];
  const replacements = new Map();
  await fs.mkdir(storeDirectory, { recursive: true });

  await mapLimit(sourceUrls, concurrency, async (sourceUrl) => {
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
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > MAX_IMAGE_BYTES) throw new Error(`Imagen inválida: ${sourceUrl}`);
    const objectName = imageObjectNameV69(sourceUrl, prefix, contentType);
    const localPath = path.join(storeDirectory, path.basename(objectName));
    await fs.writeFile(localPath, body, { flag: "wx" }).catch(async (error) => {
      if (error?.code !== "EEXIST") throw error;
      const existing = await fs.readFile(localPath);
      if (!existing.equals(body)) throw new Error(`Colisión de imagen: ${localPath}`);
    });
    replacements.set(
      sourceUrl,
      `https://storage.googleapis.com/${bucket}/${objectName}`,
    );
  });

  const rewritten = rewriteCatalogImagesV69(filtered, replacements);
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
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(rewritten)}\n`, { encoding: "utf8" });
  return {
    catalog: rewritten,
    products: rewritten.products.length,
    downloadedImages: sourceUrls.length,
    outputPath,
    storeDirectory,
  };
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
