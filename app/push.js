/* Suscripción a notificaciones push contra el Worker de Cloudflare. */
(function () {
  const b64ToBytes = s => { const p = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); const r = atob(p), o = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; };
  const auth = () => ({ Authorization: 'Bearer ' + Store.token(), 'Content-Type': 'application/json' });
  const Push = {
    supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol !== 'file:'; },
    /* 'unsupported' | 'noserver' | 'notoken' | 'denied' | 'off' | 'on' */
    async state() {
      if (!this.supported()) return 'unsupported';
      if (!Store.apiSeen) return 'noserver';
      if (!Store.token()) return 'notoken';
      if (Notification.permission === 'denied') return 'denied';
      try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub ? 'on' : 'off'; } catch (e) { return 'off'; }
    },
    async enable() {
      if (await Notification.requestPermission() !== 'granted') throw new Error('Sin permiso para notificar');
      const reg = await navigator.serviceWorker.ready;
      const key = (await (await fetch('api/push/key', { cache: 'no-store' })).json()).key;
      if (!key) throw new Error('El servidor aún no tiene las claves de push (VAPID)');
      const sub = reg.pushManager.getSubscription && await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      const r = await fetch('api/push/subscribe', { method: 'POST', headers: auth(), body: JSON.stringify(sub.toJSON()) });
      if (r.status === 401) throw new Error('El código de acceso no es correcto');
      if (!r.ok) throw new Error('No se pudo registrar el dispositivo');
    },
    async disable() {
      try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* ignorar */ }
      await fetch('api/push/subscribe', { method: 'DELETE', headers: auth() });
    },
    async test() {
      const r = await fetch('api/push/test', { method: 'POST', headers: auth(), body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(r.status === 409 ? 'Este dispositivo no está suscrito' : 'El servicio push no aceptó la prueba (' + (j.status || r.status) + ')');
    },
    /* Responde a una pregunta «¿Lo hiciste?» con los parámetros firmados del aviso. */
    async answer(p, a) {
      const r = await fetch('api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ d: p.d, i: p.i, r: +p.r, e: +p.e, a, s: a === 'yes' ? p.sy : p.sn }) });
      return r.json().catch(() => ({ ok: false }));
    }
  };
  window.Push = Push;
})();
