import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { app } from "../dist/server.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const executablePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean).find(existsSync);

test("el panel V6.9 gobierna navegación y EAN, recuerda cambios y nunca despliega", { timeout: 120_000 }, async () => {
  assert.ok(executablePath, "No se encontró Chrome/Chromium para el E2E administrativo.");
  const directory = await mkdtemp(path.join(tmpdir(), "fg-v69-admin-e2e-"));
  const server = app({
    ...process.env,
    NODE_ENV: "test",
    V69_LOCAL_PREVIEW: "1",
    V69_ADMIN_LOCAL_TOKEN: "admin-e2e-token",
    V69_ADMIN_CONFIG_FILE: path.join(directory, "admin.json"),
    V69_CATALOG_FILE: path.join(ROOT, "data", "catalog-v69.json"),
    V69_EXCLUSIONS_FILE: path.join(ROOT, "data", "catalog-exclusions-v69.local.json"),
    V69_MAGENTO_TAXONOMY_FILE: path.join(ROOT, "data", "catalog-taxonomy-v69.local.json"),
    V69_REQUIRE_EXCLUSIONS: "1",
    V69_REQUIRE_MAGENTO_TAXONOMY: "1",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${origin}/admin-v6-9`, { waitUntil: "domcontentloaded" });
    await page.locator("#localAdminToken").fill("admin-e2e-token");
    await page.locator("#localLogin").click();
    await page.locator("#adminApp").waitFor({ state: "visible" });
    assert.equal(await page.locator("[data-tab]").count(), 4);
    assert.equal(await page.locator('[data-action="deploy"]').count(), 0);
    assert.equal(await page.locator(".admin-cards article").count(), 6);

    await page.locator('[data-tab="navigation"]').click();
    assert.equal(await page.locator(".admin-brand-row").count(), 15);
    assert.match(await page.locator("#adminContent").innerText(), /Productos Saludables/);
    assert.equal(await page.locator('[data-action="add-brand"][data-name="L\'Oréal Revitalift"]').count(), 0);
    const publicBeforeBrandExclusion = await page.request.get(`${origin}/api/catalog-v6-9`).then((response) => response.json());
    const disableBrand = page.locator('[data-action="disable-brand"]').first();
    const disabledBrandSlug = await disableBrand.getAttribute("data-slug");
    const disabledBrandName = await disableBrand.getAttribute("data-name");
    assert.ok(disabledBrandSlug && disabledBrandName);
    const disabledBrandProduct = publicBeforeBrandExclusion.products.find((product) =>
      product.brand?.name === disabledBrandName || product.aliases?.includes(disabledBrandName));
    assert.ok(disabledBrandProduct);
    await disableBrand.click();
    assert.equal(await page.locator(`[data-action="enable-brand"][data-slug="${disabledBrandSlug}"]`).count(), 1);
    const outOfStockSort = page.locator('[data-field="show-out-of-stock-sort"]');
    assert.equal(await outOfStockSort.isChecked(), true);
    await outOfStockSort.uncheck();
    await page.locator('.admin-brand-row input[data-action="toggle-brand"]').first().uncheck();
    await page.locator('[data-action="publish-navigation"]').click();
    await page.waitForFunction(() => !document.body.classList.contains("is-busy"));
    await page.waitForFunction(() => document.querySelector("#adminContent")?.textContent?.includes("14 habilitadas"));
    assert.doesNotMatch(await page.request.get(`${origin}/catalogo-v6-9?scope=todo`).then((response) => response.text()), /option value="sin-stock"/);
    const publicAfterBrandExclusion = await page.request.get(`${origin}/api/catalog-v6-9`).then((response) => response.json());
    assert.equal(publicAfterBrandExclusion.products.some((product) => product.publicId === disabledBrandProduct.publicId), false);
    assert.equal((await page.request.get(`${origin}/p/${disabledBrandProduct.publicId}`)).status(), 404);
    assert.doesNotMatch(await page.request.get(`${origin}/sitemap.xml`).then((response) => response.text()), new RegExp(`/p/${disabledBrandProduct.publicId}<`));
    const savedPolicy = await page.request.get(`${origin}/api/admin-v69/state`, {
      headers: { authorization: "Bearer admin-e2e-token" },
    }).then((response) => response.json());
    assert.ok(savedPolicy.policy.navigation.excludedBrandSlugs.includes(disabledBrandSlug));
    await page.locator(`[data-action="enable-brand"][data-slug="${disabledBrandSlug}"]`).click();
    await page.locator('[data-action="publish-navigation"]').click();
    await page.waitForFunction(() => !document.body.classList.contains("is-busy"));
    await page.waitForFunction((slug) => document.querySelector(`[data-action="disable-brand"][data-slug="${slug}"]`), disabledBrandSlug);
    const publicAfterReenable = await page.request.get(`${origin}/api/catalog-v6-9`).then((response) => response.json());
    assert.ok(publicAfterReenable.products.some((product) => product.publicId === disabledBrandProduct.publicId));

    await page.locator('[data-tab="ean"]').click();
    await page.locator('[data-ean-input="exclude"]').fill("3337875694469");
    await page.locator('[data-ean-note="exclude"]').fill("E2E local");
    await page.locator('[data-action="add-ean"][data-kind="exclude"]').click();
    assert.match(await page.locator("#adminContent").innerText(), /3337875694469/);
    await page.locator('[data-action="publish-ean"]').click();
    await page.waitForFunction(() => !document.body.classList.contains("is-busy"));
    await page.waitForFunction(() => document.querySelector("#adminContent")?.textContent?.includes("Retinol B3") || document.querySelector("#adminContent")?.textContent?.includes("Pendiente"));

    await page.locator('[data-tab="operations"]').click();
    assert.match(await page.locator(".admin-no-deploy").innerText(), /no despliega/i);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#adminApp").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
