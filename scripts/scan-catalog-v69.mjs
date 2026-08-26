import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import {
  GPS_SOURCES_V69,
  crawlAllSources,
  createLocationScopedFetchV69,
  inventoryScopeV69,
  normalizeGpsImagePath,
  normalizeGpsProductUrl,
  synchronizeCatalog,
  trustedGpsUrl,
  writeJsonAtomically,
} from "./sync-catalog-commerce-v69.mjs";
import {
  brandForGroupV69,
  canonicalizeBrandV69,
  consolidateDetailedGroupsV69,
  enrichListingGroupsV69,
  groupSourceListingsV69,
  inferTaxonomyV69,
  isCollectionBrandPlaceholderV69,
  newProductFromSourceGroupV69,
  parseProductPageCommerceV7Beta,
} from "./build-local-v7-beta.mjs";
import {
  filterExcludedProductsV69,
  prepareGcpCatalogV69,
  recalculateSnapshotV69,
} from "./prepare-gcp-catalog-v69.mjs";
import { extractMagentoTaxonomyV69 } from "./extract-magento-taxonomy-v69.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CATALOG = path.join(ROOT, "data", "catalog-v69.json");
const DEFAULT_EXCLUSIONS = path.join(ROOT, "data", "catalog-exclusions-v69.local.json");
const PERMANENT_MISSING = /^(?:404|410)\b/;
const GCS_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

const SOURCE_FACETS_V69 = Object.freeze({
  "5930": facet("eucerin", "Eucerin", ["eucerin"]),
  "5704": facet("bagovit", "Bagóvit", ["bagovit", "bagóvit"]),
  "6827": facet("cerave", "CeraVe", ["cerave", "cera ve"]),
  "6116": facet("neutrogena", "Neutrogena", ["neutrogena"]),
  "6312": facet("vitamin-way", "Vitamin Way", ["vitamin way", "vitaminway"]),
  "5745": facet("capilatis", "Capilatis", ["capilatis"]),
  "5808": facet("dermaglos", "Dermaglos", ["dermaglos", "dermaglo"]),
  "5751": facet("caviahue", "Caviahue", ["caviahue"]),
  "6048": facet("la-roche-posay", "La Roche Posay", ["la roche posay", "laroche", "lrp"]),
  "6301": facet("vichy", "Vichy", ["vichy"]),
  "6023": facet("isdin", "ISDIN", ["isdin"]),
  "5756": facet("cetaphil", "Cetaphil", ["cetaphil", "cetafil"]),
  "5697": facet("aveno", "Aveno", ["aveno", "aveeno"]),
  "5911": facet("ena", "ENA", ["ena", "ena suplementos", "ena sport"]),
  "9100": facet(
    "productos-saludables",
    "Productos Saludables",
    ["productos saludables", "saludables"],
    "collection",
  ),
  revitalift: facet(
    "loreal-revitalift",
    "L'Oréal Revitalift",
    ["loreal revitalift", "l'oréal revitalift", "revitalift"],
  ),
});

export function discoverySourcesV69(sources = GPS_SOURCES_V69) {
  return sources.map((source) => {
    const id = String(source.id);
    const configured = SOURCE_FACETS_V69[id];
    if (!configured) throw new Error("La fuente V6.9 " + id + " no tiene vista configurada.");
    return {
      ...source,
      facet: configured,
      membershipOnly: id === "9100",
    };
  });
}

export function decorateDiscoveryResultsV69(sourceResults, sources = discoverySourcesV69()) {
  const sourceById = new Map(sources.map((source) => [String(source.id), source]));
  return sourceResults.map((result) => {
    const source = sourceById.get(String(result.id));
    if (!source) throw new Error("Resultado de una fuente V6.9 inesperada: " + result.id + ".");
    return {
      ...result,
      facet: source.facet,
      membershipOnly: Boolean(source.membershipOnly),
      products: (result.products || []).map((product, index) => ({
        ...product,
        catalogFacet: source.facet,
        sourceMembershipOnly: Boolean(source.membershipOnly),
        position: index + 1,
      })),
    };
  });
}

export async function runCatalogDiscoveryV69({
  rootDir = ROOT,
  providedBaseCatalog,
  providedExclusions,
  providedSourceResults,
  fetchHtml,
  inventoryScope = inventoryScopeV69(),
  now = () => new Date(),
  onProgress = () => {},
} = {}) {
  const completedAt = now().toISOString();
  const baseCatalog =
    providedBaseCatalog ||
    JSON.parse(await fs.readFile(path.join(rootDir, "data", "catalog-v69.json"), "utf8"));
  const exclusions =
    providedExclusions ||
    JSON.parse(
      await fs.readFile(
        path.join(rootDir, "data", "catalog-exclusions-v69.local.json"),
        "utf8",
      ),
    );
  const sources = discoverySourcesV69();
  const scopedFetch =
    fetchHtml ||
    (await createLocationScopedFetchV69({
      inventoryScope,
    }));
  const sourceResults =
    providedSourceResults ||
    (await crawlAllSources(sources, {
      fetchHtml: scopedFetch,
      onProgress,
    }));
  const commercial = synchronizeCatalog(baseCatalog, sourceResults, {
    completedAt,
    expectedSourceIds: sources.map((source) => String(source.id)),
    inventoryScope,
  });
  const decorated = decorateDiscoveryResultsV69(sourceResults, sources);
  const grouped = groupSourceListingsV69(decorated);
  const enriched = await enrichListingGroupsV69(grouped, {
    fetchHtml: scopedFetch,
    baseCatalog: commercial,
    onProgress,
  });
  const detailedGroups = consolidateDetailedGroupsV69(enriched);
  return reconcileCatalogChangesV69({
    baseCatalog: commercial,
    detailedGroups,
    exclusions,
    completedAt,
    fetchHtml: scopedFetch,
    sources,
  });
}

export async function finalizeCatalogDiscoveryV69({
  catalog,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  prepareImages = prepareNewProductImagesV69,
  rebuildTaxonomy = rebuildMagentoTaxonomyV69,
} = {}) {
  if (!catalog?.discoverySync || catalog.discoverySync.status !== "completed") {
    throw new Error("El candidato V6.9 no contiene un scan semanal completo.");
  }
  const pendingMetrics = catalog.discoverySync.metrics || {};
  if (Number(pendingMetrics.positivePending || 0) || Number(pendingMetrics.negativePending || 0)) {
    throw new Error("El candidato V6.9 conserva cambios positivos o negativos pendientes.");
  }
  const addedPublicIds = new Set(catalog.discoverySync.addedPublicIds || []);
  let prepared = catalog;
  if (addedPublicIds.size) {
    prepared = await prepareImages({
      catalog: prepared,
      addedPublicIds,
      environment,
      fetchImpl,
    });
  }
  prepared = await rebuildTaxonomy({
    catalog: prepared,
    fetchImpl,
  });
  prepared = reindexCatalogV69(prepared, catalog.discoverySync.completedAt);
  assertRuntimeAssetsV69(prepared.products);
  const discoverySync = {
    ...catalog.discoverySync,
    activationReady: true,
    searchIndexedAt: catalog.discoverySync.completedAt,
    needsIndexedAt: catalog.discoverySync.completedAt,
    taxonomyIndexedAt: catalog.discoverySync.completedAt,
    imagesPreparedAt: catalog.discoverySync.completedAt,
  };
  return {
    catalog: recalculateSnapshotV69({
      ...prepared,
      discoverySync,
      totalProducts: prepared.products.length,
    }),
    discoverySync,
  };
}

export async function prepareNewProductImagesV69({
  catalog,
  addedPublicIds,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  uploadAssets = uploadPreparedAssetsV69,
} = {}) {
  const bucket = String(environment.V69_IMAGE_GCS_BUCKET || "").trim();
  const prefix = String(environment.V69_IMAGE_GCS_PREFIX || "v69/catalog-images").trim();
  if (!bucket) throw new Error("El scan semanal requiere V69_IMAGE_GCS_BUCKET.");
  const targets = catalog.products.filter((product) => addedPublicIds.has(product.publicId));
  if (!targets.length) return catalog;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "farmagreen-v69-weekly-images-"));
  const inputPath = path.join(directory, "new-products.json");
  const exclusionsPath = path.join(directory, "empty-exclusions.json");
  const outputPath = path.join(directory, "prepared-products.json");
  const storeDirectory = path.join(directory, "store");
  try {
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        ...catalog,
        totalProducts: targets.length,
        products: targets,
      }),
    );
    await fs.writeFile(
      exclusionsPath,
      JSON.stringify({ products: [], skus: [], barcodes: [], urls: [], hidden: {} }),
    );
    const result = await prepareGcpCatalogV69({
      inputPath,
      exclusionsPath,
      outputPath,
      storeDirectory,
      bucket,
      prefix,
      concurrency: 8,
      fetchImpl,
    });
    await uploadAssets({
      storeDirectory,
      bucket,
      prefix,
      environment,
      fetchImpl,
    });
    const imagesByPublicId = new Map(
      result.catalog.products.map((product) => [product.publicId, product.images]),
    );
    return {
      ...catalog,
      products: catalog.products.map((product) =>
        imagesByPublicId.has(product.publicId)
          ? { ...product, images: imagesByPublicId.get(product.publicId) }
          : product,
      ),
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function rebuildMagentoTaxonomyV69({
  catalog,
  fetchImpl = globalThis.fetch,
} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "farmagreen-v69-weekly-taxonomy-"));
  const inputPath = path.join(directory, "catalog.json");
  const exclusionsPath = path.join(directory, "empty-exclusions.json");
  const outputPath = path.join(directory, "taxonomy.json");
  try {
    await fs.writeFile(inputPath, JSON.stringify(catalog));
    await fs.writeFile(
      exclusionsPath,
      JSON.stringify({ products: [], skus: [], barcodes: [], urls: [], hidden: {} }),
    );
    const { artifact } = await extractMagentoTaxonomyV69({
      inputPath,
      exclusionsPath,
      outputPath,
      fetchImpl,
      batchSize: 25,
      now: () => new Date(catalog.discoverySync?.completedAt || Date.now()),
    });
    return attachMagentoTaxonomyV69(catalog, artifact);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export function attachMagentoTaxonomyV69(catalog, artifact) {
  const categoryById = new Map(
    (artifact.categories || []).map((category) => [Number(category.id), category]),
  );
  const membershipByPublicId = new Map(
    (artifact.products || []).map((product) => [String(product.publicId), product]),
  );
  const products = catalog.products.map((product) => {
    const membership = membershipByPublicId.get(String(product.publicId));
    if (!membership) {
      throw new Error("Magento no indexó la ficha semanal " + product.publicId + ".");
    }
    const categories = (membership.categoryIds || []).map((categoryId) => {
      const category = categoryById.get(Number(categoryId));
      if (!category) throw new Error("Falta la categoría Magento " + categoryId + ".");
      return { id: String(category.id), name: String(category.name) };
    });
    return {
      ...product,
      magentoCategories: categories,
      magentoTaxonomyAttached: true,
    };
  });
  const magentoCategoryPaths = Object.fromEntries(
    [...categoryById.values()].map((category) => {
      const names = [
        ...((category.breadcrumbs || []).map((crumb) => crumb.categoryName)),
        category.name,
      ].map((name) => String(name || "").trim()).filter(Boolean);
      return [String(category.id), unique(names.filter((name) => normalizeText(name) !== "categorias"))];
    }),
  );
  return {
    ...catalog,
    magentoCategoryPaths,
    products,
  };
}

export function assertRuntimeAssetsV69(products) {
  for (const product of products) {
    if (product.magentoTaxonomyAttached !== true) {
      throw new Error("Falta taxonomía runtime para " + product.publicId + ".");
    }
    for (const kind of ["card", "detail"]) {
      const image = new URL(String(product.images?.[kind] || ""));
      if (image.protocol !== "https:" || image.hostname !== "storage.googleapis.com") {
        throw new Error("Falta imagen GCS para " + product.publicId + ".");
      }
      const responsive = product.images?.responsive?.[kind];
      if (!responsive?.width || !responsive?.height || !Object.keys(responsive.webp || {}).length || !Object.keys(responsive.avif || {}).length) {
        throw new Error("Faltan imágenes responsivas para " + product.publicId + ".");
      }
    }
  }
}

export async function uploadPreparedAssetsV69({
  storeDirectory,
  bucket,
  prefix,
  fetchImpl = globalThis.fetch,
} = {}) {
  const files = await fs.readdir(storeDirectory);
  if (!files.length) return { uploaded: 0, reused: 0 };
  const auth = new GoogleAuth({ scopes: [GCS_SCOPE] });
  let uploaded = 0;
  let reused = 0;
  await mapLimit(files, 8, async (fileName) => {
    const body = await fs.readFile(path.join(storeDirectory, fileName));
    const objectName = prefix.replace(/^\/+|\/+$/g, "") + "/" + fileName;
    const token = await auth.getAccessToken();
    if (!token) throw new Error("GCS no entregó credenciales para imágenes V6.9.");
    const url =
      "https://storage.googleapis.com/upload/storage/v1/b/" +
      encodeURIComponent(bucket) +
      "/o?uploadType=media&ifGenerationMatch=0&name=" +
      encodeURIComponent(objectName);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": contentTypeForAsset(fileName),
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 412) {
      reused += 1;
      return;
    }
    if (!response.ok) throw new Error("GCS image upload HTTP " + response.status + ".");
    uploaded += 1;
  });
  return { uploaded, reused };
}

export async function reconcileCatalogChangesV69({
  baseCatalog,
  detailedGroups,
  exclusions = emptyExclusions(),
  completedAt = new Date().toISOString(),
  fetchHtml,
  sources = discoverySourcesV69(),
} = {}) {
  if (!baseCatalog || !Array.isArray(baseCatalog.products)) {
    throw new Error("El scan V6.9 requiere un catálogo base.");
  }
  if (!Array.isArray(detailedGroups)) {
    throw new Error("El scan V6.9 requiere grupos canónicos.");
  }
  const products = baseCatalog.products.map((product) => ({
    ...product,
    catalogFacets: [...(product.catalogFacets || [])],
    sourceMemberships: [...(product.sourceMemberships || [])],
  }));
  const sourceById = new Map(sources.map((source) => [String(source.id), source]));
  const matchedBaseIndexes = new Set();
  const addedPublicIds = [];
  let positivePending = 0;

  for (const group of detailedGroups) {
    const memberships = membershipsForGroup(group, sourceById);
    const matchedIndex =
      Number.isInteger(group.baseIndex) && group.baseIndex >= 0 ? group.baseIndex : null;
    if (matchedIndex !== null && products[matchedIndex]) {
      matchedBaseIndexes.add(matchedIndex);
      products[matchedIndex] = normalizeMatchedBrandV69(
        mergeMemberships(products[matchedIndex], memberships),
        group,
      );
      continue;
    }
    let candidate;
    try {
      candidate = newProductFromSourceGroupV69(group, completedAt);
    } catch {
      positivePending += 1;
      continue;
    }
    if (
      !normalizeSku(candidate.sku) ||
      !candidate.images?.card ||
      !candidate.images?.detail ||
      !["limited", "out_of_stock"].includes(candidate.availability) ||
      !(Number(candidate.offerPrice || candidate.listPrice) > 0)
    ) {
      positivePending += 1;
      continue;
    }
    const withMemberships = mergeMemberships(candidate, memberships);
    products.push(withMemberships);
    addedPublicIds.push(withMemberships.publicId);
  }

  const removed = [];
  const negativePending = [];
  for (let index = 0; index < baseCatalog.products.length; index += 1) {
    if (matchedBaseIndexes.has(index)) continue;
    const product = products[index];
    if (matchesExclusion(product, exclusions)) continue;
    if (typeof fetchHtml !== "function") {
      negativePending.push(product.publicId);
      continue;
    }
    try {
      const commerce = parseProductPageCommerceV7Beta(
        await fetchHtml(trustedGpsUrl(product?.source?.url)),
        product,
      );
      products[index] = {
        ...product,
        listPrice: commerce.listPrice,
        offerPrice: commerce.offerPrice,
        savingAmount: commerce.savingAmount,
        discountPercent: commerce.discountPercent,
        availability: commerce.availability === "available" ? "limited" : "out_of_stock",
        availabilityCheckedAt: completedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (PERMANENT_MISSING.test(message)) {
        removed.push(product.publicId);
      } else {
        throw new Error(
          "No se pudo confirmar una baja V6.9 para " + product.publicId + ".",
          { cause: error },
        );
      }
    }
  }

  const withoutPermanentMissing = {
    ...baseCatalog,
    products: products.filter((product) => !removed.includes(product.publicId)),
  };
  const filtered = filterExcludedProductsV69(withoutPermanentMissing, exclusions);
  const visiblePublicIds = new Set(filtered.products.map((product) => product.publicId));
  const visibleAddedPublicIds = addedPublicIds.filter((publicId) => visiblePublicIds.has(publicId));
  const reindexed = reindexCatalogV69(filtered, completedAt);
  assertUniqueCanonicalProductsV69(reindexed.products);
  const result = recalculateSnapshotV69({
    ...reindexed,
    version: 6.9,
    totalProducts: reindexed.products.length,
    syncedAt: completedAt,
    discoverySync: {
      completedAt,
      status: "completed",
      sources: sources.map((source) => ({
        id: String(source.id),
        status: "completed",
      })),
      metrics: {
        sourceOccurrences: detailedGroups.reduce(
          (sum, group) => sum + (group.members || []).length,
          0,
        ),
        canonicalGroups: detailedGroups.length,
        positive: visibleAddedPublicIds.length,
        positiveExcluded: addedPublicIds.length - visibleAddedPublicIds.length,
        positivePending,
        negative: removed.length,
        negativePending: negativePending.length,
        products: reindexed.products.length,
      },
      addedPublicIds: visibleAddedPublicIds,
      removedPublicIds: removed,
      negativePendingPublicIds: negativePending,
      searchIndexedAt: completedAt,
      needsIndexedAt: completedAt,
      activationReady:
        visibleAddedPublicIds.length === 0 &&
        positivePending === 0 &&
        negativePending.length === 0,
    },
  });
  return {
    catalog: result,
    discoverySync: result.discoverySync,
  };
}

export function reindexCatalogV69(catalog, indexedAt = new Date().toISOString()) {
  return {
    ...catalog,
    searchIndexedAt: indexedAt,
    needsIndexedAt: indexedAt,
    products: catalog.products.map((product) => {
      const categoryNames = (product.magentoCategories || []).map((category) => category.name);
      const viewTerms = (product.catalogFacets || []).flatMap((entry) => [
        entry.name,
        ...(entry.aliases || []),
      ]);
      const evidence = unique([
        product.name,
        product.line,
        ...(product.aliases || []),
        ...categoryNames,
        ...viewTerms,
      ]);
      const inferred = inferTaxonomyV69(evidence.join(" "), product.brand?.name || "");
      return {
        ...product,
        primaryCategory: inferred.primaryCategory,
        categorySlugs: [inferred.primaryCategory],
        needs: inferred.needs,
        aliases: unique([
          ...(product.aliases || []),
          product.name,
          product.brand?.name,
          ...(product.brand?.aliases || []),
          ...categoryNames,
          ...viewTerms,
          ...inferred.needs,
        ]),
        taxonomy: {
          ...(product.taxonomy && typeof product.taxonomy === "object"
            ? product.taxonomy
            : {}),
          ...inferred.audit,
          indexedAt,
          evidenceScope: ["name", "brand", "aliases", "magentoCategories"],
        },
      };
    }),
  };
}

export function assertUniqueCanonicalProductsV69(products) {
  for (const [label, identity] of [
    ["publicId", (product) => String(product.publicId || "")],
    ["SKU", (product) => normalizeSku(product.sku)],
  ]) {
    const seen = new Set();
    for (const product of products) {
      const value = identity(product);
      if (!value) throw new Error("El catálogo V6.9 contiene " + label + " vacío.");
      if (seen.has(value)) throw new Error("El catálogo V6.9 duplicó " + label + ": " + value + ".");
      seen.add(value);
    }
  }
  const collectionBrands = products.filter((product) =>
    isCollectionBrandPlaceholderV69(product.brand?.name),
  );
  if (collectionBrands.length) {
    throw new Error(
      "El catálogo V6.9 conserva " + collectionBrands.length +
      " ficha(s) con Productos Saludables usado como marca.",
    );
  }
}

function normalizeMatchedBrandV69(product, group) {
  const previousBrand = product.brand;
  const brand = isCollectionBrandPlaceholderV69(previousBrand?.name)
    ? brandForGroupV69(group)
    : canonicalizeBrandV69(previousBrand);
  if (isCollectionBrandPlaceholderV69(brand.name)) {
    throw new Error("No se pudo resolver la marca real de una ficha de Productos Saludables.");
  }
  if (
    brand.name === previousBrand?.name &&
    brand.id === previousBrand?.id &&
    brand.slug === previousBrand?.slug
  ) {
    return product;
  }
  const aliases = unique([
    ...(product.aliases || []).filter(
      (alias) => !isCollectionBrandPlaceholderV69(alias),
    ),
    brand.name,
    ...(brand.aliases || []),
  ]);
  return {
    ...product,
    slug: slugifyProductV69(brand.name + " " + product.name) + "--" + product.publicId,
    brand,
    line:
      isCollectionBrandPlaceholderV69(product.line) ||
      normalizeText(product.line) === normalizeText(previousBrand?.name)
        ? brand.name
        : product.line,
    aliases,
  };
}

function membershipsForGroup(group, sourceById) {
  const memberships = new Map();
  for (const member of group.members || []) {
    const source = sourceById.get(String(member.sourceId));
    if (!source) continue;
    const current = memberships.get(String(source.id));
    const position = positivePosition(member.position);
    memberships.set(String(source.id), {
      sourceId: String(source.id),
      viewSlug: source.facet.slug,
      viewName: source.facet.name,
      viewKind: source.facet.kind,
      membershipOnly: Boolean(source.membershipOnly),
      position:
        current?.position && position
          ? Math.min(current.position, position)
          : current?.position || position,
    });
  }
  return [...memberships.values()];
}

function mergeMemberships(product, additions) {
  const memberships = new Map(
    (product.sourceMemberships || []).map((membership) => [
      String(membership.sourceId),
      membership,
    ]),
  );
  for (const membership of additions) memberships.set(membership.sourceId, membership);
  const facets = new Map(
    (product.catalogFacets || []).map((entry) => [String(entry.slug), entry]),
  );
  for (const membership of memberships.values()) {
    facets.set(membership.viewSlug, {
      slug: membership.viewSlug,
      name: membership.viewName,
      aliases: [],
      kind: membership.viewKind,
    });
  }
  return {
    ...product,
    sourceMemberships: [...memberships.values()],
    catalogFacets: [...facets.values()],
  };
}

function matchesExclusion(product, exclusions) {
  const skus = new Set([
    ...(exclusions.skus || []),
    ...(exclusions.products || []).map((entry) => entry.sku),
  ].map(normalizeSku).filter(Boolean));
  const barcodes = new Set([
    ...(exclusions.barcodes || []),
    ...(exclusions.products || []).map((entry) => entry.barcode),
  ].map(normalizeBarcode).filter(Boolean));
  const urls = new Set([
    ...(exclusions.urls || []),
    ...(exclusions.products || []).map((entry) => entry.url),
  ].map(normalizeGpsProductUrl).filter(Boolean));
  return (
    Boolean(exclusions.hidden?.[product.publicId]) ||
    skus.has(normalizeSku(product.sku)) ||
    barcodes.has(normalizeBarcode(product.barcode)) ||
    urls.has(normalizeGpsProductUrl(product?.source?.url))
  );
}

function facet(slug, name, aliases, kind = "brand") {
  return Object.freeze({
    slug,
    name,
    aliases: Object.freeze([...new Set(aliases)]),
    kind,
  });
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function slugifyProductV69(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "producto";
}

function normalizeSku(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeBarcode(value) {
  return String(value || "").replace(/\D/g, "");
}

function positivePosition(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function emptyExclusions() {
  return { products: [], skus: [], barcodes: [], urls: [], hidden: {} };
}

function contentTypeForAsset(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".avif") return "image/avif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".png") return "image/png";
  if (extension === ".gif") return "image/gif";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  throw new Error("Extensión de imagen V6.9 no admitida: " + extension + ".");
}

async function mapLimit(items, limit, worker) {
  const concurrency = Math.min(Math.max(1, Number(limit) || 1), items.length || 1);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
}

function cliOptions(argv) {
  const unknown = argv.filter((argument) => !["--apply", "--dry-run", "--help"].includes(argument));
  if (unknown.length) throw new Error("Argumento no reconocido: " + unknown[0]);
  return {
    apply: argv.includes("--apply"),
    help: argv.includes("--help"),
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = cliOptions(argv);
  if (options.help) {
    process.stdout.write(
      "Uso: node scripts/scan-catalog-v69.mjs [--dry-run|--apply]\n" +
        "Sin --apply escanea y valida, pero no escribe el catálogo.\n",
    );
    return;
  }
  let result = await runCatalogDiscoveryV69({
    onProgress: ({ catalogBrandName, products, processed, total, status }) => {
      if (catalogBrandName) {
        process.stderr.write(
          "[scan-v69] " + catalogBrandName + ": " + products.length + " apariciones.\n",
        );
      } else if (Number.isInteger(processed) && (processed === total || processed % 50 === 0)) {
        process.stderr.write(
          "[scan-v69] detalle " + processed + "/" + total + " (" + status + ").\n",
        );
      }
    },
  });
  if (options.apply) {
    result = await finalizeCatalogDiscoveryV69({ catalog: result.catalog });
    await writeJsonAtomically(DEFAULT_CATALOG, result.catalog);
  }
  process.stdout.write(
    JSON.stringify({
      mode: options.apply ? "apply" : "dry-run",
      written: options.apply,
      metrics: result.discoverySync.metrics,
      searchIndexedAt: result.discoverySync.searchIndexedAt,
      needsIndexedAt: result.discoverySync.needsIndexedAt,
      activationReady: result.discoverySync.activationReady,
    }) + "\n",
  );
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      "[scan-v69] " + (error instanceof Error ? error.message : String(error)) + "\n",
    );
    process.exitCode = 1;
  });
}
