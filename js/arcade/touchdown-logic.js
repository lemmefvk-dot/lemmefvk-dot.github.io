/* ============================================================
   arcade/touchdown-logic.js — the rules of Soft Touchdown, with no
   screen in them (the game is ./touchdown.js; the suite plays this
   module too, including an autopilot that lands every level it makes).

   A small lander falls toward a moon of rolling ground (640 × 400).
   Left and right turn it, thrust burns fuel (500 units, 30 a second)
   and pushes along the way it points; gravity is 45 a second. Touch
   the ground on a flat pad slowly (sideways at most 25, down at most
   45) and nearly upright (0.3 rad) and you have landed: the pad's
   multiplier times 100 plus a quarter of the fuel left. A little fuel
   is added for the next moon, whose ground is rougher and whose pads
   are narrower. Hit anything else, or the pad too hard, and it is over.

   The ground of moon n comes from the seed and n only. A round is
   fixed 1/60 s steps and a log of ['k', held keys] changes
   (1 left, 2 right, 4 thrust): the log plays it again exactly.
   ============================================================ */
import { hash32 } from './challenge.js';
import { rng } from './kit.js';
import { nextRand, replayLog } from './sim-core.js';

export const VW = 640, VH = 400;
export const COLS = 41, SEG = 16;
export const GRAVITY = 45, THRUST = 120, TURN = 2.4, BURN = 30, FUEL0 = 400, FUEL_MAX = 500, REFUEL = 160;
export const MAX_VX = 25, MAX_VY = 45, MAX_ANGLE = 0.3, R = 9;
export const HOLD = 90;                       /* steps to enjoy a landing before the next moon */

const cache = new Map();
/** moon n of a seed: { ground: heights at every SEG, pads: [{ x0, x1, y, mult }] } */
export function moon(seed, n) {
  const key = `${seed >>> 0}:${n}`;
  let m = cache.get(key);
  if (m) return m;
  const r = rng(hash32(`staticos-moon:${seed >>> 0}:${n}`));
  const ground = new Array(COLS);
  let y = 270 + r() * 70;
  const rough = Math.min(46, 18 + n * 4);
  for (let i = 0; i < COLS; i++) {
    y += (r() - 0.5) * rough * 2;
    y = Math.max(210, Math.min(370, y));
    ground[i] = y;
  }
  /* the pads: wide (x1), and from the third moon a narrow one worth 3 */
  const wide = Math.max(3, 5 - Math.floor(n / 3));
  const pads = [];
  const place = (segs, mult, notBefore, notAfter) => {
    const i0 = notBefore + Math.floor(r() * Math.max(1, notAfter - notBefore - segs));
    const yy = ground[i0];
    for (let i = i0; i <= i0 + segs; i++) ground[i] = yy;
    pads.push({ x0: i0 * SEG, x1: (i0 + segs) * SEG, y: yy, mult });
  };
  if (n >= 2) { place(wide, 1, 2, 19); place(2, 3, 22, COLS - 3); } else place(wide, 1, 3, COLS - 4);
  m = { n, ground, pads };
  if (cache.size > 200) cache.clear();
  cache.set(key, m);
  return m;
}

export const groundAt = (m, x) => {
  const f = Math.max(0, Math.min(COLS - 1.0001, x / SEG)), i = Math.floor(f);
  return m.ground[i] + (m.ground[i + 1] - m.ground[i]) * (f - i);
};

function spawn(s) {
  s.moon = moon(s.seed, s.level);
  s.x = 80 + nextRand(s) * 480; s.y = 40; s.vx = (nextRand(s) - 0.5) * 50; s.vy = 0; s.a = 0;
  s.phase = 'fly'; s.hold = 0; s.thrusting = false;
}

export function create(seed = 1) {
  const s = { seed: seed >>> 0, r: hash32(`staticos-td:${seed >>> 0}`) || 1, t: 0, over: false, ev: [], keys: 0, level: 1, landings: 0, score: 0, fuel: FUEL0, crashed: '', best: 0 };
  spawn(s);
  return s;
}

export function act(s, code, mask) {
  if (code !== 'k' || !Number.isInteger(mask) || mask < 0 || mask > 7) return false;
  s.keys = mask;
  return true;
}

export function step(s) {
  if (s.over) return;
  s.t++;
  if (s.phase === 'landed') {
    if (++s.hold >= HOLD) { s.level++; s.fuel = Math.min(FUEL_MAX, s.fuel + REFUEL); spawn(s); s.ev.push({ type: 'moon', level: s.level }); }
    return;
  }
  const dt = 1 / 60;
  if (s.keys & 1) s.a -= TURN * dt;
  if (s.keys & 2) s.a += TURN * dt;
  if (s.a > Math.PI) s.a -= 2 * Math.PI; else if (s.a < -Math.PI) s.a += 2 * Math.PI;
  let ax = 0, ay = 0;
  s.thrusting = false;
  if ((s.keys & 4) && s.fuel > 0) {
    ax = Math.sin(s.a) * THRUST; ay = -Math.cos(s.a) * THRUST;
    s.fuel = Math.max(0, s.fuel - BURN * dt);
    s.thrusting = true;
  }
  s.vx += ax * dt; s.vy += (ay + GRAVITY) * dt;
  s.x += s.vx * dt; s.y += s.vy * dt;
  if (s.x < R) { s.x = R; s.vx = 0; } else if (s.x > VW - R) { s.x = VW - R; s.vx = 0; }
  if (s.y < R) { s.y = R; if (s.vy < 0) s.vy = 0; }
  const m = s.moon;
  const gy = Math.max(groundAt(m, s.x - 6), groundAt(m, s.x), groundAt(m, s.x + 6));
  if (s.y + R >= gy) {
    const pad = m.pads.find(p => s.x - 6 >= p.x0 && s.x + 6 <= p.x1);
    const upright = Math.abs(s.a) <= MAX_ANGLE, slow = Math.abs(s.vx) <= MAX_VX && s.vy <= MAX_VY;
    if (pad && upright && slow) {
      const pts = pad.mult * (100 + Math.floor(s.fuel / 4));
      s.score += pts; s.landings++; s.phase = 'landed'; s.hold = 0; s.y = pad.y - R; s.vx = 0; s.vy = 0; s.a = 0; s.thrusting = false;
      s.ev.push({ type: 'land', pts, mult: pad.mult });
    } else {
      s.over = true; s.phase = 'crashed'; s.thrusting = false;
      s.crashed = !pad ? 'ground' : !upright ? 'tilt' : s.vy > MAX_VY ? 'fast' : 'sideways';
      s.ev.push({ type: 'crash', why: s.crashed });
    }
  }
}

export const score = s => s.score;
export const replay = (seed, log, until) => replayLog({ create, step, act }, seed, log, until);

/** the autopilot the suite uses to show every moon can be landed: which keys to hold now (a number for act(s, 'k', …)) */
export function autopilot(s) {
  const pad = s.moon.pads.reduce((b, p) => (!b || Math.abs((p.x0 + p.x1) / 2 - s.x) < Math.abs((b.x0 + b.x1) / 2 - s.x) ? p : b), null);
  const px = (pad.x0 + pad.x1) / 2, h = pad.y - R - s.y;
  const dx = px - s.x;
  const wantVx = Math.abs(dx) < 8 ? 0 : Math.max(-30, Math.min(30, dx * 0.4));
  let wantA = Math.max(-0.3, Math.min(0.3, (wantVx - s.vx) * 0.02));
  if (h < 40) wantA = 0;
  const wantVy = Math.abs(dx) > 14 && h < 130 ? -8 : Math.max(12, Math.min(40, h * 0.3));
  let mask = 0;
  if (s.a < wantA - 0.04) mask |= 2; else if (s.a > wantA + 0.04) mask |= 1;
  if ((s.vy > wantVy && Math.abs(s.a) < 0.8) || (s.y + R > pad.y - 14 && s.vy > 20)) mask |= 4;
  return mask;
}
export default { VW, VH, create, step, act, score, replay, moon, groundAt, autopilot };
