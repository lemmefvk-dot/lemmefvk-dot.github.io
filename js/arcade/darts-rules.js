/* ============================================================
   arcade/darts-rules.js — the board and the rules of Darts, with
   no drawing and no clock, so they can be tested on their own.

   The board is the standard one, measured in millimetres from the
   centre of the bull with y pointing down: sectors run clockwise
   from the top in the order 20 1 18 4 13 6 10 15 2 17 3 19 7 16 8
   11 14 9 12 5; the bull is 12.7 mm across and the outer bull 31.8;
   the treble ring is 99–107 mm out and the double ring 162–170.

   501: start on 501 and count down. A turn is three darts. You must
   finish exactly on 0 with a double (the bull counts as a double).
   Going below 0, landing on 1, or reaching 0 on anything but a
   double is a bust: the turn ends and the score goes back to what it
   was before the turn's first dart.

   Around the Clock: hit 1, then 2 … up to 20 in order, then the bull
   (inner or outer). Any part of the target's sector counts.
   ============================================================ */
export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const RAD = { bull: 6.35, outer: 15.9, trebleIn: 99, trebleOut: 107, doubleIn: 162, doubleOut: 170 };

const miss = { ring: 'miss', n: 0, points: 0, double: false, bull: false, label: 'Miss' };

/* what a dart landing at (x, y) mm scores */
export function scoreAt(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ...miss };
  const r = Math.hypot(x, y);
  if (r <= RAD.bull) return { ring: 'bull', n: 25, points: 50, double: true, bull: true, label: 'Bull' };
  if (r <= RAD.outer) return { ring: 'outer', n: 25, points: 25, double: false, bull: true, label: 'Outer bull' };
  if (r > RAD.doubleOut) return { ...miss };
  const deg = ((Math.atan2(x, -y) * 180) / Math.PI + 360 + 9) % 360;
  const n = ORDER[Math.floor(deg / 18) % 20];
  if (r >= RAD.doubleIn) return { ring: 'double', n, points: n * 2, double: true, bull: false, label: `D${n}` };
  if (r >= RAD.trebleIn && r <= RAD.trebleOut) return { ring: 'treble', n, points: n * 3, double: false, bull: false, label: `T${n}` };
  return { ring: 'single', n, points: n, double: false, bull: false, label: String(n) };
}

/* ------------------------------ 501 ------------------------------ */
export const newMatch = (start = 501) => ({ start, remaining: start, turnStart: start, dartsInTurn: 0, thrown: 0, over: false });

/* One dart. Returns { m, event, turnOver } with event 'ok' | 'bust' | 'win'; m.dartsInTurn is back
   to 0 when the turn is over (a bust, a win, or the third dart). */
export function applyDart(m, dart) {
  if (m.over) return { m, event: 'over', turnOver: true };
  const next = { ...m, thrown: m.thrown + 1, dartsInTurn: m.dartsInTurn + 1 };
  const left = m.remaining - dart.points;
  let event = 'ok';
  if (left < 0 || left === 1 || (left === 0 && !dart.double)) {
    event = 'bust';
    next.remaining = m.turnStart;
  } else if (left === 0) {
    event = 'win';
    next.remaining = 0;
    next.over = true;
  } else {
    next.remaining = left;
  }
  const turnOver = event !== 'ok' || next.dartsInTurn >= 3;
  if (turnOver) { next.dartsInTurn = 0; next.turnStart = next.remaining; }
  return { m: next, event, turnOver };
}

/* every dart a player can throw, with its label and whether it is a double */
const DARTS = [];
for (let n = 1; n <= 20; n++) {
  DARTS.push({ label: `T${n}`, points: n * 3, double: false }, { label: `D${n}`, points: n * 2, double: true }, { label: String(n), points: n, double: false });
}
DARTS.push({ label: 'Bull', points: 50, double: true }, { label: '25', points: 25, double: false });
const BYSCORE = [...DARTS].sort((a, b) => b.points - a.points);
const FINISH = [40, 32, 36, 24, 20, 16, 38, 34, 28, 30, 26, 22, 18, 14, 12, 10, 8, 6, 4, 2, 50]
  .map(p => DARTS.find(d => d.double && d.points === p));

/* A way to finish from `left` in at most `darts` darts, ending on a double: a list of labels, or null.
   Fewest darts first; the early darts are the biggest that still leave a finish. */
export function checkout(left, darts = 3) {
  if (!Number.isInteger(left) || left < 2 || left > 170) return null;
  const go = (rest, k) => {
    if (k === 1) { const f = FINISH.find(d => d.points === rest); return f ? [f.label] : null; }
    for (const d of BYSCORE) {
      if (d.points >= rest - 1) continue;
      const tail = go(rest - d.points, k - 1);
      if (tail) return [d.label, ...tail];
    }
    return null;
  };
  for (let k = 1; k <= darts; k++) { const r = go(left, k); if (r) return r; }
  return null;
}

/* ------------------------- Around the Clock ------------------------- */
export const CLOCK_TARGETS = 21;                       /* 1..20, then the bull */
export const newClock = () => ({ target: 1, thrown: 0, over: false });
export function applyClock(c, dart) {
  if (c.over) return { c, hit: false };
  const hit = c.target <= 20 ? dart.n === c.target && !dart.bull : dart.bull;
  const next = { ...c, thrown: c.thrown + 1 };
  if (hit) { next.target = c.target + 1; if (next.target > CLOCK_TARGETS) next.over = true; }
  return { c: next, hit };
}
export const clockName = t => (t <= 20 ? String(t) : 'Bull');
