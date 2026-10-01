/**
 * El Closet del Hincha - Backend de pedidos (Google Apps Script)
 * ----------------------------------------------------------------
 * Vive dentro de una Google Sheet. Esa hoja ES tu raw data:
 *   - "Pedidos": una fila por pedido (cliente, metodo de pago, estado, fechas)
 *   - "Items":   una fila por linea del pedido (producto, talla, nombre, dorsal, parches...)
 *   - "Historial": cada cambio de estado, con fecha
 *
 * Instalacion: ver backend/INSTALACION.md
 */

// ====== CONFIGURACION (edita esto) ======
var CONFIG = {
  SITE_URL: 'https://closetdelhincha.github.io',   // de aqui se leen los catalogos para verificar precios
  STORE_NAME: 'El Closet del Hincha',
  WHATSAPP_NUMBER: '584242132028',
  SEND_EMAILS: true,                                // emails automaticos al cliente en cada cambio de estado
  OWNER_EMAIL: ''                                   // opcional: te llega copia de cada pedido nuevo
};

// Reglas de precio (deben coincidir con la tienda)
var PRICE_RULES = { CUSTOM_NAME_OR_NUMBER: 2, PER_PATCH: 1, MAX_PATCHES: 2, MYSTERY: 25, PARLUKI_TOKEN: 5 };
var PAYMENT_METHODS = ['Zelle', 'USDT', 'Pago Movil', 'Efectivo'];
// Los pagos los gestiona el dueno directamente (WhatsApp). El cliente solo elige el metodo.
var STATUSES = [
  'Pendiente de pago',
  'Pago confirmado',
  'Pedido al proveedor',
  'En camino',
  'Listo para entregar',
  'Entregado',
  'Cancelado'
];
var CATALOG_FILES = ['futbol', 'futbol-retro', 'futbol-jugador', 'futbol-ninos', 'futbol-fan', 'nba', 'f1', 'nfl-mlb'];

var SHEETS = {
  Pedidos: ['Codigo', 'Fecha pedido', 'Cliente', 'Telefono', 'Email', 'Metodo de pago', 'Total USD', 'Cant. camisas',
            'Estado', 'Fecha confirmacion pago', 'Lote proveedor',
            'Fecha envio a proveedor', 'Notas internas', 'Ultima actualizacion'],
  Items: ['Codigo pedido', 'Linea', 'Tipo', 'Producto ID', 'Catalogo', 'Producto', 'Equipo', 'Descripcion proveedor (original)',
          'Foto URL', 'Talla', 'Cantidad', 'Nombre estampado', 'Dorsal', 'Parche 1', 'Parche 2', 'Notas cliente',
          'Precio unitario USD', 'Subtotal USD', 'Preferencia misterio', 'Detalle Parluki'],
  Historial: ['Fecha', 'Codigo', 'Estado anterior', 'Estado nuevo', 'Detalle']
};

// ====== SETUP (correr UNA vez desde el editor) ======
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SHEETS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#14161a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) {
    var key = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('ADMIN_KEY', key);
  }
  Logger.log('Listo. Tu clave de administrador es: ' + props.getProperty('ADMIN_KEY'));
  Logger.log('Guardala: la vas a pegar en pedidos.html la primera vez que entres.');
}

// ====== HTTP ======
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'status') return json_(publicStatus_(p.code, p.email));
  return json_({ ok: true, service: CONFIG.STORE_NAME + ' pedidos' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'JSON invalido' }); }
  try {
    switch (body.action) {
      case 'createOrder': return json_(createOrder_(body.order || {}));
      case 'status': return json_(publicStatus_(body.code, body.email));
      // ---- admin ----
      case 'adminList': requireAdmin_(body); return json_(adminList_());
      case 'adminSetStatus': requireAdmin_(body); return json_(adminSetStatus_(body.code, body.status, body.detail));
      case 'adminConfirmPayment': requireAdmin_(body); return json_(adminSetStatus_(body.code, 'Pago confirmado', 'Pago verificado'));
      case 'adminSaveNote': requireAdmin_(body); return json_(adminSaveNote_(body.code, body.note));
      case 'adminMarkBatch': requireAdmin_(body); return json_(adminMarkBatch_(body.codes || [], body.batch));
      default: return json_({ ok: false, error: 'Accion desconocida' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function requireAdmin_(body) {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key || body.key !== key) throw new Error('Clave de administrador incorrecta');
}

// ====== VALIDACION ======
function clean_(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200); }

function validateCustomer_(o) {
  var name = clean_(o.name, 80), phone = clean_(o.phone, 30), email = clean_(o.email, 120).toLowerCase();
  var method = clean_(o.paymentMethod, 20);
  if (name.length < 2) throw new Error('Falta el nombre');
  var digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new Error('Telefono invalido');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Email invalido');
  if (PAYMENT_METHODS.indexOf(method) < 0) throw new Error('Metodo de pago invalido');
  return { name: name, phone: phone, email: email, paymentMethod: method };
}

var NAME_RE = /^[A-ZÁÉÍÓÚÑÜ .'\-]{1,14}$/;
var NUMBER_RE = /^\d{1,2}$/;

// Carga los catalogos necesarios desde la pagina publicada para no confiar en el precio que manda el navegador
function loadCatalogs_(files) {
  var out = {};
  files.forEach(function (f) {
    if (CATALOG_FILES.indexOf(f) < 0) throw new Error('Catalogo desconocido: ' + f);
    var res = UrlFetchApp.fetch(CONFIG.SITE_URL + '/data/productos-' + f + '.json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('No se pudo leer el catalogo ' + f);
    var byImage = {};
    JSON.parse(res.getContentText()).forEach(function (p) { byImage[p.image] = p; });
    out[f] = byImage;
  });
  return out;
}

// Arregla el texto chino que quedo mal codificado en el campo "raw" (UTF-8 leido como Latin-1, a veces dos veces)
function fixMojibake_(s) {
  s = String(s || '');
  for (var i = 0; i < 2; i++) {
    if (!/[À-ÿ]/.test(s)) break;
    try {
      var bytes = [];
      for (var j = 0; j < s.length; j++) {
        var c = s.charCodeAt(j);
        if (c > 255) return s;
        bytes.push(c > 127 ? c - 256 : c);
      }
      var decoded = Utilities.newBlob(bytes).getDataAsString('UTF-8');
      if (decoded.indexOf('�') >= 0) break;
      s = decoded;
    } catch (e) { break; }
  }
  return s;
}

function buildItems_(rawItems) {
  if (!rawItems || !rawItems.length) throw new Error('El carrito esta vacio');
  if (rawItems.length > 40) throw new Error('Demasiadas lineas en un pedido');
  var files = {};
  rawItems.forEach(function (it) {
    if (it.type === 'product') files[it.catalog] = true;
    if (it.type === 'mystery' && it.mysteryPick) files[it.mysteryPick.catalog] = true;
  });
  var catalogs = loadCatalogs_(Object.keys(files));

  function findProduct(catalog, image) {
    var p = catalogs[catalog] && catalogs[catalog][image];
    if (!p) throw new Error('Producto no encontrado en el catalogo (' + image + ')');
    return p;
  }

  return rawItems.map(function (it) {
    var qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    var base = { type: it.type, qty: qty, size: clean_(it.size, 10), customName: '', customNumber: '', patch1: '', patch2: '',
                 notes: clean_(it.notes, 300), mysteryPref: '', parluki: '' };
    if (it.type === 'product') {
      var p = findProduct(it.catalog, it.image);
      if (p.sizes && p.sizes.indexOf(base.size) < 0) throw new Error('Talla ' + base.size + ' no disponible para ' + p.name);
      var cname = clean_(it.customName, 20).toUpperCase(), cnum = clean_(it.customNumber, 3);
      if (cname && !NAME_RE.test(cname)) throw new Error('Nombre a estampar invalido: ' + cname);
      if (cnum && !NUMBER_RE.test(cnum)) throw new Error('Dorsal invalido: ' + cnum);
      var patches = (it.patches || []).map(function (x) { return clean_(x, 40); }).filter(String).slice(0, PRICE_RULES.MAX_PATCHES);
      var customizable = p.league !== 'F1';
      if (!customizable && (cname || cnum || patches.length)) throw new Error('Los productos de F1 no se personalizan');
      if (p.league !== 'Futbol' && patches.length) throw new Error('Los parches solo aplican a futbol');
      var unit = p.price + ((cname || cnum) ? PRICE_RULES.CUSTOM_NAME_OR_NUMBER : 0) + patches.length * PRICE_RULES.PER_PATCH;
      return merge_(base, { productId: p.id, catalog: it.catalog, name: p.name, team: p.team || '', raw: fixMojibake_(p.raw),
                            image: p.image, customName: cname, customNumber: cnum, patch1: patches[0] || '', patch2: patches[1] || '',
                            unit: unit });
    }
    if (it.type === 'mystery') {
      if (!it.mysteryPick) throw new Error('Camiseta misterio sin seleccion');
      var m = findProduct(it.mysteryPick.catalog, it.mysteryPick.image);
      if (m.sizes && m.sizes.indexOf(base.size) < 0) throw new Error('La camiseta misterio no tiene talla ' + base.size + '. Vuelve a agregarla.');
      return merge_(base, { productId: m.id, catalog: it.mysteryPick.catalog, name: 'MISTERIO -> ' + m.name, team: m.team || '',
                            raw: fixMojibake_(m.raw), image: m.image, mysteryPref: clean_(it.mysteryPref, 80), unit: PRICE_RULES.MYSTERY });
    }
    if (it.type === 'parluki') {
      var picks = (it.parlukiPicks || []).slice(0, 5).map(function (x) {
        return clean_(x.home, 40) + ' ' + (parseInt(x.scoreHome, 10) || 0) + '-' + (parseInt(x.scoreAway, 10) || 0) + ' ' + clean_(x.away, 40);
      }).join(' | ');
      return merge_(base, { productId: 'parluki', catalog: '', name: 'Parluki - Prediccion', team: '', raw: '', image: '', size: '-',
                            parluki: (it.parlukiHasToken ? '[Token ya pago] ' : '[Token nuevo] ') + picks,
                            unit: it.parlukiHasToken ? 0 : PRICE_RULES.PARLUKI_TOKEN, qty: 1 });
    }
    throw new Error('Tipo de producto desconocido');
  });
}

function merge_(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }

// ====== ACCIONES PUBLICAS ======
function createOrder_(order) {
  if (order.website) throw new Error('Spam'); // honeypot
  var c = validateCustomer_(order.customer || {});
  var items = buildItems_(order.items);
  var total = 0, shirts = 0;
  items.forEach(function (it) { total += it.unit * it.qty; if (it.type !== 'parluki') shirts += it.qty; });
  if (order.clientTotal != null && Number(order.clientTotal) !== total) {
    throw new Error('El total cambio (precio actualizado: $' + total + '). Recarga la pagina e intenta de nuevo.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ped = ss.getSheetByName('Pedidos'), its = ss.getSheetByName('Items');
    var code = newCode_(ped);
    var now = new Date();
    ped.appendRow([code, now, c.name, "'" + c.phone, c.email, c.paymentMethod, total, shirts, STATUSES[0], '', '', '', '', now]);
    var rows = items.map(function (it, i) {
      return [code, i + 1, it.type, it.productId, it.catalog, it.name, it.team, it.raw, it.image ? CONFIG.SITE_URL + '/' + it.image : '',
              it.size, it.qty, it.customName, it.customNumber ? "'" + it.customNumber : '', it.patch1, it.patch2, it.notes,
              it.unit, it.unit * it.qty, it.mysteryPref, it.parluki];
    });
    its.getRange(its.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    log_(code, '', STATUSES[0], 'Pedido creado');
  } finally { lock.releaseLock(); }

  var result = { ok: true, code: code, total: total, paymentMethod: c.paymentMethod };
  sendStatusEmail_(code, c, STATUSES[0], total, items);
  if (CONFIG.OWNER_EMAIL) {
    try { MailApp.sendEmail(CONFIG.OWNER_EMAIL, 'Nuevo pedido ' + code + ' - $' + total, c.name + ' / ' + c.phone + ' / ' + c.paymentMethod + '\n' + shirts + ' camisa(s)'); } catch (e) {}
  }
  return result;
}

function newCode_(sheet) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var existing = {};
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[r[0]] = true; });
  for (var tries = 0; tries < 50; tries++) {
    var s = 'CDH-';
    for (var i = 0; i < 5; i++) s += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    if (!existing[s]) return s;
  }
  throw new Error('No se pudo generar codigo');
}

function findOrderRow_(code) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Pedidos');
  var n = sh.getLastRow() - 1;
  if (n < 1) return null;
  var vals = sh.getRange(2, 1, n, SHEETS.Pedidos.length).getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][0] === code) return { sheet: sh, row: i + 2, values: vals[i] };
  return null;
}

function col_(name) { return SHEETS.Pedidos.indexOf(name) + 1; }

function publicStatus_(code, email) {
  code = clean_(code, 20).toUpperCase(); email = clean_(email, 120).toLowerCase();
  var f = findOrderRow_(code);
  if (!f || String(f.values[4]).toLowerCase() !== email) return { ok: false, error: 'No encontramos un pedido con ese codigo y email' };
  var items = itemsFor_(code).map(function (it) {
    return { name: it['Tipo'] === 'mystery' ? 'Camiseta Misterio' : it['Producto'], size: it['Talla'], qty: it['Cantidad'],
             customName: it['Nombre estampado'], customNumber: String(it['Dorsal'] || ''), patches: [it['Parche 1'], it['Parche 2']].filter(String),
             image: it['Tipo'] === 'mystery' ? '' : it['Foto URL'] };
  });
  return { ok: true, code: code, status: f.values[8], statuses: STATUSES, total: f.values[6], paymentMethod: f.values[5],
           createdAt: f.values[1], items: items };
}

// ====== ADMIN ======
function itemsFor_(code) { return readSheet_('Items').filter(function (r) { return r['Codigo pedido'] === code; }); }

function readSheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var headers = SHEETS[name];
  return sh.getRange(2, 1, n, headers.length).getValues().map(function (r) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
    return o;
  });
}

function adminList_() {
  return { ok: true, statuses: STATUSES, paymentMethods: PAYMENT_METHODS, orders: readSheet_('Pedidos'), items: readSheet_('Items'), siteUrl: CONFIG.SITE_URL };
}

function adminSetStatus_(code, status, detail) {
  if (STATUSES.indexOf(status) < 0) throw new Error('Estado invalido');
  var f = findOrderRow_(code);
  if (!f) throw new Error('Pedido no encontrado: ' + code);
  var prev = f.values[8];
  var now = new Date();
  f.sheet.getRange(f.row, col_('Estado')).setValue(status);
  f.sheet.getRange(f.row, col_('Ultima actualizacion')).setValue(now);
  // La fecha de confirmacion de pago solo la pone el dueno, la primera vez que confirma
  if (status === 'Pago confirmado' && !f.values[col_('Fecha confirmacion pago') - 1]) {
    f.sheet.getRange(f.row, col_('Fecha confirmacion pago')).setValue(now);
  }
  log_(code, prev, status, detail || '');
  if (prev !== status) {
    var cust = { name: f.values[2], email: f.values[4], paymentMethod: f.values[5] };
    sendStatusEmail_(code, cust, status, f.values[6], null);
  }
  return { ok: true, code: code, status: status };
}

function adminSaveNote_(code, note) {
  var f = findOrderRow_(code);
  if (!f) throw new Error('Pedido no encontrado');
  f.sheet.getRange(f.row, col_('Notas internas')).setValue(clean_(note, 500));
  return { ok: true };
}

function adminMarkBatch_(codes, batch) {
  batch = clean_(batch, 40);
  if (!batch) throw new Error('Falta el nombre del lote');
  var now = new Date(), done = [];
  codes.forEach(function (code) {
    var f = findOrderRow_(code);
    if (!f || f.values[8] !== 'Pago confirmado') return; // solo pedidos pagados entran al lote
    f.sheet.getRange(f.row, col_('Lote proveedor')).setValue(batch);
    f.sheet.getRange(f.row, col_('Fecha envio a proveedor')).setValue(now);
    adminSetStatus_(code, 'Pedido al proveedor', 'Lote ' + batch);
    done.push(code);
  });
  return { ok: true, batch: batch, codes: done };
}

function log_(code, prev, next, detail) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Historial').appendRow([new Date(), code, prev, next, detail]);
}

// ====== EMAIL ======
var STATUS_MSG = {
  'Pendiente de pago': 'Recibimos tu pedido. Te escribimos por WhatsApp para coordinar el pago.',
  'Pago confirmado': 'Tu pago fue confirmado. Tu pedido entra en el proximo lote a fabrica.',
  'Pedido al proveedor': 'Tu pedido ya fue enviado a fabrica.',
  'En camino': 'Tu pedido esta en camino a Venezuela.',
  'Listo para entregar': 'Tu pedido llego. Te escribimos por WhatsApp para coordinar la entrega.',
  'Entregado': 'Pedido entregado. Gracias por comprar en ' + CONFIG.STORE_NAME + '!',
  'Cancelado': 'Tu pedido fue cancelado. Si tienes dudas escribenos por WhatsApp.'
};

function sendStatusEmail_(code, cust, status, total, items) {
  if (!CONFIG.SEND_EMAILS || !cust.email) return;
  var link = CONFIG.SITE_URL + '/pedido.html?c=' + encodeURIComponent(code) + '&e=' + encodeURIComponent(cust.email);
  var html = '<div style="font-family:Arial,sans-serif;max-width:520px">' +
    '<h2 style="margin:0 0 4px">' + CONFIG.STORE_NAME + '</h2>' +
    '<p>Hola ' + esc_(cust.name) + ',</p>' +
    '<p><b>Pedido ' + code + '</b> - Estado: <b>' + status + '</b></p>' +
    '<p>' + STATUS_MSG[status] + '</p>';
  if (status === 'Pendiente de pago') {
    html += '<p><b>Total: $' + total + '</b> - Metodo de pago: ' + esc_(cust.paymentMethod) + '</p>';
    if (items) {
      html += '<ul>' + items.map(function (it) {
        var d = (it.type === 'mystery' ? 'Camiseta Misterio' : esc_(it.name)) + ' - Talla ' + esc_(it.size) + ' x' + it.qty;
        if (it.customName) d += ' - Nombre: ' + esc_(it.customName);
        if (it.customNumber) d += ' - Dorsal: ' + esc_(it.customNumber);
        if (it.patch1) d += ' - Parches: ' + esc_([it.patch1, it.patch2].filter(String).join(', '));
        return '<li>' + d + '</li>';
      }).join('') + '</ul>';
    }
  }
  html += '<p><a href="' + link + '">Ver el estado de tu pedido</a></p></div>';
  try {
    MailApp.sendEmail({ to: cust.email, subject: CONFIG.STORE_NAME + ' - Pedido ' + code + ': ' + status, htmlBody: html, name: CONFIG.STORE_NAME });
  } catch (e) { Logger.log('Email fallo: ' + e); }
}

function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
