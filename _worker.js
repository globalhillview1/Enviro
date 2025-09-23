// Cloudflare Pages Worker (root file: _worker.js)
// Path-aware proxy for Google Apps Script web app.
// - "/" -> your GAS /exec
// - everything else (e.g. /static/...) -> same path on script.google.com
// - HTML only: inject CSS to hide GAS banner + rewrite /exec links to "/"

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

function injectHideBannerCSS(html) {
  const css = `
    <style>
      #apps-script-notice, #docs-creator-notice, .apps-script-notice { display:none !important; }
      body > div[style*="position: fixed"][style*="top: 0"] { display:none !important; }
      html, body { margin-top: 0 !important; }
    </style>`;
  return html.includes('</head>') ? html.replace('</head>', css + '</head>') : css + html;
}

// Rewrite only href/action that point to /macros/s/<id>/exec (absolute OR relative)
function rewriteExecLinks(html) {
  return html
    // absolute https://script.google.com/macros/s/.../exec
    .replace(
      /(href|action)=("|\')https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?[^"\']*)?("|\')/gi,
      (_m, attr, q1, qs = '', q2) => `${attr}=${q1}/${qs || ''}${q2}`
    )
    // relative /macros/s/.../exec
    .replace(
      /(href|action)=("|\')\/macros\/s\/[A-Za-z0-9_-]+\/exec(\?[^"\']*)?("|\')/gi,
      (_m, attr, q1, qs = '', q2) => `${attr}=${q1}/${qs || ''}${q2}`
    );
}

function rewriteLocation(headers, reqUrl) {
  const out = new Headers(headers);
  const loc = headers.get('location');
  if (!loc) return out;

  try {
    // Resolve relative URLs against GAS origin
    const u = new URL(loc, ORIGIN);
    if (u.origin === ORIGIN) {
      const here = new URL(reqUrl);
      // Keep same path unless it's the exec path -> map to "/"
      here.pathname = (u.pathname === EXEC_PATH) ? '/' : u.pathname;
      here.search = u.search;
      here.hash = u.hash;
      out.set('location', here.toString());
    }
  } catch (_) {}
  return out;
}

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    // Build upstream URL based on path:
    // "/" -> /exec ; otherwise -> same path on script.google.com
    let upstreamUrl;
    if (reqUrl.pathname === '/' || reqUrl.pathname === '') {
      upstreamUrl = new URL(EXEC);
    } else {
      upstreamUrl = new URL(reqUrl.pathname + reqUrl.search, ORIGIN);
    }
    // Preserve query for "/" case as well
    if (reqUrl.pathname === '/' && reqUrl.search) upstreamUrl.search = reqUrl.search;

    // Prepare upstream request
    const headers = cloneHeaders(request.headers);
    headers.set('origin', ORIGIN);
    // A sane referer for static assets is the exec page
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

    // Copy headers for modifications
    let outHeaders = new Headers(res.headers);

    // Keep assets intact: only touch HTML
    const ctype = (outHeaders.get('content-type') || '').toLowerCase();

    // Keep users on our domain when upstream redirects to script.google.com
    outHeaders = rewriteLocation(outHeaders, reqUrl.toString());

    // Same-origin via proxy (usually not necessary, harmless here)
    outHeaders.set('access-control-allow-origin', reqUrl.origin);
    outHeaders.set('access-control-allow-credentials', 'true');

    if (ctype.includes('text/html')) {
      // We will edit HTML -> remove encoding to avoid mismatch
      outHeaders.delete('content-encoding');
      // Let CF set proper length after transformation
      outHeaders.delete('content-length');

      let html = await res.text();
      html = injectHideBannerCSS(html);
      html = rewriteExecLinks(html);

      return new Response(html, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders
      });
    }

    // Non-HTML: stream through unmodified (content-encoding/content-type preserved)
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders
    });
  }
};
