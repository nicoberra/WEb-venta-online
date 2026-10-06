// Pruebas de punta a punta en Chromium, en MODO DEMOSTRACIÓN.
// Ejecutar: node --test tests/e2e/
// Requiere Playwright (npm i -D playwright, o instalado globalmente).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';
import path from 'node:path';
import { startServer } from '../../tools/serve.mjs';

async function loadPlaywright() {
  try { return await import('playwright'); } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return import(path.join(globalRoot, 'playwright', 'index.mjs'));
  }
}

/** PNG válido de 40x30 de un color (para probar la subida de fotos). */
function makePng(w = 40, h = 30, rgb = [40, 120, 90]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PORT = 8765;
const BASE = `http://localhost:${PORT}/`;
let server, browser, pw;

before(async () => {
  server = await startServer(PORT);
  pw = await loadPlaywright();
  browser = await pw.chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function newPage(opts = {}) {
  const context = opts.context || await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  return { page, context };
}

const productCards = (page) => page.locator('#catalog-results .product-card');

test('portada: catálogo desde el CRM simulado, sin datos privados ni errores', async () => {
  const { page, context } = await newPage();
  await page.goto(BASE);
  await page.waitForSelector('#catalog-results .product-card');
  assert.equal(await productCards(page).count(), 9);                     // 10 en el CRM, 1 pausado
  assert.equal(await page.getByText('Bandeja de metal redonda').count(), 0);
  const body = await page.locator('body').innerText();
  for (const s of ['Proveedor ficticio', 'Reponer en 30 días', 'Esperando fotos', '3800']) assert.ok(!body.includes(s), `muestra dato privado: ${s}`);
  assert.ok(await page.getByText('FOTO DE PRODUCTO').count() >= 9);
  assert.equal(await page.locator('img.product-img').count(), 0);
  // sin desplazamiento horizontal en celular
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('búsqueda, filtros por categoría, disponibilidad y orden', async () => {
  const { page, context } = await newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE);
  await page.waitForSelector('#catalog-results .product-card');
  await page.fill('#search-input', 'CERÁMICA'); // sin importar mayúsculas ni tildes
  await page.waitForFunction(() => document.querySelectorAll('#catalog-results .product-card').length === 1);
  await page.fill('#search-input', 'lavanda'); // busca también en variantes
  await page.waitForFunction(() => document.querySelectorAll('#catalog-results .product-card').length === 1);
  await page.fill('#search-input', 'zzz');
  await page.waitForSelector('[data-clear-filters]');
  await page.click('[data-clear-filters]');
  await page.click('#catalog-results .chip[data-category="Textil"]');
  assert.equal(await productCards(page).count(), 2);
  await page.click('#catalog-results .chip[data-category=""]');
  await page.check('#filter-available');
  assert.equal(await productCards(page).count(), 8);                     // sin el florero agotado
  await page.selectOption('#filter-sort', 'price-asc');
  const first = await productCards(page).first().locator('.card-title').innerText();
  assert.equal(first, 'Frasco hermético de vidrio 1 L');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('ficha con variantes, carrito accesible con teclado y límites de stock', async () => {
  const { page, context } = await newPage();
  await page.goto(`${BASE}#/producto/DEMO-001`);
  await page.waitForSelector('h1.product-title');
  assert.equal(await page.locator('h1.product-title').innerText(), 'Taza de cerámica esmaltada');
  assert.ok(await page.getByText('Color: Negro mate').locator('..').getByText('(agotado)').count() >= 0);
  await page.check('input[name="variant"][value="DEMO-001-NE"]');
  await page.waitForSelector('text=Sin stock en esta opción');
  await page.check('input[name="variant"][value="DEMO-001-VE"]');
  await page.fill('#pd-qty', '2');
  await page.dispatchEvent('#pd-qty', 'change');
  await page.click('#add-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#cart-count').textContent === '2');
  // máximo disponible: 8 unidades de Verde oliva
  await page.fill('#pd-qty', '99');
  await page.dispatchEvent('#pd-qty', 'change');
  assert.equal(await page.inputValue('#pd-qty'), '8');
  await page.click('#add-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#cart-count').textContent === '8');

  await page.click('#cart-open');
  await page.waitForSelector('#cart-drawer:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cart-close');
  assert.ok(await page.locator('#cart-drawer [data-cart-step="1"]').isDisabled()); // tope de stock
  await page.keyboard.press('Escape');
  await page.waitForSelector('#cart-drawer', { state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cart-open');  // el foco vuelve

  await page.click('#cart-open');
  await page.click('#cart-drawer [data-cart-remove]');
  await page.waitForSelector('text=Tu carrito está vacío');
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('pedido de prueba: validación, confirmación solo tras guardar, stock descontado y sin duplicados', async () => {
  const { page, context } = await newPage();
  await page.goto(`${BASE}#/producto/DEMO-002`);
  await page.waitForSelector('#add-form');
  await page.click('#add-form button[type=submit]');
  await page.goto(`${BASE}#/checkout`);
  await page.waitForSelector('#checkout-form');
  await page.click('#checkout-submit');
  await page.waitForSelector('#co-name-err:not(:empty)');
  assert.equal(await page.getAttribute('#co-email', 'aria-invalid'), 'true');

  await page.fill('#co-name', 'Cliente de Prueba');
  await page.fill('#co-email', 'cliente@example.com');
  await page.fill('#co-phone', '11 4000-0000');
  await page.check('input[name="delivery"][value="envio"]');
  await page.click('#checkout-submit');
  await page.waitForSelector('#co-address-err:not(:empty)');
  await page.fill('#co-address', 'Calle de Prueba 123');
  await page.waitForTimeout(3100); // el backend rechaza formularios enviados en menos de 3 s
  // doble clic: debe registrarse un solo pedido
  await page.locator('#checkout-submit').dblclick();
  await page.waitForSelector('#order-success');
  assert.match(await page.locator('#order-success').innerText(), /P-000001/);
  assert.equal(await page.locator('#cart-count').innerText(), '0');
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('tienda-demo-crm-v1')));
  assert.equal(db.orders.length, 1);
  assert.equal(db.orders[0].total, 15400);
  assert.equal(db.products.find((p) => p.id === 'DEMO-002').stock, 6);
  assert.deepEqual(page.errors, []);
  await context.close();
});

test('sin conexión al enviar: NO confirma, conserva el carrito y el reintento no duplica', async () => {
  const { page, context } = await newPage();
  await page.goto(`${BASE}?simular=pedido-sin-conexion#/producto/DEMO-004`);
  await page.waitForSelector('#add-form');
  await page.click('#add-form button[type=submit]');
  await page.goto(`${BASE}?simular=pedido-sin-conexion#/checkout`);
  await page.waitForSelector('#checkout-form');
  await page.fill('#co-name', 'Cliente de Prueba');
  await page.fill('#co-email', 'cliente@example.com');
  await page.fill('#co-phone', '11 4000-0000');
  await page.waitForTimeout(3100);
  await page.click('#checkout-submit');
  await page.waitForSelector('#checkout-msg.notice-error');
  assert.match(await page.locator('#checkout-msg').innerText(), /NO fue confirmado/);
  assert.equal(await page.locator('#order-success').count(), 0);
  assert.equal(await page.locator('#cart-count').innerText(), '1');
  const keyBefore = await page.evaluate(() => sessionStorage.getItem('tienda-orden-en-curso-v1'));
  assert.ok(keyBefore);

  // vuelve la conexión: se reintenta con la MISMA clave de pedido
  await page.goto(`${BASE}#/checkout`);
  await page.waitForSelector('#checkout-form');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('tienda-orden-en-curso-v1')), keyBefore);
  await page.fill('#co-name', 'Cliente de Prueba');
  await page.fill('#co-email', 'cliente@example.com');
  await page.fill('#co-phone', '11 4000-0000');
  await page.waitForTimeout(3100);
  await page.click('#checkout-submit');
  await page.waitForSelector('#order-success');
  await context.close();
});

test('catálogo sin conexión: error claro con reintento, o datos guardados con aviso', async () => {
  const { page, context } = await newPage();
  await page.goto(`${BASE}?simular=sin-conexion`);
  await page.waitForSelector('[data-retry]');
  assert.match(await page.locator('.notice-error').innerText(), /No se pudo cargar el catálogo/);
  await page.goto(BASE);
  await page.waitForSelector('#catalog-results .product-card');
  await page.goto(`${BASE}?simular=sin-conexion`);
  await page.waitForSelector('#stale-banner');
  assert.ok(await productCards(page).count() > 0);
  await context.close();
});

test('consulta / cotización desde la tienda', async () => {
  const { page, context } = await newPage();
  await page.goto(`${BASE}#/producto/DEMO-008`);
  await page.click('[data-quote="DEMO-008"]');
  await page.waitForSelector('#inquiry-form');
  assert.equal(await page.inputValue('#inq-product'), 'DEMO-008');
  assert.ok(await page.isChecked('#inquiry-form input[value="cotizacion"]'));
  await page.fill('#inq-name', 'Persona de Prueba');
  await page.fill('#inq-email', 'persona@example.com');
  await page.fill('#inq-message', 'Necesito 20 unidades');
  await page.waitForTimeout(3100);
  await page.click('#inquiry-form button[type=submit]');
  await page.waitForSelector('#inquiry-form .notice-success');
  await context.close();
});

test('panel: login, alta con foto y la tienda la muestra sola; pausar; cancelar pedido devuelve stock; sesión', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page: store } = await newPage({ context });
  const { page: admin } = await newPage({ context });
  await store.goto(BASE);
  await store.waitForSelector('#catalog-results .product-card');

  await admin.goto(`${BASE}admin/`);
  await admin.waitForSelector('#login-form');
  await admin.fill('#lg-user', 'demo');
  await admin.fill('#lg-pass', 'incorrecta');
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('#login-form .notice-error');
  await admin.fill('#lg-pass', 'demo');
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('#product-list .admin-item');
  assert.ok(await admin.evaluate(() => !localStorage.getItem('panel-sesion-v1') && !!sessionStorage.getItem('panel-sesion-v1')));

  await admin.click('#new-product');
  await admin.fill('#pd-name', 'Producto creado en la prueba');
  await admin.fill('#pd-id', 'TEST-1');
  await admin.fill('#pd-cat', 'Cocina');
  await admin.fill('#pd-price', '1234');
  await admin.fill('#pd-cost', '777');
  await admin.fill('#pd-stock', '3');
  await admin.selectOption('#pd-status', 'Publicado');
  await admin.setInputFiles('input[data-upload="main"]', { name: 'foto.png', mimeType: 'image/png', buffer: makePng() });
  await admin.waitForSelector('#pd-msg.notice-success');
  assert.ok(await admin.locator('.photo-main img').count() === 1);  // vista previa
  await admin.click('#pd-save');
  await admin.waitForSelector('#product-dialog[open]', { state: 'detached' });

  // La tienda (otra pestaña, sin recargar) muestra el producto con su foto.
  await store.waitForSelector('#catalog-results .product-card:has-text("Producto creado en la prueba") img.product-img', { timeout: 10000 });
  const storeText = await store.locator('body').innerText();
  assert.ok(!storeText.includes('777'), 'no debe mostrar el costo');

  // Quitar la foto -> vuelve el recuadro "FOTO DE PRODUCTO"; luego pausar -> desaparece
  await admin.click('[data-edit="TEST-1"]');
  await admin.click('[data-remove-img="main:0"]');
  await admin.click('#pd-save');
  await admin.waitForSelector('#product-dialog[open]', { state: 'detached' });
  await store.waitForSelector('#catalog-results .product-card:has-text("Producto creado en la prueba") .photo-ph', { timeout: 10000 });
  await admin.click('[data-edit="TEST-1"]');
  await admin.selectOption('#pd-status', 'Pausado');
  await admin.click('#pd-save');
  await admin.waitForSelector('#product-dialog[open]', { state: 'detached' });
  await store.waitForFunction(() => !document.body.innerText.includes('Producto creado en la prueba'), null, { timeout: 10000 });

  // Pedido desde la tienda y cancelación desde el panel
  await store.goto(`${BASE}#/producto/DEMO-006`);
  await store.waitForSelector('#add-form');
  await store.click('#add-form button[type=submit]');
  await store.goto(`${BASE}#/checkout`);
  await store.waitForSelector('#checkout-form');
  await store.fill('#co-name', 'Cliente de Prueba');
  await store.fill('#co-email', 'otro@example.com');
  await store.fill('#co-phone', '11 4000-0001');
  await store.waitForTimeout(3100);
  await store.click('#checkout-submit');
  await store.waitForSelector('#order-success');
  const stockOf = () => admin.evaluate(() => JSON.parse(localStorage.getItem('tienda-demo-crm-v1')).products.find((p) => p.id === 'DEMO-006').stock);
  assert.equal(await stockOf(), 1);
  await admin.click('[data-tab="pedidos"]');
  await admin.waitForSelector('[data-order]');
  admin.once('dialog', (d) => d.accept());
  await admin.selectOption('[data-order]', 'Cancelado');
  await admin.waitForSelector('#toast:has-text("stock devuelto")');
  assert.equal(await stockOf(), 2);

  await admin.click('[data-tab="facturacion"]');
  await admin.waitForSelector('text=Integración fiscal pendiente');

  // Cerrar sesión borra el token
  await admin.click('#logout-btn');
  await admin.waitForSelector('#login-form');
  assert.equal(await admin.evaluate(() => sessionStorage.getItem('panel-sesion-v1')), null);
  assert.deepEqual(store.errors, []);
  assert.deepEqual(admin.errors, []);
  await context.close();
});

test('navegación con teclado: enlace para saltar al contenido', async () => {
  const { page, context } = await newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE);
  await page.waitForSelector('#catalog-results .product-card');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  await context.close();
});
