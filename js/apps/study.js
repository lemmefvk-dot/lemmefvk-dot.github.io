/* ============================================================
   study.js — Static Study: flashcards, homework, a GPA calculator
   writing helpers (word tools, citations, a dictionary), a reading list and
   a class timetable in one window.

   One app with three tabs rather than three apps: they are one
   student's one set of school things, they share a header that says
   what needs doing today (cards due, assignments due or overdue),
   and one launcher entry is easier to find than three. Each tab is
   its own module under js/study/, and the arithmetic and the
   reminders live in core modules (js/core/flashcards.js, homework.js,
   gpa.js) that work without this window: a homework reminder is
   handed to the reminders engine (js/core/automations.js) when you
   save it and goes off with this window closed.

   Everything is saved on this device (store 'portal.flashcards',
   'portal.homework', 'portal.gpa'); nothing is shown that was not
   entered or counted from what was.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as FC from '../core/flashcards.js';
import * as HW from '../core/homework.js';
import * as EXM from '../core/exams.js';
import { mountCards } from '../study/cards.js';
import { mountHomework } from '../study/homework.js';
import { mountGpa } from '../study/gpa.js';
import { mountWords } from '../study/words.js';
import { mountCite } from '../study/cite.js';
import { mountDict } from '../study/dict.js';
import { mountQuiz } from '../study/quiz.js';
import { mountEquations } from '../study/equations.js';
import { mountExams } from '../study/exams.js';
import { mountFractions } from '../study/fractions.js';
import { mountStats } from '../study/stats.js';
import { mountVocab } from '../study/vocab.js';
import { mountBooks } from '../study/books.js';
import { mountTimetable } from '../study/timetable.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-study-css')) {
  const link = document.createElement('link');
  link.id = 'feat-study-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-study.css';
  document.head.appendChild(link);
  const plan = document.createElement('link');      /* the Reading and Timetable tabs */
  plan.id = 'feat-planning-css';
  plan.rel = 'stylesheet';
  plan.href = 'css/feat-planning.css';
  if (!document.getElementById('feat-planning-css')) document.head.appendChild(plan);
}

const TABS = [['cards', 'Flashcards', 'layers'], ['homework', 'Homework', 'clipboard'], ['exams', 'Exams', 'calendar'], ['gpa', 'GPA', 'calculator'], ['words', 'Words', 'type'], ['cite', 'Cite', 'bookmark'], ['dict', 'Dictionary', 'search'], ['quiz', 'Quiz', 'users'], ['equations', 'Equations', 'calculator'], ['fractions', 'Fractions', 'pie-chart'], ['stats', 'Statistics', 'bar-chart'], ['vocab', 'Vocab', 'globe'], ['books', 'Reading', 'bookmark'], ['timetable', 'Timetable', 'calendar']];
const VIEWS = { cards: mountCards, homework: mountHomework, exams: mountExams, gpa: mountGpa, words: mountWords, cite: mountCite, dict: mountDict, quiz: mountQuiz, equations: mountEquations, fractions: mountFractions, stats: mountStats, vocab: mountVocab, books: mountBooks, timetable: mountTimetable };
const TAB_KEY = 'portal.studyTab';
const NARROW = 560;

defineApp({
  id: 'study',
  name: 'Static Study',
  icon: 'layers',
  g1: '#ffd36b', g2: '#e08a1e',
  category: 'Productivity',
  keywords: ['flashcards', 'cards', 'anki', 'spaced repetition', 'homework', 'assignments', 'planner', 'school', 'gpa', 'grades', 'calculator', 'final', 'study', 'quizlet', 'word count', 'reading time', 'case converter', 'find and replace', 'citation', 'cite', 'mla', 'apa', 'chicago', 'bibliography', 'works cited', 'dictionary', 'definition', 'synonym', 'thesaurus', 'quiz', 'kahoot', 'multiple choice', 'host a quiz', 'equation', 'solve', 'algebra', 'quadratic', 'linear', 'math', 'exam', 'test', 'countdown', 'study plan', 'revision', 'fraction', 'fractions', 'mixed number', 'statistics', 'mean', 'median', 'mode', 'standard deviation', 'line of best fit', 'regression', 'vocabulary', 'vocab', 'language', 'pronunciation, a reading list and your class timetable', 'spanish', 'french', 'words', 'reading list', 'books', 'book', 'timetable', 'schedule', 'classes', 'a/b week', 'now and next'],
  desc: 'Flashcards, homework, exam countdowns with study plans, GPA, word tools, citations, a dictionary, quizzes, an equation solver, fractions, statistics and a vocabulary trainer with spoken pronunciation, a reading list and your class timetable',
  singleton: true,
  win: { w: 900, h: 620, minW: 440, minH: 420 },
  shortcuts: [['Space', 'Flip the flashcard'], ['1 / 2 / 3 / 4', 'Grade the card: Again, Hard, Good, Easy'], ['Esc', 'Leave the study session']],

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, clear, store } = api;
    const saved = store.get(TAB_KEY);
    const first = opts && opts.quizJoin ? 'quiz' : opts && TABS.some(t => t[0] === opts.tab) ? opts.tab : (TABS.some(t => t[0] === saved) ? saved : 'cards');
    const S = { tab: first, view: null, dead: false };

    const summary = h('div.study__sum', { role: 'status', 'aria-label': 'Today', dataset: { fk: 'summary' } });
    const tabsEl = h('div.tabs.study__tabs', { role: 'tablist', 'aria-label': 'Static Study' });
    const body = h('div.study__body');
    const el = h('div.study', h('div.study__head', tabsEl, summary), body);
    root.appendChild(el);

    const isActive = () => win.el.classList.contains('is-active');
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

    function paintSummary() {
      const cards = FC.counts(FC.read().decks.flatMap(d => d.cards));
      const hw = HW.viewToday(HW.read().assignments);
      const open = hw.overdue.length + hw.today.length;
      const parts = [h('span', { dataset: { fk: 'sum-cards' }, text: `${plural(cards.due, 'card')} due` }),
        h('span', { dataset: { fk: 'sum-hw' }, class: hw.overdue.length ? 'is-over' : '', text: `${plural(open, 'assignment')} due${hw.overdue.length ? ` (${hw.overdue.length} overdue)` : ''}` })];
      const next = EXM.read().exams.filter(e => !EXM.isPast(e)).sort((a, b) => EXM.examAt(a) - EXM.examAt(b))[0];
      if (next) { const cd = EXM.countdown(next); parts.push(h('span', { dataset: { fk: 'sum-exam' }, text: `Next test: ${next.subject}, ${cd.state === 'today' ? 'today' : cd.days === 1 ? 'tomorrow' : `in ${plural(cd.days, 'day')}`}` })); }
      clear(summary);
      summary.append(h('small', { text: 'Today' }), ...parts);
    }
    function paintTabs() {
      clear(tabsEl);
      for (const [id, label, ic] of TABS) {
        tabsEl.append(h('button', { type: 'button', role: 'tab', id: `study-tab-${id}`, 'aria-selected': S.tab === id ? 'true' : 'false', 'aria-controls': 'study-panel', tabindex: S.tab === id ? '0' : '-1',
          class: S.tab === id ? 'is-on' : '', dataset: { tab: id }, onclick: () => show(id),
          onkeydown: e => {
            const i = TABS.findIndex(t => t[0] === S.tab);
            const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
            if (j >= 0) { e.preventDefault(); show(TABS[j][0]); const b = tabsEl.querySelector(`[data-tab="${TABS[j][0]}"]`); if (b) b.focus(); }
          } }, icon(ic), h('span', { text: label })));
      }
    }
    function show(tab, open) {
      if (S.view) { try { S.view.teardown(); } catch (e) { console.error(e); } S.view = null; }
      S.tab = tab;
      try { store.set(TAB_KEY, tab); } catch (e) { /* fine */ }
      clear(body);
      body.setAttribute('role', 'tabpanel');
      body.id = 'study-panel';
      body.setAttribute('aria-labelledby', `study-tab-${tab}`);
      const host = h('div.study__view', { dataset: { view: tab } });
      body.appendChild(host);
      const vctx = { api, win, isActive, changed: paintSummary };
      S.view = VIEWS[tab](host, vctx);
      if (open) S.view.open(open);
      win.setTitle('Static Study');
      win.setSubtitle(`— ${TABS.find(t => t[0] === tab)[1]}`);
      paintTabs();
      paintSummary();
    }
    show(S.tab, opts);

    win.onReopen(o => {
      const t = o && o.quizJoin ? 'quiz' : o && TABS.some(x => x[0] === o.tab) ? o.tab : S.tab;
      if (t !== S.tab) show(t, o); else if (S.view) S.view.open(o);
    });

    /* the header counts follow the clock (overdue turns on by itself) */
    const off = api.bus.on('tick:5s', () => { if (!S.dead) paintSummary(); });
    let ro = null;
    const fit = w => el.classList.toggle('is-narrow', w < NARROW);
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(entries => { for (const e of entries) fit(e.contentRect.width); });
      ro.observe(el);
    } else fit(el.clientWidth || win.w || 900);

    return () => {
      S.dead = true;
      off();
      if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } }
      if (S.view) { try { S.view.teardown(); } catch (e) { /* fine */ } }
    };
  },
});
