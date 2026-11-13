/* ============================================================
   markets-tv.js — TradingView's free widgets, in frames of their own.

   Each widget is an <iframe> pointed straight at the address
   TradingView's own embed script builds (the documented widget host,
   with the settings in the URL hash) — we never run their script in
   StaticOS's page. The frame is cross-origin (www.tradingview-widget.com),
   so it cannot read StaticOS's storage or its window; the sandbox
   attribute adds to that: no forms, no top navigation, no downloads,
   no same-site anything. It keeps allow-same-origin only so TradingView's
   own page can use ITS OWN origin (without it their widget draws
   nothing: it needs its own storage and CORS requests); because the
   address is another origin, that grants nothing over ours, and
   widgetUrl() refuses any other host.

   TradingView shows its logo inside each widget and asks that attribution
   stay as designed, so the "Track all markets on TradingView" link they
   ship with the snippet sits under every widget, unchanged, opening
   tradingview.com in a new tab. Nothing here connects a broker, and
   nothing in StaticOS can read TradingView's prices: practice fills use
   the app's own data (markets-data.js).
   ============================================================ */
import { h } from '../core/dom.js';

export const TV_HOST = 'https://www.tradingview-widget.com';
export const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';
const NAMES = new Set(['advanced-chart', 'technical-analysis', 'screener', 'crypto-mkt-screener']);
const EXCH = { NASDAQ: 'NASDAQ', NYSE: 'NYSE', AMEX: 'AMEX', 'NYSE ARCA': 'AMEX', 'NYSE AMERICAN': 'AMEX', BATS: 'BATS' };

/** TradingView's symbol for ours: COINBASE:BTCUSD for BTC-USD, NASDAQ:AAPL when we know the exchange */
export function tvSymbol(sym, exch) {
  if (/-USD$/.test(sym)) return 'COINBASE:' + sym.replace('-', '');
  const e = EXCH[String(exch || '').toUpperCase()];
  return e ? `${e}:${sym}` : sym;
}
export function widgetUrl(name, settings) {
  if (!NAMES.has(name)) throw new Error('unknown widget ' + name);
  const u = new URL(`${TV_HOST}/embed-widget/${name}/`);
  u.searchParams.set('locale', 'en');
  u.hash = encodeURIComponent(JSON.stringify(settings));
  if (u.origin !== TV_HOST) throw new Error('not the TradingView widget host');
  return u.href;
}

let probe = null;                    /* { ok, t } the last reachability check */
/** can this network reach TradingView at all? (an opaque no-cors request: success or failure only) */
export async function reachable(signal) {
  if (probe && probe.ok && Date.now() - probe.t < 5 * 60e3) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  signal?.addEventListener('abort', () => ac.abort(), { once: true });
  try { await fetch(TV_HOST + '/', { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ac.signal }); probe = { ok: true, t: Date.now() }; return true; }
  catch (e) { if (signal?.aborted) throw e; probe = { ok: false, t: Date.now() }; return false; }
  finally { clearTimeout(t); }
}
export const forgetProbe = () => { probe = null; };

/**
 * createTV({ name, settings, title, height, fallback }) -> { el, destroy }
 * el is a box with the frame (or, when TradingView cannot be reached, a plain
 * message and a Retry button) and the attribution link under it.
 */
export function createTV({ name, settings, title, height = 420, fallback = '' }) {
  let dead = false, slowT = 0;
  const ac = new AbortController();
  const status = h('div.mk__tvmsg', { role: 'status', 'aria-live': 'polite', text: 'Loading TradingView…' });
  const box = h('div.mk__tv', { style: { height: height + 'px' }, dataset: { widget: name } }, status);
  const credit = h('a.mk__tvcredit', { href: 'https://www.tradingview.com/', target: '_blank', rel: 'noopener noreferrer', text: 'Track all markets on TradingView' });
  const el = h('div.mk__tvwrap', box, credit);
  let frame = null;

  function fail(text) {
    frame?.remove(); frame = null; clearTimeout(slowT);
    box.replaceChildren(h('div.mk__tvmsg', { role: 'alert', dataset: { failed: '1' } },
      h('p', { text }), fallback ? h('p.mk__sub', { text: fallback }) : null,
      h('button.mk__btn', { type: 'button', text: 'Try again', onclick: () => { forgetProbe(); box.replaceChildren(status); status.textContent = 'Loading TradingView…'; start(); } })));
  }
  async function start() {
    let ok;
    try { ok = await reachable(ac.signal); } catch (e) { return; }
    if (dead) return;
    if (!ok) return fail('TradingView could not be loaded. You may be offline, or this network blocks tradingview-widget.com.');
    frame = h('iframe.mk__tvframe', {
      src: widgetUrl(name, settings), title, sandbox: SANDBOX, loading: 'eager', referrerpolicy: 'strict-origin-when-cross-origin',
      allow: '', dataset: { widget: name },
    });
    frame.addEventListener('load', () => { clearTimeout(slowT); status.remove(); });
    box.append(frame);
    slowT = setTimeout(() => { if (!dead && status.isConnected) status.textContent = 'TradingView is slow to answer. Still waiting…'; }, 15000);
  }
  start();
  return { el, destroy() { dead = true; ac.abort(); clearTimeout(slowT); frame?.remove(); } };
}
