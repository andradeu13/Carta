import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { encryptPayload, vapidHeader, sendPush } from '../src/push.js';
import { b64u } from '../src/b64.js';
import { makeEnv, makeSubscriber } from './helpers.js';

test('el cifrado aes128gcm hace ida y vuelta con un suscriptor independiente', async () => {
  const s = await makeSubscriber();
  const msg = { title: '¿Lo hiciste?', body: 'Meditar con tu tip de energía', data: { n: [1, 2, 3] } };
  const body = await encryptPayload(s.sub, new TextEncoder().encode(JSON.stringify(msg)));
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096, 'tamaño de registro');
  assert.equal(body[20], 65, 'largo de la clave pública');
  assert.deepEqual(await s.decrypt(body), msg);
  const otro = await makeSubscriber();
  await assert.rejects(otro.decrypt(body), 'otro suscriptor no puede leerlo');
});

test('cada mensaje usa sal y clave efímera distintas', async () => {
  const s = await makeSubscriber(), p = new TextEncoder().encode('hola');
  const a = await encryptPayload(s.sub, p), b = await encryptPayload(s.sub, p);
  assert.notDeepEqual(a.slice(0, 16), b.slice(0, 16));
  assert.notDeepEqual(a.slice(21, 86), b.slice(21, 86));
});

test('la cabecera VAPID es un JWT ES256 válido para el origen del servicio push', async () => {
  const env = await makeEnv(), now = 1_800_000_000_000;
  const h = await vapidHeader(env, 'https://fcm.googleapis.com/fcm/send/xyz', now);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, 'formato');
  assert.equal(m[2], env.VAPID_PUBLIC_KEY);
  const [hd, pl, sg] = m[1].split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64u.dec(hd))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(new TextDecoder().decode(b64u.dec(pl)));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, env.VAPID_SUBJECT);
  assert.equal(claims.exp, Math.floor(now / 1000) + 12 * 3600);
  assert.equal(b64u.dec(sg).length, 64, 'firma r||s de 64 bytes');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, env.publicKey, b64u.dec(sg), new TextEncoder().encode(`${hd}.${pl}`));
  assert.ok(ok, 'la firma verifica con la clave pública');
});

test('sendPush envía las cabeceras correctas y detecta suscripciones caducadas', async () => {
  const env = await makeEnv(), s = await makeSubscriber();
  let seen;
  const res = await sendPush(env, s.sub, { title: 'x' }, { fetcher: async (url, init) => { seen = { url, init }; return new Response(null, { status: 201 }); } });
  assert.deepEqual(res, { ok: true, status: 201, gone: false });
  assert.equal(seen.url, s.sub.endpoint);
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(seen.init.headers.TTL && seen.init.headers.Authorization.startsWith('vapid t='));
  assert.deepEqual(await s.decrypt(seen.init.body), { title: 'x' });
  for (const status of [404, 410]) assert.equal((await sendPush(env, s.sub, 'x', { fetcher: async () => new Response(null, { status }) })).gone, true);
  assert.equal((await sendPush(env, s.sub, 'x', { fetcher: async () => new Response(null, { status: 500 }) })).ok, false);
});
