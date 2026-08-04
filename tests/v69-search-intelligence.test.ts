import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogV69,
  filterProductsBySearchV69,
  isSearchQueryReadyV69,
  normalizeQueryTermsV69,
} from "../src/render-v69.ts";

const catalogPromise = catalogV69();

async function ids(query: string) {
  const catalog = await catalogPromise;
  return filterProductsBySearchV69(catalog.products, query)
    .map((product) => product.publicId)
    .sort();
}

function sameResults(left: string, right: string) {
  return Promise.all([ids(left), ids(right)]).then(([leftIds, rightIds]) => assert.deepEqual(leftIds, rightIds));
}

test("01 - no activa una primera palabra de dos letras", () => {
  assert.equal(isSearchQueryReadyV69("cr"), false);
});

test("02 - activa una primera palabra de tres letras", async () => {
  assert.equal(isSearchQueryReadyV69("cre"), true);
  assert.ok((await ids("cre")).length > 0);
});

test("03 - descarta sistemáticamente conectores incompletos o mal escritos", async () => {
  assert.deepEqual(normalizeQueryTermsV69("crema par arruga"), ["crema", "arruga"]);
  assert.deepEqual(normalizeQueryTermsV69("crem pra arruga"), ["crem", "arruga"]);
  await sameResults("crema par arruga", "crema arruga");
  await sameResults("crem pra arruga", "crema arruga");
  await sameResults("crma pra arru", "crema arruga");
  await sameResults("crema pra arru", "crema arruga");
  await sameResults("crma pr arru", "crema arruga");
});

test("04 - ignora palabras vacías completas", async () => {
  await sameResults("crema para las arrugas", "crema arrugas");
});

test("05 - normaliza tildes", async () => {
  await sameResults("hidratación", "hidratacion");
});

test("06 - reconoce singular y plural por raíz semántica", async () => {
  await sameResults("arruga", "arrugas");
});

test("07 - tolera una sustitución ortográfica en Vichi", async () => {
  await sameResults("Vichi", "Vichy");
});

test("08 - tolera una sustitución ortográfica en Vichg", async () => {
  await sameResults("Vichg", "Vichy");
});

test("09 - tolera un error genérico no declarado en Eucerin", async () => {
  await sameResults("Eucerun", "Eucerin");
});

test("10 - tolera un error genérico no declarado en Caviahue", async () => {
  await sameResults("Caviahur", "Caviahue");
});

test("11 - relaciona cara con rostro", async () => {
  await sameResults("cara", "rostro");
});

test("12 - relaciona piel seca con piel reseca", async () => {
  await sameResults("piel seca", "piel reseca");
});

test("13 - relaciona crema con loción como forma cosmética", async () => {
  await sameResults("crema", "locion");
});

test("14 - relaciona serum con suero", async () => {
  await sameResults("serum", "suero");
});

test("15 - relaciona líneas de expresión con arrugas", async () => {
  await sameResults("lineas de expresion", "arrugas");
});

test("16 - reconoce la raíz hidra como hidratación", async () => {
  await sameResults("hidra", "hidratacion");
});

test("17 - reconoce la raíz faci como rostro", async () => {
  await sameResults("faci", "rostro");
});

test("18 - conserva términos útiles cortos declarados por dominio", async () => {
  assert.equal(isSearchQueryReadyV69("gel"), true);
  assert.ok((await ids("gel")).length > 0);
});

test("19 - permite localizar un producto por código de barras", async () => {
  const catalog = await catalogPromise;
  const sample = catalog.products.find((product) => /^\d{8,14}$/.test(product.barcode || ""));
  assert.ok(sample?.barcode);
  assert.ok((await ids(sample.barcode)).includes(sample.publicId));
});

test("20 - combina términos con semántica AND sin ampliar resultados", async () => {
  const broad = await ids("arrugas");
  const narrow = await ids("crema arrugas");
  assert.ok(narrow.length > 0);
  assert.ok(narrow.length <= broad.length);
  assert.ok(narrow.every((id) => broad.includes(id)));
});

test("21 - un término inexistente no contamina toda la consulta", async () => {
  assert.deepEqual(await ids("zxqv crema arrugas"), []);
});

test("22 - no confunde creatina con crema", async () => {
  const creatina = await ids("creatina");
  const crema = await ids("crema");
  assert.ok(creatina.length > 0);
  assert.notDeepEqual(creatina, crema);
});

test("23 - no transforma marca en cara", async () => {
  assert.notDeepEqual(await ids("marca"), await ids("cara"));
});

test("24 - el resultado global es determinista entre repeticiones", async () => {
  assert.deepEqual(await ids("crma pra arru"), await ids("crma pra arru"));
});
