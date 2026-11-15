/* ============================================================
   Browser — tabbed browser whose start page IS the Static portal.

   Rendered locally by this file:
     static://home   static://apps   static://about
     static://bookmarks   (folders, rename, search, export)
     static://history     (this session only, in memory)
   Rendered by the portal in js/portal/ (loaded lazily):
     static://games   static://games/<id>
     static://movies  static://movies/<id>
     static://anime   static://anime/<id>
     static://manga   static://manga/<id>
     static://search?q=…   static://arcade   static://proxy   static://apply
   static:// is accepted as an alias for all of them (see js/portal/brand.js).
   Anything else resolves to an offline page.

   Tabs: Ctrl/Cmd+T new, +W close, +Shift+T reopen the last closed one,
   Ctrl+Tab / Ctrl+Shift+Tab next / previous. Tabs can be dragged to
   reorder and pinned. The open tabs are saved (portal.browser.tabs) and
   come back after a reload. Bookmarks live in portal.browser.bm; the bar
   under the address bar shows them.

   Game pages DO frame their real source (their hosts allow it);
   everything else stays local until a proxy is configured.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { BRAND, canon } from '../portal/brand.js';
import { appTile } from '../core/appart.js';
import * as M from '../core/metrics.js';

/**
 * Open a real background tab. Passing a features string (even just 'noopener')
 * makes the browser treat this as a popup-window request, so the link opens in
 * a chrome-less window instead of a tab; clearing `opener` by hand gives the
 * same protection without that side effect.
 */
/* The portal is imported lazily so a fault in one page module degrades to
   "that page does not render" instead of taking the whole Browser app —
   and so the 7.9 MB anime catalogue is never touched until asked for. */
let PAGES = null, PROVIDERS = null, pagesErr = null;
const repaints = new Set();
const portalReady = Promise.all([
  import('../portal/pages.js?v=ps5-cloud-proxy-v12'),
  import('../portal/providers.js'),
]).then(([pages, prov]) => {
  PAGES = pages;
  PROVIDERS = prov.providers || prov.default || prov;
}).catch(err => {
  pagesErr = err;
  console.error('[portal] failed to load:', err);
}).finally(() => {
  for (const fn of repaints) { try { fn(); } catch (e) { console.error(e); } }
});

const HOME = 'static://home';
const APPS = 'static://apps';
const ABOUT = 'static://about';
const BOOKMARKS = 'static://bookmarks';
const HISTORY = 'static://history';
/* one window at a time keeps the saved tabs, so two Browsers do not overwrite each other */
let tabOwner = null;

/* the seven circles under the search box */
const TILES = [
  { n: 'Games', ic: 'gamepad', url: 'static://games' },
  { n: 'Anime', ic: 'star', url: 'static://anime' },
  { n: 'Movies', ic: 'film', url: 'static://movies' },
  { n: 'Music', ic: 'music', app: 'music' },
  { n: 'Cloud', ic: 'cast', url: 'static://cloud' },
  { n: 'Proxy', ic: 'shield', url: 'static://proxy' },
  { n: 'Chat', ic: 'message-circle', app: 'chat' },
  { n: 'All Apps', ic: 'grid-9', url: APPS },
];

/* bare words typed in the address bar that mean a portal page */
const KEYWORDS = {
  games: 'static://games', movies: 'static://movies', anime: 'static://anime',
  manga: 'static://manga', arcade: 'static://arcade', proxy: 'static://proxy',
  cloud: 'static://cloud',
  apply: 'static://apply', search: 'static://search',
};

/* {Q} title-case query · {q} raw query · {s} slug */
const RESULTS = [
  ['{Q} — Wikipedia', 'https://en.wikipedia.org › wiki › {s}',
    'An overview of {q}: origins, notable variants, and the people still arguing about it on the talk page.'],
  ['{Q} · GitHub Topics', 'https://github.com › topics › {s}',
    '1,204 public repositories tagged {s}. Sorted by stars, most recently pushed four hours ago.'],
  ['The complete guide to {q}', 'https://cherri.dev › guides › {s}',
    'Everything we learned shipping {q} in production, including the three things we would never do again.'],
  ['r/{s} — “{q}” megathread', 'https://reddit.com › r › {s}',
    '312 comments · top comment: “honestly {q} is fine once you stop reading the docs”.'],
  ['{Q} reference — Static Docs', 'https://docs.aether.dev › search?q={s}',
    'API reference, worked examples and migration notes for {q}. Updated for StaticOS.'],
];

defineApp({
  id: 'browser',
  name: 'Browser',
  icon: 'globe',
  g1: '#86c8ff', g2: '#1a5bd0',
  category: 'Internet',
  keywords: ['web', 'cherri', 'internet', 'search', 'tabs', 'url'],
  desc: 'Browse cherri and the local web',
  pinned: true, dock: true,
  win: { w: 860, h: 560, minW: 520, minH: 340 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, fmt, store } = api;

    /* ---------------- state ---------------- */
    let seq = 0;
    /* Bookmarks outlive the window: they are read back out of the store on
       mount and written on every change. Before this they lived only in the
       Set, so closing the Browser silently threw them away. */
    const MARKS_KEY = 'portal.browser.marks';      /* the old flat list of addresses: read once to migrate, then mirrored */
    const BM_KEY = 'portal.browser.bm';            /* { v:1, folders:[{id,name}], items:[{id,url,title,folder}] } */
    const BAR_KEY = 'portal.browser.bar';          /* show the bookmarks bar (default yes) */
    const TABS_KEY = 'portal.browser.tabs';        /* { v:1, active, tabs:[{url,history,idx,pin}] } */

    const bid = () => `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const okUrl = u => typeof u === 'string' && u.length <= 2000 && /^[a-z][\w+.-]*:\/\//i.test(u);
    function readBm() {
      const raw = store.get(BM_KEY);
      if (raw && typeof raw === 'object' && Array.isArray(raw.items)) {
        const folders = (Array.isArray(raw.folders) ? raw.folders : [])
          .filter(f => f && typeof f.id === 'string' && typeof f.name === 'string')
          .map(f => ({ id: f.id, name: f.name.slice(0, 60) }));
        const have = new Set(folders.map(f => f.id));
        const items = raw.items.filter(i => i && typeof i.id === 'string' && okUrl(i.url))
          .map(i => ({ id: i.id, url: i.url, title: typeof i.title === 'string' ? i.title.slice(0, 200) : '', folder: have.has(i.folder) ? i.folder : '' }));
        return { v: 1, folders, items };
      }
      /* first run on the new shape: the old bookmarks come along, unfiled */
      const old = store.get(MARKS_KEY, []);
      return { v: 1, folders: [], items: (Array.isArray(old) ? old : []).filter(okUrl).slice(0, 500).map(url => ({ id: bid(), url, title: '', folder: '' })) };
    }
    /* change the bookmarks: read, let fn edit, save a fresh copy, tell every view */
    function updateBm(fn) {
      const d = readBm();
      fn(d);
      store.set(BM_KEY, JSON.parse(JSON.stringify(d)));
      /* the flat list of addresses is kept in step, for older builds and backups that still read it */
      store.set(MARKS_KEY, d.items.map(i => i.url));
      bmViews.forEach(f => { try { f(); } catch (e) { console.error(e); } });
      paintNav(); paintBar();
    }
    const bmViews = new Set();        /* redraw functions of the open Bookmarks pages */
    const histViews = new Set();      /* … and History pages */
    const markOf = u => readBm().items.find(i => i.url === u) || null;

    const S = {
      tabs: [],            // {id,title,url,history,idx,pin}
      active: '',
      loading: false,
      closed: [],          // tabs closed in this window, newest last (for Reopen closed tab)
      hist: [],            // {url,at}: static:// pages opened through this window's routes, newest first. Memory only.
    };
    const owner = {};                 /* this window; the first one open keeps the saved tabs */
    if (!tabOwner) tabOwner = owner;
    const HIST_MAX = 200, CLOSED_MAX = 15;
    const NO_HIST = new Set([HOME, BOOKMARKS, HISTORY]);
    /** Remember a page opened through one of the Browser's own static:// routes (this session only). */
    function visit(u) {
      if (!/^static:\/\//i.test(u) || NO_HIST.has(u)) return;
      const last = S.hist[0];
      if (last && last.url === u && Date.now() - last.at < 2000) return;
      S.hist.unshift({ url: u, at: Date.now() });
      if (S.hist.length > HIST_MAX) S.hist.length = HIST_MAX;
      histViews.forEach(f => f());
    }
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
      return t;
    };

    /* `.brw__tab span` in apps.css also matches icon spans, so pin their box. */
    const tabIcon = n => { const e = icon(n); e.style.flex = '0 0 auto'; return e; };

    /* ---------------- urls ----------------- */
    const slug = s => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || 'cherri';
    const hostOf = u => u.replace(/^[a-z][\w+.-]*:\/\//i, '').split(/[/?#]/)[0] || u;
    const isLocal = u => /^(static|cherri|aether):\/\//.test(u);
    const queryOf = u => { const i = u.indexOf('?q='); return i < 0 ? '' : decodeURIComponent(u.slice(i + 3)); };
    const search = q => `static://search?q=${encodeURIComponent(q)}`;

    function normalize(raw) {
      const s = String(raw || '').trim();
      const low = s.toLowerCase();
      if (!s || low === 'home' || low === 'aether:' || low === 'cherri:'
          || canon(low) === HOME) return HOME;
      if (low === 'apps' || canon(low) === APPS) return APPS;
      if (low === 'about' || low === ABOUT) return ABOUT;
      if (low === 'bookmarks' || low === BOOKMARKS) return BOOKMARKS;
      if (low === 'history' || low === HISTORY) return HISTORY;
      if (KEYWORDS[low]) return KEYWORDS[low];
      if (/^(aether|cherri):\/\/search/.test(low)) return canon(s);
      if (/^cherri:\/\//.test(low)) return canon(s);
      if (/^[a-z][\w+.-]*:\/\//i.test(s)) return s;
      if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(s)) return `https://${s}`;
      return search(s);
    }

    function titleOf(u) {
      if (u === HOME) return BRAND.name;
      if (u === APPS) return 'All Apps';
      if (u === ABOUT) return 'About StaticOS';
      if (u === BOOKMARKS) return 'Bookmarks';
      if (u === HISTORY) return 'History (this session)';
      const portalTitle = PAGES && PAGES.titleOf(u);
      if (portalTitle) return portalTitle;
      if (u.startsWith('static://search')) return `${queryOf(u) || 'Search'} — ${BRAND.name}`;
      return hostOf(u);
    }

    function faviconOf(u) {
      if (u === HOME) return BRAND.icon;
      if (u === APPS) return 'grid-9';
      if (u === ABOUT) return 'info';
      if (u === BOOKMARKS) return 'bookmark';
      if (u === HISTORY) return 'clock';
      const portalIcon = PAGES && PAGES.iconOf(u);
      if (portalIcon) return portalIcon;
      if (u.startsWith('static://search')) return 'search';
      return 'globe';
    }

    /* ---------------- tabs ----------------- */
    const cur = () => S.tabs.find(t => t.id === S.active) || null;
    const curUrl = () => { const t = cur(); return t ? t.url : HOME; };
    /* pinned tabs sit together at the start, in the order they were left */
    const pinFirst = () => { S.tabs = [...S.tabs.filter(t => t.pin), ...S.tabs.filter(t => !t.pin)]; };

    function newTab(url = HOME) {
      const u = normalize(url);
      const t = { id: `t${++seq}`, title: titleOf(u), url: u, history: [u], idx: 0, pin: false };
      S.tabs.push(t);
      S.active = t.id;
      visit(u);
      paintAll();
      return t;
    }

    function selectTab(id) { if (id !== S.active) { S.active = id; paintAll(); } }
    function nextTab(d) {
      if (S.tabs.length < 2) return;
      const i = S.tabs.findIndex(t => t.id === S.active);
      selectTab(S.tabs[(i + d + S.tabs.length) % S.tabs.length].id);
    }

    function closeTab(id) {
      const i = S.tabs.findIndex(t => t.id === id);
      if (i < 0) return;
      const [gone] = S.tabs.splice(i, 1);
      S.closed.push({ url: gone.url, history: gone.history.slice(), idx: gone.idx, pin: !!gone.pin });
      if (S.closed.length > CLOSED_MAX) S.closed.shift();
      if (!S.tabs.length) { saveTabs(); return win.close(); }        // last tab closes the window
      const wasActive = S.active === id;
      if (wasActive) S.active = S.tabs[Math.min(i, S.tabs.length - 1)].id;
      /* Only the tab strip changed when a background tab closed: a full
         paintAll() would tear down and remount the active tab's page, losing
         its scroll position and any running game frame. */
      if (wasActive) paintAll();
      else { paintTabs(); paintNav(); }
    }

    /** Bring back the tab closed last, with its back/forward trail. */
    function reopenTab() {
      const c = S.closed.pop();
      if (!c) return false;
      const t = { id: `t${++seq}`, title: titleOf(c.url), url: c.url, history: c.history, idx: c.idx, pin: c.pin };
      S.tabs.push(t);
      pinFirst();
      S.active = t.id;
      paintAll();
      return true;
    }

    function pinTab(id, on) {
      const t = S.tabs.find(x => x.id === id);
      if (!t) return;
      t.pin = on;
      /* a tab that is pinned goes to the end of the pinned ones; unpinned, to the front of the rest */
      S.tabs = S.tabs.filter(x => x !== t);
      const n = S.tabs.filter(x => x.pin).length;
      S.tabs.splice(n, 0, t);
      paintTabs(); paintNav();
    }

    /** Drop the dragged tab where the other one is. */
    function moveTab(fromId, toId) {
      const f = S.tabs.findIndex(t => t.id === fromId), t = S.tabs.findIndex(x => x.id === toId);
      if (f < 0 || t < 0 || f === t) return;
      const [tab] = S.tabs.splice(f, 1);
      S.tabs.splice(t, 0, tab);
      pinFirst();
      paintTabs(); paintNav();
    }

    /* ---- the open tabs survive a reload ---- */
    let lastSaved = '';
    function saveTabs() {
      if (tabOwner !== owner) return;
      const data = {
        v: 1,
        active: Math.max(0, S.tabs.findIndex(t => t.id === S.active)),
        tabs: S.tabs.map(t => {
          const from = Math.max(0, t.history.length - 30);      /* the last 30 steps of its trail */
          return { url: t.url, history: t.history.slice(from), idx: t.idx - from, pin: !!t.pin };
        }),
      };
      const json = JSON.stringify(data);
      if (json === lastSaved) return;
      lastSaved = json;
      store.set(TABS_KEY, JSON.parse(json));
    }
    function savedTabs() {
      const raw = store.get(TABS_KEY);
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tabs)) return null;
      const tabs = raw.tabs.slice(0, 40).filter(t => t && okUrl(t.url)).map(t => {
        const history = (Array.isArray(t.history) ? t.history : []).filter(okUrl).slice(-30);
        const url = t.url;
        if (history[history.length - 1] !== url) history.push(url);
        const idx = Number.isInteger(t.idx) && t.idx >= 0 && t.idx < history.length && history[t.idx] === url ? t.idx : history.length - 1;
        return { url, history, idx, pin: t.pin === true };
      });
      return tabs.length ? { tabs, active: Number.isInteger(raw.active) ? raw.active : 0 } : null;
    }

    /* ---------------- navigation ----------- */
    function navigate(raw) {
      const t = cur();
      if (!t) return newTab(raw);
      const u = normalize(raw);
      if (u !== t.url) {
        t.history.length = t.idx + 1;
        t.history.push(u);
        t.idx = t.history.length - 1;
      }
      t.url = u;
      t.title = titleOf(u);
      visit(u);
      load();
    }

    function step(d) {
      const t = cur();
      if (!t) return;
      const next = t.idx + d;
      if (next < 0 || next >= t.history.length) return;
      t.idx = next;
      t.url = t.history[next];
      t.title = titleOf(t.url);
      visit(t.url);
      load();
    }
    const back = () => step(-1);
    const fwd = () => step(1);

    /** paint everything, then drop the spinner a beat later */
    function load() {
      S.loading = true;
      paintAll();
      later(() => { S.loading = false; paintNav(); }, 220);
    }

    const nope = name => api.notify({
      app: BRAND.name, icon: 'globe', title: 'Not available',
      message: `${name} is not available in this build.`,
    });
    const launch = (id, label) => (api.getApp(id) ? api.openApp(id) : nope(label));

    /* ---------------- chrome --------------- */
    /* The tab row scrolls sideways, but "+" must not scroll out of reach,
       so the scroller is an inner box and the button is pinned beside it. */
    const tabStrip = h('div.scroll-none', {
      role: 'tablist', 'aria-label': 'Tabs',
      style: {
        display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
        flex: '1 1 auto', minWidth: '0', overflowX: 'auto',
      },
    });
    /* Native title, not .tip: the button sits hard against the right edge,
       and a .tip bubble is centred on it, so 8px of it would be cut off by
       .win__body's overflow:hidden (and would pad the app's scrollWidth). */
    const btnNew = h('button.ibtn', {
      title: 'New tab (Ctrl+T)', 'aria-label': 'New tab',
      style: { flex: '0 0 auto' },
      onclick: () => newTab(),
    }, icon('plus'));
    const tabsEl = h('div.brw__tabs', tabStrip, btnNew);

    const btnBack = h('button.ibtn.tip', { 'data-tip': 'Back', 'aria-label': 'Back', onclick: back }, icon('chevron-left'));
    const btnFwd = h('button.ibtn.tip', { 'data-tip': 'Forward', 'aria-label': 'Forward', onclick: fwd }, icon('chevron-right'));
    const btnReload = h('button.ibtn.tip', { 'data-tip': 'Reload', 'aria-label': 'Reload', onclick: () => load() }, icon('refresh'));

    const urlIn = h('input', {
      type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Address and search bar',
      onkeydown: e => { if (e.key === 'Escape') { urlIn.value = curUrl(); urlIn.blur(); } },
    });
    const urlBox = h('form.field.brw__url', {
      onsubmit: e => { e.preventDefault(); navigate(urlIn.value); urlIn.blur(); },
    }, icon('lock'), urlIn);

    const btnStar = h('button.ibtn.tip', { 'data-tip': 'Bookmark', 'aria-label': 'Bookmark this page', onclick: star }, icon('star'));
    const btnMore = h('button.ibtn.tip', { 'data-tip': 'More', 'aria-label': 'More', onclick: e => moreMenu(e) }, icon('more-horizontal'));

    const bar = h('div.brw__bar.scroll-none', { role: 'toolbar', 'aria-label': 'Bookmarks bar' });
    const view = h('div.brw__view');
    root.appendChild(h('div.app', h('div.brw',
      tabsEl,
      h('div.brw__nav', btnBack, btnFwd, btnReload, urlBox, btnStar, btnMore),
      bar,
      view)));

    win.setTools(
      h('button.ibtn.tip', {
        'data-tip': 'Search', 'aria-label': 'Search',
        onclick: () => { urlIn.focus(); urlIn.select(); },
      }, icon('search')),
      h('button.ibtn.tip', { 'data-tip': 'Start page', 'aria-label': 'Start page', onclick: () => navigate(HOME) }, icon('home')),
    );

    const bmTitle = i => i.title || titleOf(i.url);

    function star() {
      const u = curUrl();
      if (markOf(u)) updateBm(d => { d.items = d.items.filter(i => i.url !== u); });
      else {
        updateBm(d => { d.items.push({ id: bid(), url: u, title: '', folder: '' }); });
        api.notify({ app: 'Browser', icon: 'star', title: 'Bookmarked', message: titleOf(u) });
      }
    }

    const barOn = () => store.get(BAR_KEY, true) !== false;
    function setBar(on) { store.set(BAR_KEY, !!on); paintBar(); }

    function moreMenu(e) {
      const items = readBm().items;
      api.menu([
        { label: 'New tab', icon: 'plus', hint: 'Ctrl+T', onClick: () => newTab() },
        { label: 'Reopen closed tab', icon: 'rotate-ccw', hint: 'Ctrl+Shift+T', disabled: !S.closed.length, onClick: () => reopenTab() },
        { label: 'Duplicate tab', icon: 'copy', onClick: () => newTab(curUrl()) },
        { label: 'Reload', icon: 'refresh', onClick: () => load() },
        '-',
        { label: 'Bookmarks', icon: 'bookmark', hint: 'all, with folders', onClick: () => navigate(BOOKMARKS) },
        { label: 'History', icon: 'clock', hint: 'this session', onClick: () => navigate(HISTORY) },
        { label: barOn() ? 'Hide bookmarks bar' : 'Show bookmarks bar', icon: 'eye', onClick: () => setBar(!barOn()) },
        '-',
        ...(items.length
          ? items.slice(0, 8).map(i => ({
              label: bmTitle(i), icon: faviconOf(i.url), hint: hostOf(i.url), onClick: () => navigate(i.url),
            }))
          : [{ label: 'No bookmarks yet', icon: 'star', disabled: true }]),
      ], e.clientX, e.clientY);
    }

    function tabMenu(e, t) {
      e.preventDefault(); e.stopPropagation();
      api.menu([
        { label: 'Reload', icon: 'refresh', onClick: () => { selectTab(t.id); load(); } },
        { label: 'Duplicate', icon: 'copy', onClick: () => newTab(t.url) },
        { label: t.pin ? 'Unpin tab' : 'Pin tab', icon: 'pin', onClick: () => pinTab(t.id, !t.pin) },
        '-',
        { label: 'Close tab', icon: 'x', onClick: () => closeTab(t.id) },
        { label: 'Close other tabs', icon: 'layers', disabled: S.tabs.length < 2,
          onClick: () => { S.tabs = S.tabs.filter(x => x.id === t.id); S.active = t.id; paintAll(); } },
        { label: 'Reopen closed tab', icon: 'rotate-ccw', disabled: !S.closed.length, onClick: () => reopenTab() },
      ], e.clientX, e.clientY);
    }

    /* ---------------- the bookmarks bar ---- */
    let renameNext = null;           /* a bookmark the Bookmarks page should open in rename mode */
    function barItemMenu(e, i) {
      e.preventDefault(); e.stopPropagation();
      api.menu([
        { label: 'Open', icon: 'external-link', onClick: () => navigate(i.url) },
        { label: 'Open in new tab', icon: 'plus', onClick: () => newTab(i.url) },
        { label: 'Rename…', icon: 'edit-3', onClick: () => { renameNext = i.id; navigate(BOOKMARKS); } },
        '-',
        { label: 'Remove bookmark', icon: 'trash', danger: true, onClick: () => updateBm(d => { d.items = d.items.filter(x => x.id !== i.id); }) },
      ], e.clientX, e.clientY);
    }
    function paintBar() {
      const d = readBm();
      const on = barOn() && d.items.length > 0;
      bar.hidden = !on;
      api.clear(bar);
      if (!on) return;
      const mark = i => h('button.brw__mark', {
        title: `${bmTitle(i)} — ${i.url}`, 'data-bm': i.id,
        onclick: () => navigate(i.url), oncontextmenu: e => barItemMenu(e, i),
      }, tabIcon(faviconOf(i.url)), h('span', { text: bmTitle(i) }));
      for (const i of d.items.filter(x => !x.folder)) bar.appendChild(mark(i));
      for (const f of d.folders) {
        const kids = d.items.filter(i => i.folder === f.id);
        const btn = h('button.brw__mark', {
          title: `${f.name} — ${kids.length} bookmark${kids.length === 1 ? '' : 's'}`, 'data-folder': f.id,
          onclick: () => {
            const r = btn.getBoundingClientRect();
            api.menu(kids.length
              ? kids.map(i => ({ label: bmTitle(i), icon: faviconOf(i.url), hint: hostOf(i.url), onClick: () => navigate(i.url) }))
              : [{ label: 'Empty folder', icon: 'folder', disabled: true }], r.left, r.bottom + 2);
          },
        }, tabIcon('folder'), h('span', { text: f.name }), tabIcon('chevron-down'));
        bar.appendChild(btn);
      }
    }

    /* ---------------- cherri start page ---- */
    const tile = t => h('button.start__app', {
      onclick: () => (t.url ? navigate(t.url) : t.app ? launch(t.app, t.n) : nope(t.n)),
    }, h('div.start__circle', icon(t.ic)), h('span', { text: t.n }));

    function pageHome() {
      const input = h('input', {
        type: 'search', placeholder: 'Search for anything!', spellcheck: 'false', 'aria-label': `Search ${BRAND.name}`,
      });

      return h('div.start',
        h('div.start__logo', { text: BRAND.wordmark }),
        h('div.start__tag', { text: BRAND.tagline }),
        h('form.field.start__search', {
          onsubmit: e => { e.preventDefault(); const q = input.value.trim(); if (q) navigate(search(q)); },
        }, icon('search'), input),
        h('div.start__apps', TILES.map(tile)),
        h('button.start__discord', { onclick: () => launch('chat', 'Discord') },
          h('i', icon('message-circle')),
          h('b', { text: 'Open Discord' }),
          h('span.dim', { text: 'inside Static Chat' })),
        h('div.start__foot', { text: BRAND.footer }));
    }

    /* ---------------- search results ------- */
    function pageResults(q) {
      if (!q) {
        return h('div.empty', icon('search'), h('b', { text: 'Nothing to search for' }),
          h('small', { text: 'Type a query in the address bar, or go back to the start page.' }),
          h('button.btn', { onclick: () => navigate(HOME) }, icon(BRAND.icon, { size: 14 }), 'Start page'));
      }
      const s = slug(q), Q = q.charAt(0).toUpperCase() + q.slice(1);
      const fill = str => str.replace(/\{Q\}/g, Q).replace(/\{q\}/g, q).replace(/\{s\}/g, s);
      const rnd = fmt.seeded([...s].reduce((a, c) => a + c.charCodeAt(0), 7));
      const total = Math.floor(9000 + rnd() * 940000);
      const took = 120 + Math.floor(rnd() * 700);

      const input = h('input', { type: 'search', value: q, spellcheck: 'false', 'aria-label': 'Search cherri' });
      const wrap = h('div.app__content');
      wrap.append(
        h('form.field', {
          style: { maxWidth: '320px' },
          onsubmit: e => { e.preventDefault(); const v = input.value.trim(); if (v && v !== q) navigate(search(v)); },
        }, icon('search'), input),
        h('div.label', { text: `About ${total.toLocaleString()} results · ${took} ms`, style: { margin: 'var(--sp-5) 0 var(--sp-3)' } }),
        h('div.list', RESULTS.map(r => {
          const url = fill(r[1]);
          return h('button.list__item', { onclick: () => navigate(url.replace(/ › /g, '/')) },
            h('div.grow',
              h('b', { text: fill(r[0]) }),
              /* .term__ok is the kit's only "safe green" — reused for the url line */
              h('div.term__ok', { text: url, style: { fontSize: 'calc(9.5px * var(--fs-k,1))', margin: '2px 0 3px' } }),
              h('small', { text: fill(r[2]) })));
        })),
        h('div.dim', {
          text: 'Results are generated locally — cherri has no network access in this build.',
          style: { marginTop: 'var(--sp-6)', fontSize: 'calc(9.5px * var(--fs-k,1))' },
        }));
      return wrap;
    }

    /* ---------------- static://apps -------- */
    function pageApps() {
      const list = api.listApps();
      const wrap = h('div.app__content');
      wrap.append(
        h('div.label', { text: `Installed apps · ${list.length}` }),
        list.length
          ? h('div.grid3', { style: { marginTop: 'var(--sp-4)' } }, list.map(a =>
            h('button.store__item', {
              onclick: () => api.openApp(a.id),
              title: a.desc || a.category,
            },
              appTile(a),
              h('div.grow', h('b', { text: a.name }), h('small', { text: a.desc || a.category })))))
          : h('div.empty', icon('grid-9'), h('b', { text: 'No apps registered' })));
      return wrap;
    }

    /* ---------------- static://about ------- */
    function pageAbout() {
      const sys = store.get('system') || {};
      const hw = M.hardware();
      const rows = [
        ['Version', '3.0 “cherri”'],
        ['Shell', sys.shell],
        ['Window manager', sys.wm],
        ['Processor', hw.cores ? `${hw.cores} logical cores` : 'not available to a web page'],
        ['Memory', navigator.deviceMemory ? `${navigator.deviceMemory} GB or more (rounded by the browser)` : 'not available to a web page'],
        ['Display', hw.screen],
      ];
      return h('div.about',
        h('div.about__logo', icon(BRAND.icon)),
        h('div',
          h('div.h-sec', { text: sys.os || 'StaticOS' }),
          h('small.dim', { text: 'Rendered locally by the Browser. No network required.' })),
        h('div.card', { style: { width: '100%', maxWidth: '360px', textAlign: 'left' } },
          h('table.table', h('tbody', rows.map(([k, v]) =>
            h('tr', h('th', { text: k }), h('td', { text: v || '—' })))))),
        h('button.btn', { onclick: () => launch('about', 'About') }, icon('external-link', { size: 14 }), 'Open the About app'));
    }

    /* ---------------- static://bookmarks --- */
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    /** A bookmarks file other browsers can import (the Netscape format everyone reads). */
    function exportBookmarks() {
      const d = readBm();
      const a = i => `<DT><A HREF="${esc(i.url)}">${esc(bmTitle(i))}</A>`;
      const lines = [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>',
        ...d.items.filter(i => !i.folder).map(a),
        ...d.folders.flatMap(f => [`<DT><H3>${esc(f.name)}</H3>`, '<DL><p>', ...d.items.filter(i => i.folder === f.id).map(a), '</DL><p>']),
        '</DL><p>',
      ];
      const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = h('a', { href: url, download: 'static-bookmarks.html', style: { display: 'none' } });
      document.body.appendChild(link);
      link.click();
      link.remove();
      later(() => URL.revokeObjectURL(url), 4000);
      api.notify({ app: 'Browser', icon: 'download', title: 'Bookmarks exported', message: `${d.items.length} bookmark${d.items.length === 1 ? '' : 's'} saved as static-bookmarks.html` });
    }

    function pageBookmarks() {
      let q = '';
      let editing = renameNext ? `b:${renameNext}` : null;      /* 'b:<id>' or 'f:<id>': the name being edited */
      renameNext = null;
      const wrap = h('div.app__content.bm');
      const find = h('input', {
        type: 'search', placeholder: 'Search bookmarks', spellcheck: 'false', 'aria-label': 'Search bookmarks',
        oninput: () => { q = find.value; draw(); },
      });
      const body = h('div.bm__body');
      const expBtn = h('button.btn.btn--sm', { onclick: exportBookmarks }, icon('download', { size: 13 }), 'Export');
      const newFolder = h('button.btn.btn--sm', {
        onclick: () => {
          const id = bid();
          editing = `f:${id}`;
          updateBm(d => { d.folders.push({ id, name: 'New folder' }); });
        },
      }, icon('folder', { size: 13 }), 'New folder');
      wrap.append(
        h('div.bm__head',
          h('div', h('div.h-sec', { text: 'Bookmarks' }),
            h('small.dim', { text: 'Saved on this computer. Folders show on the bar under the address bar.' })),
          h('div.grow'),
          h('form.field.bm__find', { onsubmit: e => e.preventDefault() }, icon('search'), find),
          newFolder, expBtn),
        body);

      const rename = (id, value, apply) => {
        editing = null;
        updateBm(d => apply(d, value.trim()));
        void id;
      };
      /** the name, or an input while it is being renamed; Enter keeps it, Esc leaves it */
      function nameCell(key, text, label, apply) {
        if (editing !== key) return null;
        const inp = h('input.bm__edit', { type: 'text', value: text, 'aria-label': label, maxlength: 200, spellcheck: 'false' });
        let done = false;
        const finish = keep => {
          if (done) return; done = true;
          if (keep) rename(key, inp.value, apply); else { editing = null; draw(); }
        };
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        inp.addEventListener('blur', () => finish(true));
        later(() => { inp.focus(); inp.select(); }, 0);
        return inp;
      }

      function moveMenu(e, i, folders) {
        api.menu([
          { label: 'Bookmarks bar (no folder)', icon: 'bookmark', disabled: !i.folder, onClick: () => updateBm(d => { const x = d.items.find(y => y.id === i.id); if (x) x.folder = ''; }) },
          ...folders.map(f => ({ label: f.name, icon: 'folder', disabled: i.folder === f.id, onClick: () => updateBm(d => { const x = d.items.find(y => y.id === i.id); if (x) x.folder = f.id; }) })),
        ], e.clientX, e.clientY, { label: `Move ${bmTitle(i)} to` });
      }

      function row(i, d) {
        const t = bmTitle(i);
        const edit = nameCell(`b:${i.id}`, i.title || t, `Name for ${t}`, (dd, v) => { const x = dd.items.find(y => y.id === i.id); if (x) x.title = v; });
        return h('div.bm__row', { 'data-bm': i.id },
          edit
            ? h('div.bm__open', tabIcon(faviconOf(i.url)), edit)
            : h('button.bm__open', { title: i.url, onclick: () => navigate(i.url) },
              tabIcon(faviconOf(i.url)), h('span.bm__t.trunc', { text: t }), h('small.dim.trunc', { text: i.url })),
          h('button.ibtn.tip', { 'data-tip': 'Rename', 'aria-label': `Rename ${t}`, onclick: () => { editing = `b:${i.id}`; draw(); } }, icon('edit-3')),
          h('button.ibtn.tip', { 'data-tip': 'Open in new tab', 'aria-label': `Open ${t} in a new tab`, onclick: () => newTab(i.url) }, icon('external-link')),
          h('button.ibtn.tip', { 'data-tip': 'Move to folder', 'aria-label': `Move ${t} to a folder`, onclick: e => moveMenu(e, i, d.folders) }, icon('folder')),
          h('button.ibtn.tip', { 'data-tip': 'Remove', 'aria-label': `Remove ${t}`, onclick: () => updateBm(dd => { dd.items = dd.items.filter(y => y.id !== i.id); }) }, icon('trash')));
      }

      function draw() {
        const d = readBm();
        const needle = q.trim().toLowerCase();
        const match = i => !needle || bmTitle(i).toLowerCase().includes(needle) || i.url.toLowerCase().includes(needle);
        expBtn.disabled = !d.items.length;
        api.clear(body);
        if (!d.items.length && !d.folders.length) {
          body.appendChild(h('div.empty', icon('bookmark'), h('b', { text: 'No bookmarks yet' }),
            h('small', { text: 'Press the star in the address bar to keep a page here.' })));
          return;
        }
        let shown = 0;
        const groups = [{ id: '', name: 'Bookmarks bar' }, ...d.folders.map(f => ({ id: f.id, name: f.name, folder: f }))];
        for (const g of groups) {
          const all = d.items.filter(i => i.folder === g.id);
          const its = all.filter(match);
          if (needle && !its.length) continue;
          if (!g.folder && !all.length && d.folders.length) continue;
          shown += its.length;
          const head = g.folder
            ? h('div.bm__ghead',
              icon('folder'),
              nameCell(`f:${g.id}`, g.name, 'Folder name', (dd, v) => { const f = dd.folders.find(x => x.id === g.id); if (f && v) f.name = v.slice(0, 60); })
                || h('b', { text: g.name }),
              h('small.dim', { text: `${all.length}` }),
              h('div.grow'),
              h('button.ibtn.tip', { 'data-tip': 'Rename folder', 'aria-label': `Rename folder ${g.name}`, onclick: () => { editing = `f:${g.id}`; draw(); } }, icon('edit-3')),
              h('button.ibtn.tip', { 'data-tip': 'Delete folder (its bookmarks stay)', 'aria-label': `Delete folder ${g.name}`,
                onclick: () => updateBm(dd => { dd.folders = dd.folders.filter(x => x.id !== g.id); for (const i of dd.items) if (i.folder === g.id) i.folder = ''; }) }, icon('trash')))
            : h('div.bm__ghead', icon('bookmark'), h('b', { text: g.name }), h('small.dim', { text: `${all.length}` }));
          body.appendChild(h('section.bm__group', { 'aria-label': g.name }, head,
            its.length ? its.map(i => row(i, d)) : h('div.dim.bm__none', { text: 'Empty. Use “Move to folder” on a bookmark.' })));
        }
        if (needle && !shown) body.appendChild(h('div.empty', icon('search'), h('b', { text: `No bookmarks match “${q.trim()}”` })));
      }
      draw();
      bmViews.add(draw);
      wrap.cherriTeardown = () => bmViews.delete(draw);
      return wrap;
    }

    /* ---------------- static://history ----- */
    function pageHistory() {
      let q = '';
      const wrap = h('div.app__content.bm');
      const find = h('input', {
        type: 'search', placeholder: 'Search this session', spellcheck: 'false', 'aria-label': 'Search history',
        oninput: () => { q = find.value; draw(); },
      });
      const clearBtn = h('button.btn.btn--sm', { onclick: () => { S.hist.length = 0; histViews.forEach(f => f()); } }, icon('trash', { size: 13 }), 'Clear');
      const body = h('div.bm__body');
      wrap.append(
        h('div.bm__head',
          h('div', h('div.h-sec', { text: 'History' }),
            h('small.dim', { text: 'This session only: the Static pages opened in this Browser window since it was opened. Kept in memory, never saved, gone when the window closes.' })),
          h('div.grow'),
          h('form.field.bm__find', { onsubmit: e => e.preventDefault() }, icon('search'), find),
          clearBtn),
        body);
      function draw() {
        const needle = q.trim().toLowerCase();
        const list = S.hist.filter(x => !needle || titleOf(x.url).toLowerCase().includes(needle) || x.url.toLowerCase().includes(needle));
        clearBtn.disabled = !S.hist.length;
        api.clear(body);
        if (!list.length) {
          body.appendChild(h('div.empty', icon('clock'),
            h('b', { text: S.hist.length ? `Nothing matches “${q.trim()}”` : 'Nothing yet' }),
            h('small', { text: S.hist.length ? 'Try a different word.' : 'Pages you open here, like Games or Anime, are listed here for this session.' })));
          return;
        }
        body.appendChild(h('div.bm__group', { 'aria-label': 'Pages visited' }, list.map(x => h('div.bm__row', { 'data-url': x.url },
          h('button.bm__open', { title: x.url, onclick: () => navigate(x.url) },
            tabIcon(faviconOf(x.url)), h('span.bm__t.trunc', { text: titleOf(x.url) }), h('small.dim.trunc', { text: x.url })),
          h('small.dim.bm__when', { text: new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })))));
      }
      draw();
      histViews.add(draw);
      wrap.cherriTeardown = () => histViews.delete(draw);
      return wrap;
    }

    /* ---------------- offline -------------- */
    function pageOffline(u) {
      const host = hostOf(u);
      const retry = h('button.btn.btn--primary', { onclick: tryAgain }, icon('refresh', { size: 14 }), 'Retry');

      function tryAgain() {
        retry.disabled = true;
        api.render(retry, h('div.spinner'), 'Reconnecting…');
        later(() => {
          paintView();
          api.notify({ app: 'Browser', icon: 'wifi-off', title: 'Still offline', message: `Could not reach ${host}.` });
        }, 900);
      }

      return h('div.empty',
        icon('wifi-off'),
        h('b', { text: 'You’re offline' }),
        h('small', { text: host }),
        h('div.row',
          retry,
          h('button.btn.btn--ghost', { onclick: () => navigate(HOME) }, icon('home', { size: 14 }), 'Start page')));
    }

    /* ---------------- paint ---------------- */
    let dragId = null;      /* the tab being dragged */
    function paintTabs() {
      api.clear(tabStrip);
      for (const t of S.tabs) {
        t.title = titleOf(t.url);       /* the portal may have loaded since */
        const label = h('button', {
          title: t.pin ? `${t.title} (pinned)` : t.url, role: 'tab', 'aria-selected': t.id === S.active ? 'true' : 'false',
          'aria-label': t.pin ? `${t.title}, pinned tab` : undefined,
          style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flex: '1', minWidth: '0', height: '100%', color: 'inherit' },
          onclick: () => selectTab(t.id),
        }, tabIcon(faviconOf(t.url)), t.pin ? null : h('span.trunc', { text: t.title }));

        const shut = t.pin ? null : h('button.ibtn', {
          'aria-label': `Close ${t.title}`,
          style: { height: '18px', minWidth: '18px', padding: '0', borderRadius: 'var(--r-xs)' },
          onclick: () => closeTab(t.id),
        }, tabIcon('x'));

        const tab = h('div.brw__tab', {
          draggable: 'true', 'data-tab': t.id,
          oncontextmenu: e => tabMenu(e, t),
          ondragstart: e => {
            dragId = t.id;
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.title); }
            tab.classList.add('is-drag');
          },
          ondragend: () => { dragId = null; tab.classList.remove('is-drag'); for (const el of tabStrip.children) el.classList.remove('is-over'); },
          ondragover: e => { if (dragId && dragId !== t.id) { e.preventDefault(); tab.classList.add('is-over'); } },
          ondragleave: () => tab.classList.remove('is-over'),
          ondrop: e => { e.preventDefault(); const from = dragId; dragId = null; moveTab(from, t.id); },
        }, label, shut);
        if (t.pin) tab.classList.add('is-pin');
        if (t.id === S.active) tab.classList.add('is-on');
        tabStrip.appendChild(tab);
        if (t.id === S.active) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    function paintNav() {
      win.state.reopen = { url: curUrl() };   /* reopened later: this page (js/core/reopen.js) */
      const t = cur(), u = curUrl(), marked = !!markOf(u);
      urlIn.value = u;
      btnBack.disabled = !t || t.idx <= 0;
      btnFwd.disabled = !t || t.idx >= t.history.length - 1;
      btnStar.classList.toggle('is-on', marked);
      btnStar.setAttribute('data-tip', marked ? 'Remove bookmark' : 'Bookmark');
      api.render(btnReload, S.loading ? h('div.spinner') : icon('refresh'));
      btnReload.setAttribute('data-tip', S.loading ? 'Loading…' : 'Reload');
      /* the page's own title is the window's title: the dock preview and the window overview read it from here */
      win.setTitle(t ? titleOf(t.url) : 'Browser');
      win.setSubtitle(isLocal(u) ? '' : hostOf(u));
      saveTabs();
    }

    const PORTAL_RE = /^aether:\/\/(games|movies|anime|manga|arcade|proxy|apply|search)/;

    function pageCrash(u, err) {
      return h('div.cx-down', icon('alert'),
        h('div',
          h('b', { text: 'That page failed to render' }),
          h('small', { text: `${u} — ${err && err.message ? err.message : String(err)}` }),
          h('div.row', { style: { marginTop: 'var(--sp-4)' } },
            h('button.btn.btn--sm', { onclick: () => load() }, icon('refresh'), 'Retry'),
            h('button.btn.btn--sm.btn--ghost', { onclick: () => navigate(HOME) }, 'Start page'))));
    }

    /* Portal pages hang a cleanup function on their root node; the window is
       removed from the window layer, not from `view`, so their own removal
       detector never fires and the Browser has to call it. */
    function releasePage() {
      for (const node of [...view.children]) {
        try { node.cherriTeardown?.(); } catch (err) { console.warn('[portal] teardown', err); }
      }
    }

    function paintView() {
      const u = curUrl();
      releasePage();
      api.clear(view);
      view.scrollTop = 0;

      if (u === HOME) return void view.appendChild(pageHome());
      if (u === APPS) return void view.appendChild(pageApps());
      if (u === ABOUT) return void view.appendChild(pageAbout());
      if (u === BOOKMARKS) return void view.appendChild(pageBookmarks());
      if (u === HISTORY) return void view.appendChild(pageHistory());

      /* the portal (js/portal/) owns games, movies, anime, manga,
         search, arcade, proxy and apply */
      if (PAGES && PAGES.match(u)) {
        try {
          const node = PAGES.build(u, { api, navigate, win, providers: PROVIDERS });
          if (node) return void view.appendChild(node);
        } catch (err) {
          console.error('[portal] page crashed', u, err);
          return void view.appendChild(pageCrash(u, err));
        }
      }
      /* still importing: show a spinner rather than a wrong answer */
      if (!PAGES && !pagesErr && PORTAL_RE.test(u)) {
        return void view.appendChild(
          h('div.center', { style: { height: '100%' } }, h('div.spinner')));
      }
      if (u.startsWith('static://search')) return void view.appendChild(pageResults(queryOf(u)));
      view.appendChild(pageOffline(u));
    }

    function paintAll() { paintTabs(); paintNav(); paintView(); }

    /* ---------------- life ----------------- */
    const saved = tabOwner === owner ? savedTabs() : null;
    if (saved) {
      for (const t of saved.tabs) S.tabs.push({ id: `t${++seq}`, title: titleOf(t.url), url: t.url, history: t.history, idx: t.idx, pin: t.pin });
      pinFirst();
      S.active = (S.tabs[saved.active] || S.tabs[0]).id;
      const want = opts?.url ? normalize(opts.url) : null;
      const have = want && S.tabs.find(t => t.url === want);
      if (have) S.active = have.id;
      if (want && !have) newTab(want); else paintAll();
    } else newTab(opts?.url || HOME);
    paintBar();

    win.onReopen(o => { if (o?.url) newTab(o.url); });

    /* when the lazily-imported portal arrives, repaint anything waiting on it */
    repaints.add(paintAll);
    if (!PAGES && !pagesErr) portalReady.then(() => {});
    /* another Browser window changed the bookmarks or the bar */
    const offState = api.bus.on('state:change', path => {
      if (typeof path === 'string' && /^portal\.browser\.(bm|bar)$/.test(path)) { paintBar(); bmViews.forEach(f => f()); paintNav(); }
    });

    const onKey = e => {
      if (!win.el.classList.contains('is-active')) return;
      /* mod+alt+arrow is the OS snap chord (wm.js) — let the shell have it
         instead of snapping the window AND navigating the tab. */
      const mod = e.metaKey || e.ctrlKey;
      if (e.altKey && !mod && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.altKey && !mod && e.key === 'ArrowRight') { e.preventDefault(); fwd(); }
      else if (e.key === 'F5') { e.preventDefault(); load(); }
      else if (e[fmt.modKey] && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); urlIn.focus(); urlIn.select(); }
    };
    window.addEventListener('keydown', onKey);

    /* Tab keys, ahead of the window manager's (which would close the whole
       window on Ctrl+W and reopen a closed *window* on Ctrl+Shift+T). They
       are the browser's usual ones. An ordinary browser tab keeps Ctrl+T,
       Ctrl+W and Ctrl+Tab for itself; they reach here in full screen or an
       installed app window, and Ctrl+Alt+Shift+T still reopens a window. */
    const onTabKey = e => {
      if (!win.el.classList.contains('is-active') || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const mod = e[fmt.modKey];
      let did = false;
      if (mod && !e.shiftKey && key === 't') { newTab(); urlIn.focus(); urlIn.select(); did = true; }
      else if (mod && !e.shiftKey && key === 'w') { const t = cur(); if (t) closeTab(t.id); did = true; }
      else if (mod && e.shiftKey && key === 't' && S.closed.length) { reopenTab(); did = true; }
      else if (e.ctrlKey && key === 'Tab' && S.tabs.length > 1) { nextTab(e.shiftKey ? -1 : 1); did = true; }
      else if (e.ctrlKey && (key === 'PageDown' || key === 'PageUp') && S.tabs.length > 1) { nextTab(key === 'PageUp' ? -1 : 1); did = true; }
      if (did) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onTabKey, true);

    return () => {
      repaints.delete(paintAll);
      offState?.();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onTabKey, true);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      releasePage();
      api.clear(view);
      if (tabOwner === owner) tabOwner = null;
    };
  },
});
