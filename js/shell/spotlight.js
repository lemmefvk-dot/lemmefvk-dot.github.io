/* ============================================================
   spotlight.js — ⌘K / ⌘Space, the command palette

   One overlay, one search field, every addressable thing in the
   OS behind it: apps, files and folders, settings panes, notes,
   bookmarks, proxy history, clipboard history, the games / anime
   / Roblox catalogues, a command list and natural-language
   actions.

   Above all of that sits one instant answer when the line asks a
   question (js/core/answers.js): math that never touches eval(),
   unit conversions, the time in a city, and — only for "define
   …" / "who is …" lines — a definition from the Free Dictionary
   API or a summary from Wikipedia. Enter copies the answer. A
   look-up that is still on its way can be copied the moment it
   lands; one that fails says so. Nothing is made up.

   "clip …" searches clipboard history (every word must match);
   pinned clips also show up in an ordinary search.

   "timer 10m" and "remind me in 1h to …" make real reminders
   (js/core/quickremind.js reads the line, js/core/automations.js rings
   it). Empty, the box lists what you picked last, with Clear history;
   what you pick often ranks higher (counted on this device,
   js/core/spothist.js). "app:", "file:", "note:" and "set:" narrow the
   search and show a chip. Up arrow on an empty box brings back earlier
   answers, and "ans" in a sum is the last one.

   Two rules shape the code:

   1. The field must never block. The three catalogues are big
      (5,900 games · 7,963 anime · 1,300 Roblox experiences) and
      live in lazily-imported modules, so they are fetched on
      first use and their results STREAM into a list that has
      already painted. Typing re-filters what is in memory now;
      nothing waits on a network.

   2. Every action is real. An action that cannot be carried out
      from here is not offered — there are no stubs in the action
      panel, which is why "Open in new window" only appears for
      an app that already has one and why the wallpaper row opens
      the picker rather than pretending to shuffle.
   ============================================================ */
import { covered } from '../core/cover.js';
import * as deskterm from './deskterm.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { THEMES, canonId, themeById } from '../core/themes.js';
import * as ANS from '../core/answers.js';
import * as CB from '../core/clipboard.js';
import * as L from '../core/layers.js';
import * as TI from '../core/textindex.js';
import * as REOPEN from '../core/reopen.js';
import * as WL from '../core/winlayouts.js';
import * as KM from '../core/keymap.js';
import { noteText } from '../core/notesfmt.js';
import * as SEASON from '../core/season.js';
import { appTile } from '../core/appart.js';
import * as HIST from '../core/spothist.js';
import * as QR from '../core/quickremind.js';
import * as AUTO from '../core/automations.js';
import * as FOCUS from '../core/focus.js';
import * as DNDS from '../core/dndsched.js';
import * as DNDR from '../core/dndrules.js';
import { t as tr, plural } from '../core/i18n.js';

const MAX_ROWS = 42;          /* the list scrolls; this only bounds the work */
const DEBOUNCE = 120;         /* ms before the big catalogues are queried */
const MIN_CATALOGUE = 2;      /* a one-letter query against 15k rows is noise */
const LOOKUP_DEBOUNCE = 380;  /* ms of quiet typing before a definition is fetched */

/* ---------- fuzzy matching ---------------------------------- */
/** Subsequence score, -1 when q is not a subsequence of text. */
function fuzzy(q, text) {
  const t = String(text).toLowerCase();
  let i = 0, score = 0, last = -2;
  for (const c of q) {
    const at = t.indexOf(c, i);
    if (at < 0) return -1;
    score += at === 0 ? 14 : at === last + 1 ? 7 : 1;
    if (at > 0 && /[\s\-_/.]/.test(t[at - 1])) score += 5;
    last = at; i = at + 1;
  }
  return score - t.length * 0.05;
}
const best = (q, list) => list.reduce((m, [text, weight]) => {
  const s = fuzzy(q, text);
  return s < 0 ? m : Math.max(m, s * weight);
}, -1);

const appScore = (q, a) => best(q, [[a.name, 1], [a.id, 0.8],
  ...a.keywords.map(k => [k, 0.6]), [a.category, 0.35]]);
const cmdScore = (q, c) => best(q, [[c.label, 1], [c.hint, 0.5]]);
const paneScore = (q, p) => best(q, [[p.name, 1], [p.id, 0.7], ...p.keys.map(k => [k, 0.55])]);

/* ---------- instant answers ---------------------------------- *
 * The parser, the unit tables and the look-ups live in
 * js/core/answers.js; this file only turns an answer into a row.
 * ------------------------------------------------------------- */
const CAT_ICON = {
  length: 'sliders', mass: 'package', temperature: 'thermometer', volume: 'droplet',
  speed: 'gauge', data: 'database', time: 'clock',
};

/* ---------- the lazy catalogues ------------------------------ *
 * Imported on the first query that wants them, never at boot: the
 * three modules together pull ~13 MB of JSON. `settle` is called
 * when one finishes either way, so the open palette can repaint
 * with whatever just arrived.
 * ------------------------------------------------------------- */
const SOURCES = {
  games:  { name: tr('Games'),  path: '../portal/games.data.js',  arg: null,    state: 'idle', mod: null, err: null },
  anime:  { name: tr('Anime'),  path: '../portal/anime.data.js',  arg: 'anime', state: 'idle', mod: null, err: null },
  roblox: { name: tr('Roblox'), path: '../portal/roblox.data.js', arg: null,    state: 'idle', mod: null, err: null },
};
const settled = new Set();

function ensureSource(id) {
  const s = SOURCES[id];
  if (!s || s.state !== 'idle') return;
  s.state = 'loading';
  import(s.path)
    .then(mod => { s.mod = mod; return s.arg ? mod.load(s.arg) : mod.load(); })
    .then(() => { s.state = 'ready'; },
      err => { s.state = 'error'; s.err = err; console.warn(`[spotlight] ${id} catalogue`, err); })
    .then(() => { for (const fn of settled) { try { fn(id); } catch (e) { console.error(e); } } });
}

/** query a ready source; null while it is still idle / loading / broken */
function sourceQuery(id, term, n) {
  const s = SOURCES[id];
  if (s.state !== 'ready' || !s.mod) return null;
  try {
    if (id === 'games')  return s.mod.query({ q: term, sort: 'popular', perPage: n });
    if (id === 'anime')  return s.mod.query({ kind: 'anime', q: term, sort: 'score', perPage: n });
    if (id === 'roblox') return s.mod.query({ q: term, sort: 'playing', perPage: n });
  } catch (err) {
    console.warn(`[spotlight] ${id} query failed`, err);
  }
  return null;
}

/* ---------- settings panes ----------------------------------- *
 * settings.js keeps its SECTIONS list private, so the ids are
 * mirrored here. They are the contract openApp('settings',
 * {section}) is checked against — a stale id simply lands on
 * Appearance, it never throws.
 * ------------------------------------------------------------- */
const PANES = [
  { id: 'appearance', name: tr('Appearance'), icon: 'palette',
    keys: ['theme', 'dark', 'light', 'accent', 'colour', 'color', 'density', 'reduce motion', 'wallpaper', 'grain'] },
  { id: 'desktop', name: tr('Desktop & Dock'), icon: 'monitor',
    keys: ['desktop icons', 'widget rail', 'widgets', 'dock', 'magnification', 'pinned apps'] },
  { id: 'notifications', name: tr('Notifications'), icon: 'bell',
    keys: ['do not disturb', 'dnd', 'alerts', 'toasts', 'badges'] },
  { id: 'sound', name: tr('Sound'), icon: 'volume',
    keys: ['output', 'volume', 'alert sound', 'speakers', 'headphones', 'mute'] },
  { id: 'displays', name: tr('Displays'), icon: 'cast',
    keys: ['resolution', 'refresh rate', 'brightness', 'night shift', 'scaling', 'monitor'] },
  { id: 'power', name: tr('Power & Performance'), icon: 'zap',
    keys: ['performance', 'fan curve', 'game mode', 'battery', 'low power'] },
  { id: 'storage', name: tr('Storage'), icon: 'hard-drive',
    keys: ['disk', 'usage', 'free space', 'trash'] },
  { id: 'screentime', name: tr('Screen Time'), icon: 'bar-chart',
    keys: ['screen time', 'app usage', 'time spent', 'how long', 'games played', 'focus minutes'] },
  { id: 'keyboard', name: tr('Keyboard & Shortcuts'), icon: 'keyboard',
    keys: ['shortcuts', 'keys', 'snap', 'cycle windows', 'lock screen'] },
  { id: 'about', name: tr('About'), icon: 'info',
    keys: ['system', 'version', 'kernel', 'hostname', 'update', 'reset', 'cpu', 'gpu', 'uptime'] },
];

/* ---------- small shared helpers ----------------------------- */
const titleCase = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const listOf = key => {
  const v = store.get(key, []);
  return Array.isArray(v) ? v : [];
};

/** Clipboard writes are best-effort: a denied permission must still say so. */
function copy(text, what) {
  const value = String(text);
  const shown = value.length > 160 ? `${value.slice(0, 159)}…` : value;
  const done = ok => api.notify({
    icon: ok ? 'clipboard' : 'alert',
    title: ok ? tr('{what} copied', { what }) : tr('Could not copy the {what}', { what: what.toLowerCase() }),
    message: shown,
  });
  try {
    const p = navigator.clipboard && navigator.clipboard.writeText(value);
    if (p && typeof p.then === 'function') p.then(() => done(true), () => done(false));
    else done(false);
  } catch (e) { done(false); }
}

/** openApp, but an app that failed to register says so instead of nothing. */
function launch(id, opts, label) {
  if (!api.getApp(id)) {
    api.notify({ icon: 'alert', title: tr('{name} is not installed', { name: label || id }),
      message: tr('That app did not register in this build.') });
    return null;
  }
  return api.openApp(id, opts || {});
}

/** A name that does not exist in `dir` yet. `ext` is part of the collision
    test — 'shot-2026-09-21' and 'shot-2026-09-21.png' are different nodes. */
function uniqueName(dir, base, ext = '') {
  let name = base, n = 1;
  while (api.vfs.node(`${dir}/${name}${ext}`)) name = `${base} ${++n}`;
  return name + ext;
}

/* ---------- actions that more than one row needs ------------- */

function closeAllWindows() {
  const open = api.wm.list();
  if (!open.length) { api.notify({ icon: 'layers', title: tr('No windows are open') }); return; }
  for (const w of open) api.wm.close(w.id);
  api.notify({ icon: 'layers', title: plural(open.length, 'Closed {n} window', 'Closed {n} windows') });
}

function togglePin(app) {
  const dock = listOf('dock');
  const on = dock.includes(app.id);
  /* a NEW array every time — store.set short-circuits on identity */
  store.set('dock', on ? dock.filter(x => x !== app.id) : [...dock, app.id]);
  api.notify({ icon: 'pin', title: on ? tr('{name} unpinned', { name: app.name }) : tr('{name} pinned to the dock', { name: app.name }) });
}

/** Open one note; `find` (a word) is selected in it, where Notes shows it. */
function openNote(id, find) {
  launch('notes', find ? { noteId: id, find } : { noteId: id }, tr('Notes'));
}

/** Open a file at a match: the line in Static Code, the word in Notes. */
function openFileAt(path, hit) {
  const n = api.vfs.node(path);
  if (!n) { api.notify({ icon: 'alert', title: tr('That file is gone'), message: path }); return; }
  const app = api.appForFile(n);
  if (!app || !hit || hit.at < 0) { api.openFile(path); return; }
  launch(app.id, { path, file: n, line: hit.line, find: hit.word }, app.name);
}

function newNote() {
  const list = store.get('notes');
  const arr = Array.isArray(list) ? list : [];
  const note = {
    id: `note-${Date.now().toString(36)}-${arr.length}`,
    title: tr('Untitled note'), body: '', mtime: new Date().toISOString(),
  };
  arr.unshift(note);
  store.set('notes', [...arr]);
  launch('notes', {}, tr('Notes'));
}

function setTheme(id) {
  const t = themeById(canonId(id));
  store.set('prefs.accent', t.id);
  api.notify({ icon: 'palette', title: tr('Theme — {name}', { name: t.name }), message: t.note });
}

function setMode(mode) {
  store.set('prefs.theme', mode);
  api.notify({ icon: mode === 'dark' ? 'moon' : 'sun', title: (mode === 'dark' ? tr('Dark theme') : tr('Light theme')) });
}

/**
 * The web falls to the Proxy app, which is the only thing here that can
 * actually fetch a page — and it opens in a window, never a tab. Its address
 * bar cannot be pre-filled from outside yet, so the term is put on the
 * clipboard and the notification says so rather than leaving a dead end.
 */
function searchWeb(term) {
  const w = launch('aether-proxy', {}, tr('Static Proxy'));
  if (!w || !term) return;
  copy(term, tr('Search term'));
  api.notify({ icon: 'shield', title: tr('Proxy opened'),
    message: tr('“{term}” is on the clipboard — paste it into the address bar.', { term }) });
}

/* ---------- the fixed command list --------------------------- */
const COMMANDS = [
  { label: tr('Lock Screen'), icon: 'lock', hint: tr('Session'), run: () => api.lock() },
  { label: tr('Sleep'), icon: 'moon', hint: tr('Power'), run: () => api.sleep() },
  { label: tr('Restart'), icon: 'refresh', hint: tr('Power'), run: () => api.restart() },
  { label: tr('Close All Windows'), icon: 'x', hint: tr('Windows'), run: closeAllWindows },
  /* js/core/reopen.js — only offered while there is a closed window to bring back */
  { label: tr('Reopen Closed Window'), icon: 'window', when: () => REOPEN.count() > 0, run: () => REOPEN.reopen(),
    get hint() { const c = REOPEN.peek(); return c ? `Windows · ${c.name}${c.title && c.title !== c.name ? ` — ${c.title}` : ''}` : 'Windows'; } },
  { label: tr('Window Overview'), icon: 'layers', hint: tr('Mission control'), run: () => api.overview() },
  { label: tr('New Desktop'), icon: 'plus', hint: tr('Desktops'), run: () => {
    const d = api.wm.addDesktop();
    if (d) api.wm.switchDesktop(d.id);
    else api.notify({ icon: 'layers', title: tr('That’s the most desktops'), message: tr('Remove one in the overview to add another.') });
  } },
  { label: tr('Toggle Widgets'), icon: 'sidebar', hint: tr('Desktop'), run: () => {
    const on = !store.get('prefs.widgetsVisible');
    store.set('prefs.widgetsVisible', on);
    api.notify({ icon: 'sidebar', title: on ? tr('Widgets shown') : tr('Widgets hidden') });
  } },
  { label: tr('Toggle Game Mode'), icon: 'gamepad', hint: tr('Performance'), run: () => {
    const on = !store.get('prefs.gameMode');
    store.set('prefs.gameMode', on);
    api.notify({ icon: 'gamepad', title: on ? tr('Game Mode on') : tr('Game Mode off'),
      message: on ? tr('Blur, shadows, animations, the wallpaper video and widget updates are off.') : tr('Effects are back on.') });
  } },
  { label: tr('Empty Trash'), icon: 'trash', hint: tr('Files'), run: async () => {
    const trash = `${api.vfs.HOME}/Trash`;
    const kids = api.vfs.ls(trash, { hidden: true });
    if (!kids.length) { api.notify({ icon: 'trash', title: tr('Trash is already empty') }); return; }
    const ok = await api.confirm({ title: tr('Empty the Trash?'),
      message: plural(kids.length, '{n} item will be deleted for good.', '{n} items will be deleted for good.'),
      ok: tr('Empty Trash') });
    if (!ok) return;
    for (const k of kids) api.vfs.rm(`${trash}/${k.name}`);
    bus.emit('trash:emptied', { count: kids.length });
    api.notify({ icon: 'trash', title: tr('Trash emptied'), message: tr('{length} items removed', { length: kids.length }) });
  } },
  { label: tr('New Note'), icon: 'sticky-note', hint: tr('Notes'), run: newNote },
  /* js/shell/readaloud.js reads what was selected before Spotlight opened */
  { label: tr('Read Selection Aloud'), icon: 'volume-2', hint: tr('Read aloud'), run: () => bus.emit('speech:read-selection') },
  { label: tr('Stop Reading Aloud'), icon: 'square', hint: tr('Read aloud'), run: () => bus.emit('speech:stop') },
  { label: tr('New Folder on Desktop'), icon: 'folder', hint: tr('Files'), run: () => {
    const desk = `${api.vfs.HOME}/Desktop`;
    const name = uniqueName(desk, tr('New Folder'));
    if (!api.vfs.mkdir(`${desk}/${name}`)) {
      api.notify({ icon: 'alert', title: tr('Could not create the folder'), message: tr('{desk} is missing', { desk }) });
      return;
    }
    api.notify({ icon: 'folder', title: tr('Folder created'), message: name,
      actions: [{ label: tr('Show'), onClick: () => launch('files', { path: desk }, tr('Files')) }] });
  } },
  /* A real PNG of this tab (js/core/screenshot.js). The module is loaded
     with Spotlight so that run() can call take() synchronously: the
     browser only shows its "share this tab" prompt inside the Enter or
     click that ran the command. */
  (() => {
    let shot = null;
    const ready = import('../core/screenshot.js?v=ps5-cloud-proxy-v11').then(m => (shot = m));
    return { label: tr('Take Screenshot'), icon: 'screenshot', hint: tr('Utilities'),
      run: () => (shot ? shot.take() : ready.then(m => m.take())) };
  })(),
  { label: tr('Change Wallpaper'), icon: 'wallpaper', hint: tr('Appearance'),
    run: () => launch('settings', { section: 'appearance' }, tr('Settings')) },
  /* the next wallpaper: rotation's next picture, else the next of your favourites (js/core/wprotate.js) */
  { label: tr('Next Wallpaper'), icon: 'skip-forward', hint: tr('Appearance'), run: async () => {
    const R = await import('../core/wprotate.js');
    const w = await R.nextWallpaper();
    api.notify({ icon: 'wallpaper', title: w ? tr('Wallpaper: {name}', { name: w.name }) : tr('No other wallpaper to show'), timeout: 2500 });
  } },
  /* the seasonal extras, offered while their season runs (js/shell/seasons-more.js) */
  { label: tr('Gratitude List'), icon: 'heart', hint: tr('Autumn'), when: () => SEASON.part('autumn', 'gratitude'), run: () => bus.emit('seasons:open', 'gratitude') },
  { label: tr('Pi Day Challenge'), icon: 'calculator', hint: tr('Pi Day'), when: () => SEASON.part('piday', 'challenge'), run: () => bus.emit('seasons:open', 'pi') },
  { label: tr('Back-to-School Kit'), icon: 'file-text', hint: tr('Back to school'), when: () => SEASON.part('school', 'kit'), run: () => bus.emit('seasons:open', 'kit') },
  { label: tr('Toggle Dark / Light Theme'), icon: 'sun', hint: tr('Appearance'),
    run: () => setMode(store.get('prefs.theme') === 'dark' ? 'light' : 'dark') },
  ...THEMES.map(t => ({
    label: tr('Theme — {name}', { name: t.name }), icon: 'palette', hint: tr('Appearance'),
    run: () => setTheme(t.id),
  })),
  /* Do Not Disturb for a while (js/core/dndsched.js), the focus timer (js/core/focus.js) */
  { label: tr('Do Not Disturb for 1 Hour'), icon: 'bell-off', hint: tr('Notifications · DND'), run: () => {
    DNDS.quickFor(3600_000);
    api.notify({ icon: 'bell-off', title: tr('Do Not Disturb for 1 hour'), message: tr('On until {time}.', { time: DNDR.untilLabel(Date.now() + 3600_000, !!store.get('prefs.h24')) }) });
  } },
  { label: tr('Do Not Disturb Until Tomorrow'), icon: 'bell-off', hint: tr('Notifications · DND'), run: () => {
    DNDS.quickTomorrow();
    api.notify({ icon: 'bell-off', title: tr('Do Not Disturb until tomorrow'), message: tr('On until {time}.', { time: DNDR.untilLabel(DNDR.tomorrowMorning(), !!store.get('prefs.h24')) }) });
  } },
  { label: tr('Turn Off Do Not Disturb'), icon: 'bell', hint: tr('Notifications · DND'), when: () => !!store.get('prefs.dnd'),
    run: () => { store.set('prefs.dnd', false); api.notify({ icon: 'bell', title: tr('Do Not Disturb is off') }); } },
  { label: tr('Start Focus'), icon: 'flame', when: () => !(FOCUS.state().status === 'running' && FOCUS.state().phase === 'focus'),
    get hint() { return tr('Focus · {min} min', { min: FOCUS.config().focus }); },
    run: () => {
      if (FOCUS.state().phase !== 'focus') FOCUS.reset();
      FOCUS.start();
      api.notify({ icon: 'flame', title: tr('Focus started — {min} min', { min: FOCUS.config().focus }), message: FOCUS.config().dnd ? tr('Do Not Disturb is on until it ends.') : null,
        actions: [{ label: tr('Open'), onClick: () => FOCUS.openFocus() }] });
    } },
  { label: tr('Stop Focus'), icon: 'square', hint: tr('Focus'), when: () => FOCUS.state().active,
    run: () => { FOCUS.reset(); api.notify({ icon: 'flame', title: tr('Focus stopped') }); } },
  { label: tr('Show Desktop'), icon: 'monitor', hint: tr('Windows'), run: () => import('./hotcorners.js').then(m => m.showDesktop()) },
  { label: tr('Switch User…'), icon: 'users', hint: tr('Session'), run: () => bus.emit('users:open') },
  { label: tr('Open System Settings'), icon: 'settings', hint: tr('System'),
    run: () => launch('settings', {}, tr('Settings')) },
  { label: tr('Reset StaticOS'), icon: 'alert', hint: tr('Danger zone'), run: async () => {
    const ok = await api.confirm({ title: tr('Reset StaticOS?'),
      message: tr('Every preference, note and pinned item goes back to factory defaults, then the shell reloads.'),
      ok: tr('Reset everything') });
    if (!ok) return;
    store.reset();
    location.reload();
  } },
];

/** The fixed list plus one "Switch to / Move Window to Desktop N" per other desktop. */
function allCommands() {
  const out = COMMANDS.slice();
  const cur = api.wm.desktops.current();
  const win = api.wm.getActive();
  const movable = win && !win.min && win.desk !== undefined;
  for (const d of api.wm.desktops.list()) {
    if (d.id === cur) continue;
    out.push({ label: tr('Switch to {label}', { label: d.label }), icon: 'layers', hint: tr('Desktops'), run: () => api.wm.switchDesktop(d.id) });
    if (movable) {
      out.push({ label: tr('Move Window to {label}', { label: d.label }), icon: 'layers', hint: tr('Desktops'),
        run: () => { const w = api.wm.getActive(); if (w) api.wm.moveToDesktop(w, d.id, { follow: true }); } });
    }
  }
  return out;
}

/* ---------- natural language --------------------------------- *
 * Two shapes are understood. A SCOPE narrows the whole search to
 * one catalogue ("search roblox tower", "find anime frieren") and
 * a VERB opens something by name ("open terminal"). Both are plain
 * prefixes — the rest of the line is the query, so the results
 * keep updating as the term is typed.
 * ------------------------------------------------------------- */
const SCOPES = [
  /* the short prefixes: app: file: note: set: — they may be empty (just the chip) */
  [/^apps?\s*:\s*(.*)$/i, 'apps'],
  [/^files?\s*:\s*(.*)$/i, 'files'],
  [/^notes?\s*:\s*(.*)$/i, 'notes'],
  [/^set\s*:\s*(.*)$/i, 'settings'],
  [/^(?:search\s+)?roblox\s*[:\s]\s*(.+)$/i, 'roblox'],
  [/^(?:find|search|watch)\s+anime\s*[:\s]\s*(.+)$/i, 'anime'],
  [/^anime\s*[:\s]\s*(.+)$/i, 'anime'],
  [/^(?:play|game|games)\s*[:\s]\s*(.+)$/i, 'games'],
  [/^(?:find|search)\s+(?:a\s+)?game\s*[:\s]\s*(.+)$/i, 'games'],
  [/^(?:search\s+)?(?:the\s+)?web\s*[:\s]\s*(.+)$/i, 'web'],
  [/^(?:find|search)\s+files?\s*[:\s]\s*(.+)$/i, 'files'],
  [/^(?:settings?|prefs|preferences)\s*[:\s]\s*(.+)$/i, 'settings'],
  [/^notes?\s*[:\s]\s*(.+)$/i, 'notes'],
  [/^(?:clip|clips|clipboard)\s*[:\s]\s*(.+)$/i, 'clipboard'],
];
const SCOPE_NAME = {
  roblox: 'Roblox', anime: 'Anime', games: tr('Games'), web: 'Web', apps: tr('Apps'),
  files: tr('Files'), settings: tr('Settings'), notes: tr('Notes'), clipboard: tr('Clipboard'),
};

const VERB = /^(?:open|launch|start|run|go\s+to|show)\s+(.+)$/i;

function parseQuery(raw) {
  const q = raw.trim();
  for (const [re, id] of SCOPES) {
    const m = q.match(re);
    if (m) return { scope: id, term: m[1].trim(), raw: q };
  }
  return { scope: null, term: q, raw: q };
}

/* ============================================================ */
export function mountSpotlight(host) {
  const { h, icon, vfs, fmt } = api;
  const MOD = fmt.isMac ? '⌥' : 'Alt';

  const S = {
    open: false, q: '', sel: 0, rows: [], acts: [], actSel: -1,
    touched: false,       /* has the user moved off the top result themselves? */
    pointer: false,       /* has the pointer really moved since the list was last drawn? */
    parsed: { scope: null, term: '', raw: '' },
    cat: { games: null, anime: null, roblox: null },
    catFor: null,          /* the term S.cat was computed for */
    recall: -1,            /* which earlier answer Up arrow has brought back (-1: none) */
  };
  let debTimer = 0;

  /* ---------------- chrome --------------- */
  const scopeBox = h('div.spot__scopes');
  const input = h('input', {
    type: 'text', spellcheck: 'false', autocomplete: 'off',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'spot-list',
    'aria-label': tr('Search apps, files, games, anime, Roblox and commands'),
    placeholder: tr('Search, calculate, or type a command…'),
    oninput: e => {
      S.q = e.target.value;
      S.sel = 0; S.actSel = -1; S.touched = false; S.recall = -1;
      paint(); schedule();
    },
  });
  const list = h('div.spot__list#spot-list', { role: 'listbox', 'aria-label': tr('Results') });
  const actsEl = h('div.spot__acts', { role: 'toolbar', 'aria-label': tr('Actions for the highlighted result') });
  const kbd = t => h('span.kbd', { text: t });
  const foot = h('div.spot__foot',
    h('div.row', kbd('↑'), kbd('↓'), h('span', { text: 'navigate' })),
    h('div.row', kbd('↵'), h('span', { text: 'open' })),
    h('div.row', kbd('⇥'), h('span', { text: 'actions' })),
    h('div.row', kbd('esc'), h('span', { text: 'close' })),
    h('div.grow'),
    h('div.row', kbd(fmt.modLabel + 'K')),
  );
  const panel = h('div.spot', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Spotlight') },
    h('div.spot__in', icon('search'), scopeBox, input), list, actsEl, foot);
  const wrap = h('div.spot-wrap', {
    onmousedown: e => { if (e.target === wrap) close(); },
    /* Chrome replays a still pointer's position when the list re-renders
       under it, which fires mouseenter on whatever row lands there. Only a
       pointer that actually moved may pick a row — otherwise a mouse resting
       where the palette opens would steal Enter from the top result. */
    onmousemove: e => { if (e.movementX || e.movementY) S.pointer = true; },
  }, panel);

  /* ---------------- glyphs --------------- */
  const appGlyph = a => appTile(a);
  const flatGlyph = name => h('div.glyph.glyph--flat', { style: { color: 'var(--accent-soft)' } }, icon(name));

  /* ---------------- row builders --------- */
  const act = (label, ic, run) => ({ label, icon: ic, run });

  function appRow(a) {
    const open = api.wm.byApp(a.id);
    const pinned = listOf('dock').includes(a.id);
    const acts = [act(tr('Open'), 'play', () => launch(a.id, {}, a.name))];
    /* a second window is only a distinct action when one is already up —
       and a singleton app can never have two, so it is never offered one. */
    if (open.length && !a.singleton) {
      acts.push(act(tr('New window'), 'window', () => launch(a.id, {}, a.name)));
    }
    if (open.length) {
      acts.push(act(open.length === 1 ? tr('Close window') : tr('Close {n} windows', { n: open.length }), 'x',
        () => { for (const w of open) api.wm.close(w.id); }));
    }
    acts.push(act(pinned ? tr('Unpin from dock') : tr('Pin to dock'), 'pin', () => togglePin(a)));
    acts.push(act(tr('Copy name'), 'copy', () => copy(a.name, tr('App name'))));
    return {
      key: `app:${a.id}`, kind: tr('App'), title: a.name,
      sub: open.length
        ? tr('{what} · {count} open', { what: a.desc || a.category, count: plural(open.length, '{n} window', '{n} windows') })
        : (a.desc || a.category),
      glyph: () => appGlyph(a), acts,
    };
  }

  function fileRow(hit) {
    const n = hit.node;
    const dir = n.type === 'dir' ? hit.path : vfs.parentPath(hit.path);
    const bits = [vfs.parentPath(hit.path)];
    if (n.type === 'file' && Number.isFinite(n.size)) bits.push(fmt.fmtBytes(n.size));
    if (n.mtime) bits.push(fmt.fmtAgo(n.mtime));
    if (Array.isArray(n.tags) && n.tags.length) bits.push(tr('Tagged {tags}', { tags: n.tags.join(', ') }));
    const acts = [
      n.type === 'dir'
        ? act(tr('Open in Files'), 'folder-open', () => launch('files', { path: hit.path }, tr('Files')))
        : act(tr('Open'), 'play', () => api.openFile(hit.path)),
    ];
    if (n.type !== 'dir') acts.push(act(tr('Reveal in Files'), 'folder-open', () => launch('files', { path: dir }, 'Files')));
    acts.push(act(tr('Copy name'), 'copy', () => copy(n.name, tr('Name'))));
    acts.push(act(tr('Copy path'), 'link', () => copy(hit.path, tr('Path'))));
    return {
      key: `file:${hit.path}`, kind: n.type === 'dir' ? tr('Folder') : tr('File'),
      title: n.name, sub: bits.join(' · '),
      glyph: () => flatGlyph(vfs.iconFor(n)), acts,
    };
  }

  const cmdRow = c => ({
    key: `cmd:${c.label}`, kind: tr('Command'), title: c.label, sub: c.hint,
    glyph: () => flatGlyph(c.icon),
    acts: [act(tr('Run'), 'play', () => c.run()), act(tr('Copy name'), 'copy', () => copy(c.label, tr('Command')))],
  });

  const paneRow = p => ({
    key: `pane:${p.id}`, kind: tr('Settings'), title: p.name,
    sub: tr('Settings · {keys}', { keys: p.keys.slice(0, 3).join(', ') }),
    glyph: () => flatGlyph(p.icon),
    acts: [
      act(tr('Open'), 'play', () => launch('settings', { section: p.id }, tr('Settings'))),
      act(tr('Copy name'), 'copy', () => copy(p.name, tr('Pane name'))),
    ],
  });

  /* ---------------- instant answers ------ */
  const ansGlyph = name => h('div.glyph.glyph--flat.spot__ans-g', { style: { color: 'var(--accent-soft)' } }, icon(name));
  const spinGlyph = () => h('div.glyph.glyph--flat.spot__ans-g', h('div.spinner'));
  const ansRow = (key, kind, more) => ({ key: `ans:${key}`, kind, answer: true, ...more });

  /** Copy a look-up's answer the moment it lands (Enter on a row still loading). */
  function copyLookup(req) {
    const what = req.kind === 'define' ? 'Definition' : 'Summary';
    ANS.lookup(req).then(res => {
      if (res.ok) copy(res.copy, what);
      else api.notify({ icon: 'alert', title: tr('No {what} to copy', { what: what.toLowerCase() }), message: res.message });
    });
  }

  /** "ans" is the last answer you had (a number). */
  function expandAns(raw) {
    const last = HIST.lastValue();
    if (last === null || !Number.isFinite(Number(last))) return raw;
    return raw.replace(/\bans\b/gi, `(${last})`);
  }
  function answerFor(raw) {
    const last = HIST.lastValue();
    if (/^ans$/i.test(raw.trim()) && last !== null && Number.isFinite(Number(last))) {
      const v = Number(last);
      return { kind: 'math', value: v, expr: 'ans', title: v.toLocaleString(undefined, { maximumFractionDigits: 10 }), copy: String(v), detail: 'Last answer =' };
    }
    const next = expandAns(raw);
    const a = ANS.answer(next, { h24: !!store.get('prefs.h24') });
    if (a && a.kind === 'math' && next !== raw) a.detail = `${raw.trim()} =`;
    return a;
  }
  /** What the open palette is answering, to be remembered when it closes: [line, value] or null. */
  function answerToKeep() {
    if (!S.open || S.parsed.scope || !S.parsed.raw) return null;
    const next = expandAns(S.parsed.raw);
    if (/^ans$/i.test(S.parsed.raw.trim())) return null;
    const a = ANS.answer(next);
    if (a && a.kind === 'math') return [next, a.copy];
    if (a && a.kind === 'convert' && a.number) return [next, a.number];
    return null;
  }

  /** The group for whatever the line asks, or null. A look-up with no answer is a note, not a row. */
  function answerGroup(raw) {
    const a = answerFor(raw);
    if (!a) return null;

    if (a.kind === 'math') {
      return { label: tr('Calculator'), rows: [ansRow('math', tr('Math'), {
        caption: a.detail, title: a.title,
        glyph: () => ansGlyph('calculator'),
        acts: [
          act(tr('Copy answer'), 'clipboard', () => copy(a.copy, tr('Answer'))),
          act(tr('Copy expression'), 'copy', () => copy(`${a.expr} = ${a.copy}`, tr('Expression'))),
          act(tr('Open Calculator'), 'calculator', () => launch('calculator', {}, tr('Calculator'))),
        ],
      })] };
    }

    if (a.kind === 'convert') {
      const acts = [
        act(tr('Copy answer'), 'clipboard', () => copy(a.copy, tr('Answer'))),
        act(tr('Copy number'), 'copy', () => copy(a.number, tr('Number'))),
        act(tr('Swap units'), 'repeat', () => open(a.swap)),
      ];
      if (a.app && api.getApp('convert')) acts.push(act(tr('Open in Static Convert'), 'refresh', () => launch('convert', a.app, tr('Static Convert'))));
      return { label: tr('Convert · {category}', { category: a.category }), rows: [ansRow('convert', tr('Convert'), {
        caption: a.detail, title: a.title,
        lines: a.note ? [{ text: a.note, dim: true }] : null,
        glyph: () => ansGlyph(CAT_ICON[a.cat] || 'refresh'), acts,
      })] };
    }

    if (a.kind === 'time') {
      if (!a.ok) return { label: tr('Time zone'), rows: [], note: a.message };
      const acts = [act(tr('Copy time'), 'clipboard', () => copy(a.copy, tr('Time')))];
      if (api.getApp('clock')) acts.push(act(tr('Open Clock'), 'clock', () => launch('clock', {}, tr('Clock'))));
      return { label: tr('Time zone'), rows: [ansRow('time', tr('Time'), {
        caption: tr('Time in {term}', { term: a.term }), title: a.title, lines: [{ text: a.detail }], source: a.source,
        glyph: () => ansGlyph('clock'), acts,
      })] };
    }

    if (a.kind !== 'lookup') return null;
    const req = a.req;
    const label = req.kind === 'define' ? 'Dictionary' : 'Wikipedia';
    const known = ANS.peek(req.key);
    if (!known || known.state === 'loading') {
      if (!known) scheduleLookup(req);
      return { label, rows: [ansRow(req.key, label, {
        pending: true,
        caption: req.kind === 'define' ? tr('Looking it up in the Free Dictionary…') : tr('Looking it up on Wikipedia…'),
        title: req.term,
        glyph: spinGlyph,
        acts: [act(tr('Copy when it arrives'), 'clipboard', () => copyLookup(req))],
      })] };
    }

    const r = known.result;
    if (!r.ok) {
      if (r.reason === 'none' && !r.url) return { label, rows: [], note: r.message };
      if (r.reason === 'none') {
        return { label, rows: [ansRow(req.key, label, {
          caption: tr('Wikipedia'), title: req.term, lines: [{ text: r.message }],
          glyph: () => ansGlyph('globe'),
          acts: [act(tr('Open on Wikipedia'), 'globe', () => launch('browser', { url: r.url }, tr('Browser')))],
        })] };
      }
      return { label, rows: [ansRow(req.key, label, {
        caption: req.kind === 'define' ? tr('Free Dictionary') : tr('Wikipedia'),
        title: tr('Couldn’t look that up'), lines: [{ text: r.message }],
        glyph: () => ansGlyph(r.reason === 'offline' ? 'wifi-off' : 'alert'),
        acts: [act(tr('Try again'), 'refresh', () => { ANS.forget(req.key); open(raw); })],
      })] };
    }

    if (r.kind === 'define') {
      return { label, rows: [ansRow(req.key, tr('Define'), {
        caption: r.phonetic || tr('Definition'),
        title: r.word,
        lines: r.meanings.map(m => ({ label: m.pos, text: m.def })),
        source: r.source,
        glyph: () => ansGlyph('type'),
        acts: [
          act(tr('Copy definition'), 'clipboard', () => copy(r.copy, tr('Definition'))),
          act(tr('Open in Wiktionary'), 'globe', () => launch('browser', { url: r.url }, tr('Browser'))),
          act(tr('Copy word'), 'copy', () => copy(r.word, tr('Word'))),
        ],
      })] };
    }
    return { label, rows: [ansRow(req.key, tr('Wikipedia'), {
      caption: r.description || tr('Wikipedia'), title: r.title,
      lines: [{ text: r.extract }, r.note ? { text: r.note, dim: true } : null].filter(Boolean),
      source: r.source,
      glyph: () => ansGlyph('globe'),
      acts: [
        act(tr('Copy summary'), 'clipboard', () => copy(r.copy, tr('Summary'))),
        act(tr('Open on Wikipedia'), 'globe', () => launch('browser', { url: r.url }, tr('Browser'))),
        act(tr('Copy link'), 'link', () => copy(r.url, tr('Link'))),
      ],
    })] };
  }

  /* ---------------- clipboard history ----- */
  async function toggleClipPin(it) {
    const name = it.text.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (it.pinned) {
      if (CB.wouldDropOnUnpin(it.id)) {
        const ok = await api.confirm({ title: tr('Unpin and remove?'),
          message: tr('This item is older than your {recent} most recent copies, so unpinning it removes it from the history.', { recent: CB.LIMITS.recent }),
          ok: tr('Unpin'), danger: true });
        if (!ok) return;
      }
      const r = CB.unpin(it.id);
      api.notify({ icon: 'pin', title: r.removed ? tr('Unpinned and removed') : tr('Unpinned'), message: name });
      return;
    }
    const r = CB.pin(it.id);
    api.notify(r.ok
      ? { icon: 'pin', title: tr('Pinned — it stays at the top of Static Clipboard'), message: name }
      : { icon: 'alert', title: r.reason === 'full' ? tr('You can pin up to {pinned} items', { pinned: CB.LIMITS.pinned }) : tr('That item is no longer in your clipboard history') });
  }

  function clipRow(it, term) {
    const one = it.text.replace(/\s+/g, ' ').trim();
    const bits = [it.pinned ? 'Pinned' : 'Copied', `from ${it.source}`];
    if (it.at) bits.push(fmt.fmtAgo(new Date(it.at).toISOString()));
    if (it.len > it.text.length) bits.push(`first ${it.text.length.toLocaleString()} characters kept`);
    return {
      key: `clip:${it.id}`, kind: it.pinned ? tr('Pinned clip') : tr('Clip'),
      title: one.length > 160 ? `${one.slice(0, 159)}…` : one, sub: bits.join(' · '),
      glyph: () => flatGlyph(it.pinned ? 'pin' : 'clipboard'),
      acts: [
        act(tr('Copy'), 'copy', () => copy(it.text, tr('Clip'))),
        act(it.pinned ? tr('Unpin') : tr('Pin'), 'pin', () => toggleClipPin(it)),
        act(tr('Show in Static Clipboard'), 'clipboard', () => launch('clipboard', { view: 'all', q: term }, tr('Static Clipboard'))),
      ],
    };
  }

  /* the Free Classics shelf's list: fetched when search first opens, so start-up never pays for it */
  let classicsCatalog = null;
  let classicsAsked = false;
  function loadClassics() {
    if (classicsAsked) return;
    classicsAsked = true;
    import('../classics/catalog.js').then(m => {
      classicsCatalog = m;
      if (S.open) repaintKeepingPlace();
    }).catch(() => { classicsAsked = false; });
  }

  function classicRow(c) {
    return {
      key: `classic:${c.id}`, kind: tr('Game'), title: c.title, sub: tr('Free Classics · {maker}, {year}', { maker: c.maker, year: c.year }),
      glyph: () => flatGlyph('gamepad'),
      acts: [
        act(tr('Play'), 'play', () => launch('arcade', { game: classicsCatalog.CLASSIC_PREFIX + c.id }, tr('Static Arcade'))),
        act(tr('Copy name'), 'copy', () => copy(c.title, tr('Game name'))),
      ],
    };
  }

  function gameRow(g) {
    const url = `static://games/${g.id}`;
    const bits = [g.studio];
    if (Array.isArray(g.cats) && g.cats.length) bits.push(g.cats.slice(0, 2).join(', '));
    return {
      key: `game:${g.id}`, kind: tr('Game'), title: g.title, sub: bits.filter(Boolean).join(' · '),
      glyph: () => flatGlyph('gamepad'),
      acts: [
        act(tr('Play'), 'play', () => launch('aether-games', { url }, tr('Static Games'))),
        act(tr('Open in Browser'), 'globe', () => launch('browser', { url }, tr('Browser'))),
        act(tr('Copy name'), 'copy', () => copy(g.title, tr('Game name'))),
        act(tr('Copy link'), 'link', () => copy(url, tr('Link'))),
      ],
    };
  }

  function animeRow(a) {
    const url = `static://anime/${a.id}`;
    const token = `anime:${a.id}`;
    const saved = listOf('portal.watchlist').includes(token);
    const bits = [a.mediaType || 'Anime'];
    if (a.year) bits.push(String(a.year));
    if (typeof a.score === 'number') bits.push(`★ ${a.score.toFixed(2)}`);
    if (a.episodes) bits.push(`${a.episodes} ep`);
    return {
      key: `anime:${a.id}`, kind: tr('Anime'), title: a.title, sub: bits.join(' · '),
      glyph: () => flatGlyph('star'),
      acts: [
        act(tr('Open'), 'play', () => launch('aether-anime', { url }, tr('Static Anime'))),
        act(saved ? tr('Remove from Watchlist') : tr('Add to Watchlist'), 'bookmark', () => {
          const cur = listOf('portal.watchlist');
          const next = saved ? cur.filter(x => x !== token) : [...cur, token];
          store.set('portal.watchlist', next);
          api.notify({ icon: saved ? 'trash' : 'bookmark',
            title: saved ? tr('Removed from Watchlist') : tr('Added to Watchlist'), message: a.title });
        }),
        act(tr('Open in Browser'), 'globe', () => launch('browser', { url }, tr('Browser'))),
        act(tr('Copy title'), 'copy', () => copy(a.title, tr('Title'))),
      ],
    };
  }

  function robloxRow(r) {
    const url = `static://roblox/${r.id}`;
    const favs = listOf('portal.roblox.favs');
    const fav = favs.includes(String(r.id));
    const bits = [];
    if (r.creator) bits.push(`by ${r.creator}`);
    if (Array.isArray(r.cats) && r.cats.length) bits.push(r.cats.slice(0, 2).join(', '));
    return {
      key: `roblox:${r.id}`, kind: tr('Roblox'), title: r.name,
      sub: bits.length ? bits.join(' · ') : tr('Roblox experience'),
      glyph: () => flatGlyph('box'),
      acts: [
        act(tr('Open'), 'play', () => launch('aether-roblox', { url }, tr('Static Roblox'))),
        act(fav ? tr('Unfavourite') : tr('Favourite'), 'heart', () => {
          const next = fav ? favs.filter(x => x !== String(r.id)) : [String(r.id), ...favs];
          store.set('portal.roblox.favs', next.slice(0, 300));
          api.notify({ icon: 'heart', title: fav ? tr('Removed from favourites') : tr('Added to favourites'),
            message: r.name });
        }),
        act(tr('Copy name'), 'copy', () => copy(r.name, tr('Experience name'))),
        act(tr('Copy Roblox link'), 'link',
          () => copy(`https://www.roblox.com/games/${r.placeId}`, tr('Link'))),
      ],
    };
  }

  function noteRow(n) {
    const body = noteText(n).replace(/\s+/g, ' ').trim();
    return {
      key: `note:${n.id}`, kind: tr('Note'), title: n.title || tr('Untitled note'),
      sub: body ? `${body.slice(0, 70)}${body.length > 70 ? '…' : ''}` : tr('Empty note'),
      glyph: () => flatGlyph('sticky-note'),
      acts: [
        act(tr('Open in Notes'), 'play', () => openNote(n.id)),
        act(tr('Copy text'), 'copy', () => copy(noteText(n), tr('Note'))),
        act(tr('Copy title'), 'clipboard', () => copy(n.title || tr('Untitled note'), tr('Title'))),
      ],
    };
  }

  /** A word found inside a note or a text file (js/core/textindex.js). */
  function contentRow(hit) {
    const isNote = hit.kind === 'n';
    const node = isNote ? null : vfs.node(hit.ref);
    const acts = [act(tr('Open'), 'play', () => (isNote ? openNote(hit.ref, hit.at >= 0 ? hit.word : null) : openFileAt(hit.ref, hit)))];
    if (!isNote) {
      acts.push(act(tr('Reveal in Files'), 'folder-open', () => launch('files', { path: hit.ref }, tr('Files'))));
      acts.push(act(tr('Copy path'), 'link', () => copy(hit.ref, tr('Path'))));
    } else {
      acts.push(act(tr('Copy line'), 'copy', () => copy(hit.snip.text, tr('Line'))));
    }
    return {
      key: `${isNote ? 'note' : 'file'}-in:${hit.ref}`, kind: isNote ? tr('In note') : tr('In file'),
      title: hit.title, snip: hit.snip,
      sub: isNote ? tr('Notes') : vfs.parentPath(hit.ref),
      glyph: () => flatGlyph(isNote ? 'sticky-note' : vfs.iconFor(node)), acts,
    };
  }

  function linkRow(kind, ic, title, url, at) {
    return {
      key: `${kind}:${url}`, kind, title: title || url,
      sub: at ? `${url} · ${fmt.fmtAgo(new Date(at).toISOString())}` : url,
      glyph: () => flatGlyph(ic),
      acts: [
        act(tr('Open in Browser'), 'globe', () => launch('browser', { url }, tr('Browser'))),
        act(tr('Copy link'), 'link', () => copy(url, tr('Link'))),
      ],
    };
  }

  const webRow = term => ({
    key: 'web', kind: tr('Web'), title: tr('Search the web for “{term}”', { term }),
    sub: tr('Opens the Static Proxy in a window — nothing leaves this tab'),
    glyph: () => flatGlyph('shield'),
    acts: [
      act(tr('Search the web'), 'shield', () => searchWeb(term)),
      act(tr('Copy term'), 'copy', () => copy(term, tr('Search term'))),
    ],
  });

  /* ---------------- recent picks ---------- */
  /** A saved pick, turned back into a live row; null when what it pointed at is gone. */
  function recentRow(rec) {
    const i = rec.key.indexOf(':');
    const kind = rec.key.slice(0, i), id = rec.key.slice(i + 1);
    if (kind === 'app') { const a = api.getApp(id); return a ? appRow(a) : null; }
    if (kind === 'file') { const n = vfs.node(id); return n ? fileRow({ node: n, path: id }) : null; }
    if (kind === 'cmd') { const c = allCommands().find(x => x.label === id && (!x.when || x.when())); return c ? cmdRow(c) : null; }
    if (kind === 'pane') { const p = PANES.find(x => x.id === id); return p ? paneRow(p) : null; }
    if (kind === 'note') { const n = listOf('notes').find(x => x && x.id === id); return n ? noteRow(n) : null; }
    if (kind === 'Bookmark' || kind === 'Recent') return linkRow(kind, kind === 'Bookmark' ? 'bookmark' : 'clock', rec.title, id);
    const portal = { game: ['aether-games', tr('Static Games'), 'gamepad', 'Game'], anime: ['aether-anime', tr('Static Anime'), 'star', 'Anime'], roblox: ['aether-roblox', tr('Static Roblox'), 'box', 'Roblox'] }[kind];
    if (portal) {
      const url = `static://${kind === 'game' ? 'games' : kind}/${id}`;
      return { key: rec.key, kind: portal[3], title: rec.title || id, sub: portal[1], glyph: () => flatGlyph(portal[2]),
        acts: [act(tr('Open'), 'play', () => launch(portal[0], { url }, portal[1])), act(tr('Copy link'), 'link', () => copy(url, tr('Link')))] };
    }
    return null;
  }
  /** Which rows are worth remembering: only what recentRow can rebuild. */
  const pickKey = r => {
    if (!r || r.answer) return null;
    if (r.key.startsWith('note-in:')) return `note:${r.key.slice(8)}`;
    if (r.key.startsWith('file-in:')) return `file:${r.key.slice(8)}`;
    return /^(app|file|cmd|pane|note|Bookmark|Recent|game|anime|roblox):/.test(r.key) ? r.key : null;
  };

  /* ---------------- natural-language rows - */
  /** Rows for things the line literally asks for, ranked above everything. */
  function actionRows(parsed) {
    const q = parsed.raw.toLowerCase();
    const out = [];
    const push = (key, title, sub, ic, run, extra) => out.push({
      key: `do:${key}`, kind: tr('Action'), title, sub,
      glyph: () => flatGlyph(ic),
      acts: [act(tr('Run'), 'play', run), ...(extra || [])],
    });

    /* "timer 10m", "remind me in 1h to …": a real reminder, rung by the reminder engine */
    const quick = QR.parse(parsed.raw);
    if (quick) {
      const h24 = !!store.get('prefs.h24');
      const at = new Date(Date.now() + quick.seconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: quick.seconds < 600 ? '2-digit' : undefined, hour12: !h24 });
      const timer = quick.kind === 'timer';
      push(timer ? 'timer' : 'remind',
        timer ? `Start a ${QR.say(quick.seconds)} timer` : `Remind you in ${QR.say(quick.seconds)}: ${quick.text}`,
        `Goes off at ${at} — while StaticOS is open`, timer ? 'clock' : 'bell', () => {
          const r = AUTO.addTimer({ seconds: quick.seconds, text: quick.text, timer });
          api.notify(r.ok
            ? { icon: timer ? 'clock' : 'bell', title: timer ? tr('Timer set — {time}', { time: QR.say(quick.seconds) }) : tr('Reminder set'),
                message: timer ? tr('It rings at {at}.', { at }) : tr('“{text}” at {at}.', { text: quick.text, at }),
                actions: [{ label: tr('Cancel'), onClick: () => AUTO.removeReminder(r.reminder.id) }] }
            : { icon: 'alert', title: tr('Couldn’t set it'), message: r.issues?.[0]?.text });
        });
    }

    const verb = parsed.raw.match(VERB);
    if (verb) {
      const target = verb[1].trim().toLowerCase();
      /* the terminal is not a listed app; on Linux it is in the wallpaper */
      if (deskterm.available() && /^(the )?(terminal|shell|console|term|bash)\b/.test(target)) {
        push('open-terminal', 'Open Terminal', 'On the Linux desktop', 'terminal',
          () => launch('terminal', {}, tr('Terminal')));
      }
      const app = api.listApps()
        .map(a => [a, appScore(target, a)])
        .filter(p => p[1] >= 0)
        .sort((a, b) => b[1] - a[1])[0];
      if (app) {
        const a = app[0];
        push(`open-${a.id}`, `Open ${a.name}`, a.desc || a.category, a.icon,
          () => launch(a.id, {}, a.name));
      }
      const pane = PANES.map(p => [p, paneScore(target, p)]).filter(p => p[1] >= 0)
        .sort((a, b) => b[1] - a[1])[0];
      if (pane && (!app || pane[1] > app[1])) {
        push(`pane-${pane[0].id}`, `Open Settings — ${pane[0].name}`, 'Settings pane', pane[0].icon,
          () => launch('settings', { section: pane[0].id }, tr('Settings')));
      }
    }

    if (/^(?:change|set|new)?\s*wallpaper$|wallpaper$/.test(q)) {
      push('wallpaper', 'Change Wallpaper', 'Opens Settings → Appearance, where the picker lives',
        'wallpaper', () => launch('settings', { section: 'appearance' }, tr('Settings')));
    }
    if (/^new\s+note$|^add\s+note$/.test(q)) {
      push('new-note', 'New Note', 'Creates an empty note and opens it in Notes', 'sticky-note', newNote);
    }
    if (/^close\s+all(\s+windows)?$/.test(q)) {
      const n = api.wm.list().length;
      push('close-all', 'Close All Windows',
        n ? `${n} window${n === 1 ? '' : 's'} open` : 'Nothing is open right now',
        'x', closeAllWindows);
    }
    const theme = q.match(/^(?:switch|change|set)?\s*(?:to\s+)?theme\s*(.*)$/)
      || q.match(/^(dark|light)\s+(?:mode|theme)$/);
    if (theme) {
      const want = (theme[1] || '').trim();
      if (want === 'dark' || want === 'light') {
        push(`mode-${want}`, want === 'dark' ? tr('Switch to the dark theme') : tr('Switch to the light theme'), 'Appearance',
          want === 'dark' ? 'moon' : 'sun', () => setMode(want));
      } else {
        const hits = want
          ? THEMES.filter(t => t.id.includes(want) || t.name.toLowerCase().includes(want))
          : THEMES;
        for (const t of hits.slice(0, 7)) {
          push(`theme-${t.id}`, `Theme — ${t.name}`, t.note, 'palette', () => setTheme(t.id));
        }
      }
    }
    return out;
  }

  /* ---------------- results -------------- */
  function suggestions() {
    const pinned = api.listApps().filter(a => a.pinned).slice(0, 5).map(appRow);
    const recent = vfs.recent(4).map(fileRow);
    const out = [];
    const picks = HIST.recent().map(recentRow).filter(Boolean).slice(0, HIST.MAX_RECENT);
    if (picks.length) out.push({ label: tr('Recently used'), count: picks.length, rows: picks, clear: true });
    if (pinned.length) out.push({ label: tr('Suggestions'), rows: pinned });
    if (recent.length) out.push({ label: tr('Recent files'), count: recent.length, rows: recent });
    return out;
  }

  /** A group for a lazy catalogue: results, a spinner, or an honest error. */
  function catalogueGroup(id, label, rowOf, limit) {
    const s = SOURCES[id];
    if (s.state === 'error') {
      return { label, rows: [], note: `${label} catalogue unavailable — ${s.err && s.err.message ? s.err.message : 'it did not load'}` };
    }
    const res = S.catFor === S.parsed.term ? S.cat[id] : null;
    if (!res) {
      return { label, rows: [], pending: s.state !== 'ready', note: s.state === 'ready' ? null : `Loading the ${label.toLowerCase()} catalogue…` };
    }
    return { label, count: res.total, rows: res.items.slice(0, limit).map(rowOf) };
  }

  function groups() {
    const parsed = S.parsed;
    if (!parsed.raw) return suggestions();

    const term = parsed.term;
    const low = term.toLowerCase();
    const scope = parsed.scope;
    const want = id => !scope || scope === id;
    const out = [];

    /* the instant answer, when the line asks a question: always the top row */
    if (!scope) {
      const ans = answerGroup(parsed.raw);
      if (ans) out.push(ans);
    }

    /* A natural-language row and the fixed command behind it are the same
       thing said twice, so whatever surfaces as an Action is dropped from
       the Commands group further down. */
    const spoken = new Set();
    if (!scope) {
      const acts = actionRows(parsed);
      if (acts.length) {
        for (const r of acts) spoken.add(r.title);
        out.push({ label: tr('Actions'), count: acts.length, rows: acts.slice(0, 7) });
      }
    }

    if (want('apps')) {
      const target = (parsed.raw.match(VERB) || [null, low])[1].toLowerCase();
      /* what you pick often ranks a little higher (js/core/spothist.js) */
      const boost = a => HIST.boost(`app:${a.id}`);
      const ranked = scope === 'apps' && !target
        ? api.listApps().map(a => [a, boost(a)]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))
        : api.listApps().map(a => [a, appScore(target, a)]).filter(p => p[1] >= 0).map(p => [p[0], p[1] + boost(p[0])])
          .sort((a, b) => b[1] - a[1]);
      const apps = ranked.slice(0, scope === 'apps' ? 12 : 5).map(p => appRow(p[0]));
      if (apps.length) out.push({ label: tr('Apps'), count: apps.length, rows: apps });
    }

    /* what is already listed by name, so the words-inside group below doesn't repeat it */
    const named = new Set();
    if (want('files')) {
      let hits = term ? vfs.search(term, { limit: 8, tags: true })   /* by name, or by a file tag (Files › Tags) */
        : (scope === 'files' ? vfs.recent(8) : []);
      /* the ones you open often come first; the rest keep their order */
      const fc = HIST.counts();
      hits = hits.map((x, i) => [x, i]).sort((a, b) => (fc[`file:${b[0].path}`] || 0) - (fc[`file:${a[0].path}`] || 0) || a[1] - b[1]).map(p => p[0]);
      if (hits.length) {
        for (const h0 of hits) named.add(`f:${h0.path}`);
        out.push({ label: tr('Files & Folders'), count: hits.length, rows: hits.map(fileRow) });
      }
    }

    if (want('settings')) {
      const panes = (scope === 'settings' && !low ? PANES.map(p => [p, 0]) : PANES.map(p => [p, paneScore(low, p)]).filter(p => p[1] >= 0))
        .map(p => [p[0], p[1] + HIST.boost(`pane:${p[0].id}`)])
        .sort((a, b) => b[1] - a[1]).slice(0, scope === 'settings' ? 10 : 4).map(p => paneRow(p[0]));
      if (panes.length) out.push({ label: tr('Settings'), count: panes.length, rows: panes });
    }

    if (want('notes')) {
      /* by title here; a note that only has the words inside it is in the group below, with the line */
      const ft = TI.fold(term.trim());
      const notes = (Array.isArray(store.get('notes')) ? store.get('notes') : [])
        .filter(n => n && !n.trashed && (ft ? TI.fold(n.title || '').includes(ft) : scope === 'notes'));
      if (notes.length) {
        for (const n of notes.slice(0, 4)) named.add(`n:${n.id}`);
        out.push({ label: tr('Notes'), count: notes.length, rows: notes.slice(0, 4).map(noteRow) });
      }
    }

    /* words inside your notes and text files, below everything matched by name */
    if ((want('notes') || want('files')) && TI.words(term).length) {
      const found = TI.query(term, {
        limit: scope ? 10 : 5, skip: named,
        kinds: scope === 'notes' ? ['n'] : scope === 'files' ? ['f'] : null,
      });
      if (found.hits.length) {
        out.push({ label: tr('In notes & files'), count: found.total, rows: found.hits.map(contentRow) });
      } else if (!found.ready) {
        out.push({ label: tr('In notes & files'), rows: [], pending: true, note: tr('Reading your notes and files…') });
      }
    }

    /* clipboard history: everything under "clip …"; only what you pinned otherwise */
    if (scope === 'clipboard' || (!scope && term.length >= 2)) {
      const hits = CB.search(term);
      const pins = hits.filter(i => i.pinned);
      const rows = scope ? hits.slice(0, 10) : pins.slice(0, 3);
      if (rows.length) {
        out.push({ label: scope ? tr('Clipboard history') : tr('Pinned clips'), count: scope ? hits.length : pins.length,
          rows: rows.map(it => clipRow(it, term)) });
      } else if (scope) {
        out.push({ label: tr('Clipboard history'), rows: [],
          note: CB.list().some(i => !i.sensitive)
            ? tr('Nothing in your clipboard history matches “{term}” — every word has to match.', { term })
            : tr('Your clipboard history is empty — copy something in StaticOS first.') });
      }
    }

    if (want('games') && term.length >= MIN_CATALOGUE) {
      const classics = classicsCatalog ? classicsCatalog.searchClassics(term) : [];
      if (classics.length) out.push({ label: tr('Free Classics'), count: classics.length, rows: classics.map(classicRow) });
      out.push(catalogueGroup('games', 'Games', gameRow, scope === 'games' ? 8 : 4));
    }
    if (want('roblox') && term.length >= MIN_CATALOGUE) {
      out.push(catalogueGroup('roblox', 'Roblox', robloxRow, scope === 'roblox' ? 8 : 4));
    }
    if (want('anime') && term.length >= MIN_CATALOGUE) {
      out.push(catalogueGroup('anime', 'Anime', animeRow, scope === 'anime' ? 8 : 4));
    }

    if (!scope) {
      const marks = [
        ...listOf('portal.browser.marks').filter(u => typeof u === 'string')
          .map(u => ({ url: u, title: '', at: 0 })),
        ...listOf('proxy.marks').filter(m => m && typeof m.url === 'string'),
      ].filter(m => `${m.title || ''} ${m.url}`.toLowerCase().includes(low));
      if (marks.length) {
        out.push({ label: tr('Bookmarks'), count: marks.length,
          rows: marks.slice(0, 4).map(m => linkRow(tr('Bookmark'), 'bookmark', m.title, m.url, m.at)) });
      }

      const hist = listOf('proxy.hist').filter(x => x && typeof x.url === 'string')
        .filter(x => `${x.title || ''} ${x.url}`.toLowerCase().includes(low));
      if (hist.length) {
        out.push({ label: tr('Recent'), count: hist.length,
          rows: hist.slice(0, 3).map(x => linkRow(tr('Recent'), 'clock', x.title, x.url, x.at)) });
      }

      const cmds = [...allCommands(), ...WL.commands()].filter(c => !spoken.has(c.label) && (!c.when || c.when()))
        .map(c => [c, cmdScore(low, c)]).filter(p => p[1] >= 0).map(p => [p[0], p[1] + HIST.boost(`cmd:${p[0].label}`)])
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(p => cmdRow(p[0]));
      if (cmds.length) out.push({ label: tr('Commands'), count: cmds.length, rows: cmds });
    }

    if (term) out.push({ label: tr('Web'), rows: [webRow(term)] });
    return out;
  }

  /* ---------------- paint ---------------- */
  function rowEl(r, i) {
    const base = {
      id: `spot-row-${i}`, role: 'option', 'aria-selected': 'false',
      onclick: () => runRow(i),
      onmouseenter: () => { if (!S.pointer) return; S.sel = i; S.touched = true; paintSel(); },
    };
    if (r.answer) {
      /* an answer is read, not scanned: big result, its lines wrap, its source is named */
      return h('button.spot__row.spot__ans', { ...base, class: r.pending ? 'is-pending' : null, 'aria-busy': r.pending ? 'true' : null },
        r.glyph(),
        h('div.grow.spot__ans-b',
          r.caption ? h('small.spot__ans-cap', { text: r.caption }) : null,
          h('b.spot__ans-t', { text: r.title }),
          (r.lines || []).map(l => h(l.dim ? 'span.spot__ans-line.is-dim' : 'span.spot__ans-line',
            l.label ? h('i.spot__ans-pos', { text: l.label }) : null, h('span', { text: l.text }))),
          r.source ? h('small.spot__ans-src', { text: r.source }) : null),
        h('span.spot__kind', { text: r.kind }));
    }
    return h('button.spot__row', r.snip ? { ...base, title: r.sub || null } : base,
      r.glyph(),
      h('div.grow',
        h('b.trunc', { style: { display: 'block' }, text: r.title }),
        r.snip ? snipEl(r.snip) : r.sub ? h('small.trunc', { text: r.sub }) : null),
      h('span.spot__kind', { text: r.kind }));
  }

  /** The line a word was found on, the words marked. Text nodes only. */
  function snipEl(s) {
    const parts = [];
    let at = 0;
    if (s.pre) parts.push('…');
    for (const [a, b] of s.marks) {
      if (a > at) parts.push(s.text.slice(at, a));
      parts.push(h('mark', { text: s.text.slice(a, b) }));
      at = b;
    }
    if (at < s.text.length) parts.push(s.text.slice(at));
    if (s.post) parts.push('…');
    return h('small.trunc.spot__snip', parts);
  }

  /** `scroll` only when the keyboard moved the selection — doing it on hover
      slides the row out from under the pointer and re-fires mouseenter. */
  function paintSel(scroll) {
    S.rows.forEach((r, i) => {
      const on = i === S.sel;
      r.el.classList.toggle('is-sel', on);
      r.el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && scroll) r.el.scrollIntoView({ block: 'nearest' });
    });
    const cur = S.rows[S.sel];
    input.setAttribute('aria-activedescendant', cur ? cur.el.id : '');
    paintActs();
  }

  function paintActs() {
    api.clear(actsEl);
    const row = S.rows[S.sel];
    S.acts = row ? (row.acts || []).slice(0, 6) : [];
    if (!S.acts.length) { actsEl.hidden = true; return; }
    actsEl.hidden = false;
    actsEl.appendChild(h('span.spot__acts-for.trunc', { text: row.title }));
    S.acts.forEach((a, i) => {
      actsEl.appendChild(h(i === 0 ? 'button.spot__act.is-primary' : 'button.spot__act', {
        type: 'button', tabindex: '-1',
        'aria-label': `${a.label} — ${row.title}`,
        onclick: () => runRow(S.sel, i),
        onfocus: () => { S.actSel = i; },
      }, icon(a.icon), h('span', { text: a.label }),
        h('span.kbd', { text: i === 0 ? '↵' : `${MOD}${i + 1}` })));
    });
  }

  function paint() {
    S.pointer = false;
    S.parsed = parseQuery(S.q);
    paintScope();
    api.clear(list);
    S.rows = [];
    let n = 0, real = 0;

    const all = groups();
    for (const g of all) {
      if (!g.rows.length && !g.note && !g.pending) continue;
      if (n >= MAX_ROWS) break;
      list.appendChild(h('div.spot__gh',
        h('span', { text: g.label }),
        Number.isFinite(g.count) ? h('span.spot__count', { text: String(g.count) }) : null,
        g.clear ? h('button.spot__clear', {
          type: 'button', text: tr('Clear history'), 'aria-label': tr('Clear Spotlight history'),
          onclick: () => { HIST.clear(); S.sel = 0; paint(); input.focus(); api.notify({ icon: 'trash', title: tr('Spotlight history cleared'), timeout: 3000 }); },
        }) : null));
      for (const r of g.rows) {
        if (n >= MAX_ROWS) break;
        const i = n++;
        if (r.key !== 'web') real++;
        const el = rowEl(r, i);
        S.rows.push({ ...r, el });
        list.appendChild(el);
      }
      if (g.pending) {
        list.appendChild(h('div.spot__load', h('div.spinner'),
          h('small', { text: g.note || tr('Loading…') })));
      } else if (g.note) {
        list.appendChild(h('div.spot__note', { text: g.note }));
      }
    }

    if (!S.parsed.raw) {
      list.appendChild(h('div.spot__hint', tr('Narrow with '), h('code', { text: tr('app:') }), ' ', h('code', { text: tr('file:') }), ' ', h('code', { text: tr('note:') }),
        tr(' or '), h('code', { text: tr('set:') }), ' · ', h('code', { text: tr('timer 10m') }), ' · ', h('code', { text: tr('remind me in 1h to …') })));
    }
    if (!S.rows.length) {
      list.appendChild(h('div.spot__empty', { text: tr('Nothing matches “{raw}”', { raw: S.parsed.raw }) }));
    } else if (S.parsed.raw && !real) {
      /* the web row is always last, so "nothing here" means exactly that */
      list.insertBefore(
        h('div.spot__empty', { text: tr('Nothing on this computer matches “{term}” — search the web instead', { term: S.parsed.term }) }),
        list.firstChild);
    }
    S.sel = Math.max(0, Math.min(S.sel, S.rows.length - 1));
    paintSel();
  }

  function paintScope() {
    api.clear(scopeBox);
    if (!S.parsed.scope) return;
    scopeBox.appendChild(h('button.spot__scope', {
      type: 'button', tabindex: '-1',
      'aria-label': tr('Searching {scope} only — clear this filter', { scope: SCOPE_NAME[S.parsed.scope] }),
      onclick: () => {
        input.value = S.parsed.term;
        S.q = S.parsed.term;
        S.sel = 0;
        paint(); schedule(); input.focus();
      },
    }, h('span', { text: SCOPE_NAME[S.parsed.scope] }), icon('x')));
  }

  /* ---------------- look-ups -------------- */
  let lookTimer = 0;
  let lookKey = null;
  /** The look-up the open palette is showing, if any. */
  function currentLookupKey() {
    if (!S.open || S.parsed.scope) return null;
    const a = ANS.answer(S.parsed.raw);
    return a && a.kind === 'lookup' ? a.req.key : null;
  }
  /** Fetch after a pause in typing, so "define serendipity" is one request, not eleven. */
  function scheduleLookup(req) {
    if (lookKey === req.key) return;
    clearTimeout(lookTimer);
    lookKey = req.key;
    lookTimer = setTimeout(() => {
      lookTimer = 0;
      ANS.lookup(req).then(() => {
        if (lookKey === req.key) lookKey = null;
        if (currentLookupKey() === req.key) repaintKeepingPlace();
      });
    }, LOOKUP_DEBOUNCE);
  }

  /* ---------------- catalogue streaming -- */
  function schedule() {
    clearTimeout(debTimer);
    debTimer = setTimeout(runCatalogues, DEBOUNCE);
  }

  function runCatalogues() {
    const { scope, term } = S.parsed;
    if (!term || term.length < MIN_CATALOGUE) { S.catFor = null; return; }
    const wanted = ['games', 'anime', 'roblox'].filter(id => !scope || scope === id);
    if (!wanted.length) { S.catFor = null; return; }
    for (const id of wanted) ensureSource(id);
    const next = { games: null, anime: null, roblox: null };
    for (const id of wanted) next[id] = sourceQuery(id, term, 8);
    S.cat = next;
    S.catFor = term;
    if (S.open) repaintKeepingPlace();
  }

  /** A repaint the user did not ask for must not move the highlight — unless
      the highlight is still sitting on the default top row, in which case a
      result that streams in above it should take the top slot. */
  function repaintKeepingPlace() {
    const key = S.touched && S.rows[S.sel] ? S.rows[S.sel].key : null;
    const act = S.actSel;
    paint();
    if (key) {
      const i = S.rows.findIndex(r => r.key === key);
      if (i >= 0 && i !== S.sel) { S.sel = i; paintSel(); }
    }
    if (act >= 0) focusAct(act);
  }

  const onSettle = () => { if (S.open) runCatalogues(); };

  /* ---------------- open / close --------- */
  function open(q) {
    S.q = typeof q === 'string' ? q : '';
    S.sel = 0;
    S.actSel = -1;
    S.touched = false;
    S.recall = -1;
    input.value = S.q;
    if (!S.open) {
      S.open = true;
      host.appendChild(wrap);
      /* Escape steps out of the action chips first, then closes; focus goes
         back to where it was (core/layers.js). Tab is Spotlight's own. */
      S.release = L.push({ name: 'spotlight', el: panel, close: () => (S.actSel >= 0 ? leaveActs() : close()) });
      TI.build();      /* no-op once built; the first time, it is ready by the second keystroke */
      bus.emit('spotlight:shown');
    }
    loadClassics();
    paint();
    schedule();
    input.focus();
    input.select();
  }
  function close() {
    if (!S.open) return;
    const keep = answerToKeep();
    if (keep) HIST.noteAnswer(keep[0], keep[1]);
    S.open = false;
    S.release?.();
    S.release = null;
    clearTimeout(debTimer);
    clearTimeout(lookTimer);
    lookTimer = 0;
    lookKey = null;
    wrap.remove();
  }
  function move(d) {
    if (!S.rows.length) return;
    S.actSel = -1;
    S.touched = true;
    S.sel = (S.sel + d + S.rows.length) % S.rows.length;
    paintSel(true);
  }
  function runRow(i, actIndex) {
    const r = S.rows[i];
    if (!r) return;
    const a = (r.acts || [])[actIndex || 0];
    if (!a) return;          /* nothing to do: keep the palette (and what was typed) up */
    const pk = pickKey(r);
    if (pk) HIST.record(pk, r.title);
    close();
    try { a.run(); } catch (e) { console.error('[spotlight]', e); }
  }

  /** Put an earlier answer's line in the box: dir -1 goes further back, +1 comes forward (and out, to an empty box). */
  function recallStep(dir) {
    const list = HIST.answers();
    if (!list.length) return false;
    let j = S.recall - dir;
    if (j >= list.length) j = list.length - 1;
    if (j < -1) return false;
    S.recall = j;
    const q = j < 0 ? '' : list[j].q;
    input.value = q;
    S.q = q; S.sel = 0; S.touched = false;
    paint(); schedule();
    input.setSelectionRange(q.length, q.length);
    return true;
  }

  /* ---------------- action panel keys ---- */
  function focusAct(i) {
    const chips = [...actsEl.querySelectorAll('.spot__act')];
    if (!chips.length) return false;
    const n = (i + chips.length) % chips.length;
    S.actSel = n;
    chips[n].focus();
    return true;
  }
  function leaveActs() {
    S.actSel = -1;
    input.focus();
  }

  /* ---------------- keyboard ------------- */
  const unbind = [];

  /* A button another shell module puts in the footer (the Halloween ghost
     hunt hides one there) is a Tab stop after the actions, and Enter or
     Space on it presses it rather than opening the highlighted row. */
  const footStop = () => foot.querySelector('button:not(:disabled)');
  const toFoot = () => { const b = footStop(); if (!b) return false; S.actSel = -1; b.focus(); return true; };

  unbind.push(api.on(panel, 'keydown', e => {
    const inActs = S.actSel >= 0;
    const onFoot = !!(e.target instanceof Element && e.target.closest('.spot__foot'));
    if (onFoot && (e.key === 'Enter' || e.key === ' ')) return;
    if (onFoot && e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey && S.acts.length) focusAct(S.acts.length - 1); else leaveActs();
      return;
    }

    /* ⌥1…⌥9 runs the nth action from anywhere in the palette. e.code is used
       because on a Mac the Option key rewrites e.key to a symbol. */
    if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5)) - 1;
      if (S.acts[n]) { e.preventDefault(); runRow(S.sel, n); }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      inActs ? leaveActs() : close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (!S.acts.length) { toFoot(); return; }
      if (!inActs) { if (!(e.shiftKey && toFoot())) focusAct(e.shiftKey ? S.acts.length - 1 : 0); }
      else if (e.shiftKey) (S.actSel === 0 ? leaveActs() : focusAct(S.actSel - 1));
      else if (S.actSel >= S.acts.length - 1) { if (!toFoot()) leaveActs(); }
      else focusAct(S.actSel + 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (inActs) leaveActs(); else if (S.recall >= 0) recallStep(1); else move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      /* Up on an empty box (or while paging back) brings earlier answers back */
      if (inActs) leaveActs();
      else if ((S.recall >= 0 || (!S.q && S.sel === 0)) && recallStep(-1)) { /* done */ }
      else move(-1);
    } else if (inActs && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      focusAct(S.actSel + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runRow(S.sel, inActs ? S.actSel : 0);
    } else if (!inActs && e.key.length === 1 && document.activeElement !== input) {
      input.focus();
    }
  }));

  unbind.push(api.on(window, 'keydown', e => {
    if (covered()) return;   /* not under the boot or lock screen */
    const t = e.target;
    const typing = t !== input && !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    /* the person's own keys (Settings › Shortcuts): js/core/keymap.js */
    const hit = KM.matches(e, 'search') || (!typing && KM.matches(e, 'search.space'));
    if (!hit) return;
    e.preventDefault();
    S.open ? close() : open('');
  }, true));

  unbind.push(bus.on('spotlight:open', q => open(q)));

  settled.add(onSettle);
  unbind.push(() => settled.delete(onSettle));

  /* the words-inside index: kept current from here on, and the open
     palette repaints when a first build lands under what was typed */
  TI.init();
  unbind.push(TI.onReady(() => { if (S.open && S.parsed.raw) repaintKeepingPlace(); }));

  return () => { unbind.forEach(off => off()); close(); };
}

export default mountSpotlight;
