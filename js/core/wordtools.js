/* ============================================================
   wordtools.js — counting and find/replace for the Words tab of
   Static Study. No DOM; every rule is stated here and shown in the
   tab, nothing is estimated beyond the two stated reading rates.

   Words:      runs of text between spaces/line breaks that contain at
               least one letter or digit (so "—" alone is not a word;
               "well-known" and "don't" are one word each).
   Characters: with spaces counts every character except line breaks;
               without spaces counts only non-whitespace characters.
   Sentences:  stretches ending in . ! ? or … (followed by a space or
               the end), not counting decimals (3.14), initials (J. K.)
               or common abbreviations (Mr., Dr., e.g.). Text after
               the last full stop counts as a sentence.
   Paragraphs: non-empty lines (every Enter starts one).
   Times:      READ_WPM and SPEAK_WPM below.
   ============================================================ */
import { CASES } from './textcase.js';

export const READ_WPM = 238;   /* adults reading non-fiction silently (Brysbaert, 2019) */
export const SPEAK_WPM = 150;  /* a comfortable pace for talks and reading aloud */
const ABBR = new Set('mr mrs ms dr prof sr jr st vs etc eg ie cf no fig inc ltd co mt'.split(' '));

export function countWords(text) {
  return String(text).split(/\s+/).filter(t => /[\p{L}\p{N}]/u.test(t)).length;
}

export function countSentences(text) {
  const s = String(text).replace(/\r/g, '');
  let n = 0, start = 0, m;
  const re = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
  while ((m = re.exec(s))) {
    const before = s.slice(start, m.index);
    if (m[0][0] === '.') {
      const lastWord = (before.match(/[\p{L}\p{N}.]+$/u) || [''])[0].replace(/\./g, '').toLowerCase();
      if (ABBR.has(lastWord) || /(^|\s)\p{Lu}$/u.test(before)) continue;
    }
    if (/[\p{L}\p{N}]/u.test(before)) n++;
    start = m.index + m[0].length;
  }
  if (/[\p{L}\p{N}]/u.test(s.slice(start))) n++;
  return n;
}

export function countParagraphs(text) {
  return String(text).split(/\r?\n/).filter(l => l.trim()).length;
}

export function duration(words, wpm) {
  const secs = Math.round(words / wpm * 60);
  if (secs < 60) return `${secs} sec`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return s ? `${m} min ${s} sec` : `${m} min`;
}

export function stats(text) {
  const t = String(text);
  const words = countWords(t);
  return {
    words,
    chars: [...t.replace(/[\r\n]/g, '')].length,
    charsNoSpaces: [...t.replace(/\s/g, '')].length,
    sentences: countSentences(t),
    paragraphs: countParagraphs(t),
    reading: duration(words, READ_WPM),
    speaking: duration(words, SPEAK_WPM),
  };
}

export const convertCase = (text, kind) => (CASES[kind] ? CASES[kind](text) : String(text));

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build the pattern. Returns { re } or { error } with a plain sentence. */
export function pattern(find, { matchCase = false, wholeWord = false, regex = false } = {}) {
  if (!find) return { re: null, error: '' };
  const src = regex ? find : esc(find);
  const wrapped = wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])` : src;
  try { return { re: new RegExp(wrapped, `gu${matchCase ? '' : 'i'}`), error: '' }; }
  catch (e) {
    return { re: null, error: `That is not a valid regular expression: ${String(e.message).replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, '')}` };
  }
}

export function countMatches(text, find, opts) {
  const p = pattern(find, opts);
  if (p.error || !p.re) return { count: 0, error: p.error };
  let n = 0;
  for (const m of String(text).matchAll(p.re)) { void m; n++; }
  return { count: n, error: '' };
}

/** Replace every match. In regex mode $1 and $& work; otherwise the text is literal. */
export function replaceAll(text, find, rep, opts) {
  const p = pattern(find, opts);
  if (p.error || !p.re) return { text: String(text), count: 0, error: p.error };
  let count = 0;
  const out = String(text).replace(p.re, (...a) => {
    count++;
    if (!opts || !opts.regex) return rep;
    return String(rep).replace(/\$(\d{1,2}|&|\$)/g, (m, g) => (g === '$' ? '$' : g === '&' ? a[0] : (typeof a[+g] === 'string' ? a[+g] : '')));
  });
  return { text: out, count, error: '' };
}
