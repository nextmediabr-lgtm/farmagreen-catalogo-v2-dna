import type http from "node:http";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import type { CatalogV69 } from "./data-v69.js";
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
const V69_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://storage.googleapis.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const PUBLIC_HTML_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";
const PUBLIC_CATALOG_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=60";
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
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/internal/catalog-v6-9/refresh" ||
    pathname.startsWith("/producto-v6-9/") ||
    servesShortProduct ||
    pathname.startsWith("/media-v6-9/");
  if (!isV69Route) return false;

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

  if (pathname === "/catalogo-v6-9" || servesPublicCatalog) {
    sendHtmlV69(response, catalogPageV69(catalog, url.searchParams, publicOriginV69(url.origin, environment)), 200, request);
    return true;
  }

  if (servesPublicHome || pathname === "/inicio-v6-9" || (pathname === "/inicio" && publicAliasesEnabled)) {
    sendHtmlV69(response, homePageV69(catalog, publicOriginV69(url.origin, environment)), 200, request);
    return true;
  }

  if (pathname.startsWith("/producto-v6-9/")) {
    const found = await productV69(pathname.slice("/producto-v6-9/".length));
    const origin = publicOriginV69(url.origin, environment);
    sendHtmlV69(
      response,
      found ? productPageV69(found, await similarV69(found), origin) : notFoundPageV69(origin),
      found ? 200 : 404,
      request,
    );
    return true;
  }

  if (servesShortProduct) {
    const found = await productV69(pathname.slice("/p/".length));
    const origin = publicOriginV69(url.origin, environment);
    sendHtmlV69(
      response,
      found ? productPageV69(found, await similarV69(found), origin) : notFoundPageV69(origin),
      found ? 200 : 404,
      request,
    );
    return true;
  }

  if (pathname === "/api/catalog-v6-9") {
    sendJsonV69(response, publicCatalogV69(catalog), 200, { "cache-control": PUBLIC_CATALOG_CACHE }, request);
    return true;
  }

  if (pathname === "/api/catalog-v6-9/health") {
    sendJsonV69(
      response,
      { ...catalogHealthV69(catalog), runtime: commerceRuntime.health() },
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
      sitemapXmlV69(catalog, publicOriginV69(url.origin, environment)),
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

function schedulerIdempotencyKeyV69(request: http.IncomingMessage | undefined) {
  if (!request) return "";
  const jobName = headerV69(request, "x-cloudscheduler-jobname");
  const scheduleTime = headerV69(request, "x-cloudscheduler-schedule-time");
  return [jobName, scheduleTime].filter(Boolean).join("|");
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
