import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { brandUnionV69 } from "../scripts/catalog-brand-union-v69.mjs";
import { catalogV69, catalogPageV69, filterProductsBySearchV69, publicCatalogV69, sortProductsV69 } from "../src/render-v69.js";

const examples = [
  { publicId: "d", brand: { name: "Dermaglos", aliases: ["Dermaglós"] } },
  { publicId: "n", brand: { name: "Neutrogena" } },
  { publicId: "e", brand: { name: "Eucerin" } },
  { publicId: "l", brand: { name: "La Roche Posay", aliases: ["LRP"] } },
  { publicId: "v", brand: { name: "Vitamin Way" } },
];
test("+ une dos o más marcas completas, con tildes, espacios, alias y sin duplicados", () => {
  for (const [query, expected] of [
    ["Dermaglos+Neutrogena", ["d", "n"]],
    [" Dermaglós + NEUTROGENA + Eucerin ", ["d", "n", "e"]],
    ["Eucerin + Dermaglos + Eucerin", ["e", "d"]],
    ["La Roche Posay + Vitamin Way", ["l", "v"]],
    ["LRP + Vitamin Way", ["l", "v"]],
  ] as const) assert.deepEqual(Array.from(brandUnionV69(examples, query)!.productIds), expected);
  for (const query of ["Dermaglos Neutrogena", "hyaluron + filler", "Dermaglos + inexistente", "+Eucerin", "Eucerin+", "Eucerin++Dermaglos"])
    assert.equal(brandUnionV69(examples, query), null, query);
});

test("SSR y cliente suman las marcas reales y mantienen todos los criterios de orden", async () => {
  const catalog = await catalogV69();
  const dto = publicCatalogV69(catalog);
  const bundle = await readFile(new URL("../public/app-v6-9-compat.js", import.meta.url), "utf8");
  const bootAt = bundle.lastIndexOf("\nwireImageFallbacks();");
  assert.ok(bootAt > 0);
  const bootstrap = JSON.stringify({ ...dto, context: { scope: "todo", sort: "nombre" } });
  const context = vm.createContext({ URL, URLSearchParams, window: {},
    document: { querySelector: (selector: string) => selector === "#fg69-data" ? { textContent: bootstrap } : null } });
  vm.runInContext(bundle.slice(0, bootAt), context);
  const client = vm.runInContext("({S, currentResults})", context);
  for (const names of [["Dermaglos", "Neutrogena"], ["Dermaglos", "Neutrogena", "Eucerin"]]) {
    const q = names.join(" + ");
    const expected = dto.products.filter(p => names.includes(p.brand.name));
    assert.ok(names.every(name => expected.some(p => p.brand.name === name)));
    const expectedIds = expected.map(p => p.publicId).sort();
    const raw = catalog.products.filter(p => expectedIds.includes(p.publicId));
    assert.deepEqual(filterProductsBySearchV69(catalog.products, q).map(p => p.publicId).sort(), expectedIds);
    const html = catalogPageV69(catalog, new URLSearchParams({ scope: "todo", q }), "https://example.test");
    assert.ok(html.includes(`64 de ${expected.length}`) || html.includes(`${expected.length} de ${expected.length}`));
    assert.match(html, /"dataEndpoint":"\/api\/catalog-v6-9\?format=compact-v1"/);
    client.S.q = q;
    for (const sort of ["relevancia", "marca", "descuento", "precio-asc", "precio-desc", "nombre", "disponibilidad"] as const) {
      client.S.sort = sort;
      const results = Array.from(client.currentResults()) as typeof dto.products;
      assert.deepEqual(results.map(p => p.publicId).sort(), expectedIds, `${q}: ${sort}`);
      // An OR of brands gives equal textual relevance; the selected order is global.
      assert.deepEqual(sortProductsV69(raw, sort, q).map(p => p.publicId), sortProductsV69(raw, sort).map(p => p.publicId));
      if (sort.startsWith("precio-")) assert.ok(results.every((p, i) => !i ||
        (sort === "precio-asc" ? Math.round(results[i - 1].offerPrice) <= Math.round(p.offerPrice) : Math.round(results[i - 1].offerPrice) >= Math.round(p.offerPrice))));
    }
    // Same expression with a repeated brand never repeats its fichas.
    client.S.q = `${q} + ${names[0]}`;
    assert.deepEqual(Array.from(client.currentResults(), (p: any) => p.publicId).sort(), expectedIds);
  }
});
