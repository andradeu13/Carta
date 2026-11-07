/* Genera las claves y secretos que necesita el Worker. Ejecuta: npm run vapid */
import { webcrypto as crypto } from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n)));

console.log(`# 1) Pega esto en wrangler.toml, sección [vars]:
VAPID_PUBLIC_KEY = "${b64u(pub)}"

# 2) Guarda estos tres como secretos (te pedirá el valor; pégalo):
#    npx wrangler secret put VAPID_PRIVATE_KEY   ->  ${jwk.d}
#    npx wrangler secret put APP_TOKEN           ->  ${rnd(24)}
#    npx wrangler secret put SIGN_SECRET         ->  ${rnd(32)}

# APP_TOKEN es el «código de acceso» que escribirás una vez en Ajustes de la app. Guárdalo en un gestor de contraseñas.`);
