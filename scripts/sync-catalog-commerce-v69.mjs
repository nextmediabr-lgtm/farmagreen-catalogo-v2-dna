import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTrustedHtml, trustedSourceUrl } from "./gpsfarma-http.mjs";
import {
  bestProductCandidate,
  decodeEntities,
  normalizeProductText,
  textFromHtml,
} from "./gpsfarma-listing.mjs";

export const GPS_ORIGIN = "https://gpsfarma.com";
export const PAGE_SIZE = 36;
export const DEFAULT_MIN_COVERAGE = 0.95;
export const DEFAULT_MIN_PRICE_COVERAGE = 0.95;
export const DEFAULT_INVENTORY_SCOPE_V69 = Object.freeze({
  label: "Rosario",
  regionId: 722,
  cityId: 152,
  inventorySource: "STOM",
});

const LOCATION_ENDPOINT_V69 = "/rest/V1/gpsfarma/geolocation/customer/location";

export const GPS_SOURCES_V69 = Object.freeze([
  { id: "5930", catalogBrandId: "5930", catalogBrandName: "Eucerin", mode: "brand" },
  { id: "5808", catalogBrandId: "5808", catalogBrandName: "Dermaglos", mode: "brand" },
  { id: "5751", catalogBrandId: "5751", catalogBrandName: "Caviahue", mode: "brand" },
  { id: "6048", catalogBrandId: "6048", catalogBrandName: "La Roche Posay", mode: "brand" },
  { id: "6301", catalogBrandId: "6301", catalogBrandName: "Vichy", mode: "brand" },
  { id: "6023", catalogBrandId: "6023", catalogBrandName: "ISDIN", mode: "brand" },
  { id: "5756", catalogBrandId: "5756", catalogBrandName: "Cetaphil", mode: "brand" },
  { id: "5697", catalogBrandId: "5697", catalogBrandName: "Aveno", mode: "brand" },
  { id: "5911", catalogBrandId: "5911", catalogBrandName: "ENA", mode: "brand" },
  {
    id: "9100",
    catalogBrandId: "9100",
    catalogBrandName: "Productos Saludables",
    mode: "category",
    pathname: "/categorias/productos-saludables.html",
  },
  {
    id: "revitalift",
    catalogBrandId: "revitalift",
    catalogBrandName: "L'Oréal Revitalift",
    mode: "search",
    pathname: "/catalogsearch/result/index/",
    query: "revitalift",
  },
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";

export function trustedGpsUrl(value) {
  return trustedSourceUrl(value, GPS_ORIGIN);
}

export function inventoryScopeV69(environment = process.env) {
  const label = String(environment.V69_SYNC_LOCATION_LABEL || DEFAULT_INVENTORY_SCOPE_V69.label)
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 80);
  const inventorySource = String(
    environment.V69_SYNC_INVENTORY_SOURCE || DEFAULT_INVENTORY_SCOPE_V69.inventorySource,
  )
    .trim()
    .toUpperCase();
  if (!label) throw new Error("La ubicación comercial V6.9 es obligatoria.");
  if (!/^[A-Z0-9_-]{2,32}$/.test(inventorySource)) {
    throw new Error("La fuente de inventario V6.9 es inválida.");
  }
  return {
    label,
    regionId: environmentPositiveInteger(
      environment,
      "V69_SYNC_LOCATION_REGION_ID",
      DEFAULT_INVENTORY_SCOPE_V69.regionId,
    ),
    cityId: environmentPositiveInteger(
      environment,
      "V69_SYNC_LOCATION_CITY_ID",
      DEFAULT_INVENTORY_SCOPE_V69.cityId,
    ),
    inventorySource,
  };
}

export function normalizeGpsProductUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(trustedGpsUrl(value));
    const pathname =
      parsed.pathname
        .replace(/^\/categorias\//i, "/")
        .replace(/\/+/g, "/")
        .replace(/\/$/g, "")
        .toLowerCase() || "/";
    return `${parsed.hostname.toLowerCase()}${pathname}`;
  } catch {
    return "";
  }
}

export function normalizeGpsImagePath(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(trustedGpsUrl(value));
    if (!parsed.pathname.toLowerCase().startsWith("/media/catalog/product/")) return "";
    return parsed.pathname.replace(/\/+/g, "/").toLowerCase();
  } catch {
    return "";
  }
}

function htmlAttribute(attributes, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes || "").match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return decodeEntities(match?.[1] ?? match?.[2] ?? "");
}

function elementsByClass(html, tagName, className) {
  const results = [];
  const escapedClass = String(className).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<${tagName}\\b([^>]*\\bclass\\s*=\\s*(?:"[^"]*\\b${escapedClass}\\b[^"]*"|'[^']*\\b${escapedClass}\\b[^']*')[^>]*)>([\\s\\S]*?)<\\/${tagName}>`,
    "gi",
  );
  for (const match of String(html || "").matchAll(pattern)) {
    results.push({ attributes: match[1], content: match[2] });
  }
  return results;
}

function productBlocks(html) {
  const source = String(html || "");
  const starts = [];
  const marker = /<li\b([^>]*)>/gi;
  for (const match of source.matchAll(marker)) {
    const classes = htmlAttribute(match[1], "class").split(/\s+/).filter(Boolean);
    if (classes.includes("product-item")) starts.push(match.index);
  }
  return starts.map((start, index) => {
    const nextStart = starts[index + 1] ?? source.length;
    return source.slice(start, nextStart);
  });
}

function priceAmounts(block) {
  let oldPrice = 0;
  let finalPrice = 0;
  for (const tag of String(block || "").matchAll(/<span\b([^>]*)>/gi)) {
    const attributes = tag[1];
    const rawAmount = htmlAttribute(attributes, "data-price-amount");
    const amount = Number.parseFloat(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const type = htmlAttribute(attributes, "data-price-type").toLowerCase();
    const id = htmlAttribute(attributes, "id").toLowerCase();
    if (type === "oldprice" || id.includes("old-price")) oldPrice ||= amount;
    if (
      type === "finalprice" ||
      (id.includes("product-price") && !id.includes("old-price") && !id.includes("excluding-tax"))
    ) {
      finalPrice ||= amount;
    }
  }
  return computePricing(oldPrice || finalPrice, finalPrice || oldPrice);
}

function listingAvailability(block) {
  for (const tag of String(block || "").matchAll(/<(?:div|span|p)\b([^>]*)>/gi)) {
    const classes = htmlAttribute(tag[1], "class").split(/\s+/).filter(Boolean);
    if (classes.includes("stock") && classes.includes("unavailable")) return "unavailable";
  }
  if (
    /\bdata-role\s*=\s*(?:"tocart-form"|'tocart-form')/i.test(block) ||
    /\/checkout\/cart\/add\//i.test(block)
  ) {
    return "available";
  }
  return "unknown";
}

export function computePricing(listPriceValue, offerPriceValue) {
  const rawList = Number(listPriceValue);
  const rawOffer = Number(offerPriceValue);
  let listPrice = Number.isFinite(rawList) && rawList > 0 ? rawList : 0;
  let offerPrice = Number.isFinite(rawOffer) && rawOffer > 0 ? rawOffer : 0;
  if (!listPrice) listPrice = offerPrice;
  if (!offerPrice) offerPrice = listPrice;
  if (offerPrice > listPrice) listPrice = offerPrice;
  const savingAmount = Math.max(0, listPrice - offerPrice);
  const discountPercent = listPrice > 0 ? (savingAmount / listPrice) * 100 : 0;
  return {
    listPrice: roundCurrency(listPrice),
    offerPrice: roundCurrency(offerPrice),
    savingAmount: roundCurrency(savingAmount),
    discountPercent: Math.max(0, Number(discountPercent.toFixed(2))),
  };
}

export function parseListingProducts(html, source) {
  const products = [];
  for (const block of productBlocks(html)) {
    const anchors = elementsByClass(block, "a", "product-item-link");
    const productLink = anchors[0];
    const photoLink = elementsByClass(block, "a", "product-item-photo")[0];
    const rawUrl =
      htmlAttribute(productLink?.attributes, "href") || htmlAttribute(photoLink?.attributes, "href");
    const sourceName = textFromHtml(productLink?.content || "");
    const listedBrand = textFromHtml(elementsByClass(block, "div", "product-item-brand")[0]?.content || "");
    const imageTag = block.match(
      /<img\b([^>]*\bclass\s*=\s*(?:"[^"]*\bproduct-image-photo\b[^"]*"|'[^']*\bproduct-image-photo\b[^']*')[^>]*)>/i,
    );
    const imageUrl = htmlAttribute(imageTag?.[1], "src");
    if (!rawUrl || !sourceName) continue;

    let sourceUrl;
    try {
      sourceUrl = trustedGpsUrl(rawUrl);
    } catch {
      continue;
    }

    const pricing = priceAmounts(block);
    const sourceBrand = source.mode === "brand" ? source.catalogBrandName : listedBrand;
    products.push({
      sourceId: source.id,
      catalogBrandId: source.catalogBrandId,
      catalogBrandName: source.catalogBrandName,
      sourceUrl,
      sourceName,
      sourceBrand,
      listedBrand,
      imageUrl: normalizeGpsImagePath(imageUrl) ? trustedGpsUrl(imageUrl) : "",
      availability: listingAvailability(block),
      ...pricing,
    });
  }
  return products;
}

export function parseNextPageUrl(html) {
  const source = String(html || "");
  for (const item of source.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const classes = htmlAttribute(item[1], "class").split(/\s+/).filter(Boolean);
    if (!classes.includes("pages-item-next")) continue;
    const anchor = item[2].match(/<a\b([^>]*)>/i);
    const href = htmlAttribute(anchor?.[1], "href");
    return href ? trustedGpsUrl(href) : null;
  }
  return null;
}

export function sourceStartUrl(source) {
  const url = new URL(source.pathname || "/categorias.html", GPS_ORIGIN);
  if (source.mode === "brand") url.searchParams.set("marca", source.id);
  if (source.mode === "search") url.searchParams.set("q", source.query || source.catalogBrandName);
  url.searchParams.set("p", "1");
  url.searchParams.set("product_list_limit", String(PAGE_SIZE));
  url.searchParams.set("product_list_order", "name");
  return trustedGpsUrl(url);
}

function listingFingerprint(products) {
  return products
    .map((product) => normalizeGpsProductUrl(product.sourceUrl))
    .filter(Boolean)
    .sort()
    .join("\n");
}

export async function crawlSource(
  source,
  {
    fetchHtml,
    maxPages = 100,
    wait = sleep,
    delayMs = 120,
  } = {},
) {
  if (typeof fetchHtml !== "function") {
    throw new Error("La extracción comercial V6.9 requiere una ubicación de inventario configurada.");
  }
  const seenPages = new Set();
  const seenFingerprints = new Set();
  const productsByUrl = new Map();
  const pages = [];
  let currentUrl = sourceStartUrl(source);

  for (let page = 1; page <= maxPages; page += 1) {
    const normalizedPageUrl = trustedGpsUrl(currentUrl);
    if (seenPages.has(normalizedPageUrl)) {
      throw new Error(`Bucle de paginación detectado en ${source.catalogBrandName}.`);
    }
    seenPages.add(normalizedPageUrl);

    const html = await fetchHtml(normalizedPageUrl);
    const listed = parseListingProducts(html, source);
    const fingerprint = listingFingerprint(listed);
    if (listed.length && seenFingerprints.has(fingerprint)) {
      throw new Error(`Página repetida detectada en ${source.catalogBrandName}.`);
    }
    if (listed.length) seenFingerprints.add(fingerprint);

    const before = productsByUrl.size;
    for (const product of listed) {
      productsByUrl.set(normalizeGpsProductUrl(product.sourceUrl), product);
    }
    const nextUrl = parseNextPageUrl(html);
    pages.push({
      page,
      listed: listed.length,
      newItems: productsByUrl.size - before,
      hasNext: Boolean(nextUrl),
    });

    if (!nextUrl) {
      return {
        id: source.id,
        catalogBrandId: source.catalogBrandId,
        catalogBrandName: source.catalogBrandName,
        status: "completed",
        pages,
        products: [...productsByUrl.values()],
      };
    }
    if (!listed.length) {
      throw new Error(`Página vacía con continuación en ${source.catalogBrandName}.`);
    }
    if (page === maxPages) {
      throw new Error(`Paginación excede el máximo seguro en ${source.catalogBrandName}.`);
    }
    currentUrl = nextUrl;
    if (delayMs > 0) await wait(delayMs);
  }
  throw new Error(`Paginación incompleta en ${source.catalogBrandName}.`);
}

export async function crawlAllSources(
  sources = GPS_SOURCES_V69,
  { concurrency = 3, onProgress = defaultProgress, ...crawlOptions } = {},
) {
  return mapLimit(sources, concurrency, async (source) => {
    try {
      const result = await crawlSource(source, crawlOptions);
      onProgress?.(result);
      return result;
    } catch (error) {
      throw new Error(
        `Falló la fuente ${source.catalogBrandName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
}

function sourceForProduct(product, resultsByBrandId) {
  const brandId = String(product?.brand?.id || "");
  if (brandId && resultsByBrandId.has(brandId)) return resultsByBrandId.get(brandId);
  const normalizedBrand = normalizeProductText(product?.brand?.name);
  return [...resultsByBrandId.values()].find(
    (source) => normalizeProductText(source.catalogBrandName) === normalizedBrand,
  );
}

function validPricing(candidate) {
  return Number(candidate?.listPrice) > 0 && Number(candidate?.offerPrice) > 0;
}

function uniqueCandidatesByImage(candidates) {
  const unique = new Map();
  const ambiguous = new Set();
  for (const candidate of candidates) {
    const key = normalizeGpsImagePath(candidate?.imageUrl);
    if (!key || ambiguous.has(key)) continue;
    if (unique.has(key)) {
      unique.delete(key);
      ambiguous.add(key);
    } else {
      unique.set(key, candidate);
    }
  }
  return unique;
}

function updatedMatchedProduct(product, candidate, completedAt) {
  const pricing = validPricing(candidate)
    ? {
        listPrice: candidate.listPrice,
        offerPrice: candidate.offerPrice,
        savingAmount: candidate.savingAmount,
        discountPercent: candidate.discountPercent,
      }
    : {};
  const availability =
    candidate?.availability === "available"
      ? "limited"
      : candidate?.availability === "unavailable"
        ? "out_of_stock"
        : "unknown";
  return {
    ...product,
    ...pricing,
    availability,
    availabilityCheckedAt: availability === "unknown" ? null : completedAt,
    source: {
      ...(product.source && typeof product.source === "object" ? product.source : {}),
      url: candidate.sourceUrl,
      retrievedAt: completedAt,
    },
  };
}

function unverifiedProduct(product) {
  return {
    ...product,
    availability: "unknown",
    availabilityCheckedAt: null,
  };
}

export function synchronizeCatalog(
  baseCatalog,
  sourceResults,
  {
    completedAt = new Date().toISOString(),
    minCoverage = DEFAULT_MIN_COVERAGE,
    minPriceCoverage = DEFAULT_MIN_PRICE_COVERAGE,
    minSourceListingRatio = 0.2,
    minTitleConfidence = 0.86,
    expectedSourceIds = GPS_SOURCES_V69.map((source) => String(source.id)),
    inventoryScope = DEFAULT_INVENTORY_SCOPE_V69,
  } = {},
) {
  if (!baseCatalog || !Array.isArray(baseCatalog.products) || !baseCatalog.products.length) {
    throw new Error("Catálogo base V6.9 inválido o vacío.");
  }
  if (!Array.isArray(sourceResults) || !sourceResults.length) {
    throw new Error("No hay fuentes comerciales completas.");
  }
  if (sourceResults.some((source) => source.status !== "completed")) {
    throw new Error("La sincronización contiene una fuente incompleta.");
  }
  const actualSourceIds = new Set(sourceResults.map((source) => String(source.id)));
  if (
    actualSourceIds.size !== expectedSourceIds.length ||
    expectedSourceIds.some((sourceId) => !actualSourceIds.has(String(sourceId)))
  ) {
    throw new Error(
      `La sincronización debe completar exactamente ${expectedSourceIds.length} fuentes.`,
    );
  }

  const resultsByBrandId = new Map(
    sourceResults.map((source) => [String(source.catalogBrandId || source.id), source]),
  );
  const productCountBySource = new Map();
  for (const product of baseCatalog.products) {
    const source = sourceForProduct(product, resultsByBrandId);
    if (source) productCountBySource.set(source.id, (productCountBySource.get(source.id) || 0) + 1);
  }

  for (const source of sourceResults) {
    const catalogProducts = productCountBySource.get(source.id) || 0;
    const minimumListed = catalogProducts
      ? Math.max(1, Math.floor(catalogProducts * minSourceListingRatio))
      : 1;
    if (source.products.length < minimumListed) {
      throw new Error(
        `Cobertura insuficiente en ${source.catalogBrandName}: ${source.products.length}/${catalogProducts} listados.`,
      );
    }
  }

  const sourceMetrics = new Map(
    sourceResults.map((source) => [
      source.id,
      {
        id: source.id,
        name: source.catalogBrandName,
        status: source.status,
        pages: source.pages.length,
        listed: source.products.length,
        catalogProducts: productCountBySource.get(source.id) || 0,
        matchedByUrl: 0,
        matchedByImage: 0,
        matchedByTitle: 0,
        available: 0,
        unavailable: 0,
        unverified: 0,
        pricesUpdated: 0,
      },
    ]),
  );
  const usedCandidateUrls = new Set();
  let matchedByUrl = 0;
  let matchedByImage = 0;
  let matchedByTitle = 0;
  let available = 0;
  let unavailable = 0;
  let unverified = 0;
  let pricesUpdated = 0;

  const trackAvailability = (product, metric) => {
    if (product.availability === "limited") {
      available += 1;
      if (metric) metric.available += 1;
    } else if (product.availability === "out_of_stock") {
      unavailable += 1;
      if (metric) metric.unavailable += 1;
    } else {
      unverified += 1;
      if (metric) metric.unverified += 1;
    }
    return product;
  };

  const products = baseCatalog.products.map((product) => {
    const source = sourceForProduct(product, resultsByBrandId);
    if (!source) {
      return trackAvailability(unverifiedProduct(product), null);
    }
    const metric = sourceMetrics.get(source.id);
    const candidatesByUrl = new Map(
      source.products.map((candidate) => [normalizeGpsProductUrl(candidate.sourceUrl), candidate]),
    );
    const candidatesByImage = uniqueCandidatesByImage(source.products);
    const knownUrl = normalizeGpsProductUrl(product?.source?.url);
    const exact = knownUrl ? candidatesByUrl.get(knownUrl) : null;
    if (exact) {
      matchedByUrl += 1;
      metric.matchedByUrl += 1;
      if (validPricing(exact)) {
        pricesUpdated += 1;
        metric.pricesUpdated += 1;
      }
      usedCandidateUrls.add(normalizeGpsProductUrl(exact.sourceUrl));
      return trackAvailability(updatedMatchedProduct(product, exact, completedAt), metric);
    }

    const productImageKey = normalizeGpsImagePath(
      product?.images?.original || product?.images?.detail || product?.images?.card,
    );
    const imageMatch = productImageKey ? candidatesByImage.get(productImageKey) : null;
    if (imageMatch) {
      matchedByImage += 1;
      metric.matchedByImage += 1;
      if (validPricing(imageMatch)) {
        pricesUpdated += 1;
        metric.pricesUpdated += 1;
      }
      usedCandidateUrls.add(normalizeGpsProductUrl(imageMatch.sourceUrl));
      return trackAvailability(updatedMatchedProduct(product, imageMatch, completedAt), metric);
    }

    const candidate = bestProductCandidate(product, source.products);
    if (candidate && Number(candidate.confidence) >= minTitleConfidence) {
      matchedByTitle += 1;
      metric.matchedByTitle += 1;
      if (validPricing(candidate)) {
        pricesUpdated += 1;
        metric.pricesUpdated += 1;
      }
      usedCandidateUrls.add(normalizeGpsProductUrl(candidate.sourceUrl));
      return trackAvailability(updatedMatchedProduct(product, candidate, completedAt), metric);
    }

    return trackAvailability(unverifiedProduct(product), metric);
  });

  const matched = matchedByUrl + matchedByImage + matchedByTitle;
  const verified = available + unavailable;
  const coverage = Number((matched / products.length).toFixed(4));
  const priceCoverage = matched ? Number((pricesUpdated / matched).toFixed(4)) : 0;
  const availabilityCoverage = Number((verified / products.length).toFixed(4));
  if (coverage < minCoverage) {
    throw new Error(`Cobertura comercial insuficiente: ${(coverage * 100).toFixed(1)}%.`);
  }
  if (priceCoverage < minPriceCoverage) {
    throw new Error(`Cobertura de precios insuficiente: ${(priceCoverage * 100).toFixed(1)}%.`);
  }

  const listedProducts = sourceResults.reduce((sum, source) => sum + source.products.length, 0);
  const newCandidates = sourceResults.reduce(
    (sum, source) =>
      sum +
      source.products.filter(
        (candidate) => !usedCandidateUrls.has(normalizeGpsProductUrl(candidate.sourceUrl)),
      ).length,
    0,
  );
  const metrics = {
    catalogProducts: products.length,
    listedProducts,
    matchedByUrl,
    matchedByImage,
    matchedByTitle,
    matched,
    available,
    unavailable,
    unverified,
    verified,
    availabilityCoverage,
    pricesUpdated,
    newCandidates,
    coverage,
    priceCoverage,
    inventoryLocation: String(inventoryScope?.label || DEFAULT_INVENTORY_SCOPE_V69.label),
  };

  return {
    ...baseCatalog,
    version: 6.9,
    totalProducts: products.length,
    commerceSyncedAt: completedAt,
    commerceSync: {
      completedAt,
      status: "completed",
      sources: [...sourceMetrics.values()],
      metrics,
      coverage,
    },
    products,
  };
}

export async function runCommercialSync({
  rootDir = ROOT,
  apply = false,
  sources = GPS_SOURCES_V69,
  providedBaseCatalog,
  fetchHtml,
  inventoryScope = inventoryScopeV69(),
  now = () => new Date(),
  minCoverage = environmentNumber("V69_MIN_SYNC_COVERAGE", DEFAULT_MIN_COVERAGE),
  minPriceCoverage = environmentNumber(
    "V69_MIN_PRICE_COVERAGE",
    DEFAULT_MIN_PRICE_COVERAGE,
  ),
  onProgress = defaultProgress,
  writeCatalog = writeJsonAtomically,
} = {}) {
  const dataDir = path.join(rootDir, "data");
  const outputPath = path.join(dataDir, "catalog-v69.json");
  const inputPath = (await fileExists(outputPath))
    ? outputPath
    : path.join(dataDir, "catalog-v68.json");
  const baseCatalog =
    providedBaseCatalog || JSON.parse(await fs.readFile(inputPath, "utf8"));
  const scopedFetchHtml =
    fetchHtml ||
    (await createLocationScopedFetchV69({
      inventoryScope,
    }));
  const sourceResults = await crawlAllSources(sources, { fetchHtml: scopedFetchHtml, onProgress });
  const catalog = synchronizeCatalog(baseCatalog, sourceResults, {
    completedAt: now().toISOString(),
    minCoverage,
    minPriceCoverage,
    expectedSourceIds: sources.map((source) => String(source.id)),
    inventoryScope,
  });
  if (apply) await writeCatalog(outputPath, catalog);
  return {
    mode: apply ? "apply" : "dry-run",
    inputPath,
    outputPath,
    written: apply,
    catalog,
    commerceSync: catalog.commerceSync,
  };
}

export async function writeJsonAtomically(filePath, value) {
  const directory = path.dirname(filePath);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function createLocationScopedFetchV69({
  inventoryScope = inventoryScopeV69(),
  fetchImpl = globalThis.fetch,
  timeoutMs = environmentNumber("V69_SYNC_TIMEOUT_MS", 20_000),
  maxAttempts = environmentNumber("V69_SYNC_MAX_ATTEMPTS", 3),
  retryDelayMs = 450,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Fetch comercial V6.9 no disponible.");
  const cookies = new Map();
  const baseHeaders = {
    accept: "text/html,application/xhtml+xml",
    "accept-language": "es-AR,es;q=0.9",
    "user-agent": USER_AGENT,
  };
  const scopedFetch = async (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    const cookie = cookieHeaderV69(cookies);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetchImpl(input, { ...init, headers });
    absorbCookiesV69(cookies, response);
    return response;
  };

  const root = await scopedFetch(trustedGpsUrl("/"), {
    headers: baseHeaders,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!root.ok) throw new Error(`No se pudo iniciar la sesión comercial: HTTP ${root.status}.`);

  const location = await scopedFetch(trustedGpsUrl(LOCATION_ENDPOINT_V69), {
    method: "POST",
    headers: {
      ...baseHeaders,
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: GPS_ORIGIN,
      referer: `${GPS_ORIGIN}/`,
    },
    body: JSON.stringify({
      location: {
        regionId: inventoryScope.regionId,
        cityId: inventoryScope.cityId,
      },
      persistLocation: false,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!location.ok) {
    throw new Error(`No se pudo seleccionar la ubicación comercial: HTTP ${location.status}.`);
  }
  await location.text();
  const selectedSource = decodedCookieValueV69(cookies.get("geo_inventory_source"));
  if (selectedSource !== inventoryScope.inventorySource) {
    throw new Error("La fuente de inventario comercial no coincide con la ubicación configurada.");
  }

  return (url) =>
    fetchTrustedHtml(url, {
      origin: GPS_ORIGIN,
      headers: baseHeaders,
      fetchImpl: scopedFetch,
      timeoutMs,
      maxAttempts,
      retryDelayMs,
    });
}

function absorbCookiesV69(cookies, response) {
  const headers = response?.headers;
  const setCookies =
    typeof headers?.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers?.get("set-cookie")
        ? [headers.get("set-cookie")]
        : [];
  for (const rawCookie of setCookies) {
    const firstSegment = String(rawCookie || "").split(";", 1)[0];
    const separator = firstSegment.indexOf("=");
    if (separator <= 0) continue;
    const name = firstSegment.slice(0, separator).trim();
    const value = firstSegment.slice(separator + 1).trim();
    if (name && value) cookies.set(name, value);
  }
}

function cookieHeaderV69(cookies) {
  return [...cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function decodedCookieValueV69(value) {
  if (!value) return "";
  try {
    const decoded = decodeURIComponent(value);
    const parsed = JSON.parse(decoded);
    return String(parsed || "").trim().toUpperCase();
  } catch {
    return decodeURIComponent(value).replace(/^"|"$/g, "").trim().toUpperCase();
  }
}

function defaultProgress(result) {
  process.stderr.write(
    `[sync-v69] ${result.catalogBrandName}: ${result.products.length} productos, ${result.pages.length} páginas.\n`,
  );
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
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return results;
}

function environmentNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function environmentPositiveInteger(environment, name, fallback) {
  const raw = environment?.[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  if (!/^\d+$/.test(String(raw).trim())) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return parsed;
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function cliOptions(argv) {
  const unknown = argv.filter((argument) => !["--apply", "--dry-run", "--help"].includes(argument));
  if (unknown.length) throw new Error(`Argumento no reconocido: ${unknown[0]}`);
  return {
    apply: argv.includes("--apply"),
    help: argv.includes("--help"),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = cliOptions(argv);
  if (options.help) {
    process.stdout.write(
      "Uso: node scripts/sync-catalog-commerce-v69.mjs [--dry-run|--apply]\n" +
        "Sin --apply valida las 11 fuentes y no escribe archivos.\n",
    );
    return;
  }
  const result = await runCommercialSync({ apply: options.apply });
  process.stdout.write(
    `${JSON.stringify({
      mode: result.mode,
      written: result.written,
      output: path.relative(ROOT, result.outputPath),
      completedAt: result.commerceSync.completedAt,
      metrics: result.commerceSync.metrics,
    })}\n`,
  );
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[sync-v69] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
