/**
 * Autenticación del panel.
 *
 * Diferencias con el patrón de referencia (hash de contraseña reutilizable
 * enviado en cada llamada y guardado en localStorage, lectura por JSONP):
 *  - La contraseña viaja SOLO en el login (POST, nunca en la URL) y se
 *    verifica contra un hash PBKDF2-HMAC-SHA256 con sal, guardado en
 *    Propiedades del script (no en la planilla ni en el código).
 *  - El login devuelve un token de sesión aleatorio (distinto en cada
 *    inicio de sesión) con vencimiento por inactividad y máximo absoluto. Se guarda en
 *    el servidor (CacheService) solo como hash: si se filtra la caché no
 *    sirve para entrar. El panel lo guarda en sessionStorage (se borra al
 *    cerrar la pestaña), nunca en localStorage.
 *  - Cerrar sesión invalida el token en el servidor. "Cerrar todas las
 *    sesiones" invalida todos los tokens emitidos.
 *  - Intentos de login limitados por usuario y globalmente.
 *  - Nada privado se lee por JSONP ni por GET.
 *
 * Limitaciones (ver docs/SEGURIDAD.md): Apps Script no permite cookies
 * HttpOnly ni ver la IP del visitante; el token queda accesible a JavaScript
 * del panel, por lo que el panel aplica una CSP estricta y no inserta HTML
 * sin escapar.
 */

function getAdminUsers_() {
  var raw = PropertiesService.getScriptProperties().getProperty('ADMIN_USERS');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function hashPassword_(password, saltB64, iterations) {
  var key = Utilities.newBlob(String(password)).getBytes();
  var block = Utilities.base64Decode(saltB64).concat([0, 0, 0, 1]);
  var u = Utilities.computeHmacSha256Signature(block, key);
  var acc = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, key);
    for (var j = 0; j < acc.length; j++) acc[j] ^= u[j];
  }
  return Utilities.base64Encode(acc);
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Crea o cambia un usuario admin. Usado desde el menú de la planilla. */
function setAdminUser_(username, password) {
  username = normKey_(username);
  if (!/^[a-z0-9._@-]{3,60}$/.test(username)) fail_('VALIDATION', 'Usuario inválido (3-60 caracteres: letras, números, . _ - @).');
  if (String(password || '').length < 10) fail_('VALIDATION', 'La contraseña debe tener al menos 10 caracteres.');
  var salt = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid()));
  var iterations = CONFIG.SECURITY.passwordIterations;
  var users = getAdminUsers_();
  users[username] = { salt: salt, hash: hashPassword_(password, salt, iterations), iterations: iterations, updatedAt: nowIso_() };
  PropertiesService.getScriptProperties().setProperty('ADMIN_USERS', JSON.stringify(users));
  revokeAllSessions_(); // cambiar una contraseña cierra todas las sesiones abiertas
  return username;
}

function removeAdminUser_(username) {
  var users = getAdminUsers_();
  delete users[normKey_(username)];
  PropertiesService.getScriptProperties().setProperty('ADMIN_USERS', JSON.stringify(users));
  revokeAllSessions_();
}

function sessionEpoch_() {
  return PropertiesService.getScriptProperties().getProperty('SESSION_EPOCH') || '1';
}

function revokeAllSessions_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SESSION_EPOCH', String(Number(props.getProperty('SESSION_EPOCH') || 1) + 1));
}

function login_(p) {
  var S = CONFIG.SECURITY;
  var username = normKey_(p && p.username);
  var password = String((p && p.password) || '');
  if (!username || !password || password.length > 200) fail_('AUTH', 'Usuario o contraseña incorrectos.');

  var cache = CacheService.getScriptCache();
  var attemptsKey = 'login:' + sha256Hex_(username);
  var attempts = Number(cache.get(attemptsKey) || 0);
  if (attempts >= S.loginMaxAttempts) {
    fail_('LOCKED', 'Demasiados intentos. Esperá ' + S.loginWindowMinutes + ' minutos e intentá de nuevo.');
  }
  if (!rateLimit_('login:global', 30, 60)) fail_('RATE_LIMIT', 'Demasiados intentos. Probá en un minuto.');

  var users = getAdminUsers_();
  var user = users[username];
  // Se calcula el hash aunque el usuario no exista, para no revelar cuáles existen por tiempo de respuesta.
  var probe = user || { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', hash: 'x', iterations: S.passwordIterations };
  var ok = safeEqual_(hashPassword_(password, probe.salt, probe.iterations || S.passwordIterations), probe.hash) && !!user;
  if (!ok) {
    cache.put(attemptsKey, String(attempts + 1), S.loginWindowMinutes * 60);
    fail_('AUTH', 'Usuario o contraseña incorrectos.');
  }
  cache.remove(attemptsKey);
  return createSession_(username);
}

function createSession_(username) {
  var S = CONFIG.SECURITY;
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var now = Date.now();
  var session = { user: username, created: now, epoch: sessionEpoch_() };
  CacheService.getScriptCache().put('sess:' + sha256Hex_(token), JSON.stringify(session), S.sessionTtlMinutes * 60);
  return { token: token, user: username, expiresAt: sessionExpiry_(session, now) };
}

function sessionExpiry_(session, now) {
  var S = CONFIG.SECURITY;
  return Math.min(now + S.sessionTtlMinutes * 60000, session.created + S.sessionMaxHours * 3600000);
}

/** Valida el token y extiende la sesión (vencimiento deslizante). */
function requireSession_(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(String(token))) fail_('AUTH_REQUIRED', 'Iniciá sesión.');
  var cache = CacheService.getScriptCache();
  var key = 'sess:' + sha256Hex_(token);
  var raw = cache.get(key);
  if (!raw) fail_('AUTH_REQUIRED', 'La sesión venció. Iniciá sesión de nuevo.');
  var session = JSON.parse(raw);
  var now = Date.now();
  var S = CONFIG.SECURITY;
  if (session.epoch !== sessionEpoch_() || now > session.created + S.sessionMaxHours * 3600000 || !getAdminUsers_()[session.user]) {
    cache.remove(key);
    fail_('AUTH_REQUIRED', 'La sesión venció. Iniciá sesión de nuevo.');
  }
  var remaining = Math.floor((session.created + S.sessionMaxHours * 3600000 - now) / 1000);
  cache.put(key, raw, Math.max(1, Math.min(S.sessionTtlMinutes * 60, remaining)));
  session.expiresAt = sessionExpiry_(session, now);
  return session;
}

function logout_(token) {
  if (token && /^[a-f0-9]{64}$/.test(String(token))) {
    CacheService.getScriptCache().remove('sess:' + sha256Hex_(token));
  }
  return { loggedOut: true };
}
