/* ============================================================
   alarms.js — Clock's alarms and named timers, kept by the OS.

   They live here, not in the Clock window, so they ring with the
   window closed — while StaticOS is open. A closed or sleeping tab
   can't wake itself, and Clock says so; nothing here pretends to be
   a phone alarm.

   Alarms (store 'prefs.clock.alarms', per person):
     { id, time 'HH:MM', label, enabled,
       days     [0–6] the weekdays it repeats on (0 = Sunday); [] rings
                once, then switches itself off; no days at all (alarms
                made before repeat days existed) rings every day
       radio    optional: a SomaFM station id (js/core/stations.js) to play when it rings —
                set from Static Radio's "Wake-up alarm"; it plays the station instead of
                repeating the chime, and works only while StaticOS is open
       snooze   minutes Snooze puts it off by (5–30, default 10)
       sound    one of sfx.ALARMS
       lastFired 'YYYY-MM-DDTHH:MM' (local), so a minute rings once
       snoozeUntil  ms (wall clock) when a snoozed alarm rings again }
   An alarm whose minute passed while StaticOS was closed is not rung
   late; a snooze that came due meanwhile rings when it is next open.

   Timers (store 'prefs.clock.timers'): several, each with a name.
     { id, name, total ms, left ms, endAt ms, status 'ready' | 'running'
       | 'paused' | 'done', sound }
   A running timer keeps its end time from the wall clock (as the Focus
   timer does), so a reload or a sleeping laptop can't stretch it; one
   that ended while nobody looked rings on the next look, and says when
   it ended.

   Ringing: the chosen sound (sfx.alarm) every few seconds for up to
   30 seconds and a notification with Stop and Snooze (alarms) or Stop
   and Restart (timers). bus 'clock:ring' and 'clock:change' let the
   Clock window follow.

     init()   timers()  addTimer({ name, ms, sound })  startTimer(id)
     pauseTimer(id)  resetTimer(id)  removeTimer(id)  left(t)
     alarms()  addAlarm(a)  updateAlarm(id, patch)  removeAlarm(id)
     ringing() -> [{ id, kind, title }]  stop(id)  snooze(id)
     repeatText(days)  SNOOZES
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';
import * as sfx from './sfx.js';

export const A_KEY = 'prefs.clock.alarms';
export const T_KEY = 'prefs.clock.timers';
export const SNOOZES = [5, 10, 15, 20, 30];
export const MAX_TIMERS = 12, MAX_ALARMS = 30;
const RING_EVERY = 3000, RING_FOR = 30000;
const NAME_MAX = 40;

const pad2 = n => String(n).padStart(2, '0');
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const stampOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const emit = () => bus.emit('clock:change');

/* ---------------- alarms ---------------- */
function normAlarm(a) {
  if (!a || typeof a !== 'object' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) return null;
  const out = {
    id: String(a.id || uid('a')).slice(0, 40), time: a.time, label: clean(a.label, NAME_MAX), enabled: a.enabled !== false,
    snooze: SNOOZES.includes(Number(a.snooze)) ? Number(a.snooze) : 10, sound: sfx.alarmId(a.sound),
    lastFired: typeof a.lastFired === 'string' ? a.lastFired : '',
  };
  if (typeof a.radio === 'string' && /^[a-z0-9]{2,20}$/.test(a.radio)) out.radio = a.radio;
  if (Array.isArray(a.days)) out.days = [...new Set(a.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (Number.isFinite(a.snoozeUntil) && a.snoozeUntil > 0) out.snoozeUntil = a.snoozeUntil;
  return out;
}
export const alarms = () => (Array.isArray(store.get(A_KEY)) ? store.get(A_KEY) : []).map(normAlarm).filter(Boolean);
const saveAlarms = list => { store.set(A_KEY, list.map(a => ({ ...a }))); emit(); };
export function addAlarm(a) {
  const list = alarms();
  if (list.length >= MAX_ALARMS) return null;
  const n = normAlarm({ ...a, id: uid('a'), enabled: true, lastFired: '' });
  if (!n) return null;
  saveAlarms([...list, n]);
  return n;
}
export function updateAlarm(id, patch) {
  saveAlarms(alarms().map(a => (a.id === id ? normAlarm({ ...a, ...patch, id }) || a : a)));
}
export function removeAlarm(id) { stop(id); saveAlarms(alarms().filter(a => a.id !== id)); }

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Every day", "Weekdays", "Weekends", "Mon, Wed", "Once" */
export function repeatText(days) {
  if (!Array.isArray(days) || days.length === 7) return 'Every day';
  if (!days.length) return 'Once';
  const k = days.join();
  if (k === '1,2,3,4,5') return 'Weekdays';
  if (k === '0,6') return 'Weekends';
  return [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).map(d => DAY[d]).join(', ');
}

/* ---------------- timers ---------------- */
function normTimer(t) {
  if (!t || typeof t !== 'object') return null;
  const total = Math.round(Number(t.total));
  if (!(total >= 1000 && total <= 24 * 3600_000)) return null;
  const status = ['ready', 'running', 'paused', 'done'].includes(t.status) ? t.status : 'ready';
  const out = { id: String(t.id || uid('t')).slice(0, 40), name: clean(t.name, NAME_MAX) || 'Timer', total, sound: sfx.alarmId(t.sound), status,
    left: Number.isFinite(t.left) ? Math.max(0, Math.min(total, t.left)) : total, endAt: Number(t.endAt) || 0 };
  if (status === 'running' && !out.endAt) out.status = 'ready';
  return out;
}
export const timers = () => (Array.isArray(store.get(T_KEY)) ? store.get(T_KEY) : []).map(normTimer).filter(Boolean);
const saveTimers = list => { store.set(T_KEY, list.map(t => ({ ...t }))); emit(); };
const edit = (id, fn) => saveTimers(timers().map(t => (t.id === id ? fn({ ...t }) : t)));
/** ms left on a timer, now */
export const left = (t, now = Date.now()) => (t.status === 'running' ? Math.max(0, t.endAt - now) : t.status === 'done' ? 0 : t.left);
export function addTimer({ name, ms, sound, start = false }) {
  const list = timers();
  if (list.length >= MAX_TIMERS) return null;
  const t = normTimer({ id: uid('t'), name, total: ms, left: ms, sound, status: 'ready' });
  if (!t) return null;
  if (start) { t.status = 'running'; t.endAt = Date.now() + t.total; }
  saveTimers([...list, t]);
  return t;
}
export function startTimer(id) {
  stop(id);
  edit(id, t => {
    if (t.status === 'running') return t;
    if (t.status === 'done' || t.left <= 0) t.left = t.total;
    t.status = 'running'; t.endAt = Date.now() + t.left;
    return t;
  });
}
export function pauseTimer(id) {
  edit(id, t => (t.status === 'running' ? { ...t, status: 'paused', left: Math.max(0, t.endAt - Date.now()), endAt: 0 } : t));
}
export function resetTimer(id) { stop(id); edit(id, t => ({ ...t, status: 'ready', left: t.total, endAt: 0 })); }
export function removeTimer(id) { stop(id); saveTimers(timers().filter(t => t.id !== id)); }

/* ---------------- ringing ---------------- */
const RINGING = new Map();     /* id -> { kind, title, until, iv } */
export const ringing = () => [...RINGING.entries()].map(([id, r]) => ({ id, kind: r.kind, title: r.title }));
const fmtClock = hhmm => {
  const [H, M] = hhmm.split(':').map(Number);
  return store.get('prefs.h24', false) ? `${pad2(H)}:${pad2(M)}` : `${H % 12 || 12}:${pad2(M)} ${H < 12 ? 'AM' : 'PM'}`;
};
export const fmtLen = ms => {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : '', x ? `${x} s` : ''].filter(Boolean).join(' ') || '0 s';
};

function ring(id, kind, sound, note) {
  stop(id, true);
  const r = { kind, title: note.title, until: Date.now() + RING_FOR, iv: 0 };
  RINGING.set(id, r);
  if (!note.quiet) sfx.alarm(sound);                         /* a radio alarm lets the station be the sound */
  r.iv = setInterval(() => {
    if (!RINGING.has(id) || Date.now() >= r.until) { stop(id); return; }
    if (!note.quiet) sfx.alarm(sound);
  }, RING_EVERY);
  bus.emit('noti:push', {
    app: 'Clock', icon: kind === 'alarm' ? 'bell' : 'clock', title: note.title, message: note.message, timeout: 0,
    key: `clock-ring-${id}`, quiet: true,                    /* it brings its own sound */
    onClick: () => { stop(id); openClock(kind === 'alarm' ? 'alarm' : 'timer'); },
    actions: note.actions,
  });
  bus.emit('clock:ring', { id, kind, on: true });
}
/** Stop a ringing alarm or timer (the notification stays in the centre as a record). */
export function stop(id, quiet) {
  const r = RINGING.get(id);
  if (!r) return;
  clearInterval(r.iv);
  RINGING.delete(id);
  if (!quiet) bus.emit('clock:ring', { id, kind: r.kind, on: false });
}
/** Snooze a ringing alarm by its own snooze length. */
export function snooze(id) {
  const a = alarms().find(x => x.id === id);
  stop(id);
  if (!a) return;
  updateAlarm(id, { snoozeUntil: Date.now() + a.snooze * 60_000, enabled: true });
}
function openClock(tab) { import('./wm.js').then(wm => wm.open('clock', { tab })).catch(() => {}); }

function ringAlarm(a, snoozed) {
  ring(a.id, 'alarm', a.sound, {
    title: `${snoozed ? 'Snoozed alarm' : 'Alarm'} — ${fmtClock(a.time)}`,
    message: a.label || 'Your alarm is ringing.',
    quiet: !!a.radio,
    actions: [{ label: `Snooze ${a.snooze} min`, onClick: () => { snooze(a.id); if (a.radio) bus.emit('media:pause'); } }, { label: 'Stop', onClick: () => stop(a.id) }],
  });
  /* a wake-up alarm from Static Radio: tune in (core/radioalarm.js) */
  if (a.radio) import('./radioalarm.js').then(m => m.start(a)).catch(() => {});
}
function ringTimer(t, late) {
  const at = new Date(t.endAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !store.get('prefs.h24', false) });
  ring(t.id, 'timer', t.sound, {
    title: `${t.name} — time’s up`,
    message: late ? `${fmtLen(t.total)} is up — it ended at ${at}, while this page couldn’t ring.` : `${fmtLen(t.total)} is up.`,
    actions: [{ label: 'Stop', onClick: () => stop(t.id) }, { label: 'Restart', onClick: () => startTimer(t.id) }],
  });
}

/* ---------------- the clock ---------------- */
export function check(now = Date.now()) {
  /* timers that have run out */
  const ts = timers();
  const due = ts.filter(t => t.status === 'running' && now >= t.endAt);
  if (due.length) {
    saveTimers(ts.map(t => (due.includes(t) ? { ...t, status: 'done', left: 0 } : t)));
    for (const t of due) ringTimer(t, now - t.endAt > 5000);
  }
  /* alarms: their minute, or a snooze that has come due */
  const d = new Date(now);
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, stamp = stampOf(d), dow = d.getDay();
  const list = alarms();
  let changed = false;
  const fire = [];
  const next = list.map(a => {
    if (!a.enabled) return a;
    if (a.snoozeUntil && now >= a.snoozeUntil) {
      changed = true; fire.push([a, true]);
      const { snoozeUntil, ...rest } = a;
      return Array.isArray(a.days) && !a.days.length ? { ...rest, enabled: false } : rest;   /* a "Once" alarm is done after its snooze too */
    }
    const today = !Array.isArray(a.days) || !a.days.length || a.days.includes(dow);
    if (a.time === hhmm && a.lastFired !== stamp && today) {
      changed = true;
      fire.push([a, false]);
      /* "Once" switches itself off after ringing */
      return { ...a, lastFired: stamp, enabled: !(Array.isArray(a.days) && !a.days.length) };
    }
    return a;
  });
  if (changed) saveAlarms(next);
  for (const [a, snoozed] of fire) ringAlarm(a, snoozed);
}

let on = false;
export function init() {
  if (on || typeof window === 'undefined') return;
  on = true;
  bus.on('tick:1s', () => check());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  check();
}

export default { init, check, alarms, addAlarm, updateAlarm, removeAlarm, timers, addTimer, startTimer, pauseTimer, resetTimer, removeTimer, left, ringing, stop, snooze, repeatText, fmtLen, SNOOZES, MAX_TIMERS, A_KEY, T_KEY };
