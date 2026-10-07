/**
 * Shop Billing Sync — Google Apps Script (standalone project).
 *
 * Receives every confirmed bill from the Voice Billing app and writes it into one Google Sheet,
 * "Shop Billing", kept in your Google Drive folder:
 *
 *   tab "Bills"       Sl No | Date | Bill ID | Grand Total        (Bill ID is a link to the bill's items)
 *   tab "Bill items"  Bill ID | SNo | Amt | Product name | Qty | T. Amount | Back
 *
 * ONE-TIME SETUP (full steps in cloud/SETUP.md)
 *   1. Put your Drive folder's ID in FOLDER_ID below (the last part of the folder's web address).
 *   2. Run `setup` once. It creates the sheet inside that folder, makes the two tabs, and creates a secret KEY.
 *      Read the sheet address and the KEY from the Execution log.
 *   3. Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone. Copy the Web app URL.
 *   4. Put the URL and the KEY into the app (Products tab > Google Sheet).
 *
 * Every request must carry the KEY. A bill whose Bill ID is already in the sheet is ignored, so the app can safely send
 * a bill again if it was not sure the first attempt arrived.
 */

var FOLDER_ID = 'PASTE_FOLDER_ID_HERE';   // <- your Drive folder ID (keep it out of public copies of this file)

var SHEET_TITLE = 'Shop Billing';
var BILLS = 'Bills';
var ITEMS = 'Bill items';
var BILLS_HEAD = ['Sl No', 'Date', 'Bill ID', 'Grand Total'];
var ITEMS_HEAD = ['Bill ID', 'SNo', 'Amt', 'Product name', 'Qty', 'T. Amount', 'Back'];
var MAX_ITEMS = 500;
var UNIT_LABELS = { KG: 'Kg', LTR: 'Ltr', PKT: 'Pkt', PCS: 'Pcs' };

// ---------------------------------------------------------------- setup (run once, by hand)

function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID'), ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);                       // already set up: do not create a second sheet
  } else {
    if (!FOLDER_ID || FOLDER_ID === 'PASTE_FOLDER_ID_HERE') {
      throw new Error('Put your Drive folder ID in FOLDER_ID at the top of the script, then run setup again.');
    }
    var folder = DriveApp.getFolderById(FOLDER_ID);         // fails clearly if the folder is wrong or not yours
    ss = SpreadsheetApp.create(SHEET_TITLE);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty('SHEET_ID', ss.getId());
  }
  prepareSheets(ss);
  var key = props.getProperty('KEY');
  if (!key) { key = makeKey(); props.setProperty('KEY', key); }   // created once; running setup again never changes it
  console.log('SHEET ADDRESS: ' + ss.getUrl());
  console.log('KEY (paste into the app): ' + key);
  return { url: ss.getUrl(), key: key };
}

function makeKey() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

// Creates the two tabs and their headings if they are missing. Safe to run any time.
function prepareSheets(ss) {
  var bills = ss.getSheetByName(BILLS);
  if (!bills) {
    var all = ss.getSheets();
    if (all.length === 1 && all[0].getName() === 'Sheet1' && all[0].getLastRow() === 0) bills = all[0].setName(BILLS);
    else bills = ss.insertSheet(BILLS, 0);
  }
  var items = ss.getSheetByName(ITEMS) || ss.insertSheet(ITEMS);
  heading(bills, BILLS_HEAD, [60, 100, 130, 110]);
  heading(items, ITEMS_HEAD, [130, 50, 80, 260, 90, 100, 80]);
  return { bills: bills, items: items };
}

function heading(sheet, names, widths) {
  if (sheet.getRange(1, 1).getValue() === names[0]) return;
  sheet.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

// ---------------------------------------------------------------- web app

// Opening the web address in a browser just shows that it is deployed; no data is returned.
// With a valid key it can also answer two READ-ONLY questions, as JSONP (a <script> tag, which browsers allow across
// sites). The app uses this only when the browser will not let it read the reply to a POST:
//   ?action=ping&key=K&callback=f            -> f({"ok":true,"url":...,"bills":N})
//   ?action=has&ids=a,b,c&key=K&callback=f   -> f({"ok":true,"has":{"a":true,"b":false,...}})
// Both may also carry "lastError" (what went wrong most recently inside the script), so the app can explain a refusal.
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.action) return json({ ok: true, service: 'shop-billing-sync' });
  var out;
  try { out = answer(p); } catch (err) { out = { ok: false, error: 'bad request' }; }
  return jsonp(out, p.callback);
}

function answer(p) {
  var denied = authorize(p.key);
  if (denied) return denied;
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  var sheets = prepareSheets(ss);
  if (p.action === 'ping') { var pong = { ok: true, url: ss.getUrl(), bills: Math.max(0, sheets.bills.getLastRow() - 1) }; addLastError(pong); return pong; }
  if (p.action === 'has') {
    var wanted = String(p.ids || '').split(',').filter(function (x) { return x; }).slice(0, 50);
    var last = sheets.bills.getLastRow();
    var have = {};
    (last > 1 ? sheets.bills.getRange(2, 3, last - 1, 1).getDisplayValues() : []).forEach(function (r) { have[r[0]] = true; });
    var has = {};
    wanted.forEach(function (id) { has[id] = !!have[id]; });
    var reply = { ok: true, has: has };
    addLastError(reply);
    return reply;
  }
  return { ok: false, error: 'unknown action' };
}

// null when the key is right, else the refusal to send back
function authorize(key) {
  var props = PropertiesService.getScriptProperties();
  var real = props.getProperty('KEY');
  if (!real || !props.getProperty('SHEET_ID')) return { ok: false, error: 'not set up: run setup() in the script first' };
  if (typeof key !== 'string' || !sameText(key, real)) return { ok: false, error: 'bad key' };
  return null;
}

// JSONP only for a plain function name, so nothing else can be injected into the page that loads it
function jsonp(obj, callback) {
  if (typeof callback === 'string' && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json(obj);
}

function doPost(e) {
  var out;
  try {
    var raw = e && e.postData && e.postData.contents;
    var body = JSON.parse(raw || '');
    out = handle(body);
  } catch (err) {
    out = { ok: false, error: 'bad request' };
  }
  return json(out);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle(body) {
  var denied = authorize(body && body.key);
  if (denied) return denied;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);                                    // two phones billing at once must not interleave
    var ss = SpreadsheetApp.openById(id);
    var sheets = prepareSheets(ss);
    if (body.action === 'ping') {
      var pong = { ok: true, url: ss.getUrl(), bills: Math.max(0, sheets.bills.getLastRow() - 1) };
      addLastError(pong);
      return pong;
    }
    if (body.action === 'bill') {
      var one = writeBill(ss, sheets, body.bill);
      if (one.error) return { ok: false, error: one.error };
      if (!one.duplicate) forgetError();
      return { ok: true, result: one };
    }
    if (body.action === 'bills') {
      if (!Array.isArray(body.bills) || body.bills.length > 200) return { ok: false, error: 'bills must be a list of at most 200' };
      var results = [], added = 0, duplicates = 0, failed = 0;
      body.bills.forEach(function (b) {
        var r = writeBill(ss, sheets, b);
        if (r.error) failed++; else if (r.duplicate) duplicates++; else added++;
        results.push(r);
      });
      if (added) forgetError();
      return { ok: true, added: added, duplicates: duplicates, failed: failed, results: results };
    }
    if (body.action === 'clear') return clearSheets(sheets);
    return { ok: false, error: 'unknown action' };
  } catch (err) {
    return recordError(body.action, err);                    // the owner can read this in Executions, and the app can show it
  } finally {
    lock.releaseLock();
  }
}

// Fresh start: removes every bill row from both tabs. The headings stay; nothing else in the file is touched.
function clearSheets(sheets) {
  var out = { bills: 0, items: 0 };
  [['bills', sheets.bills], ['items', sheets.items]].forEach(function (p) {
    var last = p[1].getLastRow();
    if (last > 1) {
      p[1].getRange(2, 1, last - 1, p[1].getMaxColumns()).clear();    // contents, links and formats; later writes set their own formats
      out[p[0]] = last - 1;
    }
  });
  forgetError();
  return { ok: true, cleared: out };
}

// ---- what went wrong last, so a bill the sheet did not take can be explained ----
function recordError(action, err) {
  var message = String(err && err.message ? err.message : err).slice(0, 300);
  console.error('Shop Billing Sync, action ' + action + ': ' + (err && err.stack ? err.stack : message));
  try {
    PropertiesService.getScriptProperties().setProperty('LAST_ERROR', JSON.stringify({ at: new Date().toISOString(), action: String(action), message: message }));
  } catch (e) { /* the answer below still carries the message */ }
  return { ok: false, error: 'script error: ' + message };
}

function forgetError() {
  try { PropertiesService.getScriptProperties().deleteProperty('LAST_ERROR'); } catch (e) { /* ignore */ }
}

// Adds { lastError: { action, message, ageSec } } when the last problem is recent. Only called for a valid key.
function addLastError(reply) {
  var raw = PropertiesService.getScriptProperties().getProperty('LAST_ERROR');
  if (!raw) return;
  try {
    var e = JSON.parse(raw);
    reply.lastError = { action: e.action, message: e.message, ageSec: Math.max(0, Math.round((Date.now() - Date.parse(e.at)) / 1000)) };
  } catch (err) { /* unreadable: leave it out */ }
}

// Constant-time comparison, so the KEY cannot be guessed from response timing.
function sameText(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- writing one bill

// bill = { id: '07102026-003', date: '2026-10-07', total: 574, items: [{name_en, name_ta, unit, qty, price, amount}] }
// Returns { id, duplicate:true } | { id, sl, itemsRow } | { id, error }.
function writeBill(ss, sheets, b) {
  var problem = check(b);
  if (problem) return { id: b && typeof b.id === 'string' ? b.id : '', error: problem };

  var bills = sheets.bills, items = sheets.items;
  var last = bills.getLastRow();                             // includes the heading row
  var ids = last > 1 ? bills.getRange(2, 3, last - 1, 1).getDisplayValues() : [];
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === b.id) return { id: b.id, duplicate: true };

  var sl = last;                                             // data rows so far + 1
  var billsRow = last + 1;
  var itemsRow = 0;

  // Items first, then the Bills row: a bill only counts as "in the sheet" once its Bills row exists.
  if (b.items && b.items.length) {
    var used = items.getLastRow();
    itemsRow = used <= 1 ? 2 : used + 2;                     // one blank row between bills
    var rows = b.items.map(function (it, n) {
      return [b.id, n + 1, it.price, safeText(productName(it)), formatQty(it.qty) + ' ' + unitLabel(it.unit), it.amount, ''];
    });
    rows.push([b.id, '', '', 'Grand Total', '', b.total, '']);
    items.getRange(itemsRow, 1, rows.length, 7).setValues(rows);
    items.getRange(itemsRow + rows.length - 1, 1, 1, 7).setFontWeight('bold');
    items.getRange(itemsRow, 3, rows.length, 1).setNumberFormat('0.00');
    items.getRange(itemsRow, 6, rows.length, 1).setNumberFormat('0.00');
    items.getRange(itemsRow, 7).setFormula(link('#gid=' + bills.getSheetId() + '&range=C' + billsRow, '↑ Bills'));
  }

  var day = Utilities.parseDate(b.date, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  bills.getRange(billsRow, 1, 1, 4).setValues([[sl, day, b.id, b.total]]);
  bills.getRange(billsRow, 2).setNumberFormat('dd-mm-yyyy');
  bills.getRange(billsRow, 4).setNumberFormat('0.00');
  if (itemsRow) bills.getRange(billsRow, 3).setFormula(link('#gid=' + items.getSheetId() + '&range=A' + itemsRow, b.id));

  return { id: b.id, sl: sl, itemsRow: itemsRow };
}

function link(target, label) {
  return '=HYPERLINK("' + target + '","' + label + '")';
}

// A name that starts with = + - @ would be run as a formula; the leading apostrophe keeps it as plain text.
function safeText(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function productName(it) { return it.name_ta ? it.name_en + ' - ' + it.name_ta : it.name_en; }
function unitLabel(u) { u = String(u || '').toUpperCase(); return UNIT_LABELS[u] || u; }
function formatQty(q) { return String(Math.round(q * 1000) / 1000); }

// Returns '' when the bill is fine, else what is wrong with it.
function check(b) {
  if (!b || typeof b !== 'object') return 'no bill';
  if (typeof b.id !== 'string' || !/^\d{8}-\d{3,}$/.test(b.id)) return 'bad bill id';
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !realDate(b.date)) return 'bad date';
  // the Bill ID is DDMMYYYY-NNN built from the bill's own date, so a mixed-up or old-style ID is refused
  if (b.id.slice(0, 8) !== b.date.slice(8, 10) + b.date.slice(5, 7) + b.date.slice(0, 4)) return 'bill id does not match its date';
  if (typeof b.total !== 'number' || !isFinite(b.total) || b.total < 0) return 'bad total';
  if (b.items === undefined || b.items === null) return '';
  if (!Array.isArray(b.items) || b.items.length > MAX_ITEMS) return 'bad items';
  for (var i = 0; i < b.items.length; i++) {
    var it = b.items[i];
    if (!it || typeof it.name_en !== 'string' || !it.name_en) return 'bad item name';
    if (typeof it.qty !== 'number' || !(it.qty > 0)) return 'bad item qty';
    if (typeof it.price !== 'number' || !isFinite(it.price) || it.price < 0) return 'bad item price';
    if (typeof it.amount !== 'number' || !isFinite(it.amount) || it.amount < 0) return 'bad item amount';
  }
  return '';
}

function realDate(iso) {
  var y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10), t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
