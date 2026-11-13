/* ============================================================
   proxy.reader.js — Static's own proxy, the part that needs no
   server at all.

   THE PROBLEM
   A proxy has to make the outbound request for you, and a static
   site cannot. So static://proxy has always had to hand the job
   to someone else's service, and most of those (proxyium,
   proxysite, croxyproxy) send X-Frame-Options or need a CSRF
   token scraped from their own page — which is why they could
   only ever open in a tab.

   THE WAY ROUND IT
   A handful of public relays re-serve any URL *with* an
   Access-Control-Allow-Origin header. That is enough for fetch()
   to read the bytes. Once Static has the HTML it does the rest
   itself: parse it, throw away everything executable, rewrite
   the links so they come back through here, and paint it with
   Static's own typography.

   The result is not a screenshot of someone else's proxy. It is
   the page, rendered as part of the OS, and it never opens a tab.

   Verified against the live relays 2026-09-24. They are flaky
   per-target (allorigins answered wikipedia.org and 522'd on
   example.com in the same minute), so `fetchPage` walks the pool
   until one returns usable HTML instead of trusting any single
   one.

   WHAT IT CANNOT DO
   Scripts are removed, so anything that is really an application
   — a webmail client, a game, a login flow — will not work here.
   That is the honest trade for needing no server. For those,
   deploy tools/aether-proxy.worker.js and switch the engine to
   "My proxy", which proxies the real thing.
   ============================================================ */

/* ---------- the relay pool -------------------------------- */

export const RELAYS = [
  {
    id: 'allorigins',
    name: 'allorigins',
    url: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    kind: 'html',
  },
  {
    id: 'allorigins-json',
    name: 'allorigins (json)',
    url: u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    kind: 'json',
    pick: d => (d && typeof d.contents === 'string' ? d.contents : ''),
  },
  {
    id: 'codetabs',
    name: 'codetabs',
    url: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    kind: 'html',
  },
  {
    id: 'corslol',
    name: 'cors.lol',
    url: u => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
    kind: 'html',
  },
  {
    id: 'corsproxy-org',
    name: 'corsproxy.org',
    url: u => `https://corsproxy.org/?${encodeURIComponent(u)}`,
    kind: 'html',
  },
  {
    id: 'isomorphic-git',
    name: 'isomorphic-git CORS',
    url: u => `https://cors.isomorphic-git.org/${u}`,
    kind: 'html',
  },
];

/** r.jina.ai returns a clean markdown rendering, with CORS. */
export const textRelay = u => `https://r.jina.ai/${u}`;

/* A worker deployed from tools/aether-proxy.worker.js, if the
   person has one. Set through the Proxy page; persisted by the
   caller. Takes priority over the public pool when present. */
export const worker = { base: '' };

const workerRelay = () => (worker.base ? {
  id: 'worker',
  name: 'my proxy',
  url: u => `${worker.base.replace(/\/$/, '')}/raw?url=${encodeURIComponent(u)}`,
  kind: 'html',
} : null);

export function pool() {
  const w = workerRelay();
  return w ? [w, ...RELAYS] : RELAYS.slice();
}

/* ---------- fetching -------------------------------------- */

const looksLikeHtml = s => /<\s*(!doctype|html|head|body|div|main|article|p|h1|table)\b/i.test(s || '');

/* A relay that is merely slow is as useless as one that is down: the
   person is watching a spinner either way. Each gets its own budget and
   the walk moves on when it runs out. */
export const RELAY_TIMEOUT = 11000;

function linked(outer, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('timeout')), ms);
  const onAbort = () => ac.abort(outer.reason);
  if (outer) {
    if (outer.aborted) ac.abort(outer.reason);
    else outer.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ac.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Ask every relay at once and take the first usable answer.
 *
 * Walking the pool in order meant the worst case was the sum of every
 * timeout — four dead relays at 11s each is 44 seconds of spinner before
 * the first honest word. Racing them costs nothing extra (these are other
 * people's servers, and only one response is read) and makes the worst
 * case one timeout rather than four.
 *
 * Returns { html, relay, tried } or throws with every failure listed.
 */
export async function fetchPage(url, { signal, onTry, timeout = RELAY_TIMEOUT } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const relays = pool();
  const tried = [];
  const race = new AbortController();
  const stop = () => race.abort();
  signal?.addEventListener('abort', stop, { once: true });

  onTry?.({ name: `${relays.length} relays`, racing: true });

  const attempt = async relay => {
    const leg = linked(race.signal, timeout);
    try {
      const res = await fetch(relay.url(url), { signal: leg.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let text;
      if (relay.kind === 'json') {
        const data = await res.json();
        text = relay.pick ? relay.pick(data) : '';
      } else {
        text = await res.text();
      }
      if (!text || text.length < 120) throw new Error('empty');
      if (!looksLikeHtml(text)) throw new Error('not HTML');
      return { html: text, relay };
    } catch (err) {
      const why = leg.signal.aborted && !race.signal.aborted
        ? `no answer in ${Math.round(timeout / 1000)}s`
        : err.message;
      tried.push(`${relay.name}: ${why}`);
      throw err;
    } finally {
      leg.done();
    }
  };

  try {
    /* Promise.any resolves on the first success and only rejects once they
       have all failed, which is exactly the semantics wanted here. */
    const won = await Promise.any(relays.map(attempt));
    onTry?.(won.relay);
    return { ...won, tried };
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const e = new Error(`No relay could reach that page.\n${tried.join('\n')}`);
    e.tried = tried;
    throw e;
  } finally {
    signal?.removeEventListener('abort', stop);
    stop();           /* cancel whichever requests are still in flight */
  }
}

/** Plain-text/markdown rendering — lighter, and a different failure mode. */
export async function fetchText(url, { signal, timeout = RELAY_TIMEOUT * 2 } = {}) {
  const leg = linked(signal, timeout);
  try {
    const res = await fetch(textRelay(url), { signal: leg.signal });
    if (!res.ok) throw new Error(`Text mode: HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) throw new Error('Text mode returned nothing.');
    return text;
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (leg.signal.aborted) throw new Error(`Text mode: no answer in ${Math.round(timeout / 1000)}s`);
    throw err;
  } finally {
    leg.done();
  }
}

/* ---------- sanitising ------------------------------------ */

/* Anything that can execute, navigate on its own, or phone home. */
const STRIP = [
  'script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'link', 'meta', 'base', 'template', 'portal',
  'svg script', 'form button[formaction]',
];

/* Chrome that is only noise once the page is inside Static. */
const CHROME = [
  '[role="banner"] nav', '.cookie', '#cookie', '[class*="cookie-banner"]',
  '[class*="newsletter"]', '[id*="newsletter"]', '[class*="paywall"]',
  '[aria-label*="advertisement" i]', '[class*="ad-slot"]', 'ins.adsbygoogle',
];

const KEEP_ATTR = new Set([
  'href', 'src', 'srcset', 'alt', 'title', 'width', 'height', 'colspan',
  'rowspan', 'datetime', 'cite', 'lang', 'dir', 'loading', 'decoding',
]);

/**
 * Turn relayed HTML into a safe DocumentFragment.
 *
 * `onLink` receives the absolute target of every anchor, so the caller
 * can route clicks back through the reader instead of the real web.
 */
export function sanitise(html, baseUrl, { onLink } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const sel of STRIP) doc.querySelectorAll(sel).forEach(n => n.remove());
  for (const sel of CHROME) {
    try { doc.querySelectorAll(sel).forEach(n => n.remove()); }
    catch (err) { /* a selector a browser dislikes is not worth failing over */ }
  }

  /* Every remaining attribute is dropped unless it is on the keep list,
     which removes all on* handlers and every data-* hook in one pass. */
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (!KEEP_ATTR.has(n)) el.removeAttribute(attr.name);
    }
  });

  const absolute = v => { try { return new URL(v, baseUrl).href; } catch (e) { return null; } };

  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    const abs = src ? absolute(src) : null;
    /* Images need no CORS, so these load straight from the origin. */
    if (abs && /^https?:/i.test(abs)) {
      img.setAttribute('src', abs);
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      img.setAttribute('referrerpolicy', 'no-referrer');
    } else {
      img.remove();
      return;
    }
    const ss = img.getAttribute('srcset');
    if (ss) {
      const out = ss.split(',').map(p => {
        const bits = p.trim().split(/\s+/);
        const a = absolute(bits[0]);
        return a ? [a, ...bits.slice(1)].join(' ') : '';
      }).filter(Boolean).join(', ');
      if (out) img.setAttribute('srcset', out); else img.removeAttribute('srcset');
    }
  });

  doc.querySelectorAll('a[href]').forEach(a => {
    const abs = absolute(a.getAttribute('href'));
    if (!abs || !/^https?:/i.test(abs)) { a.replaceWith(...a.childNodes); return; }
    a.setAttribute('href', abs);
    a.setAttribute('rel', 'noopener noreferrer nofollow');
    if (onLink) {
      a.addEventListener('click', e => { e.preventDefault(); onLink(abs); });
    }
  });

  const frag = document.createDocumentFragment();
  const body = doc.body || doc.documentElement;
  while (body.firstChild) frag.appendChild(body.firstChild);
  return {
    frag,
    title: (doc.title || '').trim(),
  };
}

/** Rough word count, so the reader can say how long the page is. */
export function readingTime(node) {
  const words = (node.textContent || '').trim().split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / 220)) };
}

export default {
  RELAYS, pool, worker, fetchPage, fetchText, sanitise, readingTime, textRelay, RELAY_TIMEOUT,
};
