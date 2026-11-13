/* ============================================================
   markets.js — Static Markets: charts, a watchlist and practice trading.

   · Real prices only. Stocks come from Twelve Data (the person's own free
     key, kept on this device), crypto pairs from the same provider and key.
     Every price shows its source and the time it is as of; when a number
     cannot be fetched the app says so and shows none.
   · Practice trading, never real money: a virtual account (integer cents)
     whose orders fill at the real quote. Limit orders fill only when a
     fresh real price crosses them, and are checked only while StaticOS
     is open and the app has fetched that price.
   · The AI explains what the data says (js/portal/llm.js) and never
     predicts. Scan runs plain rules on the watchlist.
   · Nothing from the network or the model is ever set as HTML.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import * as LLM from '../portal/llm.js';
import * as AIM from '../portal/aimodel.js';
import { render as md } from '../portal/mdlite.js';
import * as D from './markets-data.js';
import * as K from './markets-lib.js';
import { createChart, fmtPrice, palette } from './markets-chart.js';
import * as TV from './markets-tv.js';

const STOCK_EVERY = 5 * 60e3;       /* free plan: 8 credits a minute, 800 a day */
const MAX_WATCH = 20;
const NOTE = 'Education, not financial advice.';
/* what a first-time person sees: two US stocks, one fund and two coins (crypto first, so a chart shows even on a weekend) */
const DEFAULT_WATCH = ['BTC-USD', 'ETH-USD', 'AAPL', 'MSFT', 'SPY'];

const CSS = `
:root[data-theme=light] .mk{--mk-up:#137a43;--mk-down:#c4262e}
.mk{--mk-up:#2fbf71;--mk-down:#ef5b5b;flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1);font-size:var(--fs-13)}
.mk *{box-sizing:border-box}
.mk button,.mk input,.mk select{font:inherit;color:inherit}
.mk__top{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3) var(--sp-4);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.mk__top h1{font-size:var(--fs-15);margin:0;color:var(--ink-0)}
.mk__chip{padding:2px 9px;border-radius:999px;border:1px solid var(--line-2);background:var(--fill-1);font-size:var(--fs-12);color:var(--ink-1)}
.mk__chip--practice{border-color:color-mix(in srgb,var(--accent) 60%,transparent);color:var(--ink-0)}
.mk__tabs{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap}
.mk__tab,.mk__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);cursor:pointer}
.mk__tab[aria-pressed=true],.mk__btn[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.mk__btn--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff);font-weight:600}
.mk button:disabled{opacity:.45;cursor:default}
.mk button:focus-visible,.mk input:focus-visible,.mk select:focus-visible,.mk__canvas:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.mk__msg{padding:var(--sp-2) var(--sp-4);font-size:var(--fs-12);color:var(--ink-1);background:var(--fill-1);border-bottom:1px solid var(--line-1)}
.mk__msg[hidden]{display:none}
.mk__msg[data-kind=error]{color:var(--mk-down)}
.mk__body{flex:1;min-height:0;display:flex}
.mk__side{width:230px;flex:none;display:flex;flex-direction:column;gap:var(--sp-3);padding:var(--sp-3);border-right:1px solid var(--line-1);overflow:auto}
.mk__search{display:flex;gap:var(--sp-2)}
.mk__search input,.mk__in{height:28px;min-width:0;padding:0 var(--sp-3);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0)}
.mk__search input{flex:1}
.mk__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.mk__row{display:flex;align-items:stretch;gap:2px}
.mk table .mk__btn{white-space:nowrap}
.mk__pick{flex:1;min-width:0;display:grid;grid-template-columns:1fr auto;gap:0 var(--sp-3);text-align:left;padding:5px 8px;border-radius:var(--r-sm);border:1px solid transparent;background:transparent;cursor:pointer}
.mk__pick:hover{background:var(--fill-1)}
.mk__pick[aria-current=true]{background:var(--fill-2,var(--fill-1));border-color:var(--line-2)}
.mk__pick b{color:var(--ink-0)}
.mk__pick small{color:var(--ink-2);font-size:var(--fs-11,var(--fs-12));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk__x{width:26px;border:0;background:transparent;color:var(--ink-2);cursor:pointer;border-radius:var(--r-sm)}
.mk__x:hover{background:var(--fill-1);color:var(--ink-0)}
.mk__up{color:var(--mk-up)}.mk__down{color:var(--mk-down)}
.mk__main{flex:1;min-width:0;overflow:auto;padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-4)}
.mk__quote{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--sp-2) var(--sp-5)}
.mk__quote h2{margin:0;font-size:var(--fs-15);color:var(--ink-0)}
.mk__price{font-size:1.7em;font-weight:700;color:var(--ink-0);font-variant-numeric:tabular-nums}
.mk__sub{color:var(--ink-2);font-size:var(--fs-12)}
.mk__bar{display:flex;flex-wrap:wrap;gap:var(--sp-2) var(--sp-4);align-items:center}
.mk__grp{display:flex;gap:2px;flex-wrap:wrap}
.mk__chk{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-12);height:28px;padding:0 var(--sp-3);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);cursor:pointer}
.mk__chk:has(input:checked){border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.mk__chk i,.mkc__it i{display:inline-block;width:12px;height:3px;border-radius:2px;flex:none}
.mkc__it{display:inline-flex;align-items:center;gap:5px}
.mk__bar--ind{gap:var(--sp-2)}
.mk__chartbox{position:relative;border:1px solid var(--line-1);border-radius:var(--r-md,8px);background:var(--fill-0)}
.mk__canvas{display:block;width:100%;height:clamp(280px,46vh,520px)}
.mk__over{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:var(--sp-5);color:var(--ink-1);pointer-events:none}
.mk__over button{pointer-events:auto}
.mk__readout{display:flex;flex-wrap:wrap;gap:2px var(--sp-4);font-size:var(--fs-12);color:var(--ink-1);min-height:2.6em;align-content:flex-start;font-variant-numeric:tabular-nums}
.mk__it{display:inline-flex;align-items:center;gap:5px}
.mk__it i{display:inline-block;width:10px;height:3px;border-radius:2px}
.mk__sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.mk__card{border:1px solid var(--line-1);border-radius:var(--r-md,8px);padding:var(--sp-4);background:var(--fill-0);display:flex;flex-direction:column;gap:var(--sp-3)}
.mk__card h3{margin:0;font-size:var(--fs-13);color:var(--ink-0)}
.mk__ai{max-height:320px;overflow:auto;line-height:1.5}
.mk__ai p{margin:.3em 0}
.mk table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
.mk th,.mk td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line-1)}
.mk th{color:var(--ink-2);font-weight:600;font-size:var(--fs-12)}
.mk td.n,.mk th.n{text-align:right}
.mk__tw{overflow-x:auto}
.mk form.mk__form{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:var(--sp-3);align-items:end}
.mk label.mk__f{display:flex;flex-direction:column;gap:3px;font-size:var(--fs-12);color:var(--ink-2)}
.mk__choices .mk__card{align-content:start}
.mk__choices .mk__card>.mk__btn--go{margin-top:auto}
.mk__start{margin:auto;max-width:720px;padding:var(--sp-6);display:flex;flex-direction:column;gap:var(--sp-5)}
.mk__start h2{margin:0;font-size:var(--fs-18,1.3em);color:var(--ink-0)}
.mk__choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--sp-4)}
.mk [hidden]{display:none!important}
.mk__own,.mk__tvblock{display:flex;flex-direction:column;gap:var(--sp-3)}
.mk__keyline{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border:1px solid color-mix(in srgb,var(--accent) 50%,transparent);border-radius:var(--r-md,8px);background:var(--fill-1);font-size:var(--fs-12)}
.mk ol{margin:0;padding-left:1.6em;list-style:decimal}
.mk ol li{padding:1px 0}
.mk select{height:28px;min-width:0;padding:0 var(--sp-3);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);color:var(--ink-0)}
.mk a{color:var(--accent)}
.mk__ailine{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2) var(--sp-3)}
.mk__aihead{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--sp-2) var(--sp-4)}
.mk__aihead .mk__ailine{margin-left:auto}
.mk__ai:empty{display:none}
.mk__note{border-top:1px solid var(--line-1);padding-top:var(--sp-2);margin:0}
.mk__est{max-width:440px;display:grid;grid-template-columns:auto 1fr;gap:3px var(--sp-5);margin:0;font-variant-numeric:tabular-nums}
.mk__est dt{color:var(--ink-2)}.mk__est dd{margin:0;text-align:right;color:var(--ink-0)}
.mk__why{min-height:1.4em;color:var(--ink-1)}
.mk__why[data-bad=true]{color:var(--mk-down)}
.mk__keyok{color:var(--mk-up)}
.mk__tvwrap{display:flex;flex-direction:column;gap:4px}
.mk__tv{position:relative;border:1px solid var(--line-1);border-radius:var(--r-md,8px);overflow:hidden;background:var(--fill-0)}
.mk__tvframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.mk__tvmsg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-3);text-align:center;padding:var(--sp-5);color:var(--ink-1)}
.mk__tvmsg p{margin:0;max-width:46ch}
.mk__tvcredit{font-size:var(--fs-12);color:var(--ink-2);align-self:flex-end}
.mk--narrow .mk__body{flex-direction:column;overflow:auto}
.mk--narrow .mk__side{width:auto;border-right:0;border-bottom:1px solid var(--line-1);max-height:none;overflow:visible}
.mk--narrow .mk__main{overflow:visible}
.mk--narrow .mk__tabs{margin-left:0}
.mk--narrow .mk__wl{flex-direction:row;overflow-x:auto;padding-bottom:4px}
.mk--narrow .mk__wl .mk__row{flex:none;min-width:148px}
.mk--narrow .mk__price{font-size:1.5em}
.mk--narrow .mk__aihead .mk__ailine{margin-left:0}
.mk--narrow .mk__start{padding:var(--sp-4)}
`;

/* ---------- small helpers ---------- */
const pctText = x => (x == null || !Number.isFinite(x) ? 'n/a' : (x > 0 ? '+' : '') + x.toFixed(2) + '%');
const dir = x => (x > 0 ? 'mk__up' : x < 0 ? 'mk__down' : '');
const timeIn = (ms, tz) => new Date(ms).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const money = c => K.fmtMoney(c);
const px = c => (c >= 100 ? money(c) : '$' + (c / 100).toFixed(2));

function errText(e) {
  if (e && e.name === 'AbortError') return '';
  if (e instanceof D.MarketError || e instanceof LLM.LLMError) return e.message;
  return 'Something went wrong: ' + (e?.message || e);
}

defineApp({
  id: 'markets',
  name: 'Static Markets',
  icon: 'trending-up',
  g1: '#3ddc97', g2: '#0b5d46',
  category: 'Utilities',
  keywords: ['stocks', 'stock market', 'shares', 'trading', 'practice trading', 'paper trading', 'invest', 'chart', 'candlestick', 'crypto', 'bitcoin', 'watchlist', 'portfolio', 'rsi', 'macd', 'scan'],
  desc: 'Stock and crypto charts, a watchlist, an AI chart explainer and practice trading with virtual money',
  singleton: true,
  win: { w: 1020, h: 680, minW: 360, minH: 420 },
  shortcuts: [['Left / Right', 'Move the chart crosshair (chart focused)'], ['Home / End', 'First / latest bar']],

  mount({ root, api }) { return build(root, api); },
});

function build(root, api) {
  let dead = false;
  const timers = [];
  const ac = new AbortController();           /* every request of this window */
  let aiAbort = null, scanAbort = null, chartAbort = null;

  /* ---------- saved state (per person, through the store) ---------- */
  const saved = store.get('markets') || {};
  const S = {
    mode: saved.mode === 'practice' || saved.mode === 'watch' ? saved.mode : null,
    key: typeof saved.key === 'string' ? saved.key : '',
    watch: Array.isArray(saved.watch) ? saved.watch.filter(x => typeof x === 'string').slice(0, MAX_WATCH) : DEFAULT_WATCH.slice(),
    acct: saved.acct && typeof saved.acct.cash === 'number' ? saved.acct : null,
    ui: { view: 'tv', type: 'line', ind: { sma: false, ema: false, bb: false, rsi: false, macd: false }, ...(saved.ui || {}) },
    exch: saved.exch && typeof saved.exch === 'object' ? saved.exch : {},
    sym: null, range: '6M', tab: 'chart',
    quotes: new Map(),      /* sym -> { q, at } */
    qerr: new Map(),
    series: null,           /* { sym, range, full, bars, iv, tz } */
    scan: null, results: [], searchNote: '',
  };
  S.sym = S.watch[0] || null;
  const persist = () => store.set('markets', { mode: S.mode, key: S.key, watch: S.watch, acct: S.acct, ui: S.ui, exch: S.exch });

  /* ---------- skeleton ---------- */
  const msg = h('div.mk__msg', { role: 'status', 'aria-live': 'polite', hidden: true });
  let msgT = 0;
  const say = (text, kind = 'info', ms = 0) => {
    clearTimeout(msgT);
    msg.hidden = !text; msg.textContent = text || ''; msg.dataset.kind = kind;
    if (text && ms) msgT = setTimeout(() => { msg.hidden = true; }, ms);
  };
  timers.push({ stop: () => clearTimeout(msgT) });
  D.setWaitHandler(({ ms }) => { if (!dead) say(`Waiting about ${Math.ceil(ms / 1000)} s: the free data plan allows 8 requests a minute.`, 'wait'); });

  const top = h('div.mk__top');
  const sideEl = h('aside.mk__side', { 'aria-label': 'Watchlist and search' });
  const mainEl = h('main.mk__main');
  const bodyEl = h('div.mk__body', sideEl, mainEl);
  const el = h('div.mk', h('style', { text: CSS }), top, msg, bodyEl);
  root.appendChild(el);
  const ro = new ResizeObserver(() => el.classList.toggle('mk--narrow', el.clientWidth < 680));
  ro.observe(el);

  const tabsDef = () => [['chart', 'Chart'], ...(S.mode === 'practice' ? [['trade', 'Trade'], ['portfolio', 'Portfolio']] : []), ['scan', 'Scan all'], ['settings', 'Settings']];
  const kindOf = sym => (D.isCrypto(sym) ? 'crypto' : 'stock');

  /* ---------- header ---------- */
  function paintTop() {
    top.replaceChildren(h('h1', { text: 'Static Markets' }));
    if (!S.mode) return;
    top.append(S.mode === 'practice'
      ? h('span.mk__chip.mk__chip--practice', { text: 'Practice money, not real' })
      : h('span.mk__chip', { text: 'Watch only' }));
    const sess = h('span.mk__chip.mk__session', { role: 'status' });
    top.append(sess);
    paintSession();
    if (!tabsDef().some(t => t[0] === S.tab)) S.tab = 'chart';
    top.append(h('div.mk__tabs', { role: 'group', 'aria-label': 'Sections' }, tabsDef().map(([id, label]) =>
      h('button.mk__tab', { type: 'button', 'aria-pressed': String(S.tab === id), dataset: { tab: id }, text: label, onclick: () => { S.tab = id; paintTop(); paintMain(); } }))));
  }
  function paintSession() {
    const sess = top.querySelector('.mk__session');
    if (!sess) return;
    const q = S.quotes.get(S.sym)?.q;
    if (!S.sym) { sess.textContent = 'Pick a symbol'; return; }
    const k = kindOf(S.sym);
    const s = K.sessionState(Date.now(), q?.tz || 'America/New_York', { kind: k, isOpen: q?.isOpen ?? null });
    sess.textContent = (k === 'crypto' ? 'Crypto: ' : S.sym + ': ') + s.label;
    sess.dataset.state = s.state;
  }

  /* ---------- first-run screen ---------- */
  function paintStart() {
    top.replaceChildren(h('h1', { text: 'Static Markets' }));
    sideEl.hidden = true;
    const cash = h('input.mk__in', { id: 'mk-start-cash', value: '10,000', inputmode: 'decimal', 'aria-label': 'Starting practice cash in dollars', size: 10 });
    const err = h('div.mk__sub', { role: 'alert' });
    const go = mode => {
      let acct = S.acct;
      if (mode === 'practice') {
        const c = K.parseMoney(cash.value);
        if (c == null || c < 100 || c > 1e10) { err.textContent = 'Enter a starting amount between $1.00 and $100,000,000.00.'; return; }
        if (!acct) acct = K.newAccount(c, Date.now());
      }
      S.acct = acct; S.mode = mode; persist(); paintAll();
    };
    mainEl.replaceChildren(h('div.mk__start', { role: 'region', 'aria-label': 'Welcome to Static Markets' },
      h('h2', { text: 'How do you want to use Static Markets?' }),
      h('p.mk__sub', { text: 'StaticOS only does practice trading: there is no real money here, ever. Prices are real; the money is not.' }),
      h('div.mk__choices',
        h('section.mk__card', h('h3', { text: 'Practice trading' }),
          h('p.mk__sub', { text: 'Pick some practice cash and place orders at real prices. See what would have happened to your pretend portfolio.' }),
          h('label.mk__f', h('span', { text: 'Starting practice cash ($)' }), cash), err,
          h('button.mk__btn.mk__btn--go#mk-pick-practice', { type: 'button', text: 'Start practice trading', onclick: () => go('practice') })),
        h('section.mk__card', h('h3', { text: 'Just watch' }),
          h('p.mk__sub', { text: 'Charts, a watchlist, the AI chart explainer and Scan all, with no trading panel.' }),
          h('button.mk__btn.mk__btn--go#mk-pick-watch', { type: 'button', text: 'Just watch the markets', onclick: () => go('watch') })))));
  }

  /* ---------- watchlist and search ---------- */
  const searchIn = h('input', { type: 'search', placeholder: 'Symbol or name', 'aria-label': 'Search symbols', autocomplete: 'off', spellcheck: 'false' });
  const resultsEl = h('ul.mk__list', { 'aria-label': 'Search results' });
  const listEl = h('ul.mk__list.mk__wl', { 'aria-label': 'Watchlist' });
  const searchNoteEl = h('div.mk__sub', { role: 'status' });
  const searchForm = h('form.mk__search', { role: 'search', onsubmit: ev => { ev.preventDefault(); doSearch(); } }, searchIn, h('button.mk__btn', { type: 'submit', text: 'Search' }));
  const wlHead = h('h2.mk__sub', { text: 'Watchlist', style: { margin: '0' } });
  const addHead = h('h2.mk__sub', { text: 'Add a symbol', style: { margin: '0' } });

  async function doSearch() {
    const t = searchIn.value.trim();
    if (!t) return;
    searchNoteEl.textContent = 'Searching…';
    try {
      const r = await D.search(t, S.key, { signal: ac.signal });
      S.results = r.results;
      searchNoteEl.textContent = r.results.length ? r.note : ('No matches. ' + r.note).trim();
    } catch (e) { S.results = []; searchNoteEl.textContent = errText(e); }
    if (!dead) paintSide();
  }
  function addWatch(sym) {
    const hit = S.results.find(r => r.sym === sym);
    if (hit && hit.kind === 'stock') S.exch[sym] = hit.exch;
    if (!S.watch.includes(sym)) {
      if (S.watch.length >= MAX_WATCH) { say(`The watchlist holds ${MAX_WATCH} symbols. Remove one first.`, 'error', 5000); return; }
      S.watch.push(sym); persist();
    }
    select(sym);
    refreshQuote(sym, true).catch(() => {});
    paintSide();
  }
  function removeWatch(sym) {
    S.watch = S.watch.filter(x => x !== sym); persist();
    if (S.sym === sym) select(S.watch[0] || null);
    paintSide();
  }
  function paintSide() {
    sideEl.hidden = !S.mode;
    resultsEl.replaceChildren(...S.results.map(r => h('li.mk__row',
      h('button.mk__pick', { type: 'button', dataset: { result: r.sym }, 'aria-label': `View ${r.sym}, ${r.name}`, onclick: () => select(r.sym, true) },
        h('b', { text: r.sym }), h('small', { text: r.exch }), h('small', { text: r.name })),
      h('button.mk__btn', { type: 'button', dataset: { add: r.sym }, disabled: S.watch.includes(r.sym), text: S.watch.includes(r.sym) ? 'Added' : 'Add', 'aria-label': `Add ${r.sym} to the watchlist`, onclick: () => addWatch(r.sym) }))));
    listEl.replaceChildren(...S.watch.map(sym => {
      const e = S.quotes.get(sym), q = e?.q, er = S.qerr.get(sym);
      const ch = q && q.prevClose ? (q.price - q.prevClose) / q.prevClose * 100 : null;
      return h('li.mk__row',
        h('button.mk__pick', { type: 'button', dataset: { sym }, 'aria-current': String(sym === S.sym), onclick: () => select(sym, true) },
          h('b', { text: sym }), h('span', { class: dir(ch), text: q ? px(q.price) : er ? 'no price' : '…' }),
          h('small', { text: q ? q.name : er ? (er.code === 'nokey' ? 'Needs your key' : er.code === 'unknown' ? 'Symbol not found' : 'Not available') : 'Loading' }), h('small', { class: dir(ch), text: q ? pctText(ch) : '', title: q ? 'Change vs the previous close' : '' })),
        h('button.mk__x', { type: 'button', 'aria-label': `Remove ${sym} from the watchlist`, text: '✕', onclick: () => removeWatch(sym) }));
    }));
    if (!S.watch.length) listEl.replaceChildren(h('li.mk__sub', { text: 'Your watchlist is empty. Type a symbol (AAPL) or a company or coin above, press Search, then Add.' }));
    sideEl.replaceChildren(addHead, searchForm, searchNoteEl, resultsEl, wlHead, listEl,
      h('p.mk__sub', { text: 'Prices, your own charts, practice trading, the AI and Scan need your free Twelve Data key (Settings). TradingView’s charts do not.' }));
  }

  /* ---------- quotes ---------- */
  const lastFetch = new Map();
  async function refreshQuote(sym, force = false) {
    if (dead) return null;
    try {
      const q = await D.quote(sym, S.key, { signal: ac.signal, force });
      if (dead) return null;
      lastFetch.set(sym, Date.now());
      const hadQuote = S.quotes.has(sym);
      S.quotes.set(sym, { q, at: Date.now() }); S.qerr.delete(sym);
      if (S.acct) {
        const filled = K.checkLimits(S.acct, sym, q.price, Date.now());
        if (filled.length) {
          persist();
          for (const o of filled) api.notify?.({ title: 'Practice order filled', message: `${o.side === 'buy' ? 'Bought' : 'Sold'} ${K.fmtQty(o.qty)} ${o.sym} at ${money(o.price)} (practice money)`, icon: 'trending-up' });
          say(`${filled.length} practice limit order${filled.length > 1 ? 's' : ''} filled at the latest real price.`, 'info', 8000);
          if (S.tab === 'trade' || S.tab === 'portfolio') paintMain();
        }
      }
      paintSide(); paintSession();
      if (sym === S.sym && S.tab === 'chart') paintQuote();
      if (sym === S.sym && S.tab === 'trade') { if (hadQuote) tradeUpd?.(); else paintMain(); }
      return q;
    } catch (e) {
      if (dead || e.name === 'AbortError') return null;
      S.qerr.set(sym, e); lastFetch.set(sym, Date.now());
      say(`${sym}: ${errText(e)}`, 'error');
      paintSide();
      if (sym === S.sym && S.tab === 'chart') paintQuote();
      throw e;
    }
  }
  const watched = () => [...new Set([...S.watch, ...Object.keys(S.acct?.positions || {}), ...(S.acct?.orders || []).filter(o => o.status === 'open').map(o => o.sym)])];
  async function tick(first = false) {
    if (dead || !S.mode || document.hidden) return;
    paintSession();
    for (const sym of watched()) {
      const every = STOCK_EVERY;
      if (!first && Date.now() - (lastFetch.get(sym) || 0) < every) continue;
      if (!S.key) { S.qerr.set(sym, new D.MarketError('nokey', 'Needs your Twelve Data key')); continue; }
      try { await refreshQuote(sym, first); } catch (e) { if (e.code === 'badkey' || e.code === 'limit-day' || e.code === 'nokey') break; }
    }
    if (!dead) paintSide();
  }

  /* ---------- selecting a symbol ---------- */
  function select(sym, show) {
    S.sym = sym; S.series = null;
    if (show) { S.tab = 'chart'; paintTop(); }
    paintSide(); paintMain();
  }

  /* ---------- the chart tab ---------- */
  let chart = null, chartParts = null, tvs = [];
  /* the AI model every AI app shares (Settings → AI model); this is a shortcut to it */
  const aiLine = () => { const d = AIM.describe(); return h('div.mk__ailine', h('span.mk__sub.mk__aimodel', { text: `Model: ${d.name}, requests go to ${d.host}.` }),
    h('button.mk__btn', { type: 'button', dataset: { act: 'ai-model' }, text: 'Change AI model', onclick: () => import('../core/wm.js').then(m => m.open('settings', { section: 'ai' })) })); };
  const theme = () => (store.get('prefs.theme', 'dark') === 'light' ? 'light' : 'dark');
  const tvSym = sym => TV.tvSymbol(sym, S.quotes.get(sym)?.q?.exch || S.exch[sym]);
  const addTV = (name, settings, title, height, fallback) => { const w = TV.createTV({ name, settings: { ...settings, theme: theme(), colorTheme: theme(), locale: 'en' }, title, height, fallback }); tvs.push({ ...w, name, settings, title, height, fallback }); return w.el; };
  /* StaticOS switched between dark and light: the widgets are re-made in the new theme */
  const unTheme = store.sub('prefs.theme', () => { if (S.mode && (S.tab === 'chart' || S.tab === 'scan')) paintMain(); });
  /* practice orders need our own prices, which TradingView's frames can never hand over */
  const practiceNote = sym => (S.mode === 'practice' && !S.key
    ? h('p.mk__sub#mk-tv-note', { text: 'You can chart this symbol with TradingView without a key, but practice orders (and the AI and Scan) need real prices from your free Twelve Data key. Add it in Settings.' }) : null);
  function paintMain() {
    chart?.destroy(); chart = null; chartParts = null; tradeUpd = null;
    for (const t of tvs) t.destroy();
    tvs = [];
    if (!S.mode) return paintStart();
    ({ chart: paintChartTab, trade: paintTrade, portfolio: paintPortfolio, scan: paintScan, settings: paintSettings })[S.tab]?.();
    /* no key: say in one line what works without it (TradingView) and what does not */
    if (!S.key && S.tab !== 'settings') mainEl.prepend(h('div.mk__keyline#mk-keyline', { role: 'note' },
      h('span', { text: 'Without a free Twelve Data key, only the TradingView charts work: your own chart, practice trading, the AI viewer and Scan all need the key.' }),
      h('button.mk__btn', { type: 'button', text: 'How to get a key', onclick: () => { S.tab = 'settings'; paintTop(); paintMain(); } })));
  }
  function paintChartTab() {
    if (!S.sym) { mainEl.replaceChildren(h('p.mk__sub', { text: 'Add a symbol to the watchlist to see its chart.' })); return; }
    const quoteEl = h('div.mk__quote', { 'aria-label': 'Quote' });
    const canvas = h('canvas.mk__canvas', { tabindex: '0', role: 'img', 'aria-label': `${S.sym} price chart. Use the left and right arrow keys to move through the bars.` });
    const over = h('div.mk__over', { hidden: true, role: 'status' });
    const readout = h('div.mk__readout', { 'aria-label': 'Values at the crosshair' });
    const live = h('div.mk__sr', { role: 'status', 'aria-live': 'polite' });
    const rangeBtns = Object.keys(D.RANGES).map(r => h('button.mk__btn', { type: 'button', dataset: { range: r }, 'aria-pressed': String(S.range === r), text: r, 'aria-label': D.RANGES[r].label, onclick: () => { S.range = r; for (const b of rangeBtns) b.setAttribute('aria-pressed', String(b.dataset.range === r)); loadChart(); } }));
    const typeBtns = [['line', 'Line'], ['candle', 'Candles']].map(([t, l]) => h('button.mk__btn', { type: 'button', dataset: { type: t }, 'aria-pressed': String(S.ui.type === t), text: l, onclick: () => { S.ui.type = t; persist(); for (const b of typeBtns) b.setAttribute('aria-pressed', String(b.dataset.type === t)); drawChart(); } }));
    const IND = [['sma', 'SMA 20 and 50'], ['ema', 'EMA 20'], ['bb', 'Bollinger Bands 20, 2'], ['rsi', 'RSI 14'], ['macd', 'MACD 12, 26, 9']];
    const PC = palette();
    const SW = { sma: [PC.sma20, PC.sma50], ema: [PC.ema20], bb: [PC.bb], rsi: [PC.rsi], macd: [PC.macd, PC.sig] };
    const indBox = IND.map(([k, label]) => h('label.mk__chk', h('input', { type: 'checkbox', dataset: { ind: k }, checked: !!S.ui.ind[k], onchange: ev => { S.ui.ind[k] = ev.target.checked; persist(); drawChart(); } }), ...SW[k].map(c => h('i', { style: { background: c }, 'aria-hidden': 'true' })), h('span', { text: label })));
    const aiOut = h('div.mk__ai', { 'aria-live': 'polite' });
    const aiBtns = [['explain', 'Explain this chart'], ['ideas', 'Ideas to watch']].map(([id, l]) => h('button.mk__btn', { type: 'button', dataset: { ai: id }, text: l, onclick: () => askAI(id, aiOut, aiBtns) }));
    const aiCard = h('section.mk__card', { 'aria-label': 'AI chart viewer' },
      h('div.mk__aihead', h('h3', { text: 'AI chart viewer' }), aiLine()),
      h('div.mk__bar', aiBtns), aiOut,
      h('p.mk__sub.mk__note', { text: 'Sends this chart’s numbers (as text) to the AI model you chose. ' + NOTE }));
    const ownBlock = h('div.mk__own',
      h('div.mk__bar', h('div.mk__grp', { role: 'group', 'aria-label': 'Time range' }, rangeBtns), h('div.mk__grp', { role: 'group', 'aria-label': 'Chart type' }, typeBtns), h('div.mk__grp', { role: 'group', 'aria-label': 'Indicators' }, indBox)),
      h('div.mk__chartbox', canvas, over), readout, live);
    const tvBlock = h('div.mk__tvblock',
      addTV('advanced-chart', { symbol: tvSym(S.sym), interval: 'D', timezone: 'exchange', style: '1', allow_symbol_change: false, autosize: true, hide_side_toolbar: false, support_host: 'https://www.tradingview.com' }, `TradingView advanced chart for ${S.sym}`, 480, 'The Static chart below the quote still works from its own data.'),
      practiceNote(S.sym));
    const setView = v => {
      S.ui.view = v; persist();
      tvBlock.hidden = v !== 'tv'; ownBlock.hidden = v === 'tv';
      for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.view === v));
      if (v !== 'tv') chart?.redraw();
    };
    const viewBtns = [['tv', 'TradingView chart'], ['own', 'Static chart (indicators, AI)']].map(([v, l]) => h('button.mk__btn', { type: 'button', dataset: { view: v }, 'aria-pressed': String(S.ui.view === v), text: l, onclick: () => setView(v) }));
    mainEl.replaceChildren(quoteEl,
      h('div.mk__bar', h('div.mk__grp', { role: 'group', 'aria-label': 'Which chart' }, viewBtns)),
      tvBlock, ownBlock,
      h('section.mk__card', { 'aria-label': 'TradingView technical analysis' }, h('h3', { text: 'Technical analysis by TradingView' }),
        addTV('technical-analysis', { symbol: tvSym(S.sym), interval: '1D', width: '100%', height: '100%', isTransparent: false, showIntervalTabs: true, displayMode: 'single' }, `TradingView technical analysis for ${S.sym}`, 380, '')),
      aiCard);
    tvBlock.hidden = S.ui.view !== 'tv'; ownBlock.hidden = S.ui.view === 'tv';
    chart = createChart(canvas, { readout, live });
    chartParts = { quoteEl, canvas, over };
    paintQuote();
    loadChart();
  }
  function paintQuote() {
    if (!chartParts) return;
    const q = S.quotes.get(S.sym)?.q, er = S.qerr.get(S.sym);
    const k = chartParts.quoteEl;
    if (!q) { k.replaceChildren(h('h2', { text: S.sym }), h('span.mk__sub', { text: er ? 'No price: ' + er.message : 'Fetching the price…' })); return; }
    const chg = q.price - q.prevClose, pct = q.prevClose ? chg / q.prevClose * 100 : null;
    const kind = q.kind, now = Date.now();
    const s = K.sessionState(now, q.tz, { kind, isOpen: q.isOpen });
    k.replaceChildren(
      h('h2', { text: `${q.sym} ${q.name && q.name !== q.sym ? '· ' + q.name : ''}` }),
      h('span.mk__price', { text: px(q.price) }),
      h('span', { class: dir(chg), text: `${K.fmtMoney(chg, { sign: true })} (${pctText(pct)}) vs previous close` }),
      h('span.mk__sub', { text: `Day range ${px(q.low)} to ${px(q.high)}${q.hi52 != null ? ` · 52-week ${px(q.lo52)} to ${px(q.hi52)}` : ''}` }),
      h('span.mk__sub', { text: `${s.label} · ${q.source}, as of ${timeIn(q.asOf, q.tz === 'UTC' ? 'UTC' : q.tz)} (${K.ago(q.asOf, now)})` }));
  }
  async function loadChart() {
    if (!chart) return;
    chartAbort?.abort(); chartAbort = new AbortController();
    const sig = chartAbort.signal, sym = S.sym, range = S.range, mine = chart;
    const over = chartParts.over;
    const show = (text, btn) => { over.hidden = !text; over.replaceChildren(...(text ? [h('div', h('p', { text }), btn || null)] : [])); };
    if (!S.key) { mine.set(null); show('Charts from your own data need your free Twelve Data key. TradingView’s chart works without one.', h('button.mk__btn.mk__btn--go', { type: 'button', text: 'Open Settings', onclick: () => { S.tab = 'settings'; paintTop(); paintMain(); } })); return; }
    const slow = setTimeout(() => { if (chart === mine && !sig.aborted) show('Loading ' + sym + '…'); }, 250);   /* a quick answer never flashes this */
    try {
      const r = await D.bars(sym, range, S.key, { signal: sig });
      if (dead || chart !== mine || sig.aborted) return;
      const R = D.RANGES[range];
      const full = r.bars;
      const disp = R.daily ? D.sliceDays(full, R.days) : full;
      S.series = { sym, range, full, disp, iv: r.iv, tz: r.tz, daily: !!R.daily || range === '5Y' };
      if (!disp.length) { show('The provider returned no bars for ' + sym + ' in this range.'); mine.set(null); return; }
      show('');
      drawChart();
    } catch (e) {
      if (dead || sig.aborted || e.name === 'AbortError' || chart !== mine) return;
      mine.set(null);
      show(errText(e), h('button.mk__btn', { type: 'button', text: 'Try again', onclick: () => { D.clearCache(); loadChart(); } }));
      say(errText(e), 'error');
    } finally { clearTimeout(slow); }
  }
  function drawChart() {
    const s = S.series;
    if (!chart || !s || s.sym !== S.sym) return;
    const I = K.indicatorsOf(s.full);
    const off = s.full.length - s.disp.length;
    const cut = a => a.slice(off);
    const Is = { sma20: cut(I.sma20), sma50: cut(I.sma50), ema20: cut(I.ema20), rsi: cut(I.rsi), macd: { line: cut(I.macd.line), signal: cut(I.macd.signal), hist: cut(I.macd.hist) }, bb: { mid: cut(I.bb.mid), up: cut(I.bb.up), lo: cut(I.bb.lo) } };
    chart.set({ bars: s.disp, I: Is, type: S.ui.type, ind: S.ui.ind, tz: s.tz === 'UTC' ? 'UTC' : s.tz, daily: s.daily, range: s.range });
    chartParts.canvas.setAttribute('aria-label', `${s.sym} ${D.RANGES[s.range].label} chart, ${s.disp.length} bars of ${s.iv}, from ${s.disp[0].d} to ${s.disp[s.disp.length - 1].d}, last close ${fmtPrice(s.disp[s.disp.length - 1].c)}. Use the left and right arrow keys to move through the bars.`);
  }

  /* ---------- AI ---------- */
  async function askAI(kind, out, btns) {
    const s = S.series, q = S.quotes.get(S.sym)?.q;
    if (!S.key) { out.replaceChildren(h('p.mk__sub', { text: 'The AI reads real numbers from your free Twelve Data key, so add one in Settings first. The TradingView chart is for looking only; its prices cannot be read by StaticOS.' })); return; }
    if (!s || s.sym !== S.sym || !q) { out.replaceChildren(h('p.mk__sub', { text: 'Wait for the price and chart to load first. The AI only reads real data.' })); return; }
    aiAbort?.abort(); aiAbort = new AbortController();
    const sig = aiAbort.signal;
    const summary = K.chartSummary({ q, bars: s.disp, full: s.full, rangeLabel: D.RANGES[s.range].label, interval: s.iv, now: Date.now() });
    const ask = kind === 'ideas'
      ? 'Give a student ideas for what to watch on this chart: levels, indicator conditions and risks, framed as things to observe, not predictions or advice.'
      : 'Explain what this chart shows: the trend, key levels, what each indicator says now, the risks, and what to watch.';
    for (const b of btns) b.disabled = true;
    out.replaceChildren(h('p.mk__sub', { text: 'Thinking…' }));
    try {
      const text = await LLM.stream([{ role: 'system', content: K.AI_SYSTEM }, { role: 'user', content: `${ask}\n\nDATA (real, from ${q.source}):\n${summary}` }],
        { signal: sig, onText: t => { if (!dead) out.replaceChildren(md(t)); }, onWait: () => { if (!dead) out.replaceChildren(h('p.mk__sub', { text: 'The free model is busy, waiting a moment…' })); } });
      if (!dead) out.replaceChildren(md(text), h('p.mk__sub', { text: `${NOTE} Written by an AI from the numbers above; it can be wrong.` }));
    } catch (e) {
      if (!dead && e.name !== 'AbortError') out.replaceChildren(h('p.mk__down', { role: 'alert', text: errText(e) }));
    } finally { for (const b of btns) b.disabled = false; }
  }

  /* ---------- trade tab ---------- */
  let tradeUpd = null;
  function paintTrade() {
    const sym = S.sym;
    if (!sym) { mainEl.replaceChildren(h('p.mk__sub', { text: 'Pick a symbol first.' })); return; }
    const q0 = S.quotes.get(sym)?.q;
    const crypto = D.isCrypto(sym);
    const side = h('select#mk-side', { 'aria-label': 'Buy or sell' }, h('option', { value: 'buy', text: 'Buy' }), h('option', { value: 'sell', text: 'Sell' }));
    const type = h('select#mk-type', { 'aria-label': 'Order type' }, h('option', { value: 'market', text: 'Market (now)' }), h('option', { value: 'limit', text: 'Limit (your price)' }));
    const qty = h('input.mk__in#mk-qty', { inputmode: 'decimal', value: '1', 'aria-label': crypto ? 'Quantity (up to 6 decimals)' : 'Shares (whole)' });
    const lim = h('input.mk__in#mk-limit', { inputmode: 'decimal', placeholder: q0 ? (q0.price / 100).toFixed(2) : '', 'aria-label': 'Limit price in dollars' });
    const limF = h('label.mk__f', { hidden: true }, h('span', { text: 'Limit price ($)' }), lim);
    const est = h('dl.mk__est', { id: 'mk-est', 'aria-label': 'Order preview' });
    const why = h('div.mk__why#mk-why', { role: 'status' });
    const result = h('div', { id: 'mk-result', role: 'status', 'aria-live': 'polite' });
    const place = h('button.mk__btn.mk__btn--go#mk-place', { type: 'submit', text: 'Place practice order' });
    const hdrPrice = h('span.mk__price'), hdrSub = h('span.mk__sub');
    const row = (k, v) => [h('dt', { text: k }), h('dd', { text: v })];
    /* the order as typed: what it would cost, what would be left, and the first thing wrong with it */
    const check = () => {
      const q = S.quotes.get(sym)?.q;
      const buy = side.value === 'buy', isLimit = type.value === 'limit';
      const n = K.parseQty(qty.value), limit = isLimit ? K.parseMoney(lim.value) : null;
      const A = S.acct, free = K.availableCash(A), held = A.positions[sym]?.qty || 0;
      const price = isLimit ? limit : q?.price;
      const total = n && price >= 1 ? K.costOf(n, isLimit && buy && q && q.price < limit ? q.price : price) : null;
      let bad = '';
      if (!S.key) bad = 'Needs your Twelve Data key (Settings): practice orders fill at real prices.';
      else if (!q) bad = S.qerr.get(sym) ? `No real price for ${sym} yet: ${S.qerr.get(sym).message}` : `Waiting for a real price for ${sym}.`;
      else if (!n) bad = crypto ? 'Enter a quantity above zero, up to 6 decimals.' : 'Enter a whole number of shares above zero.';
      else if (!crypto && n % K.UNIT) bad = 'Stocks trade in whole shares here.';
      else if (isLimit && !(limit >= 1)) bad = 'Enter a limit price like 150.25.';
      else if (!(price >= 1)) bad = 'This price is under one cent, which practice trading cannot hold exactly.';
      else if (buy && total > free) bad = `Not enough practice cash: this needs ${money(total)}, you have ${money(free)} free.`;
      else if (!buy && n > held - K.reservedQty(A, sym)) bad = `You can sell at most ${K.fmtQty(Math.max(0, held - K.reservedQty(A, sym)))} ${sym} (you hold ${K.fmtQty(held)}; open sell orders hold the rest).`;
      return { buy, isLimit, n, price, total, free, held, bad };
    };
    const upd = () => {
      limF.hidden = type.value !== 'limit';
      const q = S.quotes.get(sym)?.q;
      const c = check();
      hdrPrice.textContent = q ? px(q.price) : 'no price yet';
      hdrSub.textContent = q ? `${q.source}, as of ${timeIn(q.asOf, q.tz)}` : (S.qerr.get(sym)?.message || 'Waiting for a real price.');
      const rows = [...row('Price used', c.isLimit ? (c.price >= 1 ? `${money(c.price)} (your limit)` : 'enter a limit') : q ? `${px(q.price)} (last price)` : 'none yet')];
      if (c.total != null) rows.push(...row(c.buy ? 'Estimated cost' : 'Estimated proceeds', money(c.total)), ...row('Practice cash now', money(c.free)), ...row('Cash after', money(c.buy ? c.free - c.total : c.free + c.total)));
      else rows.push(...row('Practice cash now', money(c.free)));
      rows.push(...row('You hold', `${K.fmtQty(c.held)} ${sym}`));
      est.replaceChildren(...rows);
      why.textContent = c.bad; why.dataset.bad = String(!!c.bad);
      place.disabled = !!c.bad;
      place.title = c.bad;
    };
    for (const e of [side, type, qty, lim]) e.addEventListener('input', upd);
    const form = h('form.mk__form', { onsubmit: ev => { ev.preventDefault(); submit(); } },
      h('label.mk__f', h('span', { text: 'Side' }), side), h('label.mk__f', h('span', { text: 'Order type' }), type),
      h('label.mk__f', h('span', { text: crypto ? 'Quantity' : 'Shares' }), qty), limF, place);
    async function submit() {
      if (check().bad) { upd(); return; }
      const n = K.parseQty(qty.value);
      let limit = null;
      if (type.value === 'limit') limit = K.parseMoney(lim.value);
      result.textContent = 'Getting the latest real price…';
      let fresh;
      try { fresh = await refreshQuote(sym, true); } catch (e) { result.textContent = 'Order not placed: ' + errText(e); return; }
      if (!fresh) return;
      const r = K.placeOrder(S.acct, { sym, side: side.value, type: type.value, qty: n, limit, price: fresh.price, now: Date.now(), whole: !crypto });
      if (!r.ok) { result.textContent = 'Order not placed: ' + r.error; return; }
      persist(); paintSide();
      const o = r.order;
      const sess = K.sessionState(Date.now(), fresh.tz, { kind: fresh.kind, isOpen: fresh.isOpen });
      const closedNote = sess.state !== 'open' ? ` The market is closed, so this used the last price (as of ${timeIn(fresh.asOf, fresh.tz)}).` : '';
      result.textContent = o.status === 'filled'
        ? `Practice order filled: ${o.side === 'buy' ? 'bought' : 'sold'} ${K.fmtQty(o.qty)} ${sym} at ${money(o.price)} for ${money(o.total)}.${o.pnl != null ? ' Realised ' + K.fmtMoney(o.pnl, { sign: true }) + '.' : ''}${closedNote}`
        : `Limit order placed and waiting: it fills only if a real price reaches ${money(o.limit)}. It is checked only while StaticOS is open with this app running.`;
      upd();
    }
    upd();
    tradeUpd = upd;
    const p = S.acct.positions[sym];
    mainEl.replaceChildren(
      h('div.mk__quote', h('h2', { text: `Practice order: ${sym}` }), hdrPrice, hdrSub),
      h('section.mk__card', h('h3', { text: 'Practice money, not real' }), form, est, why, result,
        h('p.mk__sub.mk__note', { text: 'Market orders fill at the latest real price. Limit orders fill only when a real price reaches your limit, and that is checked only while StaticOS is open and this app has fetched the price.' })),
      ...[practiceNote(sym)].filter(Boolean),
      h('p.mk__sub', { text: p ? `You hold ${K.fmtQty(p.qty)} ${sym}, average cost ${money(K.mulDiv(p.cost, K.UNIT, p.qty))}.` : `You hold no ${sym}.` }));
  }

  /* ---------- portfolio tab ---------- */
  function paintPortfolio() {
    const a = S.acct;
    const prices = {};
    for (const sym of Object.keys(a.positions)) { const q = S.quotes.get(sym)?.q; if (q) prices[sym] = q.price; }
    const P = K.portfolio(a, prices);
    const sum = h('table.mk__sum', { 'aria-label': 'Account summary' }, h('tbody',
      ...[['Cash', money(a.cash)], ['Positions (market value)', money(P.value) + (P.missing ? ` (${P.missing} without a price yet, not counted)` : '')], ['Total value', money(P.equity) + (a.cash0 && !P.missing ? ` (${pctText((P.equity - a.cash0) / a.cash0 * 100)} since you started)` : '')],
        ['Unrealised profit/loss', K.fmtMoney(P.unrealised, { sign: true })], ['Realised profit/loss', K.fmtMoney(a.realised, { sign: true })], ['Started with', money(a.cash0)]]
        .map(([k, v]) => h('tr', h('th', { scope: 'row', text: k }), h('td.n', { text: v })))));
    const posRows = P.rows.map(r => h('tr', { dataset: { pos: r.sym } }, h('td', { text: r.sym }), h('td.n', { text: K.fmtQty(r.qty) }), h('td.n', { text: money(r.avg) }),
      h('td.n', { text: r.price != null ? px(r.price) : 'no price' }), h('td.n', { text: r.value != null ? money(r.value) : 'n/a' }), h('td.n', { class: dir(r.pnl), text: r.pnl != null ? K.fmtMoney(r.pnl, { sign: true }) : 'n/a' })));
    const open = a.orders.filter(o => o.status === 'open');
    const hist = a.orders.filter(o => o.status !== 'open');
    const ordRow = o => h('tr', { dataset: { order: o.id } }, h('td', { text: new Date(o.filledAt || o.placedAt).toLocaleString() }), h('td', { text: o.sym }), h('td', { text: `${o.side} ${o.type}` }), h('td.n', { text: K.fmtQty(o.qty) }),
      h('td.n', { text: o.price != null ? money(o.price) : o.limit != null ? 'limit ' + money(o.limit) : '' }), h('td.n', { text: o.total != null ? money(o.total) : '' }), h('td.n', { class: dir(o.pnl), text: o.pnl != null ? K.fmtMoney(o.pnl, { sign: true }) : '' }), h('td', { text: o.status }));
    const head = ['When', 'Symbol', 'Order', 'Qty', 'Price', 'Total', 'Realised', 'Status'];
    const table = (rows, label) => h('div.mk__tw', h('table', { 'aria-label': label }, h('thead', h('tr', head.map((x, i) => h('th', { class: i > 2 && i < 7 ? 'n' : '', text: x })))), h('tbody', rows)));
    const cash = h('input.mk__in#mk-reset-cash', { value: (a.cash0 / 100).toFixed(2), inputmode: 'decimal', 'aria-label': 'Starting cash for the new account', size: 12 });
    const rmsg = h('span.mk__sub', { role: 'status' });
    const reset = h('button.mk__btn#mk-reset', { type: 'button', text: 'Reset practice account' });
    reset.onclick = () => {
      if (reset.dataset.armed !== '1') { reset.dataset.armed = '1'; reset.textContent = 'Click again to erase positions and history'; return; }
      const c = K.parseMoney(cash.value);
      if (c == null || c < 100) { rmsg.textContent = 'Enter a starting amount of at least $1.00.'; reset.dataset.armed = ''; reset.textContent = 'Reset practice account'; return; }
      S.acct = K.newAccount(c, Date.now()); persist(); paintMain();
    };
    mainEl.replaceChildren(
      h('section.mk__card', h('h3', { text: 'Practice account (not real money)' }), sum),
      h('section.mk__card', h('h3', { text: 'Positions' }), posRows.length ? h('div.mk__tw', h('table', { 'aria-label': 'Positions' }, h('thead', h('tr', ['Symbol', 'Quantity', 'Average cost', 'Price', 'Value', 'Unrealised'].map((x, i) => h('th', { class: i ? 'n' : '', text: x })))), h('tbody', posRows))) : h('p.mk__sub', { text: 'No positions yet.' })),
      h('section.mk__card', h('h3', { text: 'Open limit orders' }), open.length ? table(open.map(o => { const r = ordRow(o); r.lastChild.replaceChildren(h('button.mk__btn', { type: 'button', text: 'Cancel', 'aria-label': `Cancel order ${o.id}`, onclick: () => { K.cancelOrder(a, o.id); persist(); paintMain(); } })); return r; }), 'Open orders') : h('p.mk__sub', { text: 'None. Limit orders are checked only while StaticOS is open.' })),
      h('section.mk__card', h('h3', { text: 'Order history' }), hist.length ? table(hist.map(ordRow), 'Order history') : h('p.mk__sub', { text: 'No orders yet.' })),
      h('section.mk__card', h('h3', { text: 'Start over' }), h('div.mk__bar', h('label.mk__f', h('span', { text: 'New starting cash ($)' }), cash), reset, rmsg)));
  }

  /* ---------- scan tab ---------- */
  function paintScan() {
    const out = h('div');
    const info = h('div.mk__sub', { role: 'status', 'aria-live': 'polite' });
    const aiOut = h('div.mk__ai', { 'aria-live': 'polite' });
    const btn = h('button.mk__btn.mk__btn--go#mk-scan', { type: 'button', text: 'Scan the watchlist', onclick: run });
    const stop = h('button.mk__btn', { type: 'button', text: 'Stop', hidden: true, onclick: () => scanAbort?.abort() });
    const aiBtn = h('button.mk__btn#mk-scan-ai', { type: 'button', text: 'Summarise with AI', disabled: true });
    const show = () => {
      const rows = S.scan || [];
      aiBtn.disabled = !rows.some(r => r.scan);
      if (!rows.length) { out.replaceChildren(); return; }
      out.replaceChildren(h('div.mk__tw', h('table#mk-scan-table', { 'aria-label': 'Scan results' },
        h('thead', h('tr', ['Symbol', 'Last close', 'RSI 14', 'Position in range', 'Volume vs avg', 'Signals'].map((x, i) => h('th', { class: i > 0 && i < 5 ? 'n' : '', text: x })))),
        h('tbody', rows.map(r => r.error
          ? h('tr', { dataset: { sym: r.sym } }, h('td', { text: r.sym }), h('td', { colSpan: 5, text: 'No result: ' + r.error }))
          : h('tr', { dataset: { sym: r.sym, flags: String(r.scan.hits.length) } },
            h('td', h('button.mk__btn', { type: 'button', text: r.sym, 'aria-label': `Open the ${r.sym} chart`, onclick: () => select(r.sym, true) })),
            h('td.n', { text: r.scan.last ? fmtPrice(r.scan.last.c) : 'n/a' }),
            h('td.n', { text: r.scan.rsi == null ? 'n/a' : r.scan.rsi.toFixed(1) }),
            h('td.n', { text: r.scan.rangePos == null ? 'n/a' : Math.round(r.scan.rangePos * 100) + '% of ' + r.scan.rangeBars + ' bars' }),
            h('td.n', { text: r.scan.vol == null ? 'n/a' : r.scan.vol.toFixed(2) + 'x' }),
            h('td', { text: r.scan.hits.length ? r.scan.hits.map(x => x.text).join('; ') : r.scan.note || 'No rule triggered' })))))));
    };
    async function run() {
      if (scanAbort) scanAbort.abort();
      scanAbort = new AbortController(); const sig = scanAbort.signal;
      btn.disabled = true; stop.hidden = false; S.scan = [];
      const syms = [...S.watch];
      let i = 0;
      try {
        for (const sym of syms) {
          info.textContent = `Reading ${sym} (${++i} of ${syms.length}). The free stock plan allows 8 requests a minute, so a long list takes a while.`;
          try {
            if (!S.key) throw new D.MarketError('nokey', 'needs your Twelve Data key (Settings)');
            const r = await D.bars(sym, '1Y', S.key, { signal: sig });
            const done = K.completedBars(r.bars, kindOf(sym), Date.now(), r.tz);
            S.scan.push({ sym, scan: K.scanBars(done, { kind: kindOf(sym) }), asOf: done.length ? done[done.length - 1].d : null });
          } catch (e) { if (e.name === 'AbortError') throw e; S.scan.push({ sym, error: errText(e) }); if (e.code === 'badkey' || e.code === 'limit-day') say(errText(e), 'error'); }
          if (dead) return; show();
        }
        info.textContent = `Scanned ${syms.length} symbol${syms.length === 1 ? '' : 's'} on completed daily bars (today’s unfinished bar is left out). These are rule readings of past data, not predictions.`;
      } catch (e) { info.textContent = e.name === 'AbortError' ? 'Scan stopped.' : errText(e); }
      finally { if (!dead) { btn.disabled = false; stop.hidden = true; show(); } }
    }
    aiBtn.onclick = async () => {
      const rows = (S.scan || []).filter(r => r.scan);
      if (!rows.length) return;
      aiAbort?.abort(); aiAbort = new AbortController();
      aiBtn.disabled = true; aiOut.replaceChildren(h('p.mk__sub', { text: 'Thinking…' }));
      try {
        const text = await LLM.stream([{ role: 'system', content: K.AI_SYSTEM }, { role: 'user', content: `Summarise this rule-based scan of a student's watchlist in plain language. Say which symbols have flags and what each flag means (not a prediction), and which have none.\n\nSCAN RESULTS (computed from real daily bars):\n${K.scanSummary(rows)}\n\nRules: ${K.SCAN_RULES.map(r => r.title + ': ' + r.text).join(' | ')}` }],
          { signal: aiAbort.signal, onText: t => { if (!dead) aiOut.replaceChildren(md(t)); } });
        if (!dead) aiOut.replaceChildren(md(text), h('p.mk__sub', { text: NOTE }));
      } catch (e) { if (!dead && e.name !== 'AbortError') aiOut.replaceChildren(h('p.mk__down', { role: 'alert', text: errText(e) })); }
      finally { if (!dead) aiBtn.disabled = false; }
    };
    mainEl.replaceChildren(
      h('section.mk__card', h('h3', { text: 'Scan all charts in the watchlist' }),
        h('p.mk__sub', { text: 'A fixed set of rules run on each symbol’s real daily bars. A flag says something happened in the past data; it does not say what happens next.' }),
        h('div.mk__bar', btn, stop, aiBtn), aiLine(), info, out, aiOut),
      h('section.mk__card', { 'aria-label': 'TradingView screener' }, h('h3', { text: 'Screener by TradingView' }),
        h('p.mk__sub', { text: 'TradingView’s own screener for the whole market, with its own filters. It is separate from the scan above, which runs on your watchlist.' }),
        D.isCrypto(S.sym || '') ? addTV('crypto-mkt-screener', { defaultColumn: 'overview', screener_type: 'crypto_mkt', displayCurrency: 'USD', width: '100%', height: '100%', isTransparent: false }, 'TradingView crypto screener', 520, '')
          : addTV('screener', { market: 'america', showToolbar: true, defaultColumn: 'overview', defaultScreen: 'most_capitalized', width: '100%', height: '100%', isTransparent: false }, 'TradingView stock screener', 520, '')),
      h('details.mk__card', h('summary', { text: 'What each rule checks' }), h('ul', ...K.SCAN_RULES.map(r => h('li', h('b', { text: r.title + ': ' }), r.text)))));
    show();
  }

  /* ---------- settings tab ---------- */
  function paintSettings() {
    const keyIn = h('input.mk__in#mk-key', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: S.key ? 'Key saved on this device' : 'Paste your key', 'aria-label': 'Twelve Data API key', size: 34 });
    const kmsg = h('span.mk__sub', { role: 'status', id: 'mk-keymsg' });
    const say2 = (text, kind) => { kmsg.textContent = text; kmsg.className = 'mk__sub' + (kind === 'ok' ? ' mk__keyok' : kind === 'bad' ? ' mk__down' : ''); };
    const saveKey = h('button.mk__btn.mk__btn--go', { type: 'button', text: 'Save and test key' });
    const rmKey = h('button.mk__btn', { type: 'button', text: 'Remove key', disabled: !S.key, onclick: () => { S.key = ''; persist(); D.clearCache(); say2('Key removed.'); rmKey.disabled = true; keyIn.placeholder = 'Paste your key'; paintSide(); } });
    /* one cheap request (1 of the 800 daily credits) says whether the key works, so a typo shows now, not later as a blank chart */
    saveKey.onclick = async () => {
      const v = keyIn.value.trim();
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(v)) { say2('That does not look like a key (letters and numbers, 8 to 64 characters).', 'bad'); return; }
      saveKey.disabled = true; say2('Testing the key with one request to Twelve Data…');
      let note = '';
      try { await D.testKey(v, { signal: ac.signal }); }
      catch (e) {
        if (dead || e.name === 'AbortError') return;
        saveKey.disabled = false;
        if (e.code === 'badkey') { say2('Twelve Data did not accept that key, so it was not saved. Copy it again from your Twelve Data dashboard.', 'bad'); return; }
        note = ` Saved, but it could not be tested just now: ${errText(e)}`;
      }
      if (dead) return;
      saveKey.disabled = false;
      S.key = v; persist(); D.clearCache(); S.qerr.clear(); keyIn.value = ''; keyIn.placeholder = 'Key saved on this device'; rmKey.disabled = false;
      say2(note ? note.trim() : 'The key works: Twelve Data answered. Saved on this device only.', note ? 'info' : 'ok');
      tick(true);
    };
    const cash = h('input.mk__in', { value: '10,000', inputmode: 'decimal', 'aria-label': 'Starting practice cash in dollars', size: 10 });
    const mmsg = h('span.mk__sub', { role: 'status' });
    const setMode = mode => {
      if (mode === 'practice' && !S.acct) {
        const c = K.parseMoney(cash.value);
        if (c == null || c < 100) { mmsg.textContent = 'Enter a starting amount of at least $1.00 first.'; return; }
        S.acct = K.newAccount(c, Date.now());
      }
      S.mode = mode; persist(); paintTop(); paintMain(); paintSide();
    };
    mainEl.replaceChildren(
      h('section.mk__card', h('h3', { text: 'How you use Static Markets' }),
        h('p.mk__sub', { text: 'StaticOS only does practice trading. Prices are real, the money is not.' }),
        h('div.mk__bar',
          h('button.mk__btn#mk-mode-practice', { type: 'button', 'aria-pressed': String(S.mode === 'practice'), text: 'Practice trading', onclick: () => setMode('practice') }),
          h('button.mk__btn#mk-mode-watch', { type: 'button', 'aria-pressed': String(S.mode === 'watch'), text: 'Just watch', onclick: () => setMode('watch') }),
          S.acct ? null : h('label.mk__f', h('span', { text: 'Starting practice cash ($)' }), cash), mmsg),
        S.acct ? h('p.mk__sub', { text: 'Switching to Just watch hides the trading panel; your practice account is kept for when you switch back.' }) : null),
      h('section.mk__card', h('h3', { text: 'Stock data: your free Twelve Data key' }),
        h('ol.mk__sub', h('li', {}, 'Go to ', h('a', { href: 'https://twelvedata.com/', target: '_blank', rel: 'noopener noreferrer', text: 'twelvedata.com' }), ' and choose Get free API key (the Basic plan costs nothing).'), h('li', { text: 'Sign up with an email and confirm it.' }), h('li', { text: 'Open the dashboard, find API key, and copy it.' }), h('li', { text: 'Paste it here and press Save and test key. That makes one request to check it.' })),
        h('div.mk__bar', keyIn, saveKey, rmKey), kmsg,
        h('p.mk__sub', { text: 'The key is stored only on this device, in your StaticOS data, and is sent only to api.twelvedata.com. It is included if you use Back up your data, so keep that file private. The free plan allows 8 requests a minute and 800 a day; the app waits and tells you when it hits a limit. One key covers stocks, ETFs and crypto, and the 8 a minute is shared between them. TradingView’s own charts, technical analysis and screener need no key.' })),
      h('section.mk__card', h('h3', { text: 'Where the numbers come from' }),
        h('p.mk__sub', { text: 'Stocks, ETFs and crypto pairs: Twelve Data (each quote shows the time it is as of). TradingView’s widgets bring their own data and cannot be read by StaticOS. Charts and indicators (SMA, EMA, RSI, MACD, Bollinger) are computed here from those bars. ' + NOTE })));
  }

  /* ---------- go ---------- */
  function paintAll() { paintTop(); paintSide(); paintMain(); if (S.mode) tick(true); }
  paintAll();
  const iv = setInterval(() => tick(false), 15000);

  return () => {
    dead = true;
    clearInterval(iv);
    for (const t of timers) t.stop?.();
    ac.abort(); aiAbort?.abort(); scanAbort?.abort(); chartAbort?.abort();
    D.setWaitHandler(null);
    unTheme?.(); for (const t of tvs) t.destroy();
    chart?.destroy(); ro.disconnect();
  };
}
