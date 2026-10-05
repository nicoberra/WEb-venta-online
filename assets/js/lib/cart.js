// Lógica del carrito, separada de la interfaz para poder probarla.
// El carrito guarda solo IDs y cantidades: nombres, precios y disponibilidad
// se toman SIEMPRE del catálogo vigente (y el backend vuelve a validarlos).

const lineKey = (productId, variantId) => `${productId}::${variantId || ''}`;

export function createCart(storage, storageKey = 'tienda-carrito-v1') {
  let items = [];
  try {
    const saved = JSON.parse(storage?.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) items = saved.filter((i) => i && i.productId && Number.isInteger(i.qty) && i.qty > 0);
  } catch { items = []; }
  const listeners = new Set();
  const persist = () => {
    try { storage?.setItem(storageKey, JSON.stringify(items)); } catch { /* modo privado: solo en memoria */ }
    listeners.forEach((fn) => fn(items));
  };
  return {
    get items() { return items.map((i) => ({ ...i })); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    add(productId, variantId, qty = 1, maxQty = Infinity) {
      const k = lineKey(productId, variantId);
      const found = items.find((i) => lineKey(i.productId, i.variantId) === k);
      const next = Math.min((found?.qty || 0) + qty, maxQty);
      if (next < 1) return 0;
      if (found) found.qty = next;
      else items.push({ productId, variantId: variantId || '', qty: next });
      persist();
      return next;
    },
    setQty(productId, variantId, qty, maxQty = Infinity) {
      const k = lineKey(productId, variantId);
      const q = Math.min(Math.max(0, Math.floor(Number(qty) || 0)), maxQty);
      items = q ? items.map((i) => (lineKey(i.productId, i.variantId) === k ? { ...i, qty: q } : i))
        : items.filter((i) => lineKey(i.productId, i.variantId) !== k);
      persist();
    },
    remove(productId, variantId) { this.setQty(productId, variantId, 0); },
    clear() { items = []; persist(); },
    count() { return items.reduce((a, i) => a + i.qty, 0); },
    /** Firma del contenido: cambia si cambia cualquier línea. */
    signature() { return items.map((i) => `${lineKey(i.productId, i.variantId)}x${i.qty}`).sort().join('|'); }
  };
}

/**
 * Cruza el carrito con el catálogo vigente.
 * @return {{lines: Array, subtotal: number, problems: Array, count: number}}
 */
export function priceCart(items, catalog) {
  const byId = new Map((catalog?.products || []).map((p) => [p.id, p]));
  const lines = [];
  const problems = [];
  for (const it of items) {
    const p = byId.get(it.productId);
    const variant = p && it.variantId ? p.variants.find((v) => v.id === it.variantId) : null;
    let issue = null;
    if (!p) issue = 'Ya no está disponible.';
    else if (p.variants.length && !variant) issue = 'La variante elegida ya no está disponible.';
    else if (!p.variants.length && it.variantId) issue = 'La variante elegida ya no está disponible.';
    else if (variant ? !variant.available : !p.available) issue = 'Agotado.';
    const maxQty = variant ? variant.maxQty : p?.maxQty ?? 0;
    if (!issue && maxQty != null && it.qty > maxQty) issue = `Solo hay ${maxQty} disponibles.`;
    const unitPrice = variant ? variant.price : p?.price ?? 0;
    const line = {
      ...it, product: p || null, variant: variant || null, name: p?.name || 'Producto no disponible',
      variantName: variant?.name || '', unitPrice, lineTotal: issue ? 0 : unitPrice * it.qty, maxQty, issue
    };
    if (issue) problems.push(line);
    lines.push(line);
  }
  const subtotal = Math.round(lines.reduce((a, l) => a + l.lineTotal, 0) * 100) / 100;
  return { lines, subtotal, problems, count: items.reduce((a, i) => a + i.qty, 0) };
}
