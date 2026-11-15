/* ============================================================
   resume.js — "Reopen what I had open" (Settings › Desktop › Startup).

   While prefs.reopenWindows is on, the windows that are open are
   remembered (session.resume): each one's app, what it was showing,
   where it was and how big, its desktop, and whether it was snapped,
   maximised or kept on top — the same record core/reopen.js keeps
   for a closed window. The next time StaticOS starts, those windows
   open again instead of the one starter Files window.

   What a window was showing is only what its app puts in its
   options (a folder, a note, a page): text a person typed into a
   window and had not saved is not kept — that is the app's own
   to save.

     enabled()    is it on?
     restore()    open the remembered windows; true if any opened
     init()       start remembering (call once the desktop is up)
     saved()      the remembered list
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';
import * as wm from './wm.js';
import { entryOf, openEntry } from './reopen.js';

const KEY = 'session.resume';
const MAX = 12;
export const enabled = () => store.get('prefs.reopenWindows', false) === true;
export const saved = () => { const v = store.get(KEY, []); return Array.isArray(v) ? v : []; };

let restoring = false;
let timer = 0;

function remember() {
  if (restoring || !enabled()) return;
  const now = wm.list().map(entryOf).filter(Boolean).slice(0, MAX);
  /* entryOf stamps the time; a list that differs only by that is the same list */
  const strip = l => JSON.stringify(l.map(({ at, ...rest }) => rest));
  if (strip(now) !== strip(saved())) store.set(KEY, now);
}

/** Open what was open last time. true when at least one window opened. */
export function restore() {
  if (!enabled()) return false;
  const list = saved();
  if (!list.length) return false;
  restoring = true;
  let opened = 0;
  try {
    for (const e of list.slice(0, MAX)) { try { if (openEntry(e)) opened++; } catch (err) { /* one bad entry must not stop the rest */ } }
  } finally { restoring = false; }
  return opened > 0;
}

let started = false;
export function init() {
  if (started) return;
  started = true;
  const later = () => { clearTimeout(timer); timer = setTimeout(remember, 700); };
  bus.on('win:list', later);
  bus.on('win:max', later);
  bus.on('win:snap', later);
  bus.on('win:unsnap', later);
  /* a window dragged or resized sends none of those: look again as the page goes away */
  window.addEventListener('pagehide', () => { clearTimeout(timer); remember(); });
  later();
}

export default { enabled, restore, init, saved };
