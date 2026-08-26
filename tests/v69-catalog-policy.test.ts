import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCatalogPolicyV69,
  defaultCatalogPolicyV69,
  displayBrandV69,
  navigationBrandsV69,
  validEanV69,
  validateCatalogPolicyV69,
} from "../src/catalog-policy-v69.js";
import type { CatalogV69, ProductV69 } from "../src/data-v69.js";

test("la navegación separa marcas legacy del paraguas Productos Saludables", () => {
  const policy = defaultCatalogPolicyV69();
  assert.equal(policy.navigation.showOutOfStockSort, true);
  const catalog = fixtureCatalog([
    product("eucerin", "Eucerin", []),
    product("ena-healthy", "ENA", [healthyFacet()]),
    product("goodskin", "Goodskin", [healthyFacet()]),
    product("102", "102 años", [healthyFacet()]),
  ]);
  assert.equal(displayBrandV69(catalog.products[1], policy).name, "ENA");
  assert.equal(displayBrandV69(catalog.products[2], policy).name, "Productos Saludables");
  assert.equal(displayBrandV69(catalog.products[3], policy).name, "Productos Saludables");

  const presented = applyCatalogPolicyV69(catalog, policy);
  assert.deepEqual(presented.products.map((entry) => entry.brand.name), [
    "Eucerin",
    "ENA",
    "Productos Saludables",
    "Productos Saludables",
  ]);
  assert.ok(presented.products[2].aliases.includes("Goodskin"));

  const navigation = navigationBrandsV69(catalog, policy);
  assert.equal(navigation.length, 16);
  assert.equal(navigation.at(-1)?.name, "Productos Saludables");
  assert.equal(navigation.at(-1)?.count, 3);
  assert.equal(navigation.some((entry) => entry.name === "Goodskin"), false);

  policy.navigation.showOutOfStockSort = false;
  assert.equal(validateCatalogPolicyV69(policy).navigation.showOutOfStockSort, false);
});

test("las reglas EAN validan checksum, unicidad y conflicto inclusión/exclusión", () => {
  assert.equal(validEanV69("3337875694469"), true);
  assert.equal(validEanV69("3337875694468"), false);
  const policy = defaultCatalogPolicyV69();
  policy.eanRules.exclude.push({
    ean: "3337875694469",
    note: "Ocultar",
    createdAt: "2026-08-25T00:00:00.000Z",
  });
  const validated = validateCatalogPolicyV69(policy);
  const catalog = fixtureCatalog([
    { ...product("excluded", "Goodskin", [healthyFacet()]), barcode: "3337875694469" },
    { ...product("visible", "Eucerin", []), barcode: "7793640992929" },
  ]);
  assert.deepEqual(applyCatalogPolicyV69(catalog, validated).products.map((entry) => entry.publicId), ["visible"]);

  policy.eanRules.include.push({
    ean: "3337875694469",
    note: "Incluir",
    createdAt: "2026-08-25T00:00:00.000Z",
  });
  assert.throws(() => validateCatalogPolicyV69(policy), /simultáneamente incluido y excluido/);
});

function healthyFacet() {
  return {
    slug: "productos-saludables",
    name: "Productos Saludables",
    kind: "collection" as const,
  };
}

function product(publicId: string, brandName: string, catalogFacets: ProductV69["catalogFacets"]): ProductV69 {
  return {
    publicId,
    slug: publicId,
    name: `Producto ${brandName}`,
    brand: {
      id: publicId,
      slug: brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: brandName,
      aliases: [],
    },
    line: brandName,
    primaryCategory: "nutricion",
    categorySlugs: ["nutricion"],
    needs: ["nutricion"],
    aliases: [],
    description: "Producto de prueba.",
    listPrice: 100,
    offerPrice: 100,
    savingAmount: 0,
    discountPercent: 0,
    availability: "limited",
    availabilityCheckedAt: "2026-08-25T00:00:00.000Z",
    barcode: "",
    images: { card: "/card.jpg", detail: "/detail.jpg" },
    catalogFacets,
  };
}

function fixtureCatalog(products: ProductV69[]): CatalogV69 {
  return {
    version: 6.9,
    syncedAt: "2026-08-25T00:00:00.000Z",
    availabilityReferenceAt: "2026-08-25T00:00:00.000Z",
    commerceSyncedAt: "2026-08-25T00:00:00.000Z",
    totalProducts: products.length,
    products,
  };
}
