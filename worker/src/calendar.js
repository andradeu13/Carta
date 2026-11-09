/* Calendario (iCal secreto de Google u otro): la dirección vive solo en KV (`cal:url`), nunca en los documentos sincronizados. */
import { eventsOn } from './ics.js';

export const validCalUrl = u => {
  try {
    const x = new URL(String(u).replace(/^webcal:/i, 'https:'));
    if (x.protocol !== 'https:' || x.username || x.password) return null;
    if (/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(x.hostname) || !x.hostname.includes('.')) return null;
    return x.href;
  } catch (e) { return null; }
};
const cache = { at: 0, url: '', text: '' };
export const resetCalCache = () => { cache.at = 0; cache.text = ''; };

/* Eventos del día en segundos: [{ title, from, to }]. Con caché de 5 min; si falla, devuelve [] (la agenda sigue funcionando). */
export async function calEvents(env, date, nowMs = Date.now(), { fetcher = fetch } = {}) {
  const url = await env.CUMBRE.get('cal:url');
  if (!url) return { configured: false, events: [] };
  try {
    if (cache.url !== url || nowMs - cache.at > 5 * 60 * 1000 || !cache.text) {
      const res = await fetcher(url, { headers: { Accept: 'text/calendar' } });
      if (!res.ok) throw new Error('calendario ' + res.status);
      const text = await res.text();
      if (text.length > 3_000_000) throw new Error('calendario demasiado grande');
      Object.assign(cache, { at: nowMs, url, text });
    }
    return { configured: true, events: eventsOn(cache.text, date, env.TZ || 'America/Guayaquil') };
  } catch (e) { return { configured: true, events: [], error: String(e.message || e).slice(0, 80) }; }
}
