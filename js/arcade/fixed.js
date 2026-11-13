/* ============================================================
   arcade/fixed.js — a fixed-timestep driver.

   The sports games (Darts, Pool, Archery, Lap Rush) advance their
   world in equal slices of DT seconds, however long a frame took:
   advance(dt) runs step(DT) as many times as fit, and carries the
   remainder to the next frame, so a 30 Hz and a 240 Hz screen play
   the same game. A long stall is clamped (maxFrame) so the game
   never tries to catch up on seconds it was not shown.
   ============================================================ */
export function fixedStepper(DT, step, maxFrame = 0.1) {
  let acc = 0;
  return {
    DT,
    advance(dt) {
      acc += Math.min(maxFrame, Math.max(0, dt));
      let n = 0;
      while (acc >= DT - 1e-9) { acc -= DT; step(DT); n++; }
      return n;
    },
    reset() { acc = 0; },
    get leftover() { return acc; },
  };
}
