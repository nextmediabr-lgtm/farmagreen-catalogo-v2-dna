const BASE = (window.__FG67?.base || "").replace(/\/$/, "");
const PAGE = 24;
const ROUTE = "/catalogo-v6-7/";
const PDP = "/producto-v6-7/";
const CONTEXT = window.__FG67?.context || {};
const S = {
  all: window.__FG67?.products || [],
  q: CONTEXT.q || "",
  brand: CONTEXT.brand || "Todas",
  need: CONTEXT.need || "Todas",
  scope: CONTEXT.scope || "ofertas",
  limit: PAGE,
};

const NEED_LABELS = {
  manchas: "Manchas",
  acne: "Acné",
  "piel-sensible": "Piel sensible",
  hidratacion: "Hidratación",
  solares: "Solares",
  capilar: "Capilar",
  antiedad: "Antiedad",
  reparacion: "Reparación",
  nutricion: "Nutrición",
};

const SEARCH_ALIASES = {
  eucrin: ["eucerin"],
  eucerim: ["eucerin"],
  laroche: ["la roche posay"],
  "la roche": ["la roche posay"],
  lrp: ["la roche posay"],
  dermaglo: ["dermaglos"],
  vichi: ["vichy"],
  loreal: ["l oreal revitalift"],
  isdin: ["isdin"],
  cetafil: ["cetaphil"],
  aveno: ["aveno"],
  ena: ["ena", "ena suplementos", "ena sport"],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const norm = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const ars = (value) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const url = (path) => `${BASE}${path}`;
const wa = (product) =>
  `https://wa.me/5493417234000?text=${encodeURIComponent(
    `Hola Farmagreen Rosario, quiero consultar por ${product.brand.name} - ${product.name}. Link: ${url(`${PDP}${product.slug}/`)}`,
  )}`;

function blob(product) {
  return norm([product.name, product.brand?.name, ...(product.brand?.aliases || []), product.line, ...(product.aliases || [])].join(" "));
}

function levenshtein(left, right) {
  if (Math.abs(left.length - right.length) > 2) return 9;
  const matrix = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= right.length; column += 1) matrix[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }
  return matrix[left.length][right.length];
}

function fuzzyIncludes(text, rawTerm) {
  const term = norm(rawTerm);
  if (!term) return true;
  const words = text.split(" ");
  for (const alias of SEARCH_ALIASES[term] || []) if (text.includes(norm(alias))) return true;
  if (term.length < 4) return words.includes(term);
  if (text.includes(term)) return true;
  return words.some((word) => word.length >= 4 && (word.includes(term) || term.includes(word) || levenshtein(word, term) <= (term.length > 7 ? 2 : 1)));
}

function searchedBrand() {
  const query = norm(S.q);
  if (!query) return "";
  const direct = S.all.find((product) => norm(product.brand?.name) === query || (product.brand?.aliases || []).some((alias) => norm(alias) === query));
  if (direct) return direct.brand.name;
  const aliases = (SEARCH_ALIASES[query] || []).map(norm);
  return S.all.find((product) => aliases.includes(norm(product.brand?.name)))?.brand?.name || "";
}

function matches(product, queryBrand = "") {
  if (S.scope === "ofertas" && !(product.discountPercent > 0)) return false;
  if (S.brand !== "Todas" && product.brand.name !== S.brand) return false;
  if (S.need !== "Todas" && !(product.needs || []).includes(S.need)) return false;
  if (queryBrand && product.brand.name !== queryBrand) return false;
  const terms = norm(S.q).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const text = blob(product);
  return terms.every((term) => fuzzyIncludes(text, term));
}

function score(product) {
  let value = 0;
  const query = norm(S.q);
  const text = blob(product);
  if (S.scope === "ofertas") value += 20;
  if (query && text.includes(query)) value += 22;
  if (query && fuzzyIncludes(text, query)) value += 10;
  if (S.brand !== "Todas" && product.brand.name === S.brand) value += 9;
  if (S.need !== "Todas" && (product.needs || []).includes(S.need)) value += 8;
  value += (product.discountPercent || 0) / 3;
  value += (product.savingAmount || 0) / 10000;
  return value;
}

function card(product) {
  const discount = Math.round(product.discountPercent || 0);
  return `<article class="v66-card"><a class="v65-hit" href="${url(`${PDP}${esc(product.slug)}/`)}" aria-label="Ver ${esc(product.name)}"></a><div class="v66-card-top"><p class="v66-brand">${esc(product.brand.name)}</p>${discount > 0 ? `<span class="v66-discount">${discount}%</span>` : ""}</div><div class="v66-media"><img src="${esc(product.images.card)}" alt="${esc(product.name)}" loading="lazy" decoding="async"></div><div class="v66-card-body"><h3>${esc(product.name)}</h3><dl class="v66-facts"><div><dt>Presentación</dt><dd>${esc(presentation(product))}</dd></div><div><dt>Uso principal</dt><dd>${esc(usage(product))}</dd></div></dl><div class="v66-price">${product.discountPercent > 0 ? `<s>${ars(product.listPrice)}</s>` : ""}<strong>${ars(product.offerPrice || product.listPrice)}</strong>${product.savingAmount > 0 ? `<small class="v66-saving">Ahorrás ${ars(product.savingAmount)}</small>` : ""}</div><a class="ask v66-ask" href="${wa(product)}">Consultar</a></div></article>`;
}

function presentation(product) {
  const matches = [...String(product.name || "").matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|cc|cm3|g|gr|grs|kg|cápsulas?|caps?\.?|comprimidos?|tabletas?|sobres?|ampollas?|unidades?)\b/gi)];
  const match = matches.at(-1);
  if (match) return `${match[1]} ${unit(match[2])}`;
  if (/\bx\s*ud\b/i.test(product.name || "")) return "1 unidad";
  if (/\bkit\b/i.test(product.name || "")) return "Kit";
  if (/\b(pack|combo|duo|trio)\b/i.test(product.name || "")) return "Pack";
  return "Unidad";
}

function usage(product) {
  const priority = ["nutricion", "manchas", "acne", "solares", "capilar", "piel-sensible", "antiedad", "reparacion", "hidratacion"];
  const need = priority.find((candidate) => (product.needs || []).includes(candidate));
  if (need) return NEED_LABELS[need] || categoryLabel(need);
  return categoryLabel(product.primaryCategory);
}

function categoryLabel(value) {
  return (
    {
      rostro: "Rostro",
      cuerpo: "Cuerpo",
      limpieza: "Limpieza",
      solares: "Protección solar",
      capilar: "Capilar",
      bebe: "Bebés",
      nutricion: "Nutrición",
      otros: "Cuidado diario",
    }[value] || String(value || "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function unit(value) {
  const normalized = norm(value).replace(/\.$/, "");
  if (["g", "gr", "grs"].includes(normalized)) return "g";
  if (["caps", "capsula", "capsulas"].includes(normalized)) return "cápsulas";
  return normalized;
}

function sync(selector, key, value) {
  $$(selector).forEach((button) => {
    const active = button.dataset[key] === value;
    button.classList.toggle("on", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setFilterMenuOpen(menu, open, restoreFocus = false) {
  if (!menu) return;
  const trigger = menu.querySelector("[data-filter-menu-trigger]");
  const popover = menu.querySelector("[data-filter-menu-popover]");
  menu.classList.toggle("is-open", open);
  trigger?.setAttribute("aria-expanded", open ? "true" : "false");
  popover?.setAttribute("aria-hidden", open ? "false" : "true");
  popover?.toggleAttribute("inert", !open);
  if (restoreFocus) trigger?.focus();
}

function closeFilterMenus(except = null, restoreFocus = false) {
  $$("[data-filter-menu]").forEach((menu) => {
    if (menu !== except && menu.classList.contains("is-open")) setFilterMenuOpen(menu, false, restoreFocus);
  });
}

function openFilterMenu(name) {
  const menu = $(`[data-filter-menu="${name}"]`);
  if (!menu) return;
  closeFilterMenus(menu);
  setFilterMenuOpen(menu, true);
}

function syncFilterMenuSummaries() {
  const needLabel = S.need === "Todas" ? "Todas" : NEED_LABELS[S.need] || S.need;
  const brandCount = S.brand === "Todas" ? S.all.length : S.all.filter((product) => product.brand?.name === S.brand).length;
  const brandLabel = `${S.brand} · ${brandCount}`;
  const needSummary = $("#needSummaryV67");
  const brandSummary = $("#brandSummaryV67");
  if (needSummary) needSummary.textContent = needLabel;
  if (brandSummary) brandSummary.textContent = brandLabel;
  $('[data-filter-menu-trigger="need"]')?.setAttribute("aria-label", `Elegir necesidad. Selección actual: ${needLabel}`);
  $('[data-filter-menu-trigger="brand"]')?.setAttribute("aria-label", `Elegir marca. Selección actual: ${brandLabel}`);
}

function wireFilterMenus() {
  $$("[data-filter-menu]").forEach((menu) => {
    menu.querySelector("[data-filter-menu-trigger]")?.addEventListener("click", () => {
      const willOpen = !menu.classList.contains("is-open");
      closeFilterMenus(menu);
      setFilterMenuOpen(menu, willOpen);
    });
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-filter-menu]")) closeFilterMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openMenu = $(".v67-filter-menu.is-open");
    if (!openMenu) return;
    event.preventDefault();
    setFilterMenuOpen(openMenu, false, true);
  });
}

function markBrokenImage(image) {
  if (!(image instanceof HTMLImageElement) || !image.matches(".v66-media img, .v65-photo img")) return;
  const holder = image.closest(".v66-media, .v65-photo");
  if (!holder || holder.classList.contains("v67-image-missing")) return;
  holder.classList.add("v67-image-missing");
  holder.setAttribute("role", "img");
  holder.setAttribute("aria-label", image.alt || "Imagen no disponible");
  image.hidden = true;
}

function wireImageFallbacks() {
  document.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement) markBrokenImage(event.target);
    },
    true,
  );
  $$(".v66-media img, .v65-photo img").forEach((image) => {
    if (image.complete && image.naturalWidth === 0) markBrokenImage(image);
  });
}

function writeUrl() {
  const params = new URLSearchParams();
  if (S.scope !== "ofertas") params.set("scope", S.scope);
  if (S.q) params.set("q", S.q);
  if (S.brand !== "Todas") params.set("marca", S.brand);
  if (S.need !== "Todas") params.set("need", S.need);
  history.replaceState(null, "", `${url(ROUTE)}${params.toString() ? `?${params}` : ""}`);
}

function scrollProducts() {
  $("#productos-v67")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function catalogCopy() {
  if (S.q) return { mode: "Resultados", title: `Resultados para “${S.q.trim()}”`, context: "Coincidencias por producto, marca o necesidad.", nav: "buscar" };
  if (S.brand !== "Todas" && S.need !== "Todas") {
    const label = NEED_LABELS[S.need] || S.need;
    return { mode: "Selección", title: S.brand, context: `${label} de ${S.brand}.`, nav: "marcas" };
  }
  if (S.brand !== "Todas") return { mode: "Marca", title: S.brand, context: `Productos disponibles de ${S.brand}.`, nav: "marcas" };
  if (S.need !== "Todas") {
    const label = NEED_LABELS[S.need] || S.need;
    return { mode: "Necesidad", title: label, context: `Selección para ${String(label).toLowerCase()}.`, nav: "buscar" };
  }
  if (S.scope === "todo") return { mode: "Catálogo", title: "Todos los productos", context: "Explorá el catálogo completo.", nav: "productos" };
  return { mode: "Ofertas", title: "Oportunidades de hoy", context: "Los mejores descuentos disponibles primero.", nav: "ofertas" };
}

function render() {
  const brandFromQuery = searchedBrand();
  const items = S.all.filter((product) => matches(product, brandFromQuery)).sort((left, right) => score(right) - score(left) || left.name.localeCompare(right.name, "es"));
  const shown = Math.min(S.limit, items.length);
  $("#gridV67").innerHTML = items.length
    ? items.slice(0, shown).map(card).join("")
    : `<div class="v66-empty"><strong>No encontramos coincidencias.</strong><span>Probá otra palabra o limpiá los filtros.</span></div>`;
  $("#countV67").textContent = items.length ? `${shown} de ${items.length}` : "Sin resultados";
  const copy = catalogCopy();
  $("#modeV67").textContent = copy.mode;
  $("#catalogTitleV67").textContent = copy.title;
  $("#contextV67").textContent = copy.context;
  $$("[data-nav]").forEach((link) => link.classList.toggle("is-active", link.dataset.nav === copy.nav));
  const more = $("#loadMoreV67");
  const left = Math.max(items.length - shown, 0);
  more.hidden = left === 0;
  more.textContent = "Cargar más productos";
  more.setAttribute("aria-label", `Cargar más productos. Quedan ${left}.`);
  $("#showAllV67").hidden = copy.nav === "productos";
  sync("[data-brand]", "brand", S.brand);
  sync("[data-need]", "need", S.need);
  syncFilterMenuSummaries();
  writeUrl();
}

function showAll() {
  closeFilterMenus();
  S.q = "";
  S.brand = "Todas";
  S.need = "Todas";
  S.scope = "todo";
  S.limit = PAGE;
  $("#searchV67").value = "";
  render();
  scrollProducts();
}

function reset() {
  closeFilterMenus();
  S.q = "";
  S.brand = "Todas";
  S.need = "Todas";
  S.scope = "ofertas";
  S.limit = PAGE;
  $("#searchV67").value = "";
  render();
}

function boot() {
  if (!$("#gridV67")) return;
  const params = new URLSearchParams(location.search);
  S.q = params.get("q") || S.q;
  S.brand = params.get("marca") || S.brand;
  S.need = params.get("need") || S.need;
  const validBrands = new Set(["Todas", ...S.all.map((product) => product.brand?.name)]);
  const validNeeds = new Set(["Todas", ...Object.keys(NEED_LABELS)]);
  if (!validBrands.has(S.brand)) S.brand = "Todas";
  if (!validNeeds.has(S.need)) S.need = "Todas";
  if (S.q) {
    S.brand = "Todas";
    S.need = "Todas";
  }
  S.scope = params.get("scope") || (S.q || S.brand !== "Todas" || S.need !== "Todas" ? "todo" : S.scope);
  if (!["ofertas", "todo"].includes(S.scope)) S.scope = "todo";
  $("#searchV67").value = S.q;

  $(".v66-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    closeFilterMenus();
    S.q = $("#searchV67").value;
    S.brand = "Todas";
    S.need = "Todas";
    S.scope = "todo";
    S.limit = PAGE;
    render();
    scrollProducts();
  });

  $("#searchV67")?.addEventListener("input", (event) => {
    closeFilterMenus();
    S.q = event.target.value;
    S.brand = "Todas";
    S.need = "Todas";
    S.scope = S.q ? "todo" : S.scope;
    S.limit = PAGE;
    render();
  });

  $("#showAllV67")?.addEventListener("click", showAll);
  $("#clearFiltersV67")?.addEventListener("click", reset);
  $("#loadMoreV67")?.addEventListener("click", () => {
    S.limit += PAGE;
    render();
  });

  $$("[data-nav]").forEach((link) =>
    link.addEventListener("click", (event) => {
      const target = link.dataset.nav;
      if (target === "ofertas") {
        event.preventDefault();
        reset();
        scrollProducts();
      } else if (target === "productos") {
        event.preventDefault();
        showAll();
      } else if (target === "buscar") {
        event.preventDefault();
        $("#buscar-v67")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => $("#searchV67")?.focus(), 350);
      } else if (target === "marcas") {
        event.preventDefault();
        $("#buscar-v67")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => openFilterMenu("brand"), 240);
      }
    }),
  );

  $$("[data-brand]").forEach((button) =>
    button.addEventListener("click", () => {
      S.q = "";
      S.brand = button.dataset.brand || "Todas";
      S.scope = "todo";
      S.limit = PAGE;
      $("#searchV67").value = "";
      closeFilterMenus();
      render();
      scrollProducts();
    }),
  );

  $$("[data-need]").forEach((button) =>
    button.addEventListener("click", () => {
      S.q = "";
      S.need = button.dataset.need || "Todas";
      S.scope = "todo";
      S.limit = PAGE;
      $("#searchV67").value = "";
      closeFilterMenus();
      render();
      scrollProducts();
    }),
  );

  wireFilterMenus();
  render();
}

wireImageFallbacks();
boot();
