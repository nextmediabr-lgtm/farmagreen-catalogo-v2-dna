import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CatalogAdminConflictV69,
  createCatalogAdminRuntimeV69,
  createMemoryCatalogAdminStoreV69,
  defaultCatalogAdminDocumentV69,
  defaultCatalogAdminDocumentFromEnvironmentV69,
  verifyCatalogAdminTokenV69,
} from "../src/catalog-admin-v69.js";

const actor = { subject: "admin-1", email: "admin@example.test" };

test("la memoria administrativa versiona, detecta conflictos y permite rollback", async () => {
  let clock = 0;
  const store = createMemoryCatalogAdminStoreV69(defaultCatalogAdminDocumentV69(new Date("2026-08-25T00:00:00Z")));
  const runtime = createCatalogAdminRuntimeV69({}, {
    store,
    now: () => new Date(Date.UTC(2026, 7, 25, 0, 0, clock++)),
    verifyAdminToken: async () => actor,
  });
  const initial = await runtime.current(true);
  const changed = structuredClone(initial.document.policy);
  changed.navigation.featuredBrands[0].enabled = false;
  changed.navigation.umbrella.preserveBrandSlugs = changed.navigation.umbrella.preserveBrandSlugs.filter(
    (slug) => slug !== changed.navigation.featuredBrands[0].slug,
  );
  const saved = await runtime.publishPolicy({
    policy: changed,
    expectedRevision: 0,
    actor,
    summary: "Oculta Aveno de la navegación.",
  });
  assert.equal(saved.document.revision, 1);
  assert.equal(saved.document.policy.navigation.featuredBrands[0].enabled, false);
  assert.equal(saved.document.memory.at(-1)?.type, "navigation");
  assert.equal(saved.document.snapshots[0].revision, 0);

  await assert.rejects(
    runtime.publishPolicy({ policy: changed, expectedRevision: 0, actor, summary: "Conflicto" }),
    CatalogAdminConflictV69,
  );

  const rollback = await runtime.rollback({ targetRevision: 0, expectedRevision: 1, actor });
  assert.equal(rollback.document.revision, 2);
  assert.equal(rollback.document.policy.navigation.featuredBrands[0].enabled, true);
  assert.equal(rollback.document.memory.at(-1)?.type, "rollback");
});

test("la primera configuración migra barcodes legacy sin exponer SKU ni URL", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fg-v69-admin-seed-"));
  const exclusionsPath = path.join(directory, "exclusions.json");
  try {
    await writeFile(exclusionsPath, JSON.stringify({
      products: [{ sku: "PRIVATE", barcode: "3337875694469", url: "https://gpsfarma.com/private.html" }],
      skus: [],
      barcodes: [],
      urls: [],
      hidden: {},
    }));
    const document = await defaultCatalogAdminDocumentFromEnvironmentV69(
      { V69_EXCLUSIONS_FILE: exclusionsPath },
      new Date("2026-08-26T00:00:00Z"),
    );
    assert.deepEqual(document.policy.eanRules.exclude, [{
      ean: "3337875694469",
      note: "Migrado de exclusiones legacy.",
      createdAt: "2026-08-26T00:00:00.000Z",
    }]);
    assert.doesNotMatch(JSON.stringify(document), /PRIVATE|gpsfarma/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("la memoria acepta recibos post-deploy sin habilitar deploy desde el panel", async () => {
  const store = createMemoryCatalogAdminStoreV69(defaultCatalogAdminDocumentV69(new Date("2026-08-25T00:00:00Z")));
  const runtime = createCatalogAdminRuntimeV69({}, { store, verifyAdminToken: async () => actor });
  const saved = await runtime.recordMemory({
    actor: { subject: "codex-agent-manager", email: "codex-agent-manager" },
    type: "deploy",
    summary: "Deploy post-verificado.",
    details: {
      commit: "abc1234",
      revision: "farmagreen-v69-preprod-test",
      healthy: true,
      products: 1459,
    },
  });
  assert.equal(saved.document.memory.at(-1)?.type, "deploy");
  assert.equal(saved.document.memory.at(-1)?.details.healthy, true);
});

test("el token local sólo funciona fuera de producción", async () => {
  assert.deepEqual(
    await verifyCatalogAdminTokenV69("local-secret", {
      NODE_ENV: "test",
      V69_ADMIN_LOCAL_TOKEN: "local-secret",
    }),
    { subject: "local-admin", email: "local-admin" },
  );
  await assert.rejects(
    verifyCatalogAdminTokenV69("local-secret", {
      NODE_ENV: "production",
      V69_ADMIN_LOCAL_TOKEN: "local-secret",
    }),
    /autenticación Google/,
  );
});
