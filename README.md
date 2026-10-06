# Tienda online + CRM (Google Sheets + Apps Script) — plantilla reutilizable

Tienda pública de demostración que **lee el catálogo desde el CRM** y le
**envía pedidos y consultas**, más un **panel privado** para administrar
productos, fotos, variantes, stock, pedidos, consultas, registros de venta y
los textos de la tienda. El CRM (la planilla) es la única fuente de datos: no
hay un segundo catálogo en el código.

> **Estado real (leer antes de mostrar a un cliente)**
>
> - ✅ **Modo demostración:** funciona completo en el navegador con datos
>   ficticios. No escribe en ninguna planilla y no cobra.
> - ⚠️ **Backend Apps Script:** escrito y probado **contra un simulador** de
>   Google Sheets en Node (20 pruebas). **No fue probado todavía contra una
>   planilla y una implementación reales de Google.** Hasta hacer las pruebas
>   de la sección 9 no se puede afirmar que la tienda esté conectada.
> - ❌ **Pagos online, envíos con transportistas y facturación fiscal:** no
>   están integrados (ver sección 10).

---

## Índice
1. [Qué incluye](#1-qué-incluye)
2. [Ver la demo en local](#2-ver-la-demo-en-local)
3. [Duplicar la plantilla para un cliente](#3-duplicar-la-plantilla-para-un-cliente)
4. [Qué datos pedirle a cada cliente](#4-qué-datos-pedirle-a-cada-cliente)
5. [Cómo se conecta la tienda con el CRM](#5-cómo-se-conecta-la-tienda-con-el-crm)
6. [Estructura de la planilla](#6-estructura-de-la-planilla)
7. [Configurar API, planilla, permisos y fotos](#7-configurar-api-planilla-permisos-y-fotos)
8. [Si el cliente ya tiene un CRM](#8-si-el-cliente-ya-tiene-un-crm)
9. [Cómo probar](#9-cómo-probar)
10. [Pagos, envíos y facturación: configuración externa](#10-pagos-envíos-y-facturación-configuración-externa)
11. [Limitaciones de la arquitectura](#11-limitaciones-de-la-arquitectura)

---

## 1. Qué incluye

```
index.html                 Tienda pública (una sola página, rutas con #)
admin/index.html           Panel privado (login con sesión que vence)
assets/js/config.js        ← CONFIGURACIÓN DE LA TIENDA (marca, colores, textos, moneda, URL de la API)
assets/js/lib/             API, backend demo, carrito, utilidades, achicado de fotos
assets/js/store/           Componentes y lógica de la tienda
assets/js/admin/           Lógica del panel
assets/css/                Estilos (base compartida, tienda, panel)
data/demo-crm.json         Datos ficticios del modo demostración
backend/apps-script/       ← BACKEND para pegar en Apps Script
  00_Config.gs             ← CONFIGURACIÓN DEL BACKEND (planilla, pestañas, columnas, fotos, límites)
  01..11_*.gs              Lógica: tablas, catálogo, pedidos, consultas, sesiones, panel, fotos, router, menú
docs/SEGURIDAD.md          Decisiones de seguridad, límites y alternativas
docs/RECURSOS.md           Procedencia de recursos gráficos
tests/                     Pruebas automáticas (backend simulado + navegador)
tools/serve.mjs            Servidor local sin dependencias
```

**Tienda:** encabezado con logo, navegación, búsqueda y carrito · banner
editable · categorías · destacados · grilla con filtros (categoría,
disponibilidad, orden) y búsqueda sin tildes · ficha con galería, variantes y
cantidad · carrito lateral (vacío / con productos / sin stock) · checkout de
prueba · envíos, pagos, cambios y preguntas frecuentes editables · contacto con
formulario de consulta o cotización · pie de página. Fotos ausentes →
recuadro **“FOTO DE PRODUCTO”**. SEO básico (título, descripción, Open Graph,
datos estructurados `Product`), accesible con teclado, adaptable a celular.

**Panel:** productos (crear, editar, eliminar, estado Publicado/Pausado/Agotado,
destacado, costo y notas privadas, variantes con precio y stock propios, foto
principal y hasta 8 adicionales con vista previa, reemplazar, quitar, hacer
principal, pegar URL) · pedidos (estados, cancelar devuelve stock una vez,
registrar venta interna) · consultas · facturación interna · textos de la
tienda · cerrar sesión / cerrar todas las sesiones.

Sin frameworks ni dependencias: HTML, CSS y JavaScript estándar. Se puede
publicar en cualquier hosting estático (GitHub Pages, Netlify, Cloudflare
Pages, un hosting tradicional).

## 2. Ver la demo en local

Requiere Node 20+ (o cualquier servidor estático; los módulos JS no funcionan
abriendo el archivo con doble clic).

```bash
npm start            # o: node tools/serve.mjs 8080
# Tienda: http://localhost:8080/
# Panel:  http://localhost:8080/admin/   (usuario demo / contraseña demo)
```

Para mostrarlo a un cliente: abrí la tienda y el panel en dos pestañas,
subí una foto o cambiá un precio en el panel y la tienda se actualiza sola.

Simular fallas (solo en modo demo), agregando a la URL:

| Parámetro | Efecto |
|---|---|
| `?simular=sin-conexion` | Todo falla por red (muestra error o datos guardados) |
| `?simular=pedido-sin-conexion` | Solo falla el envío del pedido (no se confirma; reintento sin duplicar) |
| `?simular=error` | El servidor responde error interno |
| `?simular=lento` | Respuestas de 3 segundos |

“Restablecer demo” (panel → Seguridad) vuelve a los datos de ejemplo.

## 3. Duplicar la plantilla para un cliente

1. Copiá el repositorio (*Use this template* / fork / copia de la carpeta).
2. Editá **`assets/js/config.js`**: `brand`, `theme` (colores), `locale`,
   `currency`, `seo`, `defaults` (textos por defecto), `checkout.deliveryMethods`.
3. Editá en `index.html` el `<title>`, la descripción y los `og:` (para
   buscadores que no ejecutan JavaScript) y el color `theme-color`.
4. Reemplazá `assets/img/favicon.svg` y, si hay logo, ponelo en `assets/img/`
   y completá `brand.logoUrl`.
5. Configurá el backend (sección 7) y pasá `mode: 'live'` con la `apiUrl`.
6. Los textos de banner, envíos, pagos, cambios, FAQ y contacto se editan
   después desde el panel → **Textos de la tienda** (no hace falta tocar código).

## 4. Qué datos pedirle a cada cliente

**Indispensables**
- Nombre comercial, logo (SVG o PNG) y colores de marca.
- Moneda y país (formato de precios).
- Cuenta de Google que será **dueña** de la planilla y del script.
- Si ya tiene CRM: copia de la planilla (puede ser sin datos reales) o lista
  de pestañas y títulos de columnas, y el código de Apps Script actual
  (especialmente `doGet`/`doPost`).
- Dónde guarda hoy las fotos (Drive, GitHub, otro) y cómo las sube.
- Qué personas administran el panel (para crear sus usuarios).
- Formas de entrega que ofrece y si cobra un costo fijo de envío.
- Email/teléfono/WhatsApp/horario de contacto.

**Para salir a producción**
- Dominio donde se publicará la tienda.
- Textos de envíos, pagos, cambios y devoluciones, y preguntas frecuentes.
- Textos legales (términos, privacidad, defensa del consumidor) redactados
  por el negocio o su asesor. **La plantilla no incluye textos legales.**
- Si quiere cobrar online: proveedor de pagos y credenciales (sección 10).
- Si quiere facturar automáticamente: sistema fiscal y credenciales (sección 10).

## 5. Cómo se conecta la tienda con el CRM

```
 Planilla (privada)  ◄──── Apps Script (API /exec, ejecuta como el dueño)
  Productos, Variantes,        │  GET  ?action=catalog  → catálogo PÚBLICO filtrado
  Pedidos, Clientes,           │  POST createOrder / createInquiry (validados)
  Cotizaciones,                │  POST adminLogin → token
  Facturación, Tienda          │  POST admin* (con token)
        ▲                      ▼
  Drive (carpeta de fotos)   Tienda (index.html)      Panel (admin/)
```

- **Catálogo:** la tienda pide `?action=catalog`. El backend lee Productos y
  Variantes, deja solo los publicados o agotados, y envía **una lista blanca**
  de campos: id, nombre, descripción, categoría, precios de venta, fotos
  (URLs públicas), variantes activas y disponibilidad. Nunca envía costo,
  notas internas, columnas propias del CRM, clientes ni pedidos. Se cachea
  60 s y se invalida cuando el panel guarda algo.
- **Actualización automática:** la tienda vuelve a pedir el catálogo cada 90 s
  mientras la pestaña está visible y al volver a ella
  (`catalogRefreshSeconds`). Una foto, precio o stock cargado en el CRM
  aparece sin tocar código ni recargar.
- **Fotos:** el panel achica la imagen en el navegador (máx. 1600 px, WebP o
  JPEG), la envía al backend, el backend la guarda en el almacenamiento
  configurado y devuelve una **referencia corta** (`drive:ID`,
  `github:ruta`). En la planilla se guarda esa referencia o una URL `https://`,
  nunca la imagen. El backend la convierte en URL pública al armar el catálogo.
  También acepta enlaces de Drive pegados a mano en la celda.
- **Pedidos:** el navegador manda solo IDs, variantes, cantidades, datos del
  comprador y una clave única del intento. El backend, con un bloqueo
  (`LockService`): verifica la clave (si ya existe devuelve el mismo pedido),
  relee precios y stock, rechaza si algo cambió, guarda el pedido en estado
  “Nuevo”, descuenta stock y registra/actualiza el cliente. La tienda solo
  muestra “pedido recibido” cuando el backend respondió que lo guardó.

## 6. Estructura de la planilla

Los nombres de pestañas y títulos de columnas se configuran en
`backend/apps-script/00_Config.gs` → `SHEETS`. La búsqueda de columnas ignora
mayúsculas, tildes y orden; las columnas extra del CRM se respetan (nunca se
sobrescriben). El menú **Tienda CRM → Inicializar pestañas faltantes** crea lo
que falte sin borrar nada.

**Productos** — `ID`\*, `Nombre`\*, `Descripción`, `Categoría`, `Precio`\*,
`Precio anterior`, `Costo` (privado), `Stock`, `Estado`\* (Publicado / Pausado /
Agotado), `Destacado` (SI/NO), `Foto principal`, `Fotos adicionales` (una por
línea o separadas por `|`), `Notas internas` (privado), `Actualizado`.

**Variantes** — `ID variante`\*, `ID producto`\*, `Variante`\* (ej. “Color: Gris”),
`Precio` (vacío = el del producto), `Stock`, `Activa` (SI/NO). Si un producto
tiene variantes activas, el stock que cuenta es el de cada variante.

**Pedidos** — `ID pedido`, `Fecha`, `Clave idempotencia`, `ID cliente`,
`Cliente`, `Email`, `Teléfono`, `Entrega`, `Dirección`, `Notas del cliente`,
`Items (JSON)`, `Detalle`, `Subtotal`, `Envío`, `Total`, `Moneda`, `Estado`,
`Stock descontado` (SI / PENDIENTE / DEVUELTO), `Origen`, `Actualizado`.

**Clientes** — `ID cliente`, `Nombre`, `Email`, `Teléfono`, `Primera compra`,
`Última compra`, `Pedidos`, `Origen`.

**Cotizaciones** — `ID`, `Fecha`, `Tipo`, `Nombre`, `Email`, `Teléfono`,
`Producto`, `Mensaje`, `Estado`.

**Facturación** — `ID registro`, `Fecha`, `ID pedido`, `Cliente`, `Total`,
`Moneda`, `Estado fiscal`, `Comprobante`, `Notas`. Registro **interno**.

**Tienda** — `Clave` / `Valor`. Claves públicas: `hero_title`, `hero_text`,
`hero_button`, `hero_badge`, `announcement`, `shipping_info`, `payment_info`,
`returns_info`, `faq` (una por línea: `Pregunta | Respuesta`),
`contact_email`, `contact_phone`, `contact_whatsapp`, `contact_address`,
`contact_hours`, `shipping_flat_cost`, `min_order_total`. Cualquier otra clave
de esta pestaña **no** se publica.

\* obligatorias. Reglas de stock: celda vacía = 0 (cambiable con
`EMPTY_STOCK_IS_UNLIMITED`). `STOCK_MODE: 'manual'` desactiva el descuento
automático.

## 7. Configurar API, planilla, permisos y fotos

1. **Planilla:** en la cuenta de Google del negocio, abrir (o crear) la
   planilla. Compartirla **solo** con quienes administran. No publicarla en la web.
2. **Script vinculado:** en la planilla, *Extensiones → Apps Script*. Crear un
   archivo por cada `.gs` de `backend/apps-script/` (mismos nombres) y pegar
   el contenido. En *Configuración del proyecto* activar “Mostrar el archivo de
   manifiesto” y reemplazar `appsscript.json`. (Alternativa: `clasp push`.)
3. **Configurar** `00_Config.gs`: moneda, zona horaria, nombres de pestañas y
   columnas si difieren, y almacenamiento de fotos (paso 6).
4. Recargar la planilla → aparece el menú **Tienda CRM**:
   1. *Inicializar pestañas faltantes* (la primera vez pide autorizar permisos).
   2. *Crear / cambiar usuario admin* (contraseña de 10+ caracteres; se guarda
      como hash en Propiedades del script).
   3. *Diagnóstico de configuración*: debe mostrar todo “OK”.
5. **Publicar la API:** *Implementar → Nueva implementación → Aplicación web*.
   Ejecutar como **Yo**; Quién tiene acceso **Cualquier usuario**. Copiar la URL
   que termina en `/exec`.
   - Cada cambio en el código requiere *Gestionar implementaciones → Editar →
     Nueva versión* para que la URL `/exec` lo use.
6. **Fotos** (`IMAGE_STORAGE.provider`):
   - `drive` (por defecto): crear una carpeta **solo para fotos públicas de
     productos** y poner su ID en `drive.folderId`. Cada foto subida se comparte
     individualmente como “cualquiera con el enlace puede ver”; la carpeta no.
     Requiere el permiso amplio de Drive (`auth/drive`) porque `DriveApp` no
     funciona con el permiso restringido. Si una política de Google Workspace
     bloquea compartir con enlace, la subida falla con un mensaje claro.
     La URL pública usa `drive.google.com/thumbnail?id=…`; Google no la
     documenta como API estable, por eso es configurable
     (`publicUrlTemplate`).
   - `github`: completar `owner`, `repo`, `branch`, `pathPrefix` y crear la
     propiedad `GITHUB_TOKEN` (token *fine-grained*, “Contents: write” solo en
     ese repo). El token queda en el servidor. Si el repo es privado, las
     fotos no se verán: usá un repo público de solo fotos o GitHub Pages en
     `publicUrlTemplate`. Podés quitar el permiso de Drive del manifiesto.
   - `url`: sin subida; se pegan URLs `https://` en el panel o en la planilla.
7. **Tienda:** en `assets/js/config.js` poner `apiUrl` con la URL `/exec` y
   `mode: 'live'`. Probar sin editar el archivo con `?modo=live`.
8. **Publicar** la carpeta del proyecto (sin `backend/` ni `tests/` si se
   prefiere) en el hosting estático. El panel queda en `/admin/` (con
   `noindex` y bloqueado en `robots.txt`).

Secretos que van en **Propiedades del script** (nunca en el código):
`ADMIN_USERS` (lo crea el menú), `GITHUB_TOKEN`, `TURNSTILE_SECRET`, y
opcionalmente `SPREADSHEET_ID` / `DRIVE_FOLDER_ID`.

## 8. Si el cliente ya tiene un CRM

- **No crear otra planilla ni otro catálogo.** Apuntar `SPREADSHEET_ID` (o el
  script vinculado) a la planilla existente y mapear sus títulos de columna en
  `SHEETS`. Las columnas que el CRM ya usa y la tienda no necesita se ignoran.
- **Si ya tiene `doGet`/`doPost`:** renombrar los de `10_Router.gs` a
  `apiGet_`/`apiPost_` y llamarlos desde el router existente cuando llegue
  `action=catalog`, `createOrder`, etc. Revisar que no haya funciones con el
  mismo nombre.
- **Si ya sube fotos:** si guarda IDs o enlaces de Drive o URLs `https://`
  en la columna de foto, la tienda los muestra sin cambios. Si su sistema sube
  a GitHub **con el token en el navegador**, hay que moverlo al backend
  (provider `github`) y **revocar ese token**, porque cualquiera que haya
  abierto el panel pudo copiarlo.
- **Si su login usa el patrón de hash en `localStorage`/JSONP**, reemplazarlo
  por el de esta plantilla (ver `docs/SEGURIDAD.md`).
- Si el CRM tiene su propia interfaz para productos, se puede seguir usando:
  la tienda solo lee la planilla. El panel incluido es opcional.

## 9. Cómo probar

**Automáticas** (no requieren Google):

```bash
npm test          # 24 pruebas: backend con planilla simulada + carrito y plantillas
npm run test:e2e  # 9 pruebas en Chromium sobre el modo demo (requiere Playwright)
```

Cubren: catálogo sin datos privados, columnas en otro orden, error claro por
columna faltante, precios recalculados en el servidor, rechazo por precio
cambiado, idempotencia (doble envío y caché perdida), pedidos simultáneos sin
sobreventa, bloqueo ocupado, validaciones, honeypot y límites, fórmulas
inyectadas, consultas, acciones privadas sin token, bloqueo de login,
vencimiento y cierre de sesiones, alta/edición/borrado con variantes y fotos,
cancelación que devuelve stock una vez, facturación interna única, textos
públicos, y en el navegador: búsqueda, filtros, variantes, carrito con
teclado, checkout, fallas de conexión, panel → tienda en vivo.

**Manuales contra Google real** (hacerlas antes de decir que está conectado):

1. `GET <url>/exec?action=health` responde `{"ok":true,...}`.
2. Cargar un producto en la planilla con Estado “Publicado” → aparece en la
   tienda (hasta 60 s de caché + 90 s de refresco).
3. Panel: iniciar sesión, crear producto, subir foto → la celda guarda
   `drive:…` y la tienda muestra la foto. Abrir la URL de la foto en una
   ventana privada (debe verse sin iniciar sesión en Google).
4. Quitar la foto → el archivo va a la papelera y la tienda vuelve a
   “FOTO DE PRODUCTO”.
5. Cambiar stock a 0 → la tienda muestra “Agotado” y el backend rechaza el pedido.
6. Hacer un pedido → fila en Pedidos con “Stock descontado = SI”, cliente en
   Clientes, stock reducido. Enviar dos veces seguidas → un solo pedido.
7. Cancelar desde el panel → stock devuelto y “DEVUELTO”.
8. Abrir dos pestañas y pedir el último artículo a la vez → solo uno se confirma.
9. Ventana privada: abrir la URL de la planilla → debe pedir permiso.
10. Esperar 2 horas sin actividad en el panel → pide iniciar sesión de nuevo.

## 10. Pagos, envíos y facturación: configuración externa

| Función | Estado en la plantilla | Qué hace falta |
|---|---|---|
| **Pagos online** | No se cobra. El pedido queda “Nuevo” y el pago se coordina | Cuenta en un proveedor (ej. Mercado Pago, Stripe), credenciales en Propiedades del script, crear la preferencia/sesión de pago **desde el backend** con el total recalculado, y un webhook que confirme el pago antes de marcar el pedido como pagado. No confiar en la redirección del navegador |
| **Envíos** | “Retiro” o “Envío” con costo fijo opcional o “a coordinar” | Para cotizar en línea: API del transportista (credenciales en el backend), tabla de zonas o integración con la plataforma de envíos |
| **Facturación fiscal** | **Pendiente.** “Registrar venta” crea un registro interno con estado “Pendiente: sin integración fiscal”. **No emite comprobantes** | Integración con el sistema fiscal correspondiente (en Argentina, web services de AFIP/ARCA con certificado digital, o un servicio intermediario), datos fiscales del comprador, punto de venta, y pruebas en homologación antes de producción |
| **Emails automáticos** | No incluidos | `MailApp` en el backend (cuota diaria limitada) o un servicio transaccional |

## 11. Limitaciones de la arquitectura

- Google Sheets + Apps Script es adecuado para catálogos chicos y medianos
  (cientos a pocos miles de productos) y volumen moderado de pedidos. Cada
  pedido se procesa de a uno (bloqueo) y tarda 1–5 s.
- El catálogo puede tardar hasta ~2,5 minutos en reflejar un cambio hecho
  directamente en la planilla (caché + refresco). Los cambios desde el panel
  invalidan la caché de inmediato.
- Apps Script tiene cuotas diarias (ejecuciones, `UrlFetch`, tiempo) y puede
  tener demoras o caídas puntuales: la tienda muestra el error, ofrece
  reintentar y, si ya tenía el catálogo, lo muestra marcado como desactualizado.
- Ver límites de seguridad en [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md) (sin
  cookies HttpOnly, sin IP, contadores no atómicos).
- Las rutas con `#` no son ideales para SEO de cada producto: los buscadores
  modernos ejecutan JavaScript, pero no hay `sitemap.xml` por producto. Para
  SEO fuerte por producto conviene generar páginas estáticas.
- Fotos subidas en el panel que nunca se guardan en un producto (se cerró el
  editor sin guardar) quedan en la carpeta y hay que borrarlas a mano.
- El modo demo guarda todo en el `localStorage` del navegador (≈5 MB): con
  muchas fotos subidas puede llenarse; “Restablecer demo” lo limpia.

Recursos gráficos y condiciones de uso: [`docs/RECURSOS.md`](docs/RECURSOS.md).
