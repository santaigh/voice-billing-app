// node test/voice.test.js
const assert = require('assert');
const fs = require('fs');
const Fuse = require('../vendor/fuse.min.js');
const XLSX = require('../vendor/xlsx.full.min.js');
const Catalog = require('../js/catalog.js');
const Search = require('../js/search.js');
const { parse, qtyFor } = require('../js/parse.js');
const Match = require('../js/match.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const P = (text, qty, unit, phrase) => assert.deepStrictEqual(parse(text), { qty, unit, phrase }, text);

t('English: digits, words, units, order', () => {
  P('two kg sugar', 2, 'KG', 'sugar');
  P('2 kg sugar', 2, 'KG', 'sugar');
  P('2kg sugar', 2, 'KG', 'sugar');
  P('sugar 2 kg', 2, 'KG', 'sugar');
  P('Two kg. Sugar!', 2, 'KG', 'sugar');
  P('2.5 kg rice', 2.5, 'KG', 'rice');
  P('500 gram sugar', 500, 'G', 'sugar');
  P('250 ml oil', 250, 'ML', 'oil');
  P('1/2 kg onion', 0.5, 'KG', 'onion');
  P('give me two packets maggi please', 2, 'PKT', 'maggi');
  P('sunflower oil 1 litre', 1, 'LTR', 'sunflower oil');
  P('sunflower oil 1L', 1, 'LTR', 'sunflower oil');
});

t('English: halves and quarters', () => {
  P('half kg sugar', 0.5, 'KG', 'sugar');
  P('quarter kg sugar', 0.25, 'KG', 'sugar');
  P('three quarter kg rice', 0.75, 'KG', 'rice');
  P('one and a half kg onion', 1.5, 'KG', 'onion');
  P('two and half litre oil', 2.5, 'LTR', 'oil');
});

t('Tamil in English letters', () => {
  P('rendu kilo sakkarai', 2, 'KG', 'sakkarai');
  P('oru kilo sakkarai', 1, 'KG', 'sakkarai');
  P('arai kilo arisi', 0.5, 'KG', 'arisi');
  P('kaal kilo vengayam', 0.25, 'KG', 'vengayam');
  P('mukkaal kilo thakkali', 0.75, 'KG', 'thakkali');
  P('onnara kilo puli', 1.5, 'KG', 'puli');
  P('moonu packet maggi', 3, 'PKT', 'maggi');
});

t('Tamil script', () => {
  P('இரண்டு கிலோ சர்க்கரை', 2, 'KG', 'சர்க்கரை');
  P('அரை கிலோ அரிசி', 0.5, 'KG', 'அரிசி');
  P('2 கிலோ சர்க்கரை', 2, 'KG', 'சர்க்கரை');
  P('2கிலோ சர்க்கரை', 2, 'KG', 'சர்க்கரை');
  P('ஒன்றரை கிலோ வெங்காயம்', 1.5, 'KG', 'வெங்காயம்');
});

t('no quantity, no unit, only a number', () => {
  P('sugar', null, null, 'sugar');
  P('kilo sugar', null, 'KG', 'sugar');
  P('two', 2, null, '');
  P('', null, null, '');
  P('   ', null, null, '');
});

t('quantity for a product: unit conversion, whole-number rule, mismatch notes', () => {
  const sugar = { name_en: 'Sugar', unit: 'KG' }, maggi = { name_en: 'Maggi', unit: 'PKT' }, oil = { name_en: 'Oil', unit: 'LTR' };
  assert.deepStrictEqual(qtyFor({ qty: 2, unit: 'KG' }, sugar), { qty: 2, note: '' });
  assert.deepStrictEqual(qtyFor({ qty: 500, unit: 'G' }, sugar), { qty: 0.5, note: '' });
  assert.deepStrictEqual(qtyFor({ qty: 250, unit: 'ML' }, oil), { qty: 0.25, note: '' });
  assert.deepStrictEqual(qtyFor({ qty: null, unit: null }, sugar), { qty: 1, note: '' });
  assert.deepStrictEqual(qtyFor({ qty: 3, unit: null }, maggi), { qty: 3, note: '' });
  assert.deepStrictEqual(qtyFor({ qty: 2, unit: 'PCS' }, maggi), { qty: 2, note: '' });
  const mismatch = qtyFor({ qty: 2, unit: 'KG' }, maggi);
  assert.strictEqual(mismatch.qty, 1); assert.match(mismatch.note, /sold per PKT/);
  const half = qtyFor({ qty: 0.5, unit: 'PKT' }, maggi);
  assert.strictEqual(half.qty, 1); assert.match(half.note, /set to 1/);
  assert.strictEqual(qtyFor({ qty: 500, unit: 'G' }, maggi).qty, 1);   // 500 g of a packet item: not usable
});

// ---- matching against the real sample sheet ----
const buf = fs.readFileSync(__dirname + '/../sample/products.xlsx');
const { products } = Catalog.parseWorkbook(XLSX, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const index = Match.build(Fuse, products, Search);
const top = (q, limit) => Match.find(index, q, limit).map(p => p.name_en);

t('match: aliases and spelling variants find the right product first', () => {
  const first = {
    sugar: 'Sugar', sakkarai: 'Sugar', chakkarai: 'Sugar', sakarai: 'Sugar', sugr: 'Sugar', cheeni: 'Sugar',
    arisi: 'Rice (Ponni)', thengai: 'Coconut', tengai: 'Coconut', vengayam: 'Onion', thakkali: 'Tomato', takkali: 'Tomato',
    kathirikai: 'Brinjal', kathirikkai: 'Brinjal', vendakkai: 'Ladies Finger', puli: 'Tamarind', uppu: 'Salt 1kg',
    muttai: 'Eggs (1)', paal: 'Milk 500ml', thayir: 'Curd 500g', maggi: 'Noodles (Maggi)', paneer: 'Paneer 200g',
    'சர்க்கரை': 'Sugar', 'தக்காளி': 'Tomato', 'உப்பு': 'Salt 1kg', 'பால்': 'Milk 500ml'
  };
  Object.keys(first).forEach(q => assert.strictEqual(top(q)[0], first[q], q + ' -> ' + top(q).join(' | ')));
});

t('match: ambiguous words give several choices, never more than the limit', () => {
  assert.strictEqual(Match.find(index, 'oil', 3).length, 3);
  assert.ok(top('oil', 5).some(x => /Sunflower/.test(x)));
  assert.strictEqual(Match.find(index, 'oil', 1).length, 1);
});

t('match: nonsense and empty give nothing', () => {
  assert.deepStrictEqual(top('qzxwv'), []);
  assert.deepStrictEqual(top(''), []);
  assert.deepStrictEqual(top('a'), []);
});

t('match: no duplicates', () => {
  const r = Match.find(index, 'rice', 3).map(p => p.code);
  assert.strictEqual(new Set(r).size, r.length);
});

console.log(n + ' tests passed');
