'use strict';
/* Cumbre — coach interactivo. Todo se guarda en el dispositivo (localStorage). */
const KEY = 'coach.v1';
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAYS_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MOODS = ['😣', '😕', '🙂', '😄'];
const NIGHT_LIMIT = 120; // minutos útiles en el bloque 20:00–22:00
const MONTHLY_GOAL = 1000;

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };
const todayStr = () => fmt(new Date());
const todayIdx = () => (new Date().getDay() + 6) % 7;
const dayNum = () => Math.floor((parse(todayStr()) - new Date(2026, 0, 1)) / 864e5);
const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let C = null;           // contenido (data/content.json)
let S = load();         // estado
let tab = 'hoy';
let wiz = null;         // asistente de planificación semanal
let timerRef = null;

function fresh() {
  return { v: 1, xp: 0, days: {}, plan: null, history: {}, settings: { bedtime: '23:00', redes: 45, notif: false } };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return Object.assign(fresh(), s); } catch (e) { /* sin almacenamiento */ }
  return fresh();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignorar */ } }
function rec(ds) {
  if (!S.days[ds]) S.days[ds] = { habits: {}, tasksDone: 0, mood: 0, sent: 0, replies: 0, demos: 0, sales: 0, revenue: 0 };
  return S.days[ds];
}

/* ---------- reglas del juego ---------- */
function counted(ds) {
  const r = S.days[ds];
  return !!r && Object.keys(r.habits).length + (r.tasksDone || 0) >= 2;
}
function streakInfo() {
  const days = Object.keys(S.days).filter(counted).sort();
  if (!days.length) return { n: 0, risk: true };
  const earliest = parse(days[0]);
  const used = new Set();
  let d = new Date(); d.setHours(0, 0, 0, 0);
  const risk = !counted(fmt(d));
  if (risk) d = addDays(d, -1);
  let n = 0;
  while (d >= earliest) {
    if (counted(fmt(d))) n++;
    else {
      const wk = fmt(mondayOf(d));
      if (used.has(wk)) break;   // un "congelador" de racha por semana
      used.add(wk);
    }
    d = addDays(d, -1);
  }
  return { n, risk };
}
function levelInfo() {
  const lvl = Math.floor(Math.sqrt(S.xp / 50)) + 1;
  const cur = 50 * (lvl - 1) ** 2, next = 50 * lvl ** 2;
  return { lvl, name: C.niveles[Math.min(lvl - 1, C.niveles.length - 1)], pct: Math.round(100 * (S.xp - cur) / (next - cur)), left: next - S.xp };
}
function addXP(n) {
  const before = levelInfo().lvl;
  S.xp = Math.max(0, S.xp + n);
  const after = levelInfo().lvl;
  if (n > 0) { toast(after > before ? `¡Nivel ${after}! 🎉` : `+${n} XP`); beep(); }
}
const thisMon = () => fmt(mondayOf(new Date()));
// Los domingos se planifica la semana que viene; el resto de días, la actual.
const targetWeek = () => todayIdx() === 6 ? fmt(addDays(mondayOf(new Date()), 7)) : thisMon();
function planCurrent() {
  if (S.plan && S.plan.weekStart === thisMon()) return S.plan;
  return S.history[thisMon()] || null;
}
function overdue() {
  const p = planCurrent();
  return p ? p.tasks.filter(t => t.day < todayIdx() && !t.done) : [];
}
// Atrasadas pendientes + las que se completaron hoy (para que sigan visibles marcadas)
function lateToday() {
  const p = planCurrent();
  return p ? p.tasks.filter(t => t.day < todayIdx() && (!t.done || t.done === todayStr())) : [];
}
function monthRevenue() {
  const m = todayStr().slice(0, 7);
  return Object.entries(S.days).filter(([k]) => k.startsWith(m)).reduce((a, [, r]) => a + (r.revenue || 0), 0);
}

/* ---------- coach (modos) ---------- */
function coachMsg() {
  const r = rec(todayStr());
  const st = streakInfo();
  const late = overdue().length;
  let mode;
  if (r.mood && r.mood <= 2) mode = 'empathic';
  else if (late > 0 || (st.n === 0 && Object.keys(S.days).filter(counted).length > 0)) mode = 'direct';
  else if (counted(todayStr()) && st.n >= 3) mode = 'celebrate';
  else mode = 'socratic';
  const list = C.coach[mode];
  let msg = list[dayNum() % list.length].replace('{streak}', st.n).replace('{xp}', S.xp);
  if (mode === 'direct' && late) msg += ` Tienes ${late} tarea${late > 1 ? 's' : ''} atrasada${late > 1 ? 's' : ''}.`;
  const label = { direct: 'Directo', empathic: 'Contigo', socratic: 'Pregunta', celebrate: 'Celebrando' }[mode];
  return { mode, msg, label };
}

/* ---------- utilidades de interfaz ---------- */
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 1600);
}
function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 660; g.gain.value = 0.05;
    o.start(); o.frequency.setValueAtTime(880, a.currentTime + 0.08); o.stop(a.currentTime + 0.18);
  } catch (e) { /* sin audio */ }
}
function openSheet(html) { const o = $('#overlay'); o.innerHTML = `<div class="sheet">${html}</div>`; o.hidden = false; }
function closeSheet() { clearInterval(timerRef); $('#overlay').hidden = true; $('#overlay').innerHTML = ''; }

/* ---------- misiones de hoy ---------- */
function habitById(id) { return C.habits.find(h => h.id === id); }
function setHabit(id, on) {
  const r = rec(todayStr()), h = habitById(id);
  if (on && !r.habits[id]) { r.habits[id] = true; addXP(h.xp); }
  else if (!on && r.habits[id]) { delete r.habits[id]; addXP(-h.xp); }
  save(); render();
}
function setTask(id, on) {
  const p = planCurrent(); const t = p && p.tasks.find(x => x.id === id); if (!t) return;
  const r = rec(todayStr());
  const xp = 20 + Math.round((t.mins || 0) / 5);
  if (on && !t.done) { t.done = todayStr(); r.tasksDone = (r.tasksDone || 0) + 1; addXP(xp); }
  else if (!on && t.done) { const dr = rec(t.done); dr.tasksDone = Math.max(0, (dr.tasksDone || 0) - 1); t.done = null; addXP(-xp); }
  save(); render();
}
function missionRow(m) {
  return `<button class="mission ${m.done ? 'done' : ''} ${m.late ? 'late' : ''}" data-act="${m.act}" data-id="${esc(m.id)}">
    <span class="ic">${m.icon}</span>
    <span class="tx"><b>${esc(m.t)}</b>${m.sub ? `<small>${esc(m.sub)}</small>` : ''}</span>
    <span class="xp">+${m.xp}</span><span class="ck">✓</span></button>`;
}
function habitMission(h) {
  const act = { check: 'habit', physical: 'physical', timer: 'timer-habit', salmo: 'salmo' }[h.kind];
  const r = rec(todayStr());
  let sub = '';
  if (h.id === 'redes') sub = `Límite: ${S.settings.redes} min`;
  if (h.id === 'sleep') sub = `Hora de dormir: ${S.settings.bedtime}`;
  if (h.id === 'med') sub = 'Con cronómetro y guía';
  return { id: h.id, t: h.t, sub, xp: h.xp, icon: h.icon, done: !!r.habits[h.id], act };
}
function taskMission(t, late) {
  const xp = 20 + Math.round((t.mins || 0) / 5);
  return { id: t.id, t: t.title, sub: `${t.mins || 0} min${late ? ' · atrasada (' + DAYS[t.day] + ')' : ''}`, xp, icon: t.block === 'pm' ? '🦎' : '✅', done: !!t.done, act: 'task', late };
}

/* ---------- vistas ---------- */
function header() {
  const st = streakInfo(), lv = levelInfo();
  return `<div class="top">
    <div class="grow"><h1>Hola, Esteban</h1><small>${DAYS_FULL[todayIdx()]} ${new Date().getDate()}</small></div>
    <span class="pill flame" title="Racha">🔥 ${st.n}</span><span class="pill" title="XP">⭐ ${S.xp}</span></div>
    <div class="card"><div class="row sb"><b>Nivel ${lv.lvl} · ${esc(lv.name)}</b><small>faltan ${lv.left} XP</small></div>
    <div class="bar" style="margin-top:8px"><i style="width:${lv.pct}%"></i></div></div>`;
}
function viewHoy() {
  const ds = todayStr(), r = rec(ds), cm = coachMsg();
  const dato = C.datos[dayNum() % C.datos.length];
  const p = planCurrent();
  const tasks = p ? p.tasks.filter(t => t.day === todayIdx()) : [];
  const am = tasks.filter(t => t.block !== 'pm'), pm = tasks.filter(t => t.block === 'pm');
  const slot = s => C.habits.filter(h => h.slot === s).map(habitMission).map(missionRow).join('');
  let h = header();
  h += `<div class="card coach"><div class="av">🦎</div><div class="grow"><div class="row sb"><span class="badge ${cm.mode}">${cm.label}</span></div>
    <p>${esc(cm.msg)}</p>
    <div class="mood" style="margin-top:10px"><small>¿Cómo vienes hoy?</small><br>${MOODS.map((m, i) => `<button class="${r.mood === i + 1 ? 'on' : ''}" data-act="mood" data-id="${i + 1}">${m}</button>`).join('')}</div></div></div>`;
  if (!p) h += `<div class="card"><b>Aún no tienes plan esta semana</b><p class="mut">Tarda 15 minutos y define tus tareas.</p><button class="btn" data-act="wiz">Planificar mi semana</button></div>`;
  h += `<div class="card"><div class="row sb"><b>💬 Para conversar hoy</b></div><p>${esc(dato.t)}</p><p><i>«${esc(dato.q)}»</i></p></div>`;
  const od = lateToday();
  if (od.length) h += `<div class="sec-h"><h2>⚠️ Atrasadas</h2></div>` + od.map(t => missionRow(taskMission(t, true))).join('');
  h += `<div class="sec-h"><h2>☀️ Mañana</h2><small>antes de las 7:30</small></div>` + slot('manana') + am.map(t => missionRow(taskMission(t))).join('');
  h += `<div class="sec-h"><h2>🌆 Tarde</h2></div>` + slot('tarde');
  h += `<div class="sec-h"><h2>🦎 Noche · Iguana</h2><small>20:00–22:00</small></div>` + (pm.length ? pm.map(t => missionRow(taskMission(t))).join('') : `<p class="mut">No hay tareas de noche hoy. Añádelas en la pestaña Semana.</p>`);
  h += `<div class="sec-h"><h2>🌙 Cierre</h2></div>` + slot('cierre');
  return h;
}
function viewSemana() {
  if (wiz) return viewWizard();
  const p = planCurrent();
  let h = `<h1>Semana</h1>`;
  const ahead = S.plan && S.plan.weekStart > thisMon();
  h += `<div class="card"><button class="btn" data-act="wiz">${todayIdx() === 6 ? 'Planificar la próxima semana' : p ? 'Replanificar la semana' : 'Planificar mi semana'}</button><p class="mut">${ahead ? '✅ Ya tienes listo el plan de la próxima semana.' : 'Hazlo los domingos (15 min).'}</p></div>`;
  if (!p) return h;
  h += `<div class="card"><b>Prioridades</b>${p.priorities.filter(Boolean).map((x, i) => `<p>${i + 1}. ${esc(x)}</p>`).join('') || '<p class="mut">Sin prioridades.</p>'}</div>`;
  h += `<div class="card">`;
  for (let d = 0; d < 7; d++) {
    const ts = p.tasks.filter(t => t.day === d);
    const night = ts.filter(t => t.block === 'pm').reduce((a, t) => a + (t.mins || 0), 0);
    h += `<div class="day"><h3><span>${DAYS_FULL[d]}${d === todayIdx() ? ' · hoy' : ''}</span><small class="${night > NIGHT_LIMIT ? 'warn' : ''}">${night} min noche</small></h3>`;
    h += ts.map(t => `<div class="task ${t.done ? 'done' : ''}"><span class="t">${esc(t.title)}<br><span class="m">${t.block === 'pm' ? '🦎 noche' : '☀️ día'} · ${t.mins} min</span></span>${d < 6 ? `<button class="x" data-act="mv" data-id="${t.id}" title="Mover a mañana">↪</button>` : ''}<button class="x" data-act="rm" data-id="${t.id}" title="Borrar">✕</button></div>`).join('') || '<small class="mut">Libre</small>';
    h += `</div>`;
  }
  h += `</div>` + addTaskForm('qa');
  if (p.team && p.team.some(x => x.what)) h += `<div class="card"><b>Compromisos del equipo</b>${p.team.filter(x => x.what).map(x => `<p>• <b>${esc(x.who)}</b>: ${esc(x.what)} <small>(${esc(x.when || 'sin fecha')})</small></p>`).join('')}</div>`;
  return h;
}
function addTaskForm(pfx) {
  return `<div class="card"><b>Añadir tarea</b>
    <label>Tarea</label><input id="${pfx}-t" placeholder="Ej: Enviar 5 mensajes a barberías">
    <div class="row"><div class="grow"><label>Día</label><select id="${pfx}-d">${DAYS_FULL.map((d, i) => `<option value="${i}" ${i === todayIdx() ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    <div class="grow"><label>Bloque</label><select id="${pfx}-b"><option value="pm">Noche (Iguana)</option><option value="am">Día / mañana</option></select></div>
    <div style="width:90px"><label>Min</label><input id="${pfx}-m" type="number" value="30" min="5" step="5"></div></div>
    <button class="btn sec" style="margin-top:12px" data-act="addtask" data-id="${pfx}">Añadir</button>
    <div style="margin-top:6px">${C.plantillas.map((t, i) => `<span class="chip" data-act="tpl" data-id="${pfx}:${i}">${esc(t.t)}</span>`).join('')}</div></div>`;
}
function viewMonte() {
  const E = C.etapas;
  let idx = 0;
  E.forEach((e, i) => { if (S.xp >= e.xp) idx = i; });
  const next = E[idx + 1];
  const frac = next ? (S.xp - E[idx].xp) / (next.xp - E[idx].xp) : 1;
  // puntos del camino en un SVG de 320x170
  const pts = [[16, 150], [60, 130], [100, 108], [140, 80], [168, 34], [206, 100], [244, 70], [290, 28]];
  const a = pts[idx], b = pts[Math.min(idx + 1, pts.length - 1)];
  const mx = a[0] + (b[0] - a[0]) * frac, my = a[1] + (b[1] - a[1]) * frac;
  const svg = `<svg class="map" viewBox="0 0 320 170" role="img" aria-label="Mapa de la montaña">
    <polygon points="0,170 40,120 100,90 168,24 230,110 260,80 292,22 320,70 320,170" fill="#5b7a66"/>
    <polygon points="168,24 150,60 170,52 186,64" fill="#fff" opacity=".9"/><polygon points="292,22 278,48 292,42 304,52" fill="#fff" opacity=".9"/>
    <polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="6 5"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${i <= idx ? '#f2b705' : '#fff'}" stroke="#17231c" stroke-width="2"/>`).join('')}
    <text x="${mx}" y="${my - 12}" font-size="20" text-anchor="middle">🧗</text></svg>`;
  let h = `<h1>Montaña</h1>` + svg;
  h += `<div class="card"><b>${esc(E[idx].n)}</b> · ${E[idx].alt} m<br>${next ? `<small>Siguiente: ${esc(next.n)} — faltan ${next.xp - S.xp} XP</small><div class="bar" style="margin-top:8px"><i style="width:${Math.round(frac * 100)}%"></i></div>` : '<b>🏁 ¡Llegaste a la cumbre del Cayambe!</b>'}</div>`;
  h += `<div class="card">${E.map((e, i) => `<div class="stage ${i <= idx ? 'on' : ''} ${i === idx ? 'cur' : ''}"><span class="d">✓</span><div class="grow"><b>${esc(e.n)}</b><br><small>${e.alt} m · ${e.xp} XP</small></div></div>`).join('')}</div>`;
  h += `<p class="mut">Cada misión y hábito te suma XP. Mueve también tu marcador en la pizarra física.</p>`;
  return h;
}
function sumWeek(field) {
  const mon = mondayOf(new Date());
  let n = 0;
  for (let i = 0; i < 7; i++) n += (S.days[fmt(addDays(mon, i))] || {})[field] || 0;
  return n;
}
function viewIguana() {
  const r = rec(todayStr());
  const rev = monthRevenue(), pct = Math.min(100, Math.round(100 * rev / MONTHLY_GOAL));
  let h = `<h1>Iguana 🦎</h1>`;
  h += `<div class="card"><div class="row sb"><b>Meta del mes</b><b>US$${rev} / ${MONTHLY_GOAL}</b></div><div class="bar" style="margin-top:8px"><i style="width:${pct}%"></i></div></div>`;
  h += `<div class="stat"><div><b>${sumWeek('sent')}</b><small>mensajes</small></div><div><b>${sumWeek('replies')}</b><small>respuestas</small></div><div><b>${sumWeek('demos')}</b><small>demos</small></div></div>`;
  h += `<p class="mut">Esta semana. Hoy: ${r.sent} enviados, ${r.replies} respuestas, ${r.demos} demos.</p>`;
  h += `<button class="btn" data-act="ig" data-id="sent">+1 mensaje enviado</button><div style="height:8px"></div>
    <button class="btn sec" data-act="ig" data-id="replies">+1 respuesta / conversación</button><div style="height:8px"></div>
    <button class="btn sec" data-act="ig" data-id="demos">+1 demo agendada</button><div style="height:8px"></div>
    <button class="btn" data-act="ig" data-id="sales">💰 ¡Nueva venta!</button>`;
  h += `<h2>Mensajes por nicho</h2><p class="mut">Cambia [beneficio de Iguana] por lo que muestra tu demo. Toca para copiar.</p>`;
  h += C.nichos.map((n, i) => `<div class="card"><b>${esc(n.n)}</b><p>${esc(n.msg)}</p><button class="btn sec sm" data-act="copy" data-id="${i}">Copiar</button></div>`).join('');
  return h;
}
function viewMas() {
  const s = S.settings;
  return `<h1>Más</h1>
  <div class="card"><b>Notificaciones</b><p class="mut">La app puede avisarte mientras está abierta. Para alarmas aunque esté cerrada, descarga el calendario (.ics) y ábrelo en tu celular.</p>
    <button class="btn" data-act="notif">${s.notif ? 'Notificaciones activadas ✓' : 'Activar notificaciones'}</button><div style="height:8px"></div>
    <button class="btn sec" data-act="ics">Descargar alarmas (.ics)</button></div>
  <div class="card"><b>Tus límites</b>
    <label>Hora de dormir</label><input type="time" id="set-bed" value="${esc(s.bedtime)}">
    <label>Límite de redes al día (min)</label><input type="number" id="set-redes" value="${s.redes}" min="0" step="5"></div>
  <div class="card"><b>Pizarra física</b><p class="mut">Imprime la hoja con tu plan de la semana, tu racha y tu montaña.</p><a href="pizarra.html" target="_blank" rel="noopener">Abrir pizarra para imprimir</a></div>
  <div class="card"><b>Respaldo</b><p class="mut">Guarda tu plan y progreso o llévalos a otro dispositivo.</p>
    <button class="btn sec" data-act="export">Exportar datos</button><div style="height:8px"></div>
    <label class="btn sec" style="cursor:pointer">Importar datos<input type="file" id="imp" accept="application/json" hidden></label></div>
  <div class="card"><b>Reiniciar</b><button class="btn bad" data-act="reset">Borrar todo</button></div>`;
}

/* ---------- asistente de planificación semanal ---------- */
function startWizard() {
  const target = targetWeek();
  const prev = [S.plan, ...Object.values(S.history)].filter(p => p && p.weekStart < target).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0] || null;
  const cur = S.plan && S.plan.weekStart === target ? S.plan : (S.history[target] || null);
  wiz = {
    step: 1,
    prev,
    target,
    carry: {},
    draft: cur ? JSON.parse(JSON.stringify(cur)) : { weekStart: target, priorities: ['', '', ''], tasks: [], team: [{ who: 'Developer', what: '', when: '' }, { who: 'Financiero', what: '', when: '' }, { who: 'Yo', what: '', when: '' }] }
  };
  tab = 'semana';
  render();
}
function viewWizard() {
  const w = wiz, d = w.draft;
  let h = `<h1>Planificar semana</h1><div class="stepper">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= w.step ? 'on' : ''}"></i>`).join('')}</div>`;
  if (w.step === 1) {
    h += `<h2>1. Cómo te fue</h2>`;
    if (w.prev) {
      const done = w.prev.tasks.filter(t => t.done).length;
      const mon = parse(w.prev.weekStart);
      let xpDays = 0, sales = 0, rev = 0, sent = 0;
      for (let i = 0; i < 7; i++) { const r = S.days[fmt(addDays(mon, i))]; if (r) { if (counted(fmt(addDays(mon, i)))) xpDays++; sales += r.sales || 0; rev += r.revenue || 0; sent += r.sent || 0; } }
      h += `<div class="stat"><div><b>${done}/${w.prev.tasks.length}</b><small>tareas</small></div><div><b>${xpDays}</b><small>días con racha</small></div><div><b>${sent}</b><small>mensajes</small></div></div>
        <p class="mut">Ventas: ${sales} · Ingresos: US$${rev}</p>`;
      const pend = w.prev.tasks.filter(t => !t.done);
      h += pend.length ? `<h2>Pendientes: ¿las pasas a esta semana?</h2>` + pend.map(t => `<label class="chk"><input type="checkbox" data-carry="${t.id}" ${w.carry[t.id] ? 'checked' : ''}><span>${esc(t.title)}</span></label>`).join('') : '<p>No quedó nada pendiente 🎉</p>';
    } else h += `<p class="mut">Es tu primera planificación. ¡Empecemos desde cero!</p>`;
  }
  if (w.step === 2) {
    h += `<h2>2. Tus 3 prioridades grandes</h2><p class="mut">Piensa en las primeras ventas de Iguana: campañas, contenido, prospección.</p>`;
    h += [0, 1, 2].map(i => `<label>Prioridad ${i + 1}</label><input data-bind="prio.${i}" value="${esc(d.priorities[i])}" placeholder="${['Ej: Lanzar campaña para barberías', 'Ej: Agendar 3 demos', 'Ej: Dormir antes de las 23:00'][i]}">`).join('');
  }
  if (w.step === 3) {
    h += `<h2>3. Tareas de la semana</h2><button class="btn sec" data-act="suggest">✨ Sugerir semana de Iguana</button>`;
    for (let i = 0; i < 7; i++) {
      const ts = d.tasks.filter(t => t.day === i);
      const night = ts.filter(t => t.block === 'pm').reduce((a, t) => a + (t.mins || 0), 0);
      h += `<div class="day"><h3><span>${DAYS_FULL[i]}</span><small class="${night > NIGHT_LIMIT ? 'warn' : ''}">${night}/${NIGHT_LIMIT} min noche</small></h3>` +
        ts.map(t => `<div class="task"><span class="t">${esc(t.title)} <span class="m">${t.block === 'pm' ? '🦎' : '☀️'} ${t.mins} min</span></span><button class="x" data-act="wrm" data-id="${t.id}">✕</button></div>`).join('') +
        (night > NIGHT_LIMIT ? `<small class="warn">Demasiado para una noche. Mueve algo a otro día.</small>` : '') + `</div>`;
    }
    h += addTaskForm('wz');
  }
  if (w.step === 4) {
    h += `<h2>4. Compromisos del equipo</h2><p class="mut">Cada quien con una tarea concreta y una fecha. Lo que no tiene dueño ni fecha no se hace.</p>`;
    h += d.team.map((m, i) => `<div class="card"><label>Quién</label><input data-bind="team.${i}.who" value="${esc(m.who)}"><label>Qué se compromete a hacer</label><input data-bind="team.${i}.what" value="${esc(m.what)}"><label>Para cuándo</label><input data-bind="team.${i}.when" value="${esc(m.when)}" placeholder="Ej: viernes"></div>`).join('');
  }
  if (w.step === 5) {
    h += `<h2>5. Confirmar</h2><div class="card"><b>Prioridades</b>${d.priorities.filter(Boolean).map((x, i) => `<p>${i + 1}. ${esc(x)}</p>`).join('') || '<p class="mut">Sin prioridades</p>'}</div>
      <div class="card"><b>${d.tasks.length} tareas</b> · ${d.tasks.filter(t => t.block === 'pm').reduce((a, t) => a + t.mins, 0)} min de noche en total</div>
      <div class="card"><b>Equipo</b>${d.team.filter(m => m.what).map(m => `<p>• ${esc(m.who)}: ${esc(m.what)} (${esc(m.when || 'sin fecha')})</p>`).join('') || '<p class="mut">Sin compromisos</p>'}</div>`;
  }
  h += `<div class="row" style="margin-top:16px">${w.step > 1 ? '<button class="btn sec" data-act="wback">Atrás</button>' : '<button class="btn sec" data-act="wcancel">Cancelar</button>'}<button class="btn" data-act="${w.step === 5 ? 'wsave' : 'wnext'}">${w.step === 5 ? 'Guardar plan' : 'Siguiente'}</button></div>`;
  return h;
}
function setPath(obj, path, val) {
  const k = path.split('.'); let o = obj;
  for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
  o[k[k.length - 1]] = val;
}
function readTaskForm(pfx) {
  const title = $('#' + pfx + '-t').value.trim();
  if (!title) { toast('Escribe la tarea'); return null; }
  return { id: uid(), title, day: +$('#' + pfx + '-d').value, block: $('#' + pfx + '-b').value, mins: Math.max(5, +$('#' + pfx + '-m').value || 30), done: null };
}
function saveWizard() {
  const d = wiz.draft;
  if (wiz.prev) {
    wiz.prev.tasks.filter(t => wiz.carry[t.id]).forEach(t => d.tasks.push({ id: uid(), title: t.title, day: d.weekStart === thisMon() ? Math.max(0, todayIdx()) : 0, block: t.block, mins: t.mins, done: null }));
  }
  if (S.plan && S.plan.weekStart !== d.weekStart) S.history[S.plan.weekStart] = S.plan;
  delete S.history[d.weekStart];
  S.plan = d; wiz = null; tab = 'hoy';
  save(); toast('Plan guardado ✅'); render();
}

/* ---------- salmo, cronómetro ---------- */
function openTimer({ title, secs, steps, why, onDone }) {
  let left = secs, run = false;
  const draw = () => { const el = $('#clk'); if (el) el.textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`; };
  openSheet(`<h1>${esc(title)}</h1>${why ? `<p class="mut">${esc(why)}</p>` : ''}${steps ? `<ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    <div class="clock" id="clk"></div>
    <button class="btn" id="tstart">Iniciar</button><div style="height:8px"></div>
    <button class="btn sec" id="tdone">Listo ✓</button><div style="height:8px"></div>
    <button class="btn sec" id="tclose">Cerrar</button>`);
  draw();
  $('#tstart').onclick = () => {
    run = !run; $('#tstart').textContent = run ? 'Pausar' : 'Reanudar';
    clearInterval(timerRef);
    if (run) timerRef = setInterval(() => { left--; draw(); if (left <= 0) { clearInterval(timerRef); closeSheet(); onDone(); } }, 1000);
  };
  $('#tdone').onclick = () => { closeSheet(); onDone(); };
  $('#tclose').onclick = closeSheet;
}
function openSalmo() {
  const s = C.salmos[dayNum() % C.salmos.length];
  const fmtId = dayNum() % 3;
  const link = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(s.ref)}&version=RVR1960`;
  let body = '';
  if (fmtId === 0) body = `<p>${esc(s.q)}</p><textarea id="sn" rows="3" placeholder="Tu respuesta (opcional)"></textarea><button class="btn" id="sdone" style="margin-top:12px">Lo leí y reflexioné</button>`;
  else if (fmtId === 1) body = `<p><b>${esc(s.quiz.q)}</b></p>${s.quiz.o.map((o, i) => `<button class="opt" data-q="${i}">${esc(o)}</button>`).join('')}<div id="qres"></div>`;
  else body = `<div class="card"><b>Idea para recordar</b><p>${esc(s.idea)}</p></div><p><b>¿Cómo la aplicas hoy?</b></p>${s.apply.map((a, i) => `<button class="opt" data-a="${i}">${esc(a)}</button>`).join('')}`;
  openSheet(`<h1>📖 ${esc(s.ref)}</h1><p><a href="${link}" target="_blank" rel="noopener">Léelo completo en tu Biblia ↗</a></p>${body}<button class="btn sec" id="sclose" style="margin-top:12px">Cerrar</button>`);
  $('#sclose').onclick = closeSheet;
  const finish = bonus => { closeSheet(); setHabit('salmo', true); if (bonus) addXP(bonus); save(); render(); };
  if (fmtId === 0) $('#sdone').onclick = () => finish(0);
  document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
    const ok = +b.dataset.q === s.quiz.a;
    b.classList.add(ok ? 'ok' : 'no');
    $('#qres').innerHTML = ok ? '<p><b>¡Correcto! +5 XP</b></p><button class="btn" id="qn">Continuar</button>' : '<p>Casi. Intenta otra opción.</p>';
    if (ok) $('#qn').onclick = () => finish(5);
  });
  document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => finish(0));
}

/* ---------- notificaciones y calendario ---------- */
let notifTimers = [];
async function showNotif(t, b) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) reg.showNotification(t, { body: b, icon: 'icon-192.png', badge: 'icon-192.png' }); else new Notification(t, { body: b });
  } catch (e) { /* ignorar */ }
}
function scheduleLocal() {
  notifTimers.forEach(clearTimeout); notifTimers = [];
  if (!S.settings.notif || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  C.reminders.forEach(r => {
    if (r.days === 'SU' && now.getDay() !== 0) return;
    const at = new Date(); at.setHours(r.h, r.m, 0, 0);
    if (at > now) notifTimers.push(setTimeout(() => showNotif(r.t, r.b), at - now));
  });
}
async function enableNotif() {
  if (!('Notification' in window)) { toast('Tu navegador no soporta notificaciones'); return; }
  const p = await Notification.requestPermission();
  S.settings.notif = p === 'granted'; save(); scheduleLocal(); render();
  toast(S.settings.notif ? 'Notificaciones activadas' : 'Permiso denegado');
}
function downloadFile(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function makeICS() {
  const start = fmt(new Date()).replace(/-/g, '');
  const ev = C.reminders.map((r, i) => [
    'BEGIN:VEVENT', `UID:cumbre-${i}@coach`, `DTSTAMP:${start}T000000`, `DTSTART:${start}T${pad(r.h)}${pad(r.m)}00`, 'DURATION:PT15M',
    r.days === 'SU' ? 'RRULE:FREQ=WEEKLY;BYDAY=SU' : 'RRULE:FREQ=DAILY',
    `SUMMARY:${r.t}`, `DESCRIPTION:${r.b}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${r.t}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'].join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cumbre//Coach//ES', ...ev, 'END:VCALENDAR'].join('\r\n');
}

/* ---------- render y eventos ---------- */
function render() {
  const v = { hoy: viewHoy, semana: viewSemana, monte: viewMonte, iguana: viewIguana, mas: viewMas }[tab];
  $('#app').innerHTML = v();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
}
document.addEventListener('click', e => {
  const tb = e.target.closest('#tabs button');
  if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  switch (act) {
    case 'habit': setHabit(id, !rec(todayStr()).habits[id]); break;
    case 'physical': {
      const h = habitById(id);
      if (rec(todayStr()).habits[id]) setHabit(id, false);
      else openSheet(`<h1>${h.icon} Misión física</h1><p>${esc(h.t)}</p><p class="mut">Hazlo en tu pizarra y confirma cuando termines.</p><button class="btn" id="pc">Ya lo hice ✓</button><div style="height:8px"></div><button class="btn sec" id="px">Cerrar</button>`);
      if ($('#pc')) { $('#pc').onclick = () => { closeSheet(); setHabit(id, true); }; $('#px').onclick = closeSheet; }
      break;
    }
    case 'timer-habit': {
      const h = habitById(id);
      if (rec(todayStr()).habits[id]) { setHabit(id, false); break; }
      if (id === 'med') { const tip = C.tips[dayNum() % C.tips.length]; openTimer({ title: tip.t, secs: tip.secs, steps: tip.steps, why: tip.why, onDone: () => setHabit('med', true) }); }
      else openTimer({ title: h.t, secs: h.secs, onDone: () => setHabit(id, true) });
      break;
    }
    case 'salmo': if (rec(todayStr()).habits.salmo) setHabit('salmo', false); else openSalmo(); break;
    case 'task': {
      const t = planCurrent().tasks.find(x => x.id === id);
      if (t.done) setTask(id, false); else openTimer({ title: t.title, secs: (t.mins || 15) * 60, onDone: () => setTask(id, true) });
      break;
    }
    case 'mood': rec(todayStr()).mood = +id; save(); render(); break;
    case 'wiz': startWizard(); break;
    case 'wnext': wiz.step++; render(); window.scrollTo(0, 0); break;
    case 'wback': wiz.step--; render(); window.scrollTo(0, 0); break;
    case 'wcancel': wiz = null; render(); break;
    case 'wsave': saveWizard(); break;
    case 'suggest': wiz.draft.tasks = wiz.draft.tasks.concat(C.starter.map(s => ({ id: uid(), title: s.t, day: s.day, block: 'pm', mins: s.mins, done: null }))); render(); break;
    case 'wrm': wiz.draft.tasks = wiz.draft.tasks.filter(t => t.id !== id); render(); break;
    case 'addtask': {
      const t = readTaskForm(id); if (!t) break;
      if (id === 'wz') wiz.draft.tasks.push(t);
      else { if (!planCurrent()) { toast('Primero crea tu plan semanal'); break; } planCurrent().tasks.push(t); save(); }
      render(); break;
    }
    case 'tpl': {
      const [pfx, i] = id.split(':'); const t = C.plantillas[+i];
      $('#' + pfx + '-t').value = t.t; $('#' + pfx + '-m').value = t.mins; break;
    }
    case 'rm': { const p = planCurrent(); p.tasks = p.tasks.filter(t => t.id !== id); save(); render(); break; }
    case 'mv': { const t = planCurrent().tasks.find(x => x.id === id); if (t && t.day < 6) t.day++; save(); render(); break; }
    case 'ig': {
      const r = rec(todayStr());
      if (id === 'sales') {
        const v = prompt('¿Cuánto vendiste? (US$)', '30'); const n = parseFloat(v);
        if (!n || n < 0) break;
        r.sales++; r.revenue += n; addXP(200);
      } else { r[id]++; addXP({ sent: 3, replies: 10, demos: 25 }[id]); }
      save(); render(); break;
    }
    case 'copy': navigator.clipboard && navigator.clipboard.writeText(C.nichos[+id].msg).then(() => toast('Copiado')); break;
    case 'notif': enableNotif(); break;
    case 'ics': downloadFile('cumbre-alarmas.ics', 'text/calendar', makeICS()); break;
    case 'export': downloadFile('cumbre-respaldo.json', 'application/json', JSON.stringify(S, null, 2)); break;
    case 'reset': if (confirm('¿Borrar todo tu progreso y plan?')) { S = fresh(); save(); render(); } break;
  }
});
document.addEventListener('input', e => {
  const b = e.target.dataset.bind;
  if (b && wiz) setPath(wiz.draft, b.replace('prio', 'priorities'), e.target.value);
  if (e.target.id === 'set-bed') { S.settings.bedtime = e.target.value; save(); }
  if (e.target.id === 'set-redes') { S.settings.redes = +e.target.value || 0; save(); }
});
document.addEventListener('change', e => {
  if (e.target.dataset.carry && wiz) wiz.carry[e.target.dataset.carry] = e.target.checked;
  if (e.target.id === 'imp' && e.target.files[0]) {
    const f = e.target.files[0], rd = new FileReader();
    rd.onload = () => { try { const o = JSON.parse(rd.result); if (o.v !== 1) throw 0; S = Object.assign(fresh(), o); save(); render(); toast('Datos importados'); } catch (x) { toast('Archivo no válido'); } };
    rd.readAsText(f);
  }
});

fetch('data/content.json').then(r => r.json()).then(j => {
  C = j; render(); scheduleLocal();
}).catch(() => { $('#app').innerHTML = '<p>No se pudo cargar el contenido. Abre la app desde un servidor web.</p>'; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
