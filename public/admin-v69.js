const BOOT = (() => {
  try {
    return JSON.parse(document.querySelector("#admin-v69-data")?.textContent || "{}");
  } catch {
    return {};
  }
})();

const TOKEN_KEY = "farmagreen.admin.v69.token";
const S = {
  token: sessionStorage.getItem(TOKEN_KEY) || "",
  state: null,
  policy: null,
  tab: "status",
  busy: false,
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${S.token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function loadState() {
  setBusy(true);
  try {
    S.state = await api("/api/admin-v69/state");
    S.policy = structuredClone(S.state.policy);
    showApp();
    render();
  } catch (error) {
    showLogin(error.message);
  } finally {
    setBusy(false);
  }
}

function showLogin(error = "") {
  $("#adminLogin").hidden = false;
  $("#adminApp").hidden = true;
  $("#loginError").textContent = error;
}

function showApp() {
  $("#adminLogin").hidden = true;
  $("#adminApp").hidden = false;
}

function setBusy(value) {
  S.busy = value;
  document.body.classList.toggle("is-busy", value);
}

function render() {
  $("#adminContent").innerHTML = S.tab === "status"
    ? statusView()
    : S.tab === "navigation"
      ? navigationView()
      : S.tab === "ean"
        ? eanView()
        : operationsView();
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("on", button.dataset.tab === S.tab));
}

function statusView() {
  const state = S.state;
  const latestDeploy = state.memory.find((entry) => entry.type === "deploy");
  return `<div class="admin-heading"><div><p>Estado actual</p><h1>V6.9 en una mirada</h1></div><button data-action="reload">Actualizar</button></div>
    <div class="admin-cards">
      ${metric("Productos públicos", state.catalog.products)}
      ${metric("Disponibles", state.catalog.available)}
      ${metric("Para consultar", state.catalog.unavailable)}
      ${metric("Marcas técnicas", state.catalog.technicalBrands.length)}
      ${metric("Revisión config", state.admin.revision)}
      ${metric("Runtime", state.runtime.syncConfigured ? state.runtime.status : "local")}
    </div>
    <section class="admin-panel"><h2>Último deploy registrado</h2>${latestDeploy ? memoryCard(latestDeploy) : '<p class="admin-muted">Codex Agent Manager todavía no registró un recibo post-deploy.</p>'}</section>
    ${memoryView(state.memory.slice(0, 12))}`;
}

function navigationView() {
  const navigation = S.policy.navigation;
  const featuredSlugs = new Set(navigation.featuredBrands.map((entry) => entry.slug));
  const detected = S.state.catalog.technicalBrands.filter((entry) => !featuredSlugs.has(entry.slug));
  return `<div class="admin-heading"><div><p>Navegación pública</p><h1>Marcas y paraguas</h1></div><button class="primary" data-action="publish-navigation">Guardar y publicar</button></div>
    <p class="admin-intro">El scan puede detectar marcas, pero sólo las que habilites aquí aparecen en el menú y la home.</p>
    <section class="admin-panel"><div class="admin-panel-head"><div><h2>Marcas legacy</h2><p>${navigation.featuredBrands.filter((entry) => entry.enabled).length} habilitadas</p></div></div>
      <div class="admin-brand-list">${navigation.featuredBrands.map((entry, index) => brandRow(entry, index)).join("")}</div>
    </section>
    <section class="admin-panel"><h2>Productos Saludables</h2><label class="admin-toggle"><input type="checkbox" data-field="umbrella-enabled"${navigation.umbrella.enabled ? " checked" : ""}><span>Mostrar como marca paraguas</span></label><p class="admin-muted">Las marcas PS-only se presentan bajo el paraguas. Las legacy marcadas “conservar” mantienen su nombre.</p></section>
    <section class="admin-panel"><label>Orden inicial<select data-field="default-sort">${["relevancia", "marca", "disponibilidad", "descuento", "precio-asc", "precio-desc", "nombre"].map((value) => `<option value="${value}"${navigation.defaultSort === value ? " selected" : ""}>${value}</option>`).join("")}</select></label></section>
    <section class="admin-panel"><div class="admin-panel-head"><div><h2>Detectadas, no publicadas</h2><p>${detected.length} marcas técnicas</p></div></div><div class="admin-detected">${detected.slice(0, 120).map((entry) => `<div><span><strong>${esc(entry.name)}</strong><small>${entry.count} SKU</small></span><button data-action="add-brand" data-slug="${esc(entry.slug)}" data-name="${esc(entry.name)}">Agregar</button></div>`).join("")}</div></section>`;
}

function brandRow(entry, index) {
  const preserved = S.policy.navigation.umbrella.preserveBrandSlugs.includes(entry.slug);
  return `<div class="admin-brand-row" data-index="${index}">
    <label class="admin-toggle"><input type="checkbox" data-action="toggle-brand" data-index="${index}"${entry.enabled ? " checked" : ""}><span><strong>${esc(entry.name)}</strong><small>${esc(entry.slug)}</small></span></label>
    <label class="admin-preserve"><input type="checkbox" data-action="preserve-brand" data-slug="${esc(entry.slug)}"${preserved ? " checked" : ""}${entry.enabled ? "" : " disabled"}>Conservar en Saludables</label>
    <div class="admin-order"><button data-action="move-brand" data-index="${index}" data-direction="-1" aria-label="Subir">↑</button><button data-action="move-brand" data-index="${index}" data-direction="1" aria-label="Bajar">↓</button></div>
  </div>`;
}

function eanView() {
  const include = S.policy.eanRules.include;
  const exclude = S.policy.eanRules.exclude;
  return `<div class="admin-heading"><div><p>Visibilidad por código</p><h1>Reglas EAN</h1></div><button class="primary" data-action="publish-ean">Guardar y publicar</button></div>
    <p class="admin-intro">Un EAN no puede estar en ambas listas. Incluir no evita los controles de identidad, STOM, taxonomía ni imágenes.</p>
    <div class="admin-two-columns">
      ${eanPanel("include", "Lista de inclusión", include)}
      ${eanPanel("exclude", "Lista de exclusión", exclude)}
    </div>`;
}

function eanPanel(kind, title, rules) {
  const stateRules = S.state.eanStatus?.[kind] || [];
  const statusByEan = new Map(stateRules.map((entry) => [entry.ean, entry]));
  return `<section class="admin-panel"><h2>${title}</h2><label>EAN, uno por línea<textarea data-ean-input="${kind}" rows="4" placeholder="779...\n333..."></textarea></label><label>Nota<input data-ean-note="${kind}" maxlength="240" placeholder="Motivo breve"></label><button data-action="add-ean" data-kind="${kind}">Agregar</button><div class="admin-ean-list">${rules.map((rule, index) => {
    const state = statusByEan.get(rule.ean);
    return `<div><span><strong>${rule.ean}</strong><small>${state?.product ? esc(state.product.name) : "Pendiente / no encontrado"}</small><em class="${state?.status === "found" ? "ok" : "pending"}">${state?.status === "found" ? "Encontrado" : "Pendiente"}</em></span><button data-action="remove-ean" data-kind="${kind}" data-index="${index}" aria-label="Quitar">×</button></div>`;
  }).join("") || '<p class="admin-muted">Lista vacía.</p>'}</div></section>`;
}

function operationsView() {
  return `<div class="admin-heading"><div><p>Operación controlada</p><h1>Sincronización</h1></div><button data-action="reload">Actualizar estado</button></div>
    <div class="admin-two-columns"><section class="admin-panel"><h2>Precio y stock</h2><p>Ejecuta el refresh comercial Rosario/STOM.</p><button class="primary" data-action="run-refresh">Ejecutar refresh</button></section><section class="admin-panel"><h2>Catálogo completo</h2><p>Inicia el Job semanal de discovery. No despliega código.</p><button class="danger" data-action="run-discovery">Ejecutar scan</button></section></div>
    <section class="admin-panel admin-no-deploy"><h2>Deploy</h2><p>El panel no despliega. Codex Agent Manager realiza el deploy y registra aquí el resultado post-verificación.</p></section>
    ${memoryView(S.state.memory.filter((entry) => ["operation", "deploy"].includes(entry.type)).slice(0, 20))}`;
}

function memoryView(entries) {
  return `<section class="admin-panel"><div class="admin-panel-head"><div><h2>Memoria operativa</h2><p>${entries.length} eventos recientes</p></div>${S.state.snapshots.length ? `<button data-action="rollback" data-revision="${S.state.snapshots[0].revision}">Deshacer último cambio</button>` : ""}</div><div class="admin-memory">${entries.map(memoryCard).join("") || '<p class="admin-muted">Sin eventos registrados.</p>'}</div></section>`;
}

function memoryCard(entry) {
  const detail = Object.entries(entry.details || {}).map(([key, value]) => `<small>${esc(key)}: ${esc(value)}</small>`).join("");
  return `<article><span class="admin-memory-type">${esc(entry.type)}</span><div><strong>${esc(entry.summary)}</strong><p>${new Date(entry.at).toLocaleString("es-AR")} · ${esc(entry.actor)}</p>${detail}</div></article>`;
}

function metric(label, value) {
  return `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}

async function publish(summary) {
  setBusy(true);
  try {
    await api("/api/admin-v69/policy", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: S.state.admin.revision,
        policy: S.policy,
        summary,
      }),
    });
    await loadState();
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.tab) {
    S.tab = button.dataset.tab;
    render();
    return;
  }
  const action = button.dataset.action;
  if (action === "reload") return loadState();
  if (action === "publish-navigation") return publish("Actualiza navegación pública.");
  if (action === "publish-ean") return publish("Actualiza reglas EAN.");
  if (action === "toggle-brand") {
    const entry = S.policy.navigation.featuredBrands[Number(button.dataset.index)];
    entry.enabled = button.checked;
    if (!entry.enabled) S.policy.navigation.umbrella.preserveBrandSlugs = S.policy.navigation.umbrella.preserveBrandSlugs.filter((slug) => slug !== entry.slug);
    render();
  }
  if (action === "preserve-brand") {
    const slug = button.dataset.slug;
    const values = new Set(S.policy.navigation.umbrella.preserveBrandSlugs);
    button.checked ? values.add(slug) : values.delete(slug);
    S.policy.navigation.umbrella.preserveBrandSlugs = [...values];
    render();
  }
  if (action === "move-brand") {
    const index = Number(button.dataset.index);
    const target = index + Number(button.dataset.direction);
    if (target < 0 || target >= S.policy.navigation.featuredBrands.length) return;
    const [entry] = S.policy.navigation.featuredBrands.splice(index, 1);
    S.policy.navigation.featuredBrands.splice(target, 0, entry);
    render();
  }
  if (action === "add-brand") {
    S.policy.navigation.featuredBrands.push({ slug: button.dataset.slug, name: button.dataset.name, aliases: [], enabled: true });
    render();
  }
  if (action === "add-ean") {
    const kind = button.dataset.kind;
    const values = [...new Set(document.querySelector(`[data-ean-input="${kind}"]`).value.split(/[\s,;]+/).map((value) => value.replace(/\D/g, "")).filter(Boolean))];
    const note = document.querySelector(`[data-ean-note="${kind}"]`).value.trim();
    const existing = new Set(S.policy.eanRules[kind].map((entry) => entry.ean));
    const opposite = new Set(S.policy.eanRules[kind === "include" ? "exclude" : "include"].map((entry) => entry.ean));
    for (const ean of values) {
      if (opposite.has(ean)) return alert(`${ean} ya está en la otra lista.`);
      if (!existing.has(ean)) S.policy.eanRules[kind].push({ ean, note, createdAt: new Date().toISOString() });
    }
    render();
  }
  if (action === "remove-ean") {
    S.policy.eanRules[button.dataset.kind].splice(Number(button.dataset.index), 1);
    render();
  }
  if (action === "rollback") {
    if (!confirm(`¿Restaurar la revisión ${button.dataset.revision}?`)) return;
    try {
      await api("/api/admin-v69/rollback", { method: "POST", body: JSON.stringify({ targetRevision: Number(button.dataset.revision), expectedRevision: S.state.admin.revision }) });
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  }
  if (action === "run-refresh" || action === "run-discovery") {
    const label = action === "run-refresh" ? "refresh comercial" : "scan completo";
    if (!confirm(`¿Ejecutar ${label}?`)) return;
    setBusy(true);
    try {
      await api(action === "run-refresh" ? "/api/admin-v69/operations/refresh" : "/api/admin-v69/operations/discovery", { method: "POST", body: "{}" });
      await loadState();
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(false);
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches('[data-action="toggle-brand"]')) {
    const entry = S.policy.navigation.featuredBrands[Number(event.target.dataset.index)];
    entry.enabled = event.target.checked;
    if (!entry.enabled) {
      S.policy.navigation.umbrella.preserveBrandSlugs = S.policy.navigation.umbrella.preserveBrandSlugs.filter(
        (slug) => slug !== entry.slug,
      );
    }
    render();
    return;
  }
  if (event.target.matches('[data-action="preserve-brand"]')) {
    const slug = event.target.dataset.slug;
    const values = new Set(S.policy.navigation.umbrella.preserveBrandSlugs);
    event.target.checked ? values.add(slug) : values.delete(slug);
    S.policy.navigation.umbrella.preserveBrandSlugs = [...values];
    render();
    return;
  }
  if (event.target.matches('[data-field="umbrella-enabled"]')) S.policy.navigation.umbrella.enabled = event.target.checked;
  if (event.target.matches('[data-field="default-sort"]')) S.policy.navigation.defaultSort = event.target.value;
});

$("#logoutAdmin")?.addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  S.token = "";
  S.state = null;
  showLogin();
});

$("#localLogin")?.addEventListener("click", () => {
  S.token = $("#localAdminToken").value;
  sessionStorage.setItem(TOKEN_KEY, S.token);
  loadState();
});

window.handleFarmagreenAdminCredential = (response) => {
  S.token = response.credential;
  sessionStorage.setItem(TOKEN_KEY, S.token);
  loadState();
};

function initGoogle() {
  if (!BOOT.clientId || !window.google?.accounts?.id) return;
  window.google.accounts.id.initialize({ client_id: BOOT.clientId, callback: window.handleFarmagreenAdminCredential });
  window.google.accounts.id.renderButton($("#googleLogin"), { theme: "outline", size: "large", text: "signin_with" });
}

window.addEventListener("load", initGoogle);
if (S.token) loadState();
else showLogin();
