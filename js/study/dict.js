/* ============================================================
   study/dict.js — the Dictionary tab of Static Study.

   Definitions, parts of speech, examples, synonyms and antonyms from
   the Free Dictionary API (js/core/dictionary.js), the pronunciation
   when the service gives one, and the words you looked up last.
   Offline, a rate limit or a service error is said plainly; a
   definition is never made up. Recent words: store('portal.dictRecent').
   ============================================================ */
import * as D from '../core/dictionary.js';

const KEY = 'portal.dictRecent';
const MAX = 12;

export function mountDict(host, ctx) {
  const { api } = ctx;
  const { h, icon, store, clear } = api;
  const S = { seq: 0, dead: false, audio: null, recent: (Array.isArray(store.get(KEY)) ? store.get(KEY) : []).filter(w => typeof w === 'string').slice(0, MAX) };

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

  function showResult(r) {
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
    for (const m of r.meanings) {
      out.append(h('section.st-d__pos', { dataset: { fk: 'dict-pos' } },
        h('h3.st-d__pos-h', { text: m.partOfSpeech }),
        h('ol.st-d__defs', m.definitions.map(d => h('li', { dataset: { fk: 'dict-def' } }, h('span', { text: d.definition }), d.example ? h('em.st-d__ex', { text: `“${d.example}”` }) : null))),
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
