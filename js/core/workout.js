/* ============================================================
   workout.js — the interval timer behind the Workout tab of Static Life.

   A routine is: warm-up, then `rounds` of work + rest (no rest after the
   last round), then cool-down. Any of warm-up, rest and cool-down can be
   0 seconds, which leaves that part out. All lengths are whole seconds.

   Time comes from timestamps, never from counting ticks (the same rule
   as the Focus timer, js/core/focus.js): a running workout stores the
   moment it was started or resumed and how much it had already run
   before that. Where it is at any instant is a pure function of the
   clock, so a tab that is throttled in the background (its timers fire
   seconds late, or not at all) loses nothing; the next time anything
   looks, it shows where the workout really is. Pause stores the elapsed
   time, resume starts a new stretch, skip moves the elapsed time to the
   end of the current part.

   Nothing here keeps a timer going or makes a sound; the tab asks
   `position()` as often as it likes and decides about cues itself.

     segments(routine)          -> [{ kind, label, dur (ms), round, rounds }]
     totalMs(routine)
     clean(routine)             a routine with every field in range
     runner(routine, now)       -> { start, pause, resume, skip, position, status }
     positionAt(segs, elapsed)  -> { index, into, left, done }
   ============================================================ */

export const LIMITS = { warm: [0, 600], work: [5, 3600], rest: [0, 3600], rounds: [1, 99], cool: [0, 600] };
export const DEFAULT_ROUTINE = { name: 'Quick circuit', warm: 10, work: 30, rest: 15, rounds: 4, cool: 0 };
export const MAX_ROUTINES = 30;
export const KINDS = { warm: 'Warm-up', work: 'Work', rest: 'Rest', cool: 'Cool-down' };

const whole = (v, [lo, hi], d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function clean(r, i = 0) {
  const o = r && typeof r === 'object' ? r : {};
  const name = String(o.name || '').trim().slice(0, 40);
  if (!name) return null;
  const out = { id: String(o.id || `w${i}`).slice(0, 40), name };
  for (const k of Object.keys(LIMITS)) out[k] = whole(o[k], LIMITS[k], DEFAULT_ROUTINE[k]);
  return out;
}

export function segments(r) {
  const out = [];
  const add = (kind, secs, round) => out.push({ kind, label: KINDS[kind], dur: secs * 1000, round, rounds: r.rounds });
  if (r.warm > 0) add('warm', r.warm, 0);
  for (let i = 1; i <= r.rounds; i++) {
    add('work', r.work, i);
    if (r.rest > 0 && i < r.rounds) add('rest', r.rest, i);
  }
  if (r.cool > 0) add('cool', r.cool, 0);
  return out;
}
export const totalMs = r => segments(r).reduce((t, s) => t + s.dur, 0);

/** Which part `elapsed` ms into the workout is in. `done` once it is past the end. */
export function positionAt(segs, elapsed) {
  let t = Math.max(0, elapsed);
  for (let i = 0; i < segs.length; i++) {
    if (t < segs[i].dur) return { index: i, into: t, left: segs[i].dur - t, done: false };
    t -= segs[i].dur;
  }
  return { index: segs.length, into: 0, left: 0, done: true };
}

/** A workout in progress. `now` is a function returning the clock in ms (Date.now). */
export function runner(routine, now = Date.now) {
  const segs = segments(routine);
  const total = segs.reduce((t, s) => t + s.dur, 0);
  let status = 'ready';          /* ready | running | paused | done */
  let base = 0;                  /* ms run before the current stretch */
  let since = 0;                 /* when the current stretch began (running only) */

  const elapsed = () => {
    if (status === 'running') return Math.min(total, base + Math.max(0, now() - since));
    return status === 'done' ? total : base;
  };
  const look = () => {
    if (status === 'running' && elapsed() >= total) { base = total; status = 'done'; }
    return status;
  };
  return {
    segs, total,
    get status() { return look(); },
    elapsed: () => { look(); return elapsed(); },
    start() { if (status === 'ready') { base = 0; since = now(); status = 'running'; } },
    pause() { if (look() === 'running') { base = elapsed(); status = 'paused'; } },
    resume() { if (look() === 'paused') { since = now(); status = 'running'; } },
    /** to the start of the next part (the end of the workout, from the last one) */
    skip() {
      const s = look();
      if (s !== 'running' && s !== 'paused') return;
      const p = positionAt(segs, elapsed());
      let end = 0;
      for (let i = 0; i <= p.index && i < segs.length; i++) end += segs[i].dur;
      base = end;
      if (s === 'running') since = now();
      if (end >= total) { base = total; status = 'done'; }
    },
    position() {
      const s = look();
      const p = positionAt(segs, elapsed());
      return { ...p, status: s, seg: segs[p.index] || null, next: segs[p.index + 1] || null, elapsed: elapsed(), total };
    },
  };
}

export default { segments, totalMs, positionAt, runner, clean, LIMITS, DEFAULT_ROUTINE, KINDS };
