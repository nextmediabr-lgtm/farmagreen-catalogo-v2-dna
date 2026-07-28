import { trustedSourceUrl } from "./gpsfarma-http.mjs";

const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  nbsp: " ",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
};

export function decodeEntities(value) {
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token) => {
    if (token[0] !== "#") return NAMED_ENTITIES[token.toLowerCase()] ?? entity;
    const hexadecimal = token[1]?.toLowerCase() === "x";
    const codePoint = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    const validCodePoint =
      Number.isInteger(codePoint) &&
      codePoint >= 0 &&
      codePoint <= 0x10ffff &&
      !(codePoint >= 0xd800 && codePoint <= 0xdfff);
    return validCodePoint ? String.fromCodePoint(codePoint) : entity;
  });
}

export function textFromHtml(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<(br|\/p|\/li)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeIdentity(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeProductText(value) {
  return decodeEntities(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fps|spf)\s*(\d+)/g, "fps $2")
    .replace(/\b(grs?|gramos?)\b/g, "g")
    .replace(/\b(caps?|capsulas?)\b/g, "capsulas")
    .replace(/\bmililitros?\b/g, "ml")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function productTextTokens(value) {
  return new Set(
    normalizeProductText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !["de", "del", "con", "para", "por", "la", "el", "los", "las"].includes(token)),
  );
}

export function productTitleMatchScore(left, right) {
  const normalizedLeft = normalizeProductText(left);
  const normalizedRight = normalizeProductText(right);
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    const coverage =
      Math.min(normalizedLeft.length, normalizedRight.length) /
      Math.max(normalizedLeft.length, normalizedRight.length);
    return coverage >= 0.72 ? 0.9 + coverage * 0.09 : coverage * 0.73;
  }
  const leftTokens = productTextTokens(left);
  const rightTokens = productTextTokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  const jaccard = intersection / union;
  const containment = intersection / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  return jaccard * 0.62 + containment * 0.38;
}

export function criticalVariantTokens(value) {
  const tokens = normalizeProductText(value).split(" ").filter(Boolean);
  const variants = new Set();
  const units = new Map([
    ["ml", "ml"],
    ["l", "l"],
    ["mg", "mg"],
    ["g", "g"],
    ["kg", "kg"],
    ["capsulas", "capsulas"],
    ["comprimido", "comprimidos"],
    ["comprimidos", "comprimidos"],
    ["tableta", "tabletas"],
    ["tabletas", "tabletas"],
    ["sobre", "sobres"],
    ["sobres", "sobres"],
    ["dosis", "dosis"],
    ["unidad", "unidades"],
    ["unidades", "unidades"],
    ["ampolla", "ampollas"],
    ["ampollas", "ampollas"],
  ]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "plus") {
      variants.add("plus");
      continue;
    }
    const compactMeasure = token.match(/^(\d+(?:\.\d+)?)(ml|mg|kg|grs?|g|l)$/);
    if (compactMeasure) {
      variants.add(`measure:${compactMeasure[2].startsWith("gr") ? "g" : compactMeasure[2]}:${compactMeasure[1]}`);
      continue;
    }
    if (/^[a-z0-9]+$/.test(token) && /[a-z]/.test(token) && /\d/.test(token)) {
      variants.add(`code:${token}`);
      continue;
    }
    if (!/^\d+(?:\.\d+)?$/.test(token)) continue;

    const previous = tokens[index - 1] || "";
    const next = tokens[index + 1] || "";
    const following = tokens[index + 2] || "";
    const compactUnit = next.match(/^(ml|mg|kg|g|l)$/)?.[1];
    const unit = units.get(next) || compactUnit;

    if (previous === "fps") {
      variants.add(`fps:${token}`);
    } else if (unit) {
      variants.add(`measure:${unit}:${token}`);
    } else if (next === "x" && /^\d+(?:\.\d+)?$/.test(following)) {
      variants.add(`pack:${token}`);
    } else if (next === "x" && following) {
      variants.add(`code:${token}x`);
    } else {
      variants.add(`number:${token}`);
    }
  }

  return variants;
}

export function criticalVariantsAgree(left, right) {
  const leftTokens = criticalVariantTokens(left);
  const rightTokens = criticalVariantTokens(right);
  return (
    leftTokens.size === rightTokens.size &&
    [...leftTokens].every((token) => rightTokens.has(token))
  );
}

export function productLinks(html, origin) {
  const links = [];
  for (const item of String(html || "").matchAll(
    /<li\b[^>]*class="[^"]*\bproduct-item\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
  )) {
    const block = item[1];
    const brandHtml = block.match(
      /<div\b[^>]*class="[^"]*\bproduct-item-brand\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    )?.[1];
    const link = block.match(
      /<a\b([^>]*class="[^"]*\bproduct-item-link\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/i,
    );
    const href = link?.[1].match(/\bhref="([^"]+)"/i)?.[1];
    const sourceName = textFromHtml(link?.[2]);
    const sourceBrand = textFromHtml(brandHtml);
    if (!href || !sourceName || !sourceBrand) continue;
    try {
      links.push({
        sourceUrl: trustedSourceUrl(decodeEntities(href), origin),
        sourceName,
        sourceBrand,
      });
    } catch {
      // Ignore links outside the single extraction origin.
    }
  }
  return links;
}

export function candidateBrandMatchesProduct(product, candidate) {
  const sourceBrand = normalizeIdentity(candidate?.sourceBrand);
  if (!sourceBrand) return false;
  const declaredBrands = [product?.brand?.name, ...(product?.brand?.aliases || [])]
    .map(normalizeIdentity)
    .filter(Boolean);
  const compactSourceBrand = sourceBrand.replace(/\s+/g, "");
  if (
    declaredBrands.some(
      (declaredBrand) =>
        declaredBrand === sourceBrand || declaredBrand.replace(/\s+/g, "") === compactSourceBrand,
    )
  ) {
    return true;
  }

  const virtualBrand = normalizeIdentity(product?.brand?.slug) === "productos saludables";
  if (!virtualBrand || sourceBrand.length < 4) return false;
  const productName = normalizeIdentity(product?.name);
  return ` ${productName} `.includes(` ${sourceBrand} `);
}

export function bestProductCandidate(product, candidates) {
  const ranked = (candidates || [])
    .filter(
      (candidate) =>
        candidateBrandMatchesProduct(product, candidate) &&
        criticalVariantsAgree(product?.name, candidate.sourceName),
    )
    .map((candidate) => ({ candidate, score: productTitleMatchScore(product?.name, candidate.sourceName) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.score < 0.74) return null;
  if (
    best.score < 0.98 &&
    productTextTokens(best.candidate.sourceName).size < 2 &&
    productTextTokens(product?.name).size > 2
  ) {
    return null;
  }
  if (best.score < 0.98 && runnerUp && best.score - runnerUp.score < 0.035) return null;
  return { ...best.candidate, confidence: Number(best.score.toFixed(4)) };
}
