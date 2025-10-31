// _worker.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__ping') {
      return new Response('worker-ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return env.ASSETS.fetch(request);  // otherwise serve static assets
  }
}
