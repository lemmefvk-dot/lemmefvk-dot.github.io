/* ============================================================
   sharedlist.js — build a Music playlist together with a friend.

   One person shares a playlist and gets a six-character code (and a
   link); the other types it. They meet in a private two-person room
   (core/pair.js, kind 'plist': sealed with the code, partner only,
   rate-capped, every message validated). Both then add, remove and
   reorder songs and radio stations, and both lists converge.

   ONLY METADATA TRAVELS: a song's file name and size, its place in
   the list, station ids. Never audio. A song is matched to a file the
   other person already has by file name + size (and says so); one they
   don't have is shown as "not on this device", and the person who has
   it can send it with Static Drop.

   HOW EDITS MERGE — an operation log with a timestamp on every item.
   Each edit is an operation (add, remove, move, add/remove station,
   rename) stamped [t, site]: t is a hybrid clock (the later of this
   device's clock and one past the newest stamp seen), site is a random
   id for this session that breaks exact ties the same way on both
   sides. Every item keeps two stamped values: whether it exists (the
   latest add or remove) and where it sits (the latest add or move).
   Merging takes the newer stamp per value, so:
     · two people moving different songs: both moves stay;
     · both moving the same song: the later move wins;
     · one removes a song while the other moves it: it stays removed
       (a move never brings a song back), until someone adds it again
       and that add is newer;
     · both adding the same song at once: shown once.
   Positions are numbers; "between two songs" is their midpoint, so a
   move changes one item only. Merging is order-independent and safe to
   repeat, so the whole list is re-sent every few seconds as well as
   on each edit: a dropped message heals itself (the broker is
   best-effort). Removed items stay as stamped tombstones so an old add
   can't bring them back. Recent operations are kept in a short log.

   Leaving closes the room; each person keeps their own copy.
   Nothing is stored on a server and the room ends when the page does.
   ============================================================ */
import { openPair } from './pair.js';
import { cleanText, isCode } from './roomcode.js';
import { bus } from './bus.js';

export const KIND = 'plist';
export const LIMITS = { ITEMS: 120, NAME: 120, TITLE: 80, STATIONS: 40, LOG: 40, CHUNK: 15, SYNC_EVERY: 8000, SKEW: 10 * 60e3 };

const ID_RE = /^[a-z0-9]{8,16}$/;
const SITE_RE = /^[a-z0-9]{6,12}$/;
const SID_RE = /^[a-z0-9]{2,32}$/;
const rid = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };
export const keyOf = (name, size) => `${String(name).toLowerCase()}|${size || 0}`;

/* stamps: [t, site] */
const later = (a, b) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
const stampOk = (t, w) => Number.isFinite(t) && t > 0 && t < Date.now() + LIMITS.SKEW && typeof w === 'string' && SITE_RE.test(w);
const reg = (v, isNum) => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const val = isNum ? v[0] : v[0] === 1 || v[0] === true ? 1 : v[0] === 0 || v[0] === false ? 0 : null;
  if (val === null || !Number.isFinite(val) || Math.abs(val) > 1e12) return null;
  return stampOk(v[1], v[2]) ? [val, v[1], v[2]] : null;
};

/* ---------------- wire validators (pair.js calls each with the raw message) ---------------- */
export const TYPES = {
  rec: m => {
    const items = [], st = [];
    for (const r of (Array.isArray(m.items) ? m.items : []).slice(0, 30)) {
      if (!r || typeof r.i !== 'string' || !ID_RE.test(r.i)) continue;
      const n = typeof r.n === 'string' ? cleanText(r.n, LIMITS.NAME) : '';
      const s = Number.isSafeInteger(r.s) && r.s >= 0 && r.s < 2 ** 40 ? r.s : 0;
      const e = reg(r.e, false), k = reg(r.k, true);
      if (e || k) items.push({ i: r.i, n, s, e, k });
    }
    for (const r of (Array.isArray(m.st) ? m.st : []).slice(0, 30)) {
      if (!r || typeof r.d !== 'string' || !SID_RE.test(r.d)) continue;
      const e = reg(r.e, false);
      if (e) st.push({ d: r.d, e });
    }
    let nm = null;
    if (Array.isArray(m.nm) && typeof m.nm[0] === 'string' && stampOk(m.nm[1], m.nm[2])) {
      const v = cleanText(m.nm[0], LIMITS.TITLE);
      if (v) nm = [v, m.nm[1], m.nm[2]];
    }
    return items.length || st.length || nm ? { items, st, nm } : null;
  },
  miss: m => ({ k: (Array.isArray(m.k) ? m.k : []).filter(x => typeof x === 'string' && x.length <= 200).slice(0, LIMITS.ITEMS).map(x => cleanText(x, 200)) }),
  drop: m => (isCode(m.code) ? { code: m.code } : null),
};

/* ---------------- the replicated document ---------------- */
export class Doc {
  constructor(site = rid(8)) {
    this.site = site;
    this.items = new Map();     /* iid -> { i, n, s, e:[on,t,w], k:[pos,t,w] } */
    this.st = new Map();        /* station id -> { d, e:[on,t,w] } */
    this.nm = null;             /* [name, t, w] */
    this.maxT = 0;
    this.log = [];              /* newest last: { t, who, text } */
  }
  stamp() { this.maxT = Math.max(Date.now(), this.maxT + 1); return [this.maxT, this.site]; }
  note(who, text, t) { this.log.push({ t, who, text }); if (this.log.length > LIMITS.LOG) this.log.shift(); }

  /** Merge records (ours or the friend's). -> true when anything changed. */
  merge(rec, who = 'Your friend', known = () => true) {
    let changed = false;
    for (const r of rec.items || []) {
      let it = this.items.get(r.i);
      if (!it) {
        if (this.items.size >= LIMITS.ITEMS) continue;
        it = { i: r.i, n: '', s: 0, e: null, k: null };
        this.items.set(r.i, it);
      }
      if (r.n && !it.n) { it.n = r.n; it.s = r.s || 0; changed = true; }
      for (const f of ['e', 'k']) {
        const v = r[f];
        if (!v) continue;
        this.maxT = Math.max(this.maxT, v[1]);
        if (it[f] && !later(v.slice(1), it[f].slice(1))) continue;
        const was = it[f];
        it[f] = v;
        changed = true;
        if (who) {
          const name = it.n || 'a song';
          if (f === 'e' && (!was || was[0] !== v[0])) this.note(who, `${v[0] ? 'added' : 'removed'} “${name}”`, v[1]);
          else if (f === 'k' && was && it.e?.[0] === 1) this.note(who, `moved “${name}”`, v[1]);
        }
      }
    }
    for (const r of rec.st || []) {
      if (!known(r.d)) continue;
      const cur = this.st.get(r.d);
      this.maxT = Math.max(this.maxT, r.e[1]);
      if (cur && !later(r.e.slice(1), cur.e.slice(1))) continue;
      if (!cur && this.st.size >= LIMITS.STATIONS) continue;
      this.st.set(r.d, { d: r.d, e: r.e });
      changed = true;
      if (who && (!cur || cur.e[0] !== r.e[0])) this.note(who, `${r.e[0] ? 'added' : 'removed'} the station ${r.d}`, r.e[1]);
    }
    if (rec.nm) {
      this.maxT = Math.max(this.maxT, rec.nm[1]);
      if (!this.nm || later(rec.nm.slice(1), this.nm.slice(1))) {
        this.nm = rec.nm;
        changed = true;
        if (who) this.note(who, `renamed it “${rec.nm[0]}”`, rec.nm[1]);
      }
    }
    return changed;
  }

  /** Songs that exist, in order; one of any two with the same file name and size is hidden. */
  visible() {
    const live = [...this.items.values()].filter(it => it.e && it.e[0] === 1 && it.n);
    live.sort((a, b) => (a.k ? a.k[0] : Infinity) - (b.k ? b.k[0] : Infinity) || (a.i < b.i ? -1 : 1));
    const first = new Map();
    for (const it of live) {
      const k = keyOf(it.n, it.s);
      if (!first.has(k) || it.i < first.get(k).i) first.set(k, it);
    }
    return live.filter(it => first.get(keyOf(it.n, it.s)) === it);
  }
  stations() { return [...this.st.values()].filter(r => r.e[0] === 1).map(r => r.d); }

  /* ---- local edits: each returns the record to send ---- */
  add(name, size, who = 'You') {
    const t = this.stamp(), vis = this.visible();
    const k = vis.length ? (vis[vis.length - 1].k?.[0] ?? 0) + 1 : 1;
    const it = { i: rid(10), n: cleanText(name, LIMITS.NAME), s: size || 0, e: [1, ...t], k: [k, ...t] };
    this.items.set(it.i, it);
    this.note(who, `added “${it.n}”`, t[0]);
    return { items: [it] };
  }
  remove(i, who = 'You') {
    const it = this.items.get(i);
    if (!it) return null;
    const t = this.stamp();
    it.e = [0, ...t];
    this.note(who, `removed “${it.n}”`, t[0]);
    return { items: [{ i, n: it.n, s: it.s, e: it.e, k: null }] };
  }
  /** Put item i between items `prev` and `next` (either may be null). */
  move(i, prev, next, who = 'You') {
    const it = this.items.get(i);
    if (!it) return null;
    const a = prev && this.items.get(prev)?.k?.[0], b = next && this.items.get(next)?.k?.[0];
    const v = a !== undefined && b !== undefined && a !== null && b !== null ? (a + b) / 2
      : a !== undefined && a !== null ? a + 1 : b !== undefined && b !== null ? b - 1 : 1;
    const t = this.stamp();
    it.k = [v, ...t];
    this.note(who, `moved “${it.n}”`, t[0]);
    return { items: [{ i, n: it.n, s: it.s, e: null, k: it.k }] };
  }
  setStation(d, on, who = 'You') {
    const t = this.stamp();
    this.st.set(d, { d, e: [on ? 1 : 0, ...t] });
    this.note(who, `${on ? 'added' : 'removed'} the station ${d}`, t[0]);
    return { st: [{ d, e: this.st.get(d).e }] };
  }
  rename(v, who = 'You') {
    const t = this.stamp();
    this.nm = [cleanText(v, LIMITS.TITLE), ...t];
    this.note(who, `renamed it “${this.nm[0]}”`, t[0]);
    return { nm: this.nm };
  }
  /** Everything, in chunks small enough for one message each. */
  chunks() {
    const out = [];
    const its = [...this.items.values()].map(it => ({ i: it.i, n: it.n, s: it.s, e: it.e, k: it.k }));
    for (let i = 0; i < its.length; i += LIMITS.CHUNK) out.push({ items: its.slice(i, i + LIMITS.CHUNK) });
    const sts = [...this.st.values()];
    if (sts.length || this.nm) {
      const first = out[0] || (out[0] = {});
      if (sts.length) first.st = sts.slice(0, 30);
      if (this.nm) first.nm = this.nm;
    }
    return out;
  }
}

/* ---------------- sessions: a Doc + a room + this device's playlist ---------------- */
/** hooks: info(ref)->{name,size}|null · resolve(name,size)->{ref}|null · read(plId)->{name,tracks}|null
    · write(plId,{name?,tracks?}) · create(name)->plId · pathOf(ref)->path|null · station(id)->bool · openDrop(path) */
export function createShares(hooks) {
  const sessions = new Set();
  const subs = new Set();
  const emit = ev => subs.forEach(fn => { try { fn(ev); } catch (err) { console.error('[sharedlist]', err); } });

  function begin(role, code, plId) {
    const doc = new Doc();
    const room = openPair({ kind: KIND, role, code, types: TYPES, rtc: false });
    const S = {
      doc, room, role, plId, refs: new Map(), peerMiss: new Set(), offer: null, wantDrop: null,
      lastMiss: '', timers: [], offs: [], ended: false, applying: false,
      get code() { return room.code; }, get phase() { return room.phase; }, get error() { return room.error; },
      get peerName() { return room.peer?.name || 'Your friend'; },
    };
    sessions.add(S);
    const send = (t, body) => { try { return room.send(t, body); } catch (err) { return false; } };
    const sendRec = rec => { if (rec && room.phase === 'paired') send('rec', rec); };
    const sendAll = () => { if (room.phase === 'paired') { for (const c of doc.chunks()) send('rec', c); sendMiss(true); } };

    function finish(reason) {
      if (S.ended) return;
      S.ended = true;
      S.timers.forEach(clearInterval); S.offs.forEach(f => f());
      try { room.leave(); } catch (err) { /* gone */ }
      sessions.delete(S);
      emit({ type: 'ended', plId: S.plId, reason, session: S });
    }

    /** Write the merged list into this device's playlist, resolving each song to a local file. */
    function materialize() {
      if (S.plId === null) return;
      const tracks = [];
      S.refs.clear();
      S.missing = [];
      for (const it of doc.visible()) {
        const hit = hooks.resolve(it.n, it.s);
        if (hit) { tracks.push({ ref: hit.ref, name: it.n }); S.refs.set(hit.ref, it.i); } else S.missing.push(it);
      }
      const cur = hooks.read(S.plId);
      const patch = {};
      if (!cur || cur.tracks.length !== tracks.length || cur.tracks.some((t, i) => t.ref !== tracks[i].ref)) patch.tracks = tracks;
      if (doc.nm && cur && cur.name !== doc.nm[0]) patch.name = doc.nm[0];
      if (Object.keys(patch).length) { S.applying = true; try { hooks.write(S.plId, patch); } finally { S.applying = false; } }
      sendMiss();
    }
    function sendMiss(force) {
      const k = (S.missing || []).map(it => keyOf(it.n, it.s)).sort();
      const sig = k.join('\n');
      if (!force && sig === S.lastMiss) return;
      S.lastMiss = sig;
      if (room.phase === 'paired') send('miss', { k });
    }
    S.refresh = () => { if (!S.ended) { materialize(); emit({ type: 'change', plId: S.plId, session: S }); } };

    S.view = () => {
      const stations = doc.stations().filter(d => hooks.station(d));
      const items = doc.visible().map(it => ({
        i: it.i, name: it.n, size: it.s, ref: [...S.refs].find(([, i]) => i === it.i)?.[0] || null,
        peerMissing: S.peerMiss.has(keyOf(it.n, it.s)),
      }));
      return { items, stations, log: doc.log.slice(), missing: items.filter(x => !x.ref) };
    };

    /** The playlist on this device was edited by a person: turn the difference into operations. */
    S.noteEdit = (before, after) => {
      if (S.applying || S.ended) return;
      const recs = [];
      if (after.name !== before.name) recs.push(doc.rename(after.name));
      const bRefs = before.tracks.map(t => t.ref), aRefs = after.tracks.map(t => t.ref);
      for (const ref of bRefs.filter(r => !aRefs.includes(r))) {
        const i = S.refs.get(ref);
        if (i) { recs.push(doc.remove(i)); S.refs.delete(ref); }
      }
      for (const ref of aRefs.filter(r => !bRefs.includes(r))) {
        const info = hooks.info(ref);
        if (!info) continue;
        const dup = doc.visible().find(it => keyOf(it.n, it.s) === keyOf(info.name, info.size));
        if (dup) { S.refs.set(ref, dup.i); continue; }
        const r = doc.add(info.name, info.size);
        S.refs.set(ref, r.items[0].i);
        recs.push(r);
      }
      if (bRefs.length === aRefs.length && bRefs.every(r => aRefs.includes(r)) && bRefs.some((r, n) => r !== aRefs[n])) {
        const without = (list, x) => list.filter(r => r !== x);
        const same = (x, y) => x.length === y.length && x.every((r, n) => r === y[n]);
        const cand = [aRefs.find((r, n) => r !== bRefs[n]), bRefs.find((r, n) => r !== aRefs[n])];
        const moved = cand.find(x => x && same(without(bRefs, x), without(aRefs, x)));
        if (moved) {
          const at = aRefs.indexOf(moved);
          const prev = at > 0 ? S.refs.get(aRefs[at - 1]) : null, next = at < aRefs.length - 1 ? S.refs.get(aRefs[at + 1]) : null;
          const r = doc.move(S.refs.get(moved), prev, next);
          if (r) recs.push(r);
        }
      }
      for (const r of recs) sendRec(r);
      if (recs.length) emit({ type: 'change', plId: S.plId, session: S });
    };
    S.addStation = (d, on) => { if (hooks.station(d)) { sendRec(doc.setStation(d, on)); emit({ type: 'change', plId: S.plId, session: S }); } };
    S.sendWithDrop = ref => {
      const path = hooks.pathOf(ref);
      const info = hooks.info(ref);
      if (!path || !info) return false;
      S.wantDrop = info.name;
      hooks.openDrop(path);
      return true;
    };

    /* the host starts from the playlist it shares */
    if (role === 'host') {
      const cur = hooks.read(plId);
      for (const t of cur?.tracks || []) {
        const info = hooks.info(t.ref);
        if (!info) continue;
        const r = doc.add(info.name, info.size);
        S.refs.set(t.ref, r.items[0].i);
      }
      doc.rename(cur?.name || 'Shared playlist');
    }

    S.offs.push(room.on((type, data) => {
      if (S.ended) return;
      if (type === 'peer') {
        emit({ type: 'peer', plId: S.plId, session: S });
        sendAll();
        S.refresh();
      } else if (type === 'left') finish(data?.reason === 'quiet' ? 'lost touch' : 'left');
      else if (type === 'phase') {
        if (data === 'closed') { if (room.error) finish(room.error); } else emit({ type: 'change', plId: S.plId, session: S });
      } else if (type === 'msg') {
        const { t, m } = data;
        if (t === 'rec') {
          if (S.plId === null) {
            S.plId = hooks.create(m.nm?.[0] || 'Shared playlist');
          }
          if (doc.merge(m, S.peerName, hooks.station)) S.refresh();
        } else if (t === 'miss') {
          S.peerMiss = new Set(m.k);
          emit({ type: 'change', plId: S.plId, session: S });
        } else if (t === 'drop') {
          S.offer = { code: m.code, from: S.peerName };
          emit({ type: 'change', plId: S.plId, session: S });
        }
      }
    }));
    S.timers.push(setInterval(() => { if (room.phase === 'paired') sendAll(); }, LIMITS.SYNC_EVERY));
    /* a file that arrived (Drop, an import…) may be one we were missing */
    S.offs.push(bus.on('media:change', () => S.refresh()), bus.on('fs:change', () => { if (S.missing?.length) S.refresh(); }));
    S.offs.push(bus.on('drop:hosting', ({ code, names } = {}) => {
      if (!S.wantDrop || !isCode(code) || !(names || []).includes(S.wantDrop) || room.phase !== 'paired') return;
      S.wantDrop = null;
      send('drop', { code });
    }));
    S.leave = () => finish('you left');
    if (room.phase === 'closed' && room.error) { queueMicrotask(() => finish(room.error)); }
    return S;
  }

  return {
    host: plId => begin('host', null, plId),
    join: code => begin('guest', code, null),
    byPlaylist: plId => [...sessions].find(s => s.plId === plId && !s.ended) || null,
    all: () => [...sessions],
    noteEdit(plId, before, after) { const s = this.byPlaylist(plId); if (s) s.noteEdit(before, after); },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

export default { KIND, LIMITS, TYPES, Doc, createShares, keyOf };
