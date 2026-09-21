const BUILD = '0.2.7.3b-dev5.2';
const PREFIX = `flappy13-${encodeURIComponent(self.registration.scope)}-`;
const CACHE = `${PREFIX}${BUILD}`;
const ASSETS = [
  './',
  './assets/atlas.png',
  './assets/atlas.txt',
  './assets/sounds/sfx_die.ogg',
  './assets/sounds/sfx_die.wav',
  './assets/sounds/sfx_hit.ogg',
  './assets/sounds/sfx_hit.wav',
  './assets/sounds/sfx_point.ogg',
  './assets/sounds/sfx_point.wav',
  './assets/sounds/sfx_swooshing.ogg',
  './assets/sounds/sfx_swooshing.wav',
  './assets/sounds/sfx_wing.ogg',
  './assets/sounds/sfx_wing.wav',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-32.png',
  './icons/icon-512.png',
  './index.html',
  './manifest.webmanifest',
  './src/atlas.js',
  './src/audio.js',
  './src/auth.js',
  './src/clock.js',
  './src/display.js',
  './src/game.js',
  './src/leaderboard.js',
  './src/main.js',
  './src/math.js',
  './src/perf.js',
  './src/verified-run-client.js',
  './src/verified-runs.js',
  './style.css',
];
const OPTIONAL_ASSETS = [
  './config.js',
];
const URLS = ASSETS.map(path => new URL(path, self.registration.scope).href);
const OPTIONAL_URLS = OPTIONAL_ASSETS.map(path => new URL(path, self.registration.scope).href);
const ALLOWED = new Set([...URLS, ...OPTIONAL_URLS]);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const requests = URLS.map(url => new Request(url, { cache: 'reload' }));
      await cache.addAll(requests);

      // Runtime auth configuration is generated only for deployed builds.
      // Cache it when present, but never make offline game installation depend on it.
      for (const url of OPTIONAL_URLS) {
        try {
          const response = await fetch(new Request(url, { cache: 'reload' }));
          if (response.ok) {
            await cache.put(url, response.clone());
          }
        } catch {
          // Local/offline builds intentionally work without community configuration.
        }
      }
    }
    catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // Do not call skipWaiting here: a new build must not replace a game in progress.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    for (const name of names) {
      if (name.startsWith(PREFIX) && name !== CACHE) {
        await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  const key = `${url.origin}${url.pathname}`;
  // version.json intentionally stays network-only so automatic update checks can
  // distinguish the published GitHub Pages build from the offline app cache.
  if (!ALLOWED.has(key)) {
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    if (cached) {
      return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(key, response.clone());
      }
      return response;
    }
    catch {
      return new Response('Ressource hors ligne absente. Reconnecter puis recharger.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'GET_BUILD') {
    event.ports[0]?.postMessage({ build: BUILD });
  }

  if (event.data?.type === 'ACTIVATE_UPDATE') {
    self.skipWaiting();
  }
  if (event.data?.type === 'VERIFY_CACHE') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const missing = [];
      for (const url of URLS) {
        if (!await cache.match(url)) {
          missing.push(url);
        }
      }
      event.ports[0]?.postMessage({
        complete: missing.length === 0,
        count: URLS.length - missing.length,
        total: URLS.length,
        build: BUILD,
        missing,
      });
    })());
  }
});
