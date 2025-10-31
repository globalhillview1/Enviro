// _worker.js
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

const HOP_BY_HOP = new Set([
  'host','content-length','connection','keep-alive','proxy-authenticate',
  'proxy-authorization','te','trailer','transfer-encoding','upgrade',
  'cf-connecting-ip','cf-ipcountry','cf-ray','cf-visitor','cf-ew-via','cdn-loop',
  'x-forwarded-proto','x-forwarded-host','x-real-ip'
]);

function cors(origin) {
  const o = origin || '*';
  return {
    'access-control-allow-origin': o,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');

    // health check
    if (url.pathname === '/__ping') {
      return new Response('worker-ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    }

    // preflight
    if (url.pathname === '/api' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // tiny self ping
    if (url.pathname === '/api' && url.searchParams.get('op') === 'ping') {
      return new Response(JSON.stringify({ ok: true, pong: true }), {
        status: 200, headers: { 'content-type': 'application/json', ...cors(origin) }
      });
    }

    // proxy to GAS
    if (url.pathname === '/api') {
      const upstream = new URL(GAS_API);
      for (const [k, v] of url.searchParams) upstream.searchParams.set(k, v);

      const headers = new Headers();
      for (const [k, v] of request.headers) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
      }
      headers.set('accept', 'application/json');

      let body;
      if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
        body = await request.clone().arrayBuffer();
      }

      const res = await fetch(upstream.toString(), {
        method: request.method,
        headers,
        redirect: 'follow',
        body
      });

      const out = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers
      });

      // add CORS to the response
      const ch = cors(origin);
      for (const k in ch) out.headers.set(k, ch[k]);
      if (!out.headers.has('content-type')) {
        out.headers.set('content-type', 'application/json; charset=utf-8');
      }
      return out;
    }

    // static assets
    return env.ASSETS.fetch(request);
  }
};
