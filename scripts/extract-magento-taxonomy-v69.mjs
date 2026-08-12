import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { filterExcludedProductsV69 } from "./prepare-gcp-catalog-v69.mjs";
import { writeJsonAtomically } from "./sync-catalog-commerce-v69.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "https://gpsfarma.com/graphql";
const MAX_LEVEL = 7;
const DEFAULT_BATCH_SIZE = 10;
const MAX_RESPONSE_BYTES = 24_000_000;
const QUERY = `query CatalogTaxonomyV69($keys: [String!]!) {
  products(filter: { url_key: { in: $keys } }, pageSize: 100) {
    items {
      id
      sku
      name
      url_key
      categories {
        id
        uid
        name
        level
        path
        url_key
        url_path
        breadcrumbs {
          category_id
          category_name
          category_level
          category_url_key
          category_url_path
        }
      }
    }
  }
}`;

export function urlKeyFromProductUrlV69(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || parsed.hostname !== "gpsfarma.com" || parsed.username || parsed.password) {
    throw new Error("La taxonomía V6.9 sólo acepta fichas HTTPS de gpsfarma.com.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const slugIndex = segments.indexOf("s");
  const raw = slugIndex >= 0 ? segments[slugIndex + 1] : segments.at(-1);
  const key = decodeURIComponent(String(raw || "")).replace(/\.html$/i, "").trim();
  if (!key) throw new Error(`No se pudo obtener url_key de ${parsed.href}.`);
  return key;
}

export async function extractMagentoTaxonomyV69({
  inputPath,
  exclusionsPath,
  outputPath,
  fetchImpl = fetch,
  now = () => new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
  onProgress = () => {},
} = {}) {
  if (!inputPath || !exclusionsPath || !outputPath) {
    throw new Error("La extracción Magento V6.9 requiere input, exclusions y output explícitos.");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) {
    throw new Error("El batch-size Magento V6.9 debe estar entre 1 y 25.");
  }
  const [catalog, exclusions] = await Promise.all([
    readJson(inputPath, "catálogo V6.9"),
    readJson(exclusionsPath, "exclusiones V6.9"),
  ]);
  if (Number(catalog?.version) !== 6.9 || !Array.isArray(catalog?.products)) {
    throw new Error("El catálogo de entrada V6.9 es inválido.");
  }
  const visibleCatalog = filterExcludedProductsV69(catalog, exclusions);
  const identities = visibleCatalog.products.map((product) => ({
    publicId: requiredString(product.publicId, "publicId"),
    sku: requiredString(product.sku, "sku"),
    barcode: optionalString(product.barcode),
    productUrl: requiredString(product.source?.url, "source.url"),
    urlKey: urlKeyFromProductUrlV69(product.source?.url),
  }));
  assertUnique(identities, "publicId");
  assertUnique(identities, "sku");
  assertUnique(identities, "urlKey");

  const categoryById = new Map();
  const products = [];
  for (let offset = 0; offset < identities.length; offset += batchSize) {
    const batch = identities.slice(offset, offset + batchSize);
    const items = await fetchBatchV69(batch.map((entry) => entry.urlKey), fetchImpl);
    const itemByKey = new Map(items.map((item) => [String(item.url_key || ""), item]));
    for (const identity of batch) {
      const item = itemByKey.get(identity.urlKey);
      if (!item) throw new Error(`Magento no devolvió la ficha ${identity.urlKey}.`);
      if (normalizeSku(item.sku) !== normalizeSku(identity.sku)) {
        throw new Error(`Magento devolvió otro SKU para ${identity.publicId}.`);
      }
      const categories = Array.isArray(item.categories)
        ? item.categories.map(normalizeCategoryV69).filter((category) => category.level <= MAX_LEVEL)
        : [];
      for (const category of categories) {
        const previous = categoryById.get(category.id);
        if (previous && stableJson(previous) !== stableJson(category)) {
          throw new Error(`Magento devolvió datos contradictorios para la categoría ${category.id}.`);
        }
        categoryById.set(category.id, category);
      }
      products.push({
        ...identity,
        magentoProductId: positiveInteger(item.id, "Magento product id"),
        categoryIds: [...new Set(categories.map((category) => category.id))].sort((left, right) => left - right),
      });
    }
    onProgress({ processed: Math.min(offset + batch.length, identities.length), total: identities.length });
  }

  const artifact = {
    schemaVersion: 1,
    source: {
      platform: "Magento 2",
      endpoint: ENDPOINT,
      extractedAt: now().toISOString(),
      maxNormalizedLevel: MAX_LEVEL,
    },
    catalog: {
      version: 6.9,
      syncedAt: optionalString(catalog.syncedAt),
      commerceSyncedAt: optionalString(catalog.commerceSyncedAt || catalog.commerceSync?.completedAt),
      sourceProducts: catalog.products.length,
      visibleProducts: products.length,
    },
    categories: [...categoryById.values()].sort((left, right) => left.id - right.id),
    products: products.sort((left, right) => left.publicId.localeCompare(right.publicId)),
  };
  await writeJsonAtomically(path.resolve(outputPath), artifact);
  return { artifact, outputPath: path.resolve(outputPath) };
}

async function fetchBatchV69(keys, fetchImpl) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { keys } }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Magento GraphQL respondió HTTP ${response.status}.`);
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("application/json")) throw new Error("Magento GraphQL no devolvió JSON.");
      const body = JSON.parse(await readTextWithinLimit(response, MAX_RESPONSE_BYTES));
      if (Array.isArray(body?.errors) && body.errors.length) {
        throw new Error(`Magento GraphQL rechazó la consulta: ${body.errors[0]?.message || "error desconocido"}`);
      }
      const items = body?.data?.products?.items;
      if (!Array.isArray(items)) throw new Error("Magento GraphQL devolvió productos inválidos.");
      return items;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export async function readTextWithinLimit(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("La respuesta Magento excede el límite permitido.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("La respuesta Magento excede el límite permitido.");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function normalizeCategoryV69(value) {
  const breadcrumbs = Array.isArray(value?.breadcrumbs) ? value.breadcrumbs : [];
  return {
    id: positiveInteger(value?.id, "category id"),
    uid: requiredString(value?.uid, "category uid"),
    name: requiredString(value?.name, "category name"),
    level: nonNegativeInteger(value?.level, "category level"),
    path: requiredString(value?.path, "category path"),
    urlKey: optionalString(value?.url_key),
    urlPath: optionalString(value?.url_path),
    breadcrumbs: breadcrumbs.map((crumb) => ({
      categoryId: positiveInteger(crumb?.category_id, "breadcrumb category id"),
      categoryName: requiredString(crumb?.category_name, "breadcrumb category name"),
      categoryLevel: nonNegativeInteger(crumb?.category_level, "breadcrumb category level"),
      categoryUrlKey: optionalString(crumb?.category_url_key),
      categoryUrlPath: optionalString(crumb?.category_url_path),
    })),
  };
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`No se pudo leer ${label}.`, { cause: error });
  }
}

function assertUnique(values, key) {
  const seen = new Set();
  for (const value of values) {
    const identity = String(value[key]).toLowerCase();
    if (seen.has(identity)) throw new Error(`La extracción Magento V6.9 encontró ${key} duplicado: ${value[key]}.`);
    seen.add(identity);
  }
}

function normalizeSku(value) {
  return String(value || "").trim().toLowerCase();
}

function requiredString(value, field) {
  const result = optionalString(value);
  if (!result) throw new Error(`La extracción Magento V6.9 requiere ${field}.`);
  return result;
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function positiveInteger(value, field) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`La extracción Magento V6.9 recibió ${field} inválido.`);
  return result;
}

function nonNegativeInteger(value, field) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) throw new Error(`La extracción Magento V6.9 recibió ${field} inválido.`);
  return result;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function cliValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  extractMagentoTaxonomyV69({
    inputPath: cliValue("input") || path.join(ROOT, "data", "catalog-v69.json"),
    exclusionsPath: cliValue("exclusions") || path.join(ROOT, "data", "catalog-exclusions-v69.local.json"),
    outputPath: cliValue("output") || path.join(ROOT, "data", "catalog-taxonomy-v69.local.json"),
    batchSize: Number(cliValue("batch-size") || DEFAULT_BATCH_SIZE),
    onProgress: ({ processed, total }) => process.stderr.write(`[taxonomy-v69] ${processed}/${total}\n`),
  }).then(({ artifact, outputPath }) => {
    process.stdout.write(`${JSON.stringify({
      products: artifact.products.length,
      categories: artifact.categories.length,
      memberships: artifact.products.reduce((sum, product) => sum + product.categoryIds.length, 0),
      maxLevel: artifact.source.maxNormalizedLevel,
      output: outputPath,
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`[extract-magento-taxonomy-v69] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
