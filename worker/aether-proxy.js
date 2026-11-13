/* ============================================================
   aether-proxy.worker.js — Static's own proxy.

   Everything else in this project is static, which is exactly
   why the proxy page had to borrow other people's services: a
   proxy needs a server to make the outbound request. This is
   that server, in one file, on a free tier.

   DEPLOY (about two minutes, no build step)
     1. https://dash.cloudflare.com -> Workers & Pages
     2. Create -> Worker -> name it "aether-proxy" -> Deploy
     3. Edit code, paste this whole file over the default, Deploy
     4. Copy the URL, e.g. https://aether-proxy.<you>.workers.dev
     5. In Static: Proxy page -> Engine -> "My proxy" -> paste it

   Or with wrangler:
     npx wrangler deploy tools/aether-proxy.worker.js --name aether-proxy

   WHAT IT DOES
     /                      a plain status page
     /p/<url>               full proxy: fetches <url>, rewrites every
                            link, src, srcset, form action and CSS
                            url() so they come back through here, and
                            strips the upstream's frame-blocking
                            headers so Static can render it in-window
     /raw?url=<url>         untouched bytes plus CORS, for reading an
                            API that refuses cross-origin requests
                            (this is what turns Roblox's live player
                            counts back on — see js/portal/roblox.data.js)

   NOTES
     · Free tier is 100k requests/day, which is far more than one
       person browsing uses.
     · Sites that require a login, or that check for a real browser
       fingerprint, will still push back. No proxy fixes that.
     · ALLOW below is open by default. Set it to your own origins
       if you ever put the worker somewhere public.
   ============================================================ */

const ALLOW = '*';                 // or 'https://staticos.surge.sh'
const MAX_BYTES = 25 * 1024 * 1024;

const HOP = new Set([
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
  'cross-origin-resource-policy', 'content-encoding', 'content-length',
  'transfer-encoding', 'connection', 'keep-alive', 'strict-transport-security',
  'permissions-policy', 'report-to', 'nel',
]);

const cors = h => {
  h.set('access-control-allow-origin', ALLOW);
  h.set('access-control-allow-methods', 'GET,POST,HEAD,OPTIONS');
  h.set('access-control-allow-headers', '*');
  h.set('access-control-expose-headers', '*');
  return h;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const self = `${url.protocol}//${url.host}`;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(new Headers()) });
    }

    /* ---- /raw?url= : bytes + CORS, nothing rewritten ---- */
    if (url.pathname === '/raw') {
      const target = url.searchParams.get('url');
      if (!target) return bad('Add ?url=<absolute url>');
      return passthrough(target, request);
    }

    /* ---- /p/<url> : the proxy proper ---- */
    if (url.pathname === '/p' || url.pathname.startsWith('/p/')) {
      let target = url.pathname.slice(3) + url.search + url.hash;
      target = target.replace(/^\/+/, '');
      if (!target) return bad('Add a target: /p/https://example.com');
      /* tolerate both /p/https://x and /p/https%3A%2F%2Fx */
      if (!/^https?:\/\//i.test(target)) {
        try { target = decodeURIComponent(target); } catch (e) { /* leave as-is */ }
      }
      if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
      return proxy(target, request, self);
    }

    return status(self);
  },
};

/* ------------------------------------------------------------------ */

function bad(msg, code = 400) {
  return new Response(msg, { status: code, headers: cors(new Headers({ 'content-type': 'text/plain' })) });
}

function upstreamHeaders(request, target) {
  const h = new Headers();
  const copy = ['accept', 'accept-language', 'content-type', 'range'];
  for (const k of copy) {
    const v = request.headers.get(k);
    if (v) h.set(k, v);
  }
  /* A plain desktop UA gets past most "is this a browser" checks. Sending
     the visitor's own UA would leak more than the proxy needs to. */
  h.set('user-agent',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  h.set('accept-encoding', 'gzip');
  try { h.set('referer', new URL(target).origin + '/'); } catch (e) { /* ignore */ }
  return h;
}

async function passthrough(target, request) {
  let res;
  try {
    res = await fetch(target, {
      method: request.method === 'POST' ? 'POST' : 'GET',
      headers: upstreamHeaders(request, target),
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'follow',
    });
  } catch (err) {
    return bad(`Upstream failed: ${err.message}`, 502);
  }
  const h = new Headers();
  for (const [k, v] of res.headers) if (!HOP.has(k.toLowerCase())) h.set(k, v);
  cors(h);
  return new Response(res.body, { status: res.status, headers: h });
}

async function proxy(target, request, self) {
  let t;
  try { t = new URL(target); } catch (err) { return bad(`Not a URL: ${target}`); }
  if (!/^https?:$/.test(t.protocol)) return bad('Only http and https');

  let res;
  try {
    res = await fetch(t.href, {
      method: request.method === 'POST' ? 'POST' : 'GET',
      headers: upstreamHeaders(request, t.href),
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
    });
  } catch (err) {
    return bad(`Could not reach ${t.host}: ${err.message}`, 502);
  }

  /* Follow redirects ourselves so the browser stays on the proxy origin. */
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) {
      const next = new URL(loc, t.href).href;
      const h = cors(new Headers({ location: `${self}/p/${next}` }));
      return new Response(null, { status: 302, headers: h });
    }
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const h = new Headers();
  for (const [k, v] of res.headers) if (!HOP.has(k.toLowerCase())) h.set(k, v);
  cors(h);
  /* Explicitly frameable: this is the whole point. */
  h.set('x-aether-proxy', t.host);

  if (ct.includes('text/html')) {
    return new HTMLRewriter()
      .on('*', new Attrs(t, self))
      .on('head', new Injector(t, self))
      .on('style', new Styles(t, self))
      .transform(new Response(res.body, { status: res.status, headers: h }));
  }

  if (ct.includes('text/css')) {
    const css = await res.text();
    return new Response(rewriteCss(css, t, self), { status: res.status, headers: h });
  }

  return new Response(res.body, { status: res.status, headers: h });
}

/* ---------- rewriting ------------------------------------- */

const abs = (v, base) => { try { return new URL(v, base).href; } catch (e) { return null; } };
const via = (v, base, self) => {
  const a = abs(v, base);
  return a && /^https?:/i.test(a) ? `${self}/p/${a}` : null;
};

/* Attributes that carry a URL, per element. */
const URL_ATTRS = ['href', 'src', 'action', 'poster', 'data-src', 'formaction'];

class Attrs {
  constructor(base, self) { this.base = base; this.self = self; }
  element(el) {
    for (const a of URL_ATTRS) {
      const v = el.getAttribute(a);
      if (!v || v.startsWith('data:') || v.startsWith('blob:')
          || v.startsWith('#') || v.startsWith('javascript:') || v.startsWith('mailto:')) continue;
      const out = via(v, this.base, this.self);
      if (out) el.setAttribute(a, out);
    }
    const ss = el.getAttribute('srcset');
    if (ss) {
      const out = ss.split(',').map(part => {
        const bits = part.trim().split(/\s+/);
        const u = via(bits[0], this.base, this.self);
        return u ? [u, ...bits.slice(1)].join(' ') : part.trim();
      }).join(', ');
      el.setAttribute('srcset', out);
    }
    const style = el.getAttribute('style');
    if (style && style.includes('url(')) el.setAttribute('style', rewriteCss(style, this.base, this.self));
    /* integrity hashes never match a rewritten body */
    if (el.getAttribute('integrity')) el.removeAttribute('integrity');
    /* keep target=_blank inside the frame */
    if (el.getAttribute('target') === '_blank') el.removeAttribute('target');
  }
}

class Styles {
  constructor(base, self) { this.base = base; this.self = self; this.buf = ''; }
  text(t) {
    this.buf += t.text;
    if (t.lastInTextNode) {
      t.replace(rewriteCss(this.buf, this.base, this.self), { html: true });
      this.buf = '';
    } else {
      t.remove();
    }
  }
}

function rewriteCss(css, base, self) {
  return String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
    if (/^(data:|blob:|#)/i.test(u)) return m;
    const out = via(u, base, self);
    return out ? `url(${q}${out}${q})` : m;
  });
}

/* A small shim so scripts that navigate or fetch at runtime stay proxied. */
class Injector {
  constructor(base, self) { this.base = base; this.self = self; }
  element(el) {
    const shim = `
<base href="${this.self}/p/${this.base.href}">
<script>(function(){
  var SELF=${JSON.stringify(this.self)}, BASE=${JSON.stringify(this.base.href)};
  function wrap(u){
    try{
      if(!u) return u;
      u=String(u);
      if(u.indexOf(SELF)===0||/^(data|blob|javascript|mailto|about):/i.test(u)) return u;
      return SELF+'/p/'+new URL(u,BASE).href;
    }catch(e){return u}
  }
  var of_=window.fetch;
  window.fetch=function(i,o){
    try{ i=(typeof i==='string'||i instanceof URL)?wrap(i):new Request(wrap(i.url),i); }catch(e){}
    return of_.call(this,i,o);
  };
  var op=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    arguments[1]=wrap(u); return op.apply(this,arguments);
  };
  var ow=window.open;
  window.open=function(u,n,f){ return ow.call(window,wrap(u),'_self',f); };
})();</script>`;
    el.prepend(shim, { html: true });
  }
}

/* ---------- status page ----------------------------------- */

function status(self) {
  const body = `Static proxy is running.

  ${self}/p/https://example.com     proxy a page
  ${self}/raw?url=https://…         raw bytes + CORS

Paste ${self} into Static: Proxy -> Engine -> My proxy.
`;
  return new Response(body, {
    headers: cors(new Headers({ 'content-type': 'text/plain; charset=utf-8' })),
  });
}
