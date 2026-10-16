import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { FRAGRANCE_AUDIENCE_OPTIONS_V69, fragranceAudienceV69 } from "../scripts/catalog-collections-v69.mjs";
import { fragranceAudienceFixtureV69 } from "./fixtures/v69-fragrance-audience.mjs";
import { catalogPageV69, productPageV69, publicCatalogV69 } from "../src/render-v69.js";
import type { CatalogV69 } from "../src/data-v69.js";

test("Fragancias clasifica sólo por categorías de origen y separa infantiles de adultos", () => {
  const catalog = fragranceAudienceFixtureV69() as CatalogV69;
  for (const option of FRAGRANCE_AUDIENCE_OPTIONS_V69) {
    assert.equal(fragranceAudienceV69(catalog.products.find(p => p.publicId === `${option.group}-000`)), option.group);
  }
  for (const id of ["sin-clasificar", "conflicto", "dermo"]) {
    assert.equal(fragranceAudienceV69(catalog.products.find(p => p.publicId === id)), "", id);
  }
  const perfume = catalog.products[0];
  assert.equal(fragranceAudienceV69({ ...perfume, name: "Perfume masculino", magentoCategories: [{ id: "7145", name: "Femeninas" }] }), "femeninas");
  assert.equal(fragranceAudienceV69({ ...perfume, magentoCategories: [{ id: "8948", name: "Unisex" }] }), "infantiles");
});

test("SSR y cliente filtran las cuatro ramas sin alterar metadatos, precios ni fichas", async () => {
  const catalog = fragranceAudienceFixtureV69() as CatalogV69;
  const before = JSON.stringify(catalog);
  const dto = publicCatalogV69(catalog);
  const bundle = await readFile(new URL("../public/app-v6-9-compat.js", import.meta.url), "utf8");
  const context = vm.createContext({ URL, URLSearchParams, window: {}, document: {
    querySelector: (selector: string) => selector === "#fg69-data" ? { textContent: JSON.stringify({ ...dto, context: { scope: "todo" } }) } : null,
  } });
  vm.runInContext(bundle.slice(0, bundle.lastIndexOf("\nwireImageFallbacks();")), context);
  const client = vm.runInContext("({S, applyParams, currentResults})", context);
  for (const selector of ["view=perfumes-fragancias", "need=fragancias"]) {
    for (const option of FRAGRANCE_AUDIENCE_OPTIONS_V69) {
      const query = new URLSearchParams(`scope=todo&${selector}&orden=${option.value}`);
      const expected = dto.products.filter(p => fragranceAudienceV69(p) === option.group).map(p => p.publicId);
      const html = catalogPageV69(catalog, query);
      assert.match(html, /src="\/app-v6-9-21\.js"/);
      const boot = JSON.parse(html.match(/id="fg69-data">([\s\S]*?)<\/script>/)![1]);
      assert.equal(boot.initialResultCount, expected.length);
      assert.equal(boot.context.sort, option.value);
      assert.match(html, new RegExp(`data-fragrance-audience value="${option.value}" selected`));
      client.applyParams(query);
      assert.deepEqual(Array.from(client.currentResults(), (p: { publicId: string }) => p.publicId).sort(), expected.sort());
    }
  }
  for (const suffix of ["", "&marca=Eucerin", "&need=hidratacion"]) {
    const query = new URLSearchParams(`scope=todo&orden=fragancias-femeninas${suffix}`);
    client.applyParams(query);
    assert.equal(client.S.sort, "relevancia");
    const html = catalogPageV69(catalog, query);
    assert.doesNotMatch(html, /<option data-fragrance-audience/);
  }
  const pdp = productPageV69(catalog.products[0], []);
  assert.doesNotMatch(pdp, /<dt>(?:Género|Público|Destinatario|Metadatos)<\/dt>/);
  assert.ok(dto.products.every(p => p.magentoCategories.length > 0));
  assert.equal(JSON.stringify(catalog), before);
});
