/* ============================================================
   study/dict.js — the Dictionary tab of Static Study.

   Definitions, parts of speech, examples, synonyms and antonyms from
   the Free Dictionary API (js/core/dictionary.js), the pronunciation
   when the service gives one, and the words you looked up last.
   Offline, a rate limit or a service error is said plainly; a
   definition is never made up. Recent words: store('portal.dictRecent').

   Add to vocab deck puts the word on a flashcard (front: the word, back:
   the definition you picked, which you can edit first) in a deck of your
   choice, so it comes up in the Vocab and Flashcards tabs. "In a
   sentence" is offered only when the service gave an example for that
   definition, and goes on a line of its own (Vocab's typed answers
   leave that line out).
   ============================================================ */
import * as D from '../core/dictionary.js';
import * as FC from '../core/flashcards.js';

const KEY = 'portal.dictRecent';
const MAX = 12;
const NEW_DECK = 'Vocabulary';
let lastDeck = '';

export function mountDict(host, ctx) {
  const { api } = ctx;
  const { h, icon, store, clear } = api;
  const S = { seq: 0, dead: false, audio: null, last: null, add: null, added: '', recent: (Array.isArray(store.get(KEY)) ? store.get(KEY) : []).filter(w => typeof w === 'string').slice(0, MAX) };

  const input = h('input.st-in', { type: 'text', dataset: { fk: 'dict-input' }, placeholder: 'Look up a word', 'aria-label': 'Word to look up', spellcheck: 'false', autocomplete: 'off',
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(input.value); } } });
  const goBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'dict-go' }, onclick: () => go(input.value) }, icon('search'), h('span', { text: 'Look up' }));
  const out = h('div.st-d__out', { dataset: { fk: 'dict-result' }, 'aria-live': 'polite' });
  const recentBox = h('div.st-d__recent', { dataset: { fk: 'dict-recents' } });

  function remember(word) {
    S.recent = [word, ...S.recent.filter(w => w.toLowerCase() !== word.toLowerCase())].slice(0, MAX);
    try { store.set(KEY, S.recent); } catch (e) { /* fine */ }
    paintRecent();
  }
  function paintRecent() {
    clear(recentBox);
    if (!S.recent.length) { recentBox.append(h('small.dim', { dataset: { fk: 'dict-recents-none' }, text: 'Words you look up are listed here.' })); return; }
    recentBox.append(h('small', { text: 'Recent' }),
      ...S.recent.map(w => h('button.chip', { type: 'button', dataset: { fk: 'dict-recent' }, onclick: () => go(w) }, h('span', { text: w }))),
      h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'dict-clear' }, onclick: () => { S.recent = []; try { store.set(KEY, []); } catch (e) { /* fine */ } paintRecent(); } }, h('span', { text: 'Clear' })));
  }

  function play(url) {
    try {
      if (S.audio) S.audio.pause();
      S.audio = new Audio(url);
      const p = S.audio.play();
      if (p && p.catch) p.catch(() => note('The pronunciation could not be played.'));
    } catch (e) { note('The pronunciation could not be played.'); }
  }
  function note(text) {
    const el = out.querySelector('[data-fk="dict-audio-msg"]');
    if (el) el.textContent = text;
  }
  const chips = (words, kind) => h('div.st-d__chips', { dataset: { fk: `dict-${kind}-list` } },
    h('small', { text: kind === 'syn' ? 'Synonyms' : 'Antonyms' }),
    ...words.map(w => h('button.chip', { type: 'button', dataset: { fk: `dict-${kind}` }, onclick: () => go(w) }, h('span', { text: w }))));

  /* ---------- into a vocab deck ---------- */
  function addPanel(r) {
    const A = S.add;
    const decks = FC.read().decks;
    if (!decks.some(d => d.id === A.deck)) A.deck = decks.some(d => d.id === lastDeck) ? lastDeck : (decks.find(d => /vocab/i.test(d.name)) || decks[0] || { id: '' }).id;
    const sel = h('select.select.st-sel', { 'aria-label': 'Vocab deck', dataset: { fk: 'dict-add-deck' }, onchange: e => { A.deck = e.target.value; } },
      decks.map(d => h('option', { value: d.id, text: `${d.name} (${d.cards.length} card${d.cards.length === 1 ? '' : 's'})`, selected: d.id === A.deck })),
      h('option', { value: '', text: `A new deck: ${NEW_DECK}`, selected: !A.deck }));
    const meaning = h('input.st-in', { type: 'text', maxlength: '300', 'aria-label': 'Meaning on the card', dataset: { fk: 'dict-add-meaning' }, oninput: e => { A.meaning = e.target.value; } });
    meaning.value = A.meaning;
    const ex = A.example ? h('label.st-row', h('input', { type: 'checkbox', checked: A.withEx, dataset: { fk: 'dict-add-ex' }, onchange: e => { A.withEx = e.target.checked; } }),
      h('span', { text: `In a sentence: “${A.example}”` })) : null;
    return h('section.st-d__add', { 'aria-label': `Add ${r.word || A.word} to a vocab deck`, dataset: { fk: 'dict-add-panel' } },
      h('b', { text: `Add “${A.word}” to a vocab deck` }),
      h('label.st-f', h('span.st-f__l', { text: 'Meaning on the card' }), meaning), ex,
      h('div.st-row', h('label.st-inline', h('span', { text: 'Into' }), sel), h('span.st-spacer'),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'dict-add-cancel' }, onclick: () => { S.add = null; showResult(r); } }, h('span', { text: 'Cancel' })),
        h('button.btn.btn--sm.btn--primary', { type: 'button', dataset: { fk: 'dict-add-go' }, onclick: () => addCard(r) }, icon('plus'), h('span', { text: 'Add card' }))),
      A.error ? h('p.st-issue', { role: 'alert', dataset: { fk: 'dict-add-error' } }, icon('alert'), h('span', { text: A.error })) : null);
  }
  function addCard(r) {
    const A = S.add;
    const meaning = A.meaning.trim();
    if (!meaning) { A.error = 'A card needs a meaning on the back.'; showResult(r); return; }
    const data = FC.read();
    let d = A.deck && data.decks.find(x => x.id === A.deck);
    if (!d) {
      if (data.decks.length >= FC.MAX_DECKS) { A.error = `Static Study holds up to ${FC.MAX_DECKS} decks. Pick one of yours.`; showResult(r); return; }
      d = data.decks.find(x => x.name === NEW_DECK) || null;
      if (!d) { d = FC.normDeck({ name: NEW_DECK }); data.decks.push(d); }
    }
    if (d.cards.length >= FC.MAX_CARDS) { A.error = `“${d.name}” is full (${FC.MAX_CARDS} cards).`; showResult(r); return; }
    const back = A.example && A.withEx ? `${meaning}\nIn a sentence: “${A.example}”` : meaning;
    d.cards.push(...FC.makeCards({ front: A.word, back }));
    FC.write(data);
    lastDeck = d.id;
    S.add = null;
    S.added = `Added “${A.word}” to “${d.name}”. It is a new card: it comes up in Vocab and Flashcards from today.`;
    S.addedDeck = d.id;
    showResult(r);
    ctx.changed && ctx.changed();
  }

  function showResult(r) {
    S.last = r;
    clear(out);
    if (r.status !== 'ok') {
      const text = r.status === 'error' ? `${r.detail} Nothing was looked up; try again in a moment.` : D.MESSAGES[r.status];
      out.append(h('div.st-issue', { role: 'alert', dataset: { fk: `dict-${r.status}` } }, icon('alert'), h('span', { text })));
      return;
    }
    out.append(h('div.st-d__head',
      h('h2.st-d__word', { dataset: { fk: 'dict-word' }, text: r.word || input.value }),
      r.phonetic ? h('span.st-d__ph', { text: r.phonetic }) : null,
      r.audio ? h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'dict-audio' }, 'aria-label': `Play the pronunciation of ${r.word}`, onclick: () => play(r.audio) }, icon('volume'), h('span', { text: 'Listen' })) : null,
      h('small.dim', { role: 'status', dataset: { fk: 'dict-audio-msg' } })));
    if (S.added) {
      out.append(h('div.st-flash', { role: 'status', dataset: { fk: 'dict-added' } }, icon('check'), h('span', { text: S.added }),
        h('button.btn.btn--sm', { type: 'button', dataset: { fk: 'dict-open-vocab' }, onclick: () => ctx.go && ctx.go('vocab') }, h('span', { text: 'Open Vocab' }))));
    }
    if (S.add) out.append(addPanel(r));
    const word = r.word || input.value.trim();
    for (const m of r.meanings) {
      out.append(h('section.st-d__pos', { dataset: { fk: 'dict-pos' } },
        h('h3.st-d__pos-h', { text: m.partOfSpeech }),
        h('ol.st-d__defs', m.definitions.map(d => h('li', { dataset: { fk: 'dict-def' } }, h('span', { text: d.definition }),
          d.example ? h('em.st-d__ex', { dataset: { fk: 'dict-example' } }, h('span', { text: 'In a sentence: ' }), h('span', { text: `“${d.example}”` })) : null,
          h('button.btn.btn--sm.btn--ghost', { type: 'button', dataset: { fk: 'dict-add' }, 'aria-label': `Add ${word} with this meaning to a vocab deck`,
            onclick: () => { S.added = ''; S.add = { word, meaning: `(${m.partOfSpeech}) ${d.definition}`.slice(0, 300), example: d.example, withEx: !!d.example, deck: S.add ? S.add.deck : '', error: '' }; showResult(r); const p = out.querySelector('[data-fk="dict-add-panel"]'); if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' }); } },
          icon('plus'), h('span', { text: 'Add to vocab deck' }))))),
        m.synonyms.length ? chips(m.synonyms.slice(0, 20), 'syn') : null,
        m.antonyms.length ? chips(m.antonyms.slice(0, 20), 'ant') : null));
    }
    out.append(h('small.dim', { text: 'Definitions from the Free Dictionary API (dictionaryapi.dev).' }));
  }

  async function go(word) {
    const w = String(word || '').trim();
    if (!w) { clear(out); out.append(h('small.dim', { text: 'Type a word to look up.' })); return; }
    input.value = w;
    const mine = ++S.seq;
    S.add = null; S.added = '';
    clear(out);
    out.append(h('small.dim', { role: 'status', dataset: { fk: 'dict-loading' }, text: `Looking up “${w}”…` }));
    const r = await D.lookup(w);
    if (S.dead || mine !== S.seq) return;
    showResult(r);
    if (r.status === 'ok') remember(r.word || w);
  }

  host.appendChild(h('div.st-d.st-scroll', { dataset: { fk: 'dict' } },
    h('div.st-row', input, goBtn), recentBox, out));
  paintRecent();
  out.append(h('small.dim', { text: 'Needs an internet connection. Type a word and press Enter.' }));

  return {
    open(o) { if (o && o.word) go(o.word); },
    teardown() { S.dead = true; if (S.audio) { try { S.audio.pause(); } catch (e) { /* fine */ } S.audio = null; } },
  };
}
