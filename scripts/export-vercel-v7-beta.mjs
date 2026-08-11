import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const OUTPUT = path.join(DIST, "vercel-v7-beta");
const EXPECTED_OUTPUT = path.resolve(ROOT, "dist", "vercel-v7-beta");
const DEFAULT_SNAPSHOT = path.join(os.tmpdir(), "farmagreen-catalog-v7-beta.json");
const ENTRY = path.join(DIST, "server-v7-beta-vercel.js");
const PUBLIC = path.join(ROOT, "public");
const ASSETS = [
  ["app-v7-beta.js", "app-v7-beta.js"],
  ["styles-v6-9-1.css", "styles-v6-9-1.css"],
  ["styles-v7-beta.css", "styles-v7-beta.css"],
  ["logo_farmagreen.png", "logo_farmagreen.png"],
  ["farmagreen-social-preview-v69.png", "farmagreen-social-preview-v69-social-2.png"],
];

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://storage.googleapis.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const MEDIA_CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export async function exportVercelV7Beta(options = {}) {
  assertSafeOutput();
  const snapshotFile = path.resolve(options.snapshotFile || DEFAULT_SNAPSHOT);
  const snapshotText = await readRequired(snapshotFile, "snapshot V7 Beta final");
  const snapshot = parseSnapshot(snapshotText, snapshotFile);
  const readiness = await validateReadiness(snapshot);
  const compiledFiles = await collectCompiledDependencies(ENTRY);
  await validateAssets();

  await fs.rm(OUTPUT, { recursive: true, force: true });
  await fs.mkdir(path.join(OUTPUT, "api"), { recursive: true });
  await fs.mkdir(path.join(OUTPUT, "data"), { recursive: true });
  await fs.mkdir(path.join(OUTPUT, "_runtime"), { recursive: true });

  for (const source of compiledFiles) {
    const relative = path.relative(DIST, source);
    const destination = path.join(OUTPUT, "_runtime", relative);
    assertInside(destination, path.join(OUTPUT, "_runtime"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  await fs.writeFile(
    path.join(OUTPUT, "api", "index.js"),
    'export { default } from "../_runtime/server-v7-beta-vercel.js";\n',
    "utf8",
  );

  await fs.copyFile(snapshotFile, path.join(OUTPUT, "data", "catalog-v7-beta.json"));
  for (const [sourceName, destinationName] of ASSETS) {
    await fs.copyFile(path.join(PUBLIC, sourceName), path.join(OUTPUT, destinationName));
  }

  await fs.writeFile(path.join(OUTPUT, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");
  await fs.writeFile(path.join(OUTPUT, "package.json"), `${JSON.stringify(minimalPackage(), null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(OUTPUT, "vercel.json"), `${JSON.stringify(vercelConfig(), null, 2)}\n`, "utf8");
  await assertCredentialFreeBundle(OUTPUT);

  const result = {
    output: OUTPUT,
    products: snapshot.products.length,
    sourceCoverage: snapshot.v7Beta?.sourceCoverage ?? 0,
    compiledFiles: compiledFiles.length,
    missingFacetSlugs: readiness.missingFacetSlugs,
  };
  process.stdout.write(`V7 Beta Vercel bundle listo: ${JSON.stringify(result)}\n`);
  return result;
}

async function assertCredentialFreeBundle(directory) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      assertInside(candidate, directory);
      if (entry.isDirectory()) {
        if (entry.name === ".vercel") throw new Error("El bundle V7 Beta contiene metadata local de Vercel.");
        pending.push(candidate);
        continue;
      }
      if (/^\.env(?:\.|$)/i.test(entry.name)) {
        throw new Error("El bundle V7 Beta contiene un archivo de entorno.");
      }
      if (!entry.isFile()) throw new Error("El bundle V7 Beta contiene una entrada no regular.");
      const body = await fs.readFile(candidate);
      if (body.includes(Buffer.from("VERCEL_OIDC_TOKEN="))) {
        throw new Error("El bundle V7 Beta contiene una credencial OIDC.");
      }
    }
  }
}

function assertSafeOutput() {
  if (path.resolve(OUTPUT) !== EXPECTED_OUTPUT || path.dirname(EXPECTED_OUTPUT) !== path.resolve(DIST)) {
    throw new Error("Destino Vercel V7 Beta inseguro.");
  }
}

function assertInside(candidate, parent) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedParent = path.resolve(parent);
  if (resolvedCandidate !== resolvedParent && !resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error("Archivo de bundle fuera del destino permitido.");
  }
}

async function readRequired(filePath, label) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`No se pudo leer ${label}: ${filePath}`, { cause: error });
  }
}

function parseSnapshot(text, filePath) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Snapshot V7 Beta inválido: ${filePath}`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.products)) {
    throw new Error("Snapshot V7 Beta inválido: falta products.");
  }
  if (value.version !== 7 || value.releaseChannel !== "beta-local") {
    throw new Error("Snapshot V7 Beta inválido: versión o canal incorrectos.");
  }
  return value;
}

async function validateReadiness(snapshot) {
  const readinessFile = path.join(DIST, "server-v7-beta-local.js");
  await readRequired(readinessFile, "server-v7-beta-local.js compilado");
  const stats = await fs.stat(readinessFile);
  const moduleUrl = `${pathToFileURL(readinessFile).href}?readiness=${stats.mtimeMs}`;
  const { catalogReadinessV7Beta } = await import(moduleUrl);
  if (typeof catalogReadinessV7Beta !== "function") {
    throw new Error("Readiness V7 Beta compilada inválida.");
  }
  const unverified = snapshot.products.filter(
    (product) => !product || !["limited", "out_of_stock"].includes(product.availability),
  ).length;
  const readiness = catalogReadinessV7Beta(snapshot, unverified);
  if (!readiness.ready) {
    const missingSources = Array.isArray(snapshot.v7Beta?.missingSourceIds)
      ? snapshot.v7Beta.missingSourceIds.join(",")
      : "desconocidas";
    const missingFacets = readiness.missingFacetSlugs.join(",") || "ninguna";
    throw new Error(
      `Snapshot V7 Beta no ready: unverified=${unverified}; fuentes=${missingSources}; facetas=${missingFacets}.`,
    );
  }
  return readiness;
}

async function collectCompiledDependencies(entry) {
  const pending = [path.resolve(entry)];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    assertInside(current, DIST);
    const source = await readRequired(current, `JavaScript compilado ${path.relative(DIST, current)}`);
    visited.add(current);
    for (const specifier of relativeJavaScriptImports(source)) {
      const dependency = path.resolve(path.dirname(current), specifier);
      assertInside(dependency, DIST);
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...visited].sort((left, right) => left.localeCompare(right));
}

function relativeJavaScriptImports(source) {
  const imports = new Set();
  const patterns = [
    /\bfrom\s+["'](\.[^"']+\.js)["']/g,
    /\bimport\s+["'](\.[^"']+\.js)["']/g,
    /\bimport\(\s*["'](\.[^"']+\.js)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.add(match[1]);
  }
  return [...imports];
}

async function validateAssets() {
  for (const [sourceName] of ASSETS) {
    await readRequired(path.join(PUBLIC, sourceName), `asset ${sourceName}`);
  }
}

function minimalPackage() {
  return {
    name: "farmagreen-v7-beta-vercel-preview",
    private: true,
    type: "module",
  };
}

function vercelConfig() {
  const commonHeaders = {
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex,nofollow",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": CSP,
  };
  return {
    version: 2,
    functions: {
      "api/index.js": {
        includeFiles: "data/catalog-v7-beta.json",
        maxDuration: 15,
      },
    },
    routes: [
      { src: "/.*", headers: commonHeaders, continue: true },
      { src: "/media-v7-beta/.*", headers: { "Cache-Control": MEDIA_CACHE_CONTROL }, continue: true },
      { src: "/data", dest: "/api/index?__v7_route=blocked" },
      { src: "/data/(.*)", dest: "/api/index?__v7_route=blocked" },
      { src: "/_runtime", dest: "/api/index?__v7_route=blocked" },
      { src: "/_runtime/(.*)", dest: "/api/index?__v7_route=blocked" },
      { src: "/(?:.*\\/)?\\.[^/]+(?:/.*)?", dest: "/api/index?__v7_route=blocked" },
      { src: "/", dest: "/api/index?__v7_route=home" },
      { src: "/inicio-v7-beta", dest: "/api/index?__v7_route=home" },
      { src: "/catalogo", dest: "/api/index?__v7_route=catalog" },
      { src: "/catalogo-v7-beta", dest: "/api/index?__v7_route=catalog" },
      { src: "/api/catalog-v7-beta/health", dest: "/api/index?__v7_route=health" },
      { src: "/api/catalog-v7-beta", dest: "/api/index?__v7_route=catalog-api" },
      { src: "/p-v7-beta/([^/]+)", dest: "/api/index?__v7_route=product&__v7_id=$1" },
      { src: "/media-v7-beta/([^/]+)/(card|detail)", dest: "/api/index?__v7_route=media&__v7_id=$1&__v7_kind=$2" },
      { handle: "filesystem" },
      { src: "/.*", dest: "/api/index?__v7_route=blocked" },
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportVercelV7Beta({ snapshotFile: process.env.V7_BETA_SNAPSHOT_FILE || DEFAULT_SNAPSHOT }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
