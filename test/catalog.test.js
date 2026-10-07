// node test/catalog.test.js  — uses the vendored SheetJS and the sample sheet
const assert = require('assert');
const fs = require('fs');
const XLSX = require('../vendor/xlsx.full.min.js');
const Catalog = require('../js/catalog.js');

function sheetBuffer(aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Products');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
const H = ['code', 'name_en', 'name_ta', 'unit', 'price', 'aliases'];
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('sample sheet loads with no errors', () => {
  const buf = fs.readFileSync(__dirname + '/../sample/products.xlsx');
  const r = Catalog.parseWorkbook(XLSX, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.products.length, 103);
  const sugar = r.products.find(p => p.code === 'P001');
  assert.deepStrictEqual([sugar.name_en, sugar.name_ta, sugar.unit, sugar.price], ['Sugar', 'சர்க்கரை', 'KG', 48]);
  assert.ok(sugar.aliases.includes('sakkarai'));
});

t('bad rows are skipped and reported with Excel row numbers', () => {
  const r = Catalog.parseWorkbook(XLSX, sheetBuffer([H,
    ['A1', 'Good', '', 'kg', 10, ''],
    ['', 'No code', '', 'KG', 5, ''],       // row 3
    ['A3', '', '', 'KG', 5, ''],            // row 4
    ['A4', 'No price', '', 'KG', '', ''],   // row 5
    ['A5', 'Text price', '', 'KG', 'abc', ''], // row 6
    ['A6', 'Zero', '', 'KG', 0, ''],        // row 7
    ['a1', 'Dup of A1', '', 'KG', 12, ''],  // row 8
    ['', '', '', '', '', ''],               // blank: ignored
    ['A7', 'Rupee', '', '', '₹1,250.50', 'x, X ,y;z']]));
  assert.deepStrictEqual(r.errors.map(e => e.row), [3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(r.products.map(p => p.code), ['A1', 'A7']);
  assert.strictEqual(r.products[0].unit, 'KG');   // upper-cased
  assert.strictEqual(r.products[1].unit, 'PCS');  // blank -> PCS
  assert.strictEqual(r.products[1].price, 1250.5);
  assert.deepStrictEqual(r.products[1].aliases, ['x', 'y', 'z']);
});

t('headers are matched ignoring case and spaces; numeric codes become text', () => {
  const r = Catalog.parseWorkbook(XLSX, sheetBuffer([[' Code ', 'NAME_EN', 'Price'], [7, 'Seven', 7]]));
  assert.strictEqual(r.products[0].code, '7');
});

t('missing required column is a clear error', () => {
  assert.throws(() => Catalog.parseWorkbook(XLSX, sheetBuffer([['code', 'name_en'], ['A', 'B']])), /Missing column\(s\): price/);
});

t('empty sheet and non-Excel bytes are clear errors', () => {
  assert.throws(() => Catalog.parseWorkbook(XLSX, sheetBuffer([H])), /no product rows/);
  assert.throws(() => Catalog.parseWorkbook(XLSX, new Uint8Array([1, 2, 3]).buffer), /could not be read|no product rows|Missing/);
});

console.log(n + ' tests passed');
