/* ============================================================
   arcade/pool-sim.js — the physics of the pool table, with no
   drawing, so it can be tested (and played by the computer) on
   its own.

   The playfield is 800 × 400 px between the cushions, balls have
   radius R = 9.5, and the six pockets catch a ball whose centre
   comes within their radius. Time advances in fixed steps of
   1/480 s; at the hardest shot (1800 px/s) a ball moves 3.75 px a
   step — far less than a ball's width — so nothing tunnels
   through a ball or a cushion.

     · balls: equal masses, ball-to-ball restitution 0.95; the
       collision acts along the line of centres only (no throw)
     · cushions: segments with round ends (the jaws of the
       pockets); restitution 0.75, tangential speed kept
     · rolling: a constant deceleration plus a part that grows
       with speed; a ball under 4 px/s stops
   Simplified: no spin (english, follow, draw, masse), no jumping.

   A Sim records what judges need: the first ball the cue ball
   touched, every pocketed ball in order, whether a ball touched a
   cushion after that first contact, and which object balls
   touched a cushion at all (for the break).
   ============================================================ */
export const W = 800, H = 400, R = 9.5;
export const DT = 1 / 480;
export const MAXV = 1800;
const E_BALL = 0.95, E_RAIL = 0.75;
const FR_C = 45, FR_V = 0.28, STOP = 4;

export const POCKETS = [
  { x: 0, y: 0, r: 22 }, { x: W / 2, y: -4, r: 19 }, { x: W, y: 0, r: 22 },
  { x: 0, y: H, r: 22 }, { x: W / 2, y: H + 4, r: 19 }, { x: W, y: H, r: 22 },
];
const GC = 28, GS = 24;                        /* the pocket mouths along the rails */
export const SEGS = [
  [GC, 0, W / 2 - GS, 0], [W / 2 + GS, 0, W - GC, 0],
  [GC, H, W / 2 - GS, H], [W / 2 + GS, H, W - GC, H],
  [0, GC, 0, H - GC], [W, GC, W, H - GC],
];

export const groupOf = id => (id === 0 ? 'cue' : id === 8 ? 'eight' : id < 8 ? 'solid' : 'stripe');

/* the rack: the apex on the foot spot, the 8 in the middle, a solid and a stripe in the back corners */
const RACK = [[1], [9, 2], [3, 8, 10], [11, 4, 5, 12], [6, 13, 14, 7, 15]];
export function makeBalls() {
  const balls = [{ id: 0, x: 200, y: H / 2, vx: 0, vy: 0, in: true }];
  const dx = 2 * R * Math.cos(Math.PI / 6) + 0.15;
  RACK.forEach((row, r) => row.forEach((id, k) => {
    balls.push({ id, x: 600 + r * dx, y: H / 2 + (k - (row.length - 1) / 2) * (2 * R + 0.15), vx: 0, vy: 0, in: true });
  }));
  return balls.sort((a, b) => a.id - b.id);
}
export const cloneBalls = balls => balls.map(b => ({ ...b }));

/* may the cue ball sit at (x, y)? inside the cushions and clear of every other ball */
export function canPlace(balls, x, y) {
  if (!(x >= R && x <= W - R && y >= R && y <= H - R)) return false;
  for (const b of balls) if (b.id !== 0 && b.in && Math.hypot(b.x - x, b.y - y) < 2 * R + 0.5) return false;
  /* never inside a pocket's mouth */
  for (const p of POCKETS) if (Math.hypot(p.x - x, p.y - y) < p.r + R) return false;
  return true;
}

export function createSim(balls, dt = DT) {
  const ev = { first: null, pocketed: [], cueIn: false, rails: false, railObj: new Set(), t: 0, hits: 0 };
  const live = () => balls.filter(b => b.in);
  let sound = null;                              /* sound(kind, speed): 'ball' | 'rail' | 'pocket', for the game's audio */
  const moving = b => b.vx !== 0 || b.vy !== 0;

  function railHit(b, vn) {
    if (b.id !== 0) ev.railObj.add(b.id);
    if (ev.first !== null) ev.rails = true;
    return vn;
  }

  function step() {
    ev.t += dt;
    const L = live();
    for (const b of L) {
      if (!moving(b)) continue;
      let sp = Math.hypot(b.vx, b.vy);
      const d = (FR_C + FR_V * sp) * dt;
      if (sp <= d || sp < STOP) { b.vx = b.vy = 0; continue; }
      sp -= d;
      const k = sp / (sp + d);
      b.vx *= k; b.vy *= k;
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    /* ball against ball */
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const c = L[j];
        if (!moving(a) && !moving(c)) continue;
        const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const nx = d2 ? dx / d : 1, ny = d2 ? dy / d : 0;
        const over = (2 * R - d) / 2;
        a.x -= nx * over; a.y -= ny * over; c.x += nx * over; c.y += ny * over;
        const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (vn < 0) {
          const j2 = -(1 + E_BALL) * vn / 2;
          a.vx -= j2 * nx; a.vy -= j2 * ny; c.vx += j2 * nx; c.vy += j2 * ny;
          ev.hits++;
          if (sound) sound('ball', -vn);
          if (ev.first === null && (a.id === 0 || c.id === 0)) ev.first = a.id === 0 ? c.id : a.id;
        }
      }
    }
    /* cushions */
    for (const b of L) {
      if (!moving(b)) continue;
      for (const s of SEGS) {
        const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((b.x - s[0]) * dx + (b.y - s[1]) * dy) / l2));
        const px = s[0] + dx * t, py = s[1] + dy * t;
        let nx = b.x - px, ny = b.y - py, d = Math.hypot(nx, ny);
        if (d >= R) continue;
        if (d < 1e-6) { const l = Math.sqrt(l2); nx = -dy / l; ny = dx / l; if (nx * (W / 2 - b.x) + ny * (H / 2 - b.y) < 0) { nx = -nx; ny = -ny; } d = 1e-6; } else { nx /= d; ny /= d; }
        b.x = px + nx * R; b.y = py + ny * R;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + E_RAIL) * vn * nx; b.vy -= (1 + E_RAIL) * vn * ny; railHit(b, vn); if (sound) sound('rail', -vn); }
      }
    }
    /* pockets */
    for (const b of L) {
      for (const p of POCKETS) {
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
          b.in = false; b.vx = b.vy = 0; b.pocket = POCKETS.indexOf(p);
          ev.pocketed.push(b.id);
          if (sound) sound('pocket', 0);
          if (b.id === 0) ev.cueIn = true;
          break;
        }
      }
    }
  }
  return {
    balls, ev, step, dt,
    set sound(fn) { sound = fn; },
    anyMoving: () => balls.some(b => b.in && moving(b)),
    /* run until everything is still (or maxT seconds have gone) */
    run(maxT = 30) { const n = Math.ceil(maxT / dt); for (let i = 0; i < n && this.anyMoving(); i++) step(); return ev; },
  };
}

/* hit the cue ball: angle in radians (0 = +x), power 0..1 */
export function strike(balls, angle, power) {
  const c = balls[0];
  const sp = Math.max(0, Math.min(1, power)) * MAXV;
  c.vx = Math.cos(angle) * sp; c.vy = Math.sin(angle) * sp;
}
