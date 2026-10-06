/**
 * Menú "Tienda CRM" en la planilla (script vinculado) y utilidades de puesta en marcha.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tienda CRM')
    .addItem('1. Inicializar pestañas faltantes', 'menuInitSheets')
    .addItem('2. Crear / cambiar usuario admin', 'menuSetAdminUser')
    .addItem('3. Diagnóstico de configuración', 'menuDiagnose')
    .addSeparator()
    .addItem('Quitar usuario admin', 'menuRemoveAdminUser')
    .addItem('Cerrar todas las sesiones del panel', 'menuRevokeSessions')
    .addItem('Cargar productos de ejemplo (solo planilla vacía)', 'menuSeedDemo')
    .addToUi();
}

/** Crea las pestañas que falten y agrega columnas faltantes AL FINAL (no borra ni mueve nada). */
function initSheets() {
  var ss = getSpreadsheet_();
  var report = [];
  Object.keys(CONFIG.SHEETS).forEach(function (key) {
    var def = CONFIG.SHEETS[key];
    var titles = Object.keys(def.columns).map(function (k) { return def.columns[k]; });
    var sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
      sheet.getRange(1, 1, 1, titles.length).setValues([titles]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      report.push('Creada: ' + def.name);
      return;
    }
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normKey_);
    var missing = titles.filter(function (t) { return existing.indexOf(normKey_(t)) < 0; });
    if (missing.length) {
      var start = sheet.getLastColumn() + 1;
      sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
      report.push(def.name + ': columnas agregadas al final -> ' + missing.join(', '));
    }
  });
  return report.length ? report : ['Todas las pestañas y columnas ya existían.'];
}

function diagnose() {
  var out = [];
  try { out.push('Planilla: ' + getSpreadsheet_().getName()); } catch (e) { return ['ERROR: ' + e.message]; }
  Object.keys(CONFIG.SHEETS).forEach(function (key) {
    try {
      var t = openTable_(key, { optional: key === 'variants' || key === 'customers' || key === 'settings' });
      if (!t) { out.push('AVISO: falta la pestaña opcional "' + CONFIG.SHEETS[key].name + '"'); return; }
      var missingOptional = Object.keys(CONFIG.SHEETS[key].columns).filter(function (c) { return !t.has(c); });
      out.push('OK ' + CONFIG.SHEETS[key].name + ' (' + t.rows().length + ' filas)' +
        (missingOptional.length ? ' — columnas opcionales ausentes: ' + missingOptional.map(function (c) { return CONFIG.SHEETS[key].columns[c]; }).join(', ') : ''));
    } catch (e) {
      out.push('ERROR ' + CONFIG.SHEETS[key].name + ': ' + e.message);
    }
  });
  try {
    var cat = buildPublicCatalog_();
    out.push('Catálogo público: ' + cat.products.length + ' productos visibles, ' + cat.categories.length + ' categorías.');
  } catch (e) { out.push('ERROR catálogo: ' + e.message); }
  var users = Object.keys(getAdminUsers_());
  out.push(users.length ? 'Usuarios admin: ' + users.join(', ') : 'AVISO: no hay usuarios admin. Usá "Crear / cambiar usuario admin".');
  var img = CONFIG.IMAGE_STORAGE;
  if (img.provider === 'drive') {
    var folderId = img.drive.folderId || PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
    if (!folderId) out.push('AVISO: falta IMAGE_STORAGE.drive.folderId para subir fotos.');
    else {
      try { out.push('Carpeta de fotos: ' + DriveApp.getFolderById(folderId).getName()); }
      catch (e) { out.push('ERROR carpeta de fotos: ' + e.message); }
    }
  } else if (img.provider === 'github') {
    out.push(PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') ? 'GitHub: token configurado (no se muestra).' : 'AVISO: falta GITHUB_TOKEN en Propiedades del script.');
  }
  if (CONFIG.SECURITY.requireTurnstile && !PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET')) {
    out.push('ERROR: requireTurnstile=true pero falta TURNSTILE_SECRET.');
  }
  out.push('Facturación fiscal: NO integrada (solo registros internos).');
  return out;
}

function seedDemoProducts() {
  var products = openTable_('products');
  if (products.rows().length) return ['La pestaña Productos ya tiene datos: no se cargó nada.'];
  var demo = [
    ['DEMO-001', 'Producto de ejemplo A', 'Descripción de ejemplo. Reemplazar desde el CRM.', 'Categoría 1', 12000, '', 7000, 10, 'Publicado', 'SI'],
    ['DEMO-002', 'Producto de ejemplo B', 'Producto con variantes de ejemplo.', 'Categoría 1', 8500, 9900, 4000, '', 'Publicado', 'NO'],
    ['DEMO-003', 'Producto de ejemplo C', 'Producto pausado: no aparece en la tienda.', 'Categoría 2', 5000, '', 2500, 3, 'Pausado', 'NO']
  ];
  demo.forEach(function (d) {
    products.append({ id: d[0], name: d[1], description: d[2], category: d[3], price: d[4], compareAtPrice: d[5], cost: d[6], stock: d[7], status: d[8], featured: d[9], updatedAt: nowLocal_() });
  });
  var variants = openTable_('variants', { optional: true });
  if (variants) {
    variants.append({ id: 'DEMO-002-V1', productId: 'DEMO-002', name: 'Color: Gris', price: '', stock: 4, active: 'SI' });
    variants.append({ id: 'DEMO-002-V2', productId: 'DEMO-002', name: 'Color: Verde', price: '', stock: 0, active: 'SI' });
  }
  invalidateCatalog_();
  return ['Se cargaron 3 productos de ejemplo (sin fotos).'];
}

/* --------------------------- Envoltorios del menú -------------------------- */

function showLines_(title, lines) {
  SpreadsheetApp.getUi().alert(title, lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuInitSheets() { showLines_('Inicializar pestañas', initSheets()); }
function menuDiagnose() { showLines_('Diagnóstico', diagnose()); }
function menuSeedDemo() { showLines_('Datos de ejemplo', seedDemoProducts()); }
function menuRevokeSessions() { revokeAllSessions_(); showLines_('Sesiones', ['Se cerraron todas las sesiones del panel.']); }

function menuSetAdminUser() {
  var ui = SpreadsheetApp.getUi();
  var u = ui.prompt('Usuario admin', 'Nombre de usuario (3-60 caracteres):', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  var p = ui.prompt('Contraseña', 'Mínimo 10 caracteres. No se guarda en la planilla.\n(Se recomienda una frase larga y única.)', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  try {
    var name = setAdminUser_(u.getResponseText(), p.getResponseText());
    showLines_('Usuario admin', ['Usuario "' + name + '" guardado. Se cerraron las sesiones abiertas.']);
  } catch (e) {
    showLines_('Error', [e.message]);
  }
}

function menuRemoveAdminUser() {
  var ui = SpreadsheetApp.getUi();
  var u = ui.prompt('Quitar usuario admin', 'Usuarios actuales: ' + Object.keys(getAdminUsers_()).join(', '), ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  removeAdminUser_(u.getResponseText());
  showLines_('Usuario admin', ['Usuario quitado (si existía). Se cerraron las sesiones abiertas.']);
}
