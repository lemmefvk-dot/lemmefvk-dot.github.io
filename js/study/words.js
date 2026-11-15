/* ============================================================
   study/words.js — the Words tab of Static Study.

   Word count, reading and speaking time, a word-limit meter, the
   readability grade (with its formula and the numbers that went in),
   the most-used words, a case converter and find & replace, on text
   you paste or a copy of a note. The counting rules and the two
   reading rates are in js/core/wordtools.js and are printed on the
   tab. Nothing here changes a note: the text box holds a copy, and the
   result is yours to copy back.
   ============================================================ */
import * as WT from '../core/wordtools.js';
import { noteText } from '../core/notesfmt.js';

let draft = { text: '', find: '', rep: '', matchCase: false, wholeWord: false, regex: false, limit: '', common: true };
const MAX_LIMIT = 100000;
const num = v => String(Math.round(v * 10) / 10);

export function mountWords(host, ctx) {
  const { api } = ctx;
  const { h, icon, store } = api;
  const S = { undo: null, note: '', replaced: null, dead: false };

  const area = h('textarea.st-ta.st-ta--big', { dataset: { fk: 'words-text' }, rows: '8', placeholder: 'Paste or type text here, or load a note below…', 'aria-label': 'Text to count and change', spellcheck: 'false' });
  area.value = draft.text;

  /* ---- notes ---- */
  const openNoteId = () => {
    const w = api.wm && api.wm.list ? api.wm.list().find(x => x.appId === 'notes') : null;
    return w && w.state && w.state.reopen ? w.state.reopen.noteId : null;
  };
  const notes = () => (Array.isArray(store.get('notes')) ? store.get('notes') : []).filter(n => n && !n.trashed);   /* not Notes' Trash */
  const pick = h('select.select.st-sel', { dataset: { fk: 'note-pick' }, 'aria-label': 'Note to load' });
  function paintNotes() {
    const list = notes();
    const open = openNoteId();
    const key = JSON.stringify([open, list.map(n => [n.id, n.title])]);
    if (key === S.notesKey) return;
    S.notesKey = key;
    const was = pick.value;
    pick.replaceChildren(...(list.length ? list.map(n => h('option', { value: n.id, text: `${n.id === open ? 'Open note: ' : ''}${n.title || 'Untitled'}` })) : [h('option', { value: '', text: 'No notes yet' })]));
    pick.value = list.some(n => n.id === was) ? was : (list.some(n => n.id === open) ? open : (list[0] ? list[0].id : ''));
  }
  paintNotes();
  const loadNote = () => {
    const n = notes().find(x => x.id === pick.value);
    if (!n) return;
    S.undo = area.value;
    area.value = noteText(n);
    note.textContent = `Loaded a copy of “${n.title || 'Untitled'}”. The note itself is not changed.`;
    update();
  };
  const note = h('small.dim', { dataset: { fk: 'note-msg' }, role: 'status' });

  /* ---- counts ---- */
  const stat = (k, label) => h('div.st-wt__stat', h('b', { dataset: { fk: `stat-${k}` }, text: '0' }), h('small', { text: label }));
  const grid = h('div.st-wt__stats', { role: 'group', 'aria-label': 'Counts' },
    stat('words', 'Words'), stat('chars', 'Characters'), stat('chars-ns', 'Characters (no spaces)'), stat('sentences', 'Sentences'),
    stat('paragraphs', 'Paragraphs'), stat('reading', 'Reading time'), stat('speaking', 'Speaking time'));
  const setStat = (k, v) => { grid.querySelector(`[data-fk="stat-${k}"]`).textContent = String(v); };
  function paintStats() {
    const s = WT.stats(area.value);
    setStat('words', s.words); setStat('chars', s.chars); setStat('chars-ns', s.charsNoSpaces); setStat('sentences', s.sentences);
    setStat('paragraphs', s.paragraphs); setStat('reading', s.reading); setStat('speaking', s.speaking);
    paintLimit(s.words); paintRead(); paintTop();
  }

  /* ---- word limit ---- */
  const limitIn = h('input.st-in', { type: 'number', min: '1', max: String(MAX_LIMIT), step: '1', placeholder: 'e.g. 500', 'aria-label': 'Word limit', style: 'width:110px', dataset: { fk: 'limit-in' },
    oninput: e => { draft.limit = e.target.value; paintLimit(WT.countWords(area.value)); } });
  limitIn.value = draft.limit;
  const limitBar = h('i');
  const limitMeter = h('div.st-pbar.st-wt__meter', { role: 'meter', 'aria-label': 'Words used of the limit', 'aria-valuemin': '0', dataset: { fk: 'limit-meter' } }, limitBar);
  const limitText = h('span.st-wt__limit', { role: 'status', dataset: { fk: 'limit-text' } });
  function paintLimit(words) {
    const lim = Math.floor(Number(draft.limit));
    const on = Number.isFinite(lim) && lim >= 1 && lim <= MAX_LIMIT && /^\s*\d+\s*$/.test(String(draft.limit));
    limitMeter.hidden = !on;
    limitMeter.classList.toggle('is-over', on && words > lim);
    if (!on) { limitText.textContent = String(draft.limit).trim() ? `A word limit is a whole number from 1 to ${MAX_LIMIT.toLocaleString()}.` : 'Set a word limit to see how close you are.'; return; }
    limitMeter.setAttribute('aria-valuemax', String(lim)); limitMeter.setAttribute('aria-valuenow', String(Math.min(words, lim)));
    limitBar.style.width = `${Math.min(100, words / lim * 100)}%`;
    limitText.textContent = `${words.toLocaleString()} of ${lim.toLocaleString()} words · ${words > lim ? `${(words - lim).toLocaleString()} over` : words === lim ? 'exactly at the limit' : `${(lim - words).toLocaleString()} to go`}`;
  }

  /* ---- readability ---- */
  const readBox = h('div.st-wt__read', { dataset: { fk: 'read-out' }, 'aria-live': 'polite' });
  function paintRead() {
    const r = WT.readability(area.value);
    readBox.replaceChildren();
    if (!r) { readBox.append(h('p.st-none', { dataset: { fk: 'read-none' }, text: 'Type or load some sentences to see their grade level.' })); return; }
    const wps = r.words / r.sentences, spw = r.syllables / r.words;
    readBox.append(
      h('div.st-eq__answer', h('small', { text: 'Flesch–Kincaid grade level' }), h('b', { dataset: { fk: 'read-grade' }, text: num(r.grade) }),
        h('span', { text: r.grade < 1 ? 'Easier than US grade 1 text.' : r.grade >= 13 ? 'College-level text (US grade 13 or above).' : `About the reading level of US school grade ${Math.floor(r.grade)}.` })),
      h('div.st-eq__math', { dataset: { fk: 'read-formula' }, text: '0.39 × (words ÷ sentences) + 11.8 × (syllables ÷ words) − 15.59' }),
      h('div.st-eq__math', { dataset: { fk: 'read-working' }, text: `0.39 × (${r.words} ÷ ${r.sentences}) + 11.8 × (${r.syllables} ÷ ${r.words}) − 15.59 = 0.39 × ${num(wps)} + 11.8 × ${(Math.round(spw * 100) / 100)} − 15.59 = ${num(r.grade)}` }),
      h('p.st-note', { text: `Syllables are counted by a rule for English (groups of vowels, a silent final e), which is right for most words but not all, so the grade is approximate and only means something for English.${r.words < 100 ? ' With under 100 words it is rougher still.' : ''}` }));
  }

  /* ---- most-used words ---- */
  const commonCb = h('input', { type: 'checkbox', dataset: { fk: 'top-common' }, onchange: e => { draft.common = e.target.checked; paintTop(); } });
  commonCb.checked = draft.common;
  const topBox = h('ol.st-wt__top', { dataset: { fk: 'top-words' }, 'aria-label': 'Most-used words' });
  function paintTop() {
    const all = WT.countWords(area.value);
    const list = WT.topWords(area.value, { skipCommon: draft.common });
    topBox.replaceChildren(...(list.length ? list.map(x => h('li', { dataset: { fk: 'top-word', word: x.word } }, h('b', { text: x.word }), h('span', { text: `${x.count} ${x.count === 1 ? 'time' : 'times'}` }), h('small', { text: `${Math.round(x.count / all * 1000) / 10}% of the words` })))
      : [h('li.st-none', { text: all ? 'Only little words so far.' : 'Nothing to count yet.' })]));
  }

  /* ---- case ---- */
  const undoBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'undo' }, disabled: true, onclick: () => { if (S.undo === null) return; const cur = area.value; area.value = S.undo; S.undo = cur; update(); } }, icon('rotate-ccw'), h('span', { text: 'Undo' }));
  const caseBtn = (k, label) => h('button.btn.btn--sm', { type: 'button', dataset: { fk: `case-${k}` }, onclick: () => { S.undo = area.value; area.value = WT.convertCase(area.value, k); S.replaced = null; update(); } }, h('span', { text: label }));
  const copyMsg = h('small.dim', { role: 'status', dataset: { fk: 'copy-msg' } });
  const copyBtn = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'copy-text' }, onclick: async () => {
    try { await navigator.clipboard.writeText(area.value); copyMsg.textContent = 'Copied.'; } catch (e) { copyMsg.textContent = 'The browser would not let this copy. Select the text and press Ctrl+C.'; }
  } }, icon('copy'), h('span', { text: 'Copy text' }));

  /* ---- find & replace ---- */
  const findIn = h('input.st-in', { type: 'text', dataset: { fk: 'fr-find' }, placeholder: 'Find', 'aria-label': 'Find', spellcheck: 'false' });
  const repIn = h('input.st-in', { type: 'text', dataset: { fk: 'fr-replace-with' }, placeholder: 'Replace with', 'aria-label': 'Replace with', spellcheck: 'false' });
  findIn.value = draft.find; repIn.value = draft.rep;
  const opt = (k, label) => {
    const cb = h('input', { type: 'checkbox', dataset: { fk: `fr-${k === 'matchCase' ? 'case' : k === 'wholeWord' ? 'word' : 'regex'}` }, onchange: () => { draft[k] = cb.checked; S.replaced = null; paintFind(); } });
    cb.checked = draft[k];
    return h('label.st-wt__opt', cb, h('span', { text: label }));
  };
  const status = h('div.st-wt__status', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'fr-status' } });
  const opts = () => ({ matchCase: draft.matchCase, wholeWord: draft.wholeWord, regex: draft.regex });
  function paintFind() {
    status.classList.remove('is-bad');
    if (S.replaced !== null) { status.textContent = S.replaced.error ? S.replaced.error : `Replaced ${S.replaced.count} ${S.replaced.count === 1 ? 'match' : 'matches'}.`; if (S.replaced.error) status.classList.add('is-bad'); return; }
    if (!draft.find) { status.textContent = 'Type something to find.'; return; }
    const r = WT.countMatches(area.value, draft.find, opts());
    if (r.error) { status.textContent = r.error; status.classList.add('is-bad'); return; }
    status.textContent = `${r.count} ${r.count === 1 ? 'match' : 'matches'}.`;
  }
  const replaceBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'fr-go' }, onclick: () => {
    const r = WT.replaceAll(area.value, draft.find, draft.rep, opts());
    if (!r.error && r.count) { S.undo = area.value; area.value = r.text; }
    S.replaced = r;
    update(true);
  } }, icon('refresh'), h('span', { text: 'Replace all' }));

  function update(keepReplaced) {
    draft.text = area.value;
    if (!keepReplaced) S.replaced = null;
    undoBtn.disabled = S.undo === null;
    paintStats(); paintFind();
  }
  area.addEventListener('input', () => update());
  findIn.addEventListener('input', () => { draft.find = findIn.value; S.replaced = null; paintFind(); });
  repIn.addEventListener('input', () => { draft.rep = repIn.value; });

  const root = h('div.st-wt.st-scroll', { dataset: { fk: 'words' } },
    h('div.st-wt__in', area,
      h('div.st-row', pick, h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'note-load' }, onclick: loadNote }, icon('notes'), h('span', { text: 'Load note text' })), note)),
    grid,
    h('div.st-row.st-wt__limitrow', h('label.st-inline', h('span.st-f__l', { text: 'Word limit' }), limitIn), limitMeter, limitText),
    h('p.st-note', { dataset: { fk: 'rates' }, text: `Reading time uses ${WT.READ_WPM} words per minute (the average for adults reading non-fiction silently); speaking time uses ${WT.SPEAK_WPM} words per minute (a comfortable talking pace). A word is anything between spaces that has a letter or digit in it; a paragraph is any non-empty line; a sentence ends at . ! or ? (not in 3.14, Dr. or J. K.).` }),
    h('h3.st-h', { text: 'Readability' }), readBox,
    h('h3.st-h', { text: 'Most-used words' }),
    h('label.st-wt__opt', commonCb, h('span', { text: 'Leave out little words (the, and, of, is…)' })),
    topBox,
    h('h3.st-h', { text: 'Change case' }),
    h('div.st-row', caseBtn('upper', 'UPPER CASE'), caseBtn('lower', 'lower case'), caseBtn('title', 'Title Case'), caseBtn('sentence', 'Sentence case'), undoBtn, copyBtn, copyMsg),
    h('p.st-note', { text: 'Title Case keeps a, an, the, and, but, or, to, of and prepositions like in and on lowercase, except as the first or last word.' }),
    h('h3.st-h', { text: 'Find and replace' }),
    h('div.st-row', findIn, repIn, replaceBtn),
    h('div.st-row', opt('matchCase', 'Match case'), opt('wholeWord', 'Whole word'), opt('regex', 'Regular expression')),
    status);
  host.appendChild(root);
  update();
  const off = api.bus.on('tick:5s', () => { if (!S.dead) paintNotes(); });

  return {
    open() {},
    teardown() { S.dead = true; off(); draft.text = area.value; },
  };
}
