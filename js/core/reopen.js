/* ============================================================
   reopen.js — bring back the window you just closed.

   Every window that closes is remembered here, newest last, up to
   ten: its app, the options that say what it was showing (a path,
   a url, a game id…), where it was and how big, its desktop, and
   whether it was snapped, maximised or kept on top. reopen() opens the newest
   one again exactly there; pressing it again walks further back.

   What a window "was showing" starts as the options it was opened
   with. An app whose window moves on (Files to another folder, the
   Browser to another page, Notes to another note) keeps
   win.state.reopen up to date — those keys win, and a null there
   drops an option that no longer applies.

   Keys: Ctrl+Shift+T / ⇧⌘T, the same as a browser's "reopen closed
   tab". In an ordinary browser tab the browser keeps that one for
   itself and never passes it on, so Ctrl+Alt+Shift+T (⌃⌥⇧T) does the
   same thing anywhere. Also in the top bar's Window menu and in
   Spotlight ("Reopen Closed Window").
   ============================================================ */
import { bus } from './bus.js';
import * as wm from './wm.js';
import * as DESK from './desktops.js';
import { getApp } from './registry.js';
import { covered } from './cover.js';
import * as KM from './keymap.js';
import { t } from './i18n.js';

export const MAX = 10;
const stack = [];

/* options that are about the moment a window was opened, not about what
   it shows: geometry (kept separately), and one-shot requests an app
   acts on as it opens (a Forge prompt, a run, a push…) */
const DROP = new Set(['restore', 'x', 'y', 'w', 'h', 'desk', 'seat', 'pin', 'file', 'prompt', 'run', 'ask', 'push', 'remix', 'merge', 'find', 'line', 'quizJoin']);
const plain = v => (typeof v === 'string' ? v.length <= 4000
  : typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean');

function restorable(opts, over) {
  const out = {};
  for (const [k, v] of Object.entries(opts && typeof opts === 'object' ? opts : {})) {
    if (!DROP.has(k) && !k.startsWith('_') && plain(v)) out[k] = v;
  }
  for (const [k, v] of Object.entries(over && typeof over === 'object' ? over : {})) {
    if (v === null || v === undefined) delete out[k];
    else if (!DROP.has(k) && plain(v)) out[k] = v;
  }
  return out;
}

const rectOf = r => (r && [r.x, r.y, r.w, r.h].every(Number.isFinite) ? { x: r.x, y: r.y, w: r.w, h: r.h } : null);

/** What it takes to open window `w` again where it is: null for a window with no app. Also used by
    core/resume.js to bring back the windows that were open when StaticOS closed. */
export function entryOf(w) {
  if (!w || !w.appId || !w.app) return null;
  const title = (w.el && w.el.getAttribute('aria-label')) || w.app.name;
  return {
    app: w.appId, name: w.app.name, icon: w.app.icon, title,
    opts: restorable(w.opts, w.state && w.state.reopen),
    rect: rectOf(w),
    /* the size it has on its own, which a snapped or maximised window goes back to */
    free: rectOf(w.free) || (w.max ? rectOf(w.prev) : null),
    max: !!w.max, snapped: w.max ? null : (w.snapped || null),
    desk: w.desk, pin: !!w.pinned, at: Date.now(),
  };
}

function remember(w) {
  const e = entryOf(w);
  if (!e) return;
  stack.push(e);
  while (stack.length > MAX) stack.shift();
  bus.emit('reopen:change', list());
}

/** Keep a remembered rect on screen if the page got smaller since. */
function fit(r) {
  if (!r) return {};
  const a = wm.workArea();
  const w = Math.min(r.w, a.w), h = Math.min(r.h, a.h + 40);
  return {
    w, h,
    x: Math.max(-w + 90, Math.min(r.x, a.w - 90)),
    y: Math.max(a.y, Math.min(r.y, a.y + a.h - 40)),
  };
}

/** Open a window from an entry (see entryOf), where it was. null when its app is gone. */
export function openEntry(e) {
  if (!e || !getApp(e.app)) return null;
  const desk = DESK.has(e.desk) ? e.desk : DESK.current();
  const seat = e.max ? { max: true } : e.snapped ? { snapped: e.snapped } : null;
  return wm.open(e.app, { ...e.opts, ...fit(seat ? (e.free || e.rect) : e.rect), desk, seat, pin: e.pin === true }) || null;
}

/** Open the newest closed window again (or the i-th newest: 0 = newest).
    Returns the window, or null when there is nothing to bring back. */
export function reopen(i = 0) {
  while (stack.length) {
    const at = stack.length - 1 - Math.max(0, Math.min(i, stack.length - 1));
    const [e] = stack.splice(at, 1);
    if (!getApp(e.app)) continue;                     /* uninstalled since */
    const desk = DESK.has(e.desk) ? e.desk : DESK.current();
    const w = openEntry(e);
    /* back on the desktop it was on: go there with it */
    if (w && w.el && w.desk !== DESK.current()) wm.focus(w);
    bus.emit('reopen:change', list());
    if (w) bus.emit('reopen:done', { app: e.app });
    return w || null;
  }
  return null;
}

export const count = () => stack.length;
/** Newest first: [{ app, name, icon, title, at }] */
export const list = () => stack.slice().reverse().map(({ app, name, icon, title, at }) => ({ app, name, icon, title, at }));
export const peek = () => list()[0] || null;
export function clear() { stack.length = 0; bus.emit('reopen:change', []); }

function typing() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}
function onKey(e) {
  if (covered()) return;
  /* Ctrl+Shift+T / ⇧⌘T and Ctrl+Alt+Shift+T, or the person's own keys
     (Settings › Shortcuts, js/core/keymap.js — which also reads a non-Latin
     layout by the physical key). Off a Mac, Ctrl+Alt with a letter can be
     AltGr typing: that one never counts while typing. */
  const keys = KM.match(e, 'reopen');
  if (!keys || (KM.typesChar(keys) && typing())) return;
  e.preventDefault();
  if (!reopen()) {
    bus.emit('noti:push', { app: 'StaticOS', icon: 'window', title: t('No closed windows to bring back'), timeout: 2500 });
  }
}

let started = false;
/** Start remembering closed windows and listening for the keys. Safe to call twice. */
export function init() {
  if (started || typeof window === 'undefined') return;
  started = true;
  bus.on('win:close', remember);
  window.addEventListener('keydown', onKey);
}

export default { init, reopen, count, list, peek, clear, MAX };
