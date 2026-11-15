/* ============================================================
   notestools.js — tools inside Notes that work on the note you have
   open: find and replace, read aloud with the sentence lit up,
   "Summarise" and "Quiz me", checklist lines to Tasks, "term ::
   definition" lines to flashcards, and a link to a Calendar event or
   an exam. Notes (js/apps/notes.js) hands this module a few hooks;
   every change to the note goes through Notes' own undoable edit.

   AI (Summarise, Quiz me) runs only when the person presses it, on
   this one note: its title and words go to the model chosen in
   Settings › AI model (js/portal/llm.js), and nothing else. The reply
   is shown as text and goes into the note only when Insert is pressed.

   Read aloud speaks through js/core/speech.js (the browser's own
   voices) and lights the sentence being read with the CSS Highlight
   API, so the note's text is never rewrapped or changed to do it.

   Tasks go to js/core/tasks.js (Static Tasks' lists), flashcards to
   js/core/flashcards.js (Static Study's decks): both only add, and say
   what they added.
   ============================================================ */
import * as NF from '../core/notesfmt.js';
import * as NM from '../core/notesmeta.js';
import * as SP from '../core/speech.js';
import { fold } from '../core/textindex.js';
import { t } from '../core/i18n.js';

const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
const AI_MAX = 12000;          /* characters of the note sent to the model */

/**
 * hooks: { api, note(), file(): a text file is open, blocks(): what the editor shows now,
 *          change(fn): one undoable edit (fn(blocks, caret) -> caret), caret(),
 *          rangeOf(i, o, len) -> Range in the editor, editorHost(): the element showing the note,
 *          mode(), setMode(m), readOnly(): why the note can't be changed ('' when it can),
 *          ta: the text file's textarea, editFile(text), setMeta(note, patch), focus() }
 -> { buttons, aiPanel (Notes puts it in its window), findBar, … }
 */
export function mountTools(hooks) {
  const { api } = hooks;
  const { h, icon } = api;
  const keep = e => e.preventDefault();
  const tool = (ic, label, fn, fk) => h('button.ibtn.tip', { type: 'button', 'data-tip': label, 'aria-label': label.split('  ')[0], dataset: { fk }, onmousedown: keep, onclick: fn }, icon(ic));
  const notify = (title, message = '', extra = {}) => api.notify({ app: 'Notes', icon: 'sticky-note', title, message, ...extra });

  /* ================= find and replace ================= */
  const F = { open: false, hits: [], cur: -1, t: 0 };
  const fIn = h('input.notes-find__in', { type: 'search', placeholder: t('Find in this note'), 'aria-label': t('Find in this note'), spellcheck: 'false', dataset: { fk: 'find-in' } });
  const rIn = h('input.notes-find__in', { type: 'text', placeholder: t('Replace with'), 'aria-label': t('Replace with'), spellcheck: 'false', dataset: { fk: 'replace-in' } });
  const count = h('span.notes-find__n', { role: 'status', 'aria-live': 'polite', dataset: { fk: 'find-count' } });
  const caseBox = h('input', { type: 'checkbox', dataset: { fk: 'find-case' } });
  const prevB = h('button.ibtn', { type: 'button', 'aria-label': t('Previous match'), dataset: { fk: 'find-prev' }, onclick: () => go(-1) }, icon('chevron-up'));
  const nextB = h('button.ibtn', { type: 'button', 'aria-label': t('Next match'), dataset: { fk: 'find-next' }, onclick: () => go(1) }, icon('chevron-down'));
  const repB = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'replace-one' }, onclick: () => replaceOne() }, t('Replace'));
  const allB = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'replace-all' }, onclick: () => replaceAll() }, t('Replace all'));
  const findBar = h('div.notes-find', { role: 'search', 'aria-label': t('Find and replace in this note'), hidden: true },
    h('div.notes-find__row', icon('search'), fIn, count, prevB, nextB,
      h('label.notes-find__case', caseBox, h('span', { text: t('Match case') })),
      h('button.ibtn', { type: 'button', 'aria-label': t('Close find'), dataset: { fk: 'find-close' }, onclick: () => closeFind(true) }, icon('x'))),
    h('div.notes-find__row', icon('refresh'), rIn, repB, allB));

  const exact = () => caseBox.checked;
  function findHits() {
    const q = fIn.value;
    if (!q) return [];
    if (hooks.file()) {
      const v = hooks.ta.value, hay = exact() ? v : fold(v), want = exact() ? q : fold(q);
      const out = [];
      for (let at = hay.indexOf(want); at >= 0 && out.length < 5000; at = hay.indexOf(want, at + Math.max(1, want.length))) out.push({ i: 0, o: at, len: want.length });
      return out;
    }
    return NM.findIn(hooks.blocks(), q, { exact: exact() }).slice(0, 5000);
  }
  function paintHits({ scroll = true } = {}) {
    const n = F.hits.length;
    count.textContent = !fIn.value ? '' : n ? `${F.cur + 1} of ${n}` : 'No matches';
    prevB.disabled = nextB.disabled = !n;
    const ro = hooks.readOnly();
    repB.disabled = allB.disabled = !n || !!ro;
    rIn.disabled = !!ro;
    rIn.title = ro || '';
    if (HL) { CSS.highlights.delete('notes-find'); CSS.highlights.delete('notes-find-now'); }
    if (!n) return;
    if (hooks.file()) {
      const x = F.hits[F.cur];
      if (x && scroll) {
        const ta = hooks.ta;
        ta.setSelectionRange(x.o, x.o + x.len);
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
        ta.scrollTop = Math.max(0, (ta.value.slice(0, x.o).split('\n').length - 3) * lh);
      }
      return;
    }
    if (!HL) {
      /* no Highlight API: the match being looked at is selected instead */
      const x = F.hits[F.cur];
      const r = x && hooks.rangeOf(x.i, x.o, x.len);
      if (r) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      return;
    }
    const all = [], now = [];
    F.hits.forEach((x, k) => { const r = hooks.rangeOf(x.i, x.o, x.len); if (r) (k === F.cur ? now : all).push(r); });
    CSS.highlights.set('notes-find', new Highlight(...all));
    CSS.highlights.set('notes-find-now', new Highlight(...now));
    if (scroll && now[0]) {
      const el = now[0].startContainer.nodeType === 1 ? now[0].startContainer : now[0].startContainer.parentElement;
      el?.scrollIntoView?.({ block: 'nearest' });
    }
  }
  function search({ keep: keepCur = false, scroll = true } = {}) {
    const was = F.cur;
    F.q = fIn.value;
    F.hits = findHits();
    F.cur = F.hits.length ? (keepCur ? Math.min(Math.max(0, was), F.hits.length - 1) : 0) : -1;
    paintHits({ scroll });
  }
  function go(d) {
    if (!F.hits.length) { search(); return; }
    F.cur = (F.cur + d + F.hits.length) % F.hits.length;
    paintHits();
  }
  function replaceOne() {
    if (hooks.readOnly() || F.cur < 0 || !F.hits[F.cur]) return;
    const x = F.hits[F.cur], rep = rIn.value;
    if (hooks.file()) {
      const v = hooks.ta.value;
      hooks.editFile(v.slice(0, x.o) + rep + v.slice(x.o + x.len));
    } else {
      const k = F.cur;
      hooks.change(blocks => { NM.replaceIn(blocks, fIn.value, rep, { exact: exact(), only: k }); return { i: x.i, o: x.o + rep.length }; });
    }
    clearTimeout(F.t);              /* the change's own re-search: done here, now */
    search({ keep: true });
  }
  function replaceAll() {
    if (hooks.readOnly() || !F.hits.length) return;
    const q = fIn.value, rep = rIn.value;
    let n = 0;
    if (hooks.file()) {
      const hits = findHits();
      let v = hooks.ta.value;
      for (const x of [...hits].reverse()) v = v.slice(0, x.o) + rep + v.slice(x.o + x.len);
      n = hits.length;
      hooks.editFile(v);
    } else hooks.change(blocks => { n = NM.replaceIn(blocks, q, rep, { exact: exact() }); });
    clearTimeout(F.t);
    search();
    count.textContent = `Replaced ${plural(n, 'match', 'matches')}`;
  }
  function openFind() {
    if (!hooks.note() && !hooks.file()) return;
    if (!hooks.file() && hooks.mode() !== 'edit' && !hooks.readOnly()) hooks.setMode('edit');
    F.open = true;
    findBar.hidden = false;
    /* what is selected (one line of it) is what to look for */
    const sel = String(window.getSelection?.() || '').split('\n')[0].trim();
    if (sel && sel.length < 200) fIn.value = sel;
    fIn.focus();
    fIn.select();
    search();
  }
  function closeFind(focusNote) {
    F.open = false;
    findBar.hidden = true;
    if (HL) { CSS.highlights.delete('notes-find'); CSS.highlights.delete('notes-find-now'); }
    if (focusNote) hooks.focus?.();
  }
  fIn.addEventListener('input', () => { clearTimeout(F.t); F.t = setTimeout(() => search(), 80); });
  fIn.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(F.t);
    if (F.q !== fIn.value) { search(); return; }      /* typed and pressed Enter at once: the first match */
    go(e.shiftKey ? -1 : 1);
  });
  rIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) replaceAll(); else replaceOne(); } });
  caseBox.addEventListener('change', () => search());
  findBar.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(true); } });
  /* the note changed (typing, a friend's edit): the matches move with it */
  function noteChanged() { if (F.open) { clearTimeout(F.t); F.t = setTimeout(() => search({ keep: true, scroll: false }), 120); } }
  const findBtn = tool('search', `Find and replace  ${api.fmt.isMac ? '⌘⇧F' : 'Ctrl+Shift+F'}`, () => (F.open ? closeFind(true) : openFind()), 'find-btn');

  /* ================= read aloud ================= */
  const R = { mine: false, parts: null, from: 0, found: [] };
  const readBtn = tool('volume-2', 'Read aloud', () => toggleRead(), 'read-btn');
  function readText() {
    const host = hooks.editorHost();
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && host && host.contains(sel.anchorNode)) {
      const t = String(sel).trim();
      if (t) return t;
    }
    if (hooks.file()) return hooks.ta.value;
    return NM.spoken(hooks.blocks());
  }
  function toggleRead() {
    if (R.mine && ['speaking', 'paused'].includes(SP.state().status)) { SP.stop(); return; }
    const text = readText();
    if (!String(text).trim()) { notify('Nothing to read yet', 'Write something in the note first.'); return; }
    R.parts = SP.sentences(text);
    R.mine = true;
    R.from = 0;
    R.found = [];
    SP.speak(text);
    paintRead();
  }
  /* where each sentence is in the note, found in order, never across the one before */
  function sentenceRange(k) {
    if (R.found[k] !== undefined) return R.found[k];
    const host = hooks.editorHost();
    if (!host || hooks.file()) return null;
    const nodes = [];
    let all = '';
    const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement?.closest('.notes__box, .notes__figx') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let t; (t = tw.nextNode());) { nodes.push([t, all.length]); all += t.data; }
    let from = 0;
    for (let j = k - 1; j >= 0; j--) if (R.found[j]) { from = R.found[j].end; break; }
    const words = String(R.parts[k] || '').split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) { R.found[k] = null; return null; }
    const re = new RegExp(words.join('\\s*'), 'g');
    re.lastIndex = from;
    const m = re.exec(all);
    if (!m) { R.found[k] = null; return null; }
    const spot = at => { for (let j = nodes.length - 1; j >= 0; j--) if (nodes[j][1] <= at) return { node: nodes[j][0], off: Math.min(nodes[j][0].data.length, at - nodes[j][1]) }; return null; };
    const a = spot(m.index), z = spot(m.index + m[0].length);
    if (!a || !z) { R.found[k] = null; return null; }
    const r = document.createRange();
    r.setStart(a.node, a.off);
    r.setEnd(z.node, z.off);
    R.found[k] = { r, end: m.index + m[0].length };
    return R.found[k];
  }
  function paintRead(st = SP.state()) {
    const on = R.mine && ['speaking', 'paused'].includes(st.status);
    readBtn.setAttribute('aria-pressed', String(on));
    readBtn.classList.toggle('is-on', on);
    readBtn.setAttribute('aria-label', on ? 'Stop reading' : 'Read aloud');
    readBtn.dataset.tip = on ? 'Stop reading' : 'Read aloud';
    if (!HL) return;
    CSS.highlights.delete('notes-read');
    if (!on || st.index < 0) return;
    const hit = sentenceRange(st.index);
    if (hit) {
      CSS.highlights.set('notes-read', new Highlight(hit.r));
      const el = hit.r.startContainer.parentElement;
      el?.scrollIntoView?.({ block: 'nearest' });
    }
  }
  const offSpeech = api.bus.on('speech:change', st => {
    if (!R.mine) return;
    /* something else started reading (the read-aloud player, Study): not ours any more */
    if (JSON.stringify(st.parts) !== JSON.stringify(R.parts)) { R.mine = false; paintRead(st); return; }
    if (st.status === 'error' && st.error) notify('Read aloud stopped', st.error, { icon: 'alert' });
    if (!['speaking', 'paused'].includes(st.status)) R.mine = false;
    paintRead(st);
  });
  /* the note was redrawn: sentence places are looked up again */
  function readChanged() { if (R.mine) { R.found = []; paintRead(); } }

  /* ================= Summarise and Quiz me ================= */
  const A = { kind: null, ctl: null, text: '', inserted: false };
  const aiOut = h('div.notes-ai__out', { role: 'region', 'aria-label': t('The model’s reply'), 'aria-live': 'polite', dataset: { fk: 'ai-out' } });
  const aiState = h('p.notes-ai__state', { role: 'status', dataset: { fk: 'ai-state' } });
  const aiHead = h('b', { text: '' });
  const aiInsert = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'ai-insert' }, onclick: () => insertReply() }, icon('plus'), h('span', { text: t('Insert at the end of the note') }));
  const aiCopy = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'ai-copy' }, onclick: () => copyReply() }, icon('copy'), h('span', { text: t('Copy') }));
  const aiAgain = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'ai-again' }, onclick: () => ask(A.kind) }, icon('refresh'), h('span', { text: t('Ask again') }));
  const aiFine = h('p.notes-ai__fine');
  const aiPanel = h('div.notes-ai', { role: 'dialog', 'aria-label': t('Ask about this note'), hidden: true },
    h('div.notes-ai__head', icon('sparkles'), aiHead, h('button.ibtn', { type: 'button', 'aria-label': t('Close'), dataset: { fk: 'ai-close' }, onclick: () => closeAI() }, icon('x'))),
    aiState, aiOut, h('div.notes-ai__acts', aiInsert, aiCopy, aiAgain), aiFine);
  aiPanel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeAI(); } });
  const aiBtn = tool('sparkles', 'Summarise or quiz me (AI)', e => aiMenu(e.currentTarget), 'ai-btn');
  function aiMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    api.menu([
      { label: t('Summarise this note'), icon: 'list', onClick: () => ask('sum') },
      { label: t('Quiz me on this note'), icon: 'help-circle', onClick: () => ask('quiz') },
    ], r.left, r.bottom + 4, { label: t('Ask AI about this note') });
  }
  const PROMPTS = {
    sum: 'You summarise a student’s own note. Use only what the note says and add no facts of your own. Reply in plain text in the language of the note: one sentence that sums it up, then 3 to 6 short points, each on its own line starting with "- ".',
    quiz: 'You write practice questions from a student’s own note. Use only what the note says. Reply in plain text in the language of the note: 5 short questions numbered 1. to 5., then a line that says Answers, then the answers numbered the same way.',
  };
  async function ask(kind) {
    const n = hooks.note();
    if (!n) return;
    const body = NM.textForAI(n).trim();
    if (!body) { notify('This note is empty', 'Write something first, then ask.'); return; }
    A.ctl?.abort();
    const ctl = new AbortController();
    A.ctl = ctl;
    A.kind = kind;
    A.text = '';
    A.inserted = false;
    const cut = body.length > AI_MAX;
    const LLM = await import('../portal/llm.js');
    const { describe } = await import('../portal/aimodel.js');
    const who = describe();
    aiHead.textContent = kind === 'quiz' ? 'Quiz on this note' : 'Summary of this note';
    aiOut.textContent = '';
    aiState.textContent = `Asking ${who.name || 'the model'}…`;
    aiFine.textContent = `Only this note’s title and words${cut ? ` (the first ${AI_MAX.toLocaleString()} characters)` : ''} were sent, to ${who.host}, because you pressed the button. A model can get things wrong: check it against your note. Nothing goes into the note unless you press Insert.`;
    paintAI();
    aiPanel.hidden = false;
    try {
      const text = await LLM.stream([
        { role: 'system', content: PROMPTS[kind] },
        { role: 'user', content: `Note title: ${n.title || 'Untitled note'}\n\n${body.slice(0, AI_MAX)}` },
      ], {
        signal: ctl.signal,
        onText: t => { if (A.ctl !== ctl) return; A.text = t; aiOut.textContent = t; },
        onWait: w => { if (A.ctl === ctl) aiState.textContent = w.reason === 'busy' ? 'The model is busy — trying again in a moment…' : 'Waiting for another request to finish…'; },
      });
      if (A.ctl !== ctl) return;
      A.text = text;
      aiOut.textContent = text;
      aiState.textContent = `From ${who.name || 'the model'}.`;
    } catch (err) {
      if (A.ctl !== ctl || err.name === 'AbortError') return;
      aiState.textContent = String(err && err.message || err);
      aiOut.textContent = A.text;
    }
    paintAI();
  }
  function paintAI() {
    const ro = hooks.readOnly();
    aiInsert.disabled = !A.text || A.inserted || !!ro || !hooks.note();
    aiInsert.title = ro || '';
    aiCopy.disabled = !A.text;
    aiAgain.disabled = !A.kind;
  }
  function insertReply() {
    const n = hooks.note();
    if (!A.text || !n || hooks.readOnly()) return;
    const { blocks } = NF.fromMarkdown(A.text);
    const head = { t: 'h2', runs: [{ text: A.kind === 'quiz' ? t('Quiz') : t('Summary'), b: false, i: false }] };
    hooks.change(bl => {
      while (bl.length > 1 && bl[bl.length - 1].t === 'p' && !NF.runsText(bl[bl.length - 1].runs)) bl.pop();
      bl.push({ t: 'p', runs: [] }, head, ...blocks);
      return { i: bl.length - 1, o: 0 };
    });
    A.inserted = true;
    aiState.textContent = 'Inserted at the end of the note. Undo takes it out again.';
    paintAI();
  }
  async function copyReply() {
    try { await navigator.clipboard.writeText(A.text); aiState.textContent = 'Copied.'; }
    catch (e) { aiState.textContent = 'Copying was blocked here — select the text instead.'; }
  }
  function closeAI() { A.ctl?.abort(); A.ctl = null; aiPanel.hidden = true; }

  /* ================= checklist lines -> Tasks ================= */
  async function tasksMenu(anchor) {
    const n = hooks.note();
    if (!n) return;
    const T = await import('../core/tasks.js');
    const c = hooks.caret();
    let lines = NM.checklist(hooks.blocks()).filter(x => !x.done);
    if (c && c.s.i !== c.e.i) { const inSel = lines.filter(x => x.i >= c.s.i && x.i <= c.e.i); if (inSel.length) lines = inSel; }
    if (!lines.length) { notify('No unticked checklist lines', 'Start a line with [ ] to make a checklist item, then send it to Tasks.'); return; }
    const data = T.read();
    const r = anchor.getBoundingClientRect();
    const name = (n.title || 'From Notes').slice(0, 60);
    api.menu([
      ...data.lists.map(l => ({ label: l.name, icon: 'list', onClick: () => send(l.id) })),
      data.lists.length ? '-' : null,
      { label: t('New list “{name}”', { name }), icon: 'list-plus', onClick: () => send(null) },
    ].filter(Boolean), r.left, r.bottom + 4, { label: `Send ${plural(lines.length, 'unticked line')} to which list?` });
    function send(listId) {
      const d = T.read();
      let list = d.lists.find(l => l.id === listId);
      if (!list) { list = T.normList({ name }); d.lists.push(list); if (!d.activeId) d.activeId = list.id; }
      const have = new Set(list.tasks.filter(t => !t.done).map(t => fold(t.text)));
      let added = 0, there = 0;
      for (const x of lines) {
        const text = x.text.slice(0, T.TEXT_MAX);
        if (have.has(fold(text))) { there++; continue; }
        list.tasks.push(T.normTask({ text }));
        have.add(fold(text));
        added++;
      }
      T.write(d);
      notify(added ? `Added ${plural(added, 'task')} to “${list.name}”` : `Nothing new for “${list.name}”`,
        there ? `${plural(there, 'line was', 'lines were')} already on that list.` : 'Ticking them in Tasks doesn’t tick them here.',
        { icon: 'check-circle', actions: api.getApp('tasks') ? [{ label: t('Open Tasks'), onClick: () => api.openApp('tasks') }] : [] });
    }
  }

  /* ================= "term :: definition" -> flashcards ================= */
  async function makeCards() {
    const n = hooks.note();
    if (!n) return;
    const lines = NM.cardLines(hooks.blocks());
    if (!lines.length) { notify('No “term :: definition” lines here', 'Write a term, two colons, then what it means — like “osmosis :: water moving through a membrane”.'); return; }
    const FC = await import('../core/flashcards.js');
    const data = FC.read();
    let deck = n.deck ? data.decks.find(d => d.id === n.deck) : null;
    if (!deck) {
      if (data.decks.length >= FC.MAX_DECKS) { notify('Study has as many decks as it can hold', `Delete one in Study › Flashcards first (the most is ${FC.MAX_DECKS}).`, { icon: 'alert' }); return; }
      deck = FC.normDeck({ name: (n.title || 'Notes').slice(0, 60) });
      data.decks.push(deck);
    }
    const byFront = new Map(deck.cards.map(c => [fold(c.front), c]));
    let added = 0, changed = 0, same = 0, full = 0;
    for (const x of lines) {
      const front = x.front.slice(0, 1000), back = x.back.slice(0, 1000);
      const had = byFront.get(fold(front));
      if (had) { if (had.back === back) same++; else { had.back = back; changed++; } continue; }
      if (deck.cards.length >= FC.MAX_CARDS) { full++; continue; }
      const card = FC.normCard({ front, back });
      deck.cards.push(card);
      byFront.set(fold(front), card);
      added++;
    }
    FC.write(data);
    hooks.setMeta(n, { deck: deck.id });
    const bits = [changed && `${plural(changed, 'card')} got the new definition`, same && `${plural(same, 'card was', 'cards were')} already there`, full && `${full} didn’t fit (a deck holds ${FC.MAX_CARDS})`].filter(Boolean);
    notify(added ? `${plural(added, 'flashcard')} added to “${deck.name}”` : `“${deck.name}” is up to date`, bits.join('; ') || 'Each “term :: definition” line is one card.', {
      icon: 'layers', timeout: 9000,
      actions: api.getApp('study') ? [
        { label: t('Study now'), onClick: () => api.openApp('study', { tab: 'cards', deck: deck.id, start: 'study' }) },
        { label: t('Open deck'), onClick: () => api.openApp('study', { tab: 'cards', deck: deck.id }) },
      ] : [],
    });
  }

  /* ================= a Calendar event or an exam ================= */
  async function eventMenu(anchor) {
    const n = hooks.note();
    if (!n) return;
    const [CAL, EX] = await Promise.all([import('../core/calendar.js'), import('../core/exams.js')]);
    const now = Date.now();
    const evs = CAL.upcoming(now, { days: 90, limit: 15 });
    const exams = EX.read().exams.filter(e => !EX.isPast(e, now)).sort((a, b) => EX.examAt(a) - EX.examAt(b)).slice(0, 15);
    const day = d => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const set = link => { hooks.setMeta(n, { link }); notify(link ? `Linked to ${link.title}` : 'Link removed', link ? 'It shows above the note; click it to open.' : ''); };
    const r = anchor.getBoundingClientRect();
    api.menu([
      { label: t('A Calendar event'), icon: 'calendar', items: evs.length
        ? evs.map(e => ({ label: `${e.title} · ${day(e.on)}`, icon: 'calendar', onClick: () => set({ kind: 'event', id: e.id, title: e.title.slice(0, 120) }) }))
        : [{ label: t('Nothing in the next 90 days'), disabled: true }] },
      { label: t('An exam (Study)'), icon: 'star', items: exams.length
        ? exams.map(e => ({ label: `${e.subject} · ${day(e.date)}`, icon: 'star', onClick: () => set({ kind: 'exam', id: e.id, title: e.subject.slice(0, 120) }) }))
        : [{ label: t('No exams coming up'), disabled: true }] },
      n.link ? '-' : null,
      n.link ? { label: t('Remove the link to {title}', { title: n.link.title }), icon: 'x', onClick: () => set(null) } : null,
    ].filter(Boolean), r.left, r.bottom + 4, { label: t('Link this note to') });
  }
  /** The chip above a linked note: what it is linked to, as it is now. */
  async function linkChip(n) {
    if (!n || !n.link) return null;
    const L = n.link;
    let label = L.title, sub = '', gone = false, open = null;
    try {
      if (L.kind === 'event') {
        const CAL = await import('../core/calendar.js');
        const ev = CAL.byId(L.id);
        if (!ev) gone = true;
        else {
          const d = CAL.nextDay(ev);
          label = ev.title;
          sub = new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + (ev.allDay ? '' : ` · ${CAL.clockText(ev.time)}`);
          open = () => api.openApp('calendar', { event: ev.id, date: d });
        }
      } else if (L.kind === 'exam') {
        const EX = await import('../core/exams.js');
        const e = EX.read().exams.find(x => x.id === L.id);
        if (!e) gone = true;
        else {
          label = e.subject;
          sub = EX.countdown(e).text;
          open = () => api.openApp('study', { tab: 'exams', exam: e.id });
        }
      }
    } catch (err) { gone = true; }
    const chip = h(`span.notes__evlink${gone ? '.is-gone' : ''}`, { dataset: { fk: 'event-link' } },
      h('button.notes__evgo', { type: 'button', disabled: !open, 'aria-label': gone ? t('{label} — it was deleted', { label }) : t('Open {label}', { label }), onclick: () => open?.() },
        icon(L.kind === 'exam' ? 'star' : 'calendar'), h('span', { text: label }), sub ? h('small', { text: sub }) : null, gone ? h('small', { text: 'deleted' }) : null),
      h('button.notes__evx', { type: 'button', 'aria-label': t('Remove the link to {label}', { label }), onclick: () => hooks.setMeta(n, { link: null }) }, icon('x')));
    return chip;
  }

  /* ================= the "more" menu ================= */
  const moreBtn = tool('more-horizontal', 'Tasks, flashcards and links', e => moreMenu(e.currentTarget), 'more-btn');
  function moreMenu(anchor) {
    const n = hooks.note();
    if (!n) return;
    const r = anchor.getBoundingClientRect();
    api.menu([
      { label: t('Send checklist lines to Tasks…'), icon: 'list-plus', onClick: () => tasksMenu(anchor) },
      { label: t('Make flashcards from “term :: definition” lines'), icon: 'layers', onClick: () => makeCards() },
      '-',
      { label: n.link ? t('Change the linked event or exam…') : t('Link to a Calendar event or an exam…'), icon: 'calendar', onClick: () => eventMenu(anchor) },
    ], r.left, r.bottom + 4, { label: t('More for this note') });
  }

  return {
    buttons: [findBtn, readBtn, aiBtn, moreBtn], aiPanel,
    findBar, openFind, closeFind, findOpen: () => F.open, noteChanged,
    readChanged, stopReading: () => { if (R.mine) SP.stop(); },
    linkChip, eventMenu, tasksMenu, makeCards, ask, closeAI,
    /** the note on show changed: anything tied to the last one goes */
    switched() {
      if (R.mine) SP.stop();
      closeAI();
      if (F.open) search({ scroll: false });
    },
    destroy() {
      offSpeech();
      if (R.mine) SP.stop();
      A.ctl?.abort();
      clearTimeout(F.t);
      if (HL) ['notes-find', 'notes-find-now', 'notes-read'].forEach(k => CSS.highlights.delete(k));
    },
  };
}

export default { mountTools };
