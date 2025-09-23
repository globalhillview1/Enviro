// Cloudflare Pages Worker: serve static UI + proxy API calls to GAS.
// - GET/POST /api/<action>[?query] -> GAS_URL?action=<action>[&query]
// - Everything else -> static assets (env.ASSETS)

const GAS_API = 'https://script.google.com/macros/s/AKfycbzAYAQiB9vzBZaExFNQUL_PMbs0NVJBG5WihWlmBO9TtTlFsxKdCz6p7mmHJLSZfk65/exec';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const action = url.pathname.substring('/api/'.length); // e.g. 'login', 'issues'
      const upstream = new URL(GAS_API);
      upstream.searchParams.set('action', action);

      // forward original query params (e.g., token, limit, offset)
      for (const [k,v] of url.searchParams.entries()) {
        upstream.searchParams.set(k, v);
      }

      // Forward request
      const init = {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: 'manual',
        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body
      };

      // Force JSON for our app; GAS ignores most headers anyway
      init.headers.set('accept', 'application/json');

      const res = await fetch(upstream.toString(), init);

      // Pass through JSON untouched
      const outHeaders = new Headers(res.headers);
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders
      });
    }

    // Static assets (Pages)
    return env.ASSETS.fetch(request);
  }
};
