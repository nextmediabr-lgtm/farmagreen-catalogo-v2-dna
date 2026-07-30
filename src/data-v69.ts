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
};

export type CatalogV69 = Omit<Catalog, "products"> & {
  version: 6.9;
  availabilityReferenceAt: string | null;
  commerceSyncedAt: string | null;
  products: ProductV69[];
};

export const HIDDEN_REASONS_V69 = ["No vender", "Sin stock", "Imagen mala", "Precio dudoso", "Otro"] as const;
export type HiddenReasonV69 = (typeof HIDDEN_REASONS_V69)[number];

type HiddenEntryV69 = {
  reason: HiddenReasonV69;
  at: string;
};

export type ExclusionsV69 = {
  schemaVersion?: number;
  notes?: string;
  skus: string[];
  barcodes: string[];
  urls: string[];
  hidden: Record<string, HiddenEntryV69>;
};

let cacheKey = "";
let cache: CatalogV69 | null = null;

export async function catalogV69Data(environment: NodeJS.ProcessEnv = process.env): Promise<CatalogV69> {
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

  const products = parsed.products.map(cleanProductV69);
  const exclusions = await loadExclusionsV69(exclusionsPath, environment.V69_REQUIRE_EXCLUSIONS === "1");
  const visible = products.filter((product) => !isExcludedV69(product, exclusions));
  const commerceSyncedAt = validTimestamp(parsed.commerceSyncedAt || parsed.commerceSync?.completedAt);
  const latestAvailabilityCheck =
    visible
      .map((product) => product.availabilityCheckedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;

  cacheKey = key;
  cache = {
    ...parsed,
    version: 6.9,
    syncedAt: parsed.syncedAt,
    availabilityReferenceAt: commerceSyncedAt || latestAvailabilityCheck,
    commerceSyncedAt,
    totalProducts: visible.length,
    products: visible,
  };
  return cache;
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
  return {
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    skus: validateStringList(value.skus, "skus"),
    barcodes: validateStringList(value.barcodes, "barcodes"),
    urls: validateStringList(value.urls, "urls"),
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
}

function cleanProductV69(product: ProductV69): ProductV69 {
  const checkedAt = validTimestamp(product.availabilityCheckedAt);
  const availability: SourceAvailabilityV69 =
    checkedAt && (product.availability === "out_of_stock" || String(product.availability) === "unavailable_reference")
      ? "out_of_stock"
      : checkedAt && (product.availability === "limited" || String(product.availability) === "available_reference")
        ? "limited"
        : "unknown";
  return {
    ...product,
    availability,
    availabilityCheckedAt: checkedAt,
    sku: cleanOptional(product.sku),
    barcode: cleanOptional(product.barcode),
    source: product.source && typeof product.source === "object" ? { ...product.source, url: cleanOptional(product.source.url) } : undefined,
  };
}

function emptyExclusionsV69(): ExclusionsV69 {
  return { skus: [], barcodes: [], urls: [], hidden: {} };
}

function validateStringList(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`La lista privada V6.9 tiene un campo ${field} inválido.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
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
