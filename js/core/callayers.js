/* ============================================================
   callayers.js — what other apps keep, shown in Calendar as
   layers you can turn on. Read-only: each is read straight from
   its own app's store every time it is drawn, and clicking one
   opens it in the app that owns it — Calendar never changes them.

     tasks      Static Tasks: unfinished tasks with a due date
                (js/core/tasks.js), at any depth, all day
     board      Static Board: cards with a due date (js/core/boards.js),
                all day — not archived, not in a Done column
     homework   Static Study's assignments not yet done, not in an
                archived class (js/core/homework.js), at their due time
                or all day
     exams      Static Study's tests (js/core/exams.js)
     studyplan  the days of each test's study plan, with the topics
                planned for them (EX.plan, made again from the clock and
                your ticks every time it is drawn), all day
     timetable  Static Study's classes (js/core/timetable.js), on
                their weekdays — A/B weeks respected — week and day
                views only (a month of classes would hide everything)
     birthdays  Static Contacts' birthdays (js/core/contacts.js), each
                year on its day (a 29 February one on the 28th in other
                years), all day; "turns 17" only when the year is known

   Which are on is saved in store('portal.calendarView').layers;
   Tasks, Board and Birthdays are on until you turn them off (a due
   date is a date), the Study ones are off until you turn them on.
   ============================================================ */
import { store } from './store.js';
import * as TASKS from './tasks.js';
import * as BOARDS from './boards.js';
import * as HW from './homework.js';
import * as EX from './exams.js';
import * as TT from './timetable.js';
import * as CON from './contacts.js';

export const VIEW_KEY = 'portal.calendarView';
export const LAYERS = [
  { id: 'tasks', name: 'Tasks with due dates', app: 'Static Tasks', icon: 'check-circle', dflt: true },
  { id: 'board', name: 'Board cards with due dates', app: 'Static Board', icon: 'clipboard', dflt: true },
  { id: 'homework', name: 'Homework', app: 'Static Study', icon: 'clipboard', dflt: false },
  { id: 'exams', name: 'Exams', app: 'Static Study', icon: 'star', dflt: false },
  { id: 'studyplan', name: 'Exam study plans', app: 'Static Study', icon: 'layers', dflt: false },
  { id: 'timetable', name: 'Timetable classes', app: 'Static Study', icon: 'calendar', dflt: false, timedOnly: true },
  { id: 'birthdays', name: 'Birthdays', app: 'Static Contacts', icon: 'gift', dflt: true },
];

/** The saved view settings: { layers: { tasks, board, homework, exams, studyplan, timetable, birthdays }, mondayFirst, weekNums, forecast } */
export function view() {
  const v = store.get(VIEW_KEY, null);
  const o = v && typeof v === 'object' ? v : {};
  const l = o.layers && typeof o.layers === 'object' ? o.layers : {};
  const layers = {};
  for (const L of LAYERS) layers[L.id] = typeof l[L.id] === 'boolean' ? l[L.id] : L.dflt;
  /* forecast: the day panel's weather line (js/core/calweather.js), on until turned off */
  return { layers, mondayFirst: o.mondayFirst === true, weekNums: o.weekNums === true, forecast: o.forecast !== false };
}
export function setView(patch) {
  const cur = view();
  const next = { ...cur, ...patch, layers: { ...cur.layers, ...(patch && patch.layers) } };
  store.set(VIEW_KEY, next);
  return next;
}

/**
 * What the layers that are on hold, day by day, for days `from`..`to`
 * ('YYYY-MM-DD', both included). -> Map(day -> [item])
 *   item: { layer, id, title, sub, allDay, time, end, color, open: { app, opts } }
 */
export function between(from, to, on = view().layers) {
  const out = new Map();
  const put = (day, it) => { if (day < from || day > to) return; const a = out.get(day) || []; a.push(it); out.set(day, a); };
  if (on.tasks) {
    TASKS.walkTasks(TASKS.read(), (t, list, parent) => {
      if (t.done || !t.due || !t.text.trim()) return;
      put(t.due, { layer: 'tasks', id: t.id, title: t.text, sub: parent ? `${list.name} · in ${parent.text.slice(0, 30)}` : list.name, allDay: true, time: '', end: '',
        color: TASKS.listColor(list), open: { app: 'tasks', opts: { task: t.id } } });
    });
  }
  if (on.board) {
    /* a card's label colour, as Board draws it (css/feat-board.css) */
    const tone = { red: '#ff6b81', orange: '#ffa15c', yellow: '#f4cd4f', green: '#4ccf8d', blue: '#5ea8ff', purple: '#a98bff', pink: '#f47ac4' };
    for (const { board, col, card } of BOARDS.dueCards()) {
      put(card.due, { layer: 'board', id: card.id, title: card.title, sub: `${board.name} · ${col.name}`, allDay: true, time: '', end: '',
        color: tone[card.color] || '', open: { app: 'board', opts: { card: card.id } } });
    }
  }
  if (on.homework || on.exams || on.studyplan) {
    const hw = on.homework ? HW.read() : null;
    if (hw) for (const a of HW.activeList(hw)) {
      if (a.done) continue;
      const cls = hw.classes.find(c => c.id === a.classId);
      put(a.due, { layer: 'homework', id: a.id, title: cls ? `${cls.name}: ${a.title}` : a.title, sub: 'Homework due', allDay: !a.time, time: a.time || '', end: '',
        color: cls ? cls.color : '', open: { app: 'study', opts: { tab: 'homework', assignment: a.id } } });
    }
    if (on.exams) for (const e of EX.read().exams) {
      put(e.date, { layer: 'exams', id: e.id, title: `${e.subject} exam`, sub: 'Exam', allDay: !e.time, time: e.time || '', end: '',
        color: '', open: { app: 'study', opts: { tab: 'exams', exam: e.id } } });
    }
    if (on.studyplan) for (const e of EX.read().exams) {
      for (const d of EX.plan(e).days) {
        if (d.busy || !d.topics.length) continue;
        put(d.day, { layer: 'studyplan', id: `${e.id}:${d.day}`, title: `Study ${e.subject}: ${d.topics.map(t => t.text).join(', ')}`.slice(0, 160), sub: `Study plan · exam ${e.date}`, allDay: true, time: '', end: '',
          color: '', open: { app: 'study', opts: { tab: 'exams', exam: e.id } } });
      }
    }
  }
  if (on.timetable) {
    const data = TT.read();
    if (data.classes.length) {
      const classes = HW.read().classes;
      const a = TT.parseDay(from), b = TT.parseDay(to);
      for (let d = a, i = 0; d <= b && i < 62; i++, d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const k = TT.ymd(d);
        for (const c of TT.onDay(k, data)) {
          put(k, { layer: 'timetable', id: c.id, title: c.subject, sub: c.room ? `Room ${c.room}` : 'Class', allDay: false, time: c.start, end: c.end,
            color: TT.colorFor(c.subject, classes), open: { app: 'study', opts: { tab: 'timetable', cls: c.id } } });
        }
      }
    }
  }
  if (on.birthdays) {
    const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
    for (const c of CON.read().contacts) {
      if (!c.birthday) continue;
      for (let y = y0; y <= y1; y++) {
        const day = CON.birthdayIn(c.birthday, y);
        const age = CON.turns(c.birthday, day);
        put(day, { layer: 'birthdays', id: `${c.id}:${y}`, title: `${CON.display(c)}’s birthday`, sub: age ? `Turns ${age}` : 'Birthday', allDay: true, time: '', end: '',
          color: '', open: { app: 'contacts', opts: { contact: c.id } } });
      }
    }
  }
  for (const list of out.values()) list.sort((x, y) => (x.allDay === y.allDay ? x.time.localeCompare(y.time) || x.title.localeCompare(y.title) : x.allDay ? -1 : 1));
  return out;
}

/** The store keys a layer reads, so Calendar can redraw when one changes. */
export const KEYS = [TASKS.STORE_KEY, BOARDS.STORE_KEY, HW.KEY, EX.KEY, TT.KEY, CON.STORE_KEY, VIEW_KEY];

export default { VIEW_KEY, LAYERS, view, setView, between, KEYS };
