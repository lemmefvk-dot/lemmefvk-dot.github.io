/* ============================================================
   keymap.js — every keyboard shortcut StaticOS binds, in one list.

   The shortcut sheet (hold ⌘ / Ctrl, js/shell/cheatsheet.js),
   Help › Keyboard Shortcuts, Settings › Shortcuts and the little
   hint over the dock all read from here, so they can't drift apart.
   Each row says where its handler lives. Handlers never test keys
   themselves: they ask matches(e, id) below, so a shortcut changed in
   Settings › Shortcuts (kept in prefs.keymap) changes everywhere at once.

   Keys are written as text and drawn for the computer in use:
     'Mod+K'         Mod is ⌘ on a Mac and Ctrl elsewhere (the shell
                     takes either one, js/main.js)
     'Ctrl+Alt+W'    Ctrl is the Control key on every computer
     'Left / Right'  " / " separates keys that do the same job
   Apps list their own keys the same way, as `shortcuts` in their
   defineApp() ([keys, what it does] pairs); the sheet shows the
   ones of the app in front.
   ============================================================ */
import { isMac } from './util.js';
import { store } from './store.js';

/* group, keys, what it does, where it is bound
   (+ mac: listed on a Mac only — elsewhere the keys never arrive or are
   another row's; hint: shown over the dock; yields: an action that shares
   these keys on purpose, and takes over when this row has nothing to do —
   off a Mac, ⌃Tab means the next tab, or the next window with no tabs) */
export const GLOBAL = [
  { group: 'Find and open', keys: 'Mod+K', label: 'Static Search', where: 'shell/spotlight.js', hint: 'search' },
  { group: 'Find and open', keys: 'Mod+Space', label: 'Static Search (when not typing)', where: 'shell/spotlight.js' },
  { group: 'Find and open', keys: 'Ctrl+Alt+A', label: 'Open the launcher', where: 'shell/a11y.js' },
  { group: 'Find and open', keys: 'Mod+.', label: 'Emoji and symbols, while typing', where: 'shell/emoji.js' },
  { group: 'Find and open', keys: 'Ctrl+Alt+S', label: 'Read the selected text aloud (with nothing selected: stop)', where: 'shell/readaloud.js' },
  { group: 'Find and open', keys: 'Mod', hold: true, label: 'Hold it on its own for a second: every shortcut', where: 'shell/cheatsheet.js' },

  { group: 'Windows', keys: 'Mod+Tab', label: 'Next window (with Shift, the one before)', where: 'main.js' },
  { group: 'Windows', keys: 'Ctrl+Alt+. / Ctrl+Alt+,', label: 'Next / previous window', where: 'shell/a11y.js' },
  { group: 'Windows', keys: 'Mod+W', label: 'Close the front window', where: 'core/wm.js', hint: 'close' },
  { group: 'Windows', keys: 'Mod+Shift+T / Ctrl+Alt+Shift+T', label: 'Reopen the last closed window, where it was (again: the one before); the second one is for browsers that keep the first for their own tabs', where: 'core/reopen.js' },
  { group: 'Windows', keys: 'Ctrl+Alt+W', label: 'Close the front window (when not typing)', where: 'main.js' },
  { group: 'Windows', keys: 'Mod+M / Ctrl+Alt+M', label: 'Minimise the front window (when not typing)', where: 'core/wm.js · main.js' },
  { group: 'Windows', keys: 'Mod+Alt+Left / Mod+Alt+Right', label: 'Snap the front window left / right', where: 'core/wm.js', hint: 'snap', mac: true },
  { group: 'Windows', keys: 'Mod+Alt+Up', label: 'Maximise the front window', where: 'core/wm.js', mac: true },
  { group: 'Windows', keys: 'Ctrl+Alt+Left / Ctrl+Alt+Right', label: 'Snap left / right half', where: 'main.js', hint: 'snap' },
  { group: 'Windows', keys: 'Ctrl+Alt+Up / Ctrl+Alt+Down', label: 'Snap to the top / bottom half', where: 'main.js' },
  { group: 'Windows', keys: 'Ctrl+Alt+1 / Ctrl+Alt+2 / Ctrl+Alt+3 / Ctrl+Alt+4', label: 'Snap to a quarter (when not typing)', where: 'main.js' },
  { group: 'Windows', keys: 'Ctrl+Alt+Enter', label: 'Maximise or restore', where: 'main.js' },
  { group: 'Windows', keys: 'Ctrl+Alt+F', label: 'Full screen (when not typing)', where: 'main.js' },
  { group: 'Windows', keys: 'Ctrl+Alt+Z', label: 'Snap layouts for the front window', where: 'shell/snaplayouts.js' },
  { group: 'Windows', keys: 'Ctrl+Alt+Space', label: 'Window menu: move, size, snap, keep on top, close', where: 'shell/a11y.js' },
  { group: 'Windows', keys: 'Ctrl+Alt+P', label: 'Keep the front window on top of the others (again: stop)', where: 'shell/a11y.js' },
  { group: 'Windows', keys: 'Ctrl+Tab / Ctrl+Shift+Tab', label: 'Next / previous tab, in a window with tabs (drop a window onto another one\'s title bar to make them)', where: 'core/wintabs.js', yields: 'win.cycle' },

  { group: 'Desktops', keys: 'Mod+`', label: 'Window overview', where: 'shell/overview.js', hint: 'overview' },
  { group: 'Desktops', keys: 'Ctrl+Alt+O', label: 'Window overview', where: 'shell/a11y.js' },
  { group: 'Desktops', keys: 'Ctrl+Up', label: 'Overview with the desktops (when not typing)', where: 'shell/desktops.js' },
  { group: 'Desktops', keys: 'Ctrl+Left / Ctrl+Right', label: 'Previous / next desktop (when not typing)', where: 'shell/desktops.js' },
  { group: 'Desktops', keys: 'Ctrl+Mod+Left / Ctrl+Mod+Right', label: 'Previous / next desktop', where: 'shell/desktops.js', mac: true },
  { group: 'Desktops', keys: 'Ctrl+Alt+Shift+Left / Ctrl+Alt+Shift+Right', label: 'Take the front window to the desktop beside', where: 'shell/desktops.js' },

  { group: 'Keyboard and access', keys: 'Ctrl+Q', label: 'Lock the screen', where: 'main.js' },
  { group: 'Keyboard and access', keys: 'Esc', label: 'Close the menu, panel or sheet on top', where: 'core/layers.js' },
  { group: 'Keyboard and access', keys: 'Tab', label: 'First stops: skip to the front window, dock, top bar or desktop', where: 'shell/a11y.js' },
  { group: 'Keyboard and access', keys: 'Left / Right / Up / Down', label: 'Move inside the dock, launcher, menus and lists', where: 'core/roving.js' },
  { group: 'Keyboard and access', keys: 'Shift+Left / Shift+Right', label: 'Move the focused app along the dock', where: 'shell/dock.js' },
  { group: 'Keyboard and access', keys: 'Enter', label: 'Open the focused desktop icon', where: 'shell/a11y.js' },
  { group: 'Keyboard and access', keys: 'Shift+F10', label: 'Context menu of what has focus', where: 'shell/a11y.js' },
  { group: 'Keyboard and access', keys: 'Shift+?', label: 'Flash the shortcut hint (when not typing)', where: 'main.js' },
  { group: 'Keyboard and access', keys: 'Ctrl+Alt+L', label: 'Magnifier on / off', where: 'shell/magnifier.js' },
  { group: 'Keyboard and access', keys: 'Ctrl+Alt+= / Ctrl+Alt+-', label: 'Magnifier: zoom in / out (while it is on)', where: 'shell/magnifier.js' },
];

export const GROUPS = [...new Set(GLOBAL.map(r => r.group))];

const MAC = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↵', Backspace: '⌫', Delete: '⌦', Tab: '⇥' };
const PC = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Del', Tab: 'Tab' };
const BOTH = { Left: '←', Right: '→', Up: '↑', Down: '↓', Esc: 'Esc', Space: 'Space', PageUp: 'PgUp', PageDown: 'PgDn', Plus: '+' };
/* modifiers in the order each platform prints them: ⌃⌥⇧⌘ / Ctrl+Alt+Shift */
const RANK = (k, mac) => ({ Ctrl: 0, Alt: 1, Shift: 2, Mod: mac ? 3 : 0 })[k] ?? 9;

/** One key name, as this computer labels it. */
export function keyLabel(k, mac = isMac) {
  const t = (mac ? MAC : PC)[k] || BOTH[k];
  if (t) return t;
  return k.length === 1 ? k.toUpperCase() : k;
}

/** 'Mod+Alt+Left / Mod+Alt+Right' -> [['⌥','⌘','←'], ['⌥','⌘','→']] on a Mac
    (a '+' key is written 'Plus'; 'Ctrl+Mod+…' on a PC is the one Ctrl). */
export function combos(keys, mac = isMac) {
  return String(keys).split(' / ').map(c => {
    const parts = c.split('+').filter(Boolean).map((p, i) => [p, i])
      .sort((a, b) => RANK(a[0], mac) - RANK(b[0], mac) || a[1] - b[1]).map(([p]) => p);
    const out = [];
    for (const p of parts) { const l = keyLabel(p, mac); if (!out.includes(l)) out.push(l); }
    return out;
  });
}

/** Plain text for a list or a tooltip: '⌘K', 'Ctrl+Alt+W', '⌥⌘← / ⌥⌘→'. */
export function keysText(keys, mac = isMac) {
  return combos(keys, mac).map(c => (mac ? c.join('') : c.join('+'))).join(' / ');
}

/** The global rows this computer can actually use. */
export const globalRows = (mac = isMac) => {
  const t = table(mac);
  return GLOBAL.filter(r => !r.mac || mac).map(r => {
    const ids = idsOf(r);
    if (!ids) return r;
    const keys = ids.map(id => t.byId[id].keys.join(' / ')).join(' / ');
    return keys === r.keys ? r : { ...r, keys, changed: true };
  });
};

/** An app's own rows from its defineApp({ shortcuts }), tidied:
    [keys, label] pairs or { keys, label } objects; anything else is dropped. */
export function appRows(app) {
  const list = Array.isArray(app?.shortcuts) ? app.shortcuts : [];
  return list.map(s => (Array.isArray(s) ? { keys: s[0], label: s[1] } : s))
    .filter(s => s && typeof s.keys === 'string' && s.keys && typeof s.label === 'string' && s.label);
}

/* ============================================================
   Your own keys (Settings › Shortcuts)

   ACTIONS names the rows that can be changed, keyed by a row's default
   keys: one action id for a row whose keys all do the same thing, or one
   [id, what it does] per combination for a row like "Snap left / right
   half". A row left out (Esc, Tab, the arrows inside lists, Shift+F10,
   holding ⌘) is a standard key every desktop shares and stays as it is.
   A handler asks matches(e, 'win.close') — never e.key itself.
   ============================================================ */
const ACTIONS = {
  'Mod+K': 'search',
  'Mod+Space': 'search.space',
  'Ctrl+Alt+A': 'launcher',
  'Mod+.': 'emoji',
  'Ctrl+Alt+S': 'readaloud',
  'Mod+Tab': 'win.cycle',
  'Ctrl+Alt+. / Ctrl+Alt+,': [['win.next', 'Next window'], ['win.prev', 'Previous window']],
  'Mod+W': 'win.close',
  'Mod+Shift+T / Ctrl+Alt+Shift+T': 'reopen',
  'Ctrl+Alt+W': 'win.close.alt',
  'Mod+M / Ctrl+Alt+M': 'win.min',
  'Mod+Alt+Left / Mod+Alt+Right': [['win.snapLeft', 'Snap the front window left'], ['win.snapRight', 'Snap the front window right']],
  'Mod+Alt+Up': 'win.maxSnap',
  'Ctrl+Alt+Left / Ctrl+Alt+Right': [['snap.left', 'Snap to the left half'], ['snap.right', 'Snap to the right half']],
  'Ctrl+Alt+Up / Ctrl+Alt+Down': [['snap.top', 'Snap to the top half'], ['snap.bottom', 'Snap to the bottom half']],
  'Ctrl+Alt+1 / Ctrl+Alt+2 / Ctrl+Alt+3 / Ctrl+Alt+4': [['snap.tl', 'Snap to the top-left quarter (when not typing)'], ['snap.tr', 'Snap to the top-right quarter (when not typing)'],
    ['snap.bl', 'Snap to the bottom-left quarter (when not typing)'], ['snap.br', 'Snap to the bottom-right quarter (when not typing)']],
  'Ctrl+Alt+Enter': 'win.max',
  'Ctrl+Alt+F': 'win.full',
  'Ctrl+Alt+Z': 'snap.layouts',
  'Ctrl+Alt+Space': 'win.menu',
  'Ctrl+Alt+P': 'win.pin',
  'Mod+`': 'overview',
  'Ctrl+Alt+O': 'overview.alt',
  'Ctrl+Up': 'overview.desks',
  'Ctrl+Left / Ctrl+Right': [['desk.prev', 'Previous desktop (when not typing)'], ['desk.next', 'Next desktop (when not typing)']],
  'Ctrl+Mod+Left / Ctrl+Mod+Right': [['desk.prevMac', 'Previous desktop'], ['desk.nextMac', 'Next desktop']],
  'Ctrl+Alt+Shift+Left / Ctrl+Alt+Shift+Right': [['desk.takeLeft', 'Take the front window to the desktop on the left'], ['desk.takeRight', 'Take the front window to the desktop on the right']],
  'Ctrl+Q': 'lock',
  'Shift+?': 'hint',
  'Ctrl+Alt+L': 'magnifier',
  'Ctrl+Alt+= / Ctrl+Alt+-': [['magnifier.in', 'Magnifier: zoom in'], ['magnifier.out', 'Magnifier: zoom out']],
};
/* Shift turns these round (⌘Tab forward, ⇧⌘Tab back), whatever the keys */
const SHIFT_FLIPS = new Set(['win.cycle']);
const PREF = 'prefs.keymap';

const idsOf = r => {
  const a = ACTIONS[r.keys];
  return !a ? null : typeof a === 'string' ? [a] : a.map(x => x[0]);
};

/* ---- combinations ----------------------------------------------- */
const MODTOK = { Ctrl: 'ctrl', Alt: 'alt', Shift: 'shift', Mod: 'mod', Meta: 'meta', Cmd: 'meta' };
const NAMED = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Esc: 'Escape', Enter: 'Enter', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' };
const PUNCT = { '.': 'Period', ',': 'Comma', '`': 'Backquote', '/': 'Slash', ';': 'Semicolon', "'": 'Quote',
  '[': 'BracketLeft', ']': 'BracketRight', '-': 'Minus', '=': 'Equal', '\\': 'Backslash' };
const FKEY = /^F([1-9]|1[0-2])$/;
const isChar = t => t.length === 1 && !/^[A-Z0-9]$/.test(t);       /* . , ` ? … */

/** 'Ctrl+Alt+K' -> { ctrl, alt, shift, meta, mod, key } */
export function parse(combo) {
  const p = { ctrl: false, alt: false, shift: false, meta: false, mod: false, key: '' };
  for (const t of String(combo || '').split('+').filter(Boolean)) {
    if (MODTOK[t]) p[MODTOK[t]] = true;
    else p.key = t.length === 1 ? t.toUpperCase() : t;
  }
  return p;
}
/* The keys as this computer reads them: Mod is ⌘ on a Mac and Ctrl
   elsewhere; next to an explicit Ctrl it is ⌘ / the Windows key. */
const concrete = (p, mac) => ({
  ctrl: p.ctrl || (p.mod && !mac),
  alt: p.alt, shift: p.shift,
  meta: p.meta || (p.mod && (mac || p.ctrl)),
  key: p.key,
});
/* one string per physical combination: what conflicts compare */
const sig = c => `${c.ctrl ? 'Ctrl+' : ''}${c.alt ? 'Alt+' : ''}${c.shift ? 'Shift+' : ''}${c.meta ? 'Meta+' : ''}${c.key}`;
const sigs = (combo, mac, flips) => {
  const c = concrete(parse(combo), mac);
  const out = [sig(c)];
  if (flips && !c.shift) out.push(sig({ ...c, shift: true }));
  return out;
};

/* 0: not this key · 1: the character typed · 2: the physical key (⌥ on a
   Mac, another alphabet, or Shift turned it into a different character) */
function keyHit(tok, e) {
  const k = e.key || '';
  if (/^[A-Z]$/.test(tok)) return /^[a-z]$/i.test(k) ? +(k.toUpperCase() === tok) : (e.code === 'Key' + tok ? 2 : 0);
  if (/^[0-9]$/.test(tok)) return /^[0-9]$/.test(k) ? +(k === tok) : (e.code === 'Digit' + tok || e.code === 'Numpad' + tok ? 2 : 0);
  if (FKEY.test(tok)) return +(k === tok);
  if (tok === 'Space') return +(k === ' ' || e.code === 'Space');
  if (tok === 'Plus') return k === '+' ? 1 : (e.code === 'NumpadAdd' ? 2 : 0);
  if (NAMED[tok]) return +(k === NAMED[tok]);
  if (k === tok) return 1;
  return PUNCT[tok] && e.code === PUNCT[tok] ? 2 : 0;
}
const mods = (e, c, anyShift) => e.ctrlKey === c.ctrl && e.altKey === c.alt && e.metaKey === c.meta && (anyShift || e.shiftKey === c.shift);
/* Mod alone also takes the other one: ⌃K opens Search on a Mac too */
const loose = (e, p, anyShift) => p.mod && !p.ctrl && !p.meta && (e.ctrlKey || e.metaKey) && e.altKey === p.alt && (anyShift || e.shiftKey === p.shift);

/* ---- the table: defaults, with the person's own keys on top ----- */
const overrides = () => { const o = store.get(PREF); return o && typeof o === 'object' ? o : {}; };
let cached = null;
function table(mac = isMac) {
  const ov = overrides();
  if (cached && cached.mac === mac && cached.ov === ov) return cached;
  const list = [], byId = {}, fixed = [];
  for (const row of GLOBAL) {
    const listed = !row.mac || mac;
    const a = ACTIONS[row.keys];
    if (!a) { if (listed && !row.hold) fixed.push(row); continue; }
    const alts = row.keys.split(' / ');
    const parts = typeof a === 'string' ? [[a, row.label, alts]] : a.map(([id, label], i) => [id, label, [alts[i]]]);
    for (const [id, label, defaults] of parts) {
      const own = typeof ov[id] === 'string' && parse(ov[id]).key ? ov[id].split(' / ') : null;
      const keys = own || defaults;
      const act = {
        id, label, group: row.group, where: row.where, listed, defaults, keys, changed: !!own, flips: SHIFT_FLIPS.has(id),
        compiled: keys.map(text => { const p = parse(text); return { text, p, c: concrete(p, mac) }; }),
      };
      list.push(act);
      byId[id] = act;
    }
  }
  const t = { mac, ov, list, byId, fixed };
  if (mac === isMac) cached = t;
  return t;
}

/* ---- matching ---------------------------------------------------
   Resolved once per key press and remembered for every handler that
   asks: the exact combination first; then Mod pressed as the other key
   (⌃K on a Mac); then the rows listed on a Mac only, for keyboards
   that send them anyway. An action matched in an earlier pass hides
   the later ones, so one key press is never two shortcuts. */
const seen = new WeakMap();
const NONE = new Map();
let capturing = false;
function resolve(e) {
  if (!e || capturing || e.isComposing) return NONE;
  let hit = seen.get(e);
  if (hit) return hit;
  hit = new Map();
  /* AltGr arrives as Ctrl+Alt and types characters (ą, @, €): never a shortcut */
  if (!e.getModifierState?.('AltGraph')) {
    const list = table().list;
    const passes = [[true, false], [true, true], [false, false], [false, true]];
    for (const [listed, isLoose] of passes) {
      for (const a of list) {
        if (a.listed !== listed) continue;
        for (const { text, p, c } of a.compiled) {
          const k = keyHit(p.key, e);
          if (!k) continue;
          const anyShift = (k === 1 && isChar(p.key)) || (a.flips && !p.shift);
          if (isLoose ? loose(e, p, anyShift) : mods(e, c, anyShift)) { if (!hit.has(a.id)) hit.set(a.id, text); break; }
        }
      }
      if (hit.size) break;
    }
  }
  seen.set(e, hit);
  return hit;
}
/** Is this key press the shortcut for `id`? */
export const matches = (e, id) => resolve(e).has(id);
/** The combination that matched ('Ctrl+Alt+Shift+T'), or '' */
export const match = (e, id) => resolve(e).get(id) || '';
/** Ctrl+Alt with a character can be AltGr typing off a Mac: handlers keep
    such a shortcut out of text fields */
export const typesChar = (combo, mac = isMac) => {
  const c = concrete(parse(combo), mac);
  return !mac && c.ctrl && c.alt && !c.meta && (/^[A-Z0-9]$/.test(c.key) || isChar(c.key));
};

/** While Settings records a new combination, no shortcut fires. */
export function capture(on) { capturing = !!on; }
export const isCapturing = () => capturing;

/* ---- reading and changing ---------------------------------------- */
/** Every action this computer lists, in sheet order, with the fixed rows
    between them ({ id: null, fixed: true }). */
export function actionRows(mac = isMac) {
  const t = table(mac);
  const out = [];
  for (const row of GLOBAL) {
    if (row.mac && !mac) continue;
    const ids = idsOf(row);
    if (ids) ids.forEach(id => out.push(t.byId[id]));
    else out.push({ id: null, fixed: true, hold: !!row.hold, label: row.label, group: row.group, where: row.where, keys: row.keys.split(' / ') });
  }
  return out;
}
export const action = (id, mac = isMac) => table(mac).byId[id] || null;
export const bindings = (id, mac = isMac) => action(id, mac)?.keys.slice() || [];
/** What to print beside a menu item: the first of the action's keys. */
export const hint = (id, mac = isMac) => { const k = bindings(id, mac)[0]; return k ? keysText(k, mac) : ''; };
export const changedCount = () => Object.keys(overrides()).length;

export function setBinding(id, combo) {
  const a = action(id);
  if (!a || !parse(combo).key) return false;
  const next = { ...overrides() };
  if (a.defaults.join(' / ') === combo) delete next[id]; else next[id] = combo;
  store.set(PREF, next);
  return true;
}
export function resetBinding(id) {
  const next = { ...overrides() };
  delete next[id];
  store.set(PREF, next);
}
export function resetAll() { store.set(PREF, {}); }

/** The combination a key press makes, written the way this list writes
    keys ('Mod+Alt+J'), or '' while only modifiers are down. */
const MODKEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS', 'Super', 'Hyper'];
export function fromEvent(e, mac = isMac) {
  if (!e || MODKEYS.includes(e.key)) return '';
  const k = e.key || '';
  let tok = '';
  for (const [t, v] of Object.entries(NAMED)) if (k === v) tok = t;
  if (!tok) {
    if (k === ' ' || e.code === 'Space') tok = 'Space';
    else if (FKEY.test(k)) tok = k;
    else if (/^[a-z0-9]$/i.test(k)) tok = k.toUpperCase();
    else if (k === '+') tok = 'Plus';
    else if (k.length === 1 && k > ' ' && k < '\x7f') tok = k;
    else {
      const m = /^(?:Key|Digit)([A-Z0-9])$/.exec(e.code || '');
      tok = m ? m[1] : (Object.entries(PUNCT).find(([, c]) => c === e.code)?.[0] || '');
    }
  }
  if (!tok) return '';
  const out = mac
    ? [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Mod']
    : [e.ctrlKey && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'];
  return [...out.filter(Boolean), tok].join('+');
}

/* ---- what may not be used, and what is risky ---------------------
   BLOCKED: the computer keeps these and a page never sees them.
   RISKY: the browser or the computer may take them first (they reach
   StaticOS in full screen or an installed app window), or apps inside
   StaticOS use them. Written as sig() writes keys. */
const BLOCKED_PC = {
  'Ctrl+Alt+Delete': 'the security screen', 'Alt+Tab': 'switching apps', 'Alt+Shift+Tab': 'switching apps',
  'Alt+F4': 'closing the browser', 'Alt+Escape': 'switching windows', 'Ctrl+Escape': 'the Start menu', 'Ctrl+Shift+Escape': 'Task Manager',
};
const BLOCKED_MAC = {
  'Meta+Tab': 'switching apps', 'Shift+Meta+Tab': 'switching apps', 'Alt+Meta+Escape': 'Force Quit',
  'Ctrl+Meta+Q': 'locking the Mac', 'Meta+H': 'hiding the browser', 'Alt+Meta+H': 'hiding other apps',
  'Shift+Meta+3': 'screenshots', 'Shift+Meta+4': 'screenshots', 'Shift+Meta+5': 'screenshots',
};
const BROWSER = {
  'Mod+W': 'closes the tab', 'Mod+Shift+W': 'closes the window', 'Mod+T': 'opens a tab', 'Mod+Shift+T': 'reopens a closed tab',
  'Mod+N': 'opens a window', 'Mod+Shift+N': 'opens a private window', 'Mod+Tab': 'switches tabs', 'Mod+Shift+Tab': 'switches tabs',
  'Mod+PageUp': 'switches tabs', 'Mod+PageDown': 'switches tabs', 'Mod+L': 'goes to the address bar', 'Mod+D': 'bookmarks the page',
  'Mod+R': 'reloads the page', 'Mod+Shift+R': 'reloads the page', 'Mod+P': 'prints', 'Mod+J': 'shows downloads', 'Mod+Shift+Q': 'quits the browser',
  'Mod+=': 'zooms the page', 'Mod+-': 'zooms the page', 'Mod+0': 'resets the zoom', 'Mod+Plus': 'zooms the page',
  F5: 'reloads the page', F11: 'goes full screen', F12: 'opens developer tools',
  ...Object.fromEntries('123456789'.split('').map(n => ['Mod+' + n, 'switches tabs'])),
};
const BROWSER_MAC = {
  'Mod+Q': 'quits the browser', 'Mod+Space': 'opens Spotlight', 'Ctrl+Space': 'switches the input language', 'Mod+`': 'switches the browser’s windows',
  'Mod+M': 'minimises the browser', 'Mod+,': 'opens browser settings', 'Ctrl+Left': 'moves between Spaces', 'Ctrl+Right': 'moves between Spaces',
  'Ctrl+Up': 'opens Mission Control', 'Ctrl+Down': 'shows the app’s windows',
};
const BROWSER_PC = { 'Mod+H': 'shows history', 'Mod+U': 'shows the page source', 'Mod+E': 'searches the web' };
const TEXT = {
  'Mod+C': 'Copy', 'Mod+V': 'Paste', 'Mod+X': 'Cut', 'Mod+Z': 'Undo', 'Mod+Shift+Z': 'Redo', 'Mod+Y': 'Redo', 'Mod+A': 'Select all',
  'Mod+B': 'Bold', 'Mod+I': 'Italic', 'Mod+U': 'Underline', 'Mod+S': 'Save', 'Mod+F': 'Find', 'Mod+O': 'Open', 'Mod+G': 'Find next',
};
const bySig = (obj, mac) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [sigs(k, mac)[0], v]));

/** Why `combo` may misbehave, in a sentence — or ''. */
export function warnFor(combo, mac = isMac) {
  const s = sigs(combo, mac)[0], t = keysText(combo, mac);
  const what = bySig({ ...BROWSER, ...(mac ? BROWSER_MAC : BROWSER_PC) }, mac)[s];
  if (what) return `The browser or your computer may keep ${t} for itself (it ${what}). It reaches StaticOS in full screen or as an installed app.`;
  const ed = bySig(TEXT, mac)[s];
  if (ed) return `Apps use ${t} for ${ed}: this shortcut would take it from them in every window.`;
  if (typesChar(combo, mac)) return `On some keyboards ${t} types a letter (AltGr), so it works only when you are not typing.`;
  return '';
}

/** Can `id` take `combo`? { ok, warn } or { error, conflicts: [{ id, label }] } */
export function check(id, combo, mac = isMac) {
  const p = parse(combo);
  const t = keysText(combo, mac);
  if (!p.key) return { error: 'Hold the modifier keys and press one more key.' };
  if (!(p.ctrl || p.alt || p.meta || p.mod) && !FKEY.test(p.key)) {
    return { error: `${t} on its own would get in the way of typing. Hold ${mac ? '⌃, ⌥ or ⌘' : 'Ctrl or Alt'} with it.` };
  }
  const c = concrete(p, mac);
  if (!mac && c.meta) return { error: 'The Windows key belongs to your computer, so StaticOS never sees it. Use Ctrl or Alt.' };
  const kept = (mac ? BLOCKED_MAC : BLOCKED_PC)[sig(c)];
  if (kept) return { error: `Your computer keeps ${t} for ${kept}, so StaticOS would never see it. Try another.` };
  const conflicts = conflictsFor(id, combo, mac);
  if (conflicts.length) return { error: `${t} is already ${conflicts.map(x => `“${x.label}”`).join(' and ')}.`, conflicts };
  return { ok: true, warn: warnFor(combo, mac) };
}

/** The other actions (and standard keys) that `combo` would collide with. */
export function conflictsFor(id, combo, mac = isMac) {
  const t = table(mac);
  const mine = new Set(sigs(combo, mac, SHIFT_FLIPS.has(id)));
  const out = [];
  for (const a of t.list) {
    if (a.id === id || !a.listed) continue;
    if (a.keys.some(k => sigs(k, mac, a.flips).some(s => mine.has(s)))) out.push({ id: a.id, label: a.label });
  }
  for (const r of t.fixed) {
    if (r.yields === id) continue;
    if (r.keys.split(' / ').some(k => mine.has(sigs(k, mac)[0]))) out.push({ id: null, label: r.label });
  }
  return out;
}

/** Bindings that collide right now: Map id -> [{ id, label }] */
export function conflicts(mac = isMac) {
  const out = new Map();
  for (const a of table(mac).list) {
    if (!a.listed) continue;
    const hits = a.keys.flatMap(k => conflictsFor(a.id, k, mac)).filter((x, i, arr) => arr.findIndex(y => y.label === x.label) === i);
    if (hits.length) out.set(a.id, hits);
  }
  return out;
}

export default {
  GLOBAL, GROUPS, keyLabel, combos, keysText, globalRows, appRows,
  matches, match, typesChar, capture, isCapturing, actionRows, action, bindings, hint, changedCount,
  setBinding, resetBinding, resetAll, fromEvent, warnFor, check, conflictsFor, conflicts, parse,
};
