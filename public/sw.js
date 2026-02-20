/**
 * TeleStats Service Worker
 * Strategy: Cache static assets, network-first for API calls, offline fallback.
 */

const CACHE_NAME = 'telestats-v1';

const STATIC_ASSETS = [
  '/',
  '/telestats-theme.css',
  '/js/ts-auth.js',
  '/js/ts-data.js',
  '/js/ts-nav.js',
  '/games/',
  '/offline.html'
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Network-only for API calls and Supabase
  if (url.pathname.startsWith('/.netlify/functions/') ||
      url.hostname.includes('supabase.co') ||
      url.hostname.includes('googleapis.com')) {
    return;
  }

  // Cache-first for static assets, with network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request)
        .then(response => {
          // Cache successful responses for same-origin
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
        });
    })
  );
});
