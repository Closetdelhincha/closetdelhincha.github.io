# Instalación del sistema de pedidos: El Closet del Hincha

Tiempo estimado: 15 minutos. Todo se hace con la **cuenta de Google del negocio**.

## Qué hace cada pieza

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La tienda. Tiene carrito y checkout con nombre, teléfono, correo y método de pago obligatorios. Cada pedido se registra y recibe un código `CDH-XXXXX`. |
| `pedido.html` | La página donde el cliente consulta el estado de su pedido. |
| `pedidos.html` | Tu back office: resumen visual, confirmación de pagos, cambio de estados, Excel para el proveedor con fotos y descarga de la raw data. |
| `config.js` | Aquí va la URL de tu backend. |
| `backend/Code.gs` | El backend. Vive dentro de una Google Sheet, y esa Sheet es tu **raw data**. |

## Paso 1: Crear la Google Sheet

1. Entra a sheets.google.com y crea una hoja en blanco. Llámala `Closet del Hincha - Pedidos`.
2. Ve al menú **Extensiones → Apps Script**.
3. Borra todo lo que aparece en el editor, pega el contenido completo de `backend/Code.gs` y guarda.

## Paso 2: Configuración opcional

El bloque `CONFIG` al principio del código ya viene listo. Si quieres recibir un correo con cada pedido nuevo, pon tu correo en `OWNER_EMAIL` y guarda. No hay datos de pago que llenar: el cliente solo elige el método y tú coordinas el cobro por WhatsApp.

## Paso 3: Ejecutar `setup` una sola vez

1. Arriba, en el selector de funciones, elige `setup` y pulsa **Ejecutar**.
2. Google te va a pedir permisos. Aparece "Google no verificó esta app" porque la app es tuya: entra en **Configuración avanzada** y luego en **Ir a (nombre del proyecto)**, y pulsa **Permitir**.
3. En el **Registro de ejecución** aparece `Tu clave de administrador es: ...`. **Cópiala y guárdala.** La vas a necesitar para entrar al back office.

Al terminar, la hoja tiene tres pestañas: **Pedidos**, **Items** e **Historial**.

## Paso 4: Publicar el backend

1. Pulsa **Implementar → Nueva implementación**.
2. En el engranaje, elige el tipo **Aplicación web**.
3. En **Ejecutar como**, elige **Yo**. En **Quién tiene acceso**, elige **Cualquier persona**.
4. Pulsa **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).

> Cada vez que modifiques el código, ve a **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Así la URL se mantiene igual. Si creas una implementación nueva, la URL cambia y la tienda deja de registrar pedidos.

## Paso 5: Conectar la tienda

1. Abre `config.js` y pega la URL en `ORDER_API_URL: '...'`.
2. Sube `index.html`, `pedido.html`, `pedidos.html`, `config.js` y la carpeta `backend/` a tu repositorio de GitHub.
3. Espera 1 o 2 minutos a que GitHub Pages publique los cambios.

Mientras `ORDER_API_URL` esté vacío, la tienda sigue mandando los pedidos por WhatsApp como antes. La tienda no se rompe en ningún momento de la instalación.

## Paso 6: Prueba real

1. Haz un pedido de prueba en la tienda con tu propio correo.
2. Revisa que llegó el correo y que aparece una fila en la pestaña **Pedidos** de la Sheet.
3. Entra a `https://closetdelhincha.github.io/pedidos.html`, pega la clave de administrador y confirma el pago del pedido de prueba.
4. En la pestaña **Proveedor**, descarga el Excel y ábrelo.
5. Cuando termines, borra el pedido de prueba de la Sheet: su fila en **Pedidos** y sus filas en **Items**.

## Flujo diario

1. El cliente hace el pedido y elige su método de pago (Zelle, USDT, Pago Móvil o Efectivo). El pedido queda en **Pendiente de pago** y el cliente recibe un correo con su código.
2. Coordinas el cobro por WhatsApp. El teléfono del cliente en el back office es un link directo a su chat.
3. Cuando verificas el pago, pulsas **Confirmar pago**. Ahí se graba la **fecha de confirmación del pago**. Esa fecha la pones tú, nunca el cliente.
4. En **Proveedor**, descargas el Excel del lote y se lo mandas a tu proveedor. Después pulsas **Marcar lote como enviado**.
5. Vas cambiando el estado a **En camino**, **Listo para entregar** y **Entregado**. Cada cambio le manda un correo al cliente.

## Límites que debes conocer

- **Correos:** una cuenta Gmail gratuita envía alrededor de 100 correos al día desde Apps Script, y cada pedido gasta hasta 6 a lo largo de su vida (uno por cada cambio de estado). Eso alcanza para unos 16 pedidos al día. Si pasas de eso, necesitas Google Workspace.
- **Velocidad:** registrar un pedido tarda entre 2 y 4 segundos, porque el servidor vuelve a leer el catálogo para verificar el precio real. Eso es a propósito: nadie puede pagarte menos manipulando el navegador.
- **Clave de administrador:** si se filtra, cámbiala en Apps Script, en **Configuración del proyecto → Propiedades de la secuencia de comandos → `ADMIN_KEY`**.
