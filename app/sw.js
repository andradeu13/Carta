const CACHE = 'cumbre-v4';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'learn.js', 'push.js', 'pizarra.html', 'manifest.webmanifest', 'ds/tokens.css', 'ds/components.css', 'data/content.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.includes('/api/')) return;   // la API nunca se guarda en caché
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
/* Push: «¿Lo hiciste?» con botones Sí / No. Los datos llegan cifrados desde el Worker. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Cumbre', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cumbre', {
    body: d.body || '', tag: d.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: d.data || {},
    actions: d.actions || [], requireInteraction: !!(d.actions && d.actions.length), renotify: true
  }));
});

async function reply(n, answer) {
  const d = n.data || {};
  const body = { d: d.date, i: d.id, r: d.round, e: d.exp, a: answer, s: answer === 'yes' ? d.sy : d.sn };
  let msg = 'No se pudo anotar la respuesta. Ábrela en la app.';
  try {
    const r = await fetch(new URL(d.answer, self.registration.scope).href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    msg = j.ok ? (answer === 'yes' ? `Anotado: +${j.xp || 0} XP` : (j.retry ? 'Anotado. Te vuelvo a preguntar en 30 minutos.' : 'Anotado como no cumplido.')) : 'Esa pregunta ya estaba respondida.';
  } catch (x) { /* sin red: se queda el mensaje por defecto */ }
  await self.registration.showNotification('Cumbre', { body: msg, tag: n.tag + '-r', icon: 'icon-192.png', silent: true });
  setTimeout(async () => { (await self.registration.getNotifications({ tag: n.tag + '-r' })).forEach(x => x.close()); }, 5000);
  const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  cs.forEach(c => c.postMessage({ type: 'refresh' }));
}

self.addEventListener('notificationclick', e => {
  const n = e.notification;
  n.close();
  if (e.action === 'yes' || e.action === 'no') { e.waitUntil(reply(n, e.action)); return; }
  const url = new URL((n.data && n.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    const c = l[0];
    if (c) { c.postMessage({ type: 'open', url }); return c.focus(); }
    return clients.openWindow(url);
  }));
});
