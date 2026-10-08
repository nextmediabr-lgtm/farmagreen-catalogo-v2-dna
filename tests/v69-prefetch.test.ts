import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/app-v6-9-compat.js", import.meta.url), "utf8");
const start = source.indexOf("function prepareCatalogAfterFirstPaint() {");
const end = source.indexOf("\nfunction syncInitialCatalogUi()", start);

function fixture(options: { ready?: string; hidden?: boolean; saveData?: boolean; type?: string; idle?: boolean; enabled?: boolean; loaded?: boolean } = {}) {
  assert.ok(start >= 0 && end > start, "El cliente transpileado debe contener la preparación.");
  const listeners = new Map<string, Array<() => void>>();
  const listen = (scope: string) => (event: string, callback: () => void) => {
    const key = scope + ":" + event;
    listeners.set(key, [...(listeners.get(key) || []), callback]);
  };
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const idle: Array<() => void> = [];
  let requests = 0;
  const context = {
    BOOT: { prefetchCatalog: options.enabled !== false, dataEndpoint: "/api/catalog-v6-9?format=compact-v1" },
    S: { all: options.loaded ? [{}] : [] },
    catalogLoadPromise: null as Promise<boolean> | null,
    navigator: { connection: { saveData: options.saveData || false, effectiveType: options.type || "4g" } },
    document: { readyState: options.ready || "complete", visibilityState: options.hidden ? "hidden" : "visible", body: { dataset: { v69CatalogLoaded: "false" } }, addEventListener: listen("document") },
    window: {
      addEventListener: listen("window"),
      setTimeout: (callback: () => void, delay: number) => { timers.push({ callback, delay }); },
      ...(options.idle === false ? {} : { requestIdleCallback: (callback: () => void, opts: { timeout: number }) => { assert.equal(opts.timeout, 1500); idle.push(callback); } }),
    },
    $: () => ({ addEventListener: listen("discovery") }),
    ensureCatalogReady: () => {
      if (!context.catalogLoadPromise) { requests++; context.catalogLoadPromise = Promise.resolve(true); }
      return context.catalogLoadPromise;
    },
  };
  vm.runInNewContext(source.slice(start, end) + "\nprepareCatalogAfterFirstPaint();", context);
  return { context, timers, idle, requests: () => requests,
    emit: (scope: string, event: string) => (listeners.get(scope + ":" + event) || []).forEach(callback => callback()),
    tick: () => { const timer = timers.shift(); assert.ok(timer); timer.callback(); },
    runIdle: () => { const callback = idle.shift(); assert.ok(callback); callback(); },
  };
}

test("precarga: espera load + 250 ms y tiempo ocioso sin adelantar la descarga", () => {
  const f = fixture({ ready: "loading" });
  assert.equal(f.timers.length, 0); assert.equal(f.requests(), 0);
  f.context.document.readyState = "complete"; f.emit("window", "load");
  assert.equal(f.timers[0].delay, 250); f.tick();
  assert.equal(f.requests(), 0); f.runIdle(); assert.equal(f.requests(), 1);
  f.emit("document", "visibilitychange"); assert.equal(f.idle.length, 0);
});

test("precarga: intención real comparte la petición y evita una descarga automática duplicada", () => {
  const f = fixture(); f.emit("discovery", "focusin"); f.emit("discovery", "pointerdown");
  assert.equal(f.requests(), 1); f.tick(); assert.equal(f.idle.length, 0);
});

test("precarga: ahorro de datos y 2G conservan carga únicamente por intención", () => {
  for (const options of [{ saveData: true }, { type: "2g" }, { type: "slow-2g" }]) {
    const f = fixture(options); assert.equal(f.timers.length, 0); assert.equal(f.idle.length, 0); assert.equal(f.requests(), 0);
    f.emit("discovery", "focusin"); assert.equal(f.requests(), 1);
  }
});

test("precarga: Safari sin requestIdleCallback usa el temporizador de respaldo", () => {
  const f = fixture({ idle: false }); f.tick(); assert.equal(f.requests(), 0);
  assert.equal(f.timers[0].delay, 0); f.tick(); assert.equal(f.requests(), 1);
});

test("precarga: pestaña oculta espera visibilidad y comprueba visibilidad también al ejecutar idle", () => {
  const f = fixture({ hidden: true }); f.tick(); assert.equal(f.idle.length, 0); assert.equal(f.requests(), 0);
  f.context.document.visibilityState = "visible"; f.emit("document", "visibilitychange");
  f.context.document.visibilityState = "hidden"; f.runIdle(); assert.equal(f.requests(), 0);
  f.context.document.visibilityState = "visible"; f.emit("document", "visibilitychange"); f.runIdle(); assert.equal(f.requests(), 1);
});

test("precarga: deshabilitada o catálogo ya cargado no programa trabajo", () => {
  for (const options of [{ enabled: false }, { loaded: true }]) {
    const f = fixture(options); assert.equal(f.timers.length, 0); assert.equal(f.requests(), 0);
    f.emit("discovery", "focusin"); assert.equal(f.requests(), 0);
  }
});

test("precarga: un fallo anterior no se reintenta por temporizador ni por visibilidad", () => {
  const f = fixture(); f.context.document.body.dataset.v69CatalogLoaded = "error";
  f.tick(); f.emit("document", "visibilitychange"); assert.equal(f.idle.length, 0); assert.equal(f.requests(), 0);
  f.emit("discovery", "focusin"); assert.equal(f.requests(), 1);
  const pending = fixture(); pending.tick(); pending.context.document.body.dataset.v69CatalogLoaded = "error";
  pending.runIdle(); assert.equal(pending.requests(), 0);
});
