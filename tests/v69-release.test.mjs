import assert from "node:assert/strict";
import test from "node:test";
import { assertReleaseV69 } from "../scripts/verify-release-v69.mjs";

function fixture() {
  const image = `registry/image@sha256:${"a".repeat(64)}`;
  const commit = "c".repeat(40);
  return { commit, jobName: "weekly", service: { status: { conditions: [{ type: "Ready", status: "True" }], traffic: [{ percent: 100, revisionName: "web-new" }] } },
    revision: { metadata: { name: "web-new", creationTimestamp: "2026-09-19T20:00:00Z" }, status: { imageDigest: image } },
    job: { spec: { template: { spec: { template: { spec: { containers: [{ image }] } } } } } },
    execution: { metadata: { labels: { "run.googleapis.com/job": "weekly" } }, spec: { template: { spec: { containers: [{ image }] } } }, status: { conditions: [{ type: "Completed", status: "True" }], completionTime: "2026-09-19T21:00:00Z" } },
    health: { status: "ready", storefrontUsable: true, totalProducts: 1, offers: 0, navigationPolicy: { revision: 9 }, availabilitySummary: { unverified: 0 }, runtime: { status: "ready", codeRevision: commit } },
    api: { products: [{ publicId: "public-one" }] }, home: '<article class="v66-card">Producto</article>', pdp: "public-one",
  };
}

test("gate postdeploy verifica código, imagen, home, DTO, PDP, política y ejecución real", () => {
  assert.equal(assertReleaseV69(fixture()).status, "verified");
});

test("un Job configurado no encubre una ejecución exitosa con otra imagen", () => {
  const f = fixture();
  f.execution.spec.template.spec.containers[0].image = `registry/image@sha256:${"b".repeat(64)}`;
  assert.throws(() => assertReleaseV69(f), /imagen anterior/);
  f.execution.spec.template.spec.containers[0].image = f.job.spec.template.spec.template.spec.containers[0].image;
  f.execution.status.conditions[0].status = "Unknown";
  assert.throws(() => assertReleaseV69(f), /no terminó/);
});

test("no se acepta una home vacía aunque health responda ready", () => {
  assert.throws(() => assertReleaseV69({ ...fixture(), home: "<h1>Ofertas</h1>" }));
  const f = fixture(); f.health.runtime.codeRevision = "d".repeat(40);
  assert.throws(() => assertReleaseV69(f), /commit esperado/);
});
