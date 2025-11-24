/* sw.js - Service Worker for Caching App Shell */

const CACHE_NAME = 'quickshop-cache-v1';
// [GEMINI] FIX: Replaced placeholder icons with your PWA files
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/report.js',
  '/indexeddb_sync.js',
  '/firebase-config.js',
  '/manifest.json',
  'https://unpkg.com/@zxing/library@latest/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js',
  'pwa-192.png',
  'pwa-512.png'
];

// Install event: cache all the app shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(URLS_TO_CACHE);
      })
      .then(() => {
        // Force the waiting service worker to become the active service worker
        return self.skipWaiting();
      })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      // Take control of all open clients
      return self.clients.claim();
    })
  );
});

// Fetch event: serve from cache first (Cache-First strategy)
self.addEventListener('fetch', (event) => {
  // We only want to cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Don't cache Firebase requests
  if (event.request.url.includes('firebase') || event.request.url.includes('googleapis')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          // Found in cache, return it
          return response;
        }
        
        // Not in cache, fetch from network
        return fetch(event.request)
          .then((networkResponse) => {
            // Optional: You could cache new requests here, but for an app shell
            // this is often not necessary if all main files are in URLS_TO_CACHE.
            // Be careful caching everything, as it can fill up storage.
            return networkResponse;
          })
          .catch(() => {
            // Fetch failed (e.g., offline and not in cache)
            // You could return a fallback offline page here if you had one.
            console.warn('Fetch failed for:', event.request.url);
          });
      })
  );
});

