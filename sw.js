const CACHE_NAME = 'quickshop-cache-v1';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/pwa-192.png',
  '/icons/pwa-512.png',
  '/background.jpg'
];

self.addEventListener('install', evt => {
  self.skipWaiting();
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

// Activate and clean up old caches
self.addEventListener('activate', evt => {
  clients.claim();
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)
    ))
  );
});

// Fetch strategy: cache-first for static assets, network-first for navigation
self.addEventListener('fetch', evt => {
  const req = evt.request;
  // navigation requests -> behave as SPA fallback to index.html
  if (req.mode === 'navigate') {
    evt.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For other requests, try cache first then network
  evt.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp => {
      // Optionally cache fetched asset
      if (resp && resp.status === 200 && req.method === 'GET' && req.url.startsWith(self.location.origin)) {
        const respClone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, respClone));
      }
      return resp;
    })).catch(() => {
      // fallback for images
      if (req.destination === 'image') return caches.match('/icons/pwa-192.png');
    })
  );
});