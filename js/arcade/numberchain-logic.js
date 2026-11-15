/* ============================================================
   arcade/numberchain-logic.js — the rules of Number Chain, with no
   screen in them (the game is ./numberchain.js).

   A 6 × 6 board of digits 1 to 9. Join two to four neighbours —
   squares that touch along a side, each used once, in a path — whose
   digits add up to exactly ten, and they clear. The squares above
   fall down, and new digits come in at the top from the round's
   seeded stream, so a seed always deals the same board and the same
   digits. If the board ever has no ten left in it, it is dealt again
   from the same stream.

   Points for a clear: 10 for two digits, 30 for three, 60 for four,
   plus 5 for every clear before it that came inside the combo window
   (up to 6 of them).
   ============================================================ */
import { rng } from './kit.js';

export const W = 6;
export const H = 6;
export const TARGET = 10;
export const MAX_LEN = 4;
export const BASE = { 2: 10, 3: 30, 4: 60 };
export const COMBO_MS = 3000;

const adjacent = (a, b) => {
  const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
};
export const areNeighbours = adjacent;

export function newGame(seed = 1) {
  const next = rng(seed >>> 0);
  const g = { seed: seed >>> 0, cells: new Array(W * H).fill(0), draw: () => 1 + Math.floor(next() * 9), score: 0, pairs: 0, longest: 0, dealt: 0 };
  deal(g);
  return g;
}

/** fill the board; deal again (the same stream) until a ten can be made */
function deal(g) {
  for (let tries = 0; tries < 40; tries++) {
    for (let i = 0; i < W * H; i++) g.cells[i] = g.draw();
    g.dealt++;
    if (hasMove(g.cells)) return;
  }
}

/** a path of 2–4 neighbours that adds to ten, as the cells' indexes, or null */
export function findMove(cells) {
  const walk = (path, sum) => {
    if (sum === TARGET && path.length >= 2) return path.slice();
    if (path.length >= MAX_LEN || sum >= TARGET) return null;
    const last = path[path.length - 1], x = last % W, y = Math.floor(last / W);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (path.includes(n) || cells[n] <= 0) continue;
      path.push(n);
      const r = walk(path, sum + cells[n]);
      path.pop();
      if (r) return r;
    }
    return null;
  };
  for (let i = 0; i < W * H; i++) { const r = walk([i], cells[i]); if (r) return r; }
  return null;
}
export const hasMove = cells => !!findMove(cells);

/** is this path a legal clear? ({ ok, sum, why }) */
export function check(cells, path) {
  if (!Array.isArray(path) || path.length < 2 || path.length > MAX_LEN) return { ok: false, why: 'length' };
  if (new Set(path).size !== path.length) return { ok: false, why: 'repeat' };
  let sum = 0;
  for (let k = 0; k < path.length; k++) {
    const c = path[k];
    if (!Number.isInteger(c) || c < 0 || c >= W * H) return { ok: false, why: 'off' };
    if (k && !adjacent(path[k - 1], c)) return { ok: false, why: 'apart' };
    sum += cells[c];
  }
  return sum === TARGET ? { ok: true, sum } : { ok: false, sum, why: 'sum' };
}

/** clear a path that adds to ten: the columns fall, new digits come in. combo = clears just before this one in the window */
export function clear(g, path, combo = 0) {
  const c = check(g.cells, path);
  if (!c.ok) return { ok: false, ...c };
  const gained = BASE[path.length] + 5 * Math.min(6, Math.max(0, combo));
  for (const i of path) g.cells[i] = 0;
  /* gravity, column by column: what is left drops, the gaps at the top fill from the stream */
  for (let x = 0; x < W; x++) {
    const keep = [];
    for (let y = H - 1; y >= 0; y--) if (g.cells[y * W + x] > 0) keep.push(g.cells[y * W + x]);
    for (let y = H - 1, k = 0; y >= 0; y--, k++) g.cells[y * W + x] = k < keep.length ? keep[k] : 0;
  }
  for (let x = 0; x < W; x++) for (let y = H - 1; y >= 0; y--) if (g.cells[y * W + x] === 0) g.cells[y * W + x] = g.draw();
  g.score += gained;
  g.pairs++;
  g.longest = Math.max(g.longest, path.length);
  let redealt = false;
  if (!hasMove(g.cells)) { deal(g); redealt = true; }
  return { ok: true, gained, redealt, cells: g.cells };
}

export default { W, H, TARGET, MAX_LEN, newGame, findMove, hasMove, check, clear, areNeighbours };
