import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Product } from "./data.js";
import {
  catalogPageV68,
  catalogV68,
  isPrivateSourceImageV68,
  notFoundPageV68,
  productPageV68,
  publicCatalogV68,
  similarV68,
  sourceImageV68,
} from "./render-v68.js";
import { readResponseBodyWithinLimit } from "./server-v68.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "vercel-v68");
const CONFIG = path.join(ROOT, "dist", "vercel-v68-config.json");
const MAX_IMAGE_BYTES = 12_000_000;
const IMAGE_CONCURRENCY = 6;
const PUBLIC_ORIGIN = productionOrigin(process.env.PUBLIC_ORIGIN);
const IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, "catalogo-v6-8"), { recursive: true });
await fs.mkdir(path.join(OUT, "producto-v6-8"), { recursive: true });
await fs.mkdir(path.join(OUT, "api"), { recursive: true });
await fs.writeFile(path.join(OUT, ".nojekyll"), "");

const catalog = await catalogV68();
await fs.writeFile(path.join(OUT, "index.html"), redirect(), "utf8");
await fs.writeFile(path.join(OUT, "404.html"), notFoundPageV68(PUBLIC_ORIGIN), "utf8");
await fs.writeFile(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");
await fs.writeFile(
  path.join(OUT, "catalogo-v6-8", "index.html"),
  catalogPageV68(catalog, new URLSearchParams(), PUBLIC_ORIGIN),
  "utf8",
);
await fs.writeFile(
  path.join(OUT, "api", "catalog-v6-8.json"),
  JSON.stringify(publicCatalogV68(catalog)),
  "utf8",
);

for (const name of [
  "app-v6-8.js",
  "styles-v6-5.css",
  "styles-v6-6.css",
  "styles-v6-7.css",
  "styles-v6-8.css",
  "logo_farmagreen.png",
]) {
  await fs.copyFile(path.join(ROOT, "public", name), path.join(OUT, name));
}

for (const product of catalog.products) {
  const directory = path.join(OUT, "producto-v6-8", product.slug);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "index.html"),
    productPageV68(product, await similarV68(product), PUBLIC_ORIGIN),
    "utf8",
  );
}

const overrides: Record<string, { path?: string; contentType?: string }> = {
  "api/catalog-v6-8.json": {
    path: "api/catalog-v6-8",
    contentType: "application/json; charset=utf-8",
  },
};
const mediaTasks = catalog.products.flatMap((product) =>
  (["card", "detail"] as const)
    .map((kind) => ({ product, kind, source: sourceImageV68(product, kind) }))
    .filter((task) => isPrivateSourceImageV68(task.source)),
);
const downloaded = new Map<string, Promise<{ file: string; contentType: string }>>();

await mapLimit(mediaTasks, IMAGE_CONCURRENCY, async (task) => {
  const relative = path.posix.join("media-v6-8", task.product.publicId, task.kind);
  const target = path.join(OUT, ...relative.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });

  let asset = downloaded.get(task.source);
  if (!asset) {
    asset = (async () => {
      const { body, contentType } = await downloadTrustedImage(task.source);
      await fs.writeFile(target, body);
      return { file: target, contentType };
    })();
    downloaded.set(task.source, asset);
  }

  const resolved = await asset;
  if (resolved.file !== target) await fs.link(resolved.file, target);
  overrides[relative] = { contentType: resolved.contentType };
});

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://storage.googleapis.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Robots-Tag": "noindex,nofollow",
};
await fs.writeFile(
  CONFIG,
  `${JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/media-v6-8/.*", headers: { "Cache-Control": "public, max-age=86400" }, continue: true },
        { src: "/.*", headers: securityHeaders, continue: true },
        { handle: "filesystem" },
      ],
      overrides,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `${JSON.stringify({
    products: catalog.products.length,
    privateMediaFiles: mediaTasks.length,
    uniquePrivateImages: downloaded.size,
    output: OUT,
  })}\n`,
);

function productionOrigin(value: string | undefined) {
  if (!value) throw new Error("PUBLIC_ORIGIN es obligatorio para exportar V6.8.");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("PUBLIC_ORIGIN debe ser un origen HTTPS público válido.");
  }
  return parsed.origin;
}

async function downloadTrustedImage(source: string) {
  if (!isPrivateSourceImageV68(source)) throw new Error("Origen de imagen no permitido.");
  let failure: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(source, {
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
          "user-agent": "Farmagreen-V6.8-Public-Test-Exporter/1.0",
        },
      });
      if (!response.ok) throw new Error(`Imagen HTTP ${response.status}.`);
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
      if (!IMAGE_TYPES.has(contentType)) throw new Error(`Tipo de imagen no permitido: ${contentType || "vacío"}.`);
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_IMAGE_BYTES) throw new Error("Imagen excede el máximo permitido.");
      const body = await readResponseBodyWithinLimit(response, MAX_IMAGE_BYTES);
      if (!body) throw new Error("Imagen excede el máximo permitido.");
      return { body, contentType };
    } catch (error) {
      failure = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw failure instanceof Error ? failure : new Error(String(failure));
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

function redirect() {
  const route = "/catalogo-v6-8/";
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0; url=${route}"><link rel="canonical" href="${PUBLIC_ORIGIN}${route}"><title>FarmaGreen V6.8</title></head><body><a href="${route}">Abrir catálogo V6.8</a></body></html>`;
}
