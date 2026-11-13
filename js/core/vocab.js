/* ============================================================
   vocab.js (core) — what the Vocab tab needs on top of flashcards.js.

   A vocabulary list is an ordinary flashcard deck (front = the word,
   back = its meaning), so it is scheduled by the one spaced-repetition
   scheduler in js/core/flashcards.js: nothing here schedules anything.
   What is added is
     · checkAnswer  judging a typed answer;
     · voice choices per list, saved with store 'portal.vocab';
     · languageOf / describeVoice  naming the voices the browser really has.
   ============================================================ */
import { store } from './store.js';

export const KEY = 'portal.vocab';

const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const squash = s => s.toLowerCase().replace(/[.,;:!?¿¡"“”'’()\[\]{}…]/g, ' ').replace(/\s+/g, ' ').trim();
const plain = s => squash(String(s == null ? '' : s).normalize('NFC'));

/** The answers a card accepts: its back text split at ; / , and with (bracketed bits) kept or left out. */
export function alternatives(back) {
  const out = new Set();
  const text = String(back == null ? '' : back);
  const whole = [text];
  for (const part of text.split(/\s*[;/]\s*|\s*,\s*/)) if (part.trim()) whole.push(part);
  for (const w of whole) {
    const a = plain(w);
    if (a) out.add(a);
    const b = plain(w.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
    if (b) out.add(b);
  }
  return [...out];
}

/**
 * Is `typed` right for a card whose answer is `back`?
 *  -> { ok, exact, accents }   ok: accepted; exact: also every accent right;
 *     accents: it is only right once accents are ignored (a "watch the accents" hint)
 * Capitals, punctuation and extra spaces never matter; a wrong letter does.
 */
export function checkAnswer(typed, back) {
  const t = plain(typed);
  if (!t) return { ok: false, exact: false, accents: false };
  const alts = alternatives(back);
  if (alts.includes(t)) return { ok: true, exact: true, accents: false };
  const tf = fold(t);
  if (alts.some(a => fold(a) === tf)) return { ok: true, exact: false, accents: true };
  return { ok: false, exact: false, accents: false };
}

/* ---------- voices ---------- */
let names = null;
const display = () => {
  if (names === null) { try { names = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'language' }) : false; } catch (e) { names = false; } }
  return names;
};
/** 'es-MX' -> 'es' */
export const baseLang = lang => String(lang || '').toLowerCase().split(/[-_]/)[0];
/** 'es' -> 'Spanish' (the code itself where the browser has no name for it) */
export function languageOf(lang) {
  const b = baseLang(lang);
  if (!b) return 'Unknown language';
  try { const d = display(); const n = d && d.of(b); if (n && n !== b) return n; } catch (e) { /* fine */ }
  return b;
}
/** A voice as the menu shows it: "Spanish — Monica (es-MX)". */
export const describeVoice = v => `${languageOf(v.lang)} — ${v.name}${v.lang ? ` (${v.lang})` : ''}`;

/** The voices, grouped by language: [{ lang: 'es', name: 'Spanish', voices: [..] }] — only what exists. */
export function languages(voices) {
  const m = new Map();
  for (const v of voices || []) {
    const b = baseLang(v.lang) || '?';
    if (!m.has(b)) m.set(b, { lang: b, name: languageOf(v.lang), voices: [] });
    m.get(b).voices.push(v);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A starting voice for each side of a list: the word in the first non-English voice, the meaning in the first English one. */
export function guessVoices(voices) {
  const list = voices || [];
  const en = list.find(v => baseLang(v.lang) === 'en');
  const other = list.find(v => baseLang(v.lang) !== 'en');
  return { term: (other || en || { voiceURI: '' }).voiceURI || '', meaning: (en || other || { voiceURI: '' }).voiceURI || '' };
}

/* ---------- saved choices ---------- */
const read = () => { const o = store.get(KEY); return o && typeof o === 'object' && o.v === 1 && o.lists && typeof o.lists === 'object' ? o : { v: 1, lists: {}, mode: 'flip', dir: 'forward' }; };
/** { term, meaning } voiceURIs saved for a deck, or null if the student never chose. */
export function getVoices(deckId) { const l = read().lists[deckId]; return l ? { term: String(l.term || ''), meaning: String(l.meaning || '') } : null; }
export function setVoices(deckId, v) {
  const o = JSON.parse(JSON.stringify(read()));
  o.lists[deckId] = { term: String(v.term || '').slice(0, 200), meaning: String(v.meaning || '').slice(0, 200) };
  store.set(KEY, o);
}
export function getPrefs() { const o = read(); return { mode: o.mode === 'type' ? 'type' : 'flip', dir: ['forward', 'reverse', 'mixed'].includes(o.dir) ? o.dir : 'forward' }; }
export function setPrefs(p) {
  const o = JSON.parse(JSON.stringify(read()));
  if (p.mode) o.mode = p.mode === 'type' ? 'type' : 'flip';
  if (p.dir) o.dir = ['forward', 'reverse', 'mixed'].includes(p.dir) ? p.dir : 'forward';
  store.set(KEY, o);
}

export default { KEY, alternatives, checkAnswer, baseLang, languageOf, describeVoice, languages, guessVoices, getVoices, setVoices, getPrefs, setPrefs };
