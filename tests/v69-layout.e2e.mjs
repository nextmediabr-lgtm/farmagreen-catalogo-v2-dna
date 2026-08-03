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
const remoteOrigin = process.env.V69_E2E_ORIGIN?.replace(/\/$/, "");

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

async function runtimeTarget() {
  if (remoteOrigin) {
    return {
      origin: remoteOrigin,
      async cleanup() {},
    };
  }
  return startServer();
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

function publicAvailabilitySummary(products) {
  return products.reduce(
    (summary, product) => {
      if (product.availability === "available_reference") summary.available += 1;
      else if (product.availability === "unavailable_reference") summary.unavailable += 1;
      else summary.unverified += 1;
      return summary;
    },
    { available: 0, unavailable: 0, unverified: 0 },
  );
}

function expectedFirst(products, sort) {
  const copy = [...products];
  if (sort === "disponibilidad") {
    const rank = (product) => product.availability === "available_reference" ? 0 : product.availability === "unverified" ? 1 : 2;
    copy.sort(
      (left, right) =>
        rank(left) - rank(right) ||
        (right.discountPercent || 0) - (left.discountPercent || 0) ||
        (right.savingAmount || 0) - (left.savingAmount || 0) ||
        tie(left, right),
    );
  } else if (sort === "descuento" || sort === "relevancia") {
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

async function cardVisualState(page, origin, product) {
  const query = product.barcode || product.name;
  await page.goto(`${origin}/catalogo-v6-9/?scope=todo&q=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    (slug) => document.querySelector("#gridV69 .v65-hit")?.getAttribute("href")?.includes(slug),
    product.slug,
  );
  return page.locator("#gridV69 .v66-card").first().evaluate((card) => {
    const action = card.querySelector(".v66-ask");
    const stock = card.querySelector(".v69-stock");
    const stockText = stock?.querySelector("strong");
    return {
      actionText: action?.textContent?.trim(),
      actionHeight: Math.round(action?.getBoundingClientRect().height || 0),
      actionColor: action ? getComputedStyle(action).backgroundColor : "",
      stockWidth: Math.round(stock?.getBoundingClientRect().width || 0),
      stockHeight: Math.round(stock?.getBoundingClientRect().height || 0),
      stockWeight: Number.parseInt(stockText ? getComputedStyle(stockText).fontWeight : "0", 10),
      stockOverflows: Boolean(
        stock &&
          (stock.scrollWidth > stock.clientWidth + 1 ||
            (stockText && stockText.scrollWidth > stockText.clientWidth + 1)),
      ),
    };
  });
}

async function selectSort(page, products, sort) {
  await page.locator("#sortV69").selectOption(sort);
  await page.waitForFunction(
    (expected) => new URL(location.href).searchParams.get("orden") === expected,
    sort === "descuento" ? null : sort,
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

test("V6.9 renderiza stock, orden, exclusividad y 5/2 columnas sin fuga del proveedor", { timeout: 180_000 }, async () => {
  assert.ok(executablePath, "No se encontró Chrome/Chromium; definí CHROME_PATH para ejecutar la guarda visual.");
  const runtime = await runtimeTarget();
  let browser;

  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const providerRequests = [];
    const consoleErrors = [];
    const failedResponses = [];
    const failedRequests = [];
    page.on("request", (request) => {
      if (/gpsfarma/i.test(request.url())) providerRequests.push(request.url());
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure();
      if (failure?.errorText !== "net::ERR_ABORTED") {
        failedRequests.push({ url: request.url(), error: failure?.errorText });
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedResponses.push({ url: response.url(), status: response.status() });
      }
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
    assert.doesNotMatch(apiText, /gpsfarma|provider|"sku"|"source"/i);
    const api = JSON.parse(apiText);
    assert.ok(api.products.every((product) => typeof product.barcode === "string"));
    assert.equal(api.totalProducts, api.products.length);
    assert.deepEqual(api.availabilitySummary, publicAvailabilitySummary(api.products));
    assert.equal(api.products.filter((product) => product.availability === "available_reference").length, api.availabilitySummary.available);
    assert.equal(api.products.filter((product) => product.availability === "unavailable_reference").length, api.availabilitySummary.unavailable);
    assert.equal(api.products.filter((product) => product.availability === "unverified").length, api.availabilitySummary.unverified);
    assert.equal(api.availabilitySummary.unverified, 0);

    await page.goto(`${runtime.origin}/inicio-v6-9/`, { waitUntil: "domcontentloaded" });
    await page.locator(".v69-home-brand").first().waitFor();
    assert.equal(await page.locator("#buscar-v69").isVisible(), true);
    assert.equal(await page.locator("#sortV69").inputValue(), "descuento");
    assert.equal(await page.locator(".v69-home-brand").count(), 11);
    assert.equal(await page.locator(".v69-home-brand-index").count(), 0);
    assert.equal(await page.locator("#marcas-inicio-v69").getAttribute("class"), "v69-home-sections");
    assert.equal(await page.locator(".v69-home-brand").first().locator(".v66-card").count(), 10);
    assert.equal(
      await page.locator(".v69-home-brand").first().locator(".v66-card").evaluateAll((cards) => {
        const firstTop = cards[0]?.getBoundingClientRect().top;
        return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2).length;
      }),
      5,
    );
    assert.equal(await hasHorizontalOverflow(page), false);
    await page.locator('[data-filter-menu-trigger="brand"]').click();
    await page.locator('[data-brand="ISDIN"]').click();
    await page.waitForFunction(() => location.pathname.includes("/catalogo-v6-9") && new URL(location.href).searchParams.get("marca") === "ISDIN");

    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo&orden=precio-asc`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("#gridV69 .v66-card").first().waitFor();
    assert.equal(await firstRowColumns(page), 5);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.equal(await page.locator("#gridV69 .v66-card").count(), 48);
    assert.equal(await page.locator("#gridV69 .v69-stock").count(), 48);
    assert.deepEqual(await page.locator("#sortV69 option").evaluateAll((options) => options.map((option) => option.value)), [
      "relevancia",
      "disponibilidad",
      "descuento",
      "precio-asc",
      "precio-desc",
      "nombre",
    ]);
    assert.equal(await page.locator("#sortV69").inputValue(), "precio-asc");
    assert.deepEqual(
      await page.locator(".v69-sort").evaluate((sort) => {
        const rect = sort.getBoundingClientRect();
        return [3, rect.height / 2, rect.height - 3].map((offset) =>
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + offset)?.id,
        );
      }),
      ["sortV69", "sortV69", "sortV69"],
    );
    assert.equal(await firstCardSlug(page), expectedFirst(api.products, "precio-asc").slug);
    assert.equal(await page.locator("#contextV69").isVisible(), false);
    assert.equal(await page.locator("#availabilityV69").isVisible(), false);
    assert.equal(await page.locator("#availabilityNoteV69").isVisible(), false);
    assert.equal(await page.locator("#loadMoreV69").isVisible(), true);
    await page.locator("#loadMoreV69").click();
    await page.waitForFunction(() => document.querySelectorAll("#gridV69 .v66-card").length === 96);
    assert.equal(await page.locator("#gridV69 .v66-card").count(), 96);
    assert.equal(await page.locator("#loadMoreV69").isVisible(), true);

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
    await selectSort(page, api.products, "disponibilidad");
    assert.equal(await page.locator("#gridV69 .v69-stock").first().innerText(), "Disponible para Entrega");
    await selectSort(page, api.products, "nombre");
    await selectSort(page, api.products, "relevancia");

    const allPages = Math.ceil(api.totalProducts / 48);
    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo&pagina=${allPages}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      (expected) => document.querySelectorAll("#gridV69 .v66-card").length === expected,
      api.totalProducts,
    );
    assert.equal(await page.locator("#loadMoreV69").isVisible(), false);
    const fullDesktopAudit = await page.locator("#gridV69").evaluate((grid) => {
      const cards = [...grid.querySelectorAll(".v66-card")];
      const failures = [];
      const counts = { available: 0, unavailable: 0, unverified: 0, attention: 0 };
      for (const [index, card] of cards.entries()) {
        const stock = card.querySelector(".v69-stock");
        const action = card.querySelector(".v66-ask");
        const label = stock?.textContent?.trim();
        const unavailable = card.classList.contains("v69-card-unavailable");
        const unverified = card.classList.contains("v69-card-unverified");
        const needsAttention = unavailable || unverified;
        if (unavailable) counts.unavailable += 1;
        else if (unverified) counts.unverified += 1;
        else counts.available += 1;
        if (action?.classList.contains("v69-ask-unavailable")) counts.attention += 1;
        const expectedLabel = unavailable
          ? "Consultar Disponibilidad"
          : unverified
            ? "Consultar Disponibilidad"
            : "Disponible para Entrega";
        const expectedColor = needsAttention ? "rgb(255, 209, 1)" : "rgb(37, 211, 102)";
        if (
          label !== expectedLabel ||
          action?.textContent?.trim() !== "Consultar" ||
          action?.classList.contains("v69-ask-unavailable") !== needsAttention ||
          (action && getComputedStyle(action).backgroundColor !== expectedColor) ||
          (stock && stock.scrollWidth > stock.clientWidth + 1)
        ) {
          failures.push({ index, label, expectedLabel });
        }
      }
      return { count: cards.length, counts, failures };
    });
    assert.equal(fullDesktopAudit.count, api.totalProducts);
    assert.deepEqual(
      fullDesktopAudit.counts,
      {
        available: api.availabilitySummary.available,
        unavailable: api.availabilitySummary.unavailable,
        unverified: api.availabilitySummary.unverified,
        attention: api.availabilitySummary.unavailable + api.availabilitySummary.unverified,
      },
    );
    assert.deepEqual(fullDesktopAudit.failures, []);
    assert.equal(await firstRowColumns(page), 5);
    assert.equal(await hasHorizontalOverflow(page), false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      (expected) => document.querySelectorAll("#gridV69 .v66-card").length === expected,
      api.totalProducts,
    );

    const isdinCount = api.products.filter((product) => product.brand.name === "ISDIN").length;
    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo&marca=ISDIN&need=solares`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      (expected) => document.querySelector("#countV69")?.textContent === `48 de ${expected}`,
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

    const available = api.products.find((product) => product.availability === "available_reference");
    assert.ok(available);
    await page.goto(`${runtime.origin}/producto-v6-9/${available.slug}/`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".v69-stock.is-pdp").waitFor();
    assert.equal((await page.locator("[data-history-back]").innerText()).trim(), "Volver");
    assert.match(await page.locator(".v69-stock.is-pdp").innerText(), /Disponible para Entrega/i);
    assert.doesNotMatch(await page.locator(".cta").getAttribute("class"), /v69-ask-unavailable/);
    assert.match(await page.locator(".cta").innerText(), /Consultar este producto por WhatsApp/i);
    assert.match(await page.locator(".v65-service-list").innerText(), /Consulta Personalizada por WhatsApp/i);
    assert.match(await page.locator(".v65-service-list").innerText(), /Coordinamos Retiro o Envío, Consultar formas de Pago/i);

    const unavailable = api.products.find((product) => product.availability === "unavailable_reference");
    assert.ok(unavailable);
    await page.goto(`${runtime.origin}/producto-v6-9/${unavailable.slug}/`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".v69-stock.is-unavailable.is-pdp").waitFor();
    assert.match(await page.locator(".v69-stock.is-unavailable.is-pdp").innerText(), /Consultar Disponibilidad/i);
    assert.equal((await page.locator(".cta").innerText()).trim(), "Consultar");
    assert.match(await page.locator(".cta").getAttribute("class"), /v69-ask-unavailable/);
    assert.equal(await page.locator(".cta").evaluate((element) => getComputedStyle(element).color), "rgb(255, 255, 255)");
    assert.equal(await hasHorizontalOverflow(page), false);

    const cardStates = [];
    for (const product of [available, unavailable]) {
      cardStates.push(await cardVisualState(page, runtime.origin, product));
    }
    assert.deepEqual(cardStates.map((state) => state.actionText), ["Consultar", "Consultar"]);
    assert.equal(new Set(cardStates.map((state) => state.actionHeight)).size, 1);
    assert.equal(new Set(cardStates.map((state) => state.stockWidth)).size, 1);
    assert.equal(new Set(cardStates.map((state) => state.stockHeight)).size, 1);
    assert.ok(cardStates.every((state) => state.stockWeight <= 650));
    assert.ok(cardStates.every((state) => !state.stockOverflows));
    assert.equal(cardStates[0].actionColor, "rgb(37, 211, 102)");
    assert.equal(cardStates[1].actionColor, "rgb(255, 209, 1)");

    await page.setViewportSize({ width: 981, height: 900 });
    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo`, { waitUntil: "domcontentloaded" });
    await page.locator("#gridV69 .v66-card").first().waitFor();
    assert.equal(await firstRowColumns(page), 5);
    assert.equal(await hasHorizontalOverflow(page), false);
    const narrowDesktopStates = [];
    for (const product of [available, unavailable]) {
      narrowDesktopStates.push(await cardVisualState(page, runtime.origin, product));
    }
    assert.ok(narrowDesktopStates.every((state) => !state.stockOverflows));
    assert.equal(new Set(narrowDesktopStates.map((state) => state.stockHeight)).size, 1);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`${runtime.origin}/producto-v6-9/${unavailable.slug}/`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(await page.locator(".cta").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 209, 1)");
    assert.equal(await page.locator(".topwa").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(37, 211, 102)");
    assert.equal(await page.locator(".float").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(37, 211, 102)");

    const identified = api.products.find((product) => /^\d{8,14}$/.test(product.barcode));
    assert.ok(identified, "La prueba real necesita al menos una ficha con código de barras.");
    await page.goto(`${runtime.origin}/producto-v6-9/${identified.slug}/`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(await page.locator(".v69-barcode").isVisible(), true);
    assert.match(await page.locator(".v69-barcode").innerText(), new RegExp(identified.barcode));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${runtime.origin}/inicio-v6-9/`, { waitUntil: "domcontentloaded" });
    await page.locator(".v69-home-brand").first().waitFor();
    assert.equal(await page.locator("#buscar-v69").isVisible(), true);
    assert.equal(await page.locator(".v67-filter-grid").isVisible(), true);
    assert.equal(
      await page.locator(".v69-home-brand").first().locator(".v66-card").evaluateAll(
        (cards) => cards.filter((card) => getComputedStyle(card).display !== "none").length,
      ),
      4,
    );
    assert.equal(
      await page.locator(".v69-home-brand").first().locator(".v66-card").evaluateAll((cards) => {
        const visible = cards.filter((card) => getComputedStyle(card).display !== "none");
        const firstTop = visible[0]?.getBoundingClientRect().top;
        return visible.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2).length;
      }),
      2,
    );
    assert.equal(await hasHorizontalOverflow(page), false);

    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo`, { waitUntil: "domcontentloaded" });
    await page.locator("#gridV69 .v66-card").first().waitFor();
    assert.equal(await firstRowColumns(page), 2);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.equal(await page.locator("#gridV69 .v69-stock").count(), 48);
    assert.equal(await page.locator("#sortV69").inputValue(), "descuento");
    assert.deepEqual(
      await page.locator(".v69-sort").evaluate((sort) => {
        const rect = sort.getBoundingClientRect();
        return [3, rect.height / 2, rect.height - 3].map((offset) =>
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + offset)?.id,
        );
      }),
      ["sortV69", "sortV69", "sortV69"],
    );
    assert.equal(new URL(page.url()).searchParams.has("orden"), false);
    assert.equal(await page.locator("#clearFiltersV69").isVisible(), false);
    assert.equal(await page.locator(".toplinks").isVisible(), false);
    const compactMobile = await page.evaluate(() => {
      const header = document.querySelector(".top");
      const logo = document.querySelector(".brandmark img");
      const searchTitle = document.querySelector(".v67-title h2");
      const search = document.querySelector("#searchV69");
      const sort = document.querySelector(".v69-sort");
      const catalogTitle = document.querySelector("#catalogTitleV69");
      const titleLines = new Set(
        [...(searchTitle?.querySelectorAll("span") || [])].map((span) => Math.round(span.getBoundingClientRect().top)),
      );
      const catalogStyle = catalogTitle ? getComputedStyle(catalogTitle) : null;
      return {
        headerHeight: Math.round(header?.getBoundingClientRect().height || 0),
        logoWidth: Math.round(logo?.getBoundingClientRect().width || 0),
        searchWidth: Math.round(search?.getBoundingClientRect().width || 0),
        searchTitleWidth: Math.round(searchTitle?.getBoundingClientRect().width || 0),
        sortHeight: Math.round(sort?.getBoundingClientRect().height || 0),
        searchTitleLines: titleLines.size,
        catalogTitleHeight: Math.round(catalogTitle?.getBoundingClientRect().height || 0),
        catalogTitleLineHeight: catalogStyle ? Number.parseFloat(catalogStyle.lineHeight) : 0,
        catalogTitleFits: Boolean(catalogTitle && catalogTitle.scrollWidth <= catalogTitle.clientWidth + 1),
      };
    });
    assert.ok(compactMobile.headerHeight <= 64, `El header móvil mide ${compactMobile.headerHeight}px.`);
    assert.ok(compactMobile.logoWidth >= 270, `El logo móvil mide ${compactMobile.logoWidth}px.`);
    assert.ok(compactMobile.searchWidth >= compactMobile.searchTitleWidth * 3);
    assert.ok(compactMobile.sortHeight <= 32, `El selector de orden mide ${compactMobile.sortHeight}px.`);
    assert.equal(compactMobile.searchTitleLines, 2);
    assert.ok(compactMobile.catalogTitleHeight <= compactMobile.catalogTitleLineHeight + 2);
    assert.equal(compactMobile.catalogTitleFits, true);
    const mobileType = await page.evaluate(() => {
      const size = (selector) => Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      return {
        nav: size(".toplinks a"),
        sort: size("#sortV69"),
        menu: size('[data-filter-menu-trigger="need"] strong'),
        brand: size("#gridV69 .v66-brand"),
        title: size("#gridV69 .v66-card h3"),
        fact: size("#gridV69 .v66-facts dt"),
      };
    });
    assert.ok(mobileType.nav >= 12);
    assert.ok(mobileType.sort >= 15);
    assert.ok(mobileType.menu >= 15);
    assert.ok(mobileType.brand >= 17);
    assert.ok(mobileType.title >= 15.5);
    assert.ok(mobileType.fact < mobileType.title, "La información secundaria no debe competir con el título.");

    await page.locator("#searchV69").fill("eucerin");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "eucerin");
    await page.locator("#searchV69").fill("");
    await page.waitForFunction(() => !new URL(location.href).searchParams.has("scope"));
    assert.equal(await page.locator("#sortV69").inputValue(), "descuento");

    const mobileReturnUrl = page.url();
    await page.goto(`${runtime.origin}/producto-v6-9/${available.slug}/`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(await page.locator(".toplinks").isVisible(), true);
    assert.equal((await page.locator(".toplinks").innerText()).trim(), "Volver");
    assert.equal(await page.locator(".float").isVisible(), false);
    assert.deepEqual(
      await page.locator(".cta").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          alignItems: style.alignItems,
          justifyContent: style.justifyContent,
          textAlign: style.textAlign,
        };
      }),
      { alignItems: "center", justifyContent: "center", textAlign: "center" },
    );

    await page.locator("[data-history-back]").click();
    await page.waitForURL(mobileReturnUrl);

    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await firstRowColumns(page), 2);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.ok(await page.locator(".top").evaluate((element) => element.getBoundingClientRect().height <= 64));
    assert.ok(
      await page.locator("#catalogTitleV69").evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo&pagina=${allPages}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      (expected) => document.querySelectorAll("#gridV69 .v66-card").length === expected,
      api.totalProducts,
    );
    assert.equal(await firstRowColumns(page), 2);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.equal(
      await page.locator("#gridV69 .v69-stock").evaluateAll((stocks) =>
        stocks.every((stock) => stock.scrollWidth <= stock.clientWidth + 1),
      ),
      true,
    );
    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo`, { waitUntil: "domcontentloaded" });
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

    await page.locator("#searchV69").fill(identified.barcode);
    const barcodeMatches = api.products.filter((product) => product.barcode === identified.barcode);
    await page.waitForFunction(
      (expected) => document.querySelector("#countV69")?.textContent === `${expected} de ${expected}`,
      barcodeMatches.length,
    );
    assert.equal(await page.locator("#gridV69 .v66-card").count(), barcodeMatches.length);
    await page.locator("#gridV69 .v65-hit").first().click();
    await page.waitForURL(/\/producto-v6-9\//);
    assert.equal(await page.locator(".v69-barcode").isVisible(), false);

    await page.goto(`${runtime.origin}/catalogo-v6-9/?scope=todo`, { waitUntil: "domcontentloaded" });

    await page.locator("#searchV69").fill("protetor solar bebe");
    await page.waitForFunction(() => document.querySelector("#countV69")?.textContent === "2 de 2");
    assert.equal(await page.locator("#gridV69 .v66-card").count(), 2);
    assert.match(await page.locator("#catalogTitleV69").textContent(), /protetor solar bebe/i);
    assert.deepEqual(providerRequests, []);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(failedResponses, []);
    assert.deepEqual(failedRequests, []);
  } finally {
    if (browser) await browser.close();
    await runtime.cleanup();
  }
});
