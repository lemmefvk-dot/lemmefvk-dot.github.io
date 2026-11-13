/* ============================================================
   discover.js — Static Discover: something to play, watch or
   make next, from everywhere in StaticOS, and the reason each
   thing was picked.

   ONE STAGE, SEVEN KINDS
   A tab row across kinds — All, Games, Arcade, Anime, Roblox,
   Creations, Collections — over one scrolling stage: a large
   hero for the top pick with its reason, then rows. Every card
   carries one short line that says WHY it is on screen ("Also
   Racing · karts", "You've played 4 Puzzle games here", "306K
   playing at the last catalogue sync"). One search box searches
   whatever is loaded, across every kind, and the tabs narrow it.

   ONLY REAL THINGS
   Rows come from data that exists: the web-game catalogue
   (games.data.js), the Arcade registry, this device's history
   (plays.js, favourites, anime and Roblox history), your projects
   (projects.js), your collections, the Anime and Roblox
   catalogues, and — when Social has turned it on — presence.js.
   Two sections the brief asks for depend on numbers the games
   catalogue does not have yet: Popular (plays) and Hidden Gems
   (rated 4.5+ with plays below the median). Every catalogue figure
   today is a stand-in written by the sync script (quickplay's
   measured() is false for every row), so those sections say so
   instead of ranking by made-up figures; a sync with real numbers
   switches them on with no change here. "Recently Added to
   StaticOS" appears only when catalogue rows carry an `added`
   date (hasAdded()) and is left out entirely otherwise. Roblox
   figures are Roblox's own, labelled "at the last catalogue sync".
   There are no "New" or "Trending" badges anywhere.

   PEOPLE
   Friends Are Playing reads presence.js: people who said hello on
   the public live channel in the last minute, and the title they
   last launched. Friends are the list Social keeps on this device
   (portal.social.friends) and come first under their own label;
   everyone else online is labelled as such, and anyone muted in
   Social is left out. Discover never starts presence (Social
   does), never connects by itself and never publishes anything —
   so it has nothing to rate-limit. Names are not verified and the
   row says so, along with no accounts, no history and nothing on a
   server. Everything received was bounded by identity.clean() and
   is bounded again here (bidi and zero-width characters too),
   rendered only as text, and a title becomes a Play button only
   when it matches a catalogue or Arcade game — which then opens
   only on a click. Anyone can be hidden on this device
   (portal.discover.hidden), with Undo.

   LOADING
   The games catalogue loads on open (it falls back to the hand-
   picked shelf, and Discover says so). Roblox (~1.3 MB) loads when
   its row scrolls near or its tab opens. Anime (several MB) loads
   only when the Anime tab opens or you press Load anime. Rows
   below the fold are built as they scroll near, no row holds more
   than a couple of dozen cards, and search results come 24 at a
   time.

   opts: { tab: 'all'|'games'|'arcade'|'anime'|'roblox'|'creations'|
           'collections', q: 'search words' } on a cold open and
   again through win.onReopen (a reopen without either just brings
   the window forward).
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as catalogue from '../portal/games.data.js';
import * as animeData from '../portal/anime.data.js';
import * as robloxData from '../portal/roblox.data.js';
import { ARCADE, arcadeById } from '../arcade/index.js';
import { searchClassics, CLASSIC_PREFIX } from '../classics/catalog.js';
import * as plays from '../core/plays.js';
import * as QP from '../core/quickplay.js';
import * as projects from '../core/projects.js';
import * as collections from '../core/collections.js';
import { addToDesktop } from '../core/shortcuts.js';
import { tidy } from '../core/identity.js';
import * as presence from '../portal/presence.js';
import * as live from '../portal/live.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-discover-css')) {
  const l = document.createElement('link');
  l.id = 'feat-discover-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-discover.css';
  document.head.appendChild(l);
}

/* ---------- constants ------------------------------------------------ */
const KEY = 'portal.discover';               /* { tab, hidden: [peer ids] } */
const K_FAV = 'portal.games.favs';
const K_RECENT = 'portal.games.recent';      /* launches from before plays.js */
const K_THUMBS = 'portal.forge.thumbs';
const K_ANIME_HIST = 'portal.anime.history';
const K_RBX_RECENT = 'portal.roblox.recent';
const K_FRIENDS = 'portal.social.friends';   /* Social's lists on this device: [{ id, name }] */
const K_MUTED = 'portal.social.muted';
const SOCIAL_APP = 'social';                 /* the app that turns presence on */
const APP_NAME = 'Static Discover';

const DAY = 86400000;
const WEEK = 7 * DAY;
const ROW = 18;                              /* most cards in one row */
const STEP = 24;                             /* search results per "Show more" */
const HIDDEN_MAX = 300;

const TABS = [
  { id: 'all', label: 'All', icon: 'compass' },
  { id: 'games', label: 'Games', icon: 'gamepad' },
  { id: 'arcade', label: 'Arcade', icon: 'zap' },
  { id: 'anime', label: 'Anime', icon: 'star' },
  { id: 'roblox', label: 'Roblox', icon: 'box' },
  { id: 'creations', label: 'Creations', icon: 'sparkles' },
  { id: 'collections', label: 'Collections', icon: 'bookmark' },
];
const tabOf = v => (TABS.some(t => t.id === v) ? v : null);
const KIND_OF_TAB = { games: 'web', arcade: 'arcade', anime: 'anime', roblox: 'roblox', creations: 'creation', collections: 'collection' };
const DESKTOP_KINDS = new Set(['web', 'arcade', 'creation']);
const SHELF_KINDS = new Set(['web', 'arcade', 'creation', 'anime', 'roblox']);

/* Discover's picks leave out anime rated R+ and the adult genres. They are
   still in Static Anime; the Anime rows say so. */
const ANIME_SKIP_RATING = /^(R\+|Rx)/i;
const ANIME_SKIP_GENRE = new Set(['Hentai', 'Erotica', 'Ecchi']);
const animeOk = r => !!r && !ANIME_SKIP_RATING.test(String(r.rating || ''))
  && !(r.genres || []).some(g => ANIME_SKIP_GENRE.has(g));

/* catalogue tags that describe the listing, not the game: never a reason */
const NOISE_TAGS = /^(20\d\d games|best games?|best|amazing|fun|html5|free html5 games for your website|games?|3d games|2d|3d|mentolatux|mapi games|ai games|android|mobile|boys|girls|kids)$/i;

/* Starting ideas for Static Forge, per catalogue category. They are
   suggestions, not data: a click hands one to Forge as a prompt. */
const IDEAS = {
  action: 'A fast top-down action game: dodge waves of enemies, grab power-ups and survive as long as you can',
  puzzle: 'A calm puzzle game where you slide coloured blocks to clear the board in as few moves as possible',
  racing: 'A neon racing game with drifting, a boost meter, three laps and a lap timer',
  platformer: 'A platformer with double jump, moving platforms, coins and three short levels',
  horror: 'A short horror game in a dark house where a flashlight is the only light and something follows you',
  retro: 'A retro arcade shooter with chunky pixel graphics, enemy waves and a high-score table',
  sports: 'A one-on-one football game with simple controls, a goalkeeper and a 60-second timer',
  strategy: 'A small tower defence game with three tower types, upgrades and ten waves',
  adventure: 'A little exploration adventure with keys, locked doors, a map and a hidden treasure',
  shooter: 'A space shooter with enemy waves, upgrades between waves and a boss at the end',
  idle: 'An idle clicker game about growing a tiny space station into a city',
  sandbox: 'A physics sandbox where you drop shapes, stack towers and knock them down',
  fighting: 'A two-player fighting game on one keyboard with health bars, blocking and one special move',
  '2player': 'A two-player game on one keyboard where you race each other to collect gems',
  io: 'An arena game where you grow by eating dots and dodge bigger bots',
  survival: 'A zombie survival game: gather supplies by day, hold out until sunrise',
};
const IDEA_FALLBACK = ['platformer', 'puzzle', 'racing', 'horror'];

/* ---------- small helpers ---------------------------------------------- */
const arr = v => (Array.isArray(v) ? v : []);
const nf = n => Number(n || 0).toLocaleString();
const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : (many || `${one}s`)}`;
function compact(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}K`;
  return nf(v);
}
const fnv = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const catName = id => catalogue.catMeta(id).name;
const catIcon = id => catalogue.catMeta(id).icon || 'gamepad';
const firstCat = g => g.cats.find(c => c !== 'featured') || g.cats[0];
const cleanQ = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '');
/* text from the live channel: identity.tidy, plus the bidi overrides and
   zero-width characters that could make one name pass for another */
const safe = (s, n) => tidy(String(s ?? '').replace(/[​-‏‪-‮⁠-⁯﻿]/g, ''), n);
/* only a link is ever used as art (a catalogue URL or one saved with a collection) */
const linkArt = a => (typeof a === 'string' && a.length < 800 && /^https?:\/\/[^\s"'<>]+$/i.test(a) ? a : null);
/* a creation's picture is this device's own thumbnail */
const thumbOk = t => (typeof t === 'string' && (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(t.slice(0, 200000)) || linkArt(t)) ? t : null);
const bigArt = url => String(url || '').replace(/([?&]w=)320\b/, '$1720');
const studioOf = g => (g.studio && g.studio !== 'direct' ? g.studio : '');
const playersText = a => (a.players.includes(2) ? (a.players.includes(1) ? '1–2 players' : '2 players') : '1 player');

/** Procedural cover, for a game with no art (or art that fails to load). */
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

/* ---------- item shapes -------------------------------------------------
   { kind, id, title, art, why, whyIcon, ...the record } — one shape for
   every card, so the card, the hero and the menu never branch on where
   an item came from. */
const webItem = (g, why, whyIcon) => ({ kind: 'web', id: g.id, title: QP.cleanText(g.title) || g.id, art: linkArt(g.art), g, why, whyIcon });
const arcItem = (a, why, whyIcon) => ({ kind: 'arcade', id: a.id, title: a.title, art: null, a, why, whyIcon });
const aniItem = (r, why, whyIcon) => ({ kind: 'anime', id: r.id, title: String(r.title || ''), art: linkArt(r.image), backdrop: linkArt(r.backdrop), r, why, whyIcon });
const rbxItem = (r, why, whyIcon) => ({ kind: 'roblox', id: r.id, title: String(r.name || ''), art: linkArt(r.wide) || linkArt(r.art), r, why, whyIcon });

/* ====================================================================== */
defineApp({
  id: 'discover',
  name: APP_NAME,
  icon: 'compass',
  g1: '#45cdf0', g2: '#0874ad',
  category: 'Games',
  keywords: ['discover', 'explore', 'for you', 'recommendations', 'suggestions', 'what to play', 'because you played',
    'you might like', 'hidden gems', 'popular', 'community picks', 'anime', 'roblox', 'arcade', 'creations', 'collections'],
  desc: 'Something to play, watch or make next, and why it was picked',
  singleton: true,
  win: { w: 1120, h: 720, minW: 380, minH: 440 },

  mount({ root, win, opts, api }) {
    const { h, icon, store, bus } = api;
    let alive = true;
    const offs = [];

    /* every frame this app asks for goes through here, so the teardown
       can cancel whatever is pending; a key coalesces repeats */
    const frames = new Map();
    let frameSeq = 0;
    function frame(fn, key) {
      const k = key || `f${++frameSeq}`;
      if (frames.has(k)) cancelAnimationFrame(frames.get(k));
      frames.set(k, requestAnimationFrame(() => { frames.delete(k); if (alive) fn(); }));
    }
    offs.push(() => { for (const id of frames.values()) cancelAnimationFrame(id); frames.clear(); });

    const reduced = () => !!store.get('prefs.reduceMotion')
      || document.body.classList.contains('reduce-motion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* this device's own Discover settings */
    const saved = () => { const v = store.get(KEY, null); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
    const save = patch => store.set(KEY, { ...saved(), ...patch });
    const hiddenIds = () => arr(saved().hidden).filter(x => typeof x === 'string');
    /* Social keeps friends and mutes as [{ id, name }] on this device; Discover
       only reads them (friends first, muted people never shown) */
    const socialIds = key => new Set(arr(store.get(key, []))
      .map(x => (x && typeof x === 'object' ? x.id : null))
      .filter(x => typeof x === 'string' && /^[a-z0-9]{8,32}$/.test(x)));

    const S = {
      tab: tabOf(opts?.tab) || tabOf(saved().tab) || 'all',
      q: cleanQ(opts?.q),
      games: catalogue.isLoaded() ? 'ready' : 'loading',
      anime: animeData.isLoaded('anime') ? 'ready' : 'idle',
      animeErr: '',
      roblox: robloxData.isLoaded() ? (robloxData.loadError() ? 'failed' : 'ready') : 'idle',
      projects: null,
      heroAt: {},           /* tab -> which pick the hero shows */
      more: {},             /* search group -> how many shown */
    };

    /* The catalogue goes first. Anything that reads it before load() has
       started would pin the small fallback shelf for the whole session. */
    if (S.games !== 'ready') {
      catalogue.load().catch(() => null).then(() => {
        if (!alive) return;
        S.games = 'ready';
        paint(true);
      });
    }

    /* ---------------------------------------------------------------- *
     *  chrome: brand, tab row across kinds, search
     * ---------------------------------------------------------------- */
    const el = h('div.app.dv');
    const tabBtns = TABS.map(t => h('button.dv-tab', {
      type: 'button', role: 'tab', id: `dv-tab-${t.id}`, dataset: { tab: t.id }, title: t.label,
      'aria-controls': 'dv-stage', onclick: () => setTab(t.id),
    }, icon(t.icon), h('span.dv-tab__l', { text: t.label })));
    const tabs = h('nav.dv-tabs', { role: 'tablist', 'aria-label': 'What to discover' }, tabBtns);
    tabs.addEventListener('keydown', e => {
      const i = tabBtns.indexOf(document.activeElement);
      if (i < 0) return;
      const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabBtns.length - 1 }[e.key];
      if (n === undefined) return;
      e.preventDefault();
      const k = (n + tabBtns.length) % tabBtns.length;
      tabBtns[k].focus();
      setTab(TABS[k].id);
    });

    const searchIn = h('input.dv-search__in', {
      type: 'search', placeholder: 'Search games, anime, Roblox…', value: S.q, maxlength: '80',
      'aria-label': 'Search everything Discover has loaded', autocomplete: 'off', spellcheck: 'false',
    });
    const searchX = h('button.dv-search__x', { type: 'button', 'aria-label': 'Clear search', title: 'Clear search', hidden: !S.q,
      onclick: () => { searchIn.value = ''; onSearch(true); searchIn.focus(); } }, icon('x'));
    const searchBox = h('label.dv-search', icon('search'), searchIn, searchX);
    let searchT = 0;
    searchIn.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => onSearch(), 180); });
    searchIn.addEventListener('keydown', e => {
      if (e.key === 'Escape' && searchIn.value) { e.preventDefault(); e.stopPropagation(); searchIn.value = ''; onSearch(true); }
      if (e.key === 'Enter') { clearTimeout(searchT); onSearch(true); }
    });
    offs.push(() => clearTimeout(searchT));

    const top = h('header.dv-top',
      h('div.dv-brand', h('span.dv-brand__mark', icon('compass')), h('b', { text: 'Discover' })),
      tabs, searchBox);
    const view = h('div.dv-view');
    const main = h('main.dv-main', { id: 'dv-stage', role: 'tabpanel', tabindex: '-1' }, view);
    const say = h('div.dv-sr', { role: 'status', 'aria-live': 'polite' });
    el.append(top, main, say);
    root.appendChild(el);

    /* ---------------------------------------------------------------- *
     *  lazy rows: a row below the fold is a skeleton until it comes near
     * ---------------------------------------------------------------- */
    const pending = new Map();                /* section element -> fill() */
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const fill = pending.get(e.target);
          if (!fill) continue;
          pending.delete(e.target);
          io.unobserve(e.target);
          fill();
        }
      }, { root: main, rootMargin: '700px 0px 700px 0px' })
      : null;
    offs.push(() => { io?.disconnect(); pending.clear(); });
    function later(node, fill) {
      if (!io) { fill(); return; }
      pending.set(node, fill);
      io.observe(node);
    }
    function dropLazy() {
      for (const n of pending.keys()) io?.unobserve(n);
      pending.clear();
    }

    /* view-scoped hooks, rebuilt on every paint */
    let refs = {};

    /* ---------------------------------------------------------------- *
     *  opening things — only ever from a click, and only things that
     *  exist in the catalogue / Arcade / your data
     * ---------------------------------------------------------------- */
    const note$ = (title, message, ic = 'alert') => api.notify({ app: APP_NAME, icon: ic, title, message, timeout: 5000 });

    function launch(appId, o, name) {
      if (!api.getApp(appId)) {
        note$(`${name} isn’t available`, `This build of StaticOS doesn’t include ${name}.`);
        return null;
      }
      return api.openApp(appId, o);
    }
    const gone = item => { note$('That isn’t here any more', `“${item.title}” is no longer in the catalogue.`); return null; };

    function openItem(item, how = {}) {
      if (!item) return null;
      switch (item.kind) {
        case 'web': {
          const g = catalogue.byId(item.id);
          return g ? launch('aether-games', { url: `static://games/${g.id}` }, 'Static Games') : gone(item);
        }
        case 'arcade': {
          const a = arcadeById(item.id);
          if (!a) return gone(item);
          return launch('arcade', how.players === 2 && a.players.includes(2) ? { game: a.id, players: 2 } : { game: a.id }, 'Static Arcade');
        }
        case 'anime': return launch('aether-anime', { url: `static://anime/${encodeURIComponent(item.id)}` }, 'Static Anime');
        case 'roblox': return launch('aether-roblox', { url: `static://roblox/${encodeURIComponent(item.id)}` }, 'Static Roblox');
        case 'creation': return launch('forge', { project: item.id }, 'Static Forge');
        case 'idea': return launch('forge', { prompt: item.prompt }, 'Static Forge');
        case 'collection': showCollection(item.id); return null;
        case 'citem': return collections.openItem(api, item.it);
        case 'person': return item.match ? openItem(item.match) : null;
        default: return null;
      }
    }

    const isFav = id => QP.favIds().includes(id);
    function toggleFav(item) {
      const cur = QP.favIds();
      const on = !cur.includes(item.id);
      store.set(K_FAV, on ? [item.id, ...cur].slice(0, 400) : cur.filter(x => x !== item.id));
      if (on) bus.emit('game:fav', { id: item.id });
      say.textContent = on ? `${item.title} added to favourites` : `${item.title} removed from favourites`;
    }

    /** What a collection, the Desktop or the share sheet may keep of an item. */
    function plainOf(item) {
      if (item.kind === 'citem') return { kind: item.it.kind, id: item.it.id, title: item.it.title, art: linkArt(item.it.art) };
      if (!SHELF_KINDS.has(item.kind)) return null;
      return { kind: item.kind, id: String(item.id), title: item.title, art: linkArt(item.art) };
    }

    function pinToDesktop(plain) {
      let r = null;
      try { r = addToDesktop(plain); } catch (err) { console.warn('[discover] desktop', err); }
      if (!r) note$('Couldn’t add it to the Desktop', 'There is no Desktop folder to put the shortcut in.');
    }

    function hidePerson(p) {
      const next = [p.id, ...hiddenIds().filter(x => x !== p.id)].slice(0, HIDDEN_MAX);
      save({ hidden: next });
      api.notify({
        app: APP_NAME, icon: 'x-circle', timeout: 6000, title: `${p.name} is hidden`,
        message: 'They won’t show in Discover on this device.',
        actions: [{ label: 'Undo', onClick: () => save({ hidden: hiddenIds().filter(x => x !== p.id) }) }],
      });
    }

    /* ---------------------------------------------------------------- *
     *  the card menu — right-click, the '…' button, or M / Shift+F10 /
     *  the Menu key on a focused card
     * ---------------------------------------------------------------- */
    const ITEM = new WeakMap();
    const bindItem = (node, item) => { ITEM.set(node, item); node.dataset.menu = ''; return node; };

    function menuFor(item, x, y) {
      const out = [];
      switch (item.kind) {
        case 'web':
          out.push({ label: 'Play', icon: 'play', onClick: () => openItem(item) });
          out.push({ label: isFav(item.id) ? 'Remove from favourites' : 'Add to favourites', icon: 'heart', onClick: () => toggleFav(item) });
          break;
        case 'arcade':
          out.push({ label: 'Play', icon: 'play', onClick: () => openItem(item) });
          if (item.a.players.includes(2)) out.push({ label: 'Play with a friend (2 players)', icon: 'users', onClick: () => openItem(item, { players: 2 }) });
          break;
        case 'anime': out.push({ label: 'Open in Static Anime', icon: 'star', onClick: () => openItem(item) }); break;
        case 'roblox': out.push({ label: 'Open in Static Roblox', icon: 'box', onClick: () => openItem(item) }); break;
        case 'creation':
          out.push({ label: 'Open in Static Forge', icon: 'sparkles', onClick: () => openItem(item) });
          if (api.getApp('studio')) out.push({ label: 'Edit in Static Studio', icon: 'code', onClick: () => api.openApp('studio', { project: item.id }) });
          break;
        case 'idea': out.push({ label: 'Make it with AI in Static Forge', icon: 'sparkles', onClick: () => openItem(item) }); return out;
        case 'collection':
          out.push({ label: 'Show this collection', icon: 'bookmark', onClick: () => openItem(item) });
          out.push({ label: 'Open Static Library', icon: 'heart', onClick: () => launch('aether-library', {}, 'Static Library') });
          return out;
        case 'citem':
          out.push({ label: 'Open', icon: 'play', onClick: () => openItem(item) });
          if (item.col) out.push({ label: `Remove from ${item.col.name}`, icon: 'trash', onClick: () => collections.removeItem(item.col.id, item.it) });
          break;
        case 'person':
          if (item.match) out.push({ label: `Play ${item.match.title}`, icon: 'play', onClick: () => openItem(item.match) });
          out.push({ label: `Hide ${item.person.name} on this device`, icon: 'x-circle', onClick: () => hidePerson(item.person) });
          return out;
        default: return out;
      }
      const plain = plainOf(item);
      if (plain) {
        out.push('-', { label: 'Add to collection…', icon: 'bookmark', onClick: () => collections.pickMenu(api, plain, x, y) });
        if (DESKTOP_KINDS.has(plain.kind)) out.push({ label: 'Add to Desktop', icon: 'monitor', onClick: () => pinToDesktop(plain) });
        out.push({ label: 'Share…', icon: 'share', onClick: () => bus.emit('share:open', { ...plain }) });
      }
      return out;
    }

    let lastMenuAt = 0;
    function openMenu(item, x, y) {
      if (!item) return;
      /* the Menu key can raise a contextmenu event as well as the keydown */
      if (performance.now() - lastMenuAt < 250) return;
      lastMenuAt = performance.now();
      const items = menuFor(item, x, y);
      if (items.length) api.menu(items, x, y);
    }
    const menuAt = (item, anchor) => {
      const r = anchor.getBoundingClientRect();
      openMenu(item, r.left + Math.min(20, r.width / 2), r.bottom - Math.min(r.height / 2, 24));
    };

    el.addEventListener('contextmenu', e => {
      const host = e.target.closest?.('[data-menu]');
      const item = host && ITEM.get(host);
      if (!item || e.target.closest('input, textarea')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX || e.clientY) openMenu(item, e.clientX, e.clientY);
      else menuAt(item, e.target.closest('.dv-go') || host);
    });

    function moreBtn(item, o = {}) {
      return h(`button.dv-more-btn${o.big ? '.dv-btn.dv-btn--icon' : ''}`, {
        type: 'button', tabindex: o.focusable || o.big ? null : '-1', title: 'More',
        'aria-label': `More options for ${item.title}`, 'aria-haspopup': 'menu',
        onclick: e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(item, r.left, r.bottom + 4); },
      }, icon('more-horizontal'));
    }

    /* ---------------------------------------------------------------- *
     *  cards
     * ---------------------------------------------------------------- */
    const VERB = { web: 'Play', arcade: 'Play', anime: 'Open', roblox: 'Open', creation: 'Open', idea: 'Make', collection: 'Show', citem: 'Open', person: 'Play' };
    const canOpen = it => it.kind !== 'person' || !!it.match;

    function img(src, o = {}) {
      return h('img.dv-art__img', {
        src: o.big ? bigArt(src) : src, alt: '', loading: o.eager ? 'eager' : 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer', draggable: 'false',
        onload: e => e.target.classList.add('is-in'),
        onerror: e => {
          const t = e.target;
          if (o.big && t.src !== src && !t.dataset.retry) { t.dataset.retry = '1'; t.src = src; return; }
          t.remove();
        },
      });
    }

    function citemArt(it) {
      if (it.kind === 'web') { const g = S.games === 'ready' ? catalogue.byId(it.id) : null; return linkArt(g?.art) || linkArt(it.art); }
      if (it.kind === 'creation') return creationThumb(it.id);
      return linkArt(it.art);
    }

    function artNode(item, o = {}) {
      const box = h('div.dv-art');
      if (item.kind === 'arcade' || (item.kind === 'citem' && item.it.kind === 'arcade' && arcadeById(item.it.id))) {
        const a = item.kind === 'arcade' ? item.a : arcadeById(item.it.id);
        box.classList.add('dv-art--arcade');
        box.style.setProperty('--hue', String(a.hue));
        box.append(h('span.dv-art__glyph', icon(a.icon)));
      } else if (item.kind === 'collection') {
        box.classList.add('dv-art--col');
        const tiles = item.c.items.slice(0, 4).map(it => {
          const src = citemArt(it);
          const t = h('span.dv-mosaic__t', { style: { background: artBg(it.title) } });
          if (src) t.append(img(src));
          return t;
        });
        box.append(h('span.dv-mosaic', { dataset: { n: String(tiles.length) } }, tiles),
          h('span.dv-art__glyph.dv-art__glyph--badge', icon(item.c.icon || 'bookmark')));
      } else if (item.kind === 'idea') {
        box.classList.add('dv-art--idea');
        box.style.background = artBg(item.id);
        box.append(h('span.dv-art__glyph', icon('sparkles')));
      } else {
        box.style.background = artBg(item.title);
        box.append(h('span.dv-art__mono', { text: item.title }));
        const src = item.kind === 'citem' ? citemArt(item.it) : item.art;
        if (item.kind === 'creation' && !src) box.append(h('span.dv-art__glyph.dv-art__glyph--sm', icon('sparkles')));
        if (src) box.append(img(src, o));
      }
      /* badges state facts only — never "New" or "Trending" */
      if (item.kind === 'arcade') box.append(h('span.dv-badge', icon('zap', { fill: true }), 'Built in'));
      if (item.kind === 'creation') box.append(h('span.dv-badge.dv-badge--mine', { text: item.p.published ? 'Published' : 'Draft' }));
      if (item.kind === 'anime' && typeof item.r.score === 'number') box.append(h('span.dv-badge', icon('star', { fill: true }), String(item.r.score)));
      return box;
    }

    function metaOf(item) {
      switch (item.kind) {
        case 'web': { const c = firstCat(item.g); return [studioOf(item.g), c ? catName(c) : null].filter(Boolean).join(' · '); }
        case 'arcade': return `Arcade · ~${item.a.minutes} min · ${playersText(item.a)}`;
        case 'anime': {
          const r = item.r;
          return [r.mediaType || 'Anime', r.year || null, r.episodes ? `${r.episodes} ep${r.episodes === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
        }
        case 'roblox': return item.r.creator ? `By ${tidy(item.r.creator, 40)}` : 'Roblox experience';
        case 'creation': return item.p.published ? `Your game · ${catName(String(item.p.published.category || 'action'))}` : `Your project · ${plural(arr(item.p.versions).length, 'version')}`;
        case 'collection': return `Collection · ${plural(item.c.items.length, 'thing')}`;
        case 'idea': return item.prompt;
        case 'citem': return collections.KIND_META[item.it.kind]?.label || '';
        default: return '';
      }
    }

    /** size: 'md' | 'lg' | 'poster' | 'wide' */
    function card(item, o = {}) {
      const size = o.size || 'md';
      const why = item.why || '';
      const meta = metaOf(item);
      const node = h(`div.dv-card.dv-card--${size}`, { role: 'listitem', dataset: { kind: item.kind } },
        artNode(item, o),
        h('div.dv-card__b',
          h('div.dv-card__t', { text: item.title }),
          meta ? h(`div.dv-card__m${item.kind === 'idea' ? '.dv-card__m--2' : ''}`, { text: meta }) : null,
          why ? h('div.dv-card__why', icon(item.whyIcon || 'sparkles'), h('span', { text: why })) : null),
        canOpen(item) ? h('button.dv-go', {
          type: 'button', dataset: { kind: item.kind, id: String(item.id) },
          'aria-label': `${VERB[item.kind] || 'Open'} ${item.title}${why ? `. ${why}` : ''}`,
          'aria-keyshortcuts': 'M Shift+F10',
          onclick: () => openItem(item),
        }) : null,
        h('div.dv-card__acts', moreBtn(item, { focusable: !canOpen(item) })));
      return bindItem(node, item);
    }

    /** A person on the live channel and what they are playing. Everything
        shown was bounded by identity.clean() and is bounded again here. */
    function personCard(p, friend) {
      const name = safe(p.name, 24) || 'Someone';
      const playing = safe(p.playing, 60);
      const hue = Number.isFinite(p.color) ? Math.abs(Math.round(p.color)) % 360 : 200;
      const match = matchPlaying(playing);
      const item = {
        kind: 'person', id: String(p.id), title: match ? match.title : playing, person: { id: String(p.id), name }, match,
        /* presence carries the title a launch recorded, and nothing tells it
           when the game is closed again — so this says "launched", which is
           all anyone here actually knows, not "is playing right now" */
        why: match ? `${friend ? 'Your friend ' : ''}${name} launched it · online now`
          : `${name} launched it · it isn’t in the catalogue here, so it can’t open`,
      };
      const art = match ? artNode(match) : h('div.dv-art.dv-art--person', { style: { '--hue': String(hue) } },
        h('span.dv-art__mono', { text: playing }));
      const node = h(`div.dv-card.dv-card--md.dv-pcard${friend ? '.dv-pcard--friend' : ''}`, { role: 'listitem', dataset: { kind: 'person' } },
        art,
        h('div.dv-card__b',
          h('div.dv-who',
            h('span.dv-av', { style: { '--hue': String(hue) }, text: ([...name][0] || '?').toUpperCase() }),
            h('span.dv-who__n', { text: name }),
            friend ? h('span.dv-who__tag', { text: 'Friend' }) : null),
          h('div.dv-card__t', { text: item.title }),
          h('div.dv-card__why', icon(match ? 'play' : 'info'), h('span', { text: item.why }))),
        match ? h('button.dv-go', {
          type: 'button', dataset: { kind: match.kind, id: String(match.id) },
          'aria-label': `Play ${match.title}, which ${name} launched`, onclick: () => openItem(match),
        }) : null,
        h('div.dv-card__acts.dv-card__acts--on',
          h('button.dv-hide', { type: 'button', title: `Hide ${name} on this device`, 'aria-label': `Hide ${name} on this device`,
            onclick: e => { e.stopPropagation(); hidePerson(item.person); } }, icon('x'))));
      return bindItem(node, item);
    }

    /* ---------------------------------------------------------------- *
     *  rows
     * ---------------------------------------------------------------- */
    function rove(box) {
      box.querySelectorAll('.dv-go').forEach((g, i) => g.setAttribute('tabindex', i === 0 ? '0' : '-1'));
    }

    function rail(items, o = {}) {
      const layout = o.layout || 'rail';
      const box = h(`div.dv-rail.dv-rail--${layout}.dv-rail--${o.size || 'md'}`, { role: 'list', 'aria-label': o.label || null },
        items.map(it => (it.nodeType ? it : card(it, { size: o.size }))));
      rove(box);
      return box;
    }

    function arrows(box, title) {
      const step = d => box.scrollBy({ left: d * Math.max(200, box.clientWidth * 0.85), behavior: reduced() ? 'auto' : 'smooth' });
      const prev = h('button.dv-arrow', { type: 'button', tabindex: '-1', 'aria-label': `Scroll ${title} back`, onclick: () => step(-1) }, icon('chevron-left'));
      const next = h('button.dv-arrow', { type: 'button', tabindex: '-1', 'aria-label': `Scroll ${title} forward`, onclick: () => step(1) }, icon('chevron-right'));
      const key = `arr${++frameSeq}`;
      const upd = () => {
        prev.disabled = box.scrollLeft <= 2;
        next.disabled = box.scrollLeft + box.clientWidth >= box.scrollWidth - 2;
      };
      box.addEventListener('scroll', () => frame(upd, key), { passive: true });
      frame(upd, key);
      return [prev, next];
    }

    const btn = (label, ic, onClick, o = {}) => h(`button.dv-btn${o.primary ? '.dv-btn--primary' : ''}${o.cls || ''}`, {
      type: 'button', onclick: onClick, 'aria-label': o.aria || null,
    }, ic ? icon(ic, o.fill ? { fill: true } : undefined) : null, h('span', { text: label }));

    function note(ic, text, ...actions) {
      const acts = actions.flat().filter(Boolean);
      return h('div.dv-note', icon(ic), h('p', { text }), acts.length ? h('div.dv-note__acts', acts) : null);
    }

    const skeleton = size => h(`div.dv-rail.dv-rail--skel.dv-rail--${size || 'md'}`, { 'aria-hidden': 'true' },
      Array.from({ length: 6 }, () => h(`div.dv-skel.dv-skel--${size || 'md'}`, h('i'), h('b'), h('b'))));

    let secSeq = 0;
    /**
     * spec = { id, title, icon, sub, size, layout: 'rail'|'grid',
     *          items: () => items | Promise<items>, empty: () => node|null,
     *          render: (body, tools) => void, lazy, more: {label, onClick}, max }
     * A row whose items come back empty shows spec.empty(), or goes away.
     */
    function section(spec) {
      const hid = `dv-h-${++secSeq}`;
      const tools = h('div.dv-sec__tools');
      const body = h('div.dv-sec__body');
      const sub = typeof spec.sub === 'string' ? h('p.dv-sec__sub', { text: spec.sub }) : spec.sub || null;
      const sec = h(`section.dv-sec${spec.cls ? `.${spec.cls}` : ''}`, { 'aria-labelledby': hid, dataset: { sec: spec.id } },
        h('div.dv-sec__h',
          h('div.dv-sec__tt',
            h('h2.dv-sec__title', { id: hid }, spec.icon ? icon(spec.icon) : null, h('span', { text: spec.title })),
            sub),
          tools),
        body);
      const moreLink = () => (spec.more ? h('button.dv-more', { type: 'button', onclick: spec.more.onClick },
        h('span', { text: spec.more.label }), icon('chevron-right')) : null);

      /* `now` is the build-time fill of a row that is not lazy: the section
         is not in the document yet (paint() appends the whole view after
         building it), so only a later, lazy fill checks that it still is */
      const fill = async now => {
        if (!alive || (!now && !sec.isConnected)) return;
        if (spec.render) { spec.render(body, tools, sec); return; }
        let items;
        try { items = await spec.items(); }
        catch (err) {
          console.warn('[discover] row', spec.id, err);
          if (alive && sec.isConnected) api.render(body, note('alert', `This row couldn’t be built: ${String(err?.message || err)}`));
          return;
        }
        if (!alive || !sec.isConnected) return;
        if (items && items.nodeType) { api.render(body, items); return; }
        items = arr(items).slice(0, spec.max || ROW);
        if (!items.length) {
          const e = spec.empty ? spec.empty() : null;
          if (e) { api.render(body, e); api.render(tools); } else sec.remove();
          return;
        }
        const layout = spec.layout || 'rail';
        const box = rail(items, { layout, size: spec.size, label: spec.title });
        api.render(body, box);
        api.render(tools, moreLink(), layout === 'rail' ? arrows(box, spec.title) : null);
      };
      if (spec.lazy === false) fill(true);
      else { api.render(body, spec.render ? null : skeleton(spec.size)); later(sec, () => fill(false)); }
      return sec;
    }

    /* ---------------------------------------------------------------- *
     *  keyboard: arrows along a row, M / Shift+F10 / Menu for the menu
     * ---------------------------------------------------------------- */
    view.addEventListener('focusin', e => {
      const go = e.target.closest?.('.dv-go');
      const box = go && go.closest('.dv-rail');
      if (!box) return;
      for (const g of box.querySelectorAll('.dv-go')) g.setAttribute('tabindex', g === go ? '0' : '-1');
    });
    view.addEventListener('keydown', e => {
      const go = e.target.closest?.('.dv-go');
      if (!go || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ContextMenu' || e.key === 'm' || e.key === 'M' || (e.shiftKey && e.key === 'F10')) {
        const host = go.closest('[data-menu]');
        if (host && ITEM.get(host)) { e.preventDefault(); menuAt(ITEM.get(host), go); }
        return;
      }
      const box = go.closest('.dv-rail');
      if (!box) return;
      const list = [...box.querySelectorAll('.dv-go')];
      const i = list.indexOf(go);
      const to = { ArrowRight: list[i + 1], ArrowLeft: list[i - 1], Home: list[0], End: list[list.length - 1] }[e.key];
      if (!to) return;
      e.preventDefault();
      to.focus({ preventScroll: true });
      /* instant, like the browser's own focus scrolling: a smooth scroll
         still running when M is pressed would close the menu it opens
         (the shell menu closes on any scroll) */
      (to.closest('.dv-card') || to).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    });

    /* ---------------------------------------------------------------- *
     *  data: this device's taste, from real history only
     * ---------------------------------------------------------------- */
    /** Web games launched on this device, newest first, one row each. */
    function webHistory() {
      const out = [];
      const seen = new Set();
      const push = (id, at) => {
        if (seen.has(id) || !Number.isFinite(at)) return;
        const g = catalogue.byId(id);
        if (!g) return;
        seen.add(id);
        out.push({ g, at });
      };
      for (const r of plays.recent(80, 'web')) push(r.id, r.at);
      /* launches from before the shared history existed */
      for (const r of arr(store.get(K_RECENT, []))) if (r && typeof r.id === 'string') push(r.id, r.at);
      return out.sort((a, b) => b.at - a.at);
    }

    /** Category weights from what was played (recent counts more), favourited, and played in the Arcade. */
    function taste(hist, favs) {
      const now = Date.now();
      const w = new Map(), played = new Map(), faved = new Map(), arc = new Map();
      const bump = (m, c, n) => m.set(c, (m.get(c) || 0) + n);
      for (const { g, at } of hist) {
        const k = now - at < WEEK ? 1 : now - at < 30 * DAY ? 0.6 : 0.35;
        for (const c of new Set(g.cats)) if (c !== 'featured') { bump(w, c, k); bump(played, c, 1); }
      }
      for (const id of favs) {
        const g = catalogue.byId(id);
        if (!g) continue;
        for (const c of new Set(g.cats)) if (c !== 'featured') { bump(w, c, 0.8); bump(faved, c, 1); }
      }
      const known = catalogue.counts();
      const seenA = new Set();
      for (const r of plays.recent(40, 'arcade')) {
        const a = arcadeById(r.id);
        if (!a || seenA.has(a.id)) continue;
        seenA.add(a.id);
        for (const t of a.tags) {
          const c = String(t).replace(/\s+/g, '');
          if (c !== 'featured' && c !== 'all' && known.get(c)) { bump(w, c, 0.5); bump(arc, c, 1); }
        }
      }
      const topCats = [...w.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
      return { w, played, faved, arc, top: topCats };
    }

    function tasteWhy(c, T) {
      const name = catName(c);
      const n = T.played.get(c) || 0;
      const f = T.faved.get(c) || 0;
      const a = T.arc.get(c) || 0;
      if (n) return `You’ve played ${plural(n, `${name} game`)} here`;
      if (f) return `You favourited ${plural(f, `${name} game`)}`;
      if (a) return `You play ${name} games in the Arcade`;
      return `${name}, which you play`;
    }

    function sharedWith(g, src) {
      const cats = g.cats.filter(c => c !== 'featured' && src.cats.includes(c)).map(catName);
      const st = new Set(src.tags.map(t => String(t).toLowerCase()));
      const tag = g.tags.find(t => st.has(String(t).toLowerCase()) && !NOISE_TAGS.test(t));
      const bits = [...cats.slice(0, 2), tag ? String(tag).toLowerCase() : null].filter(Boolean);
      return bits.length ? `Also ${bits.join(' · ')}` : 'Shares its categories';
    }

    /** You Might Like: your top categories, taken in turn so one doesn't fill the row. */
    function mightLike(T, exclude) {
      const cats = T.top.slice(0, 3);
      if (!cats.length) return [];
      const day = Math.floor(Date.now() / DAY);
      const score = g => g.cats.reduce((s, c) => s + (c === 'featured' ? 0 : (T.w.get(c) || 0)), 0) + (g.curated ? 0.25 : 0);
      const pools = cats.map(c => catalogue.query({ category: c, sort: 'catalogue', perPage: 600 }).items
        .filter(g => g.art && !exclude.has(g.id))
        /* ties break on a hash that changes daily: a rotation, not a ranking */
        .map(g => [score(g), fnv(`${g.id}:${day}`), g])
        .sort((a, b) => b[0] - a[0] || a[1] - b[1])
        .map(x => x[2]));
      const out = [];
      const seen = new Set();
      for (let round = 0; out.length < ROW && round < 60; round++) {
        let any = false;
        for (const pool of pools) {
          const g = pool[round];
          if (!g) continue;
          any = true;
          if (seen.has(g.id) || out.length >= ROW) continue;
          seen.add(g.id);
          const best = g.cats.filter(c => c !== 'featured').sort((a, b) => (T.w.get(b) || 0) - (T.w.get(a) || 0))[0];
          out.push(webItem(g, tasteWhy(best, T), 'heart'));
        }
        if (!any) break;
      }
      return out;
    }

    const curatedRows = () => catalogue.query({ category: 'featured', sort: 'catalogue', perPage: 400 }).items;

    /* measured numbers only — see quickplay.measured(); memoised per catalogue */
    let measuredMemo = null;
    function measuredRows() {
      const all = catalogue.all();
      if (!measuredMemo || measuredMemo.all !== all) measuredMemo = { all, rows: all.filter(QP.measured) };
      return measuredMemo.rows;
    }

    /** Everything the All and Games tabs need, computed once per paint. */
    function model() {
      const hist = webHistory();
      const playedIds = new Set(hist.map(x => x.g.id));
      const favs = QP.favIds();
      const T = taste(hist, favs);
      const src = hist[0] ? hist[0].g : null;
      const srcTitle = src ? QP.cleanText(src.title) : '';
      const because = src
        ? catalogue.related(src, 40).filter(g => !playedIds.has(g.id)).slice(0, ROW).map(g => webItem(g, sharedWith(g, src), 'sparkles'))
        : [];
      const exclude = new Set([...playedIds, ...favs, ...because.map(x => x.id)]);
      const might = mightLike(T, exclude);
      return { hist, playedIds, favs, T, src, srcTitle, because, might };
    }

    function topPicks(M) {
      const out = [];
      const seen = new Set();
      const add = it => { if (it && !seen.has(it.id)) { seen.add(it.id); out.push(it); } };
      const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
      const b = n => (M.because[n] ? { ...M.because[n], why: `Because you played ${M.srcTitle} — ${lower(M.because[n].why)}` } : null);
      add(b(0)); add(M.might[0]); add(b(1)); add(M.might[1]);
      if (!out.length) {
        const cur = curatedRows().filter(g => g.art && !M.playedIds.has(g.id));
        const lead = [...cur.filter(g => g.cats.includes('featured')), ...cur.filter(g => !g.cats.includes('featured'))];
        lead.slice(0, 3).forEach(g => add(webItem(g, g.cats.includes('featured') ? 'Featured on the catalogue’s hand-picked shelf' : 'From the catalogue’s hand-picked shelf', 'star')));
      }
      return out.slice(0, 4);
    }

    /* ---- the Arcade ----------------------------------------------------- */
    function arcadeLast() {
      const m = new Map();
      for (const r of plays.recent(80, 'arcade')) if (!m.has(r.id)) m.set(r.id, r.at);
      return m;
    }

    /* ---- anime (only once it is loaded) --------------------------------- */
    let animeMemo = null;
    function animeRows() {
      const all = animeData.peek('anime') || [];
      if (!animeMemo || animeMemo.all !== all) animeMemo = { all, rows: all.filter(animeOk) };
      return animeMemo.rows;
    }
    const byScore = (a, b) => (b.score || 0) - (a.score || 0) || String(a.title).localeCompare(String(b.title));
    function animeBecause() {
      const hist = arr(store.get(K_ANIME_HIST, [])).filter(r => r && r.k === 'anime' && r.id);
      for (const hItem of hist.slice(0, 8)) {
        const rec = animeData.byId(hItem.id, 'anime');
        if (!rec) continue;
        const want = new Set(rec.genres || []);
        const sim = animeData.similar(rec, 'anime', 60).filter(animeOk).slice(0, ROW);
        if (sim.length) {
          return {
            src: rec,
            items: sim.map(r => {
              const common = (r.genres || []).filter(g => want.has(g)).slice(0, 2);
              return aniItem(r, common.length ? `Also ${common.join(' · ')}` : 'Similar genres', 'sparkles');
            }),
          };
        }
      }
      return null;
    }
    const scoreWhy = r => (typeof r.score === 'number' ? `Scored ${r.score} on MyAnimeList` : 'On MyAnimeList');
    /* the same, mid-sentence (MyAnimeList keeps its capitals) */
    const scoreWhyMid = r => (typeof r.score === 'number' ? `scored ${r.score} on MyAnimeList` : 'not scored on MyAnimeList yet');

    /* ---- Roblox (only once it is loaded) -------------------------------- */
    const RBX_CAT = new Map(robloxData.CATEGORIES);
    const rbxLabel = c => RBX_CAT.get(c) || (c ? c.charAt(0).toUpperCase() + c.slice(1) : '');
    const rbxWhen = r => (r.live ? 'at Static Roblox’s last check' : 'at the last catalogue sync');
    const rbxPlaying = r => `${compact(r.playing)} playing ${rbxWhen(r)}`;
    function rbxBecause() {
      const ids = arr(store.get(K_RBX_RECENT, [])).filter(x => typeof x === 'string');
      for (const id of ids.slice(0, 6)) {
        const src = robloxData.byId(id);
        if (!src) continue;
        const cats = new Set(src.cats);
        const sim = robloxData.all()
          .filter(r => r.id !== src.id && r.cats.some(c => cats.has(c)))
          .map(r => [r.cats.filter(c => cats.has(c)).length, r])
          .sort((a, b) => b[0] - a[0] || b[1].playing - a[1].playing)
          .slice(0, ROW)
          .map(([, r]) => rbxItem(r, `Also ${r.cats.filter(c => cats.has(c)).slice(0, 2).map(rbxLabel).join(' · ')}`, 'sparkles'));
        if (sim.length) return { src, items: sim };
      }
      return null;
    }

    /* ---- your creations ------------------------------------------------- */
    const creationThumb = id => {
      const p = arr(S.projects).find(x => x.id === id);
      const thumbs = store.get(K_THUMBS, {}) || {};
      return thumbOk(p?.published?.thumbnail) || thumbOk(thumbs[id]);
    };
    function creItem(p) {
      const title = String(p.published?.title || p.name || 'Untitled game');
      const ai = arr(p.versions).filter(v => v && v.by === 'ai').length;
      const why = p.published
        ? `You published it ${QP.ago(Number(p.published.at) || p.updatedAt)}`
        : `Your draft · edited ${QP.ago(p.updatedAt)}${ai ? ` · ${plural(ai, 'AI edit')}` : ''}`;
      return { kind: 'creation', id: p.id, title, art: creationThumb(p.id), p, why, whyIcon: p.published ? 'upload' : 'edit-3' };
    }
    let projJob = null;
    function ensureProjects() {
      if (S.projects) return Promise.resolve(S.projects);
      if (!projJob) {
        projJob = projects.list()
          .then(list => { S.projects = arr(list).filter(p => p && p.id); })
          .catch(err => { console.warn('[discover] projects', err); S.projects = []; })
          .finally(() => { projJob = null; if (alive) refs.footer?.(); });
      }
      return projJob.then(() => S.projects);
    }

    function ideaItems(T) {
      const out = [];
      for (const c of T.top) {
        if (out.length >= 3) break;
        if (IDEAS[c]) out.push({ kind: 'idea', id: `idea:${c}`, title: `Your own ${catName(c)} game`, prompt: IDEAS[c], why: tasteWhy(c, T), whyIcon: 'heart' });
      }
      for (const c of IDEA_FALLBACK) {
        if (out.length >= 4) break;
        if (!out.some(x => x.id === `idea:${c}`)) out.push({ kind: 'idea', id: `idea:${c}`, title: `A ${catName(c).toLowerCase()} game`, prompt: IDEAS[c], why: 'A starting idea: Forge builds it with AI', whyIcon: 'sparkles' });
      }
      return out;
    }

    /* ---- collections ---------------------------------------------------- */
    const colItem = c => {
      const newest = c.items.reduce((m, it) => Math.max(m, Number(it.at) || 0), 0);
      return { kind: 'collection', id: c.id, title: c.name, c,
        why: c.items.length ? `You added to it ${QP.ago(newest || c.createdAt)}` : 'Your collection · empty so far', whyIcon: 'bookmark' };
    };
    const citem = (it, c) => ({ kind: 'citem', id: `${it.kind}:${it.id}`, title: it.title, it, col: c, art: null, why: `In ${c.name} · added ${QP.ago(it.at)}`, whyIcon: 'bookmark' });

    function showCollection(id) {
      if (S.q) { S.q = ''; searchIn.value = ''; searchX.hidden = true; }
      setTab('collections', { keepScroll: false });
      frame(() => {
        const sec = view.querySelector(`[data-col="${CSS.escape(String(id))}"]`);
        if (!sec) return;
        sec.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
        sec.querySelector('.dv-go')?.focus({ preventScroll: true });
      }, 'showcol');
    }

    /* ---- people on the live channel ------------------------------------- */
    let titleIdx = null;
    function matchPlaying(text) {
      const low = String(text || '').toLowerCase();
      if (!low) return null;
      const a = ARCADE.find(x => x.title.toLowerCase() === low);
      if (a) return arcItem(a, '');
      if (S.games !== 'ready') return null;
      const rows = catalogue.all();
      if (!titleIdx || titleIdx.rows !== rows) {
        /* presence carries the title a launch recorded — sometimes the feed's
           raw one ("GLIM &amp; GLO"), bounded like any network text — so both
           spellings of every title point at the game */
        const map = new Map();
        for (const g of rows) {
          for (const k of [QP.cleanText(g.title), safe(g.title, 60)].map(s => s.toLowerCase())) if (k && !map.has(k)) map.set(k, g.id);
        }
        titleIdx = { rows, map };
      }
      const id = titleIdx.map.get(low);
      const g = id ? catalogue.byId(id) : null;       /* validated against the catalogue */
      return g ? webItem(g, '') : null;
    }

    const LIVE_LABEL = {
      live: 'Live', connecting: 'Connecting…', idle: 'Not connected',
      offline: 'Offline — this network may block the live channel',
    };
    const liveChip = st => h(`span.dv-live.dv-live--${LIVE_LABEL[st] ? st : 'idle'}`, { role: 'status' }, h('i'), h('span', { text: LIVE_LABEL[st] || LIVE_LABEL.idle }));

    function paintPeople(body, tools) {
      if (!presence.running()) {
        api.render(tools);
        const social = api.getApp(SOCIAL_APP);
        api.render(body, note('users', 'Turn on Social to see what people online are playing. Discover doesn’t connect to the live channel by itself.',
          social ? btn(`Open ${social.name || 'Social'}`, 'users', () => api.openApp(SOCIAL_APP)) : null));
        return;
      }
      const st = live.status();
      api.render(tools, liveChip(st));
      const hidden = new Set(hiddenIds());
      const muted = socialIds(K_MUTED);
      const friends = socialIds(K_FRIENDS);
      const everyone = presence.online().filter(p => p && typeof p.id === 'string');
      const shown = everyone.filter(p => !hidden.has(p.id) && !muted.has(p.id));
      const inGame = shown.filter(p => safe(p.playing, 60));
      const pals = inGame.filter(p => friends.has(p.id));
      const others = inGame.filter(p => !friends.has(p.id));
      const group = (label, list, isFriend) => h(`div.dv-pgroup${isFriend ? '.dv-pgroup--friends' : ''}`,
        h('div.dv-pgroup__h', icon(isFriend ? 'star' : 'users'), h('span', { text: label }), h('small', { text: nf(list.length) })),
        rail(list.slice(0, 24).map(p => personCard(p, isFriend)), { size: 'md', label }));
      const parts = [];
      if (!inGame.length) {
        parts.push(note('users', st === 'offline' ? 'Offline — this network may block the live channel, so nobody can be seen right now.'
          : st === 'live' ? (shown.length ? 'Nobody online is in a game right now.' : 'Nobody else is on the live channel right now.')
            : 'Connecting to the live channel…'));
      } else {
        if (pals.length) parts.push(group('Your friends', pals, true));
        else if (friends.size) parts.push(h('p.dv-pline', { text: 'None of your friends is in a game right now.' }));
        if (others.length) parts.push(group(friends.size ? 'Others online' : 'People online', others, false));
      }
      const foot = [];
      const idle = shown.length - inGame.length;
      if (inGame.length && idle > 0) foot.push(h('span', { text: `${plural(idle, 'other person', 'other people')} online, not in a game.` }));
      if (inGame.length && !friends.size) foot.push(h('span', { text: 'Add friends in Social and they’ll come first here.' }));
      const mutedHere = everyone.filter(p => muted.has(p.id) && !hidden.has(p.id)).length;
      if (mutedHere) foot.push(h('span', { text: `${plural(mutedHere, 'person')} you muted in Social ${mutedHere === 1 ? 'isn’t' : 'aren’t'} shown.` }));
      const hiddenHere = everyone.filter(p => hidden.has(p.id)).length;
      if (hidden.size) {
        foot.push(h('span', { text: hiddenHere ? `${plural(hiddenHere, 'person')} online ${hiddenHere === 1 ? 'is' : 'are'} hidden on this device.` : `${plural(hidden.size, 'person', 'people')} hidden on this device.` }),
          h('button.dv-link', { type: 'button', onclick: () => save({ hidden: [] }) }, 'Show everyone again'));
      }
      if (foot.length) parts.push(h('div.dv-foot', foot));
      api.render(body, parts);
    }

    /* ---------------------------------------------------------------- *
     *  the hero: the top pick, with its reason
     * ---------------------------------------------------------------- */
    function heroChips(it) {
      const chip = (text, ic) => h('span.dv-chip', ic ? icon(ic) : null, h('span', { text }));
      switch (it.kind) {
        case 'web': return it.g.cats.filter(c => c !== 'featured').slice(0, 3).map(c => chip(catName(c), catIcon(c)));
        case 'arcade': return [chip('Built into StaticOS', 'zap'), chip(playersText(it.a), 'users'), chip(`~${it.a.minutes} min`, 'clock')];
        case 'anime': return [it.r.year ? chip(String(it.r.year), 'calendar') : null, ...(it.r.genres || []).slice(0, 3).map(g => chip(g, 'tag'))].filter(Boolean);
        case 'roblox': return [it.r.creator ? chip(tidy(it.r.creator, 40), 'user') : null, it.r.maxPlayers ? chip(`Up to ${it.r.maxPlayers} per server`, 'users') : null].filter(Boolean);
        case 'creation': return [chip(it.p.published ? 'Published on this computer' : 'Draft', it.p.published ? 'upload' : 'edit-3'), chip(plural(arr(it.p.versions).length, 'version'), 'git-branch')];
        default: return [];
      }
    }
    function heroDesc(it) {
      const t = it.kind === 'web' ? QP.cleanText(it.g.desc)
        : it.kind === 'arcade' ? it.a.blurb
          : it.kind === 'anime' ? it.r.synopsis
            : it.kind === 'roblox' ? String(it.r.desc || '').split('\n')[0]
              : it.kind === 'creation' ? (it.p.published?.description || it.p.prompt || '') : '';
      return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    }
    const HERO_VERB = { web: ['Play', 'play'], arcade: ['Play', 'play'], anime: ['Open in Static Anime', 'star'], roblox: ['Open in Static Roblox', 'box'], creation: ['Open in Static Forge', 'sparkles'] };

    function hero(picks, o = {}) {
      if (!picks.length) return null;
      const key = S.tab;
      let i = (S.heroAt[key] || 0) % picks.length;
      const bg = h('div.dv-hero__bg');
      const text = h('div.dv-hero__text');
      const pic = h('div.dv-hero__pic');
      const node = h('section.dv-hero', { 'aria-label': o.label || 'Top pick', dataset: { sec: 'hero' } }, bg, h('div.dv-hero__in', text, pic));
      function paintHero(focusNext) {
        const it = picks[i];
        node.dataset.kind = it.kind;
        bindItem(node, it);
        const back = it.backdrop || it.art;
        bg.style.background = back ? '' : (it.kind === 'arcade' ? `linear-gradient(140deg,hsl(${it.a.hue} 70% 40%),hsl(${(it.a.hue + 48) % 360} 60% 16%))` : artBg(it.title));
        api.render(bg, back ? h('img', { src: bigArt(back), alt: '', referrerpolicy: 'no-referrer', decoding: 'async', onerror: e => e.target.remove() }) : null);
        api.render(pic, artNode(it, { big: true, eager: true }));
        const [verb, vic] = HERO_VERB[it.kind] || ['Open', 'play'];
        const desc = heroDesc(it);
        api.render(text,
          h('div.dv-eyebrow', icon(o.kickerIcon || 'sparkles'), h('span', { text: picks.length > 1 ? `${o.kicker} · ${i + 1} of ${picks.length}` : o.kicker })),
          h('h2.dv-hero__title', { text: it.title }),
          it.why ? h('p.dv-hero__why', icon(it.whyIcon || 'sparkles'), h('span', { text: it.why })) : null,
          h('div.dv-hero__meta', heroChips(it)),
          desc ? h('p.dv-hero__desc', { text: desc }) : null,
          o.hint ? h('p.dv-hero__hint', { text: o.hint }) : null,
          h('div.dv-hero__acts',
            h('button.dv-btn.dv-btn--primary.dv-btn--lg.dv-hero__go', { type: 'button', 'aria-label': `${verb}: ${it.title}. ${it.why || ''}`,
              onclick: () => openItem(it) }, icon(vic, vic === 'play' ? { fill: true } : undefined), h('span', { text: verb })),
            picks.length > 1 ? h('button.dv-btn.dv-btn--lg.dv-hero__next', { type: 'button', 'aria-label': 'Show the next pick',
              onclick: () => { i = (i + 1) % picks.length; S.heroAt[key] = i; paintHero(true); } }, icon('chevrons-right'), h('span', { text: 'Next pick' })) : null,
            moreBtn(it, { big: true })));
        if (focusNext) node.querySelector('.dv-hero__next')?.focus({ preventScroll: true });
        if (!reduced()) {
          text.classList.remove('is-enter');
          pic.classList.remove('is-enter');
          void text.offsetWidth;
          text.classList.add('is-enter');
          pic.classList.add('is-enter');
        }
      }
      paintHero(false);
      return node;
    }

    function heroSkeleton() {
      return h('section.dv-hero.dv-hero--skel', { 'aria-hidden': 'true' },
        h('div.dv-hero__in', h('div.dv-hero__text', h('b.dv-skel-line.dv-skel-line--s'), h('b.dv-skel-line.dv-skel-line--l'), h('b.dv-skel-line'), h('b.dv-skel-line.dv-skel-line--m')),
          h('div.dv-hero__pic', h('div.dv-art.dv-skel-block'))));
    }

    function loadingPanel(text) {
      return h('div.dv-loading', { role: 'status' }, h('div.spinner'), h('span', { text }));
    }

    function bigEmpty(ic, title, text, ...actions) {
      return h('div.dv-empty', h('div.dv-empty__icon', icon(ic)), h('h2', { text: title }), h('p', { text }),
        actions.filter(Boolean).length ? h('div.dv-empty__acts', actions.filter(Boolean)) : null);
    }

    /* ---------------------------------------------------------------- *
     *  loading the big catalogues
     * ---------------------------------------------------------------- */
    let animeJob = null;
    function ensureAnime() {
      if (S.anime === 'ready' || animeJob) return animeJob || Promise.resolve();
      S.anime = 'loading';
      S.animeErr = '';
      animeJob = animeData.load('anime')
        .then(() => { S.anime = 'ready'; })
        .catch(err => { S.anime = 'failed'; S.animeErr = String(err?.message || err || 'unknown error'); })
        .finally(() => { animeJob = null; if (alive) paint(true); });
      return animeJob;
    }
    let robloxJob = null;
    function ensureRoblox() {
      if (S.roblox === 'ready' || S.roblox === 'failed') return Promise.resolve();
      if (robloxJob) return robloxJob;
      S.roblox = 'loading';
      robloxJob = robloxData.load()
        .then(() => { S.roblox = robloxData.loadError() || !robloxData.all().length ? 'failed' : 'ready'; })
        .catch(() => { S.roblox = 'failed'; })
        .finally(() => { robloxJob = null; if (alive) refs.footer?.(); });
      return robloxJob;
    }
    const robloxFailed = () => note('alert', `The Roblox catalogue didn’t load${robloxData.loadError() ? ` (${robloxData.loadError().message})` : ''}. Reload StaticOS to try again.`);

    /* ---------------------------------------------------------------- *
     *  sections shared by tabs
     * ---------------------------------------------------------------- */
    function gamesNotice() {
      const err = catalogue.loadError();
      if (!err) return null;
      return note('alert', `The full games catalogue didn’t load (${String(err.message || err)}), so Discover is working from the ${plural(catalogue.stats().total, 'game')} on the hand-picked shelf.`);
    }

    function becauseSec(M, skip) {
      if (!M.src) return null;
      return section({
        id: 'because', title: `Because You Played ${M.srcTitle}`, icon: 'sparkles', lazy: false,
        sub: 'The games that share the most categories and tags with it, that you haven’t played here yet.',
        items: () => M.because.filter(x => x.id !== skip),
        empty: () => note('sparkles', `You’ve already played everything this close to ${M.srcTitle}.`),
      });
    }

    function mightSec(M, skip) {
      const names = M.T.top.slice(0, 3).map(catName);
      return section({
        id: 'might', title: 'You Might Like', icon: 'heart', lazy: false,
        sub: names.length ? `Weighted by what you play: mostly ${names.join(', ')}. Nothing you’ve already played or favourited.` : null,
        items: () => M.might.filter(x => x.id !== skip),
        empty: () => note('heart', 'Play or favourite a few games and this row fills with more from the categories you play most.',
          api.getApp('play') ? btn('Open Static Play', 'gamepad', () => api.openApp('play')) : null),
      });
    }

    function peopleSec() {
      return section({
        id: 'friends', title: 'Friends Are Playing', icon: 'users', lazy: false, cls: 'dv-sec--people',
        sub: h('p.dv-sec__sub',
          h('span', { text: 'What people online last launched — your friends (the list Social keeps on this device) first. ' }),
          h('span.dv-sec__warn', { text: 'Public live channel · no accounts · names aren’t verified · live only, no history · nothing stored on a server.' })),
        render: (body, tools) => { refs.people = () => paintPeople(body, tools); paintPeople(body, tools); },
      });
    }

    function picksSec(M, skip) {
      return section({
        id: 'picks', title: 'Community Picks', icon: 'star',
        sub: 'The hand-picked shelf the catalogue started from — picked by people, not ranked by numbers.',
        items: () => {
          const rows = curatedRows().filter(g => g.id !== skip);
          const fresh = rows.filter(g => !M.playedIds.has(g.id));
          const old = rows.filter(g => M.playedIds.has(g.id));
          return [...fresh, ...old].slice(0, ROW).map(g => webItem(g,
            M.playedIds.has(g.id) ? 'Hand-picked · you’ve played it' : g.cats.includes('featured') ? 'Featured on the hand-picked shelf' : 'On the hand-picked shelf', 'star'));
        },
      });
    }

    function addedSec() {
      if (!catalogue.hasAdded()) return null;          /* no dates in the data: no section at all */
      return section({
        id: 'added', title: 'Recently Added to StaticOS', icon: 'plus-circle',
        sub: 'By the date each game was added to the catalogue.',
        items: () => catalogue.query({ sort: 'newest', perPage: 80 }).items.filter(g => g.added).slice(0, ROW)
          .map(g => webItem(g, `Added ${api.fmt.fmtAgo(g.added)}`, 'clock')),
      });
    }

    function popularSec() {
      const rows = measuredRows();
      if (!rows.length) {
        return section({ id: 'popular', title: 'Popular', icon: 'trending-up', lazy: false, cls: 'dv-sec--note',
          render: body => api.render(body, note('info', 'Popular ranks web games by how many times they’ve been played. The catalogue’s play counts are stand-ins today — the sync script fills them in from a formula — so nothing here is ranked by them. This row switches itself on once real counts arrive. Roblox’s player counts are Roblox’s own, so the Roblox tab can rank by them.',
            btn('Most played on Roblox', 'box', () => setTab('roblox')))) });
      }
      return section({
        id: 'popular', title: 'Popular', icon: 'trending-up',
        sub: 'Most played, by the catalogue’s measured play counts.',
        items: () => [...rows].sort((a, b) => b.plays - a.plays).slice(0, ROW).map(g => webItem(g, `${compact(g.plays)} plays`, 'trending-up')),
      });
    }

    function gemsSec(M) {
      const RULE = 'The rule: rated 4.5 or higher, with fewer plays than the median game in the catalogue.';
      const rows = measuredRows();
      if (!rows.length) {
        return section({ id: 'gems', title: 'Hidden Gems', icon: 'diamond', lazy: false, cls: 'dv-sec--note',
          render: body => api.render(body, note('info', `${RULE} The catalogue has no measured ratings or play counts yet, so nothing can honestly pass it today.`)) });
      }
      const sorted = rows.map(g => g.plays).sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      return section({
        id: 'gems', title: 'Hidden Gems', icon: 'diamond',
        sub: `${RULE} The median here is ${nf(median)} plays.`,
        items: () => rows.filter(g => g.rating >= 4.5 && g.plays < median && !M.playedIds.has(g.id))
          .sort((a, b) => b.rating - a.rating || a.plays - b.plays).slice(0, ROW)
          .map(g => webItem(g, `Rated ${g.rating.toFixed(1)} · ${compact(g.plays)} plays`, 'diamond')),
        empty: () => note('info', 'Nothing you haven’t played passes the rule right now.'),
      });
    }

    function arcadeSec() {
      return section({
        id: 'arcade', title: 'From the Arcade', icon: 'zap',
        sub: 'Built into StaticOS: no loading, no network.',
        more: { label: 'Arcade tab', onClick: () => setTab('arcade') },
        items: () => {
          const last = arcadeLast();
          const fresh = ARCADE.filter(a => !last.has(a.id));
          const old = ARCADE.filter(a => last.has(a.id)).sort((a, b) => last.get(a.id) - last.get(b.id));
          return [...fresh, ...old].map(a => (last.has(a.id) ? arcItem(a, `You played it ${QP.ago(last.get(a.id))}`, 'clock')
            : a.players.includes(2) ? arcItem(a, 'Not tried here yet · 2 players on one keyboard', 'users')
              : arcItem(a, `Not tried here yet · about ${a.minutes} min a round`, 'zap')));
        },
      });
    }

    function animeSecAll() {
      return section({
        id: 'anime', title: 'Anime', icon: 'star', size: 'poster',
        sub: 'From the Static Anime catalogue. Scores are MyAnimeList’s.',
        more: { label: 'Anime tab', onClick: () => setTab('anime') },
        items: () => {
          if (S.anime === 'loading') return loadingPanel('Loading the anime catalogue…');
          if (S.anime === 'failed') return note('alert', `The anime catalogue didn’t load (${S.animeErr}).`, btn('Try again', 'refresh', () => ensureAnime()));
          if (S.anime !== 'ready') {
            return note('star', 'The anime catalogue is several megabytes, so it only loads when you ask.',
              btn('Load anime', 'download', () => ensureAnime(), { primary: true }));
          }
          const b = animeBecause();
          if (b) return b.items;
          return [...animeRows()].filter(r => typeof r.score === 'number').sort(byScore).slice(0, ROW).map(r => aniItem(r, scoreWhy(r), 'star'));
        },
      });
    }

    function robloxSecAll() {
      return section({
        id: 'roblox', title: 'Roblox', icon: 'box', size: 'wide',
        sub: 'Roblox’s own numbers from the last catalogue sync. Opens in Static Roblox, which hands off to the Roblox player.',
        more: { label: 'Roblox tab', onClick: () => setTab('roblox') },
        items: async () => {
          await ensureRoblox();
          if (S.roblox !== 'ready') return robloxFailed();
          const b = rbxBecause();
          if (b) return b.items;
          return [...robloxData.all()].sort((a, b2) => b2.playing - a.playing).slice(0, ROW).map(r => rbxItem(r, rbxPlaying(r), 'users'));
        },
      });
    }

    function creationsSec(T) {
      return section({
        id: 'creations', title: 'AI Creations', icon: 'sparkles',
        sub: 'Games made on this computer with Static Forge and Static Studio.',
        more: { label: 'Creations tab', onClick: () => setTab('creations') },
        items: async () => {
          const list = await ensureProjects();
          if (!list.length) {
            return note('sparkles', 'Nothing made on this computer yet. Describe a game and Static Forge builds it with AI.',
              api.getApp('forge') ? btn('Open Static Forge', 'sparkles', () => api.openApp('forge'), { primary: true }) : null);
          }
          return [...list.map(creItem), ...(api.getApp('forge') ? ideaItems(T).slice(0, 2) : [])];
        },
      });
    }

    function collectionsSec() {
      return section({
        id: 'collections', title: 'Your Collections', icon: 'bookmark',
        sub: 'Shelves you made. Right-click anything in Discover to add it to one.',
        more: { label: 'Collections tab', onClick: () => setTab('collections') },
        items: () => collections.list().map(colItem),
        empty: () => note('bookmark', 'No collections yet. Right-click anything here — or press its … button — and choose Add to collection….',
          btn('New collection', 'plus', () => newCollection())),
      });
    }

    async function newCollection() {
      const name = await collections.askName(api, { title: 'New collection', ok: 'Create' });
      if (!name || !alive) return;
      const col = collections.create(name);
      if (!col) note$('Couldn’t make that collection', 'You may already have the most collections StaticOS keeps (60).');
    }

    /* what the page is looking at right now — kept current as the lazy
       catalogues and your projects arrive after the paint */
    function footerText() {
      const bits = [];
      if (S.games === 'ready') bits.push(plural(catalogue.stats().total, 'web game'));
      bits.push(plural(ARCADE.length, 'Arcade game'));
      if (S.anime === 'ready') bits.push(plural((animeData.peek('anime') || []).length, 'anime title'));
      if (S.roblox === 'ready') bits.push(plural(robloxData.all().length, 'Roblox experience'));
      if (S.projects) bits.push(plural(S.projects.length, 'creation'));
      bits.push(plural(collections.list().length, 'collection'));
      return `Looking at ${bits.join(', ')}${S.anime !== 'ready' ? ' — anime isn’t loaded' : ''}.`;
    }
    function footer() {
      const line = h('p', { text: footerText() });
      refs.footer = () => { if (line.isConnected) line.textContent = footerText(); };
      return h('footer.dv-footnote', line,
        h('p', { text: 'Discover only uses what’s really here: the StaticOS catalogues, this device’s history, your projects and collections, and — when Social is on — people on the public live channel. No badges, counts or picks are made up.' }));
    }

    /* ---------------------------------------------------------------- *
     *  tabs
     * ---------------------------------------------------------------- */
    function buildAll() {
      if (S.games !== 'ready') return [heroSkeleton(), h('div.dv-sec', skeleton('md')), h('div.dv-sec', skeleton('md'))];
      const M = model();
      const picks = topPicks(M);
      const skip = picks[0]?.id;
      return [
        hero(picks, {
          kicker: M.hist.length ? 'Top pick for you' : 'A place to start',
          hint: M.hist.length ? null : 'Nothing has been played on this device yet, so this comes from the hand-picked shelf. Play anything and Discover starts following what you like.',
        }),
        gamesNotice(),
        becauseSec(M, skip),
        mightSec(M, skip),
        peopleSec(),
        picksSec(M, skip),
        addedSec(),
        arcadeSec(),
        animeSecAll(),
        robloxSecAll(),
        creationsSec(M.T),
        collectionsSec(),
        popularSec(),
        gemsSec(M),
        footer(),
      ];
    }

    function buildGames() {
      if (S.games !== 'ready') return [heroSkeleton(), h('div.dv-sec', skeleton('md'))];
      const M = model();
      const picks = topPicks(M);
      const skip = picks[0]?.id;
      /* your top categories first, then the biggest ones, six shelves in all */
      const cats = catalogue.categories().map(c => c.id).filter(c => c !== 'featured');
      const order = [...M.T.top.filter(c => cats.includes(c)).slice(0, 3), ...cats].filter((c, i, a) => a.indexOf(c) === i).slice(0, 6);
      const counts = catalogue.counts();
      const shelves = order.map(c => section({
        id: `cat-${c}`, title: catName(c), icon: catIcon(c),
        sub: M.T.w.get(c) ? tasteWhy(c, M.T) : `${plural(counts.get(c) || 0, 'game')} in this category.`,
        more: { label: 'See all', onClick: () => launch('aether-games', { url: `static://games?cat=${encodeURIComponent(c)}` }, 'Static Games') },
        items: () => {
          const day = Math.floor(Date.now() / DAY);
          return catalogue.query({ category: c, sort: 'catalogue', perPage: 300 }).items
            .filter(g => g.art && !M.playedIds.has(g.id))
            .map(g => [fnv(`${g.id}:${c}:${day}`), g]).sort((a, b) => a[0] - b[0]).slice(0, ROW)
            .map(([, g]) => {
              const also = g.cats.find(x => x !== c && x !== 'featured');
              return webItem(g, M.T.w.get(c) ? `${catName(c)}${also ? ` · also ${catName(also)}` : ''} — you play these` : `In ${catName(c)}${also ? ` · also ${catName(also)}` : ''}`, catIcon(c));
            });
        },
      }));
      return [
        hero(picks, { kicker: M.hist.length ? 'Top pick for you' : 'A place to start',
          hint: M.hist.length ? null : 'Nothing has been played on this device yet. Play anything and these picks start following what you like.' }),
        gamesNotice(),
        becauseSec(M, skip),
        mightSec(M, skip),
        peopleSec(),
        picksSec(M, skip),
        addedSec(),
        ...shelves,
        popularSec(),
        gemsSec(M),
        footer(),
      ];
    }

    function buildArcade() {
      const last = arcadeLast();
      const played = ARCADE.filter(a => last.has(a.id)).sort((a, b) => last.get(b.id) - last.get(a.id));
      const fresh = ARCADE.filter(a => !last.has(a.id));
      const picks = [];
      if (played[0]) picks.push(arcItem(played[0], `You played it ${QP.ago(last.get(played[0].id))} — jump back in`, 'clock'));
      fresh.filter(a => a.players.includes(2)).slice(0, 2).forEach(a => picks.push(arcItem(a, 'Two players on one keyboard, and you haven’t tried it here yet', 'users')));
      fresh.filter(a => !a.players.includes(2)).slice(0, 2).forEach(a => picks.push(arcItem(a, `You haven’t tried it here yet · about ${a.minutes} min a round`, 'zap')));
      if (!picks.length) picks.push(arcItem(ARCADE[0], 'Built into StaticOS — it starts instantly', 'zap'));
      const skip = picks[0].id;
      const pack = (list, why, ic) => list.filter(a => a.id !== skip).map(a => arcItem(a, why(a), ic));
      return [
        hero(picks.slice(0, 4), { kicker: played.length ? 'From the Arcade' : 'Built into StaticOS', kickerIcon: 'zap' }),
        section({ id: 'arc-again', title: 'Play Again', icon: 'clock', lazy: false, sub: 'Arcade games you’ve played on this device, most recent first.',
          items: () => pack(played, a => `You played it ${QP.ago(last.get(a.id))}`, 'clock'),
          empty: () => (played.length ? null : note('clock', 'Nothing played in the Arcade on this device yet.')) }),
        section({ id: 'arc-new', title: 'Not Tried Yet', icon: 'compass', lazy: false, sub: 'Never started on this device.',
          items: () => pack(fresh, a => `Not played here · about ${a.minutes} min a round`, 'compass'),
          empty: () => note('check-circle', 'You’ve played every Arcade game on this device.') }),
        section({ id: 'arc-two', title: 'Two Players, One Keyboard', icon: 'users', sub: 'Games that really support a second player on the same device.',
          items: () => pack(ARCADE.filter(a => a.players.includes(2)), a => `${playersText(a)} on this device`, 'users') }),
        section({ id: 'arc-quick', title: 'Done in a Minute or Two', icon: 'clock', sub: 'A typical round is two minutes or less.',
          items: () => pack(ARCADE.filter(a => a.minutes <= 2), a => `About ${plural(a.minutes, 'minute')} a round`, 'clock') }),
        footer(),
      ];
    }

    function buildAnime() {
      if (S.anime === 'idle') ensureAnime();
      if (S.anime === 'loading' || S.anime === 'idle') return [loadingPanel('Loading the anime catalogue — several megabytes, once per session…')];
      if (S.anime === 'failed') {
        return [bigEmpty('alert', 'The anime catalogue didn’t load', `It came back with “${S.animeErr}”. Check the connection and try again.`,
          btn('Try again', 'refresh', () => ensureAnime(), { primary: true }))];
      }
      const rows = animeRows();
      const shown = new Set();
      const take = (list, n = ROW) => { const out = []; for (const r of list) { if (out.length >= n) break; if (shown.has(r.id)) continue; shown.add(r.id); out.push(r); } return out; };
      const because = animeBecause();
      const airing = rows.filter(r => r.status === animeData.LIVE_STATUS.anime).sort(byScore);
      const topRated = rows.filter(r => typeof r.score === 'number').sort(byScore);
      const picks = [];
      if (because) picks.push(...because.items.slice(0, 2).map(it => ({ ...it, why: `Because you looked at ${because.src.title} — ${it.why.charAt(0).toLowerCase()}${it.why.slice(1)}` })));
      airing.slice(0, 2).forEach(r => picks.push(aniItem(r, `Airing at the last catalogue sync · ${scoreWhyMid(r)}`, 'activity')));
      if (!picks.length) topRated.slice(0, 2).forEach(r => picks.push(aniItem(r, scoreWhy(r), 'star')));
      picks.forEach(p => shown.add(p.id));
      const season = animeData.latestSeason('anime');
      const genres = animeData.topGenres('anime', 12).map(g => g.id).filter(g => !ANIME_SKIP_GENRE.has(g)).slice(0, 6);
      return [
        hero(picks.slice(0, 4), { kicker: because ? 'Top pick for you' : 'From Static Anime', kickerIcon: 'star', label: 'Top anime pick' }),
        because ? section({ id: 'ani-because', title: `Because You Looked at ${because.src.title}`, icon: 'sparkles', size: 'poster', lazy: false,
          sub: 'Titles with the closest genres.', items: () => take(because.items.map(it => it.r)).map(r => because.items.find(it => it.id === r.id)) }) : null,
        section({ id: 'ani-top', title: 'Top Rated', icon: 'star', size: 'poster', lazy: false,
          sub: 'By MyAnimeList score. Titles rated R+ aren’t picked here — they’re still in Static Anime.',
          items: () => take(topRated).map(r => aniItem(r, scoreWhy(r), 'star')) }),
        section({ id: 'ani-airing', title: 'Airing', icon: 'activity', size: 'poster',
          sub: 'Still airing when the catalogue was last synced, best scored first.',
          items: () => take(airing).map(r => aniItem(r, `Airing at the last sync · ${typeof r.score === 'number' ? `scored ${r.score}` : 'not scored yet'}`, 'activity')) }),
        season ? section({ id: 'ani-season', title: season.label, icon: 'calendar', size: 'poster',
          sub: 'The newest season in the catalogue — not today’s date, which the snapshot may be behind.',
          items: () => take(animeData.seasonal('anime', { season: season.season, year: season.year }).filter(animeOk)).map(r => aniItem(r, `From ${season.label}, the newest season here`, 'calendar')) }) : null,
        ...genres.map(gid => section({ id: `ani-g-${gid}`, title: `Top ${gid}`, icon: 'tag', size: 'poster',
          items: () => take(rows.filter(r => r.genres.includes(gid)).sort(byScore)).map(r => aniItem(r, `${gid} · ${scoreWhyMid(r)}`, 'tag')) })),
        footer(),
      ].map(x => x);
    }

    function buildRoblox() {
      if (S.roblox === 'idle' || S.roblox === 'loading') {
        ensureRoblox().then(() => { if (alive && S.tab === 'roblox' && !S.q) paint(true); });
        return [loadingPanel('Loading the Roblox catalogue…')];
      }
      if (S.roblox === 'failed') return [bigEmpty('alert', 'The Roblox catalogue didn’t load', `${robloxData.loadError()?.message || 'It came back empty'}. Reload StaticOS to try again.`)];
      const all = robloxData.all();
      const shown = new Set();
      const take = list => { const out = []; for (const r of list) { if (out.length >= ROW) break; if (shown.has(r.id)) continue; shown.add(r.id); out.push(r); } return out; };
      const byPlaying = [...all].sort((a, b) => b.playing - a.playing);
      const because = rbxBecause();
      const picks = [];
      if (because) picks.push(...because.items.slice(0, 2).map(it => ({ ...it, why: `Because you opened ${because.src.name} — ${it.why.charAt(0).toLowerCase()}${it.why.slice(1)}` })));
      byPlaying.slice(0, picks.length ? 2 : 3).forEach(r => picks.push(rbxItem(r, rbxPlaying(r), 'users')));
      picks.forEach(p => shown.add(p.id));
      const cats = robloxData.CATEGORIES.map(c => c[0]).filter(c => c !== 'all' && c !== 'featured')
        .map(c => [c, all.filter(r => r.cats.includes(c)).length]).filter(x => x[1] >= 6).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
      return [
        hero(picks.slice(0, 4), { kicker: because ? 'Top pick for you' : 'Most played on Roblox', kickerIcon: 'box', label: 'Top Roblox pick' }),
        because ? section({ id: 'rbx-because', title: `Because You Opened ${because.src.name}`, icon: 'sparkles', size: 'wide', lazy: false,
          sub: 'Experiences in the same Roblox categories.', items: () => take(because.items.map(it => it.r)).map(r => because.items.find(it => it.id === r.id)) }) : null,
        section({ id: 'rbx-playing', title: 'Most Playing', icon: 'users', size: 'wide', lazy: false,
          sub: 'Players in the experience when the catalogue was last synced — Roblox’s own count, not live.',
          items: () => take(byPlaying).map(r => rbxItem(r, rbxPlaying(r), 'users')) }),
        section({ id: 'rbx-visits', title: 'Most Visited', icon: 'trending-up', size: 'wide',
          sub: 'All-time visits, as Roblox reported them at the last sync.',
          items: () => take([...all].sort((a, b) => b.visits - a.visits)).map(r => rbxItem(r, `${compact(r.visits)} visits, per Roblox`, 'trending-up')) }),
        section({ id: 'rbx-liked', title: 'Best Liked', icon: 'heart', size: 'wide',
          sub: 'Share of thumbs-up, counting only experiences with at least 5,000 votes.',
          items: () => take(all.filter(r => r.up + r.down >= 5000).sort((a, b) => b.rating - a.rating || (b.up + b.down) - (a.up + a.down)))
            .map(r => rbxItem(r, `${r.rating}% liked · ${compact(r.up + r.down)} votes`, 'heart')) }),
        section({ id: 'rbx-featured', title: 'Featured', icon: 'star', size: 'wide', sub: 'Marked as featured in the catalogue.',
          items: () => take(all.filter(r => r.featured)).map(r => rbxItem(r, 'Featured in the catalogue', 'star')) }),
        ...cats.map(c => section({ id: `rbx-c-${c}`, title: rbxLabel(c), icon: 'tag', size: 'wide',
          items: () => take(all.filter(r => r.cats.includes(c)).sort((a, b) => b.playing - a.playing)).map(r => rbxItem(r, `${rbxLabel(c)} · ${rbxPlaying(r)}`, 'tag')) })),
        footer(),
      ];
    }

    function buildCreations() {
      if (!S.projects) {
        ensureProjects().then(() => { if (alive && S.tab === 'creations' && !S.q) paint(true); });
        return [loadingPanel('Looking for your projects…')];
      }
      const hasForge = !!api.getApp('forge');
      const T = S.games === 'ready' ? taste(webHistory(), QP.favIds()) : { top: [], w: new Map(), played: new Map(), faved: new Map(), arc: new Map() };
      const ideas = hasForge ? ideaItems(T) : [];
      const list = S.projects.map(creItem);
      const ideasSec = ideas.length ? section({ id: 'ideas', title: 'Make Something New', icon: 'plus-circle', lazy: false,
        sub: 'Starting ideas. Choosing one opens Static Forge, which builds it with AI.', items: () => ideas }) : null;
      if (!list.length) {
        return [
          bigEmpty('sparkles', 'Nothing made on this computer yet', 'Describe a game in Static Forge and it builds a playable first version with AI. Everything you make shows up here.',
            hasForge ? btn('Open Static Forge', 'sparkles', () => api.openApp('forge'), { primary: true }) : null),
          ideasSec, footer(),
        ];
      }
      const pub = list.filter(x => x.p.published);
      const drafts = list.filter(x => !x.p.published);
      const lead = list[0];
      return [
        hero([{ ...lead, why: lead.p.published ? lead.why : `Pick up where you left off — edited ${QP.ago(lead.p.updatedAt)}` }], { kicker: 'Your most recent project', kickerIcon: 'sparkles', label: 'Your most recent project' }),
        pub.length ? section({ id: 'cre-pub', title: 'AI Creations — Published', icon: 'upload', lazy: false,
          sub: 'Published on this computer. Other people can’t see them without a server — export from Forge to share a file.', items: () => pub }) : null,
        drafts.length ? section({ id: 'cre-drafts', title: 'AI Creations — Drafts', icon: 'edit-3', lazy: false, sub: 'Not published yet.', items: () => drafts }) : null,
        ideasSec,
        footer(),
      ];
    }

    function buildCollections() {
      const cols = collections.list();
      const actions = h('div.dv-bar',
        h('p', { text: cols.length ? `${plural(cols.length, 'collection')}, newest first. Right-click anything in Discover to add it to one.` : '' }),
        h('div.dv-bar__acts',
          btn('New collection', 'plus', () => newCollection()),
          api.getApp('aether-library') ? btn('Open Static Library', 'heart', () => api.openApp('aether-library')) : null));
      if (!cols.length) {
        return [bigEmpty('bookmark', 'No collections yet', 'A collection is a shelf you fill yourself — games, Arcade games, anime, Roblox experiences and your own creations, mixed. Right-click anything in Discover, or press its … button, and choose Add to collection….',
          btn('New collection', 'plus', () => newCollection(), { primary: true })), footer()];
      }
      return [
        actions,
        ...cols.map(c => {
          const sec = section({
            id: `col-${c.id}`, title: c.name, icon: c.icon || 'bookmark', lazy: false,
            sub: `${plural(c.items.length, 'thing')} · made ${QP.ago(c.createdAt)}`,
            more: c.items.length > 40 && api.getApp('aether-library') ? { label: `All ${c.items.length} in Static Library`, onClick: () => api.openApp('aether-library') } : null,
            max: 40,
            items: () => c.items.slice(0, 40).map(it => citem(it, c)),
            empty: () => note('bookmark', 'Empty so far. Right-click anything in Discover — or press its … button — and choose Add to collection….'),
          });
          sec.dataset.col = c.id;
          return sec;
        }),
        footer(),
      ];
    }

    /* ---------------------------------------------------------------- *
     *  search, across whatever is loaded
     * ---------------------------------------------------------------- */
    function webMatch(g, low) {
      const t = QP.cleanText(g.title).toLowerCase();
      if (t === low) return 'Exact title match';
      if (t.includes(low)) return 'Title matches';
      const tag = g.tags.find(x => String(x).toLowerCase().includes(low));
      if (tag) return `Tagged “${String(tag).toLowerCase()}”`;
      const c = g.cats.find(x => x !== 'featured' && (x.includes(low) || catName(x).toLowerCase().includes(low)));
      if (c) return `In ${catName(c)}`;
      if (String(g.studio || '').toLowerCase().includes(low)) return `By ${g.studio}`;
      return 'Matches your search';
    }

    function buildSearch() {
      const q = S.q;
      const low = q.toLowerCase();
      const want = S.tab === 'all' ? null : KIND_OF_TAB[S.tab];
      const wants = k => !want || want === k;
      const groups = [];
      const waiting = [];

      if (wants('web')) {
        if (S.games !== 'ready') waiting.push(note('gamepad', 'The games catalogue is still loading — its results will appear in a moment.'));
        else {
          /* best match first; ties keep the catalogue's own order rather than
             its stand-in play counts (see Popular) */
          const r = catalogue.query({ q, sort: 'catalogue', perPage: 240 });
          groups.push({ id: 'web', title: 'Web games', icon: 'gamepad', total: r.total, items: r.items.map(g => webItem(g, webMatch(g, low), 'search')),
            more: r.total > 240 ? { label: `All ${nf(r.total)} in Static Games`, onClick: () => launch('aether-games', { url: `static://games?q=${encodeURIComponent(q)}` }, 'Static Games') } : null });
        }
      }
      if (wants('arcade')) {
        const hits = ARCADE.filter(a => `${a.title} ${a.blurb} ${a.tags.join(' ')}`.toLowerCase().includes(low));
        groups.push({ id: 'arcade', title: 'Arcade', icon: 'zap', total: hits.length, items: hits.map(a => arcItem(a,
          a.title.toLowerCase().includes(low) ? 'Title matches' : a.tags.some(t => t.toLowerCase().includes(low)) ? `Tagged “${a.tags.find(t => t.toLowerCase().includes(low))}”` : 'Its description matches', 'search')) });
      }
      if (wants('arcade')) {
        /* old games on the Arcade's Free Classics shelf: not ARCADE games, but opened the same way */
        const classics = searchClassics(q);
        if (classics.length) {
          groups.push({ id: 'classics', title: 'Free Classics', icon: 'gamepad', total: classics.length, items: classics.map(c => ({
            kind: 'citem', id: `arcade:${CLASSIC_PREFIX}${c.id}`, title: c.title, art: null, why: `${c.maker}, ${c.year}`, whyIcon: 'info',
            it: { kind: 'arcade', id: CLASSIC_PREFIX + c.id, title: c.title },
          })) });
        }
      }
      if (wants('anime')) {
        if (S.anime === 'ready') {
          const r = animeData.query({ kind: 'anime', q, perPage: 240 });
          const items = r.items.filter(animeOk);
          groups.push({ id: 'anime', title: 'Anime', icon: 'star', size: 'poster', total: items.length, items: items.map(x => aniItem(x,
            String(x.title).toLowerCase().includes(low) ? 'Title matches' : 'Japanese title matches', 'search')) });
        } else {
          waiting.push(note('star', S.anime === 'loading' ? 'Loading the anime catalogue…' : 'Anime isn’t loaded, so it isn’t searched. It’s several megabytes, so it loads only when you ask.',
            S.anime === 'loading' ? null : btn('Load anime', 'download', () => ensureAnime(), { primary: true })));
        }
      }
      if (wants('roblox')) {
        if (S.roblox === 'ready') {
          const r = robloxData.query({ q, perPage: 240, sort: 'playing' });
          groups.push({ id: 'roblox', title: 'Roblox', icon: 'box', size: 'wide', total: r.total, items: r.items.map(x => rbxItem(x,
            x.name.toLowerCase().includes(low) ? 'Name matches' : String(x.creator).toLowerCase().includes(low) ? `By ${tidy(x.creator, 40)}` : 'Its description matches', 'search')) });
        } else if (S.roblox === 'failed') waiting.push(robloxFailed());
        else waiting.push(note('box', S.roblox === 'loading' ? 'Loading the Roblox catalogue…' : 'The Roblox catalogue isn’t loaded yet, so it isn’t searched.',
          S.roblox === 'loading' ? null : btn('Load Roblox', 'download', () => { ensureRoblox().then(() => { if (alive) paint(true); }); paint(true); })));
      }
      if (wants('creation')) {
        if (!S.projects) { ensureProjects().then(() => { if (alive && S.q) paint(true); }); }
        const hits = arr(S.projects).filter(p => `${p.name} ${p.published?.title || ''} ${p.published?.description || ''} ${p.prompt || ''}`.toLowerCase().includes(low));
        groups.push({ id: 'creation', title: 'Your creations', icon: 'sparkles', total: hits.length, items: hits.map(p => ({ ...creItem(p),
          why: String(p.published?.title || p.name || '').toLowerCase().includes(low) ? 'Name matches' : 'Its description or prompt matches', whyIcon: 'search' })) });
      }
      if (wants('collection')) {
        const cols = collections.list();
        const items = [];
        for (const c of cols) if (c.name.toLowerCase().includes(low)) items.push({ ...colItem(c), why: 'Collection name matches', whyIcon: 'search' });
        for (const c of cols) for (const it of c.items) if (it.title.toLowerCase().includes(low)) items.push({ ...citem(it, c), why: `In your collection ${c.name}`, whyIcon: 'bookmark' });
        groups.push({ id: 'collection', title: 'Your collections', icon: 'bookmark', total: items.length, items });
      }

      const total = groups.reduce((n, g) => n + g.total, 0);
      const scope = want ? ` in ${TABS.find(t => t.id === S.tab).label}` : '';
      const out = [h('div.dv-results', h('h2', { text: total ? `${plural(total, 'result')} for “${q}”${scope}` : `No results for “${q}”${scope}` }),
        h('p', { text: 'Searching everything Discover has loaded. Each result says what matched.' }))];
      out.push(...waiting);
      for (const g of groups) {
        if (!g.items.length) continue;
        const n = S.more[g.id] || STEP;
        const shown = g.items.slice(0, n);
        const left = g.items.length - shown.length;
        out.push(section({
          id: `s-${g.id}`, title: `${g.title} · ${nf(g.total)}`, icon: g.icon, size: g.size || 'md', layout: 'grid', lazy: false, max: n,
          more: g.more || null,
          items: () => shown,
        }));
        if (left > 0) {
          out.push(h('div.dv-showmore', btn(`Show ${Math.min(left, STEP)} more ${g.title.toLowerCase()}`, 'chevron-down', () => { S.more[g.id] = n + STEP; paint(true); })));
        }
      }
      if (!total && !waiting.length) out.push(bigEmpty('search', 'Nothing matches', 'Try fewer words, or a category like “racing” or “puzzle”.'));
      return out;
    }

    /* ---------------------------------------------------------------- *
     *  paint
     * ---------------------------------------------------------------- */
    function paintTabs() {
      for (const b of tabBtns) {
        const on = b.dataset.tab === S.tab;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      main.setAttribute('aria-labelledby', `dv-tab-${S.tab}`);
      /* if the row ever has to scroll (a wide fallback font), keep the
         current tab in view — by hand, so no ancestor scrolls with it */
      const cur = tabBtns.find(b => b.dataset.tab === S.tab);
      if (cur && tabs.scrollWidth > tabs.clientWidth + 1) {
        const r = cur.getBoundingClientRect(), t = tabs.getBoundingClientRect();
        if (r.left < t.left) tabs.scrollLeft -= t.left - r.left + 8;
        else if (r.right > t.right) tabs.scrollLeft += r.right - t.right + 8;
      }
      el.dataset.tab = S.tab;
      el.classList.toggle('dv--search', !!S.q);
      el.classList.toggle('dv--still', reduced());
    }

    const BUILD = { all: buildAll, games: buildGames, arcade: buildArcade, anime: buildAnime, roblox: buildRoblox, creations: buildCreations, collections: buildCollections };

    function paint(keepScroll) {
      if (!alive) return;
      const y = keepScroll ? main.scrollTop : 0;
      dropLazy();
      refs = {};
      secSeq = 0;
      paintTabs();
      let nodes;
      try { nodes = S.q ? buildSearch() : BUILD[S.tab](); }
      catch (err) {
        console.error('[discover] paint', err);
        nodes = [bigEmpty('alert', 'Discover hit a problem', String(err?.message || err), btn('Try again', 'refresh', () => paint(false)))];
      }
      api.render(view, nodes.filter(Boolean));
      main.scrollTop = y;
    }

    function setTab(id, o = {}) {
      const t = tabOf(id);
      if (!t) return;
      const changed = t !== S.tab;
      S.tab = t;
      S.more = {};
      save({ tab: t });
      if (t === 'anime' && S.anime === 'idle') ensureAnime();
      paint(changed ? false : o.keepScroll !== false);
    }

    function onSearch(now) {
      const q = cleanQ(searchIn.value);
      searchX.hidden = !searchIn.value;
      if (q === S.q && !now) return;
      S.q = q;
      S.more = {};
      paint(false);
      say.textContent = q ? (view.querySelector('.dv-results h2')?.textContent || '') : '';
    }

    /* ---------------------------------------------------------------- *
     *  staying current
     * ---------------------------------------------------------------- */
    const soon = () => frame(() => paint(true), 'repaint');
    const people = () => frame(() => refs.people?.(), 'people');
    offs.push(
      store.sub('portal.play', soon),
      store.sub(K_FAV, soon),
      store.sub('portal.collections', soon),
      store.sub(K_THUMBS, () => { if (S.tab === 'creations' || S.tab === 'all') soon(); }),
      store.sub(K_ANIME_HIST, () => { if (S.anime === 'ready') soon(); }),
      store.sub(KEY, people),
      store.sub(K_FRIENDS, people),
      store.sub(K_MUTED, people),
      bus.on('projects:change', () => { S.projects = null; ensureProjects().then(() => { if (alive) soon(); }); }),
      presence.onChange(people),
      /* presence has no "started" event; the channel starting to connect is the sign */
      live.onStatus(people),
    );
    win.onFocus?.(people);

    /* a plain reopen (the Dock, Spotlight) only brings the window forward;
       a tab or a search in the opts changes what it shows */
    win.onReopen(o => {
      if (!alive || !o) return;
      const hasQ = typeof o.q === 'string';
      if (hasQ) { searchIn.value = cleanQ(o.q); searchX.hidden = !searchIn.value; S.q = cleanQ(o.q); S.more = {}; }
      if (tabOf(o.tab)) setTab(o.tab);
      else if (hasQ) paint(false);
    });

    if (S.tab === 'anime' && S.anime === 'idle') ensureAnime();
    ensureProjects().then(() => { if (alive && S.tab === 'creations') paint(true); });
    paint(false);

    return () => {
      alive = false;
      offs.forEach(f => { try { f?.(); } catch (e) { /* already gone */ } });
      offs.length = 0;
      dropLazy();
      refs = {};
    };
  },
});
