# El Closet del Hincha: contexto del proyecto

Tienda de camisetas (fútbol, NBA, F1, NFL/MLB) del dueño, Gustavo. El proveedor es chino y trabaja con catálogos de Yupoo. El cliente arma su pedido en la web y el dueño cobra por WhatsApp. Los pedidos confirmados se mandan a fábrica en lotes, con un Excel.

Idioma de trabajo: **español**. Las decisiones del catálogo (qué desactivar, qué mover, qué precio poner) **las toma el dueño**: se proponen, no se aplican solas.

## Arquitectura

- Sitio estático en **GitHub Pages**, sin build: HTML, CSS y JS vanilla en cada archivo.
- **Catálogo:** `data/productos-<catalogo>.json` más `images/<catalogo>/<id>.jpg`. Los catálogos son `futbol`, `futbol-retro`, `futbol-jugador`, `futbol-ninos`, `futbol-fan`, `nba`, `f1` y `nfl-mlb`.
- **Pedidos:** Google Apps Script (`backend/Code.gs`) montado sobre una Google Sheet privada. **El repo es público**: nunca guardar datos de clientes aquí.
- `config.js` tiene `ORDER_API_URL` (la URL `/exec` del Apps Script) y el número de WhatsApp. Si `ORDER_API_URL` está vacío, la tienda vuelve al flujo antiguo de solo WhatsApp.

| Archivo | Rol |
|---|---|
| `index.html` | Tienda: catálogo, modal de personalización, carrito y checkout en 3 pasos (carrito, datos, confirmación con código). |
| `pedido.html` | Seguimiento del cliente, con código y email (`?c=CDH-XXXXX&e=correo`). |
| `pedidos.html` | Back office del dueño, entra con `ADMIN_KEY`. Resumen con gráficos, pedidos, confirmación de pagos, lote al proveedor (Excel con fotos vía ExcelJS) y descarga de la raw data. |
| `admin.html` | Editor del catálogo y de Parluki. Escribe en GitHub con un token personal. Ya existía; no se tocó salvo un aviso. |
| `backend/Code.gs` | API: `createOrder`, `status`, `adminList`, `adminSetStatus`, `adminConfirmPayment`, `adminSaveNote` y `adminMarkBatch`. |
| `backend/INSTALACION.md` | Guía paso a paso para el dueño. |
| `tests/` | Backend simulado que ejecuta el `Code.gs` real con stubs de Google, más una prueba end-to-end con Playwright. |
| `tools/auditoria/` | Auditoría del catálogo contra la descripción china del proveedor. |

## Modelo de datos (Google Sheet)

- **Pedidos:** Código, Fecha pedido, Cliente, Teléfono, Email, Método de pago, Total USD, Cant. camisas, Estado, Fecha confirmación pago, Lote proveedor, Fecha envío a proveedor, Notas internas, Última actualización.
- **Items:** una fila por línea del pedido. Código pedido, Línea, Tipo (`product`/`mystery`/`parluki`), Producto ID, Catálogo, Producto, Equipo, Descripción proveedor (original, en chino), Foto URL, Talla, Cantidad, Nombre estampado, Dorsal, Parche 1, Parche 2, Notas cliente, Precio unitario, Subtotal, Preferencia misterio, Detalle Parluki.
- **Historial:** cada cambio de estado.
- **Estados:** Pendiente de pago → Pago confirmado → Pedido al proveedor → En camino → Listo para entregar → Entregado. Además existe Cancelado. Cada cambio le manda un email al cliente (`MailApp`).

## Reglas de negocio (no cambiarlas sin preguntar)

- **Precio:** base del catálogo, +$2 si lleva nombre o dorsal, +$1 por parche (máximo 2). La Camiseta Misterio cuesta $25 y el token de Parluki $5. **El servidor recalcula el precio** leyendo los JSON publicados y rechaza el pedido si el total del navegador no coincide.
- **F1:** no se personaliza. **Los parches son solo para fútbol** (lo decidió el dueño).
- **Nombre a estampar:** mayúsculas, `A-ZÁÉÍÓÚÑÜ .'-`, máximo 14 caracteres. **Dorsal:** 1 o 2 dígitos. Los parches van en casillas separadas y el precio sale de las casillas llenas.
- **Datos del cliente:** nombre, teléfono, **correo** y método de pago son obligatorios. Los métodos son Zelle, USDT, Pago Móvil y Efectivo.
- **Pagos:** el dueño los gestiona directamente por WhatsApp. La web **solo registra el método**: no muestra instrucciones de pago y el cliente no reporta referencias.
- **Fecha de confirmación del pago:** la pone únicamente el dueño, con "Confirmar pago" en el back office.
- **Lote al proveedor:** incluye solo pedidos en "Pago confirmado" sin lote asignado. Primero se descarga el Excel y después se marca el lote como enviado. Los lotes anteriores se pueden volver a descargar.

## Decisiones técnicas y por qué

- **La clave de producto es la ruta de la foto (`uid = image`), no el `id`.** El mismo `id` aparece en varios catálogos, a veces con otro precio (por ejemplo, un NBA de $45 copiado en Futbol Fan a $27). Buscar por `id` agregaba el producto equivocado al carrito.
- **La descripción del proveedor (`raw`) viene doblemente mal codificada** (UTF-8 leído como Latin-1). `fixMojibake_` en `Code.gs` la recupera, y el Excel del proveedor la incluye porque es el texto que el proveedor entiende.
- **Camiseta Misterio:** se sortea en el cliente al agregarla, pero no se muestra ni en el carrito, ni en WhatsApp, ni en el seguimiento. El sorteo excluye las copias de Futbol Fan que duplican otros catálogos.
- **Excel del proveedor:** una fila por línea, con la foto incrustada, que es la única referencia inequívoca. Los encabezados están en inglés. Trae una hoja Summary por talla.
- **Apps Script:** las peticiones POST van con body de texto plano (sin preflight de CORS). Para actualizar el código se usa "Gestionar implementaciones → Nueva versión" y así la URL no cambia.

## Cómo probar

```bash
cd tests && npm install
node server.js            # sirve el sitio y ejecuta backend/Code.gs real en memoria (puerto 8765)
node e2e.js               # en otra terminal; CHROMIUM_PATH=/ruta/chrome si Playwright no trae navegador
```

La prueba cubre 16 verificaciones: validaciones de personalización, F1 y NBA sin parches, IDs duplicados, que la Misterio quede oculta, checkout obligatorio, precio manipulado, seguimiento, clave de administrador, confirmación de pago, Excel del proveedor y el lote. Deja capturas en `tests/shots/` y el Excel en `tests/proveedor.xlsx`.

## Estado actual

- [x] Checkout con registro, seguimiento, back office y Excel del proveedor (probado con el backend simulado).
- [ ] **Instalar el backend real.** Lo hace el dueño siguiendo `backend/INSTALACION.md` y pega la URL en `config.js`.
- [ ] **Depurar el catálogo.** El dueño revisa `tools/auditoria/salida/Auditoria catalogo - El Closet del Hincha.xlsx` y llena la columna **Decisión** (Desactivar / Mover / Renombrar / OK). Después, un script aplica esas decisiones a los JSON. Ese script todavía no existe.
- [ ] Corregir automáticamente los nombres de equipo con caracteres rotos (492 productos). Es seguro: usar `fix()` de `tools/auditoria/load.py`.
- [ ] **Tallas de Niños:** la tienda ofrece S-XXL, pero el proveedor usa 16-28. Falta que el dueño confirme la tabla de tallas de su proveedor.
- [ ] `admin.html` no valida nada al editar precios ni catálogos. Conviene reutilizar las reglas de la auditoría.

## Hallazgos de la auditoría (30 sep 2026, 8.255 productos activos)

2.630 productos tienen algún problema y 715 son de prioridad alta. Para volver a correrla: `cd tools/auditoria && python3 audit.py && python3 report.py` (requiere `openpyxl` y `Pillow`).

- **Futbol Fan:** 500 de sus 509 productos tienen problemas. 312 son de NBA vendidos a $27, 4 son de F1 y 179 son copias de otros catálogos.
- **Retro:** 494 productos son de temporadas 23/24 a 26/27, la mayoría versión jugador (球员).
- **Niños:** 73 de 129 parecen de adulto (la descripción dice S-4XL).
- **NFL/MLB:** 406 nombres ilegibles (chino mal codificado) y 129 productos de NBA.
- **Prendas:** 200 productos son shorts, pantalones o conjuntos, pero el nombre dice camiseta. Un caso: 牛仔裤 ("jean") se tradujo como "Cowboys".
- **Fotos:** 35 muestran el aviso "no disponible" de Yupoo y 17 no tienen archivo.
- **Datos:** 1.302 productos no tienen equipo asignado y 4.181 comparten nombre con otros productos distintos.
- Las reglas de detección y los falsos positivos ya corregidos están documentados en `tools/auditoria/audit.py`. Por ejemplo, 红牛 (Red Bull) aparece en Bragantino y Leipzig, que son fútbol, y 凯尔特人 puede ser el Celtic FC o los Boston Celtics.
