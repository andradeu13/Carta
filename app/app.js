'use strict';
/* Cumbre — coach interactivo. Todo se guarda en el dispositivo (localStorage). */
const KEY = 'coach.v1';
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAYS_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MOODS = [{ k: 'sad', n: 1, t: 'Triste' }, { k: 'anxious', n: 2, t: 'Ansioso' }, { k: 'calm', n: 3, t: 'Calmado' }, { k: 'happy', n: 4, t: 'Feliz' }];
const MOOD_FACE = { happy: '', calm: ' cb-face--calm', sad: ' cb-face--sad', anxious: ' cb-face--anxious' };
const MOOD_MSG = { 4: ['celebrate', 'Celebrando', 'Aprovecha esa energía: arranca por la tarea más difícil de Iguana.'], 3: ['socratic', 'Pregunta', '¿Qué es lo que más te acerca a tu primera venta esta semana?'], 2: ['empathic', 'Contigo', 'Respira 4-7-8 durante tres minutos y luego decidimos.'], 1: ['empathic', 'Contigo', 'Hay días pesados y está bien. Hoy basta con una misión pequeña.'] };
const JOURNAL = [
  { id: 'grat', t: 'Pausa y reflexiona', q: '¿Por qué estás agradecido hoy?', tag: 'Personal', tone: '' },
  { id: 'int', t: 'Define tu intención', q: '¿Cómo quieres sentirte esta noche?', tag: 'Iguana', tone: ' cb-jcard--lilac' },
  { id: 'desc', t: 'Descarga mental', q: 'Saca lo que te preocupa antes de dormir.', tag: 'Calma', tone: ' cb-jcard--sand' }
];
const ico = (n, c = '') => `<i class="cb-ico ${c} cb-ico-${n}"></i>`;
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
let selDay = null;      // día elegido en la tira semanal
let progRange = 7;      // rango de Progreso: 7 o 30 días
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
  { const r = rec(todayStr()); r.xp = Math.max(0, (r.xp || 0) + n); }
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


/* ---------- ilustraciones del banner (sol, tarde, luna, cumbre) ---------- */
function art(kind) {
  let rays = '';
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, c = Math.cos(a), sn = Math.sin(a); rays += `<line x1="${(c * 36).toFixed(1)}" y1="${(sn * 36).toFixed(1)}" x2="${(c * 46).toFixed(1)}" y2="${(sn * 46).toFixed(1)}"/>`; }
  const cloud = (x, y, d, fill) => `<g class="cb-drift" style="animation-delay:${d}s" fill="${fill}" opacity=".92"><ellipse cx="${x}" cy="${y}" rx="22" ry="8"/><ellipse cx="${x + 17}" cy="${y - 4}" rx="13" ry="8"/></g>`;
  const bird = (x, y, c) => `<path d="M${x} ${y}q5-6 10 0q5-6 10 0" stroke="${c}" fill="none" stroke-width="2" stroke-linecap="round"/>`;
  const open = '<svg viewBox="0 0 320 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">';
  if (kind === 'dawn') return open + cloud(214, 22, 0, 'var(--on-night)') + cloud(284, 52, -3, 'var(--on-night)') + bird(176, 20, 'var(--on-sun)') +
    `<g transform="translate(236 78)"><g class="cb-spin" stroke="var(--action)" stroke-width="4" stroke-linecap="round">${rays}</g><circle r="28" fill="var(--action)"/><circle cx="-9" cy="-3" r="3" fill="var(--on-action)"/><circle cx="9" cy="-3" r="3" fill="var(--on-action)"/><path d="M-9 8q9 8 18 0" stroke="var(--on-action)" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="-17" cy="6" r="4" fill="var(--pink)" opacity=".8"/><circle cx="17" cy="6" r="4" fill="var(--pink)" opacity=".8"/></g>` +
    '<path d="M0 150V108Q60 86 120 104T240 100T320 96V150Z" fill="var(--green)"/><path d="M0 150V128Q80 108 160 124T320 118V150Z" fill="var(--green-strong)"/><g fill="var(--green-strong)"><path d="M20 112l9-28 9 28z"/><path d="M42 114l7-20 7 20z"/><path d="M286 104l8-24 8 24z"/></g></svg>';
  if (kind === 'dusk') return open + cloud(214, 24, 0, 'var(--on-night)') + cloud(286, 60, -4, 'var(--on-night)') + bird(190, 52, 'var(--on-action)') +
    '<circle class="cb-bob" cx="236" cy="104" r="40" fill="var(--sun)"/><path d="M0 150V112Q70 92 130 108T250 104T320 100V150Z" fill="var(--brown)"/><path d="M0 150V130Q90 112 170 128T320 122V150Z" fill="color-mix(in oklab, var(--brown) 70%, black)"/><g fill="color-mix(in oklab, var(--brown) 70%, black)"><path d="M30 120l9-26 9 26z"/><path d="M52 122l6-18 6 18z"/></g></svg>';
  if (kind === 'night') {
    const stars = [[205, 28, 2.2, 0], [300, 20, 1.6, -1], [188, 64, 2, -.5], [236, 92, 1.5, -1.6], [306, 92, 1.4, -.8], [150, 100, 1.4, -2], [24, 104, 1.4, -1.2]].map(s => `<circle class="cb-twinkle" style="animation-delay:${s[3]}s" cx="${s[0]}" cy="${s[1]}" r="${s[2]}" fill="var(--on-night)"/>`).join('');
    return open + stars + '<g class="cb-bob"><path d="M262 38a30 30 0 1 0 22 52a24 24 0 0 1-22-52z" fill="var(--sun)"/></g><path d="M0 150V116Q70 96 140 112T320 104V150Z" fill="var(--green-strong)" opacity=".55"/><path d="M0 150V132Q100 116 180 130T320 126V150Z" fill="var(--green-strong)" opacity=".8"/></svg>';
  }
  return open + '<circle class="cb-bob" cx="296" cy="26" r="15" fill="var(--sun)"/>' + cloud(196, 20, 0, 'var(--on-night)') +
    '<path d="M90 150L178 64L212 98L262 38L340 150Z" fill="var(--brown)"/><path d="M178 64l-20 20l11-3l9 7l7-7l9 5z" fill="var(--on-night)"/><path d="M262 38l-22 22l13-4l9 8l9-8l11 6z" fill="var(--on-night)"/><path d="M0 150V124Q80 108 160 124T320 118V150Z" fill="var(--green-strong)"/><path d="M262 38v-20" stroke="var(--on-night)" stroke-width="2"/><path d="M262 18l15 6l-15 6z" fill="var(--action)"/></svg>';
}
const BELL = '<svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><g class="cb-bell"><path d="M42 12c-12 0-20 9-20 21v16l-6 8h52l-6-8V33c0-12-8-21-20-21z" fill="var(--action)"/><path d="M34 62a8 8 0 0 0 16 0z" fill="var(--action-strong)"/><circle cx="42" cy="10" r="4" fill="var(--action-strong)"/></g><path d="M12 28q-6 10 0 20M72 28q6 10 0 20" stroke="var(--action)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';
function daySlot() {
  const q = new URLSearchParams(location.search).get('slot');
  if (q) return q;
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  return h < 12 ? 'dawn' : h < 19.5 ? 'dusk' : h < 22 ? 'night' : 'summit';
}
const SLOT = {
  dawn: ['Buenos días', 'Empieza tu día', 'Tres minutos para elegir tus 3 prioridades.'],
  dusk: ['Buenas tardes', 'Hora de trotar', '30 a 45 minutos y luego a cenar con tu familia.'],
  night: ['Buenas noches', 'Bloque de Iguana', '20:00 a 22:00. Celular lejos de las redes.'],
  summit: ['Cierra el día', 'Cierra el día', 'Marca tu racha y mueve tu marcador en la montaña.']
};

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
  return `<button class="cb-routine ${m.done ? 'is-done' : ''} ${m.late ? 'is-late' : ''}" data-act="${m.act}" data-id="${esc(m.id)}">
    <span class="cb-check">${ico('check')}</span>
    <span class="cb-tile${m.tone ? ' cb-tile--' + m.tone : ''}">${ico(m.ico)}</span>
    <span class="cb-routine__body"><span class="cb-routine__title">${esc(m.t)}</span>${m.sub ? `<span class="cb-routine__sub">${esc(m.sub)}</span>` : ''}</span>
    <span class="cb-routine__time">${ico('star', 'cb-ico--sm')}+${m.xp}</span></button>`;
}
function habitMission(h) {
  const act = { check: 'habit', physical: 'physical', timer: 'timer-habit', salmo: 'salmo' }[h.kind];
  const r = rec(todayStr());
  let sub = '';
  if (h.id === 'redes') sub = `Límite: ${S.settings.redes} min`;
  if (h.id === 'sleep') sub = `Hora de dormir: ${S.settings.bedtime}`;
  if (h.id === 'med') sub = 'Con cronómetro y guía';
  return { id: h.id, t: h.t, sub, xp: h.xp, ico: h.ico, tone: h.tone, done: !!r.habits[h.id], act };
}
function taskMission(t, late) {
  const xp = 20 + Math.round((t.mins || 0) / 5);
  return { id: t.id, t: t.title, sub: `${t.mins || 0} min${late ? ' · atrasada (' + DAYS[t.day] + ')' : ''}`, xp, ico: t.block === 'pm' ? 'star' : 'check', tone: t.block === 'pm' ? 'sand' : 'mint', done: !!t.done, act: 'task', late };
}

/* ---------- vistas ---------- */
function weekStrip() {
  const mon = mondayOf(new Date()), sel = selDay === null ? todayIdx() : selDay;
  return `<div class="cb-week">${DAYS.map((n, i) => {
    const d = addDays(mon, i), ds = fmt(d);
    return `<button class="cb-week__day${i === sel ? ' is-today' : ''}${counted(ds) ? ' is-done' : ''}" data-act="selday" data-id="${i}" aria-label="${DAYS_FULL[i]} ${d.getDate()}"><span>${n}</span><span class="cb-week__dot">${d.getDate()}</span></button>`;
  }).join('')}</div>`;
}
function dayInfo() {
  if (selDay === null || selDay === todayIdx()) return '';
  const d = addDays(mondayOf(new Date()), selDay), r = S.days[fmt(d)] || { habits: {}, tasksDone: 0, xp: 0 };
  const n = Object.keys(r.habits).length + (r.tasksDone || 0);
  return `<div class="card dayinfo"><b>${DAYS_FULL[selDay]} ${d.getDate()}</b><p class="mut">${n ? `${n} acciones cumplidas · ${r.xp || 0} XP` : 'Sin acciones registradas.'}</p></div>`;
}
function header() {
  const st = streakInfo(), lv = levelInfo(), sl = SLOT[daySlot()];
  return `<div class="hd"><div class="grow"><p>${sl[0]}</p><h1>Esteban</h1></div>
    <div class="acts"><span class="pill flame" title="Racha">${ico('flame', 'cb-ico--sm')}${st.n}</span><span class="pill" title="XP">${ico('star', 'cb-ico--sm')}${S.xp}</span>
    <button class="avatar" data-act="goto" data-id="mas" aria-label="Ajustes">E</button></div></div>
    <div class="lvl"><div class="row sb"><b>Nivel ${lv.lvl} · ${esc(lv.name)}</b><small>faltan ${lv.left} XP</small></div><div class="bar"><i style="width:${lv.pct}%"></i></div></div>`;
}
function bannerHtml() {
  const k = daySlot(), sl = SLOT[k];
  return `<div class="cb-banner cb-banner--${k}"><div class="cb-banner__text"><h3 class="cb-banner__title">${sl[1]}</h3><p class="cb-banner__sub">${sl[2]}</p></div><div class="cb-banner__art">${art(k)}</div></div>`;
}
function moodHtml(r) {
  return `<p class="cap">¿Cómo vienes hoy?</p><div class="cb-moods" role="radiogroup" aria-label="Estado de ánimo" style="justify-content:space-between">${MOODS.map(m => `<button class="cb-mood${r.mood === m.n ? ' is-on' : ''}" role="radio" aria-checked="${r.mood === m.n}" data-act="mood" data-id="${m.n}"><span class="cb-face${MOOD_FACE[m.k]}"></span>${m.t}</button>`).join('')}</div>`;
}
function viewHoy() {
  const ds = todayStr(), r = rec(ds), cm = coachMsg();
  const dato = C.datos[dayNum() % C.datos.length];
  const p = planCurrent();
  const tasks = p ? p.tasks.filter(t => t.day === todayIdx()) : [];
  const am = tasks.filter(t => t.block !== 'pm'), pm = tasks.filter(t => t.block === 'pm');
  const slot = s => C.habits.filter(h => h.slot === s).map(habitMission).map(missionRow).join('');
  const notes = r.notes || {};
  let h = header() + weekStrip() + dayInfo() + bannerHtml();
  h += moodHtml(r);
  h += `<div class="coachcard coachcard--${cm.mode}"><span class="who">Coach · ${cm.label}</span><p>${esc(cm.msg)}</p></div>`;
  if (!S.settings.notif) h += `<div class="cb-reminder" style="margin:var(--space-4) 0"><div><h3 class="cb-reminder__title">Activa tus recordatorios</h3><p class="cb-reminder__text">Que no se te pase la rutina de la mañana ni el bloque de Iguana.</p><button class="cb-btn cb-btn--brown cb-btn--sm" data-act="notif">Activar ahora</button></div>${BELL}</div>`;
  if (!p) h += `<div class="card"><b>Aún no tienes plan esta semana</b><p class="mut">Tarda 15 minutos y define tus tareas.</p><button class="cb-btn" data-act="wiz">Planificar mi semana</button></div>`;
  h += `<div class="card"><div class="row" style="gap:8px"><b>${ico('chat', 'cb-ico--sm')} Para conversar hoy</b></div><p>${esc(dato.t)}</p><p><i>«${esc(dato.q)}»</i></p></div>`;
  h += `<div class="sec-h"><h2>Diario rápido</h2></div><div class="cb-jrow">${JOURNAL.map((j, i) => `<button class="cb-jcard${j.tone}" data-act="jr" data-id="${i}"><span><span class="cb-jcard__title">${j.t}</span><span class="cb-jcard__text">${notes[j.id] ? esc(notes[j.id]).slice(0, 60) : j.q}</span></span><span class="cb-jcard__foot">${notes[j.id] ? 'Guardado' : 'Hoy'}<span class="cb-tag">${j.tag}</span></span></button>`).join('')}</div>`;
  const od = lateToday();
  if (od.length) h += `<div class="sec-h"><h2>${ico('clock')} Atrasadas</h2></div>` + od.map(t => missionRow(taskMission(t, true))).join('');
  h += `<div class="sec-h"><h2>${ico('sun')} Mañana</h2><small>antes de las 7:30</small></div>` + slot('manana') + am.map(t => missionRow(taskMission(t))).join('');
  h += `<div class="sec-h"><h2>${ico('trail')} Tarde</h2></div>` + slot('tarde');
  h += `<div class="sec-h"><h2>${ico('moon')} Noche · Iguana</h2><small>20:00–22:00</small></div>` + (pm.length ? pm.map(t => missionRow(taskMission(t))).join('') : `<p class="mut">No hay tareas de noche hoy. Añádelas con el botón + o en la pestaña Semana.</p>`);
  h += `<div class="sec-h"><h2>${ico('bed')} Cierre</h2></div>` + slot('cierre');
  return h;
}
function viewSemana() {
  if (wiz) return viewWizard();
  const p = planCurrent();
  let h = `<h1>Semana</h1>`;
  const ahead = S.plan && S.plan.weekStart > thisMon();
  h += `<div class="card"><button class="cb-btn" data-act="wiz">${todayIdx() === 6 ? 'Planificar la próxima semana' : p ? 'Replanificar la semana' : 'Planificar mi semana'}</button><p class="mut">${ahead ? 'Ya tienes listo el plan de la próxima semana.' : 'Hazlo los domingos (15 min).'}</p></div>`;
  if (!p) return h;
  h += `<div class="card"><b>Prioridades</b>${p.priorities.filter(Boolean).map((x, i) => `<p>${i + 1}. ${esc(x)}</p>`).join('') || '<p class="mut">Sin prioridades.</p>'}</div>`;
  h += `<div class="card">`;
  for (let d = 0; d < 7; d++) {
    const ts = p.tasks.filter(t => t.day === d);
    const night = ts.filter(t => t.block === 'pm').reduce((a, t) => a + (t.mins || 0), 0);
    h += `<div class="day"><h3><span>${DAYS_FULL[d]}${d === todayIdx() ? ' · hoy' : ''}</span><small class="${night > NIGHT_LIMIT ? 'warn' : ''}">${night} min noche</small></h3>`;
    h += ts.map(t => `<div class="task ${t.done ? 'done' : ''}"><span class="t">${esc(t.title)}<br><span class="m">${t.block === 'pm' ? 'Noche' : 'Día'} · ${t.mins} min</span></span>${d < 6 ? `<button class="x" data-act="mv" data-id="${t.id}" title="Mover a mañana">↪</button>` : ''}<button class="x" data-act="rm" data-id="${t.id}" title="Borrar">✕</button></div>`).join('') || '<small class="mut">Libre</small>';
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
    <button class="cb-btn cb-btn--secondary" style="margin-top:12px" data-act="addtask" data-id="${pfx}">Añadir</button>
    <div style="margin-top:6px">${C.plantillas.map((t, i) => `<button class="cb-chip cb-chip--tpl" data-act="tpl" data-id="${pfx}:${i}">${esc(t.t)}</button>`).join('')}</div></div>`;
}
function stageInfo() {
  const E = C.etapas;
  let idx = 0;
  E.forEach((e, i) => { if (S.xp >= e.xp) idx = i; });
  const next = E[idx + 1];
  return { E, idx, next, frac: next ? (S.xp - E[idx].xp) / (next.xp - E[idx].xp) : 1 };
}
function monteBlock() {
  const { E, idx, next, frac } = stageInfo();
  const pts = [[16, 150], [60, 130], [100, 108], [140, 80], [168, 34], [206, 100], [244, 70], [290, 28]];
  const a = pts[idx], b = pts[Math.min(idx + 1, pts.length - 1)];
  const mx = a[0] + (b[0] - a[0]) * frac, my = a[1] + (b[1] - a[1]) * frac;
  const svg = `<svg class="map" viewBox="0 0 320 170" role="img" aria-label="Mapa de la montaña: ${esc(E[idx].n)}">
    <polygon points="0,170 40,120 100,90 168,24 230,110 260,80 292,22 320,70 320,170" fill="var(--brown)"/>
    <polygon points="168,24 150,60 170,52 186,64" fill="var(--on-night)"/><polygon points="292,22 278,48 292,42 304,52" fill="var(--on-night)"/>
    <polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--on-night)" stroke-width="3" stroke-dasharray="6 5"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${i <= idx ? 'var(--sun)' : 'var(--surface-raised)'}" stroke="var(--ink)" stroke-width="2"/>`).join('')}
    <g class="cb-bob"><circle cx="${mx}" cy="${my - 12}" r="9" fill="var(--action)" stroke="var(--ink)" stroke-width="2"/><path d="M${mx - 4} ${my - 12}l3 3l5-6" fill="none" stroke="var(--on-action)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  let h = svg;
  h += `<div class="card"><b>${esc(E[idx].n)}</b> · ${E[idx].alt} m<br>${next ? `<small>Siguiente: ${esc(next.n)} — faltan ${next.xp - S.xp} XP</small><div class="bar" style="margin-top:8px"><i style="width:${Math.round(frac * 100)}%"></i></div>` : '<b>¡Llegaste a la cumbre del Cayambe!</b>'}</div>`;
  h += `<div class="card">${E.map((e, i) => `<div class="stage ${i <= idx ? 'on' : ''} ${i === idx ? 'cur' : ''}"><span class="d">${ico('check')}</span><div class="grow"><b>${esc(e.n)}</b><br><small>${e.alt} m · ${e.xp} XP</small></div></div>`).join('')}</div>`;
  h += `<p class="mut">Cada misión y hábito te suma XP. Mueve también tu marcador en la pizarra física.</p>`;
  return h;
}
function rangeDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(fmt(addDays(new Date(), -i))); return out; }
function viewProgreso() {
  const days = rangeDays(progRange), st = streakInfo(), { E, idx } = stageInfo();
  const pct = id => Math.round(100 * days.filter(d => S.days[d] && S.days[d].habits[id]).length / days.length);
  const habits = [['Sueño', 'sleep', 'brown'], ['Redes', 'redes', 'action'], ['Trote', 'trote', 'green'], ['Calma', 'med', 'pink']];
  const moodCount = { 1: 0, 2: 0, 3: 0, 4: 0 }; let moodTotal = 0;
  days.forEach(d => { const m = S.days[d] && S.days[d].mood; if (m) { moodCount[m]++; moodTotal++; } });
  const moods = [['Feliz', 4, 'sun'], ['Triste', 1, 'brown'], ['Calmado', 3, 'green'], ['Ansioso', 2, 'taupe']];
  const xp = days.reduce((a, d) => a + ((S.days[d] || {}).xp || 0), 0);
  const done = days.reduce((a, d) => { const r = S.days[d]; return a + (r ? Object.keys(r.habits).length + (r.tasksDone || 0) : 0); }, 0);
  const bars = (list, solid) => `<div class="cb-caps${solid ? ' cb-caps--solid' : ''}">${list.map(b => `<div class="cb-cap"><div class="cb-cap__track"><div class="cb-cap__fill" style="--v:0;--c:var(--${b[2]});--on-c:var(--on-${b[2]})" data-v="${b[1]}">${b[1]}%</div></div><span class="cb-cap__label">${b[0]}</span></div>`).join('')}</div>`;
  const best = habits.map(h => [h[0], pct(h[1])]).sort((a, b) => b[1] - a[1])[0];
  let h = `<div class="hd"><h1>Tu progreso<br>e insights</h1></div>`;
  h += `<div class="row" style="margin-bottom:var(--space-4)"><button class="cb-chip ${progRange === 7 ? 'is-on' : ''}" data-act="range" data-id="7">Semana</button><button class="cb-chip ${progRange === 30 ? 'is-on' : ''}" data-act="range" data-id="30">Mes</button></div>`;
  h += `<p class="cap">Hábitos cumplidos (porcentaje de días)</p>` + bars(habits.map(x => [x[0], pct(x[1]), x[2]]));
  h += `<p class="cap" style="margin-top:var(--space-6)">Estados de ánimo</p>` + (moodTotal ? bars(moods.map(m => [m[0], Math.round(100 * moodCount[m[1]] / moodTotal), m[2]]), true) : `<p class="mut">Elige cómo vienes en la pantalla Hoy y aquí verás tus emociones.</p>`);
  h += `<div class="cb-points" style="margin-top:var(--space-6)"><div class="cb-points__head"><div><h3 class="cb-points__title">Puntos ganados</h3><p class="cb-points__sub">${progRange === 7 ? 'Esta semana' : 'Últimos 30 días'}</p></div><div class="cb-points__num">${xp} <small>XP</small></div></div>
    <div class="cb-points__cols"><div><small>Misiones</small><b>${done}</b></div><div><small>Altura</small><b>${E[idx].alt} m</b></div><div><small>Racha</small><b>${st.n} d</b></div></div>
    <button class="cb-btn" data-act="share">${ico('share')}Compartir progreso</button></div>`;
  if (best && best[1] > 0) h += `<div class="coachcard" style="margin-top:var(--space-4)"><span class="who">Lo que más funcionó</span><p>Tu hábito más constante fue «${best[0]}» (${best[1]}% de los días). Apóyate en él para sostener los demás.</p></div>`;
  h += `<div class="sec-h"><h2>Montaña</h2></div>` + monteBlock();
  return h;
}
function animateBars() {
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.cb-cap__fill[data-v]').forEach(f => f.style.setProperty('--v', f.dataset.v))));
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
  let h = `<h1>Iguana</h1>`;
  h += `<div class="card"><div class="row sb"><b>Meta del mes</b><b>US$${rev} / ${MONTHLY_GOAL}</b></div><div class="bar" style="margin-top:8px"><i style="width:${pct}%"></i></div></div>`;
  h += `<div class="stat"><div><b>${sumWeek('sent')}</b><small>mensajes</small></div><div><b>${sumWeek('replies')}</b><small>respuestas</small></div><div><b>${sumWeek('demos')}</b><small>demos</small></div></div>`;
  h += `<p class="mut">Esta semana. Hoy: ${r.sent} enviados, ${r.replies} respuestas, ${r.demos} demos.</p>`;
  h += `<button class="cb-btn" data-act="ig" data-id="sent">+1 mensaje enviado</button><div class="gap"></div>
    <button class="cb-btn cb-btn--secondary" data-act="ig" data-id="replies">+1 respuesta / conversación</button><div class="gap"></div>
    <button class="cb-btn cb-btn--secondary" data-act="ig" data-id="demos">+1 demo agendada</button><div class="gap"></div>
    <button class="cb-btn" data-act="ig" data-id="sales">¡Nueva venta!</button>`;
  h += `<h2>Mensajes por nicho</h2><p class="mut">Cambia [beneficio de Iguana] por lo que muestra tu demo. Toca para copiar.</p>`;
  h += C.nichos.map((n, i) => `<div class="card"><b>${esc(n.n)}</b><p>${esc(n.msg)}</p><button class="cb-btn cb-btn--secondary cb-btn--sm" data-act="copy" data-id="${i}">Copiar</button></div>`).join('');
  return h;
}
function viewMas() {
  const s = S.settings;
  return `<div class="hd"><h1>Ajustes</h1></div>
  <div class="card"><b>Notificaciones</b><p class="mut">La app puede avisarte mientras está abierta. Para alarmas aunque esté cerrada, descarga el calendario (.ics) y ábrelo en tu celular.</p>
    <button class="cb-btn" data-act="notif">${s.notif ? 'Notificaciones activadas' : 'Activar notificaciones'}</button><div class="gap"></div>
    <button class="cb-btn cb-btn--secondary" data-act="ics">Descargar alarmas (.ics)</button></div>
  <div class="card"><b>Tus límites</b>
    <label>Hora de dormir</label><input type="time" id="set-bed" value="${esc(s.bedtime)}">
    <label>Límite de redes al día (min)</label><input type="number" id="set-redes" value="${s.redes}" min="0" step="5"></div>
  <div class="card"><b>Pizarra física</b><p class="mut">Imprime la hoja con tu plan de la semana, tu racha y tu montaña.</p><a href="pizarra.html" target="_blank" rel="noopener">Abrir pizarra para imprimir</a></div>
  <div class="card"><b>Respaldo</b><p class="mut">Guarda tu plan y progreso o llévalos a otro dispositivo.</p>
    <button class="cb-btn cb-btn--secondary" data-act="export">Exportar datos</button><div class="gap"></div>
    <label class="cb-btn cb-btn--secondary" style="cursor:pointer">Importar datos<input type="file" id="imp" accept="application/json" hidden></label></div>
  <div class="card"><b>Reiniciar</b><button class="cb-btn cb-btn--danger" data-act="reset">Borrar todo</button></div>`;
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
    h += `<h2>3. Tareas de la semana</h2><button class="cb-btn cb-btn--secondary" data-act="suggest">Sugerir semana de Iguana</button>`;
    for (let i = 0; i < 7; i++) {
      const ts = d.tasks.filter(t => t.day === i);
      const night = ts.filter(t => t.block === 'pm').reduce((a, t) => a + (t.mins || 0), 0);
      h += `<div class="day"><h3><span>${DAYS_FULL[i]}</span><small class="${night > NIGHT_LIMIT ? 'warn' : ''}">${night}/${NIGHT_LIMIT} min noche</small></h3>` +
        ts.map(t => `<div class="task"><span class="t">${esc(t.title)} <span class="m">${t.block === 'pm' ? 'Noche' : 'Día'} · ${t.mins} min</span></span><button class="x" data-act="wrm" data-id="${t.id}">✕</button></div>`).join('') +
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
  h += `<div class="row" style="margin-top:16px">${w.step > 1 ? '<button class="cb-btn cb-btn--secondary" data-act="wback">Atrás</button>' : '<button class="cb-btn cb-btn--secondary" data-act="wcancel">Cancelar</button>'}<button class="cb-btn" data-act="${w.step === 5 ? 'wsave' : 'wnext'}">${w.step === 5 ? 'Guardar plan' : 'Siguiente'}</button></div>`;
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
  save(); toast('Plan guardado'); render();
}

/* ---------- salmo, cronómetro ---------- */
function openTimer({ title, secs, steps, why, onDone }) {
  let left = secs, run = false;
  const draw = () => { const el = $('#clk'); if (el) el.textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`; };
  openSheet(`<h1>${esc(title)}</h1>${why ? `<p class="mut">${esc(why)}</p>` : ''}${steps ? `<ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    <div class="clock" id="clk"></div>
    <button class="cb-btn" id="tstart">Iniciar</button><div class="gap"></div>
    <button class="cb-btn cb-btn--secondary" id="tdone">Listo</button><div class="gap"></div>
    <button class="cb-btn cb-btn--secondary" id="tclose">Cerrar</button>`);
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
  if (fmtId === 0) body = `<p>${esc(s.q)}</p><textarea id="sn" rows="3" placeholder="Tu respuesta (opcional)"></textarea><button class="cb-btn" id="sdone" style="margin-top:12px">Lo leí y reflexioné</button>`;
  else if (fmtId === 1) body = `<p><b>${esc(s.quiz.q)}</b></p>${s.quiz.o.map((o, i) => `<button class="opt" data-q="${i}">${esc(o)}</button>`).join('')}<div id="qres"></div>`;
  else body = `<div class="card"><b>Idea para recordar</b><p>${esc(s.idea)}</p></div><p><b>¿Cómo la aplicas hoy?</b></p>${s.apply.map((a, i) => `<button class="opt" data-a="${i}">${esc(a)}</button>`).join('')}`;
  openSheet(`<h1>${esc(s.ref)}</h1><p><a href="${link}" target="_blank" rel="noopener">Léelo completo en tu Biblia ↗</a></p>${body}<button class="cb-btn cb-btn--secondary" id="sclose" style="margin-top:12px">Cerrar</button>`);
  $('#sclose').onclick = closeSheet;
  const finish = bonus => { closeSheet(); setHabit('salmo', true); if (bonus) addXP(bonus); save(); render(); };
  if (fmtId === 0) $('#sdone').onclick = () => finish(0);
  document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
    const ok = +b.dataset.q === s.quiz.a;
    b.classList.add(ok ? 'ok' : 'no');
    $('#qres').innerHTML = ok ? '<p><b>¡Correcto! +5 XP</b></p><button class="cb-btn" id="qn">Continuar</button>' : '<p>Casi. Intenta otra opción.</p>';
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
  const v = { hoy: viewHoy, semana: viewSemana, progreso: viewProgreso, iguana: viewIguana, mas: viewMas }[tab];
  $('#app').innerHTML = v();
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
  animateBars();
}
document.addEventListener('click', e => {
  const tb = e.target.closest('#tabs [data-tab]');
  if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  switch (act) {
    case 'habit': setHabit(id, !rec(todayStr()).habits[id]); break;
    case 'physical': {
      const h = habitById(id);
      if (rec(todayStr()).habits[id]) setHabit(id, false);
      else openSheet(`<h1>Misión física</h1><p>${esc(h.t)}</p><p class="mut">Hazlo en tu pizarra y confirma cuando termines.</p><button class="cb-btn" id="pc">Ya lo hice</button><div class="gap"></div><button class="cb-btn cb-btn--secondary" id="px">Cerrar</button>`);
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
    case 'mood': rec(todayStr()).mood = +id; save(); render(); if (navigator.vibrate) navigator.vibrate(12); break;
    case 'selday': selDay = +id === todayIdx() ? null : +id; render(); break;
    case 'goto': tab = id; render(); window.scrollTo(0, 0); break;
    case 'range': progRange = +id; render(); break;
    case 'share': {
      const { E, idx } = stageInfo(), st = streakInfo();
      const text = `Mi progreso en Cumbre: ${S.xp} XP, racha de ${st.n} días y voy en «${E[idx].n}» (${E[idx].alt} m).`;
      if (navigator.share) navigator.share({ title: 'Cumbre', text }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copiado'));
      break;
    }
    case 'jr': {
      const j = JOURNAL[+id], r = rec(todayStr());
      openSheet(`<h1>${j.t}</h1><p class="mut">${j.q}</p><textarea id="jn" rows="4" placeholder="Escribe aquí">${esc((r.notes || {})[j.id] || '')}</textarea><button class="cb-btn" id="jsave">Guardar</button><button class="cb-btn cb-btn--secondary" id="jclose">Cerrar</button>`);
      $('#jclose').onclick = closeSheet;
      $('#jsave').onclick = () => {
        const v = $('#jn').value.trim(); if (!v) { toast('Escribe algo primero'); return; }
        r.notes = r.notes || {};
        const first = !r.notes[j.id]; r.notes[j.id] = v; closeSheet();
        if (first) addXP(5); save(); render();
      };
      break;
    }
    case 'fab':
      if (!planCurrent()) { toast('Primero planifica tu semana'); tab = 'semana'; render(); break; }
      openSheet(`<h1>Añadir tarea</h1>${addTaskForm('fab').replace('class="card"', 'class="stack"')}<button class="cb-btn cb-btn--secondary" id="fclose">Cerrar</button>`);
      $('#fclose').onclick = closeSheet;
      break;
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
      else { if (!planCurrent()) { toast('Primero crea tu plan semanal'); break; } planCurrent().tasks.push(t); save(); if (id === 'fab') { closeSheet(); toast('Tarea añadida'); } }
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
