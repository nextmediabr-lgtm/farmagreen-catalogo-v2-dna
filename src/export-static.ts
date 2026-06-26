import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalog, product, similar } from "./data.js";
import { catalogPage, notFound, productPage } from "./render.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "site");
const BASE = (process.env.PUBLIC_BASE_PATH || "").replace(/\/$/, "");

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(path.join(OUT, "catalogo"), { recursive: true });
await fs.mkdir(path.join(OUT, "producto"), { recursive: true });
await fs.mkdir(path.join(OUT, "assets"), { recursive: true });
await fs.writeFile(path.join(OUT, ".nojekyll"), "");

const c = await catalog();
await fs.writeFile(path.join(OUT, "index.html"), indexRedirect());
await fs.writeFile(path.join(OUT, "catalogo", "index.html"), catalogPage(c), "utf8");
await fs.writeFile(path.join(OUT, "404.html"), notFound(), "utf8");
await fs.writeFile(path.join(OUT, "assets", "logo_farmagreen.png"), await fs.readFile(path.join(ROOT, "public", "logo_farmagreen.png")));
await fs.writeFile(path.join(OUT, "app.js"), await fs.readFile(path.join(ROOT, "public", "app.js")));
await fs.writeFile(path.join(OUT, "styles.css"), await fs.readFile(path.join(ROOT, "public", "styles.css")));

for (const p of c.products) {
  const dir = path.join(OUT, "producto", p.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), productPage(p, await similar(p)), "utf8");
}

function indexRedirect(): string {
  return `<!doctype html><meta http-equiv="refresh" content="0; url=${BASE}/catalogo/"><link rel="canonical" href="${BASE}/catalogo/"><title>FarmaGreen</title>`;
}
