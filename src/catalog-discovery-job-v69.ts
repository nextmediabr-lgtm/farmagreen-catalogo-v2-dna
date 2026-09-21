import { loadBaseCatalogV69 } from "./data-v69.js";
import {
  createGcsSnapshotStoreV69,
  validateSyncedCatalogV69,
  type RuntimeEnvironmentV69,
  type SnapshotStoreV69,
  type SyncedCatalogV69,
  syncFailureV69,
  alreadyPublishedV69,
} from "./commerce-runtime-v69.js";
import { preparePublicationV69, assertCatalogTransitionV69 } from "./catalog-validation-v69.js";
import { createCatalogAdminRuntimeV69 } from "./catalog-admin-v69.js";

type DiscoveryJobDependenciesV69 = {
  snapshotStore: SnapshotStoreV69;
  loadFallbackCatalog: () => Promise<unknown>;
  scanCatalog: (baseCatalog: unknown) => Promise<{ catalog: unknown; discoverySync: unknown }>;
  finalizeCatalog: (catalog: unknown) => Promise<{ catalog: unknown; discoverySync: unknown }>;
  validateCatalog: (catalog: unknown) => SyncedCatalogV69 | Promise<SyncedCatalogV69>;
  environment?: RuntimeEnvironmentV69;
};

export async function runCatalogDiscoveryJobV69(
  dependencies: DiscoveryJobDependenciesV69,
) {
  const execution = dependencies.environment?.CLOUD_RUN_EXECUTION || "";
  const key = execution ? `weekly|${execution}` : "";
  let phase = "load_snapshot";
  let candidate: unknown;
  try {
    const loaded = await dependencies.snapshotStore.loadVersioned?.();
    const previous = loaded ? loaded.catalog : await dependencies.snapshotStore.load();
    const baseCatalog = previous || (await dependencies.loadFallbackCatalog());
    let snapshot: SyncedCatalogV69;
    const duplicate = alreadyPublishedV69(previous, key);
    if (duplicate) snapshot = await dependencies.validateCatalog(previous);
    else {
      if (key && await dependencies.snapshotStore.wasRejected?.(key)) {
        throw new Error("Ejecución semanal ya rechazada; no se repite el scan.");
      }
      phase = "crawl";
      const scanned = await dependencies.scanCatalog(baseCatalog);
      phase = "finalize_assets_taxonomy";
      const finalized = await dependencies.finalizeCatalog(scanned.catalog);
      candidate = finalized.catalog;
      phase = "validate";
      snapshot = await dependencies.validateCatalog(candidate);
      assertCatalogTransitionV69(baseCatalog, snapshot);
      phase = "publish";
      await dependencies.snapshotStore.save(snapshot, loaded?.generation, key);
    }
    return {
      status: duplicate ? "already_processed" : "updated",
      products: snapshot.products.length,
      commerceSyncedAt: snapshot.commerceSync.completedAt,
      discoverySync: snapshot.discoverySync,
    };
  } catch (error) {
    const failure = syncFailureV69(error, phase, execution || "local", dependencies.environment?.V69_CODE_REVISION);
    if (key && !failure.retryable) {
      await dependencies.snapshotStore.recordRejection?.(key, failure, candidate).catch((receiptError) => {
        process.stderr.write(JSON.stringify(syncFailureV69(receiptError, "record_failure", execution, dependencies.environment?.V69_CODE_REVISION)) + "\n");
      });
    }
    throw new DiscoveryJobFailureV69(failure, error);
  }
}

export class DiscoveryJobFailureV69 extends Error {
  constructor(readonly failure: ReturnType<typeof syncFailureV69>, cause: unknown) {
    super(`Fallo semanal en ${failure.phase}: ${failure.causes[0]?.message || "sin detalle"}`, { cause });
  }
}

async function defaultDependencies(
  environment: RuntimeEnvironmentV69,
): Promise<DiscoveryJobDependenciesV69> {
  const snapshotStore = createGcsSnapshotStoreV69(environment);
  if (!snapshotStore) throw new Error("El Job semanal V6.9 no tiene snapshot GCS configurado.");
  const adminRuntime = createCatalogAdminRuntimeV69(environment);
  // @ts-expect-error El módulo MJS forma parte de la imagen y tiene pruebas propias.
  const scanner = await import("../scripts/scan-catalog-v69.mjs");
  return {
    snapshotStore,
    environment,
    loadFallbackCatalog: () => loadBaseCatalogV69(environment as NodeJS.ProcessEnv),
    scanCatalog: (baseCatalog) =>
      adminRuntime.policy().then((policy) => scanner.runCatalogDiscoveryV69({
        providedBaseCatalog: baseCatalog,
        providedPolicy: policy,
      })),
    finalizeCatalog: (catalog) =>
      scanner.finalizeCatalogDiscoveryV69({
        catalog,
        environment,
      }),
    validateCatalog: async (catalog) => {
      const snapshot = validateSyncedCatalogV69(catalog);
      await preparePublicationV69(snapshot, environment);
      return snapshot;
    },
  };
}

async function main() {
  const dependencies = await defaultDependencies(process.env);
  const result = await runCatalogDiscoveryJobV69(dependencies);
  process.stdout.write(
    JSON.stringify({
      event: "catalog_sync_completed",
      severity: "INFO",
      runId: process.env.CLOUD_RUN_EXECUTION || "local",
      codeRevision: process.env.V69_CODE_REVISION || "unknown",
      mode: "discovery",
      status: result.status,
      products: result.products,
      commerceSyncedAt: result.commerceSyncedAt,
      discoveryCompletedAt: result.discoverySync?.completedAt || null,
      metrics: result.discoverySync && "metrics" in result.discoverySync
        ? result.discoverySync.metrics
        : {},
    }) + "\n",
  );
}

if (process.argv[1]?.endsWith("catalog-discovery-job-v69.js")) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify(error instanceof DiscoveryJobFailureV69 ? error.failure : syncFailureV69(error, "initialize", process.env.CLOUD_RUN_EXECUTION || "local", process.env.V69_CODE_REVISION)) + "\n");
    process.exitCode = 1;
  });
}
