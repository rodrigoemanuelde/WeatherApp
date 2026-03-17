const CACHE = 'wandr-v5';
const ASSETS = ['./index.html', './wandr.css', './wandr.js', './manifest.json', './icon-192.png', './icon-512.png'];

// Assets that should always try network first so updates are picked up automatically
const NETWORK_FIRST = ['/index.html', '/wandr.js', '/wandr.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isOwnAsset = NETWORK_FIRST.some(p => url.pathname.endsWith(p));

  if (isOwnAsset) {
    // Network-first: get fresh copy, update cache, fall back to cached version offline
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first for fonts, icons, external resources
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
    );
  }
});
