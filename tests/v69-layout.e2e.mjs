import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { resetCatalogV69CacheForTests } from "../dist/data-v69.js";
import { app } from "../dist/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog-v69.json");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));

async function exclusionFixture() {
  const raw = JSON.parse(await readFile(CATALOG_FILE, "utf8"));
  const limited = raw.products.filter(
    (product) => product.availability === "limited" && typeof product.source?.url === "string",
  );
  assert.ok(limited.length >= 2);
  const directory = await mkdtemp(path.join(tmpdir(), "farmagreen-v69-e2e-"));
  const file = path.join(directory, "catalog-exclusions-v69.local.json");
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      notes: "fixture efímero de la prueba real",
      skus: [],
      barcodes: [],
      urls: [`${limited[0].source.url}?e2e_private=1`],
      hidden: {
        [limited[1].publicId]: {
          reason: "No vender",
          at: "2026-07-30T00:00:00.000Z",
        },
      },
    }),
    "utf8",
  );
  return { directory, file };
}

async function startServer() {
  const fixture = await exclusionFixture();
  const previous = {
    catalog: process.env.V69_CATALOG_FILE,
    exclusions: process.env.V69_EXCLUSIONS_FILE,
    required: process.env.V69_REQUIRE_EXCLUSIONS,
  };
  process.env.V69_CATALOG_FILE = CATALOG_FILE;
  process.env.V69_EXCLUSIONS_FILE = fixture.file;
  process.env.V69_REQUIRE_EXCLUSIONS = "1";
  resetCatalogV69CacheForTests();
  const server = app({ ...process.env, NODE_ENV: "test", V69_LOCAL_PREVIEW: "1" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    async cleanup() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      if (previous.catalog === undefined) delete process.env.V69_CATALOG_FILE;
      else process.env.V69_CATALOG_FILE = previous.catalog;
      if (previous.exclusions === undefined) delete process.env.V69_EXCLUSIONS_FILE;
      else process.env.V69_EXCLUSIONS_FILE = previous.exclusions;
      if (previous.required === undefined) delete process.env.V69_REQUIRE_EXCLUSIONS;
      else process.env.V69_REQUIRE_EXCLUSIONS = previous.required;
      resetCatalogV69CacheForTests();
      await rm(fixture.directory, { recursive: true, force: true });
    },
  };
}

async function firstRowColumns(page) {
  return page.locator("#gridV69 .v66-card").evaluateAll((cards) => {
    const rects = cards.slice(0, 10).map((card) => card.getBoundingClientRect());
    const firstTop = rects[0]?.top;
    return rects.filter((rect) => Math.abs(rect.top - firstTop) < 2).length;
  });
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

function tie(left, right) {
  return (
    String(left.name || "").localeCompare(String(right.name || ""), "es", {
      sensitivity: "base",
      numeric: true,
    }) ||
    String(left.publicId || "").localeCompare(String(right.publicId || ""), "es", {
      sensitivity: "base",
      numeric: true,
    })
  );
}

function currentPrice(product) {
  return Math.round(Number(product.offerPrice || product.listPrice || 0));
}

function expectedFirst(products, sort) {
  const copy = [...products];
  if (sort === "descuento" || sort === "relevancia") {
    copy.sort(
      (left, right) =>
        (right.discountPercent || 0) - (left.discountPercent || 0) ||
        (right.savingAmount || 0) - (left.savingAmount || 0) ||
        tie(left, right),
    );
  } else if (sort === "precio-asc") {
    copy.sort((left, right) => currentPrice(left) - currentPrice(right) || tie(left, right));
  } else if (sort === "precio-desc") {
    copy.sort((left, right) => currentPrice(right) - currentPrice(left) || tie(left, right));
  } else {
    copy.sort(tie);
  }
  return copy[0];
}

async function firstCardSlug(page) {
  return page
    .locator("#gridV69 .v65-hit")
    .first()
    .evaluate((link) => new URL(link.href).pathname.split("/").filter(Boolean).at(-1));
}

async function selectSort(page, products, sort) {
  await page.locator("#sortV69").selectOption(sort);
  await page.waitForFunction(
    (expected) => new URL(location.href).searchParams.get("orden") === expected,
    sort === "relevancia" ? null : sort,
  );
  const expected = expectedFirst(products, sort);
  await page.waitForFunction(
    (slug) =>
      document
        .querySelector("#gridV69 .v65-hit")
        ?.getAttribute("href")
        ?.includes(`/producto-v6-9/${slug}/`),
    expected.slug,
  );
  assert.equal(await firstCardSlug(page), expected.slug);
}

test("V6.9 renderiza stock, orden, exclusividad y 5/2 columnas sin fuga del proveedor", { timeout: 60_000 }, async () => {
  assert.ok(executablePath, "No se encontró Chrome/Chromium; definí CHROME_PATH para ejecutar la guarda visual.");
  const runtime = await startServer();
  let browser;

  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const providerRequests = [];
    const consoleErrors = [];
    page.on("request", (request) => {
      if (/gpsfarma/i.test(request.url())) providerRequests.push(request.url());
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("**/media-v6-9/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
      }),
    );

    const apiResponse = await fetch(`${runtime.origin}/api/catalog-v6-9`);
    assert.equal(apiResponse.status, 200);
    const apiText = await apiResponse.text();
    assert.doesNotMatch(apiText, /gpsfarma|provider|barcode|"sku"|"source"/i);
    const api = JSON.parse(apiText);
    assert.equal(api.totalProducts, 686);
    assert.deepEqual(api.availabilitySummary, { available: 672, unavailable: 6, unverified: 8 });
    assert.equal(api.products.filter((product) => product.availability === "available_reference").length, 672);
    assert.equal(api.products.filter((product) => product.availability === "unavailable_reference").length, 6);
    assert.equal(api.products.filter((product) => product.availability === "unverified").length, 8);

    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo&orden=precio-asc`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("#gridV69 .v66-card").first().waitFor();
    assert.equal(await firstRowColumns(page), 5);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.equal(await page.locator("#gridV69 .v66-card").count(), 24);
    assert.equal(await page.locator("#gridV69 .v69-stock").count(), 24);
    assert.deepEqual(await page.locator("#sortV69 option").evaluateAll((options) => options.map((option) => option.value)), [
      "relevancia",
      "descuento",
      "precio-asc",
      "precio-desc",
      "nombre",
    ]);
    assert.equal(await page.locator("#sortV69").inputValue(), "precio-asc");
    assert.equal(await firstCardSlug(page), expectedFirst(api.products, "precio-asc").slug);
    const availabilityText = await page.locator("#availabilityV69").innerText();
    assert.match(availabilityText, /\b672\b/);
    assert.match(availabilityText, /\b6\b/);
    assert.match(availabilityText, /\b8\b/);
    assert.match(availabilityText, /no verificados/i);

    await selectSort(page, api.products, "precio-desc");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#gridV69 .v66-card").first().waitFor();
    assert.equal(await page.locator("#sortV69").inputValue(), "precio-desc");
    assert.equal(await firstCardSlug(page), expectedFirst(api.products, "precio-desc").slug);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.locator("#gridV69 .v66-card").first().waitFor();
    assert.equal(await page.locator("#sortV69").inputValue(), "precio-asc");
    assert.equal(await firstCardSlug(page), expectedFirst(api.products, "precio-asc").slug);

    await selectSort(page, api.products, "descuento");
    await selectSort(page, api.products, "nombre");
    await selectSort(page, api.products, "relevancia");

    const isdinCount = api.products.filter((product) => product.brand.name === "ISDIN").length;
    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo&marca=ISDIN&need=solares`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      (expected) => document.querySelector("#countV69")?.textContent === `24 de ${expected}`,
      isdinCount,
    );
    assert.equal(await page.locator("#needSummaryV69").textContent(), "Todas");
    assert.equal(new URL(page.url()).searchParams.get("marca"), "ISDIN");
    assert.equal(new URL(page.url()).searchParams.has("need"), false);

    await page.locator('[data-filter-menu-trigger="need"]').click();
    await page.locator('[data-need="acne"]').click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("need") === "acne");
    assert.match(await page.locator("#brandSummaryV69").textContent(), /^Todas · /);
    assert.equal(new URL(page.url()).searchParams.has("marca"), false);
    assert.equal(await hasHorizontalOverflow(page), false);

    const unavailable = api.products.find((product) => product.availability === "unavailable_reference");
    assert.ok(unavailable);
    await page.goto(`${runtime.origin}/producto-v6-9/${unavailable.slug}/`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".v69-stock.is-unavailable.is-pdp").waitFor();
    assert.match(await page.locator(".v69-stock.is-unavailable.is-pdp").innerText(), /no disponible/i);
    assert.match(await page.locator(".cta").innerText(), /Consultar disponibilidad/i);
    assert.equal(await hasHorizontalOverflow(page), false);

    const unverified = api.products.find((product) => product.availability === "unverified");
    assert.ok(unverified);
    await page.goto(`${runtime.origin}/producto-v6-9/${unverified.slug}/`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".v69-stock.is-unverified.is-pdp").waitFor();
    assert.match(await page.locator(".v69-stock.is-unverified.is-pdp").innerText(), /no verificado/i);
    assert.match(await page.locator(".cta").innerText(), /Consultar disponibilidad/i);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo`, { waitUntil: "domcontentloaded" });
    await page.locator("#gridV69 .v66-card").first().waitFor();
    assert.equal(await firstRowColumns(page), 2);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.equal(await page.locator("#gridV69 .v69-stock").count(), 24);
    await page.locator("#gridV69 .v66-ask").nth(1).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const floatingInterception = await page.evaluate(() => {
      const floating = document.querySelector(".float");
      if (!floating) return false;
      const floatRect = floating.getBoundingClientRect();
      const style = getComputedStyle(floating);
      const interactive = style.pointerEvents !== "none" && Number.parseFloat(style.opacity) > 0.1;
      return (
        interactive &&
        [...document.querySelectorAll("#gridV69 .v66-ask")]
          .map((action) => action.getBoundingClientRect())
          .filter((rect) => rect.bottom > 0 && rect.top < innerHeight)
          .some(
            (rect) =>
              Math.max(0, Math.min(floatRect.right, rect.right) - Math.max(floatRect.left, rect.left)) *
                Math.max(0, Math.min(floatRect.bottom, rect.bottom) - Math.max(floatRect.top, rect.top)) >
              1,
          )
      );
    });
    assert.equal(floatingInterception, false);

    await page.locator("#searchV69").fill("protetor solar bebe");
    await page.waitForFunction(() => document.querySelector("#countV69")?.textContent === "2 de 2");
    assert.equal(await page.locator("#gridV69 .v66-card").count(), 2);
    assert.match(await page.locator("#catalogTitleV69").textContent(), /protetor solar bebe/i);
    assert.deepEqual(providerRequests, []);
    assert.deepEqual(consoleErrors, []);
  } finally {
    if (browser) await browser.close();
    await runtime.cleanup();
  }
});
