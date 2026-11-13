/* ============================================================
   habits.js — habits and streaks for the Habits tab of Static Life.

   A habit has a name, the weekdays it is scheduled on (none picked =
   every day) and a list of the calendar days you ticked. Streaks are
   computed from that list each time; no counter is stored.

   Days are LOCAL calendar days, written 'YYYY-MM-DD' from the clock on
   this computer. Stepping from one day to the next is calendar
   arithmetic (noon on the day, then the date moves), never "add 24
   hours", so the 25-hour day when clocks go back and the 23-hour day
   when they go forward are one day each. A tick is saved as its day
   key, so flying to another time zone does not move a tick you made.

   How a streak is counted (the same words are shown in the app):
   · The current streak is the number of scheduled days in a row, going
     back from today, that you ticked.
   · A scheduled day in the past with no tick breaks it.
   · Today still being open does not: until today is over, an unticked
     scheduled today is neither a miss nor a day in the streak.
   · A day the habit is NOT scheduled on is skipped over: it neither
     adds to the streak nor breaks it. (Mon/Wed/Fri habit, ticked three
     weeks of Mon/Wed/Fri: the streak is 9, and Tue/Thu/Sat/Sun are
     simply not in it.)
   · A tick on a day that is not scheduled is kept and shown as an
     extra, but does not change the streak.
   · Days before the habit's first day (its creation, or the earliest
     tick, whichever is older) were never missed.
   · The best streak is the longest such run over the same history.

     dayKey(ms)  shiftDay(key, n)  weekday(key)
     isScheduled(habit, key)
     streaks(habit, todayKey) -> { current, best, doneToday, scheduledToday, extras }
     week(habit, todayKey, n) -> [{ key, scheduled, done, future }]  oldest first
     toggleDay(habit, key, todayKey) -> new habit (future days are refused)
   ============================================================ */

const pad = n => String(n).padStart(2, '0');
export const dayKey = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const validKey = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && dayKey(new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12).getTime()) === s;
const noon = key => new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), 12);
export const shiftDay = (key, n) => { const d = noon(key); d.setDate(d.getDate() + n); return dayKey(d.getTime()); };
export const weekday = key => noon(key).getDay();            /* 0 Sunday … 6 Saturday */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MAX_HABITS = 30;
const LOOKBACK = 3700;                                        /* days; ten years is plenty */

export const isScheduled = (h, key) => !h.days || !h.days.length || h.days.includes(weekday(key));

export function normHabit(h, i = 0) {
  if (!h || typeof h !== 'object') return null;
  const name = String(h.name || '').trim().slice(0, 60);
  if (!name) return null;
  const days = Array.isArray(h.days) ? [...new Set(h.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : null;
  const done = Array.isArray(h.done) ? [...new Set(h.done.filter(validKey))].sort() : [];
  const rem = h.remind && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.remind.time)
    ? { time: h.remind.time, ids: Array.isArray(h.remind.ids) ? h.remind.ids.map(x => String(x).slice(0, 60)).slice(0, 7) : [] } : null;
  return {
    id: String(h.id || `h${i}`).slice(0, 40), name,
    days: days && days.length && days.length < 7 ? days : null,
    created: validKey(h.created) ? h.created : dayKey(),
    done, remind: rem,
  };
}

const firstDay = h => (h.done.length && h.done[0] < h.created ? h.done[0] : h.created);

export function streaks(h, today = dayKey()) {
  const done = new Set(h.done);
  const start = firstDay(h);
  let current = 0;
  let key = today;
  for (let i = 0; i < LOOKBACK && key >= start; i++, key = shiftDay(key, -1)) {
    if (!isScheduled(h, key)) continue;
    if (done.has(key)) current++;
    else if (key === today) continue;        /* today is still open */
    else break;
  }
  let best = 0, run = 0;
  key = start;
  for (let i = 0; i < LOOKBACK && key <= today; i++, key = shiftDay(key, 1)) {
    if (!isScheduled(h, key)) continue;
    if (done.has(key)) { run++; if (run > best) best = run; }
    else if (key !== today) run = 0;
  }
  let extras = 0;
  for (const k of h.done) if (!isScheduled(h, k)) extras++;
  return { current, best, doneToday: done.has(today), scheduledToday: isScheduled(h, today), extras };
}

export function week(h, today = dayKey(), n = 7) {
  const done = new Set(h.done);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = shiftDay(today, -i);
    out.push({ key, scheduled: isScheduled(h, key), done: done.has(key), future: false });
  }
  return out;
}

export function toggleDay(h, key, today = dayKey()) {
  if (!validKey(key) || key > today) return h;
  const has = h.done.includes(key);
  return { ...h, done: has ? h.done.filter(k => k !== key) : [...h.done, key].sort() };
}

/** The schedule in words. */
export function describeDays(h) {
  if (!h.days) return 'Every day';
  if (h.days.join() === '1,2,3,4,5') return 'Weekdays';
  if (h.days.join() === '0,6') return 'Weekends';
  return h.days.map(d => DAY_NAMES[d]).join(', ');
}

export default { dayKey, shiftDay, weekday, isScheduled, streaks, week, toggleDay, normHabit, describeDays, validKey, DAY_NAMES, MAX_HABITS };
