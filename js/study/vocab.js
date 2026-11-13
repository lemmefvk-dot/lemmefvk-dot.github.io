/* ============================================================
   study/vocab.js — the Vocab tab of Static Study.

   A vocabulary list is a flashcard deck (word on the front, meaning
   on the back), so the same decks show up in the Flashcards tab and
   are scheduled by the same spaced-repetition code (js/core/
   flashcards.js: nothing here has a scheduler of its own). This tab
   adds what vocabulary needs:

     · pronunciation: the browser's own voices, through js/core/
       speech.js. The menus list the voices the browser really has,
       named by language; with none, the tab says so and shows no
       speaker buttons;
     · both directions (word -> meaning, meaning -> word, or mixed);
     · two ways to answer: flip the card and grade yourself (Again /
       Hard / Good / Easy), or type the answer (right = Good, wrong =
       Again; capitals and punctuation don't count, accents are
       pointed out; typos are wrong).

   A card has one schedule: reviewing it in either direction updates
   the same due date. All the user's text is shown as text.
   ============================================================ */
import * as FC from '../core/flashcards.js';
import * as speech from '../core/speech.js';
import * as V from '../core/vocab.js';

const GRADE_LABEL = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SLOW = 0.6;

const CSS = `
.vc__note{margin:0;color:var(--ink-2);font-size:var(--fs-12);line-height:1.5;max-width:75ch}
.vc__voices{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--sp-3)}
.vc__words{display:flex;flex-direction:column;border:1px solid var(--line-1);border-radius:var(--r-md)}
.vc__word{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--line-1)}
.vc__word:last-child{border-bottom:0}
.vc__word b,.vc__word span{flex:1;min-width:0;overflow-wrap:anywhere}
.vc__word span{color:var(--ink-2)}
.vc__say{display:inline-flex;gap:4px;align-items:center;flex:none}
.vc__ans{width:min(100%,560px);display:flex;gap:var(--sp-3)}
.vc__ans input{flex:1;font-size:var(--fs-15);height:36px}
.vc__res{width:min(100%,560px);padding:var(--sp-4);border-radius:var(--r-md);border:1px solid var(--line-1);display:flex;flex-direction:column;gap:var(--sp-2)}
.vc__res.is-ok{border-color:rgba(80,200,140,.5)}
.vc__res.is-bad{border-color:rgba(255,80,100,.5)}
.vc__res b{color:var(--ink-0)}
.vc__dirtag{color:var(--ink-3);font-size:var(--fs-11)}
`;

export function mountVocab(host, ctx) {
  const { api, isActive } = ctx;
  const { h, icon, clear } = api;
  const S = {
    data: FC.read(), deckId: '', session: null, dead: false, note: '', noteBad: false,
    voices: speech.voices(), voicesReady: speech.voices().length > 0 || !speech.supported(),
    prefs: V.getPrefs(), auto: false, paste: '', focus: null, spoke: false,
  };
  if (S.data.decks[0]) S.deckId = S.data.decks[0].id;
  const deck = () => S.data.decks.find(d => d.id === S.deckId) || null;
  const canSpeak = () => speech.supported() && S.voices.length > 0;

  /* the voice of each side: what the student chose, else a guess from the voices that exist */
  function voiceFor(side) {
    const d = deck();
    const saved = d && V.getVoices(d.id);
    const uri = saved ? saved[side] : V.guessVoices(S.voices)[side];
    return S.voices.find(v => v.voiceURI === uri) || null;
  }
  function say(text, side, slow) {
    const v = voiceFor(side);
    if (!v || !text) return;
    S.spoke = true;
    speech.speak(text, { voice: v.voiceURI, rate: slow ? SLOW : 0 });
  }

  const mutate = fn => { const data = FC.read(); const r = fn(data); S.data = FC.write(data); return r; };
  function addWords(list) {
    const d = deck();
    if (!d) return 0;
    let n = 0;
    mutate(data => {
      const t = data.decks.find(x => x.id === d.id);
      for (const c of list) { if (t.cards.length >= FC.MAX_CARDS) break; t.cards.push(FC.normCard({ front: c.front, back: c.back })); n++; }
    });
    return n;
  }
  const flash = (text, bad = false) => { S.note = text; S.noteBad = bad; };

  /* ---------- the session ---------- */
  const current = () => {
    const s = S.session, d = s && S.data.decks.find(x => x.id === s.deckId);
    return s && d && !s.finished ? d.cards.find(c => c.id === s.queue[0]) || null : null;
  };
  function start(kind) {
    const d = deck();
    if (!d) return;
    const queue = kind === 'cram' ? FC.shuffled(d.cards) : FC.queue(d.cards);
    S.session = { kind, deckId: d.id, queue, total: queue.length, phase: 'ask', dirs: {}, reviews: 0, right: 0, grades: { again: 0, hard: 0, good: 0, easy: 0 }, finished: !queue.length, last: null };
    speech.stop();
    render();
    autoSay();
  }
  function dirOf(c) {
    const s = S.session;
    if (S.prefs.dir !== 'mixed') return S.prefs.dir;
    if (!s.dirs[c.id]) s.dirs[c.id] = Math.random() < 0.5 ? 'forward' : 'reverse';
    return s.dirs[c.id];
  }
  const sides = c => (dirOf(c) === 'forward' ? { prompt: c.front, answer: c.back, ps: 'term', as: 'meaning' } : { prompt: c.back, answer: c.front, ps: 'meaning', as: 'term' });
  function autoSay() { const c = current(); if (S.auto && c && canSpeak() && S.session.phase === 'ask') { const x = sides(c); say(x.prompt, x.ps); } }
  function reveal() { const s = S.session; if (s && !s.finished && s.phase === 'ask' && S.prefs.mode === 'flip') { s.phase = 'result'; render(); } }
  function record(c, g) {
    const s = S.session;
    if (s.kind === 'review') { FC.review(s.deckId, c.id, g); S.data = FC.read(); s.grades[g]++; }
    s.reviews++;
    if (g !== 'again') s.right++;
    s.queue.shift();
    if (g === 'again') s.queue.push(c.id);
  }
  function grade(g) {
    const s = S.session, c = current();
    if (!s || !c || s.phase !== 'result' || S.prefs.mode !== 'flip' || !FC.GRADES.includes(g)) return;
    record(c, g);
    next();
  }
  function submit(text) {
    const s = S.session, c = current();
    if (!s || !c || s.phase !== 'ask' || S.prefs.mode !== 'type') return;
    const x = sides(c);
    const r = V.checkAnswer(text, x.answer);
    s.last = { ...r, typed: String(text), answer: x.answer, as: x.as, id: c.id };
    s.phase = 'result';
    s.pending = { c, g: r.ok ? 'good' : 'again' };
    render();
  }
  function proceed() {
    const s = S.session;
    if (!s || s.phase !== 'result' || S.prefs.mode !== 'type' || !s.pending) return;
    const { c, g } = s.pending;
    s.pending = null;
    record(c, g);
    next();
  }
  function next() {
    const s = S.session;
    s.phase = 'ask';
    s.last = null;
    if (!s.queue.length) s.finished = true;
    speech.stop();
    render();
    autoSay();
  }
  function end() { S.session = null; speech.stop(); render(); }

  /* ---------- the page ---------- */
  const body = h('div.app__content.st-scroll.st-quiz__pane.vc', { dataset: { fk: 'vocab' } });
  host.append(h('div.vc', h('style', { text: CSS }), body));

  function sayButtons(text, side, fk) {
    if (!canSpeak() || !voiceFor(side)) return null;
    return h('span.vc__say',
      h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: fk || 'vocab-say', side }, 'aria-label': `Hear ${text}`, title: 'Hear it', onclick: () => say(text, side, false) }, icon('volume-2')),
      side === 'term' ? h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'vocab-say-slow', side }, 'aria-label': `Hear ${text} slowly`, title: 'Hear it slowly', onclick: () => say(text, side, true) }, h('span', { text: 'Slow' })) : null);
  }

  function voiceNote() {
    if (!speech.supported()) return speech.MISSING;
    if (!S.voicesReady) return 'Looking for voices…';
    if (!S.voices.length) return speech.NO_VOICES;
    return '';
  }

  function renderSession(s) {
    if (s.finished) {
      body.append(h('div.empty.st-done', { dataset: { fk: 'vocab-done' } }, icon('check-circle'),
        h('b', { text: s.total ? (s.kind === 'cram' ? 'Practice round finished' : 'Session finished') : 'Nothing to review right now' }),
        h('small', { text: s.total ? `${s.right} of ${plural(s.reviews, 'answer')} right${s.kind === 'review' ? `: ${FC.GRADES.map(g => `${s.grades[g]} ${GRADE_LABEL[g].toLowerCase()}`).join(', ')}.` : '.'}` : 'No words are due and there are no new ones. Come back when one is due, or use Practice all.' }),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'vocab-back' }, onclick: end }, h('span', { text: 'Back to the list' }))));
      return;
    }
    const c = current();
    if (!c) { end(); return; }
    const x = sides(c);
    const type = S.prefs.mode === 'type';
    const dir = dirOf(c) === 'forward' ? 'word → meaning' : 'meaning → word';
    const show = s.phase === 'result';
    const parts = [];
    parts.push(h('div.st-face', { dataset: { fk: 'vocab-face' }, class: show ? 'is-back' : 'is-front' },
      h('small.st-face__side', { text: show ? (x.as === 'term' ? 'Word' : 'Meaning') : (x.ps === 'term' ? 'Word' : 'Meaning') }),
      h('div.st-face__text', { dataset: { fk: 'vocab-prompt' }, text: x.prompt }),
      sayButtons(x.prompt, x.ps, 'vocab-say-prompt'),
      show && !type ? h('div.st-face__text', { dataset: { fk: 'vocab-answer' }, text: x.answer }) : null,
      show && !type ? sayButtons(x.answer, x.as, 'vocab-say-answer') : null,
      h('small.vc__dirtag', { text: dir })));
    if (s.phase === 'ask') {
      if (type) {
        const input = h('input.st-in', { type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-label': `Type the ${x.as === 'term' ? 'word' : 'meaning'}`, placeholder: `Type the ${x.as === 'term' ? 'word' : 'meaning'}`, dataset: { fk: 'vocab-input' } });
        parts.push(h('form.vc__ans', { onsubmit: e => { e.preventDefault(); submit(input.value); } }, input,
          h('button.btn.btn--primary', { type: 'submit', dataset: { fk: 'vocab-submit' } }, h('span', { text: 'Check' }))));
        S.focus = input;
      } else {
        parts.push(h('button.btn.btn--primary.st-flip', { type: 'button', dataset: { fk: 'vocab-flip' }, onclick: reveal }, h('span', { text: 'Show answer' }), h('kbd', { text: 'Space' })));
      }
    } else if (type) {
      const r = s.last;
      const msg = r.ok ? (r.exact ? 'Correct.' : 'Correct, but watch the accents.') : 'Not quite.';
      parts.push(h('div.vc__res', { class: r.ok ? 'is-ok' : 'is-bad', role: 'status', dataset: { fk: 'vocab-result', ok: r.ok ? '1' : '0', accents: r.accents ? '1' : '0' } },
        h('b', { text: msg }),
        h('div', { text: `You typed: ${r.typed || '(nothing)'}` }),
        h('div', { dataset: { fk: 'vocab-expected' }, text: `${r.ok && r.exact ? 'Answer' : 'The answer is'}: ${r.answer}` }),
        sayButtons(r.answer, x.as, 'vocab-say-answer'),
        h('small.dim', { text: r.ok ? 'Counted as Good.' : 'Counted as Again: it will come back in this session.' })));
      const nb = h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'vocab-next' }, onclick: proceed }, h('span', { text: 'Next' }), h('kbd', { text: 'Enter' }));
      parts.push(nb);
      S.focus = nb;
    } else {
      parts.push(h('div.st-grades', { role: 'group', 'aria-label': 'How well did you know it?' },
        FC.GRADES.map((g, i) => {
          const nx = FC.schedule(c, g);
          return h('button.btn.st-g', { type: 'button', class: `st-g--${g}`, dataset: { fk: `vocab-grade-${g}` }, onclick: () => grade(g) },
            h('b', { text: GRADE_LABEL[g] }), h('small', { text: s.kind === 'cram' ? '' : g === 'again' ? 'again today' : FC.intervalText(nx.interval) }), h('kbd', { text: String(i + 1) }));
        })));
    }
    const left = s.queue.length;
    body.append(h('div.st-study', { 'aria-live': 'polite' }, ...parts,
      h('div.st-row.st-study__tools',
        h('span.st-prog', { dataset: { fk: 'vocab-left' }, text: `${plural(left, 'word')} left` }),
        h('span.st-spacer'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'vocab-end' }, onclick: end }, h('span', { text: 'End session' })))));
  }

  function renderList() {
    const d = deck();
    const fresh = S.data.decks.length === 0;
    const sel = h('select.select.st-sel', { 'aria-label': 'Vocabulary list', dataset: { fk: 'vocab-deck' }, onchange: e => { S.deckId = e.target.value; S.note = ''; render(); } },
      S.data.decks.map(x => h('option', { value: x.id, text: `${x.name} (${plural(x.cards.length, 'word')})`, selected: x.id === S.deckId })));
    const nameIn = h('input.st-in', { type: 'text', maxlength: '60', placeholder: 'New list, e.g. Spanish unit 3', 'aria-label': 'Name of a new list', dataset: { fk: 'vocab-newname' } });
    const newList = h('form.st-row', { onsubmit: e => { e.preventDefault(); const nm = nameIn.value.trim(); if (!nm) return; const nd = FC.addDeck(nm); if (nd) { S.data = FC.read(); S.deckId = nd.id; flash(`Made the list “${nd.name}”.`); } render(); } },
      nameIn, h('button.btn.btn--sm', { type: 'submit', dataset: { fk: 'vocab-newlist' } }, icon('plus'), h('span', { text: 'Make list' })));
    body.append(h('div.app__title', { text: 'Vocabulary trainer' }),
      h('p.vc__note', { text: 'A list is a flashcard deck, so it is also in the Flashcards tab and uses the same spaced-repetition schedule. Add words, hear them, then review them by flipping or typing.' }),
      h('div.st-row', fresh ? h('span.dim', { text: 'No lists yet.' }) : h('label.st-f', h('span.st-f__l', { text: 'List' }), sel), newList));
    if (S.note) body.append(h('div', { class: S.noteBad ? 'st-issue' : 'st-flash', role: S.noteBad ? 'alert' : 'status', dataset: { fk: 'vocab-note' } }, icon(S.noteBad ? 'alert' : 'check'), h('span', { text: S.note })));
    if (!d) return;

    /* add words */
    const f1 = h('input.st-in', { type: 'text', maxlength: '300', placeholder: 'Word', 'aria-label': 'Word', dataset: { fk: 'vocab-add-front' } });
    const f2 = h('input.st-in', { type: 'text', maxlength: '300', placeholder: 'Meaning', 'aria-label': 'Meaning', dataset: { fk: 'vocab-add-back' } });
    const addIt = () => {
      const front = f1.value.trim(), back = f2.value.trim();
      if (!front || !back) { flash('A word needs both the word and its meaning.', true); render(); return; }
      if (addWords([{ front, back }])) flash(`Added “${front}”.`); else flash('This list is full.', true);
      S.wantFront = true;
      render();
    };
    S.focusAdd = f1;
    body.append(h('form.st-add', { onsubmit: e => { e.preventDefault(); addIt(); } },
      h('div.st-add__cols', h('label.st-f', h('span.st-f__l', { text: 'Word' }), f1), h('label.st-f', h('span.st-f__l', { text: 'Meaning' }), f2)),
      h('div.st-row', h('button.btn.btn--primary.btn--sm', { type: 'submit', dataset: { fk: 'vocab-add' } }, icon('plus'), h('span', { text: 'Add word' })),
        h('small.dim', { text: 'Several meanings: separate them with ; or /. Typed answers accept any one.' }))));

    /* paste or import */
    const ta = h('textarea.st-ta', { rows: '3', 'aria-label': 'Paste words here, one per line: word, meaning', placeholder: 'perro, dog\ngato, cat', dataset: { fk: 'vocab-paste' }, oninput: e => { S.paste = e.target.value; prev(); } });
    ta.value = S.paste;
    const info = h('small.dim', { role: 'status', dataset: { fk: 'vocab-paste-info' } });
    const go = h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'vocab-import' }, onclick: () => {
      const q = FC.parseImport(S.paste, FC.MAX_CARDS - d.cards.length);
      const n = addWords(q.cards);
      S.paste = '';
      flash(`Imported ${plural(n, 'word')}${q.skipped ? `; ${plural(q.skipped, 'line')} skipped (a line needs a word and a meaning)` : ''}.`, !n);
      render();
    } }, icon('upload'), h('span', { text: 'Import words' }));
    function prev() { const q = S.paste.trim() ? FC.parseImport(S.paste) : null; info.textContent = q ? `${plural(q.cards.length, 'word')} found${q.skipped ? `, ${plural(q.skipped, 'line')} skipped` : ''}.` : 'One word per line: the word, a comma or tab, its meaning.'; go.disabled = !q || !q.cards.length; }
    prev();
    const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain', 'aria-label': 'Or choose a CSV or TSV file', dataset: { fk: 'vocab-file' },
      onchange: async e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (f.size > 4 * 1024 * 1024) { flash('That file is over 4 MB; a word list is much smaller.', true); render(); return; }
        S.paste = await f.text();
        render();
      } });
    body.append(h('div.st-add', h('div.side__label', { text: 'Import a list' }), ta, h('div.st-row', go, file, info)));

    /* pronunciation */
    const vn = voiceNote();
    const voiceSel = side => {
      const cur = voiceFor(side);
      return h('label.st-f', h('span.st-f__l', { text: side === 'term' ? 'Voice for the word' : 'Voice for the meaning' }),
        h('select.select.st-sel', { dataset: { fk: `vocab-voice-${side}` }, 'aria-label': side === 'term' ? 'Voice for the word' : 'Voice for the meaning',
          onchange: e => { const have = V.getVoices(d.id) || V.guessVoices(S.voices); V.setVoices(d.id, { ...have, [side]: e.target.value }); render(); } },
          h('option', { value: '', text: 'No speech', selected: !cur }),
          V.languages(S.voices).map(l => h('optgroup', { label: l.name }, l.voices.map(v => h('option', { value: v.voiceURI, text: V.describeVoice(v), selected: !!cur && cur.voiceURI === v.voiceURI }))))));
    };
    body.append(h('div.st-add', h('div.side__label', { text: 'Pronunciation' }),
      vn ? h('div.st-issue', { role: 'status', dataset: { fk: 'vocab-voice-note' } }, icon('alert'), h('span', { text: vn })) : h('div.vc__voices', voiceSel('term'), voiceSel('meaning')),
      vn ? null : h('p.vc__note', { text: 'The languages listed are the voices this browser has. Add more in your computer’s speech settings and reopen this tab.' })));

    /* practice */
    const due = FC.counts(d.cards).due, fresh2 = FC.counts(d.cards).fresh;
    const queued = FC.queue(d.cards).length;
    const mk = (fk, key, label, opts) => h('label.st-f', h('span.st-f__l', { text: label }), h('select.select.st-sel', { 'aria-label': label, dataset: { fk }, onchange: e => { S.prefs = { ...S.prefs, [key]: e.target.value }; V.setPrefs({ [key]: e.target.value }); } },
      opts.map(([v, t]) => h('option', { value: v, text: t, selected: S.prefs[key] === v }))));
    body.append(h('div.st-add', h('div.side__label', { text: 'Practise' }),
      h('div.vc__voices', mk('vocab-dir', 'dir', 'Direction', [['forward', 'Word → meaning'], ['reverse', 'Meaning → word'], ['mixed', 'Mixed']]), mk('vocab-mode', 'mode', 'Answer by', [['flip', 'Flipping the card'], ['type', 'Typing the answer']])),
      h('label.st-row', h('input', { type: 'checkbox', checked: S.auto, dataset: { fk: 'vocab-auto' }, onchange: e => { S.auto = e.target.checked; } }), h('span', { text: 'Say each prompt when it appears' })),
      h('div.st-row',
        h('button.btn.btn--primary', { type: 'button', disabled: !d.cards.length, dataset: { fk: 'vocab-start' }, onclick: () => start('review') }, icon('play'), h('span', { text: `Review (${plural(queued, 'word')}: ${due} due, ${fresh2} new)` })),
        h('button.btn', { type: 'button', disabled: !d.cards.length, dataset: { fk: 'vocab-cram' }, onclick: () => start('cram') }, h('span', { text: 'Practise all' }))),
      h('small.dim', { text: 'Review follows the spaced-repetition schedule. Practise all goes through every word and leaves the schedule alone.' })));

    /* the words */
    body.append(h('div.side__label', { text: `Words (${d.cards.length})` }),
      d.cards.length ? h('div.vc__words', { dataset: { fk: 'vocab-words' } }, d.cards.map(c => h('div.vc__word', { dataset: { fk: 'vocab-word' } },
        h('b', { text: c.front }), sayButtons(c.front, 'term'), h('span', { text: c.back }), sayButtons(c.back, 'meaning'),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'vocab-del' }, 'aria-label': `Delete ${c.front}`, title: 'Delete', onclick: () => { mutate(data => { const t = data.decks.find(x => x.id === d.id); t.cards = t.cards.filter(x => x.id !== c.id); }); flash(`Deleted “${c.front}”.`); render(); } }, icon('trash')))))
        : h('p.st-none', { text: 'No words yet. Add one above.' }));
  }

  function render() {
    if (S.dead) return;
    const wantFront = S.wantFront; S.wantFront = false;
    S.focus = null; S.focusAdd = null;
    const keepY = body.scrollTop;
    clear(body);
    if (S.session) renderSession(S.session); else renderList();
    ctx.changed && ctx.changed();
    const f = S.focus, add = S.focusAdd;
    body.scrollTop = keepY;
    requestAnimationFrame(() => {
      try {
        if (S.dead) return;
        if (S.session && f && f.isConnected) f.focus({ preventScroll: true });
        else if (!S.session && wantFront && add && add.isConnected) add.focus({ preventScroll: true });
      } catch (e) { /* fine */ }
    });
  }

  const onKey = e => {
    if (S.dead || !isActive() || !S.session || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (document.activeElement || {}).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const s = S.session;
    if (s.finished) return;
    if (e.key === ' ' && S.prefs.mode === 'flip' && s.phase === 'ask') { e.preventDefault(); reveal(); }
    else if (/^[1-4]$/.test(e.key) && S.prefs.mode === 'flip' && s.phase === 'result') { e.preventDefault(); grade(FC.GRADES[+e.key - 1]); }
    else if (e.key === 'Escape') end();
  };
  window.addEventListener('keydown', onKey);

  /* browsers that load voices late */
  const offVoices = api.bus.on('speech:voices', list => { S.voices = list || speech.voices(); S.voicesReady = true; if (!S.session) render(); });
  if (!S.voicesReady) speech.whenVoices(1500).then(list => { if (S.dead) return; S.voices = list; S.voicesReady = true; if (!S.session) render(); });
  render();

  return {
    open() {},
    teardown() {
      S.dead = true;
      offVoices();
      window.removeEventListener('keydown', onKey);
      if (S.spoke) speech.stop();
    },
    peek: () => ({ deckId: S.deckId, voices: S.voices.length, session: S.session && { kind: S.session.kind, left: S.session.queue.length, phase: S.session.phase, finished: S.session.finished } }),
  };
}
