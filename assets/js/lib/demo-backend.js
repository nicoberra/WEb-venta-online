// Backend SIMULADO para el modo demostración.
// Imita las acciones de backend/apps-script (mismos nombres, mismas respuestas)
// pero guarda todo en localStorage de ESTE navegador. No escribe en ninguna
// planilla, no sube archivos a ningún servidor y no procesa pagos.
//
// Parámetros de URL para probar errores:
//   ?simular=sin-conexion          todas las llamadas fallan por red
//   ?simular=pedido-sin-conexion   solo falla el envío del pedido
//   ?simular=error                 el servidor responde con error interno
//   ?simular=lento                 respuestas lentas (3 s)

import { ApiError, NetworkError } from './api.js';

const DB_KEY = 'tienda-demo-crm-v1';
const IMG_KEY = 'tienda-demo-img-v1';
const SESS_KEY = 'tienda-demo-sessions-v1';
const STATUS = { Publicado: 'published', Pausado: 'paused', Agotado: 'soldout' };
const ORDER_STATUSES = ['Nuevo', 'Confirmado', 'Preparando', 'Enviado', 'Entregado', 'Cancelado'];
const PUBLIC_KEYS = ['hero_title', 'hero_text', 'hero_button', 'hero_badge', 'announcement', 'shipping_info', 'payment_info',
  'returns_info', 'faq', 'contact_email', 'contact_phone', 'contact_whatsapp', 'contact_address', 'contact_hours',
  'shipping_flat_cost', 'min_order_total'];
const MAX_QTY = 50;
export const DEMO_CREDENTIALS = { username: 'demo', password: 'demo' };

const fail = (code, message, details) => { throw new ApiError(code, message, details); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const isEmail = (s) => /^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[a-z]{2,}$/i.test(s);
const isPhone = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 6 && d.length <= 20; };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const now = () => new Date().toISOString();

// Si el navegador bloquea localStorage (ventana privada, vista previa embebida),
// la demo funciona igual con datos en memoria (se pierden al recargar).
const memory = new Map();
const storage = (() => {
  try { localStorage.setItem('__demo_test', '1'); localStorage.removeItem('__demo_test'); return localStorage; } catch {
    return { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
  }
})();

function readJson(key, fallback) {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    fail('STORAGE', 'El navegador no tiene más espacio para la demo. Usá "Restablecer demo" en el panel.');
  }
}

export async function loadSeed(baseUrl) {
  // Vista previa empaquetada en un solo archivo: los datos de ejemplo vienen incluidos.
  if (globalThis.__DEMO_SEED__) return structuredClone(globalThis.__DEMO_SEED__);
  const res = await fetch(new URL('data/demo-crm.json', baseUrl), { cache: 'no-store' });
  if (!res.ok) throw new NetworkError('No se pudieron cargar los datos de demostración.');
  return res.json();
}

export async function createDemoBackend(config, { baseUrl } = {}) {
  // Raíz del sitio (donde está data/). Se calcula solo si hace falta descargar los datos.
  const root = () => baseUrl || new URL('../../../', import.meta.url).href;
  const search = new URLSearchParams(globalThis.location?.search || '');
  const simulate = search.get('simular') || '';
  let db = null;
  // Relee el estado compartido (otra pestaña, como el panel, pudo cambiarlo).
  // Si no existe o se restableció la demo, vuelve a cargar los datos de ejemplo.
  async function reload() {
    const stored = readJson(DB_KEY, null);
    if (stored && Array.isArray(stored.products)) { db = stored; return; }
    const seed = await loadSeed(globalThis.__DEMO_SEED__ ? '' : root());
    db = { products: seed.products, settings: seed.settings || {}, orders: [], customers: [], inquiries: [], billing: [], seq: 0 };
    writeJson(DB_KEY, db);
  }
  await reload();
  const save = () => writeJson(DB_KEY, db);
  const images = () => readJson(IMG_KEY, {});

  function resolveImage(ref) {
    if (!ref) return null;
    if (ref.startsWith('demo-img:')) return images()[ref] || null;
    return /^https:\/\//i.test(ref) ? ref : null;
  }

  function publicProduct(p) {
    const status = STATUS[p.status] || 'paused';
    const variants = (p.variants || []).filter((v) => v.active).map((v) => ({
      id: v.id, name: v.name, price: v.price ?? p.price,
      available: status === 'published' && Number(v.stock) > 0, maxQty: Math.min(Number(v.stock) || 0, MAX_QTY)
    }));
    const prices = variants.length ? variants.map((v) => v.price) : [p.price];
    const stock = variants.length
      ? (p.variants || []).filter((v) => v.active).reduce((a, v) => a + (Number(v.stock) || 0), 0)
      : Number(p.stock) || 0;
    const available = status === 'published' && (variants.length ? variants.some((v) => v.available) : stock > 0);
    return {
      id: p.id, name: p.name, description: p.description, category: p.category,
      price: Math.min(...prices), priceMax: Math.max(...prices),
      compareAtPrice: p.compareAtPrice && p.compareAtPrice > p.price ? p.compareAtPrice : null,
      featured: !!p.featured,
      images: [p.image, ...(p.gallery || [])].map(resolveImage).filter(Boolean)
        .map((url, i) => ({ url, alt: p.name + (i ? ` — foto ${i + 1}` : '') })),
      variants, available, lowStock: available && stock <= 3,
      maxQty: variants.length ? null : Math.min(stock, MAX_QTY)
    };
  }

  function catalog() {
    const products = db.products.filter((p) => ['published', 'soldout'].includes(STATUS[p.status])).map(publicProduct);
    const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];
    const settings = {};
    PUBLIC_KEYS.forEach((k) => { if (db.settings[k]) settings[k] = db.settings[k]; });
    return { products, categories, settings, currency: config.currency, generatedAt: now() };
  }

  function checkForm(p) {
    if (p.website) fail('REJECTED', 'No se pudo procesar el envío.');
    if (!p.startedAt || Date.now() - Number(p.startedAt) < 3000) fail('REJECTED', 'El formulario se envió demasiado rápido. Intentá de nuevo.');
  }

  function createOrder(p) {
    checkForm(p);
    if (!/^[A-Za-z0-9-]{16,64}$/.test(String(p.orderKey || ''))) fail('VALIDATION', 'Falta la clave del pedido.');
    const existing = db.orders.find((o) => o.key === p.orderKey);
    if (existing) return { orderId: existing.id, status: existing.status, total: existing.total, currency: existing.currency, duplicate: true };

    const c = p.customer || {};
    const customer = { name: str(c.name, 120), email: str(c.email, 254).toLowerCase(), phone: str(c.phone, 40), notes: str(c.notes, 500) };
    const d = p.delivery || {};
    const delivery = { method: ['envio', 'retiro'].includes(d.method) ? d.method : '', address: str(d.address, 300) };
    const fields = {};
    if (customer.name.length < 2) fields.name = 'Ingresá tu nombre.';
    if (!isEmail(customer.email)) fields.email = 'Ingresá un email válido.';
    if (!isPhone(customer.phone)) fields.phone = 'Ingresá un teléfono válido.';
    if (!delivery.method) fields.delivery = 'Elegí una forma de entrega.';
    if (delivery.method === 'envio' && delivery.address.length < 5) fields.address = 'Ingresá la dirección de envío.';
    if (!Array.isArray(p.items) || !p.items.length) fields.items = 'El carrito está vacío.';
    if (Object.keys(fields).length) fail('VALIDATION', 'Revisá los datos del formulario.', { fields });

    const merged = new Map();
    for (const it of p.items) {
      const qty = Number(it.qty);
      if (!it.productId || !Number.isInteger(qty) || qty < 1) fail('VALIDATION', 'Hay un producto con una cantidad inválida.');
      const k = `${it.productId}::${it.variantId || ''}`;
      const cur = merged.get(k) || { productId: String(it.productId), variantId: String(it.variantId || ''), qty: 0 };
      cur.qty += qty;
      if (cur.qty > MAX_QTY) fail('VALIDATION', `La cantidad máxima por producto es ${MAX_QTY}.`);
      merged.set(k, cur);
    }

    const problems = [];
    const lines = [...merged.values()].map((it) => {
      const prod = db.products.find((x) => x.id === it.productId);
      if (!prod || STATUS[prod.status] !== 'published') { problems.push({ productId: it.productId, reason: 'unavailable', message: 'Un producto ya no está disponible.' }); return null; }
      const actives = (prod.variants || []).filter((v) => v.active);
      let variant = null;
      if (actives.length) {
        variant = actives.find((v) => v.id === it.variantId);
        if (!variant) { problems.push({ productId: prod.id, reason: 'variant', message: `Elegí una variante válida de "${prod.name}".` }); return null; }
      } else if (it.variantId) { problems.push({ productId: prod.id, reason: 'variant', message: `"${prod.name}" no tiene variantes.` }); return null; }
      const stock = Number(variant ? variant.stock : prod.stock) || 0;
      const label = prod.name + (variant ? ` — ${variant.name}` : '');
      if (it.qty > stock) {
        problems.push({ productId: prod.id, variantId: variant?.id || '', reason: 'stock', available: stock,
          message: stock > 0 ? `Solo quedan ${stock} unidades de "${label}".` : `"${label}" está agotado.` });
        return null;
      }
      const unitPrice = money(variant && variant.price != null ? variant.price : prod.price);
      return { productId: prod.id, variantId: variant?.id || '', name: prod.name, variantName: variant?.name || '', qty: it.qty, unitPrice, lineTotal: money(unitPrice * it.qty), _ref: variant || prod };
    });
    if (problems.length) fail('STOCK', problems[0].message, { problems });

    const subtotal = money(lines.reduce((a, l) => a + l.lineTotal, 0));
    const shipping = delivery.method === 'envio' ? money(Number(db.settings.shipping_flat_cost) || 0) : 0;
    const total = money(subtotal + shipping);
    const minTotal = Number(db.settings.min_order_total) || 0;
    if (minTotal && subtotal < minTotal) fail('VALIDATION', `El pedido mínimo es de ${minTotal} ${config.currency}.`);
    if (p.expectedTotal != null && Math.abs(Number(p.expectedTotal) - total) > 0.009) {
      fail('PRICE_CHANGED', 'Algunos precios cambiaron. Revisá el total actualizado antes de confirmar.', { total, subtotal, shipping });
    }

    lines.forEach((l) => { l._ref.stock = Math.max(0, (Number(l._ref.stock) || 0) - l.qty); });
    let cust = db.customers.find((x) => x.email === customer.email);
    if (cust) { cust.orders += 1; cust.lastOrderAt = now(); }
    else { cust = { id: 'C-' + randomHex(4).toUpperCase(), name: customer.name, email: customer.email, phone: customer.phone, orders: 1, firstOrderAt: now(), lastOrderAt: now() }; db.customers.push(cust); }
    db.seq += 1;
    const items = lines.map(({ _ref, ...l }) => l);
    const order = {
      id: 'P-' + String(db.seq).padStart(6, '0'), key: p.orderKey, createdAt: now(), customerId: cust.id,
      customerName: customer.name, email: customer.email, phone: customer.phone,
      delivery: delivery.method === 'envio' ? 'Envío' : 'Retiro', address: delivery.address, notes: customer.notes,
      items, subtotal, shipping, total, currency: config.currency, status: 'Nuevo', stockApplied: 'SI'
    };
    db.orders.push(order);
    save();
    return { orderId: order.id, status: order.status, items, subtotal, shipping, total, currency: config.currency, duplicate: false };
  }

  function createInquiry(p) {
    checkForm(p);
    const data = { type: p.type === 'cotizacion' ? 'Cotización' : 'Consulta', name: str(p.name, 120), email: str(p.email, 254).toLowerCase(), phone: str(p.phone, 40), productId: str(p.productId, 64), message: str(p.message, 2000) };
    const fields = {};
    if (data.name.length < 2) fields.name = 'Ingresá tu nombre.';
    if (!isEmail(data.email)) fields.email = 'Ingresá un email válido.';
    if (data.phone && !isPhone(data.phone)) fields.phone = 'El teléfono no parece válido.';
    if (data.message.length < 5) fields.message = 'Escribí tu consulta.';
    if (Object.keys(fields).length) fail('VALIDATION', 'Revisá los datos del formulario.', { fields });
    const id = 'Q-' + randomHex(4).toUpperCase();
    db.inquiries.push({ id, createdAt: now(), status: 'Nueva', ...data });
    save();
    return { id };
  }

  /* ------------------------------- Panel -------------------------------- */
  const sessions = () => readJson(SESS_KEY, {});
  function login(p) {
    if (p.username !== DEMO_CREDENTIALS.username || p.password !== DEMO_CREDENTIALS.password) fail('AUTH', 'Usuario o contraseña incorrectos.');
    const token = randomHex(32);
    const all = sessions();
    const expiresAt = Date.now() + 120 * 60000;
    all[token] = { user: 'demo', created: Date.now(), expiresAt };
    writeJson(SESS_KEY, all);
    return { token, user: 'demo', expiresAt };
  }
  function requireSession(token) {
    const all = sessions();
    const s = all[token];
    if (!s || Date.now() > s.expiresAt || Date.now() > s.created + 6 * 3600000) { delete all[token]; writeJson(SESS_KEY, all); fail('AUTH_REQUIRED', 'La sesión venció. Iniciá sesión de nuevo.'); }
    s.expiresAt = Math.min(Date.now() + 120 * 60000, s.created + 6 * 3600000);
    writeJson(SESS_KEY, all);
    return s;
  }

  function adminView(p) {
    return {
      ...structuredClone(p),
      image: p.image ? { ref: p.image, url: resolveImage(p.image) } : null,
      gallery: (p.gallery || []).map((ref) => ({ ref, url: resolveImage(ref) }))
    };
  }

  function saveProduct(raw) {
    if (!raw || str(raw.name, 200).length < 2) fail('VALIDATION', 'El nombre es obligatorio.');
    if (!(Number(raw.price) >= 0) || raw.price === '' || raw.price == null) fail('VALIDATION', 'El precio debe ser un número mayor o igual a 0.');
    if (!STATUS[raw.status]) fail('VALIDATION', 'Estado inválido.');
    const okRef = (r) => !r || r.startsWith('demo-img:') || /^https:\/\/[^\s"'<>]{4,1000}$/i.test(r);
    if (!okRef(raw.image) || !(raw.gallery || []).every(okRef)) fail('VALIDATION', 'Hay una foto con una referencia inválida (usá https://).');
    const id = str(raw.id, 64) || 'PR-' + randomHex(4).toUpperCase();
    if (!/^[\w.-]{1,64}$/.test(id)) fail('VALIDATION', 'El ID solo admite letras, números, punto, guion y guion bajo.');
    const idx = db.products.findIndex((p) => p.id === id);
    if (raw.isNew && idx >= 0) fail('VALIDATION', `Ya existe un producto con el ID ${id}.`);
    const stockVal = (v) => { if (v === '' || v == null) return ''; const n = Number(v); if (!Number.isInteger(n) || n < 0) fail('VALIDATION', 'El stock debe ser un número entero mayor o igual a 0.'); return n; };
    let n = 0;
    const variants = (raw.variants || []).map((v) => {
      if (!str(v.name, 120)) fail('VALIDATION', 'Cada variante necesita un nombre.');
      let vid = str(v.id, 64);
      while (!vid) { n += 1; const cand = `${id}-V${n}`; if (!(raw.variants || []).some((x) => x.id === cand)) vid = cand; }
      return { id: vid, name: str(v.name, 120), price: v.price === '' || v.price == null ? null : money(v.price), stock: stockVal(v.stock), active: v.active !== false };
    });
    const prev = idx >= 0 ? db.products[idx] : null;
    const product = {
      id, name: str(raw.name, 200), description: str(raw.description, 5000), category: str(raw.category, 80),
      price: money(raw.price), compareAtPrice: raw.compareAtPrice === '' || raw.compareAtPrice == null ? null : money(raw.compareAtPrice),
      cost: raw.cost === '' || raw.cost == null ? null : money(raw.cost), stock: stockVal(raw.stock), status: raw.status,
      featured: !!raw.featured, image: raw.image || '', gallery: (raw.gallery || []).filter(Boolean).slice(0, 8),
      internalNotes: str(raw.internalNotes, 5000), variants, updatedAt: now()
    };
    if (prev) {
      const keep = new Set([product.image, ...product.gallery]);
      const imgs = images();
      [prev.image, ...(prev.gallery || [])].filter((r) => r && !keep.has(r) && imgs[r]).forEach((r) => delete imgs[r]);
      writeJson(IMG_KEY, imgs);
      db.products[idx] = product;
    } else {
      db.products.push(product);
    }
    save();
    return { product: adminView(product) };
  }

  function uploadImage(p) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(p.mimeType)) fail('VALIDATION', 'Formato no permitido. Usá JPG, PNG o WebP.');
    const ref = 'demo-img:' + randomHex(8);
    const imgs = images();
    imgs[ref] = `data:${p.mimeType};base64,${p.dataBase64}`;
    writeJson(IMG_KEY, imgs);
    return { ref, url: imgs[ref] };
  }

  function updateOrderStatus(orderId, status) {
    if (!ORDER_STATUSES.includes(status)) fail('VALIDATION', 'Estado inválido.');
    const o = db.orders.find((x) => x.id === orderId);
    if (!o) fail('NOT_FOUND', 'Pedido no encontrado.');
    if (o.status === 'Cancelado' && status !== 'Cancelado') fail('VALIDATION', 'Un pedido cancelado no se puede reabrir. Creá uno nuevo.');
    if (status === 'Cancelado' && o.stockApplied === 'SI') {
      o.items.forEach((l) => {
        const prod = db.products.find((x) => x.id === l.productId);
        const ref = l.variantId ? prod?.variants?.find((v) => v.id === l.variantId) : prod;
        if (ref && ref.stock !== '') ref.stock = (Number(ref.stock) || 0) + l.qty;
      });
      o.stockApplied = 'DEVUELTO';
    }
    o.status = status;
    save();
    return { orderId, status, stockApplied: o.stockApplied };
  }

  function registerSale(orderId) {
    const o = db.orders.find((x) => x.id === orderId);
    if (!o) fail('NOT_FOUND', 'Pedido no encontrado.');
    if (o.status === 'Cancelado') fail('VALIDATION', 'No se puede registrar la venta de un pedido cancelado.');
    const ex = db.billing.find((b) => b.orderId === orderId);
    if (ex) return { id: ex.id, duplicate: true, fiscalStatus: ex.fiscalStatus };
    const rec = { id: 'V-' + randomHex(4).toUpperCase(), createdAt: now(), orderId, customerName: o.customerName, total: o.total, currency: o.currency, fiscalStatus: 'Pendiente: sin integración fiscal', fiscalNumber: '' };
    db.billing.push(rec);
    save();
    return { id: rec.id, duplicate: false, fiscalStatus: rec.fiscalStatus };
  }

  const admin = {
    adminSession: (p, s) => ({ user: s.user, expiresAt: s.expiresAt }),
    adminLogout: (p) => { const all = sessions(); delete all[p.token]; writeJson(SESS_KEY, all); return { loggedOut: true }; },
    adminLogoutAll: () => { writeJson(SESS_KEY, {}); return { revoked: true }; },
    adminListProducts: () => ({ products: db.products.map(adminView), statuses: Object.keys(STATUS), imageProvider: 'demo', maxImageBytes: 4 * 1024 * 1024 }),
    adminSaveProduct: (p) => saveProduct(p.product),
    adminDeleteProduct: (p) => {
      const idx = db.products.findIndex((x) => x.id === p.id);
      if (idx < 0) fail('NOT_FOUND', 'Producto no encontrado.');
      const [gone] = db.products.splice(idx, 1);
      const imgs = images();
      [gone.image, ...(gone.gallery || [])].forEach((r) => delete imgs[r]);
      writeJson(IMG_KEY, imgs);
      save();
      return { deleted: p.id };
    },
    adminUploadImage: (p) => uploadImage(p),
    adminListOrders: () => ({ statuses: ORDER_STATUSES, orders: [...db.orders].reverse() }),
    adminUpdateOrderStatus: (p) => updateOrderStatus(p.orderId, p.status),
    adminListInquiries: () => ({ statuses: ['Nueva', 'Respondida', 'Cerrada'], inquiries: [...db.inquiries].reverse() }),
    adminUpdateInquiry: (p) => {
      const q = db.inquiries.find((x) => x.id === p.id);
      if (!q) fail('NOT_FOUND', 'Consulta no encontrada.');
      if (!['Nueva', 'Respondida', 'Cerrada'].includes(p.status)) fail('VALIDATION', 'Estado inválido.');
      q.status = p.status; save();
      return { id: q.id, status: q.status };
    },
    adminRegisterSale: (p) => registerSale(p.orderId),
    adminListBilling: () => ({ records: [...db.billing].reverse() }),
    adminGetSettings: () => ({ keys: PUBLIC_KEYS, values: Object.fromEntries(PUBLIC_KEYS.map((k) => [k, db.settings[k] || ''])) }),
    adminSaveSettings: (p) => {
      PUBLIC_KEYS.forEach((k) => { if (p.values && Object.hasOwn(p.values, k)) db.settings[k] = str(p.values[k], 5000); });
      save();
      return { values: catalog().settings };
    },
    adminResetDemo: () => {
      storage.removeItem(DB_KEY); storage.removeItem(IMG_KEY);
      return { reset: true };
    }
  };

  return {
    async handle(action, payload = {}) {
      await sleep(simulate === 'lento' ? 3000 : 250 + Math.random() * 250);
      if (simulate === 'sin-conexion' || (simulate === 'pedido-sin-conexion' && action === 'createOrder')) {
        throw new NetworkError('No se pudo conectar con el servidor. Revisá tu conexión.');
      }
      if (simulate === 'error') fail('INTERNAL', 'Error interno. Intentá de nuevo más tarde.');
      await reload();
      if (action === 'catalog') return structuredClone(catalog());
      if (action === 'health') return { version: 'demo', time: now() };
      if (action === 'createOrder') return createOrder(structuredClone(payload));
      if (action === 'createInquiry') return createInquiry(structuredClone(payload));
      if (action === 'adminLogin') return login(payload);
      if (admin[action]) {
        const s = action === 'adminLogout' ? null : requireSession(payload.token);
        const data = admin[action](structuredClone(payload), s);
        return s ? { ...data, _session: { expiresAt: s.expiresAt } } : data;
      }
      fail('NOT_FOUND', 'Acción no disponible.');
    }
  };
}

export const DEMO_STORAGE_KEYS = [DB_KEY, IMG_KEY];
