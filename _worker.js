// Cloudflare Pages Worker (root: _worker.js)
// - "/" -> proxy to your GAS /exec (and remove the banner from HTML)
// - Other paths (assets) -> same path on script.google.com
// - In HTML: rewrite /exec links to "/", and force iframes with src="/..."
//   to load from https://script.google.com (so Apps Script origin checks pass)

const EXEC = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';
const ORIGIN = new URL(EXEC).origin;
const EXEC_PATH = new URL(EXEC).pathname; // /macros/s/<id>/exec

function cloneHeaders(src) {
  const h = new Headers();
  for (const [k, v] of src.entries()) {
    if (/^host$|^cf-|^x-forwarded-|^content-length$/i.test(k)) continue;
    h.set(k, v);
  }
  return h;
}

// Keep redirects on our origin (map exec path to "/")
function rewriteLocation(headers, reqUrl) {
  const out = new Headers(headers);
  const loc = headers.get('location');
  if (!loc) return out;
  try {
    const u = new URL(loc, ORIGIN);
    if (u.origin === ORIGIN) {
      const here = new URL(reqUrl);
      here.pathname = (u.pathname === EXEC_PATH) ? '/' : u.pathname;
      here.search = u.search;
      here.hash = u.hash;
      out.set('location', here.toString());
    }
  } catch (_) {}
  return out;
}

// 1) Remove the Apps Script banner div
// 2) Rewrite absolute/relative links/forms to /exec => "/"
// 3) Ensure iframes that point to internal paths (src="/...") load from script.google.com
function transformHtml(html) {
  // Remove the GAS banner node (contains the exact phrase).
  // This targets the single top notice container.
  html = html.replace(
    /<div[^>]*>\s*This application was created by a Google Apps Script user[\s\S]*?<\/div>/i,
    ''
  );

  // Rewrite links/forms that target the exec URL to "/"
  html = html
    // absolute exec
    .replace(
      /(href|action)=("|\')https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?[^"\']*)?("|\')/gi,
      (_m, attr, q1, qs = '', q2) => `${attr}=${q1}/${qs || ''}${q2}`
    )
    // relative exec
    .replace(
      /(href|action)=("|\')\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?[^"\']*)?("|\')/gi,
      (_m, attr, q1, qs = '', q2) => `${attr}=${q1}/${qs || ''}${q2}`
    );

  // Make iframes with src="/..." load from script.google.com (keeps GAS origin)
  html = html.replace(
    /(<iframe[^>]*\ssrc=["'])(\/[^"']*)(["'][^>]*>)/gi,
    (_m, p1, path, p3) => `${p1}${ORIGIN}${path}${p3}`
  );

  return html;
}

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    // Path-aware upstream:
    // - "/" maps to EXEC
    // - everything else maps to same path on script.google.com
    let upstreamUrl;
    if (reqUrl.pathname === '/' || reqUrl.pathname === '') {
      upstreamUrl = new URL(EXEC);
      upstreamUrl.search = reqUrl.search; // pass query
    } else {
      upstreamUrl = new URL(reqUrl.pathname + reqUrl.search, ORIGIN);
    }

    const headers = cloneHeaders(request.headers);
    headers.set('origin', ORIGIN);
    headers.set('referer', EXEC);

    const init = {
      method: request.method,
      headers,
      redirect: 'manual'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const res = await fetch(upstreamUrl.toString(), init);
    let outHeaders = new Headers(res.headers);

    // Keep assets intact; only touch HTML
    const ctype = (outHeaders.get('content-type') || '').toLowerCase();

    // Keep redirects on our origin
    outHeaders = rewriteLocation(outHeaders, reqUrl.toString());

    // Same-origin via proxy
    outHeaders.set('access-control-allow-origin', reqUrl.origin);
    outHeaders.set('access-control-allow-credentials', 'true');

    if (ctype.includes('text/html')) {
      // We will modify HTML -> remove encoding/length to avoid mismatch
      outHeaders.delete('content-encoding');
      outHeaders.delete('content-length');

      let html = await res.text();
      html = transformHtml(html);

      return new Response(html, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders
      });
    }

    // Non-HTML: stream through as-is (preserve encoding and content-type)
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders
    });
  }
};
