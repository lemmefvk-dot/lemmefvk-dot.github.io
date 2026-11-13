/* ============================================================
   multiplayer.js — Static Multiplayer: every way StaticOS has
   to play with somebody else, in one application.

   Ten sections in the sidebar — 2 Player, Co-op, PvP, Local,
   Online, Party, Team, Controller, Keyboard and Games With
   Friends — each a big hero, a filter bar (device + type) and
   the games, in pages of 48.

   ONLY REAL THINGS
   Every list is built from data that exists, by a rule you can
   read below (DEF):
     · the web-game catalogue (games.data.js): a game is in a
       section because its OWN categories or tags say so
       ('2player', '2 Player', '.io Games', 'Multiplayer',
       'Online', 'fighting', 'Battle', a tag with "party" in it…);
     · the Static Arcade registry, whose `players` and `input`
       are what each game really supports (2 = same device), and
       `online` the games that play a friend on another device
       through a room code (js/arcade/room.js);
     · this device's play history, favourites and collections;
     · the live channel (presence.js) for Games With Friends —
       only devices that said hello in the last minute.
   The catalogue has no co-op, team or party tags today, so those
   sections say so instead of guessing. The catalogue lists no
   controls for almost every game, so the device filter only
   narrows where the data says something (Arcade `input`, a tag
   that names a control) and keeps the rest, marked "controls not
   listed". There are no player counts anywhere: StaticOS has no
   server that could count players.

   LIVE, AND SAFE
   Opening Games With Friends starts presence (off by default,
   shared with Social and Party — never stopped here). Everything
   from the network arrives already bounded by identity.clean(),
   loses direction overrides and invisible marks here (as in
   Social), and is only ever rendered as text. "Play the same game" maps a
   shared title onto a catalogue or Arcade game by exact title,
   re-checks the id exists, and opens it only when you click. This
   app publishes nothing itself; turning "share what I'm playing"
   on or off nudges presence at most once every two seconds.
   Hiding a person is local to this device.

   A NATIVE WINDOW, NOT A PAGE
   The sidebar, the filter bar and the switches are built once and
   updated in place, so keyboard focus survives every change; only
   the list under them is re-rendered. The people list keeps focus
   on the same person's button across live updates.

   opts: { section: '<id or name>', q: 'search words' } on a cold
   open and again through win.onReopen.
   Store: portal.multiplayer = { section, device, hidden: [ids] }
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as catalogue from '../portal/games.data.js';
import { ARCADE, arcadeById } from '../arcade/index.js';
import * as plays from '../core/plays.js';
import * as collections from '../core/collections.js';
import { addToDesktop } from '../core/shortcuts.js';
import { cleanText } from '../core/quickplay.js';
import * as live from '../portal/live.js';
import * as presence from '../portal/presence.js';
import { me, tidy } from '../core/identity.js';
import * as padmap from '../core/padmap.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-multiplayer-css')) {
  const l = document.createElement('link');
  l.id = 'feat-multiplayer-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-multiplayer.css';
  document.head.appendChild(l);
}

/* ---------- constants ------------------------------------------------ */
const KEY = 'portal.multiplayer';          /* { section, device, hidden: [peer ids] } */
const K_FAV = 'portal.games.favs';         /* shared with Static Games and Play */
const PAGE = 48;
const MAX_HIDDEN = 200;
const MAX_FAV = 400;
const NUDGE_GAP = 2000;                    /* presence nudges from here: at most one per 2 s */
const PHONE = '(max-width: 760px)';        /* the phone shell's breakpoint (mobile.js) */

const SECTIONS = [
  { id: 'two',        label: '2 Player',           icon: 'users',          group: 'How you play', hue: 205 },
  { id: 'coop',       label: 'Co-op',              icon: 'heart',          group: 'How you play', hue: 155 },
  { id: 'pvp',        label: 'PvP',                icon: 'zap',            group: 'How you play', hue: 350 },
  { id: 'local',      label: 'Local Multiplayer',  icon: 'monitor',        group: 'Where',        hue: 265 },
  { id: 'online',     label: 'Online Multiplayer', icon: 'globe',          group: 'Where',        hue: 190 },
  { id: 'party',      label: 'Party Games',        icon: 'sparkles',       group: 'Groups',       hue: 315 },
  { id: 'team',       label: 'Team Games',         icon: 'shield',         group: 'Groups',       hue: 28 },
  { id: 'controller', label: 'Controller Games',   icon: 'gamepad',        group: 'Controls',     hue: 235 },
  { id: 'keyboard',   label: 'Keyboard Games',     icon: 'keyboard',       group: 'Controls',     hue: 45 },
  { id: 'friends',    label: 'Games With Friends', icon: 'message-circle', group: 'People',       hue: 135 },
];
/* names other apps (and people typing) may pass as opts.section */
const ALIAS = {
  '2player': 'two', '2p': 'two', 'two-player': 'two', 'two player': 'two', 'co-op': 'coop', cooperative: 'coop',
  versus: 'pvp', vs: 'pvp', io: 'online', teams: 'team', controllers: 'controller', gamepad: 'controller',
  pad: 'controller', keys: 'keyboard', people: 'friends', social: 'friends', 'with friends': 'friends',
};

const DEVICES = [
  { id: 'any', label: 'Any' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'mouse', label: 'Mouse' },
  { id: 'touch', label: 'Touch' },
  { id: 'controller', label: 'Controller' },
];
const DEV_LABEL = { keyboard: 'Keyboard', mouse: 'Mouse', touch: 'Touch', controller: 'Controller' };
const DEV_ICON = { keyboard: 'keyboard', mouse: 'mouse-pointer', touch: 'mouse-pointer', controller: 'gamepad' };

/* catalogue tags that literally name a control — nothing else counts
   ('arrow'/'arrows' are archery and arrow puzzles, 'Click' is a genre) */
const CONTROL_TAGS = {
  keyboard: 'keyboard', wasd: 'keyboard', 'arrow keys': 'keyboard',
  mouse: 'mouse', 'point and click': 'mouse',
  touch: 'touch', onetouch: 'touch', touchscreen: 'touch', 'touch screen': 'touch',
  gamepad: 'controller', controller: 'controller',
};
/* Arcade games that read the keyboard but the key bridge still can't play
   (the same verdict Controller Center's Compatibility tab gives) */
const NO_BRIDGE = {
  typing: 'Type Rush reads the keyboard too, but it needs whole words typed into a text field — a controller only sends the few keys you map, so it can’t play that one.',
};
/* categories that describe HOW a game is played, not what kind it is */
const NOT_GENRES = new Set(['all', 'featured', 'io', '2player']);

const STATUS_WORD = { online: 'Online', away: 'Away', busy: 'Busy', invisible: 'Invisible' };
const LIVE_TEXT = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Offline — this network may block the live channel',
};
const LIVE_SHORT = { idle: 'not connected', connecting: 'connecting…', live: 'live', offline: 'offline' };

const COPY = {
  two: {
    kicker: 'Made for two',
    lede: 'Everything here takes two players. Pong and Memory are built into StaticOS and share one keyboard or screen; the web games are the ones their publishers marked as two-player.',
  },
  coop: {
    kicker: 'On the same side',
    lede: 'Games where you work together instead of against each other.',
    empty: ['No co-op games are tagged yet', 'None of the games in the catalogue carry a co-op tag, and StaticOS won’t guess which ones might be. This section fills in by itself once publishers tag them.'],
  },
  pvp: {
    kicker: 'Head to head',
    lede: 'Fighting and battle games that their publishers also marked as multiplayer — plus Pong: two paddles, one keyboard.',
  },
  local: {
    kicker: 'One device, two players',
    lede: 'Pong and Memory are built in and really do take two people on one computer. The web games are marked two-player by their publishers — usually two players on one keyboard, but check each game’s own controls.',
  },
  online: {
    kicker: 'Over the internet',
    lede: 'The built-in Arcade games here play a friend on another device: make a room in Static Arcade and send them the code. The web games run online play on their own servers. StaticOS can’t see who is playing, so there are no player counts — the web games are the ones their publishers tagged .io, multiplayer or online.',
  },
  party: {
    kicker: 'Everyone in',
    lede: 'Games for a whole room of people.',
    empty: ['The catalogue doesn’t tag party games yet', 'No game in the catalogue carries a party tag, so there is nothing honest to list here yet. You can still get a group together in Static Party.'],
  },
  team: {
    kicker: 'Pick a side',
    lede: 'Games played in teams.',
    empty: ['No team games are tagged yet', 'None of the games in the catalogue carry a team tag, and StaticOS won’t guess which ones are. This section fills in by itself once publishers tag them.'],
  },
  controller: {
    kicker: 'Pick up a pad',
    lede: 'These built-in games read the keyboard, so Controller Center’s key bridge can play them with a gamepad: it turns your buttons and sticks into the keys each game listens for.',
  },
  keyboard: {
    kicker: 'Share the keys',
    lede: 'Built-in games that read the keyboard. Pong takes two players on one keyboard; the rest are one player at a time, so pass the keyboard and take turns.',
  },
  friends: {
    kicker: 'Right now',
    lede: 'What people on StaticOS are playing at this moment — and a button to open the same game here.',
  },
};

/* ---------- pure helpers --------------------------------------------- */
const arr = v => (Array.isArray(v) ? v : []);
const low = s => String(s == null ? '' : s).toLowerCase();
const plural = (n, w) => `${Number(n).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const fnv = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };

/** Procedural cover for a web game with no art (or art that fails to load). */
function artBg(title) {
  const x = fnv(title);
  const a = x % 360;
  const b = (a + 40 + (x >> 8) % 90) % 360;
  return [
    `radial-gradient(70% 60% at ${20 + (x >> 6) % 50}% ${15 + (x >> 10) % 40}%,hsl(${b} 62% 58% / .8),transparent 62%)`,
    `linear-gradient(${120 + (x >> 4) % 90}deg,hsl(${a} 55% 30%),hsl(${(a + 320) % 360} 48% 13%))`,
  ].join(',');
}

/* The catalogue rows are shared with every other app (and keep one hidden
   class on purpose), so anything derived is cached beside them, not on them. */
const TAGS = new WeakMap();
const tagsOf = g => {
  let s = TAGS.get(g);
  if (!s) { s = new Set(arr(g.tags).map(t => low(t).trim())); TAGS.set(g, s); }
  return s;
};
const CTRL = new WeakMap();
const controlsOf = g => {
  let s = CTRL.get(g);
  if (!s) { s = new Set(); for (const t of tagsOf(g)) if (CONTROL_TAGS[t]) s.add(CONTROL_TAGS[t]); CTRL.set(g, s); }
  return s;
};
const tagMatches = (g, re) => arr(g.tags).some(t => re.test(t));

const is2 = g => g.cats.includes('2player') || tagsOf(g).has('2 player') || tagsOf(g).has('2 player games');
const isOnline = g => g.cats.includes('io') || tagsOf(g).has('.io games') || tagsOf(g).has('multiplayer') || tagsOf(g).has('online');
const isMulti = g => is2(g) || isOnline(g);
const isFight = g => g.cats.includes('fighting') || tagsOf(g).has('battle');
/* literal tag matches only — these are empty today, and that is the point */
const PARTY_RE = /\bparty\b/i;
const COOP_RE = /\bco-?op(erative)?\b/i;
const TEAM_RE = /\bteams?\b/i;

const arcTwo = a => a.players.includes(2);
const arcKeys = a => a.input.includes('keyboard');
const arcPad = a => arcKeys(a) && !NO_BRIDGE[a.id];

/** What each section holds. `arc` filters the Arcade, `web` the catalogue. */
const DEF = {
  two: { arc: arcTwo, web: is2 },
  coop: { arc: () => false, web: g => tagMatches(g, COOP_RE) },
  pvp: { arc: a => ['pong', 'airhockey', 'snakebattle'].includes(a.id), web: g => isMulti(g) && isFight(g) },
  local: { arc: arcTwo, web: g => g.cats.includes('2player'),
    webNote: 'Usually two players on one keyboard — check the game’s own controls.' },
  online: { arc: a => !!a.online, web: isOnline },
  party: { arc: () => false, web: g => tagMatches(g, PARTY_RE) },
  team: { arc: () => false, web: g => tagMatches(g, TEAM_RE) },
  controller: { arc: arcPad, web: null, device: 'controller' },
  keyboard: { arc: arcKeys, web: isMulti, device: 'keyboard' },
};

const secMeta = id => SECTIONS.find(s => s.id === id) || SECTIONS[0];
function secOf(v) {
  const k = low(v).trim();
  if (!k) return null;
  if (SECTIONS.some(s => s.id === k)) return k;
  if (ALIAS[k]) return ALIAS[k];
  const byLabel = SECTIONS.find(s => low(s.label) === k || low(s.label).replace(/ (games|multiplayer)$/, '') === k);
  return byLabel ? byLabel.id : null;
}

/* ---------- item shapes ----------------------------------------------- */
const WEB_ITEMS = new WeakMap();
function webItem(g) {
  let it = WEB_ITEMS.get(g);
  if (!it) {
    it = {
      kind: 'web', id: g.id, g,
      title: cleanText(g.title) || String(g.id),
      art: typeof g.art === 'string' && /^https?:\/\//i.test(g.art) ? g.art : null,
    };
    WEB_ITEMS.set(g, it);
  }
  return it;
}
const ARC_ITEMS = new Map();
function arcItem(a) {
  if (!ARC_ITEMS.has(a.id)) ARC_ITEMS.set(a.id, { kind: 'arcade', id: a.id, a, title: a.title, art: null });
  return ARC_ITEMS.get(a.id);
}
const plain = it => ({ kind: it.kind, id: it.id, title: it.title, art: it.art || null });

/* identity.clean() already bounds every peer field; these two go further
   for what is SHOWN, the same way Static Social does: direction overrides
   (which could make "X is playing" read backwards) and invisible marks */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
const INVIS = /[­​⁠﻿]/g;
const safe = (s, n) => tidy(String(s == null ? '' : s).replace(BIDI, '').replace(INVIS, ''), n);

/** A shared "playing" title, normalised the way presence bounds it. */
const titleKey = t => safe(String(t == null ? '' : t).slice(0, 60), 60).toLowerCase();

function namesLine(names) {
  if (names.length === 1) return `${names[0]} is playing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are playing`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are playing`;
  return `${names[0]}, ${names[1]}, ${names[2]} and others are playing`;
}
const initialOf = name => ([...String(name || '?').trim()][0] || '?').toUpperCase();
const hueOf = c => (Number.isFinite(c) ? Math.abs(Math.round(c)) % 360 : 200);
const cssEsc = s => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

/* ====================================================================== */
defineApp({
  id: 'multiplayer',
  name: 'Static Multiplayer',
  icon: 'users',
  g1: '#55b4fb', g2: '#1364cf',
  category: 'Games',
  keywords: ['multiplayer', '2 player', 'two player', 'co-op', 'coop', 'pvp', 'versus', 'local', 'online', 'io',
    'party', 'team', 'controller', 'gamepad', 'keyboard', 'friends', 'play together', 'same keyboard'],
  desc: 'Games for two or more — local, online, versus — and what people online are playing now',
  singleton: true,
  win: { w: 1000, h: 660, minW: 400, minH: 440 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus } = api;

    const saved = () => { const v = store.get(KEY, null); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
    const save = patch => store.set(KEY, { ...saved(), ...patch });
    const hiddenIds = () => arr(saved().hidden).filter(x => typeof x === 'string' && x.length <= 32).slice(0, MAX_HIDDEN);
    const favIds = () => arr(store.get(K_FAV, [])).filter(x => typeof x === 'string');
    const sharing = () => store.get('prefs.sharePlaying') !== false;

    const S = {
      sec: secOf(opts?.section) || secOf(saved().section) || 'two',
      device: DEVICES.some(d => d.id === saved().device) ? saved().device : 'any',
      type: 'all',
      listedOnly: false,
      q: typeof opts?.q === 'string' ? opts.q.trim().slice(0, 80) : '',
      limit: PAGE,
      back: [], fwd: [],
      ready: false,              /* the full catalogue is loaded */
      loadFailed: false,
      showHidden: false,
    };
    let dead = false;
    let queuedPeople = 0;
    let peopleSig = '';
    let titleIdx = null;
    let nudgeT = 0, lastNudge = 0;
    /* live.js retries every few seconds, passing through 'connecting' each
       time; once it has been offline, keep saying so until it's really live */
    let everOffline = live.status() === 'offline';
    const memo = new Map();
    const offs = [];
    /* references into the current view, reset on every paint, so changes
       from other windows update one element instead of the whole page */
    const V = { shareSw: null, bridgeSw: null, bridgeNote: null, meBox: null, shelf: null, heroArt: null };

    const say = (title, message, ic = 'users') => api.notify({ app: 'Static Multiplayer', icon: ic, title, message, timeout: 4000 });
    const has = id => !!api.getApp(id);

    /* ---------------- chrome ---------------- */
    const btnBack = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Back', 'aria-label': 'Back', onclick: () => goBack() }, icon('chevron-left'));
    const btnFwd = h('button.ibtn.tip', { type: 'button', 'data-tip': 'Forward', 'aria-label': 'Forward', onclick: () => goFwd() }, icon('chevron-right'));
    win.setLead(btnBack, btnFwd);

    const phone = typeof matchMedia === 'function' ? matchMedia(PHONE) : null;
    const search = h('input', {
      type: 'search', spellcheck: 'false', maxlength: '80', autocomplete: 'off',
      'aria-label': 'Search multiplayer games', value: S.q,
      oninput: e => { S.q = e.target.value.trim().slice(0, 80); S.limit = PAGE; paint(true); },
      onkeydown: e => { if (e.key === 'Escape' && S.q) { e.stopPropagation(); clearQ(); paint(true); } },
    });
    const placeholder = () => { search.placeholder = phone && phone.matches ? 'Search games…' : 'Search multiplayer games…'; };
    placeholder();
    /* crossing the phone breakpoint changes the placeholder and whether the
       sidebar can fold (foldSide is defined with the sidebar, below) */
    const onPhone = () => { placeholder(); requestAnimationFrame(() => foldSide()); };
    if (phone) {
      if (phone.addEventListener) { phone.addEventListener('change', onPhone); offs.push(() => phone.removeEventListener('change', onPhone)); }
      else if (phone.addListener) { phone.addListener(onPhone); offs.push(() => phone.removeListener(onPhone)); }
    }
    win.setTools(h('div.field.mp-find', icon('search'), search));

    const side = h('nav.app__side.mp-side', { 'aria-label': 'Sections' });
    const titleEl = h('div.app__title');
    const countEl = h('span.dim.mp-count');
    const barExtra = h('div.mp-bar__x');
    const content = h('div.app__content.mp-content');
    root.appendChild(h('div.app.mp', side,
      h('div.app__main', h('div.app__bar.mp-bar', titleEl, countEl, h('div.grow'), barExtra), content)));

    const livePill = h('span.mp-live', { role: 'status', 'aria-live': 'polite' });
    const friendsDyn = h('div.mp-dyn', { tabindex: '-1' });

    /* ============== data ============== */
    function sectionItems(sec) {
      if (memo.has(sec)) return memo.get(sec);
      const d = DEF[sec];
      if (!d) return { arcs: [], webs: [] };
      const arcs = ARCADE.filter(d.arc).map(arcItem);
      /* never touch catalogue.all() before load() settles: an early all()
         would pin the small fallback shelf in place of the full catalogue */
      const webs = S.ready && d.web ? catalogue.all().filter(d.web).map(webItem) : [];
      const out = { arcs, webs };
      if (S.ready) memo.set(sec, out);
      return out;
    }

    /** Everything any section lists, for search. */
    function universe() {
      if (memo.has('*')) return memo.get('*');
      const arcs = new Map(), webs = new Map();
      for (const sec of Object.keys(DEF)) {
        const { arcs: a, webs: w } = sectionItems(sec);
        a.forEach(it => arcs.set(it.id, it));
        w.forEach(it => webs.set(it.id, it));
      }
      const out = [...arcs.values(), ...webs.values()];
      if (S.ready) memo.set('*', out);
      return out;
    }

    /** A title someone shared -> a game that exists here, or null. */
    function resolveTitle(t) {
      const k = titleKey(t);
      if (!k) return null;
      const a = ARCADE.find(x => titleKey(x.title) === k);
      if (a) return arcItem(a);
      if (!S.ready) return null;
      if (!titleIdx) {
        titleIdx = new Map();
        for (const g of catalogue.all()) {
          for (const key of [titleKey(g.title), titleKey(cleanText(g.title))]) if (key && !titleIdx.has(key)) titleIdx.set(key, g.id);
        }
      }
      const id = titleIdx.get(k);
      const g = id ? catalogue.byId(id) : null;
      return g ? webItem(g) : null;
    }

    /* ============== actions ============== */
    function missing(name, what) {
      say(`${name} isn’t in this copy of StaticOS`, what ? `“${what}” needs ${name} to open.` : `This copy of StaticOS doesn’t include ${name}.`, 'info');
    }

    /** Open a game — only ever from a click, and only an id that exists. */
    function play(it, players) {
      if (!it) return;
      if (it.kind === 'arcade') {
        const a = arcadeById(it.id);
        if (!a) { say('That game isn’t here any more', it.title, 'alert'); return; }
        if (!has('arcade')) { missing('Static Arcade', a.title); return; }
        if (players === 'online' && a.online) { api.openApp('arcade', { game: a.id, online: true }); return; }
        const n = a.players.includes(players) ? players : a.players[0];
        api.openApp('arcade', { game: a.id, players: n });
        return;
      }
      const g = S.ready ? catalogue.byId(it.id) : null;
      if (!g) { say('That game isn’t in the catalogue', it.title, 'alert'); return; }
      if (!has('aether-games')) { missing('Static Games', it.title); return; }
      api.openApp('aether-games', { url: `static://games/${g.id}` });
    }

    function openOther(id, name, o) {
      if (!has(id)) { missing(name); return; }
      api.openApp(id, o);
    }

    function toDesktop(it) {
      try { addToDesktop(plain(it)); }
      catch (err) { say('Couldn’t add it to the Desktop', String(err?.message || err), 'alert'); }
    }

    function pickCollection(it, at) {
      menuLater(at, (x, y) => {
        try { collections.pickMenu(api, plain(it), x, y); }
        catch (err) { say('Collections aren’t available', String(err?.message || err), 'alert'); }
      });
    }

    function toggleFav(it) {
      const cur = favIds();
      const on = !cur.includes(it.id);
      store.set(K_FAV, on ? [it.id, ...cur].slice(0, MAX_FAV) : cur.filter(x => x !== it.id));
      if (on) bus.emit('game:fav', { id: it.id });
      say(on ? 'Added to favourites' : 'Removed from favourites', it.title, 'heart');
    }

    /* Menus open one frame after the press: the shell closes an open menu
       on any scroll, and pressing a half-hidden button scrolls it into view
       — scroll events are dispatched before animation-frame callbacks, so
       by then that scroll has landed. `at` is a point, or the button to
       open under (measured after the scroll, so the menu lines up). */
    function menuLater(at, fn) {
      requestAnimationFrame(() => {
        if (dead) return;
        if (at && typeof at.getBoundingClientRect === 'function') {
          if (!at.isConnected) return;
          const r = at.getBoundingClientRect();
          fn(r.left, r.bottom + 4);
        } else fn(at ? at.x : 0, at ? at.y : 0);
      });
    }

    function openMenu(it, at) {
      menuLater(at, (x, y) => {
        const two = it.kind === 'arcade' && it.a.players.includes(2);
        const fav = it.kind === 'web' && favIds().includes(it.id);
        const short = it.title.length > 34 ? `${it.title.slice(0, 33)}…` : it.title;
        api.menu([
          { header: true, label: short },
          two ? { label: 'Play with 2 players', icon: 'users', hint: 'one device', onClick: () => play(it, 2) }
            : { label: 'Play', icon: 'play', onClick: () => play(it) },
          two ? { label: 'Play solo', icon: 'play', onClick: () => play(it, 1) } : null,
          it.kind === 'arcade' && it.a.online ? { label: 'Play a friend online', icon: 'globe', hint: 'room code', onClick: () => play(it, 'online') } : null,
          '-',
          { label: 'Add to collection…', icon: 'bookmark', onClick: () => pickCollection(it, { x, y }) },
          { label: 'Add to Desktop', icon: 'monitor', onClick: () => toDesktop(it) },
          it.kind === 'web' ? { label: fav ? 'Remove from favourites' : 'Favourite', icon: 'heart', checked: fav, onClick: () => toggleFav(it) } : null,
        ].filter(Boolean), x, y);
      });
    }

    function hide(p) {
      save({ hidden: [p.id, ...hiddenIds().filter(x => x !== p.id)].slice(0, MAX_HIDDEN) });
      say(`${p.name} is hidden`, 'Only on this device. You can show them again under “People you’ve hidden”.', 'x');
      renderPeople(true);
    }
    function unhide(id) {
      save({ hidden: hiddenIds().filter(x => x !== id) });
      renderPeople(true);
    }

    function setSharing(on) {
      store.set('prefs.sharePlaying', !!on);
      /* tell people now rather than at the next 20-second heartbeat — but
         never more than once every two seconds, however fast it's toggled */
      if (presence.running()) {
        clearTimeout(nudgeT);
        nudgeT = setTimeout(() => { nudgeT = 0; if (dead) return; lastNudge = Date.now(); presence.nudge(); },
          Math.max(0, lastNudge + NUDGE_GAP - Date.now()));
      }
    }

    function ensurePresence() {
      if (!presence.running()) presence.start();
    }

    /* ============== pieces ============== */
    const empty = (ic, title, text, ...extra) => h('div.empty.mp-empty', icon(ic), h('b', { text: title }), h('small', { text }),
      extra.filter(Boolean).length ? h('div.mp-empty__acts', extra.filter(Boolean)) : null);
    const btn = (label, ic, onclick, primary, aria, fk) => h(`button.btn.btn--sm${primary ? '.btn--primary' : ''}`,
      { type: 'button', onclick, 'aria-label': aria || null, dataset: fk ? { fk } : null }, ic ? icon(ic) : null, h('span', { text: label }));
    const groupHead = (title, sub, ic) => h('div.mp-ghead',
      h('h3.mp-ghead__t', ic ? icon(ic) : null, h('span', { text: title })),
      sub ? h('p.mp-ghead__s', { text: sub }) : null);
    const avatar = (name, color) => h('span.mp-av', { 'aria-hidden': 'true', style: { '--av': String(hueOf(color)) }, text: initialOf(name) });
    const loadingRow = text => h('div.mp-loading', h('div.spinner'), h('span', { text }));

    function artOf(it) {
      if (it.kind === 'arcade') {
        return h('div.mp-art.mp-art--arcade', { style: { '--hue': String(it.a.hue) } },
          h('span.mp-art__glyph', icon(it.a.icon)),
          h('span.mp-badge', icon('zap', { fill: true }), h('span', { text: 'Built-in' })));
      }
      const box = h('div.mp-art', { style: { background: artBg(it.title) } }, h('span.mp-art__mono', { text: it.title }));
      if (it.art) {
        box.appendChild(h('img.mp-art__img', {
          src: it.art, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false',
          onload: e => e.target.classList.add('is-in'),
          onerror: e => e.target.remove(),
        }));
      }
      box.appendChild(h('span.mp-fav', { 'aria-hidden': 'true', title: 'In your favourites' }, icon('heart', { fill: true })));
      return box;
    }

    function metaOf(it) {
      if (it.kind === 'arcade') return `Built-in · ${it.a.players.includes(2) ? '1–2 players on one device' : 'single-player'}${it.a.online ? ' · online with a room code' : ''}`;
      const g = it.g, parts = [];
      if (is2(g)) parts.push('Marked two-player');
      if (isOnline(g)) parts.push('Online multiplayer');
      if (!parts.length) {
        const t = arr(g.tags).find(x => PARTY_RE.test(x) || COOP_RE.test(x) || TEAM_RE.test(x));
        parts.push(t ? `Tagged “${cleanText(t)}”` : 'Web game');
      }
      return `Web · ${parts.join(' · ')}`;
    }

    /** What is known about how it's played — and, when a device is in
        focus, whether the data says so. */
    function inputChip(it, focus) {
      if (it.kind === 'arcade') {
        if (focus === 'controller' && arcPad(it.a)) return h('span.mp-chip', icon('gamepad'), h('span', { text: 'Controller, through the key bridge' }));
        return h('span.mp-chip', icon(it.a.input.includes('keyboard') ? 'keyboard' : 'mouse-pointer'),
          h('span', { text: it.a.input.map(x => DEV_LABEL[x] || x).join(' · ') }));
      }
      const listed = controlsOf(it.g);
      if (focus && focus !== 'any' && !listed.has(focus)) {
        return h('span.mp-chip.mp-chip--muted', icon('info'),
          h('span', { text: listed.size ? `${DEV_LABEL[focus]} not listed` : 'Controls not listed' }));
      }
      if (listed.size) return h('span.mp-chip', icon(DEV_ICON[focus && listed.has(focus) ? focus : [...listed][0]]), h('span', { text: [...listed].map(x => DEV_LABEL[x]).join(' · ') }));
      return h('span.mp-chip.mp-chip--muted', icon('info'), h('span', { text: 'Controls not listed' }));
    }

    function tile(it, o = {}) {
      const net = it.kind === 'arcade' && !!it.a.online && !!o.online && !o.same;
      const two = !net && it.kind === 'arcade' && it.a.players.includes(2) && !o.same;
      const label = o.same ? 'Play the same game' : net ? 'Play a friend' : two ? '2 players' : 'Play';
      /* focus keys, so a live re-render can put focus back where it was */
      const fk = part => (o.fk ? { fk: `${o.fk}:${part}` } : null);
      const el = h('article.mp-tile', {
        role: 'listitem', dataset: { kind: it.kind, id: it.id },
        oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); openMenu(it, { x: e.clientX, y: e.clientY }); },
      },
        artOf(it),
        h('div.mp-tile__b',
          h('h4.mp-tile__t', { text: it.title, title: it.title }),
          h('p.mp-tile__m', { text: metaOf(it) }),
          h('div.mp-tile__chips', inputChip(it, o.focus)),
          o.note ? h('p.mp-tile__note', { text: o.note }) : null,
          o.who ? h('p.mp-tile__who', icon('users'), h('span', { text: o.who })) : null,
          h('div.mp-tile__acts',
            h('button.btn.btn--sm.btn--primary.mp-play', {
              type: 'button', dataset: fk('play'),
              'aria-label': o.same ? `Play ${it.title} — the same game` : net ? `Play ${it.title} with a friend online` : two ? `Play ${it.title} with 2 players on this device` : `Play ${it.title}`,
              onclick: e => { e.stopPropagation(); play(it, net ? 'online' : two ? 2 : undefined); },
            }, icon(net ? 'globe' : two ? 'users' : 'play', { fill: !two && !net }), h('span', { text: label })),
            h('div.grow'),
            h('button.ibtn.mp-ib', {
              type: 'button', title: 'Add to collection', 'aria-label': `Add ${it.title} to a collection`, 'aria-haspopup': 'menu', dataset: fk('col'),
              onclick: e => { e.stopPropagation(); pickCollection(it, e.currentTarget); },
            }, icon('bookmark')),
            h('button.ibtn.mp-ib', {
              type: 'button', title: 'Add to Desktop', 'aria-label': `Add ${it.title} to the Desktop`, dataset: fk('desk'),
              onclick: e => { e.stopPropagation(); toDesktop(it); },
            }, icon('monitor')),
            h('button.ibtn.mp-ib', {
              type: 'button', title: 'More', 'aria-label': `More options for ${it.title}`, 'aria-haspopup': 'menu', dataset: fk('more'),
              onclick: e => { e.stopPropagation(); openMenu(it, e.currentTarget); },
            }, icon('more-horizontal')))));
      if (it.kind === 'web' && favIds().includes(it.id)) el.classList.add('is-fav');
      return el;
    }

    const grid = (tiles, label) => h('div.mp-grid', { role: 'list', 'aria-label': label || null }, tiles);

    /* ---------- the hero ---------- */
    function collage(arcs, webs, meta) {
      const cards = [];
      for (const it of arcs.slice(0, 2)) {
        cards.push(h('div.mp-hc.mp-hc--arcade', { style: { '--hue': String(it.a.hue) } }, h('span.mp-art__glyph', icon(it.a.icon))));
      }
      for (const it of webs) {
        if (cards.length >= 3) break;
        if (!it.art) continue;
        cards.push(h('div.mp-hc', { style: { background: artBg(it.title) } },
          h('img', { src: it.art, alt: '', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false', onerror: e => e.target.remove() })));
      }
      if (!cards.length) cards.push(h('div.mp-hc.mp-hc--icon', icon(meta.icon)));
      return h('div.mp-hero__art', { 'aria-hidden': 'true', dataset: { n: String(cards.length) } }, cards);
    }

    function hero(sec, arcs, webs, acts, facts) {
      const meta = secMeta(sec), copy = COPY[sec];
      return h('section.mp-hero', { style: { '--h': String(meta.hue) }, 'aria-labelledby': 'mp-hero-t' },
        h('div.mp-hero__in',
          h('div.mp-hero__kick', icon(meta.icon), h('span', { text: copy.kicker })),
          h('h2.mp-hero__t', { id: 'mp-hero-t', text: meta.label }),
          h('p.mp-hero__p', { text: copy.lede }),
          facts && facts.length ? h('div.mp-hero__facts', facts) : null,
          acts && acts.filter(Boolean).length ? h('div.mp-hero__acts', acts.filter(Boolean)) : null),
        collage(arcs, webs, meta));
    }
    const fact = (ic, text) => h('span.mp-fact', icon(ic), h('span', { text }));

    function heroActs(sec) {
      const pong = arcadeById('pong'), memory = arcadeById('memory');
      const playTwo = a => (a ? btn(`${a.title} · 2 players`, 'users', () => play(arcItem(a), 2), true, `Play ${a.title} with 2 players on this device`) : null);
      switch (sec) {
        case 'two': return [playTwo(pong), btn('Start a party', 'sparkles', () => openOther('party', 'Static Party'))];
        case 'pvp': return [playTwo(pong)];
        case 'local': return [playTwo(pong), playTwo(memory)];
        case 'online': return [btn('Find players', 'search', () => openOther('social', 'Static Social'))];
        case 'controller': return [btn('Open Controller Center', 'gamepad', () => openOther('controller', 'Controller Center', { tab: 'map' }), true)];
        case 'keyboard': return [playTwo(pong)];
        default: return [];
      }
    }

    /* ---------- filters ---------- */
    function genresOf(items) {
      const known = new Set(S.ready ? catalogue.categories().map(c => c.id) : []);
      const ids = new Set();
      for (const it of items) {
        const cats = it.kind === 'web' ? it.g.cats : it.a.tags.filter(t => known.has(t));
        for (const c of cats) if (!NOT_GENRES.has(c)) ids.add(c);
      }
      return [...ids].map(id => ({ id, name: catalogue.catMeta(id).name })).sort((a, b) => a.name.localeCompare(b.name));
    }

    function typeOk(it) {
      const t = S.type;
      if (t === 'all') return true;
      if (t === 'arcade' || t === 'web') return it.kind === t;
      if (t.startsWith('g:')) {
        const c = t.slice(2);
        return it.kind === 'web' ? it.g.cats.includes(c) : it.a.tags.includes(c);
      }
      return true;
    }

    /** -> { arcs, webs } after the filters: web games whose data lists the
        focused device first, the rest kept (marked) unless listedOnly. */
    function applyFilters({ arcs, webs }, focus) {
      const dev = S.device;
      const a = arcs.filter(it => typeOk(it) && (dev === 'any' || (dev === 'controller' ? arcPad(it.a) : it.a.input.includes(dev))));
      const listed = [], unlisted = [];
      for (const it of webs) {
        if (!typeOk(it)) continue;
        if (focus === 'any') { listed.push(it); continue; }
        if (controlsOf(it.g).has(focus)) listed.push(it);
        else if (!(S.listedOnly && dev !== 'any')) unlisted.push(it);
      }
      return { arcs: a, webs: [...listed, ...unlisted] };
    }

    /** Built once per section; sync() updates it in place so focus stays put. */
    function filterBar(items, hasWeb, onChange) {
      const segs = DEVICES.map(d => h('button.mp-seg__b', {
        type: 'button', dataset: { dev: d.id },
        onclick: () => {
          if (S.device === d.id) return;
          S.device = d.id; S.limit = PAGE;
          if (d.id === 'any') S.listedOnly = false;
          save({ device: d.id });
          sync(); onChange();
        },
      }, d.label));
      const kinds = new Set(items.map(it => it.kind));
      const genres = genresOf(items);
      const sel = h('select.select.mp-type', {
        'aria-label': 'Type of game',
        onchange: e => { S.type = e.target.value; S.limit = PAGE; onChange(); },
      },
        h('option', { value: 'all', text: 'All types' }),
        kinds.size > 1 ? h('option', { value: 'arcade', text: 'Built-in (Arcade)' }) : null,
        kinds.size > 1 ? h('option', { value: 'web', text: 'Web games' }) : null,
        genres.length ? h('optgroup', { label: 'Genre' }, genres.map(g => h('option', { value: `g:${g.id}`, text: g.name }))) : null);
      const swText = h('span', { id: 'mp-listed-t' });
      const sw = h('button.switch', {
        type: 'button', role: 'switch', 'aria-labelledby': 'mp-listed-t',
        onclick: () => { S.listedOnly = !S.listedOnly; S.limit = PAGE; sync(); onChange(); },
      });
      const listed = h('label.mp-listed', sw, swText);
      function sync() {
        for (const b of segs) {
          const on = b.dataset.dev === S.device;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        }
        sel.value = S.type;
        if (sel.value !== S.type) { S.type = 'all'; sel.value = 'all'; }
        listed.hidden = !(S.device !== 'any' && hasWeb);
        sw.classList.toggle('is-on', S.listedOnly);
        sw.setAttribute('aria-checked', String(S.listedOnly));
        if (S.device !== 'any') swText.textContent = `Only web games that list ${DEV_LABEL[S.device].toLowerCase()}`;
      }
      sync();
      const el = h('div.mp-filters', { role: 'group', 'aria-label': 'Filter games' },
        h('div.mp-seg', { role: 'group', 'aria-label': 'Device' }, h('span.mp-filters__k', { text: 'Device', 'aria-hidden': 'true' }), h('div.mp-seg__row', segs)),
        h('label.mp-filters__type', h('span.mp-filters__k', { text: 'Type', 'aria-hidden': 'true' }), sel),
        listed);
      return { el, sync, first: segs[0] };
    }

    /* ---------- the list, in pages ---------- */
    function webPager(webs, tileOpts) {
      const g = grid([], 'Web games');
      const more = h('button.btn.mp-more', { type: 'button' });
      let shown = 0;
      const add = n => {
        const next = webs.slice(shown, shown + n);
        g.append(...next.map(it => tile(it, tileOpts(it))));
        shown += next.length;
        S.limit = Math.max(PAGE, shown);
        const left = webs.length - shown;
        more.hidden = left <= 0;
        clear(more).append(icon('chevron-down'), h('span', { text: `Show more (${plural(left, 'game')} left)` }));
      };
      more.addEventListener('click', () => add(PAGE));
      add(Math.max(PAGE, S.limit));
      return h('div.mp-pager', g, more);
    }

    function listBlock(fl, sec, focus) {
      const d = DEF[sec] || {};
      const tileOpts = it => ({ focus, note: it.kind === 'web' ? d.webNote : null, online: sec === 'online' });
      const out = h('div.mp-list');
      if (fl.arcs.length) {
        out.append(groupHead('Built into StaticOS', sec === 'online'
          ? `${plural(fl.arcs.length, 'game')} · play a friend on another device — make a room, send the code`
          : `${plural(fl.arcs.length, 'game')} · start instantly, nothing to download`, 'zap'),
          grid(fl.arcs.map(it => tile(it, tileOpts(it))), 'Built-in games'));
      }
      if (fl.webs.length) {
        const n = plural(fl.webs.length, 'game');
        const [title, sub] = sec === 'keyboard'
          ? ['Web games — controls not listed', `${n} · two-player and online games whose catalogue entries don’t say whether they use the keyboard`]
          : sec === 'online'
            ? ['Web games', `${n} · played on each game’s own servers`]
            : ['Web games', `${n} · from the games catalogue`];
        out.append(groupHead(title, sub, 'globe'), webPager(fl.webs, tileOpts));
      }
      return out;
    }

    /* ============== sections ============== */
    function paintSection() {
      const sec = S.sec;
      const meta = secMeta(sec), copy = COPY[sec], d = DEF[sec];
      titleEl.textContent = meta.label;
      const items = sectionItems(sec);
      const all = [...items.arcs, ...items.webs];
      const loading = !S.ready && !!d.web;
      countEl.textContent = loading ? '' : plural(all.length, 'game');

      const facts = [];
      if (items.arcs.length) facts.push(fact('zap', plural(items.arcs.length, 'built-in game')));
      if (items.webs.length) facts.push(fact('globe', plural(items.webs.length, 'web game')));
      content.appendChild(hero(sec, items.arcs, items.webs, heroActs(sec), facts));

      if (sec === 'controller') content.appendChild(bridgeCard());
      if (S.loadFailed && d.web) {
        content.appendChild(h('p.mp-banner', icon('alert'), h('span', { text: 'The full games catalogue didn’t load, so only the built-in shelf is listed. Reopen this app to try again.' })));
      }

      if (!all.length) {
        if (loading) content.appendChild(loadingRow('Loading the games catalogue…'));
        else {
          const [t, x] = copy.empty || ['Nothing here yet', 'Nothing in the catalogue matches this section.'];
          content.appendChild(empty(meta.icon, t, x,
            sec === 'party' ? btn('Open Static Party', 'sparkles', () => openOther('party', 'Static Party'), true) : null,
            sec === 'coop' ? btn('Browse 2 Player games', 'users', () => go('two'), true) : null,
            sec === 'team' ? btn('Browse Online Multiplayer', 'globe', () => go('online'), true) : null,
            sec !== 'party' ? btn('Start a party', 'sparkles', () => openOther('party', 'Static Party')) : btn('Browse 2 Player games', 'users', () => go('two'))));
        }
        content.appendChild(footNote(sec));
        return;
      }

      /* the filter bar stays; only the list under it re-renders */
      const list = h('div.mp-listhost');
      const paintList = () => {
        if (dead) return;
        clear(list);
        const focus = S.device !== 'any' ? S.device : d.device || 'any';
        const fl = applyFilters(items, focus);
        const n = fl.arcs.length + fl.webs.length;
        countEl.textContent = loading ? '' : n === all.length ? plural(all.length, 'game') : `${n.toLocaleString()} of ${plural(all.length, 'game')}`;
        if (n) list.appendChild(listBlock(fl, sec, focus));
        else if (!loading) {
          list.appendChild(empty('filter', 'Nothing matches these filters', 'Try another device or type.',
            btn('Clear filters', 'x', () => {
              S.device = 'any'; S.type = 'all'; S.listedOnly = false; S.limit = PAGE;
              save({ device: 'any' });
              bar.sync(); paintList();
              bar.first.focus({ preventScroll: true });
            }, true)));
        }
        if (loading) list.appendChild(loadingRow('Loading the games catalogue…'));
      };
      const bar = filterBar(all, items.webs.length > 0, paintList);
      content.appendChild(h('div.mp-host', bar.el, list));
      paintList();

      if (sec === 'controller') {
        content.appendChild(h('p.mp-banner.mp-banner--soft', icon('info'), h('span', { text: 'Web games aren’t listed here: they run on other websites, where the key bridge can’t reach. Whether one works with a controller is up to the game itself.' })));
        if (NO_BRIDGE.typing && arcadeById('typing')) content.appendChild(h('p.mp-banner.mp-banner--soft', icon('keyboard'), h('span', { text: NO_BRIDGE.typing })));
      }
      content.appendChild(footNote(sec));
    }

    function footNote(sec) {
      const lines = ['No player counts anywhere: StaticOS has no server that could count players, and it doesn’t make numbers up.'];
      if (sec !== 'controller' && sec !== 'friends') lines.unshift('A game is listed because its own catalogue tags or categories say so, or because it is built into the Arcade.');
      return h('div.mp-foot', lines.map(t => h('p', { text: t })));
    }

    function bridgeNoteText(on) {
      const secure = typeof window.isSecureContext !== 'boolean' || window.isSecureContext;
      const pads = typeof navigator.getGamepads === 'function';
      return !secure ? 'Browsers only share controllers with https pages, so the key bridge can’t run on this page.'
        : !pads ? 'This browser can’t read controllers, so the key bridge can’t run here.'
          : on ? 'On. Start a game below, then press any button on your controller so the browser shows it to StaticOS.'
            : 'Off. Switch it on to play the games below with a gamepad.';
    }

    function bridgeCard() {
      V.bridgeNote = h('small');
      V.bridgeSw = h('button.switch', {
        type: 'button', role: 'switch', 'aria-label': 'Play keyboard games with a controller',
        onclick: () => { padmap.setEnabled(!padmap.isEnabled()); syncBridge(); },
      });
      syncBridge();
      return h('section.mp-card.mp-bridge',
        h('span.mp-card__ic', icon('gamepad')),
        h('div.grow.mp-card__b', h('b', { text: 'Play keyboard games with a controller' }), V.bridgeNote),
        h('div.mp-card__c', V.bridgeSw,
          btn('Button mapping', 'sliders', () => openOther('controller', 'Controller Center', { tab: 'map' }))));
    }
    function syncBridge() {
      if (!V.bridgeSw) return;
      const on = padmap.isEnabled();
      V.bridgeSw.classList.toggle('is-on', on);
      V.bridgeSw.setAttribute('aria-checked', String(on));
      V.bridgeNote.textContent = bridgeNoteText(on);
    }

    /* ---------- Games With Friends ---------- */
    const liveState = () => { const st = live.status(); return st === 'connecting' && everOffline ? 'offline' : st; };

    function updateLive() {
      const running = presence.running();
      const st = running ? liveState() : 'idle';
      livePill.className = `mp-live is-${st}`;
      const text = running ? LIVE_TEXT[st] || st : 'Live channel off';
      livePill.title = text;
      clear(livePill).append(h('i.mp-live__dot', { 'aria-hidden': 'true' }), h('span', { text }));
    }

    function renderMe() {
      if (!V.meBox) return;
      const m = me();
      const on = sharing();
      V.shareSw = h('button.switch', {
        type: 'button', role: 'switch', class: on ? 'is-on' : null, 'aria-checked': String(on), 'aria-label': 'Share what I’m playing',
        onclick: e => { e.preventDefault(); setSharing(!sharing()); syncShare(); },
      });
      clear(V.meBox).appendChild(h('section.mp-card.mp-me',
        avatar(m.name, m.color),
        h('div.grow.mp-card__b',
          h('b', { text: `You appear as ${m.name}` }),
          h('small', { text: m.status === 'invisible'
            ? 'You’re invisible: nobody here can see you, but you can still see them.'
            : `Shown as ${STATUS_WORD[m.status] || 'Online'} to everyone on the live channel. Names aren’t verified — anyone can call themselves anything.` })),
        h('label.mp-me__share',
          h('span', h('b', { text: 'Share what I’m playing' }), h('small', { text: 'The title of the last game you opened' })),
          V.shareSw)));
    }
    function syncShare() {
      if (!V.shareSw) return;
      const on = sharing();
      V.shareSw.classList.toggle('is-on', on);
      V.shareSw.setAttribute('aria-checked', String(on));
    }

    /** The hero's art is the real people online (up to three), else the icon. */
    function heroPeople(people) {
      const art = V.heroArt;
      if (!art) return;
      clear(art);
      if (!people.length) {
        art.dataset.n = '1';
        art.appendChild(h('div.mp-hc.mp-hc--icon', icon(secMeta('friends').icon)));
        return;
      }
      art.dataset.n = String(Math.min(3, people.length));
      people.slice(0, 3).forEach(p => art.appendChild(h('div.mp-hc.mp-hc--av', { style: { '--av': String(hueOf(p.color)) } }, h('span', { text: initialOf(p.name) }))));
    }

    function personRow(p, hidden) {
      const it = p.playing ? resolveTitle(p.playing) : null;
      const game = !p.playing ? 'Not sharing a game right now'
        : it || !S.ready ? `Playing ${p.playing}`
          : `Playing ${p.playing} — not a game in this catalogue`;
      return h('li.mp-person', { dataset: { peer: p.id } },
        avatar(p.name, p.color),
        h('div.grow.mp-person__b',
          h('div.mp-person__n', h('b', { text: p.name }),
            h('span.mp-status', { class: `is-${p.status}` }, h('i', { 'aria-hidden': 'true' }), h('span', { text: STATUS_WORD[p.status] || 'Online' }))),
          h('small.mp-person__g', { text: game })),
        h('div.mp-person__acts',
          hidden ? btn('Show again', 'eye', () => unhide(p.id), false, `Show ${p.name} again`, `show:${p.id}`)
            : [it ? btn('Play the same game', 'play', () => play(resolveTitle(p.playing)), true, `Play ${it.title}, the game ${p.name} is playing`, `same:${p.id}`) : null,
              h('button.btn.btn--sm.btn--ghost', {
                type: 'button', title: 'Hide this person on this device', 'aria-label': `Hide ${p.name} on this device`,
                dataset: { fk: `hide:${p.id}` }, onclick: () => hide(p),
              }, icon('x'), h('span', { text: 'Hide' }))]));
    }

    /** People online, with what we show of them made display-safe. */
    const peers = () => presence.online().map(p => ({
      ...p,
      name: safe(p.name, 24) || `Player-${String(p.id).slice(0, 4)}`,
      playing: safe(p.playing, 60) || null,
    }));

    function renderPeople(force) {
      if (dead || S.q || S.sec !== 'friends') return;
      const all = peers();
      const hid = new Set(hiddenIds());
      const running = presence.running();
      const st = liveState();
      const sig = JSON.stringify([all.map(p => [p.id, p.name, p.color, p.status, p.playing]), [...hid], S.showHidden, S.ready, st, running]);
      if (!force && sig === peopleSig) return;
      peopleSig = sig;
      const shown = all.filter(p => !hid.has(p.id));
      const hiddenHere = all.filter(p => hid.has(p.id));

      /* keep focus on the same control across a rebuild */
      const ae = document.activeElement;
      const fk = ae && ae !== friendsDyn && friendsDyn.contains(ae) ? (ae.dataset && ae.dataset.fk) || '' : null;

      /* games being played right now, by the people shown */
      const games = new Map();
      for (const p of shown) {
        const it = p.playing ? resolveTitle(p.playing) : null;
        if (!it) continue;
        const k = `${it.kind}:${it.id}`;
        if (!games.has(k)) games.set(k, { it, names: [] });
        games.get(k).names.push(p.name);
      }

      clear(friendsDyn);
      friendsDyn.append(groupHead('Being played right now', 'Shared by people online. Titles and names come from their devices and aren’t verified.', 'activity'));
      if (games.size) {
        friendsDyn.append(grid([...games.values()].map(({ it, names }) => tile(it, { same: true, who: namesLine(names), fk: `game:${it.kind}:${it.id}` })), 'Games being played right now'));
      } else {
        friendsDyn.append(h('p.mp-quiet', { text: shown.length
          ? 'Nobody online is sharing a game from this catalogue right now.'
          : 'When people online share what they’re playing, those games appear here.' }));
      }

      friendsDyn.append(groupHead('People online', 'Everyone whose device said hello on the live channel in the last minute.', 'users'));
      if (shown.length) friendsDyn.append(h('ul.mp-people', { 'aria-label': 'People online' }, shown.map(p => personRow(p, false))));
      else if (!running || st === 'idle' || st === 'connecting') {
        friendsDyn.append(loadingRow('Connecting to the live channel…'));
      } else if (st === 'offline') {
        friendsDyn.append(empty('wifi-off', 'Can’t reach the live channel', 'This network may block it. StaticOS keeps trying in the background while this is open.'));
      } else {
        friendsDyn.append(empty('users', 'Nobody else is here right now',
          'People show up while StaticOS is open on their device with a live app running — like this one, Static Social or Static Party.',
          btn('Start a party', 'sparkles', () => openOther('party', 'Static Party'), true),
          btn('Find players', 'search', () => openOther('social', 'Static Social'))));
      }

      if (hid.size) {
        const box = h('div.mp-hidden',
          h('button.mp-link', {
            type: 'button', 'aria-expanded': String(S.showHidden), dataset: { fk: 'hidden-toggle' },
            onclick: () => { S.showHidden = !S.showHidden; renderPeople(true); },
          }, icon(S.showHidden ? 'chevron-down' : 'chevron-right'), h('span', { text: `People you’ve hidden on this device (${hid.size})` })));
        if (S.showHidden) {
          box.append(hiddenHere.length ? h('ul.mp-people.mp-people--hidden', { 'aria-label': 'People you’ve hidden' }, hiddenHere.map(p => personRow(p, true)))
            : h('p.mp-quiet', { text: 'None of them are online right now.' }),
          btn('Show everyone again', 'eye', () => { save({ hidden: [] }); renderPeople(true); }, false, null, 'unhide-all'));
        }
        friendsDyn.append(box);
      }

      heroPeople(shown);

      if (fk !== null) {
        const back = (fk && friendsDyn.querySelector(`[data-fk="${cssEsc(fk)}"]`))
          || friendsDyn.querySelector('[data-fk="hidden-toggle"]')
          || friendsDyn.querySelector('.mp-people button')
          || friendsDyn;
        back.focus({ preventScroll: true });
      }
    }

    function renderShelf() {
      if (!V.shelf) return;
      const out = [];
      const seen = new Set();
      for (const r of plays.recent(80)) {
        if (out.length >= 8) break;
        const k = `${r.kind}:${r.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (r.kind === 'arcade') { const a = arcadeById(r.id); if (a && a.players.includes(2)) out.push(arcItem(a)); }
        else if (r.kind === 'web' && S.ready) { const g = catalogue.byId(r.id); if (g && isMulti(g)) out.push(webItem(g)); }
      }
      clear(V.shelf).append(
        groupHead('Your multiplayer games', 'The two-player and online games played on this device, most recent first.', 'clock'),
        out.length ? grid(out.map(it => tile(it)), 'Your multiplayer games')
          : h('p.mp-quiet', { text: S.ready ? 'Nothing multiplayer has been played on this device yet.' : 'Loading…' }));
    }

    function honestyBlock() {
      const pts = [
        ['globe', 'Public live channel — anyone can read it'],
        ['user', 'No accounts'],
        ['alert', 'Names are not verified'],
        ['clock', 'No message history'],
        ['database', 'Nothing is stored on a server'],
      ];
      return h('aside.mp-honest', { 'aria-label': 'About the live channel' },
        h('ul.mp-honest__l', pts.map(([ic, t]) => h('li', icon(ic), h('span', { text: t })))),
        h('p', { text: '“Play the same game” opens that game on this computer. It doesn’t connect you to the other person or put you in their match — for that, start a party or find players.' }),
        h('p', { text: 'Only people online at this moment are listed. Hiding someone is remembered on this device only.' }));
    }

    function paintFriends() {
      titleEl.textContent = secMeta('friends').label;
      countEl.textContent = '';
      ensurePresence();
      barExtra.appendChild(livePill);
      updateLive();
      const heroEl = hero('friends', [], [], [
        btn('Start a party', 'sparkles', () => openOther('party', 'Static Party'), true),
        btn('Find players', 'search', () => openOther('social', 'Static Social')),
      ], []);
      V.heroArt = heroEl.querySelector('.mp-hero__art');
      V.meBox = h('div.mp-mebox');
      renderMe();
      V.shelf = h('section.mp-shelf');
      renderShelf();
      content.append(heroEl, V.meBox, friendsDyn, honestyBlock(), V.shelf);
      peopleSig = '';
      renderPeople(true);
    }

    /* ---------- search ---------- */
    function paintSearch() {
      titleEl.textContent = 'Search';
      const q = low(S.q);
      const hits = universe().filter(it => low(it.title).includes(q) || (it.kind === 'web' ? [...tagsOf(it.g)].some(t => t.includes(q)) : it.a.tags.some(t => t.includes(q))));
      const arcs = hits.filter(it => it.kind === 'arcade'), webs = hits.filter(it => it.kind === 'web');
      countEl.textContent = `${plural(hits.length, 'result')} for “${S.q}”`;
      if (!S.ready) content.appendChild(loadingRow('Loading the games catalogue…'));
      if (!hits.length) {
        if (S.ready) {
          content.appendChild(empty('search', 'No multiplayer games match', `Nothing here matches “${S.q}”. This searches the multiplayer games only — Static Games has the whole catalogue.`,
            btn('Clear search', 'x', () => { clearQ(); paint(true); search.focus(); }, true)));
        }
        return;
      }
      content.appendChild(listBlock({ arcs, webs }, 'search', 'any'));
    }

    /* ============== navigation + paint ============== */
    function clearQ() { if (S.q || search.value) { S.q = ''; search.value = ''; } }
    function setSec(c) {
      S.sec = c; S.limit = PAGE; S.showHidden = false;
      clearQ();
      save({ section: c });
      paint(true);
    }
    function go(sec) {
      const c = secOf(sec);
      if (!c || (c === S.sec && !S.q)) return;
      /* leaving a search for the section it was over isn't a new place */
      if (c !== S.sec) { S.back.push(S.sec); S.fwd.length = 0; }
      setSec(c);
    }
    function goBack() { if (S.back.length) { S.fwd.push(S.sec); setSec(S.back.pop()); } }
    function goFwd() { if (S.fwd.length) { S.back.push(S.sec); setSec(S.fwd.pop()); } }

    /* the sidebar is built once and only its state changes, so the item
       you just pressed keeps focus */
    const sideItems = new Map();
    const sideDot = h('i.mp-side__dot', { 'aria-hidden': 'true', hidden: true });
    const meterB = h('b'), meterS = h('small');
    (function buildSide() {
      let group = null, last = '';
      for (const s of SECTIONS) {
        if (s.group !== last) {
          last = s.group;
          group = h('div.side__group', h('div.side__label', { text: s.group }));
          side.appendChild(group);
        }
        const item = h('button.side__item', { type: 'button', dataset: { sec: s.id }, onclick: () => go(s.id) },
          icon(s.icon), h('span', { text: s.label }), s.id === 'friends' ? sideDot : null);
        sideItems.set(s.id, item);
        group.appendChild(item);
      }
      side.appendChild(h('div.side__group.mp-side__foot', h('div.side__meter', meterB, meterS)));
    }());

    /* in a narrow desktop window the sidebar folds to icons (a container
       query in the stylesheet); the names then come back as tooltips */
    let folded = null;
    function foldSide() {
      if (dead) return;
      const on = !document.body.classList.contains('is-mobile') && root.clientWidth > 0 && root.clientWidth <= 640;
      if (on === folded) return;
      folded = on;
      for (const [id, el] of sideItems) {
        if (on) el.title = secMeta(id).label; else el.removeAttribute('title');
      }
    }
    win.onResize(foldSide);

    function syncSide() {
      for (const [id, el] of sideItems) {
        const on = id === S.sec && !S.q;
        el.classList.toggle('is-on', on);
        if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      }
      const running = presence.running();
      const st = liveState();
      sideDot.hidden = !running;
      sideDot.className = `mp-side__dot is-${st}`;
      meterB.textContent = running ? `Live channel: ${LIVE_SHORT[st] || st}` : 'Live channel: off';
      meterS.textContent = running ? 'Public. Names aren’t verified.' : 'Games With Friends turns it on.';
    }

    function paint(resetScroll) {
      if (dead) return;
      const keep = resetScroll ? 0 : content.scrollTop;
      clear(content);
      clear(barExtra);
      V.shareSw = V.bridgeSw = V.bridgeNote = V.meBox = V.shelf = V.heroArt = null;
      if (S.q) paintSearch();
      else if (S.sec === 'friends') paintFriends();
      else paintSection();
      syncSide();
      btnBack.disabled = !S.back.length;
      btnFwd.disabled = !S.fwd.length;
      win.setSubtitle(S.q ? 'Search' : secMeta(S.sec).label);
      content.scrollTop = keep;
    }
    const onFriends = () => !dead && S.sec === 'friends' && !S.q;

    /* ============== start ============== */
    paint(true);
    foldSide();
    catalogue.load()
      .catch(() => null)
      .then(() => {
        if (dead) return;
        S.ready = true;
        S.loadFailed = !!catalogue.loadError();
        memo.clear();
        titleIdx = null;
        paint();
      });

    win.onReopen(o => {
      if (dead || !o) return;
      const c = secOf(o.section);
      if (typeof o.q === 'string' && o.q.trim()) {
        S.q = o.q.trim().slice(0, 80); search.value = S.q; S.limit = PAGE;
        if (c) S.sec = c;
        paint(true);
      } else if (c) go(c);
    });

    /* live status + people */
    offs.push(live.onStatus(st => {
      if (dead) return;
      if (st === 'offline') everOffline = true;
      else if (st === 'live') everOffline = false;
      updateLive();
      syncSide();
      if (onFriends()) renderPeople();
    }));
    offs.push(presence.onChange(() => {
      if (!onFriends()) return;
      /* a heartbeat from anyone emits; coalesce to one render a frame, and
         renderPeople itself skips the DOM when nothing visible changed */
      if (!queuedPeople) {
        queuedPeople = requestAnimationFrame(() => {
          queuedPeople = 0;
          if (!onFriends()) return;
          /* another app switched presence off while this view needs it */
          if (!presence.running()) { ensurePresence(); updateLive(); syncSide(); }
          renderPeople();
        });
      }
    }));

    /* things shown here that other windows can change — each updates its
       own element, never the whole page */
    offs.push(store.sub(K_FAV, () => {
      const favs = new Set(favIds());
      content.querySelectorAll('.mp-tile[data-kind="web"]').forEach(el => el.classList.toggle('is-fav', favs.has(el.dataset.id)));
    }));
    offs.push(store.sub('portal.controller', () => { if (!dead) syncBridge(); }));
    offs.push(store.sub('portal.identity', () => { if (onFriends()) renderMe(); }));
    offs.push(store.sub('session.user', () => { if (onFriends()) renderMe(); }));
    let lastShare = sharing();
    offs.push(store.sub('prefs', () => {
      const now = sharing();
      if (now !== lastShare) { lastShare = now; if (!dead) syncShare(); }
    }));
    offs.push(bus.on('game:launch', () => { if (onFriends()) renderShelf(); }));

    return () => {
      dead = true;
      cancelAnimationFrame(queuedPeople);
      clearTimeout(nudgeT);
      offs.forEach(f => { try { f?.(); } catch (e) { /* already gone */ } });
      offs.length = 0;
      /* presence keeps running on purpose: Social and Party share it */
    };
  },
});
