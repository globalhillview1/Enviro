// functions/_worker.js  (Cloudflare Pages Functions)
const GAS_API = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function withCORS(resp) {
  const h = new Headers(resp.headers); for (const [k,v] of Object.entries(CORS)) h.set(k,v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}
function json(status, obj) {
  return withCORS(new Response(JSON.stringify(obj), { status, headers: { 'content-type':'application/json' } }));
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === 'OPTIONS') return withCORS(new Response(null, { status: 204 }));

      // health
      if (url.pathname === '/__ping') return new Response('worker-ok\n', { headers: { 'content-type':'text/plain' } });

      // only /api is proxied
      if (url.pathname !== '/api') return env.ASSETS.fetch(request);

      // clone body once (streams are single-use)
      let bodyBuf = undefined;
      if (!['GET','HEAD'].includes(request.method)) {
        bodyBuf = await request.arrayBuffer();
      }

      // build upstream URL with same query
      const upstream = new URL(GAS_API);
      url.searchParams.forEach((v,k) => upstream.searchParams.set(k,v));

      // clean headers for upstream
      const outH = new Headers();
      const inH = request.headers;
      if (inH.has('content-type')) outH.set('content-type', inH.get('content-type'));
      outH.set('accept', 'application/json');

      const baseInit = {
        method: request.method,
        headers: outH,
        redirect: 'manual',
        body: bodyBuf
      };

      // 1) first hop (scripts.google.com) — expect 302/303 to googleusercontent
      let res = await fetch(upstream.toString(), baseInit);

      // 2) follow Location ourselves, preserving method/body
      if ([301,302,303,307,308].includes(res.status)) {
        const loc = res.headers.get('Location');
        if (!loc) return json(502, { ok:false, error:'redirect-without-location' });

        // Absolute or relative
        const nextURL = new URL(loc, GAS_API).toString();
        res = await fetch(nextURL, baseInit); // still manual; usually 200 now
      }

      // If GAS gave HTML, surface it as JSON error so you can see it
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = await res.text();
        return json(res.status, { ok:false, upstream:res.status, hint:'non-json-from-gas', body:text.slice(0,5000) });
      }

      // Success passthrough
      return withCORS(new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }));

    } catch (err) {
      return json(502, { ok:false, error:String(err) });
    }
  }
};
