import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import test from "node:test";
import { catalogV68 } from "../src/render-v68.js";

type AuditLabel = {
  publicId: string;
  need: string;
  valid: boolean;
};

test("la precisión V6.8 se mide sobre una muestra estratificada reproducible", async () => {
  const audit = JSON.parse(
    await fs.readFile(new URL("../data/v68-taxonomy-audit.json", import.meta.url), "utf8"),
  ) as {
    seed: string;
    samplePerNeed: number;
    needs: string[];
    review: {
      ambiguousCountsAsInvalid: boolean;
      externalHumanGold: boolean;
    };
    labels: AuditLabel[];
  };
  const catalog = await catalogV68() as Awaited<ReturnType<typeof catalogV68>> & {
    products: Array<Awaited<ReturnType<typeof catalogV68>>["products"][number] & {
      taxonomy: {
        selected: Array<{ need: string; source: string }>;
      };
    }>;
    v68Revision: {
      taxonomySummary: {
        targetPrecision: number;
        measuredPrecision: number;
        audit: {
          reviewed: number;
          valid: number;
          invalid: number;
          passes: boolean;
        };
      };
    };
  };

  const expectedLabels = audit.needs.flatMap((need) =>
    catalog.products
      .filter((product) =>
        product.taxonomy.selected.some((entry) => entry.need === need && entry.source !== "fallback")
      )
      .map((product) => ({ publicId: product.publicId, need }))
      .sort((left, right) => {
        const rank = (entry: { publicId: string; need: string }) =>
          createHash("sha256")
            .update(`${audit.seed}|${entry.publicId}|${entry.need}`)
            .digest("hex");
        return rank(left).localeCompare(rank(right));
      })
      .slice(0, audit.samplePerNeed),
  );

  const keyFor = (entry: { publicId: string; need: string }) =>
    `${entry.publicId}|${entry.need}`;
  assert.deepEqual(audit.labels.map(keyFor), expectedLabels.map(keyFor));
  assert.equal(new Set(audit.labels.map(keyFor)).size, audit.labels.length);
  assert.equal(audit.review.ambiguousCountsAsInvalid, true);
  assert.equal(audit.review.externalHumanGold, false);

  for (const label of audit.labels) {
    const product = catalog.products.find((entry) => entry.publicId === label.publicId);
    assert.ok(product, label.publicId);
    assert.ok(
      product.taxonomy.selected.some((entry) => entry.need === label.need && entry.source !== "fallback"),
      `${product.name}: ${label.need}`,
    );
  }

  const valid = audit.labels.filter((entry) => entry.valid).length;
  const precision = valid / audit.labels.length;
  const summary = catalog.v68Revision.taxonomySummary;
  assert.equal(audit.labels.length, 100);
  assert.equal(summary.audit.reviewed, audit.labels.length);
  assert.equal(summary.audit.valid, valid);
  assert.equal(summary.audit.invalid, audit.labels.length - valid);
  assert.equal(summary.measuredPrecision, precision);
  assert.equal(summary.audit.passes, precision >= summary.targetPrecision);
  assert.ok(precision >= 0.95);
});
