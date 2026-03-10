/**
 * TeleStats Service Worker
 * Strategy:
 *   - Navigation requests (HTML pages): network-first, cache fallback
 *   - Static assets (CSS, JS, images): stale-while-revalidate
 *   - API calls / Supabase: network-only (no caching)
 */

const CACHE_NAME = 'telestats-v5';

const STATIC_ASSETS = [
  '/telestats-theme.css',
  '/js/ts-auth.js',
  '/js/ts-data.js',
  '/js/ts-nav.js',
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

// Fetch handler
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

  // Navigation requests (HTML pages): network-first, cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache the fresh response for offline use
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline: try cache, then offline page
          return caches.match(request)
            .then(cached => cached || caches.match('/offline.html'));
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  // Return cached version immediately, but fetch fresh copy in background
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request)
        .then(response => {
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      // Return cached immediately if available, otherwise wait for network
      return cached || fetchPromise;
    })
  );
});
