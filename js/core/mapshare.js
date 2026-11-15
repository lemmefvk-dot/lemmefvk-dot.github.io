/* ============================================================
   mapshare.js — share a mind map live with a friend.

   One person shares the map in their Mind Maps window and gets a
   six-character code (and a link, #map=<CODE>); the other types it.
   They meet in a private two-person room (core/pair.js, kind 'mindmap':
   sealed with the code, partner only, rate-capped, every message
   checked here). Both can add, move, rename, recolour and remove ideas,
   and both maps converge.

   WHAT TRAVELS: the ideas — their words, where they sit, which branch
   they are on, and their colour, shape and icon. NOT the notes on an
   idea, links to notes (they point at a note on one device), the
   connections drawn between branches, or which branches are folded.
   Each device keeps those for itself.

   HOW EDITS MERGE — the same way as a shared Static Board
   (core/boardshare.js): every field of every idea is a register stamped
   [t, site], t a hybrid clock and site a random id for this session.
   Merging keeps the newer stamp per field, so one person moving an idea
   while the other renames it keeps both. A removed idea keeps a stamped
   "gone" register, so an older edit can't bring it back. Merging is
   order-free and safe to repeat; a digest every few seconds makes both
   sides send everything again when they differ, so a lost message heals.

     shareMap({ role, code?, read, write })
       read()      -> { title, nodes: [{ id, text, x, y, parent, color, shape, icon }] } or null
       write(view) -> put the merged ideas into the map (same shape)
       -> session { code, role, phase, error, peerName, site, applying,
                    on(fn), local(map), leave(), peek() }
          fn(type): 'phase' | 'peer' | 'change' | 'ended'
   ============================================================ */
import { openPair } from './pair.js';
import { cleanText } from './roomcode.js';

export const KIND = 'mindmap';
export const SHAPES = ['round', 'box', 'pill', 'ellipse', 'line'];
export const LIMITS = { NODES: 1500, TEXT: 60, CHUNK: 11000, SYNC_EVERY: 4000, RESEND_GAP: 5000, SKEW: 10 * 60e3, COORD: 1e6, ICON: 24 };
const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const SITE_RE = /^[a-z0-9]{6,12}$/;
const ICON_RE = /^[a-z0-9-]{0,24}$/;
const rid = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };
const later = (a, b) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/* the fields of an idea on the wire, and what a good value is */
const coord = v => (Number.isFinite(v) && Math.abs(v) <= LIMITS.COORD ? Math.round(v) : null);
export const NODE_F = {
  e: v => (v === 1 || v === 0 ? v : null),
  tx: v => (typeof v === 'string' ? cleanText(v, LIMITS.TEXT) : null),
  x: coord,
  y: coord,
  p: v => (v === '' || (typeof v === 'string' && ID_RE.test(v)) ? v : null),
  c: v => (Number.isInteger(v) && v >= 0 && v < 8 ? v : null),
  sh: v => (SHAPES.includes(v) ? v : null),
  ic: v => (typeof v === 'string' && ICON_RE.test(v) ? v : null),
};
const stampOk = (t, w) => Number.isFinite(t) && t > 0 && t < Date.now() + LIMITS.SKEW && typeof w === 'string' && SITE_RE.test(w);
function cleanRec(r) {
  if (!r || typeof r !== 'object' || typeof r.i !== 'string' || !ID_RE.test(r.i)) return null;
  const out = { i: r.i };
  let any = false;
  for (const [f, ok] of Object.entries(NODE_F)) {
    const reg = r[f];
    if (!Array.isArray(reg) || reg.length !== 3 || !stampOk(reg[1], reg[2])) continue;
    const v = ok(reg[0]);
    if (v === null) continue;
    out[f] = [v, reg[1], reg[2]];
    any = true;
  }
  return any ? out : null;
}

/* ---------------- wire validators (pair.js calls each with the raw message) ---------------- */
export const TYPES = {
  rec(m) {
    const nodes = (Array.isArray(m.nodes) ? m.nodes : []).slice(0, 400).map(cleanRec).filter(Boolean);
    let nm = null;
    if (Array.isArray(m.nm) && m.nm.length === 3 && typeof m.nm[0] === 'string' && stampOk(m.nm[1], m.nm[2])) nm = [cleanText(m.nm[0], LIMITS.TEXT), m.nm[1], m.nm[2]];
    return nodes.length || nm ? { nodes, nm } : null;
  },
  sum(m) {
    return Number.isSafeInteger(m.n) && m.n >= 0 && Number.isSafeInteger(m.h) ? { n: m.n, h: m.h } : null;
  },
};

/* ---------------- the replicated map ---------------- */
const FIELD_OF = { tx: 'text', x: 'x', y: 'y', p: 'parent', c: 'color', sh: 'shape', ic: 'icon' };
export class Doc {
  constructor(site = rid(8)) {
    this.site = site;
    this.nodes = new Map();       /* id -> { i, e, tx, x, y, p, c, sh, ic } each [v, t, w] */
    this.maxT = 0;
  }
  stamp() { this.maxT = Math.max(Date.now(), this.maxT + 1); return [this.maxT, this.site]; }

  /** Merge records (ours or the friend's). -> true when anything changed. */
  merge(rec) {
    let changed = false;
    for (const r of rec.nodes || []) {
      let cur = this.nodes.get(r.i);
      if (!cur) { if (this.nodes.size >= LIMITS.NODES) continue; cur = { i: r.i }; this.nodes.set(r.i, cur); }
      for (const f of Object.keys(NODE_F)) {
        const v = r[f];
        if (!v) continue;
        this.maxT = Math.max(this.maxT, v[1]);
        if (cur[f] && !later(v.slice(1), cur[f].slice(1))) continue;
        if (cur[f] && cur[f][0] === v[0] && cur[f][1] === v[1] && cur[f][2] === v[2]) continue;
        cur[f] = v;
        changed = true;
      }
    }
    return changed;
  }

  /** The ideas as the merged registers say: those that exist and have words, siblings top to bottom. */
  view() {
    const live = [...this.nodes.values()].filter(r => r.e && r.e[0] === 1 && r.tx && r.x && r.y);
    const ids = new Set(live.map(r => r.i));
    const nodes = live.map(r => ({
      id: r.i, text: r.tx[0], x: r.x[0], y: r.y[0],
      /* an idea whose branch the other person removed becomes free-standing, so nothing is lost */
      parent: r.p && r.p[0] && ids.has(r.p[0]) && r.p[0] !== r.i ? r.p[0] : null,
      color: r.c ? r.c[0] : 0, shape: r.sh ? r.sh[0] : 'round', icon: r.ic ? r.ic[0] : '',
    }));
    /* a loop of parents (two people each moving one branch under the other) is cut at the idea stamped last */
    const by = new Map(nodes.map(n => [n.id, n]));
    for (const n of nodes) {
      const seen = new Set([n.id]);
      let p = n.parent;
      while (p) {
        if (seen.has(p)) { n.parent = null; break; }
        seen.add(p);
        p = by.get(p)?.parent || null;
      }
    }
    nodes.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
    return { nodes };
  }

  /** What changed on this device (the map's own shape): stamp it. -> records to send, or null. */
  diff(map) {
    const out = [];
    const idx = new Map();
    const set = (id, f, v) => {
      const cur = this.nodes.get(id);
      if (cur && cur[f] && cur[f][0] === v) return;
      const reg = [v, ...this.stamp()];
      let r = idx.get(id);
      if (!r) { r = { i: id }; idx.set(id, r); out.push(r); }
      r[f] = reg;
      if (cur) cur[f] = reg; else this.nodes.set(id, { i: id, [f]: reg });
    };
    const seen = new Set();
    for (const n of map.nodes || []) {
      if (!ID_RE.test(n.id) || !String(n.text || '').trim() || seen.size >= LIMITS.NODES) continue;
      seen.add(n.id);
      set(n.id, 'e', 1);
      set(n.id, 'tx', cleanText(n.text, LIMITS.TEXT));
      set(n.id, 'x', coord(n.x) ?? 0);
      set(n.id, 'y', coord(n.y) ?? 0);
      set(n.id, 'p', n.parent && ID_RE.test(n.parent) ? n.parent : '');
      set(n.id, 'c', Number.isInteger(n.color) && n.color >= 0 && n.color < 8 ? n.color : 0);
      set(n.id, 'sh', SHAPES.includes(n.shape) ? n.shape : 'round');
      set(n.id, 'ic', typeof n.icon === 'string' && ICON_RE.test(n.icon) ? n.icon : '');
    }
    for (const r of this.nodes.values()) if (r.e && r.e[0] === 1 && !seen.has(r.i)) set(r.i, 'e', 0);
    return out.length ? { nodes: out } : null;
  }

  /** Everything, as records small enough for one message each. */
  chunks() {
    const out = [];
    let cur = [], size = 0;
    for (const r of this.nodes.values()) {
      const len = JSON.stringify(r).length;
      if (size && size + len > LIMITS.CHUNK) { out.push({ nodes: cur }); cur = []; size = 0; }
      cur.push(r);
      size += len;
    }
    if (cur.length) out.push({ nodes: cur });
    return out;
  }
  /** a short fingerprint of everything held: when two differ, someone is missing something */
  digest() {
    let h = 0x811c9dc5, n = 0;
    const mix = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    for (const id of [...this.nodes.keys()].sort()) {
      const r = this.nodes.get(id);
      n++;
      mix(id);
      for (const f of Object.keys(r).sort()) if (f !== 'i') mix(`${f}${r[f][1]}${r[f][2]}`);
    }
    return { n, h: h | 0 };
  }
}
export { FIELD_OF };

/* ---------------- a session: a Doc, a room, and this window's map ---------------- */
export function shareMap({ role, code = null, read, write }) {
  const doc = new Doc();
  const room = openPair({ kind: KIND, role, code, types: TYPES, rtc: false });
  const subs = new Set();
  const emit = (type, data) => subs.forEach(fn => { try { fn(type, data); } catch (err) { console.error('[mapshare]', err); } });
  let ended = false, applying = false, lastAll = 0, sumT = 0;
  const tally = { sent: 0, merged: 0, alls: 0 };
  const send = (t, body) => { try { return room.send(t, body); } catch (err) { return false; } };
  const sendRec = r => {
    if (!r || room.phase !== 'paired') return;
    let cur = [], size = 0;
    for (const x of r.nodes) {
      const len = JSON.stringify(x).length;
      if (size && size + len > LIMITS.CHUNK) { send('rec', { nodes: cur }); tally.sent++; cur = []; size = 0; }
      cur.push(x); size += len;
    }
    if (cur.length) { send('rec', { nodes: cur }); tally.sent++; }
  };
  function sendAll() {
    if (room.phase !== 'paired') return;
    lastAll = performance.now();
    tally.alls++;
    for (const c of doc.chunks()) { send('rec', c); tally.sent++; }
  }
  function finish(reason) {
    if (ended) return;
    ended = true;
    clearInterval(sumT);
    try { room.leave(); } catch (err) { /* gone */ }
    emit('ended', reason);
  }
  /* the host starts from the map it shares */
  if (role === 'host') { const m = read(); if (m) doc.diff(m); }
  room.on((type, data) => {
    if (ended) return;
    if (type === 'peer') { emit('peer', data); sendAll(); }
    else if (type === 'left') { emit('left', data); finish(data && data.reason === 'quiet' ? 'lost touch' : 'left'); }
    else if (type === 'phase') { emit('phase', data); if (data === 'closed') finish(room.error || 'closed'); }
    else if (type === 'msg') {
      if (data.t === 'rec') {
        if (!doc.merge(data.m)) return;
        tally.merged++;
        applying = true;
        try { write(doc.view()); } finally { applying = false; }
        emit('change');
      } else if (data.t === 'sum') {
        const mine = doc.digest();
        if ((mine.n !== data.m.n || mine.h !== data.m.h) && performance.now() - lastAll > LIMITS.RESEND_GAP) sendAll();
      }
    }
  });
  sumT = setInterval(() => { if (room.phase === 'paired') send('sum', doc.digest()); }, LIMITS.SYNC_EVERY);
  if (room.phase === 'closed' && room.error) queueMicrotask(() => finish(room.error));
  return {
    get code() { return room.code; },
    get role() { return role; },
    get phase() { return room.phase; },
    get error() { return room.error; },
    get peerName() { return room.peer ? room.peer.name : ''; },
    get applying() { return applying; },
    site: doc.site,
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    /** this window's map changed: send what differs */
    local(m) { if (ended || applying || !m) return; sendRec(doc.diff(m)); },
    leave() { finish('you left'); },
    peek: () => ({ nodes: doc.nodes.size, digest: doc.digest(), tally: { ...tally }, room: room.stats() }),
  };
}

export default { KIND, LIMITS, TYPES, Doc, shareMap, SHAPES };
