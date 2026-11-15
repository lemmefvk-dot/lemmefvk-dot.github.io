/* ============================================================
   arcade/dailykit.js — the daily puzzle that Sudoku, Sum Grid and
   Mini Crosswords each offer, next to their own puzzles.

   The same for everyone: a day's puzzle comes from the local date
   alone (daySeed: FNV-1a of the game and 'YYYY-MM-DD'), so two
   devices on the same date deal the same puzzle with no server. The
   date is the local calendar day, as for Daily Stars (./stars.js).

   The streak stays on this device, in the game's own saved data
   (portal.arcadePuzzles.<game>.daily, through puzzlekit.js, so per
   person like the rest of the Arcade):
     { day, solved, secs, hints,         today's (or the last) daily
       streak: { cur, best, last },      last = the last day solved
       days: { 'YYYY-MM-DD': secs } }    the last 120 days solved
   Solving day D after solving D-1 adds one; after a gap it starts
   again at 1. The streak shown is 0 once a whole day has gone by
   unsolved (yesterday's puzzle still counts until midnight tonight).
   Solving a day twice changes nothing. Nobody else's results exist
   here, so none are shown.
   ============================================================ */
import { dayKey, addDays, isDayKey, parseDay } from './stars.js';
import { hash32 } from './challenge.js';
import { load, save } from './puzzlekit.js';

export { dayKey, addDays, parseDay };
const KEEP_DAYS = 120;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekday = (day = dayKey()) => WEEKDAYS[parseDay(day).getDay()];

/** the seed of `game`'s puzzle for `day` (uint32, the same on every device) */
export const daySeed = (game, day = dayKey()) => hash32(`staticos-daily:${game}:${day}`);

const int = v => (Number.isInteger(v) && v > 0 ? v : 0);
function read(game) {
  const d = load(game).daily;
  const s = d && typeof d.streak === 'object' && d.streak ? d.streak : {};
  return {
    day: d && isDayKey(d.day) ? d.day : '',
    solved: !!(d && d.solved === true),
    secs: d && Number.isFinite(d.secs) && d.secs >= 0 ? d.secs : 0,
    hints: d ? int(d.hints) : 0,
    streak: { cur: int(s.cur), best: int(s.best), last: isDayKey(s.last) ? s.last : '' },
    days: d && d.days && typeof d.days === 'object' ? Object.fromEntries(Object.entries(d.days).filter(([k, x]) => isDayKey(k) && Number.isFinite(x))) : {},
  };
}

/** the streak as it stands today: broken (0) once a day was missed */
export function currentStreak(st, today = dayKey()) {
  const { cur, last } = st.streak;
  return last === today || last === addDays(today, -1) ? cur : 0;
}

/** what the game shows for today: { day, solved, secs, hints, streak, best } */
export function status(game, today = dayKey()) {
  const st = read(game);
  const mine = st.day === today;
  return { day: today, solved: mine && st.solved, secs: mine ? st.secs : 0, hints: mine ? st.hints : 0, streak: currentStreak(st, today), best: st.streak.best, days: st.days };
}

/** `day`'s puzzle was solved in `secs` (with `hints`): the streak moves on. -> status for that day */
export function solved(game, day, secs, hints = 0) {
  const st = read(game);
  const already = st.day === day && st.solved;
  if (!already) { st.day = day; st.solved = true; st.secs = Math.max(0, Math.round(secs)); st.hints = int(hints); }
  const s = st.streak;
  if (s.last !== day && !(s.last && s.last > day)) {
    s.cur = s.last === addDays(day, -1) ? s.cur + 1 : 1;
    s.best = Math.max(s.best, s.cur);
    s.last = day;
  }
  if (!Number.isFinite(st.days[day])) st.days[day] = st.secs;
  const keys = Object.keys(st.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete st.days[k];
  save(game, { daily: st });
  return { ...status(game, day), already };
}

/* ---------------------------------------------------------------
   The 30-day calendar and the result to copy, shared by Daily Stars
   and Daily Word. Both are spoiler-free by construction: they are
   built from what a day's record holds (solved or not, the time or
   the tries, hints), never from the board or the answer.
   --------------------------------------------------------------- */

/** the last `n` days up to `today`, oldest first: [{ day, solved, value, hints }] from { day: value } and { day: hints } */
export function lastDays(values = {}, hinted = {}, today = dayKey(), n = 30) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const v = values[day];
    out.push({ day, solved: Number.isFinite(v), value: Number.isFinite(v) ? v : null, hints: Number(hinted[day]) || 0 });
  }
  return out;
}

/** "★★·★★★★": the last seven days, solved or not */
export const weekStrip = list => list.slice(-7).map(d => (d.solved ? '★' : '·')).join('');

export const CAL_CSS = `
.dk-cal{display:flex;flex-direction:column;gap:10px;width:min(100%,420px);padding:16px;border-radius:14px;background:var(--fill-1,#1a1622);border:1px solid var(--line-1,#2c2638);color:var(--ink-1,#ddd)}
.dk-cal__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.dk-cal__head b{font-size:var(--fs-15,15px);color:var(--ink-0,#fff)}
.dk-cal__head small{font-size:var(--fs-12,12px);color:var(--ink-2,#bbb)}
.dk-cal__wd,.dk-cal__grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;margin:0;padding:0;list-style:none}
.dk-cal__wd span{font-size:var(--fs-11,11px);font-weight:700;color:var(--ink-3,#999);text-align:center}
.dk-cal__d{position:relative;aspect-ratio:1;display:grid;place-items:center;border-radius:8px;font:700 var(--fs-12,12px)/1 var(--font,system-ui);
  color:var(--ink-2,#bbb);background:var(--fill-0,#120f18);border:1px solid var(--line-1,#2c2638)}
.dk-cal__d.is-solved{color:#06210f;background:#3ddc84;border-color:#3ddc84}
.dk-cal__d.is-today{box-shadow:0 0 0 2px var(--ga,#ffd35c)}
.dk-cal__d i{position:absolute;right:2px;top:1px;font-style:normal;font-size:9px;line-height:1;color:#7a5600}
.dk-cal__gap{visibility:hidden}
.dk-cal__key{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0;font-size:var(--fs-11,11px);color:var(--ink-3,#999)}
`;

/**
 * The calendar: the last 30 days as a month-style grid, each day solved or not.
 *   list   lastDays(...)    say(d) -> the words for a solved day ("in 2:31", "in 4 tries")
 *   hints  false for a game with no hints: no "no hints" stars
 */
export function calendarView(h, list, { title = 'Last 30 days', say = () => '', hints = true } = {}) {
  const long = d => parseDay(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const solved = list.filter(d => d.solved);
  const clean = solved.filter(d => !d.hints).length;
  const hintText = d => (!hints ? '' : d.hints ? `, ${d.hints === 1 ? '1 hint' : `${d.hints} hints`}` : ', no hints');
  const first = parseDay(list[0].day).getDay();          /* 0 Sunday */
  const lead = (first + 6) % 7;                            /* weeks start on Monday */
  const today = list[list.length - 1].day;
  const wd = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return h('section.dk-cal', { 'aria-label': title },
    h('div.dk-cal__head', h('b', { text: title }),
      h('small', { text: `${solved.length} of ${list.length} days solved${solved.length && hints ? ` · ${clean} with no hints` : ''}` })),
    h('div.dk-cal__wd', { 'aria-hidden': 'true' }, wd.map(x => h('span', { text: x }))),
    h('ol.dk-cal__grid',
      Array.from({ length: lead }, () => h('li.dk-cal__d.dk-cal__gap', { 'aria-hidden': 'true' })),
      list.map(d => h('li.dk-cal__d', {
        class: [d.solved ? 'is-solved' : '', d.day === today ? 'is-today' : '', hints && d.solved && !d.hints ? 'is-clean' : ''].filter(Boolean).join(' '),
        dataset: { day: d.day, solved: String(d.solved) },
        'aria-label': `${long(d.day)}: ${d.solved ? `solved ${say(d)}${hintText(d)}` : d.day === today ? 'not solved yet' : 'not solved'}`,
        title: d.solved ? `Solved ${say(d)}${hintText(d)}` : null,
      }, h('span', { text: String(parseDay(d.day).getDate()) }), hints && d.solved && !d.hints ? h('i', { 'aria-hidden': 'true', text: '★' }) : null))),
    h('p.dk-cal__key', h('span', { text: 'Green: solved' }), hints ? h('span', { text: '★ no hints' }) : null, h('span', { text: 'Ringed: today' })));
}

/** Copies text; false when the browser would not (show the text to copy by hand then). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (err) { return false; }
}

export default { dayKey, addDays, weekday, daySeed, status, solved, currentStreak, lastDays, weekStrip, calendarView, copyText };
