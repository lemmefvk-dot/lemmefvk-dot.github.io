/* ============================================================
   arcade/dailyword-state.js — what this device remembers about Daily
   Word, and which word a date gets. Read by the Arcade's home ("Today's
   word") and by the game (./dailyword.js).

   THE WORD. The everyday five-letter words of the Arcade's own word
   list (data/words/en.txt, tier 1, through ./words.js: the list Letter
   Grid and Unscramble use, offensive words already out), in their
   sorted order; the date's seed (./dailykit.js daySeed) picks one. The
   same date gives the same word on every device, with nothing fetched
   but the list itself. A guess may be any five-letter word in the list.

   SAVED (per person, in the Arcade's puzzle store, puzzlekit.js
   'portal.arcadePuzzles.dailyword'):
     board: { day, guesses: ['crane', …], marks: ['20100', …], ms, done, won }
                                  today's; marks are score() per guess, so
                                  the home card can show the colours
                                  without the list (and without the word)
     tries: { 'YYYY-MM-DD': n }   the last 120 days solved, and in how many
     daily: …                     dailykit's record: the streak, by the
                                  same rules as Daily Stars
   Solving it also counts in the daily streak Daily Stars keeps
   (./daily-state.js countDay). Nothing here is sent anywhere.
   ============================================================ */
import { load, save } from './puzzlekit.js';
import { daySeed, dayKey, status as kitStatus, solved as kitSolved } from './dailykit.js';
import { isDayKey } from './stars.js';
import { countDay } from './daily-state.js';

export const GAME = 'dailyword';
export const LENGTH = 5;
export const TRIES = 6;
const KEEP_DAYS = 120;

/** the answers: the everyday five-letter words, sorted */
export function answers(lex) {
  return lex.byTier[1].filter(w => w.length === LENGTH).sort();
}
/** the word for a date */
export function answerFor(day, lex) {
  const list = answers(lex);
  return list.length ? list[daySeed(GAME, day) % list.length] : '';
}
/** may this be guessed? any five-letter word in the list */
export const allowed = (w, lex) => w.length === LENGTH && lex.has(w);

/** per letter: 2 right place, 1 in the word elsewhere, 0 not in it (repeated letters counted as often as the word has them) */
export function score(guess, answer) {
  const out = Array(LENGTH).fill(0);
  const left = {};
  for (let i = 0; i < LENGTH; i++) {
    if (guess[i] === answer[i]) out[i] = 2;
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < LENGTH; i++) {
    if (out[i] || !left[guess[i]]) continue;
    out[i] = 1;
    left[guess[i]]--;
  }
  return out;
}

const clean = v => {
  const b = v && typeof v === 'object' ? v : {};
  return {
    day: isDayKey(b.day) ? b.day : '',
    guesses: Array.isArray(b.guesses) ? b.guesses.filter(g => typeof g === 'string' && /^[a-z]{5}$/.test(g)).slice(0, TRIES) : [],
    marks: Array.isArray(b.marks) ? b.marks.filter(m => typeof m === 'string' && /^[012]{5}$/.test(m)).slice(0, TRIES) : [],
    ms: Number.isFinite(b.ms) && b.ms >= 0 ? b.ms : 0,
    done: b.done === true,
    won: b.won === true,
  };
};

/** today's board: a fresh one on a new day */
export function board(day = dayKey()) {
  const b = clean(load(GAME).board);
  return b.day === day && b.marks.length === b.guesses.length ? b : { day, guesses: [], marks: [], ms: 0, done: false, won: false };
}
export function saveBoard(b) {
  save(GAME, { board: clean(b) });
}
/** the days solved, and in how many tries */
export function tries() {
  const t = load(GAME).tries;
  return t && typeof t === 'object' ? Object.fromEntries(Object.entries(t).filter(([k, v]) => isDayKey(k) && Number.isInteger(v) && v >= 1 && v <= TRIES)) : {};
}

/** `day` was solved in `n` tries after `secs`: Daily Word's streak and the daily streak move on. -> dailykit's status */
export function solve(day, n, secs) {
  const t = tries();
  if (!t[day]) t[day] = n;
  const keys = Object.keys(t).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete t[k];
  save(GAME, { tries: t });
  const st = kitSolved(GAME, day, secs, 0);
  countDay(day);
  return st;
}

/** what the Arcade's home shows for today (no letters: they would give the word away) */
export function status(today = dayKey()) {
  const b = board(today);
  const k = kitStatus(GAME, today);
  return {
    day: today, guesses: b.guesses.length, marks: b.marks.slice(), done: b.done, won: b.won,
    started: !b.done && b.guesses.length > 0,
    streak: k.streak, best: k.best,
  };
}

export default { GAME, LENGTH, TRIES, answers, answerFor, allowed, score, board, saveBoard, tries, solve, status };
