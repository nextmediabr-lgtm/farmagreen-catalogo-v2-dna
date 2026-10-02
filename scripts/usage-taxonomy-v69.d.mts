export type InferredTaxonomyV69 = {
  primaryCategory: string;
  needs: string[];
  audit: Record<string, unknown>;
};

export type UseEvidenceV69 = {
  line?: string;
  description?: string;
  detail?: { summary?: string[]; sections?: Array<{ id?: string; title?: string; content?: string[] }> };
  primaryCategory?: string;
  catalogFacets?: Array<{ slug: string; kind: string }>;
  sourceMemberships?: Array<{ viewSlug: string; viewKind: string }>;
};

export function inferTaxonomyV69(nameValue: unknown, brandValue: unknown, evidence?: UseEvidenceV69): InferredTaxonomyV69;
export function reconcileCatalogUsesV69(product: UseEvidenceV69 & {
  name: string;
  brand?: { name?: string };
  needs: string[];
  taxonomy?: Record<string, unknown>;
}): InferredTaxonomyV69 | null;
