// Service worker: guarda só o "casco" do app. Vídeo, API e servers.json nunca passam por aqui.
const V = 'iptvp-v7';
const SHELL = ['/', '/logo.png', '/icon.png', '/favicon.png', '/manifest.webmanifest', '/vendor/hls.min.js', '/vendor/mpegts.js', '/vendor/shaka.js', '/i18n.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname === '/p' || u.pathname === '/t' || u.pathname === '/t/info' || u.pathname === '/servers.json' || u.pathname === '/healthz' || r.headers.has('range')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(x => { const c = x.clone(); caches.open(V).then(k => k.put('/', c)); return x; }).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(x => { if (x.ok) { const c = x.clone(); caches.open(V).then(k => k.put(r, c)); } return x; })));
});
