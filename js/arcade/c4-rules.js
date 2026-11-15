/* ============================================================
   arcade/c4-rules.js — Connect Four's rules and its computer player.

   Pure (no DOM), shared by the game (./connect4.js), the thinking
   worker (./think.js) and the play-tests. A board is `cols` × `rows`:
   7 × 6 unless newGame() was given one of the other SIZES (an object
   with no cols / rows, as older callers build, is 7 × 6 too).
   cells[row * cols + col] with row 0 at the BOTTOM holds 1 (the player
   who went first), -1 (the other) or 0. A disc dropped in a column
   lands on the lowest empty cell. Four in a row — across, down or
   diagonal — wins; a full board with no four is a draw.

   POP OUT (newGame(first, { pop: true })), Hasbro's PopOut: on your
   turn either drop a disc or pop one of YOUR OWN discs out of the
   bottom row, and every disc above it in that column falls one place.
   Hasbro's rule sheet leaves the edge cases open, so these are ours:
     · a pop can line up four for either side. Four for you wins; four
       for your opponent alone is their win; four for both at once is
       a win for the side that popped (Ultra Board Games' rule: "the
       win goes to the player whose turn it is", and the one most
       programs use);
     · a full board does not end the game: the side to move pops. (A
       pop is always there then — a full bottom row with none of yours
       would be four in a row for the other side, and that game ended.
       Should a side ever have no move at all it is a draw, 'stuck',
       but on these sizes that cannot happen);
     · the same position with the same side to move for the third time
       is a draw (once discs can leave, positions can come back).
   A move is a number: c (0, 1, …) drops in column c, -1 - c pops
   column c. g.moves keeps them in order; g.seen counts positions
   (Pop Out only).

   The computer: negamax with alpha-beta, centre-first move order
   (drops first, then pops), iterative deepening under a time limit,
   and an evaluation that counts every window of four (three of yours
   and a gap is good, three of theirs and a gap is bad, the centre
   column is worth a little). A quicker win (or slower loss) scores
   better. In Pop Out a move that would repeat a position for the third
   time is scored as the draw it is; deeper repeats are not looked for
   (the search depth bounds them). `noise` jitters the root scores for
   the easier levels, never enough to pass up a win it can see.
   ============================================================ */
export const COLS = 7, ROWS = 6;
export const WIN = 1_000_000;
/* [cols, rows]; 7 × 6 is the standard board and the only one online */
export const SIZES = [[6, 5], [7, 6], [8, 7], [9, 7]];
const isSize = (c, r) => SIZES.some(([a, b]) => a === c && b === r);
const colsOf = g => g.cols || COLS;
const rowsOf = g => g.rows || ROWS;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/* columns from the centre out (ties: the left one first) */
const orders = new Map();
export function orderFor(cols = COLS) {
  if (!orders.has(cols)) orders.set(cols, Array.from({ length: cols }, (_, c) => c).sort((a, b) => Math.abs(2 * a - cols + 1) - Math.abs(2 * b - cols + 1) || a - b));
  return orders.get(cols);
}

/* every window of four cells on a cols × rows board */
const windows = new Map();
export function windowsFor(cols = COLS, rows = ROWS) {
  const k = cols * 100 + rows;
  if (windows.has(k)) return windows.get(k);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    for (const [dr, dc] of DIRS) {
      const w = [];
      for (let i = 0; i < 4; i++) {
        const rr = r + dr * i, cc = c + dc * i;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) break;
        w.push(rr * cols + cc);
      }
      if (w.length === 4) out.push(w);
    }
  }
  windows.set(k, out);
  return out;
}
export const WINDOWS = windowsFor(COLS, ROWS);

/** opts { cols, rows } (one of SIZES, else 7 × 6), pop: Pop Out */
export function newGame(first = 1, opts = {}) {
  const ok = isSize(opts.cols, opts.rows);
  const cols = ok ? opts.cols : COLS, rows = ok ? opts.rows : ROWS;
  const g = { cols, rows, pop: !!opts.pop, cells: new Int8Array(cols * rows), h: new Int8Array(cols), turn: first === -1 ? -1 : 1, moves: [] };
  if (g.pop) g.seen = new Map([[keyOf(g), 1]]);
  return g;
}
export function copy(g) {
  const out = { cols: colsOf(g), rows: rowsOf(g), pop: !!g.pop, cells: g.cells.slice(), h: g.h.slice(), turn: g.turn, moves: g.moves.slice() };
  if (g.seen) out.seen = new Map(g.seen);
  return out;
}
/** the position and the side to move, as text (repetition counts) */
export function keyOf(g) {
  let s = g.turn === 1 ? 'a' : 'b';
  for (let i = 0; i < g.cells.length; i++) s += g.cells[i] === 1 ? '1' : g.cells[i] === -1 ? '2' : '0';
  return s;
}
const discs = g => { let n = 0; for (let c = 0; c < g.h.length; c++) n += g.h[c]; return n; };

export const canPlay = (g, c) => Number.isInteger(c) && c >= 0 && c < colsOf(g) && g.h[c] < rowsOf(g);
/** Pop Out: may the side to move pop column c (its own disc in the bottom row)? */
export const canPop = (g, c) => !!g.pop && Number.isInteger(c) && c >= 0 && c < colsOf(g) && g.h[c] > 0 && g.cells[c] === g.turn;
export const isLegal = (g, m) => Number.isInteger(m) && (m >= 0 ? canPlay(g, m) : canPop(g, -1 - m));
/** every legal move: drops centre-first, then pops */
export function legalMoves(g) {
  const ord = orderFor(colsOf(g)), out = [];
  for (const c of ord) if (canPlay(g, c)) out.push(c);
  if (g.pop) for (const c of ord) if (canPop(g, c)) out.push(-1 - c);
  return out;
}

/* the bare board changes, shared by the rules and the search (no move list) */
function mkDrop(g, c, C) { const r = g.h[c]++; g.cells[r * C + c] = g.turn; g.turn = -g.turn; return r; }
function unDrop(g, c, C) { const r = --g.h[c]; g.cells[r * C + c] = 0; g.turn = -g.turn; }
function mkPop(g, c, C) {
  const n = g.h[c];
  for (let r = 0; r < n - 1; r++) g.cells[r * C + c] = g.cells[(r + 1) * C + c];
  g.cells[(n - 1) * C + c] = 0;
  g.h[c] = n - 1;
  g.turn = -g.turn;
}
function unPop(g, c, C) {
  g.turn = -g.turn;
  const n = g.h[c];
  for (let r = n; r > 0; r--) g.cells[r * C + c] = g.cells[(r - 1) * C + c];
  g.cells[c] = g.turn;
  g.h[c] = n + 1;
}
const remember = g => { if (g.seen) { const k = keyOf(g); g.seen.set(k, (g.seen.get(k) || 0) + 1); } };
const forget = g => { if (g.seen) { const k = keyOf(g), n = (g.seen.get(k) || 0) - 1; if (n > 0) g.seen.set(k, n); else g.seen.delete(k); } };

/** drop the side to move's disc in column c; returns the row it lands on (or -1) */
export function play(g, c) {
  if (!canPlay(g, c)) return -1;
  const r = mkDrop(g, c, colsOf(g));
  g.moves.push(c);
  remember(g);
  return r;
}
/** Pop Out: pop the side to move's disc out of the bottom of column c; true when legal */
export function popOut(g, c) {
  if (!canPop(g, c)) return false;
  mkPop(g, c, colsOf(g));
  g.moves.push(-1 - c);
  remember(g);
  return true;
}
/** either kind of move (see the top); true when it was legal */
export const move = (g, m) => (Number.isInteger(m) && m < 0 ? popOut(g, -1 - m) : play(g, m) >= 0);
/** take back the last move; returns its column (or -1) */
export function undo(g) {
  const m = g.moves[g.moves.length - 1];
  if (m === undefined) return -1;
  forget(g);
  g.moves.pop();
  if (m >= 0) unDrop(g, m, colsOf(g)); else unPop(g, -1 - m, colsOf(g));
  return m >= 0 ? m : -1 - m;
}
export const full = g => discs(g) >= colsOf(g) * rowsOf(g);

/** every cell of the line(s) of four or more through (r, c), or null */
export function lineAt(g, r, c) {
  const C = colsOf(g), R = rowsOf(g);
  const who = g.cells[r * C + c];
  if (!who) return null;
  const cells = new Set();
  for (const [dr, dc] of DIRS) {
    const run = [[r, c]];
    for (const s of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k * s, cc = c + dc * k * s;
        if (rr < 0 || rr >= R || cc < 0 || cc >= C || g.cells[rr * C + cc] !== who) break;
        run.push([rr, cc]);
      }
    }
    if (run.length >= 4) run.forEach(([rr, cc]) => cells.add(rr * C + cc));
  }
  return cells.size ? [...cells].sort((a, b) => a - b).map(i => [Math.floor(i / C), i % C]) : null;
}
/* after a pop in column c: every four of `who`'s through that column (only its cells moved), or null */
function popLines(g, c, who) {
  const C = colsOf(g), all = new Map();
  for (let r = 0; r < g.h[c]; r++) {
    if (g.cells[r * C + c] !== who) continue;
    for (const [rr, cc] of lineAt(g, r, c) || []) all.set(rr * C + cc, [rr, cc]);
  }
  return all.size ? [...all.keys()].sort((a, b) => a - b).map(k => all.get(k)) : null;
}

/** after the last move: { over, winner: 1 | -1 | 0, line, reason: 'four' | 'both' | 'full' | 'stuck' | 'repeat' } */
export function outcome(g) {
  const m = g.moves[g.moves.length - 1];
  if (m !== undefined) {
    if (m >= 0) {
      const r = g.h[m] - 1;
      const line = lineAt(g, r, m);
      if (line) return { over: true, winner: g.cells[r * colsOf(g) + m], line, reason: 'four' };
    } else {
      const c = -1 - m, mover = -g.turn;
      const mine = popLines(g, c, mover), theirs = popLines(g, c, -mover);
      if (mine) return { over: true, winner: mover, line: mine, reason: theirs ? 'both' : 'four', other: theirs };
      if (theirs) return { over: true, winner: -mover, line: theirs, reason: 'four' };
    }
  }
  if (g.pop) {
    if ((g.seen?.get(keyOf(g)) || 0) >= 3) return { over: true, winner: 0, line: null, reason: 'repeat' };
    if (!legalMoves(g).length) return { over: true, winner: 0, line: null, reason: 'stuck' };
    return { over: false, winner: 0, line: null };
  }
  if (full(g)) return { over: true, winner: 0, line: null, reason: 'full' };
  return { over: false, winner: 0, line: null };
}

/* did the drop just made in column c make four? */
function wonBy(g, c, C, R) {
  const r = g.h[c] - 1, who = g.cells[r * C + c];
  return fourThrough(g, r, c, who, C, R);
}
function fourThrough(g, r, c, who, C, R) {
  for (const [dr, dc] of DIRS) {
    let n = 1;
    for (const s of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k * s, cc = c + dc * k * s;
        if (rr < 0 || rr >= R || cc < 0 || cc >= C || g.cells[rr * C + cc] !== who) break;
        n++;
      }
    }
    if (n >= 4) return true;
  }
  return false;
}
/* after a pop in column c: has `who` four through it? */
function popFour(g, c, who, C, R) {
  for (let r = 0; r < g.h[c]; r++) if (g.cells[r * C + c] === who && fourThrough(g, r, c, who, C, R)) return true;
  return false;
}

/** static score for the side to move */
export function evaluate(g) {
  const C = colsOf(g), R = rowsOf(g);
  const me = g.turn, cells = g.cells;
  let s = 0;
  /* the centre column (both middle ones on an even board) */
  const mids = C % 2 ? [(C - 1) / 2] : [C / 2 - 1, C / 2], wt = C % 2 ? 3 : 2;
  for (const c of mids) for (let r = 0; r < R; r++) s += wt * cells[r * C + c] * me;
  for (const w of windowsFor(C, R)) {
    let mine = 0, theirs = 0;
    for (let k = 0; k < 4; k++) { const v = cells[w[k]] * me; if (v > 0) mine++; else if (v < 0) theirs++; }
    if (mine && theirs) continue;
    if (mine === 3) s += 6; else if (mine === 2) s += 2;
    if (theirs === 3) s -= 5; else if (theirs === 2) s -= 2;
  }
  return s;
}

/**
 * Pick a move for the side to move. opts { maxDepth, timeMs, noise, rnd }
 * Returns { move, col, pop, score, depth, nodes, ms }: move as in g.moves,
 * col its column, pop true for a pop (col -1 / move null: no move at all).
 */
export function think(g0, opts = {}) {
  const g = copy(g0);
  const C = colsOf(g), R = rowsOf(g), N = C * R, POP = !!g.pop;
  const ORD = orderFor(C);
  const maxDepth = Math.max(1, Math.min(POP ? 30 : N, opts.maxDepth || N));
  const timeMs = Math.max(20, opts.timeMs || 1000);
  const noise = Math.max(0, opts.noise || 0);
  const rnd = typeof opts.rnd === 'function' ? opts.rnd : Math.random;
  const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const t0 = clock(), deadline = t0 + timeMs;
  let nodes = 0, armed = false, stop = false;
  const done = (m, score, depth) => ({ move: m, col: m === null ? -1 : m >= 0 ? m : -1 - m, pop: m !== null && m < 0, score, depth, nodes, ms: Math.round(clock() - t0) });

  const legal = legalMoves(g);
  if (!legal.length) return done(null, 0, 0);
  /* what a root move does at once: 1 it wins, -1 it hands the other side four (a pop), 0 a draw by repetition, null nothing yet */
  const now = legal.map(m => {
    let res = null;
    if (m >= 0) { mkDrop(g, m, C); if (wonBy(g, m, C, R)) res = 1; unDrop(g, m, C); return res; }
    const c = -1 - m, me = g.turn;
    mkPop(g, c, C);
    if (popFour(g, c, me, C, R)) res = 1;
    else if (popFour(g, c, -me, C, R)) res = -1;
    else if ((g.seen?.get(keyOf(g)) || 0) >= 2) res = 0;
    unPop(g, c, C);
    return res;
  });
  /* a win now is always taken, at every level */
  for (let i = 0; i < legal.length; i++) if (now[i] === 1) { nodes = legal.length; return done(legal[i], WIN, 1); }

  function negamax(depth, alpha, beta, ply) {
    nodes++;
    if (armed && (nodes & 2047) === 0 && clock() > deadline) stop = true;
    if (stop) return 0;
    if (!POP && discs(g) >= N) return 0;
    if (depth === 0) return evaluate(g);
    let best = -Infinity, any = false;
    for (const c of ORD) {
      if (g.h[c] >= R) continue;
      any = true;
      mkDrop(g, c, C);
      const s = wonBy(g, c, C, R) ? WIN - ply : -negamax(depth - 1, -beta, -alpha, ply + 1);
      unDrop(g, c, C);
      if (stop) return 0;
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) return best;
    }
    if (POP) {
      for (const c of ORD) {
        if (g.h[c] === 0 || g.cells[c] !== g.turn) continue;
        any = true;
        const me = g.turn;
        mkPop(g, c, C);
        const s = popFour(g, c, me, C, R) ? WIN - ply : popFour(g, c, -me, C, R) ? ply - WIN : -negamax(depth - 1, -beta, -alpha, ply + 1);
        unPop(g, c, C);
        if (stop) return 0;
        if (s > best) best = s;
        if (s > alpha) alpha = s;
        if (alpha >= beta) return best;
      }
    }
    return any ? best : 0;
  }

  let pick = { m: legal[0], score: -Infinity }, depthDone = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    armed = depth > 2;
    const scored = [];
    for (let i = 0; i < legal.length; i++) {
      const m = legal[i];
      let s;
      if (now[i] === -1) s = 1 - WIN;
      else if (now[i] === 0) s = 0;
      else if (m >= 0) { mkDrop(g, m, C); s = -negamax(depth - 1, -Infinity, Infinity, 1); unDrop(g, m, C); }
      else { mkPop(g, -1 - m, C); s = -negamax(depth - 1, -Infinity, Infinity, 1); unPop(g, -1 - m, C); }
      if (stop) break;
      scored.push({ m, score: s });
    }
    if (stop) break;
    let top = -Infinity, best = scored[0];
    for (const x of scored) {
      const v = x.score + (Math.abs(x.score) < WIN - 100 ? (rnd() * 2 - 1) * noise : 0);
      if (v > top) { top = v; best = x; }
    }
    pick = best;
    depthDone = depth;
    if (Math.abs(pick.score) >= WIN - 100 || (!POP && depth >= N - discs(g))) break;
    if (clock() > t0 + timeMs * 0.5) break;
  }
  return done(pick.m, pick.score, depthDone);
}

export const LEVELS = {
  1: { name: 'Easy', maxDepth: 2, timeMs: 300, noise: 9 },
  2: { name: 'Medium', maxDepth: 5, timeMs: 800, noise: 2 },
  3: { name: 'Hard', maxDepth: 42, timeMs: 1600, noise: 0 },
};

export default { COLS, ROWS, SIZES, newGame, copy, play, popOut, move, undo, canPlay, canPop, isLegal, legalMoves, outcome, lineAt, think, evaluate, keyOf, full, windowsFor, orderFor, LEVELS };
