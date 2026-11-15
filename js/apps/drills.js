/* ============================================================
   drills.js — Static Drills: short practice tools for school, in one
   window. Math (times tables, quick arithmetic, squares, negative
   numbers, percentages, fractions), Morse code, Geography (flags,
   countries, capitals, US states), Spelling (StaticOS reads the word,
   you type it) and Science (element symbols and groups from the
   Periodic Table's data, SI unit prefixes).

   Why its own app and not four more tabs of Static Study: Study is
   already crowded and other tabs are being added to it, while these
   four are one kind of thing: a round of quick questions that keeps a
   real record of how you do. They share one header and one look; each
   is its own module under js/drills/, loaded with this one when the
   window opens. Nothing here is needed with the window closed.

   Everything shown as progress is counted from answers actually given
   (no streaks, no points, no estimates), and is saved on this device
   through the store ('portal.drills*').

   "Export rounds" writes every finished round, from every tab, as one
   CSV file in Documents (js/drills/export.js), which Sheets opens.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { mountMath } from '../drills/math.js';
import { mountMorse } from '../drills/morse.js';
import { mountGeo } from '../drills/geo.js';
import { mountSpelling } from '../drills/spelling.js';
import { mountScience } from '../drills/science.js';
import { roundRows, toCSV } from '../drills/export.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-drills-css')) {
  const link = document.createElement('link');
  link.id = 'feat-drills-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-drills.css';
  document.head.appendChild(link);
}

const TABS = [['math', 'Math', 'calculator'], ['morse', 'Morse', 'zap'], ['geo', 'Geography', 'globe'], ['spelling', 'Spelling', 'type'], ['science', 'Science', 'thermometer']];
const VIEWS = { math: mountMath, morse: mountMorse, geo: mountGeo, spelling: mountSpelling, science: mountScience };
const CSV_NAME = 'Static Drills rounds.csv';
const TAB_KEY = 'portal.drillsTab';

defineApp({
  id: 'drills',
  name: 'Static Drills',
  icon: 'zap',
  g1: '#7be0b0', g2: '#1f9d78',
  category: 'Productivity',
  keywords: ['drills', 'practice', 'times tables', 'multiplication', 'math', 'arithmetic', 'mental math', 'flash', 'morse', 'morse code', 'cw', 'telegraph', 'geography', 'flags', 'capitals', 'countries', 'us states', 'state capitals', 'quiz', 'spelling', 'spelling bee', 'spell', 'words', 'school', 'homework', 'study', 'fractions', 'percentages', 'squares', 'negative numbers', 'science', 'elements', 'element symbols', 'unit prefixes'],
  desc: 'Math facts, Morse code, flags and capitals, spelling and science: short rounds with a real record of how you do',
  singleton: true,
  win: { w: 860, h: 640, minW: 420, minH: 420 },
  shortcuts: [['1 / 2 / 3 / 4', 'Pick an answer in the geography and science quizzes'], ['Enter', 'Check your answer, or go on to the next question'], ['Space', 'Key the Morse pad (Send mode)']],

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, clear, store } = api;
    const saved = store.get(TAB_KEY);
    const S = { tab: opts && TABS.some(t => t[0] === opts.tab) ? opts.tab : (TABS.some(t => t[0] === saved) ? saved : 'math'), view: null };

    const tabsEl = h('div.tabs.dr__tabs', { role: 'tablist', 'aria-label': 'Static Drills' });
    const body = h('div.dr__body');
    const exportBtn = h('button.btn.btn--sm.btn--ghost.dr__export', { type: 'button', dataset: { fk: 'dr-export' }, title: 'Every finished round, from every tab, as a CSV file in Documents', onclick: () => exportRounds() }, icon('download'), h('span', { text: 'Export rounds' }));
    const el = h('div.dr', h('div.dr__head', tabsEl, exportBtn), body);
    root.appendChild(el);
    const isActive = () => win.el.classList.contains('is-active');

    function paintTabs() {
      clear(tabsEl);
      for (const [id, label, ic] of TABS) {
        tabsEl.append(h('button', { type: 'button', role: 'tab', id: `dr-tab-${id}`, 'aria-selected': S.tab === id ? 'true' : 'false', 'aria-controls': 'dr-panel', tabindex: S.tab === id ? '0' : '-1',
          class: S.tab === id ? 'is-on' : '', dataset: { tab: id }, onclick: () => show(id),
          onkeydown: e => {
            const i = TABS.findIndex(t => t[0] === S.tab);
            const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
            if (j >= 0) { e.preventDefault(); show(TABS[j][0]); const b = tabsEl.querySelector(`[data-tab="${TABS[j][0]}"]`); if (b) b.focus(); }
          } }, icon(ic), h('span', { text: label })));
      }
    }
    function show(tab) {
      if (S.view) { try { S.view.teardown(); } catch (e) { console.error(e); } S.view = null; }
      S.tab = tab;
      try { store.set(TAB_KEY, tab); } catch (e) { /* fine */ }
      clear(body);
      body.setAttribute('role', 'tabpanel');
      body.id = 'dr-panel';
      body.setAttribute('aria-labelledby', `dr-tab-${tab}`);
      const host = h('div.dr__view', { dataset: { view: tab } });
      body.appendChild(host);
      S.view = VIEWS[tab](host, { api, win, isActive });
      win.setTitle('Static Drills');
      win.setSubtitle(`— ${TABS.find(t => t[0] === tab)[1]}`);
      paintTabs();
    }
    show(S.tab);

    win.onReopen(o => { if (o && TABS.some(t => t[0] === o.tab) && o.tab !== S.tab) show(o.tab); });

    /* every round from every tab, as one CSV in Documents (Sheets opens it) */
    function exportRounds() {
      const rows = roundRows({ math: store.get('portal.drillsMath'), spelling: store.get('portal.drillsSpelling'), geo: store.get('portal.drillsGeo'), science: store.get('portal.drillsScience') });
      if (!rows.length) { api.notify({ app: 'Static Drills', icon: 'info', title: 'No rounds yet', message: 'Finish a round on any tab first. Morse counts each letter instead of keeping rounds, so it has none to export.' }); return; }
      const docs = `${api.vfs.HOME}/Documents`;
      try {
        if (!api.vfs.node(docs)) api.vfs.mkdir(docs);
        const path = `${docs}/${CSV_NAME}`;
        if (!api.vfs.write(path, toCSV(rows))) throw new Error('Documents is not available.');
        api.notify({ app: 'Static Drills', icon: 'download', title: `Exported ${rows.length} round${rows.length === 1 ? '' : 's'}`, message: `~/Documents/${CSV_NAME}`,
          actions: api.getApp && api.getApp('sheets') ? [{ label: 'Open in Sheets', onClick: () => api.openFile(path) }] : [] });
      } catch (e) {
        api.notify({ app: 'Static Drills', icon: 'alert', title: 'Could not export', message: String(e.message || e) });
      }
    }

    return () => {
      if (S.view) { try { S.view.teardown(); } catch (e) { console.error(e); } S.view = null; }
    };
  },
});
