/* ============================================================
   arcade/reversi-rules.js — Reversi's rules and its computer player.

   Pure (no DOM), shared by the game (./reversi.js), the thinking
   worker (./think.js) and the play-tests. The board is 8 × 8 (the
   default, and the only size online) or 6 × 6, b[row * n + col], row 0
   at the top: 1 = Black (moves first), -1 = White, 0 = empty; a board's
   size is read from its length (64 or 36). The four middle squares
   start filled, as on 8 × 8. A move puts a disc on an empty square that
   brackets a straight line of the other colour's discs against one of
   your own; every bracketed disc flips. A player with no legal move
   passes (the game does it by itself); when neither can move, or the
   board is full, the one with more discs wins.

   Moves are listed in g.moves as square numbers (0..n²−1). Passes are
   not moves: they are implied by the rules, so both screens of an
   online game reach the same position from the same list.

   The computer: negamax with alpha-beta, a positional weight table
   plus mobility and corners, iterative deepening under a time limit,
   and an exact finish when few squares are left. `noise` jitters the
   easier levels' choices, never enough to skip a corner it can take.
   ============================================================ */
export const N = 8;
export const SIZES = [8, 6];
export const LEVELS = {
  1: { name: 'Easy', depth: 1, timeMs: 150, noise: 60, exact: 0 },
  2: { name: 'Medium', depth: 4, timeMs: 500, noise: 8, exact: 8 },
  3: { name: 'Hard', depth: 8, timeMs: 1100, noise: 0, exact: 11 },
};
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
/** the side of a board (or a game's board) */
export const sizeOf = b => ((b && b.b ? b.b : b).length === 36 ? 6 : 8);
export const squareName = (i, n = N) => `${'abcdefgh'[i % n]}${((i / n) | 0) + 1}`;

export function newGame(n = N) {
  const sz = n === 6 ? 6 : 8, m = sz / 2;
  const b = new Int8Array(sz * sz);
  b[(m - 1) * sz + (m - 1)] = -1; b[m * sz + m] = -1;
  b[(m - 1) * sz + m] = 1; b[m * sz + (m - 1)] = 1;
  return { b, turn: 1, moves: [], hist: [] };
}
/** rows of 'X' / 'B' (Black), 'O' / 'W' (White), '.': 8 rows of 8, or 6 of 6 */
export function fromString(rows, turn = 1) {
  const cells = rows.join('').replace(/\s/g, '').split('');
  const b = new Int8Array(cells.length === 36 ? 36 : 64);
  cells.slice(0, b.length).forEach((ch, i) => { b[i] = ch === 'X' || ch === 'B' ? 1 : ch === 'O' || ch === 'W' ? -1 : 0; });
  return { b, turn, moves: [], hist: [] };
}
export const toRows = b => { const n = sizeOf(b); return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (b[r * n + c] === 1 ? 'X' : b[r * n + c] === -1 ? 'O' : '.')).join('')); };

/** the squares that would flip if `turn` played at i (empty list: illegal) */
export function flipsAt(b, i, turn) {
  const n = sizeOf(b);
  if (!Number.isInteger(i) || i < 0 || i >= n * n || b[i] !== 0) return [];
  const r0 = (i / n) | 0, c0 = i % n, out = [];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr, c = c0 + dc;
    const line = [];
    while (r >= 0 && r < n && c >= 0 && c < n && b[r * n + c] === -turn) { line.push(r * n + c); r += dr; c += dc; }
    if (line.length && r >= 0 && r < n && c >= 0 && c < n && b[r * n + c] === turn) out.push(...line);
  }
  return out;
}
export const legalMoves = (b, turn) => {
  const out = [];
  for (let i = 0; i < b.length; i++) if (b[i] === 0 && flipsAt(b, i, turn).length) out.push(i);
  return out;
};
export const count = b => { let x = 0, o = 0; for (let i = 0; i < b.length; i++) { if (b[i] === 1) x++; else if (b[i] === -1) o++; } return { black: x, white: o }; };

/** Play square i for the side to move. Returns { flips, passed } (passed: the side that was skipped, or 0) or null if illegal. */
export function play(g, i) {
  const fl = flipsAt(g.b, i, g.turn);
  if (!fl.length) return null;
  g.hist.push({ i, turn: g.turn, fl });
  g.b[i] = g.turn;
  for (const s of fl) g.b[s] = g.turn;
  g.moves.push(i);
  g.turn = -g.turn;
  let passed = 0;
  if (!legalMoves(g.b, g.turn).length && legalMoves(g.b, -g.turn).length) { passed = g.turn; g.turn = -g.turn; }
  g.hist[g.hist.length - 1].passed = passed;
  return { flips: fl, passed };
}
export function undo(g) {
  const h = g.hist.pop();
  if (!h) return false;
  g.moves.pop();
  g.b[h.i] = 0;
  for (const s of h.fl) g.b[s] = -h.turn;
  g.turn = h.turn;
  return true;
}
export function outcome(g) {
  const { black, white } = count(g.b);
  const over = !legalMoves(g.b, 1).length && !legalMoves(g.b, -1).length;
  if (!over) return { over: false, black, white };
  return { over: true, black, white, winner: black > white ? 1 : white > black ? -1 : 0 };
}

/* ------------------------- the computer ------------------------- */
/* each size's square weights, corners, and the squares next to a corner that stop being a liability once it is owned */
const TABLES = {
  8: {
    W: [
      100, -20, 10, 5, 5, 10, -20, 100,
      -20, -50, -2, -2, -2, -2, -50, -20,
      10, -2, 1, 1, 1, 1, -2, 10,
      5, -2, 1, 0, 0, 1, -2, 5,
      5, -2, 1, 0, 0, 1, -2, 5,
      10, -2, 1, 1, 1, 1, -2, 10,
      -20, -50, -2, -2, -2, -2, -50, -20,
      100, -20, 10, 5, 5, 10, -20, 100,
    ],
    CORNERS: [0, 7, 56, 63],
    NEAR: { 1: 0, 8: 0, 9: 0, 6: 7, 15: 7, 14: 7, 48: 56, 57: 56, 49: 56, 55: 63, 62: 63, 54: 63 },
  },
  6: {
    W: [
      100, -20, 10, 10, -20, 100,
      -20, -50, -2, -2, -50, -20,
      10, -2, 1, 1, -2, 10,
      10, -2, 1, 1, -2, 10,
      -20, -50, -2, -2, -50, -20,
      100, -20, 10, 10, -20, 100,
    ],
    CORNERS: [0, 5, 30, 35],
    NEAR: { 1: 0, 6: 0, 7: 0, 4: 5, 11: 5, 10: 5, 24: 30, 31: 30, 25: 30, 29: 35, 34: 35, 28: 35 },
  },
};
for (const t of Object.values(TABLES)) { t.ORDER = t.W.map((_, i) => i); t.ORDER.sort((x, y) => t.W[y] - t.W[x]); }

function evaluate(b, me, empties, T) {
  let pos = 0, mine = 0, theirs = 0;
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (!v) continue;
    let w = T.W[i];
    if (T.NEAR[i] !== undefined && b[T.NEAR[i]] === v) w = 4;
    pos += v * me * w;
    if (v === me) mine++; else theirs++;
  }
  if (empties === 0) return (mine - theirs) * 1000;
  const mm = legalMoves(b, me).length, tm = legalMoves(b, -me).length;
  const mob = mm + tm ? 100 * (mm - tm) / (mm + tm) : 0;
  let cor = 0;
  for (const c of T.CORNERS) cor += b[c] * me * 60;
  return pos + mob * 3 + cor;
}

/** best move for g.turn: { move, score, depth, nodes, ms } (move -1 if none) */
export function think(g, opts = {}) {
  const t0 = Date.now();
  const lv = { ...LEVELS[2], ...opts };
  const b = g.b.slice();
  const T = TABLES[sizeOf(b)];
  const area = b.length;
  const me = g.turn;
  const first = legalMoves(b, me);
  if (!first.length) return { move: -1, score: 0, depth: 0, nodes: 0, ms: 0 };
  let nodes = 0, stop = false;
  const deadline = t0 + lv.timeMs;
  const empties0 = b.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);
  const exact = empties0 <= lv.exact;

  function search(turn, depth, alpha, beta, empties, passedOnce) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) stop = true;
    if (stop) return 0;
    const mv = [];
    for (const i of T.ORDER) if (b[i] === 0) { const f = flipsAt(b, i, turn); if (f.length) mv.push([i, f]); }
    if (!mv.length) {
      if (passedOnce) { let s = 0; for (let k = 0; k < area; k++) s += b[k]; return s * turn * 10000; }
      return -search(-turn, depth, -beta, -alpha, empties, true);
    }
    if (depth <= 0 && !exact) return evaluate(b, turn, empties, T);
    let best = -Infinity;
    for (const [i, f] of mv) {
      b[i] = turn; for (const s of f) b[s] = turn;
      const v = -search(-turn, depth - 1, -beta, -alpha, empties - 1, false);
      b[i] = 0; for (const s of f) b[s] = -turn;
      if (stop) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = { move: first[0], score: -Infinity }, done = 0;
  const maxDepth = exact ? area : lv.depth;
  for (let d = 1; d <= maxDepth; d++) {
    stop = false;
    const scored = [];
    let alpha = -Infinity;
    const order = best.move !== undefined ? [best.move, ...first.filter(m => m !== best.move)] : first;
    for (const i of order) {
      const f = flipsAt(b, i, me);
      b[i] = me; for (const s of f) b[s] = me;
      const v = -search(-me, exact ? area : d - 1, -Infinity, -alpha, empties0 - 1, false);
      b[i] = 0; for (const s of f) b[s] = -me;
      if (stop) break;
      scored.push([i, v]);
      if (v > alpha) alpha = v;
    }
    if (stop || scored.length < order.length) break;
    done = d;
    scored.sort((a, c) => c[1] - a[1]);
    best = { move: scored[0][0], score: scored[0][1], scored };
    if (Date.now() > deadline) break;
    if (exact) break;
  }
  if (lv.noise && best.scored) {
    /* the easier levels wander, but never past a corner */
    const corner = best.scored.find(([i]) => T.CORNERS.includes(i));
    if (corner && lv.noise < 40) best = { ...best, move: corner[0] };
    else {
      const top = best.scored[0][1];
      const pool = best.scored.filter(([, v]) => v >= top - lv.noise * 6);
      best = { ...best, move: pool[Math.floor(Math.random() * pool.length)][0] };
    }
  }
  return { move: best.move, score: best.score === -Infinity ? 0 : best.score, depth: done, nodes, ms: Date.now() - t0 };
}
