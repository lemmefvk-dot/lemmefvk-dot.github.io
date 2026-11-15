/* ============================================================
   arcade/sim-core.js — what the batch-newgames4 score games share
   that needs no screen (the engine that draws them is ./simkit.js).

   A round is fixed 1/60 s steps and a log of input events, each
   [step, code, ...args]: the event is applied just before that step.
   The same seed and the same log is the same round on any device,
   which is what a ghost, a replay and a Beat-this link rely on.

   A game's rules module exports { create(seed), step(s), act(s, code,
   ...args), score(s) } and fills s.ev with { type, … } events the
   screen can make sounds from.
   ============================================================ */
export const DT = 1 / 60;
export const MAX_STEPS = 60 * 60 * 30;

/* a small seeded generator that lives in the state, so a replay draws the same numbers */
export function nextRand(s) {
  s.r = (s.r + 0x6D2B79F5) >>> 0;
  let t = s.r;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** play a log from the start to the end of the round (or `until` steps) */
export function replayLog(L, seed, log, until = MAX_STEPS) {
  const s = L.create(seed);
  let k = 0;
  while (!s.over && s.t < until) {
    while (k < log.length && log[k][0] <= s.t) { L.act(s, ...log[k].slice(1)); k++; }
    L.step(s);
    s.ev.length = 0;
  }
  return s;
}

/** a log from the wire: only [integer step, string code, …finite numbers], not too many */
export function cleanLog(log) {
  if (!Array.isArray(log) || log.length > 40000) return null;
  const out = [];
  let last = 0;
  for (const e of log) {
    if (!Array.isArray(e) || e.length < 2 || e.length > 5 || !Number.isInteger(e[0]) || e[0] < last || typeof e[1] !== 'string' || e[1].length > 4) return null;
    for (let i = 2; i < e.length; i++) if (!Number.isFinite(e[i])) return null;
    last = e[0];
    out.push(e);
  }
  return out;
}
