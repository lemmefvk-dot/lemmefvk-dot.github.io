/* ============================================================
   arcade/words.js — the word list behind Letter Grid and Unscramble.

   data/words/en.txt is built by tools/build-wordlist.mjs from SCOWL
   (Kevin Atkinson; see data/words/SOURCE.txt and SCOWL-COPYRIGHT.txt):
   about 110,000 lowercase words of 3 to 16 letters in three tiers —
     1  the everyday words (what Unscramble deals)
     2  familiar words
     3  everything else a dictionary has
   Offensive words are taken out when the file is built and again
   here (wordfilter.js).

   The file is fetched when one of these two games opens, not before,
   and it is not part of the offline shell (data/ never is): about
   1 MB, roughly 320 KB on the wire. Each load keeps a copy in the
   page's Cache Storage ("staticos-words"); online the network answers
   first (so a new list is picked up), and with no network that copy is
   used. The first ever load needs the network, and the games say so.

   parseWords() is pure (a string in, a lexicon out) so the tests
   and the Node tools use it too.
   ============================================================ */
import { isBlocked } from './wordfilter.js';

export const WORDS_URL = new URL('../../data/words/en.txt', import.meta.url).href;

/** text of en.txt -> a lexicon: { size, has(w), tier(w) -> 1|2|3|0, hasPrefix(p), words (sorted), byTier[1..3] } */
export function parseWords(text) {
  const tierOf = new Map();
  const byTier = [null, [], [], []];
  let t = 3;
  for (const line of String(text).split('\n')) {
    if (!line) continue;
    if (line[0] === '#') { t = Math.min(3, Math.max(1, +line.slice(1) || 3)); continue; }
    if (!/^[a-z]{3,16}$/.test(line) || tierOf.has(line) || isBlocked(line)) continue;
    tierOf.set(line, t);
    byTier[t].push(line);
  }
  const words = [...tierOf.keys()].sort();
  /* first index whose word is >= p, by binary search */
  const lower = p => {
    let lo = 0, hi = words.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (words[mid] < p) lo = mid + 1; else hi = mid; }
    return lo;
  };
  return {
    size: words.length,
    words,
    byTier,
    has: w => tierOf.has(w),
    tier: w => tierOf.get(w) || 0,
    hasPrefix: p => { const i = lower(p); return i < words.length && words[i].startsWith(p); },
  };
}

export const WORDS_CACHE = 'staticos-words';

/** the text of en.txt: the network first, then the copy kept by the last good load */
export async function fetchWordsText() {
  const cache = typeof caches !== 'undefined' ? await caches.open(WORDS_CACHE).catch(() => null) : null;
  try {
    const r = await fetch(WORDS_URL);
    if (!r.ok) throw new Error(`the word list answered ${r.status}`);
    if (cache) cache.put(WORDS_URL, r.clone()).catch(() => { /* a full disk is no reason to stop */ });
    return await r.text();
  } catch (err) {
    const hit = cache ? await cache.match(WORDS_URL).catch(() => null) : null;
    if (hit) return hit.text();
    throw err;
  }
}

let pending = null;
/** fetch and parse the list once; a failure is not remembered, so the next call retries */
export function loadWords() {
  if (!pending) {
    pending = fetchWordsText()
      .then(parseWords)
      .catch(err => { pending = null; throw err; });
  }
  return pending;
}
