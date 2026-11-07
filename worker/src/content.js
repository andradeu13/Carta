/* Lee data/content.json de los archivos estáticos: es la misma fuente que usa la app. */
let cache = { at: 0, data: null };
export const resetContentCache = () => { cache = { at: 0, data: null }; };
export async function getContent(env, nowMs = Date.now()) {
  if (cache.data && nowMs - cache.at < 10 * 60 * 1000) return cache.data;
  const res = await env.ASSETS.fetch('https://assets.local/data/content.json');
  if (!res.ok) throw new Error('no se pudo leer content.json');
  cache = { at: nowMs, data: await res.json() };
  return cache.data;
}
