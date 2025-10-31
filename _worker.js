// worker.js — Cloudflare Pages Function
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function withCORS(resp) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

function json(status, obj) {
  return withCORS(new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' }
  }));
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === 'OPTIONS') {
        return withCORS(new Response(null, { status: 204 }));
      }

      // quick health
      if (url.pathname === '/__ping') {
        return new Response('worker-ok\n', { headers: { 'content-type': 'text/plain' } });
      }

      // proxy only /api
      if (url.pathname !== '/api') {
        return env.ASSETS.fetch(request);
      }

      // upstream URL with same query
      const upstream = new URL(GAS_API);
      url.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));

      // build *clean* headers for upstream
      const inH = request.headers;
      const outH = new Headers();
      // pass only content-type and accept
      if (inH.has('content-type')) outH.set('content-type', inH.get('content-type'));
      outH.set('accept', 'application/json');

      // never forward hop-by-hop/browser-only headers
      // (NO: host, content-length, connection, accept-encoding, sec-*, cf-*, etc.)

      const init = {
        method: request.method,
        headers: outH,
        redirect: 'follow',
        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body
      };

      const res = await fetch(upstream.toString(), init);

      // if GAS returned HTML, wrap as error so you see it
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = await res.text();
        return json(res.status, { ok: false, upstream: res.status, hint: 'non-json-from-gas', body: text.slice(0, 5000) });
      }

      return withCORS(new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers
      }));

    } catch (err) {
      return json(502, { ok: false, error: String(err) });
    }
  }
};
