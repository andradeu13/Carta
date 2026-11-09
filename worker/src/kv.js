/* Documentos en Workers KV: la clave es `doc:<colección>/<id>` y el sello `u` viaja como metadato,
 * así se puede saber qué cambió sin leer todos los valores. */
export const DOC_RE = /^(days|plans|meta|insights|goals|reminders)\/[A-Za-z0-9_.-]{1,64}$/;
export const docKey = path => `doc:${path}`;

export const getDoc = (env, path) => env.CUMBRE.get(docKey(path), 'json');

export async function putDoc(env, path, obj, u = Date.now()) {
  obj.u = u;
  await env.CUMBRE.put(docKey(path), JSON.stringify(obj), { metadata: { u } });
  return obj;
}

/* Todos los documentos con u > since. */
export async function listDocs(env, since = 0) {
  const docs = {};
  let cursor;
  do {
    const page = await env.CUMBRE.list({ prefix: 'doc:', cursor });
    for (const k of page.keys) {
      const u = (k.metadata && k.metadata.u) || 0;
      if (u > since) { const v = await env.CUMBRE.get(k.name, 'json'); if (v) docs[k.name.slice(4)] = v; }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return docs;
}

export const getAsks = async (env, date) => (await env.CUMBRE.get(`asks:${date}`, 'json')) || {};
export const putAsks = (env, date, asks) => env.CUMBRE.put(`asks:${date}`, JSON.stringify(asks), { expirationTtl: 4 * 86400 });
export const getSub = env => env.CUMBRE.get('push:sub', 'json');
