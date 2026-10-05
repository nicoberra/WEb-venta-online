/**
 * Pedidos desde la tienda pública.
 *  - El navegador solo envía IDs y cantidades: precios, disponibilidad y total
 *    se recalculan acá con los datos de la planilla.
 *  - Idempotencia: cada intento de compra trae una "orderKey". Si llega dos
 *    veces (doble clic, reintento por mala conexión), se devuelve el mismo
 *    pedido y el stock no se descuenta de nuevo.
 *  - Concurrencia: todo el tramo leer-stock -> validar -> descontar -> guardar
 *    corre dentro de LockService (un pedido por vez).
 *  - NO procesa pagos.
 */

var ORDER_KEY_RE = /^[A-Za-z0-9-]{16,64}$/;

function validateOrderInput_(p) {
  var S = CONFIG.SECURITY;
  if (!p || typeof p !== 'object') fail_('VALIDATION', 'Pedido inválido.');
  if (!ORDER_KEY_RE.test(String(p.orderKey || ''))) fail_('VALIDATION', 'Falta la clave del pedido.');

  var c = p.customer || {};
  var customer = {
    name: str_(c.name, 120),
    email: str_(c.email, 254).toLowerCase(),
    phone: str_(c.phone, 40),
    notes: str_(c.notes, 500)
  };
  var errors = {};
  if (customer.name.length < 2) errors.name = 'Ingresá tu nombre.';
  if (!isEmail_(customer.email)) errors.email = 'Ingresá un email válido.';
  if (!isPhone_(customer.phone)) errors.phone = 'Ingresá un teléfono válido.';

  var d = p.delivery || {};
  var delivery = { method: d.method === 'envio' ? 'envio' : (d.method === 'retiro' ? 'retiro' : ''), address: str_(d.address, 300) };
  if (!delivery.method) errors.delivery = 'Elegí una forma de entrega.';
  if (delivery.method === 'envio' && delivery.address.length < 5) errors.address = 'Ingresá la dirección de envío.';

  if (!Array.isArray(p.items) || !p.items.length) errors.items = 'El carrito está vacío.';
  if (Object.keys(errors).length) fail_('VALIDATION', 'Revisá los datos del formulario.', { fields: errors });
  if (p.items.length > S.maxItemsPerOrder) fail_('VALIDATION', 'Demasiados productos en un solo pedido.');

  var merged = {};
  var order = [];
  p.items.forEach(function (it) {
    var productId = str_(it && it.productId, 64);
    var variantId = str_(it && it.variantId, 64);
    var qty = Number(it && it.qty);
    if (!productId || !isFinite(qty) || Math.floor(qty) !== qty || qty < 1) {
      fail_('VALIDATION', 'Hay un producto con una cantidad inválida.');
    }
    var key = productId + '::' + variantId;
    if (!merged[key]) { merged[key] = { productId: productId, variantId: variantId, qty: 0 }; order.push(key); }
    merged[key].qty += qty;
    if (merged[key].qty > S.maxQtyPerItem) fail_('VALIDATION', 'La cantidad máxima por producto es ' + S.maxQtyPerItem + '.');
  });

  return {
    orderKey: String(p.orderKey),
    customer: customer,
    delivery: delivery,
    items: order.map(function (k) { return merged[k]; }),
    expectedTotal: p.expectedTotal === undefined || p.expectedTotal === null ? null : Number(p.expectedTotal)
  };
}

/** Anti-abuso común a formularios públicos. */
function checkPublicForm_(p) {
  if (p && p.website) fail_('REJECTED', 'No se pudo procesar el envío.'); // honeypot
  var started = Number(p && p.startedAt);
  if (!started || (Date.now() - started) < CONFIG.SECURITY.minFormSeconds * 1000) {
    fail_('REJECTED', 'El formulario se envió demasiado rápido. Intentá de nuevo.');
  }
  if (CONFIG.SECURITY.requireTurnstile) verifyTurnstile_(p.captchaToken);
}

function verifyTurnstile_(token) {
  var secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!secret) fail_('CONFIG', 'Falta TURNSTILE_SECRET en Propiedades del script.');
  if (!token) fail_('REJECTED', 'Completá la verificación anti-spam.');
  var res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post', payload: { secret: secret, response: String(token) }, muteHttpExceptions: true
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* inválido */ }
  if (!body.success) fail_('REJECTED', 'No se pudo verificar que no seas un robot.');
}

/**
 * Arma las líneas con precios y stock de la planilla. No escribe nada.
 * @return {{lines: Array, subtotal: number}}
 */
function priceOrder_(items, products) {
  var byId = {};
  products.forEach(function (p) { byId[p.id] = p; });
  var problems = [];
  var lines = items.map(function (it) {
    var p = byId[it.productId];
    if (!p || p.status !== 'published') {
      problems.push({ productId: it.productId, reason: 'unavailable', message: 'Un producto ya no está disponible.' });
      return null;
    }
    var activeVariants = p.variants.filter(function (v) { return v.active; });
    var variant = null;
    if (activeVariants.length) {
      variant = activeVariants.filter(function (v) { return v.id === it.variantId; })[0];
      if (!variant) {
        problems.push({ productId: p.id, variantId: it.variantId, reason: 'variant', message: 'Elegí una variante válida de "' + p.name + '".' });
        return null;
      }
    } else if (it.variantId) {
      problems.push({ productId: p.id, reason: 'variant', message: '"' + p.name + '" no tiene variantes.' });
      return null;
    }
    var stock = variant ? variant.stock : p.stock;
    if (it.qty > stock) {
      problems.push({
        productId: p.id, variantId: variant ? variant.id : '', reason: 'stock', available: stock === Infinity ? null : stock,
        message: stock > 0 ? 'Solo quedan ' + stock + ' unidades de "' + p.name + (variant ? ' — ' + variant.name : '') + '".'
          : '"' + p.name + (variant ? ' — ' + variant.name : '') + '" está agotado.'
      });
      return null;
    }
    var unit = money_(variant && variant.price !== null ? variant.price : p.price);
    return {
      productId: p.id, variantId: variant ? variant.id : '',
      name: p.name, variantName: variant ? variant.name : '',
      qty: it.qty, unitPrice: unit, lineTotal: money_(unit * it.qty),
      _product: p, _variant: variant
    };
  });
  if (problems.length) fail_('STOCK', problems[0].message, { problems: problems });
  return { lines: lines, subtotal: money_(lines.reduce(function (a, l) { return a + l.lineTotal; }, 0)) };
}

function shippingCost_(method, settings) {
  if (method !== 'envio') return 0;
  return money_(num_(settings.shipping_flat_cost, 0));
}

function nextOrderId_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('ORDER_SEQ') || 0) + 1;
  props.setProperty('ORDER_SEQ', String(n));
  return 'P-' + ('00000' + n).slice(-6);
}

function orderSummary_(row) {
  return {
    orderId: String(row.id), status: String(row.status), total: num_(row.total, 0),
    currency: String(row.currency || CONFIG.CURRENCY), duplicate: true
  };
}

function createOrder_(payload) {
  checkPublicForm_(payload);
  var input = validateOrderInput_(payload);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'orderkey:' + input.orderKey;

  var known = cache.get(cacheKey);
  if (known) return JSON.parse(known);

  if (!rateLimit_('orders', CONFIG.SECURITY.maxOrdersPerMinute, 60)) {
    fail_('RATE_LIMIT', 'Estamos recibiendo muchos pedidos. Probá de nuevo en un minuto.');
  }
  // Por contacto se cuentan solo los pedidos guardados: un cliente que corrige
  // errores de stock o de datos no queda bloqueado.
  var contactBuckets = [
    'orders:' + sha256Hex_(input.customer.email),
    'orders:' + sha256Hex_(input.customer.phone.replace(/\D/g, ''))
  ];
  contactBuckets.forEach(function (b) {
    if (rateExceeded_(b, CONFIG.SECURITY.maxOrdersPerContactPer10Min, 600)) {
      fail_('RATE_LIMIT', 'Ya recibimos varios pedidos con estos datos. Si necesitás ayuda, contactanos.');
    }
  });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('BUSY', 'La tienda está procesando otros pedidos. Intentá de nuevo en unos segundos.');
  try {
    var orders = openTable_('orders');
    var existing = orders.find('key', input.orderKey);
    if (existing) return orderSummary_(existing);

    var settings = readSettings_();
    var priced = priceOrder_(input.items, loadProducts_());
    var shipping = shippingCost_(input.delivery.method, settings);
    var total = money_(priced.subtotal + shipping);

    var minTotal = num_(settings.min_order_total, 0);
    if (minTotal && priced.subtotal < minTotal) fail_('VALIDATION', 'El pedido mínimo es de ' + minTotal + ' ' + CONFIG.CURRENCY + '.');
    if (input.expectedTotal !== null && Math.abs(input.expectedTotal - total) > 0.009) {
      fail_('PRICE_CHANGED', 'Algunos precios cambiaron. Revisá el total actualizado antes de confirmar.', { total: total, subtotal: priced.subtotal, shipping: shipping });
    }

    var customerId = upsertCustomer_(input.customer);
    var orderId = nextOrderId_();
    var applyStock = CONFIG.STOCK_MODE === 'reserve_on_order';
    var items = priced.lines.map(function (l) {
      return { productId: l.productId, variantId: l.variantId, name: l.name, variantName: l.variantName, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal };
    });

    // 1) se registra el pedido; 2) se descuenta stock; 3) se marca como descontado.
    // Si algo falla entre 1 y 3, el pedido queda con "PENDIENTE" para revisión manual
    // y un reintento con la misma clave NO vuelve a descontar.
    var orderRow = orders.append({
      id: orderId, createdAt: nowLocal_(), key: input.orderKey, customerId: customerId,
      customerName: input.customer.name, email: input.customer.email, phone: input.customer.phone,
      delivery: input.delivery.method === 'envio' ? 'Envío' : 'Retiro', address: input.delivery.address,
      notes: input.customer.notes, itemsJson: JSON.stringify(items),
      itemsText: items.map(function (l) {
        return l.qty + ' x ' + l.name + (l.variantName ? ' (' + l.variantName + ')' : '') + ' @ ' + l.unitPrice + ' = ' + l.lineTotal;
      }).join('\n'),
      subtotal: priced.subtotal, shipping: shipping, total: total, currency: CONFIG.CURRENCY,
      status: CONFIG.ORDER_INITIAL_STATUS, stockApplied: applyStock ? 'PENDIENTE' : 'NO (manual)',
      source: 'Tienda online', updatedAt: nowLocal_()
    });

    if (applyStock) {
      adjustStock_(priced.lines.map(function (l) { return { productId: l.productId, variantId: l.variantId, delta: -l.qty }; }));
      orders.update(orderRow, { stockApplied: 'SI' });
    }
    SpreadsheetApp.flush();
    invalidateCatalog_();

    var result = {
      orderId: orderId, status: CONFIG.ORDER_INITIAL_STATUS, items: items,
      subtotal: priced.subtotal, shipping: shipping, total: total, currency: CONFIG.CURRENCY, duplicate: false
    };
    contactBuckets.forEach(function (b) { rateHit_(b, 600); });
    cache.put(cacheKey, JSON.stringify(orderSummary_({ id: orderId, status: result.status, total: total, currency: CONFIG.CURRENCY })), 21600);
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Suma/resta stock. Debe llamarse con el lock tomado.
 * Celdas vacías con EMPTY_STOCK_IS_UNLIMITED=true no se tocan.
 */
function adjustStock_(changes) {
  var products = openTable_('products');
  var variants = openTable_('variants', { optional: true });
  changes.forEach(function (c) {
    var table = c.variantId ? variants : products;
    if (!table) return;
    var row = c.variantId ? table.find('id', c.variantId) : table.find('id', c.productId);
    if (!row) return; // producto/variante eliminado: se omite
    if ((row.stock === '' || row.stock === null) && CONFIG.EMPTY_STOCK_IS_UNLIMITED) return;
    var next = Math.max(0, Math.floor(num_(row.stock, 0)) + c.delta);
    table.update(row._row, { stock: next });
    row.stock = next;
  });
  var touched = products.has('updatedAt');
  if (touched) {
    var seen = {};
    changes.forEach(function (c) {
      if (seen[c.productId]) return;
      seen[c.productId] = true;
      var r = products.find('id', c.productId);
      if (r) products.update(r._row, { updatedAt: nowLocal_() });
    });
  }
}

function upsertCustomer_(c) {
  var table = openTable_('customers', { optional: true });
  if (!table) return '';
  var row = table.find('email', c.email);
  if (row) {
    var patch = { lastOrderAt: nowLocal_(), orders: num_(row.orders, 0) + 1 };
    if (!row.name) patch.name = c.name;
    if (!row.phone) patch.phone = c.phone;
    table.update(row._row, patch);
    return String(row.id);
  }
  var id = randomId_('C-');
  table.append({
    id: id, name: c.name, email: c.email, phone: c.phone,
    firstOrderAt: nowLocal_(), lastOrderAt: nowLocal_(), orders: 1, source: 'Tienda online'
  });
  return id;
}

/** Cambio de estado desde el panel. Cancelar devuelve el stock UNA sola vez. */
function updateOrderStatus_(orderId, status) {
  if (CONFIG.ORDER_STATUSES.indexOf(status) < 0) fail_('VALIDATION', 'Estado inválido.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('BUSY', 'Hay otra operación en curso. Probá de nuevo.');
  try {
    var orders = openTable_('orders');
    var row = orders.find('id', orderId);
    if (!row) fail_('NOT_FOUND', 'Pedido no encontrado.');
    if (String(row.status) === 'Cancelado' && status !== 'Cancelado') {
      fail_('VALIDATION', 'Un pedido cancelado no se puede reabrir. Creá uno nuevo.');
    }
    var patch = { status: status, updatedAt: nowLocal_() };
    if (status === 'Cancelado' && String(row.stockApplied) === 'SI') {
      var items = [];
      try { items = JSON.parse(row.itemsJson || '[]'); } catch (e) { items = []; }
      adjustStock_(items.map(function (l) { return { productId: l.productId, variantId: l.variantId, delta: Number(l.qty) || 0 }; }));
      patch.stockApplied = 'DEVUELTO';
    }
    orders.update(row._row, patch);
    SpreadsheetApp.flush();
    invalidateCatalog_();
    return { orderId: orderId, status: status, stockApplied: patch.stockApplied || String(row.stockApplied) };
  } finally {
    lock.releaseLock();
  }
}
