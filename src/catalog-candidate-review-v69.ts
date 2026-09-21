import fs from "node:fs/promises";
import { createGcsSnapshotStoreV69, validateSyncedCatalogV69, type SnapshotStoreV69, type RuntimeEnvironmentV69 } from "./commerce-runtime-v69.js";
import { assertCatalogTransitionV69, candidateDigestV69, preparePublicationV69 } from "./catalog-validation-v69.js";
import { SnapshotConflictV69 } from "./catalog-snapshot-store-v69.js";

// Manual operator path, never called by either cron or by the admin panel.
// Preview is read-only. Publishing requires the exact reviewed digest AND the
// generation observed during that review; there is no persistent bypass flag.
export async function reviewCatalogCandidateV69({
  candidate, store, environment = {}, apply = false, approvedDigest = "", expectedGeneration = "",
}: {
  candidate: unknown; store: SnapshotStoreV69; environment?: RuntimeEnvironmentV69;
  apply?: boolean; approvedDigest?: string; expectedGeneration?: string;
}) {
  const snapshot = validateSyncedCatalogV69(candidate);
  await preparePublicationV69(snapshot, environment);
  const loaded = await store.loadVersioned?.();
  if (!loaded?.catalog) throw new Error("La revisión requiere un snapshot GCS base existente y versionado.");
  const digest = candidateDigestV69(snapshot);
  let reviewReason: string | null = null;
  try { assertCatalogTransitionV69(loaded.catalog, snapshot); }
  catch (error) { reviewReason = error instanceof Error ? error.message : "Revisión requerida."; }
  if (apply) {
    if (approvedDigest !== digest) throw new Error("La aprobación no corresponde a este candidato exacto.");
    if (expectedGeneration !== loaded.generation) throw new SnapshotConflictV69();
    assertCatalogTransitionV69(loaded.catalog, snapshot, approvedDigest);
    await store.save(snapshot, expectedGeneration, `reviewed|${digest}`);
  }
  return { status: apply ? "published" : "preview", digest, expectedGeneration: loaded.generation,
    products: snapshot.products.length, offers: snapshot.products.filter(p => p.discountPercent > 0).length,
    commerceSyncedAt: snapshot.commerceSync.completedAt, reviewReason };
}

async function main() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--(input|approve-sha256|expected-generation)=(.+)$/);
    if (arg === "--apply" && !args.has("apply")) args.set("apply", "1");
    else if (match && !args.has(match[1])) args.set(match[1], match[2]);
    else throw new Error("Argumento inválido o repetido.");
  }
  const input = args.get("input");
  if (!input) throw new Error("Requiere --input=<candidato-local.json>; por defecto sólo revisa.");
  if ((await fs.stat(input)).size > 20_000_000) throw new Error("Candidato demasiado grande.");
  const store = createGcsSnapshotStoreV69(process.env);
  if (!store) throw new Error("Configurar el bucket y objeto de snapshot V6.9 antes de revisar.");
  const result = await reviewCatalogCandidateV69({
    candidate: JSON.parse(await fs.readFile(input, "utf8")), store, environment: process.env,
    apply: args.get("apply") === "1", approvedDigest: args.get("approve-sha256"), expectedGeneration: args.get("expected-generation"),
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1]?.endsWith("catalog-candidate-review-v69.js")) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Revisión fallida."); process.exitCode = 1; });
}
