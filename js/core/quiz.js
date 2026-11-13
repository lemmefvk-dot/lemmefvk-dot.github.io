/* ============================================================
   quiz.js — the quiz model behind Static Study's Quiz tab: what a
   quiz is, how an imported or loaded one is checked, how an answer
   is graded and how many points it earns. No window, no network.

   A quiz: { title, questions: [{ text, choices: [{ text, ok }],
   time, img? }] }
     · 1–50 questions; each has 2–6 choices, one or more marked right;
       `time` is seconds (0 = no limit, otherwise 5–120); `img` is the
       path of a picture in the Files (Pictures, see core/media.js).
   Quizzes are saved as files in ~/Documents/Quizzes (name.quiz.json)
   and exported / imported as the same JSON. cleanQuiz() is the one
   gate for anything that did not come from the editor: a file, an
   import, a pasted block. It accepts only the fields above, trims and
   caps text, drops control and bidi characters, and says why when a
   quiz can't be used.

   GRADING. A question is right only when the chosen set is exactly the
   right set (for a question with two right answers, both and nothing
   else). Points: wrong or no answer = 0; right = 500 for being right
   plus up to 500 for speed, falling in a straight line from the moment
   the question opened to the time limit (30 s when there is none).
   ============================================================ */
import { cleanText } from './roomcode.js';

export const LIMITS = { questions: 50, choices: 6, minChoices: 2, title: 80, text: 300, choice: 120, timeMin: 5, timeMax: 120, noLimitWindow: 30, bytes: 1500000 };
export const FORMAT = 'staticos-quiz';
export const DIR_NAME = 'Quizzes';
export const IMG_DATA = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export const blankQuestion = () => ({ text: '', choices: [{ text: '', ok: true }, { text: '', ok: false }], time: 0, img: '' });
export const blankQuiz = () => ({ title: '', questions: [blankQuestion()] });

/** Is this answer set exactly the right set? picks: indexes the player chose. */
export function isRight(question, picks) {
  const want = question.choices.map((c, i) => (c.ok ? i : -1)).filter(i => i >= 0);
  const got = [...new Set(picks)].sort((a, b) => a - b);
  return want.length === got.length && want.every((v, i) => v === got[i]);
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
    if (!q || typeof q !== 'object' || !Array.isArray(q.choices)) return { error: `Question ${n + 1} is missing its choices.` };
    const text = cleanText(q.text, LIMITS.text);
    const choices = q.choices.slice(0, LIMITS.choices).map(c => ({ text: cleanText(c && c.text, LIMITS.choice), ok: !!(c && c.ok) }));
    if (!text) return { error: `Question ${n + 1} has no text.` };
    if (choices.length < LIMITS.minChoices || choices.some(c => !c.text)) return { error: `Question ${n + 1} needs 2–6 choices with text.` };
    if (!choices.some(c => c.ok)) return { error: `Question ${n + 1} has no right answer marked.` };
    let time = Number(q.time);
    time = Number.isFinite(time) && time > 0 ? Math.min(LIMITS.timeMax, Math.max(LIMITS.timeMin, Math.round(time))) : 0;
    const out = { text, choices, time, img: '' };
    if (typeof q.img === 'string' && q.img.startsWith('/') && q.img.length <= 300) out.img = q.img.replace(/[\u0000-\u001f]/g, '');
    if (typeof q.imgData === 'string' && q.imgData.length <= 200000 && IMG_DATA.test(q.imgData)) out.imgData = q.imgData;
    questions.push(out);
  }
  const title = cleanText(data.title, LIMITS.title) || 'Untitled quiz';
  return { quiz: { title, questions } };
}

export const serialize = (quiz, withPictures = {}) => JSON.stringify({
  format: FORMAT, v: 1, title: quiz.title,
  questions: quiz.questions.map((q, i) => ({ text: q.text, choices: q.choices.map(c => ({ text: c.text, ok: !!c.ok })), time: q.time || 0, ...(q.img ? { img: q.img } : {}), ...(withPictures[i] ? { imgData: withPictures[i] } : {}) })),
}, null, 2);

export const fileNameFor = title => `${String(title || 'quiz').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'quiz'}.quiz.json`;

export default { LIMITS, blankQuiz, blankQuestion, isRight, pointsFor, questionIssues, quizIssues, cleanQuiz, serialize, fileNameFor };
