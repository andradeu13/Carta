/* Cron de cada minuto: pregunta «¿Lo hiciste?» por push y da por no cumplido lo que no se hizo. */
import { getDoc, getAsks, putAsks, getSub } from './kv.js';
import { getContent } from './content.js';
import { askList, nextActions, localParts, mondayOf } from './schedule.js';
import { signAnswer } from './auth.js';
import { sendPush } from './push.js';
import { markMissed } from './answer.js';

export async function buildPayload(env, item, round, date, nowMs) {
  const exp = nowMs + 12 * 3600 * 1000;
  const [sy, sn] = await Promise.all([signAnswer(env, date, item.id, round, exp, 'yes'), signAnswer(env, date, item.id, round, exp, 'no')]);
  const q = new URLSearchParams({ ask: item.id, d: date, r: String(round), e: String(exp), sy, sn });
  return {
    title: round === 0 ? '¿Lo hiciste?' : 'Última pregunta',
    body: round === 0 ? item.title : `${item.title} · ¿ya lo hiciste?`,
    tag: `ask-${date}-${item.id}`,
    actions: [{ action: 'yes', title: 'Sí, lo hice' }, { action: 'no', title: round === 0 ? 'No' : 'No pude' }],
    data: { date, id: item.id, round, exp, sy, sn, answer: '/api/answer', url: `/?${q}` }
  };
}

export async function tick(env, nowMs = Date.now(), { fetcher } = {}) {
  const sub = await getSub(env);
  if (!sub) return { skipped: 'sin suscripción' };
  const { date, secs, wd } = localParts(nowMs, env.TZ || 'America/Guayaquil');
  const [content, day, plan, asks] = await Promise.all([getContent(env, nowMs), getDoc(env, `days/${date}`), getDoc(env, `plans/${mondayOf(date)}`), getAsks(env, date)]);
  const items = askList({ content, day, plan, wd });
  const { send, miss } = nextActions({ items, asks, nowMs, nowSecs: secs });
  const out = { sent: null, missed: [] };
  let dirty = false;
  for (const id of miss) { asks[id].final = true; asks[id].missed = true; await markMissed(env, date, id, nowMs); out.missed.push(id); dirty = true; }
  if (send.length) {
    const s = send[0], item = items.find(x => x.id === s.id);
    const res = await sendPush(env, sub, await buildPayload(env, item, s.round, date, nowMs), { fetcher });
    if (res.gone) { await env.CUMBRE.delete('push:sub'); out.gone = true; }
    else if (res.ok) { asks[s.id] = { round: s.round, at: nowMs, answered: null }; out.sent = { id: s.id, round: s.round }; dirty = true; }
    else { out.error = res.status; }
  }
  if (dirty) await putAsks(env, date, asks);
  return out;
}
