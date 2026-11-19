export function categoryKeysV69(query: string): string[] | null;
export function categoryUnionV69(
  products: Array<{ publicId: string; magentoCategories?: Array<{ id: string | number }> }>,
  query: string,
): { terms: string[]; productIds: Set<string> } | null;
export function categoryQueryTitleV69(query: string, paths?: Record<string, string[]>): string;
