/* ============================================================
   study/homework.js — the Homework tab of Static Study.

   Classes (each with a colour) and assignments (class, due date and
   optional time, notes, done). Three views of the same list: Today
   (overdue first, then what is due today), This week (the next seven
   days, day by day) and By class. Overdue work is marked in words and
   colour, not colour alone. An assignment can ask for a reminder; it
   goes to the reminders engine (js/core/homework.js), so it fires and
   shows its notification whether or not this window is open.

   An assignment can also repeat (each time its own assignment, the
   next made when one is done or its day is over), carry your time
   estimate (Today adds them up), a grade once it is back (a class's
   average can go to the GPA tab, only when you press Use in GPA), and
   links to a note or a Board card. Send to Tasks copies it into a
   Static Tasks list called Homework; Focus starts Clock's focus timer
   on its class, so the minutes count for that subject. Finished
   classes can be archived, and the late hand-ins this term counted.
   ============================================================ */
import * as HW from '../core/homework.js';
import * as FOCUS from '../core/focus.js';
import * as GP from '../core/gpa.js';

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
  const S = { data: HW.read(), view: 'today', form: null, classes: false, cform: { name: '', color: HW.COLORS[0] }, note: '', dead: false, minute: Math.floor(Date.now() / 60000), tasks: new Set() };

  const clsOf = id => S.data.classes.find(c => c.id === id) || null;
  const liveClasses = () => S.data.classes.filter(c => !c.archived);
  /* what can be linked: Notes' notes and Board's cards, read where they live */
  function linkables() {
    const notes = (() => { const v = api.store.get('notes'); return Array.isArray(v) ? v.filter(n => n && typeof n === 'object' && n.id && !n.trashed) : []; })()
      .sort((a, z) => String(z.mtime || '').localeCompare(String(a.mtime || ''))).slice(0, 100)
      .map(n => ({ kind: 'note', ref: String(n.id), title: String(n.title || '').trim().slice(0, 80) || 'Untitled note' }));
    const cards = [];
    const b = api.store.get('portal.board');
    for (const bd of b && Array.isArray(b.boards) ? b.boards : []) for (const col of Array.isArray(bd && bd.cols) ? bd.cols : []) for (const c of Array.isArray(col && col.cards) ? col.cards : []) {
      if (c && c.id && c.title && cards.length < 200) cards.push({ kind: 'card', ref: String(c.id), title: String(c.title).trim().slice(0, 80), sub: `${String(bd.name || 'Board').slice(0, 30)} · ${String(col.name || '').slice(0, 20)}` });
    }
    return { notes, cards };
  }
  function openLink(l) {
    const { notes, cards } = linkables();
    if (l.kind === 'note') {
      if (!notes.some(n => n.ref === l.ref)) { S.note = `“${l.title || 'That note'}” isn’t in Notes any more.`; render(); return; }
      api.openApp('notes', { noteId: l.ref });
    } else {
      if (!cards.some(c => c.ref === l.ref)) { S.note = `“${l.title || 'That card'}” isn’t on a Board any more.`; render(); return; }
      api.openApp('board', { card: l.ref });
    }
  }
  async function sendToTasks(id) {
    const a = S.data.assignments.find(x => x.id === id);
    if (!a) return;
    const T = await import('../core/tasks.js');
    if (S.dead) return;
    if (a.taskId && T.locate(T.read(), a.taskId)) { api.openApp('tasks', { task: a.taskId }); return; }
    const c = clsOf(a.classId);
    const d = T.read();
    let list = d.lists.find(l => l.name === 'Homework');
    if (!list) { list = T.normList({ name: 'Homework', icon: 'clipboard', color: c && T.LIST_COLORS.includes(c.color) ? c.color : '' }); d.lists.push(list); }
    const task = T.normTask({ text: c ? `${c.name}: ${a.title}` : a.title, due: a.due, notes: [a.notes, a.est ? `About ${HW.minText(a.est)} (your estimate).` : '', 'From Static Study › Homework.'].filter(Boolean).join('\n') });
    list.tasks.push(task);
    T.write(d);
    mutate(x => { const y = x.assignments.find(z => z.id === id); if (y) y.taskId = task.id; });
    S.note = `Sent “${a.title}” to the Homework list in Static Tasks, due ${HW.dueText(a)}. Ticking it there doesn’t tick it here.`;
    render();
  }
  function focusOn(a) {
    const c = clsOf(a.classId);
    const what = c ? c.name : a.title;
    const st = FOCUS.startOn(what);
    S.note = `Focusing on ${what}: ${Math.ceil(st.left / 60000)} minutes on Clock’s focus timer. The minutes count for ${what} when it runs to the end.`;
    render();
  }
  function useInGpa(cls) {
    const av = HW.classAverage(S.data, cls.id);
    if (av.avg === null) return;
    const g = GP.read();
    const sem = g.semesters.find(x => x.id === g.activeId);
    if (!sem) { S.note = 'Add a semester in the GPA tab first: the average goes into its course list.'; render(); return; }
    let c = sem.courses.find(x => x.name.trim().toLowerCase() === cls.name.trim().toLowerCase());
    const grade = String(av.avg);
    if (!c) {
      if (sem.courses.length >= GP.MAX_COURSES) { S.note = `“${sem.name}” already has ${GP.MAX_COURSES} courses.`; render(); return; }
      c = GP.normCourse({ name: cls.name, grade });
      sem.courses.push(c);
    } else c.grade = grade;
    GP.write(g);
    S.note = `${cls.name}: ${av.avg}% (the average of ${av.n} grade${av.n === 1 ? '' : 's'}) is now its grade in ${sem.name} on the GPA tab.${GP.creditsOf(c) === null ? ' Give it credits there so it counts.' : ''}`;
    render();
  }
  function save(next, okNote) {
    const res = HW.write(next);
    S.data = HW.read();
    return res;
  }
  const mutate = fn => { const d = HW.read(); fn(d); return save(d); };

  /* ---------- actions ---------- */
  function blankForm(day) {
    const first = liveClasses()[0];
    return { id: '', title: '', classId: first ? first.id : '', due: day || HW.today(), time: '', notes: '', remind: null, repeat: 'none', est: '', grade: '', links: [], issue: '' };
  }
  function submit() {
    const f = S.form;
    const title = f.title.trim();
    if (!title) { f.issue = 'Give the assignment a name.'; render(); return; }
    if (!HW.parseDay(f.due)) { f.issue = 'Pick a due date.'; render(); return; }
    const est = String(f.est).trim() === '' ? 0 : Number(f.est);
    if (!Number.isInteger(est) || est < 0 || est > HW.MAX_EST) { f.issue = `The estimate is whole minutes, 1 to ${HW.MAX_EST}, or empty.`; render(); return; }
    const next = HW.read();
    const rec = { id: f.id || HW.uid('a'), classId: f.classId, title, due: f.due, time: f.time, notes: f.notes, remind: f.remind, done: false, doneAt: 0, created: Date.now(),
      repeat: f.repeat, series: '', est, grade: f.grade, links: f.links, taskId: '' };
    const i = next.assignments.findIndex(a => a.id === f.id);
    if (i >= 0) { const old = next.assignments[i]; Object.assign(rec, { done: old.done, doneAt: old.doneAt, created: old.created, series: old.series, taskId: old.taskId }); next.assignments[i] = rec; }
    else if (next.assignments.length >= HW.MAX_ASSIGNMENTS) { f.issue = `You can keep up to ${HW.MAX_ASSIGNMENTS} assignments.`; render(); return; }
    else next.assignments.push(rec);
    if (rec.repeat !== 'none' && !rec.series) rec.series = rec.id;
    const res = save(next);
    const r = res.reminders[rec.id];
    S.note = rec.remind === null ? `${i >= 0 ? 'Saved' : 'Added'} “${title}”.`
      : r === 'set' ? `${i >= 0 ? 'Saved' : 'Added'} “${title}”. Reminder set: ${HW.remindLabel(rec.remind).toLowerCase()}.`
        : r === 'passed' ? `${i >= 0 ? 'Saved' : 'Added'} “${title}”. That reminder time has already passed, so no reminder was set.`
          : `${i >= 0 ? 'Saved' : 'Added'} “${title}”. No reminder was set (too many reminders).`;
    if (rec.repeat !== 'none') S.note += ` It repeats ${HW.REPEATS.find(([v]) => v === rec.repeat)[1].toLowerCase()}: the next one appears when this one is done or its day is over.`;
    S.form = null;
    render();
  }
  function toggleDone(id) {
    let nowDone = false;
    const res = mutate(d => { const a = d.assignments.find(x => x.id === id); if (a) { a.done = !a.done; a.doneAt = a.done ? Date.now() : 0; nowDone = a.done; } });
    if (nowDone) api.bus.emit('homework:done', { id });
    S.note = '';
    if (res.made) {
      const a = S.data.assignments.find(x => x.id === id);
      const nx = a && S.data.assignments.filter(x => x.series === a.series && x.series && !x.done).sort((x, y) => x.due.localeCompare(y.due)).pop();
      if (nx) S.note = `Done. The next “${nx.title}” is due ${HW.dueText(nx)}.`;
    }
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
    S.form = { id: a.id, title: a.title, classId: a.classId, due: a.due, time: a.time, notes: a.notes, remind: a.remind, repeat: a.repeat, est: a.est ? String(a.est) : '', grade: a.grade, links: a.links.map(l => ({ ...l })), issue: '' };
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
  function archiveClass(id, on) {
    const c = clsOf(id);
    if (!c) return;
    mutate(d => { const k = d.classes.find(x => x.id === id); if (k) { if (on) k.archived = true; else delete k.archived; } });
    const n = S.data.assignments.filter(a => a.classId === id && !a.done).length;
    S.note = on ? `Archived “${c.name}”. Its work is out of Today, This week and By class${n ? `, and the reminders of its ${plural(n, 'open assignment')} are off` : ''}. Restore it from Classes.` : `Restored “${c.name}”.`;
    render();
  }
  /* the redraw takes the field away, which can send its change again: only a real change redraws */
  function setTerm(day) { const v = HW.parseDay(day) ? day : ''; if (v === S.data.termStart) return; mutate(d => { d.termStart = v; }); render(); }

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
          a.done && a.doneAt && a.doneAt > HW.dueAt(a) ? h('span.st-late', { dataset: { fk: 'late-tag' }, text: 'Handed in late' }) : null,
          a.remind !== null && !a.done ? h('span.st-bell', { title: `Reminder: ${HW.remindLabel(a.remind).toLowerCase()}`, 'aria-label': `Reminder: ${HW.remindLabel(a.remind).toLowerCase()}` }, icon('bell')) : null,
          a.repeat !== 'none' ? h('span.st-rep', { dataset: { fk: 'repeat-tag' }, title: 'Repeats', text: `↻ ${HW.REPEATS.find(([v]) => v === a.repeat)[1]}` }) : null,
          a.est ? h('span', { dataset: { fk: 'est' }, text: `~${HW.minText(a.est)}` }) : null,
          a.grade ? h('span.st-grade', { dataset: { fk: 'grade' }, text: `Grade: ${a.grade}` }) : null,
          a.taskId && S.tasks.has(a.taskId) ? h('span.st-rep', { text: 'In Tasks' }) : null),
        a.notes ? h('span.st-as__n', { text: a.notes }) : null),
      a.links.length ? h('span.st-links', a.links.map(l => h('button.st-chip', { type: 'button', dataset: { fk: 'link' }, title: l.kind === 'note' ? 'Open in Notes' : 'Open in Board', onclick: () => openLink(l) }, icon(l.kind === 'note' ? 'note' : 'clipboard'), h('span', { text: l.title || (l.kind === 'note' ? 'Note' : 'Card') })))) : null,
      h('button.ibtn', { type: 'button', 'aria-label': `More for: ${a.title}`, 'aria-haspopup': 'menu', dataset: { fk: 'a-more' }, onclick: e => api.menu([
        { label: `Focus on ${c ? c.name : 'this'}`, icon: 'clock', disabled: a.done, onClick: () => focusOn(a) },
        { label: a.taskId && S.tasks.has(a.taskId) ? 'Open in Tasks' : 'Send to Tasks', icon: 'check-circle', disabled: !api.getApp('tasks'), onClick: () => sendToTasks(a.id) },
        { label: 'Edit', icon: 'edit-3', onClick: () => edit(a.id) }], e.clientX, e.clientY) }, icon('more-horizontal')),
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
      h('option', { value: '', text: 'No class', selected: !f.classId }), S.data.classes.filter(c => !c.archived || c.id === f.classId).map(c => h('option', { value: c.id, text: c.archived ? `${c.name} (archived)` : c.name, selected: c.id === f.classId })));
    const due = h('input.st-in', { type: 'date', value: f.due, 'aria-label': 'Due date', dataset: { fk: 'a-due' }, oninput: e => { f.due = e.target.value; } });
    const time = h('input.st-in', { type: 'time', value: f.time, 'aria-label': 'Due time (optional)', dataset: { fk: 'a-time' }, oninput: e => { f.time = e.target.value; } });
    const rem = h('select.select.st-sel', { 'aria-label': 'Reminder', dataset: { fk: 'a-remind' }, onchange: e => { f.remind = e.target.value === '' ? null : Number(e.target.value); hint.hidden = f.remind === null; } },
      HW.REMIND.map(([v, l]) => h('option', { value: v === null ? '' : String(v), text: l, selected: v === f.remind })));
    const hint = h('small.dim', { hidden: f.remind === null, text: 'Goes off as a notification while StaticOS is open in this browser. With no due time, it counts from 9:00 AM.' });
    const notes = h('textarea.st-ta', { rows: '2', maxlength: '2000', placeholder: 'Notes (optional)', 'aria-label': 'Notes', dataset: { fk: 'a-notes' }, oninput: e => { f.notes = e.target.value; } });
    notes.value = f.notes;
    const rep = h('select.select.st-sel', { 'aria-label': 'Repeat', dataset: { fk: 'a-repeat' }, onchange: e => { f.repeat = e.target.value; } },
      HW.REPEATS.map(([v, l]) => h('option', { value: v, text: l, selected: v === f.repeat })));
    const est = h('input.st-in', { type: 'text', inputmode: 'numeric', maxlength: '3', placeholder: 'optional', 'aria-label': 'Your time estimate in minutes', dataset: { fk: 'a-est' }, oninput: e => { f.est = e.target.value; } });
    est.value = f.est;
    const grade = h('input.st-in', { type: 'text', maxlength: '12', placeholder: '92%, 18/20 or B+', 'aria-label': 'Grade', dataset: { fk: 'a-grade' }, oninput: e => { f.grade = e.target.value; } });
    grade.value = f.grade;
    /* attach a note or a Board card */
    const L = linkables();
    const taken = l => f.links.some(x => x.kind === l.kind && x.ref === l.ref);
    const attach = h('select.select.st-sel', { 'aria-label': 'Attach a note or a Board card', dataset: { fk: 'a-attach' }, disabled: f.links.length >= HW.MAX_LINKS || (!L.notes.length && !L.cards.length),
      onchange: e => {
        const [kind, ref] = e.target.value.split('|');
        const hit = [...L.notes, ...L.cards].find(x => x.kind === kind && x.ref === ref);
        if (hit && !taken(hit) && f.links.length < HW.MAX_LINKS) f.links.push({ kind: hit.kind, ref: hit.ref, title: hit.title });
        render();
      } },
    h('option', { value: '', text: L.notes.length || L.cards.length ? (f.links.length >= HW.MAX_LINKS ? `Up to ${HW.MAX_LINKS} links` : 'Attach…') : 'No notes or Board cards yet' }),
    L.notes.length ? h('optgroup', { label: 'Notes' }, L.notes.filter(l => !taken(l)).map(l => h('option', { value: `note|${l.ref}`, text: l.title }))) : null,
    L.cards.length ? h('optgroup', { label: 'Board cards' }, L.cards.filter(l => !taken(l)).map(l => h('option', { value: `card|${l.ref}`, text: `${l.title} (${l.sub})` }))) : null);
    const fld = (label, el) => h('label.st-f', h('span.st-f__l', { text: label }), el);
    return h('section.st-form', { 'aria-label': f.id ? 'Edit assignment' : 'New assignment' },
      fld('Assignment', title),
      h('div.st-form__grid', fld('Class', sel), fld('Due date', due), fld('Time (optional)', time), fld('Reminder', rem)),
      hint,
      h('div.st-form__grid', fld('Repeats', rep), fld('Your estimate (minutes)', est), fld('Grade (when it’s back)', grade), fld('Attach', attach)),
      f.links.length ? h('div.st-row.st-links', { dataset: { fk: 'a-links' } }, f.links.map((l, i) => h('span.st-chip', icon(l.kind === 'note' ? 'note' : 'clipboard'), h('span', { text: l.title }),
        h('button.ibtn', { type: 'button', 'aria-label': `Remove link: ${l.title}`, onclick: () => { f.links.splice(i, 1); render(); } }, icon('x'))))) : null,
      fld('Notes', notes),
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
    const live = liveClasses(), gone = S.data.classes.filter(c => c.archived);
    const spans = (() => { try { const v = api.store.get('portal.calendar'); return v && Array.isArray(v.spans) ? v.spans : []; } catch (e) { return []; } })();
    const t = HW.today();
    const term = spans.find(x => x && x.start <= t && x.end >= t && /term|semester|quarter|trimester/i.test(String(x.title || '')));
    return h('section.st-form', { 'aria-label': 'Classes' },
      live.length ? h('div.st-clist', { role: 'list' }, live.map(c => h('div.st-crow', { role: 'listitem', dataset: { cls: c.id }, style: { '--cc': c.color } },
        h('i.st-dot', { 'aria-hidden': 'true' }),
        h('input.st-in', { type: 'text', value: c.name, maxlength: '40', 'aria-label': `Rename class ${c.name}`, onchange: e => rename(c.id, e.target.value) }),
        swatches(c.color, col => recolor(c.id, col), `c-${c.id}`),
        h('button.btn.btn--sm', { type: 'button', 'aria-label': `Archive class ${c.name}`, title: 'The class is over: take its work out of the lists and reminders', dataset: { fk: 'c-archive' }, onclick: () => archiveClass(c.id, true) }, icon('box'), h('span', { text: 'Archive' })),
        h('button.ibtn', { type: 'button', 'aria-label': `Delete class ${c.name}`, onclick: () => removeClass(c.id) }, icon('trash')))))
        : h('p.st-none', { text: gone.length ? 'Every class is archived. Add one below.' : 'No classes yet. Add one below.' }),
      gone.length ? h('details.st-how', { dataset: { fk: 'archived' }, open: S.showArchived || undefined, ontoggle: e => { S.showArchived = e.target.open; } }, h('summary', { text: `Archived classes (${gone.length})` }),
        h('div.st-clist', { role: 'list' }, gone.map(c => h('div.st-crow', { role: 'listitem', dataset: { cls: c.id }, style: { '--cc': c.color } },
          h('i.st-dot', { 'aria-hidden': 'true' }), h('span.st-crow__n', { text: c.name }),
          h('small.dim', { text: plural(S.data.assignments.filter(a => a.classId === c.id).length, 'assignment') }),
          h('button.btn.btn--sm', { type: 'button', 'aria-label': `Restore class ${c.name}`, dataset: { fk: 'c-restore' }, onclick: () => archiveClass(c.id, false) }, icon('rotate-ccw'), h('span', { text: 'Restore' })))))) : null,
      h('div.st-row.st-term', h('label.st-inline', h('span', { text: 'This term started on' }),
        h('input.st-in', { type: 'date', value: S.data.termStart, 'aria-label': 'This term started on', dataset: { fk: 'term-start' }, onchange: e => setTerm(e.target.value) })),
        term && term.start !== S.data.termStart ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'term-cal' }, onclick: () => setTerm(term.start) }, h('span', { text: `Use “${String(term.title).slice(0, 30)}” from Calendar (${term.start})` })) : null,
        h('small.dim', { text: 'Late hand-ins are counted from this day.' })),
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
    S.tasks = new Set();
    if (S.data.assignments.some(a => a.taskId)) { try { const v = api.store.get('portal.tasks'); const walk = arr => { for (const t of arr || []) { if (t && t.id) S.tasks.add(t.id); walk(t && t.subs); } }; for (const l of v && Array.isArray(v.lists) ? v.lists : []) walk(l.tasks); } catch (e) { /* no Tasks */ } }
    const tabs = h('div.tabs.st-tabs', { role: 'tablist', 'aria-label': 'Homework views' }, VIEWS.map(([v, l]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': S.view === v ? 'true' : 'false', class: S.view === v ? 'is-on' : '', dataset: { view: v }, onclick: () => { S.view = v; render(); } }, h('span', { text: l }))));
    root.append(h('div.app__bar', tabs, h('span.st-spacer'),
      h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'classes' }, 'aria-expanded': S.classes ? 'true' : 'false', onclick: () => { S.classes = !S.classes; S.focusClass = S.classes; render(); } }, icon('folder'), h('span', { text: 'Classes' })),
      h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'new-assignment' }, onclick: () => { S.form = blankForm(); S.focusTitle = true; render(); } }, icon('plus'), h('span', { text: 'Add assignment' }))));
    const body = h('div.app__content.st-scroll');
    if (S.note) { body.append(h('div.st-flash', { role: 'status', dataset: { fk: 'note' } }, icon('check'), h('span', { text: S.note }))); S.note = ''; }
    if (S.classes) body.append(classPanel());
    if (S.form) body.append(form());
    const list = HW.activeList(S.data);
    if (S.view === 'today') {
      const v = HW.viewToday(list, now);
      const open = v.overdue.length + v.today.length;
      body.append(h('p.st-sum', { dataset: { fk: 'today-sum' }, text: open ? `${plural(open, 'assignment')} to do${v.overdue.length ? `, ${v.overdue.length} overdue` : ''}.` : (list.length ? 'Nothing due today and nothing overdue.' : 'No assignments yet.') }));
      const est = HW.estimateToday(list, now);
      if (open && (est.with || est.without)) body.append(h('small.dim', { dataset: { fk: 'today-est' }, text: est.with ? `About ${HW.minText(est.min)} of work today, by your estimates${est.without ? `; ${plural(est.without, 'assignment')} without one` : ''}.` : 'Add a time estimate to an assignment and Today adds them up.' }));
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
      const late = HW.lateCount(S.data, now);
      if (list.length) body.append(h('p.st-sum.st-latesum', { dataset: { fk: 'late' } }, h('span', { text: `${late.from ? `This term (since ${HW.parseDay(late.from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})` : 'So far'}: ${plural(late.late, 'hand-in')} late${late.open ? `, ${late.open} overdue and not handed in` : ''}.` }),
        late.from ? null : h('small.dim', { text: ' Set the day this term started in Classes to count from there.' })));
      if (!groups.length) body.append(h('div.empty', icon('folder'), h('b', { text: 'No classes yet' }), h('small', { text: 'Open Classes to add one.' })));
      for (const g of groups) {
        const left = g.items.filter(a => !a.done).length;
        const av = g.cls ? HW.classAverage(S.data, g.cls.id) : null;
        body.append(h('section.st-grp', { 'aria-label': g.cls ? g.cls.name : 'No class', dataset: { group: g.cls ? g.cls.id : 'none' }, style: { '--cc': g.cls ? g.cls.color : 'var(--ink-4)' } },
          h('div.side__label.st-clshead', h('i.st-dot', { 'aria-hidden': 'true' }), h('span', { text: g.cls ? g.cls.name : 'No class' }), h('small', { text: `${left} to do` }),
            av && av.n ? h('small.st-avg', { dataset: { fk: 'avg' }, text: `Average ${av.avg}% (${plural(av.n, 'grade')}${av.other ? `; ${av.other} not a number, left out` : ''})` }) : null,
            av && av.n ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'to-gpa' }, title: 'Put this average in as the class’s grade on the GPA tab', onclick: () => useInGpa(g.cls) }, icon('calculator'), h('span', { text: 'Use in GPA' })) : null),
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
