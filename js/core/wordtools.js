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
   Readability: the Flesch–Kincaid grade level (Kincaid et al., 1975),
                0.39 × (words ÷ sentences) + 11.8 × (syllables ÷ words) − 15.59,
                a US school grade. Words and sentences are the counts
                above; syllables are counted by a rule for English
                (groups of vowels, a silent final e, -es and -ed that add
                no syllable), which is right for most words but not all,
                so the grade is for English text and is approximate.
   Most-used:  words compared without capitals, with the punctuation at
               their ends taken off ("Cat," and "cat" are one word);
               the little words in COMMON can be left out.
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

/* ---------- readability ---------- */
/** Syllables in one English word, by rule (see the top of this file). */
export function syllables(word) {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  let extra = 0;
  if (/[^aeiouy]le$/.test(w)) { w = w.slice(0, -2); extra = 1; }   /* ta-ble: the -le is its own syllable */
  else if (/(?:[^aeiouy]es|[^aeiouy]ed)$/.test(w) && !/(?:[cgsxz]|ch|sh)es$|[td]ed$/.test(w)) w = w.slice(0, -2);   /* jumped, makes (but box-es, want-ed) */
  else if (/[^aeiouy]e$/.test(w)) w = w.slice(0, -1);              /* a silent final e: make */
  w = w.replace(/^y/, '');
  const groups = w.match(/[aeiouy]+/g);
  return Math.max(1, (groups ? groups.length : 0) + extra);
}
/** -> { words, sentences, syllables, grade } or null when there is no sentence to measure. */
export function readability(text) {
  const t = String(text);
  const list = t.split(/\s+/).filter(x => /[\p{L}\p{N}]/u.test(x));
  const sentences = countSentences(t);
  if (!list.length || !sentences) return null;
  const syl = list.reduce((s, x) => s + syllables(x), 0);
  const grade = 0.39 * (list.length / sentences) + 11.8 * (syl / list.length) - 15.59;
  return { words: list.length, sentences, syllables: syl, grade };
}

/* ---------- most-used words ---------- */
export const COMMON = new Set(('a an the and or but nor so yet if then than of to in on at by for with from into onto over under about as is am are was were be been being it its '
  + 'this that these those he she they we you i me him her them us my your his their our there here not no do does did have has had will would can could shall should may might '
  + 'must just also very what which who whom whose when where why how all any each some such up out off s t').split(' '));
/** The words used most, most first: [{ word, count }]. Ties go in the order the words first appear. */
export function topWords(text, { skipCommon = true, max = 10 } = {}) {
  const counts = new Map();
  for (const raw of String(text).split(/\s+/)) {
    const w = raw.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’]/g, "'");
    if (!w || !/[\p{L}]/u.test(w)) continue;
    if (skipCommon && COMMON.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count).slice(0, max);
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
