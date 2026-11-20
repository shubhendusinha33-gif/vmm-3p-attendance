/* 3rd Party Attendance: service worker for phone punch alerts (web push). No caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: '3rd Party Attendance', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '3rd Party Attendance', {
    body: d.body || '', icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: d.tag || undefined, renotify: !!d.tag,
    vibrate: [120, 60, 120], data: { url: d.url || 'store.html#td' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || 'store.html#td', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.includes('store.html')) return c.focus();
    return self.clients.openWindow(url);
  }));
});
