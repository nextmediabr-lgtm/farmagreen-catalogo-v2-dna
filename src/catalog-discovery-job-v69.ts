import { catalogV69Data } from "./data-v69.js";
import {
  createGcsSnapshotStoreV69,
  validateSyncedCatalogV69,
  type RuntimeEnvironmentV69,
  type SnapshotStoreV69,
  type SyncedCatalogV69,
} from "./commerce-runtime-v69.js";
import { createCatalogAdminRuntimeV69 } from "./catalog-admin-v69.js";

type DiscoveryJobDependenciesV69 = {
  snapshotStore: SnapshotStoreV69;
  loadFallbackCatalog: () => Promise<unknown>;
  scanCatalog: (baseCatalog: unknown) => Promise<{ catalog: unknown; discoverySync: unknown }>;
  finalizeCatalog: (catalog: unknown) => Promise<{ catalog: unknown; discoverySync: unknown }>;
  validateCatalog: (catalog: unknown) => SyncedCatalogV69;
};

export async function runCatalogDiscoveryJobV69(
  dependencies: DiscoveryJobDependenciesV69,
) {
  const previous = await dependencies.snapshotStore.load();
  const baseCatalog = previous || (await dependencies.loadFallbackCatalog());
  const scanned = await dependencies.scanCatalog(baseCatalog);
  const finalized = await dependencies.finalizeCatalog(scanned.catalog);
  const snapshot = dependencies.validateCatalog(finalized.catalog);
  await dependencies.snapshotStore.save(snapshot);
  return {
    products: snapshot.products.length,
    commerceSyncedAt: snapshot.commerceSync.completedAt,
    discoverySync: snapshot.discoverySync,
  };
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
    loadFallbackCatalog: () => catalogV69Data(environment as NodeJS.ProcessEnv),
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
    validateCatalog: (catalog) => validateSyncedCatalogV69(catalog),
  };
}

async function main() {
  const dependencies = await defaultDependencies(process.env);
  const result = await runCatalogDiscoveryJobV69(dependencies);
  process.stdout.write(
    JSON.stringify({
      status: "updated",
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
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write("[v69-weekly-job] " + message + "\n");
    process.exitCode = 1;
  });
}
