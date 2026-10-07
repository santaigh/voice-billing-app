// node test/cloud-script.test.js
// Runs cloud/Code.gs (the Google Apps Script) in Node against fake Google objects (Sheets, Drive, locks, properties).
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'Code.gs'), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

// ---------------------------------------------------------------- fakes
function makeEnv(opts) {
  opts = opts || {};
  const st = { spreadsheets: [], moved: [], props: {}, locks: { acquired: 0, released: 0 }, logs: [], uuid: 0, sheetId: 100, failSetValues: false,
               folders: opts.folders || ['folder123'], parseDate: [] };

  class Range {
    constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr: nr || 1, nc: nc || 1 }); }
    each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.sheet.cell(this.r + i, this.c + j), i, j); return this; }
    setValues(v) {
      if (st.failSetValues) { st.failSetValues = false; throw new Error('boom'); }
      return this.each((cell, i, j) => { cell.value = v[i][j]; cell.formula = null; });
    }
    setValue(v) { return this.each(cell => { cell.value = v; cell.formula = null; }); }
    getValue() { const c = this.sheet.cells[this.r + ',' + this.c]; return c ? c.value : ''; }
    getDisplayValues() { const out = []; this.each((cell, i, j) => { (out[i] = out[i] || [])[j] = cell.value === undefined || cell.value === null ? '' : String(cell.value); }); return out; }
    setFormula(f) {
      const m = /^=HYPERLINK\("([^"]*)","([^"]*)"\)$/.exec(f);
      return this.each(cell => { cell.formula = f; cell.value = m ? m[2] : f; });        // a link shows its label
    }
    setNumberFormat(f) { return this.each(cell => { cell.format = f; }); }
    setFontWeight(w) { return this.each(cell => { cell.bold = w === 'bold'; }); }
  }

  class Sheet {
    constructor(name) { this.name = name; this.id = st.sheetId++; this.cells = {}; this.frozen = 0; this.widths = {}; }
    cell(r, c) { return this.cells[r + ',' + c] || (this.cells[r + ',' + c] = { value: '', formula: null, format: null, bold: false }); }
    getName() { return this.name; }
    setName(nm) { this.name = nm; return this; }
    getSheetId() { return this.id; }
    getLastRow() { let last = 0; Object.keys(this.cells).forEach(k => { const v = this.cells[k].value; if (v !== '' && v !== undefined && v !== null) last = Math.max(last, +k.split(',')[0]); }); return last; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    setFrozenRows(x) { this.frozen = x; }
    setColumnWidth(c, w) { this.widths[c] = w; }
    row(r, cols) { const out = []; for (let c = 1; c <= (cols || 7); c++) out.push(this.cells[r + ',' + c] ? this.cells[r + ',' + c].value : ''); return out; }
  }

  class Spreadsheet {
    constructor(title) { this.title = title; this.id = 'ss' + (st.spreadsheets.length + 1); this.sheets = [new Sheet('Sheet1')]; }
    getId() { return this.id; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
    getSpreadsheetTimeZone() { return 'Asia/Kolkata'; }
    getSheets() { return this.sheets.slice(); }
    getSheetByName(nm) { return this.sheets.filter(s => s.name === nm)[0] || null; }
    insertSheet(nm, idx) { const s = new Sheet(nm); this.sheets.splice(idx === undefined ? this.sheets.length : idx, 0, s); return s; }
  }

  const SpreadsheetApp = {
    create(title) { const s = new Spreadsheet(title); st.spreadsheets.push(s); return s; },
    openById(id) { const s = st.spreadsheets.filter(x => x.id === id)[0]; if (!s) throw new Error('no such spreadsheet'); return s; }
  };
  const DriveApp = {
    getFolderById(id) { if (st.folders.indexOf(id) < 0) throw new Error('Folder not found: ' + id); return { id }; },
    getFileById(id) { return { moveTo(folder) { st.moved.push({ file: id, folder: folder.id }); } }; }
  };
  const PropertiesService = { getScriptProperties() { return { getProperty: k => (k in st.props ? st.props[k] : null), setProperty: (k, v) => { st.props[k] = v; } }; } };
  const LockService = { getScriptLock() { return { waitLock() { st.locks.acquired++; }, releaseLock() { st.locks.released++; } }; } };
  const ContentService = {
    MimeType: { JSON: 'JSON', JAVASCRIPT: 'JAVASCRIPT' },
    createTextOutput(text) { return { text, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; } }; }
  };
  const Utilities = {
    getUuid() { const h = (++st.uuid * 2654435761 >>> 0).toString(16).padStart(8, '0'); return h + '-aaaa-4bbb-8ccc-' + h + h.slice(0, 4); },
    parseDate(s, tz, fmt) { st.parseDate.push([s, tz, fmt]); const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) - 5.5 * 3600 * 1000); }   // midnight in Asia/Kolkata
  };
  const sandbox = { console: { log: m => st.logs.push(String(m)) }, SpreadsheetApp, DriveApp, PropertiesService, LockService, ContentService, Utilities };
  return { st, sandbox };
}

// loads the script; folderId replaces the placeholder (as the owner does)
function load(env, folderId) {
  const code = folderId ? SOURCE.replace('PASTE_FOLDER_ID_HERE', folderId) : SOURCE;
  vm.createContext(env.sandbox);
  vm.runInContext(code, env.sandbox);
  const sb = env.sandbox;
  return {
    sb,
    post: body => JSON.parse(sb.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
    get: () => JSON.parse(sb.doGet().getContent()),
    getRaw: params => sb.doGet({ parameter: params })
  };
}

// a ready environment: folder known, setup() run, KEY known
function ready() {
  const env = makeEnv(), app = load(env, 'folder123');
  const r = app.sb.setup();
  const ss = env.st.spreadsheets[0];
  return { env, app, key: r.key, ss, bills: ss.getSheetByName('Bills'), items: ss.getSheetByName('Bill items') };
}

const item = (name_en, name_ta, unit, qty, price) => ({ name_en, name_ta, unit, qty, price, amount: Math.round(qty * price * 100) / 100 });
const bill = (id, date, total, items) => Object.assign({ id, date, total }, items ? { items } : {});
const MAIDA = item('Maida', 'மைதா', 'KG', 2, 42), SUGAR = item('Sugar', 'சர்க்கரை', 'KG', 1, 48);

// ---------------------------------------------------------------- setup()
t('setup refuses to run until the Drive folder ID is filled in', () => {
  const env = makeEnv(), app = load(env);
  assert.throws(() => app.sb.setup(), /FOLDER_ID/);
  assert.strictEqual(env.st.spreadsheets.length, 0);
});

t('setup with a wrong folder fails clearly and leaves nothing half-made', () => {
  const env = makeEnv(), app = load(env, 'wrong-folder');
  assert.throws(() => app.sb.setup(), /Folder not found/);
  assert.strictEqual(env.st.spreadsheets.length, 0); assert.deepStrictEqual(env.st.props, {});
});

t('setup creates "Shop Billing" inside the folder, with both tabs and headings, and a random KEY', () => {
  const { env, key, ss, bills, items } = ready();
  assert.strictEqual(env.st.spreadsheets.length, 1); assert.strictEqual(ss.title, 'Shop Billing');
  assert.deepStrictEqual(env.st.moved, [{ file: ss.id, folder: 'folder123' }]);        // inside the owner's folder
  assert.deepStrictEqual(ss.sheets.map(s => s.name), ['Bills', 'Bill items']);          // Sheet1 became "Bills"
  assert.deepStrictEqual(bills.row(1, 4), ['Sl No', 'Date', 'Bill ID', 'Grand Total']);
  assert.deepStrictEqual(items.row(1, 7), ['Bill ID', 'SNo', 'Amt', 'Product name', 'Qty', 'T. Amount', 'Back']);
  assert.ok(bills.cells['1,1'].bold && items.cells['1,4'].bold); assert.strictEqual(bills.frozen, 1); assert.strictEqual(items.frozen, 1);
  assert.match(key, /^[0-9a-f]{64}$/); assert.strictEqual(env.st.props.KEY, key); assert.strictEqual(env.st.props.SHEET_ID, ss.id);
  assert.ok(env.st.logs.some(l => l.includes(ss.getUrl())) && env.st.logs.some(l => l.includes(key)), 'address and KEY are printed for the owner');
});

t('running setup again changes nothing: same sheet, same KEY, no second file', () => {
  const { env, app, key } = ready();
  const again = app.sb.setup();
  assert.strictEqual(again.key, key); assert.strictEqual(env.st.spreadsheets.length, 1); assert.strictEqual(env.st.moved.length, 1);
});

// ---------------------------------------------------------------- doGet / doPost basics
t('opening the address in a browser only says it is deployed', () => {
  const { app } = ready();
  assert.deepStrictEqual(app.get(), { ok: true, service: 'shop-billing-sync' });
});

t('requests without the right KEY, or that are malformed, are refused and take no lock', () => {
  const { env, app, key, bills } = ready();
  const b = bill('07102026-001', '2026-10-07', 132, [MAIDA]);
  assert.deepStrictEqual(app.post({ action: 'bill', bill: b }), { ok: false, error: 'bad key' });
  assert.deepStrictEqual(app.post({ key: 'x'.repeat(64), action: 'bill', bill: b }), { ok: false, error: 'bad key' });
  assert.deepStrictEqual(app.post({ key: key.slice(0, -1), action: 'bill', bill: b }), { ok: false, error: 'bad key' });
  assert.deepStrictEqual(app.post({ key: 12345, action: 'bill', bill: b }), { ok: false, error: 'bad key' });
  assert.deepStrictEqual(app.post('not json'), { ok: false, error: 'bad request' });
  assert.deepStrictEqual(app.post(''), { ok: false, error: 'bad request' });
  assert.deepStrictEqual(JSON.parse(app.sb.doPost({}).getContent()), { ok: false, error: 'bad request' });
  assert.strictEqual(env.st.locks.acquired, 0); assert.strictEqual(bills.getLastRow(), 1, 'nothing written');
  assert.deepStrictEqual(app.post({ key, action: 'nope' }), { ok: false, error: 'unknown action' });
});

t('before setup() has been run, every request says so', () => {
  const env = makeEnv(), app = load(env, 'folder123');
  assert.match(app.post({ key: 'whatever', action: 'ping' }).error, /not set up/);
});

t('ping connects, recreates missing tabs, and reports the sheet address and bill count', () => {
  const { app, key, ss } = ready();
  const r = app.post({ key, action: 'ping' });
  assert.deepStrictEqual(r, { ok: true, url: ss.getUrl(), bills: 0 });
  ss.sheets.pop();                                                   // someone deleted the "Bill items" tab
  assert.strictEqual(app.post({ key, action: 'ping' }).ok, true);
  assert.ok(ss.getSheetByName('Bill items'), 'tab is back');
});

// ---------------------------------------------------------------- writing bills
t('first bill: Bills row, items block with Grand Total row, and links in both directions', () => {
  const { app, key, bills, items } = ready();
  const r = app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 132, [MAIDA, SUGAR]) });
  assert.deepStrictEqual(r, { ok: true, result: { id: '07102026-001', sl: 1, itemsRow: 2 } });

  assert.deepStrictEqual(items.row(2), ['07102026-001', 1, 42, 'Maida - மைதா', '2 Kg', 84, '↑ Bills']);
  assert.deepStrictEqual(items.row(3), ['07102026-001', 2, 48, 'Sugar - சர்க்கரை', '1 Kg', 48, '']);
  assert.deepStrictEqual(items.row(4), ['07102026-001', '', '', 'Grand Total', '', 132, '']);
  assert.ok(items.cells['4,1'].bold && items.cells['4,6'].bold && !items.cells['3,1'].bold, 'only the Grand Total row is bold');

  assert.strictEqual(bills.cells['2,1'].value, 1);
  assert.strictEqual(bills.cells['2,3'].value, '07102026-001'); assert.strictEqual(bills.cells['2,4'].value, 132);
  // "click the Bill ID -> land on that bill's first item row"; "back" goes to its row on the Bills tab
  assert.strictEqual(bills.cells['2,3'].formula, `=HYPERLINK("#gid=${items.id}&range=A2","07102026-001")`);
  assert.strictEqual(items.cells['2,7'].formula, `=HYPERLINK("#gid=${bills.id}&range=C2","↑ Bills")`);
});

t('the date is a real date in the sheet\'s time zone, shown dd-mm-yyyy; totals are 0.00', () => {
  const { env, app, key, bills, items } = ready();
  app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 132, [MAIDA, SUGAR]) });
  const d = bills.cells['2,2'];
  assert.ok(d.value instanceof Date); assert.strictEqual(d.value.toISOString(), '2026-10-06T18:30:00.000Z');   // 07-10-2026 00:00 in Kolkata
  assert.strictEqual(d.format, 'dd-mm-yyyy'); assert.strictEqual(bills.cells['2,4'].format, '0.00');
  assert.deepStrictEqual(env.st.parseDate[0], ['2026-10-07', 'Asia/Kolkata', 'yyyy-MM-dd']);
  assert.strictEqual(items.cells['2,3'].format, '0.00'); assert.strictEqual(items.cells['2,6'].format, '0.00');
});

t('Sl No counts up, and each bill block starts one blank row after the previous one', () => {
  const { app, key, bills, items } = ready();
  app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 132, [MAIDA, SUGAR]) });      // items rows 2-4
  const r2 = app.post({ key, action: 'bill', bill: bill('07102026-002', '2026-10-07', 84, [MAIDA]) });   // blank row 5, block 6-7
  assert.deepStrictEqual(r2.result, { id: '07102026-002', sl: 2, itemsRow: 6 });
  assert.deepStrictEqual(items.row(5), ['', '', '', '', '', '', '']);
  assert.deepStrictEqual(items.row(7), ['07102026-002', '', '', 'Grand Total', '', 84, '']);
  assert.deepStrictEqual([bills.cells['2,1'].value, bills.cells['3,1'].value], [1, 2]);
  assert.strictEqual(bills.cells['3,3'].formula, `=HYPERLINK("#gid=${items.id}&range=A6","07102026-002")`);
  assert.strictEqual(items.cells['6,7'].formula, `=HYPERLINK("#gid=${bills.id}&range=C3","↑ Bills")`);
});

t('an older bill without items gets a plain Bills row (no link) and adds nothing to Bill items', () => {
  const { app, key, bills, items } = ready();
  const r = app.post({ key, action: 'bill', bill: bill('05102026-001', '2026-10-05', 10.1) });
  assert.deepStrictEqual(r.result, { id: '05102026-001', sl: 1, itemsRow: 0 });
  assert.strictEqual(bills.cells['2,3'].formula, null); assert.strictEqual(bills.cells['2,3'].value, '05102026-001');
  assert.strictEqual(items.getLastRow(), 1);
  const r2 = app.post({ key, action: 'bill', bill: bill('05102026-002', '2026-10-05', 5, []) });       // empty list = no items too
  assert.strictEqual(r2.result.itemsRow, 0);
  const r3 = app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 84, [MAIDA]) });  // later bill with items still starts at row 2
  assert.deepStrictEqual(r3.result, { id: '07102026-001', sl: 3, itemsRow: 2 });
});

t('sending the same bill again is harmless: nothing is added, Sl No is not used up', () => {
  const { app, key, bills, items } = ready();
  const b = bill('07102026-001', '2026-10-07', 132, [MAIDA, SUGAR]);
  app.post({ key, action: 'bill', bill: b });
  const before = [bills.getLastRow(), items.getLastRow()];
  assert.deepStrictEqual(app.post({ key, action: 'bill', bill: b }), { ok: true, result: { id: '07102026-001', duplicate: true } });
  assert.deepStrictEqual([bills.getLastRow(), items.getLastRow()], before);
  const next = app.post({ key, action: 'bill', bill: bill('07102026-002', '2026-10-07', 84, [MAIDA]) });
  assert.strictEqual(next.result.sl, 2);
});

t('a batch writes in order, skips bills already there, and reports a bad bill without stopping', () => {
  const { app, key, bills } = ready();
  app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 84, [MAIDA]) });
  const r = app.post({ key, action: 'bills', bills: [
    bill('07102026-001', '2026-10-07', 84, [MAIDA]),                  // already there
    bill('07102026-002', '2026-10-07', 48, [SUGAR]),
    bill('bad id', '2026-10-07', 1),                                   // invalid
    bill('07102026-003', '2026-10-07', 20) ] });
  assert.deepStrictEqual([r.ok, r.added, r.duplicates, r.failed], [true, 2, 1, 1]);
  assert.deepStrictEqual(r.results.map(x => x.duplicate ? 'dup' : x.error ? 'err' : 'new'), ['dup', 'new', 'err', 'new']);
  assert.deepStrictEqual([1, 2, 3].map(i => bills.cells[(i + 1) + ',1'].value), [1, 2, 3]);
  assert.strictEqual(app.post({ key, action: 'bills', bills: 'x' }).ok, false);
  assert.strictEqual(app.post({ key, action: 'bills', bills: new Array(201).fill(bill('07102026-009', '2026-10-07', 1)) }).ok, false);
});

t('a bill that fails the checks is refused and writes nothing', () => {
  const { app, key, bills, items } = ready();
  const bad = {
    'bad id': bill('x', '2026-10-07', 1), 'old-style id': bill('20261007-001', '2026-10-07', 1), 'impossible date': bill('07102026-001', '2026-02-31', 1),
    'date format': bill('07102026-001', '07-10-2026', 1), 'no total': { id: '07102026-001', date: '2026-10-07' }, 'negative total': bill('07102026-001', '2026-10-07', -1),
    'text total': bill('07102026-001', '2026-10-07', '5'), 'items not a list': bill('07102026-001', '2026-10-07', 1, 'x'),
    'zero qty': bill('07102026-001', '2026-10-07', 1, [item('A', '', 'KG', 0.0001, 1)].map(i => Object.assign(i, { qty: 0 }))),
    'no item name': bill('07102026-001', '2026-10-07', 1, [Object.assign(item('A', '', 'KG', 1, 1), { name_en: '' })]),
    'text price': bill('07102026-001', '2026-10-07', 1, [Object.assign(item('A', '', 'KG', 1, 1), { price: 'x' })]),
    'too many items': bill('07102026-001', '2026-10-07', 1, new Array(501).fill(item('A', '', 'KG', 1, 1)))
  };
  Object.keys(bad).forEach(k => assert.strictEqual(app.post({ key, action: 'bill', bill: bad[k] }).ok, false, k));
  assert.strictEqual(app.post({ key, action: 'bill' }).ok, false);
  assert.strictEqual(bills.getLastRow(), 1); assert.strictEqual(items.getLastRow(), 1);
});

t('a product name that looks like a formula is stored as plain text', () => {
  const { app, key, items } = ready();
  const evil = item('=HYPERLINK("http://evil.example","click")', '', 'PCS', 1, 5);
  app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 5, [evil, item('+1 offer', '', 'PCS', 1, 1), item('Plain', '', 'PCS', 1, 1)]) });
  assert.strictEqual(items.cells['2,4'].value, "'=HYPERLINK(\"http://evil.example\",\"click\")");
  assert.strictEqual(items.cells['2,4'].formula, null);
  assert.strictEqual(items.cells['3,4'].value, "'+1 offer"); assert.strictEqual(items.cells['4,4'].value, 'Plain');
});

t('quantities and units read like the app: 0.25 Kg, 3 Pkt, 12 Pcs, 1.5 Ltr', () => {
  const { app, key, items } = ready();
  app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 1, [
    item('A', '', 'KG', 0.25, 4), item('B', '', 'PKT', 3, 1), item('C', '', 'PCS', 12, 1), item('D', '', 'LTR', 1.5, 1), item('E', '', 'gm', 1, 1)]) });
  assert.deepStrictEqual([2, 3, 4, 5, 6].map(r => items.cells[r + ',5'].value), ['0.25 Kg', '3 Pkt', '12 Pcs', '1.5 Ltr', '1 GM']);
});

// ---------------------------------------------------------------- GET (read-only JSONP, used when the page cannot read a POST reply)
const unwrap = (out, cb) => { const m = new RegExp('^' + cb + '\\((.*)\\);$').exec(out.getContent()); assert.ok(m, 'wrapped in the callback: ' + out.getContent()); assert.strictEqual(out.mime, 'JAVASCRIPT'); return JSON.parse(m[1]); };

t('GET ping with the key answers as JSONP; without a valid key it only refuses', () => {
  const { app, key, ss } = ready();
  assert.deepStrictEqual(unwrap(app.getRaw({ action: 'ping', key, callback: 'cb1' }), 'cb1'), { ok: true, url: ss.getUrl(), bills: 0 });
  assert.deepStrictEqual(unwrap(app.getRaw({ action: 'ping', key: 'nope', callback: 'cb1' }), 'cb1'), { ok: false, error: 'bad key' });
  assert.deepStrictEqual(unwrap(app.getRaw({ action: 'ping', callback: 'cb1' }), 'cb1'), { ok: false, error: 'bad key' });
});

t('GET has says which Bill IDs are already in the sheet (read only, at most 50 asked at once)', () => {
  const { env, app, key, bills } = ready();
  app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 84, [MAIDA]) });
  app.post({ key, action: 'bill', bill: bill('07102026-002', '2026-10-07', 20) });
  const rows = bills.getLastRow();
  const r = unwrap(app.getRaw({ action: 'has', key, ids: '07102026-001,07102026-002,07102026-003', callback: 'f' }), 'f');
  assert.deepStrictEqual(r, { ok: true, has: { '07102026-001': true, '07102026-002': true, '07102026-003': false } });
  assert.deepStrictEqual(unwrap(app.getRaw({ action: 'has', key, ids: '', callback: 'f' }), 'f'), { ok: true, has: {} });
  const many = Array.from({ length: 80 }, (_, i) => 'x' + i).join(',');
  assert.strictEqual(Object.keys(unwrap(app.getRaw({ action: 'has', key, ids: many, callback: 'f' }), 'f').has).length, 50);
  assert.strictEqual(bills.getLastRow(), rows, 'reading changed nothing'); assert.strictEqual(env.st.locks.acquired, 2, 'only the two writes took the lock');
});

t('GET: a callback that is not a plain function name is ignored; unknown actions and a missing setup are refused', () => {
  const { app, key } = ready();
  for (const evil of ['alert(1);//', 'a.b', '1abc', 'x y', '']) {
    const out = app.getRaw({ action: 'ping', key, callback: evil });
    assert.strictEqual(out.mime, 'JSON', 'plain JSON for callback ' + JSON.stringify(evil)); assert.strictEqual(JSON.parse(out.getContent()).ok, true);
  }
  assert.deepStrictEqual(unwrap(app.getRaw({ action: 'drop', key, callback: 'f' }), 'f'), { ok: false, error: 'unknown action' });
  const env2 = makeEnv(), app2 = load(env2, 'folder123');
  assert.match(unwrap(app2.getRaw({ action: 'ping', key: 'k', callback: 'f' }), 'f').error, /not set up/);
  assert.deepStrictEqual(app.get(), { ok: true, service: 'shop-billing-sync' });          // no action: just "deployed"
});

// ---------------------------------------------------------------- locking
t('every write takes the lock and gives it back, even when something goes wrong half way', () => {
  const { env, app, key, bills } = ready();
  app.post({ key, action: 'bill', bill: bill('07102026-001', '2026-10-07', 84, [MAIDA]) });
  app.post({ key, action: 'ping' });
  app.post({ key, action: 'bills', bills: [bill('07102026-002', '2026-10-07', 48, [SUGAR])] });
  assert.deepStrictEqual([env.st.locks.acquired, env.st.locks.released], [3, 3]);
  env.st.failSetValues = true;                                                                  // the next write blows up
  const r = app.post({ key, action: 'bill', bill: bill('07102026-003', '2026-10-07', 84, [MAIDA]) });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual([env.st.locks.acquired, env.st.locks.released], [4, 4], 'lock released after the failure');
  const retry = app.post({ key, action: 'bill', bill: bill('07102026-003', '2026-10-07', 84, [MAIDA]) });
  assert.strictEqual(retry.ok, true); assert.strictEqual(bills.cells['4,3'].value, '07102026-003');
});

console.log(n + ' tests passed');
