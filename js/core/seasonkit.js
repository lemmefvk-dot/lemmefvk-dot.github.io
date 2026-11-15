/* ============================================================
   seasonkit.js — the small things the seasons keep and check.

   js/core/season.js decides WHEN; js/shell/seasons-more.js draws.
   This module is the part that has to be right and must survive a
   reload, with nothing to draw:

   · the gratitude list (autumn, and Thanksgiving): what you are
     grateful for, as lines you add and remove. Kept in
     portal.gratitude on this device, in your own saved data, never
     sent anywhere;
   · the Pi Day digit challenge: the first 50 decimals of π, and a
     check of what was typed, digit by digit. Best score kept;
   · the Pi Day puzzles: five short questions about circles, made
     from the year so everyone has the same five that day, with
     whole-number answers;
   · the St Patrick's clover hunt: where nine clovers lie (the same
     every time in a given year) and which one has four leaves, and
     which you have found;
   · the back-to-school kit: a checklist and which steps are ticked.

   Everything is plain data in the person's saved state (store →
   profiles.js), so a guest keeps nothing and each person has their own.
   ============================================================ */
import { store } from './store.js';

/* ---------- the gratitude list ---------- */
export const GRATITUDE_KEY = 'portal.gratitude';
export const GRATITUDE_MAX = 100;
export const GRATITUDE_LEN = 200;

export function gratitude() {
  const v = store.get(GRATITUDE_KEY, []);
  return Array.isArray(v) ? v.filter(x => x && typeof x.text === 'string' && x.id) : [];
}
/** Add one line. -> the entry, or null when it is empty or the list is full. */
export function addGratitude(text, now = Date.now()) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, GRATITUDE_LEN);
  const list = gratitude();
  if (!t || list.length >= GRATITUDE_MAX) return null;
  const entry = { id: `g${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: t, at: now };
  store.set(GRATITUDE_KEY, [...list, entry]);
  return entry;
}
export function removeGratitude(id) {
  store.set(GRATITUDE_KEY, gratitude().filter(x => x.id !== id));
}

/* ---------- Pi Day ---------- */
/* 3.14159… to fifty decimal places */
export const PI_DIGITS = '14159265358979323846264338327950288419716939937510';
export const PI_BEST_KEY = 'portal.piBest';

/** How many digits after the point were typed correctly in a row, and what came next.
    typed: the digits after "3." (a leading "3." or "3," is allowed and ignored). */
export function checkDigits(typed) {
  let t = String(typed || '').replace(/[\s_]/g, '');
  t = t.replace(/^3[.,]/, '');
  if (!/^\d*$/.test(t)) {
    const bad = t.search(/\D/);
    return { right: Math.min(bad, PI_DIGITS.length), wrong: null, next: null, typed: t, nonDigit: true, done: false };
  }
  let right = 0;
  while (right < t.length && right < PI_DIGITS.length && t[right] === PI_DIGITS[right]) right++;
  const wrong = right < t.length && right < PI_DIGITS.length ? right : null;
  return {
    right, wrong, typed: t, nonDigit: false,
    next: wrong !== null ? PI_DIGITS[wrong] : null,
    done: right === PI_DIGITS.length,
  };
}
export const piBest = () => Math.max(0, Math.min(PI_DIGITS.length, Math.floor(Number(store.get(PI_BEST_KEY, 0)) || 0)));
/** Keep the score if it beats the best. -> true when it did. */
export function savePiScore(n) {
  const v = Math.max(0, Math.min(PI_DIGITS.length, Math.floor(Number(n) || 0)));
  if (v <= piBest()) return false;
  store.set(PI_BEST_KEY, v);
  return true;
}

const seeded = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const ANGLES = [['π/6', 30], ['π/4', 45], ['π/3', 60], ['π/2', 90], ['2π/3', 120], ['3π/4', 135], ['π', 180]];

/** Five questions, the same for everyone in a given year. Each answer is a whole number. */
export function piPuzzles(year) {
  const R = seeded(year * 31 + 314);
  const int = (a, b) => a + Math.floor(R() * (b - a + 1));
  const r1 = int(3, 12), d2 = 2 * int(3, 9), r3 = int(4, 15), r4 = int(5, 20);
  const k = int(0, ANGLES.length - 1);
  return [
    { q: `A circle has radius ${r1}. Its area is how many π?`, a: r1 * r1, note: `Area is π × r × r, so ${r1} × ${r1}.` },
    { q: `A circle has diameter ${d2}. Its circumference is how many π?`, a: d2, note: `Circumference is π × diameter.` },
    { q: `A circle has area ${r3 * r3}π. What is its radius?`, a: r3, note: `Area is π × r × r, so r × r = ${r3 * r3}.` },
    { q: `A circle has circumference ${2 * r4}π. What is its radius?`, a: r4, note: `Circumference is 2 × π × r.` },
    { q: `How many degrees is ${ANGLES[k][0]} radians?`, a: ANGLES[k][1], note: 'π radians is a half turn: 180 degrees.' },
  ];
}
/** Is the typed answer the right whole number? */
export const piAnswerOk = (puzzle, typed) => /^\s*-?\d+\s*$/.test(String(typed)) && Number(typed) === puzzle.a;

/* ---------- the clover hunt ---------- */
export const CLOVER_KEY = 'portal.clover';
export const CLOVERS = 9;

/** Where the clovers lie in `year`: [{ i, x, y (fractions of the desktop), four }].
    Kept clear of the icon column, the top bar and the dock. */
export function cloverSet(year) {
  const R = seeded(year * 7 + 317);
  const lucky = Math.floor(R() * CLOVERS);
  const out = [];
  for (let i = 0; i < CLOVERS; i++) {
    const cx = (i % 3) / 3, cy = Math.floor(i / 3) / 3;
    out.push({ i, x: 0.13 + (cx + R() * 0.26) * 0.8, y: 0.15 + (cy + R() * 0.24) * 0.66, four: i === lucky });
  }
  return out;
}
export function cloversFound(year) {
  const v = store.get(CLOVER_KEY, null);
  return v && v.year === year && Array.isArray(v.found) ? v.found.filter(n => Number.isInteger(n) && n >= 0 && n < CLOVERS) : [];
}
export function findClover(year, i) {
  const f = cloversFound(year);
  if (f.includes(i)) return f;
  const next = [...f, i];
  store.set(CLOVER_KEY, { year, found: next });
  return next;
}

/* ---------- back to school ---------- */
export const KIT_KEY = 'portal.schoolKit';
export const KIT = [
  { id: 'timetable', text: 'Put this term’s timetable in', app: 'study', go: 'Static Study' },
  { id: 'tasks', text: 'List what is due in the first two weeks', app: 'tasks', go: 'Static Tasks' },
  { id: 'calendar', text: 'Mark tests and trips on the calendar', app: 'calendar', go: 'Calendar' },
  { id: 'cards', text: 'Make a first set of flashcards', app: 'study', go: 'Static Study' },
  { id: 'notes', text: 'Start a notebook for each class', app: 'notes', go: 'Notes' },
  { id: 'bag', text: 'Pack the bag the night before (charger, pens, water)', app: null, go: null },
];
export function kitDone(year) {
  const v = store.get(KIT_KEY, null);
  return v && v.year === year && Array.isArray(v.done) ? v.done.filter(id => KIT.some(k => k.id === id)) : [];
}
export function kitToggle(year, id) {
  if (!KIT.some(k => k.id === id)) return kitDone(year);
  const d = kitDone(year);
  const next = d.includes(id) ? d.filter(x => x !== id) : [...d, id];
  store.set(KIT_KEY, { year, done: next });
  return next;
}

export default {
  gratitude, addGratitude, removeGratitude, PI_DIGITS, checkDigits, piBest, savePiScore, piPuzzles, piAnswerOk,
  cloverSet, cloversFound, findClover, CLOVERS, KIT, kitDone, kitToggle,
};
