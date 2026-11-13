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
import * as KM from '../core/keymap.js';
import { noteText } from '../core/notesfmt.js';
import { appTile } from '../core/appart.js';

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
  games:  { name: 'Games',  path: '../portal/games.data.js',  arg: null,    state: 'idle', mod: null, err: null },
  anime:  { name: 'Anime',  path: '../portal/anime.data.js',  arg: 'anime', state: 'idle', mod: null, err: null },
  roblox: { name: 'Roblox', path: '../portal/roblox.data.js', arg: null,    state: 'idle', mod: null, err: null },
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
  { id: 'appearance', name: 'Appearance', icon: 'palette',
    keys: ['theme', 'dark', 'light', 'accent', 'colour', 'color', 'density', 'reduce motion', 'wallpaper', 'grain'] },
  { id: 'desktop', name: 'Desktop & Dock', icon: 'monitor',
    keys: ['desktop icons', 'widget rail', 'widgets', 'dock', 'magnification', 'pinned apps'] },
  { id: 'notifications', name: 'Notifications', icon: 'bell',
    keys: ['do not disturb', 'dnd', 'alerts', 'toasts', 'badges'] },
  { id: 'sound', name: 'Sound', icon: 'volume',
    keys: ['output', 'volume', 'alert sound', 'speakers', 'headphones', 'mute'] },
  { id: 'displays', name: 'Displays', icon: 'cast',
    keys: ['resolution', 'refresh rate', 'brightness', 'night shift', 'scaling', 'monitor'] },
  { id: 'power', name: 'Power & Performance', icon: 'zap',
    keys: ['performance', 'fan curve', 'game mode', 'battery', 'low power'] },
  { id: 'storage', name: 'Storage', icon: 'hard-drive',
    keys: ['disk', 'usage', 'free space', 'trash'] },
  { id: 'screentime', name: 'Screen Time', icon: 'bar-chart',
    keys: ['screen time', 'app usage', 'time spent', 'how long', 'games played', 'focus minutes'] },
  { id: 'keyboard', name: 'Keyboard & Shortcuts', icon: 'keyboard',
    keys: ['shortcuts', 'keys', 'snap', 'cycle windows', 'lock screen'] },
  { id: 'about', name: 'About', icon: 'info',
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
    title: ok ? `${what} copied` : `Could not copy the ${what.toLowerCase()}`,
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
    api.notify({ icon: 'alert', title: `${label || id} is not installed`,
      message: 'That app did not register in this build.' });
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
  if (!open.length) { api.notify({ icon: 'layers', title: 'No windows are open' }); return; }
  for (const w of open) api.wm.close(w.id);
  api.notify({ icon: 'layers', title: `Closed ${open.length} window${open.length === 1 ? '' : 's'}` });
}

function togglePin(app) {
  const dock = listOf('dock');
  const on = dock.includes(app.id);
  /* a NEW array every time — store.set short-circuits on identity */
  store.set('dock', on ? dock.filter(x => x !== app.id) : [...dock, app.id]);
  api.notify({ icon: 'pin', title: on ? `${app.name} unpinned` : `${app.name} pinned to the dock` });
}

/** Open one note; `find` (a word) is selected in it, where Notes shows it. */
function openNote(id, find) {
  launch('notes', find ? { noteId: id, find } : { noteId: id }, 'Notes');
}

/** Open a file at a match: the line in VS Code, the word in Notes. */
function openFileAt(path, hit) {
  const n = api.vfs.node(path);
  if (!n) { api.notify({ icon: 'alert', title: 'That file is gone', message: path }); return; }
  const app = api.appForFile(n);
  if (!app || !hit || hit.at < 0) { api.openFile(path); return; }
  launch(app.id, { path, file: n, line: hit.line, find: hit.word }, app.name);
}

function newNote() {
  const list = store.get('notes');
  const arr = Array.isArray(list) ? list : [];
  const note = {
    id: `note-${Date.now().toString(36)}-${arr.length}`,
    title: 'Untitled note', body: '', mtime: new Date().toISOString(),
  };
  arr.unshift(note);
  store.set('notes', [...arr]);
  launch('notes', {}, 'Notes');
}

function setTheme(id) {
  const t = themeById(canonId(id));
  store.set('prefs.accent', t.id);
  api.notify({ icon: 'palette', title: `Theme — ${t.name}`, message: t.note });
}

function setMode(mode) {
  store.set('prefs.theme', mode);
  api.notify({ icon: mode === 'dark' ? 'moon' : 'sun', title: `${titleCase(mode)} theme` });
}

/**
 * The web falls to the Proxy app, which is the only thing here that can
 * actually fetch a page — and it opens in a window, never a tab. Its address
 * bar cannot be pre-filled from outside yet, so the term is put on the
 * clipboard and the notification says so rather than leaving a dead end.
 */
function searchWeb(term) {
  const w = launch('aether-proxy', {}, 'Static Proxy');
  if (!w || !term) return;
  copy(term, 'Search term');
  api.notify({ icon: 'shield', title: 'Proxy opened',
    message: `“${term}” is on the clipboard — paste it into the address bar.` });
}

/* ---------- the fixed command list --------------------------- */
const COMMANDS = [
  { label: 'Lock Screen', icon: 'lock', hint: 'Session', run: () => api.lock() },
  { label: 'Sleep', icon: 'moon', hint: 'Power', run: () => api.sleep() },
  { label: 'Restart', icon: 'refresh', hint: 'Power', run: () => api.restart() },
  { label: 'Close All Windows', icon: 'x', hint: 'Windows', run: closeAllWindows },
  /* js/core/reopen.js — only offered while there is a closed window to bring back */
  { label: 'Reopen Closed Window', icon: 'window', when: () => REOPEN.count() > 0, run: () => REOPEN.reopen(),
    get hint() { const c = REOPEN.peek(); return c ? `Windows · ${c.name}${c.title && c.title !== c.name ? ` — ${c.title}` : ''}` : 'Windows'; } },
  { label: 'Window Overview', icon: 'layers', hint: 'Mission control', run: () => api.overview() },
  { label: 'New Desktop', icon: 'plus', hint: 'Desktops', run: () => {
    const d = api.wm.addDesktop();
    if (d) api.wm.switchDesktop(d.id);
    else api.notify({ icon: 'layers', title: 'That’s the most desktops', message: 'Remove one in the overview to add another.' });
  } },
  { label: 'Toggle Widgets', icon: 'sidebar', hint: 'Desktop', run: () => {
    const on = !store.get('prefs.widgetsVisible');
    store.set('prefs.widgetsVisible', on);
    api.notify({ icon: 'sidebar', title: `Widgets ${on ? 'shown' : 'hidden'}` });
  } },
  { label: 'Toggle Game Mode', icon: 'gamepad', hint: 'Performance', run: () => {
    const on = !store.get('prefs.gameMode');
    store.set('prefs.gameMode', on);
    api.notify({ icon: 'gamepad', title: `Game Mode ${on ? 'on' : 'off'}`,
      message: on ? 'Blur, shadows, animations, the wallpaper video and widget updates are off.' : 'Effects are back on.' });
  } },
  { label: 'Empty Trash', icon: 'trash', hint: 'Files', run: async () => {
    const trash = `${api.vfs.HOME}/Trash`;
    const kids = api.vfs.ls(trash, { hidden: true });
    if (!kids.length) { api.notify({ icon: 'trash', title: 'Trash is already empty' }); return; }
    const ok = await api.confirm({ title: `Empty the Trash?`,
      message: `${kids.length} item${kids.length === 1 ? '' : 's'} will be deleted for good.`,
      ok: 'Empty Trash' });
    if (!ok) return;
    for (const k of kids) api.vfs.rm(`${trash}/${k.name}`);
    bus.emit('trash:emptied', { count: kids.length });
    api.notify({ icon: 'trash', title: 'Trash emptied', message: `${kids.length} items removed` });
  } },
  { label: 'New Note', icon: 'sticky-note', hint: 'Notes', run: newNote },
  /* js/shell/readaloud.js reads what was selected before Spotlight opened */
  { label: 'Read Selection Aloud', icon: 'volume-2', hint: 'Read aloud', run: () => bus.emit('speech:read-selection') },
  { label: 'Stop Reading Aloud', icon: 'square', hint: 'Read aloud', run: () => bus.emit('speech:stop') },
  { label: 'New Folder on Desktop', icon: 'folder', hint: 'Files', run: () => {
    const desk = `${api.vfs.HOME}/Desktop`;
    const name = uniqueName(desk, 'New Folder');
    if (!api.vfs.mkdir(`${desk}/${name}`)) {
      api.notify({ icon: 'alert', title: 'Could not create the folder', message: `${desk} is missing` });
      return;
    }
    api.notify({ icon: 'folder', title: 'Folder created', message: name,
      actions: [{ label: 'Show', onClick: () => launch('files', { path: desk }, 'Files') }] });
  } },
  /* A real PNG of this tab (js/core/screenshot.js). The module is loaded
     with Spotlight so that run() can call take() synchronously: the
     browser only shows its "share this tab" prompt inside the Enter or
     click that ran the command. */
  (() => {
    let shot = null;
    const ready = import('../core/screenshot.js?v=ps5-cloud-proxy-v11').then(m => (shot = m));
    return { label: 'Take Screenshot', icon: 'screenshot', hint: 'Utilities',
      run: () => (shot ? shot.take() : ready.then(m => m.take())) };
  })(),
  { label: 'Change Wallpaper', icon: 'wallpaper', hint: 'Appearance',
    run: () => launch('settings', { section: 'appearance' }, 'Settings') },
  { label: 'Toggle Dark / Light Theme', icon: 'sun', hint: 'Appearance',
    run: () => setMode(store.get('prefs.theme') === 'dark' ? 'light' : 'dark') },
  ...THEMES.map(t => ({
    label: `Theme — ${t.name}`, icon: 'palette', hint: 'Appearance',
    run: () => setTheme(t.id),
  })),
  { label: 'Open System Settings', icon: 'settings', hint: 'System',
    run: () => launch('settings', {}, 'Settings') },
  { label: 'Reset StaticOS', icon: 'alert', hint: 'Danger zone', run: async () => {
    const ok = await api.confirm({ title: 'Reset StaticOS?',
      message: 'Every preference, note and pinned item goes back to factory defaults, then the shell reloads.',
      ok: 'Reset everything' });
    if (!ok) return;
    store.reset();
    location.reload();
  } },
];

/* ---------- natural language --------------------------------- *
 * Two shapes are understood. A SCOPE narrows the whole search to
 * one catalogue ("search roblox tower", "find anime frieren") and
 * a VERB opens something by name ("open terminal"). Both are plain
 * prefixes — the rest of the line is the query, so the results
 * keep updating as the term is typed.
 * ------------------------------------------------------------- */
const SCOPES = [
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
  roblox: 'Roblox', anime: 'Anime', games: 'Games', web: 'Web',
  files: 'Files', settings: 'Settings', notes: 'Notes', clipboard: 'Clipboard',
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
  };
  let debTimer = 0;

  /* ---------------- chrome --------------- */
  const scopeBox = h('div.spot__scopes');
  const input = h('input', {
    type: 'text', spellcheck: 'false', autocomplete: 'off',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'spot-list',
    'aria-label': 'Search apps, files, games, anime, Roblox and commands',
    placeholder: 'Search, calculate, or type a command…',
    oninput: e => {
      S.q = e.target.value;
      S.sel = 0; S.actSel = -1; S.touched = false;
      paint(); schedule();
    },
  });
  const list = h('div.spot__list#spot-list', { role: 'listbox', 'aria-label': 'Results' });
  const actsEl = h('div.spot__acts', { role: 'toolbar', 'aria-label': 'Actions for the highlighted result' });
  const kbd = t => h('span.kbd', { text: t });
  const foot = h('div.spot__foot',
    h('div.row', kbd('↑'), kbd('↓'), h('span', { text: 'navigate' })),
    h('div.row', kbd('↵'), h('span', { text: 'open' })),
    h('div.row', kbd('⇥'), h('span', { text: 'actions' })),
    h('div.row', kbd('esc'), h('span', { text: 'close' })),
    h('div.grow'),
    h('div.row', kbd(fmt.modLabel + 'K')),
  );
  const panel = h('div.spot', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Spotlight' },
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
    const acts = [act('Open', 'play', () => launch(a.id, {}, a.name))];
    /* a second window is only a distinct action when one is already up —
       and a singleton app can never have two, so it is never offered one. */
    if (open.length && !a.singleton) {
      acts.push(act('New window', 'window', () => launch(a.id, {}, a.name)));
    }
    if (open.length) {
      acts.push(act(`Close ${open.length === 1 ? 'window' : `${open.length} windows`}`, 'x',
        () => { for (const w of open) api.wm.close(w.id); }));
    }
    acts.push(act(pinned ? 'Unpin from dock' : 'Pin to dock', 'pin', () => togglePin(a)));
    acts.push(act('Copy name', 'copy', () => copy(a.name, 'App name')));
    return {
      key: `app:${a.id}`, kind: 'App', title: a.name,
      sub: open.length
        ? `${a.desc || a.category} · ${open.length} window${open.length === 1 ? '' : 's'} open`
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
    if (Array.isArray(n.tags) && n.tags.length) bits.push(`Tagged ${n.tags.join(', ')}`);
    const acts = [
      n.type === 'dir'
        ? act('Open in Files', 'folder-open', () => launch('files', { path: hit.path }, 'Files'))
        : act('Open', 'play', () => api.openFile(hit.path)),
    ];
    if (n.type !== 'dir') acts.push(act('Reveal in Files', 'folder-open', () => launch('files', { path: dir }, 'Files')));
    acts.push(act('Copy name', 'copy', () => copy(n.name, 'Name')));
    acts.push(act('Copy path', 'link', () => copy(hit.path, 'Path')));
    return {
      key: `file:${hit.path}`, kind: n.type === 'dir' ? 'Folder' : 'File',
      title: n.name, sub: bits.join(' · '),
      glyph: () => flatGlyph(vfs.iconFor(n)), acts,
    };
  }

  const cmdRow = c => ({
    key: `cmd:${c.label}`, kind: 'Command', title: c.label, sub: c.hint,
    glyph: () => flatGlyph(c.icon),
    acts: [act('Run', 'play', () => c.run()), act('Copy name', 'copy', () => copy(c.label, 'Command'))],
  });

  const paneRow = p => ({
    key: `pane:${p.id}`, kind: 'Settings', title: p.name,
    sub: `Settings · ${p.keys.slice(0, 3).join(', ')}`,
    glyph: () => flatGlyph(p.icon),
    acts: [
      act('Open', 'play', () => launch('settings', { section: p.id }, 'Settings')),
      act('Copy name', 'copy', () => copy(p.name, 'Pane name')),
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
      else api.notify({ icon: 'alert', title: `No ${what.toLowerCase()} to copy`, message: res.message });
    });
  }

  /** The group for whatever the line asks, or null. A look-up with no answer is a note, not a row. */
  function answerGroup(raw) {
    const a = ANS.answer(raw, { h24: !!store.get('prefs.h24') });
    if (!a) return null;

    if (a.kind === 'math') {
      return { label: 'Calculator', rows: [ansRow('math', 'Math', {
        caption: a.detail, title: a.title,
        glyph: () => ansGlyph('calculator'),
        acts: [
          act('Copy answer', 'clipboard', () => copy(a.copy, 'Answer')),
          act('Copy expression', 'copy', () => copy(`${a.expr} = ${a.copy}`, 'Expression')),
          act('Open Calculator', 'calculator', () => launch('calculator', {}, 'Calculator')),
        ],
      })] };
    }

    if (a.kind === 'convert') {
      const acts = [
        act('Copy answer', 'clipboard', () => copy(a.copy, 'Answer')),
        act('Copy number', 'copy', () => copy(a.number, 'Number')),
        act('Swap units', 'repeat', () => open(a.swap)),
      ];
      if (a.app && api.getApp('convert')) acts.push(act('Open in Static Convert', 'refresh', () => launch('convert', a.app, 'Static Convert')));
      return { label: `Convert · ${a.category}`, rows: [ansRow('convert', 'Convert', {
        caption: a.detail, title: a.title,
        lines: a.note ? [{ text: a.note, dim: true }] : null,
        glyph: () => ansGlyph(CAT_ICON[a.cat] || 'refresh'), acts,
      })] };
    }

    if (a.kind === 'time') {
      if (!a.ok) return { label: 'Time zone', rows: [], note: a.message };
      const acts = [act('Copy time', 'clipboard', () => copy(a.copy, 'Time'))];
      if (api.getApp('clock')) acts.push(act('Open Clock', 'clock', () => launch('clock', {}, 'Clock')));
      return { label: 'Time zone', rows: [ansRow('time', 'Time', {
        caption: `Time in ${a.term}`, title: a.title, lines: [{ text: a.detail }], source: a.source,
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
        caption: req.kind === 'define' ? 'Looking it up in the Free Dictionary…' : 'Looking it up on Wikipedia…',
        title: req.term,
        glyph: spinGlyph,
        acts: [act('Copy when it arrives', 'clipboard', () => copyLookup(req))],
      })] };
    }

    const r = known.result;
    if (!r.ok) {
      if (r.reason === 'none' && !r.url) return { label, rows: [], note: r.message };
      if (r.reason === 'none') {
        return { label, rows: [ansRow(req.key, label, {
          caption: 'Wikipedia', title: req.term, lines: [{ text: r.message }],
          glyph: () => ansGlyph('globe'),
          acts: [act('Open on Wikipedia', 'globe', () => launch('browser', { url: r.url }, 'Browser'))],
        })] };
      }
      return { label, rows: [ansRow(req.key, label, {
        caption: req.kind === 'define' ? 'Free Dictionary' : 'Wikipedia',
        title: 'Couldn’t look that up', lines: [{ text: r.message }],
        glyph: () => ansGlyph(r.reason === 'offline' ? 'wifi-off' : 'alert'),
        acts: [act('Try again', 'refresh', () => { ANS.forget(req.key); open(raw); })],
      })] };
    }

    if (r.kind === 'define') {
      return { label, rows: [ansRow(req.key, 'Define', {
        caption: r.phonetic || 'Definition',
        title: r.word,
        lines: r.meanings.map(m => ({ label: m.pos, text: m.def })),
        source: r.source,
        glyph: () => ansGlyph('type'),
        acts: [
          act('Copy definition', 'clipboard', () => copy(r.copy, 'Definition')),
          act('Open in Wiktionary', 'globe', () => launch('browser', { url: r.url }, 'Browser')),
          act('Copy word', 'copy', () => copy(r.word, 'Word')),
        ],
      })] };
    }
    return { label, rows: [ansRow(req.key, 'Wikipedia', {
      caption: r.description || 'Wikipedia', title: r.title,
      lines: [{ text: r.extract }, r.note ? { text: r.note, dim: true } : null].filter(Boolean),
      source: r.source,
      glyph: () => ansGlyph('globe'),
      acts: [
        act('Copy summary', 'clipboard', () => copy(r.copy, 'Summary')),
        act('Open on Wikipedia', 'globe', () => launch('browser', { url: r.url }, 'Browser')),
        act('Copy link', 'link', () => copy(r.url, 'Link')),
      ],
    })] };
  }

  /* ---------------- clipboard history ----- */
  async function toggleClipPin(it) {
    const name = it.text.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (it.pinned) {
      if (CB.wouldDropOnUnpin(it.id)) {
        const ok = await api.confirm({ title: 'Unpin and remove?',
          message: `This item is older than your ${CB.LIMITS.recent} most recent copies, so unpinning it removes it from the history.`,
          ok: 'Unpin', danger: true });
        if (!ok) return;
      }
      const r = CB.unpin(it.id);
      api.notify({ icon: 'pin', title: r.removed ? 'Unpinned and removed' : 'Unpinned', message: name });
      return;
    }
    const r = CB.pin(it.id);
    api.notify(r.ok
      ? { icon: 'pin', title: 'Pinned — it stays at the top of Static Clipboard', message: name }
      : { icon: 'alert', title: r.reason === 'full' ? `You can pin up to ${CB.LIMITS.pinned} items` : 'That item is no longer in your clipboard history' });
  }

  function clipRow(it, term) {
    const one = it.text.replace(/\s+/g, ' ').trim();
    const bits = [it.pinned ? 'Pinned' : 'Copied', `from ${it.source}`];
    if (it.at) bits.push(fmt.fmtAgo(new Date(it.at).toISOString()));
    if (it.len > it.text.length) bits.push(`first ${it.text.length.toLocaleString()} characters kept`);
    return {
      key: `clip:${it.id}`, kind: it.pinned ? 'Pinned clip' : 'Clip',
      title: one.length > 160 ? `${one.slice(0, 159)}…` : one, sub: bits.join(' · '),
      glyph: () => flatGlyph(it.pinned ? 'pin' : 'clipboard'),
      acts: [
        act('Copy', 'copy', () => copy(it.text, 'Clip')),
        act(it.pinned ? 'Unpin' : 'Pin', 'pin', () => toggleClipPin(it)),
        act('Show in Static Clipboard', 'clipboard', () => launch('clipboard', { view: 'all', q: term }, 'Static Clipboard')),
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
      key: `classic:${c.id}`, kind: 'Game', title: c.title, sub: `Free Classics · ${c.maker}, ${c.year}`,
      glyph: () => flatGlyph('gamepad'),
      acts: [
        act('Play', 'play', () => launch('arcade', { game: classicsCatalog.CLASSIC_PREFIX + c.id }, 'Static Arcade')),
        act('Copy name', 'copy', () => copy(c.title, 'Game name')),
      ],
    };
  }

  function gameRow(g) {
    const url = `static://games/${g.id}`;
    const bits = [g.studio];
    if (Array.isArray(g.cats) && g.cats.length) bits.push(g.cats.slice(0, 2).join(', '));
    return {
      key: `game:${g.id}`, kind: 'Game', title: g.title, sub: bits.filter(Boolean).join(' · '),
      glyph: () => flatGlyph('gamepad'),
      acts: [
        act('Play', 'play', () => launch('aether-games', { url }, 'Static Games')),
        act('Open in Browser', 'globe', () => launch('browser', { url }, 'Browser')),
        act('Copy name', 'copy', () => copy(g.title, 'Game name')),
        act('Copy link', 'link', () => copy(url, 'Link')),
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
      key: `anime:${a.id}`, kind: 'Anime', title: a.title, sub: bits.join(' · '),
      glyph: () => flatGlyph('star'),
      acts: [
        act('Open', 'play', () => launch('aether-anime', { url }, 'Static Anime')),
        act(saved ? 'Remove from Watchlist' : 'Add to Watchlist', 'bookmark', () => {
          const cur = listOf('portal.watchlist');
          const next = saved ? cur.filter(x => x !== token) : [...cur, token];
          store.set('portal.watchlist', next);
          api.notify({ icon: saved ? 'trash' : 'bookmark',
            title: saved ? 'Removed from Watchlist' : 'Added to Watchlist', message: a.title });
        }),
        act('Open in Browser', 'globe', () => launch('browser', { url }, 'Browser')),
        act('Copy title', 'copy', () => copy(a.title, 'Title')),
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
      key: `roblox:${r.id}`, kind: 'Roblox', title: r.name,
      sub: bits.length ? bits.join(' · ') : 'Roblox experience',
      glyph: () => flatGlyph('box'),
      acts: [
        act('Open', 'play', () => launch('aether-roblox', { url }, 'Static Roblox')),
        act(fav ? 'Unfavourite' : 'Favourite', 'heart', () => {
          const next = fav ? favs.filter(x => x !== String(r.id)) : [String(r.id), ...favs];
          store.set('portal.roblox.favs', next.slice(0, 300));
          api.notify({ icon: 'heart', title: fav ? 'Removed from favourites' : 'Added to favourites',
            message: r.name });
        }),
        act('Copy name', 'copy', () => copy(r.name, 'Experience name')),
        act('Copy Roblox link', 'link',
          () => copy(`https://www.roblox.com/games/${r.placeId}`, 'Link')),
      ],
    };
  }

  function noteRow(n) {
    const body = noteText(n).replace(/\s+/g, ' ').trim();
    return {
      key: `note:${n.id}`, kind: 'Note', title: n.title || 'Untitled note',
      sub: body ? `${body.slice(0, 70)}${body.length > 70 ? '…' : ''}` : 'Empty note',
      glyph: () => flatGlyph('sticky-note'),
      acts: [
        act('Open in Notes', 'play', () => openNote(n.id)),
        act('Copy text', 'copy', () => copy(noteText(n), 'Note')),
        act('Copy title', 'clipboard', () => copy(n.title || 'Untitled note', 'Title')),
      ],
    };
  }

  /** A word found inside a note or a text file (js/core/textindex.js). */
  function contentRow(hit) {
    const isNote = hit.kind === 'n';
    const node = isNote ? null : vfs.node(hit.ref);
    const acts = [act('Open', 'play', () => (isNote ? openNote(hit.ref, hit.at >= 0 ? hit.word : null) : openFileAt(hit.ref, hit)))];
    if (!isNote) {
      acts.push(act('Reveal in Files', 'folder-open', () => launch('files', { path: hit.ref }, 'Files')));
      acts.push(act('Copy path', 'link', () => copy(hit.ref, 'Path')));
    } else {
      acts.push(act('Copy line', 'copy', () => copy(hit.snip.text, 'Line')));
    }
    return {
      key: `${isNote ? 'note' : 'file'}-in:${hit.ref}`, kind: isNote ? 'In note' : 'In file',
      title: hit.title, snip: hit.snip,
      sub: isNote ? 'Notes' : vfs.parentPath(hit.ref),
      glyph: () => flatGlyph(isNote ? 'sticky-note' : vfs.iconFor(node)), acts,
    };
  }

  function linkRow(kind, ic, title, url, at) {
    return {
      key: `${kind}:${url}`, kind, title: title || url,
      sub: at ? `${url} · ${fmt.fmtAgo(new Date(at).toISOString())}` : url,
      glyph: () => flatGlyph(ic),
      acts: [
        act('Open in Browser', 'globe', () => launch('browser', { url }, 'Browser')),
        act('Copy link', 'link', () => copy(url, 'Link')),
      ],
    };
  }

  const webRow = term => ({
    key: 'web', kind: 'Web', title: `Search the web for “${term}”`,
    sub: 'Opens the Static Proxy in a window — nothing leaves this tab',
    glyph: () => flatGlyph('shield'),
    acts: [
      act('Search the web', 'shield', () => searchWeb(term)),
      act('Copy term', 'copy', () => copy(term, 'Search term')),
    ],
  });

  /* ---------------- natural-language rows - */
  /** Rows for things the line literally asks for, ranked above everything. */
  function actionRows(parsed) {
    const q = parsed.raw.toLowerCase();
    const out = [];
    const push = (key, title, sub, ic, run, extra) => out.push({
      key: `do:${key}`, kind: 'Action', title, sub,
      glyph: () => flatGlyph(ic),
      acts: [act('Run', 'play', run), ...(extra || [])],
    });

    const verb = parsed.raw.match(VERB);
    if (verb) {
      const target = verb[1].trim().toLowerCase();
      /* the terminal is not a listed app; on Linux it is in the wallpaper */
      if (deskterm.available() && /^(the )?(terminal|shell|console|term|bash)\b/.test(target)) {
        push('open-terminal', 'Open Terminal', 'On the Linux desktop', 'terminal',
          () => launch('terminal', {}, 'Terminal'));
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
          () => launch('settings', { section: pane[0].id }, 'Settings'));
      }
    }

    if (/^(?:change|set|new)?\s*wallpaper$|wallpaper$/.test(q)) {
      push('wallpaper', 'Change Wallpaper', 'Opens Settings → Appearance, where the picker lives',
        'wallpaper', () => launch('settings', { section: 'appearance' }, 'Settings'));
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
        push(`mode-${want}`, `Switch to the ${want} theme`, 'Appearance',
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
    if (pinned.length) out.push({ label: 'Suggestions', rows: pinned });
    if (recent.length) out.push({ label: 'Recent files', count: recent.length, rows: recent });
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
        out.push({ label: 'Actions', count: acts.length, rows: acts.slice(0, 7) });
      }
    }

    if (want('apps')) {
      const target = (parsed.raw.match(VERB) || [null, low])[1].toLowerCase();
      const apps = api.listApps().map(a => [a, appScore(target, a)]).filter(p => p[1] >= 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(p => appRow(p[0]));
      if (apps.length) out.push({ label: 'Apps', count: apps.length, rows: apps });
    }

    /* what is already listed by name, so the words-inside group below doesn't repeat it */
    const named = new Set();
    if (want('files')) {
      const hits = vfs.search(term, { limit: 8, tags: true });   /* by name, or by a file tag (Files › Tags) */
      if (hits.length) {
        for (const h0 of hits) named.add(`f:${h0.path}`);
        out.push({ label: 'Files & Folders', count: hits.length, rows: hits.map(fileRow) });
      }
    }

    if (want('settings')) {
      const panes = PANES.map(p => [p, paneScore(low, p)]).filter(p => p[1] >= 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 4).map(p => paneRow(p[0]));
      if (panes.length) out.push({ label: 'Settings', count: panes.length, rows: panes });
    }

    if (want('notes')) {
      /* by title here; a note that only has the words inside it is in the group below, with the line */
      const ft = TI.fold(term.trim());
      const notes = (Array.isArray(store.get('notes')) ? store.get('notes') : [])
        .filter(n => n && ft && TI.fold(n.title || '').includes(ft));
      if (notes.length) {
        for (const n of notes.slice(0, 4)) named.add(`n:${n.id}`);
        out.push({ label: 'Notes', count: notes.length, rows: notes.slice(0, 4).map(noteRow) });
      }
    }

    /* words inside your notes and text files, below everything matched by name */
    if ((want('notes') || want('files')) && TI.words(term).length) {
      const found = TI.query(term, {
        limit: scope ? 10 : 5, skip: named,
        kinds: scope === 'notes' ? ['n'] : scope === 'files' ? ['f'] : null,
      });
      if (found.hits.length) {
        out.push({ label: 'In notes & files', count: found.total, rows: found.hits.map(contentRow) });
      } else if (!found.ready) {
        out.push({ label: 'In notes & files', rows: [], pending: true, note: 'Reading your notes and files…' });
      }
    }

    /* clipboard history: everything under "clip …"; only what you pinned otherwise */
    if (scope === 'clipboard' || (!scope && term.length >= 2)) {
      const hits = CB.search(term);
      const pins = hits.filter(i => i.pinned);
      const rows = scope ? hits.slice(0, 10) : pins.slice(0, 3);
      if (rows.length) {
        out.push({ label: scope ? 'Clipboard history' : 'Pinned clips', count: scope ? hits.length : pins.length,
          rows: rows.map(it => clipRow(it, term)) });
      } else if (scope) {
        out.push({ label: 'Clipboard history', rows: [],
          note: CB.list().some(i => !i.sensitive)
            ? `Nothing in your clipboard history matches “${term}” — every word has to match.`
            : 'Your clipboard history is empty — copy something in StaticOS first.' });
      }
    }

    if (want('games') && term.length >= MIN_CATALOGUE) {
      const classics = classicsCatalog ? classicsCatalog.searchClassics(term) : [];
      if (classics.length) out.push({ label: 'Free Classics', count: classics.length, rows: classics.map(classicRow) });
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
        out.push({ label: 'Bookmarks', count: marks.length,
          rows: marks.slice(0, 4).map(m => linkRow('Bookmark', 'bookmark', m.title, m.url, m.at)) });
      }

      const hist = listOf('proxy.hist').filter(x => x && typeof x.url === 'string')
        .filter(x => `${x.title || ''} ${x.url}`.toLowerCase().includes(low));
      if (hist.length) {
        out.push({ label: 'Recent', count: hist.length,
          rows: hist.slice(0, 3).map(x => linkRow('Recent', 'clock', x.title, x.url, x.at)) });
      }

      const cmds = COMMANDS.filter(c => !spoken.has(c.label) && (!c.when || c.when()))
        .map(c => [c, cmdScore(low, c)]).filter(p => p[1] >= 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(p => cmdRow(p[0]));
      if (cmds.length) out.push({ label: 'Commands', count: cmds.length, rows: cmds });
    }

    if (term) out.push({ label: 'Web', rows: [webRow(term)] });
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
        Number.isFinite(g.count) ? h('span.spot__count', { text: String(g.count) }) : null));
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
          h('small', { text: g.note || 'Loading…' })));
      } else if (g.note) {
        list.appendChild(h('div.spot__note', { text: g.note }));
      }
    }

    if (!S.rows.length) {
      list.appendChild(h('div.spot__empty', { text: `Nothing matches “${S.parsed.raw}”` }));
    } else if (S.parsed.raw && !real) {
      /* the web row is always last, so "nothing here" means exactly that */
      list.insertBefore(
        h('div.spot__empty', { text: `Nothing on this computer matches “${S.parsed.term}” — search the web instead` }),
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
      'aria-label': `Searching ${SCOPE_NAME[S.parsed.scope]} only — clear this filter`,
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
    input.value = S.q;
    if (!S.open) {
      S.open = true;
      host.appendChild(wrap);
      /* Escape steps out of the action chips first, then closes; focus goes
         back to where it was (core/layers.js). Tab is Spotlight's own. */
      S.release = L.push({ name: 'spotlight', el: panel, close: () => (S.actSel >= 0 ? leaveActs() : close()) });
      TI.build();      /* no-op once built; the first time, it is ready by the second keystroke */
    }
    loadClassics();
    paint();
    schedule();
    input.focus();
    input.select();
  }
  function close() {
    if (!S.open) return;
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
    close();
    try { a.run(); } catch (e) { console.error('[spotlight]', e); }
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
      if (inActs) leaveActs(); else move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (inActs) leaveActs(); else move(-1);
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
