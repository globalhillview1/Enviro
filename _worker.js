// Cloudflare Pages Worker: reverse-proxy your Google Apps Script web app,
// hide the Apps Script banner, and keep the browser URL on your domain.

const TARGET = 'https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec';
const TARGET_ORIGIN = new URL(TARGET).origin;

// ---- helpers ----
function cloneHeaders(src) {
  const h = new Headers();
  for (const [k, v] of src.entries()) {
    if (/^host$|^cf-|^x-forwarded-|^content-length$/i.test(k)) continue;
    h.set(k, v);
  }
  return h;
}

// Rewrite Set-Cookie so session/auth cookies bind to our domain
function rewriteSetCookie(headers) {
  const out = new Headers(headers);
  const list = headers.getAll
    ? headers.getAll('set-cookie')
    : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
  if (list.length) {
    out.delete('set-cookie');
    for (let c of list) {
      // drop Domain to default to current host
      c = c.replace(/;\s*Domain=[^;]+/i, '');
      // ensure Path
      if (!/;\s*Path=/i.test(c)) c += '; Path=/';
      out.append('set-cookie', c);
    }
  }
  return out;
}

// Rewrite "Location" headers from script.google.com to our own URL space
function rewriteLocation(headers, reqUrl) {
  const out = new Headers(headers);
  const loc = headers.get('location');
  if (loc) {
    try {
      const u = new URL(loc, TARGET);
      if (u.origin === TARGET_ORIGIN) {
        // Keep path/query, but point to our origin
        const here = new URL(reqUrl);
        here.pathname = '/'; // our worker is mounted at root
        here.search = u.search; // keep any ?params
        out.set('location', here.toString());
      }
    } catch (_) {}
  }
  return out;
}

// In HTML, 1) remove the Apps Script banner, 2) rewrite hard-coded links/forms
function transformHtml(html) {
  // 1) Remove the top notice/banner (contains this exact phrase)
  html = html.replace(
    /<div[^>]*>\s*This application was created by a Google Apps Script user[\s\S]*?<\/div>/i,
    ''
  );

  // 2) Rewrite absolute references to script.google.com so users never leave our domain
  //    - <a href="https://script.google.com/.../exec?...">  -> "/?..."
  //    - <form action="https://script.google.com/.../exec"> -> "/"
  // If your app adds extra path after /exec, it will still route via this Worker.
  const execPathRegex = /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/gi;
  html = html.replace(execPathRegex, '/');

  // Some responses may contain the origin only; normalize those too.
  html = html.replace(/https:\/\/script\.google\.com/gi, '');

  return html;
}

export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);

    // Build upstream URL preserving query and appending any extra path
    const targetUrl = new URL(TARGET);
    const base = new URL(TARGET);
    targetUrl.search = reqUrl.search;

    // If you want to mount at a subpath, handle it here. We serve at root, so:
    // keep targetUrl.pathname equal to GAS /exec (Apps Script ignores extra path).

    // Forward request
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

    const upstreamRes = await fetch(targetUrl.toString(), init);

    // Copy headers so we can edit
    let outHeaders = new Headers(upstreamRes.headers);

    // Always remove content-encoding (let Cloudflare handle)
    outHeaders.delete('content-encoding');

    // Fix cookies + redirects for our domain
    outHeaders = rewriteSetCookie(outHeaders);
    outHeaders = rewriteLocation(outHeaders, reqUrl.toString());

    // Keep CORS same-origin via proxy
    outHeaders.set('access-control-allow-origin', reqUrl.origin);
    outHeaders.set('access-control-allow-credentials', 'true');

    // If it's HTML, transform it (remove banner + rewrite hard-coded links/actions)
    const ctype = outHeaders.get('content-type') || '';
    if (ctype.toLowerCase().includes('text/html')) {
      const text = await upstreamRes.text();
      const transformed = transformHtml(text);
      outHeaders.set('content-length', String(new TextEncoder().encode(transformed).length));
      return new Response(transformed, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: outHeaders
      });
    }

    // Otherwise stream as-is
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: outHeaders
    });
  }
};
