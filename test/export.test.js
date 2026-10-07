// node test/export.test.js
const assert = require('assert');
const XLSX = require('../vendor/xlsx.full.min.js');
const E = require('../js/export.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const B = (billNo, date, total) => ({ billNo, date, total });
const bills = [B('20261007-002', '2026-10-07', 100), B('20261005-001', '2026-10-05', 10.1), B('20261007-001', '2026-10-07', 26.5),
               B('20261005-002', '2026-10-05', 20.2), B('20261006-001', '2026-10-06', 50)];

t('bills sort by date, then numerically within the day (-1000 after -999)', () => {
  assert.deepStrictEqual(E.sortBills(bills).map(b => b.billNo),
    ['20261005-001', '20261005-002', '20261006-001', '20261007-001', '20261007-002']);
  assert.deepStrictEqual(E.sortBills([B('20261007-1000', '2026-10-07', 1), B('20261007-999', '2026-10-07', 1)]).map(b => b.billNo),
    ['20261007-999', '20261007-1000']);
});

t('day totals add up in whole paise', () => {
  assert.deepStrictEqual(E.dayTotals(bills), [{ date: '2026-10-05', count: 2, paise: 3030 }, { date: '2026-10-06', count: 1, paise: 5000 }, { date: '2026-10-07', count: 2, paise: 12650 }]);
  const tenths = Array.from({ length: 10 }, (_, i) => B('20261001-' + (i + 1), '2026-10-01', 0.1));
  assert.strictEqual(E.dayTotals(tenths)[0].paise, 100);
  assert.deepStrictEqual(E.dayTotals([]), []);
});

t('pending days: only earlier days with bills newer than the last export', () => {
  const today = '2026-10-07';
  assert.deepStrictEqual(E.pendingDays(bills, {}, today), ['2026-10-05', '2026-10-06']);       // today never nags
  assert.deepStrictEqual(E.pendingDays(bills, { '2026-10-05': 2, '2026-10-06': 1 }, today), []);
  assert.deepStrictEqual(E.pendingDays(bills, { '2026-10-05': 1, '2026-10-06': 1 }, today), ['2026-10-05']);   // a bill added after the export
  assert.deepStrictEqual(E.pendingDays([], {}, today), []);
});

t('file names use DD-MM-YYYY', () => {
  assert.strictEqual(E.fileName([B('a-1', '2026-10-07', 1)]), 'bills-07-10-2026.xlsx');
  assert.strictEqual(E.fileName(bills), 'bills-05-10-2026_to_07-10-2026.xlsx');
  assert.strictEqual(E.fileName([]), 'bills.xlsx');
});

t('workbook: real Excel dates shown as DD-MM-YYYY; Bills sheet is exactly date / bill_no / total', () => {
  const wb = E.buildWorkbook(XLSX, bills);
  const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  assert.deepStrictEqual(back.SheetNames, ['Bills', 'Daily totals']);
  const shown = XLSX.utils.sheet_to_json(back.Sheets['Bills'], { raw: false });          // as Excel displays the cells
  assert.deepStrictEqual(Object.keys(shown[0]), ['date', 'bill_no', 'total']);
  assert.deepStrictEqual(shown.map(r => [r.date, r.bill_no, r.total]), [
    ['05-10-2026', '20261005-001', '10.10'], ['05-10-2026', '20261005-002', '20.20'], ['06-10-2026', '20261006-001', '50.00'],
    ['07-10-2026', '20261007-001', '26.50'], ['07-10-2026', '20261007-002', '100.00']]);
  // the date cell is a number with a date format, i.e. a true date (not text); 2000-01-01 is Excel serial 36526
  const c = back.Sheets['Bills']['A2'];
  assert.strictEqual(c.t, 'n'); assert.strictEqual(c.w, '05-10-2026');
  assert.strictEqual(c.v, (Date.UTC(2026, 9, 5) - Date.UTC(1899, 11, 30)) / 86400000);
  const y2k = XLSX.read(XLSX.write(E.buildWorkbook(XLSX, [B('20000101-001', '2000-01-01', 1)]), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  assert.strictEqual(y2k.Sheets['Bills']['A2'].v, 36526);
  const raw = XLSX.utils.sheet_to_json(back.Sheets['Bills']);
  assert.deepStrictEqual(raw.map(r => r.total), [10.1, 20.2, 50, 26.5, 100]);            // totals stay numbers
  const d = XLSX.utils.sheet_to_json(back.Sheets['Daily totals'], { raw: false });
  assert.deepStrictEqual(d.map(r => [r.date, r.bills, r.total]), [['05-10-2026', '2', '30.30'], ['06-10-2026', '1', '50.00'], ['07-10-2026', '2', '126.50'], ['TOTAL', '5', '206.80']]);
});

console.log(n + ' tests passed');
