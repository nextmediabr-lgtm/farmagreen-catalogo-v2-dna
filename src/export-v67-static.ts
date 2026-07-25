import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogPageV67, catalogV67, notFoundPageV67, productPageV67, similarV67 } from "./render-v67.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "vercel-v67");
const BASE = (process.env.PUBLIC_BASE_PATH || "").replace(/\/$/, "");

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, "catalogo-v6-7"), { recursive: true });
await fs.mkdir(path.join(OUT, "producto-v6-7"), { recursive: true });
await fs.writeFile(path.join(OUT, ".nojekyll"), "");

const catalog = await catalogV67();
await fs.writeFile(path.join(OUT, "index.html"), redirect(), "utf8");
await fs.writeFile(path.join(OUT, "404.html"), notFoundPageV67(), "utf8");
await fs.writeFile(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");
await fs.writeFile(path.join(OUT, "catalogo-v6-7", "index.html"), catalogPageV67(catalog), "utf8");

for (const name of ["app-v6-7.js", "styles-v6-5.css", "styles-v6-6.css", "styles-v6-7.css", "logo_farmagreen.png"]) {
  await fs.copyFile(path.join(ROOT, "public", name), path.join(OUT, name));
}

for (const product of catalog.products) {
  const dir = path.join(OUT, "producto-v6-7", product.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), productPageV67(product, await similarV67(product)), "utf8");
}

function redirect() {
  const route = `${BASE}/catalogo-v6-7/`;
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0; url=${route}"><link rel="canonical" href="${route}"><title>FarmaGreen V6.7</title></head><body><a href="${route}">Abrir catálogo V6.7</a></body></html>`;
}
