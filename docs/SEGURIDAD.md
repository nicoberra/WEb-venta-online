# Seguridad: decisiones, límites y alternativas

Este documento explica qué protege la plantilla, qué **no** puede proteger por
limitaciones de Google Apps Script y qué conviene hacer cuando un cliente
necesita más. Nada de esto fue auditado por terceros: es una base razonable,
no una certificación.

## 1. Revisión del patrón de referencia y qué se cambió

| Patrón de referencia | Problema | Qué hace esta plantilla |
|---|---|---|
| Hash de la contraseña enviado en cada llamada | El hash funciona como contraseña permanente: quien lo copia entra para siempre | La contraseña se envía **solo al iniciar sesión**. El servidor devuelve un token aleatorio que vence |
| Hash guardado en `localStorage` | Persiste indefinidamente, lo lee cualquier script de la página | Token en `sessionStorage` (se borra al cerrar la pestaña) |
| Sin vencimiento ni cierre de sesión real | No se puede revocar un acceso robado | Vence por inactividad (120 min) y por máximo absoluto (6 h). “Cerrar sesión” lo invalida en el servidor. “Cerrar todas las sesiones” invalida todos los tokens |
| JSONP para leer datos privados | Cualquier sitio puede incluir el script y leer la respuesta | No hay JSONP. Las lecturas privadas son `POST` con token. El único `GET` público es el catálogo ya filtrado |
| Escrituras públicas sin validar | Spam, pedidos falsos, precios manipulados | El backend recalcula precios, valida stock, cantidades y campos, y aplica límites anti-abuso |
| Credenciales en el código del navegador | Las ve cualquier visitante | Los secretos van en **Propiedades del script**. `config.js` solo tiene la URL pública `/exec` |

## 2. Cómo se guardan las contraseñas

- PBKDF2-HMAC-SHA256 con sal aleatoria por usuario y 4000 iteraciones
  (`CONFIG.SECURITY.passwordIterations`), en la propiedad `ADMIN_USERS`.
- Apps Script no tiene bcrypt/argon2 y cada iteración cuesta tiempo de
  ejecución: 4000 es un equilibrio entre resistencia y la cuota de 6 minutos
  por ejecución. Por eso conviene exigir **frases largas** (mínimo 10
  caracteres; se recomiendan 16 o más).
- Los usuarios se crean desde el menú **Tienda CRM** de la planilla: solo
  quien tiene acceso de edición a la planilla puede crearlos.
- Cambiar o quitar un usuario cierra todas las sesiones abiertas.

## 3. Límites de Apps Script que hay que conocer

1. **No hay cookies `HttpOnly`.** El token es accesible para JavaScript del
   panel. Mitigación: CSP estricta (`script-src 'self'`), todo texto del CRM
   se escapa antes de mostrarse, sin scripts de terceros en el panel. Si un
   atacante lograra ejecutar código en el dominio del panel, podría usar la
   sesión mientras esté vigente.
2. **No se ve la IP del visitante.** Los límites de intentos son por usuario,
   por email/teléfono y globales. Un atacante que conozca el usuario puede
   bloquearlo temporalmente (15 min) con intentos fallidos. No hay bloqueo
   por IP.
3. **CacheService no es una base de datos.** Las sesiones pueden borrarse
   antes de tiempo (el usuario vuelve a iniciar sesión; no es un riesgo).
   Los contadores anti-abuso no son atómicos entre ejecuciones simultáneas.
4. **La URL `/exec` es pública por diseño** (la tienda la necesita). La
   seguridad depende de que cada acción privada exija token, no de ocultarla.
5. **El panel es una página estática pública.** No contiene datos ni
   secretos; sin token no puede hacer nada. Igual conviene publicarlo en una
   ruta no enlazada y con `noindex` (ya incluido).
6. **Cuotas:** ejecuciones simultáneas (~30 por usuario), 6 min por ejecución,
   llamadas a `UrlFetchApp` y escrituras en Sheets tienen límites diarios.
   El catálogo se cachea 60 s para reducir lecturas. Para tráfico alto
   (cientos de pedidos por hora) Sheets no es la herramienta adecuada.
7. **Sin transacciones.** Los pedidos usan `LockService` (uno por vez) y una
   clave de idempotencia. Si una ejecución se corta a mitad de camino, el
   pedido queda con “Stock descontado = PENDIENTE” para revisión manual.

## 4. Alternativa más fuerte para el panel (recomendada para clientes con más riesgo)

Servir el panel **desde Apps Script con cuentas de Google**:

- Implementación separada con “Ejecutar como: usuario que accede” y “Acceso:
  cualquier usuario con cuenta de Google”, y la planilla compartida solo con
  el personal autorizado.
- Google maneja contraseña, 2FA, cierre y vencimiento de sesión; Apps Script
  identifica al usuario con `Session.getActiveUser()`.
- Costo: el panel pasa a usar `HtmlService` + `google.script.run` (otra
  forma de llamar a las mismas funciones `admin*`), cada usuario necesita una
  cuenta de Google con acceso a la planilla y a la carpeta de fotos, y la
  interfaz queda dentro del marco de Google.

Si el negocio necesita roles, auditoría detallada, bloqueo por IP o alto
volumen, la recomendación es migrar el backend a un servicio con base de
datos real (por ejemplo Firebase/Supabase o un servidor propio) manteniendo
la misma API (`catalog`, `createOrder`, `admin*`): la tienda y el panel no
cambian.

## 5. Formularios públicos

- Campo trampa (`website`) y tiempo mínimo de llenado (3 s).
- Límite global por minuto y límite por email/teléfono (solo cuentan los
  pedidos guardados).
- Longitudes máximas en todos los campos y tamaño máximo de solicitud (20 KB).
- Textos que empiezan con `= + - @` se guardan como texto literal
  (evita fórmulas inyectadas en la planilla).
- Opcional: Cloudflare Turnstile (`turnstileSiteKey` en `config.js`,
  `TURNSTILE_SECRET` en Propiedades y `requireTurnstile: true`). Requiere
  agregar `https://challenges.cloudflare.com` a `script-src` y `frame-src` en
  la CSP de `index.html`.
- Las acciones públicas solo **agregan** filas y devuelven un número de
  pedido o consulta. Nunca devuelven datos del CRM.

## 6. Fotos y documentos

- Fotos de productos publicados: cada archivo se comparte individualmente
  como “cualquiera con el enlace puede ver”. La carpeta no se comparte.
- Usá una carpeta **exclusiva** para fotos públicas. Los documentos privados
  del CRM deben estar en otras carpetas, sin compartir.
- El backend verifica el tipo real del archivo (firma de bytes), limita el
  tamaño y solo borra archivos dentro de la carpeta/ruta configurada.
- El navegador redibuja la foto antes de subirla, lo que elimina metadatos
  como la ubicación GPS.
- Si se usa GitHub: token *fine-grained* con permiso “Contents: write” solo
  sobre el repositorio de fotos, guardado en `GITHUB_TOKEN` (Propiedades del
  script). Nunca en el navegador.

## 7. Checklist antes de entregar a un cliente

- [ ] La planilla **no** está compartida públicamente.
- [ ] La carpeta de fotos contiene solo fotos públicas.
- [ ] Hay al menos un usuario admin con contraseña larga y única.
- [ ] `config.js` no tiene secretos (`grep -i token assets/js/config.js`).
- [ ] “Diagnóstico de configuración” sin errores.
- [ ] Prueba real de: catálogo, alta de producto con foto, pedido, cancelación.
- [ ] Textos legales (términos, privacidad, defensa del consumidor) redactados
      y revisados por el negocio o su asesor.
