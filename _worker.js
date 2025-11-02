// _worker.js — Cloudflare Pages Functions proxy for Apps Script

// OPTION A: hardcode your GAS web app "exec" URL here
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

// OPTION B (later): use an env var named GAS_EXEC_URL and fall back to GAS_API
function getGasExecUrl(env) {
  return (env && env.GAS_EXEC_URL) ? env.GAS_EXEC_URL : GAS_API;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Only proxy /api — everything else is your static site
    if (url.pathname === '/api') {
      // Build upstream URL
      const gas = new URL(getGasExecUrl(env));

      // forward ALL query params (so ?mode=data works without op)
      url.searchParams.forEach((v, k) => gas.searchParams.set(k, v));

      // Prepare init (clone method & headers)
      const init = {
        method: req.method,
        headers: new Headers(req.headers)
      };

      // If sending a body, forward it as text and ensure JSON content-type when appropriate
      if (!['GET', 'HEAD'].includes(req.method)) {
        // Keep the original content-type if the client set one, otherwise default to JSON
        const ct = req.headers.get('content-type');
        if (!ct) init.headers.set('content-type', 'application/json');
        init.body = await req.text();
      }

      let upstream;
      try {
        upstream = await fetch(gas.toString(), init);
      } catch (err) {
        return new Response(JSON.stringify({ ok:false, error:'fetch_failed', detail:String(err) }), {
          headers: { 'content-type': 'application/json' }, status: 502
        });
      }

      const text = await upstream.text();

      // Try to return JSON, otherwise wrap non-JSON for easier debugging
      try {
        const json = JSON.parse(text);
        return new Response(JSON.stringify(json), {
          headers: { 'content-type': 'application/json' }, status: upstream.status
        });
      } catch {
        return new Response(JSON.stringify({
          ok: false,
          upstreamStatus: upstream.status,
          hint: 'GAS returned non-JSON',
          bodyPreview: text.slice(0, 2000)
        }), { headers: { 'content-type': 'application/json' }, status: 502 });
      }
    }

    // Not /api → serve static assets
    return env.ASSETS.fetch(req);
  }
}
