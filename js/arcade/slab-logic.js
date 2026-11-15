/* ============================================================
   arcade/slab-logic.js — the rules of Slab Tower, with no screen in
   them (the game is ./slab.js; the suite plays this module too).

   A slab slides across the top of the tower and the one input is
   "drop". Whatever hangs over the slab below is cut off and falls;
   what is left is the width of the next slab. Land within 4 units of
   dead centre and nothing is cut: the slab keeps its width, and after
   three such perfect drops in a row it grows a little back. Miss the
   tower and the round is over.

   Score: 1 for every floor, and 3 for a perfect one. The slab's speed
   climbs with the floor, jittered a little by the seed (the same seed
   is the same speeds on any device). A round is fixed 1/60 s steps
   and the log of drops (step) plays it again exactly.
   ============================================================ */
import { hash32 } from './challenge.js';
import { nextRand, replayLog } from './sim-core.js';

export const VW = 400, VH = 560;
export const LO = 70, HI = 330;           /* the slab's centre travels between these */
export const START_W = 140, MAX_W = 170, PERFECT = 4, GROW = 6;
export const SLAB_H = 22;

export const speedOf = (floor, jit) => Math.min(330, 120 + floor * 6) * (1 + jit);

export function create(seed = 1) {
  const s = { seed: seed >>> 0, r: hash32(`staticos-slab:${seed >>> 0}`) || 1, t: 0, over: false, ev: [], floors: 0, perfects: 0, streak: 0, best: 0, score: 0,
    w: START_W, slabs: [{ c: 200, w: START_W, perfect: false }], cur: { s0: 0, side: 0, v: 0 } };
  s.cur.v = speedOf(0, (nextRand(s) - 0.5) * 0.2);
  return s;
}

/** where the sliding slab's centre is at step t */
export function posAt(s, t) {
  const L = HI - LO, d = s.cur.v * (t - s.cur.s0) / 60, m = d % (2 * L), p = m < L ? m : 2 * L - m;
  return s.cur.side ? HI - p : LO + p;
}

export function step(s) { if (!s.over) s.t++; }

/** the one input: 'd' drops the slab where it is now */
export function act(s, code) {
  if (s.over || code !== 'd') return false;
  const top = s.slabs[s.slabs.length - 1];
  const c = posAt(s, s.t), diff = c - top.c, ad = Math.abs(diff);
  if (ad >= s.w - 2) {
    s.over = true;
    s.ev.push({ type: 'miss', c, w: s.w, f: s.floors + 1 });
    return true;
  }
  let w = s.w, nc = c, perfect = false;
  if (ad <= PERFECT) {
    perfect = true; nc = top.c; s.streak++; s.perfects++;
    if (s.streak >= 3) w = Math.min(MAX_W, w + GROW);
    s.score += 3;
  } else {
    w = s.w - ad; nc = top.c + diff / 2; s.streak = 0;
    s.score += 1;
    /* the piece that hangs over falls: its centre and width */
    s.ev.push({ type: 'cut', c: diff > 0 ? nc + w / 2 + ad / 2 : nc - w / 2 - ad / 2, w: ad, f: s.floors + 1 });
  }
  s.w = w;
  s.floors++;
  s.slabs.push({ c: nc, w, perfect });
  s.ev.push({ type: 'drop', perfect, streak: s.streak, floors: s.floors });
  s.cur = { s0: s.t, side: s.floors & 1, v: speedOf(s.floors, (nextRand(s) - 0.5) * 0.2) };
  return true;
}

export const score = s => s.score;
export const replay = (seed, log, until) => replayLog({ create, step, act }, seed, log, until);
export default { VW, VH, create, step, act, score, replay, posAt };
