/* Rutas /api/*. Todo lo que cambia datos exige el token; responder desde una notificación exige la firma. */
import { bearerOk, verifyAnswer } from './auth.js';
import { DOC_RE, getDoc, putDoc, listDocs, getSub } from './kv.js';
import { handleAnswer } from './answer.js';
import { sendPush } from './push.js';
import { calEvents, validCalUrl, resetCalCache } from './calendar.js';
import { localParts } from './schedule.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const readJson = async (request, max = 200_000) => {
  const text = await request.text();
  if (text.length > max) throw new Error('demasiado grande');
  return JSON.parse(text);
};

export async function handle(request, env, ctx, { fetcher, now, calFetcher } = {}) {
  const nowMs = now === undefined ? Date.now() : now;
  const url = new URL(request.url), path = url.pathname, method = request.method;
  try {
    if (path === '/api/ping') return json({ ok: true, now: Date.now(), push: !!env.VAPID_PUBLIC_KEY, auth: request.headers.has('Authorization') ? await bearerOk(request, env) : null });
    if (path === '/api/push/key') return json({ key: env.VAPID_PUBLIC_KEY || null });

    if (path === '/api/answer' && method === 'POST') {
      const b = await readJson(request, 2000);
      const p = { d: String(b.d || ''), i: String(b.i || ''), r: +b.r, e: +b.e, a: String(b.a || ''), s: String(b.s || '') };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.d) || !/^[A-Za-z0-9_-]{1,64}$/.test(p.i) || ![0, 1].includes(p.r)) return json({ ok: false, error: 'datos no válidos' }, 400);
      if (!await verifyAnswer(env, p, nowMs)) return json({ ok: false, error: 'firma no válida o caducada' }, 403);
      return json(await handleAnswer(env, p, nowMs));
    }

    if (!await bearerOk(request, env)) return json({ ok: false, error: 'sin acceso' }, 401);

    if (path === '/api/docs' && method === 'GET') return json({ docs: await listDocs(env, +url.searchParams.get('since') || 0), now: Date.now() });

    if (path.startsWith('/api/doc/') && method === 'PUT') {
      const p = decodeURIComponent(path.slice('/api/doc/'.length));
      if (!DOC_RE.test(p)) return json({ ok: false, error: 'ruta no válida' }, 400);
      const obj = await readJson(request);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return json({ ok: false, error: 'documento no válido' }, 400);
      const cur = await getDoc(env, p), u = Number(obj.u) || Date.now();
      if (cur && cur.u > u) return json({ ok: false, error: 'conflicto', current: cur }, 409);
      await putDoc(env, p, obj, u);
      return json({ ok: true, u });
    }

    if (path === '/api/calendar') {
      if (method === 'PUT') {
        const b = await readJson(request, 2000), u = validCalUrl(b.url);
        if (!u) return json({ ok: false, error: 'dirección de calendario no válida (usa la dirección secreta iCal, que empieza con https://)' }, 400);
        await env.CUMBRE.put('cal:url', u); resetCalCache();
        return json({ ok: true });
      }
      if (method === 'DELETE') { await env.CUMBRE.delete('cal:url'); resetCalCache(); return json({ ok: true }); }
      if (method === 'GET') {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : localParts(nowMs, env.TZ || 'America/Guayaquil').date;
        return json({ date, ...(await calEvents(env, date, nowMs, { fetcher: calFetcher })) });
      }
    }

    if (path === '/api/push/subscribe' && method === 'POST') {
      const s = await readJson(request, 4000);
      if (!s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://') || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ ok: false, error: 'suscripción no válida' }, 400);
      await env.CUMBRE.put('push:sub', JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, at: Date.now() }));
      return json({ ok: true });
    }
    if (path === '/api/push/subscribe' && method === 'DELETE') { await env.CUMBRE.delete('push:sub'); return json({ ok: true }); }
    if (path === '/api/push/status' && method === 'GET') return json({ subscribed: !!(await getSub(env)), configured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) });

    if (path === '/api/push/test' && method === 'POST') {
      const sub = await getSub(env);
      if (!sub) return json({ ok: false, error: 'sin suscripción' }, 409);
      const res = await sendPush(env, sub, { title: 'Cumbre', body: 'Prueba de avisos: si ves esto, el push funciona.', tag: 'prueba', data: { url: '/' } }, { fetcher });
      if (res.gone) await env.CUMBRE.delete('push:sub');
      return json({ ok: res.ok, status: res.status, gone: res.gone });
    }
    return json({ ok: false, error: 'no existe' }, 404);
  } catch (e) {
    return json({ ok: false, error: 'petición no válida' }, 400);
  }
}
