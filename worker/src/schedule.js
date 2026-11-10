/* Qué preguntar y cuándo. Todo son funciones puras para poder probarlas sin Cloudflare. */
export const RETRY_MS = 30 * 60 * 1000;     // «No» o sin respuesta: se vuelve a preguntar a los 30 min
export const MAX_AGE_S = 3 * 3600;          // no se pregunta lo que quedó más de 3 h atrás (p. ej. al activar tarde)
export const MAX_PER_DAY = 14;
const QUIET_FROM = 6 * 3600 + 30 * 60, QUIET_TO = 23 * 3600 + 30 * 60;

import Agenda from '../../app/agenda.js';

export const toSecs = hm => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60; };

/* Fecha, segundos desde medianoche y día de la semana (lunes = 0) en la zona horaria `tz`. */
export function localParts(nowMs, tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  const g = t => p.find(x => x.type === t).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { date, secs: +g('hour') * 3600 + +g('minute') * 60 + +g('second'), wd };
}
export function mondayOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/* Actividades del día que se preguntan. Cada una tiene dos preguntas: al empezar («¿Ya empezaste?», id `<id>__s`)
   y al terminar («¿Lo cumpliste?», id `<id>`). La agenda sale de `Agenda.build` (horario base + ajustes + plan + calendario). */
export const START = '__s';
export function askList({ content, day, plan, wd, settings, cal }) {
  const items = [];
  const habits = (day && day.habits) || {}, acts = (day && day.acts) || {}, missed = (day && day.missed) || {};
  for (const a of Agenda.build({ content, settings, plan, wd, cal })) {
    if (!a.ask) continue;
    const task = a.taskId && ((plan && plan.tasks) || []).find(t => t.id === a.taskId);
    const done = !!(a.habit ? habits[a.habit] : task ? task.done : (acts[a.id] && acts[a.id].st === 'done'));
    const gone = done || !!missed[a.id] || !!(acts[a.id] && acts[a.id].st === 'missed');
    const base = { kind: a.habit ? 'habit' : a.taskId ? 'task' : 'custom', title: a.t, from: a.from, to: a.to, xp: a.xp };
    items.push({ ...base, id: a.id + START, base: a.id, phase: 'start', askSecs: a.from, until: a.to, done: gone || !!(acts[a.id] && acts[a.id].st === 'on') });
    items.push({ ...base, id: a.id, base: a.id, phase: 'end', askSecs: a.to, done: gone });
  }
  return items.sort((x, y) => x.askSecs - y.askSecs);
}

/* Decide, para este minuto, qué preguntar (como mucho una) y qué dar por no cumplido. */
export function nextActions({ items, asks, nowMs, nowSecs }) {
  const send = [], miss = [];
  if (nowSecs < QUIET_FROM || nowSecs > QUIET_TO) return { send, miss };
  const sent = Object.values(asks).filter(a => a.round !== undefined).length;
  for (const it of items) {
    if (it.done) continue;
    const a = asks[it.id];
    if (a && (a.final || a.done)) continue;
    const late = it.until !== undefined && nowSecs > it.until;     // la pregunta de inicio ya no tiene sentido pasada la actividad
    if (!a) {
      if (!late && nowSecs >= it.askSecs && nowSecs - it.askSecs <= MAX_AGE_S) send.push({ id: it.id, round: 0 });
    } else if (a.round === 0) {
      const due = a.answered === 'no' ? a.retryAt : a.at + RETRY_MS;
      if (late) miss.push(it.id);
      else if (nowMs >= due) send.push({ id: it.id, round: 1 });
    } else if (a.round === 1) {
      if (a.answered === 'no' || (!a.answered && nowMs >= a.at + RETRY_MS)) miss.push(it.id);
    }
  }
  return { send: sent >= MAX_PER_DAY ? [] : send.slice(0, 1), miss };
}

/* Lunes entre las 20:00 y las 22:00: pedir las tareas de la semana, una sola vez y solo si el plan está vacío. */
export const PLAN_FROM = 20 * 3600, PLAN_TO = 22 * 3600;
export function planDue({ wd, secs, asks, plan }) {
  if (wd !== 0 || secs < PLAN_FROM || secs > PLAN_TO) return false;
  if (asks._plan) return false;
  return !(plan && plan.tasks && plan.tasks.length);
}
export const planPayload = date => ({
  title: 'Pizarra semanal',
  body: 'Es lunes por la noche: anota las tareas de esta semana y las ordeno por día.',
  tag: `plan-${date}`,
  actions: [],
  data: { date, url: '/?plan=1' }
});
