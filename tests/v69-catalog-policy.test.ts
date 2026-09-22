import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCatalogPolicyV69,
  defaultCatalogPolicyV69,
  displayBrandV69,
  navigationBrandsV69,
  technicalBrandSlugV69,
  validEanV69,
  validateCatalogPolicyV69,
} from "../src/catalog-policy-v69.js";
import type { CatalogV69, ProductV69 } from "../src/data-v69.js";

test("la navegación separa marcas legacy del paraguas Productos Saludables", () => {
  const policy = defaultCatalogPolicyV69();
  assert.equal(policy.navigation.showOutOfStockSort, true);
  assert.deepEqual(policy.navigation.excludedBrandSlugs, []);
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

  policy.navigation.excludedBrandSlugs = [technicalBrandSlugV69("Goodskin")];
  const excluded = applyCatalogPolicyV69(catalog, validateCatalogPolicyV69(policy));
  assert.equal(excluded.products.some((entry) => entry.aliases.includes("Goodskin")), false);
  assert.equal(navigationBrandsV69(excluded, policy).at(-1)?.count, 2);
  assert.equal(technicalBrandSlugV69("Bagó +"), "bago-plus");

  policy.navigation.showOutOfStockSort = false;
  assert.equal(validateCatalogPolicyV69(policy).navigation.showOutOfStockSort, false);
});

test("las reglas EAN validan checksum, unicidad y conflicto inclusión/exclusión", () => {
  assert.equal(validEanV69("3337875694469"), true);
  assert.equal(validEanV69("3337875694468"), false);
  const policy = defaultCatalogPolicyV69();
  policy.eanRules.exclude.push({
    ean: "3337875694469",
    note: "",
    createdAt: "2026-08-25T00:00:00.000Z",
  });
  const validated = validateCatalogPolicyV69(policy);
  assert.equal(validated.eanRules.exclude[0].note, "");
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

test("marcas legacy deshabilitadas no consumen el límite de navegación", () => {
  const policy = defaultCatalogPolicyV69();
  for (let index = 0; index < 35; index += 1) {
    policy.navigation.featuredBrands.push({
      slug: `extra-${index}`,
      name: `Extra ${index}`,
      aliases: [],
      enabled: index < 6,
    });
  }
  assert.equal(policy.navigation.featuredBrands.filter((entry) => entry.enabled).length, 21);
  assert.equal(validateCatalogPolicyV69(policy).navigation.featuredBrands.length, 50);

  for (const entry of policy.navigation.featuredBrands.slice(21, 31)) entry.enabled = true;
  assert.throws(() => validateCatalogPolicyV69(policy), /30 marcas destacadas habilitadas/);
});

test("promociones por marca conservan SKU y precio regular sin aplicar descuentos", () => {
  const dermaglos = {
    ...product("derma-promo", "Dermaglos", []),
    listPrice: 100,
    offerPrice: 70,
    savingAmount: 30,
    discountPercent: 30,
    promotion: { type: "percentage" as const, label: "-30%", percent: 30 },
  };
  const eucerin = {
    ...product("eucerin-promo", "Eucerin", []),
    listPrice: 200,
    offerPrice: 100,
    savingAmount: 100,
    discountPercent: 50,
    promotion: { type: "percentage" as const, label: "-50%", percent: 50 },
  };
  const supradyn = {
    ...product("supradyn-2x1", "Supradyn", [healthyFacet()]),
    listPrice: 35_900,
    offerPrice: 35_900,
    savingAmount: 35_900,
    discountPercent: 50,
    promotion: {
      type: "two_for_one" as const,
      label: "2×1",
      buyQuantity: 2 as const,
      payQuantity: 1 as const,
      priceBasis: "source_unit" as const,
      unitPrice: 35_900,
      bundlePrice: 35_900,
      bundleSaving: 35_900,
    },
  };
  const healthyVirtual = {
    ...product("healthy-virtual", "Goodskin", [healthyFacet()]),
    listPrice: 100,
    offerPrice: 80,
    savingAmount: 20,
    discountPercent: 20,
    promotion: { type: "percentage" as const, label: "-20%", percent: 20 },
  };
  const catalog = fixtureCatalog([dermaglos, eucerin, product("regular", "Eucerin", []), supradyn, healthyVirtual]);
  const policy = defaultCatalogPolicyV69();
  assert.equal(policy.navigation.promotionBrandSlugs, null);
  policy.navigation.promotionBrandSlugs = ["dermaglos"];
  const presented = applyCatalogPolicyV69(catalog, validateCatalogPolicyV69(policy));
  assert.equal(presented.totalProducts, 5);
  assert.equal(presented.products[0].offerPrice, 70);
  assert.equal(presented.products[0].discountPercent, 30);
  assert.equal(presented.products[1].listPrice, 200);
  assert.equal(presented.products[1].offerPrice, 200);
  assert.equal(presented.products[1].discountPercent, 0);
  assert.equal(presented.products[1].promotion, undefined);
  assert.equal(presented.products[2].offerPrice, 100);
  assert.equal(presented.products[3].offerPrice, 35_900);
  assert.equal(presented.products[3].promotion, undefined);
  assert.equal(presented.products[3].discountPercent, 0);
  assert.equal(presented.products[4].brand.name, "Productos Saludables");
  assert.equal(presented.products[4].promotion, undefined);
  assert.equal(catalog.products[1].offerPrice, 100);
  policy.navigation.promotionBrandSlugs = ["productos-saludables"];
  const virtualOnly = applyCatalogPolicyV69(catalog, policy);
  assert.equal(virtualOnly.products[4].promotion?.type, "percentage");
  assert.equal(virtualOnly.products[3].promotion?.type, "two_for_one");
  assert.equal(virtualOnly.products[1].promotion, undefined);
  policy.navigation.promotionBrandSlugs = [];
  assert.equal(applyCatalogPolicyV69(catalog, policy).products.every((entry) => !entry.promotion), true);
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
