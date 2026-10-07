/* Caches the app shell so it opens offline. Bump VERSION whenever a shell file changes. */
var VERSION = 'v3';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/catalog.js', 'js/bill.js', 'js/search.js', 'js/parse.js', 'js/match.js', 'js/voice.js', 'js/store.js', 'js/billing.js',
             'vendor/xlsx.full.min.js', 'vendor/fuse.min.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(function (hit) { return hit || fetch(e.request); }));
});
