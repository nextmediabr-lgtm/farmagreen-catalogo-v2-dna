export const FRAGRANCES_COLLECTION_V69: Readonly<{
  slug: "perfumes-fragancias";
  name: "Perfumes y Fragancias";
  aliases: readonly string[];
  kind: "collection";
}>;
export const FRAGRANCES_AVAILABILITY_LABEL_V69: string;
export type FragranceAudienceV69 = "femeninas" | "masculinas" | "unisex" | "infantiles";
export const FRAGRANCE_AUDIENCE_OPTIONS_V69: ReadonlyArray<{
  value: `fragancias-${FragranceAudienceV69}`;
  group: FragranceAudienceV69;
  label: string;
  categoryIds: readonly string[];
}>;
export function fragranceAudienceV69(product: unknown): FragranceAudienceV69 | "";
export function isFragranceProductV69(product: unknown): boolean;
export function hasVerifiedStockV69(product: unknown): boolean;
