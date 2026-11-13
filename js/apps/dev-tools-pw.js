/* ============================================================
   dev-tools-pw.js - password and passphrase generation, no DOM.

   Randomness: crypto.getRandomValues only. Math.random is never used.
   randomInt(n) draws 32 bits and throws away any draw in the short
   final bucket (x >= floor(2^32 / n) * n), so every value 0..n-1 is
   exactly equally likely - no modulo bias.

   A random password is drawn uniformly from the chosen alphabet. When
   several classes are chosen and the draw is missing one of them, the
   WHOLE password is thrown away and drawn again, so the result is
   uniform over every password that has at least one character from each
   class. (Forcing a character into a fixed slot, or patching up the
   draw, would make some strings likelier than others.)

   Entropy is the log2 of how many outcomes the settings allow, and is
   only an estimate of strength: it assumes an attacker knows every
   setting (length, classes, word list) and that each password came
   from this generator. It says nothing about reuse or where a
   password is typed.

   Nothing in this file stores, logs or sends what it makes.
   ============================================================ */

export const CLASSES = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
};
/* characters that are easy to misread: I l 1 | O 0 o (and a backtick, which looks like a quote) */
export const LOOKALIKES = 'Il1|O0o`';
export const MIN_LEN = 4;
export const MAX_LEN = 128;
export const MIN_WORDS = 3;
export const MAX_WORDS = 12;

const MAX_DRAWS = 20000;

function cryptoSource() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('This browser has no secure random number source (crypto.getRandomValues), so no password was made.');
  return c;
}

/* uniform integer in [0, n), n up to 2^32 */
export function randomInt(n, rng = cryptoSource()) {
  if (!Number.isInteger(n) || n < 1 || n > 4294967296) throw new RangeError('randomInt needs a whole number from 1 to 2^32');
  if (n === 1) return 0;
  const limit = Math.floor(4294967296 / n) * n;      /* draws at or above this would favour small values */
  const buf = new Uint32Array(1);
  for (;;) {
    rng.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/* the characters of each chosen class, look-alikes removed when asked */
export function alphabetOf(opts) {
  const strip = opts.noLookalikes ? new Set(LOOKALIKES) : new Set();
  const out = [];
  for (const k of Object.keys(CLASSES)) {
    if (!opts[k]) continue;
    const chars = [...CLASSES[k]].filter(c => !strip.has(c));
    if (chars.length) out.push(chars);
  }
  return out;
}

export function generatePassword(opts, rng = cryptoSource()) {
  const len = Math.floor(+opts.length);
  if (!(len >= MIN_LEN && len <= MAX_LEN)) throw new RangeError(`Length must be from ${MIN_LEN} to ${MAX_LEN}.`);
  const classes = alphabetOf(opts);
  if (!classes.length) throw new Error('Choose at least one kind of character.');
  if (len < classes.length) throw new Error(`A ${len}-character password can’t hold ${classes.length} kinds of character.`);
  const all = classes.flat();
  const seen = new Array(classes.length);
  const which = new Map();
  classes.forEach((cl, i) => cl.forEach(c => which.set(c, i)));
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    seen.fill(false);
    let left = classes.length;
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = all[randomInt(all.length, rng)];
      s += c;
      const k = which.get(c);
      if (!seen[k]) { seen[k] = true; left--; }
    }
    if (left === 0) return s;
  }
  throw new Error('Could not make a password with those settings.');
}

/* log2 of a non-negative BigInt, exact to double precision */
export function log2Big(x) {
  if (x <= 0n) return -Infinity;
  const bits = x.toString(2).length;
  if (bits <= 60) return Math.log2(Number(x));
  return (bits - 53) + Math.log2(Number(x >> BigInt(bits - 53)));
}

/* bits of entropy of generatePassword(opts): log2 of the number of
   strings that have at least one character of every chosen class
   (inclusion-exclusion over the classes). */
export function passwordEntropy(opts) {
  const classes = alphabetOf(opts);
  const len = Math.floor(+opts.length);
  if (!classes.length || !(len >= classes.length)) return 0;
  const sizes = classes.map(c => c.length);
  const total = sizes.reduce((a, b) => a + b, 0);
  let count = 0n;
  for (let mask = 0; mask < (1 << sizes.length); mask++) {
    let rest = total, bits = 0;
    sizes.forEach((sz, i) => { if (mask & (1 << i)) { rest -= sz; bits++; } });
    const term = BigInt(rest) ** BigInt(len);
    count += bits % 2 ? -term : term;
  }
  return log2Big(count);
}

export const SEPARATORS = { hyphen: '-', space: ' ', dot: '.', underscore: '_', none: '' };

export function generatePassphrase(opts, words, rng = cryptoSource()) {
  const n = Math.floor(+opts.words);
  if (!(n >= MIN_WORDS && n <= MAX_WORDS)) throw new RangeError(`Use from ${MIN_WORDS} to ${MAX_WORDS} words.`);
  if (!Array.isArray(words) || words.length < 2) throw new Error('The word list is missing.');
  const sep = Object.prototype.hasOwnProperty.call(SEPARATORS, opts.separator) ? SEPARATORS[opts.separator] : '-';
  const picked = [];
  for (let i = 0; i < n; i++) {
    let w = words[randomInt(words.length, rng)];
    if (opts.capitalise) w = w[0].toUpperCase() + w.slice(1);
    picked.push(w);
  }
  let s = picked.join(sep);
  if (opts.number) s += sep + randomInt(10, rng);
  return s;
}

/* bits of entropy of generatePassphrase: each word is one of N equally likely
   words; the optional number adds one more of ten. The separator and
   capitals are fixed by the settings, so they add nothing. */
export function passphraseEntropy(opts, wordCount) {
  const n = Math.floor(+opts.words);
  if (!(n >= 1) || !(wordCount > 1)) return 0;
  return n * Math.log2(wordCount) + (opts.number ? Math.log2(10) : 0);
}

/* a plain description of a number of bits, from commonly quoted ranges.
   It is a label for the number, not a prediction. */
export function strengthWord(bits) {
  if (bits < 40) return 'weak';
  if (bits < 60) return 'fair';
  if (bits < 80) return 'good';
  return 'strong';
}
