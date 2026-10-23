/* NOIR RIVER service worker: an app shell that opens offline, cached art and fonts,
   and notification clicks that bring the club to the front. Game traffic is never cached. */
const VERSION = 'nr-v24';
const SHELL = ['/play', '/play.css', '/play.js', '/fonts/fonts.css', '/brand/mark.svg', '/brand/icon-192.png', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // live data: sockets, API, avatars, admin
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/avatar/') || url.pathname.startsWith('/admin')) return;
  const isAsset = /^\/(art|fonts|brand)\//.test(url.pathname) || url.pathname === '/favicon.svg';
  if (isAsset) {
    // images and fonts: cache first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // pages, scripts, styles: always the fresh version, the cache only when offline
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && (req.mode === 'navigate' || /\.(js|css)$/.test(url.pathname))) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/play') : Response.error()))));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const href = (e.notification.data && e.notification.data.href) || '#/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => new URL(c.url).pathname === '/play');
    if (win) { win.postMessage({ type: 'open', href }); return win.focus(); }
    return self.clients.openWindow('/play' + href);
  }));
});
