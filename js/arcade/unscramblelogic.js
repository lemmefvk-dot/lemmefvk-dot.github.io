/* ============================================================
   arcade/unscramblelogic.js — Unscramble's rules. Pure: no DOM.

   A round deals a word from the everyday tier of the word list and
   shows its letters in another order. The answer is ANY word in the
   list that uses exactly those letters (so "least", "slate" and
   "stale" all count for the same tiles), not only the one dealt.
   A scramble is never the dealt word itself and never another real
   word (a tile row that already spells something would be a trap).
   ============================================================ */

export const ROUND_SECONDS = 120;
export const HINT_COST = 5;

/** the letters of a word, sorted: two words are anagrams when their keys match */
export const keyOf = w => String(w).toLowerCase().split('').sort().join('');

/** how long the words are at a point of the round: 4 letters at first, one more every 3 solved, up to 8 */
export const lengthFor = solved => Math.min(8, 4 + Math.floor(solved / 3));

/** points for a solved word: 10 a letter, +5 per word already in the streak (at most +25), less 5 per hint */
export function solvePoints(len, streak, hints) {
  return Math.max(1, len * 10 + Math.min(streak, 5) * 5 - hints * HINT_COST);
}

/* a dealt word: a base form with some variety in its letters (no -s plurals, -ed, -ing) */
const plain = w => !/(s|ed|ing)$/.test(w) || /ss$/.test(w);
const varied = w => new Set(w).size >= Math.min(4, w.length - 1);

/** the words a round may deal for a length, from tier 1 (everyday words) */
export function dealable(lex, len) {
  return lex.byTier[1].filter(w => w.length === len && plain(w) && varied(w));
}

/** a scramble of `word` that is neither the word nor any word of the list; null when no such order exists */
export function scramble(lex, word, random = Math.random) {
  const letters = word.split('');
  for (let tries = 0; tries < 60; tries++) {
    for (let i = letters.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [letters[i], letters[j]] = [letters[j], letters[i]]; }
    const s = letters.join('');
    if (s !== word && !lex.has(s)) return s;
  }
  return null;
}

/** every word of the list that can be made from exactly these tiles (computed from the list, not remembered) */
export function anagramsOf(lex, tiles) {
  const key = keyOf(tiles), n = tiles.length;
  return lex.words.filter(w => w.length === n && keyOf(w) === key);
}

/** is `answer` a correct answer for these tiles: same letters, a real word */
export const accepts = (lex, tiles, answer) => {
  const a = String(answer).toLowerCase();
  return a.length === tiles.length && keyOf(a) === keyOf(tiles) && lex.has(a);
};

/** the next puzzle: { word, tiles, len } — a fresh dealt word (not one in `used`), scrambled */
export function nextPuzzle(lex, solved, used, random = Math.random, cache = {}) {
  const len = lengthFor(solved);
  const pool = cache[len] || (cache[len] = dealable(lex, len));
  for (let tries = 0; tries < 80; tries++) {
    const word = pool[Math.floor(random() * pool.length)];
    if (used.has(word)) continue;
    const tiles = scramble(lex, word, random);
    if (tiles) return { word, tiles, len };
  }
  return null;
}
