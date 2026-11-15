/* ============================================================
   arcade/nonogramcode.js — a Nonogram picture as a short code a
   friend can paste. Pure: no DOM.

     NONO-<base64url>

   The bytes: 1 (version), width, height, name length, the name in
   UTF-8, the picture one bit per cell row by row (1 = filled), then
   two check bytes (FNV-1a of everything before them), so a mistyped
   or cut-off code is caught instead of opening a different picture.
   A 15×15 picture with a name is about 60 characters.

   A code is somebody else's data, so reading it is strict: the prefix,
   the alphabet, a size the editor makes (5, 10 or 15 square), the
   exact length and the check bytes must all be right, and the name is
   one line of plain text (cut to 24 characters, control and direction
   characters removed, a word the word games block drops the name). The
   game shows the name with textContent only.

   checkPicture() is what decides whether a picture may be shared or
   played: it must have something filled in and exactly one solution,
   proved by the search in nonogramlogic.js. It also says whether line
   logic alone solves it (the bundled pictures all are), and where two
   solutions differ when there are several.
   ============================================================ */
import { toB64url, fromB64url } from '../core/sharelink.js';
import { hash32 } from './challenge.js';
import { isBlocked } from './wordfilter.js';
import { cluesOf, solveGrid, solutionsWithin } from './nonogramlogic.js';

export const PREFIX = 'NONO-';
export const SIZES = [5, 10, 15];
export const MAX_NAME = 24;
const MAX_CODE = 200;
const BAD_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]', 'g');

/** one line of plain text for a picture's name; '' when it holds a blocked word */
export function cleanName(v) {
  const s = String(v ?? '').replace(BAD_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  return s.split(/[^A-Za-z]+/).some(w => w && isBlocked(w.toLowerCase())) ? '' : s;
}

const check16 = bytes => hash32(String.fromCharCode(...bytes)) & 0xffff;

/** rows of '#'/'.' and a name -> the code */
export function encodePicture({ rows, name = '' }) {
  const h = rows.length, w = rows[0].length;
  const nm = new TextEncoder().encode(cleanName(name));
  const bits = rows.join('');
  const bytes = [1, w, h, nm.length, ...nm];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) if (bits[i + k] === '#') b |= 0x80 >> k;
    bytes.push(b);
  }
  const c = check16(bytes);
  bytes.push(c >> 8, c & 0xff);
  return PREFIX + toB64url(new Uint8Array(bytes));
}

const fail = error => ({ ok: false, error });
/** a pasted code -> { ok, rows, name, w, h, code } or { ok: false, error } (a sentence to show) */
export function decodePicture(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  const unreadable = fail('That code couldn’t be read. Check it was copied whole: it starts with NONO-.');
  if (!t) return fail('Paste a picture code first.');
  if (t.length > MAX_CODE || !t.toUpperCase().startsWith(PREFIX) || !/^[A-Za-z0-9_-]+$/.test(t.slice(PREFIX.length))) return unreadable;
  let bytes;
  try { bytes = [...fromB64url(t.slice(PREFIX.length))]; } catch (err) { return unreadable; }
  if (bytes.length < 7 || bytes[0] !== 1) return unreadable;
  const [, w, h, nl] = bytes;
  if (!SIZES.includes(w) || w !== h) return unreadable;
  const need = 4 + nl + Math.ceil((w * h) / 8) + 2;
  if (nl > 4 * MAX_NAME || bytes.length !== need) return unreadable;
  const body = bytes.slice(0, need - 2), c = (bytes[need - 2] << 8) | bytes[need - 1];
  if (check16(body) !== c) return unreadable;
  let name = '';
  try { name = cleanName(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes.slice(4, 4 + nl)))); } catch (err) { return unreadable; }
  const bits = bytes.slice(4 + nl, need - 2);
  const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    const i = y * w + x;
    return bits[i >> 3] & (0x80 >> (i & 7)) ? '#' : '.';
  }).join(''));
  return { ok: true, rows, name, w, h, code: encodePicture({ rows, name }) };
}

/** can this picture be shared and played?
    -> { ok, filled, unique: true|false|null, lineLogic, differ: [cell index…], why } */
export function checkPicture(rows, budget = 4000) {
  const filled = rows.join('').split('').filter(c => c === '#').length;
  if (!filled) return { ok: false, filled, unique: null, lineLogic: false, differ: [], why: 'Draw a picture first: nothing is filled in yet.' };
  const { rows: rc, cols: cc } = cluesOf(rows);
  const line = solveGrid(rc, cc);
  if (line.solved) return { ok: true, filled, unique: true, lineLogic: true, differ: [], why: 'One solution, and line logic alone solves it.' };
  const r = solutionsWithin(rc, cc, 2, budget);
  if (r.solutions.length >= 2) {
    const [a, b] = r.solutions, w = rows[0].length, differ = [];
    a.forEach((row, y) => row.forEach((v, x) => { if (v !== b[y][x]) differ.push(y * w + x); }));
    return { ok: false, filled, unique: false, lineLogic: false, differ, why: `It has more than one solution: the same clues also fit another picture (the ${differ.length} marked squares could go either way). Change a few squares near them and check again.` };
  }
  if (!r.complete) return { ok: false, filled, unique: null, lineLogic: false, differ: [], why: 'This one is too tangled to check here. Simplify it a little and check again.' };
  return { ok: true, filled, unique: true, lineLogic: false, differ: [], why: 'One solution, though line logic alone gets stuck: it needs some trial and error.' };
}

export default { PREFIX, SIZES, cleanName, encodePicture, decodePicture, checkPicture };
