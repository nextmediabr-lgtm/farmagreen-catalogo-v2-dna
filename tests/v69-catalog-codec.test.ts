import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { encodeCatalogV69, decodeCatalogV69 } from "../scripts/catalog-codec-v69.mjs";

function fixture() {
  const product = {
    publicId: "a12345678900", name: "Sérum + hidratación", brand: { name: "Eucerin", slug: "eucerin" },
    needs: ["manchas", "hidratacion"], aliases: ["anti-pigment"], barcode: "4005800035784",
    listPrice: 35900.02, offerPrice: 17950.01, discountPercent: 50, savingAmount: 17950.01,
    availability: "available", availabilityCheckedAt: "2026-10-06T17:00:00Z",
    promotion: { type: "2x1", quantity: 2, price: 35900.02 },
    magentoCategories: [{ id: "42", name: "Cuidado facial" }], catalogViews: ["productos-saludables"],
    images: {
      card: "https://images.example/catalog/card.jpg?version=2#image", alt: "@literal",
      responsive: { jpeg: { widths: [320, 640], urls: ["https://images.example/catalog/320.jpg", "https://images.example/catalog/640.jpg"] } },
    },
  };
  return {
    version: "6.9", totalProducts: 2, commerceSyncedAt: "2026-10-06T17:00:00Z",
    navigation: { brands: [product.brand], views: ["productos-saludables"] },
    products: [product, { ...product, publicId: "b12345678900", name: "Sin stock", availability: "out_of_stock" }],
  };
}

test("compacto V6.9 conserva todos los campos, precios, usos, imágenes y metadatos sin mutar el DTO", () => {
  const original = fixture();
  const before = JSON.stringify(original);
  const wire = encodeCatalogV69(original, "snapshot:17") as { tables: { brands: unknown[]; variants: unknown[] } };
  assert.deepEqual(decodeCatalogV69(JSON.parse(JSON.stringify(wire))), original);
  assert.equal(JSON.stringify(original), before);
  assert.equal(wire.tables.brands.length, 1);
  assert.equal(wire.tables.variants.length, 1);
});

test("compacto V6.9 admite DTO completo de servidor anterior y rechaza versiones desconocidas", () => {
  const full = fixture();
  assert.equal(decodeCatalogV69(full), full);
  assert.throws(() => decodeCatalogV69({ format: "farmagreen-catalog-v69/999", products: [] }), /incompatible/);
});

test("compacto V6.9 rechaza referencias truncadas o inválidas", () => {
  for (const index of [-1, 0.5, 9999, "0"]) {
    const wire = encodeCatalogV69(fixture(), "revision") as { products: { brand: unknown }[] };
    wire.products[0].brand = index;
    assert.throws(() => decodeCatalogV69(wire), /Referencia de catálogo inválida/);
  }
  const wire = encodeCatalogV69(fixture(), "revision") as { tables: { prefixes: unknown[] } };
  wire.tables.prefixes = [];
  assert.throws(() => decodeCatalogV69(wire), /Referencia de catálogo inválida/);
});

test("compacto V6.9 preserva URLs, literales y claves especiales sin contaminar prototipos", () => {
  const full = fixture();
  full.products[0].images = JSON.parse('{"card":"https://images.example/a/b.jpg?next=/c","alt":"@@texto","__proto__":{"literal":"@1:no-es-referencia"},"responsive":{}}');
  assert.deepEqual(decodeCatalogV69(encodeCatalogV69(full, "17")), full);
  assert.equal(({} as Record<string, unknown>).literal, undefined);
});

test("decoder compilado funciona sin Object.fromEntries ni sintaxis nueva de Safari", async () => {
  const bundle = await readFile(new URL("../public/app-v6-9-compat.js", import.meta.url), "utf8");
  const end = bundle.indexOf("const BOOT");
  assert.ok(end > 0);
  const context = vm.createContext({ wire: encodeCatalogV69(fixture(), "17") });
  vm.runInContext("Object.fromEntries = undefined;", context);
  vm.runInContext(bundle.slice(0, end), context);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(decodeCatalogV69(wire))", context)), fixture());
});
