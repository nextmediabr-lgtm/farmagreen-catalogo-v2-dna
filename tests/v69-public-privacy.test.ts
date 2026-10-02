import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogV69, ProductV69 } from "../src/data-v69.js";
import { defaultCatalogPolicyV69 } from "../src/catalog-policy-v69.js";
import { catalogPageV69, homePageV69, productPageV69, publicCatalogV69 } from "../src/render-v69.js";

const ORIGIN = "https://farmagreenrosario.web.app";
const PRIVATE_REFERENCE = /gps[\s._-]*farma/i;

function fixture(): CatalogV69 {
  return {
    version: 6.9,
    syncedAt: "2026-10-02T17:00:00.000Z",
    commerceSyncedAt: "2026-10-02T17:00:00.000Z",
    availabilityReferenceAt: "2026-10-02T17:00:00.000Z",
    totalProducts: 1,
    magentoCategoryPaths: {
      "6380": ["Cuidado de la Piel", "Faciales"],
      "6485": ["Promos Especiales", "Noviembre", "RED (GPSfarma s version)"],
      "6486": ["GPS Farma", "Faciales"],
    },
    products: [{
      publicId: "public-demo", slug: "public-demo", name: "Crema hidratante x 50 ml",
      brand: { id: "1", slug: "eucerin", name: "Eucerin", aliases: ["eucerin"] },
      line: "Hidratación", primaryCategory: "rostro", categorySlugs: ["rostro"],
      needs: ["hidratacion"], aliases: ["hidratante"], description: "Hidrata la piel.",
      listPrice: 1000, offerPrice: 800, savingAmount: 200, discountPercent: 20,
      promotion: { type: "percentage", label: "-20%", percent: 20 },
      availability: "limited", availabilityCheckedAt: "2026-10-02T17:00:00.000Z",
      barcode: "7790000000001", sku: "PRIVATE-SKU",
      source: { url: "https://gpsfarma.com/private-product.html" },
      images: { card: "/media-v6-9/public-demo/card", detail: "/media-v6-9/public-demo/detail" },
      magentoCategories: [{ id: "6380", name: "Faciales" }, { id: "6485", name: "RED (GPSfarma s version)" }],
    }],
  };
}

test("la salida pública limpia las categorías sin alterar IDs, precios, stock ni el snapshot privado", () => {
  const catalog = fixture();
  const before = structuredClone(catalog);
  const output = publicCatalogV69(catalog);
  assert.equal(PRIVATE_REFERENCE.test(JSON.stringify(output)), false);
  assert.deepEqual(output.magentoCategoryPaths, {
    "6380": ["Cuidado de la Piel", "Faciales"],
    "6485": ["Promos Especiales", "Noviembre", "RED"],
    "6486": ["Faciales"],
  });
  assert.deepEqual(output.products[0].magentoCategories, [{ id: "6380", name: "Faciales" }, { id: "6485", name: "RED" }]);
  for (const key of ["publicId", "slug", "barcode", "listPrice", "offerPrice", "savingAmount", "discountPercent", "promotion", "needs"] as const) {
    assert.deepEqual(output.products[0][key], catalog.products[0][key], key);
  }
  assert.equal(output.products[0].availability, "available_reference");
  assert.equal(output.totalProducts, 1);
  assert.deepEqual(catalog, before, "La fuente privada debe permanecer intacta.");
  assert.deepEqual(publicCatalogV69(catalog), output, "La proyección debe ser estable.");
});

test("HTML, bootstrap y búsqueda por ID comparten categorías públicas limpias", () => {
  const catalog = fixture();
  const html = catalogPageV69(catalog, new URLSearchParams({ scope: "todo", q: "6485" }), ORIGIN);
  assert.equal(PRIVATE_REFERENCE.test(html), false);
  assert.match(html, /id="catalogTitleV69">Promos Especiales › Noviembre › RED<\/h1>/);
  assert.match(html, /href="\/p\/public-demo"/);
  const boot = JSON.parse(html.match(/id="fg69-data">([\s\S]*?)<\/script>/)![1]);
  assert.deepEqual(boot.magentoCategoryPaths, publicCatalogV69(catalog).magentoCategoryPaths);
  const search = catalogPageV69(catalog, new URLSearchParams({ scope: "todo", q: "RED" }), ORIGIN);
  assert.match(search, /href="\/p\/public-demo"/, "Se conserva la búsqueda por el nombre útil de la categoría.");
});

test("API, fichas, SEO, WhatsApp y alias no publican menciones ni enlaces del proveedor", () => {
  const catalog = fixture();
  const product = catalog.products[0];
  product.name += " (GPSFARMA)";
  product.line += " [GPS Farma]";
  product.aliases.push("GPSFarma", "hidratante GPS-Farma");
  product.brand.aliases!.push("gpsfarma.com");
  product.description += " https://gpsfarma.com/private-product.html";
  product.catalogFacets = [{ slug: "faciales", name: "Faciales (GPSfarma)", kind: "collection", aliases: ["GPSFarma"] }];
  const detailed = product as ProductV69 & { detail: { summary: string[]; sections: Array<{ id: string; title: string; kind: string; content: string[] }> } };
  detailed.detail = {
    summary: ["Hidratación diaria. (GPSFarma)", "https://www.gpsfarma.com/private-product.html"],
    sections: [{ id: "beneficios", title: "Beneficios (GPSFarma)", kind: "list", content: ["Piel suave.", "GPSFarma"] }],
  };
  const before = structuredClone(catalog);
  const dto = publicCatalogV69(catalog);
  const pdp = productPageV69(product, [product], ORIGIN);
  const whatsappTexts = [...pdp.matchAll(/href="(https:\/\/wa\.me\/[^\"]+)"/g)]
    .map((match) => new URL(match[1].replaceAll("&amp;", "&")).searchParams.get("text") || "");
  for (const text of [JSON.stringify(dto), catalogPageV69(catalog, new URLSearchParams("scope=todo"), ORIGIN), homePageV69(catalog, ORIGIN), pdp, ...whatsappTexts]) {
    assert.equal(PRIVATE_REFERENCE.test(text), false);
    assert.equal(text.includes("private-product.html"), false);
    assert.equal(text.includes("PRIVATE-SKU"), false);
  }
  assert.equal(dto.products[0].name, "Crema hidratante x 50 ml");
  assert.deepEqual(dto.products[0].aliases, ["hidratante", "hidratante", "Eucerin", "eucerin"]);
  assert.match(pdp, /Hidratación diaria\./);
  assert.match(pdp, /Piel suave\./);
  assert.deepEqual(catalog, before);
});

test("limpiar referencias no altera las exclusiones ni el selector de promociones", () => {
  const catalog = fixture();
  const policy = defaultCatalogPolicyV69();
  policy.navigation.promotionDisabledTechnicalBrandSlugs = ["eucerin"];
  const noOffer = publicCatalogV69(catalog, policy);
  assert.equal(noOffer.products[0].discountPercent, 0);
  assert.equal(noOffer.products[0].offerPrice, 1000);
  assert.equal(noOffer.products[0].promotion, undefined);
  policy.eanRules.exclude = [{ ean: "7790000000001", note: "Prueba", createdAt: catalog.syncedAt }];
  assert.equal(publicCatalogV69(catalog, policy).totalProducts, 0);
});
