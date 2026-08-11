function facet(slug, name, aliases, kind = "brand") {
  return Object.freeze({
    slug,
    name,
    aliases: Object.freeze([...new Set(aliases)]),
    kind,
  });
}

function source(definition) {
  return Object.freeze({
    ...definition,
    facet: definition.facet,
  });
}

export const GPS_SOURCES_V7_BETA = Object.freeze([
  source({ id: "5930", catalogBrandId: "5930", catalogBrandName: "Eucerin", mode: "brand", facet: facet("eucerin", "Eucerin", ["eucerin"]) }),
  source({ id: "5808", catalogBrandId: "5808", catalogBrandName: "Dermaglos", mode: "brand", facet: facet("dermaglos", "Dermaglos", ["dermaglos", "dermaglo"]) }),
  source({ id: "5751", catalogBrandId: "5751", catalogBrandName: "Caviahue", mode: "brand", facet: facet("caviahue", "Caviahue", ["caviahue"]) }),
  source({ id: "6048", catalogBrandId: "6048", catalogBrandName: "La Roche Posay", mode: "brand", facet: facet("la-roche-posay", "La Roche Posay", ["la roche posay", "laroche", "lrp"]) }),
  source({ id: "6301", catalogBrandId: "6301", catalogBrandName: "Vichy", mode: "brand", facet: facet("vichy", "Vichy", ["vichy"]) }),
  source({ id: "6023", catalogBrandId: "6023", catalogBrandName: "ISDIN", mode: "brand", facet: facet("isdin", "ISDIN", ["isdin"]) }),
  source({ id: "5756", catalogBrandId: "5756", catalogBrandName: "Cetaphil", mode: "brand", facet: facet("cetaphil", "Cetaphil", ["cetaphil", "cetafil"]) }),
  source({ id: "5697", catalogBrandId: "5697", catalogBrandName: "Aveno", mode: "brand", facet: facet("aveno", "Aveno", ["aveno", "aveeno"]) }),
  source({ id: "5911", catalogBrandId: "5911", catalogBrandName: "ENA", mode: "brand", facet: facet("ena", "ENA", ["ena", "ena suplementos", "ena sport"]) }),
  source({
    id: "9100",
    catalogBrandId: "9100",
    catalogBrandName: "Productos Saludables",
    mode: "category",
    pathname: "/categorias/productos-saludables.html",
    allowsForeignBrandMatch: true,
    facet: facet("productos-saludables", "Productos Saludables", ["productos saludables", "saludables"]),
  }),
  source({
    id: "revitalift",
    catalogBrandId: "revitalift",
    catalogBrandName: "L'Oréal Revitalift",
    mode: "search",
    pathname: "/catalogsearch/result/index/",
    query: "revitalift",
    facet: facet("loreal-revitalift", "L'Oréal Revitalift", ["loreal revitalift", "l'oréal revitalift", "revitalift"]),
  }),
  source({ id: "6116", catalogBrandId: "6116", catalogBrandName: "Neutrogena", mode: "brand", expansion: true, facet: facet("neutrogena", "Neutrogena", ["neutrogena"]) }),
  source({ id: "7236", catalogBrandId: "7236", catalogBrandName: "Omron", mode: "brand", expansion: true, facet: facet("omron", "Omron", ["omron"]) }),
  source({ id: "6827", catalogBrandId: "6827", catalogBrandName: "CeraVe", mode: "brand", expansion: true, facet: facet("cerave", "CeraVe", ["cerave", "cera ve"]) }),
  source({
    id: "dermocosmetica-activa",
    catalogBrandId: "dermocosmetica-activa",
    catalogBrandName: "Dermocosmetica Activa",
    mode: "category",
    pathname: "/categorias/dermocosmetica.html",
    expansion: true,
    membershipOnly: true,
    facet: facet("dermocosmetica-activa", "Dermocosmetica Activa", ["dermocosmetica activa", "dermocosmética activa", "dermocosmetica"]),
  }),
  source({
    id: "cuidado-de-la-piel",
    catalogBrandId: "cuidado-de-la-piel",
    catalogBrandName: "Cuidado de la Piel",
    mode: "category",
    pathname: "/categorias/cuidado-de-la-piel.html",
    expansion: true,
    membershipOnly: true,
    facet: facet("cuidado-de-la-piel", "Cuidado de la Piel", ["cuidado de la piel", "skin care", "skincare"]),
  }),
]);

export const GPS_EXPANSION_SOURCES_V7_BETA = Object.freeze(
  GPS_SOURCES_V7_BETA.filter((entry) => entry.expansion),
);

export function sourceByIdV7Beta(sourceId) {
  return GPS_SOURCES_V7_BETA.find((entry) => String(entry.id) === String(sourceId));
}
