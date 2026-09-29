import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GPS_FRAGRANCES_SOURCE_V69, createLocationScopedFetchV69,
  runCommercialSync, writeJsonAtomically,
} from "./sync-catalog-commerce-v69.mjs";
import {
  crawlSourceV7Beta, groupSourceListingsV69, enrichListingGroupsV69,
  consolidateDetailedGroupsV69, newProductFromSourceGroupV69,
} from "./build-local-v7-beta.mjs";
import { assertUniqueCanonicalProductsV69, reindexCatalogV69 } from "./scan-catalog-v69.mjs";
import { filterExcludedProductsV69 } from "./prepare-gcp-catalog-v69.mjs";

// Only writes to an explicit, isolated local preview directory. Images use the
// existing local source bridge; this script never uploads or publishes assets.
export async function prepareFragrancesPreviewV69({ inputPath, outputDirectory, exclusionsPath }) {
  if (!inputPath || !outputDirectory || !exclusionsPath) throw new Error("La prueba requiere input, output-dir y exclusions explícitos.");
  const input = path.resolve(inputPath);
  const directory = path.resolve(outputDirectory);
  const output = path.join(directory, "catalog.json");
  if (output === input) throw new Error("La prueba no puede reemplazar el catálogo base.");
  await fs.mkdir(directory, { recursive: true });
  const base = JSON.parse(await fs.readFile(input, "utf8"));
  const exclusions = JSON.parse(await fs.readFile(path.resolve(exclusionsPath), "utf8"));
  if (base.version !== 6.9 || !Array.isArray(base.products)) throw new Error("El catálogo base V6.9 es inválido.");
  const fetchHtml = await createLocationScopedFetchV69();
  const listingFile = path.join(directory, "listing.json");
  const groupsFile = path.join(directory, "groups.json");
  const listing = await crawlSourceV7Beta(GPS_FRAGRANCES_SOURCE_V69, { fetchHtml });
  await writeJsonAtomically(listingFile, listing);
  process.stderr.write(`[fragancias] ${listing.products.length} URLs únicas; ${listing.products.filter(p => p.availability === "available").length} con stock STOM.\n`);
  const grouped = groupSourceListingsV69([listing]);
  const groups = consolidateDetailedGroupsV69(await enrichListingGroupsV69(grouped, {
    baseCatalog: base, fetchHtml, concurrency: 4,
    onProgress: ({ processed, total }) => {
      if (processed % 50 === 0 || processed === total) process.stderr.write(`[identidades] ${processed}/${total}\n`);
    },
  }));
  await writeJsonAtomically(groupsFile, groups);
  const products = [...base.products];
  let added = 0;
  let matched = 0;
  const at = new Date().toISOString();
  for (const group of groups) {
    const existingIndex = Number.isInteger(group.baseIndex) ? group.baseIndex : null;
    const product = existingIndex === null ? newProductFromSourceGroupV69(group, at) : products[existingIndex];
    if (!product?.sku) throw new Error("Una ficha de Fragancias no tiene SKU verificado.");
    const member = group.members[0];
    const enriched = {
      ...product,
      catalogFacets: [...(product.catalogFacets || []).filter(f => f.slug !== GPS_FRAGRANCES_SOURCE_V69.facet.slug), GPS_FRAGRANCES_SOURCE_V69.facet],
      sourceMemberships: [...(product.sourceMemberships || []).filter(m => m.sourceId !== GPS_FRAGRANCES_SOURCE_V69.id), {
        sourceId: GPS_FRAGRANCES_SOURCE_V69.id,
        viewSlug: GPS_FRAGRANCES_SOURCE_V69.facet.slug,
        viewName: GPS_FRAGRANCES_SOURCE_V69.facet.name,
        viewKind: "collection", membershipOnly: true, position: member.position,
      }],
    };
    if (existingIndex === null) { products.push(enriched); added += 1; }
    else { products[existingIndex] = enriched; matched += 1; }
  }
  const expanded = filterExcludedProductsV69({ ...base, products, totalProducts: products.length }, exclusions);
  assertUniqueCanonicalProductsV69(expanded.products);
  const synced = await runCommercialSync({
    providedBaseCatalog: expanded, fetchHtml,
    onProgress: result => process.stderr.write(`[sincro] ${result.catalogBrandName}: ${result.products.length}\n`),
  });
  const catalog = reindexCatalogV69(synced.catalog, synced.commerceSync.completedAt);
  await writeJsonAtomically(output, catalog);
  const perfumes = catalog.products.filter(p => p.catalogFacets?.some(f => f.slug === GPS_FRAGRANCES_SOURCE_V69.facet.slug));
  const report = {
    input, output, inventoryScope: { city: "Rosario", source: "STOM" },
    listing: { pages: listing.pages.length, occurrences: listing.pages.reduce((sum,p) => sum + p.listed, 0), uniqueUrls: listing.products.length },
    canonicalGroups: groups.length, added, matched,
    fragrances: { snapshot: perfumes.length, available: perfumes.filter(p => p.availability === "limited").length, withoutStock: perfumes.filter(p => p.availability !== "limited").length },
    products: catalog.products.length, sources: synced.commerceSync.sources.length,
    completedAt: synced.commerceSync.completedAt,
    dailySchedule: "07:00 y 14:00 ART; integración preparada para el cron existente",
    localOnly: true,
  };
  await writeJsonAtomically(path.join(directory, "report.json"), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  prepareFragrancesPreviewV69({ inputPath: arg("input"), outputDirectory: arg("output-dir"), exclusionsPath: arg("exclusions") })
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => { process.stderr.write(`[fragancias] ${error.message}\n`); process.exitCode = 1; });
}
