import crypto from "node:crypto";
import { prepareCatalogV69Data, type CatalogV69 } from "./data-v69.js";
import { sourceImageV69 } from "./render-v69.js";

type Environment = Readonly<Record<string, string | undefined>>;

export function gcsImageV69(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "storage.googleapis.com" &&
      !url.username && !url.password;
  } catch { return false; }
}

export function responsiveJpegImagesReadyV691(product: CatalogV69["products"][number]) {
  return (["card", "detail"] as const).every((kind) => {
    const set = product.images?.responsive?.[kind];
    const variants = set?.jpeg || {};
    // Derivatives never upscale: a 621 px source correctly has keys 320/621.
    if (!set || !Number.isInteger(set.width) || set.width <= 0) return false;
    return [320, 640].every((width) => gcsImageV69(variants[String(Math.min(width, set.width))])) &&
      Object.entries(variants).every(([width, url]) => /^[1-9]\d*$/.test(width) && gcsImageV69(url));
  });
}

export function responsiveImagesReadyV691(product: CatalogV69["products"][number]) {
  return (["card", "detail"] as const).every((kind) => {
    const set = product.images?.responsive?.[kind];
    return set && Number.isInteger(set.width) && Number.isInteger(set.height) &&
      set.width > 0 && set.height > 0 && (["webp", "avif"] as const).every((format) => {
        const entries = Object.entries(set[format] || {});
        return entries.length > 0 && entries.every(([width, url]) => /^[1-9]\d*$/.test(width) && gcsImageV69(url));
      });
  });
}

export function assertCatalogPublicationV69(catalog: CatalogV69, environment: Environment) {
  if (catalog.version !== 6.9 || !catalog.products.length || !catalog.commerceSyncedAt) {
    throw new Error("Catálogo publicable incompleto.");
  }
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const product of catalog.products) {
    if (!product.publicId || ids.has(product.publicId) || (product.sku && skus.has(product.sku))) {
      throw new Error("Identidad de producto ausente o duplicada.");
    }
    ids.add(product.publicId);
    if (product.sku) skus.add(product.sku);
    if (!product.name || !product.brand?.name || !Array.isArray(product.needs) || !product.needs.length) {
      throw new Error("Producto sin datos de búsqueda o necesidades.");
    }
    const { listPrice, offerPrice, discountPercent, savingAmount } = product;
    if (![listPrice, offerPrice, discountPercent, savingAmount].every(Number.isFinite) ||
        offerPrice <= 0 || listPrice < offerPrice || discountPercent < 0 || discountPercent >= 100 ||
        Math.abs(savingAmount - (listPrice - offerPrice)) > 0.02 ||
        Math.abs(discountPercent - Math.round(100 * (listPrice - offerPrice) / listPrice)) > 1) {
      throw new Error("Precios inconsistentes en el candidato.");
    }
    if (product.promotion?.type === "percentage" &&
        Math.abs(product.promotion.percent - discountPercent) > 1) {
      throw new Error("Promoción porcentual inconsistente en el candidato.");
    }
    if (product.promotion?.type === "two_for_one" &&
        (product.promotion.buyQuantity !== 2 || product.promotion.payQuantity !== 1 ||
         Math.abs(product.promotion.unitPrice - listPrice) > 0.02 ||
         Math.abs(product.promotion.bundlePrice - listPrice) > 0.02 ||
         Math.abs(product.promotion.bundleSaving - listPrice) > 0.02 ||
         Math.abs(offerPrice - listPrice) > 0.02 ||
         Math.abs(savingAmount) > 0.02 ||
         Math.abs(discountPercent) > 0.02)) {
      throw new Error("Promoción 2×1 inconsistente en el candidato.");
    }
    if (product.availability === "unknown" || !product.availabilityCheckedAt) {
      throw new Error("Producto sin disponibilidad verificada.");
    }
    if (environment.V69_REQUIRE_MAGENTO_TAXONOMY === "1" && product.magentoTaxonomyAttached !== true) {
      throw new Error("Producto sin taxonomía Magento.");
    }
    if (!( ["card", "detail"] as const).every((kind) => gcsImageV69(sourceImageV69(product, kind))) ||
        (environment.V691_REQUIRE_RESPONSIVE_IMAGES === "1" && !responsiveImagesReadyV691(product)) ||
        (environment.V691_REQUIRE_JPEG_RESPONSIVE_IMAGES === "1" && !responsiveJpegImagesReadyV691(product))) {
      throw new Error("Imágenes públicas incompletas o inválidas.");
    }
  }
}

export async function preparePublicationV69(value: unknown, environment: Environment) {
  // Web and weekly Job must enforce exactly the same publication contract,
  // even when an older Job definition omitted one of the feature flags.
  const required = { ...environment, V69_REQUIRE_EXCLUSIONS: "1", V69_REQUIRE_MAGENTO_TAXONOMY: "1",
    V691_REQUIRE_RESPONSIVE_IMAGES: "1", V691_REQUIRE_JPEG_RESPONSIVE_IMAGES: "1" };
  const catalog = await prepareCatalogV69Data(value, required);
  assertCatalogPublicationV69(catalog, required);
  return catalog;
}

export function candidateDigestV69(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function assertCatalogTransitionV69(previous: unknown, candidate: unknown, approvedDigest = "") {
  const previousAt = Date.parse((previous as CatalogV69)?.commerceSyncedAt || "");
  const candidateAt = Date.parse((candidate as CatalogV69)?.commerceSyncedAt || "");
  if (Number.isFinite(previousAt) && (!Number.isFinite(candidateAt) || candidateAt <= previousAt)) {
    throw new Error("El candidato no avanza la fecha de sincronización.");
  }
  const before = (previous as CatalogV69)?.products || [];
  const after = (candidate as CatalogV69)?.products || [];
  if (before.length < 20) return;
  const offers = (items: typeof before) => items.filter((p) => p.discountPercent > 0 || Boolean(p.promotion)).length;
  const oldOffers = offers(before);
  const byId = new Map(before.map((p) => [p.publicId, p]));
  const jumps = after.filter((p) => {
    const old = byId.get(p.publicId);
    return old && old.offerPrice > 0 && (p.offerPrice / old.offerPrice > 2 || p.offerPrice / old.offerPrice < 0.5);
  }).length;
  const anomalies = [
    after.length < before.length * 0.7 ? "product_drop" : "",
    oldOffers >= 20 && offers(after) < oldOffers * 0.2 ? "offer_drop" : "",
    jumps > Math.max(5, after.length * 0.1) ? "price_jump" : "",
  ].filter(Boolean);
  if (anomalies.length && approvedDigest !== candidateDigestV69(candidate)) {
    throw new Error(`Revisión requerida: ${anomalies.join(",")}; candidato ${candidateDigestV69(candidate)}.`);
  }
}
