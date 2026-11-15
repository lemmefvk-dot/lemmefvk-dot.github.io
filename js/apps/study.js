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

   Fifteen tabs are too many for one row, so the row holds Today and
   the five a student opens most; the rest are in More (grouped), and
   one opened from there sits in the row while it is open. Search looks
   through everything the tabs keep — decks and cards, homework, tests
   and their topics, classes, books, GPA courses — and the tools by
   name, and opens what it finds where it lives.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as FC from '../core/flashcards.js';
import * as HW from '../core/homework.js';
import * as EXM from '../core/exams.js';
import * as TT from '../core/timetable.js';
import * as BOOKS from '../core/books.js';
import * as GP from '../core/gpa.js';
import { fold } from '../core/textindex.js';
import { mountToday } from '../study/today.js';
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

const TABS = [['today', 'Today', 'sun'], ['cards', 'Flashcards', 'layers'], ['homework', 'Homework', 'clipboard'], ['exams', 'Exams', 'calendar'], ['gpa', 'GPA', 'calculator'], ['words', 'Words', 'type'], ['cite', 'Cite', 'bookmark'], ['dict', 'Dictionary', 'search'], ['quiz', 'Quiz', 'users'], ['equations', 'Equations', 'calculator'], ['fractions', 'Fractions', 'pie-chart'], ['stats', 'Statistics', 'bar-chart'], ['vocab', 'Vocab', 'globe'], ['books', 'Reading', 'bookmark'], ['timetable', 'Timetable', 'calendar']];
const VIEWS = { today: mountToday, cards: mountCards, homework: mountHomework, exams: mountExams, gpa: mountGpa, words: mountWords, cite: mountCite, dict: mountDict, quiz: mountQuiz, equations: mountEquations, fractions: mountFractions, stats: mountStats, vocab: mountVocab, books: mountBooks, timetable: mountTimetable };
const TAB_KEY = 'portal.studyTab';
/* the row: Today and the tabs opened most; the others are in More, in these groups */
const PRIMARY = ['today', 'cards', 'homework', 'exams', 'gpa', 'timetable'];
const GROUPS = [['Learn', ['vocab', 'quiz', 'books']], ['Write', ['words', 'cite', 'dict']], ['Maths', ['equations', 'fractions', 'stats']]];
const MAX_HITS = 40;
const NARROW = 560;

defineApp({
  id: 'study',
  name: 'Static Study',
  icon: 'layers',
  g1: '#ffd36b', g2: '#e08a1e',
  category: 'Productivity',
  keywords: ['flashcards', 'cards', 'anki', 'spaced repetition', 'homework', 'assignments', 'planner', 'school', 'gpa', 'grades', 'calculator', 'final', 'study', 'quizlet', 'word count', 'reading time', 'case converter', 'find and replace', 'citation', 'cite', 'mla', 'apa', 'chicago', 'bibliography', 'works cited', 'dictionary', 'definition', 'synonym', 'thesaurus', 'quiz', 'kahoot', 'multiple choice', 'host a quiz', 'equation', 'solve', 'algebra', 'quadratic', 'linear', 'math', 'exam', 'test', 'countdown', 'study plan', 'revision', 'fraction', 'fractions', 'mixed number', 'statistics', 'mean', 'median', 'mode', 'standard deviation', 'line of best fit', 'regression', 'vocabulary', 'vocab', 'language', 'pronunciation', 'spanish', 'french', 'words', 'reading list', 'books', 'book', 'timetable', 'schedule', 'classes', 'a/b week', 'now and next', 'today', 'streak', 'cloze', 'fill in the blank', 'reverse cards', 'share deck', 'transcript', 'what if', 'grade trend', 'study plan calendar', 'inequality', 'number line', 'simultaneous equations', 'system of equations', 'histogram', 'box plot', 'z-score', 'readability', 'word limit', 'true or false', 'short answer', 'practice test', 'free period', 'reading pace', 'next class'],
  desc: 'Flashcards, homework, exam countdowns, GPA, citations, quizzes and an equation solver',
  singleton: true,
  win: { w: 900, h: 620, minW: 440, minH: 420 },
  shortcuts: [['/', 'Search Static Study'], ['Space', 'Flip the flashcard'], ['1 / 2 / 3 / 4', 'Grade the card: Again, Hard, Good, Easy'], ['E', 'Edit the card you are studying'], ['R', 'Read the card aloud'], ['Esc', 'Leave the study session']],

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, clear, store } = api;
    const saved = store.get(TAB_KEY);
    const deckLink = opts && typeof opts.shared === 'string' && opts.shared;
    const first = opts && opts.quizJoin ? 'quiz' : deckLink ? 'cards' : opts && TABS.some(t => t[0] === opts.tab) ? opts.tab : (TABS.some(t => t[0] === saved) ? saved : 'today');
    const S = { tab: first, view: null, dead: false, q: '', hits: [], hit: 0 };

    const summary = h('div.study__sum', { role: 'status', 'aria-label': 'Today', dataset: { fk: 'summary' } });
    const tabsEl = h('div.tabs.study__tabs', { role: 'tablist', 'aria-label': 'Static Study' });
    const moreBtn = h('button.btn.btn--sm.btn--ghost.study__more', { type: 'button', 'aria-haspopup': 'menu', dataset: { fk: 'study-more' }, onclick: e => openMore(e.currentTarget) }, icon('grid'), h('span', { text: 'More' }));
    const results = h('div.study__hits', { role: 'listbox', 'aria-label': 'Search results', id: 'study-hits', hidden: true, dataset: { fk: 'study-hits' } });
    const searchIn = h('input.st-in.study__q', { type: 'search', placeholder: 'Search Study', 'aria-label': 'Search Static Study', autocomplete: 'off', spellcheck: 'false', 'aria-controls': 'study-hits', 'aria-expanded': 'false', dataset: { fk: 'study-search' },
      oninput: e => { S.q = e.target.value; S.hit = 0; runSearch(); },
      onkeydown: e => {
        if (e.key === 'Escape') { if (S.q) { e.preventDefault(); e.stopPropagation(); S.q = ''; searchIn.value = ''; runSearch(); } return; }
        if (!S.hits.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.hit = (S.hit + (e.key === 'ArrowDown' ? 1 : S.hits.length - 1)) % S.hits.length; paintHits(); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(S.hits[S.hit]); }
      } });
    const searchBox = h('div.study__search', h('label.study__qwrap', icon('search'), searchIn), results);
    const body = h('div.study__body');
    const el = h('div.study', h('div.study__head', h('div.study__row', tabsEl, moreBtn, searchBox), summary), body);
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
    const shown = () => TABS.filter(t => PRIMARY.includes(t[0]) || t[0] === S.tab);
    function paintTabs() {
      clear(tabsEl);
      const row = shown();
      for (const [id, label, ic] of row) {
        tabsEl.append(h('button', { type: 'button', role: 'tab', id: `study-tab-${id}`, 'aria-selected': S.tab === id ? 'true' : 'false', 'aria-controls': 'study-panel', tabindex: S.tab === id ? '0' : '-1',
          class: S.tab === id ? 'is-on' : '', dataset: { tab: id }, onclick: () => show(id),
          onkeydown: e => {
            const i = row.findIndex(t => t[0] === S.tab);
            const j = e.key === 'ArrowRight' ? (i + 1) % row.length : e.key === 'ArrowLeft' ? (i + row.length - 1) % row.length : -1;
            if (j >= 0) { e.preventDefault(); show(row[j][0]); const b = tabsEl.querySelector(`[data-tab="${row[j][0]}"]`); if (b) b.focus(); }
          } }, icon(ic), h('span', { text: label })));
      }
      moreBtn.classList.toggle('is-on', !PRIMARY.includes(S.tab));
    }
    /* More: every tab not in the row, in groups (the row's own tabs are there too, for the keyboard) */
    function openMore(btn) {
      const r = btn.getBoundingClientRect();
      const item = id => { const t = TABS.find(x => x[0] === id); return { label: t[1], icon: t[2], checked: S.tab === id ? true : undefined, onClick: () => show(id) }; };
      api.menu([{ header: true, label: 'Plan' }, ...PRIMARY.map(item),
        ...GROUPS.flatMap(([g, ids]) => ['-', { header: true, label: g }, ...ids.map(item)])], r.left, r.bottom + 4, { label: 'All of Static Study' });
    }

    /* ---------- search across everything ---------- */
    function search(q) {
      const k = fold(q).trim();
      if (!k) return [];
      const has = (...parts) => parts.some(p => fold(p).includes(k));
      const out = [];
      const push = (kind, title, sub, tab, o, ic) => { if (out.length < MAX_HITS) out.push({ kind, title, sub, tab, o, ic }); };
      for (const [id, label, ic] of TABS) if (has(label)) push('Tool', label, 'Open the tab', id, null, ic);
      const fc = FC.read();
      for (const d of fc.decks) {
        if (has(d.name)) push('Deck', d.name, `${d.cards.length} card${d.cards.length === 1 ? '' : 's'}`, 'cards', { deck: d.id }, 'layers');
        for (const c of d.cards) {
          if (c.kind === 'rev' || (c.kind === 'cloze' && c.cloze !== FC.clozeNums(c.front)[0])) continue;      /* one hit per thing you wrote */
          if (has(c.front, c.back, c.tags.join(' '))) push('Card', c.kind === 'cloze' ? FC.clozeText(c.front, 0, true) : c.front, `${d.name} · ${c.back || 'cloze'}`.slice(0, 90), 'cards', { deck: d.id, card: c.id }, 'layers');
        }
      }
      const hw = HW.read();
      for (const a of HW.activeList(hw)) {
        const cls = hw.classes.find(c => c.id === a.classId);
        if (has(a.title, a.notes, cls ? cls.name : '')) push('Homework', a.title, `${cls ? `${cls.name} · ` : ''}${a.done ? 'Done' : `Due ${HW.dueText(a)}`}`, 'homework', { assignment: a.id }, 'clipboard');
      }
      for (const e of EXM.read().exams) {
        const tp = e.topics.filter(t => has(t.text));
        if (has(e.subject) || tp.length) push('Test', e.subject, tp.length ? `Topics: ${tp.map(t => t.text).join(', ')}`.slice(0, 90) : `${e.date}${EXM.isPast(e) ? ' · past' : ''}`, 'exams', { exam: e.id }, 'calendar');
      }
      const seenSub = new Set();
      for (const c of TT.read().classes) if (has(c.subject, c.room) && !seenSub.has(fold(c.subject))) { seenSub.add(fold(c.subject)); push('Class', c.subject, `${TT.DAYS[c.day]} ${c.start}${c.room ? ` · Room ${c.room}` : ''}`, 'timetable', { cls: c.id }, 'calendar'); }
      for (const b of BOOKS.read()) if (has(b.title, b.author)) push('Book', b.title, b.author || 'Reading list', 'books', null, 'bookmark');
      const gp = GP.read();
      for (const sem of gp.semesters) for (const c of sem.courses) if (c.name && has(c.name)) push('GPA course', c.name, `${sem.name}${c.grade ? ` · ${c.grade}` : ''}`, 'gpa', { semester: sem.id }, 'calculator');
      return out;
    }
    function runSearch() {
      S.hits = search(S.q);
      if (S.hit >= S.hits.length) S.hit = 0;
      paintHits();
    }
    function paintHits() {
      clear(results);
      const open = !!S.q.trim();
      results.hidden = !open;
      searchIn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) { searchIn.removeAttribute('aria-activedescendant'); return; }
      if (!S.hits.length) { results.append(h('div.study__none', { dataset: { fk: 'study-nohits' }, text: `Nothing in Study matches “${S.q.trim()}”.` })); return; }
      S.hits.forEach((x, i) => results.append(h('button.study__hit', { type: 'button', role: 'option', id: `study-hit-${i}`, 'aria-selected': i === S.hit ? 'true' : 'false', class: i === S.hit ? 'is-on' : '', dataset: { kind: x.kind, fk: 'study-hit' },
        onmousedown: e => e.preventDefault(), onclick: () => pick(x) },
      icon(x.ic), h('span.study__hit-t', h('b', { text: x.title }), h('small', { text: `${x.kind} · ${x.sub}` })))));
      searchIn.setAttribute('aria-activedescendant', `study-hit-${S.hit}`);
      const on = results.querySelector('.is-on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
    function pick(x) {
      if (!x) return;
      S.q = ''; searchIn.value = ''; paintHits();
      if (x.tab === S.tab && S.view && x.o) S.view.open(x.o);
      else show(x.tab, x.o || undefined);
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
      const vctx = { api, win, isActive, changed: paintSummary, go: (t, o) => show(t, o) };
      S.view = VIEWS[tab](host, vctx);
      if (open) S.view.open(open);
      win.setTitle('Static Study');
      win.setSubtitle(`— ${TABS.find(t => t[0] === tab)[1]}`);
      paintTabs();
      paintSummary();
    }
    show(S.tab, opts);

    win.onReopen(o => {
      const t = o && o.quizJoin ? 'quiz' : o && typeof o.shared === 'string' && o.shared ? 'cards' : o && TABS.some(x => x[0] === o.tab) ? o.tab : S.tab;
      if (t !== S.tab) show(t, o); else if (S.view) S.view.open(o);
    });
    /* "/" searches, as in the rest of StaticOS's lists */
    const onKey = e => {
      if (S.dead || !isActive() || e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = document.activeElement;
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
      e.preventDefault();
      searchIn.focus();
    };
    window.addEventListener('keydown', onKey);
    const outside = e => { if (S.q && !searchBox.contains(e.target)) { S.q = ''; searchIn.value = ''; paintHits(); } };
    document.addEventListener('pointerdown', outside, true);

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
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', outside, true);
      if (ro) { try { ro.disconnect(); } catch (e) { /* fine */ } }
      if (S.view) { try { S.view.teardown(); } catch (e) { /* fine */ } }
    };
  },
});
