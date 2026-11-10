'use strict';
/* Cumbre — coach interactivo. Todo se guarda en el dispositivo (localStorage). */
const KEY = 'coach.v1';
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAYS_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MOODS = [{ k: 'sad', n: 1, t: 'Triste' }, { k: 'anxious', n: 2, t: 'Ansioso' }, { k: 'calm', n: 3, t: 'Calmado' }, { k: 'happy', n: 4, t: 'Feliz' }];
const MOOD_FACE = { happy: '', calm: ' cb-face--calm', sad: ' cb-face--sad', anxious: ' cb-face--anxious' };
const MOOD_MSG = { 4: ['celebrate', 'Celebrando', 'Aprovecha esa energía: arranca por la tarea más difícil de tu día.'], 3: ['socratic', 'Pregunta', '¿Qué es lo que más te acerca a tu primera venta esta semana?'], 2: ['empathic', 'Contigo', 'Respira 4-7-8 durante tres minutos y luego decidimos.'], 1: ['empathic', 'Contigo', 'Hay días pesados y está bien. Hoy basta con una misión pequeña.'] };
const JOURNAL = [
  { id: 'grat', t: 'Pausa y reflexiona', q: '¿Por qué estás agradecido hoy?', tag: 'Personal', tone: '' },
  { id: 'int', t: 'Define tu intención', q: '¿Cómo quieres sentirte esta noche?', tag: 'Noche', tone: ' cb-jcard--lilac' },
  { id: 'desc', t: 'Descarga mental', q: 'Saca lo que te preocupa antes de dormir.', tag: 'Calma', tone: ' cb-jcard--sand' }
];
const ico = (n, c = '') => `<i class="cb-ico ${c} cb-ico-${n}"></i>`;

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
let S = fresh();        // estado (se carga al iniciar)
let tab = 'hoy';
let showAll = false;    // en modo mínimo, ver todo el día
let goalArea = 'all';   // filtro de la pantalla Metas
let progRange = 7;      // rango de Progreso: 7 o 30 días
let timerRef = null;

function fresh() {
  return { v: 1, xp: 0, days: {}, plan: null, history: {}, settings: { bedtime: '23:00', redes: 45, notif: false }, meta: {}, learned: null, claude: null, goals: {}, reminders: {} };
}
function load() { return Store.loadLocal(fresh); }
function save() {
  if (C) { try { S.learned = Learn.compute(S, C); } catch (e) { /* sin modelo */ } }
  Store.persist(S);
}
const hourNow = () => { const n = new Date(); return +(n.getHours() + n.getMinutes() / 60).toFixed(2); };
// Fusiona un documento que llega de la base de datos (gana el más reciente).
function applyRemote(col, key, o) {
  const newer = (a, b) => (a.u || 0) > ((b && b.u) || 0);
  // Un documento vacío que llega «más nuevo» (p. ej. de una prueba) nunca borra lo que ya anotaste aquí: se conserva lo tuyo y se vuelve a subir.
  const blankDay = d => !d || (!Object.keys(d.habits || {}).length && !(d.moods || []).length && !d.mood && !(d.xp || 0) && !Object.keys(d.notes || {}).length && !(d.tasksDone || 0));
  const keepLocal = () => { setTimeout(save, 0); return false; };
  if (col === 'days') {
    if (S.days[key] && newer(o, S.days[key]) && blankDay(o) && !blankDay(S.days[key])) { S.days[key].u = Date.now(); return keepLocal(); }
    if (!S.days[key] || newer(o, S.days[key])) { S.days[key] = o; return true; } return false;
  }
  if (col === 'plans') {
    if (!S.plan || key > S.plan.weekStart) { if (S.plan) S.history[S.plan.weekStart] = S.plan; S.plan = o; delete S.history[key]; return true; }
    const blankPlan = pl => !pl || !(pl.tasks || []).length;
    if (S.plan.weekStart === key) { if (newer(o, S.plan)) { if (blankPlan(o) && !blankPlan(S.plan)) { S.plan.u = Date.now(); return keepLocal(); } S.plan = o; return true; } return false; }
    if (!S.history[key] || newer(o, S.history[key])) { if (S.history[key] && blankPlan(o) && !blankPlan(S.history[key])) { S.history[key].u = Date.now(); return keepLocal(); } S.history[key] = o; return true; }
    return false;
  }
  if (col === 'meta') { if (newer(o, S.meta)) { S.xp = o.xp || 0; S.settings = Object.assign(S.settings, o.settings || {}); S.meta = o; return true; } return false; }
  if (col === 'goals' || col === 'reminders') {
    const bag = S[col] || (S[col] = {});
    if (!bag[key] || newer(o, bag[key])) { bag[key] = o; return true; }
    return false;
  }
  if (col === 'insights') {
    if (key === 'claude' && newer(o, S.claude)) { S.claude = o; return true; }
    if (key === 'learned' && !S.learned) { S.learned = o; return true; }
  }
  return false;
}
/* ---------- metas y recordatorios ---------- */
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const areaOf = id => C.areas.find(a => a.id === id) || { id, t: id || 'Otra', tone: 'peach' };
const liveGoals = () => Object.values(S.goals || {}).filter(g => g && !g.deleted).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || String(a.title).localeCompare(String(b.title)));
const daysTo = ds => Math.round((parse(ds) - parse(todayStr())) / 864e5);
function goalPct(g) {
  if (g.done) return 100;
  const m = g.milestones || [];
  if (m.length) return Math.round(100 * m.filter(x => x.done).length / m.length);
  if (g.target && +g.target.value > 0) return Math.max(0, Math.min(100, Math.round(100 * (+g.target.current || 0) / +g.target.value)));
  return 0;
}
const hitosHechos = () => liveGoals().reduce((a, g) => a + (g.milestones || []).filter(m => m.done).length, 0);
function putGoal(g) { S.goals[g.id] = g; save(); }
function removeGoal(id) { S.goals[id] = { id, deleted: true }; save(); }      // lápida: el borrado se sincroniza
function putReminder(r) { S.reminders[r.id] = r; save(); }
function removeReminder(id) { S.reminders[id] = { id, deleted: true }; save(); }
/* Recordatorios propios + hitos con fecha + fechas límite de objetivos que vencen pronto. */
function remindersList() {
  const out = [];
  Object.values(S.reminders || {}).filter(r => r && !r.deleted).forEach(r => out.push({ src: 'r', id: r.id, title: r.title, date: r.date, time: r.time || '', important: !!r.important, done: !!r.done, note: r.note || '' }));
  liveGoals().forEach(g => {
    (g.milestones || []).forEach(m => { if (m.due) out.push({ src: 'h', id: g.id + ':' + m.id, gid: g.id, title: m.t, date: m.due, time: '', important: true, done: !!m.done, note: g.title }); });
    if (g.due && goalPct(g) < 100 && daysTo(g.due) <= 30) out.push({ src: 'g', id: g.id + ':due', gid: g.id, title: 'Fecha límite: ' + g.title, date: g.due, time: '', important: true, done: false, note: '' });
  });
  const seen = {};
  [S.plan, planCurrent()].filter(Boolean).forEach(pl => {
    if (seen[pl.weekStart]) return; seen[pl.weekStart] = 1;
    (pl.tasks || []).forEach(t => out.push({ src: 't', id: 'T~' + t.id, title: t.title, date: fmt(addDays(parse(pl.weekStart), t.day)), time: '', sk: t.block === 'pm' ? '20:00' : '07:00', blk: t.block === 'pm' ? 'Noche' : 'Mañana', important: false, done: !!t.done, note: '' }));
  });
  return out.filter(r => r.date).sort((a, b) => (a.date + (a.time || a.sk || '24')).localeCompare(b.date + (b.time || b.sk || '24')));
}
function nextReminder() {
  const open = remindersList().filter(r => !r.done && daysTo(r.date) <= 60);
  return open.find(r => daysTo(r.date) < 0) || open[0] || null;      // primero lo atrasado, luego lo más próximo
}
function whenText(r) {
  const d = daysTo(r.date), t = r.time ? ' · ' + r.time : (r.blk ? ' · ' + r.blk : '');
  if (d < 0) return `Atrasado · hace ${-d} ${-d === 1 ? 'día' : 'días'}`;
  if (d === 0) return 'Hoy' + t;
  if (d === 1) return 'Mañana' + t;
  return `En ${d} días` + t;
}
function bestStreak() {
  const days = Object.keys(S.days).filter(counted).sort();
  let best = 0, run = 0, prev = null;
  days.forEach(k => { run = prev && Math.round((parse(k) - parse(prev)) / 864e5) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = k; });
  return best;
}

// Une dos versiones del mismo día (lo hecho en este dispositivo y lo anotado desde un push): nada de lo hecho se pierde.
function mergeDay(a, b) {
  const out = Object.assign({}, b, a);
  out.habits = Object.assign({}, b.habits, a.habits);
  out.times = Object.assign({}, b.times, a.times);
  out.acts = Object.assign({}, b.acts); Object.keys(a.acts || {}).forEach(k => { const x = a.acts[k], y = out.acts[k]; if (!y || y.st !== 'done') out.acts[k] = x; });
  const missed = Object.assign({}, b.missed, a.missed); Object.keys(missed).forEach(k => { if (out.habits[k]) delete missed[k]; });
  if (Object.keys(missed).length) out.missed = missed; else delete out.missed;
  ['tasksDone', 'xp', 'sent', 'replies', 'demos', 'sales', 'revenue'].forEach(k => { out[k] = Math.max(a[k] || 0, b[k] || 0); });
  out.mood = (a.moodAt || 0) >= (b.moodAt || 0) && a.mood ? a.mood : (b.mood || a.mood || 0);
  out.u = Math.max(a.u || 0, b.u || 0);
  return out;
}
function onConflict(path, cur) {
  const [col, key] = [path.split('/')[0], path.split('/').slice(1).join('/')];
  if (col === 'days') { S.days[key] = S.days[key] ? mergeDay(S.days[key], cur) : cur; return true; }
  return applyRemote(col, key, cur);
}
function rec(ds) {
  if (!S.days[ds]) S.days[ds] = { habits: {}, acts: {}, tasksDone: 0, mood: 0, sent: 0, replies: 0, demos: 0, sales: 0, revenue: 0 };
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

/* ---------- coach (modos) ---------- */
function coachMsg() {
  const r = rec(todayStr());
  const st = streakInfo();
  const late = overdue().length;
  let mode;
  if (r.mood && r.mood <= 2) mode = 'empathic';
  else if (late > 0 || (st.n === 0 && Object.keys(S.days).filter(counted).length > 0)) mode = 'direct';
  else if (counted(todayStr()) && st.n >= 3) mode = 'celebrate';
  else if (S.settings.tonePref && S.settings.tonePref !== 'auto') mode = S.settings.tonePref;
  else mode = (S.learned && S.learned.tone && S.learned.tone.best && S.learned.tone.best !== 'empathic') ? S.learned.tone.best : (S.claude && S.claude.tone && ['direct', 'socratic'].includes(S.claude.tone) ? S.claude.tone : 'socratic');
  const list = C.coach[mode];
  let msg = list[dayNum() % list.length].replace('{streak}', st.n).replace('{xp}', S.xp);
  if (mode === 'direct' && late) msg += ` Tienes ${late} tarea${late > 1 ? 's' : ''} atrasada${late > 1 ? 's' : ''}.`;
  const label = { direct: 'Directo', empathic: 'Contigo', socratic: 'Pregunta', celebrate: 'Celebrando' }[mode];
  if (!r.coach) r.coach = mode;   // se guarda con el siguiente cambio; sirve para aprender qué tono te funciona
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
  night: ['Buenas noches', 'Tu noche', 'Celular lejos de las redes.'],
  summit: ['Cierra el día', 'Cierra el día', 'Marca tu racha y mueve tu marcador en la montaña.']
};

/* ---------- misiones de hoy ---------- */
function habitById(id) { return C.habits.find(h => h.id === id); }
function setHabit(id, on) {
  const r = rec(todayStr()), h = habitById(id);
  if (on && !r.habits[id]) { r.habits[id] = true; (r.times = r.times || {})[id] = hourNow(); addXP(h.xp); }
  else if (!on && r.habits[id]) { delete r.habits[id]; if (r.times) delete r.times[id]; addXP(-h.xp); }
  save(); render();
}
function setTask(id, on) {
  const p = planCurrent(); const t = p && p.tasks.find(x => x.id === id); if (!t) return;
  const r = rec(todayStr());
  const xp = 20 + Math.round((t.mins || 0) / 5);
  if (on && !t.done) { t.done = todayStr(); r.tasksDone = (r.tasksDone || 0) + 1; (r.times = r.times || {})[id] = hourNow(); addXP(xp); }
  else if (!on && t.done) { const dr = rec(t.done); dr.tasksDone = Math.max(0, (dr.tasksDone || 0) - 1); t.done = null; addXP(-xp); }
  save(); render();
}
function missionRow(m) {
  return `<button class="cb-routine ${m.done ? 'is-done' : ''} ${m.late ? 'is-late' : ''}" data-act="${m.act}" data-id="${esc(m.id)}">
    <span class="cb-check">${ico('check')}</span>
    <span class="cb-tile${m.tone ? ' cb-tile--' + m.tone : ''}">${ico(m.ico)}</span>
    <span class="cb-routine__body"><span class="cb-routine__title">${esc(m.t)}</span>${m.sub ? `<span class="cb-routine__sub">${esc(m.sub)}</span>` : ''}</span>
    <span class="cb-routine__time">+${m.xp} XP</span></button>`;
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
  return { id: t.id, t: t.title, sub: `${t.mins || 0} min${late ? ' · atrasada (' + DAYS[t.day] + ')' : ''}`, xp, ico: t.block === 'pm' ? 'briefcase' : 'check', tone: t.block === 'pm' ? 'sand' : 'mint', done: !!t.done, act: 'task', late };
}

/* ---------- aviso del coach (20 segundos) ---------- */
const NOTICE_MS = 20000, NOTICE_KEY = 'coach.notice';
let noticeTimer = null;
function moodNotice(n) {
  const cm = coachMsg(), m = MOOD_MSG[n];
  const useCoach = n >= 3 && (cm.mode === 'direct' || cm.mode === 'celebrate');
  const mode = useCoach ? cm.mode : m[0], label = useCoach ? cm.label : m[1], text = useCoach ? cm.msg : m[2];
  return { until: Date.now() + NOTICE_MS, mode, label, text, saved: Store.mode === 'db' || Store.mode === 'api' ? 'Ánimo guardado en la base de datos' : 'Ánimo guardado' };
}
function showNotice(n) {
  try { localStorage.setItem(NOTICE_KEY, JSON.stringify(n)); } catch (e) { /* ignorar */ }
  drawNotice();
}
function hideNotice() {
  try { localStorage.removeItem(NOTICE_KEY); } catch (e) { /* ignorar */ }
  clearInterval(noticeTimer); noticeTimer = null;
  const el = $('#notice'); if (el) { el.hidden = true; el.innerHTML = ''; }
}
function drawNotice() {
  const el = $('#notice'); if (!el) return;
  let n = null; try { n = JSON.parse(localStorage.getItem(NOTICE_KEY)); } catch (e) { n = null; }
  if (!n || n.until <= Date.now()) { hideNotice(); return; }
  el.hidden = false;
  el.innerHTML = `<div class="notice notice--${n.mode}" role="status"><div class="notice__top"><span class="notice__who">Coach · ${esc(n.label)}</span><span class="notice__clock" data-notice-clock></span><button class="notice__x" data-act="closenotice" aria-label="Cerrar aviso">${ico('close', 'cb-ico--sm')}</button></div><p>${esc(n.text)}</p><small>${esc(n.saved || '')}</small><div class="notice__bar"><i data-notice-bar></i></div></div>`;
  const tick = () => {
    const left = n.until - Date.now();
    if (left <= 0) { hideNotice(); return; }
    const s = Math.ceil(left / 1000), c = el.querySelector('[data-notice-clock]'), b = el.querySelector('[data-notice-bar]');
    if (c) c.textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`;
    if (b) b.style.width = (100 * left / NOTICE_MS).toFixed(1) + '%';
  };
  clearInterval(noticeTimer); tick(); noticeTimer = setInterval(tick, 1000);
}

/* ---------- reloj de cada bloque del día ---------- */
function tzNow() {
  const tz = (S.settings && S.settings.tz) || (C && C.tz) || undefined;
  let p;
  try { p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date()); } catch (e) { p = null; }
  if (!p) { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); }
  const g = t => +p.find(x => x.type === t).value;
  return g('hour') * 3600 + g('minute') * 60 + g('second');
}
const toSecs = hm => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60; };
const hms = s => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
function tickBlocks() {
  if (!C || document.hidden) return;
  tickBanner();
  const t = Date.now();
  if (t - (tickBlocks.last || 0) > 20000) {
    tickBlocks.last = t;
    // si cambió algo por la hora (llegó el ánimo de la noche, el chequeo de las 16:30…) se repinta Hoy sin que tengas que recargar
    const sig = hoySig();
    if (tab === 'hoy' && sig !== hoySig.last && $('#overlay').hidden && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) && !drag) render();
    maybeAutoCheck();
  }
}

/* ---------- vistas ---------- */
function header() {
  const st = streakInfo(), lv = levelInfo(), sl = SLOT[daySlot()];
  const name = (S.settings.name || 'Esteban').trim() || 'Esteban';
  const nivel = `Nivel ${lv.lvl}, ${lv.name}`, racha = `${st.n} ${st.n === 1 ? 'día' : 'días'} de racha`;
  return `<div class="hbar">
    <button class="hprofile" data-act="goto" data-id="mas" aria-label="Perfil y ajustes de ${esc(name)}"><span class="avatar" aria-hidden="true">${esc(name[0].toUpperCase())}</span><span class="hbar__who"><p>${sl[0]}</p><h1>${esc(name)}</h1></span></button>
    <div class="hbar__right">
      <button class="hbtn hbtn--flame" data-peek="racha" aria-label="${racha}. Toca para ver el detalle; mantén pulsado para un vistazo">${ico('flame')}<span class="hbadge">${st.n}</span></button>
      <button class="hbtn hbtn--level" data-peek="nivel" aria-label="${nivel}. Toca para ver el detalle; mantén pulsado para un vistazo">${ico('trail')}<span class="hbadge">${lv.lvl}</span></button>
    </div></div>`;
}
function reminderCard() {
  const r = nextReminder();
  if (!r) return `<button class="remind remind--empty" data-act="reminders"><span class="remind__date">${ico('calendar')}</span><span class="remind__body"><b class="remind__title">Agrega algo importante</b><span class="remind__when">Un recordatorio para hoy o para los próximos días</span></span></button>`;
  const d = parse(r.date);
  return `<div class="remind${daysTo(r.date) < 0 ? ' is-late' : ''}" data-act="reminders" role="button" tabindex="0" aria-label="Recordatorio: ${esc(r.title)}. ${whenText(r)}. Toca para ver todos">
    <span class="remind__date"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()]}</small></span>
    <span class="remind__body"><span class="remind__when">${whenText(r)}</span><b class="remind__title">${esc(r.title)}</b>${r.important ? '<span class="cb-tag">Importante</span>' : ''}</span>
    ${r.src !== 'g' ? `<button class="remind__check" data-act="rdone" data-id="${esc(r.id)}" aria-label="Marcar como hecho">${ico('check')}</button>` : ''}</div>`;
}
/* ---------- agenda del día: el banner sigue lo que te toca ahora ---------- */
let calEvents = [];
const agendaItems = () => Agenda.build({ content: C, settings: S.settings, plan: planCurrent(), wd: todayIdx(), cal: calEvents });
function actState(it) {
  const r = rec(todayStr()), a = (r.acts || {})[it.id];
  const t = it.taskId && planCurrent() && planCurrent().tasks.find(x => x.id === it.taskId);
  if ((it.habit && r.habits[it.habit]) || (t && t.done) || (a && a.st === 'done')) return 'done';
  if ((r.missed && r.missed[it.id]) || (a && a.st === 'missed')) return 'missed';
  if (a && a.st === 'on') return 'on';
  return 'idle';
}
function setAct(it, st) {
  const r = rec(todayStr()); r.acts = r.acts || {};
  if (st === 'done') {
    if (it.habit) setHabit(it.habit, true);
    else if (it.taskId) setTask(it.taskId, true);
    else if (actState(it) !== 'done') addXP(it.xp || 10);
    r.acts[it.id] = { st: 'done', at: hourNow() }; if (r.missed) delete r.missed[it.id];
  } else if (st === 'missed') {
    (r.missed = r.missed || {})[it.id] = true; r.acts[it.id] = { st: 'missed' };
  } else if (st === 'on') { r.acts[it.id] = { st: 'on', at: hourNow() }; if (r.missed) delete r.missed[it.id]; }
  save(); render();
}
const bannerSig = () => {
  const a = Agenda.at(agendaItems(), tzNow()), c = a.current, n = a.next;
  return [c && c.id, c && actState(c), !c && n && n.id, c && c.from, c && c.to, calEvents.map(e => e.title + e.from).join(',')].join('|');
};
function bannerHtml() {
  const now = tzNow(), items = agendaItems(), a = Agenda.at(items, now), it = a.current || a.next;
  const sig = bannerSig();
  if (!it) return `<div class="bn" data-bn-sig="${esc(sig)}"><div class="cb-banner cb-banner--closed"><div class="cb-banner__text"><p class="bn__kicker">Hoy</p><h3 class="cb-banner__title">Día cerrado</h3><p class="cb-banner__sub">No queda nada en tu agenda. Descansa y mañana seguimos.</p></div><div class="cb-banner__art">${Scenes.svg('closed')}</div></div></div>`;
  const cur = !!a.current, st = cur ? actState(it) : 'idle', hh = `${Agenda.hhmm(it.from)} – ${Agenda.hhmm(it.to)}`;
  const asks = it.ask && cur;
  const btn = (v, label, cls) => `<button class="cb-btn cb-btn--sm ${cls || ''}" data-act="actset" data-id="${esc(it.id)}" data-v="${v}">${label}</button>`;
  let acts = '';
  if (asks && st === 'idle') acts = btn('on', 'Estoy en ello', 'cb-btn--secondary') + btn('done', 'Cumplí') + btn('missed', 'No cumplí', 'cb-btn--ghost');
  else if (asks && st === 'on') acts = '<span class="bn__chip">En ello</span>' + btn('done', 'Cumplí') + btn('missed', 'No cumplí', 'cb-btn--ghost');
  else if (st === 'done') acts = '<span class="bn__chip bn__chip--ok">Cumplida · +' + (it.xp || 0) + ' XP</span>';
  else if (st === 'missed') acts = '<span class="bn__chip">No cumplida</span>' + btn('done', 'Sí la hice', 'cb-btn--secondary');
  else if (!cur && it.ask) acts = btn('on', 'Empezar ya', 'cb-btn--secondary');
  const k = it.scene || 'task';
  return `<div class="bn" data-bn-sig="${esc(sig)}"><div class="cb-banner cb-banner--${k}"><div class="cb-banner__text"><p class="bn__kicker">${cur ? 'Ahora' : 'Siguiente'} · ${hh}</p>
    <h3 class="cb-banner__title">${esc(it.t)}</h3>
    <p class="bn__timer" data-bn="left">${cur ? 'Quedan ' + hms(a.left) : 'Empieza en ' + hms(a.until)}</p>
    ${cur ? `<div class="bn__bar" aria-hidden="true"><i data-bn="bar" style="width:${a.pct}%"></i></div>` : ''}</div><div class="cb-banner__art">${Scenes.svg(k)}</div></div>
    ${acts ? `<div class="bn__acts">${acts}</div>` : ''}</div>`;
}
function tickBanner() {
  const el = document.querySelector('[data-bn-sig]'); if (!el) return;
  if (el.dataset.bnSig !== bannerSig()) { if (!$('#overlay').hidden) return; el.outerHTML = bannerHtml(); return; }
  const a = Agenda.at(agendaItems(), tzNow());
  const t = el.querySelector('[data-bn="left"]'), b = el.querySelector('[data-bn="bar"]');
  const txt = a.current ? 'Quedan ' + hms(a.left) : 'Empieza en ' + hms(a.until);
  if (t && t.textContent !== txt) t.textContent = txt;
  if (b) b.style.width = a.pct + '%';
}
/* Calendario (iCal de Google): la Worker lo lee y entrega los eventos de hoy. */
let calTimer = null;
async function loadCal() {
  if (Store.mode !== 'api') return;
  try {
    const r = await fetch('api/calendar?date=' + todayStr(), { headers: { Authorization: 'Bearer ' + Store.token() } });
    if (r.ok) { const j = await r.json(); calEvents = j.events || []; S.calConfigured = !!j.configured; tickBanner(); }
  } catch (e) { /* sin red */ }
  clearTimeout(calTimer); calTimer = setTimeout(loadCal, 10 * 60 * 1000);
}
/* El ánimo se pregunta dos veces al día (por la mañana desde las 7:30 y por la noche desde las 21:30); al responder se oculta hasta la siguiente. */
const hmNum = (hm, d) => { const [h, m] = String(hm || d).split(':').map(Number); return h + (m || 0) / 60; };
function moodDue(r) {
  const now = tzNow() / 3600, pmAt = hmNum(S.settings.moodPM, '21:30'), amAt = hmNum(S.settings.moodAM, '07:30'), ms = r.moods || [];
  const done = slot => ms.some(m => slot === 'pm' ? m.h >= pmAt : m.h < pmAt);
  if (now >= pmAt) return done('pm') ? null : 'pm';
  if (now >= amAt) return done('am') ? null : 'am';
  return null;
}
function moodHtml(r) {
  const slot = moodDue(r); if (!slot) return '';
  return `<div class="moodcard"><p class="cap">${slot === 'am' ? '¿Cómo amaneciste?' : '¿Cómo te fue hoy?'}</p><div class="cb-moods" role="radiogroup" aria-label="Estado de ánimo" style="justify-content:space-between">${MOODS.map(m => `<button class="cb-mood" role="radio" aria-checked="false" data-act="mood" data-id="${m.n}"><span class="cb-face${MOOD_FACE[m.k]}"></span>${m.t}</button>`).join('')}</div></div>`;
}
function leverHabit(r) {
  const l = Learn.lever(S.learned, C, r.habits);
  if (l) return { habit: l.habit, why: `Cuando ${Learn.label(l.habit.id)}, tu ánimo es bueno con más frecuencia (+${Math.round(l.lift * 100)} puntos).` };
  const f = S.claude && S.claude.focus && S.claude.focus.map(id => habitById(id)).find(h => h && !r.habits[h.id]);
  return f ? { habit: f, why: 'Claude la señaló como tu mejor punto de apoyo esta semana.' } : null;
}
function essentials(r, tasks) {
  const out = [], lev = leverHabit(r);
  if (lev) out.push(habitMission(lev.habit));
  const pend = tasks.filter(t => !t.done && t.block === 'pm')[0];
  if (pend) out.push(taskMission(pend));
  ['med', 'sleep', 'redes', 'salmo'].forEach(id => { if (out.length < 3 && habitById(id) && !out.some(m => m.id === id)) out.push(habitMission(habitById(id))); });
  return out.slice(0, 3);
}
/* ---------- tareas del día: filas, orden por arrastre, edición ---------- */
const PRIO = { high: ['Alta', '#E5484D'], mid: ['Media', '#FFB020'], low: ['Baja', '#2FBF8A'] };
const monOf = ds => fmt(mondayOf(parse(ds)));
const newPlan = mon => ({ weekStart: mon, priorities: ['', '', ''], tasks: [], team: [] });
function planFor(mon, create) {
  if (S.plan && S.plan.weekStart === mon) return S.plan;
  if (S.history[mon]) return S.history[mon];
  if (!create) return null;
  if (!S.plan) return (S.plan = newPlan(mon));
  if (S.plan.weekStart < mon) { S.history[S.plan.weekStart] = S.plan; return (S.plan = newPlan(mon)); }
  return (S.history[mon] = newPlan(mon));
}
const sortTasks = list => list.map((t, i) => [t, i]).sort((a, b) => (a[0].ord ?? 1e6 + a[1]) - (b[0].ord ?? 1e6 + b[1])).map(x => x[0]);
const dayTasks = (d, blk) => { const p = planCurrent(); return p ? sortTasks(p.tasks.filter(t => t.day === d && (!blk || (t.block === 'am' ? 'am' : 'pm') === blk))) : []; };
function addTask({ title, day, block, date }) {
  const mon = date ? monOf(date) : thisMon(), p = planFor(mon, true);
  const t = { id: uid(), title: title.trim(), day: date ? (parse(date).getDay() + 6) % 7 : day, block: block === 'am' ? 'am' : 'pm', mins: 30, done: null };
  t.ord = Math.max(0, ...p.tasks.filter(x => x.day === t.day).map(x => x.ord || 0)) + 1;
  p.tasks.push(t); save(); return t;
}
function findTask(id) { for (const p of [S.plan, ...Object.values(S.history)]) { const t = p && (p.tasks || []).find(x => x.id === id); if (t) return { t, p }; } return null; }
function removeTask(id) { const f = findTask(id); if (f) { f.p.tasks = f.p.tasks.filter(x => x.id !== id); save(); } }
/* Mueve una tarea a otra fecha (aunque sea de otra semana) y guarda su prioridad. */
function moveTask(id, date, prio) {
  const f = findTask(id); if (!f) return;
  const { t, p } = f; p.tasks = p.tasks.filter(x => x.id !== id);
  const q = planFor(monOf(date), true);
  t.day = (parse(date).getDay() + 6) % 7; t.prio = prio; t.done = null; t.ord = Math.max(0, ...q.tasks.filter(x => x.day === t.day).map(x => x.ord || 0)) + 1;
  q.tasks.push(t);
  const r = rec(todayStr()); (r.missed = r.missed || {})[id] = true;
  save();
}
function taskRow(t, opts = {}) {
  const prio = t.prio && PRIO[t.prio];
  const sub = [opts.showBlock ? (t.block === 'am' ? 'Mañana' : 'Noche') : '', opts.late ? 'Atrasada · ' + DAYS[t.day] : ''].filter(Boolean).join(' · ');
  return `<div class="trow${t.done ? ' is-done' : ''}${opts.late ? ' is-late' : ''}" data-tid="${esc(t.id)}">
    <button class="trow__grip" data-grip aria-label="Arrastrar ${esc(t.title)} para ordenar">${ico('dots', 'cb-ico--sm')}</button>
    <button class="trow__chk" data-act="task" data-id="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="${t.done ? 'Desmarcar' : 'Marcar como hecha'}: ${esc(t.title)}"><span class="cb-check">${ico('check')}</span></button>
    <span class="trow__b"><span class="trow__t">${esc(t.title)}</span>${sub || prio ? `<span class="trow__s">${prio ? `<i class="pdot" style="background:${prio[1]}"></i>${prio[0]}` : ''}${prio && sub ? ' · ' : ''}${esc(sub)}</span>` : ''}</span>
    <button class="x" data-act="tedit" data-id="${esc(t.id)}" aria-label="Editar ${esc(t.title)}">${ico('pencil', 'cb-ico--sm')}</button></div>`;
}
const taskList = (tasks, attrs, empty, opts) => `<div class="dl" ${attrs}>${tasks.map(t => taskRow(t, opts)).join('') || `<p class="dl__empty">${empty}</p>`}</div>`;

/* arrastrar para ordenar (y para cambiar de día en la pestaña Semana) */
let drag = null;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest && e.target.closest('[data-grip]'); if (!g) return;
  const row = g.closest('[data-tid]'); if (!row) return;
  e.preventDefault();
  const r = row.getBoundingClientRect(), ph = document.createElement('div');
  ph.className = 'trow-ph'; ph.style.height = r.height + 'px'; row.after(ph);
  drag = { row, ph, off: e.clientY - r.top, grip: g, pid: e.pointerId };
  row.classList.add('is-drag'); Object.assign(row.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
  try { g.setPointerCapture(e.pointerId); } catch (x) { /* ignorar */ }
});
document.addEventListener('pointermove', e => {
  if (!drag) return;
  drag.row.style.top = (e.clientY - drag.off) + 'px';
  if (e.clientY < 90) window.scrollBy(0, -12); else if (e.clientY > innerHeight - 130) window.scrollBy(0, 12);
  const el = document.elementsFromPoint(e.clientX, e.clientY).find(x => x !== drag.row && x !== drag.ph && (x.matches('.trow') || x.matches('.dl')));
  if (!el) return;
  if (el.matches('.dl')) { const em = el.querySelector('.dl__empty'); if (em && !el.querySelector('.trow')) { el.insertBefore(drag.ph, em); } else if (!el.contains(drag.ph)) el.appendChild(drag.ph); return; }
  const b = el.getBoundingClientRect();
  if (e.clientY < b.top + b.height / 2) el.before(drag.ph); else el.after(drag.ph);
});
function endDrag() {
  if (!drag) return;
  const { row, ph } = drag; drag = null;
  ph.replaceWith(row); row.classList.remove('is-drag'); row.removeAttribute('style');
  commitOrder();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
function commitOrder() {
  document.querySelectorAll('.dl').forEach(list => {
    let i = 0;
    list.querySelectorAll('[data-tid]').forEach(row => {
      const f = findTask(row.dataset.tid); if (!f) return;
      f.t.ord = ++i;
      if (list.dataset.day !== undefined && list.dataset.day !== '') f.t.day = +list.dataset.day;
      if (list.dataset.block) f.t.block = list.dataset.block;
    });
  });
  save(); render();
}

/* editor de una tarea: solo el texto y si es de mañana o de noche */
let ted = null;   // { id, draft:{title, block, day}, confirm, showDay }
function openTaskEditor(id, opts = {}) {
  const f = id && findTask(id);
  ted = { id: f ? id : null, confirm: false, showDay: !!opts.showDay, draft: f ? { title: f.t.title, block: f.t.block === 'am' ? 'am' : 'pm', day: f.t.day } : { title: '', block: opts.block || (hourNow() < 12 ? 'am' : 'pm'), day: opts.day ?? todayIdx() } };
  drawTaskEditor();
}
function drawTaskEditor() {
  const d = ted.draft;
  openSheet(`<h1>${ted.id ? 'Editar tarea' : 'Nueva tarea'}</h1>
    <label for="te-t">¿Qué tienes que hacer?</label><input id="te-t" data-tb="title" value="${esc(d.title)}" maxlength="120" placeholder="Ej: Enviar la propuesta">
    <div class="seg" role="radiogroup" aria-label="Momento"><button class="seg__b${d.block === 'am' ? ' is-on' : ''}" role="radio" aria-checked="${d.block === 'am'}" data-act="tblock" data-id="am">${ico('sun', 'cb-ico--sm')}Mañana</button><button class="seg__b${d.block === 'pm' ? ' is-on' : ''}" role="radio" aria-checked="${d.block === 'pm'}" data-act="tblock" data-id="pm">${ico('moon', 'cb-ico--sm')}Noche</button></div>
    ${ted.showDay ? `<label for="te-d">Día</label><select id="te-d" data-tb="day">${DAYS_FULL.map((x, i) => `<option value="${i}"${d.day === i ? ' selected' : ''}>${x}</option>`).join('')}</select>` : ''}
    <button class="cb-btn" data-act="tsave">Guardar</button>
    ${ted.id ? (ted.confirm ? `<p class="warn" role="alert">¿Eliminar esta tarea?</p><button class="cb-btn cb-btn--danger" data-act="tdel2">Sí, eliminar</button><button class="cb-btn cb-btn--secondary" data-act="tdel0">Cancelar</button>` : `<button class="cb-btn cb-btn--secondary" data-act="tdel1">${ico('trash', 'cb-ico--sm')}Eliminar</button>`) : ''}
    <button class="cb-btn cb-btn--ghost" data-act="tclose">Cerrar</button>`);
}
function saveTaskEditor() {
  const d = ted.draft, title = (d.title || '').trim(); if (!title) { toast('Escribe la tarea'); return; }
  if (ted.id) { const f = findTask(ted.id); if (f) { f.t.title = title; f.t.block = d.block; if (ted.showDay) f.t.day = +d.day; save(); } }
  else addTask({ title, day: +d.day, block: d.block });
  ted = null; closeSheet(); render();
}

/* ---------- chequeo de las 16:30: ¿cumpliste tus tareas? ---------- */
const checkAt = () => hmNum(S.settings.checkAt, '16:30');
const checkDue = () => tzNow() / 3600 >= checkAt();
const checkTasks = () => dayTasks(todayIdx());
const checkPending = () => checkTasks().filter(t => !t.done);
let chk = { open: null, day: null, prio: null, moved: [] };
function dayOptions() { const out = []; for (let i = 1; i <= 7; i++) { const d = addDays(new Date(), i); out.push({ date: fmt(d), label: i === 1 ? 'Mañana' : `${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()}` }); } return out; }
function openCheck() { chk = { open: null, day: null, prio: null, moved: [] }; if (S.settings.checkShown !== todayStr()) { S.settings.checkShown = todayStr(); save(); } drawCheck(); }
function drawCheck() {
  const tasks = checkTasks(), pend = tasks.filter(t => !t.done);
  const rows = tasks.map(t => {
    if (t.done) return `<div class="crow is-done"><span class="cb-check">${ico('check')}</span><span class="crow__t">${esc(t.title)}</span></div>`;
    if (chk.open === t.id) return `<div class="crow crow--open"><span class="crow__t">${esc(t.title)}</span>
      <p class="cap">¿Para cuándo la dejamos?</p><div class="chips">${dayOptions().map(o => `<button class="cb-chip${chk.day === o.date ? ' is-on' : ''}" data-act="ckday" data-id="${o.date}">${o.label}</button>`).join('')}</div>
      <p class="cap">¿Qué prioridad tiene?</p><div class="chips">${Object.entries(PRIO).map(([k, v]) => `<button class="cb-chip${chk.prio === k ? ' is-on' : ''}" data-act="ckprio" data-id="${k}"><i class="pdot" style="background:${v[1]}"></i>${v[0]}</button>`).join('')}</div>
      <div class="row"><button class="cb-btn cb-btn--ghost grow" data-act="ckcancel">Cancelar</button><button class="cb-btn grow" data-act="ckmove"${chk.day && chk.prio ? '' : ' disabled'}>Mover tarea</button></div></div>`;
    return `<div class="crow"><span class="crow__t">${esc(t.title)}</span><div class="crow__a"><button class="cb-btn cb-btn--sm" data-act="ckdone" data-id="${esc(t.id)}">${ico('check', 'cb-ico--sm')}Cumplí</button><button class="cb-btn cb-btn--secondary cb-btn--sm" data-act="ckno" data-id="${esc(t.id)}">No cumplí</button></div></div>`;
  }).join('');
  openSheet(`<h1>Chequeo del día</h1><p class="mut">${tasks.length ? `${tasks.length - pend.length} de ${tasks.length} tareas cumplidas. Marca lo que hiciste; lo que no, lo movemos.` : 'Hoy no anotaste tareas.'}</p>
    <div class="stack">${rows}</div>
    ${chk.moved.length ? `<p class="cap">Movidas</p>${chk.moved.map(m => `<p class="mut">↪ ${esc(m.t)} · ${esc(m.when)} · prioridad ${esc(m.p)}</p>`).join('')}` : ''}
    ${tasks.length && !pend.length ? '<p><b>¡Todo al día!</b> Buen trabajo.</p>' : ''}
    <button class="cb-btn ${pend.length ? 'cb-btn--secondary' : ''}" data-act="ckclose">${pend.length ? 'Después' : 'Listo'}</button>`);
}
function checkCard() {
  if (!checkDue()) return '';
  const tasks = checkTasks(); if (!tasks.length) return '';
  const pend = tasks.filter(t => !t.done).length;
  return `<button class="checkcard${pend ? '' : ' is-ok'}" data-act="check"><span class="checkcard__ico">${ico('check')}</span><span class="checkcard__b"><b>${pend ? 'Chequeo del día' : 'Tareas al día'}</b><small>${pend ? `${pend} ${pend === 1 ? 'tarea' : 'tareas'} por revisar` : 'Cumpliste todo lo de hoy'}</small></span><span class="cb-tag">${pend ? 'Revisar' : 'Ver'}</span></button>`;
}
function maybeAutoCheck() {
  if (!C || tab !== 'hoy' || !$('#overlay').hidden || !checkDue()) return;
  if (S.settings.checkShown === todayStr() || !checkPending().length) return;
  S.settings.checkShown = todayStr(); save(); openCheck();
}

/* ---------- vistas ---------- */
function convoCard(d) {
  return `<div class="convo"><div class="convo__top"><span class="convo__ico">${ico('chat')}</span><span class="convo__kick">Para conversar hoy</span><span class="cb-tag">Dato del día</span></div>
    <p class="convo__t">${esc(d.t)}</p>
    <div class="convo__q"><span class="convo__tag">Rompe el hielo</span><p>«${esc(d.q)}»</p></div>
    <svg class="convo__deco" viewBox="0 0 120 60" aria-hidden="true"><circle cx="100" cy="14" r="5" fill="#FFC83D"/><circle cx="82" cy="40" r="3" fill="#FF8FB8"/><path d="M16 12l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#6A47F5" opacity=".5"/><circle cx="108" cy="46" r="7" fill="#6FD9AE" opacity=".6"/></svg></div>`;
}
function habitGroup(slot) {
  const foc = (S.claude && S.claude.focus) || [];
  return C.habits.filter(h => h.slot === slot).sort((a, b) => (foc.includes(b.id) - foc.includes(a.id))).map(habitMission).map(missionRow).join('');
}
const hoySig = () => [moodDue(rec(todayStr())), checkDue(), intakeDue(), checkPending().length].join('|');
function viewHoy() {
  hoySig.last = hoySig();
  const ds = todayStr(), r = rec(ds);
  const dato = C.datos[dayNum() % C.datos.length];
  const notes = r.notes || {};
  const d = todayIdx(), minimal = !!(S.learned && S.learned.load && S.learned.load.minimal) && !showAll;
  let h = header() + reminderCard() + intakeCard() + checkCard() + bannerHtml();
  h += moodHtml(r);
  if (!S.settings.notif) h += `<div class="cb-reminder" style="margin:var(--space-4) 0"><div><h3 class="cb-reminder__title">Activa tus recordatorios</h3><p class="cb-reminder__text">Que no se te pase la rutina de la mañana ni tus tareas de la noche.</p><button class="cb-btn cb-btn--violet cb-btn--sm" data-act="notif">Activar ahora</button></div>${BELL}</div>`;
  h += convoCard(dato);
  h += `<div class="sec-h"><h2>Diario rápido</h2></div><div class="cb-jrow">${JOURNAL.map((j, i) => `<button class="cb-jcard${j.tone}" data-act="jr" data-id="${i}"><span><span class="cb-jcard__title">${j.t}</span><span class="cb-jcard__text">${notes[j.id] ? esc(notes[j.id]).slice(0, 60) : j.q}</span></span><span class="cb-jcard__foot">${notes[j.id] ? 'Guardado' : 'Hoy'}<span class="cb-tag">${j.tag}</span></span></button>`).join('')}</div>`;
  if (minimal) {
    h += `<div class="sec-h"><h2>${ico('spark')} Hoy, lo mínimo</h2></div><p class="mut">Los últimos días cumpliste poco. Con estas tres misiones retomas el ritmo; el resto puede esperar.</p>` + essentials(r, dayTasks(d)).map(missionRow).join('') + `<button class="cb-btn cb-btn--secondary" style="margin-top:var(--space-4)" data-act="showall">Ver todo mi día</button>`;
    return h;
  }
  const lev = leverHabit(r);
  if (lev && !r.habits[lev.habit.id]) h += `<div class="card lever"><span class="cap">${ico('spark', 'cb-ico--sm')} Tu palanca de hoy</span><b>${esc(lev.habit.t)}</b><p class="mut">${esc(lev.why)} Hazla primero.</p><button class="cb-btn cb-btn--sm" data-act="lever" data-id="${lev.habit.id}">Empezar</button></div>`;
  const od = lateToday().filter(t => !t.done);
  if (od.length) h += `<div class="sec-h"><h2>${ico('clock')} Atrasadas</h2></div><div class="dl" data-late>${od.map(t => taskRow(t, { late: true })).join('')}</div>`;
  h += `<div class="sec-h"><h2>${ico('sun')} Mañana</h2><button class="cb-iconbtn cb-iconbtn--sm" data-act="tadd" data-id="am" aria-label="Añadir tarea de la mañana">${ico('plus', 'cb-ico--sm')}</button></div>` + habitGroup('manana') + taskList(dayTasks(d, 'am'), `data-day="${d}" data-block="am"`, 'Sin tareas por la mañana. Arrastra una aquí o añade una con +.');
  h += `<div class="sec-h"><h2>${ico('moon')} Noche</h2><button class="cb-iconbtn cb-iconbtn--sm" data-act="tadd" data-id="pm" aria-label="Añadir tarea de la noche">${ico('plus', 'cb-ico--sm')}</button></div>` + taskList(dayTasks(d, 'pm'), `data-day="${d}" data-block="pm"`, 'Sin tareas para la noche. Añade una con + o anótalas en la pizarra semanal.') + habitGroup('noche');
  return h;
}
function viewSemana() {
  const p = planCurrent();
  let h = `<h1>Semana</h1>`;
  h += `<div class="pizcard"><span class="pizcard__ico">${ico('journal')}</span><div class="pizcard__b"><b>Pizarra semanal</b><span>Una vez a la semana anota aquí todas tus tareas.</span></div><button class="cb-btn cb-btn--sm" data-act="intake">Abrir</button></div>`;
  h += `<p class="mut">Mantén pulsado el asa ⋮⋮ y arrastra una tarea para cambiarla de día o de lugar.</p>`;
  for (let d = 0; d < 7; d++) {
    const ts = p ? sortTasks(p.tasks.filter(t => t.day === d)) : [];
    h += `<section class="wk${d === todayIdx() ? ' is-today' : ''}"><div class="wk__h"><h3>${DAYS_FULL[d]}${d === todayIdx() ? ' · hoy' : ''}</h3><button class="cb-iconbtn cb-iconbtn--sm" data-act="tadd" data-id="d${d}" aria-label="Añadir tarea el ${DAYS_FULL[d]}">${ico('plus', 'cb-ico--sm')}</button></div>`;
    h += taskList(ts, `data-day="${d}"`, 'Libre', { showBlock: true }) + `</section>`;
  }
  return h;
}
/* ---------- pantalla Metas ---------- */
function goalCard(g) {
  const p = goalPct(g), ar = areaOf(g.area), ms = g.milestones || [], done = ms.filter(m => m.done).length;
  const d = g.due ? daysTo(g.due) : null;
  const when = d === null ? 'Sin fecha' : d < 0 ? `Venció hace ${-d} ${-d === 1 ? 'día' : 'días'}` : d === 0 ? 'Vence hoy' : `Faltan ${d} ${d === 1 ? 'día' : 'días'}`;
  const sub = ms.length ? `${done} de ${ms.length} hitos` : (g.target && +g.target.value > 0 ? `${g.target.current || 0} de ${g.target.value} ${esc(g.target.unit || '')}` : '');
  return `<article class="goal">
    <div class="goal__top"><span class="cb-tag">${esc(ar.t)}</span><span class="goal__when${d !== null && d < 0 && p < 100 ? ' is-late' : ''}">${when}</span>
      <button class="x" data-act="gedit" data-id="${g.id}" aria-label="Editar ${esc(g.title)}">${ico('pencil', 'cb-ico--sm')}</button></div>
    <h3 class="goal__title">${esc(g.title)}</h3>
    <div class="bar"><i style="width:${p}%"></i></div>
    <div class="goal__pct"><b>${p}%</b><small>${sub}</small></div>
    ${ms.length ? `<div class="goal__ms">${ms.map(m => `<button class="ms${m.done ? ' is-done' : ''}" data-act="gms" data-id="${g.id}:${m.id}" aria-pressed="${!!m.done}"><span class="cb-check">${ico('check')}</span><span class="ms__t">${esc(m.t)}</span>${m.due ? `<small>${parse(m.due).getDate()} ${MONTHS[parse(m.due).getMonth()]}</small>` : ''}</button>`).join('')}</div>` : ''}
  </article>`;
}
function viewMetas() {
  const all = liveGoals();
  let h = `<div class="hd"><h1 class="hd__t">Metas del año</h1><button class="cb-btn cb-btn--sm" data-act="gnew">${ico('plus', 'cb-ico--sm')}Nuevo objetivo</button></div>`;
  if (!all.length) {
    return h + `<div class="card empty"><b>Aún no tienes objetivos</b><p class="mut">Pon tus metas del año: cada una con su fecha y sus hitos. Después puedes editarlas, borrarlas o añadir más.</p>
      <button class="cb-btn" data-act="gnew">Crear mi primer objetivo</button><div class="gap"></div><button class="cb-btn cb-btn--secondary" data-act="gseed">Empezar con los que me contaste</button></div>`;
  }
  const areas = C.areas.filter(a => all.some(g => g.area === a.id));
  const other = all.filter(g => !C.areas.some(a => a.id === g.area));
  if (other.length) areas.push({ id: '__otra', t: 'Otras' });
  const list = goalArea === 'all' ? all : all.filter(g => goalArea === '__otra' ? !C.areas.some(a => a.id === g.area) : g.area === goalArea);
  const avg = Math.round(all.reduce((a, g) => a + goalPct(g), 0) / all.length);
  h += `<p class="mut">${all.length} ${all.length === 1 ? 'objetivo' : 'objetivos'} · avance promedio ${avg}% · ${hitosHechos()} hitos cumplidos</p>`;
  h += `<div class="chips"><button class="cb-chip${goalArea === 'all' ? ' is-on' : ''}" data-act="gfilter" data-id="all">Todas</button>${areas.map(a => `<button class="cb-chip${goalArea === a.id ? ' is-on' : ''}" data-act="gfilter" data-id="${a.id}">${esc(a.t)}</button>`).join('')}</div>`;
  h += `<div class="stack">${list.map(goalCard).join('') || '<p class="mut">No hay objetivos en esta área.</p>'}</div>`;
  return h;
}
let ged = null;   // editor de objetivos: { id, draft, confirm }
function keepScroll(fn) { const sh = $('.sheet'), st = sh ? sh.scrollTop : 0; fn(); const n = $('.sheet'); if (n && st) n.scrollTop = st; }
function openGoalEditor(id) {
  const g = id && S.goals[id] && !S.goals[id].deleted ? S.goals[id] : { id: null, title: '', area: 'trabajo', due: fmt(addDays(new Date(), 90)), note: '', milestones: [], target: null, done: false };
  ged = { id: id || null, draft: JSON.parse(JSON.stringify(g)), confirm: false };
  drawGoalEditor();
}
function drawGoalEditor() {
  const d = ged.draft, t = d.target || { label: '', unit: '', value: '', current: '' };
  openSheet(`<h1>${ged.id ? 'Editar objetivo' : 'Nuevo objetivo'}</h1>
    <label for="ge-title">Objetivo</label><input id="ge-title" data-gb="title" value="${esc(d.title)}" placeholder="Ej: Cumbre del Cotopaxi" maxlength="120">
    <div class="row"><div class="grow"><label for="ge-area">Área</label><select id="ge-area" data-gb="area">${C.areas.map(a => `<option value="${a.id}" ${a.id === d.area ? 'selected' : ''}>${esc(a.t)}</option>`).join('')}</select></div>
      <div class="grow"><label for="ge-due">Fecha límite</label><input id="ge-due" type="date" data-gb="due" value="${esc(d.due || '')}"></div></div>
    <label for="ge-note">Nota</label><textarea id="ge-note" rows="2" data-gb="note" maxlength="400">${esc(d.note || '')}</textarea>
    <h2 class="sub">Hitos</h2>
    <div class="stack" id="ge-ms">${d.milestones.map((m, i) => `<div class="mrow"><button class="ms-chk${m.done ? ' is-done' : ''}" data-act="gmtoggle" data-id="${i}" aria-pressed="${!!m.done}" aria-label="Hito ${i + 1} cumplido"><span class="cb-check">${ico('check')}</span></button><input data-gb="m.${i}.t" value="${esc(m.t)}" aria-label="Hito ${i + 1}" maxlength="120"><button class="x" data-act="gmdel" data-id="${i}" aria-label="Quitar hito ${i + 1}">${ico('close', 'cb-ico--sm')}</button><input type="date" data-gb="m.${i}.due" value="${esc(m.due || '')}" aria-label="Fecha del hito ${i + 1}"></div>`).join('') || '<p class="mut">Sin hitos todavía. Divide tu objetivo en pasos que puedas marcar.</p>'}</div>
    <div class="row" style="margin-top:var(--space-2)"><input id="ge-newm" placeholder="Nuevo hito" aria-label="Nuevo hito" maxlength="120"><button class="cb-btn cb-btn--secondary cb-btn--sm" data-act="gmadd">Añadir</button></div>
    <details class="tgt"${d.target ? ' open' : ''}><summary>Meta numérica (opcional)</summary>
      <div class="row"><div class="grow"><label for="ge-tl">Qué mides</label><input id="ge-tl" data-gb="target.label" value="${esc(t.label || '')}" placeholder="Ingresos del mes"></div><div style="width:84px"><label for="ge-tu">Unidad</label><input id="ge-tu" data-gb="target.unit" value="${esc(t.unit || '')}" placeholder="US$"></div></div>
      <div class="row"><div class="grow"><label for="ge-tc">Llevas</label><input id="ge-tc" type="number" inputmode="decimal" data-gb="target.current" value="${esc(t.current === undefined ? '' : t.current)}"></div><div class="grow"><label for="ge-tv">Meta</label><input id="ge-tv" type="number" inputmode="decimal" data-gb="target.value" value="${esc(t.value === undefined ? '' : t.value)}"></div></div>
      <p class="mut">Si hay hitos, el avance sale de los hitos; si no, de estos números.</p></details>
    <label class="chk"><input type="checkbox" id="ge-done" data-gb="done" ${d.done ? 'checked' : ''}><span>Ya lo logré</span></label>
    <button class="cb-btn" data-act="gsave">Guardar objetivo</button>
    ${ged.id ? (ged.confirm ? `<p class="warn" role="alert">¿Eliminar este objetivo? No se puede deshacer.</p><button class="cb-btn cb-btn--danger" data-act="gdel2">Sí, eliminar</button><button class="cb-btn cb-btn--secondary" data-act="gdel0">Cancelar</button>` : `<button class="cb-btn cb-btn--secondary" data-act="gdel1">${ico('trash', 'cb-ico--sm')}Eliminar objetivo</button>`) : ''}
    <button class="cb-btn cb-btn--ghost" data-act="gcancel">Cerrar</button>`);
}
function saveGoalDraft() {
  const d = ged.draft, title = (d.title || '').trim();
  if (!title) { toast('Ponle un nombre al objetivo'); return false; }
  const ms = (d.milestones || []).map(m => ({ id: m.id || uid(), t: (m.t || '').trim(), done: !!m.done, due: m.due || '' })).filter(m => m.t);
  const tg = d.target && (d.target.label || d.target.value !== '' && d.target.value !== undefined) ? { label: String(d.target.label || ''), unit: String(d.target.unit || ''), value: +d.target.value || 0, current: +d.target.current || 0 } : null;
  putGoal({ id: ged.id || uid(), title, area: d.area, due: d.due || '', note: (d.note || '').trim(), milestones: ms, target: tg, done: !!d.done });
  return true;
}
function seedGoals() {
  C.goalSeeds.forEach(sd => {
    const id = uid();
    S.goals[id] = { id, title: sd.title, area: sd.area, due: fmt(addDays(new Date(), sd.days)), note: sd.note || '', milestones: sd.milestones.map(t => ({ id: uid(), t, done: false, due: '' })), target: sd.target ? Object.assign({}, sd.target) : null, done: false };
  });
  save();
}


/* ---------- pizarra semanal: una vez a la semana anotas todas tus tareas ---------- */
let itk = null;   // { text, items|null }
const intakeDue = () => todayIdx() === 0 && tzNow() >= 19 * 3600 && S.settings.intakeDone !== thisMon() && S.settings.intakeSnooze !== todayStr();
function intakeCard() {
  if (!intakeDue()) return '';
  return `<div class="intake"><span class="intake__ico">${ico('journal')}</span><div class="intake__b"><b>Pizarra semanal</b><span>Es lunes por la noche: anota las tareas de esta semana y las ordeno por día.</span></div>
    <button class="cb-btn cb-btn--sm" data-act="intake">Anotar tareas</button><button class="intake__x" data-act="intakesnooze" aria-label="Ahora no">${ico('close', 'cb-ico--sm')}</button></div>`;
}
function openIntake() { itk = { text: '', items: null }; drawIntake(); }
function drawIntake() {
  const w = itk;
  if (!w.items) {
    openSheet(`<h1>Pizarra semanal</h1>
      <p class="mut">Escribe todo lo que tienes que hacer esta semana, una idea por línea o separadas por comas. Por ejemplo: «El martes enviar la propuesta, el jueves 5 mensajes por la noche, el viernes diseñar el post».</p>
      <textarea id="itk-text" rows="7" placeholder="Escribe tus tareas aquí" aria-label="Tus tareas de la semana">${esc(w.text)}</textarea>
      <button class="cb-btn" data-act="itkparse">Ordenar mis tareas</button><button class="cb-btn cb-btn--ghost" data-act="itkclose">Ahora no</button>`);
    return;
  }
  const rows = w.items.map((t, i) => `<div class="irow"><input class="irow__t" data-ib="${i}.title" value="${esc(t.title)}" aria-label="Tarea ${i + 1}" maxlength="120">
      <select data-ib="${i}.day" aria-label="Día">${DAYS_FULL.map((d, k) => `<option value="${k}"${t.day === k ? ' selected' : ''}>${d}</option>`).join('')}</select>
      <select data-ib="${i}.block" aria-label="Momento"><option value="am"${t.block === 'am' ? ' selected' : ''}>Mañana</option><option value="pm"${t.block !== 'am' ? ' selected' : ''}>Noche</option></select>
      <button class="x" data-act="itkrm" data-id="${i}" aria-label="Quitar">${ico('close', 'cb-ico--sm')}</button></div>`).join('');
  openSheet(`<h1>${w.items.length} ${w.items.length === 1 ? 'tarea' : 'tareas'}</h1><p class="mut">Revísalas: puedes cambiar el texto, el día o si es de mañana o de noche.</p>
    <div class="stack">${rows || '<p class="mut">No entendí ninguna tarea. Vuelve y escribe una por frase.</p>'}</div>
    <button class="cb-btn" data-act="itkadd"${w.items.length ? '' : ' disabled'}>Añadir a mi semana</button><button class="cb-btn cb-btn--secondary" data-act="itkback">Volver a editar</button>`);
}
function addIntakeTasks() {
  const w = itk; if (!w || !w.items.length) return;
  const p = planFor(thisMon(), true);
  w.items.forEach(t => { const title = String(t.title || '').trim(); if (!title) return; const d = Math.max(0, Math.min(6, +t.day || 0)); p.tasks.push({ id: uid(), title, day: d, block: t.block === 'am' ? 'am' : 'pm', mins: 30, done: null, ord: Math.max(0, ...p.tasks.filter(x => x.day === d).map(x => x.ord || 0)) + 1 }); });
  S.settings.intakeDone = thisMon();
  itk = null; closeSheet(); save(); render();
  toast('Tareas añadidas a tu semana');
}

/* ---------- recordatorios: lista y editor ---------- */
let red = null;   // editor de recordatorios: { id, draft, confirm }
function openReminders() {
  const all = remindersList(), open = all.filter(r => !r.done), done = all.filter(r => r.done).slice(-5);
  const row = r => `<div class="rrow${r.done ? ' is-done' : ''}"><button class="rrow__chk" data-act="rdone" data-id="${esc(r.id)}" aria-pressed="${r.done}" aria-label="${r.done ? 'Reabrir' : 'Marcar como hecho'}: ${esc(r.title)}"><span class="cb-check">${ico('check')}</span></button>
    <div class="rrow__b"><b>${esc(r.title)}</b><small>${parse(r.date).getDate()} ${MONTHS[parse(r.date).getMonth()]} · ${whenText(r)}${r.src === 'h' ? ` · hito de «${esc(r.note)}»` : ''}${r.src === 't' ? ' · tarea de la semana' : ''}</small></div>
    ${r.src === 't' ? '' : r.src === 'r' ? `<button class="x" data-act="redit" data-id="${r.id}" aria-label="Editar ${esc(r.title)}">${ico('pencil', 'cb-ico--sm')}</button>` : `<button class="x" data-act="gedit" data-id="${r.gid}" aria-label="Ver objetivo">${ico('target', 'cb-ico--sm')}</button>`}</div>`;
  openSheet(`<h1>Recordatorios</h1>
    ${open.length ? `<div class="stack">${open.map(row).join('')}</div>` : '<p class="mut">No tienes nada pendiente. Agrega algo importante para hoy o para los próximos días.</p>'}
    ${done.length ? `<h2 class="sub">Hechos</h2><div class="stack">${done.map(row).join('')}</div>` : ''}
    <button class="cb-btn" data-act="radd">${ico('plus', 'cb-ico--sm')}Nuevo recordatorio</button><button class="cb-btn cb-btn--ghost" data-act="rclose">Cerrar</button>`);
}
function openReminderEditor(id) {
  const base = id && S.reminders[id] && !S.reminders[id].deleted ? S.reminders[id] : { id: null, title: '', date: todayStr(), time: '', important: true, note: '', done: false };
  red = { id: id || null, draft: JSON.parse(JSON.stringify(base)), confirm: false };
  drawReminderEditor();
}
function drawReminderEditor() {
  const d = red.draft;
  openSheet(`<h1>${red.id ? 'Editar recordatorio' : 'Nuevo recordatorio'}</h1>
    <label for="re-title">Qué es</label><input id="re-title" data-rb="title" value="${esc(d.title)}" placeholder="Ej: Enviar la propuesta a la barbería" maxlength="120">
    <div class="row"><div class="grow"><label for="re-date">Fecha</label><input id="re-date" type="date" data-rb="date" value="${esc(d.date)}"></div><div class="grow"><label for="re-time">Hora (opcional)</label><input id="re-time" type="time" data-rb="time" value="${esc(d.time || '')}"></div></div>
    <label class="chk"><input type="checkbox" id="re-imp" data-rb="important" ${d.important ? 'checked' : ''}><span>Es importante</span></label>
    <label for="re-note">Nota</label><textarea id="re-note" rows="2" data-rb="note" maxlength="400">${esc(d.note || '')}</textarea>
    <button class="cb-btn" data-act="rsave">Guardar recordatorio</button>
    ${red.id ? (red.confirm ? `<p class="warn" role="alert">¿Eliminar este recordatorio? No se puede deshacer.</p><button class="cb-btn cb-btn--danger" data-act="rdel2">Sí, eliminar</button><button class="cb-btn cb-btn--secondary" data-act="rdel0">Cancelar</button>` : `<button class="cb-btn cb-btn--secondary" data-act="rdel1">${ico('trash', 'cb-ico--sm')}Eliminar</button>`) : ''}
    <button class="cb-btn cb-btn--ghost" data-act="rback">Volver a la lista</button>`);
}
function toggleReminder(id) {
  if (id.startsWith('T~')) { const tid = id.slice(2), p = [S.plan, planCurrent()].filter(Boolean).find(pl => (pl.tasks || []).some(t => t.id === tid)); const t = p && p.tasks.find(x => x.id === tid); if (t) setTask(tid, !t.done); return; }
  const [a, b] = id.split(':');
  if (b) { const g = S.goals[a], m = g && (g.milestones || []).find(x => x.id === b); if (m) { m.done = !m.done; putGoal(g); } return; }
  const r = S.reminders[id]; if (r && !r.deleted) { r.done = !r.done; putReminder(r); }
}

/* ---------- perfil y vistazo de los iconos del encabezado ---------- */
let peeked = false, peekTimer = null, peekStart = null;
function peekHtml(kind) {
  if (kind === 'racha') {
    const st = streakInfo(), best = Math.max(bestStreak(), st.n);
    return `<b>${st.n} ${st.n === 1 ? 'día' : 'días'} de racha</b><p>Tu mejor racha: ${best} ${best === 1 ? 'día' : 'días'}</p><small>${st.n > 0 ? (st.risk ? 'Haz 2 acciones hoy para mantenerla' : '¡Racha asegurada hoy!') : 'Empieza tu racha hoy'}</small>`;
  }
  const lv = levelInfo();
  return `<b>Nivel ${lv.lvl} · ${esc(lv.name)}</b><div class="bar"><i style="width:${lv.pct}%"></i></div><small>faltan ${lv.left} XP · ${S.xp} XP en total</small>`;
}
function showPeek(btn) {
  const el = $('#peek'); if (!el) return;
  peeked = true;
  el.innerHTML = peekHtml(btn.dataset.peek); el.hidden = false;
  const r = btn.getBoundingClientRect();
  el.style.top = (r.bottom + 10) + 'px';
  const w = el.offsetWidth; el.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.right - w)) + 'px';
  if (navigator.vibrate) navigator.vibrate(10);
}
function hidePeek() { const el = $('#peek'); if (el) { el.hidden = true; el.innerHTML = ''; } clearTimeout(peekTimer); peekStart = null; }

function rangeDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(fmt(addDays(new Date(), -i))); return out; }
function viewProgreso() {
  const days = rangeDays(progRange), st = streakInfo();
  const pct = id => Math.round(100 * days.filter(d => S.days[d] && S.days[d].habits[id]).length / days.length);
  const habits = [['Sueño', 'sleep', 'violet'], ['Redes', 'redes', 'action'], ['Trote', 'trote', 'green'], ['Calma', 'med', 'pink']];
  const moodCount = { 1: 0, 2: 0, 3: 0, 4: 0 }; let moodTotal = 0;
  days.forEach(d => { const m = S.days[d] && S.days[d].mood; if (m) { moodCount[m]++; moodTotal++; } });
  const moods = [['Feliz', 4, 'sun'], ['Triste', 1, 'violet'], ['Calmado', 3, 'green'], ['Ansioso', 2, 'taupe']];
  const xp = days.reduce((a, d) => a + ((S.days[d] || {}).xp || 0), 0);
  const done = days.reduce((a, d) => { const r = S.days[d]; return a + (r ? Object.keys(r.habits).length + (r.tasksDone || 0) : 0); }, 0);
  const bars = (list, solid) => `<div class="cb-caps${solid ? ' cb-caps--solid' : ''}">${list.map(b => `<div class="cb-cap"><div class="cb-cap__track"><div class="cb-cap__fill" style="--v:0;--c:var(--${b[2]});--on-c:var(--on-${b[2]})" data-v="${b[1]}">${b[1]}%</div></div><span class="cb-cap__label">${b[0]}</span></div>`).join('')}</div>`;
  const best = habits.map(h => [h[0], pct(h[1])]).sort((a, b) => b[1] - a[1])[0];
  let h = `<div class="hd"><button class="cb-iconbtn" data-act="goto" data-id="hoy" aria-label="Volver a Hoy">${ico('back')}</button><h1 class="hd__t">Tu progreso</h1></div>`;
  h += `<div class="row" style="margin-bottom:var(--space-4)"><button class="cb-chip ${progRange === 7 ? 'is-on' : ''}" data-act="range" data-id="7">Semana</button><button class="cb-chip ${progRange === 30 ? 'is-on' : ''}" data-act="range" data-id="30">Mes</button></div>`;
  h += `<p class="cap">Hábitos cumplidos (porcentaje de días)</p>` + bars(habits.map(x => [x[0], pct(x[1]), x[2]]));
  h += `<p class="cap" style="margin-top:var(--space-6)">Estados de ánimo</p>` + (moodTotal ? bars(moods.map(m => [m[0], Math.round(100 * moodCount[m[1]] / moodTotal), m[2]]), true) : `<p class="mut">Elige cómo vienes en la pantalla Hoy y aquí verás tus emociones.</p>`);
  h += `<div class="cb-points" style="margin-top:var(--space-6)"><div class="cb-points__head"><div><h3 class="cb-points__title">Puntos ganados</h3><p class="cb-points__sub">${progRange === 7 ? 'Esta semana' : 'Últimos 30 días'}</p></div><div class="cb-points__num">${xp} <small>XP</small></div></div>
    <div class="cb-points__cols"><div><small>Misiones</small><b>${done}</b></div><div><small>Hitos</small><b>${hitosHechos()}</b></div><div><small>Racha</small><b>${st.n} d</b></div></div>
    <button class="cb-btn" data-act="share">${ico('share')}Compartir progreso</button></div>`;
  h += moodHistory();
  h += learnedHtml();
  if (best && best[1] > 0) h += `<div class="coachcard" style="margin-top:var(--space-4)"><span class="who">Lo que más funcionó</span><p>Tu hábito más constante fue «${best[0]}» (${best[1]}% de los días). Apóyate en él para sostener los demás.</p></div>`;
  return h;
}
const MOOD_BY_N = { 1: 'sad', 2: 'anxious', 3: 'calm', 4: 'happy' };
function moodHistory() {
  const days = rangeDays(14);
  const cells = days.map(d => {
    const r = S.days[d], k = r && r.mood ? MOOD_BY_N[r.mood] : null, wd = DAYS[(parse(d).getDay() + 6) % 7];
    return `<span class="mh" title="${d}">${k ? `<span class="cb-face${MOOD_FACE[k]}" style="zoom:.4"></span>` : '<span class="mh-empty"></span>'}<small>${wd[0]}</small></span>`;
  }).join('');
  const n = days.filter(d => S.days[d] && S.days[d].mood).length;
  return `<div class="sec-h"><h2>Historial de ánimo</h2><small>${n} de 14 días</small></div><div class="card"><div class="mhrow">${cells}</div><p class="mut" style="margin-bottom:0">Cada carita queda guardada con su día. ${Store.mode === 'db' ? 'Se guarda en la base de datos.' : 'Se guarda en este dispositivo.'}</p></div>`;
}
function learnedHtml() {
  const m = S.learned;
  let h = `<div class="sec-h"><h2>${ico('brain')} Lo que he aprendido de ti</h2></div>`;
  if (!m) return h + '<div class="card"><p class="mut">Registra tu ánimo y tus misiones unos días y empiezo a detectar patrones.</p></div>';
  h += `<div class="card">${m.insights.map(i => `<div class="insight"><p>${esc(i.text)}</p>${i.conf ? `<small>Confianza ${i.conf}</small>` : ''}</div>`).join('')}<small class="mut">${m.n} días con registro · actualizado ${esc(m.at)}</small></div>`;
  const c = S.claude;
  if (c) h += `<div class="coachcard coachcard--empathic"><span class="who">Análisis de Claude · ${esc(c.at || '')}</span>${(c.insights || []).map(i => `<p><b>${esc(i.t)}</b> ${esc(i.why || '')}</p>`).join('')}${c.advice ? `<p>${esc(c.advice)}</p>` : ''}</div>`;
  h += `<button class="cb-btn cb-btn--secondary" data-act="askclaude" id="askc">${ico('spark')}${c ? 'Actualizar análisis de Claude' : 'Pedir análisis a Claude'}</button><p class="mut">Claude lee solo tus cifras (no tus notas) y propone ajustes que la app aplica.</p>`;
  return h;
}
async function askClaude() {
  const btn = $('#askc');
  let sample = null;
  try { sample = window.claude && await window.claude.use('sample'); } catch (e) { sample = null; }
  if (!sample) { toast('Claude no está disponible aquí'); return; }
  const m = S.learned || {};
  const data = { diasConRegistro: m.n, habitos: m.habit, animo: m.mood, horaTipicaDeCumplimiento: m.bestHour, diaFlojo: m.weekday && m.weekday.weak, cargaNocturnaMin: m.night, tonoDelCoach: m.tone && m.tone.stats, tareas: Object.values(m.templates || {}), racha: streakInfo().n, xp: S.xp, metas: liveGoals().map(g => ({ titulo: g.title, area: g.area, fecha: g.due, avance: goalPct(g) })) };
  const ids = C.habits.map(h => h.id).join(', ');
  const prompt = `Eres el coach de Esteban (22 años, Quito): diseñador con IA que quiere conseguir las primeras ventas de su proyecto, dormir mejor y usar menos redes. Estos son los datos agregados de su app de hábitos (los números salen de sus propios registros; "lift" es cuánto sube la probabilidad de un ánimo bueno cuando hace el hábito):\n${JSON.stringify(data)}\n\nAnaliza solo lo que los datos respaldan; si hay pocos días dilo. Responde SOLO con JSON con esta forma: {"insights":[{"t":"frase corta","why":"por qué, con el dato"}],"advice":"un consejo concreto para esta semana en 2 frases","tone":"direct|empathic|socratic","focus":["id de hábito"]}. Máximo 4 insights. Los ids válidos de hábito son: ${ids}.`;
  if (btn) { btn.disabled = true; btn.textContent = 'Claude está pensando…'; }
  try {
    const r = await sample.json(prompt, { modelTier: 'default', cache: false });
    const valid = C.habits.map(h => h.id);
    S.claude = {
      at: todayStr(),
      insights: (Array.isArray(r.insights) ? r.insights : []).slice(0, 4).map(i => ({ t: String(i.t || '').slice(0, 140), why: String(i.why || '').slice(0, 240) })).filter(i => i.t),
      advice: String(r.advice || '').slice(0, 400),
      tone: ['direct', 'empathic', 'socratic'].includes(r.tone) ? r.tone : null,
      focus: (Array.isArray(r.focus) ? r.focus : []).filter(x => valid.includes(x)).slice(0, 3)
    };
    save(); toast('Análisis guardado');
  } catch (e) { toast(e && e.code === 'not_granted' ? 'No diste permiso a Claude' : 'No se pudo analizar ahora'); }
  render();
}
const PUSH_TEXT = {
  unsupported: 'Este navegador no admite notificaciones push. En iPhone, instala la app en la pantalla de inicio (iOS 16.4 o superior).',
  noserver: 'Los avisos necesitan la app publicada en tu Worker de Cloudflare. Aquí no hay servidor.',
  notoken: 'Escribe tu código de acceso para conectar con tu Worker y poder activar los avisos.',
  denied: 'El permiso de notificaciones está bloqueado. Actívalo en los ajustes del navegador para este sitio.',
  off: 'Te preguntaré «¿Lo hiciste?» a la hora de cada misión, con botones Sí y No.',
  on: 'Activados en este dispositivo. Responde Sí o No desde la notificación y la lista se actualiza sola.'
};
async function paintPush() {
  const t = document.querySelector('[data-push-text]'), a = document.querySelector('[data-push-actions]');
  if (!t || !a) return;
  const st = await Push.state();
  t.textContent = PUSH_TEXT[st];
  a.innerHTML = st === 'off' ? '<button class="cb-btn" data-act="pushon">Activar avisos push</button>' : st === 'on' ? '<button class="cb-btn cb-btn--secondary" data-act="pushtest">Enviar push de prueba</button><div class="gap"></div><button class="cb-btn cb-btn--secondary" data-act="pushoff">Desactivar en este dispositivo</button>' : '';
}
// Si llegas desde una notificación sin botones (p. ej. iPhone), la app pregunta aquí mismo.
function askFromUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get('plan')) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignorar */ } openIntake(); return; }
  if (!q.get('ask')) return;
  const p = { i: q.get('ask'), d: q.get('d'), r: q.get('r'), e: q.get('e'), sy: q.get('sy'), sn: q.get('sn') };
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignorar */ }
  const start = /__s$/.test(p.i), baseId = p.i.replace(/__s$/, '');
  const h = C.habits.find(x => x.id === baseId);
  let title = h && h.t;
  if (!title) { const ag = agendaItems().find(x => x.id === baseId); title = ag && ag.t; }
  if (!title) [S.plan].concat(Object.values(S.history)).filter(Boolean).forEach(pl => (pl.tasks || []).forEach(t => { if (t.id === baseId) title = t.title; }));
  openSheet(`<h1>${start ? '¿Ya empezaste?' : '¿Lo cumpliste?'}</h1><p>${esc(title || 'Esta actividad')}</p><button class="cb-btn" id="ask-yes">${start ? 'Sí, estoy en ello' : 'Sí, lo cumplí'}</button><button class="cb-btn cb-btn--secondary" id="ask-no">No</button><button class="cb-btn cb-btn--ghost" id="ask-x">Cerrar</button>`);
  $('#ask-x').onclick = closeSheet;
  const send = async a => {
    closeSheet();
    const j = await Push.answer(p, a);
    toast(j.ok ? (a === 'yes' ? (j.phase === 'start' ? 'Anotado: ¡a darle!' : `Anotado: +${j.xp || 0} XP`) : (j.retry ? 'Anotado. Te pregunto de nuevo en 30 min.' : 'Anotado como no cumplido.')) : 'Esa pregunta ya estaba respondida o caducó.');
    if (Store.mode === 'api') Store.pull();
  };
  $('#ask-yes').onclick = () => send('yes'); $('#ask-no').onclick = () => send('no');
}
function animateBars() {
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.cb-cap__fill[data-v]').forEach(f => f.style.setProperty('--v', f.dataset.v))));
}
/* ---------- Ajustes: mi agenda ---------- */
function agendaCard() {
  const cfg = (S.settings.agenda = S.settings.agenda || {}), over = cfg.over || {}, extra = cfg.extra || [];
  const row = (b, o) => `<div class="arow${o.off ? ' is-off' : ''}"><label class="chk"><input type="checkbox" data-ag="${esc(b.id)}.on" ${o.off ? '' : 'checked'} aria-label="Activar ${esc(b.t)}"><span>${esc(b.t)}</span></label>
      <input type="time" data-ag="${esc(b.id)}.from" value="${esc(o.from || b.from)}" aria-label="Inicio de ${esc(b.t)}"><input type="time" data-ag="${esc(b.id)}.to" value="${esc(o.to || b.to)}" aria-label="Fin de ${esc(b.t)}"></div>`;
  return `<div class="card" id="agcard"><b>Mi agenda</b><p class="mut">El banner de Hoy y los avisos siguen estos horarios. Cámbialos a tu gusto.</p>
    <div class="stack">${C.agenda.map(b => row(b, over[b.id] || {})).join('')}
    ${extra.map((x, i) => `<div class="arow"><span class="grow"><b>${esc(x.t)}</b></span><input type="time" data-agx="${i}.from" value="${esc(x.from)}" aria-label="Inicio de ${esc(x.t)}"><input type="time" data-agx="${i}.to" value="${esc(x.to)}" aria-label="Fin de ${esc(x.t)}"><button class="x" data-act="agrm" data-id="${i}" aria-label="Eliminar ${esc(x.t)}">${ico('trash', 'cb-ico--sm')}</button></div>`).join('')}</div>
    <label for="ag-t">Añadir una actividad</label><input id="ag-t" placeholder="Ej: Clase de inglés" maxlength="60"><div class="row"><div class="grow"><label for="ag-f">Desde</label><input id="ag-f" type="time" value="17:00"></div><div class="grow"><label for="ag-e">Hasta</label><input id="ag-e" type="time" value="17:30"></div></div>
    <button class="cb-btn cb-btn--secondary" data-act="agadd">Añadir a mi agenda</button><div class="gap"></div><button class="cb-btn cb-btn--ghost" data-act="agreset">Restablecer horarios base</button></div>`;
}
function setAgenda(el) {
  const cfg = (S.settings.agenda = S.settings.agenda || {}); cfg.over = cfg.over || {};
  if (el.dataset.ag) {
    const [id, k] = el.dataset.ag.split('.'), o = (cfg.over[id] = cfg.over[id] || {});
    if (k === 'on') { if (el.checked) delete o.off; else o.off = true; } else if (el.value) o[k] = el.value;
    if (!Object.keys(o).length) delete cfg.over[id];
  } else {
    const [i, k] = el.dataset.agx.split('.'); const x = (cfg.extra || [])[+i]; if (x && el.value) x[k] = el.value;
  }
  save(); tickBanner();
}
const APP_VERSION = '8.2';
let setSec = 'horario';   // sección de Ajustes: 'horario' | 'tecnico'
function viewMas() {
  const s = S.settings, name = (s.name || 'Esteban').trim() || 'Esteban';
  const head = `<div class="hd"><button class="cb-iconbtn" data-act="goto" data-id="hoy" aria-label="Volver a Hoy">${ico('back')}</button><h1 class="hd__t">Perfil</h1></div>
    <div class="seg seg--tabs" role="tablist" aria-label="Secciones del perfil"><button class="seg__b${setSec === 'horario' ? ' is-on' : ''}" role="tab" aria-selected="${setSec === 'horario'}" data-act="setsec" data-id="horario">${ico('clock', 'cb-ico--sm')}Horario</button><button class="seg__b${setSec === 'tecnico' ? ' is-on' : ''}" role="tab" aria-selected="${setSec === 'tecnico'}" data-act="setsec" data-id="tecnico">${ico('gear', 'cb-ico--sm')}Técnico</button></div>`;
  if (setSec === 'horario') return head + `
  <div class="card"><b>Tú</b>
    <label for="pf-name">Tu nombre</label><input id="pf-name" value="${esc(name)}" maxlength="30" autocomplete="off">
    <label for="pf-tone">Tono del coach</label><select id="pf-tone"><option value="auto">Automático (aprende de ti)</option><option value="direct">Directo</option><option value="empathic">Cercano</option><option value="socratic">Con preguntas</option></select></div>
  ${agendaCard()}
  <div class="card"><b>Chequeos del día</b><p class="mut">Cuándo te pregunto cómo vas.</p>
    <div class="row"><div class="grow"><label for="set-chk">Chequeo de tareas</label><input type="time" id="set-chk" value="${esc(s.checkAt || '16:30')}"></div></div>
    <div class="row"><div class="grow"><label for="set-mam">Ánimo de la mañana</label><input type="time" id="set-mam" value="${esc(s.moodAM || '07:30')}"></div><div class="grow"><label for="set-mpm">Ánimo de la noche</label><input type="time" id="set-mpm" value="${esc(s.moodPM || '21:30')}"></div></div></div>
  <div class="card"><b>Tus límites</b>
    <label for="set-bed">Hora de dormir</label><input type="time" id="set-bed" value="${esc(s.bedtime)}">
    <label for="set-redes">Límite de redes al día (min)</label><input type="number" id="set-redes" value="${s.redes}" min="0" step="5"></div>`;
  return head + `
  <div class="card" id="pushcard"><b>Avisos en el celular</b><p class="mut" data-push-text>Revisando…</p><div data-push-actions></div>
    <label for="set-token">Código de acceso</label><input type="password" id="set-token" autocomplete="off" placeholder="El APP_TOKEN de tu Worker" value="${esc(Store.token())}"><div class="gap"></div><button class="cb-btn cb-btn--secondary" data-act="savetoken">Guardar código</button></div>
  <div class="card" id="calcard"><b>Google Calendar</b><p class="mut">Tus reuniones aparecen en el banner de Hoy y en los avisos. En Google Calendar abre <i>Configuración del calendario → Integrar calendario → Dirección secreta en formato iCal</i> y pégala aquí. Solo se lee; no se cambia nada en tu calendario.</p>
    <p class="mut" data-cal-status>${Store.mode === 'api' ? (S.calConfigured ? `Conectado · ${calEvents.length} ${calEvents.length === 1 ? 'evento' : 'eventos'} hoy` : 'Sin conectar') : 'Disponible en la app desplegada en Cloudflare.'}</p>
    ${Store.mode === 'api' ? `<input id="set-cal" type="url" inputmode="url" autocomplete="off" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"><div class="gap"></div><button class="cb-btn cb-btn--secondary" data-act="calsave">Conectar calendario</button>${S.calConfigured ? '<div class="gap"></div><button class="cb-btn cb-btn--ghost" data-act="caldel">Desconectar</button>' : ''}` : ''}</div>
  <div class="card"><b>Zona horaria</b><label for="pf-tz">Ciudad / zona</label><input id="pf-tz" value="${esc(s.tz || C.tz)}" list="tzs" autocomplete="off"><datalist id="tzs"><option value="America/Guayaquil"><option value="America/Bogota"><option value="America/Lima"><option value="America/Mexico_City"><option value="America/Santiago"><option value="Europe/Madrid"></datalist></div>
  <div class="card"><b>Tus datos</b><p class="mut" data-store-status>${esc(Store.label())}</p><p class="mut">Tu ánimo, tus tareas, tus planes y lo que aprendo de ti se guardan en este dispositivo y, si conectas tu Worker, también en la nube.</p><button class="cb-btn cb-btn--secondary" data-act="relearn">Recalcular lo aprendido</button></div>
  <div class="card"><b>Notificaciones</b><p class="mut">La app puede avisarte mientras está abierta. Para alarmas aunque esté cerrada, descarga el calendario (.ics) y ábrelo en tu celular.</p>
    <button class="cb-btn" data-act="notif">${s.notif ? 'Notificaciones activadas' : 'Activar notificaciones'}</button><div class="gap"></div>
    <button class="cb-btn cb-btn--secondary" data-act="ics">Descargar alarmas (.ics)</button></div>
  <div class="card"><b>Pizarra física</b><p class="mut">Imprime la hoja con las tareas de tu semana.</p><a href="pizarra.html" target="_blank" rel="noopener">Abrir pizarra para imprimir</a></div>
  <div class="card"><b>Respaldo</b><p class="mut">Guarda tu plan y progreso o llévalos a otro dispositivo.</p>
    <button class="cb-btn cb-btn--secondary" data-act="export">Exportar datos</button><div class="gap"></div>
    <label class="cb-btn cb-btn--secondary" style="cursor:pointer">Importar datos<input type="file" id="imp" accept="application/json" hidden></label></div>
  <p class="mut" style="text-align:center">Cumbre · versión ${APP_VERSION}</p>
  <div class="card"><b>Reiniciar</b><button class="cb-btn cb-btn--danger" data-act="reset">Borrar todo</button></div>`;
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
  const v = { hoy: viewHoy, semana: viewSemana, metas: viewMetas, progreso: viewProgreso, mas: viewMas }[tab];
  $('#app').innerHTML = v();
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
  animateBars();
  if (tab === 'mas') { paintPush(); const t = $('#pf-tone'); if (t) t.value = S.settings.tonePref || 'auto'; }
}
document.addEventListener('click', e => {
  const pk = e.target.closest('[data-peek]');
  if (pk) {                                         // toque corto = detalle; si venía de una pulsación larga, no se abre
    if (peeked) { peeked = false; hidePeek(); return; }
    tab = 'progreso'; render(); window.scrollTo(0, 0); return;
  }
  const tb = e.target.closest('#tabs [data-tab]');
  if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  switch (act) {
    case 'rclose': case 'gcancel': closeSheet(); break;
    case 'reminders': openReminders(); break;
    case 'intake': openIntake(); break;
    case 'actset': { const it = agendaItems().find(x => x.id === id); if (it) setAct(it, el.dataset.v); break; }
    case 'agadd': {
      const t = ($('#ag-t').value || '').trim(), f = $('#ag-f').value, e = $('#ag-e').value;
      if (!t || !f || !e || e <= f) { toast('Pon un nombre y un horario válido'); break; }
      const cfg = S.settings.agenda = S.settings.agenda || {}; (cfg.extra = cfg.extra || []).push({ id: 'x' + uid(), t, from: f, to: e });
      save(); render(); toast('Actividad añadida'); break;
    }
    case 'agrm': { const cfg = S.settings.agenda || {}; (cfg.extra || []).splice(+id, 1); save(); render(); break; }
    case 'agreset': S.settings.agenda = {}; save(); render(); toast('Horarios base restablecidos'); break;
    case 'calsave': {
      const u = ($('#set-cal').value || '').trim(); if (!u) { toast('Pega la dirección iCal'); break; }
      fetch('api/calendar', { method: 'PUT', headers: { Authorization: 'Bearer ' + Store.token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u }) })
        .then(r => r.json()).then(j => { if (!j.ok) { toast(j.error || 'No se pudo conectar'); return; } toast('Calendario conectado'); return loadCal().then(() => render()); }).catch(() => toast('Sin conexión'));
      break;
    }
    case 'caldel': fetch('api/calendar', { method: 'DELETE', headers: { Authorization: 'Bearer ' + Store.token() } }).then(() => { calEvents = []; S.calConfigured = false; render(); toast('Calendario desconectado'); }); break;
    case 'intakesnooze': S.settings.intakeSnooze = todayStr(); save(); render(); break;
    case 'itkparse': {
      const el = $('#itk-text'); if (el) itk.text = el.value;
      if (!itk.text.trim()) { toast('Dime o escribe tus tareas primero'); break; }
      itk.items = Intake.parseTasks(itk.text, todayIdx()); drawIntake(); break;
    }
    case 'itkback': itk.items = null; drawIntake(); break;
    case 'itkrm': itk.items.splice(+id, 1); drawIntake(); break;
    case 'itkadd': addIntakeTasks(); break;
    case 'itkclose': itk = null; closeSheet(); break;
    case 'rdone': { toggleReminder(id); const open = !$('#overlay').hidden; render(); if (open) keepScroll(openReminders); break; }
    case 'radd': openReminderEditor(null); break;
    case 'redit': openReminderEditor(id); break;
    case 'rback': openReminders(); break;
    case 'rsave': {
      const d = red.draft;
      if (!(d.title || '').trim()) { toast('Escribe qué es'); break; }
      if (!d.date) { toast('Elige una fecha'); break; }
      putReminder({ id: red.id || uid(), title: d.title.trim(), date: d.date, time: d.time || '', important: !!d.important, note: (d.note || '').trim(), done: !!d.done });
      toast('Recordatorio guardado'); render(); openReminders(); break;
    }
    case 'rdel1': red.confirm = true; keepScroll(drawReminderEditor); break;
    case 'rdel0': red.confirm = false; keepScroll(drawReminderEditor); break;
    case 'rdel2': removeReminder(red.id); toast('Recordatorio eliminado'); render(); openReminders(); break;
    case 'gnew': openGoalEditor(null); break;
    case 'gedit': openGoalEditor(id); break;
    case 'gms': {
      const [gid, mid] = id.split(':'), g = S.goals[gid], m = g && (g.milestones || []).find(x => x.id === mid);
      if (m) { m.done = !m.done; putGoal(g); render(); if (m.done && goalPct(g) === 100) toast('¡Objetivo cumplido!'); }
      break;
    }
    case 'gseed': seedGoals(); render(); toast('Objetivos cargados: edítalos como quieras'); break;
    case 'gfilter': goalArea = id; render(); break;
    case 'gmadd': { const t = ($('#ge-newm').value || '').trim(); if (!t) { toast('Escribe el hito'); break; } ged.draft.milestones.push({ id: uid(), t, done: false, due: '' }); keepScroll(drawGoalEditor); break; }
    case 'gmdel': ged.draft.milestones.splice(+id, 1); keepScroll(drawGoalEditor); break;
    case 'gmtoggle': { const m = ged.draft.milestones[+id]; m.done = !m.done; keepScroll(drawGoalEditor); break; }
    case 'gsave': if (saveGoalDraft()) { closeSheet(); render(); toast('Objetivo guardado'); } break;
    case 'gdel1': ged.confirm = true; keepScroll(drawGoalEditor); break;
    case 'gdel0': ged.confirm = false; keepScroll(drawGoalEditor); break;
    case 'gdel2': removeGoal(ged.id); closeSheet(); render(); toast('Objetivo eliminado'); break;
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
    case 'task': { const f = findTask(id); if (f) setTask(id, !f.t.done); break; }
    case 'mood': {
      const r = rec(todayStr()); r.mood = +id; r.moodAt = hourNow(); (r.moods = r.moods || []).push({ n: +id, h: hourNow() }); if (r.moods.length > 12) r.moods.shift();
      save(); render(); showNotice(moodNotice(+id));
      if (navigator.vibrate) navigator.vibrate(12);
      break;
    }
    case 'closenotice': hideNotice(); break;
    case 'showall': showAll = true; render(); break;
    case 'lever': { const b = document.querySelector(`.cb-routine[data-id="${id}"]`); if (b) b.click(); break; }
    case 'savetoken': { Store.setToken(($('#set-token').value || '').trim()); toast('Código guardado'); Store.connect(S, applyRemote).then(() => { render(); loadCal(); }); break; }
    case 'pushon': Push.enable().then(() => { toast('Avisos activados'); paintPush(); }).catch(e => { toast(e.message); paintPush(); }); break;
    case 'pushoff': Push.disable().then(() => { toast('Avisos desactivados'); paintPush(); }); break;
    case 'pushtest': Push.test().then(() => toast('Prueba enviada')).catch(e => toast(e.message)); break;
    case 'relearn': save(); toast('Lo aprendido se actualizó'); render(); break;
    case 'askclaude': askClaude(); break;
    case 'goto': tab = id; render(); window.scrollTo(0, 0); break;
    case 'range': progRange = +id; render(); break;
    case 'share': {
      const st = streakInfo(), gs = liveGoals();
      const text = `Mi progreso en Cumbre: racha de ${st.n} días, nivel ${levelInfo().lvl} y ${hitosHechos()} hitos cumplidos en ${gs.length} ${gs.length === 1 ? 'meta' : 'metas'}.`;
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
    case 'fab': openTaskEditor(null, {}); break;
    case 'tadd': { if (/^d\d$/.test(id)) openTaskEditor(null, { day: +id[1], showDay: true }); else openTaskEditor(null, { block: id }); break; }
    case 'tedit': openTaskEditor(id, { showDay: tab === 'semana' }); break;
    case 'tblock': ted.draft.block = id; drawTaskEditor(); break;
    case 'tsave': saveTaskEditor(); break;
    case 'tdel1': ted.confirm = true; drawTaskEditor(); break;
    case 'tdel0': ted.confirm = false; drawTaskEditor(); break;
    case 'tdel2': removeTask(ted.id); ted = null; closeSheet(); render(); toast('Tarea eliminada'); break;
    case 'tclose': ted = null; closeSheet(); break;
    case 'check': openCheck(); break;
    case 'ckdone': setTask(id, true); drawCheck(); break;
    case 'ckno': chk.open = id; chk.day = null; chk.prio = null; drawCheck(); break;
    case 'ckcancel': chk.open = null; drawCheck(); break;
    case 'ckday': chk.day = id; drawCheck(); break;
    case 'ckprio': chk.prio = id; drawCheck(); break;
    case 'ckmove': {
      const f = findTask(chk.open), o = dayOptions().find(x => x.date === chk.day); if (!f || !o || !chk.prio) break;
      chk.moved.push({ t: f.t.title, when: o.label, p: PRIO[chk.prio][0].toLowerCase() });
      moveTask(chk.open, chk.day, chk.prio); chk.open = null; render(); drawCheck(); break;
    }
    case 'ckclose': closeSheet(); render(); break;
    case 'setsec': setSec = id; render(); window.scrollTo(0, 0); break;
    case 'notif': enableNotif(); break;
    case 'ics': downloadFile('cumbre-alarmas.ics', 'text/calendar', makeICS()); break;
    case 'export': downloadFile('cumbre-respaldo.json', 'application/json', JSON.stringify(S, null, 2)); break;
    case 'reset': if (confirm('¿Borrar todo tu progreso y plan?')) { S = fresh(); save(); render(); } break;
  }
});
function setGoalDraft(el) {
  const v = el.type === 'checkbox' ? el.checked : el.value, p = el.dataset.gb.split('.'), d = ged.draft;
  if (p[0] === 'm') d.milestones[+p[1]][p[2]] = v;
  else if (p[0] === 'target') { d.target = d.target || { label: '', unit: '', value: '', current: '' }; d.target[p[1]] = v; }
  else d[p[0]] = v;
}
function setRemDraft(el) { red.draft[el.dataset.rb] = el.type === 'checkbox' ? el.checked : el.value; }
// pulsación larga (vistazo) en los iconos de racha y nivel
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-peek]'); if (!b) return;
  peeked = false; peekStart = { x: e.clientX, y: e.clientY };
  clearTimeout(peekTimer); peekTimer = setTimeout(() => showPeek(b), 450);
});
document.addEventListener('pointermove', e => { if (peekStart && !peeked && Math.hypot(e.clientX - peekStart.x, e.clientY - peekStart.y) > 12) { clearTimeout(peekTimer); peekStart = null; } });
function endPeek() { clearTimeout(peekTimer); if (peeked) { hidePeek(); setTimeout(() => { peeked = false; }, 400); } peekStart = null; }
document.addEventListener('pointerup', endPeek);
document.addEventListener('pointercancel', endPeek);
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-peek]')) e.preventDefault(); });
document.addEventListener('keydown', e => {
  const b = e.target.closest && e.target.closest('[data-peek]');
  if (b && (e.key === 'i' || (e.key === 'Enter' && e.shiftKey))) { e.preventDefault(); showPeek(b); }
  else if (e.key === 'Escape') { hidePeek(); peeked = false; }
  if (e.target.matches && e.target.matches('.remind[role="button"]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openReminders(); }
});
document.addEventListener('keyup', e => { if (e.key === 'i' || e.key === 'Shift') { hidePeek(); peeked = false; } });
document.addEventListener('input', e => {
  if (e.target.dataset.gb && ged) setGoalDraft(e.target);
  if (e.target.dataset.rb && red) setRemDraft(e.target);
  if (e.target.dataset.ib && itk && itk.items) { const [i, k] = e.target.dataset.ib.split('.'); const t = itk.items[+i]; if (t) t[k] = (k === 'title' || k === 'block') ? e.target.value : +e.target.value; }
  if (e.target.dataset.tb && ted) ted.draft[e.target.dataset.tb] = e.target.dataset.tb === 'day' ? +e.target.value : e.target.value;
  if (e.target.id === 'pf-name') { S.settings.name = e.target.value.trim() || 'Esteban'; save(); }
  if (e.target.id === 'set-chk') { S.settings.checkAt = e.target.value; save(); }
  if (e.target.id === 'set-mam') { S.settings.moodAM = e.target.value; save(); }
  if (e.target.id === 'set-mpm') { S.settings.moodPM = e.target.value; save(); }
  if (e.target.id === 'set-bed') { S.settings.bedtime = e.target.value; save(); }
  if (e.target.id === 'set-redes') { S.settings.redes = +e.target.value || 0; save(); }
});
document.addEventListener('change', e => {
  if (e.target.dataset.ag || e.target.dataset.agx) setAgenda(e.target);
  if (e.target.dataset.gb && ged) setGoalDraft(e.target);
  if (e.target.dataset.rb && red) setRemDraft(e.target);
  if (e.target.dataset.ib && itk && itk.items) { const [i, k] = e.target.dataset.ib.split('.'); const t = itk.items[+i]; if (t) t[k] = (k === 'title' || k === 'block') ? e.target.value : +e.target.value; }
  if (e.target.dataset.tb && ted) ted.draft[e.target.dataset.tb] = e.target.dataset.tb === 'day' ? +e.target.value : e.target.value;
  if (e.target.id === 'pf-tone') { S.settings.tonePref = e.target.value; save(); toast('Guardado'); }
  if (e.target.id === 'pf-tz') { const tz = e.target.value.trim() || C.tz; try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); S.settings.tz = tz; save(); toast('Zona horaria guardada'); } catch (x) { toast('Esa zona horaria no existe'); } }
  if (e.target.id === 'imp' && e.target.files[0]) {
    const f = e.target.files[0], rd = new FileReader();
    rd.onload = () => { try { const o = JSON.parse(rd.result); if (o.v !== 1) throw 0; S = Object.assign(fresh(), o); save(); render(); toast('Datos importados'); } catch (x) { toast('Archivo no válido'); } };
    rd.readAsText(f);
  }
});

fetch('data/content.json').then(r => r.json()).then(j => {
  C = j; S = load(); render(); scheduleLocal(); drawNotice();
  setInterval(tickBlocks, 1000); document.addEventListener('visibilitychange', () => { tickBlocks(); drawNotice(); });
  Store.onChange = kind => {
    if (kind === 'status') { document.querySelectorAll('[data-store-status]').forEach(el => { el.textContent = Store.label(); }); return; }
    const a = document.activeElement;
    if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) && !$('#overlay').innerHTML) render();
  };
  Store.onConflict = onConflict;
  askFromUrl();
  Store.connect(S, applyRemote).then(ok => { if (ok) { save(); } render(); loadCal(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', ev => {
    if (!ev.data) return;
    if (ev.data.type === 'update') { try { if (!sessionStorage.getItem('upd:' + ev.data.cache)) { sessionStorage.setItem('upd:' + ev.data.cache, '1'); if (($('#overlay').hidden) && !document.activeElement.matches('input,textarea,select')) location.reload(); } } catch (e) { /* ignorar */ } }
    if (ev.data.type === 'refresh' && Store.mode === 'api') Store.pull();
    if (ev.data.type === 'open') { try { const u = new URL(ev.data.url); history.replaceState(null, '', u.pathname + u.search); } catch (e) { /* ignorar */ } askFromUrl(); }
  });
}).catch(() => { $('#app').innerHTML = '<p>No se pudo cargar el contenido. Abre la app desde un servidor web.</p>'; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
