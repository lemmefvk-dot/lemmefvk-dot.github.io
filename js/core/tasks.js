/* ============================================================
   tasks.js (core) — the shape of Static Tasks' lists, shared by
   the Static Tasks app and the desktop's To-dos widget, so both
   read and write the same thing in store('portal.tasks'):

     { v: 1, activeId, lists: [{ id, name, created, color, icon, sort, hideDone,
         tasks: [{ id, text, done, due, priority, remind, repeat, mday, notes, subs, created, updated }] }] }

   · due     'YYYY-MM-DD' on this computer's calendar (local time), or null
   · remind  'HH:MM' on the due day, or null — only set when the person asks;
             it is handed to the Automations reminder engine on every save
   · repeat  'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' — needs a
             due date. Ticking a repeating task off moves it to its next due
             day instead (completeTask), unticked, with its subtasks unticked;
             its reminder follows, since it is the due day's. mday is the day
             of the month a monthly one keeps to (the 31st stays the 31st, or
             the month's last day), set from the due date when it is chosen.
   · notes   plain text under the task, '' when none
   · subs    the task's own tasks, same shape, nested up to MAX_DEPTH levels
             (a task, its subtask, and that subtask's subtask). Deeper is cut.
   A list's color is one of LIST_COLORS ('' = the accent), icon one of
   LIST_ICONS, sort how it is shown ('manual' is your own order, the
   others never change it), hideDone keeps finished tasks out of "All".

   Lists saved before any of these existed have none of them; normTask()
   and normList() fill them in (`subs: []`, `remind: null`, `repeat:
   'none'`, `notes: ''`, sort 'manual'…), so every old task comes through
   unchanged. The version stays 1: nothing was removed.

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
export const NOTES_MAX = 2000;
export const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
export const REPEAT_LABEL = { none: 'Doesn’t repeat', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month' };
export const SORTS = ['manual', 'due', 'prio', 'name'];
export const SORT_LABEL = { manual: 'Your order', due: 'Due date', prio: 'Priority', name: 'Name' };
/* list colours: the same eight as Static Study's classes, so a list and a class can match */
export const LIST_COLORS = ['#5ea0ff', '#7fe0a6', '#ffb35e', '#ff7a8f', '#c78bff', '#4fd1c5', '#f2d45c', '#a0a8b8'];
export const LIST_COLOR_NAMES = ['Blue', 'Green', 'Orange', 'Red', 'Purple', 'Teal', 'Yellow', 'Grey'];
export const LIST_ICONS = ['list', 'check-circle', 'star', 'heart', 'home', 'clipboard', 'bookmark', 'shopping-bag', 'gift', 'coffee', 'gamepad', 'music', 'code', 'globe', 'users', 'flame', 'zap', 'sun', 'pet', 'wrench'];
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
const cleanNotes = v => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+$/, '').slice(0, NOTES_MAX);
export function normTask(t, depth = 1) {
  const o = (t && typeof t === 'object') ? t : {};
  const due = validDay(o.due) ? o.due : null;
  const repeat = due && REPEATS.includes(o.repeat) ? o.repeat : 'none';
  const md = Number(o.mday);
  const out = {
    id: String(o.id || uid('t')),
    text: String(o.text || '').slice(0, TEXT_MAX),
    done: !!o.done,
    due,
    priority: PRIOS.includes(o.priority) ? o.priority : 'none',
    remind: due && TIME_RE.test(o.remind) ? o.remind : null,
    repeat,
    notes: cleanNotes(o.notes),
    subs: depth < MAX_DEPTH && Array.isArray(o.subs) ? o.subs.slice(0, MAX_SUBS).map(s => normTask(s, depth + 1)) : [],
    created: Number(o.created) || Date.now(),
    updated: Number(o.updated) || Number(o.created) || Date.now(),
  };
  if (repeat === 'monthly') out.mday = Number.isInteger(md) && md >= 1 && md <= 31 ? md : Number(due.slice(8, 10));
  return out;
}
export function normList(l) {
  const o = (l && typeof l === 'object') ? l : {};
  return {
    id: String(o.id || uid('l')),
    name: String(o.name || 'Untitled list').slice(0, 60),
    created: Number(o.created) || Date.now(),
    color: LIST_COLORS.includes(o.color) ? o.color : '',
    icon: LIST_ICONS.includes(o.icon) ? o.icon : 'list',
    sort: SORTS.includes(o.sort) ? o.sort : 'manual',
    hideDone: o.hideDone === true,
    tasks: Array.isArray(o.tasks) ? o.tasks.map(t => normTask(t)) : [],
  };
}
/** A list's colour for drawing: its own, or the accent. */
export const listColor = l => (l && l.color) || 'var(--accent)';
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

/* ---- repeating tasks ---- */
const dayAt = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
/** The due day after `from` for a repeat, keeping a monthly one to its day of the month. */
export function stepDue(repeat, from, mday) {
  const d = dayAt(from);
  if (repeat === 'daily') return dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
  if (repeat === 'weekly') return dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime());
  if (repeat === 'weekdays') {
    let n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    while (n.getDay() === 0 || n.getDay() === 6) n = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    return dayOf(n.getTime());
  }
  if (repeat === 'monthly') {
    const want = mday || d.getDate();
    const last = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();
    return dayOf(new Date(d.getFullYear(), d.getMonth() + 1, Math.min(want, last)).getTime());
  }
  return null;
}
/** The next due day of a repeating task: the first one after its due day and after today. */
export function nextDue(t, now = Date.now()) {
  if (!t || !t.due || !t.repeat || t.repeat === 'none') return null;
  const today = dayOf(now);
  let k = stepDue(t.repeat, t.due, t.mday);
  for (let i = 0; k && k <= today && i < 4000; i++) k = stepDue(t.repeat, k, t.mday);
  return k;
}
/**
 * Tick a task off. A repeating one is not finished: it moves to its next due
 * day, unticked, with everything under it unticked again.
 * -> { done: true } | { next: 'YYYY-MM-DD', was: 'YYYY-MM-DD' }
 */
export function completeTask(t, now = Date.now()) {
  const next = nextDue(t, now);
  if (!next) { setDone(t, true, now); return { done: true }; }
  const was = t.due;
  t.due = next;
  t.done = false;
  t.updated = now;
  const undo = arr => { for (const s of arr) { s.done = false; s.updated = now; undo(s.subs || []); } };
  undo(t.subs || []);
  return { next, was };
}

/* ---- sorting and finding ---- */
const PRIO_ORDER = { high: 3, med: 2, low: 1, none: 0 };
/** A copy of `arr` in a list's sort order ('manual' leaves it as it is). Done tasks stay after open ones in the other orders. */
export function sortTasks(arr, how) {
  if (!how || how === 'manual') return arr;
  const by = {
    due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || PRIO_ORDER[b.priority] - PRIO_ORDER[a.priority],
    prio: (a, b) => PRIO_ORDER[b.priority] - PRIO_ORDER[a.priority] || (a.due || '9999').localeCompare(b.due || '9999'),
    name: (a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true }),
  }[how];
  if (!by) return arr;
  return arr.map((t, i) => [t, i]).sort(([a, i], [b, j]) => (a.done - b.done) || by(a, b) || i - j).map(([t]) => t);
}
/** Every task (any depth, any list) whose text or notes hold all the words typed. -> [{ task, list, parent, depth }] */
export function search(data, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  walkTasks(data, (task, list, parent, depth) => {
    const hay = `${task.text}\n${task.notes || ''}`.toLowerCase();
    if (words.every(w => hay.includes(w))) out.push({ task, list, parent, depth });
  });
  return out;
}

/* ---- quick add: "Essay friday !high" ----
   Only words at the END of what was typed are read, and only while each
   one is a date, a priority or a repeat — so "Read Friday Night Lights"
   stays a title. The app shows what was understood before it is added. */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PRIO_WORDS = { '!high': 'high', '!h': 'high', '!3': 'high', '!!!': 'high', '!med': 'med', '!medium': 'med', '!m': 'med', '!2': 'med', '!!': 'med', '!low': 'low', '!l': 'low', '!1': 'low' };
const REPEAT_WORDS = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', weekdays: 'weekdays' };
/* full names, and the short forms that aren't everyday words ("sat" is a test, "sun" is the sun) */
const WD_SHORT = { mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5 };
function weekdayIndex(w) {
  const s = w.toLowerCase().replace(/[.,]$/, '');
  const full = WEEKDAYS.indexOf(s);
  return full >= 0 ? full : s in WD_SHORT ? WD_SHORT[s] : -1;
}
/** -> { text, due, priority, repeat, said: ['Due Fri, Nov 13', 'High priority', 'Every week'] } */
export function parseQuick(input, now = Date.now()) {
  const words = String(input || '').trim().split(/\s+/).filter(Boolean);
  const t0 = new Date(now);
  const day = n => dayOf(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + n).getTime());
  let due = null, priority = null, repeat = null;
  const take = () => words.pop();
  for (let guard = 0; words.length > 1 && guard < 8; guard++) {
    const w = words[words.length - 1], lw = w.toLowerCase(), prev = (words[words.length - 2] || '').toLowerCase();
    if (!priority && PRIO_WORDS[lw]) { priority = PRIO_WORDS[lw]; take(); continue; }
    if (!repeat && REPEAT_WORDS[lw]) { repeat = REPEAT_WORDS[lw]; take(); continue; }
    if (!repeat && prev === 'every' && (lw === 'day' || lw === 'week' || lw === 'month' || lw === 'weekday')) {
      repeat = { day: 'daily', week: 'weekly', month: 'monthly', weekday: 'weekdays' }[lw]; take(); take(); continue;
    }
    if (!repeat && prev === 'every' && weekdayIndex(lw) >= 0) {
      const wd = weekdayIndex(lw);
      repeat = 'weekly'; take(); take();
      if (!due) { let k = 0; while (new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + k).getDay() !== wd) k++; due = day(k); }
      continue;
    }
    if (!due) {
      let d = null, used = 1;
      if (lw === 'today' || lw === 'tonight') d = day(0);
      else if (lw === 'tomorrow' || lw === 'tmrw' || lw === 'tmr') d = day(1);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(lw) && validDay(lw)) d = lw;
      else if (weekdayIndex(lw) >= 0) {
        /* the coming one: today when it is that day ("next friday" reads the same) */
        const wd = weekdayIndex(lw);
        let k = 0;
        while (new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + k).getDay() !== wd) k++;
        if (prev === 'next') used = 2;
        d = day(k);
      } else if (lw === 'week' && prev === 'next') { d = day(7); used = 2; }
      else if (/^\d{1,2}(st|nd|rd|th)?$/.test(lw) && MONTHS.includes(prev.slice(0, 3)) && prev.length >= 3) {
        /* "nov 13" */
        const m = MONTHS.indexOf(prev.slice(0, 3)), dd = parseInt(lw, 10);
        let y = t0.getFullYear();
        let iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        if (validDay(iso) && iso < day(0)) iso = `${y + 1}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        if (validDay(iso)) { d = iso; used = 2; }
      } else if (MONTHS.includes(lw.slice(0, 3)) && lw.length >= 3 && /^\d{1,2}(st|nd|rd|th)?$/.test(prev)) {
        /* "13 nov" */
        const m = MONTHS.indexOf(lw.slice(0, 3)), dd = parseInt(prev, 10);
        const y = t0.getFullYear();
        let iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        if (validDay(iso) && iso < day(0)) iso = `${y + 1}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        if (validDay(iso)) { d = iso; used = 2; }
      } else if (/^in$/.test((words[words.length - 3] || '').toLowerCase()) && /^\d{1,3}$/.test(prev) && /^(days?|weeks?)$/.test(lw)) {
        /* "in 3 days", "in 2 weeks" */
        d = day(Number(prev) * (lw.startsWith('week') ? 7 : 1)); used = 3;
      }
      if (d && words.length > used) {
        for (let i = 0; i < used; i++) take();
        /* "due friday", "by friday", "on friday" */
        const f = (words[words.length - 1] || '').toLowerCase();
        if (words.length > 1 && (f === 'due' || f === 'by' || f === 'on')) take();
        due = d;
        continue;
      }
    }
    break;
  }
  if (repeat && !due) due = day(0);
  const text = words.join(' ');
  const said = [];
  if (due) said.push(`Due ${dayAt(due).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
  if (priority) said.push({ high: 'High priority', med: 'Medium priority', low: 'Low priority' }[priority]);
  if (repeat) said.push(REPEAT_LABEL[repeat]);
  return { text, due, priority, repeat, said };
}

/* ---- Markdown: a list out and back in ----
     # List name
     - [ ] Essay (due 2026-11-13) !high (repeats weekly)
       - [x] Outline
       > a note, one line per line
   A plain bullet or numbered list, or just lines, comes in too. */
export function toMarkdown(list) {
  const out = [`# ${list.name}`, ''];
  const go = (arr, depth) => {
    for (const t of arr) {
      const pad = '  '.repeat(depth);
      const bits = [t.text.replace(/\s+/g, ' ')];
      if (t.due) bits.push(`(due ${t.due})`);
      if (t.priority !== 'none') bits.push(`!${t.priority}`);
      if (t.repeat && t.repeat !== 'none') bits.push(`(repeats ${t.repeat})`);
      out.push(`${pad}- [${t.done ? 'x' : ' '}] ${bits.join(' ')}`);
      if (t.notes) for (const ln of t.notes.split('\n')) out.push(`${pad}  > ${ln}`);
      go(t.subs || [], depth + 1);
    }
  };
  go(list.tasks, 0);
  return out.join('\n') + '\n';
}
/** Markdown (or plain lines) -> { name, tasks } in the saved shape; nothing is saved here. */
export function fromMarkdown(text, now = Date.now()) {
  let name = '';
  const root = [];
  const stack = [];          /* [{ indent, task, depth }] */
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const head = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (head) { if (!name && !root.length) name = head[1].trim().slice(0, 60); continue; }
    const indent = (/^\s*/.exec(raw)[0].replace(/\t/g, '    ')).length;
    const note = /^\s*>\s?(.*)$/.exec(raw);
    if (note) {
      const owner = stack.length ? stack[stack.length - 1].task : null;
      if (owner) owner.notes = (owner.notes ? owner.notes + '\n' : '') + note[1];
      continue;
    }
    let m = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(raw);
    const body = (m ? m[2] : raw.trim()).trim();
    if (!body) continue;
    const done = !!(m && m[1] && m[1].toLowerCase() === 'x');
    let s = body, due = null, priority = 'none', repeat = 'none';
    s = s.replace(/\s*\(due (\d{4}-\d{2}-\d{2})\)/i, (_, d) => { if (validDay(d)) due = d; return ''; });
    s = s.replace(/\s*\(repeats (daily|weekdays|weekly|monthly)\)/i, (_, r) => { repeat = r.toLowerCase(); return ''; });
    s = s.replace(/\s+!(high|med|low)\b/i, (_, p) => { priority = p.toLowerCase(); return ''; });
    const task = normTask({ text: s.trim() || body, done, due, priority, repeat }, 1);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : null;
    if (parent && parent.depth < MAX_DEPTH && parent.task.subs.length < MAX_SUBS) {
      parent.task.subs.push(task);
      stack.push({ indent, task, depth: parent.depth + 1 });
    } else {
      if (root.length >= 1000) break;
      root.push(task);
      stack.push({ indent, task, depth: 1 });
    }
  }
  const fix = (arr, depth) => arr.map(t => normTask({ ...t, notes: t.notes, subs: fix(t.subs || [], depth + 1) }, depth));
  return { name, tasks: fix(root, 1) };
}

/* ---- a list in a link (sent to a friend): what it holds, never your reminders ---- */
export function packList(list) {
  const go = arr => arr.slice(0, MAX_SUBS).map(t => {
    const o = { t: t.text };
    if (t.done) o.x = 1;
    if (t.due) o.d = t.due;
    if (t.priority !== 'none') o.p = t.priority;
    if (t.repeat && t.repeat !== 'none') o.r = t.repeat;
    if (t.notes) o.n = t.notes.slice(0, 600);
    if (t.subs && t.subs.length) o.s = go(t.subs);
    return o;
  });
  return { n: list.name, c: list.color || undefined, i: list.icon !== 'list' ? list.icon : undefined, t: go(list.tasks.slice(0, 300)) };
}
/** A shared list read back and checked. -> { name, color, icon, tasks } | null */
export function unpackList(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.t)) return null;
  const go = (arr, depth) => (Array.isArray(arr) ? arr : []).slice(0, depth === 1 ? 300 : MAX_SUBS).filter(x => x && typeof x.t === 'string' && x.t.trim())
    .map(x => normTask({ text: x.t.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(), done: x.x === 1, due: x.d, priority: x.p, repeat: x.r, notes: x.n,
      subs: depth < MAX_DEPTH ? go(x.s, depth + 1) : [] }, depth));
  const tasks = go(o.t, 1);
  const name = String(o.n || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 60) || 'Shared list';
  return { name, color: LIST_COLORS.includes(o.c) ? o.c : '', icon: LIST_ICONS.includes(o.i) ? o.i : 'list', tasks };
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

export default {
  STORE_KEY, PRIOS, TEXT_MAX, MAX_DEPTH, MAX_SUBS, SMART, REPEATS, REPEAT_LABEL, SORTS, SORT_LABEL, LIST_COLORS, LIST_ICONS, uid, blank, validDay, dayOf,
  normTask, normList, normalize, cloneData, walkTasks, locate, progress, setDone, stepDue, nextDue, completeTask, sortTasks, search, parseQuick,
  toMarkdown, fromMarkdown, packList, unpackList, listColor, smart, reminderWants, syncReminders, lastReminders, read, write,
};
