/* Cron de cada minuto: pregunta «¿Lo hiciste?» por push y da por no cumplido lo que no se hizo. */
import { getDoc, getAsks, putAsks, getSub } from './kv.js';
import { getContent } from './content.js';
import { askList, nextActions, localParts, mondayOf, planDue, planPayload, START } from './schedule.js';
import { calEvents } from './calendar.js';
import Agenda from '../../app/agenda.js';
import { signAnswer } from './auth.js';
import { sendPush } from './push.js';
import { markMissed } from './answer.js';

export async function buildPayload(env, item, round, date, nowMs) {
  const exp = nowMs + 12 * 3600 * 1000;
  const [sy, sn] = await Promise.all([signAnswer(env, date, item.id, round, exp, 'yes'), signAnswer(env, date, item.id, round, exp, 'no')]);
  const q = new URLSearchParams({ ask: item.id, d: date, r: String(round), e: String(exp), sy, sn });
  const hh = `${Agenda.hhmm(item.from)}–${Agenda.hhmm(item.to)}`;
  const start = item.phase === 'start';
  return {
    title: start ? (round === 0 ? `¿Ya empezaste ${item.title}?` : `${item.title}: ¿estás en ello?`) : (round === 0 ? '¿Lo cumpliste?' : 'Última pregunta'),
    body: start ? `${hh} · ${item.title}` : (round === 0 ? `${item.title} (${hh})` : `${item.title} · ¿ya lo hiciste?`),
    tag: `ask-${date}-${item.id}`,
    actions: start ? [{ action: 'yes', title: 'Sí, estoy en ello' }, { action: 'no', title: round === 0 ? 'No' : 'No lo haré' }] : [{ action: 'yes', title: 'Sí, lo cumplí' }, { action: 'no', title: round === 0 ? 'No' : 'No pude' }],
    data: { date, id: item.id, round, exp, sy, sn, answer: '/api/answer', url: `/?${q}` }
  };
}

export async function tick(env, nowMs = Date.now(), { fetcher, calFetcher } = {}) {
  const sub = await getSub(env);
  if (!sub) return { skipped: 'sin suscripción' };
  const { date, secs, wd } = localParts(nowMs, env.TZ || 'America/Guayaquil');
  const [content, day, plan, asks, meta, cal] = await Promise.all([getContent(env, nowMs), getDoc(env, `days/${date}`), getDoc(env, `plans/${mondayOf(date)}`), getAsks(env, date), getDoc(env, 'meta/main'), calEvents(env, date, nowMs, { fetcher: calFetcher })]);
  const items = askList({ content, day, plan, wd, settings: meta && meta.settings, cal: cal.events });
  const { send, miss } = nextActions({ items, asks, nowMs, nowSecs: secs });
  const out = { sent: null, missed: [] };
  let dirty = false;
  for (const id of miss) {
    asks[id].final = true; dirty = true;
    if (id.endsWith(START)) { if (asks[id].answered === 'no') { asks[id].missed = true; await markMissed(env, date, id.slice(0, -START.length), nowMs); out.missed.push(id); } continue; }   // sin respuesta al inicio: solo se deja de insistir
    asks[id].missed = true; await markMissed(env, date, id, nowMs); out.missed.push(id);
  }
  if (send.length) {
    const s = send[0], item = items.find(x => x.id === s.id);
    const res = await sendPush(env, sub, await buildPayload(env, item, s.round, date, nowMs), { fetcher });
    if (res.gone) { await env.CUMBRE.delete('push:sub'); out.gone = true; }
    else if (res.ok) { asks[s.id] = { round: s.round, at: nowMs, answered: null }; out.sent = { id: s.id, round: s.round }; dirty = true; }
    else { out.error = res.status; }
  }
  // Lunes por la noche: una sola vez pregunta qué tareas hay esta semana (si el plan aún está vacío).
  if (!out.sent && planDue({ wd, secs, asks, plan })) {
    const res = await sendPush(env, sub, planPayload(date), { fetcher });
    if (res.gone) { await env.CUMBRE.delete('push:sub'); out.gone = true; }
    else if (res.ok) { asks._plan = { at: nowMs }; out.sent = { id: '_plan', round: 0 }; dirty = true; }
    else { out.error = res.status; }
  }
  if (dirty) await putAsks(env, date, asks);
  return out;
}
