/* ============================================================
   arcade/lettergridlogic.js — Letter Grid's rules. Pure: no DOM.

   A grid is rolled from 25 dice of six letters each (4×4 uses 16 of
   them, 5×5 all 25); the dice are our own, drawn once from English
   letter frequencies and fixed here. A word is a chain of cells that
   touch (sides or corners), each cell used at most once, 3 letters or
   more, and in the word list. Longer words score more.

   A grid is only kept if a full search of it (every path, pruned by
   word prefixes) finds enough words: makeGrid() rolls again until it
   does, and the tests run it over many seeds to prove the floor.
   ============================================================ */
import { rng } from './kit.js';

/* ---- the dice ---- */
const FACES = { E: 18, T: 12, A: 12, O: 11, I: 10, N: 10, S: 10, R: 10, H: 5, L: 7, D: 6, C: 5, U: 5, M: 4, P: 4, F: 3, G: 3, Y: 3, W: 3, B: 3, V: 2, K: 2, J: 1, X: 1 };
/* the counts total 150 faces: 25 dice of six */
export const DICE = (() => {
  const bag = [];
  for (const [ch, n] of Object.entries(FACES)) for (let i = 0; i < n; i++) bag.push(ch);
  const r = rng(0x1e77e12);                     /* fixed, so the dice never change between versions */
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  const dice = [];
  for (let d = 0; d < 25; d++) dice.push(bag.slice(d * 6, d * 6 + 6).join(''));
  return dice;
})();

export const MIN_LEN = 3;
export const MAX_LEN = 16;
/* what each size must offer: words in the list (any tier), familiar words (tiers 1–2),
   and words of five letters or more. Set from the spread of real grids (see the test). */
export const SIZES = {
  4: { n: 4, dice: 16, min: { words: 40, familiar: 24, long: 6 } },
  5: { n: 5, dice: 25, min: { words: 110, familiar: 60, long: 25 } },
};
export const ROUND_SECONDS = 180;

/** points for a word: 3 letters 1, 4 → 2, 5 → 4, 6 → 6, 7 → 9, then 12 and 3 more for each extra letter */
export function wordPoints(len) {
  if (len < MIN_LEN) return 0;
  if (len >= 8) return 12 + (len - 8) * 3;
  return [1, 2, 4, 6, 9][len - MIN_LEN];
}

const nbrCache = {};
export function neighbors(n) {
  if (nbrCache[n]) return nbrCache[n];
  const out = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n, list = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n) list.push(rr * n + cc);
    }
    out.push(list);
  }
  return (nbrCache[n] = out);
}
export const touching = (n, a, b) => neighbors(n)[a].includes(b);

/** is this chain of cell indexes legal: in range, each step touching, nothing used twice */
export function validPath(n, path) {
  if (!Array.isArray(path) || path.length === 0) return false;
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!Number.isInteger(p) || p < 0 || p >= n * n || seen.has(p)) return false;
    seen.add(p);
    if (i && !touching(n, path[i - 1], p)) return false;
  }
  return true;
}
export const spell = (cells, path) => path.map(i => cells[i]).join('').toLowerCase();

/** a path that spells `word` in this grid (the first one found), or null */
export function pathFor(cells, n, word) {
  const w = String(word).toUpperCase();
  if (!w) return null;
  const nb = neighbors(n), used = new Array(cells.length).fill(false), path = [];
  const go = (i, k) => {
    if (cells[i] !== w[k] || used[i]) return false;
    used[i] = true; path.push(i);
    if (k === w.length - 1) return true;
    for (const j of nb[i]) if (go(j, k + 1)) return true;
    used[i] = false; path.pop();
    return false;
  };
  for (let i = 0; i < cells.length; i++) if (go(i, 0)) return path.slice();
  return null;
}

/** every word of the list that can be traced in the grid: Map word -> one path */
export function solveGrid(lex, cells, n) {
  const found = new Map(), nb = neighbors(n), used = new Array(cells.length).fill(false);
  const path = [];
  const walk = (i, str) => {
    used[i] = true; path.push(i);
    const s = str + cells[i].toLowerCase();
    if (s.length >= MIN_LEN && lex.has(s) && !found.has(s)) found.set(s, path.slice());
    if (s.length < MAX_LEN && lex.hasPrefix(s)) for (const j of nb[i]) if (!used[j]) walk(j, s);
    used[i] = false; path.pop();
  };
  for (let i = 0; i < cells.length; i++) walk(i, '');
  return found;
}

/** how good a grid is: { words, familiar, long, points } */
export function grade(lex, found) {
  let familiar = 0, long = 0, points = 0;
  for (const w of found.keys()) {
    if (lex.tier(w) <= 2) familiar++;
    if (w.length >= 5) long++;
    points += wordPoints(w.length);
  }
  return { words: found.size, familiar, long, points };
}
export const meetsMinimum = (g, size) => {
  const m = SIZES[size].min;
  return g.words >= m.words && g.familiar >= m.familiar && g.long >= m.long;
};

/** the grid for (size, seed): rolled from the dice, rerolled until it offers enough words.
    Same seed, same grid. { size, n, seed, cells (uppercase letters), found (Map), grade, rolls } */
export function makeGrid(lex, size, seed, maxRolls = 200) {
  const S = SIZES[size];
  if (!S) throw new Error(`no ${size}×${size} grid`);
  const r = rng(seed);
  let best = null;
  for (let rolls = 1; rolls <= maxRolls; rolls++) {
    const order = Array.from({ length: S.dice }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const cells = order.map(d => DICE[d][Math.floor(r() * 6)]);
    const found = solveGrid(lex, cells, S.n);
    const g = grade(lex, found);
    const out = { size, n: S.n, seed, cells, found, grade: g, rolls, ok: meetsMinimum(g, size) };
    if (out.ok) return out;
    if (!best || g.points > best.grade.points) best = out;
  }
  return best;
}
