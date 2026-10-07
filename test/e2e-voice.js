// node test/e2e-voice.js — needs playwright + a static server on :8000. Uses a scripted fake speech engine.
const { chromium } = require('playwright');
const assert = require('assert');
const os = require('os');

const FAKE = () => {
  window.__rec = { langs: [], starts: 0 };
  window.__say = { alts: [], error: null, interim: '', hold: false };
  class FakeSR {
    start() {
      window.__rec.starts++; window.__rec.langs.push(this.lang);
      setTimeout(() => {
        this.onstart && this.onstart();
        const s = window.__say;
        if (s.hold) { this._held = true; return; }
        if (s.interim) this.onresult({ results: [Object.assign([{ transcript: s.interim }], { isFinal: false })] });
        setTimeout(() => {
          if (s.error) this.onerror({ error: s.error });
          else if (s.alts.length) this.onresult({ results: [Object.assign(s.alts.map(t => ({ transcript: t })), { isFinal: true })] });
          this.onend && this.onend();
        }, 30);
      }, 10);
    }
    stop() { if (this._held) { this._held = false; this.onend && this.onend(); } }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
};

(async () => {
  const shots = process.env.SHOT_DIR || os.tmpdir();
  const browser = await chromium.launch();
  const problems = [];
  async function open(init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push(e.message)); page.on('console', m => m.type() === 'error' && problems.push(m.text()));
    await page.addInitScript(init);
    await page.goto((process.env.BASE || 'http://localhost:8000/'));
    return page;
  }
  const say = (page, o) => page.evaluate(o => { window.__say = Object.assign({ alts: [], error: null, interim: '', hold: false }, o); }, o);
  const speak = async (page, o) => {
    await say(page, o);
    const before = await page.evaluate(() => window.__rec.starts);
    await page.click('#bill-mic');
    // done = the engine ran, the mic is idle again, and a result/error message is showing
    await page.waitForFunction(b => window.__rec.starts > b && !document.getElementById('bill-mic').classList.contains('listening') &&
      document.getElementById('voice-heard').textContent !== '' && !/^Listening/.test(document.getElementById('voice-heard').textContent), before);
  };
  const heard = page => page.textContent('#voice-heard');
  const results = page => page.locator('#bill-results .result').allTextContents();

  // ---------- no speech support ----------
  {
    const page = await open(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    await page.click('#tab-billing');
    assert.ok(await page.locator('#bill-mic').isDisabled());
    assert.match(await heard(page), /isn't available in this browser/);
    await page.context().close();
  }

  const page = await open(FAKE);
  await page.click('#tab-billing');
  assert.ok(await page.locator('#bill-mic').isDisabled(), 'no mic before products are loaded');
  await page.click('#tab-products');
  await page.setInputFiles('#prod-file', 'sample/products.xlsx');
  await page.waitForFunction(() => document.querySelectorAll('#prod-body tr').length === 103);
  await page.click('#tab-billing');
  assert.ok(await page.locator('#bill-mic').isEnabled());

  const total = () => page.textContent('#bill-total');
  const qtyOf = i => page.locator('.line').nth(i).locator('.l-qty').inputValue();

  // 1. English: "two kg sugar" -> Sugar first, 2 KG; tap adds it
  await speak(page, { alts: ['two kg sugar'], interim: 'two kg su' });
  assert.match(await heard(page), /Heard “two kg sugar” → 2 KG/);
  let r = await results(page);
  assert.ok(r.length <= 3 + 1 && /^Sugar/.test(r[0]) && /2 KG/.test(r[0]), r.join(' | '));
  assert.strictEqual(await page.inputValue('#bill-search'), 'sugar');
  assert.strictEqual(await page.locator('#bill-cart .line').count(), 0, 'voice alone adds nothing — the cashier taps');
  await page.screenshot({ path: shots + '/voice-suggest.png' });
  await page.locator('#bill-results .result').first().click();
  assert.strictEqual(await qtyOf(0), '2'); assert.strictEqual(await total(), '96.00');
  assert.strictEqual(await page.inputValue('#bill-search'), ''); assert.ok(await page.locator('#bill-results').isHidden());

  // 2. Tamil language toggle: engine receives ta-IN; Tamil spoken in English letters; same product adds on
  assert.strictEqual(await page.textContent('#bill-lang'), 'EN');
  await page.click('#bill-lang'); assert.strictEqual(await page.textContent('#bill-lang'), 'தமிழ்');
  await speak(page, { alts: ['rendu kilo sakkarai'] });
  assert.deepStrictEqual(await page.evaluate(() => window.__rec.langs), ['en-IN', 'ta-IN']);
  await page.locator('#bill-results .result').first().click();
  assert.strictEqual(await qtyOf(0), '4'); assert.strictEqual(await total(), '192.00');

  // 3. Tamil script, spelled as Chrome would return it
  await speak(page, { alts: ['அரை கிலோ தக்காளி'] });
  r = await results(page); assert.ok(/^Tomato/.test(r[0]) && /0\.5 KG/.test(r[0]), r.join(' | '));
  await page.locator('#bill-results .result').first().click();
  assert.strictEqual(await qtyOf(1), '0.5');

  // 4. unit that does not fit how the item is sold: quantity falls back to 1 with a warning
  await speak(page, { alts: ['two kg maggi'] });
  r = await results(page); assert.ok(/^Noodles \(Maggi\)/.test(r[0]) && /⚠ 1 PKT/.test(r[0]), r.join(' | '));
  await page.locator('#bill-results .result').first().click();
  assert.strictEqual(await qtyOf(2), '1');
  assert.match(await heard(page), /sold per PKT.*check/i);

  // 5. gram -> kg conversion
  await speak(page, { alts: ['250 gram onion'] });
  r = await results(page); assert.ok(/^Onion/.test(r[0]) && /0\.25 KG/.test(r[0]), r.join(' | '));

  // 6. the engine's second guess is used when the first matches nothing
  await speak(page, { alts: ['qzxwv', 'two sugar'] });
  r = await results(page); assert.ok(/^Sugar/.test(r[0]), r.join(' | '));

  // 7. nothing matches
  await speak(page, { alts: ['qzxwv'] });
  assert.match(await heard(page), /no matching product/); assert.deepStrictEqual(await results(page), []);

  // 8. ambiguous word: three suggestions plus "see all"; "see all" shows the typed list
  await speak(page, { alts: ['oil'] });
  r = await results(page); assert.strictEqual(r.length, 4, r.join(' | ')); assert.match(r[3], /See all matches for “oil”/);
  await page.locator('#bill-results .more').click();
  assert.ok((await results(page)).length >= 4); assert.ok(!/See all/.test((await results(page)).join()));

  // 9. typing replaces the voice list
  await speak(page, { alts: ['sugar'] });
  await page.fill('#bill-search', 'salt');
  r = await results(page); assert.ok(/^Salt/.test(r[0]) && !/KG ·/.test(r[0]), r.join(' | '));

  // 10. errors give a plain message and keep typing available
  for (const [code, re] of [['not-allowed', /microphone is blocked/], ['no-speech', /Didn't catch that/], ['network', /needs internet/], ['audio-capture', /No microphone/]]) {
    await speak(page, { error: code });
    assert.match(await heard(page), re, code);
  }
  assert.ok(await page.locator('#bill-search').isEnabled());

  // 11. listening state, then stop
  await say(page, { hold: true });
  await page.click('#bill-mic');
  await page.waitForSelector('#bill-mic.listening');
  assert.ok(await page.locator('#bill-lang').isDisabled());
  assert.strictEqual(await page.getAttribute('#bill-mic', 'aria-pressed'), 'true');
  await page.screenshot({ path: shots + '/voice-listening.png' });
  await page.click('#bill-mic');
  await page.waitForSelector('#bill-mic:not(.listening)');
  assert.ok(await page.locator('#bill-lang').isEnabled());

  // 12. a voice-built bill goes through the normal flow
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('#bill-generate');
  await page.waitForSelector('#receipt-overlay:not([hidden])');
  assert.match(await page.textContent('#receipt-paper'), /Sugar[\s\S]*4 KG/);

  // language choice survives a reload
  await page.reload(); await page.click('#tab-billing');
  assert.strictEqual(await page.textContent('#bill-lang'), 'தமிழ்');

  assert.deepStrictEqual(problems, []);
  console.log('e2e voice passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
