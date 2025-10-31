// _worker.js (Cloudflare Pages / Workers)
// Forward /api → GAS, handling GET/POST/OPTIONS, buffering body, adding CORS.

const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function withCORS(resp) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/api') {
      // Build upstream GAS URL with query params intact
      const upstream = new URL(GAS_API);
      for (const [k, v] of url.searchParams.entries()) {
        upstream.searchParams.set(k, v);
      }

      // Buffer body so Apps Script always sees e.postData
      let body;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.arrayBuffer();
      }

      // Rebuild headers: keep content-type and accept, drop hop-by-hop
      const h = new Headers();
      const ct = request.headers.get('content-type');
      if (ct) h.set('content-type', ct);
      h.set('accept', 'application/json');

      const res = await fetch(upstream.toString(), {
        method: request.method,
        headers: h,
        body,
        redirect: 'follow',
      });

      // Pass through GAS response with CORS
      const out = new Response(await res.text(), {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
      });
      return withCORS(out);
    }

    // Everything else → static assets
    const asset = await env.ASSETS.fetch(request);
    return withCORS(asset);
  },
};
