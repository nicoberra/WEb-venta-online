/**
 * Acceso a pestañas como tablas, mapeando títulos de columnas -> claves internas
 * según CONFIG.SHEETS. Las columnas no mapeadas (propias del CRM) se respetan:
 * nunca se sobrescriben al actualizar.
 */

function openTable_(tableKey, options) {
  var def = CONFIG.SHEETS[tableKey];
  if (!def) fail_('CONFIG', 'Tabla no configurada: ' + tableKey);
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(def.name);
  if (!sheet) {
    if (options && options.optional) return null;
    fail_('CONFIG', 'No existe la pestaña "' + def.name + '". Ejecutá "Tienda CRM > Inicializar pestañas" o corregí 00_Config.gs.');
  }
  return new Table_(tableKey, def, sheet);
}

function Table_(tableKey, def, sheet) {
  this.key = tableKey;
  this.def = def;
  this.sheet = sheet;
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  this.width = headerRow.length;
  this.col = {}; // clave interna -> índice 0-based
  var byNorm = {};
  headerRow.forEach(function (h, i) {
    var k = normKey_(h);
    if (k && byNorm[k] === undefined) byNorm[k] = i;
  });
  var self = this;
  Object.keys(def.columns).forEach(function (internal) {
    var idx = byNorm[normKey_(def.columns[internal])];
    if (idx !== undefined) self.col[internal] = idx;
  });
  var missing = (def.required || []).filter(function (k) { return self.col[k] === undefined; });
  if (missing.length) {
    fail_('CONFIG', 'En la pestaña "' + def.name + '" faltan las columnas: ' +
      missing.map(function (k) { return '"' + def.columns[k] + '"'; }).join(', '));
  }
  this._rows = null;
}

Table_.prototype.has = function (internal) {
  return this.col[internal] !== undefined;
};

/** Lee todas las filas (una sola llamada a Sheets). Cada objeto trae _row. */
Table_.prototype.rows = function () {
  if (this._rows) return this._rows;
  var last = this.sheet.getLastRow();
  var out = [];
  if (last >= 2) {
    var values = this.sheet.getRange(2, 1, last - 1, this.width).getValues();
    var col = this.col;
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      var obj = { _row: r + 2 };
      var empty = true;
      for (var k in col) {
        obj[k] = row[col[k]];
        if (row[col[k]] !== '' && row[col[k]] !== null) empty = false;
      }
      if (!empty) out.push(obj);
    }
  }
  this._rows = out;
  return out;
};

Table_.prototype.find = function (internal, value) {
  var target = String(value);
  var rows = this.rows();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][internal]) === target) return rows[i];
  }
  return null;
};

/** Agrega una fila. Solo escribe columnas mapeadas; el resto queda vacío. */
Table_.prototype.append = function (obj) {
  var row = [];
  for (var i = 0; i < this.width; i++) row.push('');
  for (var k in obj) {
    if (this.col[k] !== undefined) row[this.col[k]] = safeCell_(obj[k]);
  }
  var target = this.sheet.getLastRow() + 1;
  this.sheet.getRange(target, 1, 1, this.width).setValues([row]);
  this._rows = null;
  return target;
};

/**
 * Actualiza celdas puntuales de una fila (no reescribe toda la fila para no
 * pisar fórmulas ni columnas propias del CRM).
 */
Table_.prototype.update = function (rowNumber, obj) {
  for (var k in obj) {
    if (this.col[k] === undefined) continue;
    this.sheet.getRange(rowNumber, this.col[k] + 1).setValue(safeCell_(obj[k]));
  }
  this._rows = null;
};

Table_.prototype.remove = function (rowNumber) {
  this.sheet.deleteRow(rowNumber);
  this._rows = null;
};
