/* ============================================================
   uv.js — Static's own proxy engine.

   WHAT THIS IS
   A service worker, registered on Static's own origin, that
   intercepts requests to /service/<encoded-url>, fetches the
   real page through an encrypted WebSocket tunnel, rewrites it,
   and serves it back as if it came from staticos.surge.sh.

   WHY IT MATTERS
   Every other approach in this project ran into the same wall:
   X-Frame-Options. A site that sends SAMEORIGIN cannot be put
   in an iframe, and no amount of client-side cleverness changes
   that — the browser enforces it before our code runs.

   This sidesteps the wall rather than attacking it. The iframe
   points at OUR origin, so SAMEORIGIN is satisfied trivially,
   and the target's CSP is rewritten away on the way through.
   That is the whole trick, and it is why this one works where
   the relays and the borrowed proxy sites did not.

   THE PIECES (all vendored, none hotlinked at runtime)
     /sw.js              the worker itself, at the root because
                         a worker's scope cannot exceed its path
     /uv/*               Ultraviolet 3.2.10 — the rewriter
     /baremux/*          bare-mux 2.1.9 — request multiplexer
     /epoxy/index.mjs    epoxy 3.0.1 — the wisp transport.
                         Chosen over libcurl because it contains
                         no SharedArrayBuffer reference, and
                         surge.sh cannot send the COOP/COEP
                         headers that SharedArrayBuffer needs.

   THE ONE THING WE DO NOT HOST
   The tunnel endpoint. A wisp server is a real server and this
   is a static site. We use public ones, with fallbacks, because
   any single free host can vanish — six of the eight candidates
   probed were already dead. WebSockets are exempt from CORS, so
   no cooperation is needed from the endpoint beyond being up.
   ============================================================ */

/* Public wisp endpoints, in preference order. All three completed a
   real Wisp handshake when probed; they are other people's
   infrastructure, so we fail over rather than depend on any one. */
export const WISP_SERVERS = [
  { id: 'mercury', name: 'Mercury',  url: 'wss://wisp.mercurywork.shop/',  note: 'Reference server from the people who wrote the transport.' },
  { id: 'terbium', name: 'Terbium',  url: 'wss://wisp.terbiumon.top/wisp/', note: 'Independent operator. Good second choice.' },
  { id: 'anura',   name: 'Anura',    url: 'wss://anura.pro/bare/',          note: 'Third fallback. The /bare/ path name is historical — it speaks wisp.' },
];

export const PREFIX = '/service/';

/* Not epoxy's own entry point: bare-mux 2.1.6 (the version Ultraviolet
   3.2.10 bundles) and epoxy 3.0.1 disagree about whether `headers` is a
   plain object or an iterable of pairs, and epoxy throws
   "headers is not iterable" before a byte reaches the tunnel. bare-mux
   catches that, Ultraviolet turns it into a bodyless 500, and the only
   visible symptom is a blank error page. The adapter normalises both
   directions — see epoxy/baremux-adapter.mjs. */
export const TRANSPORT = '/epoxy/baremux-adapter.mjs';

const state = {
  phase: 'idle',        // idle | booting | ready | failed | unsupported
  error: null,
  wisp: WISP_SERVERS[0],
  conn: null,
  registration: null,
  bootedAt: 0,
};

const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of [...listeners]) { try { fn({ ...state }); } catch (e) { /* a bad listener must not stall the boot */ } } };

export const status = () => ({ ...state });
export const isReady = () => state.phase === 'ready';

/** Service workers need a secure context; file:// and plain http (other than
    localhost) will not do. Worth checking before promising anything. */
export function isSupported() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { ok: false, why: 'This browser has no service worker support.' };
  }
  if (!window.isSecureContext) {
    return { ok: false, why: 'Static must be served over https (or localhost) for the proxy to run.' };
  }
  return { ok: true, why: '' };
}

function setPhase(phase, error = null) {
  state.phase = phase;
  state.error = error;
  emit();
}

/** Load a classic script once, resolving when it has executed. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-aether-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.aetherSrc = src;
    s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); }, { once: true });
    s.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.head.appendChild(s);
  });
}

let bootPromise = null;

/**
 * Bring the proxy up. Safe to call repeatedly — the work happens once and
 * later callers await the same promise.
 */
export function boot({ wisp } = {}) {
  if (wisp) state.wisp = typeof wisp === 'string'
    ? (WISP_SERVERS.find(w => w.url === wisp || w.id === wisp) || { id: 'custom', name: 'Custom', url: wisp, note: '' })
    : wisp;
  if (state.phase === 'ready' && !wisp) return Promise.resolve(true);
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    const support = isSupported();
    if (!support.ok) { setPhase('unsupported', new Error(support.why)); return false; }

    setPhase('booting');
    try {
      /* 1. the rewriter's client half, and the multiplexer */
      await loadScript('/uv/uv.bundle.js');
      await loadScript('/baremux/index.js');
      if (!window.BareMux) throw new Error('bare-mux did not define BareMux.');
      if (!window.Ultraviolet) throw new Error('Ultraviolet did not load.');

      /* 2. the service worker, at the root so its scope covers /service/ */
      state.registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      /* 3. the tunnel. Try each wisp endpoint until one takes. */
      const order = [state.wisp, ...WISP_SERVERS.filter(w => w.url !== state.wisp.url)];
      let lastErr = null;
      for (const server of order) {
        try {
          const conn = new window.BareMux.BareMuxConnection('/baremux/worker.js');
          await conn.setTransport(TRANSPORT, [{ wisp: server.url }]);
          state.conn = conn;
          state.wisp = server;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw new Error(`No tunnel would accept a connection. Last error: ${lastErr.message}`);

      state.bootedAt = Date.now();
      setPhase('ready');
      return true;
    } catch (err) {
      setPhase('failed', err);
      return false;
    } finally {
      bootPromise = null;
    }
  })();

  return bootPromise;
}

/** Switch tunnels without tearing the worker down. */
export async function useWisp(server) {
  const target = typeof server === 'string'
    ? (WISP_SERVERS.find(w => w.id === server || w.url === server) || { id: 'custom', name: 'Custom', url: server, note: '' })
    : server;
  if (!state.conn) return boot({ wisp: target });
  try {
    await state.conn.setTransport(TRANSPORT, [{ wisp: target.url }]);
    state.wisp = target;
    emit();
    return true;
  } catch (err) {
    setPhase('failed', err);
    return false;
  }
}

/** A target URL -> the same-origin path that renders it. */
export function encode(url) {
  const target = normalise(url);
  if (!window.Ultraviolet) throw new Error('Ultraviolet is not loaded yet — call boot() first.');
  return PREFIX + window.Ultraviolet.codec.xor.encode(target);
}

/** The inverse, for reading a location back out of a proxied frame. */
export function decode(path) {
  if (!window.Ultraviolet) return '';
  const raw = String(path || '');
  const i = raw.indexOf(PREFIX);
  if (i < 0) return '';
  try { return window.Ultraviolet.codec.xor.decode(raw.slice(i + PREFIX.length)); }
  catch (err) { return ''; }
}

/** Anything typed in an address bar -> a real URL. */
export function normalise(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[a-z][\w+.-]*:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(s)) return `https://${s}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

export const hostOf = url => {
  try { return new URL(url).host; }
  catch (err) { return String(url).replace(/^\w+:\/\//, '').split('/')[0]; }
};

/** Tear the worker down — used by Settings when someone wants a clean slate. */
export async function reset() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  } catch (err) { /* nothing registered */ }
  state.conn = null;
  state.registration = null;
  setPhase('idle');
}

export default {
  WISP_SERVERS, PREFIX, boot, useWisp, encode, decode, normalise, hostOf,
  status, isReady, isSupported, onChange, reset,
};
