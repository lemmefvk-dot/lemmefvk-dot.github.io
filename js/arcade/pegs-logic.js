/* ============================================================
   arcade/pegs-logic.js — the rules of Peg Drop, with no screen in them
   (the game is ./pegs.js; the suite plays this module too).

   A board of pegs (400 × 560), ten balls, ten slots along the bottom.
   You choose where each ball is dropped from; physics does the rest:
   it bounces down through the pegs into a slot, and the slot's number
   is your score. A few green pegs add 1 the first time a ball touches
   them. Up to three balls can be on the board at once.

   The slot numbers come from the seed (the same seed is the same
   board, pegs and numbers, on any device); the bounces come from the
   rules and a seeded nudge on every peg hit, so a round is fixed 1/60 s
   steps (4 sub-steps each) and its log of ['d', x] drops plays it
   again exactly.
   ============================================================ */
import { hash32 } from './challenge.js';
import { rng } from './kit.js';
import { nextRand, replayLog } from './sim-core.js';

export const VW = 400, VH = 560;
export const BALLS = 10, MAX_LIVE = 3;
export const BR = 6, PR = 5, SLOTS = 10, SLOT_W = 40, FLOOR = 480, REST = 548;
export const GRAV = 900, E = 0.55, SUB = 4;

const cache = new Map();
/** the board of a seed: { pegs: [{ x, y, bonus (index or -1) }], values: [10] } */
export function board(seed) {
  const key = seed >>> 0;
  let b = cache.get(key);
  if (b) return b;
  const r = rng(hash32(`staticos-pegs:${key}`));
  const pegs = [];
  for (let row = 0; row < 10; row++) {
    const y = 110 + row * 36;
    if (row % 2 === 0) for (let i = 0; i < 10; i++) pegs.push({ x: 20 + i * 40, y, bonus: -1 });
    else for (let i = 0; i < 9; i++) pegs.push({ x: 40 + i * 40, y, bonus: -1 });
  }
  /* six green pegs, never in the first or last row */
  const pool = pegs.map((p, i) => i).filter(i => pegs[i].y > 120 && pegs[i].y < 400);
  for (let k = 0; k < 6; k++) { const at = Math.floor(r() * pool.length); pegs[pool[at]].bonus = k; pool.splice(at, 1); }
  /* the slot numbers: high at the edges, low in the middle, a few swapped around by the seed */
  const values = [10, 5, 3, 2, 1, 1, 2, 3, 5, 10];
  for (let k = 0; k < 4; k++) { const a = Math.floor(r() * SLOTS), c = Math.floor(r() * SLOTS); [values[a], values[c]] = [values[c], values[a]]; }
  b = { pegs, values };
  if (cache.size > 100) cache.clear();
  cache.set(key, b);
  return b;
}

export function create(seed = 1) {
  const s = { seed: seed >>> 0, r: hash32(`staticos-pegs-r:${seed >>> 0}`) || 1, t: 0, over: false, ev: [], dropped: 0, score: 0, landed: 0, slots: new Array(SLOTS).fill(0),
    balls: Array.from({ length: MAX_LIVE }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, hit: 0, bumps: 0 })), b: null, last: 0 };
  s.b = board(seed);
  return s;
}

export function live(s) { let n = 0; for (let i = 0; i < s.balls.length; i++) if (s.balls[i].on) n++; return n; }

/** 'd' x: drop a ball from x (10 to 390) */
export function act(s, code, x) {
  if (code !== 'd' || s.over || !Number.isFinite(x) || s.dropped >= BALLS || live(s) >= MAX_LIVE) return false;
  const ball = s.balls.find(q => !q.on);
  ball.on = true; ball.x = Math.max(12, Math.min(388, x)); ball.y = 40; ball.vx = 0; ball.vy = 0; ball.hit = 0; ball.bumps = 0;
  s.dropped++;
  s.ev.push({ type: 'drop', x: ball.x });
  return true;
}

function bounce(s, ball, px, py, pr, bonus) {
  const dx = ball.x - px, dy = ball.y - py, rr = BR + pr, d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
  ball.x = px + nx * rr; ball.y = py + ny * rr;
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn < 0) {
    ball.vx -= (1 + E) * vn * nx; ball.vy -= (1 + E) * vn * ny;
    ball.vx += (nextRand(s) - 0.5) * 24;            /* so nothing balances on a peg */
    if (pr === PR) s.ev.push({ type: 'peg', bonus: bonus >= 0 });
  }
  if (bonus >= 0 && !(ball.hit & (1 << bonus))) { ball.hit |= 1 << bonus; ball.bumps++; s.score++; s.ev.push({ type: 'bonus', x: px, y: py }); }
}

export function step(s) {
  if (s.over) return;
  s.t++;
  const dt = 1 / 60 / SUB;
  const pegs = s.b.pegs;
  for (let q = 0; q < s.balls.length; q++) {
    const ball = s.balls[q];
    if (!ball.on) continue;
    for (let k = 0; k < SUB; k++) {
      ball.vy += GRAV * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      if (ball.y < FLOOR + BR) {
        if (ball.y > 80) for (let i = 0; i < pegs.length; i++) {
          const p = pegs[i];
          if (p.y < ball.y - 20 || p.y > ball.y + 20) continue;
          bounce(s, ball, p.x, p.y, PR, p.bonus);
        }
        if (ball.y > FLOOR - 12) for (let i = 0; i <= SLOTS; i++) bounce(s, ball, i * SLOT_W, FLOOR, 4, -1);
        if (ball.x < BR) { ball.x = BR; ball.vx = Math.abs(ball.vx) * 0.5; }
        else if (ball.x > VW - BR) { ball.x = VW - BR; ball.vx = -Math.abs(ball.vx) * 0.5; }
      } else {
        /* inside a slot: the dividers are walls */
        const slot = Math.min(SLOTS - 1, Math.max(0, Math.floor(ball.x / SLOT_W)));
        const lo = slot * SLOT_W + BR, hi = (slot + 1) * SLOT_W - BR;
        if (ball.x < lo) { ball.x = lo; ball.vx = Math.abs(ball.vx) * 0.3; } else if (ball.x > hi) { ball.x = hi; ball.vx = -Math.abs(ball.vx) * 0.3; }
        ball.vx *= 0.98;
        if (ball.y >= REST) {
          ball.on = false;
          const v = s.b.values[slot];
          s.score += v; s.landed++; s.slots[slot]++; s.last = v;
          s.ev.push({ type: 'slot', slot, value: v, bumps: ball.bumps });
          break;
        }
      }
    }
  }
  if (s.dropped >= BALLS && live(s) === 0) s.over = true;
}

export const score = s => s.score;
export const replay = (seed, log, until) => replayLog({ create, step, act }, seed, log, until);
export default { VW, VH, board, create, step, act, score, replay, live };
