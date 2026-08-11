import fs from "node:fs/promises";

export const MAGENTO_TAXONOMY_MAX_LEVEL_V69 = 7;

export type MagentoCategoryV69 = {
  id: number;
  uid: string;
  name: string;
  level: number;
  path: string;
  urlKey: string;
  urlPath: string;
  breadcrumbs: Array<{
    categoryId: number;
    categoryName: string;
    categoryLevel: number;
    categoryUrlKey: string;
    categoryUrlPath: string;
  }>;
};

export type MagentoTaxonomyProductV69 = {
  publicId: string;
  sku: string;
  barcode: string;
  productUrl: string;
  urlKey: string;
  magentoProductId: number;
  categoryIds: number[];
};

export type MagentoTaxonomyV69 = {
  schemaVersion: 1;
  source: {
    platform: "Magento 2";
    endpoint: "https://gpsfarma.com/graphql";
    extractedAt: string;
    maxNormalizedLevel: 7;
  };
  catalog: {
    version: 6.9;
    syncedAt: string;
    commerceSyncedAt: string;
    sourceProducts: number;
    visibleProducts: number;
  };
  categories: MagentoCategoryV69[];
  products: MagentoTaxonomyProductV69[];
};

export type MagentoCategorySearchV69 = { id: string; name: string };

export async function loadMagentoTaxonomyV69(filePath: string, required = false): Promise<MagentoTaxonomyV69 | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !required) return null;
    throw new Error("No se pudo leer la taxonomía privada Magento V6.9.", { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("La taxonomía privada Magento V6.9 contiene JSON inválido.", { cause: error });
  }
  return validateMagentoTaxonomyV69(parsed);
}

export function validateMagentoTaxonomyV69(value: unknown): MagentoTaxonomyV69 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidTaxonomy();
  const raw = value as Record<string, unknown>;
  const source = asRecord(raw.source);
  const catalog = asRecord(raw.catalog);
  if (
    raw.schemaVersion !== 1 ||
    source.platform !== "Magento 2" ||
    source.endpoint !== "https://gpsfarma.com/graphql" ||
    source.maxNormalizedLevel !== MAGENTO_TAXONOMY_MAX_LEVEL_V69 ||
    !validTimestamp(source.extractedAt) ||
    catalog.version !== 6.9 ||
    !Array.isArray(raw.categories) ||
    !Array.isArray(raw.products)
  ) throw invalidTaxonomy();

  const categories = raw.categories.map(validateCategory);
  const categoryById = new Map<number, MagentoCategoryV69>();
  for (const category of categories) {
    if (categoryById.has(category.id)) throw new Error(`La taxonomía Magento V6.9 repite la categoría ${category.id}.`);
    categoryById.set(category.id, category);
  }

  const products = raw.products.map(validateProduct);
  const publicIds = new Set<string>();
  for (const product of products) {
    if (publicIds.has(product.publicId)) throw new Error(`La taxonomía Magento V6.9 repite el producto ${product.publicId}.`);
    publicIds.add(product.publicId);
    for (const categoryId of product.categoryIds) {
      if (!categoryById.has(categoryId)) {
        throw new Error(`La taxonomía Magento V6.9 referencia la categoría inexistente ${categoryId}.`);
      }
    }
  }

  return {
    schemaVersion: 1,
    source: {
      platform: "Magento 2",
      endpoint: "https://gpsfarma.com/graphql",
      extractedAt: String(source.extractedAt),
      maxNormalizedLevel: 7,
    },
    catalog: {
      version: 6.9,
      syncedAt: cleanString(catalog.syncedAt),
      commerceSyncedAt: cleanString(catalog.commerceSyncedAt),
      sourceProducts: positiveInteger(catalog.sourceProducts, "sourceProducts", true),
      visibleProducts: positiveInteger(catalog.visibleProducts, "visibleProducts", true),
    },
    categories,
    products,
  };
}

function validateCategory(value: unknown): MagentoCategoryV69 {
  const raw = asRecord(value);
  const level = positiveInteger(raw.level, "level", true);
  if (level > MAGENTO_TAXONOMY_MAX_LEVEL_V69) throw new Error(`La categoría Magento ${raw.id} supera level 7.`);
  const breadcrumbs = Array.isArray(raw.breadcrumbs)
    ? raw.breadcrumbs.map((entry) => {
      const crumb = asRecord(entry);
      return {
        categoryId: positiveInteger(crumb.categoryId, "categoryId"),
        categoryName: cleanString(crumb.categoryName, true),
        categoryLevel: positiveInteger(crumb.categoryLevel, "categoryLevel", true),
        categoryUrlKey: cleanString(crumb.categoryUrlKey),
        categoryUrlPath: cleanString(crumb.categoryUrlPath),
      };
    })
    : [];
  return {
    id: positiveInteger(raw.id, "id"),
    uid: cleanString(raw.uid, true),
    name: cleanString(raw.name, true),
    level,
    path: cleanString(raw.path, true),
    urlKey: cleanString(raw.urlKey),
    urlPath: cleanString(raw.urlPath),
    breadcrumbs,
  };
}

function validateProduct(value: unknown): MagentoTaxonomyProductV69 {
  const raw = asRecord(value);
  if (!Array.isArray(raw.categoryIds)) throw invalidTaxonomy();
  const categoryIds = [...new Set(raw.categoryIds.map((id) => positiveInteger(id, "categoryId")))];
  return {
    publicId: cleanString(raw.publicId, true),
    sku: cleanString(raw.sku, true),
    barcode: cleanString(raw.barcode),
    productUrl: cleanString(raw.productUrl, true),
    urlKey: cleanString(raw.urlKey, true),
    magentoProductId: positiveInteger(raw.magentoProductId, "magentoProductId"),
    categoryIds,
  };
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidTaxonomy();
  return value as Record<string, unknown>;
}

function cleanString(value: unknown, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw invalidTaxonomy();
  return result;
}

function positiveInteger(value: unknown, field: string, allowZero = false) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`La taxonomía Magento V6.9 contiene ${field} inválido.`);
  }
  return parsed;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function invalidTaxonomy() {
  return new Error("La taxonomía privada Magento V6.9 tiene un formato inválido.");
}
