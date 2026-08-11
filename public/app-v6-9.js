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
const ROUTE = "/catalogo";
const PDP = "/p/";
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
const TOTAL_PRODUCTS = Number(BOOT.totalProducts || S.all.length || 0);

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
  loreal: ["l oreal revitalift", "l oreal", "l oréal revitalift"],
  isdin: ["isdin"],
  cetafil: ["cetaphil"],
  aveno: ["aveno", "aveeno"],
  aveeno: ["aveeno", "aveno"],
  ena: ["ena", "ena suplementos", "ena sport"],
};
const SEARCH_STOPWORDS = new Set(["a", "al", "de", "del", "el", "la", "las", "los", "para", "por", "en", "un", "una", "unos", "unas", "y"]);
const SEARCH_MIN_CHARS = 3;
const SHORT_EXACT_SEARCH_TERMS = new Set(["ena", "lrp", "gel", "fps", "spf", "uv", "b5", "ha", "oil"]);
const SEARCH_CONCEPTS = [
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
    `Hola Farmagreen Rosario, quiero consultar por ${brandName(product)} - ${product?.name || "Producto Farmagreen"}. Link: ${absoluteUrl(`${PDP}${product?.publicId || ""}`)}`,
  )}`;

function brandName(product) {
  return product?.brand?.name || "Farmagreen";
}

function productImageUrl(product) {
  return product?.images?.card || product?.images?.detail || "";
}

function responsiveVariants(product, format) {
  const variants = product?.images?.responsive?.card?.[format];
  if (!variants || typeof variants !== "object") return "";
  return Object.entries(variants)
    .map(([width, source]) => [Number.parseInt(width, 10), String(source || "")])
    .filter(([width, source]) => Number.isInteger(width) && width > 0 && source)
    .sort((left, right) => left[0] - right[0])
    .map(([width, source]) => `${esc(source)} ${width}w`)
    .join(", ");
}

function productImageMarkup(product, priority = false) {
  const image = productImageUrl(product);
  const name = product?.name || "Producto Farmagreen";
  if (!image) {
    return `<div class="v66-media v67-image-missing" role="img" aria-label="Imagen no disponible para ${esc(name)}"></div>`;
  }
  const responsive = product?.images?.responsive?.card;
  const width = Number.isInteger(Number(responsive?.width)) && Number(responsive.width) > 0 ? Number(responsive.width) : 1000;
  const height = Number.isInteger(Number(responsive?.height)) && Number(responsive.height) > 0 ? Number(responsive.height) : 1000;
  const sizes = "(max-width: 760px) calc((100vw - 52px) / 2), (max-width: 980px) calc((100vw - 72px) / 3), calc((100vw - 112px) / 5)";
  const avif = responsiveVariants(product, "avif");
  const webp = responsiveVariants(product, "webp");
  const sources = `${avif ? `<source type="image/avif" srcset="${avif}" sizes="${sizes}">` : ""}${webp ? `<source type="image/webp" srcset="${webp}" sizes="${sizes}">` : ""}`;
  return `<div class="v66-media"><picture>${sources}<img src="${esc(image)}" alt="${esc(name)}" width="${width}" height="${height}" decoding="async"${priority ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"'}></picture></div>`;
}

function derivedSearchSignals(product) {
  const name = norm(product?.name);
  const signals = [];
  if (/\b(piel (muy )?(seca|reseca|resecada|agrietada)|labios? (secos?|agrietados?)|manos? (secas?|agrietadas?))\b/.test(name)) {
    signals.push("sequedad");
  }
  if (
    (product?.needs || []).includes("nutricion") &&
    /\b\d+(?:[.,]\d+)?\s*(g|gr|grs|kg)\b/.test(name) &&
    !/(caps|capsula|comprim|tableta|sobre|gomita|unidad)/.test(name)
  ) {
    signals.push("polvo");
  }
  return signals;
}

function blob(product) {
  return norm(`${baseBlob(product)} ${magentoCategoryBlob(product)}`);
}

function baseBlob(product) {
  const needs = product.needs || [];
  return norm(
    [
      product.name,
      product.brand?.name,
      ...(product.brand?.aliases || []),
      product.line,
      product.barcode,
      ...(product.aliases || []),
      product.primaryCategory,
      ...needs,
      ...needs.map((need) => NEED_LABELS[need] || need),
      ...derivedSearchSignals(product),
    ].join(" "),
  );
}

function magentoCategoryBlob(product) {
  return norm((product.magentoCategories || []).flatMap((category) => [category.id, category.name]).join(" "));
}

function semanticBlob(product) {
  const needs = product.needs || [];
  return norm(
    [
      product.name,
      product.line,
      product.primaryCategory,
      ...needs,
      ...needs.map((need) => NEED_LABELS[need] || need),
      ...derivedSearchSignals(product),
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

function isSearchStopWordLike(term) {
  if (SHORT_EXACT_SEARCH_TERMS.has(term) || /^\d+$/.test(term)) return false;
  if (SEARCH_STOPWORDS.has(term)) return true;
  if (directConceptIndexes(term).length) return false;
  if (term.length < SEARCH_MIN_CHARS) return false;
  return [...SEARCH_STOPWORDS].some(
    (stopWord) =>
      stopWord.length >= SEARCH_MIN_CHARS &&
      (stopWord.startsWith(term) ||
        (Math.abs(stopWord.length - term.length) <= 1 && levenshtein(stopWord, term) <= 1)),
  );
}

function directConceptIndexes(rawTerm) {
  const term = norm(rawTerm);
  if (!term) return [];
  return SEARCH_CONCEPTS.flatMap((concept, index) =>
    (concept.exact || []).includes(term) ||
    (concept.stems || []).some(
      (stem) => term.startsWith(stem) || (term.length >= SEARCH_MIN_CHARS && stem.startsWith(term)),
    )
      ? [index]
      : [],
  );
}

function searchDistanceLimit(term) {
  if (term.length < 4) return 0;
  return term.length > 7 ? 2 : 1;
}

function fuzzyConceptIndexes(rawTerm) {
  const term = norm(rawTerm);
  const limit = searchDistanceLimit(term);
  if (!limit) return [];
  let bestDistance = limit + 1;
  const bestIndexes = new Set();
  SEARCH_CONCEPTS.forEach((concept, index) => {
    const lexemes = [
      ...(concept.exact || []),
      ...(concept.stems || []),
      ...concept.targets.flatMap((target) => norm(target).split(" ")),
    ]
      .map(norm)
      .filter((lexeme) => lexeme.length >= SEARCH_MIN_CHARS && Math.abs(lexeme.length - term.length) <= limit);
    for (const lexeme of lexemes) {
      const distance = levenshtein(lexeme, term);
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
    [...bestIndexes].map((index) => SEARCH_CONCEPTS[index].targets.map(norm).sort().join("|")),
  );
  return fingerprints.size === 1 ? [...bestIndexes] : [];
}

function searchTerms(value) {
  const terms = norm(value)
    .split(" ")
    .filter((term) => term && !isSearchStopWordLike(term))
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

function searchQueryReady(value) {
  return searchTerms(value).length > 0;
}

const SEARCH_INDEX_CACHE = new WeakMap();

function searchIndex(products) {
  const cached = SEARCH_INDEX_CACHE.get(products);
  if (cached) return cached;
  const index = {
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
    const lexicalText = baseBlob(product);
    const magentoCategoryText = magentoCategoryBlob(product);
    index.allIds.add(id);
    index.lexicalTextById.set(id, lexicalText);
    index.magentoCategoryTextById.set(id, magentoCategoryText);
    index.semanticTextById.set(id, semanticBlob(product));
    for (const word of new Set(lexicalText.split(" ").filter(Boolean))) {
      if (word.length < SEARCH_MIN_CHARS && !/^\d+$/.test(word)) continue;
      const ids = index.vocabulary.get(word) || new Set();
      ids.add(id);
      index.vocabulary.set(word, ids);
    }
    for (const word of new Set(magentoCategoryText.split(" ").filter(Boolean))) {
      if (word.length < SEARCH_MIN_CHARS && !/^\d+$/.test(word)) continue;
      const ids = index.magentoCategoryVocabulary.get(word) || new Set();
      ids.add(id);
      index.magentoCategoryVocabulary.set(word, ids);
    }
    for (const category of product.magentoCategories || []) {
      const phrase = searchTerms(category.name).join(" ");
      if (!phrase.includes(" ")) continue;
      const ids = index.exactMagentoCategoryPhrases.get(phrase) || new Set();
      ids.add(id);
      index.exactMagentoCategoryPhrases.set(phrase, ids);
    }
  }
  SEARCH_INDEX_CACHE.set(products, index);
  return index;
}

function directMagentoCategoryIds(index, rawTerm) {
  const term = norm(rawTerm);
  const result = new Set();
  for (const [word, ids] of index.magentoCategoryVocabulary) {
    const found = /^\d+$/.test(term)
      ? word === term
      : term.length === SEARCH_MIN_CHARS
        ? word.startsWith(term)
        : word === term || word.startsWith(term);
    if (found) unionIds(result, ids);
  }
  return result;
}

function unionIds(target, source = []) {
  for (const id of source) target.add(id);
  return target;
}

function directLexicalIds(index, rawTerm) {
  const term = norm(rawTerm);
  const result = new Set();
  for (const alias of SEARCH_ALIASES[term] || []) {
    const target = norm(alias);
    for (const [id, text] of index.lexicalTextById) if (text.includes(target)) result.add(id);
  }
  for (const [word, ids] of index.vocabulary) {
    const found = /^\d+$/.test(term)
      ? word === term
      : term.length === SEARCH_MIN_CHARS
        ? word.startsWith(term)
        : word === term || word.startsWith(term);
    if (found) unionIds(result, ids);
  }
  return result;
}

function fuzzyLexicalIds(index, rawTerm) {
  const term = norm(rawTerm);
  const limit = searchDistanceLimit(term);
  if (!limit || /^\d+$/.test(term)) return new Set();
  let bestDistance = limit + 1;
  let candidates = [];
  for (const word of index.vocabulary.keys()) {
    if (word.length < 4 || Math.abs(word.length - term.length) > limit) continue;
    const distance = levenshtein(word, term);
    if (distance > limit || distance > bestDistance) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      candidates = [];
    }
    candidates.push(word);
  }
  if (!candidates.length) return new Set();
  const families = new Set(candidates.map((word) => word.slice(0, SEARCH_MIN_CHARS)));
  if (families.size > 1) return new Set();
  return candidates.reduce((ids, word) => unionIds(ids, index.vocabulary.get(word)), new Set());
}

function semanticTextMatchesTarget(text, rawTarget) {
  const target = norm(rawTarget);
  if (!target) return false;
  if (target.includes(" ")) return text.includes(target);
  return text.split(" ").some((word) => word === target || word.startsWith(target));
}

function conceptIds(index, conceptIndexes) {
  const targets = conceptTargets(conceptIndexes);
  const ids = new Set();
  for (const [id, text] of index.semanticTextById) {
    if (targets.some((target) => semanticTextMatchesTarget(text, target))) ids.add(id);
  }
  return ids;
}

function conceptTargets(conceptIndexes) {
  return [...new Set(conceptIndexes.flatMap((conceptIndex) => SEARCH_CONCEPTS[conceptIndex].targets.map(norm)))];
}

function lexicalTargets(term) {
  return [...new Set([norm(term), ...(SEARCH_ALIASES[norm(term)] || []).map(norm)])];
}

function searchClause(index, term) {
  const directConcepts = directConceptIndexes(term);
  if (directConcepts.length) {
    return { term, kind: "concept", targets: conceptTargets(directConcepts), productIds: conceptIds(index, directConcepts) };
  }
  const directLexical = directLexicalIds(index, term);
  if (directLexical.size) return { term, kind: "lexical", targets: lexicalTargets(term), productIds: directLexical };
  const fuzzyConcepts = fuzzyConceptIndexes(term);
  if (fuzzyConcepts.length) {
    return { term, kind: "concept", targets: conceptTargets(fuzzyConcepts), productIds: conceptIds(index, fuzzyConcepts) };
  }
  const fuzzyLexical = fuzzyLexicalIds(index, term);
  if (fuzzyLexical.size) return { term, kind: "lexical", targets: [norm(term)], productIds: fuzzyLexical };
  const directCategory = directMagentoCategoryIds(index, term);
  if (directCategory.size) return { term, kind: "lexical", targets: [norm(term)], productIds: directCategory };
  return { term, kind: "unresolved", targets: [norm(term)], productIds: new Set() };
}

function compileSearchPlan(products, query) {
  const terms = searchTerms(query);
  const index = searchIndex(products);
  const clauses = terms.map((term) => searchClause(index, term));
  let productIds = new Set(index.allIds);
  for (const clause of clauses) {
    productIds = new Set([...productIds].filter((id) => clause.productIds.has(id)));
    if (!productIds.size) break;
  }
  const categoryPhraseEligible = terms.every(
    (term) => !directConceptIndexes(term).length && !fuzzyConceptIndexes(term).length,
  );
  const exactCategoryIds = categoryPhraseEligible
    ? index.exactMagentoCategoryPhrases.get(terms.join(" "))
    : undefined;
  if (exactCategoryIds) productIds = unionIds(productIds, exactCategoryIds);
  return { terms, clauses, productIds: terms.length ? productIds : new Set() };
}

function filterProductsBySearch(products, query) {
  if (!norm(query)) return [...products];
  const plan = compileSearchPlan(products, query);
  if (!plan.terms.length) return [];
  return products.filter((product) => plan.productIds.has(product.publicId));
}

function matches(product, searchIds, hasQuery) {
  if (S.scope === "ofertas" && !(product.discountPercent > 0)) return false;
  if (S.brand !== "Todas" && brandName(product) !== S.brand) return false;
  if (S.need !== "Todas" && !(product.needs || []).includes(S.need)) return false;
  return !hasQuery || searchIds.has(product.publicId);
}

function textMatchesSearchTarget(text, rawTarget) {
  const target = norm(rawTarget);
  if (!target) return false;
  if (target.includes(" ")) return text.includes(target);
  return text.split(" ").some((word) => word === target || word.startsWith(target));
}

function clauseMatchCount(text, clauses) {
  return clauses.filter((clause) => clause.targets.some((target) => textMatchesSearchTarget(text, target))).length;
}

function phraseMatch(text, phrase) {
  return phrase ? Number(text.includes(phrase)) : 0;
}

function searchRelevance(product, plan) {
  const fullQuery = plan.terms.join(" ");
  const needs = product.needs || [];
  const fields = {
    magentoCategoryIds: norm((product.magentoCategories || []).map((category) => category.id).join(" ")),
    magentoCategories: norm((product.magentoCategories || []).map((category) => category.name).join(" ")),
    functional: norm([product.primaryCategory, ...needs, ...needs.map((need) => NEED_LABELS[need] || need)].join(" ")),
    name: norm(product.name),
    brand: norm([brandName(product), ...(product.brand?.aliases || [])].join(" ")),
    line: norm(product.line),
    aliases: norm((product.aliases || []).join(" ")),
  };
  return [
    Number(/^\d{8,14}$/.test(fullQuery) && norm(product.barcode) === fullQuery),
    Number(/^\d+$/.test(fullQuery) && fields.magentoCategoryIds.split(" ").includes(fullQuery)),
    phraseMatch(fields.functional, fullQuery),
    clauseMatchCount(fields.functional, plan.clauses),
    phraseMatch(fields.name, fullQuery),
    clauseMatchCount(fields.name, plan.clauses),
    phraseMatch(fields.brand, fullQuery),
    clauseMatchCount(fields.brand, plan.clauses),
    phraseMatch(fields.line, fullQuery),
    clauseMatchCount(fields.line, plan.clauses),
    phraseMatch(fields.aliases, fullQuery),
    clauseMatchCount(fields.aliases, plan.clauses),
    phraseMatch(fields.magentoCategories, fullQuery),
    clauseMatchCount(fields.magentoCategories, plan.clauses),
  ];
}

function compareRelevance(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] || 0) - (left[index] || 0);
    if (difference) return difference;
  }
  return 0;
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

function card(product, priority = false) {
  const discount = Math.round(product.discountPercent || 0);
  const name = product?.name || "Producto Farmagreen";
  const availability = availabilityMeta(product);
  const media = productImageMarkup(product, priority);
  const stock = `<p class="v69-stock${availability.className}" title="${esc(availability.title)}"><span aria-hidden="true"></span><strong>${esc(availability.label)}</strong></p>`;
  const needsAvailabilityConsult = product?.availability !== "available_reference";
  const cta = "Consultar";
  const statusClass =
    product?.availability === "unavailable_reference"
      ? " v69-card-unavailable"
      : product?.availability === "unverified"
        ? " v69-card-unverified"
        : "";
  return `<article class="v66-card${statusClass}"><a class="v65-hit" href="${url(`${PDP}${esc(product?.publicId || "")}`)}" aria-label="Ver ${esc(name)}"></a><div class="v66-card-top"><p class="v66-brand">${esc(brandName(product))}</p>${discount > 0 ? `<span class="v66-discount">-${discount}%</span>` : ""}</div>${media}<div class="v66-card-body"><h3>${esc(name)}</h3><dl class="v66-facts"><div><dt>Presentación</dt><dd>${esc(presentation(product))}</dd></div><div><dt>Uso</dt><dd>${esc(usage(product))}</dd></div></dl>${stock}<div class="v66-price">${product.discountPercent > 0 ? `<s>${ars(product.listPrice)}</s>` : ""}<strong>${ars(product.offerPrice || product.listPrice)}</strong>${product.savingAmount > 0 ? `<small class="v66-saving">Ahorrás ${ars(product.savingAmount)}</small>` : ""}</div><a class="ask v66-ask${needsAvailabilityConsult ? " v69-ask-unavailable" : ""}" href="${wa(product)}">${cta}</a></div></article>`;
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
  const plan = compileSearchPlan(products, S.q);
  const entries = products.map((product) => ({ product, relevance: searchRelevance(product, plan) }));
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
        compareRelevance(left.relevance, right.relevance) ||
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
  const searchIds = new Set(filterProductsBySearch(S.all, S.q).map((product) => product.publicId));
  const hasQuery = Boolean(norm(S.q));
  const items = sorted(S.all.filter((product) => matches(product, searchIds, hasQuery)));
  const shown = Math.min(S.limit, items.length);
  $("#gridV69").innerHTML = items.length
    ? items.slice(0, shown).map((product, index) => card(product, index === 0)).join("")
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
  const requestedQuery = params.get("q") || "";
  S.q = searchQueryReady(requestedQuery) ? requestedQuery : "";
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

function openCatalogFromHome({ q = "", brand = "Todas", need = "Todas", sort = DEFAULT_SORT } = {}) {
  const params = new URLSearchParams({ scope: "todo" });
  if (q.trim()) params.set("q", q.trim());
  if (brand !== "Todas") params.set("marca", brand);
  if (need !== "Todas") params.set("need", need);
  if (SORT_VALUES.has(sort) && sort !== DEFAULT_SORT) params.set("orden", sort);
  location.assign(`${url(ROUTE)}?${params.toString()}#productos-v69`);
}

function bootHomeDiscovery() {
  if (!document.body.classList.contains("v69-home") || !$("#buscar-v69")) return false;

  wireFilterMenus();
  $(".v66-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = $("#searchV69")?.value || "";
    if (query.trim() && !searchQueryReady(query)) return;
    openCatalogFromHome({ q: query });
  });
  $("#clearFiltersV69")?.addEventListener("click", () => {
    closeFilterMenus();
    if ($("#searchV69")) $("#searchV69").value = "";
    if ($("#sortV69")) $("#sortV69").value = DEFAULT_SORT;
    $("#needSummaryV69").textContent = "Todas";
    $("#brandSummaryV69").textContent = `Todas · ${TOTAL_PRODUCTS}`;
  });
  $("#sortV69")?.addEventListener("change", (event) => openCatalogFromHome({ sort: event.target.value }));
  $$('[data-brand]').forEach((button) =>
    button.addEventListener("click", () => openCatalogFromHome({ brand: button.dataset.brand || "Todas" })),
  );
  $$('[data-need]').forEach((button) =>
    button.addEventListener("click", () => openCatalogFromHome({ need: button.dataset.need || "Todas" })),
  );
  return true;
}

async function loadCatalogProducts() {
  if (S.all.length || !BOOT.dataEndpoint) return;
  const response = await fetch(url(BOOT.dataEndpoint), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`No se pudo cargar el catálogo (${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload.products) || !payload.products.length) {
    throw new Error("El catálogo público llegó vacío.");
  }
  S.all = payload.products;
  BOOT.commerceSyncedAt = payload.commerceSyncedAt || BOOT.commerceSyncedAt;
  BOOT.availabilityReferenceAt = payload.availabilityReferenceAt || BOOT.availabilityReferenceAt;
}

async function boot() {
  if (!$("#gridV69")) {
    bootHomeDiscovery();
    return;
  }
  document.body.dataset.v69CatalogState = "loading";
  const discovery = $("#buscar-v69");
  discovery?.setAttribute("aria-busy", "true");
  try {
    await loadCatalogProducts();
  } catch (error) {
    console.error(error);
    discovery?.removeAttribute("aria-busy");
    document.body.dataset.v69CatalogState = "error";
    return;
  }
  discovery?.removeAttribute("aria-busy");
  const params = new URLSearchParams(location.search);
  applyParams(params);
  $("#searchV69").value = S.q;
  if ($("#sortV69")) $("#sortV69").value = S.sort;

  $(".v66-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    closeFilterMenus();
    const query = $("#searchV69").value;
    if (query.trim() && !searchQueryReady(query)) return;
    S.q = query;
    S.brand = "Todas";
    S.need = "Todas";
    S.scope = "todo";
    S.limit = PAGE;
    render("push");
    scrollProducts();
  });

  $("#searchV69")?.addEventListener("input", (event) => {
    closeFilterMenus();
    const query = event.target.value;
    if (!query.trim()) {
      reset();
      return;
    }
    if (!searchQueryReady(query)) {
      if (S.q) {
        S.q = "";
        S.brand = "Todas";
        S.need = "Todas";
        S.scope = "todo";
        S.limit = PAGE;
        render();
      }
      return;
    }
    S.q = query;
    S.brand = "Todas";
    S.need = "Todas";
    S.scope = "todo";
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
  document.body.dataset.v69CatalogState = "ready";
  window.addEventListener("popstate", () => {
    applyParams(new URLSearchParams(location.search));
    $("#searchV69").value = S.q;
    if ($("#sortV69")) $("#sortV69").value = S.sort;
    closeFilterMenus();
    render();
  });
}

function wireHistoryBack() {
  $$('[data-history-back]').forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      history.back();
    }),
  );
}

wireImageFallbacks();
wireHistoryBack();
void boot();
refreshFloatingWhatsapp();
window.matchMedia("(max-width: 760px)").addEventListener?.("change", refreshFloatingWhatsapp);
