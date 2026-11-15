/* ============================================================
   homework.js (core) — Static Study's classes and assignments,
   and the reminders they ask for. No DOM here.

   Saved in store('portal.homework') as
     { v: 1, termStart,
       classes:     [{ id, name, color, archived }],
       assignments: [{ id, classId, title, due, time, notes, done,
                       doneAt, remind, created,
                       repeat, series, est, grade, links, taskId }] }
   due is 'YYYY-MM-DD'; time is 'HH:MM' or '' (no time: due by the
   end of that day); remind is minutes before the due time, or null.
   Everything after `created` came later; an assignment saved before
   has none of it and loads as it was (no repeat, no estimate…).
     repeat   'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly'.
              Each time is its own assignment (its own tick, grade and
              reminder), joined by `series`. When the newest one is done,
              or its day is over, the next one is made — on the first
              repeat day from today on, so a long absence never piles up
              made-up overdue work. Rolled on every save and, with the
              window closed, each new day (init(), from main.js).
     est      YOUR estimate in minutes (0 = none): Today adds them up
     grade    what you got, as you typed it: "92", "92%", "18/20", "B+".
              A class's average counts the ones that are a number
     links    up to 6 { kind: 'note' | 'card', ref, title }: a Notes note
              or a Board card it goes with
     taskId   the Static Tasks task it was sent to ('' when not sent)
   A class can be archived when it is over: its work leaves Today, This
   week, By class, the reminders and Calendar's layer, and comes back
   when it is restored. termStart is the day "this term" counts from
   for the late hand-ins count ('' = everything).

   Reminders are not a second clock. Every write hands the reminders
   the assignments want to js/core/automations.js
   (syncSourceReminders('study', …)) — the same engine Calendar's
   reminders go through: one timer, catch-up after sleep, "missed"
   when StaticOS was closed, snooze, and a notification. Like those,
   they only go off while StaticOS is open in this browser. An
   assignment with no time is reminded from 9:00 AM on its day (or
   the day before, for "1 day before"). A finished assignment has no
   reminder, and a reminder whose time has already passed is not made.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as AM from './automations.js';

export const KEY = 'portal.homework';
export const SRC = 'study';
export const COLORS = ['#5ea0ff', '#7fe0a6', '#ffb35e', '#ff7a8f', '#c78bff', '#4fd1c5', '#f2d45c', '#a0a8b8'];
export const COLOR_NAMES = ['Blue', 'Green', 'Orange', 'Red', 'Purple', 'Teal', 'Yellow', 'Grey'];
export const REMIND = [
  [null, 'No reminder'], [0, 'At the due time'], [60, '1 hour before'], [180, '3 hours before'], [1440, '1 day before'],
];
export const MAX_CLASSES = 40;
export const MAX_ASSIGNMENTS = 1000;
export const REPEATS = [['none', 'Doesn’t repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks']];
export const MAX_EST = 600;
export const MAX_LINKS = 6;
const DEFAULT_TIME = '09:00';
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = s => {
  const m = DAY_RE.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
};
export const today = (now = Date.now()) => ymd(new Date(now));
export const addDays = (day, n) => { const d = parseDay(day) || new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

export function normClass(c, i = 0) {
  const o = c && typeof c === 'object' ? c : {};
  const out = { id: String(o.id || uid('k')).slice(0, 60), name: text(o.name, 40) || 'Class', color: COLORS.includes(o.color) ? o.color : COLORS[i % COLORS.length] };
  if (o.archived === true) out.archived = true;
  return out;
}
function normLinks(v) {
  const out = [];
  for (const l of Array.isArray(v) ? v : []) {
    if (!l || typeof l !== 'object' || (l.kind !== 'note' && l.kind !== 'card')) continue;
    const ref = String(l.ref || '').slice(0, 80);
    if (!ref || out.some(x => x.kind === l.kind && x.ref === ref) || out.length >= MAX_LINKS) continue;
    out.push({ kind: l.kind, ref, title: text(l.title, 80) });
  }
  return out;
}
export function normAssignment(a) {
  const o = a && typeof a === 'object' ? a : {};
  const title = text(o.title, 200);
  if (!title || !parseDay(o.due)) return null;
  const remind = REMIND.some(([v]) => v === o.remind) ? o.remind : null;
  return {
    id: String(o.id || uid('a')).slice(0, 60),
    classId: String(o.classId || ''), title, due: o.due,
    time: TIME_RE.test(o.time) ? o.time : '',
    notes: String(o.notes == null ? '' : o.notes).replace(/\r\n?/g, '\n').trim().slice(0, 2000),
    done: !!o.done, doneAt: Number(o.doneAt) || 0,
    remind, created: Number(o.created) || Date.now(),
    repeat: REPEATS.some(([v]) => v === o.repeat) ? o.repeat : 'none',
    series: typeof o.series === 'string' ? o.series.slice(0, 60) : '',
    est: Math.max(0, Math.min(MAX_EST, Math.floor(Number(o.est)) || 0)),
    grade: text(o.grade, 12),
    links: normLinks(o.links),
    taskId: typeof o.taskId === 'string' ? o.taskId.slice(0, 80) : '',
  };
}
export function normalize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const classes = [];
  for (const c of Array.isArray(o.classes) ? o.classes : []) {
    const n = normClass(c, classes.length);
    if (seen.has(n.id) || classes.length >= MAX_CLASSES) continue;
    seen.add(n.id); classes.push(n);
  }
  const ids = new Set();
  const assignments = [];
  for (const a of Array.isArray(o.assignments) ? o.assignments : []) {
    const n = normAssignment(a);
    if (!n || ids.has(n.id) || assignments.length >= MAX_ASSIGNMENTS) continue;
    if (n.classId && !seen.has(n.classId)) n.classId = '';
    ids.add(n.id); assignments.push(n);
  }
  return { v: 1, termStart: parseDay(o.termStart) ? o.termStart : '', classes, assignments };
}
export const read = () => normalize(store.get(KEY));

/** The assignments that count: not in an archived class. */
export function activeList(data) {
  const off = new Set(data.classes.filter(c => c.archived).map(c => c.id));
  return off.size ? data.assignments.filter(a => !off.has(a.classId)) : data.assignments;
}

/* ---------- repeating ---------- */
/** The day after `day` a repeat lands on. */
export function stepDay(repeat, day) {
  if (repeat === 'daily') return addDays(day, 1);
  if (repeat === 'weekly') return addDays(day, 7);
  if (repeat === 'biweekly') return addDays(day, 14);
  if (repeat === 'weekdays') {
    let n = addDays(day, 1);
    while ([0, 6].includes(parseDay(n).getDay())) n = addDays(n, 1);
    return n;
  }
  return null;
}
/**
 * Make the next assignment of every repeating series whose newest one is done
 * or past its day: on the first repeat day from today on. Changes `data` in
 * place. -> how many were made
 */
export function rollRepeats(data, now = Date.now()) {
  const t = today(now);
  const newest = new Map();
  for (const a of data.assignments) {
    if (!a.series) continue;
    const cur = newest.get(a.series);
    if (!cur || a.due > cur.due || (a.due === cur.due && a.created > cur.created)) newest.set(a.series, a);
  }
  let made = 0;
  for (const a of newest.values()) {
    if (a.repeat === 'none' || (!a.done && a.due >= t) || data.assignments.length >= MAX_ASSIGNMENTS) continue;
    let day = stepDay(a.repeat, a.due);
    for (let k = 0; day && day < t && k < 800; k++) day = stepDay(a.repeat, day);
    if (!day) continue;
    data.assignments.push({ id: uid('a'), classId: a.classId, title: a.title, due: day, time: a.time, notes: a.notes, done: false, doneAt: 0,
      remind: a.remind, created: now, repeat: a.repeat, series: a.series, est: a.est, grade: '', links: a.links.map(l => ({ ...l })), taskId: '' });
    made++;
  }
  return made;
}

/* ---------- grades, late work, time ---------- */
/** A typed grade as a percentage: "92", "92%", "18/20" -> 92, 90; a letter -> null. */
export function percentOf(grade) {
  const g = String(grade || '').trim();
  let m = /^(\d+(?:\.\d+)?)\s*%?$/.exec(g);
  if (m) { const n = Number(m[1]); return n <= 200 ? n : null; }
  m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(g);
  if (m && Number(m[2]) > 0) return Math.round(Number(m[1]) / Number(m[2]) * 10000) / 100;
  return null;
}
/** A class's graded work: { avg (mean of the percentages, or null), n, other (grades that aren't numbers) } */
export function classAverage(data, classId) {
  const graded = data.assignments.filter(a => a.classId === classId && a.grade);
  const pcts = graded.map(a => percentOf(a.grade)).filter(x => x !== null);
  return { avg: pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length * 100) / 100 : null, n: pcts.length, other: graded.length - pcts.length };
}
/** Late work since `from` ('' = all): { late: ticked off after it was due, open: still not done and past due, from } */
export function lateCount(data, now = Date.now(), from = data.termStart) {
  const list = activeList(data).filter(a => !from || a.due >= from);
  return { late: list.filter(a => a.done && a.doneAt && a.doneAt > dueAt(a)).length, open: list.filter(a => isOverdue(a, now)).length, from: from || '' };
}
/** Minutes YOU estimated for what is left today (due today or overdue), and how many of those have no estimate. */
export function estimateToday(list, now = Date.now()) {
  const v = viewToday(list, now);
  const open = [...v.overdue, ...v.today];
  return { min: open.reduce((s, a) => s + a.est, 0), with: open.filter(a => a.est).length, without: open.filter(a => !a.est).length };
}
export const minText = m => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

/* ---------- when things are due ---------- */
/** The moment it is due: its time, or the end of its day when it has none. */
export function dueAt(a) {
  const d = parseDay(a.due);
  const [h, m] = a.time ? a.time.split(':').map(Number) : [23, 59];
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, a.time ? 0 : 59, a.time ? 0 : 999).getTime();
}
export const isOverdue = (a, now = Date.now()) => !a.done && dueAt(a) < now;
/** 'done' | 'overdue' | 'today' | 'soon' (within a week) | 'later' */
export function statusOf(a, now = Date.now()) {
  if (a.done) return 'done';
  if (isOverdue(a, now)) return 'overdue';
  const t = today(now);
  if (a.due === t) return 'today';
  return a.due <= addDays(t, 6) ? 'soon' : 'later';
}
const byDue = (a, b) => dueAt(a) - dueAt(b) || a.title.localeCompare(b.title);

/** Today: everything not done that is overdue or due today, then (separately) what was finished today. */
export function viewToday(list, now = Date.now()) {
  const t = today(now);
  return {
    overdue: list.filter(a => isOverdue(a, now)).sort(byDue),
    today: list.filter(a => !a.done && !isOverdue(a, now) && a.due === t).sort(byDue),
    doneToday: list.filter(a => a.done && a.due === t).sort(byDue),
  };
}
/** This week: the next seven days, today first, grouped by day. Overdue stays out (it is in Today). */
export function viewWeek(list, now = Date.now()) {
  const t = today(now);
  const out = [];
  for (let k = 0; k < 7; k++) {
    const day = addDays(t, k);
    out.push({ day, items: list.filter(a => a.due === day && !isOverdue(a, now)).sort(byDue) });
  }
  return out;
}
/** By class: one group per class (and "No class"), open work first by due date, done last. */
export function viewByClass(data, now = Date.now()) {
  const groups = data.classes.filter(c => !c.archived).map(c => ({ cls: c, items: [] }));
  const none = { cls: null, items: [] };
  for (const a of activeList(data)) (groups.find(g => g.cls.id === a.classId) || none).items.push(a);
  if (none.items.length) groups.push(none);
  for (const g of groups) g.items.sort((a, b) => (a.done - b.done) || byDue(a, b));
  return groups;
}

/* ---------- reminders ---------- */
export const remindLabel = m => (REMIND.find(([v]) => v === m) || [0, ''])[1];
export function remindAt(a) {
  if (a.remind === null || a.remind === undefined) return null;
  const d = parseDay(a.due);
  const [h, m] = (a.time || DEFAULT_TIME).split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m - a.remind, 0, 0);
}
const clockText = t => { const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 3, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
export function dueText(a) {
  const d = parseDay(a.due).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return a.time ? `${d}, ${clockText(a.time)}` : d;
}
/** The reminder an assignment wants, in the shape automations.js takes, or null. */
export function reminderFor(a, classes = read().classes) {
  if (a.done) return null;
  if (classes.some(c => c.id === a.classId && c.archived)) return null;     /* an archived class reminds no one */
  const at = remindAt(a);
  if (!at) return null;
  const cls = classes.find(c => c.id === a.classId);
  return {
    ref: a.id, text: cls ? `${cls.name}: ${a.title}` : a.title,
    sub: `Due ${dueText(a)}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`, date: ymd(at),
  };
}
/** Hand every assignment's reminder to the engine. -> { [assignmentId]: 'set' | 'passed' | 'full' } */
export function syncReminders(data = read()) {
  try { return AM.syncSourceReminders(SRC, data.assignments.map(a => reminderFor(a, data.classes)).filter(Boolean)); }
  catch (err) { console.error('[homework] reminders', err); return {}; }
}

/** Save (making the next of any repeating assignment that is due one), then bring the reminders in line. -> { data, reminders, made } */
export function write(data, now = Date.now()) {
  const norm = normalize(data);
  const made = rollRepeats(norm, now);
  const out = JSON.parse(JSON.stringify(normalize(norm)));
  store.set(KEY, out);
  return { data: out, reminders: syncReminders(out), made };
}

/** With the window closed: the next of a repeating assignment appears on its day. Once at start and on each new day. */
let lastDay = '';
export function init() {
  const tick = () => {
    const t = today();
    if (t === lastDay) return;
    lastDay = t;
    try { const cur = read(); if (rollRepeats(normalize(cur))) write(cur); } catch (err) { console.error('[homework]', err); }
  };
  tick();
  bus.on('tick:5s', tick);
}

export default { KEY, COLORS, REMIND, REPEATS, read, write, init, normalize, activeList, rollRepeats, stepDay, percentOf, classAverage, lateCount, estimateToday, viewToday, viewWeek, viewByClass, dueAt, isOverdue, statusOf, reminderFor, syncReminders, today, addDays, ymd };
