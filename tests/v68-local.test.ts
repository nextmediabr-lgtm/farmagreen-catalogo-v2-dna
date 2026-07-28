import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  catalogPageV68,
  catalogV68,
  isPrivateSourceImageV68,
  productPageV68,
  searchTextV68,
  similarV68,
} from "../src/render-v68.js";
import { app } from "../src/server.js";
import {
  catalogReadyForRuntimeV68,
  publicOriginV68,
  readResponseBodyWithinLimit,
  sourceImageBridgeEnabled,
} from "../src/server-v68.js";

const EXPECTED_BRANDS: Record<string, number> = {
  Eucerin: 86,
  Dermaglos: 105,
  Caviahue: 40,
  "La Roche Posay": 81,
  Vichy: 80,
  "Productos Saludables": 36,
  "L'Oréal Revitalift": 16,
  ISDIN: 144,
  Cetaphil: 43,
  Aveno: 14,
  ENA: 43,
};

const NEEDS = new Set([
  "manchas",
  "acne",
  "piel-sensible",
  "hidratacion",
  "limpieza",
  "solares",
  "capilar",
  "antiedad",
  "reparacion",
  "nutricion",
  "cuidado-diario",
]);

const normalize = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

test("V6.8 parte de la V6.7 aprobada y normaliza el dataset sin inventar detalle médico", async () => {
  const catalog = await catalogV68();
  assert.equal(catalog.version, 6.8);
  assert.equal(catalog.totalProducts, 688);
  assert.equal(catalog.products.length, 688);
  assert.equal(new Set(catalog.products.map((product) => product.publicId)).size, 688);
  assert.equal(new Set(catalog.products.map((product) => product.slug)).size, 688);
  assert.equal(new Set(catalog.products.map((product) => normalize(product.name))).size, 688);
  assert.ok(!catalog.products.some((product) => product.publicId === "e58ab2ba2993"));

  for (const [brand, expected] of Object.entries(EXPECTED_BRANDS)) {
    assert.equal(catalog.products.filter((product) => product.brand.name === brand).length, expected, brand);
  }
  assert.equal(catalog.products.some((product) => product.brand.name === "Aveeno"), false);
  assert.equal(catalog.products.some((product) => /\bAveeno\b/.test(product.name)), false);
  assert.equal(catalog.products.some((product) => product.brand.name === "L'oreal Revitalift"), false);

  type Sourced = (typeof catalog.products)[number] & {
    source?: { provider?: string; url?: string | null; descriptionStatus?: string };
  };
  const sourced = catalog.products as Sourced[];
  assert.ok(sourced.every((product) => product.source?.provider === "GPSFarma"));
  assert.ok(sourced.every((product) => product.description.trim().length > 0));
  assert.ok(sourced.every((product) => !/(?:\.{3}|…)$/.test(product.description)));
  assert.ok(sourced.every((product) => !/#html-body|data-pb-style|\{justify-content/i.test(product.description)));

  const pending = sourced.filter((product) => product.source?.descriptionStatus === "gpsfarma-detail-pending");
  assert.equal(pending.length, 3);
  assert.ok(pending.every((product) => product.source?.url === null));
  assert.ok(pending.every((product) => product.description === "Información detallada pendiente de publicación."));

  const recovered = sourced.filter((product) => String(product.source?.descriptionStatus).startsWith("gpsfarma-") && product.source?.url);
  assert.ok(recovered.length >= 390);
  assert.ok(recovered.every((product) => /^https:\/\/gpsfarma\.com\//.test(product.source?.url || "")));
});

test("V6.8 sólo considera privadas las imágenes HTTPS del origen permitido", () => {
  const credentialedSource = new URL("https://gpsfarma.com/media/producto.webp");
  credentialedSource.username = "usuario";
  credentialedSource.password = "clave";
  assert.equal(isPrivateSourceImageV68("https://gpsfarma.com/media/producto.webp"), true);
  assert.equal(isPrivateSourceImageV68("https://9dejulio.gpsfarma.com/media/producto.webp"), true);
  assert.equal(isPrivateSourceImageV68("http://gpsfarma.com/media/producto.webp"), false);
  assert.equal(isPrivateSourceImageV68(credentialedSource.toString()), false);
  assert.equal(isPrivateSourceImageV68("https://otro.example/media/producto.webp"), false);
});

test("V6.8 completa la taxonomía y conserva ENA como marca", async () => {
  const catalog = await catalogV68();
  for (const product of catalog.products) {
    assert.ok(product.needs.length > 0, product.name);
    assert.ok(product.needs.every((need) => NEEDS.has(need)), `${product.name}: ${product.needs.join(",")}`);
    assert.ok(!product.needs.includes(product.brand.slug));
    assert.ok(product.needs.every((need) => searchTextV68(product).includes(normalize(need))), product.name);
  }
  const ena = catalog.products.filter((product) => product.brand.name === "ENA");
  assert.equal(ena.length, 43);
  assert.ok(ena.every((product) => product.needs.includes("nutricion")));
  assert.ok(catalog.products.some((product) => product.needs.includes("limpieza")));
  assert.ok(catalog.products.some((product) => product.needs.includes("cuidado-diario")));
});

test("HTML V6.8 usa URLs absolutas, jerarquía revisada y no expone la procedencia interna", async () => {
  const origin = "http://127.0.0.1:8100";
  const catalog = await catalogV68();
  const catalogHtml = catalogPageV68(catalog, new URLSearchParams({ marca: "Cetaphil", need: "solares", scope: "todo" }), origin);
  assert.match(catalogHtml, /<script type="application\/json" id="fg68-data">/);
  assert.doesNotMatch(catalogHtml, /window\.__FG68=/);
  assert.match(catalogHtml, /styles-v6-7\.css/);
  assert.match(catalogHtml, /styles-v6-8\.css/);
  assert.match(catalogHtml, /app-v6-8\.js/);
  assert.match(catalogHtml, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:8100\/catalogo-v6-8\/">/);
  assert.match(catalogHtml, /<meta property="og:url" content="http:\/\/127\.0\.0\.1:8100\/catalogo-v6-8\/">/);
  assert.match(catalogHtml, /id="brandSummaryV68">Cetaphil · \d+<\/strong>/);
  assert.match(catalogHtml, /data-need="limpieza"/);
  assert.match(catalogHtml, /data-need="cuidado-diario"/);
  assert.match(catalogHtml, /class="v66-discount">-\d+%<\/span>/);
  assert.match(catalogHtml, /<dt>Presentación<\/dt>/);
  assert.match(catalogHtml, /<dt>Uso<\/dt>/);
  assert.doesNotMatch(catalogHtml, /<dt>Uso principal<\/dt>/);
  assert.doesNotMatch(catalogHtml, /gpsfarma/i);

  const cardWa = catalogHtml.match(/href="(https:\/\/wa\.me\/[^"]+)"[^>]*>Consultar<\/a>/)?.[1];
  assert.ok(cardWa);
  const cardText = new URL(cardWa.replaceAll("&amp;", "&")).searchParams.get("text") || "";
  assert.match(cardText, /http:\/\/127\.0\.0\.1:8100\/producto-v6-8\//);

  const product = catalog.products.find((item) => {
    const source = (item as typeof item & { source?: { url?: string | null } }).source;
    return item.brand.name === "Cetaphil" && item.discountPercent > 0 && source?.url;
  });
  assert.ok(product);
  const productHtml = productPageV68(product, await similarV68(product), origin);
  assert.match(productHtml, new RegExp(`<link rel="canonical" href="${origin}/producto-v6-8/${product.slug}/">`));
  assert.match(productHtml, new RegExp(`<meta property="og:url" content="${origin}/producto-v6-8/${product.slug}/">`));
  assert.match(productHtml, /class="v68-detail"><h2>Detalle<\/h2>/);
  assert.match(productHtml, /<dt>Uso<\/dt>/);
  assert.doesNotMatch(productHtml, /<dt>Uso principal<\/dt>/);
  assert.match(productHtml, /class="v66-discount">-\d+%<\/span>/);
  assert.match(productHtml, /class="price v66-detail-price"><b>-\d+%<\/b>/);
  assert.doesNotMatch(productHtml, /Fuente(?: de referencia)?:/i);
  assert.doesNotMatch(productHtml, /gpsfarma/i);
  assert.doesNotMatch(productHtml, /Podés compartir esta URL tal como está/);
  assert.match(productHtml, /"url":"http:\/\/127\.0\.0\.1:8100\/producto-v6-8\//);
  const pdpWa = productHtml.match(/href="(https:\/\/wa\.me\/[^"]+)"[^>]*>Consultar este producto por WhatsApp<\/a>/)?.[1];
  assert.ok(pdpWa);
  assert.match(new URL(pdpWa.replaceAll("&amp;", "&")).searchParams.get("text") || "", new RegExp(`${origin}/producto-v6-8/${product.slug}/`));
});

test("V6.8 conserva 5 fichas desktop, 2 mobile y compacta filtros/PDP", async () => {
  const css66 = await readFile(new URL("../public/styles-v6-6.css", import.meta.url), "utf8");
  const css68 = await readFile(new URL("../public/styles-v6-8.css", import.meta.url), "utf8");
  const app68 = await readFile(new URL("../public/app-v6-8.js", import.meta.url), "utf8");
  assert.match(css66, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css66, /@media\(max-width:760px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css68, /\.v67-need-options\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/);
  assert.match(css68, /@media\(max-width:760px\)[\s\S]*\.v67-need-options\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
  assert.match(css68, /\.v67-menu-label\{font-size:11px\}/);
  assert.match(css68, /\.v65-buybox h1\{[\s\S]*?font-size:clamp\(38px,4\.3vw,64px\)/);
  assert.match(css68, /@media\(max-width:760px\)[\s\S]*font-size:clamp\(32px,9vw,36px\)/);
  assert.match(css68, /\.v66-pdp-facts\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(app68, /JSON\.parse\(document\.querySelector\("#fg68-data"\)\?\.textContent \|\| "\{\}"\)/);
  assert.match(app68, /const PUBLIC_ORIGIN = BOOT\.origin \|\| window\.location\.origin/);
  assert.match(app68, /function syncFilterMenuSummaries\(resultCount\)/);
  assert.match(app68, /syncFilterMenuSummaries\(items\.length\)/);
  assert.doesNotMatch(app68, /if \(S\.scope === "ofertas"\) value \+= 20/);
  assert.doesNotMatch(app68, /return "Unidad"/);
});

test("el servidor publica V6.8 solo como ruta local propia", async () => {
  const server = app({ ...process.env, NODE_ENV: "test", V68_LOCAL_PREVIEW: "1" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const [catalogResponse, cssResponse, appResponse, apiResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/catalogo-v6-8/`),
      fetch(`http://127.0.0.1:${port}/styles-v6-8.css`),
      fetch(`http://127.0.0.1:${port}/app-v6-8.js`),
      fetch(`http://127.0.0.1:${port}/api/catalog-v6-8`),
    ]);
    assert.equal(catalogResponse.status, 200);
    assert.equal(cssResponse.status, 200);
    assert.equal(appResponse.status, 200);
    assert.equal(apiResponse.status, 200);
    const catalogHtml = await catalogResponse.text();
    const appSource = await appResponse.text();
    const publicCatalogText = await apiResponse.text();
    const publicCatalog = JSON.parse(publicCatalogText) as {
      totalProducts: number;
      extraction?: unknown;
      v68Revision?: unknown;
      products: Array<Record<string, unknown> & { source?: unknown; images: { card: string; detail: string } }>;
    };
    assert.match(catalogHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/catalogo-v6-8/`));
    assert.equal(publicCatalog.totalProducts, 688);
    assert.equal(publicCatalog.extraction, undefined);
    assert.equal(publicCatalog.v68Revision, undefined);
    assert.deepEqual(Object.keys(publicCatalog).sort(), ["products", "syncedAt", "totalProducts", "version"]);
    assert.ok(publicCatalog.products.every((product) => product.source === undefined));
    const expectedProductKeys = [
      "aliases",
      "brand",
      "discountPercent",
      "images",
      "line",
      "listPrice",
      "name",
      "needs",
      "offerPrice",
      "primaryCategory",
      "publicId",
      "savingAmount",
      "slug",
    ];
    assert.ok(publicCatalog.products.every((product) => {
      assert.deepEqual(Object.keys(product).sort(), expectedProductKeys);
      assert.deepEqual(Object.keys(product.brand as Record<string, unknown>).sort(), ["aliases", "id", "name", "slug"]);
      assert.deepEqual(Object.keys(product.images).sort(), ["card", "detail"]);
      return !["description", "detail", "source", "syncedAt", "taxonomy"].some((key) => key in product);
    }));
    assert.ok(Buffer.byteLength(publicCatalogText) < 800_000, `API V6.8 demasiado pesada: ${Buffer.byteLength(publicCatalogText)} bytes`);
    assert.ok(Buffer.byteLength(catalogHtml) < 850_000, `HTML V6.8 demasiado pesado: ${Buffer.byteLength(catalogHtml)} bytes`);
    assert.ok(
      publicCatalog.products.flatMap((product) => [product.images.card, product.images.detail]).every(
        (image) => !image.includes("gpsfarma") && (image.startsWith("/media-v6-8/") || image.startsWith("https://storage.googleapis.com/")),
      ),
    );
    assert.doesNotMatch(catalogHtml, /gpsfarma/i);
    assert.doesNotMatch(appSource, /gpsfarma/i);
    assert.doesNotMatch(publicCatalogText, /gpsfarma/i);
    assert.doesNotMatch(catalogResponse.headers.get("content-security-policy") || "", /gpsfarma/i);
    assert.doesNotMatch(catalogResponse.headers.get("content-security-policy") || "", /unsafe-inline/i);
    assert.doesNotMatch(apiResponse.headers.get("content-security-policy") || "", /gpsfarma/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("el puente temporal de imágenes V6.8 nunca queda habilitado por defecto en producción", () => {
  assert.equal(sourceImageBridgeEnabled({}), false);
  assert.equal(sourceImageBridgeEnabled({ NODE_ENV: "development" }), false);
  assert.equal(sourceImageBridgeEnabled({ V68_LOCAL_PREVIEW: "1" }), true);
  assert.equal(sourceImageBridgeEnabled({ V68_LOCAL_PREVIEW: "1", V68_DISABLE_SOURCE_IMAGE_BRIDGE: "1" }), false);
  assert.equal(sourceImageBridgeEnabled({ NODE_ENV: "production" }), false);
});

test("V6.8 permanece cerrada en producción hasta que todas las imágenes estén en el Store GCP", async () => {
  const catalog = await catalogV68();
  assert.equal(catalogReadyForRuntimeV68(catalog, {}), false);
  assert.equal(catalogReadyForRuntimeV68(catalog, { V68_LOCAL_PREVIEW: "1" }), true);
  assert.equal(catalogReadyForRuntimeV68(catalog, { NODE_ENV: "production" }), false);
  assert.equal(
    catalogReadyForRuntimeV68(catalog, {
      NODE_ENV: "production",
      V68_ENABLE_PRODUCTION: "1",
      PUBLIC_ORIGIN: "https://farmagreen.example",
    }),
    false,
  );
  const migrated = {
    ...catalog,
    products: catalog.products.map((product) => ({
      ...product,
      images: {
        card: "https://storage.googleapis.com/farmagreen-catalog-images/producto.jpg",
        detail: "https://storage.googleapis.com/farmagreen-catalog-images/producto.jpg",
      },
    })),
  };
  assert.equal(
    catalogReadyForRuntimeV68(migrated, {
      NODE_ENV: "production",
      V68_ENABLE_PRODUCTION: "1",
    }),
    false,
  );
  assert.equal(
    catalogReadyForRuntimeV68(migrated, {
      NODE_ENV: "production",
      V68_ENABLE_PRODUCTION: "1",
      PUBLIC_ORIGIN: "https://farmagreen.example",
    }),
    true,
  );
});

test("el puente local corta cuerpos de imagen antes de superar el límite de memoria", async () => {
  let cancelled = false;
  const oversized = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(6));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  assert.equal(await readResponseBodyWithinLimit(oversized, 5), null);
  assert.equal(cancelled, true);

  const accepted = new Response(new Uint8Array([1, 2, 3]));
  assert.deepEqual(await readResponseBodyWithinLimit(accepted, 3), Buffer.from([1, 2, 3]));
});

test("el exportador público V6.8 usa artefacto, configuración y proyecto propios", async () => {
  const exporter = await readFile(new URL("../src/export-v68-static.ts", import.meta.url), "utf8");
  const preparer = await readFile(new URL("../scripts/prepare-vercel-static.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.match(exporter, /dist", "vercel-v68"/);
  assert.match(exporter, /catalogo-v6-8/);
  assert.match(exporter, /producto-v6-8/);
  assert.match(exporter, /media-v6-8/);
  assert.match(exporter, /publicCatalogV68/);
  assert.match(exporter, /isPrivateSourceImageV68/);
  assert.doesNotMatch(exporter, /vercel-v67|catalogo-v6-7|producto-v6-7/);
  assert.match(preparer, /VERCEL_STATIC_CONFIG/);
  assert.match(packageJson.scripts["export:vercel:v68"], /dist\/export-v68-static\.js/);
  assert.match(packageJson.scripts["export:vercel:v68"], /VERCEL_STATIC_SOURCE=dist\/vercel-v68/);
  assert.match(packageJson.scripts["deploy:vercel:v68:public-test"], /vercel@58\.0\.0 deploy --prebuilt/);
  assert.match(
    packageJson.scripts["deploy:vercel:v68:public-test"],
    /--project farmagreen-v6-8-public-test/,
  );
  assert.match(packageJson.scripts["deploy:vercel:v68:public-test"], /--prod/);
  assert.doesNotMatch(packageJson.scripts["deploy:vercel:v68:public-test"], /farmagreen-v6-7/);
});

test("V6.8 no confía en Host para construir URLs públicas en producción", () => {
  assert.equal(publicOriginV68("http://127.0.0.1:8100", {}), "http://127.0.0.1:8100");
  assert.equal(
    publicOriginV68("https://host-no-confiable.example", {
      NODE_ENV: "production",
      PUBLIC_ORIGIN: "https://farmagreenrosario.com.ar/",
    }),
    "https://farmagreenrosario.com.ar",
  );
  assert.throws(() => publicOriginV68("https://host-no-confiable.example", { NODE_ENV: "production" }), /PUBLIC_ORIGIN/);
  assert.throws(() => publicOriginV68("http://127.0.0.1:8100", { PUBLIC_ORIGIN: "javascript:alert(1)" }), /HTTP\(S\)/);
  assert.throws(
    () =>
      publicOriginV68("https://host-no-confiable.example", {
        NODE_ENV: "production",
        PUBLIC_ORIGIN: "http://farmagreen.example",
      }),
    /HTTPS/,
  );
});
