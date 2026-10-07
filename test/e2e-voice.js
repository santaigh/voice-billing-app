// node test/e2e-voice.js — needs playwright + a static server on :8000 (or BASE=...).
// Uses a scripted fake speech engine that behaves like Chrome's continuous mode.
const { chromium } = require('playwright');
const assert = require('assert');
const os = require('os');

const FAKE = () => {
  window.__rec = { starts: 0, langs: [], continuous: [] };
  window.__wake = { requests: 0, releases: 0 };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => { window.__wake.requests++; return Promise.resolve({ release() { window.__wake.releases++; } }); } } });
  class FakeSR {
    constructor() { this.results = []; }
    start() {
      window.__rec.starts++; window.__rec.langs.push(this.lang); window.__rec.continuous.push(this.continuous);
      window.__cur = this;
      setTimeout(() => this.onstart && this.onstart(), 5);
    }
    stop() { this._end(); }
    abort() { this._end(); }
    _end() { if (window.__cur === this) window.__cur = null; setTimeout(() => this.onend && this.onend(), 5); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  // a finished phrase, as Chrome delivers it in continuous mode
  window.__final = alts => { const r = window.__cur; r.results.push(Object.assign(alts.map(t => ({ transcript: t })), { isFinal: true })); r.onresult({ resultIndex: r.results.length - 1, results: r.results }); };
  window.__interim = text => { const r = window.__cur; const list = r.results.slice(); list.push(Object.assign([{ transcript: text }], { isFinal: false })); r.onresult({ resultIndex: r.results.length, results: list }); };
  window.__resend = () => { const r = window.__cur; r.onresult({ resultIndex: 0, results: r.results }); };   // Android Chrome re-sends the whole list
  window.__sessionEnd = () => { const r = window.__cur; window.__cur = null; r.onend(); };               // Chrome ends the session itself
  window.__error = code => { const r = window.__cur; r.onerror({ error: code }); };
};

(async () => {
  const shots = process.env.SHOT_DIR || os.tmpdir();
  const base = process.env.BASE || 'http://localhost:8000/';
  const browser = await chromium.launch();
  const problems = [];
  async function open(init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push(e.message)); page.on('console', m => m.type() === 'error' && problems.push(m.text()));
    await page.addInitScript(init);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await page.goto(base);
    return page;
  }
  const loadProducts = async page => {
    await page.click('#tab-products');
    await page.setInputFiles('#prod-file', 'sample/products.xlsx');
    await page.waitForFunction(() => document.querySelectorAll('#prod-body tr').length === 103);
    await page.click('#tab-billing');
  };

  // ---------- no speech support ----------
  {
    const page = await open(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    await page.click('#tab-billing');
    assert.ok(await page.locator('#bill-mic').isDisabled());
    assert.match(await page.textContent('#voice-heard'), /isn't available in this browser/);
    await page.context().close();
  }

  const page = await open(FAKE);
  await page.click('#tab-billing');
  assert.ok(await page.locator('#bill-mic').isDisabled(), 'no mic before products are loaded');
  await loadProducts(page);
  assert.ok(await page.locator('#bill-mic').isEnabled());
  await page.evaluate(() => { Voice.config.minRunMs = 0; });   // the fake ends sessions instantly; not "cutting out"

  const say = (...alts) => page.evaluate(a => window.__final(a), alts);
  const rows = () => page.locator('#bill-cart .line');
  const cell = (i, c) => page.locator('#bill-cart .line').nth(i).locator(c);
  const total = () => page.textContent('#bill-total');
  const heard = () => page.textContent('#voice-heard');
  const starts = () => page.evaluate(() => window.__rec.starts);
  const mic = () => page.getAttribute('#bill-mic', 'aria-pressed');
  // a row as the cashier reads it: SNo, Amt, name, Qty + unit, T. Amount (the inputs' values included)
  const rowText = i => rows().nth(i).evaluate(tr => ['.c-sno', '.l-price', '.c-name', '.l-qty', '.l-unit', '.l-total']
    .map(q => { const e = tr.querySelector(q); return e.value !== undefined ? e.value : e.textContent; }).join(' '));
  const suggestions = () => page.locator('#bill-results .result').allTextContents();

  assert.ok(await page.locator('#bill-table').isHidden(), 'no table while the bill is empty');

  // ---------- 1. one tap starts live listening ----------
  await page.click('#bill-mic');
  await page.waitForSelector('#voice-live:not([hidden])');
  assert.strictEqual(await mic(), 'true');
  assert.deepStrictEqual(await page.evaluate(() => [window.__rec.starts, window.__rec.langs, window.__rec.continuous]), [1, ['en-IN'], [true]]);
  assert.match(await page.textContent('#voice-live'), /LIVE/);
  assert.ok(await page.locator('#bill-lang').isDisabled());
  assert.strictEqual(await page.evaluate(() => window.__wake.requests), 1, 'screen kept awake while live');
  await page.evaluate(() => window.__interim('maida 2 k'));
  assert.match(await page.textContent('#voice-live'), /maida 2 k/);

  // ---------- 2. "Maida 2 Kg" is added straight away; table row is as specified ----------
  await say('Maida 2 Kg');
  assert.ok(await page.locator('#bill-table').isVisible());
  assert.deepStrictEqual(await page.locator('#bill-table thead th').allTextContents(), ['SNo', 'Amt', 'Product name', 'Qty', 'T. Amount', 'Ops']);
  assert.strictEqual(await rows().count(), 1);
  assert.strictEqual(await cell(0, '.c-sno').textContent(), '1');
  assert.strictEqual(await cell(0, '.l-price').inputValue(), '42.00');
  assert.strictEqual(await cell(0, '.c-name').textContent(), 'Maida - மைதா');
  assert.strictEqual(await cell(0, '.l-qty').inputValue(), '2');
  assert.strictEqual(await cell(0, '.l-unit').textContent(), 'Kg');
  assert.strictEqual(await cell(0, '.l-total').textContent(), '84.00');
  assert.ok(await cell(0, '.l-remove').isVisible());
  assert.strictEqual(await total(), '84.00');
  assert.strictEqual(await mic(), 'true', 'still live after an add');
  assert.deepStrictEqual(await suggestions(), [], 'a clear match needs no tapping');
  assert.match(await page.textContent('#undo-text'), /Added Maida · 2 Kg/);
  assert.match(await heard(), /Heard “Maida 2 Kg” → added/);
  assert.strictEqual(await starts(), 1, 'no restart needed so far');

  // ---------- 3. the bill grows: next product is the next row; Grand Total adds the T. Amounts ----------
  await say('sugar 1 kg');
  assert.strictEqual(await rows().count(), 2);
  assert.strictEqual(await rowText(1), '2 48.00 Sugar - சர்க்கரை 1 Kg 48.00');
  assert.strictEqual(await total(), '132.00');
  assert.match(await page.textContent('.bb-total'), /Grand Total/);
  assert.match(await page.locator('#bill-table tfoot').innerText(), /Grand Total\s*₹/);   // also as the last row of the table, under T. Amount
  assert.strictEqual(await page.textContent('#bill-foot-total'), '132.00');
  await page.screenshot({ path: shots + '/live-table.png' });

  // ---------- 4. "to kg" (Chrome's spelling of "two kg"); same product merges into its row; Undo ----------
  await say('maida to kg');
  assert.strictEqual(await rows().count(), 2);
  assert.strictEqual(await cell(0, '.l-qty').inputValue(), '4');
  assert.strictEqual(await total(), '216.00');
  await page.click('#undo-btn');
  assert.strictEqual(await cell(0, '.l-qty').inputValue(), '2');
  assert.strictEqual(await total(), '132.00');
  assert.ok(await page.locator('#undo-bar').isHidden());
  await say('tomato 1 kg');                                         // a new row can be undone entirely
  assert.strictEqual(await rows().count(), 3);
  await page.click('#undo-btn');
  assert.strictEqual(await rows().count(), 2);

  // ---------- 5. Tamil: spoken Tamil name, adds without tapping ----------
  await say('அரை கிலோ தக்காளி');
  assert.strictEqual(await rows().count(), 3);
  assert.strictEqual(await rowText(2), '3 30.00 Tomato - தக்காளி 0.5 Kg 15.00');
  assert.strictEqual(await total(), '147.00');
  await cell(2, '.l-remove').click();                               // delete icon
  assert.strictEqual(await rows().count(), 2); assert.strictEqual(await total(), '132.00');

  // ---------- 6. ambiguous: ask (tap), keep listening ----------
  await say('chilli 1 kg');
  assert.strictEqual(await rows().count(), 2, 'not added on its own');
  let sug = await suggestions();
  assert.ok(sug.length >= 3 && sug.some(t => /Dry Red Chilli/.test(t)), sug.join(' | '));
  assert.match(await heard(), /Tap the right product/);
  assert.strictEqual(await mic(), 'true');
  await page.locator('#bill-results .result', { hasText: 'Green Chilli' }).click();
  assert.strictEqual(await rows().count(), 3);
  assert.match(await rowText(2), /^3 60\.00 Green Chilli - .+ 1 Kg 60\.00$/);
  await cell(2, '.l-remove').click();

  // ---------- 7. a unit that does not fit: asks, with a warning, quantity 1 ----------
  await say('two kg maggi');
  sug = await suggestions();
  assert.ok(/^Noodles \(Maggi\)/.test(sug[0]) && /⚠ 1 Pkt/.test(sug[0]), sug.join(' | '));
  assert.strictEqual(await rows().count(), 2);
  await page.locator('#bill-results .result').first().click();
  assert.match(await rowText(2), /Noodles \(Maggi\).* 1 Pkt 14\.00$/);
  assert.match(await heard(), /sold per PKT/);
  await cell(2, '.l-remove').click();

  // ---------- 8. chatter is ignored; duplicates are not added twice ----------
  await say('qzxwv blah');
  assert.match(await heard(), /no product matched, ignored/);
  assert.strictEqual(await rows().count(), 2);
  await say('onion 1 kg');
  assert.strictEqual(await rows().count(), 3); const afterOnion = await total();
  await page.evaluate(() => window.__resend());
  await page.evaluate(() => window.__resend());
  assert.strictEqual(await rows().count(), 3); assert.strictEqual(await total(), afterOnion, 'a re-sent result list must not add again');
  await cell(2, '.l-remove').click();

  // ---------- 9. Chrome ends the session on its own: quietly restarts, still live ----------
  const before = await starts();
  await page.evaluate(() => window.__sessionEnd());
  await page.waitForFunction(b => window.__rec.starts === b + 1, before);
  assert.strictEqual(await mic(), 'true');
  await say('sugar 1 kg');                                          // the new session works
  assert.strictEqual(await cell(1, '.l-qty').inputValue(), '2');
  assert.strictEqual(await total(), '180.00');
  await page.click('#undo-btn');

  // ---------- 10. "bill confirm": countdown, cancel by voice, then really confirm ----------
  await say('confirm');                                             // one word alone does nothing
  assert.ok(await page.locator('#confirm-bar').isHidden());
  await say('bill confirm');
  assert.ok(await page.locator('#confirm-bar').isVisible());
  assert.match(await page.textContent('#confirm-text'), /Saving bill ₹ 132\.00 in 3/);
  await page.screenshot({ path: shots + '/live-confirm.png' });
  await say('cancel');
  assert.ok(await page.locator('#confirm-bar').isHidden());
  assert.strictEqual(await rows().count(), 2); assert.strictEqual(await page.evaluate(() => Store.loadBills().then(b => b.length)), 0);
  await say('bill confirm');                                        // a new item during the countdown cancels it
  await say('onion 1 kg');
  assert.ok(await page.locator('#confirm-bar').isHidden());
  assert.match(await heard(), /Confirmation cancelled/);
  await page.click('#undo-btn');
  await page.locator('#bill-cart .line').nth(0).locator('.l-qty').fill('2');   // an edit during the countdown cancels it too
  await say('bill confirm');
  await page.locator('#bill-cart .line').nth(0).locator('.l-qty').fill('3');
  assert.ok(await page.locator('#confirm-bar').isHidden());
  await page.locator('#bill-cart .line').nth(0).locator('.l-qty').fill('2');

  await say('bill confirm');
  await page.waitForSelector('#receipt-overlay:not([hidden])', { timeout: 6000 });
  assert.strictEqual(await page.evaluate(() => window.__prints), 1);
  const today = await page.evaluate(() => Bill.localDate(new Date()));
  const no1 = today.replace(/-/g, '') + '-001';
  assert.match(await page.textContent('#receipt-paper'), new RegExp('Bill No: ' + no1 + '[\\s\\S]*Maida[\\s\\S]*TOTAL[\\s\\S]*₹ 132\\.00'));
  assert.strictEqual(await rows().count(), 0, 'the table is cleared for the next customer');
  assert.deepStrictEqual(await page.evaluate(() => Store.loadBills()), [{ billNo: no1, date: today, total: 132 }]);
  assert.strictEqual(await mic(), 'true', 'still live for the next customer');
  await say('sugar 1 kg');                                          // receipt still open: not added to the next bill yet
  assert.strictEqual(await rows().count(), 0);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));   // the print dialog closes
  assert.ok(await page.locator('#receipt-overlay').isHidden());
  assert.match(await page.textContent('#last-bill-text'), new RegExp(no1 + ' · ₹ 132\\.00'));
  await say('sugar 1 kg');                                          // next customer
  assert.strictEqual(await rows().count(), 1); assert.strictEqual(await cell(0, '.c-sno').textContent(), '1'); assert.strictEqual(await total(), '48.00');
  await page.screenshot({ path: shots + '/live-next.png' });

  // empty bill: "bill confirm" says so; manual Generate Bill still works while live
  await cell(0, '.l-remove').click();
  await say('bill confirm');
  assert.match(await heard(), /the bill is empty/); assert.ok(await page.locator('#confirm-bar').isHidden());
  await say('paneer');
  await page.click('#bill-generate');
  await page.waitForSelector('#receipt-overlay:not([hidden])');
  assert.match(await page.textContent('#receipt-paper'), /Bill No: \d+-002[\s\S]*Paneer 200g[\s\S]*₹ 90\.00/);
  await page.click('#receipt-new');
  await page.click('#last-bill-reprint');                           // reprint the last bill
  assert.strictEqual(await page.evaluate(() => window.__prints), 3);
  await page.click('#receipt-new');
  assert.strictEqual(await mic(), 'true');

  // ---------- 11. tapping the mic stops it; the screen is released ----------
  await page.click('#bill-mic');
  await page.waitForSelector('#bill-mic:not(.listening)');
  assert.strictEqual(await mic(), 'false');
  assert.ok(await page.locator('#voice-live').isHidden()); assert.ok(await page.locator('#bill-lang').isEnabled());
  assert.strictEqual(await page.evaluate(() => window.__wake.releases), 1);

  // ---------- 12. language: Tamil goes to the engine ----------
  await page.click('#bill-lang'); assert.strictEqual(await page.textContent('#bill-lang'), 'தமிழ்');
  await page.click('#bill-mic'); await page.waitForSelector('#bill-mic.listening');
  assert.strictEqual(await page.evaluate(() => window.__rec.langs[window.__rec.langs.length - 1]), 'ta-IN');
  await page.click('#bill-mic'); await page.waitForSelector('#bill-mic:not(.listening)');

  // ---------- 13. fatal errors stop live listening with a plain message ----------
  for (const [code, re] of [['not-allowed', /microphone is blocked/], ['network', /needs internet/], ['audio-capture', /No microphone/]]) {
    await page.click('#bill-mic'); await page.waitForSelector('#bill-mic.listening');
    await page.evaluate(c => window.__error(c), code);
    await page.waitForSelector('#bill-mic:not(.listening)');
    assert.match(await heard(), re, code);
  }
  assert.ok(await page.locator('#bill-search').isEnabled(), 'typing still works');

  // ---------- 14. a microphone that keeps cutting out gives up instead of looping ----------
  await page.evaluate(() => { Voice.config.minRunMs = 1500; Voice.config.restartDelayMs = 10; });
  await page.click('#bill-mic'); await page.waitForSelector('#bill-mic.listening');
  for (let i = 0; i < 4; i++) {
    await page.waitForFunction(() => window.__cur);
    await page.evaluate(() => window.__sessionEnd());
  }
  await page.waitForSelector('#bill-mic:not(.listening)');
  assert.match(await heard(), /keeps cutting out/);

  assert.deepStrictEqual(problems, []);
  console.log('e2e voice passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
