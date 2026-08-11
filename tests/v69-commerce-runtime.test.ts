import assert from "node:assert/strict";
import test from "node:test";
import {
  CommerceRuntimeV69,
  RuntimeHttpErrorV69,
  validateSyncedCatalogV69,
  type SnapshotStoreV69,
} from "../src/commerce-runtime-v69.js";

const ENVIRONMENT = {
  V69_SYNC_ENABLED: "1",
  V69_SYNC_GCS_BUCKET: "test-bucket",
  V69_SYNC_GCS_OBJECT: "snapshots/v69.json",
  V69_SYNC_OIDC_AUDIENCE: "https://preprod.example/internal/catalog-v6-9/refresh",
  V69_SYNC_OIDC_SERVICE_ACCOUNT_EMAIL: "scheduler@example.iam.gserviceaccount.com",
};

test("V6.9 inicia desde el último snapshot verificado", async () => {
  const base = baseCatalog();
  const snapshot = syncedCatalog("2026-08-03T10:00:00.000Z");
  const activated: unknown[] = [];
  const runtime = new CommerceRuntimeV69(ENVIRONMENT, {
    loadBaseCatalog: async () => base,
    activateCatalog: async (catalog) => activated.push(catalog),
    runSync: async () => {
      throw new Error("no debe sincronizar al iniciar");
    },
    snapshotStore: memoryStore(snapshot),
    verifyOidcToken: async () => {},
  });

  await runtime.initialize();

  assert.deepEqual(activated, [base, snapshot]);
  assert.deepEqual(runtime.health(), {
    status: "ready",
    catalogVersion: 6.9,
    products: 1,
    commerceSyncedAt: "2026-08-03T10:00:00.000Z",
    lastSuccessAt: "2026-08-03T10:00:00.000Z",
    lastFailureAt: null,
    syncConfigured: true,
  });
});

test("V6.9 rechaza snapshots con disponibilidad pendiente", () => {
  const valid = syncedCatalog("2026-08-03T10:00:00.000Z");
  assert.equal(validateSyncedCatalogV69(valid), valid);
  assert.throws(
    () =>
      validateSyncedCatalogV69({
        ...valid,
        products: [{ ...valid.products[0], availability: "unknown", availabilityCheckedAt: null }],
        commerceSync: {
          ...valid.commerceSync,
          metrics: {
            ...valid.commerceSync.metrics,
            availabilityCoverage: 0,
            unverified: 1,
          },
        },
      }),
    /umbrales/,
  );
});

test("V6.9 publica antes de activar y conserva last-known-good ante fallas", async () => {
  const current = syncedCatalog("2026-08-03T10:00:00.000Z");
  const next = syncedCatalog("2026-08-04T10:00:00.000Z");
  const events: string[] = [];
  const runtime = new CommerceRuntimeV69(ENVIRONMENT, {
    loadBaseCatalog: async () => baseCatalog(),
    activateCatalog: async (catalog) => {
      if (catalog === next) events.push("activate");
    },
    runSync: async () => next,
    snapshotStore: {
      load: async () => current,
      save: async () => events.push("save"),
    },
    verifyOidcToken: async () => {},
  });
  await runtime.initialize();

  const result = await runtime.refresh("job|2026-08-04T10:00:00Z");
  assert.deepEqual(events, ["save", "activate"]);
  assert.equal(result.status, "updated");

  const duplicate = await runtime.refresh("job|2026-08-04T10:00:00Z");
  assert.equal(duplicate.status, "already_processed");
});

test("V6.9 mantiene cerrado el refresh sin OIDC configurado", async () => {
  const runtime = new CommerceRuntimeV69(
    { ...ENVIRONMENT, V69_SYNC_ENABLED: "0" },
    {
      loadBaseCatalog: async () => baseCatalog(),
      activateCatalog: async () => {},
      runSync: async () => syncedCatalog("2026-08-04T10:00:00.000Z"),
      snapshotStore: memoryStore(null),
      verifyOidcToken: async () => {},
    },
  );
  await assert.rejects(
    runtime.authorizeSchedulerRequest("Bearer token"),
    (error: unknown) => error instanceof RuntimeHttpErrorV69 && error.status === 503,
  );
});

test("V6.9 exige service account y audience OIDC exactos", async () => {
  const calls: unknown[][] = [];
  const runtime = new CommerceRuntimeV69(ENVIRONMENT, {
    loadBaseCatalog: async () => baseCatalog(),
    activateCatalog: async () => {},
    runSync: async () => syncedCatalog("2026-08-04T10:00:00.000Z"),
    snapshotStore: memoryStore(null),
    verifyOidcToken: async (...args) => {
      calls.push(args);
      if (args[0] !== "valid-token") throw new Error("invalid");
    },
  });

  await runtime.authorizeSchedulerRequest("Bearer valid-token");
  assert.deepEqual(calls[0], [
    "valid-token",
    ENVIRONMENT.V69_SYNC_OIDC_AUDIENCE,
    ENVIRONMENT.V69_SYNC_OIDC_SERVICE_ACCOUNT_EMAIL,
  ]);
  await assert.rejects(
    runtime.authorizeSchedulerRequest("Bearer invalid-token"),
    (error: unknown) => error instanceof RuntimeHttpErrorV69 && error.status === 403,
  );
});

function memoryStore(snapshot: unknown | null): SnapshotStoreV69 {
  return { load: async () => snapshot, save: async () => {} };
}

function baseCatalog() {
  return {
    version: 6.9,
    syncedAt: "2026-08-03T09:00:00.000Z",
    totalProducts: 1,
    commerceSyncedAt: null,
    availabilityReferenceAt: null,
    products: [{ publicId: "p1" }],
  };
}

function syncedCatalog(completedAt: string) {
  return {
    version: 6.9,
    syncedAt: "2026-08-03T09:00:00.000Z",
    totalProducts: 1,
    commerceSyncedAt: completedAt,
    availabilityReferenceAt: completedAt,
    products: [
      {
        publicId: "p1",
        availability: "limited",
        availabilityCheckedAt: completedAt,
      },
    ],
    commerceSync: {
      completedAt,
      status: "completed" as const,
      sources: Array.from({ length: 12 }, (_, index) => ({
        id: `source-${index + 1}`,
        status: "completed" as const,
      })),
      metrics: {
        coverage: 1,
        priceCoverage: 1,
        availabilityCoverage: 1,
        unverified: 0,
      },
    },
  };
}
