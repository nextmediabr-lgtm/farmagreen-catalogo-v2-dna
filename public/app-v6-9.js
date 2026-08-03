const BOOT = (() => {
  try {
    return JSON.parse(document.querySelector("#fg69-data")?.textContent || "{}");
  } catch {
    return {};
  }
})();
const BASE = (BOOT.base || "").replace(/\/$/, "");
const PUBLIC_ORIGIN = BOOT.origin || window.location.origin;
const PAGE = 48;
const ROUTE = "/catalogo-v6-9/";
const PDP = "/producto-v6-9/";
const CONTEXT = BOOT.context || {};
const SORT_VALUES = new Set(["relevancia", "disponibilidad", "descuento", "precio-asc", "precio-desc", "nombre"]);
const DEFAULT_SORT = "descuento";
const S = {
  all: BOOT.products || [],
  q: CONTEXT.q || "",
  brand: CONTEXT.brand || "Todas",
  need: CONTEXT.need || "Todas",
  scope: CONTEXT.scope || "ofertas",
  sort: SORT_VALUES.has(CONTEXT.sort) ? CONTEXT.sort : DEFAULT_SORT,
  limit: PAGE,
};

const NEED_LABELS = {
  manchas: "Manchas",
  acne: "Acné",
  "piel-sensible": "Piel sensible",
  hidratacion: "Hidratación",
  limpieza: "Limpieza",
  solares: "Solares",
  capilar: "Capilar",
  antiedad: "Antiedad",
  reparacion: "Reparación",
  nutricion: "Nutrición",
  "cuidado-diario": "Cuidado diario",
};

const SEARCH_ALIASES = {
  eucrin: ["eucerin"],
  eucerim: ["eucerin"],
  laroche: ["la roche posay"],
  "la roche": ["la roche posay"],
  lrp: ["la roche posay"],
  dermaglo: ["dermaglos"],
  vichi: ["vichy"],
  loreal: ["l oreal revitalift", "l oreal", "l oréal revitalift"],
  isdin: ["isdin"],
  cetafil: ["cetaphil"],
  aveno: ["aveno", "aveeno"],
  aveeno: ["aveeno", "aveno"],
  ena: ["ena", "ena suplementos", "ena sport"],
};
const SEARCH_STOPWORDS = new Set(["a", "al", "de", "del", "el", "la", "las", "los", "para", "por", "en", "un", "una", "unos", "unas", "y"]);

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
const absoluteUrl = (path) => new URL(url(path), PUBLIC_ORIGIN).href;
const wa = (product) =>
  `https://wa.me/5493417234000?text=${encodeURIComponent(
    `Hola Farmagreen Rosario, quiero consultar por ${brandName(product)} - ${product?.name || "Producto Farmagreen"}. Link: ${absoluteUrl(`${PDP}${product?.slug || ""}/`)}`,
  )}`;

function brandName(product) {
  return product?.brand?.name || "Farmagreen";
}

function productImage(product) {
  return product?.images?.card || product?.images?.detail || "";
}

function blob(product) {
  const needs = product.needs || [];
  return norm(
    [
      product.name,
      product.brand?.name,
      ...(product.brand?.aliases || []),
      product.line,
      product.barcode,
      ...(product.aliases || []),
      ...needs,
      ...needs.map((need) => NEED_LABELS[need] || need),
    ].join(" "),
  );
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
  return words.some((word) => word.length >= 4 && (word.includes(term) || levenshtein(word, term) <= (term.length > 7 ? 2 : 1)));
}

function searchTerms(value) {
  return norm(value)
    .split(" ")
    .filter((term) => term && !SEARCH_STOPWORDS.has(term));
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
  if (S.brand !== "Todas" && brandName(product) !== S.brand) return false;
  if (S.need !== "Todas" && !(product.needs || []).includes(S.need)) return false;
  if (queryBrand && brandName(product) !== queryBrand) return false;
  const terms = searchTerms(S.q);
  if (!terms.length) return true;
  const text = blob(product);
  return terms.every((term) => fuzzyIncludes(text, term));
}

function score(product) {
  let value = 0;
  const query = searchTerms(S.q).join(" ");
  const text = blob(product);
  if (query && text.includes(query)) value += 22;
  if (query && fuzzyIncludes(text, query)) value += 10;
  if (S.brand !== "Todas" && brandName(product) === S.brand) value += 9;
  if (S.need !== "Todas" && (product.needs || []).includes(S.need)) value += 8;
  return value;
}

function availabilityMeta(product) {
  if (product?.availability === "available_reference") {
    return {
      className: "",
      label: "Disponible para Entrega",
      title: "Estado observado en Rosario durante la última verificación; consultá para confirmar.",
    };
  }
  if (product?.availability === "unavailable_reference") {
    return {
      className: " is-unavailable",
      label: "Consultar Disponibilidad",
      title: "Estado observado en Rosario durante la última verificación; consultá para confirmar.",
    };
  }
  return {
    className: " is-unverified",
    label: "Consultar Disponibilidad",
    title: "Confirmamos disponibilidad por WhatsApp.",
  };
}

function card(product) {
  const discount = Math.round(product.discountPercent || 0);
  const name = product?.name || "Producto Farmagreen";
  const image = productImage(product);
  const availability = availabilityMeta(product);
  const media = image
    ? `<div class="v66-media"><img src="${esc(image)}" alt="${esc(name)}" loading="lazy" decoding="async"></div>`
    : `<div class="v66-media v67-image-missing" role="img" aria-label="Imagen no disponible para ${esc(name)}"></div>`;
  const stock = `<p class="v69-stock${availability.className}" title="${esc(availability.title)}"><span aria-hidden="true"></span><strong>${esc(availability.label)}</strong></p>`;
  const needsAvailabilityConsult = product?.availability !== "available_reference";
  const cta = "Consultar";
  const statusClass =
    product?.availability === "unavailable_reference"
      ? " v69-card-unavailable"
      : product?.availability === "unverified"
        ? " v69-card-unverified"
        : "";
  return `<article class="v66-card${statusClass}"><a class="v65-hit" href="${url(`${PDP}${esc(product?.slug || "")}/`)}" aria-label="Ver ${esc(name)}"></a><div class="v66-card-top"><p class="v66-brand">${esc(brandName(product))}</p>${discount > 0 ? `<span class="v66-discount">-${discount}%</span>` : ""}</div>${media}<div class="v66-card-body"><h3>${esc(name)}</h3><dl class="v66-facts"><div><dt>Presentación</dt><dd>${esc(presentation(product))}</dd></div><div><dt>Uso</dt><dd>${esc(usage(product))}</dd></div></dl>${stock}<div class="v66-price">${product.discountPercent > 0 ? `<s>${ars(product.listPrice)}</s>` : ""}<strong>${ars(product.offerPrice || product.listPrice)}</strong>${product.savingAmount > 0 ? `<small class="v66-saving">Ahorrás ${ars(product.savingAmount)}</small>` : ""}</div><a class="ask v66-ask${needsAvailabilityConsult ? " v69-ask-unavailable" : ""}" href="${wa(product)}">${cta}</a></div></article>`;
}

function presentation(product) {
  const matches = [...String(product.name || "").matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|cc|cm3|g|gr|grs|kg|cápsulas?|caps?\.?|comprimidos?|tabletas?|sobres?|ampollas?|unidades?)\b/gi)];
  const match = matches.at(-1);
  if (match) return `${match[1]} ${unit(match[2])}`;
  if (/\bx\s*ud\b/i.test(product.name || "")) return "1 unidad";
  if (/\bkit\b/i.test(product.name || "")) return "Kit";
  if (/\b(pack|combo|duo|trio)\b/i.test(product.name || "")) return "Pack";
  return "Consultar";
}

function usage(product) {
  const priority = ["nutricion", "manchas", "acne", "solares", "capilar", "piel-sensible", "antiedad", "reparacion", "hidratacion", "limpieza", "cuidado-diario"];
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

function syncFilterMenuSummaries(resultCount) {
  const needLabel = S.need === "Todas" ? "Todas" : NEED_LABELS[S.need] || S.need;
  const brandLabel = `${S.brand} · ${resultCount}`;
  const needSummary = $("#needSummaryV69");
  const brandSummary = $("#brandSummaryV69");
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

function currentPrice(product) {
  return Math.round(Number(product?.offerPrice || product?.listPrice || 0));
}

function productTie(left, right) {
  return (
    String(left?.name || "").localeCompare(String(right?.name || ""), "es", { sensitivity: "base", numeric: true }) ||
    String(left?.publicId || "").localeCompare(String(right?.publicId || ""), "es", { sensitivity: "base", numeric: true })
  );
}

function availabilityRank(product) {
  if (product?.availability === "available_reference") return 0;
  if (product?.availability === "unverified") return 1;
  return 2;
}

function sorted(products) {
  const entries = products.map((product) => ({ product, relevance: score(product) }));
  if (S.sort === "disponibilidad") {
    entries.sort(
      (left, right) =>
        availabilityRank(left.product) - availabilityRank(right.product) ||
        (right.product.discountPercent || 0) - (left.product.discountPercent || 0) ||
        (right.product.savingAmount || 0) - (left.product.savingAmount || 0) ||
        productTie(left.product, right.product),
    );
  } else if (S.sort === "descuento") {
    entries.sort(
      (left, right) =>
        (right.product.discountPercent || 0) - (left.product.discountPercent || 0) ||
        (right.product.savingAmount || 0) - (left.product.savingAmount || 0) ||
        productTie(left.product, right.product),
    );
  } else if (S.sort === "precio-asc") {
    entries.sort(
      (left, right) => currentPrice(left.product) - currentPrice(right.product) || productTie(left.product, right.product),
    );
  } else if (S.sort === "precio-desc") {
    entries.sort(
      (left, right) => currentPrice(right.product) - currentPrice(left.product) || productTie(left.product, right.product),
    );
  } else if (S.sort === "nombre") {
    entries.sort((left, right) => productTie(left.product, right.product));
  } else {
    entries.sort(
      (left, right) =>
        right.relevance - left.relevance ||
        (right.product.discountPercent || 0) - (left.product.discountPercent || 0) ||
        (right.product.savingAmount || 0) - (left.product.savingAmount || 0) ||
        productTie(left.product, right.product),
    );
  }
  return entries.map((entry) => entry.product);
}

function writeUrl(mode = "replace") {
  const params = new URLSearchParams();
  if (S.scope !== "ofertas") params.set("scope", S.scope);
  if (S.q) params.set("q", S.q);
  if (S.brand !== "Todas") params.set("marca", S.brand);
  if (S.need !== "Todas") params.set("need", S.need);
  if (S.sort !== DEFAULT_SORT) params.set("orden", S.sort);
  if (S.limit > PAGE) params.set("pagina", String(Math.ceil(S.limit / PAGE)));
  const next = `${url(ROUTE)}${params.toString() ? `?${params}` : ""}`;
  const method = mode === "push" && `${location.pathname}${location.search}` !== next ? "pushState" : "replaceState";
  history[method]({ fg69: true }, "", next);
}

function scrollProducts() {
  $("#productos-v69")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

let floatingCtaObserver = null;

function refreshFloatingWhatsapp() {
  const floating = $(".float");
  if (!floating) return;
  floatingCtaObserver?.disconnect();
  floatingCtaObserver = null;
  floating.classList.remove("is-cta-visible");
  if (!window.matchMedia("(max-width: 760px)").matches || !("IntersectionObserver" in window)) return;

  const visible = new Set();
  floatingCtaObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      floating.classList.toggle("is-cta-visible", visible.size > 0);
    },
    { threshold: 0.15 },
  );
  $$(".v66-ask, .cta")
    .filter((element) => !element.closest(".float"))
    .forEach((element) => floatingCtaObserver.observe(element));
}

function catalogCopy() {
  if (S.q) return { mode: "Resultados", title: `Resultados para “${S.q.trim()}”`, context: "Coincidencias por producto, marca o necesidad.", nav: "buscar" };
  if (S.brand !== "Todas") return { mode: "Marca", title: S.brand, context: `Productos disponibles de ${S.brand}.`, nav: "marcas" };
  if (S.need !== "Todas") {
    const label = NEED_LABELS[S.need] || S.need;
    return { mode: "Necesidad", title: label, context: `Selección para ${String(label).toLowerCase()}.`, nav: "buscar" };
  }
  if (S.scope === "todo") return { mode: "Catálogo", title: "Todos los productos", context: "Explorá el catálogo completo.", nav: "productos" };
  return { mode: "Ofertas", title: "Oportunidades de hoy", context: "Los mejores descuentos disponibles primero.", nav: "ofertas" };
}

function render(historyMode = "replace") {
  const brandFromQuery = searchedBrand();
  const items = sorted(S.all.filter((product) => matches(product, brandFromQuery)));
  const shown = Math.min(S.limit, items.length);
  $("#gridV69").innerHTML = items.length
    ? items.slice(0, shown).map(card).join("")
    : `<div class="v66-empty"><strong>No encontramos coincidencias.</strong><span>Probá otra palabra o limpiá los filtros.</span></div>`;
  $("#countV69").textContent = items.length ? `${shown} de ${items.length}` : "Sin resultados";
  const availability = items.reduce(
    (counts, product) => {
      if (product?.availability === "available_reference") counts.available += 1;
      if (product?.availability === "unavailable_reference") counts.unavailable += 1;
      if (product?.availability === "unverified") counts.unverified += 1;
      return counts;
    },
    { available: 0, unavailable: 0, unverified: 0 },
  );
  const availabilitySummary = $("#availabilityV69");
  if (availabilitySummary) {
    const total = availability.available + availability.unavailable + availability.unverified;
    availabilitySummary.hidden = true;
    availabilitySummary.innerHTML = total
      ? `<span><b>${availability.available}</b> disponibles</span><span><b>${availability.unavailable}</b> no disponibles</span><span><b>${availability.unverified}</b> no verificados</span>`
      : "";
    if (BOOT.availabilityReferenceAt) {
      availabilitySummary.title = `Referencia: ${new Date(BOOT.availabilityReferenceAt).toLocaleString("es-AR")}`;
    }
  }
  const copy = catalogCopy();
  $("#modeV69").textContent = copy.mode;
  const catalogTitle = $("#catalogTitleV69");
  catalogTitle.textContent = copy.title;
  catalogTitle.classList.toggle("v69-title-all", copy.title === "Todos los productos");
  $("#contextV69").textContent = copy.context;
  $$("[data-nav]").forEach((link) => link.classList.toggle("is-active", link.dataset.nav === copy.nav));
  const more = $("#loadMoreV69");
  const left = Math.max(items.length - shown, 0);
  more.hidden = left === 0;
  more.textContent = "Cargar más productos";
  more.setAttribute("aria-label", `Cargar más productos. Quedan ${left}.`);
  $("#showAllV69").hidden = copy.nav === "productos";
  sync("[data-brand]", "brand", S.brand);
  sync("[data-need]", "need", S.need);
  syncFilterMenuSummaries(items.length);
  writeUrl(historyMode);
  refreshFloatingWhatsapp();
}

function showAll() {
  closeFilterMenus();
  S.q = "";
  S.brand = "Todas";
  S.need = "Todas";
  S.scope = "todo";
  S.limit = PAGE;
  $("#searchV69").value = "";
  render("push");
  scrollProducts();
}

function reset() {
  closeFilterMenus();
  S.q = "";
  S.brand = "Todas";
  S.need = "Todas";
  S.scope = "ofertas";
  S.sort = DEFAULT_SORT;
  S.limit = PAGE;
  $("#searchV69").value = "";
  if ($("#sortV69")) $("#sortV69").value = S.sort;
  render("push");
}

function applyParams(params) {
  S.q = params.get("q") || "";
  S.brand = params.get("marca") === "Aveeno" ? "Aveno" : params.get("marca") || "Todas";
  S.need = params.get("need") || "Todas";
  S.sort = SORT_VALUES.has(params.get("orden")) ? params.get("orden") : DEFAULT_SORT;
  const validBrands = new Set(["Todas", ...S.all.map((product) => product.brand?.name).filter(Boolean)]);
  const validNeeds = new Set(["Todas", ...Object.keys(NEED_LABELS)]);
  if (!validBrands.has(S.brand)) S.brand = "Todas";
  if (!validNeeds.has(S.need)) S.need = "Todas";
  if (S.q) {
    S.brand = "Todas";
    S.need = "Todas";
  } else if (S.brand !== "Todas" && S.need !== "Todas") {
    S.need = "Todas";
  }
  S.scope =
    S.q || S.brand !== "Todas" || S.need !== "Todas"
      ? "todo"
      : params.get("scope") === "todo"
        ? "todo"
        : "ofertas";
  const totalPages = Math.max(1, Math.ceil(S.all.length / PAGE));
  const page = Math.max(1, Math.min(totalPages, Number.parseInt(params.get("pagina") || "1", 10) || 1));
  S.limit = page * PAGE;
}

function boot() {
  if (!$("#gridV69")) return;
  const params = new URLSearchParams(location.search);
  applyParams(params);
  $("#searchV69").value = S.q;
  if ($("#sortV69")) $("#sortV69").value = S.sort;

  $(".v66-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    closeFilterMenus();
    S.q = $("#searchV69").value;
    S.brand = "Todas";
    S.need = "Todas";
    S.scope = "todo";
    S.limit = PAGE;
    render("push");
    scrollProducts();
  });

  $("#searchV69")?.addEventListener("input", (event) => {
    closeFilterMenus();
    S.q = event.target.value;
    S.brand = "Todas";
    S.need = "Todas";
    S.scope = S.q ? "todo" : S.scope;
    S.limit = PAGE;
    render();
  });

  $("#showAllV69")?.addEventListener("click", showAll);
  $("#clearFiltersV69")?.addEventListener("click", reset);
  $("#loadMoreV69")?.addEventListener("click", () => {
    S.limit += PAGE;
    render("push");
  });
  $("#sortV69")?.addEventListener("change", (event) => {
    S.sort = SORT_VALUES.has(event.target.value) ? event.target.value : DEFAULT_SORT;
    S.limit = PAGE;
    render("push");
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
        $("#buscar-v69")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => $("#searchV69")?.focus(), 350);
      } else if (target === "marcas") {
        event.preventDefault();
        $("#buscar-v69")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => openFilterMenu("brand"), 240);
      }
    }),
  );

  $$("[data-brand]").forEach((button) =>
    button.addEventListener("click", () => {
      S.q = "";
      S.brand = button.dataset.brand || "Todas";
      if (S.brand !== "Todas") S.need = "Todas";
      S.scope = "todo";
      S.limit = PAGE;
      $("#searchV69").value = "";
      closeFilterMenus();
      render("push");
      scrollProducts();
    }),
  );

  $$("[data-need]").forEach((button) =>
    button.addEventListener("click", () => {
      S.q = "";
      S.need = button.dataset.need || "Todas";
      if (S.need !== "Todas") S.brand = "Todas";
      S.scope = "todo";
      S.limit = PAGE;
      $("#searchV69").value = "";
      closeFilterMenus();
      render("push");
      scrollProducts();
    }),
  );

  wireFilterMenus();
  render();
  window.addEventListener("popstate", () => {
    applyParams(new URLSearchParams(location.search));
    $("#searchV69").value = S.q;
    if ($("#sortV69")) $("#sortV69").value = S.sort;
    closeFilterMenus();
    render();
  });
}

wireImageFallbacks();
boot();
refreshFloatingWhatsapp();
window.matchMedia("(max-width: 760px)").addEventListener?.("change", refreshFloatingWhatsapp);
