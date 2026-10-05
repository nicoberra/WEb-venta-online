/**
 * Utilidades comunes: errores, normalización, celdas seguras, caché y límites.
 */

function ApiError(code, message, details) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message;
  this.details = details || null;
}
ApiError.prototype = Object.create(Error.prototype);

function fail_(code, message, details) {
  throw new ApiError(code, message, details);
}

/** "Categoría " -> "categoria" (para comparar títulos de columnas y estados). */
function normKey_(value) {
  return String(value == null ? '' : value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function str_(value, maxLen) {
  var s = value == null ? '' : String(value);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Evita "inyección de fórmulas": un texto que empieza con = + - @ sería
 * interpretado por Sheets como fórmula. Se antepone un apóstrofo.
 */
function safeCell_(value) {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return "'" + value;
  return value;
}

/** Acepta números de Sheets o textos como "12.500", "12500,50", "$ 1.234,5". */
function num_(value, fallback) {
  if (typeof value === 'number' && isFinite(value)) return value;
  var s = String(value == null ? '' : value).replace(/[^\d,.\-]/g, '');
  if (!s) return fallback === undefined ? null : fallback;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.indexOf(',') >= 0) {
    s = s.replace(',', '.');
  } else if (/^\-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  var n = Number(s);
  return isFinite(n) ? n : (fallback === undefined ? null : fallback);
}

function bool_(value) {
  if (value === true) return true;
  var k = normKey_(value);
  return k === 'si' || k === 'sí' || k === 'true' || k === 'x' || k === '1' || k === 'yes';
}

function money_(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function nowIso_() {
  return new Date().toISOString();
}

function nowLocal_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function isEmail_(s) {
  return /^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[a-z]{2,}$/i.test(s);
}

function isPhone_(s) {
  var digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 20;
}

function randomId_(prefix) {
  return (prefix || '') + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

function getSpreadsheet_() {
  var id = CONFIG.SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) fail_('CONFIG', 'Falta SPREADSHEET_ID en 00_Config.gs o en Propiedades del script.');
  return active;
}

/* ----------------------------- Caché por partes ----------------------------
 * CacheService admite ~100 KB por valor: los catálogos grandes se dividen. */
function cachePutLarge_(key, text, seconds) {
  var cache = CacheService.getScriptCache();
  var size = 90000;
  var parts = Math.ceil(text.length / size) || 1;
  var map = {};
  for (var i = 0; i < parts; i++) map[key + ':' + i] = text.slice(i * size, (i + 1) * size);
  map[key + ':n'] = String(parts);
  cache.putAll(map, seconds);
}

function cacheGetLarge_(key) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(key + ':n'));
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + ':' + i);
  var got = cache.getAll(keys);
  var out = '';
  for (var j = 0; j < n; j++) {
    if (got[keys[j]] == null) return null;
    out += got[keys[j]];
  }
  return out;
}

function cacheRemoveLarge_(key) {
  CacheService.getScriptCache().remove(key + ':n');
}

/**
 * Límite simple por ventana de tiempo usando CacheService.
 * rateLimit_ cuenta el intento y devuelve false si se superó el límite.
 * rateExceeded_/rateHit_ permiten consultar antes y contar solo los éxitos.
 * No es atómico entre ejecuciones simultáneas: es una barrera contra abuso,
 * no una garantía exacta.
 */
function rateKey_(bucket, windowSeconds) {
  return 'rl:' + bucket + ':' + Math.floor(Date.now() / 1000 / windowSeconds);
}

function rateExceeded_(bucket, max, windowSeconds) {
  return Number(CacheService.getScriptCache().get(rateKey_(bucket, windowSeconds)) || 0) >= max;
}

function rateHit_(bucket, windowSeconds) {
  var cache = CacheService.getScriptCache();
  var key = rateKey_(bucket, windowSeconds);
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), windowSeconds + 5);
  return count;
}

function rateLimit_(bucket, max, windowSeconds) {
  return rateHit_(bucket, windowSeconds) <= max;
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
