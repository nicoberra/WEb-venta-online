/**
 * Consultas y pedidos de cotización desde la tienda.
 * Solo AGREGA una fila; nunca devuelve datos del CRM.
 */

function createInquiry_(p) {
  checkPublicForm_(p);
  var data = {
    type: p.type === 'cotizacion' ? 'Cotización' : 'Consulta',
    name: str_(p.name, 120),
    email: str_(p.email, 254).toLowerCase(),
    phone: str_(p.phone, 40),
    productId: str_(p.productId, 64),
    message: str_(p.message, 2000)
  };
  var errors = {};
  if (data.name.length < 2) errors.name = 'Ingresá tu nombre.';
  if (!isEmail_(data.email)) errors.email = 'Ingresá un email válido.';
  if (data.phone && !isPhone_(data.phone)) errors.phone = 'El teléfono no parece válido.';
  if (data.message.length < 5) errors.message = 'Escribí tu consulta.';
  if (Object.keys(errors).length) fail_('VALIDATION', 'Revisá los datos del formulario.', { fields: errors });

  if (!rateLimit_('inquiries', CONFIG.SECURITY.maxInquiriesPerMinute, 60) ||
      !rateLimit_('inq:' + sha256Hex_(data.email), 3, 600)) {
    fail_('RATE_LIMIT', 'Recibimos varias consultas seguidas. Probá de nuevo en unos minutos.');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail_('BUSY', 'Intentá de nuevo en unos segundos.');
  try {
    var id = randomId_('Q-');
    openTable_('inquiries').append({
      id: id, createdAt: nowLocal_(), type: data.type, name: data.name, email: data.email,
      phone: data.phone, productId: data.productId, message: data.message, status: 'Nueva'
    });
    SpreadsheetApp.flush();
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}
