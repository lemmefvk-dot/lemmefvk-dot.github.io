/* ============================================================
   arcade/daily-state.js — what this device remembers about Daily
   Stars: each level's board (to carry on later), solved or not, the
   time it took, the hints used, and the streaks. Read by the Arcade's
   home ("Today's puzzle"), by the game (./daily.js), and by Daily
   Word (./dailyword.js) for the daily streak they share.

   Saved in the OS store at 'portal.arcadeDaily' (so in this browser
   only, and per person, like every Arcade score — nothing is sent
   anywhere, and nobody else's results exist to show):
     { v: 1,
       day: 'YYYY-MM-DD',          Normal's puzzle, which the board below belongs to
       marks: '0120…',             one per cell: 0 empty, 1 ✕, 2 star
       ms: 81234,                  time spent on it (only while on screen)
       solved: false, solvedMs: 0,
       hints: 0,                   hints used on that board
       streak: { cur, best, last } last = the last day solved
       days: { 'YYYY-MM-DD': seconds }   the last 120 solved days
       hinted: { 'YYYY-MM-DD': n }       those of them solved with hints
       levels: { easy: {…the same fields…}, hard: {…} }
       all: { cur, best, last } }  the daily streak: see below
   Normal's fields stay at the top, where they were before levels
   came, so a streak from then carries on as Normal's.

   STREAKS. Each level keeps its own. Solving day D after solving D-1
   adds one; after a gap it starts again at 1. The streak shown is 0
   once a whole day has gone by unsolved (yesterday's puzzle is still
   fair game until tonight's midnight). Solving a day twice changes
   nothing. The DAILY streak (`all`) follows the same rules, counting
   a day when any daily puzzle was solved: Daily Stars at any level,
   or Daily Word (countDay()). Daily Word keeps its own streak too,
   with these same rules (./dailykit.js).
   ============================================================ */
import { store } from '../core/store.js';
import { dayKey, addDays, isDayKey, generate, isLevel, LEVELS } from './stars.js';

export const KEY = 'portal.arcadeDaily';
const KEEP_DAYS = 120;
export { LEVELS };

const int = v => (Number.isInteger(v) && v > 0 ? v : 0);
const cleanStreak = s => {
  s = s && typeof s === 'object' ? s : {};
  return { cur: int(s.cur), best: int(s.best), last: isDayKey(s.last) ? s.last : '' };
};
const cleanDays = d => (d && typeof d === 'object' ? Object.fromEntries(Object.entries(d).filter(([k, x]) => isDayKey(k) && Number.isFinite(x))) : {});
function cleanTrack(v) {
  v = v && typeof v === 'object' ? v : {};
  return {
    day: isDayKey(v.day) ? v.day : '',
    marks: typeof v.marks === 'string' && /^[012]*$/.test(v.marks) ? v.marks : '',
    ms: Number.isFinite(v.ms) && v.ms >= 0 ? v.ms : 0,
    solved: v.solved === true,
    solvedMs: Number.isFinite(v.solvedMs) && v.solvedMs >= 0 ? v.solvedMs : 0,
    hints: int(v.hints),
    streak: cleanStreak(v.streak),
    days: cleanDays(v.days),
    hinted: cleanDays(v.hinted),
  };
}

export function read() {
  let v = null;
  try { v = store.get(KEY, null); } catch (err) { v = null; }
  if (!v || typeof v !== 'object') v = {};
  const normal = cleanTrack(v);
  const lv = v.levels && typeof v.levels === 'object' ? v.levels : {};
  return {
    v: 1,
    ...normal,
    level: isLevel(v.level) ? v.level : 'normal',
    levels: { easy: cleanTrack(lv.easy), hard: cleanTrack(lv.hard) },
    /* before the daily streak was kept, Normal's was the only one */
    all: v.all && typeof v.all === 'object' ? cleanStreak(v.all) : { ...normal.streak },
  };
}

function write(st) {
  try { store.set(KEY, st); } catch (err) { /* storage is a convenience; the puzzle still plays */ }
}

/** a level's own record inside the state: Normal's lives at the top */
const trackOf = (st, level) => (level === 'normal' || !isLevel(level) ? st : st.levels[level]);

/** the streak as it stands today: broken (0) once a day was missed. Anything with a `streak`. */
export function currentStreak(st = read(), today = dayKey()) {
  const { cur, last } = st.streak;
  return last === today || last === addDays(today, -1) ? cur : 0;
}

/* one more day on a streak, by the rules above */
function bump(s, day) {
  if (s.last === day || (s.last && s.last > day)) return;
  s.cur = s.last === addDays(day, -1) ? s.cur + 1 : 1;
  s.best = Math.max(s.best, s.cur);
  s.last = day;
}

/** the state for `day`'s board at a level: a fresh board on a new day, the saved one otherwise */
export function board(day = dayKey(), level = 'normal') {
  const t = trackOf(read(), level);
  const p = generate(day, level);
  if (t.day !== day || t.marks.length !== p.n * p.n) {
    return { day, level, marks: '0'.repeat(p.n * p.n), ms: 0, solved: false, solvedMs: 0, hints: 0, fresh: true };
  }
  return { day, level, marks: t.marks, ms: t.ms, solved: t.solved, solvedMs: t.solvedMs, hints: t.hints, fresh: false };
}

/** keep the board for `day` at a level (marks, time spent, hints used) */
export function save(day, marks, ms, level = 'normal', hints = null) {
  const st = read();
  const t = trackOf(st, level);
  if (t.day !== day) { t.day = day; t.solved = false; t.solvedMs = 0; t.hints = 0; }
  if (t.solved) return st;                          /* a solved board stays as it was solved */
  t.marks = marks;
  t.ms = Math.max(0, Math.round(ms));
  if (hints !== null) t.hints = int(hints);
  write(st);
  return st;
}

/** `day` was solved at a level with these marks after ms of play: its streak and the daily streak move on.
    -> that level's record, with the daily streak as `all` */
export function solve(day, marks, ms, level = 'normal', hints = null) {
  const st = read();
  const t = trackOf(st, level);
  const already = t.day === day && t.solved;
  if (t.day !== day) t.hints = 0;
  t.day = day;
  t.marks = marks;
  if (!already) {
    t.ms = Math.max(0, Math.round(ms));
    t.solved = true;
    t.solvedMs = t.ms;
    if (hints !== null) t.hints = int(hints);
  }
  bump(t.streak, day);
  bump(st.all, day);
  if (!Number.isFinite(t.days[day])) {
    t.days[day] = Math.round(t.solvedMs / 1000);
    if (t.hints) t.hinted[day] = t.hints;
  }
  const keys = Object.keys(t.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) { delete t.days[k]; delete t.hinted[k]; }
  write(st);
  return { ...t, all: st.all };
}

/** Daily Word (or any other daily puzzle) was solved on `day`: the daily streak counts it. -> the daily streak */
export function countDay(day = dayKey()) {
  const st = read();
  bump(st.all, day);
  write(st);
  return { ...st.all };
}

/** the daily streak as it stands today: { cur, best } */
export function dailyStreak(today = dayKey()) {
  const st = read();
  return { cur: currentStreak({ streak: st.all }, today), best: st.all.best };
}

/** the level picked last, for the home card and the next game */
export const levelPref = () => read().level;
export function setLevel(level) {
  if (!isLevel(level)) return;
  const st = read();
  if (st.level === level) return;
  st.level = level;
  write(st);
}

/** the last `n` days up to `today` at a level, oldest first: [{ day, solved, secs, hints }] — nothing about the boards */
export function calendar(level = 'normal', today = dayKey(), n = 30) {
  const t = trackOf(read(), level);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const secs = t.days[day];
    out.push({ day, solved: Number.isFinite(secs), secs: Number.isFinite(secs) ? secs : null, hints: t.hinted[day] || 0 });
  }
  return out;
}

/** what the Arcade's home shows for today, at a level (the one picked last, unless asked) */
export function status(today = dayKey(), level = null) {
  const st = read();
  const lv = isLevel(level) ? level : st.level;
  const t = trackOf(st, lv);
  const p = generate(today, lv);
  const mine = t.day === today;
  const marks = mine ? t.marks : '';
  return {
    day: today, level: lv, n: p.n, regions: p.regions,
    solved: mine && t.solved,
    ms: mine ? (t.solved ? t.solvedMs : t.ms) : 0,
    hints: mine ? t.hints : 0,
    started: mine && !t.solved && (t.ms > 0 || /[12]/.test(marks)),
    stars: mine ? [...marks].filter(c => c === '2').length : 0,
    marks: mine ? marks : '',
    /* the card's flame is the daily streak, which Daily Word shares */
    streak: currentStreak({ streak: st.all }, today),
    best: st.all.best,
    levelStreak: currentStreak(t, today),
  };
}

export default { KEY, read, board, save, solve, status, currentStreak, countDay, dailyStreak, calendar, levelPref, setLevel };
