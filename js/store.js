/* Keeps the product list on the device (IndexedDB) so it survives closing the app. */
(function (root) {
  'use strict';

  var DB_NAME = 'voice-billing', DB_VERSION = 2;

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'code' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('bills')) db.createObjectStore('bills', { keyPath: 'billNo' });
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
  // can never exist without its number being used up, and two bills can never share a number.
  // items: [{ name_en, name_ta, unit, qty, price, amount }] — kept so a bill can be viewed and reprinted later.
  function saveBill(total, now, items) {
    var date = Bill.localDate(now);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['bills', 'meta'], 'readwrite');
        var meta = tx.objectStore('meta'), out;
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

  root.Store = { saveProducts: saveProducts, loadProducts: loadProducts, saveBill: saveBill, loadBills: loadBills,
                 getExported: getExported, markExported: markExported,
                 getShop: getShop, setShop: setShop };
})(window);
