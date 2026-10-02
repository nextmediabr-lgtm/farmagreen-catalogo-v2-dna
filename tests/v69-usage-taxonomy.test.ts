import assert from "node:assert/strict";
import test from "node:test";
import { inferTaxonomyV69, reconcileCatalogUsesV69 } from "../scripts/usage-taxonomy-v69.mjs";
import { prepareCatalogV69Data } from "../src/data-v69.js";
import { publicCatalogV69, productPageV69, catalogPageV69 } from "../src/render-v69.js";
import { reindexCatalogV69 } from "../scripts/scan-catalog-v69.mjs";
import { newProductFromSourceGroupV69 } from "../scripts/build-local-v7-beta.mjs";

const fragrance = { catalogFacets: [{ slug: "perfumes-fragancias", name: "Perfumes y Fragancias", kind: "collection" }] };
const benefits = (...content: string[]) => ({ summary: [], sections: [{ id: "beneficios", title: "Beneficios", kind: "list", content }] });
const fixture = (name: string, extra: Record<string, unknown> = {}) => ({
  publicId: "dual-use", name, slug: "dual-use", brand: { id: "5930", name: "Eucerin", slug: "eucerin" }, line: "",
  primaryCategory: "rostro", categorySlugs: ["rostro"], needs: ["limpieza"], aliases: [], description: "",
  listPrice: 100, offerPrice: 80, discountPercent: 20, savingAmount: 20,
  availability: "limited", availabilityCheckedAt: "2026-10-02T17:00:00.000Z",
  images: { card: "https://example.com/card.jpg", detail: "https://example.com/detail.jpg" },
  ...extra,
});

const cases: Array<[string, string[], Record<string, unknown>?]> = [
  ["Gel Limpiador Eucerin Anti-Pigment x 200 ml", ["limpieza"]],
  ["Protector solar Pigment Control FPS 50+ x 50 ml", ["solares"]],
  ["Anthelios Anti Dark-Spot Protector Solar FPS 50+", ["solares"]],
  ["Isdin Foto Ultra Spot Prevent Color SPF 50+", ["solares"]],
  ["Shampoo hidratante para cabello seco", ["capilar"]],
  ["Suplemento dietario para el cabello x 30 cápsulas", ["nutricion"]],
  ["Loción corporal perfumada hidratante x 200 ml", ["fragancias"], fragrance],
  ["Eau de parfum Blue Seduction", ["fragancias"], fragrance],
  ["Sérum despigmentante x 30 ml", ["manchas"]],
  ["Serum LRP Mela B3 x 30 ml", ["manchas", "hidratacion"], { detail: benefits("Hidrata y unifica el tono de la piel") }],
  ["Crema antiedad hidratante FPS 30", ["antiedad", "hidratacion"]],
  ["Crema facial HYALURON-FILLER x 50 ml", ["antiedad", "hidratacion"]],
  ["Crema para piel seca y sensible", ["piel-sensible", "hidratacion"]],
];
for (const [name, needs, extra = {}] of cases) {
  test(`usos A/B con evidencia: ${name}`, () => {
    const product = fixture(name, extra);
    const result = reconcileCatalogUsesV69(product);
    assert.deepEqual(result?.needs, needs);
    assert.equal(new Set(result?.needs).size, needs.length);
    assert.ok(needs.length <= 2);
    assert.equal(result?.audit.reasonerVersion, "v69.6-evidence-dual-use");
  });
}

test("no inventa beneficios por ingredientes orales, ropa, negaciones o instrucciones", () => {
  assert.deepEqual(inferTaxonomyV69("Suplemento Colágeno + Hialurónico x 30 cápsulas", "Vitamin Way").needs, ["nutricion"]);
  const deodorant = reconcileCatalogUsesV69(fixture("Desodorante Vichy Mineral Roll On", {
    needs: ["manchas"], description: "No deja manchas blancas en la ropa. Protege contra el sudor.",
    detail: benefits("No deja manchas blancas.", "Protege contra el mal olor."),
  }));
  assert.deepEqual(deodorant?.needs, ["cuidado-diario"]);
  assert.deepEqual(reconcileCatalogUsesV69(fixture("Aceite Corporal", {
    needs: ["manchas"], description: "Su fórmula de rápida absorción y sin manchas ofrece una experiencia placentera.",
  }))?.needs, ["cuidado-diario"]);
  assert.deepEqual(reconcileCatalogUsesV69(fixture("Crema Facial", {
    description: "Al exponer la piel al sol aparecen manchas como pecas y lunares.",
  }))?.needs, ["cuidado-diario"]);
  const serum = reconcileCatalogUsesV69(fixture("Serum LRP Mela B3", {
    detail: { summary: [], sections: [{ id: "modo-de-uso", content: ["Aplicar después de la limpieza, antes de una crema hidratante."] }] },
  }));
  assert.deepEqual(serum?.needs, ["manchas"]);
  assert.deepEqual(reconcileCatalogUsesV69(fixture("Crema facial sin perfume", {
    description: "No es un limpiador. No combate manchas ni arrugas. Usar después de un gel de limpieza.",
    aliases: ["fragancias", "manchas", "nutricion"], magentoCategories: [{ name: "Limpieza" }],
  }))?.needs, ["cuidado-diario"]);
});

test("Nutrición exige identidad oral y no vitaminas o creatina en una crema", () => {
  for (const name of ["BCAA 2:1:1 x 90 cápsulas", "Betacaroteno x 30 cápsulas", "Centrum Hombre x 30 comp", "Enargy gel vainilla"])
    assert.equal(inferTaxonomyV69(name, "ENA").needs[0], "nutricion");
  assert.equal(inferTaxonomyV69("Crema Tanvimil Isoflavonas x 50 gr", "Tanvimil").needs.includes("nutricion"), false);
  for (const name of ["TRUE MADE WHEY PROTEIN VANILLA ICE CREAM x 930 Grs", "Barra protein bar frutillas a la crema", "Batido de proteína vegana", "Colágeno hidrolizado x 300 gramos", "Ensure Clinical Vainilla 220 ml"])
    assert.deepEqual(inferTaxonomyV69(name, "Nutrición").needs, ["nutricion"]);
  for (const name of ["Isdinceutics Hyaluronic Booster x 5 ampollas", "Ureadin Fusion Melting Cream x 50 ml"])
    assert.equal(reconcileCatalogUsesV69(fixture(name, {
      description: "Sérum hidratante. Actúa sobre las líneas de expresión. Previene el envejecimiento por su contenido en creatina.",
    }))?.needs.includes("nutricion"), false);
});

test("los beneficios estructurados no leen composición ni recomendaciones de otros productos", () => {
  const result = reconcileCatalogUsesV69(fixture("Crema Facial Daily", {
    detail: {
      summary: ["Una crema de uso diario."],
      sections: [
        { id: "beneficios", content: ["Hidrata la piel durante 24 horas."] },
        { id: "composicion", content: ["Retinol, colágeno, ácido hialurónico"] },
        { id: "modo-de-uso", content: ["Después del gel limpiador antimanchas, aplicar protector solar."] },
      ],
    },
  }));
  assert.deepEqual(result?.needs, ["hidratacion"]);
  assert.match(JSON.stringify(result?.audit.selected), /beneficios/);
});

test("no hereda usos sin evidencia y es independiente del snapshot previo", () => {
  const variants = [[], ["limpieza"], ["limpieza", "manchas"], ["nutricion"]];
  for (const needs of variants) {
    const product = fixture("Gel Limpiador Anti-Pigment", { primaryCategory: "limpieza", needs });
    const result = reconcileCatalogUsesV69(product)!;
    assert.deepEqual(result.needs, ["limpieza"]);
    const repeated = reconcileCatalogUsesV69({ ...product, ...result, taxonomy: result.audit });
    assert.equal(repeated, null, "la segunda normalización no vuelve a cambiar el resultado");
  }
  assert.deepEqual(reconcileCatalogUsesV69(fixture("Desodorante Roll On", { needs: ["manchas", "antiedad"] }))?.needs, ["cuidado-diario"]);
});

test("borra el Uso B existente en las cinco categorías de uso único", () => {
  const products = [
    fixture("Gel Limpiador Anti-Pigment", { primaryCategory: "limpieza", needs: ["limpieza", "manchas"] }),
    fixture("Protector Solar Pigment Control", { primaryCategory: "solares", needs: ["solares", "manchas"] }),
    fixture("Shampoo hidratante", { primaryCategory: "capilar", needs: ["capilar", "hidratacion"] }),
    fixture("Suplemento dietario para el cabello x 30 cápsulas", { primaryCategory: "nutricion", needs: ["nutricion", "capilar"] }),
    fixture("Loción perfumada hidratante", { ...fragrance, primaryCategory: "fragancias", needs: ["fragancias", "hidratacion"] }),
  ];
  for (const product of products) {
    const result = reconcileCatalogUsesV69(product)!;
    assert.deepEqual(result.needs, [product.primaryCategory]);
    assert.ok(result.audit.rejected.some((entry) => entry.need === product.needs[1] && entry.reason === "single-use-category"));
    assert.equal(reconcileCatalogUsesV69({ ...product, ...result, taxonomy: result.audit }), null);
  }
});

test("importación, reindexado semanal y normalización diaria aplican la misma regla de uso único", async () => {
  const imported = newProductFromSourceGroupV69({ members: [{
    sourceId: "5930", sourceName: "Gel Limpiador Anti-Pigment x 200 ml", sourceUrl: "https://gpsfarma.com/gel.html",
    imageUrl: "https://gpsfarma.com/media/catalog/product/gel.jpg", sku: "DUAL-1", availability: "available",
    listPrice: 100, offerPrice: 80, discountPercent: 20, savingAmount: 20,
  }], detail: { description: "Limpia el rostro y reduce las manchas de la piel." } }, "2026-10-02T17:00:00.000Z");
  const raw = { version: 6.9, syncedAt: "2026-10-02T17:00:00.000Z", products: [imported] };
  const indexed = reindexCatalogV69(raw);
  const prepared = await prepareCatalogV69Data(raw);
  for (const product of [imported, indexed.products[0], prepared.products[0]]) assert.deepEqual(product.needs, ["limpieza"]);
  assert.equal(prepared.products[0].listPrice, imported.listPrice);
  assert.equal(prepared.products[0].offerPrice, imported.offerPrice);
  assert.equal(prepared.products[0].sku, imported.sku);
  const dto = publicCatalogV69(prepared);
  assert.deepEqual(dto.products[0].needs, ["limpieza"]);
  assert.doesNotMatch(JSON.stringify(dto), /deterministic|evidenceScope|originalNeeds/);
  assert.match(productPageV69(prepared.products[0], [], "http://127.0.0.1:8122"), /<dt>Uso<\/dt><dd>Limpieza<\/dd>/);
  const listing = catalogPageV69(prepared, new URLSearchParams("scope=todo&need=manchas"), "http://127.0.0.1:8122");
  assert.doesNotMatch(listing, /<dt>Uso<\/dt><dd>Limpieza/);
});
