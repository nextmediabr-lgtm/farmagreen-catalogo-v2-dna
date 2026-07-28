import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTrustedHtml } from "./gpsfarma-http.mjs";
import {
  bestProductCandidate,
  decodeEntities,
  normalizeProductText,
  productLinks,
  textFromHtml,
} from "./gpsfarma-listing.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = path.join(ROOT, "data", "catalog-v67.json");
const OUTPUT = path.join(ROOT, "data", "gpsfarma-v68-source.json");
const ORIGIN = "https://gpsfarma.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
const PAGE_SIZE = 36;
const MAX_PAGES = 10;
const CONCURRENCY = 4;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function normalize(value) {
  return normalizeProductText(value);
}

function incompleteDescription(product) {
  const description = String(product.description || "").trim();
  return (
    /\.{3}$/.test(description) ||
    description.endsWith("…") ||
    normalize(description) === normalize(product.name) ||
    description.length < 45
  );
}

async function fetchHtml(url) {
  return fetchTrustedHtml(url, {
    origin: ORIGIN,
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "es-AR,es;q=0.9",
      "user-agent": USER_AGENT,
    },
    maxAttempts: 3,
    timeoutMs: 20_000,
    retryDelayMs: 450,
  });
}

function sourceText(html) {
  const description =
    html.match(
      /<div\s+class="product attribute description">[\s\S]*?<div\s+class="value"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    )?.[1] || "";
  const overview =
    html.match(
      /<div\s+class="product attribute overview">[\s\S]*?<div\s+class="value"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i,
    )?.[1] || "";
  return { description: textFromHtml(description), overview: textFromHtml(overview) };
}

function listingUrl(brandId, brandName, page) {
  const parameters = new URLSearchParams({
    product_list_limit: String(PAGE_SIZE),
    product_list_order: "name",
    p: String(page),
  });
  if (/^\d+$/.test(brandId)) {
    parameters.set("marca", brandId);
    return `${ORIGIN}/categorias.html?${parameters}`;
  }
  parameters.set("q", brandName.replace(/L['’]or[eé]al/gi, "Loreal"));
  return `${ORIGIN}/catalogsearch/result/?${parameters}`;
}

function productSearchUrl(product) {
  const stopWords = new Set([
    "suplemento",
    "dietario",
    "dietaria",
    "estuche",
    "unidad",
    "unidades",
    "capsulas",
    "comprimidos",
    "pastillas",
    "sobres",
    "ampollas",
  ]);
  const query = normalize(product.name)
    .split(" ")
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !stopWords.has(token))
    .slice(0, 5)
    .join(" ");
  const parameters = new URLSearchParams({
    product_list_limit: String(PAGE_SIZE),
    product_list_order: "name",
    q: query || product.name,
    v68: product.publicId,
  });
  return `${ORIGIN}/catalogsearch/result/?${parameters}`;
}

async function listBrandProducts(brandId, brandName) {
  const seen = new Map();
  const pages = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = listingUrl(brandId, brandName, page);
    const html = await fetchHtml(url);
    const links = productLinks(html, ORIGIN);
    const before = seen.size;
    for (const link of links) {
      seen.set(link.sourceUrl, { ...link, brandId, catalogBrandName: brandName });
    }
    pages.push({ page, url, listed: links.length, newItems: seen.size - before });
    process.stderr.write(`[lista] ${brandName} ${page}: ${links.length} (${seen.size} únicas)\n`);
    if (!links.length || seen.size === before || links.length < PAGE_SIZE) break;
    await wait(180);
  }
  return { products: [...seen.values()], pages };
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

const catalog = JSON.parse(await fs.readFile(INPUT, "utf8"));
const targets = catalog.products.filter(incompleteDescription);
const brands = new Map();
for (const product of catalog.products) {
  const key = product.brand?.name || "";
  if (!key || brands.has(key)) continue;
  brands.set(key, String(product.brand?.id || ""));
}

const listingPages = [];
const sourceProducts = [];
for (const [brandName, brandId] of brands) {
  const result = await listBrandProducts(brandId, brandName);
  listingPages.push(...result.pages);
  sourceProducts.push(...result.products);
}

const candidatesByBrand = new Map();
for (const candidate of sourceProducts) {
  const list = candidatesByBrand.get(candidate.catalogBrandName) || [];
  list.push(candidate);
  candidatesByBrand.set(candidate.catalogBrandName, list);
}

const matched = [];
let unmatched = [];
for (const product of targets) {
  const candidates = candidatesByBrand.get(product.brand.name) || [];
  const source = bestProductCandidate(product, candidates);
  if (source) matched.push({ product, source });
  else unmatched.push({ publicId: product.publicId, name: product.name, brand: product.brand.name });
}

process.stderr.write(
  `[mapa] ${matched.length}/${targets.length} descripciones incompletas vinculadas; ${unmatched.length} sin vínculo confiable.\n`,
);

const fallbackResults = await mapLimit(unmatched, 1, async (item, index) => {
  const product = catalog.products.find((candidate) => candidate.publicId === item.publicId);
  if (!product) return { item, source: null };
  const url = productSearchUrl(product);
  try {
    const html = await fetchHtml(url);
    const links = productLinks(html, ORIGIN).map((link) => ({
        ...link,
        brandId: String(product.brand?.id || ""),
        catalogBrandName: product.brand?.name || "",
      }));
    listingPages.push({ page: 1, url, listed: links.length, newItems: links.length, kind: "product-search" });
    const source = bestProductCandidate(product, links);
    process.stderr.write(`[búsqueda] ${index + 1}/${unmatched.length}: ${source ? "vinculado" : "sin coincidencia"}\n`);
    await wait(240);
    return { item, product, source };
  } catch (error) {
    process.stderr.write(`[búsqueda] ${index + 1}/${unmatched.length}: error\n`);
    return {
      item: {
        ...item,
        searchError: error instanceof Error ? error.message : String(error),
      },
      product,
      source: null,
    };
  }
});

for (const result of fallbackResults) {
  if (result.product && result.source) matched.push({ product: result.product, source: result.source });
}
unmatched = fallbackResults.filter((result) => !result.source).map((result) => result.item);
process.stderr.write(`[búsqueda] ${matched.length}/${targets.length} vinculadas después del rescate por nombre.\n`);

const recovered = (
  await mapLimit(matched, CONCURRENCY, async ({ product, source }, index) => {
    try {
      const html = await fetchHtml(source.sourceUrl);
      const text = sourceText(html);
      if ((index + 1) % 20 === 0 || index + 1 === matched.length) {
        process.stderr.write(`[detalle] ${index + 1}/${matched.length}\n`);
      }
      await wait(90);
      return {
        publicId: product.publicId,
        catalogName: product.name,
        brand: product.brand.name,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        confidence: source.confidence,
        description: text.description,
        overview: text.overview,
      };
    } catch (error) {
      return {
        publicId: product.publicId,
        catalogName: product.name,
        brand: product.brand.name,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        confidence: source.confidence,
        description: "",
        overview: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
).filter(Boolean);

const usable = recovered.filter((entry) => entry.description.length >= 45 && !entry.error);
const output = {
  version: 1,
  source: ORIGIN,
  fetchedAt: new Date().toISOString(),
  policy: "Public GPSFarma product pages; exact or high-confidence name match; no generated medical copy.",
  summary: {
    catalogProducts: catalog.products.length,
    incompleteDescriptions: targets.length,
    listedProducts: sourceProducts.length,
    matched: matched.length,
    fallbackSearched: fallbackResults.length,
    fallbackMatched: fallbackResults.filter((result) => result.source).length,
    recovered: usable.length,
    unmatched: unmatched.length,
    errors: recovered.filter((entry) => entry.error).length,
  },
  listingPages,
  products: recovered,
  unmatched,
};

await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(output.summary)}\n`);
