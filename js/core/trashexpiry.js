/* ============================================================
   trashexpiry.js — the Trash that empties itself after 30 days.

   Off by default (Settings › Storage, prefs.trashAuto). When it is on,
   an item that has been in ~/Trash for 30 days or more is deleted for
   good: at start-up, and once an hour after that (so a tab left open
   for days still catches up). The stored bytes of any picture, video or
   song among them are freed too (media.gc). Only items directly in the
   Trash carry a date; a folder is judged as a whole.

   When an item entered the Trash is node.trashedAt, written by vfs.rm
   and vfs.mv (and kept in the saved snapshot). Items that were already
   in the Trash before this existed, or when the setting is first turned
   on, have no date: they are stamped with the moment we first see them
   — never a made-up date in the past — so their 30 days start then.
   This runs without any window, so it lives here, not in Files.
   ============================================================ */
import { vfs } from './vfs.js';
import { store } from './store.js';
import { bus } from './bus.js';
import media from './media.js';

export const DAYS = 30;
const DAY = 86400000;
const TRASH = `${vfs.HOME}/Trash`;

export const enabled = () => store.get('prefs.trashAuto') === true;

const kids = () => vfs.ls(TRASH, { hidden: true });

/** Give every undated item in the Trash the current time. Returns how many. */
export function stampUndated(now = Date.now()) {
  let n = 0;
  for (const k of kids()) if (!k.trashedAt) { k.trashedAt = now; n++; }
  if (n) bus.emit('fs:change', TRASH, TRASH);       /* saved with the next snapshot */
  return n;
}

/** Whole days until an item is deleted (rounded up, never below 0), or null
    when the setting is off or the item has no date yet. */
export function daysLeft(node, now = Date.now()) {
  if (!enabled() || !node || !node.trashedAt) return null;
  return Math.max(0, Math.ceil((node.trashedAt + DAYS * DAY - now) / DAY));
}

let running = null;
/** Delete what is 30 days old. Resolves to how many items went. */
export function sweep(now = Date.now()) {
  if (!enabled()) return Promise.resolve(0);
  if (running) return running;
  running = (async () => {
    stampUndated(now);
    const old = kids().filter(k => k.trashedAt && now - k.trashedAt >= DAYS * DAY);
    let gone = 0;
    for (const k of old) if (vfs.rm(`${TRASH}/${k.name}`, { permanent: true })) gone++;
    if (gone) {
      try { await media.gc(); } catch (e) { /* IndexedDB unavailable: the bytes go on the next gc */ }
      bus.emit('trash:expired', { count: gone });
    }
    return gone;
  })().finally(() => { running = null; });
  return running;
}

let started = false;
export function init() {
  if (started) return;
  started = true;
  sweep();
  setInterval(() => { sweep(); }, 60 * 60 * 1000);
  /* turning it on starts the clock for what is already in the Trash */
  store.sub('prefs.trashAuto', () => { sweep(); });
}

export default { DAYS, enabled, stampUndated, daysLeft, sweep, init };
