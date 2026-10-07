// node test/e2e-cloud.js — needs playwright + a static server on :8000 (or BASE=...).
// A local stand-in for the Google Apps Script web address is started on another port, in two flavours:
//   cors:true   the page may read the reply            -> the app must use its "normal" mode
//   cors:false  the page may NOT read the reply        -> the app must fall back to "blind" mode (POST, then confirm by JSONP)
const { chromium } = require('playwright');
const assert = require('assert');
const http = require('http');
const os = require('os');

// ---------------------------------------------------------------- the stand-in script
function startMock(cors, port) {
  const state = { bills: [], posts: [], gets: [], preflights: 0, down: false, hang: false, dropReply: 0, key: 'SECRET', refuseTotal: null, echo: {}, n: 0 };
  const base = 'http://localhost:' + port;
  const origin = res => { if (cors) res.setHeader('Access-Control-Allow-Origin', '*'); };

  function handle(body) {
    if (body.key !== state.key) return { ok: false, error: 'bad key' };
    if (body.action === 'ping') return { ok: true, url: 'https://docs.example/sheet', bills: state.bills.length };
    if (body.action === 'bills') {
      const results = body.bills.map(b => {
        if (!/^\d{8}-\d{3,}$/.test(b.id) || b.id.slice(0, 8) !== b.date.slice(8) + b.date.slice(5, 7) + b.date.slice(0, 4)) return { id: b.id, error: 'bad bill id' };
        if (state.refuseTotal !== null && b.total === state.refuseTotal) return { id: b.id, error: 'bad total' };
        if (state.bills.some(x => x.id === b.id)) return { id: b.id, duplicate: true };
        state.bills.push(b);
        return { id: b.id, sl: state.bills.length };
      });
      return { ok: true, added: results.filter(r => r.sl).length, results };
    }
    return { ok: false, error: 'unknown action' };
  }

  const server = http.createServer((req, res) => {
    if (state.down) { req.socket.destroy(); return; }
    const url = new URL(req.url, base);
    if (req.method === 'OPTIONS') { state.preflights++; origin(res); res.writeHead(cors ? 204 : 404, { 'Access-Control-Allow-Headers': '*' }); res.end(); return; }
    if (req.method === 'POST' && url.pathname === '/exec') {
      let raw = '';
      req.on('data', c => raw += c);
      req.on('end', () => {
        if (state.hang) return;                                       // never answers
        const body = JSON.parse(raw);
        state.posts.push({ body, contentType: req.headers['content-type'] });
        const reply = handle(body);
        if (state.dropReply > 0) { state.dropReply--; req.socket.destroy(); return; }   // processed, but the reply is lost
        const id = ++state.n; state.echo[id] = reply;                  // like Google: answer with a redirect to the real reply
        origin(res); res.writeHead(302, { Location: base + '/echo/' + id }); res.end();
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/echo/')) {
      origin(res); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(state.echo[url.pathname.split('/')[2]] || {})); return;
    }
    if (req.method === 'GET' && url.pathname === '/exec') {
      state.gets.push(req.url);
      const q = Object.fromEntries(url.searchParams);
      if (!q.action) { origin(res); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, service: 'shop-billing-sync' })); return; }
      let out;
      if (q.key !== state.key) out = { ok: false, error: 'bad key' };
      else if (q.action === 'ping') out = { ok: true, url: 'https://docs.example/sheet', bills: state.bills.length };
      else if (q.action === 'has') { const has = {}; (q.ids || '').split(',').filter(Boolean).forEach(i => { has[i] = state.bills.some(b => b.id === i); }); out = { ok: true, has }; }
      else out = { ok: false, error: 'unknown action' };
      res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(q.callback + '(' + JSON.stringify(out) + ');'); return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise(resolve => server.listen(port, () => resolve({ state, url: base + '/exec', close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) })));
}

// the number as the sheet shows it: DDMMYYYY-NNN, built from the bill's date
const labelOf = b => b.date.slice(8) + b.date.slice(5, 7) + b.date.slice(0, 4) + '-' + String(parseInt(b.billNo.split('-')[1], 10)).padStart(3, '0');

const until = async (fn, ms = 8000, what = 'condition') => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting for ' + what); await new Promise(r => setTimeout(r, 40)); }
};

// ---------------------------------------------------------------- one full run, per flavour
async function run(browser, cors, port, shots) {
  const label = cors ? 'normal' : 'blind';
  const mock = await startMock(cors, port), st = mock.state;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));                          // uncaught errors are never allowed
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(process.env.BASE || 'http://localhost:8000/');
  await page.click('#tab-products');
  await page.setInputFiles('#prod-file', 'sample/products.xlsx');
  await page.waitForFunction(() => document.querySelectorAll('#prod-body tr').length === 103);
  await page.evaluate(() => { Cloud.settings.backoff = [250, 250, 250, 250]; Cloud.settings.timeoutMs = 3000; });   // faster than real life

  const stored = () => page.evaluate(() => Store.loadBills());
  const outbox = () => page.evaluate(() => Store.listOutbox());
  const statusOf = () => page.evaluate(() => Cloud.status());
  const confirm = async (query, price) => {                                       // type a product, set a price if asked, press Generate Bill
    await page.click('#tab-billing');
    const before = (await stored()).length;
    await page.fill('#bill-search', query); await page.press('#bill-search', 'Enter');
    if (price) await page.locator('#bill-cart .line').last().locator('.l-price').fill(price);
    const t0 = Date.now();
    await page.click('#bill-generate');
    await until(async () => (await stored()).length === before + 1, 4000, 'the bill to be saved');
    return Date.now() - t0;
  };
  const line = async () => { await page.click('#tab-bills'); await page.evaluate(() => Bills.refresh()); return (await page.textContent('#cloud-line')).replace(/\s+/g, ' ').trim(); };
  const sentIds = () => st.bills.map(b => b.id);

  // ---- 1. not connected: billing works, nothing is queued, no status line ----
  await confirm('maida');
  assert.deepStrictEqual(await outbox(), []);
  await page.click('#tab-bills'); assert.ok(await page.locator('#cloud-line').isHidden());
  assert.strictEqual(st.posts.length, 0);

  // ---- 2. Save & test: bad input, wrong key, then the right key ----
  await page.click('#tab-products');
  await page.fill('#cloud-url', 'abc'); await page.fill('#cloud-key', 'x'); await page.click('#cloud-save');
  assert.match(await page.textContent('#cloud-msg'), /Paste the Web app URL/);
  await page.fill('#cloud-url', mock.url); await page.fill('#cloud-key', 'WRONG'); await page.click('#cloud-save');
  await page.waitForFunction(() => /key is wrong/.test(document.getElementById('cloud-msg').textContent));
  assert.strictEqual((await statusOf()).connected, false); assert.match(await page.textContent('#cloud-conn'), /Not connected/);
  assert.deepStrictEqual(await page.evaluate(() => Store.getCloud()), null, 'a failed test saves nothing');
  await page.fill('#cloud-key', 'SECRET'); await page.click('#cloud-save');
  await page.waitForFunction(() => /Connected/.test(document.getElementById('cloud-msg').textContent));
  const mode = (await statusOf()).mode;
  assert.strictEqual(mode, cors ? 'normal' : 'blind', label);
  assert.match(await page.textContent('#cloud-conn'), cors ? /Connected \(normal\)/ : /Connected \(blind mode\)/);
  assert.match(await page.textContent('#cloud-msg'), /sheet has 0 bill/); assert.ok(await page.locator('#cloud-sheet-link').isVisible());
  assert.strictEqual(await page.inputValue('#cloud-key'), '', 'the key is cleared from the screen once saved');
  assert.strictEqual((await page.evaluate(() => Store.getCloud())).key, 'SECRET');
  if (cors) { assert.strictEqual(st.preflights, 0, 'text/plain keeps it a simple request: no pre-flight'); assert.ok(st.posts.every(p => /^text\/plain/.test(p.contentType))); }
  else assert.ok(st.gets.some(g => /action=ping/.test(g)), 'blind mode pings through a script tag');
  await page.screenshot({ path: shots + '/cloud-box-' + label + '.png' });

  // ---- 3. Send all existing bills (the one made before connecting) ----
  await page.click('#cloud-sendall');
  await page.waitForFunction(() => /All saved bills are in the sheet/.test(document.getElementById('cloud-msg').textContent));
  assert.deepStrictEqual(sentIds(), [labelOf((await stored())[0])]);
  const first = st.bills[0];
  assert.deepStrictEqual(Object.keys(first).sort(), ['date', 'id', 'items', 'total']);
  assert.deepStrictEqual(Object.keys(first.items[0]).sort(), ['amount', 'name_en', 'name_ta', 'price', 'qty', 'unit']);
  assert.ok(/^\d{8}-001$/.test(first.id) && first.items[0].name_en === 'Maida' && first.total === 42);
  const n1 = st.bills.length;
  await page.click('#cloud-sendall');                                             // again: harmless
  await page.waitForFunction(() => /All saved bills are in the sheet/.test(document.getElementById('cloud-msg').textContent));
  assert.strictEqual(st.bills.length, n1, 'pressing it twice adds nothing');
  assert.deepStrictEqual(await outbox(), []);

  // ---- 4. a new bill goes by itself; billing is instant; the status line says so ----
  const ms = await confirm('sugar');
  await until(() => st.bills.length === 2, 5000, 'bill 2 to arrive');
  assert.ok(ms < 1500, 'billing did not wait for Google (' + ms + ' ms)');
  assert.deepStrictEqual(sentIds().map(i => i.slice(-3)), ['001', '002']);
  await until(async () => (await outbox()).length === 0, 4000, 'the to-send list to empty');
  assert.match(await line(), /✓ Google Sheet is up to date/);
  assert.strictEqual(await page.getAttribute('#cloud-open', 'href'), 'https://docs.example/sheet');
  if (!cors) assert.ok(st.gets.some(g => /action=has/.test(g)), 'blind mode confirmed the bill with a second request');
  await page.screenshot({ path: shots + '/cloud-line-' + label + '.png' });

  // ---- 5. Google unreachable: the bill is kept, billing is unaffected, it is sent by itself when Google is back ----
  st.down = true;
  const ms2 = await confirm('rice');
  assert.ok(ms2 < 1500, 'billing unaffected by an unreachable Google (' + ms2 + ' ms)');
  await until(async () => /waiting|reach/.test(await line()), 4000, 'the waiting status');
  assert.strictEqual((await outbox()).length, 1); assert.strictEqual(st.bills.length, 2);
  await page.screenshot({ path: shots + '/cloud-waiting-' + label + '.png' });
  st.down = false;
  await until(() => st.bills.length === 3, 6000, 'the waiting bill to arrive after Google is back');
  await until(async () => (await outbox()).length === 0, 4000, 'the list to empty');
  assert.strictEqual(new Set(sentIds()).size, 3);

  // ---- 6. the reply is lost after the sheet already took the bill: the retry must not add it twice ----
  st.dropReply = 1;
  await confirm('paneer');
  await until(() => st.bills.length === 4, 5000, 'bill 4');
  await until(async () => (await outbox()).length === 0, 8000, 'the list to empty after the lost reply');
  assert.strictEqual(new Set(sentIds()).size, 4, 'no bill appears twice'); assert.strictEqual(st.bills.length, 4);

  // ---- 7. the key is changed on the script side: clear message, no endless retrying; Send now after fixing ----
  st.key = 'ROTATED';
  await confirm('onion');
  await until(async () => (await statusOf()).fatal, 5000, 'the wrong-key stop');
  assert.match(await line(), /key is wrong/);
  const postsNow = st.posts.length;
  await new Promise(r => setTimeout(r, 1200));                                    // the backoff is 250 ms: a loop would show here
  assert.strictEqual(st.posts.length, postsNow, 'no retry loop after a wrong key');
  assert.strictEqual(st.bills.length, 4); assert.strictEqual((await outbox()).length, 1);
  st.key = 'SECRET';
  await page.click('#cloud-now');
  await until(() => st.bills.length === 5, 5000, 'bill 5 after Send now');
  await until(async () => (await outbox()).length === 0, 4000, 'list empty');

  // ---- 8. the sheet refuses one bill: it is marked, not retried forever, and goes after Send now once fixed ----
  st.refuseTotal = 13.37;
  await confirm('maida', '13.37');
  await until(async () => (await outbox()).some(e => e.error), 5000, 'the refusal to be recorded');
  // normal mode can read the reason; blind mode can only see that the bill did not arrive
  assert.match(await line(), cors ? /1 bill could not be sent: bad total/ : /1 bill could not be sent: The sheet did not accept this bill/);
  const posts8 = st.posts.length;
  await new Promise(r => setTimeout(r, 900));
  assert.strictEqual(st.posts.length, posts8, 'a refused bill is not retried on its own');
  st.refuseTotal = null;
  await page.click('#cloud-now');
  await until(() => st.bills.length === 6, 5000, 'the refused bill after Send now');
  await until(async () => (await outbox()).length === 0, 4000, 'list empty');

  // ---- 9. a bill waiting when the page is closed is still sent after reopening ----
  st.down = true;
  await confirm('salt');
  await until(async () => (await outbox()).length === 1, 3000, 'the waiting bill');
  await page.reload();
  assert.strictEqual((await outbox()).length, 1, 'the to-send list survives a reload');
  assert.strictEqual((await statusOf()).connected, true, 'the connection survives a reload');
  await page.evaluate(() => { Cloud.settings.backoff = [250, 250, 250, 250]; Cloud.settings.timeoutMs = 3000; });
  st.down = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));          // the phone says it is back online: sends at once instead of waiting out the 30 s back-off
  await until(() => st.bills.length === 7, 6000, 'the waiting bill after reopening');

  // ---- 10. Google answers too slowly: the request gives up after the time-out, billing is still instant ----
  await page.evaluate(() => { Cloud.settings.timeoutMs = 500; });
  st.hang = true;
  const ms3 = await confirm('tea');
  assert.ok(ms3 < 1500, 'billing unaffected by a Google that never answers (' + ms3 + ' ms)');
  await new Promise(r => setTimeout(r, 1300));                                    // two or three time-outs and retries
  assert.strictEqual(st.bills.length, 7); assert.strictEqual((await outbox()).length, 1);
  st.hang = false;
  await until(() => st.bills.length === 8, 6000, 'the bill after the hang ends');

  // ---- 11. the sheet got every bill exactly once, under the number the app shows ----
  const ids = sentIds(), all = await stored();
  assert.strictEqual(new Set(ids).size, ids.length); assert.strictEqual(all.length, 8);
  assert.deepStrictEqual(ids.slice().sort(), all.map(labelOf).sort());

  // ---- 12. Disconnect: nothing more is sent, the list is cleared ----
  await page.click('#tab-products');
  await page.click('#cloud-disconnect');
  await page.waitForFunction(() => /Disconnected/.test(document.getElementById('cloud-msg').textContent));
  assert.strictEqual((await statusOf()).connected, false); assert.strictEqual(await page.evaluate(() => Store.getCloud()), null);
  const postsEnd = st.posts.length;
  await confirm('milk');
  await new Promise(r => setTimeout(r, 600));
  assert.strictEqual(st.posts.length, postsEnd); assert.deepStrictEqual(await outbox(), []);
  await page.click('#tab-bills'); assert.ok(await page.locator('#cloud-line').isHidden());

  assert.deepStrictEqual(problems, [], label + ': uncaught errors');
  await ctx.close();
  await mock.close();
  console.log('e2e cloud (' + label + ' mode) passed');
}


(async () => {
  const shots = process.env.SHOT_DIR || os.tmpdir();
  const browser = await chromium.launch();
  try {
    await run(browser, true, 9211, shots);
    await run(browser, false, 9212, shots);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
