// Utilidades DOM sin dependencias. Todo texto se inserta escapado: el
// contenido que viene del CRM nunca se interpreta como HTML.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Plantilla segura: html`<p>${texto}</p>` escapa los valores; raw() los deja pasar. */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
      else if (v === false || v == null) out += '';
      else out += esc(v);
    }
  });
  return raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function setHtml(el, tpl) {
  el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl);
}

/** Texto multilínea del CRM -> párrafos escapados. */
export function paragraphs(text) {
  return raw(String(text || '').split(/\n{1,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join(''));
}

/** Atrapa el foco dentro de un diálogo y lo devuelve al cerrar. */
export function trapFocus(container, onEscape) {
  const previous = document.activeElement;
  const focusables = () => $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', container)
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onEscape?.(); return; }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', onKey);
  return function release() {
    container.removeEventListener('keydown', onKey);
    if (previous && typeof previous.focus === 'function') previous.focus();
  };
}

let liveRegion;
/** Anuncia cambios a lectores de pantalla (ej: "Producto agregado al carrito"). */
export function announce(message) {
  liveRegion = liveRegion || document.getElementById('live-region');
  if (!liveRegion) return;
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = message; }, 30);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
