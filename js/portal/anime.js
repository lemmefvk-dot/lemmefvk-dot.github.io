/* ============================================================
   anime.js — the Static anime + manga library.

   ONE implementation serves both routes: ctx.mediaKind is
   'anime' (7,963 MyAnimeList titles) or 'manga' (1,200
   MangaDex titles). All data comes from providers.bigCatalogue,
   which fetches its JSON once and then answers from memory — so
   the first paint is a skeleton and every filter, page or view
   after that is a pure re-query, never a refetch.

   Exports
     buildAnime(ctx)        home rails / browse grid / library
     buildAnimeDetail(ctx)  one title, its episodes and relations

   Views live on one route. The router only pulls ?q=, so the
   rest comes off ctx.url:
     ?view=(browse|watchlist|history) ?q= ?genre= ?year=
     ?status= ?sort= ?page=

   HONESTY. The catalogue carries a score, an episode/chapter
   count, a year, a season, a status, a rating, a media type and
   genres — and nothing else. There are no view counts, no
   popularity ranks, no studios, no per-episode titles and no
   air dates, so nothing here prints one. A rail that ranks by
   score says so; a field that is missing is left out rather
   than filled with a placeholder.
   ============================================================ */

import { BRAND } from './brand.js';

const PER_PAGE = 36;      /* grid page                                   */
const GENRE_CHIPS = 14;   /* chips in the filter bar                     */
const GENRE_RAILS = 10;   /* per-genre rows on the home page             */
const RAIL_LEN = 20;      /* cards per row — the rest is behind "See all"*/
const HERO_LEN = 5;       /* slides in the hero deck                     */
const HERO_MS = 7000;
const EP_PAGE = 60;       /* episodes per page; One Piece has 1,100+     */
const HISTORY_MAX = 60;
const ADDED_MAX = 80;
const ADDED_DAYS = 30;
/* A catalogue swap (local snapshot -> live site) makes every id look new.
   More than this many at once is a swap, not an addition, so it is only
   re-baselined and never announced. */
const ADDED_BURST = 240;

/* ---- persisted state ----------------------------------------------
   Everything lives under `portal`, the one branch store.js persists.

     portal.watchlist       SHARED with movies.js — "kind:id" tokens
     portal.anime.history   [{k,id,at}] newest first — this page only
     portal.anime.progress  {"kind:id":{ep,of,at}} — episodes marked watched
     portal.anime.resume    {"kind:id":{ep,of,at,src,t?,d?}} — where you
                            left off: the episode last opened in the
                            player box (src 'opened'), plus the second
                            reached when the player itself reports it
                            (src 'player'). Static Watch reads both.
     portal.anime.seen      {kind:"<short ids>"} baseline for "new"
     portal.anime.added     {kind:[{id,at}]} what that baseline found

   `portal` is in store.js's PERSIST list; `Static` was not, so a saved
   title was silently lost on the next reload.                        */
const WATCH_KEY = 'portal.watchlist';
const HIST_KEY = 'portal.anime.history';
const PROG_KEY = 'portal.anime.progress';
const RESUME_KEY = 'portal.anime.resume';
const RESUME_MAX = 120;   /* titles whose place is remembered            */
const RESUME_EVERY = 5000;/* ms between position writes while one plays  */
const SEEN_KEY = 'portal.anime.seen';
const ADDED_KEY = 'portal.anime.added';

/* Per-kind wording — the only place this file branches on kind. */
const KINDS = {
  anime: {
    kind: 'anime', label: 'Anime', icon: 'star',
    other: 'manga', otherLabel: 'Manga', otherIcon: 'file-text',
    expect: 7963, weight: '7.9 MB',
    unit: 'eps', unitLong: 'Episodes', unitOne: 'Episode', countKey: 'episodes',
    live: 'Currently Airing', kick: 'AIRING NOW',
    play: 'Watch', watched: 'Watched', cardIcon: 'play', playIcon: 'play', cardFill: true,
    seasons: true,
    statuses: [['', 'Any status'], ['Currently Airing', 'Currently airing'], ['Finished Airing', 'Finished airing']],
  },
  manga: {
    kind: 'manga', label: 'Manga', icon: 'file-text',
    other: 'anime', otherLabel: 'Anime', otherIcon: 'star',
    expect: 1200, weight: '1.4 MB',
    unit: 'ch', unitLong: 'Chapters', unitOne: 'Chapter', countKey: 'chapters',
    live: 'Ongoing', kick: 'ONGOING NOW',
    play: 'Read', watched: 'Read', cardIcon: 'info', playIcon: 'file-text', cardFill: false,
    seasons: false,
    statuses: [['', 'Any status'], ['Ongoing', 'Ongoing'], ['Completed', 'Completed'],
      ['Hiatus', 'Hiatus'], ['Cancelled', 'Cancelled']],
  },
};

const VIEWS = [
  ['', 'Home', 'home'],
  ['browse', 'Browse', 'grid'],
  ['watchlist', 'Watchlist', 'bookmark'],
  ['history', 'History', 'clock'],
];

/** The external ids providers.resolve() hands back, in table order. */
const ID_FIELDS = [
  ['MAL', 'mal'],
  ['TMDB', 'tmdb'],
  ['IMDb', 'imdb'],
  ['AniList', 'anilist'],
  ['TMDB season', 'season'],
  ['MangaDex', 'mangadex'],
];

/* ------------------------------------------------------------------ *
 *  small shared helpers
 * ------------------------------------------------------------------ */
const nf = n => Number(n || 0).toLocaleString();
const cap = s => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const kindOf = k => KINDS[k === 'manga' ? 'manga' : 'anime'];
const countOf = (rec, K) => (K.countKey === 'chapters' ? rec.chapters : rec.episodes);
const seasonOf = rec => (rec.season && rec.season !== 'Unknown' ? cap(rec.season) : '');
const shortRating = r => (r ? String(r).split(' - ')[0] : '');
const hasScore = rec => rec.score !== null && rec.score !== undefined;
const itemUrl = (kind, id) => `static://${kind}/${id}`;
const plural = (n, one) => `${nf(n)} ${n === 1 ? one : `${one}s`}`;

/** The host a catalogue was actually fetched from, for the footer line. */
const hostOf = u => {
  try { return new URL(String(u)).host; } catch (e) { return String(u || ''); }
};

const reducedMotion = api => !!(api.prefs && api.prefs.reduceMotion)
  || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

function listUrl(kind, extra) {
  const parts = Object.entries(extra || {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return `static://${kind}${parts.length ? '?' + parts.join('&') : ''}`;
}

/** Read the filter params off the raw route url. */
function paramsOf(url) {
  const raw = String(url || '');
  const i = raw.indexOf('?');
  if (i < 0) return {};
  const out = {};
  try {
    const sp = new URLSearchParams(raw.slice(i + 1));
    for (const k of ['q', 'genre', 'year', 'status', 'sort', 'page', 'view']) {
      const v = sp.get(k);
      if (v) out[k] = v;
    }
  } catch (e) { /* malformed url — no filters, no crash */ }
  return out;
}

/** Put the scroll container (the browser view) back at the top. */
function scrollUp(node) {
  let el = node;
  try {
    while (el && el !== document.body) {
      const ov = getComputedStyle(el).overflowY;
      if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
        el.scrollTop = 0;
        return;
      }
      el = el.parentElement;
    }
  } catch (e) { /* detached node */ }
  if (node && node.scrollIntoView) node.scrollIntoView({ block: 'start' });
}

/**
 * Page lifecycle. The router just clears its view node, so the page has to
 * notice its own removal and run its cleanups then — timers, observers and
 * window listeners must never outlive the page that opened them.
 */
function lifecycle(root) {
  const fns = [];
  let done = false;
  let attached = false;
  const run = () => {
    if (done) return;
    done = true;
    for (const fn of fns.splice(0)) {
      try { fn(); } catch (e) { console.warn(`[${BRAND.name}] teardown`, e); }
    }
  };
  /* not-yet-attached is not dead: build() hands the node back before the
     router appends it, so async work still has to be allowed to land */
  const dead = () => {
    if (done) return true;
    if (root.isConnected) { attached = true; return false; }
    return attached;
  };
  const raf = fn => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn); };
  let tries = 0;
  const watch = () => {
    if (done || typeof MutationObserver !== 'function') return;
    const parent = root.parentNode || root.parentElement;
    if (!parent) { if (++tries < 240) raf(watch); return; }
    const obs = new MutationObserver(() => { if (!root.isConnected) { obs.disconnect(); run(); } });
    obs.observe(parent, { childList: true });
    fns.push(() => obs.disconnect());
  };
  raf(watch);
  root.cherriTeardown = run;
  return {
    add: fn => { if (typeof fn !== 'function') return; if (done) fn(); else fns.push(fn); },
    run, get dead() { return dead(); },
  };
}

/**
 * Hold the window subtitle. The Browser repaints its chrome a beat after each
 * navigation and blanks the subtitle for in-OS urls, so claim it back when wm
 * says the title line changed.
 */
function claimSubtitle(ctx, life, text) {
  const { api, win } = ctx;
  if (!win || typeof win.setSubtitle !== 'function') return;
  const set = () => { if (!life.dead) win.setSubtitle(text); };
  set();
  if (!api.bus || typeof api.bus.on !== 'function') return;
  life.add(api.bus.on('win:title', w => {
    if (life.dead || (w && w !== win && w.el !== win.el)) return;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(set);
    else set();
  }));
}

const nextFrame = fn => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn); };

/** The nearest ancestor that scrolls — the page lives in the Browser's view. */
function scrollParent(el) {
  let p = el.parentElement;
  try {
    while (p) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
      p = p.parentElement;
    }
  } catch (e) { /* detached */ }
  return null;
}

/**
 * Give the filter bar a backdrop once it parks under the top strip.
 * The observer has to take the scrolling ancestor as its root: the page sits
 * inside a window, so the viewport's top edge is nowhere near the bar's, and a
 * viewport-rooted observer flips as many pixels late as the window sits down
 * the screen. `offset` is the sticky strip the bar parks under.
 */
function watchStuck(bar, sentinel, offset) {
  let io = null, stopped = false, tries = 0;
  const start = () => {
    if (stopped || io || typeof IntersectionObserver !== 'function') return;
    /* the bar has to be in the tree before its scroll container can be found */
    if (!bar.isConnected) { if (++tries < 240) nextFrame(start); return; }
    const root = scrollParent(bar);
    if (!root) return;
    try {
      io = new IntersectionObserver(entries => {
        for (const e of entries) {
          const rb = e.rootBounds;
          bar.classList.toggle('cx__bar--stuck',
            !e.isIntersecting && (!rb || e.boundingClientRect.top < rb.top + 1));
        }
      }, { root, threshold: 0, rootMargin: `-${Math.max(0, offset || 0)}px 0px 0px 0px` });
      io.observe(sentinel);
    } catch (e) { io = null; }
  };
  start();
  return () => { stopped = true; if (io) { io.disconnect(); io = null; } };
}

/**
 * Build a row's cards only once it is near the viewport. Nineteen rails of
 * twenty posters is 380 cards; mounting them all up front is what makes a
 * 7,963-title library feel slow, and the user is only ever looking at two.
 */
function lazyMount(el, life, fn) {
  let done = false;
  const go = () => { if (done || life.dead) return; done = true; fn(); };
  if (typeof IntersectionObserver !== 'function') { go(); return; }
  let io = null, tries = 0;
  const start = () => {
    if (done || life.dead) return;
    if (!el.isConnected) { if (++tries < 240) nextFrame(start); return; }
    try {
      io = new IntersectionObserver(entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        if (io) { io.disconnect(); io = null; }
        go();
      }, { root: scrollParent(el) || null, rootMargin: '700px 0px' });
      io.observe(el);
      life.add(() => { if (io) { io.disconnect(); io = null; } });
    } catch (e) { go(); }
  };
  nextFrame(start);
}

/** Is the user typing? Then the page must keep its hands off the keys. */
function isTyping(t) {
  const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!(t && t.isContentEditable);
}

async function copyText(api, text, what) {
  const value = String(text);
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('unavailable');
    await navigator.clipboard.writeText(value);
    api.notify({ app: BRAND.name, icon: 'copy', title: `${what} copied`, message: value });
  } catch (e) {
    api.notify({ app: BRAND.name, icon: 'alert', title: `Could not copy — ${what.toLowerCase()}`, message: value });
  }
}

/* ---- watchlist ---------------------------------------------------
   One shared list for the whole portal, and the shape is a contract:
   plain "kind:id" tokens — the same token providers.resolve() takes.
   movies.js writes "movie:<id>" under this same key.

   Membership is a strict-equality lookup, so a row in any other shape
   simply does not match ours; the write path must therefore carry every
   row it does not recognise through untouched, or an anime toggle would
   delete a movie row written by an older build. */
const watchToken = (kind, id) => `${kind}:${id}`;
const watchAll = store => {
  const v = store.get(WATCH_KEY, []);
  return Array.isArray(v) ? v : [];
};
const inWatch = (store, kind, id) => watchAll(store).includes(watchToken(kind, id));
/** Saved ids for one kind, newest first (the list itself is append-order). */
function watchIds(store, kind) {
  const pre = `${kind}:`;
  return watchAll(store)
    .filter(r => typeof r === 'string' && r.startsWith(pre))
    .map(r => r.slice(pre.length))
    .reverse();
}
/** How many rows belong to something other than this catalogue. */
function watchOther(store, kind) {
  const pre = `${kind}:`;
  return watchAll(store).filter(r => !(typeof r === 'string' && r.startsWith(pre))).length;
}

function toggleWatch(api, rec, kind) {
  const token = watchToken(kind, rec.id);
  const list = watchAll(api.store);
  const on = list.includes(token);
  const next = on ? list.filter(x => x !== token) : [...list, token];
  api.store.set(WATCH_KEY, next);
  api.notify({
    app: BRAND.name, icon: on ? 'trash' : 'bookmark',
    title: on ? 'Removed from Watchlist' : 'Added to Watchlist',
    message: `${rec.title} · ${plural(next.length, 'title')} saved`,
  });
  return !on;
}

/* ---- history ------------------------------------------------------ */
const historyAll = store => {
  const v = store.get(HIST_KEY, []);
  return Array.isArray(v) ? v.filter(r => r && typeof r === 'object' && r.id) : [];
};
const historyFor = (store, kind) => historyAll(store).filter(r => r.k === kind);

function pushHistory(api, rec, kind) {
  const rows = historyAll(api.store);
  const head = rows[0];
  if (head && head.k === kind && head.id === String(rec.id)) return;  /* a refresh is not a second visit */
  const rest = rows.filter(r => !(r.k === kind && r.id === String(rec.id)));
  api.store.set(HIST_KEY, [{ k: kind, id: String(rec.id), at: Date.now() }, ...rest].slice(0, HISTORY_MAX));
}

function clearHistory(api, kind) {
  const kept = historyAll(api.store).filter(r => r.k !== kind);
  api.store.set(HIST_KEY, kept);
}

/* ---- progress -----------------------------------------------------
   Episodes marked watched. Written when the user marks one, moves on with
   "Next episode", or when the player itself reports that an episode ended
   — never guessed from anything else. */
const progressAll = store => {
  const v = store.get(PROG_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};
const progressOf = (store, kind, id) => progressAll(store)[watchToken(kind, id)] || null;

function setProgress(api, kind, id, ep, of) {
  const all = progressAll(api.store);
  const key = watchToken(kind, id);
  if (!ep) {
    if (!(key in all)) return;
    const next = { ...all };
    delete next[key];
    api.store.set(PROG_KEY, next);
    return;
  }
  api.store.set(PROG_KEY, { ...all, [key]: { ep, of: of || 0, at: Date.now() } });
}

/* ---- resume -------------------------------------------------------
   Where you left off. Opening an episode in the player box records it
   (src 'opened'). Only if the embedded player posts its own clock back to
   this page does a second get recorded too (src 'player', with t and d);
   most players don't, and then the episode is all StaticOS claims to
   know. Static Watch's "Continue watching" reads this. */
const resumeAll = store => {
  const v = store.get(RESUME_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};
function resumeOf(store, kind, id) {
  const r = resumeAll(store)[watchToken(kind, id)];
  if (!r || typeof r !== 'object' || !(Number(r.ep) >= 1)) return null;
  const t = Number(r.t), d = Number(r.d);
  const timed = r.src === 'player' && Number.isFinite(t) && t >= 0;
  return {
    ep: Math.floor(Number(r.ep)), of: Number(r.of) || 0, at: Number(r.at) || 0,
    src: timed ? 'player' : 'opened',
    t: timed ? t : null, d: timed && Number.isFinite(d) && d > 0 ? d : null,
  };
}
function setResume(api, kind, id, rec) {
  const all = { ...resumeAll(api.store) };
  const key = watchToken(kind, id);
  if (!rec) {
    if (!(key in all)) return;
    delete all[key];
  } else {
    all[key] = { ...rec, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > RESUME_MAX) {
      keys.sort((a, b) => (Number(all[b]?.at) || 0) - (Number(all[a]?.at) || 0))
        .slice(RESUME_MAX).forEach(k => { delete all[k]; });
    }
  }
  api.store.set(RESUME_KEY, all);
}

/** A player's own report of where it is, if this message is one.
    Embeds that talk to their parent page use a handful of shapes —
    {currentTime,duration}, {time,duration}, {event,data:{…}}, or the
    same as a JSON string — so this reads any of them and ignores the
    rest. The message is untrusted: only finite seconds under a day pass. */
function readPlayerClock(data) {
  let d = data;
  if (typeof d === 'string') {
    if (d.length > 4000 || !/^\s*\{/.test(d)) return null;
    try { d = JSON.parse(d); } catch (e) { return null; }
  }
  if (!d || typeof d !== 'object') return null;
  const inner = d.data && typeof d.data === 'object' ? d.data : null;
  const pick = (...keys) => {
    for (const o of [d, inner]) {
      if (!o) continue;
      for (const k of keys) {
        if (o[k] === null || o[k] === undefined || o[k] === '') continue;
        const v = Number(o[k]);
        if (Number.isFinite(v)) return v;
      }
    }
    return NaN;
  };
  const t = pick('currentTime', 'time', 'position', 'seconds');
  const dur = pick('duration', 'dur');
  const evt = String(d.event || (inner && inner.event) || d.type || '').toLowerCase();
  const ended = /ended|complete|finish/.test(evt);
  const okT = Number.isFinite(t) && t >= 0 && t <= 86400;
  if (!okT && !ended) return null;
  return {
    t: okT ? t : null,
    d: Number.isFinite(dur) && dur > 0 && dur <= 86400 ? dur : null,
    ended, paused: /pause/.test(evt),
  };
}

/** Is a player-reported position at (or within a few seconds of) the end? */
const atEnd = (t, d) => t !== null && t !== undefined && d > 0 && t >= d - Math.max(10, d * 0.03);

/**
 * Where you left off in one title, from the two things StaticOS really
 * keeps: the episodes marked watched and the episode last opened (with its
 * second, when the player reported one). Whichever happened last wins.
 *
 *   how 'player'  in the middle of `ep`, at `t` of `d` seconds (from the player)
 *       'opened'  `ep` was the last one opened; how far in is not known
 *       'next'    `ep` is the first one after everything finished or marked
 *   null          nothing to pick up: never opened, or every episode is done
 *
 * Static Watch's "Continue watching" uses this, so both places agree.
 */
export function whereLeftOff(store, kind, id) {
  const p = progressOf(store, kind, id);
  const r = resumeOf(store, kind, id);
  const marked = p && Number(p.ep) > 0 ? Math.floor(Number(p.ep)) : 0;
  const of = (r && r.of) || (p && Number(p.of)) || 0;
  const pAt = p ? Number(p.at) || 0 : -1;
  const rAt = r ? r.at : -1;
  if (r && rAt >= pAt && !atEnd(r.t, r.d)) {
    if (of && marked >= of) return null;
    const timed = r.src === 'player' && r.t >= 1;
    return { ep: r.ep, of, at: rAt, how: timed ? 'player' : 'opened', t: timed ? r.t : null, d: timed ? r.d : null, marked };
  }
  const last = Math.max(marked, r && rAt >= pAt ? r.ep : 0);
  if (!last || (of && last >= of)) return null;
  return { ep: last + 1, of, at: Math.max(rAt, pAt), how: 'next', t: null, d: null, marked, last };
}

/** "12:04", "1:02:03" */
function clockText(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p2 = n => String(n).padStart(2, '0');
  return hh ? `${hh}:${p2(mm)}:${p2(ss)}` : `${mm}:${p2(ss)}`;
}

/** The ?ep= a link asked for (Static Watch's "Continue" and "Next episode"). */
function epParam(url) {
  const raw = String(url || '');
  const i = raw.indexOf('?');
  if (i < 0) return 0;
  try {
    const n = Math.floor(Number(new URLSearchParams(raw.slice(i + 1)).get('ep')));
    return n >= 1 && n <= 100000 ? n : 0;
  } catch (e) { return 0; }
}

/** In-progress titles, most recent first — finished ones drop out. */
function continueList(store, kind) {
  const all = progressAll(store);
  const pre = `${kind}:`;
  return Object.entries(all)
    .filter(([k, v]) => k.startsWith(pre) && v && v.ep > 0 && (!v.of || v.ep < v.of))
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .map(([k, v]) => ({ id: k.slice(pre.length), ...v }));
}

/* ---- "Recently added" ---------------------------------------------
   The catalogue has no added-at date, so the only honest source for this
   rail is a diff against what this browser saw last time. The baseline is
   a comma-joined list of short ids (~32 KB for 7,963 anime); it is only
   rewritten when it actually changes. With no baseline — a first visit —
   there is no rail at all, rather than a row of "new" titles that are not. */
function recentlyAdded(api, BC, kind, rows) {
  const store = api.store;
  const seenMap = store.get(SEEN_KEY, {}) || {};
  const prev = typeof seenMap[kind] === 'string' ? seenMap[kind] : '';
  const now = rows.map(BC.shortId).join(',');

  const addedMap = store.get(ADDED_KEY, {}) || {};
  const cutoff = Date.now() - ADDED_DAYS * 86400000;
  let added = (Array.isArray(addedMap[kind]) ? addedMap[kind] : [])
    .filter(a => a && a.id && a.at > cutoff);
  let changed = added.length !== (Array.isArray(addedMap[kind]) ? addedMap[kind].length : 0);

  if (prev && prev !== now) {
    const before = new Set(prev.split(','));
    const fresh = rows.filter(r => !before.has(BC.shortId(r)));
    if (fresh.length && fresh.length <= ADDED_BURST) {
      const at = Date.now();
      const known = new Set(added.map(a => a.id));
      const rowsNew = fresh.filter(r => !known.has(r.id)).map(r => ({ id: r.id, at }));
      if (rowsNew.length) { added = [...rowsNew, ...added].slice(0, ADDED_MAX); changed = true; }
    }
  }
  if (prev !== now) store.set(SEEN_KEY, { ...seenMap, [kind]: now });
  if (changed) store.set(ADDED_KEY, { ...addedMap, [kind]: added });
  return { ids: added.map(a => a.id), first: !prev };
}

/* ------------------------------------------------------------------ *
 *  chrome shared by every Static page
 * ------------------------------------------------------------------ */
const NAV = [
  ['Home', 'home', 'static://home', 'home'],
  ['Games', 'gamepad', 'static://games', 'games'],
  ['Movies', 'film', 'static://movies', 'movies'],
  ['Anime', 'star', 'static://anime', 'anime'],
  ['Search', 'search', 'static://search', 'search'],
];

function topStrip(ctx, current) {
  const { api, navigate } = ctx;
  const { h, icon } = api;

  const input = h('input', {
    type: 'search', placeholder: `Search ${BRAND.name}…`, spellcheck: 'false',
    'aria-label': `Search ${BRAND.name}`, enterkeyhint: 'search',
  });
  const find = h('form.field.cx__find', {
    onsubmit: e => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) navigate(`static://search?q=${encodeURIComponent(q)}`);
      else input.focus();
    },
  }, icon('search'), input);

  const nav = h('div.cx__nav', { role: 'navigation', 'aria-label': BRAND.name },
    NAV.map(([label, ic, url, id]) => h('button', {
      type: 'button',
      class: id === current ? 'is-on' : null,
      'aria-current': id === current ? 'page' : null,
      onclick: () => navigate(url),
    }, icon(ic), h('span', { text: label }))));

  return h('div.cx__top',
    h('div.cx__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })),
    find, nav);
}

/* ---- skeletons ---------------------------------------------------- */
function skelCards(api, n) {
  const { h } = api;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(h('div.cxa-skel-card',
      h('div.cx-skel.cx-skel--poster'),
      h('div.cx-skel.cx-skel--line', { style: { width: '78%' } }),
      h('div.cx-skel.cx-skel--line', { style: { width: '46%' } })));
  }
  return out;
}

/** The first paint: a hero block and two rows of posters, in skeleton. */
function loadingBlock(api, K) {
  const { h } = api;
  return h('div.cxa-load', { 'aria-busy': 'true' },
    h('div.cx-skel.cxa-skel-hero'),
    h('div.cxa-load__row',
      h('div.row',
        h('div.spinner'),
        h('small.dim', { text: `Loading the ${K.label.toLowerCase()} catalogue — one `
          + `${K.weight} fetch, then it is in memory for the rest of the session.` })),
      h('div.cxa-skel-rail', skelCards(api, 8))),
    h('div.cxa-load__row', h('div.cxa-skel-rail', skelCards(api, 8))));
}

/**
 * The one failure state. `opts` names what failed, because a catalogue that
 * will not load and a source lookup that will not answer are not the same
 * problem and must not read as if they were.
 */
function downBlock(api, err, retry, opts) {
  const { h, icon } = api;
  const o = opts || {};
  const msg = (err && err.message) ? err.message : 'Unknown error.';
  return h('div.cx-down', icon('alert'),
    h('div',
      h('b', { text: o.title || 'Catalogue unavailable' }),
      h('small', { text: `${msg} ${o.hint || `${BRAND.name} reads the catalogue from data/anime.json `
        + 'and data/manga.json — serve the project over http:// so the fetch can succeed.'}` }),
      h('div', { style: { marginTop: 'var(--sp-4)' } },
        h('button.btn.btn--sm', { type: 'button', onclick: retry },
          icon('refresh', { size: 13 }), h('span', { text: 'Retry' })))));
}

/** An honest empty state: what is missing, and the one way out of it. */
function emptyBlock(api, { icon: ic, title, note, action, onAction }) {
  const { h, icon } = api;
  return h('div.empty.cxa-empty', { style: { minHeight: '240px' } },
    icon(ic || 'search'),
    h('b', { text: title }),
    note ? h('small', { text: note }) : null,
    action ? h('button.btn.btn--sm', { type: 'button', onclick: onAction },
      icon('grid', { size: 13 }), h('span', { text: action })) : null);
}

/** The lazy poster: real art over the procedural artFor() fallback. */
function posterImg(api, rec, wide) {
  const src = wide ? (rec.backdrop || rec.image) : (rec.image || rec.backdrop);
  if (!src) return null;
  return api.h('img', {
    src, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false',
    style: { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' },
    onerror: e => { e.target.style.display = 'none'; },
  });
}

/* A rail that also answers the arrow keys once focused. */
function rail(api, cards, label) {
  const box = api.h('div.cx__grid.cx__grid--rail', {
    role: 'group', tabindex: '0', 'aria-label': label,
    onkeydown: e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      box.scrollBy({ left: e.key === 'ArrowRight' ? 340 : -340, behavior: 'smooth' });
    },
  }, cards);
  return box;
}

/**
 * A section head. `note` is the line that keeps a rail honest — it says what
 * the row is actually ranked by, so "Popular" cannot be read as a play count.
 */
function section(api, opts) {
  const { h, icon } = api;
  const head = h('div.cx__sec-h', icon(opts.icon), h('div.cx__sec-t', { text: opts.title }));
  if (opts.count) head.appendChild(h('div.cx__sec-n', { text: opts.count }));
  head.appendChild(h('div.grow'));
  if (opts.tools) head.appendChild(opts.tools);
  const sec = h('div.cx__sec', head);
  if (opts.note) sec.appendChild(h('div.cxa-sec__note', { text: opts.note }));
  return sec;
}

function seeAllBtn(api, label, onClick) {
  return api.h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: onClick },
    api.h('span', { text: label || 'See all' }), api.icon('chevron-right', { size: 12 }));
}

/** Shared pager — the grid and the episode list both page the same way. */
function pager(api, page, pages, go, label) {
  const { h, icon } = api;
  const box = h('div.cx-pages', { role: 'navigation', 'aria-label': label || 'Pages' });
  const jump = n => () => {
    const next = Math.min(Math.max(1, n), pages);
    if (next !== page) go(next);
  };
  const btn = (text, ic, target, o) => {
    const b = h('button', {
      type: 'button',
      disabled: o && o.off ? true : null,
      class: o && o.on ? 'is-on' : null,
      'aria-current': o && o.on ? 'page' : null,
      'aria-label': o && o.aria ? o.aria : null,
      onclick: jump(target),
    });
    if (ic) b.appendChild(icon(ic, { size: 12 }));
    if (text) b.appendChild(h('span', { text }));
    return b;
  };

  const many = pages > 9;
  if (many) box.appendChild(btn('First', null, 1, { off: page === 1, aria: 'First page' }));
  box.appendChild(btn('Prev', 'chevron-left', page - 1, { off: page === 1, aria: 'Previous page' }));

  const span = Math.min(7, pages);
  const first = Math.max(1, Math.min(page - 3, pages - span + 1));
  for (let n = first; n < first + span; n++) {
    box.appendChild(btn(String(n), null, n, { on: n === page, aria: `Page ${n}` }));
  }

  box.appendChild(btn('Next', 'chevron-right', page + 1, { off: page === pages, aria: 'Next page' }));
  if (many) box.appendChild(btn('Last', null, pages, { off: page === pages, aria: 'Last page' }));
  return box;
}

/* ------------------------------------------------------------------ *
 *  poster card — rails, grids and "more like this" all use this
 * ------------------------------------------------------------------ */
function posterCard(ctx, rec, K, opts) {
  const { api, providers, navigate } = ctx;
  const { h, icon } = api;
  const o = opts || {};
  const url = itemUrl(K.kind, rec.id);
  const n = countOf(rec, K);

  const art = h('div.cx-card__art', { style: { '--art': providers.artFor(rec.title, K.kind) } });
  const img = posterImg(api, rec, false);
  if (img) art.appendChild(img);
  if (hasScore(rec)) {
    art.appendChild(h(rec.score >= 9 ? 'div.cx-card__tag.cx-card__tag--hot' : 'div.cx-card__tag',
      icon('star', { fill: true }), h('span', { text: rec.score.toFixed(2) })));
  }
  if (inWatch(api.store, K.kind, rec.id)) {
    art.appendChild(h('div.cxa-card__save', { title: 'In your Watchlist', 'aria-hidden': 'true' },
      icon('bookmark', { fill: true, size: 10 })));
  }
  art.appendChild(h('div.cx-card__mono', { text: rec.title }));
  art.appendChild(h('div.cx-card__play', h('i', icon(K.cardIcon, { fill: K.cardFill }))));

  /* progress is only ever what the user marked, and only when it is real */
  let progLine = '';
  if (o.progress && o.progress.ep > 0) {
    const of = o.progress.of || n || 0;
    progLine = of ? `${K.unitOne} ${nf(o.progress.ep)} of ${nf(of)}`
      : `${K.unitOne} ${nf(o.progress.ep)}`;
    if (of) {
      const pct = Math.max(2, Math.min(100, Math.round((o.progress.ep / of) * 100)));
      art.appendChild(h('div.cxa-card__prog', { 'aria-hidden': 'true' },
        h('u', { style: { width: `${pct}%` } })));
    }
  }

  /* "1 eps" under a film is technically the count and still reads as a
     mistake — a one-part title says what it is instead */
  const count = n ? (n === 1 ? (rec.mediaType || `1 ${K.unit}`) : `${nf(n)} ${K.unit}`) : null;
  const meta = o.meta || progLine
    || [rec.year || null, count].filter(Boolean).join(' · ');

  return h('button.cx-card.cx-card--poster', {
    type: 'button', title: rec.title,
    'aria-label': `${rec.title}${rec.year ? `, ${rec.year}` : ''}`
      + `${hasScore(rec) ? `, scored ${rec.score}` : ''}${progLine ? `, ${progLine}` : ''}`,
    onclick: () => navigate(url),
    oncontextmenu: e => { e.preventDefault(); cardMenu(ctx, rec, K, e); },
  },
    art,
    h('div.cx-card__b',
      h('div.cx-card__t', { text: rec.title }),
      h('div.cx-card__m', h('span', { text: meta || rec.mediaType || K.label }))));
}

function cardMenu(ctx, rec, K, e) {
  const { api, navigate } = ctx;
  const url = itemUrl(K.kind, rec.id);
  const prog = progressOf(api.store, K.kind, rec.id);
  const items = [
    { label: 'Details', icon: 'info', onClick: () => navigate(url) },
    { label: inWatch(api.store, K.kind, rec.id) ? 'Remove from Watchlist' : 'Add to Watchlist',
      icon: 'bookmark', onClick: () => toggleWatch(api, rec, K.kind) },
  ];
  if (prog && prog.ep) {
    items.push({
      label: `Forget progress (${K.unitOne.toLowerCase()} ${nf(prog.ep)})`, icon: 'rotate-ccw',
      onClick: () => setProgress(api, K.kind, rec.id, 0),
    });
  }
  items.push(
    { label: 'Copy link', icon: 'copy', hint: url, onClick: () => copyText(api, url, 'Link') },
    '-',
    { label: 'Search this title', icon: 'search',
      onClick: () => navigate(`static://search?q=${encodeURIComponent(rec.title)}`) });
  api.menu(items, e.clientX, e.clientY);
}

/* ------------------------------------------------------------------ *
 *  buildAnime — home, browse, watchlist and history
 * ------------------------------------------------------------------ */
export function buildAnime(ctx) {
  const { api, providers, navigate } = ctx;
  const { h, icon, fmt } = api;
  const K = kindOf(ctx.mediaKind);
  const BC = providers.bigCatalogue;

  const p = paramsOf(ctx.url);
  const wanted = String(p.view || '').toLowerCase();
  const S = {
    q: String(ctx.query || p.q || ''),
    genre: p.genre || '',
    year: p.year || '',
    status: p.status || '',
    sort: p.sort || 'score',
    page: Math.max(1, parseInt(p.page, 10) || 1),
    view: VIEWS.some(v => v[0] === wanted) ? wanted : '',
    total: 0,
  };
  let bar = null;
  let stopStuck = null;
  let hero = null;                     /* {stop} while the deck is mounted */
  const dynamic = new Map();           /* rails that a store change repaints */
  let shape = '';                      /* which personal rows the home has */
  let subscribed = false;              /* store.sub() is wired once per page */

  const root = h('div.cx.cxa');
  const strip = topStrip(ctx, 'anime');
  root.appendChild(strip);
  const heroSlot = h('div');
  const sentinel = h('div', { 'aria-hidden': 'true', style: { height: '1px' } });
  const barSlot = h('div');
  const body = h('div');
  root.append(heroSlot, sentinel, barSlot, body);
  const life = lifecycle(root);

  /* "/" jumps to the catalogue search, the way a browser find does. The
     listener is on window, so it must stand down unless this page's own
     window is the active one — otherwise it steals the key from whatever
     app the user is actually in. */
  if (typeof window !== 'undefined' && typeof api.on === 'function') {
    life.add(api.on(window, 'keydown', e => {
      if (life.dead || !bar || e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ctx.win && ctx.win.el && !ctx.win.el.classList.contains('is-active')) return;
      if (isTyping(e.target) || !root.isConnected) return;
      e.preventDefault();
      bar.input.focus();
      if (typeof bar.input.select === 'function') bar.input.select();
    }));
  }

  body.appendChild(loadingBlock(api, K));
  start();
  return root;

  /* ---------------- load ---------------- */
  async function start() {
    try {
      await BC.load(K.kind);
      if (life.dead) return;                 /* navigated away mid-fetch */
      if (!BC.SORT_OPTIONS.some(o => o.id === S.sort)) S.sort = 'score';
      S.total = BC.query({ kind: K.kind, perPage: 1 }).total;
      api.clear(heroSlot); api.clear(barSlot); api.clear(body);
      paintHero();
      paintBar();
      paintBody();
      watchStore();
      claimSubtitle(ctx, life, `${nf(S.total)} ${K.label.toLowerCase()} titles`);
    } catch (err) {
      if (life.dead) return;
      api.clear(heroSlot); api.clear(barSlot); api.clear(body);
      body.appendChild(downBlock(api, err, retry));
    }
  }

  function retry() {
    api.clear(body);
    body.appendChild(loadingBlock(api, K));
    start();
  }

  /** Which of the personal rows have anything in them. A row appearing or
      emptying changes the page's shape, so only that needs a full repaint —
      everything else just re-fills the row it belongs to. */
  function homeShape() {
    return [
      continueList(api.store, K.kind).length,
      watchIds(api.store, K.kind).length,
      historyFor(api.store, K.kind).length,
    ].map(n => (n > 0 ? '1' : '0')).join('');
  }

  /** Watchlist, progress and history can change from a card menu, a detail
      page or another window — repaint only what actually reads them.
      A retry runs start() again, so this has to refuse a second subscription
      or every later change would repaint twice. */
  function watchStore() {
    if (subscribed || !api.store || typeof api.store.sub !== 'function') return;
    subscribed = true;
    const bump = fmt.debounce(() => {
      if (life.dead) return;
      if (S.view === 'watchlist' || S.view === 'history') { paintBody(); return; }
      if (inBrowse() || S.view !== '') { syncViews(); return; }
      if (homeShape() !== shape) { paintBody(); syncViews(); return; }
      for (const refresh of dynamic.values()) refresh();
      syncViews();
    }, 120);
    life.add(api.store.sub(WATCH_KEY, bump));
    life.add(api.store.sub(PROG_KEY, bump));
    life.add(api.store.sub(HIST_KEY, bump));
  }

  /* declared as a function, not a const: everything below `return root` is
     only reachable by hoisting, and a const there would stay in its TDZ. */
  function isFiltered() { return !!(S.q || S.genre || S.year || S.status); }
  function inBrowse() { return S.view === 'browse' || (S.view === '' && isFiltered()); }

  /* ---------------- hero deck ---------------- */
  function paintHero() {
    if (hero && hero.stop) hero.stop();
    hero = null;
    api.clear(heroSlot);
    if (S.view !== '' || isFiltered()) return;   /* the library views get the bar, not a hero */

    const live = BC.query({ kind: K.kind, status: K.live, sort: 'score', perPage: HERO_LEN }).items;
    const picks = live.length >= 2 ? live
      : BC.query({ kind: K.kind, sort: 'score', perPage: HERO_LEN }).items;
    if (!picks.length) return;

    const kick = live.length >= 2 ? K.kick : 'HIGHEST RATED IN THE CATALOGUE';
    let at = 0;
    const layer = h('div.cxa-hero__layer');
    const panel = h('div.cxa-hero__in');
    const dots = h('div.cxa-hero__dots', { role: 'group', 'aria-label': 'Featured titles' });

    const show = i => {
      at = ((i % picks.length) + picks.length) % picks.length;
      const rec = picks[at];
      api.render(layer,
        h('div.cx__hero-art.cxa-hero__art', { style: { '--art': providers.artFor(rec.title, K.kind) } },
          posterImg(api, rec, true)));
      api.render(panel, heroPanel(rec, kick));
      [...dots.children].forEach((d, n) => {
        d.classList.toggle('is-on', n === at);
        d.setAttribute('aria-current', n === at ? 'true' : 'false');
      });
    };

    picks.forEach((rec, i) => dots.appendChild(h('button.cxa-hero__dot', {
      type: 'button', 'aria-label': `${rec.title} — featured ${i + 1} of ${picks.length}`,
      onclick: () => { show(i); rest(); },
      onkeydown: e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        show(at + (e.key === 'ArrowRight' ? 1 : -1));
        rest();
        const next = dots.children[at];
        if (next && next.focus) next.focus();
      },
    })));

    const step = d => { show(at + d); rest(); };
    const nav = picks.length > 1 ? h('div.cxa-hero__nav',
      h('button.ibtn', { type: 'button', 'aria-label': 'Previous featured title', onclick: () => step(-1) },
        icon('chevron-left', { size: 14 })),
      h('button.ibtn', { type: 'button', 'aria-label': 'Next featured title', onclick: () => step(1) },
        icon('chevron-right', { size: 14 }))) : null;

    const box = h('div.cx__hero.cxa-hero', layer,
      h('div.cxa-hero__body', panel, picks.length > 1 ? h('div.cxa-hero__rail', dots, nav) : null));
    heroSlot.appendChild(box);
    show(0);

    /* auto-advance, but never while the user is reading or tabbing through it,
       and never at all when motion is turned down */
    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const run = () => {
      stop();
      if (picks.length < 2 || reducedMotion(api)) return;
      timer = setInterval(() => {
        if (life.dead) { stop(); return; }
        if (box.matches(':hover') || box.contains(document.activeElement)) return;
        show(at + 1);
      }, HERO_MS);
    };
    const rest = () => run();
    run();
    hero = { stop };
    life.add(stop);
  }

  function heroPanel(rec, kick) {
    const n = countOf(rec, K);
    const when = [rec.year, seasonOf(rec)].filter(Boolean).join(' · ');
    const chips = [];
    if (hasScore(rec)) {
      chips.push(h('span.chip.chip--accent', icon('star', { fill: true }),
        h('span', { text: `${rec.score.toFixed(2)} / 10` })));
    }
    if (when) chips.push(h('span.chip', icon('calendar'), h('span', { text: when })));
    if (n) chips.push(h('span.chip', icon('layers'), h('span', { text: `${nf(n)} ${K.unitLong.toLowerCase()}` })));
    if (rec.mediaType) chips.push(h('span.chip', icon('film'), h('span', { text: rec.mediaType })));
    for (const g of (rec.genres || []).slice(0, 3)) {
      chips.push(h('button.chip', {
        type: 'button', title: `Browse ${g}`, onclick: () => setFilter({ genre: g }),
      }, h('span', { text: g })));
    }

    const saveBtn = h('button.btn', { type: 'button' });
    const paintSave = () => {
      const on = inWatch(api.store, K.kind, rec.id);
      api.render(saveBtn, icon(on ? 'check' : 'plus'),
        h('span', { text: on ? 'In Watchlist' : 'Watchlist' }));
      saveBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    saveBtn.addEventListener('click', () => { toggleWatch(api, rec, K.kind); paintSave(); });
    paintSave();

    return [
      h('div.cx__hero-kick.cxa-hero__kick', { text: kick }),
      h('h1.cx__hero-t.cxa-hero__t', { text: rec.title }),
      rec.titleJa ? h('div.cxa-hero__ja', { text: rec.titleJa }) : null,
      rec.synopsis ? h('p.cx__hero-s.cxa-hero__s', { text: rec.synopsis }) : null,
      h('div.cx__hero-meta', chips),
      h('div.cx__hero-acts',
        h('button.btn.btn--primary', {
          type: 'button', onclick: () => navigate(itemUrl(K.kind, rec.id)),
        }, icon('info'), h('span', { text: 'Details' })),
        saveBtn,
        h('button.btn', {
          type: 'button', onclick: () => setView('browse'),
        }, icon('grid'), h('span', { text: `Browse all ${nf(S.total)}` }))),
    ];
  }

  /* ---------------- filter bar ---------------- */
  function paintBar() {
    const views = h('div.cx__nav.cxa-views', { role: 'group', 'aria-label': `${K.label} library` });
    const viewBtns = new Map();
    for (const [id, label, ic] of VIEWS) {
      const b = h('button', { type: 'button', onclick: () => setView(id) },
        icon(ic), h('span', { text: label }));
      const tally = h('span.cxa-views__n');
      b.appendChild(tally);
      viewBtns.set(id, { b, tally });
      views.appendChild(b);
    }

    const cats = h('div.cx__cats', { role: 'group', 'aria-label': 'Genres' });
    const catBtns = new Map();
    const cat = (id, label, count) => {
      const b = h('button.cx-cat', {
        type: 'button', 'aria-pressed': 'false',
        onclick: () => setFilter({ genre: id }),
      }, h('span', { text: label }));
      if (count !== null) b.appendChild(h('span', { text: nf(count), style: { opacity: '.6' } }));
      catBtns.set(id, b);
      cats.appendChild(b);
    };
    cat('', 'All', S.total);
    for (const g of BC.genresOf(K.kind).slice(0, GENRE_CHIPS)) cat(g.id, g.name, g.n);

    const input = h('input', {
      type: 'search', spellcheck: 'false', value: S.q,
      placeholder: `Search ${nf(S.total)} ${K.label.toLowerCase()}…`,
      'aria-label': `Search the ${K.label.toLowerCase()} catalogue`,
      oninput: fmt.debounce(() => setFilter({ q: input.value }, true), 140),
      onkeydown: e => {
        if (e.key === 'Escape' && input.value) {
          e.preventDefault(); input.value = ''; setFilter({ q: '' }, true);
        } else if (e.key === 'Enter') {
          e.preventDefault(); setFilter({ q: input.value }, true);
        }
      },
    });
    const find = h('div.field', { style: { flex: '0 1 220px', height: '26px' } }, icon('search'), input);

    const yearSel = h('select.select', {
      'aria-label': 'Filter by year', onchange: e => setFilter({ year: e.target.value }),
    }, h('option', { value: '', text: 'Any year' }),
      BC.yearsOf(K.kind).map(y => h('option', { value: String(y), text: String(y) })));
    yearSel.value = S.year;

    /* picking a sort means "show me the list" — the rails are curated, so they
       ignore sort and the change would otherwise look like a dead control */
    const sortSel = h('select.select', {
      'aria-label': 'Sort', onchange: e => setSort(e.target.value),
    }, BC.SORT_OPTIONS.map(o => h('option', { value: o.id, text: sortLabel(o) })));
    sortSel.value = S.sort;

    const statusSel = K.statuses ? h('select.select', {
      'aria-label': 'Filter by status', onchange: e => setFilter({ status: e.target.value }),
    }, K.statuses.map(([v, label]) => h('option', { value: v, text: label }))) : null;
    if (statusSel) statusSel.value = S.status;

    const reset = h('button.btn.btn--ghost.btn--sm', {
      type: 'button',
      onclick: () => setFilter({ q: '', genre: '', year: '', status: '', sort: 'score' }),
    }, icon('x', { size: 12 }), h('span', { text: 'Reset' }));

    const toggle = h('div.cx__nav', { role: 'group', 'aria-label': 'Catalogue' },
      h('button', {
        type: 'button', class: 'is-on', 'aria-current': 'page',
        onclick: () => navigate(`static://${K.kind}`),
      }, icon(K.icon), h('span', { text: K.label })),
      h('button', {
        type: 'button', onclick: () => navigate(`static://${K.other}`),
      }, icon(K.otherIcon), h('span', { text: K.otherLabel })));

    const el = h('div.cx__bar.cxa-bar',
      views, cats, find, yearSel, sortSel, statusSel, reset, toggle);
    barSlot.appendChild(el);
    /* the strip and the bar are both sticky at top:0 — park the bar under it,
       and give it a backdrop once it gets there */
    const strut = strip.offsetHeight || 0;
    if (strut > 0) el.style.top = `${strut}px`;
    /* a retry repaints the bar: drop the observer still watching the old one */
    if (stopStuck) stopStuck();
    stopStuck = watchStuck(el, sentinel, strut);
    life.add(stopStuck);

    bar = { catBtns, viewBtns, input, yearSel, sortSel, statusSel, reset };
    syncBar();
  }

  function syncBar() {
    if (!bar) return;
    for (const [id, b] of bar.catBtns) {
      const on = id === S.genre;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (bar.input.value !== S.q) bar.input.value = S.q;
    bar.yearSel.value = S.year;
    bar.sortSel.value = S.sort;
    if (bar.statusSel) bar.statusSel.value = S.status;
    bar.reset.classList.toggle('hidden', !isFiltered());
    syncViews();
  }

  function syncViews() {
    if (!bar) return;
    const counts = {
      watchlist: watchIds(api.store, K.kind).length,
      history: historyFor(api.store, K.kind).length,
    };
    const current = inBrowse() ? 'browse' : S.view;
    for (const [id, { b, tally }] of bar.viewBtns) {
      const on = id === current;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
      tally.textContent = counts[id] ? nf(counts[id]) : '';
    }
  }

  function setView(view) {
    if (life.dead) return;
    const next = VIEWS.some(v => v[0] === view) ? view : '';
    if (next === (inBrowse() ? 'browse' : S.view)) { syncViews(); return; }
    S.view = next;
    S.page = 1;
    /* every view but Browse is a list of its own — a filter left over from
       Browse would silently hide half the watchlist, and would keep the home
       page showing a grid when the user just asked for the rails back */
    if (next !== 'browse') { S.q = ''; S.genre = ''; S.year = ''; S.status = ''; }
    syncBar();
    paintHero();
    paintBody();
    scrollUp(root);
  }

  /** Choosing a sort means "show me the list" — the rails are curated and
      ignore it, so the control would otherwise look dead on the home page. */
  function setSort(sort) {
    if (life.dead || !BC.SORT_OPTIONS.some(o => o.id === sort)) return;
    const wasHome = !inBrowse() && S.view === '';
    S.sort = sort;
    S.page = 1;
    S.view = 'browse';
    syncBar();
    if (wasHome) paintHero();
    paintBody();
    scrollUp(root);
  }

  /** The single entry point for filter changes, so state and chrome never drift. */
  function setFilter(patch, keepFocus) {
    /* the search box is debounced, so its last keystroke can land after the
       page is gone — do not re-query 7,963 rows into a detached tree */
    if (life.dead) return;
    /* read before the patch lands: the hero only has to be repainted when
       this change is what moves the page between the rails and the grid */
    const wasBrowse = inBrowse();
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      /* clicking the genre that is already on clears it */
      const next = (k === 'genre' && v && S.genre === v) ? '' : v;
      if (S[k] !== next) { S[k] = next; changed = true; }
    }
    if (isFiltered() && S.view !== 'browse') { S.view = 'browse'; changed = true; }
    if (!changed) return;
    S.page = 1;
    syncBar();
    if (wasBrowse !== inBrowse()) paintHero();
    paintBody();
    if (!keepFocus) scrollUp(root);
  }

  /* ---------------- body ---------------- */
  function paintBody() {
    api.clear(body);
    dynamic.clear();
    if (S.view === 'watchlist') paintWatchlist();
    else if (S.view === 'history') paintHistory();
    else if (inBrowse()) paintGrid();
    else paintHome();
  }

  /* SORT_OPTIONS is shared by both catalogues, so the episode wording has to
     follow the kind — a manga list sorted by "Most episodes" over cards that
     read "953 ch" is just wrong. */
  function sortLabel(o) {
    return o.id === 'episodes' ? `Most ${K.unitLong.toLowerCase()}` : o.name;
  }

  /* ---------------- home ---------------- */
  function paintHome() {
    shape = homeShape();
    const rows = BC.peek(K.kind) || [];
    if (!rows.length) {
      body.appendChild(emptyBlock(api, {
        icon: 'alert', title: 'The catalogue came back empty',
        note: `Nothing to show. Reload, or check data/${K.kind}.json.`,
        action: 'Reload', onAction: retry,
      }));
      return;
    }

    for (const r of homeRails(rows)) {
      const sec = section(api, {
        icon: r.icon, title: r.title, count: r.count, note: r.note,
        tools: r.seeAll ? seeAllBtn(api, r.seeAllLabel, r.seeAll) : null,
      });
      /* the placeholder has to be rail-height, or every row sits at y=0 on the
         first layout, lands inside the observer's margin and mounts at once —
         which is the whole thing lazy mounting exists to avoid */
      const slot = h('div', h('div.cxa-skel-rail', { 'aria-hidden': 'true' }, skelCards(api, 8)));
      sec.appendChild(slot);
      body.appendChild(sec);

      const fill = () => api.render(slot, rail(api, r.cards(), r.title));
      if (r.live) {
        dynamic.set(r.id, () => {
          if (!r.items().length) { sec.remove(); dynamic.delete(r.id); return; }
          fill();
          const tally = sec.querySelector('.cx__sec-n');
          if (tally && r.countOf) tally.textContent = r.countOf();
        });
      }
      /* the first rows are on screen already; everything below waits */
      if (r.eager) fill(); else lazyMount(slot, life, fill);
    }
    body.appendChild(footer());
  }

  /**
   * The home rows, in order. Every one states what it is ranked by, because
   * the catalogue has no play counts, no trend data and no added-at date —
   * only a score, a year, a season and a status.
   */
  function homeRails(rows) {
    const out = [];
    const push = r => out.push(r);
    const cardsOf = (items, opts) => () => items().map(rec => posterCard(ctx, rec, K, opts && opts(rec)));

    /* -- continue -- */
    const contItems = () => {
      const marks = continueList(api.store, K.kind);
      const recs = [];
      for (const m of marks.slice(0, RAIL_LEN)) {
        const rec = BC.byId(m.id, K.kind);
        if (rec) recs.push([rec, m]);
      }
      return recs;
    };
    if (contItems().length) {
      push({
        id: 'continue', icon: 'play', title: `Continue ${K.play.toLowerCase()}ing`,
        note: `${K.unitLong.toLowerCase()} you marked here — nothing is tracked from a player`,
        live: true, eager: true,
        items: () => contItems(),
        countOf: () => plural(contItems().length, 'title'),
        count: plural(contItems().length, 'title'),
        cards: () => contItems().map(([rec, m]) => posterCard(ctx, rec, K, { progress: m })),
      });
    }

    /* -- watchlist -- */
    const wlItems = () => BC.byIds(watchIds(api.store, K.kind), K.kind).slice(0, RAIL_LEN);
    if (wlItems().length) {
      const other = watchOther(api.store, K.kind);
      push({
        id: 'watchlist', icon: 'bookmark', title: 'Your watchlist',
        note: other ? `${plural(other, 'saved title')} from the rest of the portal are not shown here` : '',
        live: true, eager: true,
        items: wlItems,
        countOf: () => plural(watchIds(api.store, K.kind).length, 'title'),
        count: plural(watchIds(api.store, K.kind).length, 'title'),
        cards: cardsOf(wlItems),
        seeAll: () => setView('watchlist'),
      });
    }

    /* -- jump back in -- */
    const histItems = () => {
      const skip = new Set(continueList(api.store, K.kind).map(m => m.id));
      return BC.byIds(historyFor(api.store, K.kind).map(r => r.id).filter(id => !skip.has(id)), K.kind)
        .slice(0, RAIL_LEN);
    };
    if (histItems().length) {
      push({
        id: 'jumpback', icon: 'clock', title: 'Jump back in',
        note: 'titles you opened on this device',
        live: true, eager: true,
        items: histItems, cards: cardsOf(histItems),
        countOf: () => plural(historyFor(api.store, K.kind).length, 'title'),
        count: plural(historyFor(api.store, K.kind).length, 'title'),
        seeAll: () => setView('history'),
      });
    }

    /* -- recently added (a real diff against the last visit) -- */
    const fresh = recentlyAdded(api, BC, K.kind, rows);
    const freshRecs = BC.byIds(fresh.ids, K.kind).slice(0, RAIL_LEN);
    if (freshRecs.length) {
      push({
        id: 'added', icon: 'sparkles', title: 'Recently added',
        note: 'in the catalogue now, and not the last time you opened this page',
        count: plural(fresh.ids.length, 'title'),
        items: () => freshRecs, cards: cardsOf(() => freshRecs),
      });
    }

    /* -- trending: airing now, best scored. No trend data exists. -- */
    const season = K.seasons ? BC.latestSeason(K.kind) : null;
    /* `total`, not items.length: 696 manga are Ongoing and the page only
       holds 400 of them — printing the page size would be a made-up count */
    const airingRes = BC.query({ kind: K.kind, status: K.live, sort: 'score', perPage: 400 });
    const airing = airingRes.items;
    if (airing.length) {
      const trend = season
        ? airing.filter(r => String(r.season).toLowerCase() === season.season && r.year === season.year)
        : [];
      const items = (trend.length >= 6 ? trend : airing).slice(0, RAIL_LEN);
      push({
        id: 'trending', icon: 'trending-up', title: 'Trending now',
        note: trend.length >= 6
          ? `${season.label} releases still ${K.kind === 'manga' ? 'running' : 'airing'}, best score first — the catalogue holds no trend data`
          : `still ${K.kind === 'manga' ? 'running' : 'airing'}, best score first — the catalogue holds no trend data`,
        count: plural(items.length, 'title'),
        items: () => items, cards: cardsOf(() => items),
        seeAll: () => setFilter({ status: K.live, sort: 'score' }),
      });
    }

    /* -- popular: score, and the row says so -- */
    const top = BC.query({ kind: K.kind, sort: 'score', perPage: RAIL_LEN }).items;
    if (top.length) {
      push({
        id: 'popular', icon: 'star', title: 'Popular',
        note: 'ranked by the MyAnimeList score in the data — no view or play counts exist for these titles',
        count: `top ${nf(top.length)} of ${nf(S.total)}`,
        items: () => top, cards: cardsOf(() => top),
        seeAll: () => setFilter({ sort: 'score' }),
      });
    }

    /* -- seasonal -- */
    if (season) {
      const items = BC.seasonal(K.kind, { season: season.season, year: season.year, limit: RAIL_LEN });
      if (items.length) {
        const all = BC.seasonal(K.kind, { season: season.season, year: season.year }).length;
        push({
          id: 'season', icon: 'calendar', title: season.label,
          note: 'the newest season in the catalogue, best score first',
          count: plural(all, 'title'),
          items: () => items, cards: cardsOf(() => items),
          seeAll: () => setFilter({ year: String(season.year), sort: 'score' }),
          seeAllLabel: `All of ${season.year}`,
        });
      }
    }

    /* -- newest -- */
    const newest = BC.query({ kind: K.kind, sort: 'newest', perPage: RAIL_LEN }).items;
    if (newest.length) {
      push({
        id: 'newest', icon: 'zap', title: 'Newest releases',
        note: 'by the release year in the data, not by when they joined the library',
        count: plural(newest.length, 'title'),
        items: () => newest, cards: cardsOf(() => newest),
        seeAll: () => setFilter({ sort: 'newest' }),
      });
    }

    /* -- airing / ongoing, in full -- */
    if (airing.length) {
      push({
        id: 'airing', icon: 'activity', title: K.kind === 'manga' ? 'Ongoing' : 'Airing now',
        note: `status “${K.live}” in the catalogue`,
        count: plural(airingRes.total, 'title'),
        items: () => airing.slice(0, RAIL_LEN), cards: cardsOf(() => airing.slice(0, RAIL_LEN)),
        seeAll: () => setFilter({ status: K.live, sort: 'score' }),
      });
    }

    /* -- one row per genre -- */
    for (const g of BC.topGenres(K.kind, GENRE_RAILS)) {
      const items = BC.query({ kind: K.kind, genre: g.id, sort: 'score', perPage: RAIL_LEN }).items;
      if (!items.length) continue;
      push({
        id: `g-${g.id}`, icon: 'tag', title: g.name,
        note: '', count: plural(g.n, 'title'),
        items: () => items, cards: cardsOf(() => items),
        seeAll: () => setFilter({ genre: g.id, sort: 'score' }),
      });
    }
    return out;
  }

  /** What the library really holds — every number counted off the rows. */
  function footer() {
    const f = BC.facts(K.kind);
    const st = BC.syncStatus(K.kind);
    const bits = [
      `${nf(f.rows)} ${K.label.toLowerCase()} titles indexed`,
      `${nf(f.scored)} with a score`,
      `${nf(f.counted)} with ${K.countKey === 'chapters' ? 'a chapter' : 'an episode'} count`,
      `${nf(f.genres)} genres`,
      f.yearFrom ? `${f.yearFrom}–${f.yearTo}` : null,
    ].filter(Boolean);
    const src = st && st.source === 'remote'
      ? `Synced live from ${hostOf(st.url)}.`
      : `Loaded from the bundled data/${K.kind}.json${st && st.remoteBlocked ? ' — the live sync could not be reached' : ''}.`;
    return h('div.cx__pad.cxa-foot',
      h('div', { text: bits.join(' · ') }),
      h('div.dim', { text: src }));
  }

  /* ---------------- browse grid ---------------- */
  function describe() {
    const bits = [];
    if (S.q) bits.push(`“${S.q}”`);
    if (S.genre) bits.push(S.genre);
    if (S.year) bits.push(S.year);
    if (S.status) bits.push(S.status);
    if (!bits.length) bits.push(`All ${K.label.toLowerCase()}`);
    const sort = BC.SORT_OPTIONS.find(o => o.id === S.sort);
    return { title: bits.join(' · '), sort: sort ? sortLabel(sort) : 'Top rated' };
  }

  function paintGrid() {
    const res = BC.query({
      kind: K.kind, q: S.q, genre: S.genre, year: S.year, status: S.status,
      sort: S.sort, page: S.page, perPage: PER_PAGE,
    });
    S.page = res.page;

    const d = describe();
    const from = res.total ? (res.page - 1) * PER_PAGE + 1 : 0;
    const to = Math.min(res.page * PER_PAGE, res.total);
    const sec = section(api, {
      icon: S.q ? 'search' : 'filter', title: d.title,
      count: res.total ? `${nf(from)}–${nf(to)} of ${nf(res.total)}` : 'no matches',
      tools: h('span.badge', { text: d.sort }),
    });

    if (!res.total) {
      sec.appendChild(emptyBlock(api, {
        icon: 'search', title: 'Nothing matched those filters',
        note: `No ${K.label.toLowerCase()} title in the catalogue matches ${d.title}.`,
        action: 'Clear filters',
        onAction: () => setFilter({ q: '', genre: '', year: '', status: '' }),
      }));
      body.appendChild(sec);
      return;
    }

    sec.appendChild(h('div.cx__grid.cx__grid--poster',
      res.items.map(rec => posterCard(ctx, rec, K))));
    body.appendChild(sec);
    if (res.pages > 1) {
      body.appendChild(pager(api, res.page, res.pages, n => {
        S.page = n;
        paintBody();
        scrollUp(root);
      }));
    }
  }

  /* ---------------- watchlist ---------------- */
  function paintWatchlist() {
    const ids = watchIds(api.store, K.kind);
    const items = BC.byIds(ids, K.kind);
    const missing = ids.length - items.length;
    const other = watchOther(api.store, K.kind);
    const sec = section(api, {
      icon: 'bookmark', title: 'Watchlist',
      count: items.length ? plural(items.length, 'title') : 'empty',
      note: [
        other ? `${plural(other, 'other saved title')} in the portal — films and ${K.otherLabel.toLowerCase()} keep their own rows in the same list` : '',
        missing > 0 ? `${nf(missing)} saved ${missing === 1 ? 'id is' : 'ids are'} no longer in the catalogue` : '',
      ].filter(Boolean).join(' · '),
      tools: items.length ? seeAllBtn(api, 'Browse catalogue', () => setView('browse')) : null,
    });
    if (!items.length) {
      sec.appendChild(emptyBlock(api, {
        icon: 'bookmark', title: 'Nothing saved yet',
        note: `Right-click any poster, or open a title and press Add to Watchlist. `
          + `Your list is kept on this device and shared with the rest of ${BRAND.name}.`,
        action: `Browse ${K.label.toLowerCase()}`, onAction: () => setView('browse'),
      }));
      body.appendChild(sec);
      return;
    }
    sec.appendChild(h('div.cx__grid.cx__grid--poster', items.map(rec =>
      posterCard(ctx, rec, K, { progress: progressOf(api.store, K.kind, rec.id) }))));
    body.appendChild(sec);
  }

  /* ---------------- history ---------------- */
  function paintHistory() {
    const rows = historyFor(api.store, K.kind);
    const sec = section(api, {
      icon: 'clock', title: 'History',
      count: rows.length ? plural(rows.length, 'title') : 'empty',
      note: `The last ${nf(HISTORY_MAX)} titles opened on this device. Nothing leaves it.`,
      tools: rows.length ? h('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        onclick: async () => {
          const ok = await api.confirm({
            title: 'Clear history?',
            message: `This forgets ${plural(rows.length, `${K.label.toLowerCase()} title`)} you opened. Your watchlist is not touched.`,
            ok: 'Clear', danger: true,
          });
          if (ok) { clearHistory(api, K.kind); paintBody(); }
        },
      }, icon('trash', { size: 12 }), h('span', { text: 'Clear' })) : null,
    });

    if (!rows.length) {
      sec.appendChild(emptyBlock(api, {
        icon: 'clock', title: 'No history yet',
        note: 'Titles you open show up here so you can get back to them.',
        action: `Browse ${K.label.toLowerCase()}`, onAction: () => setView('browse'),
      }));
      body.appendChild(sec);
      return;
    }

    const cards = [];
    for (const row of rows) {
      const rec = BC.byId(row.id, K.kind);
      if (!rec) continue;
      const prog = progressOf(api.store, K.kind, rec.id);
      cards.push(posterCard(ctx, rec, K, {
        progress: prog,
        meta: prog && prog.ep ? '' : fmt.fmtAgo(row.at),
      }));
    }
    sec.appendChild(h('div.cx__grid.cx__grid--poster', cards));
    if (cards.length < rows.length) {
      sec.appendChild(h('div.cxa-rail-note', {
        text: `${nf(rows.length - cards.length)} older ${rows.length - cards.length === 1 ? 'entry is' : 'entries are'} `
          + 'no longer in the catalogue and cannot be shown.',
      }));
    }
    body.appendChild(sec);
  }
}

/* ------------------------------------------------------------------ *
 *  buildAnimeDetail — one title
 * ------------------------------------------------------------------ */
export function buildAnimeDetail(ctx) {
  const { api, providers, navigate } = ctx;
  const { h, icon } = api;
  const K = kindOf(ctx.mediaKind);
  const BC = providers.bigCatalogue;
  const id = String(ctx.params || '');

  const root = h('div.cx.cxa');
  root.appendChild(topStrip(ctx, 'anime'));
  const body = h('div');
  root.appendChild(body);
  const life = lifecycle(root);
  let epPage = 1;

  body.appendChild(skeletonDetail());
  start();
  return root;

  function skeletonDetail() {
    return h('div.cxa-det', { 'aria-busy': 'true' },
      h('div.cxa-det__top',
        h('div.cx-skel.cx-skel--poster', { style: { flex: '0 0 190px' } }),
        h('div.cx-detail__in',
          h('div.cx-skel', { style: { height: '30px', width: '58%' } }),
          h('div',
            h('div.cx-skel.cx-skel--line', { style: { width: '30%' } }),
            h('div.cx-skel.cx-skel--line', { style: { width: '88%' } }),
            h('div.cx-skel.cx-skel--line', { style: { width: '82%' } }),
            h('div.cx-skel.cx-skel--line', { style: { width: '54%' } })),
          h('div.row', h('div.spinner'),
            h('small.dim', { text: `Loading the ${K.label.toLowerCase()} catalogue…` })))));
  }

  async function start() {
    try {
      await BC.load(K.kind);
      if (life.dead) return;                 /* navigated away mid-fetch */
      const rec = BC.byId(id, K.kind);
      api.clear(body);
      if (rec) paint(rec);
      else body.appendChild(notFound());
    } catch (err) {
      if (life.dead) return;
      api.clear(body);
      body.appendChild(downBlock(api, err, () => {
        api.clear(body);
        body.appendChild(skeletonDetail());
        start();
      }));
    }
  }

  function notFound() {
    return emptyBlock(api, {
      icon: 'alert', title: 'Title not found',
      note: `No ${K.label.toLowerCase()} record with id “${id}” is in the catalogue.`,
      action: `Browse ${K.label.toLowerCase()}`, onAction: () => navigate(`static://${K.kind}`),
    });
  }

  /* ---------------- the record ---------------- */
  function paint(rec) {
    const url = itemUrl(K.kind, rec.id);
    const n = countOf(rec, K);
    const live = rec.status === K.live;

    pushHistory(api, rec, K.kind);

    /* every manga row's mediaType IS "Manga", so printing the catalogue label
       after it would read "2012 · Manga · Manga" */
    claimSubtitle(ctx, life, [rec.year, rec.mediaType,
      rec.mediaType === K.label ? null : K.label].filter(Boolean).join(' · '));

    /* --- art --- */
    const art = h('div.cx-detail__art.cxa-det__art', {
      style: { '--art': providers.artFor(rec.title, K.kind), position: 'relative' },
    });
    const img = posterImg(api, rec, false);
    if (img) art.appendChild(img);

    /* the hero wash behind everything is the same artwork, blurred — the
       catalogue ships one image per title, never a separate backdrop */
    const wash = h('div.cxa-det__bg', { 'aria-hidden': 'true',
      style: { '--art': providers.artFor(rec.title, K.kind) } });
    const washImg = posterImg(api, rec, true);
    if (washImg) wash.appendChild(washImg);

    /* --- meta --- */
    const meta = h('div.cx-detail__meta');
    if (hasScore(rec)) {
      meta.appendChild(h('span.badge.badge--accent',
        icon('star', { fill: true, size: 10 }), h('span', { text: `${rec.score.toFixed(2)} / 10` })));
    }
    const when = [rec.year, seasonOf(rec)].filter(Boolean).join(' · ');
    if (when) meta.appendChild(h('span.chip', icon('calendar'), h('span', { text: when })));
    if (n) {
      meta.appendChild(h('span.chip', icon('layers'),
        h('span', { text: `${nf(n)} ${K.unitLong.toLowerCase()}` })));
    }
    if (rec.status) {
      meta.appendChild(h(live ? 'span.badge.badge--ok' : 'span.badge',
        icon(live ? 'activity' : 'check', { size: 10 }), h('span', { text: rec.status })));
    }
    if (rec.rating) {
      meta.appendChild(h('span.chip', { title: rec.rating },
        icon('shield'), h('span', { text: cap(shortRating(rec.rating)) })));
    }
    if (rec.mediaType) meta.appendChild(h('span.chip', icon('film'), h('span', { text: rec.mediaType })));
    for (const g of rec.genres || []) {
      meta.appendChild(h('button.chip.chip--accent', {
        type: 'button', title: `Browse ${g}`,
        onclick: () => navigate(listUrl(K.kind, { genre: g })),
      }, h('span', { text: g })));
    }

    /* --- actions --- */
    /* the grid and the play button follow the player box, and the store
       (Static Watch can mark or move on too) */
    let eps = null;
    const playBtn = h('button.btn.btn--primary', { type: 'button' });
    const changed = () => { paintPlay(); if (eps) eps.draw(); };
    const stage = buildStage(rec, n, changed);
    const watchBtn = h('button.btn', { type: 'button' });
    const paintWatch = () => {
      const on = inWatch(api.store, K.kind, rec.id);
      api.render(watchBtn, icon(on ? 'check' : 'bookmark', { fill: on }),
        h('span', { text: on ? 'In Watchlist' : 'Add to Watchlist' }));
      watchBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    watchBtn.addEventListener('click', () => { toggleWatch(api, rec, K.kind); paintWatch(); });
    paintWatch();

    const toStage = () => {
      stage.box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (stage.reason) {
        api.notify({ app: BRAND.name, icon: 'cast', title: 'No player connected', message: stage.reason });
      }
    };

    /* "Watch" becomes "Continue episode 5" / "Resume episode 5 · 12:04" /
       "Play episode 6" once there is a place to pick up from */
    function paintPlay() {
      const w = whereLeftOff(api.store, K.kind, rec.id);
      const unit = K.unitOne.toLowerCase();
      const text = !w ? K.play
        : w.how === 'player' ? `Resume ${unit} ${nf(w.ep)} · ${clockText(w.t)}`
          : w.how === 'opened' ? `Continue ${unit} ${nf(w.ep)}`
            : `Play ${unit} ${nf(w.ep)}`;
      api.render(playBtn, icon(K.playIcon, { fill: K.cardFill }), h('span', { text }));
      playBtn.dataset.ep = w ? String(w.ep) : '';
    }
    playBtn.addEventListener('click', () => {
      const w = whereLeftOff(api.store, K.kind, rec.id);
      stage.open(w ? w.ep : stage.cur, { t: w && w.how === 'player' ? w.t : null });
      toStage();
    });
    paintPlay();

    const acts = h('div.cx-detail__acts',
      playBtn,
      watchBtn,
      h('button.btn', { type: 'button', onclick: () => copyText(api, url, 'Link') },
        icon('copy'), h('span', { text: 'Copy link' })),
      (rec.genres || [])[0] ? h('button.btn', {
        type: 'button', onclick: () => navigate(listUrl(K.kind, { genre: rec.genres[0] })),
      }, icon('grid'), h('span', { text: `More ${rec.genres[0]}` })) : null);

    /* --- facts: only what the record actually carries --- */
    const stat = (k, v, d, small) => h('div.stat',
      h('div.stat__v', { text: v, style: small ? { fontSize: 'var(--fs-13)' } : null }),
      h('div.stat__k', { text: k }),
      d ? h('div.stat__d', { text: d }) : null);

    const facts = h('div.cx-detail__facts');
    if (hasScore(rec)) facts.appendChild(stat('Score', rec.score.toFixed(2), 'out of 10'));
    if (n) facts.appendChild(stat(K.unitLong, nf(n)));
    if (rec.year) facts.appendChild(stat('Year', String(rec.year)));
    if (seasonOf(rec)) facts.appendChild(stat('Season', seasonOf(rec), null, true));
    if (rec.status) facts.appendChild(stat('Status', rec.status, null, true));
    if (rec.mediaType) facts.appendChild(stat('Type', rec.mediaType, null, true));
    if (rec.genres && rec.genres.length) {
      facts.appendChild(stat('Genres', String(rec.genres.length), rec.genres.join(' · '), true));
    }

    const syn = rec.synopsis
      ? h('p.cx-detail__syn.cxa-det__syn', { text: rec.synopsis })
      : h('p.cx-detail__syn.dim', { text: 'No synopsis is on file for this title.' });
    const synBox = h('div.cxa-det__synbox', syn);
    if (rec.synopsis && rec.synopsis.length > 420) {
      const more = h('button.btn.btn--ghost.btn--sm', { type: 'button', 'aria-expanded': 'false' },
        icon('chevron-down', { size: 12 }), h('span', { text: 'Read more' }));
      more.addEventListener('click', () => {
        const open = syn.classList.toggle('is-open');
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
        api.render(more, icon(open ? 'chevron-up' : 'chevron-down', { size: 12 }),
          h('span', { text: open ? 'Read less' : 'Read more' }));
      });
      synBox.appendChild(more);
    }

    body.appendChild(h('div.cxa-det', wash,
      h('div.cxa-det__top', art,
        h('div.cx-detail__in',
          h('div.cxa-det__kick', { text: [K.label, rec.mediaType === K.label ? null : rec.mediaType]
            .filter(Boolean).join(' · ') }),
          h('h1.cx-detail__t', { text: rec.title }),
          rec.titleJa ? h('div.cxa-det__ja', { text: rec.titleJa }) : null,
          meta, synBox, acts, facts))));

    eps = episodes(rec, n, stage, toStage);
    if (eps) body.appendChild(eps.sec);
    body.appendChild(stage.el);
    /* the store can change under this page (Static Watch, another window) */
    let seenKey = '';
    const onStore = () => {
      paintPlay();                 /* cheap; the label carries the minute */
      const pr = progressOf(api.store, K.kind, rec.id);
      const key = JSON.stringify([pr && pr.ep, whereLeftOff(api.store, K.kind, rec.id)?.ep, stage.cur]);
      if (key === seenKey) return;
      seenKey = key;
      if (eps) eps.draw();
      stage.paintCtl();
    };
    life.add(api.store.sub(PROG_KEY, onStore));
    life.add(api.store.sub(RESUME_KEY, onStore));
    /* arrived from "Continue" or "Next episode" in Static Watch: open that one */
    const want = epParam(ctx.url);
    if (want) {
      const w = whereLeftOff(api.store, K.kind, rec.id);
      stage.open(want, { t: w && w.how === 'player' && w.ep === want ? w.t : null });
      nextFrame(() => { if (!life.dead) stage.el.scrollIntoView({ block: 'start' }); });
    }
    const rel = relatedSection(rec);
    if (rel) body.appendChild(rel);
    const sim = similarSection(rec);
    if (sim) body.appendChild(sim);
  }

  /* ---------------- episodes ----------------
     The catalogue carries a count and nothing else — no per-episode titles,
     no air dates — so the list is numbered and says exactly that. Picking
     one opens it in the player box below and remembers it as the place you
     left off; marking one watched is its own button there. */
  function episodes(rec, n, stage, toStage) {
    if (!n || n < 1) return null;
    const pages = Math.max(1, Math.ceil(n / EP_PAGE));
    const slot = h('div');
    const headNote = h('div.cxa-sec__note');
    const unit = K.unitOne.toLowerCase();
    const forget = h('button.btn.btn--ghost.btn--sm.hidden', {
      type: 'button',
      onclick: () => {
        setProgress(api, K.kind, rec.id, 0);
        setResume(api, K.kind, rec.id, null);
        draw();
      },
    }, icon('rotate-ccw', { size: 12 }), h('span', { text: 'Forget progress' }));
    const sec = section(api, {
      icon: 'list', title: K.unitLong,
      count: `${nf(n)} listed`,
      tools: forget,
    });
    sec.appendChild(headNote);
    sec.appendChild(slot);
    let followed = 0;

    const draw = () => {
      const prog = progressOf(api.store, K.kind, rec.id);
      const done = prog && prog.ep ? prog.ep : 0;
      const now = stage.shown ? stage.cur : 0;
      const had = slot.contains(document.activeElement) ? document.activeElement.dataset.ep : null;
      forget.classList.toggle('hidden', !done && !resumeOf(api.store, K.kind, rec.id));
      headNote.textContent = (done
        ? `${done === 1 ? `${K.unitOne} 1 is` : `${K.unitLong} 1–${nf(done)} are`} marked ${K.watched.toLowerCase()}. `
        : `${nf(n)} ${K.unitLong.toLowerCase()} in the catalogue. `)
        + 'Pick one to open it in the player below — StaticOS remembers it as where you left off. '
        + `The catalogue lists no ${unit} titles or air dates, so these are numbers only.`;
      /* follow the player onto its page whenever it moves to another episode */
      if (pages > 1 && now && now !== followed) { followed = now; epPage = Math.ceil(now / EP_PAGE); }
      if (pages > 1) epPage = Math.min(Math.max(1, epPage), pages);
      const first = (epPage - 1) * EP_PAGE + 1;
      const last = Math.min(n, epPage * EP_PAGE);
      const grid = h('div.cxa-eps');
      for (let i = first; i <= last; i++) {
        const seen = i <= done;
        const here = i === now;
        grid.appendChild(h('button.cxa-ep', {
          type: 'button',
          class: [seen ? 'is-done' : '', here ? 'is-now' : ''].filter(Boolean).join(' ') || null,
          'aria-current': here ? 'true' : null,
          dataset: { ep: String(i) },
          'aria-label': `${K.unitOne} ${i} of ${nf(n)}${seen ? `, marked ${K.watched.toLowerCase()}` : ''}${here ? ', in the player' : ''}`,
          onclick: () => {
            const w = whereLeftOff(api.store, K.kind, rec.id);
            stage.open(i, { t: w && w.how === 'player' && w.ep === i ? w.t : null });
            toStage();
          },
        }, here ? icon(K.playIcon, { size: 10, fill: K.cardFill }) : null,
        h('span.cxa-ep__n', { text: String(i) }),
        seen ? icon('check', { size: 11 }) : null));
      }
      api.render(slot, grid, pages > 1
        ? pager(api, epPage, pages, p => { epPage = p; draw(); }, `${K.unitLong} pages`)
        : null);
      if (had) slot.querySelector(`[data-ep="${had}"]`)?.focus({ preventScroll: true });
    };
    draw();
    return { sec, draw };
  }

  /* ---------------- the playback stage ----------------
     One episode at a time. Opening one records it in portal.anime.resume
     (src 'opened'). If the embedded player posts its clock to this page —
     some do, most don't — the second it reached is kept too (src
     'player'), every few seconds and whenever it pauses, seeks or ends; an
     episode the player says has ended is marked watched. Nothing is
     guessed: with no report, the episode is all that is claimed, and the
     line under the player says so. */
  function buildStage(rec, n, onChange) {
    const unit = K.unitOne.toLowerCase();
    const box = h('div.cx-stage__box', { style: { '--art': providers.artFor(rec.title, K.kind) } });
    const epText = h('span.cxa-stage__ep');
    const prevBtn = h('button.ibtn.tip', {
      type: 'button', 'data-tip': `Previous ${unit}`, 'aria-label': `Previous ${unit}`,
      onclick: () => out.open(out.cur - 1),
    }, icon('skip-back', { size: 14 }));
    const nextBtn = h('button.btn.btn--sm.cxa-stage__next', { type: 'button', onclick: () => next() },
      h('span', { text: `Next ${unit}` }), icon('skip-forward', { size: 12 }));
    const markBtn = h('button.btn.btn--sm.btn--ghost.cxa-stage__mark', { type: 'button', onclick: () => toggleMark() });
    const status = h('div.cxa-stage__status', { role: 'status' });
    const el = h('div.cx-stage.cxa-stage',
      h('div.cx-stage__top',
        icon('cast', { size: 14 }),
        h('div.cx-stage__t', { text: `${K.play} ${rec.title}` }),
        epText,
        h('div.grow'),
        h('div.cxa-stage__ctl', prevBtn, nextBtn, markBtn),
        h('span.badge.mono', { text: `${K.kind}:${rec.id}` })),
      box,
      h('div.cx-stage__bar', status));

    const clampEp = e => Math.max(1, n ? Math.min(n, Math.floor(e) || 1) : Math.floor(e) || 1);
    const w0 = whereLeftOff(api.store, K.kind, rec.id);
    const out = {
      el, box, reason: '',
      cur: clampEp(w0 ? w0.ep : 1),
      shown: !!w0,                 /* has an episode been opened (or is one remembered)? */
      open, paintCtl,
    };
    let frame = null, res = null, gen = 0, statusT = 0;
    const clock = { got: false, t: null, d: null, lastT: null, lastWrite: 0, finished: false, wanted: null };

    function open(ep, { t = null, record = true } = {}) {
      const e = clampEp(ep);
      const reuse = e === out.cur && !!frame && !t;
      flush();
      out.cur = e;
      out.shown = true;
      if (record) {
        const prev = resumeOf(api.store, K.kind, rec.id);
        const keep = prev && prev.ep === e && prev.src === 'player' && !atEnd(prev.t, prev.d)
          ? { src: 'player', t: prev.t, ...(prev.d ? { d: prev.d } : {}) } : { src: 'opened' };
        setResume(api, K.kind, rec.id, { ep: e, of: n || 0, ...keep });
      }
      if (!reuse) attach(t);
      paintCtl();
      paintStatus();
      if (onChange) onChange();
    }

    function markWatched(ep) {
      const p = progressOf(api.store, K.kind, rec.id);
      if (!p || Number(p.ep) < ep) setProgress(api, K.kind, rec.id, ep, n);
    }
    function next() {
      if (n && out.cur >= n) return;
      markWatched(out.cur);
      open(out.cur + 1);
    }
    function toggleMark() {
      const p = progressOf(api.store, K.kind, rec.id);
      const marked = !!p && Number(p.ep) >= out.cur;
      setProgress(api, K.kind, rec.id, marked ? out.cur - 1 : out.cur, n);
      paintCtl();
      if (onChange) onChange();
    }

    function paintCtl() {
      epText.textContent = `${K.unitOne} ${nf(out.cur)}${n ? ` of ${nf(n)}` : ''}`;
      prevBtn.disabled = out.cur <= 1;
      nextBtn.disabled = !!n && out.cur >= n;
      const p = progressOf(api.store, K.kind, rec.id);
      const marked = !!p && Number(p.ep) >= out.cur;
      markBtn.setAttribute('aria-pressed', marked ? 'true' : 'false');
      api.render(markBtn, icon(marked ? 'check-circle' : 'check', { size: 12 }),
        h('span', { text: marked ? K.watched : `Mark ${K.watched.toLowerCase()}` }));
      markBtn.setAttribute('aria-label', marked
        ? `${K.unitOne} ${out.cur} is marked ${K.watched.toLowerCase()} — unmark it`
        : `Mark ${unit} ${out.cur} ${K.watched.toLowerCase()}`);
    }

    function paintStatus() {
      clearTimeout(statusT);
      statusT = 0;
      const lines = [];
      if (res && res.kind === 'embed') {
        if (clock.got && clock.t !== null) {
          lines.push(clock.finished
            ? `${K.unitOne} ${nf(out.cur)} finished — marked ${K.watched.toLowerCase()}.`
            : `Saving your place as you watch: ${clockText(clock.t)}${clock.d ? ` of ${clockText(clock.d)}` : ''}.`);
        } else {
          if (clock.wanted && res.takesStart) lines.push(`Starting at ${clockText(clock.wanted)}, where you left off.`);
          else if (clock.wanted) lines.push(`Last time you got to ${clockText(clock.wanted)}. This player can’t be told where to start, so skip ahead to it.`);
          lines.push(`This player hasn’t reported its position, so StaticOS remembers the ${unit} you opened — not the minute.`);
        }
        if (!res.takesEpisode && out.cur > 1) lines.push(`This source plays one link per title, so it can’t be told to open ${unit} ${nf(out.cur)}.`);
      } else if (res) {
        lines.push(out.shown
          ? `Nothing plays here yet, but StaticOS remembers that you opened ${unit} ${nf(out.cur)}.`
          : `Pick ${/^[aeiou]/i.test(unit) ? 'an' : 'a'} ${unit} and StaticOS remembers it as where you left off.`);
      }
      status.textContent = lines.join(' ');
    }
    const paintStatusSoon = () => { if (!statusT) statusT = setTimeout(() => { if (!life.dead) paintStatus(); }, 400); };

    function save() {
      if (clock.t === null) return;
      clock.lastWrite = Date.now();
      clock.lastT = clock.t;
      setResume(api, K.kind, rec.id, {
        ep: out.cur, of: n || 0, src: 'player', t: Math.round(clock.t * 10) / 10,
        ...(clock.d ? { d: Math.round(clock.d * 10) / 10 } : {}),
      });
    }
    function flush() { if (clock.got && clock.t !== null && clock.t !== clock.lastT) save(); }

    /* the player's own clock, if it posts one — only from this box's frame */
    const onMsg = e => {
      if (!frame || e.source !== frame.contentWindow) return;
      const c = readPlayerClock(e.data);
      if (!c) return;
      const first = !clock.got;
      clock.got = true;
      if (c.t !== null) clock.t = c.t;
      if (c.d) clock.d = c.d;
      if (!clock.finished && (c.ended || atEnd(clock.t, clock.d))) {
        clock.finished = true;
        markWatched(out.cur);
        paintCtl();
        if (onChange) onChange();
      }
      const jumped = clock.lastT !== null && clock.t !== null && Math.abs(clock.t - clock.lastT) > 30;
      if (first || c.ended || c.paused || jumped || Date.now() - clock.lastWrite >= RESUME_EVERY) save();
      if (first || c.ended) paintStatus(); else paintStatusSoon();
    };
    window.addEventListener('message', onMsg);
    life.add(() => {
      window.removeEventListener('message', onMsg);
      clearTimeout(statusT);
      flush();
    });

    async function attach(start) {
      const my = ++gen;
      frame = null;
      res = null;
      Object.assign(clock, { got: false, t: null, d: null, lastT: null, lastWrite: 0, finished: false, wanted: start || null });
      api.render(box, h('div.cx-stage__note', h('div.spinner'),
        h('small', { text: 'Looking for a source…' })));
      let r;
      try {
        r = await providers.resolve(`${K.kind}:${rec.id}`, { episode: out.cur, start: start || 0 });
      } catch (err) {
        if (life.dead || my !== gen) return;
        api.render(box, downBlock(api, err, () => attach(start), {
          title: 'Source lookup failed',
          hint: 'The catalogue is loaded — it is providers.resolve() that could not answer.',
        }));
        return;
      }
      if (life.dead || my !== gen) return;
      res = r || { kind: 'unavailable' };
      if (r && r.kind === 'embed' && r.url) {
        out.reason = '';
        frame = h('iframe.cx-stage__frame', {
          src: r.url, title: `${rec.title} — ${K.unitOne} ${out.cur}`, allowfullscreen: true,
          referrerpolicy: 'no-referrer', allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
        });
        api.render(box, frame);
      } else {
        out.reason = (r && r.reason) || 'No source is connected for this title.';
        api.render(box, stageNote(rec, r, out.reason));
      }
      paintStatus();
    }
    attach(w0 && w0.how === 'player' ? w0.t : null);
    paintCtl();
    return out;
  }

  /** The dead end, turned into the thing a developer actually needs. */
  function stageNote(rec, res, reason) {
    const ids = (res && res.ids) || {};
    const rows = [];
    for (const [label, key] of ID_FIELDS) {
      const v = ids[key];
      if (v === null || v === undefined || v === '') continue;
      if (key === 'mal' && K.kind === 'manga') continue;        /* a manga's "mal" id is its MangaDex uuid */
      if (key === 'mangadex' && K.kind === 'anime') continue;
      rows.push([label, String(v)]);
    }

    const table = h('table.table',
      h('thead', h('tr',
        h('th', { text: 'Record' }), h('th', { text: 'Id' }), h('th', { text: '' }))),
      h('tbody', rows.map(([label, v]) => h('tr',
        h('td', h('span.dim', { text: label })),
        h('td', h('span.mono', { text: v })),
        h('td', { style: { textAlign: 'right', width: '34px' } },
          h('button.ibtn.tip', {
            type: 'button', 'data-tip': `Copy ${label} id`, 'aria-label': `Copy ${label} id`,
            onclick: () => copyText(api, v, `${label} id`),
          }, icon('copy', { size: 13 })))))));

    return h('div.cx-stage__note',
      icon('cast'),
      h('b', { text: 'No player connected' }),
      h('small', { text: reason }),
      rows.length ? h('div', { style: { width: '100%', textAlign: 'left' } },
        h('div.label', { text: 'External ids', style: { marginBottom: 'var(--sp-2)' } }),
        table) : null,
      h('div.mono', {
        style: { fontSize: 'var(--fs-10)', color: 'var(--ink-3)', lineHeight: '1.6' },
        text: `providers.resolve('${K.kind}:${rec.id}') is the one seam to implement — `
            + 'return {kind:"embed", url} from it and this box becomes the player.',
      }));
  }

  /* ---------------- related + similar ---------------- */
  function relatedSection(rec) {
    const items = BC.related(rec, K.kind, RAIL_LEN);
    if (!items.length) return null;
    const sec = section(api, {
      icon: 'layers', title: 'Related titles',
      count: `${nf(items.length)} ${items.length === 1 ? 'entry' : 'entries'}`,
      note: 'other entries that share this name — seasons, films and specials. '
        + 'The catalogue has no relation field, so these are matched on the title itself.',
    });
    sec.appendChild(rail(api, items.map(r => posterCard(ctx, r, K, {
      meta: [r.year || null, r.mediaType || null].filter(Boolean).join(' · '),
    })), 'Related titles'));
    return sec;
  }

  function similarSection(rec) {
    const items = BC.similar(rec, K.kind, RAIL_LEN);
    if (!items.length) return null;
    const genres = (rec.genres || []).slice(0, 3).join(', ');
    const sec = section(api, {
      icon: 'sparkles', title: 'More like this',
      count: plural(items.length, 'title'),
      note: genres ? `closest by genre (${genres}), then by score` : 'closest by genre, then by score',
      tools: (rec.genres || [])[0]
        ? seeAllBtn(api, `All ${rec.genres[0]}`, () => navigate(listUrl(K.kind, { genre: rec.genres[0] })))
        : null,
    });
    sec.appendChild(rail(api, items.map(r => posterCard(ctx, r, K)), 'More like this'));
    sec.style.paddingBottom = 'var(--sp-7)';
    return sec;
  }
}

export default { buildAnime, buildAnimeDetail };
