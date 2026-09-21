import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { preparePublicationV69, candidateDigestV69 } from "../dist/catalog-validation-v69.js";
import { validateSyncedCatalogV69 } from "../dist/commerce-runtime-v69.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "data/catalog-v69-fallback.json");
// --from-gcs downloads a baseline. Cloud access is read-only; the artifact is
// private, ignored by git, and deliberately included in the build context.
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !arg.startsWith("--from-gcs="))) throw new Error("Usar sin argumentos o --from-gcs=gs://bucket/objeto.");
const uri = args[0]?.slice("--from-gcs=".length);
if (uri && !/^gs:\/\/[a-z0-9][a-z0-9._-]+\/[a-zA-Z0-9/_\-.]+$/.test(uri)) throw new Error("URI GCS inválida.");
const raw = uri
  ? execFileSync("gcloud", ["storage", "cat", uri, "--quiet"], { encoding: "utf8", maxBuffer: 20_000_000, timeout: 60_000 })
  : await fs.readFile(output, "utf8");
const snapshot = validateSyncedCatalogV69(JSON.parse(raw));
const catalog = await preparePublicationV69(snapshot, {
  NODE_ENV: "production", V69_ENABLE_PRODUCTION: "1",
  V69_REQUIRE_EXCLUSIONS: "1", V69_REQUIRE_MAGENTO_TAXONOMY: "1",
  V691_REQUIRE_RESPONSIVE_IMAGES: "1", V691_REQUIRE_JPEG_RESPONSIVE_IMAGES: "1",
});
const age = Date.now() - Date.parse(snapshot.commerceSync.completedAt);
if (age > 36 * 60 * 60 * 1000 || age < -5 * 60 * 1000) throw new Error("El respaldo de la nueva imagen no es reciente (36 h).");
if (uri) {
  const temporary = `${output}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
  await fs.rename(temporary, output);
}
console.log(JSON.stringify({ status: "verified", scope: "packaged-fallback", products: catalog.products.length,
  commerceSyncedAt: snapshot.commerceSync.completedAt, sha256: candidateDigestV69(snapshot), cloudWrites: 0 }));
