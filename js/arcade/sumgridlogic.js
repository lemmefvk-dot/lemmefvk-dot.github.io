/* ============================================================
   arcade/sumgridlogic.js — Sum Grid's rules, generator and solver.
   Pure: no DOM.

   The puzzle is Killer-Sudoku style on a small board: fill the grid
   with the digits 1..N so that no digit repeats in a row, a column or
   a box, and the cells inside each outlined cage hold different
   digits that add up to the number printed in the cage's corner.

   Sizes: 4×4 (boxes 2×2) and 6×6 (boxes 2 rows × 3 columns).

   Every puzzle is dealt by generate(), which keeps one only after
   countSolutions() — an exhaustive search — has found exactly one
   solution. When a first draft has two, a cage is split where the two
   solutions differ and the search runs again. The levels differ in the
   board and in the cages:
     easy    4×4, small cages, a few single-cell cages (a given digit)
     medium  6×6, cages of 1–4 cells, up to 3 given digits
     hard    6×6, cages of 2–5 cells, no given digits at all
   ============================================================ */
import { rng } from './kit.js';

export const LEVELS = ['easy', 'medium', 'hard'];
export const LEVEL = {
  easy:   { n: 4, boxR: 2, boxC: 2, weights: [0, 2, 5, 3], singles: 3, minCage: 1 },
  medium: { n: 6, boxR: 2, boxC: 3, weights: [0, 2, 5, 3, 1], singles: 3, minCage: 1 },
  hard:   { n: 6, boxR: 2, boxC: 3, weights: [0, 0, 3, 4, 3, 1], singles: 0, minCage: 2 },
};

const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const rowOf = (n, i) => Math.floor(i / n);
export const colOf = (n, i) => i % n;
export const boxOf = (p, i) => Math.floor(rowOf(p.n, i) / p.boxR) * (p.n / p.boxC) + Math.floor(colOf(p.n, i) / p.boxC);
const adj = (n, i) => {
  const r = rowOf(n, i), c = colOf(n, i), out = [];
  if (r > 0) out.push(i - n); if (c > 0) out.push(i - 1); if (c < n - 1) out.push(i + 1); if (r < n - 1) out.push(i + n);
  return out;
};

/* a full board that obeys rows, columns and boxes */
function randomSolution(p, r) {
  const { n } = p, g = new Array(n * n).fill(0);
  const ok = (i, d) => {
    for (let j = 0; j < n * n; j++) {
      if (!g[j] || g[j] !== d) continue;
      if (rowOf(n, j) === rowOf(n, i) || colOf(n, j) === colOf(n, i) || boxOf(p, j) === boxOf(p, i)) return false;
    }
    return true;
  };
  const fill = i => {
    if (i === n * n) return true;
    for (const d of shuffle(Array.from({ length: n }, (_, k) => k + 1), r)) {
      if (!ok(i, d)) continue;
      g[i] = d;
      if (fill(i + 1)) return true;
      g[i] = 0;
    }
    return false;
  };
  fill(0);
  return g;
}

/* region growing: connected cages with no repeated digit inside */
function drawCages(p, sol, r, level) {
  const { n } = p, L = LEVEL[level], owner = new Array(n * n).fill(-1), cages = [];
  const pick = () => {
    const total = L.weights.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let s = 1; s < L.weights.length; s++) { x -= L.weights[s]; if (x < 0) return s; }
    return 1;
  };
  for (const start of shuffle(Array.from({ length: n * n }, (_, i) => i), r)) {
    if (owner[start] >= 0) continue;
    const want = pick(), cells = [start], digits = new Set([sol[start]]);
    owner[start] = cages.length;
    while (cells.length < want) {
      const opts = [];
      for (const c of cells) for (const j of adj(n, c)) if (owner[j] < 0 && !digits.has(sol[j]) && !opts.includes(j)) opts.push(j);
      if (!opts.length) break;
      const j = opts[Math.floor(r() * opts.length)];
      owner[j] = cages.length; cells.push(j); digits.add(sol[j]);
    }
    cages.push({ cells: cells.sort((a, b) => a - b) });
  }
  /* a cage that came out smaller than the level allows joins a neighbour (or stays, if none fits) */
  if (L.minCage > 1) {
    let again = true;
    while (again) {
      again = false;
      for (let k = 0; k < cages.length; k++) {
        const c = cages[k];
        if (!c || c.cells.length >= L.minCage) continue;
        const digits = new Set(c.cells.map(i => sol[i]));
        let join = -1;
        for (const i of c.cells) for (const j of adj(n, i)) {
          const o = owner[j];
          if (o === k || join >= 0 || !cages[o]) continue;
          if (cages[o].cells.length >= 5 || cages[o].cells.some(x => digits.has(sol[x]))) continue;
          if (new Set([...cages[o].cells.map(x => sol[x]), ...digits]).size !== cages[o].cells.length + c.cells.length) continue;
          join = o;
        }
        if (join < 0) continue;
        cages[join].cells = [...cages[join].cells, ...c.cells].sort((a, b) => a - b);
        c.cells.forEach(i => { owner[i] = join; });
        cages[k] = null; again = true;
      }
    }
  }
  return cages.filter(Boolean).map(c => ({ cells: c.cells, sum: c.cells.reduce((a, i) => a + sol[i], 0) }));
}

/* a puzzle's lookup tables */
function link(p) {
  p.cageOf = new Array(p.n * p.n).fill(-1);
  p.cages.forEach((c, k) => c.cells.forEach(i => { p.cageOf[i] = k; }));
  return p;
}

/** every solution of the puzzle, up to `limit` of them (default 2: enough to tell "exactly one") */
export function solutions(p, limit = 2) {
  const { n } = p, N = n * n, g = new Array(N).fill(0), out = [];
  const rowM = new Array(n).fill(0), colM = new Array(n).fill(0), boxM = new Array(N / (p.boxR * p.boxC)).fill(0);
  const cageM = p.cages.map(() => 0), cageS = p.cages.map(() => 0), cageLeft = p.cages.map(c => c.cells.length);
  const bx = Array.from({ length: N }, (_, i) => boxOf(p, i));
  /* can `left` more distinct digits, none in `used`, add up to `need`? */
  const feasible = (used, left, need) => {
    if (left === 0) return need === 0;
    const free = [];
    for (let d = 1; d <= n; d++) if (!(used >> d & 1)) free.push(d);
    if (free.length < left) return false;
    let lo = 0, hi = 0;
    for (let k = 0; k < left; k++) { lo += free[k]; hi += free[free.length - 1 - k]; }
    return need >= lo && need <= hi;
  };
  const go = i => {
    if (out.length >= limit) return;
    if (i === N) { out.push(g.slice()); return; }
    const r = rowOf(n, i), c = colOf(n, i), b = bx[i], k = p.cageOf[i];
    for (let d = 1; d <= n; d++) {
      const bit = 1 << d;
      if ((rowM[r] | colM[c] | boxM[b] | cageM[k]) & bit) continue;
      const left = cageLeft[k] - 1, need = p.cages[k].sum - cageS[k] - d;
      if (need < 0 || !feasible(cageM[k] | bit, left, need)) continue;
      g[i] = d; rowM[r] |= bit; colM[c] |= bit; boxM[b] |= bit; cageM[k] |= bit; cageS[k] += d; cageLeft[k]--;
      go(i + 1);
      g[i] = 0; rowM[r] &= ~bit; colM[c] &= ~bit; boxM[b] &= ~bit; cageM[k] &= ~bit; cageS[k] -= d; cageLeft[k]++;
      if (out.length >= limit) return;
    }
  };
  go(0);
  return out;
}
export const countSolutions = (p, limit = 2) => solutions(p, limit).length;

/* two connected pieces from one cage, the first of which holds `a` and the second `b`, each at least `min` cells */
function splitCage(p, cage, sol, a, b, min, singlesLeft) {
  const cells = cage.cells, m = cells.length, tries = [];
  for (let mask = 1; mask < (1 << m) - 1; mask++) {
    const A = cells.filter((_, i) => mask >> i & 1), B = cells.filter((_, i) => !(mask >> i & 1));
    const sep = (A.includes(a) && B.includes(b)) || (A.includes(b) && B.includes(a));
    const small = Math.min(A.length, B.length);
    if (small < min && !(small === 1 && singlesLeft > 0)) continue;
    const connected = S => { const seen = new Set([S[0]]), q = [S[0]]; while (q.length) { const x = q.pop(); for (const y of adj(p.n, x)) if (S.includes(y) && !seen.has(y)) { seen.add(y); q.push(y); } } return seen.size === S.length; };
    if (!connected(A) || !connected(B)) continue;
    tries.push({ A, B, sep, small });
  }
  if (!tries.length) return null;
  /* prefer a cut that separates the two differing cells, then balanced halves */
  tries.sort((x, y) => (y.sep - x.sep) || (y.small - x.small));
  return tries[0];
}

/** deal a puzzle: { level, seed, n, boxR, boxC, cages:[{cells,sum}], cageOf, sol, solutions: 1 }
    The same (level, seed) always gives the same puzzle. */
export function generate(level, seed) {
  const L = LEVEL[level];
  if (!L) throw new Error(`no level ${level}`);
  const r = rng(seed);
  for (let attempt = 0; attempt < 400; attempt++) {
    const p = { level, seed, n: L.n, boxR: L.boxR, boxC: L.boxC };
    const sol = randomSolution(p, r);
    p.cages = drawCages(p, sol, r, level);
    p.sol = sol;
    let ok = false;
    for (let round = 0; round < 40; round++) {
      link(p);
      const singles = p.cages.filter(c => c.cells.length === 1).length;
      if (singles > L.singles) break;
      const found = solutions(p, 2);
      if (found.length === 1) { ok = true; break; }
      /* two solutions: split the cage where they disagree */
      const diff = [];
      for (let i = 0; i < p.n * p.n; i++) if (found[0][i] !== found[1][i]) diff.push(i);
      const cageIdx = [...new Set(diff.map(i => p.cageOf[i]))].filter(k => p.cages[k].cells.length > 1);
      if (!cageIdx.length) break;
      const k = cageIdx[Math.floor(r() * cageIdx.length)], cage = p.cages[k];
      const inCage = diff.filter(i => p.cageOf[i] === k);
      const a = inCage[0], b = inCage.length > 1 ? inCage[inCage.length - 1] : cage.cells.find(i => i !== a);
      const cut = splitCage(p, cage, sol, a, b, L.minCage, L.singles - singles);
      if (!cut) break;
      p.cages.splice(k, 1,
        { cells: cut.A.slice().sort((x, y) => x - y), sum: cut.A.reduce((s, i) => s + sol[i], 0) },
        { cells: cut.B.slice().sort((x, y) => x - y), sum: cut.B.reduce((s, i) => s + sol[i], 0) });
    }
    if (ok) { p.solutions = 1; return p; }
  }
  throw new Error('sum grid: could not make a unique puzzle');
}

/* ---- checking a player's board ---- */

/** the cells that break a rule right now: a digit twice in a row, column, box or cage, or a full cage with the wrong sum,
    or a cage already over its sum. Only filled cells are judged. */
export function conflicts(p, vals) {
  const bad = new Set(), n = p.n;
  const groups = [];
  for (let k = 0; k < n; k++) {
    groups.push(Array.from({ length: n }, (_, i) => k * n + i), Array.from({ length: n }, (_, i) => i * n + k));
  }
  const boxes = {};
  for (let i = 0; i < n * n; i++) (boxes[boxOf(p, i)] ||= []).push(i);
  groups.push(...Object.values(boxes), ...p.cages.map(c => c.cells));
  for (const gr of groups) {
    const seen = {};
    for (const i of gr) if (vals[i]) (seen[vals[i]] ||= []).push(i);
    for (const list of Object.values(seen)) if (list.length > 1) list.forEach(i => bad.add(i));
  }
  for (const c of p.cages) {
    const sum = c.cells.reduce((a, i) => a + (vals[i] || 0), 0), full = c.cells.every(i => vals[i]);
    if (sum > c.sum || (full && sum !== c.sum)) c.cells.forEach(i => { if (vals[i]) bad.add(i); });
  }
  return bad;
}
/** every cell filled and no rule broken (with exactly one solution, that is the solution) */
export const isSolved = (p, vals) => vals.every(v => v >= 1 && v <= p.n) && conflicts(p, vals).size === 0;

/** the digits a cage could still hold, as a short text for the cage's tip: combinations of `size` distinct digits adding to `sum` */
export function combos(n, size, sum) {
  const out = [];
  const go = (start, left, need, acc) => {
    if (!left) { if (!need) out.push(acc.slice()); return; }
    for (let d = start; d <= n; d++) { if (d > need) break; acc.push(d); go(d + 1, left - 1, need - d, acc); acc.pop(); }
  };
  go(1, size, sum, []);
  return out;
}
