/* ============================================================
   screentime.js — how long each app and game was in front,
   measured on this device while StaticOS is open.

   What counts (and nothing else does — no estimates):
   · the app of the FRONT window (wm.getActive()), while this tab
     is visible and nothing covers the desktop (boot, lock screen);
   · while the person is active: time stops counting 5 minutes
     after the last key, click, scroll or touch, unless a <video>
     or <audio> in that window is playing (Music and Static Radio
     play through their own <audio>, registered in audiotap.js).
     Input inside an embedded page from another site (a web game's
     frame) can't be seen from here, so a frame in the front window
     that holds the keyboard focus counts as being used;
   · a game, by id, when the front window is Static Games playing
     a catalogue game or the Arcade playing one of its own — those
     windows put { kind, id, title, icon } in win.state.playing.
     Game time is a part of its window's app time, not extra.

   How it is measured: a sample on every tick (bus 'tick:1s') and
   on every change that matters (focus, visibility, input after an
   idle spell) credits the time since the previous sample to what
   was in front at that previous sample. A gap longer than MAX_GAP
   between samples means the page was not running (a sleeping
   laptop, a frozen tab) and counts nothing.

   Several tabs: only one tab counts at a time. Tabs agree on a
   leader over a BroadcastChannel — the tab that most recently got
   input or became visible claims it; a tab going hidden or away
   lets it go. Without BroadcastChannel every tab counts alone.

   Stored compactly per day, kept for KEEP_DAYS, written rarely:
   pending time is batched in memory and merged into
   localStorage[KEY] every FLUSH_MS, when the tab is hidden, on
   pagehide and when leadership moves. A merge re-reads what is
   stored first, so another tab's writes are never lost.

     { v: 1,
       d: { 'YYYY-MM-DD': { a: { appId: sec }, g: { 'web:id': sec } } },
       n: { 'web:id': { t: 'Title', i: 'icon' } } }

   init()                     start measuring (main.js, once)
   day(key?)                  { key, total, apps:[{id,sec}], games:[{key,kind,id,title,icon,sec}] }
   range(days, endKey?)       the same summed over `days` days ending at endKey
   week(endKey?)              [{ key, date, sec }] × 7, oldest first
   clear()                    forget everything (every tab)
   flush()                    write pending time now
   status()                   { leader, counting, front } — for tests
   dayKey(ms?)                local 'YYYY-MM-DD'
   ============================================================ */
import { bus } from './bus.js';
import * as wm from './wm.js';
import { covered } from './cover.js';
import * as tap from './audiotap.js';
import { key, local } from './profiles.js';

export const KEY = key('staticos.screentime.v1');   /* this person's (core/profiles.js) */
export const IDLE_MS = 5 * 60_000;
const MAX_GAP = 30_000;
const FLUSH_MS = 60_000;
export const KEEP_DAYS = 56;
const GAME_WINDOWS = new Set(['aether-games', 'arcade']);
const CHANNEL = key('staticos-screentime');

const S = {
  on: false,
  last: 0,             /* when the previous sample was taken */
  cur: null,           /* what was in front at that sample (null: not counting) */
  input: 0,            /* the last input this tab saw */
  seenInput: 0,        /* throttle for pointermove / wheel */
  pending: {},         /* day -> { a: {id: ms}, g: {key: ms} } */
  names: {},           /* game key -> { t, i } */
  dirty: false,
  flushedAt: 0,
};

/* ---------------- days ----------------------------------------- */
const pad = n => String(n).padStart(2, '0');
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const dayStart = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const shift = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n, 12).getTime()); };

/* ---------------- storage -------------------------------------- */
function read() {
  try {
    const v = JSON.parse(local.getItem(KEY) || 'null');
    if (v && typeof v === 'object' && v.d && typeof v.d === 'object') return { v: 1, d: v.d, n: v.n && typeof v.n === 'object' ? v.n : {} };
  } catch (e) { /* unreadable: start again */ }
  return { v: 1, d: {}, n: {} };
}

/* whole positive seconds only: the stored copy is user-editable */
const secs = v => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function prune(data) {
  const oldest = shift(dayKey(), -(KEEP_DAYS - 1));
  for (const k of Object.keys(data.d)) if (!/^\d{4}-\d\d-\d\d$/.test(k) || k < oldest) delete data.d[k];
  const used = new Set();
  for (const day of Object.values(data.d)) for (const g of Object.keys(day.g || {})) used.add(g);
  for (const g of Object.keys(data.n)) if (!used.has(g)) delete data.n[g];
}

/** Merge pending time into what is stored (whole seconds; the rest waits). */
export function flush() {
  S.flushedAt = Date.now();
  if (!S.dirty) return;
  const data = read();
  let wrote = false;
  for (const [day, p] of Object.entries(S.pending)) {
    const into = data.d[day] || (data.d[day] = { a: {}, g: {} });
    into.a = into.a || {}; into.g = into.g || {};
    for (const part of ['a', 'g']) {
      for (const [id, ms] of Object.entries(p[part])) {
        const s = Math.floor(ms / 1000);
        if (s <= 0) continue;
        into[part][id] = secs(into[part][id]) + s;
        p[part][id] = ms - s * 1000;
        wrote = true;
      }
    }
  }
  for (const [k, v] of Object.entries(S.names)) data.n[k] = v;
  /* keep only the sub-second remainders of today */
  const today = dayKey();
  for (const day of Object.keys(S.pending)) if (day !== today) delete S.pending[day];
  S.dirty = false;
  if (!wrote) return;
  prune(data);
  try { local.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota / private mode: keep counting in memory */ }
}

/* ---------------- what is in front ----------------------------- */
function playingIn(w) {
  try {
    for (const m of w.el.querySelectorAll('video, audio')) if (!m.paused && !m.ended) return true;
    const src = tap.source(w.appId);              /* Music, Static Radio: one <audio> outside the window */
    if (src && src.el && !src.el.paused && !src.el.ended) return true;
  } catch (e) { /* a detached window */ }
  return false;
}

/* the keyboard focus is inside a frame of this window (a web game, an embed) */
function frameFocused(w) {
  const a = document.activeElement;
  return !!a && a.tagName === 'IFRAME' && w.el.contains(a) && document.hasFocus();
}

function gameOf(w) {
  if (!GAME_WINDOWS.has(w.appId)) return null;
  const p = w.state && w.state.playing;
  if (!p || !p.id) return null;
  const kind = p.kind === 'arcade' ? 'arcade' : 'web';
  return { key: `${kind}:${String(p.id).slice(0, 80)}`, t: String(p.title || p.id).slice(0, 80), i: p.icon ? String(p.icon).slice(0, 40) : null };
}

function front() {
  if (!leader()) return null;
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return null;
  if (covered()) return null;
  const w = wm.getActive();
  if (!w || w.min || !w.el || !w.el.isConnected) return null;
  const g = gameOf(w);
  return { app: w.appId, game: g, media: playingIn(w), frame: frameFocused(w) };
}

/* ---------------- counting ------------------------------------- */
function add(day, part, id, ms) {
  const p = S.pending[day] || (S.pending[day] = { a: {}, g: {} });
  p[part][id] = (p[part][id] || 0) + ms;
}

function credit(cur, from, to) {
  while (from < to) {
    const d = new Date(from);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const end = Math.min(to, midnight);
    const day = dayKey(from);
    add(day, 'a', cur.app, end - from);
    if (cur.game) {
      add(day, 'g', cur.game.key, end - from);
      S.names[cur.game.key] = cur.game.i ? { t: cur.game.t, i: cur.game.i } : { t: cur.game.t };
    }
    from = end;
  }
  S.dirty = true;
}

/** Credit the time since the last sample, then look at what is in front now. */
function sample() {
  if (!S.on) return;
  const now = Date.now();
  const from = S.last;
  S.last = now;
  const cur = S.cur;
  if (cur && from && now > from && now - from <= MAX_GAP) {
    /* idle: nothing counts past five minutes after the last input,
       unless that window is playing something or holds the focus in a frame */
    const until = cur.media || cur.frame ? now : Math.min(now, S.input + IDLE_MS);
    if (until > from) credit(cur, from, until);
  }
  S.cur = front();
  if (S.dirty && now - S.flushedAt >= FLUSH_MS) flush();
}

function onInput(e) {
  const now = Date.now();
  if ((e.type === 'pointermove' || e.type === 'wheel' || e.type === 'scroll') && now - S.seenInput < 1000) return;
  S.seenInput = now;
  /* back from an idle spell: close the idle stretch (counted up to five
     minutes after the old input) before the input time moves on */
  if (now - S.input >= IDLE_MS) sample();
  S.input = now;
  claim();
}

/* ---------------- one counting tab ----------------------------- */
const ME = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let ch = null;
let lead = null;                      /* { id, at } — the newest claim heard */
const newer = (a, b) => !b || a.at > b.at || (a.at === b.at && a.id > b.id);
function leader() { return !ch || (!!lead && lead.id === ME); }

function claim() {
  if (!ch || leader()) return;
  if (document.visibilityState !== 'visible') return;
  sample();
  lead = { id: ME, at: Date.now() };
  try { ch.postMessage({ t: 'claim', id: lead.id, at: lead.at }); } catch (e) {}
  S.cur = front();
}

function release() {
  if (!ch || !leader()) return;
  lead = null;
  try { ch.postMessage({ t: 'release', id: ME }); } catch (e) {}
}

function onMessage(e) {
  const m = e && e.data;
  if (!m || typeof m !== 'object') return;
  if (m.t === 'claim' && typeof m.id === 'string' && Number.isFinite(m.at)) {
    const theirs = { id: m.id, at: m.at };
    if (!newer(theirs, lead)) {
      /* an older claim from a tab that missed ours: tell it who leads */
      if (leader() && lead) { try { ch.postMessage({ t: 'claim', id: lead.id, at: lead.at }); } catch (er) {} }
      return;
    }
    const was = leader();
    if (was) sample();
    lead = theirs;
    if (was) { S.cur = null; flush(); }
  } else if (m.t === 'release') {
    if (lead && lead.id === m.id) { lead = null; claim(); }
  } else if (m.t === 'hello') {
    if (leader() && lead) { try { ch.postMessage({ t: 'claim', id: lead.id, at: lead.at }); } catch (er) {} }
  } else if (m.t === 'clear') {
    dropPending();
    bus.emit('screentime:change');
  }
}

/* ---------------- lifecycle ------------------------------------ */
function onVisibility() {
  sample();
  if (document.visibilityState === 'visible') { S.input = Date.now(); claim(); S.cur = front(); }
  else { flush(); release(); S.cur = null; }
}

export function init() {
  if (S.on || typeof window === 'undefined') return;
  S.on = true;
  const now = Date.now();
  S.last = now; S.input = now; S.flushedAt = now;
  try { if (typeof BroadcastChannel === 'function') { ch = new BroadcastChannel(CHANNEL); ch.onmessage = onMessage; } } catch (e) { ch = null; }
  if (ch) {
    try { ch.postMessage({ t: 'hello' }); } catch (e) {}
    /* a tab that has just opened is the one being looked at */
    if (document.visibilityState === 'visible') claim();
  }
  S.cur = front();

  const opts = { capture: true, passive: true };
  for (const t of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.addEventListener(t, onInput, opts);
  /* focus moving into a frame (a web game) is the person reaching into it */
  window.addEventListener('blur', () => setTimeout(() => { if (document.activeElement?.tagName === 'IFRAME') onInput({ type: 'frame' }); }, 0));
  window.addEventListener('focus', () => onInput({ type: 'focus' }));
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', () => { sample(); S.cur = null; flush(); release(); });

  bus.on('tick:1s', sample);
  /* what is in front changed: close the stretch at the moment it did */
  for (const ev of ['win:focus', 'win:minimize', 'win:restore', 'win:close', 'desktop:switch']) bus.on(ev, () => sample());
  bus.on('win:playing', () => sample());   /* a game started or stopped inside its window */
}

/* ---------------- reading -------------------------------------- */
/** '45 s', '12 min', '2 h 5 min' — how Screen Time and the weekly recap say a duration. */
export function fmtDur(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  if (s < 60) return s ? `${s} s` : '0 min';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

function dropPending() { S.pending = {}; S.dirty = false; }

function merged(key, data = read()) {
  const stored = data.d[key] || {};
  const p = S.pending[key] || { a: {}, g: {} };
  const out = { a: {}, g: {} };
  for (const part of ['a', 'g']) {
    for (const [id, s] of Object.entries(stored[part] || {})) out[part][id] = secs(s);
    for (const [id, ms] of Object.entries(p[part] || {})) out[part][id] = (out[part][id] || 0) + Math.floor(ms / 1000);
  }
  return out;
}

function shape(key, sums, data = read()) {
  const names = { ...data.n, ...S.names };
  const apps = Object.entries(sums.a).filter(([, s]) => s > 0).map(([id, sec]) => ({ id, sec })).sort((x, y) => y.sec - x.sec);
  const games = Object.entries(sums.g).filter(([, s]) => s > 0).map(([k, sec]) => {
    const i = k.indexOf(':');
    const nm = names[k] || {};
    return { key: k, kind: k.slice(0, i), id: k.slice(i + 1), title: nm.t || k.slice(i + 1), icon: nm.i || null, sec };
  }).sort((x, y) => y.sec - x.sec);
  return { key, total: apps.reduce((n, a) => n + a.sec, 0), apps, games };
}

/** One day: total seconds, apps and games, busiest first. */
export function day(key = dayKey()) { const data = read(); return shape(key, merged(key, data), data); }

/** `days` days ending at endKey (inclusive), summed. */
export function range(days = 7, endKey = dayKey()) {
  const data = read();
  const sums = { a: {}, g: {} };
  for (let i = 0; i < days; i++) {
    const m = merged(shift(endKey, -i), data);
    for (const part of ['a', 'g']) for (const [id, s] of Object.entries(m[part])) sums[part][id] = (sums[part][id] || 0) + s;
  }
  return shape(endKey, sums, data);
}

/** The last seven days, oldest first: [{ key, date, sec }]. */
export function week(endKey = dayKey()) {
  const data = read();
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const key = shift(endKey, -i);
    const m = merged(key, data);
    out.push({ key, date: new Date(dayStart(key)), sec: Object.values(m.a).reduce((n, s) => n + s, 0) });
  }
  return out;
}

/** Forget every day, in every open tab. */
export function clear() {
  dropPending();
  S.names = {};
  try { local.removeItem(KEY); } catch (e) {}
  try { ch && ch.postMessage({ t: 'clear' }); } catch (e) {}
  bus.emit('screentime:change');
}

export const status = () => ({ leader: leader(), counting: !!S.cur, front: S.cur ? { ...S.cur, game: S.cur.game ? S.cur.game.key : null } : null, idleFor: Date.now() - S.input });

export default { init, day, range, week, clear, flush, status, dayKey, fmtDur, KEY, IDLE_MS, KEEP_DAYS };
