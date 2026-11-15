/* ============================================================
   arcade/cannoncrush-rules.js — the rules, the physics and the
   computer of Cannon Crush, no DOM.

   Two cannons on one hill, 800 × 400 units, y counting down. The
   hill is a height for every whole x (top[x]), made from a seed:
   the same seed is the same hill on every device. A turn is one
   shot: an angle (5–85 degrees above the horizon, towards the
   other cannon) and a power (10–100). The shell flies under
   gravity and a wind that changes after every shot, in fixed steps
   of 1/120 s, and bursts where it meets the ground, a cannon, or
   leaves the side of the world (a miss). A burst digs a round
   crater (the hill is lowered; both cannons settle onto what is
   left of it) and hurts any cannon near it: a direct hit costs
   34 of its 100 health, so three direct hits win, and a near miss
   costs up to 20. After 12 shots each, the cannon with more health
   wins (equal health: a draw).

   DETERMINISM. A shot is decided by (state, angle, power) alone —
   only + − × ÷ and sqrt on numbers, sines and cosines from a
   table of whole degrees rounded to 6 places — so two devices that
   apply the same shots in the same order hold the same hill. The
   only random draw is the next wind, taken once per shot from the
   state's own generator.

   The computer (aiShot) tries a grid of angles and powers on a
   copy of the world, takes the one that bursts nearest the other
   cannon (and not on its own), and then misses by a random amount
   that depends on its level: Easy a lot, Medium some, Hard a
   little.
   ============================================================ */
import { rng } from './kit.js';

export const W = 800, H = 400;
export const MAX_SHOTS = 12;
export const HP = 100;
export const DIRECT = 34;
export const CRATER = 30;
export const LEVELS = { 1: { name: 'Easy', da: 9, dp: 14 }, 2: { name: 'Medium', da: 4, dp: 6 }, 3: { name: 'Hard', da: 1, dp: 2 } };
const G = 380, DT = 1 / 120, SPEED = 5.85, MAX_STEPS = 2600;
const BODY = 14;                 /* a shell this close to a cannon's middle is a direct hit */
const SPLASH = CRATER + 16;
const COS = [], SIN = [];
for (let a = 0; a <= 90; a++) { COS[a] = Math.round(Math.cos((a * Math.PI) / 180) * 1e6) / 1e6; SIN[a] = Math.round(Math.sin((a * Math.PI) / 180) * 1e6) / 1e6; }
export const cannonX = [90, W - 90];

/** a hill from a seed: midpoint displacement, then flattened where the cannons stand */
export function makeTop(seed) {
  const r = rng(seed >>> 0);
  const top = new Float64Array(W);
  const pts = new Float64Array(129);
  pts[0] = 270 + r() * 40; pts[128] = 270 + r() * 40;
  let amp = 90;
  for (let step = 64; step >= 1; step >>= 1) {
    for (let i = step; i < 128; i += step * 2) pts[i] = (pts[i - step] + pts[i + step]) / 2 + (r() * 2 - 1) * amp;
    amp *= 0.55;
  }
  for (let x = 0; x < W; x++) {
    const f = (x / (W - 1)) * 128, i = Math.min(127, Math.floor(f)), u = f - i, s = u * u * (3 - 2 * u);
    top[x] = Math.max(170, Math.min(340, pts[i] * (1 - s) + pts[i + 1] * s));
  }
  for (const cx of cannonX) {
    let sum = 0, n = 0;
    for (let x = cx - 26; x <= cx + 26; x++) { sum += top[x]; n++; }
    const flat = sum / n;
    for (let x = cx - 40; x <= cx + 40; x++) { const k = Math.min(1, Math.max(0, (Math.abs(x - cx) - 26) / 14)); top[x] = flat * (1 - k) + top[x] * k; }
  }
  return top;
}
const windFrom = r => Math.round((r() * 2 - 1) * 40);

/** a new game: first = which cannon (0 left, 1 right) shoots first */
export function newGame(seed, first = 0) {
  const rand = rng((seed ^ 0x9e3779b9) >>> 0);
  const top = makeTop(seed);
  const g = { seed: seed >>> 0, top, rand, cannons: [{ x: cannonX[0], y: top[cannonX[0]], hp: HP }, { x: cannonX[1], y: top[cannonX[1]], hp: HP }], turn: first, shots: [0, 0], wind: 0, over: null, log: [] };
  g.wind = windFrom(rand);
  return g;
}
export function clone(g) {
  return { seed: g.seed, top: g.top.slice(), rand: g.rand, cannons: g.cannons.map(c => ({ ...c })), turn: g.turn, shots: g.shots.slice(), wind: g.wind, over: g.over, log: g.log.slice() };
}
export const dirOf = i => (i === 0 ? 1 : -1);
export const settle = g => { for (const c of g.cannons) c.y = g.top[c.x]; };
/** where the barrel's mouth is for cannon i at this angle */
export function muzzle(g, i, a) {
  const c = g.cannons[i], d = dirOf(i);
  return [c.x + d * COS[a] * 17, c.y - 8 - SIN[a] * 17];
}

/** fly a shell without changing the world: { path: [[x, y]…], x, y, kind: 'ground'|'cannon'|'out', hit: cannon index or -1, steps } */
export function flight(g, i, a, p) {
  const d = dirOf(i);
  let [x, y] = muzzle(g, i, a);
  const v = p * SPEED;
  let vx = d * COS[a] * v, vy = -SIN[a] * v;
  const path = [[x, y]];
  const ax = g.wind;
  for (let s = 1; s <= MAX_STEPS; s++) {
    vx += ax * DT; vy += G * DT;
    x += vx * DT; y += vy * DT;
    if (s % 3 === 0) path.push([x, y]);
    if (x < 0 || x >= W) { path.push([Math.max(0, Math.min(W - 1, x)), y]); return { path, x, y, kind: 'out', hit: -1, steps: s }; }
    for (let k = 0; k < 2; k++) {
      const c = g.cannons[k];
      if (c.hp <= 0 || (s < 20 && k === i)) continue;
      if (Math.hypot(x - c.x, y - (c.y - 7)) <= BODY) { path.push([x, y]); return { path, x, y, kind: 'cannon', hit: k, steps: s }; }
    }
    if (y >= g.top[Math.floor(x)]) { path.push([x, y]); return { path, x, y, kind: 'ground', hit: -1, steps: s }; }
  }
  return { path, x, y, kind: 'out', hit: -1, steps: MAX_STEPS };
}

/** dig a crater at (x, y) */
export function dig(g, x, y) {
  const x0 = Math.max(0, Math.floor(x - CRATER)), x1 = Math.min(W - 1, Math.ceil(x + CRATER));
  for (let i = x0; i <= x1; i++) {
    const dx = i - x;
    if (Math.abs(dx) > CRATER) continue;
    const bottom = y + Math.sqrt(CRATER * CRATER - dx * dx);
    if (bottom > g.top[i]) g.top[i] = Math.min(H - 4, bottom);
  }
}
const damageAt = (g, x, y) => g.cannons.map(c => {
  const d = Math.hypot(x - c.x, y - (c.y - 7));
  return d <= BODY + 2 ? DIRECT : d < SPLASH ? Math.ceil(20 * (SPLASH - d) / (SPLASH - BODY - 2)) : 0;
});

export const legalShot = (a, p) => Number.isInteger(a) && Number.isInteger(p) && a >= 5 && a <= 85 && p >= 10 && p <= 100;

/** the current cannon fires: changes the world and returns { flight, dmg: [d0, d1], by, wind (before the shot) } or null if it isn't legal */
export function fire(g, a, p) {
  if (g.over || !legalShot(a, p)) return null;
  const i = g.turn, wind = g.wind;
  const f = flight(g, i, a, p);
  let dmg = [0, 0];
  if (f.kind !== 'out') {
    dmg = damageAt(g, f.x, f.y);
    dig(g, f.x, f.y);
    settle(g);
  }
  g.cannons.forEach((c, k) => { c.hp = Math.max(0, c.hp - dmg[k]); });
  g.shots[i]++;
  g.log.push([i, a, p]);
  g.wind = windFrom(g.rand);
  g.turn = 1 - i;
  const dead = g.cannons.map(c => c.hp <= 0);
  if (dead[0] || dead[1]) g.over = { winner: dead[0] && dead[1] ? -1 : dead[0] ? 1 : 0, reason: dead[0] && dead[1] ? 'both' : 'destroyed' };
  else if (g.shots[0] >= MAX_SHOTS && g.shots[1] >= MAX_SHOTS) {
    const [h0, h1] = [g.cannons[0].hp, g.cannons[1].hp];
    g.over = { winner: h0 === h1 ? -1 : h0 > h1 ? 0 : 1, reason: 'shots' };
  }
  return { flight: f, dmg, by: i, wind };
}

/** a hash of the hill, for tests and for comparing two devices */
export function hillHash(g) {
  let h = 0x811c9dc5;
  for (let x = 0; x < W; x += 1) { h ^= Math.round(g.top[x] * 8); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** the computer's shot for the cannon whose turn it is: { a, p } (angle, power) */
export function aiShot(g, level = 2, rand = Math.random) {
  const me = g.turn, foe = 1 - me, L = LEVELS[level] || LEVELS[2];
  const fc = g.cannons[foe], mc = g.cannons[me];
  let best = null;
  const tryShot = (a, p) => {
    const f = flight(g, me, a, p);
    if (f.kind === 'out') return;
    const dFoe = Math.hypot(f.x - fc.x, f.y - (fc.y - 7)), dSelf = Math.hypot(f.x - mc.x, f.y - (mc.y - 7));
    const v = dFoe + (dSelf < SPLASH + 8 ? 400 : 0);
    if (!best || v < best.v) best = { a, p, v };
  };
  for (let a = 15; a <= 80; a += 3) for (let p = 20; p <= 100; p += 4) tryShot(a, p);
  if (!best) return { a: 45, p: 60 };
  /* refine around the best coarse one */
  const c = best;
  for (let a = c.a - 3; a <= c.a + 3; a++) for (let p = c.p - 4; p <= c.p + 4; p++) if (legalShot(a, p)) tryShot(a, p);
  const jitter = k => Math.round((rand() * 2 - 1) * k);
  const a = Math.max(5, Math.min(85, best.a + jitter(L.da))), p = Math.max(10, Math.min(100, best.p + jitter(L.dp)));
  return { a, p };
}

export default { W, H, MAX_SHOTS, HP, LEVELS, makeTop, newGame, clone, flight, fire, dig, aiShot, legalShot, hillHash, muzzle, dirOf };
