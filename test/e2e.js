// node test/e2e.js  — needs playwright + a static server on :8000 (python3 -m http.server 8000)
const { chromium } = require('playwright');
const assert = require('assert');
const XLSX = require('../vendor/xlsx.full.min.js');
const fs = require('fs'), os = require('os'), path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-'));
function writeSheet(name, aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'P');
  const f = path.join(dir, name); fs.writeFileSync(f, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); return f;
}
const H = ['code', 'name_en', 'name_ta', 'unit', 'price', 'aliases'];
const partial = writeSheet('partial.xlsx', [H, ['Z1', '<b>Bold</b> tea', 'தேநீர்', 'PKT', 10, ''], ['Z2', 'NoPrice', '', 'KG', '', '']]);
const allBad = writeSheet('allbad.xlsx', [H, ['', '', '', '', '', 'x'], ['Q', 'q', '', '', 'abc', '']]);
const notExcel = path.join(dir, 'notes.xlsx'); fs.writeFileSync(notExcel, 'hello');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = []; page.on('pageerror', e => problems.push(e.message)); page.on('console', m => m.type() === 'error' && problems.push(m.text()));
  await page.goto((process.env.BASE || 'http://localhost:8000/'));

  assert.match(await page.textContent('#prod-summary'), /No products loaded/);

  await page.setInputFiles('#prod-file', 'sample/products.xlsx');
  await page.waitForFunction(() => document.querySelectorAll('#prod-body tr').length === 103);
  assert.match(await page.textContent('#prod-status'), /Loaded 103 products\./);
  assert.match(await page.textContent('#prod-summary'), /103 products · products\.xlsx · \d{2}-\d{2}-\d{4} \d{2}:\d{2}/);
  await page.screenshot({ path: (process.env.SHOT_DIR || os.tmpdir()) + '/products.png' });

  await page.reload();                                   // persistence
  await page.waitForFunction(() => document.querySelectorAll('#prod-body tr').length === 103);

  await page.setInputFiles('#prod-file', partial);       // partial: 1 loaded, 1 skipped, replaces the list
  await page.waitForFunction(() => document.querySelectorAll('#prod-body tr').length === 1);
  assert.match(await page.textContent('#prod-errors'), /Row 3 \(Z2\): price is missing/);
  assert.strictEqual(await page.locator('#prod-body b').count(), 0, 'sheet text must not become HTML');
  assert.match(await page.textContent('#prod-body'), /<b>Bold<\/b> tea/);
  await page.screenshot({ path: (process.env.SHOT_DIR || os.tmpdir()) + '/partial.png' });

  await page.setInputFiles('#prod-file', allBad);        // nothing valid: previous list kept
  await page.waitForFunction(() => /previous list was kept/.test(document.getElementById('prod-status').textContent));
  assert.strictEqual(await page.locator('#prod-body tr').count(), 1);

  await page.setInputFiles('#prod-file', notExcel);      // not an Excel file: previous list kept
  await page.waitForFunction(() => /could not be read|no product rows/.test(document.getElementById('prod-status').textContent));
  assert.strictEqual(await page.locator('#prod-body tr').count(), 1);

  await page.click('#tab-billing'); assert.ok(await page.locator('#screen-billing').isVisible());
  assert.ok(!(await page.locator('#screen-products').isVisible()));

  // offline: service worker has cached the shell
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.evaluate(() => navigator.serviceWorker.ready);
  await ctx.setOffline(true);
  await page.reload();
  await page.click('#tab-products');
  await page.waitForFunction(() => document.querySelectorAll('#prod-body tr').length === 1);

  assert.deepStrictEqual(problems, []);
  console.log('e2e passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
