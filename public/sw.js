const CACHE_NAME = 'pikachu-music-shell-v0.3.0-beta.2';
const STATIC_PATHS = new Set(['/manifest.webmanifest', '/pikachu.svg', '/pikachu.gif', '/pikachu.ico', '/pikachu-192.png', '/pikachu-512.png']);

function isCacheableResponse(response, url) {
  if (!response.ok) return false;
  if (!url.pathname.startsWith('/assets/')) return true;
  const contentType = response.headers.get('content-type') || '';
  return !contentType.includes('text/html');
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll([...STATIC_PATHS]);
  const page = await fetch('/', { cache: 'no-cache' });
  if (!page.ok) throw new Error(`Unable to cache app shell: ${page.status}`);
  await cache.put('/', page.clone());
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => new URL(match[1], self.location.origin))
    .filter(url => url.origin === self.location.origin && url.pathname.startsWith('/assets/'));
  await Promise.all(assets.map(async url => {
    const response = await fetch(url);
    if (isCacheableResponse(response, url)) await cache.put(url.pathname + url.search, response);
  }));
}

self.addEventListener('install', event => { event.waitUntil(cacheAppShell()); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.destination === 'audio') return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => response).catch(() => caches.match('/')));
    return;
  }

  const cacheable = STATIC_PATHS.has(url.pathname) || url.pathname.startsWith('/assets/');
  if (!cacheable) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (isCacheableResponse(response, url)) { const copy = response.clone(); void caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
    return response;
  })));
});
