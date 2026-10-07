export function brandUnionV69(
  products: Array<{ publicId: string; brand?: { name?: string; aliases?: string[] } }>,
  query: string,
): { terms: string[]; productIds: Set<string> } | null;
