import {
  catalogV69Data,
  publicAvailabilityV69,
  type CatalogV69,
  type ProductV69,
  type PublicAvailabilityV69,
} from "./data-v69.js";
import type { ResponsiveImageSet } from "./data.js";

const BASE = (process.env.PUBLIC_BASE_PATH || "").replace(/\/$/, "");
const W = "5493417234000";
const SOCIAL_IMAGE = "https://farmagreenrosario.web.app/farmagreen-social-preview-v69-social-2.png";
const SOCIAL_DESCRIPTION = "Farmacia y Dermocosmetica, Catalogo de Precios y Promociones";
const HOME_ROUTE = "/";
const CATALOG_ROUTE = "/catalogo";
const PRODUCT_ROUTE = "/p/";
const BUSINESS_NAME = "Farmagreen Rosario";
const BUSINESS_ADDRESS = "Bv. Avellaneda Bis 524, Rosario, Santa Fe";
const INSTAGRAM_URL = "https://www.instagram.com/farmagreenrosario";
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const NEEDS = [
  { slug: "manchas", label: "Manchas" },
  { slug: "acne", label: "Acné" },
  { slug: "piel-sensible", label: "Piel sensible" },
  { slug: "hidratacion", label: "Hidratación" },
  { slug: "limpieza", label: "Limpieza" },
  { slug: "solares", label: "Solares" },
  { slug: "capilar", label: "Cabello" },
  { slug: "antiedad", label: "Antiedad" },
  { slug: "reparacion", label: "Reparación" },
  { slug: "nutricion", label: "Nutrición" },
  { slug: "cuidado-diario", label: "Cuidado diario" },
] as const;

const NEED_LABELS = new Map<string, string>(NEEDS.map((need) => [need.slug, need.label]));
const STOP_WORDS = new Set(["a", "al", "de", "del", "el", "la", "las", "los", "para", "por", "en", "un", "una", "unos", "unas", "y"]);
const SEARCH_MIN_CHARS = 3;
const SHORT_EXACT_SEARCH_TERMS = new Set(["ena", "lrp", "gel", "fps", "spf", "uv", "b5", "ha", "oil"]);
const SEARCH_ALIASES_V69 = new Map<string, string[]>([
  ["eucrin", ["eucerin"]],
  ["eucerim", ["eucerin"]],
  ["laroche", ["la roche posay"]],
  ["la roche", ["la roche posay"]],
  ["lrp", ["la roche posay"]],
  ["dermaglo", ["dermaglos"]],
  ["loreal", ["l oreal revitalift", "l oreal", "l oréal revitalift"]],
  ["cetafil", ["cetaphil"]],
  ["aveno", ["aveno", "aveeno"]],
  ["aveeno", ["aveeno", "aveno"]],
  ["ena", ["ena", "ena suplementos", "ena sport"]],
]);
type SearchConceptV69 = { exact?: string[]; stems?: string[]; targets: string[] };
const SEARCH_CONCEPTS_V69: SearchConceptV69[] = [
  { exact: ["marcas"], stems: ["cicatr", "estria"], targets: ["reparacion", "manchas", "cicatriz", "estrias"] },
  { stems: ["cuerp", "corpor"], targets: ["cuerpo", "corporal"] },
  { stems: ["cara", "faci", "rostr"], targets: ["cara", "facial", "rostro"] },
  {
    stems: ["arrug", "antiarrug", "antiedad", "antiage", "linea", "expresion", "flex", "elast", "firme", "flacid", "lifting", "envejec"],
    targets: ["antiedad", "antiarrugas", "arrugas", "lineas expresion", "firmeza", "elasticidad"],
  },
  { stems: ["manch", "pigment", "melasm"], targets: ["manchas", "antimanchas", "pigmentacion", "melasma"] },
  {
    stems: ["sec", "resec", "deshidra", "agriet", "agriat", "griet", "xerosis", "tirante", "asper", "descam"],
    targets: ["hidratacion", "reparacion", "sequedad"],
  },
  { stems: ["hidra", "humect", "moistur"], targets: ["hidratacion", "hidratante", "humectante"] },
  { stems: ["crem", "locion", "emulsion", "balsam", "pomad", "unguent"], targets: ["crema", "locion", "emulsion", "balsamo", "pomada", "unguento"] },
  { stems: ["serum", "suero", "concentr", "booster", "ampoll"], targets: ["serum", "suero", "concentrado", "booster", "ampolla"] },
  { stems: ["cabell", "pelo", "capilar"], targets: ["cabello", "pelo", "capilar"] },
  { stems: ["acne", "grano", "imperfec", "gras"], targets: ["acne", "granos", "imperfecciones", "piel grasa"] },
];
const SORTS_V69 = ["relevancia", "marca", "disponibilidad", "descuento", "precio-asc", "precio-desc", "nombre"] as const;
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
  barcode: string;
  magentoCategories: Array<{ id: string; name: string }>;
  listPrice: number;
  offerPrice: number;
  savingAmount: number;
  discountPercent: number;
  availability: PublicAvailabilityV69;
  availabilityCheckedAt: string | null;
  images: {
    card: string;
    detail: string;
    responsive?: {
      card?: ResponsiveImageSet;
      detail?: ResponsiveImageSet;
    };
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
  magentoCategoryPaths: Record<string, string[]>;
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
    magentoCategoryPaths: catalog.magentoCategoryPaths || {},
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
  return normalize(`${baseSearchTextV69(product)} ${magentoCategorySearchTextV69(product)}`);
}

function baseSearchTextV69(product: ProductV69) {
  const needs = safeList(product.needs);
  return normalize(
    [
      product.name,
      brandName(product),
      ...safeList(product.brand.aliases),
      product.line,
      product.barcode,
      ...safeList(product.aliases),
      product.primaryCategory,
      ...needs,
      ...needs.map((need) => NEED_LABELS.get(need) || need),
      ...derivedSearchSignalsV69(product),
    ].join(" "),
  );
}

function magentoCategorySearchTextV69(product: ProductV69) {
  return normalize((product.magentoCategories || []).flatMap((category) => [category.id, category.name]).join(" "));
}

function semanticSearchTextV69(product: ProductV69) {
  const needs = safeList(product.needs);
  return normalize(
    [
      product.name,
      product.line,
      product.primaryCategory,
      ...needs,
      ...needs.map((need) => NEED_LABELS.get(need) || need),
      ...derivedSearchSignalsV69(product),
    ].join(" "),
  );
}

function derivedSearchSignalsV69(product: ProductV69) {
  const name = normalize(product.name);
  const signals: string[] = [];
  if (/\b(piel (muy )?(seca|reseca|resecada|agrietada)|labios? (secos?|agrietados?)|manos? (secas?|agrietadas?))\b/.test(name)) {
    signals.push("sequedad");
  }
  if (
    safeList(product.needs).includes("nutricion") &&
    /\b\d+(?:[.,]\d+)?\s*(g|gr|grs|kg)\b/.test(name) &&
    !/(caps|capsula|comprim|tableta|sobre|gomita|unidad)/.test(name)
  ) {
    signals.push("polvo");
  }
  return signals;
}

type CatalogPageOptionsV69 = {
  route?: string;
  canonicalPath?: string;
};

export function catalogPageV69(
  catalog: CatalogV69,
  query = new URLSearchParams(),
  origin = "http://127.0.0.1:8109",
  options: CatalogPageOptionsV69 = {},
) {
  const route = options.route || CATALOG_ROUTE;
  const canonicalPath = options.canonicalPath || CATALOG_ROUTE;
  const context = pageContext(catalog, query);
  const initial = filteredProducts(catalog.products, context);
  const initialAvailability = availabilitySummaryV69(initial);

  return shell69(
    context.metaTitle,
    context.metaDescription,
    `
${discoveryPanelV69(catalog, context, initial.length, route)}

<section class="v65-products" id="productos-v69">
  <div class="v65-head v66-catalog-head">
    <div>
      <p class="v65-k" id="modeV69"${context.mode ? "" : " hidden"}>${e(context.mode)}</p>
      <h1 id="catalogTitleV69"${context.title === "Todos los productos" ? ' class="v69-title-all"' : context.title === "Oportunidades de hoy" ? ' class="v69-title-compact"' : ""}>${e(context.title)}</h1>
      <p class="v66-context" id="contextV69" hidden>${e(context.copy)}</p>
      <p class="v69-availability-summary" id="availabilityV69" hidden>${availabilitySummaryTextV69(initialAvailability.available, initialAvailability.unavailable, initialAvailability.unverified)}</p>
      <p class="v69-availability-note" id="availabilityNoteV69" hidden>${catalog.commerceSyncedAt ? `Estado comercial en Rosario verificado ${e(shortDateV69(catalog.commerceSyncedAt))}. Confirmamos disponibilidad por WhatsApp.` : catalog.availabilityReferenceAt ? `Verificación parcial en Rosario actualizada ${e(shortDateV69(catalog.availabilityReferenceAt))}. Confirmamos disponibilidad por WhatsApp.` : "Estado comercial en Rosario pendiente de sincronización. Confirmamos disponibilidad por WhatsApp."}</p>
    </div>
    <div class="v66-catalog-tools">
      <p id="countV69" aria-live="polite">${Math.min(48, initial.length)} de ${initial.length}</p>
      <button class="v65-link-button" type="button" id="showAllV69">Ver todo el catálogo</button>
    </div>
  </div>
  <section class="v65-grid" id="gridV69">${initial.slice(0, 48).map((product, index) => cardV69(product, origin, index === 0)).join("")}</section>
  <div class="morebox"><button id="loadMoreV69" type="button" aria-label="Cargar más productos">Cargar más productos</button></div>
</section>

<script type="application/json" id="fg69-data">${json({
      base: BASE,
      origin,
      catalogRoute: route,
      commerceSyncedAt: catalog.commerceSyncedAt,
      availabilityReferenceAt: catalog.availabilityReferenceAt,
      dataEndpoint: "/api/catalog-v6-9",
      magentoCategoryPaths: catalog.magentoCategoryPaths || {},
      totalProducts: catalog.totalProducts,
      context: context.state,
    })}</script>`,
    {
      bodyClass: "v65 v66 v67 v69",
      origin,
      canonicalPath,
      ogType: "website",
      ogImage: context.ogImage,
      homeHref: HOME_ROUTE,
      links: [
        { href: `${route}#productos-v69`, label: "Ofertas", nav: "ofertas" },
        { href: `${route}#marcas-v69`, label: "Marcas", nav: "marcas" },
        { href: `${route}#buscar-v69`, label: "Buscar", nav: "buscar" },
        { href: `${route}?scope=todo#productos-v69`, label: "Productos", nav: "productos" },
      ],
    },
  );
}

function discoveryPanelV69(
  catalog: CatalogV69,
  context: ReturnType<typeof pageContext>,
  resultCount: number,
  route = CATALOG_ROUTE,
) {
  const brands = [...new Set(catalog.products.map(brandName))];
  const offers = dealProducts(catalog.products);
  const brandStats = brands.map((brand) => ({
    brand,
    count: catalog.products.filter((product) => brandName(product) === brand).length,
    best: offers.find((product) => brandName(product) === brand)?.discountPercent || 0,
  }));
  const initialNeedLabel = context.need === "Todas" ? "Todas" : NEED_LABELS.get(context.need) || "Todas";
  const initialBrandLabel = context.brand;

  return `<section class="v65-panel v65-search-panel v65-top-search v67-discovery" id="buscar-v69">
    <div class="v67-primary-row">
      <div class="v67-title"><p class="v65-k">Encontrá tu producto</p><h2><span>Buscá</span> <span>como</span> <span>hablás</span></h2></div>
      <form class="v66-search v67-search" role="search" action="${u(route)}" method="get">
        <label class="v67-visually-hidden" for="searchV69">Producto, marca o necesidad</label>
        <span class="v67-search-icon">${searchIcon()}</span>
        <input id="searchV69" name="q" type="search" placeholder="Producto, marca o necesidad" autocomplete="off" spellcheck="false">
        <input type="hidden" name="scope" value="todo">
      </form>
      <button class="v65-link-button" id="clearFiltersV69" type="button">Limpiar</button>
    </div>
    <div class="v67-filter-grid" role="group" aria-label="Filtros del catálogo">
      <div class="v67-filter-menu v67-need-menu" data-filter-menu="need">
        <button class="v67-menu-trigger" type="button" data-filter-menu-trigger="need" aria-expanded="false" aria-controls="needMenuV69" aria-haspopup="dialog">
          <span class="v67-menu-label">¿Qué necesitás?</span>
          <strong id="needSummaryV69">${e(initialNeedLabel)}</strong>
          ${chevronIcon()}
        </button>
        <div class="v67-menu-popover v67-need-popover" id="needMenuV69" data-filter-menu-popover aria-hidden="true" aria-label="Elegir necesidad" role="dialog" inert>
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
        <button class="v67-menu-trigger" type="button" data-filter-menu-trigger="brand" aria-expanded="false" aria-controls="brandMenuV69" aria-haspopup="dialog">
          <span class="v67-menu-label">Elegir Marca</span>
          <strong id="brandSummaryV69">${e(initialBrandLabel)}</strong>
          ${chevronIcon()}
        </button>
        <div class="v67-menu-popover v67-brand-popover" id="brandMenuV69" data-filter-menu-popover aria-hidden="true" aria-label="Elegir marca" role="dialog" inert>
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
          <option value="marca"${context.sort === "marca" ? " selected" : ""}>Marca</option>
          <option value="disponibilidad"${context.sort === "disponibilidad" ? " selected" : ""}>Disponibilidad</option>
          <option value="descuento"${context.sort === "descuento" ? " selected" : ""}>Descuento</option>
          <option value="precio-asc"${context.sort === "precio-asc" ? " selected" : ""}>Menor precio</option>
          <option value="precio-desc"${context.sort === "precio-desc" ? " selected" : ""}>Mayor precio</option>
          <option value="nombre"${context.sort === "nombre" ? " selected" : ""}>Nombre A–Z</option>
        </select>
        ${chevronIcon()}
      </label>
    </div>
  </section>`;
}

export function homePageV69(catalog: CatalogV69, origin = "http://127.0.0.1:8109") {
  const brands = [...new Set(catalog.products.map(brandName))];
  const homeContext = pageContext(catalog, new URLSearchParams({ scope: "todo" }));
  const sections = brands
    .map((brand, brandIndex) => {
      const products = sortProductsV69(
        catalog.products.filter((product) => brandName(product) === brand),
        "disponibilidad",
      );
      const sectionId = `marca-${brandSlug(products[0])}`;
      const brandHref = `${CATALOG_ROUTE}?scope=todo&marca=${encodeURIComponent(brand)}#productos-v69`;
      return `<section class="v69-home-brand" id="${e(sectionId)}" aria-labelledby="${e(`${sectionId}-title`)}">
        <div class="v69-home-brand-head">
          <div><p class="v65-k">Marca</p><h2 id="${e(`${sectionId}-title`)}">${e(brand)}</h2></div>
          <div class="v69-home-brand-actions"><span>${products.length} productos</span><a href="${u(brandHref)}">Ver toda la marca</a></div>
        </div>
        <div class="v65-grid v69-home-grid">${products.slice(0, 10).map((product, productIndex) => cardV69(product, origin, brandIndex === 0 && productIndex === 0)).join("")}</div>
      </section>`;
    })
    .join("");

  return shell69(
    "Farmagreen Rosario | Marcas y productos",
    SOCIAL_DESCRIPTION,
    `<h1 class="v67-visually-hidden">Farmagreen Rosario: catálogo de precios y promociones</h1>
    ${discoveryPanelV69(catalog, homeContext, catalog.totalProducts)}
    <div class="v69-home-sections" id="marcas-inicio-v69">${sections}</div>
    <script type="application/ld+json">${json(pharmacySchemaV69(origin))}</script>
    <script type="application/json" id="fg69-data">${json({
      base: BASE,
      origin,
      page: "home",
      totalProducts: catalog.totalProducts,
      context: homeContext.state,
    })}</script>`,
    {
      bodyClass: "v65 v66 v67 v69 v69-home",
      origin,
      canonicalPath: HOME_ROUTE,
      ogType: "website",
      ogImage: SOCIAL_IMAGE,
      ogImageType: "image/png",
      ogImageWidth: 1200,
      ogImageHeight: 630,
      ogImageAlt: `Farmagreen Rosario. ${SOCIAL_DESCRIPTION}.`,
      homeHref: HOME_ROUTE,
      links: [
        { href: `${CATALOG_ROUTE}#productos-v69`, label: "Ofertas" },
        { href: `${HOME_ROUTE}#marcas-inicio-v69`, label: "Marcas", active: true },
        { href: `${CATALOG_ROUTE}#buscar-v69`, label: "Buscar" },
        { href: `${CATALOG_ROUTE}?scope=todo#productos-v69`, label: "Productos" },
      ],
    },
  );
}

export function productPageV69(product: ProductV69, related: ProductV69[], origin = "http://127.0.0.1:8109") {
  const discount = Math.round(product.discountPercent || 0);
  const needsAvailabilityConsult = product.availability !== "limited";
  const productPath = publicProductPathV69(product);
  const productUrl = absolute(origin, productPath);
  return shell69(
    `${product.name} | Farmagreen Rosario`,
    product.description.slice(0, 155),
    `
<nav class="crumb v65-crumb v69-pdp-crumb">
  <a href="${u(`${CATALOG_ROUTE}#productos-v69`)}">Volver al catálogo</a>
  <span>/</span>
  <a class="v69-crumb-context" href="${u(`${HOME_ROUTE}?scope=todo&marca=${encodeURIComponent(brandName(product))}#productos-v69`)}">${e(brandName(product))}</a>
</nav>
<article class="pdp v65-pdp v66-pdp">
  <div class="v66-card-top v67-pdp-card-top">
    <p class="v66-brand">${e(brandName(product))}</p>
    ${discount > 0 ? `<span class="v66-discount">-${discount}%</span>` : ""}
  </div>
  ${productImage(product, "detail", "photo v65-photo", true)}
  <div class="buybox v65-buybox">
    <h1>${e(product.name)}</h1>
    <p class="v65-meta">${e(product.line)} · ${e(categoryLabel(product.primaryCategory))}</p>
    ${stockBadgeV69(product, true)}
    <dl class="v66-pdp-facts">
      <div><dt>Presentación</dt><dd>${e(presentation(product))}</dd></div>
      <div><dt>Uso</dt><dd>${e(usage(product))}</dd></div>
    </dl>
    ${product.barcode ? `<p class="v69-barcode"><span>Código de barras</span><strong>${e(product.barcode)}</strong></p>` : ""}
    ${priceDetail(product)}
    <a class="cta${needsAvailabilityConsult ? " v69-ask-unavailable" : ""}" href="${wa(`Hola Farmagreen Rosario, quiero consultar por ${brandName(product)} - ${product.name}. Link: ${productUrl}`)}">${product.availability === "limited" ? "Consultar este producto por WhatsApp" : "Consultar"}</a>
    <ul class="v65-service-list">
      <li>Consulta Personalizada por WhatsApp.</li>
      <li>Coordinamos Retiro o Envío, Consultar formas de Pago.</li>
    </ul>
    ${productDetail(product)}
  </div>
</article>
<section class="v65-products v65-related">
  <div class="v65-head"><div><p class="v65-k">Similares</p><h2>También puede servirte</h2></div><p>Misma marca, categoría o necesidad.</p></div>
  <section class="v65-grid">${related.map((item) => cardV69(item, origin)).join("")}</section>
</section>
<script type="application/ld+json">${json(productSchemaV69(product, productUrl, origin))}</script>`,
    {
      bodyClass: "v65 v66 v67 v69 product-detail",
      origin,
      canonicalPath: productPath,
      ogType: "product",
      ogImage: safeImage(product, "detail"),
      homeHref: HOME_ROUTE,
      links: [{ href: "#", label: "Volver", historyBack: true }],
    },
  );
}

export function notFoundPageV69(origin = "http://127.0.0.1:8109") {
  return shell69(
    "No encontrado | Farmagreen Rosario",
    "Producto no encontrado",
    `<section class="empty"><h1>No encontramos ese producto</h1><a href="${u(CATALOG_ROUTE)}">Volver al catálogo</a></section>`,
    { bodyClass: "v65 v66 v67 v69", origin, homeHref: HOME_ROUTE },
  );
}

export function robotsTxtV69(origin: string) {
  const base = new URL(origin).origin;
  return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
}

export function sitemapXmlV69(catalog: CatalogV69, origin: string) {
  const base = new URL(origin).origin;
  const lastmod = sitemapLastmodV69(catalog);
  const urls = [
    absolute(base, HOME_ROUTE),
    absolute(base, CATALOG_ROUTE),
    ...catalog.products.map((product) => absolute(base, publicProductPathV69(product))),
  ];
  const entries = urls
    .map((url) => `<url><loc>${xml(url)}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
}

export function sitemapLastmodV69(catalog: Pick<CatalogV69, "commerceSyncedAt" | "syncedAt">) {
  const value = catalog.commerceSyncedAt || catalog.syncedAt;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function productSchemaV69(product: ProductV69, productUrl: string, origin: string) {
  const gtin = validGtinV69(product.barcode);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": `${productUrl}#product`,
        name: product.name,
        image: new URL(safeImage(product, "detail"), origin).toString(),
        description: product.description,
        url: productUrl,
        category: categoryLabel(product.primaryCategory),
        brand: { "@type": "Brand", name: brandName(product) },
        ...(gtin ? { [gtin.key]: gtin.value } : {}),
        offers: {
          "@type": "Offer",
          url: productUrl,
          priceCurrency: "ARS",
          price: product.offerPrice || product.listPrice,
          availability: schemaAvailabilityV69(product),
          itemCondition: "https://schema.org/NewCondition",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Inicio", item: absolute(origin, HOME_ROUTE) },
          { "@type": "ListItem", position: 2, name: "Catálogo", item: absolute(origin, CATALOG_ROUTE) },
          { "@type": "ListItem", position: 3, name: product.name, item: productUrl },
        ],
      },
    ],
  };
}

function schemaAvailabilityV69(product: ProductV69) {
  if (product.availability === "limited") return "https://schema.org/InStock";
  if (product.availability === "out_of_stock") return "https://schema.org/OutOfStock";
  return "https://schema.org/LimitedAvailability";
}

export function validGtinV69(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }
  if ((10 - (sum % 10)) % 10 !== Number(digits.at(-1))) return null;
  return { key: `gtin${digits.length}`, value: digits };
}

function pharmacySchemaV69(origin: string) {
  const url = absolute(origin, HOME_ROUTE);
  return {
    "@context": "https://schema.org",
    "@type": "Pharmacy",
    "@id": `${url}#pharmacy`,
    name: BUSINESS_NAME,
    description: SOCIAL_DESCRIPTION,
    url,
    logo: absolute(origin, "/logo_farmagreen.png"),
    telephone: "+54 9 341 723-4000",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Bv. Avellaneda Bis 524",
      addressLocality: "Rosario",
      addressRegion: "Santa Fe",
      addressCountry: "AR",
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      telephone: "+54 9 341 723-4000",
      availableLanguage: "Spanish",
    },
    sameAs: [INSTAGRAM_URL],
  };
}

function footerV69() {
  return `<footer class="v69-footer" aria-label="Información de Farmagreen Rosario"><div class="v69-footer-business"><strong>${BUSINESS_NAME}</strong><span>${BUSINESS_ADDRESS}</span></div><a class="v69-footer-instagram" href="${INSTAGRAM_URL}" target="_blank" rel="noopener noreferrer" aria-label="Instagram de Farmagreen Rosario">${instagramIcon()}<span>@farmagreenrosario</span></a><div class="v69-footer-contact"><span>Horarios: consultá por WhatsApp</span><a href="${wa("Hola Farmagreen Rosario, quiero consultar horarios y disponibilidad.")}">WhatsApp +54 9 341 723-4000</a></div></footer>`;
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
  const requestedQuery = String(query.get("q") || "").trim();
  const q = isSearchQueryReadyV69(requestedQuery) ? requestedQuery : "";
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
    const categoryPath = exactCategoryPathV69(catalog, q);
    mode = categoryPath ? "" : "Resultados";
    title = categoryPath || `Resultados para “${q}”`;
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

function exactCategoryPathV69(catalog: CatalogV69, query: string) {
  if (!/^\d+$/.test(query)) return "";
  const path = catalog.magentoCategoryPaths?.[query];
  return Array.isArray(path) && path.length ? path.join(" › ") : "";
}

export function normalizeQueryTermsV69(value: string) {
  const terms = normalize(value)
    .split(" ")
    .filter((term) => term && !isSearchStopWordLikeV69(term))
    .filter(
      (term) =>
        term.length >= SEARCH_MIN_CHARS ||
        SHORT_EXACT_SEARCH_TERMS.has(term) ||
        /^\d+$/.test(term),
    );
  if (!terms.length) return [];
  const first = terms[0];
  if (first.length < SEARCH_MIN_CHARS && !SHORT_EXACT_SEARCH_TERMS.has(first) && !/^\d{8,14}$/.test(first)) return [];
  return terms;
}

export function isSearchQueryReadyV69(value: string) {
  return normalizeQueryTermsV69(value).length > 0;
}

function levenshteinV69(left: string, right: string) {
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
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}

function isSearchStopWordLikeV69(term: string) {
  if (SHORT_EXACT_SEARCH_TERMS.has(term) || /^\d+$/.test(term)) return false;
  if (STOP_WORDS.has(term)) return true;
  if (directConceptIndexesV69(term).length) return false;
  if (term.length < SEARCH_MIN_CHARS) return false;
  return [...STOP_WORDS].some(
    (stopWord) =>
      stopWord.length >= SEARCH_MIN_CHARS &&
      (stopWord.startsWith(term) ||
        (Math.abs(stopWord.length - term.length) <= 1 && levenshteinV69(stopWord, term) <= 1)),
  );
}

function directConceptIndexesV69(rawTerm: string) {
  const term = normalize(rawTerm);
  if (!term) return [];
  return SEARCH_CONCEPTS_V69.flatMap((concept, index) =>
    safeList(concept.exact).includes(term) ||
    safeList(concept.stems).some(
      (stem) => term.startsWith(stem) || (term.length >= SEARCH_MIN_CHARS && stem.startsWith(term)),
    )
      ? [index]
      : [],
  );
}

function searchDistanceLimitV69(term: string) {
  if (term.length < 4) return 0;
  return term.length > 7 ? 2 : 1;
}

function fuzzyConceptIndexesV69(rawTerm: string) {
  const term = normalize(rawTerm);
  const limit = searchDistanceLimitV69(term);
  if (!limit) return [];
  let bestDistance = limit + 1;
  const bestIndexes = new Set<number>();
  SEARCH_CONCEPTS_V69.forEach((concept, index) => {
    const lexemes = [
      ...safeList(concept.exact),
      ...safeList(concept.stems),
      ...concept.targets.flatMap((target) => normalize(target).split(" ")),
    ]
      .map(normalize)
      .filter((lexeme) => lexeme.length >= SEARCH_MIN_CHARS && Math.abs(lexeme.length - term.length) <= limit);
    for (const lexeme of lexemes) {
      const distance = levenshteinV69(lexeme, term);
      if (distance > limit || distance > bestDistance) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndexes.clear();
      }
      bestIndexes.add(index);
    }
  });
  if (bestIndexes.size <= 1) return [...bestIndexes];
  const fingerprints = new Set(
    [...bestIndexes].map((index) => SEARCH_CONCEPTS_V69[index].targets.map(normalize).sort().join("|")),
  );
  return fingerprints.size === 1 ? [...bestIndexes] : [];
}

type SearchIndexV69 = {
  allIds: Set<string>;
  lexicalTextById: Map<string, string>;
  magentoCategoryTextById: Map<string, string>;
  semanticTextById: Map<string, string>;
  vocabulary: Map<string, Set<string>>;
  magentoCategoryVocabulary: Map<string, Set<string>>;
  exactMagentoCategoryPhrases: Map<string, Set<string>>;
};

export type SearchPlanV69 = {
  terms: string[];
  clauses: Array<{
    term: string;
    kind: "concept" | "lexical" | "unresolved";
    targets: string[];
    productIds: Set<string>;
  }>;
  productIds: Set<string>;
};

const SEARCH_INDEX_CACHE_V69 = new WeakMap<ProductV69[], SearchIndexV69>();

function searchIndexV69(products: ProductV69[]) {
  const cached = SEARCH_INDEX_CACHE_V69.get(products);
  if (cached) return cached;
  const index: SearchIndexV69 = {
    allIds: new Set(),
    lexicalTextById: new Map(),
    magentoCategoryTextById: new Map(),
    semanticTextById: new Map(),
    vocabulary: new Map(),
    magentoCategoryVocabulary: new Map(),
    exactMagentoCategoryPhrases: new Map(),
  };
  for (const product of products) {
    const id = product.publicId;
    const lexicalText = baseSearchTextV69(product);
    const magentoCategoryText = magentoCategorySearchTextV69(product);
    index.allIds.add(id);
    index.lexicalTextById.set(id, lexicalText);
    index.magentoCategoryTextById.set(id, magentoCategoryText);
    index.semanticTextById.set(id, semanticSearchTextV69(product));
    for (const word of new Set(lexicalText.split(" ").filter(Boolean))) {
      if (word.length < SEARCH_MIN_CHARS && !/^\d+$/.test(word)) continue;
      const ids = index.vocabulary.get(word) || new Set<string>();
      ids.add(id);
      index.vocabulary.set(word, ids);
    }
    for (const word of new Set(magentoCategoryText.split(" ").filter(Boolean))) {
      if (word.length < SEARCH_MIN_CHARS && !/^\d+$/.test(word)) continue;
      const ids = index.magentoCategoryVocabulary.get(word) || new Set<string>();
      ids.add(id);
      index.magentoCategoryVocabulary.set(word, ids);
    }
    for (const category of product.magentoCategories || []) {
      const phrase = normalizeQueryTermsV69(category.name).join(" ");
      if (!phrase.includes(" ")) continue;
      const ids = index.exactMagentoCategoryPhrases.get(phrase) || new Set<string>();
      ids.add(id);
      index.exactMagentoCategoryPhrases.set(phrase, ids);
    }
  }
  SEARCH_INDEX_CACHE_V69.set(products, index);
  return index;
}

function directMagentoCategoryIdsV69(index: SearchIndexV69, rawTerm: string) {
  const term = normalize(rawTerm);
  const result = new Set<string>();
  for (const [word, ids] of index.magentoCategoryVocabulary) {
    const matches = /^\d+$/.test(term)
      ? word === term
      : term.length === SEARCH_MIN_CHARS
        ? word.startsWith(term)
        : word === term || word.startsWith(term);
    if (matches) unionIdsV69(result, ids);
  }
  return result;
}

function unionIdsV69(target: Set<string>, source?: Set<string>) {
  for (const id of source || []) target.add(id);
  return target;
}

function directLexicalIdsV69(index: SearchIndexV69, rawTerm: string) {
  const term = normalize(rawTerm);
  const result = new Set<string>();
  for (const alias of SEARCH_ALIASES_V69.get(term) || []) {
    const target = normalize(alias);
    for (const [id, text] of index.lexicalTextById) if (text.includes(target)) result.add(id);
  }
  for (const [word, ids] of index.vocabulary) {
    const matches = /^\d+$/.test(term)
      ? word === term
      : term.length === SEARCH_MIN_CHARS
        ? word.startsWith(term)
        : word === term || word.startsWith(term);
    if (matches) unionIdsV69(result, ids);
  }
  return result;
}

function fuzzyLexicalIdsV69(index: SearchIndexV69, rawTerm: string) {
  const term = normalize(rawTerm);
  const limit = searchDistanceLimitV69(term);
  if (!limit || /^\d+$/.test(term)) return new Set<string>();
  let bestDistance = limit + 1;
  let candidates: string[] = [];
  for (const word of index.vocabulary.keys()) {
    if (word.length < 4 || Math.abs(word.length - term.length) > limit) continue;
    const distance = levenshteinV69(word, term);
    if (distance > limit || distance > bestDistance) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      candidates = [];
    }
    candidates.push(word);
  }
  if (!candidates.length) return new Set<string>();
  const families = new Set(candidates.map((word) => word.slice(0, SEARCH_MIN_CHARS)));
  if (families.size > 1) return new Set<string>();
  return candidates.reduce((ids, word) => unionIdsV69(ids, index.vocabulary.get(word)), new Set<string>());
}

function semanticTextMatchesTargetV69(text: string, rawTarget: string) {
  const target = normalize(rawTarget);
  if (!target) return false;
  if (target.includes(" ")) return text.includes(target);
  return text.split(" ").some((word) => word === target || word.startsWith(target));
}

function conceptIdsV69(index: SearchIndexV69, conceptIndexes: number[]) {
  const targets = conceptTargetsV69(conceptIndexes);
  const ids = new Set<string>();
  for (const [id, text] of index.semanticTextById) {
    if (targets.some((target) => semanticTextMatchesTargetV69(text, target))) ids.add(id);
  }
  return ids;
}

function conceptTargetsV69(conceptIndexes: number[]) {
  return [
    ...new Set(conceptIndexes.flatMap((conceptIndex) => SEARCH_CONCEPTS_V69[conceptIndex].targets.map(normalize))),
  ];
}

function lexicalTargetsV69(term: string) {
  return [...new Set([normalize(term), ...(SEARCH_ALIASES_V69.get(normalize(term)) || []).map(normalize)])];
}

function searchClauseV69(index: SearchIndexV69, term: string) {
  const directConcepts = directConceptIndexesV69(term);
  if (directConcepts.length) {
    return {
      term,
      kind: "concept" as const,
      targets: conceptTargetsV69(directConcepts),
      productIds: conceptIdsV69(index, directConcepts),
    };
  }
  const directLexical = directLexicalIdsV69(index, term);
  if (directLexical.size) return { term, kind: "lexical" as const, targets: lexicalTargetsV69(term), productIds: directLexical };
  const fuzzyConcepts = fuzzyConceptIndexesV69(term);
  if (fuzzyConcepts.length) {
    return {
      term,
      kind: "concept" as const,
      targets: conceptTargetsV69(fuzzyConcepts),
      productIds: conceptIdsV69(index, fuzzyConcepts),
    };
  }
  const fuzzyLexical = fuzzyLexicalIdsV69(index, term);
  if (fuzzyLexical.size) return { term, kind: "lexical" as const, targets: [normalize(term)], productIds: fuzzyLexical };
  const directCategory = directMagentoCategoryIdsV69(index, term);
  if (directCategory.size) return { term, kind: "lexical" as const, targets: [normalize(term)], productIds: directCategory };
  return { term, kind: "unresolved" as const, targets: [normalize(term)], productIds: new Set<string>() };
}

export function compileSearchPlanV69(products: ProductV69[], query: string): SearchPlanV69 {
  const terms = normalizeQueryTermsV69(query);
  const index = searchIndexV69(products);
  const clauses = terms.map((term) => searchClauseV69(index, term));
  let productIds = new Set(index.allIds);
  for (const clause of clauses) {
    productIds = new Set([...productIds].filter((id) => clause.productIds.has(id)));
    if (!productIds.size) break;
  }
  const categoryPhraseEligible = terms.every(
    (term) => !directConceptIndexesV69(term).length && !fuzzyConceptIndexesV69(term).length,
  );
  const exactCategoryIds = categoryPhraseEligible
    ? index.exactMagentoCategoryPhrases.get(terms.join(" "))
    : undefined;
  if (exactCategoryIds) productIds = unionIdsV69(productIds, exactCategoryIds);
  return { terms, clauses, productIds: terms.length ? productIds : new Set<string>() };
}

export function filterProductsBySearchV69(products: ProductV69[], query: string) {
  if (!normalize(query)) return [...products];
  const plan = compileSearchPlanV69(products, query);
  if (!plan.terms.length) return [];
  return products.filter((product) => plan.productIds.has(product.publicId));
}

export function matchesSearchQueryV69(product: ProductV69, query: string, products: ProductV69[] = [product]) {
  return compileSearchPlanV69(products, query).productIds.has(product.publicId);
}

function filteredProducts(products: ProductV69[], state: QueryState) {
  const searchIds = new Set(filterProductsBySearchV69(products, state.q).map((product) => product.publicId));
  const hasQuery = Boolean(normalize(state.q));
  const filtered = products
    .filter((product) => state.scope !== "ofertas" || product.discountPercent > 0)
    .filter((product) => state.brand === "Todas" || brandName(product) === state.brand)
    .filter((product) => state.need === "Todas" || safeList(product.needs).includes(state.need))
    .filter((product) => !hasQuery || searchIds.has(product.publicId));
  return sortProductsV69(filtered, state.sort, state.q);
}

type SearchClauseV69 = SearchPlanV69["clauses"][number];

function textMatchesSearchTargetV69(text: string, rawTarget: string) {
  const target = normalize(rawTarget);
  if (!target) return false;
  if (target.includes(" ")) return text.includes(target);
  return text.split(" ").some((word) => word === target || word.startsWith(target));
}

function clauseMatchCountV69(text: string, clauses: SearchClauseV69[]) {
  return clauses.filter((clause) => clause.targets.some((target) => textMatchesSearchTargetV69(text, target))).length;
}

function phraseMatchV69(text: string, phrase: string) {
  return phrase ? Number(text.includes(phrase)) : 0;
}

export function searchRelevanceV69(product: ProductV69, plan: SearchPlanV69) {
  const fullQuery = plan.terms.join(" ");
  const needs = safeList(product.needs);
  const fields = {
    magentoCategoryIds: normalize((product.magentoCategories || []).map((category) => category.id).join(" ")),
    magentoCategories: normalize((product.magentoCategories || []).map((category) => category.name).join(" ")),
    functional: normalize([product.primaryCategory, ...needs, ...needs.map((need) => NEED_LABELS.get(need) || need)].join(" ")),
    name: normalize(product.name),
    brand: normalize([brandName(product), ...safeList(product.brand.aliases)].join(" ")),
    line: normalize(product.line),
    aliases: normalize(safeList(product.aliases).join(" ")),
  };
  return [
    Number(/^\d{8,14}$/.test(fullQuery) && normalize(String(product.barcode || "")) === fullQuery),
    Number(/^\d+$/.test(fullQuery) && fields.magentoCategoryIds.split(" ").includes(fullQuery)),
    phraseMatchV69(fields.functional, fullQuery),
    clauseMatchCountV69(fields.functional, plan.clauses),
    phraseMatchV69(fields.name, fullQuery),
    clauseMatchCountV69(fields.name, plan.clauses),
    phraseMatchV69(fields.brand, fullQuery),
    clauseMatchCountV69(fields.brand, plan.clauses),
    phraseMatchV69(fields.line, fullQuery),
    clauseMatchCountV69(fields.line, plan.clauses),
    phraseMatchV69(fields.aliases, fullQuery),
    clauseMatchCountV69(fields.aliases, plan.clauses),
    phraseMatchV69(fields.magentoCategories, fullQuery),
    clauseMatchCountV69(fields.magentoCategories, plan.clauses),
  ];
}

function compareRelevanceV69(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] || 0) - (left[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function sortProductsV69(products: ProductV69[], sort: SortV69, query = "") {
  const copy = [...products];
  const tie = (left: ProductV69, right: ProductV69) =>
    String(left.name || "").localeCompare(String(right.name || ""), "es") ||
    String(left.publicId || "").localeCompare(String(right.publicId || ""), "es");
  if (sort === "disponibilidad") {
    const availabilityRank = (product: ProductV69) => product.availability === "limited" ? 0 : product.availability === "unknown" ? 1 : 2;
    return copy.sort(
      (left, right) =>
        availabilityRank(left) - availabilityRank(right) ||
        (right.discountPercent || 0) - (left.discountPercent || 0) ||
        (right.savingAmount || 0) - (left.savingAmount || 0) ||
        tie(left, right),
    );
  }
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
  if (sort === "marca") {
    return copy.sort(
      (left, right) =>
        brandName(left).localeCompare(brandName(right), "es", { sensitivity: "base" }) ||
        tie(left, right),
    );
  }
  if (sort === "nombre") return copy.sort(tie);
  const plan = compileSearchPlanV69(copy, query);
  const entries = copy.map((product) => ({ product, relevance: searchRelevanceV69(product, plan) }));
  entries.sort(
    (left, right) =>
      compareRelevanceV69(left.relevance, right.relevance) ||
      (right.product.discountPercent || 0) - (left.product.discountPercent || 0) ||
      (right.product.savingAmount || 0) - (left.product.savingAmount || 0) ||
      tie(left.product, right.product),
  );
  return entries.map((entry) => entry.product);
}

function currentPriceV69(product: ProductV69) {
  return Math.round(Number(product.offerPrice || product.listPrice || 0));
}

type ShellLink = { href: string; label: string; nav?: string; historyBack?: boolean; active?: boolean };
type ShellOptions = {
  homeHref?: string;
  links?: ShellLink[];
  bodyClass?: string;
  origin?: string;
  canonicalPath?: string;
  ogType?: string;
  ogImage?: string;
  ogImageType?: string;
  ogImageWidth?: number;
  ogImageHeight?: number;
  ogImageAlt?: string;
};

function shell69(title: string, description: string, body: string, options: ShellOptions = {}) {
  const homeHref = options.homeHref || HOME_ROUTE;
  const links = options.links || [];
  const canonicalUrl = options.canonicalPath ? absolute(options.origin || "http://127.0.0.1:8109", options.canonicalPath) : "";
  const canonical = canonicalUrl ? `<link rel="canonical" href="${e(canonicalUrl)}">` : "";
  const ogImage = options.ogImage ? new URL(options.ogImage, options.origin || "http://127.0.0.1:8109").toString() : "";
  const ogImageMeta = ogImage
    ? `<meta property="og:image" content="${e(ogImage)}">${ogImage.startsWith("https://") ? `<meta property="og:image:secure_url" content="${e(ogImage)}">` : ""}${options.ogImageType ? `<meta property="og:image:type" content="${e(options.ogImageType)}">` : ""}${options.ogImageWidth ? `<meta property="og:image:width" content="${options.ogImageWidth}">` : ""}${options.ogImageHeight ? `<meta property="og:image:height" content="${options.ogImageHeight}">` : ""}${options.ogImageAlt ? `<meta property="og:image:alt" content="${e(options.ogImageAlt)}">` : ""}`
    : "";
  const og = `<meta property="og:type" content="${e(options.ogType || "website")}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:site_name" content="Farmagreen Rosario"><meta property="og:locale" content="es_AR">${canonicalUrl ? `<meta property="og:url" content="${e(canonicalUrl)}">` : ""}${ogImageMeta}<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">${ogImage ? `<meta name="twitter:image" content="${e(ogImage)}">` : ""}${options.ogImageAlt ? `<meta name="twitter:image:alt" content="${e(options.ogImageAlt)}">` : ""}`;
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><title>${e(title)}</title><meta name="description" content="${e(description)}">${canonical}${og}<link rel="icon" href="${u("/logo_farmagreen.png")}"><link rel="stylesheet" href="${u("/styles-v6-9-1.css?v=20260813-1945")}"></head><body${options.bodyClass ? ` class="${e(options.bodyClass)}"` : ""}><header class="top"><a href="${u(homeHref)}" class="brandmark" aria-label="Ir al inicio de Farmagreen"><img src="${u("/logo_farmagreen.png")}" alt="Farmagreen" width="640" height="122"></a><div class="toplinks">${links.map((link) => `<a href="${u(link.href)}"${link.active ? ' class="is-active"' : ""}${link.nav ? ` data-nav="${e(link.nav)}"` : ""}${link.historyBack ? ' data-history-back aria-label="Volver a la página anterior"' : ""}>${e(link.label)}</a>`).join("")}</div><a class="topwa" href="${wa("Hola Farmagreen Rosario, quiero consultar.")}" aria-label="Abrir WhatsApp de Farmagreen">${waIcon()}<span>WhatsApp</span></a></header><main>${body}</main>${footerV69()}<a class="float" href="${wa("Hola Farmagreen Rosario, quiero hacer una consulta.")}" aria-label="Consultar por WhatsApp">${waIcon()}</a><script type="module" src="${u("/app-v6-9-5.js?v=20260813-1945")}"></script><script type="module" src="${u("/meta-pixel-v69-1.js?v=20260819-1")}"></script><noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1198250568817946&amp;ev=PageView&amp;noscript=1" alt=""></noscript></body></html>`;
}

function cardV69(product: ProductV69, origin = "http://127.0.0.1:8109", priority = false) {
  const discount = Math.round(product.discountPercent || 0);
  const productPath = publicProductPathV69(product);
  const name = String(product.name || "Producto Farmagreen");
  const brand = brandName(product);
  const unavailable = product.availability === "out_of_stock";
  const unverified = product.availability === "unknown";
  const needsAvailabilityConsult = unavailable || unverified;
  const statusClass = unavailable ? " v69-card-unavailable" : unverified ? " v69-card-unverified" : "";
  return `<article class="v66-card${statusClass}"><a class="v65-hit" href="${u(productPath)}" aria-label="Ver ${e(name)}"></a><div class="v66-card-top"><p class="v66-brand">${e(brand)}</p>${discount > 0 ? `<span class="v66-discount">-${discount}%</span>` : ""}</div>${productImage(product, "card", "v66-media", priority)}<div class="v66-card-body"><h3>${e(name)}</h3><dl class="v66-facts"><div><dt>Presentación</dt><dd>${e(presentation(product))}</dd></div><div><dt>Uso</dt><dd>${e(usage(product))}</dd></div></dl>${stockBadgeV69(product)}${priceCard(product)}<a class="ask v66-ask${needsAvailabilityConsult ? " v69-ask-unavailable" : ""}" href="${wa(`Hola Farmagreen Rosario, quiero consultar por ${brand} - ${name}. Link: ${absolute(origin, productPath)}`)}">Consultar</a></div></article>`;
}

function publicProductPathV69(product: ProductV69) {
  return `${PRODUCT_ROUTE}${encodeURIComponent(product.publicId)}`;
}

function stockBadgeV69(product: ProductV69, detail = false) {
  const unavailable = product.availability === "out_of_stock";
  const unverified = product.availability === "unknown";
  const label = unavailable
    ? "Consultar Disponibilidad"
    : unverified
      ? "Consultar Disponibilidad"
      : "Disponible para Entrega";
  const checked = product.availabilityCheckedAt ? shortDateV69(product.availabilityCheckedAt) : "";
  const freshness = checked
    ? `Verificado en Rosario ${checked}`
    : "Confirmamos disponibilidad por WhatsApp";
  return `<p class="v69-stock${unavailable ? " is-unavailable" : ""}${unverified ? " is-unverified" : ""}${detail ? " is-pdp" : ""}"><span aria-hidden="true"></span><strong>${label}</strong>${detail ? `<small>${e(freshness)}</small>` : ""}</p>`;
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
      capilar: "Cabello",
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
    barcode: String(product.barcode || ""),
    magentoCategories: (product.magentoCategories || []).map((category) => ({ ...category })),
    listPrice: product.listPrice,
    offerPrice: product.offerPrice,
    savingAmount: product.savingAmount,
    discountPercent: product.discountPercent,
    availability: publicAvailabilityV69(product),
    availabilityCheckedAt: product.availabilityCheckedAt,
    images: {
      card: safeImage(product, "card"),
      detail: safeImage(product, "detail"),
      responsive: safeResponsiveImagesV69(product),
    },
  };
}

function productImage(product: Partial<ProductV69>, kind: "card" | "detail", className: string, priority = false) {
  const image = safeImage(product, kind);
  const name = String(product.name || "Producto Farmagreen");
  const responsive = safeResponsiveImagesV69(product)?.[kind];
  const width = responsive?.width || 1000;
  const height = responsive?.height || 1000;
  const sizes = kind === "card"
    ? "(max-width: 760px) calc((100vw - 52px) / 2), (max-width: 980px) calc((100vw - 72px) / 3), calc((100vw - 112px) / 5)"
    : "(max-width: 760px) calc(100vw - 36px), 50vw";
  const sources = responsive
    ? `${responsive.avif ? `<source type="image/avif" srcset="${e(srcsetV69(responsive.avif))}" sizes="${e(sizes)}">` : ""}${responsive.webp ? `<source type="image/webp" srcset="${e(srcsetV69(responsive.webp))}" sizes="${e(sizes)}">` : ""}`
    : "";
  return image
    ? `<div class="${className}"><picture>${sources}<img src="${e(image)}" alt="${e(name)}" width="${width}" height="${height}" decoding="async"${priority ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"'}></picture></div>`
    : `<div class="${className} v67-image-missing" role="img" aria-label="Imagen no disponible para ${e(name)}"></div>`;
}

function safeResponsiveImagesV69(product: Partial<ProductV69> | undefined) {
  const source = product?.images?.responsive;
  if (!source || typeof source !== "object") return undefined;
  const output: { card?: ResponsiveImageSet; detail?: ResponsiveImageSet } = {};
  for (const kind of ["card", "detail"] as const) {
    const candidate = source[kind];
    if (!candidate || typeof candidate !== "object") continue;
    const width = positiveInteger(candidate.width);
    const height = positiveInteger(candidate.height);
    if (!width || !height) continue;
    const avif = safeVariantMapV69(candidate.avif);
    const webp = safeVariantMapV69(candidate.webp);
    if (!avif && !webp) continue;
    output[kind] = { width, height, ...(avif ? { avif } : {}), ...(webp ? { webp } : {}) };
  }
  return output.card || output.detail ? output : undefined;
}

function safeVariantMapV69(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .map(([width, url]) => [positiveInteger(width), String(url || "")] as const)
    .filter(([width, url]) => width && safePublicImageUrlV69(url))
    .sort((left, right) => left[0] - right[0]);
  return entries.length ? Object.fromEntries(entries.map(([width, url]) => [String(width), url])) : undefined;
}

function safePublicImageUrlV69(value: string) {
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "storage.googleapis.com" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function srcsetV69(variants: Record<string, string>) {
  return Object.entries(variants)
    .map(([width, url]) => [positiveInteger(width), url] as const)
    .filter(([width, url]) => width && safePublicImageUrlV69(url))
    .sort((left, right) => left[0] - right[0])
    .map(([width, url]) => `${url} ${width}w`)
    .join(", ");
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
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

function instagramIcon() {
  return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><defs><linearGradient id="v69-instagram-gradient" x1="3" y1="29" x2="29" y2="3" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#feda75"/><stop offset=".28" stop-color="#fa7e1e"/><stop offset=".52" stop-color="#d62976"/><stop offset=".76" stop-color="#962fbf"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#v69-instagram-gradient)"/><rect x="8" y="8" width="16" height="16" rx="5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="21.5" cy="10.5" r="1.25" fill="#fff"/></svg>`;
}

const u = (value: string) => `${BASE}${value}`;
const absolute = (origin: string, value: string) => new URL(u(value), origin).toString();
const wa = (message: string) => `https://wa.me/${W}?text=${encodeURIComponent(message)}`;
const e = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const xml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" })[character] || character);
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
