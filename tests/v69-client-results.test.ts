import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/app-v6-9-compat.js", import.meta.url), "utf8");
const bootAt = source.lastIndexOf("\nwireImageFallbacks();");
assert.ok(bootAt > 0);

const products = [
  { publicId: "a", name: "Crema 10", brand: { name: "Eucerin" }, needs: ["manchas", "hidratacion"], catalogViews: [], availability: "available_reference", listPrice: 100, offerPrice: 80, discountPercent: 20, savingAmount: 20 },
  { publicId: "b", name: "Crema 2", brand: { name: "Cetaphil" }, needs: ["limpieza"], catalogViews: [], availability: "unavailable_reference", listPrice: 50, offerPrice: 50 },
  { publicId: "c", name: "Perfume", brand: { name: "Banderas" }, needs: ["fragancias"], catalogViews: [{ kind: "collection", slug: "perfumes-fragancias" }], availability: "available_reference", listPrice: 100, offerPrice: 100 },
  { publicId: "d", name: "Suplemento", brand: { name: "Vitamin Way" }, needs: ["nutricion"], catalogViews: [{ kind: "collection", slug: "productos-saludables" }], availability: "available_reference", listPrice: 40, offerPrice: 40 },
];

function client() {
  const bootstrap = JSON.stringify({ products, context: { scope: "todo", sort: "nombre" }, navigation: { showOutOfStockSort: true } });
  const context = vm.createContext({
    document: { querySelector: (selector: string) => selector === "#fg69-data" ? { textContent: bootstrap } : null },
    window: {},
    URL,
    URLSearchParams,
  });
  vm.runInContext(source.slice(0, bootAt), context);
  return vm.runInContext("({ S, currentResults })", context) as {
    S: { all: typeof products; q: string; brand: string; need: string; view: string; scope: string; sort: string; limit: number };
    currentResults: () => typeof products;
  };
}

const ids = (items: typeof products) => Array.from(items, (product) => product.publicId);

test("el resultado del cliente respeta cada filtro y el orden numérico después de reutilizar resultados", () => {
  const { S, currentResults } = client();
  assert.deepEqual(ids(currentResults()), ["b", "a", "c", "d"]);
  for (const [field, value, expected] of [
    ["brand", "Cetaphil", ["b"]],
    ["need", "manchas", ["a"]],
    ["view", "productos-saludables", ["d"]],
    ["view", "perfumes-fragancias", ["c"]],
    ["scope", "ofertas", ["a"]],
    ["sort", "sin-stock", ["b"]],
    ["sort", "precio-asc", ["d", "b", "a", "c"]],
    ["q", "perfume", ["c"]],
  ] as const) {
    const previous = S[field];
    S[field] = value;
    assert.deepEqual(ids(currentResults()), expected, `${field}=${value}`);
    S[field] = previous;
    assert.deepEqual(ids(currentResults()), ["b", "a", "c", "d"]);
  }
});

test("cargar otro bloque reutiliza resultados, pero un nuevo catálogo invalida precios y orden", () => {
  const { S, currentResults } = client();
  S.sort = "precio-asc";
  const first = currentResults();
  assert.deepEqual(ids(first), ["d", "b", "a", "c"]);
  S.limit = 128;
  assert.equal(currentResults(), first);
  S.all = S.all.map((product) => product.publicId === "a" ? { ...product, offerPrice: 30 } : product);
  assert.notEqual(currentResults(), first);
  assert.deepEqual(ids(currentResults()), ["a", "d", "b", "c"]);
});
