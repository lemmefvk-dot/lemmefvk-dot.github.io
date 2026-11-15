/* ============================================================
   arcade/skyguard-logic.js — the rules of Sky Guard, with no screen
   in them (the game is ./skyguard.js; the suite plays this module
   too).

   Six towns and three guns sit along the ground of a 640 × 400 sky.
   Rockets come down on them in waves. Click (or tap, or aim with the
   arrows and press Space) and the nearest gun with shells left sends
   one to that spot, where it bursts into a ball of fire that grows and
   fades for three-quarters of a second: any rocket inside the fire is
   destroyed (25 points). A rocket that reaches a town or a gun
   destroys it. Each gun starts every wave with ten shells. When a wave
   has fallen you get 100 for every town left and 5 for every shell
   left, and one lost town is rebuilt. Lose every town and it is over.

   Each wave (its rockets, when and where they start, which target they
   aim at and where the splitters split) comes from the seed and the
   wave number only. A round is fixed 1/60 s steps and a log of
   ['f', x, y] shots: the log plays it again exactly.
   ============================================================ */
import { hash32 } from './challenge.js';
import { rng } from './kit.js';
import { replayLog } from './sim-core.js';

export const VW = 640, VH = 400;
export const GROUND = 372;
/* nine targets: three guns (0–2) and six towns (3–8) */
export const TARGETS = [
  { x: 40, kind: 'gun' }, { x: 320, kind: 'gun' }, { x: 600, kind: 'gun' },
  { x: 110, kind: 'town' }, { x: 170, kind: 'town' }, { x: 230, kind: 'town' },
  { x: 410, kind: 'town' }, { x: 470, kind: 'town' }, { x: 530, kind: 'town' },
];
export const AMMO = 10, FIRE_R = 34, FIRE_LIFE = 45, SHELL_V = 400 / 60, KILL = 25;
const MAXR = 64, MAXI = 16, MAXE = 32;

const cache = new Map();
/** wave n of a seed: [{ t, x, target, v, split }] sorted by t (steps from the wave's start) */
export function wave(seed, n) {
  const key = `${seed >>> 0}:${n}`;
  let w = cache.get(key);
  if (w) return w;
  const r = rng(hash32(`staticos-sky:${seed >>> 0}:${n}`));
  const count = Math.min(24, 6 + 2 * n);
  const gap = Math.max(14, 70 - n * 5);
  const v = Math.min(70, 24 + 3 * n);
  w = [];
  let t = 20;
  for (let i = 0; i < count; i++) {
    t += Math.round(gap * (0.4 + r() * 1.2));
    w.push({ t, x: Math.round(10 + r() * 620), target: Math.floor(r() * TARGETS.length), v: v * (0.85 + r() * 0.3) / 60, split: n >= 3 && r() < 0.2 ? Math.round(110 + r() * 80) : 0, t2: Math.floor(r() * TARGETS.length) });
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, w);
  return w;
}

const pool = (n, make) => Array.from({ length: n }, make);

export function create(seed = 1) {
  return {
    seed: seed >>> 0, t: 0, over: false, ev: [], score: 0, wave: 1, phase: 'wave', wt: 0, next: 0, gap: 0, kills: 0, shots: 0, lost: 0,
    alive: TARGETS.map(() => true), ammo: [AMMO, AMMO, AMMO],
    rockets: pool(MAXR, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, split: 0, t2: 0, v: 0 })),
    shells: pool(MAXI, () => ({ on: false, x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0 })),
    fires: pool(MAXE, () => ({ on: false, x: 0, y: 0, age: 0, hostile: false })),
  };
}

const townsLeft = s => { let n = 0; for (let i = 3; i < 9; i++) if (s.alive[i]) n++; return n; };
export const towns = townsLeft;
const free = arr => { for (let i = 0; i < arr.length; i++) if (!arr[i].on) return arr[i]; return null; };
export const count = arr => { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i].on) n++; return n; };
export const radius = f => FIRE_R * (f.age < FIRE_LIFE / 2 ? f.age / (FIRE_LIFE / 2) : (FIRE_LIFE - f.age) / (FIRE_LIFE / 2));

function launch(s, x, y, tgt, v, split, t2) {
  const rk = free(s.rockets);
  if (!rk) return;
  const T = TARGETS[tgt], dx = T.x - x, dy = GROUND - y, d = Math.hypot(dx, dy);
  rk.on = true; rk.x = x; rk.y = y; rk.vx = dx / d * v; rk.vy = dy / d * v; rk.split = split; rk.t2 = t2; rk.v = v;
}

/** 'f' x y: fire a shell at (x, y) from the nearest gun that has one */
export function act(s, code, x, y) {
  if (code !== 'f' || s.over || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  x = Math.max(0, Math.min(VW, x)); y = Math.max(0, Math.min(GROUND - 20, y));
  let best = -1, bd = 1e9;
  for (let i = 0; i < 3; i++) if (s.alive[i] && s.ammo[i] > 0) { const d = Math.abs(TARGETS[i].x - x); if (d < bd) { bd = d; best = i; } }
  const sh = free(s.shells);
  if (best < 0 || !sh) return false;
  const gx = TARGETS[best].x, gy = GROUND - 6, dx = x - gx, dy = y - gy, d = Math.hypot(dx, dy) || 1;
  sh.on = true; sh.x = gx; sh.y = gy; sh.tx = x; sh.ty = y; sh.vx = dx / d * SHELL_V; sh.vy = dy / d * SHELL_V;
  s.ammo[best]--; s.shots++;
  s.ev.push({ type: 'shot', gun: best });
  return true;
}

function boom(s, x, y, hostile) {
  const f = free(s.fires);
  if (f) { f.on = true; f.x = x; f.y = y; f.age = 0; f.hostile = hostile; }
}

export function step(s) {
  if (s.over) return;
  s.t++;
  if (s.phase === 'gap') {
    if (--s.gap <= 0) {
      s.wave++; s.phase = 'wave'; s.wt = 0; s.next = 0;
      for (let i = 0; i < 3; i++) s.ammo[i] = s.alive[i] ? AMMO : 0;
      s.ev.push({ type: 'wave', n: s.wave });
    }
  } else {
    s.wt++;
    const w = wave(s.seed, s.wave);
    while (s.next < w.length && w[s.next].t <= s.wt) {
      const q = w[s.next++];
      launch(s, q.x, 0, q.target, q.v, q.split, q.t2);
    }
  }
  /* rockets */
  for (let i = 0; i < s.rockets.length; i++) {
    const r = s.rockets[i];
    if (!r.on) continue;
    r.x += r.vx; r.y += r.vy;
    if (r.split && r.y >= r.split) { const t2 = r.t2, sp = r.v; r.split = 0; launch(s, r.x, r.y, t2, sp, 0, 0); launch(s, r.x, r.y, (t2 + 4) % TARGETS.length, sp, 0, 0); r.on = false; continue; }
    if (r.y >= GROUND - 6) {
      r.on = false;
      /* what it fell on: the nearest target within reach */
      let hit = -1, bd = 22;
      for (let k = 0; k < TARGETS.length; k++) { const d = Math.abs(TARGETS[k].x - r.x); if (s.alive[k] && d < bd) { bd = d; hit = k; } }
      boom(s, r.x, GROUND - 6, true);
      if (hit >= 0) { s.alive[hit] = false; s.lost++; if (hit < 3) s.ammo[hit] = 0; s.ev.push({ type: 'lost', target: hit }); }
      else s.ev.push({ type: 'miss' });
    }
  }
  /* shells */
  for (let i = 0; i < s.shells.length; i++) {
    const sh = s.shells[i];
    if (!sh.on) continue;
    sh.x += sh.vx; sh.y += sh.vy;
    if ((sh.tx - sh.x) * sh.vx + (sh.ty - sh.y) * sh.vy <= 0) { sh.on = false; boom(s, sh.tx, sh.ty, false); s.ev.push({ type: 'burst', x: sh.tx, y: sh.ty }); }
  }
  /* fire */
  for (let i = 0; i < s.fires.length; i++) {
    const f = s.fires[i];
    if (!f.on) continue;
    if (++f.age >= FIRE_LIFE) { f.on = false; continue; }
    if (f.hostile) continue;
    const rad = radius(f);
    for (let k = 0; k < s.rockets.length; k++) {
      const r = s.rockets[k];
      if (!r.on) continue;
      const dx = r.x - f.x, dy = r.y - f.y;
      if (dx * dx + dy * dy <= rad * rad) { r.on = false; s.kills++; s.score += KILL; s.ev.push({ type: 'kill', x: r.x, y: r.y }); }
    }
  }
  if (townsLeft(s) === 0) { s.over = true; s.ev.push({ type: 'over' }); return; }
  /* the wave is over when everything it sent has fallen or been shot down */
  if (s.phase === 'wave' && s.next >= wave(s.seed, s.wave).length && count(s.rockets) === 0 && count(s.shells) === 0) {
    const bonus = townsLeft(s) * 100 + (s.ammo[0] + s.ammo[1] + s.ammo[2]) * 5;
    s.score += bonus;
    s.ev.push({ type: 'cleared', n: s.wave, bonus });
    const dead = s.alive.findIndex((a, i) => i >= 3 && !a);
    if (dead >= 0) { s.alive[dead] = true; s.ev.push({ type: 'rebuilt', target: dead }); }
    s.phase = 'gap'; s.gap = 120;
  }
}

export const score = s => s.score;
export const replay = (seed, log, until) => replayLog({ create, step, act }, seed, log, until);
export default { VW, VH, TARGETS, create, step, act, score, replay, wave, towns, radius };
