// Empaqueta ../app dentro de la Worker (src/static.js) para desplegar sin la subida de "assets" de Cloudflare.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
const root = new URL('../../app/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const out = {};
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const ext = extname(n), ct = TYPES[ext]; if (!ct) continue;
    const buf = readFileSync(p), text = ct.startsWith('image/') && ext !== '.svg' ? null : buf.toString('utf8');
    out['/' + relative(root, p)] = text === null ? { ct, b: buf.toString('base64'), bin: 1 } : { ct, b: text };
  }
})(root);
writeFileSync(new URL('../src/static.js', import.meta.url), `// GENERADO por scripts/build-static.mjs. No editar.\nexport const files = ${JSON.stringify(out)};\n`);
console.log(Object.keys(out).length + ' archivos empaquetados');
