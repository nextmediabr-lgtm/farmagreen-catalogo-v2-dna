import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogPageV69,
  catalogV69,
  homePageV69,
  isPrivateSourceImageV69,
  notFoundPageV69,
  productPageV69,
  productV69,
  publicCatalogV69,
  similarV69,
  sourceImageV69,
} from "./render-v7-beta.js";
import { catalogReadinessV7Beta } from "./server-v7-beta-local.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_ROOT = path.resolve(MODULE_DIR, "..");
const PACKAGED_CATALOG = path.join(BUNDLE_ROOT, "data", "catalog-v7-beta.json");
const NO_PRIVATE_EXCLUSIONS = path.join(BUNDLE_ROOT, "data", ".no-private-exclusions-v7-beta.json");
const MAX_REQUEST_URL_LENGTH = 8_192;
const MAX_PRODUCT_ID_LENGTH = 200;
const MAX_IMAGE_BYTES = 8_000_000;
const IMAGE_TIMEOUT_MS = 10_000;
const MEDIA_CACHE_TTL_MS = 15 * 60 * 1000;
const MEDIA_CACHE_ENTRIES = 64;
const MEDIA_MAX_CONCURRENCY = 4;
const MEDIA_MAX_QUEUE = 32;
const MEDIA_CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const IMAGE_TYPES = new Set(["image/avif", "image/webp", "image/png", "image/jpeg"]);
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://storage.googleapis.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

type HandlerOptionsV7Beta = {
  environment?: NodeJS.ProcessEnv;
  catalogFile?: string;
  fetchImpl?: typeof fetch;
  mediaMaxConcurrency?: number;
  mediaMaxQueue?: number;
  mediaCacheEntries?: number;
  mediaCacheTtlMs?: number;
};

type MediaPayloadV7Beta = { body: Buffer; contentType: string };
type MediaBudgetV7Beta = {
  load: (key: string, loader: () => Promise<MediaPayloadV7Beta>) => Promise<MediaPayloadV7Beta>;
};

class MediaBudgetExceededV7Beta extends Error {}

type RouteV7Beta =
  | { kind: "home" }
  | { kind: "catalog" }
  | { kind: "catalog-api" }
  | { kind: "health" }
  | { kind: "product"; id: string }
  | { kind: "media"; id: string; imageKind: "card" | "detail" }
  | { kind: "blocked" }
  | { kind: "not-found" };

export function createV7BetaVercelHandler(options: HandlerOptionsV7Beta = {}) {
  const environment = options.environment || process.env;
  const catalogFile = path.resolve(options.catalogFile || PACKAGED_CATALOG);
  const fetchImpl = options.fetchImpl || fetch;
  const mediaBudget = createMediaBudgetV7Beta({
    maxConcurrency: options.mediaMaxConcurrency,
    maxQueue: options.mediaMaxQueue,
    maxEntries: options.mediaCacheEntries,
    ttlMs: options.mediaCacheTtlMs,
  });

  return async function handlerV7BetaVercel(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    const method = String(request.method || "GET").toUpperCase();
    const headOnly = method === "HEAD";
    if (method !== "GET" && !headOnly) {
      sendText(response, "Método no permitido.", 405, headOnly, { allow: "GET, HEAD" });
      return;
    }

    const rawUrl = request.url || "/";
    if (rawUrl.length > MAX_REQUEST_URL_LENGTH) {
      sendText(response, "Solicitud demasiado larga.", 414, headOnly);
      return;
    }

    try {
      const url = new URL(rawUrl, "http://vercel.internal");
      const route = resolveRouteV7Beta(url);
      if (route.kind === "blocked" || route.kind === "not-found") {
        sendText(response, "No encontrado.", 404, headOnly);
        return;
      }

      configurePackagedCatalogV7Beta(catalogFile);
      const origin = vercelOriginV7Beta(request, environment);
      const catalog = await catalogV69();
      const availability = availabilitySummaryV7Beta(catalog.products);
      const readiness = catalogReadinessV7Beta(catalog, availability.unverified);

      if (route.kind === "health") {
        sendJson(
          response,
          {
            status: readiness.ready ? "ready" : "not_ready",
            version: 7,
            releaseChannel: "beta-local",
            inventoryLocation: catalog.v7Beta?.inventoryLocation || "Rosario",
            inventorySource: catalog.v7Beta?.inventorySource || "STOM",
            totalProducts: catalog.products.length,
            availabilitySummary: availability,
            commerceSyncedAt: catalog.commerceSyncedAt,
            sourceCoverage: catalog.v7Beta?.sourceCoverage ?? 0,
            missingSourceIds: catalog.v7Beta?.missingSourceIds || [],
            missingFacetSlugs: readiness.missingFacetSlugs,
          },
          readiness.ready ? 200 : 503,
          headOnly,
        );
        return;
      }

      if (!readiness.ready) {
        sendText(response, "Snapshot V7 Beta no disponible.", 503, headOnly);
        return;
      }

      if (route.kind === "home") {
        sendHtml(response, homePageV69(catalog, origin), 200, headOnly);
        return;
      }
      if (route.kind === "catalog") {
        const query = new URLSearchParams(url.searchParams);
        for (const key of ["__v7_route", "__v7_id", "__v7_kind"]) query.delete(key);
        sendHtml(response, catalogPageV69(catalog, query, origin), 200, headOnly);
        return;
      }
      if (route.kind === "catalog-api") {
        const publicCatalog = publicCatalogV69(catalog);
        assertPublicCatalogV7Beta(publicCatalog);
        sendJson(response, publicCatalog, 200, headOnly);
        return;
      }
      if (route.kind === "product") {
        const product = await productV69(route.id);
        sendHtml(
          response,
          product ? productPageV69(product, await similarV69(product), origin) : notFoundPageV69(origin),
          product ? 200 : 404,
          headOnly,
        );
        return;
      }
      if (route.kind === "media") {
        await sendSourceImageV7Beta(response, route.id, route.imageKind, method, fetchImpl, mediaBudget, headOnly);
        return;
      }

      sendText(response, "No encontrado.", 404, headOnly);
    } catch (error) {
      const status = error instanceof URIError ? 400 : 500;
      sendText(response, status === 400 ? "Solicitud inválida." : "Error V7 Beta Preview.", status, headOnly);
    }
  };
}

function configurePackagedCatalogV7Beta(catalogFile: string) {
  process.env.V7_BETA_CATALOG_FILE = catalogFile;
  process.env.V7_BETA_EXCLUSIONS_FILE = NO_PRIVATE_EXCLUSIONS;
  process.env.V7_BETA_REQUIRE_EXCLUSIONS = "0";
}

function resolveRouteV7Beta(url: URL): RouteV7Beta {
  const pathname = normalizePathV7Beta(url.pathname);
  if (pathname === "/" || pathname === "/inicio-v7-beta") return { kind: "home" };
  if (pathname === "/catalogo" || pathname === "/catalogo-v7-beta") return { kind: "catalog" };
  if (pathname === "/api/catalog-v7-beta") return { kind: "catalog-api" };
  if (pathname === "/api/catalog-v7-beta/health") return { kind: "health" };

  const productMatch = pathname.match(/^\/p-v7-beta\/([^/]+)$/);
  if (productMatch) return { kind: "product", id: decodeProductIdV7Beta(productMatch[1]) };
  const mediaMatch = pathname.match(/^\/media-v7-beta\/([^/]+)\/(card|detail)$/);
  if (mediaMatch) {
    return {
      kind: "media",
      id: decodeProductIdV7Beta(mediaMatch[1]),
      imageKind: mediaMatch[2] as "card" | "detail",
    };
  }

  if (pathname !== "/api/index") return { kind: "not-found" };
  const rewrittenRoute = url.searchParams.get("__v7_route");
  if (rewrittenRoute === "home") return { kind: "home" };
  if (rewrittenRoute === "catalog") return { kind: "catalog" };
  if (rewrittenRoute === "catalog-api") return { kind: "catalog-api" };
  if (rewrittenRoute === "health") return { kind: "health" };
  if (rewrittenRoute === "blocked") return { kind: "blocked" };
  if (rewrittenRoute === "product") {
    return { kind: "product", id: decodeProductIdV7Beta(url.searchParams.get("__v7_id") || "") };
  }
  if (rewrittenRoute === "media") {
    const imageKind = url.searchParams.get("__v7_kind");
    if (imageKind !== "card" && imageKind !== "detail") return { kind: "not-found" };
    return {
      kind: "media",
      id: decodeProductIdV7Beta(url.searchParams.get("__v7_id") || ""),
      imageKind,
    };
  }
  return { kind: "not-found" };
}

function normalizePathV7Beta(value: string) {
  const normalized = value.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

function decodeProductIdV7Beta(value: string) {
  const decoded = decodeURIComponent(value).trim();
  if (!decoded || decoded.length > MAX_PRODUCT_ID_LENGTH || /[\\/\0]/.test(decoded)) {
    throw new URIError("Identificador V7 Beta inválido.");
  }
  return decoded;
}

function vercelOriginV7Beta(request: http.IncomingMessage, environment: NodeJS.ProcessEnv) {
  const vercelUrl = String(environment.VERCEL_URL || "").trim();
  if (vercelUrl) {
    const candidate = vercelUrl.includes("://") ? vercelUrl : `https://${vercelUrl}`;
    const parsed = new URL(candidate);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password) {
      return parsed.origin;
    }
  }

  const forwardedProtocol = firstHeaderV7Beta(request.headers["x-forwarded-proto"]);
  const protocol = forwardedProtocol === "http" ? "http" : "https";
  const forwardedHost = firstHeaderV7Beta(request.headers["x-forwarded-host"]);
  const host = forwardedHost || firstHeaderV7Beta(request.headers.host) || "localhost";
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return "https://localhost";
  }
}

function firstHeaderV7Beta(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value || "").split(",", 1)[0].trim();
}

function availabilitySummaryV7Beta(products: Array<{ availability?: string }>) {
  const available = products.filter((product) => product.availability === "limited").length;
  const unavailable = products.filter((product) => product.availability === "out_of_stock").length;
  return { available, unavailable, unverified: products.length - available - unavailable };
}

function assertPublicCatalogV7Beta(value: unknown) {
  const pending: unknown[] = [value];
  const forbidden = new Set(["sku", "source", "sourceUrl", "provider"]);
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      if (forbidden.has(key)) throw new Error("DTO público V7 Beta inválido.");
      pending.push(entry);
    }
  }
}

async function sendSourceImageV7Beta(
  response: http.ServerResponse,
  id: string,
  imageKind: "card" | "detail",
  method: string,
  fetchImpl: typeof fetch,
  mediaBudget: MediaBudgetV7Beta,
  headOnly: boolean,
) {
  const product = await productV69(id);
  const source = sourceImageV69(product, imageKind);
  if (!product || source.length > 2_048 || !isPrivateSourceImageV69(source)) {
    sendText(response, "Imagen no encontrada.", 404, headOnly);
    return;
  }

  try {
    const upstreamMethod = method === "HEAD" ? "HEAD" : "GET";
    const payload = await mediaBudget.load(
      `${upstreamMethod}:${source}`,
      () => fetchSourceImageV7Beta(source, upstreamMethod, fetchImpl),
    );
    sendBuffer(response, payload.body, payload.contentType, 200, headOnly, {
      "cache-control": MEDIA_CACHE_CONTROL,
    });
  } catch (error) {
    if (error instanceof MediaBudgetExceededV7Beta) {
      sendText(response, "Demasiadas imágenes en curso.", 429, headOnly, { "retry-after": "5" });
      return;
    }
    sendText(response, "Imagen no disponible.", 502, headOnly);
  }
}

async function fetchSourceImageV7Beta(
  source: string,
  method: "GET" | "HEAD",
  fetchImpl: typeof fetch,
): Promise<MediaPayloadV7Beta> {
  const upstream = await fetchImpl(source, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    headers: {
      accept: "image/avif,image/webp,image/png,image/jpeg",
      "user-agent": "Farmagreen-V7-Beta-Vercel-Preview",
    },
  });
  const contentType = String(upstream.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  const declaredLength = Number(upstream.headers.get("content-length") || 0);
  if (
    !upstream.ok ||
    !IMAGE_TYPES.has(contentType) ||
    (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES)
  ) {
    await upstream.body?.cancel().catch(() => undefined);
    throw new Error("Imagen upstream inválida.");
  }
  if (method === "HEAD") return { body: Buffer.alloc(0), contentType };
  const body = await readLimitedBodyV7Beta(upstream, MAX_IMAGE_BYTES);
  if (!body.length) throw new Error("Imagen vacía.");
  return { body, contentType };
}

export function createMediaBudgetV7Beta({
  maxConcurrency = MEDIA_MAX_CONCURRENCY,
  maxQueue = MEDIA_MAX_QUEUE,
  maxEntries = MEDIA_CACHE_ENTRIES,
  ttlMs = MEDIA_CACHE_TTL_MS,
}: {
  maxConcurrency?: number;
  maxQueue?: number;
  maxEntries?: number;
  ttlMs?: number;
} = {}): MediaBudgetV7Beta {
  const concurrency = boundedInteger(maxConcurrency, MEDIA_MAX_CONCURRENCY, 1, 16);
  const queueLimit = boundedInteger(maxQueue, MEDIA_MAX_QUEUE, 0, 256);
  const entryLimit = boundedInteger(maxEntries, MEDIA_CACHE_ENTRIES, 1, 256);
  const cacheTtl = boundedInteger(ttlMs, MEDIA_CACHE_TTL_MS, 1_000, 60 * 60 * 1000);
  const cache = new Map<string, { expiresAt: number; payload: MediaPayloadV7Beta }>();
  const inFlight = new Map<string, Promise<MediaPayloadV7Beta>>();
  const waiters: Array<() => void> = [];
  let active = 0;

  const acquire = async () => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    if (waiters.length >= queueLimit) throw new MediaBudgetExceededV7Beta("Presupuesto de imágenes agotado.");
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };

  return {
    async load(key, loader) {
      const cached = cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        cache.delete(key);
        cache.set(key, cached);
        return cached.payload;
      }
      if (cached) cache.delete(key);
      const pending = inFlight.get(key);
      if (pending) return pending;

      const operation = (async () => {
        await acquire();
        try {
          const payload = await loader();
          cache.set(key, { expiresAt: Date.now() + cacheTtl, payload });
          while (cache.size > entryLimit) cache.delete(cache.keys().next().value as string);
          return payload;
        } finally {
          release();
        }
      })();
      inFlight.set(key, operation);
      try {
        return await operation;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

async function readLimitedBodyV7Beta(upstream: Response, limit: number) {
  if (!upstream.body) return Buffer.alloc(0);
  const reader = upstream.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("Imagen demasiado grande.");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    if (total > limit) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function baseHeadersV7Beta(contentType: string) {
  return {
    "content-type": contentType,
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    expires: "0",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex,nofollow",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "cross-origin-resource-policy": "same-origin",
  };
}

function sendBuffer(
  response: http.ServerResponse,
  body: Buffer,
  contentType: string,
  status = 200,
  headOnly = false,
  extraHeaders: Record<string, string> = {},
) {
  response.writeHead(status, {
    ...cacheAwareHeadersV7Beta(contentType, extraHeaders),
    ...extraHeaders,
    "content-length": String(body.length),
  });
  response.end(headOnly ? undefined : body);
}

function cacheAwareHeadersV7Beta(contentType: string, extraHeaders: Record<string, string>) {
  const headers: Record<string, string> = { ...baseHeadersV7Beta(contentType) };
  if (String(extraHeaders["cache-control"] || "").startsWith("public")) {
    delete headers.pragma;
    delete headers.expires;
  }
  return headers;
}

function sendHtml(response: http.ServerResponse, body: string, status = 200, headOnly = false) {
  sendBuffer(response, Buffer.from(body), "text/html; charset=utf-8", status, headOnly);
}

function sendJson(response: http.ServerResponse, value: unknown, status = 200, headOnly = false) {
  sendBuffer(response, Buffer.from(JSON.stringify(value)), "application/json; charset=utf-8", status, headOnly);
}

function sendText(
  response: http.ServerResponse,
  body: string,
  status = 200,
  headOnly = false,
  extraHeaders: Record<string, string> = {},
) {
  sendBuffer(response, Buffer.from(body), "text/plain; charset=utf-8", status, headOnly, extraHeaders);
}

const handlerV7BetaVercel = createV7BetaVercelHandler();

export default handlerV7BetaVercel;
