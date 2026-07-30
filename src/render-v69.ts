import {
  catalogV69Data,
  publicAvailabilityV69,
  type CatalogV69,
  type ProductV69,
  type PublicAvailabilityV69,
} from "./data-v69.js";

const BASE = (process.env.PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const W = "5493417234000";
const SOCIAL_IMAGE = "https://farmagreenrosario.web.app/assets/farmagreen-social-preview-v2.png";
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const NEEDS = [
  { slug: "manchas", label: "Manchas" },
  { slug: "acne", label: "Acné" },
  { slug: "piel-sensible", label: "Piel sensible" },
  { slug: "hidratacion", label: "Hidratación" },
  { slug: "limpieza", label: "Limpieza" },
  { slug: "solares", label: "Solares" },
  { slug: "capilar", label: "Capilar" },
  { slug: "antiedad", label: "Antiedad" },
  { slug: "reparacion", label: "Reparación" },
  { slug: "nutricion", label: "Nutrición" },
  { slug: "cuidado-diario", label: "Cuidado diario" },
] as const;

const NEED_LABELS = new Map<string, string>(NEEDS.map((need) => [need.slug, need.label]));
const STOP_WORDS = new Set(["a", "al", "de", "del", "el", "la", "las", "los", "para", "por", "en", "un", "una", "unos", "unas", "y"]);
const SORTS_V69 = ["relevancia", "descuento", "precio-asc", "precio-desc", "nombre"] as const;
export type SortV69 = (typeof SORTS_V69)[number];

export type PublicProductV69 = {
  publicId: string;
  slug: string;
  name: string;
  brand: {
    id: string;
    slug: string;
    name: string;
    aliases: string[];
  };
  line: string;
  primaryCategory: string;
  needs: string[];
  aliases: string[];
  listPrice: number;
  offerPrice: number;
  savingAmount: number;
  discountPercent: number;
  availability: PublicAvailabilityV69;
  availabilityCheckedAt: string | null;
  images: {
    card: string;
    detail: string;
  };
};

export type PublicCatalogV69 = {
  version: number;
  syncedAt: string;
  commerceSyncedAt: string | null;
  availabilityReferenceAt: string | null;
  totalProducts: number;
  availabilitySummary: {
    available: number;
    unavailable: number;
    unverified: number;
  };
  products: PublicProductV69[];
};

export async function catalogV69(): Promise<CatalogV69> {
  return catalogV69Data();
}

export function publicCatalogV69(catalog: CatalogV69): PublicCatalogV69 {
  const unavailable = catalog.products.filter((product) => product.availability === "out_of_stock").length;
  const unverified = catalog.products.filter((product) => product.availability === "unknown").length;
  return {
    version: catalog.version,
    syncedAt: catalog.syncedAt,
    commerceSyncedAt: catalog.commerceSyncedAt,
    availabilityReferenceAt: catalog.availabilityReferenceAt,
    totalProducts: catalog.products.length,
    availabilitySummary: {
      available: catalog.products.length - unavailable - unverified,
      unavailable,
      unverified,
    },
    products: catalog.products.map(publicProductV69),
  };
}

export async function productV69(id: string) {
  return (await catalogV69()).products.find((product) => product.slug === id || product.publicId === id);
}

export async function similarV69(product: ProductV69) {
  return (await catalogV69()).products
    .filter((candidate) => candidate.publicId !== product.publicId)
    .map((candidate) => ({
      candidate,
      score:
        (brandSlug(candidate) === brandSlug(product) ? 5 : 0) +
        safeList(candidate.categorySlugs).filter((category) => safeList(product.categorySlugs).includes(category)).length * 3 +
        safeList(candidate.needs).filter((need) => safeList(product.needs).includes(need)).length * 2 +
        (candidate.discountPercent || 0) / 100,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((entry) => entry.candidate);
}

export function searchTextV69(product: ProductV69) {
  const needs = safeList(product.needs);
  return normalize(
    [
      product.name,
      brandName(product),
      ...safeList(product.brand.aliases),
      product.line,
      ...safeList(product.aliases),
      ...needs,
      ...needs.map((need) => NEED_LABELS.get(need) || need),
    ].join(" "),
  );
}

export function catalogPageV69(catalog: CatalogV69, query = new URLSearchParams(), origin = "http://127.0.0.1:8109") {
  const context = pageContext(catalog, query);
  const brands = [...new Set(catalog.products.map(brandName))];
  const offers = dealProducts(catalog.products);
  const initial = filteredProducts(catalog.products, context);
  const initialAvailability = availabilitySummaryV69(initial);
  const brandStats = brands.map((brand) => ({
    brand,
    count: catalog.products.filter((product) => brandName(product) === brand).length,
    best: offers.find((product) => brandName(product) === brand)?.discountPercent || 0,
  }));
  const initialNeedLabel = context.need === "Todas" ? "Todas" : NEED_LABELS.get(context.need) || "Todas";
  const initialBrandLabel = `${context.brand} · ${initial.length}`;

  return shell69(
    context.metaTitle,
    context.metaDescription,
    `
<section class="v65-panel v65-search-panel v65-top-search v67-discovery" id="buscar-v69">
  <div class="v67-primary-row">
    <div class="v67-title"><p class="v65-k">Encontrá tu producto</p><h2>Buscá como hablás</h2></div>
    <form class="v66-search v67-search" role="search">
      <label class="v67-visually-hidden" for="searchV69">Producto, marca o necesidad</label>
      <span class="v67-search-icon">${searchIcon()}</span>
      <input id="searchV69" type="search" placeholder="Producto, marca o necesidad" autocomplete="off" spellcheck="false">
    </form>
    <button class="v65-link-button" id="clearFiltersV69" type="button">Limpiar</button>
  </div>
  <div class="v67-filter-grid" aria-label="Filtros del catálogo">
    <div class="v67-filter-menu v67-need-menu" data-filter-menu="need">
      <button class="v67-menu-trigger" type="button" data-filter-menu-trigger="need" aria-expanded="false" aria-controls="needMenuV69">
        <span class="v67-menu-label">¿Qué necesitás?</span>
        <strong id="needSummaryV69">${e(initialNeedLabel)}</strong>
        ${chevronIcon()}
      </button>
      <div class="v67-menu-popover v67-need-popover" id="needMenuV69" data-filter-menu-popover aria-hidden="true" aria-label="Elegir necesidad" inert>
        <div class="v67-need-options">
          <button class="v67-need-option${context.need === "Todas" ? " on" : ""}" type="button" data-need="Todas" aria-pressed="${context.need === "Todas"}">
            ${needIcon("Todas")}<span>Todas</span>${optionCheckIcon()}
          </button>
          ${NEEDS.map(
            (need) => `<button class="v67-need-option${context.need === need.slug ? " on" : ""}" type="button" data-need="${need.slug}" aria-pressed="${context.need === need.slug}">
              ${needIcon(need.slug)}<span>${need.label}</span>${optionCheckIcon()}
            </button>`,
          ).join("")}
        </div>
      </div>
    </div>
    <div class="v67-filter-menu v67-brand-menu" data-filter-menu="brand" id="marcas-v69">
      <button class="v67-menu-trigger" type="button" data-filter-menu-trigger="brand" aria-expanded="false" aria-controls="brandMenuV69">
        <span class="v67-menu-label">Marca</span>
        <strong id="brandSummaryV69">${e(initialBrandLabel)}</strong>
        ${chevronIcon()}
      </button>
      <div class="v67-menu-popover v67-brand-popover" id="brandMenuV69" data-filter-menu-popover aria-hidden="true" aria-label="Elegir marca" inert>
        <div class="v67-brand-options">
          <button class="v67-brand-option${context.brand === "Todas" ? " on" : ""}" type="button" data-brand="Todas" aria-pressed="${context.brand === "Todas"}">
            <span class="v67-brand-copy"><strong>Todas</strong><small>${catalog.totalProducts} productos</small></span>
            ${optionCheckIcon()}
          </button>
          ${brandStats
            .map(
              (item) => `<button class="v67-brand-option${context.brand === item.brand ? " on" : ""}" type="button" data-brand="${e(item.brand)}" aria-pressed="${context.brand === item.brand}">
                <span class="v67-brand-copy"><strong>${e(item.brand)}</strong><small>${item.count} productos</small></span>
                ${item.best ? `<em>hasta ${Math.round(item.best)}%</em>` : ""}
                ${optionCheckIcon()}
              </button>`,
            )
            .join("")}
        </div>
      </div>
    </div>
    <label class="v69-sort">
      <span class="v67-menu-label">Ordenar</span>
      <select id="sortV69" name="orden">
        <option value="relevancia"${context.sort === "relevancia" ? " selected" : ""}>Relevancia</option>
        <option value="descuento"${context.sort === "descuento" ? " selected" : ""}>Mayor descuento</option>
        <option value="precio-asc"${context.sort === "precio-asc" ? " selected" : ""}>Menor precio</option>
        <option value="precio-desc"${context.sort === "precio-desc" ? " selected" : ""}>Mayor precio</option>
        <option value="nombre"${context.sort === "nombre" ? " selected" : ""}>Nombre A–Z</option>
      </select>
      ${chevronIcon()}
    </label>
  </div>
</section>

<section class="v65-products" id="productos-v69">
  <div class="v65-head v66-catalog-head">
    <div>
      <p class="v65-k" id="modeV69">${e(context.mode)}</p>
      <h1 id="catalogTitleV69">${e(context.title)}</h1>
      <p class="v66-context" id="contextV69">${e(context.copy)}</p>
      <p class="v69-availability-summary" id="availabilityV69">${availabilitySummaryTextV69(initialAvailability.available, initialAvailability.unavailable, initialAvailability.unverified)}</p>
      <p class="v69-availability-note" id="availabilityNoteV69">${catalog.commerceSyncedAt ? `Estado comercial verificado ${e(shortDateV69(catalog.commerceSyncedAt))}. Confirmamos disponibilidad por WhatsApp.` : catalog.availabilityReferenceAt ? `Verificación parcial actualizada ${e(shortDateV69(catalog.availabilityReferenceAt))}. Confirmamos disponibilidad por WhatsApp.` : "Estado comercial pendiente de sincronización. Confirmamos disponibilidad por WhatsApp."}</p>
    </div>
    <div class="v66-catalog-tools">
      <p id="countV69" aria-live="polite"></p>
      <button class="v65-link-button" type="button" id="showAllV69">Ver todo el catálogo</button>
    </div>
  </div>
  <section class="v65-grid" id="gridV69">${initial.slice(0, 24).map((product) => cardV69(product, origin)).join("")}</section>
  <div class="morebox"><button id="loadMoreV69" type="button" aria-label="Cargar más productos">Cargar más productos</button></div>
</section>

<script type="application/json" id="fg69-data">${json({
      base: BASE,
      origin,
      commerceSyncedAt: catalog.commerceSyncedAt,
      availabilityReferenceAt: catalog.availabilityReferenceAt,
      products: publicCatalogV69(catalog).products,
      context: context.state,
    })}</script>`,
    {
      bodyClass: "v65 v66 v67 v69",
      origin,
      canonicalPath: "/catalogo-v6-9/",
      ogType: "website",
      ogImage: context.ogImage,
      homeHref: "/catalogo-v6-9/",
      links: [
        { href: "/catalogo-v6-9/#productos-v69", label: "Ofertas", nav: "ofertas" },
        { href: "/catalogo-v6-9/#marcas-v69", label: "Marcas", nav: "marcas" },
        { href: "/catalogo-v6-9/#buscar-v69", label: "Buscar", nav: "buscar" },
        { href: "/catalogo-v6-9/?scope=todo#productos-v69", label: "Productos", nav: "productos" },
      ],
    },
  );
}

export function productPageV69(product: ProductV69, related: ProductV69[], origin = "http://127.0.0.1:8109") {
  const discount = Math.round(product.discountPercent || 0);
  const productUrl = absolute(origin, `/producto-v6-9/${product.slug}/`);
  return shell69(
    `${product.name} | Farmagreen Rosario`,
    product.description.slice(0, 155),
    `
<nav class="crumb v65-crumb"><a href="${u("/catalogo-v6-9/#productos-v69")}">Volver al catálogo</a><span>/</span><span>${e(brandName(product))}</span></nav>
<article class="pdp v65-pdp v66-pdp">
  <div class="v66-card-top v67-pdp-card-top">
    <p class="v66-brand">${e(brandName(product))}</p>
    ${discount > 0 ? `<span class="v66-discount">-${discount}%</span>` : ""}
  </div>
  ${productImage(product, "detail", "photo v65-photo")}
  <div class="buybox v65-buybox">
    <h1>${e(product.name)}</h1>
    <p class="v65-meta">${e(product.line)} · ${e(categoryLabel(product.primaryCategory))}</p>
    ${stockBadgeV69(product, true)}
    <dl class="v66-pdp-facts">
      <div><dt>Presentación</dt><dd>${e(presentation(product))}</dd></div>
      <div><dt>Uso</dt><dd>${e(usage(product))}</dd></div>
    </dl>
    ${priceDetail(product)}
    <a class="cta" href="${wa(`Hola Farmagreen Rosario, quiero consultar por ${brandName(product)} - ${product.name}. Link: ${productUrl}`)}">${product.availability === "limited" ? "Consultar este producto por WhatsApp" : "Consultar disponibilidad o alternativa"}</a>
    <ul class="v65-service-list">
      <li>Consulta humana y directa.</li>
      <li>Retiro coordinado en Rosario.</li>
    </ul>
    ${productDetail(product)}
  </div>
</article>
<section class="v65-products v65-related">
  <div class="v65-head"><div><p class="v65-k">Similares</p><h2>También puede servirte</h2></div><p>Misma marca, categoría o necesidad.</p></div>
  <section class="v65-grid">${related.map((item) => cardV69(item, origin)).join("")}</section>
</section>
<script type="application/ld+json">${json({
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      image: new URL(safeImage(product, "detail"), origin).toString(),
      description: product.description,
      url: productUrl,
      category: categoryLabel(product.primaryCategory),
      brand: { "@type": "Brand", name: brandName(product) },
      offers: {
        "@type": "Offer",
        priceCurrency: "ARS",
        price: product.offerPrice || product.listPrice,
      },
    })}</script>`,
    {
      bodyClass: "v65 v66 v67 v69 product-detail",
      origin,
      canonicalPath: `/producto-v6-9/${product.slug}/`,
      ogType: "product",
      ogImage: safeImage(product, "detail"),
      homeHref: "/catalogo-v6-9/",
      links: [{ href: "/catalogo-v6-9/#productos-v69", label: "Catálogo" }],
    },
  );
}

export function notFoundPageV69(origin = "http://127.0.0.1:8109") {
  return shell69(
    "No encontrado | Farmagreen Rosario",
    "Producto no encontrado",
    `<section class="empty"><h1>No encontramos ese producto</h1><a href="${u("/catalogo-v6-9/")}">Volver al catálogo</a></section>`,
    { bodyClass: "v65 v66 v67 v69", origin, homeHref: "/catalogo-v6-9/" },
  );
}

type QueryState = { q: string; brand: string; need: string; scope: "ofertas" | "todo"; sort: SortV69 };
type PageContext = QueryState & {
  state: QueryState;
  mode: string;
  title: string;
  copy: string;
  metaTitle: string;
  metaDescription: string;
  ogImage: string;
};

function pageContext(catalog: CatalogV69, query: URLSearchParams): PageContext {
  const availableBrands = new Set(catalog.products.map(brandName));
  const requestedBrand = query.get("marca") === "Aveeno" ? "Aveno" : query.get("marca") || "";
  let brand = availableBrands.has(requestedBrand) ? requestedBrand : "Todas";
  const requestedNeed = query.get("need") || "";
  let need = NEED_LABELS.has(requestedNeed) ? requestedNeed : "Todas";
  const q = String(query.get("q") || "").trim();
  if (q) {
    brand = "Todas";
    need = "Todas";
  } else if (brand !== "Todas" && need !== "Todas") {
    need = "Todas";
  }
  const scope: "ofertas" | "todo" = query.get("scope") === "todo" || q || brand !== "Todas" || need !== "Todas" ? "todo" : "ofertas";
  const requestedSort = query.get("orden");
  const sort: SortV69 = SORTS_V69.includes(requestedSort as SortV69) ? (requestedSort as SortV69) : "relevancia";
  const state = { q, brand, need, scope, sort };
  let mode = "Ofertas";
  let title = "Oportunidades de hoy";
  let copy = "Los mejores descuentos disponibles primero.";
  if (q) {
    mode = "Resultados";
    title = `Resultados para “${q}”`;
    copy = "Coincidencias por producto, marca o necesidad.";
  } else if (brand !== "Todas") {
    mode = "Marca";
    title = brand;
    copy = `Productos disponibles de ${brand}.`;
  } else if (need !== "Todas") {
    mode = "Necesidad";
    title = NEED_LABELS.get(need) || need;
    copy = `Selección para ${title.toLowerCase()}.`;
  } else if (scope === "todo") {
    mode = "Catálogo";
    title = "Todos los productos";
    copy = "Explorá el catálogo completo.";
  }
  const filtered = filteredProducts(catalog.products, state);
  const metaTitle = brand !== "Todas" ? `${brand} | Catálogo Farmagreen V6.9` : need !== "Todas" ? `${title} | Catálogo Farmagreen V6.9` : q ? `${title} | Farmagreen` : "Farmagreen Rosario | Catálogo V6.9";
  const metaDescription = brand !== "Todas" ? `${filtered.length} productos disponibles de ${brand} para consultar por WhatsApp.` : need !== "Todas" ? `Productos para ${title.toLowerCase()} disponibles en Farmagreen Rosario.` : "Catálogo FarmaGreen con marcas, necesidades y consulta directa por WhatsApp.";
  const contextual = Boolean(q || brand !== "Todas" || need !== "Todas");
  return { ...state, state, mode, title, copy, metaTitle, metaDescription, ogImage: contextual ? safeImage(filtered[0], "card") || SOCIAL_IMAGE : SOCIAL_IMAGE };
}

export function normalizeQueryTermsV69(value: string) {
  return normalize(value)
    .split(" ")
    .filter((term) => term && !STOP_WORDS.has(term));
}

function filteredProducts(products: ProductV69[], state: QueryState) {
  const terms = normalizeQueryTermsV69(state.q);
  const filtered = products
    .filter((product) => state.scope !== "ofertas" || product.discountPercent > 0)
    .filter((product) => state.brand === "Todas" || brandName(product) === state.brand)
    .filter((product) => state.need === "Todas" || safeList(product.needs).includes(state.need))
    .filter((product) => {
      if (!terms.length) return true;
      const text = searchTextV69(product);
      return terms.every((term) => text.includes(term));
    });
  return sortProductsV69(filtered, state.sort);
}

export function sortProductsV69(products: ProductV69[], sort: SortV69) {
  const copy = [...products];
  const tie = (left: ProductV69, right: ProductV69) =>
    String(left.name || "").localeCompare(String(right.name || ""), "es") ||
    String(left.publicId || "").localeCompare(String(right.publicId || ""), "es");
  if (sort === "descuento") {
    return copy.sort(
      (left, right) =>
        (right.discountPercent || 0) - (left.discountPercent || 0) ||
        (right.savingAmount || 0) - (left.savingAmount || 0) ||
        tie(left, right),
    );
  }
  if (sort === "precio-asc") {
    return copy.sort((left, right) => currentPriceV69(left) - currentPriceV69(right) || tie(left, right));
  }
  if (sort === "precio-desc") {
    return copy.sort((left, right) => currentPriceV69(right) - currentPriceV69(left) || tie(left, right));
  }
  if (sort === "nombre") return copy.sort(tie);
  return copy.sort(
    (left, right) =>
      (right.discountPercent || 0) - (left.discountPercent || 0) ||
      (right.savingAmount || 0) - (left.savingAmount || 0) ||
      tie(left, right),
  );
}

function currentPriceV69(product: ProductV69) {
  return Math.round(Number(product.offerPrice || product.listPrice || 0));
}

type ShellLink = { href: string; label: string; nav?: string };
type ShellOptions = {
  homeHref?: string;
  links?: ShellLink[];
  bodyClass?: string;
  origin?: string;
  canonicalPath?: string;
  ogType?: string;
  ogImage?: string;
};

function shell69(title: string, description: string, body: string, options: ShellOptions = {}) {
  const homeHref = options.homeHref || "/catalogo-v6-9/";
  const links = options.links || [];
  const canonicalUrl = options.canonicalPath ? absolute(options.origin || "http://127.0.0.1:8109", options.canonicalPath) : "";
  const canonical = canonicalUrl ? `<link rel="canonical" href="${e(canonicalUrl)}">` : "";
  const ogImage = options.ogImage ? new URL(options.ogImage, options.origin || "http://127.0.0.1:8109").toString() : "";
  const og = `<meta property="og:type" content="${e(options.ogType || "website")}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:site_name" content="Farmagreen Rosario"><meta property="og:locale" content="es_AR">${canonicalUrl ? `<meta property="og:url" content="${e(canonicalUrl)}">` : ""}${ogImage ? `<meta property="og:image" content="${e(ogImage)}">` : ""}<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">`;
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(title)}</title><meta name="description" content="${e(description)}">${canonical}${og}<link rel="icon" href="${u("/logo_farmagreen.png")}"><link rel="stylesheet" href="${u("/styles-v6-5.css")}"><link rel="stylesheet" href="${u("/styles-v6-6.css")}"><link rel="stylesheet" href="${u("/styles-v6-7.css")}"><link rel="stylesheet" href="${u("/styles-v6-9.css")}"></head><body${options.bodyClass ? ` class="${e(options.bodyClass)}"` : ""}><header class="top"><a href="${u(homeHref)}" class="brandmark"><img src="${u("/logo_farmagreen.png")}" alt="Farmagreen"></a><div class="toplinks">${links.map((link) => `<a href="${u(link.href)}"${link.nav ? ` data-nav="${e(link.nav)}"` : ""}>${e(link.label)}</a>`).join("")}</div><a class="topwa" href="${wa("Hola Farmagreen Rosario, quiero consultar.")}" aria-label="Abrir WhatsApp de Farmagreen">${waIcon()}<span>WhatsApp</span></a></header><main>${body}</main><a class="float" href="${wa("Hola Farmagreen Rosario, quiero hacer una consulta.")}" aria-label="Consultar por WhatsApp">${waIcon()}</a><script type="module" src="${u("/app-v6-9.js")}"></script></body></html>`;
}

function cardV69(product: ProductV69, origin = "http://127.0.0.1:8109") {
  const discount = Math.round(product.discountPercent || 0);
  const productPath = `/producto-v6-9/${product.slug}/`;
  const name = String(product.name || "Producto Farmagreen");
  const brand = brandName(product);
  const unavailable = product.availability === "out_of_stock";
  const unverified = product.availability === "unknown";
  const statusClass = unavailable ? " v69-card-unavailable" : unverified ? " v69-card-unverified" : "";
  return `<article class="v66-card${statusClass}"><a class="v65-hit" href="${u(productPath)}" aria-label="Ver ${e(name)}"></a><div class="v66-card-top"><p class="v66-brand">${e(brand)}</p>${discount > 0 ? `<span class="v66-discount">-${discount}%</span>` : ""}</div>${productImage(product, "card", "v66-media")}<div class="v66-card-body"><h3>${e(name)}</h3><dl class="v66-facts"><div><dt>Presentación</dt><dd>${e(presentation(product))}</dd></div><div><dt>Uso</dt><dd>${e(usage(product))}</dd></div></dl>${stockBadgeV69(product)}${priceCard(product)}<a class="ask v66-ask" href="${wa(`Hola Farmagreen Rosario, quiero consultar por ${brand} - ${name}. Link: ${absolute(origin, productPath)}`)}">${unavailable || unverified ? "Consultar disponibilidad" : "Consultar"}</a></div></article>`;
}

function stockBadgeV69(product: ProductV69, detail = false) {
  const unavailable = product.availability === "out_of_stock";
  const unverified = product.availability === "unknown";
  const label = unavailable ? "no disponible" : unverified ? "no verificado" : "disponible";
  const checked = product.availabilityCheckedAt ? shortDateV69(product.availabilityCheckedAt) : "";
  return `<p class="v69-stock${unavailable ? " is-unavailable" : ""}${unverified ? " is-unverified" : ""}${detail ? " is-pdp" : ""}"><span aria-hidden="true"></span><strong>Disponibilidad:</strong> ${label}${detail ? `<small>${checked ? `Verificado ${e(checked)}` : "Pendiente de verificación diaria"} · confirmar por WhatsApp</small>` : ""}</p>`;
}

export function availabilitySummaryV69(products: ProductV69[]) {
  const unavailable = products.filter((product) => product.availability === "out_of_stock").length;
  const unverified = products.filter((product) => product.availability === "unknown").length;
  return { available: products.length - unavailable - unverified, unavailable, unverified };
}

function availabilitySummaryTextV69(available: number, unavailable: number, unverified: number) {
  return `<span><b>${available}</b> disponibles</span><span><b>${unavailable}</b> no disponibles</span><span><b>${unverified}</b> no verificados</span>`;
}

function shortDateV69(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "sin fecha"
    : new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Cordoba" }).format(date);
}

function dealProducts(products: ProductV69[]) {
  return [...products].filter((product) => product.discountPercent > 0).sort((left, right) => right.discountPercent - left.discountPercent || right.savingAmount - left.savingAmount);
}

function priceCard(product: ProductV69) {
  return `<div class="v66-price">${product.discountPercent > 0 ? `<s>${money.format(product.listPrice)}</s>` : ""}<strong>${money.format(product.offerPrice || product.listPrice)}</strong>${product.savingAmount > 0 ? `<small class="v66-saving">Ahorrás ${money.format(product.savingAmount)}</small>` : ""}</div>`;
}

function priceDetail(product: ProductV69) {
  return `<div class="price v66-detail-price">${product.discountPercent > 0 ? `<b>-${Math.round(product.discountPercent)}%</b><s>${money.format(product.listPrice)}</s>` : ""}<strong>${money.format(product.offerPrice || product.listPrice)}</strong></div>`;
}

function presentation(product: ProductV69) {
  const name = String(product.name || "");
  const matches = [...name.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|cc|cm3|g|gr|grs|kg|cápsulas?|caps?\.?|comprimidos?|tabletas?|sobres?|ampollas?|unidades?)\b/gi)];
  const match = matches.at(-1);
  if (match) return `${match[1]} ${unit(match[2])}`;
  if (/\bx\s*ud\b/i.test(name)) return "1 unidad";
  if (/\bkit\b/i.test(name)) return "Kit";
  if (/\b(pack|combo|duo|trio)\b/i.test(name)) return "Pack";
  return "Consultar";
}

function usage(product: ProductV69) {
  const priority = ["nutricion", "manchas", "acne", "solares", "capilar", "piel-sensible", "antiedad", "reparacion", "hidratacion", "limpieza", "cuidado-diario"];
  const need = priority.find((candidate) => safeList(product.needs).includes(candidate));
  return need ? NEED_LABELS.get(need) || categoryLabel(need) : categoryLabel(product.primaryCategory);
}

function categoryLabel(value: string) {
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

function unit(value: string) {
  const normalized = normalize(value).replace(/\.$/, "");
  if (["g", "gr", "grs"].includes(normalized)) return "g";
  if (["caps", "capsula", "capsulas"].includes(normalized)) return "cápsulas";
  return normalized;
}

function safeList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function brandName(product: Partial<ProductV69> | undefined) {
  return String(product?.brand?.name || "Farmagreen");
}

function brandSlug(product: Partial<ProductV69> | undefined) {
  return String(product?.brand?.slug || normalize(brandName(product)));
}

export function sourceImageV69(product: Partial<ProductV69> | undefined, kind: "card" | "detail") {
  return String(product?.images?.[kind] || product?.images?.detail || product?.images?.card || "");
}

export function isPrivateSourceImageV69(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      (hostname === "gpsfarma.com" || hostname.endsWith(".gpsfarma.com"))
    );
  } catch {
    return false;
  }
}

function safeImage(product: Partial<ProductV69> | undefined, kind: "card" | "detail") {
  const image = sourceImageV69(product, kind);
  if (!image || !isPrivateSourceImageV69(image)) return image;
  return u(`/media-v6-9/${encodeURIComponent(String(product?.publicId || ""))}/${kind}`);
}

function publicProductV69(product: ProductV69): PublicProductV69 {
  return {
    publicId: product.publicId,
    slug: product.slug,
    name: product.name,
    brand: {
      id: product.brand.id,
      slug: product.brand.slug,
      name: product.brand.name,
      aliases: safeList(product.brand.aliases),
    },
    line: product.line,
    primaryCategory: product.primaryCategory,
    needs: safeList(product.needs),
    aliases: safeList(product.aliases),
    listPrice: product.listPrice,
    offerPrice: product.offerPrice,
    savingAmount: product.savingAmount,
    discountPercent: product.discountPercent,
    availability: publicAvailabilityV69(product),
    availabilityCheckedAt: product.availabilityCheckedAt,
    images: {
      card: safeImage(product, "card"),
      detail: safeImage(product, "detail"),
    },
  };
}

function productImage(product: Partial<ProductV69>, kind: "card" | "detail", className: string) {
  const image = safeImage(product, kind);
  const name = String(product.name || "Producto Farmagreen");
  return image
    ? `<div class="${className}"><img src="${e(image)}" alt="${e(name)}"${kind === "card" ? ' loading="lazy" decoding="async"' : ""}></div>`
    : `<div class="${className} v67-image-missing" role="img" aria-label="Imagen no disponible para ${e(name)}"></div>`;
}

type V69DetailSection = {
  id: string;
  title: string;
  kind: "text" | "list" | "steps";
  content: string[];
};

type V69Detail = {
  summary?: string[];
  sections?: V69DetailSection[];
};

function productDetail(product: ProductV69) {
  const detail = (product as ProductV69 & { detail?: V69Detail }).detail;
  const summary = safeList(detail?.summary);
  const sections = Array.isArray(detail?.sections) ? detail.sections : [];
  const summaryHtml = (summary.length ? summary : [product.description])
    .filter(Boolean)
    .map((paragraph) => `<p>${e(paragraph)}</p>`)
    .join("");
  const sectionsHtml = sections
    .filter((section) => section && safeList(section.content).length)
    .map((section) => {
      const content = safeList(section.content);
      const body =
        section.kind === "steps"
          ? `<ol>${content.map((item) => `<li>${e(item)}</li>`).join("")}</ol>`
          : section.kind === "list"
            ? `<ul>${content.map((item) => `<li>${e(item)}</li>`).join("")}</ul>`
            : content.map((paragraph) => `<p>${e(paragraph)}</p>`).join("");
      return `<section class="v69-detail-section v69-detail-${e(section.id)}"><h3>${e(section.title)}</h3>${body}</section>`;
    })
    .join("");
  return `<section class="v69-detail"><h2>Detalle</h2><div class="v69-detail-summary">${summaryHtml}</div>${sectionsHtml}</section>`;
}

function normalize(value: string) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function searchIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function chevronIcon() {
  return `<svg class="v67-menu-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9.5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function optionCheckIcon() {
  return `<span class="v67-option-check" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m5.5 10.2 3 3 6-6.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

function needIcon(slug: string) {
  const icons: Record<string, string> = {
    Todas: `<path d="M12 2.7 13.4 8l4.9 1.6-4.9 1.6L12 16.5l-1.4-5.3-4.9-1.6L10.6 8 12 2.7Z"/><path d="m18.2 15 .7 2.4 2.2.7-2.2.8-.7 2.4-.7-2.4-2.2-.8 2.2-.7.7-2.4Z"/>`,
    manchas: `<circle cx="8" cy="8" r="1.5"/><circle cx="15.8" cy="6.5" r="1.2"/><circle cx="17" cy="14.5" r="1.6"/><circle cx="9.2" cy="16.2" r="1.25"/><circle cx="12.4" cy="11.7" r="1"/>`,
    acne: `<path d="M12 3.2c3.1 3.5 5.4 6.1 5.4 9.1A5.4 5.4 0 0 1 12 17.7a5.4 5.4 0 0 1-5.4-5.4c0-3 2.3-5.6 5.4-9.1Z"/><path d="M9.6 12.2c1.6.8 3.2.8 4.8 0"/>`,
    "piel-sensible": `<path d="M19.5 4.5C13 4.8 7.7 7.3 5.7 12.1c-1 2.5-.4 5.2 1.7 6.6 2.8 1.8 6.2.2 8-2.3 2.2-3 2.9-7.1 4.1-11.9Z"/><path d="M5 20c2.7-4.6 6.3-7.7 10.8-10.1"/>`,
    hidratacion: `<path d="M12 3.1c3.4 4.3 5.6 7.1 5.6 10.2A5.6 5.6 0 0 1 12 18.9a5.6 5.6 0 0 1-5.6-5.6C6.4 10.2 8.6 7.4 12 3.1Z"/>`,
    limpieza: `<path d="M6.5 4.2 7.7 8l3.8 1.2-3.8 1.3-1.2 3.8-1.3-3.8-3.8-1.3L5.2 8l1.3-3.8Z"/><path d="M15.8 8.2 17 12l3.8 1.2L17 14.5l-1.2 3.8-1.3-3.8-3.8-1.3 3.8-1.2 1.3-3.8Z"/>`,
    solares: `<circle cx="12" cy="12" r="3.7"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>`,
    capilar: `<path d="M4 16.5c3.2.8 5.2-.8 5.5-4.1.3-3.2 2.1-5.3 5.4-6.1"/><path d="M9.5 12.4c1.5 2.4 3.8 3.6 7 3.6 1.7 0 2.8.9 2.8 2.2 0 1.4-1.3 2.3-3 2.3-3.7 0-6.2-1.4-7.8-4.1"/>`,
    antiedad: `<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.2 1.4 5.7 4 8.5-2.6 2.8-4 4.3-4 8.5M16 3.5c0 4.2-1.4 5.7-4 8.5 2.6 2.8 4 4.3 4 8.5"/>`,
    reparacion: `<path d="M9 3.5h6v5.5h5.5v6H15v5.5H9V15H3.5V9H9V3.5Z"/>`,
    nutricion: `<path d="M12.2 7.3c-2.3-2.2-6-1.4-7.3 1.3-1.8 3.7.8 10.8 4 12 1.4.5 2.1-.7 3.1-.7s1.7 1.2 3.1.7c3.2-1.2 5.8-8.3 4-12-1.3-2.7-5-3.5-6.9-1.3Z"/><path d="M12 7.2c-.4-2.3.8-4.1 3.2-4.8M12.2 5.2c-1.2-1.1-2.5-1.5-4-1.2"/>`,
    "cuidado-diario": `<path d="M12 20.5S4.5 16.2 4.5 9.7A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.6c0 6.5-7.5 10.8-7.5 10.8Z"/>`,
  };
  return `<svg class="v67-need-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[slug] || icons.Todas}</svg>`;
}

function waIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.1 4.9A9.86 9.86 0 0 0 12.06 2C6.59 2 2.13 6.42 2.13 11.89c0 1.75.46 3.45 1.34 4.94L2 22l5.32-1.39a9.96 9.96 0 0 0 4.74 1.2h.01c5.47 0 9.93-4.42 9.93-9.89a9.8 9.8 0 0 0-2.9-7.02Zm-7.04 15.24h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.16.82.84-3.08-.2-.32a8.2 8.2 0 0 1-1.28-4.33c0-4.54 3.72-8.24 8.29-8.24 2.21 0 4.3.86 5.87 2.42a8.18 8.18 0 0 1 2.42 5.83c0 4.55-3.72 8.24-8.24 8.24Zm4.53-6.18c-.25-.12-1.47-.73-1.7-.81-.23-.08-.39-.12-.56.12-.17.24-.64.81-.79.98-.15.17-.3.19-.55.06-.25-.12-1.07-.39-2.04-1.24-.75-.67-1.27-1.49-1.42-1.74-.15-.24-.02-.37.11-.49.11-.11.25-.29.37-.44.12-.14.16-.24.24-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.47-.4-.41-.56-.42h-.48c-.17 0-.44.06-.67.31-.23.24-.88.86-.88 2.11s.9 2.45 1.02 2.62c.12.17 1.77 2.7 4.29 3.79.6.26 1.07.41 1.44.52.61.19 1.17.16 1.61.1.49-.07 1.47-.6 1.68-1.19.21-.58.21-1.09.15-1.19-.06-.1-.23-.16-.48-.29Z"/></svg>`;
}

const u = (value: string) => `${BASE}${value}`;
const absolute = (origin: string, value: string) => new URL(u(value), origin).toString();
const wa = (message: string) => `https://wa.me/${W}?text=${encodeURIComponent(message)}`;
const e = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
