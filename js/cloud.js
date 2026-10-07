/* Sends every confirmed bill to the owner's Google Sheet (through their Apps Script web address), in the background.
   Billing never waits for this and never fails because of it: a bill is saved on the device first and put on a
   "to send" list (the outbox) in the same transaction; this module empties that list whenever Google can be reached.

   Two ways to talk to the script, decided once by "Save & test" and remembered:
     normal  POST (Content-Type text/plain, so no pre-flight) and READ the JSON reply.
     blind   used only when the browser will not let the page read the reply: POST with mode:'no-cors' (the script still
             runs), then CONFIRM through a read-only GET loaded as a <script> tag (JSONP).
   Sending a bill twice is harmless: the script ignores a Bill ID it already has. */
(function (root) {
  'use strict';

  var Bill = root.Bill || (typeof require !== 'undefined' ? require('./bill.js') : null);

  // exposed as Cloud.settings so tests can shorten the waits
  var cfg = { timeoutMs: 20000, batch: 25, backoff: [30000, 120000, 600000, 900000] };

  // ---------------------------------------------------------------- pure helpers
  // a stored bill -> what the script expects
  function wirePayload(b) {
    var out = { id: Bill.label(b), date: b.date, total: b.total };
    if (b.items && b.items.length) {
      out.items = b.items.map(function (i) { return { name_en: i.name_en, name_ta: i.name_ta || '', unit: i.unit, qty: i.qty, price: i.price, amount: i.amount }; });
    }
    return out;
  }

  // wait before retry number `tries` (1, 2, 3 ...): 30 s, 2 min, 10 min, then every 15 min
  function delayFor(tries) { return cfg.backoff[Math.min(Math.max(tries, 1), cfg.backoff.length) - 1]; }

  function validUrl(u) {
    try {
      var x = new URL(u);
      return (x.protocol === 'https:' || (x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1'))) && x.pathname.length > 1;
    } catch (e) { return false; }
  }

  // the script's short error codes -> something the owner can act on
  function friendly(text) {
    text = String(text || '');
    if (text === 'bad key') return 'The key is wrong. Copy the KEY from the script (Execution log) again and use Save & test.';
    if (/^not set up/.test(text)) return 'The script is not set up yet: open it, choose setup and press Run first.';
    if (text === 'bad request') return 'Google could not read the request.';
    if (/^script error: /.test(text)) return 'The Google script reported an error: ' + text.slice(14);
    return text || 'Google did not accept the request.';
  }

  var api = { wirePayload: wirePayload, delayFor: delayFor, validUrl: validUrl, friendly: friendly, settings: cfg };
  if (typeof window === 'undefined') { if (typeof module !== 'undefined' && module.exports) module.exports = api; return; }

  // ---------------------------------------------------------------- transport (browser only)
  var NOT_SCRIPT = 'The address did not answer like the Shop Billing script. In the script: Deploy → Manage deployments → check "Execute as: Me" and "Who has access: Anyone", and that you pasted the URL ending in /exec.';

  function fail(kind, message, retry) { var e = new Error(message); e.kind = kind; e.retry = !!retry; return e; }

  function lostConnection() {
    return navigator.onLine === false
      ? fail('offline', 'No internet right now. Bills are kept and will be sent when the connection is back.', true)
      : fail('network', 'Could not reach Google. Bills are kept and it will retry by itself.', true);
  }

  function timer() {
    var c = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = c ? setTimeout(function () { c.abort(); }, cfg.timeoutMs) : null;
    return { signal: c ? c.signal : undefined, done: function () { clearTimeout(t); } };
  }

  function bodyOf(conf, body) { return JSON.stringify(Object.assign({ key: conf.key }, body)); }

  // normal mode: POST and read the reply
  function postRead(conf, body) {
    var to = timer();
    return fetch(conf.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: bodyOf(conf, body), redirect: 'follow', signal: to.signal })
      .then(function (res) {
        if (!res.ok) throw fail('http', 'Google answered with an error (' + res.status + '). It will retry by itself.', true);
        return res.text();
      }, function () { throw lostConnection(); })
      .then(function (text) {
        to.done();
        try { return JSON.parse(text); } catch (e) { throw fail('reply', NOT_SCRIPT, false); }
      }, function (e) { to.done(); throw e.kind ? e : lostConnection(); });
  }

  // blind mode, step 1: POST without reading the reply (the browser hides it, but the script still runs)
  function postBlind(conf, body) {
    var to = timer();
    return fetch(conf.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: bodyOf(conf, body), redirect: 'follow', signal: to.signal })
      .then(function () { to.done(); }, function () { to.done(); throw lostConnection(); });
  }

  // read-only GET answered as JSONP, which a page may always load (it is a <script> tag, not a fetch)
  function jsonp(conf, params) {
    return new Promise(function (resolve, reject) {
      var name = '__shopCloud' + Date.now() + '_' + Math.floor(Math.random() * 1e6), s = document.createElement('script'), settled = false, t;
      function end(fn, v) {
        if (settled) return;
        settled = true; clearTimeout(t); delete window[name];
        if (s.parentNode) s.parentNode.removeChild(s);
        fn(v);
      }
      window[name] = function (obj) { end(resolve, obj); };
      s.onerror = function () { end(reject, lostConnection()); };
      t = setTimeout(function () { end(reject, lostConnection()); }, cfg.timeoutMs);
      var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
      s.src = conf.url + (conf.url.indexOf('?') < 0 ? '?' : '&') + q + '&key=' + encodeURIComponent(conf.key) + '&callback=' + name;
      document.head.appendChild(s);
    });
  }

  // the script's own explanation of a recent failure ("lastError" in a ping/has reply), or ''
  function recentWhy(r) {
    var e = r && r.lastError;
    return e && e.message && e.ageSec <= 600 ? String(e.message) : '';
  }

  // one request -> { ok, ... } in either mode
  function ask(conf, body) {
    if (conf.mode !== 'blind') return postRead(conf, body);
    if (body.action === 'ping') return jsonp(conf, { action: 'ping' });
    var ids = body.bills.map(function (b) { return b.id; });
    return postBlind(conf, body)
      .then(function () { return jsonp(conf, { action: 'has', ids: ids.join(',') }); })
      .then(function (r) {
        if (!r || !r.ok) return r;                                           // e.g. wrong key: readable through the script tag
        var why = recentWhy(r);                                              // blind mode cannot read the POST reply, but the script keeps its last error
        return { ok: true, results: body.bills.map(function (b) { return r.has && r.has[b.id] ? { id: b.id } : { id: b.id, error: why ? 'The script reported: ' + why : 'The sheet did not accept this bill.' }; }) };
      });
  }

  // ---------------------------------------------------------------- state and sync
  var st = { conf: null, entries: [], busy: false, again: false, current: null, error: '', fatal: false, timer: null, tries: 0, lastOk: 0, listeners: [] };

  function status() {
    var failed = st.entries.filter(function (e) { return e.error; });
    return { connected: !!st.conf, mode: st.conf ? st.conf.mode : '', sheetUrl: st.conf ? st.conf.sheetUrl || '' : '', url: st.conf ? st.conf.url : '',
             pending: st.entries.length - failed.length, failed: failed.length, firstFailure: failed.length ? failed[0].error : '',
             busy: st.busy, error: st.error, fatal: st.fatal, retrying: !!st.timer, lastOk: st.lastOk };
  }

  function emit() { var s = status(); st.listeners.forEach(function (fn) { try { fn(s); } catch (e) { /* a broken listener must not stop the sync */ } }); }

  function refresh() { return Store.listOutbox().then(function (list) { st.entries = list; }); }

  function scheduleRetry() {
    clearTimeout(st.timer);
    st.timer = setTimeout(function () { st.timer = null; sync(); }, delayFor(st.tries));
  }

  // Sends everything on the to-send list, oldest first. force = also retry bills the sheet refused earlier.
  function sync(force) {
    if (!st.conf) return Promise.resolve();
    if (st.busy) { st.again = true; return st.current; }                     // a bill confirmed meanwhile is picked up by the next pass
    st.busy = true; st.error = ''; st.fatal = false;
    clearTimeout(st.timer); st.timer = null;
    emit();

    var begin = !force ? Promise.resolve() : Store.listOutbox().then(function (list) {
      var failed = list.filter(function (e) { return e.error; }).map(function (e) { return e.billNo; });
      return failed.length ? Store.patchOutbox(failed, { error: '' }) : null;
    });

    function sendChunks(todo) {
      if (!todo.length) return Promise.resolve();
      var chunk = todo.slice(0, cfg.batch), rest = todo.slice(cfg.batch);
      return ask(st.conf, { action: 'bills', bills: chunk.map(wirePayload) }).then(function (reply) {
        if (!reply || !reply.ok) throw fail('script', friendly(reply && reply.error), false);
        var sent = [], refused = [];
        chunk.forEach(function (b, i) {
          var r = reply.results && reply.results[i];
          if (r && !r.error) sent.push(b.billNo); else refused.push([b.billNo, (r && r.error) || 'The sheet did not accept this bill.']);
        });
        return Store.removeOutbox(sent)
          .then(function () { return refused.reduce(function (p, x) { return p.then(function () { return Store.patchOutbox([x[0]], { error: x[1] }); }); }, Promise.resolve()); })
          .then(function () { st.lastOk = Date.now(); st.tries = 0; return refresh().then(emit); })
          .then(function () { return sendChunks(rest); });
      });
    }

    st.current = begin.then(function () { return Promise.all([Store.listOutbox(), Store.loadBills()]); }).then(function (r) {
      var byNo = {};
      r[1].forEach(function (b) { byNo[b.billNo] = b; });
      var gone = r[0].filter(function (e) { return !byNo[e.billNo]; }).map(function (e) { return e.billNo; });   // bill no longer exists
      var todo = Export.sortBills(r[0].filter(function (e) { return byNo[e.billNo] && !e.error; }).map(function (e) { return byNo[e.billNo]; }));
      return (gone.length ? Store.removeOutbox(gone) : Promise.resolve()).then(function () { return sendChunks(todo); });
    }).catch(function (err) {
      if (err && err.retry) {
        st.tries++;
        st.error = err.message + (st.tries >= 3 && err.kind !== 'offline' ? ' If this keeps happening, tap Save & test again.' : '');
        scheduleRetry();
      } else {
        st.error = (err && err.message) || 'Sending to Google failed.';
        st.fatal = true;                                                     // wrong key etc.: retrying would not help; wait for the owner
      }
    }).then(function () {
      st.busy = false;
      return refresh();
    }).then(function () {
      emit();
      if (st.again && !st.error) { st.again = false; return sync(); }
      st.again = false;
    }, function () { st.busy = false; emit(); });
    return st.current;
  }

  // ---------------------------------------------------------------- the owner's actions
  // Save & test: try the normal way; if the browser cannot read the reply, try the blind way. Saves nothing unless it works.
  function connect(url, key) {
    url = String(url || '').trim(); key = String(key || '').trim() || (st.conf ? st.conf.key : '');   // blank key = keep the saved one
    if (!validUrl(url)) return Promise.reject(fail('input', 'Paste the Web app URL (it starts with https://script.google.com/ and ends with /exec).', false));
    if (!key) return Promise.reject(fail('input', 'Paste the KEY printed by the script (Execution log).', false));
    var normal = { url: url, key: key, mode: 'normal' }, blind = { url: url, key: key, mode: 'blind' };

    function accept(conf, r) {
      if (!r || !r.ok) throw fail('script', friendly(r && r.error), false);
      return { conf: Object.assign({}, conf, { sheetUrl: r.url || '' }), bills: r.bills || 0 };
    }

    return postRead(normal, { action: 'ping' }).then(function (r) { return accept(normal, r); }, function (e) {
      if (e.kind !== 'network') throw e;                                      // offline, wrong address, wrong key...: say so
      return jsonp(blind, { action: 'ping' }).then(function (r) { return accept(blind, r); }, function () { throw e; });
    }).then(function (res) {
      st.conf = res.conf; st.error = ''; st.fatal = false; st.tries = 0;
      return Store.setCloud(res.conf).then(refresh).then(function () { emit(); kick(); return { mode: res.conf.mode, bills: res.bills, sheetUrl: res.conf.sheetUrl }; });
    });
  }

  function disconnect() {
    clearTimeout(st.timer); st.timer = null;
    st.conf = null; st.entries = []; st.error = ''; st.fatal = false; st.tries = 0;
    return Store.clearCloud().then(emit);
  }

  // Put every saved bill on the to-send list and send. The sheet skips any it already has.
  function sendAll() {
    if (!st.conf) return Promise.reject(fail('input', 'Connect the Google Sheet first.', false));
    return Store.enqueueAll().then(function (added) { return refresh().then(function () { emit(); return sync(true); }).then(function () { return { added: added }; }); });
  }

  // Fresh start, sheet side: ask the script to remove every bill row. Resolves when the sheet is confirmed empty.
  // Rejects (so nothing is deleted anywhere) when it cannot be done, e.g. the script is an older version without "clear".
  function clearSheet() {
    if (!st.conf) return Promise.resolve({ skipped: true });
    var conf = st.conf, OLD = 'Your Google script is an older version without "clear". Paste the latest Code.gs into it, then Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.';
    if (conf.mode === 'blind') {
      return postBlind(conf, { action: 'clear' }).then(function () { return jsonp(conf, { action: 'ping' }); }).then(function (r) {
        if (!r || !r.ok) throw fail('script', friendly(r && r.error), false);
        if (r.bills !== 0) throw fail('script', recentWhy(r) ? 'The Google script reported an error: ' + recentWhy(r) : OLD, false);
        return { cleared: true };
      });
    }
    return postRead(conf, { action: 'clear' }).then(function (r) {
      if (r && r.error === 'unknown action') throw fail('script', OLD, false);
      if (!r || !r.ok) throw fail('script', friendly(r && r.error), false);
      return { cleared: true, rows: r.cleared };
    });
  }

  // After the bills on this device were wiped: forget any waiting/failed state and refresh the screens.
  function refreshStatus() {
    clearTimeout(st.timer); st.timer = null; st.tries = 0; st.error = ''; st.fatal = false;
    return refresh().then(emit);
  }

  function kick() { return sync(); }

  function init() {
    window.addEventListener('online', function () { if (st.conf && !st.fatal) kick(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && st.conf && !st.fatal) kick(); });
    return Store.getCloud().then(function (c) { st.conf = c; return refresh(); }).then(function () { emit(); return kick(); }).catch(function () { /* storage problem: billing still works */ });
  }

  root.Cloud = {
    init: init, connect: connect, disconnect: disconnect, sendAll: sendAll, clearSheet: clearSheet, refreshStatus: refreshStatus, syncNow: function () { return sync(true); }, kick: kick,
    status: status, onChange: function (fn) { st.listeners.push(fn); }, settings: cfg
  };
})(typeof window !== 'undefined' ? window : this);
