// Cloudflare Pages Worker (drop at repo root as _worker.js)
// - Reverse proxy to your GAS web app
// - Keep URL on your domain
// - Hide the Apps Script banner safely via CSS
// - Rewrite only links/forms pointing to the exact /exec URL

const TARGET = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';
const TARGET_ORIGIN = new URL(TARGET).origin;
const EXEC_RE = /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/gi;

function cloneHeaders(src) {
  const h = new Headers();
  for (const [k, v] of src.entries()) {
    if (/^host$|^cf-|^x-forwarded-|^content-length$/i.test(k)) continue;
    h.set(k, v);
  }
  return h;
}

function rewriteSetCookie(headers) {
  const out = new Headers(headers);
  const list = headers.getAll
    ? headers.getAll('set-cookie')
    : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
  if (list.length) {
    out.delete('set-cookie');
    for (let c of list) {
      c = c.replace(/;\s*Domain=[^;]+/i, '');
      if (!/;\s*Path=/i.test(c)) c += '; Path=/';
      out.append('set-cookie', c);
    }
  }
  return out;
}

function rewriteLocation(headers, reqUrl) {
  const out = new Headers(headers);
  const loc = headers.get('location');
  if (loc) {
    try {
      const u = new URL(loc, TARGET);
      if (u.origin === TARGET_ORIGIN) {
        // keep query string, stay on our origin
        const here = new URL(reqUrl);
        here.pathname = '/';
        here.search = u.search;
        out.set('location', here.toString());
      }
    } catch (_) {}
  }
  return out;
}

// Inject CSS to hide the Apps Script banner without touching app markup
function injectCssToHideBanner(html) {
  const css = `
    <style>
      /* Common GAS banner containers */
      #apps-script-notice, #docs-creator-notice, .apps-script-notice { display:none !important; }
      /* Fallback: hide any fixed top info strip */
      body > div[style*="position: fixed"][style*="top: 0"] { display:none !important; }
      /* Avoid layout shift after removal */
      html, body { margin-top: 0 !important; }
    </style>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', css + '</head>');
  }
  // Fallback: prepend if <head> missing (rare)
  return css + html;
}

// Rewrite only href/action attributes that explicitly point to the /exec URL
function rewriteExecLinks(html) {
  // href="https://script.google.com/.../exec?foo=bar" -> href="/?foo=bar"
  html = html.replace(
    /(href|action)=("|\')https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?[^"\']*)?("|\')/gi,
    (_m, attr, q1, qs = '', q2) => `${attr}=${q1}/${qs || ''}${q2}`
  );
  return html;
}

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    // Build upstream URL; we always hit the fixed /exec and forward query string.
    const upstreamUrl = new URL(TARGET);
    upstreamUrl.search = reqUrl.search;

    const headers = cloneHeaders(request.headers);
    headers.set('origin', TARGET_ORIGIN);
    headers.set('referer', TARGET_ORIGIN + '/');

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
    outHeaders.delete('content-encoding');

    outHeaders = rewriteSetCookie(outHeaders);
    outHeaders = rewriteLocation(outHeaders, reqUrl.toString());

    outHeaders.set('access-control-allow-origin', reqUrl.origin);
    outHeaders.set('access-control-allow-credentials', 'true');

    const ctype = (outHeaders.get('content-type') || '').toLowerCase();

    if (ctype.includes('text/html')) {
      let html = await res.text();

      // Hide banner via CSS injection (safe under CSP)
      html = injectCssToHideBanner(html);

      // Keep user on our domain by rewriting only explicit /exec links/forms
      html = rewriteExecLinks(html);

      const enc = new TextEncoder();
      const bytes = enc.encode(html);
      outHeaders.set('content-length', String(bytes.length));

      return new Response(bytes, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders
      });
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders
    });
  }
};
