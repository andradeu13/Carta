/* Aplica una respuesta («Sí» / «No») a los mismos documentos que usa la app. */
import { getDoc, putDoc, getAsks, putAsks, docKey } from './kv.js';
import { getContent } from './content.js';
import { localParts, mondayOf, RETRY_MS, START } from './schedule.js';

const newDay = () => ({ habits: {}, tasksDone: 0, mood: 0, sent: 0, replies: 0, demos: 0, sales: 0, revenue: 0 });

/* Marca una misión como hecha; devuelve los XP sumados (0 si ya estaba hecha o no existe). */
async function complete(env, content, date, id, nowMs) {
  const day = (await getDoc(env, `days/${date}`)) || newDay();
  const hour = +(localParts(nowMs, env.TZ || 'America/Guayaquil').secs / 3600).toFixed(2);
  let xp = 0;
  const habit = content.habits.find(h => h.id === id);
  if (habit) {
    if (!day.habits[id]) { day.habits[id] = true; xp = habit.xp; }
  } else {
    const path = `plans/${mondayOf(date)}`, plan = await getDoc(env, path);
    const task = plan && (plan.tasks || []).find(t => t.id === id);
    if (task && !task.done) { task.done = date; day.tasksDone = (day.tasksDone || 0) + 1; xp = 20 + Math.round((task.mins || 0) / 5); await putDoc(env, path, plan, nowMs); }
    else if (!task && !(day.acts && day.acts[id] && day.acts[id].st === 'done')) xp = 10;       // actividad propia de tu agenda
  }
  (day.acts = day.acts || {})[id] = { st: 'done', at: hour };
  if (!xp) { await putDoc(env, `days/${date}`, day, nowMs); return 0; }
  (day.times = day.times || {})[id] = hour;
  if (day.missed) delete day.missed[id];
  day.xp = (day.xp || 0) + xp;
  await putDoc(env, `days/${date}`, day, nowMs);
  const meta = (await getDoc(env, 'meta/main')) || {};
  meta.xp = (meta.xp || 0) + xp;
  await putDoc(env, 'meta/main', meta, nowMs);
  return xp;
}

export async function markMissed(env, date, id, nowMs) {
  const day = (await getDoc(env, `days/${date}`)) || newDay();
  day.missed = day.missed || {};
  day.missed[id] = true;
  (day.acts = day.acts || {})[id] = { st: 'missed' };
  await putDoc(env, `days/${date}`, day, nowMs);
}

/* «Estoy en ello»: marca la actividad como en curso. */
async function markOn(env, date, id, nowMs) {
  const day = (await getDoc(env, `days/${date}`)) || newDay();
  if (day.acts && day.acts[id] && day.acts[id].st === 'done') return;
  (day.acts = day.acts || {})[id] = { st: 'on', at: +(localParts(nowMs, env.TZ || 'America/Guayaquil').secs / 3600).toFixed(2) };
  if (day.missed) delete day.missed[id];
  await putDoc(env, `days/${date}`, day, nowMs);
}

/* Devuelve { ok, reason?, xp?, phase }. `r` es la ronda de la pregunta a la que se responde.
   Las preguntas de inicio llevan el sufijo `__s`: «Sí» = estoy en ello; dos «No» = no la haré hoy. */
export async function handleAnswer(env, { d, i, r, a }, nowMs = Date.now()) {
  const asks = await getAsks(env, d);
  const e = asks[i];
  if (!e || e.final || e.answered || e.round !== +r) return { ok: false, reason: 'stale' };
  const start = i.endsWith(START), base = start ? i.slice(0, -START.length) : i;
  e.answered = a; e.answeredAt = nowMs;
  let xp = 0;
  if (a === 'yes') {
    if (start) await markOn(env, d, base, nowMs); else xp = await complete(env, await getContent(env, nowMs), d, base, nowMs);
    e.done = true; e.final = true;
  } else if (+r === 0) {
    e.retryAt = nowMs + RETRY_MS;
  } else {
    e.final = true; e.missed = true;
    await markMissed(env, d, base, nowMs);
  }
  await putAsks(env, d, asks);
  return { ok: true, answer: a, xp, phase: start ? 'start' : 'end', retry: a === 'no' && +r === 0 };
}
