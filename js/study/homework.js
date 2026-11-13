/* ============================================================
   study/homework.js — the Homework tab of Static Study.

   Classes (each with a colour) and assignments (class, due date and
   optional time, notes, done). Three views of the same list: Today
   (overdue first, then what is due today), This week (the next seven
   days, day by day) and By class. Overdue work is marked in words and
   colour, not colour alone. An assignment can ask for a reminder; it
   goes to the reminders engine (js/core/homework.js), so it fires and
   shows its notification whether or not this window is open.
   ============================================================ */
import * as HW from '../core/homework.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const VIEWS = [['today', 'Today'], ['week', 'This week'], ['class', 'By class']];

function dayLabel(day, now) {
  const t = HW.today(now);
  if (day === t) return 'Today';
  if (day === HW.addDays(t, 1)) return 'Tomorrow';
  if (day === HW.addDays(t, -1)) return 'Yesterday';
  return HW.parseDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function mountHomework(host, ctx) {
  const { api, isActive } = ctx;
  const { h, icon, clear, confirm } = api;
  const S = { data: HW.read(), view: 'today', form: null, classes: false, cform: { name: '', color: HW.COLORS[0] }, note: '', dead: false, minute: Math.floor(Date.now() / 60000) };

  const clsOf = id => S.data.classes.find(c => c.id === id) || null;
  function save(next, okNote) {
    const res = HW.write(next);
    S.data = HW.read();
    return res;
  }
  const mutate = fn => { const d = HW.read(); fn(d); return save(d); };

  /* ---------- actions ---------- */
  function blankForm(day) {
    return { id: '', title: '', classId: S.data.classes[0] ? S.data.classes[0].id : '', due: day || HW.today(), time: '', notes: '', remind: null, issue: '' };
  }
  function submit() {
    const f = S.form;
    const title = f.title.trim();
    if (!title) { f.issue = 'Give the assignment a name.'; render(); return; }
    if (!HW.parseDay(f.due)) { f.issue = 'Pick a due date.'; render(); return; }
    const next = HW.read();
    const rec = { id: f.id || HW.uid('a'), classId: f.classId, title, due: f.due, time: f.time, notes: f.notes, remind: f.remind, done: false, doneAt: 0, created: Date.now() };
    const i = next.assignments.findIndex(a => a.id === f.id);
    if (i >= 0) { const old = next.assignments[i]; Object.assign(rec, { done: old.done, doneAt: old.doneAt, created: old.created }); next.assignments[i] = rec; }
    else if (next.assignments.length >= HW.MAX_ASSIGNMENTS) { f.issue = `You can keep up to ${HW.MAX_ASSIGNMENTS} assignments.`; render(); return; }
    else next.assignments.push(rec);
    const res = save(next);
    const r = res.reminders[rec.id];
    S.note = rec.remind === null ? `${i >= 0 ? 'Saved' : 'Added'} “${title}”.`
      : r === 'set' ? `${i >= 0 ? 'Saved' : 'Added'} “${title}”. Reminder set: ${HW.remindLabel(rec.remind).toLowerCase()}.`
        : r === 'passed' ? `${i >= 0 ? 'Saved' : 'Added'} “${title}”. That reminder time has already passed, so no reminder was set.`
          : `${i >= 0 ? 'Saved' : 'Added'} “${title}”. No reminder was set (too many reminders).`;
    S.form = null;
    render();
  }
  function toggleDone(id) {
    let nowDone = false;
    mutate(d => { const a = d.assignments.find(x => x.id === id); if (a) { a.done = !a.done; a.doneAt = a.done ? Date.now() : 0; nowDone = a.done; } });
    if (nowDone) api.bus.emit('homework:done', { id });
    S.note = '';
    render();
  }
  async function remove(id) {
    const a = S.data.assignments.find(x => x.id === id);
    if (!a) return;
    const ok = await confirm({ title: 'Delete this assignment?', message: `“${a.title}” and its reminder are removed. This can’t be undone.`, ok: 'Delete', danger: true });
    if (!ok || S.dead) return;
    mutate(d => { d.assignments = d.assignments.filter(x => x.id !== id); });
    if (S.form && S.form.id === id) S.form = null;
    S.note = '';
    render();
  }
  function edit(id) {
    const a = S.data.assignments.find(x => x.id === id);
    if (!a) return;
    S.form = { id: a.id, title: a.title, classId: a.classId, due: a.due, time: a.time, notes: a.notes, remind: a.remind, issue: '' };
    S.focusTitle = true;
    render();
  }
  function addClass() {
    const name = S.cform.name.trim();
    if (!name) { S.cform.issue = 'Give the class a name.'; render(); return; }
    if (S.data.classes.length >= HW.MAX_CLASSES) { S.cform.issue = `You can have up to ${HW.MAX_CLASSES} classes.`; render(); return; }
    mutate(d => d.classes.push(HW.normClass({ name, color: S.cform.color }, d.classes.length)));
    const nextColor = HW.COLORS.find(c => !S.data.classes.some(k => k.color === c)) || HW.COLORS[S.data.classes.length % HW.COLORS.length];
    S.cform = { name: '', color: nextColor };
    S.focusClass = true;
    render();
  }
  function recolor(id, color) { mutate(d => { const c = d.classes.find(x => x.id === id); if (c) c.color = color; }); render(); }
  function rename(id, name) { const nm = name.trim(); if (nm) mutate(d => { const c = d.classes.find(x => x.id === id); if (c) c.name = nm.slice(0, 40); }); render(); }
  async function removeClass(id) {
    const c = clsOf(id);
    if (!c) return;
    const n = S.data.assignments.filter(a => a.classId === id).length;
    const ok = await confirm({ title: 'Delete this class?', message: n ? `“${c.name}” is removed. Its ${plural(n, 'assignment')} stay, under “No class”.` : `“${c.name}” is removed.`, ok: 'Delete', danger: true });
    if (!ok || S.dead) return;
    mutate(d => { d.classes = d.classes.filter(x => x.id !== id); });
    render();
  }

  /* ---------- pieces ---------- */
  const root = h('div.st-hw');
  host.appendChild(root);

  function row(a, now, showClass = true) {
    const c = clsOf(a.classId);
    const st = HW.statusOf(a, now);
    return h('div.st-as', { role: 'listitem', class: `is-${st}`, dataset: { id: a.id, status: st }, style: { '--cc': c ? c.color : 'var(--ink-4)' } },
      h('button.st-check', { type: 'button', role: 'checkbox', class: a.done ? 'is-done' : '', 'aria-checked': a.done ? 'true' : 'false', 'aria-label': `${a.done ? 'Mark not done' : 'Mark done'}: ${a.title}`, dataset: { fk: 'done' }, onclick: () => toggleDone(a.id) }, a.done ? icon('check') : null),
      h('button.st-as__main', { type: 'button', 'aria-label': `Edit assignment: ${a.title}`, onclick: () => edit(a.id) },
        h('span.st-as__t', { text: a.title }),
        h('span.st-as__m',
          showClass ? h('span.st-cls', h('i.st-dot', { 'aria-hidden': 'true' }), h('span', { text: c ? c.name : 'No class' })) : null,
          h('span', { text: `Due ${HW.dueText(a)}` }),
          st === 'overdue' ? h('span.st-over', { dataset: { fk: 'overdue' } }, icon('alert'), h('span', { text: 'Overdue' })) : null,
          a.remind !== null && !a.done ? h('span.st-bell', { title: `Reminder: ${HW.remindLabel(a.remind).toLowerCase()}`, 'aria-label': `Reminder: ${HW.remindLabel(a.remind).toLowerCase()}` }, icon('bell')) : null),
        a.notes ? h('span.st-as__n', { text: a.notes }) : null),
      h('button.ibtn', { type: 'button', 'aria-label': `Delete assignment: ${a.title}`, onclick: () => remove(a.id) }, icon('trash')));
  }
  const group = (label, items, now, opts = {}) => h('section.st-grp', { 'aria-label': label, dataset: { group: opts.key || label } },
    h('div.side__label', h('span', { text: label }), opts.count === false ? null : h('small', { text: String(items.length) })),
    items.length ? h('div.st-aslist', { role: 'list' }, items.map(a => row(a, now, opts.cls !== false))) : h('p.st-none', { text: opts.empty || 'Nothing here.' }));

  function form() {
    const f = S.form;
    const title = h('input.st-in', { type: 'text', maxlength: '200', placeholder: 'Assignment (e.g. Read chapter 4)', 'aria-label': 'Assignment', dataset: { fk: 'a-title' }, oninput: e => { f.title = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } });
    title.value = f.title;
    if (S.focusTitle) { S.focusEl = title; S.focusTitle = false; }
    const sel = h('select.select.st-sel', { 'aria-label': 'Class', dataset: { fk: 'a-class' }, onchange: e => { f.classId = e.target.value; } },
      h('option', { value: '', text: 'No class', selected: !f.classId }), S.data.classes.map(c => h('option', { value: c.id, text: c.name, selected: c.id === f.classId })));
    const due = h('input.st-in', { type: 'date', value: f.due, 'aria-label': 'Due date', dataset: { fk: 'a-due' }, oninput: e => { f.due = e.target.value; } });
    const time = h('input.st-in', { type: 'time', value: f.time, 'aria-label': 'Due time (optional)', dataset: { fk: 'a-time' }, oninput: e => { f.time = e.target.value; } });
    const rem = h('select.select.st-sel', { 'aria-label': 'Reminder', dataset: { fk: 'a-remind' }, onchange: e => { f.remind = e.target.value === '' ? null : Number(e.target.value); hint.hidden = f.remind === null; } },
      HW.REMIND.map(([v, l]) => h('option', { value: v === null ? '' : String(v), text: l, selected: v === f.remind })));
    const hint = h('small.dim', { hidden: f.remind === null, text: 'Goes off as a notification while StaticOS is open in this browser. With no due time, it counts from 9:00 AM.' });
    const notes = h('textarea.st-ta', { rows: '2', maxlength: '2000', placeholder: 'Notes (optional)', 'aria-label': 'Notes', dataset: { fk: 'a-notes' }, oninput: e => { f.notes = e.target.value; } });
    notes.value = f.notes;
    const fld = (label, el) => h('label.st-f', h('span.st-f__l', { text: label }), el);
    return h('section.st-form', { 'aria-label': f.id ? 'Edit assignment' : 'New assignment' },
      fld('Assignment', title),
      h('div.st-form__grid', fld('Class', sel), fld('Due date', due), fld('Time (optional)', time), fld('Reminder', rem)),
      hint, fld('Notes', notes),
      f.issue ? h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: f.issue })) : null,
      h('div.st-row', h('span.st-spacer'),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'a-cancel' }, onclick: () => { S.form = null; render(); } }, h('span', { text: 'Cancel' })),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'a-save' }, onclick: submit }, icon('check'), h('span', { text: f.id ? 'Save' : 'Add assignment' }))));
  }

  function classPanel() {
    const nameIn = h('input.st-in', { type: 'text', maxlength: '40', placeholder: 'Class name (e.g. Biology)', 'aria-label': 'New class name', dataset: { fk: 'c-name' }, oninput: e => { S.cform.name = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addClass(); } } });
    nameIn.value = S.cform.name;
    if (S.focusClass) { S.focusEl = nameIn; S.focusClass = false; }
    const swatches = (cur, on, fk) => h('div.st-sw', { role: 'radiogroup', 'aria-label': 'Colour' }, HW.COLORS.map((col, i) =>
      h('button.st-sw__i', { type: 'button', role: 'radio', 'aria-checked': col === cur ? 'true' : 'false', 'aria-label': HW.COLOR_NAMES[i], title: HW.COLOR_NAMES[i], class: col === cur ? 'is-on' : '', style: { '--cc': col }, dataset: { fk: `${fk}-${i}` }, onclick: () => on(col) })));
    return h('section.st-form', { 'aria-label': 'Classes' },
      S.data.classes.length ? h('div.st-clist', { role: 'list' }, S.data.classes.map(c => h('div.st-crow', { role: 'listitem', dataset: { cls: c.id }, style: { '--cc': c.color } },
        h('i.st-dot', { 'aria-hidden': 'true' }),
        h('input.st-in', { type: 'text', value: c.name, maxlength: '40', 'aria-label': `Rename class ${c.name}`, onchange: e => rename(c.id, e.target.value) }),
        swatches(c.color, col => recolor(c.id, col), `c-${c.id}`),
        h('button.ibtn', { type: 'button', 'aria-label': `Delete class ${c.name}`, onclick: () => removeClass(c.id) }, icon('trash')))))
        : h('p.st-none', { text: 'No classes yet. Add one below.' }),
      h('div.st-crow.st-crow--new', h('i.st-dot', { style: { '--cc': S.cform.color }, 'aria-hidden': 'true' }), nameIn,
        swatches(S.cform.color, col => { S.cform.color = col; render(); }, 'cn'),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'c-add' }, onclick: addClass }, icon('plus'), h('span', { text: 'Add class' }))),
      S.cform.issue ? h('div.st-issue', { role: 'alert' }, icon('alert'), h('span', { text: S.cform.issue })) : null);
  }

  /* ---------- render ---------- */
  function render() {
    if (S.dead) return;
    S.focusEl = null;
    const now = Date.now();
    clear(root);
    const tabs = h('div.tabs.st-tabs', { role: 'tablist', 'aria-label': 'Homework views' }, VIEWS.map(([v, l]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': S.view === v ? 'true' : 'false', class: S.view === v ? 'is-on' : '', dataset: { view: v }, onclick: () => { S.view = v; render(); } }, h('span', { text: l }))));
    root.append(h('div.app__bar', tabs, h('span.st-spacer'),
      h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'classes' }, 'aria-expanded': S.classes ? 'true' : 'false', onclick: () => { S.classes = !S.classes; S.focusClass = S.classes; render(); } }, icon('folder'), h('span', { text: 'Classes' })),
      h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'new-assignment' }, onclick: () => { S.form = blankForm(); S.focusTitle = true; render(); } }, icon('plus'), h('span', { text: 'Add assignment' }))));
    const body = h('div.app__content.st-scroll');
    if (S.note) { body.append(h('div.st-flash', { role: 'status', dataset: { fk: 'note' } }, icon('check'), h('span', { text: S.note }))); S.note = ''; }
    if (S.classes) body.append(classPanel());
    if (S.form) body.append(form());
    const list = S.data.assignments;
    if (S.view === 'today') {
      const v = HW.viewToday(list, now);
      const open = v.overdue.length + v.today.length;
      body.append(h('p.st-sum', { dataset: { fk: 'today-sum' }, text: open ? `${plural(open, 'assignment')} to do${v.overdue.length ? `, ${v.overdue.length} overdue` : ''}.` : (list.length ? 'Nothing due today and nothing overdue.' : 'No assignments yet.') }));
      if (!list.length) body.append(h('div.empty', icon('clipboard'), h('b', { text: 'Add your first assignment' }), h('small', { text: 'Add your classes, then each assignment with its due date. Today, This week and By class show them back to you.' })));
      else {
        if (v.overdue.length) body.append(group('Overdue', v.overdue, now, { key: 'overdue' }));
        body.append(group('Due today', v.today, now, { key: 'today', empty: 'Nothing else is due today.' }));
        if (v.doneToday.length) body.append(group('Finished today', v.doneToday, now, { key: 'done-today' }));
      }
    } else if (S.view === 'week') {
      const days = HW.viewWeek(list, now);
      const n = days.reduce((s, d) => s + d.items.filter(a => !a.done).length, 0);
      body.append(h('p.st-sum', { dataset: { fk: 'week-sum' }, text: `${plural(n, 'assignment')} left in the next 7 days.` }));
      for (const d of days) body.append(group(dayLabel(d.day, now), d.items, now, { key: d.day, empty: 'Nothing due.', count: d.items.length > 0 }));
    } else {
      const groups = HW.viewByClass(S.data, now);
      if (!groups.length) body.append(h('div.empty', icon('folder'), h('b', { text: 'No classes yet' }), h('small', { text: 'Open Classes to add one.' })));
      for (const g of groups) {
        const left = g.items.filter(a => !a.done).length;
        body.append(h('section.st-grp', { 'aria-label': g.cls ? g.cls.name : 'No class', dataset: { group: g.cls ? g.cls.id : 'none' }, style: { '--cc': g.cls ? g.cls.color : 'var(--ink-4)' } },
          h('div.side__label.st-clshead', h('i.st-dot', { 'aria-hidden': 'true' }), h('span', { text: g.cls ? g.cls.name : 'No class' }), h('small', { text: `${left} to do` })),
          g.items.length ? h('div.st-aslist', { role: 'list' }, g.items.map(a => row(a, now, false))) : h('p.st-none', { text: 'No assignments in this class.' })));
      }
    }
    root.append(body);
    const el = S.focusEl;
    if (el) requestAnimationFrame(() => { try { if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return; /* never take the keyboard from a field already being typed in */ el.focus(); } catch (e) { /* fine */ } });
    ctx.changed && ctx.changed();
  }

  /* overdue turns on by itself as time passes */
  const off = api.bus.on('tick:5s', () => {
    const m = Math.floor(Date.now() / 60000);
    if (m === S.minute || S.form || S.classes) return;
    S.minute = m;
    S.data = HW.read();
    render();
  });
  render();

  return {
    teardown() { S.dead = true; off(); },
    open(o) {
      if (o && o.assignment && S.data.assignments.some(a => a.id === o.assignment)) { S.view = 'class'; edit(o.assignment); }
    },
  };
}
