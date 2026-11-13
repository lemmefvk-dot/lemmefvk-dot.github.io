/* ============================================================
   tasks.js (core) — the shape of Static Tasks' lists, shared by
   the Static Tasks app and the desktop's To-dos widget, so both
   read and write the same thing in store('portal.tasks'):

     { v: 1, activeId, lists: [{ id, name, created,
         tasks: [{ id, text, done, due, priority, remind, subs, created, updated }] }] }

   · due     'YYYY-MM-DD' on this computer's calendar (local time), or null
   · remind  'HH:MM' on the due day, or null — only set when the person asks;
             it is handed to the Automations reminder engine on every save
   · subs    the task's own tasks, same shape, nested up to MAX_DEPTH levels
             (a task, its subtask, and that subtask's subtask). Deeper is cut.

   Lists saved before subtasks and reminders existed have neither field;
   normTask() gives them `subs: []` and `remind: null`, so every old task
   comes through unchanged. The version stays 1: nothing was removed.

   store.set() no-ops when handed the same object reference, so
   every write ships a fresh deep copy (cloneData) — that is also
   what lets a reader tell someone else's write from its own.
   ============================================================ */
import { store } from './store.js';
import * as AM from './automations.js';

export const STORE_KEY = 'portal.tasks';
export const PRIOS = ['none', 'low', 'med', 'high'];
export const TEXT_MAX = 500;
export const MAX_DEPTH = 3;           /* task → subtask → sub-subtask */
export const MAX_SUBS = 100;          /* subtasks under one task */
export const SRC = 'tasks';           /* the `src` its reminders carry in Automations */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/* a real calendar day, not just the right shape ('2027-02-31' is nothing) */
export function validDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}
/** 'YYYY-MM-DD' for a moment, on this computer's calendar. */
export const dayOf = (ms = Date.now()) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---- shape guards: the store is the only input, but treat it as untrusted ---- */
export function blank() { return { v: 1, lists: [], activeId: '' }; }
export function normTask(t, depth = 1) {
  const o = (t && typeof t === 'object') ? t : {};
  const due = validDay(o.due) ? o.due : null;
  return {
    id: String(o.id || uid('t')),
    text: String(o.text || '').slice(0, TEXT_MAX),
    done: !!o.done,
    due,
    priority: PRIOS.includes(o.priority) ? o.priority : 'none',
    remind: due && TIME_RE.test(o.remind) ? o.remind : null,
    subs: depth < MAX_DEPTH && Array.isArray(o.subs) ? o.subs.slice(0, MAX_SUBS).map(s => normTask(s, depth + 1)) : [],
    created: Number(o.created) || Date.now(),
    updated: Number(o.updated) || Number(o.created) || Date.now(),
  };
}
export function normList(l) {
  const o = (l && typeof l === 'object') ? l : {};
  return {
    id: String(o.id || uid('l')),
    name: String(o.name || 'Untitled list').slice(0, 60),
    created: Number(o.created) || Date.now(),
    tasks: Array.isArray(o.tasks) ? o.tasks.map(t => normTask(t)) : [],
  };
}
export function normalize(raw) {
  const d = (raw && typeof raw === 'object') ? raw : {};
  const lists = Array.isArray(d.lists) ? d.lists.map(normList) : [];
  let activeId = String(d.activeId || '');
  if (!lists.some(l => l.id === activeId)) activeId = lists[0] ? lists[0].id : '';
  return { v: 1, lists, activeId };
}
const cloneTask = t => ({ ...t, subs: (t.subs || []).map(cloneTask) });
/* a fresh deep copy so store.set() never sees the same reference (it no-ops on identity) */
export function cloneData(d) {
  return { v: 1, activeId: d.activeId, lists: d.lists.map(l => ({ ...l, tasks: l.tasks.map(cloneTask) })) };
}

/* ---- walking the tree ---- */
/** fn(task, list, parent|null, depth) for every task at every depth, in list order. */
export function walkTasks(data, fn) {
  const go = (arr, list, parent, depth) => { for (const t of arr) { fn(t, list, parent, depth); go(t.subs || [], list, t, depth + 1); } };
  for (const l of data.lists) go(l.tasks, l, null, 1);
}
/** Where a task sits: { task, list, parent, arr, index, depth } or null. */
export function locate(data, id) {
  let hit = null;
  const go = (arr, list, parent, depth) => {
    for (let i = 0; i < arr.length && !hit; i++) {
      if (arr[i].id === id) hit = { task: arr[i], list, parent, arr, index: i, depth };
      else go(arr[i].subs || [], list, arr[i], depth + 1);
    }
  };
  for (const l of data.lists) { go(l.tasks, l, null, 1); if (hit) break; }
  return hit;
}
/** { done, total } over everything under a task (its subtasks, theirs…). */
export function progress(t) {
  let done = 0, total = 0;
  const go = arr => { for (const s of arr) { total++; if (s.done) done++; go(s.subs || []); } };
  go(t.subs || []);
  return { done, total };
}
/** Mark a task done (and everything under it) or not done (only itself). */
export function setDone(t, done, now = Date.now()) {
  t.done = !!done; t.updated = now;
  if (done) for (const s of t.subs || []) setDone(s, true, now);
}

/* ---- smart lists: computed from the tasks, never stored ---- */
export const SMART = [
  { id: 'today', name: 'Today', icon: 'calendar', empty: 'Nothing is due today.' },
  { id: 'upcoming', name: 'Upcoming', icon: 'clock', empty: 'Nothing is due after today.' },
  { id: 'overdue', name: 'Overdue', icon: 'alert', empty: 'Nothing is overdue.' },
  { id: 'high', name: 'High priority', icon: 'flame', empty: 'No unfinished task is marked high priority.' },
];
const PRIO_RANK = { high: 3, med: 2, low: 1, none: 0 };
/** The unfinished tasks (any depth) a smart list holds as of `now`:
    [{ task, list, parent, depth }], soonest due first, then higher priority. */
export function smart(data, kind, now = Date.now()) {
  const today = dayOf(now);
  const out = [];
  walkTasks(data, (task, list, parent, depth) => {
    if (task.done) return;
    const d = task.due;
    const hit = kind === 'today' ? d === today
      : kind === 'upcoming' ? !!d && d > today
      : kind === 'overdue' ? !!d && d < today
      : kind === 'high' ? task.priority === 'high' : false;
    if (hit) out.push({ task, list, parent, depth });
  });
  out.sort((a, b) => (a.task.due || '9999').localeCompare(b.task.due || '9999')
    || PRIO_RANK[b.task.priority] - PRIO_RANK[a.task.priority]);
  return out;
}

/* ---- reminders: only for tasks that ask, through Automations' own engine ---- */
const dayLabel = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
/** What the reminder engine should hold for these lists. */
export function reminderWants(data) {
  const want = [];
  walkTasks(data, (t, list) => {
    if (t.done || !t.due || !t.remind || !t.text.trim()) return;
    want.push({ ref: t.id, text: t.text, sub: `Due ${dayLabel(t.due)} · ${list.name}`, time: t.remind, date: t.due });
  });
  return want;
}
let lastSync = {};
/** Bring Automations' reminders in line. -> { [taskId]: 'set' | 'passed' | 'full' } */
export function syncReminders(data = read()) {
  try { lastSync = AM.syncSourceReminders(SRC, reminderWants(data)); }
  catch (err) { console.error('[tasks] reminders', err); lastSync = {}; }
  return lastSync;
}
/** How each reminder fared at the most recent save. */
export const lastReminders = () => lastSync;

/** The lists as saved, cleaned. */
export const read = () => normalize(store.get(STORE_KEY));
/** Save the lists (always a fresh copy), then sync reminders. -> the object written */
export function write(data) {
  const out = cloneData(normalize(data));
  store.set(STORE_KEY, out);
  syncReminders(out);
  return out;
}

export default { STORE_KEY, PRIOS, TEXT_MAX, MAX_DEPTH, MAX_SUBS, SMART, uid, blank, validDay, dayOf, normTask, normList, normalize, cloneData, walkTasks, locate, progress, setDone, smart, reminderWants, syncReminders, lastReminders, read, write };
