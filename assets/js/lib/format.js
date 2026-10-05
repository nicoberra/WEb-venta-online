export function createFormatter(locale = 'es-AR', currency = 'ARS') {
  let nf;
  try {
    nf = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 0 });
  } catch {
    nf = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
  }
  return {
    money: (n) => nf.format(Number(n) || 0),
    range: (min, max) => (max && max !== min ? `${nf.format(min)} – ${nf.format(max)}` : nf.format(min))
  };
}

/** "Pregunta | Respuesta" por línea -> [{q, a}] */
export function parseFaq(text) {
  return String(text || '').split('\n').map((line) => {
    const i = line.indexOf('|');
    if (i < 0) return null;
    const q = line.slice(0, i).trim();
    const a = line.slice(i + 1).trim();
    return q && a ? { q, a } : null;
  }).filter(Boolean);
}

/** Normaliza para búsquedas: sin tildes ni mayúsculas. */
export const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
