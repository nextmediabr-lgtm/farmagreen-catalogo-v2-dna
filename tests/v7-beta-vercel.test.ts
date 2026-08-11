import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resetCatalogV69CacheForTests } from "../src/data-v7-beta.js";
import {
  createMediaBudgetV7Beta,
  createV7BetaVercelHandler,
} from "../src/server-v7-beta-vercel.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "dist", "vercel-v7-beta");
const COMPLETED_AT = "2026-08-07T20:00:00.000Z";
const SOURCE_IDS = [
  "5930",
  "5808",
  "5751",
  "6048",
  "6301",
  "6023",
  "5756",
  "5697",
  "5911",
  "9100",
  "revitalift",
  "6116",
  "7236",
  "6827",
  "dermocosmetica-activa",
  "cuidado-de-la-piel",
];

test("handler Vercel sirve rutas dinámicas ready, usa VERCEL_URL y no filtra datos privados", async () => {
  const previousCatalogEnvironment = captureCatalogEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "farmagreen-v7-vercel-handler-"));
  const catalogFile = path.join(directory, "catalog.json");
  await writeFile(catalogFile, JSON.stringify(readyCatalog()), "utf8");
  const upstreamCalls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    upstreamCalls.push({ url: String(input), init });
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "4" },
    });
  }) as typeof fetch;
  const handler = createV7BetaVercelHandler({
    catalogFile,
    environment: { VERCEL_URL: "farmagreen-v7-beta-preview.vercel.app" },
    fetchImpl: fakeFetch,
  });
  const { server, origin } = await listenHandler(handler);
  try {
    const routes = [
      "/",
      "/inicio-v7-beta",
      "/catalogo?scope=todo",
      "/catalogo-v7-beta?scope=todo",
      "/api/catalog-v7-beta",
      "/api/catalog-v7-beta/health",
      "/p-v7-beta/producto-v7",
      "/api/index?__v7_route=health",
    ];
    for (const route of routes) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("cache-control") || "", /no-store/);
      assert.match(response.headers.get("x-robots-tag") || "", /noindex/);
    }

    const home = await (await fetch(`${origin}/`)).text();
    assert.match(home, /https:\/\/farmagreen-v7-beta-preview\.vercel\.app\/inicio-v7-beta/);
    assert.match(home, /V7 Beta Local/);

    const apiResponse = await fetch(`${origin}/api/catalog-v7-beta`);
    const apiText = await apiResponse.text();
    assert.doesNotMatch(apiText, /"sku"\s*:|"source"\s*:|gpsfarma\.com/i);
    const api = JSON.parse(apiText);
    assert.equal(api.totalProducts, 1);
    assert.equal(api.products[0].images.card, "/media-v7-beta/producto-v7/card");

    const health = await (await fetch(`${origin}/api/catalog-v7-beta/health`)).json() as any;
    assert.equal(health.status, "ready");
    assert.equal(health.inventorySource, "STOM");
    assert.deepEqual(health.availabilitySummary, { available: 1, unavailable: 0, unverified: 0 });

    const mediaResponse = await fetch(`${origin}/media-v7-beta/producto-v7/card`);
    assert.equal(mediaResponse.status, 200);
    assert.equal(mediaResponse.headers.get("content-type"), "image/png");
    assert.match(mediaResponse.headers.get("cache-control") || "", /s-maxage=3600/);
    assert.deepEqual([...new Uint8Array(await mediaResponse.arrayBuffer())], [137, 80, 78, 71]);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, "https://gpsfarma.com/media/catalog/product/v7/card.jpg");
    assert.equal(upstreamCalls[0].init?.redirect, "error");
    const cachedMedia = await fetch(`${origin}/media-v7-beta/producto-v7/card`);
    assert.equal(cachedMedia.status, 200);
    assert.equal(upstreamCalls.length, 1);

    const head = await fetch(`${origin}/catalogo-v7-beta`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const post = await fetch(`${origin}/api/catalog-v7-beta`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    assert.equal((await fetch(`${origin}/data/catalog-v7-beta.json`)).status, 404);
    assert.equal((await fetch(`${origin}/.env.local`)).status, 404);
    assert.equal((await fetch(`${origin}/nested/.env.production`)).status, 404);
    assert.equal((await fetch(`${origin}/p-v7-beta/no-existe`)).status, 404);
  } finally {
    await close(server);
    resetCatalogV69CacheForTests();
    restoreCatalogEnvironment(previousCatalogEnvironment);
    await rm(directory, { recursive: true, force: true });
  }
});

test("handler Vercel falla cerrado ante snapshot incompleto y nunca proxifica fuera de GPSFarma", async () => {
  const previousCatalogEnvironment = captureCatalogEnvironment();
  const directory = await mkdtemp(path.join(os.tmpdir(), "farmagreen-v7-vercel-readiness-"));
  const catalogFile = path.join(directory, "catalog.json");
  const offAllowlist = readyCatalog();
  offAllowlist.products[0].images.card = "https://images.example.test/private.jpg";
  await writeFile(catalogFile, JSON.stringify(offAllowlist), "utf8");
  let upstreamCalls = 0;
  const fakeFetch = (async () => {
    upstreamCalls += 1;
    return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  const handler = createV7BetaVercelHandler({ catalogFile, fetchImpl: fakeFetch });
  const { server, origin } = await listenHandler(handler);
  try {
    const rejectedImage = await fetch(`${origin}/media-v7-beta/producto-v7/card`);
    assert.equal(rejectedImage.status, 404);
    assert.equal(upstreamCalls, 0);

    const incomplete = readyCatalog();
    incomplete.v7Beta.sourcesComplete = false;
    incomplete.v7Beta.sourceIds = ["5930"];
    incomplete.v7Beta.sourceCoverage = 1 / SOURCE_IDS.length;
    incomplete.v7Beta.missingSourceIds = SOURCE_IDS.slice(1);
    await writeFile(catalogFile, JSON.stringify(incomplete), "utf8");
    resetCatalogV69CacheForTests();

    const healthResponse = await fetch(`${origin}/api/catalog-v7-beta/health`);
    assert.equal(healthResponse.status, 503);
    assert.equal((await healthResponse.json() as any).status, "not_ready");
    assert.equal((await fetch(`${origin}/api/catalog-v7-beta`)).status, 503);
    assert.equal((await fetch(`${origin}/catalogo-v7-beta`)).status, 503);
  } finally {
    await close(server);
    resetCatalogV69CacheForTests();
    restoreCatalogEnvironment(previousCatalogEnvironment);
    await rm(directory, { recursive: true, force: true });
  }
});

test("el presupuesto de media combina duplicados y rechaza una cola agregada excesiva", async () => {
  const budget = createMediaBudgetV7Beta({
    maxConcurrency: 1,
    maxQueue: 1,
    maxEntries: 2,
    ttlMs: 1_000,
  });
  const payload = { body: Buffer.from([1]), contentType: "image/png" };
  let startFirst!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => { startFirst = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let startSecond!: () => void;
  const secondStarted = new Promise<void>((resolve) => { startSecond = resolve; });

  const first = budget.load("first", async () => {
    startFirst();
    await firstGate;
    return payload;
  });
  await firstStarted;
  const second = budget.load("second", async () => {
    startSecond();
    return payload;
  });
  await assert.rejects(
    budget.load("third", async () => payload),
    /Presupuesto de imágenes agotado/,
  );
  releaseFirst();
  await first;
  await secondStarted;
  await second;

  let duplicateLoads = 0;
  const [left, right] = await Promise.all([
    budget.load("duplicate", async () => {
      duplicateLoads += 1;
      return payload;
    }),
    budget.load("duplicate", async () => {
      duplicateLoads += 1;
      return payload;
    }),
  ]);
  assert.equal(duplicateLoads, 1);
  assert.deepEqual(left.body, right.body);
});

test("exportador arma bundle aislado, bloquea snapshot privado y rechaza readiness inválida", async () => {
  const previousCatalogEnvironment = captureCatalogEnvironment();
  const previousVercelUrl = process.env.VERCEL_URL;
  await stat(path.join(ROOT, "dist", "server-v7-beta-vercel.js"));
  const directory = await mkdtemp(path.join(os.tmpdir(), "farmagreen-v7-vercel-export-"));
  const readyFile = path.join(directory, "ready.json");
  const incompleteFile = path.join(directory, "incomplete.json");
  await writeFile(readyFile, JSON.stringify(readyCatalog()), "utf8");
  const incomplete = readyCatalog();
  incomplete.v7Beta.sourcesComplete = false;
  incomplete.v7Beta.missingSourceIds = ["7236"];
  await writeFile(incompleteFile, JSON.stringify(incomplete), "utf8");

  try {
    await writeFile(path.join(BUNDLE, ".env.local"), "VERCEL_OIDC_TOKEN=test-only\n", "utf8").catch(() => undefined);
    const exported = await execFileAsync(process.execPath, [path.join(ROOT, "scripts", "export-vercel-v7-beta.mjs")], {
      cwd: ROOT,
      env: { ...process.env, V7_BETA_SNAPSHOT_FILE: readyFile },
    });
    assert.match(exported.stdout, /V7 Beta Vercel bundle listo/);

    const files = await walkFiles(BUNDLE);
    for (const required of [
      "api/index.js",
      "_runtime/data-v7-beta.js",
      "_runtime/render-v7-beta.js",
      "_runtime/server-v7-beta-local.js",
      "_runtime/server-v7-beta-vercel.js",
      "data/catalog-v7-beta.json",
      "app-v7-beta.js",
      "styles-v6-9-1.css",
      "logo_farmagreen.png",
      "farmagreen-social-preview-v69-social-2.png",
      "robots.txt",
      "package.json",
      "vercel.json",
    ]) assert.ok(files.includes(required), required);
    assert.equal(files.some((file) => /exclusions|package-lock|node_modules|(^|\/)\.env(?:\.|$)|(^|\/)\.vercel(\/|$)/i.test(file)), false);
    assert.deepEqual(files.filter((file) => file.startsWith("api/") && file.endsWith(".js")), ["api/index.js"]);

    const packageJson = JSON.parse(await readFile(path.join(BUNDLE, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(packageJson).sort(), ["name", "private", "type"]);
    assert.equal(packageJson.type, "module");

    const config = JSON.parse(await readFile(path.join(BUNDLE, "vercel.json"), "utf8"));
    const routeSources = config.routes.filter((route: any) => route.src).map((route: any) => route.src);
    for (const route of [
      "/",
      "/inicio-v7-beta",
      "/catalogo",
      "/catalogo-v7-beta",
      "/api/catalog-v7-beta",
      "/api/catalog-v7-beta/health",
      "/p-v7-beta/([^/]+)",
      "/media-v7-beta/([^/]+)/(card|detail)",
      "/data/(.*)",
      "/_runtime/(.*)",
      "/(?:.*\\/)?\\.[^/]+(?:/.*)?",
    ]) assert.ok(routeSources.includes(route), route);
    const filesystemIndex = config.routes.findIndex((route: any) => route.handle === "filesystem");
    assert.ok(filesystemIndex > config.routes.findIndex((route: any) => route.src === "/data/(.*)"));
    assert.ok(filesystemIndex > config.routes.findIndex((route: any) => route.src === "/_runtime/(.*)"));
    assert.ok(filesystemIndex > config.routes.findIndex((route: any) => route.src === "/(?:.*\\/)?\\.[^/]+(?:/.*)?"));
    assert.ok(filesystemIndex > config.routes.findIndex((route: any) => route.src === "/api/catalog-v7-beta"));
    assert.equal(config.routes.at(-1).dest, "/api/index?__v7_route=blocked");
    assert.equal(config.functions["api/index.js"].includeFiles, "data/catalog-v7-beta.json");
    assert.match(JSON.stringify(config.routes[0].headers), /noindex,nofollow/);
    assert.match(JSON.stringify(config.routes[0].headers), /no-store/);
    assert.match(
      JSON.stringify(config.routes.find((route: any) => route.src === "/media-v7-beta/.*")?.headers),
      /s-maxage=3600/,
    );

    const bundledJavaScript = (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".js") && (file.startsWith("api/") || file.startsWith("_runtime/")))
          .map((file) => readFile(path.join(BUNDLE, file), "utf8")),
      )
    ).join("\n");
    assert.doesNotMatch(
      bundledJavaScript,
      /google-auth-library|@google-cloud|prepare-gcp|\bgcloud\b|storage\.objects|\.upload\s*\(|\.save\s*\(/i,
    );

    process.env.VERCEL_URL = "bundle-v7-beta.vercel.app";
    const bundledModule = await import(`${pathToFileURL(path.join(BUNDLE, "api", "index.js")).href}?test=${Date.now()}`);
    const bundledHandler = bundledModule.default as (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ) => Promise<void>;
    const bundledServer = await listenHandler(bundledHandler);
    try {
      const apiResponse = await fetch(`${bundledServer.origin}/api/catalog-v7-beta`);
      assert.equal(apiResponse.status, 200);
      assert.doesNotMatch(await apiResponse.text(), /"sku"\s*:|"source"\s*:|gpsfarma\.com/i);
      assert.equal((await fetch(`${bundledServer.origin}/`)).status, 200);
      assert.equal((await fetch(`${bundledServer.origin}/catalogo-v7-beta?scope=todo`)).status, 200);
      assert.equal((await fetch(`${bundledServer.origin}/p-v7-beta/producto-v7`)).status, 200);
      assert.equal((await fetch(`${bundledServer.origin}/api/index?__v7_route=blocked`)).status, 404);
      assert.equal((await fetch(`${bundledServer.origin}/_runtime/server-v7-beta-vercel.js`)).status, 404);
    } finally {
      await close(bundledServer.server);
      if (previousVercelUrl === undefined) delete process.env.VERCEL_URL;
      else process.env.VERCEL_URL = previousVercelUrl;
    }

    await assert.rejects(
      () => execFileAsync(process.execPath, [path.join(ROOT, "scripts", "export-vercel-v7-beta.mjs")], {
        cwd: ROOT,
        env: { ...process.env, V7_BETA_SNAPSHOT_FILE: incompleteFile },
      }),
      /Snapshot V7 Beta no ready/,
    );
    await access(path.join(BUNDLE, "api", "index.js"));
  } finally {
    resetCatalogV69CacheForTests();
    restoreCatalogEnvironment(previousCatalogEnvironment);
    restoreEnvironmentValue("VERCEL_URL", previousVercelUrl);
    await rm(directory, { recursive: true, force: true });
  }
});

function readyCatalog() {
  return {
    version: 7,
    releaseChannel: "beta-local",
    syncedAt: COMPLETED_AT,
    commerceSyncedAt: COMPLETED_AT,
    availabilityReferenceAt: COMPLETED_AT,
    totalProducts: 1,
    v7Beta: {
      completedAt: COMPLETED_AT,
      inventoryLocation: "Rosario",
      inventorySource: "STOM",
      sourceIds: [...SOURCE_IDS],
      expectedSourceCount: SOURCE_IDS.length,
      sourceCoverage: 1,
      missingSourceIds: [],
      missingFacetSlugs: [],
      currentCycleCoverage: 1,
      sourcesComplete: true,
    },
    products: [
      {
        publicId: "producto-v7",
        slug: "producto-v7--producto-v7",
        name: "Neutrogena Hydro Boost Gel 50 ml",
        brand: { id: "6116", slug: "neutrogena", name: "Neutrogena", aliases: ["neutrogena"] },
        line: "Hydro Boost",
        primaryCategory: "rostro",
        categorySlugs: ["rostro"],
        needs: ["hidratacion"],
        aliases: ["Hydro Boost"],
        description: "Gel hidratante facial para uso diario.",
        listPrice: 20_000,
        offerPrice: 18_000,
        savingAmount: 2_000,
        discountPercent: 10,
        availability: "limited",
        availabilityCheckedAt: COMPLETED_AT,
        images: {
          card: "https://gpsfarma.com/media/catalog/product/v7/card.jpg",
          detail: "https://gpsfarma.com/media/catalog/product/v7/detail.jpg",
        },
        catalogFacets: [
          { slug: "neutrogena", name: "Neutrogena", aliases: ["neutrogena"], kind: "brand" },
          { slug: "omron", name: "Omron", aliases: ["omron"], kind: "brand" },
          { slug: "cerave", name: "CeraVe", aliases: ["cerave"], kind: "brand" },
          {
            slug: "dermocosmetica-activa",
            name: "Dermocosmetica Activa",
            aliases: ["dermocosmetica"],
            kind: "brand",
          },
          {
            slug: "cuidado-de-la-piel",
            name: "Cuidado de la Piel",
            aliases: ["cuidado de la piel"],
            kind: "brand",
          },
        ],
        catalogPositions: { neutrogena: 1, "cuidado-de-la-piel": 1 },
        sku: "SKU-PRIVADO-V7",
        barcode: "7793742004858",
        source: {
          provider: "GPSFarma",
          url: "https://gpsfarma.com/producto-v7.html",
          retrievedAt: COMPLETED_AT,
        },
      },
    ],
  };
}

async function listenHandler(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>,
) {
  const server = http.createServer((request, response) => {
    handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  const origin = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Puerto de prueba inválido."));
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  return { server, origin };
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function captureCatalogEnvironment() {
  return {
    catalogFile: process.env.V7_BETA_CATALOG_FILE,
    exclusionsFile: process.env.V7_BETA_EXCLUSIONS_FILE,
    requireExclusions: process.env.V7_BETA_REQUIRE_EXCLUSIONS,
  };
}

function restoreCatalogEnvironment(previous: ReturnType<typeof captureCatalogEnvironment>) {
  restoreEnvironmentValue("V7_BETA_CATALOG_FILE", previous.catalogFile);
  restoreEnvironmentValue("V7_BETA_EXCLUSIONS_FILE", previous.exclusionsFile);
  restoreEnvironmentValue("V7_BETA_REQUIRE_EXCLUSIONS", previous.requireExclusions);
}

function restoreEnvironmentValue(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function walkFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(directory, relative));
    else files.push(relative);
  }
  return files.sort();
}
