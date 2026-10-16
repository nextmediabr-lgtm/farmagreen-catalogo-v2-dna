import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { app } from "../dist/server.js";
import { resetCatalogV69CacheForTests } from "../dist/data-v69.js";
import { fragranceAudienceFixtureV69 } from "./fixtures/v69-fragrance-audience.mjs";
import { FRAGRANCE_AUDIENCE_OPTIONS_V69, fragranceAudienceV69 } from "../scripts/catalog-collections-v69.mjs";

test("Ordenar separa cuatro ramas de Fragancias en PC/móvil y conserva URL, volver y otros catálogos", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "v69-fragrance-e2e-"));
  const catalog = fragranceAudienceFixtureV69();
  const file = path.join(directory, "catalog.json");
  await writeFile(file, JSON.stringify(catalog));
  resetCatalogV69CacheForTests();
  const server = app({ NODE_ENV: "test", V69_LOCAL_PREVIEW: "1", V69_SYNC_ENABLED: "0", V69_CATALOG_FILE: file,
    V69_EXCLUSIONS_FILE: path.join(directory, "missing-exclusions.json"), V69_MAGENTO_TAXONOMY_FILE: path.join(directory, "missing-taxonomy.json") });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const dto = await fetch(origin + "/api/catalog-v6-9").then(r => r.json());
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(origin + "/catalogo?scope=todo&view=perfumes-fragancias", { waitUntil: "load" });
      for (const option of FRAGRANCE_AUDIENCE_OPTIONS_V69) {
        await page.locator("#sortV69").selectOption(option.value);
        await page.waitForFunction(value => new URL(location.href).searchParams.get("orden") === value, option.value);
        const expected = dto.products.filter(p => fragranceAudienceV69(p) === option.group);
        assert.equal(await page.locator("#gridV69 article").count(), Math.min(expected.length, 64));
        assert.ok((await page.locator("#catalogTitleV69").textContent()).includes(option.label));
        if (expected.length > 64) {
          await page.locator("#loadMoreV69").click();
          await page.waitForFunction(count => document.querySelectorAll("#gridV69 article").length === count, expected.length);
        }
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(count => document.querySelectorAll("#gridV69 article").length === count, expected.length);
        assert.equal(await page.locator("#sortV69").inputValue(), option.value);
        const ids = await page.locator("#gridV69 .v65-hit").evaluateAll(links => links.map(link => new URL(link.href).pathname.split("/").pop()));
        assert.deepEqual(ids.sort(), expected.map(p => p.publicId).sort());
      }
      await page.locator("#gridV69 .v65-hit").first().click();
      await page.goBack({ waitUntil: "load" });
      assert.equal(await page.locator("#sortV69").inputValue(), "fragancias-infantiles");
      await page.locator("#showAllV69").click();
      await page.waitForFunction(() => document.querySelector("#sortV69").value === "relevancia" &&
        document.querySelectorAll("#sortV69 [data-fragrance-audience]").length === 0);
      assert.equal(await page.locator("#sortV69").inputValue(), "relevancia");
      assert.equal(await page.locator("#sortV69 [data-fragrance-audience]").count(), 0);
      await page.locator('[data-filter-menu-trigger="need"]').click();
      await page.locator('[data-need="fragancias"]').click();
      await page.waitForFunction(() => document.querySelectorAll("#sortV69 [data-fragrance-audience]").length === 4);
      assert.equal(await page.locator("#sortV69 [data-fragrance-audience]").count(), 4);
      await page.locator("#sortV69").selectOption("precio-asc");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    resetCatalogV69CacheForTests();
    await rm(directory, { recursive: true, force: true });
  }
});
