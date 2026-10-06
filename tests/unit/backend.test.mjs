import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGasContext, baseTabs } from './gas-mock.mjs';

const key = () => crypto.randomUUID();
const customer = { name: 'Ana Prueba', email: 'ana@example.com', phone: '11 5555-0000' };

function setup(opts) {
  const g = createGasContext(baseTabs(), opts);
  g.ctx.setAdminUser_('admin', 'una-clave-larga-de-prueba');
  return g;
}
function order(g, items, extra = {}) {
  return g.post({
    action: 'createOrder', orderKey: extra.orderKey || key(), startedAt: g.clock.now - 10000,
    customer: extra.customer || customer, delivery: extra.delivery || { method: 'retiro' }, items, ...extra.body
  });
}
function login(g) {
  const r = g.post({ action: 'adminLogin', username: 'admin', password: 'una-clave-larga-de-prueba' });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data.token;
}
const stockOf = (g, sheet, id) => {
  const o = g.sheet(sheet).objects().find((r) => r.ID === id || r['ID variante'] === id);
  return o.Stock;
};

test('catálogo público: solo publicados/agotados, sin costos ni notas internas', () => {
  const g = setup();
  const r = g.get({ action: 'catalog' });
  assert.equal(r.ok, true);
  const ids = r.data.products.map((p) => p.id);
  assert.deepEqual(ids, ['P1', 'P2', 'P4', 'P5']);
  const raw = JSON.stringify(r.data);
  for (const forbidden of ['600', 'proveedor X', 'Costo', '"cost"', 'internalNotes', 'formula-propia', 'secreto', 'clave_privada']) {
    assert.ok(!raw.includes(forbidden), `el catálogo expone "${forbidden}"`);
  }
  const p2 = r.data.products.find((p) => p.id === 'P2');
  assert.equal(p2.price, 25000);           // texto "25.000" interpretado como número
  assert.equal(p2.priceMax, 27000);        // variante con precio propio
  assert.equal(p2.variants.length, 2);     // la variante inactiva no se publica
  assert.equal(p2.images.length, 2);       // drive + https; http:// se descarta
  assert.match(p2.images[0].url, /^https:\/\/drive\.google\.com\/thumbnail\?id=abcdefghijklmnopqrstuvwxyz/);
  assert.equal(r.data.products.find((p) => p.id === 'P4').available, false); // stock 0
  assert.equal(r.data.products.find((p) => p.id === 'P5').available, false); // estado Agotado
  assert.equal(r.data.products.find((p) => p.id === 'P1').images.length, 0); // sin foto -> la tienda muestra "FOTO DE PRODUCTO"
  assert.equal(r.data.settings.hero_title, 'Hola');
});

test('columnas en otro orden y con otros acentos/mayúsculas siguen funcionando', () => {
  const tabs = baseTabs();
  tabs.Productos = [
    ['estado', 'PRECIO', 'nombre', 'id', 'Stock'],
    ['publicado', 100, 'Cosa', 'X1', 3]
  ];
  const g = createGasContext(tabs);
  const r = g.get({ action: 'catalog' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.products[0].name, 'Cosa');
});

test('falta una columna obligatoria: error claro de configuración', () => {
  const tabs = baseTabs();
  tabs.Productos = [['ID', 'Nombre', 'Estado'], ['X', 'Y', 'Publicado']];
  const g = createGasContext(tabs);
  const r = g.get({ action: 'catalog' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CONFIG');
  assert.match(r.error.message, /Precio/);
});

test('pedido válido: recalcula precios en el servidor, descuenta stock y registra cliente', () => {
  const g = setup();
  const r = order(g, [{ productId: 'P1', qty: 2 }, { productId: 'P2', variantId: 'P2-VE', qty: 1 }], { delivery: { method: 'envio', address: 'Calle Falsa 123' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.subtotal, 1500 * 2 + 27000);
  assert.equal(r.data.shipping, 1000);
  assert.equal(r.data.total, 31000);
  assert.equal(stockOf(g, 'Productos', 'P1'), 3);
  assert.equal(stockOf(g, 'Variantes', 'P2-VE'), 0);
  const o = g.sheet('Pedidos').objects()[0];
  assert.equal(o['Estado'], 'Nuevo');
  assert.equal(o['Stock descontado'], 'SI');
  assert.equal(g.sheet('Clientes').objects().length, 1);
  // La columna propia del CRM con fórmula no se tocó
  assert.equal(g.sheet('Productos').data[1][14], '=formula-propia');
});

test('el precio que manda el navegador no se usa; si no coincide se rechaza', () => {
  const g = setup();
  const r = order(g, [{ productId: 'P1', qty: 1, price: 1 }], { body: { expectedTotal: 1 } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'PRICE_CHANGED');
  assert.equal(r.error.details.total, 1500);
  assert.equal(stockOf(g, 'Productos', 'P1'), 5);
  assert.equal(g.sheet('Pedidos').objects().length, 0);
});

test('mismo pedido enviado dos veces: un solo registro y el stock baja una sola vez', () => {
  const g = setup();
  const k = key();
  const a = order(g, [{ productId: 'P1', qty: 2 }], { orderKey: k });
  const b = order(g, [{ productId: 'P1', qty: 2 }], { orderKey: k });
  g.cache.clear(); // aunque se pierda la caché, la planilla evita el duplicado
  const c = order(g, [{ productId: 'P1', qty: 2 }], { orderKey: k });
  assert.equal(a.ok && b.ok && c.ok, true);
  assert.equal(a.data.orderId, b.data.orderId);
  assert.equal(a.data.orderId, c.data.orderId);
  assert.equal(b.data.duplicate, true);
  assert.equal(g.sheet('Pedidos').objects().length, 1);
  assert.equal(stockOf(g, 'Productos', 'P1'), 3);
});

test('pedidos simultáneos no venden más que el stock', () => {
  const g = setup();
  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(order(g, [{ productId: 'P1', qty: 2 }], { customer: { ...customer, email: `c${i}@example.com`, phone: `11 5555-000${i}` } }));
  }
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(results.filter((r) => !r.ok && r.error.code === 'STOCK').length, 2);
  assert.equal(stockOf(g, 'Productos', 'P1'), 1);
});

test('si otra ejecución tiene el lock, se responde BUSY sin escribir', () => {
  const g = setup();
  g.holdLock(true);
  const r = order(g, [{ productId: 'P1', qty: 1 }]);
  assert.equal(r.error.code, 'BUSY');
  g.holdLock(false);
  assert.equal(g.sheet('Pedidos').objects().length, 0);
});

test('validaciones: producto pausado, agotado, variante faltante, cantidades inválidas, sin datos', () => {
  const g = setup();
  assert.equal(order(g, [{ productId: 'P3', qty: 1 }]).error.code, 'STOCK');
  assert.equal(order(g, [{ productId: 'P4', qty: 1 }]).error.code, 'STOCK');
  assert.equal(order(g, [{ productId: 'P5', qty: 1 }]).error.code, 'STOCK');
  assert.equal(order(g, [{ productId: 'P2', qty: 1 }]).error.code, 'STOCK');               // falta variante
  assert.equal(order(g, [{ productId: 'P2', variantId: 'P2-RO', qty: 1 }]).error.code, 'STOCK'); // inactiva
  assert.equal(order(g, [{ productId: 'NOPE', qty: 1 }]).error.code, 'STOCK');
  assert.equal(order(g, [{ productId: 'P1', qty: 0 }]).error.code, 'VALIDATION');
  assert.equal(order(g, [{ productId: 'P1', qty: 1.5 }]).error.code, 'VALIDATION');
  assert.equal(order(g, [{ productId: 'P1', qty: 999 }]).error.code, 'VALIDATION');
  assert.equal(order(g, []).error.code, 'VALIDATION');
  const bad = order(g, [{ productId: 'P1', qty: 1 }], { customer: { name: 'A', email: 'x', phone: '1' } });
  assert.deepEqual(Object.keys(bad.error.details.fields).sort(), ['email', 'name', 'phone']);
  assert.equal(order(g, [{ productId: 'P1', qty: 1 }], { delivery: { method: 'envio' } }).error.code, 'VALIDATION');
  assert.equal(stockOf(g, 'Productos', 'P1'), 5);
  assert.equal(g.sheet('Pedidos').objects().length, 0);
});

test('anti-abuso: honeypot, envío demasiado rápido y límite por contacto', () => {
  const g = setup();
  assert.equal(order(g, [{ productId: 'P1', qty: 1 }], { body: { website: 'bot' } }).error.code, 'REJECTED');
  assert.equal(order(g, [{ productId: 'P1', qty: 1 }], { body: { startedAt: g.clock.now } }).error.code, 'REJECTED');
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push(order(g, [{ productId: 'P1', qty: 1 }]).ok ? 'ok' : 'x');
  assert.deepEqual(codes, ['ok', 'ok', 'ok', 'x']);
});

test('textos que parecen fórmulas se guardan como texto literal', () => {
  const g = setup();
  const r = order(g, [{ productId: 'P1', qty: 1 }], { customer: { ...customer, name: '=HYPERLINK("http://malo")', notes: '+cmd' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!g.sheet('Pedidos').formulaInjected);
  assert.equal(g.sheet('Pedidos').objects()[0].Cliente, '=HYPERLINK("http://malo")');
});

test('consultas: valida campos y no devuelve datos del CRM', () => {
  const g = setup();
  const bad = g.post({ action: 'createInquiry', startedAt: g.clock.now - 9000, name: '', email: 'no', message: '' });
  assert.equal(bad.error.code, 'VALIDATION');
  const ok = g.post({ action: 'createInquiry', type: 'cotizacion', startedAt: g.clock.now - 9000, name: 'Leo', email: 'leo@example.com', message: 'Precio por 20 unidades', productId: 'P1' });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.data), ['id']);
  assert.equal(g.sheet('Cotizaciones').objects()[0].Tipo, 'Cotización');
});

test('acciones privadas sin sesión o con GET están bloqueadas', () => {
  const g = setup();
  assert.equal(g.post({ action: 'adminListOrders' }).error.code, 'AUTH_REQUIRED');
  assert.equal(g.post({ action: 'adminListOrders', token: 'a'.repeat(64) }).error.code, 'AUTH_REQUIRED');
  assert.equal(g.get({ action: 'adminListOrders' }).error.code, 'NOT_FOUND');
  assert.equal(g.get({ action: 'catalog', callback: 'x' }).ok, true); // no hay JSONP: el callback se ignora
});

test('login: contraseña incorrecta, bloqueo por intentos, la contraseña no se guarda en claro', () => {
  const g = setup();
  assert.ok(!g.props.get('ADMIN_USERS').includes('una-clave-larga-de-prueba'));
  for (let i = 0; i < 5; i++) assert.equal(g.post({ action: 'adminLogin', username: 'admin', password: 'mala' }).error.code, 'AUTH');
  assert.equal(g.post({ action: 'adminLogin', username: 'admin', password: 'una-clave-larga-de-prueba' }).error.code, 'LOCKED');
  g.advance(16 * 60000);
  assert.equal(g.post({ action: 'adminLogin', username: 'admin', password: 'una-clave-larga-de-prueba' }).ok, true);
  assert.equal(g.post({ action: 'adminLogin', username: 'nadie', password: 'x' }).error.code, 'AUTH');
});

test('sesión: vence por inactividad, por máximo absoluto, al cerrar sesión y al cerrar todas', () => {
  const g = setup();
  let t = login(g);
  assert.equal(g.post({ action: 'adminSession', token: t }).ok, true);
  g.advance(121 * 60000);
  assert.equal(g.post({ action: 'adminSession', token: t }).error.code, 'AUTH_REQUIRED');

  t = login(g);
  for (let i = 0; i < 7; i++) { g.advance(60 * 60000); if (i < 5) assert.equal(g.post({ action: 'adminSession', token: t }).ok, true, 'hora ' + i); }
  assert.equal(g.post({ action: 'adminSession', token: t }).error.code, 'AUTH_REQUIRED');

  t = login(g);
  g.post({ action: 'adminLogout', token: t });
  assert.equal(g.post({ action: 'adminSession', token: t }).error.code, 'AUTH_REQUIRED');

  const t1 = login(g); const t2 = login(g);
  assert.equal(g.post({ action: 'adminLogoutAll', token: t1 }).ok, true);
  assert.equal(g.post({ action: 'adminSession', token: t2 }).error.code, 'AUTH_REQUIRED');
});

test('panel: crear, editar con variantes, subir/quitar foto y borrar producto', () => {
  const g = setup({ configure: "CONFIG.IMAGE_STORAGE.drive.folderId = 'FOLDER1';" });
  const token = login(g);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString('base64');
  const up = g.post({ action: 'adminUploadImage', token, productId: 'N1', mimeType: 'image/png', dataBase64: png });
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.match(up.data.ref, /^drive:file/);
  const fid = up.data.ref.slice(6);
  assert.equal(g.files.get(fid).shared, 'link');

  const fake = g.post({ action: 'adminUploadImage', token, mimeType: 'image/png', dataBase64: Buffer.from('<svg>no soy png</svg>').toString('base64') });
  assert.equal(fake.error.code, 'VALIDATION');

  const created = g.post({ action: 'adminSaveProduct', token, product: {
    isNew: true, id: 'N1', name: 'Nuevo', price: 100, cost: 40, stock: '', status: 'Publicado', category: 'Nueva',
    image: up.data.ref, gallery: [], variants: [{ name: 'Talle S', stock: 3 }, { name: 'Talle M', stock: 0, price: 120 }]
  } });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.data.product.variants.length, 2);
  let pub = g.get({ action: 'catalog' }).data.products.find((p) => p.id === 'N1');
  assert.equal(pub.images[0].url.includes(fid), true); // la foto aparece en la tienda
  assert.equal(pub.price, 100);
  assert.equal(pub.priceMax, 120);

  const dup = g.post({ action: 'adminSaveProduct', token, product: { isNew: true, id: 'N1', name: 'Otro', price: 1, status: 'Publicado' } });
  assert.equal(dup.error.code, 'VALIDATION');

  const v = created.data.product.variants;
  const edited = g.post({ action: 'adminSaveProduct', token, product: {
    ...created.data.product, image: '', gallery: [], status: 'Pausado', variants: [{ ...v[0], stock: 7 }]
  } });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.equal(edited.data.product.variants.length, 1);
  assert.equal(g.files.get(fid).trashed, true); // la foto quitada fue a la papelera
  pub = g.get({ action: 'catalog' }).data.products.find((p) => p.id === 'N1');
  assert.equal(pub, undefined); // pausado -> no se publica

  assert.equal(g.post({ action: 'adminDeleteProduct', token, id: 'N1' }).ok, true);
  assert.equal(g.sheet('Variantes').objects().filter((r) => r['ID producto'] === 'N1').length, 0);
  assert.equal(g.post({ action: 'adminSaveProduct', token, product: { name: 'X', price: -1, status: 'Publicado' } }).error.code, 'VALIDATION');
  assert.equal(g.post({ action: 'adminSaveProduct', token, product: { name: 'X', price: 1, status: 'Publicado', image: 'javascript:alert(1)' } }).error.code, 'VALIDATION');
});

test('cancelar un pedido devuelve el stock una sola vez y no se puede reabrir', () => {
  const g = setup();
  const token = login(g);
  const r = order(g, [{ productId: 'P1', qty: 3 }]);
  assert.equal(stockOf(g, 'Productos', 'P1'), 2);
  const id = r.data.orderId;
  assert.equal(g.post({ action: 'adminUpdateOrderStatus', token, orderId: id, status: 'Cancelado' }).ok, true);
  assert.equal(stockOf(g, 'Productos', 'P1'), 5);
  g.post({ action: 'adminUpdateOrderStatus', token, orderId: id, status: 'Cancelado' });
  assert.equal(stockOf(g, 'Productos', 'P1'), 5);
  assert.equal(g.post({ action: 'adminUpdateOrderStatus', token, orderId: id, status: 'Nuevo' }).error.code, 'VALIDATION');
});

test('facturación: registro interno único por pedido, marcado como pendiente fiscal', () => {
  const g = setup();
  const token = login(g);
  const id = order(g, [{ productId: 'P1', qty: 1 }]).data.orderId;
  const a = g.post({ action: 'adminRegisterSale', token, orderId: id });
  const b = g.post({ action: 'adminRegisterSale', token, orderId: id });
  assert.equal(a.data.duplicate, false);
  assert.equal(b.data.duplicate, true);
  assert.match(a.data.fiscalStatus, /Pendiente/);
  assert.equal(g.sheet('Facturación').objects().length, 1);
});

test('ajustes de tienda: solo claves públicas permitidas', () => {
  const g = setup();
  const token = login(g);
  const r = g.post({ action: 'adminSaveSettings', token, values: { hero_title: 'Nuevo título', clave_privada: 'pisar', otra: 'x' } });
  assert.equal(r.ok, true);
  const rows = g.sheet('Tienda').objects();
  assert.equal(rows.find((x) => x.Clave === 'hero_title').Valor, 'Nuevo título');
  assert.equal(rows.find((x) => x.Clave === 'clave_privada').Valor, 'secreto');
  assert.equal(rows.find((x) => x.Clave === 'otra'), undefined);
  assert.equal(g.get({ action: 'catalog' }).data.settings.hero_title, 'Nuevo título'); // caché invalidada
});

test('solicitudes inválidas o enormes se rechazan', () => {
  const g = setup();
  assert.equal(g.post('no-json').error.code, 'VALIDATION');
  assert.equal(g.post({ action: 'createOrder', pad: 'x'.repeat(30000) }).error.code, 'TOO_LARGE');
  assert.equal(g.post({ action: 'borrarTodo' }).error.code, 'NOT_FOUND');
});
