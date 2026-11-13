/* ============================================================
   textcase.js — upper, lower, Title Case and Sentence case.

   No DOM. Used by the word tools (js/core/wordtools.js) and by the
   citation maker (js/core/citations.js), which needs the same title
   rules for MLA and Chicago (headline style) and APA (sentence style).

   Headline style (MLA 9, Chicago 17): capitalise the first and last
   word of a title and of a subtitle (after a colon) and every word
   in between except articles, coordinating conjunctions, "to", "as",
   "of" and prepositions of any length (SMALL_WORDS below).
   ============================================================ */

export const SMALL_WORDS = new Set((
  'a an the and but for nor or as at by in of off on out per to up via ' +
  'about above across after against along among around before behind below beneath beside between beyond ' +
  'down during except from into like near onto over past since through throughout till toward towards ' +
  'under underneath until upon with within without'
).split(' '));

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const up1 = w => w.charAt(0).toLocaleUpperCase() + w.slice(1);

/** Split text into words and the gaps between them. */
function pieces(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) out.push({ gap: text.slice(last, m.index) });
    out.push({ w: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ gap: text.slice(last) });
  return out;
}
/* a gap that ends a sentence or a title part: . ! ? : a dash or a line break */
const breaks = g => /[.!?:\n\r—]|–|\s-\s/.test(g);

/** Headline style. keepRest: leave the other letters of each word as typed
    (a citation title with "NASA" or "iPhone" keeps them); false lowercases them. */
export function headline(text, { keepRest = false } = {}) {
  const ps = pieces(String(text));
  const first = new Set(), last = new Set();
  let startNext = true, prevWord = -1;
  ps.forEach((p, k) => {
    if (p.gap !== undefined) {
      if (breaks(p.gap)) { startNext = true; if (prevWord >= 0) last.add(prevWord); }
      return;
    }
    if (startNext) { first.add(k); startNext = false; }
    prevWord = k;
  });
  if (prevWord >= 0) last.add(prevWord);
  return ps.map((p, k) => {
    if (p.gap !== undefined) return p.gap;
    const w = p.w, lw = w.toLocaleLowerCase();
    const afterHyphen = k > 1 && ps[k - 1].gap === '-' && ps[k - 2].w !== undefined;
    if (SMALL_WORDS.has(lw) && !first.has(k) && !last.has(k) && !afterHyphen) return lw;
    return up1(keepRest ? w : lw);
  }).join('');
}

/** Sentence case: lowercase, then raise the first letter of each sentence
    and a lone "I". */
export function sentence(text) {
  let out = String(text).toLocaleLowerCase();
  out = out.replace(/(^|[.!?]["')\]]*\s+|\n\s*)(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase());
  out = out.replace(/(^|[^\p{L}\p{N}'’])i(?=$|[^\p{L}\p{N}'’]|['’](?:m|ll|ve|d)(?![\p{L}]))/gu, (m, a) => a + 'I');
  return out;
}

/** APA titles use sentence case. A title not written in headline style is
    trusted as typed (so proper nouns survive); one that is (every long word
    capitalised) is lowercased except its first word, the first word after
    a colon, and ALL-CAPS acronyms. */
export function apaTitle(text) {
  const s = String(text).trim();
  const long = [...s.matchAll(WORD)].map(m => m[0]).filter(w => w.length > 3);
  const raise = t => t.replace(/^(\P{L}*)(\p{L})/u, (m, a, b) => a + b.toLocaleUpperCase()).replace(/(:\s+\P{L}*)(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase());
  if (!long.length || !long.every(w => /^\p{Lu}/u.test(w))) return raise(s);
  let startNext = true, star = false;
  return pieces(s).map(p => {
    if (p.gap !== undefined) {
      if (/[:?!.]/.test(p.gap)) startNext = true;
      if ((p.gap.match(/\*/g) || []).length % 2) star = !star;
      return p.gap;
    }
    const w = p.w;
    /* kept: ALL-CAPS acronyms, words with a capital inside (DeLillo, iPhone), and *italic* words */
    const keep = star || (w.length > 1 && w === w.toLocaleUpperCase()) || /\p{Ll}\p{Lu}/u.test(w);
    const r = keep ? w : startNext ? up1(w.toLocaleLowerCase()) : w.toLocaleLowerCase();
    startNext = false;
    return r;
  }).join('');
}

export const upper = t => String(t).toLocaleUpperCase();
export const lower = t => String(t).toLocaleLowerCase();
export const title = t => String(t).split(/(\r?\n)/).map(l => headline(l)).join('');
export const CASES = { upper, lower, title, sentence };
