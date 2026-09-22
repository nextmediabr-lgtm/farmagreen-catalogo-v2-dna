import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { app } from "../dist/server.js";
import { resetCatalogV69CacheForTests } from "../dist/data-v69.js";

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
