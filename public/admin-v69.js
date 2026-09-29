const BOOT = (() => {
  try {
    return JSON.parse(document.querySelector("#admin-v69-data")?.textContent || "{}");
  } catch {
    return {};
  }
})();

const TOKEN_KEY = "farmagreen.admin.v69.token";
const USE_LABELS = {
  manchas: "Manchas", acne: "Acné", "piel-sensible": "Piel sensible",
  hidratacion: "Hidratación", limpieza: "Limpieza", solares: "Solares",
  capilar: "Cabello", antiedad: "Antiedad", reparacion: "Reparación",
  nutricion: "Nutrición", "cuidado-diario": "Cuidado diario",
};
const S = {
  token: sessionStorage.getItem(TOKEN_KEY) || "",
  state: null,
  policy: null,
  tab: "status",
  busy: false,
  schedulers: [],
  schedulerError: "",
  products: null,
  productsRequest: 0,
  catalogQuery: { q: "", visibility: "all", brand: "", use: "", page: 1 },
  preview: null,
  error: "",
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);
const brandKey = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "");

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
    S.preview = null;
    S.error = "";
    try {
      S.schedulers = (await api("/api/admin-v69/schedulers")).jobs;
      S.schedulerError = "";
    } catch (error) {
      S.schedulers = [];
      S.schedulerError = error.message;
    }
    showApp();
    render();
    if (S.tab === "catalog") await loadProducts();
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
  const content = S.tab === "status"
    ? statusView()
    : S.tab === "navigation"
      ? navigationView()
      : S.tab === "ean"
        ? eanView()
        : S.tab === "catalog"
          ? catalogView()
          : operationsView();
  $("#adminContent").innerHTML = `${S.error ? `<p class="admin-error" role="alert">${esc(S.error)}</p>` : ""}${previewView()}${content}`;
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("on", button.dataset.tab === S.tab));
}

function dirty() {
  return Boolean(S.policy && S.state && JSON.stringify(S.policy) !== JSON.stringify(S.state.policy));
}

function previewView() {
  if (!S.preview || S.preview.tab !== S.tab) return "";
  const data = S.preview.data;
  return `<section class="admin-panel admin-preview"><h2>Vista previa antes de publicar</h2><p>Productos públicos: <strong>${data.before.products} → ${data.after.products}</strong>. Con promoción: <strong>${data.before.promotions} → ${data.after.promotions}</strong>.</p><p>Ocultados: ${data.hidden.count}${data.hidden.examples.length ? ` (${data.hidden.examples.map((entry) => esc(entry.name)).join(", ")})` : ""}. Recuperados: ${data.restored.count}${data.restored.examples.length ? ` (${data.restored.examples.map((entry) => esc(entry.name)).join(", ")})` : ""}.</p><p>Solicitudes EAN pendientes: ${data.pendingEanRequests}. ${esc(data.note)}</p><button class="primary" data-action="confirm-publish">Confirmar publicación</button> <button data-action="cancel-preview">Seguir editando</button></section>`;
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
      ${metric("Snapshot", state.catalog.rawProducts)}
      ${metric("Solicitudes EAN", state.eanStatus.requests.length)}
    </div>
    <section class="admin-panel"><h2>Actualización de datos</h2><p>Precios y stock: ${esc(state.catalog.commerceSyncedAt || "sin fecha")}. Scan completo: ${esc(state.catalog.discoverySyncedAt || "sin fecha")}.</p><p class="admin-muted">Snapshot = fichas cargadas antes de aplicar la política pública. La vista Catálogo muestra qué queda oculto y por qué.</p></section>
    <section class="admin-panel"><h2>Último deploy registrado</h2>${latestDeploy ? memoryCard(latestDeploy) : '<p class="admin-muted">Codex Agent Manager todavía no registró un recibo post-deploy.</p>'}</section>
    ${memoryView(state.memory.slice(0, 12))}`;
}

function navigationView() {
  const navigation = S.policy.navigation;
  const promotionBrands = S.state.catalog.promotionTechnicalBrands || [];
  const selectedPromotions = new Set(navigation.promotionDisabledTechnicalBrandSlugs === null
    ? promotionBrands.filter((entry) => entry.selected).map((entry) => entry.slug)
    : promotionBrands.filter((entry) => !navigation.promotionDisabledTechnicalBrandSlugs.includes(entry.slug)).map((entry) => entry.slug));
  const featuredIdentities = new Set(navigation.featuredBrands.flatMap((entry) =>
    [entry.slug, entry.name, ...(entry.aliases || [])].map(brandKey),
  ));
  const excludedSlugs = new Set(navigation.excludedBrandSlugs || []);
  const candidates = S.state.catalog.technicalBrands.filter((entry) =>
    ![entry.slug, entry.name].map(brandKey).some((identity) => featuredIdentities.has(identity)),
  );
  const detected = candidates.filter((entry) => !excludedSlugs.has(entry.slug));
  const disabled = candidates.filter((entry) => excludedSlugs.has(entry.slug));
  return `<div class="admin-heading"><div><p>Navegación pública</p><h1>Marcas y paraguas</h1></div><button class="primary" data-action="publish-navigation">Guardar y publicar</button></div>
    <p class="admin-intro">El scan puede detectar marcas, pero sólo las que habilites aquí aparecen en el menú y la home.</p>
    <section class="admin-panel"><div class="admin-panel-head"><div><h2>Marcas legacy</h2><p>${navigation.featuredBrands.filter((entry) => entry.enabled).length} habilitadas</p></div></div>
      <div class="admin-brand-list">${navigation.featuredBrands.map((entry, index) => brandRow(entry, index)).join("")}</div>
    </section>
    <section class="admin-panel"><h2>Productos Saludables</h2><label class="admin-toggle"><input type="checkbox" data-field="umbrella-enabled"${navigation.umbrella.enabled ? " checked" : ""}><span>Mostrar como marca paraguas</span></label><p class="admin-muted">Las marcas PS-only se presentan bajo el paraguas. Las legacy marcadas “conservar” mantienen su nombre.</p></section>
    <section class="admin-panel"><div class="admin-panel-head"><div><h2>Promociones por marca técnica</h2><p>${promotionBrands.filter((entry) => selectedPromotions.has(entry.slug)).length} de ${promotionBrands.length} marcas con señal</p></div><div><button data-action="promotion-all">Seleccionar todas</button> <button data-action="promotion-none">Deseleccionar todas</button></div></div><p class="admin-muted">Productos Saludables sigue siendo una sola marca pública; aquí sus marcas internas se controlan por separado. Desmarcar conserva el producto y el precio regular, pero quita badge, 2×1, descuento y ahorro. Las marcas nuevas con promoción validada se activan por defecto, salvo exclusión explícita.</p><div class="admin-brand-list">${promotionBrands.map((entry) => `<label class="admin-brand-row admin-toggle"><input type="checkbox" data-field="promotion-brand" data-slug="${esc(entry.slug)}"${selectedPromotions.has(entry.slug) ? " checked" : ""}><span><strong>${esc(entry.name)}</strong><small>${esc(entry.displayName)} · ${entry.count} productos con señal promocional</small></span></label>`).join("") || '<p class="admin-muted">No hay promociones detectadas en este snapshot.</p>'}</div></section>
    <section class="admin-panel"><label>Orden inicial<select data-field="default-sort">${["relevancia", "marca", "disponibilidad", "descuento", "precio-asc", "precio-desc", "nombre"].map((value) => `<option value="${value}"${navigation.defaultSort === value ? " selected" : ""}>${value}</option>`).join("")}</select></label><label class="admin-toggle"><input type="checkbox" data-field="show-out-of-stock-sort"${navigation.showOutOfStockSort ? " checked" : ""}><span>Mostrar “Sin stock” en Ordenar</span></label><p class="admin-muted">Activado temporalmente para revisar posibles discontinuados. No excluye productos automáticamente.</p></section>
    <section class="admin-panel"><div class="admin-panel-head"><div><h2>Detectadas, no publicadas</h2><p>${detected.length} marcas técnicas</p></div></div><p class="admin-muted">Deshabilitar excluye todos los productos de esa marca del catálogo público. El cambio se aplica al usar Guardar y publicar.</p><div class="admin-detected">${detected.slice(0, 120).map((entry) => `<div><span><strong>${esc(entry.name)}</strong><small>${entry.count} SKU</small></span><button data-action="add-brand" data-slug="${esc(entry.slug)}" data-name="${esc(entry.name)}">Agregar</button><button data-action="disable-brand" data-slug="${esc(entry.slug)}" data-name="${esc(entry.name)}">Deshabilitar</button></div>`).join("") || '<p class="admin-muted">No hay marcas técnicas pendientes.</p>'}</div></section>
    ${disabled.length ? `<section class="admin-panel"><div class="admin-panel-head"><div><h2>Marcas deshabilitadas</h2><p>${disabled.length} exclusiones</p></div></div><p class="admin-muted">Sus productos están fuera de catálogo, búsqueda, necesidades, PDP y sitemap.</p><div class="admin-detected">${disabled.map((entry) => `<div><span><strong>${esc(entry.name)}</strong><small>${entry.count} SKU excluidos</small></span><button data-action="enable-brand" data-slug="${esc(entry.slug)}">Rehabilitar</button></div>`).join("")}</div></section>` : ""}`;
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
  const requests = S.policy.eanRules.requests || [];
  return `<div class="admin-heading"><div><p>Visibilidad por código</p><h1>Reglas EAN</h1></div><button class="primary" data-action="publish-ean">Guardar y publicar</button></div>
    <p class="admin-intro">Excluir tiene efecto al publicar. Solicitar inclusión no importa un producto: primero debe aparecer evidencia del scan, después se aprueba y el siguiente scan vuelve a validar identidad, STOM, taxonomía e imágenes.</p>
    <div class="admin-two-columns">
      ${eanPanel("requests", "Solicitudes de inclusión", requests)}
      ${eanPanel("exclude", "Lista de exclusión", exclude)}
    </div><section class="admin-panel"><h2>Inclusiones aprobadas</h2><p class="admin-muted">Reglas existentes, activas para el próximo scan. Se pueden retirar con Guardar y publicar.</p><div class="admin-ean-list">${include.map((rule, index) => `<div><span><strong>${esc(rule.ean)}</strong><small>${esc(rule.note)}</small></span><button data-action="remove-ean" data-kind="include" data-index="${index}" aria-label="Retirar inclusión">×</button></div>`).join("") || '<p class="admin-muted">Lista vacía.</p>'}</div></section>`;
}

function eanPanel(kind, title, rules) {
  const stateRules = S.state.eanStatus?.[kind] || [];
  const statusByEan = new Map(stateRules.map((entry) => [entry.ean, entry]));
  return `<section class="admin-panel"><h2>${title}</h2><label>EAN, uno por línea<textarea data-ean-input="${kind}" rows="4" placeholder="779...\n333..."></textarea></label><label>Nota<input data-ean-note="${kind}" maxlength="240" placeholder="Motivo breve"></label><button data-action="add-ean" data-kind="${kind}">Agregar</button><div class="admin-ean-list">${rules.map((rule, index) => {
    const state = statusByEan.get(rule.ean);
    const reviewable = kind === "requests" && state?.status === "reviewable";
    return `<div><span><strong>${esc(rule.ean)}</strong><small>${state?.product ? esc(state.product.name) : state?.candidate ? `${esc(state.candidate.name)} · ${esc(state.candidate.brand)}` : "Pendiente / no encontrado"}</small><em class="${state?.status === "found" || reviewable ? "ok" : "pending"}">${reviewable ? "Evidencia para revisar" : state?.status === "found" ? "Encontrado" : "Pendiente"}</em></span>${reviewable ? `<button data-action="approve-ean" data-ean="${esc(rule.ean)}">Aprobar</button>` : ""}<button data-action="remove-ean" data-kind="${kind}" data-index="${index}" aria-label="Quitar">×</button></div>`;
  }).join("") || '<p class="admin-muted">Lista vacía.</p>'}</div></section>`;
}

function catalogView() {
  const result = S.products;
  const query = S.catalogQuery;
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const uses = S.state.catalog.uses || [];
  return `<div class="admin-heading"><div><p>Explorador de snapshot</p><h1>Catálogo y usos</h1></div><button data-action="reload-products">Actualizar</button></div><p class="admin-intro">Cada ficha muestra Uso A (principal) y, si corresponde, Uso B (secundario). Buscá por nombre, EAN, ID o SKU y filtrá por uso para revisar la clasificación. Aquí no se editan precios ni stock.</p>
    <section class="admin-panel"><div class="admin-filters"><label>Buscar<input data-catalog-query value="${esc(query.q)}" placeholder="Nombre o EAN"></label><label>Visibilidad<select data-catalog-visibility><option value="all"${query.visibility === "all" ? " selected" : ""}>Todas</option><option value="public"${query.visibility === "public" ? " selected" : ""}>Públicas</option><option value="hidden"${query.visibility === "hidden" ? " selected" : ""}>Ocultas</option></select></label><label>Marca técnica<select data-catalog-brand><option value="">Todas</option>${S.state.catalog.technicalBrands.map((entry) => `<option value="${esc(entry.slug)}"${query.brand === entry.slug ? " selected" : ""}>${esc(entry.name)}</option>`).join("")}</select></label><label>Uso A o B<select data-catalog-use><option value="">Todos</option>${uses.map((entry) => `<option value="${esc(entry.slug)}"${query.use === entry.slug ? " selected" : ""}>${esc(USE_LABELS[entry.slug] || entry.slug)} (${entry.publicCount} públicos)</option>`).join("")}</select></label><button data-action="search-products">Buscar</button></div></section>
    <section class="admin-panel"><div class="admin-panel-head"><h2>${result ? `${result.total} fichas · página ${result.page} de ${pages}` : "Cargando fichas"}</h2><div><button data-action="previous-products"${!result || result.page <= 1 ? " disabled" : ""}>Anterior</button> <button data-action="next-products"${!result || result.page >= pages ? " disabled" : ""}>Siguiente</button></div></div><div class="admin-product-list">${result?.items.map((entry) => `<article><div><strong>${esc(entry.name)}</strong><p>${esc(entry.technicalBrand)} → ${esc(entry.displayedBrand || "Oculto")} · EAN ${esc(entry.ean || "sin EAN")}</p><small>Uso A: ${esc(USE_LABELS[entry.needs[0]] || entry.needs[0] || "Sin clasificar")} · Uso B: ${esc(USE_LABELS[entry.needs[1]] || entry.needs[1] || "—")} · ${esc(entry.useEvidence)}<br>${esc(entry.availability)} · ${entry.promotion ? esc(entry.promotion) : "Sin promoción"} · Taxonomía ${entry.taxonomyAttached ? "sí" : "no"} · Imágenes ${entry.hasCardImage && entry.hasDetailImage ? "sí" : "incompletas"} · Vistas de origen: ${esc(entry.sourceMemberships.join(", ") || "sin membresía")}</small></div><span class="admin-visibility ${entry.visibility}">${entry.visibility === "public" ? "Pública" : esc(entry.hiddenReason)}</span></article>`).join("") || '<p class="admin-muted">No hay fichas para este filtro.</p>'}</div></section>`;
}

async function loadProducts() {
  const request = ++S.productsRequest;
  const params = new URLSearchParams(S.catalogQuery);
  S.products = null;
  if (S.tab === "catalog") render();
  try {
    const products = await api(`/api/admin-v69/products?${params}`);
    if (request !== S.productsRequest) return;
    S.products = products;
    S.error = "";
  } catch (error) {
    if (request !== S.productsRequest) return;
    S.products = null;
    S.error = error.message;
  }
  if (S.tab === "catalog") render();
}

function operationsView() {
  const schedulers = S.schedulers.map((job) => `<article class="admin-scheduler"><div><strong>${job.kind === "daily" ? "Diario 07:00 y 14:00 ART" : "Semanal lunes 04:00 ART"}</strong><p>${esc(job.state)} · ${esc(job.name)}</p><small>Último intento: ${esc(job.lastAttemptTime || "sin registro")}${job.lastAttemptCode === null ? "" : ` · código ${esc(job.lastAttemptCode)}`}. Próximo: ${esc(job.nextScheduleTime || "no informado")}.</small></div>${job.state === "ENABLED" || job.state === "PAUSED" ? `<button data-action="scheduler-${job.state === "ENABLED" ? "pause" : "resume"}" data-kind="${job.kind}" data-state="${job.state}">${job.state === "ENABLED" ? "Pausar" : "Reanudar"}</button>` : ""}</article>`).join("");
  return `<div class="admin-heading"><div><p>Operación controlada</p><h1>Sincronización</h1></div><button data-action="reload">Actualizar estado</button></div>
    <section class="admin-panel"><h2>Crons ${BOOT.localMode ? "· simulación local" : "· Cloud Scheduler"}</h2><p class="admin-muted">Cada cambio exige confirmación y se relee el estado. Pausar o reanudar no ejecuta un scan.</p>${schedulers || `<p class="admin-error">${esc(S.schedulerError || "Sin datos del Scheduler")}</p>`}</section>
    <section class="admin-panel"><h2>Resultado del runtime</h2><p>Última sincronización confirmada: ${esc(S.state.runtime.lastSuccessAt || "sin registro")}. Último scan confirmado: ${esc(S.state.runtime.lastDiscoveryAt || "sin registro")}. Última falla: ${esc(S.state.runtime.lastFailureAt || "sin registro")}.</p><p class="admin-muted">Un Job iniciado no equivale a un catálogo publicado. Compará estas fechas y el estado del snapshot antes de darlo por terminado.</p></section>
    <div class="admin-two-columns"><section class="admin-panel"><h2>Precio y stock</h2><p>Ejecuta el refresh comercial Rosario/STOM.</p><button class="primary" data-action="run-refresh"${BOOT.localMode ? " disabled" : ""}>Ejecutar refresh</button></section><section class="admin-panel"><h2>Catálogo completo</h2><p>Inicia el Job semanal de discovery. No despliega código.</p><button class="danger" data-action="run-discovery"${BOOT.localMode ? " disabled" : ""}>Ejecutar scan</button></section></div>${BOOT.localMode ? '<p class="admin-muted">Las ejecuciones manuales reales quedan deshabilitadas en esta vista previa local.</p>' : ""}
    <section class="admin-panel admin-no-deploy"><h2>Deploy</h2><p>El panel no despliega. Codex Agent Manager realiza el deploy y registra aquí el resultado post-verificación.</p></section>
    ${memoryView(S.state.memory.filter((entry) => ["operation", "scheduler", "deploy"].includes(entry.type)).slice(0, 20))}`;
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
    const data = await api("/api/admin-v69/policy/preview", {
      method: "POST",
      body: JSON.stringify({ expectedRevision: S.state.admin.revision, policy: S.policy }),
    });
    S.preview = { data, summary, tab: S.tab, fingerprint: JSON.stringify(S.policy) };
    S.error = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    S.error = error.message;
    render();
  } finally {
    setBusy(false);
  }
}

async function confirmPublish() {
  if (!S.preview || S.preview.fingerprint !== JSON.stringify(S.policy)) {
    S.error = "El borrador cambió. Generá otra vista previa antes de publicar.";
    S.preview = null;
    render();
    return;
  }
  setBusy(true);
  try {
    await api("/api/admin-v69/policy", {
      method: "PUT",
      body: JSON.stringify({ expectedRevision: S.state.admin.revision, policy: S.policy, summary: S.preview.summary }),
    });
    await loadState();
  } catch (error) {
    S.error = error.message;
    render();
  } finally {
    setBusy(false);
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.tab) {
    if (dirty() && S.tab !== button.dataset.tab && !confirm("Hay cambios sin publicar. ¿Cambiar de sección? El borrador seguirá disponible.")) return;
    S.tab = button.dataset.tab;
    render();
    if (S.tab === "catalog") await loadProducts();
    return;
  }
  const action = button.dataset.action;
  if (action === "reload") {
    if (dirty() && !confirm("Se perderán los cambios sin publicar. ¿Actualizar?")) return;
    return loadState();
  }
  if (action === "confirm-publish") return confirmPublish();
  if (action === "cancel-preview") { S.preview = null; render(); return; }
  if (action === "publish-navigation") return publish("Actualiza navegación y promociones públicas.");
  if (action === "promotion-all") {
    S.policy.navigation.promotionDisabledTechnicalBrandSlugs = [];
    render();
    return;
  }
  if (action === "promotion-none") {
    S.policy.navigation.promotionDisabledTechnicalBrandSlugs = S.state.catalog.promotionTechnicalBrands.map((entry) => entry.slug);
    render();
    return;
  }
  if (action === "publish-ean") return publish("Actualiza reglas EAN.");
  if (action === "reload-products") return loadProducts();
  if (action === "search-products") {
    S.catalogQuery = {
      q: $("[data-catalog-query]").value.trim(),
      visibility: $("[data-catalog-visibility]").value,
      brand: $("[data-catalog-brand]").value,
      use: $("[data-catalog-use]").value,
      page: 1,
    };
    return loadProducts();
  }
  if (action === "previous-products" || action === "next-products") {
    S.catalogQuery.page += action === "next-products" ? 1 : -1;
    return loadProducts();
  }
  if (action === "scheduler-pause" || action === "scheduler-resume") {
    const kind = button.dataset.kind;
    const change = action === "scheduler-pause" ? "pause" : "resume";
    if (!confirm(`¿${change === "pause" ? "Pausar" : "Reanudar"} el cron ${kind}${BOOT.localMode ? " en la simulación local" : " en Cloud Scheduler"}?`)) return;
    setBusy(true);
    try {
      const result = await api(`/api/admin-v69/schedulers/${kind}/${change}`, { method: "POST", body: JSON.stringify({ expectedState: button.dataset.state }) });
      await loadState();
      S.tab = "operations";
      if (result.warning) S.error = result.warning;
      render();
    } catch (error) { S.error = error.message; render(); }
    finally { setBusy(false); }
    return;
  }
  if (action === "approve-ean") {
    if (dirty()) { S.error = "Publicá o descartá el borrador antes de aprobar un EAN."; render(); return; }
    const ean = button.dataset.ean;
    if (!confirm(`¿Aprobar el EAN ${ean} para el próximo scan? La ficha seguirá sujeta a validación.`)) return;
    setBusy(true);
    try {
      await api("/api/admin-v69/ean-requests/approve", { method: "POST", body: JSON.stringify({ ean, expectedRevision: S.state.admin.revision }) });
      await loadState();
      S.tab = "ean";
      render();
    } catch (error) { S.error = error.message; render(); }
    finally { setBusy(false); }
    return;
  }
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
    S.policy.navigation.excludedBrandSlugs = (S.policy.navigation.excludedBrandSlugs || []).filter((slug) => slug !== button.dataset.slug);
    render();
  }
  if (action === "disable-brand") {
    const values = new Set(S.policy.navigation.excludedBrandSlugs || []);
    values.add(button.dataset.slug);
    S.policy.navigation.excludedBrandSlugs = [...values];
    render();
  }
  if (action === "enable-brand") {
    S.policy.navigation.excludedBrandSlugs = (S.policy.navigation.excludedBrandSlugs || []).filter((slug) => slug !== button.dataset.slug);
    render();
  }
  if (action === "add-ean") {
    const kind = button.dataset.kind;
    const values = [...new Set(document.querySelector(`[data-ean-input="${kind}"]`).value.split(/[\s,;]+/).map((value) => value.replace(/\D/g, "")).filter(Boolean))];
    const note = document.querySelector(`[data-ean-note="${kind}"]`).value.trim();
    const existing = new Set(S.policy.eanRules[kind].map((entry) => entry.ean));
    const opposite = new Set(["include", "exclude", "requests"].filter((other) => other !== kind)
      .flatMap((other) => S.policy.eanRules[other].map((entry) => entry.ean)));
    for (const ean of values) {
      if (opposite.has(ean)) { S.error = `${ean} ya está en otra lista.`; render(); return; }
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
    if (BOOT.localMode) { S.error = "Las operaciones reales están deshabilitadas en la vista previa local."; render(); return; }
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
  if (event.target.matches('[data-field="show-out-of-stock-sort"]')) S.policy.navigation.showOutOfStockSort = event.target.checked;
  if (event.target.matches('[data-field="promotion-brand"]')) {
    const disabled = new Set(S.policy.navigation.promotionDisabledTechnicalBrandSlugs === null
      ? S.state.catalog.promotionTechnicalBrands.filter((entry) => !entry.selected).map((entry) => entry.slug)
      : S.policy.navigation.promotionDisabledTechnicalBrandSlugs);
    event.target.checked ? disabled.delete(event.target.dataset.slug) : disabled.add(event.target.dataset.slug);
    S.policy.navigation.promotionDisabledTechnicalBrandSlugs = [...disabled];
    render();
    return;
  }
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
window.addEventListener("beforeunload", (event) => {
  if (!dirty()) return;
  event.preventDefault();
  event.returnValue = "";
});
if (S.token) loadState();
else showLogin();
