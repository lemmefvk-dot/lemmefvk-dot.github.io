/* ============================================================
   proxies.js — the backends behind static://proxy.

   Static owns the chrome: the address bar, the server picker and
   the viewport are all ours. These services only fetch the page.

   Each entry declares how it is reached and, honestly, whether
   it can render INSIDE our window:

     mode 'frame'  the host allows embedding, so the result loads
                   in our own viewport under the Static toolbar
     mode 'tab'    the host sends X-Frame-Options / is bot-gated,
                   so it can only open in a real browser tab

   Verified 2026-09-22 against the live hosts:
     4everproxy  no frame-blocking headers ....... frame
     proxyium    x-frame-options: SAMEORIGIN ..... tab
     proxysite   SAMEORIGIN + Cloudflare 403 ..... tab
   ============================================================ */


/* ==================================================================
   ENGINES — what the Proxy page actually offers.

   The old SERVERS list is still below, because 4everproxy is a
   genuinely useful frame target and the two tab-only services are
   worth keeping as a last resort. But the page leads with the two
   engines Static owns, so the common case never leaves the window.

   Re-probed 2026-09-24:
     croxyproxy / blockaway / croxyproxy.rocks  frameable, but every
       one of them POSTs to /servers with a per-session CSRF token
       that can only be read from their own page — and reading it
       cross-origin is exactly what CORS forbids. Embedding them
       would mean dumping you on their search box, which is the one
       thing this page exists to avoid. Left out on purpose.
     hide.me / proxysite / proxyium               SAMEORIGIN, tab only.
   ================================================================== */

export const ENGINES = [
  {
    id: 'reader',
    name: 'Static Reader',
    kind: 'reader',
    badge: 'in page',
    tone: 'ok',
        blurb: 'Ours. Races six public CORS relays and repaints the first usable response in Static. '
          + 'Never opens a tab. Text, images and links work; scripts do not.',
  },
  {
    id: 'worker',
    name: 'My proxy',
    kind: 'worker',
    badge: 'in page',
    tone: 'ok',
    needsSetup: true,
    blurb: 'Ours, and the real thing — a Cloudflare Worker you deploy in two minutes from '
         + 'tools/aether-proxy.worker.js. Full pages, scripts included, inside the window.',
  },
  {
    id: '4everproxy',
    name: '4everproxy',
    kind: 'frame',
    badge: 'in page',
    tone: 'ok',
    server: '4everproxy',
    blurb: 'Someone else’s, but it allows embedding, so it loads under Static’s toolbar. '
         + 'Pick the country the request exits from.',
  },
  {
    id: 'text',
    name: 'Text mode',
    kind: 'text',
    badge: 'in page',
    tone: 'ok',
    blurb: 'Ours. Strips a page to clean readable text through r.jina.ai. Lightest option, '
         + 'and it gets through when the others are rate-limited.',
  },
];

export const engineById = id => ENGINES.find(e => e.id === id) || ENGINES[0];
export const inPageEngines = () => ENGINES.filter(e => e.kind !== 'tab');

export const SERVERS = [
  {
    id: '4everproxy',
    name: '4everproxy',
    host: 'www.4everproxy.com',
    mode: 'frame',
    endpoint: 'https://www.4everproxy.com/query',
    method: 'post',
    blurb: 'Loads inside Static. Pick the country the request exits from.',
    defaultLocation: 'qc',
    locations: [
      { id: 'qc', name: 'Canada · Quebec' },
      { id: 'ny', name: 'United States · New York' },
      { id: 'lv', name: 'United States · Las Vegas' },
      { id: 'uk', name: 'United Kingdom · London' },
      { id: 'de', name: 'Germany · Frankfurt' },
      { id: 'lux', name: 'Luxembourg · Roost' },
      { id: 'sg', name: 'Singapore' },
      { id: 'au', name: 'Australia · Sydney' },
    ],
    fields: (url, o = {}) => ({
      u: url,
      u_default: 'https://www.google.com/',
      server_name: o.location || 'qc',
      selip: 'random',
      customip: '',
      ...(o.allowCookies === false ? {} : { allowCookies: 'on' }),
      ...(o.stripJS ? { stripJS: 'on' } : {}),
    }),
  },
  {
    id: 'proxyium',
    name: 'Proxyium',
    host: 'proxyium.com',
    mode: 'tab',
    endpoint: 'https://cdn.proxyium.com/proxyrequest.php',
    method: 'post',
    blurb: 'Sends X-Frame-Options, so it cannot render inside Static and is not offered here.',
    defaultLocation: '',
    locations: [],
    fields: (url, o = {}) => ({ url, type: '', proxy_country: o.location || '' }),
  },
  {
    id: 'proxysite',
    name: 'ProxySite',
    host: 'www.proxysite.com',
    mode: 'tab',
    endpoint: 'https://www.proxysite.com/',
    method: 'get',
    deepLink: false,
    blurb: 'Bot-gated and frame-blocked, so Static can only hand you its own page.',
    defaultLocation: '',
    locations: [],
    fields: () => ({}),
  },
];

export const byId = id => SERVERS.find(s => s.id === id) || SERVERS[0];
export const framers = () => SERVERS.filter(s => s.mode === 'frame');

/** Anything typed in the bar -> a real target URL. */
export function normaliseTarget(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[a-z][\w+.-]*:\/\//i.test(s)) return s;
  /* a bare host, with or without a path */
  if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(s)) return `https://${s}`;
  /* otherwise treat it as a search */
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

export const hostOf = url => {
  try { return new URL(url).host; } catch (err) { return String(url).replace(/^\w+:\/\//, '').split('/')[0]; }
};

/**
 * Submit a target through a server.
 *   target: 'frame-name' for mode 'frame', '_blank' for mode 'tab'.
 * Returns the <form> so the caller can remove it; the browser does the rest.
 * A real form POST is used because these endpoints are cross-origin — fetch()
 * could never read or display the response.
 */
export function submit(server, url, { target, location, allowCookies, stripJS } = {}) {
  if (!server || !url) return null;

  if (server.method === 'get' && server.deepLink === false) {
    /* nothing to hand it — just open the service itself */
    return null;
  }

  const form = document.createElement('form');
  form.method = server.method || 'post';
  form.action = server.endpoint;
  form.target = target || '_self';
  form.rel = 'noopener';
  form.style.display = 'none';

  const fields = server.fields(url, { location, allowCookies, stripJS });
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v == null ? '' : String(v);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 1000);
  return form;
}

export default {
  SERVERS, ENGINES, engineById, inPageEngines,
  byId, framers, normaliseTarget, hostOf, submit,
};
