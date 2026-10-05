// Cliente de la API del CRM. Misma interfaz para modo 'live' (Apps Script)
// y modo 'demo' (backend simulado en el navegador).

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details || null;
  }
}

/** Error de red: NO sabemos si el servidor procesó la solicitud. */
export class NetworkError extends Error {
  constructor(message) {
    super(message || 'No se pudo conectar con el servidor.');
    this.code = 'NETWORK';
  }
}

export function resolveMode(config, search = globalThis.location?.search || '') {
  const forced = new URLSearchParams(search).get('modo');
  if (forced === 'demo' || forced === 'live') return forced;
  return config.mode === 'live' ? 'live' : 'demo';
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, redirect: 'follow', credentials: 'omit' });
  } catch (err) {
    throw new NetworkError(err.name === 'AbortError'
      ? 'El servidor tardó demasiado en responder.'
      : 'No se pudo conectar con el servidor. Revisá tu conexión.');
  } finally {
    clearTimeout(timer);
  }
}

async function unwrap(res) {
  let body;
  try {
    body = await res.json();
  } catch {
    // Apps Script devuelve HTML si la URL o la implementación son incorrectas.
    throw new ApiError('BAD_RESPONSE', 'El servidor respondió algo inesperado. Verificá la URL de la API y que la implementación esté publicada.');
  }
  if (!body || typeof body !== 'object') throw new ApiError('BAD_RESPONSE', 'Respuesta inválida del servidor.');
  if (!body.ok) throw new ApiError(body.error?.code || 'ERROR', body.error?.message || 'Error del servidor.', body.error?.details);
  return body.data;
}

function liveTransport(apiUrl) {
  if (!/^https:\/\//.test(apiUrl || '')) {
    const err = async () => { throw new ApiError('CONFIG', 'Falta configurar apiUrl en assets/js/config.js.'); };
    return { get: err, post: err };
  }
  return {
    async get(action) {
      const url = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}action=${encodeURIComponent(action)}`;
      return unwrap(await fetchWithTimeout(url, { method: 'GET' }, 20000));
    },
    async post(action, payload, { timeoutMs = 30000 } = {}) {
      // text/plain evita la consulta previa CORS (Apps Script no responde OPTIONS).
      const res = await fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, action })
      }, timeoutMs);
      return unwrap(res);
    }
  };
}

export async function createApi(config) {
  const mode = resolveMode(config);
  let transport;
  if (mode === 'demo') {
    const { createDemoBackend } = await import('./demo-backend.js');
    const backend = await createDemoBackend(config);
    transport = {
      get: (action) => backend.handle(action, {}),
      post: (action, payload) => backend.handle(action, payload)
    };
  } else {
    transport = liveTransport(config.apiUrl);
  }
  return {
    mode,
    getCatalog: () => transport.get('catalog'),
    health: () => transport.get('health'),
    post: (action, payload, opts) => transport.post(action, payload || {}, opts)
  };
}
