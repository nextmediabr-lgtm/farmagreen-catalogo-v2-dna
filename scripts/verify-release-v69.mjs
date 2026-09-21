import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const digest = value => String(value || "").match(/sha256:[a-f0-9]{64}/)?.[0];
const ready = (conditions, type) => conditions?.some(c => c.type === type && c.status === "True");

// A Scheduler dispatch or an updated Job definition is NOT proof that the
// weekly code executed successfully. Inspect the actual execution.
export function assertReleaseV69({ service, revision, job, execution, health, api, home, pdp, commit, jobName }) {
  assert.match(commit, /^[a-f0-9]{40}$/, "Se requiere SHA completo del código publicado.");
  assert.ok(ready(service.status?.conditions, "Ready"), "Servicio no listo.");
  const serving = service.status.traffic.filter(t => Number(t.percent) > 0);
  assert.equal(serving.length, 1, "La verificación requiere una única revisión al 100%.");
  assert.equal(Number(serving[0].percent), 100);
  assert.equal(serving[0].revisionName, revision.metadata?.name);
  const image = digest(revision.status?.imageDigest);
  assert.ok(image, "Cloud Run no confirmó digest de la revisión.");
  assert.equal(digest(job.spec?.template?.spec?.template?.spec?.containers?.[0]?.image), image, "Web y Job no usan el mismo digest.");
  assert.equal(execution.metadata?.labels?.["run.googleapis.com/job"], jobName, "Ejecución de otro Job.");
  assert.ok(ready(execution.status?.conditions, "Completed"), "El Job no terminó correctamente.");
  assert.ok(Date.parse(execution.status?.completionTime) >= Date.parse(revision.metadata?.creationTimestamp), "La ejecución no verifica esta revisión.");
  assert.equal(digest(execution.spec?.template?.spec?.containers?.[0]?.image), image, "La ejecución exitosa usó una imagen anterior.");
  assert.equal(health.runtime?.codeRevision, commit, "El código observado no coincide con el commit esperado.");
  assert.equal(health.runtime?.status, "ready");
  assert.equal(health.status, "ready");
  assert.equal(health.storefrontUsable, true);
  assert.equal(health.availabilitySummary?.unverified, 0);
  assert.ok(health.navigationPolicy?.revision > 0, "Política administrativa no confirmada.");
  assert.ok(api.products?.length > 0, "DTO público vacío.");
  assert.equal(api.products.length, health.totalProducts, "Health y DTO difieren.");
  assert.equal(new Set(api.products.map(p => p.publicId)).size, api.products.length, "Identidades duplicadas en el DTO.");
  assert.match(home, /class="[^"]*v66-card/);
  assert.ok(pdp.includes(api.products[0].publicId), "La PDP no corresponde al catálogo verificado.");
  return { status: "verified", revision: revision.metadata.name, image, commit,
    products: api.products.length, offers: health.offers, policyRevision: health.navigationPolicy.revision,
    weeklyCompletedAt: execution.status.completionTime, cloudWrites: 0 };
}

async function main() {
  const allowed = new Set(["project", "region", "service", "job", "origin", "commit", "execution"]);
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (!match || !allowed.has(match[1]) || args[match[1]]) throw new Error("Argumento inválido o repetido.");
    args[match[1]] = match[2];
  }
  const { project = "project-e2a7bc6d-e741-4d4e-85d", region = "southamerica-east1",
    service: serviceName = "farmagreen-v69-preprod", job: jobName = "farmagreen-v69-weekly-discovery",
    origin = "https://farmagreenrosario.web.app", commit, execution: executionName } = args;
  if (!/^[a-f0-9]{40}$/.test(commit || "") || !executionName) throw new Error("Requiere --commit=<SHA completo> y --execution=<ejecución semanal terminada>.");
  if (![project, region, serviceName, jobName, executionName].every(v => /^[a-z][a-z0-9-]+$/.test(v))) throw new Error("Identificador GCP inválido.");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== origin) throw new Error("Origen HTTPS inválido.");
  const describe = (resource, name, fields) => JSON.parse(execFileSync("gcloud", ["run", ...resource, "describe", name,
    `--project=${project}`, `--region=${region}`, `--format=json(${fields})`], { encoding: "utf8", maxBuffer: 2_000_000, timeout: 30_000 }));
  const service = describe(["services"], serviceName, "status.conditions,status.traffic");
  const serving = service.status?.traffic?.filter(t => Number(t.percent) > 0);
  if (serving?.length !== 1) throw new Error("No hay una única revisión productiva; verificar tráfico manualmente.");
  const revision = describe(["revisions"], serving[0].revisionName, "metadata.name,metadata.creationTimestamp,status.imageDigest");
  const job = describe(["jobs"], jobName, "spec.template.spec.template.spec.containers[0].image");
  const execution = describe(["jobs", "executions"], executionName, "metadata.labels,spec.template.spec.containers[0].image,status.conditions,status.completionTime");
  const get = async route => {
    const response = await fetch(new URL(route, origin), { redirect: "error", signal: AbortSignal.timeout(25_000) });
    if (response.status !== 200) throw new Error(`Control público ${route} respondió HTTP ${response.status}.`);
    return response;
  };
  const health = await (await get("/api/catalog-v6-9/health")).json();
  const api = await (await get("/api/catalog-v6-9")).json();
  if (!api.products?.[0]?.publicId) throw new Error("No hay PDP para verificar.");
  const home = await (await get("/")).text();
  const pdp = await (await get(`/p/${encodeURIComponent(api.products[0].publicId)}`)).text();
  console.log(JSON.stringify(assertReleaseV69({ service, revision, job, execution, health, api, home, pdp, commit, jobName })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
