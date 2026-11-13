/* ============================================================
   writegoals.js — a word-count goal and a writing timer for a note.
   No DOM here; Notes (js/apps/notesplan.js) shows them.

   What counts as a word is the Words tab's rule, from the same
   function (countWords in js/core/wordtools.js): anything between
   spaces or line breaks that has at least one letter or number in it.
   "well-known" and "don't" are one word each, "—" and a lone emoji are
   none, and "hello,world" with no space is one. A note's words are its
   own text only: no heading marks, bullets or tick boxes, and no
   picture names. So the footer, this goal and the Words tab agree.

   A goal belongs to one note:
     { target, mode, base }
   mode 'total': progress is the note's whole word count.
   mode 'session': progress is words added since `base`, the count
   when the session was started (it can be below zero if you cut more
   than you wrote; it is shown as it is).
   The timer is the time you chose to run it for that note, in ms. It
   runs only while it is running and Notes is open on that note —
   switching notes or closing the window pauses it, and nothing else
   starts it. It is wall-clock time, so a laptop asleep while it runs
   still counts; pause it first.

   Saved in store('portal.writegoals') as { v: 1, notes: { [noteId]: { target, mode, base, ms } } }.
   ============================================================ */
import { store } from './store.js';
import { countWords } from './wordtools.js';
import { noteText } from './notesfmt.js';

export const KEY = 'portal.writegoals';
export const MAX_TARGET = 1000000;
const MAX_NOTES = 500;

/** A note's words, counted as the Words tab counts them. */
export const wordsOf = note => countWords(noteText(note));

const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

export function normalize(raw) {
  const o = raw && typeof raw === 'object' && raw.notes && typeof raw.notes === 'object' ? raw.notes : {};
  const notes = {};
  for (const [id, g] of Object.entries(o)) {
    if (!g || typeof g !== 'object' || Object.keys(notes).length >= MAX_NOTES) continue;
    const target = Number(g.target) >= 1 ? int(g.target, 1, MAX_TARGET) : 0;
    const ms = int(g.ms, 0, 1000 * 3600 * 24 * 365) || 0;
    if (!target && !ms) continue;
    notes[id] = { target, mode: g.mode === 'session' ? 'session' : 'total', base: int(g.base, 0, 1e9) || 0, ms };
  }
  return { v: 1, notes };
}
export const read = () => normalize(store.get(KEY));
export const get = id => read().notes[id] || { target: 0, mode: 'total', base: 0, ms: 0 };

function put(id, g) {
  const d = read();
  if (g.target || g.ms) d.notes[id] = g; else delete d.notes[id];
  store.set(KEY, d);
}
/** Change part of a note's goal. */
export function set(id, patch) { put(id, normalize({ notes: { [id]: { ...get(id), ...patch } } }).notes[id] || { target: 0, mode: 'total', base: 0, ms: 0 }); }
/** Drop a note's goal, keeping its timer. */
export const clearGoal = id => set(id, { target: 0, base: 0 });
/** A note was deleted: its goal and time go with it. */
export function forget(id) { const d = read(); if (d.notes[id]) { delete d.notes[id]; store.set(KEY, d); } }

/** Progress toward a goal for a note with `words` words now.
    -> { n, target, pct (0–100, whole), met } — n is what the bar counts. */
export function progress(g, words) {
  const n = g.mode === 'session' ? words - g.base : words;
  const pct = g.target ? Math.max(0, Math.min(100, Math.floor(n / g.target * 100))) : 0;
  return { n, target: g.target, pct, met: !!g.target && n >= g.target };
}

/** 1:05:09, or 5:09 under an hour. */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}

/* ---------- the timer ---------- */
let run = null;                   /* { id, since } while a timer is running */
export const running = () => (run ? run.id : null);
/** Time on a note's timer now, running or not. */
export const elapsed = (id, now = Date.now()) => get(id).ms + (run && run.id === id ? Math.max(0, now - run.since) : 0);
/** Start (or keep running) a note's timer. Only one runs at a time. */
export function start(id, now = Date.now()) {
  if (run && run.id === id) return;
  pause(now);
  run = { id, since: now };
}
/** Stop the running timer, keeping what it counted. */
export function pause(now = Date.now()) {
  if (!run) return;
  const { id, since } = run;
  run = null;
  set(id, { ms: get(id).ms + Math.max(0, now - since) });
}
/** Save what the running timer has so far, and keep it running. */
export function checkpoint(now = Date.now()) {
  if (!run) return;
  const { id } = run;
  pause(now);
  start(id, now);
}
export const resetTimer = id => { if (run && run.id === id) run.since = Date.now(); set(id, { ms: 0 }); };

export default { KEY, read, get, set, clearGoal, forget, wordsOf, progress, clock, running, elapsed, start, pause, checkpoint, resetTimer, normalize };
