const CACHE_NAME = 'pikachu-music-shell-v0.1.3.0';
const APP_SHELL = ['/manifest.webmanifest', '/pikachu.svg', '/pikachu.gif', '/pikachu-192.png', '/pikachu-512.png'];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
  const page = await fetch('/', { cache: 'no-cache' });
  if (!page.ok) throw new Error(`Unable to cache app shell: ${page.status}`);
  await cache.put('/', page.clone());
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => new URL(match[1], self.location.origin))
    .filter(url => url.origin === self.location.origin && url.pathname.startsWith('/assets/'));
  await Promise.all(assets.map(async url => {
    const response = await fetch(url);
    if (response.ok) await cache.put(url.pathname + url.search, response);
  }));
}

self.addEventListener('install', event => {
  event.waitUntil(cacheAppShell());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.destination === 'audio') return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone(); void caches.open(CACHE_NAME).then(cache => cache.put('/', copy)); return response;
    }).catch(() => caches.match('/')));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); void caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
    return response;
  })));
});
