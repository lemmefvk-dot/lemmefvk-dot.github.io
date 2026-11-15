/* ============================================================
   drills/spelling.js — the Spelling tab of Static Drills.

   StaticOS reads a word aloud with the browser's own voices
   (js/core/speech.js) and you type it. Say it again as often as you
   like. Words come from the five levels in js/drills/words-data.js or
   from lists you type in yourself, and a word you miss comes back
   sooner and more often than one you know (boxes: js/drills/sched.js).

   When this browser can't speak (no speech synthesis, or no voice
   installed) the tab says so in plain words, shows no listen button,
   and offers the one honest fallback: look at the word for three
   seconds, then type it from memory.

   In a sentence: during a round, "Hear it in a sentence" asks the Free
   Dictionary API (js/core/dictionary.js, dictionaryapi.dev) for the
   word and, only when one of its example sentences really contains
   the word, reads that sentence (and shows it with the word blanked
   out). No example, no sentence: it says so; nothing is made up.
   Only asked when the button is pressed.

   After a round the summary goes over each miss (what you typed, the
   letters that differ) and offers a round of just those words.
   Saved on this device ('portal.drillsSpelling').
   ============================================================ */
import * as speech from '../core/speech.js';
import * as dict from '../core/dictionary.js';
import { LEVELS, parseList, BUILT_IN } from './words-data.js';
import { spellGrade, spellWeight, pickRound, BOXES } from './sched.js';

const KEY = 'portal.drillsSpelling';
export const ROUND = 10;
export const LOOK_MS = 3000;
const MAX_LISTS = 12;
const DEFAULT = { v: 1, words: {}, lists: [], rounds: [], turn: 0, p: { list: 'l1', how: 'listen' } };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const MISSED = 'missed';
const REVIEW = 'review';
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An example sentence from a dictionary reply that really uses the word, or ''. */
export function exampleFor(word, entry) {
  if (!entry || entry.status !== 'ok') return '';
  const re = new RegExp(`(^|[^A-Za-z])${reEsc(word)}`, 'i');
  for (const m of entry.meanings || []) for (const d of m.definitions || []) {
    const ex = String(d.example || '').trim();
    if (ex && ex.length <= 240 && re.test(ex)) return ex;
  }
  return '';
}
/** The sentence with the word (and its endings, as in "believes") blanked out. */
export const blankOut = (word, sentence) => sentence.replace(new RegExp(`(^|[^A-Za-z])${reEsc(word)}[A-Za-z]*`, 'gi'), (m, pre) => `${pre}_____`);
/** Where two spellings differ: [{ ch, bad }] for the typed word, letter by letter (case ignored). */
export function letterDiff(typed, word) {
  const a = [...String(typed)], b = [...String(word).toLowerCase()];
  return a.map((ch, i) => ({ ch, bad: ch.toLowerCase() !== b[i] }));
}

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const words = {};
  for (const [w, st] of Object.entries(r.words && typeof r.words === 'object' ? r.words : {})) {
    if (st && Number.isFinite(st.n)) words[w] = { box: Math.max(0, Math.min(BOXES, Number(st.box) || 0)), n: st.n, miss: Number(st.miss) || 0, last: Number(st.last) || 0, lastOk: st.lastOk === true ? true : st.lastOk === false ? false : null };
  }
  const lists = (Array.isArray(r.lists) ? r.lists : []).filter(l => l && l.id && Array.isArray(l.words)).slice(0, MAX_LISTS).map(l => ({ id: String(l.id), name: String(l.name || 'My list').slice(0, 40), words: parseList(l.words.join('\n')) }));
  const p = { ...DEFAULT.p, ...(r.p || {}) };
  if (p.how !== 'look') p.how = 'listen';
  return { v: 1, words, lists, rounds: Array.isArray(r.rounds) ? r.rounds.slice(-100) : [], turn: Number(r.turn) || 0, p };
}

/** The words in a list id: a level, one of the student's own lists, or the words they have missed. */
export function wordsOf(data, id) {
  const lv = LEVELS.find(l => l.id === id);
  if (lv) return lv.words;
  const own = data.lists.find(l => l.id === id);
  if (own) return own.words;
  if (id === MISSED) return Object.entries(data.words).filter(([, st]) => st.miss > 0 && st.box < 3).map(([w]) => w).sort();
  return [];
}

export function mountSpelling(host, ctx) {
  const { api } = ctx;
  const { h, icon, store, bus } = api;
  const S = { data: normalize(store.get(KEY)), dead: false, run: null, voice: 'checking', speechErr: '', spoke: false, timers: new Set(), editing: false, draft: { name: '', text: '' }, listMsg: '' };

  const save = () => { const d = S.data; store.set(KEY, { ...d, words: { ...d.words }, lists: d.lists.map(l => ({ ...l, words: [...l.words] })), rounds: d.rounds.slice(-100), p: { ...d.p } }); };
  const later = (fn, ms) => { const t = setTimeout(() => { S.timers.delete(t); if (!S.dead) fn(); }, ms); S.timers.add(t); return t; };
  const canListen = () => S.voice === 'ok';
  const how = () => (canListen() ? S.data.p.how : 'look');

  const root = h('div.dr-spell', { dataset: { fk: 'spell' } });
  host.appendChild(root);

  /* is there a voice? */
  if (!speech.supported()) { S.voice = 'none'; S.voiceMsg = speech.MISSING; }
  else {
    speech.whenVoices(1500).then(list => {
      if (S.dead) return;
      if (list.length) S.voice = 'ok'; else { S.voice = 'none'; S.voiceMsg = speech.NO_VOICES; }
      if (!S.run) paintHome();
    });
  }
  const off = bus && bus.on ? bus.on('speech:change', st => {
    if (S.dead || !S.spoke) return;
    const msg = st && st.status === 'error' ? st.error : '';
    if (msg !== S.speechErr) { S.speechErr = msg || ''; const el = root.querySelector('[data-fk="sp-speech-err"]'); if (el) el.textContent = S.speechErr; }
  }) : null;

  function say(word) {
    S.spoke = true;
    S.speechErr = '';
    speech.speak(word);
  }

  /* ---------------- home ---------------- */
  function voiceNote() {
    if (S.voice === 'checking') return h('small.dim', { dataset: { fk: 'sp-voice' }, text: 'Looking for a voice to read the words…' });
    if (S.voice === 'none') return h('p.dr-warn', { role: 'status', dataset: { fk: 'sp-voice' }, text: `${S.voiceMsg} Until then you can look at each word for ${LOOK_MS / 1000} seconds and type it from memory.` });
    return null;
  }
  function listOptions() {
    const d = S.data;
    const missed = wordsOf(d, MISSED);
    return [...LEVELS.map(l => [l.id, `${l.name} (${l.words.length} words)`]), ...d.lists.map(l => [l.id, `${l.name}: yours (${l.words.length} words)`]), ...(missed.length ? [[MISSED, `Words I have missed (${missed.length})`]] : [])];
  }
  function paintHome() {
    S.run = null;
    const d = S.data, p = d.p;
    const opts = listOptions();
    if (p.list === REVIEW) p.list = 'l1';
    if (!opts.some(o => o[0] === p.list)) p.list = 'l1';
    const sel = h('select.select.dr-sel', { 'aria-label': 'Word list', dataset: { fk: 'sp-list' }, onchange: e => { p.list = e.target.value; save(); paintHome(); } },
      ...opts.map(([id, label]) => h('option', { value: id, text: label })));
    sel.value = p.list;
    const words = wordsOf(d, p.list);
    const kids = [];
    if (S.summary) kids.push(S.summary);
    kids.push(h('div.dr-card', h('h3.dr-h', { text: 'Spell the word you hear' }), voiceNote(),
      h('div.dr-row', h('small.dim', { text: 'List' }), sel),
      h('small.dim', { dataset: { fk: 'sp-builtin', n: String(BUILT_IN) }, text: `The built-in lists hold ${BUILT_IN} words: ${LEVELS.length} levels of about ${Math.round(BUILT_IN / LEVELS.length)}. That is a short list, so add the words you get at school as your own list below.` }),
      h('div.dr-row', h('small.dim', { text: 'How' }), h('div.dr-chips', { role: 'group', 'aria-label': 'Listen or look' },
        h('button.dr-chip', { type: 'button', class: how() === 'listen' ? 'is-on' : '', 'aria-pressed': how() === 'listen' ? 'true' : 'false', disabled: !canListen(), dataset: { fk: 'sp-how-listen' }, title: canListen() ? '' : 'No voice is available here', onclick: () => { p.how = 'listen'; save(); paintHome(); } }, 'Listen and type'),
        h('button.dr-chip', { type: 'button', class: how() === 'look' ? 'is-on' : '', 'aria-pressed': how() === 'look' ? 'true' : 'false', dataset: { fk: 'sp-how-look' }, onclick: () => { p.how = 'look'; save(); paintHome(); } }, `Look for ${LOOK_MS / 1000} s, then type`))),
      h('div.dr-row', h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'sp-start' }, disabled: !words.length || S.voice === 'checking', onclick: start }, icon('play'), h('span', { text: `Start (${Math.min(ROUND, words.length)} words)` })),
        !words.length ? h('small.dim', { text: 'This list has no words yet.' }) : null)));
    kids.push(listEditor());
    kids.push(progress());
    root.replaceChildren(...kids);
  }

  function listEditor() {
    const d = S.data;
    const name = h('input.dr-in.dr-in--sm', { type: 'text', maxlength: '40', placeholder: 'List name, for example Unit 4', 'aria-label': 'List name', value: S.draft.name, dataset: { fk: 'sp-list-name' }, oninput: e => { S.draft.name = e.target.value; } });
    const area = h('textarea.dr-ta', { rows: '4', placeholder: 'Type or paste words, one on each line (or separated by commas)', 'aria-label': 'Words for the list', spellcheck: 'false', dataset: { fk: 'sp-list-text' }, oninput: e => { S.draft.text = e.target.value; } });
    area.value = S.draft.text;
    return h('div.dr-card', h('h3.dr-h', { text: 'Your own lists' }),
      d.lists.length ? h('ul.dr-lists', ...d.lists.map(l => h('li', { dataset: { fk: `sp-own-${l.id}` } }, h('span', { text: `${l.name}: ${plural(l.words.length, 'word')}` }),
        h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: `sp-del-${l.id}` }, onclick: () => { d.lists = d.lists.filter(x => x.id !== l.id); if (d.p.list === l.id) d.p.list = 'l1'; save(); paintHome(); } }, 'Delete')))) : h('p.dr-none', { text: 'None yet. Add the words from this week\'s spelling test.' }),
      name, area,
      h('div.dr-row', h('button.btn', { type: 'button', dataset: { fk: 'sp-list-save' }, onclick: () => {
        const words = parseList(S.draft.text);
        if (!words.length) { S.listMsg = 'Add at least one word first.'; paintHome(); return; }
        if (d.lists.length >= MAX_LISTS) { S.listMsg = `You can keep ${MAX_LISTS} lists; delete one first.`; paintHome(); return; }
        const id = `c${Date.now().toString(36)}${d.lists.length}`;
        d.lists.push({ id, name: S.draft.name.trim() || 'My list', words });
        d.p.list = id;
        S.draft = { name: '', text: '' };
        S.listMsg = `Saved ${plural(words.length, 'word')}.`;
        save(); paintHome();
      } }, 'Save list'), h('small', { dataset: { fk: 'sp-list-msg' }, role: 'status', text: S.listMsg })));
  }

  function progress() {
    const d = S.data;
    const tried = Object.entries(d.words);
    const card = h('div.dr-card', { dataset: { fk: 'sp-progress' } }, h('h3.dr-h', { text: 'Your progress' }));
    if (!tried.length) { card.append(h('p.dr-none', { dataset: { fk: 'sp-none' }, text: 'Nothing yet. Spell some words and what you know, and what you keep missing, shows up here.' })); return card; }
    const asked = tried.reduce((a, [, st]) => a + st.n, 0), right = tried.reduce((a, [, st]) => a + st.n - st.miss, 0);
    const known = tried.filter(([, st]) => st.box >= 4).length;
    card.append(h('p', { dataset: { fk: 'sp-totals', asked: String(asked), right: String(right) }, text: `${right} right out of ${asked} ${asked === 1 ? 'try' : 'tries'} on ${plural(tried.length, 'word')}. ${plural(known, 'word')} known (spelled right 4 times in a row).` }));
    const weak = tried.filter(([, st]) => st.miss > 0).sort((a, b) => spellWeight(b[1]) - spellWeight(a[1]) || b[1].miss - a[1].miss).slice(0, 8);
    card.append(h('h4.dr-h2', { text: 'Words to work on' }), weak.length ? h('ul.dr-weak', { dataset: { fk: 'sp-weak' } }, ...weak.map(([w, st]) => h('li', { dataset: { word: w }, text: `${w}: missed ${st.miss} of ${st.n}${st.lastOk ? ', right last time' : ''}` })))
      : h('p.dr-none', { text: 'You have not missed any.' }));
    card.append(h('div.dr-row', S.confirmClear
      ? [h('small', { text: 'Clear all spelling progress and your lists?' }), h('button.btn.btn--sm.btn--danger', { type: 'button', dataset: { fk: 'sp-clear-yes' }, onclick: () => { S.data = normalize(null); S.confirmClear = false; save(); paintHome(); } }, 'Clear it'), h('button.btn.btn--sm', { type: 'button', onclick: () => { S.confirmClear = false; paintHome(); } }, 'Keep it')]
      : h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'sp-clear' }, onclick: () => { S.confirmClear = true; paintHome(); } }, 'Clear my spelling progress')));
    return card;
  }

  /* ---------------- a round ---------------- */
  function start() {
    const d = S.data;
    const words = wordsOf(d, d.p.list);
    if (!words.length) return;
    S.summary = null;
    S.run = { words: pickRound(words, d.words, ROUND, Math.random), list: d.p.list, i: 0, ok: 0, missed: [], typed: {}, phase: 'ask', word: '', seen: false, how: how() };
    next();
  }
  /* the summary's "practise these again": exactly the words just missed, in a new order */
  function startReview(words) {
    if (!words.length) return;
    S.summary = null;
    S.run = { words: pickRound(words, {}, words.length, Math.random), list: REVIEW, i: 0, ok: 0, missed: [], typed: {}, phase: 'ask', word: '', seen: false, how: how() };
    next();
  }
  function next() {
    const R = S.run;
    if (R.i >= R.words.length) { finish(); return; }
    R.word = R.words[R.i];
    R.phase = 'ask';
    R.seen = false;
    R.fix = null;
    R.sentence = null;
    paintRun();
    if (R.how === 'listen') say(R.word); else showWord();
  }
  function showWord() {
    const R = S.run, el = root.querySelector('[data-fk="sp-word"]');
    if (!R || !el) return;
    el.textContent = R.word;
    el.classList.add('is-shown');
    later(() => { if (S.run === R && el.isConnected) { el.textContent = '• '.repeat(R.word.length).trim(); el.classList.remove('is-shown'); } }, LOOK_MS);
  }
  function submit() {
    const R = S.run;
    const inp = root.querySelector('[data-fk="sp-in"]');
    if (!R || !inp) return;
    const typed = inp.value.trim();
    if (!typed) return;
    const right = typed.toLowerCase() === R.word.toLowerCase();
    if (R.phase === 'fix') {
      if (right) { R.i++; next(); } else { const fb = root.querySelector('[data-fk="sp-fb"]'); if (fb) fb.textContent = `Type it as shown: ${R.word}`; inp.select(); }
      return;
    }
    const d = S.data;
    d.turn++;
    const k = R.word.toLowerCase();
    d.words[k] = spellGrade(d.words[k], right, d.turn);
    save();
    const fb = root.querySelector('[data-fk="sp-fb"]');
    if (right) {
      R.ok++;
      if (fb) { fb.className = 'dr-fb is-ok'; fb.textContent = 'Right'; }
      R.i++;
      later(next, 350);
      inp.disabled = true;
    } else {
      R.missed.push(R.word);
      R.typed[R.word] = typed;
      R.phase = 'fix';
      if (fb) { fb.className = 'dr-fb is-bad'; fb.replaceChildren(document.createTextNode('The word is '), h('b', { dataset: { fk: 'sp-correct' }, text: R.word }), document.createTextNode(`, you typed ${typed}. Type it correctly to go on.`)); }
      inp.value = '';
      inp.focus();
    }
  }
  function finish() {
    const R = S.run;
    const d = S.data;
    d.rounds.push({ t: Date.now(), list: R.list, n: R.words.length, ok: R.ok });
    save();
    const missed = [...R.missed];
    S.summary = h('div.dr-card.dr-result', { role: 'status', dataset: { fk: 'sp-summary', n: String(R.words.length), ok: String(R.ok) } },
      h('h3.dr-h', { text: R.list === REVIEW ? 'Review finished' : 'Round finished' }),
      h('p', { text: `${R.ok} of ${plural(R.words.length, 'word')} right first time.` }),
      missed.length ? h('p', { dataset: { fk: 'sp-missed' }, text: `Missed: ${missed.join(', ')}. They will come back sooner next time.` }) : h('p', { text: 'No misses.' }),
      missed.length ? h('ul.dr-review', { dataset: { fk: 'sp-review' }, 'aria-label': 'Your mistakes' }, ...missed.map(w => h('li', { dataset: { word: w } },
        h('b', { text: w }), h('span.dim', { text: ' you typed ' }),
        h('span.dr-typed', { 'aria-label': `you typed ${R.typed[w]}` }, ...letterDiff(R.typed[w] || '', w).map(x => (x.bad ? h('mark', { text: x.ch }) : document.createTextNode(x.ch)))),
        (R.typed[w] || '').length !== w.length ? h('small.dim', { text: ` (${R.typed[w].length} letters for ${w.length})` }) : null))) : null,
      missed.length ? h('div.dr-row', h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'sp-review-go' }, onclick: () => startReview(missed) }, icon('refresh'),
        h('span', { text: `Practise ${missed.length === 1 ? 'it' : `these ${missed.length}`} again` }))) : null);
    if (S.spoke) speech.stop();
    S.run = null;
    paintHome();
  }
  function paintRun() {
    const R = S.run;
    if (!R) return;
    const inp = h('input.dr-in', { type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Type the word', dataset: { fk: 'sp-in' },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } });
    root.replaceChildren(h('div.dr-card.dr-run',
      h('div.dr-run__top', h('span', { dataset: { fk: 'sp-count' }, text: `Word ${Math.min(R.i + 1, R.words.length)} of ${R.words.length}` })),
      R.how === 'listen'
        ? h('div.dr-row', h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'sp-hear' }, onclick: () => say(R.word) }, icon('play'), h('span', { text: 'Hear the word again' })),
          h('button.btn', { type: 'button', dataset: { fk: 'sp-sentence' }, onclick: () => sentence(R) }, h('span', { text: 'Hear it in a sentence' })))
        : h('div.dr-row', h('div.dr-look', { dataset: { fk: 'sp-word' }, 'aria-live': 'polite' }), h('button.btn', { type: 'button', dataset: { fk: 'sp-show' }, onclick: showWord }, 'Show it again'),
          h('button.btn', { type: 'button', dataset: { fk: 'sp-sentence' }, onclick: () => sentence(R) }, h('span', { text: 'Show it in a sentence' }))),
      h('p.dr-sentence', { dataset: { fk: 'sp-sent' }, role: 'status' }),
      h('small.dr-warn', { dataset: { fk: 'sp-speech-err' }, role: 'status', text: S.speechErr }),
      R.how === 'listen' && S.speechErr ? h('div.dr-row', h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'sp-fallback' }, onclick: () => { R.how = 'look'; paintRun(); showWord(); } }, `Look at the word for ${LOOK_MS / 1000} s instead`)) : null,
      inp,
      h('div.dr-fb', { dataset: { fk: 'sp-fb' }, role: 'status' }),
      h('div.dr-row', h('button.btn.btn--primary', { type: 'button', dataset: { fk: 'sp-submit' }, onclick: submit }, 'Check'),
        h('button.btn.btn--ghost', { type: 'button', dataset: { fk: 'sp-stop' }, onclick: () => { if (S.spoke) speech.stop(); S.run = null; paintHome(); } }, 'Stop'))));
    inp.focus();
  }

  /* ---- a sentence from the dictionary, only when it has one that uses the word ---- */
  const sentCache = new Map();
  async function sentence(R) {
    const el = () => root.querySelector('[data-fk="sp-sent"]');
    const word = R.word;
    const show = (text, kind) => { const e = el(); if (e && S.run === R && R.word === word) { e.textContent = text; e.dataset.kind = kind; } };
    if (R.sentence) { if (R.how === 'listen' && R.sentence.text) say(R.sentence.text); show(R.sentence.shown, R.sentence.kind); return; }
    show('Looking in the dictionary…', 'wait');
    let entry = sentCache.get(word.toLowerCase());
    if (!entry) { entry = await dict.lookup(word); if (entry.status === 'ok' || entry.status === 'notfound') sentCache.set(word.toLowerCase(), entry); }
    if (S.dead || S.run !== R || R.word !== word) return;
    const ex = exampleFor(word, entry);
    if (ex) {
      R.sentence = { text: ex, kind: 'ok', shown: `“${blankOut(word, ex)}” (example from the Free Dictionary API, dictionaryapi.dev)` };
      if (R.how === 'listen') say(ex);
    } else if (entry.status === 'ok' || entry.status === 'notfound') {
      R.sentence = { text: '', kind: 'none', shown: 'The dictionary has no example sentence for this word.' };
    } else {
      /* offline, rate-limited or unreachable: said as it is, and the button can try again */
      show(entry.status === 'error' ? entry.detail : dict.MESSAGES[entry.status] || 'The dictionary could not be asked.', 'error');
      return;
    }
    show(R.sentence.shown, R.sentence.kind);
    root.querySelector('[data-fk="sp-in"]')?.focus();
  }

  paintHome();

  return {
    teardown() {
      S.dead = true;
      for (const t of S.timers) clearTimeout(t);
      S.timers.clear();
      if (typeof off === 'function') off();
      if (S.spoke) { const st = speech.state(); if (st.status === 'speaking' || st.status === 'paused') speech.stop(); }
    },
    open() { /* nothing to open */ },
  };
}
