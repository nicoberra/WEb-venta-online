/**
 * Catálogo: lee Productos + Variantes y arma la versión PÚBLICA.
 * La tienda nunca recibe costo, notas internas ni columnas no mapeadas.
 */

var CATALOG_CACHE_KEY = 'catalog:v1';

function productStatus_(raw) {
  var k = normKey_(raw);
  var st = CONFIG.PRODUCT_STATUS;
  if (st.published.indexOf(k) >= 0) return 'published';
  if (st.soldOut.indexOf(k) >= 0) return 'soldout';
  return 'paused'; // ante la duda, no se publica
}

function stockValue_(raw) {
  if (raw === '' || raw === null || raw === undefined) {
    return CONFIG.EMPTY_STOCK_IS_UNLIMITED ? Infinity : 0;
  }
  var n = num_(raw, 0);
  return Math.max(0, Math.floor(n));
}

function splitRefs_(raw) {
  return String(raw || '').split(/[\n|;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

/** Convierte la referencia guardada en la planilla en una URL pública. */
function resolveImageUrl_(ref) {
  ref = String(ref || '').trim();
  if (!ref) return null;
  var drive = CONFIG.IMAGE_STORAGE.drive;
  var gh = CONFIG.IMAGE_STORAGE.github;
  var m;
  if (ref.indexOf('drive:') === 0) return drive.publicUrlTemplate.replace('{id}', encodeURIComponent(ref.slice(6)));
  if (ref.indexOf('github:') === 0) {
    return gh.publicUrlTemplate
      .replace('{owner}', gh.owner).replace('{repo}', gh.repo).replace('{branch}', gh.branch)
      .replace('{path}', ref.slice(7).split('/').map(encodeURIComponent).join('/'));
  }
  // Enlaces de Drive pegados a mano: /file/d/ID/ o ?id=ID
  if ((m = ref.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/))) {
    return drive.publicUrlTemplate.replace('{id}', m[1]);
  }
  if (/^https:\/\//i.test(ref)) return ref;
  if (/^[\w-]{25,}$/.test(ref)) return drive.publicUrlTemplate.replace('{id}', ref);
  return null; // http:// u otros formatos no se publican
}

/** Lee productos con TODOS sus datos (uso interno y panel). */
function loadProducts_() {
  var products = openTable_('products').rows();
  var variantsTable = openTable_('variants', { optional: true });
  var byProduct = {};
  if (variantsTable) {
    variantsTable.rows().forEach(function (v) {
      var pid = String(v.productId || '').trim();
      if (!pid || !String(v.id || '').trim()) return;
      (byProduct[pid] = byProduct[pid] || []).push({
        _row: v._row,
        id: String(v.id).trim(),
        name: str_(v.name, 120),
        price: num_(v.price, null),
        stock: stockValue_(v.stock),
        rawStock: v.stock,
        active: variantsTable.has('active') ? (v.active === '' ? true : bool_(v.active)) : true
      });
    });
  }
  return products
    .filter(function (p) { return String(p.id || '').trim(); })
    .map(function (p) {
      var id = String(p.id).trim();
      return {
        _row: p._row,
        id: id,
        name: str_(p.name, 200),
        description: str_(p.description, 5000),
        category: str_(p.category, 80),
        price: num_(p.price, 0),
        compareAtPrice: num_(p.compareAtPrice, null),
        cost: num_(p.cost, null),
        stock: stockValue_(p.stock),
        rawStock: p.stock,
        statusRaw: p.status,
        status: productStatus_(p.status),
        featured: bool_(p.featured),
        image: String(p.image || '').trim(),
        gallery: splitRefs_(p.gallery),
        internalNotes: p.internalNotes == null ? '' : String(p.internalNotes),
        updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt || ''),
        variants: byProduct[id] || []
      };
    });
}

/** Proyección pública de un producto: lista blanca de campos. */
function publicProduct_(p) {
  var maxQty = CONFIG.SECURITY.maxQtyPerItem;
  var activeVariants = p.variants.filter(function (v) { return v.active; });
  var images = [p.image].concat(p.gallery)
    .map(resolveImageUrl_).filter(Boolean)
    .map(function (url, i) { return { url: url, alt: p.name + (i ? ' — foto ' + (i + 1) : '') }; });

  var variants = activeVariants.map(function (v) {
    var stock = v.stock;
    return {
      id: v.id,
      name: v.name,
      price: v.price === null ? p.price : v.price,
      available: p.status === 'published' && stock > 0,
      maxQty: Math.min(stock, maxQty)
    };
  });
  var available = p.status === 'published' &&
    (variants.length ? variants.some(function (v) { return v.available; }) : p.stock > 0);
  var prices = variants.length ? variants.map(function (v) { return v.price; }) : [p.price];
  var totalStock = variants.length
    ? activeVariants.reduce(function (a, v) { return a + v.stock; }, 0)
    : p.stock;

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    price: Math.min.apply(null, prices),
    priceMax: Math.max.apply(null, prices),
    compareAtPrice: p.compareAtPrice && p.compareAtPrice > p.price ? p.compareAtPrice : null,
    featured: p.featured,
    images: images,
    variants: variants,
    available: available,
    lowStock: available && totalStock !== Infinity && totalStock <= 3,
    maxQty: variants.length ? null : Math.min(p.stock, maxQty)
  };
}

function buildPublicCatalog_() {
  var products = loadProducts_()
    .filter(function (p) { return p.status === 'published' || p.status === 'soldout'; })
    .map(publicProduct_);
  var seen = {};
  var categories = [];
  products.forEach(function (p) {
    if (p.category && !seen[normKey_(p.category)]) {
      seen[normKey_(p.category)] = true;
      categories.push(p.category);
    }
  });
  return {
    products: products,
    categories: categories,
    settings: getPublicSettings_(),
    currency: CONFIG.CURRENCY,
    generatedAt: nowIso_()
  };
}

function getCatalog_() {
  var cached = cacheGetLarge_(CATALOG_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  var catalog = buildPublicCatalog_();
  try {
    cachePutLarge_(CATALOG_CACHE_KEY, JSON.stringify(catalog), CONFIG.CATALOG_CACHE_SECONDS);
  } catch (err) { /* sin caché: se sirve igual */ }
  return catalog;
}

function invalidateCatalog_() {
  cacheRemoveLarge_(CATALOG_CACHE_KEY);
}
