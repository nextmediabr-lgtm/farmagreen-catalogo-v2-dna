import type http from "node:http";
import type { Catalog } from "./data.js";
import {
  catalogPageV68,
  catalogV68,
  isPrivateSourceImageV68,
  notFoundPageV68,
  productPageV68,
  productV68,
  publicCatalogV68,
  similarV68,
  sourceImageV68,
} from "./render-v68.js";

const MAX_SOURCE_IMAGE_BYTES = 12_000_000;
const SOURCE_IMAGE_TIMEOUT_MS = 15_000;
const V68_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://storage.googleapis.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

export type Environment = Readonly<Record<string, string | undefined>>;

export function headersV68(extra: Record<string, string> = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "x-robots-tag": "noindex,nofollow",
    "content-security-policy": V68_CSP,
    ...extra,
  };
}

export function sourceImageBridgeEnabled(environment: Environment = process.env) {
  return (
    environment.NODE_ENV !== "production" &&
    environment.V68_LOCAL_PREVIEW === "1" &&
    environment.V68_DISABLE_SOURCE_IMAGE_BRIDGE !== "1"
  );
}

export function catalogReadyForRuntimeV68(catalog: Catalog, environment: Environment = process.env) {
  if (environment.NODE_ENV !== "production") return environment.V68_LOCAL_PREVIEW === "1";
  if (environment.V68_ENABLE_PRODUCTION !== "1") return false;
  try {
    publicOriginV68("http://invalid.local", environment);
  } catch {
    return false;
  }
  return catalog.products.every((product) =>
    (["card", "detail"] as const).every((kind) => {
      try {
        const image = new URL(sourceImageV68(product, kind));
        return image.protocol === "https:" && image.hostname === "storage.googleapis.com";
      } catch {
        return false;
      }
    }),
  );
}

export function publicOriginV68(requestOrigin: string, environment: Environment = process.env) {
  const configured = environment.PUBLIC_ORIGIN?.trim();
  if (!configured) {
    if (environment.NODE_ENV === "production") {
      throw new Error("PUBLIC_ORIGIN es obligatorio para servir V6.8 en producción.");
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

export async function handleV68Request(
  response: http.ServerResponse,
  url: URL,
  pathname: string,
  environment: Environment = process.env,
) {
  const isV68Route =
    pathname === "/catalogo-v6-8" ||
    pathname === "/api/catalog-v6-8" ||
    pathname.startsWith("/producto-v6-8/") ||
    pathname.startsWith("/media-v6-8/");
  if (!isV68Route) return false;

  const catalog = await catalogV68();
  if (!catalogReadyForRuntimeV68(catalog, environment)) {
    sendTextV68(response, "V6.8 todavía no está habilitada para producción.", 503);
    return true;
  }

  if (pathname === "/catalogo-v6-8") {
    sendHtmlV68(response, catalogPageV68(catalog, url.searchParams, publicOriginV68(url.origin, environment)));
    return true;
  }

  if (pathname.startsWith("/producto-v6-8/")) {
    const found = await productV68(pathname.slice("/producto-v6-8/".length));
    const origin = publicOriginV68(url.origin, environment);
    sendHtmlV68(
      response,
      found ? productPageV68(found, await similarV68(found), origin) : notFoundPageV68(origin),
      found ? 200 : 404,
    );
    return true;
  }

  if (pathname === "/api/catalog-v6-8") {
    sendJsonV68(response, publicCatalogV68(catalog));
    return true;
  }

  if (pathname.startsWith("/media-v6-8/")) {
    await sendSourceImageV68(response, pathname.slice("/media-v6-8/".length), environment);
    return true;
  }

  return true;
}

function sendHtmlV68(response: http.ServerResponse, body: string, status = 200) {
  response.writeHead(
    status,
    headersV68({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    }),
  );
  response.end(body);
}

function sendJsonV68(response: http.ServerResponse, body: unknown) {
  response.writeHead(
    200,
    headersV68({
      "content-type": "application/json; charset=utf-8",
    }),
  );
  response.end(JSON.stringify(body));
}

function sendTextV68(response: http.ServerResponse, body: string, status: number) {
  response.writeHead(
    status,
    headersV68({
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

async function sendSourceImageV68(response: http.ServerResponse, target: string, environment: Environment) {
  if (!sourceImageBridgeEnabled(environment)) {
    sendTextV68(response, "Imagen temporal no disponible.", 503);
    return;
  }

  const [id, kind, ...extra] = target.split("/");
  if (!id || !["card", "detail"].includes(kind) || extra.length) {
    sendTextV68(response, "Imagen no disponible.", 404);
    return;
  }

  const found = await productV68(id);
  if (!found) {
    sendTextV68(response, "Imagen no disponible.", 404);
    return;
  }

  const source = sourceImageV68(found, kind as "card" | "detail");
  if (!isPrivateSourceImageV68(source)) {
    sendTextV68(response, "Imagen no disponible.", 404);
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
    sendTextV68(response, "Imagen no disponible.", 502);
    return;
  }

  const contentType = upstream.headers.get("content-type")?.split(";")[0].trim() || "";
  if (!contentType.startsWith("image/")) {
    sendTextV68(response, "Imagen no disponible.", 502);
    return;
  }

  const declaredSize = Number(upstream.headers.get("content-length") || 0);
  if (declaredSize > MAX_SOURCE_IMAGE_BYTES) {
    sendTextV68(response, "Imagen no disponible.", 413);
    return;
  }

  const body = await readResponseBodyWithinLimit(upstream, MAX_SOURCE_IMAGE_BYTES);
  if (!body) {
    sendTextV68(response, "Imagen no disponible.", 413);
    return;
  }

  response.writeHead(
    200,
    headersV68({
      "content-type": contentType,
      "content-length": String(body.length),
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    }),
  );
  response.end(body);
}
