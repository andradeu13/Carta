import { webcrypto as crypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { b64u } from '../src/b64.js';

export const content = JSON.parse(readFileSync(new URL('../../app/data/content.json', import.meta.url), 'utf8'));

export class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { const e = this.m.get(k); if (!e) return null; return type === 'json' ? JSON.parse(e.value) : e.value; }
  async put(k, v, opts = {}) { this.m.set(k, { value: v, metadata: opts.metadata }); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '' } = {}) { return { keys: [...this.m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: true }; }
}

export async function makeEnv() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    CUMBRE: new FakeKV(),
    ASSETS: { fetch: async () => new Response(JSON.stringify(content), { status: 200 }) },
    TZ: 'America/Guayaquil', APP_TOKEN: 'token-de-prueba', SIGN_SECRET: 'secreto-de-prueba-para-firmas',
    VAPID_PUBLIC_KEY: b64u.enc(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'https://cumbre.example.workers.dev',
    publicKey: kp.publicKey
  };
}

/* Un «navegador» suscriptor de mentira: genera sus claves y sabe descifrar según RFC 8291. */
export async function makeSubscriber(endpoint = 'https://push.example.test/send/abc') {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const hk = async (secret, salt, info, bits) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']), bits));
  return {
    sub: { endpoint, keys: { p256dh: b64u.enc(pub), auth: b64u.enc(auth) } },
    async decrypt(body) {
      const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
      const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, kp.privateKey, 256));
      const e = new TextEncoder();
      const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
      const ikm = await hk(ecdh, auth, cat(e.encode('WebPush: info\0'), pub, asPub), 256);
      const cek = await hk(ikm, salt, e.encode('Content-Encoding: aes128gcm\0'), 128), nonce = await hk(ikm, salt, e.encode('Content-Encoding: nonce\0'), 96);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
      let end = plain.length - 1; while (plain[end] === 0) end--;          // quita el relleno
      if (plain[end] !== 2) throw new Error('delimitador de registro inesperado');
      return JSON.parse(new TextDecoder().decode(plain.slice(0, end)));
    }
  };
}
