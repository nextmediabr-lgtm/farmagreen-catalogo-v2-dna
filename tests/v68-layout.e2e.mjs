import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { app } from "../dist/server.js";

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));

function startServer() {
  const server = app({ ...process.env, NODE_ENV: "test", V68_LOCAL_PREVIEW: "1" });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function firstRowColumns(page) {
  return page.locator("#gridV68 .v66-card").evaluateAll((cards) => {
    const rects = cards.slice(0, 10).map((card) => card.getBoundingClientRect());
    const firstTop = rects[0]?.top;
    return rects.filter((rect) => Math.abs(rect.top - firstTop) < 2).length;
  });
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

test("V6.8 verifica el contrato renderizado 5 desktop / 2 mobile y el PDP largo", { timeout: 45_000 }, async () => {
  assert.ok(executablePath, "No se encontró Chrome/Chromium; definí CHROME_PATH para ejecutar la guarda visual.");
  const { server, origin } = await startServer();
  let browser;

  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const exposedSourceRequests = [];
    page.on("request", (request) => {
      if (/gpsfarma/i.test(request.url())) exposedSourceRequests.push(request.url());
    });
    await page.route("**/media-v6-8/**", (route) => route.abort());

    await page.goto(`${origin}/catalogo-v6-8/?scope=todo`, { waitUntil: "domcontentloaded" });
    await page.locator("#gridV68 .v66-card").first().waitFor();
    assert.equal(await firstRowColumns(page), 5);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.match(await page.locator("#gridV68 .v66-discount").first().textContent(), /^-\d+%$/);
    assert.match(await page.locator("#gridV68 .v68-stock").first().textContent(), /Disponible|No disponible|No verificado/);
    assert.match(await page.locator(".v68-commerce-freshness").textContent(), /Referencia|Estado comercial/);
    assert.deepEqual(await page.locator("#gridV68 .v66-card").first().locator(".v66-facts dt").allTextContents(), ["Presentación", "Uso"]);
    const desktopHierarchy = await page.locator("#gridV68 .v66-card").first().evaluate((card) => ({
      title: Number.parseFloat(getComputedStyle(card.querySelector("h3")).fontSize),
      fact: Number.parseFloat(getComputedStyle(card.querySelector(".v66-facts dd")).fontSize),
    }));
    assert.ok(desktopHierarchy.fact < desktopHierarchy.title, JSON.stringify(desktopHierarchy));

    const api = await (await fetch(`${origin}/api/catalog-v6-8`)).json();
    assert.deepEqual(api.availabilitySummary, { available: 0, unavailable: 0, unverified: 688 });
    assert.ok(api.products.every((product) => ["available_reference", "unavailable_reference", "unverified"].includes(product.availability)));
    assert.ok(api.products.every((product) => !("source" in product) && !("sku" in product) && !("barcode" in product)));
    const isdinCount = api.products.filter((product) => product.brand.name === "ISDIN").length;
    const dermaglosCount = api.products.filter((product) => product.brand.name === "Dermaglos").length;
    const acneCount = api.products.filter((product) => product.needs.includes("acne")).length;
    const hydrationProducts = api.products.filter((product) => product.needs.includes("hidratacion"));

    await page.goto(`${origin}/catalogo-v6-8/?scope=todo&marca=ISDIN&need=solares`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction((expected) => document.querySelector("#countV68")?.textContent === `24 de ${expected}`, isdinCount);
    assert.equal(await page.locator("#needSummaryV68").textContent(), "Todas");
    assert.equal(await page.locator("#countV68").textContent(), `24 de ${isdinCount}`);
    assert.equal(new URL(page.url()).searchParams.has("need"), false);

    await page.goto(`${origin}/catalogo-v6-8/?marca=ISDIN&scope=ofertas`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction((expected) => document.querySelector("#countV68")?.textContent === `24 de ${expected}`, isdinCount);
    assert.equal(await page.locator("#countV68").textContent(), `24 de ${isdinCount}`);
    assert.equal(new URL(page.url()).searchParams.get("scope"), "todo");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction((expected) => document.querySelector("#countV68")?.textContent === `24 de ${expected}`, isdinCount);

    await page.locator('[data-filter-menu-trigger="need"]').click();
    await page.locator('[data-need="acne"]').click();
    await page.waitForFunction((expected) => document.querySelector("#countV68")?.textContent === `24 de ${expected}`, acneCount);
    assert.match(await page.locator("#brandSummaryV68").textContent(), /^Todas · /);
    assert.equal(await page.locator("#needSummaryV68").textContent(), "Acné");
    assert.equal(new URL(page.url()).searchParams.has("marca"), false);
    assert.equal(new URL(page.url()).searchParams.get("need"), "acne");

    await page.locator('[data-filter-menu-trigger="brand"]').click();
    await page.locator('[data-brand="Dermaglos"]').click();
    await page.waitForFunction((expected) => document.querySelector("#countV68")?.textContent === `24 de ${expected}`, dermaglosCount);
    assert.equal(await page.locator("#needSummaryV68").textContent(), "Todas");
    assert.equal(await page.locator("#countV68").textContent(), `24 de ${dermaglosCount}`);
    assert.equal(new URL(page.url()).searchParams.get("marca"), "Dermaglos");
    assert.equal(new URL(page.url()).searchParams.has("need"), false);

    await page.goto(`${origin}/catalogo-v6-8/?scope=todo&q=protetor%20solar%20bebe`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#countV68")?.textContent === "2 de 2");
    assert.equal(await page.locator("#countV68").textContent(), "2 de 2");

    await page.goto(`${origin}/catalogo-v6-8/?scope=todo&q=hidratación`, { waitUntil: "domcontentloaded" });
    const serverNeedCount = Number(
      (await page.locator("#brandSummaryV68").textContent()).match(/·\s*(\d+)$/)?.[1] || 0,
    );
    assert.ok(serverNeedCount >= hydrationProducts.length);
    while (await page.locator("#loadMoreV68").isVisible()) await page.locator("#loadMoreV68").click();
    const needResultSlugs = new Set(
      await page.locator("#gridV68 .v65-hit").evaluateAll((links) =>
        links.map((link) => new URL(link.href).pathname.split("/").filter(Boolean).at(-1)),
      ),
    );
    assert.ok(hydrationProducts.every((product) => needResultSlugs.has(product.slug)));

    await page.goto(`${origin}/catalogo-v6-8/?scope=todo&marca=Aveeno`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#countV68")?.textContent === "14 de 14");
    assert.equal(await page.locator("#catalogTitleV68").textContent(), "Aveno");
    assert.equal(await page.locator("#gridV68 .v66-brand").first().textContent(), "Aveno");

    const discountedProduct = api.products.find((product) => product.discountPercent > 0);
    assert.ok(discountedProduct);
    await page.goto(`${origin}/producto-v6-8/${discountedProduct.slug}/`, { waitUntil: "domcontentloaded" });
    assert.match(await page.locator(".v67-pdp-card-top .v66-discount").textContent(), /^-\d+%$/);
    assert.match(await page.locator(".v66-detail-price b").textContent(), /^-\d+%$/);
    assert.equal(await page.locator(".v68-stock.is-pdp").count(), 1);

    const unverifiedProduct = api.products.find((product) => product.availability === "unverified");
    assert.ok(unverifiedProduct);
    await page.goto(`${origin}/producto-v6-8/${unverifiedProduct.slug}/`, { waitUntil: "domcontentloaded" });
    assert.match(await page.locator(".v68-stock.is-unverified.is-pdp").textContent(), /No verificado/);
    assert.equal(await page.locator(".cta").textContent(), "Consultar disponibilidad por WhatsApp");

    const longProduct = api.products.find((product) => product.publicId === "406a621c346c");
    assert.ok(longProduct);
    await page.goto(`${origin}/producto-v6-8/${longProduct.slug}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".v65-photo").waitFor();
    const pdpMetrics = await page.evaluate(() => {
      const photo = document.querySelector(".v65-photo");
      const buybox = document.querySelector(".v65-buybox");
      const photoRect = photo.getBoundingClientRect();
      const buyboxRect = buybox.getBoundingClientRect();
      return {
        alignSelf: getComputedStyle(photo).alignSelf,
        photoTop: photoRect.top,
        buyboxTop: buyboxRect.top,
        photoHeight: photoRect.height,
        buyboxHeight: buyboxRect.height,
      };
    });
    assert.equal(pdpMetrics.alignSelf, "start");
    assert.ok(Math.abs(pdpMetrics.photoTop - pdpMetrics.buyboxTop) < 2, JSON.stringify(pdpMetrics));
    assert.ok(pdpMetrics.photoHeight < pdpMetrics.buyboxHeight * 0.75, JSON.stringify(pdpMetrics));
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.equal(await page.locator(".v68-source").count(), 0);
    assert.doesNotMatch(await page.locator("body").innerText(), /Fuente(?: de referencia)?:/i);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/catalogo-v6-8/?scope=todo`, { waitUntil: "domcontentloaded" });
    await page.locator("#gridV68 .v66-card").first().waitFor();
    assert.equal(await firstRowColumns(page), 2);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.match(await page.locator("#gridV68 .v66-discount").first().textContent(), /^-\d+%$/);
    assert.equal(await page.locator("#gridV68 .v68-stock").count(), 24);
    const mobileHierarchy = await page.locator("#gridV68 .v66-card").first().evaluate((card) => ({
      title: Number.parseFloat(getComputedStyle(card.querySelector("h3")).fontSize),
      fact: Number.parseFloat(getComputedStyle(card.querySelector(".v66-facts dd")).fontSize),
    }));
    assert.ok(mobileHierarchy.fact < mobileHierarchy.title, JSON.stringify(mobileHierarchy));

    await page.locator('[data-filter-menu-trigger="brand"]').click();
    await page.locator('[data-brand="ISDIN"]').click();
    await page.waitForFunction((expected) => document.querySelector("#countV68")?.textContent === `24 de ${expected}`, isdinCount);
    assert.equal(await page.locator("#needSummaryV68").textContent(), "Todas");
    assert.equal(new URL(page.url()).searchParams.has("need"), false);

    await page.locator('[data-filter-menu-trigger="need"]').click();
    await page.locator('[data-need="acne"]').click();
    await page.waitForFunction((expected) => document.querySelector("#countV68")?.textContent === `24 de ${expected}`, acneCount);
    assert.match(await page.locator("#brandSummaryV68").textContent(), /^Todas · /);
    assert.equal(new URL(page.url()).searchParams.has("marca"), false);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.deepEqual(exposedSourceRequests, []);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
});
