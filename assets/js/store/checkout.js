// Finalizar pedido y formulario de consultas.
// Regla principal: la tienda SOLO confirma un pedido cuando el backend
// respondió que lo guardó. Ante un error de red, se informa que no hubo
// confirmación y se permite reintentar con la MISMA clave (no se duplica).
import { html, raw, $, $$, setHtml, uuid, announce } from '../lib/dom.js';
import { priceCart } from '../lib/cart.js';
import { ApiError, NetworkError } from '../lib/api.js';
import * as T from './templates.js';

const KEY_STORE = 'tienda-orden-en-curso-v1';

function session() {
  try { return window.sessionStorage; } catch { return null; }
}

/** Clave de idempotencia ligada al contenido del carrito. */
function orderKeyFor(signature) {
  const s = session();
  let saved = null;
  try { saved = JSON.parse(s?.getItem(KEY_STORE) || 'null'); } catch { saved = null; }
  if (saved && saved.sig === signature) return saved.key;
  const key = uuid();
  try { s?.setItem(KEY_STORE, JSON.stringify({ key, sig: signature })); } catch { /* sin sessionStorage */ }
  return key;
}

function clearOrderKey() {
  try { session()?.removeItem(KEY_STORE); } catch { /* nada */ }
}

function shippingFor(method, settings) {
  if (method !== 'envio') return { cost: 0, label: 'Sin cargo' };
  const flat = Number(String(settings.shipping_flat_cost || '').replace(',', '.')) || 0;
  return flat > 0 ? { cost: flat, label: null } : { cost: 0, label: 'A coordinar' };
}

function deliveryMethod() {
  return $('#checkout-form input[name="delivery"]:checked')?.value || 'retiro';
}

function summaryHtml(ctx) {
  const { state, cart, fmt } = ctx;
  const priced = priceCart(cart.items, state.catalog);
  const ship = shippingFor(deliveryMethod(), ctx.settings());
  const total = priced.subtotal + ship.cost;
  return html`<h2 class="h3">Resumen</h2>
    <ul class="summary-lines">
      ${priced.lines.map((l) => html`<li class="${l.issue ? 'has-issue' : ''}">
        <span>${l.qty} × ${l.name}${l.variantName ? html` <span class="muted">(${l.variantName})</span>` : ''}
          ${l.issue ? html`<span class="line-issue">${T.icon.alert} ${l.issue}</span>` : ''}</span>
        <span>${l.issue ? '—' : fmt.money(l.lineTotal)}</span>
      </li>`)}
    </ul>
    <div class="sum-row"><span>Subtotal</span><span>${fmt.money(priced.subtotal)}</span></div>
    <div class="sum-row"><span>Envío</span><span>${ship.label || fmt.money(ship.cost)}</span></div>
    <div class="sum-row sum-total"><span>Total</span><strong>${fmt.money(total)}</strong></div>
    ${priced.problems.length ? html`<p class="notice notice-warn">Hay productos sin stock suficiente. <button type="button" class="link-btn" id="checkout-open-cart">Ajustar carrito</button></p>` : ''}`;
}

export function renderCheckoutSummary(ctx) {
  const box = $('#checkout-summary');
  if (box) setHtml(box, summaryHtml(ctx));
}

export function renderCheckout(ctx) {
  const { state, cart, CFG, fmt } = ctx;
  if (state.orderResult) return successView(ctx, state.orderResult);
  if (!cart.items.length) {
    return html`<div class="container section empty-state">
      <h1>Tu carrito está vacío</h1>
      <a class="btn btn-primary" href="#/seccion/catalogo">Ver catálogo</a>
    </div>`;
  }
  const isDemo = state.api?.mode === 'demo';
  return html`<div class="container section checkout">
    <a class="back-link" href="#/seccion/catalogo">${T.icon.back} Seguir comprando</a>
    <h1>Finalizar pedido</h1>
    <div class="notice notice-info">
      ${isDemo ? html`<p><strong>Pedido de prueba (modo demostración).</strong> No se cobra, no se envía y no se guarda en ninguna planilla real.</p>`
        : html`<p><strong>No se cobra en línea.</strong> Al enviar el pedido, el negocio lo recibe y se contacta para coordinar pago y entrega.</p>`}
    </div>
    <div class="checkout-layout">
      <form id="checkout-form" class="form" novalidate>
        <fieldset>
          <legend class="h3">Tus datos</legend>
          ${T.field('co-name', 'name', 'Nombre y apellido', { autocomplete: 'name', required: true, max: 120 })}
          ${T.field('co-email', 'email', 'Email', { type: 'email', autocomplete: 'email', required: true, max: 254 })}
          ${T.field('co-phone', 'phone', 'Teléfono', { type: 'tel', autocomplete: 'tel', required: true, max: 40 })}
        </fieldset>
        <fieldset>
          <legend class="h3">Entrega</legend>
          <div class="radio-cards" id="co-delivery">
            ${CFG.checkout.deliveryMethods.map((m, i) => html`<label class="radio-card">
              <input type="radio" name="delivery" value="${m.id}" ${i === 0 ? raw('checked') : ''}>
              <span>${m.label}</span>
            </label>`)}
          </div>
          <p class="field-error" id="co-delivery-err"></p>
          <div class="field" id="address-field" hidden>
            <label for="co-address">Dirección de envío <span aria-hidden="true">*</span></label>
            <input id="co-address" name="address" type="text" autocomplete="street-address" maxlength="300" aria-describedby="co-address-err">
            <p class="field-error" id="co-address-err"></p>
          </div>
          <div class="field">
            <label for="co-notes">Notas (opcional)</label>
            <textarea id="co-notes" name="notes" rows="3" maxlength="500"></textarea>
          </div>
        </fieldset>
        ${T.honeypot()}
        <div class="turnstile-slot"></div>
        <div class="form-msg" id="checkout-msg" role="alert" aria-live="assertive"></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block" id="checkout-submit">${isDemo ? 'Enviar pedido de prueba' : 'Enviar pedido'}</button>
        <p class="fine-print">Al enviar aceptás que usemos estos datos para gestionar tu pedido.</p>
      </form>
      <aside class="checkout-summary card-form" id="checkout-summary" aria-label="Resumen del pedido">${summaryHtml(ctx)}</aside>
    </div>
  </div>`;
}

function successView(ctx, r) {
  const { fmt, state } = ctx;
  return html`<div class="container section narrow">
    <div class="success" tabindex="-1" id="order-success">
      <span class="success-icon">${T.icon.check}</span>
      <h1>${state.api?.mode === 'demo' ? '¡Pedido de prueba registrado!' : '¡Recibimos tu pedido!'}</h1>
      <p>Número de pedido: <strong>${r.orderId}</strong></p>
      <p>Total: <strong>${fmt.money(r.total)}</strong>${r.shipping === 0 && r.delivery === 'envio' ? ' (envío a coordinar)' : ''}</p>
      ${r.items?.length ? html`<ul class="summary-lines">${r.items.map((l) => html`<li><span>${l.qty} × ${l.name}${l.variantName ? ` (${l.variantName})` : ''}</span><span>${fmt.money(l.lineTotal)}</span></li>`)}</ul>` : ''}
      <p class="muted">${state.api?.mode === 'demo' ? 'En modo demostración el pedido queda guardado solo en este navegador y se puede ver en el panel de demostración.' : 'Te vamos a contactar para coordinar el pago y la entrega. Guardá el número de pedido.'}</p>
      <a class="btn btn-primary" href="#/">Volver a la tienda</a>
    </div>
  </div>`;
}

function showFieldErrors(form, prefix, fields = {}) {
  $$('.field-error', form.closest('.checkout, .contact-grid') || form).forEach((el) => { el.textContent = ''; });
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  let first = null;
  Object.entries(fields).forEach(([name, msg]) => {
    const err = document.getElementById(`${prefix}-${name}-err`);
    const input = document.getElementById(`${prefix}-${name}`) || form.querySelector(`[name="${name}"]`);
    if (err) err.textContent = msg;
    if (input) { input.setAttribute('aria-invalid', 'true'); first = first || input; }
  });
  first?.focus();
}

function clientValidate(data, { requirePhone = true, requireMessage = false } = {}) {
  const f = {};
  if (String(data.name || '').trim().length < 2) f.name = 'Ingresá tu nombre.';
  if (!/^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(String(data.email || '').trim())) f.email = 'Ingresá un email válido.';
  const digits = String(data.phone || '').replace(/\D/g, '');
  if ((requirePhone || data.phone) && (digits.length < 6 || digits.length > 20)) f.phone = 'Ingresá un teléfono válido.';
  if (requireMessage && String(data.message || '').trim().length < 5) f.message = 'Escribí tu consulta.';
  return f;
}

function setMessage(el, kind, text) {
  el.className = `form-msg notice notice-${kind}`;
  el.textContent = text;
}

function friendlyError(err, { order = false } = {}) {
  if (err instanceof NetworkError) {
    return order
      ? `${err.message} Tu pedido NO fue confirmado. Podés reintentar: si ya se había registrado, no se va a duplicar.`
      : `${err.message} Tu consulta no se envió. Intentá de nuevo.`;
  }
  if (err instanceof ApiError) {
    if (err.code === 'INTERNAL' || err.code === 'BAD_RESPONSE') {
      return order ? `${err.message} El pedido NO fue confirmado.` : err.message;
    }
    return err.message;
  }
  return 'Ocurrió un error inesperado. El pedido NO fue confirmado.';
}

/* ------------------------------ Turnstile (opcional) ----------------------- */
let turnstileLoading;
function mountTurnstile(form, siteKey) {
  if (!siteKey) return;
  const slot = form.querySelector('.turnstile-slot');
  if (!slot) return;
  turnstileLoading = turnstileLoading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
  turnstileLoading.then(() => window.turnstile?.render(slot, { sitekey: siteKey })).catch(() => {
    slot.textContent = 'No se pudo cargar la verificación anti-spam.';
  });
}
const captchaToken = (form) => form.querySelector('[name="cf-turnstile-response"]')?.value || '';

/* --------------------------------- Pedido ---------------------------------- */
export function bindCheckout(ctx) {
  const form = $('#checkout-form');
  if (!form) {
    $('#order-success')?.focus();
    return;
  }
  const startedAt = Date.now();
  const msg = $('#checkout-msg');
  const submit = $('#checkout-submit');
  const addressField = $('#address-field');
  mountTurnstile(form, ctx.CFG.turnstileSiteKey);

  form.addEventListener('change', (e) => {
    if (e.target.name === 'delivery') {
      addressField.hidden = e.target.value !== 'envio';
      renderCheckoutSummary(ctx);
    }
  });
  $('#checkout-summary').addEventListener('click', (e) => {
    if (e.target.id === 'checkout-open-cart') $('#cart-open').click();
  });

  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return; // evita doble envío por doble clic
    const { state, cart } = ctx;
    const fd = Object.fromEntries(new FormData(form).entries());
    const errors = clientValidate(fd);
    if (fd.delivery === 'envio' && String(fd.address || '').trim().length < 5) errors.address = 'Ingresá la dirección de envío.';
    showFieldErrors(form, 'co', errors);
    if (Object.keys(errors).length) { setMessage(msg, 'error', 'Revisá los campos marcados.'); return; }

    const priced = priceCart(cart.items, state.catalog);
    if (!priced.lines.length) { setMessage(msg, 'error', 'Tu carrito está vacío.'); return; }
    if (priced.problems.length) { setMessage(msg, 'error', 'Hay productos sin stock suficiente. Ajustá el carrito.'); return; }
    const ship = shippingFor(fd.delivery, ctx.settings());

    sending = true;
    submit.disabled = true;
    submit.textContent = 'Enviando pedido…';
    form.setAttribute('aria-busy', 'true');
    setMessage(msg, 'info', 'Enviando tu pedido. No cierres esta página.');
    const orderKey = orderKeyFor(cart.signature());
    try {
      const result = await state.api.post('createOrder', {
        orderKey,
        startedAt,
        website: fd.website || '',
        captchaToken: captchaToken(form),
        customer: { name: fd.name, email: fd.email, phone: fd.phone, notes: fd.notes || '' },
        delivery: { method: fd.delivery, address: fd.delivery === 'envio' ? fd.address : '' },
        items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })),
        expectedTotal: priced.subtotal + ship.cost
      });
      // Confirmado por el backend: recién ahora se vacía el carrito.
      state.orderResult = { ...result, delivery: fd.delivery };
      clearOrderKey();
      cart.clear();
      ctx.refreshCatalog({ silent: true });
      announce(`Pedido ${result.orderId} registrado.`);
      setHtml($('#main'), renderCheckout(ctx));
      $('#order-success')?.focus();
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION' && err.details?.fields) {
        showFieldErrors(form, 'co', err.details.fields);
      }
      if (err instanceof ApiError && (err.code === 'STOCK' || err.code === 'PRICE_CHANGED')) {
        await ctx.refreshCatalog({ silent: true });
        renderCheckoutSummary(ctx);
      }
      setMessage(msg, 'error', friendlyError(err, { order: true }));
      if (window.turnstile) try { window.turnstile.reset(); } catch { /* nada */ }
    } finally {
      sending = false;
      if (document.body.contains(submit)) {
        submit.disabled = false;
        submit.textContent = state.api?.mode === 'demo' ? 'Enviar pedido de prueba' : 'Enviar pedido';
        form.removeAttribute('aria-busy');
      }
    }
  });
}

/* ------------------------------- Consultas -------------------------------- */
export function bindInquiryForm(ctx) {
  const form = $('#inquiry-form');
  if (!form) return;
  const startedAt = Date.now();
  const msg = form.querySelector('.form-msg');
  const submit = form.querySelector('button[type="submit"]');
  mountTurnstile(form, ctx.CFG.turnstileSiteKey);
  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const fd = Object.fromEntries(new FormData(form).entries());
    const errors = clientValidate(fd, { requirePhone: false, requireMessage: true });
    showFieldErrors(form, 'inq', errors);
    if (Object.keys(errors).length) { setMessage(msg, 'error', 'Revisá los campos marcados.'); return; }
    sending = true;
    submit.disabled = true;
    submit.textContent = 'Enviando…';
    try {
      await ctx.state.api.post('createInquiry', { ...fd, startedAt, captchaToken: captchaToken(form) });
      form.reset();
      ctx.state.inquiryPrefill = {};
      setMessage(msg, 'success', ctx.state.api.mode === 'demo'
        ? 'Consulta de prueba registrada (modo demostración). Podés verla en el panel de demostración.'
        : '¡Gracias! Recibimos tu consulta y te vamos a responder a la brevedad.');
    } catch (err) {
      if (err instanceof ApiError && err.details?.fields) showFieldErrors(form, 'inq', err.details.fields);
      setMessage(msg, 'error', friendlyError(err));
    } finally {
      sending = false;
      submit.disabled = false;
      submit.textContent = 'Enviar consulta';
    }
  });
}
