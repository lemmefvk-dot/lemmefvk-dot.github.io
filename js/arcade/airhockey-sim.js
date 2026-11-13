/* ============================================================
   arcade/airhockey-sim.js — the air hockey table and its computer
   player, with no graphics, so a game can be run (and measured)
   without a screen.

   The table is 800 × 440 units. Mallet 0 plays the left half and
   defends the left goal, mallet 1 the right. Each mallet chases a
   target point (a mouse, a key, or the computer) at a limited
   speed, so a mallet can only hit as hard as a hand can move; the
   puck leaves a mallet with the mallet's own velocity added. The
   puck slides with a little air drag, bounces off the rails and the
   goal posts, and a goal is the puck's centre past the end line.

   step(T, dt)           one fixed step (the game runs it at 1/240 s)
   resetPuck(T, side)    the puck rests on `side`'s half, waiting for a hit
   makeAI(level, seed)   a computer player; aiTarget(T, ai, side, dt)
                         says where its mallet should go next
   LEVELS                easy / medium / hard — measured in the tests
   ============================================================ */
import { rng } from './kit.js';

export const W = 800, H = 440;
export const PR = 16, MR = 30;
export const GY0 = 120, GY1 = 320;      /* the goal mouth, along the end rails */
export const POST_R = 5;
export const STEP = 1 / 240;
export const MAX_PUCK = 1700;
export const MALLET_V = 1800;           /* the fastest a mallet may travel */
const DRAG = 0.32;                       /* per second */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function newTable() {
  const T = {
    t: 0,
    puck: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
    m: [0, 1].map(i => ({ x: i ? W - 90 : 90, y: H / 2, vx: 0, vy: 0, tx: i ? W - 90 : 90, ty: H / 2 })),
    score: [0, 0],
    goal: null,                          /* 0 | 1: who just scored (set for one step) */
    ev: [],                              /* [{ kind: 'wall'|'hit'|'post'|'goal', x, y, p }] since the last drain */
  };
  return T;
}

export function resetPuck(T, side) {
  T.puck.x = side === 0 ? W / 4 + 20 : W - W / 4 - 20;
  T.puck.y = H / 2;
  T.puck.vx = 0; T.puck.vy = 0;
}

/* a mallet's allowed area: its own half of the table */
export const bounds = side => (side === 0
  ? { x0: MR, x1: W / 2 - MR, y0: MR, y1: H - MR }
  : { x0: W / 2 + MR, x1: W - MR, y0: MR, y1: H - MR });

function moveMallet(m, side, dt) {
  const b = bounds(side);
  const tx = clamp(m.tx, b.x0, b.x1), ty = clamp(m.ty, b.y0, b.y1);
  let dx = tx - m.x, dy = ty - m.y;
  const d = Math.hypot(dx, dy), cap = MALLET_V * dt;
  if (d > cap) { dx *= cap / d; dy *= cap / d; }
  m.x += dx; m.y += dy;
  m.vx = dx / dt; m.vy = dy / dt;
}

function hitMallet(T, m) {
  const p = T.puck, dx = p.x - m.x, dy = p.y - m.y, R = PR + MR, d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return false;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
  p.x = m.x + nx * R; p.y = m.y + ny * R;
  const vn = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  if (vn < 0) {
    const e = 0.9;
    p.vx -= (1 + e) * vn * nx; p.vy -= (1 + e) * vn * ny;
    T.ev.push({ kind: 'hit', x: p.x, y: p.y, p: Math.min(1, Math.hypot(p.vx, p.vy) / 1200) });
  }
  return true;
}

function hitPost(T, px, py) {
  const p = T.puck, dx = p.x - px, dy = p.y - py, R = PR + POST_R, d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
  p.x = px + nx * R; p.y = py + ny * R;
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) { p.vx -= 1.9 * vn * nx; p.vy -= 1.9 * vn * ny; T.ev.push({ kind: 'post', x: p.x, y: p.y, p: 0.6 }); }
}

export function step(T, dt = STEP) {
  T.t += dt;
  T.goal = null;
  moveMallet(T.m[0], 0, dt);
  moveMallet(T.m[1], 1, dt);
  const p = T.puck;
  const drag = Math.exp(-DRAG * dt);
  p.vx *= drag; p.vy *= drag;
  p.x += p.vx * dt; p.y += p.vy * dt;
  /* the long rails */
  if (p.y < PR) { p.y = PR; if (p.vy < 0) { p.vy = -p.vy * 0.92; T.ev.push({ kind: 'wall', x: p.x, y: p.y, p: Math.min(1, Math.abs(p.vy) / 900) }); } }
  if (p.y > H - PR) { p.y = H - PR; if (p.vy > 0) { p.vy = -p.vy * 0.92; T.ev.push({ kind: 'wall', x: p.x, y: p.y, p: Math.min(1, Math.abs(p.vy) / 900) }); } }
  /* the end rails, except in the goal mouths */
  const inMouth = p.y > GY0 && p.y < GY1;
  if (p.x < PR && !inMouth) { p.x = PR; if (p.vx < 0) { p.vx = -p.vx * 0.92; T.ev.push({ kind: 'wall', x: p.x, y: p.y, p: Math.min(1, Math.abs(p.vx) / 900) }); } }
  if (p.x > W - PR && !inMouth) { p.x = W - PR; if (p.vx > 0) { p.vx = -p.vx * 0.92; T.ev.push({ kind: 'wall', x: p.x, y: p.y, p: Math.min(1, Math.abs(p.vx) / 900) }); } }
  for (const x of [0, W]) { hitPost(T, x, GY0); hitPost(T, x, GY1); }
  hitMallet(T, T.m[0]);
  hitMallet(T, T.m[1]);
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > MAX_PUCK) { p.vx *= MAX_PUCK / sp; p.vy *= MAX_PUCK / sp; }
  /* a goal: the puck's centre past the end line, inside the mouth */
  if (p.x < -PR * 0.4) { T.goal = 1; T.score[1]++; T.ev.push({ kind: 'goal', x: 0, y: p.y, p: 1 }); }
  else if (p.x > W + PR * 0.4) { T.goal = 0; T.score[0]++; T.ev.push({ kind: 'goal', x: W, y: p.y, p: 1 }); }
}

/* ============================================================
   The computer player. It plays in its own frame (its goal at
   x = 0, defending the left) and the target is mirrored back for
   the right-hand side. It only sees the puck as it was `react`
   seconds ago, can only move its mallet `speed` units/s, and
   aims with an error of `aim` units, re-rolled for each attack.
   ============================================================ */
export const LEVELS = {
  easy:   { react: 0.26, speed: 650,  aim: 70, attack: 400, home: 70, bank: 0,   counter: false, label: 'Easy' },
  medium: { react: 0.19, speed: 880,  aim: 50, attack: 520, home: 66, bank: 0.1, counter: true,  label: 'Medium' },
  hard:   { react: 0.06, speed: 1500, aim: 18, attack: 700, home: 62, bank: 0.4, counter: true,  label: 'Hard' },
};

export function makeAI(level, seed = 1) {
  const L = typeof level === 'string' ? LEVELS[level] : level;
  return { L: { bank: 0, counter: false, ...L }, rnd: rng(seed), hist: [], engaged: false, bank: -1, gy: (GY0 + GY1) / 2 };
}

/* fold a straight path into the table between the long rails */
function fold(y) {
  const lo = PR, span = H - 2 * PR;
  let u = (y - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u <= span ? u : 2 * span - u);
}

/* where it wants to send the puck: a point in the opponent's goal mouth, or (sometimes) the
   mirror image of one past a long rail, so the puck banks off it */
function pickAim(ai) {
  const L = ai.L;
  const mouth = (GY0 + GY1) / 2;
  const gy = clamp(mouth + (ai.rnd() * 2 - 1) * (GY1 - GY0) / 2 * 0.7 + (ai.rnd() * 2 - 1) * L.aim, GY0 + 20, GY1 - 20);
  ai.bank = ai.rnd() < L.bank ? (ai.rnd() < 0.5 ? 0 : 1) : -1;
  ai.gy = ai.bank === 0 ? 2 * PR - gy : ai.bank === 1 ? 2 * (H - PR) - gy : gy;
  ai.engaged = true;
}

export function aiTarget(T, ai, side, dt) {
  const L = ai.L;
  const f = side === 0 ? 1 : -1;
  const lx = x => (side === 0 ? x : W - x);
  /* what it sees: the puck `react` seconds ago */
  ai.hist.push({ t: T.t, x: lx(T.puck.x), y: T.puck.y });
  while (ai.hist.length > 2 && ai.hist[1].t <= T.t - L.react) ai.hist.shift();
  const a = ai.hist[0], b = ai.hist[Math.min(1, ai.hist.length - 1)];
  const span = Math.max(1e-3, b.t - a.t);
  let px = a.x, py = a.y;
  let vx = (b.x - a.x) / span, vy = (b.y - a.y) / span;
  if (ai.hist.length < 3) { vx = f * T.puck.vx; vy = T.puck.vy; px = lx(T.puck.x); py = T.puck.y; }
  const me = { x: lx(T.m[side].x), y: T.m[side].y };
  const sp = Math.hypot(vx, vy);
  let tx, ty;
  const homeX = L.home + MR;
  const mouth = (GY0 + GY1) / 2;
  const onMyHalf = px < W / 2 - 4;
  const comingAtMe = vx < -40;
  const R = MR + PR;
  if (onMyHalf && sp < L.attack) {
    /* attack: line up behind the puck and drive it at their goal */
    if (!ai.engaged) pickAim(ai);
    let ux = W + 20 - px, uy = ai.gy - py;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const behind = (px - me.x) * ux + (py - me.y) * uy;          /* > 0: the puck is ahead of the mallet along the shot */
    const off = Math.abs((px - me.x) * uy - (py - me.y) * ux);     /* how far off the shot line the mallet sits */
    if (behind > 4 && off < MR * 0.9) {
      tx = px + ux * (R + 60); ty = py + uy * (R + 60);
    } else if (behind > 4) {
      tx = px - ux * (R + 6); ty = py - uy * (R + 6);
    } else {
      /* the mallet is level with or past the puck: swing round it first */
      const perpx = -uy, perpy = ux;
      const sgn = ((me.x - px) * perpx + (me.y - py) * perpy) >= 0 ? 1 : -1;
      tx = px - ux * (R + 30) + perpx * sgn * (R + 14);
      ty = py - uy * (R + 30) + perpy * sgn * (R + 14);
    }
  } else if (comingAtMe) {
    /* the puck is on its way: meet it where it will cross my line, angled to send it back where I choose */
    if (!ai.engaged) pickAim(ai);
    const ix = homeX + 34;
    const t = Math.max(0, (px - ix) / -vx);
    const iy = clamp(fold(py + vy * t), 20, H - 20);
    let ux = W + 20 - ix, uy = ai.gy - iy;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    /* never swing so far off the goal line that the mouth is left open */
    tx = ix - ux * R * 0.55; ty = iy - uy * R * 0.55;
    if (L.counter) { tx += ux * 26; ty += uy * 26; }
    ty = clamp(ty, GY0 - 40, GY1 + 40);
  } else {
    ai.engaged = false;
    /* wait in front of the goal, leaning toward the puck */
    tx = homeX; ty = clamp(mouth + (py - mouth) * 0.45, GY0 + 5, GY1 - 5);
  }
  tx = clamp(tx, MR, W / 2 - MR);
  ty = clamp(ty, MR, H - MR);
  return { x: side === 0 ? tx : W - tx, y: ty, speed: L.speed };
}

/* apply a computer target to a mallet: it moves at most `speed` units/s toward it */
export function aiDrive(T, side, tgt, dt) {
  const m = T.m[side];
  let dx = tgt.x - m.x, dy = tgt.y - m.y;
  const d = Math.hypot(dx, dy), cap = tgt.speed * dt;
  if (d > cap) { dx *= cap / d; dy *= cap / d; }
  m.tx = m.x + dx; m.ty = m.y + dy;
}

/* play a whole game headless: returns { score, time, goals }.
   `a` and `b` are controllers: { ai } (see makeAI) for the left and right mallet. */
export function playGame(left, right, { to = 7, maxSecs = 400, seed = 1 } = {}) {
  const T = newTable();
  resetPuck(T, seed & 1);
  let t = 0, pause = 0.8;
  const ctl = [left, right];
  while ((T.score[0] < to && T.score[1] < to) && t < maxSecs) {
    if (pause > 0) { pause -= STEP; } else {
      for (let s = 0; s < 2; s++) {
        const tgt = aiTarget(T, ctl[s], s, STEP);
        aiDrive(T, s, tgt, STEP);
      }
    }
    if (pause > 0) { T.m.forEach(m => { m.vx = m.vy = 0; }); } else step(T, STEP);
    t += STEP;
    if (T.goal !== null) {
      pause = 0.8;
      const scorer = T.goal;
      T.goal = null;
      resetPuck(T, scorer === 0 ? 1 : 0);        /* the side that conceded gets the puck */
      for (let s = 0; s < 2; s++) { ctl[s].hist.length = 0; ctl[s].engaged = false; }
    }
    T.ev.length = 0;
  }
  return { score: T.score.slice(), time: t };
}
