const CACHE_NAME = "rp-site-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./verificar-audio.html",
  "./assets/css/style.css",
  "./assets/js/audio-check.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/favicon.svg",
  "./assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Network-first: this is a small, frequently-updated tool, so freshness
// matters more than shaving a request on a fast connection. Every online
// visit gets the latest file straight from the server; the cache only
// kicks in as an offline fallback. (An earlier cache-first version made
// updates invisible until a *second* reload after the new files quietly
// synced in the background — this fixes that.)
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      })
      .catch(function () { return caches.match(req); })
  );
});
