import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { app } from "../dist/server.js";
import { resetCatalogV69CacheForTests } from "../dist/data-v69.js";
import { encodeCatalogV69 } from "../scripts/catalog-codec-v69.mjs";

test("transporte compacto conserva 64 fichas ante error y reintenta con DTO antiguo o compacto", { timeout: 60_000 }, async () => {
  const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(p => p && existsSync(p));
  assert.ok(executablePath);
  resetCatalogV69CacheForTests();
  const server = app({ NODE_ENV: "test", V69_LOCAL_PREVIEW: "1", V69_CATALOG_FILE: path.resolve("data/catalog-v69.json") });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const full = await fetch(`${origin}/api/catalog-v6-9`).then(r => r.json());
    assert.ok(full.products.length > 128);
    const bad = encodeCatalogV69(full, "invalid-test");
    bad.products[0].brand = 999999;
    let mode = "invalid", requests = 0;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // Exercise explicitly deferred transport while automatic preparation is
    // tested separately, including its failure/retry behavior.
    await page.addInitScript(() => Object.defineProperty(navigator, "connection", {
      value: { saveData: true, effectiveType: "4g" }, configurable: true,
    }));
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.route("**/*", async route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin !== origin || requestUrl.pathname.startsWith("/api/meta")) return route.abort();
      if (requestUrl.pathname !== "/api/catalog-v6-9") return route.continue();
      requests++;
      assert.equal(requestUrl.searchParams.get("format"), "compact-v1");
      if (mode === "server-error") return route.fulfill({ status: 503, body: "Temporal" });
      if (mode === "normal") return route.continue();
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(mode === "invalid" ? bad : full) });
    });
    for (const failure of ["invalid", "server-error"]) {
      mode = failure;
      const beforeRequests = requests;
      await page.goto(`${origin}/?scope=todo`, { waitUntil: "load" });
      assert.equal(requests, beforeRequests, "La descarga sigue diferida hasta interacción.");
      await page.evaluate(() => { window.__initialCards = Array.from(document.querySelectorAll("#gridV69 .v66-card")); });
      assert.equal(await page.locator("#gridV69 .v66-card").count(), 64);
      await page.locator("#loadMoreV69").click();
      await page.waitForFunction(() => document.body.dataset.v69CatalogLoaded === "error");
      assert.equal(await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll("#gridV69 .v66-card"));
        return cards.length === 64 && cards.every((card, index) => card === window.__initialCards[index]);
      }), true, "Un error de transporte no reemplaza las fichas SSR existentes.");
      mode = "legacy";
      await page.locator("#loadMoreV69").click();
      await page.waitForFunction(() => document.querySelectorAll("#gridV69 .v66-card").length === 128);
      assert.equal(requests, beforeRequests + 2);
    }
    mode = "normal";
    await page.reload({ waitUntil: "load" });
    // Reload keeps the existing URL pagination contract (128 already shown).
    await page.waitForFunction(() => document.querySelectorAll("#gridV69 .v66-card").length === 128);
    await page.locator("#loadMoreV69").click();
    await page.waitForFunction(() => document.querySelectorAll("#gridV69 .v66-card").length === 192);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    resetCatalogV69CacheForTests();
  }
});

test("home sin ofertas sobrevive a hidratar, navegar, buscar y recargar", { timeout: 45_000 }, async () => {
  const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(p => p && existsSync(p));
  assert.ok(executablePath, "Se requiere Chrome local para la verificación, no se omite la prueba.");
  const directory = await mkdtemp(path.join(tmpdir(), "v69-zero-offers-"));
  const fixture = JSON.parse(await readFile(new URL("../data/catalog-v69.json", import.meta.url), "utf8"));
  fixture.products = fixture.products.filter(p => p.brand.name === "Eucerin").slice(0, 6).map(p => ({ ...p, offerPrice: p.listPrice, discountPercent: 0, savingAmount: 0 }));
  fixture.totalProducts = fixture.products.length;
  assert.ok(fixture.totalProducts > 0);
  const catalogFile = path.join(directory, "catalog.json");
  const exclusionsFile = path.join(directory, "exclusions.json");
  await writeFile(catalogFile, JSON.stringify(fixture));
  await writeFile(exclusionsFile, JSON.stringify({ products: [], skus: [], barcodes: [], urls: [], hidden: {} }));
  resetCatalogV69CacheForTests();
  const server = app({ NODE_ENV: "test", V69_LOCAL_PREVIEW: "1", V69_CATALOG_FILE: catalogFile, V69_EXCLUSIONS_FILE: exclusionsFile });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "load" });
    assert.equal(await page.locator("#gridV69 .v66-card").count(), fixture.totalProducts);
    assert.equal(await page.locator("#offersEmptyV69").isVisible(), true);
    assert.equal(await page.getByRole("link", { name: "Ofertas", exact: true }).count(), 0);
    await page.getByRole("link", { name: "Productos", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("#gridV69 .v66-card").length > 0);
    await page.getByPlaceholder("Producto, marca o necesidad").fill("eucerin");
    await page.waitForFunction(() => document.querySelectorAll("#gridV69 .v66-card").length === 6);
    await page.reload({ waitUntil: "load" });
    assert.ok(await page.locator("#gridV69 .v66-card").count() > 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    resetCatalogV69CacheForTests();
    await rm(directory, { recursive: true, force: true });
  }
});
