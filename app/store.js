/* Capa de datos de Cumbre.
 * Siempre guarda una copia en este dispositivo (localStorage). Si la página corre dentro de un artefacto con la
 * capacidad `db`, además guarda cada día, cada plan y lo aprendido como documentos en la base de datos, los
 * recupera al abrir y se mantiene al día con los cambios de otros dispositivos o de Claude.
 * Documentos: days/<fecha> · plans/<lunes> · goals/<id> · reminders/<id> · meta/main · insights/learned · insights/claude.
 * Lo que se borra se guarda como lápida ({ deleted: true }) para que no reviva al sincronizar. */
(function () {
  const LS = 'coach.v1';
  const Store = {
    mode: 'local',          // 'local' | 'db' (artefacto) | 'api' (Cloudflare Worker)
    status: 'local',        // 'local' | 'conectando' | 'sync' | 'guardando' | 'error' | 'sin-codigo'
    S: null,
    onConflict: null,       // (ruta, documentoDelServidor) => boolean; la app fusiona y se vuelve a guardar
    lastPull: 0,
    pollTimer: null,
    onChange: null,         // (kind) => void, para repintar
    lastBody: {},           // ruta -> JSON guardado (sin el sello u)
    queue: {},              // ruta -> documento pendiente
    busy: {},
    db: null,
    timer: null,

    /* ---------- copia local ---------- */
    loadLocal(fresh) {
      try { const s = JSON.parse(localStorage.getItem(LS)); if (s && s.v === 1) return Object.assign(fresh(), s); } catch (e) { /* sin almacenamiento */ }
      return fresh();
    },
    saveLocal(S) { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { /* ignorar */ } },

    /* ---------- documentos a partir del estado ---------- */
    docs(S) {
      const d = {};
      Object.keys(S.days).forEach(k => { d['days/' + k] = S.days[k]; });
      if (S.plan) d['plans/' + S.plan.weekStart] = S.plan;
      Object.keys(S.history).forEach(k => { d['plans/' + k] = S.history[k]; });
      d['meta/main'] = S.meta || (S.meta = {});
      S.meta.xp = S.xp; S.meta.settings = S.settings;
      Object.keys(S.goals || {}).forEach(k => { d['goals/' + k] = S.goals[k]; });
      Object.keys(S.reminders || {}).forEach(k => { d['reminders/' + k] = S.reminders[k]; });
      if (S.learned) d['insights/learned'] = S.learned;
      if (S.claude) d['insights/claude'] = S.claude;
      return d;
    },
    body(o) { const c = Object.assign({}, o); delete c.u; return JSON.stringify(c); },

    /* Llamar tras cada cambio del estado. */
    persist(S) {
      const docs = this.docs(S);
      Object.keys(docs).forEach(path => {
        const o = docs[path], b = this.body(o);
        if (b === this.lastBody[path]) return;
        if (!o.u || this.pendingBody(path) !== b) o.u = Date.now();
        if (this.mode !== 'local') this.queue[path] = { o, b };
      });
      this.saveLocal(S);
      if (this.mode !== 'local') this.schedule();
    },
    pendingBody(path) { return this.queue[path] && this.queue[path].b; },

    /* ---------- base de datos ---------- */
    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 250);
    },
    async flush() {
      const paths = Object.keys(this.queue).filter(p => !this.busy[p]);
      if (!paths.length) return;
      this.setStatus('guardando');
      await Promise.all(paths.map(async path => {
        const item = this.queue[path]; delete this.queue[path]; this.busy[path] = true;
        try { const ok = await this.write(path, item.o); if (ok) this.lastBody[path] = item.b; }
        catch (e) { this.queue[path] = this.queue[path] || item; this.setStatus('error'); }
        finally { this.busy[path] = false; }
      }));
      if (Object.keys(this.queue).length) { if (this.status !== 'error') this.schedule(); return; }
      if (this.status !== 'error') this.setStatus('sync');
    },
    async write(path, o) {
      if (this.mode === 'db') { await this.db.doc(path).set(JSON.parse(JSON.stringify(o))); return true; }
      const r = await fetch('api/doc/' + path, { method: 'PUT', headers: { Authorization: 'Bearer ' + this.token(), 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
      if (r.status === 401) { this.setStatus('sin-codigo'); throw new Error('sin acceso'); }
      if (r.status === 409) {                       // el servidor tiene algo más nuevo (p. ej. una respuesta a un push)
        const cur = (await r.json()).current;
        this.lastBody[path] = this.body(cur);
        if (this.onConflict && this.onConflict(path, cur)) { this.persist(this.S); if (this.onChange) this.onChange('remote'); }
        return false;
      }
      if (!r.ok) throw new Error('error ' + r.status);
      return true;
    },
    token() { try { return localStorage.getItem('coach.token') || ''; } catch (e) { return ''; } },
    setToken(t) { try { if (t) localStorage.setItem('coach.token', t); else localStorage.removeItem('coach.token'); } catch (e) { /* ignorar */ } },
    setStatus(s) { this.status = s; if (this.onChange) this.onChange('status'); },
    label() {
      const sync = this.mode === 'api' ? 'Sincronizado con Cloudflare' : 'Guardado en la base de datos';
      return { local: 'Guardado en este dispositivo', conectando: 'Conectando con la base de datos…', sync, guardando: 'Guardando…', error: 'No se pudo guardar en el servidor; queda en este dispositivo', 'sin-codigo': 'Falta el código de acceso (Ajustes) para sincronizar; por ahora queda en este dispositivo' }[this.status];
    },

    /* Se conecta (si hay base de datos), trae lo guardado y se queda escuchando. `apply(col, key, doc)` fusiona. */
    async connect(S, apply) {
      this.S = S; this.apply = apply;
      if (typeof window !== 'undefined' && window.claude && window.claude.use) return this.connectDb(S, apply);
      return this.connectApi(S, apply);
    },

    /* Cloudflare Worker: misma app y API en el mismo origen (/api/*). */
    async connectApi(S, apply) {
      if (typeof location === 'undefined' || location.protocol === 'file:') return false;
      try {
        const r = await fetch('api/ping', { cache: 'no-store' });
        const j = r.ok && await r.json();
        if (!j || j.ok !== true) return false;
        this.pushReady = !!j.push;
      } catch (e) { return false; }
      this.apiSeen = true;
      if (!this.token()) { this.setStatus('sin-codigo'); return false; }
      this.setStatus('conectando');
      this.mode = 'api';
      if (!await this.pull(true)) { if (this.status !== 'sin-codigo') this.setStatus('error'); this.mode = 'local'; return false; }
      this.persist(S);
      this.setStatus(Object.keys(this.queue).length ? 'guardando' : 'sync');
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => { if (!document.hidden) this.pull(); }, 60000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && this.mode === 'api') this.pull(); });
      return true;
    },
    /* Trae lo que cambió en el servidor desde la última vez (p. ej. respuestas dadas desde una notificación). */
    async pull(first) {
      try {
        const r = await fetch('api/docs?since=' + (first ? 0 : this.lastPull), { headers: { Authorization: 'Bearer ' + this.token() }, cache: 'no-store' });
        if (r.status === 401) { this.setStatus('sin-codigo'); return false; }
        if (!r.ok) return false;
        const j = await r.json();
        let changed = false;
        Object.keys(j.docs).forEach(path => {
          const o = j.docs[path], [col, key] = [path.split('/')[0], path.split('/').slice(1).join('/')];
          if (this.queue[path] || this.busy[path]) return;
          this.lastBody[path] = this.body(o);
          if (this.apply(col, key, o)) changed = true;
        });
        this.lastPull = Math.max(0, (j.now || Date.now()) - 5000);
        if (changed && !first) { this.saveLocal(this.S); if (this.onChange) this.onChange('remote'); }
        return true;
      } catch (e) { return false; }
    },

    async connectDb(S, apply) {
      if (typeof window === 'undefined' || !window.claude || !window.claude.use) return false;
      this.setStatus('conectando');
      let db = null;
      try { db = await window.claude.use('db'); } catch (e) { db = null; }
      if (!db) { this.setStatus('local'); return false; }
      this.db = db; this.mode = 'db';
      try {
        for (const col of ['meta', 'days', 'plans', 'goals', 'reminders', 'insights']) {
          const snap = await db.collection(col).get();
          snap.docs.forEach(d => { const o = d.data(); if (o) { this.lastBody[col + '/' + d.id] = this.body(o); apply(col, d.id, o); } });
        }
      } catch (e) { this.setStatus('error'); return false; }
      // lo local que no está en la base de datos (o es más nuevo) se sube
      this.persist(S);
      this.setStatus(Object.keys(this.queue).length ? 'guardando' : 'sync');
      // cambios que llegan de fuera (otro dispositivo, o Claude escribiendo insights)
      ['days', 'plans', 'goals', 'reminders', 'insights', 'meta'].forEach(col => {
        try {
          db.collection(col).onSnapshot(snap => {
            snap.docChanges().forEach(ch => {
              if (ch.type === 'removed') return;
              const o = ch.doc.data(), path = col + '/' + ch.doc.id;
              if (!o || this.body(o) === this.lastBody[path]) return;
              if (this.queue[path] || this.busy[path]) return;
              this.lastBody[path] = this.body(o);
              if (apply(col, ch.doc.id, o) && this.onChange) this.onChange('remote');
            });
          }, () => {});
        } catch (e) { /* sin escucha en vivo */ }
      });
      return true;
    }
  };
  window.Store = Store;
})();
