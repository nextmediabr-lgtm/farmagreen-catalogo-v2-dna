import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { couponCodeV69, couponContextUrlV69 } from "../scripts/coupon-context-v69.mjs";

const origin = "https://catalog.example/";
const code = "FG-TEST-7";

test("visitas con código individual no inicializan tags externos ni almacenamiento de atribución", () => {
  const source = readFileSync(new URL("../public/measurement-loader-v69.js", import.meta.url), "utf8");
  const window = { location: { href: origin + "?cupon=" + code } };
  // No document/storage APIs are supplied: an external-measurement path must not execute.
  vm.runInNewContext(source, { window, URL });
  assert.equal((window as Record<string, unknown>).__fgMeasurementStartedV69, undefined);
});

test("cupón individual sobrevive a portada, filtros, producto y regreso sin perder la selección", () => {
  for (const href of ["/", "/catalogo?scope=todo&q=solar#productos-v69", "/p/test-product", "/marcas", "/buscar"]) {
    const target = new URL(couponContextUrlV69(href, code, origin), origin);
    assert.equal(target.searchParams.get("cupon"), code);
    const original = new URL(href, origin);
    for (const [key, value] of original.searchParams) assert.equal(target.searchParams.get(key), value);
    assert.equal(target.hash, original.hash);
  }
  assert.equal(new URL(couponContextUrlV69("/preview/p/test", code, origin, "/preview"), origin).searchParams.get("cupon"), code);
});

test("consulta conserva producto y código una sola vez, y reemplaza otro contexto", () => {
  const href = "https://wa.me/12025550199?text=" + encodeURIComponent("Consulta por producto sintético");
  const next = couponContextUrlV69(href, code, origin);
  assert.equal(new URL(next).searchParams.get("text"), "Consulta por producto sintético\nCupón: " + code);
  assert.equal(couponContextUrlV69(next, code, origin), next);
  const prefixed = href + encodeURIComponent("\nCupón: " + code + "7");
  assert.equal(new URL(couponContextUrlV69(prefixed, code, origin)).searchParams.get("text"), "Consulta por producto sintético\nCupón: " + code);
  const changed = new URL(couponContextUrlV69(next, "FG-OTHER-8", origin)).searchParams.get("text")!;
  assert.ok(changed.includes("FG-OTHER-8"));
  assert.ok(!changed.includes(code));
});

test("sin contexto no se hereda otro cupón ni se reescriben enlaces ajenos o privados", () => {
  const href = "/p/test";
  for (const invalid of ["", null, "bad&extra=1", "<script>", "FG-TEST\n7", "A".repeat(33)]) {
    assert.equal(couponCodeV69(invalid), "");
    assert.equal(couponContextUrlV69(href, invalid, origin), href);
  }
  for (const href of ["/api/catalog-v6-9", "/admin", "/image.png", "#productos-v69", "https://outside.example/", "javascript:alert(1)"]) {
    assert.equal(couponContextUrlV69(href, code, origin), href);
  }
});
