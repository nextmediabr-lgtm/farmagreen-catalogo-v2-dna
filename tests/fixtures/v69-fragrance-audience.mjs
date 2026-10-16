export function fragranceAudienceFixtureV69() {
  const at = new Date().toISOString();
  const roots = { femeninas: "7025", masculinas: "7385", unisex: "9077", infantiles: "7805" };
  const products = Object.entries(roots).flatMap(([group, id]) =>
    Array.from({ length: group === "femeninas" ? 80 : 3 }, (_, index) => ({
      publicId: `${group}-${String(index).padStart(3, "0")}`,
      slug: `${group}-${index}`, name: `Perfume ${group} ${String(index).padStart(3, "0")}`,
      brand: { id: "nautica", slug: "nautica", name: "Nautica", aliases: [] }, line: "",
      primaryCategory: "fragancias", categorySlugs: ["fragancias"], needs: ["fragancias"], aliases: [],
      description: "Descripción original de la ficha.", availability: "limited", availabilityCheckedAt: at,
      listPrice: 100, offerPrice: 100, discountPercent: 0, savingAmount: 0,
      catalogFacets: [{ kind: "collection", slug: "perfumes-fragancias", name: "Perfumes y Fragancias" }],
      magentoTaxonomyAttached: true,
      magentoCategories: [{ id: "7022", name: "Perfumes y Fragancias" }, { id, name: group }],
      images: { card: "https://storage.googleapis.com/test/perfume.jpg", detail: "https://storage.googleapis.com/test/perfume.jpg" },
    })),
  );
  products.find(product => product.publicId === "infantiles-000").magentoCategories.push({ id: "7025", name: "Femeninas" });
  const sample = products[0];
  products.push({ ...structuredClone(sample), publicId: "sin-clasificar", name: "Perfume femenino sin evidencia",
    magentoCategories: [{ id: "7022", name: "Perfumes y Fragancias" }] });
  products.push({ ...structuredClone(sample), publicId: "conflicto", name: "Perfume con categorías contradictorias",
    magentoCategories: [{ id: "7025", name: "Femeninas" }, { id: "7385", name: "Masculinas" }] });
  products.push({ ...structuredClone(sample), publicId: "agotado", availability: "out_of_stock" });
  products.push({ ...structuredClone(sample), publicId: "dermo", name: "Crema hidratante Eucerin",
    brand: { id: "eucerin", slug: "eucerin", name: "Eucerin", aliases: [] },
    primaryCategory: "rostro", categorySlugs: ["rostro"], needs: ["hidratacion"], catalogFacets: [],
    magentoCategories: [{ id: "999", name: "Hidratación" }] });
  return { version: 6.9, syncedAt: at, commerceSyncedAt: at, availabilityReferenceAt: at,
    magentoCategoryPaths: Object.fromEntries(Object.entries(roots).map(([group, id]) => [id, ["Perfumes y Fragancias", group]])),
    totalProducts: products.length, products };
}
