/* ============================================================
   focus.js — the focus timer behind Clock › Focus.

   Pomodoro sessions: focus (25 min), a short break (5), and a
   long break (15) after every 4th focus session — all adjustable
   (prefs.focus). Start, pause, skip, reset.

   Time is kept from timestamps, never by counting ticks: a running
   phase stores the moment it ends (endAt), a paused one what was
   left. A slow tab, a sleeping laptop or a reload can't make it
   drift: whenever the page looks (every tick, on load, on coming
   back into view) it compares the clock with endAt, and a phase
   that ended while nobody looked is finished AT endAt — so the
   history is written to the right day.

   A finished focus session starts its break by itself; a finished
   break waits for you to start the next focus session (a timer that
   loops forever while you are away helps nobody).

   Focus mode: with prefs.focus.dnd on (the default), starting a
   focus session turns Do Not Disturb on if it was off, and puts it
   back off when the session ends, is paused, skipped or reset. If
   you had it on already, it is left alone. The end of every phase
   rings a gentle cue through sfx.js ('phase' — Mute and Settings ›
   Sound apply) and posts a notification that gets through Do Not
   Disturb (throughDnd); so does a homework reminder, and nothing else.

   History: completed focus sessions per day (count and minutes),
   real ones only — a skipped or reset session is not counted.

   Saved in localStorage[KEY] = { run, log }, written on every
   change (they are rare). Other tabs follow through the storage
   event; finishing a phase takes a Web Lock and re-reads first, so
   two tabs can't count one session twice.

     init()                        start watching the clock (main.js)
     state()                       { phase, status, left, len, endAt, done, every, session, active, dnd }
     start() pause() toggle() skip() reset()
     config() / configure(patch)   { focus, short, long, every, dnd }
     today() -> { n, min }   history(days) -> [{ key, n, min }] oldest first
   bus 'focus:change' with state() after anything changes.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';
import * as sfx from './sfx.js';
import * as wm from './wm.js';
import * as SCHED from './dndrules.js';
import { key, local } from './profiles.js';

export const KEY = key('staticos.focus.v1');   /* this person's (core/profiles.js) */
export const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, dnd: true };
const LIMITS = { focus: [1, 180], short: [1, 60], long: [1, 90], every: [2, 12] };
const KEEP_DAYS = 120;
export const PHASES = { focus: 'Focus', short: 'Short break', long: 'Long break' };

const pad = n => String(n).padStart(2, '0');
const dayKey = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const shiftKey = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n, 12).getTime()); };

/* ---------------- settings ------------------------------------- */
const whole = (v, [lo, hi], d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export function config() {
  const raw = store.get('prefs.focus') || {};
  const out = { dnd: raw.dnd === undefined ? DEFAULTS.dnd : !!raw.dnd };
  for (const k of Object.keys(LIMITS)) out[k] = whole(raw[k], LIMITS[k], DEFAULTS[k]);
  return out;
}
const lenOf = phase => config()[phase] * 60_000;

/* ---------------- saved state ---------------------------------- */
const fresh = () => ({ phase: 'focus', status: 'ready', len: lenOf('focus'), left: lenOf('focus'), endAt: 0, done: 0, dnd: false });
let run = null;
let log = {};
let on = false;

function valid(r) {
  return r && typeof r === 'object' && PHASES[r.phase] && ['ready', 'running', 'paused'].includes(r.status)
    && Number.isFinite(r.len) && r.len > 0 && Number.isFinite(r.left) && Number.isFinite(r.endAt);
}

function load() {
  let v = null;
  try { v = JSON.parse(local.getItem(KEY) || 'null'); } catch (e) { v = null; }
  run = v && valid(v.run) ? { ...v.run, done: Math.max(0, Math.floor(v.run.done) || 0), dnd: !!v.run.dnd } : fresh();
  log = v && v.log && typeof v.log === 'object' ? v.log : {};
}

function save() {
  const oldest = shiftKey(dayKey(), -(KEEP_DAYS - 1));
  for (const k of Object.keys(log)) if (k < oldest) delete log[k];
  try { local.setItem(KEY, JSON.stringify({ run, log })); } catch (e) { /* the timer still runs this session */ }
}

const emit = () => bus.emit('focus:change', state());

/* ---------------- Do Not Disturb ------------------------------- */
function holdDnd() {
  if (run.dnd || !config().dnd || run.phase !== 'focus') return;
  if (store.get('prefs.dnd')) return;                 /* already on: yours, left alone */
  store.set('prefs.dnd', true);
  run.dnd = true;
}
function giveBackDnd() {
  if (!run.dnd) return;
  run.dnd = false;
  /* a Do Not Disturb schedule (js/core/dndsched.js) that is in force keeps it on */
  if (store.get('prefs.dnd') === true && !SCHED.holds()) store.set('prefs.dnd', false);
}

/** A focus session is running and wants Do Not Disturb on (asked by dndsched.js at a schedule's end). */
export function wantsDnd() {
  if (!run) load();
  return run.status === 'running' && run.phase === 'focus' && config().dnd;
}
/** Take over Do Not Disturb from a schedule that is ending: the session gives it back when it ends. */
export function adoptDnd() {
  if (!run) load();
  if (!wantsDnd() || run.dnd) return;
  run.dnd = true;
  change();
}

/* ---------------- reading -------------------------------------- */
export function state() {
  if (!run) load();
  const now = Date.now();
  const left = run.status === 'running' ? Math.max(0, run.endAt - now) : run.left;
  const every = config().every;
  return {
    phase: run.phase, status: run.status, left, len: run.len, endAt: run.endAt,
    done: run.done, every, session: run.phase === 'focus' ? (run.done % every) + 1 : (run.done % every) || every,
    active: run.status !== 'ready', dnd: !!run.dnd, label: PHASES[run.phase],
  };
}

const entry = key => { const e = log[key]; return Array.isArray(e) ? { n: Math.max(0, e[0] | 0), min: Math.max(0, e[1] | 0) } : { n: 0, min: 0 }; };
export function today() { if (!run) load(); return entry(dayKey()); }
export function history(days = 7, endKey = dayKey()) {
  if (!run) load();
  const out = [];
  for (let i = days - 1; i >= 0; i--) { const key = shiftKey(endKey, -i); out.push({ key, ...entry(key) }); }
  return out;
}

/* ---------------- controls ------------------------------------- */
function change() { save(); emit(); }

export function start() {
  if (!run) load();
  if (run.status === 'running') return state();
  if (run.status === 'ready') { run.len = lenOf(run.phase); run.left = run.len; }
  run.endAt = Date.now() + run.left;
  run.status = 'running';
  holdDnd();
  change();
  return state();
}

export function pause() {
  if (!run) load();
  if (run.status !== 'running') return state();
  run.left = Math.max(0, run.endAt - Date.now());
  run.endAt = 0;
  run.status = 'paused';
  giveBackDnd();
  change();
  return state();
}

export const toggle = () => (state().status === 'running' ? pause() : start());

/** On to the next phase without counting this one; a running timer keeps running. */
export function skip() {
  if (!run) load();
  const wasRunning = run.status === 'running';
  giveBackDnd();
  if (run.phase === 'long') run.done = 0;
  enter(run.phase === 'focus' ? 'short' : 'focus', wasRunning ? Date.now() : 0);
  change();
  return state();
}

export function reset() {
  if (!run) load();
  giveBackDnd();
  run = fresh();
  change();
  return state();
}

/** prefs.focus; a phase that hasn't started yet takes the new length at once. */
export function configure(patch = {}) {
  const next = { ...config() };
  for (const k of Object.keys(LIMITS)) if (patch[k] !== undefined) next[k] = whole(patch[k], LIMITS[k], next[k]);
  if (patch.dnd !== undefined) next.dnd = !!patch.dnd;
  store.set('prefs.focus', next);
  if (!run) load();
  if (run.status === 'ready') { run.len = lenOf(run.phase); run.left = run.len; }
  if (patch.dnd === false) giveBackDnd();
  else if (patch.dnd === true && run.status === 'running') holdDnd();
  change();
  return next;
}

/* phase: what comes next; startAt: when it starts running (0: it waits) */
function enter(phase, startAt) {
  const len = lenOf(phase);
  run.phase = phase;
  run.len = len;
  run.left = len;
  run.status = startAt ? 'running' : 'ready';
  run.endAt = startAt ? startAt + len : 0;
  if (startAt) holdDnd();
}

/* ---------------- the clock ------------------------------------ */
let checking = false;
function withLock(fn) {
  try {
    if (navigator.locks && typeof navigator.locks.request === 'function') return navigator.locks.request('staticos-focus', () => fn());
  } catch (e) { /* no Web Locks here */ }
  return Promise.resolve(fn());
}

async function check() {
  if (!run || run.status !== 'running') return;
  const now = Date.now();
  if (now < run.endAt) return;
  /* a hidden tab gives a visible one a moment to ring it */
  if (document.visibilityState === 'hidden' && now < run.endAt + 3000) return;
  if (checking) return;
  checking = true;
  try { await withLock(() => { load(); advance(); }); } finally { checking = false; }
}

function advance() {
  const rang = [];
  /* a phase that ended while the page slept ended at endAt, not now */
  while (run.status === 'running' && Date.now() >= run.endAt) {
    const at = run.endAt;
    if (run.phase === 'focus') {
      const min = Math.round(run.len / 60_000);
      const key = dayKey(at - 1);
      const e = entry(key);
      log[key] = [e.n + 1, e.min + min];
      run.done += 1;
      bus.emit('focus:done', { minutes: min });                    /* a focus session that ran to the end */
      giveBackDnd();
      const next = run.done % config().every === 0 ? 'long' : 'short';
      enter(next, at);
      rang.push({ title: 'Focus session done', message: `${min} minute${min === 1 ? '' : 's'} of focus. ${next === 'long' ? 'Time for a long break' : 'Take a break'}: ${Math.round(run.len / 60_000)} minutes.`, icon: 'flame', skip: true });
    } else {
      if (run.phase === 'long') run.done = 0;
      enter('focus', 0);
      rang.push({ title: 'Break’s over', message: 'Ready for the next focus session?', icon: 'clock', start: true });
    }
  }
  if (!rang.length) return;
  change();
  sfx.play('phase');
  for (const r of rang) {
    bus.emit('noti:push', {
      app: 'Clock', icon: r.icon, title: r.title, message: r.message, timeout: 12000,
      /* the timer's own end note: heard and shown even in Do Not Disturb,
         and it brings its own sound (the 'phase' cue above) */
      throughDnd: true, quiet: true,
      onClick: () => openFocus(),
      /* acted on later, they must not hit a phase they weren't about */
      actions: r.skip ? [{ label: 'Skip break', onClick: () => { if (state().phase !== 'focus') skip(); } }]
        : r.start ? [{ label: 'Start focus', onClick: () => { if (state().phase === 'focus') start(); } }] : [],
    });
  }
}

export function openFocus() { try { wm.open('clock', { tab: 'focus' }); } catch (e) { /* no window layer */ } }

export function init() {
  if (on || typeof window === 'undefined') return;
  on = true;
  load();
  bus.on('tick:1s', check);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  /* another tab started, paused or finished something */
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    const had = !!(run && run.dnd);
    load();
    /* this tab's copy of Do Not Disturb follows the session too */
    if (had && !run.dnd && store.get('prefs.dnd') === true) store.set('prefs.dnd', false);
    else if (!had && run.dnd && !store.get('prefs.dnd')) store.set('prefs.dnd', true);
    emit();
  });
  check();
  emit();
}

export default { init, state, wantsDnd, adoptDnd, start, pause, toggle, skip, reset, config, configure, today, history, openFocus, KEY, DEFAULTS, PHASES };
