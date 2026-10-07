import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { app } from "../dist/server.js";
import { resetCatalogV69CacheForTests } from "../dist/data-v69.js";

test("A+B+C en el campo conserva unión, orden, carga progresiva, reload y regreso en PC/móvil", { timeout: 120_000 }, async () => {
  const executablePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(p => p && existsSync(p));
  assert.ok(executablePath);
  resetCatalogV69CacheForTests();
  const server = app({ NODE_ENV: "test", V69_LOCAL_PREVIEW: "1", V69_CATALOG_FILE: path.resolve("data/catalog-v69.json") });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const dto = await fetch(origin + "/api/catalog-v6-9").then(r => r.json());
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.origin === origin && !url.pathname.startsWith("/api/meta") ? route.continue() : route.abort();
      });
      await page.goto(origin + "/?scope=todo", { waitUntil: "load" });
      for (const names of [["Dermaglos", "Neutrogena"], ["Dermaglos", "Neutrogena", "Eucerin"]]) {
        const query = names.join("+");
        const expected = dto.products.filter(p => names.includes(p.brand.name));
        assert.ok(expected.length > 64);
        await page.locator("#searchV69").fill(query);
        await page.waitForFunction(({ count, query }) => new URL(location.href).searchParams.get("q") === query &&
          document.querySelector("#countV69").textContent === `64 de ${count}`, { count: expected.length, query });
        await page.locator("#sortV69").selectOption("precio-asc");
        await page.waitForFunction(() => new URL(location.href).searchParams.get("orden") === "precio-asc");
        await page.locator("#loadMoreV69").click();
        await page.waitForFunction(count => document.querySelectorAll("#gridV69 .v66-card").length === Math.min(128, count), expected.length);
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(count => document.querySelectorAll("#gridV69 .v66-card").length === Math.min(128, count), expected.length);
        const ids = await page.locator("#gridV69 .v65-hit").evaluateAll(links => links.map(a => new URL(a.href).pathname.split("/").pop()));
        assert.equal(new Set(ids).size, ids.length);
        assert.ok(ids.every(id => expected.some(p => p.publicId === id)));
        const prices = ids.map(id => Math.round(expected.find(p => p.publicId === id).offerPrice));
        assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
        assert.equal(await page.locator("#searchV69").inputValue(), query);
        await page.locator("#gridV69 .v65-hit").first().click();
        await page.goBack({ waitUntil: "load" });
        await page.waitForFunction(count => document.querySelectorAll("#gridV69 .v66-card").length === Math.min(128, count), expected.length);
        assert.equal(await page.locator("#searchV69").inputValue(), query);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    resetCatalogV69CacheForTests();
  }
});
