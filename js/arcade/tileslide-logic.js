/* ============================================================
   arcade/tileslide-logic.js — the rules of Tile Slide Race, with no
   screen in them (the game is ./tileslide.js; the suite plays this
   module too).

   A 5 × 5 board of tiles in five colours. A move pushes one whole row
   or column one step; the tile pushed off one end comes back on the
   other. Three or more of a colour in a line clear. Cleared squares
   fill from the round's seeded stream, in reading order, so a seed
   always deals the same board and the same refills, and clears can
   chain: each chain step pays more than the one before.

   Points for one step of a chain: 10 × tiles cleared × the step's
   number (1, 2, 3…). A round is MOVES moves long.
   ============================================================ */
import { rng } from './kit.js';

export const N = 5;
export const COLORS = 5;
export const MOVES = 20;
const MAX_STEPS = 12;

/** a game from a seed: the board has no clear waiting in it */
export function newGame(seed = 1, moves = MOVES) {
  const next = rng(seed >>> 0);
  const draw = () => Math.floor(next() * COLORS);
  const cells = new Array(N * N).fill(-1);
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = Math.floor(i / N);
    let c = draw(), guard = 0;
    while (guard++ < 50 && ((x >= 2 && cells[i - 1] === c && cells[i - 2] === c) || (y >= 2 && cells[i - N] === c && cells[i - 2 * N] === c))) c = draw();
    cells[i] = c;
  }
  return { seed: seed >>> 0, cells, draw, moves, left: moves, score: 0, cleared: 0, bestChain: 0, log: [] };
}

/** the cells that sit in a line of three or more of one colour */
export function findLines(cells) {
  const mark = new Set();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N;) {
      const c = cells[y * N + x];
      let e = x + 1;
      while (e < N && cells[y * N + e] === c) e++;
      if (c >= 0 && e - x >= 3) for (let k = x; k < e; k++) mark.add(y * N + k);
      x = e;
    }
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N;) {
      const c = cells[y * N + x];
      let e = y + 1;
      while (e < N && cells[e * N + x] === c) e++;
      if (c >= 0 && e - y >= 3) for (let k = y; k < e; k++) mark.add(k * N + x);
      y = e;
    }
  }
  return [...mark].sort((a, b) => a - b);
}

/** push row (axis 'r') or column (axis 'c') `index` one step: dir +1 = right/down, -1 = left/up */
export function shiftLine(cells, axis, index, dir) {
  const out = cells.slice();
  for (let k = 0; k < N; k++) {
    const from = axis === 'r' ? index * N + k : k * N + index;
    const to = axis === 'r' ? index * N + ((k + dir + N) % N) : (((k + dir + N) % N) * N + index);
    out[to] = cells[from];
  }
  return out;
}

/**
 * Make a move. Returns { ok, gained, steps: [{ cells, points }], cells } or { ok: false }.
 * A move that clears nothing is still a move: it rearranges the board and spends one.
 */
export function push(g, axis, index, dir) {
  if (g.left <= 0 || (axis !== 'r' && axis !== 'c') || !Number.isInteger(index) || index < 0 || index >= N || (dir !== 1 && dir !== -1)) return { ok: false };
  g.cells = shiftLine(g.cells, axis, index, dir);
  g.left--;
  const steps = [];
  let gained = 0;
  for (let s = 1; s <= MAX_STEPS; s++) {
    const hit = findLines(g.cells);
    if (!hit.length) break;
    const points = 10 * hit.length * s;
    gained += points;
    g.cleared += hit.length;
    steps.push({ cells: hit, points });
    for (const i of hit) g.cells[i] = g.draw();
  }
  g.score += gained;
  g.bestChain = Math.max(g.bestChain, steps.length);
  g.log.push([axis === 'r' ? 0 : 1, index, dir]);
  return { ok: true, gained, steps, cells: g.cells };
}

/** the move that clears the most tiles right now, or null (the hint, and the suite's bot) */
export function bestMove(g) {
  let best = null;
  for (const axis of ['r', 'c']) for (let i = 0; i < N; i++) for (const dir of [1, -1]) {
    const n = findLines(shiftLine(g.cells, axis, i, dir)).length;
    if (n && (!best || n > best.n)) best = { axis, index: i, dir, n };
  }
  return best;
}

export default { N, COLORS, MOVES, newGame, findLines, shiftLine, push, bestMove };
