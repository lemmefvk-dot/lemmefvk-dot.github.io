/* ============================================================
   study/timetable.js — the Timetable tab of Static Study (#213).

   Your class week as a grid: subject, room, day, start and end. A
   class can be added to several days at once. Optional A/B weeks:
   switch it on, say which one this week is, and mark a class as an A
   week or a B week class. The desktop's "Now and next" widget reads
   the same timetable (js/shell/deskwidgets.more.js).

   Why Static Study: the Homework tab already knows your classes
   (name and colour), so a timetable subject picks up the colour of a
   class with the same name, and the tab is where a student plans the
   week. The rules, saved data and "what is on now" are in
   js/core/timetable.js. Times follow the 12/24-hour setting.
   Calendar does not show these classes (it edits events by id in many
   places, and a class isn't an event) — the widget is where "now and
   next" lives.
   ============================================================ */
import * as TT from '../core/timetable.js';
import * as HW from '../core/homework.js';
import * as CAL from '../core/calendar.js';

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function mountTimetable(host, ctx) {
  const { api } = ctx;
  const { h, icon, clear, confirm, store } = api;
  const S = { data: TT.read(), form: null, note: '', dead: false, focusEl: null };
  const root = h('div.st-tt');
  host.appendChild(root);
  const refresh = () => { S.data = TT.read(); };
  const save = data => { TT.write(data); refresh(); };
  const classes = () => HW.read().classes;

  const blank = () => ({ id: '', subject: '', room: '', days: [1], day: 1, start: '09:00', end: '09:50', week: 'both', issues: [] });
  function edit(c) { S.form = { id: c.id, subject: c.subject, room: c.room, days: [c.day], day: c.day, start: c.start, end: c.end, week: c.week, issues: [] }; S.focusSubject = true; render(); }

  function submit() {
    const f = S.form;
    if (f.id) f.days = [Number(f.day)];
    const probs = TT.issues(f);
    if (probs.length) { f.issues = probs; render(); return; }
    const d = TT.read();
    if (f.id) {
      const rec = TT.normClass({ id: f.id, subject: f.subject, room: f.room, day: Number(f.day), start: f.start, end: f.end, week: f.week });
      d.classes = d.classes.map(c => (c.id === f.id ? rec : c));
    } else {
      if (d.classes.length + f.days.length > TT.MAX_CLASSES) { f.issues = [{ at: 'subject', text: `The timetable holds up to ${TT.MAX_CLASSES} classes.` }]; render(); return; }
      for (const day of f.days) d.classes.push(TT.normClass({ subject: f.subject, room: f.room, day, start: f.start, end: f.end, week: f.week }));
    }
    save(d);
    S.note = f.id ? `Saved ${f.subject.trim()}.` : `Added ${f.subject.trim()} on ${f.days.slice().sort((a, b) => TT.WEEK_ORDER.indexOf(a) - TT.WEEK_ORDER.indexOf(b)).map(x => SHORT[x]).join(', ')}.`;
    S.form = null;
    render();
  }
  async function remove(id) {
    const c = S.data.classes.find(x => x.id === id);
    if (!c) return;
    const ok = await confirm({ title: `Remove ${c.subject} on ${TT.DAYS[c.day]}?`, message: 'It is taken off your timetable. Other days of the same subject stay.', ok: 'Remove', danger: true });
    if (!ok || S.dead) return;
    const d = TT.read();
    d.classes = d.classes.filter(x => x.id !== id);
    save(d);
    S.form = null;
    S.note = `Removed ${c.subject} on ${TT.DAYS[c.day]}.`;
    render();
  }
  function setRotation(patch) {
    let d = TT.read();
    d = { ...d, rotate: { ...d.rotate, ...patch } };
    if (patch.thisWeek) d = TT.setThisWeek(d, patch.thisWeek);
    else if (patch.on === true && !TT.read().rotate.on) d = TT.setThisWeek(d, 'A');   /* switched on: this week is A until you say otherwise */
    save(d);
    render();
  }

  function card(c, thisWeek) {
    const off = S.data.rotate.on && c.week !== 'both' && c.week !== thisWeek;
    return h('button.st-cls-card', { type: 'button', class: off ? 'is-off' : '', style: { '--cc': TT.colorFor(c.subject, classes()), opacity: off ? '.55' : null }, dataset: { id: c.id, day: String(c.day) },
      'aria-label': `${c.subject}, ${TT.DAYS[c.day]} ${CAL.clockText(c.start)} to ${CAL.clockText(c.end)}${c.room ? `, room ${c.room}` : ''}${c.week !== 'both' ? `, ${c.week} weeks` : ''}${off ? ', not this week' : ''}. Edit`,
      onclick: () => edit(c) },
    h('b', { text: c.subject }),
    h('small', { dataset: { fk: 'tt-time' }, text: `${CAL.clockText(c.start)} – ${CAL.clockText(c.end)}` }),
    c.room ? h('small', { text: c.room }) : null,
    c.week !== 'both' ? h('small.st-badge.st-ab', { text: `${c.week} weeks${off ? ' · not this week' : ''}` }) : null);
  }

  function form() {
    const f = S.form;
    const fld = (label, el) => h('label.st-f', h('span.st-f__l', { text: label }), el);
    const subject = h('input.st-in', { type: 'text', maxlength: '60', list: 'st-tt-subjects', placeholder: 'e.g. Maths', 'aria-label': 'Subject', dataset: { fk: 'tf-subject' }, oninput: e => { f.subject = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } });
    subject.value = f.subject;
    if (S.focusSubject) { S.focusEl = subject; S.focusSubject = false; }
    const names = h('datalist', { id: 'st-tt-subjects' }, classes().map(c => h('option', { value: c.name })));
    const room = h('input.st-in', { type: 'text', maxlength: '30', placeholder: 'Room (optional)', 'aria-label': 'Room', dataset: { fk: 'tf-room' }, oninput: e => { f.room = e.target.value; } });
    room.value = f.room;
    const start = h('input.st-in', { type: 'time', 'aria-label': 'Starts', dataset: { fk: 'tf-start' }, oninput: e => { f.start = e.target.value; } });
    start.value = f.start;
    const end = h('input.st-in', { type: 'time', 'aria-label': 'Ends', dataset: { fk: 'tf-end' }, oninput: e => { f.end = e.target.value; } });
    end.value = f.end;
    const days = f.id
      ? fld('Day', h('select.select.st-sel', { 'aria-label': 'Day', dataset: { fk: 'tf-day' }, onchange: e => { f.day = Number(e.target.value); } }, TT.WEEK_ORDER.map(d => h('option', { value: String(d), text: TT.DAYS[d], selected: d === f.day }))))
      : h('fieldset.st-f', { style: { border: '0', padding: '0', margin: '0' } }, h('legend.st-f__l', { text: 'Days' }),
        h('div.st-days', TT.WEEK_ORDER.map(d => h('label', h('input', { type: 'checkbox', checked: f.days.includes(d), dataset: { fk: `tf-d${d}` }, 'aria-label': TT.DAYS[d],
          onchange: e => { f.days = e.target.checked ? [...new Set([...f.days, d])] : f.days.filter(x => x !== d); } }), h('span', { text: SHORT[d] })))));
    const week = S.data.rotate.on ? fld('Which weeks', h('select.select.st-sel', { 'aria-label': 'Which weeks', dataset: { fk: 'tf-week' }, onchange: e => { f.week = e.target.value; } },
      [['both', 'Every week'], ['A', 'A weeks only'], ['B', 'B weeks only']].map(([v, l]) => h('option', { value: v, text: l, selected: v === f.week })))) : null;
    return h('section.st-form', { 'aria-label': f.id ? 'Edit class' : 'Add a class' },
      fld('Subject', subject), names, fld('Room', room), fld('Starts', start), fld('Ends', end), days, week,
      (f.issues || []).length ? h('div.st-wide', f.issues.map(i => h('p.st-issue', { role: 'alert', dataset: { fk: 'tf-issue' } }, icon('alert'), h('span', { text: ` ${i.text}` })))) : null,
      h('div.st-row.st-wide',
        f.id ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'tf-delete' }, onclick: () => remove(f.id) }, icon('trash'), h('span', { text: 'Remove' })) : null,
        h('span.st-spacer'),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'tf-cancel' }, onclick: () => { S.form = null; render(); } }, 'Cancel'),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'tf-save' }, onclick: submit }, icon('check'), h('span', { text: f.id ? 'Save' : 'Add class' }))));
  }

  function render() {
    if (S.dead) return;
    S.focusEl = null;
    clear(root);
    const d = S.data;
    const todayKey = TT.ymd(new Date());
    const thisWeek = TT.weekOf(todayKey, d);
    const rot = d.rotate;
    const on = h('input', { type: 'checkbox', checked: rot.on, dataset: { fk: 'tt-rotate' }, 'aria-label': 'Alternate A and B weeks', onchange: e => setRotation({ on: e.target.checked }) });
    const which = h('select.select.st-sel', { 'aria-label': 'This week is', hidden: !rot.on, dataset: { fk: 'tt-thisweek' }, onchange: e => setRotation({ thisWeek: e.target.value }) },
      h('option', { value: 'A', text: 'This week is A', selected: thisWeek === 'A' }), h('option', { value: 'B', text: 'This week is B', selected: thisWeek === 'B' }));
    root.append(h('div.st-tt__head',
      h('label.st-row', on, h('span', { text: 'Alternate A and B weeks' })), which,
      h('span.st-spacer'),
      h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'tt-add' }, onclick: () => { S.form = blank(); S.focusSubject = true; render(); } }, icon('plus'), h('span', { text: 'Add a class' }))));
    const body = h('div.st-tt__scroll');
    if (S.note) { body.append(h('div.st-flash', { role: 'status', dataset: { fk: 'tt-note' } }, icon('check'), h('span', { text: S.note }))); S.note = ''; }
    if (S.form) body.append(form());
    if (!d.classes.length) body.append(h('div.empty', icon('calendar'), h('b', { text: 'Your timetable is empty' }), h('small', { text: 'Add each class with its day and times. Add the “Now and next” widget from the desktop’s Add Widget menu to see what is on and what comes next.' })));
    else {
      const shown = TT.WEEK_ORDER.filter(x => (x >= 1 && x <= 5) || d.classes.some(c => c.day === x));
      const grid = h('div.st-tt__grid', { style: { '--tt-cols': String(shown.length) }, role: 'list', 'aria-label': 'Weekly timetable', dataset: { fk: 'tt-grid' } });
      const todayDow = new Date().getDay();
      for (const day of shown) {
        const list = d.classes.filter(c => c.day === day).sort((a, b) => a.start.localeCompare(b.start) || a.subject.localeCompare(b.subject));
        grid.append(h('div.st-tt__day', { role: 'listitem', class: day === todayDow ? 'is-today' : '', dataset: { day: String(day) } },
          h('b', { text: day === todayDow ? `${TT.DAYS[day]} (today)` : TT.DAYS[day] }),
          list.length ? list.map(c => card(c, thisWeek)) : h('small.dim', { text: 'No classes' })));
      }
      body.append(grid);
    }
    root.append(body);
    const el = S.focusEl;
    if (el) requestAnimationFrame(() => { try { if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return; el.focus(); } catch (e) { /* fine */ } });
  }
  render();
  const offH24 = store.sub('prefs.h24', () => { if (!S.dead) render(); });
  const offTT = store.sub(TT.KEY, () => { if (!S.dead && !S.form) { refresh(); render(); } });
  return { teardown() { S.dead = true; offH24(); offTT(); }, open() { /* nothing to jump to */ } };
}
