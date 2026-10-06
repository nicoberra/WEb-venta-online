/**
 * Pestaña "Tienda": textos editables (banner, envíos, pagos, cambios, FAQ,
 * contacto). Solo las claves de CONFIG.PUBLIC_SETTINGS_KEYS llegan a la tienda.
 */

function readSettings_() {
  var table = openTable_('settings', { optional: true });
  var out = {};
  if (!table) return out;
  table.rows().forEach(function (r) {
    var k = str_(r.key, 80);
    if (k) out[k] = r.value instanceof Date ? r.value.toISOString() : String(r.value == null ? '' : r.value);
  });
  return out;
}

function getPublicSettings_() {
  var all = readSettings_();
  var out = {};
  CONFIG.PUBLIC_SETTINGS_KEYS.forEach(function (k) {
    if (all[k] !== undefined && all[k] !== '') out[k] = all[k];
  });
  return out;
}

/** Guarda solo claves permitidas (las públicas). */
function saveSettings_(values) {
  if (!values || typeof values !== 'object') fail_('VALIDATION', 'Datos inválidos.');
  var table = openTable_('settings');
  CONFIG.PUBLIC_SETTINGS_KEYS.forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(values, k)) return;
    var v = str_(values[k], 5000);
    var row = table.find('key', k);
    if (row) table.update(row._row, { value: v });
    else table.append({ key: k, value: v });
  });
  invalidateCatalog_();
  return getPublicSettings_();
}
