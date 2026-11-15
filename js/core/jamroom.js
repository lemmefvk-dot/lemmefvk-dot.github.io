/* ============================================================
   jamroom.js — a private Static Jam room for two: play each
   other's entries.

   One person opens a room (core/pair.js, kind 'jam') and gets a
   six-character code; the friend types it. Nobody can find a room
   any other way. Each side can send one or more of its games; the
   other side lists them and plays one in Shared Game's sealed box
   (core/sandbox.js) — nothing a friend sends ever runs by itself.

   What travels is the SAME packed game a share link carries
   (core/sharelink.js encode: deflated, at most 64 KB) cut into
   pieces of CHUNK characters, because a message on the room is
   small. The room is a public broker with best-effort delivery, so
   the sender repeats an entry every RESEND_MS, up to RESENDS times,
   until the other side says it has it ('got'). The receiver puts the
   pieces back together, then decodes the packed game itself
   (sharelink.decode checks it is a game and unpacks no more than the
   cap) before listing it; an entry that does not decode is dropped.

   Wire types (each passes its validator in pair.js):
     ent { i, k, n, d, ti, de } piece k of n of entry i (d = the text of
                               the piece, ti = title, de = description)
     got { i }                 "I have all of entry i"

   Limits: ENTRIES a room keeps, PENDING entries being put together
   at once, a title or description cut to its cap, pieces at most
   CHUNK long and at most MAX_PIECES of them.

     jamRoom({ role:'host'|'guest', code? }) -> {
       code, role, phase, error, peerName, entries (received, newest last),
       sent (what we sent: { id, title, acked }),
       on(fn) -> off   fn('peer'|'left'|'phase'|'entry'|'sent'|'ack'|'bad', data),
       send({ title, description, fragment }) -> id | null,
       leave() }
   ============================================================ */
import { openPair } from './pair.js';
import { cleanText } from './roomcode.js';
import * as ShareLink from './sharelink.js';

export const KIND = 'jam';
export const LIMITS = { ENTRIES: 12, PENDING: 4, CHUNK: 11000, MAX_PIECES: 7, TITLE: 60, DESC: 200, RESEND_MS: 6000, RESENDS: 3 };
const ID_RE = /^[a-z0-9]{8}$/;
const FRAG_RE = /^[A-Za-z0-9_.-]*$/;

export const TYPES = {
  ent(m) {
    if (typeof m.i !== 'string' || !ID_RE.test(m.i)) return null;
    if (!Number.isInteger(m.n) || m.n < 1 || m.n > LIMITS.MAX_PIECES) return null;
    if (!Number.isInteger(m.k) || m.k < 0 || m.k >= m.n) return null;
    if (typeof m.d !== 'string' || !m.d.length || m.d.length > LIMITS.CHUNK || !FRAG_RE.test(m.d)) return null;
    return { i: m.i, k: m.k, n: m.n, d: m.d, ti: cleanText(m.ti, LIMITS.TITLE), de: cleanText(m.de, LIMITS.DESC) };
  },
  got(m) { return typeof m.i === 'string' && ID_RE.test(m.i) ? { i: m.i } : null; },
};

const newId = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };

/** A packed game cut into pieces that each fit on the room. */
export function pieces(fragment) {
  const f = String(fragment || '');
  const out = [];
  for (let i = 0; i < f.length; i += LIMITS.CHUNK) out.push(f.slice(i, i + LIMITS.CHUNK));
  return out;
}

export function jamRoom({ role, code = null }) {
  const room = openPair({ kind: KIND, role, code, types: TYPES, rtc: false });
  const subs = new Set();
  const timers = new Set();
  const S = { entries: [], sent: [], pend: new Map(), done: new Set(), ended: false };
  const emit = (type, data) => subs.forEach(fn => { try { fn(type, data); } catch (err) { console.error('[jamroom]', err); } });
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!S.ended) fn(); }, ms); timers.add(t); return t; };

  function transmit(e) {
    if (room.phase !== 'paired') return;
    e.pieces.forEach((d, k) => room.send('ent', { i: e.id, k, n: e.pieces.length, d, ti: e.title, de: e.description }));
  }
  function schedule(e, round) {
    later(() => {
      if (e.acked || round >= LIMITS.RESENDS) return;
      transmit(e);
      schedule(e, round + 1);
    }, LIMITS.RESEND_MS);
  }

  async function assembled(p) {
    S.pend.delete(p.id);
    const fragment = p.parts.join('');
    let r;
    try { r = await ShareLink.decode(fragment); } catch (err) { r = { ok: false, error: String(err && err.message || err) }; }
    if (S.ended) return;
    if (!r.ok) { emit('bad', { title: p.title, error: r.error }); return; }
    S.done.add(p.id);
    const entry = { id: p.id, title: p.title || r.creation.name, description: p.description, fragment, from: room.peer ? room.peer.name : 'Your friend', at: Date.now(), bytes: r.creation.bytes };
    S.entries.push(entry);
    while (S.entries.length > LIMITS.ENTRIES) S.entries.shift();
    emit('entry', entry);
  }

  function onMsg(data) {
    if (data.t === 'got') {
      const e = S.sent.find(x => x.id === data.m.i);
      if (e && !e.acked) { e.acked = true; emit('ack', { id: e.id }); }
      return;
    }
    if (data.t !== 'ent') return;
    const m = data.m;
    if (S.done.has(m.i)) { room.send('got', { i: m.i }); return; }     /* we have it; they are repeating it */
    let p = S.pend.get(m.i);
    if (!p) {
      if (S.pend.size >= LIMITS.PENDING) S.pend.delete(S.pend.keys().next().value);
      p = { id: m.i, n: m.n, parts: new Array(m.n).fill(null), title: m.ti, description: m.de, have: 0 };
      S.pend.set(m.i, p);
    }
    if (p.n !== m.n || p.parts[m.k] != null) return;
    p.parts[m.k] = m.d;
    p.have++;
    if (m.k === 0 || !p.title) { p.title = m.ti || p.title; p.description = m.de || p.description; }
    if (p.have === p.n) { room.send('got', { i: m.i }); assembled(p); }
  }

  room.on((type, data) => {
    if (S.ended) return;
    if (type === 'peer') {
      emit('peer', data);
      /* someone just arrived: anything we sent while alone goes out now */
      S.sent.filter(e => !e.acked).forEach(transmit);
    } else if (type === 'left') { emit('left', data); }
    else if (type === 'phase') { emit('phase', data); }
    else if (type === 'msg') onMsg(data);
  });

  return {
    get code() { return room.code; },
    get role() { return role; },
    get phase() { return room.phase; },
    get error() { return room.error; },
    get peerName() { return room.peer ? room.peer.name : ''; },
    get entries() { return S.entries; },
    get sent() { return S.sent; },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    send({ title, description = '', fragment }) {
      const ps = pieces(fragment);
      if (!ps.length || ps.length > LIMITS.MAX_PIECES || !FRAG_RE.test(String(fragment))) return null;
      const e = { id: newId(), title: cleanText(title, LIMITS.TITLE) || 'A game', description: cleanText(description, LIMITS.DESC), pieces: ps, acked: false, at: Date.now() };
      S.sent.push(e);
      if (S.sent.length > LIMITS.ENTRIES) S.sent.shift();
      transmit(e);
      schedule(e, 0);
      emit('sent', e);
      return e.id;
    },
    leave() {
      if (S.ended) return;
      S.ended = true;
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      try { room.leave(); } catch (err) { /* gone */ }
    },
  };
}

export default { KIND, LIMITS, TYPES, jamRoom, pieces };
