/* Agenda del día: une el horario base, tus ajustes, las tareas del plan y los eventos del calendario.
   Módulo puro (sin DOM) que usan la app y la Worker. Las horas son segundos desde la medianoche. */
(function (root) {
  const toSecs = hm => { const [h, m] = String(hm).split(':').map(Number); return (h || 0) * 3600 + (m || 0) * 60; };
  const hhmm = s => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
  const RANK = { cal: 4, task: 3, habit: 3, custom: 3, block: 2, fixed: 1 };

  /* base: content.agenda; settings.agenda = { over: {id:{from,to,off}}, extra:[{id,t,from,to,days}] } */
  function build({ content, settings, plan, wd, cal }) {
    const cfg = (settings && settings.agenda) || {}, over = cfg.over || {};
    const out = [];
    const add = it => { if (it.to > it.from) out.push(it); };
    (content.agenda || []).forEach(b => {
      const o = over[b.id] || {};
      if (o.off) return;
      if (b.days && !b.days.includes(wd)) return;
      const h = b.habit && (content.habits || []).find(x => x.id === b.habit);
      add({ id: b.id, t: b.t, from: toSecs(o.from || b.from), to: toSecs(o.to || b.to), kind: b.kind, slot: b.slot || 'dusk', scene: b.scene || 'task', ico: b.ico || (h && h.ico) || 'check', habit: b.habit || null, xp: h ? h.xp : 0, ask: b.kind === 'habit' });
    });
    (cfg.extra || []).forEach(x => {
      if (x.days && !x.days.includes(wd)) return;
      add({ id: x.id, t: x.t, from: toSecs(x.from), to: toSecs(x.to), kind: 'custom', slot: 'dusk', scene: 'task', ico: 'check', habit: null, xp: 10, ask: true, custom: true });
    });
    // tareas del plan: una tras otra dentro de su bloque (noche = Iguana, día = mañana temprano)
    const tasks = ((plan && plan.tasks) || []).filter(t => t.day === wd);
    ['pm', 'am'].forEach(blk => {
      let at = blk === 'pm' ? toSecs('20:00') : toSecs('05:00');
      tasks.filter(t => (t.block === 'am' ? 'am' : 'pm') === blk).forEach(t => {
        const mins = Math.max(5, t.mins || 30);
        add({ id: t.id, t: t.title, from: at, to: at + mins * 60, kind: 'task', slot: blk === 'pm' ? 'night' : 'dawn', scene: blk === 'pm' ? 'iguana' : 'task', ico: blk === 'pm' ? 'moon' : 'sun', taskId: t.id, xp: 20 + Math.round(mins / 5), ask: true });
        at += mins * 60;
      });
    });
    (cal || []).forEach((e, i) => add({ id: 'cal' + i, t: e.title || 'Evento', from: e.from, to: e.to, kind: 'cal', slot: 'meet', scene: 'meet', ico: 'calendar', xp: 0, ask: false }));
    return out.sort((a, b) => a.from - b.from || b.to - a.to);
  }

  /* Qué toca ahora y qué sigue. */
  function at(items, now) {
    const act = items.filter(i => now >= i.from && now < i.to);
    act.sort((a, b) => (RANK[b.kind] || 0) - (RANK[a.kind] || 0) || b.from - a.from);
    const current = act[0] || null;
    const next = items.filter(i => i.from > now && (!current || i.id !== current.id)).sort((a, b) => a.from - b.from)[0] || null;
    return {
      current, next,
      left: current ? current.to - now : 0,
      pct: current ? Math.min(100, Math.max(0, Math.round(100 * (now - current.from) / (current.to - current.from)))) : 0,
      until: next ? next.from - now : 0
    };
  }
  const api = { build, at, toSecs, hhmm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Agenda = api;
})(typeof window !== 'undefined' ? window : globalThis);
