import type http from "node:http";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import type { CatalogV69 } from "./data-v69.js";
import {
  createCatalogAdminRuntimeV69,
  type CatalogAdminRuntimeV69,
} from "./catalog-admin-v69.js";
import { handleCatalogAdminRequestV69 } from "./catalog-admin-http-v69.js";
import { applyCatalogPolicyV69, isProductExcludedByPolicyV69 } from "./catalog-policy-v69.js";
import {
  RuntimeHttpErrorV69,
  createCommerceRuntimeV69,
  type CommerceRuntimeV69,
} from "./commerce-runtime-v69.js";
import {
  catalogPageV69,
  catalogV69,
  homePageV69,
  isPrivateSourceImageV69,
  notFoundPageV69,
  productPageV69,
  productV69,
  publicCatalogV69,
  robotsTxtV69,
  similarV69,
  sitemapXmlV69,
  sourceImageV69,
} from "./render-v69.js";

const MAX_SOURCE_IMAGE_BYTES = 12_000_000;
const SOURCE_IMAGE_TIMEOUT_MS = 15_000;
const MAX_META_EVENT_BYTES = 16_384;
const META_CAPI_TIMEOUT_MS = 8_000;
const META_PIXEL_ID_V69 = "1198250568817946";
const GOOGLE_ADS_TAG_ID_V69 = "AW-18405204387";
const META_EVENT_NAMES_V69 = new Set([
  "PageView",
  "ViewContent",
  "Search",
  "Contact",
  "Lead",
  "CatalogFilterOpen",
  "CatalogFilterSelect",
]);
const V69_CSP =
  "default-src 'self'; script-src 'self' https://connect.facebook.net https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net; style-src 'self'; img-src 'self' data: https://storage.googleapis.com https://www.facebook.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://*.g.doubleclick.net https://www.google.com https://google.com https://www.google.com.ar https://google.com.ar https://pagead2.googlesyndication.com https://www.googleadservices.com; connect-src 'self' https://connect.facebook.net https://www.facebook.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.googletagmanager.com https://*.g.doubleclick.net https://pagead2.googlesyndication.com https://www.googleadservices.com https://ad.doubleclick.net https://www.google.com https://google.com https://www.google.com.ar https://google.com.ar; base-uri 'self'; form-action 'self' https://www.facebook.com; frame-src https://www.facebook.com https://www.googletagmanager.com; frame-ancestors 'self'";
const PUBLIC_HTML_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=30";
const PUBLIC_CATALOG_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=30";
const PUBLIC_DISCOVERY_CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=300";

export type Environment = Readonly<Record<string, string | undefined>>;

export function headersV69(extra: Record<string, string> = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "content-security-policy": V69_CSP,
    ...extra,
  };
}

export function sourceImageBridgeEnabled(environment: Environment = process.env) {
  return (
    environment.NODE_ENV !== "production" &&
    environment.V69_LOCAL_PREVIEW === "1" &&
    environment.V69_DISABLE_SOURCE_IMAGE_BRIDGE !== "1"
  );
}

export function catalogReadyForRuntimeV69(catalog: CatalogV69, environment: Environment = process.env) {
  if (environment.NODE_ENV !== "production") return environment.V69_LOCAL_PREVIEW === "1";
  if (environment.V69_ENABLE_PRODUCTION !== "1") return false;
  try {
    publicOriginV69("http://invalid.local", environment);
  } catch {
    return false;
  }
  return (
    catalog.version === 6.9 &&
    Boolean(catalog.commerceSyncedAt) &&
    catalog.products.length > 0 &&
    catalog.products.every(
      (product) =>
        (environment.V69_REQUIRE_MAGENTO_TAXONOMY !== "1" || product.magentoTaxonomyAttached === true) &&
        product.availability !== "unknown" &&
        Boolean(product.availabilityCheckedAt) &&
        (["card", "detail"] as const).every((kind) => {
          try {
            const image = new URL(sourceImageV69(product, kind));
            return image.protocol === "https:" && image.hostname === "storage.googleapis.com";
          } catch {
            return false;
          }
        }),
    ) &&
    (environment.V691_REQUIRE_RESPONSIVE_IMAGES !== "1" || catalog.products.every(responsiveImagesReadyV691))
  );
}

export function responsiveImagesReadyV691(product: CatalogV69["products"][number]) {
  return (["card", "detail"] as const).every((kind) => {
    const set = product.images?.responsive?.[kind];
    if (!set || !Number.isInteger(set.width) || !Number.isInteger(set.height) || set.width <= 0 || set.height <= 0) return false;
    return (["webp", "avif"] as const).every((format) => {
      const variants = Object.entries(set[format] || {});
      return variants.length > 0 && variants.every(([width, value]) => {
        if (!/^\d+$/.test(width)) return false;
        try {
          const url = new URL(String(value || ""));
          return url.protocol === "https:" && url.hostname === "storage.googleapis.com";
        } catch {
          return false;
        }
      });
    });
  });
}

export function publicOriginV69(requestOrigin: string, environment: Environment = process.env) {
  const configured = environment.PUBLIC_ORIGIN?.trim();
  if (!configured) {
    if (environment.NODE_ENV === "production") {
      throw new Error("PUBLIC_ORIGIN es obligatorio para servir V6.9 en producción.");
    }
    return requestOrigin;
  }

  const parsed = new URL(configured);
  const allowedProtocol =
    parsed.protocol === "https:" ||
    (environment.NODE_ENV !== "production" && parsed.protocol === "http:");
  if (!allowedProtocol || parsed.username || parsed.password) {
    throw new Error(
      environment.NODE_ENV === "production"
        ? "PUBLIC_ORIGIN debe ser un origen HTTPS válido en producción."
        : "PUBLIC_ORIGIN debe ser un origen HTTP(S) válido.",
    );
  }
  return parsed.origin;
}

export async function handleV69Request(
  response: http.ServerResponse,
  url: URL,
  pathname: string,
  environment: Environment = process.env,
  commerceRuntime: CommerceRuntimeV69 = createCommerceRuntimeV69(environment),
  request?: http.IncomingMessage,
  adminRuntime: CatalogAdminRuntimeV69 = createCatalogAdminRuntimeV69(environment),
) {
  const publicAliasesEnabled =
    environment.V69_ENABLE_PRODUCTION === "1" || environment.V69_LOCAL_PREVIEW === "1";
  const servesPublicHome = pathname === "/" && publicAliasesEnabled;
  const servesPublicCatalog = pathname === "/catalogo" && publicAliasesEnabled;
  const servesShortProduct = pathname.startsWith("/p/") && publicAliasesEnabled;
  const isV69Route =
    servesPublicHome ||
    (pathname === "/inicio" && publicAliasesEnabled) ||
    servesPublicCatalog ||
    pathname === "/inicio-v6-9" ||
    pathname === "/catalogo-v6-9" ||
    pathname === "/api/catalog-v6-9" ||
    pathname === "/api/catalog-v6-9/health" ||
    pathname === "/api/meta-events-v6-9" ||
    pathname === "/admin-v6-9" ||
    pathname.startsWith("/api/admin-v69/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/internal/catalog-v6-9/refresh" ||
    pathname.startsWith("/producto-v6-9/") ||
    servesShortProduct ||
    pathname.startsWith("/media-v6-9/");
  if (!isV69Route) return false;

  if (pathname === "/api/meta-events-v6-9") {
    await handleMetaEventV69(response, url, environment, request);
    return true;
  }

  try {
    await commerceRuntime.initialize();
  } catch {
    sendTextV69(response, "V6.9 no pudo inicializarse.", 503);
    return true;
  }

  if (pathname === "/internal/catalog-v6-9/refresh") {
    if ((request?.method || "GET").toUpperCase() !== "POST") {
      sendJsonV69(response, { error: "Método no permitido." }, 405, { allow: "POST" });
      return true;
    }
    try {
      await commerceRuntime.authorizeSchedulerRequest(request?.headers.authorization);
      const result = await commerceRuntime.refresh(schedulerIdempotencyKeyV69(request));
      sendJsonV69(response, result, 200, { "cache-control": "no-store" });
    } catch (error) {
      const status = error instanceof RuntimeHttpErrorV69 ? error.status : 500;
      const message =
        error instanceof RuntimeHttpErrorV69
          ? error.message
          : "No se pudo actualizar el catálogo.";
      sendJsonV69(response, { error: message }, status, { "cache-control": "no-store" });
    }
    return true;
  }

  const catalog = await catalogV69();
  if (!catalogReadyForRuntimeV69(catalog, environment)) {
    sendTextV69(response, "V6.9 todavía no está habilitada para esta ejecución.", 503);
    return true;
  }
  const policy = await adminRuntime.policy();

  if (
    await handleCatalogAdminRequestV69({
      response,
      request,
      url,
      pathname,
      environment,
      adminRuntime,
      commerceRuntime,
      catalog,
    })
  ) {
    return true;
  }

  if (servesPublicHome) {
    sendHtmlV69(
      response,
      catalogPageV69(catalog, url.searchParams, publicOriginV69(url.origin, environment), {
        route: "/",
        canonicalPath: "/",
        policy,
      }),
      200,
      request,
    );
    return true;
  }

  if (pathname === "/catalogo-v6-9" || servesPublicCatalog) {
    sendHtmlV69(response, catalogPageV69(catalog, url.searchParams, publicOriginV69(url.origin, environment), { policy }), 200, request);
    return true;
  }

  if (pathname === "/inicio-v6-9" || (pathname === "/inicio" && publicAliasesEnabled)) {
    sendHtmlV69(response, homePageV69(catalog, publicOriginV69(url.origin, environment), policy), 200, request);
    return true;
  }

  if (pathname.startsWith("/producto-v6-9/")) {
    const found = await productV69(pathname.slice("/producto-v6-9/".length));
    const visible = found && !isProductExcludedByPolicyV69(found, policy) ? found : null;
    const origin = publicOriginV69(url.origin, environment);
    sendHtmlV69(
      response,
      visible ? productPageV69(visible, (await similarV69(visible)).filter((entry) => !isProductExcludedByPolicyV69(entry, policy)), origin, policy) : notFoundPageV69(origin),
      visible ? 200 : 404,
      request,
    );
    return true;
  }

  if (servesShortProduct) {
    const found = await productV69(pathname.slice("/p/".length));
    const visible = found && !isProductExcludedByPolicyV69(found, policy) ? found : null;
    const origin = publicOriginV69(url.origin, environment);
    sendHtmlV69(
      response,
      visible ? productPageV69(visible, (await similarV69(visible)).filter((entry) => !isProductExcludedByPolicyV69(entry, policy)), origin, policy) : notFoundPageV69(origin),
      visible ? 200 : 404,
      request,
    );
    return true;
  }

  if (pathname === "/api/catalog-v6-9") {
    sendJsonV69(response, publicCatalogV69(catalog, policy), 200, { "cache-control": PUBLIC_CATALOG_CACHE }, request);
    return true;
  }

  if (pathname === "/api/catalog-v6-9/health") {
    sendJsonV69(
      response,
      {
        ...catalogHealthV69(applyCatalogPolicyV69(catalog, policy)),
        runtime: commerceRuntime.health(),
        navigationPolicy: {
          revision: (await adminRuntime.current()).document.revision,
          configured: adminRuntime.configured,
          authenticationConfigured: adminRuntime.authenticationConfigured,
        },
        analytics: {
          ga4MeasurementId: "G-SL7GG138WV",
          googleAdsTagId: GOOGLE_ADS_TAG_ID_V69,
          metaPixelId: META_PIXEL_ID_V69,
          metaCapiConfigured: Boolean(environment.META_CAPI_ACCESS_TOKEN?.trim()),
        },
      },
      200,
      { "cache-control": "no-store" },
      request,
    );
    return true;
  }

  if (pathname === "/robots.txt") {
    sendDocumentV69(
      response,
      robotsTxtV69(publicOriginV69(url.origin, environment)),
      "text/plain; charset=utf-8",
      PUBLIC_DISCOVERY_CACHE,
      request,
    );
    return true;
  }

  if (pathname === "/sitemap.xml") {
    sendDocumentV69(
      response,
      sitemapXmlV69(applyCatalogPolicyV69(catalog, policy), publicOriginV69(url.origin, environment)),
      "application/xml; charset=utf-8",
      PUBLIC_DISCOVERY_CACHE,
      request,
    );
    return true;
  }

  if (pathname.startsWith("/media-v6-9/")) {
    await sendSourceImageV69(response, pathname.slice("/media-v6-9/".length), environment);
    return true;
  }

  return true;
}

type MetaEventInputV69 = {
  event_name?: unknown;
  event_time?: unknown;
  event_id?: unknown;
  event_source_url?: unknown;
  fbp?: unknown;
  fbc?: unknown;
  custom_data?: unknown;
};

type MetaCustomDataV69 = Record<string, string | number | string[]>;

export function normalizeMetaEventV69(
  input: MetaEventInputV69,
  expectedOrigin: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const eventName = cleanTextV69(input.event_name, 64);
  if (!META_EVENT_NAMES_V69.has(eventName)) throw new Error("Evento no permitido.");

  const eventId = cleanTokenV69(input.event_id, 128);
  if (!eventId) throw new Error("Identificador de evento inválido.");

  let eventSourceUrl: URL;
  try {
    eventSourceUrl = new URL(String(input.event_source_url || ""));
  } catch {
    throw new Error("Origen de evento inválido.");
  }
  if (eventSourceUrl.origin !== expectedOrigin) throw new Error("Origen de evento inválido.");

  const suppliedTime = Number(input.event_time);
  const eventTime =
    Number.isInteger(suppliedTime) && suppliedTime >= nowSeconds - 7 * 24 * 60 * 60 && suppliedTime <= nowSeconds + 60
      ? suppliedTime
      : nowSeconds;

  return {
    event_name: eventName,
    event_time: eventTime,
    event_id: eventId,
    event_source_url: eventSourceUrl.href,
    action_source: "website" as const,
    fbp: cleanMetaCookieV69(input.fbp),
    fbc: cleanMetaCookieV69(input.fbc),
    custom_data: cleanMetaCustomDataV69(input.custom_data),
  };
}

async function handleMetaEventV69(
  response: http.ServerResponse,
  url: URL,
  environment: Environment,
  request?: http.IncomingMessage,
) {
  if (!request || (request.method || "GET").toUpperCase() !== "POST") {
    sendJsonV69(response, { error: "Método no permitido." }, 405, { allow: "POST", "cache-control": "no-store" });
    return;
  }

  const expectedOrigin = publicOriginV69(url.origin, environment);
  const requestOrigin = headerV69(request, "origin").trim();
  if (environment.NODE_ENV === "production" && requestOrigin !== expectedOrigin) {
    sendJsonV69(response, { error: "Origen no permitido." }, 403, { "cache-control": "no-store" });
    return;
  }
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendJsonV69(response, { error: "Contenido no permitido." }, 415, { "cache-control": "no-store" });
    return;
  }

  let input: MetaEventInputV69;
  try {
    input = await readJsonRequestV69(request, MAX_META_EVENT_BYTES) as MetaEventInputV69;
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "payload_too_large";
    sendJsonV69(
      response,
      { error: tooLarge ? "Evento demasiado grande." : "Evento inválido." },
      tooLarge ? 413 : 400,
      { "cache-control": "no-store" },
    );
    return;
  }

  let event;
  try {
    event = normalizeMetaEventV69(input, expectedOrigin);
  } catch (error) {
    sendJsonV69(
      response,
      { error: error instanceof Error ? error.message : "Evento inválido." },
      400,
      { "cache-control": "no-store" },
    );
    return;
  }

  const accessToken = environment.META_CAPI_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    response.writeHead(204, headersV69({ "cache-control": "no-store" }));
    response.end();
    return;
  }

  const userData: Record<string, string> = {
    client_ip_address: clientIpV69(request),
    client_user_agent: cleanTextV69(request.headers["user-agent"], 512),
  };
  if (event.fbp) userData.fbp = event.fbp;
  if (event.fbc) userData.fbc = event.fbc;

  const graphVersion = /^v\d+\.\d+$/.test(environment.META_GRAPH_API_VERSION || "")
    ? environment.META_GRAPH_API_VERSION
    : "v26.0";
  const payload: Record<string, unknown> = {
    data: [{
      event_name: event.event_name,
      event_time: event.event_time,
      event_id: event.event_id,
      event_source_url: event.event_source_url,
      action_source: event.action_source,
      user_data: userData,
      custom_data: event.custom_data,
    }],
    access_token: accessToken,
  };
  if (environment.META_CAPI_TEST_EVENT_CODE?.trim()) {
    payload.test_event_code = environment.META_CAPI_TEST_EVENT_CODE.trim();
  }

  try {
    const upstream = await fetch(`https://graph.facebook.com/${graphVersion}/${META_PIXEL_ID_V69}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(META_CAPI_TIMEOUT_MS),
    });
    await upstream.body?.cancel();
    if (!upstream.ok) {
      console.error(`Meta CAPI rechazó un evento (${upstream.status}).`);
      sendJsonV69(response, { accepted: false }, 502, { "cache-control": "no-store" });
      return;
    }
    sendJsonV69(response, { accepted: true }, 202, { "cache-control": "no-store" });
  } catch {
    console.error("Meta CAPI no respondió dentro del límite esperado.");
    sendJsonV69(response, { accepted: false }, 502, { "cache-control": "no-store" });
  }
}

async function readJsonRequestV69(request: http.IncomingMessage, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maximumBytes) throw new Error("payload_too_large");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_json");
  return parsed as Record<string, unknown>;
}

function cleanMetaCustomDataV69(value: unknown): MetaCustomDataV69 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const cleaned: MetaCustomDataV69 = {};
  const textFields = ["content_name", "content_category", "content_type", "search_string", "contact_method", "filter_value"];
  for (const field of textFields) {
    const text = cleanTextV69(source[field], field === "search_string" ? 160 : 120);
    if (text) cleaned[field] = text;
  }
  const filterType = cleanTextV69(source.filter_type, 20);
  if (["brand", "need", "order"].includes(filterType)) cleaned.filter_type = filterType;
  if (Array.isArray(source.content_ids)) {
    const contentIds = source.content_ids.slice(0, 10).map((item) => cleanTokenV69(item, 80)).filter(Boolean);
    if (contentIds.length) cleaned.content_ids = contentIds;
  }
  const numericValue = Number(source.value);
  if (Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100_000_000) {
    cleaned.value = Math.round(numericValue * 100) / 100;
  }
  if (source.currency === "ARS") cleaned.currency = "ARS";
  return cleaned;
}

function cleanTextV69(value: unknown, maximumLength: number) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximumLength);
}

function cleanTokenV69(value: unknown, maximumLength: number) {
  const token = String(value || "").trim();
  return /^[A-Za-z0-9._:-]+$/.test(token) ? token.slice(0, maximumLength) : "";
}

function cleanMetaCookieV69(value: unknown) {
  const cookie = String(value || "").trim();
  return /^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]{1,160}$/.test(cookie) ? cookie : "";
}

function clientIpV69(request: http.IncomingMessage) {
  return cleanTextV69(headerV69(request, "x-forwarded-for").split(",")[0] || request.socket.remoteAddress, 64);
}

export function schedulerIdempotencyKeyV69(request: http.IncomingMessage | undefined) {
  if (!request) return "";
  const jobName = headerV69(request, "x-cloudscheduler-jobname").trim();
  const scheduleTime = headerV69(request, "x-cloudscheduler-schedule-time").trim();
  if (!jobName || !scheduleTime) return "";
  return `${jobName}|${scheduleTime}`;
}

function headerV69(request: http.IncomingMessage, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function sendHtmlV69(
  response: http.ServerResponse,
  body: string,
  status = 200,
  request?: http.IncomingMessage,
) {
  sendEncodedV69(
    response,
    body,
    status,
    headersV69({
      "content-type": "text/html; charset=utf-8",
      "cache-control": status === 200 ? PUBLIC_HTML_CACHE : "no-store",
    }),
    request,
  );
}

function sendDocumentV69(
  response: http.ServerResponse,
  body: string,
  contentType: string,
  cacheControl: string,
  request?: http.IncomingMessage,
) {
  sendEncodedV69(
    response,
    body,
    200,
    headersV69({
      "content-type": contentType,
      "cache-control": cacheControl,
    }),
    request,
  );
}

export function catalogHealthV69(catalog: CatalogV69, now = new Date()) {
  const summary = publicCatalogV69(catalog).availabilitySummary;
  const syncedAt = catalog.commerceSyncedAt ? Date.parse(catalog.commerceSyncedAt) : Number.NaN;
  const ageMs = Number.isFinite(syncedAt) ? Math.max(0, now.getTime() - syncedAt) : null;
  const fresh = ageMs !== null && ageMs <= 36 * 60 * 60 * 1000;
  return {
    version: catalog.version,
    status: fresh ? "ready" : "degraded",
    reason: !catalog.commerceSyncedAt ? "missing_sync" : fresh ? "current" : "stale",
    commerceSyncedAt: catalog.commerceSyncedAt,
    totalProducts: catalog.products.length,
    availabilitySummary: summary,
  };
}

function sendJsonV69(
  response: http.ServerResponse,
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
  request?: http.IncomingMessage,
) {
  sendEncodedV69(
    response,
    JSON.stringify(body),
    status,
    headersV69({
      "content-type": "application/json; charset=utf-8",
      ...extra,
    }),
    request,
  );
}

function sendEncodedV69(
  response: http.ServerResponse,
  body: string,
  status: number,
  headers: Record<string, string>,
  request?: http.IncomingMessage,
) {
  const source = Buffer.from(body);
  const accepted = String(request?.headers["accept-encoding"] || "").toLowerCase();
  let encoded = source;
  let encoding = "";
  if (source.length >= 1_024 && accepted.includes("br")) {
    encoded = brotliCompressSync(source, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    });
    encoding = "br";
  } else if (source.length >= 1_024 && accepted.includes("gzip")) {
    encoded = gzipSync(source, { level: 6 });
    encoding = "gzip";
  }
  const outputHeaders = {
    ...headers,
    "content-length": String(encoded.length),
    ...(encoding ? { "content-encoding": encoding, vary: "accept-encoding" } : {}),
  };
  response.writeHead(status, outputHeaders);
  response.end(request?.method === "HEAD" ? undefined : encoded);
}

function sendTextV69(response: http.ServerResponse, body: string, status: number) {
  response.writeHead(
    status,
    headersV69({
      "content-type": "text/plain; charset=utf-8",
    }),
  );
  response.end(body);
}

export async function readResponseBodyWithinLimit(upstream: Response, maximumBytes: number) {
  if (!upstream.body) return Buffer.alloc(0);
  const reader = upstream.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, totalBytes);
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("image-size-limit");
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

async function sendSourceImageV69(response: http.ServerResponse, target: string, environment: Environment) {
  if (!sourceImageBridgeEnabled(environment)) {
    sendTextV69(response, "Imagen temporal no disponible.", 503);
    return;
  }

  const [id, kind, ...extra] = target.split("/");
  if (!id || !["card", "detail"].includes(kind) || extra.length) {
    sendTextV69(response, "Imagen no disponible.", 404);
    return;
  }

  const found = await productV69(id);
  if (!found) {
    sendTextV69(response, "Imagen no disponible.", 404);
    return;
  }

  const source = sourceImageV69(found, kind as "card" | "detail");
  if (!isPrivateSourceImageV69(source)) {
    sendTextV69(response, "Imagen no disponible.", 404);
    return;
  }

  const upstream = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(SOURCE_IMAGE_TIMEOUT_MS),
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
    },
  });
  if (!upstream.ok) {
    sendTextV69(response, "Imagen no disponible.", 502);
    return;
  }

  const contentType = upstream.headers.get("content-type")?.split(";")[0].trim() || "";
  if (!contentType.startsWith("image/")) {
    sendTextV69(response, "Imagen no disponible.", 502);
    return;
  }

  const declaredSize = Number(upstream.headers.get("content-length") || 0);
  if (declaredSize > MAX_SOURCE_IMAGE_BYTES) {
    sendTextV69(response, "Imagen no disponible.", 413);
    return;
  }

  const body = await readResponseBodyWithinLimit(upstream, MAX_SOURCE_IMAGE_BYTES);
  if (!body) {
    sendTextV69(response, "Imagen no disponible.", 413);
    return;
  }

  response.writeHead(
    200,
    headersV69({
      "content-type": contentType,
      "content-length": String(body.length),
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    }),
  );
  response.end(body);
}
