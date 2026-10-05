// Panel privado del CRM: productos, fotos, pedidos, consultas, facturación
// interna y textos de la tienda. Toda acción pasa por la API con un token de
// sesión que vence; el token vive en sessionStorage (se borra al cerrar la pestaña).
import { STORE_CONFIG as CFG } from '../config.js';
import { createApi, ApiError, NetworkError } from '../lib/api.js';
import { html, raw, $, $$, setHtml, announce } from '../lib/dom.js';
import { createFormatter } from '../lib/format.js';
import { prepareImage, isAcceptedImage } from '../lib/image-resize.js';

const TOKEN_KEY = 'panel-sesion-v1';
const fmt = createFormatter(CFG.locale, CFG.currency);
const SETTINGS_LABELS = {
  announcement: ['Barra de aviso superior', 'Texto corto. Vacío = no se muestra.'],
  hero_badge: ['Banner: etiqueta', ''],
  hero_title: ['Banner: título', ''],
  hero_text: ['Banner: texto', ''],
  hero_button: ['Banner: texto del botón', 'Lleva al catálogo.'],
  shipping_info: ['Envíos', 'Un párrafo por línea.'],
  payment_info: ['Pagos', 'No afirmes medios de pago que no estén configurados.'],
  returns_info: ['Cambios y devoluciones', 'Texto definido por el negocio.'],
  faq: ['Preguntas frecuentes', 'Una por línea con el formato: Pregunta | Respuesta'],
  contact_email: ['Email de contacto', ''],
  contact_phone: ['Teléfono', ''],
  contact_whatsapp: ['WhatsApp', 'Con código de país, ej: 5491100000000'],
  contact_address: ['Dirección', ''],
  contact_hours: ['Horario de atención', ''],
  shipping_flat_cost: ['Costo fijo de envío', 'Número. Vacío o 0 = "a coordinar".'],
  min_order_total: ['Pedido mínimo', 'Número. Vacío = sin mínimo.']
};
const MULTILINE = new Set(['hero_text', 'shipping_info', 'payment_info', 'returns_info', 'faq']);

const state = { api: null, token: null, expiresAt: 0, tab: 'productos', products: [], productMeta: {}, search: '', statusFilter: '' };

/* --------------------------------- Sesión --------------------------------- */
function storedToken() {
  try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}
function storeToken(t) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* sin storage */ }
}

async function call(action, payload = {}) {
  try {
    const data = await state.api.post(action, { ...payload, token: state.token });
    if (data?._session?.expiresAt) { state.expiresAt = data._session.expiresAt; storeToken({ token: state.token, expiresAt: state.expiresAt }); updateSessionInfo(); }
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'AUTH_REQUIRED') {
      endSession(err.message);
    }
    throw err;
  }
}

function endSession(message) {
  state.token = null;
  state.expiresAt = 0;
  storeToken(null);
  renderLogin(message);
}

function updateSessionInfo() {
  const info = $('#session-info');
  if (!state.token) return;
  const mins = Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000));
  info.textContent = `Sesión activa · vence en ${mins} min sin actividad`;
}

setInterval(() => {
  if (state.token && state.expiresAt && Date.now() > state.expiresAt) endSession('La sesión venció. Iniciá sesión de nuevo.');
  else updateSessionInfo();
}, 30000);

/* --------------------------------- Login ---------------------------------- */
function renderLogin(message = '') {
  $('#admin-tabs').hidden = true;
  $('#session-box').hidden = true;
  const demo = state.api?.mode === 'demo';
  setHtml($('#admin-main'), html`<div class="login-wrap">
    <form class="card-form login-card" id="login-form" novalidate>
      <h1>Ingresar al panel</h1>
      ${demo ? html`<div class="notice notice-info"><p><strong>Modo demostración.</strong> Usuario <code>demo</code>, contraseña <code>demo</code>. Los cambios quedan solo en este navegador.</p></div>` : ''}
      ${message ? html`<div class="notice notice-warn" role="alert"><p>${message}</p></div>` : ''}
      <div class="field"><label for="lg-user">Usuario</label><input id="lg-user" name="username" autocomplete="username" required maxlength="60"></div>
      <div class="field"><label for="lg-pass">Contraseña</label><input id="lg-pass" name="password" type="password" autocomplete="current-password" required maxlength="200"></div>
      <div class="form-msg" role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit">Ingresar</button>
      <p class="fine-print">La sesión vence tras un período sin actividad y al cerrar la pestaña.</p>
    </form>
  </div>`);
  const form = $('#login-form');
  $('#lg-user').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('.form-msg');
    const btn = form.querySelector('button[type=submit]');
    const fd = Object.fromEntries(new FormData(form));
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      const r = await state.api.post('adminLogin', fd);
      state.token = r.token; state.expiresAt = r.expiresAt;
      storeToken({ token: r.token, expiresAt: r.expiresAt });
      form.reset();
      startApp();
    } catch (err) {
      msg.className = 'form-msg notice notice-error';
      msg.textContent = errorText(err);
      $('#lg-pass').value = '';
      $('#lg-pass').focus();
    } finally {
      btn.disabled = false; btn.textContent = 'Ingresar';
    }
  });
}

function errorText(err) {
  if (err instanceof NetworkError) return `${err.message} No se guardó ningún cambio.`;
  return err?.message || 'Error inesperado.';
}

/* ---------------------------------- App ----------------------------------- */
function startApp() {
  $('#admin-tabs').hidden = false;
  $('#session-box').hidden = false;
  updateSessionInfo();
  openTab(location.hash.replace('#', '') || 'productos');
}

const TABS = { productos: renderProducts, pedidos: renderOrders, consultas: renderInquiries, facturacion: renderBilling, textos: renderSettings, sesion: renderSecurity };

function openTab(tab) {
  if (!TABS[tab]) tab = 'productos';
  state.tab = tab;
  $$('#admin-tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  TABS[tab]();
}

function loading(text = 'Cargando…') {
  setHtml($('#admin-main'), html`<p class="muted" role="status">${text}</p>`);
}

function failView(err, retry) {
  setHtml($('#admin-main'), html`<div class="notice notice-error" role="alert"><p>${errorText(err)}</p><button type="button" class="btn btn-sm btn-outline" id="retry-btn">Reintentar</button></div>`);
  $('#retry-btn').addEventListener('click', retry);
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  announce(message);
}

/* ------------------------------- Productos -------------------------------- */
async function renderProducts() {
  loading('Cargando productos…');
  try {
    const data = await call('adminListProducts');
    state.products = data.products;
    state.productMeta = data;
  } catch (err) { if (state.token) failView(err, renderProducts); return; }
  setHtml($('#admin-main'), html`<div class="page-head">
      <h1>Productos</h1>
      <button type="button" class="btn btn-primary" id="new-product">Nuevo producto</button>
    </div>
    <p class="muted small">Lo que se publica acá aparece en la tienda automáticamente. El costo y las notas internas nunca se muestran al público.</p>
    <div class="filters-row">
      <label class="sr-only" for="p-search">Buscar</label>
      <input id="p-search" type="search" placeholder="Buscar por nombre, ID o categoría" value="${state.search}">
      <label class="sr-only" for="p-status">Estado</label>
      <select id="p-status">
        <option value="">Todos los estados</option>
        ${['Publicado', 'Pausado', 'Agotado'].map((s) => html`<option ${state.statusFilter === s ? raw('selected') : ''}>${s}</option>`)}
      </select>
    </div>
    <div id="product-list"></div>`);
  renderProductList();
  $('#new-product').addEventListener('click', () => openProductEditor(null));
  $('#p-search').addEventListener('input', (e) => { state.search = e.target.value; renderProductList(); });
  $('#p-status').addEventListener('change', (e) => { state.statusFilter = e.target.value; renderProductList(); });
}

function totalStock(p) {
  if (p.variants.length) return p.variants.filter((v) => v.active).reduce((a, v) => a + (Number(v.stock) || 0), 0);
  return p.stock === '' ? '—' : p.stock;
}

function renderProductList() {
  const q = state.search.toLowerCase().trim();
  const list = state.products.filter((p) => (!state.statusFilter || p.status === state.statusFilter) &&
    (!q || `${p.name} ${p.id} ${p.category}`.toLowerCase().includes(q)));
  const box = $('#product-list');
  if (!list.length) { setHtml(box, html`<p class="empty-state muted">No hay productos que coincidan.</p>`); return; }
  setHtml(box, html`<ul class="admin-list">${list.map((p) => html`<li class="admin-item">
    <div class="admin-thumb">${p.image?.url ? html`<img src="${p.image.url}" alt="" loading="lazy" referrerpolicy="no-referrer">` : html`<div class="photo-ph thumb" role="img" aria-label="Sin foto"><span>FOTO DE PRODUCTO</span></div>`}</div>
    <div class="admin-item-main">
      <p class="admin-item-title">${p.name}</p>
      <p class="small muted">${p.id}${p.category ? ` · ${p.category}` : ''}${p.variants.length ? ` · ${p.variants.length} variantes` : ''}</p>
    </div>
    <div class="admin-item-meta">
      <span class="tag ${p.status === 'Publicado' ? 'tag-ok' : p.status === 'Agotado' ? 'tag-warn' : 'tag-muted'}">${p.status}</span>
      <span class="small">${fmt.money(p.price)}</span>
      <span class="small muted">Stock: ${totalStock(p)}</span>
    </div>
    <button type="button" class="btn btn-sm btn-outline" data-edit="${p.id}" aria-label="${'Editar ' + p.name}">Editar</button>
  </li>`)}</ul>`);
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => openProductEditor(state.products.find((p) => p.id === b.dataset.edit))));
}

/* Editor de producto (diálogo nativo: maneja foco y tecla Escape). */
function openProductEditor(product) {
  const isNew = !product;
  const draft = product ? structuredClone(product) : {
    id: '', name: '', description: '', category: '', price: '', compareAtPrice: '', cost: '', stock: '', status: 'Pausado',
    featured: false, internalNotes: '', image: null, gallery: [], variants: []
  };
  const dialog = $('#product-dialog');
  const categories = [...new Set(state.products.map((p) => p.category).filter(Boolean))];
  let dirty = false;
  let uploading = 0;
  let message = null; // se conserva entre re-renderizados del formulario

  function photoTile(img, role, index) {
    return html`<div class="photo-tile">
      ${img.url ? html`<img src="${img.url}" alt="${role === 'main' ? 'Foto principal' : 'Foto adicional ' + (index + 1)}" referrerpolicy="no-referrer">`
        : html`<div class="photo-ph thumb"><span>${img.pending ? 'SUBIENDO…' : 'SIN VISTA PREVIA'}</span></div>`}
      ${img.pending ? html`<span class="tile-status" role="status">Subiendo…</span>` : ''}
      <div class="tile-actions">
        ${role === 'gallery' && !img.pending ? html`<button type="button" class="btn btn-sm btn-ghost" data-make-main="${index}">Hacer principal</button>` : ''}
        ${!img.pending ? html`<button type="button" class="btn btn-sm btn-ghost" data-remove-img="${role}:${index}">Quitar</button>` : ''}
      </div>
    </div>`;
  }

  function photosHtml() {
    const urlMode = state.productMeta.imageProvider === 'url';
    return html`<fieldset class="photos">
      <legend>Fotos</legend>
      <p class="small muted">${urlMode ? 'Pegá URLs públicas https.' : 'JPG, PNG o WebP. Se achican automáticamente antes de subirse.'} Sin foto, la tienda muestra “FOTO DE PRODUCTO”.</p>
      <div class="photo-main">
        <p class="small"><strong>Principal</strong></p>
        ${draft.image ? photoTile(draft.image, 'main', 0) : html`<div class="photo-ph thumb main-empty"><span>FOTO DE PRODUCTO</span></div>`}
        ${urlMode ? '' : html`<label class="btn btn-sm btn-outline file-btn">${draft.image ? 'Reemplazar foto' : 'Subir foto principal'}
          <input type="file" accept="image/jpeg,image/png,image/webp" data-upload="main" class="sr-only"></label>`}
      </div>
      <div>
        <p class="small"><strong>Adicionales</strong> (hasta 8)</p>
        <div class="photo-grid">${draft.gallery.map((g, i) => photoTile(g, 'gallery', i))}</div>
        ${!urlMode && draft.gallery.length < 8 ? html`<label class="btn btn-sm btn-outline file-btn">Agregar fotos
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload="gallery" class="sr-only"></label>` : ''}
      </div>
      <div class="url-row">
        <label for="pd-url" class="small">O pegar URL pública (https)</label>
        <div class="inline">
          <input id="pd-url" type="url" placeholder="https://…" inputmode="url">
          <button type="button" class="btn btn-sm btn-ghost" id="pd-url-add">Agregar</button>
        </div>
      </div>
    </fieldset>`;
  }

  function variantsHtml() {
    return html`<fieldset class="variants-editor">
      <legend>Variantes</legend>
      <p class="small muted">Ej: “Color: Gris”, “Talle: M”. Precio vacío = usa el del producto. Con variantes, el stock se maneja por variante.</p>
      ${draft.variants.length ? html`<div class="table-wrap"><table class="vtable">
        <thead><tr><th scope="col">Nombre</th><th scope="col">Precio</th><th scope="col">Stock</th><th scope="col">Activa</th><th scope="col"><span class="sr-only">Quitar</span></th></tr></thead>
        <tbody>${draft.variants.map((v, i) => html`<tr>
          <td><input aria-label="${'Nombre de la variante ' + (i + 1)}" data-v="${i}" data-vf="name" value="${v.name}" maxlength="120"></td>
          <td><input aria-label="${'Precio de la variante ' + (i + 1)}" data-v="${i}" data-vf="price" type="number" min="0" step="0.01" value="${v.price ?? ''}"></td>
          <td><input aria-label="${'Stock de la variante ' + (i + 1)}" data-v="${i}" data-vf="stock" type="number" min="0" step="1" value="${v.stock ?? ''}"></td>
          <td><input aria-label="${'Variante ' + (i + 1) + ' activa'}" data-v="${i}" data-vf="active" type="checkbox" ${v.active !== false ? raw('checked') : ''}></td>
          <td><button type="button" class="icon-btn" data-v-remove="${i}" aria-label="${'Quitar variante ' + (i + 1)}">✕</button></td>
        </tr>`)}</tbody></table></div>` : ''}
      <button type="button" class="btn btn-sm btn-outline" id="add-variant">Agregar variante</button>
    </fieldset>`;
  }

  function render() {
    setHtml(dialog, html`<form method="dialog" class="form editor" id="product-form" novalidate>
      <div class="dialog-head">
        <h2 id="pd-title">${isNew ? 'Nuevo producto' : 'Editar producto'}</h2>
        <button type="button" class="icon-btn" id="pd-close" aria-label="Cerrar sin guardar">✕</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field"><label for="pd-name">Nombre *</label><input id="pd-name" name="name" required maxlength="200" value="${draft.name}"></div>
          <div class="field"><label for="pd-id">ID ${isNew ? '(opcional, se genera solo)' : ''}</label><input id="pd-id" name="id" maxlength="64" value="${draft.id}" ${isNew ? '' : raw('readonly')} pattern="[A-Za-z0-9._-]+"></div>
          <div class="field"><label for="pd-cat">Categoría</label><input id="pd-cat" name="category" list="cat-options" maxlength="80" value="${draft.category}">
            <datalist id="cat-options">${categories.map((c) => html`<option value="${c}">`)}</datalist></div>
          <div class="field"><label for="pd-status">Estado</label><select id="pd-status" name="status">
            ${['Publicado', 'Pausado', 'Agotado'].map((s) => html`<option ${draft.status === s ? raw('selected') : ''}>${s}</option>`)}</select></div>
          <div class="field"><label for="pd-price">Precio *</label><input id="pd-price" name="price" type="number" min="0" step="0.01" required value="${draft.price}"></div>
          <div class="field"><label for="pd-compare">Precio anterior (oferta)</label><input id="pd-compare" name="compareAtPrice" type="number" min="0" step="0.01" value="${draft.compareAtPrice ?? ''}"></div>
          <div class="field"><label for="pd-cost">Costo <span class="tag tag-muted">privado</span></label><input id="pd-cost" name="cost" type="number" min="0" step="0.01" value="${draft.cost ?? ''}"></div>
          <div class="field"><label for="pd-stock">Stock ${draft.variants.length ? '(se usa el de cada variante)' : ''}</label><input id="pd-stock" name="stock" type="number" min="0" step="1" value="${draft.stock ?? ''}" ${draft.variants.length ? raw('disabled') : ''}></div>
        </div>
        <label class="check"><input type="checkbox" name="featured" ${draft.featured ? raw('checked') : ''}> Destacado en la portada</label>
        <div class="field"><label for="pd-desc">Descripción</label><textarea id="pd-desc" name="description" rows="4" maxlength="5000">${draft.description}</textarea></div>
        ${photosHtml()}
        ${variantsHtml()}
        <div class="field"><label for="pd-notes">Notas internas <span class="tag tag-muted">privado</span></label><textarea id="pd-notes" name="internalNotes" rows="2" maxlength="5000">${draft.internalNotes}</textarea></div>
        <div class="${message ? 'form-msg notice notice-' + message.kind : 'form-msg'}" id="pd-msg" role="alert">${message ? message.text : ''}</div>
      </div>
      <div class="dialog-foot">
        ${isNew ? '' : html`<button type="button" class="btn btn-danger" id="pd-delete">Eliminar</button>`}
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost" id="pd-cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary" id="pd-save">Guardar</button>
      </div>
    </form>`);
  }

  function readForm() {
    const form = $('#product-form');
    if (!form) return;
    const fd = new FormData(form);
    ['name', 'id', 'category', 'status', 'price', 'compareAtPrice', 'cost', 'description', 'internalNotes'].forEach((k) => { if (fd.has(k)) draft[k] = fd.get(k); });
    if (fd.has('stock')) draft.stock = fd.get('stock');
    draft.featured = fd.get('featured') === 'on';
    $$('[data-v]', form).forEach((inp) => {
      const v = draft.variants[Number(inp.dataset.v)];
      v[inp.dataset.vf] = inp.type === 'checkbox' ? inp.checked : inp.value;
    });
  }

  function rerender(focusSel) {
    readForm();
    const scroll = $('.dialog-body', dialog)?.scrollTop || 0;
    render();
    $('.dialog-body', dialog).scrollTop = scroll;
    if (focusSel) $(focusSel, dialog)?.focus();
  }

  function setMsg(kind, text) {
    message = { kind, text };
    const m = $('#pd-msg');
    m.className = `form-msg notice notice-${kind}`;
    m.textContent = text;
  }

  async function upload(files, role) {
    for (const file of files) {
      if (role === 'gallery' && draft.gallery.length >= 8) { setMsg('warn', 'Máximo 8 fotos adicionales.'); break; }
      if (!isAcceptedImage(file)) { setMsg('error', `"${file.name}": formato no permitido. Usá JPG, PNG o WebP.`); continue; }
      const preview = { ref: '', url: URL.createObjectURL(file), pending: true };
      const previous = draft.image;
      if (role === 'main') draft.image = preview; else draft.gallery.push(preview);
      uploading += 1; dirty = true;
      rerender();
      try {
        const isDemo = state.api.mode === 'demo';
        const prepared = await prepareImage(file, { maxSide: isDemo ? CFG.adminImage.demoMaxSide : CFG.adminImage.maxSide, quality: CFG.adminImage.quality });
        const maxBytes = state.productMeta.maxImageBytes || 4 * 1024 * 1024;
        if (prepared.bytes > maxBytes) throw new Error('La imagen sigue siendo demasiado grande después de achicarla.');
        const r = await call('adminUploadImage', { productId: draft.id || 'nuevo', fileName: file.name, mimeType: prepared.mimeType, dataBase64: prepared.dataBase64 });
        URL.revokeObjectURL(preview.url);
        Object.assign(preview, { ref: r.ref, url: r.url, pending: false });
        // La foto principal reemplazada se quita del almacenamiento al guardar (el backend la manda a la papelera).
        setMsg('success', 'Foto subida. Guardá el producto para publicarla.');
      } catch (err) {
        URL.revokeObjectURL(preview.url);
        if (role === 'main') draft.image = previous; else draft.gallery = draft.gallery.filter((g) => g !== preview);
        if (!state.token) return;
        setMsg('error', `No se pudo subir "${file.name}": ${errorText(err)}`);
      } finally {
        uploading -= 1;
        rerender();
      }
    }
  }

  async function save() {
    readForm();
    if (uploading) { setMsg('warn', 'Esperá a que terminen de subirse las fotos.'); return; }
    if (String(draft.name).trim().length < 2) { setMsg('error', 'El nombre es obligatorio.'); $('#pd-name').focus(); return; }
    if (draft.price === '' || Number(draft.price) < 0) { setMsg('error', 'Ingresá un precio válido.'); $('#pd-price').focus(); return; }
    const btn = $('#pd-save');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const payload = {
        ...draft, isNew,
        image: draft.image?.ref || '',
        gallery: draft.gallery.map((g) => g.ref).filter(Boolean),
        variants: draft.variants.map((v) => ({ id: v.id || '', name: v.name, price: v.price === '' ? '' : v.price, stock: v.stock, active: v.active !== false }))
      };
      if (draft.variants.length) payload.stock = '';
      await call('adminSaveProduct', { product: payload });
      dirty = false;
      dialog.close();
      toast(`"${draft.name}" guardado. La tienda lo mostrará en la próxima actualización del catálogo.`);
      renderProducts();
    } catch (err) {
      if (!state.token) { dialog.close(); return; }
      setMsg('error', errorText(err));
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  }

  function tryClose() {
    readForm();
    if ((dirty || uploading) && !confirm('Hay cambios sin guardar. ¿Cerrar igual?')) return;
    dialog.close();
  }

  render();
  dialog.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'pd-close' || t.id === 'pd-cancel') tryClose();
    else if (t.id === 'add-variant') { readForm(); draft.variants.push({ id: '', name: '', price: '', stock: 0, active: true }); dirty = true; rerender(`[data-v="${draft.variants.length - 1}"][data-vf="name"]`); }
    else if (t.dataset.vRemove) { readForm(); draft.variants.splice(Number(t.dataset.vRemove), 1); dirty = true; rerender('#add-variant'); }
    else if (t.dataset.removeImg) {
      readForm();
      const [role, i] = t.dataset.removeImg.split(':');
      if (role === 'main') draft.image = null; else draft.gallery.splice(Number(i), 1);
      dirty = true; rerender();
      setMsg('info', 'Foto quitada. Se eliminará del almacenamiento al guardar.');
    } else if (t.dataset.makeMain) {
      readForm();
      const i = Number(t.dataset.makeMain);
      const [img] = draft.gallery.splice(i, 1);
      if (draft.image) draft.gallery.unshift(draft.image);
      draft.image = img; dirty = true; rerender();
    } else if (t.id === 'pd-url-add') {
      readForm();
      const val = $('#pd-url').value.trim();
      if (!/^https:\/\/\S{4,}$/i.test(val)) { setMsg('error', 'La URL debe empezar con https://'); return; }
      const img = { ref: val, url: val };
      if (!draft.image) draft.image = img; else if (draft.gallery.length < 8) draft.gallery.push(img);
      dirty = true; rerender();
    } else if (t.id === 'pd-delete') {
      if (!confirm(`¿Eliminar "${draft.name}"? Se borran también sus variantes y fotos. Si tiene pedidos, conviene pausarlo en lugar de eliminarlo.`)) return;
      try {
        await call('adminDeleteProduct', { id: draft.id });
        dialog.close();
        toast('Producto eliminado.');
        renderProducts();
      } catch (err) { if (state.token) setMsg('error', errorText(err)); else dialog.close(); }
    }
  };
  dialog.onchange = (e) => {
    dirty = true;
    if (e.target.dataset.upload) {
      const files = [...e.target.files];
      e.target.value = '';
      readForm();
      upload(e.target.dataset.upload === 'main' ? files.slice(0, 1) : files, e.target.dataset.upload);
    }
  };
  dialog.oninput = () => { dirty = true; };
  dialog.onsubmit = (e) => { e.preventDefault(); save(); };
  dialog.oncancel = (e) => { e.preventDefault(); tryClose(); };
  dialog.showModal();
  $('#pd-name').focus();
}

/* -------------------------------- Pedidos --------------------------------- */
async function renderOrders() {
  loading('Cargando pedidos…');
  let data;
  try { data = await call('adminListOrders'); } catch (err) { if (state.token) failView(err, renderOrders); return; }
  setHtml($('#admin-main'), html`<div class="page-head"><h1>Pedidos</h1><button type="button" class="btn btn-sm btn-ghost" id="reload">Actualizar</button></div>
    <p class="muted small">Cancelar un pedido devuelve el stock una sola vez. “Registrar venta” crea un registro interno para reportes: <strong>no emite comprobantes fiscales</strong>.</p>
    ${data.orders.length ? html`<ul class="admin-list">${data.orders.map((o) => html`<li class="admin-item order-item">
      <div class="admin-item-main">
        <p class="admin-item-title">${o.id} · ${o.customerName}</p>
        <p class="small muted">${new Date(o.createdAt).toString() !== 'Invalid Date' ? new Date(o.createdAt).toLocaleString(CFG.locale) : o.createdAt} · ${o.delivery}${o.stockApplied ? ` · Stock: ${o.stockApplied}` : ''}</p>
        <details><summary class="small">Ver detalle</summary>
          <ul class="small">${o.items.map((l) => html`<li>${l.qty} × ${l.name}${l.variantName ? ` (${l.variantName})` : ''} — ${fmt.money(l.lineTotal)}</li>`)}</ul>
          <p class="small">Email: ${o.email} · Tel: ${o.phone}${o.address ? html`<br>Dirección: ${o.address}` : ''}${o.notes ? html`<br>Notas: ${o.notes}` : ''}</p>
          <p class="small">Subtotal ${fmt.money(o.subtotal)} · Envío ${fmt.money(o.shipping)}</p>
        </details>
      </div>
      <div class="admin-item-meta"><strong>${fmt.money(o.total)}</strong></div>
      <div class="order-actions">
        <label class="sr-only" for="${'st-' + o.id}">Estado del pedido ${o.id}</label>
        <select id="${'st-' + o.id}" data-order="${o.id}" data-prev="${o.status}" ${o.status === 'Cancelado' ? raw('disabled') : ''}>
          ${data.statuses.map((s) => html`<option ${s === o.status ? raw('selected') : ''}>${s}</option>`)}
        </select>
        <button type="button" class="btn btn-sm btn-outline" data-sale="${o.id}" ${o.status === 'Cancelado' ? raw('disabled') : ''}>Registrar venta</button>
      </div>
    </li>`)}</ul>` : html`<p class="empty-state muted">Todavía no hay pedidos.</p>`}`);
  $('#reload').addEventListener('click', renderOrders);
  $$('[data-order]').forEach((sel) => sel.addEventListener('change', async () => {
    const next = sel.value;
    if (next === 'Cancelado' && !confirm(`¿Cancelar el pedido ${sel.dataset.order}? Se devolverá el stock y no se podrá reabrir.`)) { sel.value = sel.dataset.prev; return; }
    sel.disabled = true;
    try {
      const r = await call('adminUpdateOrderStatus', { orderId: sel.dataset.order, status: next });
      sel.dataset.prev = r.status;
      toast(`Pedido ${r.orderId}: ${r.status}${r.stockApplied === 'DEVUELTO' ? ' (stock devuelto)' : ''}.`);
      if (next === 'Cancelado') renderOrders(); else sel.disabled = false;
    } catch (err) {
      sel.value = sel.dataset.prev; sel.disabled = false;
      if (state.token) toast(errorText(err));
    }
  }));
  $$('[data-sale]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await call('adminRegisterSale', { orderId: b.dataset.sale });
      toast(r.duplicate ? 'La venta ya estaba registrada.' : `Venta registrada (${r.id}). Estado fiscal: ${r.fiscalStatus}.`);
    } catch (err) { if (state.token) toast(errorText(err)); }
    finally { b.disabled = false; }
  }));
}

/* -------------------------------- Consultas -------------------------------- */
async function renderInquiries() {
  loading('Cargando consultas…');
  let data;
  try { data = await call('adminListInquiries'); } catch (err) { if (state.token) failView(err, renderInquiries); return; }
  setHtml($('#admin-main'), html`<div class="page-head"><h1>Consultas y cotizaciones</h1><button type="button" class="btn btn-sm btn-ghost" id="reload">Actualizar</button></div>
    ${data.inquiries.length ? html`<ul class="admin-list">${data.inquiries.map((q) => html`<li class="admin-item">
      <div class="admin-item-main">
        <p class="admin-item-title">${q.type} · ${q.name}</p>
        <p class="small muted">${q.email}${q.phone ? ` · ${q.phone}` : ''}${q.productId ? ` · Producto: ${q.productId}` : ''} · ${q.createdAt}</p>
        <p class="inquiry-msg">${q.message}</p>
      </div>
      <div>
        <label class="sr-only" for="${'iq-' + q.id}">Estado de la consulta</label>
        <select id="${'iq-' + q.id}" data-inq="${q.id}">${data.statuses.map((s) => html`<option ${s === q.status ? raw('selected') : ''}>${s}</option>`)}</select>
      </div>
    </li>`)}</ul>` : html`<p class="empty-state muted">No hay consultas.</p>`}`);
  $('#reload').addEventListener('click', renderInquiries);
  $$('[data-inq]').forEach((sel) => sel.addEventListener('change', async () => {
    try { await call('adminUpdateInquiry', { id: sel.dataset.inq, status: sel.value }); toast('Estado actualizado.'); }
    catch (err) { if (state.token) toast(errorText(err)); }
  }));
}

/* ------------------------------- Facturación ------------------------------- */
async function renderBilling() {
  loading('Cargando registros…');
  let data;
  try { data = await call('adminListBilling'); } catch (err) { if (state.token) failView(err, renderBilling); return; }
  setHtml($('#admin-main'), html`<div class="page-head"><h1>Facturación</h1></div>
    <div class="notice notice-warn"><p><strong>Integración fiscal pendiente.</strong> Este registro sirve para reportes internos de ventas. No emite facturas ni comprobantes oficiales: eso requiere conectar y probar el sistema fiscal correspondiente (ver README).</p></div>
    ${data.records.length ? html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th scope="col">Registro</th><th scope="col">Fecha</th><th scope="col">Pedido</th><th scope="col">Cliente</th><th scope="col">Total</th><th scope="col">Estado fiscal</th></tr></thead>
      <tbody>${data.records.map((r) => html`<tr><td>${r.id}</td><td>${r.createdAt}</td><td>${r.orderId}</td><td>${r.customerName}</td><td>${fmt.money(r.total)}</td><td>${r.fiscalStatus}</td></tr>`)}</tbody>
    </table></div>` : html`<p class="empty-state muted">Sin registros. Usá “Registrar venta” en un pedido.</p>`}`);
}

/* --------------------------------- Textos --------------------------------- */
async function renderSettings() {
  loading('Cargando textos…');
  let data;
  try { data = await call('adminGetSettings'); } catch (err) { if (state.token) failView(err, renderSettings); return; }
  setHtml($('#admin-main'), html`<div class="page-head"><h1>Textos de la tienda</h1></div>
    <p class="muted small">Vacío = se usa el texto por defecto de la plantilla. No incluyas textos legales que el negocio no haya definido.</p>
    <form id="settings-form" class="form settings-form" novalidate>
      ${data.keys.map((k) => {
        const [label, help] = SETTINGS_LABELS[k] || [k, ''];
        const id = `set-${k}`;
        return html`<div class="field">
          <label for="${id}">${label}</label>
          ${MULTILINE.has(k) ? html`<textarea id="${id}" name="${k}" rows="${k === 'faq' ? 6 : 3}" maxlength="5000">${data.values[k]}</textarea>`
            : html`<input id="${id}" name="${k}" maxlength="5000" value="${data.values[k]}" ${/cost|total/.test(k) ? raw('inputmode="decimal"') : ''}>`}
          ${help ? html`<p class="small muted">${help}</p>` : ''}
        </div>`;
      })}
      <div class="form-msg" role="alert"></div>
      <button type="submit" class="btn btn-primary">Guardar textos</button>
    </form>`);
  const form = $('#settings-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const msg = form.querySelector('.form-msg');
    btn.disabled = true;
    try {
      await call('adminSaveSettings', { values: Object.fromEntries(new FormData(form)) });
      msg.className = 'form-msg notice notice-success'; msg.textContent = 'Textos guardados.';
    } catch (err) {
      if (!state.token) return;
      msg.className = 'form-msg notice notice-error'; msg.textContent = errorText(err);
    } finally { btn.disabled = false; }
  });
}

/* -------------------------------- Seguridad -------------------------------- */
function renderSecurity() {
  const demo = state.api.mode === 'demo';
  setHtml($('#admin-main'), html`<div class="page-head"><h1>Seguridad y sesión</h1></div>
    <div class="card-form stack">
      <p>Sesión iniciada. Vence a las <strong>${new Date(state.expiresAt).toLocaleTimeString(CFG.locale)}</strong> si no hay actividad (cada acción la extiende, con un máximo de 6 horas).</p>
      <div class="inline">
        <button type="button" class="btn btn-outline" id="logout-here">Cerrar esta sesión</button>
        <button type="button" class="btn btn-danger" id="logout-all">Cerrar todas las sesiones</button>
      </div>
      <p class="small muted">Para crear o cambiar usuarios y contraseñas usá el menú “Tienda CRM” dentro de la planilla (solo quien tiene acceso a la planilla puede hacerlo).</p>
      ${demo ? html`<hr><p><strong>Demostración</strong></p><p class="small muted">Borra productos editados, fotos, pedidos y consultas de prueba de este navegador y vuelve a los datos de ejemplo.</p>
        <button type="button" class="btn btn-ghost" id="reset-demo">Restablecer demo</button>` : ''}
    </div>`);
  $('#logout-here').addEventListener('click', logout);
  $('#logout-all').addEventListener('click', async () => {
    if (!confirm('¿Cerrar todas las sesiones abiertas en todos los dispositivos?')) return;
    try { await call('adminLogoutAll'); } catch { /* igual se cierra localmente */ }
    endSession('Se cerraron todas las sesiones.');
  });
  $('#reset-demo')?.addEventListener('click', async () => {
    if (!confirm('¿Restablecer los datos de demostración?')) return;
    await call('adminResetDemo');
    toast('Demo restablecida.');
    openTab('productos');
  });
}

async function logout() {
  try { await state.api.post('adminLogout', { token: state.token }); } catch { /* sin conexión: igual se borra el token local */ }
  endSession('Sesión cerrada.');
}

/* --------------------------------- Inicio --------------------------------- */
async function boot() {
  $('#brand-name').textContent = `Panel · ${CFG.brand.name}`;
  $('#brand-mark').textContent = CFG.brand.logoInitials || 'TM';
  document.documentElement.style.setProperty('--primary', CFG.theme.primary);
  document.documentElement.style.setProperty('--on-primary', CFG.theme.primaryContrast);
  $('#logout-btn').addEventListener('click', logout);
  window.addEventListener('hashchange', () => { if (state.token) openTab(location.hash.replace('#', '')); });
  try {
    state.api = await createApi(CFG);
  } catch (err) {
    setHtml($('#admin-main'), html`<div class="notice notice-error"><p>${errorText(err)}</p></div>`);
    return;
  }
  const saved = storedToken();
  if (saved?.token && saved.expiresAt > Date.now()) {
    state.token = saved.token; state.expiresAt = saved.expiresAt;
    try {
      await call('adminSession');
      startApp();
      return;
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'AUTH_REQUIRED')) { renderLogin(errorText(err)); return; }
      return; // call() ya mostró el login
    }
  }
  renderLogin();
}

boot();
