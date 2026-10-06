// Tienda pública: arranque, estado, rutas y eventos.
import { STORE_CONFIG as CFG } from '../config.js';
import { createApi, NetworkError } from '../lib/api.js';
import { html, raw, $, $$, setHtml, paragraphs, trapFocus, announce } from '../lib/dom.js';
import { createFormatter, normalize } from '../lib/format.js';
import { createCart, priceCart } from '../lib/cart.js';
import * as T from './templates.js';
import { renderCheckout, renderCheckoutSummary, bindCheckout, bindInquiryForm } from './checkout.js';

const CATALOG_CACHE_KEY = 'tienda-catalogo-cache-v1';
const fmt = createFormatter(CFG.locale, CFG.currency);
const safeStorage = (() => { try { const s = window.localStorage; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch { return null; } })();

const state = {
  api: null,
  catalog: null,
  catalogStale: false,     // se muestra una copia guardada porque falló la conexión
  catalogError: null,
  filters: { category: '', query: '', sort: 'relevance', onlyAvailable: false },
  route: { name: 'home', params: {} },
  productView: { variantId: '', qty: 1, imageIndex: 0 },
  inquiryPrefill: {},
  orderResult: null        // confirmación del último pedido guardado
};
const cart = createCart(safeStorage);

export const ctx = { CFG, state, cart, fmt, settings, refreshCatalog, toast, navigate: (h) => { location.hash = h; } };

/* --------------------------------- Datos ---------------------------------- */
function settings() {
  return { ...CFG.defaults, ...(state.catalog?.settings || {}) };
}

function readCachedCatalog() {
  try { return JSON.parse(safeStorage?.getItem(CATALOG_CACHE_KEY) || 'null'); } catch { return null; }
}

async function refreshCatalog({ silent = false } = {}) {
  try {
    const data = await state.api.getCatalog();
    const changed = JSON.stringify([data.products, data.settings]) !== JSON.stringify([state.catalog?.products, state.catalog?.settings]);
    state.catalog = data;
    state.catalogStale = false;
    state.catalogError = null;
    try { safeStorage?.setItem(CATALOG_CACHE_KEY, JSON.stringify(data)); } catch { /* sin espacio */ }
    if (changed || !silent) render({ soft: silent });
    return true;
  } catch (err) {
    state.catalogError = err;
    if (!state.catalog) {
      const cached = readCachedCatalog();
      if (cached) { state.catalog = cached; state.catalogStale = true; }
    } else {
      state.catalogStale = true;
    }
    if (!silent) render();
    else renderStaleBanner();
    return false;
  }
}

/* --------------------------------- Rutas ---------------------------------- */
function parseRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [name, ...rest] = h.split('/');
  const arg = rest.join('/');
  if (!name) return { name: 'home', params: {} };
  if (name === 'producto' && arg) return { name: 'product', params: { id: arg } };
  if (name === 'checkout') return { name: 'checkout', params: {} };
  if (name === 'seccion') return { name: 'home', params: { section: arg } };
  if (name === 'categoria') return { name: 'home', params: { section: 'catalogo', category: arg } };
  return { name: 'notfound', params: {} };
}

function onRouteChange() {
  const prev = state.route;
  state.route = parseRoute();
  if (state.route.params.category !== undefined) state.filters.category = state.route.params.category;
  if (state.route.name === 'product' && prev.params.id !== state.route.params.id) {
    state.productView = { variantId: '', qty: 1, imageIndex: 0 };
  }
  if (state.route.name !== 'checkout') state.orderResult = null;
  closeCart(false);
  render();
  const section = state.route.params.section;
  if (section) {
    const target = document.getElementById(section);
    if (target) { target.scrollIntoView({ block: 'start' }); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
  } else if (prev.name !== state.route.name || prev.params.id !== state.route.params.id) {
    window.scrollTo(0, 0);
    $('#main').focus({ preventScroll: true });
  }
}

/* -------------------------------- Render ---------------------------------- */
function render({ soft = false } = {}) {
  const s = settings();
  applyChrome(s);
  const main = $('#main');
  if (!state.catalog) {
    if (state.catalogError) return setHtml(main, errorView(state.catalogError));
    return setHtml(main, html`<div class="container section">${T.skeletonGrid()}</div>`);
  }
  const r = state.route;
  if (r.name === 'checkout') {
    if (soft && $('#checkout-form')) { renderCheckoutSummary(ctx); }
    else { setHtml(main, renderCheckout(ctx)); bindCheckout(ctx); }
    setMeta(`Finalizar pedido | ${CFG.brand.name}`, CFG.seo.description);
  } else if (r.name === 'product') {
    renderProduct(main, r.params.id);
  } else if (r.name === 'notfound') {
    setHtml(main, html`<div class="container section empty-state"><h1>Página no encontrada</h1><a class="btn btn-primary" href="#/">Volver al inicio</a></div>`);
    setMeta(`Página no encontrada | ${CFG.brand.name}`, CFG.seo.description);
  } else if (soft && $('#catalog-results')) {
    renderCatalogResults();
  } else {
    renderHome(main, s);
  }
  renderStaleBanner();
  renderCartUi();
}

function errorView(err) {
  const msg = err instanceof NetworkError
    ? 'No pudimos conectarnos con la tienda. Revisá tu conexión a internet.'
    : (err?.message || 'No se pudo cargar el catálogo.');
  return html`<div class="container section">
    <div class="notice notice-error" role="alert">
      <p><strong>No se pudo cargar el catálogo.</strong> ${msg}</p>
      <button type="button" class="btn btn-primary" data-retry>Reintentar</button>
    </div>
  </div>`;
}

function renderStaleBanner() {
  let el = $('#stale-banner');
  if (!state.catalogStale) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'stale-banner';
    el.className = 'notice notice-warn container';
    el.setAttribute('role', 'status');
    $('#main').prepend(el);
  }
  setHtml(el, html`<p>Sin conexión con la tienda: estás viendo datos guardados que pueden estar desactualizados. Los pedidos se validan al confirmar.</p>
    <button type="button" class="btn btn-sm btn-outline" data-retry>Reintentar</button>`);
}

function applyChrome(s) {
  const ann = $('#announcement');
  ann.hidden = !s.announcement;
  ann.textContent = s.announcement || '';
  setHtml($('#footer'), T.footer(CFG, s));
}

function filteredProducts() {
  const f = state.filters;
  const q = normalize(f.query);
  let list = state.catalog.products.filter((p) =>
    (!f.category || p.category === f.category) &&
    (!f.onlyAvailable || p.available) &&
    (!q || normalize(`${p.name} ${p.category} ${p.description} ${p.variants.map((v) => v.name).join(' ')}`).includes(q)));
  const byAvail = (a, b) => Number(b.available) - Number(a.available);
  if (f.sort === 'price-asc') list = list.sort((a, b) => byAvail(a, b) || a.price - b.price);
  else if (f.sort === 'price-desc') list = list.sort((a, b) => byAvail(a, b) || b.price - a.price);
  else if (f.sort === 'name') list = list.sort((a, b) => a.name.localeCompare(b.name, CFG.locale));
  else list = list.sort((a, b) => byAvail(a, b) || Number(b.featured) - Number(a.featured));
  return list;
}

function renderHome(main, s) {
  const { products, categories } = state.catalog;
  const featured = products.filter((p) => p.featured && p.available).slice(0, 4);
  setHtml(main, html`
    ${T.hero(s)}
    ${T.categoriesSection(categories, products, state.filters.category)}
    ${featured.length ? html`<section class="section" aria-labelledby="feat-title">
      <div class="container">
        <h2 id="feat-title" class="section-title">Destacados</h2>
        <div class="grid products-grid">${featured.map((p) => T.productCard(p, fmt))}</div>
      </div>
    </section>` : ''}
    <section class="section" id="catalogo" aria-labelledby="catalog-title">
      <div class="container">
        <h2 id="catalog-title" class="section-title">Catálogo</h2>
        <div id="catalog-results"></div>
      </div>
    </section>
    ${T.infoSection(s)}
    ${T.faqSection(s)}
    ${T.contactSection(s, products, state.inquiryPrefill)}
  `);
  renderCatalogResults();
  bindInquiryForm(ctx);
  setMeta(CFG.seo.title, CFG.seo.description);
  setJsonLd({
    '@context': 'https://schema.org', '@type': 'Store', name: CFG.brand.name, description: CFG.seo.description,
    ...(CFG.seo.siteUrl ? { url: CFG.seo.siteUrl } : {}), ...(s.contact_email ? { email: s.contact_email } : {})
  });
}

function renderCatalogResults() {
  const box = $('#catalog-results');
  if (!box) return;
  const list = filteredProducts();
  const f = state.filters;
  const hasFilters = !!(f.category || f.query || f.onlyAvailable);
  const focusedId = document.activeElement?.id;
  setHtml(box, html`${T.catalogToolbar(state, state.catalog.categories, list.length)}
    ${list.length ? html`<div class="grid products-grid">${list.map((p) => T.productCard(p, fmt))}</div>` : T.emptyResults(hasFilters)}`);
  if (focusedId && document.getElementById(focusedId)) document.getElementById(focusedId).focus();
  $$('.cat-card').forEach((b) => {
    const on = b.dataset.category === f.category;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function renderProduct(main, id) {
  const p = state.catalog.products.find((x) => x.id === id);
  if (!p) {
    setHtml(main, html`<div class="container section empty-state">
      <h1>Producto no disponible</h1><p>Puede que se haya pausado o eliminado.</p>
      <a class="btn btn-primary" href="#/seccion/catalogo">Ver catálogo</a></div>`);
    setMeta(`Producto no disponible | ${CFG.brand.name}`, CFG.seo.description);
    return;
  }
  const pv = state.productView;
  if (pv.variantId && !p.variants.some((v) => v.id === pv.variantId)) pv.variantId = '';
  if (!pv.variantId && p.variants.length) pv.variantId = (p.variants.find((v) => v.available) || {}).id || '';
  const variant = p.variants.find((v) => v.id === pv.variantId) || null;
  const available = variant ? variant.available : p.available && !p.variants.length;
  const maxQty = variant ? variant.maxQty : p.maxQty;
  pv.qty = Math.max(1, Math.min(pv.qty, maxQty || 1));
  if (pv.imageIndex >= p.images.length) pv.imageIndex = 0;
  const unitPrice = variant ? variant.price : p.price;
  const related = state.catalog.products.filter((x) => x.id !== p.id && x.category === p.category && x.available).slice(0, 4);

  setHtml(main, html`<div class="container section product-page">
    <nav class="breadcrumb" aria-label="Ruta de navegación">
      <a href="#/">Inicio</a> <span aria-hidden="true">/</span>
      ${p.category ? html`<a href="${'#/categoria/' + encodeURIComponent(p.category)}">${p.category}</a> <span aria-hidden="true">/</span>` : ''}
      <span aria-current="page">${p.name}</span>
    </nav>
    <div class="product-layout">
      <div class="gallery">
        <div class="gallery-main">${T.productImage(p, { index: pv.imageIndex, size: 'square', eager: true })}</div>
        ${p.images.length > 1 ? html`<div class="thumbs" role="group" aria-label="Fotos del producto">
          ${p.images.map((img, i) => html`<button type="button" class="thumb${i === pv.imageIndex ? ' is-active' : ''}" data-thumb="${i}" aria-label="${'Ver foto ' + (i + 1)}" aria-pressed="${i === pv.imageIndex}">
            <img src="${img.url}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph-name="${p.name}"></button>`)}
        </div>` : ''}
      </div>
      <div class="product-info">
        ${p.category ? html`<p class="card-cat">${p.category}</p>` : ''}
        <h1 class="product-title">${p.name}</h1>
        <p class="price price-lg">
          <span class="price-now">${fmt.money(unitPrice)}</span>
          ${p.compareAtPrice ? html`<s class="price-old"><span class="sr-only">Antes: </span>${fmt.money(p.compareAtPrice)}</s>` : ''}
        </p>
        <p class="${available ? 'stock-ok' : 'stock-out'}">${available ? (p.lowStock ? 'Disponible · últimas unidades' : 'Disponible') : (p.variants.length && p.available ? 'Sin stock en esta opción' : 'Agotado')}</p>

        <form id="add-form" class="add-form">
          ${p.variants.length ? html`<fieldset class="variants">
            <legend>Opciones</legend>
            <div class="variant-list">
              ${p.variants.map((v) => html`<label class="variant${v.available ? '' : ' is-out'}">
                <input type="radio" name="variant" value="${v.id}" ${v.id === pv.variantId ? raw('checked') : ''}>
                <span>${v.name}${v.price !== p.price ? html` · ${fmt.money(v.price)}` : ''}${v.available ? '' : ' (agotado)'}</span>
              </label>`)}
            </div>
          </fieldset>` : ''}
          ${available ? html`<div class="qty-row">
            <label for="pd-qty">Cantidad</label>
            <div class="stepper">
              <button type="button" class="icon-btn" data-pd-step="-1" aria-label="Restar uno">${T.icon.minus}</button>
              <input id="pd-qty" type="number" inputmode="numeric" min="1" max="${maxQty}" value="${pv.qty}">
              <button type="button" class="icon-btn" data-pd-step="1" aria-label="Sumar uno">${T.icon.plus}</button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg btn-block">Agregar al carrito</button>`
          : html`<button type="button" class="btn btn-outline btn-block" data-ask="${p.id}">Consultar disponibilidad</button>`}
        </form>
        <button type="button" class="link-btn" data-quote="${p.id}">Pedir cotización por cantidad</button>
        <div class="description">
          <h2 class="sr-only">Descripción</h2>
          ${paragraphs(p.description)}
        </div>
      </div>
    </div>
    ${related.length ? html`<section class="section" aria-labelledby="rel-title">
      <h2 id="rel-title" class="section-title">También te puede interesar</h2>
      <div class="grid products-grid">${related.map((x) => T.productCard(x, fmt))}</div>
    </section>` : ''}
  </div>`);

  setMeta(`${p.name} | ${CFG.brand.name}`, (p.description || '').slice(0, 155) || CFG.seo.description);
  setJsonLd({
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.description,
    ...(p.images.length ? { image: p.images.map((i) => i.url) } : {}), ...(p.category ? { category: p.category } : {}),
    offers: { '@type': 'Offer', priceCurrency: CFG.currency, price: unitPrice, availability: available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' }
  });
}

/* --------------------------------- Carrito -------------------------------- */
let releaseCartFocus = null;

function openCart() {
  const drawer = $('#cart-drawer');
  renderCartUi();
  drawer.hidden = false;
  $('#cart-backdrop').hidden = false;
  document.body.classList.add('no-scroll');
  $('#cart-open').setAttribute('aria-expanded', 'true');
  releaseCartFocus = trapFocus(drawer, () => closeCart());
  $('#cart-close').focus();
}

function closeCart(restoreFocus = true) {
  const drawer = $('#cart-drawer');
  if (drawer.hidden) return;
  drawer.hidden = true;
  $('#cart-backdrop').hidden = true;
  document.body.classList.remove('no-scroll');
  $('#cart-open').setAttribute('aria-expanded', 'false');
  const release = releaseCartFocus;
  releaseCartFocus = null;
  if (release && restoreFocus) release();
}

function renderCartUi() {
  const count = cart.count();
  const badge = $('#cart-count');
  badge.textContent = String(count);
  $('#cart-open').setAttribute('aria-label', `Carrito, ${count} ${count === 1 ? 'producto' : 'productos'}`);
  if (!state.catalog) return;
  const priced = priceCart(cart.items, state.catalog);
  const body = $('#cart-body');
  const foot = $('#cart-foot');
  if (!priced.lines.length) {
    setHtml(body, html`<div class="empty-state cart-empty">
      <p class="empty-title">Tu carrito está vacío</p>
      <p class="muted">Agregá productos desde el catálogo.</p>
      <a class="btn btn-primary" href="#/seccion/catalogo" data-close-cart>Ver catálogo</a>
    </div>`);
    setHtml(foot, '');
    return;
  }
  setHtml(body, html`<ul class="cart-lines">${priced.lines.map((l) => cartLine(l))}</ul>`);
  const canCheckout = !priced.problems.length;
  setHtml(foot, html`
    ${priced.problems.length ? html`<p class="notice notice-warn">Hay productos sin stock suficiente. Ajustá las cantidades para continuar.</p>` : ''}
    <div class="sum-row"><span>Subtotal</span><strong>${fmt.money(priced.subtotal)}</strong></div>
    <p class="fine-print">El envío y el pago se coordinan al confirmar. Los precios se validan con el CRM al enviar el pedido.</p>
    <a class="btn btn-primary btn-block btn-lg${canCheckout ? '' : ' is-disabled'}" href="#/checkout" ${canCheckout ? '' : raw('aria-disabled="true" tabindex="-1"')} data-close-cart>Finalizar pedido</a>
    <button type="button" class="btn btn-ghost btn-block" data-close-cart>Seguir comprando</button>`);
}

function cartLine(l) {
  const key = `${l.productId}::${l.variantId}`;
  const thumb = l.product ? T.productImage(l.product, { size: 'thumb' }) : T.photoPlaceholder(l.name, 'thumb');
  return html`<li class="cart-line${l.issue ? ' has-issue' : ''}">
    <div class="cart-thumb">${thumb}</div>
    <div class="cart-info">
      <p class="cart-name">${l.product ? html`<a href="${'#/producto/' + encodeURIComponent(l.productId)}" data-close-cart>${l.name}</a>` : l.name}</p>
      ${l.variantName ? html`<p class="muted small">${l.variantName}</p>` : ''}
      <p class="small">${fmt.money(l.unitPrice)} c/u</p>
      ${l.issue ? html`<p class="line-issue">${T.icon.alert} ${l.issue}</p>` : ''}
      <div class="cart-actions">
        ${l.product && (l.variant ? l.variant.available : l.product.available) ? html`<div class="stepper stepper-sm">
          <button type="button" class="icon-btn" data-cart-step="-1" data-key="${key}" aria-label="${'Restar uno de ' + l.name}">${T.icon.minus}</button>
          <input type="number" inputmode="numeric" min="0" max="${l.maxQty ?? ''}" value="${l.qty}" data-cart-qty data-key="${key}" aria-label="${'Cantidad de ' + l.name}">
          <button type="button" class="icon-btn" data-cart-step="1" data-key="${key}" aria-label="${'Sumar uno de ' + l.name}" ${l.maxQty != null && l.qty >= l.maxQty ? raw('disabled') : ''}>${T.icon.plus}</button>
        </div>` : ''}
        <button type="button" class="icon-btn" data-cart-remove data-key="${key}" aria-label="${'Quitar ' + l.name}">${T.icon.trash}</button>
      </div>
    </div>
    <p class="cart-total">${l.issue ? '' : fmt.money(l.lineTotal)}</p>
  </li>`;
}

function addToCart(productId, variantId, qty) {
  const p = state.catalog.products.find((x) => x.id === productId);
  if (!p) return;
  const v = variantId ? p.variants.find((x) => x.id === variantId) : null;
  if (p.variants.length && !v) { toast('Elegí una opción.'); return; }
  if (v ? !v.available : !p.available) { toast('Este producto no tiene stock.'); return; }
  const max = v ? v.maxQty : p.maxQty;
  const before = cart.items.find((i) => i.productId === productId && (i.variantId || '') === (variantId || ''))?.qty || 0;
  const after = cart.add(productId, variantId, qty, max ?? Infinity);
  const name = p.name + (v ? ` (${v.name})` : '');
  if (after === before) toast(`Ya tenés la cantidad máxima disponible de ${name}.`);
  else { toast(`${name} se agregó al carrito.`); announce(`${name} agregado al carrito. Total: ${cart.count()} productos.`); }
}

const keyParts = (key) => { const [productId, variantId] = key.split('::'); return { productId, variantId: variantId || '' }; };

/* -------------------------------- Utilidades ------------------------------ */
let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function setMeta(title, description) {
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
}

function setJsonLd(obj) {
  $('#jsonld').textContent = JSON.stringify(obj).replace(/</g, '\\u003c');
}

function applyTheme() {
  const r = document.documentElement.style;
  const t = CFG.theme;
  r.setProperty('--primary', t.primary);
  r.setProperty('--on-primary', t.primaryContrast);
  r.setProperty('--accent', t.accent);
  r.setProperty('--surface', t.surface);
  r.setProperty('--radius', t.radius);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.primary);
  $('#brand-name').textContent = CFG.brand.name;
  const mark = $('#brand-mark');
  if (CFG.brand.logoUrl) {
    mark.textContent = '';
    const img = document.createElement('img');
    img.src = CFG.brand.logoUrl; img.alt = ''; img.className = 'brand-logo';
    mark.append(img);
    mark.classList.add('has-logo');
  } else {
    mark.textContent = CFG.brand.logoInitials || CFG.brand.name.slice(0, 2).toUpperCase();
  }
  if (CFG.seo.siteUrl) {
    const link = document.createElement('link');
    link.rel = 'canonical'; link.href = CFG.seo.siteUrl;
    document.head.append(link);
  }
}

/* --------------------------------- Eventos -------------------------------- */
function bindGlobalEvents() {
  window.addEventListener('hashchange', onRouteChange);

  // Si una foto no carga (enlace roto, permisos), se muestra el recuadro "FOTO DE PRODUCTO".
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.phName || img.dataset.failed) return;
    img.dataset.failed = '1';
    const ph = document.createElement('div');
    ph.className = `photo-ph ${img.classList.contains('square') ? 'square' : ''} ${img.classList.contains('thumb') ? 'thumb' : ''}`;
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', `Sin foto disponible: ${img.dataset.phName}`);
    ph.innerHTML = '<span>FOTO DE PRODUCTO</span>';
    img.replaceWith(ph);
  }, true);

  $('#cart-open').addEventListener('click', openCart);
  $('#cart-close').addEventListener('click', () => closeCart());
  $('#cart-backdrop').addEventListener('click', () => closeCart());

  const searchInput = $('#search-input');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.query = searchInput.value.trim();
      if (state.route.name === 'home') renderCatalogResults();
    }, 180);
  });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.filters.query = searchInput.value.trim();
    if (state.route.name !== 'home' || location.hash !== '#/seccion/catalogo') location.hash = '#/seccion/catalogo';
    else { renderCatalogResults(); document.getElementById('catalogo')?.scrollIntoView(); }
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.matches('[data-retry]')) { state.catalogError = null; render(); refreshCatalog(); return; }
    if (t.matches('[data-add]')) { addToCart(t.dataset.add, '', 1); return; }
    if (t.matches('[data-category]')) {
      state.filters.category = t.dataset.category;
      renderCatalogResults();
      if (t.classList.contains('cat-card')) document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (t.matches('[data-clear-filters]')) {
      state.filters = { ...state.filters, category: '', query: '', onlyAvailable: false };
      $('#search-input').value = '';
      renderCatalogResults();
      return;
    }
    if (t.matches('[data-close-cart]')) {
      if (t.classList.contains('is-disabled')) { e.preventDefault(); return; }
      closeCart(false);
      return;
    }
    if (t.matches('[data-cart-step]')) {
      const { productId, variantId } = keyParts(t.dataset.key);
      const line = priceCart(cart.items, state.catalog).lines.find((l) => l.productId === productId && l.variantId === variantId);
      if (line) cart.setQty(productId, variantId, line.qty + Number(t.dataset.cartStep), line.maxQty ?? Infinity);
      return;
    }
    if (t.matches('[data-cart-remove]')) {
      const { productId, variantId } = keyParts(t.dataset.key);
      cart.remove(productId, variantId);
      announce('Producto quitado del carrito.');
      $('#cart-close').focus();
      return;
    }
    if (t.matches('[data-thumb]')) { state.productView.imageIndex = Number(t.dataset.thumb); render(); $(`[data-thumb="${t.dataset.thumb}"]`)?.focus(); return; }
    if (t.matches('[data-pd-step]')) {
      const input = $('#pd-qty');
      const max = Number(input.max) || 1;
      state.productView.qty = Math.max(1, Math.min(max, (Number(input.value) || 1) + Number(t.dataset.pdStep)));
      input.value = state.productView.qty;
      return;
    }
    if (t.matches('[data-ask], [data-quote]')) {
      state.inquiryPrefill = { productId: t.dataset.ask || t.dataset.quote, type: t.dataset.quote ? 'cotizacion' : 'consulta' };
      location.hash = '#/seccion/contacto';
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'filter-sort') { state.filters.sort = t.value; renderCatalogResults(); }
    else if (t.id === 'filter-available') { state.filters.onlyAvailable = t.checked; renderCatalogResults(); }
    else if (t.name === 'variant' && t.closest('#add-form')) {
      state.productView.variantId = t.value;
      render();
      $(`#add-form input[value="${CSS.escape(t.value)}"]`)?.focus();
    } else if (t.id === 'pd-qty') {
      state.productView.qty = Math.max(1, Math.min(Number(t.max) || 1, Math.floor(Number(t.value) || 1)));
      t.value = state.productView.qty;
    } else if (t.matches('[data-cart-qty]')) {
      const { productId, variantId } = keyParts(t.dataset.key);
      cart.setQty(productId, variantId, t.value, t.max ? Number(t.max) : Infinity);
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'add-form') return;
    e.preventDefault();
    const qty = Math.max(1, Math.floor(Number($('#pd-qty')?.value) || 1));
    addToCart(state.route.params.id, state.productView.variantId, qty);
  });

  cart.onChange(() => {
    renderCartUi();
    if (state.route.name === 'checkout') render({ soft: true });
  });
  // Modo demo: si el panel (otra pestaña) cambia productos o fotos, la tienda se actualiza al instante.
  window.addEventListener('storage', (e) => {
    if (state.api?.mode === 'demo' && e.key && e.key.startsWith('tienda-demo-')) refreshCatalog({ silent: true });
  });

  // Actualización automática del catálogo (fotos, precios, stock) mientras la pestaña está visible.
  setInterval(() => { if (document.visibilityState === 'visible') refreshCatalog({ silent: true }); }, Math.max(30, CFG.catalogRefreshSeconds) * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCatalog({ silent: true }); });
}

/* --------------------------------- Inicio --------------------------------- */
async function boot() {
  applyTheme();
  bindGlobalEvents();
  state.route = parseRoute();
  render();
  try {
    state.api = await createApi(CFG);
  } catch (err) {
    state.catalogError = err;
    render();
    return;
  }
  if (state.api.mode === 'demo') document.documentElement.dataset.mode = 'demo';
  await refreshCatalog();
  onRouteChange();
}

boot();

