/* ============================================================
   automations.js — the rules engine behind Static Automations.

   A rule is one sentence: "When <this happens>, <do these
   things>". Rules live in store('portal.automations') as

     [{ id, name, enabled, when, then: [action, …] }]

   and this module listens for the real OS events that start
   them. Nothing is polled, nothing is scheduled and nothing runs
   anywhere but this page:

     app-open     bus 'win:open' — a window was created; its .appId
     game-launch  bus 'game:launch' — plays.js records every launch
                  (Static Games, Arcade, your own creations)
     startup      checked once, when init() runs, against this
                  computer's own clock:
                    night   20:00–05:59   day      06:00–19:59
                    morning 05:00–11:59   always   any time
     gamemode-on  Game Mode going from off to on: store
                  'prefs.gameMode' by hand (store.sub on the key
                  and on 'prefs', since some writers replace the
                  whole prefs object), or on by itself for a game
                  in front (bus 'gamemode:change', gamemode.js)

   Actions change exactly the setting the rest of the OS already
   reads, and each one reports what really happened — "was
   already on" is a result, not a success story:

     open-app   api.openApp(id)            gamemode  prefs.gameMode
     widgets    prefs.widgetsVisible       accent    prefs.accent
     wallpaper  portal/wallpapers.js setActive(store, id)
     music      bus 'media:play' / 'media:pause' (Music's player),
                then watches 'media:track' to see whether sound
                actually started
     notify     api.notify(…)

   Safety, because one rule's action can set off another rule:
   · a rule fires at most once per COOLDOWN_MS (5 s);
   · a rule is never set off by its own actions, however many
     rules sit in between — every run carries the chain of rules
     that led to it, and a rule already in its chain is held back;
   · a chain stops after MAX_CHAIN rules, a rule runs at most
     MAX_ACTIONS actions, and a rule still finishing its last run
     (a wallpaper list loading) is not started twice;
   · triggers run one microtask after the event, so a rule never
     runs inside the window manager's open() or a store notify.

   When a rule opens an app because you opened another one (or
   launched a game), the window you were using is put back in
   front afterwards — the automation happens around you, it does
   not take over the screen. "Run now" leaves the new window up.

   Every run — and every rule held back or skipped, with why —
   goes in an in-memory log (log(), onLog(fn)) that the app
   shows. It is not saved: rules only run while StaticOS is open
   in this browser, and the log only covers this session.

   Two simpler things sit beside the rules and use the same log:

   Startup apps  store('portal.startupApps') = { enabled, apps:[id…] }
                 — opened in that order once StaticOS has finished
                 starting (bus 'boot:ready', after the session
                 restore), so they land on top of it and the last
                 one ends up in front. An app that already has a
                 window is brought forward, never opened twice.

   Reminders     store('portal.reminders') = [{ id, text, time:'HH:MM',
                 repeat:'once'|'daily'|'weekdays'|'weekly', date:'YYYY-MM-DD'
                 (once: the day; weekly: the first one, whose weekday
                 it repeats on), skip:['YYYY-MM-DD'] (weekly days left
                 out), enabled, created, updated, last, missed, snooze,
                 cal, sub }] — a notification at that time on
                 this computer's clock. One timer, never longer
                 than 30 s, so a laptop waking up or a paused tab
                 catches up; a reminder may go off up to 10 minutes
                 late (it says so), and later than that it counts
                 as missed. A reminder only goes off while
                 StaticOS is open: one that came due while it was
                 closed is not fired after the fact — a one-off is
                 marked Missed and you're told once, next start.
                 `last` is the occurrence that went off, so a
                 reload never repeats one.

                 Calendar's event reminders are reminders too, so
                 there is one clock-watcher and one notification
                 path: js/core/calendar.js hands the reminders its
                 events want to syncCalendarReminders(), each one
                 carrying `cal` (the event's id) and `sub` (the line
                 under the title, "Starts at 9:00 AM"). Those go off
                 as Calendar notifications, are listed here marked
                 as Calendar's, and are changed in Calendar. They
                 have their own allowance (MAX_CAL_REMINDERS), so
                 a busy calendar never uses up yours. Other apps'
                 come through syncSourceReminders with a `src`:
                 'study' (Homework) and 'friends' (Social's game
                 nights — urgent, so never held back, but they don't
                 break through Do Not Disturb).

   The lead calls init() once after boot.
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import api from './api.js?v=ps5-cloud-proxy-v11';
import * as THEMES from './themes.js';

export const STORE_KEY = 'portal.automations';
export const MAX_ACTIONS = 10;
export const MAX_RULES = 50;
export const COOLDOWN_MS = 5000;
export const MAX_CHAIN = 4;
export const NAME_MAX = 60;
export const TEXT_MAX = 140;
const MAX_LOG = 120;
const MUSIC_WAIT_MS = 4000;

export const STARTUP_KEY = 'portal.startupApps';
export const MAX_STARTUP_APPS = 8;
export const REMINDERS_KEY = 'portal.reminders';
export const MAX_REMINDERS = 40;
export const MAX_CAL_REMINDERS = 120;             /* Calendar's own allowance, on top of yours */
export const REMINDER_LATE_MS = 10 * 60 * 1000;   /* how late a reminder may still go off */
export const SNOOZE_MIN = 10;
const REMINDER_TICK_MS = 30 * 1000;               /* the longest the reminder timer ever waits */
const MAX_SKIP = 200;
export const REPEATS = [
  { id: 'once', label: 'Once', phrase: '' },
  { id: 'daily', label: 'Every day', phrase: 'Every day' },
  { id: 'weekdays', label: 'Weekdays (Mon–Fri)', phrase: 'Weekdays' },
  { id: 'weekly', label: 'Every week', phrase: 'Every week' },
];
/* repeats that are pinned to a date: the day itself, or the first of the weekly run */
const dated = repeat => repeat === 'once' || repeat === 'weekly';

/* ---------- vocabulary ---------------------------------------------- */
export const TRIGGER_TYPES = ['app-open', 'game-launch', 'startup', 'gamemode-on'];
export const ACTION_TYPES = ['open-app', 'gamemode', 'widgets', 'wallpaper', 'accent', 'music', 'notify'];

/* hour ranges are [from, to) on the local clock; night wraps midnight */
export const WINDOWS = [
  { id: 'always', label: 'at any time', phrase: '', from: 0, to: 24 },
  { id: 'night', label: 'at night', phrase: 'at night', from: 20, to: 6 },
  { id: 'day', label: 'during the day', phrase: 'during the day', from: 6, to: 20 },
  { id: 'morning', label: 'in the morning', phrase: 'in the morning', from: 5, to: 12 },
];

/** The brief's four examples, as rules you can add in one go. */
export const PRESETS = [
  { id: 'games-music', when: { type: 'app-open', app: 'aether-games' }, then: [{ type: 'open-app', app: 'music' }] },
  { id: 'launch-gamemode', when: { type: 'game-launch' }, then: [{ type: 'gamemode', on: true }] },
  { id: 'anime-widgets', when: { type: 'app-open', app: 'aether-anime' }, then: [{ type: 'widgets', visible: false }] },
  { id: 'night-lamplight', when: { type: 'startup', when: 'night' }, then: [{ type: 'wallpaper', id: 'lamplight' }] },
];

/* The wallpaper module lives with the portal; load it once, off the boot
   path, and keep the failure to itself rather than breaking the engine. */
let WP = null;
let wpErr = null;
const wpReady = import('../portal/wallpapers.js')
  .then(m => { WP = m; return m; })
  .catch(err => { wpErr = err; console.warn('[automations] wallpapers unavailable', err); return null; });
/** Resolves once the wallpaper names are known (the app waits on it). */
export const ready = () => wpReady;

/* ---------- small helpers ------------------------------------------- */
const str = (v, max = 80) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const errMsg = err => String((err && err.message) || err || 'unknown error').slice(0, 140);
const uid = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const pretty = id => String(id || '').replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());

export const appName = id => { const a = id ? api.getApp(id) : null; return a ? a.name : null; };
export const themeName = id => (THEMES.isTheme(id) ? THEMES.themeById(id).name : null);
export function wallpaperName(id) {
  if (!id) return null;
  const w = WP ? WP.byId(store, id) : null;
  return w ? w.name : pretty(id);
}

/* what the editor's dropdowns offer — only things this computer really has */
export const accentChoices = () => THEMES.THEMES.map(t => ({ id: t.id, name: t.name }));
/** 'loading' | 'ready' | 'failed' — whether the wallpaper module has loaded. */
export const wallpaperStatus = () => (WP ? 'ready' : wpErr ? 'failed' : 'loading');
/** Wallpapers you can pick (built-in + unlocked). Empty until ready() resolves. */
export const wallpaperChoices = () => (WP ? WP.list(store) : [])
  .map(w => ({ id: w.id, name: w.name, theme: w.theme && THEMES.isTheme(w.theme) ? THEMES.themeById(w.theme).name : null }));

/** 9:41 PM, or 21:41 when the clock is set to 24-hour. */
export function clock(t) {
  const d = t instanceof Date ? t : new Date(t);
  try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !store.get('prefs.h24') }); }
  catch (e) { return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }
}
const hourLabel = h => clock(new Date(2000, 0, 1, h % 24, 0));
/** "8:00 PM – 6:00 AM" for a window, from its own numbers. */
export function windowHours(id) {
  const w = WINDOWS.find(x => x.id === id);
  if (!w || w.id === 'always') return 'any time';
  return `${hourLabel(w.from)} – ${hourLabel(w.to)}`;
}
export function inWindow(id, date = new Date()) {
  const w = WINDOWS.find(x => x.id === id);
  if (!w || w.id === 'always') return true;
  const h = date.getHours();
  return w.from < w.to ? (h >= w.from && h < w.to) : (h >= w.from || h < w.to);
}

/* ---------- shape guards: the store is the only input, treat it as untrusted */
export function normWhen(w) {
  const o = w && typeof w === 'object' ? w : {};
  switch (o.type) {
    case 'app-open': return { type: 'app-open', app: str(o.app, 60) };
    case 'game-launch': return { type: 'game-launch' };
    case 'startup': return { type: 'startup', when: WINDOWS.some(x => x.id === o.when) ? o.when : 'always' };
    case 'gamemode-on': return { type: 'gamemode-on' };
    default: return null;
  }
}
export function normAction(a) {
  const o = a && typeof a === 'object' ? a : {};
  switch (o.type) {
    case 'open-app': return { type: 'open-app', app: str(o.app, 60) };
    case 'gamemode': return { type: 'gamemode', on: o.on !== false };
    case 'widgets': return { type: 'widgets', visible: !!o.visible };
    case 'wallpaper': return { type: 'wallpaper', id: str(o.id, 60) };
    case 'accent': return { type: 'accent', id: str(o.id, 40) };
    case 'music': return { type: 'music', action: o.action === 'pause' ? 'pause' : 'play' };
    case 'notify': return { type: 'notify', text: str(o.text, TEXT_MAX) };
    default: return null;
  }
}
/** A clean copy of one rule, or null when it has no trigger this build knows. */
export function normRule(r, i = 0) {
  const o = r && typeof r === 'object' ? r : null;
  if (!o) return null;
  const when = normWhen(o.when);
  if (!when) return null;
  return {
    id: str(o.id, 60) || `rule-${i + 1}`,
    name: str(o.name, NAME_MAX),
    enabled: o.enabled !== false,
    when,
    then: (Array.isArray(o.then) ? o.then : []).map(normAction).filter(Boolean).slice(0, MAX_ACTIONS),
  };
}

/** A fresh rule for the editor: nothing chosen that the person didn't choose. */
export function blankRule() {
  return { id: uid(), name: '', enabled: true, when: { type: 'app-open', app: '' }, then: [] };
}
export const newId = uid;

/* ---------- rules ---------------------------------------------------- */
/** Two rules must never share an id: it keys the cooldown, the busy flag, the
    loop guard and every control in the app. The suffix is worked out from the
    list itself, so the same stored list always yields the same ids — a random
    one would hand a rule a fresh cooldown slot on every read. */
function uniqueId(id, seen) {
  if (!seen.has(id)) return id;
  let k = 2;
  while (seen.has(`${id}~${k}`)) k++;
  return `${id}~${k}`;
}

/** Every saved rule this build understands, cleaned and with unique ids. */
export function rules() {
  const v = store.get(STORE_KEY);
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const [i, r] of v.entries()) {
    const n = normRule(r, i);
    if (!n) continue;
    n.id = uniqueId(n.id, seen);
    seen.add(n.id);
    out.push(n);
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

/** Persist a whole list (a new array every time — store.set ignores the same reference). */
export function save(list) {
  const seen = new Set();
  const clean = [];
  for (const [i, r] of (Array.isArray(list) ? list : []).entries()) {
    const n = normRule(r, i);
    if (!n) continue;
    n.id = uniqueId(n.id, seen);
    seen.add(n.id);
    clean.push(n);
    if (clean.length >= MAX_RULES) break;
  }
  store.set(STORE_KEY, clean);
  return rules();
}

/* ---------- sentences -------------------------------------------------
   Parts are [text, emphasised?] so the app can set the chosen words in
   bold while the log and the notifications use the plain string. */
export function whenParts(w) {
  switch (w && w.type) {
    case 'app-open': return [['When I open '], [appName(w.app) || (w.app ? pretty(w.app) : 'an app'), 1]];
    case 'game-launch': return [['When I '], ['launch a game', 1]];
    case 'startup': {
      const win = WINDOWS.find(x => x.id === w.when);
      return win && win.phrase ? [['When '], ['StaticOS', 1], [' starts '], [win.phrase, 1]] : [['When '], ['StaticOS', 1], [' starts']];
    }
    case 'gamemode-on': return [['When '], ['Game Mode', 1], [' turns on']];
    default: return [['When something happens']];
  }
}
export function actionParts(a) {
  switch (a && a.type) {
    case 'open-app': return [['open '], [appName(a.app) || (a.app ? pretty(a.app) : 'an app'), 1]];
    case 'gamemode': return [[`turn ${a.on ? 'on' : 'off'} `], ['Game Mode', 1]];
    case 'widgets': return [[a.visible ? 'show ' : 'hide '], ['the widgets', 1]];
    case 'wallpaper': return [['use the '], [wallpaperName(a.id) || '…', 1], [' wallpaper']];
    case 'accent': return [['switch the accent to '], [themeName(a.id) || '…', 1]];
    case 'music': return a.action === 'pause' ? [['pause '], ['the music', 1]] : [['play '], ['music', 1]];
    case 'notify': return [['show the notification '], [`“${String(a.text || '').trim() || '…'}”`, 1]];
    default: return [['do something this version doesn’t know']];
  }
}
export function sentence(rule) {
  const r = rule || {};
  const out = [...whenParts(r.when), [', ']];
  const acts = Array.isArray(r.then) ? r.then : [];
  if (!acts.length) out.push(['do nothing yet']);
  acts.forEach((a, i) => {
    if (i > 0) out.push([i === acts.length - 1 ? ' and ' : ', ']);
    out.push(...actionParts(a));
  });
  out.push(['.']);
  return out;
}
export const plain = parts => parts.map(p => p[0]).join('');
export const describe = rule => plain(sentence(rule));
export const describeAction = a => { const s = plain(actionParts(a)); return s.charAt(0).toUpperCase() + s.slice(1); };
/** What the rule is called: its own name, or its sentence. */
export const label = rule => (rule && String(rule.name || '').trim()) || describe(rule);

/** Problems with a rule. 'error' blocks saving; 'warn' means it can't fully run right now. */
export function issues(rule) {
  const out = [];
  const r = rule || {};
  const w = r.when || {};
  if (w.type === 'app-open') {
    if (!w.app) out.push({ level: 'error', at: 'when', text: 'Pick the app that starts this rule.' });
    else if (!api.getApp(w.app)) out.push({ level: 'warn', at: 'when', text: `“${pretty(w.app)}” isn’t available in this session, so this rule can’t start.` });
  }
  const acts = Array.isArray(r.then) ? r.then : [];
  if (!acts.length) out.push({ level: 'error', at: 'then', text: 'Add at least one action.' });
  acts.forEach((a, i) => {
    switch (a.type) {
      case 'open-app':
        if (!a.app) out.push({ level: 'error', at: i, text: 'Pick an app to open.' });
        else if (!api.getApp(a.app)) out.push({ level: 'warn', at: i, text: `“${pretty(a.app)}” isn’t available in this session.` });
        break;
      case 'wallpaper': {
        if (!a.id) { out.push({ level: 'error', at: i, text: 'Pick a wallpaper.' }); break; }
        const wp = WP ? WP.byId(store, a.id) : null;
        if (WP && !wp) out.push({ level: 'warn', at: i, text: `The “${pretty(a.id)}” wallpaper isn’t available any more.` });
        else if (WP && wp && !WP.isUnlocked(store, wp)) out.push({ level: 'warn', at: i, text: `${wp.name} is still locked.` });
        break;
      }
      case 'accent':
        if (!THEMES.isTheme(a.id)) out.push({ level: 'error', at: i, text: 'Pick an accent colour.' });
        break;
      case 'notify':
        if (!String(a.text || '').trim()) out.push({ level: 'error', at: i, text: 'Write what the notification should say.' });
        break;
      case 'music':
        if (!api.getApp('music')) out.push({ level: 'warn', at: i, text: 'Music isn’t available in this session.' });
        break;
      default: break;
    }
  });
  return out;
}

/* ---------- the run log (memory only) -------------------------------- */
const LOG = [];
const logSubs = new Set();
let seq = 0;

function copyEntry(e) {
  return {
    id: e.id, at: e.at, ruleId: e.ruleId, rule: e.rule, source: e.source, cause: e.cause,
    via: e.via, chain: e.chain.slice(), status: e.status, note: e.note,
    steps: e.steps.map(s => ({ what: s.what, state: s.state, result: s.result })),
  };
}
/** The log, newest first. Entries are copies; each is
    { id, at, ruleId, rule, source, cause, via, chain, status, note, steps:[{what,state,result}] }
    status: running | ok | warn | failed | held | skipped
    step state: wait | ok | same | warn | fail */
export const log = () => LOG.map(copyEntry);
/** fn(entryCopy | null) on every change; returns an unsubscribe. */
export function onLog(fn) {
  if (typeof fn !== 'function') return () => {};
  logSubs.add(fn);
  return () => { logSubs.delete(fn); };
}
export function clearLog() { LOG.length = 0; changed(null); }
function changed(e) {
  const c = e ? copyEntry(e) : null;
  logSubs.forEach(fn => { try { fn(c); } catch (err) { console.error('[automations] log listener', err); } });
}
function record(e) {
  LOG.unshift(e);
  if (LOG.length > MAX_LOG) LOG.length = MAX_LOG;
  changed(e);
  return e;
}

/* ---------- engine state --------------------------------------------- */
let started = false;
let since = 0;
let startup = null;            /* { at, ran, skipped } once startup rules were checked */
let offs = [];
let current = null;            /* the run whose action is executing right now (synchronous only) */
const lastRun = new Map();     /* rule id → ms of its last triggered run */
const busy = new Set();        /* rule ids with a run still settling */
const pending = new Set();     /* timers + listeners of music checks, cleared on stop() */
const fronts = new WeakMap();  /* log entry → the window to keep in front after it (never copied out) */
let gmOn = false;

/* What Music says is playing. Listened to from load, not from init(), so
   "Run now" reports honestly even before the engine is started. */
let lastTrack = null;
bus.on('media:track', t => { lastTrack = t && typeof t === 'object' ? t : null; });

export const status = () => ({
  running: started,
  since: started ? since : null,
  startup: startup ? { ...startup } : null,
});

function causeText(c) {
  if (c.source === 'manual') return 'Run now';
  if (c.source === 'test') return 'Run now, from the editor';
  if (c.source === 'startup') return `StaticOS started at ${clock(c.at)}`;
  if (c.source === 'reminder') {
    const late = Math.floor((c.late || 0) / 60000);
    const base = c.snoozed ? `Snoozed reminder, due ${clock(c.at)}` : `Reminder for ${clock(c.at)}`;
    return late >= 1 ? `${base} — went off ${late} min late (this tab or computer was asleep)` : base;
  }
  const d = c.detail || {};
  switch (c.type) {
    case 'app-open': return `${appName(d.app) || pretty(d.app)} opened`;
    case 'game-launch': return d.title ? `${d.title} launched` : 'A game launched';
    case 'gamemode-on': return d.auto ? 'Game Mode came on for the game in front' : 'Game Mode turned on';
    default: return 'Something happened';
  }
}

function entryFor(rule, cause) {
  const p = cause.parent || null;
  return {
    id: ++seq, at: Date.now(), ruleId: rule.id, rule: label(rule).slice(0, 160),
    source: cause.source, cause: causeText(cause),
    via: p ? p.rule : null,
    chain: p ? [...p.chain, p.ruleId] : [],
    status: 'running', note: null, steps: [],
  };
}
const held = (e, why) => { e.status = 'held'; e.note = why; return record(e); };

function summarize(e) {
  const st = e.steps.map(s => s.state);
  if (!st.length) return 'ok';
  if (st.every(s => s === 'fail')) return 'failed';
  if (st.some(s => s === 'fail' || s === 'warn')) return 'warn';
  if (st.some(s => s === 'wait')) return 'running';
  return 'ok';
}

/* ---------- actions -------------------------------------------------- */
const done = (step, state, result) => { step.state = state; step.result = result; };

const ACT = {
  'open-app'(a, step) {
    const app = a.app ? api.getApp(a.app) : null;
    if (!app) return done(step, 'fail', a.app ? `Couldn’t open “${pretty(a.app)}” — that app isn’t available in this session` : 'No app was picked');
    const before = api.wm ? api.wm.byApp(app.id) : [];
    /* a one-window app that is already up stays exactly where it is */
    if (app.singleton && before.length && !before.some(x => x.min)) return done(step, 'same', `${app.name} was already open`);
    const w = api.openApp(app.id);
    if (!w) return done(step, 'fail', `${app.name} didn’t open`);
    step.opened = true;
    if (app.singleton && before.length) return done(step, 'ok', `Brought ${app.name} back from the Dock`);
    return done(step, 'ok', `Opened ${app.name}`);
  },

  gamemode(a, step) {
    const was = !!store.get('prefs.gameMode');
    if (was === a.on) return done(step, 'same', `Game Mode was already ${a.on ? 'on' : 'off'}`);
    store.set('prefs.gameMode', a.on);
    const stillOn = !a.on && typeof document !== 'undefined' && document.documentElement.dataset.gamemode === 'on';
    return done(step, 'ok', a.on ? 'Turned Game Mode on'
      : stillOn ? 'Turned Game Mode off (it stays on by itself while a game is in front)' : 'Turned Game Mode off');
  },

  widgets(a, step) {
    const was = store.get('prefs.widgetsVisible') !== false;
    if (was === a.visible) return done(step, 'same', `The widgets were already ${a.visible ? 'showing' : 'hidden'}`);
    store.set('prefs.widgetsVisible', a.visible);
    return done(step, 'ok', a.visible ? 'Showed the widgets' : 'Hid the widgets');
  },

  wallpaper(a, step) {
    const apply = M => {
      if (!M) return done(step, 'fail', `Couldn’t load the wallpaper list${wpErr ? ` (${errMsg(wpErr)})` : ''}`);
      const w = M.byId(store, a.id);
      if (!w) return done(step, 'fail', `The “${pretty(a.id)}” wallpaper isn’t available any more`);
      if (!M.isUnlocked(store, w)) return done(step, 'fail', `${w.name} is still locked`);
      const cur = M.active(store);
      if (cur && cur.id === w.id) return done(step, 'same', `${w.name} was already the wallpaper`);
      if (!M.setActive(store, w.id)) return done(step, 'fail', `${w.name} couldn’t be applied`);
      const t = w.theme ? themeName(w.theme) : null;
      return done(step, 'ok', t ? `Switched the wallpaper to ${w.name} (its ${t} accent came with it)` : `Switched the wallpaper to ${w.name}`);
    };
    if (WP || wpErr) return apply(WP);
    step.result = 'Loading the wallpaper list…';
    return wpReady.then(apply);
  },

  accent(a, step) {
    if (!THEMES.isTheme(a.id)) return done(step, 'fail', a.id ? `“${a.id}” isn’t one of the StaticOS accents` : 'No accent colour was picked');
    const t = THEMES.themeById(a.id);
    if (THEMES.canonId(store.get('prefs.accent')) === t.id) return done(step, 'same', `The accent was already ${t.name}`);
    store.set('prefs.accent', t.id);
    return done(step, 'ok', `Switched the accent to ${t.name}`);
  },

  music(a, step, e) {
    if (!api.getApp('music')) return done(step, 'fail', 'Music isn’t available in this session');
    const playing = !!(lastTrack && lastTrack.playing);
    const title = lastTrack && lastTrack.title && lastTrack.title !== 'Nothing playing' ? ` “${lastTrack.title}”` : '';
    if (a.action === 'pause') {
      if (!playing) return done(step, 'same', 'Nothing was playing');
      bus.emit('media:pause');
      return done(step, 'ok', `Paused${title || ' the music'}`);
    }
    if (playing) return done(step, 'same', `Music was already playing${title}`);
    /* Music answers on 'media:track' when something really starts. Listen
       first — it can answer synchronously — then ask. */
    done(step, 'wait', 'Asked Music to play…');
    const job = {};
    const finish = t => {
      if (job.over) return;
      job.over = true;
      job.off(); clearTimeout(job.timer); pending.delete(job);
      if (t && t.playing) {
        const tt = t.title && t.title !== 'Nothing playing' ? ` “${t.title}”` : '';
        done(step, 'ok', `Music is playing${tt}`);
      } else {
        done(step, 'warn', 'Asked Music to play, but nothing started within 4 seconds — it may have nothing to play yet');
      }
      e.status = summarize(e);
      changed(e);
    };
    job.off = bus.on('media:track', t => { if (t && t.playing) finish(t); });
    job.timer = setTimeout(() => finish(lastTrack), MUSIC_WAIT_MS);
    job.cancel = () => {
      if (job.over) return;
      job.over = true; job.off(); clearTimeout(job.timer);
      done(step, 'warn', 'Asked Music to play; automations stopped before it answered');
      e.status = summarize(e);
      changed(e);
    };
    pending.add(job);
    bus.emit('media:play');
    return undefined;
  },

  notify(a, step, e, rule) {
    const text = String(a.text || '').trim();
    if (!text) return done(step, 'fail', 'The notification had no text');
    const from = label(rule);
    api.notify({
      app: 'Automations', icon: 'zap', timeout: 7000, title: text,
      message: `From the rule “${from.length > 90 ? from.slice(0, 89) + '…' : from}”`,
    });
    if (store.get('prefs.dnd')) return done(step, 'ok', `Sent “${text}” to the notification centre (Do Not Disturb is on, so it didn’t pop up)`);
    const muted = (store.get('prefs.notiApps', {}) || {}).automations === false;
    if (muted) return done(step, 'ok', `Sent “${text}” to the notification centre (pop-ups from Automations are turned off in Settings)`);
    return done(step, 'ok', `Showed the notification “${text}”`);
  },
};

/** After a rule opened an app, give the screen back to the window the person was in. */
function keepInFront(win) {
  try {
    if (!win || !api.wm) return;
    if (!api.wm.list().includes(win) || win.min) return;
    if (api.wm.getActive() !== win) api.wm.focus(win);
  } catch (err) { /* the window went away mid-run — nothing to restore */ }
}

async function execute(rule, e, cause) {
  let opened = false;
  try {
    for (const a of rule.then.slice(0, MAX_ACTIONS)) {
      const step = { what: describeAction(a), state: 'wait', result: '' };
      e.steps.push(step);
      let res;
      const prev = current;
      current = e;
      try {
        res = ACT[a.type] ? ACT[a.type](a, step, e, rule) : done(step, 'fail', 'This kind of action isn’t supported');
      } catch (err) {
        done(step, 'fail', `Something went wrong: ${errMsg(err)}`);
      } finally {
        current = prev;
      }
      if (res && typeof res.then === 'function') {
        try { await res; } catch (err) { done(step, 'fail', `Something went wrong: ${errMsg(err)}`); }
      }
      if (step.opened) { opened = true; delete step.opened; }
      changed(e);
    }
    if (!rule.then.length) e.note = 'This rule has no actions yet, so there was nothing to do.';
  } finally {
    busy.delete(rule.id);
    e.status = summarize(e);
    changed(e);
    if (opened && cause.source === 'trigger') keepInFront(cause.front);
    fronts.delete(e);
  }
}

/** Run one rule for one cause. Returns the (live) log entry. */
function run(rule, cause) {
  const e = entryFor(rule, cause);
  if (e.chain.includes(rule.id)) {
    return held(e, 'Held back — its own action set it off again, and a rule never sets itself off.');
  }
  if (e.chain.length >= MAX_CHAIN) {
    return held(e, `Held back — ${e.chain.length} rules in a row set each other off, which is as long as a chain goes.`);
  }
  if (busy.has(rule.id)) return held(e, 'Held back — it was still finishing its last run.');
  if (cause.source === 'trigger' || cause.source === 'startup') {
    const last = lastRun.get(rule.id);
    if (last && e.at - last < COOLDOWN_MS) {
      const s = Math.max(0.1, Math.round((e.at - last) / 100) / 10);
      return held(e, `Held back — it already ran ${s}s ago, and a rule runs at most once every ${COOLDOWN_MS / 1000} seconds.`);
    }
    lastRun.set(rule.id, e.at);
  }
  record(e);
  busy.add(rule.id);
  if (cause.front) fronts.set(e, cause.front);
  execute(rule, e, cause).catch(err => console.error('[automations] run failed', err));
  return e;
}

/* ---------- triggers ------------------------------------------------- */
function matches(when, detail) {
  if (when.type === 'app-open') return !!when.app && when.app === detail.app;
  return true;
}

function trigger(type, detail) {
  if (!started) return;
  /* `current` is set only while one of our own actions runs, so it names
     the rule (if any) that caused this event; a chain keeps the window of
     the event that started it */
  const parent = current;
  let front = null;
  try {
    if (parent) front = fronts.get(parent) || null;
    else front = type === 'app-open' ? detail.win : (api.wm ? api.wm.getActive() : null);
  } catch (err) { front = null; }
  const info = { ...detail };
  delete info.win;
  queueMicrotask(() => {
    if (!started) return;
    let list;
    try { list = rules().filter(r => r.enabled && r.when.type === type && matches(r.when, info)); }
    catch (err) { console.error('[automations] reading rules', err); return; }
    for (const r of list) {
      try { run(r, { source: 'trigger', type, detail: info, parent, front }); }
      catch (err) { console.error('[automations] rule failed', err); }
    }
  });
}

function gameModeOn() {
  if (store.get('prefs.gameMode')) return true;
  return typeof document !== 'undefined' && document.documentElement.dataset.gamemode === 'on';
}
function checkGameMode() {
  const on = gameModeOn();
  if (on === gmOn) return;
  gmOn = on;
  if (on) trigger('gamemode-on', { auto: !store.get('prefs.gameMode') });
}

function runStartup() {
  const now = new Date();
  startup = { at: now.getTime(), ran: 0, skipped: 0 };
  let list = [];
  try { list = rules().filter(r => r.enabled && r.when.type === 'startup'); }
  catch (err) { console.error('[automations] reading rules', err); }
  const cause = { source: 'startup', at: now.getTime() };
  for (const r of list) {
    if (inWindow(r.when.when, now)) {
      startup.ran++;
      queueMicrotask(() => { try { run(r, cause); } catch (err) { console.error('[automations] startup rule failed', err); } });
    } else {
      startup.skipped++;
      const w = WINDOWS.find(x => x.id === r.when.when);
      const e = entryFor(r, cause);
      e.status = 'skipped';
      e.note = `Not run — StaticOS started at ${clock(now)}, which isn’t ${w ? w.label : 'the chosen time'} (${windowHours(r.when.when)}).`;
      record(e);
    }
  }
}

/* ---------- startup apps --------------------------------------------- */
export const STARTUP_RULE_ID = 'startup-apps';
let startupAppsRan = null;     /* { at, id, status } once the set ran at startup this session */

/** The saved set, cleaned: { enabled, apps:[id…] } — unique ids, at most MAX_STARTUP_APPS. */
export function startupApps() {
  const v = store.get(STARTUP_KEY);
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const apps = [];
  for (const x of Array.isArray(o.apps) ? o.apps : []) {
    const id = str(x, 60).trim();
    if (id && !apps.includes(id)) apps.push(id);
    if (apps.length >= MAX_STARTUP_APPS) break;
  }
  return { enabled: o.enabled !== false, apps };
}

/** Save a change to the set ({ enabled } and/or { apps }); returns the cleaned set. */
export function saveStartupApps(patch) {
  const cur = startupApps();
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = {
    enabled: 'enabled' in p ? p.enabled !== false : cur.enabled,
    apps: Array.isArray(p.apps) ? p.apps : cur.apps,
  };
  store.set(STARTUP_KEY, { enabled: next.enabled, apps: next.apps.map(x => str(x, 60)).filter(Boolean) });
  return startupApps();
}

/** When the set last ran at startup this session: { at, id, status } or null. */
export const startupAppsStatus = () => (startupAppsRan ? { ...startupAppsRan } : null);

function openStartupSet(source) {
  const set = startupApps();
  if (!set.apps.length) return null;
  const rule = { id: STARTUP_RULE_ID, name: 'Startup apps', when: { type: 'startup', when: 'always' }, then: [] };
  const e = entryFor(rule, { source, at: Date.now() });
  record(e);
  for (const id of set.apps) {
    const app = api.getApp(id);
    const step = { what: `Open ${app ? app.name : pretty(id)}`, state: 'wait', result: '' };
    e.steps.push(step);
    if (!app) { done(step, 'fail', `Couldn’t open “${pretty(id)}” — that app isn’t available in this session`); continue; }
    const open = api.wm ? api.wm.byApp(app.id) : [];
    if (open.length) {
      /* restored, deep-linked or opened by hand already: bring it forward, in its turn */
      const w = open[open.length - 1];
      try { if (w.min) api.wm.restore(w); else api.wm.focus(w); } catch (err) { /* it went away */ }
      done(step, 'same', `${app.name} was already open — brought it forward`);
      continue;
    }
    /* anything these windows set off is credited to this entry, and never
       pulls focus back from the next app in the list */
    const prev = current;
    current = e;
    try {
      /* restore: a startup app that was on another desktop last time goes back there (wm.js) */
      const w = api.openApp(app.id, { restore: true });
      done(step, w ? 'ok' : 'fail', w ? `Opened ${app.name}` : `${app.name} didn’t open`);
    } catch (err) {
      done(step, 'fail', `${app.name} didn’t open: ${errMsg(err)}`);
    } finally {
      current = prev;
    }
  }
  e.status = summarize(e);
  changed(e);
  return e;
}

/** Open the set right now, in order (the app's "Open them now"). Returns a log entry copy. */
export function runStartupAppsNow() {
  const e = openStartupSet('manual');
  return e ? copyEntry(e) : null;
}

function startupAppsAtBoot() {
  if (!started) return;
  const set = startupApps();
  if (!set.enabled || !set.apps.length) return;
  const e = openStartupSet('startup');
  if (e) startupAppsRan = { at: e.at, id: e.id, status: e.status };
}

/** Run fn once StaticOS has finished starting (main.js emits 'boot:ready' after the session restore). */
function whenBooted(fn) {
  const boot = typeof window !== 'undefined' ? window.__staticBoot : null;
  if (!boot || boot.ok) { queueMicrotask(fn); return () => {}; }
  let off = null;
  off = bus.on('boot:ready', () => { if (off) off(); off = null; fn(); });
  return () => { if (off) off(); off = null; };
}

/* ---------- reminders ------------------------------------------------ */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_MS = 60000;
const floorMin = t => t - (((t % MIN_MS) + MIN_MS) % MIN_MS);
const posInt = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const remId = () => `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function validDate(s) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}
/** 'YYYY-MM-DD' for a Date, on this computer's calendar. */
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A clean reminder, or null when it can't be one (no text, no time, a one-off with no date). */
export function normReminder(r, i = 0) {
  const o = r && typeof r === 'object' ? r : null;
  if (!o) return null;
  const text = str(o.text, TEXT_MAX).trim();
  const time = TIME_RE.test(o.time) ? o.time : null;
  if (!text || !time) return null;
  const repeat = REPEATS.some(x => x.id === o.repeat) ? o.repeat : 'once';
  const date = dated(repeat) && validDate(o.date) ? o.date : '';
  if (dated(repeat) && !date) return null;
  const skip = repeat === 'weekly' && Array.isArray(o.skip)
    ? [...new Set(o.skip.filter(validDate))].sort().slice(-MAX_SKIP) : [];
  const out = {
    id: str(o.id, 60) || `reminder-${i + 1}`,
    text, time, repeat, date,
    enabled: o.enabled !== false,
    created: posInt(o.created), updated: posInt(o.updated),
    last: posInt(o.last), missed: posInt(o.missed), snooze: posInt(o.snooze),
  };
  if (skip.length) out.skip = skip;
  /* a reminder Calendar keeps for one of its events */
  const cal = str(o.cal, 80).trim();
  if (cal) { out.cal = cal; out.sub = str(o.sub, 120).trim(); }
  /* or for something another app keeps (Study's homework): `src` names the app, `ref` the item */
  const src = str(o.src, 30).trim(), ref = str(o.ref, 80).trim();
  if (!cal && src && ref) { out.src = src; out.ref = ref; out.sub = str(o.sub, 120).trim(); }
  return out;
}

/** Clean a stored list: unique ids, and each kind within its allowance. */
function cleanReminders(v) {
  const seen = new Set();
  const out = [];
  let own = 0, cal = 0, srcN = 0;
  for (const [i, r] of (Array.isArray(v) ? v : []).entries()) {
    const n = normReminder(r, i);
    if (!n) continue;
    if (n.cal ? cal >= MAX_CAL_REMINDERS : n.src ? srcN >= MAX_CAL_REMINDERS : own >= MAX_REMINDERS) continue;
    if (n.cal) cal++; else if (n.src) srcN++; else own++;
    n.id = uniqueId(n.id, seen);
    seen.add(n.id);
    out.push(n);
  }
  return out;
}
/** Every saved reminder, cleaned, with unique ids. */
export const reminders = () => cleanReminders(store.get(REMINDERS_KEY));
/** The reminders you made yourself (not Calendar's) — what MAX_REMINDERS counts. */
export const ownReminders = () => reminders().filter(r => !r.cal && !r.src);
function writeReminders(list) {
  store.set(REMINDERS_KEY, cleanReminders(list));
  return reminders();
}

function onceAt(r) {
  const m = DATE_RE.exec(r.date || '');
  const t = TIME_RE.exec(r.time || '');
  if (!m || !t) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
function anchorDay(r) {
  const m = DATE_RE.exec(r.date || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function dayOk(r, d) {
  if (r.repeat === 'daily') return true;
  if (r.repeat === 'weekdays') return d.getDay() >= 1 && d.getDay() <= 5;
  if (r.repeat === 'weekly') {
    const a = anchorDay(r);
    return !!a && d.getDay() === a.getDay() && d >= a && !(r.skip && r.skip.includes(ymd(d)));
  }
  return false;
}
/* how many days either side of today to look: a week (and then some), plus
   a week for every weekly day left out, so a skipped week is stepped over */
const span = r => (r.repeat === 'weekly' ? 8 + 7 * ((r.skip ? r.skip.length : 0) + 1) : 9);
function atOn(day, time) {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0).getTime();
}

/** The latest time the reminder was due at or before `now`, or null. */
export function lastDue(r, now = Date.now()) {
  if (!r) return null;
  if (r.repeat === 'once') { const t = onceAt(r); return t !== null && t <= now ? t : null; }
  const d = new Date(now);
  for (let k = 0, n = span(r); k < n; k++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - k);
    if (!dayOk(r, day)) continue;
    const t = atOn(day, r.time);
    if (t <= now) return t;
  }
  return null;
}
/** The next time it is due after `now`, or null (a one-off whose time has passed). */
export function nextDue(r, now = Date.now()) {
  if (!r) return null;
  if (r.repeat === 'once') { const t = onceAt(r); return t !== null && t > now ? t : null; }
  let d = new Date(now);
  /* a weekly run that starts later begins counting from its first day */
  const a = r.repeat === 'weekly' ? anchorDay(r) : null;
  if (a && a > d) d = a;
  for (let k = 0, n = span(r); k < n; k++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
    if (!dayOk(r, day)) continue;
    const t = atOn(day, r.time);
    if (t > now) return t;
  }
  return null;
}

/** "Today at 3:30 PM", "Tomorrow at 9:00 AM", "Mon, Nov 2 at 9:00 AM" — for a moment in time. */
export function whenText(t, now = Date.now()) {
  const d = new Date(t);
  const today = new Date(now);
  const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const at = clock(d);
  if (dayDiff === 0) return `Today at ${at}`;
  if (dayDiff === 1) return `Tomorrow at ${at}`;
  if (dayDiff === -1) return `Yesterday at ${at}`;
  const sameYear = d.getFullYear() === today.getFullYear();
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  return `${day} at ${at}`;
}

/** whenText inside a sentence: "today at 3:30 PM", "tomorrow at …", "on Mon, Jan 4 at …". */
export function whenPhrase(t, now = Date.now()) {
  const s = whenText(t, now);
  return /^(Today|Tomorrow|Yesterday)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : `on ${s}`;
}

/** "in 5 min", "in 2 h 10 min", "in 3 days" — how long until `t`. */
export function untilText(t, now = Date.now()) {
  const mins = Math.max(0, Math.round((t - now) / MIN_MS));
  if (mins < 1) return 'in under a minute';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? `in ${h} h ${m} min` : `in ${h} h`;
  const days = Math.round(mins / 1440);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** The schedule in words: "Every day at 9:00 AM", "Weekdays at 8:15 AM", "Tue, Oct 27 at 3:30 PM". */
export function scheduleText(r, now = Date.now()) {
  if (!r) return '';
  if (r.repeat === 'once') { const t = onceAt(r); return t === null ? 'No date' : whenText(t, now); }
  const rep = REPEATS.find(x => x.id === r.repeat);
  const [h, m] = r.time.split(':').map(Number);
  const at = clock(new Date(2000, 0, 3, h, m));
  if (r.repeat === 'weekly') {
    const a = anchorDay(r);
    if (!a) return `Every week at ${at}`;
    const wd = a.toLocaleDateString(undefined, { weekday: 'long' });
    const today = new Date(now);
    const from = a > new Date(today.getFullYear(), today.getMonth(), today.getDate())
      ? `, from ${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
    return `Every ${wd} at ${at}${from}`;
  }
  return `${rep ? rep.phrase : 'Every day'} at ${at}`;
}

/**
 * Where a reminder stands right now:
 * { state: 'off'|'snoozed'|'scheduled'|'done'|'missed', next: ms|null, text }
 */
export function reminderState(r, now = Date.now()) {
  if (!r) return { state: 'off', next: null, text: '' };
  if (!r.enabled) return { state: 'off', next: null, text: 'Switched off' };
  if (r.snooze && r.snooze > now) return { state: 'snoozed', next: r.snooze, text: `Snoozed until ${clock(r.snooze)}` };
  if (r.repeat === 'once') {
    const t = onceAt(r);
    if (t !== null && t > now) return { state: 'scheduled', next: t, text: `Goes off ${untilText(t, now)}` };
    if (r.missed && r.missed >= (t || 0)) return { state: 'missed', next: null, text: `Missed — it was due ${whenPhrase(t, now)}, while StaticOS was closed or asleep` };
    if (r.last && t !== null && r.last >= t) return { state: 'done', next: null, text: `Reminded you ${whenPhrase(r.last, now)}` };
    return { state: 'missed', next: null, text: 'Its time passed while StaticOS was closed' };
  }
  const n = nextDue(r, now);
  return { state: 'scheduled', next: n, text: n ? `Next: ${whenPhrase(n, now)} (${untilText(n, now)})` : '' };
}

/** Problems with a reminder draft. Every one of them blocks saving. */
export function reminderIssues(d, now = Date.now()) {
  const out = [];
  const o = d || {};
  if (!String(o.text || '').trim()) out.push({ at: 'text', text: 'Write what to remind you about.' });
  if (!TIME_RE.test(o.time || '')) out.push({ at: 'time', text: 'Pick a time.' });
  if (!REPEATS.some(x => x.id === o.repeat)) out.push({ at: 'repeat', text: 'Pick how often.' });
  if (o.repeat === 'once') {
    if (!validDate(o.date)) out.push({ at: 'date', text: 'Pick a date.' });
    else if (TIME_RE.test(o.time || '')) {
      const t = onceAt(o);
      if (t !== null && t <= floorMin(now)) out.push({ at: 'date', text: 'That time has already passed — pick a later time or date.' });
    }
  }
  /* weekly: the date says which weekday, and when the run starts */
  if (o.repeat === 'weekly' && !validDate(o.date)) out.push({ at: 'date', text: 'Pick the first day — it repeats on that weekday.' });
  return out;
}

/** A draft for the form: the next whole quarter-hour from now, once, today (or tomorrow). */
export function blankReminder(now = Date.now()) {
  const d = new Date(now + 15 * MIN_MS);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return { id: '', text: '', time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, repeat: 'once', date: ymd(d), enabled: true };
}

/** Add a reminder. -> { ok, reminder?, issues? } */
export function addReminder(draft) {
  const now = Date.now();
  const issues = reminderIssues(draft, now);
  if (issues.length) return { ok: false, issues };
  const list = reminders();
  if (list.filter(x => !x.cal && !x.src).length >= MAX_REMINDERS) return { ok: false, issues: [{ at: 'text', text: `You can have up to ${MAX_REMINDERS} reminders.` }] };
  /* only Calendar makes Calendar's reminders (syncCalendarReminders) */
  const { cal, sub, skip, src, ref, ...mine } = draft || {};
  const r = { ...mine, id: remId(), enabled: draft.enabled !== false, created: now, updated: now, last: 0, missed: 0, snooze: 0 };
  writeReminders([...list, r]);
  return { ok: true, reminder: reminders().find(x => x.id === r.id) || null };
}

/** Change a reminder. A new time, date or repeat starts it afresh (no longer done or missed). */
export function updateReminder(id, patch) {
  const now = Date.now();
  const list = reminders();
  const i = list.findIndex(r => r.id === id);
  if (i < 0) return { ok: false, issues: [{ at: 'text', text: 'That reminder is gone.' }] };
  const cur = list[i];
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...cur, ...p };
  if (!dated(next.repeat)) next.date = '';
  if (next.repeat !== 'weekly') delete next.skip;
  const moved = next.time !== cur.time || next.date !== cur.date || next.repeat !== cur.repeat;
  /* a new schedule is checked in full; new words only need to be words */
  const issues = moved ? reminderIssues(next, now)
    : ('text' in p && !String(next.text || '').trim() ? [{ at: 'text', text: 'Write what to remind you about.' }] : []);
  if (issues.length) return { ok: false, issues };
  if (moved) { next.missed = 0; next.snooze = 0; next.updated = now; }
  if ('enabled' in p && next.enabled && !cur.enabled) next.updated = now;   /* switched back on: only from now */
  if ('enabled' in p && !next.enabled) next.snooze = 0;
  list[i] = next;
  writeReminders(list);
  return { ok: true, reminder: reminders().find(x => x.id === id) || null };
}

export function removeReminder(id) {
  const list = reminders();
  const next = list.filter(r => r.id !== id);
  if (next.length === list.length) return false;
  writeReminders(next);
  return true;
}

const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

/**
 * Calendar's reminders, made to match `want` — one entry per event that
 * wants one: { cal, text, sub, time, repeat:'once'|'weekly', date, skip? }.
 * Calendar reminders no longer wanted are removed. One whose schedule is
 * unchanged keeps its state (on/off, gone off, snoozed); a changed one starts
 * afresh, keeping only on/off. A one-off whose time has already passed is not
 * made (or remade) — it could never go off.
 * -> { [cal]: 'set' | 'passed' | 'full' }
 */
export function syncCalendarReminders(want, now = Date.now()) {
  const list = reminders();
  const others = list.filter(r => !r.cal);
  const mine = new Map(list.filter(r => r.cal).map(r => [r.cal, r]));
  const out = [];
  const result = {};
  for (const w of Array.isArray(want) ? want : []) {
    const cal = str(w && w.cal, 80).trim();
    if (!cal || result[cal]) continue;
    const draft = { text: str(w.text, TEXT_MAX).trim() || 'Event', sub: str(w.sub, 120), time: w.time,
      repeat: w.repeat === 'weekly' ? 'weekly' : 'once', date: w.date, skip: w.repeat === 'weekly' && Array.isArray(w.skip) ? w.skip : [] };
    if (!TIME_RE.test(draft.time || '') || !validDate(draft.date)) continue;
    const cur = mine.get(cal);
    const same = !!cur && cur.time === draft.time && cur.date === draft.date && cur.repeat === draft.repeat
      && sameList(cur.skip, draft.skip.filter(validDate).sort());
    if (!same && draft.repeat === 'once') {
      const t = onceAt(draft);
      if (t === null || t <= floorMin(now)) { result[cal] = 'passed'; continue; }
    }
    if (out.length >= MAX_CAL_REMINDERS) { result[cal] = 'full'; continue; }
    out.push(same
      ? { ...cur, text: draft.text, sub: draft.sub }
      : { ...draft, cal, id: cur ? cur.id : remId(), enabled: cur ? cur.enabled : true,
          created: cur ? cur.created : now, updated: now, last: 0, missed: 0, snooze: 0 });
    result[cal] = 'set';
  }
  const before = JSON.stringify(list.filter(r => r.cal));
  if (JSON.stringify(cleanReminders(out)) !== before) writeReminders([...others, ...out]);
  return result;
}

/**
 * The same for another app's reminders (Study's homework): `src` names the
 * app, and `want` has one entry per item that wants one — { ref, text, sub,
 * time, date } — each a one-off. The app's reminders no longer wanted are
 * removed, one with an unchanged schedule keeps its state, and one whose time
 * has already passed is not made. Calendar's and your own are left alone.
 * -> { [ref]: 'set' | 'passed' | 'full' }
 */
export function syncSourceReminders(src, want, now = Date.now()) {
  const tag = str(src, 30).trim();
  if (!tag) return {};
  const list = reminders();
  const others = list.filter(r => r.src !== tag);
  const mine = new Map(list.filter(r => r.src === tag).map(r => [r.ref, r]));
  const out = [];
  const result = {};
  for (const w of Array.isArray(want) ? want : []) {
    const ref = str(w && w.ref, 80).trim();
    if (!ref || result[ref]) continue;
    const draft = { text: str(w.text, TEXT_MAX).trim() || 'Reminder', sub: str(w.sub, 120), time: w.time, repeat: 'once', date: w.date };
    if (!TIME_RE.test(draft.time || '') || !validDate(draft.date)) continue;
    const cur = mine.get(ref);
    const same = !!cur && cur.time === draft.time && cur.date === draft.date;
    if (!same) {
      const t = onceAt(draft);
      if (t === null || t <= floorMin(now)) { result[ref] = 'passed'; continue; }
    }
    if (out.length >= MAX_CAL_REMINDERS) { result[ref] = 'full'; continue; }
    out.push(same
      ? { ...cur, text: draft.text, sub: draft.sub }
      : { ...draft, src: tag, ref, id: cur ? cur.id : remId(), enabled: cur ? cur.enabled : true,
          created: cur ? cur.created : now, updated: now, last: 0, missed: 0, snooze: 0 });
    result[ref] = 'set';
  }
  const before = JSON.stringify(list.filter(r => r.src === tag));
  if (JSON.stringify(cleanReminders(out).filter(r => r.src === tag)) !== before) writeReminders([...others, ...out]);
  return result;
}

/** Remove one-off reminders that already went off or were missed. -> how many went */
export function clearFinishedReminders(now = Date.now()) {
  const list = reminders();
  const keep = list.filter(r => r.repeat !== 'once' || ['scheduled', 'snoozed', 'off'].includes(reminderState(r, now).state));
  if (keep.length !== list.length) writeReminders(keep);
  return list.length - keep.length;
}

/** Remind again in `minutes` (default 10). */
export function snoozeReminder(id, minutes = SNOOZE_MIN) {
  const list = reminders();
  const r = list.find(x => x.id === id);
  if (!r) return false;
  r.snooze = Date.now() + Math.max(1, Math.min(24 * 60, Number(minutes) || SNOOZE_MIN)) * MIN_MS;
  r.enabled = true;
  writeReminders(list);
  return true;
}

let remTimer = 0;
let remWake = null;

/** One timer for every reminder: until the next one is due, but never longer than 30 s. */
function armReminders() {
  clearTimeout(remTimer);
  remTimer = 0;
  if (!started) return;
  const now = Date.now();
  let next = Infinity;
  for (const r of reminders()) {
    if (!r.enabled) continue;
    const n = nextDue(r, now);
    if (n !== null && n < next) next = n;
    if (r.snooze && r.snooze < next) next = r.snooze;
    if (lastDueUnfired(r, now)) next = now;
  }
  if (next === Infinity) return;
  const wait = Math.max(0, Math.min(next - now, REMINDER_TICK_MS));
  remTimer = setTimeout(() => { remTimer = 0; checkReminders(); }, wait + (wait < REMINDER_TICK_MS ? 25 : 0));
}

/** Watching from: the minute StaticOS started, or the minute this reminder was set — whichever is later. */
const watchFrom = r => floorMin(Math.max(since || 0, r.updated || r.created || 0));
function lastDueUnfired(r, now) {
  const due = lastDue(r, now);
  return due !== null && due > r.last && due >= watchFrom(r);
}

function notifyReminder(r, step, title, message, actions) {
  const study = r.src === 'study' || r.src === 'study-exams';
  const friends = r.src === 'friends';
  const from = r.cal ? 'Calendar' : study ? 'Study' : friends ? 'Social' : 'Automations';
  /* urgent: a reminder is never held back for the notification summary, and
     that includes a game night (core/friends.js). A homework reminder also
     gets through Do Not Disturb (throughDnd): a school-hours schedule shouldn't
     hide what is due; a game night does not. Its pop-up is silent there, as
     sfx.js keeps every chime out of Do Not Disturb. */
  api.notify({ app: from, icon: r.cal ? 'calendar' : study ? 'clipboard' : friends ? 'users' : 'bell', timeout: 0, title, message, actions, urgent: true, throughDnd: study });
  if (store.get('prefs.dnd') && !study) return done(step, 'ok', `Sent “${r.text}” to the notification centre (Do Not Disturb is on, so it didn’t pop up)`);
  const muted = (store.get('prefs.notiApps', {}) || {})[from.toLowerCase()] === false;
  if (muted) return done(step, 'ok', `Sent “${r.text}” to the notification centre (pop-ups from ${from} are turned off in Settings)`);
  return done(step, 'ok', `Showed the reminder “${r.text}”`);
}

/* a game night's reminder (core/friends.js): Open it 15 minutes before, Join at the start */
const nightAction = r => (r.ref.includes('~')
  ? { label: 'Open', onClick: () => api.openApp('social', { night: r.ref.split('~')[0] }) }
  : { label: 'Join', onClick: () => import('./friends.js').then(F => F.joinNight(r.ref)).catch(() => {}) });

function fireReminder(r, due, now, snoozed) {
  const rule = { id: `reminder:${r.id}`, name: `Reminder: ${r.text}`, when: { type: 'startup', when: 'always' }, then: [] };
  const e = entryFor(rule, { source: 'reminder', at: due, late: Math.max(0, now - due), snoozed });
  e.at = now;
  const step = { what: 'Show the reminder', state: 'wait', result: '' };
  e.steps.push(step);
  record(e);
  const sched = snoozed ? `Snoozed · it was due ${clock(due)}` : (r.repeat === 'once' ? `Reminder · ${clock(due)}` : `${scheduleText(r)}`);
  /* Calendar's: the event's own line ("Starts at 9:00 AM"), and a way back to it */
  const fallback = r.cal ? 'Calendar event' : r.src === 'friends' ? 'Game night' : r.src === 'study-exams' ? 'Exam' : 'Homework';
  const message = r.cal || r.src ? (snoozed ? `${r.sub || fallback} · snoozed` : (r.sub || fallback)) : sched;
  notifyReminder(r, step, r.text, message, [
    { label: `Snooze ${SNOOZE_MIN} min`, onClick: () => snoozeReminder(r.id, SNOOZE_MIN) },
    r.cal ? { label: 'Open', onClick: () => api.openApp('calendar', { event: r.cal, at: due }) }
      : r.src === 'study' ? { label: 'Open', onClick: () => api.openApp('study', { tab: 'homework', assignment: r.ref }) }
        : r.src === 'study-exams' ? { label: 'Open', onClick: () => api.openApp('study', { tab: 'exams', exam: String(r.ref).split(':')[0] }) }
        : r.src === 'friends' ? nightAction(r) : { label: 'Done' },
  ]);
  e.status = summarize(e);
  changed(e);
}

function logMissed(r, due, why) {
  const rule = { id: `reminder:${r.id}`, name: `Reminder: ${r.text}`, when: { type: 'startup', when: 'always' }, then: [] };
  const e = entryFor(rule, { source: 'reminder', at: due });
  e.status = 'skipped';
  e.note = why;
  record(e);
}

/** Fire whatever is due. Runs on the timer, when the tab comes back, and after any change. */
function checkReminders() {
  if (!started) return;
  const now = Date.now();
  const list = reminders();
  let dirty = false;
  const fire = [];
  const missedOnce = [];
  for (const r of list) {
    if (!r.enabled) continue;
    if (r.snooze && r.snooze <= now) {
      const at = r.snooze;
      r.snooze = 0;
      dirty = true;
      if (now - at <= REMINDER_LATE_MS) fire.push({ r, due: at, snoozed: true });
      else logMissed(r, at, `Missed the snoozed reminder — it was due ${whenPhrase(at, now)}, but this tab or computer was asleep then.`);
    }
    const due = lastDue(r, now);
    if (due === null || due <= r.last || due < watchFrom(r)) continue;
    r.last = due;
    dirty = true;
    if (now - due > REMINDER_LATE_MS) {
      if (r.repeat === 'once') { r.missed = due; missedOnce.push(r); }
      logMissed(r, due, `Missed — it was due ${whenPhrase(due, now)}, but this tab or computer was asleep then (it’s ${clock(now)} now). A reminder only goes off while StaticOS is open and awake.`);
      continue;
    }
    fire.push({ r, due });
  }
  if (dirty) writeReminders(list);
  for (const f of fire) {
    try { fireReminder(f.r, f.due, now, !!f.snoozed); } catch (err) { console.error('[automations] reminder failed', err); }
  }
  if (missedOnce.length) tellMissed(missedOnce, now);
  armReminders();
}

function tellMissed(list, now) {
  const one = list.length === 1 ? list[0] : null;
  api.notify({
    app: 'Automations', icon: 'bell-off', timeout: 0, urgent: true,
    title: one ? `Missed reminder: ${one.text}` : `${list.length} reminders were missed`,
    message: one
      ? `It was due ${whenPhrase(one.missed || onceAt(one), now)}, while StaticOS was closed or asleep.`
      : list.map(r => r.text).join(' · ').slice(0, 200),
  });
}

/** At startup: one-off reminders whose time came while StaticOS was closed are marked Missed (and said once). */
function sweepMissed() {
  const now = Date.now();
  const from = floorMin(since || now);
  const list = reminders();
  const missed = [];
  for (const r of list) {
    if (!r.enabled || r.repeat !== 'once' || r.missed) continue;
    const t = onceAt(r);
    if (t === null || t >= from || t <= r.last) continue;
    if ((r.updated || r.created || 0) > t) continue;     /* set after its own time — it was never going to go off */
    r.last = t;
    r.missed = t;
    missed.push(r);
    logMissed(r, t, `Missed — it was due ${whenPhrase(t, now)}, and StaticOS wasn’t open then. A reminder only goes off while StaticOS is open.`);
  }
  if (!missed.length) return;
  writeReminders(list);
  tellMissed(missed, now);
}

function onVisible() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') checkReminders();
}

/* ---------- lifecycle ------------------------------------------------ */
/**
 * Start listening. Call once after boot; later calls do nothing.
 * opts.startup === false starts the listeners without checking the
 * startup rules (for starting the engine by hand mid-session, when
 * StaticOS did not just start).
 */
export function init(opts = {}) {
  if (started) return status();
  started = true;
  since = Date.now();
  gmOn = gameModeOn();
  offs = [
    bus.on('win:open', w => { if (w && w.appId) trigger('app-open', { app: w.appId, win: w }); }),
    bus.on('game:launch', g => trigger('game-launch', { title: g && g.title ? str(g.title, 80) : '', kind: (g && g.kind) || null })),
    store.sub('prefs.gameMode', checkGameMode),
    store.sub('prefs', checkGameMode),
    bus.on('gamemode:change', checkGameMode),
    store.sub(REMINDERS_KEY, armReminders),
  ];
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    offs.push(() => document.removeEventListener('visibilitychange', onVisible));
  }
  if (opts && opts.startup === false) startup = null;
  else {
    runStartup();
    sweepMissed();
    offs.push(whenBooted(startupAppsAtBoot));
  }
  checkReminders();
  bus.emit('automations:status', status());
  return status();
}

/** Stop listening (rules stay saved). */
export function stop() {
  offs.splice(0).forEach(off => { try { off(); } catch (err) { /* already gone */ } });
  pending.forEach(job => { try { job.cancel(); } catch (err) {} });
  pending.clear();
  clearTimeout(remTimer);
  remTimer = 0;
  started = false;
  bus.emit('automations:status', status());
}

/**
 * Run a rule's actions right now, to test it — on or off, and without
 * waiting out its 5-second limit. Takes a saved rule's id or a rule
 * object (the editor passes its unsaved draft with { test: true }).
 * Returns a copy of the log entry.
 */
export function runNow(ruleOrId, opts = {}) {
  const rule = typeof ruleOrId === 'string' ? rules().find(r => r.id === ruleOrId) : normRule(ruleOrId);
  if (!rule) return null;
  const e = run(rule, { source: opts && opts.test ? 'test' : 'manual', parent: current });
  return e ? copyEntry(e) : null;
}

/** Counts for the Developer Room / tests: live log listeners, log size, pending music checks, the reminder timer. */
export const stats = () => ({ running: started, listeners: logSubs.size, log: LOG.length, pending: pending.size, busy: busy.size, reminderTimer: !!remTimer });

export default {
  init, stop, status, stats, rules, save, log, onLog, clearLog, runNow, ready,
  describe, sentence, label, issues, blankRule, normRule, accentChoices, wallpaperChoices,
  startupApps, saveStartupApps, runStartupAppsNow, startupAppsStatus,
  reminders, ownReminders, addReminder, updateReminder, removeReminder, snoozeReminder, clearFinishedReminders, syncCalendarReminders,
  reminderState, reminderIssues, blankReminder, scheduleText, whenText, whenPhrase, untilText, nextDue, lastDue, ymd,
  STORE_KEY, STARTUP_KEY, REMINDERS_KEY, MAX_ACTIONS, MAX_RULES, MAX_STARTUP_APPS, MAX_REMINDERS, MAX_CAL_REMINDERS, COOLDOWN_MS, PRESETS, WINDOWS, REPEATS,
};
