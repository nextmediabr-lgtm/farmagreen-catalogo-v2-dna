import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalog, product, similar } from "./data.js";
import { catalogPage, notFound, productPage } from "./render.js";
import { catalogPageV67, catalogV67, notFoundPageV67, productPageV67, productV67, similarV67 } from "./render-v67.js";
import { handleV68Request, headersV68, type Environment } from "./server-v68.js";
import { handleV69Request } from "./server-v69.js";
import { createCommerceRuntimeV69 } from "./commerce-runtime-v69.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 8094);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_ROUTE = process.env.DEFAULT_ROUTE || "/catalogo/";
const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};
const PUBLIC_ASSETS = new Set([
  "/styles.css",
  "/styles-v6-5.css",
  "/styles-v6-6.css",
  "/styles-v6-7.css",
  "/styles-v6-8.css",
  "/styles-v6-9.css",
  "/app.js",
  "/app-v6-7.js",
  "/app-v6-8.js",
  "/app-v6-9.js",
  "/logo_farmagreen.png",
]);

export function app(environment: Environment = process.env) {
  const commerceRuntimeV69 = createCommerceRuntimeV69(environment);
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "local"}`);
      const pathname = normalize(decodeURIComponent(url.pathname));

      if (await handleV69Request(response, url, pathname, environment, commerceRuntimeV69, request)) return;
      if (pathname === "/") {
        sendRedirect(response, DEFAULT_ROUTE);
        return;
      }
      if (await handleV68Request(response, url, pathname, environment)) return;

      if (pathname === "/catalogo-v6-7") {
        sendHtml(response, catalogPageV67(await catalogV67(), url.searchParams));
        return;
      }
      if (pathname.startsWith("/producto-v6-7/")) {
        const found = await productV67(pathname.slice("/producto-v6-7/".length));
        sendHtml(response, found ? productPageV67(found, await similarV67(found)) : notFoundPageV67(), found ? 200 : 404);
        return;
      }

      if (pathname === "/catalogo") {
        sendHtml(response, catalogPage(await catalog()));
        return;
      }
      if (pathname === "/api/catalog") {
        sendJson(response, await catalog());
        return;
      }
      if (pathname.startsWith("/producto/")) {
        const found = await product(pathname.slice("/producto/".length));
        sendHtml(response, found ? productPage(found, await similar(found)) : notFound(), found ? 200 : 404);
        return;
      }

      if (PUBLIC_ASSETS.has(pathname)) {
        const file = path.join(PUBLIC, pathname);
        sendBinary(response, await fs.readFile(file), MIME[path.extname(file)] || "application/octet-stream");
        return;
      }

      sendText(response, "Acceso denegado.", 403);
    } catch (error) {
      console.error(error);
      sendText(response, "Error local.", 500);
    }
  });
}

function baseHeaders(extra: Record<string, string> = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "x-robots-tag": "noindex,nofollow",
    ...extra,
  };
}

function legacyHeaders(extra: Record<string, string> = {}) {
  return baseHeaders({
    "content-security-policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data: https://storage.googleapis.com https://gpsfarma.com https://9dejulio.gpsfarma.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    ...extra,
  });
}

function sendRedirect(response: http.ServerResponse, location: string) {
  response.writeHead(302, headersV68({ location, "cache-control": "no-store" }));
  response.end();
}

function sendHtml(response: http.ServerResponse, body: string, status = 200) {
  response.writeHead(
    status,
    legacyHeaders({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    }),
  );
  response.end(body);
}

function sendJson(response: http.ServerResponse, body: unknown) {
  response.writeHead(200, legacyHeaders({ "content-type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(body));
}

function sendText(response: http.ServerResponse, body: string, status: number) {
  response.writeHead(status, headersV68({ "content-type": "text/plain; charset=utf-8" }));
  response.end(body);
}

function sendBinary(response: http.ServerResponse, body: Buffer, contentType: string) {
  response.writeHead(
    200,
    headersV68({
      "content-type": contentType,
      "cache-control": "no-cache",
    }),
  );
  response.end(body);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app().listen(PORT, HOST, () => {
    console.log(`FarmaGreen 2.0 DNA: http://${HOST}:${PORT}${DEFAULT_ROUTE}`);
  });
}

function normalize(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
