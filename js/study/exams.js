/* ============================================================
   study/exams.js — the Exams tab of Static Study.

   Each test has a subject, a date (and optionally a time) and the
   topics to cover. The tab shows how many real days are left (counted
   on your own calendar, so a clock change cannot make it a day out;
   the day itself says "Today") and a study plan: the topics still open
   spread evenly over the free days before the exam, skipping days you
   mark busy. Tick a topic and the plan is made again; let a day go by
   and the topics planned for it carry over to the rest. When the time
   cannot work it says so, in your own numbers. A reminder goes through
   the same engine as homework reminders (js/core/exams.js).
   All text typed here is shown as text.
   ============================================================ */
import * as EX from '../core/exams.js';
import * as HW from '../core/homework.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SHOW_DAYS = 14;
const dayText = (day, long) => HW.parseDay(day).toLocaleDateString(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
const timeText = t => new Date(2000, 0, 3, ...t.split(':').map(Number)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function mountExams(host, ctx) {
  const { api } = ctx;
  const { h, icon, clear, confirm } = api;
  const S = { data: EX.read(), sel: '', form: null, note: '', allDays: {}, dead: false, today: EX.todayOf(), focus: null };
  const root = h('div.st-ex');
  host.appendChild(root);

  function save(next) {
    const res = EX.write(next);
    S.data = EX.read();
    return res;
  }
  const mutate = fn => { const d = EX.read(); fn(d); return save(d); };
  const find = id => S.data.exams.find(e => e.id === id) || null;

  /* ---------- actions ---------- */
  function blank() { return { id: '', subject: '', date: '', time: '', topics: '', perDay: '', perTopic: '', remind: null, issue: '' }; }
  function submit() {
    const f = S.form;
    const subject = f.subject.replace(/\s+/g, ' ').trim();
    if (!subject) { f.issue = 'Give the test a subject.'; return render(); }
    if (!HW.parseDay(f.date)) { f.issue = 'Pick the date of the test.'; return render(); }
    if (!f.id && EX.isPast(EX.normExam({ subject: 'x', date: f.date, time: f.time }), Date.now())) { f.issue = 'That date has already passed. Pick today or a later day.'; return render(); }
    const num = (v, max, label) => { const t = String(v).trim(); if (!t) return 0; const n = Number(t); if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${label} must be a whole number of minutes from 1 to ${max}, or empty.`); return n; };
    let perDay, perTopic;
    try { perDay = num(f.perDay, 1440, 'Minutes a day'); perTopic = num(f.perTopic, 600, 'Minutes a topic'); } catch (err) { f.issue = err.message; return render(); }
    const next = EX.read();
    const i = next.exams.findIndex(e => e.id === f.id);
    if (i < 0 && next.exams.length >= EX.MAX_EXAMS) { f.issue = `You can keep up to ${EX.MAX_EXAMS} tests.`; return render(); }
    const rec = i >= 0 ? { ...next.exams[i] } : { id: HW.uid('x'), topics: [], busy: [], created: Date.now(), late: [], sched: {} };
    Object.assign(rec, { subject, date: f.date, time: f.time, perDay, perTopic, remind: f.remind });
    let added = 0;
    if (i < 0) {
      const seen = new Set();
      for (const line of f.topics.split('\n')) {
        const t = line.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (t && !seen.has(t.toLowerCase()) && rec.topics.length < EX.MAX_TOPICS) { seen.add(t.toLowerCase()); rec.topics.push({ id: HW.uid('t'), text: t, done: false }); added++; }
      }
      next.exams.push(rec);
    } else next.exams[i] = rec;
    const res = save(next);
    S.sel = rec.id;
    S.note = `${i >= 0 ? 'Saved' : 'Added'} “${subject}”.${reminderNote(res.reminders, rec)}`;
    S.form = null;
    render();
  }
  function reminderNote(map, rec) {
    if (!rec.remind) return '';
    const refs = Object.keys(map).filter(k => k.startsWith(rec.id + ':'));
    const set = refs.filter(k => map[k] === 'set').length;
    const passed = refs.filter(k => map[k] === 'passed').length;
    const full = refs.filter(k => map[k] === 'full').length;
    if (full) return ' Some reminders were not set (too many reminders).';
    if (!refs.length) return ' No reminder to set yet: there is no day left to remind you on.';
    if (rec.remind === 'eve') return set ? ' Reminder set for the day before at 9:00 AM.' : ' That reminder time has already passed, so no reminder was set.';
    return ` Reminders set for ${plural(set, 'study day')} at 9:00 AM.${passed ? ` ${plural(passed, 'earlier reminder')} had already passed.` : ''}`;
  }
  function edit(id) {
    const e = find(id);
    if (!e) return;
    S.form = { id: e.id, subject: e.subject, date: e.date, time: e.time, topics: '', perDay: e.perDay ? String(e.perDay) : '', perTopic: e.perTopic ? String(e.perTopic) : '', remind: e.remind, issue: '' };
    S.focus = 'subject';
    render();
  }
  async function remove(id) {
    const e = find(id);
    if (!e) return;
    const ok = await confirm({ title: 'Delete this test?', message: `“${e.subject}”, its topics and its reminders are removed. This can’t be undone.`, ok: 'Delete', danger: true });
    if (!ok || S.dead) return;
    mutate(d => { d.exams = d.exams.filter(x => x.id !== id); });
    if (S.sel === id) S.sel = '';
    S.note = '';
    render();
  }
  const tick = (id, tid) => { mutate(d => { const x = d.exams.find(e => e.id === id); const t = x && x.topics.find(y => y.id === tid); if (t) t.done = !t.done; }); S.note = ''; render(); };
  function addTopic(id, input) {
    const t = input.value.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) return;
    const e = find(id);
    if (e && e.topics.length >= EX.MAX_TOPICS) { S.note = `A test can have up to ${EX.MAX_TOPICS} topics.`; return render(); }
    mutate(d => { d.exams.find(x => x.id === id).topics.push({ id: HW.uid('t'), text: t, done: false }); });
    S.note = '';
    S.focus = 'topic';
    render();
  }
  const dropTopic = (id, tid) => { mutate(d => { const x = d.exams.find(e => e.id === id); x.topics = x.topics.filter(t => t.id !== tid); }); S.note = ''; render(); };
  const toggleBusy = (id, day) => { mutate(d => { const x = d.exams.find(e => e.id === id); x.busy = x.busy.includes(day) ? x.busy.filter(b => b !== day) : [...x.busy, day]; }); S.note = ''; render(); };

  /* ---------- pieces ---------- */
  const cdText = (e, now) => EX.countdown(e, now);
  function card(e, now) {
    const cd = cdText(e, now);
    const done = e.topics.filter(t => t.done).length;
    return h('button.st-exc', { type: 'button', class: `is-${cd.state}${S.sel === e.id ? ' is-sel' : ''}`, 'aria-expanded': S.sel === e.id ? 'true' : 'false', dataset: { id: e.id, state: cd.state, fk: 'x-card' },
      'aria-label': `${e.subject}, ${dayText(e.date)}, ${cd.state === 'past' ? cd.text : cd.state === 'today' ? 'today' : cd.text + ' to go'}`,
      onclick: () => { S.sel = S.sel === e.id ? '' : e.id; render(); } },
    h('span.st-exc__n', { dataset: { fk: 'x-count' } }, h('b', { text: cd.state === 'today' ? 'Today' : cd.state === 'past' ? '✓' : String(cd.days) }), cd.state === 'later' || cd.state === 'soon' ? h('small', { text: cd.days === 1 ? 'day' : 'days' }) : null),
    h('span.st-exc__m', h('span.st-exc__t', { text: e.subject }),
      h('span.st-exc__s', { text: `${dayText(e.date)}${e.time ? `, ${timeText(e.time)}` : ''}` }),
      h('span.st-exc__s', { dataset: { fk: 'x-progress' }, text: e.topics.length ? `${done} of ${plural(e.topics.length, 'topic')} done` : 'No topics yet' })),
    cd.state === 'past' ? h('span.st-exc__tag', { text: cd.text }) : cd.state === 'soon' || cd.state === 'today' ? h('span.st-exc__tag.is-soon', { text: cd.state === 'today' ? 'Today' : cd.days === 1 ? 'Tomorrow' : 'This week' }) : null);
  }

  function detail(e, now) {
    const cd = cdText(e, now);
    const p = EX.plan(e, now);
    const late = new Set(e.late);
    const topicIn = h('input.st-in', { type: 'text', maxlength: '120', placeholder: 'Add a topic (e.g. Chapter 4: Photosynthesis)', 'aria-label': 'Add a topic', dataset: { fk: 'x-topic-in' },
      onkeydown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); addTopic(e.id, topicIn); } } });
    if (S.focus === 'topic') { S.focusEl = topicIn; S.focus = null; }
    const topics = e.topics.length ? h('div.st-aslist', { role: 'list', dataset: { fk: 'x-topics' } }, e.topics.map(t => h('div.st-as', { role: 'listitem', class: t.done ? 'is-done' : '', dataset: { tid: t.id, done: t.done ? '1' : '0' } },
      h('button.st-check', { type: 'button', role: 'checkbox', class: t.done ? 'is-done' : '', 'aria-checked': t.done ? 'true' : 'false', 'aria-label': `${t.done ? 'Mark not done' : 'Mark done'}: ${t.text}`, dataset: { fk: 'x-tick' }, onclick: () => tick(e.id, t.id) }, t.done ? icon('check') : null),
      h('span.st-as__main.st-ex__topic', h('span.st-as__t', { text: t.text }), !t.done && late.has(t.id) ? h('span.st-over', { dataset: { fk: 'x-late' } }, icon('alert'), h('span', { text: 'Carried over from a missed day' })) : null),
      h('button.ibtn', { type: 'button', 'aria-label': `Remove topic: ${t.text}`, onclick: () => dropTopic(e.id, t.id) }, icon('trash'))))) : h('p.st-none', { text: 'No topics yet. Add what the test covers and a plan appears.' });

    const days = S.allDays[e.id] ? p.days : p.days.slice(0, SHOW_DAYS);
    const planEl = [];
    if (p.status === 'past' || p.status === 'empty' || p.status === 'finished') planEl.push(h('p.st-none', { dataset: { fk: 'x-plan-msg' }, text: p.notes[0] }));
    else {
      for (const n of p.notes) planEl.push(h('div', { class: p.status === 'short' ? 'st-issue' : 'st-banner', role: p.status === 'short' ? 'alert' : 'status', dataset: { fk: p.status === 'short' ? 'x-short' : 'x-note' } }, icon('alert'), h('span', { text: n })));
      planEl.push(h('div.st-ex__plan', { role: 'list', dataset: { fk: 'x-plan' } }, days.map(d => {
        const isToday = d.day === EX.todayOf(now);
        return h('div.st-pd', { role: 'listitem', class: d.busy ? 'is-busy' : '', dataset: { day: d.day, busy: d.busy ? '1' : '0', n: String(d.topics.length), fk: 'x-day' } },
          h('div.st-pd__d', h('b', { text: dayText(d.day) }), isToday ? h('small', { text: 'Today' }) : null),
          h('div.st-pd__t', d.busy ? h('span.dim', { text: 'Busy: no study planned' })
            : d.topics.length ? [d.topics.map(t => h('span.st-pd__i', { dataset: { fk: 'x-day-topic' }, text: t.text })), d.minEach ? h('small.dim', { text: `about ${d.minEach} min each, from your ${e.perDay} min` }) : null]
              : h('span.dim', { text: 'Nothing new planned: free for revision' })),
          h('button.btn.btn--sm', { type: 'button', 'aria-pressed': d.busy ? 'true' : 'false', 'aria-label': `${d.busy ? 'Mark free' : 'Mark busy'}: ${dayText(d.day)}`, dataset: { fk: 'x-busy' }, onclick: () => toggleBusy(e.id, d.day) }, h('span', { text: d.busy ? 'Free this day' : 'Busy' })));
      })));
      if (p.days.length > SHOW_DAYS) planEl.push(h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'x-alldays' }, onclick: () => { S.allDays[e.id] = !S.allDays[e.id]; render(); } }, h('span', { text: S.allDays[e.id] ? 'Show fewer days' : `Show all ${p.days.length} days` })));
      if (p.unplanned.length) planEl.push(h('div.st-ex__un', { dataset: { fk: 'x-unplanned' } }, h('b', { text: 'Not planned (does not fit):' }), h('span', { text: ' ' + p.unplanned.map(t => t.text).join(', ') })));
    }
    return h('section.st-ex__detail', { 'aria-label': `${e.subject} study plan`, dataset: { fk: 'x-detail', id: e.id } },
      h('div.st-row',
        h('div.st-ex__big', { dataset: { fk: 'x-big' } }, h('b', { text: cd.state === 'past' ? cd.text : cd.state === 'today' ? 'Today' : cd.text }), cd.state !== 'past' && cd.state !== 'today' ? h('small', { text: 'to go' }) : null),
        h('span.st-spacer'),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'x-edit' }, onclick: () => edit(e.id) }, icon('edit-3'), h('span', { text: 'Edit' })),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'x-delete' }, 'aria-label': `Delete test: ${e.subject}`, onclick: () => remove(e.id) }, icon('trash'), h('span', { text: 'Delete' }))),
      h('p.st-note', { text: `${dayText(e.date, true)}${e.time ? ` at ${timeText(e.time)}` : ''}. ${e.remind ? `Reminder: ${EX.remindLabel(e.remind).toLowerCase()}.` : 'No reminder.'}${e.perDay ? ` You have ${e.perDay} min a day to study.` : ''}${e.perTopic ? ` You think one topic needs ${e.perTopic} min.` : ''}` }),
      h('div.side__label', { text: `Topics (${e.topics.filter(t => t.done).length} of ${e.topics.length} done)` }), topics,
      h('div.st-row', topicIn, h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'x-topic-add' }, onclick: () => addTopic(e.id, topicIn) }, icon('plus'), h('span', { text: 'Add topic' }))),
      h('div.side__label', { text: 'Study plan' }),
      h('p.st-note', { text: 'Open topics are spread evenly over the free days from today to the day before the test. Tick a topic, or mark a day busy, and the plan is made again.' }),
      ...planEl);
  }

  function form() {
    const f = S.form;
    const fld = (label, el) => h('label.st-f', h('span.st-f__l', { text: label }), el);
    const subject = h('input.st-in', { type: 'text', maxlength: '60', placeholder: 'Subject (e.g. Biology midterm)', 'aria-label': 'Subject', dataset: { fk: 'x-subject' }, oninput: ev => { f.subject = ev.target.value; } });
    subject.value = f.subject;
    if (S.focus === 'subject') { S.focusEl = subject; S.focus = null; }
    const date = h('input.st-in', { type: 'date', value: f.date, 'aria-label': 'Test date', dataset: { fk: 'x-date' }, oninput: ev => { f.date = ev.target.value; } });
    const time = h('input.st-in', { type: 'time', value: f.time, 'aria-label': 'Test time (optional)', dataset: { fk: 'x-time' }, oninput: ev => { f.time = ev.target.value; } });
    const topics = f.id ? null : h('textarea.st-ta', { rows: '4', maxlength: '8000', placeholder: 'Topics, one per line', 'aria-label': 'Topics, one per line', dataset: { fk: 'x-topics-in' }, oninput: ev => { f.topics = ev.target.value; } });
    if (topics) topics.value = f.topics;
    const perDay = h('input.st-in', { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'optional', 'aria-label': 'Minutes you can study each day', dataset: { fk: 'x-perday' }, oninput: ev => { f.perDay = ev.target.value; } });
    perDay.value = f.perDay;
    const perTopic = h('input.st-in', { type: 'text', inputmode: 'numeric', maxlength: '3', placeholder: 'optional', 'aria-label': 'Minutes one topic needs', dataset: { fk: 'x-pertopic' }, oninput: ev => { f.perTopic = ev.target.value; } });
    perTopic.value = f.perTopic;
    const rem = h('select.select.st-sel', { 'aria-label': 'Reminder', dataset: { fk: 'x-remind' }, onchange: ev => { f.remind = ev.target.value === '' ? null : ev.target.value; } },
      EX.REMIND.map(([v, l]) => h('option', { value: v === null ? '' : v, text: l, selected: v === f.remind })));
    return h('section.st-form', { 'aria-label': f.id ? 'Edit test' : 'New test' },
      fld('Subject', subject),
      h('div.st-form__grid', fld('Date', date), fld('Time (optional)', time), fld('Reminder', rem)),
      topics ? fld('Topics (one per line)', topics) : null,
      h('div.st-form__grid', fld('Minutes you can study each day (optional)', perDay), fld('Minutes one topic needs, your estimate (optional)', perTopic)),
      h('small.dim', { text: 'The plan only uses minutes you give it. Leave them empty and it just splits the topics over the days.' }),
      f.issue ? h('div.st-issue', { role: 'alert', dataset: { fk: 'x-issue' } }, icon('alert'), h('span', { text: f.issue })) : null,
      h('div.st-row', h('span.st-spacer'),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'x-cancel' }, onclick: () => { S.form = null; render(); } }, h('span', { text: 'Cancel' })),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'x-save' }, onclick: submit }, icon('check'), h('span', { text: f.id ? 'Save' : 'Add test' }))));
  }

  /* ---------- render ---------- */
  function render() {
    if (S.dead) return;
    S.focusEl = null;
    S.today = EX.todayOf();
    const now = Date.now();
    clear(root);
    root.append(h('div.app__bar', h('b', { text: 'Exams' }), h('span.st-spacer'),
      h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'x-new' }, onclick: () => { S.form = blank(); S.focus = 'subject'; render(); } }, icon('plus'), h('span', { text: 'Add test' }))));
    const body = h('div.app__content.st-scroll');
    if (S.note) { body.append(h('div.st-flash', { role: 'status', dataset: { fk: 'x-flash' } }, icon('check'), h('span', { text: S.note }))); S.note = ''; }
    if (S.form) body.append(form());
    const all = S.data.exams;
    const upcoming = all.filter(e => !EX.isPast(e, now)).sort((a, b) => EX.examAt(a) - EX.examAt(b));
    const past = all.filter(e => EX.isPast(e, now)).sort((a, b) => EX.examAt(b) - EX.examAt(a));
    if (!all.length && !S.form) body.append(h('div.empty', icon('calendar'), h('b', { text: 'Add your first test' }), h('small', { text: 'Give it a subject, a date and the topics it covers. You get a countdown in days and a study plan that splits the topics over the days you have.' })));
    const list = (label, items, key) => items.length ? h('section.st-grp', { 'aria-label': label, dataset: { group: key } },
      h('div.side__label', h('span', { text: label }), h('small', { text: String(items.length) })),
      h('div.st-ex__list', { role: 'list' }, items.map(e => h('div', { role: 'listitem', class: 'st-ex__item' }, card(e, now), S.sel === e.id ? detail(e, now) : null)))) : null;
    body.append(...[list('Coming up', upcoming, 'upcoming'), list('Past', past, 'past')].filter(Boolean));
    root.append(body);
    const el = S.focusEl;
    if (el) requestAnimationFrame(() => { try { if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return; el.focus(); } catch (err) { /* fine */ } });
    ctx.changed && ctx.changed();
  }

  /* the countdown turns over at midnight by itself, and the plan with it */
  S.minute = Math.floor(Date.now() / 60000);
  const off = api.bus.on('tick:5s', () => {
    const t = EX.todayOf(), m = Math.floor(Date.now() / 60000);
    if (S.form || (t === S.today && m === S.minute)) return;
    const a = document.activeElement;
    if (t === S.today && a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;   /* never take a topic being typed */
    S.minute = m;
    S.data = t === S.today ? EX.read() : EX.refresh();
    render();
  });
  render();

  return {
    teardown() { S.dead = true; off(); },
    open(o) {
      if (o && o.exam && find(o.exam)) { S.sel = o.exam; render(); }
    },
  };
}
