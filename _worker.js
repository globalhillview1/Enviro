// Cloudflare Pages _worker.js — clean proxy to GAS + CORS
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

const HOP_BY_HOP = new Set([
  'host', 'content-length', 'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade',
  // cf / pages specific:
  'cf-connecting-ip','cf-ipcountry','cf-ray','cf-visitor','cf-ew-via','cdn-loop',
  'x-forwarded-proto','x-forwarded-host','x-real-ip'
]);

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');

    // Preflight
    if (url.pathname === '/api' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/api') {
      // Build upstream url with original query
      const upstream = new URL(GAS_API);
      for (const [k, v] of url.searchParams) upstream.searchParams.set(k, v);

      // Build a safe header set
      const headers = new Headers();
      for (const [k, v] of request.headers) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
      }
      headers.set('accept', 'application/json');

      // Body: don’t stream the original request.body through CF; clone/buffer it
      let body;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        // Either forward as ArrayBuffer or as text. JSON > ArrayBuffer is fine.
        body = await request.clone().arrayBuffer();
      }

      const res = await fetch(upstream.toString(), {
        method: request.method,
        headers,
        redirect: 'follow',
        body
      });

      // Copy upstream response + add CORS
      const proxied = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers
      });
      const ch = corsHeaders(origin);
      for (const k in ch) proxied.headers.set(k, ch[k]);
      // Ensure a permissive content-type for JSON replies
      if (!proxied.headers.has('content-type')) {
        proxied.headers.set('content-type', 'application/json; charset=utf-8');
      }
      return proxied;
    }

    // Everything else goes to static assets
    return env.ASSETS.fetch(request);
  }
};
