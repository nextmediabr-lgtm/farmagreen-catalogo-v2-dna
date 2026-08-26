import { fileURLToPath } from "node:url";
import path from "node:path";

export function parseDeployReceiptArgsV69(argv = []) {
  const values = new Map();
  for (const argument of argv) {
    const match = String(argument).match(/^--([a-z-]+)=(.+)$/);
    if (!match) throw new Error("Los argumentos post-deploy deben usar --campo=valor.");
    if (values.has(match[1])) throw new Error("El argumento post-deploy está repetido.");
    values.set(match[1], match[2]);
  }
  const allowed = new Set(["origin", "commit", "build", "revision", "products", "healthy", "verified-at"]);
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`Argumento post-deploy no reconocido: ${key}.`);
  const origin = new URL(required(values, "origin"));
  if (!["https:", "http:"].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error("Origen post-deploy inválido.");
  }
  const products = Number(required(values, "products"));
  if (!Number.isSafeInteger(products) || products < 1) throw new Error("Cantidad post-deploy inválida.");
  const healthy = required(values, "healthy");
  if (!new Set(["true", "false"]).has(healthy)) throw new Error("Health post-deploy inválido.");
  const verifiedAt = new Date(required(values, "verified-at"));
  if (Number.isNaN(verifiedAt.getTime())) throw new Error("Fecha post-deploy inválida.");
  return {
    origin: origin.origin,
    receipt: {
      commit: clean(required(values, "commit"), 64, "commit"),
      build: clean(values.get("build") || "", 120, "build", true),
      cloudRunRevision: clean(required(values, "revision"), 120, "revision"),
      products,
      healthy: healthy === "true",
      verifiedAt: verifiedAt.toISOString(),
    },
  };
}

export async function recordDeployReceiptV69({
  args,
  token = process.env.V69_AGENT_MANAGER_TOKEN,
  fetchImpl = globalThis.fetch,
} = {}) {
  const { origin, receipt } = parseDeployReceiptArgsV69(args || process.argv.slice(2));
  const accessToken = String(token || "").trim();
  if (!accessToken) throw new Error("Falta V69_AGENT_MANAGER_TOKEN para registrar el post-deploy.");
  const response = await fetchImpl(`${origin}/api/admin-v69/deploy-receipt`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(receipt),
  });
  if (!response.ok) throw new Error(`El panel rechazó el recibo post-deploy con HTTP ${response.status}.`);
  return { receipt, response: await response.json() };
}

function required(values, key) {
  const value = String(values.get(key) || "").trim();
  if (!value) throw new Error(`Falta --${key} en el post-deploy.`);
  return value;
}

function clean(value, limit, field, optional = false) {
  const result = String(value || "").trim();
  if (optional && !result) return "";
  if (!result || result.length > limit || /[\u0000-\u001f\u007f]/.test(result)) throw new Error(`El campo ${field} post-deploy es inválido.`);
  return result;
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  recordDeployReceiptV69().then((result) => {
    process.stdout.write(`${JSON.stringify({ status: "recorded", revision: result.receipt.cloudRunRevision })}\n`);
  }).catch((error) => {
    process.stderr.write(`[v69-deploy-receipt] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
