// Cloudflare Pages Worker — API proxy only (no path rewrites that can loop)
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Only handle /api here
    if (url.pathname === "/api") {
      // Accept both op and action (tolerant)
      const op = url.searchParams.get("op") || url.searchParams.get("action");
      if (!op) {
        return new Response(JSON.stringify({ ok:false, error:"missing op|action" }), {
          headers: { "content-type": "application/json" }
        });
      }

      // Build upstream GAS URL (your Web App "exec" URL)
      const gas = new URL(env.GAS_EXEC_URL);  // e.g. https://script.google.com/macros/s/AKfycb.../exec
      // Forward common query params
      gas.searchParams.set("op", op);
      for (const k of ["mode","session"]) {
        const v = url.searchParams.get(k);
        if (v) gas.searchParams.set(k, v);
      }

      // Prepare init mirroring the client request
      const init = {
        method: req.method,
        headers: new Headers(req.headers)
      };

      // If POST/PUT/PATCH, forward the raw body (important!)
      if (!["GET","HEAD"].includes(req.method)) {
        // Force JSON if frontend sent JSON; Apps Script relies on this to parse postData
        init.headers.set("content-type", "application/json");
        init.body = await req.text();  // pass-through body
      }

      const upstream = await fetch(gas.toString(), init);
      const text = await upstream.text();

      // Try to return JSON; if GAS sends HTML, wrap it to help debugging
      try {
        const json = JSON.parse(text);
        return new Response(JSON.stringify(json), {
          headers: { "content-type": "application/json" }
        });
      } catch {
        return new Response(JSON.stringify({
          ok: false,
          upstream: upstream.status,
          hint: "non-json-from-gas",
          body: text.slice(0, 2000)
        }), { headers: { "content-type": "application/json" } });
      }
    }

    // Fall through to your static site (Pages)
    return env.ASSETS.fetch(req);
  }
}
