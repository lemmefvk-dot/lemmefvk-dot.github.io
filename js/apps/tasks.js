/* ============================================================
   tasks.js — Static Tasks: plain, honest checklists.

   Multiple named lists live in the sidebar. Inside a list you
   add, edit, complete, reorder (drag the grip, or Move up/down
   from the row menu) and delete tasks. A task is just text, a
   done flag, an optional due date and an optional priority — no
   accounts, no sync, no sharing. It is this browser's lists and
   nothing else, so everything is saved under store('portal.tasks')
   and comes back exactly as you left it on reload.

   Subtasks nest up to three levels (task, subtask, sub-subtask). A
   parent shows how many of everything under it are done. The smart
   lists (Today, Upcoming, Overdue, High priority) are computed from
   the real tasks and today's local date each time they are drawn,
   and again at local midnight; nothing about them is stored.
   A task can ask for a reminder on its due day: that goes to the
   Automations reminder engine (js/core/tasks.js syncReminders), so
   it goes off like any other reminder, and only when asked for.
   Deleting is undone from the notification or with Ctrl/Cmd+Z.

   Design notes:
   · store.set() no-ops when handed the same object reference, so
     every write ships a fresh deep clone (cloneData) — that is
     also what makes a reload restore the real state.
   · Reorder is only offered in the "All" filter, because dragging
     one row of a filtered subset to a new position is a lie about
     where it lands. Move up/down in the row menu is the keyboard-
     and touch-reachable equivalent.
   · Every count on screen is measured from the list, and empty
     states say what is actually true (no lists / empty list /
     nothing matches this filter) rather than inventing sample
     tasks.
   ============================================================ */
import { defineApp } from '../core/registry.js';
/* the lists' shape is shared with the desktop To-dos widget (js/shell/deskwidgets.js) */
import * as TASKS from '../core/tasks.js';
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
const PRIO_LABEL = { none: 'No priority', low: 'Low', med: 'Medium', high: 'High' };
const PRIO_NEXT = { none: 'low', low: 'med', med: 'high', high: 'none' };

const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* human due label + whether it is overdue, from the real date */
function dueInfo(iso) {
  if (!iso) return null;
  const parts = iso.split('-').map(Number);
  const day = startOfDay(new Date(parts[0], parts[1] - 1, parts[2]).getTime());
  const today = startOfDay(Date.now());
  const diff = Math.round((day - today) / 86400000);
  let label;
  if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff === -1) label = 'Yesterday';
  else if (diff > 1 && diff < 7) label = new Date(day).toLocaleDateString('en-US', { weekday: 'short' });
  else label = new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label, overdue: diff < 0, soon: diff === 0 };
}

defineApp({
  id: 'tasks',
  name: 'Static Tasks',
  icon: 'check-circle',
  g1: '#7fe0a6', g2: '#1f9b62',
  category: 'Productivity',
  keywords: ['todo', 'to-do', 'task', 'tasks', 'checklist', 'list', 'lists', 'reminders', 'done', 'productivity', 'chores'],
  desc: 'Simple checklists that live on this device',
  singleton: true,
  win: { w: 820, h: 600, minW: 420, minH: 400 },

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, clear, store, confirm, menu, notify } = api;

    const S = {
      data: normalize(store.get(STORE_KEY)),
      filter: 'all',        /* 'all' | 'active' | 'done' */
      smart: null,          /* null (a list) | 'today' | 'upcoming' | 'overdue' | 'high' */
      subFor: null,         /* task whose new-subtask input is open */
      focusSub: false,
      focusRow: null,       /* task id whose row takes the keyboard after the next paint */
      collapsed: new Set(), /* parents folded shut (this window only) */
      undo: [],             /* deleted tasks, newest last: { task, listId, parentId, index } */
      editingId: null,      /* task being edited inline */
      addName: false,       /* new-list inline input open */
      renameOpen: false,    /* rename active list inline */
      narrow: false,
      dead: false,
      dragId: null,
      focusAdd: false,
      focusEdit: false,
      focusNewList: false,
      focusRename: false,
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
    const visibleTasks = list => {
      if (!list) return [];
      if (S.filter === 'active') return list.tasks.filter(t => !t.done);
      if (S.filter === 'done') return list.tasks.filter(t => t.done);
      return list.tasks;
    };
    const allTasks = () => { let n = 0, d = 0; walkTasks(S.data, t => { n++; if (t.done) d++; }); return { n, d }; };

    /* ---------------- task actions (by id, at any depth, in any list) ---------------- */
    function addTask(text) {
      const body = String(text || '').trim();
      const list = activeList();
      if (!body || !list) return;
      list.tasks = [...list.tasks, normTask({ text: body })];
      S.focusAdd = true;
      commit();
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
    const toggleDone = id => mut(id, t => { setDone(t, !t.done); if (t.done) api.bus.emit('tasks:done', { id }); });
    const cyclePriority = id => mut(id, t => { t.priority = PRIO_NEXT[t.priority] || 'low'; });
    function saveEdit(id, text, due, priority, remind) {
      const body = String(text || '').trim();
      /* clear edit mode BEFORE the write, so the commit()/render() inside
         mut paints the finished row instead of the editor again */
      S.editingId = null;
      if (!body) { deleteTask(id); return; }
      const before = locate(S.data, id);
      const was = before && before.task.remind ? before.task.remind + '@' + before.task.due : '';
      mut(id, t => {
        t.text = body; t.due = due || null; t.priority = PRIOS.includes(priority) ? priority : 'none';
        t.remind = t.due && remind ? remind : null;
      });
      const now = locate(S.data, id);
      if (now && now.task.remind && was !== now.task.remind + '@' + now.task.due && TASKS.lastReminders()[id] !== 'set') {
        notify({ app: 'Static Tasks', icon: 'bell', title: 'No reminder was set',
          message: TASKS.lastReminders()[id] === 'full' ? 'Automations already holds as many reminders as it can.' : 'That time has already passed.', timeout: 6000 });
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
      notify({ app: 'Static Tasks', icon: 'trash', title: 'Task deleted', message: entry.task.text, timeout: 8000,
        actions: [{ label: 'Undo', onClick: () => restore(entry) }] });
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
      const ok = await confirm({ title: 'Clear completed?', message: `Remove ${done.length} completed task${done.length === 1 ? '' : 's'} from “${list.name}”. This can’t be undone.`, ok: 'Clear', danger: true });
      if (!ok || S.dead) return;
      list.tasks = list.tasks.filter(t => !t.done);
      commit();
    }

    /* ---------------- list actions ---------------- */
    function addList(name) {
      const nm = String(name || '').trim().slice(0, 60);
      if (!nm) { S.addName = false; render(); return; }
      const l = normList({ name: nm });
      S.data.lists = [...S.data.lists, l];
      S.data.activeId = l.id;
      S.addName = false;
      S.smart = null;
      S.filter = 'all';
      commit();
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
      const ok = await confirm({ title: 'Delete this list?', message: `“${list.name}” and its ${list.tasks.length} task${list.tasks.length === 1 ? '' : 's'} are removed from this device. This can’t be undone.`, ok: 'Delete', danger: true });
      if (!ok || S.dead) return;
      S.data.lists = S.data.lists.filter(l => l.id !== id);
      if (S.data.activeId === id) S.data.activeId = S.data.lists[0] ? S.data.lists[0].id : '';
      commit();
    }
    function selectList(id) {
      S.smart = null;
      if (S.data.activeId !== id) {
        S.data.activeId = id;
        S.editingId = null;
        S.renameOpen = false;
        S.subFor = null;
        persist();
      }
      if (S.narrow) S.mobilePane = 'list';   /* on a phone, tapping a list always opens its pane */
      render();
    }
    function selectSmart(id) {
      S.smart = id;
      S.editingId = null; S.renameOpen = false; S.subFor = null;
      if (S.narrow) S.mobilePane = 'list';
      render();
    }

    /* ==================================================================== */
    /*  view                                                                */
    /* ==================================================================== */
    const sideEl = h('aside.app__side.tasks__side', { 'aria-label': 'Lists' });
    const mainEl = h('div.app__main');
    const appEl = h('div.app.tasks', sideEl, mainEl);
    root.appendChild(appEl);

    /* ---------- sidebar ---------- */
    function renderSidebar() {
      clear(sideEl);

      /* smart lists: counted from the real tasks and today's date */
      const smartGroup = h('div.side__group.tasks-side__smart', { role: 'group', 'aria-label': 'Smart lists' },
        h('div.side__label', { text: 'Smart lists' }));
      for (const k of SMART) {
        const n = smart(S.data, k.id).length;
        const on = S.smart === k.id;
        smartGroup.append(h('button.side__item', {
          type: 'button', class: on ? 'is-on' : '', 'aria-current': on ? 'true' : null, dataset: { smart: k.id },
          'aria-label': `${k.name}, ${n} task${n === 1 ? '' : 's'}`,
          onclick: () => selectSmart(k.id),
        }, icon(k.icon), h('span', { text: k.name }), n ? h('small', { text: String(n) }) : null));
      }
      sideEl.append(smartGroup);

      const group = h('div.side__group.tasks-side__group',
        h('div.side__label', { text: 'Lists' }));
      for (const l of S.data.lists) {
        const active = !S.smart && l.id === S.data.activeId;
        const left = l.tasks.filter(t => !t.done).length;
        group.append(h('button.side__item', {
          type: 'button', class: active ? 'is-on' : '', 'aria-current': active ? 'true' : null, dataset: { list: l.id },
          onclick: () => selectList(l.id),
        }, icon('list'), h('span', { text: l.name }), left ? h('small', { text: String(left) }) : null));
      }

      if (S.addName) {
        const input = h('input.tasks-side__new', {
          type: 'text', maxlength: '60', placeholder: 'List name', 'aria-label': 'New list name',
          onkeydown: e => {
            if (e.key === 'Enter') { e.preventDefault(); addList(e.target.value); }
            else if (e.key === 'Escape') { e.preventDefault(); S.addName = false; render(); }
          },
        });
        S.focusNewList = true;
        group.append(h('div.tasks-side__newrow', input,
          h('button.ibtn', { type: 'button', 'aria-label': 'Add list', onclick: () => addList(input.value) }, icon('check'))));
      } else {
        group.append(h('button.side__item.tasks-side__add', { type: 'button', onclick: () => { S.addName = true; render(); } },
          icon('plus'), h('span', { text: 'New list' })));
      }
      sideEl.append(group);

      /* honest footprint of everything on this device (subtasks count as tasks) */
      const { n: totalTasks, d: totalDone } = allTasks();
      sideEl.append(h('div.tasks-side__foot',
        h('div.side__meter',
          h('b', { text: `${S.data.lists.length} list${S.data.lists.length === 1 ? '' : 's'}` }),
          h('small', { text: totalTasks ? `${totalTasks} task${totalTasks === 1 ? '' : 's'} · ${totalDone} done` : 'No tasks yet' })),
        h('div.tasks-side__note', { text: 'Saved on this device only.' })));
    }

    /* ---------- main ---------- */
    function renderMain() {
      clear(mainEl);
      if (S.smart) { renderSmart(); return; }
      const list = activeList();

      if (!list) {
        mainEl.append(h('div.app__bar', S.narrow ? backToLists() : null, h('div.app__title', { text: 'Static Tasks' })));
        mainEl.append(h('div.app__content', h('div.empty',
          icon('check-circle'),
          h('b', { text: 'No lists yet' }),
          h('small', { text: 'Make a list to start checking things off. It stays on this device.' }),
          h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => { S.addName = true; render(); } }, icon('plus'), h('span', { text: 'New list' })))));
      } else {
        renderList(list);
      }
    }

    function backToLists() {
      return h('button.ibtn', { type: 'button', 'aria-label': 'Back to lists', onclick: () => { S.mobilePane = 'lists'; render(); } }, icon('chevron-left'));
    }

    const HINT = '↑ ↓ move · Enter edit · X done · S subtask · P priority · Delete remove · Ctrl+Z undo';
    const hintEl = () => h('div.tasks-hint', { text: HINT });

    /* ---------- a smart list ---------- */
    function renderSmart() {
      const k = SMART.find(x => x.id === S.smart);
      const hits = smart(S.data, k.id);
      const bar = h('div.app__bar', S.narrow ? backToLists() : null,
        h('div.app__title.tasks-title--static', { text: k.name }),
        h('small.tasks-smart__count', { dataset: { fk: 'smart-count' }, text: `${hits.length} task${hits.length === 1 ? '' : 's'}` }));
      const body = h('div.tasks-body');
      if (!hits.length) {
        body.append(h('div.empty', icon(k.icon), h('b', { text: k.empty }),
          h('small', { text: 'This list is worked out from your tasks and today’s date. Add due dates and priorities in any list.' })));
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

    function renderList(list) {
      const total = list.tasks.length;
      const done = list.tasks.filter(t => t.done).length;
      const active = total - done;
      const shown = visibleTasks(list);

      /* header bar */
      const title = S.renameOpen
        ? (() => {
            const input = h('input.tasks-rename', { type: 'text', value: list.name, maxlength: '60', 'aria-label': 'List name',
              onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); renameList(e.target.value); } else if (e.key === 'Escape') { e.preventDefault(); S.renameOpen = false; render(); } } });
            S.focusRename = true;
            return h('div.tasks-titlewrap', input, h('button.ibtn', { type: 'button', 'aria-label': 'Save name', onclick: () => renameList(input.value) }, icon('check')));
          })()
        : h('button.app__title.tasks-title', { type: 'button', title: 'Rename list', onclick: () => { S.renameOpen = true; render(); } }, h('span', { text: list.name }));

      const filters = h('div.tabs.tasks-filters', { role: 'tablist', 'aria-label': 'Filter tasks' },
        [['all', 'All', total], ['active', 'Active', active], ['done', 'Done', done]].map(([f, lbl, n]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': S.filter === f ? 'true' : 'false', class: S.filter === f ? 'is-on' : '',
            onclick: () => { S.filter = f; S.editingId = null; render(); } },
            h('span', { text: lbl }), h('small.tasks-fcount', { text: String(n) }))));

      const bar = h('div.app__bar',
        S.narrow ? backToLists() : null,
        title,
        h('span.tasks-spacer'),
        filters,
        h('button.ibtn', {
          type: 'button', 'aria-label': 'List actions', onclick: e => menu([
            { label: 'Rename list', icon: 'edit-3', onClick: () => { S.renameOpen = true; render(); } },
            { label: 'Clear completed', icon: 'check-circle', disabled: !done, onClick: clearCompleted },
            '-',
            { label: 'Delete list', icon: 'trash', danger: true, onClick: () => deleteList(list.id) },
          ], e.clientX, e.clientY),
        }, icon('more-horizontal')));

      const content = h('div.app__content.app__content--flush');

      /* add row */
      const addInput = h('input.tasks-add__in', {
        type: 'text', maxlength: '500', placeholder: `Add a task to ${list.name}…`, 'aria-label': 'Add a task',
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value; e.target.value = ''; addTask(v); } else if (e.key === 'Escape') { e.target.value = ''; } },
      });
      if (S.focusAdd) { S.focusAdd = false; queueMicrotask(() => { try { addInput.focus(); } catch (e) {} }); }
      const addRow = h('div.tasks-add',
        h('div.field.tasks-add__field', addInput),
        h('button.btn.btn--sm.btn--primary', { type: 'button', 'aria-label': 'Add task', onclick: () => { const v = addInput.value; addInput.value = ''; addTask(v); } }, icon('plus'), h('span', { text: 'Add' })));

      /* progress */
      const prog = total
        ? h('div.tasks-prog',
            h('div.bar', h('i', { style: { width: (done / total * 100) + '%' } })),
            h('small', { text: `${done} of ${total} done` }))
        : null;

      /* the list body */
      const body = h('div.tasks-body');
      if (!total) {
        body.append(h('div.empty',
          icon('check-circle'),
          h('b', { text: 'Nothing here yet' }),
          h('small', { text: 'Type above and press Enter to add your first task.' })));
      } else if (!shown.length) {
        body.append(h('div.empty',
          icon(S.filter === 'done' ? 'clock' : 'check-circle'),
          h('b', { text: S.filter === 'done' ? 'Nothing completed yet' : 'All done here' }),
          h('small', { text: S.filter === 'done' ? 'Finished tasks will collect here.' : 'No active tasks — nice.' }),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { S.filter = 'all'; render(); } }, h('span', { text: 'Show all' }))));
      } else {
        const rows = h('div.tasks-rows', { role: 'list' });
        const canReorder = S.filter === 'all' && shown.length > 1;
        const add = (arr, depth, parent) => {
          for (const t of arr) {
            rows.append(taskRow(t, { depth, list, parent, canReorder: S.filter === 'all' && (depth > 1 ? arr.length > 1 : canReorder), dragOk: depth === 1 && canReorder }));
            if (S.subFor === t.id) rows.append(subAddRow(t, depth));
            if (t.subs.length && !S.collapsed.has(t.id)) add(t.subs, depth + 1, t);
          }
        };
        add(shown, 1, null);
        if (canReorder) wireDrag(rows, list);
        body.append(rows);
      }

      /* native append(null) writes the text "null" — skip an absent progress bar */
      content.append(addRow);
      if (prog) content.append(prog);
      content.append(body, hintEl());
      mainEl.append(bar, content);
    }

    /* ---------- the new-subtask input under a task ---------- */
    function subAddRow(t, depth) {
      const input = h('input.tasks-add__in', {
        type: 'text', maxlength: '500', placeholder: `Add a subtask to “${t.text.slice(0, 40)}”…`, 'aria-label': `New subtask of ${t.text}`,
        onkeydown: e => {
          if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value; e.target.value = ''; addSub(t.id, v); }
          else if (e.key === 'Escape') { e.preventDefault(); S.subFor = null; S.focusRow = t.id; render(); }
        },
      });
      if (S.focusSub) { S.focusSub = false; queueMicrotask(() => { try { input.focus(); } catch (e) {} }); }
      return h('div.tasks-row.tasks-row--sub', { style: { paddingLeft: `${depth * 22 + 30}px` } },
        h('div.field.tasks-add__field', input),
        h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Add subtask', onclick: () => { const v = input.value; input.value = ''; addSub(t.id, v); } }, icon('plus')),
        h('button.ibtn', { type: 'button', 'aria-label': 'Done adding subtasks', onclick: () => { S.subFor = null; S.focusRow = t.id; render(); } }, icon('x')));
    }

    const clockText = hm => { const [hh, mm] = hm.split(':').map(Number); return new Date(2000, 0, 1, hh, mm).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

    /* ---------- one task row ---------- */
    function taskRow(t, o) {
      if (S.editingId === t.id) return editorRow(t, o);
      const depth = o.depth || 1;

      const check = h('button.tasks-check', {
        type: 'button', class: t.done ? 'is-done' : '', role: 'checkbox', 'aria-checked': t.done ? 'true' : 'false',
        'aria-label': t.done ? `Mark as not done: ${t.text}` : `Mark as done: ${t.text}`, onclick: () => toggleDone(t.id),
      }, t.done ? icon('check') : null);

      const di = dueInfo(t.due);
      const pr = progress(t);
      const meta = [];
      if (pr.total) meta.push(h('span.tasks-sub', { dataset: { fk: 'sub-progress' }, title: `${pr.done} of ${pr.total} subtasks done`, text: `${pr.done}/${pr.total}` }));
      if (di) meta.push(h('span.tasks-due', { class: di.overdue && !t.done ? 'is-over' : di.soon ? 'is-soon' : '' }, icon('calendar'), h('span', { text: di.label })));
      if (t.remind) meta.push(h('span.tasks-due.tasks-rem', { title: `Reminder at ${clockText(t.remind)} on the due day` }, icon('bell'), h('span', { text: clockText(t.remind) })));
      if (o.smart && o.parent) meta.push(h('span.tasks-ctx', { text: `in ${o.parent.text.slice(0, 30)}` }));

      const textBtn = h('button.tasks-text', {
        type: 'button', 'aria-label': `Edit task: ${t.text}`, onclick: () => { S.editingId = t.id; S.focusEdit = true; render(); },
      }, h('span.tasks-text__t', { text: t.text }), meta.length ? h('span.tasks-text__meta', meta) : null);

      const prioDot = h('button.tasks-prio', {
        type: 'button', class: `is-${t.priority}`, title: `${PRIO_LABEL[t.priority]} — click to change`, 'aria-label': `Priority: ${PRIO_LABEL[t.priority]}. Click to change.`,
        onclick: () => cyclePriority(t.id),
      });

      const canSub = depth < MAX_DEPTH;
      const openSub = () => { S.subFor = t.id; S.focusSub = true; S.collapsed.delete(t.id); render(); };
      const actions = h('div.tasks-row__act',
        canSub ? h('button.ibtn.tasks-row__subbtn', { type: 'button', 'aria-label': `Add a subtask to ${t.text}`, onclick: openSub }, icon('plus')) : null,
        h('button.ibtn.tasks-row__edit', { type: 'button', 'aria-label': 'Edit', onclick: () => { S.editingId = t.id; S.focusEdit = true; render(); } }, icon('edit-3')),
        h('button.ibtn.tasks-row__del', { type: 'button', 'aria-label': `Delete ${t.text}`, onclick: () => deleteTask(t.id) }, icon('trash')),
        h('button.ibtn', {
          type: 'button', 'aria-label': 'More', onclick: e => menu([
            o.canReorder ? { label: 'Move up', icon: 'arrow-up', onClick: () => moveTask(t.id, -1) } : null,
            o.canReorder ? { label: 'Move down', icon: 'arrow-down', onClick: () => moveTask(t.id, 1) } : null,
            o.canReorder ? '-' : null,
            canSub ? { label: 'Add subtask', icon: 'plus', onClick: openSub } : null,
            { label: 'Priority: ' + PRIO_LABEL[t.priority], icon: 'sliders', onClick: () => cyclePriority(t.id) },
            { label: 'Edit…', icon: 'edit-3', onClick: () => { S.editingId = t.id; S.focusEdit = true; render(); } },
            '-',
            { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteTask(t.id) },
          ].filter(Boolean), e.clientX, e.clientY),
        }, icon('more-vertical')));

      /* the grip glyph is drawn in CSS (six dots) so it needs no icon name */
      const grip = o.dragOk
        ? h('button.tasks-grip', { type: 'button', draggable: 'true', 'aria-label': 'Drag to reorder', title: 'Drag to reorder', dataset: { id: t.id } })
        : h('span.tasks-grip', { class: 'tasks-grip--off', 'aria-hidden': 'true' });

      const fold = t.subs.length && !o.smart
        ? h('button.tasks-fold', { type: 'button', 'aria-expanded': S.collapsed.has(t.id) ? 'false' : 'true',
            'aria-label': `${S.collapsed.has(t.id) ? 'Show' : 'Hide'} subtasks of ${t.text}`,
            onclick: () => { if (S.collapsed.has(t.id)) S.collapsed.delete(t.id); else S.collapsed.add(t.id); S.focusRow = t.id; render(); } },
            icon(S.collapsed.has(t.id) ? 'chevron-right' : 'chevron-down'))
        : h('span.tasks-fold.tasks-fold--off', { 'aria-hidden': 'true' });

      return h('div.tasks-row', { class: (t.done ? 'is-done ' : '') + `d${depth}`, dataset: { id: t.id, depth: String(depth) }, role: 'listitem',
        style: depth > 1 && !o.smart ? { paddingLeft: `${(depth - 1) * 22 + 8}px` } : null },
        grip, fold, check, textBtn, prioDot, actions);
    }

    /* ---------- inline editor ---------- */
    function editorRow(t, o = {}) {
      const textInput = h('input.tasks-edit__text', { type: 'text', value: t.text, maxlength: '500', 'aria-label': 'Task text' });
      const dueInput = h('input.tasks-edit__due', { type: 'date', value: t.due || '', 'aria-label': 'Due date' });
      const prioSel = h('select.select.tasks-edit__prio', { 'aria-label': 'Priority' },
        PRIOS.map(p => h('option', { value: p, selected: p === t.priority ? '' : null, text: PRIO_LABEL[p] })));
      const remChk = h('input.tasks-edit__remchk', { type: 'checkbox', checked: !!t.remind, 'aria-label': 'Remind me on the due date' });
      const remTime = h('input.tasks-edit__remtime', { type: 'time', value: t.remind || '09:00', 'aria-label': 'Reminder time' });
      const remLbl = h('label.tasks-edit__lbl', icon('bell'), remChk, h('span', { text: 'Remind me at' }), remTime);
      const syncRem = () => {
        const has = !!dueInput.value;
        remChk.disabled = !has; remTime.disabled = !has || !remChk.checked;
        remLbl.title = has ? '' : 'Pick a due date first';
      };
      dueInput.addEventListener('input', syncRem);
      remChk.addEventListener('change', syncRem);
      syncRem();

      const save = () => saveEdit(t.id, textInput.value, dueInput.value, prioSel.value, remChk.checked && !remChk.disabled && remTime.value ? remTime.value : null);
      const cancel = () => { S.editingId = null; S.focusRow = t.id; render(); };

      const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
      textInput.addEventListener('keydown', onKey);
      dueInput.addEventListener('keydown', onKey);
      remTime.addEventListener('keydown', onKey);

      if (S.focusEdit) { S.focusEdit = false; queueMicrotask(() => { try { textInput.focus(); textInput.select(); } catch (e) {} }); }

      return h('div.tasks-row.tasks-row--edit', { dataset: { id: t.id } },
        h('div.tasks-edit',
          h('div.field.tasks-edit__field', textInput),
          h('div.tasks-edit__controls',
            h('label.tasks-edit__lbl', icon('calendar'), dueInput,
              t.due ? h('button.ibtn', { type: 'button', 'aria-label': 'Clear due date', onclick: () => { dueInput.value = ''; syncRem(); } }, icon('x')) : null),
            prioSel,
            remLbl,
            h('span.tasks-spacer'),
            h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: save }, icon('check'), h('span', { text: 'Save' })),
            h('button.btn.btn--sm', { type: 'button', onclick: cancel }, h('span', { text: 'Cancel' })))));
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
      if (S.narrow && S.mobilePane === 'list' && !activeList()) S.mobilePane = 'lists';
      appEl.classList.toggle('show-list', S.narrow && S.mobilePane === 'list');
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
      const id = btn.closest('.tasks-row').dataset.id;
      const row = locate(S.data, id);
      if (!row) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const all = [...mainEl.querySelectorAll('.tasks-text')];
        const n = all[all.indexOf(btn) + (k === 'ArrowDown' ? 1 : -1)];
        if (n) n.focus();
      } else if (k === 'x') { e.preventDefault(); S.focusRow = id; toggleDone(id); }
      else if (k === 'p') { e.preventDefault(); S.focusRow = id; cyclePriority(id); }
      else if (k === 's' && row.depth < MAX_DEPTH) { e.preventDefault(); S.subFor = id; S.focusSub = true; S.collapsed.delete(id); render(); }
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

    render();
    armMidnight();

    /* the To-dos widget on the desktop edits the same lists */
    const offOutside = store.sub(STORE_KEY, v => {
      if (S.dead || writing || v === mine) return;
      const active = S.data.activeId;
      S.data = normalize(v);
      if (S.data.lists.some(l => l.id === active)) S.data.activeId = active;
      if (S.editingId && !S.data.lists.some(l => l.tasks.some(t => t.id === S.editingId))) S.editingId = null;
      render();
    });

    /* ---------- teardown ---------- */
    return () => {
      offOutside();
      window.removeEventListener('keydown', onUndoKey);
      clearTimeout(midnight);
      S.dead = true;
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
    };
  },
});
