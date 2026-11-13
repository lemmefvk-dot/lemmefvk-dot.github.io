/* ============================================================
   arcade/c4-rules.js — Connect Four's rules and its computer player.

   Pure (no DOM), shared by the game (./connect4.js), the thinking
   worker (./think.js) and the play-tests. A board is 7 columns × 6
   rows; cells[row * 7 + col] with row 0 at the BOTTOM holds 1 (the
   player who went first), -1 (the other) or 0. A disc dropped in a
   column lands on the lowest empty cell. Four in a row — across,
   down or diagonal — wins; a full board with no four is a draw.

   The computer: negamax with alpha-beta, centre-first move order,
   iterative deepening under a time limit, and an evaluation that
   counts every window of four (three of yours and a gap is good,
   three of theirs and a gap is bad, the centre column is worth a
   little). A quicker win (or slower loss) scores better. `noise`
   jitters the root scores for the easier levels, never enough to
   pass up a win it can see.
   ============================================================ */
export const COLS = 7, ROWS = 6;
export const WIN = 1_000_000;
const ORDER = [3, 2, 4, 1, 5, 0, 6];

/* every window of four cells */
export const WINDOWS = (() => {
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const w = [];
      for (let k = 0; k < 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
        w.push(rr * COLS + cc);
      }
      if (w.length === 4) out.push(w);
    }
  }
  return out;
})();

export function newGame(first = 1) {
  return { cells: new Int8Array(COLS * ROWS), h: new Int8Array(COLS), turn: first === -1 ? -1 : 1, moves: [] };
}
export function copy(g) {
  return { cells: g.cells.slice(), h: g.h.slice(), turn: g.turn, moves: g.moves.slice() };
}
export const canPlay = (g, c) => Number.isInteger(c) && c >= 0 && c < COLS && g.h[c] < ROWS;
/** drop the side to move's disc in column c; returns the row it lands on (or -1) */
export function play(g, c) {
  if (!canPlay(g, c)) return -1;
  const r = g.h[c]++;
  g.cells[r * COLS + c] = g.turn;
  g.moves.push(c);
  g.turn = -g.turn;
  return r;
}
export function undo(g) {
  const c = g.moves.pop();
  if (c === undefined) return -1;
  const r = --g.h[c];
  g.cells[r * COLS + c] = 0;
  g.turn = -g.turn;
  return c;
}
export const full = g => g.moves.length >= COLS * ROWS;

/** every cell of the line(s) of four or more through (r, c), or null */
export function lineAt(g, r, c) {
  const who = g.cells[r * COLS + c];
  if (!who) return null;
  const cells = new Set();
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const run = [[r, c]];
    for (const s of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k * s, cc = c + dc * k * s;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || g.cells[rr * COLS + cc] !== who) break;
        run.push([rr, cc]);
      }
    }
    if (run.length >= 4) run.forEach(([rr, cc]) => cells.add(rr * COLS + cc));
  }
  return cells.size ? [...cells].sort((a, b) => a - b).map(i => [Math.floor(i / COLS), i % COLS]) : null;
}

/** after the last move: { over, winner: 1 | -1 | 0, line } */
export function outcome(g) {
  const c = g.moves[g.moves.length - 1];
  if (c !== undefined) {
    const r = g.h[c] - 1;
    const line = lineAt(g, r, c);
    if (line) return { over: true, winner: g.cells[r * COLS + c], line };
  }
  if (full(g)) return { over: true, winner: 0, line: null };
  return { over: false, winner: 0, line: null };
}

const wonBy = (g, c) => {
  /* did the last move (in column c) make four? */
  const r = g.h[c] - 1, who = g.cells[r * COLS + c];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (const s of [1, -1]) {
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k * s, cc = c + dc * k * s;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || g.cells[rr * COLS + cc] !== who) break;
        n++;
      }
    }
    if (n >= 4) return true;
  }
  return false;
};

/** static score for the side to move */
export function evaluate(g) {
  const me = g.turn, cells = g.cells;
  let s = 0;
  for (let r = 0; r < ROWS; r++) s += 3 * cells[r * COLS + 3] * me;
  for (const w of WINDOWS) {
    let mine = 0, theirs = 0;
    for (let k = 0; k < 4; k++) { const v = cells[w[k]] * me; if (v > 0) mine++; else if (v < 0) theirs++; }
    if (mine && theirs) continue;
    if (mine === 3) s += 6; else if (mine === 2) s += 2;
    if (theirs === 3) s -= 5; else if (theirs === 2) s -= 2;
  }
  return s;
}

/**
 * Pick a column for the side to move. opts { maxDepth, timeMs, noise, rnd }
 * Returns { col, score, depth, nodes, ms }.
 */
export function think(g0, opts = {}) {
  const g = copy(g0);
  const maxDepth = Math.max(1, Math.min(42, opts.maxDepth || 42));
  const timeMs = Math.max(20, opts.timeMs || 1000);
  const noise = Math.max(0, opts.noise || 0);
  const rnd = typeof opts.rnd === 'function' ? opts.rnd : Math.random;
  const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const t0 = clock(), deadline = t0 + timeMs;
  let nodes = 0, armed = false, stop = false;

  const legal = ORDER.filter(c => canPlay(g, c));
  if (!legal.length) return { col: -1, score: 0, depth: 0, nodes: 0, ms: 0 };
  /* a win now is always taken, at every level */
  for (const c of legal) { play(g, c); const w = wonBy(g, c); undo(g); if (w) return { col: c, score: WIN, depth: 1, nodes: legal.length, ms: Math.round(clock() - t0) }; }

  function negamax(depth, alpha, beta, ply) {
    nodes++;
    if (armed && (nodes & 2047) === 0 && clock() > deadline) stop = true;
    if (stop) return 0;
    if (full(g)) return 0;
    if (depth === 0) return evaluate(g);
    let best = -Infinity;
    for (const c of ORDER) {
      if (g.h[c] >= ROWS) continue;
      play(g, c);
      const s = wonBy(g, c) ? WIN - ply : -negamax(depth - 1, -beta, -alpha, ply + 1);
      undo(g);
      if (stop) return 0;
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }

  let pick = { col: legal[0], score: -Infinity }, done = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    armed = depth > 2;
    const scored = [];
    for (const c of legal) {
      play(g, c);
      const s = -negamax(depth - 1, -Infinity, Infinity, 1);
      undo(g);
      if (stop) break;
      scored.push({ col: c, score: s });
    }
    if (stop) break;
    let top = -Infinity, best = scored[0];
    for (const x of scored) {
      const v = x.score + (Math.abs(x.score) < WIN - 100 ? (rnd() * 2 - 1) * noise : 0);
      if (v > top) { top = v; best = x; }
    }
    pick = best;
    done = depth;
    if (Math.abs(pick.score) >= WIN - 100 || depth >= COLS * ROWS - g.moves.length) break;
    if (clock() > t0 + timeMs * 0.5) break;
  }
  return { col: pick.col, score: pick.score, depth: done, nodes, ms: Math.round(clock() - t0) };
}

export const LEVELS = {
  1: { name: 'Easy', maxDepth: 2, timeMs: 300, noise: 9 },
  2: { name: 'Medium', maxDepth: 5, timeMs: 800, noise: 2 },
  3: { name: 'Hard', maxDepth: 42, timeMs: 1600, noise: 0 },
};

export default { COLS, ROWS, newGame, play, undo, canPlay, outcome, lineAt, think, evaluate, LEVELS };
