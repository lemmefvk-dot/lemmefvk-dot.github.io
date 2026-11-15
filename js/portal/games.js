/* ============================================================
   games.js — Static Games: the library, the detail page and the
   play stage.

   Two routes live here:
     static://games        buildGames()      home + browse
     static://games/<id>   buildGameDetail() details, then play

   Both return their root node synchronously and fill themselves
   in afterwards, so navigation never blocks on the catalogue.

   WHERE THE DATA COMES FROM
   The catalogue is games.data.js — a local, static, ~5,900-row
   index. This page talks to it directly rather than through
   providers.listGames() because the platform UI needs the index
   synchronously (related games, per-category counts, ordered
   favourites) and a 5,900-row home screen cannot afford a
   promise per shelf. providers.resolve() is still the seam that
   decides what actually plays, so proxy mode still governs
   playback, and providers.config.simulateOutage is honoured
   below so the error states stay testable.

   WHAT IS NEVER SHOWN
   No feed reports measured plays or ratings, so every row arrives
   with 0. games.data.js flags rows that do have real numbers as
   `hasStats`, and nothing here renders a play count, a rating or
   a "hot" badge for a row that lacks it.
   No shelf on this page is a guess: "Trending" counts this
   device's own launches, "Recently added" only appears if the
   catalogue ever starts carrying timestamps.
   ============================================================ */

import { BRAND } from './brand.js';
import * as catalogue from './games.data.js';
import { t } from '../core/i18n.js';
import * as plays from '../core/plays.js';
import { useArtButton } from './useart.js';
import { paintFriendPanel } from './sendfriend.js';

if (typeof document !== 'undefined' && !document.getElementById('gamesportal-css')) {
  const link = document.createElement('link');
  link.id = 'gamesportal-css';
  link.rel = 'stylesheet';
  link.href = 'css/gamesportal.css';
  document.head.appendChild(link);
}

const LIB = 'static://games';
const urlFor = id => `${LIB}/${id}`;

/** Plays above this get the flame badge instead of the star. */
const HOT = 800000;
/** Browse grid page size — the catalogue is 5,900 rows, nothing renders it all. */
const PER_PAGE = 60;
/** Cards per horizontal shelf on the home view. */
const ROW_N = 18;
/** How many category shelves the home view builds. */
const ROW_CATS = 8;

/* The top-strip destinations, shared by every Static page. */
const NAV = [
  ['home',   'Home',   'static://home',   'home'],
  ['games',  'Games',  'static://games',  'gamepad'],
  ['movies', 'Movies', 'static://movies', 'film'],
  ['anime',  'Anime',  'static://anime',  'star'],
  ['search', 'Search', 'static://search', 'search'],
];

/* ------------------------------------------------------------------ *
 *  personal state — favourites, history, this device's play log
 *
 *  store.set() short-circuits when the value is identical by reference,
 *  so every write below hands it a freshly built array or object.
 * ------------------------------------------------------------------ */
const K_FAV    = 'portal.games.favs';
const K_RECENT = 'portal.games.recent';
const K_PLAYS  = 'portal.games.playlog';

/* Launches ever, on this device: id -> count. Behind "Your most played" and
   "Not played yet". Never a number from anyone else. */
const K_LAUNCH = 'portal.games.launches';
/* Games this person hid: [{ id, at, why }], why 'skip' (not interested) or
   'broken' (reported as not loading). They come back from the Hidden list. */
const K_HIDDEN = 'portal.games.hidden';
const K_QUEUE  = 'portal.games.queue';       // ids, next first
const K_MINE   = 'portal.games.mine';        // id -> { note, best }, typed by this person
const K_TODAY  = 'portal.games.today';       // { day, ms }: time on the play stage today
const K_REMIND = 'portal.games.remindMin';   // 0 = off, else minutes of play today
const K_HINT   = 'portal.games.hintSeen';
const K_AUTO   = 'portal.games.autoplay';    // one-shot: start this game when its page opens

const WEEK = 7 * 86400000;
const MAX_FAV = 400;
const MAX_RECENT = 60;
const MAX_HIDDEN = 500;
const MAX_QUEUE = 30;
const MAX_MINE = 300;
const MAX_LAUNCH = 1500;

const arrOf = v => (Array.isArray(v) ? v : []);

const favIds = api => arrOf(api.store.get(K_FAV, [])).filter(x => typeof x === 'string');
const isFav  = (api, id) => favIds(api).includes(id);

function toggleFav(api, id) {
  const cur = favIds(api);
  const on = !cur.includes(id);
  api.store.set(K_FAV, on ? [id, ...cur].slice(0, MAX_FAV) : cur.filter(x => x !== id));
  if (on) api.bus.emit('game:fav', { id });
  return on;
}

const recentRows = api =>
  arrOf(api.store.get(K_RECENT, [])).filter(r => r && typeof r.id === 'string');

function noteRecent(api, id) {
  const cur = recentRows(api);
  api.store.set(K_RECENT, [{ id, at: Date.now() }, ...cur.filter(r => r.id !== id)].slice(0, MAX_RECENT));
}

function playLog(api) {
  const v = api.store.get(K_PLAYS, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * Record a launch, and drop anything older than a week while we are here —
 * this log is the ONLY thing behind the Trending shelf, so it has to stay
 * both small and genuinely recent.
 */
function notePlay(api, id) {
  const now = Date.now();
  const next = {};
  for (const [key, list] of Object.entries(playLog(api))) {
    const keep = arrOf(list).filter(t => typeof t === 'number' && now - t < WEEK);
    if (keep.length) next[key] = keep.slice(-40);
  }
  next[id] = [...(next[id] || []), now].slice(-40);
  api.store.set(K_PLAYS, next);
  noteLaunch(api, id);
}

function launchLog(api) {
  const v = api.store.get(K_LAUNCH, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function noteLaunch(api, id) {
  const cur = { ...launchLog(api) };
  cur[id] = (Number(cur[id]) || 0) + 1;
  const keys = Object.keys(cur);
  if (keys.length > MAX_LAUNCH) {
    for (const k of keys.sort((a, b) => cur[a] - cur[b]).slice(0, keys.length - MAX_LAUNCH)) delete cur[k];
  }
  api.store.set(K_LAUNCH, cur);
}
/** [id, launches] busiest first — only games launched at least once on this device. */
const mostPlayed = (api, n) => Object.entries(launchLog(api))
  .filter(([, c]) => Number(c) > 0)
  .sort((a, b) => b[1] - a[1])
  .slice(0, n);
const hasPlayed = (api, id) => (Number(launchLog(api)[id]) || 0) > 0 || recentRows(api).some(r => r.id === id);

const hiddenRows = api => arrOf(api.store.get(K_HIDDEN, [])).filter(r => r && typeof r.id === 'string');
const hiddenIds = api => new Set(hiddenRows(api).map(r => r.id));
function hideGame(api, id, why = 'skip') {
  const cur = hiddenRows(api).filter(r => r.id !== id);
  api.store.set(K_HIDDEN, [{ id, at: Date.now(), why: why === 'broken' ? 'broken' : 'skip' }, ...cur].slice(0, MAX_HIDDEN));
  /* a game you hid should not also wait in the queue */
  const q = queueIds(api);
  if (q.includes(id)) api.store.set(K_QUEUE, q.filter(x => x !== id));
}
const unhideGame = (api, id) => api.store.set(K_HIDDEN, hiddenRows(api).filter(r => r.id !== id));
/** Rows minus anything this person hid. */
const shown = (api, rows) => { const hid = hiddenIds(api); return hid.size ? rows.filter(g => !hid.has(g.id)) : rows; };
/** `exclude` for catalogue.query(): the caller's own, plus the hidden games. */
const without = (api, extra) => { const s = hiddenIds(api); for (const x of extra || []) s.add(x); return s; };

const queueIds = api => arrOf(api.store.get(K_QUEUE, [])).filter(x => typeof x === 'string');
const inQueue = (api, id) => queueIds(api).includes(id);
function toggleQueue(api, id) {
  const cur = queueIds(api);
  const on = !cur.includes(id);
  api.store.set(K_QUEUE, on ? [...cur, id].slice(0, MAX_QUEUE) : cur.filter(x => x !== id));
  return on;
}

function mineMap(api) {
  const v = api.store.get(K_MINE, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
const mineOf = (api, id) => { const m = mineMap(api)[id]; return m && typeof m === 'object' ? m : { note: '', best: '' }; };
function saveMine(api, id, patch) {
  const all = { ...mineMap(api) };
  const next = { note: '', best: '', ...mineOf(api, id), ...patch };
  next.note = String(next.note || '').slice(0, 500);
  next.best = String(next.best || '').slice(0, 24);
  if (!next.note.trim() && !next.best.trim()) delete all[id];
  else all[id] = { note: next.note, best: next.best, at: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > MAX_MINE) for (const k of keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - MAX_MINE)) delete all[k];
  api.store.set(K_MINE, all);
}

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
/* Time on the play stage today: { day, ms, told } — told is the reminder level
   already announced today, so it is said once. */
function todayRec(api) {
  const v = api.store.get(K_TODAY, null);
  return v && v.day === dayKey() ? { day: v.day, ms: Math.max(0, Number(v.ms) || 0), told: Number(v.told) || 0 } : { day: dayKey(), ms: 0, told: 0 };
}
const playedToday = api => todayRec(api).ms;
function addPlayedToday(api, ms) {
  const cur = todayRec(api);
  api.store.set(K_TODAY, { ...cur, ms: cur.ms + Math.max(0, ms) });
}
const remindLevel = api => { const m = Number(api.store.get(K_REMIND, 0)); return [30, 60, 120].includes(m) ? m : 0; };
/** "42 min", "1 h 05 min" — measured time, rounded down to the minute. */
const minText = ms => {
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

/** Ids this device has launched most in the past week, busiest first. */
function trendingIds(api, n) {
  const now = Date.now();
  return Object.entries(playLog(api))
    .map(([id, list]) => [id, arrOf(list).filter(t => now - t < WEEK).length])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id);
}

/* ------------------------------------------------------------------ *
 *  small shared helpers
 * ------------------------------------------------------------------ */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return 'unknown host'; }
}

const errText = err => (err && err.message) || 'The catalogue threw an unexpected error.';

const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'game';

const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
const num = n => Number(n || 0).toLocaleString();

const listOf = v => (Array.isArray(v) ? v : []);

const playsText = (providers, n) =>
  (providers && typeof providers.fmtPlays === 'function' ? providers.fmtPlays(Number(n) || 0) : num(n));

const rateText = r => (Number(r) || 0).toFixed(1);

/* A real browser signal, not a guess: only said when the browser says so. */
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const netLine = () => (offline() ? ' This device is offline right now.' : '');

const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
};

/** Is the keyboard currently inside a text control? */
function typingIn(target) {
  const tag = (target && target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);
}

/** ?cat=puzzle&sort=az — the games route has no query parser of its own. */
function paramsOf(url) {
  const s = String(url || '');
  const i = s.indexOf('?');
  if (i < 0) return {};
  try {
    const out = {};
    for (const [k, v] of new URLSearchParams(s.slice(i + 1))) out[k] = v;
    return out;
  } catch (e) { return {}; }
}

/**
 * The catalogue, with providers' outage switch honoured so the error states
 * stay reachable from the console the same way every other page's are.
 */
async function loadCatalogue(providers) {
  if (providers && providers.config && providers.config.simulateOutage) {
    throw new Error('Could not reach the games catalogue.');
  }
  await catalogue.load();
  const err = catalogue.loadError();
  /* load() degrades to the curated shelf rather than throwing, so a partial
     catalogue still renders — but say so instead of pretending it is whole. */
  return err;
}

/**
 * Page lifecycle. The router just clears its view node, so each page
 * watches for its own removal and runs its cleanups then: timers and
 * window listeners never outlive the page that opened them.
 */
function lifecycle(root) {
  const fns = [];
  let done = false;
  let attached = false;
  const run = () => {
    if (done) return;
    done = true;
    for (const fn of fns.splice(0)) {
      try { fn(); } catch (e) { console.warn('[Static] teardown', e); }
    }
  };
  /* Not-yet-attached is not dead: build() hands the node back before the
     router appends it, so async work must still be allowed to land. */
  const dead = () => {
    if (done) return true;
    if (root.isConnected) { attached = true; return false; }
    return attached;
  };
  let tries = 0;
  const watch = () => {
    if (done) return;
    const parent = root.parentNode;
    if (!parent) { if (++tries < 240) requestAnimationFrame(watch); return; }
    const obs = new MutationObserver(() => { if (!root.isConnected) { obs.disconnect(); run(); } });
    obs.observe(parent, { childList: true });
    fns.push(() => obs.disconnect());
  };
  requestAnimationFrame(watch);
  root.cherriTeardown = run;
  return { add: fn => { if (done) fn(); else fns.push(fn); }, run, get dead() { return dead(); } };
}

/**
 * Set the window subtitle and keep it.
 * The Browser repaints its own chrome a beat after every navigation and
 * blanks the subtitle for in-OS urls; wm emits win:title whenever it does,
 * so claim the line back on the next frame rather than losing it.
 */
function claimSubtitle(ctx, life, text) {
  const { api, win } = ctx;
  if (!win || typeof win.setSubtitle !== 'function') return;
  const set = () => { if (!life.dead) win.setSubtitle(text); };
  set();
  if (!api.bus || typeof api.bus.on !== 'function') return;
  life.add(api.bus.on('win:title', w => {
    if (life.dead || (w && w !== win && w.el !== win.el)) return;
    requestAnimationFrame(set);
  }));
}

/** The nearest ancestor that scrolls — the page lives in the Browser's view. */
function scrollParent(el) {
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * Give the filter bar a backdrop once it sticks under the top strip.
 * The observer has to use the scrolling ancestor as its root: the page sits
 * inside a window, so the viewport's top edge is nowhere near the bar's.
 */
function watchStuck(bar, sentinel, strip) {
  let io = null, stopped = false, tries = 0;
  const start = () => {
    if (stopped || io) return;
    if (!bar.isConnected) { if (++tries < 240) requestAnimationFrame(start); return; }
    /* Both the top strip and this bar are sticky at top:0 in the same
       scroller, and the strip wins on z-index — so without this offset the
       whole category/filter/sort row pins *underneath* it and is unclickable. */
    if (strip && strip.offsetHeight) bar.style.top = strip.offsetHeight + 'px';
    if (typeof IntersectionObserver !== 'function') return;
    const root = scrollParent(bar);
    if (!root) return;
    try {
      io = new IntersectionObserver(entries => {
        for (const e of entries) {
          const rb = e.rootBounds;
          bar.classList.toggle('cx__bar--stuck',
            !e.isIntersecting && (!rb || e.boundingClientRect.top < rb.top + 1));
        }
      }, { root, threshold: 0 });
      io.observe(sentinel);
    } catch (err) { io = null; }
  };
  requestAnimationFrame(start);
  return () => { stopped = true; if (io) io.disconnect(); };
}

/**
 * One watcher per page: `watch(node, fn)` runs `fn` the first time `node` comes
 * within a screenful of the viewport. This is what keeps the home screen cheap —
 * the shelves below the fold hold nothing but a skeleton until you head there.
 *
 * It measures on scroll rather than using an IntersectionObserver because an
 * observer only fires on a *transition*: dragging the scrollbar straight to the
 * bottom jumps clean over the middle shelves, which then never fire and sit on
 * their skeletons for good. A rect check per scroll frame does not have that hole.
 */
/** Layout offset from the document, unaffected by any ancestor transform. */
function layoutTop(el) {
  let y = 0;
  for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
  return y;
}

function nearWatcher(root, life) {
  const waiting = [];
  let scroller = null;
  let queued = false;
  let unbind = null;
  let settleTries = 0;

  /* Everything here measures in LAYOUT pixels (offsetTop / clientHeight), never
     getBoundingClientRect. The window opens with a scale-in animation, so during
     those frames every client rect is a fraction of its real size — measuring
     that way fired all eleven shelves on the first frame and threw the lazy
     loading away entirely. Layout offsets ignore the transform. */
  const check = () => {
    queued = false;
    if (life.dead || !waiting.length) return;
    if (!scroller) scroller = scrollParent(root);

    const base = scroller ? layoutTop(scroller) : 0;
    const limit = scroller
      ? base + scroller.scrollTop + scroller.clientHeight + 400
      : (document.documentElement.scrollTop || 0) + window.innerHeight + 400;
    if (scroller && !scroller.clientHeight) { retry(); return; }

    let unlaid = false;
    const ready = [];
    for (let i = waiting.length - 1; i >= 0; i--) {
      const it = waiting[i];
      if (it.node.isConnected) it.seen = true;
      else if (it.seen) { waiting.splice(i, 1); continue; }   // shelf was removed
      else { unlaid = true; continue; }                        // not mounted yet
      if (!it.node.offsetParent && !it.node.offsetHeight) { unlaid = true; continue; }
      if (layoutTop(it.node) < limit) { waiting.splice(i, 1); ready.push(it.fn); }
    }
    /* run in document order, so shelves fill top-down as they are read */
    for (const fn of ready.reverse()) { try { fn(); } catch (e) { console.warn('[Static] shelf', e); } }
    if (unlaid) { retry(); return; }
    settleTries = 0;
    if (!waiting.length && unbind) { unbind(); unbind = null; }
  };

  const retry = () => { if (++settleTries < 240) ping(); };

  const ping = () => { if (!queued) { queued = true; requestAnimationFrame(check); } };

  const bind = () => {
    if (unbind || life.dead) return;
    scroller = scrollParent(root);
    const target = scroller || window;
    target.addEventListener('scroll', ping, { passive: true });
    window.addEventListener('resize', ping);
    unbind = () => {
      target.removeEventListener('scroll', ping);
      window.removeEventListener('resize', ping);
    };
    life.add(() => { if (unbind) { unbind(); unbind = null; } });
  };

  let tries = 0;
  const boot = () => {
    if (life.dead) return;
    if (!root.isConnected) { if (++tries < 240) requestAnimationFrame(boot); return; }
    bind();
    check();
  };
  requestAnimationFrame(boot);

  return (node, fn) => {
    waiting.push({ node, fn });
    bind();
    ping();
  };
}

/* ------------------------------------------------------------------ *
 *  the strip every Static page wears
 * ------------------------------------------------------------------ */
function topStrip(ctx, current) {
  const { api, navigate } = ctx;
  const { h, icon } = api;

  const input = h('input', {
    type: 'search', placeholder: 'Search Static', spellcheck: 'false', 'aria-label': `Search ${BRAND.name}`,
  });
  const find = h('form.field.cx__find', {
    onsubmit: e => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) navigate(`static://search?q=${encodeURIComponent(q)}`);
    },
  }, icon('search'), input);

  const nav = h('div.cx__nav', { role: 'navigation', 'aria-label': 'Static' },
    NAV.map(([id, label, url, ic]) => h(id === current ? 'button.is-on' : 'button', {
      type: 'button',
      'aria-current': id === current ? 'page' : null,
      onclick: () => navigate(url),
    }, icon(ic), h('span', { text: label }))));

  return h('div.cx__top',
    h('div.cx__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })),
    find, nav);
}

/* ------------------------------------------------------------------ *
 *  loading + failure + empty states
 * ------------------------------------------------------------------ */
function skelCard(h) {
  return h('div.ag-skelcard',
    h('div.cx-skel.cx-skel--art'),
    h('div.cx-skel.cx-skel--line', { style: { width: '72%' } }),
    h('div.cx-skel.cx-skel--line', { style: { width: '44%' } }));
}

function skelGrid(h, n, rail) {
  const grid = h(rail ? 'div.cx__grid.cx__grid--rail' : 'div.cx__grid', { 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) grid.appendChild(skelCard(h));
  return grid;
}

function downBlock(ctx, err, retry, title) {
  const { api } = ctx;
  const { h, icon } = api;
  return h('div.cx-down', { role: 'alert' },
    icon('alert'),
    h('div',
      h('b', { text: title || 'Could not load the games catalogue' }),
      h('small', { text: `${errText(err)}${netLine()} Nothing for this view is cached locally.` }),
      h('div', { style: { marginTop: 'var(--sp-4)' } },
        h('button.btn.btn--sm', { type: 'button', onclick: retry }, icon('refresh'), 'Retry'))));
}

/** An empty state that names the exact filter combination that produced it. */
function emptyBlock(api, { iconName, title, detail, actions }) {
  const { h, icon } = api;
  return h('div.empty.ag-empty',
    icon(iconName || 'gamepad'),
    h('b', { text: title }),
    detail ? h('small', { text: detail }) : null,
    actions && actions.length
      ? h('div.ag-empty__acts', actions)
      : null);
}

/* ------------------------------------------------------------------ *
 *  one game card
 * ------------------------------------------------------------------ */
/**
 * The host's own cover, layered over the procedural art so a slow, blocked or
 * missing image degrades to the gradient instead of an empty box.
 */
function coverImg(api, src, slow) {
  return api.h('img.ag-cover', {
    src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
    style: slow ? { transitionDuration: 'var(--t-slow)' } : null,
    onload: e => { e.target.classList.add('is-in'); },
    onerror: e => { e.target.remove(); },
  });
}

/**
 * The card is a div, not a button: it carries a favourite toggle, and a button
 * inside a button is invalid and unreachable by keyboard. The whole surface is
 * covered by `.ag-card__go`, which is the real link.
 */
function gameCard(ctx, g, opts = {}) {
  const { api, providers, navigate } = ctx;
  const { h, icon } = api;

  const art = h('div.cx-card__art', { style: { '--art': providers.artFor(g.title, 'game') } });
  if (g.art) art.appendChild(coverImg(api, g.art));

  /* Only rows whose feed reports metrics get a badge. Everything else gets
     nothing at all — an invented "0 plays" or a filler 4.0 is worse than
     a blank corner. */
  if (g.hasStats) {
    const hot = g.plays > HOT;
    art.appendChild(h(hot ? 'div.cx-card__tag.cx-card__tag--hot' : 'div.cx-card__tag',
      icon(hot ? 'flame' : 'star', { fill: true }),
      h('span', { text: hot ? playsText(providers, g.plays) : rateText(g.rating) })));
  }
  if (!g.art) art.appendChild(h('div.cx-card__mono', { text: g.title }));
  art.appendChild(h('div.cx-card__play', h('i', icon('play', { fill: true }))));

  /* which site the game is from, plainly — and a game that only runs on its
     own site says so before you click */
  const theirs = catalogue.opensOnTheirSite(g);
  const meta = h('div.cx-card__m', { title: theirs ? t('From {studio}. Opens on {studio}, in a new tab.', { studio: g.studio }) : `From ${g.studio}` },
    icon(theirs ? 'external-link' : 'globe'), h('span.ag-from', { text: g.studio }));
  if (opts.launches) {
    meta.append(h('span.ag-dot', { text: '·' }),
      h('span.ag-nowrap', { text: `${num(opts.launches)} launch${opts.launches === 1 ? '' : 'es'} here` }));
  }
  if (g.hasStats) {
    meta.append(h('span.ag-dot', { text: '·' }),
      h('span.ag-nowrap', { text: `${playsText(providers, g.plays)} plays` }));
  }

  const label = g.hasStats
    ? `Play ${g.title} — ${g.studio}, ${num(g.plays)} plays, rated ${rateText(g.rating)} out of 5`
    : `Play ${g.title} — ${g.studio}`;

  const go = h('button.ag-card__go', {
    type: 'button', 'aria-label': label,
    onclick: () => navigate(urlFor(g.id)),
  });

  const card = h('div.ag-card.cx-card',
    art,
    h('div.cx-card__b', h('div.cx-card__t', { text: g.title }), meta),
    go,
    favButton(ctx, g, opts.onFav));
  /* after a hide, a queue change or similar: the page repaints, or the card just goes */
  const changed = () => { if (typeof opts.onChange === 'function') opts.onChange(); else card.remove(); };
  go.oncontextmenu = e => cardMenu(ctx, g, e, changed);
  card.appendChild(hideButton(ctx, g, changed));
  return card;
}

/** A small "not interested" cross, shown on hover and focus like the heart. */
function hideButton(ctx, g, changed) {
  const { api } = ctx;
  return api.h('button.ag-card__hide.tip', {
    type: 'button', 'aria-label': `Not interested in ${g.title}`, 'data-tip': 'Not interested',
    onclick: e => { e.preventDefault(); e.stopPropagation(); notInterested(ctx, g, changed); },
  }, api.icon('eye-off'));
}

/** Hide a game for this person, with an Undo while the toast is up. */
function notInterested(ctx, g, changed, why = 'skip') {
  const { api } = ctx;
  hideGame(api, g.id, why);
  api.notify({
    app: BRAND.name, icon: 'eye-off', timeout: 7000,
    title: why === 'broken' ? `Reported, and hidden: ${g.title}` : `Hidden: ${g.title}`,
    message: why === 'broken'
      ? 'Hidden for you on this device. The report is not sent to anyone. Bring it back from Hidden games in Browse all.'
      : 'It stays out of your lists. You can bring it back from Hidden games in Browse all.',
    actions: [{ label: 'Undo', onClick: () => { unhideGame(api, g.id); if (typeof changed === 'function') changed(); } }],
  });
  if (typeof changed === 'function') changed();
}

function favButton(ctx, g, onFav) {
  const { api } = ctx;
  const { h, icon } = api;
  const btn = h('button.ag-card__fav', { type: 'button' });
  const paint = on => {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? `Remove ${g.title} from favourites` : `Add ${g.title} to favourites`);
    btn.setAttribute('data-tip', on ? 'Remove from favourites' : 'Add to favourites');
    api.render(btn, icon('heart', { fill: on }));
  };
  paint(isFav(api, g.id));
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    paint(toggleFav(api, g.id));
    if (typeof onFav === 'function') onFav();
  });
  btn.classList.add('tip');
  return btn;
}

function cardMenu(ctx, g, e, changed) {
  e.preventDefault();
  e.stopPropagation();
  const { api } = ctx;
  const link = urlFor(g.id);
  const fav = isFav(api, g.id);
  const queued = inQueue(api, g.id);
  api.menu([
    { label: 'Play', icon: 'play', onClick: () => ctx.navigate(link) },
    { label: fav ? 'Remove from favourites' : 'Add to favourites', icon: 'heart',
      onClick: () => toggleFav(api, g.id) },
    { label: queued ? 'Remove from play queue' : 'Add to play queue', icon: 'list',
      onClick: () => { toggleQueue(api, g.id); if (typeof changed === 'function' && queued) changed(); } },
    '-',
    { label: 'Copy link', icon: 'copy', hint: link, onClick: () => copyLink(ctx, link) },
    { label: 'Add to Desktop', icon: 'monitor', onClick: () => addToDesktop(ctx, g) },
    { label: 'Add to collection…', icon: 'bookmark',
      onClick: () => {
        /* a menu opened from the keyboard (Menu key, Shift+F10) has no pointer
           position: hang the collection picker off the card instead of 0,0 */
        const r = e.target && e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : null;
        const x = e.clientX || (r ? r.left + 12 : 0), y = e.clientY || (r ? r.top + 12 : 0);
        import('../core/collections.js')
          .then(C => C.pickMenu(api, { kind: 'web', id: g.id, title: g.title, art: g.art || null }, x, y))
          .catch(() => api.notify({ app: BRAND.name, icon: 'alert', title: 'Collections could not load',
            message: 'Reload StaticOS and try again.' }));
      } },
    '-',
    { label: 'Not interested', icon: 'eye-off', onClick: () => notInterested(ctx, g, changed) },
  ], e.clientX, e.clientY);
}

async function copyLink(ctx, link) {
  const { api } = ctx;
  let ok = false;
  try {
    await navigator.clipboard.writeText(link);
    ok = true;
  } catch (err) { ok = false; }
  api.notify({
    app: BRAND.name, icon: ok ? 'copy' : 'alert',
    title: ok ? 'Link copied' : 'Clipboard refused',
    message: ok ? link : `Copy it by hand: ${link}`,
  });
}

function addToDesktop(ctx, g) {
  const { api } = ctx;
  /* A real launcher, not a note: the desktop renders .staticgame files (and
     older .aethergame ones) with the game's own title card and opens them
     straight into the play stage. */
  const oldPath = `${api.vfs.HOME}/Desktop/${safeName(g.title)}.aethergame`;
  const path = api.vfs.node(oldPath) ? oldPath : `${api.vfs.HOME}/Desktop/${safeName(g.title)}.staticgame`;
  const already = !!api.vfs.node(path);
  const body = JSON.stringify({
    id: g.id, title: g.title, art: g.art || null, open: g.open,
    studio: g.studio, rating: g.hasStats ? g.rating : null, plays: g.hasStats ? g.plays : null,
    url: `static://games/${g.id}`,
  }, null, 2);

  const node = already ? api.vfs.node(path) : api.vfs.touch(path, body);
  if (!node) {
    api.notify({ app: BRAND.name, icon: 'alert', title: 'Could not write the shortcut',
      message: 'There is no Desktop folder to write into.' });
    return;
  }
  api.notify({
    app: BRAND.name, icon: already ? 'check' : 'monitor',
    title: already ? 'Already on your Desktop' : 'Added to Desktop',
    message: path.split('/').pop(),
    actions: [{ label: 'Show', onClick: () => api.openApp('files', { path: `${api.vfs.HOME}/Desktop` }) }],
  });
}

/* ------------------------------------------------------------------ *
 *  a horizontal shelf
 * ------------------------------------------------------------------ */
/**
 * spec = {key, title, icon, sub, count, get(), seeAll}
 * `get()` is only called once the shelf is near the viewport, so a home screen
 * with a dozen shelves still only builds the two or three you can see.
 */
function shelf(ctx, watch, spec) {
  const { api } = ctx;
  const { h, icon } = api;

  const rail = h('div.cx__grid--rail.ag-rail', { 'aria-label': spec.title });
  api.render(rail, ...Array.from({ length: 6 }, () => skelCard(h)));

  const prev = h('button.ibtn.ag-rail__nav', {
    type: 'button', 'aria-label': `Scroll ${spec.title} left`, onclick: () => nudge(-1),
  }, icon('chevron-left'));
  const next = h('button.ibtn.ag-rail__nav', {
    type: 'button', 'aria-label': `Scroll ${spec.title} right`, onclick: () => nudge(1),
  }, icon('chevron-right'));

  function nudge(dir) {
    const step = Math.max(200, Math.round(rail.clientWidth * 0.82));
    rail.scrollBy({ left: dir * step, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  function syncNav() {
    const max = rail.scrollWidth - rail.clientWidth - 2;
    prev.disabled = rail.scrollLeft <= 2;
    next.disabled = rail.scrollLeft >= max;
    const hide = max <= 0;
    prev.classList.toggle('hidden', hide);
    next.classList.toggle('hidden', hide);
  }
  rail.addEventListener('scroll', syncNav, { passive: true });

  const countEl = h('div.cx__sec-n', { text: '' });
  const head = h('div.cx__sec-h',
    icon(spec.icon || 'gamepad'),
    h('div.cx__sec-t', { text: spec.title }),
    countEl,
    spec.sub ? h('div.ag-shelf__sub', { text: spec.sub }) : null,
    h('div.grow'),
    spec.seeAll
      ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: spec.seeAll.onClick },
          h('span', { text: spec.seeAll.label }), icon('chevron-right'))
      : null,
    prev, next);

  const sec = h('section.cx__sec.ag-shelf', head, rail);

  watch(sec, () => {
    let items = [];
    try { items = spec.get() || []; } catch (err) { items = []; }
    if (!items.length) { sec.remove(); return; }
    countEl.textContent = spec.count ? spec.count(items) : num(items.length);
    api.render(rail, ...items.map(g => gameCard(ctx, g, spec.card ? spec.card(g) : {})));
    requestAnimationFrame(syncNav);
  });

  return sec;
}

/* ================================================================== *
 *  static://games — home and browse
 * ================================================================== */
export function buildGames(ctx) {
  const { api, providers, navigate, win } = ctx;
  const { h, icon, fmt } = api;

  const root = h('div.cx.ag');
  const life = lifecycle(root);
  const watch = nearWatcher(root, life);
  /* held so the sticky filter bar can be offset below it (see watchStuck) */
  const strip = topStrip(ctx, 'games');
  root.appendChild(strip);

  const tabsHold = h('div.ag-tabs__hold');
  const body = h('div.ag-body');
  root.append(tabsHold, body);

  /* ---- state ---------------------------------------------------- */
  const p = paramsOf(ctx.url);
  const S = {
    view: p.view === 'browse' ? 'browse' : 'home',
    cat: p.cat || 'all',
    q: p.q || '',
    sort: p.sort || 'popular',
    source: p.src || '',
    page: Math.max(1, parseInt(p.page, 10) || 1),
    shelf: '',                 // 'favs' | 'recent' | 'queue' | 'most' | 'hidden' when browsing a personal list
    tags: (p.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 6),
    two: p.two === '1',        // only games that say they are two-player
    fresh: false,              // only games not launched on this device yet
    fit: false,                // only games whose own size fits this window
  };
  if (p.q || p.cat || p.src || p.tags || p.two) S.view = 'browse';

  /* The detail page hands a category over through the store, because
     the games route matches no query string. One-shot: read it, drop it. */
  const handoff = api.store.get('portal.gamesCat', '');
  if (handoff) {
    api.store.set('portal.gamesCat', '');
    S.cat = handoff;
    S.view = 'browse';
  }

  const E = {};

  /* ---- the Home / Browse switch --------------------------------- */
  function buildTabs() {
    const mk = (id, label, ic) => h(S.view === id ? 'button.ag-tab.is-on' : 'button.ag-tab', {
      type: 'button', dataset: { view: id }, 'aria-selected': String(S.view === id), role: 'tab',
      onclick: () => setView(id),
    }, icon(ic), h('span', { text: label }));

    E.tabs = h('div.ag-tabs', { role: 'tablist', 'aria-label': 'Games views' },
      mk('home', 'Home', 'sparkles'),
      mk('browse', 'Browse all', 'grid-9'),
      h('div.grow'),
      E.libNote = h('div.ag-tabs__note', { text: '' }),
      h('button.btn.btn--sm', { type: 'button', onclick: surprise }, icon('shuffle'), 'Surprise me'));
    api.render(tabsHold, E.tabs);
  }

  function setView(id, opts = {}) {
    if (S.view === id && !opts.force) return;
    S.view = id;
    if (id === 'home') S.shelf = '';
    for (const b of E.tabs.querySelectorAll('.ag-tab')) {
      const on = b.dataset.view === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    }
    paint();
    scrollUp();
  }

  function scrollUp() {
    const sc = scrollParent(root);
    if (sc && sc !== document.documentElement) sc.scrollTop = 0;
    else window.scrollTo?.({ top: 0 });
  }

  /* ---- boot ------------------------------------------------------ */
  buildTabs();
  api.render(body, h('div.cx__sec', skelGrid(h, 12)));

  async function boot() {
    let partial = null;
    try {
      partial = await loadCatalogue(providers);
    } catch (err) {
      if (life.dead) return;
      api.render(body, downBlock(ctx, err, boot));
      return;
    }
    if (life.dead) return;
    const st = catalogue.stats();
    E.libNote.textContent = partial
      ? `${plural(st.total, 'game')} · catalogue file unavailable, showing the curated shelf`
      : `${plural(st.total, 'game')} · ${st.categories} categories`;
    claimSubtitle(ctx, life, `${num(st.total)} games, free to play`);
    paint();
  }

  function paint() {
    if (S.view === 'browse') paintBrowse();
    else paintHome();
  }

  /* Surprise me follows what Browse all is showing: its category, host, tags
     and chips. From Home, or on a personal list, it picks from everything
     that is not hidden. */
  function surprise() {
    if (!catalogue.isLoaded()) return;
    const narrowed = S.view === 'browse' && !S.shelf && (S.cat !== 'all' || S.source || S.tags.length || S.two || S.fresh || S.fit);
    const rows = narrowed
      ? catalogue.query({ ...filterOpts(), perPage: 1e6 }).items
      : catalogue.query({ exclude: without(api), perPage: 1e6 }).items;
    if (!rows.length) {
      api.notify({ app: BRAND.name, icon: 'shuffle', title: 'Nothing to pick from',
        message: 'No game matches the filters you have on. Reset them to be surprised.' });
      return;
    }
    navigate(urlFor(rows[Math.floor(Math.random() * rows.length)].id));
  }

  /* the part of a query every Browse view shares: filters, chips and hidden games */
  function filterOpts() {
    const skip = S.fresh ? new Set([...Object.keys(launchLog(api)), ...recentRows(api).map(r => r.id)]) : null;
    return {
      category: S.cat, source: S.source, tags: S.tags, twoPlayer: S.two,
      fit: S.fit ? fitBox() : null, exclude: without(api, skip),
    };
  }

  /* The room a game gets in this window: the stage is the window's visible
     area, less its frame. Games state their own size; this is the box that
     size is compared with. */
  function fitBox() {
    const sc = scrollParent(root);
    return { w: Math.max(320, (sc ? sc.clientWidth : 900) - 40), h: Math.max(240, (sc ? sc.clientHeight : 600) - 70) };
  }

  /* ================================================================ *
   *  HOME
   * ================================================================ */
  function paintHome() {
    api.clear(body);

    const heroPool = catalogue.query({ category: 'featured', sort: 'popular', perPage: 8, exclude: without(api) }).items;
    const hero = heroPool.length ? heroPool : catalogue.query({ sort: 'popular', perPage: 8, exclude: without(api) }).items;
    if (hero.length) body.appendChild(heroBlock(hero));

    for (const spec of homeShelves()) body.appendChild(shelf(ctx, watch, spec));
    body.appendChild(h('div.ag-foot', {},
      h('span', { text: `${plural(catalogue.stats().total, 'game')} in the catalogue.` }),
      h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => setView('browse') },
        icon('grid-9'), 'Browse everything')));
  }

  /* The hero rotates through the curated shelf on a slow timer; the dots let
     you drive it yourself, and any interaction stops the timer for good. */
  function heroBlock(pool) {
    let i = 0;
    let timer = 0;
    const artBox = h('div.cx__hero-art', { 'aria-hidden': 'true' });
    const kick = h('div.cx__hero-kick', { text: 'FEATURED' });
    const title = h('h2.cx__hero-t');
    const sub = h('div.cx__hero-s');
    const meta = h('div.cx__hero-meta');
    const playBtn = h('button.btn.btn--primary', { type: 'button' }, icon('play', { fill: true }), 'Play now');
    const favBtn = h('button.btn', { type: 'button' });
    const dots = h('div.ag-hero__dots', { role: 'tablist', 'aria-label': 'Featured games' });

    const show = n => {
      i = (n + pool.length) % pool.length;
      const g = pool[i];
      api.clear(artBox);
      artBox.style.setProperty('--art', providers.artFor(g.title, 'game'));
      if (g.art) artBox.appendChild(coverImg(api, g.art, true));

      title.textContent = g.title;
      const tags = listOf(g.tags).join(' · ');
      sub.textContent = g.desc
        ? g.desc.slice(0, 190) + (g.desc.length > 190 ? '…' : '')
        : `${tags ? `${tags} · ` : ''}hosted by ${g.studio}. ${catalogue.opensOnTheirSite(g)
          ? t('Opens on {studio}, in a new tab.', { studio: g.studio })
          : 'Plays right here in the page — nothing to download.'}`;

      api.clear(meta);
      if (g.hasStats) {
        meta.append(
          h('span.chip', icon('activity'), h('span', { text: `${playsText(providers, g.plays)} plays` })),
          h('span.chip', icon('star', { fill: true }), h('span', { text: `${rateText(g.rating)} / 5` })));
      }
      for (const id of listOf(g.cats)) {
        const c = catalogue.catMeta(id);
        meta.appendChild(h('span.chip', icon(c.icon), h('span', { text: c.name })));
      }
      if (g.note) meta.appendChild(h('span.chip.chip--accent', icon('heart'), h('span', { text: g.note })));

      playBtn.onclick = () => navigate(urlFor(g.id));
      playBtn.setAttribute('aria-label', `Play ${g.title}`);
      paintFav(g);
      for (const d of dots.children) {
        const on = Number(d.dataset.i) === i;
        d.classList.toggle('is-on', on);
        d.setAttribute('aria-selected', String(on));
      }
    };

    const paintFav = g => {
      const on = isFav(api, g.id);
      favBtn.classList.toggle('is-on', on);
      favBtn.setAttribute('aria-pressed', String(on));
      api.render(favBtn, icon('heart', { fill: on }), h('span', { text: on ? 'In favourites' : 'Favourite' }));
      favBtn.onclick = () => { toggleFav(api, g.id); paintFav(g); };
    };

    const stop = () => { if (timer) { clearInterval(timer); timer = 0; } };
    life.add(stop);

    for (let n = 0; n < pool.length; n++) {
      dots.appendChild(h('button.ag-hero__dot', {
        type: 'button', role: 'tab', dataset: { i: String(n) },
        'aria-label': `Featured: ${pool[n].title}`,
        onclick: () => { stop(); show(n); },
      }));
    }

    show(0);
    if (pool.length > 1 && !reduceMotion()) {
      timer = setInterval(() => { if (life.dead) { stop(); return; } show(i + 1); }, 9000);
    }

    return h('section.cx__hero.ag-hero', artBox,
      h('div.cx__hero-in', kick, title, sub, meta,
        h('div.cx__hero-acts', playBtn, favBtn)),
      pool.length > 1 ? dots : null);
  }

  function homeShelves() {
    const out = [];
    const hid = without(api);
    const featured = catalogue.query({ category: 'featured', sort: 'popular', perPage: ROW_N, exclude: hid }).items;
    const featuredIds = new Set(featured.map(g => g.id));

    const queue = queueIds(api);
    if (queue.length) {
      out.push({
        key: 'queue', icon: 'list', title: 'Play queue',
        sub: 'your next games, in order',
        get: () => shown(api, catalogue.byIds(queue.slice(0, ROW_N))),
        seeAll: queue.length > ROW_N ? { label: 'See all', onClick: () => openShelf('queue') } : null,
      });
    }

    /* counted from launches on THIS device, and it says so */
    const most = mostPlayed(api, ROW_N);
    if (most.length) {
      const counts = new Map(most);
      out.push({
        key: 'most', icon: 'activity', title: 'Your most played',
        sub: 'launches on this device',
        get: () => shown(api, catalogue.byIds(most.map(([id]) => id))),
        card: g => ({ launches: counts.get(g.id) }),
        seeAll: { label: 'See all', onClick: () => openShelf('most') },
      });
    }

    const trend = trendingIds(api, ROW_N);
    if (trend.length >= 3) {
      out.push({
        key: 'trending', icon: 'trending-up', title: 'Trending',
        sub: 'most played on this device this week',
        get: () => shown(api, catalogue.byIds(trend)),
      });
    }

    const recent = recentRows(api);
    if (recent.length) {
      out.push({
        key: 'recent', icon: 'clock', title: 'Recently played',
        get: () => shown(api, catalogue.byIds(recent.slice(0, ROW_N).map(r => r.id))),
        seeAll: recent.length > ROW_N
          ? { label: 'See all', onClick: () => openShelf('recent') } : null,
      });
    }

    const favs = favIds(api);
    if (favs.length) {
      out.push({
        key: 'favs', icon: 'heart', title: 'Favourites',
        get: () => shown(api, catalogue.byIds(favs.slice(0, ROW_N))),
        seeAll: favs.length > ROW_N ? { label: 'See all', onClick: () => openShelf('favs') } : null,
      });
    }

    if (featured.length) {
      out.push({
        key: 'featured', icon: 'sparkles', title: 'Featured',
        sub: 'hand-picked, kept working',
        get: () => featured,
        seeAll: { label: 'See all', onClick: () => openBrowse({ cat: 'featured' }) },
      });
    }

    /* "Picked for you" is derived from what this device actually played — no
       history, no shelf. Nothing here is a guess about anyone else. */
    const seed = catalogue.byIds(recent.slice(0, 1).map(r => r.id))[0];
    if (seed) {
      const skip = new Set([seed.id, ...recent.map(r => r.id)]);
      const picks = shown(api, catalogue.related(seed, ROW_N + 30)).filter(g => !skip.has(g.id)).slice(0, ROW_N);
      if (picks.length >= 6) {
        out.push({
          key: 'foryou', icon: 'compass', title: `Because you played ${seed.title}`,
          get: () => picks,
        });
      }
    }

    out.push({
      key: 'popular', icon: 'flame', title: 'Popular',
      sub: 'highest play counts reported by the game hosts',
      get: () => catalogue.query({ sort: 'popular', statsOnly: true, perPage: ROW_N, exclude: without(api, featuredIds) }).items,
      seeAll: { label: 'See all', onClick: () => openBrowse({ sort: 'popular' }) },
    });

    out.push({
      key: 'rated', icon: 'star', title: 'Top rated',
      sub: 'from the hosts that publish a rating',
      get: () => catalogue.query({ sort: 'rating', statsOnly: true, perPage: ROW_N, exclude: without(api, featuredIds) }).items,
      seeAll: { label: 'See all', onClick: () => openBrowse({ sort: 'rating' }) },
    });

    /* No row in data/games.json carries a date today, so this shelf simply is
       not built. The moment the sync stamps `added`, it appears. */
    if (catalogue.hasAdded()) {
      out.push({
        key: 'new', icon: 'plus-circle', title: 'Recently added',
        get: () => catalogue.query({ sort: 'newest', perPage: ROW_N, exclude: hid }).items,
        seeAll: { label: 'See all', onClick: () => openBrowse({ sort: 'newest' }) },
      });
    }

    for (const c of catalogue.categories().slice(0, ROW_CATS)) {
      out.push({
        key: `cat-${c.id}`, icon: c.icon, title: c.name,
        count: () => `${num(c.count)} in the catalogue`,
        get: () => catalogue.query({ category: c.id, sort: 'popular', perPage: ROW_N, exclude: hid }).items,
        seeAll: { label: 'See all', onClick: () => openBrowse({ cat: c.id }) },
      });
    }

    return out;
  }

  function openBrowse(next = {}) {
    S.shelf = '';
    if (next.cat !== undefined) S.cat = next.cat;
    if (next.sort !== undefined) S.sort = next.sort;
    if (next.q !== undefined) S.q = next.q;
    S.page = 1;
    setView('browse', { force: true });
  }

  function openShelf(which) {
    S.shelf = which;
    S.page = 1;
    setView('browse', { force: true });
  }

  /* ================================================================ *
   *  BROWSE
   * ================================================================ */
  function buildBrowseShell() {
    api.clear(body);

    E.sentinel = h('div', { style: { height: '1px' }, 'aria-hidden': 'true' });

    E.cats = h('div.cx__cats', { role: 'group', 'aria-label': 'Game categories' });
    const chips = [
      { id: 'all', name: 'All', icon: 'grid-9', count: catalogue.stats().total },
      { id: 'featured', name: 'Featured', icon: 'sparkles', count: catalogue.counts().get('featured') || 0 },
      ...catalogue.categories(),
    ];
    for (const c of chips) {
      if (!c.count) continue;
      E.cats.appendChild(h(c.id === S.cat ? 'button.cx-cat.is-on' : 'button.cx-cat', {
        type: 'button', dataset: { cat: c.id }, 'aria-pressed': String(c.id === S.cat),
        onclick: () => setCat(c.id),
      }, icon(c.icon), h('span', { text: c.name }), h('u.ag-cat__n', { text: num(c.count) })));
    }

    E.filterIn = h('input', {
      type: 'search', placeholder: `Search ${num(catalogue.stats().total)} games\u2026`,
      spellcheck: 'false', 'aria-label': 'Search games', value: S.q, oninput: onFilter,
    });
    E.filterX = h('button.ibtn.hidden', {
      type: 'button', 'aria-label': 'Clear search',
      style: { minWidth: '16px', height: '16px', padding: '0' },
      onclick: () => clearFilter(true),
    }, icon('x', { size: 11 }));
    E.filter = h('div.field.ag-find', icon('search'), E.filterIn, E.filterX);

    E.source = h('select.select', {
      'aria-label': 'Filter by host',
      onchange: e => { S.source = e.target.value; S.page = 1; paintGrid(); },
    }, h('option', { value: '', text: 'All hosts' }),
      catalogue.stats().sources.map(([id, n]) =>
        h('option', { value: id, text: `${id} (${num(n)})` })));
    E.source.value = S.source;

    /* "Most played" and "Top rated" rank by measured numbers; until some game has
       them every order would just be alphabetical, so the two are not offered. */
    const measured = catalogue.stats().withStats > 0;
    const sortOpts = [
      ...(measured ? [['popular', 'Most played'], ['rating', 'Top rated']] : []),
      ['az', 'A – Z'],
      ['za', 'Z – A'],
    ];
    if (catalogue.hasAdded()) sortOpts.splice(measured ? 2 : 0, 0, ['newest', 'Recently added']);
    E.sort = h('select.select', {
      'aria-label': 'Sort games',
      onchange: e => { S.sort = e.target.value; S.page = 1; paintGrid(); },
    }, sortOpts.map(([v, t]) => h('option', { value: v, text: t })));
    E.sort.value = sortOpts.some(o => o[0] === S.sort) ? S.sort : sortOpts[0][0];
    S.sort = E.sort.value;

    E.more = h('div.ag-bar__more', { role: 'group', 'aria-label': 'More filters' });
    E.tagPanel = h('div.ag-tagpanel.hidden', { role: 'group', 'aria-label': 'Pick tags' });
    E.bar = h('div.cx__bar.ag-bar', E.cats, h('div.ag-bar__tools', E.filter, E.source, E.sort), E.more, E.tagPanel);
    paintChips();

    E.secT = h('div.cx__sec-t');
    E.secN = h('div.cx__sec-n', { text: 'loading…' });
    E.secX = h('button.btn.btn--ghost.btn--sm.hidden', {
      type: 'button', onclick: () => resetFilters(),
    }, icon('x'), 'Reset filters');
    E.hold = h('div');
    const sec = h('section.cx__sec',
      h('div.cx__sec-h', icon('gamepad'), E.secT, E.secN, h('div.grow'), E.secX),
      E.hold);

    body.append(E.sentinel, E.bar, sec, h('div', { style: { height: 'var(--sp-7)' } }));
    life.add(watchStuck(E.bar, E.sentinel, strip));
  }

  /* ---- the extra filters: chips, several tags, and the personal lists ---- */
  const toggleChip = (key, label, ic, title) => {
    const on = !!S[key];
    return h(on ? 'button.chip.ag-flt.is-on' : 'button.chip.ag-flt', {
      type: 'button', 'aria-pressed': String(on), dataset: { flt: key }, title,
      onclick: () => {
        S[key] = !S[key];
        if (S.shelf === 'hidden') S.shelf = '';
        S.page = 1;
        paintChips(); syncChrome(); paintGrid();
      },
    }, icon(ic, { size: 12 }), h('span', { text: label }));
  };

  function paintChips() {
    if (!E.more) return;
    const nQ = queueIds(api).length, nH = hiddenRows(api).length;
    const box = fitBox();
    api.clear(E.more);
    E.more.append(...[
      toggleChip('two', '2 player', 'users', 'Only games that say they are for two players'),
      toggleChip('fresh', 'Not played yet', 'sparkles', 'Hides games you have launched on this device'),
      toggleChip('fit', 'Fits my window', 'expand',
        `Only games whose own size is at most ${box.w} × ${box.h}. Games that state no size are left out.`),
      h(S.tags.length || !E.tagPanel.classList.contains('hidden') ? 'button.chip.ag-flt.is-on' : 'button.chip.ag-flt', {
        type: 'button', dataset: { flt: 'tags' }, 'aria-expanded': String(!E.tagPanel.classList.contains('hidden')),
        onclick: () => { E.tagPanel.classList.toggle('hidden'); if (!E.tagPanel.classList.contains('hidden')) paintTagPanel(); paintChips(); },
      }, icon('tag', { size: 12 }), h('span', { text: S.tags.length ? `Tags (${S.tags.length})` : 'Tags' })),
      ...S.tags.map(t => h('button.chip.ag-flt.is-on.ag-flt--tag', {
        type: 'button', dataset: { tag: t }, 'aria-label': `Remove the tag ${t}`,
        onclick: () => { S.tags = S.tags.filter(x => x !== t); S.page = 1; paintChips(); paintTagPanel(); syncChrome(); paintGrid(); },
      }, h('span', { text: t }), icon('x', { size: 10 }))),
      h('div.grow'),
      nQ ? h('button.chip.ag-flt', { type: 'button', dataset: { flt: 'queue' }, onclick: () => openShelf('queue') },
        icon('list', { size: 12 }), h('span', { text: `Play queue (${nQ})` })) : null,
      nH ? h('button.chip.ag-flt', { type: 'button', dataset: { flt: 'hidden' }, onclick: () => openShelf('hidden') },
        icon('eye-off', { size: 12 }), h('span', { text: `Hidden games (${nH})` })) : null].filter(Boolean));
  }

  /* Tags are whatever the hosts attach to a game; the panel lists the ones
     people search by, with how many games carry each, and a box to find the rest. */
  function paintTagPanel() {
    if (!E.tagPanel || E.tagPanel.classList.contains('hidden')) return;
    const find = E.tagFind || (E.tagFind = h('input', {
      type: 'search', placeholder: 'Find a tag…', spellcheck: 'false', 'aria-label': 'Find a tag',
      oninput: () => paintTagPanel(),
    }));
    const low = find.value.trim().toLowerCase();
    const list = catalogue.tagCounts().filter(t => !low || t.tag.includes(low)).slice(0, 48);
    const grid = h('div.ag-tagpanel__list');
    for (const t of list) {
      const on = S.tags.includes(t.tag);
      grid.appendChild(h(on ? 'button.chip.is-on' : 'button.chip', {
        type: 'button', 'aria-pressed': String(on), dataset: { tag: t.tag },
        onclick: () => {
          S.tags = on ? S.tags.filter(x => x !== t.tag) : [...S.tags, t.tag].slice(-6);
          S.page = 1;
          if (S.shelf === 'hidden') S.shelf = '';
          paintChips(); paintTagPanel(); syncChrome(); paintGrid();
        },
      }, h('span', { text: t.tag }), h('u.ag-cat__n', { text: num(t.n) })));
    }
    if (!list.length) grid.appendChild(h('small.dim', { text: `No tag contains “${low}”.` }));
    api.render(E.tagPanel,
      h('div.ag-tagpanel__top', find, h('small.dim', { text: S.tags.length > 1 ? 'A game has to carry every tag you pick.' : 'Pick several: a game has to carry every one.' })),
      grid);
  }

  function headline() {
    if (S.shelf === 'favs') return 'Your favourites';
    if (S.shelf === 'queue') return 'Play queue';
    if (S.shelf === 'most') return 'Your most played';
    if (S.shelf === 'hidden') return 'Hidden games';
    if (S.shelf === 'recent') return 'Recently played';
    if (S.q) return `Matches for “${S.q}”`;
    if (S.cat === 'featured') return 'Featured games';
    if (S.cat === 'all') return 'All games';
    return `${catalogue.catMeta(S.cat).name} games`;
  }

  const filtered = () => !!(S.q || S.source || S.cat !== 'all' || S.tags.length || S.two || S.fresh || S.fit);

  function syncChrome() {
    if (E.filterX) E.filterX.classList.toggle('hidden', !S.q);
    if (E.secX) E.secX.classList.toggle('hidden', !filtered());
    if (E.secT) E.secT.textContent = headline();
  }

  function setCat(id) {
    S.page = 1;
    S.shelf = '';
    if (S.cat === id) return;
    S.cat = id;
    for (const b of E.cats.children) {
      const on = b.dataset.cat === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    syncChrome();
    paintGrid();
  }

  function clearFilter(focusIt) {
    S.q = '';
    S.page = 1;
    if (E.filterIn) {
      E.filterIn.value = '';
      if (focusIt) E.filterIn.focus();
    }
    syncChrome();
    paintGrid();
  }

  function resetFilters() {
    S.q = '';
    S.cat = 'all';
    S.source = '';
    S.tags = [];
    S.two = S.fresh = S.fit = false;
    S.page = 1;
    S.shelf = '';
    paintBrowse();
  }

  const runFilter = fmt.debounce(() => paintGrid(), 180);
  function onFilter(e) {
    S.q = e.target.value.trim();
    S.page = 1;
    syncChrome();
    runFilter();
  }

  function paintBrowse() {
    buildBrowseShell();
    syncChrome();
    api.render(E.hold, skelGrid(h, 18));
    /* One frame of real skeleton before the (synchronous) filter runs, so a
       slow machine shows the shimmer instead of freezing on a blank grid. */
    requestAnimationFrame(() => { if (!life.dead) paintGrid(); });
  }

  /* Personal lists keep their own order (the caller knows it); the chips, the
     search box and the hidden games still apply to them. */
  function listQuery(ids) {
    return catalogue.query({ ...filterOpts(), category: 'all', source: '', ids, q: S.q, page: S.page, perPage: PER_PAGE });
  }

  function currentQuery() {
    if (S.shelf === 'favs') return listQuery(favIds(api));
    if (S.shelf === 'recent') return listQuery(recentRows(api).map(r => r.id));
    if (S.shelf === 'queue') return listQuery(queueIds(api));
    if (S.shelf === 'most') return listQuery(mostPlayed(api, 200).map(([id]) => id));
    return catalogue.query({
      ...filterOpts(), q: S.q, sort: S.sort, page: S.page, perPage: PER_PAGE,
    });
  }

  /** The Hidden games list: each one with the reason, and a way back. */
  function paintHidden() {
    const rows = hiddenRows(api);
    E.secN.textContent = plural(rows.length, 'game');
    if (!rows.length) {
      api.render(E.hold, emptyBlock(api, {
        iconName: 'eye-off', title: 'Nothing is hidden',
        detail: 'Use the cross on a card, or “Not interested” in its menu, to keep a game out of your lists.',
        actions: [h('button.btn', { type: 'button', onclick: () => { S.shelf = ''; paintGrid(); } }, icon('grid-9', { size: 14 }), 'Back to all games')],
      }));
      paintChips();
      return;
    }
    const list = h('div.ag-hidden', { role: 'list', 'aria-label': 'Hidden games' });
    for (const r of rows) {
      const g = catalogue.byId(r.id);
      list.appendChild(h('div.ag-hidden__row', { role: 'listitem', dataset: { id: r.id } },
        h('div.ag-hidden__t',
          h('b', { text: g ? g.title : r.id }),
          h('small.dim', { text: `${r.why === 'broken' ? 'You reported it as not loading' : 'Not interested'} · ${new Date(r.at).toLocaleDateString()}` })),
        g ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => navigate(urlFor(g.id)) }, 'Open') : null,
        h('button.btn.btn--sm', {
          type: 'button', 'aria-label': `Bring back ${g ? g.title : r.id}`,
          onclick: () => { unhideGame(api, r.id); paintChips(); paintGrid(); },
        }, icon('undo', { size: 13 }), 'Bring back')));
    }
    api.render(E.hold, h('div.ag-hidden__intro', { text: 'These stay out of every shelf, search and pick. They are kept on this device only.' }), list,
      h('div.ag-hidden__foot', h('button.btn.btn--ghost.btn--sm', {
        type: 'button', onclick: () => { api.store.set(K_HIDDEN, []); paintChips(); paintGrid(); },
      }, icon('undo', { size: 13 }), 'Bring all back')));
  }

  function paintGrid() {
    syncChrome();
    if (S.shelf === 'hidden') { paintHidden(); return; }
    let res;
    try {
      res = currentQuery();
    } catch (err) {
      E.secN.textContent = 'unavailable';
      api.render(E.hold, downBlock(ctx, err, paintGrid));
      return;
    }

    const first = (res.page - 1) * res.perPage + 1;
    E.secN.textContent = res.total > res.items.length
      ? `${num(first)}–${num(first + res.items.length - 1)} of ${num(res.total)}`
      : plural(res.total, 'game');

    if (!res.items.length) { api.render(E.hold, browseEmpty()); return; }

    const counts = S.shelf === 'most' ? new Map(mostPlayed(api, 200)) : null;
    const grid = h('div.cx__grid');
    for (const g of res.items) {
      grid.appendChild(gameCard(ctx, g, {
        onFav: S.shelf === 'favs' ? () => paintGrid() : null,
        launches: counts ? counts.get(g.id) : 0,
        onChange: () => { paintChips(); paintGrid(); },
      }));
    }
    const pager = pagerRow(res.page, res.pages);
    const extra = S.shelf === 'queue'
      ? [h('div.ag-hidden__foot', h('button.btn.btn--ghost.btn--sm', {
          type: 'button', onclick: () => { api.store.set(K_QUEUE, []); paintChips(); paintGrid(); },
        }, icon('x', { size: 13 }), 'Clear the queue'))]
      : [];
    api.render(E.hold, grid, ...(pager ? [pager] : []), ...extra);
  }

  /** Empty states that name the exact combination that emptied the grid. */
  function browseEmpty() {
    const acts = [];
    if (S.shelf === 'favs') {
      return emptyBlock(api, {
        iconName: 'heart',
        title: S.q ? `No favourite matches “${S.q}”` : 'No favourites yet',
        detail: S.q
          ? 'Clear the search to see the rest of your favourites.'
          : 'The heart on any game card adds it here. Favourites are kept on this device.',
        actions: [S.q
          ? h('button.btn', { type: 'button', onclick: () => clearFilter(true) }, icon('x', { size: 14 }), 'Clear search')
          : h('button.btn', { type: 'button', onclick: () => setView('home') }, icon('sparkles', { size: 14 }), 'Back to home')],
      });
    }
    if (S.shelf === 'recent') {
      return emptyBlock(api, {
        iconName: 'clock',
        title: 'Nothing played yet',
        detail: 'Games you open show up here, newest first.',
        actions: [h('button.btn', { type: 'button', onclick: () => setView('home') },
          icon('sparkles', { size: 14 }), 'Back to home')],
      });
    }

    if (S.shelf === 'queue') {
      return emptyBlock(api, {
        iconName: 'list', title: S.q ? `Nothing in the queue matches “${S.q}”` : 'The play queue is empty',
        detail: 'Add a game with “Add to play queue” in its menu or on its page. When a game closes, the next one is offered.',
        actions: [h('button.btn', { type: 'button', onclick: () => setView('home') }, icon('sparkles', { size: 14 }), 'Back to home')],
      });
    }
    if (S.shelf === 'most') {
      return emptyBlock(api, {
        iconName: 'activity', title: 'No launches counted yet',
        detail: 'This list counts the games you start on this device, so it fills as you play.',
        actions: [h('button.btn', { type: 'button', onclick: () => setView('home') }, icon('sparkles', { size: 14 }), 'Back to home')],
      });
    }

    const bits = [];
    if (S.cat !== 'all') bits.push(`the ${catalogue.catMeta(S.cat).name} category`);
    if (S.source) bits.push(`host ${S.source}`);
    if (S.tags.length) bits.push(`the tag${S.tags.length > 1 ? 's' : ''} ${S.tags.join(' + ')}`);
    if (S.two) bits.push('2 player');
    if (S.fresh) bits.push('not played yet');
    if (S.fit) bits.push('fits my window');
    if (S.q) bits.push(`“${S.q}”`);

    if (S.q) acts.push(h('button.btn', { type: 'button', onclick: () => clearFilter(true) },
      icon('x', { size: 14 }), 'Clear search'));
    if (S.cat !== 'all') acts.push(h('button.btn', { type: 'button', onclick: () => setCat('all') },
      icon('grid-9', { size: 14 }), 'All categories'));
    if (S.source) acts.push(h('button.btn', {
      type: 'button',
      onclick: () => { S.source = ''; E.source.value = ''; S.page = 1; paintGrid(); },
    }, icon('globe', { size: 14 }), 'All hosts'));
    if (S.tags.length || S.two || S.fresh || S.fit) acts.push(h('button.btn', {
      type: 'button',
      onclick: () => { S.tags = []; S.two = S.fresh = S.fit = false; S.page = 1; paintChips(); paintGrid(); },
    }, icon('x', { size: 14 }), 'Clear chips and tags'));
    if (acts.length > 1) acts.push(h('button.btn.btn--primary', { type: 'button', onclick: resetFilters },
      icon('refresh', { size: 14 }), 'Reset everything'));

    return emptyBlock(api, {
      iconName: S.q ? 'search' : 'gamepad',
      title: 'Nothing matches that combination',
      detail: `None of the ${plural(catalogue.stats().total, 'game')} on file match ${bits.join(' + ')}.`,
      actions: acts,
    });
  }

  /** Prev / windowed numbers / Next, matching the anime pager. */
  function pagerRow(page, pages) {
    if (pages < 2) return null;
    const go = n => {
      const next = Math.min(Math.max(1, n), pages);
      if (next === S.page) return;
      S.page = next;
      paintGrid();
      scrollUp();
    };
    const btn = (label, n, opts = {}) => h('button', {
      type: 'button', disabled: !!opts.disabled,
      class: opts.on ? 'is-on' : null,
      'aria-label': opts.label || `Page ${n}`,
      'aria-current': opts.on ? 'page' : null,
      onclick: () => go(n),
    }, label);

    const window7 = [];
    const from = Math.max(1, Math.min(page - 3, pages - 6));
    for (let i = from; i < from + 7 && i <= pages; i++) window7.push(i);

    return h('div.cx-pages', { role: 'navigation', 'aria-label': 'Pages' },
      btn('‹', page - 1, { disabled: page <= 1, label: 'Previous page' }),
      window7[0] > 1 ? btn('1', 1) : null,
      window7[0] > 2 ? h('span.dim', { text: '…' }) : null,
      ...window7.map(n => btn(String(n), n, { on: n === page })),
      window7[window7.length - 1] < pages - 1 ? h('span.dim', { text: '…' }) : null,
      window7[window7.length - 1] < pages ? btn(String(pages), pages) : null,
      btn('›', page + 1, { disabled: page >= pages, label: 'Next page' }));
  }

  /* ---- keyboard: "/" jumps to the search, Escape clears it ------- */
  life.add(api.on(window, 'keydown', e => {
    if (life.dead) return;
    if (win?.el && !win.el.classList.contains('is-active')) return;
    if (e.key === '/' && !typingIn(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (S.view !== 'browse') setView('browse');
      if (E.filterIn) { E.filterIn.focus(); E.filterIn.select(); }
    } else if (e.key === 'Escape' && S.view === 'browse' && (S.q || document.activeElement === E.filterIn)) {
      e.preventDefault();
      clearFilter(false);
      if (E.filterIn) E.filterIn.blur();
    }
  }));

  boot();
  return root;
}

/* ================================================================== *
 *  static://games/<id> — details, then the play stage
 * ================================================================== */
export function buildGameDetail(ctx) {
  const { api, providers, navigate, win, params } = ctx;
  const { h, icon } = api;

  const root = h('div.cx.ag');
  const life = lifecycle(root);
  const watch = nearWatcher(root, life);
  root.appendChild(topStrip(ctx, 'games'));

  const hold = h('div.ag-detail__hold');
  root.appendChild(hold);
  api.render(hold, h('div.cx__sec', h('div.cx-skel.cx-skel--art', { style: { aspectRatio: '21/9' } })));

  (async () => {
    let partial = null;
    try {
      partial = await loadCatalogue(providers);
    } catch (err) {
      if (life.dead) return;
      api.render(hold, downBlock(ctx, err, () => navigate(urlFor(params))));
      return;
    }
    if (life.dead) return;
    const game = catalogue.byId(params) || (providers.getGame ? providers.getGame(params) : null);
    if (!game) { api.render(hold, notFound()); return; }
    mount(game, partial);
  })();

  function notFound() {
    return emptyBlock(api, {
      iconName: 'gamepad',
      title: t("This game isn't in Static Games any more."),
      detail: t('Nothing is on file for “{id}”. It may have been renamed, or taken off the list.', { id: params || t('this address') }),
      actions: [h('button.btn', { type: 'button', onclick: () => navigate(LIB) },
        icon('chevron-left', { size: 14 }), 'Back to games')],
    });
  }

  /* ---------------------------------------------------------------- */
  function mount(game, partial) {
    claimSubtitle(ctx, life, game.studio);

    /* The game on this window's play stage, for Screen Time
       (js/core/screentime.js counts it in the Static Games window). */
    const notePlaying = on => {
      if (!win || !win.state) return;
      const was = win.state.playing;
      if (on) win.state.playing = { kind: 'web', id: game.id, title: game.title, icon: 'gamepad' };
      else if (was && was.id === game.id) win.state.playing = null;
      else return;
      api.bus.emit('win:playing', win);
    };
    life.add(() => notePlaying(false));

    /* ---- servers --------------------------------------------------
       Every network that publishes this game is a server. The one you
       picked last is the default for later games (portal.gameVia). */
    /* A few hosts (catalog.js OWN_SITE_HOSTS: Kodub, and MadKidGames, which blanks
       its games inside other pages) only run on their own site, so their copy is
       left out here rather than shown as a frame that fails. A game with no other
       copy opens on that site, in a new tab. */
    const theirsOnly = catalogue.theirSiteOnly;
    const theirLabel = catalogue.theirSiteLabel(game);
    const hosts = [{ source: game.source, embed: game.embed }, ...(game.alts || [])]
      .filter((x, i, arr) => x.embed && arr.findIndex(y => y.embed === x.embed) === i)
      .filter(x => !theirsOnly(x.embed));
    const external = !hosts.length && theirsOnly(game.embed) ? (game.open || game.embed) : null;
    const SERVERS = hosts.map(x => ({ url: x.embed, host: hostOf(x.embed), via: 'direct', primary: x.embed === game.embed }));
    SERVERS.forEach((x, i) => { x.n = i + 1; });
    /* an older build could save 'tunnel' here; that choice is gone, so it
       reads as the first server */
    if (api.store.get('portal.gameVia') === 'tunnel') api.store.set('portal.gameVia', 'direct');
    let cur = 0;
    const serverLabel = x => x.host;

    /* ---- frame bookkeeping -------------------------------------- */
    const F = { el: null, url: '', timer: 0, playing: false };
    const disarm = () => { clearTimeout(F.timer); F.timer = 0; };
    life.add(disarm);

    const stage = h('div.ag-stage');
    const detail = h('div.ag-detail');
    /* Poster beside the facts while browsing, poster full width while playing —
       one grid, so the swap is a class and never a re-render of the iframe. */
    const top = h('div.ag-detail__top', stage, detail);

    /* ---- the poster the stage shows before you press play -------- */
    const poster = h('div.ag-stage__poster', { style: { '--art': providers.artFor(game.title, 'game') } });
    if (game.art) poster.appendChild(coverImg(api, game.art, true));
    const bigPlay = external
      ? h('a.ag-stage__start', {
          href: external, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': t('Play {title} on {studio}, in a new tab', { title: game.title, studio: theirLabel }),
          onclick: () => { noteRecent(api, game.id); notePlay(api, game.id); plays.record({ kind: 'web', id: game.id, title: game.title, art: game.art, cats: game.cats }); },
        }, h('i', icon('external-link')), h('span', { text: t('Play on {studio}', { studio: theirLabel }) }))
      : h('button.ag-stage__start', {
          type: 'button', 'aria-label': `Play ${game.title}`, onclick: () => play(),
        }, h('i', icon('play', { fill: true })), h('span', { text: 'Play' }));
    if (external) poster.appendChild(h('small.ag-stage__note', {
      text: t('{studio} only lets {title} run on its own site, so it opens there in a new tab.', { studio: theirLabel, title: game.title }),
    }));
    poster.appendChild(bigPlay);

    /* ---- the stage control bar, only meaningful while playing ---- */
    const btnFull = h('button.ibtn.tip', {
      type: 'button', 'data-tip': 'Fullscreen', 'aria-label': 'Enter fullscreen',
      onclick: () => toggleFull(),
    }, icon('expand'));
    const btnReload = h('button.ibtn.tip', {
      type: 'button', 'data-tip': 'Restart the game', 'aria-label': 'Restart the game',
      onclick: () => play(),
    }, icon('refresh'));
    const btnReport = h('button.ibtn.tip', {
      type: 'button', 'data-tip': 'Won\u2019t load? Report and hide it', 'aria-label': 'Report that this game will not load, and hide it',
      onclick: () => reportBroken(),
    }, icon('alert'));
    const btnStop = h('button.btn.btn--ghost.btn--sm', {
      type: 'button', onclick: () => stopPlaying(),
    }, icon('chevron-left'), 'Back to details');

    const bar = h('div.ag-stage__bar.hidden',
      h('button.ibtn.tip', {
        type: 'button', 'data-tip': 'Back to games', 'aria-label': 'Back to games',
        onclick: () => navigate(LIB),
      }, icon('chevron-left')),
      h('div.ag-stage__t', { text: game.title }),
      h('div.ag-servers', { role: 'group', 'aria-label': 'Servers' }),
      h('div.grow'),
      btnStop, btnReport, btnReload, btnFull);

    /* under the bar while playing: what the keys do, and today's time */
    const sub = h('div.ag-stage__sub.hidden');
    const screen = h('div.ag-stage__screen', poster);
    stage.append(bar, sub, screen);

    const serversEl = bar.querySelector('.ag-servers');
    function paintServers() {
      serversEl.replaceChildren(...SERVERS.map((x, i) => h('button.ag-server.tip', {
        type: 'button', 'data-tip': serverLabel(x), 'aria-label': `Server ${x.n}: ${serverLabel(x)}`,
        'aria-pressed': String(i === cur), class: i === cur ? 'is-on' : '',
        onclick: () => useServer(i),
      }, h('span', { text: `Server ${x.n}` }))));
    }
    function useServer(i) {
      if (!SERVERS[i]) return;
      cur = i;
      api.store.set('portal.gameVia', SERVERS[i].via);
      paintServers();
      play();
    }
    paintServers();

    /* ---- the strip under the bar: what the keys do, and today's time ----
       The controls are the game's own, so this says what is usually true and
       how to get the keys into the frame; it names no game-specific key.
       The time is measured here: seconds this stage was open and visible. */
    const timeEl = h('span.ag-time', { role: 'status', title: 'Counted on this device, only while a game is open in Static Games' });
    const remindSel = h('select.select.ag-remind', {
      'aria-label': 'Remind me when I have played for',
      onchange: e => api.store.set(K_REMIND, Number(e.target.value) || 0),
    }, [[0, 'No reminder'], [30, 'Remind me at 30 min'], [60, 'Remind me at 1 hour'], [120, 'Remind me at 2 hours']]
      .map(([v, t]) => h('option', { value: String(v), text: t })));
    remindSel.value = String(remindLevel(api));
    const paintTime = () => { timeEl.textContent = `You've played ${minText(playedToday(api))} today`; };
    const hintEl = api.store.get(K_HINT, false) ? null : h('div.ag-hint',
      icon('keyboard', { size: 14 }),
      h('span', { text: 'Controls come from the game: most use the arrow keys or WASD, or the mouse. Click inside the game once so it gets your keys. Esc leaves the game.' }),
      h('button.ibtn.tip', {
        type: 'button', 'data-tip': 'Got it', 'aria-label': 'Hide this hint',
        onclick: () => { api.store.set(K_HINT, true); hintEl.remove(); },
      }, icon('x', { size: 11 })));
    sub.append(...(hintEl ? [hintEl] : []), h('div.ag-stage__subr', timeEl, remindSel));

    let tickAt = 0, tickT = 0;
    const accrue = () => {
      const now = Date.now();
      if (tickAt && document.visibilityState !== 'hidden') addPlayedToday(api, Math.min(now - tickAt, 15000));
      tickAt = now;
      paintTime();
    };
    const tick = () => {
      if (life.dead) return;
      accrue();
      const lvl = remindLevel(api), rec = todayRec(api);
      if (lvl && rec.ms >= lvl * 60000 && rec.told < lvl) {
        api.store.set(K_TODAY, { ...rec, told: lvl });
        api.notify({ app: BRAND.name, icon: 'clock', title: `You've played ${minText(rec.ms)} today`,
          message: 'A reminder you asked for. Your game keeps running.', timeout: 9000 });
      }
    };
    const startClock = () => { if (tickT) return; tickAt = Date.now(); paintTime(); tickT = setInterval(tick, 5000); };
    const stopClock = () => { if (!tickT) return; accrue(); clearInterval(tickT); tickT = 0; tickAt = 0; };
    life.add(stopClock);
    paintTime();

    /* ---- the information panel ---------------------------------- */
    detail.append(infoPanel(game, partial, () => play()));

    const relHold = h('div');
    const relN = h('div.cx__sec-n', { text: '' });
    const relSec = h('section.cx__sec',
      h('div.cx__sec-h', icon('layers'), h('div.cx__sec-t', { text: 'Related games' }), relN),
      relHold);

    api.render(hold, top, relSec, h('div', { style: { height: 'var(--sp-7)' } }));

    /* "Play it" from the queue's offer: this page opens and starts the game */
    if (api.store.get(K_AUTO, '') === game.id) {
      api.store.set(K_AUTO, '');
      if (!external) requestAnimationFrame(() => { if (!life.dead) play(); });
    }

    /* related is below the fold on every window size — fill it lazily */
    api.render(relHold, skelGrid(h, 6, true));
    watch(relSec, () => {
      const picks = shown(api, catalogue.related(game, 40)).slice(0, 14);
      if (!picks.length) {
        relN.textContent = 'none';
        api.render(relHold, emptyBlock(api, {
          iconName: 'layers',
          title: 'Nothing else shares these categories',
          detail: `${game.title} is the only game on file tagged ${listOf(game.cats).map(c => catalogue.catMeta(c).name).join(', ') || 'this way'}.`,
          actions: [h('button.btn', { type: 'button', onclick: () => navigate(LIB) },
            icon('grid-9', { size: 14 }), 'Browse everything')],
        }));
        return;
      }
      relN.textContent = plural(picks.length, 'game');
      const rail = h('div.cx__grid--rail.ag-rail');
      for (const g of picks) rail.appendChild(gameCard(ctx, g));
      api.render(relHold, rail);
    });

    /* ---- play --------------------------------------------------- */
    function loadingBlock() {
      return h('div.ag-stage__load',
        h('div.cx-skel.ag-stage__shimmer', { 'aria-hidden': 'true' }),
        h('div.ag-stage__loadtext', { role: 'status' },
          h('div.spinner'),
          h('b', { text: 'Starting the game' }),
          h('small', { text: `Server ${SERVERS[cur].n}: asking ${serverLabel(SERVERS[cur])} for ${game.title}. It loads straight into this frame — nothing opens elsewhere.` }),
          SERVERS.length > 1
            ? h('small.dim', { text: 'Stuck, or a "not available" screen? Pick another server above.' })
            : null));
    }

    function frameError(reason) {
      return h('div.ag-stage__err', { role: 'alert' },
        icon('alert'),
        h('b', { text: offline() ? 'This device is offline' : 'The game did not load' }),
        h('small', { text: `${reason}${netLine()}` }),
        h('div.ag-empty__acts',
          SERVERS[cur + 1]
            ? h('button.btn.btn--primary', { type: 'button', onclick: () => useServer(cur + 1) }, icon('refresh'), `Try Server ${SERVERS[cur + 1].n}`)
            : null,
          h('button.btn' + (SERVERS[cur + 1] ? '' : '.btn--primary'), { type: 'button', onclick: () => play() }, icon('refresh'), 'Try again'),
          h('button.btn', { type: 'button', onclick: () => stopPlaying() }, icon('chevron-left'), 'Back to details'),
          h('button.btn.btn--ghost', { type: 'button', dataset: { act: 'report' }, onclick: () => reportBroken() },
            icon('alert'), 'Report and hide this game')));
    }

    /**
     * A frame refusal (X-Frame-Options / CSP) fires no event we can read from
     * here, so the only honest signal is "no load event after a long wait".
     * Fifteen seconds is slow enough not to libel a big download.
     */
    function arm() {
      disarm();
      F.timer = setTimeout(() => {
        F.timer = 0;
        if (life.dead || !F.playing) return;
        api.render(screen, frameError(
          `${serverLabel(SERVERS[cur])} has not answered in 15 seconds. Some hosts refuse to run inside a frame, and some are simply blocked on this network.`));
        F.el = null;
      }, 15000);
    }

    function setPlaying(on) {
      F.playing = on;
      notePlaying(on);
      stage.classList.toggle('is-playing', on);
      top.classList.toggle('is-playing', on);
      bar.classList.toggle('hidden', !on);
      sub.classList.toggle('hidden', !on);
      if (on) { fitStage(); startClock(); }
      else { stopClock(); stage.style.removeProperty('--stage-h'); }
    }

    /** Give the stage the visible height of the window, so the game IS the page. */
    function fitStage() {
      const apply = () => {
        if (life.dead || !F.playing) return;
        const sc = scrollParent(stage);
        if (!sc) return;
        const used = (bar.getBoundingClientRect().height || 0) + (sub.getBoundingClientRect().height || 0);
        const space = Math.round(sc.clientHeight - used - 8);
        if (space > 320) stage.style.setProperty('--stage-h', `${space}px`);
      };
      requestAnimationFrame(apply);
      if (typeof ResizeObserver !== 'function') return;
      try {
        const ro = new ResizeObserver(() => apply());
        requestAnimationFrame(() => {
          const sc = scrollParent(stage);
          if (sc && !life.dead) { ro.observe(sc); life.add(() => ro.disconnect()); }
        });
      } catch (err) { /* no observer: the CSS min-height still applies */ }
    }

    async function play() {
      disarm();
      setPlaying(true);
      api.render(screen, loadingBlock());
      notePlay(api, game.id);
      noteRecent(api, game.id);
      if (inQueue(api, game.id)) toggleQueue(api, game.id);      // played: it is no longer waiting
      /* the shared history behind Static Play, Quick Play and achievements */
      plays.record({ kind: 'web', id: game.id, title: game.title, art: game.art, cats: game.cats });

      const server = SERVERS[cur] || SERVERS[0];
      let url = server.url;
      if (server.primary) {
        let res;
        try {
          res = await providers.resolve(`game:${game.id}`);
        } catch (err) {
          if (life.dead) return;
          api.render(screen, frameError(errText(err)));
          return;
        }
        if (life.dead) return;
        if (!res || res.kind !== 'embed' || !res.url) {
          api.render(screen, frameError((res && res.reason) || 'No source is on file for this game.'));
          return;
        }
        url = res.url;
      }
      F.url = url;
      const frame = h('iframe.ag-stage__frame', {
        src: url,
        allow: 'autoplay; fullscreen; gamepad; clipboard-write; accelerometer; gyroscope',
        allowfullscreen: true,
        referrerpolicy: 'no-referrer',
        title: game.title,
        onload: () => { disarm(); },
      });
      F.el = frame;
      api.render(screen, frame);
      arm();
    }

    function stopPlaying() {
      disarm();
      /* Dropping the iframe is what actually stops the audio — a paused game
         that keeps playing music behind the details page is the bug here. */
      F.el = null;
      F.url = '';
      setPlaying(false);
      api.render(screen, poster);
      bigPlay.focus();
      offerNext();
    }

    /* When a game closes, the next one in the play queue is offered — never
       started on its own. "Play it" opens that game's page and starts it. */
    function offerNext() {
      poster.querySelector('.ag-upnext')?.remove();
      const hid = hiddenIds(api);
      const next = catalogue.byIds(queueIds(api).filter(id => id !== game.id)).find(g => !hid.has(g.id));
      if (!next) return;
      const box = h('div.ag-upnext', { role: 'group', 'aria-label': 'Up next in your play queue' },
        h('small', { text: 'Up next in your play queue' }),
        h('b', { text: next.title }),
        h('div.ag-upnext__acts',
          h('button.btn.btn--primary.btn--sm', {
            type: 'button',
            onclick: () => {
              toggleQueue(api, next.id);
              if (!catalogue.opensOnTheirSite(next)) api.store.set(K_AUTO, next.id);
              navigate(urlFor(next.id));
            },
          }, icon('play', { size: 13, fill: true }), 'Play it'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => box.remove() }, 'Not now'),
          h('button.btn.btn--ghost.btn--sm', {
            type: 'button', onclick: () => { toggleQueue(api, next.id); offerNext(); },
          }, 'Take it off the queue')));
      poster.appendChild(box);
    }

    /* A game that will not load: hide it for this person and say plainly that
       the report stays on this device. */
    function reportBroken() {
      stopPlaying();
      notInterested(ctx, game, null, 'broken');
      navigate(LIB);
    }

    function toggleFull() {
      const target = stage;
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (target.requestFullscreen) target.requestFullscreen();
      } catch (err) {
        api.notify({ app: BRAND.name, icon: 'alert', title: 'Fullscreen refused',
          message: 'This window would not go fullscreen.' });
      }
    }

    life.add(api.on(document, 'fullscreenchange', () => {
      const on = document.fullscreenElement === stage;
      stage.classList.toggle('is-full', on);
      btnFull.setAttribute('data-tip', on ? 'Leave fullscreen' : 'Fullscreen');
      btnFull.setAttribute('aria-label', on ? 'Leave fullscreen' : 'Enter fullscreen');
      api.render(btnFull, icon(on ? 'minimize-2' : 'expand'));
    }));

    /* ---- Escape: leave the game first, the page second ----------- */
    life.add(api.on(window, 'keydown', e => {
      if (life.dead || e.key !== 'Escape') return;
      if (win?.el && !win.el.classList.contains('is-active')) return;
      if (typingIn(e.target)) return;
      if (document.fullscreenElement) return;          // the browser handles this one
      /* A context menu, Spotlight or the window Overview owns Escape while it is
         open; without this, dismissing one would also destroy a running game. */
      if (document.querySelector('.menu, .spot-wrap, .overview, .noti, .lock')) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (F.playing) stopPlaying();
      else navigate(LIB);
    }));
  }

  /* ---------------------------------------------------------------- */
  function infoPanel(game, partial, onPlay) {
    const cats = listOf(game.cats).map(id => catalogue.catMeta(id));
    const facts = h('div.ag-detail__facts');

    facts.appendChild(fact('gamepad', 'Studio', game.studio));
    facts.appendChild(fact('globe', 'Host', hostOf(game.embed)));
    /* plays and rating only exist for the feeds that publish them */
    if (game.hasStats) {
      facts.appendChild(fact('activity', 'Plays', `${num(game.plays)}`));
      facts.appendChild(fact('star', 'Rating', `${rateText(game.rating)} / 5`));
    }

    const chips = h('div.ag-detail__chips');
    for (const c of cats) {
      chips.appendChild(h('button.chip.ag-chip', {
        type: 'button', 'aria-label': `Browse ${c.name} games`,
        onclick: () => { api.store.set('portal.gamesCat', c.id); navigate(LIB); },
      }, icon(c.icon), h('span', { text: c.name })));
    }
    for (const t of listOf(game.tags)) {
      chips.appendChild(h('span.chip', icon('tag'), h('span', { text: t })));
    }

    const favBtn = h('button.btn', { type: 'button' });
    const paintFav = () => {
      const on = isFav(api, game.id);
      favBtn.classList.toggle('is-on', on);
      favBtn.setAttribute('aria-pressed', String(on));
      api.render(favBtn, icon('heart', { fill: on }),
        h('span', { text: on ? 'In favourites' : 'Add to favourites' }));
    };
    favBtn.onclick = () => { toggleFav(api, game.id); paintFav(); };
    paintFav();

    /* ---- queue, hide, and sending the page to a friend ---- */
    const queueBtn = h('button.btn', { type: 'button' });
    const paintQueue = () => {
      const on = inQueue(api, game.id);
      queueBtn.setAttribute('aria-pressed', String(on));
      queueBtn.classList.toggle('is-on', on);
      api.render(queueBtn, icon(on ? 'check' : 'list'), h('span', { text: on ? 'In play queue' : 'Add to play queue' }));
    };
    queueBtn.onclick = () => { toggleQueue(api, game.id); paintQueue(); };
    paintQueue();

    const friendHold = h('div.ag-friend.hidden', { role: 'group', 'aria-label': 'Send to a friend' });
    const friendBtn = h('button.btn', {
      type: 'button', 'aria-expanded': 'false',
      onclick: () => {
        const open = friendHold.classList.toggle('hidden') === false;
        friendBtn.setAttribute('aria-expanded', String(open));
        if (open) paintFriendPanel(ctx, friendHold, { kind: 'game', id: game.id, title: game.title }, () => !life.dead);
      },
    }, icon('users'), 'Play with a friend');

    /* the descriptions come after the list (games.data.js): until they are in, say so */
    function descNode(g) {
      const none = 'This host publishes no description for this game.';
      if (g.desc) return h('p.ag-detail__desc', { text: g.desc });
      if (catalogue.descriptionsLoaded()) return h('p.ag-detail__desc.is-missing', { text: none });
      const p = h('p.ag-detail__desc.is-missing', { text: 'Loading the description…', 'aria-busy': 'true' });
      catalogue.loadDescriptions().then(() => {
        if (!p.isConnected) return;
        p.removeAttribute('aria-busy');
        p.classList.toggle('is-missing', !g.desc);
        p.textContent = g.desc || none;
      });
      return p;
    }

    const hideBtn = h('button.btn.btn--ghost', {
      type: 'button',
      onclick: () => { notInterested(ctx, game, null); navigate(LIB); },
    }, icon('eye-off'), 'Not interested');

    return h('div.ag-detail__in',
      h('div.ag-detail__head',
        h('button.ibtn.tip', {
          type: 'button', 'data-tip': 'Back to games', 'aria-label': 'Back to games',
          onclick: () => navigate(LIB),
        }, icon('chevron-left')),
        h('h1.ag-detail__t', { text: game.title })),
      chips.children.length ? chips : null,
      descNode(game),
      facts,
      h('div.ag-detail__acts',
        h('button.btn.btn--primary', { type: 'button', onclick: onPlay },
          icon('play', { fill: true }), 'Play'),
        favBtn,
        h('button.btn', { type: 'button', onclick: () => addToDesktop(ctx, game) },
          icon('monitor'), 'Add to Desktop'),
        h('button.btn.btn--ghost', { type: 'button', onclick: () => copyLink(ctx, urlFor(game.id)) },
          icon('copy'), 'Copy link'),
        useArtButton(api, { title: game.title, url: game.art })),
      h('div.ag-detail__acts', queueBtn, friendBtn, hideBtn),
      friendHold,
      minePanel(game),
      partial
        ? h('div.ag-detail__warn', icon('alert'),
            h('small', { text: 'The full catalogue file could not be read, so this is the curated shelf only.' }))
        : null);

    /* This person's own words about a game, and a score they type in. Kept
       on this device; nothing here is measured or checked. */
    function minePanel(g) {
      const mine = mineOf(api, g.id);
      const saved = h('small.dim.ag-mine__saved', { text: '' });
      const note = h('textarea.ag-mine__note', {
        rows: 3, maxlength: '500', placeholder: 'Tips, codes, where you got stuck…', 'aria-label': `Your notes on ${g.title}`,
      });
      note.value = mine.note || '';
      const best = h('input.ag-mine__best', {
        type: 'text', maxlength: '24', placeholder: 'e.g. 12,450 or 2:31', 'aria-label': `Your best score in ${g.title}`, value: mine.best || '',
      });
      let t = 0;
      const save = () => {
        clearTimeout(t);
        t = setTimeout(() => { saveMine(api, g.id, { note: note.value, best: best.value }); saved.textContent = 'Saved on this device'; }, 350);
      };
      note.addEventListener('input', save);
      best.addEventListener('input', save);
      life.add(() => { if (t) { clearTimeout(t); saveMine(api, g.id, { note: note.value, best: best.value }); } });
      return h('section.ag-mine', { 'aria-label': 'Your notes and best score' },
        h('div.ag-mine__h', icon('file-text', { size: 14 }), h('b', { text: 'Your notes' }), saved),
        h('label.ag-mine__l', h('span', { text: 'Your best score' }), best),
        note);
    }

    function fact(ic, label, value) {
      return h('div.ag-fact', icon(ic),
        h('div', h('u', { text: label }), h('b', { text: value })));
    }
  }

  return root;
}

export default { buildGames, buildGameDetail };
