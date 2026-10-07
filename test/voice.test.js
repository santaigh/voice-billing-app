// node test/voice.test.js
const assert = require('assert');
const fs = require('fs');
const Fuse = require('../vendor/fuse.min.js');
const XLSX = require('../vendor/xlsx.full.min.js');
const Catalog = require('../js/catalog.js');
const Search = require('../js/search.js');
const { parse, qtyFor, isConfirm, isPrint, isCancel } = require('../js/parse.js');
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

t('numbers heard as "to / too / for" right before a unit', () => {
  P('maida to kg', 2, 'KG', 'maida');
  P('maida too kilo', 2, 'KG', 'maida');
  P('sugar for kg', 4, 'KG', 'sugar');
  P('Maida 2 Kg', 2, 'KG', 'maida');
  P('give it to me', null, null, 'it');          // "to" with no unit after it stays an ordinary word
  P('one kilo for sugar', 1, 'KG', 'sugar');     // "for" not before a unit is just filler
});

t('"bill confirm" needs both words; "cancel" is separate', () => {
  for (const ok of ['bill confirm', 'Bill confirmed', 'build confirm', 'bills confirm', 'பில் கன்பார்ம்', 'பில் கன்ஃபார்ம்'])
    assert.strictEqual(isConfirm([ok]), true, ok);
  assert.strictEqual(isConfirm(['maybe', 'bill conform']), true, 'any of the engine\'s guesses');
  for (const no of ['confirm', 'bill', 'maida 2 kg', 'I will confirm tomorrow', 'sugar', ''])
    assert.strictEqual(isConfirm([no]), false, no);
  assert.strictEqual(isConfirm([]), false);
  assert.strictEqual(isCancel(['cancel']), true); assert.strictEqual(isCancel(['please cancel it']), true);
  assert.strictEqual(isCancel(['maida']), false); assert.strictEqual(isCancel([]), false);
});

t('"print bill" needs both words and is not "bill confirm"', () => {
  for (const ok of ['print bill', 'Print the bill', 'print bill please', 'printed bill', 'print build', 'பிரிண்ட் பில்'])
    assert.strictEqual(isPrint([ok]), true, ok);
  for (const no of ['print', 'bill', 'maida 2 kg', 'sugar', 'bill confirm', ''])
    assert.strictEqual(isPrint([no]), false, no);
  assert.strictEqual(isPrint([]), false);
  assert.strictEqual(isConfirm(['print bill']), false);      // the two commands never overlap
});

t('auto-add only when exactly one product clearly IS what was said', () => {
  const auto = q => { const d = Match.decide(index, q); return d.auto ? d.auto.name_en : null; };
  // exact name / alias / code / Tamil name, spelling variants included
  const yes = { maida: 'Maida', maaida: 'Maida', sugar: 'Sugar', sakkarai: 'Sugar', chakkarai: 'Sugar', sakarai: 'Sugar',
    tengai: 'Coconut', kathirikkai: 'Brinjal', paneer: 'Paneer 200g', 'தக்காளி': 'Tomato', p001: 'Sugar',
    rice: 'Rice (Ponni)', oil: 'Sunflower Oil 1L',            // a generic word that is one product's alias = that product is the default
    basmati: 'Basmati Rice', sunflower: 'Sunflower Oil 1L' };  // nothing exact, exactly one product starts with it
  Object.keys(yes).forEach(q => assert.strictEqual(auto(q), yes[q], q));
  // ambiguous, too short, fuzzy-only, or unknown: never automatic
  for (const q of ['powder', 'soap', 'chilli', 'ra', 'su', 'sugr', 'அரிசி', 'கடலை', 'how are you', 'qzxwv', '', 'a'])
    assert.strictEqual(auto(q), null, q);
});

t('decide: the automatic choice is listed first, candidates stay capped', () => {
  const d = Match.decide(index, 'sugar');
  assert.strictEqual(d.candidates[0].name_en, 'Sugar'); assert.ok(d.candidates.length <= 3);
  assert.deepStrictEqual(Match.decide(index, 'qzxwv'), { candidates: [], auto: null });
  assert.strictEqual(Match.decide(index, 'powder').candidates.length, 3);
});

console.log(n + ' tests passed');
