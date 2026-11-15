/* ============================================================
   study/today.js — the Today tab of Static Study: what needs doing
   today, counted from what the other tabs already keep.

     cards due      js/core/flashcards.js, deck by deck
     homework       overdue and due today (js/core/homework.js), with
                    the minutes YOU estimated added up
     next class     js/core/timetable.js: on now, or the next one
     next exam      js/core/exams.js, and today's topics from its plan
     streak         days in a row with real study: a flashcard review
                    in the review log, or a finished Focus session in
                    Clock › Focus's history (js/core/focus.js)
     minutes        Focus minutes only: today, the last 7 days, and per
                    subject — a session started here on a subject
                    (focus.startOn) is logged under its name
   Nothing is estimated or made up: a count that has nothing behind it
   says so.
   ============================================================ */
import * as FC from '../core/flashcards.js';
import * as HW from '../core/homework.js';
import * as EX from '../core/exams.js';
import * as TT from '../core/timetable.js';
import * as FOCUS from '../core/focus.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fold = s => String(s || '').trim().toLowerCase();
const clock = t => new Date(2000, 0, 3, ...t.split(':').map(Number)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Days in a row with a flashcard review or a finished Focus session, up to today. -> { days, today } */
export function streak(now = Date.now(), log = FC.read().log, focus = FOCUS.history(120)) {
  const f = new Map(focus.map(x => [x.key, x.n]));
  const on = d => !!((log[d] && log[d].n > 0) || f.get(d) > 0);
  const t = FC.today(now);
  const todayOn = on(t);
  let d = todayOn ? t : FC.addDays(t, -1), n = 0;
  while (on(d) && n < 800) { n++; d = FC.addDays(d, -1); }
  return { days: n, today: todayOn };
}

/** The subjects there are: Homework classes (not archived), timetable subjects, coming exams' subjects — each once. */
export function subjects(now = Date.now()) {
  const out = [];
  const add = s => { const v = String(s || '').trim(); if (v && !out.some(x => fold(x) === fold(v))) out.push(v); };
  for (const c of HW.read().classes) if (!c.archived) add(c.name);
  for (const c of TT.read().classes) add(c.subject);
  for (const e of EX.read().exams) if (!EX.isPast(e, now)) add(e.subject);
  return out;
}

/** Focus minutes per subject over the last `days` days: [{ subject, min }], most first. Only names that are subjects. */
export function minutesBySubject(days = 7, now = Date.now()) {
  const by = FOCUS.onWhat(days);
  const out = [];
  for (const s of subjects(now)) {
    let min = 0;
    for (const [w, m] of Object.entries(by)) if (fold(w) === fold(s)) min += m;
    if (min) out.push({ subject: s, min });
  }
  return out.sort((a, b) => b.min - a.min || a.subject.localeCompare(b.subject));
}

export function mountToday(host, ctx) {
  const { api } = ctx;
  const { h, icon, clear } = api;
  const S = { dead: false, subject: '', minute: Math.floor(Date.now() / 60000) };
  const root = h('div.st-today');
  host.appendChild(root);

  const section = (fk, title, ic, ...kids) => h('section.st-tcard', { 'aria-label': title, dataset: { fk } },
    h('div.st-tcard__h', icon(ic), h('b', { text: title })), ...kids);
  const go = (tab, o) => ctx.go(tab, o);

  function streakCard(now) {
    const st = streak(now);
    const hist = FOCUS.history(7);
    const minToday = hist[hist.length - 1].min, minWeek = hist.reduce((s, x) => s + x.min, 0);
    const rev = (FC.read().log[FC.today(now)] || { n: 0 }).n;
    return section('today-streak', 'Your study', 'flame',
      h('div.st-stats',
        h('div.st-stat', h('b', { dataset: { fk: 'today-streak-n' }, text: String(st.days) }), h('small', { text: st.days === 1 ? 'day in a row' : 'days in a row' })),
        h('div.st-stat', h('b', { dataset: { fk: 'today-min' }, text: String(minToday) }), h('small', { text: 'Focus minutes today' })),
        h('div.st-stat', h('b', { dataset: { fk: 'today-week' }, text: String(minWeek) }), h('small', { text: 'Focus minutes, last 7 days' })),
        h('div.st-stat', h('b', { dataset: { fk: 'today-reviews' }, text: String(rev) }), h('small', { text: 'Cards reviewed today' }))),
      h('small.dim', { dataset: { fk: 'today-streak-note' }, text: st.days && !st.today
        ? 'Nothing yet today: review a card or finish a Focus session to keep the streak going.'
        : 'A day counts when you review a flashcard or finish a Focus session. Minutes are Focus minutes only.' }));
  }

  function focusCard(now) {
    const fs = FOCUS.state();
    const list = subjects(now);
    if (S.subject && !list.includes(S.subject)) S.subject = '';
    if (!S.subject) S.subject = list[0] || '';
    const running = fs.phase === 'focus' && fs.status !== 'ready';
    const left = Math.max(0, Math.ceil(fs.left / 60000));
    const status = running
      ? h('p.st-note', { dataset: { fk: 'today-focusing' }, text: `${fs.status === 'paused' ? 'Paused' : 'Focusing'}${fs.what ? ` on ${fs.what}` : ''}: ${plural(left, 'minute')} left.` })
      : fs.phase !== 'focus' && fs.status !== 'ready' ? h('p.st-note', { text: `On a ${fs.label.toLowerCase()}.` }) : null;
    const by = minutesBySubject(7, now);
    const max = Math.max(1, ...by.map(x => x.min));
    return section('today-focus', 'Focus on a subject', 'clock',
      list.length
        ? h('div.st-row',
          h('select.select.st-sel', { 'aria-label': 'Subject', dataset: { fk: 'today-subject' }, onchange: e => { S.subject = e.target.value; } }, list.map(s => h('option', { value: s, text: s, selected: s === S.subject }))),
          h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'today-focus-go' }, onclick: () => { if (S.subject) { FOCUS.startOn(S.subject); render(); } } }, icon('play'), h('span', { text: running ? 'Switch to this' : 'Start focus' })),
          running ? h('button.btn.btn--sm', { type: 'button', onclick: () => FOCUS.openFocus() }, h('span', { text: 'Open the timer' })) : null)
        : h('p.st-none', { text: 'Add a class in Homework or Timetable, or a test in Exams, and you can focus on it here.' }),
      status,
      by.length
        ? h('div.st-tbars', { role: 'list', 'aria-label': 'Focus minutes per subject, last 7 days', dataset: { fk: 'today-subjects' } }, by.map(x => h('div.st-tbar', { role: 'listitem', dataset: { subject: x.subject, min: String(x.min) } },
          h('span', { text: x.subject }), h('i', { 'aria-hidden': 'true', style: { '--w': `${Math.max(3, Math.round(x.min / max * 100))}%` } }), h('small', { text: `${x.min} min` }))))
        : h('small.dim', { text: 'Minutes per subject appear here after a Focus session on one runs to the end.' }));
  }

  function cardsCard(now) {
    const data = FC.read();
    const decks = data.decks.map(d => ({ d, due: FC.counts(d.cards, now).due, q: FC.deckQueue(d, now).length })).filter(x => x.q);
    const due = FC.counts(data.decks.flatMap(d => d.cards), now).due;
    return section('today-cards', 'Flashcards', 'layers',
      h('p.st-sum', { dataset: { fk: 'today-cards-n' }, text: data.decks.length ? `${plural(due, 'card')} due today.` : 'No decks yet.' }),
      decks.length ? h('div.st-tlist', { role: 'list' }, decks.slice(0, 6).map(x => h('div.st-trow', { role: 'listitem', dataset: { deck: x.d.id } },
        h('span.st-trow__t', { text: x.d.name }), h('small', { text: `${x.due} due · ${plural(x.q, 'card')} to study` }),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'today-study' }, onclick: () => go('cards', { deck: x.d.id, start: 'study' }) }, icon('play'), h('span', { text: 'Study' })))))
        : h('button.btn.btn--sm', { type: 'button', onclick: () => go('cards') }, h('span', { text: data.decks.length ? 'Open Flashcards' : 'Make a deck' })));
  }

  function hwCard(now) {
    const data = HW.read();
    const list = HW.activeList(data);
    const v = HW.viewToday(list, now);
    const items = [...v.overdue, ...v.today];
    const est = HW.estimateToday(list, now);
    const cls = id => data.classes.find(c => c.id === id);
    const tick = id => { const d = HW.read(); const a = d.assignments.find(x => x.id === id); if (!a) return; a.done = true; a.doneAt = Date.now(); HW.write(d); api.bus.emit('homework:done', { id }); render(); };
    return section('today-hw', 'Homework', 'clipboard',
      h('p.st-sum', { dataset: { fk: 'today-hw-n' }, text: items.length ? `${plural(items.length, 'assignment')} to do${v.overdue.length ? `, ${v.overdue.length} overdue` : ''}.` : list.length ? 'Nothing due today and nothing overdue.' : 'No assignments yet.' }),
      items.length && (est.with || est.without) ? h('small.dim', { dataset: { fk: 'today-hw-est' }, text: est.with ? `About ${HW.minText(est.min)} by your estimates${est.without ? ` (${est.without} without one)` : ''}.` : 'None of these has a time estimate yet.' }) : null,
      items.length ? h('div.st-tlist', { role: 'list' }, items.slice(0, 8).map(a => { const c = cls(a.classId); return h('div.st-trow', { role: 'listitem', dataset: { id: a.id }, class: HW.isOverdue(a, now) ? 'is-over' : '', style: { '--cc': c ? c.color : 'var(--ink-4)' } },
        h('button.st-check', { type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': `Mark done: ${a.title}`, dataset: { fk: 'today-hw-done' }, onclick: () => tick(a.id) }),
        h('button.st-trow__t', { type: 'button', onclick: () => go('homework', { assignment: a.id }) }, h('i.st-dot', { 'aria-hidden': 'true' }), h('span', { text: c ? `${c.name}: ${a.title}` : a.title })),
        h('small', { text: `${HW.isOverdue(a, now) ? 'Overdue · ' : ''}${a.est ? `~${HW.minText(a.est)}` : HW.dueText(a)}` })); })) : null);
  }

  function classCard(now) {
    const tt = TT.read();
    if (!tt.classes.length) return section('today-class', 'Classes', 'calendar', h('p.st-none', { text: 'No timetable yet.' }), h('button.btn.btn--sm', { type: 'button', onclick: () => go('timetable') }, h('span', { text: 'Set up your timetable' })));
    const st = TT.status(now, tt);
    const line = (c, label, fk) => h('div.st-trow', { dataset: { fk } }, h('span.st-trow__t', h('b', { text: `${label}: ` }), h('span', { text: c.subject })),
      h('small', { text: label === 'Now' ? `until ${clock(c.end)} · ${TT.span(c.endAt - now)} left${c.room ? ` · Room ${c.room}` : ''}` : `${TT.dayWord(c.on, now)} at ${clock(c.start)}${c.room ? ` · Room ${c.room}` : ''}` }));
    return section('today-class', 'Classes', 'calendar',
      st.current.map(c => line(c, 'Now', 'today-now')),
      st.next ? line(st.next, 'Next', 'today-next') : h('p.st-none', { dataset: { fk: 'today-next' }, text: 'No class in the next two weeks.' }));
  }

  function examCard(now) {
    const next = EX.read().exams.filter(e => !EX.isPast(e, now)).sort((a, b) => EX.examAt(a) - EX.examAt(b))[0];
    if (!next) return section('today-exam', 'Next test', 'star', h('p.st-none', { dataset: { fk: 'today-exam-n' }, text: 'No tests coming up.' }));
    const cd = EX.countdown(next, now);
    const p = EX.plan(next, now);
    const todays = p.days.find(d => d.day === EX.todayOf(now));
    return section('today-exam', 'Next test', 'star',
      h('p.st-sum', { dataset: { fk: 'today-exam-n' }, text: `${next.subject}: ${cd.state === 'today' ? 'today' : cd.days === 1 ? 'tomorrow' : `in ${plural(cd.days, 'day')}`}.` }),
      todays && todays.topics.length ? h('div.st-row', { dataset: { fk: 'today-exam-topics' } }, h('small.dim', { text: 'On the plan for today:' }), todays.topics.map(t => h('span.st-pd__i', { text: t.again ? `${t.text} (again)` : t.text })))
        : h('small.dim', { text: p.status === 'finished' ? 'Every topic is ticked off.' : p.status === 'empty' ? 'No topics yet.' : 'Nothing new planned for today.' }),
      h('button.btn.btn--sm', { type: 'button', onclick: () => go('exams', { exam: next.id }) }, h('span', { text: 'Open the plan' })));
  }

  function render() {
    if (S.dead) return;
    const now = Date.now();
    const keep = root.querySelector('[data-fk="today-subject"]') === document.activeElement;
    clear(root);
    root.append(h('div.app__bar', h('b', { text: new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) })),
      h('div.app__content.st-scroll.st-today__grid', streakCard(now), hwCard(now), cardsCard(now), examCard(now), classCard(now), focusCard(now)));
    if (keep) root.querySelector('[data-fk="today-subject"]')?.focus();
    ctx.changed && ctx.changed();
  }

  /* minute by minute (a class starts, a session ends), and whenever Focus changes */
  const offTick = api.bus.on('tick:5s', () => {
    const m = Math.floor(Date.now() / 60000);
    if (m === S.minute) return;
    S.minute = m;
    if (!root.contains(document.activeElement) || document.activeElement.tagName !== 'SELECT') render();
  });
  const offFocus = api.bus.on('focus:change', () => { if (!S.dead) render(); });
  render();
  return { teardown() { S.dead = true; offTick(); offFocus(); }, open() { render(); } };
}
