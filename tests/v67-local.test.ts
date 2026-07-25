import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { catalogPageV67, catalogV67, productPageV67, similarV67 } from "../src/render-v67.js";
import { app } from "../src/server.js";

const EXPECTED_BRANDS: Record<string, number> = {
  Eucerin: 86,
  Dermaglos: 105,
  Caviahue: 40,
  "La Roche Posay": 81,
  Vichy: 81,
  "Productos Saludables": 36,
  "L'oreal Revitalift": 16,
  ISDIN: 144,
  Cetaphil: 43,
  Aveno: 14,
  ENA: 43,
};

const CATEGORIES = new Set(["rostro", "cuerpo", "limpieza", "solares", "capilar", "bebe", "nutricion", "otros"]);
const NEEDS = new Set(["manchas", "acne", "piel-sensible", "hidratacion", "solares", "capilar", "antiedad", "reparacion", "nutricion"]);

test("V6.7 usa un catálogo único, completo y sin overlays de marca", async () => {
  const catalog = await catalogV67();
  assert.equal(catalog.version, 6.7);
  assert.equal(catalog.totalProducts, 689);
  assert.equal(catalog.products.length, 689);
  assert.equal(new Set(catalog.products.map((product) => product.publicId)).size, 689);
  assert.equal(new Set(catalog.products.map((product) => product.slug)).size, 689);

  for (const [brand, expected] of Object.entries(EXPECTED_BRANDS)) {
    assert.equal(catalog.products.filter((product) => product.brand.name === brand).length, expected, brand);
  }

  const raw = JSON.parse(await readFile(new URL("../data/catalog-v67.json", import.meta.url), "utf8")) as {
    extraction: { sources: Record<string, string>; byBrand: Record<string, number>; listed: number; imagePolicy: string };
    products: Array<{ images: { card: string; detail: string } }>;
  };
  assert.equal(raw.extraction.listed, 244);
  assert.deepEqual(raw.extraction.byBrand, { ISDIN: 144, Cetaphil: 43, Aveno: 14, ENA: 43 });
  assert.match(raw.extraction.sources.isdin, /marca=6023/);
  assert.match(raw.extraction.sources.cetaphil, /marca=5756/);
  assert.match(raw.extraction.sources.aveno, /marca=5697/);
  assert.match(raw.extraction.sources.ena, /marca=5911/);
  assert.equal(raw.extraction.imagePolicy, "original GPSFarma image URL; no forced landscape canvas");
  const gpsFarmaImages = raw.products.flatMap((product) => [product.images.card, product.images.detail]).filter((image) => image.startsWith("https://gpsfarma.com/"));
  assert.equal(gpsFarmaImages.length, 488);
  assert.ok(gpsFarmaImages.every((image) => !image.includes("?")), "las imágenes nuevas deben conservar su proporción original");
});

test("ENA queda completa como marca y nunca como categoría o necesidad propia", async () => {
  const catalog = await catalogV67();
  const ena = catalog.products.filter((product) => product.brand.name === "ENA");
  assert.equal(ena.length, 43);
  assert.ok(ena.every((product) => product.brand.id === "5911"));
  assert.ok(ena.every((product) => product.brand.slug === "ena"));
  assert.ok(ena.every((product) => product.primaryCategory === "nutricion"));
  assert.ok(ena.every((product) => product.categorySlugs.length === 1 && product.categorySlugs[0] === "nutricion"));
  assert.ok(ena.every((product) => product.needs.includes("nutricion")));
  assert.ok(catalog.products.every((product) => product.primaryCategory !== "ena-suplementos"));
  assert.ok(catalog.products.every((product) => !product.categorySlugs.includes("ena-suplementos")));
  assert.ok(catalog.products.every((product) => !product.needs.includes("ena-suplementos")));
});

test("la taxonomía V6.7 separa marca, categoría y necesidad", async () => {
  const catalog = await catalogV67();
  for (const product of catalog.products) {
    assert.ok(CATEGORIES.has(product.primaryCategory), `${product.name}: ${product.primaryCategory}`);
    assert.deepEqual(product.categorySlugs, [product.primaryCategory]);
    assert.ok(product.needs.every((need) => NEEDS.has(need)), `${product.name}: ${product.needs.join(",")}`);
    assert.ok(!product.needs.includes(product.brand.slug));
  }

  const vitaminC = catalog.products.find((product) => product.brand.name === "Eucerin" && /Vitamin C Booster/i.test(product.name));
  assert.ok(vitaminC);
  assert.notEqual(vitaminC.primaryCategory, "nutricion");
  assert.ok(!vitaminC.needs.includes("nutricion"));

  const aquaphorLabios = catalog.products.find((product) => product.brand.name === "Eucerin" && /Reparador de labios.*Aquaphor/i.test(product.name));
  assert.ok(aquaphorLabios);
  assert.equal(aquaphorLabios.primaryCategory, "cuerpo");
  assert.ok(aquaphorLabios.needs.includes("reparacion"));
  assert.ok(!aquaphorLabios.needs.includes("solares"));

  const dermaglosAutobronceante = catalog.products.find((product) => product.brand.name === "Dermaglos" && /Autobronceante Hidratante/i.test(product.name));
  assert.ok(dermaglosAutobronceante);
  assert.equal(dermaglosAutobronceante.primaryCategory, "cuerpo");
  assert.ok(!dermaglosAutobronceante.needs.includes("solares"));

  const isdinPediatrics = catalog.products.find((product) => product.brand.name === "ISDIN" && /Foto Fusion Water Pediatrics/i.test(product.name));
  assert.ok(isdinPediatrics);
  assert.equal(isdinPediatrics.primaryCategory, "solares");

  const avenoShampoo = catalog.products.find((product) => product.brand.name === "Aveno" && /Shampoo infantil/i.test(product.name));
  assert.ok(avenoShampoo);
  assert.equal(avenoShampoo.primaryCategory, "capilar");
});

test("V6.7 conserva el ADN visual y genera todos los botones desde los datos", async () => {
  const catalog = await catalogV67();
  const html = catalogPageV67(catalog);
  assert.match(html, /window\.__FG67=/);
  assert.match(html, /app-v6-7\.js/);
  assert.match(html, /styles-v6-5\.css/);
  assert.match(html, /styles-v6-6\.css/);
  assert.match(html, /styles-v6-7\.css/);
  assert.match(html, /\/producto-v6-7\//);
  assert.match(html, /data-brand="ISDIN"/);
  assert.match(html, /data-brand="Cetaphil"/);
  assert.match(html, /data-brand="Aveno"/);
  assert.match(html, /data-brand="ENA"/);
  assert.match(html, /data-need="nutricion"[^>]*>[\s\S]*?<span>Nutrición<\/span>/);
  assert.doesNotMatch(html, /data-need="ena|ENA Suplementos/);
  assert.doesNotMatch(html, /\/marca\/|\/categoria\/|\/necesidad\//);
  assert.match(html, /farmagreen-social-preview-v2\.png/);
  assert.match(html, /data-filter-menu="need"/);
  assert.match(html, /data-filter-menu="brand"/);
  assert.match(html, /data-filter-menu-trigger="need" aria-expanded="false"/);
  assert.match(html, /aria-controls="brandMenuV67"/);
  assert.match(html, /class="v67-need-icon"/);
  assert.match(html, /class="v67-brand-option/);
  assert.match(html, /id="loadMoreV67"[^>]*>Cargar más productos<\/button>/);
  assert.doesNotMatch(html, /data-filter-rail|data-rail-scroll/);
  assert.doesNotMatch(html, />Filtros</);
  assert.doesNotMatch(html, /Filtros funcionales, separados de las marcas|Cada laboratorio usa el mismo flujo del catálogo/);

  const css = await readFile(new URL("../public/styles-v6-6.css", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);

  const css67 = await readFile(new URL("../public/styles-v6-7.css", import.meta.url), "utf8");
  assert.match(css67, /--v67-canvas:#f3ead2/);
  assert.match(css67, /body\.v67 \.top img\{max-width:439px;max-height:62px\}/);
  assert.match(css67, /\.v67-filter-grid\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css67, /\.v67-menu-popover\{[\s\S]*?position:absolute/);
  assert.match(css67, /--v67-v2-category-start:#ffd08a/);
  assert.match(css67, /--v67-v2-category-end:#ffad62/);
  assert.match(css67, /--v67-v2-category-ink:#4b4a45/);
  assert.match(css67, /--v67-v2-brand:#2d7f89/);
  assert.match(css67, /\[data-filter-menu="need"\] \.v67-menu-trigger\{[\s\S]*?background:linear-gradient\(90deg,var\(--v67-v2-category-start\)/);
  assert.match(css67, /\[data-filter-menu="brand"\] \.v67-menu-trigger\{[\s\S]*?background:var\(--v67-v2-brand\)[\s\S]*?color:#fff/);
  assert.match(css67, /\.v67-need-options\{[\s\S]*?grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css67, /\.v67-brand-options\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css67, /border:2px solid rgba\(31,127,108,\.4\)/);
  assert.match(css67, /\.v67-image-missing::after/);
  assert.match(css67, /body\.v67 #loadMoreV67\{[\s\S]*?width:100%/);
  assert.match(css67, /body\.v67 #loadMoreV67\{[\s\S]*?background:var\(--v65-hot\)/);
  assert.match(css67, /body\.v67 #loadMoreV67\{[\s\S]*?border-radius:12px/);
  assert.match(css67, /@media\(max-width:760px\)[\s\S]*grid-template-areas:"title search clear"/);
  assert.match(css67, /@media\(max-width:760px\)[\s\S]*\.v67-need-options\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css67, /@media\(prefers-reduced-motion:reduce\)/);

  const app67 = await readFile(new URL("../public/app-v6-7.js", import.meta.url), "utf8");
  assert.match(app67, /toggleAttribute\("inert", !open\)/);
  assert.match(app67, /event\.key !== "Escape"/);
  assert.match(app67, /function wireImageFallbacks\(\)/);
  assert.match(app67, /more\.textContent = "Cargar más productos"/);
  assert.doesNotMatch(app67, /more\.textContent = .*Ver .*más/);
  assert.doesNotMatch(app67, /else if \(S\.brand !== "Todas"\)\s*\{\s*S\.need = "Todas"/);
  assert.doesNotMatch(app67, /wireRailNavigation|updateRailControls/);
});

test("el servidor expone la capa visual propia de V6.7", async () => {
  const server = app();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const catalogResponse = await fetch(`http://127.0.0.1:${port}/catalogo-v6-7/`);
    const cssResponse = await fetch(`http://127.0.0.1:${port}/styles-v6-7.css`);
    assert.equal(catalogResponse.status, 200);
    assert.equal(cssResponse.status, 200);
    assert.match(cssResponse.headers.get("content-type") || "", /^text\/css/);
    assert.match(await catalogResponse.text(), /styles-v6-7\.css/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("los mismos query params generan preview contextual sin crear rutas paralelas", async () => {
  const catalog = await catalogV67();
  const html = catalogPageV67(catalog, new URLSearchParams({ marca: "ISDIN", scope: "todo" }));
  assert.match(html, /<title>ISDIN \| Catálogo Farmagreen V6\.7<\/title>/);
  assert.match(html, /<meta property="og:title" content="ISDIN \| Catálogo Farmagreen V6\.7">/);
  assert.match(html, /144 productos disponibles de ISDIN/);
  assert.match(html, /"brand":"ISDIN"/);
  assert.doesNotMatch(html, /\/marca\//);

  const combined = catalogPageV67(catalog, new URLSearchParams({ marca: "ISDIN", need: "solares", scope: "todo" }));
  assert.match(combined, /55 productos disponibles de ISDIN/);
  assert.match(combined, /"brand":"ISDIN"/);
  assert.match(combined, /"need":"solares"/);
  assert.match(combined, /Solares de ISDIN\./);
});

test("las fichas V6.7 usan su propia versión, datos útiles y relacionados", async () => {
  const catalog = await catalogV67();
  const product = catalog.products.find((item) => item.brand.name === "Cetaphil" && item.discountPercent > 0);
  assert.ok(product);
  const related = await similarV67(product);
  const html = productPageV67(product, related);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /Consultar este producto por WhatsApp/);
  assert.match(html, /app-v6-7\.js/);
  assert.match(html, new RegExp(`/producto-v6-7/${product.slug}/`));
  assert.match(html, /<dt>Presentación<\/dt>/);
  assert.match(html, /<dt>Uso principal<\/dt>/);
  assert.match(html, /class="v66-card-top v67-pdp-card-top">[\s\S]*?class="v66-brand">Cetaphil<\/p>[\s\S]*?class="v66-discount">\d+%<\/span>[\s\S]*?class="photo v65-photo"/);
  const primaryArticle = html.slice(html.indexOf('<article class="pdp'), html.indexOf("</article>"));
  assert.equal((primaryArticle.match(/class="v66-discount"/g) || []).length, 1);
  assert.match(primaryArticle, /class="price v66-detail-price"><b>\d+%<\/b><s>/);
  assert.ok(related.length > 0);
  assert.doesNotMatch(html, /\/producto-v6-6\//);
});

test("el exportador V6.7 usa una salida y un deploy preview propios", async () => {
  const exporter = await readFile(new URL("../src/export-v67-static.ts", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(exporter, /dist", "vercel-v67"/);
  assert.match(exporter, /catalogo-v6-7/);
  assert.match(exporter, /producto-v6-7/);
  assert.match(exporter, /styles-v6-7\.css/);
  assert.doesNotMatch(exporter, /vercel-v66|catalogo-v6-6|producto-v6-6/);
  assert.match(packageJson.scripts["export:vercel:v67"], /dist\/export-v67-static\.js/);
  assert.match(packageJson.scripts["export:vercel:v67"], /VERCEL_STATIC_SOURCE=dist\/vercel-v67/);
  assert.match(packageJson.scripts["deploy:vercel:v67:preview"], /vercel deploy --prebuilt/);
  assert.match(packageJson.scripts["deploy:vercel:v67:preview"], /--project farmagreen-v6-7-public-test/);
  assert.doesNotMatch(packageJson.scripts["deploy:vercel:v67:preview"], /--prod/);
});
