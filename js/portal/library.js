/* ============================================================
   library.js — static://library — the Static Library.

   One personal library for everything you play, save and make on
   this device. It invents nothing: every row on every page is read
   from state another part of StaticOS already keeps, resolved
   through the same data modules those apps use.

     Continue Playing   plays.js (last 14 days) · projects edited ·
                        portal.anime.progress (episodes you marked)
     Recently Played    plays.js, plus portal.games.recent rows from
                        before plays.js existed · portal.roblox.recent ·
                        portal.cloud.played
     Favorites          portal.games.favs · portal.roblox.favs · portal.cloud.favs
     History            plays.js — the last launch of each game, by day
     Collections        js/core/collections.js (portal.collections)
     Watchlist          portal.watchlist ("kind:id" tokens, shared
                        with Static Anime and Movies)
     Music & Links      portal.spotify · portal.browser.marks · proxy.marks
     Created Games      projects.js (IndexedDB)
     Published          projects with `published` set
     Clips              db.kv('clips') — Static Replay clips
     Achievements       achievements.list() with this device's stats
     (no Followed Creators: that needs accounts on a server, which
      StaticOS has none of, so the section is not shown at all)

   ROUTES
     static://library                    overview
     static://library/<section>          one section
     static://library/collections/<id>   one collection
     static://library/clips/<clipId>     the Clips page, with that clip playing
   Sections are real URLs so the window's Back button walks them.

   Anything opened from here goes to the app that owns it
   (collections.openItem): web games to Static Games, Arcade games to
   the Arcade, creations to Forge, anime to Static Anime, Roblox to
   Static Roblox. An app missing from this build gets a note, never a
   dead click. Nothing here counts players, shows friends or invents
   dates — StaticOS has no server to know them.
   ============================================================ */

import { BRAND, u } from './brand.js';
import * as C from '../core/collections.js';
import * as plays from '../core/plays.js';
import * as ST from '../core/screentime.js';
import * as shortcuts from '../core/shortcuts.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-library-css')) {
  const l = document.createElement('link');
  l.id = 'feat-library-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-library.css';
  document.head.appendChild(l);
}

const NAV = [
  ['home',    'Home',    'static://home',    'home'],
  ['games',   'Games',   'static://games',   'gamepad'],
  ['roblox',  'Roblox',  'static://roblox',  'box'],
  ['anime',   'Anime',   'static://anime',   'star'],
  ['library', 'Library', 'static://library', 'heart'],
  ['search',  'Search',  'static://search',  'search'],
];

const SECTIONS = [
  { id: '',             label: 'Overview',          icon: 'home' },
  { group: 'Play' },
  { id: 'continue',     label: 'Continue Playing',  icon: 'play' },
  { id: 'recent',       label: 'Recently Played',   icon: 'clock' },
  { id: 'favorites',    label: 'Favorites',         icon: 'heart' },
  { id: 'history',      label: 'History',           icon: 'list' },
  { group: 'Saved' },
  { id: 'collections',  label: 'Collections',       icon: 'layers' },
  { id: 'watchlist',    label: 'Watchlist',         icon: 'bookmark' },
  { id: 'saved',        label: 'Music & Links',     icon: 'music' },
  { group: 'Made by you' },
  { id: 'created',      label: 'Created Games',     icon: 'sparkles' },
  { id: 'published',    label: 'Published',         icon: 'upload' },
  { id: 'clips',        label: 'Clips',             icon: 'film' },
  { group: 'Progress' },
  { id: 'achievements', label: 'Achievements',      icon: 'star' },
];
const SECTION_IDS = new Set(SECTIONS.filter(s => !s.group).map(s => s.id));
const sectionOf = id => SECTIONS.find(s => !s.group && s.id === id) || SECTIONS[0];

const DAY = 86400000;
const CONTINUE_WINDOW = 14 * DAY;
const QUIET_AFTER = 14 * DAY;       /* "Finish this": unfinished and untouched this long */

const FAV_SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'az', label: 'A to Z' },
  { id: 'played', label: 'Most played here' },
  { id: 'recent', label: 'Played lately' },
];
const FAV_GROUPS = [
  { id: 'none', label: 'No groups' },
  { id: 'category', label: 'By category' },
  { id: 'studio', label: 'By studio' },
];

const arr = v => (Array.isArray(v) ? v : []);
const num = n => Number(n || 0).toLocaleString();
const plural = (n, word, many = `${word}s`) => `${num(n)} ${n === 1 ? word : many}`;
const hueOf = s => { let x = 7; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x % 360; };
const dateText = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const urlOf = (sec = '', id = '') => u(`library${sec ? `/${sec}` : ''}${id ? `/${encodeURIComponent(id)}` : ''}`);
const reduced = store => !!store.get('prefs.reduceMotion') || (() => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
})();

/* ---------------- lazily loaded data modules (shared across builds) ---------------- */
const once = fn => { let p = null; return () => (p || (p = fn())); };
let gamesLoaded = null;      /* the games module once its catalogue is in memory (for category names) */
const gamesMod    = once(() => import('./games.data.js').then(m => m.load().then(() => (gamesLoaded = m))).catch(() => null));
const robloxMod   = once(() => import('./roblox.data.js').then(m => m.load().then(() => m)).catch(() => null));
const animeMod    = once(() => import('./anime.data.js').catch(() => null));
const arcadeMod   = once(() => import('../arcade/index.js').then(m => arr(m.ARCADE || m.default)).catch(() => []));
const projectsMod = once(() => import('../core/projects.js').catch(() => null));
const achMod      = once(() => import('../core/achievements.js').catch(() => null));
const dbMod       = once(() => import('../core/db.js').catch(() => null));
const moviesMod   = once(() => import('./catalog.js').then(m => arr(m.MOVIES)).catch(() => []));

async function animeData(kind) {
  const m = await animeMod();
  if (!m) return null;
  try { await m.load(kind); return m; } catch (e) { return null; }
}
/** projects, or null when storage could not be read (so nothing is called "deleted" by mistake) */
async function projectListOrNull() {
  const P = await projectsMod();
  if (!P) return null;
  try { return arr(await P.list()); } catch (e) { return null; }
}
const projectList = async () => (await projectListOrNull()) || [];
/** { clips: playable clips newest first, broken: stored rows with no video } */
async function clipList() {
  const D = await dbMod();
  if (!D) return { clips: [], broken: [], failed: true };
  try {
    const s = D.kv('clips');
    /* getAllKeys and getAll come back in the same key order, so zipping
       them gives each clip the exact key it is stored under */
    const [keys, vals] = await Promise.all([s.keys(), s.all()]);
    const rows = vals.map((v, i) => (v && typeof v === 'object' ? { ...v, _key: keys[i] } : { _key: keys[i] }));
    const ok = v => typeof Blob !== 'undefined' && v.blob instanceof Blob && v.blob.size > 0;
    return {
      clips: rows.filter(ok).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0)),
      broken: rows.filter(v => !ok(v)).map(v => v._key),
    };
  } catch (e) { return { clips: [], broken: [], failed: true }; }
}
async function clipCount() {
  return (await clipList()).clips.length;
}
const playStats = () => ({ distinct: plays.count(), total: plays.total() });

/* ---------------- the shared top strip ---------------- */
function topStrip(ctx, current) {
  const { api, navigate } = ctx;
  const { h, icon } = api;
  const input = h('input', { type: 'search', placeholder: `Search ${BRAND.name}`, spellcheck: 'false',
    'aria-label': `Search ${BRAND.name}` });
  const find = h('form.field.cx__find', {
    onsubmit: e => { e.preventDefault(); const q = input.value.trim(); if (q) navigate(`static://search?q=${encodeURIComponent(q)}`); },
  }, icon('search'), input);
  const nav = h('div.cx__nav', { role: 'navigation', 'aria-label': BRAND.name },
    NAV.map(([id, label, url, ic]) => h(id === current ? 'button.is-on' : 'button', {
      type: 'button', 'aria-current': id === current ? 'page' : null, 'aria-label': label,
      onclick: () => navigate(url),
    }, icon(ic), h('span', { text: label }))));
  return h('div.cx__top', h('div.cx__mark', icon(BRAND.icon), h('span', { text: BRAND.wordmark })), find, nav);
}

function parseRoute(url) {
  const path = String(url || '').replace(/^[a-z]+:\/\//i, '').split(/[?#]/)[0].split('/').filter(Boolean);
  const sec = SECTION_IDS.has(path[1] || '') ? (path[1] || '') : '';
  let sub = null;
  if ((sec === 'collections' || sec === 'clips') && path[2]) { try { sub = decodeURIComponent(path[2]); } catch (e) { sub = path[2]; } }
  return { section: sec, colId: sec === 'collections' ? sub : null, clipId: sec === 'clips' ? sub : null };
}

/* focus the sidebar entry the user picked, across the rebuild navigate() causes */
let focusSideNext = null;
/* the filter box follows you from section to section for a few minutes */
let carriedFilter = { q: '', at: 0 };
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/* every kind of card the filter looks at, and where its title is */
const FILTERABLE = [
  ['.libx-card', '.libx-card__t'], ['.libx-cont', '.libx-cont__t'], ['.libx-col:not(.is-new)', '.libx-col__t'],
  ['.libx-add__row', 'b'], ['.libx-pub', 'h3'], ['.libx-clip', '.libx-clip__t b'], ['.libx-ach', 'b'], ['.libx-fin', '.libx-fin__t'],
];
const FILTER_ALL = FILTERABLE.map(f => f[0]).join(',');
let focusMainNext = false;

/* ============================================================ */
export function buildLibrary(ctx) {
  const { api, navigate } = ctx;
  const { h, icon, store } = api;
  const route = parseRoute(ctx.url);

  const root = h('div.cx.libx-root');
  let dead = false;
  const life = [];
  /* disposables that belong to the page currently on screen (rail
     observers): released when a live refresh replaces that page, so a
     long session of refreshes never piles them up */
  let pageLife = [], nextLife = [];
  const disposeAll = list => { for (const f of list.splice(0)) { try { f(); } catch (e) { /* keep going */ } } };
  root.cherriTeardown = () => {
    if (dead) return;
    dead = true;
    disposeAll(nextLife);
    disposeAll(pageLife);
    disposeAll(life);
  };
  root.appendChild(topStrip(ctx, 'library'));

  const side = h('nav.libx-side', { 'aria-label': 'Library sections' });
  const main = h('div.libx-main', { role: 'region', 'aria-label': sectionOf(route.section).label });
  root.appendChild(h('div.libx', side, main));

  /* per-page view state that survives a live refresh */
  const VIEW_KEY = 'portal.library.view';       /* { favSort, favGroup }: how Favorites is sorted and grouped */
  const savedView = store.get(VIEW_KEY, null) || {};
  const view = { recentKind: 'all', colKind: 'all', addTab: 'recent', histQ: '',
    q: Date.now() - carriedFilter.at < 5 * 60_000 ? carriedFilter.q : '',
    favSort: FAV_SORTS.some(s => s.id === savedView.favSort) ? savedView.favSort : 'newest',
    favGroup: FAV_GROUPS.some(s => s.id === savedView.favGroup) ? savedView.favGroup : 'none' };

  /* one filter box for every section: it hides cards whose title does not
     contain the words, and any shelf left with nothing to show */
  const filterIn = h('input', { type: 'search', placeholder: 'Filter this page', value: view.q, spellcheck: 'false', autocomplete: 'off',
    'aria-label': 'Filter this page by title', dataset: { fk: 'libfilter' } });
  const filterCount = h('small.libx-find__n', { 'aria-live': 'polite' });
  const filterEl = h('label.field.libx-find.libx-find--all', icon('search'), filterIn, filterCount);
  filterIn.addEventListener('input', () => { view.q = filterIn.value; carriedFilter = { q: view.q, at: Date.now() }; applyFilter(); });
  filterIn.addEventListener('keydown', e => { if (e.key === 'Escape' && filterIn.value) { e.stopPropagation(); filterIn.value = ''; filterIn.dispatchEvent(new Event('input')); } });
  function applyFilter() {
    if (dead) return;
    const needle = fold(view.q.trim());
    let total = 0, shown = 0;
    for (const [item, ttl] of FILTERABLE) {
      for (const el of main.querySelectorAll(item)) {
        const hit = !needle || fold(el.querySelector(ttl)?.textContent).includes(needle);
        el.classList.toggle('is-filtered', !hit);
        total++;
        if (hit) shown++;
      }
    }
    for (const g of main.querySelectorAll('.libx-grp, .libx-colitems')) {
      const its = g.querySelectorAll(FILTER_ALL);
      g.classList.toggle('is-filtered', !!needle && its.length > 0 && [...its].every(i => i.classList.contains('is-filtered')));
    }
    const msg = needle ? (shown ? `${shown} of ${total}` : 'no matches') : '';
    if (filterCount.textContent !== msg) filterCount.textContent = msg;     /* a write that changes nothing would still wake the observer */
  }
  const filterWatch = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (view.q) applyFilter(); }) : null;
  filterWatch?.observe(main, { childList: true, subtree: true });
  life.push(() => filterWatch?.disconnect());

  let counts = {};
  /* clip key -> { url, sig }: a live refresh reuses the object URL of a clip
     that has not changed, so thumbnails do not flash and nothing is revoked
     while it is on screen */
  const clipUrls = new Map();
  let wantFk = null;          /* focus this control after the next live refresh */
  let focusHeading = false;   /* focus the page heading after the first paint */
  /* static://library/clips/<id> opens that clip's player once, on the first paint */
  let clipToOpen = route.clipId;
  /* a category's name, once the catalogue is in memory (the id, capitalised, until then) */
  const catLabel = c => { try { if (gamesLoaded) return gamesLoaded.catMeta(c).name; } catch (e) { /* fall back */ } return String(c).charAt(0).toUpperCase() + String(c).slice(1); };
  let arcadeMap = new Map();
  let projMap = new Map();
  let projKnown = false;      /* projMap holds the real list (not a failed read) */
  /* once you scroll the pill strip yourself, it stays where you put it */
  let sideTouched = false;
  side.addEventListener('pointerdown', () => { sideTouched = true; }, { passive: true });
  side.addEventListener('wheel', () => { sideTouched = true; }, { passive: true });

  focusHeading = focusMainNext;
  focusMainNext = false;
  paintSide();
  paintMain(false);
  refreshCounts();

  /* live: anything the page shows can change underneath it */
  let refreshT = 0;
  /* A repaint can nudge the scroller (a shorter page clamps it), and the
     shell closes an open menu on any scroll — so while a context menu is
     open (say, the one you are picking a collection from) the repaint
     waits for it to close instead of yanking it away. */
  const menuOpen = () => [...document.querySelectorAll('body .menu')].some(m => m.getClientRects().length);
  const run = () => {
    if (dead) return;
    if (menuOpen()) { refreshT = setTimeout(run, 250); return; }
    refreshCounts();
    paintMain(true);
  };
  const soon = () => { clearTimeout(refreshT); refreshT = setTimeout(run, 70); };
  for (const k of [C.KEY, 'portal.games.favs', 'portal.watchlist', 'portal.achievements', 'portal.play', 'portal.anime.progress', 'portal.anime.status',
    'portal.roblox.favs', 'portal.roblox.recent', 'portal.cloud.favs', 'portal.cloud.played', 'portal.spotify', 'portal.browser.marks', 'proxy.marks']) {
    life.push(store.sub(k, soon));
  }
  life.push(api.bus.on('projects:change', soon));
  /* the Arcade emits this after it saves or deletes a clip (and so do we).
     Only the Clips page and the sidebar badge show clips; any other page
     just gets its count refreshed, so nothing else re-lays out. */
  let clipsT = 0;
  life.push(api.bus.on('clips:change', () => {
    clearTimeout(clipsT);
    clipsT = setTimeout(() => { if (dead) return; if (route.section === 'clips') soon(); else refreshCounts(); }, 60);
  }));
  life.push(() => clearTimeout(refreshT), () => clearTimeout(clipsT));
  life.push(() => { for (const v of clipUrls.values()) URL.revokeObjectURL(v.url); clipUrls.clear(); });

  /* the sidebar sticks under the top strip; cap it to what is visible */
  const fitSide = () => {
    const sc = scroller();
    const top = root.querySelector('.cx__top');
    if (!sc) return;
    const th = top ? top.offsetHeight : 0;
    side.style.setProperty('--libx-top', `${th}px`);
    side.style.setProperty('--libx-side-max', `${Math.max(200, sc.clientHeight - th)}px`);
  };
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(fitSide);
    requestAnimationFrame(() => { const sc = scroller(); if (sc && !dead) { ro.observe(sc); fitSide(); } });
    life.push(() => ro.disconnect());
  }

  return root;

  /* ============================================================
     chrome: sidebar, scrolling, focus
     ============================================================ */
  function scroller() {
    let n = root.parentElement;
    while (n && n !== document.body) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight >= n.clientHeight) return n;
      n = n.parentElement;
    }
    return null;
  }

  function go(sec, id) {
    if (id) focusMainNext = true; else focusSideNext = sec;
    navigate(urlOf(sec, id));
  }

  /* Built once per page. Live refreshes only touch the count badges, so a
     refresh never moves focus, re-lays out the list or scrolls anything —
     the shell closes an open menu on any scroll. */
  function paintSide() {
    const btns = [];
    const kids = SECTIONS.map(s => {
      if (s.group) return h('div.libx-side__g', { text: s.group, 'aria-hidden': 'true' });
      const on = s.id === route.section;
      const b = h('button.libx-side__b', {
        type: 'button', class: on ? 'is-on' : null, 'aria-current': on ? 'page' : null,
        /* one tab stop for the whole list (the current section); the arrow
           keys walk it, so Tab goes straight on to the page */
        tabindex: on ? '0' : '-1',
        dataset: { sec: s.id || 'overview' },
        onclick: () => go(s.id),
      }, icon(s.icon), h('span.libx-side__l', { text: s.label }), h('span.libx-side__n.hidden', { dataset: { n: s.id } }));
      btns.push(b);
      return b;
    });
    /* arrow keys walk the list, as in any sidebar */
    side.onkeydown = e => {
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % btns.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = btns.length - 1;
      if (j < 0) return;
      e.preventDefault();
      btns.forEach((b, k) => { b.tabIndex = k === j ? 0 : -1; });
      btns[j].focus();
    };
    /* leaving the list resets the tab stop to the current section */
    side.onfocusout = e => {
      if (side.contains(e.relatedTarget)) return;
      btns.forEach(b => { b.tabIndex = b.classList.contains('is-on') ? 0 : -1; });
    };
    api.render(side, ...kids);
    const want = focusSideNext !== null ? (focusSideNext || 'overview') : null;
    focusSideNext = null;
    requestAnimationFrame(centerSide);
    /* this runs while the page is being built, before the portal host has
       attached it — a focus() now would land on a detached node and be
       lost. The host attaches it in the same task, so a microtask is enough. */
    if (want) queueMicrotask(() => { if (!dead) side.querySelector(`[data-sec="${want}"]`)?.focus({ preventScroll: true }); });
  }

  /* bring the current entry into view inside the list itself (the pill
     strip scrolls sideways in a narrow window) — never the page. Run again
     once the count badges land, since they widen the pills before it. */
  function centerSide() {
    const cur = side.querySelector('.libx-side__b.is-on');
    if (dead || !cur || sideTouched) return;
    if (side.scrollWidth > side.clientWidth + 2) side.scrollLeft = Math.max(0, cur.offsetLeft - (side.clientWidth - cur.offsetWidth) / 2);
    else if (side.scrollHeight > side.clientHeight + 2) side.scrollTop = Math.max(0, cur.offsetTop - (side.clientHeight - cur.offsetHeight) / 2);
  }

  function setCounts() {
    for (const el of side.querySelectorAll('.libx-side__n')) {
      const n = counts[el.dataset.n];
      const show = n !== undefined && n !== null && n !== '';
      el.textContent = show ? String(n) : '';
      el.classList.toggle('hidden', !show);
    }
    requestAnimationFrame(centerSide);
  }

  async function refreshCounts() {
    const my = (refreshCounts.seq = (refreshCounts.seq || 0) + 1);
    const favN = arr(store.get('portal.games.favs')).length + arr(store.get('portal.roblox.favs')).length + arr(store.get('portal.cloud.favs')).length;
    const watchN = arr(store.get('portal.watchlist')).filter(x => typeof x === 'string').length;
    const savedN = arr(store.get('portal.spotify')).length + marks().length;
    const [projs, clipsN, A] = await Promise.all([projectList(), clipCount(), achMod()]);
    /* two refreshes can overlap (a store change and a clip save); only the
       newest one may write the badges */
    if (dead || my !== refreshCounts.seq) return;
    const ach = A ? A.list(playStats()) : [];
    counts = {
      favorites: favN || '', collections: C.list().length || '', watchlist: watchN || '', saved: savedN || '',
      created: projs.length || '', published: projs.filter(p => p.published).length || '', clips: clipsN || '',
      achievements: ach.length ? `${ach.filter(a => a.unlocked).length}/${ach.length}` : '',
    };
    setCounts();
  }

  async function paintMain(keep) {
    const my = (paintMain.seq = (paintMain.seq || 0) + 1);
    if (!keep) api.render(main, skeleton());
    let node;
    /* anything the build registers lands in a fresh list; a build that
       loses the race (a newer paint started) releases its own */
    const mine = nextLife = [];
    try {
      node = await renderSection();
    } catch (err) {
      console.error('[library]', err);
      node = h('div.libx-page', empty('alert', 'This part of the Library failed to load',
        String((err && err.message) || err), [btn('Try again', 'refresh', () => paintMain(false))]));
    }
    if (dead || my !== paintMain.seq) { disposeAll(mine); return; }
    disposeAll(pageLife);
    pageLife = mine;
    /* what the person is looking at is read now, just before the swap —
       not before the (async) build, or a scroll made meanwhile is undone */
    const sc = scroller();
    const top = keep && sc ? sc.scrollTop : 0;
    const fk = keep && main.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
    /* inner scrollers (a rail, the add list) keep their place too */
    const inner = keep ? [...main.querySelectorAll('[data-sk]')].map(n => [n.dataset.sk, n.scrollLeft, n.scrollTop]) : [];
    /* a live refresh replaces the page in place: no entrance animation */
    if (keep) node.classList.add('is-live');
    api.render(main, node);
    for (const [k, l, t] of inner) {
      const n = main.querySelector(`[data-sk="${CSS.escape(k)}"]`);
      if (n) { n.scrollLeft = l; n.scrollTop = t; }
    }
    if (keep && sc && sc.scrollTop !== top) sc.scrollTop = top;
    applyFilter();
    const asked = wantFk;
    const want = asked || fk;
    wantFk = null;
    const target = want ? main.querySelector(`[data-fk="${CSS.escape(want)}"]`) : null;
    if (target) target.focus({ preventScroll: !asked });
    else if (focusHeading) {
      focusHeading = false;
      const h1 = main.querySelector('h1');
      if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
    }
  }

  function renderSection() {
    switch (route.section) {
      case 'continue': return pageContinue();
      case 'recent': return pageRecent();
      case 'favorites': return pageFavorites();
      case 'history': return pageHistory();
      case 'collections': return route.colId ? pageCollection(route.colId) : pageCollections();
      case 'watchlist': return pageWatchlist();
      case 'saved': return pageSaved();
      case 'created': return pageCreated();
      case 'published': return pagePublished();
      case 'clips': return pageClips();
      case 'achievements': return pageAchievements();
      default: return pageOverview();
    }
  }

  /* ============================================================
     small building blocks
     ============================================================ */
  function btn(label, ic, onclick, cls = '', extra = {}) {
    return h(`button.btn${cls}`, { type: 'button', onclick, ...extra }, ic ? icon(ic) : null, h('span', { text: label }));
  }

  function skeleton() {
    return h('div.libx-page.libx-skel', { 'aria-busy': 'true', 'aria-label': 'Loading' },
      h('div.libx-skel__h'), h('div.libx-skel__s'),
      h('div.libx-grid', Array.from({ length: 8 }, () => h('div.libx-skel__c'))));
  }

  function head({ title, sub, tools, kicker, ic }) {
    const s = sectionOf(route.section);
    return h('header.libx-head',
      h('div.libx-head__txt',
        h('div.libx-head__k', icon(ic || s.icon), h('span', { text: kicker || 'Library' })),
        h('h1.libx-head__t', { text: title || s.label }),
        sub ? h('p.libx-head__s', { text: sub }) : null),
      h('div.libx-head__tools', route.section === 'history' ? null : filterEl, tools));
  }

  function group(title, ic, count, content, tools) {
    return h('section.libx-grp',
      h('div.libx-grp__h', icon(ic), h('h2', { text: title }),
        count !== null && count !== undefined ? h('span.libx-grp__n', { text: String(count) }) : null,
        h('div.grow'), tools || null),
      content);
  }

  function empty(ic, title, note, actions = []) {
    return h('div.libx-empty',
      h('div.libx-empty__ic', icon(ic)),
      h('b', { text: title }),
      note ? h('p', { text: note }) : null,
      actions.length ? h('div.libx-empty__acts', actions) : null);
  }

  function note(text, ic = 'info') {
    return h('p.libx-note', icon(ic), h('span', { text }));
  }

  function hasApp(id) { return typeof api.getApp === 'function' ? !!api.getApp(id) : false; }

  /** a row of filter chips; re-styles itself in place so focus stays put */
  function chips(options, get, set, label) {
    const btns = options.map(o => h('button.libx-chip', {
      type: 'button', dataset: { fk: `chip:${label}:${o.id}` },
      onclick: () => { set(o.id); sync(); },
    }, o.icon ? icon(o.icon) : null, h('span', { text: o.label }),
      o.n !== undefined ? h('small', { text: String(o.n) }) : null));
    function sync() {
      btns.forEach((b, i) => {
        const on = options[i].id === get();
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    sync();
    return h('div.libx-chips', { role: 'group', 'aria-label': label }, btns);
  }

  /* ---------- items: one display shape for every kind ---------- */
  async function ensureMaps({ arcade = true, projects = true } = {}) {
    const [A, P] = await Promise.all([arcade ? arcadeMod() : [], projects ? projectListOrNull() : null]);
    if (arcade) arcadeMap = new Map(A.map(a => [a.id, a]));
    if (projects) { projMap = new Map((P || []).map(p => [p.id, p])); projKnown = !!P; }
  }

  /** item {kind,id,title,art} -> entry with the extras a card needs */
  function entry(it, extra = {}) {
    const meta = C.KIND_META[it.kind] || C.KIND_META.web;
    let hue = null, ic = meta.icon, art = it.art || null, title = it.title || it.id;
    if (it.kind === 'arcade') {
      const a = arcadeMap.get(it.id);
      if (a) { hue = a.hue; ic = a.icon || ic; title = a.title || title; }
    }
    let gone = false;
    if (it.kind === 'creation') {
      const p = projMap.get(it.id);
      if (p) { title = p.name || title; if (p.published && p.published.thumbnail) art = p.published.thumbnail; }
      else gone = projKnown;
    }
    return { kind: it.kind, id: String(it.id), title, art, hue, ic, meta, at: it.at || null, gone, ...extra };
  }

  function verb(e) {
    return e.kind === 'web' || e.kind === 'arcade' ? 'Play' : e.kind === 'creation' ? 'Open in Forge' : 'Open';
  }

  function fillArt(el, e, big = false) {
    const fallback = () => h('div.libx-tile', { style: { '--h': String(e.hue ?? hueOf(e.id)) } },
      icon(e.ic || e.meta.icon, { size: big ? 34 : 24 }));
    if (e.art) {
      el.appendChild(h('img', {
        src: e.art, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false',
        onerror: ev => { ev.target.replaceWith(fallback()); },
      }));
    } else {
      el.appendChild(fallback());
    }
  }

  function openEntry(e) {
    if (typeof e.open === 'function') { e.open(); return; }
    if (e.gone) {
      api.notify({ app: 'Library', icon: 'alert', title: `“${e.title}” is not on this device any more`,
        message: 'The creation was deleted, or this browser cleared its storage. Its place in your collections is all that is left.' });
      return;
    }
    C.openItem(api, e);
  }

  function menuFor(e, x, y, opts = {}, el = null) {
    const items = [
      { label: verb(e), icon: e.kind === 'creation' ? 'external-link' : 'play', onClick: () => openEntry(e) },
      e.kind === 'creation' && !e.gone ? { label: 'Play here', icon: 'gamepad', onClick: () => playCreation(e.id) } : null,
      '-',
      C.KINDS.includes(e.kind) ? { label: 'Add to collection…', icon: 'bookmark', onClick: () => C.pickMenu(api, e, x, y) } : null,
      ...(opts.extraMenu ? opts.extraMenu(e) : []),
      opts.onRemove ? '-' : null,
      opts.onRemove ? { label: opts.removeLabel || 'Remove', icon: 'trash', danger: true, onClick: () => { focusAfterRemoving(el); opts.onRemove(e); } } : null,
    ].filter(Boolean);
    while (items[items.length - 1] === '-') items.pop();
    api.menu(items, x, y);
  }

  /* A card is about to leave the page: once the page repaints, the keyboard
     goes to the card that takes its place (the next one, else the one before),
     else to the page heading — never to <body>. */
  function focusAfterRemoving(el) {
    const sib = el && (el.nextElementSibling || el.previousElementSibling);
    const go = sib && (sib.querySelector('[data-fk^="go:"],[data-fk^="col:"]') || sib.querySelector('[data-fk]'));
    if (go) wantFk = go.dataset.fk; else focusHeading = true;
  }

  /* api.confirm: the shell's sheet does not hand focus back when it closes,
     so put it back where it was (a cancelled delete must not strand the
     keyboard on <body>) */
  async function confirmKeep(opts) {
    const was = document.activeElement;
    const yes = await api.confirm(opts);
    if (!dead && (!document.activeElement || document.activeElement === document.body) && was && was.isConnected) was.focus({ preventScroll: true });
    return yes;
  }

  /**
   * A library card. opts: { sub, poster, progress:{ep,of,unit}, onRemove,
   * removeLabel, extraMenu(e), fav, playHere }
   */
  function card(e, opts = {}) {
    const key = `${e.kind}:${e.id}`;
    const art = h('div.libx-card__art');
    fillArt(art, e);
    art.appendChild(h('span.libx-kind', icon(e.meta.icon), h('span', { text: e.meta.short })));
    if (opts.fav) art.appendChild(h('span.libx-card__fav', { 'aria-hidden': 'true' }, icon('heart', { fill: true })));
    const badge = opts.badge || (e.gone ? { label: 'Deleted', icon: 'alert' } : null);
    if (badge) art.appendChild(h('span.libx-badge', { class: badge.accent ? 'is-accent' : null }, icon(badge.icon), h('span', { text: badge.label })));
    if (opts.progress && opts.progress.of) {
      const pct = Math.max(4, Math.min(100, Math.round((opts.progress.ep / opts.progress.of) * 100)));
      art.appendChild(h('div.libx-prog', { 'aria-hidden': 'true' }, h('i', { style: { width: `${pct}%` } })));
    }
    const sub = opts.sub !== undefined ? opts.sub : e.meta.label;
    const label = `${verb(e)} ${e.title}${sub ? ` — ${sub}` : ''}`;
    let el = null;
    const goBtn = h('button.libx-card__go', {
      type: 'button', 'aria-label': label, dataset: { fk: `go:${key}` },
      onclick: () => openEntry(e),
      oncontextmenu: ev => { ev.preventDefault(); menuFor(e, ev.clientX, ev.clientY, opts, el); },
    });
    const more = h('button.libx-card__more', {
      type: 'button', 'aria-label': `More for ${e.title}`, 'aria-haspopup': 'menu', dataset: { fk: `more:${key}` },
      onclick: () => { const r = more.getBoundingClientRect(); menuFor(e, r.left, r.bottom + 4, opts, el); },
    }, icon('more-horizontal'));
    /* sits inside the art box so it lines up with the picture; it stacks
       above the card-wide button because the art box makes no stacking context */
    if (opts.playHere) {
      art.appendChild(h('button.libx-card__play', {
        type: 'button', 'aria-label': `Play ${e.title} here`, dataset: { fk: `play:${key}` },
        onclick: () => playCreation(e.id),
      }, icon('play', { fill: true })));
    }
    el = h('div.libx-card', { class: [opts.poster && 'is-poster', e.gone && 'is-gone'].filter(Boolean).join(' ') || null },
      art,
      h('div.libx-card__b',
        h('div.libx-card__t', { text: e.title }),
        sub ? h('div.libx-card__m', { text: sub }) : null),
      goBtn, more);
    return el;
  }

  function grid(entries, opts = {}, cls = '') {
    return h(`div.libx-grid${cls}`, entries.map(e => card(e, typeof opts === 'function' ? opts(e) : opts)));
  }

  /** a horizontal rail with its own scroll buttons */
  function rail(entries, opts = {}, key = '') {
    const track = h('div.libx-rail__track', { dataset: key ? { sk: `rail:${key}` } : {} },
      entries.map(e => card(e, typeof opts === 'function' ? opts(e) : opts)));
    const prev = h('button.ibtn.libx-rail__nav', { type: 'button', 'aria-label': 'Scroll left', onclick: () => nudge(-1) }, icon('chevron-left'));
    const next = h('button.ibtn.libx-rail__nav', { type: 'button', 'aria-label': 'Scroll right', onclick: () => nudge(1) }, icon('chevron-right'));
    function nudge(d) {
      track.scrollBy({ left: d * Math.max(200, track.clientWidth * 0.8), behavior: reduced(store) ? 'auto' : 'smooth' });
    }
    function sync() {
      const max = track.scrollWidth - track.clientWidth - 2;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
      const hide = max <= 0;
      prev.classList.toggle('hidden', hide);
      next.classList.toggle('hidden', hide);
    }
    track.addEventListener('scroll', sync, { passive: true });
    requestAnimationFrame(sync);
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(sync);
      ro.observe(track);
      nextLife.push(() => ro.disconnect());
    }
    return { el: track, nav: h('div.libx-rail__btns', prev, next) };
  }

  function railGroup(title, ic, entries, seeAll, opts) {
    const r = rail(entries, opts, title);
    return group(title, ic, null, r.el, h('div.libx-grp__tools', r.nav,
      seeAll ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: seeAll },
        h('span', { text: 'See all' }), icon('chevron-right')) : null));
  }

  /* ---------- overlays: the clip player and "play here" ---------- */
  function overlay({ title, sub, actions = [], mount, hint = '' }) {
    const winBody = ctx.win && ctx.win.el ? ctx.win.el.querySelector('.win__body') : null;
    const host = winBody || document.body;
    const prev = document.activeElement;
    /* the page under the player can repaint while it is open (playing a
       creation records a play), replacing the button that opened it — so
       remember which control it was, not just the node */
    const prevFk = prev && prev.dataset ? prev.dataset.fk || null : null;
    const stage = h('div.libx-ov__stage');
    const closeBtn = h('button.ibtn.libx-ov__x', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x'));
    const focusables = () => [...box.querySelectorAll('button:not([disabled]),a[href],video[controls],iframe')].filter(n => n.getClientRects().length);
    /* A game in an iframe owns the keyboard, so our Tab handler never sees a
       Tab pressed inside it: tabbing past its last control would walk out to
       the page behind. These two guards catch that and send focus around. */
    const guard = end => h('span.libx-ov__guard', { tabindex: '0', 'aria-hidden': 'true',
      onfocus: () => { const f = focusables(); (end ? f[0] : f[f.length - 1])?.focus({ preventScroll: true }); } });
    const box = h('div.libx-ov', { class: winBody ? null : 'is-fixed', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      guard(false),
      h('div.libx-ov__card',
        h('div.libx-ov__bar',
          h('div.libx-ov__t', h('b', { text: title }), sub ? h('small', { text: sub }) : null),
          hint ? h('small.libx-ov__hint', { text: hint }) : null,
          h('div.libx-ov__acts', actions), closeBtn),
        stage),
      guard(true));
    let stop = null, closed = false;
    const onKey = ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      /* aria-modal: Tab walks the player's own controls, never the page behind.
         A running game (an iframe) keeps its own keys, so only act when focus
         is on our side of it. */
      if (ev.key !== 'Tab' || !box.isConnected) return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (!box.contains(at)) { ev.preventDefault(); first.focus({ preventScroll: true }); }
      else if (ev.shiftKey && at === first) { ev.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus({ preventScroll: true }); }
    };
    function close() {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onKey, true);
      try { stop?.(); } catch (err) { /* already gone */ }
      box.remove();
      const i = life.indexOf(close);
      if (i >= 0) life.splice(i, 1);
      if (dead) return;
      const back = prev && prev.isConnected ? prev
        : prevFk ? main.querySelector(`[data-fk="${CSS.escape(prevFk)}"]`) : null;
      if (back) back.focus({ preventScroll: true });
      else {
        const h1 = main.querySelector('h1');
        if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
      }
    }
    host.appendChild(box);
    window.addEventListener('keydown', onKey, true);
    life.push(close);
    stop = mount(stage, close);
    closeBtn.focus({ preventScroll: true });
    return close;
  }

  async function playCreation(pid) {
    const P = await projectsMod();
    const p = P ? await P.get(pid).catch(() => null) : null;
    if (dead) return;
    if (!p) { api.notify({ app: 'Library', icon: 'alert', title: 'That creation is gone', message: 'It was deleted, or this browser cleared its storage.' }); return; }
    const html = P.current(p);
    if (!String(html || '').trim()) {
      api.notify({ app: 'Library', icon: 'info', title: `${p.name} has nothing to play yet`, message: 'Open it in Forge to build a first version.' });
      return;
    }
    let S;
    try { S = await import('../core/sandbox.js'); } catch (err) { S = null; }
    if (!S || dead) return;
    overlay({
      title: p.name, sub: `Version ${p.head + 1} of ${p.versions.length} · runs sandboxed, offline`,
      /* the game keeps the keyboard (Esc is often its pause key), so say how out */
      hint: 'Esc goes to the game · ✕ or Shift+Tab to leave',
      actions: hasApp('forge') ? [btn('Open in Forge', 'external-link', () => api.openApp('forge', { project: p.id }), '.btn--sm')] : [],
      mount: stage => {
        stage.classList.add('is-game');
        const r = S.run(stage, html, { title: p.name });
        setTimeout(() => r.focus?.(), 60);
        return () => r.stop();
      },
    });
    plays.record({ kind: 'creation', id: p.id, title: p.name, art: null });
  }

  /* ============================================================
     shared data readers
     ============================================================ */
  function marks() {
    const all = [...arr(store.get('portal.browser.marks')), ...arr(store.get('proxy.marks'))].filter(m => m && typeof m.url === 'string');
    const seen = new Set();
    return all.filter(m => !seen.has(m.url) && seen.add(m.url));
  }

  /** every launch this device knows, newest first, one row per game */
  async function playedRows() {
    const rows = plays.recent(80).map(r => ({ kind: r.kind, id: r.id, title: r.title, art: r.art, at: Number(r.at) || 0 }));
    const seen = new Set(rows.map(r => `${r.kind}:${r.id}`));
    const older = arr(store.get('portal.games.recent')).filter(r => r && typeof r.id === 'string' && !seen.has(`web:${r.id}`));
    if (older.length) {
      const G = await gamesMod();
      for (const r of older) {
        const g = G && G.byId(r.id);
        if (!g) continue;
        rows.push({ kind: 'web', id: g.id, title: g.title, art: g.art || null, at: Number(r.at) || 0 });
        seen.add(`web:${g.id}`);
      }
    }
    return rows.sort((a, b) => b.at - a.at);
  }

  async function favoriteGames() {
    const ids = arr(store.get('portal.games.favs')).filter(x => typeof x === 'string');
    if (!ids.length) return [];
    const G = await gamesMod();
    if (!G) return [];
    return ids.map(id => G.byId(id)).filter(Boolean)
      .map(g => entry({ kind: 'web', id: g.id, title: g.title, art: g.art || null }, { studio: g.studio || '' }));
  }

  function unfavGame(e) {
    const cur = arr(store.get('portal.games.favs'));
    store.set('portal.games.favs', cur.filter(x => x !== e.id));
    api.notify({ app: 'Library', icon: 'heart', title: 'Removed from favourites', message: e.title, timeout: 3000 });
  }

  async function robloxRows(key) {
    const ids = arr(store.get(key)).map(String);
    if (!ids.length) return [];
    const RB = await robloxMod();
    if (!RB) return [];
    return ids.map(id => RB.byId(id)).filter(Boolean)
      .map(r => entry({ kind: 'roblox', id: r.id, title: r.name, art: r.art || null }, { creator: r.creator || '' }));
  }

  function cloudRows(key) {
    return arr(store.get(key)).filter(r => r && typeof r.id === 'string')
      .map(r => entry({ kind: 'cloud', id: r.id, title: r.title || r.id, art: r.art || null, at: r.at || null }, { year: r.year || null }));
  }

  /** watchlist tokens resolved: [{ entry, kind:'anime'|'manga'|'movie', progress }] */
  async function watchRows() {
    const toks = arr(store.get('portal.watchlist')).filter(x => typeof x === 'string').slice().reverse();
    if (!toks.length) return { rows: [], missing: 0 };
    const kinds = new Set(toks.map(t => t.split(':')[0]));
    const [A, M] = await Promise.all([
      kinds.has('anime') ? animeData('anime') : null,
      kinds.has('movie') ? moviesMod() : [],
    ]);
    const Mg = kinds.has('manga') ? await animeData('manga') : null;
    const prog = store.get('portal.anime.progress', {}) || {};
    const rows = [];
    let missing = 0;
    for (const t of toks) {
      const i = t.indexOf(':');
      const k = t.slice(0, i), id = t.slice(i + 1);
      if (k === 'anime' || k === 'manga') {
        const mod = k === 'anime' ? A : Mg;
        const rec = mod && mod.byId(id, k);
        if (!rec) { missing++; continue; }
        rows.push({ kind: k, token: t, progress: prog[t] || null,
          entry: entry({ kind: 'anime', id: k === 'manga' ? `manga:${rec.id}` : rec.id, title: rec.title, art: rec.image || null },
            { meta: { ...C.KIND_META.anime, short: k === 'manga' ? 'Manga' : 'Anime', label: k === 'manga' ? 'Manga' : 'Anime' },
              total: k === 'manga' ? rec.chapters : rec.episodes }) });
      } else if (k === 'movie') {
        const m = arr(M).find(x => x.id === id);
        rows.push({ kind: 'movie', token: t, progress: null,
          entry: entry({ kind: 'anime', id: `movie:${id}`, title: m ? m.title : id, art: null },
            { meta: { ...C.KIND_META.anime, short: 'Film', label: m && m.year ? `Film · ${m.year}` : 'Film', icon: 'film' }, ic: 'film' }) });
      } else missing++;
    }
    return { rows, missing };
  }

  function removeFromWatch(token, title) {
    const cur = arr(store.get('portal.watchlist'));
    store.set('portal.watchlist', cur.filter(x => x !== token));
    api.notify({ app: 'Library', icon: 'trash', title: 'Removed from Watchlist', message: title, timeout: 3000 });
  }

  async function continueRows() {
    const now = Date.now();
    await ensureMaps();
    const played = (await playedRows()).filter(r => now - r.at < CONTINUE_WINDOW);
    const out = played.map(r => ({ ...r, why: 'played' }));
    for (const p of projMap.values()) {
      if (now - (p.updatedAt || 0) >= CONTINUE_WINDOW) continue;
      const i = out.findIndex(o => o.kind === 'creation' && o.id === p.id);
      const row = { kind: 'creation', id: p.id, title: p.name, art: null, at: p.updatedAt, why: 'edited' };
      if (i < 0) out.push(row);
      else if (p.updatedAt > out[i].at) out[i] = row;
    }
    /* anime you marked an episode of and have not finished */
    const prog = store.get('portal.anime.progress', {}) || {};
    const open = Object.entries(prog).filter(([, v]) => v && v.ep && (!v.of || v.ep < v.of) && now - (v.at || 0) < CONTINUE_WINDOW * 2);
    if (open.length) {
      const kinds = new Set(open.map(([t]) => t.split(':')[0]));
      const A = kinds.has('anime') ? await animeData('anime') : null;
      const Mg = kinds.has('manga') ? await animeData('manga') : null;
      for (const [t, v] of open) {
        const [k, id] = [t.slice(0, t.indexOf(':')), t.slice(t.indexOf(':') + 1)];
        const rec = (k === 'anime' ? A : k === 'manga' ? Mg : null)?.byId(id, k);
        if (!rec) continue;
        out.push({ kind: 'anime', id: k === 'manga' ? `manga:${rec.id}` : rec.id, title: rec.title, art: rec.image || null,
          at: v.at || 0, why: 'watching', progress: { ep: v.ep, of: v.of || 0, unit: k === 'manga' ? 'Chapter' : 'Episode' } });
      }
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 24);
  }

  function continueCard(r) {
    const e = entry(r);
    const art = h('div.libx-cont__art');
    fillArt(art, e, true);
    const p = r.progress;
    const pct = p && p.of ? Math.max(4, Math.min(100, Math.round((p.ep / p.of) * 100))) : 0;
    const when = r.why === 'edited' ? `Edited ${api.fmt.fmtAgo(r.at)}`
      : r.why === 'watching' ? `${p.unit} ${p.ep}${p.of ? ` of ${p.of}` : ''}`
      : `Last played ${api.fmt.fmtAgo(r.at)}`;
    const extra = r.why === 'edited' && projMap.get(r.id) ? `Version ${projMap.get(r.id).head + 1}` : null;
    const primary = r.kind === 'creation'
      ? h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { fk: `cont:${r.kind}:${r.id}` }, onclick: () => playCreation(r.id) }, icon('play', { fill: true }), h('span', { text: 'Play' }))
      : h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { fk: `cont:${r.kind}:${r.id}` }, onclick: () => openEntry(e) },
          icon('play', { fill: true }), h('span', { text: r.why === 'watching' ? 'Continue' : 'Play again' }));
    return h('article.libx-cont', {
      oncontextmenu: ev => { ev.preventDefault(); menuFor(e, ev.clientX, ev.clientY); },
    },
      art,
      h('div.libx-cont__b',
        h('div.libx-cont__k', icon(e.meta.icon), h('span', { text: e.meta.label })),
        h('h3.libx-cont__t', { text: e.title }),
        h('div.libx-cont__w', h('span', { text: when }), extra ? h('span', { text: ` · ${extra}` }) : null),
        pct ? h('div.libx-prog.is-inline', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.of), 'aria-valuenow': String(p.ep),
          'aria-label': `${p.unit} ${p.ep} of ${p.of}` }, h('i', { style: { width: `${pct}%` } })) : null,
        h('div.libx-cont__acts', primary,
          r.kind === 'creation' && hasApp('forge')
            ? h('button.btn.btn--ghost.btn--sm.libx-cont__keep.tip', { type: 'button', 'aria-label': `Keep building ${e.title} in Forge`, 'data-tip': 'Keep building',
                dataset: { fk: `keep:${r.id}` }, onclick: () => api.openApp('forge', { project: r.id }) }, icon('edit-3'), h('span', { text: 'Keep building' }))
            : null,
          h('button.ibtn', { type: 'button', 'aria-label': `More for ${e.title}`, 'aria-haspopup': 'menu', dataset: { fk: `contm:${r.kind}:${r.id}` },
            onclick: ev => { const b = ev.currentTarget.getBoundingClientRect(); menuFor(e, b.left, b.bottom + 4); } }, icon('more-horizontal')))));
  }

  /* ============================================================
     THIS WEEK + FINISH THIS (both read straight from this device)
     ============================================================ */
  function weekStats() {
    const now = Date.now();
    const launched = plays.recent(80).filter(r => Number(r.at) >= now - 7 * DAY);
    /* web launches are logged one by one (Static Games), so this is a real count */
    const log = store.get('portal.games.playlog', {});
    let webLaunches = 0;
    if (log && typeof log === 'object' && !Array.isArray(log)) {
      for (const list of Object.values(log)) webLaunches += arr(list).filter(t => typeof t === 'number' && now - t < 7 * DAY).length;
    }
    let r = { games: [], total: 0 };
    try { r = ST.range(7); } catch (e) { /* screen time unreadable: leave the time out */ }
    const gameSec = r.games.reduce((n, g) => n + g.sec, 0);
    return { launched, webLaunches, gameSec, top: r.games.filter(g => g.sec >= 60).slice(0, 3) };
  }

  function weekGroup() {
    const w = weekStats();
    if (!w.launched.length && !w.webLaunches && w.gameSec < 60) return null;
    const tile = (n, label) => h('div.libx-wk', h('b', { text: String(n) }), h('span', { text: label }));
    return group('This week on this device', 'calendar', null, h('div.libx-week', { dataset: { sec: 'week' } },
      h('div.libx-week__tiles',
        w.launched.length ? tile(num(w.launched.length), w.launched.length === 1 ? 'game launched' : 'different games launched') : null,
        w.webLaunches ? tile(num(w.webLaunches), w.webLaunches === 1 ? 'web game launch' : 'web game launches') : null,
        w.gameSec >= 60 ? tile(ST.fmtDur(w.gameSec), 'in games') : null),
      w.top.length ? h('ol.libx-week__top', { 'aria-label': 'Most time in a game this week' }, w.top.map(g => h('li',
        h('span', { text: g.title }), h('small', { text: ST.fmtDur(g.sec) })))) : null,
      h('p.libx-note', icon('info'), h('span', { text: 'Counted on this device over the last 7 days, from your own launches and Screen Time. Nothing here is sent anywhere.' }))));
  }

  /** Things you started and left alone for two weeks: unfinished anime and manga, and creations never published. */
  async function finishRows() {
    const now = Date.now();
    await ensureMaps({ arcade: false });
    const out = [];
    const prog = store.get('portal.anime.progress', {}) || {};
    const status = store.get('portal.anime.status', {}) || {};
    const quiet = Object.entries(prog).filter(([t, v]) => v && v.ep > 0 && now - (v.at || 0) >= QUIET_AFTER
      && !['completed', 'dropped'].includes((status[t] || {}).s));
    if (quiet.length) {
      const kinds = new Set(quiet.map(([t]) => t.split(':')[0]));
      const A = kinds.has('anime') ? await animeData('anime') : null;
      const Mg = kinds.has('manga') ? await animeData('manga') : null;
      for (const [t, v] of quiet) {
        const k = t.slice(0, t.indexOf(':')), id = t.slice(t.indexOf(':') + 1);
        const rec = (k === 'anime' ? A : k === 'manga' ? Mg : null)?.byId(id, k);
        if (!rec) continue;
        const of = v.of || (k === 'manga' ? rec.chapters : rec.episodes) || 0;
        if (!of || v.ep >= of) continue;            /* can't tell it is unfinished without a total */
        const unit = k === 'manga' ? 'Chapter' : 'Episode';
        out.push({ at: v.at || 0, e: entry({ kind: 'anime', id: k === 'manga' ? `manga:${rec.id}` : rec.id, title: rec.title, art: rec.image || null },
          { reason: `${unit} ${v.ep} of ${of} · last marked ${api.fmt.fmtAgo(v.at || 0)}`, prog: { ep: v.ep, of } }) });
      }
    }
    for (const p of projMap.values()) {
      if (p.published || arr(p.versions).length < 1 || now - (p.updatedAt || 0) < QUIET_AFTER) continue;
      const days = Math.floor((now - p.updatedAt) / DAY);
      out.push({ at: p.updatedAt || 0, e: entry({ kind: 'creation', id: p.id, title: p.name },
        { reason: `Not opened for ${plural(days, 'day')} · not published`, prog: null }) });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 14).map(x => x.e);
  }

  async function finishGroup() {
    const rows = await finishRows();
    if (!rows.length) return null;
    return railGroup('Finish this', 'flag', rows, null, e => ({ sub: e.reason, progress: e.prog, playHere: e.kind === 'creation' && !e.gone }));
  }

  /* ============================================================
     OVERVIEW
     ============================================================ */
  async function pageOverview() {
    await ensureMaps();
    const [played, favs, cont, A] = await Promise.all([playedRows(), favoriteGames(), continueRows(), achMod()]);
    const cols = C.list();
    const projs = [...projMap.values()];
    const ach = A ? A.list(playStats()) : [];
    const unlocked = ach.filter(a => a.unlocked).length;
    const user = store.get('session.user', null);
    const name = user && (user.name || user.username);

    const page = h('div.libx-page');

    /* hero — real numbers only, each one a way in */
    const stat = (n, label, sec) => h('button.libx-stat', { type: 'button', onclick: () => go(sec), dataset: { fk: `stat:${sec}` } },
      h('b', { text: String(n) }), h('span', { text: label }));
    const pool = [...favs, ...played.slice(0, 20).map(r => entry(r))];
    const collage = played.filter(r => r.art).slice(0, 5);
    page.appendChild(h('section.libx-hero',
      collage.length ? h('div.libx-hero__art', { 'aria-hidden': 'true' },
        collage.map((r, i) => h('div.libx-hero__tile', { style: { '--i': String(i) } },
          h('img', { src: r.art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: ev => ev.target.parentNode.remove() })))) : null,
      h('div.libx-hero__in',
        h('div.libx-hero__k', icon('heart'), h('span', { text: 'Your library' })),
        h('h1.libx-hero__t', { text: name ? `Welcome back, ${name}` : 'Everything you play, in one place' }),
        h('p.libx-hero__s', { text: 'What you have played, saved and made on this device. Nothing here is guessed, and none of it leaves this browser.' }),
        h('div.libx-stats',
          stat(plays.count(), plays.count() === 1 ? 'game played' : 'games played', 'history'),
          stat(favs.length + arr(store.get('portal.roblox.favs')).length + arr(store.get('portal.cloud.favs')).length, 'favorites', 'favorites'),
          stat(cols.length, cols.length === 1 ? 'collection' : 'collections', 'collections'),
          stat(projs.length, projs.length === 1 ? 'creation' : 'creations', 'created'),
          ach.length ? stat(`${unlocked}/${ach.length}`, 'achievements', 'achievements') : null),
        pool.length ? h('div.libx-hero__acts',
          h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'surprise' },
            onclick: () => openEntry(pool[Math.floor(Math.random() * pool.length)]) },
            icon('shuffle'), h('span', { text: 'Surprise me' })),
          h('small', { text: `picks from your favorites and recent games` })) : null)));

    const nothing = !played.length && !favs.length && !cols.length && !projs.length && !cont.length;
    if (nothing) {
      page.appendChild(empty('gamepad', 'Your library fills itself as you play',
        'Play a game, favorite one, or make your own in Forge — it all shows up here. Start anywhere:', [
          btn('Browse games', 'gamepad', () => api.openApp('aether-games', {}), '.btn--primary'),
          hasApp('arcade') ? btn('Open the Arcade', 'zap', () => api.openApp('arcade', {})) : null,
          hasApp('forge') ? btn('Make a game', 'sparkles', () => api.openApp('forge', {})) : null,
          btn('Start a collection', 'layers', () => go('collections'), '.btn--ghost'),
        ].filter(Boolean)));
      return page;
    }

    page.appendChild(h('div.libx-toolbar', filterEl));

    if (cont.length) {
      page.appendChild(group('Continue Playing', 'play', null,
        h('div.libx-conts', cont.slice(0, 4).map(continueCard)),
        cont.length > 4 ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => go('continue') }, h('span', { text: 'See all' }), icon('chevron-right')) : null));
    }
    const fin = await finishGroup();
    if (fin) page.appendChild(fin);
    const wk = weekGroup();
    if (wk) page.appendChild(wk);

    /* collections — or the starters, when there are none */
    if (cols.length) {
      page.appendChild(group('Collections', 'layers', cols.length,
        h('div.libx-cols', [...cols.slice(0, 5).map(colCard), newColCard()]),
        h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => go('collections') }, h('span', { text: 'All collections' }), icon('chevron-right'))));
    } else {
      page.appendChild(group('Collections', 'layers', null, starters(true)));
    }

    if (played.length) {
      page.appendChild(railGroup('Recently Played', 'clock', played.slice(0, 16).map(r => entry(r)),
        () => go('recent'), e => ({ sub: `${e.meta.short} · ${api.fmt.fmtAgo(e.at)}` })));
    }
    if (favs.length) {
      page.appendChild(railGroup('Favorites', 'heart', favs.slice(0, 16), () => go('favorites'),
        e => ({ sub: e.studio || e.meta.label, fav: true, onRemove: unfavGame, removeLabel: 'Remove from favourites' })));
    }
    if (projs.length) {
      page.appendChild(railGroup('Created by you', 'sparkles', projs.slice(0, 12).map(p => entry({ kind: 'creation', id: p.id, title: p.name })),
        () => go('created'), e => createdOpts(projMap.get(e.id))));
    }
    if (ach.length) {
      const next = ach.filter(a => !a.unlocked && !a.secret && a.goal).sort((a, b) => (b.progress / b.goal) - (a.progress / a.goal)).slice(0, 3);
      page.appendChild(group('Achievements', 'star', `${unlocked} of ${ach.length}`,
        h('div.libx-achs.is-compact', [...ach.filter(a => a.unlocked).sort((a, b) => b.at - a.at).slice(0, 3), ...next].slice(0, 4).map(achCard)),
        h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: () => go('achievements') }, h('span', { text: 'All achievements' }), icon('chevron-right'))));
    }
    return page;
  }

  /* ============================================================
     CONTINUE PLAYING
     ============================================================ */
  async function pageContinue() {
    const rows = await continueRows();
    const page = h('div.libx-page', head({
      title: 'Continue Playing',
      sub: 'What you launched or worked on in the last two weeks. A web game keeps its own saves, so StaticOS cannot see how far you got — only when you last played.',
    }));
    const fin = await finishGroup();
    if (!rows.length) {
      page.appendChild(empty('play', 'Nothing in progress',
        'Games you launch, creations you edit and episodes you mark as watched show up here for two weeks.',
        [btn('Browse games', 'gamepad', () => api.openApp('aether-games', {}), '.btn--primary'),
          btn('Recently Played', 'clock', () => go('recent'), '.btn--ghost')]));
      if (fin) page.appendChild(fin);
      return page;
    }
    page.appendChild(h('div.libx-conts', rows.map(continueCard)));
    if (fin) page.appendChild(fin);
    return page;
  }

  /* ============================================================
     RECENTLY PLAYED
     ============================================================ */
  async function pageRecent() {
    await ensureMaps();
    const [played, rbx] = await Promise.all([playedRows(), robloxRows('portal.roblox.recent')]);
    const cloud = cloudRows('portal.cloud.played');
    const page = h('div.libx-page', head({
      title: 'Recently Played',
      sub: 'Every game launched on this device, newest first — web games, Arcade games and your own creations.',
      tools: played.length ? btn('History', 'list', () => go('history'), '.btn--ghost.btn--sm') : null,
    }));
    if (!played.length && !rbx.length && !cloud.length) {
      page.appendChild(empty('clock', 'Nothing played yet', 'Launch any game and it lands here, with when you played it.',
        [btn('Browse games', 'gamepad', () => api.openApp('aether-games', {}), '.btn--primary'),
          hasApp('arcade') ? btn('Open the Arcade', 'zap', () => api.openApp('arcade', {})) : null].filter(Boolean)));
      return page;
    }
    if (played.length) {
      const by = k => played.filter(r => r.kind === k).length;
      const opts = [{ id: 'all', label: 'All', n: played.length },
        ...['web', 'arcade', 'creation'].filter(k => by(k)).map(k => ({ id: k, label: k === 'web' ? 'Web games' : k === 'arcade' ? 'Arcade' : 'Creations', icon: C.KIND_META[k].icon, n: by(k) }))];
      if (!opts.some(o => o.id === view.recentKind)) view.recentKind = 'all';
      const holder = h('div');
      const paintGrid = () => {
        const rows = played.filter(r => view.recentKind === 'all' || r.kind === view.recentKind);
        api.render(holder, grid(rows.map(r => entry(r)), e => ({ sub: `${e.meta.short} · ${api.fmt.fmtAgo(e.at)}`, playHere: e.kind === 'creation' && !e.gone })));
      };
      const bar = opts.length > 2 ? chips(opts, () => view.recentKind, id => { view.recentKind = id; paintGrid(); }, 'Filter by kind') : null;
      paintGrid();
      page.appendChild(group('Games', 'gamepad', played.length, h('div', bar, holder)));
    }
    if (rbx.length) page.appendChild(group('Opened in Static Roblox', 'box', rbx.length, grid(rbx, e => ({ sub: e.creator || 'Roblox' }))));
    if (cloud.length) page.appendChild(group('Played in Static Cloud', 'cast', cloud.length, grid(cloud, e => ({ sub: e.at ? api.fmt.fmtAgo(e.at) : 'Cloud' }))));
    return page;
  }

  /* ============================================================
     FAVORITES
     ============================================================ */
  /** Favourites whose game is no longer in the catalogue. Only judged once the
      whole catalogue really loaded, so a failed fetch can never look like "gone". */
  async function staleFavorites() {
    const out = { web: [], roblox: [] };
    const G = await gamesMod();
    if (G && G.isLoaded() && !G.loadError()) {
      out.web = arr(store.get('portal.games.favs')).filter(x => typeof x === 'string' && !G.byId(x));
    }
    const RB = await robloxMod();
    if (RB && RB.isLoaded() && !RB.loadError()) {
      out.roblox = arr(store.get('portal.roblox.favs')).map(String).filter(id => !RB.byId(id));
    }
    return out;
  }

  async function cleanFavorites(stale) {
    const n = stale.web.length + stale.roblox.length;
    const yes = await confirmKeep({
      title: `Remove ${plural(n, 'favourite')} that left the catalogue?`,
      message: 'The games are not in the catalogue any more, so they cannot be opened. Nothing else is touched.',
      ok: 'Remove', danger: true,
    });
    if (!yes || dead) return;
    const web = new Set(stale.web), rbx = new Set(stale.roblox);
    store.set('portal.games.favs', arr(store.get('portal.games.favs')).filter(x => !web.has(x)));
    store.set('portal.roblox.favs', arr(store.get('portal.roblox.favs')).filter(x => !rbx.has(String(x))));
    focusHeading = true;
    api.notify({ app: 'Library', icon: 'trash', title: 'Cleaned up your favourites', message: `${plural(n, 'favourite')} removed.`, timeout: 3500 });
  }

  async function pageFavorites() {
    const [favs, rbx, stale, G, played] = await Promise.all([favoriteGames(), robloxRows('portal.roblox.favs'), staleFavorites(), gamesMod(), playedRows()]);
    const cloud = cloudRows('portal.cloud.favs');
    const page = h('div.libx-page', head({ title: 'Favorites', sub: 'Everything you have hearted, across Static Games, Roblox and Cloud.' }));
    const staleN = stale.web.length + stale.roblox.length;
    const cleanNote = staleN ? h('div.libx-note.libx-note--act', { dataset: { sec: 'stale' } }, icon('alert'),
      h('span', { text: `${plural(staleN, 'favourite')} left the catalogue and can no longer be opened.` }),
      h('button.btn.btn--ghost.btn--sm', { type: 'button', dataset: { fk: 'cleanfav' }, onclick: () => cleanFavorites(stale) },
        icon('trash'), h('span', { text: staleN === 1 ? 'Remove it' : 'Remove them' }))) : null;
    if (!favs.length && !rbx.length && !cloud.length) {
      if (cleanNote) page.appendChild(cleanNote);
      page.appendChild(empty('heart', 'No favorites yet', 'Tap the heart on any game and it collects here.',
        [btn('Browse games', 'gamepad', () => api.openApp('aether-games', {}), '.btn--primary'),
          btn('Browse Roblox', 'box', () => api.openApp('aether-roblox', {}), '.btn--ghost')]));
      return page;
    }
    if (cleanNote) page.appendChild(cleanNote);
    if (favs.length) {
      /* sort and group: yours alone, remembered on this device */
      const lastAt = new Map(played.filter(r => r.kind === 'web').map(r => [r.id, r.at]));
      const counts = new Map(plays.top(400).filter(r => r.kind === 'web').map(r => [r.id, r.plays || 0]));
      const order = favs.map((e, i) => [e, i]);
      const SORT = {
        newest: (a, b) => a[1] - b[1],
        az: (a, b) => a[0].title.localeCompare(b[0].title) || a[1] - b[1],
        played: (a, b) => (counts.get(b[0].id) || 0) - (counts.get(a[0].id) || 0) || (lastAt.get(b[0].id) || 0) - (lastAt.get(a[0].id) || 0) || a[1] - b[1],
        recent: (a, b) => (lastAt.get(b[0].id) || 0) - (lastAt.get(a[0].id) || 0) || a[1] - b[1],
      };
      const catOf = e => { const g = G && G.byId(e.id); const c = g && g.cats.find(x => x !== 'featured'); return c ? G.catMeta(c).name : 'Other'; };
      const holder = h('div.libx-favgroups');
      const paintFavs = () => {
        const rows = order.slice().sort(SORT[view.favSort] || SORT.newest).map(x => x[0]);
        const optsOf = e => ({ sub: e.studio || 'Web game', fav: true, onRemove: unfavGame, removeLabel: 'Remove from favourites' });
        if (view.favGroup === 'none') { api.render(holder, group('Web games', 'gamepad', rows.length, grid(rows, optsOf))); return; }
        const by = new Map();
        for (const e of rows) { const k = view.favGroup === 'studio' ? (e.studio || 'Unknown studio') : catOf(e); if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
        const parts = [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
        api.render(holder, ...parts.map(([k, es]) => group(k, view.favGroup === 'studio' ? 'user' : 'tag', es.length, grid(es, optsOf))));
      };
      const save = () => store.set(VIEW_KEY, { favSort: view.favSort, favGroup: view.favGroup });
      page.appendChild(h('div.libx-favbar', { dataset: { sec: 'favbar' } },
        h('div.libx-favbar__g', h('span.libx-favbar__l', { text: 'Sort' }),
          chips(FAV_SORTS, () => view.favSort, id => { view.favSort = id; save(); paintFavs(); }, 'Sort favourites')),
        h('div.libx-favbar__g', h('span.libx-favbar__l', { text: 'Group' }),
          chips(FAV_GROUPS, () => view.favGroup, id => { view.favGroup = id; save(); paintFavs(); }, 'Group favourites'))));
      paintFavs();
      page.appendChild(holder);
      if (view.favSort === 'played') page.appendChild(note('“Most played here” counts launches from this device; a game you have not launched since counting began sorts by when you last played it.'));
    }
    if (rbx.length) page.appendChild(group('Roblox', 'box', rbx.length, grid(rbx, e => ({ sub: e.creator || 'Roblox', fav: true }))));
    if (cloud.length) page.appendChild(group('Cloud', 'cast', cloud.length, grid(cloud, e => ({ sub: e.year ? String(e.year) : 'Emulated', fav: true }))));
    return page;
  }

  /* ============================================================
     HISTORY
     ============================================================ */
  async function pageHistory() {
    await ensureMaps();
    const rows = await playedRows();
    const total = plays.total(), distinct = plays.count();
    const page = h('div.libx-page', head({
      title: 'History',
      sub: total ? `${plural(total, 'launch', 'launches')} of ${plural(distinct, 'different game')} recorded on this device.`
        : 'Every game you launch is written down here, on this device only.',
    }));
    if (!rows.length) {
      page.appendChild(empty('list', 'No history yet', 'Launch a game and it is listed here by day, with the time you played it.',
        [btn('Browse games', 'gamepad', () => api.openApp('aether-games', {}), '.btn--primary')]));
      return page;
    }
    const q = h('input', { type: 'search', placeholder: 'Filter history', 'aria-label': 'Filter history by title', value: view.histQ, spellcheck: 'false', dataset: { fk: 'histq' } });
    const list = h('div.libx-hist');
    const h24 = !!store.get('prefs.h24');
    const timeOf = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !h24 });
    const dayOf = t => {
      const d = new Date(t), now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      if (t >= start) return 'Today';
      if (t >= start - DAY) return 'Yesterday';
      if (t >= start - 6 * DAY) return d.toLocaleDateString(undefined, { weekday: 'long' });
      return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
    };
    const paint = () => {
      const needle = view.histQ.trim().toLowerCase();
      const shown = rows.filter(r => !needle || String(r.title).toLowerCase().includes(needle));
      const days = new Map();
      for (const r of shown) { const d = dayOf(r.at); if (!days.has(d)) days.set(d, []); days.get(d).push(r); }
      const kids = [];
      for (const [d, rs] of days) {
        kids.push(h('section.libx-hist__day',
          h('h2.libx-hist__d', h('span', { text: d }), h('small', { text: plural(rs.length, 'game') })),
          h('ol.libx-hist__list', rs.map(r => {
            const e = entry(r);
            const thumb = h('div.libx-hist__art');
            fillArt(thumb, e);
            return h('li.libx-hist__row', {
              oncontextmenu: ev => { ev.preventDefault(); menuFor(e, ev.clientX, ev.clientY); },
            },
              h('time.libx-hist__time', { datetime: new Date(r.at).toISOString(), text: timeOf(r.at) }),
              thumb,
              h('div.libx-hist__b', h('b', { text: e.title }), h('small', icon(e.meta.icon), h('span', { text: e.meta.label }))),
              h('button.btn.btn--sm', { type: 'button', dataset: { fk: `hist:${r.kind}:${r.id}` },
                'aria-label': `${e.kind === 'creation' ? 'Play' : verb(e)} ${e.title} again`,
                onclick: () => (e.kind === 'creation' ? playCreation(e.id) : openEntry(e)) },
                icon('play', { fill: true }), h('span', { text: 'Play' })),
              h('button.ibtn', { type: 'button', 'aria-label': `More for ${e.title}`, 'aria-haspopup': 'menu',
                onclick: ev => { const b = ev.currentTarget.getBoundingClientRect(); menuFor(e, b.left, b.bottom + 4); } }, icon('more-horizontal')));
          }))));
      }
      api.render(list, ...(kids.length ? kids : [empty('search', `Nothing in your history matches “${view.histQ.trim()}”`, 'Try a shorter word.')]));
    };
    q.addEventListener('input', () => { view.histQ = q.value; paint(); });
    paint();
    page.appendChild(h('div.libx-toolbar', h('label.field.libx-find', icon('search'), q)));
    page.appendChild(list);
    page.appendChild(note('One line per game, at the last time you launched it — the newest 80. Kept in this browser only.'));
    return page;
  }

  /* ============================================================
     COLLECTIONS
     ============================================================ */
  async function newCollection(after) {
    const name = await C.askName(api, { title: 'New collection', ok: 'Create' });
    if (!name) return;
    const col = C.create(name);
    if (!col) { api.notify({ app: 'Library', icon: 'alert', title: 'Could not make that collection', message: 'You have reached the limit of 60 collections.' }); return; }
    if (after) after(col); else go('collections', col.id);
  }

  function colMosaic(col) {
    const box = h('div.libx-col__art', { style: { '--h': String(hueOf(col.id)) } });
    const items = col.items.slice(0, 4);
    if (!items.length || col.rule) {
      box.classList.add('is-empty');
      box.appendChild(icon(col.icon, { size: 30 }));
      return box;
    }
    box.classList.add(`n${items.length}`);
    for (const it of items) {
      const cell = h('div.libx-col__cell');
      fillArt(cell, entry(it));
      box.appendChild(cell);
    }
    return box;
  }

  function kindSummary(items) {
    const n = {};
    for (const it of items) n[it.kind] = (n[it.kind] || 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, c]) => `${c} ${(C.KIND_META[k] || {}).short || k}`).join(' · ');
  }

  function colMenu(col, x, y, el = null) {
    api.menu([
      { label: 'Open', icon: 'folder-open', onClick: () => go('collections', col.id) },
      { label: 'Rename…', icon: 'edit-3', onClick: () => renameCol(col) },
      { label: 'Change icon…', icon: col.icon, onClick: () => iconMenu(col, x, y) },
      { label: 'Pin to desktop', icon: 'monitor', onClick: () => shortcuts.addCollectionToDesktop(col) },
      '-',
      { label: 'Delete collection…', icon: 'trash', danger: true, onClick: () => deleteCol(col, false, el) },
    ], x, y);
  }

  function iconMenu(col, x, y) {
    api.menu([{ header: true, label: 'Collection icon' }, ...C.ICONS.map(ic => ({
      label: ic.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()), icon: ic, checked: ic === col.icon,
      onClick: () => C.setIcon(col.id, ic),
    }))], x, y);
  }

  async function renameCol(col) {
    const name = await C.askName(api, { title: 'Rename collection', ok: 'Rename', value: col.name });
    if (name) C.rename(col.id, name);
  }

  async function deleteCol(col, thenBack, el = null) {
    const ok = await confirmKeep({
      title: `Delete “${col.name}”?`,
      message: col.items.length ? `The collection goes; the ${plural(col.items.length, 'thing')} in it stay${col.items.length === 1 ? 's' : ''} where ${col.items.length === 1 ? 'it is' : 'they are'} — nothing is uninstalled or unfavourited.` : 'It is empty, so nothing else changes.',
      ok: 'Delete', danger: true,
    });
    if (!ok || dead) return;
    if (!thenBack) focusAfterRemoving(el);
    C.remove(col.id);
    api.notify({ app: 'Library', icon: 'trash', title: 'Collection deleted', message: col.name, timeout: 3000 });
    if (thenBack) go('collections');
  }

  function colCard(col) {
    let el = null;
    const goBtn = h('button.libx-col__go', {
      type: 'button', 'aria-label': col.rule ? `Open smart collection ${col.name}` : `Open collection ${col.name}, ${plural(col.items.length, 'item')}`,
      dataset: { fk: `col:${col.id}` },
      onclick: () => go('collections', col.id),
      oncontextmenu: ev => { ev.preventDefault(); colMenu(col, ev.clientX, ev.clientY, el); },
    });
    const more = h('button.libx-card__more', {
      type: 'button', 'aria-label': `More for ${col.name}`, 'aria-haspopup': 'menu', dataset: { fk: `colm:${col.id}` },
      onclick: () => { const r = more.getBoundingClientRect(); colMenu(col, r.left, r.bottom + 4, el); },
    }, icon('more-horizontal'));
    el = h('div.libx-col',
      colMosaic(col),
      h('div.libx-col__b',
        h('div.libx-col__t', icon(col.icon), h('span', { text: col.name })),
        h('div.libx-col__m', { text: col.rule ? `Smart · ${C.describeRule(col.rule, catLabel)}`
          : col.items.length ? `${plural(col.items.length, 'item')} · ${kindSummary(col.items)}` : 'Empty — add anything' })),
      goBtn, more);
    return el;
  }

  function newColCard() {
    return h('button.libx-col.is-new', { type: 'button', dataset: { fk: 'newcol' }, onclick: () => newCollection(), 'aria-label': 'New collection' },
      h('div.libx-col__art.is-new', icon('plus', { size: 26 })),
      h('div.libx-col__b', h('div.libx-col__t', h('span', { text: 'New collection' })),
        h('div.libx-col__m', { text: 'Name it, then fill it' })));
  }

  function starters(withIntro) {
    const have = new Set(C.list().map(c => c.name.toLowerCase()));
    const left = C.SUGGESTED.filter(s => !have.has(s.name.toLowerCase()));
    if (!left.length) return null;
    return h('div.libx-starters',
      withIntro ? h('p.libx-starters__i', { text: 'Collections are shelves you fill yourself. Start with one of these — each begins empty, and only what you add goes in.' }) : null,
      h('div.libx-starters__row', left.map(s => h('div.libx-starter',
        h('div.libx-starter__ic', icon(s.icon)),
        h('div.libx-starter__b', h('b', { text: s.name }), h('small', { text: s.blurb })),
        h('button.btn.btn--sm', {
          type: 'button', 'aria-label': `Create collection ${s.name}`, dataset: { fk: `starter:${s.name}` },
          onclick: ev => {
            /* the page repaints ~70 ms after the store changes, so a double
               click lands on this same button twice: make it only once */
            const b = ev.currentTarget;
            if (b.getAttribute('aria-disabled') === 'true') return;
            if (C.list().some(c => c.name.toLowerCase() === s.name.toLowerCase())) return;
            b.setAttribute('aria-disabled', 'true');
            const col = C.create(s.name, { icon: s.icon });
            if (!col) {
              b.removeAttribute('aria-disabled');
              api.notify({ app: 'Library', icon: 'alert', title: 'Could not make that collection', message: 'You have reached the limit of 60 collections.' });
              return;
            }
            wantFk = `col:${col.id}`;
            api.notify({ app: 'Library', icon: s.icon, title: `Made “${col.name}”`, message: 'It is empty — add games from any ⋯ menu.', timeout: 3500 });
          },
        }, icon('plus'), h('span', { text: 'Create' }))))),
      withIntro ? h('button.btn.btn--ghost.btn--sm.libx-starters__own', { type: 'button', onclick: () => newCollection() }, icon('edit-3'), h('span', { text: 'Or name your own…' })) : null);
  }

  async function pageCollections() {
    await ensureMaps();
    const cols = C.list();
    const page = h('div.libx-page', head({
      title: 'Collections',
      sub: 'Your own shelves — games, Arcade games, creations, anime, Roblox and Cloud titles, mixed however you like.',
      tools: [
        btn('New collection', 'plus', () => newCollection(), '.btn--primary.btn--sm', { dataset: { fk: 'newcol-top' } }),
        btn('New smart collection', 'sparkles', () => newSmartCollection(), '.btn--sm', { dataset: { fk: 'newsmart' } }),
        btn('Import a file…', 'upload', () => importCollectionFile(), '.btn--ghost.btn--sm', { dataset: { fk: 'importcol' } }),
      ],
    }));
    if (cols.length) page.appendChild(h('div.libx-cols.is-page', [...cols.map(colCard), newColCard()]));
    const st = starters(!cols.length);
    if (st) page.appendChild(cols.length ? group('Suggested starters', 'sparkles', null, st) : st);
    page.appendChild(note('To add something, open its ⋯ menu here, or right-click any game in Static Games and choose “Add to collection…”.', 'bookmark'));
    return page;
  }

  /* ---- smart collections: the rule sheet ---- */
  async function askRule({ title = 'New smart collection', ok = 'Create', value = null, withName = true } = {}) {
    const G = await gamesMod();
    const cats = G ? G.categories().filter(c => c.id !== 'featured') : [];
    const prev = document.activeElement;
    const cur = value ? C.normRule(value) : { src: 'web', state: 'played' };
    return new Promise(resolve => {
      const sel = (label, opts, val, onchange) => {
        const s2 = h('select.libx-dlg__in', { 'aria-label': label, onchange: () => onchange(s2.value) },
          opts.map(([v, l]) => h('option', { value: v, text: l, selected: v === val })));
        return h('label.libx-dlg__l', h('span', { text: label }), s2);
      };
      const nameIn = h('input.libx-dlg__in', { type: 'text', maxlength: '40', spellcheck: 'false', autocomplete: 'off',
        'aria-label': 'Name', placeholder: 'e.g. Horror I have played' });
      const body = h('div.libx-dlg__rule');
      const okBtn = h('button.btn.btn--primary', { type: 'submit', text: ok });
      const paintBody = () => {
        const R = cur;
        const states = R.src === 'web' ? [['any', 'any'], ['played', 'I have played'], ['fav', 'are in my favorites'], ['unplayed', 'I have not tried yet']]
          : R.src === 'arcade' ? [['any', 'any'], ['played', 'I have played'], ['unplayed', 'I have not tried yet']]
          : [['any', 'any'], ['fav', 'are in my favorites'], ['played', 'I have opened']];
        api.render(body,
          sel('Show', Object.entries(C.RULE_SRC).map(([k, v]) => [k, v.label]), R.src, v => {
            cur.src = v;
            cur.state = v === 'anime' ? undefined : 'any';
            cur.status = v === 'anime' ? 'watching' : undefined;
            delete cur.cat;
            delete cur.players2;
            paintBody();
          }),
          R.src === 'web' && cats.length
            ? sel('Category', [['', 'Any category'], ...cats.slice(0, 40).map(c => [c.id, c.name])], R.cat || '', v => { if (v) cur.cat = v; else delete cur.cat; })
            : null,
          R.src === 'anime'
            ? sel('Status in Static Anime', Object.entries(C.ANIME_STATUS), R.status || 'watching', v => { cur.status = v; })
            : sel('That', states, R.state || 'any', v => { cur.state = v; }),
          R.src === 'arcade' ? h('label.libx-dlg__chk', h('input', { type: 'checkbox', checked: !!R.players2, onchange: e => { cur.players2 = e.target.checked; } }),
            h('span', { text: 'Only games for two players' })) : null);
      };
      const card = h('form.libx-dlg__card.glass', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
        onsubmit: e => {
          e.preventDefault();
          const rule = C.normRule(cur);
          done({ name: nameIn.value.trim() || C.describeRule(rule, catLabel).slice(0, 40), rule });
        } },
        h('div.libx-dlg__h', icon('sparkles'), h('b', { text: title })),
        withName ? h('label.libx-dlg__l', h('span', { text: 'Name' }), nameIn) : null,
        body,
        h('small.libx-dlg__hint', { text: 'It is a rule, not a list: Static looks again each time you open it, so it is always up to date.' }),
        h('div.libx-dlg__acts', h('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => done(null) }), okBtn));
      const wrap = h('div.libx-dlg', { onpointerdown: e => { if (e.target === wrap) done(null); } }, card);
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
      let closed = false;
      function done(v) {
        if (closed) return;
        closed = true;
        window.removeEventListener('keydown', onKey, true);
        wrap.remove();
        if (prev && prev.isConnected) prev.focus({ preventScroll: true });
        resolve(v);
      }
      paintBody();
      document.body.appendChild(wrap);
      window.addEventListener('keydown', onKey, true);
      (withName ? nameIn : body.querySelector('select')).focus();
    });
  }

  async function newSmartCollection() {
    const r = await askRule();
    if (!r || dead) return;
    const col = C.createSmart(r.name, r.rule);
    if (!col) { api.notify({ app: 'Library', icon: 'alert', title: 'Could not make that collection', message: 'You have reached the limit of 60 collections.' }); return; }
    go('collections', col.id);
  }

  /* ---- sharing: a file of ids, or the same list sent to a friend ---- */
  function saveBlob(name, mime, data) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function fileSafe(s) { return String(s || 'collection').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'collection'; }

  function exportMenu(col, items, x, y) {
    const n = C.wireIds(items).length;
    if (!n) {
      api.notify({ app: 'Library', icon: 'info', title: 'Nothing to export', message: 'Only web games, Arcade games, Roblox and anime can be exported. Creations and Cloud titles stay on this device.' });
      return;
    }
    api.menu([
      { header: true, label: `${plural(n, 'title')} · a list of ids, no links` },
      { label: 'Save as a file', icon: 'download', onClick: () => {
        saveBlob(`${fileSafe(col.name)}.staticos-collection.json`, 'application/json', C.exportJson(col, items));
        api.notify({ app: 'Library', icon: 'download', title: 'Collection saved', message: `${col.name} · ${plural(n, 'title')}`, timeout: 3000 });
      } },
      { label: 'Copy as text', icon: 'copy', onClick: async () => {
        let okc = false;
        try { await navigator.clipboard.writeText(C.exportJson(col, items)); okc = true; } catch (e) { okc = false; }
        api.notify({ app: 'Library', icon: okc ? 'copy' : 'alert', title: okc ? 'Copied' : 'This browser refused clipboard access',
          message: okc ? `${col.name} · ${plural(n, 'title')}` : 'Use Save as a file instead.', timeout: 3500 });
      } },
    ], x, y);
  }

  async function importCollectionFile() {
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    document.body.appendChild(input);
    const f = await new Promise(res => {
      input.addEventListener('change', () => res(input.files && input.files[0]), { once: true });
      input.addEventListener('cancel', () => res(null), { once: true });
      input.click();
    });
    input.remove();
    if (!f || dead) return;
    let text = '';
    try { text = await f.text(); } catch (e) { text = ''; }
    const parsed = text.length < 200_000 ? C.parseExport(text) : null;
    if (!parsed || !parsed.pairs.length) {
      api.notify({ app: 'Library', icon: 'alert', title: 'That is not a collection file', message: 'Choose a file saved from a collection’s Export menu.' });
      return;
    }
    const r = await C.importIds(parsed.name, parsed.pairs);
    if (dead) return;
    if (!r) { api.notify({ app: 'Library', icon: 'alert', title: 'Could not make that collection', message: 'You have reached the limit of 60 collections.' }); return; }
    api.notify({ app: 'Library', icon: 'bookmark', title: `Imported “${r.col.name}”`,
      message: `${r.added} of ${r.added + r.skipped} found in your catalogues${r.skipped ? `; ${r.skipped} this device does not have were left out` : ''}.`, timeout: 5000 });
    go('collections', r.col.id);
  }

  /** the friends list with a Send button each; sends the ids, they look them up */
  async function paintSendPanel(hold, col, items) {
    const ids = C.wireIds(items);
    api.render(hold, h('small.dim', { text: 'Looking at your friends…' }));
    let F = null;
    try { F = await import('../core/friends.js'); } catch (e) { F = null; }
    if (dead || !hold.isConnected) return;
    if (!F || !F.available()) { api.render(hold, h('small.dim', { text: 'Friends are not available here. Sign in to a profile to add friends in Static Social.' })); return; }
    const list = F.friends();
    if (!list.length) {
      api.render(hold, h('small.dim', { text: 'You have no friends added yet.' }),
        btn('Open Friends', 'users', () => api.openApp('social', { friends: true }), '.btn--sm'));
      return;
    }
    api.render(hold,
      h('small.dim', { text: `This sends ${plural(ids.length, 'title')} as a list of ids, nothing more. Their StaticOS looks each one up in its own catalogues, and nothing is saved unless they press Save.` }),
      h('div.libx-send__list', list.map(f => h('div.libx-send__row', { dataset: { fp: f.fp } },
        h('span', { class: `ag-friend__dot is-${f.presence}`, 'aria-hidden': 'true' }),
        h('b', { text: f.display }),
        h('small.dim', { text: f.presence === 'offline' ? 'offline' : f.presence }),
        h('div.grow'),
        h('button.btn.btn--sm', { type: 'button', 'aria-label': `Send ${col.name} to ${f.display}`, dataset: { fk: `sendcol:${f.fp}` },
          onclick: async e => {
            const b = e.currentTarget;
            b.disabled = true;
            const r = await F.sendCollection(f.fp, { name: col.name, ids });
            b.disabled = false;
            api.notify({ app: 'Library', icon: r.ok ? 'send' : 'alert', timeout: 5000,
              title: r.ok ? `Sent to ${f.display}` : 'Could not send it',
              message: r.ok ? `${col.name} · ${plural(r.count, 'title')}. They will see it when their StaticOS is open.`
                : r.error === 'wait' ? 'Wait a moment before sending another.' : r.error === 'empty' ? 'Nothing in it can be sent.' : 'That friend is not reachable right now.' });
          } }, icon('send', { size: 13 }), h('span', { text: 'Send' }))))));
  }

  async function pageCollection(id) {
    await ensureMaps();
    const col = C.get(id);
    if (!col) {
      return h('div.libx-page', empty('layers', 'That collection is gone', 'It was deleted, or the link came from another device.',
        [btn('All collections', 'arrow-left', () => go('collections'), '.btn--primary')]));
    }
    /* a smart collection is worked out right now from what the stores hold */
    let items = col.items, smartNote = '';
    if (col.rule) ({ items, note: smartNote } = await C.evaluate(col));
    if (dead) return h('div');
    const page = h('div.libx-page');
    const tile = h('div.libx-colhead__ic', { style: { '--h': String(hueOf(col.id)) } }, icon(col.icon));
    const sendHold = h('div.libx-send', { hidden: true, dataset: { sec: 'send' } });
    const sendBtn = h('button.btn.btn--sm', { type: 'button', 'aria-expanded': 'false', dataset: { fk: 'send' },
      onclick: () => {
        const open = sendHold.hidden;
        sendHold.hidden = !open;
        sendBtn.setAttribute('aria-expanded', String(open));
        if (open) paintSendPanel(sendHold, col, items);
      } }, icon('send'), h('span', { text: 'Send to a friend' }));
    const sub = col.rule
      ? `${plural(items.length, 'item')} right now · Smart: ${C.describeRule(col.rule, catLabel)}`
      : `${plural(items.length, 'item')}${items.length ? ` · ${kindSummary(items)}` : ''}${col.createdAt ? ` · made ${dateText(col.createdAt)}` : ''}`;
    page.appendChild(h('header.libx-colhead',
      h('button.btn.btn--ghost.btn--sm.libx-back', { type: 'button', onclick: () => go('collections'), dataset: { fk: 'back' } },
        icon('arrow-left'), h('span', { text: 'Collections' })),
      h('div.libx-colhead__main', tile,
        h('div.libx-colhead__txt',
          h('div.libx-head__k', icon(col.rule ? 'sparkles' : 'layers'), h('span', { text: col.rule ? 'Smart collection' : 'Collection' })),
          h('h1.libx-head__t', { text: col.name }),
          h('p.libx-head__s', { text: sub })),
        h('div.libx-head__tools', filterEl,
          btn('Rename', 'edit-3', () => renameCol(col), '.btn--sm', { dataset: { fk: 'rename' } }),
          col.rule ? btn('Edit rule', 'sliders', async () => {
            const r = await askRule({ title: 'Edit the rule', ok: 'Save', value: col.rule, withName: false });
            if (r && !dead) C.setRule(col.id, r.rule);
          }, '.btn--sm', { dataset: { fk: 'editrule' } }) : null,
          h('button.btn.btn--sm', { type: 'button', 'aria-haspopup': 'menu', dataset: { fk: 'icon' },
            onclick: ev => { const r = ev.currentTarget.getBoundingClientRect(); iconMenu(col, r.left, r.bottom + 4); } },
            icon(col.icon), h('span', { text: 'Icon' })),
          h('button.btn.btn--sm', { type: 'button', 'aria-haspopup': 'menu', dataset: { fk: 'export' },
            onclick: ev => { const r = ev.currentTarget.getBoundingClientRect(); exportMenu(col, items, r.left, r.bottom + 4); } },
            icon('download'), h('span', { text: 'Export' })),
          sendBtn,
          btn('Pin to desktop', 'monitor', () => shortcuts.addCollectionToDesktop(col), '.btn--sm', { dataset: { fk: 'pin' } }),
          btn('Delete', 'trash', () => deleteCol(col, true), '.btn--sm.btn--ghost.libx-danger', { dataset: { fk: 'delete' } })))));
    page.appendChild(sendHold);

    if (!items.length) {
      page.appendChild(col.rule
        ? empty(col.icon, 'Nothing matches the rule right now', smartNote || 'Play, favorite or mark something and it appears here by itself. You can change the rule with Edit rule.')
        : empty(col.icon, 'Nothing in here yet',
          'Add from the shelf below, from any ⋯ menu in the Library, or right-click a game in Static Games → Add to collection…'));
    } else {
      const kinds = [...new Set(items.map(i => i.kind))];
      if (!kinds.includes(view.colKind)) view.colKind = 'all';
      const holder = h('div');
      const paintItems = () => {
        const list = items.filter(i => view.colKind === 'all' || i.kind === view.colKind);
        api.render(holder, grid(list.map(i => entry(i)), e => (col.rule
          ? { sub: e.at ? `${e.meta.label} · ${api.fmt.fmtAgo(e.at)}` : e.meta.label }
          : {
            sub: e.gone ? 'Deleted from this device' : `${e.meta.label} · added ${api.fmt.fmtAgo(e.at)}`,
            playHere: e.kind === 'creation' && !e.gone,
            onRemove: x => { C.removeItem(col.id, x); api.notify({ app: 'Library', icon: 'trash', title: `Removed from ${col.name}`, message: x.title, timeout: 3000 }); },
            removeLabel: 'Remove from this collection',
          })));
      };
      let bar = null;
      if (kinds.length > 1) {
        const opts = [{ id: 'all', label: 'All', n: items.length },
          ...kinds.map(k => ({ id: k, label: C.KIND_META[k].short, icon: C.KIND_META[k].icon, n: items.filter(i => i.kind === k).length }))];
        bar = chips(opts, () => view.colKind, k => { view.colKind = k; paintItems(); }, 'Filter collection');
      }
      paintItems();
      page.appendChild(h('div.libx-colitems', bar, holder));
      if (col.rule && smartNote) page.appendChild(note(smartNote, 'alert'));
    }
    if (!col.rule) page.appendChild(await addShelf(col));
    return page;
  }

  /** "Add to this collection": pick from real sources, toggle in place */
  async function addShelf(col) {
    const inCol = new Set(col.items.map(C.keyOf));
    const [played, favs, arcade, watch, rbxFav, rbxRecent] = await Promise.all([
      playedRows(), favoriteGames(), arcadeMod(), watchRows(), robloxRows('portal.roblox.favs'), robloxRows('portal.roblox.recent')]);
    const uniq = rows => { const seen = new Set(); return rows.filter(e => { const k = `${e.kind}:${e.id}`; return !seen.has(k) && seen.add(k); }); };
    const sources = [
      { id: 'recent', label: 'Recently played', icon: 'clock', rows: played.slice(0, 30).map(r => entry(r)) },
      { id: 'favs', label: 'Favorites', icon: 'heart', rows: favs.slice(0, 30) },
      { id: 'arcade', label: 'Arcade', icon: 'zap', rows: arcade.map(a => entry({ kind: 'arcade', id: a.id, title: a.title }, { blurb: a.blurb, minutes: a.minutes, players: a.players })) },
      { id: 'created', label: 'Your creations', icon: 'sparkles', rows: [...projMap.values()].map(p => entry({ kind: 'creation', id: p.id, title: p.name })) },
      { id: 'watch', label: 'Watchlist', icon: 'bookmark', rows: watch.rows.map(r => r.entry) },
      { id: 'roblox', label: 'Roblox', icon: 'box', rows: uniq([...rbxFav, ...rbxRecent]).slice(0, 30) },
      { id: 'cloud', label: 'Cloud', icon: 'cast', rows: uniq([...cloudRows('portal.cloud.favs'), ...cloudRows('portal.cloud.played')]).slice(0, 30) },
    ].filter(s => s.rows.length);
    if (!sources.length) return h('div');
    if (!sources.some(s => s.id === view.addTab)) view.addTab = sources[0].id;

    const list = h('div.libx-add__list', { role: 'list' });
    const tabs = h('div.libx-chips', { role: 'group', 'aria-label': 'Add from' });
    const paintTabs = () => api.render(tabs, ...sources.map(s => h('button.libx-chip', {
      type: 'button', class: s.id === view.addTab ? 'is-on' : null, 'aria-pressed': String(s.id === view.addTab),
      dataset: { fk: `addtab:${s.id}` },
      onclick: () => { view.addTab = s.id; paintTabs(); paintList(); list.scrollTop = 0; },
    }, icon(s.icon), h('span', { text: s.label }), h('small', { text: String(s.rows.length) }))));
    const paintList = () => {
      const src = sources.find(s => s.id === view.addTab) || sources[0];
      list.dataset.sk = `add:${src.id}`;
      api.render(list, ...src.rows.map(e => {
        const k = `${e.kind}:${e.id}`;
        const on = inCol.has(k);
        const thumb = h('div.libx-add__art');
        fillArt(thumb, e);
        const sub = e.kind === 'arcade' ? [e.blurb, e.minutes ? `~${e.minutes} min` : '', arr(e.players).includes(2) ? '1–2 players' : ''].filter(Boolean).join(' · ')
          : e.kind === 'roblox' ? (e.creator ? `Roblox · ${e.creator}` : 'Roblox')
          : e.kind === 'cloud' ? (e.year ? `Cloud · ${e.year}` : 'Cloud') : e.meta.label;
        return h('div.libx-add__row', { role: 'listitem' },
          thumb,
          h('div.libx-add__b', h('b', { text: e.title }), h('small', { text: sub })),
          h('button.btn.btn--sm', {
            type: 'button', class: on ? 'is-added' : null, 'aria-pressed': String(on),
            'aria-label': on ? `Remove ${e.title} from ${col.name}` : `Add ${e.title} to ${col.name}`,
            dataset: { fk: `add:${k}` },
            onclick: () => { if (on) C.removeItem(col.id, e); else C.add(col.id, e); },
          }, icon(on ? 'check' : 'plus'), h('span', { text: on ? 'Added' : 'Add' })));
      }));
    };
    paintTabs();
    paintList();
    return group('Add to this collection', 'plus', null, h('div.libx-add', tabs, list));
  }

  /* ============================================================
     WATCHLIST
     ============================================================ */
  async function pageWatchlist() {
    const { rows, missing } = await watchRows();
    const page = h('div.libx-page', head({
      title: 'Watchlist',
      sub: 'Anime, manga and films you saved in Static Anime — the same list, shown here.',
      tools: btn('Open Static Anime', 'star', () => api.openApp('aether-anime', {}), '.btn--ghost.btn--sm'),
    }));
    if (!rows.length) {
      page.appendChild(empty('bookmark', missing ? 'Your saved titles could not be found' : 'Your watchlist is empty',
        missing ? `${plural(missing, 'saved id')} did not match the catalogue — it may still be loading, or the titles were removed.`
          : 'Open a title in Static Anime and press Add to Watchlist.',
        [btn('Browse anime', 'star', () => api.openApp('aether-anime', {}), '.btn--primary')]));
      return page;
    }
    const part = (k, title, ic) => {
      const rs = rows.filter(r => r.kind === k);
      if (!rs.length) return null;
      return group(title, ic, rs.length, grid(rs.map(r => r.entry), e => {
        const r = rs.find(x => x.entry === e);
        const p = r.progress;
        const unit = k === 'manga' ? 'Ch' : 'Ep';
        const total = e.total || (p && p.of) || 0;
        return {
          poster: true,
          sub: p && p.ep ? `${unit} ${p.ep}${total ? ` of ${total}` : ''}` : (total ? `${num(total)} ${k === 'manga' ? 'chapters' : 'episodes'}` : e.meta.label),
          progress: p && p.ep && total ? { ep: p.ep, of: total } : null,
          onRemove: () => removeFromWatch(r.token, e.title), removeLabel: 'Remove from Watchlist',
        };
      }, '.is-posters'));
    };
    for (const g of [part('anime', 'Anime', 'star'), part('manga', 'Manga', 'file-text'), part('movie', 'Films', 'film')]) if (g) page.appendChild(g);
    if (missing) page.appendChild(note(`${plural(missing, 'saved id')} did not match the catalogue and ${missing === 1 ? 'is' : 'are'} not shown.`, 'alert'));
    return page;
  }

  /* ============================================================
     MUSIC & LINKS (the old library's other shelves, kept)
     ============================================================ */
  async function pageSaved() {
    const spotify = arr(store.get('portal.spotify'));
    const bm = marks();
    const hostOf = url => { try { return new URL(url).host.replace(/^www\./, ''); } catch (e) { return String(url).slice(0, 40); } };
    const page = h('div.libx-page', head({ title: 'Music & Links', sub: 'Music you saved in Spotify and pages you bookmarked in the Browser or Proxy.' }));
    if (!spotify.length && !bm.length) {
      page.appendChild(empty('music', 'Nothing saved here yet', 'Save music in the Spotify app, or bookmark a page in the Browser or Proxy.'));
      return page;
    }
    const plain = (title, sub, ic, art, open, key) => {
      const e = { kind: 'link', id: key, title, art, ic, hue: hueOf(key), meta: { label: sub, short: ic === 'music' ? 'Music' : 'Link', icon: ic }, open };
      const a = h('div.libx-card__art');
      fillArt(a, e);
      return h('div.libx-card',
        a, h('div.libx-card__b', h('div.libx-card__t', { text: title }), h('div.libx-card__m', { text: sub })),
        h('button.libx-card__go', { type: 'button', 'aria-label': `Open ${title}`, onclick: open }));
    };
    if (spotify.length) page.appendChild(group('Music', 'music', spotify.length, h('div.libx-grid', spotify.map(it => plain(
      it.title || it.name || 'Saved', it.artist || it.kind || 'Spotify', 'music', it.art || null,
      () => api.openApp('spotify', { link: `https://open.spotify.com/${it.kind}/${it.id}` }), `sp:${it.kind}:${it.id}`)))));
    if (bm.length) page.appendChild(group('Bookmarks', 'bookmark', bm.length, h('div.libx-grid', bm.map(m => plain(
      m.title || hostOf(m.url), hostOf(m.url), 'globe', null,
      () => { store.set('proxy.pending', m.url); api.openApp('aether-proxy', {}); }, `mark:${m.url}`)))));
    return page;
  }

  /* ============================================================
     CREATED GAMES + PUBLISHED
     ============================================================ */
  function createdOpts(p) {
    if (!p) return {};
    const bits = [`Edited ${api.fmt.fmtAgo(p.updatedAt)}`, `${plural(p.versions.length, 'version')}`];
    const badge = p.published ? { label: 'Published', icon: 'upload', accent: true }
      : p.source === 'remix' ? { label: 'Remix', icon: 'git-branch' } : null;
    return { sub: bits.join(' · '), playHere: true, badge };
  }

  async function pageCreated() {
    await ensureMaps();
    const projs = [...projMap.values()];
    const forge = hasApp('forge');
    const page = h('div.libx-page', head({
      title: 'Created Games',
      sub: 'Games you made in Forge or Studio. Each keeps its whole version history, so any earlier state can come back.',
      tools: forge ? btn('New game', 'plus', () => api.openApp('forge', {}), '.btn--primary.btn--sm') : null,
    }));
    if (!projs.length) {
      page.appendChild(empty('sparkles', 'You have not made a game yet',
        forge ? 'Describe a game in Static Forge — it builds a first version you can play, then change by asking.'
          : 'Games you make in Static Forge are saved here. Forge is not part of this build yet.',
        forge ? [btn('Open Forge', 'sparkles', () => api.openApp('forge', {}), '.btn--primary')] : []));
      return page;
    }
    page.appendChild(grid(projs.map(p => entry({ kind: 'creation', id: p.id, title: p.name })), e => createdOpts(projMap.get(e.id))));
    page.appendChild(note('Creations live in this browser’s storage. Clearing site data for StaticOS deletes them.', 'hard-drive'));
    return page;
  }

  async function pagePublished() {
    await ensureMaps();
    const pubs = [...projMap.values()].filter(p => p.published).sort((a, b) => (b.published.at || 0) - (a.published.at || 0));
    const page = h('div.libx-page', head({
      title: 'Published',
      sub: 'Creations you published to your Workshop. There is no server behind StaticOS, so publishing lists a game here on this device — it is not uploaded, and nobody else can see it.',
    }));
    if (!pubs.length) {
      page.appendChild(empty('upload', 'Nothing published yet',
        'Publishing gives a creation a title, a description and controls, and puts it in your Workshop.',
        [btn('Created Games', 'sparkles', () => go('created'), '.btn--primary')]));
      return page;
    }
    page.appendChild(h('div.libx-pubs', pubs.map(p => {
      const pb = p.published;
      const e = entry({ kind: 'creation', id: p.id, title: pb.title || p.name });
      const art = h('div.libx-pub__art');
      fillArt(art, e, true);
      const updates = arr(pb.updates).length;
      return h('article.libx-pub', {
        oncontextmenu: ev => { ev.preventDefault(); menuFor(e, ev.clientX, ev.clientY); },
      },
        art,
        h('div.libx-pub__b',
          h('div.libx-pub__top',
            h('h3', { text: pb.title || p.name }),
            pb.category ? h('span.chip', { text: pb.category }) : null),
          pb.description ? h('p.libx-pub__d', { text: pb.description }) : h('p.libx-pub__d.is-missing', { text: 'No description.' }),
          h('dl.libx-pub__facts',
            h('div', h('dt', { text: 'Published' }), h('dd', { text: pb.at ? dateText(pb.at) : '—' })),
            h('div', h('dt', { text: 'Version' }), h('dd', { text: `v${(pb.version || 0) + 1}` })),
            h('div', h('dt', { text: 'Releases' }), h('dd', { text: String(updates || 1) })),
            h('div', h('dt', { text: 'Controls' }), h('dd', { text: pb.controls || 'Not listed' }))),
          h('div.libx-pub__acts',
            h('button.btn.btn--primary.btn--sm', { type: 'button', dataset: { fk: `pubplay:${p.id}` }, onclick: () => playCreation(p.id) }, icon('play', { fill: true }), h('span', { text: 'Play' })),
            hasApp('forge') ? btn('Open in Forge', 'external-link', () => api.openApp('forge', { project: p.id }), '.btn--sm') : null,
            h('button.btn.btn--ghost.btn--sm', { type: 'button', 'aria-haspopup': 'menu',
              onclick: ev => { const r = ev.currentTarget.getBoundingClientRect(); C.pickMenu(api, e, r.left, r.bottom + 4); } },
              icon('bookmark'), h('span', { text: 'Add to collection…' })))));
    })));
    return page;
  }

  /* ============================================================
     CLIPS — Static Replay
     ============================================================ */
  async function pageClips() {
    await ensureMaps({ projects: false });
    const { clips, broken, failed } = await clipList();
    const arcade = hasApp('arcade');
    const page = h('div.libx-page', head({
      title: 'Clips',
      sub: 'Short replays you saved from Static Arcade. They are recorded and kept in this browser only — nothing is uploaded.',
      tools: arcade && clips.length ? btn('Open the Arcade', 'zap', () => api.openApp('arcade', {}), '.btn--ghost.btn--sm') : null,
    }));
    /* forget object URLs of clips that are gone */
    const keep = new Set(clips.map(c => c._key));
    for (const [k, v] of clipUrls) if (!keep.has(k)) { URL.revokeObjectURL(v.url); clipUrls.delete(k); }
    if (!clips.length) {
      page.appendChild(failed
        ? empty('alert', 'Clips could not be read', 'This browser refused access to the storage where clips are kept (private windows often do). Nothing was deleted.',
            [btn('Try again', 'refresh', () => paintMain(false), '.btn--primary')])
        : empty('film', 'No clips yet',
            arcade ? 'In Static Arcade, press Record while you play — the replay you save shows up here to watch, download or delete.'
              : 'Replays saved from Static Arcade show up here. The Arcade is not part of this build.',
            arcade ? [btn('Open the Arcade', 'zap', () => api.openApp('arcade', {}), '.btn--primary')] : []));
      if (broken.length) page.appendChild(brokenNote(broken));
      if (!failed) deepLinkClip([]);
      return page;
    }
    const extOf = mime => (/mp4/.test(mime || '') ? 'mp4' : 'webm');
    const safe = s => String(s || 'clip').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'clip';
    let totalBytes = 0;
    const cards = clips.map((c, i) => {
      const sig = `${c.blob.size}:${c.at}:${c.blob.type}`;
      let cached = clipUrls.get(c._key);
      if (cached && cached.sig !== sig) { URL.revokeObjectURL(cached.url); cached = null; }
      if (!cached) { cached = { url: URL.createObjectURL(c.blob), sig }; clipUrls.set(c._key, cached); }
      const url = cached.url;
      totalBytes += c.blob.size || 0;
      const gameTitle = arcadeMap.get(c.game)?.title || c.game || '';
      const title = String(c.title || gameTitle || 'Clip');
      const dur = Number(c.durationMs) > 0 ? api.fmt.fmtDur(Math.max(1, Math.round(c.durationMs / 1000))) : null;
      const file = `${safe(title)}${c.at ? ` ${new Date(c.at).toISOString().slice(0, 10)}` : ''}.${extOf(c.mime || c.blob.type)}`;
      const vid = h('video', { src: `${url}#t=0.1`, preload: 'metadata', playsinline: true, 'aria-hidden': 'true', tabindex: '-1', disablepictureinpicture: true });
      vid.muted = true;
      /* the player owns its own object URL: a live refresh of this list
         (another clip saved, one deleted in the Arcade) can never revoke
         the video that is playing */
      const openPlayer = () => {
        const own = URL.createObjectURL(c.blob);
        overlay({
          title, sub: [gameTitle && gameTitle !== title ? gameTitle : '', c.at ? dateText(c.at) : '', dur].filter(Boolean).join(' · '),
          actions: [h('a.btn.btn--sm', { href: own, download: file }, icon('download'), h('span', { text: 'Download' }))],
          mount: stage => {
            stage.classList.add('is-video');
            const v = h('video.libx-ov__video', { src: own, controls: true, playsinline: true, autoplay: !reduced(store), 'aria-label': `Clip: ${title}` });
            stage.appendChild(v);
            return () => { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(own); };
          },
        });
      };
      const when = c.at ? h('time', { datetime: new Date(c.at).toISOString(), title: new Date(c.at).toLocaleString(), text: api.fmt.fmtAgo(c.at) }) : null;
      return h('article.libx-clip',
        h('div.libx-clip__media', vid,
          dur ? h('span.libx-clip__dur', { text: dur, 'aria-hidden': 'true' }) : null,
          h('button.libx-clip__play', { type: 'button', 'aria-label': `Play clip ${title}${dur ? `, ${dur} long` : ''}`, dataset: { fk: `clip:${c._key}` }, onclick: openPlayer },
            h('i', icon('play', { fill: true })))),
        h('div.libx-clip__b',
          h('div.libx-clip__t', h('b', { text: title }),
            h('small', gameTitle && gameTitle !== title ? h('span', { text: `${gameTitle} · ` }) : null, when)),
          h('div.libx-clip__acts',
            h('a.ibtn.tip', { href: url, download: file, 'aria-label': `Download ${title}`, 'data-tip': 'Download', dataset: { fk: `clipdl:${c._key}` } }, icon('download')),
            h('button.ibtn.tip.libx-danger', { type: 'button', 'aria-label': `Delete ${title}`, 'data-tip': 'Delete', dataset: { fk: `clipdel:${c._key}` },
              onclick: async () => {
                const ok = await confirmKeep({ title: `Delete “${title}”?`, message: 'The clip is removed from this browser. Download it first if you want to keep it.', ok: 'Delete', danger: true });
                if (!ok || dead) return;
                const D = await dbMod();
                try { await D.kv('clips').del(c._key); } catch (err) {
                  api.notify({ app: 'Library', icon: 'alert', title: 'Could not delete the clip', message: String(err && err.message || err) });
                  return;
                }
                /* keep the keyboard where it was: the next clip, else the previous, else the heading */
                const next = clips[i + 1] || clips[i - 1];
                if (next) wantFk = `clip:${next._key}`; else focusHeading = true;
                api.notify({ app: 'Library', icon: 'trash', title: 'Clip deleted', message: title, timeout: 3000 });
                api.bus.emit('clips:change', { kind: 'delete', id: c._key });
              } }, icon('trash')))));
    });
    page.appendChild(h('div.libx-clips', cards));
    page.appendChild(note(`${plural(clips.length, 'clip')} · ${api.fmt.fmtBytes(totalBytes)} in this browser’s storage.`, 'hard-drive'));
    if (broken.length) page.appendChild(brokenNote(broken));
    deepLinkClip(clips);
    return page;
  }

  /* static://library/clips/<id>: open that clip once the page is on screen
     (after paintMain has placed focus, so the player keeps it) */
  function deepLinkClip(clips) {
    if (!clipToOpen) return;
    const want = clipToOpen;
    clipToOpen = null;
    const i = clips.findIndex(c => c._key === want || c.id === want);
    if (i < 0) {
      api.notify({ app: 'Library', icon: 'film', title: 'That clip is not in this browser',
        message: 'It was deleted, or it was saved on another device. Your other clips are listed here.', timeout: 5000 });
      return;
    }
    wantFk = `clip:${clips[i]._key}`;
    setTimeout(() => { if (!dead) main.querySelector(`[data-fk="${CSS.escape(`clip:${clips[i]._key}`)}"]`)?.click(); }, 0);
  }

  /** stored rows with no playable video (an interrupted save): say so, offer to clear them */
  function brokenNote(keys) {
    return h('div.libx-note.libx-note--act', icon('alert'),
      h('span', { text: `${plural(keys.length, 'saved clip')} ${keys.length === 1 ? 'has' : 'have'} no video data and cannot be played.` }),
      h('button.btn.btn--ghost.btn--sm', { type: 'button', dataset: { fk: 'clipclean' },
        onclick: async () => {
          const D = await dbMod();
          for (const k of keys) { try { await D.kv('clips').del(k); } catch (err) { /* already gone */ } }
          if (!dead) focusHeading = true;
          api.bus.emit('clips:change', { kind: 'delete', ids: keys });
        } }, icon('trash'), h('span', { text: keys.length === 1 ? 'Remove it' : 'Remove them' })));
  }

  /* ============================================================
     ACHIEVEMENTS
     ============================================================ */
  function achCard(a) {
    const hidden = a.secret && !a.unlocked;
    const pct = a.goal ? Math.round(((a.progress || 0) / a.goal) * 100) : 0;
    return h('article.libx-ach', { class: a.unlocked ? 'is-on' : hidden ? 'is-secret' : null },
      h('div.libx-ach__ic', icon(hidden ? 'lock' : a.icon || 'star')),
      h('div.libx-ach__b',
        h('b', { text: hidden ? 'Secret achievement' : a.name }),
        h('small', { text: hidden ? 'Hidden until you find it.' : a.desc }),
        a.unlocked
          ? h('div.libx-ach__when', icon('check'), h('span', { text: `Unlocked ${dateText(a.at)}` }))
          : a.goal && !hidden
            ? h('div.libx-ach__prog',
                h('div.libx-prog.is-inline', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(a.goal),
                  'aria-valuenow': String(a.progress || 0), 'aria-label': `${a.name} progress` }, h('i', { style: { width: `${Math.max(pct, 2)}%` } })),
                h('span', { text: `${num(a.progress || 0)} / ${num(a.goal)}` }))
            : h('div.libx-ach__when.is-locked', icon('lock'), h('span', { text: 'Locked' }))));
  }

  async function pageAchievements() {
    const A = await achMod();
    const all = A ? A.list(playStats()) : [];
    const got = all.filter(a => a.unlocked).sort((a, b) => b.at - a.at);
    const left = all.filter(a => !a.unlocked)
      .sort((a, b) => (a.secret ? 1 : 0) - (b.secret ? 1 : 0) || ((b.goal ? b.progress / b.goal : 0) - (a.goal ? a.progress / a.goal : 0)));
    const pct = all.length ? Math.round((got.length / all.length) * 100) : 0;
    const page = h('div.libx-page', head({
      title: 'Achievements',
      sub: 'Small rewards for exploring StaticOS. Each one marks something you really did on this device.',
    }));
    if (!all.length) {
      page.appendChild(empty('star', 'Achievements are not available', 'The achievements module did not load in this build.'));
      return page;
    }
    page.appendChild(h('div.libx-achsum',
      h('div.libx-ring', { style: { '--p': String(pct) }, role: 'img', 'aria-label': `${got.length} of ${all.length} unlocked` },
        h('b', { text: `${pct}%` })),
      h('div.libx-achsum__b',
        h('b', { text: `${got.length} of ${all.length} unlocked` }),
        h('small', { text: `${plural(plays.count(), 'different game')} played · ${plural(plays.total(), 'launch', 'launches')} in all` }))));
    if (got.length) page.appendChild(group('Unlocked', 'check', got.length, h('div.libx-achs', got.map(achCard))));
    if (left.length) page.appendChild(group('Still to earn', 'lock', left.length, h('div.libx-achs', left.map(achCard))));
    return page;
  }
}

export default { buildLibrary };
