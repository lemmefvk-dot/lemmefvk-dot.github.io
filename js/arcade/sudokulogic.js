/* ============================================================
   arcade/sudokulogic.js — Sudoku's rules, solver, grader and generator.
   Pure functions, no DOM: the game and the tests both import this file.

   A grid is an array of 81 numbers, 0 = empty, row by row.

   Uniqueness. `countSolutions(grid, 2)` is an exhaustive backtracking
   search (bitmasks, always branching on the emptiest cell). The
   generator removes a clue only when that search still finds exactly
   one solution, so every puzzle it returns has exactly one.

   Difficulty is graded by technique, not by guesswork. `grade()` solves
   the puzzle the way a person would, always using the simplest
   technique that makes progress, and reports the hardest one it
   needed:
     1  Easy    singles only: a cell with one candidate left (naked
                single) or a digit with one place in a row, column or
                box (hidden single)
     2  Medium  needs a naked pair, a hidden pair, or a locked
                candidate (pointing / box-line reduction)
     3  Hard    needs a naked or hidden triple, an X-Wing, an XY-Wing or
                a Swordfish
   (0 = already solved, 4 = the solver here got stuck: it would need
   a technique beyond these, or a guess; the generator never deals
   those.) The number of givens is reported alongside, but it is not
   what the grade is based on.
   ============================================================ */

export const NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
export const LEVELS = ['easy', 'medium', 'hard'];
export const TIER = { easy: 1, medium: 2, hard: 3 };

const ROWS = [], COLS = [], BOXES = [];
for (let k = 0; k < 9; k++) {
  ROWS.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
  COLS.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
  const br = Math.floor(k / 3) * 3, bc = (k % 3) * 3;
  BOXES.push(Array.from({ length: 9 }, (_, j) => (br + Math.floor(j / 3)) * 9 + bc + (j % 3)));
}
export const UNITS = [...ROWS, ...COLS, ...BOXES];
export const row = i => Math.floor(i / 9);
export const col = i => i % 9;
export const box = i => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3);
export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const s = new Set([...ROWS[row(i)], ...COLS[col(i)], ...BOXES[box(i)]]);
  s.delete(i);
  return [...s];
});
const BIT = d => 1 << (d - 1);
const pop = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const lowDigit = m => 32 - Math.clz32(m & -m);

/* every filled cell agrees with its peers */
export function consistent(grid) {
  for (let i = 0; i < 81; i++) {
    if (grid[i] && PEERS[i].some(p => grid[p] === grid[i])) return false;
  }
  return true;
}

/* How many solutions does the grid have, counting up to `limit`? */
export function countSolutions(grid, limit = 2) {
  const g = grid.slice();
  const rm = new Array(9).fill(0), cm = new Array(9).fill(0), bm = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const b = BIT(g[i]);
    if ((rm[row(i)] & b) || (cm[col(i)] & b) || (bm[box(i)] & b)) return 0;
    rm[row(i)] |= b; cm[col(i)] |= b; bm[box(i)] |= b;
  }
  let n = 0;
  const go = () => {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = 511 & ~(rm[row(i)] | cm[col(i)] | bm[box(i)]);
      const c = pop(m);
      if (c < bestCount) { best = i; bestMask = m; bestCount = c; if (c <= 1) break; }
    }
    if (best < 0) { n++; return n >= limit; }
    if (!bestCount) return false;
    const r = row(best), c = col(best), b = box(best);
    for (let m = bestMask; m; m &= m - 1) {
      const bit = m & -m;
      g[best] = lowDigit(bit);
      rm[r] |= bit; cm[c] |= bit; bm[b] |= bit;
      const stop = go();
      rm[r] &= ~bit; cm[c] &= ~bit; bm[b] &= ~bit;
      g[best] = 0;
      if (stop) return true;
    }
    return false;
  };
  go();
  return n;
}

/* One solution (or null). With `rand`, digits are tried in random order. */
export function solve(grid, rand) {
  const g = grid.slice();
  const rm = new Array(9).fill(0), cm = new Array(9).fill(0), bm = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const b = BIT(g[i]);
    if ((rm[row(i)] & b) || (cm[col(i)] & b) || (bm[box(i)] & b)) return null;
    rm[row(i)] |= b; cm[col(i)] |= b; bm[box(i)] |= b;
  }
  const go = () => {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = 511 & ~(rm[row(i)] | cm[col(i)] | bm[box(i)]);
      const c = pop(m);
      if (c < bestCount) { best = i; bestMask = m; bestCount = c; if (c <= 1) break; }
    }
    if (best < 0) return true;
    if (!bestCount) return false;
    const digits = [];
    for (let d = 1; d <= 9; d++) if (bestMask & BIT(d)) digits.push(d);
    if (rand) for (let k = digits.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [digits[k], digits[j]] = [digits[j], digits[k]]; }
    const r = row(best), c = col(best), b = box(best);
    for (const d of digits) {
      const bit = BIT(d);
      g[best] = d; rm[r] |= bit; cm[c] |= bit; bm[b] |= bit;
      if (go()) return true;
      rm[r] &= ~bit; cm[c] &= ~bit; bm[b] &= ~bit; g[best] = 0;
    }
    return false;
  };
  return go() ? g : null;
}

/* ---------------- the person-style solver, for grading and hints ---------------- */

function candidates(grid) {
  const c = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    let m = 511;
    for (const p of PEERS[i]) if (grid[p]) m &= ~BIT(grid[p]);
    c[i] = m;
  }
  return c;
}
export const candidatesOf = candidates;

/* a single placement a person can make from the filled cells alone:
   { i, d, why: 'naked' | 'row' | 'col' | 'box' } or null. `prefer` is tried first. */
export function findSingle(grid, prefer = -1) {
  const cand = candidates(grid);
  const naked = i => (cand[i] && pop(cand[i]) === 1 ? { i, d: lowDigit(cand[i]), why: 'naked' } : null);
  if (prefer >= 0 && !grid[prefer]) {
    const n = naked(prefer);
    if (n) return n;
    for (const [kind, set] of [['row', ROWS[row(prefer)]], ['col', COLS[col(prefer)]], ['box', BOXES[box(prefer)]]]) {
      for (let d = 1; d <= 9; d++) {
        if (!(cand[prefer] & BIT(d))) continue;
        if (set.filter(i => cand[i] & BIT(d)).length === 1) return { i: prefer, d, why: kind };
      }
    }
  }
  for (let i = 0; i < 81; i++) { const n = naked(i); if (n) return n; }
  const kinds = ['row', 'col', 'box'];
  for (let u = 0; u < 27; u++) {
    for (let d = 1; d <= 9; d++) {
      const spots = UNITS[u].filter(i => cand[i] & BIT(d));
      if (spots.length === 1 && !grid[spots[0]]) return { i: spots[0], d, why: kinds[Math.floor(u / 9)] };
    }
  }
  return null;
}

/* Solve like a person. Returns { solved, tier, steps, used } where tier is the
   hardest technique tier needed (1–3), or 4 when this solver got stuck. */
export function grade(puzzle) {
  const v = puzzle.slice();
  const cand = candidates(v);
  const used = {};
  let tier = 0, steps = 0;
  const place = (i, d) => {
    v[i] = d; cand[i] = 0;
    for (const p of PEERS[i]) cand[p] &= ~BIT(d);
  };
  const note = (name, t) => { used[name] = (used[name] || 0) + 1; tier = Math.max(tier, t); steps++; };
  const cells = u => UNITS[u];

  const single = () => {
    for (let i = 0; i < 81; i++) if (!v[i] && pop(cand[i]) === 1) { place(i, lowDigit(cand[i])); note('naked single', 1); return true; }
    for (let u = 0; u < 27; u++) for (let d = 1; d <= 9; d++) {
      const spots = cells(u).filter(i => !v[i] && (cand[i] & BIT(d)));
      if (spots.length === 1 && !cells(u).some(i => v[i] === d)) { place(spots[0], d); note('hidden single', 1); return true; }
    }
    return false;
  };
  /* remove `mask` digits from the listed cells; true if anything changed */
  const strip = (list, mask) => {
    let ch = false;
    for (const i of list) if (!v[i] && (cand[i] & mask)) { cand[i] &= ~mask; ch = true; }
    return ch;
  };
  const nakedSubset = n => {
    for (let u = 0; u < 27; u++) {
      const free = cells(u).filter(i => !v[i] && pop(cand[i]) >= 2 && pop(cand[i]) <= n);
      const pick = (start, chosen, union) => {
        if (chosen.length === n) {
          if (pop(union) !== n) return false;
          return strip(cells(u).filter(i => !chosen.includes(i)), union);
        }
        for (let k = start; k < free.length; k++) {
          const nu = union | cand[free[k]];
          if (pop(nu) > n) continue;
          if (pick(k + 1, [...chosen, free[k]], nu)) return true;
        }
        return false;
      };
      if (pick(0, [], 0)) return true;
    }
    return false;
  };
  const hiddenSubset = n => {
    for (let u = 0; u < 27; u++) {
      const ds = [], spots = {};
      for (let d = 1; d <= 9; d++) {
        const s = cells(u).filter(i => !v[i] && (cand[i] & BIT(d)));
        if (s.length >= 2 && s.length <= n) { spots[d] = s; ds.push(d); }
      }
      const pick = (start, chosen, union) => {
        if (chosen.length === n) {
          if (union.size !== n) return false;
          const keep = chosen.reduce((m, d) => m | BIT(d), 0);
          let ch = false;
          for (const i of union) if (cand[i] & ~keep) { cand[i] &= keep; ch = true; }
          return ch;
        }
        for (let k = start; k < ds.length; k++) {
          const nu = new Set([...union, ...spots[ds[k]]]);
          if (nu.size > n) continue;
          if (pick(k + 1, [...chosen, ds[k]], nu)) return true;
        }
        return false;
      };
      if (pick(0, [], new Set())) return true;
    }
    return false;
  };
  const locked = () => {
    for (let b = 0; b < 9; b++) for (let d = 1; d <= 9; d++) {
      const s = BOXES[b].filter(i => !v[i] && (cand[i] & BIT(d)));
      if (s.length < 2) continue;
      if (s.every(i => row(i) === row(s[0])) && strip(ROWS[row(s[0])].filter(i => box(i) !== b), BIT(d))) return true;
      if (s.every(i => col(i) === col(s[0])) && strip(COLS[col(s[0])].filter(i => box(i) !== b), BIT(d))) return true;
    }
    for (let k = 0; k < 18; k++) for (let d = 1; d <= 9; d++) {
      const s = cells(k).filter(i => !v[i] && (cand[i] & BIT(d)));
      if (s.length < 2 || !s.every(i => box(i) === box(s[0]))) continue;
      if (strip(BOXES[box(s[0])].filter(i => !cells(k).includes(i)), BIT(d))) return true;
    }
    return false;
  };
  /* X-Wing (n = 2) and Swordfish (n = 3), in rows and in columns */
  const fish = n => {
    for (const [lines, cross] of [[ROWS, COLS], [COLS, ROWS]]) for (let d = 1; d <= 9; d++) {
      const at = i => (lines === ROWS ? col(i) : row(i));
      const where = lines.map(l => l.filter(i => !v[i] && (cand[i] & BIT(d))));
      const ok = [];
      for (let k = 0; k < 9; k++) if (where[k].length >= 2 && where[k].length <= n) ok.push(k);
      const pick = (start, chosen, union) => {
        if (chosen.length === n) {
          if (union.size !== n) return false;
          const others = [];
          for (const c of union) for (const i of cross[c]) if (!chosen.some(k => where[k].includes(i))) others.push(i);
          return strip(others, BIT(d));
        }
        for (let k = start; k < ok.length; k++) {
          const nu = new Set([...union, ...where[ok[k]].map(at)]);
          if (nu.size > n) continue;
          if (pick(k + 1, [...chosen, ok[k]], nu)) return true;
        }
        return false;
      };
      if (pick(0, [], new Set())) return true;
    }
    return false;
  };
  /* XY-Wing: a two-candidate pivot and two pincers it sees */
  const xyWing = () => {
    for (let p = 0; p < 81; p++) {
      if (v[p] || pop(cand[p]) !== 2) continue;
      const peers = PEERS[p].filter(i => !v[i] && pop(cand[i]) === 2);
      for (const a of peers) for (const b of peers) {
        if (a >= b) continue;
        const shared = cand[a] & cand[b];
        if (pop(shared) !== 1 || (cand[a] | cand[b]) !== (cand[p] | shared) || (cand[a] & cand[b] & cand[p])) continue;
        if (pop(cand[a] & cand[p]) !== 1 || pop(cand[b] & cand[p]) !== 1) continue;
        const hit = PEERS[a].filter(i => PEERS[b].includes(i) && i !== p);
        if (strip(hit, shared)) return true;
      }
    }
    return false;
  };

  while (v.some(x => !x)) {
    if (single()) continue;
    if (nakedSubset(2)) { note('naked pair', 2); continue; }
    if (hiddenSubset(2)) { note('hidden pair', 2); continue; }
    if (locked()) { note('locked candidates', 2); continue; }
    if (nakedSubset(3)) { note('naked triple', 3); continue; }
    if (hiddenSubset(3)) { note('hidden triple', 3); continue; }
    if (fish(2)) { note('X-Wing', 3); continue; }
    if (xyWing()) { note('XY-Wing', 3); continue; }
    if (fish(3)) { note('Swordfish', 3); continue; }
    return { solved: false, tier: 4, steps, used };
  }
  return { solved: true, tier: tier, steps, used };
}

/* ---------------- generator ---------------- */

const shuffle = (a, rand) => {
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
};
/* the fewest clues worth digging toward for each level */
const FLOOR = { easy: 36, medium: 30, hard: 24 };

/* One puzzle dealt from `rand`: { puzzle, solution, givens, tier } where
   tier is what grade() found. Clues come out in 180° pairs (so the
   pattern looks tidy) and only while the solution stays unique. */
export function dig(rand, level) {
  const solution = solve(new Array(81).fill(0), rand);
  const puzzle = solution.slice();
  const order = shuffle(Array.from({ length: 41 }, (_, k) => k), rand);
  let givens = 81;
  for (const i of order) {
    if (givens - (i === 40 ? 1 : 2) < FLOOR[level]) continue;
    const j = 80 - i, a = puzzle[i], b = puzzle[j];
    puzzle[i] = 0; puzzle[j] = 0;
    if (countSolutions(puzzle, 2) === 1) givens -= i === j ? 1 : 2;
    else { puzzle[i] = a; puzzle[j] = b; }
  }
  return { puzzle, solution, givens };
}

/* A puzzle of exactly the requested grade. Candidates are dug one after
   another from the seeded generator until one grades as asked, so the
   same seed always deals the same puzzle. Returns null only if `tries`
   candidates all missed (it has never happened in the tests; the game
   then deals the closest grade and says so). */
export function generate(seed, level, rand, tries = 600) {
  const want = TIER[level];
  let closest = null;
  for (let t = 0; t < tries; t++) {
    const c = dig(rand, level);
    const g = grade(c.puzzle);
    const out = { ...c, tier: g.tier, used: g.used, level, seed };
    if (g.solved && g.tier === want) return out;
    if (g.solved && (!closest || Math.abs(g.tier - want) < Math.abs(closest.tier - want))) closest = out;
  }
  return closest;
}
