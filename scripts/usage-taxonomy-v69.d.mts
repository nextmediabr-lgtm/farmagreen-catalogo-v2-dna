export type InferredTaxonomyV69 = {
  primaryCategory: string;
  needs: string[];
  audit: Record<string, unknown>;
};

export function inferTaxonomyV69(nameValue: unknown, brandValue: unknown): InferredTaxonomyV69;
export function reconcileCatalogUsesV69(product: {
  name: string;
  line?: string;
  brand?: { name?: string };
  primaryCategory: string;
  needs: string[];
  catalogFacets?: Array<{ slug: string; kind: string }>;
  sourceMemberships?: Array<{ viewSlug: string; viewKind: string }>;
}): InferredTaxonomyV69 | null;
