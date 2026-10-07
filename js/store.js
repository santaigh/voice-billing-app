/* Keeps the product list on the device (IndexedDB) so it survives closing the app. */
(function (root) {
  'use strict';

  var DB_NAME = 'voice-billing', DB_VERSION = 1;

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'code' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
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

  root.Store = { saveProducts: saveProducts, loadProducts: loadProducts };
})(window);
