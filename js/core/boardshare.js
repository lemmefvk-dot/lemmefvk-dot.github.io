/* ============================================================
   boardshare.js — share a Static Board live with a friend.

   One person shares a board and gets a six-character code (and a link,
   #board=<CODE>); the other types it. They meet in a private two-person
   room (core/pair.js, kind 'board': sealed with the code, partner only,
   rate-capped, every message checked here). Both can then add, edit,
   move, archive and delete cards and columns, and both boards converge.

   WHAT TRAVELS: card titles, notes, checklists, colour labels, due dates
   and pins; column names, order, limits and whether they are done; the
   board's name. NOT pictures, links (they point at things on one device)
   or reactions (your own marks). Each device keeps those for itself.

   HOW EDITS MERGE — every field of every card and column is a register
   stamped [t, site]: t a hybrid clock (the later of this device's clock
   and one past the newest stamp seen), site a random id for this session
   that breaks exact ties the same way on both sides. Merging keeps the
   newer stamp per field, so two people editing different fields of one
   card both keep their edit, and the same field goes to the later one.
   A card or column that is removed keeps a stamped "gone" register, so
   an older edit can't bring it back. Order is a number per card (and per
   column): moving one changes only its own number, to halfway between
   its new neighbours; the rest keep theirs (the longest run already in
   order is left alone). Merging is order-free and safe to repeat.

   The broker is best-effort, so each side sends a short digest of what
   it holds every few seconds; when the two differ, both send everything
   again (in small messages), and a lost message heals by itself.

     shareBoard({ role, code?, read, write })
       read()      -> the shared board in Board's own shape, or null
       write(view) -> put the merged board into Board
                      view: { name, cols: [{ id, name, done, limit, archived, cards: [card] }],
                              archived: [{ card, col }] }  card: { id, title, notes, color, due, pinned, checklist }
       -> session { code, role, phase, error, peerName, on(fn), local(board), leave(), peek() }
          fn(type): 'phase' | 'peer' | 'change' | 'left' | 'ended'
   ============================================================ */
import { openPair } from './pair.js';
import { cleanText } from './roomcode.js';
import { validDay } from './tasks.js';

export const KIND = 'board';
export const LIMITS = { COLS: 60, CARDS: 2400, TITLE: 200, NOTES: 4000, COL: 40, NAME: 60, ITEMS: 80, ITEM: 200, CL_CHARS: 9000, CHUNK: 11000, SYNC_EVERY: 4000, RESEND_GAP: 5000, SKEW: 10 * 60e3 };
const LABELS = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const SITE_RE = /^[a-z0-9]{6,12}$/;
const rid = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };
const later = (a, b) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
const notes = v => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, LIMITS.NOTES);
const line = (v, n) => cleanText(String(v ?? '').replace(/\s+/g, ' ').trim(), n);

/* the fields a column and a card have on the wire, and what a good value is */
const bit = v => (v === 1 || v === 0 ? v : null);
const COL_F = {
  e: bit, ar: bit, d: bit,
  k: v => (Number.isFinite(v) && Math.abs(v) < 1e12 ? v : null),
  n: v => (typeof v === 'string' && line(v, LIMITS.COL) ? line(v, LIMITS.COL) : null),
  l: v => (Number.isInteger(v) && v >= 0 && v <= 400 ? v : null),
};
function checklist(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  let size = 0;
  for (const it of v.slice(0, LIMITS.ITEMS)) {
    if (!it || typeof it.t !== 'string') continue;
    const t = line(it.t, LIMITS.ITEM);
    if (!t) continue;
    size += t.length + 12;
    if (size > LIMITS.CL_CHARS) break;           /* a very long checklist is cut short, not refused */
    out.push({ t, d: it.d === true });
  }
  return out;
}
const CARD_F = {
  e: bit, ar: bit, pi: bit,
  k: COL_F.k,
  c: v => (typeof v === 'string' && ID_RE.test(v) ? v : null),
  ti: v => (typeof v === 'string' && line(v, LIMITS.TITLE) ? line(v, LIMITS.TITLE) : null),
  no: v => (typeof v === 'string' ? notes(v) : null),
  co: v => (LABELS.includes(v) ? v : null),
  du: v => (v === '' || validDay(v) ? v : null),
  cl: checklist,
};
const stampOk = (t, w) => Number.isFinite(t) && t > 0 && t < Date.now() + LIMITS.SKEW && typeof w === 'string' && SITE_RE.test(w);
function cleanRec(r, F) {
  if (!r || typeof r !== 'object' || typeof r.i !== 'string' || !ID_RE.test(r.i)) return null;
  const out = { i: r.i };
  let any = false;
  for (const [f, ok] of Object.entries(F)) {
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
    const cols = (Array.isArray(m.cols) ? m.cols : []).slice(0, 80).map(r => cleanRec(r, COL_F)).filter(Boolean);
    const cards = (Array.isArray(m.cards) ? m.cards : []).slice(0, 400).map(r => cleanRec(r, CARD_F)).filter(Boolean);
    let nm = null;
    if (Array.isArray(m.nm) && m.nm.length === 3 && typeof m.nm[0] === 'string' && stampOk(m.nm[1], m.nm[2])) {
      const v = line(m.nm[0], LIMITS.NAME);
      if (v) nm = [v, m.nm[1], m.nm[2]];
    }
    return cols.length || cards.length || nm ? { cols, cards, nm } : null;
  },
  sum(m) {
    return Number.isSafeInteger(m.n) && m.n >= 0 && Number.isSafeInteger(m.h) ? { n: m.n, h: m.h } : null;
  },
};

/* ---------------- the replicated board ---------------- */
const same = (a, b) => (a === b) || (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b));
/** the indexes of the longest run of known numbers that already go up (kept as they are) */
function keepIdx(nums) {
  const tails = [], prev = new Array(nums.length).fill(-1), at = [];
  nums.forEach((v, i) => {
    if (v == null) return;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (nums[tails[m]] < v) lo = m + 1; else hi = m; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i; at[lo] = i;
  });
  const keep = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}
/** new order numbers for the items that are out of place: -> [[index, number]] */
function placeIn(nums) {
  const keep = keepIdx(nums);
  const nextKept = new Array(nums.length + 1).fill(null);
  for (let i = nums.length - 1; i >= 0; i--) nextKept[i] = keep.has(i) ? nums[i] : nextKept[i + 1];
  const out = [], now = nums.slice();
  for (let i = 0; i < now.length; i++) {
    if (keep.has(i)) continue;
    /* everything before i already has its number (kept or just given one) */
    const prev = i > 0 ? now[i - 1] : null, next = nextKept[i + 1];
    const v = prev == null && next == null ? 1 : prev == null ? next - 1 : next == null ? prev + 1 : (prev + next) / 2;
    if (prev != null && next != null && !(v > prev && v < next)) return null;     /* out of room between two: number them all afresh */
    now[i] = v;
    out.push([i, v]);
  }
  return out;
}

export class Doc {
  constructor(site = rid(8)) {
    this.site = site;
    this.cols = new Map();     /* id -> { i, e, ar, d, k, n, l } each [v, t, w] */
    this.cards = new Map();    /* id -> { i, e, ar, pi, k, c, ti, no, co, du, cl } */
    this.nm = null;
    this.maxT = 0;
  }
  stamp() { this.maxT = Math.max(Date.now(), this.maxT + 1); return [this.maxT, this.site]; }

  /** Merge records (ours or the friend's). -> true when anything changed. */
  merge(rec) {
    let changed = false;
    const into = (map, list, F, cap) => {
      for (const r of list || []) {
        let cur = map.get(r.i);
        if (!cur) { if (map.size >= cap) continue; cur = { i: r.i }; map.set(r.i, cur); }
        for (const f of Object.keys(F)) {
          const v = r[f];
          if (!v) continue;
          this.maxT = Math.max(this.maxT, v[1]);
          if (cur[f] && !later(v.slice(1), cur[f].slice(1))) continue;
          if (cur[f] && same(cur[f][0], v[0]) && cur[f][1] === v[1] && cur[f][2] === v[2]) continue;
          cur[f] = v;
          changed = true;
        }
      }
    };
    into(this.cols, rec.cols, COL_F, LIMITS.COLS);
    into(this.cards, rec.cards, CARD_F, LIMITS.CARDS);
    if (rec.nm) {
      this.maxT = Math.max(this.maxT, rec.nm[1]);
      if (!this.nm || later(rec.nm.slice(1), this.nm.slice(1))) { this.nm = rec.nm; changed = true; }
    }
    return changed;
  }

  /** The board as the merged registers say. */
  view() {
    const on = r => r.e && r.e[0] === 1;
    const pos = r => (r.k ? r.k[0] : Infinity);
    const byPos = (a, b) => pos(a) - pos(b) || (a.i < b.i ? -1 : 1);
    const cols = [...this.cols.values()].filter(r => on(r) && r.n).sort(byPos).map(r => ({
      id: r.i, name: r.n[0], done: !!(r.d && r.d[0]), limit: r.l ? r.l[0] : 0, archived: !!(r.ar && r.ar[0]), cards: [],
    }));
    const live = cols.filter(c => !c.archived);
    const byId = new Map(cols.map(c => [c.id, c]));
    const archived = [];
    const cards = [...this.cards.values()].filter(r => on(r) && r.ti).sort(byPos);
    for (const r of cards) {
      const card = {
        id: r.i, title: r.ti[0], notes: r.no ? r.no[0] : '', color: r.co ? r.co[0] : 'none', due: r.du && r.du[0] ? r.du[0] : null,
        pinned: !!(r.pi && r.pi[0]), checklist: r.cl ? r.cl[0].map(x => ({ text: x.t, done: x.d })) : [],
      };
      const col = r.c && byId.get(r.c[0]);
      if (r.ar && r.ar[0]) { archived.push({ card, col: col ? col.id : '', colName: col ? col.name : '' }); continue; }
      /* a card whose column the other person removed goes to the first column, so nothing is lost */
      (col || live[0] || { cards: [] }).cards.push(card);
    }
    for (const c of cols) c.cards = [...c.cards.filter(x => x.pinned), ...c.cards.filter(x => !x.pinned)];
    return { name: this.nm ? this.nm[0] : '', cols, archived };
  }

  /** What changed on this device (Board's own shape): stamp it. -> records to send, or null. */
  diff(b) {
    const out = { cols: [], cards: [] };
    const outIdx = new Map();                   /* out list -> (id -> its record there) */
    const set = (map, list, id, f, v) => {
      const cur = map.get(id);
      if (cur && cur[f] && same(cur[f][0], v)) return;
      const reg = [v, ...this.stamp()];
      let idx = outIdx.get(list);
      if (!idx) { idx = new Map(); outIdx.set(list, idx); }
      let r = idx.get(id);
      if (!r) { r = { i: id }; idx.set(id, r); list.push(r); }
      r[f] = reg;
      if (cur) cur[f] = reg; else map.set(id, { i: id, [f]: reg });
    };
    if (!this.nm || this.nm[0] !== b.name) { this.nm = [b.name, ...this.stamp()]; out.nm = this.nm; }
    /* columns: on the board, or archived */
    const colsHere = [...b.cols.map(c => ({ col: c, ar: 0 })), ...(b.archivedCols || []).map(a => ({ col: a.col, ar: 1 }))];
    const seenCols = new Set();
    for (const { col, ar } of colsHere) {
      if (seenCols.size >= LIMITS.COLS) break;
      seenCols.add(col.id);
      set(this.cols, out.cols, col.id, 'e', 1);
      set(this.cols, out.cols, col.id, 'ar', ar);
      set(this.cols, out.cols, col.id, 'n', line(col.name, LIMITS.COL) || 'Untitled');
      set(this.cols, out.cols, col.id, 'd', col.done ? 1 : 0);
      set(this.cols, out.cols, col.id, 'l', col.limit || 0);
    }
    this.order(this.cols, out.cols, b.cols.map(c => c.id), set);
    for (const r of this.cols.values()) if (r.e && r.e[0] === 1 && !seenCols.has(r.i)) set(this.cols, out.cols, r.i, 'e', 0);
    /* cards: in a column (on the board or archived with it), or archived on their own */
    const seen = new Set();
    const put = (c, colId, archived) => {
      if (seen.size >= LIMITS.CARDS) return;
      seen.add(c.id);
      set(this.cards, out.cards, c.id, 'e', 1);
      set(this.cards, out.cards, c.id, 'ar', archived ? 1 : 0);
      if (colId) set(this.cards, out.cards, c.id, 'c', colId);
      set(this.cards, out.cards, c.id, 'ti', line(c.title, LIMITS.TITLE) || 'Untitled card');
      set(this.cards, out.cards, c.id, 'no', notes(c.notes));
      set(this.cards, out.cards, c.id, 'co', LABELS.includes(c.color) ? c.color : 'none');
      set(this.cards, out.cards, c.id, 'du', c.due || '');
      set(this.cards, out.cards, c.id, 'pi', c.pinned ? 1 : 0);
      set(this.cards, out.cards, c.id, 'cl', checklist((c.checklist || []).map(i => ({ t: i.text, d: !!i.done }))) || []);
    };
    for (const { col } of colsHere) {
      for (const c of col.cards) put(c, col.id, false);
      this.order(this.cards, out.cards, col.cards.map(c => c.id), set);
    }
    for (const a of b.archive || []) put(a.card, (this.cards.get(a.card.id)?.c || [a.col])[0] || a.col, true);
    for (const r of this.cards.values()) if (r.e && r.e[0] === 1 && !seen.has(r.i)) set(this.cards, out.cards, r.i, 'e', 0);
    return out.cols.length || out.cards.length || out.nm ? out : null;
  }
  /* order numbers: the longest run already in order keeps its numbers; the rest go between neighbours */
  order(map, list, ids, set) {
    const nums = ids.map(id => { const r = map.get(id); return r && r.k ? r.k[0] : null; });
    let moves = placeIn(nums);
    if (!moves) moves = ids.map((id, i) => [i, i + 1]);           /* out of room: number them 1, 2, 3… */
    for (const [i, v] of moves) set(map, list, ids[i], 'k', v);
  }

  /** Everything, as records small enough for one message each. */
  chunks() {
    const out = [];
    let cur = { cols: [], cards: [] }, size = 0;
    const flush = () => { if (cur.cols.length || cur.cards.length || cur.nm) out.push(cur); cur = { cols: [], cards: [] }; size = 0; };
    if (this.nm) cur.nm = this.nm;
    for (const [kind, map] of [['cols', this.cols], ['cards', this.cards]]) {
      for (const r of map.values()) {
        const len = JSON.stringify(r).length;
        if (size && size + len > LIMITS.CHUNK) flush();
        cur[kind].push(r);
        size += len;
      }
    }
    flush();
    return out;
  }
  /** a short fingerprint of everything held: when two differ, someone is missing something */
  digest() {
    let h = 0x811c9dc5, n = 0;
    const mix = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    for (const map of [this.cols, this.cards]) {
      for (const id of [...map.keys()].sort()) {
        const r = map.get(id);
        n++;
        mix(id);
        for (const f of Object.keys(r).sort()) if (f !== 'i') mix(`${f}${r[f][1]}${r[f][2]}`);
      }
    }
    if (this.nm) mix(`nm${this.nm[1]}${this.nm[2]}`);
    return { n, h: h | 0 };
  }
}

/* ---------------- a session: a Doc, a room, and this device's board ---------------- */
export function shareBoard({ role, code = null, read, write }) {
  const doc = new Doc();
  const room = openPair({ kind: KIND, role, code, types: TYPES, rtc: false });
  const subs = new Set();
  const emit = (type, data) => subs.forEach(fn => { try { fn(type, data); } catch (err) { console.error('[boardshare]', err); } });
  let ended = false, applying = false, lastAll = 0, sumT = 0;
  const tally = { sent: 0, merged: 0, alls: 0 };
  const send = (t, body) => { try { return room.send(t, body); } catch (err) { return false; } };
  const sendRec = r => { if (r && room.phase === 'paired') for (const c of chunkRec(r)) { send('rec', c); tally.sent++; } };
  function sendAll() {
    if (room.phase !== 'paired') return;
    lastAll = performance.now();
    tally.alls++;
    for (const c of doc.chunks()) { send('rec', c); tally.sent++; }
  }
  /* one local edit's records, split into messages that fit */
  function chunkRec(r) {
    const out = [];
    let cur = { cols: [], cards: [] }, size = 0;
    if (r.nm) cur.nm = r.nm;
    for (const kind of ['cols', 'cards']) for (const x of r[kind]) {
      const len = JSON.stringify(x).length;
      if (size && size + len > LIMITS.CHUNK) { out.push(cur); cur = { cols: [], cards: [] }; size = 0; }
      cur[kind].push(x);
      size += len;
    }
    if (cur.cols.length || cur.cards.length || cur.nm) out.push(cur);
    return out;
  }
  function finish(reason) {
    if (ended) return;
    ended = true;
    clearInterval(sumT);
    try { room.leave(); } catch (err) { /* gone */ }
    emit('ended', reason);
  }
  /* the host starts from the board it shares */
  if (role === 'host') { const b = read(); if (b) doc.diff(b); }
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
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    /** this device's board changed: send what differs */
    local(b) { if (ended || applying || !b) return; sendRec(doc.diff(b)); },
    leave() { finish('you left'); },
    peek: () => ({ cols: doc.cols.size, cards: doc.cards.size, digest: doc.digest(), tally: { ...tally }, room: room.stats() }),
  };
}

export default { KIND, LIMITS, TYPES, Doc, shareBoard };
