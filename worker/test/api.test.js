import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/api.js';
import { tick } from '../src/tick.js';
import { getDoc, putDoc } from '../src/kv.js';
import { resetContentCache } from '../src/content.js';
import { RETRY_MS } from '../src/schedule.js';
import { makeEnv, makeSubscriber } from './helpers.js';

const DATE = '2026-11-07';                       // sábado (wd 5); su lunes es 2026-11-02
const at = hm => Date.parse(`${DATE}T${hm}:00-05:00`);
const call = (env, method, path, body, token = env.APP_TOKEN, now) => handle(new Request('https://cumbre.test' + path, { method, headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env, {}, { now });
const sj = async r => ({ status: r.status, ...(await r.json()) });

async function setup() {
  resetContentCache();
  const env = await makeEnv(), s = await makeSubscriber(), pushes = [];
  const fetcher = async (url, init) => { pushes.push({ url, init }); return new Response(null, { status: 201 }); };
  await call(env, 'POST', '/api/push/subscribe', s.sub);
  let lastNow = 0;
  const run = async ms => { lastNow = ms; const before = pushes.length; const out = await tick(env, ms, { fetcher }); const p = pushes.length > before ? await s.decrypt(pushes[pushes.length - 1].init.body) : null; return { out, p }; };
  const answer = async (p, a) => sj(await call(env, 'POST', '/api/answer', { d: p.data.date, i: p.data.id, r: p.data.round, e: p.data.exp, a, s: a === 'yes' ? p.data.sy : p.data.sn }, null, lastNow + 60000));
  return { env, s, pushes, run, answer, fetcher };
}

test('la API exige el token y valida las rutas', async () => {
  const { env } = await setup();
  assert.equal((await sj(await call(env, 'GET', '/api/ping', undefined, null))).ok, true);
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/days/2026-11-07', { habits: {} }, null))).status, 401);
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/days/2026-11-07', { habits: {} }, 'otro'))).status, 401);
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/secretos/x', { a: 1 }))).status, 400);
  for (const col of ['goals', 'reminders']) assert.equal((await sj(await call(env, 'PUT', `/api/doc/${col}/g1`, { title: 'x' }))).ok, true, col + ' se aceptan');
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/days/..%2Fx', { a: 1 }))).status, 400);
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/days/2026-11-07', [1]))).status, 400);
  assert.equal((await sj(await call(env, 'POST', '/api/push/subscribe', { endpoint: 'http://inseguro', keys: { p256dh: 'a', auth: 'b' } }))).status, 400);
});

test('documentos: guardar, listar por sello y rechazar escrituras viejas con 409', async () => {
  const { env } = await setup();
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/days/2026-11-06', { mood: 3, u: 1000 }))).ok, true);
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/days/2026-11-07', { mood: 4, u: 2000 }))).ok, true);
  const all = await sj(await call(env, 'GET', '/api/docs'));
  assert.deepEqual(Object.keys(all.docs).sort(), ['days/2026-11-06', 'days/2026-11-07']);
  const since = await sj(await call(env, 'GET', '/api/docs?since=1500'));
  assert.deepEqual(Object.keys(since.docs), ['days/2026-11-07']);
  const stale = await sj(await call(env, 'PUT', '/api/doc/days/2026-11-07', { mood: 1, u: 1500 }));
  assert.equal(stale.status, 409); assert.equal(stale.current.mood, 4, 'devuelve la versión vigente');
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/days/2026-11-07', { mood: 2, u: 3000 }))).ok, true);
});

test('el cron pregunta al empezar y al terminar; «Sí, estoy en ello» y luego «Sí» marcan la misión con sus XP', async () => {
  const { env, run, answer } = await setup();
  assert.equal((await run(at('06:59'))).p, null, 'antes de la hora no pregunta');
  const s0 = await run(at('07:00'));
  assert.deepEqual(s0.out.sent, { id: 'med__s', round: 0 });
  assert.match(s0.p.title, /¿Ya empezaste/); assert.match(s0.p.body, /07:00–07:15/);
  assert.deepEqual(s0.p.actions.map(a => a.title), ['Sí, estoy en ello', 'No']);
  const on = await answer(s0.p, 'yes');
  assert.equal(on.ok, true); assert.equal(on.phase, 'start'); assert.equal(on.xp, 0);
  assert.equal((await getDoc(env, `days/${DATE}`)).acts.med.st, 'on');
  const { out, p } = await run(at('07:15'));
  assert.deepEqual(out.sent, { id: 'med', round: 0 });
  assert.equal(p.title, '¿Lo cumpliste?'); assert.match(p.body, /meditar/i);
  assert.deepEqual(p.actions.map(a => a.action), ['yes', 'no']);
  const r = await answer(p, 'yes');
  assert.equal(r.ok, true); assert.equal(r.xp, 15);
  const day = await getDoc(env, `days/${DATE}`);
  assert.equal(day.habits.med, true); assert.equal(day.acts.med.st, 'done'); assert.equal(day.xp, 15); assert.ok(day.times.med > 0 && day.times.med < 24); assert.ok(day.u);
  assert.equal((await getDoc(env, 'meta/main')).xp, 15);
  assert.equal((await answer(p, 'yes')).reason, 'stale', 'una respuesta no se puede repetir');
  { const n = (await run(at('07:16'))).out.sent; assert.ok(!n || n.id !== 'med', 'ya hecha: no vuelve a preguntar'); }
});

test('la agenda usa tus horarios y tu calendario: una reunión se pregunta al terminar solo si la agregaste como actividad propia', async () => {
  const { env, run, answer } = await setup();
  await putDoc(env, 'meta/main', { xp: 0, settings: { agenda: { over: { trote: { from: '17:00', to: '17:30' } }, extra: [{ id: 'ingles', t: 'Inglés', from: '16:45', to: '17:10' }] } } }, 1);
  const a = await run(at('17:00'));
  assert.equal(a.out.sent.id, 'ingles__s', 'lo que empezó antes se pregunta primero (16:45)');
  await answer(a.p, 'yes');
  const b = await run(at('17:01'));
  assert.equal(b.out.sent.id, 'trote__s', 'trote ahora empieza a las 17:00');
  const c = await run(at('17:11'));
  assert.equal(c.out.sent.id, 'ingles'); assert.match(c.p.body, /16:45–17:10/);
  const r = await answer(c.p, 'yes');
  assert.equal(r.xp, 10);
  assert.equal((await getDoc(env, `days/${DATE}`)).acts.ingles.st, 'done');
});

test('«No» al empezar → reintento a los 30 min; al terminar la actividad queda como no cumplida y no se vuelve a preguntar', async () => {
  const { env, run, answer } = await setup();
  const a = await run(at('07:00'));
  assert.deepEqual(await answer(a.p, 'no').then(r => ({ ok: r.ok, retry: r.retry, phase: r.phase })), { ok: true, retry: true, phase: 'start' });
  const hab = {}; (await import('./helpers.js')).content.habits.forEach(h => { if (h.id !== 'med') hab[h.id] = true; });
  await putDoc(env, `days/${DATE}`, { ...(await getDoc(env, `days/${DATE}`)), habits: hab }, 5);
  assert.ok(!(await run(at('07:01'))).out.sent, 'aún no pasan 30 min');
  const late = await run(at('07:16'));
  assert.ok(late.out.missed.includes('med__s'), 'terminó la actividad: la pregunta de inicio se da por no cumplida');
  assert.notEqual(late.out.sent && late.out.sent.id, 'med__s');
});

test('calendario: guardar la dirección, leer eventos del día y que falle sin romper nada', async () => {
  const { env } = await setup();
  const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=America/Guayaquil:20261107T150000\nDTEND;TZID=America/Guayaquil:20261107T160000\nSUMMARY:Reunión\nEND:VEVENT\nEND:VCALENDAR';
  const calFetcher = async () => new Response(ics, { status: 200 });
  const get = (u = '/api/calendar?date=2026-11-07') => handle(new Request('https://cumbre.test' + u, { headers: { Authorization: `Bearer ${env.APP_TOKEN}` } }), env, {}, { calFetcher, now: at('12:00') });
  assert.deepEqual((await sj(await get())).events, [], 'sin calendario configurado');
  assert.equal((await sj(await call(env, 'PUT', '/api/calendar', { url: 'http://inseguro.com/x.ics' }))).status, 400);
  assert.equal((await sj(await call(env, 'PUT', '/api/calendar', { url: 'https://localhost/x.ics' }))).status, 400);
  assert.equal((await sj(await call(env, 'PUT', '/api/calendar', { url: 'webcal://calendar.google.com/calendar/ical/x/private-abc/basic.ics' }))).ok, true);
  assert.equal(await env.CUMBRE.get('cal:url'), 'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics');
  const ev = await sj(await get());
  assert.equal(ev.configured, true); assert.deepEqual(ev.events, [{ title: 'Reunión', from: 54000, to: 57600 }]);
  assert.equal((await sj(await call(env, 'GET', '/api/calendar', undefined, null))).status, 401, 'exige el código');
  const docs = await sj(await call(env, 'GET', '/api/docs'));
  assert.ok(!JSON.stringify(docs).includes('private-abc'), 'la dirección secreta no viaja en los documentos');
});

test('firmas: manipuladas, cambiadas de sí a no o caducadas se rechazan', async () => {
  const { env, run } = await setup();
  const { p } = await run(at('07:05'));
  const nowS = at('07:05') + 60000, post = body => call(env, 'POST', '/api/answer', body, null, nowS);
  const base = { d: p.data.date, i: p.data.id, r: p.data.round, e: p.data.exp };
  assert.equal((await sj(await post({ ...base, a: 'no', s: p.data.sy }))).status, 403, 'firma de «sí» no vale para «no»');
  assert.equal((await sj(await post({ ...base, i: 'salmo', a: 'yes', s: p.data.sy }))).status, 403, 'otra misión');
  assert.equal((await sj(await post({ ...base, a: 'yes', s: 'xx' }))).status, 403);
  assert.equal((await sj(await post({ ...base, e: 5, a: 'yes', s: p.data.sy }))).status, 403);
  assert.equal((await sj(await post({ ...base, a: 'talvez', s: p.data.sy }))).status, 403);
  assert.equal((await getDoc(env, `days/${DATE}`)), null, 'nada se guardó');
});

test('«No» al terminar → reintento a los 30 min → otro «No» deja la misión como no cumplida', async () => {
  const { env, run, answer } = await setup();
  const hab = {}, acts = {}; (await import('./helpers.js')).content.habits.forEach(h => { if (h.id !== 'med') hab[h.id] = true; acts[h.id] = { st: 'on' }; });
  await putDoc(env, `days/${DATE}`, { habits: hab, acts, tasksDone: 0, mood: 0 }, 1);      // todo lo demás resuelto: aísla «med»
  const a = await run(at('07:15'));
  assert.equal(a.out.sent.id, 'med');
  assert.deepEqual(await answer(a.p, 'no').then(r => ({ ok: r.ok, retry: r.retry })), { ok: true, retry: true });
  { const n = (await run(at('07:15') + RETRY_MS - 120000)).out.sent; assert.ok(!n || n.id !== 'med', 'todavía no pasan 30 min'); }
  const b = await run(at('07:15') + RETRY_MS + 130000);
  assert.deepEqual(b.out.sent, { id: 'med', round: 1 }); assert.equal(b.p.title, 'Última pregunta');
  assert.equal((await answer(b.p, 'no')).ok, true);
  const day = await getDoc(env, `days/${DATE}`);
  assert.equal(day.missed.med, true); assert.ok(!day.habits.med);
  const next = await run(at('07:15') + RETRY_MS + 180000);
  assert.deepEqual(next.out.missed, [], 'el cron no repite lo ya cerrado');
  assert.ok(!next.out.sent || next.out.sent.id !== 'med', 'no vuelve a preguntar');
});

test('sin respuesta tampoco se insiste para siempre', async () => {
  const { env, run } = await setup();
  const a = await run(at('07:16'));
  assert.equal(a.out.sent.id, 'med');
  let n = 0;
  for (let t = 2; t < 40 && n < 40; t++) { await run(at('07:16') + t * 61000); n++; }
  const asks = await env.CUMBRE.get(`asks:${DATE}`, 'json');
  assert.ok(Object.values(asks).every(e => e.round <= 1), 'nunca pasa de dos preguntas por misión');
});

test('las tareas del plan NO se preguntan por push: se revisan en el chequeo de la app', async () => {
  const { env, run } = await setup();
  await putDoc(env, 'plans/2026-11-02', { weekStart: '2026-11-02', priorities: [], tasks: [{ id: 'tk1', title: 'Enviar 5 mensajes', day: 5, block: 'pm', mins: 20, done: null }], team: [] }, 1);
  const habits = {}; (await import('./helpers.js')).content.habits.forEach(h => { habits[h.id] = true; });
  await putDoc(env, `days/${DATE}`, { habits, tasksDone: 0, mood: 0 }, 1);
  assert.equal((await run(at('20:30'))).out.sent, null);
  assert.equal((await run(at('22:00'))).out.sent, null);
});

test('una suscripción caducada (410) se borra y el push de prueba responde', async () => {
  const { env, s } = await setup();
  const gone = async () => new Response(null, { status: 410 });
  const out = await tick(env, at('07:00'), { fetcher: gone });
  assert.equal(out.gone, true);
  assert.equal(await env.CUMBRE.get('push:sub'), null);
  assert.equal((await sj(await call(env, 'POST', '/api/push/test', {}))).status, 409, 'sin suscripción');
  assert.equal((await tick(env, at('07:01'), { fetcher: gone })).skipped, 'sin suscripción');
  assert.ok(s);
});

test('objetivos: una lápida reemplaza al documento y se sincroniza (no reaparece)', async () => {
  const { env } = await setup();
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/goals/g1', { id: 'g1', title: 'Cumbre', milestones: [{ id: 'm1', t: 'Reservar', done: false }], u: 1000 }))).ok, true);
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/goals/g1', { id: 'g1', deleted: true, u: 2000 }))).ok, true);
  const all = await sj(await call(env, 'GET', '/api/docs'));
  assert.deepEqual(all.docs['goals/g1'], { id: 'g1', deleted: true, u: 2000 });
  assert.equal((await sj(await call(env, 'PUT', '/api/doc/goals/g1', { id: 'g1', title: 'viejo', u: 1500 }))).status, 409, 'una copia vieja no revive el objetivo');
  const since = await sj(await call(env, 'GET', '/api/docs?since=1999'));
  assert.deepEqual(Object.keys(since.docs), ['goals/g1']);
});

test('Apple Fitness: un entrenamiento de correr cuenta como el trote, una sola vez, y exige el código', async () => {
  const { env } = await setup();
  const body = { type: 'Correr', minutes: '32', km: '5,2', id: 'w1', date: DATE };
  assert.equal((await sj(await call(env, 'POST', '/api/workout', body, null))).status, 401);
  assert.equal((await sj(await call(env, 'POST', '/api/workout', { type: 'Correr', minutes: 0 }, undefined, at('19:00')))).status, 400);
  const r = await sj(await call(env, 'POST', '/api/workout', body, undefined, at('19:00')));
  assert.equal(r.ok, true); assert.equal(r.counted, true); assert.equal(r.xp, 25);
  const day = await getDoc(env, `days/${DATE}`);
  assert.equal(day.habits.trote, true); assert.equal(day.acts.trote.st, 'done'); assert.equal(day.workouts[0].km, 5.2); assert.equal(day.workouts[0].mins, 32);
  assert.equal((await sj(await call(env, 'POST', '/api/workout', body, undefined, at('19:01')))).duplicate, true, 'no se cuenta dos veces');
  const y = await sj(await call(env, 'POST', '/api/workout', { type: 'Yoga', minutes: 40, id: 'w2', date: DATE }, undefined, at('20:00')));
  assert.equal(y.counted, false, 'yoga se guarda pero no es trote'); assert.equal((await getDoc(env, `days/${DATE}`)).workouts.length, 2);
});
