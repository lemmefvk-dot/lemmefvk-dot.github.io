/* ============================================================
   timetable.js (core) — Static Study's weekly class timetable and
   what is on "now and next". No DOM here, so the desktop widget
   (js/shell/deskwidgets.more.js) works with Static Study closed.

   Saved in store('portal.timetable') as
     { v: 1,
       rotate:  { on, thisWeek: 'A'|'B', anchor: 'YYYY-MM-DD' },
       classes: [{ id, subject, room, day, start, end, week }] }
   day is 0–6 as Date#getDay (0 = Sunday); start and end are 'HH:MM'
   on a 24-hour clock whatever the display setting is, and a class
   ends the same day it starts. week is 'both', 'A' or 'B'.

   A/B weeks: with rotation on, "this week is A" (or B) is recorded
   with the Monday of that week. Every other Monday swaps the letter.
   The count is on calendar days, so a clock change doesn't shift it.
   With rotation off every class happens every week, whatever its
   week says.

   Times are this computer's local time, built from the local year,
   month and day, so daylight-saving changes are handled by the
   browser. Nothing is invented: with no classes there is no "next".
   ============================================================ */
import { store } from './store.js';

export const KEY = 'portal.timetable';
export const MAX_CLASSES = 300;
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/* the order a school week is shown in */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = n => String(n).padStart(2, '0');

export const uid = () => `tt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = s => {
  const m = DAY_RE.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
};
export const validTime = t => TIME_RE.test(String(t || ''));
export const minutes = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The Monday on or before a date (local). */
export const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));

export function normClass(c) {
  const o = c && typeof c === 'object' ? c : {};
  const subject = text(o.subject, 60);
  const day = Number(o.day);
  if (!subject || !Number.isInteger(day) || day < 0 || day > 6 || !validTime(o.start) || !validTime(o.end) || minutes(o.end) <= minutes(o.start)) return null;
  return { id: String(o.id || uid()).slice(0, 60), subject, room: text(o.room, 30), day, start: o.start, end: o.end, week: o.week === 'A' || o.week === 'B' ? o.week : 'both' };
}
export function normalize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const r = o.rotate && typeof o.rotate === 'object' ? o.rotate : {};
  const anchor = parseDay(r.anchor) ? ymd(mondayOf(parseDay(r.anchor))) : ymd(mondayOf(new Date()));
  const seen = new Set();
  const classes = [];
  for (const c of Array.isArray(o.classes) ? o.classes : []) {
    const n = normClass(c);
    if (!n || seen.has(n.id) || classes.length >= MAX_CLASSES) continue;
    seen.add(n.id); classes.push(n);
  }
  return { v: 1, rotate: { on: r.on === true, thisWeek: r.thisWeek === 'B' ? 'B' : 'A', anchor }, classes };
}
export const read = () => normalize(store.get(KEY));
export const write = data => { const out = JSON.parse(JSON.stringify(normalize(data))); store.set(KEY, out); return out; };

/** Problems with a class draft. -> [{ at, text }] */
export function issues(d) {
  const o = d || {};
  const out = [];
  if (!text(o.subject, 60)) out.push({ at: 'subject', text: 'Give the class a subject.' });
  if (!validTime(o.start)) out.push({ at: 'start', text: 'Pick a start time.' });
  if (!validTime(o.end)) out.push({ at: 'end', text: 'Pick an end time.' });
  else if (validTime(o.start) && minutes(o.end) <= minutes(o.start)) out.push({ at: 'end', text: 'A class has to end after it starts (it ends the same day).' });
  if (!(Array.isArray(o.days) ? o.days : []).some(v => Number.isInteger(v) && v >= 0 && v <= 6)) out.push({ at: 'day', text: 'Pick at least one day.' });
  return out;
}

/* ---------- which week is it ---------- */
/** 'A' or 'B' for a day, or null when rotation is off. */
export function weekOf(day, data = read()) {
  if (!data.rotate.on) return null;
  const a = parseDay(data.rotate.anchor), d = parseDay(typeof day === 'string' ? day : ymd(day));
  if (!a || !d) return null;
  const weeks = Math.round((Date.UTC(mondayOf(d).getFullYear(), mondayOf(d).getMonth(), mondayOf(d).getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / (7 * 864e5));
  const same = weeks % 2 === 0;
  return same ? data.rotate.thisWeek : (data.rotate.thisWeek === 'A' ? 'B' : 'A');
}
/** Make `today`'s week the given letter: moves the anchor, keeps the rest. */
export function setThisWeek(data, letter, now = Date.now()) {
  return { ...data, rotate: { ...data.rotate, thisWeek: letter === 'B' ? 'B' : 'A', anchor: ymd(mondayOf(new Date(now))) } };
}

/** Classes happening on a day ('YYYY-MM-DD'), by start time. -> [{ ...class, on, startAt, endAt }] */
export function onDay(day, data = read()) {
  const d = parseDay(day);
  if (!d) return [];
  const wk = weekOf(day, data);
  return data.classes.filter(c => c.day === d.getDay() && (!wk || c.week === 'both' || c.week === wk))
    .sort((a, b) => a.start.localeCompare(b.start) || a.subject.localeCompare(b.subject))
    .map(c => {
      const [sh, sm] = c.start.split(':').map(Number), [eh, em] = c.end.split(':').map(Number);
      return { ...c, on: day, startAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm).getTime(), endAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em).getTime() };
    });
}

/**
 * What is on at `now`.
 * -> { current: [classes running now], next: class | null (the first one to start after now,
 *      today or within `days` days), today: [today's classes], nextDay: 'YYYY-MM-DD' | null,
 *      changeAt: ms of the next start or end today or midnight, whichever is first }
 */
export function status(now = Date.now(), data = read(), days = 14) {
  const t = new Date(now);
  const day = ymd(t);
  const today = onDay(day, data);
  const current = today.filter(c => c.startAt <= now && now < c.endAt);
  let next = today.find(c => c.startAt > now) || null;
  for (let i = 1; !next && i <= days; i++) next = onDay(ymd(addDays(t, i)), data)[0] || null;
  const midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime();
  const edges = today.flatMap(c => [c.startAt, c.endAt]).filter(x => x > now);
  return { current, next, today, nextDay: next ? next.on : null, changeAt: Math.min(midnight, ...edges) };
}

/** "Today", "Tomorrow" or a weekday name, for a day from `now`. */
export function dayWord(day, now = Date.now()) {
  const t = new Date(now);
  const d = parseDay(day);
  const diff = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : DAYS[d.getDay()];
}
/** "5 min", "1 h 20 min" — rounded up to the minute, as a countdown reads. */
export function span(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
/** A subject's colour: the Homework class of the same name if there is one, else a hue from the name. */
export function colorFor(subject, classes) {
  const hit = (classes || []).find(c => c.name.trim().toLowerCase() === String(subject).trim().toLowerCase());
  if (hit) return hit.color;
  let hsh = 0;
  for (const ch of String(subject).toLowerCase()) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${hsh % 360} 60% 55%)`;
}

export default { KEY, DAYS, WEEK_ORDER, read, write, normalize, issues, weekOf, setThisWeek, onDay, status, dayWord, span, colorFor, mondayOf, ymd, parseDay, validTime, minutes, uid };
