import assert from "node:assert/strict";
import test from "node:test";
import { catalogV68, productPageV68 } from "../src/render-v68.js";

type DetailSection = {
  id: string;
  title: string;
  kind: "text" | "list" | "steps";
  content: string[];
};

type V68Product = Awaited<ReturnType<typeof catalogV68>>["products"][number] & {
  detail: { summary: string[]; sections: DetailSection[] };
  source: {
    url: string | null;
    descriptionStatus: string;
    extractionStatus: string;
    contentQuality: "structured" | "metadata-only" | "pending";
    qualityReason: string | null;
    normalizations: string[];
  };
};

test("V6.8 conserva el texto fuente pero elimina ruido corporativo y metadatos de depósito", async () => {
  const catalog = await catalogV68() as Awaited<ReturnType<typeof catalogV68>> & {
    products: V68Product[];
    v68Revision: {
      normalizationSummary: Record<string, number>;
      traceability: { sourceUrls: number; directSourceUrls: number };
    };
  };

  assert.equal(catalog.v68Revision.normalizationSummary.corporateBoilerplateRemoved, 73);
  assert.equal(catalog.v68Revision.normalizationSummary.duplicatePresentationRemoved, 73);
  assert.equal(catalog.v68Revision.normalizationSummary.metadataOnly, 15);
  assert.equal(catalog.v68Revision.normalizationSummary.pending, 3);
  assert.equal(catalog.v68Revision.normalizationSummary.structured, 670);
  assert.equal(catalog.v68Revision.traceability.sourceUrls, 395);
  assert.equal(catalog.v68Revision.traceability.directSourceUrls, 394);

  const metadataOnly = catalog.products.filter((product) => product.source.contentQuality === "metadata-only");
  const pending = catalog.products.filter((product) => product.source.contentQuality === "pending");
  assert.equal(metadataOnly.length, 15);
  assert.equal(pending.length, 3);
  assert.ok(metadataOnly.every((product) =>
    product.description === "La ficha todavía no incluye una descripción ampliada de este producto."
  ));
  assert.ok(pending.every((product) =>
    product.description === "Información detallada pendiente de publicación."
  ));

  for (const product of catalog.products) {
    assert.doesNotMatch(product.description, /Somos una de las empresas líderes/i, product.name);
    assert.doesNotMatch(product.description, /#html-body|data-pb-style|\{justify-content/i, product.name);
    assert.doesNotMatch(
      product.description,
      /^(?:INFORMACI[ÓO]N DEL PRODUCTO|BENEFICIOS|COMPOSICI[ÓO]N|MODO DE USO|PRESENTACI[ÓO]N)\b/,
      product.name,
    );
    assert.ok(Array.isArray(product.detail.summary), product.name);
    assert.ok(Array.isArray(product.detail.sections), product.name);
    assert.ok(
      product.detail.sections.every((section) => !["presentacion", "cantidad"].includes(section.id)),
      product.name,
    );
  }
});

test("V6.8 transforma encabezados de origen en jerarquía semántica sin inventar contenido", async () => {
  const catalog = await catalogV68() as Awaited<ReturnType<typeof catalogV68>> & { products: V68Product[] };
  const product = catalog.products.find((item) => item.publicId === "406a621c346c");
  assert.ok(product);
  assert.deepEqual(
    product.detail.sections.map((section) => [section.id, section.kind]),
    [
      ["beneficios", "list"],
      ["composicion", "text"],
      ["modo-de-uso", "steps"],
    ],
  );
  assert.equal(product.detail.sections.find((section) => section.id === "beneficios")?.content.length, 5);
  assert.equal(product.detail.sections.find((section) => section.id === "modo-de-uso")?.content.length, 4);
  assert.ok(product.source.normalizations.includes("structured-sections"));

  const normalizedCorporateCopy = catalog.products.find((item) => item.publicId === "fcbd59a2511f");
  assert.ok(normalizedCorporateCopy);
  assert.ok(normalizedCorporateCopy.source.normalizations.includes("removed-corporate-boilerplate"));
  assert.ok(normalizedCorporateCopy.source.normalizations.includes("removed-duplicate-presentation"));

  const html = productPageV68(product, [], "http://127.0.0.1:8100");
  assert.match(html, /<h3>Beneficios<\/h3><ul>/);
  assert.match(html, /<h3>Composición<\/h3><p>/);
  assert.match(html, /<h3>Modo de uso<\/h3><ol>/);
  assert.doesNotMatch(html, /Somos una de las empresas líderes/i);
  assert.doesNotMatch(html, />Presentación<\/h3>/i);
});
