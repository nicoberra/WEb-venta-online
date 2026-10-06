import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCart, priceCart } from '../../assets/js/lib/cart.js';
import { parseFaq, normalize } from '../../assets/js/lib/format.js';
import { esc, html } from '../../assets/js/lib/dom.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const catalog = {
  products: [
    { id: 'A', name: 'A', price: 100, available: true, maxQty: 3, variants: [] },
    { id: 'B', name: 'B', price: 50, available: true, maxQty: null, variants: [
      { id: 'B1', name: 'Rojo', price: 60, available: true, maxQty: 2 },
      { id: 'B2', name: 'Azul', price: 50, available: false, maxQty: 0 }
    ] }
  ]
};

test('carrito: suma, respeta máximos, persiste y calcula con precios del catálogo', () => {
  const s = memory();
  const cart = createCart(s);
  cart.add('A', '', 2, 3);
  cart.add('A', '', 5, 3);
  cart.add('B', 'B1', 1, 2);
  assert.equal(cart.count(), 4);
  const again = createCart(s);
  assert.equal(again.count(), 4);
  const priced = priceCart(again.items, catalog);
  assert.equal(priced.subtotal, 3 * 100 + 60);
  assert.equal(priced.problems.length, 0);
  again.setQty('A', '', 0);
  assert.equal(again.count(), 1);
});

test('carrito: detecta productos borrados, variantes agotadas y exceso de stock', () => {
  const items = [{ productId: 'X', variantId: '', qty: 1 }, { productId: 'B', variantId: 'B2', qty: 1 }, { productId: 'A', variantId: '', qty: 9 }];
  const priced = priceCart(items, catalog);
  assert.equal(priced.problems.length, 3);
  assert.equal(priced.subtotal, 0);
});

test('carrito: datos corruptos en el almacenamiento no rompen la tienda', () => {
  const s = memory();
  s.setItem('tienda-carrito-v1', '{roto');
  assert.equal(createCart(s).count(), 0);
  s.setItem('tienda-carrito-v1', JSON.stringify([{ productId: 'A', qty: -3 }, { productId: 'A', qty: 1.5 }, null]));
  assert.equal(createCart(s).count(), 0);
});

test('plantillas escapan HTML del CRM y FAQ se interpreta por líneas', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(String(html`<p>${'<b>"x"</b>'}</p>`), '<p>&lt;b&gt;&quot;x&quot;&lt;/b&gt;</p>');
  assert.deepEqual(parseFaq('¿A? | B\nsin separador\n¿C?|D'), [{ q: '¿A?', a: 'B' }, { q: '¿C?', a: 'D' }]);
  assert.equal(normalize(' CERÁMICA '), 'ceramica');
});
