/**
 * Acciones del panel privado. TODAS pasan por requireSession_ en el router.
 */

var STATUS_LABELS_ = { published: 'Publicado', paused: 'Pausado', soldout: 'Agotado' };

function adminProductView_(p) {
  return {
    id: p.id, name: p.name, description: p.description, category: p.category,
    price: p.price, compareAtPrice: p.compareAtPrice, cost: p.cost,
    stock: p.rawStock === '' ? '' : p.stock, status: STATUS_LABELS_[p.status], statusRaw: String(p.statusRaw || ''),
    featured: p.featured, internalNotes: p.internalNotes, updatedAt: p.updatedAt,
    image: p.image ? { ref: p.image, url: resolveImageUrl_(p.image) } : null,
    gallery: p.gallery.map(function (ref) { return { ref: ref, url: resolveImageUrl_(ref) }; }),
    variants: p.variants.map(function (v) {
      return { id: v.id, name: v.name, price: v.price, stock: v.rawStock === '' ? '' : v.stock, active: v.active };
    })
  };
}

function adminListProducts_() {
  return {
    products: loadProducts_().map(adminProductView_),
    statuses: ['Publicado', 'Pausado', 'Agotado'],
    imageProvider: CONFIG.IMAGE_STORAGE.provider,
    maxImageBytes: CONFIG.IMAGE_STORAGE.maxBytes
  };
}

function cleanStock_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  if (!isFinite(n) || n < 0 || Math.floor(n) !== n) fail_('VALIDATION', 'El stock debe ser un número entero mayor o igual a 0.');
  return n;
}

function cleanPrice_(v, label, allowEmpty) {
  if ((v === '' || v === null || v === undefined) && allowEmpty) return '';
  var n = Number(v);
  if (!isFinite(n) || n < 0) fail_('VALIDATION', label + ' debe ser un número mayor o igual a 0.');
  return money_(n);
}

function validateProductInput_(p) {
  if (!p || typeof p !== 'object') fail_('VALIDATION', 'Producto inválido.');
  var name = str_(p.name, 200);
  if (name.length < 2) fail_('VALIDATION', 'El nombre es obligatorio.');
  var status = ['Publicado', 'Pausado', 'Agotado'].indexOf(p.status) >= 0 ? p.status : null;
  if (!status) fail_('VALIDATION', 'Estado inválido.');
  var image = str_(p.image, 1000);
  if (image && !isValidImageRef_(image)) fail_('VALIDATION', 'La foto principal no es una referencia válida (usá https://).');
  var gallery = (Array.isArray(p.gallery) ? p.gallery : []).map(function (r) { return str_(r, 1000); }).filter(Boolean);
  if (gallery.length > 8) fail_('VALIDATION', 'Máximo 8 fotos adicionales.');
  gallery.forEach(function (r) { if (!isValidImageRef_(r)) fail_('VALIDATION', 'Hay una foto adicional con una referencia inválida.'); });
  var variants = Array.isArray(p.variants) ? p.variants : [];
  if (variants.length > 50) fail_('VALIDATION', 'Máximo 50 variantes por producto.');
  var seen = {};
  variants = variants.map(function (v) {
    var vn = str_(v && v.name, 120);
    if (!vn) fail_('VALIDATION', 'Cada variante necesita un nombre.');
    var vid = str_(v.id, 64);
    if (vid && !/^[\w.-]{1,64}$/.test(vid)) fail_('VALIDATION', 'ID de variante inválido: ' + vid);
    if (vid && seen[vid]) fail_('VALIDATION', 'ID de variante repetido: ' + vid);
    if (vid) seen[vid] = true;
    return { id: vid, name: vn, price: cleanPrice_(v.price, 'El precio de la variante', true), stock: cleanStock_(v.stock), active: v.active !== false };
  });
  var id = str_(p.id, 64);
  if (id && !/^[\w.-]{1,64}$/.test(id)) fail_('VALIDATION', 'El ID solo admite letras, números, punto, guion y guion bajo.');
  return {
    id: id, isNew: !!p.isNew, name: name, description: str_(p.description, 5000), category: str_(p.category, 80),
    price: cleanPrice_(p.price, 'El precio'), compareAtPrice: cleanPrice_(p.compareAtPrice, 'El precio anterior', true),
    cost: cleanPrice_(p.cost, 'El costo', true), stock: cleanStock_(p.stock), status: status,
    featured: !!p.featured, image: image, gallery: gallery, internalNotes: str_(p.internalNotes, 5000), variants: variants
  };
}

function adminSaveProduct_(raw) {
  var p = validateProductInput_(raw);
  var removedRefs = [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('BUSY', 'Hay otra operación en curso. Probá de nuevo.');
  var savedId;
  try {
    var table = openTable_('products');
    var existing = p.id ? table.find('id', p.id) : null;
    if (p.isNew && existing) fail_('VALIDATION', 'Ya existe un producto con el ID ' + p.id + '.');
    if (!p.isNew && p.id && !existing) fail_('NOT_FOUND', 'El producto ya no existe (¿lo borró otra persona?).');
    savedId = p.id || randomId_('PR-');

    var row = {
      id: savedId, name: p.name, description: p.description, category: p.category, price: p.price,
      compareAtPrice: p.compareAtPrice, cost: p.cost, stock: p.stock, status: p.status,
      featured: p.featured ? 'SI' : 'NO', image: p.image, gallery: p.gallery.join('\n'),
      internalNotes: p.internalNotes, updatedAt: nowLocal_()
    };
    if (existing) {
      var before = [String(existing.image || '')].concat(splitRefs_(existing.gallery));
      var after = [p.image].concat(p.gallery);
      removedRefs = before.filter(function (r) { return r && after.indexOf(r) < 0; });
      table.update(existing._row, row);
    } else {
      table.append(row);
    }
    syncVariants_(savedId, p.variants);
    SpreadsheetApp.flush();
    invalidateCatalog_();
  } finally {
    lock.releaseLock();
  }
  removedRefs.forEach(deleteImageRef_);
  var saved = loadProducts_().filter(function (x) { return x.id === savedId; })[0];
  return { product: adminProductView_(saved) };
}

function syncVariants_(productId, variants) {
  var table = openTable_('variants', { optional: true });
  if (!table) {
    if (variants.length) fail_('CONFIG', 'No existe la pestaña de variantes "' + CONFIG.SHEETS.variants.name + '".');
    return;
  }
  var current = table.rows().filter(function (r) { return String(r.productId) === productId; });
  var keepIds = {};
  var used = {};
  table.rows().forEach(function (r) { used[String(r.id)] = String(r.productId); });
  var n = current.length;
  variants.forEach(function (v) {
    var data = { productId: productId, name: v.name, price: v.price, stock: v.stock, active: v.active ? 'SI' : 'NO' };
    var row = v.id ? current.filter(function (r) { return String(r.id) === v.id; })[0] : null;
    if (row) {
      table.update(row._row, data);
      keepIds[v.id] = true;
      return;
    }
    var id = v.id;
    if (id && used[id] && used[id] !== productId) fail_('VALIDATION', 'El ID de variante ' + id + ' ya está en uso por otro producto.');
    while (!id || used[id]) { n += 1; id = productId + '-V' + n; }
    used[id] = productId;
    data.id = id;
    table.append(data);
    keepIds[id] = true;
  });
  // Borrar de abajo hacia arriba para no correr los números de fila.
  current.filter(function (r) { return !keepIds[String(r.id)]; })
    .map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (rowNum) { table.remove(rowNum); });
}

function adminDeleteProduct_(id) {
  id = str_(id, 64);
  var refs = [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('BUSY', 'Hay otra operación en curso. Probá de nuevo.');
  try {
    var table = openTable_('products');
    var row = table.find('id', id);
    if (!row) fail_('NOT_FOUND', 'Producto no encontrado.');
    refs = [String(row.image || '')].concat(splitRefs_(row.gallery)).filter(Boolean);
    syncVariants_(id, []);
    table.remove(row._row);
    SpreadsheetApp.flush();
    invalidateCatalog_();
  } finally {
    lock.releaseLock();
  }
  refs.forEach(deleteImageRef_);
  return { deleted: id };
}

function adminListOrders_(p) {
  var limit = Math.min(Number(p && p.limit) || 200, 500);
  var rows = openTable_('orders').rows().slice(-limit).reverse();
  return {
    statuses: CONFIG.ORDER_STATUSES,
    orders: rows.map(function (r) {
      var items = [];
      try { items = JSON.parse(r.itemsJson || '[]'); } catch (e) { items = []; }
      return {
        id: String(r.id), createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ''),
        customerName: String(r.customerName || ''), email: String(r.email || ''), phone: String(r.phone || ''),
        delivery: String(r.delivery || ''), address: String(r.address || ''), notes: String(r.notes || ''),
        items: items, subtotal: num_(r.subtotal, 0), shipping: num_(r.shipping, 0), total: num_(r.total, 0),
        currency: String(r.currency || CONFIG.CURRENCY), status: String(r.status || ''), stockApplied: String(r.stockApplied || '')
      };
    })
  };
}

function adminListInquiries_() {
  var rows = openTable_('inquiries').rows().slice(-300).reverse();
  return {
    statuses: ['Nueva', 'Respondida', 'Cerrada'],
    inquiries: rows.map(function (r) {
      return {
        id: String(r.id), createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ''),
        type: String(r.type || ''), name: String(r.name || ''), email: String(r.email || ''), phone: String(r.phone || ''),
        productId: String(r.productId || ''), message: String(r.message || ''), status: String(r.status || '')
      };
    })
  };
}

function adminUpdateInquiry_(id, status) {
  if (['Nueva', 'Respondida', 'Cerrada'].indexOf(status) < 0) fail_('VALIDATION', 'Estado inválido.');
  var table = openTable_('inquiries');
  var row = table.find('id', id);
  if (!row) fail_('NOT_FOUND', 'Consulta no encontrada.');
  table.update(row._row, { status: status });
  return { id: id, status: status };
}

/**
 * Registra la venta para reportes internos. NO emite comprobantes fiscales:
 * eso requiere una integración con el sistema fiscal (ver README).
 */
function adminRegisterSale_(orderId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('BUSY', 'Hay otra operación en curso. Probá de nuevo.');
  try {
    var order = openTable_('orders').find('id', orderId);
    if (!order) fail_('NOT_FOUND', 'Pedido no encontrado.');
    if (String(order.status) === 'Cancelado') fail_('VALIDATION', 'No se puede registrar la venta de un pedido cancelado.');
    var billing = openTable_('billing');
    var existing = billing.find('orderId', orderId);
    if (existing) return { id: String(existing.id), duplicate: true, fiscalStatus: String(existing.fiscalStatus) };
    var id = randomId_('V-');
    billing.append({
      id: id, createdAt: nowLocal_(), orderId: orderId, customerName: String(order.customerName || ''),
      total: num_(order.total, 0), currency: String(order.currency || CONFIG.CURRENCY),
      fiscalStatus: 'Pendiente: sin integración fiscal', fiscalNumber: '', notes: 'Registro interno. No es un comprobante fiscal.'
    });
    SpreadsheetApp.flush();
    return { id: id, duplicate: false, fiscalStatus: 'Pendiente: sin integración fiscal' };
  } finally {
    lock.releaseLock();
  }
}

function adminListBilling_() {
  var rows = openTable_('billing').rows().slice(-300).reverse();
  return {
    records: rows.map(function (r) {
      return {
        id: String(r.id), createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ''),
        orderId: String(r.orderId || ''), customerName: String(r.customerName || ''), total: num_(r.total, 0),
        currency: String(r.currency || CONFIG.CURRENCY), fiscalStatus: String(r.fiscalStatus || ''), fiscalNumber: String(r.fiscalNumber || '')
      };
    })
  };
}

function adminGetSettings_() {
  var all = readSettings_();
  var values = {};
  CONFIG.PUBLIC_SETTINGS_KEYS.forEach(function (k) { values[k] = all[k] || ''; });
  return { keys: CONFIG.PUBLIC_SETTINGS_KEYS, values: values };
}
