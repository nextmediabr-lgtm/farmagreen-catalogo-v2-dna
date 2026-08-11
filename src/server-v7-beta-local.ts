import fs from "node:fs/promises";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const MAX_IMAGE_BYTES = 12_000_000;
const EXPECTED_SOURCE_COUNT_V7_BETA = 16;
const REQUIRED_EXPANSION_FACETS_V7_BETA = [
  "neutrogena",
  "omron",
  "cerave",
  "dermocosmetica-activa",
  "cuidado-de-la-piel",
];
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://storage.googleapis.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

const ASSETS = new Map([
  ["/app-v7-beta.js", { file: "app-v7-beta.js", type: "text/javascript; charset=utf-8" }],
  ["/styles-v6-9-1.css", { file: "styles-v6-9-1.css", type: "text/css; charset=utf-8" }],
  ["/styles-v7-beta.css", { file: "styles-v7-beta.css", type: "text/css; charset=utf-8" }],
  ["/logo_farmagreen.png", { file: "logo_farmagreen.png", type: "image/png" }],
  ["/farmagreen-social-preview-v69-social-2.png", { file: "farmagreen-social-preview-v69.png", type: "image/png" }],
]);

export function appV7BetaLocal(environment: NodeJS.ProcessEnv = process.env) {
  return http.createServer(async (request, response) => {
    try {
      if (environment.NODE_ENV === "production") {
        sendText(response, "V7 Beta está habilitada sólo en local.", 503);
        return;
      }
      const origin = `http://${request.headers.host || "127.0.0.1:8113"}`;
      const url = new URL(request.url || "/", origin);
      const pathname = normalizePath(url.pathname);

      if (pathname === "/robots.txt") {
        send(response, Buffer.from("User-agent: *\nDisallow: /\n"), "text/plain; charset=utf-8");
        return;
      }
      const asset = ASSETS.get(pathname);
      if (asset) {
        send(response, await fs.readFile(path.join(PUBLIC, asset.file)), asset.type);
        return;
      }
      if (pathname.startsWith("/media-v7-beta/")) {
        await sendSourceImage(response, pathname);
        return;
      }

      const catalog = await catalogV69();
      if (pathname === "/" || pathname === "/inicio-v7-beta") {
        sendHtml(response, homePageV69(catalog, origin));
        return;
      }
      if (pathname === "/catalogo" || pathname === "/catalogo-v7-beta") {
        sendHtml(response, catalogPageV69(catalog, url.searchParams, origin));
        return;
      }
      if (pathname === "/api/catalog-v7-beta") {
        sendJson(response, publicCatalogV69(catalog));
        return;
      }
      if (pathname === "/api/catalog-v7-beta/health") {
        const available = catalog.products.filter((product) => product.availability === "limited").length;
        const unavailable = catalog.products.filter((product) => product.availability === "out_of_stock").length;
        const unverified = catalog.products.length - available - unavailable;
        const readiness = catalogReadinessV7Beta(catalog, unverified);
        sendJson(response, {
          status: readiness.ready ? "ready" : "not_ready",
          version: 7,
          releaseChannel: "beta-local",
          inventoryLocation: "Rosario",
          inventorySource: "STOM",
          totalProducts: catalog.products.length,
          availabilitySummary: {
            available,
            unavailable,
            unverified,
          },
          commerceSyncedAt: catalog.commerceSyncedAt,
          sourceCoverage: catalog.v7Beta?.sourceCoverage ?? 0,
          missingSourceIds: catalog.v7Beta?.missingSourceIds || [],
          missingFacetSlugs: readiness.missingFacetSlugs,
        }, readiness.ready ? 200 : 503);
        return;
      }
      if (pathname.startsWith("/p-v7-beta/")) {
        const id = pathname.slice("/p-v7-beta/".length);
        const product = await productV69(id);
        sendHtml(
          response,
          product ? productPageV69(product, await similarV69(product), origin) : notFoundPageV69(origin),
          product ? 200 : 404,
        );
        return;
      }
      sendHtml(response, notFoundPageV69(origin), 404);
    } catch (error) {
      console.error(error);
      sendText(response, "Error V7 Beta Local.", 500);
    }
  });
}

export function catalogReadinessV7Beta(catalog: Awaited<ReturnType<typeof catalogV69>>, unverified?: number) {
  const sourceIds = new Set((catalog.v7Beta?.sourceIds || []).map(String));
  const visibleFacets = new Set(
    catalog.products.flatMap((product) => (product.catalogFacets || []).map((facet) => facet.slug)),
  );
  const missingFacetSlugs = REQUIRED_EXPANSION_FACETS_V7_BETA.filter((slug) => !visibleFacets.has(slug));
  const unknown = unverified ?? catalog.products.filter(
    (product) => !["limited", "out_of_stock"].includes(product.availability),
  ).length;
  const ready = Boolean(
    catalog.products.length > 0 &&
    unknown === 0 &&
    catalog.v7Beta?.sourcesComplete === true &&
    catalog.v7Beta?.expectedSourceCount === EXPECTED_SOURCE_COUNT_V7_BETA &&
    sourceIds.size === EXPECTED_SOURCE_COUNT_V7_BETA &&
    catalog.v7Beta?.currentCycleCoverage === 1 &&
    catalog.v7Beta?.inventoryLocation === "Rosario" &&
    catalog.v7Beta?.inventorySource === "STOM" &&
    catalog.commerceSyncedAt &&
    catalog.commerceSyncedAt === catalog.v7Beta?.completedAt &&
    missingFacetSlugs.length === 0
  );
  return { ready, missingFacetSlugs };
}

async function sendSourceImage(response: http.ServerResponse, pathname: string) {
  const match = pathname.match(/^\/media-v7-beta\/([^/]+)\/(card|detail)$/);
  if (!match) {
    sendText(response, "Imagen no encontrada.", 404);
    return;
  }
  const product = await productV69(decodeURIComponent(match[1]));
  const source = sourceImageV69(product, match[2] as "card" | "detail");
  if (!product || !isPrivateSourceImageV69(source)) {
    sendText(response, "Imagen no encontrada.", 404);
    return;
  }
  const upstream = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*", "user-agent": "Farmagreen-V7-Beta-Local" },
  });
  const contentType = String(upstream.headers.get("content-type") || "").split(";", 1)[0];
  const declaredLength = Number(upstream.headers.get("content-length") || 0);
  if (!upstream.ok || !contentType.startsWith("image/") || declaredLength > MAX_IMAGE_BYTES) {
    sendText(response, "Imagen no disponible.", 502);
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  if (!body.length || body.length > MAX_IMAGE_BYTES) {
    sendText(response, "Imagen no disponible.", 502);
    return;
  }
  send(response, body, contentType);
}

function normalizePath(value: string) {
  const normalized = decodeURIComponent(value).replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

function baseHeaders(contentType: string) {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "x-robots-tag": "noindex,nofollow",
    "referrer-policy": "no-referrer",
  };
}

function send(response: http.ServerResponse, body: Buffer, contentType: string, status = 200) {
  response.writeHead(status, { ...baseHeaders(contentType), "content-length": String(body.length) });
  response.end(body);
}

function sendHtml(response: http.ServerResponse, body: string, status = 200) {
  send(response, Buffer.from(body), "text/html; charset=utf-8", status);
}

function sendJson(response: http.ServerResponse, value: unknown, status = 200) {
  send(response, Buffer.from(JSON.stringify(value)), "application/json; charset=utf-8", status);
}

function sendText(response: http.ServerResponse, body: string, status = 200) {
  send(response, Buffer.from(body), "text/plain; charset=utf-8", status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8113);
  const host = process.env.HOST || "127.0.0.1";
  appV7BetaLocal().listen(port, host, () => {
    process.stdout.write(`V7 Beta Local: http://${host}:${port}/catalogo-v7-beta\n`);
  });
}
