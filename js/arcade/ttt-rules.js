/* ============================================================
   arcade/ttt-rules.js — Tic-Tac-Toe's rules and its computer player.

   Pure (no DOM), shared by the game (./ttt.js), the thinking worker
   (./think.js) and the play-tests.

   Two boards share one game object { ult, cells, sub, next, turn, moves }:
     classic  3 × 3, cells[0..8]; three in a row wins, a full board is a draw.
     Ultimate 9 × 9, cells[row * 9 + col]. The 81 cells are nine 3 × 3
              boards. Where you play inside a small board sends your
              opponent to the same place on the big one (`next` = that
              small board; -1 = anywhere). Win a small board by three in a
              row inside it; win the game with three small boards in a row.
              A small board that fills up is dead (sub = 2). If the board
              you are sent to is already decided you may play anywhere.
   X (turn 1) moves first; O is -1. A move is one cell index.

   The computer.
     classic: Easy is random. Medium takes a win and blocks a loss, else
       takes the centre, a corner, or anything — it knows nothing of
       forks, so it can be beaten. Hard is full minimax with alpha-beta:
       it plays only moves that keep the best result and so never loses
       (the board is small enough to search to the end every time).
     Ultimate: Easy random; Medium looks one move ahead (wins a small
       board, blocks one, avoids sending you where you win); Hard is
       negamax with alpha-beta to a few plies under a time limit. That
       one is strong but not perfect — the full game is far too big.
   ============================================================ */
export const WIN = 1_000_000;
export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const LEVELS = { 1: { name: 'Easy' }, 2: { name: 'Medium' }, 3: { name: 'Hard' } };
const ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7];

export function newGame(ult = false) {
  return { ult: !!ult, cells: new Int8Array(ult ? 81 : 9), sub: new Int8Array(9), next: -1, turn: 1, moves: [] };
}
export function copy(g) {
  return { ult: g.ult, cells: g.cells.slice(), sub: g.sub.slice(), next: g.next, turn: g.turn, moves: g.moves.slice() };
}
/* the small board and the place inside it of an ultimate cell */
export const subOf = i => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3);
export const localOf = i => (Math.floor(i / 9) % 3) * 3 + (i % 3);
/* the cell index of local square l in small board s */
export const cellOf = (s, l) => (Math.floor(s / 3) * 3 + Math.floor(l / 3)) * 9 + (s % 3) * 3 + (l % 3);

function lineWinner(cells, off, get) {
  for (const [a, b, c] of LINES) {
    const v = get(off, a);
    if (v === 1 || v === -1) if (v === get(off, b) && v === get(off, c)) return { v, line: [a, b, c] };
  }
  return null;
}
const cellGet = (g, s) => (_o, l) => g.cells[cellOf(s, l)];

export function canPlay(g, i) {
  if (!Number.isInteger(i) || i < 0 || i >= g.cells.length || g.cells[i] !== 0) return false;
  if (!g.ult) return true;
  const s = subOf(i);
  return g.sub[s] === 0 && (g.next === -1 || g.next === s);
}
export function legalMoves(g) {
  const out = [];
  if (outcome(g).over) return out;
  for (let i = 0; i < g.cells.length; i++) if (canPlay(g, i)) out.push(i);
  return out;
}
/** place the side to move's mark; returns true when it was legal */
export function play(g, i) {
  if (!canPlay(g, i)) return false;
  g.cells[i] = g.turn;
  g.moves.push(i);
  if (g.ult) {
    const s = subOf(i);
    const w = lineWinner(g.cells, s, cellGet(g, s));
    if (w) g.sub[s] = w.v;
    else {
      let full = true;
      for (let l = 0; l < 9; l++) if (g.cells[cellOf(s, l)] === 0) { full = false; break; }
      if (full) g.sub[s] = 2;
    }
    const l = localOf(i);
    g.next = g.sub[l] === 0 ? l : -1;
  }
  g.turn = -g.turn;
  return true;
}
/** take back the last move (replays the rest: the boards are tiny) */
export function undo(g) {
  if (!g.moves.length) return false;
  const rest = g.moves.slice(0, -1);
  const f = newGame(g.ult);
  for (const m of rest) play(f, m);
  g.cells = f.cells; g.sub = f.sub; g.next = f.next; g.turn = f.turn; g.moves = f.moves;
  return true;
}
/** { over, winner: 1 | -1 | 0, line } — line is cell indices (classic) or small boards (Ultimate) */
export function outcome(g) {
  if (!g.ult) {
    const w = lineWinner(g.cells, 0, (_o, l) => g.cells[l]);
    if (w) return { over: true, winner: w.v, line: w.line };
    return g.moves.length >= 9 ? { over: true, winner: 0, line: null } : { over: false, winner: 0, line: null };
  }
  const w = lineWinner(g.sub, 0, (_o, l) => (g.sub[l] === 1 || g.sub[l] === -1 ? g.sub[l] : 0));
  if (w) return { over: true, winner: w.v, line: w.line };
  if (g.sub.every(v => v !== 0)) return { over: true, winner: 0, line: null };
  return { over: false, winner: 0, line: null };
}

/* ---------------------------- the computer ---------------------------- */
/* classic: exact negamax with alpha-beta. A faster win and a slower loss score better. */
function solve(cells, turn, depth, a, b) {
  for (const [x, y, z] of LINES) {
    const v = cells[x];
    if (v !== 0 && v === cells[y] && v === cells[z]) return v === turn ? WIN - depth : depth - WIN;
  }
  let any = false, best = -Infinity;
  for (const i of ORDER) {
    if (cells[i] !== 0) continue;
    any = true;
    cells[i] = turn;
    const s = -solve(cells, -turn, depth + 1, -b, -a);
    cells[i] = 0;
    if (s > best) best = s;
    if (best > a) a = best;
    if (a >= b) break;
  }
  return any ? best : 0;
}
/** every move with its exact score for the side to move (classic only) */
export function scoreMoves(g) {
  const cells = g.cells.slice(), out = [];
  for (let i = 0; i < 9; i++) {
    if (cells[i] !== 0) continue;
    cells[i] = g.turn;
    out.push({ move: i, score: -solve(cells, -g.turn, 1, -Infinity, Infinity) });
    cells[i] = 0;
  }
  return out;
}
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];
/** a move that wins now, or null */
function winning(g, turn) {
  for (let i = 0; i < 9; i++) {
    if (g.cells[i] !== 0) continue;
    for (const [a, b, c] of LINES) {
      if (!(a === i || b === i || c === i)) continue;
      const o = [a, b, c].filter(k => k !== i);
      if (g.cells[o[0]] === turn && g.cells[o[1]] === turn) return i;
    }
  }
  return null;
}

/* Ultimate evaluation, from `me`'s side: small boards, lines of small boards, centres */
function evalUlt(g, me) {
  let s = 0;
  for (let k = 0; k < 9; k++) {
    const v = g.sub[k];
    if (v === 1 || v === -1) s += (v === me ? 1 : -1) * (k === 4 ? 14 : 10);
    else if (v === 0) {
      for (const [a, b, c] of LINES) {
        let m = 0, t = 0;
        for (const l of [a, b, c]) { const x = g.cells[cellOf(k, l)]; if (x === me) m++; else if (x === -me) t++; }
        if (t === 0) s += m * m * 0.4; else if (m === 0) s -= t * t * 0.4;
      }
      if (g.cells[cellOf(k, 4)] === me) s += 0.5; else if (g.cells[cellOf(k, 4)] === -me) s -= 0.5;
    }
  }
  for (const [a, b, c] of LINES) {
    let m = 0, t = 0;
    for (const k of [a, b, c]) { if (g.sub[k] === me) m++; else if (g.sub[k] === -me) t++; }
    if (t === 0) s += m * m * 12; else if (m === 0) s -= t * t * 12;
  }
  return s;
}
function negaUlt(g, depth, a, b, ply, me, clock) {
  const o = outcome(g);
  if (o.over) return o.winner === 0 ? 0 : (o.winner === g.turn ? WIN - ply : ply - WIN);
  if (depth === 0 || clock.out) return evalUlt(g, g.turn);
  if (clock.n++ % 256 === 0 && performance.now() > clock.until) clock.out = true;
  let best = -Infinity;
  const moves = [];
  for (let i = 0; i < 81; i++) if (canPlay(g, i)) moves.push(i);
  /* try moves that win a small board first, then the centres */
  moves.sort((x, y) => (localOf(y) === 4) - (localOf(x) === 4));
  for (const i of moves) {
    const before = { sub: g.sub.slice(), next: g.next, turn: g.turn };
    g.cells[i] = g.turn; g.moves.push(i);
    const s0 = subOf(i);
    const w = lineWinner(g.cells, s0, cellGet(g, s0));
    if (w) g.sub[s0] = w.v; else { let full = true; for (let l = 0; l < 9; l++) if (g.cells[cellOf(s0, l)] === 0) { full = false; break; } if (full) g.sub[s0] = 2; }
    g.next = g.sub[localOf(i)] === 0 ? localOf(i) : -1;
    g.turn = -g.turn;
    const s = -negaUlt(g, depth - 1, -b, -a, ply + 1, me, clock);
    g.turn = before.turn; g.sub = before.sub; g.next = before.next; g.moves.pop(); g.cells[i] = 0;
    if (s > best) best = s;
    if (best > a) a = best;
    if (a >= b || clock.out) break;
  }
  return best;
}

/**
 * Choose a move for the side to move. { move, score } — move is a cell index
 * (null only when the game is over). `rng` is injectable for the play-tests.
 */
export function think(g, { level = 2, rng = Math.random, timeMs = 700 } = {}) {
  const moves = legalMoves(g);
  if (!moves.length) return { move: null, score: 0 };
  if (level <= 1) return { move: pick(moves, rng), score: 0 };
  if (!g.ult) {
    if (level === 2) {
      const w = winning(g, g.turn); if (w !== null) return { move: w, score: WIN };
      const bl = winning(g, -g.turn); if (bl !== null) return { move: bl, score: 0 };
      if (g.cells[4] === 0) return { move: 4, score: 0 };
      const corners = [0, 2, 6, 8].filter(i => g.cells[i] === 0);
      return { move: pick(corners.length ? corners : moves, rng), score: 0 };
    }
    const all = scoreMoves(g);
    const top = Math.max(...all.map(m => m.score));
    return { move: pick(all.filter(m => m.score === top), rng).move, score: top };
  }
  /* Ultimate */
  const me = g.turn;
  if (level === 2) {
    let best = -Infinity, bestMoves = [];
    for (const i of moves) {
      const t = copy(g);
      play(t, i);
      let s = evalUlt(t, me);
      const o = outcome(t);
      if (o.over && o.winner === me) s = WIN;
      else if (t.next !== -1 && t.sub[t.next] === 0) {
        /* does the reply board hand the opponent a small board? */
        const gift = legalMoves(t).some(j => { const u = copy(t); play(u, j); return u.sub[subOf(j)] === -me; });
        if (gift) s -= 25;
      }
      if (s > best + 1e-9) { best = s; bestMoves = [i]; } else if (Math.abs(s - best) <= 1e-9) bestMoves.push(i);
    }
    return { move: pick(bestMoves, rng), score: best };
  }
  const clock = { until: performance.now() + timeMs, out: false, n: 0 };
  let bestMove = pick(moves, rng), bestScore = -Infinity, doneDepth = 0;
  for (let depth = 1; depth <= 6; depth++) {
    let bm = null, bs = -Infinity;
    const order = moves.slice().sort((x, y) => (x === bestMove ? -1 : y === bestMove ? 1 : 0));
    for (const i of order) {
      const t = copy(g);
      play(t, i);
      const s = -negaUlt(t, depth - 1, -Infinity, -bs, 1, me, clock);
      if (clock.out) break;
      if (s > bs) { bs = s; bm = i; }
    }
    if (clock.out || bm === null) break;
    bestMove = bm; bestScore = bs; doneDepth = depth;
    if (Math.abs(bs) >= WIN - 20) break;
  }
  return { move: bestMove, score: bestScore, depth: doneDepth };
}

export default { newGame, copy, canPlay, legalMoves, play, undo, outcome, think, scoreMoves, subOf, localOf, cellOf, LINES, LEVELS };
