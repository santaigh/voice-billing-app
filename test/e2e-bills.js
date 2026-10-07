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
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await page.goto((process.env.BASE || 'http://localhost:8000/'));

  const disp = iso => iso.slice(8) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4);   // YYYY-MM-DD -> DD-MM-YYYY
  const day = k => page.evaluate(k => Bill.localDate(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - k)), k);
  const save = (total, k, items) => page.evaluate(([t, k, items]) => { const n = new Date(); return Store.saveBill(t, new Date(n.getFullYear(), n.getMonth(), n.getDate() - k, 12, 30), items); }, [total, k, items]);
  const item = (name_en, name_ta, unit, qty, price) => ({ name_en, name_ta, unit, qty, price, amount: Math.round(qty * price * 100) / 100 });
  const [today, yest, d3] = [await day(0), await day(1), await day(3)];
  const readXlsx = async dl => XLSX.read(fs.readFileSync(await dl.path()), { type: 'buffer' });
  const exportNow = async sel => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); return dl; };
  const rows = (wb, s) => XLSX.utils.sheet_to_json(wb.Sheets[s]);
  const no = (iso, n) => iso.slice(8) + iso.slice(5, 7) + iso.slice(0, 4) + '-' + String(n).padStart(3, '0');   // DDMMYYYY-NNN

  const reopen = async () => { await page.click('#tab-products'); await page.click('#tab-bills'); await page.evaluate(() => Bills.refresh()); };

  // empty
  await page.click('#tab-bills');
  assert.ok(await page.locator('#bills-empty').isVisible());
  assert.ok(await page.locator('#bills-export').isDisabled());
  assert.strictEqual(await page.inputValue('#bills-from'), disp(today));
  assert.strictEqual(await page.inputValue('#bills-to'), disp(today));
  assert.ok(await page.locator('#bills-dot').isHidden());

  // bills over four days (the clock "going back" must keep numbering going, not reuse numbers)
  const A = [item('Sugar', 'சர்க்கரை', 'KG', 0.25, 50), item('Noodles (Maggi)', 'நூடுல்ஸ்', 'PKT', 1, 14)];     // 26.50
  const Bm = [item('Maida', 'மைதா', 'KG', 2.5, 40)];                                                          // 100.00
  const C = [item('Pen (Ball)', 'பேனா', 'PCS', 1, 9)];                                                         // 9.00
  const made = [await save(26.5, 0, A), await save(100, 0, Bm), await save(50, 1), await save(10.1, 3), await save(20.2, 3)];
  assert.deepStrictEqual(made.map(b => b.billNo), [no(today, 1), no(today, 2), no(yest, 1), no(d3, 1), no(d3, 2)]);
  const back = await save(5, 1);                                  // yesterday again, after today and 3-days-ago exist
  assert.strictEqual(back.billNo, no(yest, 2));
  const todayAgain = await save(9, 0, C);
  assert.strictEqual(todayAgain.billNo, no(today, 3));

  // default view: today only
  await reopen();
  assert.strictEqual(await page.textContent('#bills-summary'), disp(today) + ' - 3 bills · ₹ 135.50');   // one day: just that date; 26.5 + 100 + 9
  assert.strictEqual(await page.locator('.day').count(), 1);
  assert.match(await page.textContent('.day-head'), /3 bills · ₹ 135\.50/);
  assert.deepStrictEqual(await page.locator('.billrows thead th').allTextContents(), ['SNo', 'Bill No', 'Grand Total', 'Ops']);
  const cells = tr => tr.locator('td').evaluateAll(tds => tds.map(t => t.textContent.trim()));
  assert.deepStrictEqual(await cells(page.locator('.billrows tbody tr').nth(0)), ['1', no(today, 3), '9.00', 'ViewPrint']);        // newest first
  assert.deepStrictEqual(await cells(page.locator('.billrows tbody tr').nth(2)), ['3', no(today, 1), '26.50', 'ViewPrint']);
  assert.strictEqual(await page.locator('.billrows .op-view').count(), 3);
  assert.ok(await page.locator('.billrows .op-print').first().isEnabled());
  assert.ok(await page.locator('#bills-export').isVisible() && !(await page.locator('.primary.wide').count()), 'export is a small link below the list now');
  assert.match(await page.textContent('#bills-export'), /Export to Excel \(3 bills\)/);

  // View: the bill as a read-only table, then Print from it
  await page.locator('.billrows tbody tr').nth(0).locator('.op-view').click();
  assert.ok(await page.locator('#view-overlay').isVisible());
  assert.strictEqual(await page.textContent('#view-title'), 'Bill ' + no(today, 3));
  assert.match(await page.textContent('#view-sub'), new RegExp('^' + disp(today) + ' \\d{2}:\\d{2}$'));
  assert.deepStrictEqual(await page.locator('.viewtable thead th').allTextContents(), ['SNo', 'Amt', 'Product name', 'Qty', 'T. Amount']);
  assert.deepStrictEqual(await cells(page.locator('#view-body tr').nth(0)), ['1', '9.00', 'Pen (Ball) - பேனா', '1 Pcs', '9.00']);
  assert.strictEqual(await page.textContent('#view-total'), '9.00');
  assert.ok(await page.locator('#view-note').isHidden()); assert.ok(await page.locator('#view-print').isEnabled());
  await page.screenshot({ path: shots + '/bill-view.png' });
  await page.click('#view-print');
  await page.waitForSelector('#receipt-overlay:not([hidden])');
  assert.strictEqual(await page.evaluate(() => window.__prints), 1);
  const paper = await page.textContent('#receipt-paper');
  assert.ok(paper.includes('Bill No: ' + no(today, 3)) && paper.includes('Pen (Ball)') && paper.includes('₹ 9.00'), paper);
  assert.match(paper, new RegExp(disp(today) + ' \\d{2}:\\d{2}'));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));          // print dialog closes: back to the View
  assert.ok(await page.locator('#receipt-overlay').isHidden()); assert.ok(await page.locator('#view-overlay').isVisible());
  await page.click('#view-close'); assert.ok(await page.locator('#view-overlay').isHidden());

  // Print straight from the row: Maida 2.5 kg
  await page.locator('.billrows tbody tr').nth(1).locator('.op-print').click();
  await page.waitForSelector('#receipt-overlay:not([hidden])');
  assert.strictEqual(await page.evaluate(() => window.__prints), 2);
  const paper2 = await page.textContent('#receipt-paper');
  assert.ok(paper2.includes('Bill No: ' + no(today, 2)) && paper2.includes('Maida') && paper2.includes('2.5 KG × 40.00') && paper2.includes('₹ 100.00'), paper2);
  await page.click('#receipt-new'); assert.ok(await page.locator('#receipt-overlay').isHidden());

  // backup warning: two earlier days are not exported; the tab shows a dot
  assert.ok(await page.locator('#bills-warn').isVisible());
  assert.ok(await page.locator('#bills-dot').isVisible());
  assert.match(await page.textContent('#bills-warn-text'), /2 earlier days/);

  // a wider range, grouped per day, newest day first
  await page.fill('#bills-from', disp(d3));
  assert.strictEqual(await page.locator('.day').count(), 3);
  assert.strictEqual(await page.textContent('#bills-summary'), disp(d3) + ' - ' + disp(today) + ' - 7 bills · ₹ 220.80');   // a range: from - to; 135.5 + 55 + 30.3
  const heads = await page.locator('.day-head').allTextContents();
  assert.match(heads[0], /today/); assert.match(heads[1], /2 bills · ₹ 55\.00.*not exported/); assert.match(heads[2], /2 bills · ₹ 30\.30.*not exported/);
  await page.screenshot({ path: shots + '/bills.png' });

  // reversed boxes behave the same
  await page.fill('#bills-from', disp(today)); await page.fill('#bills-to', disp(d3));
  assert.strictEqual(await page.textContent('#bills-summary'), disp(d3) + ' - ' + disp(today) + ' - 7 bills · ₹ 220.80');
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
  assert.deepStrictEqual(wb.SheetNames, ['Bills', 'Bill items']);
  const items = XLSX.utils.sheet_to_json(wb.Sheets['Bill items'], { raw: false });
  assert.deepStrictEqual(items.map(r => [r.date, r.bill_no, r.sno, r.product_name, r.qty, r.unit, r.amt, r.t_amount]).map(r => r.join('|')), [
    [disp(today), no(today, 1), 1, 'Sugar - சர்க்கரை', 0.25, 'Kg', '50.00', '12.50'], [disp(today), no(today, 1), 2, 'Noodles (Maggi) - நூடுல்ஸ்', 1, 'Pkt', '14.00', '14.00'],
    [disp(today), no(today, 2), 1, 'Maida - மைதா', 2.5, 'Kg', '40.00', '100.00'], [disp(today), no(today, 3), 1, 'Pen (Ball) - பேனா', 1, 'Pcs', '9.00', '9.00']].map(r => r.join('|')));   // the bills without items have no rows here
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

  // a bill saved by an older version (old-style number, no items) still lists, views and exports sensibly
  const d30 = await day(30);
  await page.evaluate(d => new Promise((res, rej) => {
    const rq = indexedDB.open('voice-billing');
    rq.onsuccess = () => { const db = rq.result, tx = db.transaction('bills', 'readwrite'); tx.objectStore('bills').put({ billNo: d.replace(/-/g, '') + '-001', date: d, total: 50 }); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
    rq.onerror = () => rej(rq.error);
  }), d30);
  await page.fill('#bills-from', disp(d30)); await page.fill('#bills-to', disp(d30));
  await page.evaluate(() => Bills.refresh());
  assert.strictEqual(await page.textContent('#bills-summary'), disp(d30) + ' - 1 bill · ₹ 50.00');
  const oldRow = page.locator('.billrows tbody tr').nth(0);
  assert.deepStrictEqual(await oldRow.locator('td').evaluateAll(tds => tds.map(t => t.textContent.trim())), ['1', no(d30, 1), '50.00', 'ViewPrint']);   // shown in the new number style
  assert.ok(await oldRow.locator('.op-print').isDisabled(), 'an older bill without items cannot be reprinted');
  await oldRow.locator('.op-view').click();
  assert.strictEqual(await page.textContent('#view-title'), 'Bill ' + no(d30, 1));
  assert.ok(await page.locator('#view-note').isVisible()); assert.strictEqual(await page.textContent('#view-total'), '50.00');
  assert.strictEqual(await page.locator('#view-body tr').count(), 0); assert.ok(await page.locator('#view-print').isDisabled());
  await page.screenshot({ path: shots + '/bill-view-old.png' });
  await page.click('#view-close');
  const dlOld = await exportNow('#bills-export');
  const wbOld = await readXlsx(dlOld);
  assert.deepStrictEqual(rows(wbOld, 'Bills').map(r => [r.bill_no, r.total]), [[no(d30, 1), 50]]);
  assert.strictEqual(rows(wbOld, 'Bill items').length, 0);

  assert.deepStrictEqual(problems, []);
  console.log('e2e bills passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
