/* ============================================================
   arcade/pipes-logic.js — the rules of Pipe Link, with no DOM.

   A board is n × n cells, numbered row-major (cell = row * n + col).
   A level is { n, ends: [{ color, a, b }] }: for each colour, the two
   cells its pipe must join. A solution joins every pair with a pipe
   that never crosses another, never passes through another colour's
   end, and together the pipes fill every cell of the board.

   Levels are made, not typed in: makeLevel(size, index) draws a random
   path that visits every cell once (a Hamiltonian path, shuffled by
   "backbite" moves), cuts it into segments and puts a pair of ends on
   each segment's two ends. So a full-board solution exists by
   construction; solve() below finds one without being told what it is,
   and the test suite runs it over every level the game can deal.

   Playing: a board keeps one path per colour (an array of cells that
   starts at one of that colour's ends). begin() / step() / walkTo()
   are exactly what dragging a pipe does:
     - pressing an end (or a pipe) picks that colour up; pressing a pipe
       keeps it up to the pressed cell;
     - moving to an empty neighbour extends it; back onto its own pipe
       shortens it; onto another colour's pipe cuts that pipe back;
       onto another colour's end is refused; onto its own far end joins.
   ============================================================ */
import { rng } from './kit.js';

export const SIZES = [5, 6, 7, 8, 9];
export const LEVELS_PER_SIZE = 20;
export const MAX_COLORS = 9;

const hash = (a, b) => (Math.imul(a + 1, 73856093) ^ Math.imul(b + 7, 19349663) ^ 0x5bd1e995) >>> 0;

export const neighbors = (n, cell) => {
  const r = Math.floor(cell / n), c = cell % n, out = [];
  if (r > 0) out.push(cell - n);
  if (c < n - 1) out.push(cell + 1);
  if (r < n - 1) out.push(cell + n);
  if (c > 0) out.push(cell - 1);
  return out;
};
export const adjacent = (n, a, b) => {
  const d = Math.abs(a - b);
  return (d === n) || (d === 1 && Math.floor(a / n) === Math.floor(b / n));
};

/* ---------- making levels ---------- */

/* a path through every cell of an n × n grid, shuffled by backbite moves */
function hamiltonianPath(n, r) {
  let path = [];
  for (let row = 0; row < n; row++) for (let k = 0; k < n; k++) path.push(row * n + (row % 2 ? n - 1 - k : k));
  const pos = new Int32Array(n * n);
  const index = () => path.forEach((cell, i) => { pos[cell] = i; });
  index();
  const steps = n * n * 40;
  for (let s = 0; s < steps; s++) {
    if (r() < 0.5) { path.reverse(); index(); }                 /* work on either end */
    const m = path.length - 1, head = path[m];
    const nb = neighbors(n, head), pick = nb[Math.floor(r() * nb.length)];
    const j = pos[pick];
    if (j >= m - 1) continue;                                  /* the cell before the head, or the head */
    /* p0 … pj, pm, pm-1 … pj+1 : the same edges but one, and a new head */
    const tail = path.splice(j + 1).reverse();
    path = path.concat(tail);
    index();
  }
  return path;
}

export function makeLevel(size, index) {
  const n = size;
  const r = rng(hash(size, index));
  const colors = Math.min(MAX_COLORS, n - 1 + (index % 2));
  const path = hamiltonianPath(n, r);
  const total = n * n, MIN = 4;
  /* cut into `colors` pieces of at least MIN cells, the slack dealt out at random */
  const lens = new Array(colors).fill(MIN);
  for (let spare = total - MIN * colors; spare > 0; spare--) lens[Math.floor(r() * colors)]++;
  const ends = [];
  let at = 0;
  lens.forEach((len, color) => { ends.push({ color, a: path[at], b: path[at + len - 1] }); at += len; });
  /* the colour order is the order along the path; shuffle it so colour 0 isn't always in one corner */
  for (let i = ends.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ends[i], ends[j]] = [ends[j], ends[i]]; }
  ends.forEach((e, color) => { e.color = color; });
  return { n, size, index, ends };
}

/* ---------- checking a full solution (independent of the game's own state) ---------- */
export function validSolution(level, paths) {
  const { n, ends } = level;
  if (!Array.isArray(paths) || paths.length !== ends.length) return false;
  const endColor = new Map();
  ends.forEach(e => { endColor.set(e.a, e.color); endColor.set(e.b, e.color); });
  const seen = new Set();
  for (let c = 0; c < ends.length; c++) {
    const p = paths[c];
    if (!Array.isArray(p) || p.length < 2) return false;
    const e = ends[c];
    const okEnds = (p[0] === e.a && p[p.length - 1] === e.b) || (p[0] === e.b && p[p.length - 1] === e.a);
    if (!okEnds) return false;
    for (let i = 0; i < p.length; i++) {
      const cell = p[i];
      if (!Number.isInteger(cell) || cell < 0 || cell >= n * n || seen.has(cell)) return false;
      seen.add(cell);
      if (i > 0 && !adjacent(n, p[i - 1], cell)) return false;
      if (endColor.has(cell) && endColor.get(cell) !== c) return false;     /* through another colour's end */
    }
  }
  return seen.size === n * n;
}

/* ---------- the solver ---------- */
/* Depth-first, one colour's head at a time, always the head with the
   fewest ways forward. Prunes a branch when an empty cell has fewer than
   two ways in or out, or a colour can no longer reach its other end.
   Returns one path per colour, or null when there is none (or when
   `maxNodes` is used up: solve.gaveUp then tells the two apart). */
export function solve(level, { maxNodes = 4e6 } = {}) {
  const { n, ends } = level;
  const N = n * n, K = ends.length;
  const owner = new Int8Array(N).fill(-1);          /* colour on the cell, -1 empty */
  const endOf = new Int8Array(N).fill(-1);
  const head = new Int32Array(K), target = new Int32Array(K), done = new Uint8Array(K);
  const paths = ends.map(e => [e.a]);
  const nbs = Array.from({ length: N }, (_, i) => neighbors(n, i));
  ends.forEach((e, c) => { endOf[e.a] = c; endOf[e.b] = c; owner[e.a] = c; owner[e.b] = c; head[c] = e.a; target[c] = e.b; });
  let nodes = 0, gaveUp = false;

  const deadCell = cell => {                        /* an empty cell that can't be threaded */
    let free = 0;
    for (const nb of nbs[cell]) {
      if (owner[nb] < 0) free++;
      else {
        const c = owner[nb];
        if (!done[c] && (head[c] === nb || target[c] === nb)) free++;
      }
    }
    return free < 2;
  };
  const reaches = c => {                            /* can colour c's head still get to its target? */
    const seen = new Uint8Array(N), stack = [head[c]];
    seen[head[c]] = 1;
    while (stack.length) {
      const cur = stack.pop();
      for (const nb of nbs[cur]) {
        if (seen[nb]) continue;
        if (nb === target[c]) return true;
        if (owner[nb] < 0) { seen[nb] = 1; stack.push(nb); }
      }
    }
    return false;
  };
  /* every pocket of empty cells must touch some unfinished colour's head or
     target (else nothing can ever fill it), and each unfinished colour must
     still be able to get from its head to its target through empty cells */
  const regionsOk = () => {
    const seen = new Uint8Array(N), stack = [];
    for (let s = 0; s < N; s++) {
      if (owner[s] >= 0 || seen[s]) continue;
      let touches = false;
      seen[s] = 1; stack.push(s);
      while (stack.length) {
        const cur = stack.pop();
        for (const nb of nbs[cur]) {
          const o = owner[nb];
          if (o < 0) { if (!seen[nb]) { seen[nb] = 1; stack.push(nb); } }
          else if (!done[o] && (head[o] === nb || target[o] === nb)) touches = true;
        }
      }
      if (!touches) return false;
    }
    return true;
  };
  const moves = c => nbs[head[c]].filter(nb => owner[nb] < 0 || nb === target[c]);

  const search = remaining => {
    if (remaining === 0) { for (let i = 0; i < N; i++) if (owner[i] < 0) return false; return true; }
    if (++nodes > maxNodes) { gaveUp = true; return false; }
    /* the colour with the fewest moves */
    let best = -1, bestMoves = null;
    for (let c = 0; c < K; c++) {
      if (done[c]) continue;
      const m = moves(c);
      if (m.length === 0) return false;
      if (!bestMoves || m.length < bestMoves.length) { best = c; bestMoves = m; if (m.length === 1) break; }
    }
    const c = best, from = head[c];
    /* hug walls and pipes first: prefer the cell with the fewest open neighbours */
    const tight = cell => (cell === target[c] ? -1 : nbs[cell].reduce((k, x) => k + (owner[x] < 0 ? 1 : 0), 0));
    bestMoves.sort((x, y) => tight(x) - tight(y));
    for (const nb of bestMoves) {
      const joins = nb === target[c];
      if (!joins && owner[nb] >= 0) continue;
      if (joins) {
        done[c] = 1; paths[c].push(nb);
        let fine = true;
        for (const x of nbs[from]) if (owner[x] < 0 && deadCell(x)) { fine = false; break; }
        if (fine && remaining > 1 && !regionsOk()) fine = false;
        if (fine && search(remaining - 1)) return true;
        paths[c].pop(); done[c] = 0;
      } else {
        owner[nb] = c; head[c] = nb; paths[c].push(nb);
        let fine = true;
        for (const x of nbs[nb]) if (owner[x] < 0 && deadCell(x)) { fine = false; break; }
        if (fine && !regionsOk()) fine = false;
        if (fine) for (let o = 0; o < K && fine; o++) if (!done[o] && !reaches(o)) fine = false;
        if (fine && search(remaining)) return true;
        paths[c].pop(); head[c] = from; owner[nb] = -1;
      }
      if (gaveUp) return false;
    }
    return false;
  };
  const found = search(K);
  solve.gaveUp = gaveUp && !found;
  return found ? paths.map(p => p.slice()) : null;
}

/* ---------- playing ---------- */
export function createBoard(level) {
  const { n, ends } = level;
  const endAt = new Int8Array(n * n).fill(-1);
  ends.forEach((e, c) => { endAt[e.a] = c; endAt[e.b] = c; });
  return { n, ends, endAt, paths: ends.map(() => []) };
}
export function ownerMap(board) {
  const map = new Int8Array(board.n * board.n).fill(-1);
  board.paths.forEach((p, c) => p.forEach(cell => { map[cell] = c; }));
  return map;
}
export const isConnected = (board, c) => {
  const p = board.paths[c], e = board.ends[c];
  return p.length >= 2 && ((p[0] === e.a && p[p.length - 1] === e.b) || (p[0] === e.b && p[p.length - 1] === e.a));
};
export const filled = board => board.paths.reduce((s, p) => s + p.length, 0);
export const connectedCount = board => board.ends.reduce((s, _, c) => s + (isConnected(board, c) ? 1 : 0), 0);
export const isSolved = board => connectedCount(board) === board.ends.length && filled(board) === board.n * board.n;
export const clearBoard = board => { board.paths = board.ends.map(() => []); };

/* press on a cell: which colour does that pick up (or -1)? Shortens the pipe if pressed mid-way. */
export function begin(board, cell) {
  const e0 = board.endAt[cell];
  if (e0 >= 0) { board.paths[e0] = [cell]; return e0; }
  for (let c = 0; c < board.paths.length; c++) {
    const i = board.paths[c].indexOf(cell);
    if (i >= 0) { board.paths[c] = board.paths[c].slice(0, i + 1); return c; }
  }
  return -1;
}

/* move colour c's pipe into the neighbouring cell. Returns true when something changed. */
export function step(board, c, cell) {
  const p = board.paths[c];
  if (!p.length || !adjacent(board.n, p[p.length - 1], cell)) return false;
  if (p.length >= 2 && p[p.length - 2] === cell) { p.pop(); return true; }      /* back one */
  const mine = p.indexOf(cell);
  if (mine >= 0) return false;                                                  /* (only the last cell, handled above) */
  const e = board.endAt[cell];
  if (e >= 0 && e !== c) return false;                                          /* another colour's end */
  if (e === c) {
    if (isConnected(board, c)) return false;
    p.push(cell); return true;                                                  /* joined */
  }
  if (isConnected(board, c)) return false;                                      /* a finished pipe only shortens */
  for (let d = 0; d < board.paths.length; d++) {
    if (d === c) continue;
    const i = board.paths[d].indexOf(cell);
    if (i >= 0) { board.paths[d] = board.paths[d].slice(0, i); break; }         /* cut the other pipe back */
  }
  p.push(cell);
  return true;
}

/* a pointer can skip cells; walk to the target one neighbour at a time (longer axis first) */
export function walkTo(board, c, cell) {
  let moved = false;
  for (let guard = 0; guard < board.n * 2; guard++) {
    const p = board.paths[c];
    if (!p.length) break;
    const from = p[p.length - 1];
    if (from === cell) break;
    /* inside the pipe already: shorten straight to it */
    const i = p.indexOf(cell);
    if (i >= 0) { board.paths[c] = p.slice(0, i + 1); moved = true; break; }
    const fr = Math.floor(from / board.n), fc = from % board.n, tr = Math.floor(cell / board.n), tc = cell % board.n;
    const dr = tr - fr, dc = tc - fc;
    const horizontal = Math.abs(dc) >= Math.abs(dr);
    const nx = horizontal ? from + Math.sign(dc) : from + Math.sign(dr) * board.n;
    if (!step(board, c, nx)) break;
    moved = true;
  }
  return moved;
}

/* the cell a keyboard step lands on, or -1 at the edge */
export function shift(n, cell, key) {
  const r = Math.floor(cell / n), c = cell % n;
  if (key === 'ArrowUp') return r > 0 ? cell - n : -1;
  if (key === 'ArrowDown') return r < n - 1 ? cell + n : -1;
  if (key === 'ArrowLeft') return c > 0 ? cell - 1 : -1;
  if (key === 'ArrowRight') return c < n - 1 ? cell + 1 : -1;
  return -1;
}
