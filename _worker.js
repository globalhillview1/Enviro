// _worker.js
const GAS_EXEC = 'https://script.google.com/macros/s/AKfycbxTEr3z6_xe5lD17C4WkiUiim9IVu5cl6q_b7jwpoFprFZJwANctfXecuqfAEoCDoSp/exec';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

async function handle(req) {
  const url = new URL(req.url);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // Only proxy /api to GAS
  if (url.pathname === '/api') {
    // Build upstream URL (keep query string: ?action=login|whoami|issues|updateissue...)
    const upstreamUrl = GAS_EXEC + url.search;

    // Read body for non-GET so we can re-send it if we need to follow the 302
    const needsBody = !(req.method === 'GET' || req.method === 'HEAD');
    const rawBody = needsBody ? await req.text() : undefined;

    // First hop to /exec, but DO NOT auto-follow redirects
    let res = await fetch(upstreamUrl, {
      method: req.method,
      headers: {'Content-Type': 'application/json'}, // keep simple JSON posts
      body: needsBody ? rawBody : undefined,
      redirect: 'manual'
    });

    // Apps Script returns 302 -> follow to the /macros/echo URL
    if (res.status === 301 || res.status === 302) {
      const loc = res.headers.get('location');
      if (loc) {
        res = await fetch(loc, {
          method: req.method,
          headers: {'Content-Type': 'application/json'},
          body: needsBody ? rawBody : undefined
        });
      }
    }

    // Stream response with CORS + content-type
    const ct = res.headers.get('content-type') || 'application/json';
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: res.status,
      headers: { ...CORS, 'content-type': ct }
    });
  }

  // Any other path -> serve the static page normally
  return fetch(req);
}
