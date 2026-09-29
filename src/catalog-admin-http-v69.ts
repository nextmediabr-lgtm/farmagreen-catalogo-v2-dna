import crypto from "node:crypto";
import { hasVerifiedStockV69, isFragranceProductV69 } from "../scripts/catalog-collections-v69.mjs";
import type http from "node:http";
import { GoogleAuth } from "google-auth-library";
import type { CommerceRuntimeV69 } from "./commerce-runtime-v69.js";
import type { CatalogV69 } from "./data-v69.js";
import { catalogCloudProjectV69, createCatalogSchedulerV69, type SchedulerKindV69 } from "./catalog-admin-scheduler-v69.js";
import {
  CatalogAdminConflictV69,
  type CatalogAdminActorV69,
  type CatalogAdminEnvironmentV69,
  type CatalogAdminRuntimeV69,
} from "./catalog-admin-v69.js";
import {
  DEFAULT_NEEDS_V69,
  applyCatalogPolicyV69,
  applyProductPolicyV69,
  displayBrandV69,
  isProductExcludedByPolicyV69,
  navigationBrandsV69,
  normalizeEanV69,
  technicalBrandSlugV69,
  validateCatalogPolicyV69,
  type CatalogPolicyV69,
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

    if (pathname === "/api/admin-v69/products" && method(request) === "GET") {
      const current = await adminRuntime.current(true);
      sendAdminJson(response, adminProductsV69(catalog, current.document.policy, url.searchParams));
      return true;
    }

    if (pathname === "/api/admin-v69/policy/preview" && method(request) === "POST") {
      const body = await readAdminJson(request);
      const current = await adminRuntime.current(true);
      if (integer(body.expectedRevision, "expectedRevision") !== current.document.revision) {
        throw new CatalogAdminConflictV69("La configuración cambió; recargá antes de previsualizar.");
      }
      const proposed = validateCatalogPolicyV69(body.policy);
      sendAdminJson(response, adminPolicyPreviewV69(catalog, current.document.policy, proposed));
      return true;
    }

    if (pathname === "/api/admin-v69/schedulers" && method(request) === "GET") {
      sendAdminJson(response, { jobs: await createCatalogSchedulerV69(environment).list() });
      return true;
    }

    const schedulerMatch = pathname.match(/^\/api\/admin-v69\/schedulers\/(daily|weekly)\/(pause|resume)$/);
    if (schedulerMatch && method(request) === "POST") {
      const body = await readAdminJson(request);
      const kind = schedulerMatch[1] as SchedulerKindV69;
      const action = schedulerMatch[2] as "pause" | "resume";
      const expectedState = requiredText(body.expectedState, "expectedState", 16);
      const job = await createCatalogSchedulerV69(environment).change(kind, action, expectedState);
      let memoryRecorded = true;
      try {
        await adminRuntime.recordMemory({
          actor,
          type: "scheduler",
          summary: `${action === "pause" ? "Pausó" : "Reanudó"} el cron ${kind}${job.simulated ? " (simulado localmente)" : ""}.`,
          details: { job: job.name, state: job.state, simulated: job.simulated },
        });
      } catch {
        memoryRecorded = false;
      }
      sendAdminJson(response, { job, memoryRecorded, ...(memoryRecorded ? {} : { warning: "El cron cambió y se verificó, pero la memoria no pudo guardarse." }) }, memoryRecorded ? 200 : 202);
      return true;
    }

    if (pathname === "/api/admin-v69/ean-requests/approve" && method(request) === "POST") {
      const body = await readAdminJson(request);
      const ean = normalizeEanV69(body.ean);
      const expectedRevision = integer(body.expectedRevision, "expectedRevision");
      const current = await adminRuntime.current(true);
      const requestRule = current.document.policy.eanRules.requests.find((entry) => entry.ean === ean);
      if (!requestRule) throw new Error("La solicitud EAN ya no está pendiente.");
      const discovery = (catalog as CatalogV69 & { discoverySync?: { eanReviewCandidates?: Array<{ ean: string }> } }).discoverySync;
      const sourceValidated = discovery?.eanReviewCandidates?.some((entry) => entry.ean === ean);
      const alreadyPresent = catalog.products.some((product) => normalizeEanV69(product.barcode) === ean);
      if (!sourceValidated && !alreadyPresent) {
        throw new Error("Ese EAN todavía no tiene evidencia del scan o una ficha actual; no se puede aprobar.");
      }
      const policy = structuredClone(current.document.policy);
      policy.eanRules.requests = policy.eanRules.requests.filter((entry) => entry.ean !== ean);
      policy.eanRules.include.push({ ...requestRule, note: requestRule.note || "Aprobado tras revisión de fuente." });
      const saved = await adminRuntime.publishPolicy({ policy, expectedRevision, actor, type: "ean", summary: `Aprueba inclusión EAN ${ean} para el próximo scan.` });
      sendAdminJson(response, { revision: saved.document.revision });
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
      if (environment.NODE_ENV !== "production") throw new Error("El refresh real está deshabilitado en la vista previa local.");
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
      if (environment.NODE_ENV !== "production" && !dependencies.runDiscovery) throw new Error("El scan real está deshabilitado en la vista previa local.");
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
  const visibleIds = new Set(presented.products.map((product) => product.publicId));
  const counts = new Map<string, { slug: string; name: string; count: number }>();
  const promotionCounts = new Map<string, { slug: string; name: string; count: number }>();
  const technicalPromotionCounts = new Map<string, { slug: string; name: string; displayName: string; count: number; selected: boolean }>();
  for (const product of catalog.products) {
    const slug = technicalBrandSlugV69(product.brand?.name || product.brand?.slug || "marca");
    const current = counts.get(slug) || { slug, name: product.brand?.name || "Sin marca", count: 0 };
    current.count += 1;
    counts.set(slug, current);
    if (visibleIds.has(product.publicId) && (product.discountPercent > 0 || product.promotion)) {
      const displayBrand = displayBrandV69(product, policy);
      const promotion = promotionCounts.get(displayBrand.slug) || { slug: displayBrand.slug, name: displayBrand.name, count: 0 };
      promotion.count += 1;
      promotionCounts.set(displayBrand.slug, promotion);
      const disabled = policy.navigation.promotionDisabledTechnicalBrandSlugs;
      const selected = disabled !== null
        ? !disabled.includes(slug)
        : policy.navigation.promotionBrandSlugs === null || policy.navigation.promotionBrandSlugs.includes(displayBrand.slug);
      const technical = technicalPromotionCounts.get(slug) || { slug, name: product.brand?.name || "Sin marca", displayName: displayBrand.name, count: 0, selected };
      technical.count += 1;
      technicalPromotionCounts.set(slug, technical);
    }
  }
  const productByEan = new Map(catalog.products.map((product) => [normalizeEanV69(product.barcode), product]));
  const reviewCandidates = new Map(
    ((catalog as CatalogV69 & { discoverySync?: { eanReviewCandidates?: Array<{ ean: string; name: string; brand: string }> } }).discoverySync?.eanReviewCandidates || [])
      .map((candidate) => [candidate.ean, candidate]),
  );
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
      fragrances: {
        snapshot: catalog.products.filter(isFragranceProductV69).length,
        available: catalog.products.filter((product) => isFragranceProductV69(product) && hasVerifiedStockV69(product)).length,
        public: presented.products.filter(isFragranceProductV69).length,
        withoutStock: catalog.products.filter((product) => isFragranceProductV69(product) && !hasVerifiedStockV69(product)).length,
      },
      available: presented.products.filter((product) => product.availability === "limited").length,
      unavailable: presented.products.filter((product) => product.availability === "out_of_stock").length,
      technicalBrands: [...counts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "es")),
      promotionBrands: [...promotionCounts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "es")),
      promotionTechnicalBrands: [...technicalPromotionCounts.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, "es") || left.name.localeCompare(right.name, "es")),
      navigationBrands: navigationBrandsV69(presented, policy),
      uses: DEFAULT_NEEDS_V69.map((slug) => ({
        slug,
        publicCount: presented.products.filter((product) => product.needs?.includes(slug)).length,
        snapshotCount: catalog.products.filter((product) => product.needs?.includes(slug)).length,
      })),
      commerceSyncedAt: catalog.commerceSyncedAt,
      discoverySyncedAt: (catalog as CatalogV69 & { discoverySync?: { completedAt?: string } }).discoverySync?.completedAt || null,
    },
    runtime,
    policy,
    eanStatus: {
      include: withStatus(policy.eanRules.include),
      exclude: withStatus(policy.eanRules.exclude),
      requests: policy.eanRules.requests.map((entry) => {
        const product = productByEan.get(entry.ean);
        const candidate = reviewCandidates.get(entry.ean);
        return {
          ...entry,
          status: product || candidate ? "reviewable" : "pending",
          product: product ? { publicId: product.publicId, name: product.name, availability: product.availability } : null,
          candidate: candidate || null,
        };
      }),
    },
    memory: [...document.memory].reverse(),
    snapshots: [...document.snapshots].reverse().map((entry) => ({
      revision: entry.revision,
      at: entry.at,
      actor: entry.actor,
    })),
  };
}

export function adminProductsV69(catalog: CatalogV69, policy: CatalogPolicyV69, params: URLSearchParams) {
  const query = (params.get("q") || "").trim().toLocaleLowerCase("es").slice(0, 100);
  const brand = (params.get("brand") || "").trim().slice(0, 80);
  const use = (params.get("use") || "").trim();
  if (use && !DEFAULT_NEEDS_V69.includes(use as typeof DEFAULT_NEEDS_V69[number])) throw new Error("Filtro de uso inválido.");
  const visibility = params.get("visibility") || "all";
  if (!["all", "public", "hidden"].includes(visibility)) throw new Error("Filtro de visibilidad inválido.");
  const pageValue = Number(params.get("page") || 1);
  if (!Number.isSafeInteger(pageValue) || pageValue < 1 || pageValue > 10_000) throw new Error("Página de catálogo inválida.");
  const page = pageValue;
  const pageSize = 30;
  const matching = catalog.products.filter((product) => {
    const hidden = isProductExcludedByPolicyV69(product, policy);
    if (visibility === "public" && hidden || visibility === "hidden" && !hidden) return false;
    if (brand && technicalBrandSlugV69(product.brand?.name || product.brand?.slug) !== brand) return false;
    if (use && !product.needs?.includes(use)) return false;
    if (!query) return true;
    return [product.name, product.brand?.name, product.barcode, product.sku, product.publicId]
      .some((value) => String(value || "").toLocaleLowerCase("es").includes(query));
  });
  const items = matching.slice((page - 1) * pageSize, page * pageSize).map((product) => {
    const hidden = isProductExcludedByPolicyV69(product, policy);
    const presented = hidden ? null : applyProductPolicyV69(product, policy);
    const brandSlug = technicalBrandSlugV69(product.brand?.name || product.brand?.slug);
    return {
      publicId: product.publicId,
      name: product.name,
      ean: normalizeEanV69(product.barcode),
      technicalBrand: product.brand?.name || "Sin marca",
      displayedBrand: presented?.brand?.name || null,
      visibility: hidden ? "hidden" : "public",
      hiddenReason: hidden ? isFragranceProductV69(product) && !hasVerifiedStockV69(product)
        ? "Sin stock STOM verificado"
        : isFragranceProductV69(product) && policy.navigation.fragrancesEnabled === false
          ? "Colección Fragancias deshabilitada"
          : policy.eanRules.exclude.some((entry) => entry.ean === normalizeEanV69(product.barcode)) ? "EAN excluido" : `Marca ${brandSlug} excluida` : null,
      availability: product.availability,
      listPrice: presented?.listPrice ?? product.listPrice,
      offerPrice: presented?.offerPrice ?? product.offerPrice,
      promotion: presented?.promotion?.label || null,
      needs: product.needs || [],
      useEvidence: isFragranceProductV69(product) ? "Colección GPS Perfumes y Fragancias" : product.taxonomy?.reasonerVersion === "v69.4-title-line-use" ? "Título y línea" : "Snapshot vigente",
      taxonomyAttached: product.magentoTaxonomyAttached === true,
      hasCardImage: Boolean(product.images?.card),
      hasDetailImage: Boolean(product.images?.detail),
      sourceMemberships: (product.sourceMemberships || []).map((entry) => entry.viewName).slice(0, 5),
    };
  });
  return { page, pageSize, total: matching.length, items };
}

export function adminPolicyPreviewV69(catalog: CatalogV69, current: CatalogPolicyV69, proposed: CatalogPolicyV69) {
  const before = applyCatalogPolicyV69(catalog, current);
  const after = applyCatalogPolicyV69(catalog, proposed);
  const beforeIds = new Set(before.products.map((product) => product.publicId));
  const afterIds = new Set(after.products.map((product) => product.publicId));
  const names = new Map(catalog.products.map((product) => [product.publicId, product.name]));
  const hidden = [...beforeIds].filter((id) => !afterIds.has(id));
  const restored = [...afterIds].filter((id) => !beforeIds.has(id));
  const promotions = (products: CatalogV69["products"]) => products.filter((product) => product.discountPercent > 0 || product.promotion).length;
  return {
    before: { products: before.products.length, promotions: promotions(before.products) },
    after: { products: after.products.length, promotions: promotions(after.products) },
    hidden: { count: hidden.length, examples: hidden.slice(0, 5).map((id) => ({ id, name: names.get(id) || id })) },
    restored: { count: restored.length, examples: restored.slice(0, 5).map((id) => ({ id, name: names.get(id) || id })) },
    pendingEanRequests: proposed.eanRules.requests.length,
    note: "Vista previa local de la política; no modifica precios de origen ni ejecuta un scan.",
  };
}

export async function runDiscoveryJobV69(environment: CatalogAdminEnvironmentV69) {
  const region = environment.V69_DISCOVERY_JOB_REGION?.trim() || "southamerica-east1";
  const job = environment.V69_DISCOVERY_JOB_NAME?.trim();
  if (!job || !/^[a-z][a-z0-9-]{0,62}$/.test(job)) {
    throw new Error("El Job semanal no está configurado para el panel.");
  }
  const auth = new GoogleAuth({ scopes: [CLOUD_SCOPE] });
  const project = await catalogCloudProjectV69(environment, auth);
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
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Administración V6.9 | FarmaGreen</title><link rel="icon" href="/logo_farmagreen.png"><link rel="stylesheet" href="/admin-v69-2.css?v=20260929-fragrancias-1"></head><body><header class="admin-top"><img src="/logo_farmagreen.png" alt="FarmaGreen"><div><strong>Administración V6.9</strong><span>Catálogo, navegación y memoria operativa</span></div><button id="logoutAdmin" type="button">Salir</button></header><main><section id="adminLogin" class="admin-login"><h1>Acceso privado</h1><p>Ingresá con la cuenta Google autorizada.</p><div id="googleLogin"></div>${localMode ? '<label>Token local<input id="localAdminToken" type="password" autocomplete="off"><button id="localLogin" type="button">Entrar localmente</button></label>' : ""}<p id="loginError" role="alert"></p></section><section id="adminApp" hidden><nav class="admin-tabs" aria-label="Secciones"><button data-tab="status" class="on">Estado</button><button data-tab="catalog">Catálogo</button><button data-tab="navigation">Navegación</button><button data-tab="ean">Reglas EAN</button><button data-tab="operations">Operaciones</button></nav><section id="adminContent" aria-live="polite"></section></section></main><script type="application/json" id="admin-v69-data">${bootstrap}</script>${clientId ? '<script src="https://accounts.google.com/gsi/client" async defer></script>' : ""}<script type="module" src="/admin-v69-5.js?v=20260929-fragrancias-1"></script></body></html>`;
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
