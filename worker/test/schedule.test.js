import test from 'node:test';
import assert from 'node:assert/strict';
import { localParts, mondayOf, askList, nextActions, RETRY_MS, toSecs } from '../src/schedule.js';
import { content } from './helpers.js';

test('hora local en Quito (UTC-5, sin horario de verano)', () => {
  assert.deepEqual(localParts(Date.parse('2026-11-08T01:30:00Z'), 'America/Guayaquil'), { date: '2026-11-07', secs: 20 * 3600 + 30 * 60, wd: 5 });
  assert.deepEqual(localParts(Date.parse('2026-11-07T05:00:00Z'), 'America/Guayaquil'), { date: '2026-11-07', secs: 0, wd: 5 });
  assert.equal(mondayOf('2026-11-07'), '2026-11-02'); assert.equal(mondayOf('2026-11-02'), '2026-11-02'); assert.equal(mondayOf('2026-11-08'), '2026-11-02');
});

const T = hm => toSecs(hm);
const at = (hm, extraMs = 0) => ({ nowSecs: T(hm), nowMs: 1_000_000_000_000 + T(hm) * 1000 + extraMs });
const plan = { weekStart: '2026-11-02', tasks: [{ id: 't1', title: 'Enviar 5 mensajes', day: 5, block: 'pm', mins: 20 }, { id: 't2', title: 'Otra de otro día', day: 1, block: 'pm', mins: 20 }] };

test('la lista del día trae los hábitos con inicio y fin, sin tareas, ordenados por hora', () => {
  const items = askList({ content, day: { habits: { med: true } }, plan, wd: 5 });
  assert.ok(items.find(i => i.id === 'med').done);
  assert.ok(!items.find(i => i.id === 't1') && !items.find(i => i.id === 't1__s'), 'las tareas se revisan en el chequeo de la app, no por push');
  assert.equal(items.find(i => i.id === 'trote__s').askSecs, T('18:00'));
  assert.equal(items.find(i => i.id === 'trote').askSecs, T('18:45'));
  assert.deepEqual(items.map(i => i.askSecs), items.map(i => i.askSecs).sort((a, b) => a - b));
});

test('pregunta una vez, y a lo más una por minuto', () => {
  const items = askList({ content, day: {}, plan: null, wd: 5 });
  const a = nextActions({ items, asks: {}, ...at('07:01') });
  assert.deepEqual(a.send, [{ id: 'med__s', round: 0 }], 'primero lo que toca antes (07:00, inicio de meditar)');
  const asked = { med__s: { round: 0, at: at('07:01').nowMs, answered: null } };
  const b = nextActions({ items, asks: asked, ...at('07:16') });
  assert.deepEqual(b.send, [{ id: 'med', round: 0 }], 'al terminar, la siguiente');
  assert.ok(!b.send.some(s => s.id === 'med__s'), 'no repite la misma pregunta');
  const c = nextActions({ items, asks: {}, ...at('22:30') });
  assert.equal(c.send.length, 1, 'aunque haya varias pendientes, una por minuto');
});

test('no pregunta lo que ya está hecho, de madrugada ni lo que quedó muy atrás', () => {
  const done = askList({ content, day: { habits: { med: true } }, plan: null, wd: 5 });
  assert.ok(!nextActions({ items: done, asks: {}, ...at('07:15') }).send.some(s => s.id === 'med'));
  const items = askList({ content, day: {}, plan: null, wd: 5 });
  assert.equal(nextActions({ items, asks: {}, ...at('05:00') }).send.length, 0, 'horas de silencio');
  assert.equal(nextActions({ items, asks: {}, ...at('23:45') }).send.length, 0);
  assert.ok(!nextActions({ items, asks: {}, ...at('13:00') }).send.some(s => s.id === 'med'), 'med quedó 5 h atrás');
});

test('«No» → reintento a los 30 min; segundo «No» o sin respuesta → no cumplido', () => {
  const items = askList({ content, day: {}, plan: null, wd: 5 }).filter(i => i.id === 'med');
  const t0 = at('07:15').nowMs;
  const no0 = { med: { round: 0, at: t0, answered: 'no', answeredAt: t0 + 60000, retryAt: t0 + 60000 + RETRY_MS } };
  const only = r => r.send.filter(s => s.id === 'med');
  assert.equal(only(nextActions({ items, asks: no0, nowSecs: T('07:30'), nowMs: t0 + RETRY_MS })).length, 0, 'aún no pasan 30 min desde el «No»');
  assert.deepEqual(only(nextActions({ items, asks: no0, nowSecs: T('07:46'), nowMs: t0 + RETRY_MS + 61000 })), [{ id: 'med', round: 1 }]);
  const silent0 = { med: { round: 0, at: t0, answered: null } };
  assert.deepEqual(only(nextActions({ items, asks: silent0, nowSecs: T('07:46'), nowMs: t0 + RETRY_MS + 1 })), [{ id: 'med', round: 1 }], 'sin respuesta también se reintenta');
  const r1 = { med: { round: 1, at: t0 + RETRY_MS, answered: 'no' } };
  assert.deepEqual(nextActions({ items, asks: r1, nowSecs: T('07:50'), nowMs: t0 + RETRY_MS + 5000 }).miss, ['med']);
  const r1s = { med: { round: 1, at: t0 + RETRY_MS, answered: null } };
  assert.deepEqual(nextActions({ items, asks: r1s, nowSecs: T('08:20'), nowMs: t0 + 2 * RETRY_MS + 1 }).miss, ['med']);
  assert.equal(nextActions({ items, asks: { med: { round: 1, at: t0, final: true, missed: true } }, nowSecs: T('09:00'), nowMs: t0 + 4 * RETRY_MS }).miss.length, 0, 'ya final: no vuelve');
});

import { planDue, planPayload } from '../src/schedule.js';
test('lunes por la noche pide las tareas de la semana, una sola vez y solo si el plan está vacío', () => {
  const ok = { wd: 0, secs: T('20:30'), asks: {}, plan: null };
  assert.equal(planDue(ok), true);
  assert.equal(planDue({ ...ok, secs: T('19:59') }), false, 'antes de las 20:00 no');
  assert.equal(planDue({ ...ok, secs: T('22:01') }), false, 'después de las 22:00 no');
  assert.equal(planDue({ ...ok, wd: 1 }), false, 'solo los lunes');
  assert.equal(planDue({ ...ok, asks: { _plan: { at: 1 } } }), false, 'una sola vez');
  assert.equal(planDue({ ...ok, plan: { tasks: [{ id: 'a' }] } }), false, 'si ya hay tareas, no molesta');
  assert.equal(planDue({ ...ok, plan: { tasks: [] } }), true);
  assert.equal(planPayload('2026-11-09').data.url, '/?plan=1');
});

import Agenda from '../../app/agenda.js';
test('agenda: el trote es de 18:00 a 18:45 y a las 14:00 toca trabajo, no trote', () => {
  const items = Agenda.build({ content, settings: null, plan: null, wd: 1, cal: [] });
  assert.equal(Agenda.at(items, T('18:10')).current.id, 'trote');
  assert.equal(Agenda.at(items, T('18:10')).left, 35 * 60);
  assert.equal(Agenda.at(items, T('14:00')).current.id, 'work');
  assert.equal(Agenda.at(items, T('14:00')).next.id, 'trote');
  assert.equal(Agenda.at(items, T('19:30')).current.id, 'cena');
  assert.equal(Agenda.at(items, T('20:30')).current.id, 'noche');
  assert.equal(Agenda.at(Agenda.build({ content, settings: null, plan: null, wd: 5, cal: [] }), T('14:00')).current, null, 'el sábado no hay trabajo');
});
test('agenda: tus horarios, una actividad propia y una reunión del calendario mandan sobre lo demás', () => {
  const settings = { agenda: { over: { trote: { from: '17:30', to: '18:15' }, cena: { off: true } }, extra: [{ id: 'ingles', t: 'Inglés', from: '21:00', to: '21:30' }] } };
  const cal = [{ title: 'Reunión con cliente', from: T('17:45'), to: T('18:30') }];
  const items = Agenda.build({ content, settings, plan: null, wd: 2, cal });
  assert.equal(Agenda.at(items, T('17:40')).current.id, 'trote');
  assert.equal(Agenda.at(items, T('17:50')).current.kind, 'cal', 'la reunión manda');
  assert.ok(!items.find(i => i.id === 'cena'));
  assert.equal(Agenda.at(items, T('20:30')).current.id, 'noche');
  assert.equal(Agenda.at(items, T('21:10')).current.id, 'ingles', 'tu actividad propia manda sobre el bloque');
  assert.ok(!Agenda.build({ content, settings: null, plan: { tasks: [{ id: 'a', title: 'x', day: 2, block: 'pm' }] }, wd: 2, cal: [] }).some(i => i.id === 'a'), 'las tareas no llevan hora');
});
test('inicio y fin: la pregunta de inicio no se hace pasada la actividad ni si ya estás en ello', () => {
  const day = { acts: { trote: { st: 'on' } } };
  const items = askList({ content, day, plan: null, wd: 1 });
  assert.ok(items.find(i => i.id === 'trote__s').done && !items.find(i => i.id === 'trote').done);
  const fresh = askList({ content, day: {}, plan: null, wd: 1 });
  assert.deepEqual(nextActions({ items: fresh, asks: {}, nowSecs: T('18:05'), nowMs: 1e12 }).send.map(s => s.id), ['trote__s']);
  const late = nextActions({ items: fresh.filter(i => i.id === 'trote__s'), asks: {}, nowSecs: T('18:50'), nowMs: 1e12 });
  assert.equal(late.send.length, 0, 'terminó: ya no preguntes «¿empezaste?»');
});
