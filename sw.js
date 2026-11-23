// Service worker: offline app shell + cached CDN modules.
// Bump VERSION whenever you deploy changes so devices pick them up.
const VERSION = 'nv-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/styles.css',
  './js/main.js', './js/app.js', './js/db.js', './js/srs.js', './js/cloze.js',
  './js/enrich.js', './js/sync.js', './js/i18n.js', './js/checkin.js',
  './js/search.js', './js/config.js', './js/ui.js', './js/pages.js', './js/review.js', './js/badge.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png',
];
const CDN = 'https://cdn.jsdelivr.net/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (url.href.startsWith(CDN)) {
    // Pinned versions never change: cache-first.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      }))
    );
    return;
  }

  if (sameOrigin) {
    // Network-first (fresh code when online), falling back to cache when offline or slow.
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const net = fetch(req);
      net.catch(() => {});
      try {
        const res = await Promise.race([
          net,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
        ]);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && await c.match('./index.html'));
        return hit || net; // nothing cached: keep waiting for the network
      }
    })());
  }
  // Everything else (dictionary APIs, Supabase) goes straight to the network.
});
