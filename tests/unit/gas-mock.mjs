// Simulador mínimo de los servicios de Google Apps Script para probar el
// backend en Node. NO reemplaza una prueba contra Google real: solo valida la
// lógica (validaciones, stock, idempotencia, sesiones) sobre una planilla falsa.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map((b) => b & 0xff)));

class FakeRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = this.sheet.data[this.row - 1 + r]?.[this.col - 1 + c];
        line.push(v === undefined || v === null ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); this.sheet.writes++; return this; }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(name, data) { this.name = name; this.data = data.map((r) => r.slice()); this.writes = 0; }
  set(row, col, v) {
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push('');
    // Sheets guarda texto con apóstrofo inicial como texto literal.
    line[col - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) this.formulaInjected = true;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) if (this.data[i - 1].some((v) => v !== '' && v != null)) return i;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() {}
  // helpers de prueba
  objects() {
    const [h, ...rows] = this.data;
    return rows.filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
  }
}

class FakeSpreadsheet {
  constructor(tabs) { this.sheets = Object.fromEntries(Object.entries(tabs).map(([n, d]) => [n, new FakeSheet(n, d)])); }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n, []); return this.sheets[n]; }
  getName() { return 'Planilla de prueba'; }
}

export function createGasContext(tabs, opts = {}) {
  const ss = new FakeSpreadsheet(tabs);
  const cache = new Map();
  const props = new Map(Object.entries(opts.props || {}));
  const clock = { now: Date.now() };
  const files = new Map();
  let lockHeld = false;
  const realDate = Date;
  class FakeDate extends realDate {
    constructor(...a) { super(...(a.length ? a : [clock.now])); }
    static now() { return clock.now; }
  }

  const cacheGet = (k) => {
    const e = cache.get(k);
    if (!e) return null;
    if (e.exp < clock.now) { cache.delete(k); return null; }
    return e.v;
  };
  const sandbox = {
    console: { log() {}, warn() {}, error: opts.logErrors ? console.error : () => {} },
    Date: FakeDate,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss, flush() {}, getUi() { throw new Error('sin UI'); } },
    CacheService: {
      getScriptCache: () => ({
        get: cacheGet,
        put: (k, v, s = 600) => cache.set(k, { v: String(v), exp: clock.now + s * 1000 }),
        putAll: (m, s = 600) => Object.entries(m).forEach(([k, v]) => cache.set(k, { v: String(v), exp: clock.now + s * 1000 })),
        getAll: (keys) => Object.fromEntries(keys.map((k) => [k, cacheGet(k)]).filter(([, v]) => v != null)),
        remove: (k) => cache.delete(k)
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v))
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock() { if (lockHeld) return false; lockHeld = true; return true; },
        waitLock() { lockHeld = true; },
        releaseLock() { lockHeld = false; }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, text) => toSigned(crypto.createHash('sha256').update(toBuf(text)).digest()),
      computeHmacSha256Signature: (value, key) => toSigned(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()),
      base64Encode: (v) => toBuf(v).toString('base64'),
      base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
      newBlob: (data, mime, name) => ({ getBytes: () => (typeof data === 'string' ? toSigned(Buffer.from(data)) : data), mime, name }),
      formatDate: (d) => new realDate(d.getTime()).toISOString().replace('T', ' ').slice(0, 19)
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } })
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'link' }, Permission: { VIEW: 'view' },
      getFolderById: (id) => ({
        getId: () => id, getName: () => 'Fotos',
        createFile: (blob) => {
          const fid = 'file' + crypto.randomBytes(12).toString('hex');
          const f = { id: fid, blob, trashed: false, shared: null, parent: id };
          files.set(fid, f);
          return { getId: () => fid, setSharing: (a) => { f.shared = a; }, setTrashed: (t) => { f.trashed = t; } };
        }
      }),
      getFileById: (fid) => {
        const f = files.get(fid);
        if (!f) throw new Error('no existe');
        let used = false;
        return {
          setTrashed: (t) => { f.trashed = t; },
          getParents: () => ({ hasNext: () => !used, next: () => { used = true; return { getId: () => f.parent }; } })
        };
      }
    },
    UrlFetchApp: { fetch: opts.fetch || (() => { throw new Error('sin red en pruebas'); }) }
  };
  const ctx = vm.createContext(sandbox);
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../backend/apps-script');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.gs')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  if (opts.configure) vm.runInContext(opts.configure, ctx);

  const parse = (out) => JSON.parse(out.getContent());
  return {
    ctx, ss, cache, props, clock, files,
    sheet: (n) => ss.getSheetByName(n),
    get: (params) => parse(ctx.doGet({ parameter: params })),
    post: (body) => parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })),
    advance: (ms) => { clock.now += ms; },
    holdLock: (v) => { lockHeld = v; }
  };
}

/** Planilla base en el formato por defecto de 00_Config.gs. */
export function baseTabs() {
  return {
    Productos: [
      ['ID', 'Nombre', 'Descripción', 'Categoría', 'Precio', 'Precio anterior', 'Costo', 'Stock', 'Estado', 'Destacado', 'Foto principal', 'Fotos adicionales', 'Notas internas', 'Actualizado', 'Columna propia del CRM'],
      ['P1', 'Taza', 'Taza de cerámica', 'Cocina', 1500, '', 600, 5, 'Publicado', 'SI', '', '', 'proveedor X', '', '=formula-propia'],
      ['P2', 'Manta', 'Manta tejida', 'Textil', '25.000', 30000, 9000, '', 'Publicado', 'NO', 'drive:abcdefghijklmnopqrstuvwxyz', 'https://example.com/a.jpg\nhttp://inseguro/b.jpg', '', '', ''],
      ['P3', 'Vela', 'Vela de soja', 'Deco', 900, '', 300, 10, 'Pausado', '', '', '', '', '', ''],
      ['P4', 'Florero', 'Florero de vidrio', 'Deco', 4000, '', 1500, 0, 'Publicado', '', '', '', '', '', ''],
      ['P5', 'Lámpara', 'Lámpara', 'Deco', 8000, '', 3000, 4, 'Agotado', '', '', '', '', '', '']
    ],
    Variantes: [
      ['ID variante', 'ID producto', 'Variante', 'Precio', 'Stock', 'Activa'],
      ['P2-GR', 'P2', 'Color: Gris', '', 2, 'SI'],
      ['P2-VE', 'P2', 'Color: Verde', 27000, 1, 'SI'],
      ['P2-RO', 'P2', 'Color: Rojo', '', 9, 'NO']
    ],
    Pedidos: [[ 'ID pedido', 'Fecha', 'Clave idempotencia', 'ID cliente', 'Cliente', 'Email', 'Teléfono', 'Entrega', 'Dirección', 'Notas del cliente', 'Items (JSON)', 'Detalle', 'Subtotal', 'Envío', 'Total', 'Moneda', 'Estado', 'Stock descontado', 'Origen', 'Actualizado' ]],
    Clientes: [['ID cliente', 'Nombre', 'Email', 'Teléfono', 'Primera compra', 'Última compra', 'Pedidos', 'Origen']],
    Cotizaciones: [['ID', 'Fecha', 'Tipo', 'Nombre', 'Email', 'Teléfono', 'Producto', 'Mensaje', 'Estado']],
    'Facturación': [['ID registro', 'Fecha', 'ID pedido', 'Cliente', 'Total', 'Moneda', 'Estado fiscal', 'Comprobante', 'Notas']],
    Tienda: [['Clave', 'Valor'], ['hero_title', 'Hola'], ['shipping_flat_cost', '1000'], ['clave_privada', 'secreto']]
  };
}
