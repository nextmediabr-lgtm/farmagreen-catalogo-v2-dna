import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalog, Product } from "./data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FALLBACK_CATALOG = path.join(ROOT, "data", "catalog-v68.json");
const SYNCED_CATALOG = path.join(ROOT, "data", "catalog-v69.json");
const DEFAULT_EXCLUSIONS = path.join(ROOT, "data", "catalog-exclusions-v69.local.json");

export type SourceAvailabilityV69 = "limited" | "out_of_stock" | "unknown";
export type PublicAvailabilityV69 = "available_reference" | "unavailable_reference" | "unverified";

export type ProductV69 = Product & {
  availability: SourceAvailabilityV69;
  availabilityCheckedAt: string | null;
  syncedAt?: string;
  sku?: string;
  barcode?: string;
  source?: {
    url?: string;
    [key: string]: unknown;
  };
  taxonomy?: Record<string, unknown>;
};

export type CatalogV69 = Omit<Catalog, "products"> & {
  version: 6.9;
  availabilityReferenceAt: string | null;
  commerceSyncedAt: string | null;
  products: ProductV69[];
};

export const HIDDEN_REASONS_V69 = ["Discontinuado"] as const;
export type HiddenReasonV69 = (typeof HIDDEN_REASONS_V69)[number];

type HiddenEntryV69 = {
  reason: HiddenReasonV69;
  at: string;
};

export type ExclusionsV69 = {
  schemaVersion?: number;
  notes?: string;
  products: PrivateProductIdentityV69[];
  skus: string[];
  barcodes: string[];
  urls: string[];
  hidden: Record<string, HiddenEntryV69>;
};

export type PrivateProductIdentityV69 = {
  sku: string;
  barcode: string;
  url: string;
};

let cacheKey = "";
let cache: CatalogV69 | null = null;
let runtimeCatalog: CatalogV69 | null = null;

export async function catalogV69Data(environment: NodeJS.ProcessEnv = process.env): Promise<CatalogV69> {
  if (runtimeCatalog) return runtimeCatalog;
  const catalogPath = environment.V69_CATALOG_FILE?.trim() || (await exists(SYNCED_CATALOG) ? SYNCED_CATALOG : FALLBACK_CATALOG);
  const exclusionsPath = environment.V69_EXCLUSIONS_FILE?.trim() || DEFAULT_EXCLUSIONS;
  const key = [
    await fileFingerprint(catalogPath),
    await fileFingerprint(exclusionsPath),
    environment.V69_REQUIRE_EXCLUSIONS || "",
  ].join("\n");
  if (cache && cacheKey === key) return cache;

  const parsed = JSON.parse(await fs.readFile(catalogPath, "utf8")) as Omit<CatalogV69, "version" | "availabilityReferenceAt" | "commerceSyncedAt"> & {
    commerceSyncedAt?: unknown;
    commerceSync?: { completedAt?: string };
  };
  if (!Array.isArray(parsed.products)) throw new Error("Catálogo base V6.9 inválido.");

  const exclusions = await loadExclusionsV69(exclusionsPath, environment.V69_REQUIRE_EXCLUSIONS === "1");

  cacheKey = key;
  cache = normalizeCatalogV69(parsed, exclusions);
  return cache;
}

export async function setCatalogV69Data(
  value: unknown,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Snapshot V6.9 inválido.");
  }
  const exclusionsPath = environment.V69_EXCLUSIONS_FILE?.trim() || DEFAULT_EXCLUSIONS;
  const exclusions = await loadExclusionsV69(
    exclusionsPath,
    environment.V69_REQUIRE_EXCLUSIONS === "1",
  );
  runtimeCatalog = normalizeCatalogV69(value as CatalogV69, exclusions);
  cache = runtimeCatalog;
  cacheKey = "runtime";
  return runtimeCatalog;
}

export async function loadExclusionsV69(filePath: string, required = false): Promise<ExclusionsV69> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !required) return emptyExclusionsV69();
    throw new Error("No se pudo leer la lista privada de exclusión V6.9.", { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("La lista privada de exclusión V6.9 contiene JSON inválido.", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("La lista privada de exclusión V6.9 tiene un formato inválido.");
  }

  const value = parsed as Record<string, unknown>;
  const hidden = validateHidden(value.hidden);
  const products = validatePrivateProducts(value.products);
  const skus = validateStringList(value.skus, "skus");
  const barcodes = validateStringList(value.barcodes, "barcodes");
  const urls = validateStringList(value.urls, "urls");
  return {
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    products,
    skus: [...new Set([...skus, ...products.map((product) => product.sku).filter(Boolean)])],
    barcodes: [...new Set([...barcodes, ...products.map((product) => product.barcode).filter(Boolean)])],
    urls: [...new Set([...urls, ...products.map((product) => product.url).filter(Boolean)])],
    hidden,
  };
}

export function isExcludedV69(product: ProductV69, exclusions: ExclusionsV69) {
  if (exclusions.hidden[product.publicId]) return true;
  const sku = product.sku;
  const barcode = product.barcode;
  if (sku && exclusions.skus.some((value) => normalizeSku(value) === normalizeSku(sku))) return true;
  if (barcode && exclusions.barcodes.some((value) => normalizeBarcode(value) === normalizeBarcode(barcode))) return true;
  const sourceUrl = product.source?.url;
  return Boolean(sourceUrl && exclusions.urls.some((value) => normalizeSourceUrl(value) === normalizeSourceUrl(sourceUrl)));
}

export function publicAvailabilityV69(product: Pick<ProductV69, "availability">): PublicAvailabilityV69 {
  if (product.availability === "out_of_stock") return "unavailable_reference";
  if (product.availability === "limited") return "available_reference";
  return "unverified";
}

export function resetCatalogV69CacheForTests() {
  cache = null;
  cacheKey = "";
  runtimeCatalog = null;
}

function normalizeCatalogV69(
  parsed: Omit<CatalogV69, "version" | "availabilityReferenceAt" | "commerceSyncedAt"> & {
    commerceSyncedAt?: unknown;
    commerceSync?: { completedAt?: string };
  },
  exclusions: ExclusionsV69,
): CatalogV69 {
  if (!Array.isArray(parsed.products)) throw new Error("Catálogo base V6.9 inválido.");
  const products = parsed.products.map(cleanProductV69);
  const visible = products.filter((product) => !isExcludedV69(product, exclusions));
  const commerceSyncedAt = validTimestamp(parsed.commerceSyncedAt || parsed.commerceSync?.completedAt);
  const latestAvailabilityCheck =
    visible
      .map((product) => product.availabilityCheckedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;
  return {
    ...parsed,
    version: 6.9,
    syncedAt: parsed.syncedAt,
    availabilityReferenceAt: commerceSyncedAt || latestAvailabilityCheck,
    commerceSyncedAt,
    totalProducts: visible.length,
    products: visible,
  };
}

function cleanProductV69(product: ProductV69): ProductV69 {
  const checkedAt = validTimestamp(product.availabilityCheckedAt);
  const availability: SourceAvailabilityV69 =
    checkedAt && (product.availability === "out_of_stock" || String(product.availability) === "unavailable_reference")
      ? "out_of_stock"
      : checkedAt && (product.availability === "limited" || String(product.availability) === "available_reference")
        ? "limited"
        : "unknown";
  return reviseFpsPrimaryUseV69({
    ...product,
    availability,
    availabilityCheckedAt: checkedAt,
    sku: cleanOptional(product.sku),
    barcode: cleanOptional(product.barcode),
    source: product.source && typeof product.source === "object" ? { ...product.source, url: cleanOptional(product.source.url) } : undefined,
  });
}

const EXPLICIT_SOLAR_PRODUCT_V69 =
  /\b(protector(?:a)? solar|proteccion solar|fotoprotector\w*|fotoproteccion|anthelios|capital soleil|ideal soleil|solar|sun|fotoultra|foto ultra|fusion water|eryfotona|actinic control|after sun|post solar|autobronceante|bronceador)\b/;

const FPS_PRIMARY_INTENTS_V69 = [
  {
    need: "manchas",
    pattern: /\b(anti pigment\w*|antipigment\w*|anti manchas?|antimanchas?|despigment\w*|mela b3|melasma|pigment control)\b/,
  },
  {
    need: "antiedad",
    pattern: /\b(antiedad|anti edad|antiage|anti aging|antiarrugas?|arrugas?|hyaluron filler|volume lift|elasticity|ultra firmeza|ultra age|revitalift|healthy renew|age correct|age repair|uv age|retinol|filler)\b/,
  },
  {
    need: "hidratacion",
    pattern: /\b(hidrat\w*|hydra\w*|hyalu b5|aqualia|moistur\w*|humect\w*|emoliente)\b/,
  },
] as const;

export function reviseFpsPrimaryUseV69(product: ProductV69): ProductV69 {
  if (product.primaryCategory !== "solares") return product;
  const evidence = normalizeIntentTextV69(product.name);
  if (EXPLICIT_SOLAR_PRODUCT_V69.test(evidence)) return product;
  const intent = FPS_PRIMARY_INTENTS_V69.find((candidate) => candidate.pattern.test(evidence));
  if (!intent) return product;

  const originalNeeds = Array.isArray(product.needs) ? [...product.needs] : [];
  const originalTaxonomy = product.taxonomy && typeof product.taxonomy === "object" ? product.taxonomy : {};
  return {
    ...product,
    primaryCategory: "rostro",
    categorySlugs: [...new Set([...(product.categorySlugs || []).filter((category) => category !== "solares"), "rostro"])],
    needs: [intent.need],
    taxonomy: {
      ...originalTaxonomy,
      reasonerVersion: "v69.1-fps-primary-intent",
      originalNeeds,
      selected: [
        {
          need: intent.need,
          confidence: 0.98,
          source: "name",
          field: "name",
          rule: "fps-is-attribute-not-primary-intent",
        },
      ],
      rejected: [
        {
          need: "solares",
          reason: "fps-without-explicit-solar-product-intent",
        },
      ],
    },
  };
}

function normalizeIntentTextV69(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function emptyExclusionsV69(): ExclusionsV69 {
  return { products: [], skus: [], barcodes: [], urls: [], hidden: {} };
}

function validateStringList(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`La lista privada V6.9 tiene un campo ${field} inválido.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function validatePrivateProducts(value: unknown): PrivateProductIdentityV69[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("La lista privada V6.9 tiene un campo products inválido.");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("La lista privada V6.9 contiene una identidad de producto inválida.");
    }
    const entry = raw as Record<string, unknown>;
    const sku = typeof entry.sku === "string" ? entry.sku.trim() : "";
    const barcode = typeof entry.barcode === "string" ? entry.barcode.trim() : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!sku && !barcode && !url) {
      throw new Error("La lista privada V6.9 contiene una identidad vacía.");
    }
    return { sku, barcode, url };
  });
}

function validateHidden(value: unknown): Record<string, HiddenEntryV69> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("La lista privada V6.9 tiene un campo hidden inválido.");
  }
  const result: Record<string, HiddenEntryV69> = {};
  for (const [publicId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("La lista privada V6.9 contiene una exclusión inválida.");
    }
    const entry = raw as Record<string, unknown>;
    if (!HIDDEN_REASONS_V69.includes(entry.reason as HiddenReasonV69) || typeof entry.at !== "string" || !entry.at.trim()) {
      throw new Error("La lista privada V6.9 contiene motivo o fecha inválidos.");
    }
    result[publicId.trim()] = { reason: entry.reason as HiddenReasonV69, at: entry.at.trim() };
  }
  return result;
}

function normalizeSku(value: string) {
  return String(value || "").trim();
}

function normalizeBarcode(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeSourceUrl(value: string) {
  try {
    const parsed = new URL(String(value || "").trim());
    const pathname = parsed.pathname.replace(/^\/categorias\//i, "/").replace(/\/+$/, "") || "/";
    return `${parsed.hostname.toLowerCase()}${pathname.toLowerCase()}`;
  } catch {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^([^/]+)\/categorias\//, "$1/")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

function cleanOptional(value: unknown) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || undefined;
}

function validTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fileFingerprint(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return `${filePath}:${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${filePath}:missing`;
    throw error;
  }
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
