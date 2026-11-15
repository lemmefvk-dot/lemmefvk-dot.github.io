/* ============================================================
   chat.transport.js — the seam under Static Chat.

   The UI never touches storage or a socket directly. It asks
   this module, which today answers from a persisted local store
   and nobody else: there is no chat server. Swap `config.mode` to
   'live' and point `config.endpoint` at a real server and the
   same UI keeps working.

   Interface (everything async so a socket can slot in):
     listSpaces()                  -> Space[]
     listChannels(spaceId)         -> Channel[]
     listMessages(channelId,{before,limit}) -> Message[]
     send(channelId, {body, replyTo}) -> Message
     react(messageId, emoji)       -> Message
     edit(messageId, body)         -> Message
     remove(messageId)             -> boolean
     members(spaceId)              -> Member[]
     subscribe(fn)                 -> unsubscribe        (events)
     setTyping(channelId, on)      -> void
     markRead(channelId)           -> void

   Events pushed to subscribers:
     {type:'message', message}  {type:'typing', channelId, who, on}
     {type:'presence', member}  {type:'read', channelId}
     {type:'react', message}    {type:'edit', message}  {type:'remove', id}
     {type:'space'}             a shared space connected, left or failed

   WHO IS ACTUALLY HERE. Three kinds of room, and only two have anyone in them:
     · the built-in spaces (Static, Arcade, Screening, Build) are local:
       they keep what you write on this device, nothing is sent anywhere;
     · "Friends" holds one channel per accepted friend (js/core/friends.js
       sendDm): a direct message reaches that friend's device through your
       sealed friend topic, and nobody else;
     · a shared space is a private two-person pair.js room (kind 'chat'),
       opened with a code like Notes' Write Together. Nothing is kept on a
       server in any case: each device keeps its own copy.
   Every message says honestly where it went: delivery 'sent' (handed to a
   live connection) or 'local' (saved here only). Nothing ever says "read".
   Wire format and checks: js/core/chatwire.js.
   ============================================================ */
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import * as wm from '../core/wm.js';
import * as FR from '../core/friends.js';
import { openPair } from '../core/pair.js';
import { me as identityMe } from '../core/identity.js';
import { isCode, normalizeCode, safeName, hueOf } from '../core/roomcode.js';
import * as W from '../core/chatwire.js';
import * as POLL from '../core/polls.js';

export const config = {
  mode: 'local',        // 'local' | 'live'
  endpoint: null,       // e.g. 'wss://your-host/chat'
  token: null,
};

const KEY = 'portal.chat';
/* localStorage is a few MB for the WHOLE OS, and every message we keep is
   persisted. Cap the scrollback per channel so a long session can never wedge
   the store (a failed write would silently lose prefs too). */
const MAX_PER_CHANNEL = 300;
let seq = 0;
const uid = p => `${p}-${Date.now().toString(36)}-${(++seq).toString(36)}`;
const now = () => Date.now();

/* ------------------------------------------------------------------ *
 *  people
 * ------------------------------------------------------------------ */
/* you: named after the signed-in StaticOS account (read live, so signing
   in or out renames you everywhere in Chat) */
export const ME = {
  id: 'me', hue: 340, role: 'You', status: 'online',
  get name() { const u = store.get('session.user', null); return (u && (u.name || u.username)) || 'You'; },
  get initials() { return (this.name.trim().charAt(0) || 'Y').toUpperCase(); },
};

/* Ids the old local simulation used for its invented members. They are no
   longer people anywhere; the list only lets load() sweep their leftovers. */
const RETIRED_IDS = ['zxs', 'divine', 'apbz', 'fourx', 'josh', 'nova', 'kite'];

/* The people other than you are real: a friend ('f:<fp>') or the person at
   the other end of a shared space ('rp:<space id>'). Nobody else exists. */
const PRESENCE = { online: 'online', away: 'idle', busy: 'dnd', offline: 'offline' };
const initialsOf = n => (String(n).trim().charAt(0) || '?').toUpperCase();
function friendPerson(fp) {
  let f = null;
  try { f = FR.friends().find(x => x.fp === fp) || null; } catch (e) { /* friends not running */ }
  if (!f) return { id: `f:${fp}`, name: 'A friend', initials: 'F', hue: 200, role: 'Friend', status: 'offline' };
  return { id: `f:${fp}`, name: f.display, initials: initialsOf(f.display), hue: f.hue, role: (f.status && f.status.text) || 'Friend', status: PRESENCE[f.presence] || 'offline' };
}
function roomPerson(spaceId) {
  const sp = load().spaces.find(x => x.id === spaceId);
  const name = (sp && sp.peerName) || 'Your friend';
  const S = sessions.get(spaceId);
  return { id: `rp:${spaceId}`, name, initials: initialsOf(name), hue: sp ? sp.peerHue : 200, role: 'In this space',
    status: S && S.room.phase === 'paired' ? 'online' : 'offline' };
}
export const personById = id => {
  if (id === ME.id) return ME;
  if (typeof id !== 'string') return null;
  if (id.startsWith('f:')) return friendPerson(id.slice(2));
  if (id.startsWith('rp:')) return roomPerson(id.slice(3));
  return null;
};
export const everyone = () => [ME];

const SPACES = [
  { id: 'aether', name: 'Static', glyph: 'diamond', g1: '#ff9bb0', g2: '#b8123c',
    blurb: 'The main room.' },
  { id: 'arcade', name: 'Arcade', glyph: 'gamepad', g1: '#a9e08a', g2: '#2f7d2a',
    blurb: 'Games, scores and bug reports.' },
  { id: 'screen', name: 'Screening', glyph: 'film', g1: '#c4a2ff', g2: '#5b21b6',
    blurb: 'Anime and film nights.' },
  { id: 'build',  name: 'Build', glyph: 'code', g1: '#8fd0ff', g2: '#1f5fd0',
    blurb: 'Shipping the shell.' },
];
const DM_SPACE = { id: 'dm', name: 'Friends', glyph: 'users', g1: '#ffd27a', g2: '#c4741a',
  blurb: 'Direct messages with the friends you have added.', dm: true };
/* Not a simulated room: this one is wired to the real Discord API.
   `external` tells the UI to hand the body to the Discord panel. */
const DISCORD_SPACE = { id: 'discord', name: 'Discord', glyph: 'message-circle', g1: '#8b9cff', g2: '#3d46b5',
  blurb: 'Your real server, live.', external: true };

const CHANNELS = [
  { id: 'general',   spaceId: 'aether', name: 'general',    topic: 'Anything goes.' },
  { id: 'welcome',   spaceId: 'aether', name: 'welcome',    topic: 'Say hello.' },
  { id: 'announce',  spaceId: 'aether', name: 'announcements', topic: 'Read-only-ish.', muted: true },
  { id: 'now',       spaceId: 'arcade', name: 'now-playing', topic: 'What is on your screen.' },
  { id: 'scores',    spaceId: 'arcade', name: 'high-scores', topic: 'Post the number.' },
  { id: 'broken',    spaceId: 'arcade', name: 'broken-games', topic: 'Report a dead embed.' },
  { id: 'anime',     spaceId: 'screen', name: 'anime',      topic: 'Currently airing.' },
  { id: 'films',     spaceId: 'screen', name: 'films',      topic: 'Watchlist talk.' },
  { id: 'shell',     spaceId: 'build',  name: 'shell',      topic: 'The compositor and the shell.' },
  { id: 'design',    spaceId: 'build',  name: 'design',     topic: 'Type, colour, motion.' },
  { id: 'dc-server', spaceId: 'discord', name: 'server',     topic: 'Live from Discord.', external: true },
];

/* ------------------------------------------------------------------ *
 *  state
 * ------------------------------------------------------------------ */
/* spaces: shared spaces made or joined with a code — { id, name, code, role, peerName, peerHue, at }.
   muted: channel id -> true/false, overriding the built-in default. */
function blank() {
  return { messages: {}, read: {}, drafts: {}, spaces: [], muted: {} };
}

let state = null;
function load() {
  if (state) return state;
  const saved = store.get(KEY);
  state = saved && saved.messages ? { ...blank(), ...saved } : blank();
  if (!Array.isArray(state.spaces)) state.spaces = [];
  if (!state.muted || typeof state.muted !== 'object') state.muted = {};
  /* Sweep what the old local simulation left behind (seeded lines and
     replies from its invented members). Whatever you wrote, and anything a
     real transport supplied, stays. */
  for (const [channelId, rows] of Object.entries(state.messages)) {
    state.messages[channelId] = rows.filter(m =>
      !String(m.id).startsWith('seed-') && !RETIRED_IDS.includes(m.author));
  }
  persist();
  return state;
}
function trim() {
  for (const [id, rows] of Object.entries(state.messages)) {
    if (rows.length > MAX_PER_CHANNEL) state.messages[id] = rows.slice(-MAX_PER_CHANNEL);
  }
}
/* A fresh wrapper every time, on purpose: store.set() short-circuits on
   `obj[key] === value`, so handing it the same `state` object twice would
   silently skip the write — after a reload (where state IS the object the
   store already holds) nothing would ever be saved again. */
const persist = () => { trim(); store.set(KEY, { ...state }); };

const subs = new Set();
export function subscribe(fn) {
  subs.add(fn);
  watchFriends();
  return () => subs.delete(fn);
}
function emit(ev) { for (const fn of subs) { try { fn(ev); } catch (err) { console.error('[chat]', err); } } }

/* friends coming and going (and their presence) reach the rail, throttled */
let friendsOff = null, friendsT = 0;
function watchFriends() {
  if (friendsOff) return;
  try {
    friendsOff = FR.onChange(() => {
      if (friendsT || !subs.size) return;
      friendsT = setTimeout(() => { friendsT = 0; emit({ type: 'presence' }); }, 800);
    });
  } catch (e) { friendsOff = null; }
}

/* ------------------------------------------------------------------ *
 *  live-mode transport (one place to implement)
 * ------------------------------------------------------------------ */
const live = () => config.mode === 'live';
async function call(path, init) {
  if (!config.endpoint) throw new Error('chat: no endpoint configured');
  const res = await fetch(config.endpoint.replace(/\/$/, '') + path, {
    ...init,
    headers: { 'content-type': 'application/json',
               ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
  });
  if (!res.ok) throw new Error(`chat: HTTP ${res.status}`);
  return res.json();
}

/* ------------------------------------------------------------------ *
 *  where a channel's messages go
 * ------------------------------------------------------------------ */
const dmFp = channelId => (String(channelId).startsWith('dm:') ? String(channelId).slice(3) : null);
const roomOf = channelId => (String(channelId).startsWith('rm-') ? String(channelId).split('.')[0] : null);
const mainChannel = spaceId => `${spaceId}.main`;
/** 'local' (this device only) | 'dm' | 'room' */
export const kindOfChannel = channelId => (dmFp(channelId) ? 'dm' : roomOf(channelId) ? 'room' : 'local');
const authorFor = channelId => (dmFp(channelId) ? `f:${dmFp(channelId)}` : roomOf(channelId) ? `rp:${roomOf(channelId)}` : null);

const sessions = new Map();          /* space id -> { room, offs, pieces, everPaired, error } */

/** Hand a wire body to the channel's connection. -> true when a live connection took it. */
async function deliver(channelId, wire) {
  const fp = dmFp(channelId);
  if (fp) {
    const r = await FR.sendDm(fp, wire);
    return !!(r.ok && r.live);
  }
  const sid = roomOf(channelId);
  if (sid) {
    const S = sessions.get(sid);
    if (!S || S.room.phase !== 'paired') return false;
    try { return !!S.room.send('cm', wire); } catch (e) { return false; }
  }
  return false;
}

function listAllChannels() {
  const st = load();
  const out = CHANNELS.map(c => ({ ...c }));
  for (const sp of st.spaces) out.push(roomChannel(sp));
  out.push(...dmChannels());
  return out;
}
function dmChannels() {
  let list = [];
  try { list = FR.available() ? FR.friends() : []; } catch (e) { list = []; }
  return list.map(f => ({ id: `dm:${f.fp}`, spaceId: 'dm', name: f.display, kind: 'dm', fp: f.fp,
    topic: `Only you and ${f.display}. Goes through your private friend link.` }));
}
function roomChannel(sp) {
  const S = sessions.get(sp.id);
  return { id: mainChannel(sp.id), spaceId: sp.id, name: 'general', kind: 'room', code: sp.code,
    topic: sp.peerName ? `Shared with ${sp.peerName}` : 'Shared by a code: waiting for your friend.',
    live: !!S && S.room.phase === 'paired' };
}

function counts(channelId) {
  const st = load();
  const rows = st.messages[channelId] || [];
  return {
    unread: Math.max(0, rows.filter(m => m.at > (st.read[channelId] || 0) && m.author !== ME.id).length),
    last: rows.slice(-1)[0] || null,
  };
}
const isMuted = c => (load().muted[c.id] !== undefined ? !!load().muted[c.id] : !!c.muted);

/* ------------------------------------------------------------------ *
 *  api
 * ------------------------------------------------------------------ */
export async function listSpaces() {
  if (live()) return call('/spaces');
  const st = load();
  const all = [...SPACES, DM_SPACE,
    ...st.spaces.map(sp => ({ id: sp.id, name: sp.name, glyph: 'link', g1: '#7fe3d1', g2: '#127a6a',
      blurb: sp.peerName ? `Shared with ${sp.peerName}` : 'Shared by a code', shared: true, code: sp.code, role: sp.role })),
    DISCORD_SPACE];
  return all.map(s => ({ ...s, unread: unreadFor(s.id) }));
}

export async function listChannels(spaceId) {
  if (live()) return call(`/spaces/${spaceId}/channels`);
  return listAllChannels().filter(c => c.spaceId === spaceId).map(c => ({ ...c, muted: isMuted(c), ...counts(c.id) }));
}

function unreadFor(spaceId) {
  return listAllChannels().filter(c => c.spaceId === spaceId && !isMuted(c)).reduce((n, c) => n + counts(c.id).unread, 0);
}

export async function listMessages(channelId, { limit = 200 } = {}) {
  if (live()) return call(`/channels/${channelId}/messages?limit=${limit}`);
  const st = load();
  return (st.messages[channelId] || []).slice(-limit);
}

const findMsg = id => {
  const st = load();
  for (const [ch, rows] of Object.entries(st.messages)) {
    const m = rows.find(x => x.id === id);
    if (m) return { m, ch, rows };
  }
  return null;
};
const preview = m => ({
  stk: 'sent a sticker', voice: 'sent a voice message', poll: `started a poll: ${(m.poll && m.poll.q) || ''}`,
  card: `shared ${(m.card && (m.card.ti || m.card.k)) || 'a page'}`, file: `shared a file: ${(m.file && m.file.n) || ''}`,
}[m.kind] || String(m.body || ''));

/** The wire body for a message record. */
function wireOf(m) {
  if (m.kind === 'stk') return { k: 'stk', id: m.id, s: m.sticker };
  if (m.kind === 'card') return { k: 'card', id: m.id, c: { k: m.card.k, i: m.card.i, ti: m.card.ti || '' } };
  if (m.kind === 'file') return { k: 'file', id: m.id, n: m.file.n, z: m.file.z };
  if (m.kind === 'poll') return { k: 'poll', id: m.id, p: { pid: m.poll.pid, q: m.poll.q, opts: m.poll.opts, multi: m.poll.multi, anon: m.poll.anon, dur: m.poll.dur } };
  return { k: 'txt', id: m.id, b: m.body, rt: m.replyTo && W.ID_RE.test(m.replyTo) ? m.replyTo : null };
}

/**
 * Send something you wrote. `kind` is 'txt' (default), 'stk' (sticker), 'card' (card:{k,i,ti}),
 * 'file' (file:{n,z,path?}) or 'poll' (poll: meta from polls.parsePoll).
 * The record says where it went: delivery 'sent' or 'local'.
 */
export async function send(channelId, { body, replyTo = null, author = ME.id, kind = 'txt', sticker, card, file, poll } = {}) {
  const text = String(body || '').trim();
  if (kind === 'txt' && !text) return null;
  if (live()) return call(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ body: text, replyTo }) });

  const st = load();
  const msg = { id: W.newId(), channelId, author, body: text, at: now(), reactions: {}, edited: false, replyTo, kind, delivery: 'local' };
  if (kind === 'stk') { msg.sticker = sticker; msg.body = 'Sticker'; }
  if (kind === 'card') { msg.card = { k: card.k, i: card.i, ti: String(card.ti || '').slice(0, 80) }; msg.body = card.ti || 'Shared a page'; }
  if (kind === 'file') { msg.file = { n: String(file.n).slice(0, 120), z: file.z || 0, path: file.path || null }; msg.body = file.n; }
  if (kind === 'poll') {
    const P = POLL.newPoll(poll, { id: ME.id, name: ME.name, color: ME.hue }, channelId, msg.at);
    polls.set(msg.id, P);
    msg.poll = serialize(P);
    msg.body = `Poll: ${poll.q}`;
  }
  (st.messages[channelId] ||= []).push(msg);
  st.read[channelId] = msg.at;
  persist();
  emit({ type: 'message', message: msg });
  if (kindOfChannel(channelId) !== 'local') {
    const ok = await deliver(channelId, wireOf(msg));
    if (ok) { msg.delivery = 'sent'; persist(); emit({ type: 'edit', message: msg }); }
  }
  return msg;
}

export async function react(messageId, emoji, who = ME.id) {
  if (live()) return call(`/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
  const hit = findMsg(messageId);
  if (!hit) return null;
  const { m, ch } = hit;
  const list = (m.reactions[emoji] ||= []);
  const i = list.indexOf(who);
  const on = i < 0;
  if (on) list.push(who); else list.splice(i, 1);
  if (!list.length) delete m.reactions[emoji];
  persist();
  emit({ type: 'react', message: m });
  if (who === ME.id && kindOfChannel(ch) !== 'local' && W.REACTIONS.includes(emoji) && W.ID_RE.test(m.id)) {
    deliver(ch, { k: 'rx', id: m.id, e: emoji, on });
  }
  return m;
}

export async function edit(messageId, body) {
  const hit = findMsg(messageId);
  if (!hit || (hit.m.kind && hit.m.kind !== 'txt')) return null;
  const { m, ch } = hit;
  m.body = String(body).trim() || m.body;
  m.edited = true;
  persist();
  emit({ type: 'edit', message: m });
  if (m.author === ME.id && kindOfChannel(ch) !== 'local') deliver(ch, { k: 'edt', id: m.id, b: m.body });
  return m;
}

export async function remove(messageId) {
  const hit = findMsg(messageId);
  if (!hit) return false;
  const { m, ch, rows } = hit;
  rows.splice(rows.indexOf(m), 1);
  dropVoice(messageId);
  polls.delete(messageId);
  persist();
  emit({ type: 'remove', id: messageId, channelId: ch });
  if (m.author === ME.id && kindOfChannel(ch) !== 'local') deliver(ch, { k: 'del', id: m.id });
  return true;
}

/** Pin or unpin on this device. Pins are yours alone: nothing is sent. */
export function pin(messageId, on = true) {
  const hit = findMsg(messageId);
  if (!hit) return null;
  if (on) hit.m.pinned = now(); else delete hit.m.pinned;
  persist();
  emit({ type: 'edit', message: hit.m });
  return hit.m;
}
export const listPins = async channelId =>
  (load().messages[channelId] || []).filter(m => m.pinned).sort((a, b) => b.pinned - a.pinned);

/** Mute a channel: no notifications from it, except when someone @mentions you. */
export function setMuted(channelId, on) {
  load().muted[channelId] = !!on;
  persist();
  emit({ type: 'read', channelId });
}

/** When this channel was last read (before the next markRead): where "new" starts. */
export const readAt = channelId => load().read[channelId] || 0;

export async function members(spaceId = null) {
  if (live()) return call('/members');
  /* A built-in space has nobody else in it: it is stored on this device. */
  if (spaceId === 'dm') return [ME, ...dmChannels().map(c => friendPerson(c.fp))];
  const sp = spaceId && load().spaces.find(x => x.id === spaceId);
  if (sp && (sp.peerName || (sessions.get(spaceId) && sessions.get(spaceId).room.peer))) return [ME, roomPerson(spaceId)];
  return [ME];
}

export function markRead(channelId) {
  const st = load();
  st.read[channelId] = now();
  persist();
  emit({ type: 'read', channelId });
}

export const draft = {
  get: id => load().drafts[id] || '',
  set(id, text) { const st = load(); st.drafts[id] = text; persist(); },
};

export function setTyping(channelId, on) { emit({ type: 'typing', channelId, who: ME.id, on }); }

/** Kept for callers that stop the room on teardown; nothing runs in the background now. */
export function quiet() {}

/* ------------------------------------------------------------------ *
 *  polls
 * ------------------------------------------------------------------ */
const polls = new Map();             /* message id -> the live poll object (with its vote Map) */
const serialize = P => ({
  pid: P.pid, q: P.q, opts: P.opts, multi: P.multi, anon: P.anon, dur: P.dur, room: P.room, from: P.from,
  name: P.name, color: P.color, at: P.at, endsAt: P.endsAt, closed: P.closed, myN: P.myN, votes: [...P.votes],
});
/** The poll in a message, ready for pollcard.js and polls.js. */
export function pollOf(m) {
  if (!m || !m.poll) return null;
  if (!polls.has(m.id)) polls.set(m.id, { ...m.poll, votes: new Map(m.poll.votes || []) });
  return polls.get(m.id);
}
function savePoll(m, P) { m.poll = serialize(P); persist(); emit({ type: 'edit', message: m }); }

/** Post a poll (meta from polls.parsePoll) to a channel. */
export const sendPoll = (channelId, meta) => send(channelId, { kind: 'poll', poll: meta });

export function votePoll(messageId, choices) {
  const hit = findMsg(messageId);
  const P = hit && pollOf(hit.m);
  if (!P) return 'gone';
  const n = (P.myN || 0) + 1;
  const vote = POLL.parseVote({ pid: P.pid, ch: choices, n });
  if (!vote) return 'invalid';
  const r = POLL.applyVote(P, { id: ME.id, name: ME.name }, vote);
  if (r === 'ok') {
    P.myN = n;
    savePoll(hit.m, P);
    if (kindOfChannel(hit.ch) !== 'local') deliver(hit.ch, { k: 'vote', p: vote });
  }
  return r;
}
export function endPoll(messageId) {
  const hit = findMsg(messageId);
  const P = hit && pollOf(hit.m);
  if (!P || !POLL.applyClose(P, ME.id)) return false;
  savePoll(hit.m, P);
  if (kindOfChannel(hit.ch) !== 'local') deliver(hit.ch, { k: 'close', p: { pid: P.pid } });
  return true;
}
const pollByPid = (channelId, pid) => {
  for (const m of load().messages[channelId] || []) if (m.poll && m.poll.pid === pid) return m;
  return null;
};

/* ------------------------------------------------------------------ *
 *  voice messages
 *  Recorded on this device (chat.js, after a click), sent in small pieces
 *  through the shared space, put back together on the other side and kept
 *  only in memory. Capped in length and size (chatwire VOICE).
 * ------------------------------------------------------------------ */
const voiceUrls = new Map();         /* message id -> blob: URL, this page only */
const VOICE_KEEP = 24;
function keepVoice(id, blob) {
  voiceUrls.set(id, URL.createObjectURL(blob));
  while (voiceUrls.size > VOICE_KEEP) dropVoice(voiceUrls.keys().next().value);
}
function dropVoice(id) {
  const u = voiceUrls.get(id);
  if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } voiceUrls.delete(id); }
}
export const voiceUrl = id => voiceUrls.get(id) || null;

/** -> { ok, message } or { ok:false, error: 'room' | 'long' | 'big' | 'mime' | 'send' } */
export async function sendVoice(channelId, blob, ms) {
  const sid = roomOf(channelId);
  const S = sid && sessions.get(sid);
  if (!S || S.room.phase !== 'paired') return { ok: false, error: 'room' };
  const mime = String(blob.type || '').split(';')[0];
  if (!W.VOICE.MIMES.includes(mime)) return { ok: false, error: 'mime' };
  if (!(ms > 0) || ms > W.VOICE.MAX_MS + 1500) return { ok: false, error: 'long' };
  if (blob.size > W.VOICE.MAX_BYTES) return { ok: false, error: 'big' };
  const b64 = W.toB64(new Uint8Array(await blob.arrayBuffer()));
  const parts = [];
  for (let i = 0; i < b64.length; i += W.VOICE.CHUNK) parts.push(b64.slice(i, i + W.VOICE.CHUNK));
  if (!parts.length || parts.length > W.VOICE.MAX_CHUNKS) return { ok: false, error: 'big' };
  const id = W.newId();
  const dur = Math.max(100, Math.round(ms));
  let all = true;
  for (let i = 0; i < parts.length; i++) {
    if (!S.room.send('cm', { k: 'vc', id, i, n: parts.length, d: parts[i], dur, m: mime })) all = false;
    if (i % 6 === 5) await new Promise(r => setTimeout(r, 40));        /* a few at a time: the shared channel is rate-limited */
  }
  if (!all) return { ok: false, error: 'send' };
  const st = load();
  const msg = { id, channelId, author: ME.id, body: 'Voice message', at: now(), reactions: {}, edited: false, replyTo: null, kind: 'voice', voice: { dur, mime }, delivery: 'sent' };
  keepVoice(id, blob);
  (st.messages[channelId] ||= []).push(msg);
  st.read[channelId] = msg.at;
  persist();
  emit({ type: 'message', message: msg });
  return { ok: true, message: msg };
}

function pieceIn(S, author, w) {
  const key = `${author}:${w.id}`;
  let p = S.pieces.get(key);
  if (!p) {
    if (S.pieces.size >= 3) return null;                              /* at most three being put together */
    p = { n: w.n, dur: w.dur, m: w.m, got: new Map(), t: setTimeout(() => S.pieces.delete(key), W.VOICE.WAIT) };
    S.pieces.set(key, p);
  }
  if (p.n !== w.n || p.m !== w.m || p.dur !== w.dur) return null;      /* a piece that disagrees with the first is dropped */
  p.got.set(w.i, w.d);
  if (p.got.size < p.n) return null;
  clearTimeout(p.t);
  S.pieces.delete(key);
  const bytes = [];
  let total = 0;
  for (let i = 0; i < p.n; i++) {
    const b = W.fromB64(p.got.get(i));
    if (!b) return null;
    total += b.length;
    if (total > W.VOICE.MAX_BYTES) return null;
    bytes.push(b);
  }
  return { blob: new Blob(bytes, { type: p.m }), dur: p.dur };
}

/* ------------------------------------------------------------------ *
 *  receiving
 * ------------------------------------------------------------------ */
let viewing = null;
/** Static Chat tells us which channel is on screen, so it isn't also announced. */
export function setViewing(channelId) { viewing = channelId; }

function notifyIncoming(m) {
  const ch = listAllChannels().find(c => c.id === m.channelId);
  const mentioned = !!m.mention;
  const here = viewing === m.channelId && typeof document !== 'undefined' && !document.hidden;
  if (here || (ch && isMuted(ch) && !mentioned)) return;
  const who = (personById(m.author) || {}).name || 'Someone';
  const where = dmFp(m.channelId) ? who : `#${(ch && ch.name) || 'chat'}`;
  const open = () => { try { wm.open('chat', { spaceId: ch && ch.spaceId, channelId: m.channelId }); } catch (e) { /* no shell */ } };
  bus.emit('noti:push', {
    app: 'Static Chat', icon: 'message-circle', timeout: 6000,
    title: mentioned ? `${who} mentioned you in ${where}` : (dmFp(m.channelId) ? who : `${where} · ${who}`),
    message: preview(m).slice(0, 90),
    actions: [{ label: 'Open', onClick: open }], onClick: open,
  });
}

/** One message from the other side of a channel, already checked by chatwire. */
function ingest(channelId, authorId, w) {
  const st = load();
  const rows = (st.messages[channelId] ||= []);
  const has = id => rows.find(x => x.id === id);
  switch (w.k) {
    case 'txt': case 'stk': case 'card': case 'file': case 'poll': {
      if (has(w.id)) return;
      const m = { id: w.id, channelId, author: authorId, body: '', at: now(), reactions: {}, edited: false, replyTo: null, kind: w.k, delivery: 'sent' };
      if (w.k === 'txt') { m.body = w.b; m.replyTo = w.rt && has(w.rt) ? w.rt : null; m.mention = W.mentions(w.b, ME.name); }
      else if (w.k === 'stk') { m.sticker = w.s; m.body = 'Sticker'; }
      else if (w.k === 'card') { m.card = w.c; m.body = w.c.ti || 'Shared a page'; }
      else if (w.k === 'file') { m.file = { n: w.n, z: w.z }; m.body = w.n; }
      else {
        const P = POLL.newPoll(w.p, { id: authorId, name: (personById(authorId) || {}).name || 'Friend', color: 200 }, channelId, m.at);
        polls.set(m.id, P);
        m.poll = serialize(P);
        m.body = `Poll: ${w.p.q}`;
      }
      rows.push(m);
      persist();
      emit({ type: 'message', message: m });
      notifyIncoming(m);
      return;
    }
    case 'vote': case 'close': {
      const m = pollByPid(channelId, w.p.pid);
      const P = m && pollOf(m);
      if (!P) return;
      const ok = w.k === 'vote'
        ? POLL.applyVote(P, { id: authorId, name: (personById(authorId) || {}).name || 'Friend' }, w.p) === 'ok'
        : POLL.applyClose(P, authorId);
      if (ok) savePoll(m, P);
      return;
    }
    case 'rx': {
      const m = has(w.id);
      if (!m) return;
      const list = (m.reactions[w.e] ||= []);
      const i = list.indexOf(authorId);
      if (w.on && i < 0) list.push(authorId); else if (!w.on && i > -1) list.splice(i, 1);
      if (!list.length) delete m.reactions[w.e];
      persist();
      emit({ type: 'react', message: m });
      return;
    }
    case 'edt': {
      const m = has(w.id);
      if (!m || m.author !== authorId || (m.kind || 'txt') !== 'txt') return;     /* only the author changes their own words */
      m.body = w.b; m.edited = true; m.mention = W.mentions(w.b, ME.name);
      persist();
      emit({ type: 'edit', message: m });
      return;
    }
    case 'del': {
      const m = has(w.id);
      if (!m || m.author !== authorId) return;
      rows.splice(rows.indexOf(m), 1);
      dropVoice(m.id); polls.delete(m.id);
      persist();
      emit({ type: 'remove', id: m.id, channelId });
      return;
    }
    default:
  }
}

/** A direct message from an accepted friend (friends.js has checked it came from them). */
export function receiveDm(fp, w) {
  ingest(`dm:${fp}`, `f:${fp}`, w);
}

/* ------------------------------------------------------------------ *
 *  shared spaces (a private pair.js room, joined by a code)
 * ------------------------------------------------------------------ */
const TYPES = { cm: m => W.parseChat(m) };
const rid8 = () => W.newId().slice(0, 8);
const SPACE_MAX = 6;

function connect(sp) {
  const old = sessions.get(sp.id);
  if (old) return old;
  const room = openPair({ kind: 'chat', role: sp.role, code: sp.code, types: TYPES, rtc: false });
  const S = { room, offs: [], pieces: new Map(), everPaired: !!sp.peerName, error: null };
  sessions.set(sp.id, S);
  S.offs.push(room.on((type, data) => {
    if (type === 'peer') {
      S.everPaired = true; S.error = null;
      sp.peerName = safeName(data && data.name) || 'Friend';
      sp.peerHue = hueOf(data && data.color);
      persist();
      emit({ type: 'space', spaceId: sp.id }); emit({ type: 'presence' });
    } else if (type === 'phase') {
      if (data === 'closed' && room.error) S.error = room.error;
      emit({ type: 'space', spaceId: sp.id });
      if (data === 'closed') drop(sp, S);
    } else if (type === 'left') {
      emit({ type: 'space', spaceId: sp.id }); emit({ type: 'presence' });
      drop(sp, S);
    } else if (type === 'msg' && data.t === 'cm') {
      const w = data.m;
      const channelId = mainChannel(sp.id);
      const author = `rp:${sp.id}`;
      if (w.k === 'vc') {
        const done = pieceIn(S, author, w);
        if (!done) return;
        const rows = (load().messages[channelId] ||= []);
        if (rows.some(x => x.id === w.id)) return;
        const m = { id: w.id, channelId, author, body: 'Voice message', at: now(), reactions: {}, edited: false, replyTo: null, kind: 'voice', voice: { dur: done.dur, mime: w.m }, delivery: 'sent' };
        keepVoice(w.id, done.blob);
        rows.push(m);
        persist();
        emit({ type: 'message', message: m });
        notifyIncoming(m);
        return;
      }
      ingest(channelId, author, w);
    }
  }));
  if (room.phase === 'closed' && room.error) queueMicrotask(() => { S.error = room.error; drop(sp, S); });
  return S;
}
/* the connection ended: say so, keep the space (and its messages) so it can be connected again */
function drop(sp, S) {
  if (sessions.get(sp.id) !== S) return;
  sessions.delete(sp.id);
  S.offs.forEach(f => f());
  S.pieces.forEach(p => clearTimeout(p.t));
  try { S.room.leave(); } catch (e) { /* gone */ }
  /* a space that never got anyone in (a mistyped code, nobody there) leaves no trace */
  if (!S.everPaired && S.error) removeSpaceRecord(sp.id, false);
  emit({ type: 'space', spaceId: sp.id, ended: true, error: S.error });
  emit({ type: 'presence' });
}
function removeSpaceRecord(id, withMessages) {
  const st = load();
  st.spaces = st.spaces.filter(x => x.id !== id);
  if (withMessages) { delete st.messages[mainChannel(id)]; delete st.read[mainChannel(id)]; delete st.drafts[mainChannel(id)]; }
  persist();
}

/** Make a shared space and get its code. -> { ok, id, code } | { ok:false, error } */
export function createSpace(name = '') {
  const st = load();
  if (st.spaces.length >= SPACE_MAX) return { ok: false, error: 'many' };
  const sp = { id: `rm-${rid8()}`, name: safeName(name) || 'Shared space', code: '', role: 'host', peerName: '', peerHue: 200, at: now() };
  st.spaces.push(sp);
  const S = connect(sp);
  sp.code = S.room.code;
  persist();
  emit({ type: 'space', spaceId: sp.id });
  return { ok: true, id: sp.id, code: sp.code };
}
/** Join with a code (or an invite link). -> { ok, id } | { ok:false, error: 'invalid' | 'many' } */
export function joinSpace(input, name = '') {
  const code = normalizeCode(input);
  if (!isCode(code)) return { ok: false, error: 'invalid' };
  const st = load();
  const have = st.spaces.find(x => x.code === code);
  if (have) { connect(have); return { ok: true, id: have.id, again: true }; }
  if (st.spaces.length >= SPACE_MAX) return { ok: false, error: 'many' };
  const sp = { id: `rm-${rid8()}`, name: safeName(name) || 'Shared space', code, role: 'guest', peerName: '', peerHue: 200, at: now() };
  st.spaces.push(sp);
  persist();
  connect(sp);
  emit({ type: 'space', spaceId: sp.id });
  return { ok: true, id: sp.id };
}
/** Connect a saved space again (the host reopens its own code; the guest knocks on it). */
export function connectSpace(id) {
  const sp = load().spaces.find(x => x.id === id);
  if (!sp) return false;
  connect(sp);
  emit({ type: 'space', spaceId: id });
  return true;
}
/** Leave the connection; the space and its messages stay on this device. */
export function disconnectSpace(id) {
  const sp = load().spaces.find(x => x.id === id);
  const S = sessions.get(id);
  if (sp && S) { S.everPaired = true; drop(sp, S); }
}
/** Leave and forget the space and its messages on this device. */
export function deleteSpace(id) {
  const sp = load().spaces.find(x => x.id === id);
  const S = sessions.get(id);
  if (S && sp) { S.everPaired = true; drop(sp, S); }
  removeSpaceRecord(id, true);
  emit({ type: 'space', spaceId: id, ended: true });
}
/** { phase, error, code, role, peerName, connected } for the topic bar. */
export function spaceInfo(id) {
  const sp = load().spaces.find(x => x.id === id);
  if (!sp) return null;
  const S = sessions.get(id);
  return { id, code: sp.code, role: sp.role, peerName: sp.peerName, phase: S ? S.room.phase : 'off', error: (S && S.error) || null, connected: !!S && S.room.phase === 'paired' };
}
/** Is this channel connected to someone right now? Built-in channels never are. */
export function channelLive(channelId) {
  const sid = roomOf(channelId);
  if (sid) return !!sessions.get(sid) && sessions.get(sid).room.phase === 'paired';
  const fp = dmFp(channelId);
  if (fp) {
    try { const f = FR.friends().find(x => x.fp === fp); return !!f && f.presence !== 'offline' && FR.liveStatus() === 'live'; } catch (e) { return false; }
  }
  return false;
}
/** Everyone you could @mention in this channel. */
export function mentionable(channelId) {
  const a = authorFor(channelId);
  const p = a && personById(a);
  return p ? [p] : [];
}

export function reset() {
  for (const [id, S] of [...sessions]) { const sp = load().spaces.find(x => x.id === id); if (sp) { S.everPaired = true; drop(sp, S); } }
  for (const id of [...voiceUrls.keys()]) dropVoice(id);
  polls.clear();
  state = blank(); persist(); emit({ type: 'read', channelId: null });
}

export default {
  config, ME, everyone, personById, subscribe,
  listSpaces, listChannels, listMessages, send, react, edit, remove,
  members, markRead, draft, setTyping, quiet, reset,
  pin, listPins, setMuted, readAt, setViewing, sendPoll, votePoll, endPoll, pollOf, sendVoice, voiceUrl,
  receiveDm, createSpace, joinSpace, connectSpace, disconnectSpace, deleteSpace, spaceInfo, channelLive, mentionable, kindOfChannel,
};
