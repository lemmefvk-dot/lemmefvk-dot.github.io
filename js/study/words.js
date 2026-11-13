/* ============================================================
   study/words.js — the Words tab of Static Study.

   Word count, reading and speaking time, a case converter and find &
   replace, on text you paste or a copy of a note. The counting rules
   and the two reading rates are in js/core/wordtools.js and are
   printed on the tab. Nothing here changes a note: the text box holds
   a copy, and the result is yours to copy back.
   ============================================================ */
import * as WT from '../core/wordtools.js';
import { noteText } from '../core/notesfmt.js';

let draft = { text: '', find: '', rep: '', matchCase: false, wholeWord: false, regex: false };

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
  const notes = () => (Array.isArray(store.get('notes')) ? store.get('notes') : []);
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
    h('p.st-note', { dataset: { fk: 'rates' }, text: `Reading time uses ${WT.READ_WPM} words per minute (the average for adults reading non-fiction silently); speaking time uses ${WT.SPEAK_WPM} words per minute (a comfortable talking pace). A word is anything between spaces that has a letter or digit in it; a paragraph is any non-empty line; a sentence ends at . ! or ? (not in 3.14, Dr. or J. K.).` }),
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
