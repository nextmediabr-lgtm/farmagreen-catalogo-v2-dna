export const FRAGRANCES_COLLECTION_V69 = Object.freeze({
  slug: "perfumes-fragancias",
  name: "Perfumes y Fragancias",
  aliases: Object.freeze(["perfumes", "fragancias", "colonias", "body splash"]),
  kind: "collection",
});

export const FRAGRANCES_AVAILABILITY_LABEL_V69 = "Disponible para Entrega o Retiro en 24 hs.";

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
