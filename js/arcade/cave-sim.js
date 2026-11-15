/* ============================================================
   arcade/cave-sim.js — the world and the physics of Cave Diver, with
   no drawing, so the game, its ghost, a replay and the play-tests all
   run the very same dive.

   THE CAVE. The world is 400 units wide and as deep as you can go. It
   is laid out in chunks of 40 units of depth, one after another, from
   the seed alone (a seeded stream used only for the cave, never for
   anything you do), so a seed is always the same cave. Each chunk has a
   centre line and a half-width (the passage narrows with depth and
   never gets under 44), sometimes a rock in the passage (always with
   room to pass on one side), and now and then an air tank.

   THE DIVER sinks at a rate that grows with depth (85 up to 150
   units a second) and swims sideways, accelerating toward the way it
   faces. One button flips the way it faces. Air runs out at 2 % a
   second; a tank gives 45 %. Touch rock and the dive is over.
   Depth is measured in metres: 20 units to the metre.

   A RUN is { x, y, vx, dir, air, n (steps), over, hit, tanks, got }. step(run,
   flip) moves it by 1/120 s; a replay is the list of steps on which the
   button was pressed.
   ============================================================ */
import { rng } from './kit.js';

export const WIDTH = 400;
export const CHUNK = 40;
export const STEP = 1 / 120;
export const DIVER_R = 7;
export const UNITS_PER_M = 20;
export const AIR_DRAIN = 2;            /* percent a second */
export const TANK_AIR = 45;
export const TANK_R = 11;
const HV = 125, AX = 760;

export const sinkSpeed = y => Math.min(150, 85 + y * 0.012);
export const metres = y => Math.max(0, Math.floor(y / UNITS_PER_M));

/** a cave from a seed: edges(y) -> { c, w }; chunks are made on demand and always the same */
export function makeCave(seed) {
  const r = rng(seed >>> 0 || 1);
  const chunks = [];                    /* { c, w, rock?, tank? } */
  let nextTank = 40 + Math.floor(r() * 12);
  const grow = upTo => {
    while (chunks.length <= upTo) {
      const i = chunks.length, prev = chunks[i - 1];
      const w = Math.max(44, 124 - i * 0.36);
      let c = prev ? prev.c + (r() * 2 - 1) * 15 : WIDTH / 2;
      c = Math.max(w + 8, Math.min(WIDTH - w - 8, c));
      const ch = { i, c, w };
      if (i >= 8 && r() < 0.34) {
        const rad = 11 + r() * 7, room = w - rad - 46;
        if (room > 4) ch.rock = { x: c + (r() * 2 - 1) * room, y: (i + 0.5) * CHUNK, r: rad };
      }
      if (i >= nextTank) {
        nextTank = i + 46 + Math.floor(r() * 18);
        if (!ch.rock) ch.tank = { i, x: c + (r() * 2 - 1) * Math.max(0, w - 26), y: (i + 0.5) * CHUNK };
      }
      chunks.push(ch);
    }
  };
  const at = i => { grow(i + 1); return chunks[i]; };
  return {
    seed,
    chunk: at,
    /** the passage at depth y: centre and half-width, blended between the chunk centres */
    edges(y) {
      const f = Math.max(0, y / CHUNK - 0.5), i = Math.floor(f), t = f - i;
      const a = at(i), b = at(i + 1);
      return { c: a.c + (b.c - a.c) * t, w: a.w + (b.w - a.w) * t };
    },
    /** rocks and tanks in the chunks from depth y0 to y1 */
    near(y0, y1) {
      const rocks = [], tanks = [];
      for (let i = Math.max(0, Math.floor(y0 / CHUNK) - 1); i <= Math.floor(y1 / CHUNK) + 1; i++) {
        const ch = at(i);
        if (ch.rock) rocks.push(ch.rock);
        if (ch.tank) tanks.push(ch.tank);
      }
      return { rocks, tanks };
    },
  };
}

export const newRun = () => ({ x: WIDTH / 2, y: 0, vx: 0, dir: 1, air: 100, n: 0, over: false, hit: '', tanks: 0, got: [] });
/** a copy of a run, for a pilot that tries things out */
export const copyRun = r => ({ ...r, got: r.got.slice() });

/** one fixed step of a dive. `flip` true: the button was pressed at this step. Mutates and returns the run. */
export function step(run, cave, flip) {
  if (run.over) return run;
  if (flip) run.dir = -run.dir;
  run.vx += run.dir * AX * STEP;
  run.vx = Math.max(-HV, Math.min(HV, run.vx));
  run.x += run.vx * STEP;
  run.y += sinkSpeed(run.y) * STEP;
  run.air -= AIR_DRAIN * STEP;
  run.n++;
  const e = cave.edges(run.y);
  if (run.x - DIVER_R < e.c - e.w) { run.over = true; run.hit = 'wall'; run.x = e.c - e.w + DIVER_R; }
  else if (run.x + DIVER_R > e.c + e.w) { run.over = true; run.hit = 'wall'; run.x = e.c + e.w - DIVER_R; }
  const { rocks, tanks } = cave.near(run.y - 30, run.y + 30);
  if (!run.over) for (const k of rocks) if ((k.x - run.x) ** 2 + (k.y - run.y) ** 2 < (k.r + DIVER_R * 0.85) ** 2) { run.over = true; run.hit = 'rock'; }
  for (const t of tanks) {
    if (!run.got.includes(t.i) && (t.x - run.x) ** 2 + (t.y - run.y) ** 2 < (TANK_R + DIVER_R) ** 2) { run.got.push(t.i); run.air = Math.min(100, run.air + TANK_AIR); run.tanks++; }
  }
  if (run.air <= 0 && !run.over) { run.air = 0; run.over = true; run.hit = 'air'; }
  return run;
}

/** play a whole replay (`flips`: the steps the button was pressed on) on a seed: the final run */
export function replay(seed, flips, maxSteps = 400000) {
  const cave = makeCave(seed), run = newRun();
  let k = 0;
  while (!run.over && run.n < maxSteps) {
    while (k < flips.length && flips[k] < run.n) k++;
    const f = k < flips.length && flips[k] === run.n;
    if (f) k++;
    step(run, cave, f);
  }
  return run;
}
