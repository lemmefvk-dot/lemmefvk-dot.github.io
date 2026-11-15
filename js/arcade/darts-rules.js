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

/* ------------------------------ Cricket ------------------------------
   The numbers 15 to 20 and the bull. A single is one mark, a double
   two, a treble three (the outer bull one, the bull two). Three marks
   close a number. Marks past three on a number you have closed and an
   opponent has not score its value (25 for the bull). You win once
   every number is closed and your points are at least the others'.
   Alone there is nobody to score against: close all seven, fewest
   darts wins. */
export const CRICKET = [20, 19, 18, 17, 16, 15, 25];
export const newCricket = (players = 1) => ({
  players, marks: Array.from({ length: players }, () => Object.fromEntries(CRICKET.map(n => [n, 0]))),
  points: Array(players).fill(0), over: null,
});
/* what a dart is worth in Cricket: the number and its marks (0 for anything else) */
export function cricketMarks(d) {
  if (d.bull) return { n: 25, marks: d.points === 50 ? 2 : 1 };
  if (!CRICKET.includes(d.n)) return { n: d.n, marks: 0 };
  return { n: d.n, marks: d.ring === 'treble' ? 3 : d.ring === 'double' ? 2 : 1 };
}
export const closedAll = (c, who) => CRICKET.every(n => c.marks[who][n] >= 3);
/* One dart by `who`. Returns { c, n, marks, scored, closed, win }. */
export function applyCricket(c, who, d) {
  if (c.over) return { c, n: 0, marks: 0, scored: 0, closed: false, win: false };
  const { n, marks } = cricketMarks(d);
  const next = { ...c, marks: c.marks.map(m => ({ ...m })), points: c.points.slice() };
  if (!marks) return { c: next, n, marks: 0, scored: 0, closed: false, win: false };
  const had = next.marks[who][n], now = Math.min(3, had + marks), extra = had + marks - now;
  next.marks[who][n] = now;
  const othersOpen = next.marks.some((m, i) => i !== who && m[n] < 3);
  const scored = extra && othersOpen ? extra * n : 0;
  next.points[who] += scored;
  const win = closedAll(next, who) && next.points.every((p, i) => i === who || next.points[who] >= p);
  if (win) next.over = { winner: who };
  return { c: next, n, marks, scored, closed: had < 3 && now === 3, win };
}

/* ------------------------- aiming (the computer) ------------------------- */
/* the middle of a bed on the board, in mm: { x, y } for a label like T20, D16, 7, Bull, 25 */
export function spotOf(label) {
  if (label === 'Bull') return { x: 0, y: 0 };
  if (label === '25') return { x: 0, y: -(RAD.bull + RAD.outer) / 2 };
  const m = /^([TD]?)(\d+)$/.exec(label);
  if (!m) return { x: 0, y: 0 };
  const n = Number(m[2]), i = ORDER.indexOf(n);
  const r = m[1] === 'T' ? (RAD.trebleIn + RAD.trebleOut) / 2 : m[1] === 'D' ? (RAD.doubleIn + RAD.doubleOut) / 2 : (RAD.trebleOut + RAD.doubleIn) / 2;
  const a = (i * 18 * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}
/* The computer's levels: how widely its darts land around the spot it aims at (mm, one standard deviation). */
export const CPU = {
  easy: { id: 'easy', name: 'Easy', spread: 30 },
  medium: { id: 'medium', name: 'Medium', spread: 17 },
  hard: { id: 'hard', name: 'Hard', spread: 8 },
};
/* What the computer aims at. 501: once a finish is in reach it follows checkout() — the same route the
   game suggests to you — dart by dart; before that the treble 20 (the 19 when the 20 would leave no
   sensible finish). Cricket: the highest number it hasn't closed (the bull last), or, once all are closed
   but it is behind on points, a number it can still score on. */
export function cpuTarget(game, state, who, dartsLeft) {
  if (game === '501') {
    const left = state.remaining;
    const route = checkout(left, dartsLeft);
    if (route) return route[0];
    if (left <= 60 && left > 1) {
      /* no finish this turn: set one up, a single that leaves an even number with a clean double */
      for (const n of [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
        const rest = left - n;
        if (rest >= 2 && rest <= 40 && rest % 2 === 0) return String(n);
      }
      return '1';
    }
    return left - 60 === 1 || left - 60 < 0 ? 'T19' : 'T20';
  }
  const mine = state.marks[who];
  const open = CRICKET.filter(n => mine[n] < 3);
  const bed = n => (n === 25 ? 'Bull' : `T${n}`);
  if (open.length) return bed(open.filter(n => n !== 25)[0] ?? 25);
  const scoring = CRICKET.filter(n => state.marks.some((m, i) => i !== who && m[n] < 3));
  return bed(scoring.filter(n => n !== 25)[0] ?? 25);
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
