import type { CatalogV69, ProductV69 } from "./data-v69.js";

export const HEALTHY_COLLECTION_SLUG_V69 = "productos-saludables";
export const HEALTHY_COLLECTION_NAME_V69 = "Productos Saludables";

export const DEFAULT_FEATURED_BRANDS_V69 = Object.freeze([
  brand("aveno", "Aveno", ["aveeno"]),
  brand("bagovit", "Bagóvit", ["bagovit"]),
  brand("capilatis", "Capilatis"),
  brand("caviahue", "Caviahue"),
  brand("cerave", "CeraVe", ["cera ve"]),
  brand("cetaphil", "Cetaphil", ["cetafil"]),
  brand("dermaglos", "Dermaglos", ["dermaglós", "dermaglo"]),
  brand("ena", "ENA", ["ena suplementos", "ena sport"]),
  brand("eucerin", "Eucerin"),
  brand("isdin", "ISDIN"),
  brand("loreal-revitalift", "L'Oréal Revitalift", ["loreal revitalift", "l'oréal revitalift", "revitalift"]),
  brand("la-roche-posay", "La Roche Posay", ["la roche-posay", "laroche", "lrp"]),
  brand("neutrogena", "Neutrogena"),
  brand("vichy", "Vichy"),
  brand("vitamin-way", "Vitamin Way", ["vitaminway"]),
]);

export const DEFAULT_NEEDS_V69 = Object.freeze([
  "manchas",
  "acne",
  "piel-sensible",
  "hidratacion",
  "limpieza",
  "solares",
  "capilar",
  "antiedad",
  "reparacion",
  "nutricion",
  "cuidado-diario",
]);

const SORT_VALUES_V69 = new Set([
  "relevancia",
  "marca",
  "disponibilidad",
  "descuento",
  "precio-asc",
  "precio-desc",
  "nombre",
]);

export type FeaturedBrandV69 = {
  slug: string;
  name: string;
  aliases: string[];
  enabled: boolean;
};

export type EanRuleV69 = {
  ean: string;
  note: string;
  createdAt: string;
};

export type CatalogPolicyV69 = {
  schemaVersion: 1;
  navigation: {
    featuredBrands: FeaturedBrandV69[];
    umbrella: {
      enabled: boolean;
      slug: string;
      name: string;
      preserveBrandSlugs: string[];
    };
    needs: string[];
    defaultSort: string;
    showOutOfStockSort: boolean;
    excludedBrandSlugs: string[];
  };
  eanRules: {
    include: EanRuleV69[];
    exclude: EanRuleV69[];
  };
};

export type NavigationBrandV69 = {
  slug: string;
  name: string;
  count: number;
  kind: "brand" | "collection";
};

export function defaultCatalogPolicyV69(): CatalogPolicyV69 {
  const featuredBrands = DEFAULT_FEATURED_BRANDS_V69.map((entry) => ({
    ...entry,
    aliases: [...entry.aliases],
  }));
  return {
    schemaVersion: 1,
    navigation: {
      featuredBrands,
      umbrella: {
        enabled: true,
        slug: HEALTHY_COLLECTION_SLUG_V69,
        name: HEALTHY_COLLECTION_NAME_V69,
        preserveBrandSlugs: featuredBrands.map((entry) => entry.slug),
      },
      needs: [...DEFAULT_NEEDS_V69],
      defaultSort: "relevancia",
      showOutOfStockSort: true,
      excludedBrandSlugs: [],
    },
    eanRules: {
      include: [],
      exclude: [],
    },
  };
}

export function validateCatalogPolicyV69(value: unknown): CatalogPolicyV69 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("La configuración administrativa V6.9 es inválida.");
  }
  const raw = value as Record<string, unknown>;
  if (Number(raw.schemaVersion) !== 1) {
    throw new Error("La configuración administrativa V6.9 usa otro schema.");
  }
  const navigation = record(raw.navigation, "navigation");
  const featuredRaw = array(navigation.featuredBrands, "featuredBrands");
  if (!featuredRaw.length || featuredRaw.length > 30) {
    throw new Error("La navegación V6.9 debe tener entre 1 y 30 marcas destacadas.");
  }
  const featuredBrands = featuredRaw.map((entry, index) => {
    const item = record(entry, `featuredBrands[${index}]`);
    return {
      slug: slug(item.slug, `featuredBrands[${index}].slug`),
      name: shortText(item.name, `featuredBrands[${index}].name`, 80),
      aliases: uniqueStrings(item.aliases, `featuredBrands[${index}].aliases`, 24, 80),
      enabled: item.enabled !== false,
    };
  });
  assertUnique(featuredBrands.map((entry) => entry.slug), "slug de marca destacada");
  assertUnique(featuredBrands.map((entry) => normalize(entry.name)), "nombre de marca destacada");

  const umbrellaRaw = record(navigation.umbrella, "umbrella");
  const umbrellaSlug = slug(umbrellaRaw.slug, "umbrella.slug");
  if (umbrellaSlug !== HEALTHY_COLLECTION_SLUG_V69) {
    throw new Error("La colección Productos Saludables no puede cambiar de identidad.");
  }
  const enabledBrandSlugs = new Set(featuredBrands.filter((entry) => entry.enabled).map((entry) => entry.slug));
  const preserveBrandSlugs = uniqueStrings(
    umbrellaRaw.preserveBrandSlugs,
    "umbrella.preserveBrandSlugs",
    30,
    80,
  ).map((entry) => slug(entry, "umbrella.preserveBrandSlugs"));
  if (preserveBrandSlugs.some((entry) => !enabledBrandSlugs.has(entry))) {
    throw new Error("El paraguas sólo puede preservar marcas destacadas habilitadas.");
  }
  const needs = uniqueStrings(navigation.needs, "navigation.needs", 20, 64).map((entry) => slug(entry, "navigation.needs"));
  if (!needs.length) throw new Error("La navegación V6.9 necesita al menos una necesidad.");
  const defaultSort = shortText(navigation.defaultSort, "navigation.defaultSort", 40);
  if (!SORT_VALUES_V69.has(defaultSort)) throw new Error("El orden inicial V6.9 es inválido.");
  const excludedBrandSlugs = navigation.excludedBrandSlugs === undefined
    ? []
    : uniqueStrings(
        navigation.excludedBrandSlugs,
        "navigation.excludedBrandSlugs",
        500,
        80,
      ).map((entry) => slug(entry, "navigation.excludedBrandSlugs"));
  assertUnique(excludedBrandSlugs, "marca excluida");

  const eanRules = record(raw.eanRules, "eanRules");
  const include = validateEanRulesV69(eanRules.include, "eanRules.include");
  const exclude = validateEanRulesV69(eanRules.exclude, "eanRules.exclude");
  const includeSet = new Set(include.map((entry) => entry.ean));
  const conflicts = exclude.filter((entry) => includeSet.has(entry.ean));
  if (conflicts.length) {
    throw new Error("Un EAN no puede estar simultáneamente incluido y excluido.");
  }

  return {
    schemaVersion: 1,
    navigation: {
      featuredBrands,
      umbrella: {
        enabled: umbrellaRaw.enabled !== false,
        slug: umbrellaSlug,
        name: shortText(umbrellaRaw.name, "umbrella.name", 80),
        preserveBrandSlugs,
      },
      needs,
      defaultSort,
      showOutOfStockSort: navigation.showOutOfStockSort !== false,
      excludedBrandSlugs,
    },
    eanRules: { include, exclude },
  };
}

export function normalizeEanV69(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

export function validEanV69(value: unknown) {
  const ean = normalizeEanV69(value);
  if (![8, 12, 13, 14].includes(ean.length)) return false;
  const digits = [...ean].map(Number);
  const check = digits.pop();
  if (check === undefined) return false;
  let sum = 0;
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += digits[index] * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

export function isHealthyCollectionProductV69(product: ProductV69) {
  return (product.catalogFacets || []).some(
    (entry) => entry.kind === "collection" && entry.slug === HEALTHY_COLLECTION_SLUG_V69,
  );
}

export function featuredBrandForProductV69(product: ProductV69, policy: CatalogPolicyV69) {
  const productSlug = product.brand?.slug || slugify(product.brand?.name || "");
  const productNames = new Set([
    normalize(product.brand?.name),
    ...(product.brand?.aliases || []).map(normalize),
  ]);
  const facetSlugs = new Set(
    (product.catalogFacets || []).filter((entry) => entry.kind === "brand").map((entry) => entry.slug),
  );
  return policy.navigation.featuredBrands.find(
    (entry) =>
      entry.enabled &&
      (entry.slug === productSlug ||
        facetSlugs.has(entry.slug) ||
        productNames.has(normalize(entry.name)) ||
        entry.aliases.some((alias) => productNames.has(normalize(alias)))),
  );
}

export function displayBrandV69(product: ProductV69, policy: CatalogPolicyV69) {
  const featured = featuredBrandForProductV69(product, policy);
  const umbrella = policy.navigation.umbrella;
  const preserve = featured && umbrella.preserveBrandSlugs.includes(featured.slug);
  if (umbrella.enabled && isHealthyCollectionProductV69(product) && !preserve) {
    return {
      id: "9100",
      slug: umbrella.slug,
      name: umbrella.name,
      aliases: [umbrella.name, "saludables"],
    };
  }
  if (!featured) return product.brand;
  return {
    ...product.brand,
    slug: featured.slug,
    name: featured.name,
    aliases: [...new Set([featured.name, ...featured.aliases, ...(product.brand?.aliases || [])])],
  };
}

export function applyCatalogPolicyV69(catalog: CatalogV69, policy: CatalogPolicyV69): CatalogV69 {
  const products = catalog.products
    .filter((product) => !isProductExcludedByPolicyV69(product, policy))
    .map((product) => applyProductPolicyV69(product, policy));
  return {
    ...catalog,
    totalProducts: products.length,
    products,
  };
}

export function isProductExcludedByPolicyV69(product: ProductV69, policy: CatalogPolicyV69) {
  const ean = normalizeEanV69(product.barcode);
  const excludedBrand = policy.navigation.excludedBrandSlugs.includes(
    technicalBrandSlugV69(product.brand?.name || product.brand?.slug),
  );
  return excludedBrand || Boolean(ean && policy.eanRules.exclude.some((entry) => entry.ean === ean));
}

export function technicalBrandSlugV69(value: unknown) {
  return slugify(String(value || "marca").replace(/\+/g, " plus "));
}

export function applyProductPolicyV69(product: ProductV69, policy: CatalogPolicyV69): ProductV69 {
  const technicalBrand = product.brand;
  const presentedBrand = displayBrandV69(product, policy);
  if (presentedBrand === technicalBrand) return product;
  return {
    ...product,
    brand: presentedBrand,
    aliases: [
      ...new Set([
        ...(product.aliases || []),
        technicalBrand?.name,
        ...(technicalBrand?.aliases || []),
        presentedBrand.name,
      ].map((entry) => String(entry || "").trim()).filter(Boolean)),
    ],
  };
}

export function navigationBrandsV69(catalog: CatalogV69, policy: CatalogPolicyV69): NavigationBrandV69[] {
  const brands: NavigationBrandV69[] = policy.navigation.featuredBrands
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      count: catalog.products.filter((product) => featuredBrandForProductV69(product, policy)?.slug === entry.slug).length,
      kind: "brand" as const,
    }));
  if (policy.navigation.umbrella.enabled) {
    brands.push({
      slug: policy.navigation.umbrella.slug,
      name: policy.navigation.umbrella.name,
      count: catalog.products.filter(isHealthyCollectionProductV69).length,
      kind: "collection",
    });
  }
  return brands;
}

export function policyExcludedEansV69(policy: CatalogPolicyV69) {
  return new Set(policy.eanRules.exclude.map((entry) => entry.ean));
}

export function policyIncludedEansV69(policy: CatalogPolicyV69) {
  return new Set(policy.eanRules.include.map((entry) => entry.ean));
}

function validateEanRulesV69(value: unknown, field: string) {
  const rules = array(value, field).map((entry, index) => {
    const item = record(entry, `${field}[${index}]`);
    const ean = normalizeEanV69(item.ean);
    if (!validEanV69(ean)) throw new Error(`El EAN ${ean || "vacío"} no supera el checksum.`);
    const createdAt = shortText(item.createdAt, `${field}[${index}].createdAt`, 64);
    if (Number.isNaN(new Date(createdAt).getTime())) throw new Error(`La fecha de ${field}[${index}] es inválida.`);
    return {
      ean,
      note: item.note === undefined ? "" : shortText(item.note, `${field}[${index}].note`, 240),
      createdAt: new Date(createdAt).toISOString(),
    };
  });
  assertUnique(rules.map((entry) => entry.ean), `EAN de ${field}`);
  return rules;
}

function brand(slugValue: string, name: string, aliases: string[] = []): FeaturedBrandV69 {
  return { slug: slugValue, name, aliases, enabled: true };
}

function record(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`El campo ${field} debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new Error(`El campo ${field} debe ser una lista.`);
  return value;
}

function shortText(value: unknown, field: string, limit: number) {
  if (typeof value !== "string") throw new Error(`El campo ${field} debe ser texto.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > limit || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new Error(`El campo ${field} es inválido.`);
  }
  return cleaned;
}

function uniqueStrings(value: unknown, field: string, maxItems: number, maxLength: number) {
  const values = array(value, field).map((entry, index) => shortText(entry, `${field}[${index}]`, maxLength));
  if (values.length > maxItems) throw new Error(`El campo ${field} supera el máximo permitido.`);
  return [...new Set(values)];
}

function slug(value: unknown, field: string) {
  const cleaned = shortText(value, field, 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleaned)) throw new Error(`El slug ${field} es inválido.`);
  return cleaned;
}

function assertUnique(values: string[], field: string) {
  if (new Set(values).size !== values.length) throw new Error(`La configuración repite ${field}.`);
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value: unknown) {
  return normalize(value).replace(/\s+/g, "-") || "marca";
}
