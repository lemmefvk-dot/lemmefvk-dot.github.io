/* ============================================================
   arcade/bowling-rules.js — ten-pin scoring, with no graphics.

   A game is the list of pins knocked down by each ball ("rolls").
   Frames 1–9: a strike (10 on the first ball) ends the frame and
   scores 10 plus the next TWO balls; a spare (the second ball
   clears what is left) scores 10 plus the next ONE ball; an open
   frame scores its pins. Frame 10: a strike or spare earns the
   extra ball(s) — up to three balls, the rack set up again each
   time it is cleared — and those balls score only their pins.
   A perfect game is twelve strikes = 300.

   frames(rolls)  -> ten frames { rolls, marks, score, done }
                     (score is the running total, or null while the
                      bonus balls it needs have not been rolled)
   state(rolls)   -> where the next ball is thrown:
                     { over, frame, ball, up, fresh }
                     up = pins standing before it; fresh = a full rack
   validRoll(rolls, pins) / total(rolls) / rollsToCard(rolls)
   ============================================================ */

export const PINS = 10;
export const FRAMES = 10;

/* Where is the game after these rolls? (the rolls are assumed legal) */
export function state(rolls) {
  let i = 0;
  for (let f = 1; f < FRAMES; f++) {
    if (i >= rolls.length) return { over: false, frame: f, ball: 1, up: PINS, fresh: true };
    if (rolls[i] === PINS) { i += 1; continue; }
    if (i + 1 >= rolls.length) return { over: false, frame: f, ball: 2, up: PINS - rolls[i], fresh: false };
    i += 2;
  }
  /* frame 10 */
  const a = rolls[i], b = rolls[i + 1], c = rolls[i + 2];
  if (a === undefined) return { over: false, frame: FRAMES, ball: 1, up: PINS, fresh: true };
  if (b === undefined) return a === PINS
    ? { over: false, frame: FRAMES, ball: 2, up: PINS, fresh: true }
    : { over: false, frame: FRAMES, ball: 2, up: PINS - a, fresh: false };
  if (a === PINS) {
    if (c === undefined) return b === PINS
      ? { over: false, frame: FRAMES, ball: 3, up: PINS, fresh: true }
      : { over: false, frame: FRAMES, ball: 3, up: PINS - b, fresh: false };
    return { over: true, frame: FRAMES, ball: 3, up: 0, fresh: false };
  }
  if (a + b === PINS) {
    if (c === undefined) return { over: false, frame: FRAMES, ball: 3, up: PINS, fresh: true };
    return { over: true, frame: FRAMES, ball: 3, up: 0, fresh: false };
  }
  return { over: true, frame: FRAMES, ball: 2, up: 0, fresh: false };
}

/* may `pins` be the next roll? */
export function validRoll(rolls, pins) {
  if (!Number.isInteger(pins) || pins < 0 || pins > PINS) return false;
  const s = state(rolls);
  return !s.over && pins <= s.up;
}

const mark = (pins, up, first) => (pins === up && up === PINS ? 'X' : pins === up && !first ? '/' : pins === 0 ? '-' : String(pins));

export function frames(rolls) {
  const out = [];
  let i = 0, run = 0;
  for (let f = 1; f <= FRAMES; f++) {
    const fr = { rolls: [], marks: [], score: null, done: false };
    out.push(fr);
    if (f < FRAMES) {
      if (rolls[i] === undefined) continue;
      if (rolls[i] === PINS) {
        fr.rolls = [PINS]; fr.marks = ['X']; fr.done = true;
        if (rolls[i + 1] !== undefined && rolls[i + 2] !== undefined) { run += PINS + rolls[i + 1] + rolls[i + 2]; fr.score = run; }
        i += 1;
      } else {
        fr.rolls = [rolls[i]]; fr.marks = [mark(rolls[i], PINS, true)];
        if (rolls[i + 1] !== undefined) {
          const b = rolls[i + 1];
          fr.rolls.push(b); fr.marks.push(rolls[i] + b === PINS ? '/' : b === 0 ? '-' : String(b)); fr.done = true;
          if (rolls[i] + b === PINS) { if (rolls[i + 2] !== undefined) { run += PINS + rolls[i + 2]; fr.score = run; } }
          else { run += rolls[i] + b; fr.score = run; }
        }
        i += 2;
      }
    } else {
      /* the tenth: up to three balls, scored as pins only */
      const t = rolls.slice(i, i + 3);
      if (!t.length) continue;
      let up = PINS;
      t.forEach((p, k) => {
        fr.rolls.push(p);
        fr.marks.push(p === up ? (up === PINS ? 'X' : '/') : p === 0 ? '-' : String(p));
        up = p === up ? PINS : up - p;
        void k;
      });
      const st = state(rolls);
      fr.done = st.over;
      if (fr.done) { run += t.reduce((x, y) => x + y, 0); fr.score = run; }
    }
  }
  return out;
}

/* the running total so far, bonuses included where they are known */
export function total(rolls) {
  let i = 0, sum = 0;
  for (let f = 1; f < FRAMES && i < rolls.length; f++) {
    const a = rolls[i], b = rolls[i + 1];
    if (a === PINS) { sum += PINS + (b ?? 0) + (rolls[i + 2] ?? 0); i += 1; }
    else if (b !== undefined && a + b === PINS) { sum += PINS + (rolls[i + 2] ?? 0); i += 2; }
    else { sum += a + (b ?? 0); i += 2; }
  }
  for (; i < rolls.length; i++) sum += rolls[i];      /* the tenth frame's own balls */
  return sum;
}

/* the final game score (the same sum once every ball is thrown) */
export const finalScore = total;

/* a human-readable card line, e.g. "X | 7 / | 9 - | ..." */
export function cardLine(rolls) {
  return frames(rolls).map(f => f.marks.join(' ') || '·').join(' | ');
}
