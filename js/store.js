/* Keeps the product list on the device (IndexedDB) so it survives closing the app. */
(function (root) {
  'use strict';

  var DB_NAME = 'voice-billing', DB_VERSION = 3;

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'code' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('bills')) db.createObjectStore('bills', { keyPath: 'billNo' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'billNo' });   // bills waiting to be sent to the Google Sheet
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function done(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Storage failed')); };
    });
  }

  // One transaction: either the whole new list replaces the old one, or nothing changes.
  function saveProducts(products, info) {
    return open().then(function (db) {
      var tx = db.transaction(['products', 'meta'], 'readwrite');
      tx.objectStore('products').clear();
      products.forEach(function (p) { tx.objectStore('products').put(p); });
      tx.objectStore('meta').put({ key: 'products', fileName: info.fileName, loadedAt: info.loadedAt });
      return done(tx).then(function () { db.close(); });
    });
  }

  function loadProducts() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['products', 'meta'], 'readonly');
        var all = tx.objectStore('products').getAll();
        var meta = tx.objectStore('meta').get('products');
        tx.oncomplete = function () {
          db.close();
          resolve({ products: all.result.sort(function (a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; }),
                    info: meta.result || null });
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // Issues the next bill number and saves {billNo, date, total, time, items} in ONE transaction, so a bill
  // can never exist without its number being used up, and two bills can never share a number. When the Google
  // Sheet is connected the bill is also put on the "to send" list (outbox) in that same transaction.
  // items: [{ name_en, name_ta, unit, qty, price, amount }] — kept so a bill can be viewed and reprinted later.
  function saveBill(total, now, items) {
    var date = Bill.localDate(now);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['bills', 'meta', 'outbox'], 'readwrite');
        var meta = tx.objectStore('meta'), out, cloudOn = false;
        // Is the Google Sheet connected? Asked first, so its answer is in before the bill is written.
        var cloud = meta.get('cloud');
        cloud.onsuccess = function () { cloudOn = !!cloud.result; };
        // One counter per day, so a phone clock that jumps back a day cannot reuse a number.
        var get = meta.get('counter:' + date);
        get.onsuccess = function () {
          if (get.result) return issue(get.result.n);
          var legacy = meta.get('counter');            // single counter written by earlier versions
          legacy.onsuccess = function () { issue(legacy.result && legacy.result.date === date ? legacy.result.n : 0); };
        };
        function issue(last) {
          var n = last + 1;
          out = { billNo: Bill.billNo(date, n), date: date, total: total, time: Bill.formatTime(now), items: items || [] };
          tx.objectStore('bills').add(out);
          meta.put({ key: 'counter:' + date, n: n });
          // In the SAME transaction as the bill, so a saved bill can never be forgotten by the Google Sheet sync.
          if (cloudOn) tx.objectStore('outbox').put({ billNo: out.billNo, tries: 0, error: '', addedAt: Date.now() });
        }
        tx.oncomplete = function () { db.close(); resolve(out); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error('Storage failed')); };
      });
    });
  }

  function loadBills() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('bills', 'readonly'), all = tx.objectStore('bills').getAll();
        tx.oncomplete = function () { db.close(); resolve(all.result); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function getShop() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readonly'), r = tx.objectStore('meta').get('shop');
        tx.oncomplete = function () { db.close(); resolve(r.result ? r.result.name : ''); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function setShop(name) {
    return open().then(function (db) {
      var tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'shop', name: name });
      return done(tx).then(function () { db.close(); });
    });
  }

  // { 'YYYY-MM-DD': how many of that day's bills the last export contained }
  function getExported() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readonly'), r = tx.objectStore('meta').get('exported');
        tx.oncomplete = function () { db.close(); resolve(r.result ? r.result.days : {}); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function markExported(days) {   // days: [{date, count}] merged into what is already recorded
    return open().then(function (db) {
      var tx = db.transaction('meta', 'readwrite'), meta = tx.objectStore('meta'), get = meta.get('exported');
      get.onsuccess = function () {
        var all = get.result ? get.result.days : {};
        days.forEach(function (d) { all[d.date] = d.count; });
        meta.put({ key: 'exported', days: all });
      };
      return done(tx).then(function () { db.close(); });
    });
  }

  // ---- Google Sheet connection and the "to send" list ----
  // The connection lives in meta as { key: 'cloud', value: { url, key, mode, sheetUrl } } (the secret is cfg.key; the
  // store's own key field is 'cloud'). It stays on this device only.
  function getCloud() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readonly'), r = tx.objectStore('meta').get('cloud');
        tx.oncomplete = function () { db.close(); resolve(r.result ? r.result.value : null); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function setCloud(cfg) {
    return open().then(function (db) {
      var tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'cloud', value: cfg });
      return done(tx).then(function () { db.close(); });
    });
  }

  // Disconnect: forget the connection and the to-send list.
  function clearCloud() {
    return open().then(function (db) {
      var tx = db.transaction(['meta', 'outbox'], 'readwrite');
      tx.objectStore('meta').delete('cloud');
      tx.objectStore('outbox').clear();
      return done(tx).then(function () { db.close(); });
    });
  }

  function listOutbox() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('outbox', 'readonly'), all = tx.objectStore('outbox').getAll();
        tx.oncomplete = function () { db.close(); resolve(all.result); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function removeOutbox(billNos) {
    return open().then(function (db) {
      var tx = db.transaction('outbox', 'readwrite');
      billNos.forEach(function (no) { tx.objectStore('outbox').delete(no); });
      return done(tx).then(function () { db.close(); });
    });
  }

  // patch: fields to change on each listed entry, e.g. { error: 'bad date' } or { tries: 3 }
  function patchOutbox(billNos, patch) {
    return open().then(function (db) {
      var tx = db.transaction('outbox', 'readwrite'), os = tx.objectStore('outbox');
      billNos.forEach(function (no) {
        var g = os.get(no);
        g.onsuccess = function () { if (g.result) os.put(Object.assign({}, g.result, patch)); };
      });
      return done(tx).then(function () { db.close(); });
    });
  }

  // Put every saved bill on the to-send list (bills already on it keep their entry). Returns how many were added.
  function enqueueAll() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['bills', 'outbox'], 'readwrite'), outbox = tx.objectStore('outbox'), added = 0;
        var bills = tx.objectStore('bills').getAll();
        bills.onsuccess = function () {
          var have = outbox.getAllKeys();                   // asked only after the bills arrived: one request at a time
          have.onsuccess = function () {
            var set = {};
            have.result.forEach(function (k) { set[k] = 1; });
            bills.result.forEach(function (b) {
              if (!set[b.billNo]) { outbox.put({ billNo: b.billNo, tries: 0, error: '', addedAt: Date.now() }); added++; }
            });
          };
        };
        tx.oncomplete = function () { db.close(); resolve(added); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error('Storage failed')); };
      });
    });
  }

  root.Store = { saveProducts: saveProducts, loadProducts: loadProducts, saveBill: saveBill, loadBills: loadBills,
                 getExported: getExported, markExported: markExported,
                 getCloud: getCloud, setCloud: setCloud, clearCloud: clearCloud, listOutbox: listOutbox, removeOutbox: removeOutbox,
                 patchOutbox: patchOutbox, enqueueAll: enqueueAll,
                 getShop: getShop, setShop: setShop };
})(window);
