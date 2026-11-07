/* Web Push desde un Worker: VAPID (RFC 8292) + cifrado aes128gcm (RFC 8291), solo con Web Crypto. */
import { b64u, concat } from './b64.js';

const enc = new TextEncoder();

async function hkdf(secret, salt, info, bits) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}

/* Cifra `bytes` para una suscripción { endpoint, keys: { p256dh, auth } }. Devuelve el cuerpo de la petición. */
export async function encryptPayload(sub, bytes) {
  const ua = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const asKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asKey.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKey.privateKey, 256));
  const ikm = await hkdf(ecdh, auth, concat(enc.encode('WebPush: info\0'), ua, asPub), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 96);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(bytes, Uint8Array.of(2));            // 0x02 = último registro, sin relleno extra
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, Uint8Array.of(asPub.length), asPub, ct);
}

/* Cabecera Authorization de VAPID para el servicio push de `endpoint`. */
export async function vapidHeader(env, endpoint, nowMs = Date.now()) {
  const pub = b64u.dec(env.VAPID_PUBLIC_KEY);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`)));  // r||s, el formato que pide JWT
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/* Envía un push. Devuelve { ok, status, gone } (gone: la suscripción ya no existe y hay que borrarla). */
export async function sendPush(env, sub, payload, { ttl = 3600, urgency = 'high', fetcher = fetch } = {}) {
  const body = await encryptPayload(sub, enc.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)));
  const res = await fetcher(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency },
    body
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
}
