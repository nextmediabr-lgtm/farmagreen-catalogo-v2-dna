import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { app } from "../src/server.js";
import { adminStateV69 } from "../src/catalog-admin-http-v69.js";
import { defaultCatalogAdminDocumentV69 } from "../src/catalog-admin-v69.js";
import type { CatalogV69, ProductV69 } from "../src/data-v69.js";

const ROOT = path.resolve(import.meta.dirname, "..");

test("el panel integral autentica, publica configuración, recuerda y recibe post-deploy", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fg-v69-admin-http-"));
  const adminFile = path.join(directory, "admin.json");
  const server = app({
    ...process.env,
    NODE_ENV: "test",
    V69_LOCAL_PREVIEW: "1",
    V69_ADMIN_LOCAL_TOKEN: "admin-local-test",
    V69_AGENT_MANAGER_TOKEN: "agent-manager-test",
    V69_ADMIN_CONFIG_FILE: adminFile,
    V69_CATALOG_FILE: path.join(ROOT, "data", "catalog-v69.json"),
    V69_EXCLUSIONS_FILE: path.join(ROOT, "data", "catalog-exclusions-v69.local.json"),
    V69_MAGENTO_TAXONOMY_FILE: path.join(ROOT, "data", "catalog-taxonomy-v69.local.json"),
    V69_REQUIRE_EXCLUSIONS: "1",
    V69_REQUIRE_MAGENTO_TAXONOMY: "1",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const auth = { authorization: "Bearer admin-local-test" };
  try {
    const [page, script, style, unauthorized] = await Promise.all([
      fetch(`${origin}/admin-v6-9`),
      fetch(`${origin}/admin-v69-3.js`),
      fetch(`${origin}/admin-v69-1.css`),
      fetch(`${origin}/api/admin-v69/state`),
    ]);
    assert.equal(page.status, 200);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    assert.equal(unauthorized.status, 401);
    const html = await page.text();
    assert.match(html, /Administración V6\.9/);
    assert.match(html, /admin-v69-3\.js\?v=20260826-3/);
    assert.doesNotMatch(html, /data-action="deploy"/);

    const first = await fetch(`${origin}/api/admin-v69/state`, { headers: auth });
    assert.equal(first.status, 200);
    const state = await first.json();
    assert.equal(state.admin.revision, 0);
    assert.equal(state.catalog.navigationBrands.length, 16);
    assert.equal(state.catalog.navigationBrands.at(-1).name, "Productos Saludables");
    assert.doesNotMatch(JSON.stringify(state), /"sku"|"source"|gpsfarma/i);
    const publicBefore = await fetch(`${origin}/api/catalog-v6-9`).then((response) => response.json());
    const productToExclude = publicBefore.products.find((product: { barcode?: string }) => /^\d{8,14}$/.test(product.barcode || ""));
    const eanToExclude = productToExclude?.barcode;
    assert.ok(eanToExclude);

    const policy = structuredClone(state.policy);
    policy.navigation.featuredBrands[0].enabled = false;
    policy.navigation.umbrella.preserveBrandSlugs = policy.navigation.umbrella.preserveBrandSlugs.filter(
      (slug: string) => slug !== policy.navigation.featuredBrands[0].slug,
    );
    policy.eanRules.exclude.push({
      ean: eanToExclude,
      note: "Prueba local",
      createdAt: "2026-08-26T00:00:00.000Z",
    });
    const published = await fetch(`${origin}/api/admin-v69/policy`, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 0, policy, summary: "Prueba integral local." }),
    });
    assert.equal(published.status, 200);
    assert.equal((await published.json()).revision, 1);
    const publicAfter = await fetch(`${origin}/api/catalog-v6-9`).then((response) => response.json());
    assert.equal(publicAfter.totalProducts, publicBefore.totalProducts - 1);
    assert.equal(publicAfter.products.some((product: { barcode: string }) => product.barcode === eanToExclude), false);
    assert.equal((await fetch(`${origin}/p/${productToExclude.publicId}`)).status, 404);
    assert.doesNotMatch(await fetch(`${origin}/sitemap.xml`).then((response) => response.text()), new RegExp(`/p/${productToExclude.publicId}<`));

    const receipt = await fetch(`${origin}/api/admin-v69/deploy-receipt`, {
      method: "POST",
      headers: {
        authorization: "Bearer agent-manager-test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commit: "abc1234",
        build: "build-local",
        cloudRunRevision: "farmagreen-v69-preprod-local",
        healthy: true,
        products: 1459,
        verifiedAt: "2026-08-26T01:00:00.000Z",
      }),
    });
    assert.equal(receipt.status, 202);

    const finalState = await fetch(`${origin}/api/admin-v69/state`, { headers: auth }).then((response) => response.json());
    assert.equal(finalState.admin.revision, 1);
    assert.equal(finalState.memory[0].type, "deploy");
    assert.equal(finalState.memory.some((entry: { type: string }) => entry.type === "ean"), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("el panel no colapsa marcas técnicas que heredaron el mismo slug Saludables", () => {
  const products = [
    technicalProduct("one", "Goodskin"),
    technicalProduct("two", "102 años"),
    technicalProduct("three", "Bagó"),
    technicalProduct("four", "Bagó +"),
  ];
  const catalog: CatalogV69 = {
    version: 6.9,
    syncedAt: "2026-08-26T00:00:00.000Z",
    commerceSyncedAt: "2026-08-26T00:00:00.000Z",
    availabilityReferenceAt: "2026-08-26T00:00:00.000Z",
    totalProducts: products.length,
    products,
  };
  const state = adminStateV69({
    document: defaultCatalogAdminDocumentV69(new Date("2026-08-26T00:00:00Z")),
    catalog,
    runtime: {
      status: "ready",
      catalogVersion: 6.9,
      products: 4,
      commerceSyncedAt: "2026-08-26T00:00:00.000Z",
      lastSuccessAt: "2026-08-26T00:00:00.000Z",
      lastFailureAt: null,
      syncConfigured: true,
      discoveryConfigured: true,
      lastDiscoveryAt: "2026-08-26T00:00:00.000Z",
    },
    configured: true,
    authenticationConfigured: true,
  });
  assert.deepEqual(state.catalog.technicalBrands.map((entry) => entry.name).sort(), ["102 años", "Bagó", "Bagó +", "Goodskin"]);
});

function technicalProduct(publicId: string, name: string): ProductV69 {
  return {
    publicId,
    slug: publicId,
    name: `Producto ${name}`,
    brand: { id: publicId, slug: "productos-saludables", name, aliases: [] },
    line: name,
    primaryCategory: "nutricion",
    categorySlugs: ["nutricion"],
    needs: ["nutricion"],
    aliases: [],
    description: "Producto de prueba.",
    listPrice: 100,
    offerPrice: 100,
    savingAmount: 0,
    discountPercent: 0,
    availability: "limited",
    availabilityCheckedAt: "2026-08-26T00:00:00.000Z",
    barcode: "",
    images: { card: "/card.jpg", detail: "/detail.jpg" },
    catalogFacets: [{ slug: "productos-saludables", name: "Productos Saludables", kind: "collection" }],
  };
}
