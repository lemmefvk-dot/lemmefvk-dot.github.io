/* ============================================================
   arcade/sudokulogic.js — Sudoku's rules, solver, grader and generator.
   Pure functions, no DOM: the game and the tests both import this file.

   A grid is an array of 81 numbers, 0 = empty, row by row.

   Variants. 'classic' has the usual 27 units (rows, columns, boxes).
   'diagonal' adds the two long diagonals: each must hold 1–9 too.
   Every function below takes the variant as its last argument
   (default 'classic').

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
     4  Expert  the techniques above run out before the end: a person
                needs a longer chain of reasoning or has to try a
                number and follow it through. Still exactly one
                solution, proven by the search.
   (0 = already solved.) The number of givens is reported alongside,
   but it is not what the grade is based on.

   Hints. `hintFor()` runs the same person-style solver on the correct
   entries and says why the next number goes where it does: the single
   that places it, and the eliminations (pair, X-Wing, …) that made the
   single appear, each as a sentence.
   ============================================================ */

export const NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };
export const LEVELS = ['easy', 'medium', 'hard', 'expert'];
export const TIER = { easy: 1, medium: 2, hard: 3, expert: 4 };
export const VARIANTS = ['classic', 'diagonal'];

const ROWS = [], COLS = [], BOXES = [];
for (let k = 0; k < 9; k++) {
  ROWS.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
  COLS.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
  const br = Math.floor(k / 3) * 3, bc = (k % 3) * 3;
  BOXES.push(Array.from({ length: 9 }, (_, j) => (br + Math.floor(j / 3)) * 9 + bc + (j % 3)));
}
/* top left to bottom right, top right to bottom left */
const DIAGS = [Array.from({ length: 9 }, (_, k) => k * 10), Array.from({ length: 9 }, (_, k) => k * 8 + 8)];
export const row = i => Math.floor(i / 9);
export const col = i => i % 9;
export const box = i => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3);

function makeGeometry(variant) {
  const units = variant === 'diagonal' ? [...ROWS, ...COLS, ...BOXES, ...DIAGS] : [...ROWS, ...COLS, ...BOXES];
  const kinds = units.map((_, u) => (u < 9 ? 'row' : u < 18 ? 'col' : u < 27 ? 'box' : 'diag'));
  const unitsOf = Array.from({ length: 81 }, (_, i) => units.map((u, k) => (u.includes(i) ? k : -1)).filter(k => k >= 0));
  const peers = Array.from({ length: 81 }, (_, i) => {
    const s = new Set();
    for (const k of unitsOf[i]) for (const j of units[k]) s.add(j);
    s.delete(i);
    return [...s];
  });
  /* pairs of units that share two or more cells (a box and a line through it, a box and a diagonal):
     where locked candidates can be found */
  const meets = [];
  for (let a = 18; a < 27; a++) for (let b = 0; b < units.length; b++) {
    if (b >= 18 && b < 27) continue;
    if (units[a].filter(i => units[b].includes(i)).length >= 2) meets.push([a, b]);
  }
  return { variant, units, kinds, unitsOf, peers, meets };
}
const GEO = { classic: makeGeometry('classic'), diagonal: makeGeometry('diagonal') };
export const geometry = (variant = 'classic') => GEO[variant] || GEO.classic;
export const UNITS = GEO.classic.units;
export const PEERS = GEO.classic.peers;
/** the cells of a long diagonal a cell is on: 0 (from top left), 1 (from top right), both, or none */
export const diagsOf = i => DIAGS.map((d, k) => (d.includes(i) ? k : -1)).filter(k => k >= 0);

const BIT = d => 1 << (d - 1);
const pop = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const lowDigit = m => 32 - Math.clz32(m & -m);
const digitsOf = m => { const out = []; for (let d = 1; d <= 9; d++) if (m & BIT(d)) out.push(d); return out; };

/* every filled cell agrees with its peers */
export function consistent(grid, variant = 'classic') {
  const P = geometry(variant).peers;
  for (let i = 0; i < 81; i++) {
    if (grid[i] && P[i].some(p => grid[p] === grid[i])) return false;
  }
  return true;
}
/** the filled cells that repeat a digit in one of their units (what the board marks as a clash) */
export function clashes(grid, variant = 'classic') {
  const P = geometry(variant).peers, out = new Set();
  for (let i = 0; i < 81; i++) if (grid[i] && P[i].some(p => grid[p] === grid[i])) out.add(i);
  return out;
}

/* the backtracking search both counting and solving use: unit bitmasks, branching on the emptiest cell */
function search(grid, variant, rand, onSolution) {
  const G = geometry(variant), uo = G.unitsOf;
  const g = grid.slice();
  const um = new Array(G.units.length).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const b = BIT(g[i]);
    for (const k of uo[i]) { if (um[k] & b) return null; um[k] |= b; }
  }
  const go = () => {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      let used = 0;
      for (const k of uo[i]) used |= um[k];
      const m = 511 & ~used;
      const c = pop(m);
      if (c < bestCount) { best = i; bestMask = m; bestCount = c; if (c <= 1) break; }
    }
    if (best < 0) return onSolution(g);
    if (!bestCount) return false;
    const digits = digitsOf(bestMask);
    if (rand) for (let k = digits.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [digits[k], digits[j]] = [digits[j], digits[k]]; }
    const us = uo[best];
    for (const d of digits) {
      const bit = BIT(d);
      g[best] = d;
      for (const k of us) um[k] |= bit;
      const stop = go();
      for (const k of us) um[k] &= ~bit;
      g[best] = 0;
      if (stop) return true;
    }
    return false;
  };
  return { stopped: go() };
}

/* How many solutions does the grid have, counting up to `limit`? */
export function countSolutions(grid, limit = 2, variant = 'classic') {
  let n = 0;
  const r = search(grid, variant, null, () => { n++; return n >= limit; });
  return r ? n : 0;
}

/* One solution (or null). With `rand`, digits are tried in random order. */
export function solve(grid, rand, variant = 'classic') {
  let out = null;
  search(grid, variant, rand || null, g => { out = g.slice(); return true; });
  return out;
}

/* ---------------- the person-style solver, for grading and hints ---------------- */

function candidates(grid, variant = 'classic') {
  const P = geometry(variant).peers;
  const c = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    let m = 511;
    for (const p of P[i]) if (grid[p]) m &= ~BIT(grid[p]);
    c[i] = m;
  }
  return c;
}
export const candidatesOf = candidates;

/* words for the hints */
const BOX_NAMES = ['top-left', 'top', 'top-right', 'left', 'middle', 'right', 'bottom-left', 'bottom', 'bottom-right'];
export function unitName(u) {
  if (u < 9) return `row ${u + 1}`;
  if (u < 18) return `column ${u - 8}`;
  if (u < 27) return `the ${BOX_NAMES[u - 18]} box`;
  return u === 27 ? 'the diagonal from the top left' : 'the diagonal from the top right';
}
const listAnd = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const listOr = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}`);
export const cellName = i => `row ${row(i) + 1}, column ${col(i) + 1}`;
function cellsText(list) {
  const s = [...list].sort((a, b) => a - b);
  if (s.every(i => row(i) === row(s[0]))) return `row ${row(s[0]) + 1}, column${s.length > 1 ? 's' : ''} ${listAnd(s.map(i => col(i) + 1))}`;
  if (s.every(i => col(i) === col(s[0]))) return `column ${col(s[0]) + 1}, row${s.length > 1 ? 's' : ''} ${listAnd(s.map(i => row(i) + 1))}`;
  return listAnd(s.map(i => `(${row(i) + 1}, ${col(i) + 1})`)).replace(/^/, 'squares ');
}

/* The person-style solver on one board. Each technique, when it makes
   progress, applies it and returns a step:
     { name, tier, text, cells, place?: { i, d, why, unit } }
   (`cells`: the squares the reasoning is about; `place`: a number put in). */
function personSolver(start, variant = 'classic') {
  const G = geometry(variant), U = G.units, P = G.peers;
  const v = start.slice();
  const cand = candidates(v, variant);
  const place = (i, d) => {
    v[i] = d; cand[i] = 0;
    for (const p of P[i]) cand[p] &= ~BIT(d);
  };
  /* remove `mask` digits from the listed cells; the cells that changed */
  const strip = (list, mask) => {
    const hit = [];
    for (const i of list) if (!v[i] && (cand[i] & mask)) { cand[i] &= ~mask; hit.push(i); }
    return hit;
  };
  const ruled = (mask, hit, where) => `so ${listOr(digitsOf(mask))} can't go in ${hit.length === 1 ? cellName(hit[0]) : `the other squares of ${where}`}`;

  /* a single, without placing it: { i, d, why, unit } or null. `prefer`: a cell to look at first */
  const findSingle = (prefer = -1) => {
    const naked = i => (!v[i] && cand[i] && pop(cand[i]) === 1 ? { i, d: lowDigit(cand[i]), why: 'naked', unit: -1 } : null);
    const hiddenIn = (u, d) => {
      const spots = U[u].filter(i => !v[i] && (cand[i] & BIT(d)));
      return spots.length === 1 && !U[u].some(i => v[i] === d) ? spots[0] : -1;
    };
    if (prefer >= 0) {
      if (v[prefer]) return null;
      const n = naked(prefer);
      if (n) return n;
      for (const u of G.unitsOf[prefer]) for (const d of digitsOf(cand[prefer])) {
        if (hiddenIn(u, d) === prefer) return { i: prefer, d, why: G.kinds[u], unit: u };
      }
      return null;
    }
    for (let i = 0; i < 81; i++) { const n = naked(i); if (n) return n; }
    for (let u = 0; u < U.length; u++) for (let d = 1; d <= 9; d++) {
      const i = hiddenIn(u, d);
      if (i >= 0) return { i, d, why: G.kinds[u], unit: u };
    }
    return null;
  };

  const single = () => {
    const s = findSingle();
    if (!s) return null;
    place(s.i, s.d);
    return { name: s.why === 'naked' ? 'naked single' : 'hidden single', tier: 1, place: s, cells: s.unit >= 0 ? U[s.unit] : [s.i], text: whyText(s) };
  };
  const nakedSubset = n => {
    for (let u = 0; u < U.length; u++) {
      const free = U[u].filter(i => !v[i] && pop(cand[i]) >= 2 && pop(cand[i]) <= n);
      let found = null;
      const pick = (start, chosen, union) => {
        if (chosen.length === n) {
          if (pop(union) !== n) return false;
          const hit = strip(U[u].filter(i => !chosen.includes(i)), union);
          if (!hit.length) return false;
          found = { chosen, union, hit };
          return true;
        }
        for (let k = start; k < free.length; k++) {
          const nu = union | cand[free[k]];
          if (pop(nu) > n) continue;
          if (pick(k + 1, [...chosen, free[k]], nu)) return true;
        }
        return false;
      };
      if (pick(0, [], 0)) {
        const { chosen, union, hit } = found;
        const word = n === 2 ? 'pair' : 'triple';
        return {
          name: `naked ${word}`, tier: n === 2 ? 2 : 3, cells: chosen,
          text: `${cellsText(chosen)} can only hold ${listAnd(digitsOf(union))} between them (a naked ${word}), ${ruled(union, hit, unitName(u))}`,
        };
      }
    }
    return null;
  };
  const hiddenSubset = n => {
    for (let u = 0; u < U.length; u++) {
      const ds = [], spots = {};
      for (let d = 1; d <= 9; d++) {
        const s = U[u].filter(i => !v[i] && (cand[i] & BIT(d)));
        if (s.length >= 2 && s.length <= n) { spots[d] = s; ds.push(d); }
      }
      let found = null;
      const pick = (start, chosen, union) => {
        if (chosen.length === n) {
          if (union.size !== n) return false;
          const keep = chosen.reduce((m, d) => m | BIT(d), 0);
          const hit = [];
          for (const i of union) if (cand[i] & ~keep) { cand[i] &= keep; hit.push(i); }
          if (!hit.length) return false;
          found = { chosen, cells: [...union] };
          return true;
        }
        for (let k = start; k < ds.length; k++) {
          const nu = new Set([...union, ...spots[ds[k]]]);
          if (nu.size > n) continue;
          if (pick(k + 1, [...chosen, ds[k]], nu)) return true;
        }
        return false;
      };
      if (pick(0, [], new Set())) {
        const word = n === 2 ? 'pair' : 'triple';
        return {
          name: `hidden ${word}`, tier: n === 2 ? 2 : 3, cells: found.cells,
          text: `in ${unitName(u)}, ${listAnd(found.chosen)} can only go in ${cellsText(found.cells).replace(`${unitName(u)}, `, '')} (a hidden ${word}), so those squares can't hold anything else`,
        };
      }
    }
    return null;
  };
  /* locked candidates: a digit's places in one unit all lie inside another unit */
  const locked = () => {
    for (const [a, b] of G.meets) for (const [inU, outU] of [[a, b], [b, a]]) for (let d = 1; d <= 9; d++) {
      const s = U[inU].filter(i => !v[i] && (cand[i] & BIT(d)));
      if (s.length < 2 || !s.every(i => U[outU].includes(i))) continue;
      const hit = strip(U[outU].filter(i => !U[inU].includes(i)), BIT(d));
      if (hit.length) {
        return {
          name: 'locked candidates', tier: 2, cells: s,
          text: `in ${unitName(inU)}, ${d} can only go where it meets ${unitName(outU)} (${cellsText(s)}), ${ruled(BIT(d), hit, unitName(outU))}`,
        };
      }
    }
    return null;
  };
  /* X-Wing (n = 2) and Swordfish (n = 3), in rows and in columns */
  const fish = n => {
    for (const [lines, cross, lw, cw] of [[ROWS, COLS, 'rows', 'columns'], [COLS, ROWS, 'columns', 'rows']]) for (let d = 1; d <= 9; d++) {
      const at = i => (lines === ROWS ? col(i) : row(i));
      const where = lines.map(l => l.filter(i => !v[i] && (cand[i] & BIT(d))));
      const ok = [];
      for (let k = 0; k < 9; k++) if (where[k].length >= 2 && where[k].length <= n) ok.push(k);
      let found = null;
      const pick = (start, chosen, union) => {
        if (chosen.length === n) {
          if (union.size !== n) return false;
          const others = [];
          for (const c of union) for (const i of cross[c]) if (!chosen.some(k => where[k].includes(i))) others.push(i);
          const hit = strip(others, BIT(d));
          if (!hit.length) return false;
          found = { chosen, union: [...union].sort((x, y) => x - y), hit };
          return true;
        }
        for (let k = start; k < ok.length; k++) {
          const nu = new Set([...union, ...where[ok[k]].map(at)]);
          if (nu.size > n) continue;
          if (pick(k + 1, [...chosen, ok[k]], nu)) return true;
        }
        return false;
      };
      if (pick(0, [], new Set())) {
        const name = n === 2 ? 'X-Wing' : 'Swordfish';
        return {
          name, tier: 3, cells: found.chosen.flatMap(k => where[k]),
          text: `in ${lw} ${listAnd(found.chosen.map(k => k + 1))}, ${d} can only go in ${cw} ${listAnd(found.union.map(k => k + 1))} (${n === 2 ? 'an X-Wing' : 'a Swordfish'}), so ${d} can't go anywhere else in those ${cw}`,
        };
      }
    }
    return null;
  };
  /* XY-Wing: a two-candidate pivot and two pincers it sees */
  const xyWing = () => {
    for (let p = 0; p < 81; p++) {
      if (v[p] || pop(cand[p]) !== 2) continue;
      const peers = P[p].filter(i => !v[i] && pop(cand[i]) === 2);
      for (const a of peers) for (const b of peers) {
        if (a >= b) continue;
        const shared = cand[a] & cand[b];
        if (pop(shared) !== 1 || (cand[a] | cand[b]) !== (cand[p] | shared) || (cand[a] & cand[b] & cand[p])) continue;
        if (pop(cand[a] & cand[p]) !== 1 || pop(cand[b] & cand[p]) !== 1) continue;
        const hit = strip(P[a].filter(i => P[b].includes(i) && i !== p), shared);
        if (hit.length) {
          const z = lowDigit(shared);
          return {
            name: 'XY-Wing', tier: 3, cells: [p, a, b],
            text: `${cellName(p)} is ${digitsOf(cand[p]).join(' or ')}; ${cellName(a)} is ${digitsOf(cand[a]).join(' or ')} and ${cellName(b)} is ${digitsOf(cand[b]).join(' or ')}. Whichever the first one is, one of the other two is ${z} (an XY-Wing), so ${z} can't go in ${hit.length === 1 ? cellName(hit[0]) : 'a square that sees them both'}`,
          };
        }
      }
    }
    return null;
  };

  const eliminations = [() => nakedSubset(2), () => hiddenSubset(2), locked, () => nakedSubset(3), () => hiddenSubset(3), () => fish(2), xyWing, () => fish(3)];
  return {
    v, cand,
    done: () => v.every(Boolean),
    findSingle,
    place,
    /* the simplest step that makes progress, applied (a single first) */
    step() {
      const s = single();
      if (s) return s;
      return this.eliminate();
    },
    /* the simplest elimination that makes progress, applied */
    eliminate() {
      for (const t of eliminations) { const s = t(); if (s) return s; }
      return null;
    },
  };
}

const WHY = {
  naked: () => 'it is the only number that fits there',
  row: s => `it is the only place for ${s.d} in its row`,
  col: s => `it is the only place for ${s.d} in its column`,
  box: s => `it is the only place for ${s.d} in its box`,
  diag: s => `it is the only place for ${s.d} on its diagonal`,
};
const whyText = s => WHY[s.why](s);

/* Solve like a person. Returns { solved, tier, steps, used } where tier is the
   hardest technique tier needed (1–3), or 4 when these techniques run out. */
export function grade(puzzle, variant = 'classic') {
  const S = personSolver(puzzle, variant);
  const used = {};
  let tier = 0, steps = 0;
  while (!S.done()) {
    const s = S.step();
    if (!s) return { solved: false, tier: 4, steps, used };
    used[s.name] = (used[s.name] || 0) + 1;
    tier = Math.max(tier, s.tier);
    steps++;
  }
  return { solved: true, tier, steps, used };
}

/* a single placement a person can make from the filled cells alone:
   { i, d, why: 'naked' | 'row' | 'col' | 'box' | 'diag' } or null. `prefer` is tried first. */
export function findSingle(grid, prefer = -1, variant = 'classic') {
  const S = personSolver(grid, variant);
  return (prefer >= 0 && S.findSingle(prefer)) || S.findSingle();
}

/* The next number a person can place on `grid` (the correct entries only),
   and why: { i, d, why, text, unit, steps: [{ name, text }], cells, placed }.
   steps are the eliminations that had to come first; placed counts other
   singles filled on the way (only when a `target` cell was asked for).
   With `target`, the explanation is for that cell; null when these
   techniques cannot reach it (or the next number) from this board. */
export function hintFor(grid, variant = 'classic', target = -1) {
  const S = personSolver(grid, variant);
  const steps = [];
  let placed = 0;
  for (let guard = 0; guard < 400; guard++) {
    const s = target >= 0 ? S.findSingle(target) : S.findSingle();
    if (s) {
      const G = geometry(variant);
      const cells = s.unit >= 0 ? G.units[s.unit].slice() : [s.i, ...G.peers[s.i].filter(p => S.v[p])];
      return { ...s, text: whyText(s), steps, placed, cells, pattern: steps.length ? steps[steps.length - 1].cells : [] };
    }
    if (target >= 0) {
      /* the target isn't a single yet: fill what is, then eliminate */
      const other = S.findSingle();
      if (other) { S.place(other.i, other.d); placed++; continue; }
    }
    const e = S.eliminate();
    if (!e) return null;
    steps.push({ name: e.name, text: e.text, cells: e.cells });
    if (S.done()) return null;
  }
  return null;
}

/* ---------------- generator ---------------- */

const shuffle = (a, rand) => {
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
};
/* the fewest clues worth digging toward for each level */
const FLOOR = { easy: 36, medium: 30, hard: 24, expert: 20 };

/* One puzzle dealt from `rand`: { puzzle, solution, givens } (the solution
   is unique). Clues come out in 180° pairs (so the pattern looks tidy) and
   only while the solution stays unique. */
export function dig(rand, level, variant = 'classic') {
  const solution = solve(new Array(81).fill(0), rand, variant);
  const puzzle = solution.slice();
  const order = shuffle(Array.from({ length: 41 }, (_, k) => k), rand);
  let givens = 81;
  for (const i of order) {
    if (givens - (i === 40 ? 1 : 2) < FLOOR[level]) continue;
    const j = 80 - i, a = puzzle[i], b = puzzle[j];
    puzzle[i] = 0; puzzle[j] = 0;
    if (countSolutions(puzzle, 2, variant) === 1) givens -= i === j ? 1 : 2;
    else { puzzle[i] = a; puzzle[j] = b; }
  }
  return { puzzle, solution, givens };
}

/* A puzzle of exactly the requested grade. Candidates are dug one after
   another from the seeded generator until one grades as asked, so the
   same seed always deals the same puzzle. `opts`: { tries, variant }
   (a number is read as tries). Returns null only if `tries` candidates
   all missed and none came close; otherwise the closest grade, and the
   game says so. */
export function generate(seed, level, rand, opts = {}) {
  const { tries = 600, variant = 'classic' } = typeof opts === 'number' ? { tries: opts } : (opts || {});
  const want = TIER[level];
  let closest = null;
  for (let t = 0; t < tries; t++) {
    const c = dig(rand, level, variant);
    const g = grade(c.puzzle, variant);
    /* an Expert puzzle is one these techniques can't finish; every other level must be finished by them */
    const tier = g.solved ? g.tier : 4;
    const out = { ...c, tier, used: g.used, level, seed, variant };
    if (tier === want) return out;
    if (!g.solved && want < 4) continue;
    if (!closest || Math.abs(tier - want) < Math.abs(closest.tier - want)) closest = out;
  }
  return closest;
}
