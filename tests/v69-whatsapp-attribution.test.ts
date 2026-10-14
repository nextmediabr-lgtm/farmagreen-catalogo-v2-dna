import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { normalizeMetaEventV69 } from "../src/server-v69.js";

const [loader, gaSource, metaSource, appSource, candidateText] = await Promise.all([
  readFile(new URL("../public/measurement-loader-v69.js", import.meta.url), "utf8"),
  readFile(new URL("../public/analytics-v69-compat.js", import.meta.url), "utf8"),
  readFile(new URL("../public/meta-pixel-v69-compat.js", import.meta.url), "utf8"),
  readFile(new URL("../public/app-v6-9-compat.js", import.meta.url), "utf8"),
  readFile(new URL("../meta-whatsapp-attribution-candidate.json", import.meta.url), "utf8"),
]);
const appBootAt = appSource.lastIndexOf("\nwireImageFallbacks();");
assert.ok(appBootAt > 0);
const candidate = JSON.parse(candidateText);
const time = 1_791_830_000_000;
const landing = candidate.instagramPreviewUrl + "&fbclid=QA_ONLY_AbC-123";

function page(href = landing, options: { store?: Map<string, string>; now?: number; cookie?: string; blocked?: boolean; product?: boolean } = {}) {
  const store = options.store || new Map<string, string>();
  const posted: any[] = [];
  const scripts: any[] = [];
  const clickHandlers: Function[] = [];
  const windowHandlers: Record<string, Function> = {};
  const product = { publicId: "qa-product", name: "Producto de prueba", brand: { name: "Prueba" }, primaryCategory: "catalogo", offerPrice: 100, listPrice: 120 };
  const now = options.now ?? time;
  const context = vm.createContext({
    URL, URLSearchParams,
    Date: class extends Date { static now() { return now; } },
    fetch: (_url: string, init: any) => { posted.push(JSON.parse(init.body)); return Promise.resolve({ ok: true }); },
    location: { href },
    window: {
      location: { href },
      crypto: { randomUUID: () => `qa-event-${posted.length + 1}` },
      sessionStorage: {
        getItem: (key: string) => { if (options.blocked) throw new Error("disabled"); return store.get(key) || null; },
        setItem: (key: string, value: string) => { if (options.blocked) throw new Error("disabled"); store.set(key, value); },
      },
      addEventListener: (name: string, fn: Function) => { windowHandlers[name] = fn; },
      removeEventListener: () => {},
    },
    document: {
      cookie: options.cookie || "", readyState: "loading", currentScript: { getAttribute: () => "" },
      querySelector: (selector: string) => selector === "#fg69-data" ? { textContent: JSON.stringify({ products: [product], page: options.product ? "product" : "catalog", product: options.product ? product : undefined }) } : null,
      addEventListener: (name: string, fn: Function) => { if (name === "click") clickHandlers.push(fn); },
      getElementsByTagName: () => [{ parentNode: { insertBefore: (script: any) => scripts.push(script) } }],
      createElement: () => ({}), head: { appendChild: (script: any) => scripts.push(script) },
    },
  });
  vm.runInContext(loader, context);
  const attribution = context.window.fgAttributionV69;
  const plain = (value: any) => JSON.parse(JSON.stringify(value));
  return {
    context, store, posted, scripts, attribution,
    gaConfig: () => plain(context.window.dataLayer.find((args: any) => args[0] === "config" && String(args[1]).startsWith("G-"))[2]),
    loadTags: () => { vm.runInContext(gaSource, context); vm.runInContext(metaSource, context); },
    wire: () => { vm.runInContext(appSource.slice(0, appBootAt), context); vm.runInContext("wireConversionTracking()", context); },
    click: (isWhatsApp = true) => {
      const link = { matches: () => Boolean(options.product) };
      for (const handler of clickHandlers) handler({ target: { closest: () => isWhatsApp ? link : null } });
    },
    gaEvents: () => context.window.dataLayer.filter((args: any) => args[0] === "event"),
    pixelEvents: () => context.window.fbq.queue.filter((args: any) => args[0] === "track"),
  };
}

test("el candidato identifica este anuncio, clasifica paid_social y no inventa fbclid", () => {
  const url = new URL(candidate.instagramPreviewUrl);
  assert.equal(url.searchParams.get("utm_id"), candidate.campaignId);
  assert.equal(url.searchParams.get("utm_content"), candidate.adId);
  assert.equal(url.searchParams.get("utm_medium"), "paid_social");
  assert.equal(url.searchParams.has("fbclid"), false);
  assert.match(candidate.urlParameters, /\{\{site_source_name\}\}/);
  assert.equal(candidate.salesTracking, false);
});

test("captura antes de cargar tags y conserva campaña y fbc en producto sin query y recarga", () => {
  const entry = page();
  assert.equal(entry.scripts.length, 0);
  const fbc = entry.attribution.metaFbc("");
  assert.equal(fbc, `fb.1.${time}.QA_ONLY_AbC-123`);
  for (const href of ["https://farmagreenrosario.web.app/p/qa-product", landing]) {
    const next = page(href, { store: entry.store, now: time + 5_000 });
    next.loadTags();
    assert.equal(next.attribution.metaFbc("fb.1.1787350000000.OLD_CLICK"), fbc);
    assert.equal(next.gaConfig().campaign_id, candidate.campaignId);
    assert.equal(next.gaConfig().campaign_content, candidate.adId);
    assert.equal(next.gaConfig().campaign_medium, "paid_social");
    assert.equal(new URL(next.gaConfig().page_location).searchParams.get("utm_source_platform"), "meta");
    assert.equal(next.posted[0].fbc, fbc);
    assert.equal(new URL(next.posted[0].event_source_url).pathname, new URL(href).pathname);
  }
});

test("un nuevo clic conserva sus caracteres y cambia el timestamp sin truncar el identificador", () => {
  const first = page();
  const clickId = "B_" + "X".repeat(250) + "-MiXeD";
  const next = page(candidate.instagramPreviewUrl + "&fbclid=" + clickId, { store: first.store, now: time + 1_000 });
  assert.equal(next.attribution.metaFbc(""), `fb.1.${time + 1_000}.${clickId}`);
  const normalized = normalizeMetaEventV69({ event_name: "Contact", event_time: Math.floor(time / 1000), event_id: "qa", event_source_url: "https://farmagreenrosario.web.app/", fbc: next.attribution.metaFbc("") }, "https://farmagreenrosario.web.app", Math.floor(time / 1000));
  assert.equal(normalized.fbc, next.attribution.metaFbc(""));
});

test("una visita orgánica no inventa fbc y una campaña nueva o Google Ads no hereda Meta", () => {
  assert.equal(page("https://farmagreenrosario.web.app/").attribution.metaFbc(""), "");
  for (const suffix of ["?gclid=QA_GOOGLE", "?gbraid=QA_GOOGLE", "?wbraid=QA_GOOGLE", "?utm_source=email&utm_medium=email&utm_campaign=new"]) {
    const first = page();
    const next = page("https://farmagreenrosario.web.app/" + suffix, { store: first.store, now: time + 1_000 });
    assert.equal(next.attribution.metaFbc(""), "");
    next.loadTags();
    assert.equal(next.gaConfig().campaign_id, undefined);
    if (!suffix.includes("utm_source")) assert.equal(next.gaConfig().campaign_source, undefined);
  }
});

test("la sesión expira tras 30 minutos y el almacenamiento bloqueado o corrupto no rompe el clic", () => {
  const first = page();
  const expired = page("https://farmagreenrosario.web.app/p/qa-product", { store: first.store, now: time + 30 * 60 * 1_000 });
  assert.equal(expired.attribution.metaFbc(""), "");
  assert.deepEqual(JSON.parse(JSON.stringify(expired.attribution.campaign())), {});
  for (const options of [{ blocked: true }, { store: new Map([["fg-v69-attribution", "broken-json"]]) }]) {
    const fallback = page(landing, options);
    assert.equal(fallback.attribution.metaFbc(""), `fb.1.${time}.QA_ONLY_AbC-123`);
    fallback.loadTags(); fallback.wire(); fallback.click();
    assert.equal(fallback.gaEvents().filter((args: any) => args[1] === "generate_lead").length, 1);
  }
});

test("respeta el timestamp de la cookie del mismo clic y rechaza identificadores inválidos", () => {
  const existing = page(landing, { cookie: `a=b; _fbc=fb.1.${time - 5_000}.QA_ONLY_AbC-123; c=d` });
  assert.equal(existing.attribution.metaFbc(""), `fb.1.${time - 5_000}.QA_ONLY_AbC-123`);
  for (const value of ["bad value", "<private>", "X".repeat(513)]) {
    assert.equal(page(candidate.instagramPreviewUrl + "&fbclid=" + encodeURIComponent(value)).attribution.metaFbc(""), "");
  }
});

for (const product of [false, true]) {
  test(`WhatsApp ${product ? "producto" : "general"}: un generate_lead y un Contact deduplicado, sin valor ni venta`, () => {
    const browser = page(landing, { product });
    browser.loadTags(); browser.wire(); browser.click();
    const gaEvents = browser.gaEvents();
    const intents = gaEvents.filter((args: any) => args[1] === "generate_lead");
    assert.equal(intents.length, 1);
    assert.equal(gaEvents.some((args: any) => ["contact", "purchase"].includes(args[1])), false);
    assert.equal(intents[0][2].lead_type, product ? "product" : "general");
    assert.equal(intents[0][2].lead_stage, "intent");
    assert.equal(intents[0][2].value, undefined);
    assert.equal(intents[0][2].currency, undefined);
    const contacts = browser.pixelEvents().filter((args: any) => args[1] === "Contact");
    const capi = browser.posted.filter((event: any) => event.event_name === "Contact");
    assert.equal(contacts.length, 1); assert.equal(capi.length, 1);
    assert.equal(contacts[0][3].eventID, capi[0].event_id);
    assert.equal(browser.pixelEvents().some((args: any) => ["Lead", "Purchase"].includes(args[1])), false);
    browser.click(false);
    assert.equal(browser.gaEvents().filter((args: any) => args[1] === "generate_lead").length, 1);
  });
}

test("un clic anterior a los tags se drena una sola vez en ambas colas", () => {
  const browser = page();
  browser.wire(); browser.click(); browser.loadTags();
  assert.equal(browser.gaEvents().filter((args: any) => args[1] === "generate_lead").length, 1);
  assert.equal(browser.posted.filter((event: any) => event.event_name === "Contact").length, 1);
  assert.equal(browser.context.window.__FG_GA_QUEUE.length, 0);
  assert.equal(browser.context.window.__FG_META_QUEUE.length, 0);
});
