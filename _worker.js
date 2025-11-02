export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // --- API proxy to GAS ---
    if (url.pathname === "/api") {
      // 1) Your GAS Web App "exec" URL (Deployment > Web app)
      //    Example: https://script.google.com/macros/s/AKfycb.../exec
      const GAS = new URL(env.GAS_URL);

      // 2) Forward the full query string (?op=diag, ?mode=data, etc.)
      GAS.search = url.search;

      // 3) Forward method, headers, and body
      const init = {
        method: req.method,
        headers: new Headers(req.headers),
        body: (req.method === "GET" || req.method === "HEAD") ? undefined : req.body,
        redirect: "follow"
      };

      // (optional) ensure Accept JSON; do NOT force Content-Type if browser already set it
      if (!init.headers.has("Accept")) init.headers.set("Accept", "application/json");

      const upstream = await fetch(GAS.toString(), init);

      // Normalize non-JSON responses from GAS during debugging
      const ct = upstream.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await upstream.text();
        return new Response(
          JSON.stringify({ ok: false, upstream: upstream.status, hint: "non-json-from-gas", body: text }),
          { headers: { "content-type": "application/json" }, status: 200 }
        );
      }

      return upstream;
    }

    // --- Static assets / other routes (Pages default) ---
    return env.ASSETS.fetch(req);
  }
}
