import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { catalogPageV68, catalogV68 } from "../src/render-v68.js";

test("V6.8 usa marca y necesidad como caminos mutuamente excluyentes", async () => {
  const catalog = await catalogV68();
  const isdinCount = catalog.products.filter((product) => product.brand.name === "ISDIN").length;
  const html = catalogPageV68(
    catalog,
    new URLSearchParams({ marca: "ISDIN", need: "solares", scope: "todo" }),
    "http://127.0.0.1:8100",
  );

  assert.match(html, new RegExp(`id="brandSummaryV68">ISDIN · ${isdinCount}<\\/strong>`));
  assert.match(html, /id="needSummaryV68">Todas<\/strong>/);
  assert.match(html, /"context":\{"q":"","brand":"ISDIN","need":"Todas","scope":"todo"\}/);
  assert.doesNotMatch(html, /Solares de ISDIN/);

  const app = await readFile(new URL("../public/app-v6-8.js", import.meta.url), "utf8");
  assert.match(app, /if \(S\.brand !== "Todas" && S\.need !== "Todas"\) \{\s*S\.need = "Todas";\s*\}/);
  assert.match(app, /S\.brand = button\.dataset\.brand \|\| "Todas";\s*if \(S\.brand !== "Todas"\) S\.need = "Todas";/);
  assert.match(app, /S\.need = button\.dataset\.need \|\| "Todas";\s*if \(S\.need !== "Todas"\) S\.brand = "Todas";/);
  assert.doesNotMatch(app, /return \{ mode: "Selección"/);
});
