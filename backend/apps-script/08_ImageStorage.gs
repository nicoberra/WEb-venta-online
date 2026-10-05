/**
 * Subida de fotos de productos. Las credenciales (si las hay) se leen de
 * Propiedades del script y nunca se envían al navegador.
 *
 * En la planilla se guarda una REFERENCIA corta, no la imagen:
 *   drive:<ID de archivo>     -> Google Drive
 *   github:<ruta en el repo>  -> repositorio de GitHub
 *   https://...               -> URL pública pegada a mano
 */

var IMAGE_SIGNATURES_ = {
  'image/jpeg': function (b) { return (b[0] & 0xff) === 0xff && (b[1] & 0xff) === 0xd8 && (b[2] & 0xff) === 0xff; },
  'image/png': function (b) { return (b[0] & 0xff) === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; },
  'image/webp': function (b) { return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50; }
};
var IMAGE_EXT_ = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function isValidImageRef_(ref) {
  ref = String(ref || '');
  return /^drive:[\w-]{10,}$/.test(ref) ||
    /^github:[\w./-]{1,300}$/.test(ref) && ref.indexOf('..') < 0 ||
    /^https:\/\/[^\s"'<>]{4,1000}$/i.test(ref);
}

function uploadImage_(p) {
  var cfg = CONFIG.IMAGE_STORAGE;
  var mime = String(p.mimeType || '');
  if (cfg.allowedMime.indexOf(mime) < 0) fail_('VALIDATION', 'Formato no permitido. Usá JPG, PNG o WebP.');
  var bytes;
  try { bytes = Utilities.base64Decode(String(p.dataBase64 || '')); } catch (e) { fail_('VALIDATION', 'Archivo dañado.'); }
  if (!bytes || bytes.length < 16) fail_('VALIDATION', 'Archivo vacío.');
  if (bytes.length > cfg.maxBytes) fail_('VALIDATION', 'La imagen supera el tamaño máximo (' + Math.round(cfg.maxBytes / 1048576) + ' MB).');
  if (!IMAGE_SIGNATURES_[mime](bytes)) fail_('VALIDATION', 'El contenido no corresponde a una imagen ' + mime + '.');

  var productPart = String(p.productId || 'nuevo').replace(/[^\w-]/g, '').slice(0, 40) || 'nuevo';
  var fileName = productPart + '-' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmss') + '-' +
    Utilities.getUuid().slice(0, 6) + '.' + IMAGE_EXT_[mime];

  var ref;
  if (cfg.provider === 'drive') ref = uploadToDrive_(bytes, mime, fileName);
  else if (cfg.provider === 'github') ref = uploadToGithub_(bytes, productPart + '/' + fileName);
  else fail_('CONFIG', 'La subida de archivos está desactivada (provider = "url"). Pegá una URL pública https.');
  return { ref: ref, url: resolveImageUrl_(ref) };
}

function uploadToDrive_(bytes, mime, fileName) {
  var folderId = CONFIG.IMAGE_STORAGE.drive.folderId || PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  if (!folderId) fail_('CONFIG', 'Falta IMAGE_STORAGE.drive.folderId (carpeta de fotos públicas).');
  var file = DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, mime, fileName));
  try {
    // Solo este archivo queda visible con el enlace; la carpeta y el resto del Drive no.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    file.setTrashed(true);
    fail_('STORAGE', 'Drive no permitió compartir la foto con enlace público (puede estar bloqueado por la política de la organización).');
  }
  return 'drive:' + file.getId();
}

function githubRequest_(method, path, body) {
  var gh = CONFIG.IMAGE_STORAGE.github;
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token || !gh.owner || !gh.repo) fail_('CONFIG', 'Falta configurar GitHub (owner, repo y GITHUB_TOKEN en Propiedades del script).');
  var url = 'https://api.github.com/repos/' + encodeURIComponent(gh.owner) + '/' + encodeURIComponent(gh.repo) +
    '/contents/' + path.split('/').map(encodeURIComponent).join('/');
  var opts = {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  };
  if (method === 'get') url += '?ref=' + encodeURIComponent(gh.branch);
  else opts.payload = JSON.stringify(body);
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  var json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { /* vacío */ }
  return { code: code, json: json };
}

function uploadToGithub_(bytes, relPath) {
  var gh = CONFIG.IMAGE_STORAGE.github;
  var path = gh.pathPrefix.replace(/\/+$/, '') + '/' + relPath;
  var res = githubRequest_('put', path, {
    message: 'Foto de producto: ' + relPath, content: Utilities.base64Encode(bytes), branch: gh.branch
  });
  if (res.code !== 201 && res.code !== 200) fail_('STORAGE', 'GitHub rechazó la subida (HTTP ' + res.code + ').');
  return 'github:' + path;
}

/** Borra (papelera) una foto propia. Solo actúa dentro de la carpeta/ruta configurada. */
function deleteImageRef_(ref) {
  var cfg = CONFIG.IMAGE_STORAGE;
  if (!cfg.trashRemovedImages) return false;
  ref = String(ref || '');
  try {
    if (ref.indexOf('drive:') === 0 && cfg.provider === 'drive') {
      var folderId = cfg.drive.folderId || PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
      var file = DriveApp.getFileById(ref.slice(6));
      var parents = file.getParents();
      while (parents.hasNext()) {
        if (parents.next().getId() === folderId) { file.setTrashed(true); return true; }
      }
      return false; // fuera de la carpeta de fotos: no se toca
    }
    if (ref.indexOf('github:') === 0 && cfg.provider === 'github') {
      var path = ref.slice(7);
      if (path.indexOf(cfg.github.pathPrefix.replace(/\/+$/, '') + '/') !== 0 || path.indexOf('..') >= 0) return false;
      var meta = githubRequest_('get', path);
      if (meta.code !== 200 || !meta.json.sha) return false;
      var del = githubRequest_('delete', path, { message: 'Quitar foto de producto', sha: meta.json.sha, branch: cfg.github.branch });
      return del.code === 200;
    }
  } catch (e) {
    console.warn('No se pudo borrar la imagen ' + ref + ': ' + e);
  }
  return false;
}
