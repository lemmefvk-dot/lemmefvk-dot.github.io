/* ============================================================
   party.js — Static Party's one party, kept at module level.

   The Party window, the small party pill above the Dock and the
   Social app all read the same state from here, so a party keeps
   running while its window is closed and you move around StaticOS.
   It lives in memory only: a reload ends it. The last code is kept
   on this device (portal.party) so the app can offer to rejoin, and
   so are the people you muted — nothing else, and nothing anywhere
   but this browser.

   TRANSPORT. The shared live channel (live.js: MQTT over a free
   PUBLIC broker). Everything on topic 'party/<code>' is public:
   anyone who knows or guesses a code can read and write it, delivery
   is live only (no history — you see what is said while you are in
   the party), and a locked-down network may block it entirely. Every
   screen that shows a party says so.

   PROTOCOL. JSON on 'party/<code>'. Every message carries `id`, the
   sender's random device identity (identity.js) — NOT verified.
     { t:'hi', name, color }        a joiner asks "who's here?"; members
                                    answer with a heartbeat (jittered).
                                    A tab of this same browser answers its
                                    own identity too, so a join from a
                                    second tab can say "that's you"
     { t:'hb', name, color, status, ready, playing, since, game? }
                                    every 10 s. `since` ranks members for
                                    host succession; the host's beat also
                                    carries the chosen game
     { t:'game', game }             the host picked a game
     { t:'go', game }               the host pressed PLAY TOGETHER
     { t:'chat', text }             party chat, at most 500 characters
     { t:'bye' }                    leaving
     { t:'cd', n }                  the host starts a countdown of n seconds
     { t:'cdx' }                    the host cancels it
     { t:'room', g, c }             the host opened an Arcade room (game id,
                                    six-character code); a member's Join is a click
     { t:'kick', to }               the host removes a member
     { t:'sc', g, s }               my score in Arcade game g, from 'arcade:score'
     the host's beat also carries q (up to 3 Arcade ids: the game-night queue)
     and rm (its open room), so a newcomer or a new host has them.
   A member silent for 30 s drops. The host is the member with the
   earliest `since` still present, so hosting passes on by itself.
   A joiner takes a `since` later than everyone it heard, so a skewed
   clock can't make a newcomer jump the queue.

   SAFETY — anyone can write anything to a public topic, so:
     · messages are size-capped, parsed in a try, and every field is
       bounded (identity.clean / tidy); names lose bidi controls too;
     · a game travels as kind + id only and is resolved against THIS
       device's catalogue (games.data byId / arcadeById). Titles and
       art from the network are never shown or used;
     · 'game' and 'go' are accepted only from the current host, and a
       'go' at most once every 5 s;
     · a 'go' opens the game by itself ONLY for a member who marked
       themselves ready — and that uses the ready mark up, so the next
       game needs a fresh "ready". Everyone else gets a notification
       with a Play button. Nothing else is ever opened;
     · muted people's chat, sounds and room codes are hidden and their 'go' opens nothing;
     · 'cd', 'room', 'kick' and the queue are accepted only from the current host; a
       room code is checked against the six-character alphabet and its game against
       THIS device's Arcade; nothing ever joins a room by itself;
     · a score is taken only from a current member, only for a game this Arcade has,
       as a finite number, at most one per 1.5 s per member. It is what that device
       reported — nobody can check it, and the scoreboard says so;
     · own sending is rate-limited: chat 1 per second and 10 per 30 s,
       state beats coalesced to 1 per second, Play Together once per
       5 s; incoming chat is capped per sender.

   API (Social imports this — keep the names):
     current() -> null | { code, hostId, me:{id,name,color},
                  members:[{id,name,color,ready,playing,isHost,seen,…}],
                  game: null | {kind,id,title,art},
                  chat:[{id,name,color,text,at,…}], … }
     create() -> code          join(code) -> Promise<boolean>
     leave()                   setReady(bool)
     chooseGame({kind,id,title,art})  (host)   playTogether()  (host)
     say(text) -> boolean      onChange(fn) -> unsubscribe
     inviteText() -> string
   and extras for the app: status(), joining(), lastError(), lastCode(),
   forgetLast(), chatWait(), playNow(), mute/unmute/isMuted/muted(),
   normalizeCode(), isCode(), resolveGame(), inviteLink(); and the host's
   startCountdown(n)/cancelCountdown(), openRoom(gameId)/joinRoom(),
   queueAdd/queueRemove/queueMove/queueNext, removeMember(id); sounds()/
   setSounds(), shareScores()/setShareScores(). current() also carries
   queue, room, countdown, played, scores, sounds and shareScores.
   ============================================================ */
import * as live from './live.js';
import { me, clean, tidy } from '../core/identity.js';
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import * as plays from '../core/plays.js';
import * as catalogue from './games.data.js';
import { arcadeById } from '../arcade/index.js';
import { cleanText } from '../core/quickplay.js';
import * as wm from '../core/wm.js';
import * as sfx from '../core/sfx.js';
import { openRoomCode } from '../core/roominvite.js';

/* 32 symbols, no 0/O/1/I: a code read aloud or off a screen can't be misread */
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const KEY = 'portal.party';                 /* { last:{code,at}, muted:[id], sounds:bool, scores:bool } */

const BEAT_MS = 10_000;
const DROP_MS = 30_000;
export const QUIET_MS = 15_000;             /* no beat for this long: "connection quiet" */
const JOIN_WAIT_MS = 3_000;                 /* how long a joiner waits for anyone to answer */
const JOIN_SETTLE_MS = 800;                 /* after the first answer, collect the rest */
const CONNECT_WAIT_MS = 10_000;
const RECONNECT_GRACE_MS = 8_000;
const WIRE_MAX = 4096;
export const TEXT_MAX = 500;
const CHAT_KEEP = 150;
const EVENTS_KEEP = 80;
const MAX_MEMBERS = 24;
const GO_GAP_MS = 5_000;
const KICK_MS = 5 * 60_000;                 /* a removed member's beats are ignored this long */
const ROOM_MS = 20 * 60_000;                /* an Arcade room code is offered this long */
const QUEUE_MAX = 3;
const PLAYED_KEEP = 30;
const SCORE_GAMES = 12;
const SCORE_GAP_MS = 1_500;
const FAR = 9e15;                           /* rank for a member with no usable `since` */

/* ---------------- module state ---------------- */
let P = null;              /* the party, or null */
let pend = null;           /* { code, phase:'connecting'|'asking' } while joining */
let joinSeq = 0;
let lastErr = null;        /* { code, reason:'invalid'|'offline'|'empty'|'self' } */
let goSentAt = 0;
let hiSentAt = 0;          /* a joiner's "who's here?" goes out at most once a second */
const sentChat = [];       /* timestamps of my own chat sends */
const subs = new Set();
let emitQueued = false;

/* ---------------- small helpers ---------------- */
const BIDI = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const safeName = s => tidy(String(s ?? '').replace(BIDI, ''), 24);
/* cut at TEXT_MAX code units without leaving half an emoji behind */
const chatText = s => String(s ?? '').replace(BIDI, '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX).replace(/[\ud800-\udbff]$/, '');
const cfg = () => { const v = store.get(KEY, null); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const myId = () => me().id;
const statusOut = s => (s === 'away' || s === 'busy' ? s : 'online');
const wireGame = g => (g ? { kind: g.kind, id: g.id, title: g.title, art: g.art } : null);
const sameGame = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;

function randomCode() {
  const a = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(a);
  return [...a].map(b => ALPHABET[b & 31]).join('');      /* 256 is a multiple of 32: no bias */
}

/** Pull a party code out of whatever was typed or pasted ("abc-234", an invite line…). */
export function normalizeCode(input) {
  const s = String(input ?? '').toUpperCase().slice(0, 400);
  const flat = s.replace(/[\s\-_.·]/g, '');
  if (flat.length <= CODE_LEN) return flat;
  const tokens = s.split(/[^A-Z0-9]+/).filter(t => CODE_RE.test(t));
  return tokens.length ? tokens[tokens.length - 1] : flat.slice(0, 12);
}
export const isCode = s => CODE_RE.test(String(s || ''));

/* ---------------- change notification ---------------- */
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    const snap = current();
    subs.forEach(fn => { try { fn(snap); } catch (e) { console.error('[party]', e); } });
  });
}
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }

/* ---------------- games: always resolved locally ---------------- */
const safeArt = a => (typeof a === 'string' && /^https?:\/\//i.test(a) && a.length < 800 ? a : null);

/** { kind, id } -> { kind, id, title, art } from THIS device's catalogue, or null. */
export async function resolveGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 120) : '';
  if (!id) return null;
  if (raw.kind === 'arcade') {
    const a = arcadeById(id);
    return a ? { kind: 'arcade', id: a.id, title: a.title, art: null } : null;
  }
  if (raw.kind !== 'web') return null;
  /* byId() before load() would pin the whole OS to the small fallback shelf */
  try { await catalogue.load(); } catch (e) { return null; }
  const g = catalogue.byId(id);
  return g ? { kind: 'web', id: g.id, title: cleanText(g.title) || g.id, art: safeArt(g.art) } : null;
}

/** Open a game that is known to exist here. Only ever called with resolveGame() output. */
function openGame(g) {
  if (!g) return null;
  if (g.kind === 'arcade') {
    if (!arcadeById(g.id)) return null;
    return wm.open('arcade', { game: g.id, players: 1 });
  }
  if (g.kind === 'web') {
    if (!catalogue.isLoaded() || !catalogue.byId(g.id)) return null;
    return wm.open('aether-games', { url: `static://games/${g.id}` });
  }
  return null;
}

/* What I'm playing: the last game this device launched, while its
   window is still open (and only if prefs.sharePlaying allows it —
   the same switch presence.js honours). */
const GAME_WINDOWS = { web: ['aether-games'], arcade: ['arcade'], creation: ['forge', 'studio'] };
function myPlaying() {
  if (store.get('prefs.sharePlaying') === false) return null;
  const r = plays.recent(1)[0];
  if (!r || !r.title || Date.now() - (Number(r.at) || 0) > 6 * 3600e3) return null;
  const apps = GAME_WINDOWS[r.kind] || [];
  let open = false;
  try { open = wm.list().some(w => apps.includes(w.appId)); } catch (e) { open = false; }
  return open ? tidy(String(r.title).replace(BIDI, ''), 60) : null;
}

/* ---------------- mutes (this device only) ---------------- */
export function muted() {
  const m = cfg().muted;
  return Array.isArray(m) ? m.filter(x => typeof x === 'string').slice(-200) : [];
}
export const isMuted = id => !!id && muted().includes(id);
export function mute(id, on = true) {
  if (typeof id !== 'string' || !id || id === myId()) return;
  const list = muted().filter(x => x !== id);
  if (on) list.push(id);
  store.set(KEY, { ...cfg(), muted: list.slice(-200) });
  emit();
}
export const unmute = id => mute(id, false);
export function unmuteAll() { store.set(KEY, { ...cfg(), muted: [] }); emit(); }

/* ---------------- two switches, this device only ---------------- */
export const sounds = () => cfg().sounds !== false;
export function setSounds(on) { store.set(KEY, { ...cfg(), sounds: !!on }); emit(); }
/** Send my Arcade scores to the party (what the scoreboard shows). On by default; off sends nothing. */
export const shareScores = () => cfg().scores !== false;
export function setShareScores(on) { store.set(KEY, { ...cfg(), scores: !!on }); emit(); }
/* the party's little sounds go through the OS sound engine, so Mute and Settings > Sound still rule */
function sound(name) { if (sounds()) { try { sfx.play(name); } catch (e) { /* no audio here */ } } }

/* ---------------- the last code, for "Rejoin" ---------------- */
function remember(code) { store.set(KEY, { ...cfg(), last: { code, at: Date.now() } }); }
export function lastCode() {
  const l = cfg().last;
  return l && isCode(l.code) ? l.code : null;
}
export function forgetLast() { const c = { ...cfg() }; delete c.last; store.set(KEY, c); emit(); }

/* ---------------- ranking / host ---------------- */
function meMember() {
  const m = me();
  return { id: m.id, name: safeName(m.name) || m.name, color: m.color, status: statusOut(m.status),
    ready: P ? P.ready : false, playing: myPlaying(), since: P ? P.since : FAR, seen: Date.now(), you: true };
}
const before = (a, b) => (a.since - b.since) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function ranked() {
  return [meMember(), ...P.members.values()].sort(before);
}
/* the earliest `since` still present; ties go to the smaller id, so every
   device that sees the same members picks the same host */
function hostId() {
  if (!P) return null;
  let best = { id: myId(), since: P.since };
  for (const m of P.members.values()) if (before(m, best) < 0) best = m;
  return best.id;
}
const iAmHost = () => !!P && hostId() === myId();
const nameOf = id => (id === myId() ? 'You' : (P && P.members.get(id)?.name) || 'Someone');

function hostCheck() {
  if (!P) return;
  const h = hostId();
  if (P.host && h !== P.host) {
    if (h === myId()) {
      P.ready = false;                                   /* the host starts games, it doesn't wait for them */
      event('host', 'You’re the host now');
      beatSoon();                                        /* my beat now carries the game */
    } else {
      event('host', `${nameOf(h)} is the host now`);
    }
  }
  P.host = h;
  if (P.cd && P.cd.byId !== h) clearCd(P);
}

/* ---------------- the party record ---------------- */
function makeParty(code, since, unsub) {
  return {
    code, topic: `party/${code}`, since, joinedAt: Date.now(),
    ready: false, members: new Map(), host: null,
    game: null, gameSeq: 0, gameSentAt: 0,
    chat: [], events: [], seq: 0,
    lastGo: null, lastGoAt: 0,
    lastBeat: 0, quietUntil: 0,
    liveAt: live.status() === 'live' ? Date.now() : 0, wasLive: live.status() === 'live',
    unsub, offStatus: null, offId: [], beatT: 0, pruneT: 0, soonT: 0, replyT: 0, gameT: 0,
    flood: new Map(),
    queue: [], room: null, cd: null, cdT: 0, cdAt: 0, roomAt: 0,
    played: [], scores: new Map(), scoreAt: new Map(), kicked: new Map(), kickedAt: new Map(),
  };
}

function event(kind, text) {
  if (!P) return;
  P.events.push({ eid: ++P.seq, kind, text: String(text).slice(0, 200), at: Date.now() });
  if (P.events.length > EVENTS_KEEP) P.events.splice(0, P.events.length - EVENTS_KEEP);
}
function pushChat(c) {
  P.chat.push({ mid: ++P.seq, ...c });
  if (P.chat.length > CHAT_KEEP) P.chat.splice(0, P.chat.length - CHAT_KEEP);
}

function send(obj) {
  if (!P) return false;
  try { return live.publish(P.topic, JSON.stringify({ ...obj, id: myId() })); } catch (e) { return false; }
}

function beat() {
  if (!P) return false;
  const m = me();
  const host = iAmHost();
  const msg = { t: 'hb', name: safeName(m.name) || m.name, color: m.color, status: statusOut(m.status),
    ready: !host && P.ready, playing: myPlaying(), since: P.since };
  if (host) {
    msg.game = wireGame(P.game);
    msg.q = P.queue.slice();
    if (P.room && Date.now() - P.room.at < ROOM_MS) msg.rm = { g: P.room.game, c: P.room.code };
  }
  P.lastBeat = Date.now();
  return send(msg);
}
/* state changes (ready, name, host) go out at most once a second */
function beatSoon() {
  if (!P || P.soonT) return;
  const wait = Math.max(40, 1000 - (Date.now() - P.lastBeat));
  P.soonT = setTimeout(() => { if (!P) return; P.soonT = 0; beat(); }, wait);
}
/* answer a joiner's "who's here?" after a little jitter, so a busy
   party doesn't answer all at once — and never faster than 1/s */
function replySoon() {
  if (!P || P.replyT) return;
  const wait = Math.max(150 + Math.random() * 600, 1000 - (Date.now() - P.lastBeat));
  P.replyT = setTimeout(() => { if (!P) return; P.replyT = 0; beat(); }, wait);
}

function onPageHide() { if (P) quit(); }

function arm() {
  const p = P;
  p.beatT = setInterval(() => { if (P === p) beat(); }, BEAT_MS);
  p.pruneT = setInterval(() => { if (P === p) prune(); }, 3000);
  p.offStatus = live.onStatus(s => {
    if (P !== p) return;
    if (s === 'live' && !p.liveAt) {
      p.liveAt = Date.now();
      if (p.wasLive) {
        /* reconnected: ask who's still here, and don't call their answers "joined" */
        p.quietUntil = Date.now() + 4000;
        const m = me();
        send({ t: 'hi', name: safeName(m.name) || m.name, color: m.color });
      }
      p.wasLive = true;
      beatSoon();
    } else if (s !== 'live') {
      p.liveAt = 0;
    }
    emit();
  });
  /* name, account and what I'm playing go out on the next (coalesced) beat */
  const touched = () => { if (P === p) { beatSoon(); emit(); } };
  p.offId = [store.sub('portal.identity', touched), store.sub('session.user', touched),
    bus.on('game:launch', touched), bus.on('win:close', touched),
    bus.on('arcade:score', e => { if (P === p) reportScore(e); })];
  window.addEventListener('pagehide', onPageHide);
}

function disarm(p) {
  clearInterval(p.beatT); clearInterval(p.pruneT);
  clearTimeout(p.soonT); clearTimeout(p.replyT); clearTimeout(p.gameT); clearInterval(p.cdT);
  p.offStatus?.(); p.offStatus = null;
  p.offId.forEach(f => f?.()); p.offId = [];
  p.unsub?.(); p.unsub = null;
  window.removeEventListener('pagehide', onPageHide);
}

/** Send 'bye' and drop the party. */
function quit() {
  const p = P;
  if (!p) return;
  send({ t: 'bye' });
  disarm(p);
  remember(p.code);
  P = null;
}

function cancelJoin() {
  if (!pend) return;
  joinSeq++;
  pend = null;
}

/* ---------------- incoming ---------------- */
function addMember(peer, raw, seen) {
  const since = Number.isFinite(raw.since) && raw.since > 0 ? Math.min(raw.since, FAR) : FAR;
  const m = {
    id: peer.id, name: safeName(peer.name) || `Player-${peer.id.slice(0, 4)}`, color: peer.color,
    status: statusOut(peer.status), ready: raw.ready === true,
    playing: peer.playing ? tidy(peer.playing.replace(BIDI, ''), 60) || null : null,
    since, seen,
  };
  P.members.set(peer.id, m);
  return m;
}

function onWire(text) {
  if (!P || typeof text !== 'string' || text.length > WIRE_MAX) return;
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const peer = clean(raw);
  if (!peer) return;
  if (peer.id === myId()) {
    /* every tab of this browser shares one identity: another tab asking
       "who's here?" gets an answer, so its join can say "that's you"
       instead of claiming the party is empty */
    if (raw.t === 'hi') replySoon();
    return;
  }
  switch (raw.t) {
    case 'hi': replySoon(); return;
    case 'hb': onBeat(peer, raw); return;
    case 'bye': onBye(peer.id); return;
    case 'game': if (peer.id === hostId()) syncGame(peer.id, raw.game, true); return;
    case 'go': onGo(peer.id, raw.game); return;
    case 'chat': onChat(peer.id, raw.text); return;
    case 'cd': onCountdown(peer.id, raw.n); return;
    case 'cdx': if (peer.id === hostId() && P.cd) { event('cd', `${nameOf(peer.id)} cancelled the countdown`); clearCd(P); emit(); } return;
    case 'room': onRoom(peer.id, raw.g, raw.c); return;
    case 'kick': onKick(peer.id, raw.to); return;
    case 'sc': onScore(peer.id, raw.g, raw.s); return;
    default:
  }
}

function onBeat(peer, raw) {
  const had = P.members.get(peer.id);
  if (!had && P.members.size >= MAX_MEMBERS) return;
  const now = Date.now();
  const gone = P.kicked.get(peer.id);
  if (gone) {
    if (gone > now) {
      /* removed by the host: their beats count for nothing, and the host tells them again */
      if (iAmHost() && now - (P.kickedAt.get(peer.id) || 0) > 10_000) { P.kickedAt.set(peer.id, now); send({ t: 'kick', to: peer.id }); }
      return;
    }
    P.kicked.delete(peer.id);
  }
  const m = addMember(peer, raw, now);
  if (!had && now > P.quietUntil) event('join', `${m.name} joined`);
  else if (had && had.name !== m.name) event('name', `${had.name} is now called ${m.name}`);
  /* "I'm ready": a small sound, unless that person is muted here */
  if (had && !had.ready && m.ready && now > P.quietUntil && hostId() !== peer.id) {
    event('ready', `${m.name} is ready`);
    if (!isMuted(peer.id)) sound('notify');
  }
  if (hostId() === peer.id) mirrorHost(peer.id, raw);
  /* a background tab's timers can be throttled to once a minute, but
     messages still arrive: answer the party so we don't drop out */
  if (now - P.lastBeat > BEAT_MS + 1500) beatSoon();
  hostCheck();
  if (hostId() === peer.id && raw.game) syncGame(peer.id, raw.game, now > P.quietUntil);
  emit();
}

function onBye(id) {
  const m = P.members.get(id);
  if (!m) return;
  P.members.delete(id);
  P.flood.delete(id);
  event('leave', `${m.name} left`);
  hostCheck();
  emit();
}

function prune() {
  if (!P) return;
  /* offline, we can't hear anyone — that says nothing about whether they left */
  if (live.status() !== 'live' || !P.liveAt || Date.now() - P.liveAt < RECONNECT_GRACE_MS) return;
  const now = Date.now();
  let changed = false;
  for (const [id, m] of P.members) {
    if (now - m.seen > DROP_MS) {
      P.members.delete(id);
      P.flood.delete(id);
      event('leave', `${m.name} dropped out (nothing heard for 30 seconds)`);
      changed = true;
    }
  }
  if (changed) { hostCheck(); emit(); }
}

/** The host's game, resolved locally. A null game never clears ours (a new host may not know it). */
function syncGame(fromId, rawGame, announce) {
  if (!P || !rawGame || typeof rawGame !== 'object') return;
  if (P.game && P.game.kind === rawGame.kind && P.game.id === rawGame.id) return;
  const party = P;
  const seq = ++party.gameSeq;
  resolveGame(rawGame).then(g => {
    if (!g || P !== party || seq !== party.gameSeq || hostId() !== fromId) return;
    party.game = g;
    if (announce) event('game', `${nameOf(fromId)} chose ${g.title}`);
    emit();
  });
}

function onGo(fromId, rawGame) {
  if (fromId !== hostId()) return;
  const now = Date.now();
  if (now - P.lastGoAt < GO_GAP_MS) return;
  P.lastGoAt = now;
  const party = P;
  const seq = ++party.gameSeq;
  resolveGame(rawGame).then(g => {
    if (!g || P !== party || hostId() !== fromId) return;
    if (seq === party.gameSeq) party.game = g;
    const who = nameOf(fromId);
    const hush = isMuted(fromId);
    const auto = party.ready && !hush;
    party.lastGo = { game: g, at: Date.now(), byId: fromId, by: who, opened: auto };
    played(party, g, who);
    if (auto) {
      /* the one thing a message may open by itself: a validated catalogue
         or Arcade game, for someone who said they were ready. The ready
         mark is used up — the next game needs a fresh one. */
      party.ready = false;
      openGame(g);
      event('go', `${who} started ${g.title}. It opened for you because you were ready.`);
      beatSoon();
    } else {
      event('go', `${who} started ${g.title}`);
      if (!hush) {
        /* both actions run only on a click: Play opens the validated
           game, the toast itself brings the Party window forward */
        bus.emit('noti:push', {
          app: 'Static Party', icon: 'users', timeout: 15000,
          title: `${who} started ${g.title}`,
          message: 'Your party is playing. You weren’t marked ready, so nothing opened. Join in if you like.',
          actions: [{ label: 'Play', onClick: () => openGame(g) }],
          onClick: () => { try { wm.open('party'); } catch (e) { /* the app isn't registered */ } },
        });
      }
    }
    emit();
  });
}

function onChat(fromId, rawText) {
  const m = P.members.get(fromId);
  if (!m) return;                                   /* members heartbeat before they talk */
  const text = chatText(rawText);
  if (!text) return;
  const now = Date.now();
  const recent = (P.flood.get(fromId) || []).filter(t => now - t < 5000);
  if (recent.length >= 5) { P.flood.set(fromId, recent); return; }     /* flood guard */
  recent.push(now);
  P.flood.set(fromId, recent);
  pushChat({ id: m.id, name: m.name, color: m.color, text, at: now });
  emit();
}

/* ---------------- the host's extras: queue, room, countdown, removal ---------------- */
function mirrorHost(fromId, raw) {
  /* the queue and the open room ride the host's beat, so a newcomer, or whoever hosts next, has them */
  if (Array.isArray(raw.q)) {
    const q = [];
    for (const id of raw.q) if (typeof id === 'string' && arcadeById(id) && !q.includes(id) && q.length < QUEUE_MAX) q.push(id);
    if (q.join() !== P.queue.join()) P.queue = q;
  }
  const rm = raw.rm && typeof raw.rm === 'object' ? raw.rm : null;
  if (rm && typeof rm.c === 'string' && isCode(rm.c) && typeof rm.g === 'string' && arcadeById(rm.g)?.online) {
    if (!P.room || P.room.code !== rm.c) P.room = { game: rm.g, code: rm.c, byId: fromId, at: Date.now() };
  } else if (P.room && P.room.byId === fromId) {
    P.room = null;
  }
}

function played(p, g, by) {
  p.played.push({ game: { kind: g.kind, id: g.id, title: g.title }, by, at: Date.now() });
  if (p.played.length > PLAYED_KEEP) p.played.splice(0, p.played.length - PLAYED_KEEP);
}

const roomNow = () => (P && P.room && Date.now() - P.room.at < ROOM_MS
  ? { game: P.room.game, title: arcadeById(P.room.game)?.title || P.room.game, code: P.room.code,
    by: P.room.byId === myId() ? 'You' : nameOf(P.room.byId), mine: P.room.byId === myId(), at: P.room.at }
  : null);

function clearCd(p) { clearInterval(p.cdT); p.cdT = 0; p.cd = null; }

function cdTick(p) {
  if (P !== p || !p.cd) return;
  const left = Math.ceil((p.cd.endsAt - Date.now()) / 1000);
  if (left <= 0) {
    const mine = p.cd.byId === myId();
    clearCd(p);
    sound('notify');
    if (mine && iAmHost() && !playTogether()) event('cd', 'The countdown ended, but Play Together could not go out. Press it again.');
    emit();
    return;
  }
  if (left !== p.cd.shown) { p.cd.shown = left; if (!isMuted(p.cd.byId)) sound('tap'); }
  emit();
}
function beginCd(byId, n) {
  const p = P;
  clearCd(p);
  p.cdAt = Date.now();
  p.cd = { endsAt: Date.now() + n * 1000, n, byId, by: nameOf(byId), shown: 0 };
  p.cdT = setInterval(() => cdTick(p), 250);
  event('cd', byId === myId() ? `You started a ${n}-second countdown` : `${nameOf(byId)} started a ${n}-second countdown`);
  cdTick(p);
}
function onCountdown(fromId, rawN) {
  if (fromId !== hostId()) return;
  const n = Math.round(Number(rawN));
  if (!(n >= 3 && n <= 10)) return;
  if (Date.now() - P.cdAt < 2000) return;
  beginCd(fromId, n);
}
/** Host: count everyone down, then press Play Together for them. n = 3-10 seconds. */
export function startCountdown(n = 5) {
  if (!P || !iAmHost() || !P.game || P.cd) return false;
  n = Math.round(Number(n));
  if (!(n >= 3 && n <= 10) || live.status() !== 'live') return false;
  if (!send({ t: 'cd', n })) return false;
  beginCd(myId(), n);
  emit();
  return true;
}
export function cancelCountdown() {
  if (!P || !P.cd || P.cd.byId !== myId()) return false;
  send({ t: 'cdx' });
  clearCd(P);
  event('cd', 'You cancelled the countdown');
  emit();
  return true;
}

function onRoom(fromId, rawG, rawC) {
  if (fromId !== hostId()) return;
  const a = typeof rawG === 'string' ? arcadeById(rawG) : null;
  if (!a || !a.online || typeof rawC !== 'string' || !isCode(rawC)) return;
  const now = Date.now();
  if (now - P.roomAt < 3000) return;
  P.roomAt = now;
  const who = nameOf(fromId);
  P.room = { game: a.id, code: rawC, byId: fromId, at: now };
  event('room', `${who} opened a ${a.title} room`);
  if (!isMuted(fromId)) {
    sound('notify');
    /* Join is a click: nothing enters a room by itself */
    bus.emit('noti:push', {
      app: 'Static Party', icon: 'users', timeout: 20000,
      title: `${who} opened a ${a.title} room`,
      message: 'A room has two seats, so the first of you to join gets the second one. Nothing joins until you press Join.',
      actions: [{ label: 'Join', onClick: () => joinRoom() }],
      onClick: () => { try { wm.open('party'); } catch (e) { /* the app isn't registered */ } },
    });
  }
  emit();
}
/** Join the party's open Arcade room. Only ever called from a click. */
export function joinRoom() {
  const r = roomNow();
  if (!r || r.mine) return false;
  try { wm.open('arcade', { join: r.code }); return true; } catch (e) { return false; }
}
/**
 * Host: open an Arcade room for an online game and send its code to every member
 * of the party. A room has two seats, so the first member to join takes the second;
 * the others are told the code anyway.
 * -> { ok, code?, sent?, error?: 'host' | 'game' | 'offline' | 'room' }
 */
export async function openRoom(gameId) {
  if (!P || !iAmHost()) return { ok: false, error: 'host' };
  const a = typeof gameId === 'string' ? arcadeById(gameId) : null;
  if (!a || !a.online) return { ok: false, error: 'game' };
  if (live.status() !== 'live') return { ok: false, error: 'offline' };
  const party = P;
  const code = await openRoomCode(a.id);
  if (!code) return { ok: false, error: 'room' };
  if (P !== party || !iAmHost()) return { ok: false, error: 'host' };
  const others = P.members.size;
  P.room = { game: a.id, code, byId: myId(), at: Date.now() };
  P.game = { kind: 'arcade', id: a.id, title: a.title, art: null };
  P.gameSeq++;
  const sent = send({ t: 'room', g: a.id, c: code });
  send({ t: 'game', game: wireGame(P.game) });
  event('room', others
    ? `You opened a ${a.title} room and sent its code to ${others === 1 ? '1 member' : `${others} members`}`
    : `You opened a ${a.title} room. Nobody else is in the party yet, so the code is only in your room window.`);
  beatSoon();
  emit();
  return { ok: true, code, sent: others, live: sent };
}

/** Host: up to three Arcade games for the night, in order. */
export function queueAdd(id) {
  if (!P || !iAmHost() || typeof id !== 'string' || !arcadeById(id)) return false;
  if (P.queue.length >= QUEUE_MAX || P.queue.includes(id)) return false;
  P.queue.push(id);
  beatSoon();
  emit();
  return true;
}
export function queueRemove(id) {
  if (!P || !iAmHost() || !P.queue.includes(id)) return false;
  P.queue = P.queue.filter(x => x !== id);
  beatSoon();
  emit();
  return true;
}
export function queueMove(id, dir) {
  if (!P || !iAmHost()) return false;
  const i = P.queue.indexOf(id), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= P.queue.length) return false;
  [P.queue[i], P.queue[j]] = [P.queue[j], P.queue[i]];
  beatSoon();
  emit();
  return true;
}
/** Host: take the first game off the queue, choose it and press Play Together. */
export async function queueNext() {
  if (!P || !iAmHost() || !P.queue.length) return false;
  if (live.status() !== 'live' || goWait() > 0) return false;
  const party = P;
  const id = P.queue[0];
  const ok = await chooseGame({ kind: 'arcade', id });
  if (!ok || P !== party) return false;
  if (!playTogether()) return false;
  P.queue = P.queue.filter(x => x !== id);
  beatSoon();
  emit();
  return true;
}

/** Host: take someone out. They are told, and their beats are ignored for five minutes. */
export function removeMember(id) {
  if (!P || !iAmHost() || id === myId()) return false;
  const m = P.members.get(id);
  if (!m) return false;
  send({ t: 'kick', to: id });
  dropKicked(id, m.name);
  hostCheck();
  emit();
  return true;
}
function dropKicked(id, name) {
  P.members.delete(id);
  P.flood.delete(id);
  P.kicked.set(id, Date.now() + KICK_MS);
  event('leave', `${name} was removed from the party`);
}
function onKick(fromId, to) {
  if (fromId !== hostId() || typeof to !== 'string') return;
  if (to === myId()) {
    const code = P.code;
    quit();
    forgetLast();
    bus.emit('noti:push', { app: 'Static Party', icon: 'users', timeout: 12000, title: 'The host removed you from the party',
      message: `Party ${code} is public, so you can try to join again, but the host can remove you again.` });
    emit();
    return;
  }
  const m = P.members.get(to);
  if (m) { dropKicked(to, m.name); hostCheck(); emit(); }
}

/* ---------------- scores reported from the Arcade ---------------- */
const scoreOk = s => typeof s === 'number' && Number.isFinite(s) && Math.abs(s) <= 1e9;
function recordScore(id, name, color, game, score) {
  const a = arcadeById(game);
  if (!a || !scoreOk(score)) return;
  let byGame = P.scores.get(id);
  if (!byGame) P.scores.set(id, byGame = new Map());
  const low = a.better === 'low';
  const prev = byGame.get(game);
  const best = prev && (low ? prev.best <= score : prev.best >= score) ? prev.best : score;
  byGame.set(game, { best, last: score, n: (prev ? prev.n : 0) + 1, at: Date.now(), name, color });
  if (byGame.size > SCORE_GAMES) byGame.delete(byGame.keys().next().value);
}
/* my own device reports, from the same 'arcade:score' event the achievements read */
function reportScore(e) {
  if (!P || !e || typeof e !== 'object' || e.assisted || !shareScores()) return;
  const a = typeof e.game === 'string' ? arcadeById(e.game) : null;
  if (!a || !scoreOk(e.score)) return;
  const now = Date.now();
  if (now - (P.scoreAt.get(myId()) || 0) < SCORE_GAP_MS) return;
  P.scoreAt.set(myId(), now);
  const m = me();
  recordScore(myId(), safeName(m.name) || m.name, m.color, a.id, e.score);
  send({ t: 'sc', g: a.id, s: e.score });
  emit();
}
function onScore(fromId, g, s) {
  const m = P.members.get(fromId);
  if (!m || typeof g !== 'string' || !arcadeById(g) || !scoreOk(s)) return;
  const now = Date.now();
  if (now - (P.scoreAt.get(fromId) || 0) < SCORE_GAP_MS) return;
  P.scoreAt.set(fromId, now);
  recordScore(fromId, m.name, m.color, g, s);
  emit();
}
/** One board per game, newest activity first; the best score each member reported. */
function scoreBoards(hushed) {
  if (!P) return [];
  const games = new Map();
  for (const [id, byGame] of P.scores) {
    if (hushed.has(id)) continue;
    for (const [g, r] of byGame) {
      if (!games.has(g)) games.set(g, []);
      games.get(g).push({ id, name: r.name, color: r.color, you: id === myId(), score: r.best, last: r.last, n: r.n, at: r.at });
    }
  }
  return [...games].map(([g, rows]) => {
    const a = arcadeById(g);
    const low = a?.better === 'low';
    rows.sort((x, y) => (low ? x.score - y.score : y.score - x.score) || x.at - y.at);
    return { game: g, title: a ? a.title : g, better: low ? 'low' : 'high', at: Math.max(...rows.map(r => r.at)), rows };
  }).sort((x, y) => y.at - x.at);
}

/* ---------------- public API ---------------- */
export function current() {
  if (!P) return null;
  const m = me();
  const list = ranked();
  const host = list[0].id;
  const hushed = new Set(muted());
  const isMuted = id => hushed.has(id);
  return {
    code: P.code,
    hostId: host,
    me: { id: m.id, name: safeName(m.name) || m.name, color: m.color },
    members: list.map(x => ({
      id: x.id, name: x.name, color: x.color,
      ready: x.id === host ? false : !!x.ready,
      playing: x.playing || null,
      isHost: x.id === host,
      seen: x.seen,
      status: x.status,
      you: x.id === m.id,
      muted: x.id !== m.id && isMuted(x.id),
    })),
    game: P.game ? { ...P.game } : null,
    chat: P.chat.filter(c => c.mine || !isMuted(c.id)).map(c => ({ ...c })),
    /* extras */
    isHost: host === m.id,
    ready: P.ready,
    events: P.events.map(e => ({ ...e })),
    lastGo: P.lastGo ? { ...P.lastGo, game: { ...P.lastGo.game } } : null,
    joinedAt: P.joinedAt,
    status: live.status(),
    queue: P.queue.map(id => ({ id, title: arcadeById(id)?.title || id })),
    room: roomNow(),
    countdown: P.cd ? { left: Math.max(0, Math.ceil((P.cd.endsAt - Date.now()) / 1000)), n: P.cd.n, by: P.cd.by, byId: P.cd.byId } : null,
    played: P.played.map(x => ({ ...x })),
    scores: scoreBoards(hushed),
    sounds: sounds(),
    shareScores: shareScores(),
  };
}

export function create() {
  cancelJoin();
  lastErr = null;
  if (P) quit();
  const code = randomCode();
  const unsub = live.subscribe(`party/${code}`, text => { if (P && P.code === code) onWire(text); });
  P = makeParty(code, Date.now(), unsub);
  arm();
  remember(code);
  event('you', 'You started the party');
  P.host = myId();
  beat();                                           /* no-op until the channel is live; arm() re-beats then */
  emit();
  return code;
}

function waitLive(ms) {
  if (live.status() === 'live') return Promise.resolve(true);
  return new Promise(res => {
    let off = null;
    let done = false;
    const finish = v => { if (done) return; done = true; clearTimeout(t); queueMicrotask(() => off?.()); res(v); };
    const t = setTimeout(() => finish(false), ms);
    off = live.onStatus(s => { if (s === 'live') finish(true); });
  });
}

export async function join(input) {
  const code = normalizeCode(input);
  lastErr = null;
  if (!CODE_RE.test(code)) { lastErr = { code, reason: 'invalid' }; emit(); return false; }
  if (P && P.code === code) return true;
  cancelJoin();
  const token = ++joinSeq;
  const alive = () => token === joinSeq;
  const topic = `party/${code}`;
  const heard = new Map();
  let selfSeen = false;      /* this identity is already in that party, in another tab */
  let wake = null;
  let party = null;

  /* one subscription: it collects answers while we probe, and becomes
     the party's own feed if we get in */
  const unsub = live.subscribe(topic, text => {
    if (party) { if (P === party) onWire(text); return; }
    if (typeof text !== 'string' || text.length > WIRE_MAX) return;
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return; }
    if (!raw || typeof raw !== 'object' || raw.t !== 'hb') return;
    const peer = clean(raw);
    if (!peer) return;
    if (peer.id === myId()) { selfSeen = true; return; }
    if (!heard.has(peer.id) && heard.size >= MAX_MEMBERS) return;
    heard.set(peer.id, { peer, raw, at: Date.now() });
    wake?.();
  });
  const fail = reason => {
    unsub();
    if (alive()) { pend = null; lastErr = { code, reason }; emit(); }
    return false;
  };

  pend = { code, phase: 'connecting' };
  emit();
  const up = await waitLive(CONNECT_WAIT_MS);
  if (!alive()) return fail('cancelled');
  if (!up) return fail('offline');

  pend = { code, phase: 'asking' };
  emit();
  const gap = 1000 - (Date.now() - hiSentAt);
  if (gap > 0) {
    await new Promise(res => setTimeout(res, gap));
    if (!alive()) return fail('cancelled');
  }
  const m = me();
  hiSentAt = Date.now();
  live.publish(topic, JSON.stringify({ t: 'hi', id: m.id, name: safeName(m.name) || m.name, color: m.color }));
  await new Promise(res => {
    const t = setTimeout(res, JOIN_WAIT_MS);
    wake = () => { wake = null; clearTimeout(t); setTimeout(res, JOIN_SETTLE_MS); };
    if (heard.size) wake();
  });
  if (!alive()) return fail('cancelled');
  if (!heard.size) return fail(selfSeen ? 'self' : 'empty');

  /* someone is there: switch parties */
  if (P) quit();
  let maxSince = 0;
  for (const { raw } of heard.values()) if (Number.isFinite(raw.since) && raw.since < FAR) maxSince = Math.max(maxSince, raw.since);
  party = P = makeParty(code, Math.max(Date.now(), maxSince + 1), unsub);
  P.quietUntil = Date.now() + 4000;
  for (const { peer, raw, at } of heard.values()) addMember(peer, raw, at);
  pend = null;
  arm();
  remember(code);
  event('you', 'You joined the party');
  P.host = hostId();
  beat();
  const h = heard.get(P.host);
  if (h && h.raw.game) syncGame(P.host, h.raw.game, false);
  emit();
  return true;
}

export function leave() {
  cancelJoin();
  if (P) quit();
  emit();
}

export function setReady(on) {
  if (!P || iAmHost()) return false;
  const v = !!on;
  if (P.ready !== v) {
    P.ready = v;
    if (v) sound('toggle');
    beatSoon();
    emit();
  }
  return true;
}

export async function chooseGame(input) {
  if (!P || !iAmHost()) return false;
  const party = P;
  const g = await resolveGame(input);
  if (!g || P !== party || !iAmHost()) return false;
  const changed = !sameGame(P.game, g);
  P.game = g;
  P.gameSeq++;
  if (changed) {
    event('game', `You chose ${g.title}`);
    /* at most one 'game' message a second; the latest choice wins */
    if (!P.gameT) {
      const wait = Math.max(0, 1000 - (Date.now() - P.gameSentAt));
      P.gameT = setTimeout(() => {
        if (P !== party) return;
        party.gameT = 0;
        party.gameSentAt = Date.now();
        send({ t: 'game', game: wireGame(party.game) });
      }, wait);
    }
  }
  emit();
  return true;
}

/** Host only. Sends 'go' and opens the game here. false if it couldn't go out. */
export function playTogether() {
  if (!P || !iAmHost() || !P.game) return false;
  const now = Date.now();
  if (now - goSentAt < GO_GAP_MS) return false;
  if (live.status() !== 'live') return false;
  const g = P.game;
  if (!send({ t: 'go', game: wireGame(g) })) return false;
  goSentAt = now;
  P.lastGo = { game: g, at: now, byId: myId(), by: 'You', opened: true };
  played(P, g, 'You');
  event('go', `You started ${g.title} for the party`);
  openGame(g);
  emit();
  return true;
}
/** ms before Play Together can be pressed again */
export const goWait = () => Math.max(0, GO_GAP_MS - (Date.now() - goSentAt));

/** Open the party's game here, because this person clicked Play. */
export function playNow() {
  const g = P && (P.game || (P.lastGo && P.lastGo.game));
  return g ? !!openGame(g) : false;
}

/** ms until say() may send again (0 = now) */
export function chatWait() {
  const now = Date.now();
  while (sentChat.length && now - sentChat[0] > 30_000) sentChat.shift();
  const lastAt = sentChat[sentChat.length - 1];
  let wait = 0;
  if (lastAt && now - lastAt < 1000) wait = 1000 - (now - lastAt);
  if (sentChat.length >= 10) wait = Math.max(wait, 30_000 - (now - sentChat[0]));
  return wait;
}

export function say(input) {
  if (!P) return false;
  const text = chatText(input);
  if (!text || chatWait() > 0) return false;
  const m = me();
  const name = safeName(m.name) || m.name;
  if (!send({ t: 'chat', name, color: m.color, text })) return false;
  sentChat.push(Date.now());
  pushChat({ id: m.id, name, color: m.color, text, at: Date.now(), mine: true });
  emit();
  return true;
}

/** A link that opens Static Party with this code filled in; the person presses Join. */
export function inviteLink() {
  if (!P) return '';
  try { return `${location.origin}${location.pathname}#party=${P.code}`; } catch (e) { return ''; }
}

export function inviteText() {
  return P ? `Join my StaticOS party: code ${P.code} (open Static Party, then Join).` : '';
}

export const status = () => live.status();
export const joining = () => (pend ? { ...pend } : null);
export const lastError = () => (lastErr ? { ...lastErr } : null);
export const clearError = () => { if (lastErr) { lastErr = null; emit(); } };

export default {
  current, create, join, leave, setReady, chooseGame, playTogether, say, onChange, inviteText,
  status, joining, lastError, clearError, lastCode, forgetLast, chatWait, goWait, playNow,
  mute, unmute, unmuteAll, isMuted, muted, inviteLink, startCountdown, cancelCountdown, openRoom, joinRoom,
  queueAdd, queueRemove, queueMove, queueNext, removeMember, sounds, setSounds, shareScores, setShareScores, normalizeCode, isCode, resolveGame, ALPHABET, CODE_LEN, TEXT_MAX, QUIET_MS,
};
