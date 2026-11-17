// Coupon context travels explicitly in the URL, never in shared browser storage.
export function couponCodeV69(value) {
  return typeof value === "string" && /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(value) ? value : "";
}

export function couponContextUrlV69(href, value, base, basePath = "") {
  const code = couponCodeV69(value);
  if (!code || !href || href.startsWith("#")) return href;
  let target, current;
  try {
    current = new URL(base);
    target = new URL(href, current);
  } catch {
    return href;
  }
  if (target.origin === current.origin) {
    const prefix = basePath.replace(/\/$/, "");
    if (prefix && !target.pathname.startsWith(prefix + "/") && target.pathname !== prefix) return href;
    const route = target.pathname.slice(prefix.length) || "/";
    if (!/^\/(?:catalogo(?:-v6-9)?|p\/[^/]+|marcas(?:\/[^/]+)?|buscar|productos|ofertas)?\/?$/.test(route)) return href;
    target.searchParams.set("cupon", code);
    return href.startsWith("/") ? target.pathname + target.search + target.hash : target.href;
  }
  if (target.protocol === "https:" && target.hostname === "wa.me") {
    const text = target.searchParams.get("text") || "";
    const marker = "Cupón: " + code;
    if (!text.split("\n").includes(marker)) {
      const original = text.replace(/(?:\n|^)Cupón: [A-Z0-9][A-Z0-9-]{2,31}(?=\n|$)/g, "");
      target.searchParams.set("text", original + (original ? "\n" : "") + marker);
    }
    return target.href;
  }
  return href;
}
