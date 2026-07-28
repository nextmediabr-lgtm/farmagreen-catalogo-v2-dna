import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = path.join(ROOT, "data", "catalog-v67.json");
const SOURCE = path.join(ROOT, "data", "gpsfarma-v68-source.json");
const TAXONOMY_AUDIT = path.join(ROOT, "data", "v68-taxonomy-audit.json");
const OUTPUT = path.join(ROOT, "data", "catalog-v68.json");
const DUPLICATE_TO_REMOVE = "e58ab2ba2993";
const METADATA_ONLY_DESCRIPTION =
  "La ficha todavía no incluye una descripción ampliada de este producto.";
const DETAIL_PENDING_DESCRIPTION =
  "Información detallada pendiente de publicación.";

const VALID_NEEDS = new Set([
  "manchas",
  "acne",
  "piel-sensible",
  "hidratacion",
  "limpieza",
  "solares",
  "capilar",
  "antiedad",
  "reparacion",
  "nutricion",
  "cuidado-diario",
]);

const TAXONOMY_REASONER_VERSION = "v68.2-primary-intent";
const TAXONOMY_TARGET_PRECISION = 0.95;
const MAX_NEEDS_PER_PRODUCT = 2;
const CATEGORY_NEEDS = new Map([
  ["nutricion", "nutricion"],
  ["solares", "solares"],
  ["capilar", "capilar"],
  ["limpieza", "limpieza"],
  ["bebe", "piel-sensible"],
]);
const DOMINANT_CATEGORY_NEEDS = new Set(["nutricion", "solares", "capilar"]);
const NEED_RULES = [
  {
    need: "limpieza",
    rule: "product-type-cleanser",
    pattern:
      /\b(limpieza|limpiador\w*|micelar|micellar|desmaquillante|(?:micro)?exfoliante|jabon|syndet|gel de bano|purifier|purificante|moussant)\b/,
  },
  {
    need: "solares",
    rule: "product-type-sun",
    pattern: /\b(protector solar|fotoprotector|fotoproteccion|post solar|autobronceante|bronceador|fps|spf|sun)\b/,
  },
  {
    need: "capilar",
    rule: "product-type-hair",
    pattern: /\b(capilar|cabello|cuero cabelludo|shampoo|acondicionador|dercos|anticaida|caspa)\b/,
  },
  {
    need: "acne",
    rule: "explicit-acne-intent",
    pattern:
      /\b(acne|acniben|antiacne|comedones?|sebo(?:r)?regulador|imperfecciones|effaclar|normaderm|dermopure|granos?)\b/,
  },
  {
    need: "manchas",
    rule: "explicit-pigment-intent",
    pattern:
      /\b(manchas?|anti pigment|antipigment\w*|despigment\w*|melaclear|malaclear|melasma|pigment\w*|mela b3|tono desigual)\b/,
  },
  {
    need: "piel-sensible",
    rule: "explicit-sensitive-skin-intent",
    pattern:
      /\b(piel sensible|sensibilidad|atopi\w*|nutratopic|rosacea|rojeces|antirojeces|hipoalergen\w*|pediatrics|pediatrico|bebe|infantil|irritada|irritacion)\b/,
  },
  {
    need: "hidratacion",
    rule: "explicit-hydration-intent",
    pattern:
      /\b(hidrat\w*|hydra\w*|hyalu b5|moistur\w*|humect\w*|emoliente|piel seca|xerosis|nutritiva|ultra hidra|lipikar|mineral 89|ureadin|urea ?repair)\b/,
  },
  {
    need: "hidratacion",
    rule: "hyaluronic-hydration-intent",
    pattern: /\b(hialuron\w*|hyal+uron\w*)\b/,
    excludePattern: /\bfiller\b/,
  },
  {
    need: "antiedad",
    rule: "explicit-age-intent",
    pattern:
      /\b(antiedad|anti edad|antiage|anti aging|antiarrugas?|arrugas?|retinol|retinal\w*|pro retinol|filler|lift?activ|revitalift|neovadiol|firmeza|reafirmante|ultra volumen|ultra estructura|colageno|q10|age repair|age reverse)\b/,
  },
  {
    need: "reparacion",
    rule: "explicit-repair-intent",
    pattern:
      /\b(repar\w*|repair\w*|restaur\w*|regener\w*|cicatriz\w*|barrera cutanea|cicaplast|aquaphor|estrias|antiestrias|fortalecedor|labial|labios agrietados|urea ?repair)\b/,
  },
];
const NEED_PRIORITY = new Map();
for (const [index, entry] of NEED_RULES.entries()) {
  if (!NEED_PRIORITY.has(entry.need)) NEED_PRIORITY.set(entry.need, index);
}

const SUMMARY_HEADINGS = new Set([
  "descripcion",
  "informacion del producto",
  "que es",
]);

const OMITTED_HEADINGS = new Set([
  "cantidad",
  "presentacion",
]);

const SECTION_HEADINGS = new Map([
  ["beneficios", { id: "beneficios", title: "Beneficios", kind: "list" }],
  ["beneficios clave", { id: "beneficios", title: "Beneficios", kind: "list" }],
  ["efectos y beneficios", { id: "beneficios", title: "Beneficios", kind: "list" }],
  ["composicion", { id: "composicion", title: "Composición", kind: "text" }],
  ["ingredientes", { id: "composicion", title: "Composición", kind: "text" }],
  ["modo de uso", { id: "modo-de-uso", title: "Modo de uso", kind: "steps" }],
  ["como se aplica", { id: "modo-de-uso", title: "Modo de uso", kind: "steps" }],
  ["aplicacion", { id: "aplicacion", title: "Aplicación", kind: "steps" }],
  ["indicaciones", { id: "indicaciones", title: "Indicaciones", kind: "list" }],
  ["propiedades", { id: "propiedades", title: "Propiedades", kind: "list" }],
  ["especificaciones", { id: "especificaciones", title: "Especificaciones", kind: "list" }],
  ["recomendacion dermatologica", { id: "recomendacion", title: "Recomendación dermatológica", kind: "text" }],
  ["textura", { id: "textura", title: "Textura", kind: "text" }],
  ["cuando", { id: "cuando", title: "Cuándo usarlo", kind: "text" }],
  ["donde", { id: "donde", title: "Dónde aplicarlo", kind: "text" }],
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function tidy(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/#html-body\s+\[data-pb-style=[^\]]+\]\{[^}]*\}\s*/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeCorporateBoilerplate(value) {
  let removed = 0;
  const description = tidy(value).replace(
    /Somos una de las empresas l[ií]deres[\s\S]*?nuestra piel es mucho m[aá]s que el escudo protector de nuestro cuerpo\.?/gi,
    () => {
      removed += 1;
      return "";
    },
  );
  return { description: tidy(description), removed };
}

function cleanDetailLine(value) {
  return tidy(value)
    .replace(/^(?:[•*-]\s*|\d+\s*[.)]\s*)/, "")
    .trim();
}

function separateRecognizedHeadings(value) {
  let text = tidy(value);
  const uppercaseHeadings = [
    "INFORMACIÓN DEL PRODUCTO",
    "INFORMACION DEL PRODUCTO",
    "BENEFICIOS CLAVE",
    "EFECTOS Y BENEFICIOS",
    "RECOMENDACIÓN DERMATOLÓGICA",
    "RECOMENDACION DERMATOLOGICA",
    "ESPECIFICACIONES",
    "COMPOSICIÓN",
    "COMPOSICION",
    "INGREDIENTES",
    "MODO DE USO",
    "INDICACIONES",
    "PROPIEDADES",
    "PRESENTACIÓN",
    "PRESENTACION",
    "APLICACIÓN",
    "APLICACION",
    "BENEFICIOS",
    "DESCRIPCIÓN",
    "DESCRIPCION",
    "CANTIDAD",
    "TEXTURA",
  ];

  const headingPattern = new RegExp(
    uppercaseHeadings
      .sort((left, right) => right.length - left.length)
      .map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "g",
  );
  text = text.replace(headingPattern, (heading) => `\n${heading}\n`);

  return tidy(
    text
      .replace(/(Modo de uso|Composición|Aplicación|Indicaciones|Ingredientes)\s*[.:]\s*/g, "\n$1\n")
      .replace(/(^|[.!?])\s*(Beneficios|Propiedades|Especificaciones)\s*[.:]\s*/g, "$1\n$2\n"),
  );
}

function splitSectionContent(value, kind) {
  const text = tidy(value);
  if (!text) return [];
  if (kind === "steps") {
    return text
      .split(/(?=\d+\s*[.)]\s*)/)
      .map(cleanDetailLine)
      .filter(Boolean);
  }
  if (kind === "list") {
    return text
      .split(/\s*[-•]\s+(?=\S)/)
      .map(cleanDetailLine)
      .filter(Boolean);
  }
  return [cleanDetailLine(text)].filter(Boolean);
}

function isAllCapsMetadata(value) {
  const text = tidy(value);
  const letters = text.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || [];
  return letters.length >= 8 && text === text.toUpperCase() && !/[.!?](?:\s|$)/.test(text);
}

function isGenericTitleFragment(value, productName) {
  const description = normalize(value);
  const name = normalize(productName);
  const words = description.split(" ").filter(Boolean);
  const nameWords = new Set(name.split(" ").filter(Boolean));
  return (
    description.length < 34 &&
    words.length <= 4 &&
    words.every((word) => nameWords.has(word))
  );
}

function lowInformationReason(value, productName) {
  const description = tidy(value);
  if (isAllCapsMetadata(description)) return "warehouse-metadata";
  if (normalize(description) === normalize(productName)) return "title-only";
  if (isGenericTitleFragment(description, productName)) return "generic-title-fragment";
  return "";
}

function structuredDetail(value, productName, sourceUrl) {
  const withoutBoilerplate = removeCorporateBoilerplate(value);
  if (withoutBoilerplate.description === DETAIL_PENDING_DESCRIPTION) {
    return {
      description: DETAIL_PENDING_DESCRIPTION,
      detail: {
        summary: [DETAIL_PENDING_DESCRIPTION],
        sections: [],
      },
      quality: "pending",
      reason: "source-detail-pending",
      removedCorporateBoilerplate: withoutBoilerplate.removed,
      removedDuplicatePresentation: false,
    };
  }

  const lowInformation = lowInformationReason(withoutBoilerplate.description, productName);
  if (lowInformation) {
    return {
      description: sourceUrl ? METADATA_ONLY_DESCRIPTION : DETAIL_PENDING_DESCRIPTION,
      detail: {
        summary: [sourceUrl ? METADATA_ONLY_DESCRIPTION : DETAIL_PENDING_DESCRIPTION],
        sections: [],
      },
      quality: sourceUrl ? "metadata-only" : "pending",
      reason: lowInformation,
      removedCorporateBoilerplate: withoutBoilerplate.removed,
      removedDuplicatePresentation: false,
    };
  }

  const summary = [];
  const sections = [];
  let current = { id: "summary", content: summary };
  let removedDuplicatePresentation = false;

  for (const rawLine of separateRecognizedHeadings(withoutBoilerplate.description).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = normalize(line.replace(/:+$/, ""));
    if (SUMMARY_HEADINGS.has(heading)) {
      current = { id: "summary", content: summary };
      continue;
    }
    if (OMITTED_HEADINGS.has(heading)) {
      current = null;
      removedDuplicatePresentation = true;
      continue;
    }
    const sectionDefinition = SECTION_HEADINGS.get(heading);
    if (sectionDefinition) {
      const section = { ...sectionDefinition, content: [] };
      sections.push(section);
      current = section;
      continue;
    }
    if (!current) continue;
    const content = splitSectionContent(line, current.kind || "text");
    current.content.push(...content);
  }

  const usefulSections = sections.filter((section) => section.content.length);
  const usefulSummary = summary.filter(Boolean);
  const flattened = [
    ...usefulSummary,
    ...usefulSections.flatMap((section) => section.content),
  ].join("\n\n");

  if (!flattened) {
    return {
      description: sourceUrl ? METADATA_ONLY_DESCRIPTION : DETAIL_PENDING_DESCRIPTION,
      detail: {
        summary: [sourceUrl ? METADATA_ONLY_DESCRIPTION : DETAIL_PENDING_DESCRIPTION],
        sections: [],
      },
      quality: sourceUrl ? "metadata-only" : "pending",
      reason: "empty-after-normalization",
      removedCorporateBoilerplate: withoutBoilerplate.removed,
      removedDuplicatePresentation,
    };
  }

  return {
    description: flattened,
    detail: { summary: usefulSummary, sections: usefulSections },
    quality: "structured",
    reason: "",
    removedCorporateBoilerplate: withoutBoilerplate.removed,
    removedDuplicatePresentation,
  };
}

function completeSourceFragment(value) {
  const clean = tidy(value).replace(/(?:\.{3}|…)\s*$/, "").trim();
  const sentenceEnds = [...clean.matchAll(/[.!?](?=\s|$)/g)];
  const last = sentenceEnds.at(-1);
  return last && last.index >= 44 ? clean.slice(0, last.index + 1) : "";
}

function descriptionFor(product, source) {
  const sourceDescription = tidy(source?.description);
  const sourceOverview = tidy(source?.overview);
  const original = tidy(product.description);

  if (sourceDescription.length >= 45 && !/(?:\.{3}|…)$/.test(sourceDescription)) {
    return { description: sourceDescription, status: "gpsfarma-complete" };
  }
  if (sourceDescription && !/(?:\.{3}|…)$/.test(sourceDescription)) {
    return { description: sourceDescription, status: "gpsfarma-brief" };
  }
  if (sourceOverview && !/(?:\.{3}|…)$/.test(sourceOverview)) {
    return { description: sourceOverview, status: "gpsfarma-overview" };
  }
  if (original && !/(?:\.{3}|…)$/.test(original) && normalize(original) !== normalize(product.name)) {
    return { description: original, status: "gpsfarma-base-complete" };
  }
  const fragment = completeSourceFragment(original);
  if (fragment) return { description: fragment, status: "gpsfarma-base-complete-sentences" };
  return {
    description: DETAIL_PENDING_DESCRIPTION,
    status: "gpsfarma-detail-pending",
  };
}

function reasonedNeeds(product, productName) {
  const originalNeeds = unique((product.needs || []).filter((need) => VALID_NEEDS.has(need)));
  const originalNeedSet = new Set(originalNeeds);
  const nameEvidence = normalize(productName);
  const lineEvidence = normalize(product.line);
  const compositeLine = /[/|]/.test(String(product.line || ""));
  const candidates = new Map();

  function addCandidate(need, confidence, source, field, rule) {
    const current = candidates.get(need);
    if (!current || confidence > current.confidence) {
      candidates.set(need, { need, confidence, source, field, rule });
    }
  }

  const categoryNeed = CATEGORY_NEEDS.get(product.primaryCategory);
  if (categoryNeed) {
    addCandidate(
      categoryNeed,
      0.99,
      "primary-category",
      "primaryCategory",
      `category-${product.primaryCategory}`,
    );
  }

  for (const definition of NEED_RULES) {
    const excludedForRule =
      (definition.excludePattern?.test(nameEvidence) || false) ||
      (definition.excludePattern?.test(lineEvidence) || false);
    const nameMatch =
      definition.pattern.test(nameEvidence) &&
      !excludedForRule;
    const lineMatch =
      !compositeLine &&
      definition.pattern.test(lineEvidence) &&
      !excludedForRule;
    if (!nameMatch && !lineMatch) continue;
    const corroborated = originalNeedSet.has(definition.need);
    addCandidate(
      definition.need,
      nameMatch ? (corroborated ? 0.99 : 0.98) : (corroborated ? 0.97 : 0.95),
      nameMatch
        ? (corroborated ? "name+inherited" : "name")
        : (corroborated ? "line+inherited" : "line"),
      nameMatch ? "name" : "line",
      definition.rule,
    );
  }

  const dominantNeed = DOMINANT_CATEGORY_NEEDS.has(categoryNeed) ? categoryNeed : "";
  const ranked = [...candidates.values()].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      (NEED_PRIORITY.get(left.need) ?? Number.MAX_SAFE_INTEGER) -
        (NEED_PRIORITY.get(right.need) ?? Number.MAX_SAFE_INTEGER),
  );
  const selected = dominantNeed
    ? ranked.filter((entry) => entry.need === dominantNeed)
    : ranked.slice(0, MAX_NEEDS_PER_PRODUCT);

  if (!selected.length) {
    selected.push({
      need: product.primaryCategory === "bebe" ? "piel-sensible" : "cuidado-diario",
      confidence: null,
      source: "fallback",
      field: "fallback",
      rule: "no-specific-high-confidence-intent",
    });
  }

  const selectedNeeds = new Set(selected.map((entry) => entry.need));
  const rejected = unique([
    ...originalNeeds.filter((need) => !selectedNeeds.has(need)),
    ...ranked.filter((entry) => !selectedNeeds.has(entry.need)).map((entry) => entry.need),
  ]).map((need) => ({
    need,
    reason: dominantNeed
      ? "dominant-category"
      : candidates.has(need)
        ? "max-two-primary-intents"
        : "insufficient-strong-evidence",
  }));

  return {
    needs: selected.map((entry) => entry.need),
    taxonomy: {
      reasonerVersion: TAXONOMY_REASONER_VERSION,
      targetPrecision: TAXONOMY_TARGET_PRECISION,
      evidenceScope: ["name", "line", "primaryCategory"],
      excludedEvidence: ["description", "instructions", "aliases"],
      ignoredLineEvidence: compositeLine ? "composite-line-label" : null,
      originalNeeds,
      selected,
      rejected,
    },
  };
}

function taxonomyAuditSummary(products, audit) {
  if (audit.reasonerVersion !== TAXONOMY_REASONER_VERSION) {
    throw new Error(
      `Taxonomy audit targets ${audit.reasonerVersion}, expected ${TAXONOMY_REASONER_VERSION}`,
    );
  }
  if (!Number.isInteger(audit.samplePerNeed) || audit.samplePerNeed < 1) {
    throw new Error("Taxonomy audit samplePerNeed must be a positive integer");
  }

  const expectedLabels = [];
  const populations = {};
  for (const need of audit.needs) {
    const decisions = products
      .flatMap((product) =>
        product.taxonomy.selected
          .filter((entry) => entry.need === need && entry.source !== "fallback")
          .map(() => ({ publicId: product.publicId, need })),
      )
      .sort((left, right) => {
        const leftRank = createHash("sha256")
          .update(`${audit.seed}|${left.publicId}|${left.need}`)
          .digest("hex");
        const rightRank = createHash("sha256")
          .update(`${audit.seed}|${right.publicId}|${right.need}`)
          .digest("hex");
        return leftRank.localeCompare(rightRank);
      });
    populations[need] = decisions.length;
    if (decisions.length < audit.samplePerNeed) {
      throw new Error(`Taxonomy audit needs ${audit.samplePerNeed} ${need} decisions`);
    }
    expectedLabels.push(...decisions.slice(0, audit.samplePerNeed));
  }

  const keyFor = (entry) => `${entry.publicId}|${entry.need}`;
  const expectedKeys = expectedLabels.map(keyFor);
  const actualKeys = audit.labels.map(keyFor);
  if (
    expectedKeys.length !== actualKeys.length ||
    expectedKeys.some((key, index) => key !== actualKeys[index])
  ) {
    throw new Error(
      "Taxonomy audit labels no longer match the deterministic sample; review and relabel before building",
    );
  }
  if (new Set(actualKeys).size !== actualKeys.length) {
    throw new Error("Taxonomy audit labels contain duplicates");
  }
  if (audit.labels.some((entry) => typeof entry.valid !== "boolean")) {
    throw new Error("Every taxonomy audit label must declare valid=true or valid=false");
  }

  const valid = audit.labels.filter((entry) => entry.valid).length;
  const reviewed = audit.labels.length;
  const precision = reviewed ? valid / reviewed : 0;
  if (precision < TAXONOMY_TARGET_PRECISION) {
    throw new Error(
      `Taxonomy audit precision ${precision.toFixed(3)} is below target ${TAXONOMY_TARGET_PRECISION}`,
    );
  }

  const byNeed = Object.fromEntries(
    audit.needs.map((need) => {
      const labels = audit.labels.filter((entry) => entry.need === need);
      const validForNeed = labels.filter((entry) => entry.valid).length;
      return [
        need,
        {
          population: populations[need],
          reviewed: labels.length,
          valid: validForNeed,
          precision: labels.length ? validForNeed / labels.length : 0,
        },
      ];
    }),
  );

  return {
    version: audit.version,
    method: `sha256-ranked-${audit.samplePerNeed}-per-need`,
    seed: audit.seed,
    reviewed,
    valid,
    invalid: reviewed - valid,
    precision,
    targetPrecision: TAXONOMY_TARGET_PRECISION,
    passes: precision >= TAXONOMY_TARGET_PRECISION,
    ambiguousCountsAsInvalid: audit.review.ambiguousCountsAsInvalid,
    reviewer: audit.review.reviewer,
    reviewedAt: audit.review.reviewedAt,
    externalHumanGold: audit.review.externalHumanGold,
    byNeed,
  };
}

function correctedBrand(product) {
  const brand = { ...product.brand, aliases: unique(product.brand?.aliases || []) };
  if (brand.name === "Aveeno") {
    brand.name = "Aveno";
    brand.aliases = unique([...brand.aliases, "Aveno", "Aveeno"]);
  }
  if (brand.name === "L'oreal Revitalift") {
    brand.name = "L'Oréal Revitalift";
    brand.aliases = unique([...brand.aliases, "L'oreal Revitalift", "Loreal Revitalift", "L'Oréal Revitalift"]);
  }
  return brand;
}

function correctedProductName(product, brand) {
  let name = String(product.name || "");
  if (brand.name === "Aveno") name = name.replace(/\bAveeno\b/g, "Aveno");
  if (brand.name === "L'Oréal Revitalift") {
    name = name.replace(/\bL['’]?oreal\b/gi, "L'Oréal");
  }
  return name;
}

const catalog = JSON.parse(await fs.readFile(INPUT, "utf8"));
const sourceSnapshot = JSON.parse(await fs.readFile(SOURCE, "utf8"));
const taxonomyAudit = JSON.parse(await fs.readFile(TAXONOMY_AUDIT, "utf8"));
const sourceById = new Map(sourceSnapshot.products.map((entry) => [entry.publicId, entry]));
const descriptionStatuses = {};
const extractionStatuses = {};
const normalizationSummary = {
  corporateBoilerplateRemoved: 0,
  duplicatePresentationRemoved: 0,
  metadataOnly: 0,
  pending: 0,
  structured: 0,
};

const products = catalog.products
  .filter((product) => product.publicId !== DUPLICATE_TO_REMOVE)
  .map((product) => {
    const source = sourceById.get(product.publicId);
    const extractedDescription = descriptionFor(product, source);
    extractionStatuses[extractedDescription.status] = (extractionStatuses[extractedDescription.status] || 0) + 1;
    const brand = correctedBrand(product);
    const name = correctedProductName(product, brand);
    const normalizedDetail = structuredDetail(extractedDescription.description, name, source?.sourceUrl || null);
    const taxonomyDecision = reasonedNeeds(product, name);
    const descriptionStatus =
      normalizedDetail.quality === "metadata-only"
        ? "gpsfarma-metadata-only"
        : normalizedDetail.quality === "pending"
          ? "gpsfarma-detail-pending"
          : extractedDescription.status;
    descriptionStatuses[descriptionStatus] = (descriptionStatuses[descriptionStatus] || 0) + 1;
    normalizationSummary.corporateBoilerplateRemoved += normalizedDetail.removedCorporateBoilerplate;
    normalizationSummary.duplicatePresentationRemoved += normalizedDetail.removedDuplicatePresentation ? 1 : 0;
    normalizationSummary[normalizedDetail.quality === "metadata-only" ? "metadataOnly" : normalizedDetail.quality] += 1;
    return {
      ...product,
      name,
      brand,
      aliases: unique([
        ...(product.aliases || []),
        product.name,
        brand.name,
        ...(brand.aliases || []),
      ]),
      needs: taxonomyDecision.needs,
      taxonomy: taxonomyDecision.taxonomy,
      description: normalizedDetail.description,
      detail: normalizedDetail.detail,
      source: {
        provider: "GPSFarma",
        url: source?.sourceUrl || null,
        descriptionStatus,
        extractionStatus: extractedDescription.status,
        contentQuality: normalizedDetail.quality,
        qualityReason: normalizedDetail.reason || null,
        normalizations: [
          ...(normalizedDetail.removedCorporateBoilerplate ? ["removed-corporate-boilerplate"] : []),
          ...(normalizedDetail.removedDuplicatePresentation ? ["removed-duplicate-presentation"] : []),
          ...(normalizedDetail.detail.sections.length ? ["structured-sections"] : []),
        ],
        retrievedAt: sourceSnapshot.fetchedAt,
      },
    };
  });

const auditedTaxonomy = taxonomyAuditSummary(products, taxonomyAudit);
const taxonomyFallbackProducts = products.filter((product) =>
  product.taxonomy.selected.some((entry) => entry.source === "fallback"),
).length;
const taxonomySummary = {
  reasonerVersion: TAXONOMY_REASONER_VERSION,
  targetPrecision: TAXONOMY_TARGET_PRECISION,
  measuredPrecision: auditedTaxonomy.precision,
  precisionBasis: "internal-stratified-audit",
  audit: auditedTaxonomy,
  maxNeedsPerProduct: MAX_NEEDS_PER_PRODUCT,
  evidenceScope: ["name", "line", "primaryCategory"],
  excludedEvidence: ["description", "instructions", "aliases"],
  lineEvidencePolicy: "ignore-composite-line-labels",
  fallbackProducts: taxonomyFallbackProducts,
  specificCoverage: (products.length - taxonomyFallbackProducts) / products.length,
  needs: Object.fromEntries(
    [...VALID_NEEDS].map((need) => [
      need,
      products.filter((product) => product.needs.includes(need)).length,
    ]),
  ),
  selectedBySource: products
    .flatMap((product) => product.taxonomy.selected)
    .reduce((counts, entry) => {
      counts[entry.source] = (counts[entry.source] || 0) + 1;
      return counts;
    }, {}),
  rejectedByReason: products
    .flatMap((product) => product.taxonomy.rejected)
    .reduce((counts, entry) => {
      counts[entry.reason] = (counts[entry.reason] || 0) + 1;
      return counts;
    }, {}),
};

const traceability = {
  sourceUrls: products.filter((product) => product.source.url).length,
  directSourceUrls: products.filter(
    (product) =>
      product.source.url &&
      ["gpsfarma-complete", "gpsfarma-brief", "gpsfarma-overview"].includes(product.source.extractionStatus),
  ).length,
};

const output = {
  ...catalog,
  version: 6.8,
  syncedAt: sourceSnapshot.fetchedAt,
  totalProducts: products.length,
  v68Revision: {
    baseVersion: 6.7,
    baseCommit: "e1b872f39363eb3f9b0f9366c352c1c2149d298d",
    source: sourceSnapshot.source,
    sourceSnapshot: "data/gpsfarma-v68-source.json",
    descriptionStatuses,
    extractionStatuses,
    normalizationSummary,
    taxonomySummary,
    traceability,
    duplicateRemoved: DUPLICATE_TO_REMOVE,
    brandCorrections: {
      Aveeno: "Aveno",
      "L'oreal Revitalift": "L'Oréal Revitalift",
    },
    needPolicy:
      "Primary shopping intent only: dominant category or >=0.95 name/line evidence; descriptions, instructions and aliases excluded; maximum two needs.",
  },
  products,
};

await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);

const summary = {
  products: products.length,
  descriptionsEndingEllipsis: products.filter((product) => /(?:\.{3}|…)$/.test(product.description)).length,
  emptyNeeds: products.filter((product) => !product.needs.length).length,
  duplicateNames: products.length - new Set(products.map((product) => normalize(product.name))).size,
  descriptionStatuses,
  extractionStatuses,
  normalizationSummary,
  taxonomySummary,
  traceability,
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
