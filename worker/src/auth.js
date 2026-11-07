/* Acceso de un solo usuario: token Bearer para la app y firmas HMAC para responder desde una notificación. */
import { b64u } from './b64.js';
const enc = new TextEncoder();

export async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u.enc(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))));
}

/* Comparación en tiempo constante (se comparan los hashes, que tienen el mismo largo). */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(a))), crypto.subtle.digest('SHA-256', enc.encode(String(b)))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

export async function bearerOk(request, env) {
  if (!env.APP_TOKEN) return false;
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer (.+)$/.exec(h);
  return !!m && await safeEqual(m[1], env.APP_TOKEN);
}

/* Firma de una respuesta: fecha, misión, ronda de la pregunta, caducidad y respuesta (sí/no). */
export const answerMsg = (d, i, r, e, a) => `${d}|${i}|${r}|${e}|${a}`;
export const signAnswer = (env, d, i, r, e, a) => hmac(env.SIGN_SECRET, answerMsg(d, i, r, e, a));
export async function verifyAnswer(env, { d, i, r, e, a, s }, nowMs = Date.now()) {
  if (!env.SIGN_SECRET || !['yes', 'no'].includes(a) || !s) return false;
  if (!Number.isFinite(+e) || +e < nowMs) return false;
  return safeEqual(await signAnswer(env, d, i, r, e, a), s);
}
