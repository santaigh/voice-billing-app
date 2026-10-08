'use strict';
var assert = require('assert');
var Cloud = require('../js/cloud.js');
var ok = { id: '07102026-001', date: '2026-10-07', total: 84, items: [{ name_en: 'Maida', name_ta: '', unit: 'KG', qty: 2, price: 42, amount: 84 }] };
function t(name, fn) { fn(); console.log('ok - ' + name); }
t('a good bill and one without items pass', function () {
  assert.strictEqual(Cloud.problemWith(ok), '');
  assert.strictEqual(Cloud.problemWith({ id: ok.id, date: ok.date, total: 5 }), '');
});
t('each rule the script enforces is named', function () {
  function with_(o) { return Cloud.problemWith(Object.assign({}, ok, o)); }
  assert.match(with_({ id: '08102026-001' }), /does not match its date/);
  assert.match(with_({ id: '20261007-001' }), /does not match its date/);
  assert.match(with_({ date: '7-10-2026' }), /bad date/);
  assert.match(with_({ total: NaN }), /bad total/);
  assert.match(with_({ items: [{ name_en: '', qty: 1, price: 1, amount: 1 }] }), /no English name/);
  assert.match(with_({ items: [{ name_en: 'X', qty: 0, price: 1, amount: 0 }] }), /quantity 0/);
  assert.match(with_({ items: [{ name_en: 'X', qty: '2', price: 1, amount: 2 }] }), /quantity 2/);
});
console.log('2 tests passed');
