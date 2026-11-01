// Offline shell: network-first for the app, cache fallback. Model files are cached by Transformers.js itself.
const CACHE = 'flowstay-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const ortWasm = url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('onnxruntime-web');
  if (e.request.method !== 'GET' || !(sameOrigin || ortWasm)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: sameOrigin && url.pathname.endsWith('/') }))
  );
});
