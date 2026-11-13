/* ============================================================
   homework.js (core) — Static Study's classes and assignments,
   and the reminders they ask for. No DOM here.

   Saved in store('portal.homework') as
     { v: 1,
       classes:     [{ id, name, color }],
       assignments: [{ id, classId, title, due, time, notes, done,
                       doneAt, remind, created }] }
   due is 'YYYY-MM-DD'; time is 'HH:MM' or '' (no time: due by the
   end of that day); remind is minutes before the due time, or null.

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
  return { id: String(o.id || uid('k')).slice(0, 60), name: text(o.name, 40) || 'Class', color: COLORS.includes(o.color) ? o.color : COLORS[i % COLORS.length] };
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
  return { v: 1, classes, assignments };
}
export const read = () => normalize(store.get(KEY));

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
  const groups = data.classes.map(c => ({ cls: c, items: [] }));
  const none = { cls: null, items: [] };
  for (const a of data.assignments) (groups.find(g => g.cls.id === a.classId) || none).items.push(a);
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

/** Save, then bring the reminders in line. -> { data, reminders } */
export function write(data) {
  const out = JSON.parse(JSON.stringify(normalize(data)));
  store.set(KEY, out);
  return { data: out, reminders: syncReminders(out) };
}

export default { KEY, COLORS, REMIND, read, write, normalize, viewToday, viewWeek, viewByClass, dueAt, isOverdue, statusOf, reminderFor, syncReminders, today, addDays, ymd };
