import { normalizeProductText } from "./gpsfarma-listing.mjs";
import { isFragranceProductV69 } from "./catalog-collections-v69.mjs";

const VERSION = "v69.6-evidence-dual-use";
// User rule: these five families have one use, even when a secondary benefit
// is supported. Other categories can expose a principal and a secondary use.
const SINGLE_USE_CATEGORIES = new Set(["nutricion", "solares", "capilar", "limpieza", "fragancias"]);
const SOLAR = /\b(protector(?:a)? solar|proteccion solar|fotoprotector\w*|fotoproteccion|anthelios|capital soleil|ideal soleil|solar|sun|fotoultra|foto ultra|fusion water|eryfotona|actinic control|after sun|post solar|broncead\w*|autobronce\w*)\b/;
const CLEANSING = /\b(limpiador\w*|limpieza|limpeza|micelar|desmaquill\w*|jabon|syndet|exfolia\w*|microexfolia\w*)\b|\b(aceite de ducha|gel de bano)\b/;
const HAIR = /\b(shampoo|champu|acondicionador|capilar|cabello|pelo|dercos|anticaida|anti caida|caspa|rulos|desenredante|fijador|protector de calor|crema de peinar)\b/;
const NUTRITION = /\b(suplemento\w*|complemento nutricional|alimento nutricional|bebida (?:energetica|deportiva|isotonica)|batido|whey|protein\w*|colageno hidrolizado|bcaa|creatina|aminoacido\w*|ensure)\b/;
const ORAL = /\b(capsula\w*|comprimido\w*|comp|tableta\w*|gomita\w*|gummies|bebible|pastilla\w*|caramelo\w*)\b|\b\d+ sobres?\b/;
const TOPICAL = /\b(crema|cream|emulsion|locion|gel|serum|espuma|aceite|facial|rostro|corporal|booster)\b/;
const BODY = /\b(corporal|cuerpo|manos|pies|piernas|bodytherapy|reductora|desodorante|antitranspirante|anti transpirante)\b/;

// Within the same evidence level, specific treatment intent wins over a
// general moisturising benefit. Ingredients are only weak topical hints.
const BENEFITS = [
  { need: "manchas", priority: 70, pattern: /\b(manchas?|anti manchas?|antimanchas?|anti pigment\w*|antipigment\w*|despigment\w*|melasma|hiperpigment\w*|pigment control|dark spots?|spot prevent)\b/ },
  { need: "acne", priority: 70, pattern: /\b(acne|antiacne\w*|comedones?|sebor?regula\w*|imperfecciones|granos)\b/ },
  { need: "antiedad", priority: 60, pattern: /\b(antiedad|anti edad|antiage|anti aging|antiarrugas?|anti arrugas?|arrugas?|envejecimiento|fotoenvejecimiento|firmeza|reafirm\w*|lifting|lineas de expresion)\b/ },
  { need: "piel-sensible", priority: 55, pattern: /\b(piel(?:es)?(?: seca[s]?(?: y)?| muy seca[s]?(?: y)?)? sensible[s]?|atopi\w*|rosacea|rojeces|piel irritada|calma\w* (?:la )?irritacion)\b/ },
  { need: "reparacion", priority: 50, pattern: /\b(repar\w*|repair\w*|restaur\w*|regener\w*|cicatriz\w*|estria\w*|rugos\w*|barrera|labial|labios agrietados)\b/ },
  { need: "hidratacion", priority: 40, pattern: /\b(hidrat\w*|hydra\w*|hydro\w*|moistur\w*|humect\w*|emoliente\w*|piel(?:es)? (?:muy )?seca[s]?|xerosis)\b/ },
];
const LINE_BENEFITS = [
  { need: "manchas", priority: 70, pattern: /\bmela b3\b/, unless: /\b(eye|ojos|antiojeras)\b/ },
  { need: "antiedad", priority: 60, pattern: /\b(hyaluron filler|hyaluronic filler|volume lift|elasticity|ultra age|revitalift|healthy renew|age correct|age repair|age reverse|uv age)\b/ },
  { need: "hidratacion", priority: 40, pattern: /\b(hyalu b5|aqualia)\b/ },
];

function asText(value) { return typeof value === "string" ? value : ""; }
function strings(value) { return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []; }

// Descriptions may mix instructions, ingredients and cross-selling into the
// summary. Only positive product claims before those blocks qualify.
function claimFragments(value) {
  const text = asText(value).replace(/<[^>]*>/g, " ");
  const stop = /(?:modo\s+de\s+uso|consejos?\s+de\s+aplicaci[oó]n|c[oó]mo\s+(?:usar|aplicar)|composici[oó]n|ingredientes\s*:|precauciones|advertencias|aplicar\b|utilizar\b|usar\b|complement[aá]\w*\b)/i;
  const claim = text.split(stop)[0];
  return claim.split(/[.!?;\n]+/).map(normalizeProductText).filter((fragment) => fragment &&
    !/\b(no|sin|evita\w*|previene\w*)\s+(?:deja\w*\s+)?manchas?\s+(?:blancas?|en la ropa)|\b(ropa|tejidos|prendas|transpiracion|mal olor)\b/.test(fragment) &&
    !/\b(no (?:es|combate|trata|reduce|hidrata|repara)|antes de|despues de|seguido de|rutina|recomenda\w*)\b/.test(fragment) &&
    !/\b(aqua|sodium|parfum|butyl methoxydibenzoylmethane)\b/.test(fragment));
}

function hasSkinSpotBenefit(text, field) {
  if (/\b(sin manchas|no (?:deja|produce|provoca) manchas|ropa|prendas|tejidos)\b/.test(text)) return false;
  if (field === "name" || field === "line") return true;
  // Merely describing how spots appear is not a claim that this product treats
  // them. Require a treatment/prevention claim or an explicit target audience.
  return /\b(antimanchas?|anti manchas?|despigment\w*|anti pigment\w*|antipigment\w*|pigment control|dark spots?|spot prevent)\b/.test(text) ||
    /\b(reduc\w*|corrig\w*|correc\w*|disminu\w*|atenua\w*|preven\w*|previen\w*|mejora\w*|combate\w*|contra|defiende|protege)\b.{0,120}\b(manchas?|hiperpigment\w*)\b/.test(text) ||
    /\b(para|indicado\w*)\b.{0,85}\bmanchas?\b|\bmanchas?\b.{0,30}\b(corregidas|reducidas)\b/.test(text);
}

function evidenceFor(nameValue, brandValue, product) {
  const evidence = [
    { field: "name", text: normalizeProductText(asText(nameValue)), rank: 4 },
    { field: "line", text: normalizeProductText(asText(product.line)), rank: 3 },
  ].filter((entry) => entry.text);
  const sections = Array.isArray(product.detail?.sections) ? product.detail.sections : [];
  const benefits = sections.filter((section) => /^(beneficios?|benefits?)$/.test(normalizeProductText(section.id || section.title || "")));
  for (const value of benefits.flatMap((section) => strings(section.content))) {
    for (const text of claimFragments(value)) evidence.push({ field: "detail.beneficios", text, rank: 2 });
  }
  const summary = strings(product.detail?.summary);
  for (const value of summary.length ? summary : [product.description]) {
    for (const text of claimFragments(value)) evidence.push({ field: summary.length ? "detail.summary" : "description", text, rank: 1 });
  }
  return { evidence, brand: normalizeProductText(asText(brandValue)) };
}

function categoryFrom(text, brand = "", descriptive = false) {
  const oral = ORAL.test(text);
  const identityText = text.replace(/\b(ice cream|cookies (?:and )?cream|a la crema)\b/g, "");
  const topicalForm = /\b(crema|cream|emulsion|locion|serum|espuma|shampoo|capilar)\b/.test(identityText);
  const nutrition = descriptive
    ? /\b(suplemento(?: dietario| nutricional)?|complemento nutricional|alimento (?:a base|nutricional)|bebida (?:energetica|deportiva|isotonica))\b/.test(text)
    : /\bsuplemento\w*\b/.test(text) || (!topicalForm && (oral || NUTRITION.test(text) || /^(vitamin\s*way|ena)$/.test(brand)));
  if (nutrition) return "nutricion";
  if (HAIR.test(text) || (/\bcapilatis\b/.test(brand) && !BODY.test(text))) return "capilar";
  if (SOLAR.test(text)) return "solares";
  if (CLEANSING.test(text)) return "limpieza";
  return null;
}

export function inferTaxonomyV69(nameValue, brandValue, product = {}) {
  const { evidence, brand } = evidenceFor(nameValue, brandValue, product);
  const title = normalizeProductText(asText(nameValue));
  const fragrance = isFragranceProductV69(product);
  let identity = evidence.find((entry) => entry.field === "name" && categoryFrom(entry.text, brand));
  let primaryCategory = fragrance ? "fragancias" : categoryFrom(title, brand);
  // Descriptive identity is a fallback for an unidentified product. A benefit
  // in a facial cream's description must not turn it into sunscreen/cleanser.
  if (!primaryCategory && !TOPICAL.test(title) && !BODY.test(title)) {
    identity = evidence.find((entry) => entry.rank <= 2 && categoryFrom(entry.text, "", true));
    if (identity) primaryCategory = categoryFrom(identity.text, "", true);
  }
  if (!primaryCategory) {
    const presentation = Math.max(0, ...[...title.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|g)\b/g)].map((match) => Number(match[1].replace(",", "."))));
    const facial = /\b(facial|rostro|face care|contorno de ojos|cc cream)\b/.test(title);
    primaryCategory = /\b(bebe|infantil|pediatrico)\b/.test(title) ? "bebe" :
      BODY.test(title) || (TOPICAL.test(title) && presentation >= 100 && !facial) ? "cuerpo" :
      /\b(omron|tensiometro|nebulizador|termometro|balanza|electroestimulador)\b/.test(title) ? "otros" : "rostro";
  }
  const candidates = new Map();
  const add = (need, entry, rule, priority, match) => {
    const candidate = { need, field: entry.field, source: "product-evidence", rule, match, priority, rank: entry.rank };
    const previous = candidates.get(need);
    if (!previous || candidate.rank > previous.rank || (candidate.rank === previous.rank && candidate.priority > previous.priority)) candidates.set(need, candidate);
  };
  for (const entry of evidence) {
    for (const rule of BENEFITS) {
      const match = entry.text.match(rule.pattern);
      if (!match) continue;
      if (rule.need === "manchas" && !hasSkinSpotBenefit(entry.text, entry.field)) continue;
      // Oral collagen or cartilage repair do not imply a skincare benefit.
      if (primaryCategory === "nutricion" && entry.rank < 3 && !/\b(piel|cutane\w*|hidratacion oral)\b/.test(entry.text)) continue;
      if (primaryCategory === "nutricion" && rule.need === "reparacion" && !/\b(piel|cutane\w*)\b/.test(entry.text)) continue;
      add(rule.need, entry, "explicit-benefit", rule.priority, match[0]);
    }
    if (entry.rank >= 3 && !["nutricion", "fragancias", "capilar"].includes(primaryCategory)) {
      for (const rule of LINE_BENEFITS) {
        const match = entry.text.match(rule.pattern);
        if (match && !rule.unless?.test(title)) add(rule.need, entry, "specific-product-line", rule.priority, match[0]);
      }
      for (const [need, pattern] of [["antiedad", /\b(retinol|retinal|colageno|filler)\b/], ["hidratacion", /\b(hialuron\w*|hyaluron\w*)\b/]]) {
        const match = entry.text.match(pattern);
        if (match) add(need, { ...entry, rank: 0 }, "topical-title-ingredient", 10, match[0]);
      }
    }
    if (primaryCategory === "nutricion" && entry.rank >= 3 && HAIR.test(entry.text)) add("capilar", entry, "explicit-hair-benefit", 70, entry.text.match(HAIR)[0]);
  }
  const ordered = [...candidates.values()].sort((a, b) => b.rank - a.rank || b.priority - a.priority || a.need.localeCompare(b.need));
  const selected = [];
  const useLimit = SINGLE_USE_CATEGORIES.has(primaryCategory) ? 1 : 2;
  if (useLimit === 1) selected.push({
    need: primaryCategory,
    source: fragrance ? "gps-fragrance-collection" : "product-evidence",
    field: fragrance ? "catalogFacets/sourceMemberships" : identity?.field || "name/brand",
    rule: "product-identity", match: primaryCategory,
  });
  selected.push(...ordered.filter((entry) => entry.need !== primaryCategory).slice(0, useLimit - selected.length)
    .map(({ priority, rank, ...entry }) => entry));
  if (!selected.length) selected.push({ need: primaryCategory === "bebe" ? "piel-sensible" : "cuidado-diario", source: "fallback", field: "name", rule: "no-specific-benefit", match: "" });
  const needs = selected.map((entry) => entry.need);
  return {
    primaryCategory, needs,
    audit: {
      reasonerVersion: VERSION,
      evidenceScope: [...new Set(["name", "line", "brand", ...evidence.map((entry) => entry.field), ...(fragrance ? ["catalogFacets", "sourceMemberships"] : [])])],
      excludedEvidence: ["aliases", "magentoCategories", "instructions", "composition", "unsupported-legacy-needs"],
      selected,
      rejected: ordered.filter((entry) => !needs.includes(entry.need)).map(({ need }) => ({
        need, reason: useLimit === 1 ? "single-use-category" : "two-use-limit-lower-priority",
      })),
    },
  };
}

export function reconcileCatalogUsesV69(product) {
  const inferred = inferTaxonomyV69(product.name, product.brand?.name || "", product);
  if (product.taxonomy?.reasonerVersion === VERSION && product.primaryCategory === inferred.primaryCategory &&
    JSON.stringify(product.needs) === JSON.stringify(inferred.needs) &&
    JSON.stringify(product.taxonomy.selected) === JSON.stringify(inferred.audit.selected)) return null;
  return { ...inferred, audit: { ...inferred.audit, originalNeeds: product.taxonomy?.originalNeeds || product.needs || [] } };
}
