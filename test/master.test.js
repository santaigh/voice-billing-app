// node test/master.test.js — the master price list fetch, with a fake fetch (no network)
const assert = require('assert');
const XLSX = require('../vendor/xlsx.full.min.js');
const Master = require('../js/master.js');

const CSV = 'code,name_en,name_ta,unit,price,aliases\nP001,Sugar,சர்க்கரை,KG,48,sakkarai\nP002,,Bad,KG,1,\n';
const reply = (status, body) => () => Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) });
const run = (fetchFn) => Master.refresh('https://example.test/list.csv', { fetch: fetchFn, XLSX });

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

(async () => {
  await t('no link configured: skipped, nothing fetched', async () => {
    let called = false;
    const r = await Master.refresh('', { fetch: () => { called = true; }, XLSX });
    assert.deepStrictEqual(r, { skipped: true }); assert.ok(!called);
  });
  await t('a good list: products and the skipped rows come back', async () => {
    const r = await run(reply(200, CSV));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.products.map(p => p.code), ['P001']);
    assert.strictEqual(r.errors.length, 1);
  });
  await t('every failure resolves with ok:false so the caller keeps the saved list', async () => {
    const off = await run(() => Promise.reject(new TypeError('Failed to fetch')));
    assert.deepStrictEqual([off.ok, off.kind], [false, 'offline']);
    const http = await run(reply(404, 'nope'));
    assert.deepStrictEqual([http.ok, http.kind], [false, 'http']);
    const page = await run(reply(200, '<!DOCTYPE html><html><body>Sign in</body></html>'));
    assert.deepStrictEqual([page.ok, page.kind], [false, 'sheet']);
    const none = await run(reply(200, 'code,name_en,price\n,,\nP9,,5\n'));
    assert.strictEqual(none.ok, false);
    const hdr = await run(reply(200, 'a,b\n1,2\n'));
    assert.match(hdr.message, /Missing column/);
  });
  console.log(n + ' tests passed');
})().catch(e => { console.error(e); process.exit(1); });
