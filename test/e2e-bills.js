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
  await page.goto((process.env.BASE || 'http://localhost:8000/'));

  const disp = iso => iso.slice(8) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4);   // YYYY-MM-DD -> DD-MM-YYYY
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
  assert.strictEqual(await page.inputValue('#bills-from'), disp(today));
  assert.strictEqual(await page.inputValue('#bills-to'), disp(today));
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
  await page.fill('#bills-from', disp(d3));
  assert.strictEqual(await page.locator('.day').count(), 3);
  assert.strictEqual(await page.textContent('#bills-summary'), '7 bills · ₹ 220.80');          // 135.5 + 55 + 30.3
  const heads = await page.locator('.day-head').allTextContents();
  assert.match(heads[0], /today/); assert.match(heads[1], /2 bills · ₹ 55\.00.*not exported/); assert.match(heads[2], /2 bills · ₹ 30\.30.*not exported/);
  await page.screenshot({ path: shots + '/bills.png' });

  // reversed boxes behave the same
  await page.fill('#bills-from', disp(today)); await page.fill('#bills-to', disp(d3));
  assert.strictEqual(await page.textContent('#bills-summary'), '7 bills · ₹ 220.80');
  await page.fill('#bills-from', disp(d3)); await page.fill('#bills-to', disp(today));

  // every date on screen is DD-MM-YYYY
  assert.match(heads[0], new RegExp('^' + disp(today))); assert.match(heads[1], new RegExp('^' + disp(yest)));
  assert.match(await page.textContent('#bills-warn-text'), new RegExp(disp(yest) + '.*' + disp(d3) + '|' + disp(d3) + '.*' + disp(yest)));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(await page.locator('#screen-bills').innerText()), 'no YYYY-MM-DD anywhere on the Bills screen');

  // typing digits only gets its dashes; bad dates are flagged, not applied; the calendar button fills the box
  await page.locator('#bills-from').fill(''); await page.locator('#bills-from').pressSequentially(disp(yest).replace(/-/g, ''));
  assert.strictEqual(await page.inputValue('#bills-from'), disp(yest));
  assert.strictEqual(await page.locator('.day').count(), 2);                     // yesterday .. today
  await page.locator('#bills-from').fill('31-02-2026'); await page.press('#bills-from', 'Tab');
  assert.ok(await page.locator('#bills-range-error').isVisible()); assert.ok(await page.locator('#bills-from').evaluate(e => e.classList.contains('invalid')));
  assert.strictEqual(await page.locator('.day').count(), 2, 'a bad date leaves the list as it was');
  await page.locator('#bills-from').fill('07-1');                    // half-typed: no complaint yet
  assert.ok(await page.locator('#bills-range-error').isHidden()); assert.ok(!(await page.locator('#bills-from').evaluate(e => e.classList.contains('invalid'))));
  await page.evaluate(iso => { const n = document.getElementById('bills-from-native'); n.value = iso; n.dispatchEvent(new Event('change')); }, d3);
  assert.strictEqual(await page.inputValue('#bills-from'), disp(d3));
  assert.ok(await page.locator('#bills-range-error').isHidden()); assert.strictEqual(await page.locator('.day').count(), 3);
  assert.ok(await page.locator('#bills-from-pick').isVisible());

  // export the range: file name, sheets, rows in order, totals
  const dl = await exportNow('#bills-export');
  assert.strictEqual(dl.suggestedFilename(), `bills-${disp(d3)}_to_${disp(today)}.xlsx`);
  const wb = await readXlsx(dl);
  assert.deepStrictEqual(rows(wb, 'Bills').map(r => r.bill_no), [no(d3, 1), no(d3, 2), no(yest, 1), no(yest, 2), no(today, 1), no(today, 2), no(today, 3)]);
  assert.deepStrictEqual(rows(wb, 'Bills').map(r => r.total), [10.1, 20.2, 50, 5, 26.5, 100, 9]);
  assert.deepStrictEqual(XLSX.utils.sheet_to_json(wb.Sheets['Bills'], { raw: false }).map(r => r.date), [d3, d3, yest, yest, today, today, today].map(disp));   // as Excel shows them
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
  assert.strictEqual(dl2.suggestedFilename(), `bills-${disp(yest)}.xlsx`);
  assert.strictEqual(rows(await readXlsx(dl2), 'Bills').length, 3);
  await page.waitForFunction(() => document.getElementById('bills-warn').hidden);

  // single day export; Today button
  await page.click('#bills-today');
  const dl3 = await exportNow('#bills-export');
  assert.strictEqual(dl3.suggestedFilename(), `bills-${disp(today)}.xlsx`);

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
