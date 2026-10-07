// node test/e2e-bills.js — needs playwright + a static server on :8000
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs'), os = require('os');
const XLSX = require('../vendor/xlsx.full.min.js');

(async () => {
  const shots = process.env.SHOT_DIR || os.tmpdir();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = []; page.on('pageerror', e => problems.push(e.message)); page.on('console', m => m.type() === 'error' && problems.push(m.text()));
  await page.goto('http://localhost:8000/');

  const day = k => page.evaluate(k => Bill.localDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - k)), k);
  const save = (total, k) => page.evaluate(([t, k]) => { const n = new Date(); return Store.saveBill(t, new Date(n.getFullYear(), n.getMonth(), n.getDate() - k, 12)); }, [total, k]);
  const [today, yest, d3] = [await day(0), await day(1), await day(3)];
  const readXlsx = async dl => XLSX.read(fs.readFileSync(await dl.path()), { type: 'buffer' });
  const exportNow = async sel => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); return dl; };
  const rows = (wb, s) => XLSX.utils.sheet_to_json(wb.Sheets[s]);

  const reopen = async () => { await page.click('#tab-products'); await page.click('#tab-bills'); await page.evaluate(() => Bills.refresh()); };

  // empty
  await page.click('#tab-bills');
  assert.ok(await page.locator('#bills-empty').isVisible());
  assert.ok(await page.locator('#bills-export').isDisabled());
  assert.strictEqual(await page.inputValue('#bills-from'), today);
  assert.strictEqual(await page.inputValue('#bills-to'), today);
  assert.ok(await page.locator('#bills-dot').isHidden());

  // bills over four days (the clock "going back" must keep numbering going, not reuse numbers)
  const made = [await save(26.5, 0), await save(100, 0), await save(50, 1), await save(10.1, 3), await save(20.2, 3)];
  const no = (date, n) => date.replace(/-/g, '') + '-' + String(n).padStart(3, '0');
  assert.deepStrictEqual(made.map(b => b.billNo), [no(today, 1), no(today, 2), no(yest, 1), no(d3, 1), no(d3, 2)]);
  const back = await save(5, 1);                                  // yesterday again, after today and 3-days-ago exist
  assert.strictEqual(back.billNo, no(yest, 2));
  const todayAgain = await save(9, 0);
  assert.strictEqual(todayAgain.billNo, no(today, 3));

  // default view: today only
  await reopen();
  assert.strictEqual(await page.textContent('#bills-summary'), '3 bills · ₹ 135.50');          // 26.5 + 100 + 9
  assert.strictEqual(await page.locator('.day').count(), 1);
  assert.match(await page.textContent('.day-head'), /3 bills · ₹ 135\.50/);
  assert.deepStrictEqual(await page.locator('.bill-rows li').allTextContents(), [no(today, 3) + '9.00', no(today, 2) + '100.00', no(today, 1) + '26.50']);   // newest first

  // backup warning: two earlier days are not exported; the tab shows a dot
  assert.ok(await page.locator('#bills-warn').isVisible());
  assert.ok(await page.locator('#bills-dot').isVisible());
  assert.match(await page.textContent('#bills-warn-text'), /2 earlier days/);

  // a wider range, grouped per day, newest day first
  await page.fill('#bills-from', d3);
  assert.strictEqual(await page.locator('.day').count(), 3);
  assert.strictEqual(await page.textContent('#bills-summary'), '7 bills · ₹ 220.80');          // 135.5 + 55 + 30.3
  const heads = await page.locator('.day-head').allTextContents();
  assert.match(heads[0], /today/); assert.match(heads[1], /2 bills · ₹ 55\.00.*not exported/); assert.match(heads[2], /2 bills · ₹ 30\.30.*not exported/);
  await page.screenshot({ path: shots + '/bills.png' });

  // reversed boxes behave the same
  await page.fill('#bills-from', today); await page.fill('#bills-to', d3);
  assert.strictEqual(await page.textContent('#bills-summary'), '7 bills · ₹ 220.80');
  await page.fill('#bills-from', d3); await page.fill('#bills-to', today);

  // export the range: file name, sheets, rows in order, totals
  const dl = await exportNow('#bills-export');
  assert.strictEqual(dl.suggestedFilename(), `bills-${d3}_to_${today}.xlsx`);
  const wb = await readXlsx(dl);
  assert.deepStrictEqual(rows(wb, 'Bills').map(r => r.bill_no), [no(d3, 1), no(d3, 2), no(yest, 1), no(yest, 2), no(today, 1), no(today, 2), no(today, 3)]);
  assert.deepStrictEqual(rows(wb, 'Bills').map(r => r.total), [10.1, 20.2, 50, 5, 26.5, 100, 9]);
  const tot = rows(wb, 'Daily totals'); assert.deepStrictEqual(tot[tot.length - 1], { date: 'TOTAL', bills: 7, total: 220.8 });
  await page.waitForFunction(() => /Exported 7 bills/.test(document.getElementById('bills-status').textContent));

  // now everything is backed up: no warning, no dot, days marked
  assert.ok(await page.locator('#bills-warn').isHidden()); assert.ok(await page.locator('#bills-dot').isHidden());
  assert.strictEqual(await page.locator('.badge.ok').count(), 3);
  await page.screenshot({ path: shots + '/bills-exported.png' });

  // a bill added to an already-exported day brings the warning back
  await save(1, 1);
  await reopen();
  assert.ok(await page.locator('#bills-warn').isVisible()); assert.match(await page.textContent('#bills-warn-text'), /1 earlier day /);
  assert.ok(await page.locator('#bills-dot').isVisible());

  // "Export them" backs up the owed days in one go
  const dl2 = await exportNow('#bills-warn-go');
  assert.strictEqual(dl2.suggestedFilename(), `bills-${yest}.xlsx`);
  assert.strictEqual(rows(await readXlsx(dl2), 'Bills').length, 3);
  await page.waitForFunction(() => document.getElementById('bills-warn').hidden);

  // single day export; Today button
  await page.click('#bills-today');
  const dl3 = await exportNow('#bills-export');
  assert.strictEqual(dl3.suggestedFilename(), `bills-${today}.xlsx`);

  // an empty "From" means no lower limit
  await page.fill('#bills-from', '');
  assert.strictEqual(await page.locator('.day').count(), 3);

  // survives a reload
  await page.reload(); await page.click('#tab-bills'); await page.evaluate(() => Bills.refresh());
  assert.ok(await page.locator('#bills-warn').isHidden());
  assert.strictEqual(await page.locator('#bills-dot').isHidden(), true);

  assert.deepStrictEqual(problems, []);
  console.log('e2e bills passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
