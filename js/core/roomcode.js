/* ============================================================
   roomcode.js — room codes and names for StaticOS's "with a
   friend" features: Static Arcade rooms (js/arcade/room.js) and
   the private rooms of js/core/pair.js (Static Drop, Watch
   Together, Draw Together).

   A code is six symbols from a 32-letter alphabet with no 0/O/1/I
   to misread, made with crypto.getRandomValues (256 % 32 = 0, so
   no symbol is likelier than another). People type codes however
   they like — lower case, with dashes, inside a pasted invite line
   or link — so normalizeCode() digs the code out.

   Names and chat come from other people's devices, so they are
   cleaned before anything shows them: control characters, the
   invisible bidi/zero-width characters that can flip or hide text,
   and angle brackets go; whitespace collapses; length is capped.
   Everything that shows them still uses textContent.

     ALPHABET · CODE_LEN · isCode(s) · normalizeCode(input) · randomCode()
     safeName(s) -> ≤ 24 chars        cleanText(s, max) -> one line of text
     hueOf(n) -> 0–359 (200 when n isn't a number)
   ============================================================ */
import { tidy } from './identity.js';

export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
/* bidi overrides/isolates/marks, zero-width characters, word joiners, the BOM */
export const INVISIBLE = /[؜​-‏‪-‮⁠-⁩﻿]/g;

export const isCode = s => CODE_RE.test(String(s || ''));

/** Pull a room code out of whatever was typed or pasted ("abc-234", an invite line, a link…). */
export function normalizeCode(input) {
  const s = String(input ?? '').toUpperCase().slice(0, 600);
  const m = /(?:ROOM|DROP|WATCH|DRAW|QUIZ|LIST|NOTE)=([A-Z0-9]{6})\b/.exec(s);
  if (m) return m[1];
  const flat = s.replace(/[\s\-_.·]/g, '');
  if (flat.length <= CODE_LEN) return flat;
  const tokens = s.split(/[^A-Z0-9]+/).filter(t => CODE_RE.test(t));
  return tokens.length ? tokens[tokens.length - 1] : flat.slice(0, 12);
}

const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
export const randomCode = () => [...rand(CODE_LEN)].map(b => ALPHABET[b & 31]).join('');

export const safeName = s => tidy(String(s ?? '').replace(INVISIBLE, ''), 24);

/** One line of someone else's text, safe to show: no control or invisible characters, capped. */
export const cleanText = (s, max = 300) => String(s ?? '')
  .replace(INVISIBLE, '')
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

export const hueOf = c => (Number.isFinite(c) ? Math.abs(Math.round(c)) % 360 : 200);

/** "K7Q M2X" for reading out loud; aria labels spell it out one symbol at a time. */
export const spaced = code => String(code || '').split('').join(' ');

export default { ALPHABET, CODE_LEN, isCode, normalizeCode, randomCode, safeName, cleanText, hueOf, spaced, INVISIBLE };
