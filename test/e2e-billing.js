// node test/e2e-billing.js — needs playwright + a static server on :8000
const { chromium } = require('playwright');
const assert = require('assert');
const os = require('os');

(async () => {
  const shots = process.env.SHOT_DIR || os.tmpdir();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const problems = []; page.on('pageerror', e => problems.push(e.message)); page.on('console', m => m.type() === 'error' && problems.push(m.text()));
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await page.goto((process.env.BASE || 'http://localhost:8000/'));

  // before any products are loaded
  await page.click('#tab-billing');
  assert.ok(await page.locator('#bill-noproducts').isVisible());
  assert.ok(await page.locator('#bill-search').isDisabled());

  await page.click('#tab-products');
  await page.fill('#shop-name', 'Arul Stores'); await page.press('#shop-name', 'Tab');
  await page.setInputFiles('#prod-file', 'sample/products.xlsx');
  await page.waitForFunction(() => document.querySelectorAll('#prod-body tr').length === 103);
  await page.click('#tab-billing');
  assert.ok(await page.locator('#bill-noproducts').isHidden());

  const total = () => page.textContent('#bill-total');
  const generate = page.locator('#bill-generate');
  assert.ok(await generate.isDisabled(), 'empty cart cannot be billed');

  // type "sakk" (alias) -> Sugar, tap -> added, search cleared
  await page.fill('#bill-search', 'sakk');
  assert.match(await page.textContent('#bill-results'), /Sugar/);
  await page.click('#bill-results .result');
  assert.strictEqual(await page.inputValue('#bill-search'), '');
  assert.strictEqual(await total(), '48.00');

  // Enter adds the top result; searching the same product again adds one more
  await page.fill('#bill-search', 'sugar'); await page.press('#bill-search', 'Enter');
  assert.strictEqual(await page.locator('#bill-cart .line').count(), 1);
  assert.strictEqual(await page.inputValue('.l-qty'), '2');
  assert.strictEqual(await total(), '96.00');

  // second product (packet) and the whole-number rule
  await page.fill('#bill-search', 'maggi'); await page.press('#bill-search', 'Enter');
  assert.strictEqual(await total(), '110.00');
  const maggiQty = page.locator('.line').nth(1).locator('.l-qty');
  await maggiQty.fill('0.5');
  assert.ok(await maggiQty.evaluate(e => e.classList.contains('invalid')));
  assert.ok(await generate.isDisabled());
  assert.match(await page.textContent('#bill-msg'), /Fix the highlighted/);
  await maggiQty.fill('3');
  assert.ok(await generate.isEnabled());
  assert.strictEqual(await total(), '138.00');           // 96 + 3*14

  // loose item: decimals allowed; price editable per line
  const sugarQty = page.locator('.line').nth(0).locator('.l-qty');
  await sugarQty.fill('0.25');
  assert.strictEqual(await page.locator('.line').nth(0).locator('.l-total').textContent(), '12.00');
  await page.locator('.line').nth(0).locator('.l-price').fill('50');
  assert.strictEqual(await page.locator('.line').nth(0).locator('.l-total').textContent(), '12.50');
  assert.strictEqual(await total(), '54.50');             // 12.50 + 42
  await page.screenshot({ path: shots + '/billing.png' });

  // remove a line
  await page.locator('.line').nth(1).locator('.l-remove').click();
  assert.strictEqual(await total(), '12.50');
  await page.fill('#bill-search', 'maggi'); await page.press('#bill-search', 'Enter');
  assert.strictEqual(await total(), '26.50');

  // a failing save: cart kept, message shown, nothing saved
  await page.evaluate(() => { window.__realSave = Store.saveBill; Store.saveBill = () => Promise.reject(new Error('disk full')); });
  await generate.click();
  await page.waitForFunction(() => /could not be saved/.test(document.getElementById('bill-msg').textContent));
  assert.strictEqual(await page.evaluate(() => window.__prints), 0);
  assert.strictEqual(await page.locator('#bill-cart .line').count(), 2);
  assert.ok(await page.locator('#receipt-overlay').isHidden());
  assert.ok(await generate.isEnabled(), 'can retry');
  await page.evaluate(() => { Store.saveBill = window.__realSave; });

  // generate: saved and closed (cart cleared) but NOT printed; printing is a separate step
  await generate.click();
  await page.waitForSelector('#saved-bar:not([hidden])');
  assert.strictEqual(await page.evaluate(() => window.__prints), 0, 'confirming does not print');
  assert.ok(await page.locator('#receipt-overlay').isHidden());
  const today = await page.evaluate(() => Bill.localDate(new Date()));
  const no1 = today.replace(/-/g, '') + '-001';
  assert.match(await page.textContent('#saved-text'), new RegExp('Bill ' + no1 + ' saved · ₹ 26\\.50 — say “print bill”'));
  assert.strictEqual(await page.locator('#bill-cart .line').count(), 0);
  assert.strictEqual(await page.locator('#last-bill').count(), 0, 'no last-bill strip any more');
  await page.click('#saved-print');                               // the tap alternative to saying "print bill"
  await page.waitForSelector('#receipt-overlay:not([hidden])');
  assert.strictEqual(await page.evaluate(() => window.__prints), 1);
  assert.ok(await page.locator('#saved-bar').isHidden());
  const receipt = await page.textContent('#receipt-paper');
  assert.match(receipt, /\d{2}-\d{2}-\d{4} \d{2}:\d{2}/, 'receipt date reads DD-MM-YYYY HH:MM');
  for (const want of ['Arul Stores', 'Bill No: ' + no1, 'Sugar', '0.25 KG × 50.00', 'Maggi', '1 PKT × 14.00', 'TOTAL', '₹ 26.50'])
    assert.ok(receipt.includes(want), 'receipt should contain "' + want + '": ' + receipt);
  await page.screenshot({ path: shots + '/receipt.png' });
  assert.strictEqual(await page.locator('#bill-cart .line').count(), 0);
  await page.click('#receipt-print'); assert.strictEqual(await page.evaluate(() => window.__prints), 2);
  await page.click('#receipt-new');
  assert.ok(await page.locator('#receipt-overlay').isHidden());

  // second bill gets -002; stored records hold exactly three fields
  await page.fill('#bill-search', 'salt'); await page.press('#bill-search', 'Enter');
  await generate.click();
  await page.waitForSelector('#saved-bar:not([hidden])');
  assert.match(await page.textContent('#saved-text'), new RegExp('Bill ' + today.replace(/-/g, '') + '-002 saved'));
  await page.click('#saved-print');
  await page.waitForSelector('#receipt-overlay:not([hidden])');
  assert.match(await page.textContent('#receipt-paper'), new RegExp('Bill No: ' + today.replace(/-/g, '') + '-002'));
  await page.click('#receipt-new');
  let bills = await page.evaluate(() => Store.loadBills());
  bills.sort((a, b) => a.billNo < b.billNo ? -1 : 1);
  assert.deepStrictEqual(bills, [{ billNo: no1, date: today, total: 26.5 }, { billNo: today.replace(/-/g, '') + '-002', date: today, total: 22 }]);

  // numbering and shop name survive a reload; the counter restarts on a new day
  await page.reload(); await page.click('#tab-billing');
  await page.fill('#bill-search', 'salt'); await page.press('#bill-search', 'Enter');
  await page.click('#bill-generate');
  await page.waitForSelector('#saved-bar:not([hidden])');
  await page.click('#saved-print');
  await page.waitForSelector('#receipt-overlay:not([hidden])');
  assert.match(await page.textContent('#receipt-paper'), new RegExp('Arul Stores[\\s\\S]*' + today.replace(/-/g, '') + '-003'));
  await page.click('#receipt-new');
  const next = await page.evaluate(async () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    return Store.saveBill(1, tomorrow);
  });
  assert.ok(next.billNo.endsWith('-001'), 'new day restarts at 001, got ' + next.billNo);

  // no product matches
  await page.fill('#bill-search', 'zzzzq');
  assert.ok(await page.locator('#bill-nomatch').isVisible());

  assert.deepStrictEqual(problems, []);
  console.log('e2e billing passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
