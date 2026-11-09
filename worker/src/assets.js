/* Sirve la app empaquetada (src/static.js) con la misma interfaz que env.ASSETS.fetch. */
import { files } from './static.js';
const bin = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
export async function staticFetch(request) {
  const url = typeof request === 'string' ? new URL(request) : new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const f = files[path];
  if (!f) return new Response('No encontrado', { status: 404 });
  const headers = { 'Content-Type': f.ct, 'Cache-Control': path === '/sw.js' || path.endsWith('.html') ? 'no-cache' : 'public, max-age=300' };
  return new Response(f.bin ? bin(f.b) : f.b, { status: 200, headers });
}
