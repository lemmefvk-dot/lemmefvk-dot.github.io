/* ============================================================
   desktops.js — the list of desktops (virtual workspaces).

   This module is only the model: which desktops exist, what they
   are called, which one is showing, the wallpaper a desktop may
   have of its own, and which desktop each open window was on when
   the page last went away. It knows nothing about windows beyond
   that last list — js/core/wm.js owns the windows and does the
   switching, sliding and moving; the shell draws the strip
   (overview.js), the HUD, the keys and the swipes (desktops.js).

   Saved in store 'desktops' (persisted):
     { list: [{ id, name|null, wallpaper|null }], current: id,
       windows: [{ app, desk, pin? }] }     (pin: kept on top)
   A desktop with no name of its own is shown as "Desktop N", so
   the numbers stay in order when one is removed.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';

const KEY = 'desktops';
export const MAX = 8;
const NAME_MAX = 32;

let seq = 0;
const newId = () => `d${Date.now().toString(36)}${(++seq).toString(36)}`;

function clean(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const list = (Array.isArray(v.list) ? v.list : [])
    .filter(d => d && typeof d.id === 'string' && d.id && !seen.has(d.id) && seen.add(d.id))
    .slice(0, MAX)
    .map(d => ({
      id: d.id,
      name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, NAME_MAX) : null,
      wallpaper: typeof d.wallpaper === 'string' && d.wallpaper ? d.wallpaper : null,
    }));
  if (!list.length) list.push({ id: 'd1', name: null, wallpaper: null });
  const current = list.some(d => d.id === v.current) ? v.current : list[0].id;
  const windows = (Array.isArray(v.windows) ? v.windows : [])
    .filter(x => x && typeof x.app === 'string' && list.some(d => d.id === x.desk))
    .slice(0, 40)
    .map(x => (x.pin === true ? { app: x.app, desk: x.desk, pin: true } : { app: x.app, desk: x.desk }));
  return { list, current, windows };
}

let S = clean(store.get(KEY));

function save(change) {
  store.set(KEY, { list: S.list.map(d => ({ ...d })), current: S.current, windows: S.windows.map(x => ({ ...x })) });
  if (change) bus.emit('desktops:change', { kind: change, list: list(), current: S.current });
}

/* a backup restored or store.reset() replaces the whole state under us */
store.sub(KEY, v => {
  const next = clean(v);
  if (JSON.stringify(next) !== JSON.stringify(S)) { S = next; bus.emit('desktops:change', { kind: 'load', list: list(), current: S.current }); }
});

/* ---------- reading ---------------------------------------------------- */
export const list = () => S.list.map((d, i) => ({ ...d, index: i, label: d.name || `Desktop ${i + 1}` }));
export const count = () => S.list.length;
export const current = () => S.current;
export const has = id => S.list.some(d => d.id === id);
export const indexOf = id => S.list.findIndex(d => d.id === id);
export const get = id => list().find(d => d.id === id) || null;
export const label = id => get(id)?.label || 'Desktop';
/** The desktop next to `id` in direction dir (-1 / +1), or null at the ends. */
export function neighbour(id, dir) {
  const i = indexOf(id);
  const j = i + (dir < 0 ? -1 : 1);
  return i < 0 || j < 0 || j >= S.list.length ? null : S.list[j].id;
}
/** The wallpaper id a desktop asked for, or null to use the shared one. */
export const wallpaperOf = (id = S.current) => S.list.find(d => d.id === id)?.wallpaper || null;
/** Where each window was when the page last went away: [{ app, desk }]. */
export const savedWindows = () => S.windows.map(x => ({ ...x }));

/* ---------- changing ---------------------------------------------------- */
/** Add a desktop at the end (or after `after`); returns it, or null at MAX. */
export function add({ name = null, after = null } = {}) {
  if (S.list.length >= MAX) return null;
  const d = { id: newId(), name: typeof name === 'string' && name.trim() ? name.trim().slice(0, NAME_MAX) : null, wallpaper: null };
  const at = after && has(after) ? indexOf(after) + 1 : S.list.length;
  S.list.splice(at, 0, d);
  save('add');
  return get(d.id);
}

export function rename(id, name) {
  const d = S.list.find(x => x.id === id);
  if (!d) return null;
  const n = String(name ?? '').trim().slice(0, NAME_MAX);
  /* clearing the name, or typing the automatic one, goes back to numbering */
  d.name = n && n !== `Desktop ${indexOf(id) + 1}` ? n : null;
  save('rename');
  return get(id);
}

export function setWallpaper(id, wallpaperId) {
  const d = S.list.find(x => x.id === id);
  if (!d) return null;
  d.wallpaper = wallpaperId ? String(wallpaperId) : null;
  save('wallpaper');
  bus.emit('wallpaper:changed');
  return get(id);
}

/** Move a desktop to a new position in the list. */
export function reorder(id, toIndex) {
  const i = indexOf(id);
  if (i < 0) return;
  const [d] = S.list.splice(i, 1);
  S.list.splice(Math.max(0, Math.min(S.list.length, toIndex)), 0, d);
  save('reorder');
}

/* The two below are for wm.js only: switching and removing have to move
   windows first, so the shell goes through wm.switchDesktop/removeDesktop. */
export function _setCurrent(id) {
  if (!has(id) || S.current === id) return false;
  S.current = id;
  save(null);
  return true;
}
export function _remove(id) {
  if (S.list.length <= 1 || !has(id)) return false;
  const i = indexOf(id);
  S.list.splice(i, 1);
  if (S.current === id) S.current = S.list[Math.max(0, i - 1)].id;
  S.windows = S.windows.filter(x => x.desk !== id);
  save('remove');
  return true;
}
/** wm.js records where windows are, so a restored session puts them back. */
export function _rememberWindows(rows) {
  const next = rows.filter(x => has(x.desk)).slice(0, 40);
  if (JSON.stringify(next) === JSON.stringify(S.windows)) return;
  S.windows = next;
  save(null);
}

export default {
  MAX, list, count, current, has, indexOf, get, label, neighbour, wallpaperOf, savedWindows,
  add, rename, setWallpaper, reorder,
};
