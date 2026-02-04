import HTML from '../index.html';

const TARGET = 'https://forums.jtechforums.org';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token, X-CSRF-Token, X-Cookies',
  'Access-Control-Expose-Headers': 'X-Session-Token, X-CSRF-Token, X-Cookies',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Serve static assets (uploads, avatars, images) directly without /api prefix
    const isAsset = /^\/(uploads|user_avatar|letter_avatar_proxy|images|stylesheets|optimized)\//.test(url.pathname);
    if (isAsset) {
      const upstream = TARGET + url.pathname + url.search;
      try {
        const resp = await fetch(upstream, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Referer': TARGET + '/',
            'Accept': request.headers.get('Accept') || '*/*',
          },
          redirect: 'follow',
        });
        const out = new Headers();
        const ct = resp.headers.get('Content-Type');
        if (ct) out.set('Content-Type', ct);
        out.set('Cache-Control', 'public, max-age=86400');
        out.set('Access-Control-Allow-Origin', '*');
        return new Response(resp.body, { status: resp.status, headers: out });
      } catch (e) {
        return new Response('Asset fetch failed', { status: 502 });
      }
    }

    if (!url.pathname.startsWith('/api/')) {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-cache' },
      });
    }

    const apiPath = url.pathname.slice(4);
    const upstream = TARGET + apiPath + url.search;

    const fwd = new Headers();
    fwd.set('Accept', request.headers.get('Accept') || '*/*');
    fwd.set('User-Agent', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
    // Set Referer to target so Cloudflare hotlink protection allows it
    fwd.set('Referer', TARGET + '/');

    const ct = request.headers.get('Content-Type');
    if (ct) fwd.set('Content-Type', ct);

    // Reconstruct Cookie header from client-stored cookies + session token
    const cookieParts = [];
    const clientCookies = request.headers.get('X-Cookies');
    if (clientCookies) cookieParts.push(clientCookies);
    const sessionToken = request.headers.get('X-Session-Token');
    if (sessionToken) cookieParts.push(`_t=${sessionToken}`);
    if (cookieParts.length) fwd.set('Cookie', cookieParts.join('; '));

    const csrf = request.headers.get('X-CSRF-Token');
    if (csrf) fwd.set('X-CSRF-Token', csrf);

    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    try {
      const resp = await fetch(upstream, {
        method: request.method,
        headers: fwd,
        body,
        redirect: 'follow',
      });

      const out = new Headers(CORS);
      const respCt = resp.headers.get('Content-Type');
      if (respCt) out.set('Content-Type', respCt);
      out.set('Cache-Control', 'no-store');

      // Parse all Set-Cookie headers, collect cookie key=value pairs
      const setCookies = typeof resp.headers.getSetCookie === 'function'
        ? resp.headers.getSetCookie()
        : [resp.headers.get('Set-Cookie')].filter(Boolean);

      // Build a map of cookie name -> value from existing client cookies
      const cookieMap = {};
      if (clientCookies) {
        for (const pair of clientCookies.split('; ')) {
          const eq = pair.indexOf('=');
          if (eq > 0) cookieMap[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
      }
      if (sessionToken) cookieMap['_t'] = sessionToken;

      // Merge in new cookies from response
      for (const sc of setCookies) {
        // Extract name=value (first part before ;)
        const parts = sc.split(';')[0];
        const eq = parts.indexOf('=');
        if (eq > 0) {
          const name = parts.slice(0, eq).trim();
          const val = parts.slice(eq + 1).trim();
          if (val && val !== '""' && !sc.includes('max-age=0') && !sc.includes('Max-Age=0')) {
            cookieMap[name] = val;
          } else {
            delete cookieMap[name]; // expired
          }
        }
      }

      // Send merged cookies back to client
      const mergedCookies = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
      if (mergedCookies) out.set('X-Cookies', mergedCookies);

      // Also send _t specifically for the client's session tracking
      if (cookieMap['_t']) out.set('X-Session-Token', cookieMap['_t']);

      const respCsrf = resp.headers.get('X-CSRF-Token');
      if (respCsrf) out.set('X-CSRF-Token', respCsrf);

      return new Response(resp.body, { status: resp.status, headers: out });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
  },
};
