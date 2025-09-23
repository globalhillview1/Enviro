// Cloudflare Pages Worker — static UI + API passthrough
// - /api?...  -> Google Apps Script (preserve method+query+body+headers)
// - /login    -> serve /login.html asset
// - others    -> static assets

const GAS_API = 'https://script.google.com/macros/s/AKfycbzAYAQiB9vzBZaExFNQUL_PMbs0NVJBG5WihWlmBO9TtTlFsxKdCz6p7mmHJLSZfk65/exec';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1) API passthrough
    if (url.pathname === '/api') {
      const upstream = new URL(GAS_API);
      // forward all query params (mode, op, token, etc.)
      for (const [k,v] of url.searchParams.entries()) upstream.searchParams.set(k, v);

      const init = {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: 'manual',
        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body
      };
      // Keep JSON simple
      init.headers.set('accept', 'application/json');

      const res = await fetch(upstream.toString(), init);
      // Stream through (GAS sets JSON correctly)
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
    }

    // 2) Pretty path for login
    if (url.pathname === '/login' || url.pathname === '/login/') {
      const r = new Request(new URL('/login.html', url), request);
      return env.ASSETS.fetch(r);
    }

    // 3) Static assets
    return env.ASSETS.fetch(request);
  }
};
