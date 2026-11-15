/* ============================================================
   arcade/pond-logic.js — the rules, the levels and the solver of
   Pond Hopper.

   A frog sits on a lily pad of an n×n pond (some squares are open
   water). It hops like a chess knight — two squares one way and one
   across — only onto a pad it has not used, and every pad it leaves
   sinks. Visit every pad once: a knight's tour of an odd-shaped board.

   Every level is made from a tour: a random knight path of the wanted
   length is found first (so a way through always exists), its squares
   become the pads, and its first square is where the frog starts.
   The play-tests then solve every built-in level, and the next
   weeks of daily ponds, with the independent search below (depth
   first, fewest onward hops first, with a work budget).

   Pure functions, no DOM: the play-tests import this file directly.
   ============================================================ */
import { rng } from './kit.js';
import { hash32 } from './challenge.js';

export const HOPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

/** the pads a knight on cell `i` can reach on an n×n board (cell index = y * n + x) */
export function hopsFrom(i, n) {
  const x = i % n, y = (i - x) / n, out = [];
  for (const [dx, dy] of HOPS) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < n && ny >= 0 && ny < n) out.push(ny * n + nx);
  }
  return out;
}

/* the packs: a name, the pond's size, and how many pads its first and its tenth level have */
export const PACKS = [
  { id: 'shallows', label: 'Shallows', n: 5, from: 8, to: 14 },
  { id: 'reeds', label: 'Reeds', n: 6, from: 12, to: 24 },
  { id: 'lake', label: 'Lake', n: 7, from: 18, to: 34 },
  { id: 'marsh', label: 'Marsh', n: 8, from: 26, to: 46 },
];
export const PER_PACK = 10;
export const padsFor = (pack, level) => Math.round(pack.from + (pack.to - pack.from) * (level - 1) / (PER_PACK - 1));

/** a knight path of exactly `len` squares, found by random depth-first search; null if the budget runs out */
function randomTour(n, len, r, budget = 60000) {
  let work = 0;
  const used = new Uint8Array(n * n), path = [];
  const dfs = i => {
    if (++work > budget) return false;
    used[i] = 1; path.push(i);
    if (path.length === len) return true;
    const next = hopsFrom(i, n).filter(j => !used[j]);
    for (let a = next.length - 1; a > 0; a--) { const b = Math.floor(r() * (a + 1)); [next[a], next[b]] = [next[b], next[a]]; }
    for (const j of next) if (dfs(j)) return true;
    used[i] = 0; path.pop();
    return false;
  };
  const s = Math.floor(r() * n * n);
  return dfs(s) ? path : null;
}

/* how many knight hops lie between a set of pads: more of them, more choices (and more traps) */
const hopCount = (n, pads) => { const set = new Set(pads); let k = 0; for (const p of pads) for (const j of hopsFrom(p, n)) if (set.has(j)) k++; return k / 2; };

/** a pond: { n, pads: sorted cell indexes, start } with a tour through all pads.
    Of a few tours found, the one whose pads have the most hops between them is kept: a pond that is
    more than a single path to follow. */
export function makeLevel(seed, n, len) {
  const r = rng(seed >>> 0);
  len = Math.max(3, Math.min(n * n, len));
  let best = null, bestHops = -1;
  for (let tries = 0; tries < 400 && (tries < 40 || !best); tries++) {
    const t = randomTour(n, len, r);
    if (!t) continue;
    const hops = hopCount(n, t);
    if (hops > bestHops) { bestHops = hops; best = t; }
    if (tries >= 14 && best) break;
  }
  if (!best) best = randomTour(n, 3, r, 1e9);
  return { n, pads: best.slice().sort((a, b) => a - b), start: best[0] };
}

/** level `level` (1-based) of a pack: the same pond for everyone */
export function packLevel(packId, level) {
  const pack = PACKS.find(p => p.id === packId) || PACKS[0];
  const lv = Math.max(1, Math.min(PER_PACK, level | 0 || 1));
  return { ...makeLevel(hash32(`staticos/pondhopper/${pack.id}/${lv}`), pack.n, padsFor(pack, lv)), pack: pack.id, level: lv };
}
/** the pond for a date: 7×7, from 22 to 30 pads by weekday (0 = Sunday) */
export const dailyLevel = (seed, weekday = 0) => makeLevel(seed, 7, [30, 22, 24, 26, 28, 30, 28][((weekday % 7) + 7) % 7]);

/**
 * Find a tour of every pad from `from` (default: the level's start) through the
 * pads not in `visited` (cell indexes already used, `from` included).
 * -> a list of cells to hop to, in order ([] when nothing is left), or null when
 *    no tour exists or the work budget ran out (`solve.lastBlown` says which).
 */
export function solve(level, visited = null, from = level.start, budget = 3_000_000) {
  const { n } = level;
  const isPad = new Uint8Array(n * n);
  for (const p of level.pads) isPad[p] = 1;
  const used = new Uint8Array(n * n);
  const seen = new Set(visited || []);
  seen.add(from);
  for (const c of seen) { if (!isPad[c]) return null; used[c] = 1; }
  let left = level.pads.length - seen.size;
  const nb = i => hopsFrom(i, n).filter(j => isPad[j] && !used[j]);
  let work = 0;
  solve.lastBlown = false;
  const path = [];
  const dfs = i => {
    if (left === 0) return true;
    if (++work > budget) { solve.lastBlown = true; return false; }
    const opts = nb(i).map(j => [j, nb(j).length]);
    /* a pad with no way on is only fine as the very last one */
    opts.sort((a, b) => a[1] - b[1]);
    let dead = 0;
    for (const [, d] of opts) if (d === 0) dead++;
    if (dead > 1 || (dead === 1 && left > 1)) return false;
    for (const [j] of opts) {
      used[j] = 1; left--; path.push(j);
      if (dfs(j)) return true;
      used[j] = 0; left++; path.pop();
      if (solve.lastBlown) return false;
    }
    return false;
  };
  return dfs(from) ? path.slice() : null;
}

/** is `cells` (starting at the level's start) a legal complete tour of the level? */
export function isTour(level, cells) {
  const { n, pads, start } = level;
  if (cells.length !== pads.length || cells[0] !== start) return false;
  const set = new Set(pads);
  if (new Set(cells).size !== cells.length) return false;
  for (let i = 0; i < cells.length; i++) {
    if (!set.has(cells[i])) return false;
    if (i && !hopsFrom(cells[i - 1], n).includes(cells[i])) return false;
  }
  return true;
}
