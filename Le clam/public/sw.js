/* LE CLAM — Service Worker (PWA) */
const CACHE  = 'leclam-v1';
const STATIC = [
  '/',
  '/index.html',
  '/plaisir.html',
  '/malin.html',
  '/bebe.html',
  '/css/style.css',
  '/js/app.js',
  '/js/features.js',
  '/js/slides-config.js',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('push', e => {
  let data = { title: 'Le Clam', body: '', url: '/', icon: '/icons/icon-192.png' };
  try { data = { ...data, ...JSON.parse(e.data.text()) }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: '/icons/icon-72.png',
      data:  { url: data.url },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  /* API calls : network-only */
  if (new URL(request.url).pathname.startsWith('/api/')) return;

  /* Stale-while-revalidate pour les assets statiques */
  e.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => {});
      return cached || network;
    })
  );
});
