// _worker.js (minimal proxy for /api → GAS)
const GAS = 'https://script.google.com/macros/s/AKfycbxTEr3z6_xe5lD17C4WkiUiim9IVu5cl6q_b7jwpoFprFZJwANctfXecuqfAEoCDoSp/exec';

export default {
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'content-type,authorization',
        }
      });
    }

    if (url.pathname.startsWith('/api')) {
      // Build target URL
      const target = new URL(GAS);
      url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
      // Map action -> op for the GAS backend that expects op=...
      if (target.searchParams.has('action') && !target.searchParams.has('op')) {
        target.searchParams.set('op', target.searchParams.get('action'));
        target.searchParams.delete('action');
      }

      const init = {
        method: req.method,
        redirect: 'follow',
        headers: { 'content-type': req.headers.get('content-type') || 'application/json' },
        body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : await req.text(),
      };

      const upstream = await fetch(target, init);
      const hdrs = new Headers(upstream.headers);
      hdrs.set('Access-Control-Allow-Origin', '*');
      return new Response(upstream.body, { status: upstream.status, headers: hdrs });
    }

    // static assets
    return fetch(req);
  }
};
