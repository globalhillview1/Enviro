// _worker.js — Cloudflare Pages Functions proxy for Google Apps Script (GAS)

// Hardcode your GAS exec URL or use an env var named GAS_EXEC_URL
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';
const getGasUrl = env => (env && env.GAS_EXEC_URL) ? env.GAS_EXEC_URL : GAS_API;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Only proxy /api – everything else goes to static assets
    if (url.pathname !== '/api') {
      return env.ASSETS.fetch(req);
    }

    // Build upstream URL and forward ALL query params (so ?mode=data works)
    const gas = new URL(getGasUrl(env));
    url.searchParams.forEach((v, k) => gas.searchParams.set(k, v));

    // Build a CLEAN init (do not forward browser/cf headers)
    const init = { method: req.method, headers: new Headers() };

    // Accept JSON back from GAS
    init.headers.set('accept', 'application/json');

    if (!['GET', 'HEAD'].includes(req.method)) {
      // Ensure JSON body for Apps Script doPost
      const ct = (req.headers.get('content-type') || '').toLowerCase();
      const raw = await req.text();

      // If caller didn’t set JSON, we still send JSON
      init.headers.set('content-type', 'application/json');

      // If caller already sent JSON text, pass it; else wrap raw as text body
      try {
        // If it's valid JSON keep it as-is
        JSON.parse(raw);
        init.body = raw;
      } catch {
        // Wrap plain text as {"raw":"..."} to never send empty bodies
        init.body = JSON.stringify({ raw });
      }
    }

    // Call GAS
    let upstream, text;
    try {
      upstream = await fetch(gas.toString(), init);
      text = await upstream.text();
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: 'fetch_failed', detail: String(err) }), {
        status: 502,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Try to return JSON; otherwise surface the upstream HTML for debugging
    try {
      const json = JSON.parse(text);
      return new Response(JSON.stringify(json), {
        status: upstream.status,
        headers: { 'content-type': 'application/json' }
      });
    } catch {
      return new Response(JSON.stringify({
        ok: false,
        upstreamStatus: upstream.status,
        hint: 'GAS returned non-JSON',
        bodyPreview: text.slice(0, 2000)
      }), { status: 502, headers: { 'content-type': 'application/json' } });
    }
  }
};
