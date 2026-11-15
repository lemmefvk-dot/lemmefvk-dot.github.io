/* ============================================================
   arcade/tread-logic.js — the rules of Tread Duel, and the computer
   player (the game is ./tread.js; the suite plays this module too).

   Two tanks on an 11 × 9 yard seen from above, taking turns, one
   action each:
     · a direction (u r d l): the tank turns to face that way, and
       drives one square if the square is empty;
     · fire (f): a shell flies straight ahead and stops at the first
       thing it meets: a brick wall is knocked out, a steel block
       stops it, a tank loses one of its three health. A tank that has
       just fired is still reloading and cannot fire on its next action.
   Reduce the other tank to nothing to win. After 40 actions each, the
   tank with more health wins (the same health is a draw).

   The yard comes from the seed: bricks and steel placed on one half
   and turned half way round onto the other, so it is the same for
   both sides; the same seed is the same yard on every device. Side 0
   starts bottom left and moves first, side 1 top right.
   ============================================================ */
import { hash32 } from './challenge.js';
import { rng } from './kit.js';

export const W = 11, H = 9, HP = 3, MAX_PLIES = 80;
export const DIR = { u: 0, r: 1, d: 2, l: 3 };
export const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
export const ACTIONS = ['u', 'r', 'd', 'l', 'f'];
export const FLOOR = 0, BRICK = 1, STEEL = 2;
const idx = (x, y) => y * W + x;

export function yard(seed) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = rng(hash32(`staticos-tread:${seed >>> 0}:${attempt}`));
    const map = new Uint8Array(W * H);
    for (let i = 0; i < ((W * H) >> 1); i++) {
      const v = r();
      const k = v < 0.07 ? STEEL : v < 0.3 ? BRICK : FLOOR;
      map[i] = k; map[W * H - 1 - i] = k;
    }
    /* keep the starting corners clear */
    for (const [sx, sy] of [[1, 7], [9, 1]]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = sx + dx, y = sy + dy; if (x >= 0 && y >= 0 && x < W && y < H) map[idx(x, y)] = FLOOR; }
    /* the tanks must be able to reach each other round the steel (bricks can be shot, so they count as open) */
    const seen = new Set([idx(1, 7)]), q = [idx(1, 7)];
    while (q.length) {
      const c = q.pop(), cx = c % W, cy = (c / W) | 0;
      for (let d = 0; d < 4; d++) { const x = cx + DX[d], y = cy + DY[d]; if (x < 0 || y < 0 || x >= W || y >= H) continue; const n = idx(x, y); if (map[n] !== STEEL && !seen.has(n)) { seen.add(n); q.push(n); } }
    }
    if (seen.has(idx(9, 1))) return map;
  }
  return new Uint8Array(W * H);
}

export function newGame(seed = 1) {
  return { seed: seed >>> 0, map: yard(seed), tanks: [{ x: 1, y: 7, d: 0, hp: HP, reload: 0 }, { x: 9, y: 1, d: 2, hp: HP, reload: 0 }], turn: 0, n: 0, over: null, shot: null, acts: [0, 0] };
}

export function clone(G) {
  return { seed: G.seed, map: G.map.slice(), tanks: G.tanks.map(t => ({ ...t })), turn: G.turn, n: G.n, over: G.over ? { ...G.over } : null, shot: null, acts: G.acts.slice() };
}

const tankAt = (G, x, y) => (G.tanks[0].x === x && G.tanks[0].y === y ? 0 : G.tanks[1].x === x && G.tanks[1].y === y ? 1 : -1);

/** where a shell from `side` would end up: { kind: 'tank'|'brick'|'steel'|'edge', x, y, tank } (x, y: the last square it crosses) */
export function trace(G, side) {
  const t = G.tanks[side];
  let x = t.x, y = t.y;
  for (;;) {
    const nx = x + DX[t.d], ny = y + DY[t.d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return { kind: 'edge', x, y, tank: -1 };
    const m = G.map[idx(nx, ny)];
    if (m === STEEL) return { kind: 'steel', x: nx, y: ny, tank: -1 };
    if (m === BRICK) return { kind: 'brick', x: nx, y: ny, tank: -1 };
    const o = tankAt(G, nx, ny);
    if (o >= 0) return { kind: 'tank', x: nx, y: ny, tank: o };
    x = nx; y = ny;
  }
}

export function legal(G, side, a) {
  if (G.over || side !== G.turn || typeof a !== 'string' || !ACTIONS.includes(a)) return false;
  if (a === 'f') return G.tanks[side].reload === 0;
  return true;
}

/** play action a for `side`; false (and no change) if it is not legal */
export function apply(G, side, a) {
  if (!legal(G, side, a)) return false;
  const t = G.tanks[side];
  G.shot = null;
  if (t.reload > 0) t.reload--;
  if (a === 'f') {
    const r = trace(G, side);
    G.shot = { side, from: [t.x, t.y], to: [r.x, r.y], kind: r.kind };
    if (r.kind === 'brick') G.map[idx(r.x, r.y)] = FLOOR;
    else if (r.kind === 'tank') { G.tanks[r.tank].hp--; if (G.tanks[r.tank].hp <= 0) G.over = { winner: side, reason: 'destroyed' }; }
    t.reload = 1;       /* the next action cannot fire */
  } else {
    const d = DIR[a];
    t.d = d;
    const nx = t.x + DX[d], ny = t.y + DY[d];
    if (nx >= 0 && ny >= 0 && nx < W && ny < H && G.map[idx(nx, ny)] === FLOOR && tankAt(G, nx, ny) < 0) { t.x = nx; t.y = ny; }
  }
  G.acts[side]++;
  G.n++;
  G.turn = 1 - side;
  if (!G.over && G.n >= MAX_PLIES) {
    const a0 = G.tanks[0].hp, a1 = G.tanks[1].hp;
    G.over = { winner: a0 === a1 ? -1 : a0 > a1 ? 0 : 1, reason: 'turns' };
  }
  return true;
}

/* ---------------------------- the computer ---------------------------- */
const dist = (G) => Math.abs(G.tanks[0].x - G.tanks[1].x) + Math.abs(G.tanks[0].y - G.tanks[1].y);

/** how good the position is for `me`, from their health, who has a shot, and how near they are */
function evaluate(G, me) {
  const o = 1 - me;
  if (G.over) return G.over.winner === me ? 10000 - G.n : G.over.winner < 0 ? 0 : -10000 + G.n;
  let v = (G.tanks[me].hp - G.tanks[o].hp) * 120;
  const mine = trace(G, me), theirs = trace(G, o);
  if (mine.kind === 'tank') v += G.tanks[me].reload === 0 ? 40 : 15;
  if (theirs.kind === 'tank') v -= G.tanks[o].reload === 0 ? 40 : 15;
  v -= dist(G);
  return v;
}

function search(G, me, depth, alpha, beta) {
  if (depth === 0 || G.over) return evaluate(G, me);
  const side = G.turn;
  let best = side === me ? -Infinity : Infinity;
  for (const a of ACTIONS) {
    if (!legal(G, side, a)) continue;
    const c = clone(G); apply(c, side, a);
    const v = search(c, me, depth - 1, alpha, beta);
    if (side === me) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (beta <= alpha) break;
  }
  return best;
}

export const LEVELS = [{ id: 1, name: 'Easy', depth: 1 }, { id: 2, name: 'Normal', depth: 2 }, { id: 3, name: 'Hard', depth: 4 }];

/** the computer's action for the side to move: Easy looks one action ahead and sometimes wanders; Hard looks four */
export function aiMove(G, level = 2, r = Math.random) {
  const side = G.turn, L = LEVELS[Math.max(0, Math.min(2, level - 1))];
  const opts = ACTIONS.filter(a => legal(G, side, a));
  if (!opts.length) return null;
  if (level === 1 && r() < 0.25) return opts[Math.floor(r() * opts.length)];
  let best = -Infinity, pick = [];
  for (const a of opts) {
    const c = clone(G); apply(c, side, a);
    const v = search(c, side, L.depth - 1, -Infinity, Infinity) + r() * 0.5;
    if (v > best + 1e-9) { best = v; pick = [a]; } else if (Math.abs(v - best) <= 1e-9) pick.push(a);
  }
  return pick[Math.floor(r() * pick.length)] || opts[0];
}

export default { W, H, HP, yard, newGame, clone, trace, legal, apply, aiMove, LEVELS, ACTIONS };
