/**
 * TeleStats Service Worker
 * Strategy:
 *   - Navigation requests (HTML pages): network-first, cache fallback
 *   - Static assets (CSS, JS, images): stale-while-revalidate
 *   - API calls / Supabase: network-only (no caching)
 */

/**
 * BUMP THIS WHENEVER A SHARED FILE IN /js OR /css GAINS SOMETHING PAGES CALL.
 *
 * The activate handler deletes every cache whose name is not this one, so the
 * version is the only thing that evicts a stale copy of ts-nav.js or
 * ts-scope.js from a device that already has one. Pages call these modules by
 * name — TSFooter.render(), TSScope.lockTeam() — and a device still serving
 * last week's copy from here gets "is not a function". The optional
 * invocation those call sites use is the seatbelt; this is the brake.
 */
const CACHE_NAME = 'telestats-v7';

const STATIC_ASSETS = [
  '/telestats-theme.css',
  '/css/ts-page.css',
  '/js/ts-analytics.js',
  '/js/ts-auth.js',
  '/js/ts-data.js',
  '/js/ts-nav.js',
  '/js/ts-footer.js',
  '/js/ts-howto.js',
  '/js/ts-scope.js',
  '/js/ts-streak.js',
  '/offline.html'
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // One at a time, not addAll: addAll is atomic, so a single asset that
      // 404s rejects the whole install and the site is left with no service
      // worker at all. A precache miss should cost one cached file.
      .then(cache => Promise.all(STATIC_ASSETS.map(
        url => cache.add(url).catch(err => {
          console.warn('[sw] could not precache', url, err && err.message);
        })
      )))
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
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('googletagmanager.com') ||
      url.hostname.includes('google-analytics.com')) {
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
