/* ============================================================
   arcade/pulserun-code.js — a Pulse Run level as a code anyone can paste.

     PR1.<base64url of a small JSON>

   The JSON holds the speed, the 12 rows run-length coded (a glyph and a
   count: "#12.4^"), and a PROOF: the steps the button changed on in a run
   that finishes the level. decode() is strict and trusts nothing:
   it refuses a code that is too long, has the wrong shape or a glyph it
   does not know, whose start or finish is not flat and clear, or whose
   proof does not, when played through the real simulation, reach the
   finish. So nobody can be sent a level that cannot be completed.
   ============================================================ */
import { ROWS, GROUND, GLYPHS, MIN_COLS, MAX_COLS, START_X, FINISH_RUN, makeLevel, replay, stepsToFinish } from './pulserun-sim.js';

export const PREFIX = 'PR1.';
export const MAX_CODE = 9000;
export const MAX_TOGGLES = 800;
export const SPEEDS = [7, 8, 9, 10, 11, 12];
export const SAFE_START = 6;               /* columns at the start that stay flat and clear */
export const SAFE_END = 10;                /* …and at the end */

const rle = s => s.replace(/(.)\1*/g, (m, ch) => (m.length > 1 ? ch + m.length : ch));
function unrle(s, cols) {
  let out = '';
  const re = /([.#^vJFW])(\d*)/y;
  let m, at = 0;
  while (at < s.length && (m = re.exec(s))) {
    const n = m[2] ? parseInt(m[2], 10) : 1;
    if (!(n >= 1 && n <= MAX_COLS)) return null;
    out += m[1].repeat(n);
    at = re.lastIndex;
    if (out.length > cols) return null;
  }
  return at === s.length && out.length === cols ? out : null;
}
const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** why a set of rows cannot be a level, or '' when it can */
export function problem(rows, speed) {
  if (!SPEEDS.includes(speed)) return 'speed';
  if (!Array.isArray(rows) || rows.length !== ROWS) return 'shape';
  const cols = rows[0]?.length;
  if (!Number.isInteger(cols) || cols < MIN_COLS || cols > MAX_COLS) return 'size';
  for (let r = 0; r < ROWS; r++) {
    if (typeof rows[r] !== 'string' || rows[r].length !== cols) return 'shape';
    for (let c = 0; c < cols; c++) {
      const ch = rows[r][c];
      if (!GLYPHS.includes(ch)) return 'glyph';
      if (r >= GROUND && ch !== '.' && ch !== '#') return 'glyph';
    }
  }
  for (let c = 0; c < SAFE_START; c++) {
    for (let r = 0; r < GROUND; r++) if (rows[r][c] !== '.') return 'start';
    for (let r = GROUND; r < ROWS; r++) if (rows[r][c] !== '#') return 'start';
  }
  for (let c = cols - SAFE_END; c < cols; c++) {
    for (let r = 0; r < GROUND; r++) if (rows[r][c] !== '.') return 'end';
    for (let r = GROUND; r < ROWS; r++) if (rows[r][c] !== '#') return 'end';
  }
  return '';
}

export function encode(rows, speed, proof) {
  return PREFIX + b64(JSON.stringify({ s: speed, g: rows.map(rle), p: proof }));
}

/** a pasted code → { ok: true, rows, speed, proof, level } or { ok: false, why } (why: a short key) */
export function decode(code) {
  const text = String(code || '').trim();
  if (!text.startsWith(PREFIX)) return { ok: false, why: 'format' };
  if (text.length > MAX_CODE) return { ok: false, why: 'long' };
  let o;
  try { o = JSON.parse(unb64(text.slice(PREFIX.length))); } catch (err) { return { ok: false, why: 'format' }; }
  if (!o || typeof o !== 'object' || !Array.isArray(o.g) || o.g.length !== ROWS || !Array.isArray(o.p) || !Number.isInteger(o.s)) return { ok: false, why: 'format' };
  const widths = o.g.map(s => (typeof s === 'string' ? (s.match(/([.#^vJFW])(\d*)/g) || []).reduce((a, m) => a + (m.length > 1 ? parseInt(m.slice(1), 10) : 1), 0) : -1));
  const cols = widths[0];
  if (!Number.isInteger(cols) || cols < MIN_COLS || cols > MAX_COLS || widths.some(w => w !== cols)) return { ok: false, why: 'size' };
  const rows = o.g.map(s => unrle(s, cols));
  if (rows.some(r => r === null)) return { ok: false, why: 'glyph' };
  const bad = problem(rows, o.s);
  if (bad) return { ok: false, why: bad };
  const proof = o.p;
  if (proof.length > MAX_TOGGLES || proof.some((v, i) => !Number.isInteger(v) || v < 0 || (i > 0 && v <= proof[i - 1]))) return { ok: false, why: 'proof' };
  const level = makeLevel(rows, o.s, '');
  const run = replay(level, proof, stepsToFinish(level) + 240);
  if (!run.won) return { ok: false, why: 'proof' };
  return { ok: true, rows, speed: o.s, proof, level };
}
export { START_X, FINISH_RUN };
