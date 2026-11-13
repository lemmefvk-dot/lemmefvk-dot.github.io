/* ============================================================
   arcade/bowling-sim.js — the lane, the ball and ten pins, with no
   graphics: a rigid-circle simulation in real centimetres.

   Lane: 105 cm wide, x across (0 = the middle, negative = the
   bowler's left), y down the lane from the foul line. The head pin
   stands 1829 cm out; pins are 30.48 cm apart (an equilateral
   triangle). The ball is 21.8 cm across and weighs about four times
   a pin; a pin is a 12 cm disc.

   What is simulated (fixed 1/480 s steps, so the result of a throw
   never depends on the frame rate):
     · the ball rolls straight, with a late hook from `spin`
       (the hook only bites on the dry back half of the lane);
     · ball–pin and pin–pin collisions, with momentum and bounce,
       so pins knock down other pins that the ball never touches;
     · a pin is knocked over when something hits it fast enough;
       a lying pin keeps sliding and keeps hitting others;
     · friction slows sliding pins; the side kickbacks bounce them
       back onto the deck; a pin that reaches a gutter or the pit
       is down;
     · a ball that drifts over the lane edge drops into the gutter
       and stays there to the end.
   ============================================================ */

export const LANE_W = 105;
export const GUTTER_W = 23.5;
export const BALL_R = 10.9;
export const PIN_R = 6;
export const HEAD_Y = 1829;
export const PIN_GAP = 30.48;
export const ROW_DY = PIN_GAP * Math.sqrt(3) / 2;       /* 26.4 */
export const PIT_Y = HEAD_Y + 3 * ROW_DY + 60;           /* behind the last row */
export const ARROW_Y = 450;                              /* the lane's arrows, about where players aim */
const BALL_M = 6.5, PIN_M = 1.55;
const TOPPLE = 40;                    /* cm/s of closing speed that knocks a pin over */
const KICK_X = 64;                    /* the kickbacks at the sides of the deck */
const HOOK = 54;                      /* cm/s² of sideways pull at full spin, past the oil */
const DT = 1 / 480;

/* the ten spots, numbered as on a score sheet: 1 at the front, 7 front-left … 10 front-right */
export const SPOTS = (() => {
  const rows = [[1], [2, 3], [4, 5, 6], [7, 8, 9, 10]];
  const out = [];
  rows.forEach((ids, r) => ids.forEach((id, j) => out.push({ id, x: (j - r / 2) * PIN_GAP, y: HEAD_Y + r * ROW_DY })));
  return out.sort((a, b) => a.id - b.id);
})();

export const newPin = (spot, x = spot.x, y = spot.y) => ({ id: spot.id, x, y, vx: 0, vy: 0, up: true, fallen: false, gone: false, ang: 0, hitByBall: false, hitByPin: false });

/* a full rack, or the given standing pins where they stand: [{id, x, y}] */
export function rack(standing = null) {
  if (!standing) return SPOTS.map(s => newPin(s));
  return standing.map(p => newPin(SPOTS.find(s => s.id === p.id), p.x, p.y));
}

export function newWorld(pins) {
  return {
    t: 0, acc: 0,
    pins,
    start: pins.map(p => p.id),
    ball: null,
    contacts: 0,
  };
}

/* roll a ball: x = where it leaves the foul line (cm), angle in radians (+ = to the right),
   speed in cm/s, spin -1..1 (+ hooks to the right) */
export function launch(w, { x = 0, angle = 0, speed = 700, spin = 0 } = {}) {
  const sp = Math.max(300, Math.min(1000, speed));
  w.ball = {
    x: Math.max(-LANE_W / 2 + BALL_R, Math.min(LANE_W / 2 - BALL_R, x)), y: 0,
    vx: Math.sin(angle) * sp, vy: Math.cos(angle) * sp,
    spin: Math.max(-1, Math.min(1, spin)), gutter: 0, gone: false, roll: 0,
  };
  return w;
}

function collide(a, b, e, ma, mb) {
  const dx = b.x - a.x, dy = b.y - a.y, R = a.r + b.r, d2 = dx * dx + dy * dy;
  if (d2 >= R * R || d2 === 0) return 0;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ia = 1 / ma, ib = 1 / mb;
  const s = (R - d) / (ia + ib);
  a.x -= nx * s * ia; a.y -= ny * s * ia; b.x += nx * s * ib; b.y += ny * s * ib;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv >= 0) return 0;
  const j = -(1 + e) * rv / (ia + ib);
  a.vx -= j * nx * ia; a.vy -= j * ny * ia; b.vx += j * nx * ib; b.vy += j * ny * ib;
  return -rv;
}

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function stepOnce(w) {
  const dt = DT;
  w.t += dt;
  const ball = w.ball;
  if (ball && !ball.gone) {
    if (!ball.gutter) {
      ball.vx += ball.spin * HOOK * smooth(500, 1500, ball.y) * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      /* over the edge: into the gutter, straight on to the end */
      if (Math.abs(ball.x) > LANE_W / 2 + 2) { ball.gutter = ball.x < 0 ? -1 : 1; ball.vx = 0; }
    } else {
      ball.x += (ball.gutter * (LANE_W / 2 + GUTTER_W / 2) - ball.x) * Math.min(1, dt * 30);
      ball.y += ball.vy * dt;
    }
    ball.roll += ball.vy * dt / BALL_R;
    if (ball.y > PIT_Y + 40) ball.gone = true;
  }
  const live = w.pins.filter(p => !p.gone);
  /* ball against pins (not while it is in the gutter) */
  if (ball && !ball.gone && !ball.gutter) {
    const B = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, r: BALL_R };
    for (const p of live) {
      const P = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: PIN_R };
      const close = collide(B, P, 0.5, BALL_M, PIN_M);
      if (close) {
        p.x = P.x; p.y = P.y; p.vx = P.vx; p.vy = P.vy;
        p.hitByBall = true; w.contacts++;
        if (close >= TOPPLE && !p.fallen) { p.fallen = true; p.up = false; p.ang = Math.atan2(p.vy, p.vx); }
      }
    }
    ball.x = B.x; ball.y = B.y; ball.vx = B.vx; ball.vy = B.vy;
  }
  /* pins against pins */
  for (let i = 0; i < live.length; i++) {
    for (let k = i + 1; k < live.length; k++) {
      const a = live[i], b = live[k];
      if (Math.abs(a.x - b.x) > 2 * PIN_R || Math.abs(a.y - b.y) > 2 * PIN_R) continue;
      if (a.vx === 0 && a.vy === 0 && b.vx === 0 && b.vy === 0) {
        /* two pins at rest overlapping (pushed together): just separate them */
        const A = { x: a.x, y: a.y, vx: 0, vy: 0, r: PIN_R }, Bq = { x: b.x, y: b.y, vx: 0, vy: 0, r: PIN_R };
        collide(A, Bq, 0.5, PIN_M, PIN_M);
        a.x = A.x; a.y = A.y; b.x = Bq.x; b.y = Bq.y;
        continue;
      }
      const A = { x: a.x, y: a.y, vx: a.vx, vy: a.vy, r: PIN_R }, Bq = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: PIN_R };
      const close = collide(A, Bq, 0.55, PIN_M, PIN_M);
      if (close) {
        a.x = A.x; a.y = A.y; a.vx = A.vx; a.vy = A.vy; b.x = Bq.x; b.y = Bq.y; b.vx = Bq.vx; b.vy = Bq.vy;
        w.contacts++;
        /* a pin struck by another pin is down if it was struck hard enough */
        for (const p of [a, b]) {
          p.hitByPin = true;
          if (close >= TOPPLE && !p.fallen) { p.fallen = true; p.up = false; p.ang = Math.atan2(p.vy, p.vx); }
        }
      }
    }
  }
  /* sliding pins: friction, kickbacks, the pit */
  for (const p of live) {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0) {
      const dec = (p.fallen ? 420 : 260) * dt;
      const k = Math.max(0, sp - dec) / sp;
      p.vx *= k; p.vy *= k;
      if (sp - dec < 1.5) { p.vx = 0; p.vy = 0; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.fallen && sp > 5) p.ang += (Math.atan2(p.vy, p.vx) - p.ang) * 0.1;
    }
    if (p.y > HEAD_Y - 60 && p.y < PIT_Y) {
      if (p.x < -KICK_X + PIN_R) { p.x = -KICK_X + PIN_R; p.vx = Math.abs(p.vx) * 0.5; if (!p.fallen) { p.fallen = true; p.up = false; } }
      if (p.x > KICK_X - PIN_R) { p.x = KICK_X - PIN_R; p.vx = -Math.abs(p.vx) * 0.5; if (!p.fallen) { p.fallen = true; p.up = false; } }
    }
    if (Math.abs(p.x) > LANE_W / 2 + 3 && !p.fallen) { p.fallen = true; p.up = false; }
    if (p.y > PIT_Y) { p.fallen = true; p.up = false; p.gone = true; p.vx = p.vy = 0; }
  }
}

/* run `secs` of the world at the fixed rate; a partial step carries over */
export function advance(w, secs) {
  w.acc += secs;
  let n = 0;
  while (w.acc >= DT - 1e-9 && n < 20000) { stepOnce(w); w.acc -= DT; n++; }
  return n;
}

/* the ball is done and nothing is still moving (or the throw has taken too long) */
export function settled(w) {
  if (w.t > 14) return true;
  const ballDone = !w.ball || w.ball.gone || (Math.hypot(w.ball.vx, w.ball.vy) < 2);
  if (!ballDone) return false;
  return w.pins.every(p => p.gone || (p.vx === 0 && p.vy === 0));
}

/* pin ids knocked down by this ball (those standing when it was thrown) */
export function knocked(w) {
  return w.pins.filter(p => p.fallen).map(p => p.id).sort((a, b) => a - b);
}

/* the pins still standing, with where they stand */
export function standing(w) {
  return w.pins.filter(p => !p.fallen && !p.gone).map(p => ({ id: p.id, x: p.x, y: p.y }));
}

/* where a ball with these settings crosses the head-pin line, and the path it takes
   (every `every` cm), by rolling it down an empty lane */
export function ballPath(opts, every = 90) {
  const w = newWorld([]);
  launch(w, opts);
  const pts = [{ x: w.ball.x, y: 0 }];
  let next = every;
  for (let i = 0; i < 6000 && w.ball.y < HEAD_Y; i++) {
    stepOnce(w);
    if (w.ball.y >= next) { pts.push({ x: w.ball.x, y: w.ball.y }); next += every; }
  }
  pts.push({ x: w.ball.x, y: w.ball.y });
  return { pts, x: w.ball.x, gutter: w.ball.gutter };
}

/* the launch angle that brings the ball to `tx` at the head-pin line, hook included */
export function aimAngle(x0, tx, speed, spin) {
  let ang = Math.atan2(tx - x0, HEAD_Y);
  for (let i = 0; i < 4; i++) {
    const end = ballPath({ x: x0, angle: ang, speed, spin }, HEAD_Y).x;
    ang -= Math.atan2(end - tx, HEAD_Y);
  }
  return ang;
}

/* throw a whole ball at once (tests, and the computer's practice) */
export function simulate(pins, opts, maxSecs = 15) {
  const w = newWorld(pins);
  launch(w, opts);
  let t = 0;
  while (!settled(w) && t < maxSecs) { advance(w, 0.05); t += 0.05; }
  return w;
}
