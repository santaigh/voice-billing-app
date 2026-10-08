/* Keeps a copy of the app so it opens offline. Bump VERSION when the list of shell files changes. */
var VERSION = 'v8';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/catalog.js', 'js/bill.js', 'js/search.js', 'js/parse.js', 'js/match.js', 'js/voice.js', 'js/store.js', 'js/billing.js', 'js/export.js', 'js/cloud.js', 'js/bills.js', 'js/config.js', 'js/master.js',
             'vendor/xlsx.full.min.js', 'vendor/fuse.min.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Network first: whenever the shop is online the newest app files are used, so an update shows up on the next
// load. If the network is down or slower than 3 seconds, the saved copy is used, so the app still opens offline.
function fromNetwork(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  });
}
function fromCache(req) { return caches.match(req, { ignoreSearch: true }); }

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function give(r) { if (!done && r) { done = true; resolve(r); } }
    var timer = setTimeout(function () { fromCache(req).then(give); }, 3000);
    fromNetwork(req).then(function (res) { clearTimeout(timer); give(res); }, function () {
      clearTimeout(timer);
      fromCache(req).then(function (hit) { if (hit) give(hit); else if (!done) { done = true; resolve(Response.error()); } });
    });
  }));
});
