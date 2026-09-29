import { normalizeProductText } from "./gpsfarma-listing.mjs";
import { isFragranceProductV69 } from "./catalog-collections-v69.mjs";

// General use matching relies on the product title and its own line. Only the
// explicit GPS fragrance collection is a source-based override (below).
// Magento categories and search aliases are not product intent.
export function inferTaxonomyV69(nameValue, brandValue) {
  const text = normalizeProductText(`${nameValue} ${brandValue}`);
  const vitaminWay = /\bvitamin\s*way\b/.test(text);
  const capilatis = /\bcapilatis\b/.test(text);
  const explicitBody = /\b(corporal|cuerpo|manos|pies|piernas|bodytherapy|reductora)\b/.test(text);
  const facial = /\b(facial|rostro|face care|contorno de ojos|cc cream)\b/.test(text);
  const topical = /\b(crema|emulsion|locion|gel|serum|espuma)\b/.test(text);
  const presentation = [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|g|gr|gramos)\b/g)]
    .map((match) => Number(String(match[1]).replace(",", ".")))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] || 0;
  const nutrition = vitaminWay ||
    /\b(proteina|suplemento|creatina|aminoacido)\w*\b/.test(text) ||
    (/\b(vitamina|minerales|colageno)\w*\b/.test(text) &&
      /\b(capsula|comprimido|tableta|polvo|sobre|gomita|bebible)\w*\b/.test(text));
  const capillary =
    (capilatis && !explicitBody) ||
    /\b(shampoo|acondicionador|capilar|cabello|pelo|dercos|anticaida|anti caida|caspa|rulos|desenredante|fijador|enjuague|mascara|balsamo|protector de calor|aclarante)\b/.test(text);
  const solar = /\b(protector solar|fotoprotector|solar|after sun|post solar|broncead\w*|autobronce\w*)\b/.test(text);
  const cleansing = /\b(limpiador|limpieza|limpeza|micelar|desmaquill\w*|jabon|syndet|exfolia\w*|microexfolia\w*)\b|\b(aceite de ducha|gel de bano)\b/.test(text);
  const body =
    /\b(corporal|cuerpo|manos|pies|piernas)\b/.test(text) ||
    (topical && presentation >= 100 && !facial && !capillary && !solar && !cleansing && !nutrition);
  let primaryCategory = "rostro";
  if (nutrition) primaryCategory = "nutricion";
  else if (capillary) primaryCategory = "capilar";
  else if (solar) primaryCategory = "solares";
  else if (cleansing) primaryCategory = "limpieza";
  else if (/\b(bebe|infantil|pediatrico)\b/.test(text)) primaryCategory = "bebe";
  else if (body) primaryCategory = "cuerpo";
  else if (/\b(omron|tensiometro|nebulizador|termometro|balanza|electroestimulador)\b/.test(text)) primaryCategory = "otros";

  const needs = [];
  const rules = [
    ["limpieza", /\b(limpiador|limpieza|limpeza|micelar|desmaquill\w*|jabon|syndet|exfolia\w*|microexfolia\w*)\b|\b(aceite de ducha|gel de bano)\b/],
    ["solares", /\b(protector solar|fotoprotector|solar|after sun|post solar|broncead\w*|autobronce\w*)\b/],
    ["capilar", /\b(shampoo|acondicionador|capilar|cabello|pelo|dercos|anticaida|anti caida|caspa|rulos|desenredante|fijador|enjuague|mascara|balsamo|protector de calor|aclarante)\b/],
    ["acne", /\b(acne|antiacne|comedon|seborregulador|imperfecciones|granos)\b/],
    ["manchas", /\b(manchas|antimanchas|anti pigment|antipigment|despigment|melasma|pigmentacion)\b/],
    ["piel-sensible", /\b(piel sensible|atopi|rosacea|rojeces|hipoalergen\w*|bebe|infantil|irritacion)\b/],
    ["hidratacion", /\b(hidrat\w*|hydra\w*|hydro\w*|moistur\w*|humect\w*|emoliente|piel seca|xerosis|hialuron\w*|hyaluron\w*)\b/],
    ["antiedad", /\b(antiedad|anti edad|antiage|anti aging|antiarrugas|arrugas|retinol|retinal|filler|firmeza|reafirmante|lifting|colageno)\b/],
    ["reparacion", /\b(repar\w*|repair\w*|restaur\w*|regener\w*|cicatriz\w*|estria\w*|rugos\w*|barrera|labial|labios agrietados)\b/],
  ];
  for (const [need, pattern] of rules) if (pattern.test(text) && !needs.includes(need)) needs.push(need);
  if (["nutricion", "solares", "capilar", "limpieza"].includes(primaryCategory)) {
    needs.splice(0, needs.length, primaryCategory);
  }
  if (!needs.length) needs.push(primaryCategory === "bebe" ? "piel-sensible" : "cuidado-diario");
  return {
    primaryCategory,
    needs: needs.slice(0, 2),
    audit: {
      reasonerVersion: "v69.3-live-taxonomy-evidence",
      evidenceScope: ["name", "brand"],
      selected: needs.slice(0, 2).map((need) => ({ need, source: "deterministic-title-rule" })),
      rejected: [],
    },
  };
}

const EXPLICIT_SOLAR_NAME_V69 = /\b(protector(?:a)? solar|proteccion solar|fotoprotector\w*|fotoproteccion|anthelios|capital soleil|ideal soleil|solar|sun|fotoultra|foto ultra|fusion water|eryfotona|actinic control|after sun|post solar|autobronceante|bronceador)\b/;

export function reconcileCatalogUsesV69(product) {
  // The exact GPS collection membership is evidence; "sin perfume" in a
  // skincare title must never create a fragrance match.
  if (isFragranceProductV69(product)) {
    if (product.primaryCategory === "fragancias" && product.needs?.length === 1 && product.needs[0] === "fragancias") return null;
    return {
      primaryCategory: "fragancias",
      needs: ["fragancias"],
      audit: {
        reasonerVersion: "v69.5-fragrance-source",
        evidenceScope: ["catalogFacets", "sourceMemberships"],
        selected: [{ need: "fragancias", source: "gps-fragrance-collection" }],
        originalNeeds: product.needs || [],
      },
    };
  }
  const inferred = inferTaxonomyV69([product.name, product.line].filter(Boolean).join(" "), product.brand?.name || "");
  if (inferred.needs[0] === "cuidado-diario") return null;
  // A supplement or an explicitly solar product needs human review before a
  // non-nutrition/non-solar title signal can displace its existing identity.
  const title = normalizeProductText(product.name);
  if (product.primaryCategory === "nutricion" && inferred.primaryCategory !== "nutricion") return null;
  if (product.primaryCategory === "solares" && inferred.primaryCategory !== "solares" && EXPLICIT_SOLAR_NAME_V69.test(title)) return null;
  // Do not erase a previously supported secondary use just because the short
  // title contains less evidence than the verified snapshot.
  if (product.primaryCategory === inferred.primaryCategory &&
    inferred.needs.every((need) => (product.needs || []).includes(need))) return null;
  return {
    primaryCategory: inferred.primaryCategory,
    needs: inferred.needs,
    audit: {
      ...inferred.audit,
      reasonerVersion: "v69.4-title-line-use",
      evidenceScope: ["name", "line", "brand"],
      originalNeeds: product.needs || [],
    },
  };
}
