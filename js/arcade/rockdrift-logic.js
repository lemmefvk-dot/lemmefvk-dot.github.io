/* ============================================================
   arcade/rockdrift-logic.js — the rules of Rock Drift, with no screen
   in them (the game is ./rockdrift.js; the suite plays this module
   too).

   A small ship drifts in a 640 × 400 sky that wraps round at every
   edge. Turn, thrust, and shoot the rocks: a big one (20 points)
   breaks into two medium ones (50), a medium into two small ones
   (100). Four shots can be in the air at once. Touch a rock and the
   ship is lost: three ships, a new one every 3000 points, two seconds
   of safety after each respawn. Clear the sky and a bigger field
   drifts in.

   Where the rocks start and which way they split comes from a
   generator held in the state, seeded by the round's seed: the same
   seed and the same keys is the same round. A round is fixed 1/60 s
   steps and a log of ['k', held keys] changes (1 left, 2 right,
   4 thrust, 8 fire).
   ============================================================ */
import { hash32 } from './challenge.js';
import { nextRand, replayLog } from './sim-core.js';

export const VW = 640, VH = 400;
export const TURN = 3.6, THRUST = 190, DRAG = 0.9935, SHOT_V = 7, SHOT_LIFE = 55, COOL = 10, MAX_SHOTS = 4;
export const RADII = [0, 11, 20, 34];
export const POINTS = [0, 100, 50, 20];
export const LIVES = 3, SAFE = 120, RESPAWN = 90, EXTRA = 3000;
const MAXROCKS = 48;

export function create(seed = 1) {
  const s = {
    seed: seed >>> 0, r: hash32(`staticos-rocks:${seed >>> 0}`) || 1, t: 0, over: false, ev: [], keys: 0, score: 0, lives: LIVES, wave: 0, extra: EXTRA, kills: 0, shotsFired: 0,
    x: VW / 2, y: VH / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, safe: SAFE, respawn: 0, cool: 0, thrusting: false, clear: 0,
    rocks: Array.from({ length: MAXROCKS }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, size: 3, shape: 0 })),
    shots: Array.from({ length: MAX_SHOTS }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 })),
  };
  nextWave(s);
  return s;
}

export const rocksLeft = s => { let n = 0; for (let i = 0; i < s.rocks.length; i++) if (s.rocks[i].on) n++; return n; };
const freeRock = s => { for (let i = 0; i < s.rocks.length; i++) if (!s.rocks[i].on) return s.rocks[i]; return null; };

function addRock(s, x, y, size, speed) {
  const k = freeRock(s);
  if (!k) return;
  const ang = nextRand(s) * 6.2832;
  k.on = true; k.x = x; k.y = y; k.size = size; k.vx = Math.cos(ang) * speed / 60; k.vy = Math.sin(ang) * speed / 60; k.shape = Math.floor(nextRand(s) * 5);
}

function nextWave(s) {
  s.wave++;
  const n = Math.min(9, 3 + s.wave);
  for (let i = 0; i < n; i++) {
    /* from an edge, never on top of the ship */
    const side = Math.floor(nextRand(s) * 4), u = nextRand(s);
    const x = side === 0 ? 0 : side === 1 ? VW : u * VW, y = side === 2 ? 0 : side === 3 ? VH : u * VH;
    addRock(s, x, y, 3, 22 + Math.min(40, s.wave * 5) + nextRand(s) * 20);
  }
  s.ev.push({ type: 'wave', n: s.wave });
}

export function act(s, code, mask) {
  if (code !== 'k' || !Number.isInteger(mask) || mask < 0 || mask > 15) return false;
  s.keys = mask;
  return true;
}

const wrap = (v, m) => (v < 0 ? v + m : v >= m ? v - m : v);

export function step(s) {
  if (s.over) return;
  s.t++;
  /* the ship */
  s.thrusting = false;
  if (s.alive) {
    const dt = 1 / 60;
    if (s.keys & 1) s.a -= TURN * dt;
    if (s.keys & 2) s.a += TURN * dt;
    if (s.keys & 4) { s.vx += Math.cos(s.a) * THRUST * dt; s.vy += Math.sin(s.a) * THRUST * dt; s.thrusting = true; }
    s.vx *= DRAG; s.vy *= DRAG;
    s.x = wrap(s.x + s.vx * dt, VW); s.y = wrap(s.y + s.vy * dt, VH);
    if (s.safe > 0) s.safe--;
    if (s.cool > 0) s.cool--;
    if ((s.keys & 8) && s.cool === 0) {
      const sh = s.shots.find(q => !q.on);
      if (sh) {
        sh.on = true; sh.life = SHOT_LIFE; sh.x = s.x + Math.cos(s.a) * 12; sh.y = s.y + Math.sin(s.a) * 12;
        sh.vx = s.vx / 60 + Math.cos(s.a) * SHOT_V; sh.vy = s.vy / 60 + Math.sin(s.a) * SHOT_V;
        s.cool = COOL; s.shotsFired++;
        s.ev.push({ type: 'shoot' });
      }
    }
  } else if (--s.respawn <= 0) {
    s.alive = true; s.x = VW / 2; s.y = VH / 2; s.vx = 0; s.vy = 0; s.a = -Math.PI / 2; s.safe = SAFE;
  }
  /* the shots */
  for (let i = 0; i < s.shots.length; i++) {
    const sh = s.shots[i];
    if (!sh.on) continue;
    sh.x = wrap(sh.x + sh.vx, VW); sh.y = wrap(sh.y + sh.vy, VH);
    if (--sh.life <= 0) sh.on = false;
  }
  /* the rocks, and what hits them */
  for (let i = 0; i < s.rocks.length; i++) {
    const k = s.rocks[i];
    if (!k.on) continue;
    k.x = wrap(k.x + k.vx, VW); k.y = wrap(k.y + k.vy, VH);
    const rad = RADII[k.size];
    let hit = false;
    for (let j = 0; j < s.shots.length && !hit; j++) {
      const sh = s.shots[j];
      if (!sh.on) continue;
      const dx = sh.x - k.x, dy = sh.y - k.y;
      if (dx * dx + dy * dy <= rad * rad) { sh.on = false; hit = true; }
    }
    if (hit) {
      /* read it before the two pieces take its slot */
      const size = k.size, kx = k.x, ky = k.y;
      k.on = false; s.kills++;
      s.score += POINTS[size];
      s.ev.push({ type: 'boom', size, x: kx, y: ky });
      if (size > 1) { addRock(s, kx, ky, size - 1, 40 + nextRand(s) * 40 + s.wave * 3); addRock(s, kx, ky, size - 1, 40 + nextRand(s) * 40 + s.wave * 3); }
      if (s.score >= s.extra) { s.extra += EXTRA; s.lives++; s.ev.push({ type: 'life' }); }
      continue;
    }
    if (s.alive && s.safe === 0) {
      const dx = s.x - k.x, dy = s.y - k.y, rr = rad + 6;
      if (dx * dx + dy * dy <= rr * rr) {
        s.alive = false; s.lives--; s.respawn = RESPAWN; s.vx = 0; s.vy = 0;
        s.ev.push({ type: 'die', x: s.x, y: s.y });
        if (s.lives <= 0) { s.over = true; return; }
      }
    }
  }
  if (rocksLeft(s) === 0) { if (++s.clear >= 60) { s.clear = 0; nextWave(s); } }
}

export const score = s => s.score;
export const replay = (seed, log, until) => replayLog({ create, step, act }, seed, log, until);
export default { VW, VH, create, step, act, score, replay, rocksLeft };
