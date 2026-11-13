/* ============================================================
   arcade/gomoku-rules.js — Gomoku (five in a row) on 15 × 15, and
   its computer player. Pure (no DOM): shared by the game
   (./gomoku.js), the thinking worker (./think.js) and the tests.

   THE RULE CHOSEN (the game says the same): free-style. Black moves
   first; five OR MORE stones in an unbroken row, column or diagonal
   win — an overline of six or seven counts. There are no
   restrictions on Black (no 3-3, 4-4 or overline bans). A full board
   is a draw.

   cells[row * 15 + col] holds 1 (Black, the first mover), -1 or 0.

   THE COMPUTER looks at every empty point near the stones and scores
   it by the lines it would make for itself (attack) and break for
   the other side (defence): a five wins, an open four cannot be
   stopped, a four forces a reply, an open three threatens an open
   four, and so on; a double threat (four-four, four-three, three-
   three) scores extra. Every level takes a win it sees. Hard always
   stops a four and weighs attack and defence almost evenly; Medium
   is a little random and leans to attack; Easy is quite random,
   plays down the other side's threes, and only usually stops a
   four — it can be beaten.
   ============================================================ */
export const N = 15, AREA = N * N;
export const LEVELS = {
  1: { name: 'Easy', defend: 0.55, noise: 0.35, blockFour: 0.8 },
  2: { name: 'Medium', defend: 0.7, noise: 0.12, blockFour: 1 },
  3: { name: 'Hard', defend: 0.9, noise: 0, blockFour: 1 },
};
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
export const pointName = i => `${'ABCDEFGHJKLMNOP'[i % N]}${N - ((i / N) | 0)}`;

export function newGame() { return { cells: new Int8Array(AREA), turn: 1, moves: [], count: 0 }; }
export function copy(g) { return { cells: g.cells.slice(), turn: g.turn, moves: g.moves.slice(), count: g.count }; }
export const canPlay = (g, i) => Number.isInteger(i) && i >= 0 && i < AREA && g.cells[i] === 0;
export function play(g, i) {
  if (!canPlay(g, i)) return false;
  g.cells[i] = g.turn;
  g.moves.push(i);
  g.count++;
  g.turn = -g.turn;
  return true;
}
export function undo(g) {
  const i = g.moves.pop();
  if (i === undefined) return -1;
  g.cells[i] = 0;
  g.count--;
  g.turn = -g.turn;
  return i;
}

/** the winning run (array of points, 5 or more) through point i, or null */
export function lineAt(g, i) {
  const who = g.cells[i];
  if (!who) return null;
  const r0 = (i / N) | 0, c0 = i % N;
  for (const [dr, dc] of DIRS) {
    const run = [i];
    for (const s of [1, -1]) {
      for (let k = 1; k < N; k++) {
        const r = r0 + dr * k * s, c = c0 + dc * k * s;
        if (r < 0 || r >= N || c < 0 || c >= N || g.cells[r * N + c] !== who) break;
        run.push(r * N + c);
      }
    }
    if (run.length >= 5) return run;
  }
  return null;
}
/** { over, winner (1/-1/0 draw), line } judging the position after the last move */
export function outcome(g) {
  const last = g.moves[g.moves.length - 1];
  if (last !== undefined) {
    const line = lineAt(g, last);
    if (line) return { over: true, winner: g.cells[last], line };
  }
  if (g.count >= AREA) return { over: true, winner: 0, line: null };
  return { over: false, winner: 0, line: null };
}

/* ------------------------------ the computer ------------------------------ */
/* what a stone at i would make for `who` along one direction: the run it joins and how many ends are open (0, 1 or 2) */
function shape(cells, i, who, dr, dc) {
  const r0 = (i / N) | 0, c0 = i % N;
  let len = 1, open = 0, gapAfter = 0;
  for (const s of [1, -1]) {
    let k = 1;
    for (; k < 6; k++) {
      const r = r0 + dr * k * s, c = c0 + dc * k * s;
      if (r < 0 || r >= N || c < 0 || c >= N || cells[r * N + c] !== who) break;
      len++;
    }
    const r = r0 + dr * k * s, c = c0 + dc * k * s;
    if (r >= 0 && r < N && c >= 0 && c < N && cells[r * N + c] === 0) {
      open++;
      /* a single gap and then more of ours: a "broken" shape (x.xx) counts for a little extra */
      const r2 = r + dr * s, c2 = c + dc * s;
      if (r2 >= 0 && r2 < N && c2 >= 0 && c2 < N && cells[r2 * N + c2] === who) gapAfter++;
    }
  }
  return { len, open, gapAfter };
}
const patternScore = ({ len, open, gapAfter }) => {
  if (len >= 5) return 100000;
  if (open === 0) return 0;
  if (len === 4) return open === 2 ? 10000 : 1200;
  if (len === 3) return open === 2 ? 1100 : 120 + gapAfter * 300;
  if (len === 2) return (open === 2 ? 90 : 12) + gapAfter * 40;
  return open === 2 ? 8 : 2;
};
/** how much a stone of `who` at i is worth: the sum over the four directions, with double threats counted extra */
export function pointValue(cells, i, who) {
  let sum = 0, fours = 0, threes = 0;
  for (const [dr, dc] of DIRS) {
    const sh = shape(cells, i, who, dr, dc);
    const v = patternScore(sh);
    sum += v;
    if (sh.len >= 4 && sh.open >= 1) fours++;
    else if ((sh.len === 3 && sh.open === 2) || (sh.len === 3 && sh.gapAfter && sh.open >= 1)) threes++;
  }
  if (fours >= 2 || (fours >= 1 && threes >= 1)) sum += 9000;      /* four-four and four-three cannot be stopped */
  else if (threes >= 2) sum += 4000;                               /* a double open three usually cannot either */
  return sum;
}

/** empty points within two steps of a stone (or the centre on an empty board) */
export function nearby(g) {
  if (g.count === 0) return [((N / 2) | 0) * N + ((N / 2) | 0)];
  const mark = new Uint8Array(AREA), out = [];
  for (let i = 0; i < AREA; i++) {
    if (!g.cells[i]) continue;
    const r0 = (i / N) | 0, c0 = i % N;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || r >= N || c < 0 || c >= N) continue;
      const j = r * N + c;
      if (!mark[j] && !g.cells[j]) { mark[j] = 1; out.push(j); }
    }
  }
  return out;
}

/** every point where `who` would make five (or more) now */
export const winners = (g, who) => nearby(g).filter(i => { g.cells[i] = who; const w = !!lineAt(g, i); g.cells[i] = 0; return w; });

/**
 * Choose a point for the side to move: { move, score }. opts: level, rnd (a () => [0,1) for tests).
 */
export function think(g, opts = {}) {
  const lv = LEVELS[opts.level] || LEVELS[2];
  const rnd = opts.rnd || Math.random;
  const me = g.turn, cells = g.cells;
  const cand = nearby(g);
  if (g.count === 0) return { move: cand[0], score: 0 };
  /* a win is always taken; a four is stopped (Easy usually does) */
  const win = cand.filter(i => { cells[i] = me; const w = !!lineAt(g, i); cells[i] = 0; return w; });
  if (win.length) return { move: win[(rnd() * win.length) | 0], score: 1e6 };
  const must = cand.filter(i => { cells[i] = -me; const w = !!lineAt(g, i); cells[i] = 0; return w; });
  if (must.length && rnd() < lv.blockFour) return { move: must[(rnd() * must.length) | 0], score: 5e5 };
  const scored = cand.map(i => {
    const atk = pointValue(cells, i, me), def = pointValue(cells, i, -me) * lv.defend;
    return { i, s: atk + def + (lv.noise ? rnd() * lv.noise * 400 : 0) };
  }).sort((a, b) => b.s - a.s);
  if (lv.noise >= 0.3 && rnd() < lv.noise * 0.5) {          /* Easy: sometimes just a nearby point */
    const k = Math.min(scored.length, 6);
    return { move: scored[(rnd() * k) | 0].i, score: 0 };
  }
  return { move: scored[0].i, score: scored[0].s };
}

/** a game that starts from a given position ({ cells: [225], turn }) and then replays `list` */
export function fromBase(base, list = []) {
  const g = newGame();
  g.cells = Int8Array.from(base.cells); g.turn = base.turn === -1 ? -1 : 1; g.count = g.cells.reduce((n, v) => n + (v ? 1 : 0), 0);
  for (const m of list) if (!play(g, m)) break;
  return g;
}
/** a position from rows of '.', 'x' (Black), 'o' (White) — 15 strings of 15 — for tests; `turn` moves next */
export function fromRows(rows, turn = 1) {
  const g = newGame();
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const v = ch === 'x' ? 1 : ch === 'o' ? -1 : 0;
    if (v) { g.cells[r * N + c] = v; g.count++; }
  }));
  g.turn = turn;
  return g;
}
export function fromMoves(list) {
  const g = newGame();
  for (const m of list) if (!play(g, m)) break;
  return g;
}
