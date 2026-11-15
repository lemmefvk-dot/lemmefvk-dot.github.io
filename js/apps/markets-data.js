/* ============================================================
   markets-data.js — where Static Markets gets its numbers.

   One provider, called straight from the browser (it sends
   Access-Control-Allow-Origin: *), never through a proxy:

     Twelve Data  https://api.twelvedata.com   stocks, ETFs and crypto
                  pairs (BTC/USD). Needs the person's own free API key,
                  sent only here, in an Authorization header. Free plan:
                  8 credits a minute, 800 a day (one credit per symbol per
                  call), so every call, stock or crypto, goes through one
                  shared queue that spends at most 8 a minute, and the app
                  says when it is waiting.

   Nothing else is called: fetchHost() refuses any other host. (TradingView's
   widgets are separate frames and need no key; see markets-tv.js.)
   Failures are MarketError with a code the UI turns into plain words:
     nokey badkey limit-min limit-day unknown offline down bad
   ============================================================ */
import { parseTwelveSeries, parseTwelveQuote } from './markets-lib.js';

export const TD = 'https://api.twelvedata.com';
const HOSTS = new Set(['api.twelvedata.com']);
/* the free plan's 8 a minute; tests may lower or raise it with globalThis.__MARKETS_RATE */
export const perMinute = () => Number(globalThis.__MARKETS_RATE) || 8;

export class MarketError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal?.aborted) return rej(new DOMException('aborted', 'AbortError'));
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }, { once: true });
});

/* shared by every window: the credits spent in the last 60 s */
const spent = [];
let onWait = null;
export const setWaitHandler = fn => { onWait = fn; };
export const creditsFree = (now = Date.now()) => { while (spent.length && now - spent[0] > 60000) spent.shift(); return perMinute() - spent.length; };
let dayBlockedUntil = 0;
export const dayBlocked = () => dayBlockedUntil > Date.now();

async function spend(n, signal) {
  for (;;) {
    if (creditsFree() >= n) { for (let i = 0; i < n; i++) spent.push(Date.now()); return; }
    const wait = Math.max(500, 60000 - (Date.now() - spent[0]) + 50);
    onWait?.({ ms: wait });
    await sleep(wait, signal);
  }
}

async function fetchHost(url, init, signal) {
  if (!HOSTS.has(new URL(url).host)) throw new MarketError('bad', 'Blocked: not a market-data host.');
  let res;
  try { res = await fetch(url, { ...init, signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new MarketError('offline', navigator.onLine === false ? 'You are offline.' : `Could not reach ${new URL(url).host}. This network may block it.`);
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  return { res, body };
}

/** one Twelve Data call costing `credits`; throws MarketError */
async function td(path, params, key, { credits = 1, signal } = {}) {
  if (!key) throw new MarketError('nokey', 'Your own chart, practice trading, the AI viewer and Scan need your free Twelve Data key. Add it in Settings.');
  if (dayBlocked()) throw new MarketError('limit-day', 'The free plan’s daily limit (800 requests) is used up. It resets at midnight UTC.');
  await spend(credits, signal);
  const u = new URL(TD + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const { res, body } = await fetchHost(u.href, { headers: { authorization: 'apikey ' + key } }, signal);
  const code = body?.code ?? (res.ok ? 200 : res.status);
  if (body && body.status === 'error' || !res.ok) {
    const msg = String(body?.message || '').replace(/\*\*/g, '');
    /* a working key on a plan without this endpoint: say so, in Twelve Data's own words, rather than blame the key */
    if (code === 403 && /plan|upgrad|exclusive|available/i.test(msg)) throw new MarketError('plan', `Twelve Data answered that this isn’t on your key’s plan: “${msg.replace(/https?:\/\/\S+/g, '').trim().slice(0, 160)}”`);
    if (code === 401 || code === 403) throw new MarketError('badkey', 'Twelve Data did not accept the key. Check it in Settings.');
    if (code === 429) {
      if (/day/i.test(msg)) { dayBlockedUntil = Date.now() + 3600e3; throw new MarketError('limit-day', 'The free plan’s daily limit is used up. Try again later today.'); }
      throw new MarketError('limit-min', 'Rate limit hit: the free plan allows 8 requests a minute. Wait a minute and try again.');
    }
    if (code === 400 || code === 404) throw new MarketError('unknown', msg ? msg.slice(0, 160) : 'Symbol not found.');
    throw new MarketError('down', `Twelve Data answered with an error (${code}).`);
  }
  if (!body) throw new MarketError('down', 'Twelve Data sent something unreadable.');
  return body;
}

/** our crypto symbols are BTC-USD; Twelve Data writes the pair BTC/USD */
export const isCrypto = sym => /-USD$/.test(sym);
export const tdSymbol = sym => (isCrypto(sym) ? sym.replace('-', '/') : sym);

/* ---- caches: a reply is reused for ttl ms, so a refresh never repeats a call ---- */
const cache = new Map();
async function cached(k, ttl, fn, force) {
  const hit = cache.get(k);
  if (!force && hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(k, { t: Date.now(), v });
  return v;
}
export const clearCache = () => cache.clear();

export async function quote(sym, key, { signal, force = false } = {}) {
  return cached('q:' + sym, 30000, async () => {
    try { return parseTwelveQuote(await td('/quote', { symbol: tdSymbol(sym) }, key, { signal }), sym); }
    catch (e) { if (e instanceof MarketError || e.name === 'AbortError') throw e; throw new MarketError('down', 'Twelve Data sent a quote we could not read.'); }
  }, force);
}

/** one cheap call (1 credit: AAPL's quote) to learn whether a key works. Never cached; throws MarketError (badkey = not accepted). */
export async function testKey(key, { signal } = {}) {
  const j = await td('/quote', { symbol: 'AAPL' }, key, { signal });
  return { ok: true, symbol: j.symbol || 'AAPL' };
}

/* range -> how to ask for it. Stocks: one session / 5 sessions of intraday bars; crypto trades all day, so 24 h / 5 days. */
export const RANGES = {
  '1D': { label: '1 day', iv: '5min', size: 78, cryptoSize: 288, days: 1 },
  '5D': { label: '5 days', iv: '30min', size: 70, cryptoSize: 240, days: 5 },
  '1M': { label: '1 month', iv: '1day', days: 31, daily: true },
  '6M': { label: '6 months', iv: '1day', days: 183, daily: true },
  '1Y': { label: '1 year', iv: '1day', days: 366, daily: true },
  '5Y': { label: '5 years', iv: '1week', size: 270, days: 1830 },
};
/** bars for a range as { bars, iv, tz } — daily ranges share one 300-bar daily series, which also warms the indicators */
export async function bars(sym, range, key, { signal, force = false } = {}) {
  const R = RANGES[range];
  const crypto = isCrypto(sym);
  const ttl = R.daily ? 30 * 60e3 : 60e3;
  const k = `b:${sym}:${R.daily ? 'D' : range}`;
  return cached(k, ttl, async () => {
    try {
      const size = R.daily ? 300 : crypto ? R.cryptoSize : R.size;
      const p = parseTwelveSeries(await td('/time_series', { symbol: tdSymbol(sym), interval: R.iv, outputsize: size }, key, { signal }));
      let b = p.bars;
      if (range === '1D' && !crypto && b.length) { const d = b[b.length - 1].d; b = b.filter(x => x.d === d); }
      return { bars: b, iv: { '5min': '5 min', '30min': '30 min', '1day': '1 day', '1week': '1 week' }[R.iv], tz: p.tz };
    } catch (e) { if (e instanceof MarketError || e.name === 'AbortError') throw e; throw new MarketError('down', 'The data provider sent a chart we could not read.'); }
  }, force);
}
/* ---- dividends and splits: only what Twelve Data returns ----
   Its /dividends and /splits cost 20 credits each and, at the time of
   writing, are on its paid Grow plan and up. A free key's 8-a-minute
   allowance can never hold 20, so the shared queue spends at most what
   the minute allows and lets Twelve Data say no; its answer is shown as
   it is. Asked for only when the person presses the button, then kept
   for 12 hours. -> { dividends:[{ date, amount }], splits:[{ date, text }], currency } */
export const EVENT_CREDITS = 20;
export async function events(sym, key, { signal } = {}) {
  if (isCrypto(sym)) throw new MarketError('unknown', 'Crypto pairs have no dividends or splits.');
  const credits = Math.min(EVENT_CREDITS, perMinute());
  return cached('e:' + sym, 12 * 3600e3, async () => {
    const [dv, sp] = await Promise.allSettled([
      td('/dividends', { symbol: sym, range: '5y' }, key, { credits, signal }),
      td('/splits', { symbol: sym, range: '5y' }, key, { credits, signal }),
    ]);
    for (const r of [dv, sp]) if (r.status === 'rejected' && r.reason?.name === 'AbortError') throw r.reason;
    if (dv.status === 'rejected' && sp.status === 'rejected') throw dv.reason;
    const okDate = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? s : null);
    const D = dv.status === 'fulfilled' ? dv.value : null, S = sp.status === 'fulfilled' ? sp.value : null;
    const dividends = D ? (Array.isArray(D.dividends) ? D.dividends : []).map(r => ({ date: okDate(r.ex_date), amount: Number(r.amount) })).filter(r => r.date && Number.isFinite(r.amount)) : null;
    const splits = S ? (Array.isArray(S.splits) ? S.splits : []).map(r => ({ date: okDate(r.date), text: String(r.description || `${r.to_factor} for ${r.from_factor}`).slice(0, 80) })).filter(r => r.date) : null;
    return { dividends, splits, divErr: D ? '' : dv.reason?.message || 'No answer.', splitErr: S ? '' : sp.reason?.message || 'No answer.', currency: String(D?.meta?.currency || 'USD').slice(0, 5) };
  });
}

/** keep the bars of a daily series that fall in the last `days` days of its own latest date */
export function sliceDays(bs, days) {
  if (!bs.length) return bs;
  const end = bs[bs.length - 1].t;
  return bs.filter(b => b.t > end - days * 86400e3);
}

/* ---- search: Twelve Data's symbol_search, stocks and ETFs in the US plus crypto pairs against USD ---- */
export async function search(q, key, { signal } = {}) {
  const term = q.trim();
  if (!term) return { results: [], note: '' };
  if (!key) return { results: [], note: 'Searching needs your free Twelve Data key (Settings). You can still chart any symbol with TradingView from the watchlist.' };
  const j = await cached('s:' + term.toLowerCase(), 600e3, () => td('/symbol_search', { symbol: term, outputsize: 30 }, key, { signal }));
  const out = [];
  for (const r of j.data || []) {
    if (r.instrument_type === 'Digital Currency') {
      if (!/\/USD$/.test(r.symbol)) continue;
      const sym = r.symbol.replace('/', '-');
      if (!out.some(o => o.sym === sym)) out.push({ sym, name: r.symbol.split('/')[0] + ' (crypto)', exch: 'Crypto', kind: 'crypto' });
      continue;
    }
    if (!/^(common stock|etf|exchange traded fund|adr|reit|depositary receipt)/i.test(r.instrument_type || '') || r.country !== 'United States') continue;
    if (!out.some(o => o.sym === r.symbol)) out.push({ sym: r.symbol, name: r.instrument_name, exch: r.exchange, kind: 'stock' });
  }
  return { results: out.slice(0, 14), note: '' };
}
