/* ============================================================
   calendar.js — Calendar's events, for every part of StaticOS
   that shows them: the Calendar app, the desktop's "Up next"
   widget, and the reminders that go off for them.

   Saved in store('portal.calendar') as
     { v: 2, events: { 'YYYY-MM-DD': [event, …] } }
   keyed by the event's (first) day, which is how the first
   Calendar stored { id, title, time, tone } — those still load.
   An event is
     { id, title,
       allDay   true: the whole day, no times
       time     'HH:MM' start (timed events)
       end      'HH:MM' or '' — optional, after the start
       repeat   'none' | 'weekly' (the same weekday, from its day on)
       skip     ['YYYY-MM-DD'] — days a weekly event is left out
       remind   minutes before the start, or null for none
       tone }   one of TONES, the colour it is drawn in
   An all-day event "starts" at midnight, so remind -540 is 9 AM
   on the day and 900 is 9 AM the day before.

   Nothing here invents events: the calendar starts empty and
   holds exactly what was put in it.

   Reminders are not a second clock: every write hands the
   reminders the events want to js/core/automations.js
   (syncCalendarReminders), which already watches the clock for
   the Automations app's reminders, catches up after sleep, says
   when one was missed, and snoozes. So an event's reminder goes
   off while StaticOS is open — never when it is closed, and the
   Calendar says so.
   ============================================================ */
import { store } from './store.js';
import * as AM from './automations.js';

export const KEY = 'portal.calendar';
/* dots and rails borrow the file-kind tints so nothing is hardcoded */
export const TONES = ['--accent', '--kind-doc', '--kind-code', '--kind-image', '--kind-config', '--kind-audio', '--kind-theme'];
export const TITLE_MAX = 200;
const MAX_EVENTS = 2000;
const MAX_SKIP = 200;

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

/* ---------- reading ---------------------------------------------------- */
let eseq = 0;
export const newId = () => `ev-${Date.now().toString(36)}-${(++eseq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function normEvent(e, date) {
  if (!e || typeof e !== 'object' || typeof e.title !== 'string' || !e.title.trim() || !parseDay(date)) return null;
  const allDay = e.allDay === true;
  const time = validTime(e.time) ? e.time : '09:00';
  const end = !allDay && validTime(e.end) && minutesOf(e.end) > minutesOf(time) ? e.end : '';
  const repeat = e.repeat === 'weekly' ? 'weekly' : 'none';
  const remind = Number.isFinite(e.remind) && remindOk(e.remind, allDay) ? e.remind : null;
  const skip = repeat === 'weekly' && Array.isArray(e.skip)
    ? [...new Set(e.skip.filter(s => parseDay(s) && s > date))].sort().slice(-MAX_SKIP) : [];
  return {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 80) : newId(),
    date, title: e.title.trim().slice(0, TITLE_MAX), allDay, time: allDay ? '' : time, end,
    repeat, skip, remind, tone: TONES.includes(e.tone) ? e.tone : TONES[0],
  };
}

let cacheFor = undefined;
let cache = [];
/** Every event, cleaned: [{ id, date, title, allDay, time, end, repeat, skip, remind, tone }]. */
export function events() {
  const raw = store.get(KEY, null);
  if (raw === cacheFor) return cache;
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
  cacheFor = raw;
  cache = out;
  return out;
}
export const byId = id => events().find(e => e.id === id) || null;

/** Does `ev` happen on day 'YYYY-MM-DD'? */
export function occursOn(ev, day) {
  if (!ev || !day) return false;
  if (ev.repeat !== 'weekly') return ev.date === day;
  if (day < ev.date || ev.skip.includes(day)) return false;
  const a = parseDay(ev.date), d = parseDay(day);
  return !!a && !!d && a.getDay() === d.getDay();
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

const order = (a, b) => (a.allDay === b.allDay ? (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title) : a.allDay ? -1 : 1);

/** What happens on one day, all-day first, then by time: [{ ...event, on, start, endAt }]. */
export function onDay(day, list = events()) {
  const k = typeof day === 'string' ? day : ymd(day);
  return list.filter(e => occursOn(e, k)).sort(order)
    .map(e => ({ ...e, on: k, start: startOf(e, k), endAt: endOf(e, k) }));
}

/** How many events happen in a month (a weekly one counts on each of its days). */
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
  if (ev.repeat !== 'weekly') return ev.date;
  const t = new Date(now);
  let d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const a = parseDay(ev.date);
  if (a > d) d = a;
  for (let i = 0; i < 7 * (ev.skip.length + 2); i++) {
    const k = ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i));
    if (occursOn(ev, k) && endOf(ev, k) > now) return k;
  }
  return ev.date;
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
  if (ev.allDay) return when ? `${when}, all day` : 'Today, all day';
  const until = ev.end ? ` · until ${clockText(ev.end)}` : '';
  if (when) return `${when} at ${clockText(ev.time)}${until}`;
  return ev.remind === 0 ? `Starting now · ${clockText(ev.time)}${until}` : `Starts at ${clockText(ev.time)}${until}`;
}
/** The reminder an event wants, in the shape automations.js takes, or null. */
export function reminderFor(ev) {
  if (!ev || ev.remind === null || ev.remind === undefined) return null;
  const at = remindAt(ev, ev.date);
  return {
    cal: ev.id, text: ev.title, sub: subLine(ev),
    time: `${pad2(at.getHours())}:${pad2(at.getMinutes())}`, date: ymd(at),
    repeat: ev.repeat === 'weekly' ? 'weekly' : 'once',
    skip: ev.repeat === 'weekly' ? ev.skip.map(s => ymd(remindAt(ev, s))) : [],
  };
}
/** Hand every event's reminder to the engine. -> { [eventId]: 'set' | 'passed' | 'full' } */
export function syncReminders(list = events()) {
  try { return AM.syncCalendarReminders(list.map(reminderFor).filter(Boolean)); }
  catch (err) { console.error('[calendar] reminders', err); return {}; }
}

/* ---------- writing ---------------------------------------------------- */
function write(list) {
  const out = {};
  for (const e of list) {
    const { date, ...rest } = e;
    const keep = { id: rest.id, title: rest.title, tone: rest.tone };
    if (rest.allDay) keep.allDay = true; else keep.time = rest.time;
    if (rest.end) keep.end = rest.end;
    if (rest.repeat === 'weekly') { keep.repeat = 'weekly'; if (rest.skip.length) keep.skip = rest.skip.slice(); }
    if (rest.remind !== null) keep.remind = rest.remind;
    (out[date] ||= []).push(keep);
  }
  store.set(KEY, { v: 2, events: out });
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
  if (o.repeat && o.repeat !== 'none' && o.repeat !== 'weekly') out.push({ at: 'repeat', text: 'Pick how it repeats.' });
  if (o.remind !== null && o.remind !== undefined && !remindOk(o.remind, !!o.allDay)) out.push({ at: 'remind', text: 'Pick when to be reminded.' });
  return out;
}

function fromDraft(d, id, prev) {
  const allDay = !!d.allDay;
  return normEvent({
    id, title: String(d.title || '').trim(), allDay, time: d.time, end: allDay ? '' : (d.end || ''),
    repeat: d.repeat === 'weekly' ? 'weekly' : 'none',
    skip: d.skip !== undefined ? d.skip : prev ? prev.skip : [],
    remind: d.remind === undefined ? (prev ? prev.remind : null) : d.remind,
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
  /* a different first day or weekday makes the old left-out days meaningless */
  if (next.date !== cur.date && !(patch && 'skip' in patch)) next.skip = cur.skip.filter(s => s > next.date && parseDay(s).getDay() === parseDay(next.date).getDay());
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
 * Leave one day out of a weekly event ("delete this one"). The first day of
 * the run can't be a left-out day, so leaving that one out moves the start
 * to the next week instead. -> the event as it was, for undo
 */
export function skipDay(id, day) {
  const list = events();
  const cur = list.find(e => e.id === id);
  if (!cur || cur.repeat !== 'weekly' || !occursOn(cur, day)) return null;
  let next;
  if (day === cur.date) {
    const a = parseDay(cur.date);
    let k = 7;
    let d2 = ymd(new Date(a.getFullYear(), a.getMonth(), a.getDate() + k));
    while (cur.skip.includes(d2) && k < 7 * (MAX_SKIP + 1)) { k += 7; d2 = ymd(new Date(a.getFullYear(), a.getMonth(), a.getDate() + k)); }
    next = { ...cur, date: d2, skip: cur.skip.filter(s => s > d2) };
  } else next = { ...cur, skip: [...cur.skip, day].sort() };
  write(list.map(e => (e.id === id ? normEvent(next, next.date) : e)));
  return cur;
}

/** Put an event back to an earlier copy of itself (undo for skipDay/updateEvent). */
export function replaceEvent(ev) {
  const list = events();
  const n = normEvent(ev, ev && ev.date);
  if (!n || !list.some(e => e.id === n.id)) return false;
  write(list.map(e => (e.id === n.id ? n : e)));
  return true;
}

/** Subscribe to any change in the events. -> unsubscribe */
export const onChange = fn => store.sub(KEY, () => fn(events()));

export default {
  KEY, TONES, ymd, parseDay, validTime, clockText, remindChoices, remindLabel, events, byId, occursOn, startOf, endOf,
  onDay, countInMonth, upcoming, nextDay, reminderFor, syncReminders, issues, addEvent, updateEvent, removeEvent,
  restoreEvent, skipDay, replaceEvent, onChange, newId,
};
