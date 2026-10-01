// Configuracion compartida por la tienda (index.html), el seguimiento (pedido.html) y el back office (pedidos.html).
// ORDER_API_URL: pega aqui la URL de tu Apps Script desplegado como "Aplicacion web" (termina en /exec).
// Mientras este vacio, la tienda sigue enviando los pedidos por WhatsApp como antes.
window.CDH_CONFIG = {
  ORDER_API_URL: 'https://script.google.com/macros/s/AKfycbyBK2e3_k7_Cv6AfNftD0f4TRzbJQr8hOlMOilaHnMDrM0YV0JnupLP5DPWkaf5Yn3M/exec',
  WHATSAPP_NUMBER: '584242132028'
};