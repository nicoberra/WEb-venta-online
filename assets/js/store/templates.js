// Plantillas de la tienda. Componentes reutilizables que reciben datos y
// devuelven HTML escapado. No contienen datos del catálogo.
import { html, raw, paragraphs } from '../lib/dom.js';
import { parseFaq } from '../lib/format.js';

export const icon = {
  minus: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>'),
  plus: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'),
  trash: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'),
  truck: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>'),
  card: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>'),
  swap: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12l-3-3M17 17H5l3 3"/></svg>'),
  back: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>'),
  check: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'),
  alert: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/></svg>')
};

/** Recuadro "FOTO DE PRODUCTO" para productos sin imagen. */
export function photoPlaceholder(name, size = '') {
  return html`<div class="photo-ph ${size}" role="img" aria-label="${'Sin foto disponible: ' + name}"><span>FOTO DE PRODUCTO</span></div>`;
}

export function productImage(p, { size = '', index = 0, eager = false } = {}) {
  const img = p.images?.[index];
  if (!img) return photoPlaceholder(p.name, size);
  return html`<img class="product-img ${size}" src="${img.url}" alt="${img.alt || p.name}" data-ph-name="${p.name}"
    loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">`;
}

export function priceBlock(p, fmt) {
  return html`<p class="price">
    <span class="price-now">${p.priceMax && p.priceMax !== p.price ? 'Desde ' : ''}${fmt.money(p.price)}</span>
    ${p.compareAtPrice ? html`<s class="price-old"><span class="sr-only">Antes: </span>${fmt.money(p.compareAtPrice)}</s>` : ''}
  </p>`;
}

export function badges(p) {
  const out = [];
  if (!p.available) out.push(html`<span class="tag tag-muted">Agotado</span>`);
  else if (p.lowStock) out.push(html`<span class="tag tag-warn">Últimas unidades</span>`);
  if (p.compareAtPrice && p.available) out.push(html`<span class="tag tag-sale">Oferta</span>`);
  return out.length ? html`<div class="tags">${out}</div>` : '';
}

export function productCard(p, fmt) {
  const url = `#/producto/${encodeURIComponent(p.id)}`;
  let action;
  if (!p.available) action = html`<a class="btn btn-ghost btn-block" href="${url}">Ver detalle</a>`;
  else if (p.variants.length) action = html`<a class="btn btn-outline btn-block" href="${url}">Elegir opciones</a>`;
  else action = html`<button type="button" class="btn btn-primary btn-block" data-add="${p.id}">Agregar al carrito</button>`;
  return html`<article class="card product-card${p.available ? '' : ' is-soldout'}">
    <a class="card-media" href="${url}" tabindex="-1" aria-hidden="true">${productImage(p, { size: 'square' })}</a>
    <div class="card-body">
      ${badges(p)}
      ${p.category ? html`<p class="card-cat">${p.category}</p>` : ''}
      <h3 class="card-title"><a href="${url}">${p.name}</a></h3>
      ${priceBlock(p, fmt)}
    </div>
    <div class="card-foot">${action}</div>
  </article>`;
}

export function skeletonGrid(n = 8) {
  return html`<div class="grid products-grid" aria-hidden="true">${Array.from({ length: n }, () => raw('<div class="card skeleton"><div class="sk-media"></div><div class="sk-line"></div><div class="sk-line short"></div></div>'))}</div>`;
}

export function hero(s) {
  return html`<section class="hero" aria-labelledby="hero-title">
    <div class="container hero-inner">
      ${s.hero_badge ? html`<p class="eyebrow">${s.hero_badge}</p>` : ''}
      <h1 id="hero-title">${s.hero_title}</h1>
      ${s.hero_text ? html`<p class="hero-text">${s.hero_text}</p>` : ''}
      ${s.hero_button ? html`<a class="btn btn-primary btn-lg" href="#/seccion/catalogo">${s.hero_button}</a>` : ''}
    </div>
  </section>`;
}

export function categoriesSection(categories, products, active) {
  if (!categories.length) return '';
  const count = (c) => products.filter((p) => p.category === c).length;
  return html`<section class="section" aria-labelledby="cats-title">
    <div class="container">
      <h2 id="cats-title" class="section-title">Categorías</h2>
      <ul class="cat-list">
        ${categories.map((c) => html`<li><button type="button" class="cat-card${active === c ? ' is-active' : ''}" data-category="${c}" aria-pressed="${active === c}">
          <span class="cat-name">${c}</span><span class="cat-count">${count(c)} ${count(c) === 1 ? 'producto' : 'productos'}</span>
        </button></li>`)}
      </ul>
    </div>
  </section>`;
}

export function catalogToolbar(state, categories, resultCount) {
  const f = state.filters;
  return html`<div class="toolbar">
    <div class="chips" role="group" aria-label="Filtrar por categoría">
      <button type="button" class="chip${!f.category ? ' is-active' : ''}" data-category="" aria-pressed="${!f.category}">Todas</button>
      ${categories.map((c) => html`<button type="button" class="chip${f.category === c ? ' is-active' : ''}" data-category="${c}" aria-pressed="${f.category === c}">${c}</button>`)}
    </div>
    <div class="toolbar-row">
      <label class="check">
        <input type="checkbox" id="filter-available" ${f.onlyAvailable ? raw('checked') : ''}>
        <span>Solo disponibles</span>
      </label>
      <label class="select-label">
        <span>Ordenar</span>
        <select id="filter-sort">
          ${[['relevance', 'Destacados'], ['price-asc', 'Menor precio'], ['price-desc', 'Mayor precio'], ['name', 'Nombre (A-Z)']]
            .map(([v, l]) => html`<option value="${v}" ${f.sort === v ? raw('selected') : ''}>${l}</option>`)}
        </select>
      </label>
    </div>
    <p class="results-count" role="status">${resultCount} ${resultCount === 1 ? 'producto' : 'productos'}${f.query ? html` para “${f.query}”` : ''}</p>
  </div>`;
}

export function emptyResults(hasFilters) {
  return html`<div class="empty-state">
    <p class="empty-title">No encontramos productos${hasFilters ? ' con esos filtros' : ''}.</p>
    ${hasFilters ? html`<button type="button" class="btn btn-outline" data-clear-filters>Limpiar filtros</button>` : ''}
  </div>`;
}

export function infoSection(s) {
  const blocks = [
    ['envios', 'Envíos', icon.truck, s.shipping_info],
    ['pagos', 'Pagos', icon.card, s.payment_info],
    ['cambios', 'Cambios y devoluciones', icon.swap, s.returns_info]
  ].filter((b) => b[3]);
  if (!blocks.length) return '';
  return html`<section class="section section-alt" id="envios" aria-labelledby="info-title">
    <div class="container">
      <h2 id="info-title" class="section-title">Envíos, pagos y cambios</h2>
      <div class="grid info-grid">
        ${blocks.map(([id, title, ic, text]) => html`<article class="info-card" id="${'info-' + id}">
          <span class="info-icon">${ic}</span>
          <h3>${title}</h3>
          ${paragraphs(text)}
        </article>`)}
      </div>
    </div>
  </section>`;
}

export function faqSection(s) {
  const faq = parseFaq(s.faq);
  if (!faq.length) return '';
  return html`<section class="section" id="preguntas" aria-labelledby="faq-title">
    <div class="container narrow">
      <h2 id="faq-title" class="section-title">Preguntas frecuentes</h2>
      <div class="faq">
        ${faq.map(({ q, a }) => html`<details><summary>${q}</summary><div class="faq-a">${paragraphs(a)}</div></details>`)}
      </div>
    </div>
  </section>`;
}

export function contactSection(s, products, prefill = {}) {
  const wa = String(s.contact_whatsapp || '').replace(/\D/g, '');
  return html`<section class="section section-alt" id="contacto" aria-labelledby="contact-title">
    <div class="container contact-grid">
      <div>
        <h2 id="contact-title" class="section-title">Contacto</h2>
        <p class="muted">Escribinos para consultas o para pedir una cotización. Respondemos por email o teléfono.</p>
        <ul class="contact-list">
          ${s.contact_email ? html`<li><strong>Email:</strong> <a href="${'mailto:' + s.contact_email}">${s.contact_email}</a></li>` : ''}
          ${s.contact_phone ? html`<li><strong>Teléfono:</strong> <a href="${'tel:' + String(s.contact_phone).replace(/[^\d+]/g, '')}">${s.contact_phone}</a></li>` : ''}
          ${wa ? html`<li><strong>WhatsApp:</strong> <a href="${'https://wa.me/' + wa}" rel="noopener" target="_blank">${s.contact_whatsapp}</a></li>` : ''}
          ${s.contact_address ? html`<li><strong>Dirección:</strong> ${s.contact_address}</li>` : ''}
          ${s.contact_hours ? html`<li><strong>Horario:</strong> ${s.contact_hours}</li>` : ''}
        </ul>
      </div>
      <form class="form card-form" id="inquiry-form" novalidate>
        <h3>Enviar una consulta</h3>
        <fieldset class="radio-row">
          <legend>Tipo</legend>
          <label><input type="radio" name="type" value="consulta" ${prefill.type !== 'cotizacion' ? raw('checked') : ''}> Consulta</label>
          <label><input type="radio" name="type" value="cotizacion" ${prefill.type === 'cotizacion' ? raw('checked') : ''}> Cotización</label>
        </fieldset>
        ${field('inq-name', 'name', 'Nombre y apellido', { autocomplete: 'name', required: true, max: 120 })}
        ${field('inq-email', 'email', 'Email', { type: 'email', autocomplete: 'email', required: true, max: 254 })}
        ${field('inq-phone', 'phone', 'Teléfono (opcional)', { type: 'tel', autocomplete: 'tel', max: 40 })}
        <div class="field">
          <label for="inq-product">Producto (opcional)</label>
          <select id="inq-product" name="productId">
            <option value="">Ninguno en particular</option>
            ${products.map((p) => html`<option value="${p.id}" ${prefill.productId === p.id ? raw('selected') : ''}>${p.name}</option>`)}
          </select>
        </div>
        <div class="field">
          <label for="inq-message">Mensaje <span aria-hidden="true">*</span></label>
          <textarea id="inq-message" name="message" rows="4" maxlength="2000" required aria-describedby="inq-message-err"></textarea>
          <p class="field-error" id="inq-message-err"></p>
        </div>
        ${honeypot()}
        <div class="turnstile-slot"></div>
        <div class="form-msg" role="alert" aria-live="assertive"></div>
        <button type="submit" class="btn btn-primary">Enviar consulta</button>
        <p class="fine-print">Usamos estos datos solo para responder tu consulta.</p>
      </form>
    </div>
  </section>`;
}

export function field(id, name, label, { type = 'text', autocomplete = 'off', required = false, max = 200, value = '' } = {}) {
  return html`<div class="field">
    <label for="${id}">${label}${required ? raw(' <span aria-hidden="true">*</span>') : ''}</label>
    <input id="${id}" name="${name}" type="${type}" autocomplete="${autocomplete}" maxlength="${max}" value="${value}"
      ${required ? raw('required') : ''} aria-describedby="${id + '-err'}">
    <p class="field-error" id="${id + '-err'}"></p>
  </div>`;
}

/** Campo trampa para bots: invisible para personas y lectores de pantalla. */
export function honeypot() {
  return raw('<div class="hp" aria-hidden="true"><label>No completar<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>');
}

export function footer(cfg, s) {
  const year = new Date().getFullYear();
  return html`<div>
      <p class="footer-brand">${cfg.brand.name}</p>
      <p class="muted">${cfg.brand.tagline}</p>
    </div>
    <nav aria-label="Pie de página">
      <ul class="footer-links">
        <li><a href="#/seccion/catalogo">Catálogo</a></li>
        <li><a href="#/seccion/envios">Envíos y pagos</a></li>
        <li><a href="#/seccion/preguntas">Preguntas frecuentes</a></li>
        <li><a href="#/seccion/contacto">Contacto</a></li>
      </ul>
    </nav>
    <div>
      ${s.contact_email ? html`<p><a href="${'mailto:' + s.contact_email}">${s.contact_email}</a></p>` : ''}
      ${s.contact_hours ? html`<p class="muted">${s.contact_hours}</p>` : ''}
    </div>
    <p class="footer-legal">© ${year} ${cfg.brand.name}. Precios en ${cfg.currency}. Los textos legales (términos, privacidad, defensa del consumidor) los debe definir cada negocio.</p>`;
}
