import crypto from "node:crypto";
import type http from "node:http";
import { GoogleAuth } from "google-auth-library";
import type { CommerceRuntimeV69 } from "./commerce-runtime-v69.js";
import type { CatalogV69 } from "./data-v69.js";
import {
  CatalogAdminConflictV69,
  type CatalogAdminActorV69,
  type CatalogAdminEnvironmentV69,
  type CatalogAdminRuntimeV69,
} from "./catalog-admin-v69.js";
import {
  applyCatalogPolicyV69,
  navigationBrandsV69,
  normalizeEanV69,
} from "./catalog-policy-v69.js";

const MAX_BODY = 128_000;
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

type AdminHttpDependenciesV69 = {
  runDiscovery?: () => Promise<{ execution: string }>;
};

export async function handleCatalogAdminRequestV69({
  response,
  request,
  url,
  pathname,
  environment,
  adminRuntime,
  commerceRuntime,
  catalog,
  dependencies = {},
}: {
  response: http.ServerResponse;
  request?: http.IncomingMessage;
  url: URL;
  pathname: string;
  environment: CatalogAdminEnvironmentV69;
  adminRuntime: CatalogAdminRuntimeV69;
  commerceRuntime: CommerceRuntimeV69;
  catalog: CatalogV69;
  dependencies?: AdminHttpDependenciesV69;
}) {
  if (pathname === "/admin-v6-9") {
    sendAdminHtml(response, adminPageV69({
      clientId: adminRuntime.googleClientId(),
      localMode: environment.NODE_ENV !== "production",
    }));
    return true;
  }
  if (!pathname.startsWith("/api/admin-v69/")) return false;
  if (!request) {
    sendAdminJson(response, { error: "Solicitud administrativa inválida." }, 400);
    return true;
  }

  if (pathname === "/api/admin-v69/deploy-receipt") {
    const actor = authorizeAgentManager(request.headers.authorization, environment);
    if (!actor) {
      sendAdminJson(response, { error: "Agent Manager no autorizado." }, 403);
      return true;
    }
    if (method(request) !== "POST") {
      sendAdminJson(response, { error: "Método no permitido." }, 405, { allow: "POST" });
      return true;
    }
    try {
      const body = await readAdminJson(request);
      const details = deployDetails(body);
      const saved = await adminRuntime.recordMemory({
        actor,
        type: "deploy",
        summary: details.healthy ? "Deploy post-verificado por Codex Agent Manager." : "Deploy reportado con verificación pendiente o fallida.",
        details,
      });
      sendAdminJson(response, { accepted: true, revision: saved.document.revision }, 202);
    } catch (error) {
      sendAdminJson(response, { error: safeMessage(error) }, 422);
    }
    return true;
  }

  let actor: CatalogAdminActorV69;
  try {
    actor = await adminRuntime.authorize(request.headers.authorization);
  } catch (error) {
    sendAdminJson(response, { error: safeMessage(error) }, 401);
    return true;
  }

  try {
    if (pathname === "/api/admin-v69/state" && method(request) === "GET") {
      const current = await adminRuntime.current(true);
      sendAdminJson(response, adminStateV69({
        document: current.document,
        catalog,
        runtime: commerceRuntime.health(),
        configured: adminRuntime.configured,
        authenticationConfigured: adminRuntime.authenticationConfigured,
      }));
      return true;
    }

    if (pathname === "/api/admin-v69/policy" && method(request) === "PUT") {
      const body = await readAdminJson(request);
      const expectedRevision = integer(body.expectedRevision, "expectedRevision");
      const current = await adminRuntime.current(true);
      const type = JSON.stringify(current.document.policy.eanRules) === JSON.stringify((body.policy as Record<string, unknown>)?.eanRules)
        ? "navigation"
        : "ean";
      const saved = await adminRuntime.publishPolicy({
        policy: body.policy,
        expectedRevision,
        actor,
        summary: optionalText(body.summary, 300) || (type === "ean" ? "Actualiza reglas EAN." : "Actualiza navegación pública."),
        type,
      });
      sendAdminJson(response, { revision: saved.document.revision, document: saved.document });
      return true;
    }

    if (pathname === "/api/admin-v69/rollback" && method(request) === "POST") {
      const body = await readAdminJson(request);
      const saved = await adminRuntime.rollback({
        targetRevision: integer(body.targetRevision, "targetRevision"),
        expectedRevision: integer(body.expectedRevision, "expectedRevision"),
        actor,
      });
      sendAdminJson(response, { revision: saved.document.revision, document: saved.document });
      return true;
    }

    if (pathname === "/api/admin-v69/operations/refresh" && method(request) === "POST") {
      const result = await commerceRuntime.refresh(`admin|${new Date().toISOString()}`);
      await adminRuntime.recordMemory({
        actor,
        type: "operation",
        summary: "Refresh comercial ejecutado desde el panel.",
        details: { products: result.products, status: result.status, mode: result.mode },
      });
      sendAdminJson(response, result);
      return true;
    }

    if (pathname === "/api/admin-v69/operations/discovery" && method(request) === "POST") {
      const runner = dependencies.runDiscovery || (() => runDiscoveryJobV69(environment));
      const result = await runner();
      await adminRuntime.recordMemory({
        actor,
        type: "operation",
        summary: "Scan semanal iniciado desde el panel.",
        details: { execution: result.execution, status: "started" },
      });
      sendAdminJson(response, { status: "started", ...result }, 202);
      return true;
    }

    sendAdminJson(response, { error: "Ruta o método no permitido." }, 405);
  } catch (error) {
    const status = error instanceof CatalogAdminConflictV69 ? 409 : 422;
    sendAdminJson(response, { error: safeMessage(error) }, status);
  }
  return true;
}

export function adminStateV69({
  document,
  catalog,
  runtime,
  configured,
  authenticationConfigured,
}: {
  document: Awaited<ReturnType<CatalogAdminRuntimeV69["current"]>>["document"];
  catalog: CatalogV69;
  runtime: ReturnType<CommerceRuntimeV69["health"]>;
  configured: boolean;
  authenticationConfigured: boolean;
}) {
  const policy = document.policy;
  const presented = applyCatalogPolicyV69(catalog, policy);
  const counts = new Map<string, { slug: string; name: string; count: number }>();
  for (const product of catalog.products) {
    const slug = adminBrandSlug(product.brand?.name || product.brand?.slug || "marca");
    const current = counts.get(slug) || { slug, name: product.brand?.name || "Sin marca", count: 0 };
    current.count += 1;
    counts.set(slug, current);
  }
  const productByEan = new Map(catalog.products.map((product) => [normalizeEanV69(product.barcode), product]));
  const withStatus = (entries: typeof policy.eanRules.include) => entries.map((entry) => {
    const product = productByEan.get(entry.ean);
    return {
      ...entry,
      status: product ? "found" : "pending",
      product: product ? { publicId: product.publicId, name: product.name, availability: product.availability } : null,
    };
  });
  return {
    admin: {
      configured,
      authenticationConfigured,
      revision: document.revision,
      updatedAt: document.updatedAt,
      updatedBy: document.updatedBy,
    },
    catalog: {
      products: presented.products.length,
      rawProducts: catalog.products.length,
      available: presented.products.filter((product) => product.availability === "limited").length,
      unavailable: presented.products.filter((product) => product.availability === "out_of_stock").length,
      technicalBrands: [...counts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "es")),
      navigationBrands: navigationBrandsV69(presented, policy),
    },
    runtime,
    policy,
    eanStatus: {
      include: withStatus(policy.eanRules.include),
      exclude: withStatus(policy.eanRules.exclude),
    },
    memory: [...document.memory].reverse(),
    snapshots: [...document.snapshots].reverse().map((entry) => ({
      revision: entry.revision,
      at: entry.at,
      actor: entry.actor,
    })),
  };
}

function adminBrandSlug(value: string) {
  return String(value || "marca")
    .replace(/\+/g, " plus ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "marca";
}

export async function runDiscoveryJobV69(environment: CatalogAdminEnvironmentV69) {
  const project = environment.GOOGLE_CLOUD_PROJECT?.trim();
  const region = environment.V69_DISCOVERY_JOB_REGION?.trim() || "southamerica-east1";
  const job = environment.V69_DISCOVERY_JOB_NAME?.trim();
  if (!project || !job || !/^[a-z][a-z0-9-]{0,62}$/.test(job)) {
    throw new Error("El Job semanal no está configurado para el panel.");
  }
  const auth = new GoogleAuth({ scopes: [CLOUD_SCOPE] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Google Cloud no entregó credenciales para iniciar el scan.");
  const endpoint = `https://run.googleapis.com/v2/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/jobs/${encodeURIComponent(job)}:run`;
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Cloud Run Jobs respondió HTTP ${response.status}.`);
  const body = await response.json() as { name?: string };
  return { execution: String(body.name || "started") };
}

function adminPageV69({ clientId, localMode }: { clientId: string; localMode: boolean }) {
  const bootstrap = JSON.stringify({ clientId, localMode }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Administración V6.9 | FarmaGreen</title><link rel="icon" href="/logo_farmagreen.png"><link rel="stylesheet" href="/admin-v69-1.css?v=20260826-1"></head><body><header class="admin-top"><img src="/logo_farmagreen.png" alt="FarmaGreen"><div><strong>Administración V6.9</strong><span>Catálogo, navegación y memoria operativa</span></div><button id="logoutAdmin" type="button">Salir</button></header><main><section id="adminLogin" class="admin-login"><h1>Acceso privado</h1><p>Ingresá con la cuenta Google autorizada.</p><div id="googleLogin"></div>${localMode ? '<label>Token local<input id="localAdminToken" type="password" autocomplete="off"><button id="localLogin" type="button">Entrar localmente</button></label>' : ""}<p id="loginError" role="alert"></p></section><section id="adminApp" hidden><nav class="admin-tabs" aria-label="Secciones"><button data-tab="status" class="on">Estado</button><button data-tab="navigation">Navegación</button><button data-tab="ean">Reglas EAN</button><button data-tab="operations">Operaciones</button></nav><section id="adminContent" aria-live="polite"></section></section></main><script type="application/json" id="admin-v69-data">${bootstrap}</script>${clientId ? '<script src="https://accounts.google.com/gsi/client" async defer></script>' : ""}<script type="module" src="/admin-v69-2.js?v=20260826-2"></script></body></html>`;
}

function sendAdminHtml(response: http.ServerResponse, body: string) {
  response.writeHead(200, adminHeaders({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' https://accounts.google.com; img-src 'self' data:; connect-src 'self'; frame-src https://accounts.google.com; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
  }));
  response.end(body);
}

function sendAdminJson(
  response: http.ServerResponse,
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  response.writeHead(status, adminHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extra,
  }));
  response.end(JSON.stringify(body));
}

function adminHeaders(extra: Record<string, string>) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "x-robots-tag": "noindex,nofollow",
    ...extra,
  };
}

async function readAdminJson(request: http.IncomingMessage) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw new Error("El panel sólo acepta JSON.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY) throw new Error("La solicitud administrativa es demasiado grande.");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("El cuerpo administrativo es inválido.");
  return parsed as Record<string, unknown>;
}

function authorizeAgentManager(header: string | undefined, environment: CatalogAdminEnvironmentV69) {
  const expected = environment.V69_AGENT_MANAGER_TOKEN?.trim();
  const supplied = String(header || "").match(/^Bearer ([A-Za-z0-9._~+/=-]+)$/)?.[1] || "";
  if (!expected || !supplied || !timingSafeEqual(expected, supplied)) return null;
  return { subject: "codex-agent-manager", email: "codex-agent-manager" };
}

function deployDetails(body: Record<string, unknown>) {
  return {
    commit: requiredText(body.commit, "commit", 64),
    build: optionalText(body.build, 120) || "",
    cloudRunRevision: requiredText(body.cloudRunRevision, "cloudRunRevision", 120),
    healthy: body.healthy === true,
    products: integer(body.products, "products"),
    verifiedAt: requiredText(body.verifiedAt, "verifiedAt", 64),
  };
}

function method(request: http.IncomingMessage) {
  return String(request.method || "GET").toUpperCase();
}

function integer(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`El campo ${field} es inválido.`);
  return parsed;
}

function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, "texto", max);
}

function requiredText(value: unknown, field: string, max: number) {
  if (typeof value !== "string") throw new Error(`El campo ${field} debe ser texto.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || /[\u0000-\u001f\u007f]/.test(cleaned)) throw new Error(`El campo ${field} es inválido.`);
  return cleaned;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "Error administrativo.";
}

function timingSafeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
