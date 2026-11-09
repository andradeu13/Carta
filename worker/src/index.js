import { handle } from './api.js';
import { tick } from './tick.js';
import { staticFetch } from './assets.js';
const withAssets = env => (env.ASSETS ? env : Object.assign({}, env, { ASSETS: { fetch: staticFetch } }));

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handle(request, withAssets(env), ctx);
    return withAssets(env).ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(withAssets(env), event.scheduledTime || Date.now()).catch(e => console.log('tick error', e && e.message)));
  }
};
