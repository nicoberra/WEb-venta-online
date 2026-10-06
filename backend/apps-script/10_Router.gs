/**
 * API publicada como Aplicación web (Implementar > Nueva implementación):
 *   Ejecutar como: Yo (dueño de la planilla)
 *   Quién tiene acceso: Cualquier usuario
 *
 * GET  ?action=catalog  -> catálogo PÚBLICO (sin costos ni datos internos)
 * GET  ?action=health   -> versión, para probar la conexión
 * POST (cuerpo JSON, Content-Type text/plain para evitar preflight CORS):
 *   Públicas:  createOrder, createInquiry, adminLogin
 *   Privadas (requieren token de sesión): admin*
 *
 * Si ya existe un doGet/doPost en el CRM, renombrá estos a apiGet_/apiPost_
 * y llamalos desde el router existente según el parámetro "action".
 */

var PUBLIC_POST_ACTIONS_ = {
  createOrder: function (p) { return createOrder_(p); },
  createInquiry: function (p) { return createInquiry_(p); },
  adminLogin: function (p) { return login_(p); }
};

var ADMIN_ACTIONS_ = {
  adminSession: function (p, s) { return { user: s.user, expiresAt: s.expiresAt }; },
  adminLogout: function (p) { return logout_(p.token); },
  adminLogoutAll: function () { revokeAllSessions_(); return { revoked: true }; },
  adminListProducts: function () { return adminListProducts_(); },
  adminSaveProduct: function (p) { return adminSaveProduct_(p.product); },
  adminDeleteProduct: function (p) { return adminDeleteProduct_(p.id); },
  adminUploadImage: function (p) { return uploadImage_(p); },
  adminListOrders: function (p) { return adminListOrders_(p); },
  adminUpdateOrderStatus: function (p) { return updateOrderStatus_(str_(p.orderId, 40), str_(p.status, 40)); },
  adminListInquiries: function () { return adminListInquiries_(); },
  adminUpdateInquiry: function (p) { return adminUpdateInquiry_(str_(p.id, 40), str_(p.status, 40)); },
  adminRegisterSale: function (p) { return adminRegisterSale_(str_(p.orderId, 40)); },
  adminListBilling: function () { return adminListBilling_(); },
  adminGetSettings: function () { return adminGetSettings_(); },
  adminSaveSettings: function (p) { return { values: saveSettings_(p.values) }; }
};

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorOut_(err) {
  if (err instanceof ApiError) {
    return jsonOut_({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error(err && err.stack ? err.stack : err);
  return jsonOut_({ ok: false, error: { code: 'INTERNAL', message: 'Error interno. Intentá de nuevo más tarde.' } });
}

function doGet(e) {
  try {
    var action = e && e.parameter ? e.parameter.action : '';
    if (action === 'catalog') return jsonOut_({ ok: true, data: getCatalog_() });
    if (action === 'health') return jsonOut_({ ok: true, data: { version: CONFIG.VERSION, time: nowIso_() } });
    fail_('NOT_FOUND', 'Acción no disponible.');
  } catch (err) {
    return errorOut_(err);
  }
}

function doPost(e) {
  try {
    var body = e && e.postData ? String(e.postData.contents || '') : '';
    if (!body) fail_('VALIDATION', 'Solicitud vacía.');
    if (body.length > CONFIG.SECURITY.adminMaxBodyBytes) fail_('TOO_LARGE', 'La solicitud es demasiado grande.');
    var payload;
    try { payload = JSON.parse(body); } catch (x) { fail_('VALIDATION', 'JSON inválido.'); }
    if (!payload || typeof payload !== 'object') fail_('VALIDATION', 'Solicitud inválida.');
    var action = String(payload.action || '');

    if (Object.prototype.hasOwnProperty.call(PUBLIC_POST_ACTIONS_, action)) {
      if (body.length > CONFIG.SECURITY.publicMaxBodyBytes) fail_('TOO_LARGE', 'La solicitud es demasiado grande.');
      return jsonOut_({ ok: true, data: PUBLIC_POST_ACTIONS_[action](payload) });
    }
    if (Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS_, action)) {
      var session = action === 'adminLogout' ? null : requireSession_(payload.token);
      var data = ADMIN_ACTIONS_[action](payload, session);
      if (session) data = Object.assign({}, data, { _session: { expiresAt: session.expiresAt } });
      return jsonOut_({ ok: true, data: data });
    }
    fail_('NOT_FOUND', 'Acción no disponible.');
  } catch (err) {
    return errorOut_(err);
  }
}
