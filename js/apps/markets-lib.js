/* ============================================================
   markets-lib.js — the arithmetic behind Static Markets, with no DOM.

   · indicators (SMA, EMA, RSI, MACD, Bollinger) computed from bars
   · market-session labels in the exchange's own time zone
   · the practice account: integer cents, quantities in millionths of a
     share/coin (1 share = 1,000,000), BigInt for every multiply-divide
   · the rule-based scan, and the text summary handed to the AI

   Nothing here invents a number: every function takes real bars/quotes
   and returns something computed from them.
   ============================================================ */

export const UNIT = 1000000;                  /* quantity units per share / coin */

/* ---------------- money: integer cents --------------------------- */
/** a - b*c/d, rounded half up, exact for any size */
export function mulDiv(a, b, d) {
  const n = BigInt(a) * BigInt(b);
  const D = BigInt(d);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = (2n * abs + D) / (2n * D);
  return Number(neg ? -q : q);
}
/** cost in cents of qty units at a price in cents */
export const costOf = (qty, priceCents) => mulDiv(qty, priceCents, UNIT);
export const toCents = v => Math.round(Number(v) * 100);
export function fmtMoney(c, { sign = false } = {}) {
  const neg = c < 0;
  const a = Math.abs(c);
  const s = '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0');
  return (neg ? '-' : sign && c > 0 ? '+' : '') + s;
}
export function fmtQty(q) {
  const w = Math.floor(q / UNIT), f = q % UNIT;
  return f ? (w + '.' + String(f).padStart(6, '0').replace(/0+$/, '')) : String(w);
}
/** "12.5" -> 12500000, or null when it is not a plain positive number with at most 6 decimals */
export function parseQty(s) {
  const m = /^\s*(\d+)(?:\.(\d{1,6}))?\s*$/.exec(String(s));
  if (!m) return null;
  const q = Number(m[1]) * UNIT + Number((m[2] || '').padEnd(6, '0') || 0);
  return q > 0 && Number.isSafeInteger(q) ? q : null;
}
/** "$1,234.50" or "1234.5" -> cents, or null */
export function parseMoney(s) {
  const m = /^\s*\$?\s*(\d[\d,]*)(?:\.(\d{1,2}))?\s*$/.exec(String(s));
  if (!m) return null;
  const c = Number(m[1].replace(/,/g, '')) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
  return Number.isSafeInteger(c) ? c : null;
}

/* ---------------- indicators ------------------------------------ */
export function sma(v, n) {
  const out = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
/** seeded with the SMA of the first n values, then k = 2/(n+1) */
export function ema(v, n) {
  const out = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += v[i];
  e /= n;
  out[n - 1] = e;
  for (let i = n; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
/** Wilder's RSI */
export function rsi(v, n = 14) {
  const out = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
    l = (l * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  }
  return out;
}
export function macd(v, fast = 12, slow = 26, sig = 9) {
  const f = ema(v, fast), s = ema(v, slow);
  const line = v.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const first = line.findIndex(x => x != null);
  const signal = new Array(v.length).fill(null);
  if (first >= 0) {
    const e = ema(line.slice(first), sig);
    e.forEach((x, i) => { signal[first + i] = x; });
  }
  const hist = line.map((x, i) => (x != null && signal[i] != null ? x - signal[i] : null));
  return { line, signal, hist };
}
/** population standard deviation, as Bollinger specified */
export function bollinger(v, n = 20, k = 2) {
  const mid = sma(v, n);
  const up = new Array(v.length).fill(null), lo = new Array(v.length).fill(null);
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    up[i] = mid[i] + k * sd; lo[i] = mid[i] - k * sd;
  }
  return { mid, up, lo };
}
export function indicatorsOf(bars) {
  const c = bars.map(b => b.c);
  return { sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200), ema20: ema(c, 20), rsi: rsi(c, 14), macd: macd(c), bb: bollinger(c) };
}

/* ---------------- time zones and market sessions ----------------- */
const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) dtfCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  return dtfCache.get(tz);
}
export function zoned(ms, tz) {
  const p = {};
  for (const x of dtf(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: p.weekday, date: `${p.year}-${p.month}-${p.day}` };
}
/** "2026-11-03 15:55:00" read in tz -> epoch ms */
export function zonedToEpoch(str, tz) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?$/.exec(str);
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const off = t => { const z = zoned(t, tz); return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - t; };
  let t = guess - off(guess);
  t = guess - off(t);
  return t;
}
/** The exchange's clock as a schedule: regular 9:30-16:00, pre 4:00-9:30, after 16:00-20:00, Mon-Fri.
    Holidays are not known here; the quote's own is_market_open says when a "regular" day is closed. */
export function sessionState(now, tz = 'America/New_York', { kind = 'stock', isOpen = null } = {}) {
  if (kind === 'crypto') return { state: 'open', label: 'Trades 24/7' };
  const z = zoned(now, tz);
  const mins = z.h * 60 + z.mi;
  const zone = tz === 'America/New_York' ? 'ET' : tz;
  if (z.wd === 'Sat' || z.wd === 'Sun') return { state: 'weekend', label: `Closed for the weekend (${zone})` };
  if (mins >= 570 && mins < 960) {
    if (isOpen === false) return { state: 'closed', label: `Closed today (holiday or no trading) (${zone})` };
    return { state: 'open', label: `Market open (${zone})` };
  }
  if (mins >= 240 && mins < 570) return { state: 'pre', label: `Pre-market, regular session opens 9:30 ${zone}` };
  if (mins >= 960 && mins < 1200) return { state: 'after', label: `After hours, closed since 4:00 pm ${zone}` };
  return { state: 'closed', label: `Closed, opens 9:30 am ${zone}` };
}
export function ago(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 172800) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}

/* ---------------- parsing provider replies ------------------------ */
const num = x => (x == null || x === '' ? null : Number(x));
/** Twelve Data time_series -> oldest-first bars. Throws on a malformed reply. */
export function parseTwelveSeries(j) {
  if (!j || !Array.isArray(j.values)) throw new Error('no values');
  const tz = j.meta?.exchange_timezone || (j.meta?.type === 'Digital Currency' ? 'UTC' : 'America/New_York');
  const bars = j.values.map(r => {
    const daily = r.datetime.length <= 10;
    const o = num(r.open), h = num(r.high), l = num(r.low), c = num(r.close);
    if ([o, h, l, c].some(x => x == null || !Number.isFinite(x))) throw new Error('bad bar');
    return { d: r.datetime.slice(0, 10), t: daily ? Date.UTC(+r.datetime.slice(0, 4), +r.datetime.slice(5, 7) - 1, +r.datetime.slice(8, 10)) : zonedToEpoch(r.datetime, tz), o, h, l, c, v: num(r.volume) };
  });
  return { tz, bars: bars.reverse() };
}
/** sym is our own symbol (AAPL, BTC-USD); Twelve Data calls the crypto pair BTC/USD */
export function parseTwelveQuote(j, sym = j.symbol) {
  const f = j.fifty_two_week || {};
  const crypto = /-USD$/.test(sym);
  return {
    sym, name: j.name, exch: j.exchange, tz: crypto ? 'UTC' : 'America/New_York', kind: crypto ? 'crypto' : 'stock', source: 'Twelve Data',
    price: toCents(j.close), prevClose: toCents(j.previous_close), open: toCents(j.open), high: toCents(j.high), low: toCents(j.low),
    volume: num(j.volume), asOf: (j.last_quote_at || j.timestamp) * 1000, isOpen: j.is_market_open,
    hi52: f.high != null ? toCents(f.high) : null, lo52: f.low != null ? toCents(f.low) : null, currency: j.currency,
  };
}

/* ---------------- the practice account ----------------------------
   Practice costs are the person's own settings, never market data:
     costs = { feeFlat: cents per filled order, feeBps: basis points of
               the order's value (100 = 1%), slipBps: basis points the fill
               price moves against you on market and stop orders }
   A buy pays its fee on top and the fee joins the position's cost, so a
   sale's realised profit or loss is net of both fees. Slippage moves a
   market or stop fill away from the real quote (up for a buy, down for a
   sell); a limit order never fills past its limit. With every cost at 0
   (the default) fills are exactly at the real quote. */
export const COST_LIMITS = { feeFlat: 100000, feeBps: 1000, slipBps: 500 };
export function cleanCosts(c) {
  const o = c && typeof c === 'object' ? c : {};
  const n = (v, max) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, max) : 0);
  return { feeFlat: n(o.feeFlat, COST_LIMITS.feeFlat), feeBps: n(o.feeBps, COST_LIMITS.feeBps), slipBps: n(o.slipBps, COST_LIMITS.slipBps) };
}
export const hasCosts = c => !!(c && (c.feeFlat || c.feeBps || c.slipBps));
export const feeOf = (total, costs) => { const c = cleanCosts(costs); return c.feeFlat + mulDiv(total, c.feeBps, 10000); };
/** the price an order fills at, given the real quote */
export function fillPriceOf(side, type, quote, costs, limit = null) {
  const slip = mulDiv(quote, cleanCosts(costs).slipBps, 10000);
  let p = side === 'buy' ? quote + slip : Math.max(1, quote - slip);
  if (type === 'limit' && limit != null) p = side === 'buy' ? Math.min(p, limit) : Math.max(p, limit);
  return p;
}

export function newAccount(cashCents, now = Date.now(), costs = null) {
  return { cash0: cashCents, cash: cashCents, positions: {}, orders: [], realised: 0, seq: 1, started: now, costs: cleanCosts(costs) };
}
export const reservedCash = a => a.orders.filter(o => o.status === 'open' && o.side === 'buy').reduce((s, o) => { const t = costOf(o.qty, o.limit); return s + t + feeOf(t, a.costs); }, 0);
export const reservedQty = (a, sym) => a.orders.filter(o => o.status === 'open' && o.side === 'sell' && o.sym === sym).reduce((s, o) => s + o.qty, 0);
export const availableCash = a => a.cash - reservedCash(a);

function applyFill(a, o, quote, now) {
  const price = fillPriceOf(o.side, o.type, quote, a.costs, o.limit);
  const total = costOf(o.qty, price);
  const fee = feeOf(total, a.costs);
  if (o.side === 'buy') {
    a.cash -= total + fee;
    const p = a.positions[o.sym] || { qty: 0, cost: 0 };
    p.qty += o.qty; p.cost += total + fee;
    a.positions[o.sym] = p;
  } else {
    const p = a.positions[o.sym];
    const basis = o.qty === p.qty ? p.cost : mulDiv(p.cost, o.qty, p.qty);
    a.cash += total - fee;
    o.pnl = total - fee - basis;
    a.realised += o.pnl;
    p.qty -= o.qty; p.cost -= basis;
    if (p.qty === 0) delete a.positions[o.sym];
  }
  o.status = 'filled'; o.price = price; o.total = total; o.filledAt = now;
  o.fee = fee; o.quote = quote;
}
/** What an order would cost or bring in at the real quote, with the account's practice costs. */
export function estimate(a, { side, type, qty, quote, limit = null }) {
  const price = fillPriceOf(side, type, quote, a.costs, limit);
  const total = costOf(qty, price);
  const fee = feeOf(total, a.costs);
  return { price, total, fee, net: side === 'buy' ? total + fee : total - fee, slip: Math.abs(price - quote) };
}
/** price is the real quote in cents. Returns { ok, order } or { ok:false, error }. Mutates `a`.
    type: market | limit | stop (a stop-loss: sell once a real price is at or below `stop`). */
export function placeOrder(a, { sym, side, type, qty, limit = null, stop = null, price, now = Date.now(), whole = true, note = '' }) {
  const bad = error => ({ ok: false, error });
  if (!Number.isSafeInteger(qty) || qty <= 0) return bad('Enter a quantity above zero.');
  if (whole && qty % UNIT) return bad('Stocks trade in whole shares here.');
  if (!(price >= 1)) return bad('This price is under one cent, which practice trading cannot hold exactly.');
  if (type === 'limit' && !(Number.isSafeInteger(limit) && limit >= 1)) return bad('Enter a limit price.');
  if (type === 'stop' && side !== 'sell') return bad('A stop-loss sells: it is for shares you hold.');
  if (type === 'stop' && !(Number.isSafeInteger(stop) && stop >= 1)) return bad('Enter a stop price.');
  if (side === 'sell') {
    const have = (a.positions[sym]?.qty || 0) - reservedQty(a, sym);
    if (qty > have) return bad(`You have ${fmtQty(Math.max(0, have))} available to sell (open sell orders hold the rest).`);
  } else {
    const at = type === 'limit' && price > limit ? limit : fillPriceOf('buy', type, price, a.costs, limit);   /* a resting limit order holds cash at its limit */
    const t = costOf(qty, at), need = t + feeOf(t, a.costs);
    if (need > availableCash(a)) return bad(`Not enough practice cash: this needs ${fmtMoney(need)}, you have ${fmtMoney(availableCash(a))} free.`);
  }
  const o = { id: a.seq++, sym, side, type, qty, limit: type === 'limit' ? limit : null, stop: type === 'stop' ? stop : null, status: 'open', placedAt: now, price: null, total: null, filledAt: null, pnl: null, note: cleanNote(note) };
  a.orders.unshift(o);
  if (crossedBy(o, price)) applyFill(a, o, price, now);
  return { ok: true, order: o };
}
const crossedBy = (o, price) => (o.type === 'market' ? true : o.type === 'stop' ? price <= o.stop : o.side === 'buy' ? price <= o.limit : price >= o.limit);
/** a fresh real price for sym: fills every open limit and stop order it has crossed. Returns the filled orders.
    This is the only place a waiting order fills, so it happens only when StaticOS has just fetched that price. */
export function checkLimits(a, sym, price, now = Date.now()) {
  const done = [];
  for (const o of [...a.orders].reverse()) {          /* oldest first */
    if (o.status !== 'open' || o.sym !== sym) continue;
    if (crossedBy(o, price)) {
      if (o.side === 'buy') { const e = estimate(a, { side: 'buy', type: o.type, qty: o.qty, quote: price, limit: o.limit }); if (e.net > a.cash) continue; }
      if (o.side === 'sell' && (a.positions[sym]?.qty || 0) < o.qty) { o.status = 'cancelled'; o.why = 'not enough held'; continue; }
      applyFill(a, o, price, now); done.push(o);
    }
  }
  return done;
}

/* ---------------- journal notes, results, CSV, archive ------------ */
export const NOTE_MAX = 280;
export const cleanNote = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, NOTE_MAX);
export function setNote(a, id, text) {
  const o = a.orders.find(x => x.id === id);
  if (o) o.note = cleanNote(text);
  return !!o;
}
/** Results from closed practice trades only: every filled sell has a realised profit or loss. null when there are none. */
export function results(a) {
  const closed = a.orders.filter(o => o.status === 'filled' && o.side === 'sell' && o.pnl != null);
  if (!closed.length) return null;
  const pnl = closed.map(o => o.pnl);
  const wins = pnl.filter(x => x > 0), losses = pnl.filter(x => x < 0);
  const fees = a.orders.filter(o => o.status === 'filled').reduce((s, o) => s + (o.fee || 0), 0);
  return {
    n: closed.length, wins: wins.length, losses: losses.length, even: closed.length - wins.length - losses.length,
    winRate: wins.length / closed.length, total: pnl.reduce((s, x) => s + x, 0),
    best: wins.length ? Math.max(...wins) : null, worst: losses.length ? Math.min(...losses) : null, fees,
  };
}
const csvText = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvMoney = c => (c == null ? '' : (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + '.' + String(Math.abs(c) % 100).padStart(2, '0'));
const iso = ms => (ms ? new Date(ms).toISOString() : '');
/** Every order of a practice account, oldest first. Money is plain decimals (a minus sign only on a loss);
    text cells that start with = + - @ get an apostrophe so a spreadsheet can't run them. */
export function tradesCsv(a) {
  const rows = [['Order', 'Placed (UTC)', 'Filled (UTC)', 'Symbol', 'Side', 'Type', 'Quantity', 'Limit', 'Stop', 'Fill price', 'Real quote at fill', 'Total', 'Practice fee', 'Realised P/L', 'Status', 'Note'].join(',')];
  for (const o of [...a.orders].reverse()) {
    rows.push([o.id, iso(o.placedAt), iso(o.filledAt), csvText(o.sym), o.side, o.type, fmtQty(o.qty), csvMoney(o.limit), csvMoney(o.stop), csvMoney(o.price), csvMoney(o.quote ?? (o.price != null && !o.fee ? o.price : null)),
      csvMoney(o.total), csvMoney(o.status === 'filled' ? o.fee || 0 : null), csvMoney(o.pnl), o.status, csvText(o.note || '')].join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
/** The account as it was when reset, kept with what it was worth then (when every position had a price). */
export function archiveOf(a, prices, now = Date.now()) {
  const P = portfolio(a, prices);
  return { ...JSON.parse(JSON.stringify(a)), endedAt: now, endValue: P.missing ? null : P.equity, endMissing: P.missing };
}
export const MAX_ARCHIVES = 12;

/* ---------------- price lines ----------------------------------- */
/* A price line is a level you draw on a symbol's chart. `above` says which
   side of the price it was drawn on; it is reached when a fresh real price
   gets to it. Lines are checked only when StaticOS fetches a price. */
export function newLine(price, quote, now = Date.now()) {
  return { id: 'l' + now.toString(36) + Math.random().toString(36).slice(2, 6), price, above: price > quote, at: now, hit: null };
}
export function checkLines(lines, price, now = Date.now()) {
  const hit = [];
  for (const l of lines || []) {
    if (l.hit) continue;
    if (l.above ? price >= l.price : price <= l.price) { l.hit = now; l.hitPrice = price; hit.push(l); }
  }
  return hit;
}

/* ---------------- lesson mode ------------------------------------ */
/* What each indicator measures, in plain words, and what it reads now on
   this chart. Every "now" sentence is computed from the bars; none of it
   says what comes next. */
export const LESSONS = {
  sma: { title: 'Simple moving average (SMA 20 and 50)', what: 'The average close of the last 20 (or 50) bars, drawn bar by bar. It smooths the day-to-day wiggles so the general direction is easier to see.', read: 'Price above its average means recent closes have been higher than the period’s average; below means lower. A short average crossing a long one is often pointed out on charts.', careful: 'It is built from past closes, so it always lags the price, and in a sideways market it crosses back and forth a lot.' },
  ema: { title: 'Exponential moving average (EMA 20)', what: 'An average like the SMA, but recent bars count for more (each new close gets a weight of 2/21), so it follows the price more closely.', read: 'Read it like the SMA: which side of it the price is on, and whether it is rising or falling.', careful: 'It reacts faster than the SMA, which also means it reacts to noise.' },
  bb: { title: 'Bollinger Bands (20, 2)', what: 'The 20-bar average with a band two standard deviations above and below it. The bands widen when prices swing more and narrow when they calm down.', read: 'Where the close sits inside the band says how far it is from its recent average, measured against how much it usually moves.', careful: 'A close at a band is not a signal by itself; in a strong move prices can ride along a band for a long time.' },
  rsi: { title: 'Relative Strength Index (RSI 14)', what: 'Compares the size of the up moves with the down moves over the last 14 bars, on a scale from 0 to 100 (Wilder’s method).', read: 'Above 70 is often called stretched upward (“overbought”), below 30 stretched downward (“oversold”), and 50 is balanced.', careful: 'These are labels for past moves, not forecasts: RSI can stay above 70 or below 30 for weeks.' },
  macd: { title: 'MACD (12, 26, 9)', what: 'The difference between a 12-bar and a 26-bar EMA (the MACD line), a 9-bar EMA of that line (the signal) and the gap between the two (the histogram).', read: 'The line above zero means the shorter average is above the longer one. The histogram shows whether the line is above or below its signal, and by how much.', careful: 'Built from moving averages, so it lags; crossings happen often in choppy markets.' },
  vol: { title: 'Volume', what: 'How many shares (or coins) traded in each bar. The bars under the price chart show it.', read: 'A bar much taller than usual means much more trading than usual in that period.', careful: 'Volume says how much traded, not why, and not which way prices go next. Twelve Data sends no volume for many crypto pairs.' },
};
const pctOf = (a, b) => (b ? ((a / b - 1) * 100) : null);
const sgn = x => (x > 0 ? '+' : '') + x.toFixed(2);
/** -> { key: "Now: …" } read from the last bar of `bars` with indicators `I` computed on them */
export function lessonNow(bars, I) {
  const n = bars.length, i = n - 1;
  if (!n) return {};
  const c = bars[i].c, v = x => (x == null ? null : x);
  const out = {};
  const s20 = v(I.sma20[i]), s50 = v(I.sma50[i]);
  out.sma = s20 == null ? 'Now: there are too few bars for a 20-bar average.' : `Now: the last close ${f2(c)} is ${c >= s20 ? 'above' : 'below'} its 20-bar average ${f2(s20)} (${sgn(pctOf(c, s20))}%)` + (s50 == null ? ', and there are too few bars for the 50-bar one.' : `, and ${c >= s50 ? 'above' : 'below'} its 50-bar average ${f2(s50)}. The 20 is ${s20 >= s50 ? 'above' : 'below'} the 50.`);
  const e = v(I.ema20[i]);
  out.ema = e == null ? 'Now: there are too few bars.' : `Now: EMA 20 is ${f2(e)}; the last close is ${c >= e ? 'above' : 'below'} it by ${f2(Math.abs(c - e))}.`;
  const lo = v(I.bb.lo[i]), up = v(I.bb.up[i]), mid = v(I.bb.mid[i]);
  out.bb = lo == null ? 'Now: there are too few bars.' : `Now: lower ${f2(lo)}, middle ${f2(mid)}, upper ${f2(up)}. The close sits at ${up > lo ? Math.round(((c - lo) / (up - lo)) * 100) : 50}% of the way from the lower band to the upper one.`;
  const r = v(I.rsi[i]);
  out.rsi = r == null ? 'Now: there are too few bars.' : `Now: RSI 14 is ${r.toFixed(1)}, ${r >= 70 ? 'at or above 70' : r <= 30 ? 'at or below 30' : 'between 30 and 70'}.`;
  const ml = v(I.macd.line[i]), ms = v(I.macd.signal[i]), mh = v(I.macd.hist[i]);
  const hs = mh == null ? '' : mh.toFixed(3), level = mh == null || Number(hs) === 0;
  out.macd = ml == null || ms == null ? 'Now: there are too few bars.' : `Now: the MACD line is ${ml.toFixed(3)} (${ml >= 0 ? 'above' : 'below'} zero) and the signal ${ms.toFixed(3)}, so the histogram is ${level ? 'about 0 (the two are level)' : `${mh > 0 ? '+' : ''}${hs} (the line is ${mh > 0 ? 'above' : 'below'} its signal)`}.`;
  const vols = bars.map(b => b.v);
  if (vols[i] == null) out.vol = 'Now: the provider sent no volume for this symbol.';
  else if (n > 20 && vols.slice(n - 21, n - 1).every(x => x != null)) { const avg = vols.slice(n - 21, n - 1).reduce((s, x) => s + x, 0) / 20; out.vol = `Now: the last bar traded ${Math.round(vols[i]).toLocaleString('en-US')}, ${avg ? (vols[i] / avg).toFixed(2) : 'n/a'} times the average of the 20 bars before it.`; }
  else out.vol = `Now: the last bar traded ${Math.round(vols[i]).toLocaleString('en-US')}; there are too few bars for an average.`;
  return out;
}

/* ---------------- comparing two symbols ---------------------------
   Both series rebased to 0% at the first bar they share, matched on the
   same date (daily bars) or the same moment (intraday bars). Only shared
   bars are used, so a weekend crypto bar has no partner and is left out. */
export function compareSeries(a, b, daily) {
  const key = x => (daily ? x.d : x.t);
  const mb = new Map(b.map(x => [key(x), x]));
  const pairs = a.filter(x => mb.has(key(x))).map(x => [x, mb.get(key(x))]);
  if (pairs.length < 2) return null;
  const a0 = pairs[0][0].c, b0 = pairs[0][1].c;
  return {
    n: pairs.length, from: pairs[0][0], to: pairs[pairs.length - 1][0],
    a: pairs.map(([x]) => (x.c / a0 - 1) * 100), b: pairs.map(([, y]) => (y.c / b0 - 1) * 100), bars: pairs.map(([x]) => x),
  };
}
export function cancelOrder(a, id) {
  const o = a.orders.find(x => x.id === id && x.status === 'open');
  if (o) o.status = 'cancelled';
  return !!o;
}
export function portfolio(a, prices) {
  let value = 0, cost = 0, missing = 0;
  const rows = Object.entries(a.positions).map(([sym, p]) => {
    const px = prices[sym];
    const val = px != null ? costOf(p.qty, px) : null;
    if (val == null) missing++; else { value += val; }
    cost += p.cost;
    return { sym, qty: p.qty, cost: p.cost, avg: p.qty ? mulDiv(p.cost, UNIT, p.qty) : 0, price: px ?? null, value: val, pnl: val != null ? val - p.cost : null };
  });
  return { rows, value, cost, missing, equity: a.cash + value, unrealised: rows.reduce((s, r) => s + (r.pnl || 0), 0) };
}

/* ---------------- the scan --------------------------------------- */
export const SCAN_RULES = [
  { id: 'rsi', title: 'RSI extreme', text: 'RSI(14) of the closes is 70 or above (often read as stretched upward) or 30 or below (stretched downward). A reading, not a forecast.' },
  { id: 'x2050', title: 'SMA 20 / 50 cross', text: 'The 20-bar average closed above or below the 50-bar average within the last 5 completed bars, having been on the other side before.' },
  { id: 'x50200', title: 'SMA 50 / 200 cross', text: 'The same test for the 50- and 200-bar averages within the last 10 completed bars (needs 200+ bars).' },
  { id: 'range', title: 'Near the range high or low', text: 'The last close is within 2% of the highest high or lowest low of the last 252 completed daily bars (stocks, about 52 weeks) or of all the bars available (crypto: at most 300 days, the most one request returns).' },
  { id: 'vol', title: 'Unusual volume', text: 'The last completed bar traded at least 2 times the average volume of the 20 bars before it.' },
];
/** drop today's unfinished daily bar so every rule reads completed bars only */
export function completedBars(bars, kind, now, tz) {
  if (!bars.length) return bars;
  const last = bars[bars.length - 1];
  let partial;
  if (kind === 'crypto') partial = last.d === new Date(now).toISOString().slice(0, 10);
  else { const z = zoned(now, tz || 'America/New_York'); partial = last.d === z.date && !(z.wd === 'Sat' || z.wd === 'Sun') && z.h * 60 + z.mi < 960; }
  return partial ? bars.slice(0, -1) : bars;
}
export function scanBars(bars, { kind = 'stock' } = {}) {
  const n = bars.length;
  const out = { n, last: n ? bars[n - 1] : null, hits: [], rsi: null, vol: null, rangePos: null };
  if (n < 15) { out.note = `only ${n} bars, too few for most rules`; return out; }
  const c = bars.map(b => b.c);
  const R = rsi(c, 14)[n - 1];
  out.rsi = R;
  if (R >= 70) out.hits.push({ rule: 'rsi', text: `RSI ${R.toFixed(1)} (70 or above)` });
  else if (R <= 30) out.hits.push({ rule: 'rsi', text: `RSI ${R.toFixed(1)} (30 or below)` });
  const crossed = (a, b, within) => {
    for (let i = n - 1; i > n - 1 - within && i > 0; i--) {
      if (a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) continue;
      const now = a[i] - b[i], before = a[i - 1] - b[i - 1];
      if (before <= 0 && now > 0) return { dir: 'above', ago: n - 1 - i };
      if (before >= 0 && now < 0) return { dir: 'below', ago: n - 1 - i };
    }
    return null;
  };
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200);
  const x1 = crossed(s20, s50, 5), x2 = crossed(s50, s200, 10);
  if (x1) out.hits.push({ rule: 'x2050', text: `SMA20 crossed ${x1.dir} SMA50 ${x1.ago ? x1.ago + ' bars ago' : 'on the last bar'}` });
  if (x2) out.hits.push({ rule: 'x50200', text: `SMA50 crossed ${x2.dir} SMA200 ${x2.ago ? x2.ago + ' bars ago' : 'on the last bar'}` });
  const win = bars.slice(-252);
  const hi = Math.max(...win.map(b => b.h)), lo = Math.min(...win.map(b => b.l));
  const lc = c[n - 1];
  out.rangeBars = win.length; out.hi = hi; out.lo = lo;
  out.rangePos = hi > lo ? (lc - lo) / (hi - lo) : null;
  if (lc >= hi * 0.98) out.hits.push({ rule: 'range', text: `within 2% of the ${win.length}-bar high ${f2(hi)}` });
  else if (lc <= lo * 1.02) out.hits.push({ rule: 'range', text: `within 2% of the ${win.length}-bar low ${f2(lo)}` });
  if (n >= 21 && bars[n - 1].v != null) {
    const prev = bars.slice(n - 21, n - 1).map(b => b.v);
    if (prev.every(v => v != null)) {
      const avg = prev.reduce((s, v) => s + v, 0) / 20;
      out.vol = avg > 0 ? bars[n - 1].v / avg : null;
      if (out.vol != null && out.vol >= 2) out.hits.push({ rule: 'vol', text: `volume ${out.vol.toFixed(1)}x its 20-bar average` });
    }
  }
  return out;
}

/* ---------------- text for the AI -------------------------------- */
const f2 = x => (x == null ? 'n/a' : Math.abs(x) >= 100 ? x.toFixed(2) : Math.abs(x) >= 1 ? x.toFixed(3) : x.toPrecision(4));
const last = a => (a.length ? a[a.length - 1] : null);
/** a compact, factual summary of one chart: only values taken from or computed on real bars */
export function chartSummary({ q, bars, full = bars, rangeLabel, interval, now }) {
  const I = indicatorsOf(full);
  const off = full.length - bars.length;
  const n = bars.length;
  const L = x => f2(last(x));          /* indicators are read on the whole fetched series, so SMA200 and RSI have their warm-up */
  const m = I.macd;
  const lines = [];
  lines.push(`Symbol: ${q.sym} (${q.name || ''}) on ${q.exch}. Source: ${q.source}. Currency ${q.currency || 'USD'}.`);
  lines.push(`Quote as of ${new Date(q.asOf).toISOString()}: last ${f2(q.price / 100)}, previous close/open ${f2(q.prevClose / 100)}, day range ${f2(q.low / 100)} to ${f2(q.high / 100)}.`);
  if (q.hi52 != null) lines.push(`52-week range: ${f2(q.lo52 / 100)} to ${f2(q.hi52 / 100)}.`);
  lines.push(`Chart: ${rangeLabel}, ${n} bars of ${interval}, from ${bars[0]?.d} to ${last(bars)?.d}.`);
  const closes = bars.map(b => b.c);
  lines.push(`Close high ${f2(Math.max(...closes))}, close low ${f2(Math.min(...closes))}, first close ${f2(closes[0])}, last close ${f2(last(closes))} (${f2((last(closes) / closes[0] - 1) * 100)}% over the chart).`);
  lines.push(`Indicators on the last bar: SMA20 ${L(I.sma20)}, SMA50 ${L(I.sma50)}, SMA200 ${L(I.sma200)}, EMA20 ${L(I.ema20)}, RSI14 ${L(I.rsi)}, MACD(12,26,9) line ${L(m.line)} signal ${L(m.signal)} histogram ${L(m.hist)}, Bollinger(20,2) lower ${L(I.bb.lo)} middle ${L(I.bb.mid)} upper ${L(I.bb.up)}. n/a means there were too few bars to compute it.`);
  const vols = bars.map(b => b.v).filter(v => v != null);
  if (vols.length > 20) lines.push(`Volume on the last bar ${last(vols)}, average of the 20 before ${f2(vols.slice(-21, -1).reduce((s, v) => s + v, 0) / 20)}.`);
  lines.push('Most recent bars (date open high low close volume):');
  for (const b of bars.slice(-25)) lines.push(`${b.d} ${f2(b.o)} ${f2(b.h)} ${f2(b.l)} ${f2(b.c)} ${b.v ?? 'n/a'}`);
  return lines.join('\n');
}
export function scanSummary(rows) {
  return rows.map(r => `${r.sym}: last ${f2(r.scan.last?.c)}, RSI ${r.scan.rsi == null ? 'n/a' : r.scan.rsi.toFixed(1)}, volume ratio ${r.scan.vol == null ? 'n/a' : r.scan.vol.toFixed(2)}, position in range ${r.scan.rangePos == null ? 'n/a' : Math.round(r.scan.rangePos * 100) + '%'}; flags: ${r.scan.hits.length ? r.scan.hits.map(h => h.text).join('; ') : 'none'}`).join('\n');
}
export const AI_SYSTEM = [
  'You are the chart explainer inside Static Markets, a practice-trading app for students. All money is practice money.',
  'You are given real market data and indicators computed from it as plain text. Use only those numbers; never invent prices, news, earnings or events.',
  'Explain in plain language for a student: what the chart shows, the trend, key price levels (from the data), what each indicator currently says and what it means, the main risks, and what to watch next.',
  'Describe what happened and what the indicators measure. Never predict future prices, never say anything is guaranteed or a sure thing, never tell the user to buy or sell.',
  'If data is thin or an indicator is n/a, say so. Use short paragraphs and bullet points. End with one line: this is education, not financial advice.',
].join(' ');
