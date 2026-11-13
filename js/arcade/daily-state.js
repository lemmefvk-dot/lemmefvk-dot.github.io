/* ============================================================
   arcade/daily-state.js — what this device remembers about Daily
   Stars: today's board (to carry on later), solved or not, the time
   it took, and the streak. Read by the Arcade's home ("Today's
   puzzle") and by the game (./daily.js).

   Saved in the OS store at 'portal.arcadeDaily' (so in this browser
   only, like every Arcade score — nothing is sent anywhere, and
   nobody else's results exist to show):
     { v: 1,
       day: 'YYYY-MM-DD',          the puzzle the board below belongs to
       marks: '0120…',             one per cell: 0 empty, 1 ✕, 2 star
       ms: 81234,                  time spent on it (only while on screen)
       solved: false, solvedMs: 0,
       streak: { cur, best, last } last = the last day solved
       days: { 'YYYY-MM-DD': seconds }   the last 120 solved days }

   STREAK. Solving day D after solving D-1 adds one; after a gap it
   starts again at 1. The streak shown is 0 once a whole day has gone
   by unsolved (yesterday's puzzle is still fair game until tonight's
   midnight). Solving a day twice changes nothing.
   ============================================================ */
import { store } from '../core/store.js';
import { dayKey, addDays, isDayKey, generate } from './stars.js';

export const KEY = 'portal.arcadeDaily';
const KEEP_DAYS = 120;

const blank = () => ({ v: 1, day: '', marks: '', ms: 0, solved: false, solvedMs: 0, streak: { cur: 0, best: 0, last: '' }, days: {} });

export function read() {
  let v = null;
  try { v = store.get(KEY, null); } catch (err) { v = null; }
  const b = blank();
  if (!v || typeof v !== 'object') return b;
  const s = v.streak && typeof v.streak === 'object' ? v.streak : {};
  return {
    v: 1,
    day: isDayKey(v.day) ? v.day : '',
    marks: typeof v.marks === 'string' && /^[012]*$/.test(v.marks) ? v.marks : '',
    ms: Number.isFinite(v.ms) && v.ms >= 0 ? v.ms : 0,
    solved: v.solved === true,
    solvedMs: Number.isFinite(v.solvedMs) && v.solvedMs >= 0 ? v.solvedMs : 0,
    streak: {
      cur: Number.isInteger(s.cur) && s.cur > 0 ? s.cur : 0,
      best: Number.isInteger(s.best) && s.best > 0 ? s.best : 0,
      last: isDayKey(s.last) ? s.last : '',
    },
    days: v.days && typeof v.days === 'object' ? Object.fromEntries(Object.entries(v.days).filter(([k, x]) => isDayKey(k) && Number.isFinite(x))) : {},
  };
}

function write(st) {
  try { store.set(KEY, st); } catch (err) { /* storage is a convenience; the puzzle still plays */ }
}

/** the streak as it stands today: broken (0) once a day was missed */
export function currentStreak(st = read(), today = dayKey()) {
  const { cur, last } = st.streak;
  return last === today || last === addDays(today, -1) ? cur : 0;
}

/** the state for `day`'s board: a fresh board on a new day, the saved one otherwise */
export function board(day = dayKey()) {
  const st = read();
  const p = generate(day);
  if (st.day !== day || st.marks.length !== p.n * p.n) {
    return { day, marks: '0'.repeat(p.n * p.n), ms: 0, solved: false, solvedMs: 0, fresh: true };
  }
  return { day, marks: st.marks, ms: st.ms, solved: st.solved, solvedMs: st.solvedMs, fresh: false };
}

/** keep the board for `day` (marks, time spent) */
export function save(day, marks, ms) {
  const st = read();
  if (st.day !== day) { st.day = day; st.solved = false; st.solvedMs = 0; }
  if (st.solved) return st;                          /* a solved board stays as it was solved */
  st.marks = marks;
  st.ms = Math.max(0, Math.round(ms));
  write(st);
  return st;
}

/** `day` was solved with these marks after ms of play: the streak moves on */
export function solve(day, marks, ms) {
  const st = read();
  const already = st.day === day && st.solved;
  st.day = day;
  st.marks = marks;
  if (!already) {
    st.ms = Math.max(0, Math.round(ms));
    st.solved = true;
    st.solvedMs = st.ms;
  }
  const s = st.streak;
  if (s.last !== day && !(s.last && s.last > day)) {
    s.cur = s.last === addDays(day, -1) ? s.cur + 1 : 1;
    s.best = Math.max(s.best, s.cur);
    s.last = day;
  }
  if (!st.days[day]) st.days[day] = Math.round(st.solvedMs / 1000);
  const keys = Object.keys(st.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete st.days[k];
  write(st);
  return st;
}

/** what the Arcade's home shows for today */
export function status(today = dayKey()) {
  const st = read();
  const p = generate(today);
  const mine = st.day === today;
  const marks = mine ? st.marks : '';
  return {
    day: today, n: p.n, regions: p.regions,
    solved: mine && st.solved,
    ms: mine ? (st.solved ? st.solvedMs : st.ms) : 0,
    started: mine && !st.solved && (st.ms > 0 || /[12]/.test(marks)),
    stars: mine ? [...marks].filter(c => c === '2').length : 0,
    marks: mine ? marks : '',
    streak: currentStreak(st, today),
    best: st.streak.best,
  };
}

export default { KEY, read, board, save, solve, status, currentStreak };
