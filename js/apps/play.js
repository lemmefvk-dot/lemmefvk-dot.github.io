/* ============================================================
   play.js — Static Play: the gaming centre of StaticOS.

   A console home screen rather than a thumbnail grid: a rotating
   Featured hero, then rows whose card size follows how much the
   row matters (Continue Playing gets wide cards, category shelves
   get compact tiles). Five tabs — Home, Discover, Multiplayer,
   Arcade, Creations — plus one search across the web catalogue,
   the Static Arcade and your own creations.

   ONLY REAL THINGS
   Every row is built from something that exists: the catalogue
   (games.data.js), the Arcade registry, this device's history
   (plays.js, favourites, the weekly play log), your projects and
   the collections you fill from any card's menu.
   A row with nothing real to show is not rendered at all.
   From Oct 24 to Nov 1 (core/season.js, this device's calendar)
   Home also has a Halloween shelf: the Arcade's spooky games, then
   the catalogue's Horror category; the rest of the year, no shelf. There is
   no "New" row (the catalogue carries no dates), no player counts,
   no friends, no lobbies — StaticOS has no server, and the
   Multiplayer tab says so in plain words instead.
   Ratings and play counts are held back too: the catalogue's
   numbers are placeholders today (see quickplay.js measured()), so
   Popular and Hidden Gems only appear once measured numbers exist.
   Every Discover card carries the one-line reason it is there.

   OPENING THINGS
     web game  -> aether-games { url: 'static://games/<id>' }
     arcade    -> arcade { game } (or { game, players: 2 })
     creation  -> forge { project }
     new game  -> forge { prompt }
   All through quickplay.launch(), which checks the app is
   installed and says so if it is not.

   CARD MENU
   Every card, tile, Arcade tile, the hero and the gem spotlight
   has the same menu — Play, Favorite (web games), Thumbs up,
   Thumbs down, Add to Desktop, Add to collection…, Details —
   opened by right-click, the visible '…' button, a long-press on
   touch, or M / Shift+F10 / the Menu key on a focused card. Cards
   register their item in a WeakMap and one delegated listener
   serves them all.

   THUMBS (core/thumbs.js)
   Your own thumbs-up and thumbs-down, on this device only — never
   shown as anyone else's count. Thumbs-up games get a Home shelf,
   newest first. A thumbs-down hides the game from every shelf,
   search and Quick Play pick here (with an Undo), and Home's
   "Hidden by you" lists them so they can come back.

   SEARCH (core/fuzzy.js via games.data.js search())
   Typos are forgiven: "subwy surfrs" finds Subway Surfers. Exact and
   prefix title matches lead, then tag matches, then close spellings;
   when no title matches the words as typed, the closest reading is
   offered as "Did you mean …". The index is built when the search
   box is first focused, so a search costs a few milliseconds.

   CONSOLE NAVIGATION
   Each row is one tab stop (roving tabindex). Arrow keys move
   between cards and rows, Enter plays, F favourites, U thumbs-up,
   D thumbs-down, I opens details, M the menu; '/' jumps to search.
   Rows below the fold are built as they scroll near, so opening
   Play costs a screenful of DOM.

   opts: { tab: 'home'|'discover'|'multiplayer'|'arcade'|'creations',
           q: 'search words', quick: true | { minutes, players, mood } }
   on a cold open and again through win.onReopen.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as catalogue from '../portal/games.data.js';
import * as plays from '../core/plays.js';
import * as projects from '../core/projects.js';
import { ARCADE } from '../arcade/index.js';
import * as QP from '../core/quickplay.js';
import { addToDesktop } from '../core/shortcuts.js';
import * as collections from '../core/collections.js';
import { inHalloween } from '../core/season.js';
import * as thumbs from '../core/thumbs.js';
import { createIndex, T_FUZZY as FUZZY } from '../core/fuzzy.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-play-css')) {
  const l = document.createElement('link');
  l.id = 'feat-play-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-play.css';
  document.head.appendChild(l);
}

/* ---------- constants ------------------------------------------------ */
const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'discover', label: 'Discover', icon: 'compass' },
  { id: 'multiplayer', label: 'Multiplayer', icon: 'users' },
  { id: 'arcade', label: 'Arcade', icon: 'zap' },
  { id: 'creations', label: 'Creations', icon: 'sparkles' },
];
/* older links and the short form still land on the right tab */
const TAB_ALIAS = { multi: 'multiplayer', mp: 'multiplayer', create: 'creations', creation: 'creations', mine: 'creations' };
const tabOf = v => { const t = TAB_ALIAS[v] || v; return TABS.some(x => x.id === t) ? t : null; };
const LONG_PRESS = 480;
const CAT_ROWS = ['action', 'adventure', 'puzzle', 'racing', 'sports', 'strategy', 'retro', 'horror', 'platformer', 'fighting', 'shooter', 'idle'];
const K_FAV = 'portal.games.favs';
const K_RECENT = 'portal.games.recent';
const K_QP = 'portal.playQuick';
const ROW = 16;
const HERO_N = 6;
const HERO_MS = 8000;
const WEEK = 7 * 86400000;

const NO_SERVER = 'Parties, lobbies, friends lists and “looking for players” all need a server that keeps track of people. StaticOS is a static site with no server, so none of that is here — and nothing is made up to fill the gap.';
const IO_NOTE = 'Online play happens on each publisher’s own servers. StaticOS can’t see who is playing, so it doesn’t show player counts.';

/* catalogue tags that literally name a control — nothing else counts */
const CONTROL_TAGS = { mouse: 'Mouse', 'point and click': 'Mouse', touch: 'Touch', onetouch: 'One touch', keyboard: 'Keyboard', wasd: 'WASD', gamepad: 'Gamepad', controller: 'Controller' };
const INPUT_LABEL = { keyboard: 'Keyboard', mouse: 'Mouse', touch: 'Touch' };
/* tags that describe the listing, not the game — never used as a reason */
const NOISE_TAGS = /^(20\d\d games|best games?|best|amazing|fun|html5|free html5 games for your website|games?|3d games|2d|3d|mentolatux|mapi games|ai games|android|mobile|boys|girls|kids)$/i;

const arr = v => (Array.isArray(v) ? v : []);
const plural = (n, w) => `${Number(n).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const catName = id => catalogue.catMeta(id).name;
const catIcon = id => catalogue.catMeta(id).icon || 'gamepad';
const fnv = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Procedural cover for a game with no art (or art that fails to load). */
function artBg(title) {
  const x = fnv(title);
  const a = x % 360;
  const b = (a + 40 + (x >> 8) % 90) % 360;
  return [
    `radial-gradient(70% 60% at ${20 + (x >> 6) % 50}% ${15 + (x >> 10) % 40}%,hsl(${b} 62% 58% / .8),transparent 62%)`,
    `radial-gradient(60% 70% at ${55 + (x >> 12) % 35}% ${70 + (x >> 14) % 25}%,hsl(${(b + 190) % 360} 62% 46% / .6),transparent 66%)`,
    `linear-gradient(${120 + (x >> 4) % 90}deg,hsl(${a} 55% 28%),hsl(${(a + 320) % 360} 48% 11%))`,
  ].join(',');
}

/** A larger cover where the host resizes on request (hero only). */
const bigArt = url => String(url || '').replace(/([?&]w=)320\b/, '$1720');

function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------- item shapes ---------------------------------------------- */
const webItem = (g, extra) => ({ kind: 'web', id: g.id, title: QP.cleanText(g.title), art: g.art || null, g, ...extra });
const arcItem = (a, extra) => ({ kind: 'arcade', id: a.id, title: a.title, art: null, a, ...extra });
const thumbOf = p => {
  const t = p && p.published && p.published.thumbnail;
  return typeof t === 'string' && /^(data:image\/|https?:)/.test(t) ? t : null;
};
const creItem = (p, extra) => ({ kind: 'creation', id: p.id, title: (p.published && p.published.title) || p.name || 'Untitled game', art: thumbOf(p), p, ...extra });

function controlsOf(g) {
  const found = [...new Set(g.tags.map(t => CONTROL_TAGS[t.toLowerCase()]).filter(Boolean))];
  return found.length ? `Controls: ${found.join(', ')}` : 'Controls not listed';
}

/* 'direct' is how the sync marks a game it embeds without a publisher feed —
   a source, not a studio, so it is not shown as one */
const studioOf = g => (g.studio && g.studio !== 'direct' ? g.studio : '');
/** "studio · category", leaving out the category a row is already about */
const webMeta = (g, skip = null) => {
  const c = g.cats.find(x => x !== 'featured' && x !== skip);
  return [studioOf(g), c ? catName(c) : null].filter(Boolean).join(' · ') || catName(skip || g.cats[0]);
};

const playersText = a => (a.players.includes(2) ? (a.players.includes(1) ? '1–2 players' : '2 players') : '1 player');

/* the Arcade list never changes while the page is open: one small index for its search */
let arcIx = null;
const arcadeIndex = () => arcIx || (arcIx = createIndex(ARCADE, {
  title: a => a.title, hay: a => `${a.title} ${a.blurb} ${a.tags.join(' ')}`.toLowerCase() }));

/* your thumbs work on catalogue and Arcade games (a creation is yours already) */
const thumbable = it => !!it && (it.kind === 'web' || it.kind === 'arcade');
const thumbKey = it => `${it.kind}:${it.id}`;

/* a quiet moment for work nobody is waiting on yet */
const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
const unidle = id => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id));

/* ====================================================================== */
defineApp({
  id: 'play', name: 'Static Play', icon: 'gamepad',
  g1: '#ff7a98', g2: '#6d1026',
  category: 'Games', singleton: true,
  keywords: ['play', 'games', 'console', 'home', 'quick play', 'arcade', 'multiplayer', 'discover', 'creations', 'launcher'],
  desc: 'Your games: continue, discover, quick play',
  win: { w: 1180, h: 720, minW: 520, minH: 460 },

  mount({ root, win, opts, api }) {
    const { h, icon } = api;
    const offs = [];            // app lifetime
    let viewOffs = [];          // current view only
    const lazy = [];            // rows waiting to be built
    const slots = new Map();    // Home section id -> slot element
    let alive = true;

    /* every animation frame this app asks for goes through here, so the
       teardown can cancel whatever is still pending; a key coalesces
       repeats (one scroll handler per frame, not one per event) */
    const frames = new Map();   // key -> frame id
    const looseFrames = new Set();
    function frame(fn, key) {
      if (key && frames.has(key)) cancelAnimationFrame(frames.get(key));
      const id = requestAnimationFrame(() => {
        if (key) frames.delete(key); else looseFrames.delete(id);
        if (alive) fn();
      });
      if (key) frames.set(key, id); else looseFrames.add(id);
      return id;
    }
    offs.push(() => {
      for (const id of frames.values()) cancelAnimationFrame(id);
      for (const id of looseFrames) cancelAnimationFrame(id);
      frames.clear();
      looseFrames.clear();
    });

    const reduced = () => !!api.store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    const savedQP = api.store.get(K_QP, null);
    const S = {
      tab: tabOf(opts?.tab) || 'home',
      q: typeof opts?.q === 'string' ? opts.q : '',
      ready: catalogue.isLoaded(),
      projects: null,
      qp: {
        minutes: Number(savedQP?.minutes) || null,
        players: savedQP?.players === 2 ? 2 : 1,
        mood: typeof savedQP?.mood === 'string' ? savedQP.mood : '',
      },
      avoid: [],
      lastPick: null,
      searchPage: 1,
      showHidden: false,     // this search also lists games you gave a thumbs-down
      hiddenOpen: false,     // Home's "Hidden by you" list is open
    };

    /* ---------------------------------------------------------------- *
     *  shell: top bar, tabs, search, quick play
     * ---------------------------------------------------------------- */
    const el = h('div.app.sp', { class: reduced() ? 'sp--still' : null });
    const view = h('div.sp-view');
    const main = h('main.sp-main', { tabindex: '-1' }, view);

    const tabBtns = TABS.map(t => h('button.sp-tab', {
      type: 'button', role: 'tab', id: `sp-tab-${t.id}`, dataset: { tab: t.id }, title: t.label,
      'aria-controls': 'sp-panel', onclick: () => setTab(t.id),
    }, icon(t.icon), h('span.sp-tab__l', { text: t.label })));
    const tabs = h('nav.sp-tabs', { role: 'tablist', 'aria-label': 'Static Play sections' }, tabBtns);
    tabs.addEventListener('keydown', e => {
      const i = tabBtns.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % tabBtns.length;
      if (e.key === 'ArrowLeft') n = (i - 1 + tabBtns.length) % tabBtns.length;
      if (e.key === 'Home') n = 0;
      if (e.key === 'End') n = tabBtns.length - 1;
      if (n === null) return;
      e.preventDefault();
      tabBtns[n].focus();
      setTab(TABS[n].id);
    });

    const searchIn = h('input.sp-search__in', {
      type: 'search', placeholder: 'Search games, Arcade, your creations', value: S.q,
      'aria-label': 'Search the catalogue, the Static Arcade and your creations', autocomplete: 'off', spellcheck: 'false',
    });
    const searchClear = h('button.sp-search__x', { type: 'button', 'aria-label': 'Clear search', hidden: !S.q,
      onclick: () => { searchIn.value = ''; onSearch(true); searchIn.focus(); } }, icon('x'));
    const search = h('label.sp-search', icon('search'), searchIn, searchClear);
    let searchT = 0;
    searchIn.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => onSearch(), 180); });
    searchIn.addEventListener('keydown', e => {
      if (e.key === 'Escape' && searchIn.value) { e.preventDefault(); e.stopPropagation(); searchIn.value = ''; onSearch(true); }
      if (e.key === 'Enter') { clearTimeout(searchT); onSearch(true); }
      if (e.key === 'ArrowDown') { const f = view.querySelector('.sp-go'); if (f) { e.preventDefault(); focusGo(f); } }
    });
    offs.push(() => clearTimeout(searchT));
    /* the spelling-tolerant index is built the first time the search box is
       used, on an idle moment, so typing never waits for it */
    let warmId = 0;
    const warmSearch = () => {
      if (warmId || !S.ready) return;
      warmId = idle(() => { if (alive) { try { catalogue.warmSearch(); } catch (err) { console.warn('[play] search index', err); } } });
    };
    searchIn.addEventListener('focus', warmSearch);
    offs.push(() => { if (warmId) unidle(warmId); });

    /* quick play in the bar: the button picks at once; the chevron sets it up */
    const qpPop = h('div.sp-pop', { id: 'sp-qp-pop', role: 'dialog', 'aria-label': 'Quick Play options', hidden: true });
    const qpMore = h('button.sp-qpbar__more', { type: 'button', 'aria-label': 'Quick Play options', 'aria-expanded': 'false',
      'aria-controls': 'sp-qp-pop', onclick: () => togglePop() }, icon('sliders'));
    const qpBar = h('div.sp-qpbar',
      h('button.sp-qpbar__go', { type: 'button', onclick: () => quickPlay(),
        'aria-label': 'Quick Play: pick a game for me and start it' }, icon('zap', { fill: true }), h('span.sp-qpbar__label', { text: 'Quick Play' })),
      qpMore);

    const top = h('header.sp-top',
      h('div.sp-brand', h('span.sp-brand__mark', icon('gamepad')), h('b', { text: 'Static Play' })),
      tabs, search, qpBar);

    el.append(top, h('div.sp-panel', { id: 'sp-panel', role: 'tabpanel', 'aria-labelledby': `sp-tab-${S.tab}` }, main), qpPop);
    root.appendChild(el);

    /* ---------------------------------------------------------------- *
     *  actions
     * ---------------------------------------------------------------- */
    function play(item, how = {}) {
      const it = item.kind === 'arcade' ? { ...item, players2: how.players === 2 } : item;
      return QP.launch(it, api);
    }

    function openOr(app, o, name) {
      if (!api.getApp(app)) {
        api.notify({ app: 'Static Play', icon: 'alert', title: `${name} isn’t available`,
          message: `This build of StaticOS doesn’t include ${name} yet.` });
        return null;
      }
      return api.openApp(app, o);
    }
    const details = item => openOr('aether-games', { url: `static://games/${item.id}` }, 'Static Games');
    const browseCat = cat => openOr('aether-games', { url: `static://games?cat=${encodeURIComponent(cat)}` }, 'Static Games');

    const isFav = id => QP.favIds().includes(id);
    function toggleFav(id) {
      const cur = QP.favIds();
      const on = !cur.includes(id);
      api.store.set(K_FAV, on ? [id, ...cur].slice(0, 400) : cur.filter(x => x !== id));
      if (on) api.bus.emit('game:fav', { id });
      return on;
    }

    /* ---- your thumbs ----------------------------------------------------
       Pressing the lit thumb takes it back. A thumbs-down hides the game
       here; the store subscription below takes it off the page (and puts
       it back after an Undo), so every way of setting one behaves alike. */
    const thumbOf = it => (thumbable(it) ? thumbs.of(it.kind, it.id) : 0);
    const isHidden = it => thumbOf(it) === -1;
    function thumb(item, v) {
      if (!thumbable(item)) return 0;
      const was = thumbOf(item);
      const now = thumbs.toggle(item.kind, item.id, v);
      if (now === -1) {
        say.textContent = `${item.title} is hidden. Undo is in the notification.`;
        api.notify({
          app: 'Static Play', icon: 'eye-off', title: `Hidden: ${item.title}`, timeout: 8000,
          message: 'It won’t show up in Static Play’s shelves, search or Quick Play. Home lists the games you hid.',
          actions: [{ label: 'Undo', onClick: () => thumbs.set(item.kind, item.id, was) }],
        });
      } else if (now === 1) say.textContent = `Thumbs-up for ${item.title}.`;
      else say.textContent = was === -1 ? `${item.title} is back.` : `Thumbs-up taken back for ${item.title}.`;
      return now;
    }

    let qpWaiting = false;
    /* a press while the catalogue is still loading is kept, and said so */
    const say = h('div.sp-sr', { 'aria-live': 'polite', role: 'status' });
    el.append(say);
    function qpBusy(on) {
      el.classList.toggle('sp--qp-wait', on);
      for (const b of el.querySelectorAll('.sp-qpbar__go, .sp-qp__btn, .sp-pop__go')) b.setAttribute('aria-busy', String(on));
      say.textContent = on ? 'Loading the games catalogue. Quick Play will pick as soon as it’s ready.' : '';
    }
    function quickPlay(overrides) {
      /* never pick from the 110-game fallback while the full catalogue is on its way;
         a second press while it loads is the same request, not another one */
      if (!S.ready) {
        if (qpWaiting) return null;
        qpWaiting = true;
        qpBusy(true);
        catalogue.load().catch(() => {}).then(() => {
          qpWaiting = false;
          if (!alive) return;
          qpBusy(false);
          S.ready = true;
          quickPlay(overrides);
        });
        return null;
      }
      const o = { ...S.qp, ...(overrides || {}) };
      let item;
      try { item = QP.pick({ minutes: o.minutes, players: o.players, mood: o.mood, avoidIds: S.avoid }); }
      catch (err) {
        console.error('[play] quick play', err);
        api.notify({ app: 'Static Play', icon: 'alert', title: 'Quick Play couldn’t choose', message: String(err && err.message || err) });
        return null;
      }
      S.avoid = [`${item.kind}:${item.id}`, ...S.avoid].slice(0, 6);
      S.lastPick = item;
      paintLastPick();
      closePop();
      const w = QP.launch(item, api);
      if (w) {
        api.notify({
          app: 'Static Play', icon: 'zap', title: `Quick Play: ${item.title}`, message: item.reason, timeout: 9000,
          actions: [{ label: 'Pick another', onClick: () => quickPlay(overrides) }],
        });
      }
      return item;
    }

    /* ---------------------------------------------------------------- *
     *  the card menu — one for every kind of card
     * ---------------------------------------------------------------- */
    const ITEM = new WeakMap();          // [data-menu] element -> item
    /** Mark an element as a card whose menu shows `item`. */
    const bindItem = (node, item) => { ITEM.set(node, item); node.dataset.menu = ''; return node; };

    /* only a link is worth keeping in a shortcut or a collection: a creation's
       data: thumbnail would bloat the desktop file, and it is looked up live */
    const linkArt = a => (typeof a === 'string' && /^https?:/.test(a) ? a : null);
    const plainItem = it => ({ kind: it.kind, id: it.id, title: it.title, art: linkArt(it.art) });

    function pinToDesktop(item) {
      let r = null;
      try { r = addToDesktop(plainItem(item)); } catch (err) { console.warn('[play] desktop', err); }
      if (!r) {
        api.notify({ app: 'Static Play', icon: 'alert', title: 'Couldn’t add it to the Desktop',
          message: 'There is no Desktop folder to put the shortcut in.' });
      }
    }

    function menuItems(item, x, y) {
      const out = [];
      if (item.kind === 'creation') {
        out.push({ label: 'Open in Static Forge', icon: 'play', onClick: () => play(item) });
        if (api.getApp('studio')) out.push({ label: 'Edit code in Static Studio', icon: 'code', onClick: () => api.openApp('studio', { project: item.id }) });
      } else {
        out.push({ label: 'Play', icon: 'play', onClick: () => play(item) });
      }
      if (item.kind === 'arcade' && item.a.players.includes(2)) {
        out.push({ label: 'Play with a friend (2 players)', icon: 'users', onClick: () => play(item, { players: 2 }) });
      }
      if (item.kind === 'web') {
        const fav = isFav(item.id);
        out.push({ label: fav ? 'Remove from favorites' : 'Add to favorites', icon: 'heart', hint: 'F', onClick: () => toggleFav(item.id) });
      }
      if (thumbable(item)) {
        const t = thumbOf(item);
        out.push(
          { label: t === 1 ? 'Take back your thumbs-up' : 'Thumbs up', icon: 'thumbs-up', hint: 'U', onClick: () => thumb(item, 1) },
          { label: t === -1 ? 'Unhide (take back your thumbs-down)' : 'Thumbs down — hide it', icon: t === -1 ? 'eye' : 'thumbs-down', hint: 'D', onClick: () => thumb(item, -1) });
      }
      out.push('-',
        { label: 'Add to Desktop', icon: 'monitor', onClick: () => pinToDesktop(item) },
        { label: 'Add to collection…', icon: 'bookmark', onClick: () => collections.pickMenu(api, plainItem(item), x, y) });
      if (item.kind === 'web') out.push('-', { label: 'Details in Static Games', icon: 'info', hint: 'I', onClick: () => details(item) });
      return out;
    }

    let lastMenuAt = 0;
    /** at: a pointer event (clientX/Y), or an element to hang the menu under */
    function openMenu(item, at) {
      if (!item) return;
      /* the Menu key and Shift+F10 can raise a contextmenu event as well as
         the keydown we already answered — one menu per gesture */
      if (performance.now() - lastMenuAt < 250) return;
      lastMenuAt = performance.now();
      const px = at && !at.nodeType ? at.clientX || 0 : 0;
      const py = at && !at.nodeType ? at.clientY || 0 : 0;
      const anchor = at && at.nodeType ? at : document.activeElement || el;
      /* The shell closes a menu on any scroll. A press that focuses a card
         half out of view scrolls it in, and that scroll event is only
         dispatched on the next frame — after this gesture's menu opened.
         Opening one frame later lets that scroll land first. */
      frame(() => {
        let x = px, y = py;
        if (!x && !y) {
          const r = (anchor.isConnected ? anchor : el).getBoundingClientRect();
          const under = anchor.classList?.contains('sp-more-btn');
          x = under ? r.left : r.left + Math.min(24, r.width / 2);
          y = under ? r.bottom + 4 : r.top + Math.min(24, r.height / 2);
        }
        api.menu(menuItems(item, x, y), x, y);
      }, 'menu');
    }
    /* a right-button press only asks for the menu: it does not move focus
       (and so cannot scroll the row under it) */
    el.addEventListener('mousedown', e => {
      if (e.button === 2 && e.target.closest?.('[data-menu]') && !e.target.closest('input, textarea')) e.preventDefault();
    });

    /** the visible '…' button */
    function moreBtn(item, cls = '', focusable = false) {
      return h(`button.sp-more-btn${cls}`, { type: 'button', tabindex: focusable ? null : '-1', title: 'More: favorite, thumbs, Add to Desktop, collections (M)',
        'aria-label': `More options for ${item.title}`, 'aria-haspopup': 'menu',
        onclick: e => { e.stopPropagation(); openMenu(item, e.currentTarget); } }, icon('more-horizontal'));
    }

    /* right-click, anywhere on a card */
    el.addEventListener('contextmenu', e => {
      const host = e.target.closest?.('[data-menu]');
      const item = host && ITEM.get(host);
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      if (performance.now() - lpFiredAt < 900) return;   // the long-press already opened it
      if (lp) {                                            // Android raises its own long-press menu event
        cancelLP();
        lpFiredAt = performance.now();
        swallowUntil = Infinity;
      }
      openMenu(item, e.clientX || e.clientY ? e : (e.target.closest('.sp-go') || host));
    });

    /* long-press on touch and pen: the same menu, and the tap that trails it
       (which would land on the menu's first row) is swallowed */
    let lp = null;
    let lpFiredAt = -1e9;
    let swallowUntil = 0;
    const cancelLP = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.button > 0) return;
      const host = e.target.closest?.('[data-menu]');
      if (!host || !ITEM.get(host) || e.target.closest('.sp-more-btn')) return;
      cancelLP();
      const x = e.clientX, y = e.clientY;
      lp = { x, y, timer: setTimeout(() => {
        lp = null;
        lpFiredAt = performance.now();
        swallowUntil = Infinity;
        openMenu(ITEM.get(host), { clientX: x, clientY: y });
      }, LONG_PRESS) };
    });
    el.addEventListener('pointermove', e => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancelLP(); });
    const onLpEnd = () => {
      cancelLP();
      if (swallowUntil === Infinity) swallowUntil = performance.now() + 450;
    };
    const onSwallow = e => {
      if (performance.now() > swallowUntil) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'click') swallowUntil = 0;
    };
    window.addEventListener('pointerup', onLpEnd, true);
    window.addEventListener('pointercancel', onLpEnd, true);
    window.addEventListener('click', onSwallow, true);
    offs.push(() => {
      cancelLP();
      window.removeEventListener('pointerup', onLpEnd, true);
      window.removeEventListener('pointercancel', onLpEnd, true);
      window.removeEventListener('click', onSwallow, true);
    });

    /* ---------------------------------------------------------------- *
     *  cards
     * ---------------------------------------------------------------- */
    function artNode(item, o = {}) {
      const box = h('div.sp-art');
      if (item.kind === 'arcade') {
        box.classList.add('sp-art--arcade');
        box.style.setProperty('--hue', item.a.hue);
        box.append(h('span.sp-art__glyph', icon(item.a.icon)));
      } else {
        box.style.background = artBg(item.title);
        box.append(h('span.sp-art__mono', { text: item.title }));
        if (item.kind === 'creation' && !item.art) box.append(h('span.sp-art__glyph.sp-art__glyph--sm', icon('sparkles')));
        if (item.art) {
          box.append(h('img.sp-art__img', {
            src: o.big ? bigArt(item.art) : item.art, alt: '', loading: o.eager ? 'eager' : 'lazy', decoding: 'async',
            referrerpolicy: 'no-referrer', draggable: 'false',
            onload: e => e.target.classList.add('is-in'),
            onerror: e => {
              const img = e.target;
              if (o.big && img.src !== item.art && !img.dataset.retry) { img.dataset.retry = '1'; img.src = item.art; return; }
              img.remove();
            },
          }));
        }
      }
      if (item.kind === 'arcade') box.append(h('span.sp-badge', icon('zap', { fill: true }), 'Instant'));
      if (item.kind === 'creation') box.append(h('span.sp-badge.sp-badge--mine', item.p.published ? 'Published' : 'Draft'));
      if (o.rank) box.append(h('span.sp-rank', { text: String(o.rank), 'aria-hidden': 'true' }));
      return box;
    }

    function metaOf(item) {
      if (item.kind === 'arcade') return `Arcade · ~${item.a.minutes} min · ${playersText(item.a)}`;
      if (item.kind === 'creation') {
        const p = item.p;
        return p.published ? `Your game · published ${QP.ago(p.published.at)}` : `Your draft · edited ${QP.ago(p.updatedAt)}`;
      }
      return webMeta(item.g);
    }

    function favBtn(item) {
      const b = h('button.sp-fav', { type: 'button', tabindex: '-1', dataset: { favId: item.id },
        onclick: e => { e.stopPropagation(); toggleFav(item.id); } });
      paintFav(b, isFav(item.id), item.title);
      return b;
    }
    function paintFav(b, on, title) {
      const t = title || b.dataset.title || 'this game';
      b.dataset.title = t;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? `Remove ${t} from favorites` : `Add ${t} to favorites`);
      b.title = on ? 'Remove from favorites (F)' : 'Add to favorites (F)';
      api.render(b, icon('heart', { fill: on }));
    }

    /** v = 1 (thumbs-up) or -1 (thumbs-down: hide) */
    function thumbBtn(item, v, cls = '') {
      const b = h(`button.sp-thumb${cls}`, { type: 'button', tabindex: cls ? null : '-1',
        dataset: { thumb: thumbKey(item), v: String(v), title: item.title },
        onclick: e => { e.stopPropagation(); thumb(item, v); } });
      paintThumb(b);
      return b;
    }
    function paintThumb(b) {
      const [kind, ...rest] = b.dataset.thumb.split(':');
      const v = Number(b.dataset.v);
      const on = thumbs.of(kind, rest.join(':')) === v;
      const t = b.dataset.title || 'this game';
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      if (v === 1) {
        b.setAttribute('aria-label', on ? `Take back your thumbs-up for ${t}` : `Thumbs up ${t}`);
        b.title = on ? 'Take back your thumbs-up (U)' : 'Thumbs up (U)';
      } else {
        b.setAttribute('aria-label', on ? `Unhide ${t}` : `Thumbs down: hide ${t}`);
        b.title = on ? 'Unhide — take back your thumbs-down (D)' : 'Thumbs down — hide it (D)';
      }
      api.render(b, icon(v === 1 ? 'thumbs-up' : 'thumbs-down', { fill: on }));
    }
    /** the pair, for the hero, the gem spotlight and anything with room for buttons */
    const thumbPair = (item, cls) => [thumbBtn(item, 1, cls), thumbBtn(item, -1, cls)];

    function goBtn(item, o, label) {
      return h('button.sp-go', {
        type: 'button', 'aria-label': label,
        'aria-keyshortcuts': item.kind === 'web' ? 'F U D I M Shift+F10' : item.kind === 'arcade' ? 'U D M Shift+F10' : 'M Shift+F10',
        dataset: { kind: item.kind, id: item.id },
        onclick: () => (o.onPlay ? o.onPlay(item) : play(item, o.how)),
        on: { 'sp:fav': () => { if (item.kind === 'web') toggleFav(item.id); }, 'sp:info': () => { if (item.kind === 'web') details(item); } },
      });
    }

    /** size: 'xl' | 'lg' | 'md' | 'sm' */
    function card(item, o = {}) {
      const size = o.size || 'md';
      const meta = o.meta !== undefined ? o.meta : metaOf(item);
      const why = o.why || item.why || '';
      const label = `${item.kind === 'creation' ? 'Open' : 'Play'} ${item.title}${why ? `. ${why}` : ''}`;
      return bindItem(h(`div.sp-card.sp-card--${size}`, { role: 'listitem', dataset: { kind: item.kind } },
        artNode(item, o),
        h('div.sp-card__b',
          h('div.sp-card__t', { text: item.title }),
          meta ? h('div.sp-card__m', { text: meta }) : null,
          why ? h(`div.sp-card__why${o.muted ? '.sp-card__why--muted' : ''}`, icon(o.whyIcon || 'sparkles'), h('span', { text: why })) : null),
        goBtn(item, o, label),
        thumbable(item) ? h('div.sp-thumbs', { role: 'group', 'aria-label': `Your thumbs for ${item.title}` }, thumbPair(item)) : null,
        h('div.sp-card__acts',
          item.kind === 'web' ? favBtn(item) : null,
          item.kind === 'web' ? h('button.sp-info', { type: 'button', tabindex: '-1', title: 'Details in Static Games (I)',
            'aria-label': `Details for ${item.title} in Static Games`,
            onclick: e => { e.stopPropagation(); details(item); } }, icon('info')) : null,
          moreBtn(item))), item);
    }

    /** a compact list tile, for long category shelves */
    function tile(item, o = {}) {
      const why = o.why || item.why || '';
      const meta = o.meta !== undefined ? o.meta : metaOf(item);
      return bindItem(h('div.sp-tile', { role: 'listitem', dataset: { kind: item.kind } },
        artNode(item, o),
        h('div.sp-tile__b', h('div.sp-tile__t', { text: item.title }),
          h('div.sp-tile__m', { text: why || meta })),
        goBtn(item, o, `Play ${item.title}${why ? `. ${why}` : ''}`),
        h('div.sp-tile__acts', thumbable(item) ? thumbBtn(item, 1) : null, item.kind === 'web' ? favBtn(item) : null, moreBtn(item))), item);
    }

    /* ---------------------------------------------------------------- *
     *  rows
     * ---------------------------------------------------------------- */
    let secSeq = 0;
    /**
     * spec = { id, title, icon, sub, items, size, layout: 'rail'|'compact'|'grid',
     *          more: {label, onClick}, lazy, cls, head }
     * Returns null when there is nothing real to show.
     */
    function shelf(spec) {
      /* a game you gave a thumbs-down is left out of every shelf (bar the
         list of hidden games itself) — checked again when a lazy row fills */
      const shown = list => (spec.showHidden ? list : list.filter(it => it.nodeType || !isHidden(it)));
      const items = shown(arr(spec.items));
      if (!items.length && !spec.keepEmpty) return null;
      const hid = `sp-h-${++secSeq}`;
      const layout = spec.layout || 'rail';
      const rail = h(`div.sp-rail.sp-rail--${layout}.sp-rail--${spec.size || 'md'}`,
        { role: 'list', 'aria-labelledby': hid, dataset: { nav: layout === 'grid' ? 'grid' : 'row' } });

      const tools = h('div.sp-sec__tools');
      if (spec.more) tools.append(h('button.sp-more', { type: 'button', onclick: spec.more.onClick }, h('span', { text: spec.more.label }), icon('chevron-right')));
      let prev = null, next = null;
      if (layout !== 'grid') {
        const step = d => rail.scrollBy({ left: d * Math.max(200, rail.clientWidth * 0.85), behavior: reduced() ? 'auto' : 'smooth' });
        prev = h('button.sp-arrow', { type: 'button', tabindex: '-1', 'aria-label': `Scroll ${spec.title} back`, onclick: () => step(-1) }, icon('chevron-left'));
        next = h('button.sp-arrow', { type: 'button', tabindex: '-1', 'aria-label': `Scroll ${spec.title} forward`, onclick: () => step(1) }, icon('chevron-right'));
        tools.append(prev, next);
        const upd = () => {
          /* a row that fits has nothing to scroll: no arrows at all */
          const fits = rail.scrollWidth <= rail.clientWidth + 2;
          prev.hidden = next.hidden = fits;
          prev.disabled = rail.scrollLeft <= 2;
          next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
        };
        rail.addEventListener('scroll', () => frame(upd, `arr-${hid}`), { passive: true });
        rail._upd = upd;
      }

      const sec = h(`section.sp-sec${spec.cls ? '.' + spec.cls : ''}`, { 'aria-labelledby': hid, dataset: { sec: spec.id || '' } },
        h('div.sp-sec__h',
          h('div.sp-sec__tt',
            h('h2.sp-sec__title', { id: hid }, spec.icon ? icon(spec.icon) : null, h('span', { text: spec.title })),
            spec.sub ? h('p.sp-sec__sub', { text: spec.sub }) : null),
          tools),
        spec.head || null,
        rail);

      const fill = () => {
        const make = layout === 'compact' ? tile : card;
        const now = spec.lazy ? shown(items) : items;
        if (!now.length && !spec.keepEmpty) { dropSection(sec); return; }
        api.render(rail, now.map(it => (it.nodeType ? it : make(it, { size: spec.size, ...(it.o || {}) }))));
        rove(rail);
        if (rail._upd) frame(rail._upd);
      };
      if (spec.lazy) {
        const n = layout === 'compact' ? 9 : Math.min(items.length, 6);
        api.render(rail, Array.from({ length: n }, () => h(`div.sp-skel.sp-skel--${layout === 'compact' ? 'tile' : spec.size || 'md'}`)));
        lazy.push({ sec, fill });
      } else fill();
      return sec;
    }

    function checkLazy() {
      if (!lazy.length) return;
      const limit = main.scrollTop + main.clientHeight + 700;
      for (let i = 0; i < lazy.length; i++) {
        const L = lazy[i];
        if (!L.sec.isConnected) { lazy.splice(i--, 1); continue; }
        if (L.sec.offsetTop < limit) { lazy.splice(i--, 1); L.fill(); }
      }
    }
    main.addEventListener('scroll', () => frame(checkLazy, 'lazy'), { passive: true });

    /** a row with nothing left in it goes, and so does a Home slot left empty */
    function dropSection(sec) {
      const slot = sec.closest('.sp-slot');
      const cols = sec.parentElement && sec.parentElement.classList.contains('sp-cols') ? sec.parentElement : null;
      sec.remove();
      if (cols && !cols.querySelector('.sp-sec')) cols.remove();
      if (slot && !slot.firstElementChild) slot.hidden = true;
    }

    /* ---- roving focus + console-style arrows ---------------------------- */
    function rove(box) {
      const gos = [...box.querySelectorAll('.sp-go')];
      gos.forEach((g, i) => g.setAttribute('tabindex', i === 0 ? '0' : '-1'));
    }
    view.addEventListener('focusin', e => {
      const go = e.target.closest?.('.sp-go');
      const box = go && go.closest('[data-nav]');
      if (!box) return;
      for (const g of box.querySelectorAll('.sp-go')) g.setAttribute('tabindex', g === go ? '0' : '-1');
    });

    function focusGo(g) {
      if (!g) return;
      const box = g.closest('[data-nav]');
      if (box) for (const x of box.querySelectorAll('.sp-go')) x.setAttribute('tabindex', x === g ? '0' : '-1');
      g.focus({ preventScroll: true });
      (g.closest('.sp-card, .sp-tile, .sp-atile') || g).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    }

    /** nearest card in the row above / below, by position on screen */
    function vertical(from, dir) {
      const r0 = from.getBoundingClientRect();
      const cx = r0.left + r0.width / 2;
      const cands = [];
      for (const g of view.querySelectorAll('.sp-go')) {
        if (g === from || g.offsetParent === null) continue;
        const r = g.getBoundingClientRect();
        if (dir > 0 ? r.top < r0.bottom - 4 : r.bottom > r0.top + 4) continue;
        const rail = g.closest('.sp-rail--rail, .sp-rail--compact');
        if (rail) {
          const rr = rail.getBoundingClientRect();
          if (r.right < rr.left + 8 || r.left > rr.right - 8) continue;
        }
        cands.push({ g, gap: dir > 0 ? r.top - r0.bottom : r0.top - r.bottom, dx: Math.abs(r.left + r.width / 2 - cx) });
      }
      if (!cands.length) return null;
      const min = Math.min(...cands.map(c => c.gap));
      return cands.filter(c => c.gap <= min + 24).sort((a, b) => a.dx - b.dx)[0].g;
    }

    view.addEventListener('keydown', e => {
      const go = e.target.closest?.('.sp-go');
      if (!go || e.altKey || e.ctrlKey || e.metaKey) return;
      const box = go.closest('[data-nav]');
      const list = box ? [...box.querySelectorAll('.sp-go')] : [go];
      const i = list.indexOf(go);
      let to = null;
      if (e.key === 'm' || e.key === 'M' || (e.shiftKey && e.key === 'F10')) {
        const host = go.closest('[data-menu]');
        if (host && ITEM.get(host)) { e.preventDefault(); openMenu(ITEM.get(host), go); }
        return;
      }
      if (box?.dataset.nav === 'hero' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        box._step?.(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (e.key === 'ArrowRight') to = list[i + 1];
      else if (e.key === 'ArrowLeft') to = list[i - 1];
      else if (e.key === 'Home') to = list[0];
      else if (e.key === 'End') to = list[list.length - 1];
      else if (e.key === 'ArrowDown') to = vertical(go, 1);
      else if (e.key === 'ArrowUp') {
        to = vertical(go, -1);
        if (!to) { e.preventDefault(); main.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); tabBtns[TABS.findIndex(t => t.id === S.tab)]?.focus(); return; }
      } else if ((e.key === 'f' || e.key === 'F') && go.dataset.kind === 'web') {
        e.preventDefault(); go.dispatchEvent(new CustomEvent('sp:fav')); return;
      } else if ((e.key === 'i' || e.key === 'I') && go.dataset.kind === 'web') {
        e.preventDefault(); go.dispatchEvent(new CustomEvent('sp:info')); return;
      } else if (/^[udUD]$/.test(e.key) && (go.dataset.kind === 'web' || go.dataset.kind === 'arcade')) {
        /* U thumbs-up, D thumbs-down (hides it; the focus moves on to its neighbour) */
        const host = go.closest('[data-menu]');
        const it = host && ITEM.get(host);
        if (it) { e.preventDefault(); thumb(it, /u/i.test(e.key) ? 1 : -1); }
        return;
      } else return;
      e.preventDefault();
      if (to) focusGo(to);
    });

    /* '/' focuses search from anywhere in the app that is not a text field */
    const onRootKey = e => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      searchIn.focus();
      searchIn.select();
    };
    root.addEventListener('keydown', onRootKey);
    offs.push(() => root.removeEventListener('keydown', onRootKey));

    /* Opening or switching to Play puts the keyboard in it, so arrows, '/'
       and Tab work at once instead of acting on whatever had focus before
       (the dock button that opened it). A click inside moves focus on its
       own afterwards, so this never fights the pointer. */
    const focusInside = () => {
      /* only while Play is the window in front — a game Quick Play just
         opened keeps the keyboard */
      if (!alive || !win.el?.classList.contains('is-active') || el.contains(document.activeElement)) return;
      main.focus({ preventScroll: true });
    };
    win.onFocus(() => frame(focusInside, 'winfocus'));
    /* a resized window changes which rows overflow (their arrows) and how
       much of the page is near the fold (lazy rows) */
    win.onResize(() => frame(() => {
      for (const r of view.querySelectorAll('.sp-rail')) r._upd?.();
      checkLazy();
    }, 'resize'));

    /* ---------------------------------------------------------------- *
     *  quick play controls (shared by the bar popover and the Home banner)
     * ---------------------------------------------------------------- */
    const QP_TIME = [{ v: null, l: 'Any' }, { v: 5, l: '5 min' }, { v: 15, l: '15 min' }, { v: 30, l: '30 min+' }];
    const QP_WHO = [{ v: 1, l: 'Just me' }, { v: 2, l: 'With a friend' }];
    const QP_MOOD = [{ v: '', l: 'Any' }, { v: 'relax', l: 'Chill' }, { v: 'scary', l: 'Scary' }, { v: 'race', l: 'Racing' }, { v: 'hard', l: 'Hard' }];
    const qpPainters = new Set();

    function setQP(patch) {
      S.qp = { ...S.qp, ...patch };
      api.store.set(K_QP, { ...S.qp });
      for (const p of qpPainters) p();
    }

    function qpControls(idp) {
      const group = (label, list, key) => {
        const btns = list.map(o => h('button.sp-pill', { type: 'button', onclick: () => setQP({ [key]: o.v }) }, o.l));
        const paint = () => btns.forEach((b, i) => {
          const on = key === 'mood' ? S.qp.mood === list[i].v : (S.qp[key] ?? null) === list[i].v;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        return { node: h('div.sp-qpc__g', { role: 'group', 'aria-labelledby': `${idp}-${key}` },
          h('span.sp-qpc__l', { id: `${idp}-${key}`, text: label }), h('div.sp-qpc__pills', btns)), paint };
      };
      const time = group('How long', QP_TIME, 'minutes');
      const who = group('Players', QP_WHO, 'players');
      const mood = group('Mood', QP_MOOD, 'mood');
      const custom = h('input.sp-qpc__in', { type: 'text', placeholder: 'or type a mood…', maxlength: '40',
        'aria-label': 'Describe a mood in your own words, for example zombies or something calm' });
      custom.addEventListener('input', () => setQP({ mood: custom.value.trim() }));
      custom.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quickPlay(); } });
      mood.node.querySelector('.sp-qpc__pills').append(custom);
      const paint = () => {
        time.paint(); who.paint(); mood.paint();
        const preset = QP_MOOD.some(m => m.v === S.qp.mood);
        if (document.activeElement !== custom) custom.value = preset ? '' : S.qp.mood;
      };
      paint();
      qpPainters.add(paint);
      return { node: h('div.sp-qpc', time.node, who.node, mood.node), dispose: () => qpPainters.delete(paint) };
    }

    /* popover */
    let popCtl = null;
    const onDocDown = e => { if (!qpPop.hidden && !qpPop.contains(e.target) && !qpBar.contains(e.target)) closePop(); };
    function togglePop() { qpPop.hidden ? openPop() : closePop(); }
    function openPop() {
      if (!popCtl) {
        popCtl = qpControls('sp-pop');
        api.render(qpPop,
          h('div.sp-pop__h', h('b', { text: 'Quick Play' }), h('span', { text: 'Picks from your favorites and history — and now and then something new that fits. It always says why.' })),
          popCtl.node,
          h('button.sp-btn.sp-btn--play.sp-pop__go', { type: 'button', onclick: () => quickPlay() }, icon('zap', { fill: true }), 'Pick & play'));
      }
      qpPop.hidden = false;
      qpMore.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onDocDown, true);
      frame(() => qpPop.querySelector('.sp-pill.is-on, .sp-pill')?.focus());
    }
    function closePop(refocus) {
      if (qpPop.hidden) return;
      qpPop.hidden = true;
      qpMore.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDocDown, true);
      if (refocus) qpMore.focus();
    }
    qpPop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); } });
    offs.push(() => { document.removeEventListener('pointerdown', onDocDown, true); popCtl?.dispose(); });

    /* the last pick, wherever it is shown */
    const lastPickNodes = new Set();
    function paintLastPick() {
      for (const n of lastPickNodes) {
        if (!n.isConnected) { lastPickNodes.delete(n); continue; }
        const p = S.lastPick;
        api.render(n, p ? [h('b', { text: `Last pick: ${p.title}` }), h('span', { text: p.reason })] : []);
      }
    }

    /* ---------------------------------------------------------------- *
     *  data helpers (all real, all local)
     * ---------------------------------------------------------------- */
    /** recent launches resolved to items, newest first, one per game */
    function recentItems(n) {
      const out = [];
      const seen = new Set();
      const push = (it, at) => {
        const k = `${it.kind}:${it.id}`;
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ ...it, at });
      };
      for (const r of plays.recent(40)) {
        if (r.kind === 'web') { const g = catalogue.byId(r.id); if (g) push(webItem(g), r.at); }
        else if (r.kind === 'arcade') { const a = ARCADE.find(x => x.id === r.id); if (a) push(arcItem(a), r.at); }
        else if (r.kind === 'creation') { const p = (S.projects || []).find(x => x.id === r.id); if (p) push(creItem(p), r.at); }
        if (out.length >= n) break;
      }
      /* launches from before the shared history existed */
      if (out.length < n) {
        for (const r of arr(api.store.get(K_RECENT, []))) {
          const g = r && catalogue.byId(r.id);
          if (g && Number.isFinite(r.at)) push(webItem(g), r.at);
          if (out.length >= n) break;
        }
        out.sort((a, b) => b.at - a.at);
      }
      return out.slice(0, n);
    }

    const playedWebIds = () => new Set(recentItems(80).filter(x => x.kind === 'web').map(x => x.id));

    /** a saved collection entry as a card item — web, Arcade or your own game */
    function collectionItem(x) {
      if (x.kind === 'web') { const g = catalogue.byId(x.id); return g ? webItem(g) : null; }
      if (x.kind === 'arcade') { const a = ARCADE.find(y => y.id === x.id); return a ? arcItem(a) : null; }
      if (x.kind === 'creation') { const p = arr(S.projects).find(y => y.id === x.id); return p ? creItem(p) : null; }
      return null;
    }

    /** one of your thumbs ({ kind, id, at }) as a card item, with an optional meta line */
    function markedItem(x, meta) {
      const it = collectionItem(x);
      if (it && meta) it.o = { meta };
      return it;
    }

    function sharedWith(g, src) {
      const cats = g.cats.filter(c => c !== 'featured' && src.cats.includes(c)).map(catName);
      const st = new Set(src.tags.map(t => t.toLowerCase()));
      const tag = g.tags.find(t => st.has(t.toLowerCase()) && !NOISE_TAGS.test(t));
      const bits = [...cats.slice(0, 2), tag ? tag.toLowerCase() : null].filter(Boolean);
      /* only ever shown under "Because you played <name>", so the name is not repeated */
      return bits.length ? `Also ${bits.join(' · ')}` : (g.curated && src.curated ? 'Also hand-picked' : 'Shares its categories');
    }

    /** categories you have played, with how many distinct games in each */
    function playedCats() {
      const played = new Map();
      for (const it of recentItems(80)) {
        const cats = it.kind === 'web' ? it.g.cats
          : it.kind === 'arcade' ? it.a.tags.filter(t => CAT_ROWS.includes(t)) : [];
        for (const c of new Set(cats)) if (c !== 'featured') played.set(c, (played.get(c) || 0) + 1);
      }
      return played;
    }

    /* memoised per catalogue: hashing 8,000 ids on every render adds up */
    let measuredMemo = null;
    const measuredRows = () => {
      const all = catalogue.all();
      if (!measuredMemo || measuredMemo.all !== all) measuredMemo = { all, rows: all.filter(QP.measured) };
      return measuredMemo.rows.slice();
    };

    function curated() {
      return catalogue.query({ category: 'featured', sort: 'catalogue', perPage: 200 }).items;
    }

    function heroList() {
      const cur = curated();
      const withArt = cur.filter(g => g.art && !thumbs.isHidden('web', g.id));
      /* the explicitly featured ones lead, then the rest of the hand-picked shelf */
      const lead = withArt.filter(g => g.cats.includes('featured'));
      const rest = withArt.filter(g => !g.cats.includes('featured'));
      return [...lead, ...rest].slice(0, HERO_N).map(g => webItem(g));
    }

    /** the Featured row: the rest of the hand-picked shelf after the hero */
    function featuredGames() {
      const heroIds = new Set(heroList().map(x => x.id));
      return curated().filter(g => !heroIds.has(g.id)).slice(0, 24);
    }

    /**
     * Hidden Gems — one rule for Home and Discover, always stated.
     * With measured numbers: rated 4.5+ with fewer plays than the median.
     * Today (no measured numbers): hand-picked, but further down the shelf
     * than the hero and Featured reach, and never played on this device.
     */
    function gemRule(played) {
      const rows = measuredRows();
      if (rows.length) {
        const sorted = rows.map(g => g.plays).sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        return {
          pool: rows.filter(g => g.rating >= 4.5 && g.plays < median && !played.has(g.id) && !thumbs.isHidden('web', g.id)),
          rule: `rated 4.5 or higher, with fewer plays than the median game here (${median.toLocaleString()}), and not played on this device yet`,
          why: g => `Rated ${g.rating.toFixed(1)} · ${g.plays.toLocaleString()} plays`,
        };
      }
      const shown = new Set([...heroList(), ...featuredGames()].map(g => g.id));
      return {
        pool: curated().filter(g => !shown.has(g.id) && !played.has(g.id) && !thumbs.isHidden('web', g.id)),
        rule: 'hand-picked for StaticOS, further down the shelf than Featured reaches, and never played on this device',
        why: () => 'Hand-picked · not played here yet',
      };
    }

    /* ---------------------------------------------------------------- *
     *  the hero
     * ---------------------------------------------------------------- */
    function hero(list) {
      if (!list.length) return null;
      let i = 0;
      let timer = 0;
      let hover = false;
      let userPaused = false;
      let dead = false;
      const still = reduced();

      const bg = h('div.sp-hero__bg');
      const text = h('div.sp-hero__text');
      const pic = h('div.sp-hero__pic');
      const dots = h('div.sp-hero__dots', { role: 'group', 'aria-label': 'Choose a featured game' });
      const dotBtns = list.map((it, n) => h('button.sp-hero__dot', { type: 'button', 'aria-label': `Show ${it.title} (${n + 1} of ${list.length})`,
        onclick: () => show(n, true) }, h('i')));
      dots.append(...dotBtns);
      /* the dots are one tab stop: arrows move between them (and show that game) */
      dots.addEventListener('keydown', e => {
        const k = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
        if (k === undefined) return;
        e.preventDefault();
        show(k, true);
        dotBtns[i].focus({ preventScroll: true });
      });
      const pauseBtn = still ? null : h('button.sp-hero__pause', { type: 'button', onclick: () => { userPaused = !userPaused; sync(); } });

      const node = h('section.sp-hero', { 'aria-roledescription': 'carousel', 'aria-label': 'Featured games', dataset: { nav: 'hero' } },
        bg, h('div.sp-hero__in', text, pic), h('div.sp-hero__foot', dots, pauseBtn));
      node._step = d => { show(i + d, true); node.querySelector('.sp-hero__play')?.focus({ preventScroll: true }); };

      function paint() {
        const it = list[i];
        const g = it.g;
        const src = bigArt(it.art);
        api.render(bg, h('img', { src, alt: '', referrerpolicy: 'no-referrer', decoding: 'async', onerror: e => e.target.remove() }));
        api.render(pic, artNode(it, { big: true, eager: true }));
        const cats = g.cats.filter(c => c !== 'featured').slice(0, 3).map(c => h('span.sp-chip', icon(catIcon(c)), catName(c)));
        const playing = document.activeElement && node.contains(document.activeElement) && document.activeElement.classList.contains('sp-hero__play');
        api.render(text,
          h('div.sp-eyebrow', icon('star', { fill: true }), h('span', { text: `Featured · ${i + 1} of ${list.length}` })),
          h('h2.sp-hero__title', { text: it.title }),
          h('div.sp-hero__meta', studioOf(g) ? h('span', { text: studioOf(g) }) : null, ...cats),
          g.desc ? h('p.sp-hero__desc', { text: QP.cleanText(g.desc) }) : h('p.sp-hero__desc.sp-hero__desc--muted', { text: 'Hand-picked for the StaticOS catalogue. Plays right here in Static Games.' }),
          h('div.sp-hero__acts',
            h('button.sp-btn.sp-btn--play.sp-go.sp-hero__play', { type: 'button', tabindex: '0', dataset: { kind: 'web', id: it.id },
              'aria-label': `Play ${it.title}`, 'aria-keyshortcuts': 'F U D I M Shift+F10',
              onclick: () => play(it),
              on: { 'sp:fav': () => toggleFav(it.id), 'sp:info': () => details(it) } }, icon('play', { fill: true }), 'Play'),
            h('button.sp-btn', { type: 'button', onclick: () => details(it) }, icon('info'), 'Details'),
            (() => { const b = h('button.sp-btn.sp-btn--icon.sp-fav', { type: 'button', dataset: { favId: it.id },
              onclick: () => toggleFav(it.id) }); paintFav(b, isFav(it.id), it.title); return b; })(),
            ...thumbPair(it, '.sp-btn.sp-btn--icon'),
            moreBtn(it, '.sp-btn.sp-btn--icon', true)));
        bindItem(node, it);
        if (playing) node.querySelector('.sp-hero__play')?.focus({ preventScroll: true });
        dotBtns.forEach((b, n) => { b.classList.toggle('is-on', n === i); b.setAttribute('aria-current', n === i ? 'true' : 'false'); b.tabIndex = n === i ? 0 : -1; });
        if (!still) {
          text.classList.remove('is-enter'); pic.classList.remove('is-enter');
          void text.offsetWidth;
          text.classList.add('is-enter'); pic.classList.add('is-enter');
        }
      }
      function show(n, user) {
        i = (n + list.length) % list.length;
        paint();
        if (user) restart();
      }
      function sync() {
        if (dead) return;
        const paused = still || userPaused || hover;
        node.classList.toggle('is-paused', paused);
        /* re-render only on a real change: replacing the icon between mousedown
           and mouseup (focus lands on press) would swallow the click */
        if (pauseBtn && pauseBtn.dataset.state !== String(userPaused)) {
          pauseBtn.dataset.state = String(userPaused);
          api.render(pauseBtn, icon(userPaused ? 'play' : 'pause', { fill: userPaused }));
          pauseBtn.setAttribute('aria-label', userPaused ? 'Resume featured rotation' : 'Pause featured rotation');
          pauseBtn.title = userPaused ? 'Resume rotation' : 'Pause rotation';
        }
        clearInterval(timer);
        timer = 0;
        if (!paused && list.length > 1) timer = setInterval(tick, HERO_MS);
      }
      /* nobody is looking — a hidden tab, a minimised window, the hero
         scrolled away: hold still rather than repaint for nothing */
      function tick() {
        if (!alive || !node.isConnected) { clearInterval(timer); timer = 0; return; }
        if (document.hidden || !node.getClientRects().length || main.scrollTop > node.offsetHeight * 0.8) return;
        show(i + 1);
      }
      function restart() { sync(); node.classList.remove('is-tick'); void node.offsetWidth; node.classList.add('is-tick'); }
      node.addEventListener('pointerenter', () => { hover = true; sync(); });
      node.addEventListener('pointerleave', () => { hover = false; sync(); });
      node.addEventListener('focusin', () => { hover = true; sync(); });
      node.addEventListener('focusout', e => { if (!node.contains(e.relatedTarget)) { hover = false; sync(); } });
      /* gone for good: a late focusout or pointerleave from the removed
         node must not start the rotation again */
      node._dispose = () => { dead = true; clearInterval(timer); timer = 0; };
      viewOffs.push(node._dispose);
      paint();
      sync();
      node.classList.add('is-tick');
      return node;
    }

    function heroSkeleton() {
      return h('section.sp-hero.sp-hero--skel', { 'aria-hidden': 'true' }, h('div.sp-hero__in', h('div.sp-hero__text',
        h('div.sp-skel.sp-skel--line'), h('div.sp-skel.sp-skel--title'), h('div.sp-skel.sp-skel--line')), h('div.sp-hero__pic', h('div.sp-skel.sp-skel--pic'))));
    }

    /* ---------------------------------------------------------------- *
     *  Home
     * ---------------------------------------------------------------- */
    const HOME = {
      hero: () => (S.ready ? hero(heroList()) : heroSkeleton()),

      continue: () => {
        const items = recentItems(14).map(it => ({ ...it, o: { meta: `${metaOf(it).split(' · ')[0]} · played ${QP.ago(it.at)}` } }));
        return shelf({ id: 'continue', title: 'Continue Playing', icon: 'play', size: 'xl', items,
          sub: `${plural(plays.count() || items.length, 'game')} played on this device` });
      },

      quick: () => {
        const ctl = qpControls('sp-home');
        viewOffs.push(ctl.dispose);
        const last = h('div.sp-qp__last', { 'aria-live': 'polite' });
        lastPickNodes.add(last);
        const node = h('section.sp-qp', { 'aria-labelledby': 'sp-qp-h' },
          h('div.sp-qp__lead',
            h('span.sp-qp__icon', icon('zap', { fill: true })),
            h('div', h('h2.sp-qp__title', { id: 'sp-qp-h', text: 'Quick Play' }),
              h('p.sp-qp__sub', { text: 'Can’t decide? One press picks something that fits — and tells you why.' }))),
          ctl.node,
          h('div.sp-qp__go',
            h('div', { dataset: { nav: 'row' } }, h('button.sp-btn.sp-btn--play.sp-btn--lg.sp-go.sp-qp__btn', { type: 'button', onclick: () => quickPlay() }, icon('zap', { fill: true }), 'Pick & play')),
            last));
        frame(paintLastPick);
        return node;
      },

      /* favourites are kept newest first (every app that adds one puts it at the front) */
      favorites: () => {
        const items = catalogue.byIds(QP.favIds()).map(g => webItem(g)).filter(it => !isHidden(it));
        return shelf({ id: 'favorites', title: 'Your Favorites', icon: 'heart', size: 'sm', items,
          sub: `${plural(items.length, 'game')} you saved · newest first` });
      },

      thumbs: () => {
        const items = thumbs.list(1).map(x => markedItem(x)).filter(Boolean);
        return shelf({ id: 'thumbs', title: 'Your thumbs-up', icon: 'thumbs-up', size: 'sm', items,
          sub: `${plural(items.length, 'game')} you gave a thumbs-up on this device · newest first` });
      },

      /* the games you gave a thumbs-down: closed until asked for, and the
         only place they still show, so each can be brought back */
      hidden: () => {
        const items = thumbs.list(-1).map(x => markedItem(x, `Hidden ${QP.ago(x.at)}`)).filter(Boolean);
        if (!items.length) return null;
        const open = S.hiddenOpen;
        const sec = shelf({ id: 'hidden', title: 'Hidden by you', icon: 'eye-off', size: 'sm', cls: 'sp-sec--hidden',
          items: open ? items : [], keepEmpty: true, showHidden: true,
          sub: `${plural(items.length, 'game')} you gave a thumbs-down. ${items.length === 1 ? 'It’s' : 'They’re'} left out of every shelf, search and Quick Play here${open ? ' — press a lit thumbs-down to bring one back.' : '.'}` });
        const btn = h('button.sp-more.sp-hidden__toggle', { type: 'button', 'aria-expanded': String(open),
          onclick: () => {
            S.hiddenOpen = !S.hiddenOpen;
            fillSlot('hidden');
            slots.get('hidden')?.querySelector('.sp-hidden__toggle')?.focus({ preventScroll: true });
          } }, h('span', { text: open ? 'Close the list' : 'Show them' }), icon(open ? 'chevron-up' : 'chevron-down'));
        sec.querySelector('.sp-sec__tools').prepend(btn);
        if (!open) {
          sec.querySelector('.sp-rail')?.remove();
          for (const a of sec.querySelectorAll('.sp-arrow')) a.remove();
        }
        return sec;
      },

      /* the collections you fill from any card's menu ("Games With Friends"…),
         newest additions first; only the games Play can open are shown here,
         everything else stays in the Library */
      collections: () => {
        const rows = [];
        for (const col of collections.list()) {
          const items = col.items.map(collectionItem).filter(Boolean);
          if (!items.length) continue;
          const latest = Math.max(...col.items.map(x => x.at || 0));
          const others = col.items.length - items.length;
          rows.push({ col, items, latest, others });
        }
        rows.sort((a, b) => b.latest - a.latest);
        const secs = rows.slice(0, 2).map(({ col, items, others }) => shelf({
          id: `col-${col.id}`, title: col.name, icon: col.icon, size: 'sm', items,
          sub: `Your collection · ${plural(items.length, 'game')}${others ? ` here, ${others} more in the Library` : ''}`,
          more: { label: 'Open in Library', onClick: () => openOr('aether-library', { url: `static://library/collections/${encodeURIComponent(col.id)}` }, 'Static Library') },
        })).filter(Boolean);
        return secs.length ? h('div.sp-cols', secs) : null;
      },

      because: () => {
        const last = recentItems(20).find(x => x.kind === 'web' && !isHidden(x));
        if (!last) return null;
        const played = playedWebIds();
        const items = catalogue.related(last.g, ROW + 8).filter(g => !played.has(g.id)).slice(0, ROW)
          .map(g => webItem(g, { why: sharedWith(g, last.g) }));
        return shelf({ id: 'because', title: `Because you played ${last.title}`, icon: 'sparkles', size: 'md', items,
          sub: 'Games that share its categories and tags — ones you haven’t played yet.' });
      },

      trending: () => {
        const week = [...QP.weekCounts().entries()].filter(([id]) => !thumbs.isHidden('web', id))
          .sort((a, b) => b[1] - a[1]).slice(0, 10);
        const items = week.map(([id, n]) => ({ g: catalogue.byId(id), n })).filter(x => x.g)
          .map((x, k) => webItem(x.g, { why: `${plural(x.n, 'play')} this week`, o: { rank: k + 1, whyIcon: 'trending-up' } }));
        return shelf({ id: 'trending', title: 'Trending on this device', icon: 'trending-up', size: 'md', items,
          sub: 'Your most-launched games over the past 7 days, counted on this device only.' });
      },

      /* Oct 24 – Nov 1 only (core/season.js): the spooky Arcade games, then the
         catalogue's Horror shelf. Outside the season it is not built at all. */
      halloween: () => {
        if (!inHalloween()) return null;
        const spooky = ARCADE.filter(a => a.tags.includes('spooky'))
          .map(a => arcItem(a, { why: a.blurb, o: { whyIcon: 'zap' } }));
        const res = S.ready ? catalogue.query({ category: 'horror', sort: 'catalogue', perPage: ROW + 8 }) : { items: [], total: 0 };
        const web = res.items.map(g => webItem(g, { o: { meta: webMeta(g, 'horror') } }));
        const parts = [`${spooky.length} spooky Arcade game${spooky.length === 1 ? '' : 's'} built into StaticOS`];
        if (res.total) parts.push(`${plural(res.total, 'game')} from the catalogue’s Horror category`);
        return shelf({ id: 'halloween', title: 'Halloween', icon: 'pumpkin', size: 'md', cls: 'sp-sec--halloween',
          items: [...spooky, ...web],
          sub: `Here until November 1 · ${parts.join(' and ')}.`,
          more: api.getApp('pumpkin') ? { label: 'Carve a pumpkin', onClick: () => openOr('pumpkin', {}, 'Pumpkin Carver') }
            : res.total > web.length ? { label: 'All horror', onClick: () => browseCat('horror') } : null });
      },

      arcade: () => shelf({ id: 'arcade', title: 'Static Arcade', icon: 'zap', size: 'md',
        items: ARCADE.map(a => arcItem(a, { why: a.blurb, o: { whyIcon: 'play' } })),
        sub: 'Built into StaticOS — instant, no download.', more: { label: 'All Arcade', onClick: () => setTab('arcade') } }),

      creations: () => {
        const ps = sortedProjects();
        if (!ps.length) return null;
        return shelf({ id: 'creations', title: 'Your Creations', icon: 'sparkles', size: 'md',
          items: ps.slice(0, ROW).map(p => creItem(p)), sub: 'Games you made in Static Forge.',
          more: { label: 'Creations', onClick: () => setTab('creations') } });
      },

      featured: () => {
        const items = featuredGames().map(g => webItem(g));
        return shelf({ id: 'featured', title: 'Featured', icon: 'star', size: 'lg', items, lazy: true,
          sub: 'Hand-picked from the catalogue.' });
      },

      popular: () => {
        const rows = measuredRows().sort((a, b) => b.plays - a.plays).slice(0, ROW);
        return shelf({ id: 'popular', title: 'Popular', icon: 'flame', size: 'md', lazy: true,
          items: rows.map(g => webItem(g, { why: `${g.plays.toLocaleString()} plays, as reported by ${g.studio}` })),
          sub: 'Most plays, as reported by each game’s publisher.' });
      },

      gems: () => {
        const G = gemRule(playedWebIds());
        const items = shuffle(G.pool).slice(0, ROW).map(g => webItem(g, { why: G.why(g), o: { whyIcon: 'diamond' } }));
        return shelf({ id: 'gems', title: 'Hidden Gems', icon: 'diamond', size: 'md', items, lazy: true,
          sub: `The rule: ${G.rule}. ${plural(G.pool.length, 'game')} fit${G.pool.length > items.length ? `; these ${items.length} are a random draw` : ''}.` });
      },
    };
    CAT_ROWS.forEach((c, k) => {
      HOME[`cat:${c}`] = () => {
        const res = catalogue.query({ category: c, sort: 'catalogue', perPage: k % 2 ? 18 : ROW });
        return shelf({ id: `cat-${c}`, title: catName(c), icon: catIcon(c), lazy: true,
          size: 'sm', layout: k % 2 ? 'compact' : 'rail',
          items: res.items.map(g => webItem(g, { o: { meta: webMeta(g, c) } })), sub: plural(res.total, 'game'),
          more: { label: 'Browse all', onClick: () => browseCat(c) } });
      };
    });
    const HOME_ORDER = ['hero', 'continue', 'halloween', 'quick', 'favorites', 'thumbs', 'collections', 'because', 'trending', 'arcade', 'creations', 'featured', 'popular', 'gems', ...CAT_ROWS.map(c => `cat:${c}`), 'hidden'];

    function buildHome() {
      slots.clear();
      const out = [];
      for (const id of HOME_ORDER) {
        const slot = h('div.sp-slot', { dataset: { slot: id } });
        slots.set(id, slot);
        fillSlot(id);
        out.push(slot);
      }
      out.push(aboutNote());
      return out;
    }
    function fillSlot(id) {
      const slot = slots.get(id);
      if (!slot) return;
      /* a rebuild under the keyboard (un-favouriting inside Your Favorites,
         taking a game out of a collection row) must not drop focus */
      const ae = document.activeElement;
      const had = ae && slot.contains(ae)
        ? { kind: ae.dataset?.kind, id: ae.dataset?.id, idx: [...slot.querySelectorAll('.sp-go')].indexOf(ae) } : null;
      let node = null;
      try { node = (S.ready || id === 'hero' || id === 'quick' || id === 'arcade' || id === 'creations' || id === 'halloween') ? HOME[id]() : (id === 'continue' ? skeletonRow('xl') : null); }
      catch (err) { console.error('[play] section', id, err); node = null; }
      for (const old of slot.children) old._dispose?.();
      api.render(slot, node);
      slot.hidden = !node;
      if (had) refocus(slot, had);
    }

    /** the same game again, else its neighbour, else the nearest row that has games */
    function refocus(slot, had) {
      const gos = [...slot.querySelectorAll('.sp-go')];
      let to = (had.id && gos.find(g => g.dataset.id === had.id && g.dataset.kind === had.kind))
        || gos[Math.min(Math.max(had.idx, 0), gos.length - 1)] || null;
      if (!to) {
        const all = [...slots.values()];
        const i = all.indexOf(slot);
        for (const s of [...all.slice(i + 1), ...all.slice(0, Math.max(0, i)).reverse()]) {
          if (s.hidden) continue;
          to = s.querySelector('.sp-go');
          if (to) break;
        }
      }
      if (to) focusGo(to); else main.focus({ preventScroll: true });
    }
    const skeletonRow = size => h('section.sp-sec', { 'aria-hidden': 'true' },
      h('div.sp-sec__h', h('div.sp-skel.sp-skel--line')),
      h(`div.sp-rail.sp-rail--rail.sp-rail--${size}`, Array.from({ length: 4 }, () => h(`div.sp-skel.sp-skel--${size}`))));

    function aboutNote() {
      const measuredAny = S.ready && measuredRows().length > 0;
      return h('aside.sp-about',
        icon('info'),
        h('div',
          h('b', { text: 'How this page is built' }),
          h('p', { text: 'Everything here comes from this device’s own history, the Static Arcade and the games catalogue. Nothing is shown about other players — StaticOS has no server to know about them.' }),
          measuredAny ? null : h('p', { text: 'Play counts and ratings are left out on purpose: the catalogue’s numbers are placeholders, not measurements, so there is no Popular row until real ones exist, and Hidden Gems uses a rule that needs no ratings. There’s no “New” row either — the catalogue has no release dates.' }),
          h('p', { text: 'Thumbs-up and thumbs-down are yours alone, kept on this device: they shape your shelves here and are never shown to, or counted for, anyone else.' }),
          h('p.sp-about__keys', { text: 'Keyboard: arrows move between games · Enter plays · F favorites · U thumbs-up · D thumbs-down (hides it) · I details · M more (Add to Desktop, collections) · / search. On touch, press and hold a game for the same menu.' })));
    }

    /** rebuild some Home sections in place (after a play, a favourite, a project change) */
    const dirty = new Set();
    function refresh(...ids) {
      for (const id of ids) dirty.add(id);
      frame(() => {
        if (!alive) { dirty.clear(); return; }
        if (S.tab === 'home' && !S.q) {
          for (const id of dirty) if (slots.has(id)) fillSlot(id);
          frame(checkLazy, 'lazy');
        }
        dirty.clear();
      }, 'refresh');
    }

    /**
     * A game just got a thumbs-down: take its cards off the page where they
     * are. Rows keep their scroll position, an emptied row goes, the hero
     * moves on, the gem spotlight rolls again, and a focused card hands the
     * keyboard to its neighbour.
     */
    function dropFromView(key) {
      const i = key.indexOf(':');
      const kind = key.slice(0, i), id = key.slice(i + 1);
      let next = null;
      const hadFocus = view.contains(document.activeElement);
      for (const go of [...view.querySelectorAll(`.sp-go[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`)]) {
        if (!go.isConnected || go.closest('[data-sec="hidden"]')) continue;
        if (go.closest('.sp-hero')) { refresh('hero'); continue; }
        const gem = go.closest('.sp-gem');
        if (gem) {
          const again = gemSpot(Math.random, playedWebIds(), id);
          if (again) gem.replaceWith(again); else gem.remove();
          if (hadFocus && !next) next = again?.querySelector('.sp-go') || null;
          continue;
        }
        const host = go.closest('.sp-card, .sp-tile, .sp-atile');
        if (!host) continue;
        const box = host.parentElement;
        const lost = host.contains(document.activeElement);
        if (lost) {
          const gos = [...box.querySelectorAll('.sp-go')];
          const k = gos.indexOf(go);
          next = gos[k + 1] || gos[k - 1] || null;
        }
        host.remove();
        if (box.querySelector('.sp-go')) { rove(box); box._upd?.(); } else {
          const sec = box.closest('.sp-sec');
          if (!sec) continue;
          /* the row emptied under the keyboard: carry on in the next row down */
          if (lost && !next) {
            next = [...view.querySelectorAll('.sp-go')]
              .find(g => !sec.contains(g) && (sec.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)) || null;
          }
          dropSection(sec);
        }
      }
      if (next && next.isConnected) focusGo(next);
      else if (hadFocus && !view.contains(document.activeElement)) main.focus({ preventScroll: true });
    }

    /** build the current view again where it stands: scroll and (when it can) the focused game kept */
    function rebuild() {
      const y = main.scrollTop;
      const ae = document.activeElement;
      const had = ae && view.contains(ae) && ae.classList.contains('sp-go') ? { kind: ae.dataset.kind, id: ae.dataset.id, sec: ae.closest('[data-sec]')?.dataset.sec } : null;
      render();
      main.scrollTop = y;
      frame(checkLazy, 'lazy');
      if (had) {
        /* the same game in the same row, else that row's next game; a game
           just brought back from "Hidden by you" leaves the keyboard there */
        const sel = `.sp-go[data-kind="${had.kind}"][data-id="${CSS.escape(had.id || '')}"]`;
        const sec = had.sec ? view.querySelector(`[data-sec="${CSS.escape(had.sec)}"]`) : null;
        const to = (sec && (sec.querySelector(sel) || sec.querySelector('.sp-go, .sp-hidden__toggle')))
          || (had.sec !== 'hidden' ? view.querySelector(sel) : null);
        if (to) to.focus({ preventScroll: true });
      }
    }

    /* ---------------------------------------------------------------- *
     *  Discover
     * ---------------------------------------------------------------- */
    function buildDiscover() {
      const rng = Math.random;
      const played = playedWebIds();
      const recent = recentItems(40);
      const webRecent = recent.filter(x => x.kind === 'web' && !isHidden(x));
      const out = [h('div.sp-page-h',
        h('div', h('h1', { text: 'Discover' }),
          h('p', { text: 'Different every visit. Every pick says why it’s here.' })),
        h('button.sp-btn.sp-shuffle', { type: 'button', 'aria-label': 'Shuffle: pick new games for every row',
          onclick: e => {
            const had = document.activeElement === e.currentTarget;
            render();
            if (had) view.querySelector('.sp-shuffle')?.focus({ preventScroll: true });
          } }, icon('shuffle'), 'Shuffle'))];

      /* Because You Played X — a random one of your last five */
      if (webRecent.length) {
        const src = webRecent[Math.floor(rng() * Math.min(5, webRecent.length))];
        const items = shuffle(catalogue.related(src.g, 30).filter(g => !played.has(g.id)), rng).slice(0, 12)
          .map(g => webItem(g, { why: sharedWith(g, src.g) }));
        const n = Math.min(5, webRecent.length);
        const when = src.at ? QP.ago(src.at) : '';
        const lead = n === 1 ? (when ? `You played it ${when}.` : '')
          : `Picked at random from your last ${n} games${when ? ` — you played this one ${when}` : ''}.`;
        out.push(shelf({ title: `Because you played ${src.title}`, icon: 'sparkles', size: 'md', items,
          sub: `${lead} These share its categories or tags, and you haven’t played them yet.`.trim() }));
      }

      /* You Might Like — categories weighted by your history */
      const pc = playedCats();
      const favCats = new Map();
      for (const g of catalogue.byIds(QP.favIds())) for (const c of g.cats) if (c !== 'featured') favCats.set(c, (favCats.get(c) || 0) + 1);
      const weights = new Map();
      for (const [c, n] of pc) weights.set(c, (weights.get(c) || 0) + n * 2);
      for (const [c, n] of favCats) weights.set(c, (weights.get(c) || 0) + n);
      if (weights.size) {
        const chosen = [];
        const bag = [...weights.entries()].filter(([c]) => catalogue.counts().get(c));
        while (chosen.length < 3 && bag.length) {
          const total = bag.reduce((s, [, w]) => s + w, 0);
          let r = rng() * total;
          const k = bag.findIndex(([, w]) => (r -= w) <= 0);
          chosen.push(bag.splice(k < 0 ? 0 : k, 1)[0][0]);
        }
        const items = [];
        for (const c of chosen) {
          const why = pc.get(c) ? `You’ve played ${plural(pc.get(c), `${catName(c)} game`)}` : `${plural(favCats.get(c), 'favorite')} ${favCats.get(c) === 1 ? 'is' : 'are'} ${catName(c)}`;
          const pool = catalogue.query({ category: c, sort: 'catalogue', perPage: 300 }).items.filter(g => !played.has(g.id));
          for (const g of shuffle(pool, rng).slice(0, 5)) items.push(webItem(g, { why, o: { meta: webMeta(g, c) } }));
        }
        out.push(shelf({ title: 'You Might Like', icon: 'heart', size: 'md', items: shuffle(items, rng),
          sub: 'From the categories you play and save most.' }));
      } else {
        out.push(h('aside.sp-note', icon('compass'), h('div', h('b', { text: 'Discover learns from what you play' }),
          h('p', { text: 'Play or favorite a few games and this page starts leaning toward what you like. Until then: quick picks, a random gem and something different.' }))));
      }

      /* Picks for 5 Minutes */
      const quickArc = ARCADE.filter(a => a.minutes <= 2).map(a => arcItem(a, { why: `Rounds take about ${a.minutes} min`, o: { meta: a.blurb, whyIcon: 'clock' } }));
      const quickWeb = shuffle([
        ...catalogue.query({ tag: 'hypercasual', perPage: 200, sort: 'catalogue' }).items,
        ...catalogue.query({ tag: 'clicker', perPage: 120, sort: 'catalogue' }).items,
      ].filter((g, k, a) => a.findIndex(x => x.id === g.id) === k), rng).slice(0, 10)
        .map(g => webItem(g, { why: `Tagged ${g.tags.find(t => /^(hypercasual|clicker)$/i.test(t)).toLowerCase()} by its publisher` }));
      out.push(shelf({ title: 'Picks for 5 Minutes', icon: 'clock', size: 'sm', items: [...quickArc, ...quickWeb],
        sub: 'Arcade games with rounds of 2 minutes or less, and games their publishers tag hypercasual or clicker.' }));

      /* Random Hidden Gem */
      out.push(gemSpot(rng, played));

      /* Something Different */
      const allCats = catalogue.categories().map(c => c.id).filter(c => c !== 'featured');
      const never = allCats.filter(c => !pc.has(c));
      let diff, why;
      if (never.length) {
        diff = never[Math.floor(rng() * never.length)];
        why = `You haven’t played any ${catName(diff)} games here yet`;
      } else {
        diff = [...pc.entries()].sort((a, b) => a[1] - b[1])[0][0];
        why = `${catName(diff)} is the category you’ve played least`;
      }
      const dPool = catalogue.query({ category: diff, sort: 'catalogue', perPage: 200 }).items.filter(g => !played.has(g.id));
      const cardWhy = never.length ? `${catName(diff)} — new to you` : `${catName(diff)} — your least-played`;
      const dItems = [...dPool.filter(g => g.curated), ...shuffle(dPool.filter(g => !g.curated), rng)].slice(0, 12)
        .map(g => webItem(g, { why: cardWhy, o: { meta: webMeta(g, diff), whyIcon: 'compass' } }));
      out.push(shelf({ title: `Something Different: ${catName(diff)}`, icon: catIcon(diff), size: 'md', items: dItems,
        sub: why + '.', more: { label: 'Browse all', onClick: () => browseCat(diff) } }));
      return out;
    }

    function gemSpot(rng, played, notId = null) {
      const G = gemRule(played);
      /* "Roll again" never lands on the gem already showing */
      const pool = G.pool.length > 1 ? G.pool.filter(x => x.id !== notId) : G.pool;
      const g = pool[Math.floor(rng() * pool.length)] || null;
      if (!g) return null;
      const why = G.why(g);
      const rule = `Picked at random from the ${plural(G.pool.length, 'game')} that fit the Hidden Gems rule: ${G.rule}.`;
      const it = webItem(g);
      const node = h('section.sp-sec.sp-gem', { 'aria-labelledby': 'sp-gem-h' },
        h('div.sp-sec__h', h('div.sp-sec__tt',
          h('h2.sp-sec__title', { id: 'sp-gem-h' }, icon('diamond'), h('span', { text: 'Random Hidden Gem' })),
          h('p.sp-sec__sub', { text: rule })),
          h('div.sp-sec__tools', h('button.sp-more', { type: 'button', 'aria-label': 'Roll again: show another random hidden gem',
            onclick: e => {
              const next = gemSpot(Math.random, played, g.id);
              if (!next) return;
              const hadFocus = document.activeElement === e.currentTarget;
              node.replaceWith(next);
              /* the button just pressed is gone: keep the keyboard where it was */
              if (hadFocus) next.querySelector('.sp-sec__tools .sp-more')?.focus({ preventScroll: true });
            } }, icon('shuffle'), h('span', { text: 'Roll again' })))),
        h('div.sp-gem__card', { dataset: { nav: 'row' } },
          artNode(it, { big: true }),
          h('div.sp-gem__b',
            h('div.sp-eyebrow', icon('diamond'), h('span', { text: why })),
            h('h3', { text: it.title }),
            h('div.sp-hero__meta', studioOf(g) ? h('span', { text: studioOf(g) }) : null,
              ...g.cats.filter(c => c !== 'featured').slice(0, 3).map(c => h('span.sp-chip', icon(catIcon(c)), catName(c)))),
            g.desc ? h('p', { text: QP.cleanText(g.desc) }) : null,
            h('div.sp-gem__why', icon('keyboard'), h('span', { text: controlsOf(g) })),
            h('div.sp-hero__acts',
              h('button.sp-btn.sp-btn--play.sp-go', { type: 'button', dataset: { kind: 'web', id: g.id }, 'aria-label': `Play ${it.title}. ${why}`,
                'aria-keyshortcuts': 'F U D I M Shift+F10',
                onclick: () => play(it),
                on: { 'sp:fav': () => toggleFav(g.id), 'sp:info': () => details(it) } }, icon('play', { fill: true }), 'Play'),
              h('button.sp-btn', { type: 'button', onclick: () => details(it) }, icon('info'), 'Details'),
              (() => { const b = h('button.sp-btn.sp-btn--icon.sp-fav', { type: 'button', dataset: { favId: g.id }, onclick: () => toggleFav(g.id) }); paintFav(b, isFav(g.id), it.title); return b; })(),
              ...thumbPair(it, '.sp-btn.sp-btn--icon'),
              moreBtn(it, '.sp-btn.sp-btn--icon', true)))));
      bindItem(node.querySelector('.sp-gem__card'), it);
      return node;
    }

    /* ---------------------------------------------------------------- *
     *  Multiplayer
     * ---------------------------------------------------------------- */
    function buildMulti() {
      const out = [];
      out.push(h('div.sp-mp__hero',
        h('div.sp-mp__glyph', icon('gamepad'), icon('gamepad')),
        h('div', h('h1', { text: 'Play together' }),
          h('p', { text: 'Two players on one device, and online games that run on their publisher’s own servers.' }))));

      out.push(h('aside.sp-note.sp-note--server', { role: 'note' },
        icon('users'),
        h('div',
          h('b', { text: 'No parties, lobbies or friends lists here' }),
          h('p', { text: NO_SERVER }),
          h('p', { text: 'What does work: the local games below really take two players on one device, and online games connect to their publisher’s servers on their own.' }))));

      /* local: the Arcade games that truly take two */
      const local = ARCADE.filter(a => a.players.includes(2) && !thumbs.isHidden('arcade', a.id));
      if (local.length) {
        out.push(h('section.sp-sec', { 'aria-labelledby': 'sp-mp-local' },
          h('div.sp-sec__h', h('div.sp-sec__tt',
            h('h2.sp-sec__title', { id: 'sp-mp-local' }, icon('users'), h('span', { text: 'Local multiplayer on one device' })),
            h('p.sp-sec__sub', { text: 'Static Arcade games built for two. They run on this device, so they really work.' }))),
          h('div.sp-agrid.sp-agrid--mp', { role: 'list', dataset: { nav: 'grid' } }, local.map(a => arcadeTile(a, { two: true })))));
      }

      const seen = new Set();
      const uniq = g => (seen.has(g.id) ? false : (seen.add(g.id), true));
      const two = [
        ...catalogue.query({ category: '2player', sort: 'catalogue', perPage: 60 }).items,
        ...catalogue.query({ tag: '2 player', sort: 'catalogue', perPage: 40 }).items,
      ].filter(uniq).slice(0, 24);
      out.push(shelf({ title: '2 Player', icon: 'users', size: 'md',
        items: two.map(g => webItem(g, { why: controlsOf(g), o: { whyIcon: 'keyboard', muted: !/^Controls:/.test(controlsOf(g)) } })),
        sub: 'Marked 2-player by their publishers. Controls are shown only when the publisher lists them.',
        more: { label: 'Browse all', onClick: () => browseCat('2player') } }));

      const io = catalogue.query({ category: 'io', sort: 'catalogue', perPage: 24 }).items;
      out.push(shelf({ title: 'Online games', icon: 'globe', size: 'md',
        items: io.map(g => webItem(g, { why: controlsOf(g), o: { whyIcon: 'keyboard', muted: !/^Controls:/.test(controlsOf(g)) } })), sub: IO_NOTE,
        more: { label: 'Browse all', onClick: () => browseCat('io') } }));

      const party = catalogue.all().filter(g => g.tags.some(t => /\bparty\b/i.test(t))).slice(0, 24);
      out.push(shelf({ title: 'Party Games', icon: 'sparkles', size: 'md',
        items: party.map(g => webItem(g, { why: controlsOf(g), o: { whyIcon: 'keyboard', muted: !/^Controls:/.test(controlsOf(g)) } })), sub: 'Tagged “party” by their publishers.' }));
      return out;
    }

    /* ---------------------------------------------------------------- *
     *  Arcade
     * ---------------------------------------------------------------- */
    function arcadeTile(a, o = {}) {
      const it = arcItem(a);
      const chips = [
        h('span.sp-chip', icon('clock'), `~${a.minutes} min`),
        h('span.sp-chip', icon('users'), playersText(a)),
        ...a.input.map(x => h('span.sp-chip', { text: INPUT_LABEL[x] || x })),
      ];
      const two = a.players.includes(2);
      const primaryTwo = o.two && two;
      return bindItem(h('div.sp-atile', { role: 'listitem', style: { '--hue': a.hue } },
        h('div.sp-atile__art', h('span.sp-art__glyph', icon(a.icon)),
          h('div.sp-thumbs', { role: 'group', 'aria-label': `Your thumbs for ${a.title}` }, thumbPair(it, '.sp-thumb--tab'))),
        h('div.sp-atile__b',
          h('h3', { text: a.title }),
          h('p', { text: a.blurb }),
          h('div.sp-atile__chips', chips),
          h('div.sp-atile__acts',
            h('button.sp-btn.sp-btn--play.sp-go', { type: 'button', dataset: { kind: 'arcade', id: a.id },
              'aria-label': primaryTwo ? `Play ${a.title} with a friend, 2 players` : `Play ${a.title}`, 'aria-keyshortcuts': 'U D M Shift+F10',
              onclick: () => play(it, primaryTwo ? { players: 2 } : {}) },
            icon(primaryTwo ? 'users' : 'play', { fill: !primaryTwo }), primaryTwo ? 'Play with a friend' : 'Play'),
            two && !primaryTwo ? h('button.sp-btn', { type: 'button', 'aria-label': `Play ${a.title} with 2 players`,
              onclick: () => play(it, { players: 2 }) }, icon('users'), '2 players') : null,
            primaryTwo ? h('button.sp-btn', { type: 'button', 'aria-label': `Play ${a.title} alone`,
              onclick: () => play(it) }, 'Solo') : null,
            moreBtn(it, '.sp-btn.sp-btn--icon.sp-atile__more', true)))), it);
    }

    let arcFilter = 'all';
    function buildArcade() {
      const FILTERS = [
        { id: 'all', l: 'All', f: () => true },
        { id: 'quick', l: '2 min or less', f: a => a.minutes <= 2 },
        { id: 'two', l: '2 players', f: a => a.players.includes(2) },
        { id: 'classic', l: 'Classic', f: a => a.tags.includes('classic') },
        { id: 'skill', l: 'Skill', f: a => a.tags.includes('skill') },
        { id: 'puzzle', l: 'Puzzle', f: a => a.tags.includes('puzzle') || a.tags.includes('memory') },
      ];
      const grid = h('div.sp-agrid', { role: 'list', 'aria-label': 'Static Arcade games', dataset: { nav: 'grid' } });
      const pills = FILTERS.map(f => h('button.sp-pill', { type: 'button', dataset: { f: f.id },
        onclick: () => { arcFilter = f.id; paint(); } }, f.l));
      const paint = () => {
        const f = FILTERS.find(x => x.id === arcFilter) || FILTERS[0];
        pills.forEach(p => { const on = p.dataset.f === f.id; p.classList.toggle('is-on', on); p.setAttribute('aria-pressed', String(on)); });
        api.render(grid, ARCADE.filter(f.f).filter(a => !thumbs.isHidden('arcade', a.id)).map(a => arcadeTile(a)));
        rove(grid);
      };
      paint();
      /* the Arcade games you gave a thumbs-down are not in the grid; say so */
      const hiddenArc = ARCADE.filter(a => thumbs.isHidden('arcade', a.id)).length;
      const hidNote = hiddenArc ? h('div.sp-hidnote', { role: 'note' }, icon('eye-off'),
        h('span', { text: `${plural(hiddenArc, 'Arcade game')} you hid ${hiddenArc === 1 ? 'is' : 'are'} left out.` }),
        h('button.sp-more', { type: 'button', onclick: () => {
          S.hiddenOpen = true;
          setTab('home');
          frame(() => {
            const sec = slots.get('hidden');
            if (!sec || sec.hidden) return;
            sec.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
            sec.querySelector('.sp-hidden__toggle')?.focus({ preventScroll: true });
          });
        } }, h('span', { text: 'See hidden games' }), icon('chevron-right'))) : null;
      return [
        h('div.sp-page-h.sp-page-h--arcade',
          h('div', h('h1', { text: 'Static Arcade' }),
            h('p', { text: `${ARCADE.length} games built into StaticOS. They start instantly — no downloads, no ads, nothing fetched from the internet.` })),
          h('button.sp-btn', { type: 'button', onclick: () => openOr('arcade', {}, 'Static Arcade') }, icon('external-link'), 'Open Arcade')),
        h('div.sp-filters', { role: 'group', 'aria-label': 'Filter Arcade games' }, pills),
        hidNote,
        grid,
      ];
    }

    /* ---------------------------------------------------------------- *
     *  Creations
     * ---------------------------------------------------------------- */
    function sortedProjects() {
      const ps = arr(S.projects);
      return [...ps.filter(p => p.published).sort((a, b) => (b.published.at || 0) - (a.published.at || 0)),
        ...ps.filter(p => !p.published).sort((a, b) => b.updatedAt - a.updatedAt)];
    }

    function makeBar(quiet) {
      const input = h('input.sp-make__in', { type: 'text', placeholder: 'Describe a game, e.g. “a space dodger with power-ups”', maxlength: '300',
        'aria-label': 'Describe a game for Static Forge to make' });
      const go = () => {
        const prompt = input.value.trim();
        openOr('forge', prompt ? { prompt } : {}, 'Static Forge');
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      return h('div.sp-make', icon('sparkles'), input,
        h(quiet ? 'button.sp-btn' : 'button.sp-btn.sp-btn--play', { type: 'button', onclick: go }, icon('sparkles'), 'Make it'));
    }

    function buildCreations() {
      const head = h('div.sp-page-h',
        h('div', h('h1', { text: 'Creations' }), h('p', { text: 'Games you made in Static Forge, on this device.' })),
        h('button.sp-btn', { type: 'button', onclick: () => openOr('forge', {}, 'Static Forge') }, icon('external-link'), 'Open Static Forge'));
      if (S.projects === null) return [head, makeBar(), h('div.sp-agrid', Array.from({ length: 3 }, () => h('div.sp-skel.sp-skel--md')))];
      const ps = sortedProjects();
      if (!ps.length) {
        return [head, h('div.sp-empty',
          h('span.sp-empty__icon', icon('sparkles')),
          h('h2', { text: 'You haven’t made a game yet' }),
          h('p', { text: 'Describe one in a sentence and Static Forge builds it. Everything you make shows up here, ready to play.' }),
          makeBar(true),
          h('button.sp-btn.sp-btn--play.sp-btn--lg', { type: 'button', onclick: () => openOr('forge', {}, 'Static Forge') }, icon('sparkles'), 'Make a game in Static Forge'))];
      }
      const pub = ps.filter(p => p.published);
      const drafts = ps.filter(p => !p.published);
      const meta = p => {
        const bits = [p.published ? `Published ${QP.ago(p.published.at)}` : `Edited ${QP.ago(p.updatedAt)}`, plural(arr(p.versions).length, 'version')];
        if (p.remixCredit) bits.push(`remix of ${p.remixCredit.name}`);
        return bits.join(' · ');
      };
      return [head, makeBar(),
        shelf({ title: 'Published', icon: 'upload', size: 'md', layout: 'grid',
          items: pub.map(p => creItem(p, { o: { meta: meta(p), why: p.published.description ? p.published.description.slice(0, 90) : '' } })),
          sub: 'In your Workshop — listed on this device only. Nothing is uploaded, so nobody else can see them.' }),
        shelf({ title: 'Drafts', icon: 'edit-3', size: 'md', layout: 'grid',
          items: drafts.map(p => creItem(p, { o: { meta: meta(p), why: p.prompt ? `“${p.prompt.slice(0, 80)}”` : '' } })),
          sub: 'Open one in Static Forge to keep working on it.' })];
    }

    /* ---------------------------------------------------------------- *
     *  Search
     * ---------------------------------------------------------------- */
    /* your creations get the same forgiving search, one small index per project list */
    let mineIx = null;
    const mineIndex = () => {
      const ps = arr(S.projects);
      if (!mineIx || mineIx.rows !== ps) {
        mineIx = createIndex(ps, { title: p => (p.published && p.published.title) || p.name || '',
          hay: p => `${p.name} ${p.prompt || ''} ${p.published?.title || ''}`.toLowerCase() });
      }
      return mineIx;
    };

    function buildSearch() {
      const q = S.q.trim();
      const t0 = performance.now();
      const web = catalogue.search(q);
      const arc = arcadeIndex().search(q);
      const mine = mineIndex().search(q);
      const ms = performance.now() - t0;

      /* games you gave a thumbs-down stay out of the results unless asked for */
      const hid = thumbs.hiddenKeys();
      const keep = kind => x => S.showHidden || !hid.has(`${kind}:${x.row.id}`);
      const webHits = web.hits.filter(keep('web'));
      const arcHits = arc.hits.filter(keep('arcade'));
      const hiddenN = S.showHidden ? 0 : (web.hits.length - webHits.length) + (arc.hits.length - arcHits.length);
      const hiddenShown = S.showHidden ? web.hits.filter(x => hid.has(`web:${x.row.id}`)).length + arc.hits.filter(x => hid.has(`arcade:${x.row.id}`)).length : 0;
      const total = webHits.length + arcHits.length + mine.hits.length;

      /* nothing matched the words as typed: everything shown is a close spelling */
      const asTyped = web.title + web.hay + arc.title + arc.hay + mine.title + mine.hay;
      const closeOnly = total > 0 && asTyped === 0;
      const suggestion = !web.title && !arc.title && !mine.title ? (web.suggestion || arc.suggestion || mine.suggestion) : null;
      const where = [webHits.length ? 'the catalogue' : null, arcHits.length ? 'the Arcade' : null, mine.hits.length ? 'your creations' : null].filter(Boolean);
      const whereText = where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where[where.length - 1]}` : where[0] || 'the catalogue';
      const line = !total ? 'No matches.'
        : closeOnly ? `Nothing matches “${q}” as typed — ${plural(total, 'close spelling')} from ${whereText}, closest first.`
          : `${total.toLocaleString()} ${total === 1 ? 'match' : 'matches'} across ${whereText}.`;

      const tryIt = text => { searchIn.value = text; onSearch(true); };
      const out = [h('div.sp-page-h', { dataset: { ms: ms.toFixed(2) } },
        h('div', h('h1', { text: `Results for “${q}”` }),
          h('p', { text: line }),
          suggestion ? h('p.sp-dym', icon('sparkles'), h('span', { text: 'Did you mean ' }),
            h('button.sp-dym__go', { type: 'button', 'aria-label': `Search for ${suggestion} instead`, onclick: () => tryIt(suggestion) }, suggestion),
            h('span', { text: '?' })) : null),
        h('button.sp-btn', { type: 'button', onclick: () => { searchIn.value = ''; onSearch(true); searchIn.focus(); } }, icon('x'), 'Clear search'))];

      const showHiddenNow = on => { S.showHidden = on; rebuild(); };
      if (hiddenN || hiddenShown) {
        out.push(h('div.sp-hidnote', { role: 'note' }, icon('eye-off'),
          h('span', { text: hiddenN ? `${plural(hiddenN, 'game')} you hid ${hiddenN === 1 ? 'matches' : 'match'} this search.` : `Showing ${plural(hiddenShown, 'game')} you hid, too.` }),
          h('button.sp-more', { type: 'button', onclick: () => showHiddenNow(!!hiddenN) }, h('span', { text: hiddenN ? (hiddenN === 1 ? 'Show it' : 'Show them') : 'Leave them out' }))));
      }
      if (!total) {
        out.push(h('div.sp-empty',
          h('span.sp-empty__icon', icon(hiddenN ? 'eye-off' : 'search')),
          h('h2', { text: hiddenN ? `Only games you hid match “${q}”` : `Nothing matches “${q}”` }),
          h('p', { text: hiddenN ? 'You gave them a thumbs-down, so they’re left out. Show them to bring one back.' : 'Try a shorter word, a category like racing or puzzle — or let Quick Play choose.' }),
          hiddenN ? h('button.sp-btn', { type: 'button', onclick: () => showHiddenNow(true) }, icon('eye'), hiddenN === 1 ? 'Show it' : 'Show them') : null,
          h('button.sp-btn.sp-btn--play', { type: 'button', onclick: () => quickPlay() }, icon('zap', { fill: true }), 'Quick Play')));
        return out;
      }
      /* a close spelling listed after real matches says so */
      const close = (x, exactToo) => (x.tier === FUZZY && exactToo ? { why: 'Close spelling of what you typed', o: { whyIcon: 'search' } } : undefined);
      out.push(shelf({ title: 'Static Arcade', icon: 'zap', size: 'md', layout: 'grid', showHidden: S.showHidden,
        items: arcHits.map(x => arcItem(x.row, close(x, arc.title + arc.hay) || { why: x.row.blurb })) }));
      out.push(shelf({ title: 'Your creations', icon: 'sparkles', size: 'md', layout: 'grid',
        items: mine.hits.map(x => creItem(x.row, close(x, mine.title + mine.hay))) }));
      const page = webHits.slice(0, 36 * S.searchPage);
      const webSec = shelf({ id: 'search-web', title: 'Games', icon: 'gamepad', size: 'md', layout: 'grid', showHidden: S.showHidden,
        items: page.map(x => webItem(x.row, close(x, web.title + web.hay))),
        sub: web.title + web.hay ? `${plural(webHits.length, 'game')} in the catalogue` : `${plural(webHits.length, 'game')} in the catalogue with a close spelling` });
      if (webSec) {
        if (webHits.length > page.length) {
          const shown = page.length;
          webSec.append(h('div.sp-moreline', h('button.sp-btn', { type: 'button',
            onclick: e => {
              const had = document.activeElement === e.currentTarget;
              S.searchPage++;
              const y = main.scrollTop;
              render();
              main.scrollTop = y;
              /* the keyboard carries on from the first game that just appeared */
              if (had) focusGo(view.querySelectorAll('[data-sec="search-web"] .sp-go')[shown] || view.querySelector('[data-sec="search-web"] .sp-go'));
            } },
            icon('chevron-down'), `Show more (${(webHits.length - page.length).toLocaleString()} left)`)));
        }
        out.push(webSec);
      }
      return out;
    }

    function onSearch(now) {
      const v = searchIn.value.trim();
      searchClear.hidden = !searchIn.value;
      if (v === S.q && !now) return;
      if (v === S.q && now && !v) { if (S.q === '') return; }
      S.q = v;
      S.searchPage = 1;
      S.showHidden = false;
      render();
      /* new words, new results: read from the top */
      main.scrollTop = 0;
    }

    /* ---------------------------------------------------------------- *
     *  render
     * ---------------------------------------------------------------- */
    function setTab(id) {
      if (S.q) { S.q = ''; searchIn.value = ''; searchClear.hidden = true; }
      S.tab = id;
      render();
      main.scrollTop = 0;
    }

    function render() {
      for (const f of viewOffs.splice(0)) { try { f(); } catch (e) { console.warn('[play] view cleanup', e); } }
      lazy.length = 0;
      slots.clear();
      closePop();
      tabBtns.forEach(b => {
        const on = b.dataset.tab === S.tab && !S.q;
        b.classList.toggle('is-on', b.dataset.tab === S.tab);
        b.setAttribute('aria-selected', String(on));
        b.setAttribute('tabindex', b.dataset.tab === S.tab ? '0' : '-1');
      });
      el.querySelector('.sp-panel')?.setAttribute('aria-labelledby', `sp-tab-${S.tab}`);
      /* on a narrow window the tab strip scrolls: keep the current tab in view */
      const cur = tabBtns.find(b => b.dataset.tab === S.tab);
      if (cur && tabs.scrollWidth > tabs.clientWidth) {
        const l = cur.offsetLeft - tabs.offsetLeft;
        if (l < tabs.scrollLeft || l + cur.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = l - 12;
      }
      el.dataset.tab = S.q ? 'search' : S.tab;

      let nodes;
      try {
        if (S.q) nodes = S.ready ? buildSearch() : [h('div.sp-loading', h('div.spinner'))];
        else if (S.tab === 'home') nodes = buildHome();
        else if (S.tab === 'discover') nodes = S.ready ? buildDiscover() : [h('div.sp-loading', h('div.spinner'))];
        else if (S.tab === 'multiplayer') nodes = S.ready ? buildMulti() : [h('div.sp-loading', h('div.spinner'))];
        else if (S.tab === 'arcade') nodes = buildArcade();
        else nodes = buildCreations();
      } catch (err) {
        console.error('[play] render', err);
        nodes = [h('div.sp-empty', h('span.sp-empty__icon', icon('alert')), h('h2', { text: 'This view hit a snag' }),
          h('p', { text: String(err && err.message || err) }), h('button.sp-btn', { type: 'button', onclick: () => render() }, icon('refresh'), 'Try again'))];
      }
      /* the fallback shelf stays until the page reloads (games.data.js keeps it),
         so say so on every view that draws from the catalogue */
      if (S.ready && catalogue.loadError() && S.tab !== 'arcade' && S.tab !== 'creations') {
        nodes = [h('aside.sp-note.sp-note--warn', { role: 'note' }, icon('alert'), h('div', h('b', { text: 'Showing the built-in shelf' }),
          h('p', { text: 'The full games catalogue didn’t load, so only the hand-picked games are here. Reload StaticOS to try again.' }))), ...arr(nodes)];
      }
      const focusWasInView = view.contains(document.activeElement);
      api.render(view, nodes);
      /* whatever had focus was just replaced: keep the keyboard in Play
         (callers that know a better target move it on from here) */
      if (focusWasInView && !view.contains(document.activeElement)) main.focus({ preventScroll: true });
      el.classList.toggle('sp--still', reduced());
      frame(checkLazy, 'lazy');
      win.setSubtitle(S.q ? 'Search' : TABS.find(t => t.id === S.tab)?.label || '');
    }

    /* ---------------------------------------------------------------- *
     *  live updates
     * ---------------------------------------------------------------- */
    offs.push(api.store.sub(K_FAV, () => {
      const favs = new Set(QP.favIds());
      for (const b of el.querySelectorAll('.sp-fav[data-fav-id]')) paintFav(b, favs.has(b.dataset.favId));
      refresh('favorites');
    }));
    /* your thumbs: repaint the buttons whose game changed; a new thumbs-down
       takes that game off the page where it stands (rows keep their scroll
       and the keyboard moves to its neighbour); a game coming back (Undo,
       or un-hiding it) needs the page built again, in place */
    const thumbSnap = () => {
      const m = new Map();
      const raw = api.store.get(thumbs.KEY, null);
      if (raw && typeof raw === 'object') for (const [k, e] of Object.entries(raw)) if (e && (e.v === 1 || e.v === -1)) m.set(k, e.v);
      return m;
    };
    let thumbsWere = thumbSnap();
    offs.push(thumbs.sub(() => {
      const now = thumbSnap();
      const changed = new Set();
      for (const [k, v] of now) if (thumbsWere.get(k) !== v) changed.add(k);
      for (const [k] of thumbsWere) if (!now.has(k)) changed.add(k);
      const gone = [...changed].filter(k => now.get(k) === -1);
      const back = [...changed].filter(k => thumbsWere.get(k) === -1 && now.get(k) !== -1);
      thumbsWere = now;
      for (const k of changed) for (const b of el.querySelectorAll(`.sp-thumb[data-thumb="${CSS.escape(k)}"]`)) paintThumb(b);
      if (back.length || (gone.length && S.q)) { rebuild(); return; }
      for (const k of gone) dropFromView(k);
      refresh('thumbs', 'hidden');
    }));
    offs.push(api.store.sub('portal.play', () => refresh('continue', 'because', 'trending')));
    offs.push(collections.subscribe(() => refresh('collections')));
    offs.push(api.store.sub('portal.games.playlog', () => refresh('trending')));
    /* the StaticOS switch and the system setting both stop the hero at once */
    const onMotion = () => { el.classList.toggle('sp--still', reduced()); if (S.tab === 'home' && !S.q) refresh('hero'); };
    offs.push(api.store.sub('prefs.reduceMotion', onMotion));
    const motionMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (motionMQ?.addEventListener) {
      motionMQ.addEventListener('change', onMotion);
      offs.push(() => motionMQ.removeEventListener('change', onMotion));
    }

    offs.push(() => { alive = false; });
    const loadProjects = () => projects.list().then(ps => { if (!alive) return; S.projects = ps; afterProjects(); })
      .catch(err => { console.warn('[play] projects', err); if (alive) { S.projects = []; afterProjects(); } });
    function afterProjects() {
      if (S.q || S.tab === 'creations') render();
      else refresh('creations', 'continue', 'collections');
    }
    offs.push(api.bus.on('projects:change', () => loadProjects()));

    /* opening Play again (dock, launcher) just focuses it; only real options change the view */
    win.onReopen(o => {
      if (!o) return;
      let changed = false;
      if (typeof o.q === 'string') { searchIn.value = o.q; S.q = o.q.trim(); S.searchPage = 1; S.showHidden = false; searchClear.hidden = !o.q; changed = true; }
      if (tabOf(o.tab)) {
        S.tab = tabOf(o.tab);
        if (typeof o.q !== 'string') { S.q = ''; searchIn.value = ''; searchClear.hidden = true; }
        changed = true;
      }
      if (changed) { render(); main.scrollTop = 0; }
      frame(focusInside, 'winfocus');
      if (o.quick) quickPlay(typeof o.quick === 'object' ? o.quick : null);
    });

    render();
    loadProjects();
    if (!S.ready) {
      catalogue.load().catch(() => {}).then(() => {
        if (!alive) return;
        S.ready = true;
        const y = main.scrollTop;
        render();
        main.scrollTop = y;
        if (document.activeElement === searchIn) warmSearch();
      });
    }
    if (opts?.quick) frame(() => quickPlay(typeof opts.quick === 'object' ? opts.quick : null));

    return () => {
      alive = false;
      for (const f of viewOffs.splice(0)) { try { f(); } catch (e) { /* view already gone */ } }
      for (const f of offs.splice(0)) { try { f(); } catch (e) { console.warn('[play] teardown', e); } }
      qpPainters.clear();
      lastPickNodes.clear();
      lazy.length = 0;
      slots.clear();
      dirty.clear();
      /* leave the content in place: the window fades out with it and is
         removed right after, so clearing here only made it blink to empty */
    };
  },
});
