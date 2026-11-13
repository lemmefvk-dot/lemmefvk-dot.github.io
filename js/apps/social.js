/* ============================================================
   social.js — Static Social, the live message hub.

   A native three-pane messenger for talking about the multiplayer
   games in the catalogue and finding people to play them with: a
   rail of rooms on the left (the Lobby, Looking for players, your
   direct messages, and one room for each of twelve multiplayer
   games taken in the catalogue's own order — see pickRooms: the
   catalogue's play counts are stand-ins, so nothing is ranked by
   them), the conversation in the middle, and who is online on the
   right, over a status bar that says what the live channel is
   really doing. A narrow window (or a phone) folds the rail and
   the people list into drawers.

   It runs on StaticOS's one live connection (js/portal/live.js):
   MQTT over a free PUBLIC broker. That has consequences the app
   states plainly instead of hiding:

     · anyone can read or post on any topic and there are no
       accounts — names are whatever people typed (identity.js);
     · delivery is live-only, so there is NO history. A room shows
       what arrived while Social was open this session — the last
       150 per room, kept in memory at module level so switching
       rooms or closing and reopening the window keeps them — and
       nothing is stored on a server;
     · direct messages travel the same public channel, so they are
       not private, and the DM view says so;
     · a locked-down network may block the broker; the status bar
       then says Offline instead of pretending.

   Topics (live.js adds the staticos/v1/ prefix):
     hub/<room>    { id, name, color, text, at, mid }        room chat
     lfp           { id, name, color, game:{kind,id,title},
                     text, partyCode?, at, mid }            posts
     dm/<userId>   { id, name, color, text, at, mid, to,
                     partyCode? }                           DMs
   `id` is the sender's identity id; `mid` is a random message id
   used only to drop duplicates (a broker echoes your own posts).

   Everything that arrives is untrusted: size-capped, parsed in
   try/catch, every field bounded (identity.clean / tidy, plus bidi
   and zero-width characters stripped), flood-limited per sender and
   rendered only as text. Nothing opens because a message said so: a
   game opens only when you click Play, and only if its id really is
   in this catalogue or the Arcade. Your own sending is rate-limited
   (one message a second, ten per thirty seconds).

   Looking-for-players posts live for 15 minutes. With no history, a
   post would only ever reach people already here, so your own post
   is re-shared once a minute while Social is open — never past its
   15 minutes. Stars and mutes are local lists on this device.

   Presence (who is online) is started by the first public view and
   never stopped by Social — Party and others share it. So someone you
   starred coming online raises one quiet notification per session even after the
   window closes: that single presence listener, added once per
   session (not per window), is the only thing Social leaves running.

   Who is online, and what they have open, is presence.js: a device
   that said hello in the last minute, plus the title its last
   launch recorded. Nothing tells presence when a game is closed
   again, so that title is shown as "Last launched …" — never as
   proof that someone is playing right now.

   opts: { room } · { dm } · { lfp, game } · { share } — the last
   from the share sheet's "Share to chat" (js/shell/share.js),
   which writes a draft into the composer of the room the thing
   belongs to. Social never posts anything for you.

   FRIENDS (the first item in the rail) is different from all of the
   above: private. js/apps/social-friends.js draws it and
   js/core/friends.js runs it — friends added only by a code both
   people pass on, presence and status encrypted for each friend, and
   game nights. Social starts public presence only when a public view
   (a room, a DM, Looking for players) is shown, so opening straight
   to Friends announces nothing on the public channel. The public
   "Add friend" here became Star — a local marker, not a friendship.

   js/portal/party.js is optional: it is imported lazily, once, and
   every party feature hides when it is not there. "Join party" calls
   party.join(code) and brings the Party window up at once — it shows
   the join in progress — and a notification says why if it fails.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as live from '../portal/live.js';
import * as presence from '../portal/presence.js';
import * as identity from '../core/identity.js';
import * as CAT from '../portal/games.data.js';
import { ARCADE, arcadeById } from '../arcade/index.js';
import * as plays from '../core/plays.js';
import { measured } from '../core/quickplay.js';   /* are a row's play counts real? */
import * as POLL from '../core/polls.js';
import { pollCard, pollForm } from './pollcard.js';
import { friendsView } from './social-friends.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-social-css')) {
  const l = document.createElement('link');
  l.id = 'feat-social-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-social.css';
  document.head.appendChild(l);
}

/* ---------------- tuning ---------------- */
const ROOM_COUNT = 12;
const MAX_LOG = 150;               /* per room or DM, oldest dropped */
const MAX_TEXT = 500;
const MAX_NOTE = 140;
const MAX_LINES = 14;
const MAX_PAYLOAD = 8000;          /* longest raw message we will even parse */
const GROUP_MS = 5 * 60_000;       /* same sender within this = one group */
const LFP_TTL = 15 * 60_000;
const LFP_RESHARE = 60_000;
const MAX_POSTS = 60;
const POSTS_PER_PERSON = 3;
const MAX_DM_PEERS = 40;
const MAX_EXTRA_ROOMS = 6;
const SEND_GAP = 1000, SEND_SPAN = 30_000, SEND_MAX = 10;
const FLOOD_SPAN = 10_000, FLOOD_MAX = 12;
const DM_NOTE_GAP = 12_000;        /* per sender */
const DM_NOTE_ANY = 3000;          /* across everyone: many fake senders can't flood the toasts */
const FRIEND_QUIET = 5000;
const TICK_MS = 15_000;

const K_FRIENDS = 'portal.social.friends';   /* [{ id, name }] */
const K_MUTED = 'portal.social.muted';       /* [{ id, name }] */

const ID_RE = /^[a-z0-9]{8,32}$/;
const MID_RE = /^[a-z0-9]{6,24}$/;
const GAME_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/;

const STATUS_TEXT = { online: 'Online', away: 'Away', busy: 'Busy', invisible: 'Invisible' };
const LIVE_TEXT = {
  idle: 'Not connected yet',
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Offline — this network may block the live channel',
};
const NO_HISTORY = 'Only messages sent while you’re here show up — there’s no history, and nothing is stored on a server.';
const FOOT_NOTE = 'Public live channel · no accounts · names aren’t verified · no message history · nothing stored on a server';
const FOOT_SHORT = 'Public · no accounts · names unverified · no history';
const HUES = [0, 22, 42, 88, 140, 168, 192, 212, 238, 262, 290, 322];

/* ---------------- text that is safe to keep ---------------- */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;   /* direction overrides: spoofing */
const INVIS = /[\u00ad\u200b\u2060\ufeff]/g;                     /* invisible; ZWJ/ZWNJ kept for emoji and scripts */

const safeName = (s, n = 24) => identity.tidy(String(s ?? '').replace(BIDI, '').replace(INVIS, ''), n);

/** A message body: controls (bar newline) and direction tricks removed,
    at most MAX_LINES lines and `n` characters. Rendered only as text. */
function cleanText(s, n = MAX_TEXT) {
  if (s === null || s === undefined || typeof s === 'object') return '';
  let t = String(s).slice(0, MAX_PAYLOAD)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, '')
    .replace(/\t/g, ' ')
    .replace(BIDI, '').replace(INVIS, '')
    .replace(/\n{3,}/g, '\n\n');
  const lines = t.split('\n');
  if (lines.length > MAX_LINES) t = `${lines.slice(0, MAX_LINES).join('\n')} ${lines.slice(MAX_LINES).join(' ')}`;
  t = t.trim();
  const cps = Array.from(t);
  return cps.length > n ? cps.slice(0, n).join('').trim() : t;
}
const oneLine = (s, n) => cleanText(s, n).replace(/\s*\n\s*/g, ' ');
const gTitle = g => identity.tidy(g.title, 80) || g.id;

function rid(n = 12) {
  const a = new Uint8Array(n);
  try { globalThis.crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); }
  let s = '';
  for (const b of a) s += (b % 36).toString(36);
  return s;
}

const fnv = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };

/** Procedural cover for a game with no art (or art that fails to load). */
function artBg(title) {
  const x = fnv(String(title));
  const a = x % 360;
  const b = (a + 40 + (x >> 8) % 90) % 360;
  return `radial-gradient(70% 60% at 30% 25%,hsl(${b} 62% 58% / .8),transparent 62%),linear-gradient(${120 + (x >> 4) % 90}deg,hsl(${a} 55% 30%),hsl(${(a + 320) % 360} 48% 12%))`;
}
const initials = t => (String(t).match(/[A-Za-z0-9]+/g) || ['?']).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/* ---------------- what counts as a multiplayer room ---------------- */
/* Every signal the brief lists counts, but the catalogue's '.io Games'
   and 'Online' tags are also stuck on plenty of one-player puzzles
   (a brick breaker, a line-drawing game…), so those two only fill in
   if the clearer signals can't supply twelve rooms. */
const MP_STRONG = new Set(['multiplayer', '2 player', '2 player games']);
const MP_WEAK = new Set(['.io games', 'online']);
function mpLevel(g) {
  const cats = (g.cats || []).map(c => String(c).toLowerCase());
  const tags = (g.tags || []).map(t => String(t).toLowerCase());
  if (cats.includes('2player') || cats.includes('io') || tags.some(t => MP_STRONG.has(t))) return 2;
  if (tags.some(t => MP_WEAK.has(t))) return 1;
  return 0;
}

/* ---------------- incoming, validated ---------------- */
function parseBase(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_PAYLOAD) return null;
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const who = identity.clean(raw);
  if (!who) return null;
  who.name = safeName(who.name) || `Player-${who.id.slice(0, 4)}`;
  const mid = typeof raw.mid === 'string' && MID_RE.test(raw.mid) ? raw.mid : null;
  const at = Number.isFinite(raw.at) ? Math.round(raw.at) : 0;
  return { raw, who, mid, at };
}
const codeOf = c => (typeof c === 'string' && CODE_RE.test(c) ? c : null);

function chatFrom(p) {
  const body = cleanText(p.raw.text);
  if (!body) return null;
  return {
    seen: p.mid ? `m:${p.mid}` : `a:${p.who.id}:${p.at}:${fnv(body)}`,
    mid: p.mid, from: p.who.id, name: p.who.name, color: p.who.color,
    text: body, at: Date.now(), partyCode: null,            /* our clock, not the sender's claim */
  };
}
const parseChat = text => { const p = parseBase(text); return p ? chatFrom(p) : null; };

function parseDm(text, myId) {
  const p = parseBase(text);
  if (!p || (p.raw.to !== undefined && p.raw.to !== myId)) return null;
  const m = chatFrom(p);
  if (m) m.partyCode = codeOf(p.raw.partyCode);
  return m;
}

function parsePost(text) {
  const p = parseBase(text);
  if (!p) return null;
  const key = p.mid ? `m:${p.mid}` : `a:${p.who.id}:${p.at}`;
  if (p.raw.gone) return { gone: true, key, from: p.who.id };
  const now = Date.now();
  if (!p.at || p.at < now - LFP_TTL || p.at > now + 2 * 60_000) return null;
  const g = p.raw.game;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const kind = g.kind === 'arcade' ? 'arcade' : g.kind === 'web' ? 'web' : null;
  const id = typeof g.id === 'string' && GAME_ID_RE.test(g.id) ? g.id : null;
  if (!kind || !id) return null;
  return {
    key, from: p.who.id, name: p.who.name, color: p.who.color,
    game: { kind, id, title: safeName(g.title, 80) || id },
    text: oneLine(p.raw.text, MAX_NOTE),
    partyCode: codeOf(p.raw.partyCode),
    at: Math.min(p.at, now), seen: now,
  };
}
const expiresAt = p => Math.min(p.at, p.seen) + LFP_TTL;

/* ---------------- the session: survives closing the window ---------------- */
const S = {
  logs: new Map(),          /* viewKey -> [message]  (viewKey: lobby | g:<gameId> | dm:<peerId>) */
  unread: new Map(),        /* viewKey -> count */
  seen: new Set(), seenQ: [],
  dms: new Map(),           /* peerId -> { id, name, color, last } */
  posts: new Map(),         /* key -> someone else's live post */
  polls: new Map(),         /* `${viewKey}|${pid}` -> poll state (js/core/polls.js) */
  myPost: null,
  drafts: new Map(),
  view: 'lobby',
  extra: [],                /* game rooms opened by id this session, beyond the twelve */
  friendSeen: new Set(),    /* friends already announced this session */
  sent: [],                 /* my recent send times, for the rate limit */
  flood: new Map(),         /* senderId -> recent arrival times */
  dmNoted: new Map(),       /* senderId -> last DM notification */
  dmNoteAt: 0,              /* last DM notification from anyone */
  seq: 0,
  lfpPick: null,            /* the game last picked in the post form */
  formOpen: false,
};
let ROOMS = null;           /* the twelve game ids, chosen once per session */
let partyP = null;          /* js/portal/party.js, imported once */

function firstSight(k) {
  if (S.seen.has(k)) return false;
  S.seen.add(k);
  S.seenQ.push(k);
  if (S.seenQ.length > 4000) S.seen.delete(S.seenQ.shift());
  return true;
}

/** Drop a sender who is flooding the channel (per sender, all topics). */
function flooded(from) {
  const now = Date.now();
  let q = S.flood.get(from);
  if (!q) {
    if (S.flood.size > 400) S.flood.clear();
    q = [];
    S.flood.set(from, q);
  }
  while (q.length && now - q[0] > FLOOD_SPAN) q.shift();
  if (q.length >= FLOOD_MAX) return true;
  q.push(now);
  return false;
}

/** My own sending: one a second, ten per thirty seconds. */
function sendBudget() {
  const now = Date.now();
  S.sent = S.sent.filter(t => now - t < SEND_SPAN);
  const last = S.sent[S.sent.length - 1] || 0;
  if (now - last < SEND_GAP) return { ok: false, wait: SEND_GAP - (now - last) };
  if (S.sent.length >= SEND_MAX) return { ok: false, wait: SEND_SPAN - (now - S.sent[0]) };
  return { ok: true };
}

/* Which twelve games get a room.

   The brief said "the most-played" — but the catalogue's play counts are
   stand-ins written by the sync script (quickplay.measured() is false for
   every row today), so ranking by them would be inventing an order and
   calling it popularity. Rooms are therefore taken in the catalogue's own
   order, strongest multiplayer signal first, and only really-measured
   counts are allowed to reorder them. A sync with real numbers turns that
   on with no change here. Nothing on screen claims a number either way. */
function pickRooms() {
  if (ROOMS) return ROOMS;
  const rows = CAT.query({ sort: 'catalogue', perPage: 100000 }).items;
  const out = [];
  const titles = new Set();
  for (const level of [2, 1]) {
    for (const g of rows) {
      if (out.length >= ROOM_COUNT) break;
      if (mpLevel(g) !== level || !GAME_ID_RE.test(g.id) || g.id === 'lobby') continue;
      const t = String(g.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (titles.has(t)) continue;
      titles.add(t);
      out.push(g);
    }
  }
  const real = g => (measured(g) ? g.plays : -1);
  if (out.some(g => real(g) >= 0)) out.sort((a, b) => real(b) - real(a) || a.order - b.order);
  ROOMS = out.map(g => g.id);
  return ROOMS;
}

/** The optional Party module, adapted to the few calls Social needs. */
function loadParty() {
  if (!partyP) {
    partyP = import('../portal/party.js').then(m => {
      const src = m && typeof m.current === 'function' ? m : m && m.default;
      if (!src || typeof src.current !== 'function' || typeof src.join !== 'function') return null;
      const onChange = typeof src.onChange === 'function' ? src.onChange : typeof src.subscribe === 'function' ? src.subscribe : null;
      const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
      return {
        code: () => safe(() => {
          const p = src.current();
          if (!p) return null;
          return codeOf(typeof p === 'string' ? p : (p.code ?? p.id ?? null));
        }, null),
        join: code => src.join(code),
        joining: () => safe(() => (typeof src.joining === 'function' ? src.joining() : null), null),
        inviteText: () => safe(() => (typeof src.inviteText === 'function' ? oneLine(src.inviteText(), 200) : ''), ''),
        lastError: () => safe(() => (typeof src.lastError === 'function' ? src.lastError() : null), null),
        onChange: onChange ? fn => safe(() => { const off = onChange.call(src, fn); return typeof off === 'function' ? off : () => {}; }, () => {}) : null,
      };
    }).catch(() => null);
  }
  return partyP;
}

/* ---------------- friends coming online (module level, see header) ---------------- */
const FW = { api: null, off: null, openedAt: 0, focused: () => false };
const listOf = (store, k) => {
  const v = store.get(k);
  return Array.isArray(v) ? v.filter(x => x && typeof x.id === 'string' && ID_RE.test(x.id)) : [];
};
function watchFriends(api) {
  FW.api = api;
  if (FW.off) return;
  FW.off = presence.onChange(list => {
    const a = FW.api;
    if (!a || !Array.isArray(list)) return;
    const fr = listOf(a.store, K_FRIENDS);
    if (!fr.length) return;
    const on = new Map(list.map(p => [p.id, p]));
    const muted = new Set(listOf(a.store, K_MUTED).map(x => x.id));
    for (const f of fr) {
      const p = on.get(f.id);
      if (!p || S.friendSeen.has(f.id)) continue;
      S.friendSeen.add(f.id);                            /* once per session */
      if (muted.has(f.id)) continue;
      /* right after Social opens they are in plain sight in Online now */
      if (FW.focused() && Date.now() - FW.openedAt < FRIEND_QUIET) continue;
      const id = f.id;
      a.notify({
        app: 'social', icon: 'users', timeout: 3500, key: `social-friend-${id}`,
        title: `${safeName(p.name) || safeName(f.name) || 'Someone you starred'} is online`,
        message: 'Someone you starred on this device.',
        onClick: () => a.openApp('social', { dm: id }),
      });
    }
  });
}

/* ============================================================
   The app
   ============================================================ */
defineApp({
  id: 'social',
  name: 'Static Social',
  icon: 'message-circle',
  g1: '#9a7dff', g2: '#4d27cf',
  category: 'Games',
  keywords: ['social', 'chat', 'messages', 'message hub', 'friends', 'online', 'people', 'party', 'lfg',
    'looking for players', 'multiplayer', 'rooms', 'lobby', 'dm', 'direct message', 'hub'],
  desc: 'Live rooms for the multiplayer games, looking-for-players posts and who’s online',
  singleton: true,
  win: { w: 1040, h: 660, minW: 380, minH: 440 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, fmt } = api;

    let dead = false;
    let party = null;
    let catReady = false;
    const offs = [];
    const timers = new Set();
    const catQueue = [];
    const roomSubs = new Set();
    const me = () => identity.me();
    const myId = me().id;

    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms);
      timers.add(t);
      return t;
    };
    const note = n => api.notify({ app: 'social', icon: 'message-circle', timeout: 4000, ...n });
    const has = id => !!api.getApp(id);
    const h24 = () => !!store.get('prefs.h24');
    const clock = at => { const c = fmt.fmtClock(new Date(at), h24()); return h24() ? c.time : `${c.time} ${c.ap}`; };
    const ago = at => fmt.fmtAgo(new Date(at).toISOString());
    const iso = at => new Date(at).toISOString();

    /* ---------------- local lists ---------------- */
    const readList = k => listOf(store, k);
    let mutedSet = null;
    const friends = () => readList(K_FRIENDS);
    const isFriend = id => friends().some(f => f.id === id);
    const isMuted = id => {
      if (!mutedSet) mutedSet = new Set(readList(K_MUTED).map(x => x.id));
      return mutedSet.has(id);
    };
    const nameFor = p => safeName(p.name) || `Player-${p.id.slice(0, 4)}`;
    function toggleFriend(p) {
      const cur = friends();
      if (cur.some(f => f.id === p.id)) store.set(K_FRIENDS, cur.filter(f => f.id !== p.id));
      else {
        S.friendSeen.add(p.id);          /* you just saw them — no "is online" toast for this */
        store.set(K_FRIENDS, [...cur, { id: p.id, name: nameFor(p) }].slice(-200));
      }
    }
    function toggleMute(p) {
      const cur = readList(K_MUTED);
      if (cur.some(f => f.id === p.id)) store.set(K_MUTED, cur.filter(f => f.id !== p.id));
      else store.set(K_MUTED, [...cur, { id: p.id, name: nameFor(p) }].slice(-500));
    }

    /* ---------------- who is who ---------------- */
    const onlineNow = () => (live.status() === 'live' ? presence.online() : []);
    const onlineOf = id => onlineNow().find(p => p.id === id) || null;
    function peerOf(id) {
      const on = onlineOf(id);
      if (on) return on;
      const d = S.dms.get(id);
      if (d) return { id, name: d.name, color: d.color };
      const f = friends().find(x => x.id === id) || readList(K_MUTED).find(x => x.id === id);
      return { id, name: (f && safeName(f.name)) || `Player-${id.slice(0, 4)}`, color: 200 };
    }

    /* ---------------- games ---------------- */
    const roomIds = () => (catReady ? [...pickRooms(), ...S.extra] : []);
    const gameOfKey = key => (catReady && key.startsWith('g:') ? CAT.byId(key.slice(2)) : null);
    function resolveGame(kind, id) {
      if (typeof id !== 'string' || !GAME_ID_RE.test(id)) return null;
      if (kind === 'arcade') { const a = arcadeById(id); return a ? { kind: 'arcade', id: a.id, title: a.title, a } : null; }
      if (kind === 'web' && catReady) { const g = CAT.byId(id); return g ? { kind: 'web', id: g.id, title: gTitle(g), g } : null; }
      return null;
    }
    const canPlay = ref => !!ref && (ref.kind === 'arcade' ? has('arcade') : has('aether-games'));
    /** Opens a game — only ever from a click, and only an id this device knows. */
    function play(ref) {
      if (!ref) return;
      if (ref.kind === 'arcade') {
        if (arcadeById(ref.id) && has('arcade')) api.openApp('arcade', { game: ref.id, players: 1 });
        return;
      }
      if (catReady && CAT.byId(ref.id) && has('aether-games')) api.openApp('aether-games', { url: `static://games/${ref.id}` });
    }
    function whenCat(fn) { if (catReady) fn(); else catQueue.push(fn); }

    /* ============================ DOM ============================ */
    /* rail */
    const railList = h('nav.so-rail', { 'aria-label': 'Rooms' });
    const meBtn = h('button.so-me', { type: 'button', onclick: () => openYou(meBtn) });
    const side = h('aside.app__side.so-side', railList, meBtn);

    /* conversation */
    const roomsDot = h('i.so-roomsbtn__dot', { hidden: true });
    const roomsBtn = h('button.ibtn.so-roomsbtn', { type: 'button', 'aria-label': 'Rooms', title: 'Rooms', onclick: () => toggleDrawer('rooms') },
      icon('menu'), roomsDot);
    const headArt = h('div.so-head__art');
    const headTitle = h('div.app__title.so-head__t');
    const headSub = h('div.so-head__s');
    const headActs = h('div.so-head__acts');
    const peopleN = h('span.so-peoplebtn__n');
    const peopleBtn = h('button.ibtn.so-peoplebtn', { type: 'button', 'aria-label': 'People online', title: 'Online now', onclick: () => toggleDrawer('people') },
      icon('users'), peopleN);
    const head = h('header.app__bar.so-head', roomsBtn, headArt, h('div.so-head__txt', headTitle, headSub), h('div.grow'), headActs, peopleBtn);

    const logEl = h('div.so-log', { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Messages', tabindex: '0' });
    const newPill = h('button.so-newpill', { type: 'button', hidden: true, onclick: () => toBottom() }, icon('arrow-down'), h('span', { text: 'New messages' }));
    const formSlot = h('div.so-board__form');
    const postList = h('div.so-board__list');
    const board = h('div.so-board', { hidden: true, tabindex: '-1', 'aria-label': 'Looking for players' },
      h('p.so-board__intro', icon('info'),
        h('span', { text: 'Live posts from people with Social open. You see posts made while you’re here, and ones re-shared since. Names aren’t verified.' })),
      formSlot, postList);
    /* Friends: private, drawn by social-friends.js; its counts feed the rail */
    let friendCount = { requests: 0, online: 0 };
    const fv = friendsView({ api, onCount: c => { friendCount = c; soon('rail'); } });
    fv.el.hidden = true;
    const bodyEl = h('div.so-body', logEl, newPill, board, fv.el);

    const ta = h('textarea.so-ta', { rows: '1', maxlength: String(MAX_TEXT), 'aria-label': 'Message', spellcheck: 'true' });
    const sendBtn = h('button.ibtn.so-send', { type: 'button', 'aria-label': 'Send', title: 'Send', onclick: () => doSend() }, icon('send'));
    const hintEl = h('span.so-compose__hint');
    const countEl = h('span.so-compose__count');
    const pollBtn = h('button.ibtn.so-pollbtn', { type: 'button', 'aria-label': 'Make a poll', title: 'Make a poll', 'data-act': 'poll', onclick: () => openPollForm() }, icon('bar-chart'));
    const composer = h('div.so-compose', h('div.so-compose__box', ta, pollBtn, sendBtn), h('div.so-compose__meta', hintEl, countEl));
    const main = h('section.app__main.so-main', head, bodyEl, composer);

    /* online now */
    const peopleCount = h('span.so-people__n');
    const peopleList = h('div.so-plist');
    const peopleX = h('button.ibtn.so-people__x', { type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => setDrawer('', true) }, icon('x'));
    const people = h('aside.so-people', { 'aria-label': 'Online now' },
      h('div.so-people__head', h('div.label', { text: 'Online now' }), peopleCount, h('div.grow'), peopleX),
      peopleList,
      h('p.so-people__note', icon('lock'), h('span', { text: 'Stars and mutes live on this device only — there are no accounts.' })));

    const scrim = h('div.so-scrim', { onclick: () => setDrawer('', true) });
    const cols = h('div.so-cols', side, main, people, scrim);

    /* status bar */
    const footDot = h('span.so-foot__dot', { 'aria-hidden': 'true' });
    const footState = h('span.so-foot__state', { role: 'status' });
    const footCount = h('span.so-foot__count');
    const foot = h('footer.app__bar.app__bar--foot.so-foot', footDot, footState, footCount, h('div.grow'),
      h('span.so-foot__note', { title: FOOT_NOTE },
        h('span.so-foot__long', { text: FOOT_NOTE }), h('span.so-foot__short', { text: FOOT_SHORT })));

    const shell = h('div.app.app--col.so', { dataset: { drawer: '' } }, cols, foot);
    root.appendChild(shell);

    /* a plain title, not the kit's .tip: at the window's right edge that tooltip is clipped */
    const infoBtn = h('button.ibtn', { type: 'button', title: 'How Social works', 'aria-label': 'How Social works', onclick: () => openInfo(infoBtn) }, icon('info'));
    win.setTools(infoBtn);

    /* ============================ pieces ============================ */
    function avatar(p, size = 'md', status = null) {
      const letter = Array.from(String(p.name || '?').trim())[0] || '?';
      return h(`span.so-av.so-av--${size}`, { style: { '--hue': String(Number.isFinite(p.color) ? p.color : 200) }, 'aria-hidden': 'true' },
        h('span', { text: letter.toUpperCase() }),
        status ? h('i.so-dot', { dataset: { st: status } }) : null);
    }
    function thumb(g, cls = '') {
      const box = h(`span.so-thumb${cls}`, { style: { background: artBg(g.title) }, 'aria-hidden': 'true' }, h('span', { text: initials(g.title) }));
      if (typeof g.art === 'string' && /^https?:\/\//i.test(g.art) && g.art.length < 800) {
        box.appendChild(h('img', {
          src: g.art, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false',
          onload: e => e.target.classList.add('is-in'), onerror: e => e.target.remove(),
        }));
      }
      return box;
    }
    const arcThumb = (a, cls = '') => h(`span.so-thumb.so-thumb--arc${cls}`, { style: { '--hue': String(a.hue) }, 'aria-hidden': 'true' }, icon(a.icon));
    const refThumb = (ref, cls = '') => (!ref ? h(`span.so-thumb.so-thumb--none${cls}`, { 'aria-hidden': 'true' }, icon('gamepad'))
      : ref.kind === 'arcade' ? arcThumb(ref.a, cls) : thumb(ref.g, cls));
    const hglyph = ic => h('span.so-hglyph', { 'aria-hidden': 'true' }, icon(ic));
    const lbl = t => h('span.so-lbl', { text: t });
    const btn = (label, ic, onclick, o = {}) => h(`button.btn.btn--sm${o.primary ? '.btn--primary' : ''}${o.ghost ? '.btn--ghost' : ''}`, {
      type: 'button', disabled: !!o.disabled, title: o.tip || null, 'aria-label': o.aria || null, 'data-act': o.act || null,
      onclick: e => { e.stopPropagation(); onclick(e); },
    }, ic ? icon(ic, o.fill ? { fill: true } : undefined) : null, label ? lbl(label) : null);
    const moreBtn = (label, fn, act = 'more') => h('button.ibtn.so-more', { type: 'button', 'aria-label': label, title: label, 'data-act': act, onclick: e => { e.stopPropagation(); fn(e); } }, icon('more-horizontal'));
    const menuAt = (e, items) => {
      const t = e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
      if (e.type === 'contextmenu' || !t) api.menu(items, e.clientX, e.clientY);
      else api.menu(items, t.left, t.bottom + 4);
    };

    /** Rebuild `box` with `paint`, keeping its scroll position and keeping
        keyboard focus on the equivalent control (rows are matched by `attr`). */
    const FOCUSABLE = 'button,input,select,textarea,a[href],summary';
    function keepFocus(box, rowSel, attr, paint) {
      const a = document.activeElement;
      let key = null, idx = -1;
      if (a && a !== document.body && box.contains(a)) {
        const row = a.closest(rowSel);
        if (row && box.contains(row)) {
          key = row.getAttribute(attr);
          idx = row === a ? -1 : [...row.querySelectorAll(FOCUSABLE)].indexOf(a);
        }
      }
      const top = box.scrollTop;
      paint();
      box.scrollTop = top;
      if (key === null) return;
      const row = [...box.querySelectorAll(rowSel)].find(r => r.getAttribute(attr) === key);
      const t = row && (idx < 0 ? row : row.querySelectorAll(FOCUSABLE)[idx]);
      if (t && typeof t.focus === 'function') t.focus({ preventScroll: true });
    }

    /* ============================ popovers ============================ */
    let pop = null;
    function closePop() {
      if (!pop) return;
      const p = pop;
      pop = null;
      p.off();
      p.el.remove();
    }
    function openPop(el, anchor, where = 'below') {
      closePop();
      shell.appendChild(el);
      const R = shell.getBoundingClientRect();
      const scale = (R.width && shell.offsetWidth) ? R.width / shell.offsetWidth : 1;
      const a = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : R;
      const W = shell.clientWidth, H = shell.clientHeight;
      const w = el.offsetWidth, ht = el.offsetHeight;
      let x = (a.left - R.left) / scale;
      let y = where === 'above' ? (a.top - R.top) / scale - ht - 6 : (a.bottom - R.top) / scale + 6;
      if (where !== 'above' && y + ht > H - 8) y = (a.top - R.top) / scale - ht - 6;
      x = Math.max(8, Math.min(x, W - w - 8));
      y = Math.max(8, Math.min(y, H - ht - 8));
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      const down = e => { if (!el.contains(e.target) && !(anchor && anchor.contains(e.target))) closePop(); };
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); if (anchor && anchor.isConnected) anchor.focus({ preventScroll: true }); } };
      document.addEventListener('pointerdown', down, true);
      document.addEventListener('keydown', key, true);
      pop = { el, anchor, off() { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); } };
      const first = el.querySelector('input, button:not([disabled]), select');
      if (first) first.focus({ preventScroll: true });
    }
    const popFor = anchor => pop && pop.anchor === anchor;

    function setDrawer(which, refocus) {
      const was = shell.dataset.drawer;
      shell.dataset.drawer = which || '';
      if (which === 'rooms') {
        const on = railList.querySelector('.so-ri.is-on') || railList.querySelector('.so-ri');
        if (on) on.focus({ preventScroll: true });
      } else if (which === 'people') peopleX.focus({ preventScroll: true });
      else if (refocus && was) {
        const back = was === 'rooms' ? roomsBtn : peopleBtn;
        if (back.offsetParent) back.focus({ preventScroll: true });
      }
    }
    function toggleDrawer(which) { closePop(); setDrawer(shell.dataset.drawer === which ? '' : which, true); }

    /* ============================ rail ============================ */
    const livePosts = () => boardPosts().length + (myPostLive() ? 1 : 0);
    function railItem(key, label, lead, o = {}) {
      const on = S.view === key;
      const n = o.badge ?? (S.unread.get(key) || 0);
      return h(`button.side__item.so-ri${on ? '.is-on' : ''}`, {
        type: 'button', title: label, 'aria-current': on ? 'page' : null, 'data-key': key,
        onclick: () => go(key),
      }, lead, h('span.so-ri__t', { text: label }),
      n ? h('b.so-badge', { text: n > 99 ? '99+' : String(n), 'aria-label': o.badgeLabel ? o.badgeLabel(n) : `${n} unread` })
        : o.count ? h('small', { text: String(o.count) }) : null);
    }

    let railSig = '';
    function paintRail() {
      const peers = [...S.dms.values()].filter(p => !isMuted(p.id)).sort((a, b) => b.last - a.last);
      const unread = [...S.unread].filter(([, n]) => n > 0);
      roomsDot.hidden = !unread.some(([k]) => k !== S.view);
      const sig = JSON.stringify([S.view, catReady, roomIds(), unread, livePosts(), friendCount,
        peers.map(p => [p.id, p.name, p.color, onlineOf(p.id)?.status || null])]);
      if (sig === railSig) return;
      railSig = sig;
      keepFocus(railList, '.so-ri', 'data-key', () => {
        clear(railList);
        const rooms = h('div.side__group', h('div.side__label', { text: 'Rooms' }),
          railItem('friends', 'Friends', icon('heart'), { badge: friendCount.requests, badgeLabel: k => `${k} friend request${k === 1 ? '' : 's'}`, count: friendCount.online }),
          railItem('lobby', 'Lobby', icon('message-circle')),
          railItem('lfp', 'Looking for players', icon('users'), { count: livePosts() }));
        const dms = peers.length ? h('div.side__group', h('div.side__label', { text: 'Direct messages' }),
          peers.map(p => railItem(`dm:${p.id}`, p.name, avatar(p, 'xs', onlineOf(p.id)?.status || null)))) : null;
        const games = h('div.side__group', h('div.side__label', { text: 'Game rooms' }),
          catReady
            ? roomIds().map(id => { const g = CAT.byId(id); return g ? railItem(`g:${id}`, gTitle(g), thumb(g)) : null; })
            : h('div.so-rail__wait', h('div.spinner'), h('span', { text: 'Loading game rooms…' })));
        railList.append(...[rooms, dms, games].filter(Boolean));
      });
    }

    function paintMe() {
      const m = me();
      const st = live.status();
      /* while the channel is down nobody can see you, whatever your status says */
      const shown = st === 'live' ? (STATUS_TEXT[m.status] || 'Online') : st === 'connecting' || st === 'idle' ? 'Connecting' : 'Not connected';
      clear(meBtn);
      meBtn.append(avatar(m, 'sm', st === 'live' ? m.status : 'invisible'),
        h('span.so-me__b', h('b', { text: m.name }), h('small', { text: st === 'live' ? `${shown} · you · name not verified` : `${shown} · you` })),
        icon('edit-3'));
      meBtn.setAttribute('aria-label', `You: ${m.name}, ${shown}. Change your name, colour and status.`);
      meBtn.title = 'Your name, colour and status';
    }

    /* ============================ header ============================ */
    let headSig = '';
    function paintHead() {
      const key = S.view;
      const dm = key.startsWith('dm:') ? peerOf(key.slice(3)) : null;
      const dmOn = dm ? onlineOf(dm.id) : null;
      const code = party ? party.code() : null;
      const sig = JSON.stringify([key, catReady, S.formOpen, key === 'lfp' ? livePosts() : 0, code, has('aether-games'),
        dm && [dm.name, dm.color, isFriend(dm.id), isMuted(dm.id)], dmOn && [dmOn.status, dmOn.playing]]);
      if (sig === headSig) return;
      headSig = sig;
      keepFocus(headActs, '[data-act]', 'data-act', () => {
        clear(headArt);
        clear(headActs);
        let title = 'Lobby';
        if (key === 'friends') {
          title = 'Friends';
          headArt.append(hglyph('heart'));
          headSub.textContent = 'Private · only people you accept see you here';
        } else if (key === 'lobby') {
          headArt.append(hglyph('message-circle'));
          headSub.textContent = 'Public room · talk about anything on StaticOS';
          headActs.append(moreBtn('Room options', e => roomMenu(e)));
        } else if (key === 'lfp') {
          title = 'Looking for players';
          headArt.append(hglyph('users'));
          const n = livePosts();
          headSub.textContent = `${n ? `${n} live post${n === 1 ? '' : 's'}` : 'No live posts'} · each one disappears 15 minutes after it’s posted`;
          headActs.append(btn(S.formOpen ? 'Close' : 'New post', S.formOpen ? 'x' : 'plus', () => setForm(!S.formOpen), { primary: !S.formOpen, act: 'post' }));
        } else if (key.startsWith('g:')) {
          const g = gameOfKey(key);
          title = g ? gTitle(g) : 'Game room';
          if (g) headArt.append(thumb(g, '.so-thumb--head'));
          headSub.textContent = 'Public room about this game';
          const ref = g ? { kind: 'web', id: g.id, title, g } : null;
          headActs.append(
            btn('Play', 'play', () => play(ref), { primary: true, disabled: !canPlay(ref), act: 'play', tip: canPlay(ref) ? `Play ${title}` : 'Static Games isn’t installed' }),
            btn('Find players', 'users', () => startPost(ref), { act: 'find', tip: `Post in Looking for players about ${title}`, aria: 'Find players' }),
            moreBtn('Room options', e => roomMenu(e)));
        } else if (dm) {
          title = dm.name;
          headArt.append(avatar(dm, 'md', dmOn ? dmOn.status : null));
          headSub.textContent = dmOn ? `${STATUS_TEXT[dmOn.status] || 'Online'}${dmOn.playing ? ` · Last launched ${dmOn.playing}` : ''}` : 'Not online right now';
          const fr = isFriend(dm.id);
          /* Element.append(null) would print "null": filter first */
          headActs.append(...[
            btn(fr ? 'Starred' : 'Star', 'star', () => toggleFriend(dm), { fill: fr, act: 'friend', aria: fr ? 'Unstar' : 'Star', tip: fr ? 'Unstar (on this device)' : 'Star them on this device — for real friends who see you online, use Friends' }),
            code ? btn('Invite', 'users', () => invite(dm), { act: 'invite', aria: 'Invite to my party', tip: `Invite ${dm.name} to your party (${code})` }) : null,
            moreBtn('Conversation options', e => dmMenu(e, dm)),
          ].filter(Boolean));
        }
        headTitle.textContent = title;
        headTitle.title = title;
        win.setSubtitle(title);
      });
    }

    /* ============================ conversation ============================ */
    let rendered = { key: null, lastSeq: 0, lastFrom: null, lastAt: 0, stale: false };
    const nearBottom = () => logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80;
    function toBottom() { logEl.scrollTop = logEl.scrollHeight; newPill.hidden = true; }
    logEl.addEventListener('scroll', () => { if (!newPill.hidden && nearBottom()) newPill.hidden = true; }, { passive: true });

    let mentionRe = null, mentionName = '';
    function mentions(text) {
      const n = me().name;
      if (n !== mentionName) {
        mentionName = n;
        mentionRe = n.length >= 3 ? new RegExp(`(^|[^\\p{L}\\p{N}])@?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu') : null;
      }
      return !!mentionRe && mentionRe.test(text);
    }

    function intro(key) {
      const noteLine = (ic, text) => h('p.so-intro__note', icon(ic), h('span', { text }));
      if (key === 'lobby') {
        return h('div.so-intro', hglyph('message-circle'),
          h('div.grow', h('h3', { text: 'Welcome to the Lobby' }),
            h('p', { text: 'Talk about anything on StaticOS — games, parties, what you’re making. Each game in the room list has its own room.' }),
            noteLine('clock', NO_HISTORY)));
      }
      if (key.startsWith('g:')) {
        const g = gameOfKey(key);
        if (!g) return h('div.so-intro', h('div.grow', h('p', { text: NO_HISTORY })));
        const ref = { kind: 'web', id: g.id, title: gTitle(g), g };
        const desc = oneLine(g.desc, 220);
        const cats = (g.cats || []).filter(c => c !== 'featured').slice(0, 3).map(c => h('span.chip', { text: CAT.catMeta(c).name }));
        return h('div.so-intro.so-intro--game', thumb(g, '.so-thumb--intro'),
          h('div.grow', h('h3', { text: gTitle(g) }),
            desc ? h('p', { text: desc }) : null,
            cats.length ? h('div.so-intro__chips', cats) : null,
            h('div.so-intro__acts',
              btn('Play', 'play', () => play(ref), { primary: true, disabled: !canPlay(ref) }),
              btn('Find players', 'users', () => startPost(ref))),
            noteLine('clock', NO_HISTORY)));
      }
      const p = peerOf(key.slice(3));
      return h('div.so-intro', avatar(p, 'lg'),
        h('div.grow', h('h3', { text: p.name }),
          h('p', { text: `This is the start of what you’ve seen with ${p.name}. ${NO_HISTORY}` }),
          noteLine('alert', 'Not private: direct messages travel over the same public live channel as everything else, so anyone who knows their device id could read them. Names aren’t verified either — don’t share anything personal.'),
          isMuted(p.id) ? h('div.so-intro__acts', btn('Unmute', 'volume-2', () => toggleMute(p)), h('span.dim', { text: 'You muted this person — their messages are hidden.' })) : null));
    }

    function inviteChip(m) {
      const code = m.partyCode;
      return h('div.so-invite', icon('users'),
        h('span.grow', h('b', { text: 'Party invite' }), h('span', { text: ` · ${code}` })),
        party && !m.mine ? btn('Join party', 'check', () => joinParty(code), { primary: true }) : null,
        party ? null : h('small.dim', { text: 'Party isn’t available here' }));
    }

    function msgRow(m, cont) {
      const who = { id: m.from, name: m.name, color: m.color };
      const time = clock(m.at);
      const text = m.poll ? pollEl(m.poll) : h('div.so-msg__t', { text: m.text });
      const more = moreBtn('Message options', e => msgMenu(e, m));
      const extra = m.partyCode ? inviteChip(m) : null;
      const row = cont
        ? h('div.so-msg.is-cont', { dataset: { seq: String(m.seq) } },
          h('time.so-msg__ct', { dateTime: iso(m.at), text: time }),
          h('div.so-msg__b', text, extra), more)
        : h('div.so-msg', { dataset: { seq: String(m.seq) } },
          h('button.so-msg__av', { type: 'button', 'aria-label': `${m.name} — show card`, onclick: e => openCard(who, e.currentTarget) }, avatar(who, 'md')),
          h('div.so-msg__b',
            h('div.so-msg__h',
              h('button.so-msg__n', { type: 'button', style: { '--hue': String(m.color) }, text: m.name, onclick: e => openCard(who, e.currentTarget) }),
              m.mine ? h('span.so-msg__you', { text: 'you' }) : null,
              h('time', { dateTime: iso(m.at), text: time })),
            text, extra),
          more);
      if (m.mine) row.classList.add('is-mine');
      else if (mentions(m.text)) row.classList.add('is-mention');
      row.addEventListener('contextmenu', e => { e.preventDefault(); msgMenu(e, m); });
      return row;
    }

    function appendMsg(m) {
      const cont = rendered.lastFrom === m.from && m.at - rendered.lastAt < GROUP_MS;
      logEl.appendChild(msgRow(m, cont));
      rendered.lastFrom = m.from;
      rendered.lastAt = m.at;
    }

    /** The first message row in view, so a repaint can put it back where it was. */
    function topRow() {
      const top = logEl.scrollTop;
      for (const r of logEl.querySelectorAll('.so-msg')) {
        if (r.offsetTop + r.offsetHeight > top) return { seq: r.dataset.seq, off: r.offsetTop - top };
      }
      return null;
    }

    /** Full paint when the view changes (or the scrollback was trimmed);
        otherwise only the new messages are appended, so a selection
        or the scroll position is never thrown away. */
    function renderLog(full) {
      const key = S.view;
      if (key === 'lfp' || key === 'friends') return;
      const arr = S.logs.get(key) || [];
      const last = arr.length ? arr[arr.length - 1].seq : 0;
      const stick = nearBottom();

      if (!full && rendered.key === key && !rendered.stale) {
        const fresh = arr.filter(m => m.seq > rendered.lastSeq);
        rendered.lastSeq = last;
        let mineAdded = false, shown = 0;
        for (const m of fresh) {
          if (isMuted(m.from)) continue;
          appendMsg(m);
          shown++;
          if (m.mine) mineAdded = true;
        }
        if (!shown) return;
        if (stick || mineAdded) toBottom();
        else newPill.hidden = false;
        return;
      }

      /* a repaint of the same view keeps the reader's place */
      const same = rendered.key === key;
      const anchor = same && !stick ? topRow() : null;
      const keepTop = logEl.scrollTop;
      clear(logEl);
      logEl.appendChild(intro(key));
      rendered = { key, lastSeq: last, lastFrom: null, lastAt: 0, stale: false };
      const visible = arr.filter(m => !isMuted(m.from));
      const unread = S.unread.get(key) || 0;
      const divAt = unread > 0 && unread < visible.length ? visible.length - unread : -1;
      visible.forEach((m, i) => {
        if (i === divAt) {
          logEl.appendChild(h('div.so-div', { role: 'separator' }, h('span', { text: 'New' })));
          rendered.lastFrom = null;
        }
        appendMsg(m);
      });
      if (!same || stick) { toBottom(); return; }
      const el = anchor && logEl.querySelector(`.so-msg[data-seq="${anchor.seq}"]`);
      logEl.scrollTop = el ? el.offsetTop - anchor.off : keepTop;
    }

    /* ============================ composer ============================ */
    let taKey = null;               /* which view the text box currently holds a draft for */
    function saveDraft() {
      if (!taKey || taKey === 'lfp' || taKey === 'friends') return;
      if (ta.value.trim()) S.drafts.set(taKey, ta.value);
      else S.drafts.delete(taKey);
    }
    let hintT = 0, hintHeld = false;
    /** A line under the composer for a few seconds, which paintComposer
        leaves alone until it expires. `warn` colours it; a plain note (a
        draft was put there for you) is not a warning, so it is not coloured. */
    function flashHint(text, warn = true) {
      hintEl.textContent = text;
      hintEl.classList.toggle('is-warn', !!warn);
      hintHeld = true;
      clearTimeout(hintT);
      timers.delete(hintT);
      hintT = later(() => { hintHeld = false; hintEl.classList.remove('is-warn'); paintComposer(); }, 3800);
    }
    function autosize() {
      /* measured only while the box is rendered: a hidden composer (the
         board is showing, or a phone's inactive sheet) reads 0 and would
         squash the box to a sliver — leave it to the stylesheet then */
      if (!ta.isConnected || !ta.getClientRects().length) { ta.style.height = ''; return; }
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
    }
    function paintCount() {
      const n = ta.value.length;
      countEl.textContent = n > 380 ? `${n}/${MAX_TEXT}` : '';
      countEl.classList.toggle('is-warn', n > 470);
    }
    function paintComposer() {
      const key = S.view;
      composer.hidden = key === 'lfp' || key === 'friends';
      if (composer.hidden) return;
      pollBtn.hidden = key.startsWith('dm:');
      const st = live.status();
      let label = 'Message the Lobby';
      if (key.startsWith('g:')) { const g = gameOfKey(key); label = `Message the ${g ? gTitle(g) : 'game'} room`; }
      else if (key.startsWith('dm:')) label = `Message ${peerOf(key.slice(3)).name}`;
      ta.placeholder = st === 'live' ? `${label}…` : st === 'offline' ? 'Offline — messages can’t be sent right now' : 'Connecting to the live channel…';
      ta.setAttribute('aria-label', label);
      sendBtn.disabled = st !== 'live' || !ta.value.trim();
      if (!hintHeld) {
        hintEl.textContent = st === 'offline' ? 'StaticOS keeps retrying. Your draft stays here.'
          : key.startsWith('dm:') ? 'Enter to send · not private — it’s a public channel'
            : 'Enter to send · Shift+Enter for a new line';
      }
      paintCount();
    }
    ta.addEventListener('input', () => {
      autosize();
      paintCount();
      sendBtn.disabled = live.status() !== 'live' || !ta.value.trim();
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); doSend(); }
    });

    /** Publish a message to a room or DM. -> 'sent' | 'empty' | 'offline' | { wait } */
    function sendMsg(key, raw, extra = {}) {
      const body = cleanText(raw);
      if (!body) return 'empty';
      if (live.status() !== 'live') return 'offline';
      const budget = sendBudget();
      if (!budget.ok) return budget;
      let topic = null;
      if (key === 'lobby') topic = 'hub/lobby';
      else if (key.startsWith('g:') && GAME_ID_RE.test(key.slice(2))) topic = `hub/${key.slice(2)}`;
      else if (key.startsWith('dm:') && ID_RE.test(key.slice(3)) && key.slice(3) !== myId) topic = `dm/${key.slice(3)}`;
      if (!topic) return 'empty';
      const m = me();
      const msg = { id: m.id, name: m.name, color: m.color, text: body, at: Date.now(), mid: rid() };
      if (key.startsWith('dm:')) msg.to = key.slice(3);
      if (extra.partyCode && codeOf(extra.partyCode)) msg.partyCode = extra.partyCode;
      if (!live.publish(topic, JSON.stringify(msg))) return 'offline';
      S.sent.push(Date.now());
      firstSight(`${key}|m:${msg.mid}`);
      if (key.startsWith('dm:')) touchDm(peerOf(key.slice(3)));
      addMsg(key, { mid: msg.mid, from: m.id, name: m.name, color: m.color, text: body, at: msg.at, mine: true, partyCode: msg.partyCode || null });
      return 'sent';
    }

    function doSend() {
      const key = S.view;
      if (key === 'lfp' || key === 'friends') return;
      const r = sendMsg(key, ta.value);
      if (r === 'sent') {
        ta.value = '';
        S.drafts.delete(key);
        autosize();
        paintComposer();
      } else if (r === 'offline') flashHint('Not sent — the live channel isn’t connected. Your message is still here.');
      else if (r && r.wait) flashHint(`Slow down — you can send again in ${Math.max(1, Math.ceil(r.wait / 1000))} s.`);
    }

    /* ============================ polls ============================ */
    const roomTopic = key => (key === 'lobby' ? 'hub/lobby' : key.startsWith('g:') && GAME_ID_RE.test(key.slice(2)) ? `hub/${key.slice(2)}` : null);
    const pollCtx = { myId, vote: (P, ch) => castVote(P, ch), close: P => closePoll(P) };
    const pollEl = P => pollCard({ h, icon }, P, pollCtx);
    function repaintPoll(P) {
      for (const el of logEl.querySelectorAll('.so-poll')) if (el.poll === P) el.repaint();
    }
    /** Publish a poll-family message to a room. -> 'sent' | 'offline' | { wait } */
    function pollSend(key, body) {
      const topic = roomTopic(key);
      if (!topic) return 'empty';
      if (live.status() !== 'live') return 'offline';
      const budget = sendBudget();
      if (!budget.ok) return budget;
      const m = me();
      const msg = { id: m.id, name: m.name, color: m.color, at: Date.now(), mid: rid(), ...body };
      if (!live.publish(topic, JSON.stringify(msg))) return 'offline';
      S.sent.push(Date.now());
      firstSight(`${key}|m:${msg.mid}`);
      return msg;
    }
    const sendNote = r => (r === 'offline' ? 'Not sent — the live channel isn’t connected.'
      : r && r.wait ? `Slow down — try again in ${Math.max(1, Math.ceil(r.wait / 1000))} s.` : 'Not sent.');
    function makePoll(f) {
      const key = S.view;
      const meta = POLL.parsePoll({ pid: rid(10), q: f.q, opts: f.opts, multi: f.multi, anon: f.anon, dur: f.dur });
      if (!meta) return 'That poll isn’t valid — check the question and options.';
      const r = pollSend(key, { text: `Poll: ${meta.q}`, poll: meta });
      if (typeof r === 'string' || r.wait) return sendNote(r);
      const P = POLL.newPoll(meta, me(), key, Date.now());
      S.polls.set(`${key}|${meta.pid}`, P);
      while (S.polls.size > 60) S.polls.delete(S.polls.keys().next().value);
      addMsg(key, { mid: r.mid, from: myId, name: me().name, color: me().color, text: r.text, at: r.at, mine: true, partyCode: null, poll: P });
      closePop();
      return null;
    }
    function openPollForm() {
      if (popFor(pollBtn)) { closePop(); return; }
      openPop(pollForm({ h, icon }, makePoll), pollBtn, 'above');
    }
    function castVote(P, ch) {
      if (!POLL.isOpen(P)) { repaintPoll(P); return; }
      const n = Math.max(Date.now(), P.myN + 1);
      const vote = POLL.parseVote({ pid: P.pid, ch, n });
      if (!vote) return;
      const probe = { ...P, votes: new Map(P.votes) };
      if (POLL.applyVote(probe, { id: myId, name: me().name }, vote) !== 'ok') return;
      const r = pollSend(P.room, { vote });
      if (typeof r === 'string' || r.wait) { flashHint(sendNote(r)); return; }
      P.myN = n;
      POLL.applyVote(P, { id: myId, name: me().name }, vote);
      repaintPoll(P);
    }
    function closePoll(P) {
      if (P.from !== myId || P.closed) return;
      const r = pollSend(P.room, { close: { pid: P.pid } });
      if (typeof r === 'string' || r.wait) { flashHint(sendNote(r)); return; }
      POLL.applyClose(P, myId);
      repaintPoll(P);
    }
    /** poll / vote / close messages arriving on a room's topic */
    function onPollMsg(key, p) {
      if (!p.mid || !firstSight(`${key}|m:${p.mid}`) || flooded(p.who.id)) return;
      if (p.raw.poll) {
        const meta = POLL.parsePoll(p.raw.poll);
        const pk = meta && `${key}|${meta.pid}`;
        if (!meta || S.polls.has(pk)) return;           /* first one with an id wins */
        const P = POLL.newPoll(meta, p.who, key, Date.now());
        S.polls.set(pk, P);
        while (S.polls.size > 60) S.polls.delete(S.polls.keys().next().value);
        const mine = p.who.id === myId;
        addMsg(key, { mid: p.mid, from: p.who.id, name: p.who.name, color: p.who.color, text: `Poll: ${meta.q}`, at: Date.now(), mine, partyCode: null, poll: P });
        return;
      }
      const spec = p.raw.vote ? POLL.parseVote(p.raw.vote) : POLL.parseClose(p.raw.close);
      const P = spec && S.polls.get(`${key}|${spec.pid}`);
      if (!P) return;
      if (p.raw.vote) {
        if (p.who.id === myId && P.myN >= spec.n) return;   /* our own, already counted */
        if (POLL.applyVote(P, p.who, spec) === 'ok' && p.who.id === myId) P.myN = Math.max(P.myN, spec.n);
      } else if (!POLL.applyClose(P, p.who.id)) return;
      repaintPoll(P);
    }

    /* ============================ messages in ============================ */
    function addMsg(key, m) {
      m.seq = ++S.seq;
      let arr = S.logs.get(key);
      if (!arr) { arr = []; S.logs.set(key, arr); }
      arr.push(m);
      const trimmed = arr.length > MAX_LOG;
      if (trimmed) arr.splice(0, arr.length - MAX_LOG);
      if (!m.mine && !isMuted(m.from) && S.view !== key) S.unread.set(key, (S.unread.get(key) || 0) + 1);
      if (S.view === key) {
        if (trimmed) rendered.stale = true;          /* the oldest row is gone: repaint in full */
        soon('log');
      }
      soon('rail');
    }

    function onRoom(key, text) {
      const p = parseBase(text);
      if (!p) return;
      if (p.raw.poll || p.raw.vote || p.raw.close) { onPollMsg(key, p); return; }
      const m = chatFrom(p);
      if (!m || !firstSight(`${key}|${m.seen}`) || flooded(m.from)) return;
      m.mine = m.from === myId;                        /* e.g. another tab of this browser */
      addMsg(key, m);
    }

    function touchDm(p) {
      const cur = S.dms.get(p.id);
      S.dms.set(p.id, {
        id: p.id,
        name: safeName(p.name) || (cur && cur.name) || `Player-${p.id.slice(0, 4)}`,
        color: Number.isFinite(p.color) ? p.color : cur ? cur.color : 200,
        last: Date.now(),
      });
      if (S.dms.size > MAX_DM_PEERS) {
        const oldest = [...S.dms.values()].filter(x => `dm:${x.id}` !== S.view).sort((a, b) => a.last - b.last)[0];
        if (oldest) {
          S.dms.delete(oldest.id);
          S.logs.delete(`dm:${oldest.id}`);
          S.unread.delete(`dm:${oldest.id}`);
        }
      }
    }

    function windowFocused() {
      return !dead && !win.min && win.el.classList.contains('is-active')
        && document.visibilityState === 'visible' && (typeof document.hasFocus !== 'function' || document.hasFocus());
    }

    function onDm(text) {
      const m = parseDm(text, myId);
      if (!m || m.from === myId) return;
      const key = `dm:${m.from}`;
      if (!firstSight(`${key}|${m.seen}`) || flooded(m.from)) return;
      m.mine = false;
      touchDm({ id: m.from, name: m.name, color: m.color });
      addMsg(key, m);
      /* a toast only when Social isn't in front; the rail badge covers the rest */
      if (!isMuted(m.from) && !windowFocused()) {
        const now = Date.now();
        if (now - (S.dmNoted.get(m.from) || 0) >= DM_NOTE_GAP && now - S.dmNoteAt >= DM_NOTE_ANY) {
          S.dmNoted.set(m.from, now);
          S.dmNoteAt = now;
          const from = m.from;
          api.notify({
            app: 'social', icon: 'message-circle', key: `social-dm-${from}`, timeout: 6000,
            title: `${m.name} sent you a message`,
            message: m.partyCode ? `Party invite · ${m.partyCode}` : oneLine(m.text, 140),
            onClick: () => api.openApp('social', { dm: from }),
            actions: [{ label: 'Reply', onClick: () => api.openApp('social', { dm: from }) }],
          });
        }
      }
      if (S.view === key) soon('head');
    }

    /* ============================ looking for players ============================ */
    const boardPosts = () => [...S.posts.values()]
      .filter(p => expiresAt(p) > Date.now() && !isMuted(p.from))
      .sort((a, b) => b.at - a.at);

    function onPost(text) {
      const p = parsePost(text);
      if (!p) return;
      if (p.gone) {
        const cur = S.posts.get(p.key);
        if (cur && cur.from === p.from) { S.posts.delete(p.key); soon('board', 'rail', 'head'); }
        return;
      }
      if (p.from === myId) return;                     /* my own post, echoed back */
      if (S.posts.has(p.key)) return;                  /* a re-share of a post already here */
      if (flooded(p.from)) return;
      const theirs = [...S.posts.values()].filter(q => q.from === p.from).sort((a, b) => a.at - b.at);
      while (theirs.length >= POSTS_PER_PERSON) S.posts.delete(theirs.shift().key);
      S.posts.set(p.key, p);
      if (S.posts.size > MAX_POSTS) {
        const oldest = [...S.posts.values()].sort((a, b) => a.at - b.at)[0];
        S.posts.delete(oldest.key);
      }
      if (!isMuted(p.from) && S.view !== 'lfp') S.unread.set('lfp', (S.unread.get('lfp') || 0) + 1);
      soon('board', 'rail', 'head');
    }

    function myPostLive() {
      if (S.myPost && expiresAt(S.myPost) <= Date.now()) S.myPost = null;
      return S.myPost;
    }
    function reshare() {
      const mp = myPostLive();
      if (!mp || live.status() !== 'live') return;
      if (live.publish('lfp', mp.payload)) mp.shared = Date.now();
    }
    function removeMyPost() {
      const mp = S.myPost;
      if (!mp) return;
      const m = me();
      live.publish('lfp', JSON.stringify({ id: m.id, name: m.name, color: m.color, mid: mp.mid, gone: 1, at: Date.now() }));
      S.myPost = null;
      soon('board', 'rail', 'head');
    }

    function setForm(open) {
      S.formOpen = !!open;
      soon('head', 'board');
    }
    function startPost(ref) {
      if (ref) S.lfpPick = `${ref.kind}:${ref.id}`;
      S.formOpen = true;
      boardForm = null;                                /* rebuild it with this game picked */
      go('lfp');
    }

    function gameChoices() {
      const seen = new Set();
      const out = [];
      const add = (label, items) => {
        const list = items.filter(it => it && !seen.has(`${it.kind}:${it.id}`));
        list.forEach(it => seen.add(`${it.kind}:${it.id}`));
        if (list.length) out.push({ label, items: list });
      };
      const web = id => { const r = resolveGame('web', id); return r ? { kind: 'web', id: r.id, title: r.title } : null; };
      const arc = id => { const r = resolveGame('arcade', id); return r ? { kind: 'arcade', id: r.id, title: r.title } : null; };
      if (S.lfpPick) {
        const [k, ...rest] = S.lfpPick.split(':');
        const r = resolveGame(k, rest.join(':'));
        if (r) add('This game', [{ kind: r.kind, id: r.id, title: r.title }]);
      }
      const recent = plays.recent(12);
      add('Recently played', (Array.isArray(recent) ? recent : []).map(r => (r && r.kind === 'web' ? web(r.id) : r && r.kind === 'arcade' ? arc(r.id) : null)));
      const favs = store.get('portal.games.favs');
      add('Your favourites', (Array.isArray(favs) ? favs : []).filter(x => typeof x === 'string').slice(0, 12).map(web));
      add('Multiplayer game rooms', roomIds().map(web));
      add('Arcade — built into StaticOS', ARCADE.map(a => ({ kind: 'arcade', id: a.id, title: a.title })));
      return out;
    }

    /** The post form. -> { el, cat, refresh } — refresh() updates the bits that
        depend on your party without rebuilding (so typing never loses focus). */
    function postForm() {
      if (!catReady) {
        return { el: h('div.so-form', h('div.so-rail__wait', h('div.spinner'), h('span', { text: 'Loading the game list…' }))), cat: false, refresh() {} };
      }
      const sel = h('select.select.so-form__game', { 'aria-label': 'Game' });
      for (const gr of gameChoices()) {
        sel.appendChild(h('optgroup', { label: gr.label }, gr.items.map(it => h('option', { value: `${it.kind}:${it.id}`, text: it.title }))));
      }
      if (S.lfpPick && [...sel.options].some(o => o.value === S.lfpPick)) sel.value = S.lfpPick;
      sel.addEventListener('change', () => { S.lfpPick = sel.value; });
      const noteIn = h('input.so-form__note', { type: 'text', maxlength: String(MAX_NOTE), placeholder: 'A short note — e.g. “need one more for a 2v2”', 'aria-label': 'Note (optional)', spellcheck: 'true' });
      const attachSlot = h('div.so-form__attachslot');
      const replaceNote = h('small.dim', { text: 'Posting again replaces your current post.' });
      const status = h('span.so-form__hint', { role: 'status' });
      let attach = null, shownCode;
      const refresh = () => {
        replaceNote.hidden = !myPostLive();
        const code = party ? party.code() : null;
        if (code === shownCode) return;
        shownCode = code;
        clear(attachSlot);
        attach = null;
        if (code) {
          attach = h('input', { type: 'checkbox', checked: true });
          attachSlot.appendChild(h('label.so-form__attach', attach, h('span', { text: `Attach my party code (${code}) so people can join` })));
        }
      };
      const submit = () => {
        const [kind, ...rest] = sel.value.split(':');
        const ref = resolveGame(kind, rest.join(':'));
        if (!ref) { status.textContent = 'Pick a game first.'; return; }
        if (live.status() !== 'live') { status.textContent = 'Not posted — the live channel isn’t connected.'; return; }
        const budget = sendBudget();
        if (!budget.ok) { status.textContent = `Slow down — try again in ${Math.max(1, Math.ceil(budget.wait / 1000))} s.`; return; }
        const m = me();
        const post = { id: m.id, name: m.name, color: m.color, game: { kind: ref.kind, id: ref.id, title: ref.title }, text: oneLine(noteIn.value, MAX_NOTE), at: Date.now(), mid: rid() };
        const c = party ? party.code() : null;
        if (attach && attach.checked && c) post.partyCode = c;
        const payload = JSON.stringify(post);
        if (S.myPost) removeMyPost();                  /* one post at a time: the new one replaces it */
        if (!live.publish('lfp', payload)) { status.textContent = 'Not posted — the live channel isn’t connected.'; return; }
        S.sent.push(Date.now());
        S.myPost = { key: `m:${post.mid}`, mid: post.mid, from: m.id, name: m.name, color: m.color, game: post.game, text: post.text, partyCode: post.partyCode || null, at: post.at, seen: post.at, payload, shared: Date.now() };
        S.lfpPick = sel.value;
        setForm(false);
        soon('rail');
      };
      noteIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      refresh();
      const el = h('div.so-form', { role: 'group', 'aria-label': 'New post' },
        h('div.so-form__row', h('label.so-form__l', { text: 'Game' }), sel),
        h('div.so-form__row', h('label.so-form__l', { text: 'Note' }), noteIn),
        attachSlot,
        h('div.so-form__foot', status, h('div.grow'), replaceNote,
          btn('Post', 'send', submit, { primary: true })));
      return { el, cat: true, refresh };
    }

    function postRow(p, mine) {
      const ref = resolveGame(p.game.kind, p.game.id);
      const title = ref ? ref.title : p.game.title;
      const left = Math.max(0, expiresAt(p) - Date.now());
      const who = { id: p.from, name: p.name, color: p.color };
      const code = p.partyCode;
      return h(`article.so-post${mine ? '.is-mine' : ''}`, { 'data-key': p.key },
        refThumb(ref, '.so-thumb--post'),
        h('div.so-post__b',
          h('div.so-post__top',
            h('b.so-post__game', { text: title }),
            ref ? null : h('span.chip', { text: 'Not in this catalogue' }),
            h('div.grow'),
            h('span.so-post__left', { text: left < 60_000 ? 'under a minute left' : `${Math.ceil(left / 60_000)} min left` })),
          h('div.so-post__who',
            h('button.so-post__person', { type: 'button', onclick: e => openCard(who, e.currentTarget) }, avatar(who, 'xs'), h('span', { text: mine ? 'You' : p.name })),
            h('span.dim', { text: `· posted ${ago(p.at)}` })),
          p.text ? h('p.so-post__note', { text: p.text }) : null,
          h('div.so-post__acts',
            ref ? btn('Play', 'play', () => play(ref), { primary: true, disabled: !canPlay(ref) }) : null,
            code && party && !mine ? btn(`Join party · ${code}`, 'users', () => joinParty(code)) : null,
            code && mine ? h('span.chip', { text: `Your party · ${code}` }) : null,
            mine ? btn('Remove', 'trash', () => removeMyPost(), { ghost: true })
              : btn('Message', 'message-circle', () => openDm(who)),
            mine ? null : moreBtn('More', e => personMenu(e, who))),
          mine ? h('small.so-post__mine', { text: 'Your post · re-shared once a minute while Social is open, so people who arrive later see it too.' }) : null));
    }

    let boardForm = null;
    function paintBoard() {
      if (S.view !== 'lfp') return;
      if (!S.formOpen) {
        if (boardForm) { boardForm = null; clear(formSlot); }
      } else if (!boardForm || boardForm.cat !== catReady) {
        clear(formSlot);
        boardForm = postForm();
        formSlot.appendChild(boardForm.el);
        const first = boardForm.el.querySelector('select, input');
        if (first && !document.body.classList.contains('is-mobile')) first.focus({ preventScroll: true });
      } else boardForm.refresh();

      const mp = myPostLive();
      const posts = boardPosts();
      const top = board.scrollTop;
      keepFocus(postList, '.so-post', 'data-key', () => {
        clear(postList);
        if (!mp && !posts.length) {
          postList.appendChild(h('div.empty.so-empty', icon('users'),
            h('b', { text: 'No posts yet' }),
            h('small', { text: 'Posts only reach people who have Social open, so you’ll see the ones made while you’re here. Post one — anyone who opens Social in the next 15 minutes will see it, as long as you keep Social open.' }),
            S.formOpen ? null : btn('Post one', 'plus', () => setForm(true), { primary: true })));
        } else {
          postList.appendChild(h('div.so-posts', mp ? postRow(mp, true) : null, posts.map(p => postRow(p, false))));
        }
      });
      board.scrollTop = top;
    }

    /* ============================ people ============================ */
    let peopleSig = '';
    let mutedOpen = false;
    function personRow(p, online) {
      const fr = isFriend(p.id), mu = isMuted(p.id);
      const sub = !online ? 'Not online right now' : p.playing ? `Last launched ${p.playing}` : STATUS_TEXT[p.status] || 'Online';
      return h(`button.so-person${online ? '' : '.is-off'}${mu ? '.is-muted' : ''}`, {
        type: 'button', 'data-id': p.id, 'aria-label': `${p.name}, ${sub}${fr ? ', starred' : ''}${mu ? ', muted' : ''}`,
        onclick: e => openCard(p, e.currentTarget),
        oncontextmenu: e => { e.preventDefault(); personMenu(e, p); },
      },
      avatar(p, 'sm', online ? p.status : null),
      h('span.so-person__b', h('b', { text: p.name }), h('small', { text: sub })),
      fr ? h('span.so-person__star', { title: 'Starred (on this device)' }, icon('star', { fill: true })) : null,
      mu ? h('span.so-person__mute', { title: 'Muted' }, icon('volume-x')) : null);
    }

    function paintPeople(force) {
      const st = live.status();
      const online = onlineNow();
      const fl = friends();
      const ml = readList(K_MUTED);
      const sig = JSON.stringify([st, online.map(p => [p.id, p.name, p.color, p.status, p.playing]), fl, ml]);
      if (!force && sig === peopleSig) return;
      peopleSig = sig;
      peopleCount.textContent = online.length ? String(online.length) : '';
      peopleN.textContent = online.length ? String(online.length) : '';
      peopleBtn.setAttribute('aria-label', online.length ? `People online: ${online.length}` : 'People online');

      /* a friend's stored name follows what they call themselves now */
      const renamed = fl.map(f => { const on = online.find(p => p.id === f.id); return on && on.name !== f.name ? { ...f, name: on.name } : f; });
      if (renamed.some((f, i) => f !== fl[i])) store.set(K_FRIENDS, renamed);

      keepFocus(peopleList, '[data-id]', 'data-id', () => {
        clear(peopleList);
        if (st === 'offline') {
          peopleList.appendChild(h('div.empty.so-empty', icon('wifi-off'), h('b', { text: 'Can’t see who’s online' }),
            h('small', { text: 'The live channel is offline — this network may block it. StaticOS keeps retrying.' })));
        } else if (st !== 'live') {
          peopleList.appendChild(h('div.so-rail__wait', h('div.spinner'), h('span', { text: 'Connecting…' })));
        } else {
          const fIds = new Set(fl.map(f => f.id));
          if (fl.length) {
            const on = online.filter(p => fIds.has(p.id));
            const off = fl.filter(f => !online.some(p => p.id === f.id))
              .map(f => ({ id: f.id, name: safeName(f.name) || `Player-${f.id.slice(0, 4)}`, color: (S.dms.get(f.id) || {}).color ?? 200 }));
            peopleList.appendChild(h('div.so-pgroup', h('div.side__label', { text: `Starred · ${on.length} online` }),
              on.map(p => personRow(p, true)), off.map(p => personRow(p, false))));
          }
          const others = online.filter(p => !fIds.has(p.id));
          if (others.length) {
            peopleList.appendChild(h('div.so-pgroup', h('div.side__label', { text: fl.length ? 'Everyone else' : 'Everyone' }), others.slice(0, 200).map(p => personRow(p, true))));
          } else if (!online.length) {
            peopleList.appendChild(h('div.empty.so-empty', icon('users'), h('b', { text: 'No one else is online' }),
              h('small', { text: 'People show up here while Social or Party is open on their own device. It can take a few seconds.' })));
          }
        }
        if (ml.length) {
          const det = h('details.so-muted', h('summary', { text: `Muted on this device · ${ml.length}` }),
            ml.map(x => h('div.so-muted__row', { 'data-id': x.id }, h('span.grow.trunc', { text: safeName(x.name) || x.id.slice(0, 4) }),
              btn('Unmute', null, () => toggleMute(x), { ghost: true }))));
          det.open = mutedOpen;
          det.addEventListener('toggle', () => { mutedOpen = det.open; });
          peopleList.appendChild(det);
        }
      });
    }

    function onPresence() {
      soon('people', 'foot', 'rail');
      if (S.view.startsWith('dm:')) soon('head', 'composer');
    }

    /* ============================ footer ============================ */
    function paintFoot() {
      const st = live.status();
      footDot.dataset.st = st;
      footState.textContent = LIVE_TEXT[st] || st;
      const n = onlineNow().length;
      const inv = me().status === 'invisible';
      footCount.textContent = st !== 'live' ? '' : `· ${n === 0 ? 'no one else online' : n === 1 ? '1 other person online' : `${n} other people online`}${inv ? ' · you’re invisible' : ''}`;
    }

    /* ============================ cards & menus ============================ */
    function playingRef(title) {
      const t = String(title || '');
      if (!t) return null;
      const a = ARCADE.find(x => x.title === t);
      if (a) return resolveGame('arcade', a.id);
      if (!catReady) return null;
      const g = CAT.all().find(x => x.title === t || gTitle(x) === t);
      return g ? resolveGame('web', g.id) : null;
    }

    function openCard(p0, anchor) {
      if (!p0 || !ID_RE.test(p0.id)) return;
      if (popFor(anchor)) { closePop(); return; }
      const on = onlineOf(p0.id);
      const p = on || { ...p0, name: nameFor(p0) };
      const isMe = p.id === myId;
      const fr = isFriend(p.id), mu = isMuted(p.id);
      const code = party && party.code();
      const ref = on && on.playing ? playingRef(on.playing) : null;
      const card = h('div.so-pop.so-card', { role: 'dialog', 'aria-label': p.name },
        h('div.so-card__top', avatar(p, 'lg', on ? on.status : null),
          h('div.so-card__who', h('b', { text: isMe ? `${p.name} (you)` : p.name }),
            h('small', { text: isMe ? 'This is you' : on ? STATUS_TEXT[on.status] || 'Online' : 'Not online right now' }))),
        on && on.playing ? h('div.so-card__playing', icon('gamepad'), h('span.grow', { text: `Last launched ${on.playing}` }),
          ref && !isMe && canPlay(ref) ? btn('Play too', 'play', () => { closePop(); play(ref); }) : null) : null,
        isMe ? null : h('div.so-card__acts',
          btn('Message', 'message-circle', () => { closePop(); openDm(p); }, { primary: true }),
          btn(fr ? 'Unstar' : 'Star', 'star', () => { toggleFriend(p); closePop(); }, { fill: fr }),
          btn(mu ? 'Unmute' : 'Mute', mu ? 'volume-2' : 'volume-x', () => { toggleMute(p); closePop(); }),
          code ? btn('Invite to my party', 'users', () => { closePop(); invite(p); }) : null),
        h('p.so-card__warn', icon('info'), h('span', { text: `Names aren’t verified — anyone can use any name. Device tag ${p.id.slice(0, 4)}: random, not proof of who someone is.` })));
      openPop(card, anchor);
    }

    function openDm(p) {
      if (!p || !ID_RE.test(p.id) || p.id === myId) return;
      const cur = S.dms.get(p.id);
      S.dms.set(p.id, {
        id: p.id,
        name: safeName(p.name) || (cur && cur.name) || `Player-${p.id.slice(0, 4)}`,
        color: Number.isFinite(p.color) ? p.color : cur ? cur.color : 200,
        last: cur ? cur.last : Date.now(),
      });
      go(`dm:${p.id}`);
    }

    function invite(p) {
      const code = party && party.code();
      if (!code) return;
      const line = party.inviteText() || `Join my StaticOS party: code ${code} (open Static Party, then Join).`;
      const r = sendMsg(`dm:${p.id}`, line, { partyCode: code });
      if (r === 'sent') note({ icon: 'users', title: `Invite sent to ${p.name}`, message: 'It only arrives if Social is open on their device.' });
      else if (r === 'offline') note({ icon: 'wifi-off', title: 'Invite not sent', message: 'The live channel isn’t connected.' });
      else if (r && r.wait) note({ icon: 'clock', title: 'Slow down', message: `You can send again in ${Math.max(1, Math.ceil(r.wait / 1000))} s.` });
    }

    const JOIN_WHY = {
      invalid: 'That isn’t a valid party code.',
      offline: 'The live channel isn’t reachable — this network may block it.',
      empty: 'No one answered on that code — the party may have ended.',
    };
    /** Only from a click. The party module does the joining; the Party window
        comes up at once and shows it happening. */
    async function joinParty(code) {
      if (!party || !codeOf(code)) return;
      const P = party;
      const cur = P.code();
      const pend = P.joining();
      /* already in it, or already on the way: just bring the Party window up */
      if (cur === code || (pend && pend.code === code)) { if (has('party')) api.openApp('party'); return; }
      if (cur) {
        const yes = await api.confirm({
          title: `Switch to party ${code}?`,
          message: `You’ll leave party ${cur} once someone in ${code} answers. If no one does, you stay where you are.`,
          ok: 'Switch',
        });
        if (!yes) return;
      }
      let ok = false;
      let job;
      try { job = Promise.resolve(P.join(code)); } catch (err) { job = Promise.resolve(false); }
      if (has('party')) api.openApp('party');
      try { ok = await job; } catch (err) { ok = false; }
      if (ok) return;
      /* a join that was superseded (another join, Leave) fails with no error: nothing to report */
      const e = P.lastError();
      if (!e || e.code !== code || !JOIN_WHY[e.reason]) return;
      api.notify({ app: 'social', icon: 'users', timeout: 6000, title: `Couldn’t join party ${code}`, message: JOIN_WHY[e.reason] });
    }

    function personMenu(e, p) {
      if (!p || p.id === myId) return;
      const fr = isFriend(p.id), mu = isMuted(p.id);
      const code = party && party.code();
      menuAt(e, [
        { label: `Message ${p.name}`, icon: 'message-circle', onClick: () => openDm(p) },
        { label: fr ? 'Unstar' : 'Star', icon: 'star', onClick: () => toggleFriend(p) },
        { label: mu ? 'Unmute' : 'Mute', icon: mu ? 'volume-2' : 'volume-x', onClick: () => toggleMute(p) },
        code ? { label: 'Invite to my party', icon: 'users', onClick: () => invite(p) } : null,
      ].filter(Boolean));
    }

    function msgMenu(e, m) {
      const who = { id: m.from, name: m.name, color: m.color };
      const items = [{
        label: 'Copy text', icon: 'copy',
        onClick: () => { try { navigator.clipboard.writeText(m.text).catch(() => {}); } catch (err) { /* no clipboard here */ } },
      }];
      if (!m.mine && m.from !== myId) {
        items.push('-');
        if (S.view !== `dm:${m.from}`) items.push({ label: `Message ${m.name}`, icon: 'message-circle', onClick: () => openDm(who) });
        items.push({ label: isFriend(m.from) ? 'Unstar' : 'Star', icon: 'star', onClick: () => toggleFriend(who) });
        items.push({ label: `Mute ${m.name}`, icon: 'volume-x', onClick: () => toggleMute(who) });
      }
      menuAt(e, items);
    }

    function roomMenu(e) {
      const key = S.view;
      const g = gameOfKey(key);
      const items = [];
      const r = e.currentTarget.getBoundingClientRect();
      if (g) {
        const item = { kind: 'web', id: g.id, title: gTitle(g), art: g.art || null };
        items.push(
          { label: 'Add to Desktop', icon: 'monitor', onClick: () => import('../core/shortcuts.js').then(M => M.addToDesktop(item)).catch(() => {}) },
          { label: 'Save to a collection…', icon: 'bookmark', onClick: () => import('../core/collections.js').then(C => C.pickMenu(api, item, r.left, r.bottom + 4)).catch(() => {}) },
          '-');
      }
      items.push({
        label: 'Clear what you’ve seen here', icon: 'trash', disabled: !(S.logs.get(key) || []).length,
        onClick: () => { S.logs.delete(key); rendered.key = null; soon('log'); },
      });
      api.menu(items, r.left, r.bottom + 4);
    }

    function dmMenu(e, p) {
      const mu = isMuted(p.id);
      const r = e.currentTarget.getBoundingClientRect();
      api.menu([
        { label: mu ? 'Unmute' : 'Mute', icon: mu ? 'volume-2' : 'volume-x', onClick: () => toggleMute(p) },
        { label: 'Clear this conversation', icon: 'trash', disabled: !(S.logs.get(`dm:${p.id}`) || []).length, onClick: () => { S.logs.delete(`dm:${p.id}`); rendered.key = null; soon('log'); } },
        { label: 'Close this conversation', icon: 'x', onClick: () => { S.dms.delete(p.id); S.logs.delete(`dm:${p.id}`); S.unread.delete(`dm:${p.id}`); S.drafts.delete(`dm:${p.id}`); taKey = null; go('lobby'); } },
      ], r.left, r.bottom + 4);
    }

    /* ---------------- you ---------------- */
    function openYou(anchor) {
      if (popFor(anchor)) { closePop(); return; }
      const avSlot = h('div.so-you__av');
      const nameIn = h('input.so-you__name', { type: 'text', maxlength: '24', 'aria-label': 'Your display name', spellcheck: 'false', autocomplete: 'off' });
      nameIn.value = me().name;
      const hues = h('div.so-you__hues', { role: 'group', 'aria-label': 'Colour' }, HUES.map(hue => h('button.so-hue', {
        type: 'button', style: { '--hue': String(hue) }, 'aria-label': `Colour ${hue}°`, 'data-hue': String(hue),
        onclick: () => { setColor(hue); paint(); },
      })));
      const sts = h('div.so-you__st', { role: 'group', 'aria-label': 'Status' }, ['online', 'away', 'busy', 'invisible'].map(s => h('button.so-stbtn', {
        type: 'button', 'data-st': s,
        onclick: () => { identity.setStatus(s); presence.nudge?.(); paint(); },
      }, h('i.so-dot.so-dot--inline', { dataset: { st: s } }), h('span', { text: STATUS_TEXT[s] }))));
      const invNote = h('small.so-you__warn', { text: 'You won’t appear in Online now. Messages you send still show your name.' });
      const shareSw = h('button.switch', {
        type: 'button', role: 'switch', 'aria-label': 'Share what I’m playing',
        onclick: () => { store.set('prefs.sharePlaying', store.get('prefs.sharePlaying') === false); presence.nudge?.(); paint(); },
      });
      function paint() {
        const m = me();
        clear(avSlot);
        avSlot.appendChild(avatar(m, 'lg', m.status));
        for (const b of hues.children) { const on = Number(b.dataset.hue) === m.color; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
        for (const b of sts.children) { const on = b.dataset.st === m.status; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
        invNote.hidden = m.status !== 'invisible';
        const share = store.get('prefs.sharePlaying') !== false;
        shareSw.classList.toggle('is-on', share);
        shareSw.setAttribute('aria-checked', String(share));
      }
      const commit = () => {
        const v = safeName(nameIn.value);
        if (v !== me().name) { identity.setName(v); presence.nudge?.(); }
        nameIn.value = me().name;            /* shows the tidied name, or the fallback if cleared */
        paint();
      };
      nameIn.addEventListener('change', commit);
      nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
      const box = h('div.so-pop.so-you', { role: 'dialog', 'aria-label': 'You' },
        h('div.so-you__top', avSlot,
          h('div.grow', h('label.so-form__l', { text: 'Your name' }), nameIn,
            h('small.so-you__warn', { text: 'Names aren’t verified — anyone can pick any name, including yours.' }))),
        h('div.so-you__sec', h('div.side__label', { text: 'Colour' }), hues),
        h('div.so-you__sec', h('div.side__label', { text: 'Status' }), sts, invNote),
        h('div.so-you__sec.so-you__row',
          h('div.grow', h('b', { text: 'Share what I’m playing' }), h('small', { text: 'Shows the last game you launched next to your name.' })),
          shareSw),
        h('small.so-you__id', { text: `Device tag ${me().id.slice(0, 4)} — random, made on this device. It is not an account.` }));
      paint();
      openPop(box, anchor, 'above');
    }

    function setColor(hue) {
      identity.me();                                    /* makes sure the record exists */
      const v = store.get('portal.identity');
      if (!v || typeof v !== 'object') return;
      store.set('portal.identity', { ...v, color: ((Math.round(hue) % 360) + 360) % 360 });
      presence.nudge?.();
    }

    function openInfo(anchor) {
      if (popFor(anchor)) { closePop(); return; }
      const li = (ic, t) => h('li', icon(ic), h('span', { text: t }));
      const card = h('div.so-pop.so-info', { role: 'dialog', 'aria-label': 'How Social works' },
        h('b.so-info__t', { text: 'How Static Social works' }),
        h('ul.so-info__list',
          li('globe', 'It runs on a public live channel — MQTT over a free public broker. StaticOS has no server of its own and there are no accounts.'),
          li('eye', 'Anyone can read or post on it. Names aren’t verified: anyone can call themselves anything.'),
          li('clock', 'There’s no message history. You only see what’s sent while Social is open, and nothing is stored on a server.'),
          li('lock', 'Direct messages aren’t private — they travel the same public channel.'),
          li('star', 'Stars, mutes and your name are kept on this device only.'),
          li('heart', 'Friends (top of the rail) is private: only people you add with a friend code see you there, and what they see is encrypted for them.'),
          li('wifi-off', 'Some school and work networks block the live channel. If the status bar says Offline, that is probably why.')));
      openPop(card, anchor);
    }

    /* ============================ navigation ============================ */
    const validKey = key => key === 'lobby' || key === 'lfp' || key === 'friends'
      || (key.startsWith('g:') && roomIds().includes(key.slice(2)))
      || (key.startsWith('dm:') && S.dms.has(key.slice(3)));

    function go(key) {
      if (!validKey(key)) return;
      closePop();
      saveDraft();
      if (S.view !== key && S.view === 'lfp') { boardForm = null; clear(formSlot); }
      S.view = key;
      taKey = key;
      ta.value = S.drafts.get(key) || '';
      setDrawer('');
      newPill.hidden = true;
      logEl.hidden = key === 'lfp' || key === 'friends';
      board.hidden = key !== 'lfp';
      fv.el.hidden = key !== 'friends';
      shell.dataset.view = key === 'friends' ? 'friends' : '';
      if (key === 'friends') fv.show(friendsOpts || {}); else { fv.hide(); startPresence(); }
      friendsOpts = null;
      /* Hiding the composer below drops its focus on <body> — but the browser
         only does that after this run, so asking for document.activeElement
         afterwards still answers "the text box". Remember it now instead. */
      const leftComposer = composer.contains(document.activeElement);
      paintHead();
      paintComposer();                                 /* shows or hides the composer… */
      autosize();                                      /* …so it is measured visible */
      if (key === 'lfp') paintBoard(); else renderLog(true);
      S.unread.delete(key);
      paintRail();
      /* keep keyboard focus inside the app, so Alt+↑/↓ still reaches the rail */
      if (key === 'friends') { if (leftComposer || !shell.contains(document.activeElement)) fv.focus(); }
      else if (key !== 'lfp' && !document.body.classList.contains('is-mobile')) ta.focus({ preventScroll: true });
      else if (leftComposer || !shell.contains(document.activeElement)) (key === 'lfp' ? board : logEl).focus({ preventScroll: true });
    }

    function railStep(dir) {
      const keys = [...railList.querySelectorAll('.so-ri')].map(b => b.dataset.key);
      const i = keys.indexOf(S.view);
      const next = keys[(i + dir + keys.length) % keys.length];
      if (next) go(next);
    }
    shell.addEventListener('keydown', e => {
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); railStep(e.key === 'ArrowUp' ? -1 : 1); }
      else if (e.key === 'Escape' && shell.dataset.drawer && !pop) { e.preventDefault(); setDrawer('', true); }
    });

    function addExtraRoom(id) {
      if (pickRooms().includes(id) || S.extra.includes(id)) return;
      S.extra = [...S.extra, id].slice(-MAX_EXTRA_ROOMS);
      subscribeRooms();
    }

    /** A StaticOS link, and only a StaticOS link: the share sheet builds
        `<this page>#game=…`, so anything that is not this very page is
        dropped rather than pasted into someone's message. */
    function ownLink(u) {
      if (typeof u !== 'string' || !u || u.length > 400) return null;
      let url;
      try { url = new URL(u, location.href); } catch (e) { return null; }
      if (url.origin !== location.origin || url.pathname !== location.pathname) return null;
      return /^#(game|arcade|app)=[\w%.~-]{1,120}$/.test(url.hash) ? url.href : null;
    }

    /** js/shell/share.js → "Share to chat": { kind, id, title, link }.
        Nothing is ever posted on someone's behalf — the message is written
        into the composer of the room it belongs to, ready to send. */
    function applyShare(s) {
      const title = oneLine(s.title, 80);
      if (!title) return;
      const link = ownLink(s.link);
      const draft = link ? `${title} — ${link}` : title;
      const id = typeof s.id === 'string' && GAME_ID_RE.test(s.id) ? s.id : null;
      let key = 'lobby';
      if (s.kind === 'web' && id && CAT.byId(id)) { addExtraRoom(id); key = `g:${id}`; }
      if (!validKey(key)) key = 'lobby';
      S.drafts.set(key, draft);
      go(key);
      ta.value = draft;                                /* go() read the draft; keep them in step */
      autosize();
      paintCount();
      sendBtn.disabled = live.status() !== 'live';
      if (!document.body.classList.contains('is-mobile')) {
        ta.focus({ preventScroll: true });
        try { ta.setSelectionRange(draft.length, draft.length); } catch (e) { /* not focusable yet */ }
      }
      flashHint(link ? 'Ready to send — the link opens it in StaticOS.' : 'Ready to send — nothing has been posted yet.', false);
    }

    function applyOpts(o) {
      if (!o || typeof o !== 'object') return;
      if (o.share && typeof o.share === 'object' && !Array.isArray(o.share)) {
        const s = o.share;
        whenCat(() => applyShare(s));
        return;
      }
      if (o.friends || typeof o.friend === 'string' || typeof o.night === 'string') {
        friendsOpts = { friend: typeof o.friend === 'string' ? o.friend : undefined, night: typeof o.night === 'string' ? o.night : undefined };
        go('friends');
        return;
      }
      if (typeof o.dm === 'string' && ID_RE.test(o.dm) && o.dm !== myId) { openDm(peerOf(o.dm)); return; }
      if (o.lfp) {
        const g = o.game && typeof o.game === 'object' ? o.game : null;
        whenCat(() => startPost(g ? resolveGame(g.kind, g.id) : null));
        return;
      }
      if (o.room === 'lobby' || o.room === 'lfp') { go(o.room); return; }
      if (typeof o.room === 'string' && GAME_ID_RE.test(o.room)) {
        const id = o.room;
        whenCat(() => { if (CAT.byId(id)) { addExtraRoom(id); go(`g:${id}`); } });
      }
    }

    /* ============================ paint loop ============================ */
    const dirty = new Set();
    let raf = 0;
    const PAINT = {
      rail: paintRail, head: paintHead, me: paintMe, foot: paintFoot, composer: paintComposer,
      log: () => renderLog(false), board: paintBoard, people: () => paintPeople(false),
    };
    function soon(...parts) {
      if (dead) return;
      parts.forEach(p => dirty.add(p));
      if (!raf) raf = requestAnimationFrame(flush);
    }
    function flush() {
      raf = 0;
      if (dead) return;
      const list = [...dirty];
      dirty.clear();
      for (const p of list) {
        try { PAINT[p](); } catch (err) { console.error('[social] paint', p, err); }
      }
    }

    /* ============================ live wiring ============================ */
    function subscribeRooms() {
      for (const id of roomIds()) {
        if (roomSubs.has(id)) continue;
        roomSubs.add(id);
        offs.push(live.subscribe(`hub/${id}`, t => onRoom(`g:${id}`, t)));
      }
    }

    /* public presence ("Online now") starts with the first public view, so
       opening straight to Friends announces nothing on the public channel */
    let presenceOn = false;
    function startPresence() { if (presenceOn || dead) return; presenceOn = true; presence.start(); }
    let friendsOpts = null;
    watchFriends(api);
    FW.openedAt = Date.now();
    FW.focused = windowFocused;
    offs.push(
      live.subscribe('hub/lobby', t => onRoom('lobby', t)),
      live.subscribe('lfp', onPost),
      live.subscribe(`dm/${myId}`, onDm),
      live.onStatus(st => { soon('foot', 'composer', 'people', 'head', 'rail', 'me'); if (st === 'live') later(reshare, 400); }),
      presence.onChange(onPresence),
      store.sub('portal.identity', () => { mentionName = ''; soon('me', 'foot', 'composer'); }),
      store.sub(K_FRIENDS, () => { peopleSig = ''; soon('people', 'head', 'rail'); }),
      store.sub(K_MUTED, () => { mutedSet = null; peopleSig = ''; railSig = ''; rendered.stale = true; soon('people', 'head', 'rail', 'log', 'board'); }),
      store.sub('prefs.h24', () => { rendered.stale = true; soon('log'); }),
    );

    CAT.load().catch(() => null).then(() => {
      if (dead) return;
      catReady = true;
      pickRooms();
      subscribeRooms();
      if (S.view.startsWith('g:') && !validKey(S.view)) S.view = 'lobby';
      catQueue.splice(0).forEach(fn => { try { fn(); } catch (err) { console.error('[social]', err); } });
      rendered.stale = true;
      soon('rail', 'head', 'log', 'board', 'composer');
    });

    loadParty().then(P => {
      if (dead || !P) return;
      party = P;
      if (P.onChange) offs.push(P.onChange(() => soon('head', 'board')));
      rendered.stale = true;
      soon('head', 'board', 'log');
    });

    const tick = setInterval(() => {
      if (dead) return;
      const now = Date.now();
      let gone = false;
      for (const [k, p] of S.posts) if (expiresAt(p) <= now) { S.posts.delete(k); gone = true; }
      const mp = S.myPost;
      if (mp && expiresAt(mp) <= now) { S.myPost = null; gone = true; }
      else if (mp && now - (mp.shared || 0) >= LFP_RESHARE) reshare();
      for (const [id, q] of S.flood) if (!q.length || now - q[q.length - 1] > FLOOD_SPAN) S.flood.delete(id);
      for (const P of S.polls.values()) if (P.endsAt && !P.ended && now >= P.endsAt) { P.ended = true; repaintPoll(P); }
      if (S.view === 'lfp') soon('board', 'head');
      if (gone) soon('rail', 'head');
    }, TICK_MS);

    /* ============================ first paint ============================ */
    if (S.view.startsWith('dm:') && !S.dms.has(S.view.slice(3))) S.view = 'lobby';
    if (opts && (opts.friends || typeof opts.friend === 'string' || typeof opts.night === 'string')) S.view = 'friends';
    const wanted = S.view;
    const firstView = wanted.startsWith('g:') ? 'lobby' : wanted;   /* game rooms wait for the catalogue */
    paintMe();
    paintFoot();
    paintPeople(true);
    go(firstView);
    if (wanted !== firstView) whenCat(() => { if (S.view === firstView) go(wanted); });
    applyOpts(opts);
    win.onReopen(o => { if (!dead) applyOpts(o); });

    return () => {
      dead = true;
      FW.focused = () => false;
      fv.destroy();
      closePop();
      if (raf) cancelAnimationFrame(raf);
      clearInterval(tick);
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      saveDraft();
      offs.splice(0).forEach(off => { try { off(); } catch (err) { /* already gone */ } });
    };
  },
});
