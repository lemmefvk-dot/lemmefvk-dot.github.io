/* ============================================================
   arcade/hexclaim-rules.js — the rules and the computer of Hex
   Claim, no DOM.

   An n × n board of hexagons set as a rhombus (cell = row * n +
   col). Two players take turns claiming one empty hexagon. Player 1
   (Orange, moves first) must join the TOP edge to the BOTTOM edge
   with an unbroken chain of their own hexagons; player -1 (Blue)
   must join the LEFT edge to the RIGHT edge. A hexagon touches
   six others: left and right, up-left... in this layout (row-1,
   col) and (row-1, col+1) above, (row+1, col-1) and (row+1, col)
   below. One of the two always gets across: a board can't end in
   a draw, so none is offered.

   The computer (bestMove) reads the board as a race: how many more
   hexagons does each side still need to claim for a chain, counting
   its own hexagons as free and the other side's as walls (a 0-1
   shortest path, dist()). Easy picks among the better-looking
   moves at random; Medium takes the move that most improves that
   race; Hard looks one reply ahead too, and always takes a win and
   stops one it can see.
   ============================================================ */
export const SIZES = [7, 9, 11];
export const LEVELS = { 1: { name: 'Easy' }, 2: { name: 'Medium' }, 3: { name: 'Hard' } };
const INF = 1e6;

export function newGame(n = 9) {
  return { n, cells: new Int8Array(n * n), turn: 1, moves: [], count: 0 };
}
export const clone = g => ({ n: g.n, cells: g.cells.slice(), turn: g.turn, moves: g.moves.slice(), count: g.count });

const NB = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]];
const nbCache = new Map();
export function neighbors(n, i) {
  let t = nbCache.get(n);
  if (!t) { t = []; nbCache.set(n, t); }
  if (t[i]) return t[i];
  const r = (i / n) | 0, c = i % n, out = [];
  for (const [dr, dc] of NB) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < n && cc < n) out.push(rr * n + cc); }
  return (t[i] = out);
}
export const canPlay = (g, i) => Number.isInteger(i) && i >= 0 && i < g.n * g.n && g.cells[i] === 0 && !g.over;
export function play(g, i) {
  if (!canPlay(g, i)) return false;
  g.cells[i] = g.turn; g.moves.push(i); g.count++;
  const o = outcome(g);
  if (o.over) g.over = o; else g.turn = -g.turn;
  return true;
}
export function undo(g) {
  if (!g.moves.length) return false;
  const i = g.moves.pop();
  g.cells[i] = 0; g.count--; delete g.over;
  g.turn = g.moves.length % 2 === 0 ? 1 : -1;
  return true;
}
/** a position from rows of 'x' (Orange), 'o' (Blue) and '.'; turn defaults to whoever has fewer stones */
export function fromRows(rows, turn) {
  const n = rows.length, g = newGame(n);
  rows.forEach((row, r) => { for (let c = 0; c < n; c++) { const ch = row[c]; g.cells[r * n + c] = ch === 'x' ? 1 : ch === 'o' ? -1 : 0; if (ch === 'x' || ch === 'o') g.count++; } });
  const x = g.cells.reduce((a, v) => a + (v === 1 ? 1 : 0), 0), o = g.cells.reduce((a, v) => a + (v === -1 ? 1 : 0), 0);
  g.turn = turn || (x > o ? -1 : 1);
  const out = outcome(g);
  if (out.over) g.over = out;
  return g;
}

/** { over: false } or { over: true, winner, line: [cells] } — the chain that joined the edges */
export function outcome(g) {
  const { n, cells } = g;
  for (const p of [1, -1]) {
    const parent = new Int16Array(n * n).fill(-2);
    const q = [];
    for (let k = 0; k < n; k++) { const i = p === 1 ? k : k * n; if (cells[i] === p) { parent[i] = -1; q.push(i); } }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (p === 1 ? ((i / n) | 0) === n - 1 : i % n === n - 1) {
        const line = [];
        for (let j = i; j >= 0; j = parent[j]) line.push(j);
        return { over: true, winner: p, line: line.reverse() };
      }
      for (const j of neighbors(n, i)) if (cells[j] === p && parent[j] === -2) { parent[j] = i; q.push(j); }
    }
  }
  return { over: false };
}

/** how many more hexagons player p must claim to join their edges (0 = already joined; INF = blocked) */
export function dist(g, p) {
  const { n, cells } = g;
  const d = new Int32Array(n * n).fill(INF);
  const front = [], back = [];
  let bh = 0;
  const cost = i => (cells[i] === p ? 0 : cells[i] === 0 ? 1 : INF);
  for (let k = 0; k < n; k++) {
    const i = p === 1 ? k : k * n, c = cost(i);
    if (c < INF && c < d[i]) { d[i] = c; (c === 0 ? front : back).push(i); }
  }
  let best = INF;
  while (front.length || bh < back.length) {
    const i = front.length ? front.pop() : back[bh++];
    const di = d[i];
    if (p === 1 ? ((i / n) | 0) === n - 1 : i % n === n - 1) { best = Math.min(best, di); if (best === 0) break; continue; }
    if (di >= best) continue;
    for (const j of neighbors(n, i)) {
      const c = cost(j);
      if (c >= INF) continue;
      const nd = di + c;
      if (nd < d[j]) { d[j] = nd; (c === 0 ? front : back).push(j); }
    }
  }
  return best;
}

/* how good the position is for p: bigger = p is closer than the other side */
const score = (g, p) => {
  const mine = dist(g, p), theirs = dist(g, -p);
  if (mine === 0) return 1000;
  if (theirs === 0) return -1000;
  return Math.min(60, theirs) - Math.min(60, mine);
};

/** a move for the side to move at the given level (1 Easy, 2 Medium, 3 Hard); `rand` is a () => [0,1) */
export function bestMove(g, level = 2, rand = Math.random) {
  const { n } = g, me = g.turn;
  const empty = [];
  for (let i = 0; i < n * n; i++) if (g.cells[i] === 0) empty.push(i);
  if (!empty.length) return -1;
  if (g.count === 0) return ((n >> 1) * n) + (n >> 1);          /* the middle */
  const mid = (n - 1) / 2;
  const centre = i => -(Math.abs(((i / n) | 0) - mid) + Math.abs((i % n) - mid)) * 0.01;
  const trial = i => { g.cells[i] = me; };
  const undoTrial = i => { g.cells[i] = 0; };
  /* a win now, and the other side's win to stop */
  for (const i of empty) { trial(i); const w = dist(g, me) === 0; undoTrial(i); if (w) return i; }
  const must = [];
  for (const i of empty) { g.cells[i] = -me; if (dist(g, -me) === 0) must.push(i); g.cells[i] = 0; }
  if (level >= 2 && must.length) return must[0];
  const rated = empty.map(i => { trial(i); const v = score(g, me) + centre(i); undoTrial(i); return { i, v }; });
  rated.sort((a, b) => b.v - a.v);
  if (level === 1) {
    const pool = rated.slice(0, Math.max(3, Math.ceil(rated.length * 0.18)));
    return pool[(rand() * pool.length) | 0].i;
  }
  if (level === 2) {
    const top = rated.filter(r => r.v >= rated[0].v - 0.005);
    return top[(rand() * top.length) | 0].i;
  }
  /* Hard: for each of the best few, assume the other side answers with the move that suits them best */
  const cand = rated.slice(0, 10);
  let pick = cand[0].i, bestV = -Infinity;
  for (const c of cand) {
    trial(c.i);
    let worst = Infinity;
    if (dist(g, me) === 0) worst = 1000;
    else {
      const replies = [];
      for (const j of empty) if (j !== c.i) { g.cells[j] = -me; replies.push({ j, v: score(g, -me) }); g.cells[j] = 0; }
      replies.sort((a, b) => b.v - a.v);
      for (const r of replies.slice(0, 6)) { g.cells[r.j] = -me; worst = Math.min(worst, score(g, me)); g.cells[r.j] = 0; }
    }
    undoTrial(c.i);
    const v = worst + c.v * 0.2;
    if (v > bestV) { bestV = v; pick = c.i; }
  }
  return pick;
}

export const pointName = (n, i) => `${String.fromCharCode(97 + (i % n))}${((i / n) | 0) + 1}`;

export default { SIZES, LEVELS, newGame, clone, neighbors, canPlay, play, undo, fromRows, outcome, dist, bestMove, pointName };
