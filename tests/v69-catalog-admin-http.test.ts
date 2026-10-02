import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { app } from "../src/server.js";
import { adminStateV69 } from "../src/catalog-admin-http-v69.js";
import { catalogCloudProjectV69 } from "../src/catalog-admin-scheduler-v69.js";
import { defaultCatalogAdminDocumentV69 } from "../src/catalog-admin-v69.js";
import type { CatalogV69, ProductV69 } from "../src/data-v69.js";

const ROOT = path.resolve(import.meta.dirname, "..");

test("el admin resuelve el proyecto desde la identidad Cloud Run si no hay variable de entorno", async () => {
  const auth = { getProjectId: async () => "project-e2a7bc6d-e741-4d4e-85d" } as Parameters<typeof catalogCloudProjectV69>[1];
  assert.equal(await catalogCloudProjectV69({ NODE_ENV: "production" }, auth), "project-e2a7bc6d-e741-4d4e-85d");
  assert.equal(await catalogCloudProjectV69({ NODE_ENV: "production", GOOGLE_CLOUD_PROJECT: "custom-project" }, auth), "custom-project");
});

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
      fetch(`${origin}/admin-v69-5.js`),
      fetch(`${origin}/admin-v69-2.css`),
      fetch(`${origin}/api/admin-v69/state`),
    ]);
    assert.equal(page.status, 200);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    assert.equal(unauthorized.status, 401);
    const html = await page.text();
    assert.match(html, /Administración V6\.9/);
    assert.match(html, /admin-v69-5\.js\?v=20260929-fragrancias-1/);
    assert.match(html, /data-tab="catalog"/);
    assert.doesNotMatch(html, /data-action="deploy"/);

    const first = await fetch(`${origin}/api/admin-v69/state`, { headers: auth });
    assert.equal(first.status, 200);
    const state = await first.json();
    assert.equal(state.admin.revision, 0);
    assert.equal(state.catalog.navigationBrands.length, 16);
    assert.equal(state.catalog.navigationBrands.at(-1).name, "Productos Saludables");
    assert.doesNotMatch(JSON.stringify(state), /"sku"|"source"|gpsfarma/i);
    const publicHtmlBefore = await fetch(`${origin}/`).then((response) => response.text());
    assert.match(publicHtmlBefore, /data-brand="Aveno"/);
    const publicBefore = await fetch(`${origin}/api/catalog-v6-9`).then((response) => response.json());
    const productToExclude = publicBefore.products.find((product: { barcode?: string }) => /^\d{8,14}$/.test(product.barcode || ""));
    const eanToExclude = productToExclude?.barcode;
    assert.ok(eanToExclude);
    const productList = await fetch(`${origin}/api/admin-v69/products?q=${eanToExclude}`, { headers: auth }).then((response) => response.json());
    assert.equal(productList.total, 1);
    assert.equal(productList.items[0].visibility, "public");
    assert.ok(state.catalog.uses.find((entry: { slug: string }) => entry.slug === "manchas"));
    const antiPigmentByUse = await fetch(`${origin}/api/admin-v69/products?q=fcbd59a2511f&use=manchas`, { headers: auth }).then((response) => response.json());
    assert.equal(antiPigmentByUse.total, 1);
    assert.deepEqual(antiPigmentByUse.items[0].needs, ["manchas", "hidratacion"]);
    assert.equal(antiPigmentByUse.items[0].useEvidence, "Título, línea y beneficios del producto");
    const wrongUse = await fetch(`${origin}/api/admin-v69/products?q=fcbd59a2511f&use=limpieza`, { headers: auth }).then((response) => response.json());
    assert.equal(wrongUse.total, 0);

    const initialJobs = await fetch(`${origin}/api/admin-v69/schedulers`, { headers: auth }).then((response) => response.json());
    assert.equal(initialJobs.jobs.find((entry: { kind: string }) => entry.kind === "daily").state, "ENABLED");
    const paused = await fetch(`${origin}/api/admin-v69/schedulers/daily/pause`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expectedState: "ENABLED" }),
    });
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).job.state, "PAUSED");
    const stale = await fetch(`${origin}/api/admin-v69/schedulers/daily/pause`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expectedState: "ENABLED" }),
    });
    assert.equal(stale.status, 422);

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
    const preview = await fetch(`${origin}/api/admin-v69/policy/preview`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 0, policy }),
    });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).hidden.count, 1);
    assert.equal((await fetch(`${origin}/api/admin-v69/state`, { headers: auth }).then((response) => response.json())).admin.revision, 0);
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
    assert.doesNotMatch(await fetch(`${origin}/`).then((response) => response.text()), /data-brand="Aveno"/);
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
    assert.equal(finalState.memory.some((entry: { type: string }) => entry.type === "scheduler"), true);
    const hiddenProducts = await fetch(`${origin}/api/admin-v69/products?visibility=hidden&q=${eanToExclude}`, { headers: auth }).then((response) => response.json());
    assert.equal(hiddenProducts.items[0].hiddenReason, "EAN excluido");
    const requestedEan = "4006381333931";
    assert.equal(publicBefore.products.some((product: { barcode: string }) => product.barcode === requestedEan), false);
    const requestedPolicy = structuredClone(finalState.policy);
    requestedPolicy.eanRules.requests.push({ ean: requestedEan, note: "Revisión antes de incluir", createdAt: "2026-09-28T00:00:00.000Z" });
    const requestSave = await fetch(`${origin}/api/admin-v69/policy`, {
      method: "PUT", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, policy: requestedPolicy }),
    });
    assert.equal(requestSave.status, 200);
    const prematureApproval = await fetch(`${origin}/api/admin-v69/ean-requests/approve`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ean: requestedEan, expectedRevision: 2 }),
    });
    assert.equal(prematureApproval.status, 422);
    const requestState = await fetch(`${origin}/api/admin-v69/state`, { headers: auth }).then((response) => response.json());
    assert.equal(requestState.policy.eanRules.requests[0].ean, requestedEan);
    assert.equal(requestState.policy.eanRules.include.length, 0);
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
  products[0].discountPercent = 20;
  products[0].offerPrice = 80;
  products[1].discountPercent = 30;
  products[1].offerPrice = 70;
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
  assert.deepEqual(state.catalog.promotionBrands, [
    { slug: "productos-saludables", name: "Productos Saludables", count: 2 },
  ]);
  assert.deepEqual(state.catalog.promotionTechnicalBrands.map((entry) => entry.name), ["102 años", "Goodskin"]);
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
