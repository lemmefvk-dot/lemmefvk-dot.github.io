/* ============================================================
   dictionary.js — look a word up in the Free Dictionary API
   (https://dictionaryapi.dev, no key) and say honestly what came back.

   lookup() resolves, never throws, to one of:
     { status: 'ok', word, phonetic, audio, meanings: [...] }
     { status: 'notfound' }   the service answered 404
     { status: 'offline' }    this device has no connection
     { status: 'ratelimit' }  the service answered 429
     { status: 'error', detail }  anything else (server error, bad reply,
                              service unreachable, timeout)
   Nothing here makes up a definition: every string shown comes from the
   service's reply.
   ============================================================ */
export const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const TIMEOUT = 12000;

const strs = a => (Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []);
const uniq = a => [...new Set(a)];
const audioUrl = u => {
  if (typeof u !== 'string' || !u.trim()) return '';
  const v = u.trim().startsWith('//') ? `https:${u.trim()}` : u.trim();
  return /^https?:\/\//i.test(v) ? v : '';
};

/** The service's array of entries -> one view. Several entries for a word
    (homographs) are merged in order; synonyms and antonyms are gathered
    per part of speech and per definition. */
export function parse(json) {
  if (!Array.isArray(json) || !json.length) return null;
  const entries = json.filter(e => e && typeof e === 'object');
  const first = entries[0];
  let phonetic = '', audio = '';
  for (const e of entries) {
    if (!phonetic) phonetic = (typeof e.phonetic === 'string' && e.phonetic) || ((e.phonetics || []).find(p => p && p.text) || {}).text || '';
    if (!audio) audio = audioUrl(((e.phonetics || []).find(p => p && audioUrl(p.audio)) || {}).audio);
  }
  const meanings = [];
  for (const e of entries) {
    for (const m of e.meanings || []) {
      if (!m || typeof m.partOfSpeech !== 'string') continue;
      const defs = (m.definitions || []).filter(d => d && typeof d.definition === 'string' && d.definition.trim())
        .map(d => ({ definition: d.definition.trim(), example: typeof d.example === 'string' ? d.example.trim() : '', synonyms: strs(d.synonyms), antonyms: strs(d.antonyms) }));
      if (!defs.length) continue;
      const ex = meanings.find(x => x.partOfSpeech === m.partOfSpeech);
      const syn = uniq([...strs(m.synonyms), ...defs.flatMap(d => d.synonyms)]);
      const ant = uniq([...strs(m.antonyms), ...defs.flatMap(d => d.antonyms)]);
      if (ex) { ex.definitions.push(...defs); ex.synonyms = uniq([...ex.synonyms, ...syn]); ex.antonyms = uniq([...ex.antonyms, ...ant]); }
      else meanings.push({ partOfSpeech: m.partOfSpeech, definitions: defs, synonyms: syn, antonyms: ant });
    }
  }
  if (!meanings.length) return null;
  return { word: typeof first.word === 'string' ? first.word : '', phonetic, audio, meanings };
}

export async function lookup(word, { fetchFn, online } = {}) {
  const w = String(word || '').trim();
  if (!w) return { status: 'error', detail: 'Type a word first.' };
  const isOnline = online !== undefined ? online : (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!isOnline) return { status: 'offline' };
  const f = fetchFn || ((...a) => fetch(...a));
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : 0;
  try {
    const r = await f(API + encodeURIComponent(w), ctl ? { signal: ctl.signal } : undefined);
    if (r.status === 404) return { status: 'notfound' };
    if (r.status === 429) return { status: 'ratelimit' };
    if (!r.ok) return { status: 'error', detail: `The dictionary service answered with an error (HTTP ${r.status}).` };
    let json;
    try { json = await r.json(); } catch (e) { return { status: 'error', detail: 'The dictionary service sent a reply that could not be read.' }; }
    const p = parse(json);
    return p ? { status: 'ok', ...p } : { status: 'notfound' };
  } catch (e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
    return { status: 'error', detail: ctl && ctl.signal.aborted ? 'The dictionary service did not answer in time.' : 'The dictionary service could not be reached.' };
  } finally { clearTimeout(timer); }
}

export const MESSAGES = {
  offline: 'You are offline. The dictionary needs an internet connection, so nothing can be looked up right now.',
  notfound: 'No definitions found for that word. Check the spelling, or try the base form of the word.',
  ratelimit: 'The dictionary service is rate-limiting requests (too many lookups). Wait a minute and try again.',
};
