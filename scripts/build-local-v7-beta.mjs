import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GPS_EXPANSION_SOURCES_V7_BETA,
  GPS_SOURCES_V7_BETA,
  sourceByIdV7Beta,
} from "./catalog-sources-v7-beta.mjs";
import {
  PAGE_SIZE,
  createLocationScopedFetchV69,
  normalizeGpsImagePath,
  normalizeGpsProductUrl,
  parseListingProducts,
  parseNextPageUrl,
  parseProductIdentityV69,
  trustedGpsUrl,
  writeJsonAtomically,
} from "./sync-catalog-commerce-v69.mjs";
import { normalizeProductText, textFromHtml } from "./gpsfarma-listing.mjs";
import { filterExcludedProductsV69 } from "./prepare-gcp-catalog-v69.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_LOCAL_V7_BETA_OUTPUT = path.join(
  os.tmpdir(),
  "farmagreen-catalog-v7-beta.json",
);
export const DEFAULT_LOCAL_V7_BETA_INTERMEDIATE = path.join(
  os.tmpdir(),
  "farmagreen-catalog-v7-beta-intermediate.json",
);

const VALID_AVAILABILITY = new Set(["available", "unavailable"]);
const METADATA_ONLY_DESCRIPTION = "La ficha todavía no incluye una descripción ampliada de este producto.";
const CONFIGURED_CATALOG_FACETS_V7_BETA = new Map(
  GPS_SOURCES_V7_BETA.map((source) => [source.facet.slug, source.facet]),
);

export function parseProductDetailV69(html) {
  const identity = parseProductIdentityV69(html);
  const descriptionHtml =
    String(html || "").match(
      /<div\s+class="product attribute description">[\s\S]*?<div\s+class="value"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    )?.[1] || "";
  const overviewHtml =
    String(html || "").match(
      /<div\s+class="product attribute overview">[\s\S]*?<div\s+class="value"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i,
    )?.[1] || "";
  const image =
    String(html || "").match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1] || "";
  return {
    ...identity,
    description: tidy(textFromHtml(descriptionHtml)),
    overview: tidy(textFromHtml(overviewHtml)),
    image,
  };
}

export function parseProductPageCommerceV7Beta(html, expectedProduct = {}) {
  const source = String(html || "");
  const detail = parseProductDetailV69(source);
  const pageSku = normalizeRawIdentity(
    detail.sku || source.match(/data-product-sku=["']([^"']+)["']/i)?.[1],
  );
  const expectedSku = normalizeSku(expectedProduct.sku);
  if (expectedSku && normalizeSku(pageSku) !== expectedSku) {
    throw new Error(`La ficha directa no corresponde al SKU esperado ${expectedSku}.`);
  }
  const expectedBarcode = normalizeBarcode(expectedProduct.barcode);
  const pageBarcode = normalizeBarcode(detail.barcode);
  if (expectedBarcode && pageBarcode && pageBarcode !== expectedBarcode) {
    throw new Error(`La ficha directa contradice el código de barra del SKU ${expectedSku || pageSku}.`);
  }

  const finalPrice = priceAmountFromProductPageV7Beta(source, "finalPrice");
  const oldPrice = priceAmountFromProductPageV7Beta(source, "oldPrice");
  if (!(finalPrice > 0)) throw new Error(`La ficha directa ${expectedSku || pageSku} no informó precio actual.`);
  const listPrice = oldPrice > 0 ? Math.max(oldPrice, finalPrice) : finalPrice;
  const formTags = [...source.matchAll(/<form\b[^>]*>/gi)].map((match) => match[0]);
  const hasCartForm = formTags.some((tag) => {
    const formSku = normalizeSku(htmlAttributeV7Beta(tag, "data-product-sku"));
    const role = htmlAttributeV7Beta(tag, "data-role").toLowerCase();
    const action = htmlAttributeV7Beta(tag, "action").toLowerCase();
    return formSku === normalizeSku(pageSku) && (role === "tocart-form" || action.includes("/checkout/cart/add/"));
  });
  const explicitUnavailable =
    /<(?:div|span|p)\b[^>]*class=["'][^"']*(?:stock\s+unavailable|out-of-stock)[^"']*["'][^>]*>/i.test(source) ||
    /data-stock-status=["'](?:out_of_stock|unavailable)["']/i.test(source);
  if (hasCartForm && explicitUnavailable) {
    throw new Error(`La ficha directa ${expectedSku || pageSku} contiene disponibilidad contradictoria.`);
  }
  if (!hasCartForm && !explicitUnavailable) {
    throw new Error(`La ficha directa ${expectedSku || pageSku} no contiene evidencia explícita de disponibilidad.`);
  }
  const savingAmount = Math.max(0, listPrice - finalPrice);
  return {
    ...detail,
    sku: pageSku,
    barcode: pageBarcode || expectedBarcode,
    availability: hasCartForm ? "available" : "unavailable",
    listPrice,
    offerPrice: finalPrice,
    savingAmount,
    discountPercent: listPrice > 0 ? Math.round((savingAmount / listPrice) * 100) : 0,
  };
}

export async function addDirectBaseFallbacksV7Beta(
  baseCatalog,
  detailedGroups,
  exclusions,
  { fetchHtml, concurrency = 6, onProgress } = {},
) {
  const baseIndex = buildBaseIndexV69(baseCatalog?.products || []);
  const matchedIndexes = new Set(
    resolveCanonicalGroupsV7Beta(consolidateDetailedGroupsV69(detailedGroups), baseIndex)
      .map((entry) => entry.matchedIndex)
      .filter((index) => index !== null),
  );
  const exclusionMatcher = createExclusionMatcherV7Beta(exclusions);
  const targets = (baseCatalog?.products || [])
    .map((product, index) => ({ product, index }))
    .filter(({ product, index }) => !matchedIndexes.has(index) && !productMatchesExclusionV7Beta(product, exclusionMatcher));
  if (!targets.length) return { detailedGroups, added: 0 };
  if (typeof fetchHtml !== "function") throw new Error("La cobertura directa V7 Beta requiere una sesión STOM.");
  let processed = 0;
  const additions = await mapLimit(targets, concurrency, async ({ product, index }) => {
    const sourceUrl = trustedGpsUrl(product?.source?.url);
    const commerce = parseProductPageCommerceV7Beta(await fetchHtml(sourceUrl), product);
    const source = GPS_SOURCES_V7_BETA.find(
      (candidate) =>
        String(candidate.catalogBrandId) === String(product.brand?.id) ||
        normalizeProductText(candidate.catalogBrandName) === normalizeProductText(product.brand?.name),
    );
    const facet = source?.facet || brandFacetV7Beta(product.brand);
    processed += 1;
    onProgress?.({ processed, total: targets.length, product });
    return {
      baseIndex: index,
      members: [{
        sourceId: String(source?.id || product.brand?.id || "direct-base"),
        catalogBrandId: String(source?.catalogBrandId || product.brand?.id || "direct-base"),
        catalogBrandName: source?.catalogBrandName || product.brand?.name || "Farmagreen",
        catalogFacet: facet,
        sourceMembershipOnly: false,
        sourceFallbackDirect: true,
        sourceUrl,
        sourceName: product.name,
        sourceBrand: product.brand?.name,
        listedBrand: product.brand?.name,
        imageUrl: trustedGpsImageV69(commerce.image) || product.images?.original || product.images?.detail || product.images?.card || "",
        sku: commerce.sku,
        barcode: commerce.barcode,
        position: Number(product.catalogPositions?.[facet.slug]) || undefined,
        availability: commerce.availability,
        listPrice: commerce.listPrice,
        offerPrice: commerce.offerPrice,
        savingAmount: commerce.savingAmount,
        discountPercent: commerce.discountPercent,
      }],
      detail: {
        sku: commerce.sku,
        barcode: commerce.barcode,
        description: commerce.description,
        overview: commerce.overview,
        image: commerce.image,
      },
    };
  });
  return { detailedGroups: [...detailedGroups, ...additions], added: additions.length };
}

export function sourceStartUrlV7Beta(source) {
  const url = new URL(source.pathname || "/categorias.html", "https://gpsfarma.com");
  if (source.mode === "brand") url.searchParams.set("marca", source.id);
  if (source.mode === "search") url.searchParams.set("q", source.query || source.catalogBrandName);
  url.searchParams.set("p", "1");
  url.searchParams.set("product_list_limit", String(PAGE_SIZE));
  url.searchParams.set("product_list_order", "position");
  return trustedGpsUrl(url);
}

export async function crawlSourceV7Beta(
  source,
  { fetchHtml, maxPages = 100, delayMs = 100 } = {},
) {
  if (typeof fetchHtml !== "function") throw new Error("La V7 Beta requiere una sesión STOM.");
  const seenPages = new Set();
  const seenFingerprints = new Set();
  const productsByUrl = new Map();
  const pages = [];
  let currentUrl = sourceStartUrlV7Beta(source);
  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = trustedGpsUrl(currentUrl);
    if (seenPages.has(pageUrl)) throw new Error(`Bucle de paginación en ${source.catalogBrandName}.`);
    seenPages.add(pageUrl);
    const html = await fetchHtml(pageUrl);
    const listed = parseListingProducts(html, source).map((product, index) => ({
      ...product,
      catalogFacet: source.facet,
      sourceMembershipOnly: Boolean(source.membershipOnly),
      position: (page - 1) * PAGE_SIZE + index + 1,
    }));
    const fingerprint = listed.map((product) => normalizeGpsProductUrl(product.sourceUrl)).sort().join("\n");
    if (listed.length && seenFingerprints.has(fingerprint)) {
      throw new Error(`Página repetida en ${source.catalogBrandName}.`);
    }
    if (listed.length) seenFingerprints.add(fingerprint);
    const before = productsByUrl.size;
    for (const product of listed) productsByUrl.set(normalizeGpsProductUrl(product.sourceUrl), product);
    const nextUrl = parseNextPageUrl(html);
    pages.push({ page, listed: listed.length, newItems: productsByUrl.size - before, hasNext: Boolean(nextUrl) });
    if (!nextUrl) {
      if (!productsByUrl.size) {
        throw new Error(`La fuente ${source.catalogBrandName} terminó vacía.`);
      }
      return {
        id: source.id,
        catalogBrandId: source.catalogBrandId,
        catalogBrandName: source.catalogBrandName,
        facet: source.facet,
        membershipOnly: Boolean(source.membershipOnly),
        status: "completed",
        pages,
        products: [...productsByUrl.values()],
      };
    }
    if (!listed.length) throw new Error(`Página vacía con continuación en ${source.catalogBrandName}.`);
    if (page === maxPages) throw new Error(`Paginación incompleta en ${source.catalogBrandName}.`);
    currentUrl = nextUrl;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Paginación incompleta en ${source.catalogBrandName}.`);
}

export async function crawlAllSourcesV7Beta(
  sources = GPS_SOURCES_V7_BETA,
  { fetchHtml, concurrency = 3, onProgress } = {},
) {
  return mapLimit(sources, concurrency, async (source) => {
    const result = await crawlSourceV7Beta(source, { fetchHtml });
    onProgress?.(result);
    return result;
  });
}

export function validateSourceResultsV7Beta(
  sourceResults,
  expectedSources = GPS_SOURCES_V7_BETA,
) {
  if (!Array.isArray(sourceResults)) throw new Error("Resultados de fuentes V7 Beta inválidos.");
  const expectedIds = expectedSources.map((source) => String(source.id));
  const expected = new Set(expectedIds);
  const byId = new Map();
  const unexpected = [];
  for (const result of sourceResults) {
    const id = String(result?.id || "");
    if (!expected.has(id)) unexpected.push(id || "(sin id)");
    if (byId.has(id)) throw new Error(`La fuente V7 Beta ${id} está duplicada.`);
    byId.set(id, result);
  }
  const missing = expectedIds.filter((id) => !byId.has(id));
  const incomplete = expectedIds.filter((id) => {
    const result = byId.get(id);
    return result && (result.status !== "completed" || !Array.isArray(result.products) || !result.products.length);
  });
  if (missing.length || incomplete.length || unexpected.length) {
    throw new Error(
      `Fuentes V7 Beta incompletas: faltantes=${missing.join(",") || "ninguna"}; ` +
      `vacías/fallidas=${incomplete.join(",") || "ninguna"}; inesperadas=${unexpected.join(",") || "ninguna"}.`,
    );
  }
  return sourceResults;
}

export function groupSourceListingsV69(sourceResults) {
  const members = sourceResults.flatMap((result) => {
    const definition = sourceByIdV7Beta(result.id) || result;
    return (result.products || []).map((product) => ({
      ...product,
      sourceId: String(result.id),
      catalogFacet: product.catalogFacet || definition.facet,
      sourceMembershipOnly:
        product.sourceMembershipOnly ?? Boolean(definition.membershipOnly),
    }));
  });
  return groupMembersByIdentityV69(members);
}

function groupMembersByIdentityV69(members) {
  const parent = members.map((_, index) => index);
  const find = (index) => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const buckets = {
    sku: new Map(),
    url: new Map(),
    image: new Map(),
  };
  members.forEach((member, index) => {
    addBucket(buckets.sku, normalizeSku(member.sku), index);
    addBucket(buckets.url, normalizeGpsProductUrl(member.sourceUrl), index);
    addBucket(buckets.image, normalizeGpsImagePath(member.imageUrl), index);
  });
  for (const [kind, bucket] of Object.entries(buckets)) {
    for (const indexes of bucket.values()) {
      const skus = new Set(indexes.map((index) => normalizeSku(members[index].sku)).filter(Boolean));
      if (skus.size > 1) {
        if (kind === "url") {
          throw new Error(`Conflicto de identidad por URL: una ficha apunta a ${skus.size} SKU.`);
        }
        continue;
      }
      for (let index = 1; index < indexes.length; index += 1) union(indexes[0], indexes[index]);
    }
  }
  const groups = new Map();
  members.forEach((member, index) => {
    const root = find(index);
    const group = groups.get(root) || { members: [] };
    group.members.push(member);
    groups.set(root, group);
  });
  const result = [...groups.values()];
  assertNoConflictingIdentitiesV7Beta(result, "los listados");
  return result;
}

export async function enrichListingGroupsV69(
  groups,
  { fetchHtml, baseCatalog, concurrency = 6, onProgress = defaultDetailProgress } = {},
) {
  if (typeof fetchHtml !== "function") throw new Error("La V7 Beta requiere una sesión STOM.");
  const baseIndex = buildBaseIndexV69(baseCatalog?.products || []);
  let processed = 0;
  return mapLimit(groups, concurrency, async (group) => {
    const preMatchedIndex = matchBaseIndexV69(group, baseIndex);
    if (preMatchedIndex !== null) {
      processed += 1;
      onProgress?.({ processed, total: groups.length, status: "existing" });
      return { ...group, baseIndex: preMatchedIndex, detail: {} };
    }
    const candidates = preferredMembersV69(group.members);
    let detail = {};
    let lastError = null;
    for (const member of candidates.slice(0, 3)) {
      try {
        detail = mergeDetailV69(detail, parseProductDetailV69(await fetchHtml(member.sourceUrl)));
        if (detail.sku && detail.barcode && (detail.description || detail.overview)) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!detail.sku && !detail.barcode && lastError) throw lastError;
    processed += 1;
    onProgress?.({ processed, total: groups.length, status: "enriched" });
    return { ...group, detail };
  });
}

export function consolidateDetailedGroupsV69(groups) {
  const parent = groups.map((_, index) => index);
  const find = (index) => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  for (const key of ["baseIndex", "sku", "barcode", "title"]) {
    const buckets = new Map();
    groups.forEach((group, index) => {
      const values = identityValuesV69(group, key);
      for (const value of values) addBucket(buckets, value, index);
    });
    for (const indexes of buckets.values()) {
      const skus = identitiesAcrossGroupsV7Beta(groups, indexes, "sku");
      const barcodes = identitiesAcrossGroupsV7Beta(groups, indexes, "barcode");
      const baseIndexes = identitiesAcrossGroupsV7Beta(groups, indexes, "baseIndex");
      if (key === "baseIndex" && (skus.size > 1 || barcodes.size > 1)) {
        throw new Error("Dos grupos de una ficha base contienen identidades incompatibles.");
      }
      if (key === "barcode" && skus.size > 1) continue;
      if (key === "title" && (skus.size > 1 || barcodes.size > 1 || baseIndexes.size > 1)) continue;
      for (let index = 1; index < indexes.length; index += 1) union(indexes[0], indexes[index]);
    }
  }
  const merged = new Map();
  groups.forEach((group, index) => {
    const root = find(index);
    const current = merged.get(root) || { members: [], detail: {}, baseIndex: null };
    current.members.push(...group.members);
    current.detail = mergeDetailV69(current.detail, group.detail || {});
    if (group.baseIndex !== undefined && group.baseIndex !== null) {
      if (current.baseIndex !== null && current.baseIndex !== group.baseIndex) {
        const names = [
          ...current.members.map((member) => member.sourceName),
          ...(group.members || []).map((member) => member.sourceName),
        ].filter(Boolean);
        const combined = { members: [...current.members, ...(group.members || [])], detail: mergeDetailV69(current.detail, group.detail || {}) };
        const skuHashes = [...identityValuesV69(combined, "sku")].map((value) =>
          crypto.createHash("sha256").update(value).digest("hex").slice(0, 8),
        );
        const barcodes = [...identityValuesV69(combined, "barcode")];
        throw new Error(
          `Una identidad expandida coincide con dos fichas base distintas: ${current.baseIndex} y ${group.baseIndex}; ` +
            `apariciones=${[...new Set(names)].slice(0, 6).join(" | ")}; ` +
            `skuHashes=${skuHashes.join(",")}; barcodes=${barcodes.join(",")}.`,
        );
      }
      current.baseIndex = group.baseIndex;
    }
    merged.set(root, current);
  });
  const result = [...merged.values()];
  assertNoConflictingIdentitiesV7Beta(result, "la consolidación detallada");
  return result;
}

export function mergeCatalogV7Beta(
  baseCatalog,
  detailedGroups,
  exclusions,
  { completedAt = new Date().toISOString(), requireCompleteSources = true } = {},
) {
  if (!baseCatalog || !Array.isArray(baseCatalog.products) || !baseCatalog.products.length) {
    throw new Error("Catálogo base inválido para construir V7 Beta.");
  }
  const products = baseCatalog.products.map((product) => ({ ...product }));
  const baseIndex = buildBaseIndexV69(products);
  const baseProductCount = products.length;
  const sourceIds = GPS_SOURCES_V7_BETA
    .map((source) => String(source.id))
    .filter((sourceId) => detailedGroups.some(
      (group) => (group.members || []).some((member) => String(member.sourceId) === sourceId),
    ));
  const missingSourceIds = GPS_SOURCES_V7_BETA
    .map((source) => String(source.id))
    .filter((sourceId) => !sourceIds.includes(sourceId));
  const exclusionMatcher = createExclusionMatcherV7Beta(exclusions);
  const forcedHidden = {};
  let matchedExisting = 0;
  let added = 0;
  let excludedSourceGroups = 0;
  let excludedNewGroups = 0;

  const resolvedGroups = resolveCanonicalGroupsV7Beta(
    consolidateDetailedGroupsV69(detailedGroups),
    baseIndex,
  );
  for (const { group, matchedIndex } of resolvedGroups) {
    const matchedProduct = matchedIndex === null ? null : products[matchedIndex];
    if (
      groupMatchesExclusionV7Beta(group, exclusionMatcher) ||
      (matchedProduct && productMatchesExclusionV7Beta(matchedProduct, exclusionMatcher))
    ) {
      if (matchedProduct?.publicId) {
        forcedHidden[matchedProduct.publicId] = { reason: "Discontinuado", at: completedAt };
      } else {
        excludedNewGroups += 1;
      }
      excludedSourceGroups += 1;
      continue;
    }
    if (matchedIndex !== null) {
      products[matchedIndex] = mergeExistingProductV69(products[matchedIndex], group, completedAt);
      if (matchedIndex < baseProductCount) matchedExisting += 1;
      continue;
    }
    const product = newProductFromSourceGroupV69(group, completedAt);
    if (productMatchesExclusionV7Beta(product, exclusionMatcher)) {
      excludedSourceGroups += 1;
      excludedNewGroups += 1;
      continue;
    }
    products.push(product);
    addProductToBaseIndexV69(baseIndex, product, products.length - 1);
    added += 1;
  }

  assertUniqueCatalogV69(products);
  const merged = {
    ...baseCatalog,
    version: 7,
    releaseChannel: "beta-local",
    syncedAt: baseCatalog.syncedAt,
    commerceSyncedAt: completedAt,
    availabilityReferenceAt: completedAt,
    totalProducts: products.length,
    commerceSync: {
      completedAt,
      status: "completed",
      metrics: {},
      coverage: 1,
    },
    v7Beta: {
      completedAt,
      inventoryLocation: "Rosario",
      inventorySource: "STOM",
      sourceIds,
      expectedSourceCount: GPS_SOURCES_V7_BETA.length,
      sourceCoverage: sourceIds.length / GPS_SOURCES_V7_BETA.length,
      missingSourceIds,
      rawListings: detailedGroups.reduce((sum, group) => sum + group.members.length, 0),
      canonicalSourceProducts: detailedGroups.length,
      matchedExisting,
      added,
      excludedSourceGroups,
      excludedNewGroups,
      directBaseFallbacks: detailedGroups.filter(
        (group) => (group.members || []).some((member) => member.sourceFallbackDirect),
      ).length,
      policy: "one-canonical-product; facet-memberships; source-position; exclusions-final",
    },
    products,
  };
  const effectiveExclusions = {
    ...(exclusions || {}),
    hidden: { ...((exclusions && exclusions.hidden) || {}), ...forcedHidden },
  };
  const filtered = filterExcludedProductsV69(merged, effectiveExclusions);
  const excluded = merged.products.length - filtered.products.length + excludedNewGroups;
  assertUniqueCatalogV69(filtered.products);
  assertCommerceReadyV69(filtered.products);
  assertCurrentCycleCoverageV7Beta(filtered.products, completedAt);
  assertCuratedCatalogFacetsV7Beta(filtered.products);
  const visibleFacetSlugs = new Set(
    filtered.products.flatMap((product) => (product.catalogFacets || []).map((facet) => facet.slug)),
  );
  const missingFacetSlugs = GPS_EXPANSION_SOURCES_V7_BETA
    .map((source) => source.facet.slug)
    .filter((slug) => !visibleFacetSlugs.has(slug));
  const sourcesComplete = missingSourceIds.length === 0 && missingFacetSlugs.length === 0;
  filtered.version = 7;
  filtered.releaseChannel = "beta-local";
  filtered.v7Beta = {
    ...filtered.v7Beta,
    excluded,
    visible: filtered.products.length,
    currentCycleCoverage: 1,
    missingFacetSlugs,
    sourcesComplete,
  };
  if (requireCompleteSources && !sourcesComplete) {
    throw new Error(
      `V7 Beta incompleta: fuentes faltantes=${missingSourceIds.join(",") || "ninguna"}; ` +
      `facetas faltantes=${missingFacetSlugs.join(",") || "ninguna"}.`,
    );
  }
  return filtered;
}

function resolveCanonicalGroupsV7Beta(groups, baseIndex) {
  const resolved = [];
  const slotByBaseIndex = new Map();
  for (const group of groups) {
    const matchedIndex = group.baseIndex ?? matchBaseIndexV69(group, baseIndex);
    if (matchedIndex === null) {
      resolved.push({ group, matchedIndex: null });
      continue;
    }
    const slot = slotByBaseIndex.get(matchedIndex);
    if (slot === undefined) {
      slotByBaseIndex.set(matchedIndex, resolved.length);
      resolved.push({ group: { ...group, baseIndex: matchedIndex }, matchedIndex });
      continue;
    }
    const current = resolved[slot].group;
    const merged = {
      members: [...(current.members || []), ...(group.members || [])],
      detail: mergeDetailV69(current.detail || {}, group.detail || {}),
      baseIndex: matchedIndex,
    };
    assertNoConflictingIdentitiesV7Beta([merged], `la ficha base ${matchedIndex}`);
    resolved[slot] = { group: merged, matchedIndex };
  }
  return resolved;
}

export async function runLocalV7Beta({
  rootDir = ROOT,
  outputPath = DEFAULT_LOCAL_V7_BETA_OUTPUT,
  sources = GPS_SOURCES_V7_BETA,
  fetchHtml,
  sourceResults,
  intermediatePath = DEFAULT_LOCAL_V7_BETA_INTERMEDIATE,
  resumeIntermediate = false,
  now = () => new Date(),
  onSourceProgress,
  onDetailProgress,
} = {}) {
  const baseCatalog = JSON.parse(await fs.readFile(path.join(rootDir, "data", "catalog-v69.json"), "utf8"));
  const exclusions = JSON.parse(
    await fs.readFile(path.join(rootDir, "data", "catalog-exclusions-v69.local.json"), "utf8"),
  );
  let crawled;
  let grouped;
  let enriched;
  let scopedFetch = fetchHtml;
  if (resumeIntermediate) {
    const intermediate = JSON.parse(await fs.readFile(intermediatePath, "utf8"));
    if (intermediate?.schemaVersion !== 1 || !Array.isArray(intermediate.detailedGroups)) {
      throw new Error("Checkpoint V7 Beta inválido.");
    }
    crawled = validateSourceResultsV7Beta(intermediate.sourceResults, GPS_SOURCES_V7_BETA);
    grouped = groupSourceListingsV69(crawled);
    enriched = intermediate.detailedGroups;
  } else {
    scopedFetch ||= await createLocationScopedFetchV69();
    crawled = sourceResults || await crawlAllSourcesV7Beta(sources, {
      fetchHtml: scopedFetch,
      concurrency: 3,
      onProgress: onSourceProgress,
    });
    validateSourceResultsV7Beta(crawled, GPS_SOURCES_V7_BETA);
    grouped = groupSourceListingsV69(crawled);
    enriched = await enrichListingGroupsV69(grouped, {
      fetchHtml: scopedFetch,
      baseCatalog,
      concurrency: 8,
      onProgress: onDetailProgress,
    });
  }
  scopedFetch ||= await createLocationScopedFetchV69();
  const fallback = await addDirectBaseFallbacksV7Beta(baseCatalog, enriched, exclusions, {
    fetchHtml: scopedFetch,
    concurrency: 6,
    onProgress: ({ processed, total }) => process.stderr.write(`[directo] ${processed}/${total}\n`),
  });
  enriched = fallback.detailedGroups;
  await writeJsonAtomically(intermediatePath, {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceResults: crawled,
    detailedGroups: enriched,
  });
  const completedAt = now().toISOString();
  const catalog = mergeCatalogV7Beta(baseCatalog, enriched, exclusions, { completedAt });
  await writeJsonAtomically(outputPath, catalog);
  return { outputPath, catalog, grouped: grouped.length, rawListings: grouped.reduce((sum, group) => sum + group.members.length, 0) };
}

function mergeExistingProductV69(product, group, completedAt) {
  const member = preferredMembersV69(group.members)[0];
  if (!validPricingV69(member)) {
    throw new Error(`La fuente actual no informó un precio válido para ${product.publicId}.`);
  }
  const facets = mergeFacetsV69(existingFacetsV69(product), facetsFromMembersV69(group.members));
  const positions = mergePositionsV69(product.catalogPositions, group.members);
  const availability = sourceAvailabilityV69(member.availability);
  return {
    ...product,
    ...(validPricingV69(member) ? pricingV69(member) : {}),
    availability,
    availabilityCheckedAt: completedAt,
    sku: product.sku || group.detail?.sku || member.sku || undefined,
    barcode: product.barcode || group.detail?.barcode || undefined,
    catalogFacets: facets,
    catalogPositions: positions,
    source: {
      ...(product.source && typeof product.source === "object" ? product.source : {}),
      retrievedAt: completedAt,
    },
  };
}

export function newProductFromSourceGroupV69(group, completedAt) {
  const member = preferredMembersV69(group.members)[0];
  const brand = brandForGroupV69(group);
  const name = tidy(member.sourceName);
  const sku = normalizeRawIdentity(group.detail?.sku || member.sku);
  const barcode = normalizeBarcode(group.detail?.barcode);
  const identity = sku
    ? `sku:${normalizeSku(sku)}`
    : barcode
      ? `barcode:${barcode}`
      : `url:${normalizeGpsProductUrl(member.sourceUrl)}|image:${normalizeGpsImagePath(member.imageUrl)}|${normalizeProductText(`${brand.name} ${name}`)}`;
  const publicId = crypto.createHash("sha256").update(`farmagreen-v69|${identity}`).digest("hex").slice(0, 12);
  const taxonomy = inferTaxonomyV69(name, brand.name);
  const description = tidy(group.detail?.description || group.detail?.overview) || METADATA_ONLY_DESCRIPTION;
  const image = trustedGpsImageV69(group.detail?.image) || member.imageUrl || "";
  if (!image) throw new Error(`Producto nuevo sin imagen: ${name}`);
  const configuredBrandFacet = configuredBrandFacetV7Beta(brand);
  const catalogFacets = mergeFacetsV69(
    configuredBrandFacet ? [configuredBrandFacet] : [],
    facetsFromMembersV69(group.members),
  );
  return {
    publicId,
    slug: `${slugify(`${brand.name}-${name}`)}--${publicId}`,
    name,
    brand,
    line: brand.name,
    primaryCategory: taxonomy.primaryCategory,
    categorySlugs: [taxonomy.primaryCategory],
    needs: taxonomy.needs,
    aliases: unique([
      name,
      brand.name,
      ...(brand.aliases || []),
      ...facetsFromMembersV69(group.members).flatMap((facet) => [facet.name, ...facet.aliases]),
    ]),
    description,
    detail: { summary: [description], sections: [] },
    ...pricingV69(member),
    availability: sourceAvailabilityV69(member.availability),
    availabilityCheckedAt: completedAt,
    images: { card: image, detail: image, original: image },
    syncedAt: completedAt,
    taxonomy: taxonomy.audit,
    source: {
      provider: "GPSFarma",
      url: member.sourceUrl,
      descriptionStatus: description === METADATA_ONLY_DESCRIPTION ? "gpsfarma-metadata-only" : "gpsfarma-complete",
      extractionStatus: "gpsfarma-expansion-v69",
      contentQuality: description === METADATA_ONLY_DESCRIPTION ? "metadata-only" : "source",
      retrievedAt: completedAt,
    },
    sku: sku || undefined,
    barcode: barcode || undefined,
    catalogFacets,
    catalogPositions: mergePositionsV69({}, group.members),
  };
}

function brandForGroupV69(group) {
  const member = preferredMembersV69(group.members)[0];
  const source = sourceByIdV7Beta(member.sourceId);
  const name = tidy(
    source && !source.membershipOnly && source.mode === "brand"
      ? source.catalogBrandName
      : member.listedBrand || member.sourceBrand || member.catalogBrandName || "Farmagreen",
  );
  const configured = GPS_SOURCES_V7_BETA.find(
    (candidate) =>
      !candidate.membershipOnly && normalizeProductText(candidate.catalogBrandName) === normalizeProductText(name),
  );
  const facet = configured?.facet || member.catalogFacet;
  const slug = facet?.slug || slugify(name);
  return {
    id: String(configured?.catalogBrandId || member.catalogBrandId || `gps-${hashShort(normalizeProductText(name))}`),
    slug,
    name: configured?.catalogBrandName || name,
    aliases: unique([name, ...(facet?.aliases || [])]),
  };
}

export function inferTaxonomyV69(nameValue, brandValue) {
  const text = normalizeProductText(`${nameValue} ${brandValue}`);
  const vitaminWay = /\bvitamin\s*way\b/.test(text);
  const capilatis = /\bcapilatis\b/.test(text);
  const explicitBody = /\b(corporal|cuerpo|manos|pies|piernas|bodytherapy|reductora)\b/.test(text);
  const facial = /\b(facial|rostro|face care|contorno de ojos|cc cream)\b/.test(text);
  const topical = /\b(crema|emulsion|locion|gel|serum|espuma)\b/.test(text);
  const presentation = [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|g|gr|gramos)\b/g)]
    .map((match) => Number(String(match[1]).replace(",", ".")))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] || 0;
  const nutrition = vitaminWay ||
    /\b(proteina|suplemento|creatina|aminoacido)\w*\b/.test(text) ||
    (/\b(vitamina|minerales|colageno)\w*\b/.test(text) &&
      /\b(capsula|comprimido|tableta|polvo|sobre|gomita|bebible)\w*\b/.test(text));
  const capillary =
    (capilatis && !explicitBody) ||
    /\b(shampoo|acondicionador|capilar|cabello|pelo|dercos|anticaida|anti caida|caspa|rulos|desenredante|fijador|enjuague|mascara|balsamo|protector de calor|aclarante)\b/.test(text);
  const solar = /\b(protector solar|fotoprotector|solar|after sun|post solar|broncead\w*|autobronce\w*)\b/.test(text);
  const cleansing = /\b(limpiador|limpieza|limpeza|micelar|desmaquill\w*|jabon|syndet|exfolia\w*|microexfolia\w*)\b/.test(text);
  const body =
    /\b(corporal|cuerpo|manos|pies|piernas)\b/.test(text) ||
    (topical && presentation >= 100 && !facial && !capillary && !solar && !cleansing && !nutrition);
  let primaryCategory = "rostro";
  if (nutrition) primaryCategory = "nutricion";
  else if (capillary) primaryCategory = "capilar";
  else if (solar) primaryCategory = "solares";
  else if (cleansing) primaryCategory = "limpieza";
  else if (/\b(bebe|infantil|pediatrico)\b/.test(text)) primaryCategory = "bebe";
  else if (body) primaryCategory = "cuerpo";
  else if (/\b(omron|tensiometro|nebulizador|termometro|balanza|electroestimulador)\b/.test(text)) primaryCategory = "otros";

  const needs = [];
  const rules = [
    ["limpieza", /\b(limpiador|limpieza|limpeza|micelar|desmaquill\w*|jabon|syndet|exfolia\w*|microexfolia\w*)\b/],
    ["solares", /\b(protector solar|fotoprotector|solar|after sun|post solar|broncead\w*|autobronce\w*)\b/],
    ["capilar", /\b(shampoo|acondicionador|capilar|cabello|pelo|dercos|anticaida|anti caida|caspa|rulos|desenredante|fijador|enjuague|mascara|balsamo|protector de calor|aclarante)\b/],
    ["acne", /\b(acne|antiacne|comedon|seborregulador|imperfecciones|granos)\b/],
    ["manchas", /\b(manchas|antimanchas|anti pigment|antipigment|despigment|melasma|pigmentacion)\b/],
    ["piel-sensible", /\b(piel sensible|atopi|rosacea|rojeces|hipoalergen\w*|bebe|infantil|irritacion)\b/],
    ["hidratacion", /\b(hidrat\w*|hydra\w*|hydro\w*|moistur\w*|humect\w*|emoliente|piel seca|xerosis|hialuron\w*)\b/],
    ["antiedad", /\b(antiedad|anti edad|antiage|anti aging|antiarrugas|arrugas|retinol|retinal|filler|firmeza|reafirmante|lifting|colageno)\b/],
    ["reparacion", /\b(repar\w*|repair\w*|restaur\w*|regener\w*|cicatriz\w*|estria\w*|rugos\w*|barrera|labial|labios agrietados)\b/],
  ];
  for (const [need, pattern] of rules) if (pattern.test(text) && !needs.includes(need)) needs.push(need);
  if (["nutricion", "solares", "capilar", "limpieza"].includes(primaryCategory)) {
    needs.splice(0, needs.length, primaryCategory);
  }
  if (!needs.length) needs.push(primaryCategory === "bebe" ? "piel-sensible" : "cuidado-diario");
  return {
    primaryCategory,
    needs: needs.slice(0, 2),
    audit: {
      reasonerVersion: "v69.2-expansion-source-position",
      evidenceScope: ["name", "brand"],
      selected: needs.slice(0, 2).map((need) => ({ need, source: "deterministic-title-rule" })),
      rejected: [],
    },
  };
}

function preferredMembersV69(members) {
  return [...members].sort(
    (left, right) =>
      Number(Boolean(left.sourceMembershipOnly)) - Number(Boolean(right.sourceMembershipOnly)) ||
      Number(!VALID_AVAILABILITY.has(left.availability)) - Number(!VALID_AVAILABILITY.has(right.availability)) ||
      Number(!validPricingV69(left)) - Number(!validPricingV69(right)) ||
      Number(left.position || Number.MAX_SAFE_INTEGER) - Number(right.position || Number.MAX_SAFE_INTEGER),
  );
}

function facetsFromMembersV69(members) {
  return mergeFacetsV69([], members.map(currentFacetForMemberV7Beta).filter(Boolean));
}

function existingFacetsV69(product) {
  const configuredBrandFacet = configuredBrandFacetV7Beta(product.brand);
  const existing = (Array.isArray(product.catalogFacets) ? product.catalogFacets : [])
    .filter((facet) => CONFIGURED_CATALOG_FACETS_V7_BETA.has(facet?.slug));
  return mergeFacetsV69(configuredBrandFacet ? [configuredBrandFacet] : [], existing);
}

function currentFacetForMemberV7Beta(member) {
  return sourceByIdV7Beta(member?.sourceId)?.facet || member?.catalogFacet;
}

function configuredBrandFacetV7Beta(brand) {
  const slug = brand?.slug || slugify(brand?.name);
  const source = GPS_SOURCES_V7_BETA.find(
    (candidate) => !candidate.membershipOnly && candidate.facet.slug === slug,
  );
  return source?.facet;
}

function mergeFacetsV69(left, right) {
  const facets = new Map();
  for (const facet of [...(left || []), ...(right || [])]) {
    if (!facet?.slug || !facet?.name) continue;
    const current = facets.get(facet.slug);
    facets.set(facet.slug, {
      slug: facet.slug,
      name: facet.name,
      aliases: unique([...(current?.aliases || []), ...(facet.aliases || [])]),
      kind: facet.kind === "collection" ? "collection" : "brand",
    });
  }
  return [...facets.values()];
}

function mergePositionsV69(current, members) {
  const positions = { ...(current || {}) };
  for (const member of members) {
    const slug = currentFacetForMemberV7Beta(member)?.slug;
    const position = Number(member.position);
    if (!slug || !Number.isInteger(position) || position < 1) continue;
    positions[slug] = positions[slug] ? Math.min(positions[slug], position) : position;
  }
  return positions;
}

function assertCuratedCatalogFacetsV7Beta(products) {
  const missing = [];
  const unexpected = new Set();
  for (const product of products) {
    const facets = Array.isArray(product.catalogFacets) ? product.catalogFacets : [];
    if (!facets.length) missing.push(product.publicId);
    for (const facet of facets) {
      const configured = CONFIGURED_CATALOG_FACETS_V7_BETA.get(facet?.slug);
      if (!configured || configured.name !== facet.name || configured.kind !== facet.kind) {
        unexpected.add(`${facet?.slug || "sin-slug"}:${facet?.name || "sin-nombre"}`);
      }
    }
  }
  if (missing.length || unexpected.size) {
    throw new Error(
      `Facetas V7 Beta fuera del catálogo curado: sin faceta=${missing.slice(0, 12).join(",") || "ninguno"}; ` +
      `inesperadas=${[...unexpected].slice(0, 12).join(",") || "ninguna"}.`,
    );
  }
}

function buildBaseIndexV69(products) {
  const index = { products, sku: new Map(), barcode: new Map(), url: new Map() };
  products.forEach((product, productIndex) => addProductToBaseIndexV69(index, product, productIndex));
  return index;
}

function addProductToBaseIndexV69(index, product, productIndex) {
  addUniqueIndex(index.sku, normalizeSku(product.sku), productIndex, "SKU");
  addMultiIndex(index.barcode, normalizeBarcode(product.barcode), productIndex);
  addUniqueIndex(index.url, normalizeGpsProductUrl(product.source?.url), productIndex, "URL");
}

function matchBaseIndexV69(group, index) {
  const skuMatches = new Set();
  for (const sku of identityValuesV69(group, "sku")) if (index.sku.has(sku)) skuMatches.add(index.sku.get(sku));
  if (skuMatches.size > 1) throw new Error("Una fuente expandida coincide con varios SKU base.");
  if (skuMatches.size === 1) return [...skuMatches][0];

  const urlMatches = new Set();
  for (const member of group.members || []) {
    const url = normalizeGpsProductUrl(member.sourceUrl);
    if (url && index.url.has(url)) urlMatches.add(index.url.get(url));
  }
  if (urlMatches.size > 1) throw new Error("Una fuente expandida coincide con varias URL base.");
  if (urlMatches.size === 1) return [...urlMatches][0];

  const barcodeMatches = new Set();
  for (const barcode of identityValuesV69(group, "barcode")) {
    const indexes = index.barcode.get(barcode);
    if (indexes?.size === 1) barcodeMatches.add([...indexes][0]);
  }
  if (barcodeMatches.size > 1) throw new Error("Una fuente expandida coincide con varios barcode base inequívocos.");
  return barcodeMatches.size ? [...barcodeMatches][0] : null;
}

function identityValuesV69(group, key) {
  const values = new Set();
  if (key === "sku") {
    for (const member of group.members || []) {
      const value = normalizeSku(member.sku);
      if (value) values.add(value);
    }
    const detail = normalizeSku(group.detail?.sku);
    if (detail) values.add(detail);
  } else if (key === "barcode") {
    for (const member of group.members || []) {
      const value = normalizeBarcode(member.barcode);
      if (value) values.add(value);
    }
    const detail = normalizeBarcode(group.detail?.barcode);
    if (detail) values.add(detail);
  } else if (key === "title") {
    const member = preferredMembersV69(group.members || [])[0];
    if (member) {
      const brand = brandForGroupV69(group);
      const value = normalizeProductText(`${brand.name} ${member.sourceName}`);
      if (value) values.add(value);
    }
  } else if (key === "baseIndex") {
    if (group.baseIndex !== undefined && group.baseIndex !== null) {
      values.add(String(group.baseIndex));
    }
  }
  return values;
}

function identitiesAcrossGroupsV7Beta(groups, indexes, key) {
  return new Set(
    indexes.flatMap((index) => [...identityValuesV69(groups[index], key)]).filter(Boolean),
  );
}

function assertNoConflictingIdentitiesV7Beta(groups, stage) {
  for (const group of groups) {
    const skus = identityValuesV69(group, "sku");
    if (skus.size > 1) {
      throw new Error(`Conflicto de identidad en ${stage}: una ficha reúne ${skus.size} SKU.`);
    }
    const barcodes = identityValuesV69(group, "barcode");
    if (barcodes.size > 1) {
      throw new Error(`Conflicto de identidad en ${stage}: una ficha reúne ${barcodes.size} códigos de barra.`);
    }
  }
}

function assertUniqueCatalogV69(products) {
  for (const [label, values] of [
    ["publicId", products.map((product) => product.publicId)],
    ["SKU", products.map((product) => normalizeSku(product.sku)).filter(Boolean)],
  ]) {
    if (new Set(values).size !== values.length) throw new Error(`El catálogo expandido contiene ${label} duplicado.`);
  }
}

function assertCommerceReadyV69(products) {
  const unknown = products.filter((product) => !["limited", "out_of_stock"].includes(product.availability));
  const unpriced = products.filter((product) => Number(product.offerPrice || product.listPrice) <= 0);
  if (unknown.length) throw new Error(`Quedaron ${unknown.length} productos sin disponibilidad STOM verificada.`);
  if (unpriced.length) throw new Error(`Quedaron ${unpriced.length} productos sin precio válido.`);
}

function assertCurrentCycleCoverageV7Beta(products, completedAt) {
  const stale = products.filter((product) => product.availabilityCheckedAt !== completedAt);
  if (stale.length) {
    const sample = stale
      .slice(0, 12)
      .map((product) => `${product.publicId}:${normalizeSku(product.sku) || "sin-sku"}:${product.brand?.name || "sin-marca"}`)
      .join(", ");
    throw new Error(
      `Cobertura STOM actual incompleta: ${stale.length} producto(s) visible(s) no fueron verificados en el ciclo ${completedAt}. Muestra: ${sample}.`,
    );
  }
}

function mergeDetailV69(left, right) {
  const leftSku = normalizeSku(left.sku);
  const rightSku = normalizeSku(right.sku);
  if (leftSku && rightSku && leftSku !== rightSku) {
    throw new Error("Una ficha GPSFarma devolvió dos SKU incompatibles.");
  }
  const leftBarcode = normalizeBarcode(left.barcode);
  const rightBarcode = normalizeBarcode(right.barcode);
  if (leftBarcode && rightBarcode && leftBarcode !== rightBarcode) {
    throw new Error("Una ficha GPSFarma devolvió dos códigos de barra incompatibles.");
  }
  return {
    sku: left.sku || right.sku || "",
    barcode: left.barcode || right.barcode || "",
    description: left.description || right.description || "",
    overview: left.overview || right.overview || "",
    image: left.image || right.image || "",
  };
}

function brandFacetV7Beta(brand) {
  return {
    slug: brand?.slug || slugify(brand?.name),
    name: brand?.name || "Farmagreen",
    aliases: unique(brand?.aliases || []),
    kind: "brand",
  };
}

function createExclusionMatcherV7Beta(exclusions = {}) {
  const identities = Array.isArray(exclusions.products) ? exclusions.products : [];
  return {
    hidden: new Set(Object.keys(exclusions.hidden && typeof exclusions.hidden === "object" ? exclusions.hidden : {})),
    skus: new Set(
      [...(Array.isArray(exclusions.skus) ? exclusions.skus : []), ...identities.map((item) => item?.sku)]
        .map(normalizeSku)
        .filter(Boolean),
    ),
    barcodes: new Set(
      [...(Array.isArray(exclusions.barcodes) ? exclusions.barcodes : []), ...identities.map((item) => item?.barcode)]
        .map(normalizeBarcode)
        .filter(Boolean),
    ),
    urls: new Set(
      [...(Array.isArray(exclusions.urls) ? exclusions.urls : []), ...identities.map((item) => item?.url)]
        .map(normalizeExclusionUrlV7Beta)
        .filter(Boolean),
    ),
  };
}

function groupMatchesExclusionV7Beta(group, matcher) {
  if ([...identityValuesV69(group, "sku")].some((value) => matcher.skus.has(value))) return true;
  if ([...identityValuesV69(group, "barcode")].some((value) => matcher.barcodes.has(value))) return true;
  return (group.members || []).some((member) => matcher.urls.has(normalizeExclusionUrlV7Beta(member.sourceUrl)));
}

function productMatchesExclusionV7Beta(product, matcher) {
  if (matcher.hidden.has(String(product.publicId || ""))) return true;
  if (product.sku && matcher.skus.has(normalizeSku(product.sku))) return true;
  if (product.barcode && matcher.barcodes.has(normalizeBarcode(product.barcode))) return true;
  return Boolean(
    product.source?.url && matcher.urls.has(normalizeExclusionUrlV7Beta(product.source.url)),
  );
}

function normalizeExclusionUrlV7Beta(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    const pathname = parsed.pathname.replace(/^\/categorias\//i, "/").replace(/\/+$/, "") || "/";
    return `${parsed.hostname.toLowerCase()}${pathname.toLowerCase()}`;
  } catch {
    return "";
  }
}

function priceAmountFromProductPageV7Beta(html, priceType) {
  for (const match of String(html || "").matchAll(/<[^>]+data-price-(?:amount|type)=["'][^"']+["'][^>]*>/gi)) {
    const tag = match[0];
    if (htmlAttributeV7Beta(tag, "data-price-type") !== priceType) continue;
    const amount = Number(htmlAttributeV7Beta(tag, "data-price-amount"));
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

function htmlAttributeV7Beta(tag, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(tag || "").match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, "i"))?.[1] || "";
}

function pricingV69(member) {
  return {
    listPrice: Number(member.listPrice),
    offerPrice: Number(member.offerPrice),
    savingAmount: Number(member.savingAmount || 0),
    discountPercent: Number(member.discountPercent || 0),
  };
}

function validPricingV69(member) {
  return Number(member?.listPrice) > 0 && Number(member?.offerPrice) > 0;
}

function sourceAvailabilityV69(value) {
  if (value === "available") return "limited";
  if (value === "unavailable") return "out_of_stock";
  throw new Error("La fuente nueva contiene disponibilidad STOM desconocida.");
}

function trustedGpsImageV69(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && (url.hostname === "gpsfarma.com" || url.hostname.endsWith(".gpsfarma.com"))
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function addBucket(map, key, index) {
  if (!key) return;
  const indexes = map.get(key) || [];
  indexes.push(index);
  map.set(key, indexes);
}

function addUniqueIndex(map, key, index, label) {
  if (!key) return;
  if (map.has(key) && map.get(key) !== index) throw new Error(`El catálogo base contiene ${label} duplicado.`);
  map.set(key, index);
}

function addMultiIndex(map, key, index) {
  if (!key) return;
  const indexes = map.get(key) || new Set();
  indexes.add(index);
  map.set(key, indexes);
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeBarcode(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeRawIdentity(value) {
  return String(value || "").trim();
}

function tidy(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugify(value) {
  return normalizeProductText(value).replace(/\s+/g, "-").replace(/^-|-$/g, "") || "producto";
}

function hashShort(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 8);
}

function unique(values) {
  return [...new Set(values.map((value) => tidy(value)).filter(Boolean))];
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function defaultDetailProgress({ processed, total, status }) {
  if (processed % 50 === 0 || processed === total) {
    process.stderr.write(`[detalle] ${processed}/${total} ${status}\n`);
  }
}

function defaultSourceProgress(result) {
  process.stderr.write(`[fuente] ${result.catalogBrandName}: ${result.products.length}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
  const outputPath = outputArgument ? path.resolve(outputArgument.slice("--output=".length)) : DEFAULT_LOCAL_V7_BETA_OUTPUT;
  const result = await runLocalV7Beta({
    outputPath,
    resumeIntermediate: process.argv.includes("--resume"),
    onSourceProgress: defaultSourceProgress,
    onDetailProgress: defaultDetailProgress,
  });
  process.stdout.write(`${JSON.stringify({
    outputPath: result.outputPath,
    rawListings: result.rawListings,
    grouped: result.grouped,
    totalProducts: result.catalog.totalProducts,
    v7Beta: result.catalog.v7Beta,
  }, null, 2)}\n`);
}
