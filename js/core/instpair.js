/* ============================================================
   instpair.js — the messages Static Piano and Static Beats rooms send
   (js/core/pair.js, kinds 'piano' and 'beats'). Friends and room codes only.

   Every message is tiny and passes a validator that returns a cleaned copy
   or null; whatever arrives from the other side is never trusted. Senders
   also pace themselves (see limiter()) so a stuck key can't flood the room.

   piano:  vc { vc }                 which voice my notes use   (not `hi`: pair.js uses that for knocking)
           n  { m, vl, d }           note m (0-127), velocity vl 0-100, d 1 down / 0 up   (never `v`, `t` or `f`: those belong to the envelope)
           ao {}                     all my notes off
   beats:  g  { len, tr, bpm, sw }   the grid's shape and tempo
           c  { r, s, l }            one cell: row r (0-7), step s, level l 0-3
           row { r, c:[levels] }     a whole row (clear, copy, rotate, random)
           rs { r, p, d, vo, m }     a row's pitch, decay, volume vo (0-100) and mute
           snap { len, tr, bpm, sw, rows }  the full grid, sent when someone joins
   ============================================================ */
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
export const VOICE_IDS = ['sine', 'triangle', 'square', 'fm', 'pluck', 'organ'];
export const ROWS = 8, LEN_MIN = 8, LEN_MAX = 32;

export const PIANO_TYPES = {
  vc: m => (VOICE_IDS.includes(m?.vc) ? { vc: m.vc } : null),
  n: m => { const a = int(m?.m, 0, 127), vl = int(m?.vl, 0, 100), d = int(m?.d, 0, 1); return a == null || vl == null || d == null ? null : { m: a, vl, d }; },
  ao: () => ({}),
};

const levels = (c, len) => (Array.isArray(c) && c.length === len && c.every(x => int(x, 0, 3) != null) ? c.map(x => Math.round(x)) : null);
const cleanSnap = m => {
  const len = int(m?.len, LEN_MIN, LEN_MAX), bpm = int(m?.bpm, 40, 240), sw = num(m?.sw ?? 0, 0, 0.5);
  if (len == null || bpm == null || sw == null || !Array.isArray(m.rows) || m.rows.length !== ROWS) return null;
  const rows = m.rows.map(r => levels(r, len));
  if (rows.some(r => !r)) return null;
  return { len, tr: m.tr ? 1 : 0, bpm, sw, rows };
};
export const BEATS_TYPES = {
  g: m => { const len = int(m?.len, LEN_MIN, LEN_MAX), bpm = int(m?.bpm, 40, 240), sw = num(m?.sw ?? 0, 0, 0.5); return len == null || bpm == null || sw == null ? null : { len, tr: m.tr ? 1 : 0, bpm, sw }; },
  c: m => { const r = int(m?.r, 0, ROWS - 1), s = int(m?.s, 0, LEN_MAX - 1), l = int(m?.l, 0, 3); return r == null || s == null || l == null ? null : { r, s, l }; },
  row: m => { const r = int(m?.r, 0, ROWS - 1); const c = Array.isArray(m?.c) && m.c.length >= LEN_MIN && m.c.length <= LEN_MAX ? levels(m.c, m.c.length) : null; return r == null || !c ? null : { r, c }; },
  rs: m => {
    const r = int(m?.r, 0, ROWS - 1), p = int(m?.p, -12, 12), d = num(m?.d, 0.3, 3), vo = int(m?.vo, 0, 100);
    return r == null || p == null || d == null || vo == null ? null : { r, p, d, vo, m: m.m ? 1 : 0 };
  },
  snap: m => cleanSnap(m),
};

/** A sender's pace: at most `per` messages in any `ms`; ok() is false when over. */
export function limiter(per = 40, ms = 1000, now = () => performance.now()) {
  let q = [];
  return { ok() { const t = now(); q = q.filter(x => t - x < ms); if (q.length >= per) return false; q.push(t); return true; } };
}

export default { PIANO_TYPES, BEATS_TYPES, limiter, VOICE_IDS };
