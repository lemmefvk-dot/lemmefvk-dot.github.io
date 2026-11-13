/* ============================================================
   arcade/basketball-sim.js — a free throw in real metres, with no
   graphics: a ball in flight (gravity), the rim, the backboard,
   the net and the floor.

   Side view: x runs from the shooter toward the hoop, y is up.
   The ball is released 2.15 m up and 4.2 m from the middle of the
   rim (3.05 m high, 0.45 m across); the backboard stands 0.375 m
   behind the rim's centre. The launch angle is a fixed 58°, so the
   shot meter decides only the SPEED: a perfect speed drops the ball
   cleanly through the middle; a little off and it rattles on the
   rim and may still fall in; a lot off and it is short, long or
   thrown off the board. Nothing here is random — the same release
   always gives the same shot.

   speedFor(p)    release speed for a meter value p (0..1)
   newShot(p) / stepShot(s, dt) / runShot(p)
   outcome(s)     'swish' | 'bank' | 'rim-in' | 'rim-out' | 'board-out' | 'short' | 'long'
   ============================================================ */

export const G = 9.81;
export const BALL_R = 0.12;
export const REL = { x: 0, y: 2.15 };
export const HOOP = { x: 4.2, y: 3.05, r: 0.225 };
export const BOARD = { x: HOOP.x + 0.375, y0: 2.9, y1: 3.95 };
export const ANGLE = 58 * Math.PI / 180;
export const P_STAR = 0.72;            /* the meter value of the perfect release */
export const GREEN_LO = 0.68, GREEN_HI = 0.78;   /* the meter's green zone: every release in it is a clean swish */
export const WINDOW = 0.06;            /* ± around P_STAR that counts as the green zone */
const SLOPE_IN = 0.05;                 /* speed change (a fraction) per unit of meter inside the green zone … */
const SLOPE_OUT = 0.3;                 /* … and beyond it, where a mistimed release matters more (too soft) */
const SLOPE_OUT_HI = 0.55;             /* … and a release that is too hard goes much farther */
const RIM_PT = 0.02;                   /* the rim is a tube about 2 cm thick */
const DT = 1 / 480;

/* the speed that puts the ball through the middle of the hoop */
export const PERFECT_V = (() => {
  const dx = HOOP.x - REL.x, dy = HOOP.y - REL.y, c = Math.cos(ANGLE), t = Math.tan(ANGLE);
  return Math.sqrt(G * dx * dx / (2 * c * c * (dx * t - dy)));
})();

export const speedFor = p => {
  const e = p - P_STAR, a = Math.abs(e);
  const d = a <= WINDOW ? SLOPE_IN * a : SLOPE_IN * WINDOW + (e > 0 ? SLOPE_OUT_HI : SLOPE_OUT) * (a - WINDOW);
  return PERFECT_V * (1 + Math.sign(e) * d);
};

export function newShot(p) {
  const v = speedFor(p);
  return {
    p, t: 0, acc: 0,
    x: REL.x, y: REL.y, vx: v * Math.cos(ANGLE), vy: v * Math.sin(ANGLE),
    spin: 0, rot: 0,
    rim: 0, board: 0, floor: 0,         /* touches */
    scored: false, passed: false,       /* passed: crossed the rim's height going down */
    crossX: null,                       /* where, along the floor, it crossed that height */
    net: 0,                             /* 0..1, how far the net is swinging */
    done: false, rest: 0,
    lastTouch: null,                    /* 'rim' | 'board' | 'floor' | null */
    events: [],                         /* [{ t, kind }] for sounds */
  };
}

function bounceOffPoint(s, px, py, e) {
  const dx = s.x - px, dy = s.y - py, R = BALL_R + RIM_PT, d2 = dx * dx + dy * dy;
  if (d2 >= R * R || d2 === 0) return false;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  s.x = px + nx * R; s.y = py + ny * R;
  const vn = s.vx * nx + s.vy * ny;
  if (vn < 0) {
    s.vx -= (1 + e) * vn * nx; s.vy -= (1 + e) * vn * ny;
    /* the rim takes a little off the glancing part, too */
    s.vx *= 0.97; s.vy *= 0.97;
  }
  return true;
}

function stepOnce(s) {
  const dt = DT;
  s.t += dt;
  const px = s.x, py = s.y;
  s.vy -= G * dt;
  /* the net drags a ball that is falling through it */
  const inNet = s.scored && s.y < HOOP.y && s.y > HOOP.y - 0.45 && Math.abs(s.x - HOOP.x) < 0.3;
  if (inNet) { s.vx *= 1 - 6 * dt; s.vy *= 1 - 2.2 * dt; s.net = Math.min(1, s.net + 6 * dt); }
  else s.net = Math.max(0, s.net - 1.8 * dt);
  s.x += s.vx * dt; s.y += s.vy * dt;
  s.rot += (s.vx * 0.9) * dt / BALL_R * 0.25;
  /* the rim: a front and a back point */
  for (const side of [-1, 1]) {
    if (bounceOffPoint(s, HOOP.x + side * HOOP.r, HOOP.y, 0.5)) { s.rim++; s.lastTouch = 'rim'; s.events.push({ t: s.t, kind: 'rim' }); }
  }
  /* the backboard (glass: a bit lively) */
  if (s.vx > 0 && s.x + BALL_R > BOARD.x && s.x - BALL_R < BOARD.x + 0.03 && s.y > BOARD.y0 - BALL_R * 0.5 && s.y < BOARD.y1 + BALL_R * 0.5) {
    s.x = BOARD.x - BALL_R; s.vx = -s.vx * 0.55; s.vy *= 0.92;
    s.board++; s.lastTouch = 'board'; s.events.push({ t: s.t, kind: 'board' });
  }
  /* through the hoop? the ball's middle crosses the rim's height going down, inside the rim */
  if (!s.passed && py > HOOP.y && s.y <= HOOP.y && s.vy < 0) {
    s.passed = true;
    s.crossX = s.x;
    if (Math.abs(s.x - HOOP.x) < HOOP.r - 0.005) { s.scored = true; s.events.push({ t: s.t, kind: 'net' }); }
  }
  /* the floor */
  if (s.y < BALL_R) {
    s.y = BALL_R;
    if (s.vy < 0) {
      s.vy = -s.vy * 0.62; s.vx *= 0.88; s.floor++; s.lastTouch = s.lastTouch || 'floor';
      if (Math.abs(s.vy) > 0.8) s.events.push({ t: s.t, kind: 'floor' });
    }
    if (Math.abs(s.vy) < 0.4 && s.y <= BALL_R + 1e-3) { s.vy = 0; s.vx *= 1 - 1.5 * dt; }
  }
  if (Math.abs(s.vx) < 0.05 && s.y <= BALL_R + 0.01 && s.vy === 0) s.rest += dt; else s.rest = 0;
  if (s.rest > 0.4 || s.t > 7 || s.x > 9 || s.x < -4) s.done = true;
}

/* advance `secs` at the fixed rate (a partial step carries over, so frame rate cannot matter) */
export function stepShot(s, secs) {
  s.acc += secs;
  let n = 0;
  while (s.acc >= DT - 1e-9 && !s.done && n < 20000) { stepOnce(s); s.acc -= DT; n++; }
  return n;
}

/* how it ended */
export function outcome(s) {
  if (s.scored) return s.board ? 'bank' : s.rim ? 'rim-in' : 'swish';
  if (s.board) return 'board-out';
  if (s.rim) return 'rim-out';
  /* touched nothing: came down in front of the hoop or went over the back */
  return s.crossX === null || s.crossX < HOOP.x ? 'short' : 'long';
}

/* the whole shot, headless */
export function runShot(p) {
  const s = newShot(p);
  while (!s.done) stepShot(s, 0.05);
  return { ...s, result: outcome(s) };
}

/* the meter: a value 0..1 that swings up and down, `period` seconds for a full cycle */
export const METER_PERIOD = 1.9;
export function meterAt(t, period = METER_PERIOD) {
  const u = ((t / period) % 1 + 1) % 1;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}
