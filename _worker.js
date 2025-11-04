// _worker.js — Cloudflare Pages (modules syntax)
// Proxies /api -> GAS web app and serves everything else from static assets

// 1) Set your GAS web app URL here:
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxTEr3z6_xe5lD17C4WkiUiim9IVu5cl6q_b7jwpoFprFZJwANctfXecuqfAEoCDoSp/exec';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,authorization'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- CORS preflight ---
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    // --- API proxy ---
    // Matches /api and /api?... (no trailing slash needed)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        // Build target GAS URL and copy query
        const target = new URL(GAS_URL);
        url.searchParams.forEach((v, k) => target.searchParams.set(k, v));

        // Translate ?action=... to ?op=... for the GAS backend
        if (target.searchParams.has('action') && !target.searchParams.has('op')) {
          target.searchParams.set('op', target.searchParams.get('action'));
          target.searchParams.delete('action');
        }

        // Prepare upstream request
        const ct = request.headers.get('content-type') || '';
        const init = {
          method: request.method,
          redirect: 'follow',
          headers: new Headers({ 'content-type': ct || 'application/json' })
        };

        if (request.method !== 'GET' && request.method !== 'HEAD') {
          // Read once (do not reuse the stream)
          init.body = await request.text();
        }

        const upstream = await fetch(target.toString(), init);

        // Pass through JSON/other body with permissive CORS
        const headers = new Headers(upstream.headers);
        Object.entries(cors()).forEach(([k, v]) => headers.set(k, v));
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (err) {
        // Surface runtime errors as JSON for easier debugging
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 500,
          headers: { 'content-type': 'application/json', ...cors() }
        });
      }
    }

    // --- Static assets (very important on Pages) ---
    // If you return fetch(request) here, you can hit 1019. Always use env.ASSETS.
    return env.ASSETS.fetch(request);
  }
};
