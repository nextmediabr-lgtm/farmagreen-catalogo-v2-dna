import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_INVENTORY_SCOPE_V69,
  GPS_SOURCES_V69,
  createLocationScopedFetchV69,
  runCommercialSync,
  writeJsonAtomically,
} from "./sync-catalog-commerce-v69.mjs";
import {
  consolidateDetailedGroupsV69,
  crawlSourceV7Beta,
  enrichListingGroupsV69,
  groupSourceListingsV69,
  newProductFromSourceGroupV69,
} from "./build-local-v7-beta.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function importBrandV69({
  sourceId,
  inputPath,
  outputPath,
  fetchHtml,
  now = () => new Date(),
  onProgress = () => {},
} = {}) {
  const source = GPS_SOURCES_V69.find(
    (candidate) => String(candidate.id) === String(sourceId) && candidate.importCatalog === true,
  );
  if (!source?.facet || source.mode !== "brand") {
    throw new Error(`La fuente ${sourceId || "(vacía)"} no está autorizada para importar fichas V6.9.`);
  }
  if (!inputPath || !outputPath) throw new Error("La importación V6.9 requiere input y output explícitos.");

  const baseCatalog = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
  if (Number(baseCatalog.version) !== 6.9 || !Array.isArray(baseCatalog.products)) {
    throw new Error("El snapshot base V6.9 es inválido.");
  }
  const scopedFetchHtml = fetchHtml || await createLocationScopedFetchV69({
    inventoryScope: DEFAULT_INVENTORY_SCOPE_V69,
  });
  const listing = await crawlSourceV7Beta(source, { fetchHtml: scopedFetchHtml });
  const grouped = groupSourceListingsV69([listing]);
  const detailed = consolidateDetailedGroupsV69(await enrichListingGroupsV69(grouped, {
    fetchHtml: scopedFetchHtml,
    baseCatalog,
    onProgress,
  }));
  const completedAt = now().toISOString();
  const additions = detailed
    .filter((group) => group.baseIndex === null || group.baseIndex === undefined)
    .filter((group) => !source.importAvailableOnly || groupAvailabilityV69(group) === "available")
    .map((group) => newProductFromSourceGroupV69(group, completedAt));
  const expanded = {
    ...baseCatalog,
    totalProducts: baseCatalog.products.length + additions.length,
    products: [...baseCatalog.products, ...additions],
  };
  assertUniqueIdentitiesV69(expanded.products);

  const synchronized = await runCommercialSync({
    providedBaseCatalog: expanded,
    sources: GPS_SOURCES_V69,
    fetchHtml: scopedFetchHtml,
    now,
    onProgress,
  });
  await writeJsonAtomically(path.resolve(outputPath), synchronized.catalog);
  return {
    source: { id: source.id, name: source.catalogBrandName },
    inventoryScope: DEFAULT_INVENTORY_SCOPE_V69,
    listed: listing.products.length,
    existing: detailed.length - additions.length,
    added: additions.length,
    outputPath: path.resolve(outputPath),
    catalog: synchronized.catalog,
    commerceSync: synchronized.commerceSync,
  };
}

function groupAvailabilityV69(group) {
  const states = new Set((group.members || []).map((member) => member.availability));
  if (states.has("available")) return "available";
  if (states.has("unavailable")) return "unavailable";
  return "unknown";
}

function assertUniqueIdentitiesV69(products) {
  for (const [label, value] of [
    ["publicId", (product) => String(product.publicId || "")],
    ["SKU", (product) => String(product.sku || "").trim().toLowerCase()],
    ["URL", (product) => normalizeUrl(product.source?.url)],
  ]) {
    const seen = new Set();
    for (const product of products) {
      const identity = value(product);
      if (!identity) continue;
      if (seen.has(identity)) throw new Error(`La importación de marca duplicó ${label}: ${identity}.`);
      seen.add(identity);
    }
  }
}

function normalizeUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/^\/categorias/i, "").replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return "";
  }
}

function cliValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  importBrandV69({
    sourceId: cliValue("source"),
    inputPath: cliValue("input"),
    outputPath: cliValue("output") || path.join(ROOT, "data", "catalog-v69.json"),
    onProgress: ({ processed, total, status }) => {
      if (Number.isInteger(processed) && (processed === total || processed % 10 === 0)) {
        process.stderr.write(`[detalle] ${processed}/${total} ${status}\n`);
      }
    },
  }).then((result) => {
    process.stdout.write(`${JSON.stringify({
      source: result.source,
      inventoryScope: result.inventoryScope,
      listed: result.listed,
      existing: result.existing,
      added: result.added,
      products: result.catalog.products.length,
      completedAt: result.commerceSync.completedAt,
      sources: result.commerceSync.sources.length,
      metrics: result.commerceSync.metrics,
      output: result.outputPath,
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`[import-brand-v69] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
