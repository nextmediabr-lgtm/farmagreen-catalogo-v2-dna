import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { categoryKeysV69, categoryUnionV69, categoryQueryTitleV69 } from "../scripts/catalog-category-union-v69.mjs";
import { catalogV69, catalogPageV69, filterProductsBySearchV69, publicCatalogV69 } from "../src/render-v69.js";

const examples = [
  { publicId: "a", magentoCategories: [{ id: "101" }, { id: "102" }] },
  { publicId: "b", magentoCategories: [{ id: "102" }] },
  { publicId: "c", magentoCategories: [{ id: "103" }] },
  { publicId: "d", magentoCategories: [{ id: "104" }] },
  { publicId: "none" },
];
test("numeric category addition is generic, deduplicated and distinct from normal text and brand queries", () => {
  assert.deepEqual([...categoryUnionV69(examples, " 101 + 102 + 103 ")!.productIds], ["a", "b", "c"]);
  assert.deepEqual([...categoryUnionV69(examples, "103+102+101")!.productIds], ["a", "b", "c"]);
  assert.deepEqual([...categoryUnionV69(examples, "102+102+102")!.productIds], ["a", "b"]);
  assert.deepEqual([...categoryUnionV69(examples, "101+999+104")!.productIds], ["a", "d"]);
  assert.equal(categoryUnionV69(examples, "998+999+997")!.productIds.size, 0);
  for (const q of ["101", "101 102 103", "Eucerin+Vichy", "101+solares", "+101", "101++102", "101+", "0+101"])
    assert.equal(categoryUnionV69(examples, q), null, q);
});
test("combined headings retain common hierarchy, distinct labels and individual-category behavior", () => {
  const paths = { "101": ["Dermo", "Faciales", "Anti Age"], "102": ["Dermo", "Faciales", "Hidratación"], "103": ["Dermo", "Solares"], "104": ["Otra rama", "Hidratación"] };
  assert.equal(categoryQueryTitleV69("101", paths), "Dermo › Faciales › Anti Age");
  assert.equal(categoryQueryTitleV69("101+102+103", paths), "Dermo › Anti Age + Hidratación + Solares");
  assert.equal(categoryQueryTitleV69("101+102+104", paths), "Anti Age + Dermo › Faciales › Hidratación + Otra rama › Hidratación");
  assert.equal(categoryQueryTitleV69("101+999+103", paths), "Anti Age + Categoría 999 + Solares");
  assert.equal(categoryQueryTitleV69("999", paths), "");
});
test("every triple in eight real categories agrees in SSR/client union, title and ordering", async () => {
  const catalog = await catalogV69();
  const dto = publicCatalogV69(catalog);
  const keys = ["6551", "6338", "6614", "7160", "6779", "9677", "6851", "6347"];
  const source = await readFile(new URL("../public/app-v6-9-compat.js", import.meta.url), "utf8");
  const stop = source.lastIndexOf("\nwireImageFallbacks();");assert.ok(stop > 0);
  const boot = JSON.stringify({ ...dto, context: { scope: "todo", sort: "nombre" } });
  const context = vm.createContext({URL,URLSearchParams,window:{},document:{querySelector:(s:string)=>s==="#fg69-data"?{textContent:boot}:null}});
  vm.runInContext(source.slice(0,stop),context);
  const client = vm.runInContext("({S,currentResults,catalogCopy})",context);
  let triples=0;
  for(let a=0;a<keys.length;a++)for(let b=a+1;b<keys.length;b++)for(let c=b+1;c<keys.length;c++){
    const selected=[keys[a],keys[b],keys[c]],q=selected.join("+");
    const expected=dto.products.filter(p=>(p.magentoCategories||[]).some(cat=>selected.includes(String(cat.id)))).map(p=>p.publicId).sort();
    assert.ok(expected.length>0,q);
    assert.deepEqual(filterProductsBySearchV69(catalog.products,q).map(p=>p.publicId).sort(),expected,q);
    client.S.q=q;
    for(const sort of ["relevancia","precio-asc","precio-desc","nombre"]){
      client.S.sort=sort;
      const rows=Array.from(client.currentResults()) as typeof dto.products;
      assert.deepEqual(rows.map(p=>p.publicId).sort(),expected,`${q}:${sort}`);
      assert.equal(new Set(rows.map(p=>p.publicId)).size,rows.length);
      if(sort.startsWith("precio-"))assert.ok(rows.every((p,i)=>!i||(sort==="precio-asc"?Math.round(rows[i-1].offerPrice)<=Math.round(p.offerPrice):Math.round(rows[i-1].offerPrice)>=Math.round(p.offerPrice))));
    }
    const title=categoryQueryTitleV69(q,dto.magentoCategoryPaths);
    assert.equal(client.catalogCopy().title,title);
    const html=catalogPageV69(catalog,new URLSearchParams({scope:"todo",q}),"https://example.test");
    assert.match(html,/id="catalogTitleV69" class="v69-title-categories"/);
    assert.ok(html.includes(title),q);
    assert.ok(html.includes(`${Math.min(64,expected.length)} de ${expected.length}`),q);
    triples++;
  }
  assert.equal(triples,56);
  assert.equal(categoryKeysV69("101+102+103")!.length,3);
});
