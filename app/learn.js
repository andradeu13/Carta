/* Motor de aprendizaje de Cumbre: lee tu historial (días, ánimo, planes) y estima qué te funciona.
 * Todo es estadística simple y explicable; con pocos datos lo dice y no inventa. */
(function () {
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const DAYS_FULL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const wd = ds => (parse(ds).getDay() + 6) % 7;
  const actions = r => (r ? Object.keys(r.habits || {}).length + (r.tasksDone || 0) : 0);
  const counted = r => actions(r) >= 2;
  const pct = x => Math.round(100 * x);
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const label = id => ({ prior: 'escribes tus prioridades', med: 'meditas', salmo: 'lees tu salmo', dato: 'compartes un dato en una conversación', trote: 'sales a trotar', redes: 'cumples tu límite de redes', sleep: 'duermes a tu hora', pizarra: 'actualizas la pizarra' }[id] || id);

  function compute(S, C, today) {
    today = today || fmt(new Date());
    const keys = Object.keys(S.days).filter(k => k <= today).sort();
    const m = { v: 1, at: today, n: 0, habit: {}, mood: null, bestHour: null, weekday: null, night: null, tone: null, load: null, templates: {}, insights: [] };
    const withData = keys.filter(k => actions(S.days[k]) > 0 || S.days[k].mood);
    m.n = withData.length;
    const first = keys[0] ? parse(keys[0]) : parse(today);
    const start = new Date(Math.max(first.getTime(), addDays(parse(today), -27).getTime()));
    const win = []; for (let d = new Date(start); fmt(d) <= today; d = addDays(d, 1)) win.push(fmt(d));
    const habits = (C && C.habits) || [];

    // 1) constancia por hábito y su relación con el ánimo
    const moodDays = win.filter(k => S.days[k] && S.days[k].mood);
    habits.forEach(h => {
      const done = win.filter(k => S.days[k] && S.days[k].habits && S.days[k].habits[h.id]);
      const last7 = win.slice(-7), r7 = last7.filter(k => done.includes(k)).length / Math.max(1, last7.length);
      let lift = null, nDone = 0, nNot = 0;
      const gd = moodDays.filter(k => S.days[k].habits[h.id]), gn = moodDays.filter(k => !S.days[k].habits[h.id]);
      nDone = gd.length; nNot = gn.length;
      if (nDone >= 3 && nNot >= 3) lift = gd.filter(k => S.days[k].mood >= 3).length / nDone - gn.filter(k => S.days[k].mood >= 3).length / nNot;
      m.habit[h.id] = { rate: +(done.length / Math.max(1, win.length)).toFixed(2), rate7: +r7.toFixed(2), lift: lift === null ? null : +lift.toFixed(2), nDone, nNot };
    });

    // 2) ánimo
    const ms = moodDays.map(k => S.days[k].mood);
    if (ms.length) {
      const by = Array.from({ length: 7 }, () => []);
      moodDays.forEach(k => by[wd(k)].push(S.days[k].mood));
      m.mood = { n: ms.length, avg: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), byWeekday: by.map(a => (a.length >= 2 ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null)) };
    }

    // 3) hora en que cumples
    const hours = []; win.forEach(k => { const t = (S.days[k] || {}).times; if (t) Object.keys(t).forEach(id => hours.push(t[id])); });
    if (hours.length >= 8) { const h = median(hours); m.bestHour = +h.toFixed(1); }

    // 4) días fuertes y flojos
    const sum = Array(7).fill(0), cnt = Array(7).fill(0);
    win.filter(k => k < today).forEach(k => { const i = wd(k); sum[i] += counted(S.days[k]) ? 1 : 0; cnt[i]++; });
    if (win.length >= 14) {
      const rate = sum.map((s, i) => (cnt[i] >= 2 ? s / cnt[i] : null));
      const valid = rate.map((r, i) => [r, i]).filter(x => x[0] !== null);
      if (valid.length >= 4) {
        const lo = valid.reduce((a, b) => (b[0] < a[0] ? b : a)), hi = valid.reduce((a, b) => (b[0] > a[0] ? b : a));
        m.weekday = { rate: rate.map(r => (r === null ? null : +r.toFixed(2))), weak: lo[0] < hi[0] ? lo[1] : null, strong: hi[0] > lo[0] ? hi[1] : null };
      }
    }

    // 5) carga nocturna que sostienes (minutos de tareas de la noche que sí terminas por día)
    const plans = [S.plan].concat(Object.values(S.history || {})).filter(Boolean);
    const perDay = {};
    const tmpl = {};
    plans.forEach(p => (p.tasks || []).forEach(t => {
      const key = String(t.title || '').toLowerCase().slice(0, 40);
      const e = tmpl[key] || (tmpl[key] = { title: t.title, n: 0, done: 0 });
      const due = addDays(parse(p.weekStart), t.day || 0);
      if (fmt(due) <= today) { e.n++; if (t.done) e.done++; }
      if (t.done && t.block === 'pm') perDay[t.done] = (perDay[t.done] || 0) + (t.mins || 0);
    }));
    Object.keys(tmpl).forEach(k => { if (tmpl[k].n >= 2) m.templates[k] = { title: tmpl[k].title, n: tmpl[k].n, rate: +(tmpl[k].done / tmpl[k].n).toFixed(2) }; });
    const nights = Object.values(perDay);
    if (nights.length >= 3) { const avg = nights.reduce((a, b) => a + b, 0) / nights.length; m.night = { avg: Math.round(avg), cap: Math.max(30, Math.min(120, Math.round(avg * 1.25 / 5) * 5)), n: nights.length }; }

    // 6) qué tono del coach va con tus días buenos
    const tone = {};
    keys.forEach(k => { const r = S.days[k]; if (r && r.coach) { const t = tone[r.coach] || (tone[r.coach] = { n: 0, ok: 0 }); t.n++; if (counted(r)) t.ok++; } });
    const tkeys = Object.keys(tone).filter(k => tone[k].n >= 3);
    m.tone = { stats: Object.fromEntries(Object.keys(tone).map(k => [k, { n: tone[k].n, rate: +(tone[k].ok / tone[k].n).toFixed(2) }])), best: null };
    if (tkeys.length >= 2) { const b = tkeys.reduce((a, c) => (tone[c].ok / tone[c].n > tone[a].ok / tone[a].n ? c : a)); const worst = tkeys.reduce((a, c) => (tone[c].ok / tone[c].n < tone[a].ok / tone[a].n ? c : a)); if (tone[b].ok / tone[b].n - tone[worst].ok / tone[worst].n >= 0.2) m.tone.best = b; }

    // 7) racha reciente: ¿hace falta bajar la carga?
    const prev = win.filter(k => k < today).slice(-3);
    if (prev.length === 3) { const ok = prev.filter(k => counted(S.days[k])).length; m.load = { last3: ok, minimal: ok <= 1 }; }

    m.insights = insights(m, habits);
    return m;
  }

  function insights(m, habits) {
    const out = [];
    if (m.n < 5) return [{ id: 'start', conf: 0, text: `Todavía estoy aprendiendo de ti (${m.n} de 5 días con registro). Con 5 días empiezo a detectar patrones; con 14 son más fiables.` }];
    const conf = n => (n >= 14 ? 'alta' : n >= 8 ? 'media' : 'baja');
    const hs = habits.map(h => [h, m.habit[h.id]]).filter(x => x[1] && x[1].lift !== null && Math.abs(x[1].lift) >= 0.2).sort((a, b) => b[1].lift - a[1].lift);
    if (hs.length && hs[0][1].lift > 0) { const [h, v] = hs[0]; out.push({ id: 'lift', conf: conf(m.mood ? m.mood.n : 0), text: `Los días que ${label(h.id)}, tu ánimo es bueno con más frecuencia (+${pct(v.lift)} puntos). Es tu mejor palanca.` }); }
    if (m.mood) {
      const w = m.mood.byWeekday.map((v, i) => [v, i]).filter(x => x[0] !== null);
      if (w.length >= 3) { const low = w.reduce((a, b) => (b[0] < a[0] ? b : a)); if (low[0] < m.mood.avg - 0.3) out.push({ id: 'moodday', conf: conf(m.mood.n), text: `Tu ánimo suele bajar los ${DAYS_FULL[low[1]]}. Ese día conviene planificar menos y empezar con algo fácil.` }); }
    }
    if (m.bestHour !== null) { const h = m.bestHour; const slot = h < 12 ? 'por la mañana' : h < 19.5 ? 'por la tarde' : 'por la noche'; out.push({ id: 'hour', conf: conf(m.n), text: `Sueles cumplir tus misiones ${slot} (hacia las ${Math.floor(h)}:${pad(Math.round((h % 1) * 60))}).` }); }
    if (m.weekday && m.weekday.weak !== null) out.push({ id: 'weak', conf: conf(m.n), text: `El ${DAYS_FULL[m.weekday.weak]} es tu día más flojo (cumples ${pct(m.weekday.rate[m.weekday.weak])}% de esos días). Lo cuido en el plan.` });
    if (m.night) out.push({ id: 'night', conf: conf(m.night.n), text: `Terminas unos ${m.night.avg} min de tareas por noche. Ajusto el aviso de sobrecarga a ${m.night.cap} min.` });
    if (m.tone && m.tone.best) out.push({ id: 'tone', conf: conf(m.n), text: `Cumples más cuando el coach es ${{ direct: 'directo', empathic: 'cercano', socratic: 'de preguntas', celebrate: 'celebrador' }[m.tone.best]} (${pct(m.tone.stats[m.tone.best].rate)}% de días cumplidos). Lo uso más.` });
    const ts = Object.values(m.templates).filter(t => t.n >= 3);
    const hard = ts.filter(t => t.rate < 0.4).sort((a, b) => a.rate - b.rate)[0];
    if (hard) out.push({ id: 'hard', conf: conf(hard.n), text: `«${hard.title}» solo la terminas el ${pct(hard.rate)}% de las veces. Prueba hacerla más corta o cambiarla de día.` });
    const easy = ts.filter(t => t.rate >= 0.8).sort((a, b) => b.rate - a.rate)[0];
    if (easy) out.push({ id: 'easy', conf: conf(easy.n), text: `«${easy.title}» es tu tarea más constante (${pct(easy.rate)}%). Úsala para arrancar el bloque.` });
    if (m.load && m.load.minimal) out.push({ id: 'minimal', conf: 'media', text: 'Los últimos días cumpliste poco. Hoy te muestro solo lo mínimo para retomar el ritmo.' });
    if (!out.length) out.push({ id: 'neutral', conf: 'baja', text: 'Aún no veo patrones claros. Sigue registrando tu ánimo y tus misiones: cada día mejora lo que sé de ti.' });
    return out;
  }

  /* La palanca de hoy: el hábito con mejor efecto en tu ánimo que aún no hiciste. */
  function lever(m, C, habitsDone) {
    if (!m || !C) return null;
    const c = C.habits.map(h => [h, m.habit[h.id]]).filter(x => x[1] && x[1].lift !== null && x[1].lift >= 0.2 && !habitsDone[x[0].id]).sort((a, b) => b[1].lift - a[1].lift)[0];
    return c ? { habit: c[0], lift: c[1].lift } : null;
  }

  window.Learn = { compute, lever, label };
})();
