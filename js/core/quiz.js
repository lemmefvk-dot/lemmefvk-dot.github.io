/* ============================================================
   quiz.js — the quiz model behind Static Study's Quiz tab: what a
   quiz is, how an imported or loaded one is checked, how an answer
   is graded and how many points it earns. No window, no network.

   A quiz: { title, questions: [question], shuffle: { q, c }, limit }
   a question: { kind, text, choices: [{ text, ok }], answers, time, img? }
     · kind 'mc' (multiple choice, the default and every older file):
       2–6 choices, one or more marked right;
       kind 'tf' (true or false): exactly the choices True and False,
       one of them right;
       kind 'short' (short answer): no choices; `answers` holds 1–6
       answers that are accepted (see checkShort);
     · 1–50 questions; `time` is seconds (0 = no limit, otherwise
       5–120); `img` is the path of a picture in the Files (Pictures,
       see core/media.js);
     · shuffle.q / shuffle.c: the questions / the choices of a multiple-
       choice question come in a new order each time it is played
       (true or false keeps True first);
     · limit: minutes for the whole quiz when you practise it alone
       (0 = none); a live quiz is paced by its host instead.
   Quizzes are saved as files in ~/Documents/Quizzes (name.quiz.json)
   and exported / imported as the same JSON. cleanQuiz() is the one
   gate for anything that did not come from the editor: a file, an
   import, a pasted block. It accepts only the fields above, trims and
   caps text, drops control and bidi characters, and says why when a
   quiz can't be used.

   GRADING. A multiple-choice question is right only when the chosen set
   is exactly the right set (for a question with two right answers, both
   and nothing else). A short answer is right when it matches one of the
   accepted answers once capitals, spaces and punctuation at its ends are
   set aside (accents are pointed out, not counted against you). Points:
   wrong or no answer = 0; right = 500 for being right plus up to 500 for
   speed, falling in a straight line from the moment the question opened
   to the time limit (30 s when there is none).

   PASTED QUESTIONS (parsePaste): blocks separated by an empty line.
   The first line is the question (a "1." or "Q:" in front is dropped);
   then either choices, one a line, the right one(s) marked with * in
   front or "(correct)" after (a), A. or - in front is dropped), or an
   "Answer: …" line. Choices True and False make a true-or-false
   question; an Answer line with no choices makes a short answer (put
   " | " between answers that are all accepted); an Answer that names a
   choice (its letter or its words) marks that choice right. A block
   that can't be read is skipped and said so.
   ============================================================ */
import { cleanText } from './roomcode.js';

export const LIMITS = { questions: 50, choices: 6, minChoices: 2, title: 80, text: 300, choice: 120, answers: 6, timeMin: 5, timeMax: 120, noLimitWindow: 30, bytes: 1500000, quizMinutes: 120 };
export const FORMAT = 'staticos-quiz';
export const DIR_NAME = 'Quizzes';
export const IMG_DATA = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
export const KINDS = [['mc', 'Multiple choice'], ['tf', 'True or false'], ['short', 'Short answer']];
export const QUIZ_LIMITS = [[0, 'No time limit'], [2, '2 minutes'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour']];

const tf = (right = true) => [{ text: 'True', ok: right }, { text: 'False', ok: !right }];
export const blankQuestion = (kind = 'mc') => ({ kind, text: '', choices: kind === 'tf' ? tf(true) : kind === 'short' ? [] : [{ text: '', ok: true }, { text: '', ok: false }], answers: kind === 'short' ? [''] : [], time: 0, img: '' });
export const blankQuiz = () => ({ title: '', questions: [blankQuestion()], shuffle: { q: false, c: false }, limit: 0 });
export const kindOf = q => (q && (q.kind === 'tf' || q.kind === 'short') ? q.kind : 'mc');

/** A question changed to another kind, keeping what it can. */
export function asKind(q, kind) {
  const was = kindOf(q);
  if (was === kind) return q;
  const right = q.choices.filter(c => c.ok && String(c.text).trim()).map(c => c.text);
  const out = { ...q, kind };
  if (kind === 'tf') { const t = was === 'short' ? /^t(rue)?$/i.test(String(q.answers[0] || '').trim()) || !String(q.answers[0] || '').trim() : !right.some(x => /^f(alse)?$/i.test(x.trim())); out.choices = tf(t); out.answers = []; }
  else if (kind === 'short') { out.answers = was === 'tf' ? [q.choices.find(c => c.ok)?.text || 'True'] : (right.length ? right.slice(0, LIMITS.answers) : ['']); out.choices = []; }
  else { out.choices = was === 'tf' ? q.choices.map(c => ({ ...c })) : [...(q.answers.filter(a => String(a).trim()).slice(0, LIMITS.choices - 1).map(a => ({ text: a, ok: true }))), { text: '', ok: false }]; if (out.choices.length < 2) out.choices.unshift({ text: '', ok: true }); out.answers = []; }
  return out;
}

/** Is this answer set exactly the right set? picks: indexes the player chose. */
export function isRight(question, picks) {
  const want = question.choices.map((c, i) => (c.ok ? i : -1)).filter(i => i >= 0);
  const got = [...new Set(picks)].sort((a, b) => a - b);
  return want.length === got.length && want.every((v, i) => v === got[i]);
}

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const squash = s => String(s == null ? '' : s).normalize('NFC').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
  .replace(/^[\s.,;:!?¿¡"'()[\]]+|[\s.,;:!?¿¡"'()[\]]+$/g, '');
/** A typed short answer against the accepted ones. -> { ok, exact, accents } */
export function checkShort(question, typed) {
  const t = squash(typed);
  if (!t) return { ok: false, exact: false, accents: false };
  const acc = (question.answers || []).map(squash).filter(Boolean);
  if (acc.includes(t)) return { ok: true, exact: true, accents: false };
  if (acc.some(a => fold(a) === fold(t))) return { ok: true, exact: false, accents: true };
  return { ok: false, exact: false, accents: false };
}

/** 0 for wrong; 500–1000 for right: 500 + 500 × (time left ÷ time allowed). */
export function pointsFor(right, elapsedMs, limitSec) {
  if (!right) return 0;
  const win = (limitSec > 0 ? limitSec : LIMITS.noLimitWindow) * 1000;
  const frac = 1 - Math.min(Math.max(elapsedMs, 0), win) / win;
  return Math.round(500 + 500 * frac);
}

/** What stops a question being used: [] when it is fine. */
export function questionIssues(q) {
  const out = [];
  if (!String(q.text || '').trim()) out.push('Write the question.');
  const kind = kindOf(q);
  if (kind === 'short') {
    if (!(q.answers || []).some(a => String(a || '').trim())) out.push('Give at least one answer that is accepted.');
    return out;
  }
  if (kind === 'tf') {
    if (q.choices.filter(c => c.ok).length !== 1) out.push('Pick whether it is true or false.');
    return out;
  }
  const filled = q.choices.filter(c => String(c.text || '').trim());
  if (filled.length < LIMITS.minChoices) out.push('Give at least two choices.');
  if (q.choices.some(c => !String(c.text || '').trim()) && filled.length >= LIMITS.minChoices) out.push('Fill in or remove the empty choices.');
  if (!q.choices.some(c => c.ok && String(c.text || '').trim())) out.push('Mark at least one choice as right.');
  return out;
}
export const quizIssues = quiz => {
  const out = [];
  if (!String(quiz.title || '').trim()) out.push('Give the quiz a title.');
  quiz.questions.forEach((q, i) => questionIssues(q).forEach(m => out.push(`Question ${i + 1}: ${m}`)));
  return out;
};

const cleanSettings = data => ({
  shuffle: { q: !!(data.shuffle && data.shuffle.q === true), c: !!(data.shuffle && data.shuffle.c === true) },
  limit: QUIZ_LIMITS.some(([m]) => m === data.limit) ? data.limit : 0,
});

/** Anything from outside -> { quiz } or { error }. */
export function cleanQuiz(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.bytes) return { error: 'That file is too big to be a quiz.' };
    try { data = JSON.parse(raw); } catch (e) { return { error: 'That isn’t a quiz file: it isn’t valid JSON.' }; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'That isn’t a quiz file.' };
  if (data.format !== undefined && data.format !== FORMAT) return { error: 'That file is not a Static Study quiz.' };
  if (!Array.isArray(data.questions) || !data.questions.length) return { error: 'That quiz has no questions.' };
  if (data.questions.length > LIMITS.questions) return { error: `A quiz can have at most ${LIMITS.questions} questions; this one has ${data.questions.length}.` };
  const questions = [];
  for (const [n, q] of data.questions.entries()) {
    if (!q || typeof q !== 'object') return { error: `Question ${n + 1} can’t be read.` };
    const kind = kindOf(q);
    const text = cleanText(q.text, LIMITS.text);
    if (!text) return { error: `Question ${n + 1} has no text.` };
    let choices = [], answers = [];
    if (kind === 'short') {
      answers = (Array.isArray(q.answers) ? q.answers : []).slice(0, LIMITS.answers).map(a => cleanText(typeof a === 'string' ? a : '', LIMITS.choice)).filter(Boolean);
      if (!answers.length) return { error: `Question ${n + 1} (short answer) has no accepted answer.` };
    } else {
      if (!Array.isArray(q.choices)) return { error: `Question ${n + 1} is missing its choices.` };
      choices = q.choices.slice(0, LIMITS.choices).map(c => ({ text: cleanText(c && c.text, LIMITS.choice), ok: !!(c && c.ok) }));
      if (kind === 'tf') {
        if (choices.length !== 2 || choices.filter(c => c.ok).length !== 1) return { error: `Question ${n + 1} (true or false) needs exactly one of True and False marked right.` };
        choices = tf(choices[0].ok);
      }
      if (choices.length < LIMITS.minChoices || choices.some(c => !c.text)) return { error: `Question ${n + 1} needs 2–6 choices with text.` };
      if (!choices.some(c => c.ok)) return { error: `Question ${n + 1} has no right answer marked.` };
    }
    let time = Number(q.time);
    time = Number.isFinite(time) && time > 0 ? Math.min(LIMITS.timeMax, Math.max(LIMITS.timeMin, Math.round(time))) : 0;
    const out = { kind, text, choices, answers, time, img: '' };
    if (typeof q.img === 'string' && q.img.startsWith('/') && q.img.length <= 300) out.img = q.img.replace(/[\u0000-\u001f]/g, '');
    if (typeof q.imgData === 'string' && q.imgData.length <= 200000 && IMG_DATA.test(q.imgData)) out.imgData = q.imgData;
    questions.push(out);
  }
  const title = cleanText(data.title, LIMITS.title) || 'Untitled quiz';
  return { quiz: { title, questions, ...cleanSettings(data) } };
}

export const serialize = (quiz, withPictures = {}) => JSON.stringify({
  format: FORMAT, v: 1, title: quiz.title,
  ...(quiz.shuffle && (quiz.shuffle.q || quiz.shuffle.c) ? { shuffle: { q: !!quiz.shuffle.q, c: !!quiz.shuffle.c } } : {}),
  ...(quiz.limit ? { limit: quiz.limit } : {}),
  questions: quiz.questions.map((q, i) => ({
    ...(kindOf(q) === 'mc' ? {} : { kind: kindOf(q) }),
    text: q.text, choices: kindOf(q) === 'short' ? [] : q.choices.map(c => ({ text: c.text, ok: !!c.ok })),
    ...(kindOf(q) === 'short' ? { answers: q.answers.map(a => String(a).trim()).filter(Boolean) } : {}),
    time: q.time || 0, ...(q.img ? { img: q.img } : {}), ...(withPictures[i] ? { imgData: withPictures[i] } : {}),
  })),
}, null, 2);

export const fileNameFor = title => `${String(title || 'quiz').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'quiz'}.quiz.json`;

/* ---------- order ---------- */
export function shuffled(list, rnd = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** The quiz as it will be played: its own shuffle settings applied (a copy). */
export function playOrder(quiz, rnd = Math.random) {
  const qs = quiz.questions.map(q => ({ ...q, choices: q.choices.map(c => ({ ...c })), answers: (q.answers || []).slice() }));
  const sh = quiz.shuffle || {};
  for (const q of qs) if (sh.c && kindOf(q) === 'mc') q.choices = shuffled(q.choices, rnd);
  return { ...quiz, questions: sh.q ? shuffled(qs, rnd) : qs };
}

/* ---------- pasted questions ---------- */
const RIGHT_END = /\s*(?:\((?:correct|right|answer)\)|✓|✔)\s*$/i;
const LETTER = /^\(?([a-fA-F])[).]\s+/;
const BULLET = /^(?:[-•]\s+|\(?[a-fA-F][).]\s+)/;
/** Text -> { questions, skipped: [{ n, why, text }] } (questions in this file's shape). */
export function parsePaste(text) {
  const blocks = String(text == null ? '' : text).replace(/\r/g, '').split(/\n\s*\n/).map(b => b.split('\n').map(l => l.trim()).filter(Boolean)).filter(b => b.length);
  const questions = [], skipped = [];
  blocks.forEach((lines, n) => {
    const skip = why => skipped.push({ n: n + 1, why, text: lines[0].slice(0, 60) });
    if (questions.length >= LIMITS.questions) { skip(`a quiz holds ${LIMITS.questions} questions`); return; }
    const qText = cleanText(lines[0].replace(/^(?:\d{1,3}[.)]|q\d*[.:)]|question\s*\d*[.:)])\s*/i, ''), LIMITS.text);
    if (!qText) { skip('it has no question'); return; }
    let answer = null;
    const opts = [];
    for (const l of lines.slice(1)) {
      const a = /^(?:answer|ans|a)\s*[:=]\s*(.+)$/i.exec(l);
      if (a && !LETTER.test(l)) { answer = a[1].trim(); continue; }
      let t = l, ok = false;
      if (/^\*/.test(t)) { ok = true; t = t.replace(/^\*+\s*/, ''); }
      if (RIGHT_END.test(t)) { ok = true; t = t.replace(RIGHT_END, ''); }
      const letter = (LETTER.exec(t) || [])[1];
      t = t.replace(BULLET, '');
      t = cleanText(t, LIMITS.choice);
      if (t) opts.push({ text: t, ok, letter: letter ? letter.toUpperCase() : '' });
    }
    if (!opts.length) {
      if (!answer) { skip('it has no choices and no Answer: line'); return; }
      if (/^(true|false|t|f)$/i.test(answer)) { questions.push({ kind: 'tf', text: qText, choices: tf(/^t/i.test(answer)), answers: [], time: 0, img: '' }); return; }
      const answers = answer.split(/\s*\|\s*/).map(a => cleanText(a, LIMITS.choice)).filter(Boolean).slice(0, LIMITS.answers);
      questions.push({ kind: 'short', text: qText, choices: [], answers, time: 0, img: '' });
      return;
    }
    if (answer) {
      const want = answer.split(/\s*[,|]\s*|\s+and\s+/i).map(x => x.trim()).filter(Boolean);
      for (const w of want) {
        const byLetter = /^[a-fA-F]$/.test(w) ? opts.findIndex((o, i) => (o.letter || String.fromCharCode(65 + i)) === w.toUpperCase()) : -1;
        const byText = opts.findIndex(o => o.text.toLowerCase() === w.toLowerCase());
        const at = byText >= 0 ? byText : byLetter;
        if (at >= 0) opts[at].ok = true;
      }
    }
    if (opts.length > LIMITS.choices) { skip(`it has ${opts.length} choices; a question can have up to ${LIMITS.choices}`); return; }
    if (opts.length < LIMITS.minChoices) { skip('it has only one choice'); return; }
    if (!opts.some(o => o.ok)) { skip('no choice is marked right (put * in front of it, or add an Answer: line)'); return; }
    const isTF = opts.length === 2 && opts.every(o => /^(true|false)$/i.test(o.text)) && opts.filter(o => o.ok).length === 1;
    if (isTF) { questions.push({ kind: 'tf', text: qText, choices: tf(opts.find(o => /^true$/i.test(o.text)).ok), answers: [], time: 0, img: '' }); return; }
    questions.push({ kind: 'mc', text: qText, choices: opts.map(o => ({ text: o.text, ok: o.ok })), answers: [], time: 0, img: '' });
  });
  return { questions, skipped };
}
export const PASTE_EXAMPLE = 'What is the capital of France?\n*Paris\nRome\nMadrid\n\nThe sun is a star.\n*True\nFalse\n\nWho wrote Hamlet?\nAnswer: Shakespeare | William Shakespeare';

export default { LIMITS, KINDS, QUIZ_LIMITS, blankQuiz, blankQuestion, kindOf, asKind, isRight, checkShort, pointsFor, questionIssues, quizIssues, cleanQuiz, serialize, fileNameFor, shuffled, playOrder, parsePaste, PASTE_EXAMPLE };
