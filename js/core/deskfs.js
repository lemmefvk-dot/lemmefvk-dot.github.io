/* ============================================================
   deskfs.js — what the desktop's icon menu does to files that is
   not the Files app's business: copy and paste, Get Info, and the
   "Open With" list with the apps you used last at the top.
   Plain functions over the vfs, so a window is not needed.
   ============================================================ */
import { vfs } from './vfs.js';
import { store } from './store.js';
import { listApps, getApp, appForFile } from './registry.js';
import media from './media.js';
import { fmtBytes } from './util.js';

const byteLen = s => new TextEncoder().encode(s || '').length;

/** A name that is free in dir: "a.txt", then "a 2.txt", "a 3.txt"… */
export function uniqueIn(dir, name) {
  const at = x => `${dir === '/' ? '' : dir}/${x}`;
  if (!vfs.node(at(name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (vfs.node(at(`${stem} ${i}${ext}`))) i++;
  return `${stem} ${i}${ext}`;
}

/* A copy points at the same bytes (media blobs never change, and media.gc
   keeps a blob while any file still points at it) — the same rule Files uses. */
function clone(n, dest) {
  if (n.type === 'dir') {
    const d = vfs.mkdir(dest);
    if (!d) return null;
    for (const c of [...n.children]) clone(c, `${dest}/${c.name}`);
    return d;
  }
  const f = vfs.touch(dest, typeof n.content === 'string' ? n.content : '');
  if (!f) return null;
  f.size = media.isMedia(n) ? (n.size || 0) : byteLen(f.content);
  return f;
}

/** Copy a file or folder into a folder; returns the new name, or null. */
export function copyInto(from, dir) {
  const n = vfs.node(from);
  const to = vfs.node(dir);
  if (!n || !to || to.type !== 'dir') return null;
  const src = vfs.norm(from), dst = vfs.norm(dir);
  if (n.type === 'dir' && (dst === src || dst.startsWith(src + '/'))) return null;   /* a folder can't go inside itself */
  const name = uniqueIn(dst, n.name);
  return clone(n, `${dst === '/' ? '' : dst}/${name}`) ? name : null;
}

/* The little clipboard Copy / Paste Here share: paths, in this tab. */
let held = [];
export const copied = () => held.filter(p => vfs.node(p));
export const holdCopy = paths => { held = paths.slice(); };

/** What Get Info shows: real numbers only. A folder's size is what it holds. */
export function info(path) {
  const n = vfs.node(path);
  if (!n) return null;
  const dot = n.name.lastIndexOf('.');
  const ext = dot > 0 ? n.name.slice(dot + 1).toUpperCase() : '';
  const bytes = vfs.size(n);
  return {
    name: n.name,
    path: vfs.norm(path),
    kind: n.type === 'dir' ? 'Folder' : n.kind === 'game' ? 'Game shortcut' : ext ? `${ext} file` : 'File',
    bytes,
    size: n.type === 'dir' ? `${fmtBytes(bytes)}, ${n.children.length} item${n.children.length === 1 ? '' : 's'}` : fmtBytes(bytes),
    modified: n.mtime ? new Date(n.mtime) : null,
  };
}

/* ---- Open With ------------------------------------------------------ */
const RECENT_KEY = 'session.openWith';
const recents = () => (Array.isArray(store.get(RECENT_KEY)) ? store.get(RECENT_KEY) : []).filter(id => getApp(id));
export const recentApps = () => recents();
export function usedApp(id) {
  store.set(RECENT_KEY, [id, ...recents().filter(x => x !== id)].slice(0, 5));
}

/** Apps that can open this file: the ones you picked last first, then the
    app that opens it by default, then the rest by name. */
export function openWithApps(path) {
  const n = vfs.node(path);
  if (!n || n.type !== 'file') return [];
  const def = appForFile(n);
  const can = listApps().filter(a => !a.hidden && ((a.handles || []).includes(n.kind) || a.id === 'notes' || a.id === 'code' || a === def));
  const rank = a => {
    const r = recents().indexOf(a.id);
    return r >= 0 ? [0, r] : a === def ? [1, 0] : [2, 0];
  };
  return can.sort((a, b) => {
    const x = rank(a), y = rank(b);
    return x[0] - y[0] || x[1] - y[1] || a.name.localeCompare(b.name);
  });
}
/** The apps shown above the line in Open With (the recent ones that can open it). */
export function openWithRecent(path) {
  const ids = new Set(recents());
  return openWithApps(path).filter(a => ids.has(a.id)).slice(0, 3);
}
