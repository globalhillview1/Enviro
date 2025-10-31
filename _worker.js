// worker.js (Pages Function)
// Cloudflare Pages Worker — API proxy with clean headers + CORS + health checks
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

function corsify(resp) {
  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsify(new Response(null, { status: 204 }));
    }

    // quick worker health
    if (url.pathname === '/__ping') {
      return new Response('worker-ok\n', { headers: { 'content-type': 'text/plain' } });
    }

    // proxy only /api
    if (url.pathname === '/api') {
      // build upstream URL with same query
      const upstream = new URL(GAS_API);
      url.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));

      // build clean headers
      const inH = request.headers;
      const outH = new Headers();
      // prefer explicit content-type if present
      if (inH.has('content-type')) outH.set('content-type', inH.get('content-type'));
      outH.set('accept', 'application/json');

      const init = {
        method: request.method,
        headers: outH,
        redirect: 'follow',
        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body
      };

      const upstreamRes = await fetch(upstream.toString(), init);

      // return upstream body + CORS headers
      return corsify(new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: upstreamRes.headers
      }));
    }

    // everything else = static asset
    return env.ASSETS.fetch(request);
  }
}
