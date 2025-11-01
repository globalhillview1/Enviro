// Cloudflare Pages Worker — API proxy only (no path rewrites that can loop)
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy /api to GAS, preserving method, query, and body
    if (url.pathname === '/api') {
      const upstream = new URL(GAS_API);
      for (const [k, v] of url.searchParams.entries()) upstream.searchParams.set(k, v);

      const init = {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: 'manual',
        body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body
      };
      init.headers.set('accept', 'application/json');

      const res = await fetch(upstream.toString(), init);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
    }

    // Everything else (/, /login, /login/, /login.html, CSS/JS/etc.)
    // is served by the static asset pipeline (Clean URLs enabled)
    return env.ASSETS.fetch(request);
  }
};
