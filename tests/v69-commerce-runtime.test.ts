import assert from "node:assert/strict";
import test from "node:test";
import {
  CommerceRuntimeV69,
  RuntimeHttpErrorV69,
  validateSyncedCatalogV69,
  type SnapshotStoreV69,
} from "../src/commerce-runtime-v69.js";
import { runCatalogDiscoveryJobV69 } from "../src/catalog-discovery-job-v69.js";

const ENVIRONMENT = {
  V69_SYNC_ENABLED: "1",
  V69_SYNC_GCS_BUCKET: "test-bucket",
  V69_SYNC_GCS_OBJECT: "snapshots/v69.json",
  V69_SYNC_OIDC_AUDIENCE: "https://preprod.example/internal/catalog-v6-9/refresh",
  V69_SYNC_OIDC_SERVICE_ACCOUNT_EMAIL: "scheduler@example.iam.gserviceaccount.com",
};

const DISCOVERY_ENVIRONMENT = {
  ...ENVIRONMENT,
  V69_DISCOVERY_SCHEDULER_JOB: "fg-v69-weekly-discovery",
  V69_IMAGE_GCS_BUCKET: "farmagreen-images",
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
    discoveryConfigured: false,
    lastDiscoveryAt: null,
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

test("el job semanal ejecuta discovery y el cron diario conserva el sync comercial", async () => {
  const current = syncedCatalog("2026-08-24T10:00:00.000Z");
  const weekly = discoveredCatalog("2026-08-25T03:00:00.000Z");
  const calls: string[] = [];
  const runtime = new CommerceRuntimeV69(DISCOVERY_ENVIRONMENT, {
    loadBaseCatalog: async () => baseCatalog(),
    activateCatalog: async () => {},
    runSync: async () => {
      calls.push("commerce");
      return syncedCatalog("2026-08-25T14:00:00.000Z");
    },
    runDiscovery: async () => {
      calls.push("discovery");
      return weekly;
    },
    snapshotStore: memoryStore(current),
    verifyOidcToken: async () => {},
  });
  await runtime.initialize();

  const scan = await runtime.refresh("fg-v69-weekly-discovery|2026-08-25T03:00:00Z");
  assert.equal(scan.mode, "discovery");
  assert.deepEqual(calls, ["discovery"]);
  assert.equal(runtime.health().lastDiscoveryAt, "2026-08-25T03:00:00.000Z");
  assert.equal(runtime.health().discoveryConfigured, true);

  const commerce = await runtime.refresh("fg-v69-preprod-sync-0700-art|2026-08-25T14:00:00Z");
  assert.equal(commerce.mode, "commerce");
  assert.deepEqual(calls, ["discovery", "commerce"]);
});

test("V6.9 rechaza un snapshot semanal sin índices y assets completos", () => {
  const candidate = discoveredCatalog("2026-08-25T03:00:00.000Z");
  assert.equal(validateSyncedCatalogV69(candidate), candidate);
  assert.throws(
    () => validateSyncedCatalogV69({
      ...candidate,
      discoverySync: { ...candidate.discoverySync, activationReady: false },
    }),
    /semanal V6.9 incompleto/,
  );
});

test("el Cloud Run Job guarda sólo un candidato semanal finalizado y válido", async () => {
  const current = syncedCatalog("2026-08-24T10:00:00.000Z");
  const weekly = discoveredCatalog("2026-08-25T03:00:00.000Z");
  const saved: unknown[] = [];
  const result = await runCatalogDiscoveryJobV69({
    snapshotStore: {
      load: async () => current,
      save: async (catalog) => saved.push(catalog),
    },
    loadFallbackCatalog: async () => {
      throw new Error("no debe usar fallback cuando existe snapshot");
    },
    scanCatalog: async (base) => {
      assert.equal(base, current);
      return { catalog: { stage: "scanned" }, discoverySync: {} };
    },
    finalizeCatalog: async (catalog) => {
      assert.deepEqual(catalog, { stage: "scanned" });
      return { catalog: weekly, discoverySync: weekly.discoverySync };
    },
    validateCatalog: validateSyncedCatalogV69,
  });
  assert.deepEqual(saved, [weekly]);
  assert.equal(result.products, 1);

  await assert.rejects(
    runCatalogDiscoveryJobV69({
      snapshotStore: {
        load: async () => current,
        save: async (catalog) => saved.push(catalog),
      },
      loadFallbackCatalog: async () => current,
      scanCatalog: async () => ({ catalog: { stage: "scanned" }, discoverySync: {} }),
      finalizeCatalog: async () => {
        throw new Error("falló preparación");
      },
      validateCatalog: validateSyncedCatalogV69,
    }),
    /falló preparación/,
  );
  assert.deepEqual(saved, [weekly]);
});

test("el refresh comercial adopta primero el snapshot creado por el Job semanal", async () => {
  const current = syncedCatalog("2026-08-24T10:00:00.000Z");
  const weekly = discoveredCatalog("2026-08-25T03:00:00.000Z");
  const next = syncedCatalog("2026-08-25T07:00:00.000Z");
  let loads = 0;
  let syncBase: unknown = null;
  const activated: unknown[] = [];
  const runtime = new CommerceRuntimeV69(ENVIRONMENT, {
    loadBaseCatalog: async () => baseCatalog(),
    activateCatalog: async (catalog) => activated.push(catalog),
    runSync: async (base) => {
      syncBase = base;
      return next;
    },
    snapshotStore: {
      load: async () => {
        loads += 1;
        return loads === 1 ? current : weekly;
      },
      save: async () => {},
    },
    verifyOidcToken: async () => {},
  });
  await runtime.initialize();
  const result = await runtime.refresh("fg-v69-preprod-sync-0700-art|2026-08-25T07:00:00Z");
  assert.equal(syncBase, weekly);
  assert.equal(result.mode, "commerce");
  assert.equal(runtime.health().lastDiscoveryAt, "2026-08-25T03:00:00.000Z");
  assert.ok(activated.includes(weekly));
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
      sources: Array.from({ length: 16 }, (_, index) => ({
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

function discoveredCatalog(completedAt: string) {
  return {
    ...syncedCatalog(completedAt),
    discoverySync: {
      completedAt,
      status: "completed" as const,
      activationReady: true as const,
      searchIndexedAt: completedAt,
      needsIndexedAt: completedAt,
      taxonomyIndexedAt: completedAt,
      imagesPreparedAt: completedAt,
    },
  };
}
