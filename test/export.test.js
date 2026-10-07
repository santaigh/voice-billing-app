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

const I = (name_en, name_ta, unit, qty, price) => ({ name_en, name_ta, unit, qty, price, amount: Math.round(qty * price * 100) / 100 });
const withItems = [
  { billNo: '07102026-002', date: '2026-10-07', total: 132, time: '10:15', items: [I('Maida', 'மைதா', 'KG', 2, 42), I('Sugar', 'சர்க்கரை', 'KG', 1, 48)] },
  { billNo: '20261005-001', date: '2026-10-05', total: 10.1 },                                   // saved before items were kept
  { billNo: '07102026-003', date: '2026-10-07', total: 14, time: '11:02', items: [I('Noodles (Maggi)', '', 'PKT', 1, 14)] }];

t('workbook: sheet Bills = date / bill_no / total; sheet Bill items = every item; bill numbers as DDMMYYYY-NNN', () => {
  const wb = E.buildWorkbook(XLSX, withItems);
  const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  assert.deepStrictEqual(back.SheetNames, ['Bills', 'Bill items']);
  const shown = XLSX.utils.sheet_to_json(back.Sheets['Bills'], { raw: false });
  assert.deepStrictEqual(Object.keys(shown[0]), ['date', 'bill_no', 'total']);
  assert.deepStrictEqual(shown.map(r => [r.date, r.bill_no, r.total]), [
    ['05-10-2026', '05102026-001', '10.10'],                                                     // old-style number shown in the new style
    ['07-10-2026', '07102026-002', '132.00'], ['07-10-2026', '07102026-003', '14.00']]);
  const items = XLSX.utils.sheet_to_json(back.Sheets['Bill items'], { raw: false });
  assert.deepStrictEqual(Object.keys(items[0]), ['date', 'bill_no', 'sno', 'product_name', 'qty', 'unit', 'amt', 't_amount']);
  assert.deepStrictEqual(items.map(r => [r.date, r.bill_no, r.sno, r.product_name, r.qty, r.unit, r.amt, r.t_amount]), [
    ['07-10-2026', '07102026-002', '1', 'Maida - மைதா', '2', 'Kg', '42.00', '84.00'],
    ['07-10-2026', '07102026-002', '2', 'Sugar - சர்க்கரை', '1', 'Kg', '48.00', '48.00'],
    ['07-10-2026', '07102026-003', '1', 'Noodles (Maggi)', '1', 'Pkt', '14.00', '14.00']]);   // the old bill has no item rows
  const raw = XLSX.utils.sheet_to_json(back.Sheets['Bill items']);
  assert.deepStrictEqual(raw.map(r => [r.qty, r.amt, r.t_amount]), [[2, 42, 84], [1, 48, 48], [1, 14, 14]]);   // numbers, not text
});

t('workbook: dates are real Excel dates (serial numbers) formatted dd-mm-yyyy', () => {
  const back = XLSX.read(XLSX.write(E.buildWorkbook(XLSX, bills), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  const c = back.Sheets['Bills']['A2'];
  assert.strictEqual(c.t, 'n'); assert.strictEqual(c.w, '05-10-2026');
  assert.strictEqual(c.v, (Date.UTC(2026, 9, 5) - Date.UTC(1899, 11, 30)) / 86400000);
  const y2k = XLSX.read(XLSX.write(E.buildWorkbook(XLSX, [B('20000101-001', '2000-01-01', 1)]), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  assert.strictEqual(y2k.Sheets['Bills']['A2'].v, 36526);                                          // 2000-01-01 is Excel serial 36526
  assert.deepStrictEqual(XLSX.utils.sheet_to_json(back.Sheets['Bills']).map(r => r.total), [10.1, 20.2, 50, 26.5, 100]);
  assert.strictEqual(XLSX.utils.sheet_to_json(back.Sheets['Bill items']).length, 0);               // no items stored: header only
});

console.log(n + ' tests passed');
