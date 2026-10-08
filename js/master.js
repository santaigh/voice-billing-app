/* Fetches the shop's master price list (a published Google Sheet CSV) and checks it. Does not touch the screen or the
   saved list: the caller saves the result only when ok is true, so a failed or odd reply never wipes the list.
   refresh(url) resolves, it never rejects:
     { skipped: true }                                  no link configured
     { ok: true, products, errors }                     a good list
     { ok: false, kind: 'offline'|'http'|'sheet', message }   keep the saved list */
(function (root) {
  'use strict';

  var cfg = { timeoutMs: 8000 };
  var Catalog = root.Catalog || (typeof require !== 'undefined' ? require('./catalog.js') : null);

  function refresh(url, deps) {
    deps = deps || {};
    var fetchFn = deps.fetch || (typeof fetch !== 'undefined' ? fetch.bind(root) : null);
    var XLSX = deps.XLSX || root.XLSX;
    if (!url) return Promise.resolve({ skipped: true });
    if (!fetchFn) return Promise.resolve({ ok: false, kind: 'offline', message: 'This browser cannot fetch the price list.' });

    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, deps.timeoutMs || cfg.timeoutMs) : null;
    function done(r) { clearTimeout(timer); return r; }

    return fetchFn(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (res) {
      if (!res.ok) return done({ ok: false, kind: 'http', message: 'The price list answered with an error (' + res.status + ').' });
      return res.text().then(function (text) {
        try {
          var r = Catalog.parseCsv(XLSX, text);
          if (!r.products.length) return done({ ok: false, kind: 'sheet', message: 'The price list has no valid products.' });
          return done({ ok: true, products: r.products, errors: r.errors });
        } catch (e) {
          return done({ ok: false, kind: 'sheet', message: e.message });
        }
      });
    }, function () {
      return done({ ok: false, kind: 'offline', message: (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'No internet.' : 'Could not reach the price list.' });
    });
  }

  var api = { refresh: refresh, settings: cfg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Master = api;
})(typeof window !== 'undefined' ? window : this);
