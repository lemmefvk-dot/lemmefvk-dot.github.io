/* ============================================================
   arcade/flood-logic.js — the rules and the solver of Color Flood.

   A square board of coloured cells. The flood is the same-colour
   region that holds the top-left cell; a move gives the whole
   flood one new colour, and every region of that colour touching
   it joins in. Fill the board with one colour.

   PAR is the fewest moves that do it, found by an exact search
   (iterative deepening on the board's region graph, with two lower
   bounds that never overestimate: the colours still outside the
   flood, and the farthest region's distance). solve() says whether
   it finished inside its work budget (`exact`); a board it could not
   finish is given the best line it found and is not called par.
   Pure functions, no DOM: the play-tests import this file directly.
   ============================================================ */
import { rng } from './kit.js';

/** a board of n×n cells from a seed: colours 0..k-1, never already one colour */
export function makeBoard(seed, n, k) {
  const r = rng((seed ^ (n * 7919) ^ (k * 104729)) >>> 0);
  const cells = Array.from({ length: n * n }, () => Math.floor(r() * k));
  /* a little clumping so regions are not all single cells: copy a neighbour now and then */
  for (let i = 1; i < cells.length; i++) {
    if (r() < 0.22) cells[i] = i % n && r() < 0.5 ? cells[i - 1] : i >= n ? cells[i - n] : cells[i];
  }
  if (new Set(cells).size < 2) cells[cells.length - 1] = (cells[0] + 1) % k;
  return cells;
}

const sides = (i, n) => {
  const x = i % n, y = (i - x) / n;
  return [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1];
};

/** the flood's cell indexes (the region around cell 0) */
export function floodOf(cells, n) {
  const c0 = cells[0], seen = new Uint8Array(cells.length), out = [0];
  seen[0] = 1;
  for (let q = 0; q < out.length; q++) {
    for (const j of sides(out[q], n)) if (j >= 0 && !seen[j] && cells[j] === c0) { seen[j] = 1; out.push(j); }
  }
  return out;
}
/** the board after a move: a new array (the same one when the colour is already the flood's) */
export function play(cells, n, colour) {
  if (cells[0] === colour) return cells;
  const next = cells.slice();
  for (const i of floodOf(cells, n)) next[i] = colour;
  return next;
}
export const isDone = cells => cells.every(c => c === cells[0]);

/* the region graph: nodes are same-colour regions, edges are shared sides */
function regions(cells, n) {
  const id = new Int32Array(cells.length).fill(-1), colour = [];
  for (let s = 0; s < cells.length; s++) {
    if (id[s] >= 0) continue;
    const k = colour.length;
    colour.push(cells[s]);
    id[s] = k;
    const q = [s];
    for (let a = 0; a < q.length; a++) {
      for (const j of sides(q[a], n)) if (j >= 0 && id[j] < 0 && cells[j] === cells[s]) { id[j] = k; q.push(j); }
    }
  }
  const adj = Array.from({ length: colour.length }, () => new Set());
  for (let i = 0; i < cells.length; i++) {
    if (i % n < n - 1 && id[i] !== id[i + 1]) { adj[id[i]].add(id[i + 1]); adj[id[i + 1]].add(id[i]); }
    if (i + n < cells.length && id[i] !== id[i + n]) { adj[id[i]].add(id[i + n]); adj[id[i + n]].add(id[i]); }
  }
  return { colour, adj: adj.map(s => [...s]), start: id[0] };
}

/**
 * The fewest moves that fill the board, and one best line of colours.
 * -> { par, line, exact }  (`exact` false: the work budget ran out and
 *    par is the length of a good line, not proven fewest)
 */
export function solve(cells, n, budget = 400000) {
  if (isDone(cells)) return { par: 0, line: [], exact: true };
  const R = regions(cells, n), N = R.colour.length, W = Math.ceil(N / 32);
  const K = Math.max(...R.colour) + 1;
  const adjMask = R.adj.map(list => { const m = new Uint32Array(W); for (const j of list) m[j >> 5] |= 1 << (j & 31); return m; });
  const byColour = Array.from({ length: K }, () => new Uint32Array(W));
  R.colour.forEach((c, i) => { byColour[c][i >> 5] |= 1 << (i & 31); });
  const full = new Uint32Array(W);
  for (let i = 0; i < N; i++) full[i >> 5] |= 1 << (i & 31);
  let work = 0, blown = false;

  const has = (set, i) => (set[i >> 5] >> (i & 31)) & 1;
  const frontier = set => {
    const f = new Uint32Array(W);
    for (let i = 0; i < N; i++) if (has(set, i)) for (let w = 0; w < W; w++) f[w] |= adjMask[i][w];
    for (let w = 0; w < W; w++) f[w] &= ~set[w];
    return f;
  };
  const count = a => { let t = 0; for (let w = 0; w < W; w++) { let x = a[w]; while (x) { x &= x - 1; t++; } } return t; };
  /* a lower bound: the colours still outside the flood (each needs a move of its own),
     and how many layers of regions lie between the flood and the farthest one */
  const bound = set => {
    let seenColours = 0, left = 0;
    for (let i = 0; i < N; i++) if (!has(set, i)) { left++; seenColours |= 1 << R.colour[i]; }
    if (!left) return 0;
    let colourBound = 0;
    for (let c = 0; c < K; c++) if (seenColours >> c & 1) colourBound++;
    let layer = set, depth = 0;
    for (;;) {
      const f = frontier(layer);
      if (!count(f)) break;
      const nl = layer.slice();
      for (let w = 0; w < W; w++) nl[w] |= f[w];
      layer = nl;
      depth++;
      if (count(layer) === N) break;
    }
    return Math.max(colourBound, depth);
  };
  const absorb = (set, c) => {
    const f = frontier(set), out = set.slice();
    let grew = false;
    for (let w = 0; w < W; w++) { const add = f[w] & byColour[c][w]; if (add) { out[w] |= add; grew = true; } }
    return grew ? out : null;
  };
  const start = new Uint32Array(W);
  start[R.start >> 5] |= 1 << (R.start & 31);
  const finished = set => { for (let w = 0; w < W; w++) if (set[w] !== full[w]) return false; return true; };

  /* the flood's colour does not matter for what comes next, only which regions it holds */
  for (let limit = bound(start); limit <= 90 && !blown; limit++) {
    const seen = new Map(), path = [];
    const dfs = (set, g) => {
      if (finished(set)) return true;
      if (++work > budget) { blown = true; return false; }
      if (g + bound(set) > limit) return false;
      const k = Array.prototype.join.call(set, ',');
      const was = seen.get(k);
      if (was !== undefined && was <= g) return false;
      seen.set(k, g);
      const options = [];
      for (let c = 0; c < K; c++) {
        const nx = absorb(set, c);
        if (nx) options.push([c, nx, bound(nx)]);
      }
      options.sort((a, b) => a[2] - b[2]);
      for (const [c, nx] of options) {
        path.push(c);
        if (dfs(nx, g + 1)) return true;
        path.pop();
        if (blown) return false;
      }
      return false;
    };
    if (dfs(start, 0)) return { par: path.length, line: path.slice(), exact: true };
  }
  const g = greedy(cells, n);
  return { par: g.length, line: g, exact: false };
}

/** a quick line that always finishes: each move takes the colour that absorbs the most cells */
export function greedy(cells, n) {
  let b = cells;
  const line = [];
  while (!isDone(b) && line.length < 400) {
    let best = -1, bestN = -1;
    const k = Math.max(...b) + 1;
    for (let c = 0; c < k; c++) {
      if (c === b[0]) continue;
      const sz = floodOf(play(b, n, c), n).length;
      if (sz > bestN) { bestN = sz; best = c; }
    }
    line.push(best);
    b = play(b, n, best);
  }
  return line;
}
