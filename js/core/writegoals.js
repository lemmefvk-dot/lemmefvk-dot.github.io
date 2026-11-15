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

   A GOAL FOR EVERY DAY counts the words you add to your notes in Notes
   that day: for each note, its words now minus its words when Notes
   first had it open that day (never below zero for a note, so tidying
   one note doesn't take away what you wrote in another). Pasting counts
   as adding. Words written outside Notes (Spotlight, the widget) aren't
   seen, so they don't count. A day is "met" once its count reaches the
   goal; the streak is the met days in a row up to today (or up to
   yesterday, while today isn't met yet). Only days Notes actually
   counted are in it: nothing is filled in.

   A SPRINT is 15 minutes on one note: the words added to it in that
   time (it can be below zero) are kept with the last few sprints.

   Saved in store('portal.writegoals') as
     { v: 1, notes: { [noteId]: { target, mode, base, ms } },
       daily: { target, days: { 'YYYY-MM-DD': { w, met } },
                seen: { day, start: { [noteId]: words }, now: { [noteId]: words } } },
       sprints: [{ at, ms, words, id }] }
   ============================================================ */
import { store } from './store.js';
import { countWords } from './wordtools.js';
import { noteText } from './notesfmt.js';

export const KEY = 'portal.writegoals';
export const MAX_TARGET = 1000000;
const MAX_NOTES = 500;
export const SPRINT_MS = 15 * 60000;
const MAX_DAYS = 400;
const MAX_SPRINTS = 20;
const pad = n => String(n).padStart(2, '0');
export const dayOf = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const prevDay = day => { const [y, m, d] = day.split('-').map(Number); return dayOf(new Date(y, m - 1, d - 1).getTime()); };

/** A note's words, counted as the Words tab counts them. */
export const wordsOf = note => countWords(noteText(note));

const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

function normCounts(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [id, w] of Object.entries(o)) {
    if (Object.keys(out).length >= MAX_NOTES) break;
    const n = int(w, 0, 1e9);
    if (n !== null) out[id] = n;
  }
  return out;
}
function normDaily(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const days = {};
  const keys = Object.keys(o.days && typeof o.days === 'object' ? o.days : {}).filter(k => DAY_RE.test(k)).sort().slice(-MAX_DAYS);
  for (const k of keys) {
    const r = o.days[k] || {};
    days[k] = { w: int(r.w, 0, 1e9) || 0, met: r.met === true };
  }
  const s = o.seen && typeof o.seen === 'object' && DAY_RE.test(o.seen.day || '') ? o.seen : null;
  return {
    target: Number(o.target) >= 1 ? int(o.target, 1, MAX_TARGET) : 0,
    days,
    seen: s ? { day: s.day, start: normCounts(s.start), now: normCounts(s.now) } : { day: '', start: {}, now: {} },
  };
}
const normSprints = raw => (Array.isArray(raw) ? raw : []).filter(x => x && Number.isFinite(Number(x.at)))
  .map(x => ({ at: Number(x.at), ms: int(x.ms, 0, SPRINT_MS * 4) || 0, words: int(x.words, -1e7, 1e7) || 0, id: String(x.id || '').slice(0, 80) }))
  .slice(-MAX_SPRINTS);

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
  return { v: 1, notes, daily: normDaily(raw && raw.daily), sprints: normSprints(raw && raw.sprints) };
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

/* ---------- the goal for every day ---------- */
const save = d => store.set(KEY, normalize(d));
/** Words added in Notes on `day`, from what was counted. */
function dayWords(seen) {
  let w = 0;
  for (const [id, now] of Object.entries(seen.now)) w += Math.max(0, now - (seen.start[id] ?? now));
  return w;
}
/** Notes has note `id` open with `words` words: count it towards today. -> today's words */
export function track(id, words, now = Date.now()) {
  if (!id || !Number.isFinite(words)) return null;
  const d = read();
  const day = dayOf(now);
  const D = d.daily;
  /* a new day counts from where each note was last seen, so the first edit after midnight counts too */
  if (D.seen.day !== day) D.seen = { day, start: { ...D.seen.now }, now: { ...D.seen.now } };
  if (!(id in D.seen.start)) {
    if (Object.keys(D.seen.start).length >= MAX_NOTES) return dayWords(D.seen);
    D.seen.start[id] = words;                  /* counting starts from what it holds now */
  }
  if (D.seen.now[id] === words && D.days[day]) return D.days[day].w;
  D.seen.now[id] = words;
  const w = dayWords(D.seen);
  const was = D.days[day] || { w: 0, met: false };
  D.days[day] = { w, met: was.met || (!!D.target && w >= D.target) };
  save(d);
  return w;
}
export function setDayGoal(target, now = Date.now()) {
  const d = read();
  const t = Number(target) >= 1 ? Math.min(MAX_TARGET, Math.floor(Number(target))) : 0;
  d.daily.target = t;
  const day = dayOf(now);
  if (t && d.daily.days[day] && d.daily.days[day].w >= t) d.daily.days[day].met = true;
  save(d);
}
/** Met days in a row, ending today — or yesterday while today isn't met yet. */
export function streak(now = Date.now(), days = read().daily.days) {
  let day = dayOf(now);
  if (!(days[day] && days[day].met)) day = prevDay(day);
  let n = 0;
  while (days[day] && days[day].met && n < MAX_DAYS) { n++; day = prevDay(day); }
  return n;
}
/** -> { target, today, met, streak } */
export function dayGoal(now = Date.now()) {
  const D = read().daily;
  const r = D.days[dayOf(now)] || { w: 0, met: false };
  return { target: D.target, today: r.w, met: r.met, streak: streak(now, D.days) };
}

/* ---------- 15-minute sprints ---------- */
export function logSprint({ at, ms, words, id }) {
  const d = read();
  d.sprints = [...d.sprints, { at, ms, words, id }].slice(-MAX_SPRINTS);
  save(d);
}
export const sprints = () => read().sprints;

export default { KEY, read, get, set, clearGoal, forget, wordsOf, progress, clock, running, elapsed, start, pause, checkpoint, resetTimer, normalize,
  track, setDayGoal, streak, dayGoal, dayOf, logSprint, sprints, SPRINT_MS };
