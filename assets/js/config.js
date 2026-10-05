/**
 * ============================================================================
 *  CONFIGURACIÓN DE LA TIENDA  —  EDITAR POR CLIENTE
 * ============================================================================
 *  Este archivo es PÚBLICO (lo descarga cualquier visitante).
 *  NUNCA pongas acá contraseñas, tokens de GitHub, claves de APIs, el ID de la
 *  planilla ni nada privado. Solo la URL pública de la API (/exec).
 *
 *  Los textos del banner, envíos, pagos, cambios, FAQ y contacto se pueden
 *  editar desde el CRM (pestaña "Tienda"); los de abajo son valores por
 *  defecto que se usan si el CRM no los define.
 * ============================================================================
 */
export const STORE_CONFIG = {
  /**
   * 'demo' : datos ficticios guardados en este navegador. No escribe en
   *          ninguna planilla y no cobra. Ideal para mostrar la plantilla.
   * 'live' : usa la API de Apps Script indicada en apiUrl.
   * Se puede forzar con ?modo=demo o ?modo=live en la URL (solo para pruebas).
   */
  mode: 'demo',

  // URL de la aplicación web de Apps Script (termina en /exec).
  apiUrl: '',

  brand: {
    name: 'Tienda Modelo',
    tagline: 'Plantilla de tienda online conectada a tu CRM',
    // Si hay logo, poné la ruta (ej: 'assets/img/logo.svg'). Si no, se usan las iniciales.
    logoUrl: '',
    logoInitials: 'TM'
  },

  theme: {
    primary: '#1f4d3f',        // botones y acentos (contraste AA con blanco)
    primaryContrast: '#ffffff',
    accent: '#c2410c',         // precios de oferta, avisos
    surface: '#f7f6f2',
    radius: '14px'
  },

  locale: 'es-AR',
  currency: 'ARS',

  seo: {
    title: 'Tienda Modelo | Tienda online de demostración',
    description: 'Tienda online de demostración conectada a un CRM en Google Sheets. Catálogo, carrito y pedidos de prueba.',
    siteUrl: '',                // ej: https://www.cliente.com.ar (para enlaces canónicos)
    ogImage: ''
  },

  // Textos por defecto (el CRM los puede reemplazar desde la pestaña "Tienda").
  defaults: {
    announcement: 'Demostración: los pedidos no se cobran ni se envían.',
    hero_badge: 'Nueva temporada',
    hero_title: 'Productos simples para el día a día',
    hero_text: 'Este banner, sus textos y el botón se editan desde el CRM, sin tocar el código.',
    hero_button: 'Ver catálogo',
    shipping_info: 'Envíos a coordinar con el vendedor. El costo se informa antes de confirmar.\nRetiro sin cargo a coordinar.',
    payment_info: 'El pago se coordina con el vendedor luego de recibir el pedido. Esta tienda no cobra en línea.',
    returns_info: 'Las condiciones de cambios y devoluciones las define cada negocio. Completar desde el CRM.',
    faq: '¿Cómo hago un pedido? | Agregá productos al carrito, completá tus datos y confirmá. Te contactamos para coordinar pago y entrega.\n¿Puedo pedir una cotización? | Sí, desde el formulario de contacto elegí "Cotización".',
    contact_email: 'contacto@ejemplo.com',
    contact_phone: '',
    contact_whatsapp: '',
    contact_address: '',
    contact_hours: 'Lunes a viernes de 9 a 18 h',
    shipping_flat_cost: '',
    min_order_total: ''
  },

  checkout: {
    deliveryMethods: [
      { id: 'retiro', label: 'Retiro a coordinar' },
      { id: 'envio', label: 'Envío a domicilio' }
    ]
  },

  // Cada cuántos segundos se vuelve a pedir el catálogo mientras la pestaña está visible.
  catalogRefreshSeconds: 90,

  // Opcional: Cloudflare Turnstile (anti-bots). Clave PÚBLICA del sitio.
  // La secreta va en Propiedades del script del backend (TURNSTILE_SECRET).
  turnstileSiteKey: '',

  // Imágenes subidas desde el panel: lado máximo y calidad del recorte en el navegador.
  adminImage: { maxSide: 1600, quality: 0.85, demoMaxSide: 900 }
};
