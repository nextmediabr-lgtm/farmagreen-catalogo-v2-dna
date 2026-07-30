import assert from "node:assert/strict";
import test from "node:test";
import {
  CommerceRuntimeV68,
  RuntimeHttpErrorV68,
  validateSyncedCatalogV68,
  type SnapshotStoreV68,
} from "../src/commerce-runtime-v68.js";

const ENVIRONMENT = {
  V68_SYNC_ENABLED: "1",
  V68_SYNC_GCS_BUCKET: "test-bucket",
  V68_SYNC_GCS_OBJECT: "snapshots/v68.json",
  V68_SYNC_OIDC_AUDIENCE: "https://preprod.example/internal/catalog-v6-8/refresh",
  V68_SYNC_OIDC_SERVICE_ACCOUNT_EMAIL: "scheduler@example.iam.gserviceaccount.com",
};

test("inicializa desde el último snapshot sano sin red ni GCP", async () => {
  const base = baseCatalog();
  const snapshot = syncedCatalog("2026-07-30T08:00:00.000Z");
  const activated: unknown[] = [];
  const runtime = new CommerceRuntimeV68(ENVIRONMENT, {
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
    catalogVersion: 6.8,
    products: 1,
    commerceSyncedAt: "2026-07-30T08:00:00.000Z",
    lastSuccessAt: "2026-07-30T08:00:00.000Z",
    lastFailureAt: null,
    syncConfigured: true,
  });
});

test("el refresh permanece cerrado sin habilitación explícita", async () => {
  const runtime = new CommerceRuntimeV68(
    { ...ENVIRONMENT, V68_SYNC_ENABLED: "0" },
    {
      loadBaseCatalog: async () => baseCatalog(),
      activateCatalog: async () => {},
      runSync: async () => syncedCatalog("2026-07-31T08:00:00.000Z"),
      snapshotStore: memoryStore(null),
      verifyOidcToken: async () => {},
    },
  );

  assert.equal(runtime.syncConfigured, false);
  await assert.rejects(
    runtime.authorizeSchedulerRequest("Bearer valid-token"),
    (error: unknown) => error instanceof RuntimeHttpErrorV68 && error.status === 503,
  );
});

test("publica GCS antes de activar y colapsa refresh concurrentes", async () => {
  const current = syncedCatalog("2026-07-30T08:00:00.000Z");
  const next = syncedCatalog("2026-07-31T08:00:00.000Z");
  const events: string[] = [];
  let resolveSync!: (value: unknown) => void;
  let runs = 0;
  const syncResult = new Promise<unknown>((resolve) => {
    resolveSync = resolve;
  });
  const store: SnapshotStoreV68 = {
    load: async () => current,
    save: async () => {
      events.push("save");
    },
  };
  const runtime = new CommerceRuntimeV68(ENVIRONMENT, {
    loadBaseCatalog: async () => baseCatalog(),
    activateCatalog: async (catalog) => {
      if (catalog === next) events.push("activate");
    },
    runSync: async () => {
      runs += 1;
      return syncResult;
    },
    snapshotStore: store,
    verifyOidcToken: async () => {},
  });
  await runtime.initialize();

  const first = runtime.refresh("job|2026-07-31T08:00:00Z");
  const second = runtime.refresh("job|2026-07-31T08:00:00Z");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  assert.equal(runtime.health().status, "refreshing");

  resolveSync(next);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(events, ["save", "activate"]);
  assert.equal(firstResult.status, "updated");
  assert.equal(firstResult.reused, false);
  assert.equal(secondResult.status, "updated");
  assert.equal(secondResult.reused, true);

  const duplicate = await runtime.refresh("job|2026-07-31T08:00:00Z");
  assert.equal(duplicate.status, "already_processed");
  assert.equal(runs, 1);
});

test("una falla de publicación conserva last-known-good", async () => {
  const current = syncedCatalog("2026-07-30T08:00:00.000Z");
  const next = syncedCatalog("2026-07-31T08:00:00.000Z");
  const activated: unknown[] = [];
  const runtime = new CommerceRuntimeV68(ENVIRONMENT, {
    loadBaseCatalog: async () => baseCatalog(),
    activateCatalog: async (catalog) => activated.push(catalog),
    runSync: async () => next,
    snapshotStore: {
      load: async () => current,
      save: async () => {
        throw new Error("GCS indisponible");
      },
    },
    verifyOidcToken: async () => {},
    now: () => new Date("2026-07-31T08:01:00.000Z"),
  });
  await runtime.initialize();
  const activationsBeforeRefresh = activated.length;

  await assert.rejects(
    runtime.refresh("failure"),
    (error: unknown) =>
      error instanceof RuntimeHttpErrorV68 &&
      error.status === 502 &&
      /verificación/.test(error.message),
  );

  assert.equal(activated.length, activationsBeforeRefresh);
  assert.equal(runtime.health().status, "degraded");
  assert.equal(runtime.health().commerceSyncedAt, "2026-07-30T08:00:00.000Z");
  assert.equal(runtime.health().lastFailureAt, "2026-07-31T08:01:00.000Z");
});

test("OIDC exige audience y service account exactos", async () => {
  const calls: unknown[][] = [];
  const runtime = new CommerceRuntimeV68(ENVIRONMENT, {
    loadBaseCatalog: async () => baseCatalog(),
    activateCatalog: async () => {},
    runSync: async () => syncedCatalog("2026-07-31T08:00:00.000Z"),
    snapshotStore: memoryStore(null),
    verifyOidcToken: async (...args) => {
      calls.push(args);
      if (args[0] !== "valid-token") throw new Error("invalid");
    },
  });

  await runtime.authorizeSchedulerRequest("Bearer valid-token");
  assert.deepEqual(calls[0], [
    "valid-token",
    ENVIRONMENT.V68_SYNC_OIDC_AUDIENCE,
    ENVIRONMENT.V68_SYNC_OIDC_SERVICE_ACCOUNT_EMAIL,
  ]);
  await assert.rejects(
    runtime.authorizeSchedulerRequest("Bearer invalid-token"),
    (error: unknown) => error instanceof RuntimeHttpErrorV68 && error.status === 403,
  );
  await assert.rejects(
    runtime.authorizeSchedulerRequest(undefined),
    (error: unknown) => error instanceof RuntimeHttpErrorV68 && error.status === 401,
  );
});

test("rechaza snapshots incompletos o debajo de 95/95", () => {
  const valid = syncedCatalog("2026-07-30T08:00:00.000Z");
  assert.equal(validateSyncedCatalogV68(valid), valid);
  assert.throws(
    () =>
      validateSyncedCatalogV68({
        ...valid,
        commerceSync: {
          ...valid.commerceSync,
          sources: valid.commerceSync.sources.slice(0, 10),
        },
      }),
    /incompleto/,
  );
  assert.throws(
    () =>
      validateSyncedCatalogV68({
        ...valid,
        commerceSync: {
          ...valid.commerceSync,
          metrics: { coverage: 0.949, priceCoverage: 1 },
        },
      }),
    /umbrales/,
  );
});

function memoryStore(snapshot: unknown | null): SnapshotStoreV68 {
  return {
    load: async () => snapshot,
    save: async () => {},
  };
}

function baseCatalog() {
  return {
    version: 6.8,
    syncedAt: "2026-07-25T06:39:05.518Z",
    totalProducts: 1,
    products: [{ publicId: "p1" }],
  };
}

function syncedCatalog(completedAt: string) {
  return {
    ...baseCatalog(),
    commerceSyncedAt: completedAt,
    commerceSync: {
      completedAt,
      status: "completed" as const,
      sources: Array.from({ length: 11 }, (_, index) => ({
        id: `source-${index + 1}`,
        status: "completed" as const,
      })),
      metrics: {
        coverage: 0.99,
        priceCoverage: 0.99,
      },
    },
  };
}
