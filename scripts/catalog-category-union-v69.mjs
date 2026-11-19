// Numeric category keys are a separate additive query from brand-name unions.
export function categoryKeysV69(query) {
  if (!/^\s*\d+\s*(?:\+\s*\d+\s*)*$/.test(String(query))) return null;
  const keys = String(query).split('+').map(term => Number(term.trim()));
  if (keys.some(key => !Number.isSafeInteger(key) || key <= 0)) return null;
  return [...new Set(keys.map(String))];
}

export function categoryUnionV69(products, query) {
  if (!String(query).includes('+')) return null;
  const terms = categoryKeysV69(query);
  if (!terms) return null;
  const selected = new Set(terms);
  const productIds = new Set(products.filter(product =>
    (product.magentoCategories || []).some(category => selected.has(String(category.id)))
  ).map(product => product.publicId));
  return { terms, productIds };
}

export function categoryQueryTitleV69(query, paths = {}) {
  const keys = categoryKeysV69(query);
  if (!keys) return '';
  const selected = keys.map(key => Array.isArray(paths[key]) && paths[key].length ? paths[key] : [`Categoría ${key}`]);
  if (selected.length === 1) return Array.isArray(paths[keys[0]]) && paths[keys[0]].length ? selected[0].join(' › ') : '';
  let common = 0;
  while (selected.every(path => common < path.length - 1 && path[common] === selected[0][common])) common++;
  const leaves = selected.map(path => path[path.length - 1]);
  const labels = selected.map((path, index) => leaves.filter(leaf => leaf === leaves[index]).length > 1
    ? path.slice(common).join(' › ') : leaves[index]);
  return [...selected[0].slice(0, common), labels.join(' + ')].join(' › ');
}
