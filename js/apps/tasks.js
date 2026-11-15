/* ============================================================
   tasks.js — Static Tasks: plain, honest checklists.

   Multiple named lists live in the sidebar, each with a colour and
   an icon of your choosing. Inside a list you add, edit, complete,
   reorder (drag the grip, or Move up/down from the row menu) and
   delete tasks. A task is text, a done flag, an optional due date,
   priority, repeat and reminder, and notes — it is this browser's
   lists and nothing else, saved under store('portal.tasks'), and it
   comes back exactly as you left it on reload.

   Subtasks nest up to three levels (task, subtask, sub-subtask). A
   parent shows how many of everything under it are done. The smart
   lists (Today, Upcoming, Overdue, High priority, and Homework due
   from Static Study) are computed from the real tasks and today's
   local date each time they are drawn, and again at local midnight;
   nothing about them is stored.

   Typing "Essay friday !high" in the add box makes a task called
   Essay, due on Friday, high priority — what was understood shows
   under the box before you press Enter, and only words at the end
   are read (js/core/tasks.js parseQuick). Pasting several lines adds
   them all, after you have seen them.

   A repeating task ticked off moves to its next due day instead of
   finishing. A task can ask for a reminder on its due day: that
   goes to the Automations reminder engine (js/core/tasks.js
   syncReminders), so it goes off like any other reminder, and only
   when asked for. Tasks with a due date show in Calendar as a layer
   (js/core/callayers.js). "Focus on this" starts Clock's focus timer
   with the task's name on it.

   A list can be sorted (by due date, priority or name — your own
   order is kept underneath), searched across every list, shown with
   finished tasks hidden, printed, exported and imported as Markdown,
   and sent to a friend as a link holding a copy of it (nothing is
   kept on a server; whoever opens it sees the list and adds it only
   if they choose). Deleting is undone from the notification or with
   Ctrl/Cmd+Z.

   Design notes:
   · store.set() no-ops when handed the same object reference, so
     every write ships a fresh deep clone (cloneData) — that is
     also what makes a reload restore the real state.
   · Reorder is only offered in the "All" filter, in your own order,
     with nothing hidden, because dragging one row of a filtered or
     sorted view to a new position is a lie about where it lands.
     Move up/down in the row menu is the keyboard- and touch-
     reachable equivalent.
   · Every count on screen is measured from the list, and empty
     states say what is actually true (no lists / empty list /
     nothing matches this filter) rather than inventing sample
     tasks.
   ============================================================ */
import { defineApp } from '../core/registry.js';
/* the lists' shape is shared with the desktop To-dos widget (js/shell/deskwidgets.js) */
import * as TASKS from '../core/tasks.js';
import * as HW from '../core/homework.js';
import { t as tr, plural, locale } from '../core/i18n.js';
const { STORE_KEY, PRIOS, MAX_DEPTH, normTask, normList, normalize, locate, walkTasks, progress, setDone, smart, SMART, dayOf } = TASKS;

/* self-injected stylesheet, guarded so re-opening never double-adds it */
if (typeof document !== 'undefined' && !document.getElementById('feat-tasks-css')) {
  const link = document.createElement('link');
  link.id = 'feat-tasks-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-tasks.css';
  document.head.appendChild(link);
}

const NARROW = 540;                 /* below this painted width, collapse to one pane */
const PRIO_LABEL = { none: tr('No priority'), low: tr('Low'), med: tr('Medium'), high: tr('High') };
const PRIO_NEXT = { none: 'low', low: 'med', med: 'high', high: 'none' };
const HOMEWORK = { id: 'homework', name: tr('Homework due'), icon: 'clipboard' };

const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* human due label + whether it is overdue, from the real date */
function dueInfo(iso) {
  if (!iso) return null;
  const parts = iso.split('-').map(Number);
  const day = startOfDay(new Date(parts[0], parts[1] - 1, parts[2]).getTime());
  const today = startOfDay(Date.now());
  const diff = Math.round((day - today) / 86400000);
  let label;
  if (diff === 0) label = tr('Today');
  else if (diff === 1) label = tr('Tomorrow');
  else if (diff === -1) label = tr('Yesterday');
  else if (diff > 1 && diff < 7) label = new Date(day).toLocaleDateString(locale(), { weekday: 'short' });
  else label = new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label, overdue: diff < 0, soon: diff === 0 };
}
const longDay = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const fileSafe = s => String(s || 'Tasks').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Tasks';

defineApp({
  id: 'tasks',
  name: 'Static Tasks',
  icon: 'check-circle',
  g1: '#7fe0a6', g2: '#1f9b62',
  category: 'Productivity',
  keywords: ['todo', 'to-do', 'task', 'tasks', 'checklist', 'list', 'lists', 'reminders', 'done', 'productivity', 'chores', 'repeat', 'homework', 'markdown', 'print', 'share list'],
  desc: 'Checklists that live on this device — repeats, quick add, sorting and sharing',
  singleton: true,
  win: { w: 820, h: 600, minW: 420, minH: 400 },

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, clear, store, confirm, menu, notify } = api;

    const S = {
      data: normalize(store.get(STORE_KEY)),
      filter: 'all',        /* 'all' | 'active' | 'done' */
      smart: null,          /* null (a list) | 'today' | 'upcoming' | 'overdue' | 'high' | 'homework' */
      q: '',                /* search across every list */
      subFor: null,         /* task whose new-subtask input is open */
      focusSub: false,
      focusRow: null,       /* task id whose row takes the keyboard after the next paint */
      collapsed: new Set(), /* parents folded shut (this window only) */
      undo: [],             /* deleted tasks, newest last: { task, listId, parentId, index } */
      editingId: null,      /* task being edited inline */
      addName: false,       /* new-list inline input open */
      renameOpen: false,    /* rename active list inline */
      styleOpen: false,     /* the active list's colour and icon picker */
      narrow: false,
      dead: false,
      dragId: null,
      focusAdd: false,
      focusEdit: false,
      focusNewList: false,
      focusRename: false,
      addText: '',          /* what is typed in the add box, kept across repaints */
    };

    /* the object we last wrote — anything else arriving on the key was written
       somewhere else (the desktop To-dos widget) and is read back in */
    let mine = null;
    let writing = false;           /* true while our own write goes through the store */

    /* seed a single empty list on first ever run, so there is a place to type.
       No fabricated tasks — the list opens honestly empty. */
    if (!S.data.lists.length) {
      const l = normList({ name: 'My Tasks' });
      S.data.lists = [l];
      S.data.activeId = l.id;
      persist();
    }

    function persist() { writing = true; try { mine = TASKS.write(S.data); } finally { writing = false; } }
    function commit() { persist(); render(); }

    const activeList = () => S.data.lists.find(l => l.id === S.data.activeId) || null;
    const hidesDone = list => !!(list && list.hideDone);
    const visibleTasks = list => {
      if (!list) return [];
      let arr = list.tasks;
      if (S.filter === 'active' || (S.filter === 'all' && hidesDone(list))) arr = arr.filter(t => !t.done);
      else if (S.filter === 'done') arr = arr.filter(t => t.done);
      return TASKS.sortTasks(arr, list.sort);
    };
    const allTasks = () => { let n = 0, d = 0; walkTasks(S.data, t => { n++; if (t.done) d++; }); return { n, d }; };
    const study = () => (api.getApp('study') ? HW.read() : null);
    const openHomework = data => (data ? HW.activeList(data).filter(a => !a.done).sort((a, b) => HW.dueAt(a) - HW.dueAt(b) || a.title.localeCompare(b.title)) : []);

    /* ---------------- task actions (by id, at any depth, in any list) ---------------- */
    function addTask(text) {
      const raw = String(text || '').trim();
      const list = activeList();
      if (!raw || !list) return;
      const q = TASKS.parseQuick(raw);
      const t = normTask({ text: q.text || raw, due: q.due, priority: q.priority || 'none', repeat: q.repeat || 'none' });
      list.tasks = [...list.tasks, t];
      S.addText = '';
      S.focusAdd = true;
      commit();
      if (q.said.length) notify({ app: 'Static Tasks', icon: 'check-circle', title: tr('Added {text}', { text: t.text }), message: q.said.join(' · '), timeout: 3500 });
    }
    /* several lines at once (a paste): seen first, then added as tasks — indents become subtasks */
    async function addMany(text) {
      const list = activeList();
      if (!list) return;
      const got = TASKS.fromMarkdown(text);
      const n = got.tasks.length;
      if (!n) return;
      let subs = 0;
      walkTasks({ lists: [{ tasks: got.tasks }] }, (t, l, p) => { if (p) subs++; });
      const preview = h('ul.tasks-pv', got.tasks.slice(0, 40).map(t => h('li', { text: t.text })),
        n > 40 ? h('li.tasks-pv__more', { text: tr('…and {n} more', { n: n - 40 }) }) : null);
      const ok = await confirm({ title: tr('Add {count} to “{name}”?', { count: plural(n, '{n} task', '{n} tasks'), name: list.name }), message: tr('One task for each line you pasted') + (subs ? tr(', and {count} from the indented lines', { count: plural(subs, '{n} subtask', '{n} subtasks') }) : '') + '.', body: preview, ok: tr('Add {n}', { n }) });
      if (!ok || S.dead) return;
      const live = S.data.lists.find(l => l.id === list.id);
      if (!live) return;
      live.tasks = [...live.tasks, ...got.tasks.map(t => normTask(t))];
      S.addText = '';
      commit();
      notify({ app: 'Static Tasks', icon: 'check-circle', title: tr('Added {count}', { count: plural(n, '{n} task', '{n} tasks') }), message: tr('To {name}.', { name: live.name }), timeout: 3000 });
    }
    function addSub(parentId, text) {
      const body = String(text || '').trim();
      const loc = locate(S.data, parentId);
      if (!body || !loc || loc.depth >= MAX_DEPTH || loc.task.subs.length >= TASKS.MAX_SUBS) return;
      loc.task.subs = [...loc.task.subs, normTask({ text: body }, loc.depth + 1)];
      S.collapsed.delete(parentId);
      S.focusSub = true;
      commit();
    }
    function mut(id, fn) {
      const loc = locate(S.data, id);
      if (!loc) return;
      fn(loc.task);
      loc.task.updated = Date.now();
      commit();
    }
    function toggleDone(id) {
      const loc = locate(S.data, id);
      if (!loc) return;
      const t = loc.task;
      if (!t.done && t.repeat && t.repeat !== 'none' && t.due) {
        /* a repeating task moves on to its next due day rather than finishing */
        const before = JSON.parse(JSON.stringify(t));
        const r = TASKS.completeTask(t);
        commit();
        api.bus.emit('tasks:done', { id });
        notify({ app: 'Static Tasks', icon: 'repeat', title: tr('Done: {text}', { text: t.text }), message: tr('It repeats — next due {date}.', { date: longDay(r.next) }), timeout: 6000,
          actions: [{ label: tr('Undo'), onClick: () => { const l2 = locate(S.data, id); if (!l2 || S.dead) return; Object.assign(l2.task, before); commit(); } }] });
        return;
      }
      mut(id, x => { setDone(x, !x.done); if (x.done) api.bus.emit('tasks:done', { id }); });
    }
    const cyclePriority = id => mut(id, t => { t.priority = PRIO_NEXT[t.priority] || 'low'; });
    function saveEdit(id, text, due, priority, remind, repeat, notes) {
      const body = String(text || '').trim();
      /* clear edit mode BEFORE the write, so the commit()/render() inside
         mut paints the finished row instead of the editor again */
      S.editingId = null;
      if (!body) { deleteTask(id); return; }
      const before = locate(S.data, id);
      const was = before && before.task.remind ? before.task.remind + '@' + before.task.due : '';
      mut(id, t => {
        const wasRepeat = t.repeat;
        t.text = body; t.due = due || null; t.priority = PRIOS.includes(priority) ? priority : 'none';
        t.remind = t.due && remind ? remind : null;
        t.repeat = t.due && TASKS.REPEATS.includes(repeat) ? repeat : 'none';
        if (t.repeat === 'monthly' && (wasRepeat !== 'monthly' || !t.mday)) t.mday = Number(t.due.slice(8, 10));
        if (t.repeat !== 'monthly') delete t.mday;
        if (notes !== undefined) t.notes = String(notes || '').replace(/\s+$/, '').slice(0, TASKS.NOTES_MAX);
      });
      const now = locate(S.data, id);
      if (now && now.task.remind && was !== now.task.remind + '@' + now.task.due && TASKS.lastReminders()[id] !== 'set') {
        notify({ app: 'Static Tasks', icon: 'bell', title: tr('No reminder was set'),
          message: TASKS.lastReminders()[id] === 'full' ? tr('Automations already holds as many reminders as it can.') : tr('That time has already passed.'), timeout: 6000 });
      }
    }
    /* deleting is undone, not asked about: the notification's Undo, or Ctrl/Cmd+Z */
    function deleteTask(id) {
      const loc = locate(S.data, id);
      if (!loc) return;
      const gone = new Set();
      walkTasks({ lists: [{ tasks: [loc.task] }] }, t => gone.add(t.id));
      const ids = [...mainEl.querySelectorAll('.tasks-row[data-id]')].map(r => r.dataset.id);
      const at = ids.indexOf(id);
      const near = ids.slice(at + 1).find(x => !gone.has(x)) || ids.slice(0, Math.max(0, at)).reverse().find(x => !gone.has(x)) || null;
      const entry = { task: loc.task, listId: loc.list.id, parentId: loc.parent ? loc.parent.id : null, index: loc.index };
      loc.arr.splice(loc.index, 1);
      S.undo.push(entry);
      if (S.undo.length > 20) S.undo.shift();
      if (S.editingId === id || gone.has(S.editingId)) S.editingId = null;
      S.focusRow = near;
      commit();
      notify({ app: 'Static Tasks', icon: 'trash', title: tr('Task deleted'), message: entry.task.text, timeout: 8000,
        actions: [{ label: tr('Undo'), onClick: () => restore(entry) }] });
    }
    function restore(entry) {
      const i = S.undo.indexOf(entry);
      if (i < 0 || S.dead) return false;
      S.undo.splice(i, 1);
      const list = S.data.lists.find(l => l.id === entry.listId) || activeList() || S.data.lists[0];
      if (!list) return false;
      const parent = entry.parentId ? (locate(S.data, entry.parentId) || {}).task : null;
      const arr = parent ? parent.subs : list.tasks;
      arr.splice(Math.min(entry.index, arr.length), 0, entry.task);
      S.focusRow = entry.task.id;
      commit();
      return true;
    }
    const undoDelete = () => (S.undo.length ? restore(S.undo[S.undo.length - 1]) : false);
    function moveTask(id, dir) {
      const loc = locate(S.data, id);
      if (!loc) return;
      const j = loc.index + dir;
      if (j < 0 || j >= loc.arr.length) return;
      [loc.arr[loc.index], loc.arr[j]] = [loc.arr[j], loc.arr[loc.index]];
      S.focusRow = id;
      commit();
    }
    /* drop `dragId` so it sits before task `beforeId` (or at end when null) */
    function reorderTo(beforeId) {
      const list = activeList();
      if (!list || !S.dragId) return;
      const from = list.tasks.findIndex(t => t.id === S.dragId);
      if (from < 0) return;
      const arr = [...list.tasks];
      const [moved] = arr.splice(from, 1);
      let to = beforeId ? arr.findIndex(t => t.id === beforeId) : arr.length;
      if (to < 0) to = arr.length;
      arr.splice(to, 0, moved);
      list.tasks = arr;
      commit();
    }
    async function clearCompleted() {
      const list = activeList();
      if (!list) return;
      const done = list.tasks.filter(t => t.done);
      if (!done.length) return;
      const ok = await confirm({ title: tr('Clear completed?'), message: tr('Remove {count} from “{name}”. This can’t be undone.', { count: plural(done.length, '{n} completed task', '{n} completed tasks'), name: list.name }), ok: tr('Clear'), danger: true });
      if (!ok || S.dead) return;
      list.tasks = list.tasks.filter(t => !t.done);
      commit();
    }
    /* "Focus on this": Clock's focus timer, with the task's name on it */
    async function focusOn(t) {
      try {
        const F = await import('../core/focus.js');
        const st = F.startOn(t.text);
        const min = Math.round(st.left / 60000);
        notify({ app: 'Static Tasks', icon: 'flame', title: tr('Focusing on {text}', { text: t.text }), message: tr('{count} on the focus timer.', { count: plural(min, '{n} minute', '{n} minutes') }), timeout: 4000,
          actions: [{ label: tr('Open timer'), onClick: () => api.openApp('clock', { tab: 'focus' }) }] });
      } catch (e) {
        notify({ app: 'Static Tasks', icon: 'alert', title: tr('The focus timer didn’t start'), message: String(e && e.message || e).slice(0, 100) });
      }
    }

    /* ---------------- list actions ---------------- */
    function addList(name, extra) {
      const nm = String(name || '').trim().slice(0, 60);
      if (!nm) { S.addName = false; render(); return null; }
      const l = normList({ name: nm, ...(extra || {}) });
      S.data.lists = [...S.data.lists, l];
      S.data.activeId = l.id;
      S.addName = false;
      S.smart = null;
      S.filter = 'all';
      S.q = '';
      commit();
      return l;
    }
    function renameList(name) {
      const list = activeList();
      const nm = String(name || '').trim().slice(0, 60);
      if (!list || !nm) { S.renameOpen = false; render(); return; }
      list.name = nm;
      S.renameOpen = false;
      commit();
    }
    async function deleteList(id) {
      const list = S.data.lists.find(l => l.id === id);
      if (!list) return;
      const ok = await confirm({ title: tr('Delete this list?'), message: tr('“{name}” and its {count} are removed from this device. This can’t be undone.', { name: list.name, count: plural(list.tasks.length, '{n} task', '{n} tasks') }), ok: tr('Delete'), danger: true });
      if (!ok || S.dead) return;
      S.data.lists = S.data.lists.filter(l => l.id !== id);
      if (S.data.activeId === id) S.data.activeId = S.data.lists[0] ? S.data.lists[0].id : '';
      commit();
    }
    function setListOpt(patch) {
      const list = activeList();
      if (!list) return;
      Object.assign(list, patch);
      commit();
    }
    function selectList(id) {
      S.smart = null;
      S.q = '';
      if (S.data.activeId !== id) {
        S.data.activeId = id;
        S.editingId = null;
        S.renameOpen = false;
        S.styleOpen = false;
        S.subFor = null;
        persist();
      }
      if (S.narrow) S.mobilePane = 'list';   /* on a phone, tapping a list always opens its pane */
      render();
    }
    function selectSmart(id) {
      S.smart = id;
      S.q = '';
      S.editingId = null; S.renameOpen = false; S.subFor = null; S.styleOpen = false;
      if (S.narrow) S.mobilePane = 'list';
      render();
    }
    /** Show one task where it lives: its list, its parents unfolded, its row focused. */
    function showTask(id) {
      const loc = locate(S.data, id);
      if (!loc) return false;
      S.smart = null; S.q = ''; S.filter = 'all'; S.editingId = null;
      if (S.data.activeId !== loc.list.id) { S.data.activeId = loc.list.id; persist(); }
      for (let p = loc.parent; p; p = (locate(S.data, p.id) || {}).parent) S.collapsed.delete(p.id);
      if (loc.task.done && hidesDone(loc.list)) S.filter = 'done';
      S.focusRow = id;
      if (S.narrow) S.mobilePane = 'list';
      render();
      return true;
    }

    /* ---------------- Markdown, print, share ---------------- */
    function download(name, text, type) {
      const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
      const a = h('a', { href: url, download: name, hidden: true });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    }
    function exportMarkdown(list) {
      const text = TASKS.toMarkdown(list);
      download(`${fileSafe(list.name)}.md`, text, 'text/markdown');
      notify({ app: 'Static Tasks', icon: 'download', title: tr('Downloading {file}.md', { file: fileSafe(list.name) }), message: tr('Every task with its due date, priority, repeat and notes; ticked ones as [x].'), timeout: 4000 });
      return text;
    }
    const mdIn = h('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', hidden: true, 'aria-hidden': 'true', tabindex: '-1', dataset: { fk: 'tasks-md-file' },
      onchange: async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importMarkdown(await f.text(), f.name, f.size); } });
    async function importMarkdown(text, fileName, size) {
      if (size > 512 * 1024) { notify({ app: 'Static Tasks', icon: 'alert', title: tr('That file wasn’t imported'), message: tr('It is bigger than 512 KB, more than a list should be.') }); return; }
      const got = TASKS.fromMarkdown(text);
      if (!got.tasks.length) { notify({ app: 'Static Tasks', icon: 'alert', title: tr('No tasks in that file'), message: tr('A list is lines, or “- [ ] …” bullets, one task each.'), timeout: 6000 }); return; }
      let n = 0, done = 0;
      walkTasks({ lists: [{ tasks: got.tasks }] }, t => { n++; if (t.done) done++; });
      const name = got.name || String(fileName || 'Imported list').replace(/\.(md|markdown|txt)$/i, '').slice(0, 60) || 'Imported list';
      const preview = h('ul.tasks-pv', got.tasks.slice(0, 40).map(t => h('li', { class: t.done ? 'is-done' : null, text: t.text })),
        got.tasks.length > 40 ? h('li.tasks-pv__more', { text: tr('…and {n} more', { n: got.tasks.length - 40 }) }) : null);
      const ok = await confirm({ title: tr('Import “{name}”?', { name }), message: plural(n, '{n} task', '{n} tasks') + (done ? tr(', {done} already ticked', { done }) : '') + tr(', as a new list. Nothing in the file is run; it is only read.'), body: preview, ok: tr('Add list') });
      if (!ok || S.dead) return;
      const l = addList(name);
      if (!l) return;
      l.tasks = got.tasks.map(t => normTask(t));
      commit();
      notify({ app: 'Static Tasks', icon: 'check-circle', title: tr('Added “{name}”', { name: l.name }), message: tr('{count} from {file}.', { count: plural(n, '{n} task', '{n} tasks'), file: String(fileName || tr('the file')).slice(0, 60) }), timeout: 4000 });
    }
    let printEl = null;
    function printList(list) {
      printEl?.remove();
      const go = (arr, depth) => h('ul', arr.map(t => h('li', { class: t.done ? 'is-done' : null },
        h('span.tasks-print__box', { text: t.done ? '☑' : '☐' }), ' ', h('span', { text: t.text }),
        t.due ? h('small', { text: '  ·  ' + tr('due {date}', { date: longDay(t.due) }) }) : null,
        t.priority !== 'none' ? h('small', { text: '  ·  ' + tr('{level} priority', { level: PRIO_LABEL[t.priority].toLowerCase() }) }) : null,
        t.notes ? h('div.tasks-print__note', { text: t.notes }) : null,
        t.subs.length ? go(t.subs, depth + 1) : null)));
      const total = list.tasks.length, done = list.tasks.filter(t => t.done).length;
      printEl = h('div.tasks-print', { 'aria-hidden': 'true' },
        h('h1', { text: list.name }), h('p', { text: tr('{done} of {total} done · printed {date}', { done, total, date: new Date().toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }) }),
        go(list.tasks, 1));
      document.body.appendChild(printEl);
      document.documentElement.classList.add('tasks-printing');
      const done2 = () => { document.documentElement.classList.remove('tasks-printing'); printEl?.remove(); printEl = null; window.removeEventListener('afterprint', done2); };
      window.addEventListener('afterprint', done2);
      setTimeout(done2, 120000);
      try { window.print(); } catch (e) { done2(); }
    }
    async function shareList(list) {
      const L = await import('../core/sharelink.js');
      const r = await L.packLink('tasklist', TASKS.packList(list));
      if (S.dead) return;
      if (!r.ok) { notify({ app: 'Static Tasks', icon: 'alert', title: tr('No link was made'), message: r.error, timeout: 7000 }); return; }
      const field = h('input.tasks-link', { type: 'text', readonly: true, value: r.link, 'aria-label': tr('Link to a copy of the list'), dataset: { fk: 'tasks-link' }, onfocus: e => e.target.select() });
      const ok = await confirm({
        title: tr('Send a copy of “{name}”', { name: list.name }),
        message: tr('A copy of the list travels inside this link: no server keeps it, and later changes don’t follow it. Whoever opens it in StaticOS sees the tasks first and adds them only if they choose. Your reminders stay with you.'),
        body: h('div.field.tasks-linkf', field), ok: tr('Copy link'), cancel: tr('Close'),
      });
      if (!ok) return;
      let copied = false;
      try { await navigator.clipboard.writeText(r.link); copied = true; } catch (e) { copied = false; }
      notify({ app: 'Static Tasks', icon: copied ? 'link' : 'alert', title: copied ? tr('Link copied') : tr('Copy the link yourself'), message: copied ? tr('Send it to whoever you want to have “{name}”.', { name: list.name }) : r.link.slice(0, 120), timeout: 5000 });
    }
    async function openShared(frag) {
      const L = await import('../core/sharelink.js');
      const r = await L.unpackLink('tasklist', frag);
      const got = r.ok ? TASKS.unpackList(r.data) : null;
      if (S.dead) return;
      if (!got || !got.tasks.length) { notify({ app: 'Static Tasks', icon: 'alert', title: tr('That link wasn’t opened'), message: r.ok ? tr('It doesn’t hold a list Static Tasks can read.') : r.error, timeout: 8000 }); return; }
      let n = 0;
      walkTasks({ lists: [{ tasks: got.tasks }] }, () => { n++; });
      const preview = h('ul.tasks-pv', { dataset: { fk: 'tasks-shared' } }, got.tasks.slice(0, 40).map(t => h('li', { class: t.done ? 'is-done' : null, text: t.text + (t.due ? '  ·  ' + tr('due {date}', { date: longDay(t.due) }) : '') })),
        got.tasks.length > 40 ? h('li.tasks-pv__more', { text: tr('…and {n} more', { n: got.tasks.length - 40 }) }) : null);
      const ok = await confirm({ title: tr('Add the list “{name}”?', { name: got.name }), message: tr('Someone sent you a copy of a list with {count}. Nothing is added unless you press Add. It becomes your own list: changes on either side don’t follow.', { count: plural(n, '{n} task', '{n} tasks') }), body: preview, ok: tr('Add list') });
      if (!ok || S.dead) return;
      const taken = new Set(S.data.lists.map(l => l.name));
      let name = got.name;
      for (let k = 2; taken.has(name) && k < 50; k++) name = `${got.name} ${k}`.slice(0, 60);
      const l = addList(name, { color: got.color, icon: got.icon });
      if (!l) return;
      l.tasks = got.tasks;
      commit();
      notify({ app: 'Static Tasks', icon: 'check-circle', title: tr('Added “{name}”', { name: l.name }), message: plural(n, '{n} task', '{n} tasks') + '.', timeout: 4000 });
    }

    /* ==================================================================== */
    /*  view                                                                */
    /* ==================================================================== */
    const sideEl = h('aside.app__side.tasks__side', { 'aria-label': tr('Lists') });
    const mainEl = h('div.app__main');
    const appEl = h('div.app.tasks', sideEl, mainEl, mdIn);
    root.appendChild(appEl);

    /* the search box lives outside the repaint, so typing never loses focus */
    const searchIn = h('input.tasks-search__in', { type: 'search', placeholder: tr('Search all lists'), 'aria-label': tr('Search all lists'), dataset: { fk: 'tasks-search' }, spellcheck: 'false',
      oninput: e => { S.q = e.target.value; S.editingId = null; if (S.narrow && S.q) S.mobilePane = 'list'; render(); },
      onkeydown: e => { if (e.key === 'Escape' && S.q) { e.preventDefault(); e.stopPropagation(); S.q = ''; e.target.value = ''; render(); } } });
    const searchBox = h('label.field.tasks-search', icon('search'), searchIn);

    /* ---------- sidebar ---------- */
    function renderSidebar() {
      for (const el of [...sideEl.children]) if (el !== searchBox) el.remove();
      if (!searchBox.parentNode) sideEl.append(searchBox);

      /* smart lists: counted from the real tasks and today's date */
      const smartGroup = h('div.side__group.tasks-side__smart', { role: 'group', 'aria-label': tr('Smart lists') },
        h('div.side__label', { text: tr('Smart lists') }));
      const hw = study();
      for (const k of [...SMART, ...(hw ? [HOMEWORK] : [])]) {
        const n = k.id === 'homework' ? openHomework(hw).length : smart(S.data, k.id).length;
        const on = S.smart === k.id && !S.q;
        smartGroup.append(h('button.side__item', {
          type: 'button', class: on ? 'is-on' : '', 'aria-current': on ? 'true' : null, dataset: { smart: k.id },
          'aria-label': `${k.name}, ${n} ${k.id === 'homework' ? 'assignment' : 'task'}${n === 1 ? '' : 's'}`,
          onclick: () => selectSmart(k.id),
        }, icon(k.icon), h('span', { text: k.name }), n ? h('small', { text: String(n) }) : null));
      }
      sideEl.append(smartGroup);

      const group = h('div.side__group.tasks-side__group',
        h('div.side__label', { text: tr('Lists') }));
      for (const l of S.data.lists) {
        const active = !S.smart && !S.q && l.id === S.data.activeId;
        const left = l.tasks.filter(t => !t.done).length;
        group.append(h('button.side__item.tasks-side__list', {
          type: 'button', class: active ? 'is-on' : '', 'aria-current': active ? 'true' : null, dataset: { list: l.id },
          style: { '--lc': TASKS.listColor(l) },
          onclick: () => selectList(l.id),
        }, h('span.tasks-lic', { 'aria-hidden': 'true' }, icon(l.icon)), h('span', { text: l.name }), left ? h('small', { text: String(left) }) : null));
      }

      if (S.addName) {
        const input = h('input.tasks-side__new', {
          type: 'text', maxlength: '60', placeholder: tr('List name'), 'aria-label': tr('New list name'),
          onkeydown: e => {
            if (e.key === 'Enter') { e.preventDefault(); addList(e.target.value); }
            else if (e.key === 'Escape') { e.preventDefault(); S.addName = false; render(); }
          },
        });
        S.focusNewList = true;
        group.append(h('div.tasks-side__newrow', input,
          h('button.ibtn', { type: 'button', 'aria-label': tr('Add list'), onclick: () => addList(input.value) }, icon('check'))));
      } else {
        group.append(h('button.side__item.tasks-side__add', { type: 'button', onclick: () => { S.addName = true; render(); } },
          icon('plus'), h('span', { text: tr('New list') })),
          h('button.side__item.tasks-side__add', { type: 'button', dataset: { fk: 'tasks-import' }, onclick: () => mdIn.click() },
            icon('upload'), h('span', { text: tr('Import Markdown…') })));
      }
      sideEl.append(group);

      /* honest footprint of everything on this device (subtasks count as tasks) */
      const { n: totalTasks, d: totalDone } = allTasks();
      sideEl.append(h('div.tasks-side__foot',
        h('div.side__meter',
          h('b', { text: plural(S.data.lists.length, '{n} list', '{n} lists') }),
          h('small', { text: totalTasks ? tr('{count} · {done} done', { count: plural(totalTasks, '{n} task', '{n} tasks'), done: totalDone }) : tr('No tasks yet') })),
        h('div.tasks-side__note', { text: tr('Saved on this device only.') })));
    }

    /* ---------- main ---------- */
    function renderMain() {
      clear(mainEl);
      if (S.q.trim()) { renderSearch(); return; }
      if (S.smart === 'homework') { renderHomework(); return; }
      if (S.smart) { renderSmart(); return; }
      const list = activeList();

      if (!list) {
        mainEl.append(h('div.app__bar', S.narrow ? backToLists() : null, h('div.app__title', { text: tr('Static Tasks') })));
        mainEl.append(h('div.app__content', h('div.empty',
          icon('check-circle'),
          h('b', { text: tr('No lists yet') }),
          h('small', { text: tr('Make a list to start checking things off. It stays on this device.') }),
          h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => { S.addName = true; render(); } }, icon('plus'), h('span', { text: tr('New list') })))));
      } else {
        renderList(list);
      }
    }

    function backToLists() {
      return h('button.ibtn', { type: 'button', 'aria-label': tr('Back to lists'), onclick: () => { S.mobilePane = 'lists'; S.q = ''; searchIn.value = ''; render(); } }, icon('chevron-left'));
    }

    const HINT = tr('↑ ↓ move · Enter edit · X done · S subtask · P priority · F focus · Delete remove · Ctrl+Z undo');
    const hintEl = () => h('div.tasks-hint', { text: HINT });

    /* ---------- search across every list ---------- */
    function renderSearch() {
      const hits = TASKS.search(S.data, S.q);
      const bar = h('div.app__bar', S.narrow ? backToLists() : null,
        h('div.app__title.tasks-title--static', { text: tr('Search') }),
        h('small.tasks-smart__count', { dataset: { fk: 'search-count' }, text: tr('{count} in every list', { count: plural(hits.length, '{n} match', '{n} matches') }) }));
      const body = h('div.tasks-body');
      if (!hits.length) body.append(h('div.empty', icon('search'), h('b', { text: tr('Nothing matches') }), h('small', { text: tr('Search looks in every list, at every level, in the tasks and their notes.') })));
      else {
        const rows = h('div.tasks-rows', { role: 'list', 'aria-label': tr('Search results') });
        let lastList = null;
        for (const x of hits) {
          if (x.list.id !== lastList) { lastList = x.list.id; rows.append(h('div.tasks-sect', { role: 'presentation', text: x.list.name })); }
          rows.append(taskRow(x.task, { depth: 1, smart: true, list: x.list, parent: x.parent }));
        }
        body.append(rows);
      }
      mainEl.append(bar, h('div.app__content.app__content--flush', body, hintEl()));
    }

    /* ---------- a smart list ---------- */
    function renderSmart() {
      const k = SMART.find(x => x.id === S.smart);
      const hits = smart(S.data, k.id);
      const bar = h('div.app__bar', S.narrow ? backToLists() : null,
        h('div.app__title.tasks-title--static', { text: k.name }),
        h('small.tasks-smart__count', { dataset: { fk: 'smart-count' }, text: plural(hits.length, '{n} task', '{n} tasks') }));
      const body = h('div.tasks-body');
      if (!hits.length) {
        body.append(h('div.empty', icon(k.icon), h('b', { text: k.empty }),
          h('small', { text: tr('This list is worked out from your tasks and today’s date. Add due dates and priorities in any list.') })));
      } else {
        const rows = h('div.tasks-rows', { role: 'list', 'aria-label': k.name });
        let lastList = null;
        for (const x of hits) {
          if (x.list.id !== lastList) { lastList = x.list.id; rows.append(h('div.tasks-sect', { role: 'presentation', text: x.list.name })); }
          rows.append(taskRow(x.task, { depth: 1, smart: true, list: x.list, parent: x.parent }));
        }
        body.append(rows);
      }
      mainEl.append(bar, h('div.app__content.app__content--flush', body, hintEl()));
    }

    /* ---------- Homework due: Static Study's own assignments ---------- */
    function renderHomework() {
      const data = study();
      const items = openHomework(data);
      const bar = h('div.app__bar', S.narrow ? backToLists() : null,
        h('div.app__title.tasks-title--static', { text: HOMEWORK.name }),
        h('small.tasks-smart__count', { dataset: { fk: 'smart-count' }, text: plural(items.length, '{n} assignment', '{n} assignments') }),
        h('span.tasks-spacer'),
        h('button.btn.btn--sm', { type: 'button', onclick: () => api.openApp('study', { tab: 'homework' }) }, icon('external-link'), h('span', { text: tr('Open Study') })));
      const body = h('div.tasks-body');
      if (!items.length) {
        body.append(h('div.empty', icon('clipboard'), h('b', { text: tr('No homework due') }),
          h('small', { text: tr('This list shows the assignments in Static Study › Homework that aren’t done yet.') })));
      } else {
        const rows = h('div.tasks-rows', { role: 'list', 'aria-label': HOMEWORK.name });
        const now = Date.now();
        for (const a of items) {
          const cls = data.classes.find(c => c.id === a.classId);
          const di = dueInfo(a.due);
          const over = HW.isOverdue(a, now);
          rows.append(h('div.tasks-row.tasks-row--hw', { role: 'listitem', dataset: { hw: a.id }, style: { '--lc': cls ? cls.color : 'var(--ink-3)' } },
            h('span.tasks-grip.tasks-grip--off', { 'aria-hidden': 'true' }),
            h('span.tasks-fold.tasks-fold--off', { 'aria-hidden': 'true' }),
            h('button.tasks-check', { type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': tr('Mark as done in Static Study: {title}', { title: a.title }),
              onclick: () => {
                const next = HW.read();
                const x = next.assignments.find(y => y.id === a.id);
                if (!x) return;
                x.done = true; x.doneAt = Date.now();
                HW.write(next);
                render();
                notify({ app: 'Static Tasks', icon: 'clipboard', title: tr('Done: {title}', { title: a.title }), message: tr('Ticked off in Static Study › Homework.'), timeout: 5000,
                  actions: [{ label: tr('Undo'), onClick: () => { const d2 = HW.read(); const y = d2.assignments.find(z => z.id === a.id); if (y) { y.done = false; y.doneAt = 0; HW.write(d2); if (!S.dead) render(); } } }] });
              } }),
            h('button.tasks-text', { type: 'button', 'aria-label': tr('Open in Static Study: {title}', { title: a.title }), onclick: () => api.openApp('study', { tab: 'homework', assignment: a.id }) },
              h('span.tasks-text__t', { text: a.title }),
              h('span.tasks-text__meta',
                cls ? h('span.tasks-hwcls', { text: cls.name }) : null,
                h('span.tasks-due', { class: over ? 'is-over' : di.soon ? 'is-soon' : '' }, icon('calendar'), h('span', { text: a.time ? `${di.label}, ${a.time}` : di.label })))),
            h('span.tasks-row__act', { style: { opacity: 1 } }, h('span.ibtn', { 'aria-hidden': 'true' }, icon('external-link')))));
        }
        body.append(rows);
      }
      mainEl.append(bar, h('div.app__content.app__content--flush', body, h('div.tasks-hint', { text: tr('From Static Study › Homework. Ticking one off here ticks it off there.') })));
    }

    /* the ring: done of all at the top level, drawn from the real counts */
    function ring(done, total) {
      const R = 9, C = 2 * Math.PI * R;
      const frac = total ? done / total : 0;
      return h('div.tasks-prog', { dataset: { fk: 'progress' }, role: 'img', 'aria-label': tr('{done} of {total} done', { done, total }) },
        h('svg.tasks-ring', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
          h('circle.tasks-ring__bg', { cx: '12', cy: '12', r: String(R) }),
          h('circle.tasks-ring__fg', { cx: '12', cy: '12', r: String(R), 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': (C * (1 - frac)).toFixed(2) })),
        h('small', { text: tr('{done} of {total} done', { done, total }) }),
        total > 0 && done === total ? h('small.tasks-prog__all', { text: tr('All done') }) : null);
    }

    function renderList(list) {
      const total = list.tasks.length;
      const done = list.tasks.filter(t => t.done).length;
      const active = total - done;
      const shown = visibleTasks(list);
      const hidden = S.filter === 'all' && hidesDone(list) ? done : 0;

      /* header bar */
      const title = S.renameOpen
        ? (() => {
            const input = h('input.tasks-rename', { type: 'text', value: list.name, maxlength: '60', 'aria-label': tr('List name'),
              onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); renameList(e.target.value); } else if (e.key === 'Escape') { e.preventDefault(); S.renameOpen = false; render(); } } });
            S.focusRename = true;
            return h('div.tasks-titlewrap', input, h('button.ibtn', { type: 'button', 'aria-label': tr('Save name'), onclick: () => renameList(input.value) }, icon('check')));
          })()
        : h('button.app__title.tasks-title', { type: 'button', title: tr('Rename list'), onclick: () => { S.renameOpen = true; render(); } },
            h('span.tasks-lic', { 'aria-hidden': 'true', style: { '--lc': TASKS.listColor(list) } }, icon(list.icon)), h('span', { text: list.name }));

      const filters = h('div.tabs.tasks-filters', { role: 'tablist', 'aria-label': tr('Filter tasks') },
        [['all', tr('All'), total - hidden], ['active', tr('Active'), active], ['done', tr('Done'), done]].map(([f, lbl, n]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': S.filter === f ? 'true' : 'false', class: S.filter === f ? 'is-on' : '',
            onclick: () => { S.filter = f; S.editingId = null; render(); } },
            h('span', { text: lbl }), h('small.tasks-fcount', { text: String(n) }))));

      const listMenu = e => menu([
        { label: tr('Rename list'), icon: 'edit-3', onClick: () => { S.renameOpen = true; render(); } },
        { label: tr('Colour and icon…'), icon: 'palette', onClick: () => { S.styleOpen = true; render(); } },
        { label: tr('Sort by'), icon: 'filter', items: TASKS.SORTS.map(k => ({ label: TASKS.SORT_LABEL[k], checked: list.sort === k, onClick: () => setListOpt({ sort: k }) })) },
        { label: tr('Hide completed'), icon: 'eye-off', checked: hidesDone(list), onClick: () => setListOpt({ hideDone: !hidesDone(list) }) },
        { label: tr('Clear completed'), icon: 'check-circle', disabled: !done, onClick: clearCompleted },
        '-',
        { label: tr('Send a copy to a friend…'), icon: 'send', disabled: !total, onClick: () => shareList(list) },
        { label: tr('Export as Markdown'), icon: 'download', disabled: !total, onClick: () => exportMarkdown(list) },
        { label: tr('Import Markdown…'), icon: 'upload', onClick: () => mdIn.click() },
        { label: tr('Print list'), icon: 'printer', disabled: !total, onClick: () => printList(list) },
        '-',
        { label: tr('Delete list'), icon: 'trash', danger: true, onClick: () => deleteList(list.id) },
      ], e.clientX, e.clientY, { label: tr('List actions') });

      const bar = h('div.app__bar',
        S.narrow ? backToLists() : null,
        title,
        h('span.tasks-spacer'),
        filters,
        h('button.ibtn', { type: 'button', 'aria-label': tr('List actions'), dataset: { fk: 'list-menu' }, onclick: listMenu }, icon('more-horizontal')));

      const content = h('div.app__content.app__content--flush');

      /* the colour and icon picker */
      const style = S.styleOpen ? h('div.tasks-style', { role: 'group', 'aria-label': tr('Colour and icon for {name}', { name: list.name }), dataset: { fk: 'list-style' } },
        h('div.tasks-style__row', { role: 'radiogroup', 'aria-label': tr('Colour') },
          [['', tr('Accent')], ...TASKS.LIST_COLORS.map((c, i) => [c, TASKS.LIST_COLOR_NAMES[i]])].map(([c, nm]) =>
            h('button.tasks-sw', { type: 'button', role: 'radio', 'aria-checked': String(list.color === c), 'aria-label': nm, title: nm, class: list.color === c ? 'is-on' : null,
              style: { '--lc': c || 'var(--accent)' }, dataset: { color: c || 'accent' }, onclick: () => setListOpt({ color: c }) }))),
        h('div.tasks-style__row.tasks-style__icons', { role: 'radiogroup', 'aria-label': tr('Icon') },
          TASKS.LIST_ICONS.filter(n => api.hasIcon(n)).map(n => h('button.tasks-icn', { type: 'button', role: 'radio', 'aria-checked': String(list.icon === n), 'aria-label': n.replace(/-/g, ' '), title: n.replace(/-/g, ' '),
            class: list.icon === n ? 'is-on' : null, dataset: { icon: n }, style: { '--lc': TASKS.listColor(list) }, onclick: () => setListOpt({ icon: n }) }, icon(n)))),
        h('button.btn.btn--sm', { type: 'button', onclick: () => { S.styleOpen = false; render(); } }, h('span', { text: tr('Done') }))) : null;

      /* add row: what quick add understood shows under it as you type */
      const quick = h('div.tasks-quick', { dataset: { fk: 'quick' }, 'aria-live': 'polite' });
      const showQuick = v => {
        const q = TASKS.parseQuick(v);
        clear(quick);
        if (q.said.length && q.text) quick.append(h('span', { text: `“${q.text}”` }), ...q.said.map(s => h('span.tasks-quick__chip', { text: s })));
        quick.hidden = !(q.said.length && q.text);
      };
      const addInput = h('input.tasks-add__in', {
        type: 'text', maxlength: '500', placeholder: tr('Add a task to {name}… (try “Essay friday !high”)', { name: list.name }), 'aria-label': tr('Add a task'), value: S.addText,
        oninput: e => { S.addText = e.target.value; showQuick(e.target.value); },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value; e.target.value = ''; addTask(v); } else if (e.key === 'Escape') { e.target.value = ''; S.addText = ''; showQuick(''); } },
        onpaste: e => {
          const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
          if (!/\n\s*\S/.test(text.trim())) return;      /* one line: an ordinary paste */
          e.preventDefault();
          addMany(text);
        },
      });
      showQuick(S.addText);
      if (S.focusAdd) { S.focusAdd = false; queueMicrotask(() => { try { addInput.focus(); } catch (e) {} }); }
      const addRow = h('div.tasks-add',
        h('div.field.tasks-add__field', addInput),
        h('button.btn.btn--sm.btn--primary', { type: 'button', 'aria-label': tr('Add task'), onclick: () => { const v = addInput.value; addInput.value = ''; addTask(v); } }, icon('plus'), h('span', { text: tr('Add') })));

      /* progress */
      const prog = total ? ring(done, total) : null;

      /* the list body */
      const body = h('div.tasks-body');
      if (!total) {
        body.append(h('div.empty',
          icon('check-circle'),
          h('b', { text: tr('Nothing here yet') }),
          h('small', { text: tr('Type above and press Enter to add your first task. Pasting several lines adds them all.') })));
      } else if (!shown.length) {
        body.append(h('div.empty',
          icon(S.filter === 'done' ? 'clock' : 'check-circle'),
          h('b', { text: S.filter === 'done' ? tr('Nothing completed yet') : tr('All done here') }),
          h('small', { text: S.filter === 'done' ? tr('Finished tasks will collect here.') : hidden ? plural(hidden, '{n} completed task is hidden.', '{n} completed tasks are hidden.') : tr('No active tasks — nice.') }),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.filter = hidden ? 'done' : 'all'; render(); } }, h('span', { text: hidden ? tr('Show completed') : tr('Show all') }))));
      } else {
        const rows = h('div.tasks-rows', { role: 'list' });
        const manual = list.sort === 'manual';
        const canReorder = S.filter === 'all' && manual && !hidden && shown.length > 1;
        const add = (arr, depth, parent) => {
          const items = depth > 1 ? TASKS.sortTasks(hidden ? arr.filter(t => !t.done) : arr, list.sort) : arr;
          for (const t of items) {
            rows.append(taskRow(t, { depth, list, parent, canReorder: S.filter === 'all' && manual && !hidden && (depth > 1 ? arr.length > 1 : canReorder), dragOk: depth === 1 && canReorder }));
            if (S.subFor === t.id) rows.append(subAddRow(t, depth));
            if (t.subs.length && !S.collapsed.has(t.id)) add(t.subs, depth + 1, t);
          }
        };
        add(shown, 1, null);
        if (canReorder) wireDrag(rows, list);
        body.append(rows);
        if (hidden) body.append(h('button.btn.btn--sm.tasks-hidden', { type: 'button', dataset: { fk: 'hidden-done' }, onclick: () => setListOpt({ hideDone: false }) },
          icon('eye'), h('span', { text: tr('{hidden} completed hidden — show', { hidden }) })));
        if (!manual) body.append(h('div.tasks-sortnote', { text: tr('Sorted by {how}. Your own order is kept: choose “Your order” in Sort by to drag tasks again.', { how: TASKS.SORT_LABEL[list.sort].toLowerCase() }) }));
      }

      /* native append(null) writes the text "null" — skip an absent progress bar */
      if (style) content.append(style);
      content.append(addRow, quick);
      if (prog) content.append(prog);
      content.append(body, hintEl());
      mainEl.append(bar, content);
    }

    /* ---------- the new-subtask input under a task ---------- */
    function subAddRow(t, depth) {
      const input = h('input.tasks-add__in', {
        type: 'text', maxlength: '500', placeholder: tr('Add a subtask to “{text}”…', { text: t.text.slice(0, 40) }), 'aria-label': tr('New subtask of {text}', { text: t.text }),
        onkeydown: e => {
          if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value; e.target.value = ''; addSub(t.id, v); }
          else if (e.key === 'Escape') { e.preventDefault(); S.subFor = null; S.focusRow = t.id; render(); }
        },
      });
      if (S.focusSub) { S.focusSub = false; queueMicrotask(() => { try { input.focus(); } catch (e) {} }); }
      return h('div.tasks-row.tasks-row--sub', { style: { paddingLeft: `${depth * 22 + 30}px` } },
        h('div.field.tasks-add__field', input),
        h('button.btn.btn--sm', { type: 'button', 'aria-label': tr('Add subtask'), onclick: () => { const v = input.value; input.value = ''; addSub(t.id, v); } }, icon('plus')),
        h('button.ibtn', { type: 'button', 'aria-label': tr('Done adding subtasks'), onclick: () => { S.subFor = null; S.focusRow = t.id; render(); } }, icon('x')));
    }

    const clockText = hm => { const [hh, mm] = hm.split(':').map(Number); return new Date(2000, 0, 1, hh, mm).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

    /* ---------- one task row ---------- */
    function taskRow(t, o) {
      if (S.editingId === t.id) return editorRow(t, o);
      const depth = o.depth || 1;

      const check = h('button.tasks-check', {
        type: 'button', class: t.done ? 'is-done' : '', role: 'checkbox', 'aria-checked': t.done ? 'true' : 'false',
        'aria-label': t.done ? tr('Mark as not done: {text}', { text: t.text }) : tr('Mark as done: {text}', { text: t.text }), onclick: () => toggleDone(t.id),
      }, t.done ? icon('check') : null);

      const di = dueInfo(t.due);
      const pr = progress(t);
      const meta = [];
      if (pr.total) meta.push(h('span.tasks-sub', { dataset: { fk: 'sub-progress' }, title: tr('{done} of {total} subtasks done', { done: pr.done, total: pr.total }), text: `${pr.done}/${pr.total}` }));
      if (di) meta.push(h('span.tasks-due', { class: di.overdue && !t.done ? 'is-over' : di.soon ? 'is-soon' : '' }, icon('calendar'), h('span', { text: di.label })));
      if (t.repeat && t.repeat !== 'none') meta.push(h('span.tasks-due.tasks-rep', { dataset: { fk: 'repeat' }, title: TASKS.REPEAT_LABEL[t.repeat] }, icon('repeat'), h('span', { text: TASKS.REPEAT_LABEL[t.repeat] })));
      if (t.remind) meta.push(h('span.tasks-due.tasks-rem', { title: tr('Reminder at {time} on the due day', { time: clockText(t.remind) }) }, icon('bell'), h('span', { text: clockText(t.remind) })));
      if (t.notes) meta.push(h('span.tasks-note', { dataset: { fk: 'note' }, title: t.notes.slice(0, 300) }, icon('file-text'), h('span', { text: t.notes.split('\n')[0].slice(0, 60) })));
      if (o.smart && o.parent) meta.push(h('span.tasks-ctx', { text: `in ${o.parent.text.slice(0, 30)}` }));

      const textBtn = h('button.tasks-text', {
        type: 'button', 'aria-label': tr('Edit task: {text}', { text: t.text }), onclick: () => { S.editingId = t.id; S.focusEdit = true; render(); },
      }, h('span.tasks-text__t', { text: t.text }), meta.length ? h('span.tasks-text__meta', meta) : null);

      const prioDot = h('button.tasks-prio', {
        type: 'button', class: `is-${t.priority}`, title: tr('{level} — click to change', { level: PRIO_LABEL[t.priority] }), 'aria-label': tr('Priority: {level}. Click to change.', { level: PRIO_LABEL[t.priority] }),
        onclick: () => cyclePriority(t.id),
      });

      const canSub = depth < MAX_DEPTH;
      const openSub = () => { S.subFor = t.id; S.focusSub = true; S.collapsed.delete(t.id); render(); };
      const actions = h('div.tasks-row__act',
        canSub && !o.smart ? h('button.ibtn.tasks-row__subbtn', { type: 'button', 'aria-label': tr('Add a subtask to {text}', { text: t.text }), onclick: openSub }, icon('plus')) : null,
        h('button.ibtn.tasks-row__edit', { type: 'button', 'aria-label': tr('Edit'), onclick: () => { S.editingId = t.id; S.focusEdit = true; render(); } }, icon('edit-3')),
        h('button.ibtn.tasks-row__del', { type: 'button', 'aria-label': tr('Delete {text}', { text: t.text }), onclick: () => deleteTask(t.id) }, icon('trash')),
        h('button.ibtn', {
          type: 'button', 'aria-label': tr('More'), dataset: { fk: 'row-menu' }, onclick: e => menu([
            o.canReorder ? { label: tr('Move up'), icon: 'arrow-up', onClick: () => moveTask(t.id, -1) } : null,
            o.canReorder ? { label: tr('Move down'), icon: 'arrow-down', onClick: () => moveTask(t.id, 1) } : null,
            o.canReorder ? '-' : null,
            !t.done ? { label: tr('Focus on this'), icon: 'flame', onClick: () => focusOn(t) } : null,
            t.due && api.getApp('calendar') ? { label: tr('See on Calendar'), icon: 'calendar', onClick: () => api.openApp('calendar', { date: t.due }) } : null,
            o.smart ? { label: tr('Show in {name}', { name: o.list.name }), icon: 'list', onClick: () => showTask(t.id) } : null,
            canSub && !o.smart ? { label: tr('Add subtask'), icon: 'plus', onClick: openSub } : null,
            { label: tr('Priority: ') + PRIO_LABEL[t.priority], icon: 'sliders', onClick: () => cyclePriority(t.id) },
            { label: tr('Edit…'), icon: 'edit-3', onClick: () => { S.editingId = t.id; S.focusEdit = true; render(); } },
            '-',
            { label: tr('Delete'), icon: 'trash', danger: true, onClick: () => deleteTask(t.id) },
          ].filter(Boolean), e.clientX, e.clientY),
        }, icon('more-vertical')));

      /* the grip glyph is drawn in CSS (six dots) so it needs no icon name */
      const grip = o.dragOk
        ? h('button.tasks-grip', { type: 'button', draggable: 'true', 'aria-label': tr('Drag to reorder'), title: tr('Drag to reorder'), dataset: { id: t.id } })
        : h('span.tasks-grip', { class: 'tasks-grip--off', 'aria-hidden': 'true' });

      const fold = t.subs.length && !o.smart
        ? h('button.tasks-fold', { type: 'button', 'aria-expanded': S.collapsed.has(t.id) ? 'false' : 'true',
            'aria-label': S.collapsed.has(t.id) ? tr('Show subtasks of {text}', { text: t.text }) : tr('Hide subtasks of {text}', { text: t.text }),
            onclick: () => { if (S.collapsed.has(t.id)) S.collapsed.delete(t.id); else S.collapsed.add(t.id); S.focusRow = t.id; render(); } },
            icon(S.collapsed.has(t.id) ? 'chevron-right' : 'chevron-down'))
        : h('span.tasks-fold.tasks-fold--off', { 'aria-hidden': 'true' });

      return h('div.tasks-row', { class: (t.done ? 'is-done ' : '') + `d${depth}`, dataset: { id: t.id, depth: String(depth) }, role: 'listitem',
        style: depth > 1 && !o.smart ? { paddingLeft: `${(depth - 1) * 22 + 8}px` } : null },
        grip, fold, check, textBtn, prioDot, actions);
    }

    /* ---------- inline editor ---------- */
    function editorRow(t, o = {}) {
      const textInput = h('input.tasks-edit__text', { type: 'text', value: t.text, maxlength: '500', 'aria-label': tr('Task text') });
      const dueInput = h('input.tasks-edit__due', { type: 'date', value: t.due || '', 'aria-label': tr('Due date') });
      const prioSel = h('select.select.tasks-edit__prio', { 'aria-label': tr('Priority') },
        PRIOS.map(p => h('option', { value: p, selected: p === t.priority ? '' : null, text: PRIO_LABEL[p] })));
      const repSel = h('select.select.tasks-edit__rep', { 'aria-label': tr('Repeat'), dataset: { fk: 'edit-repeat' } },
        TASKS.REPEATS.map(r => h('option', { value: r, selected: r === (t.repeat || 'none') ? '' : null, text: TASKS.REPEAT_LABEL[r] })));
      const remChk = h('input.tasks-edit__remchk', { type: 'checkbox', checked: !!t.remind, 'aria-label': tr('Remind me on the due date') });
      const remTime = h('input.tasks-edit__remtime', { type: 'time', value: t.remind || '09:00', 'aria-label': tr('Reminder time') });
      const remLbl = h('label.tasks-edit__lbl', icon('bell'), remChk, h('span', { text: tr('Remind me at') }), remTime);
      const notesIn = h('textarea.tasks-edit__notes', { rows: '2', maxlength: String(TASKS.NOTES_MAX), placeholder: tr('Notes (optional)'), 'aria-label': tr('Notes'), dataset: { fk: 'edit-notes' } });
      notesIn.value = t.notes || '';
      const syncRem = () => {
        const has = !!dueInput.value;
        remChk.disabled = !has; remTime.disabled = !has || !remChk.checked;
        remLbl.title = has ? '' : tr('Pick a due date first');
        repSel.disabled = !has;
        repSel.title = has ? '' : tr('A repeat needs a due date');
      };
      dueInput.addEventListener('input', syncRem);
      remChk.addEventListener('change', syncRem);
      syncRem();

      const save = () => saveEdit(t.id, textInput.value, dueInput.value, prioSel.value, remChk.checked && !remChk.disabled && remTime.value ? remTime.value : null,
        repSel.disabled ? 'none' : repSel.value, notesIn.value);
      const cancel = () => { S.editingId = null; S.focusRow = t.id; render(); };

      const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
      textInput.addEventListener('keydown', onKey);
      dueInput.addEventListener('keydown', onKey);
      remTime.addEventListener('keydown', onKey);
      /* in the notes, Enter is a new line; Ctrl/Cmd+Enter saves */
      notesIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } });

      if (S.focusEdit) { S.focusEdit = false; queueMicrotask(() => { try { textInput.focus(); textInput.select(); } catch (e) {} }); }

      return h('div.tasks-row.tasks-row--edit', { dataset: { id: t.id } },
        h('div.tasks-edit',
          h('div.field.tasks-edit__field', textInput),
          h('div.tasks-edit__controls',
            h('label.tasks-edit__lbl', icon('calendar'), dueInput,
              t.due ? h('button.ibtn', { type: 'button', 'aria-label': tr('Clear due date'), onclick: () => { dueInput.value = ''; syncRem(); } }, icon('x')) : null),
            prioSel,
            repSel,
            remLbl,
            h('span.tasks-spacer'),
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: save }, icon('check'), h('span', { text: tr('Save') })),
            h('button.btn.btn--sm', { type: 'button', onclick: cancel }, h('span', { text: tr('Cancel') }))),
          notesIn));
    }

    /* ---------- drag to reorder (mouse) ---------- */
    function wireDrag(rows, list) {
      let overId = null;
      const clearMarks = () => rows.querySelectorAll('.is-dropbefore').forEach(el => el.classList.remove('is-dropbefore'));

      rows.addEventListener('dragstart', e => {
        const grip = e.target.closest('.tasks-grip');
        if (!grip || grip.dataset.id === undefined) { e.preventDefault(); return; }
        S.dragId = grip.dataset.id;
        const row = grip.closest('.tasks-row');
        row?.classList.add('is-dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', S.dragId); if (row) e.dataTransfer.setDragImage(row, 20, 16); } catch (err) {}
      });
      rows.addEventListener('dragover', e => {
        if (!S.dragId) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
        const row = e.target.closest('.tasks-row');
        clearMarks();
        if (row && row.dataset.id !== S.dragId) {
          const r = row.getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          overId = after ? nextId(row) : row.dataset.id;
          row.classList.add('is-dropbefore');
        } else {
          overId = null;
        }
      });
      rows.addEventListener('drop', e => {
        if (!S.dragId) return;
        e.preventDefault();
        clearMarks();
        reorderTo(overId);      /* reads S.dragId, then commits + re-renders */
        S.dragId = null;
        overId = null;
      });
      rows.addEventListener('dragend', () => {
        S.dragId = null; overId = null; clearMarks();
        rows.querySelector('.is-dragging')?.classList.remove('is-dragging');
      });
      function nextId(row) { const n = row.nextElementSibling; return n && n.dataset ? n.dataset.id : null; }
    }

    /* ---------- full render ---------- */
    function render() {
      if (S.dead) return;
      appEl.classList.toggle('is-narrow', S.narrow);
      /* on a phone we show one pane at a time */
      if (S.narrow && S.mobilePane === 'list' && !activeList() && !S.smart && !S.q) S.mobilePane = 'lists';
      appEl.classList.toggle('show-list', S.narrow && S.mobilePane === 'list');
      if (searchIn.value !== S.q) searchIn.value = S.q;
      renderSidebar();
      renderMain();
      if (S.focusNewList) { S.focusNewList = false; requestAnimationFrame(() => { try { sideEl.querySelector('.tasks-side__new')?.focus(); } catch (e) {} }); }
      if (S.focusRename) { S.focusRename = false; requestAnimationFrame(() => { try { mainEl.querySelector('.tasks-rename')?.focus(); } catch (e) {} }); }
      if (S.focusRow) {
        const id = S.focusRow; S.focusRow = null;
        const b = [...mainEl.querySelectorAll('.tasks-row[data-id]')].find(r => r.dataset.id === id)?.querySelector('.tasks-text');
        try { if (b) b.focus(); } catch (e) {}
      }
    }

    /* ---------- keyboard: everything a mouse does ---------- */
    mainEl.addEventListener('keydown', e => {
      const btn = e.target.closest && e.target.closest('.tasks-text');
      if (!btn || e.metaKey || e.ctrlKey || e.altKey) return;
      const rowEl = btn.closest('.tasks-row');
      const id = rowEl && rowEl.dataset.id;
      const row = id ? locate(S.data, id) : null;
      if (!row) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const all = [...mainEl.querySelectorAll('.tasks-text')];
        const n = all[all.indexOf(btn) + (k === 'ArrowDown' ? 1 : -1)];
        if (n) n.focus();
      } else if (k === 'x') { e.preventDefault(); S.focusRow = id; toggleDone(id); }
      else if (k === 'p') { e.preventDefault(); S.focusRow = id; cyclePriority(id); }
      else if (k === 'f' && !row.task.done) { e.preventDefault(); focusOn(row.task); }
      else if (k === 's' && row.depth < MAX_DEPTH && !S.smart && !S.q) { e.preventDefault(); S.subFor = id; S.focusSub = true; S.collapsed.delete(id); render(); }
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteTask(id); }
      else if ((k === 'ArrowLeft' || k === 'ArrowRight') && row.task.subs.length) {
        e.preventDefault();
        if (k === 'ArrowLeft') S.collapsed.add(id); else S.collapsed.delete(id);
        S.focusRow = id; render();
      }
    });
    /* Ctrl/Cmd+Z undoes the last delete while this window is the one in front */
    const onUndoKey = e => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'z') return;
      if (!win.el.classList.contains('is-active')) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (undoDelete()) e.preventDefault();
    };
    window.addEventListener('keydown', onUndoKey);

    /* smart lists depend on today's date: repaint at local midnight (and keep doing so) */
    let midnight = 0;
    const armMidnight = () => {
      const n = new Date();
      const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1).getTime();
      midnight = setTimeout(() => { if (S.dead) return; render(); armMidnight(); }, Math.max(1000, next - n.getTime()));
    };

    S.mobilePane = 'lists';   /* which pane a phone shows: 'lists' | 'list' */

    /* ---------- responsive: react to the real painted width ---------- */
    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect?.width || appEl.clientWidth;
        const n = w > 0 && w < NARROW;
        if (n !== S.narrow) { S.narrow = n; if (!S.dead) render(); }
      });
      ro.observe(appEl);
    } else {
      S.narrow = (appEl.clientWidth || win.w || 820) < NARROW;
    }

    /* opened on a task (a reminder's Open, Calendar's layer), or with a sent list */
    function handle(o) {
      if (!o) return false;
      if (typeof o.task === 'string' && showTask(o.task)) return true;
      if (typeof o.shared === 'string' && o.shared) { openShared(o.shared); return false; }
      return false;
    }
    if (!handle(opts)) render();
    armMidnight();
    win.onReopen(o => { handle(o); });

    /* the To-dos widget on the desktop edits the same lists */
    const offOutside = store.sub(STORE_KEY, v => {
      if (S.dead || writing || v === mine) return;
      const active = S.data.activeId;
      S.data = normalize(v);
      if (S.data.lists.some(l => l.id === active)) S.data.activeId = active;
      if (S.editingId && !locate(S.data, S.editingId)) S.editingId = null;
      render();
    });
    /* Homework due follows Static Study */
    const offHw = store.sub(HW.KEY, () => { if (!S.dead && !S.editingId) render(); });

    /* ---------- teardown ---------- */
    return () => {
      offOutside();
      offHw();
      window.removeEventListener('keydown', onUndoKey);
      clearTimeout(midnight);
      S.dead = true;
      if (printEl) { printEl.remove(); document.documentElement.classList.remove('tasks-printing'); }
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
    };
  },
});
