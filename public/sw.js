// Service worker: lets the app be installed to a phone home screen and opens the last-loaded
// app shell when there is no signal. Bookings themselves always come live from the server.
const CACHE = 'opal-shell-v2';
const SHELL = ['/', '/styles.css', '/js/app.js', '/js/rules.js', '/js/icons.js', '/img/badge-logo.png', '/img/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
