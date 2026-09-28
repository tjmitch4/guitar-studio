// Guitar Studio service worker: offline support.
// Strategy: NETWORK-FIRST for same-origin GETs (so a new push shows up on the next load when online),
// falling back to the cache when offline. Bump VERSION to force old caches to be dropped.
// Bump on every release (date + letter) so phones drop the old cache.
const VERSION = 'gs-2026-09-28a';
const CORE = [
  './',
  'index.html',
  'css/style.css',
  'js/music.js', 'js/voicings.js', 'js/tone.js', 'js/store.js',
  'js/fretboard-ui.js', 'js/theory-ui.js', 'js/practice-ui.js', 'js/songs-ui.js',
  'js/trainer-ui.js', 'js/videos-ui.js', 'js/tuner-ui.js', 'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
const NET_TIMEOUT_MS = 5000; // on a very slow connection, fall back to cache after this long

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
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
  if (url.origin !== self.location.origin) return;   // let cross-origin requests pass straight through
  if (req.headers.has('range')) return;              // media range requests: don't cache
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  const network = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  const cached = await cache.match(req, { ignoreSearch: true })
    || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
  if (!cached) return network; // nothing to fall back to: just wait for the network
  network.catch(() => {});     // avoid unhandled-rejection noise if the timeout wins and then we go offline
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NET_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch (err) {
    return cached; // offline
  }
}
