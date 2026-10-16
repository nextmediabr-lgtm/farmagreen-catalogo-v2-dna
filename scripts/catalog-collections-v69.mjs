export const FRAGRANCES_COLLECTION_V69 = Object.freeze({
  slug: "perfumes-fragancias",
  name: "Perfumes y Fragancias",
  aliases: Object.freeze(["perfumes", "fragancias", "colonias", "body splash"]),
  kind: "collection",
});

export const FRAGRANCES_AVAILABILITY_LABEL_V69 = "Disponible para Entrega o Retiro en 24 hs.";

// IDs de las ramas comerciales de Magento, no inferencias por nombre o marca.
export const FRAGRANCE_AUDIENCE_OPTIONS_V69 = Object.freeze([
  { value: "fragancias-femeninas", group: "femeninas", label: "Femeninas", categoryIds: ["7025", "7028", "7145", "7148", "7682"] },
  { value: "fragancias-masculinas", group: "masculinas", label: "Masculinas", categoryIds: ["7385", "7388", "7247", "7751", "9662"] },
  { value: "fragancias-unisex", group: "unisex", label: "Unisex", categoryIds: ["9077", "9080", "8774"] },
  { value: "fragancias-infantiles", group: "infantiles", label: "Infantiles", categoryIds: ["7805", "7808", "7946", "7988", "8948"] },
]);

export function fragranceAudienceV69(product) {
  const views = [...(product?.catalogFacets || []), ...(product?.catalogViews || [])];
  if (product?.primaryCategory !== "fragancias" && !(product?.needs || []).includes("fragancias") &&
      !views.some(view => view.kind === "collection" && view.slug === "perfumes-fragancias")) return "";
  const ids = new Set((product?.magentoCategories || []).map(category => String(category.id)));
  const groups = FRAGRANCE_AUDIENCE_OPTIONS_V69.filter(option => option.categoryIds.some(id => ids.has(id)));
  // Niña/niño/unisex infantil nunca se mezcla con las ramas adultas.
  if (groups.some(option => option.group === "infantiles")) return "infantiles";
  return groups.length === 1 ? groups[0].group : "";
}

export function isFragranceProductV69(product) {
  return product?.primaryCategory === "fragancias" ||
    (product?.catalogFacets || []).some((entry) =>
      entry.kind === "collection" && entry.slug === FRAGRANCES_COLLECTION_V69.slug) ||
    (product?.sourceMemberships || []).some((entry) =>
      entry.viewKind === "collection" && entry.viewSlug === FRAGRANCES_COLLECTION_V69.slug);
}

export function hasVerifiedStockV69(product) {
  return product?.availability === "limited" &&
    Boolean(product.availabilityCheckedAt) &&
    Number.isFinite(Date.parse(product.availabilityCheckedAt));
}
