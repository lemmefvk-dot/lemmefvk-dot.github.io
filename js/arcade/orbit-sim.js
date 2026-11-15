/* ============================================================
   arcade/orbit-sim.js — the world and the physics of Orbit Keeper,
   with no drawing, so the game, its ghost, a replay and the play-tests
   all run the same flight.

   A ship circles a planet on one of three rings; the inner ring is the
   fastest. One tap sends it to the next ring — outward, then, from the
   outer ring, back inward — and it takes about a third of a second to
   cross, during which it is on no ring and can touch anything between.
   Fuel runs down (3.3 % a second); a fuel pod gives 28 % and 10 points.
   Debris appears as a faint warning for a second before it is solid;
   a hit costs one of three hulls (and gives a moment of safety). The
   run ends when the fuel or the hulls are gone. Score = whole seconds
   flown + 10 for every pod.

   THE FIELD is a list of things that come, one after another, from the
   seed alone (a seeded stream used only for it), each placed by its
   spawn time, so everything about it — where it is at any moment — is a
   plain function of time. It never depends on what the ship does, so a
   seed is one flight plan on every device, and each ship (yours, a
   ghost, a pilot in a test) keeps its own list of what it has taken
   or hit.

   A RUN is { n (steps), ring, out, r, th, fuel, hull, inv, pods, hits,
   score, over, why, gone }. step(run, field, tap) moves it by 1/120 s;
   a replay is the list of steps on which the button was pressed.
   ============================================================ */
import { rng } from './kit.js';

export const STEP = 1 / 120;
export const RINGS = [62, 98, 134];
export const PLANET_R = 28;
export const SHIP_R = 6;
export const OMEGA = [1.9, 1.35, 0.98];
export const FUEL_DRAIN = 3.3;
export const POD_FUEL = 28;
export const POD_POINTS = 10;
export const HULLS = 3;
export const WARN = 1.0;               /* seconds of warning before debris is solid */
const CROSS_SPEED = 230;               /* units a second between rings */
const INVULN = 1.4;

/* angular speed at a radius: between the rings it is blended */
export const omegaAt = r => {
  if (r <= RINGS[0]) return OMEGA[0];
  if (r >= RINGS[2]) return OMEGA[2];
  const i = r < RINGS[1] ? 0 : 1, t = (r - RINGS[i]) / (RINGS[i + 1] - RINGS[i]);
  return OMEGA[i] + (OMEGA[i + 1] - OMEGA[i]) * t;
};

export function makeField(seed) {
  const r = rng(seed >>> 0 || 1);
  const objs = [];
  let t = 1.6, lastPod = 0;
  const grow = until => {
    while (t <= until) {
      /* every draw is made whatever the outcome, so the stream never depends on a choice */
      const kindR = r(), ringR = r(), angR = r(), retroR = r();
      const interval = Math.max(0.5, 1.45 - t * 0.011);
      const forced = t - lastPod > 6.5;
      const pod = forced || kindR < 0.28;
      const ring = Math.floor(ringR * 3), th0 = angR * Math.PI * 2;
      if (pod) lastPod = t;
      const retro = !pod && retroR < 0.35;
      objs.push({
        id: objs.length, kind: pod ? 'pod' : 'debris', ring, th0, born: t,
        w: OMEGA[ring] * (pod ? 0.5 : retro ? -0.7 : 1),
        r: pod ? 7 : 7 + Math.floor(kindR * 40) % 3, solid: t + (pod ? 0.3 : WARN), dies: t + (pod ? 13 : 15), shape: Math.floor(retroR * 1000),
      });
      t += interval;
    }
  };
  return {
    seed,
    /** every thing that exists at time `time` (warning or solid), spawn order */
    at(time) {
      grow(time + 2);
      return objs.filter(o => o.born <= time && time < o.dies);
    },
    all: () => objs,
  };
}
export const posOf = (o, time) => { const th = o.th0 + o.w * (time - o.born); return [Math.cos(th) * RINGS[o.ring], Math.sin(th) * RINGS[o.ring], th]; };

export const newRun = () => ({ n: 0, ring: 0, out: true, r: RINGS[0], th: 0, fuel: 100, hull: HULLS, inv: 0, pods: 0, hits: 0, score: 0, over: false, why: '', gone: [] });
export const copyRun = r => ({ ...r, gone: r.gone.slice() });
export const timeOf = run => run.n * STEP;

/** one fixed step. `tap`: the button was pressed at this step. Mutates and returns the run. */
export function step(run, field, tap) {
  if (run.over) return run;
  if (tap) {
    if (run.ring === RINGS.length - 1) run.out = false;
    if (run.ring === 0) run.out = true;
    /* a tap while already crossing just points to the next ring on from where it is going */
    run.ring += run.out ? 1 : -1;
    run.ring = Math.max(0, Math.min(RINGS.length - 1, run.ring));
  }
  const target = RINGS[run.ring];
  if (run.r < target) run.r = Math.min(target, run.r + CROSS_SPEED * STEP); else if (run.r > target) run.r = Math.max(target, run.r - CROSS_SPEED * STEP);
  run.th += omegaAt(run.r) * STEP;
  run.n++;
  const time = run.n * STEP;
  run.fuel -= FUEL_DRAIN * STEP;
  if (run.inv > 0) run.inv = Math.max(0, run.inv - STEP);
  const sx = Math.cos(run.th) * run.r, sy = Math.sin(run.th) * run.r;
  for (const o of field.at(time)) {
    if (run.gone.includes(o.id)) continue;
    const [ox, oy] = posOf(o, time), d2 = (ox - sx) ** 2 + (oy - sy) ** 2, rr = (o.r + SHIP_R) ** 2;
    if (o.kind === 'pod') {
      if (d2 < rr * 1.25) { run.gone.push(o.id); run.fuel = Math.min(100, run.fuel + POD_FUEL); run.pods++; }
    } else if (time >= o.solid && d2 < rr * 0.8) {
      run.gone.push(o.id);
      if (run.inv <= 0) { run.hull--; run.hits++; run.inv = INVULN; if (run.hull <= 0) { run.over = true; run.why = 'hull'; } }
    }
  }
  run.score = Math.floor(time) + run.pods * POD_POINTS;
  if (run.fuel <= 0 && !run.over) { run.fuel = 0; run.over = true; run.why = 'fuel'; }
  return run;
}

/** play a whole replay (`taps`: the steps the button was pressed on) on a seed: the final run */
export function replay(seed, taps, maxSteps = 120 * 600) {
  const field = makeField(seed), run = newRun();
  let k = 0;
  while (!run.over && run.n < maxSteps) {
    while (k < taps.length && taps[k] < run.n) k++;
    const f = k < taps.length && taps[k] === run.n;
    if (f) k++;
    step(run, field, f);
  }
  return run;
}
