/**
 * ============================================================================
 *  CONFIGURACIÓN DEL BACKEND (Apps Script)  —  EDITAR POR CLIENTE
 * ============================================================================
 *  Todo lo que cambia entre un cliente y otro está en este archivo:
 *  planilla, nombres de pestañas, nombres de columnas, almacenamiento de fotos,
 *  límites anti-abuso y reglas de stock.
 *
 *  NO pongas contraseñas, tokens ni claves acá. Los secretos van en
 *  "Configuración del proyecto > Propiedades del script" (Script Properties):
 *    - GITHUB_TOKEN            (solo si IMAGE_STORAGE.provider = 'github')
 *    - TURNSTILE_SECRET        (opcional, anti-bots en formularios públicos)
 *    - ADMIN_USERS             (lo crea el menú "Tienda CRM > Crear usuario admin")
 *    - SPREADSHEET_ID          (opcional, alternativa a escribirlo acá)
 * ============================================================================
 */
var CONFIG = {
  VERSION: '1.0.0',

  // ID de la planilla. Dejar vacío si el script está VINCULADO a la planilla
  // (Extensiones > Apps Script desde la propia planilla). Para un script
  // independiente, completar aquí o en la propiedad SPREADSHEET_ID.
  SPREADSHEET_ID: '',

  CURRENCY: 'ARS',
  TIMEZONE: 'America/Argentina/Buenos_Aires',

  /**
   * Pestañas y columnas. La clave de la izquierda es el nombre interno que usa
   * el código; el valor es el TÍTULO de la columna en la fila 1 de la planilla.
   * La búsqueda ignora mayúsculas, tildes y espacios extra, y el orden de las
   * columnas no importa. Si el CRM existente usa otros títulos, cambialos acá.
   * Las columnas marcadas como opcionales pueden no existir.
   */
  SHEETS: {
    products: {
      name: 'Productos',
      required: ['id', 'name', 'price', 'status'],
      columns: {
        id: 'ID',
        name: 'Nombre',
        description: 'Descripción',
        category: 'Categoría',
        price: 'Precio',
        compareAtPrice: 'Precio anterior', // opcional
        cost: 'Costo',                     // PRIVADO: nunca se publica
        stock: 'Stock',
        status: 'Estado',                  // Publicado | Pausado | Agotado
        featured: 'Destacado',             // opcional: SI / NO
        image: 'Foto principal',           // referencia o URL
        gallery: 'Fotos adicionales',      // referencias separadas por salto de línea o |
        internalNotes: 'Notas internas',   // PRIVADO
        updatedAt: 'Actualizado'
      }
    },
    variants: {
      name: 'Variantes',
      required: ['id', 'productId', 'name'],
      columns: {
        id: 'ID variante',
        productId: 'ID producto',
        name: 'Variante',                  // ej: "Color: Gris / Talle: M"
        price: 'Precio',                   // vacío = usa el precio del producto
        stock: 'Stock',
        active: 'Activa'                   // SI / NO
      }
    },
    orders: {
      name: 'Pedidos',
      required: ['id', 'key', 'status'],
      columns: {
        id: 'ID pedido',
        createdAt: 'Fecha',
        key: 'Clave idempotencia',
        customerId: 'ID cliente',
        customerName: 'Cliente',
        email: 'Email',
        phone: 'Teléfono',
        delivery: 'Entrega',
        address: 'Dirección',
        notes: 'Notas del cliente',
        itemsJson: 'Items (JSON)',
        itemsText: 'Detalle',
        subtotal: 'Subtotal',
        shipping: 'Envío',
        total: 'Total',
        currency: 'Moneda',
        status: 'Estado',
        stockApplied: 'Stock descontado',
        source: 'Origen',
        updatedAt: 'Actualizado'
      }
    },
    customers: {
      name: 'Clientes',
      required: ['id', 'email'],
      columns: {
        id: 'ID cliente',
        name: 'Nombre',
        email: 'Email',
        phone: 'Teléfono',
        firstOrderAt: 'Primera compra',
        lastOrderAt: 'Última compra',
        orders: 'Pedidos',
        source: 'Origen'
      }
    },
    inquiries: {
      name: 'Cotizaciones',
      required: ['id', 'createdAt'],
      columns: {
        id: 'ID',
        createdAt: 'Fecha',
        type: 'Tipo',                      // Consulta | Cotización
        name: 'Nombre',
        email: 'Email',
        phone: 'Teléfono',
        productId: 'Producto',
        message: 'Mensaje',
        status: 'Estado'
      }
    },
    billing: {
      name: 'Facturación',
      required: ['id', 'orderId'],
      columns: {
        id: 'ID registro',
        createdAt: 'Fecha',
        orderId: 'ID pedido',
        customerName: 'Cliente',
        total: 'Total',
        currency: 'Moneda',
        fiscalStatus: 'Estado fiscal',
        fiscalNumber: 'Comprobante',
        notes: 'Notas'
      }
    },
    settings: {
      name: 'Tienda',
      required: ['key', 'value'],
      columns: { key: 'Clave', value: 'Valor' }
    }
  },

  /** Valores aceptados en la columna Estado de Productos (sin tildes ni mayúsculas). */
  PRODUCT_STATUS: {
    published: ['publicado', 'activo', 'si', 'visible'],
    paused: ['pausado', 'borrador', 'oculto', 'no'],
    soldOut: ['agotado', 'sin stock']
  },

  ORDER_STATUSES: ['Nuevo', 'Confirmado', 'Preparando', 'Enviado', 'Entregado', 'Cancelado'],
  ORDER_INITIAL_STATUS: 'Nuevo',

  /**
   * Stock:
   *  - 'reserve_on_order': descuenta al recibir el pedido y lo devuelve una sola
   *    vez si el pedido pasa a "Cancelado".
   *  - 'manual': nunca toca el stock (el negocio lo ajusta a mano).
   */
  STOCK_MODE: 'reserve_on_order',
  // Si la celda de stock está vacía: true = stock ilimitado, false = 0.
  EMPTY_STOCK_IS_UNLIMITED: false,

  /** Claves de la pestaña "Tienda" que la tienda pública puede leer. */
  PUBLIC_SETTINGS_KEYS: [
    'hero_title', 'hero_text', 'hero_button', 'hero_badge',
    'announcement',
    'shipping_info', 'payment_info', 'returns_info',
    'faq',                       // formato: Pregunta? | Respuesta  (una por línea)
    'contact_email', 'contact_phone', 'contact_whatsapp', 'contact_address', 'contact_hours',
    'shipping_flat_cost',        // número; vacío o 0 = "a coordinar"
    'min_order_total'
  ],

  /**
   * Almacenamiento de fotos de productos publicados.
   *  provider: 'drive' | 'github' | 'url'
   *   - drive : sube a una carpeta de Google Drive y comparte SOLO ese archivo
   *             como "cualquiera con el enlace puede ver".
   *   - github: sube a un repositorio vía API usando GITHUB_TOKEN de Script
   *             Properties (el token nunca llega al navegador).
   *   - url   : no sube archivos; el administrador pega URLs públicas.
   */
  IMAGE_STORAGE: {
    provider: 'drive',
    maxBytes: 4 * 1024 * 1024,           // tamaño máximo luego del recorte en el navegador
    allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
    trashRemovedImages: true,            // al quitar una foto, mandarla a la papelera
    drive: {
      folderId: '',                      // carpeta SOLO para fotos públicas de productos
      // Plantilla de URL pública. {id} = ID del archivo en Drive.
      // Alternativa: 'https://lh3.googleusercontent.com/d/{id}=w1200'
      publicUrlTemplate: 'https://drive.google.com/thumbnail?id={id}&sz=w1200'
    },
    github: {
      owner: '',
      repo: '',
      branch: 'main',
      pathPrefix: 'product-images',
      // {path} = ruta del archivo dentro del repositorio
      publicUrlTemplate: 'https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}'
    }
  },

  /** Seguridad y límites (ver docs/SEGURIDAD.md). */
  SECURITY: {
    sessionTtlMinutes: 120,              // vencimiento por inactividad
    sessionMaxHours: 6,                  // máximo absoluto (límite de CacheService)
    loginMaxAttempts: 5,                 // por usuario, en la ventana
    loginWindowMinutes: 15,
    passwordIterations: 4000,
    publicMaxBodyBytes: 20000,
    adminMaxBodyBytes: 8 * 1024 * 1024,
    minFormSeconds: 3,                   // formularios enviados más rápido se descartan
    maxOrdersPerMinute: 20,              // global (Apps Script no expone la IP del visitante)
    maxInquiriesPerMinute: 10,
    maxOrdersPerContactPer10Min: 3,      // por email/teléfono
    maxItemsPerOrder: 30,
    maxQtyPerItem: 50,
    requireTurnstile: false              // true = exige token de Cloudflare Turnstile
  },

  CATALOG_CACHE_SECONDS: 60              // reduce lecturas a Sheets; se invalida al editar
};
