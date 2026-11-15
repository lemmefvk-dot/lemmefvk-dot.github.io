/* ============================================================
   calendar.js — Calendar's events, for every part of StaticOS
   that shows them: the Calendar app, the desktop's "Up next"
   widget, and the reminders that go off for them.

   Saved in store('portal.calendar') as
     { v: 2, events: { 'YYYY-MM-DD': [event, …] }, spans: [span, …] }
   keyed by the event's (first) day, which is how the first
   Calendar stored { id, title, time, tone } — those still load.
   An event is
     { id, title,
       allDay   true: the whole day, no times
       time     'HH:MM' start (timed events)
       end      'HH:MM' or '' — optional, after the start
       repeat   'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
                (from its day on: weekly on that weekday, monthly on that
                date — a month without it, like the 31st, is passed over —
                yearly on that month and day)
       every    1–99: every other week is 2 (left out when 1)
       days     weekly only: [0–6] the weekdays it happens on, when more
                than its own (0 = Sunday); its own day is always one
       until    'YYYY-MM-DD' — the last day it can repeat on, or ''
       skip     ['YYYY-MM-DD'] — days a repeating event is left out
       remind   minutes before the start, or null for none
       location, notes   plain text, '' when not given
       uid      the UID it had in an .ics file it came from, or ''
       tone }   one of TONES, the colour it is drawn in
   An all-day event "starts" at midnight, so remind -540 is 9 AM
   on the day and 900 is 9 AM the day before. Events saved before
   any of these fields existed have none of them, and load as
   they always did: no field is required but id, title and day.

   A span ("Terms and breaks") is a run of whole days drawn as a
   banner across the month: { id, title, start, end, tone }, end
   on or after start, both days included. It has no time and no
   reminder. A multi-day all-day event in an .ics file becomes one.

   Nothing here invents events: the calendar starts empty and
   holds exactly what was put in it.

   Reminders are not a second clock: every write hands the
   reminders the events want to js/core/automations.js
   (syncCalendarReminders), which already watches the clock for
   the Automations app's reminders, catches up after sleep, says
   when one was missed, and snoozes. A one-off is a one-off and a
   plain weekly event is the engine's own weekly repeat (exactly
   as before); every other repeat hands the engine the coming days
   it goes off on ('dates'), and init() hands them again each new
   day so the list never runs out. So an event's reminder goes off
   while StaticOS is open — never when it is closed, and the
   Calendar says so.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as AM from './automations.js';

export const KEY = 'portal.calendar';
/* dots and rails borrow the file-kind tints so nothing is hardcoded */
export const TONES = ['--accent', '--kind-doc', '--kind-code', '--kind-image', '--kind-config', '--kind-audio', '--kind-theme'];
export const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
export const TITLE_MAX = 200;
export const LOCATION_MAX = 200;
export const NOTES_MAX = 4000;
export const EVERY_MAX = 99;
export const MAX_EVENTS = 2000;
export const MAX_SPANS = 200;
export const SPAN_DAYS_MAX = 400;
const MAX_SKIP = 200;
const HORIZON = 35;       /* days ahead a 'dates' reminder lists */
const MAX_ON = 40;

const pad2 = n => String(n).padStart(2, '0');
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' for a Date, on this computer's calendar. */
export const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** The Date (local midnight) for 'YYYY-MM-DD', or null. */
export function parseDay(s) {
  const m = DAY_RE.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}
export const validTime = t => TIME_RE.test(String(t || ''));
const minutesOf = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/* ---------- whole days as numbers ---------------------------------------
   'YYYY-MM-DD' as a count of days, read as a plain date (UTC arithmetic),
   so stepping and subtracting days never meets a clock change. */
export const dayNum = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
export const numDay = n => { const t = new Date(n * 864e5); return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`; };
/** 0 = Sunday … 6 = Saturday, for a day number (1 Jan 1970 was a Thursday). */
const wdNum = n => (((n + 4) % 7) + 7) % 7;
export const weekdayOf = s => wdNum(dayNum(s));
export const addDay = (s, n) => numDay(dayNum(s) + n);
/** Whole calendar days from one day to another (negative when it's earlier). */
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);

/** 9:30 AM, or 09:30 on a 24-hour clock. */
export function clockText(t) {
  if (!validTime(t)) return '';
  const [h, m] = t.split(':').map(Number);
  if (store.get('prefs.h24')) return `${pad2(h)}:${pad2(m)}`;
  return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

/* ---------- reminder choices ------------------------------------------ */
const TIMED = [null, 0, 5, 10, 15, 30, 60, 1440];
const ALLDAY = [null, -540, 900];
/** The reminder choices for a timed or an all-day event: [[minutes|null, label], …] */
export function remindChoices(allDay) {
  const nine = clockText('09:00');
  if (allDay) return ALLDAY.map(m => [m, m === null ? 'No reminder' : m < 0 ? `On the day, ${nine}` : `The day before, ${nine}`]);
  return TIMED.map(m => [m, m === null ? 'No reminder' : m === 0 ? 'When it starts'
    : m === 60 ? '1 hour before' : m === 1440 ? '1 day before' : `${m} minutes before`]);
}
export const remindLabel = (m, allDay) => (remindChoices(allDay).find(([v]) => v === m) || [null, ''])[1];
const remindOk = (m, allDay) => (allDay ? ALLDAY : TIMED).includes(m);

/* ---------- words for a repeat ----------------------------------------- */
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const UNITS = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
export const unitOf = repeat => UNITS[repeat] || '';
const shortDate = s => `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;
/** "Every week on Monday", "Every 2 weeks on Mon, Wed", "Every month on the 31st", "Every year on Nov 5"; '' when it doesn't repeat. */
export function repeatText(ev, { until = true } = {}) {
  if (!ev || !ev.repeat || ev.repeat === 'none') return '';
  const n = ev.every > 1 ? ev.every : 1;
  const every = unit => (n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`);
  let s;
  if (ev.repeat === 'daily') s = every('day');
  else if (ev.repeat === 'weekdays') s = 'Every weekday (Mon–Fri)';
  else if (ev.repeat === 'weekly') {
    const days = ev.days && ev.days.length ? ev.days : [weekdayOf(ev.date)];
    const order = [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d));
    s = `${every('week')} on ${order.length === 1 ? DOW_LONG[order[0]] : order.map(d => DOW_SHORT[d]).join(', ')}`;
  } else if (ev.repeat === 'monthly') s = `${every('month')} on the ${ordinal(+ev.date.slice(8, 10))}`;
  else if (ev.repeat === 'yearly') s = `${every('year')} on ${shortDate(ev.date)}`;
  else return '';
  if (until && ev.until) s += `, until ${shortDate(ev.until)}${ev.until.slice(0, 4) !== ev.date.slice(0, 4) ? ` ${ev.until.slice(0, 4)}` : ''}`;
  return s;
}

/* ---------- reading ---------------------------------------------------- */
let eseq = 0;
export const newId = () => `ev-${Date.now().toString(36)}-${(++eseq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const oneLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanNotes = v => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+$/, '').slice(0, NOTES_MAX);

export function normEvent(e, date) {
  if (!e || typeof e !== 'object' || typeof e.title !== 'string' || !e.title.trim() || !parseDay(date)) return null;
  const allDay = e.allDay === true;
  const time = validTime(e.time) ? e.time : '09:00';
  const end = !allDay && validTime(e.end) && minutesOf(e.end) > minutesOf(time) ? e.end : '';
  const repeat = REPEATS.includes(e.repeat) ? e.repeat : 'none';
  const rep = repeat !== 'none';
  const n = Number(e.every);
  const every = rep && repeat !== 'weekdays' && Number.isInteger(n) && n > 1 && n <= EVERY_MAX ? n : 1;
  const until = rep && parseDay(e.until) && e.until >= date ? e.until : '';
  const own = weekdayOf(date);
  let days = repeat === 'weekly' && Array.isArray(e.days) ? [...new Set(e.days.filter(x => Number.isInteger(x) && x >= 0 && x <= 6))] : [];
  if (days.length) { if (!days.includes(own)) days.push(own); days.sort(); if (days.length === 1) days = []; }
  const remind = Number.isFinite(e.remind) && remindOk(e.remind, allDay) ? e.remind : null;
  const skip = rep && Array.isArray(e.skip)
    ? [...new Set(e.skip.filter(s => parseDay(s) && s > date && (!until || s <= until)))].sort().slice(-MAX_SKIP) : [];
  return {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 80) : newId(),
    date, title: e.title.trim().slice(0, TITLE_MAX), allDay, time: allDay ? '' : time, end,
    repeat, every, days, until, skip, remind, tone: TONES.includes(e.tone) ? e.tone : TONES[0],
    location: oneLine(e.location, LOCATION_MAX), notes: cleanNotes(e.notes), uid: typeof e.uid === 'string' ? e.uid.trim().slice(0, 200) : '',
  };
}

export function normSpan(s) {
  const o = s && typeof s === 'object' ? s : null;
  if (!o) return null;
  const title = oneLine(o.title, TITLE_MAX);
  if (!title || !parseDay(o.start) || !parseDay(o.end) || o.end < o.start || daysBetween(o.start, o.end) >= SPAN_DAYS_MAX) return null;
  return { id: typeof o.id === 'string' && o.id ? o.id.slice(0, 80) : newId().replace(/^ev-/, 'sp-'), title, start: o.start, end: o.end,
    tone: TONES.includes(o.tone) ? o.tone : TONES[1], uid: typeof o.uid === 'string' ? o.uid.trim().slice(0, 200) : '' };
}

let cacheFor = undefined;
let cache = [];
let spanCache = [];
function load() {
  const raw = store.get(KEY, null);
  if (raw === cacheFor) return;
  const out = [];
  const seen = new Set();
  const days = raw && typeof raw.events === 'object' && raw.events ? raw.events : {};
  for (const [date, list] of Object.entries(days)) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const n = normEvent(e, date);
      if (!n) continue;
      while (seen.has(n.id)) n.id = newId();
      seen.add(n.id);
      out.push(n);
      if (out.length >= MAX_EVENTS) break;
    }
  }
  const sp = [];
  for (const s of raw && Array.isArray(raw.spans) ? raw.spans : []) {
    const n = normSpan(s);
    if (!n || seen.has(n.id) || sp.length >= MAX_SPANS) continue;
    seen.add(n.id);
    sp.push(n);
  }
  sp.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  cacheFor = raw;
  cache = out;
  spanCache = sp;
}
/** Every event, cleaned: [{ id, date, title, allDay, time, end, repeat, every, days, until, skip, remind, tone, location, notes, uid }]. */
export function events() { load(); return cache; }
export const byId = id => events().find(e => e.id === id) || null;
/** Every term or break, by start: [{ id, title, start, end, tone }]. */
export function spans() { load(); return spanCache; }
export const spanById = id => spans().find(s => s.id === id) || null;
/** The spans that cover a day. */
export const spansOn = (day, list = spans()) => list.filter(s => s.start <= day && day <= s.end);

/* ---------- when an event happens ---------------------------------------- */
/** Does `ev` happen on day 'YYYY-MM-DD'? */
export function occursOn(ev, day) {
  if (!ev || !day) return false;
  if (!ev.repeat || ev.repeat === 'none') return ev.date === day;
  if (day < ev.date || (ev.until && day > ev.until) || (ev.skip && ev.skip.includes(day))) return false;
  if (day === ev.date) return true;
  if (!DAY_RE.test(day)) return false;
  const n = ev.every > 1 ? ev.every : 1;
  if (ev.repeat === 'monthly') {
    if (day.slice(8) !== ev.date.slice(8)) return false;
    return ((+day.slice(0, 4) - +ev.date.slice(0, 4)) * 12 + (+day.slice(5, 7) - +ev.date.slice(5, 7))) % n === 0;
  }
  if (ev.repeat === 'yearly') return day.slice(5) === ev.date.slice(5) && (+day.slice(0, 4) - +ev.date.slice(0, 4)) % n === 0;
  const a = dayNum(ev.date), d = dayNum(day);
  if (ev.repeat === 'daily') return (d - a) % n === 0;
  const w = wdNum(d);
  if (ev.repeat === 'weekdays') return w >= 1 && w <= 5;
  if (ev.repeat === 'weekly') {
    if (ev.days && ev.days.length ? !ev.days.includes(w) : w !== wdNum(a)) return false;
    if (n === 1) return true;
    /* weeks counted Monday to Sunday, as an .ics file counts them */
    const mon = x => x - ((wdNum(x) + 6) % 7);
    return ((mon(d) - mon(a)) / 7) % n === 0;
  }
  return false;
}

/** The first day on or after `from` that the event happens, or null (it has ended). */
export function nextOn(ev, from) {
  if (!ev || !from) return null;
  if (!ev.repeat || ev.repeat === 'none') return ev.date >= from ? ev.date : null;
  const start = from < ev.date ? ev.date : from;
  if (ev.until && start > ev.until) return null;
  const n = ev.every > 1 ? ev.every : 1;
  if (ev.repeat === 'monthly' || ev.repeat === 'yearly') {
    /* step a month (or a year) at a time; a month without that date is passed over */
    let y = +start.slice(0, 4), m = +start.slice(5, 7);
    for (let i = 0; i < 1300; i++) {
      const k = ev.repeat === 'yearly' ? `${y}-${ev.date.slice(5)}` : `${y}-${pad2(m)}-${ev.date.slice(8)}`;
      if (ev.until && k > ev.until && k.slice(0, 7) > ev.until.slice(0, 7)) return null;
      if (k >= start && parseDay(k) && occursOn(ev, k)) return k;
      if (ev.repeat === 'yearly') y++;
      else if (++m > 12) { m = 1; y++; }
    }
    return null;
  }
  const s = dayNum(start);
  const cap = 7 * Math.max(n, 1) * (1 + Math.ceil((ev.skip ? ev.skip.length : 0) / 2)) + 14;
  for (let i = 0; i <= cap; i++) {
    const k = numDay(s + i);
    if (ev.until && k > ev.until) return null;
    if (occursOn(ev, k)) return k;
  }
  return null;
}

/** When an occurrence starts and ends, in ms. A timed event with no end counts as an hour long. */
export function startOf(ev, day) {
  const d = parseDay(day);
  if (!d) return NaN;
  if (ev.allDay) return d.getTime();
  const [h, m] = ev.time.split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
}
export function endOf(ev, day) {
  const d = parseDay(day);
  if (!d) return NaN;
  if (ev.allDay) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  if (ev.end) { const [h, m] = ev.end.split(':').map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime(); }
  return startOf(ev, day) + 60 * 60000;
}
/** Minutes from midnight a timed event starts and ends at (no end: an hour, cut at midnight). */
export function minutesSpan(ev) {
  if (!ev || ev.allDay) return null;
  const s = minutesOf(ev.time);
  return { start: s, end: ev.end ? minutesOf(ev.end) : Math.min(24 * 60, s + 60) };
}

const order = (a, b) => (a.allDay === b.allDay ? (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title) : a.allDay ? -1 : 1);

/** What happens on one day, all-day first, then by time: [{ ...event, on, start, endAt }]. */
export function onDay(day, list = events()) {
  const k = typeof day === 'string' ? day : ymd(day);
  return list.filter(e => occursOn(e, k)).sort(order)
    .map(e => ({ ...e, on: k, start: startOf(e, k), endAt: endOf(e, k) }));
}

/** How many events happen in a month (a repeating one counts on each of its days). */
export function countInMonth(year, month, list = events()) {
  let n = 0;
  const days = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= days; i++) n += onDay(ymd(new Date(year, month, i)), list).length;
  return n;
}

/**
 * What's next: occurrences that haven't finished yet, soonest first, from
 * today through `days` days ahead. -> [{ ...event, on, start, endAt, now }]
 */
export function upcoming(now = Date.now(), { days = 14, limit = 8 } = {}) {
  const list = events();
  if (!list.length) return [];
  const t = new Date(now);
  const out = [];
  for (let i = 0; i <= days && out.length < limit; i++) {
    const k = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + i));
    for (const o of onDay(k, list)) {
      if (o.endAt <= now) continue;
      out.push({ ...o, now: o.start <= now });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The next time an event happens from `now` (or the last one it had), as 'YYYY-MM-DD'. */
export function nextDay(ev, now = Date.now()) {
  if (!ev) return null;
  if (!ev.repeat || ev.repeat === 'none') return ev.date;
  const today = ymd(new Date(now));
  let k = nextOn(ev, today);
  if (k && endOf(ev, k) <= now) k = nextOn(ev, addDay(k, 1));
  if (k) return k;
  /* it has stopped repeating: the last day it had */
  const last = ev.until && ev.until < today ? ev.until : today;
  for (let i = 0, d = dayNum(last); i < 800 && numDay(d - i) >= ev.date; i++) if (occursOn(ev, numDay(d - i))) return numDay(d - i);
  return ev.date;
}

/** Calendar days from today to an occurrence: 0 today, 1 tomorrow, negative when it's gone. */
export const daysUntil = (day, now = Date.now()) => daysBetween(ymd(new Date(now)), day);
/** "Today", "Tomorrow", "In 12 days", "Yesterday", "3 days ago". */
export function untilText(day, now = Date.now()) {
  const n = daysUntil(day, now);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}

/* ---------- reminders --------------------------------------------------- */
/** When the reminder for one occurrence goes off, as a local Date (lead time counted on the clock, so DST can't skew it). */
function remindAt(ev, day) {
  const d = parseDay(day);
  const [h, m] = ev.allDay ? [0, 0] : ev.time.split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m - ev.remind);
}
/** The line under the title when it goes off: "Starts at 9:00 AM", "Tomorrow, all day". */
function subLine(ev) {
  const at = remindAt(ev, ev.date);
  const daysAhead = Math.round((parseDay(ev.date) - new Date(at.getFullYear(), at.getMonth(), at.getDate())) / 864e5);
  const when = daysAhead === 0 ? '' : daysAhead === 1 ? 'Tomorrow' : `In ${daysAhead} days`;
  const where = ev.location ? ` · ${ev.location.slice(0, 40)}` : '';
  if (ev.allDay) return (when ? `${when}, all day` : 'Today, all day') + where;
  const until = ev.end ? ` · until ${clockText(ev.end)}` : '';
  if (when) return `${when} at ${clockText(ev.time)}${until}${where}`;
  return (ev.remind === 0 ? `Starting now · ${clockText(ev.time)}${until}` : `Starts at ${clockText(ev.time)}${until}`) + where;
}
/* the engine's own weekly repeat is exactly a plain weekly event: one weekday, every week, for ever */
const plainWeekly = ev => ev.repeat === 'weekly' && !(ev.every > 1) && !ev.until && !(ev.days && ev.days.length);
/** The days a repeating event's reminder goes off on, from yesterday to HORIZON days ahead (and the next one, however far). */
function remindDays(ev, now) {
  const t = new Date(now);
  const today = ymd(t);
  const from = addDay(today, -1), to = addDay(today, HORIZON);
  const out = [];
  for (let k = nextOn(ev, from); k && k <= to && out.length < MAX_ON; k = nextOn(ev, addDay(k, 1))) out.push(k);
  if (!out.some(k => k >= today)) { const k = nextOn(ev, addDay(to, 1)); if (k) out.push(k); }
  return [...new Set(out.map(k => ymd(remindAt(ev, k))))];
}
/** The reminder an event wants, in the shape automations.js takes, or null. */
export function reminderFor(ev, now = Date.now()) {
  if (!ev || ev.remind === null || ev.remind === undefined) return null;
  const at = remindAt(ev, ev.date);
  const base = { cal: ev.id, text: ev.title, sub: subLine(ev), time: `${pad2(at.getHours())}:${pad2(at.getMinutes())}` };
  if (!ev.repeat || ev.repeat === 'none') return { ...base, date: ymd(at), repeat: 'once', skip: [] };
  if (plainWeekly(ev)) return { ...base, date: ymd(at), repeat: 'weekly', skip: ev.skip.map(s => ymd(remindAt(ev, s))) };
  const on = remindDays(ev, now);
  return on.length ? { ...base, date: on[0], repeat: 'dates', on } : null;
}
/** Hand every event's reminder to the engine. -> { [eventId]: 'set' | 'passed' | 'full' } */
export function syncReminders(list = events(), now = Date.now()) {
  try { return AM.syncCalendarReminders(list.map(e => reminderFor(e, now)).filter(Boolean), now); }
  catch (err) { console.error('[calendar] reminders', err); return {}; }
}

/* ---------- writing ---------------------------------------------------- */
function keepOf(e) {
  const keep = { id: e.id, title: e.title, tone: e.tone };
  if (e.allDay) keep.allDay = true; else keep.time = e.time;
  if (e.end) keep.end = e.end;
  if (e.repeat && e.repeat !== 'none') {
    keep.repeat = e.repeat;
    if (e.every > 1) keep.every = e.every;
    if (e.days && e.days.length) keep.days = e.days.slice();
    if (e.until) keep.until = e.until;
    if (e.skip.length) keep.skip = e.skip.slice();
  }
  if (e.remind !== null) keep.remind = e.remind;
  if (e.location) keep.location = e.location;
  if (e.notes) keep.notes = e.notes;
  if (e.uid) keep.uid = e.uid;
  return keep;
}
function write(list, sp = spans()) {
  const out = {};
  for (const e of list) (out[e.date] ||= []).push(keepOf(e));
  const value = { v: 2, events: out };
  if (sp.length) value.spans = sp.map(s => ({ id: s.id, title: s.title, start: s.start, end: s.end, tone: s.tone, ...(s.uid ? { uid: s.uid } : {}) }));
  store.set(KEY, value);
  watch();
  return syncReminders(events());
}

/** Problems with a draft; any one of them blocks saving. -> [{ at, text }] */
export function issues(d) {
  const o = d || {};
  const out = [];
  if (!String(o.title || '').trim()) out.push({ at: 'title', text: 'Give the event a name.' });
  if (!parseDay(o.date)) out.push({ at: 'date', text: 'Pick a day.' });
  if (!o.allDay) {
    if (!validTime(o.time)) out.push({ at: 'time', text: 'Pick a start time.' });
    else if (o.end && !validTime(o.end)) out.push({ at: 'end', text: 'That end time isn’t a time.' });
    else if (o.end && minutesOf(o.end) <= minutesOf(o.time)) out.push({ at: 'end', text: 'It has to end after it starts (events end the same day).' });
  }
  if (o.repeat && !REPEATS.includes(o.repeat)) out.push({ at: 'repeat', text: 'Pick how it repeats.' });
  else if (o.repeat && o.repeat !== 'none') {
    if (o.every !== undefined && o.every !== null && o.every !== '' && !(Number.isInteger(Number(o.every)) && Number(o.every) >= 1 && Number(o.every) <= EVERY_MAX)) {
      out.push({ at: 'every', text: `Repeat every 1 to ${EVERY_MAX}.` });
    }
    if (o.until && (!parseDay(o.until) || (parseDay(o.date) && o.until < o.date))) out.push({ at: 'until', text: 'It has to stop repeating on or after its first day.' });
  }
  if (o.remind !== null && o.remind !== undefined && !remindOk(o.remind, !!o.allDay)) out.push({ at: 'remind', text: 'Pick when to be reminded.' });
  return out;
}

function fromDraft(d, id, prev) {
  const allDay = !!d.allDay;
  const pick = (k, dflt) => (d[k] !== undefined ? d[k] : prev ? prev[k] : dflt);
  return normEvent({
    id, title: String(d.title || '').trim(), allDay, time: d.time, end: allDay ? '' : (d.end || ''),
    repeat: REPEATS.includes(d.repeat) ? d.repeat : 'none',
    every: Number(pick('every', 1)), days: pick('days', []), until: pick('until', ''),
    skip: pick('skip', []),
    remind: d.remind === undefined ? (prev ? prev.remind : null) : d.remind,
    location: pick('location', ''), notes: pick('notes', ''), uid: pick('uid', ''),
    tone: d.tone || (prev ? prev.tone : TONES[events().filter(e => e.date === d.date).length % TONES.length]),
  }, d.date);
}

/** Add an event. -> { ok, event?, issues?, reminder?: 'set'|'passed'|'full'|null } */
export function addEvent(draft) {
  const probs = issues(draft);
  if (probs.length) return { ok: false, issues: probs };
  const list = events();
  if (list.length >= MAX_EVENTS) return { ok: false, issues: [{ at: 'title', text: `The calendar holds up to ${MAX_EVENTS} events.` }] };
  const ev = fromDraft(draft, newId(), null);
  const res = write([...list, ev]);
  return { ok: true, event: byId(ev.id), reminder: ev.remind === null ? null : res[ev.id] || null };
}

/** Change an event (every day it repeats on). -> like addEvent */
export function updateEvent(id, patch) {
  const list = events();
  const cur = list.find(e => e.id === id);
  if (!cur) return { ok: false, issues: [{ at: 'title', text: 'That event is gone.' }] };
  const next = { ...cur, ...(patch || {}) };
  const probs = issues(next);
  if (probs.length) return { ok: false, issues: probs };
  /* a different first day or rule makes left-out days that are no longer in it meaningless */
  const moved = ['date', 'repeat', 'every', 'days', 'until'].some(k => JSON.stringify(next[k]) !== JSON.stringify(cur[k]));
  if (moved && !(patch && 'skip' in patch)) {
    const probe = normEvent({ ...next, skip: [] }, next.date);
    next.skip = probe ? cur.skip.filter(s => s > next.date && occursOn(probe, s)) : [];
  }
  const ev = fromDraft(next, id, cur);
  const res = write(list.map(e => (e.id === id ? ev : e)));
  return { ok: true, event: byId(id), reminder: ev.remind === null ? null : res[id] || null };
}

/** Remove an event (every repeat). -> the event as it was, for undo, or null */
export function removeEvent(id) {
  const list = events();
  const gone = list.find(e => e.id === id);
  if (!gone) return null;
  write(list.filter(e => e.id !== id));
  return gone;
}

/** Put a removed event back exactly as it was. */
export function restoreEvent(ev) {
  if (!ev || byId(ev.id)) return false;
  const n = normEvent(ev, ev.date);
  if (!n) return false;
  write([...events(), n]);
  return true;
}

/**
 * Leave one day out of a repeating event ("delete this one"). The first day of
 * the run can't be a left-out day, so leaving that one out moves the start
 * to the next day it happens instead (and when there is none left, the event
 * goes). -> the event as it was, for undo
 */
export function skipDay(id, day) {
  const list = events();
  const cur = list.find(e => e.id === id);
  if (!cur || cur.repeat === 'none' || !occursOn(cur, day)) return null;
  if (day === cur.date) {
    const d2 = nextOn(cur, addDay(day, 1));
    if (!d2) { write(list.filter(e => e.id !== id)); return cur; }
    const next = normEvent({ ...cur, date: d2, skip: cur.skip.filter(s => s > d2) }, d2);
    write(list.map(e => (e.id === id ? next : e)));
    return cur;
  }
  write(list.map(e => (e.id === id ? normEvent({ ...cur, skip: [...cur.skip, day].sort() }, cur.date) : e)));
  return cur;
}

/** Put an event back to an earlier copy of itself (undo for skipDay/updateEvent). */
export function replaceEvent(ev) {
  const list = events();
  const n = normEvent(ev, ev && ev.date);
  if (!n) return false;
  /* skipDay may have removed the last one: put it back */
  write(list.some(e => e.id === n.id) ? list.map(e => (e.id === n.id ? n : e)) : [...list, n]);
  return true;
}

/**
 * Move one day of a repeating event somewhere else (a drag in the grid): that
 * day is left out of the series and a one-off copy is made where it was put.
 * -> { ok, event?, before?, issues? } — before is the series as it was, for undo
 */
export function moveOne(id, day, patch) {
  const cur = byId(id);
  if (!cur || cur.repeat === 'none' || !occursOn(cur, day)) return { ok: false, issues: [{ at: 'date', text: 'That day isn’t part of the event any more.' }] };
  const draft = { ...cur, ...patch, repeat: 'none', skip: [], until: '', every: 1, days: [], uid: '' };
  const probs = issues(draft);
  if (probs.length) return { ok: false, issues: probs };
  const before = skipDay(id, day);
  const res = addEvent(draft);
  return res.ok ? { ...res, before } : res;
}

/** Add many events (and spans) in one write — an .ics import or a shared link. -> { added, spans, issues } */
export function addMany(drafts, spanDrafts = []) {
  const list = events().slice();
  const sp = spans().slice();
  let added = 0, spAdded = 0;
  const probs = [];
  for (const d of drafts || []) {
    const p = issues(d);
    if (p.length) { probs.push({ title: d && d.title, text: p[0].text }); continue; }
    if (list.length >= MAX_EVENTS) { probs.push({ title: d.title, text: `The calendar holds up to ${MAX_EVENTS} events.` }); continue; }
    const ev = normEvent({ ...d, id: newId(), tone: TONES.includes(d.tone) ? d.tone : TONES[(list.length) % TONES.length] }, d.date);
    if (ev) { list.push(ev); added++; }
  }
  for (const s of spanDrafts || []) {
    if (sp.length >= MAX_SPANS) { probs.push({ title: s.title, text: `The calendar holds up to ${MAX_SPANS} terms and breaks.` }); continue; }
    const n = normSpan({ ...s, id: '' });
    if (n) { sp.push(n); spAdded++; } else probs.push({ title: s && s.title, text: 'Its days aren’t a run Calendar can draw.' });
  }
  if (added || spAdded) write(list, sp);
  return { added, spans: spAdded, issues: probs };
}

/* ---------- terms and breaks ---------------------------------------------- */
/** Problems with a span draft. -> [{ at, text }] */
export function spanIssues(s) {
  const o = s || {};
  const out = [];
  if (!oneLine(o.title, TITLE_MAX)) out.push({ at: 'title', text: 'Give it a name, like “Autumn term”.' });
  if (!parseDay(o.start)) out.push({ at: 'start', text: 'Pick the first day.' });
  if (!parseDay(o.end)) out.push({ at: 'end', text: 'Pick the last day.' });
  else if (parseDay(o.start) && o.end < o.start) out.push({ at: 'end', text: 'The last day can’t be before the first.' });
  else if (parseDay(o.start) && daysBetween(o.start, o.end) >= SPAN_DAYS_MAX) out.push({ at: 'end', text: `It can be up to ${SPAN_DAYS_MAX} days long.` });
  return out;
}
/** Add or change a span. -> { ok, span?, issues? } */
export function saveSpan(draft) {
  const probs = spanIssues(draft);
  if (probs.length) return { ok: false, issues: probs };
  const sp = spans().slice();
  const i = draft.id ? sp.findIndex(s => s.id === draft.id) : -1;
  if (i < 0 && sp.length >= MAX_SPANS) return { ok: false, issues: [{ at: 'title', text: `The calendar holds up to ${MAX_SPANS} terms and breaks.` }] };
  const n = normSpan({ ...(i >= 0 ? sp[i] : {}), ...draft, id: i >= 0 ? sp[i].id : '', tone: draft.tone || (i >= 0 ? sp[i].tone : TONES[(sp.length + 1) % TONES.length]) });
  if (i >= 0) sp[i] = n; else sp.push(n);
  write(events(), sp);
  return { ok: true, span: spanById(n.id) };
}
/** Remove a span. -> it as it was, for undo, or null */
export function removeSpan(id) {
  const gone = spanById(id);
  if (!gone) return null;
  write(events(), spans().filter(s => s.id !== id));
  return gone;
}
export function restoreSpan(s) {
  const n = normSpan(s);
  if (!n || spanById(n.id)) return false;
  write(events(), [...spans(), n]);
  return true;
}

/* ---------- an event in a link -------------------------------------------- */
/** The parts of an event that travel when it's sent to a friend: what it is, never your reminder or colour. */
export function packEvent(ev) {
  const o = { t: ev.title, d: ev.date };
  if (ev.allDay) o.a = 1; else { o.s = ev.time; if (ev.end) o.e = ev.end; }
  if (ev.repeat && ev.repeat !== 'none') {
    o.r = ev.repeat;
    if (ev.every > 1) o.n = ev.every;
    if (ev.days && ev.days.length) o.w = ev.days.slice();
    if (ev.until) o.u = ev.until;
    if (ev.skip && ev.skip.length) o.k = ev.skip.slice(0, 60);
  }
  if (ev.location) o.l = ev.location;
  if (ev.notes) o.m = ev.notes.slice(0, 1500);
  return o;
}
/** A shared event read back, checked like one typed into the form. -> draft | null */
export function unpackEvent(o) {
  if (!o || typeof o !== 'object' || typeof o.t !== 'string' || !parseDay(o.d)) return null;
  const draft = {
    title: oneLine(o.t, TITLE_MAX), date: o.d, allDay: o.a === 1, time: o.a === 1 ? '' : (validTime(o.s) ? o.s : ''),
    end: o.a === 1 ? '' : (validTime(o.e) ? o.e : ''), repeat: REPEATS.includes(o.r) ? o.r : 'none',
    every: Number.isInteger(o.n) ? o.n : 1, days: Array.isArray(o.w) ? o.w : [], until: typeof o.u === 'string' ? o.u : '',
    skip: Array.isArray(o.k) ? o.k.slice(0, 60) : [], location: oneLine(o.l, LOCATION_MAX), notes: cleanNotes(o.m), remind: null,
  };
  if (issues(draft).length) return null;
  const n = normEvent({ ...draft, id: 'shared' }, draft.date);
  if (!n) return null;
  const { id, uid, tone, ...rest } = n;
  return rest;
}

/** Subscribe to any change in the events. -> unsubscribe */
export const onChange = fn => store.sub(KEY, () => fn(events()));

/* ---------- keeping 'dates' reminders topped up ------------------------------
   Once at start (main.js) and again whenever the date changes, the coming
   days are handed to the reminder engine again. Nothing is written when
   nothing moved. */
let watching = false;
let lastDay = '';
function watch() {
  if (watching) return;
  watching = true;
  lastDay = ymd(new Date());
  bus.on('tick:5s', () => {
    const t = ymd(new Date());
    if (t === lastDay) return;
    lastDay = t;
    if (events().some(e => e.remind !== null && e.repeat !== 'none' && !plainWeekly(e))) syncReminders();
  });
}
export function init() {
  watch();
  if (events().some(e => e.remind !== null && e.repeat !== 'none' && !plainWeekly(e))) syncReminders();
}

export default {
  KEY, TONES, REPEATS, ymd, parseDay, validTime, clockText, remindChoices, remindLabel, repeatText, events, byId, occursOn, nextOn,
  startOf, endOf, minutesSpan, onDay, countInMonth, upcoming, nextDay, daysUntil, untilText, isoWeek, reminderFor, syncReminders,
  issues, addEvent, updateEvent, removeEvent, restoreEvent, skipDay, replaceEvent, moveOne, addMany, onChange, newId, normEvent,
  spans, spanById, spansOn, spanIssues, saveSpan, removeSpan, restoreSpan, packEvent, unpackEvent, init, dayNum, numDay, addDay,
  daysBetween, weekdayOf,
};
