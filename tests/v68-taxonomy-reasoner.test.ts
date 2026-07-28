import assert from "node:assert/strict";
import test from "node:test";
import { catalogV68 } from "../src/render-v68.js";

type TaxonomyDecision = {
  reasonerVersion: string;
  targetPrecision: number;
  evidenceScope: string[];
  excludedEvidence: string[];
  ignoredLineEvidence: string | null;
  originalNeeds: string[];
  selected: Array<{
    need: string;
    confidence: number | null;
    source: string;
    field: string;
    rule: string;
  }>;
  rejected: Array<{ need: string; reason: string }>;
};

test("el razonador V6.8 prioriza precisión y explica cada uso asignado", async () => {
  const catalog = await catalogV68() as Awaited<ReturnType<typeof catalogV68>> & {
    products: Array<Awaited<ReturnType<typeof catalogV68>>["products"][number] & { taxonomy: TaxonomyDecision }>;
    v68Revision: {
      taxonomySummary: {
        reasonerVersion: string;
        targetPrecision: number;
        measuredPrecision: number;
        precisionBasis: string;
        audit: {
          reviewed: number;
          valid: number;
          invalid: number;
          precision: number;
          passes: boolean;
          externalHumanGold: boolean;
        };
        maxNeedsPerProduct: number;
        fallbackProducts: number;
        specificCoverage: number;
        needs: Record<string, number>;
      };
    };
  };

  const summary = catalog.v68Revision.taxonomySummary;
  assert.equal(summary.reasonerVersion, "v68.2-primary-intent");
  assert.equal(summary.targetPrecision, 0.95);
  assert.equal(summary.measuredPrecision, 1);
  assert.equal(summary.precisionBasis, "internal-stratified-audit");
  assert.deepEqual(
    {
      reviewed: summary.audit.reviewed,
      valid: summary.audit.valid,
      invalid: summary.audit.invalid,
      precision: summary.audit.precision,
      passes: summary.audit.passes,
      externalHumanGold: summary.audit.externalHumanGold,
    },
    {
      reviewed: 100,
      valid: 100,
      invalid: 0,
      precision: 1,
      passes: true,
      externalHumanGold: false,
    },
  );
  assert.equal(summary.maxNeedsPerProduct, 2);
  assert.ok(summary.specificCoverage >= 0.9);

  for (const product of catalog.products) {
    assert.ok(product.needs.length >= 1 && product.needs.length <= 2, product.name);
    assert.deepEqual(product.taxonomy.selected.map((entry) => entry.need), product.needs, product.name);
    assert.deepEqual(product.taxonomy.evidenceScope, ["name", "line", "primaryCategory"]);
    assert.deepEqual(product.taxonomy.excludedEvidence, ["description", "instructions", "aliases"]);
    for (const decision of product.taxonomy.selected) {
      assert.ok(["name", "line", "primaryCategory", "fallback"].includes(decision.field), product.name);
      if (decision.source === "fallback") {
        assert.equal(decision.confidence, null, product.name);
      } else {
        assert.ok((decision.confidence || 0) >= 0.95, `${product.name}: ${decision.need}`);
      }
    }
  }

  const fallbackProducts = catalog.products.filter((product) =>
    product.taxonomy.selected.some((entry) => entry.source === "fallback")
  ).length;
  assert.equal(summary.fallbackProducts, fallbackProducts);
  assert.equal(summary.specificCoverage, (catalog.products.length - fallbackProducts) / catalog.products.length);
  for (const [need, count] of Object.entries(summary.needs)) {
    assert.equal(catalog.products.filter((product) => product.needs.includes(need)).length, count, need);
  }
});

test("las guardas sistémicas resuelven los casos reportados sin excepciones por producto", async () => {
  const catalog = await catalogV68() as Awaited<ReturnType<typeof catalogV68>> & {
    products: Array<Awaited<ReturnType<typeof catalogV68>>["products"][number] & { taxonomy: TaxonomyDecision }>;
  };

  const nutrition = catalog.products.filter((product) => product.primaryCategory === "nutricion");
  assert.ok(nutrition.length > 0);
  assert.ok(nutrition.every((product) => product.needs.length === 1 && product.needs[0] === "nutricion"));

  const solar = catalog.products.filter((product) => product.primaryCategory === "solares");
  assert.ok(solar.length > 0);
  assert.ok(solar.every((product) => product.needs.length === 1 && product.needs[0] === "solares"));

  const productsSaludables = catalog.products.filter((product) => product.brand.name === "Productos Saludables");
  assert.ok(productsSaludables.every((product) => product.needs.length === 1 && product.needs[0] === "nutricion"));

  const isdinSolar = catalog.products.find((product) => product.publicId === "dd21b4445e9e");
  assert.ok(isdinSolar);
  assert.deepEqual(isdinSolar.needs, ["solares"]);
  assert.ok(isdinSolar.taxonomy.rejected.some((entry) => entry.need === "acne" && entry.reason === "dominant-category"));

  for (const id of ["8ccf3dee33ca", "799f3cc544e2", "3d3af11348db"]) {
    const glicoisdin = catalog.products.find((product) => product.publicId === id);
    assert.ok(glicoisdin);
    assert.deepEqual(glicoisdin.needs, ["cuidado-diario"]);
    assert.equal(glicoisdin.taxonomy.selected[0]?.source, "fallback");
  }

  const dermaglosAntiedad = catalog.products.filter(
    (product) => product.brand.name === "Dermaglos" && product.needs.includes("antiedad"),
  );
  assert.equal(dermaglosAntiedad.length, 11);
  assert.ok(dermaglosAntiedad.every((product) =>
    product.taxonomy.selected.some((entry) => entry.need === "antiedad" && entry.confidence !== null && entry.confidence >= 0.95)
  ));

  const aquaphor = catalog.products.find((product) =>
    product.name.startsWith("Pomada reparadora Eucerin Aquaphor")
  );
  assert.ok(aquaphor);
  assert.deepEqual(aquaphor.needs, ["hidratacion", "reparacion"]);
  assert.ok(aquaphor.taxonomy.rejected.some((entry) =>
    entry.need === "piel-sensible" && entry.reason === "insufficient-strong-evidence"
  ));

  const atopiControl = catalog.products.find((product) =>
    product.name.startsWith("Bálsamo corporal de uso diario Eucerin AtopiControl")
  );
  assert.ok(atopiControl);
  assert.deepEqual(atopiControl.needs, ["piel-sensible"]);
  assert.equal(atopiControl.taxonomy.ignoredLineEvidence, "composite-line-label");

  const hyalluronicTypo = catalog.products.find((product) =>
    product.name === "Serum Hyalluronic Concentrate x 30 ml"
  );
  assert.ok(hyalluronicTypo);
  assert.ok(hyalluronicTypo.needs.includes("hidratacion"));

  const liftactivTypo = catalog.products.find((product) =>
    product.name === "Serum Facial Vichy LifActiv Vitamina C x 20 ml"
  );
  assert.ok(liftactivTypo);
  assert.ok(liftactivTypo.needs.includes("antiedad"));

  const oilyHyaluronFiller = catalog.products.find((product) =>
    product.name.startsWith("Gel facial Ultra-Light Eucerin Hyaluron-Filler")
  );
  assert.ok(oilyHyaluronFiller);
  assert.deepEqual(oilyHyaluronFiller.needs, ["antiedad"]);
});
