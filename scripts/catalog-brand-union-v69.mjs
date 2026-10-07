// Shared by SSR and the transpiled browser bundle. Only complete, recognized
// brand names/aliases enable +; ordinary cosmetic/product queries keep AND.
export function brandUnionV69(products, query) {
  if (!String(query).includes("+")) return null;
  const normalizeBrand = value => String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const terms = String(query).split("+").map(normalizeBrand);
  if (terms.length < 2 || terms.some(term => !term)) return null;
  const byBrand = new Map();
  for (const product of products) {
    for (const name of [product.brand?.name, ...(product.brand?.aliases || [])]) {
      const key = normalizeBrand(name);
      if (!key) continue;
      const ids = byBrand.get(key) || new Set();
      ids.add(product.publicId);
      byBrand.set(key, ids);
    }
  }
  if (terms.some(term => !byBrand.has(term))) return null;
  const productIds = new Set();
  for (const term of terms) for (const id of byBrand.get(term)) productIds.add(id);
  return { terms: [...new Set(terms)], productIds };
}
