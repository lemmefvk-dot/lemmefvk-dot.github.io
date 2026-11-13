/* ============================================================
   chat.transport.js — the seam under Static Chat.

   The UI never touches storage or a socket directly. It asks
   this module, which today answers from a persisted local store
   and a small cast of simulated people. Swap `config.mode` to
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
   ============================================================ */
import { store } from '../core/store.js';

export const config = {
  mode: 'local',        // 'local' | 'live'
  endpoint: null,       // e.g. 'wss://your-host/chat'
  token: null,
  /** local mode only: simulated replies are intentionally disabled */
  ambient: 0,
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
 *  the cast — original characters, so nothing here is borrowed
 * ------------------------------------------------------------------ */
/* you: named after the signed-in StaticOS account (read live, so signing
   in or out renames you everywhere in Chat) */
export const ME = {
  id: 'me', hue: 340, role: 'You', status: 'online',
  get name() { const u = store.get('session.user', null); return (u && (u.name || u.username)) || 'You'; },
  get initials() { return (this.name.trim().charAt(0) || 'Y').toUpperCase(); },
};

const CAST = [
  { id: 'zxs',    name: 'ZXS',      initials: 'Z', hue: 265, role: 'Owner of Luna',  status: 'online' },
  { id: 'divine', name: 'Divine',   initials: 'D', hue: 190, role: 'Starlight',      status: 'online' },
  { id: 'apbz',   name: 'apbz',     initials: 'A', hue: 140, role: 'Lucide',         status: 'idle'   },
  { id: 'fourx',  name: '4xmq',     initials: '4', hue: 35,  role: 'Fern',           status: 'online' },
  { id: 'josh',   name: 'JOSH',     initials: 'J', hue: 10,  role: 'Tester',         status: 'dnd'    },
  { id: 'nova',   name: 'nova',     initials: 'N', hue: 300, role: 'Page Builder',   status: 'online' },
  { id: 'kite',   name: 'kite',     initials: 'K', hue: 215, role: 'Game Finder',    status: 'offline'},
];

export const everyone = () => [ME, ...CAST];
export const personById = id => everyone().find(p => p.id === id) || null;

const SPACES = [
  { id: 'aether', name: 'Static', glyph: 'diamond', g1: '#ff9bb0', g2: '#b8123c',
    blurb: 'The main room.' },
  { id: 'arcade', name: 'Arcade', glyph: 'gamepad', g1: '#a9e08a', g2: '#2f7d2a',
    blurb: 'Games, scores and bug reports.' },
  { id: 'screen', name: 'Screening', glyph: 'film', g1: '#c4a2ff', g2: '#5b21b6',
    blurb: 'Anime and film nights.' },
  { id: 'build',  name: 'Build', glyph: 'code', g1: '#8fd0ff', g2: '#1f5fd0',
    blurb: 'Shipping the shell.' },
  /* Not a simulated room: this one is wired to the real Discord API.
     `external` tells the UI to hand the body to the Discord panel. */
  { id: 'discord', name: 'Discord', glyph: 'message-circle', g1: '#8b9cff', g2: '#3d46b5',
    blurb: 'Your real server, live.', external: true },
];

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

/* Seeded conversation. Written for this project — nothing quoted. */

/* ------------------------------------------------------------------ *
 *  state
 * ------------------------------------------------------------------ */
function blank() {
  return { messages: {}, read: {}, drafts: {} };
}

let state = null;
function load() {
  if (state) return state;
  const saved = store.get(KEY);
  state = saved && saved.messages ? saved : blank();
  /* Remove messages created by the old local simulation, but preserve anything
     the user wrote locally and anything supplied by a real transport. */
  for (const [channelId, rows] of Object.entries(state.messages)) {
    state.messages[channelId] = rows.filter(m =>
      m.author === ME.id || !CAST.some(person => person.id === m.author && !String(m.id).startsWith('seed-'))
        ? !String(m.id).startsWith('seed-') && (m.author === ME.id || !CAST.some(person => person.id === m.author))
        : true);
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
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit(ev) { for (const fn of subs) { try { fn(ev); } catch (err) { console.error('[chat]', err); } } }

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
 *  api
 * ------------------------------------------------------------------ */
export async function listSpaces() {
  if (live()) return call('/spaces');
  return SPACES.map(s => ({ ...s, unread: unreadFor(s.id) }));
}

export async function listChannels(spaceId) {
  if (live()) return call(`/spaces/${spaceId}/channels`);
  const st = load();
  return CHANNELS.filter(c => c.spaceId === spaceId).map(c => ({
    ...c,
    unread: Math.max(0, (st.messages[c.id] || []).filter(m => m.at > (st.read[c.id] || 0) && m.author !== ME.id).length),
    last: (st.messages[c.id] || []).slice(-1)[0] || null,
  }));
}

function unreadFor(spaceId) {
  const st = load();
  return CHANNELS.filter(c => c.spaceId === spaceId)
    .reduce((n, c) => n + (st.messages[c.id] || [])
      .filter(m => m.at > (st.read[c.id] || 0) && m.author !== ME.id).length, 0);
}

export async function listMessages(channelId, { limit = 200 } = {}) {
  if (live()) return call(`/channels/${channelId}/messages?limit=${limit}`);
  const st = load();
  return (st.messages[channelId] || []).slice(-limit);
}

export async function send(channelId, { body, replyTo = null, author = ME.id } = {}) {
  const text = String(body || '').trim();
  if (!text) return null;
  if (live()) return call(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ body: text, replyTo }) });

  const st = load();
  const msg = { id: uid('m'), channelId, author, body: text, at: now(), reactions: {}, edited: false, replyTo };
  (st.messages[channelId] ||= []).push(msg);
  st.read[channelId] = msg.at;
  persist();
  emit({ type: 'message', message: msg });
  return msg;
}

export async function react(messageId, emoji, who = ME.id) {
  if (live()) return call(`/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
  const st = load();
  for (const rows of Object.values(st.messages)) {
    const m = rows.find(x => x.id === messageId);
    if (!m) continue;
    const list = (m.reactions[emoji] ||= []);
    const i = list.indexOf(who);
    if (i > -1) list.splice(i, 1); else list.push(who);
    if (!list.length) delete m.reactions[emoji];
    persist();
    emit({ type: 'react', message: m });
    return m;
  }
  return null;
}

export async function edit(messageId, body) {
  const st = load();
  for (const rows of Object.values(st.messages)) {
    const m = rows.find(x => x.id === messageId);
    if (!m) continue;
    m.body = String(body).trim() || m.body;
    m.edited = true;
    persist();
    emit({ type: 'edit', message: m });
    return m;
  }
  return null;
}

export async function remove(messageId) {
  const st = load();
  for (const [ch, rows] of Object.entries(st.messages)) {
    const i = rows.findIndex(x => x.id === messageId);
    if (i < 0) continue;
    rows.splice(i, 1);
    persist();
    emit({ type: 'remove', id: messageId, channelId: ch });
    return true;
  }
  return false;
}

export async function members() {
  if (live()) return call('/members');
  /* Local mode has no server, so nobody else is actually here: presence
     would be invented. The cast above only exists so older saved
     messages still resolve an author. */
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

/* ------------------------------------------------------------------ *
 *  ambient life — the room answers, so the UI has something to show
 * ------------------------------------------------------------------ */
const REPLIES = [
  'good call', 'yeah that tracks', 'pushing a fix for that now', 'nice',
  'can you drop a screenshot', 'works on mine', 'that was the last blocker',
  'agreed', 'testing it now', 'ship it', 'one sec, reading', 'oh that explains it',
];
const timers = new Set();
function maybeReply(channelId, text) {
  if (!config.ambient || live()) return;
  const pool = CAST.filter(c => c.status === 'online');
  if (!pool.length) return;
  const who = pool[Math.floor(Math.random() * pool.length)];
  const delay = 1400 + Math.random() * 2600;

  const t1 = setTimeout(() => {
    emit({ type: 'typing', channelId, who: who.id, on: true });
    const t2 = setTimeout(() => {
      emit({ type: 'typing', channelId, who: who.id, on: false });
      const body = /\?$/.test(text)
        ? ['not sure yet', 'checking', 'i think so', 'ask nova, she wired it'][Math.floor(Math.random() * 4)]
        : REPLIES[Math.floor(Math.random() * REPLIES.length)];
      const st = load();
      const msg = { id: uid('m'), channelId, author: who.id, body, at: now(), reactions: {}, edited: false };
      (st.messages[channelId] ||= []).push(msg);
      persist();
      emit({ type: 'message', message: msg });
      timers.delete(t2);
    }, 900 + Math.random() * 1500);
    timers.add(t2);
    timers.delete(t1);
  }, delay);
  timers.add(t1);
}

/** Stop every pending simulated reply (called on app teardown). */
export function quiet() { for (const t of timers) clearTimeout(t); timers.clear(); }

export function reset() { state = blank(); persist(); emit({ type: 'read', channelId: null }); }

export default {
  config, ME, everyone, personById, subscribe,
  listSpaces, listChannels, listMessages, send, react, edit, remove,
  members, markRead, draft, setTyping, quiet, reset,
};
