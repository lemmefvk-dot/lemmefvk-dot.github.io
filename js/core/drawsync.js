/* ============================================================
   drawsync.js — the shared stroke log behind Draw Together in
   Static Paint (js/apps/paint.js). No DOM, no network.

   A shared canvas is a starting picture (the base) plus an ordered
   log of strokes; anyone's copy is the base with every stroke that
   isn't undone drawn on top, in log order. Each stroke records who
   drew it, so Undo only ever takes back your own.

     stroke { id, a:'h'|'g' (host/guest), s (order), tool, c, w, p:[x,y,…], n, undone }
     tool: brush · eraser · line · rect · ellipse · fill · clear

   Order: every stroke takes s = one more than any s seen so far
   (a Lamport clock), and ties go host first, so both copies agree on
   the order even when two strokes start at the same moment.

   On the wire a stroke travels in chunks — 'sk' { id, s, tool, c, w,
   i, p, n? }: the points from index i, and n (the total) on the last
   one — batched while you draw, so the friend sees it as it's drawn.
   Points are whole logical pixels. Over the public broker a chunk can
   be lost; a stroke whose count doesn't add up asks once for a resend
   ('need'). Other messages: un/re { id } undo/redo your own stroke ·
   cur { x, y } your cursor (x < 0: gone) · doc { w, h, base } the
   host's canvas size and whether a base picture follows on the direct
   link (img { size }, its bytes, imge {}).

   Every message is checked here (checkers return a clean copy or
   null) before Paint looks at it.
   ============================================================ */
export const TOOLS = new Set(['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'clear']);
export const LIMITS = {
  pts: 2000,            /* points in one stroke (a longer drag becomes several strokes) */
  batch: 150,           /* points in one message */
  log: 600,             /* strokes kept undoable; older ones are folded into the base */
  fold: 150,            /* how many fold at once */
  replayMqtt: 150,      /* strokes a late joiner gets without a direct link */
  img: 8 * 1024 * 1024, /* the base picture, bytes */
  dim: 2048,            /* biggest canvas side, logical px */
};
const ID_RE = /^[hg][0-9a-z]{1,10}$/;
const HEX = /^#[0-9a-f]{6}$/;
const coord = v => Number.isFinite(v) && v >= -64 && v <= LIMITS.dim + 64;

export const checkers = {
  sk(m) {
    if (typeof m.id !== 'string' || !ID_RE.test(m.id) || !TOOLS.has(m.tool)) return null;
    if (!Number.isInteger(m.s) || m.s < 1 || m.s > 1e9) return null;
    if (!Number.isInteger(m.i) || m.i < 0 || m.i >= LIMITS.pts) return null;
    if (m.n !== undefined && (!Number.isInteger(m.n) || m.n < 0 || m.n > LIMITS.pts)) return null;
    const c = typeof m.c === 'string' ? m.c.toLowerCase() : '';
    if (m.tool !== 'eraser' && m.tool !== 'clear' && !HEX.test(c)) return null;
    if (!Number.isFinite(m.w) || m.w < 1 || m.w > 64) return null;
    if (!Array.isArray(m.p) || m.p.length % 2 || m.p.length > LIMITS.batch * 2 || !m.p.every(coord)) return null;
    if (m.i + m.p.length / 2 > LIMITS.pts) return null;
    const need = { brush: 1, eraser: 1, line: 2, rect: 2, ellipse: 2, fill: 1, clear: 0 }[m.tool];
    if (m.n !== undefined && m.n < need) return null;
    return { id: m.id, s: m.s, tool: m.tool, c: HEX.test(c) ? c : '#ffffff', w: Math.round(m.w * 10) / 10, i: m.i, p: m.p.map(v => Math.round(v)), n: m.n };
  },
  un: m => (typeof m.id === 'string' && ID_RE.test(m.id) ? { id: m.id } : null),
  re: m => (typeof m.id === 'string' && ID_RE.test(m.id) ? { id: m.id } : null),
  need: m => (typeof m.id === 'string' && ID_RE.test(m.id) ? { id: m.id } : null),
  cur: m => (Number.isFinite(m.x) && Number.isFinite(m.y) && m.x <= LIMITS.dim && m.y <= LIMITS.dim
    ? (m.x < 0 ? { x: -1, y: -1 } : { x: Math.round(m.x), y: Math.max(0, Math.round(m.y)) }) : null),
  doc: m => (Number.isInteger(m.w) && Number.isInteger(m.h) && m.w >= 60 && m.h >= 60 && m.w <= LIMITS.dim && m.h <= LIMITS.dim && typeof m.base === 'boolean'
    ? { w: m.w, h: m.h, base: m.base } : null),
  img: (m, via) => (via === 'rtc' && Number.isInteger(m.size) && m.size > 0 && m.size <= LIMITS.img ? { size: m.size } : null),
  imge: (m, via) => (via === 'rtc' ? {} : null),
};

/** Does stroke a come before stroke b? */
export const before = (a, b) => a.s < b.s || (a.s === b.s && a.a === 'h' && b.a !== 'h');

/** A stroke log: ordered strokes, found by id. */
export function makeLog() {
  const list = [];
  const byId = new Map();
  return {
    list, byId,
    /** add (in order); returns the index it went in at */
    insert(st) {
      let k = list.length;
      while (k > 0 && before(st, list[k - 1])) k--;
      list.splice(k, 0, st);
      byId.set(st.id, st);
      return k;
    },
    /** the oldest `count` strokes leave the log (the caller draws them into the base first) */
    shift(count) {
      const out = list.splice(0, count);
      out.forEach(st => byId.delete(st.id));
      return out;
    },
    clear() { list.length = 0; byId.clear(); },
    get size() { return list.length; },
  };
}

/** Are all of a stroke's points here? */
export const complete = st => Number.isInteger(st.n) && st.p.length === st.n * 2 && !st.p.some(v => v === undefined);

/** The chunks a stroke is sent as. */
export function chunks(st) {
  const out = [];
  const total = st.p.length / 2;
  if (!total) return [{ id: st.id, s: st.s, tool: st.tool, c: st.c, w: st.w, i: 0, p: [], n: 0 }];
  for (let i = 0; i < total; i += LIMITS.batch) {
    const end = Math.min(total, i + LIMITS.batch);
    out.push({ id: st.id, s: st.s, tool: st.tool, c: st.c, w: st.w, i, p: st.p.slice(i * 2, end * 2), ...(end === total ? { n: total } : {}) });
  }
  return out;
}

export default { TOOLS, LIMITS, checkers, before, makeLog, complete, chunks };
