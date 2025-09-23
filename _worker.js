// Cloudflare Pages Worker (root: _worker.js)
// - Reverse proxy to your existing Google Apps Script web app
// - Keeps users on your domain (no script.google.com in the address bar)
// - Hides the blue Apps Script banner with CSS (only for HTML)
// - IMPORTANT: leaves content-encoding intact for non-HTML so assets load

const TARGET = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';
const TARGET_ORIGIN = new URL(TARGET).origin;

// --- helpers ---
function cloneHeaders(src) {
  const h = new Headers();
  for (const [k, v] of src.entries()) {
    if (/^host$|^cf-|^x-forwarded-|^content-length$/i.test(k)) continue;
    h.set(k, v);
  }
  return h;
}

// Rewrite Location headers that point back to script.google.com → our origin
function rewriteLocation(headers, reqUrl) {
  const out = new Headers(headers);
  const loc = headers.get('location');
  if (loc) {
    try {
      const u = new URL(loc, TARGET);
      if (u.origin === TARGET_ORIGIN) {
        const here = new URL(reqUrl);
        here.pathname = '/';         // we serve at root
        here.search = u.search;      // preserve query
        out.set('location', here.toString());
      }
    } catch (_) {}
  }
  return out;
}

// Add tiny CSS to hide the Apps Script banner; no JS, avoids CSP issues
function injectHideBannerCSS(html) {
  const css = `
    <style>
      #apps-script-notice, #docs-creator-notice, .apps-script-notice { display:none !important; }
      body > div[style*="position: fixed"][style*="top: 0"] { display:none !important; }
      html, body { margin-top: 0 !important; }
    </style>`;
  return html.includes('</head>') ? html.replace('</head>', css + '</head>') : css + html;
}

// Keep users on our domain by rewriting only explicit /exec href/action targets
function rewriteExecLinks(html) {
  return html.replace(
    /(href|action)=("|\')https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?[^"\']*)?("|\')/gi,
    (_m, attr, q1, qs = '', q2) => `${attr}=${q1}/${qs || ''}${q2}`
  );
}

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    // Upstream URL = fixed /exec + pass-through query
    const upstreamUrl = new URL(TARGET);
    upstreamUrl.search = reqUrl.search;

    // Build upstream request
    const headers = cloneHeaders(request.headers);
    headers.set('origin', TARGET_ORIGIN);
    headers.set('referer', TARGET_ORIGIN + '/');
    // Let upstream decide encodings; we’ll only decode when we transform HTML
    // headers.delete('accept-encoding'); // optional

    const init = {
      method: request.method,
      headers,
      redirect: 'manual'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const res = await fetch(upstreamUrl.toString(), init);

    // Copy headers for editing
    let outHeaders = new Headers(res.headers);

    // Keep cookies as-is (your app likely manages session via client script/localStorage)
    // If you later need cookie domain rewriting, we can add a robust parser.

    // Rewrite redirects to stay on our origin
    outHeaders = rewriteLocation(outHeaders, reqUrl.toString());

    // Same-origin via proxy
    outHeaders.set('access-control-allow-origin', reqUrl.origin);
    outHeaders.set('access-control-allow-credentials', 'true');

    const ctype = (outHeaders.get('content-type') || '').toLowerCase();

    if (ctype.includes('text/html')) {
      // We are going to modify HTML → drop content-encoding to avoid mismatch
      outHeaders.delete('content-encoding');

      let html = await res.text();
      html = injectHideBannerCSS(html);
      html = rewriteExecLinks(html);

      // Do NOT set content-length; let CF handle it (safer with compression)
      outHeaders.delete('content-length');

      return new Response(html, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders
      });
    }

    // For JS/CSS/images/etc: do NOT touch content-encoding or length.
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders
    });
  }
};
