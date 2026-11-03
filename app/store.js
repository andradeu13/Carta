/* Capa de datos de Cumbre.
 * Siempre guarda una copia en este dispositivo (localStorage). Si la página corre dentro de un artefacto con la
 * capacidad `db`, además guarda cada día, cada plan y lo aprendido como documentos en la base de datos, los
 * recupera al abrir y se mantiene al día con los cambios de otros dispositivos o de Claude.
 * Documentos: days/<fecha> · plans/<lunes> · meta/main · insights/learned · insights/claude */
(function () {
  const LS = 'coach.v1';
  const Store = {
    mode: 'local',          // 'local' | 'db'
    status: 'local',        // 'local' | 'conectando' | 'sync' | 'guardando' | 'error'
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
        if (this.mode === 'db') this.queue[path] = { o, b };
      });
      this.saveLocal(S);
      if (this.mode === 'db') this.schedule();
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
        try { await this.db.doc(path).set(JSON.parse(JSON.stringify(item.o))); this.lastBody[path] = item.b; }
        catch (e) { this.queue[path] = this.queue[path] || item; this.setStatus('error'); }
        finally { this.busy[path] = false; }
      }));
      if (Object.keys(this.queue).length) { if (this.status !== 'error') this.schedule(); return; }
      if (this.status !== 'error') this.setStatus('sync');
    },
    setStatus(s) { this.status = s; if (this.onChange) this.onChange('status'); },
    label() {
      return { local: 'Guardado en este dispositivo', conectando: 'Conectando con la base de datos…', sync: 'Guardado en la base de datos', guardando: 'Guardando…', error: 'No se pudo guardar en la base de datos; queda en este dispositivo' }[this.status];
    },

    /* Se conecta (si hay base de datos), trae lo guardado y se queda escuchando. `apply(col, key, doc)` fusiona. */
    async connect(S, apply) {
      if (typeof window === 'undefined' || !window.claude || !window.claude.use) return false;
      this.setStatus('conectando');
      let db = null;
      try { db = await window.claude.use('db'); } catch (e) { db = null; }
      if (!db) { this.setStatus('local'); return false; }
      this.db = db; this.mode = 'db';
      try {
        for (const col of ['meta', 'days', 'plans', 'insights']) {
          const snap = await db.collection(col).get();
          snap.docs.forEach(d => { const o = d.data(); if (o) { this.lastBody[col + '/' + d.id] = this.body(o); apply(col, d.id, o); } });
        }
      } catch (e) { this.setStatus('error'); return false; }
      // lo local que no está en la base de datos (o es más nuevo) se sube
      this.persist(S);
      this.setStatus(Object.keys(this.queue).length ? 'guardando' : 'sync');
      // cambios que llegan de fuera (otro dispositivo, o Claude escribiendo insights)
      ['days', 'plans', 'insights', 'meta'].forEach(col => {
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
