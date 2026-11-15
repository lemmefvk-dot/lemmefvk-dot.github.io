/* ============================================================
   arcade/crossworddaily.js — Mini Crosswords' daily crossword. Pure:
   no DOM.

   A new grid every day, the same for everyone on that date: the
   date's seed (dailykit.js) picks the day's frame and fills it from
   the answers of the fifty hand-made puzzles (crosswords.data.js),
   each with the clue that was written for it. So every clue is still
   one a person wrote for that very word; only the grid is new. The
   fill is a seeded backtracking search, so the same date always
   gives the same grid on any device; a fill that happens to repeat
   one of the fifty puzzles' word sets is skipped.

   The frames are the shapes the fifty use, one for each weekday: the
   5×5 lattice with two across words early in the week, the one with
   three across later on, and Sunday the 7-wide grid. (The 4×4 frame
   is only a fallback: the fifty have too few four-letter answers for
   a new one every week.)
   ============================================================ */
import { PUZZLES } from './crosswords.data.js';
import { parseGrid, clueOf, validatePuzzle } from './crosswordlogic.js';
import { rng } from './kit.js';
import { daySeed, dayKey, parseDay } from './dailykit.js';

export const FRAMES = {
  frame4: ['....', '.##.', '.##.', '....'],
  lattice2: ['.#.#.', '.....', '.#.#.', '.....', '.#.#.'],
  lattice3: ['.....', '.#.#.', '.....', '.#.#.', '.....'],
  wide7: ['.#.#.#.', '.......', '.#.#.#.', '.......', '.#.#.#.'],
};
/* Sunday first */
const BY_WEEKDAY = ['wide7', 'lattice2', 'lattice2', 'lattice3', 'lattice2', 'lattice3', 'lattice3'];

/* every answer of the fifty, with its clue */
let BANK = null;
function bank() {
  if (BANK) return BANK;
  const clue = new Map(), byLen = {}, sets = new Set();
  for (const p of PUZZLES) {
    const g = parseGrid(p.grid);
    for (const e of g.entries) if (!clue.has(e.answer)) clue.set(e.answer, clueOf(p, e));
    sets.add(g.entries.map(e => e.answer).sort().join(' '));
  }
  for (const w of clue.keys()) (byLen[w.length] ||= []).push(w);
  BANK = { clue, byLen, sets };
  return BANK;
}

/** fill a frame with answers from the bank, in an order set by `rand`: the grid rows, or null */
export function fillFrame(rows, rand, avoid = new Set(), budget = 200000) {
  const B = bank();
  const w = rows[0].length;
  const g = parseGrid(rows.map(r => r.replace(/\./g, 'A')));
  const cells = rows.join('').split('');
  const ents = g.entries.map(e => {
    const a = (B.byLen[e.len] || []).slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return { cells: e.cells, cand: a, word: null };
  });
  const used = new Set();
  let nodes = 0;
  const fits = (e, word) => e.cells.every((k, i) => cells[k] === '.' || cells[k] === word[i]);
  const go = () => {
    if (++nodes > budget) return false;
    let best = null, bestN = Infinity;
    for (const e of ents) {
      if (e.word) continue;
      let n = 0;
      for (const x of e.cand) if (!used.has(x) && fits(e, x)) n++;
      if (!n) return false;
      if (n < bestN) { best = e; bestN = n; }
    }
    if (!best) return !avoid.has(ents.map(e => e.word).sort().join(' '));
    for (const x of best.cand) {
      if (used.has(x) || !fits(best, x)) continue;
      const before = best.cells.map(k => cells[k]);
      best.cells.forEach((k, i) => { cells[k] = x[i]; });
      best.word = x; used.add(x);
      if (go()) return true;
      best.cells.forEach((k, i) => { cells[k] = before[i]; });
      best.word = null; used.delete(x);
    }
    return false;
  };
  if (!go()) return null;
  return rows.map((_, r) => cells.slice(r * w, (r + 1) * w).join(''));
}

/** the puzzle for `day`: { id, day, frame, grid, clues } in the same form as the fifty, or null */
export function dailyCrossword(day = dayKey()) {
  const B = bank();
  const first = BY_WEEKDAY[parseDay(day).getDay()];
  const rand = rng(daySeed('crossword', day));
  /* the weekday's frame; if it ever can't be filled, the others in turn */
  for (const frame of [first, ...Object.keys(FRAMES).filter(f => f !== first)]) {
    const grid = fillFrame(FRAMES[frame], rand, B.sets);
    if (!grid) continue;
    const g = parseGrid(grid);
    const clues = { A: {}, D: {} };
    for (const e of g.entries) clues[e.dir][e.n] = B.clue.get(e.answer);
    const puz = { id: `daily-${day}`, day, frame, grid, clues };
    if (!validatePuzzle(puz).length) return puz;
  }
  return null;
}

export default { FRAMES, fillFrame, dailyCrossword };
