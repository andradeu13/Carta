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

test('el cron pregunta por push cifrado y «Sí» marca la misión con sus XP', async () => {
  const { env, run, answer } = await setup();
  assert.equal((await run(at('06:49'))).p, null, 'antes de la hora no pregunta');
  const { out, p } = await run(at('06:50'));
  assert.deepEqual(out.sent, { id: 'prior', round: 0 });
  assert.equal(p.title, '¿Lo hiciste?'); assert.match(p.body, /prioridades/i);
  assert.deepEqual(p.actions.map(a => a.action), ['yes', 'no']);
  const r = await answer(p, 'yes');
  assert.equal(r.ok, true); assert.equal(r.xp, 10);
  const day = await getDoc(env, `days/${DATE}`);
  assert.equal(day.habits.prior, true); assert.equal(day.xp, 10); assert.ok(day.times.prior > 0 && day.times.prior < 24); assert.ok(day.u);
  assert.equal((await getDoc(env, 'meta/main')).xp, 10);
  assert.equal((await answer(p, 'yes')).reason, 'stale', 'una respuesta no se puede repetir');
  { const n = (await run(at('06:51'))).out.sent; assert.ok(!n || n.id !== 'prior', 'ya hecha: no vuelve a preguntar'); }
});

test('firmas: manipuladas, cambiadas de sí a no o caducadas se rechazan', async () => {
  const { env, run } = await setup();
  const { p } = await run(at('06:50'));
  const nowS = at('06:50') + 60000, post = body => call(env, 'POST', '/api/answer', body, null, nowS);
  const base = { d: p.data.date, i: p.data.id, r: p.data.round, e: p.data.exp };
  assert.equal((await sj(await post({ ...base, a: 'no', s: p.data.sy }))).status, 403, 'firma de «sí» no vale para «no»');
  assert.equal((await sj(await post({ ...base, i: 'med', a: 'yes', s: p.data.sy }))).status, 403, 'otra misión');
  assert.equal((await sj(await post({ ...base, a: 'yes', s: 'xx' }))).status, 403);
  assert.equal((await sj(await post({ ...base, e: 5, a: 'yes', s: p.data.sy }))).status, 403);
  assert.equal((await sj(await post({ ...base, a: 'talvez', s: p.data.sy }))).status, 403);
  assert.equal((await getDoc(env, `days/${DATE}`)), null, 'nada se guardó');
});

test('«No» → reintento a los 30 min → otro «No» deja la misión como no cumplida', async () => {
  const { env, run, answer } = await setup();
  const first = await run(at('07:15') - 25 * 60000);           // 06:50 → prior
  await answer(first.p, 'yes');                                  // deja prior hecha para aislar med
  const a = await run(at('07:15'));
  assert.equal(a.out.sent.id, 'med');
  assert.deepEqual(await answer(a.p, 'no').then(r => ({ ok: r.ok, retry: r.retry })), { ok: true, retry: true });
  { const n = (await run(at('07:15') + RETRY_MS - 120000)).out.sent; assert.ok(!n || n.id !== 'med', 'todavía no pasan 30 min'); }
  // «salmo» (07:20) se pregunta en medio; se responde «sí» para que no estorbe
  for (let t = 3; t < 60; t++) { const x = await run(at('07:15') + RETRY_MS - 120000 + t * 1000); if (x.out.sent && x.out.sent.id !== 'med') await answer(x.p, 'yes'); }
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
  const a = await run(at('07:15'));                              // pregunta prior (lo primero)
  assert.equal(a.out.sent.id, 'prior');
  const b = await run(at('07:15') + RETRY_MS + 1000);
  assert.ok(b.out.sent);                                          // reintento de prior o la siguiente
  let last, n = 0;
  for (let t = 2; t < 40 && n < 40; t++) { last = await run(at('07:15') + t * 61000); n++; }
  const asks = await env.CUMBRE.get(`asks:${DATE}`, 'json');
  assert.ok(Object.values(asks).every(e => e.round <= 1), 'nunca pasa de dos preguntas por misión');
});

test('las tareas del plan se preguntan al cerrar su bloque y «Sí» las marca con sus XP', async () => {
  const { env, run, answer } = await setup();
  await putDoc(env, 'plans/2026-11-02', { weekStart: '2026-11-02', priorities: [], tasks: [{ id: 'tk1', title: 'Enviar 5 mensajes a barberías', day: 5, block: 'pm', mins: 20, done: null }, { id: 'tk2', title: 'De otro día', day: 1, block: 'pm', mins: 20, done: null }], team: [] }, 1);
  const habits = {}; (await import('./helpers.js')).content.habits.forEach(h => { habits[h.id] = true; });
  await putDoc(env, `days/${DATE}`, { habits, tasksDone: 0, mood: 0 }, 1);
  const { out, p } = await run(at('22:00'));
  assert.deepEqual(out.sent, { id: 'tk1', round: 0 });
  assert.match(p.body, /barberías/);
  const r = await answer(p, 'yes');
  assert.equal(r.xp, 24);
  assert.equal((await getDoc(env, 'plans/2026-11-02')).tasks[0].done, DATE);
  assert.equal((await getDoc(env, `days/${DATE}`)).tasksDone, 1);
  assert.equal((await getDoc(env, 'plans/2026-11-02')).tasks[1].done, null);
});

test('una suscripción caducada (410) se borra y el push de prueba responde', async () => {
  const { env, s } = await setup();
  const gone = async () => new Response(null, { status: 410 });
  const out = await tick(env, at('06:50'), { fetcher: gone });
  assert.equal(out.gone, true);
  assert.equal(await env.CUMBRE.get('push:sub'), null);
  assert.equal((await sj(await call(env, 'POST', '/api/push/test', {}))).status, 409, 'sin suscripción');
  assert.equal((await tick(env, at('06:51'), { fetcher: gone })).skipped, 'sin suscripción');
  assert.ok(s);
});
