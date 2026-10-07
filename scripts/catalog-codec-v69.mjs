// Lossless transport adapted from V7.0. Encode only the privacy-filtered public
// DTO; catalogue freshness, publication checks and image selection stay in V6.9.
export function encodeCatalogV69(catalog, revision) {
  const tables = { brands: [], categories: [], views: [], variants: [], prefixes: [] };
  const indexes = Object.fromEntries(Object.keys(tables).map(key => [key, new Map()]));
  const intern = (key, value) => {
    const signature = JSON.stringify(value);
    if (!indexes[key].has(signature)) {
      indexes[key].set(signature, tables[key].length);
      tables[key].push(value);
    }
    return indexes[key].get(signature);
  };
  const imageValue = value => {
    if (typeof value === "string") {
      if (value.startsWith("https://")) {
        const split = value.lastIndexOf("/") + 1;
        return `@${intern("prefixes", value.slice(0, split))}:${value.slice(split)}`;
      }
      return value.startsWith("@") ? `@${value}` : value;
    }
    if (Array.isArray(value)) return value.map(imageValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, imageValue(v)]));
    return value;
  };
  const { products, ...metadata } = catalog;
  return {
    format: "farmagreen-catalog-v69/1", revision, metadata, tables,
    products: products.map(product => {
      const packed = { ...product, brand: intern("brands", product.brand) };
      if (product.magentoCategories) packed.magentoCategories = product.magentoCategories.map(value => intern("categories", value));
      if (product.catalogViews) packed.catalogViews = product.catalogViews.map(value => intern("views", value));
      if (product.images) {
        packed.images = imageValue(product.images);
        if (packed.images.responsive) packed.images.responsive = Object.fromEntries(
          Object.entries(packed.images.responsive).map(([kind, value]) => [kind, intern("variants", value)]),
        );
      }
      return packed;
    }),
  };
}

export function decodeCatalogV69(payload) {
  // An old server/cache can still return the full DTO during a rolling release.
  if (!payload?.format) return payload;
  if (payload.format !== "farmagreen-catalog-v69/1") throw new Error("Formato de catálogo incompatible.");
  const { tables } = payload;
  // Keep Safari support without Object.fromEntries or an extra polyfill.
  const fromEntries = entries => {
    const result = {};
    for (const [key, value] of entries) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
    return result;
  };
  const get = (key, index) => {
    if (!Array.isArray(tables?.[key]) || !Number.isInteger(index) || index < 0 || index >= tables[key].length) throw new Error("Referencia de catálogo inválida.");
    return tables[key][index];
  };
  const imageValue = value => {
    if (typeof value === "string" && value.startsWith("@")) {
      if (value.startsWith("@@")) return value.slice(1);
      const match = value.match(/^@(\d+):([\s\S]*)$/);
      if (!match) throw new Error("Referencia de imagen inválida.");
      return get("prefixes", Number(match[1])) + match[2];
    }
    if (Array.isArray(value)) return value.map(imageValue);
    if (value && typeof value === "object") return fromEntries(Object.entries(value).map(([k, v]) => [k, imageValue(v)]));
    return value;
  };
  return {
    ...payload.metadata,
    products: payload.products.map(product => {
      const expanded = { ...product, brand: get("brands", product.brand) };
      if (product.magentoCategories) expanded.magentoCategories = product.magentoCategories.map(index => get("categories", index));
      if (product.catalogViews) expanded.catalogViews = product.catalogViews.map(index => get("views", index));
      if (product.images) {
        const images = { ...product.images };
        if (images.responsive) images.responsive = fromEntries(Object.entries(images.responsive).map(([kind, index]) => [kind, get("variants", index)]));
        expanded.images = imageValue(images);
      }
      return expanded;
    }),
  };
}
