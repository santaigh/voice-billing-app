// node test/bill.test.js
const assert = require('assert');
const Bill = require('../js/bill.js');
const Search = require('../js/search.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('quantity: decimals only for KG/LTR, whole numbers otherwise, > 0', () => {
  assert.strictEqual(Bill.parseQty('0.25', 'KG'), 0.25);
  assert.strictEqual(Bill.parseQty('.5', 'kg'), 0.5);
  assert.strictEqual(Bill.parseQty('1,5', 'LTR'), 1.5);
  assert.ok(isNaN(Bill.parseQty('0.25', 'PKT')));
  assert.ok(isNaN(Bill.parseQty('0.5', 'PCS')));
  assert.strictEqual(Bill.parseQty('3', 'PCS'), 3);
  for (const bad of ['', ' ', '0', '0.000', '-1', 'abc', '1.2345', '2x', '1e3', '100001'])
    assert.ok(isNaN(Bill.parseQty(bad, 'KG')), 'should reject "' + bad + '"');
});

t('price: up to 2 decimals, > 0', () => {
  assert.strictEqual(Bill.parsePrice('48'), 48);
  assert.strictEqual(Bill.parsePrice('48.5'), 48.5);
  assert.strictEqual(Bill.parsePrice('.99'), 0.99);
  for (const bad of ['', '0', '-5', '1.234', 'x', '₹5']) assert.ok(isNaN(Bill.parsePrice(bad)), 'should reject "' + bad + '"');
});

t('line totals are exact in paise (no float drift)', () => {
  assert.strictEqual(Bill.lineTotal(2, 4800), 9600);
  assert.strictEqual(Bill.lineTotal(0.25, 4800), 1200);
  assert.strictEqual(Bill.lineTotal(0.3, 3333), 1000);       // 9.999 -> 10.00
  assert.strictEqual(Bill.lineTotal(0.29, 10000), 2900);     // 0.29*1000 = 290.00000000000006 in floats
  assert.strictEqual(Bill.lineTotal(3, 1010), 3030);
  let sum = 0; for (let i = 0; i < 10; i++) sum += Bill.lineTotal(1, Bill.toPaise(0.1)); // ten items at 0.10
  assert.strictEqual(sum, 100);
});

t('formatting', () => {
  assert.strictEqual(Bill.formatMoney(125050), '1,250.50');
  assert.strictEqual(Bill.formatMoney(5), '0.05');
  assert.strictEqual(Bill.formatMoney(12345600), '1,23,456.00');   // Indian grouping
  assert.strictEqual(Bill.formatQty(0.5), '0.5');
  assert.strictEqual(Bill.formatQty(2), '2');
  assert.strictEqual(Bill.localDate(new Date(2026, 9, 7, 23, 59)), '2026-10-07');
  assert.strictEqual(Bill.billNo('2026-10-07', 1), '20261007-001');
  assert.strictEqual(Bill.billNo('2026-10-07', 1234), '20261007-1234');
  assert.strictEqual(Bill.formatDateTime(new Date(2026, 0, 5, 9, 3)), '05/01/2026 09:03');
});

t('evalLine flags each bad field', () => {
  const ok = Bill.evalLine({ unit: 'KG', qtyText: '0.5', priceText: '48.00' });
  assert.deepStrictEqual([ok.ok, ok.totalPaise], [true, 2400]);
  const bad = Bill.evalLine({ unit: 'PKT', qtyText: '0.5', priceText: '' });
  assert.deepStrictEqual([bad.ok, bad.qtyOk, bad.priceOk], [false, false, false]);
});

const P = (code, en, ta, aliases) => ({ code, name_en: en, name_ta: ta || '', unit: 'KG', price: 1, aliases: aliases || [] });
const list = [P('P1', 'Sugar', 'சர்க்கரை', ['sakkarai', 'cheeni']), P('P2', 'Brown Sugar', '', []), P('P3', 'Sunflower Oil 1L', '', ['oil', 'ennai']),
              P('P4', 'Gingelly Oil 500ml', 'நல்லெண்ணெய்', ['nallennai', 'sesame oil']), P('P5', 'Salt 1kg', 'உப்பு', ['uppu'])];

t('search: alias, Tamil, code, partial words; best match first', () => {
  const names = q => Search.find(list, q).map(p => p.code);
  assert.deepStrictEqual(names('sakk'), ['P1']);
  assert.deepStrictEqual(names('சர்'), ['P1']);
  assert.deepStrictEqual(names('p5'), ['P5']);
  assert.deepStrictEqual(names('sugar'), ['P1', 'P2']);           // exact name before "contains"
  assert.deepStrictEqual(names('oil'), ['P3', 'P4']);             // exact alias first, then alias-containing
  assert.deepStrictEqual(names('sesame oil'), ['P4']);            // multi-word, matches the alias
  assert.deepStrictEqual(names('  SUGAR  '), ['P1', 'P2']);       // case and spaces ignored
  assert.deepStrictEqual(names('zzz'), []);
  assert.deepStrictEqual(names(''), []);
  assert.strictEqual(Search.find(list, 'o', 2).length, 2);        // limit
});

console.log(n + ' tests passed');
