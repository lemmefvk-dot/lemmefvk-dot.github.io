/* ============================================================
   snapshots.js — daily copies of your files and notes you can go
   back to, a little like Time Machine.

   Once a day (the first time StaticOS is open that day) the files
   tree and the notes are copied into this person's own database
   (core/db.js, store 'misc', under snapshot:<day>), so they live
   inside the profile's own storage and go when the profile does.
   A copy identical to the last one is not kept. At most MAX_KEEP
   copies are held, and the oldest go first when they together pass
   MAX_BYTES; the newest is always kept. Settings › Storage shows how
   many there are and the space they use, measured from the copies.

   What a snapshot holds: the files tree as StaticOS saves it (names,
   folders and the text of files kept in the tree) and the notes.
   Pictures, videos and music kept as bytes in the database, projects
   and settings are not in it (a backup has those: core/backup.js).
   A snapshot is not part of a backup, and a restore from a backup
   leaves the snapshots alone.

     enabled()            prefs.snapshots, on unless switched off
     init()               take today's copy when due, and again after midnight
     takeNow(label?)      → the snapshot taken, or null if nothing changed
     list()               → [{ id, day, at, label, files, notes, bytes }] newest first
     usage()              → { count, bytes }
     browse(id)           → [{ path, bytes, kept }] the files inside a copy
     restoreAll(id)       put the files and notes back (reloads StaticOS)
     restoreFile(id, p)   copy one file back, beside your own, without replacing anything
     remove(id) · clear()
   ============================================================ */
import { store } from './store.js';
import { kv, persistent } from './db.js';
import * as profiles from './profiles.js';
import vfs, { holdFiles, HOME } from './vfs.js';
import { bus } from './bus.js';

export const MAX_KEEP = 10;
export const MAX_BYTES = 12 * 1024 * 1024;
const PREFIX = 'snapshot:';
const MEDIA = 'staticos-media:';        /* a file whose bytes live in the database: not in a snapshot */

export const enabled = () => store.get('prefs.snapshots', true) !== false;
const db = () => kv('misc');
const vfsKey = () => profiles.key(profiles.BASES[1]);
const pad = n => String(n).padStart(2, '0');
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sizeOf = s => { try { return new Blob([s]).size; } catch (e) { return String(s).length; } };
const fnv = text => {
  let x = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x.toString(16);
};
const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
const keepable = () => !!profiles.idbName() && persistent !== false;

function countFiles(node) {
  if (!node || typeof node !== 'object') return 0;
  if (node.t === 'f') return 1;
  return Array.isArray(node.c) ? node.c.reduce((n, k) => n + countFiles(k), 0) : 0;
}

const meta = (id, s) => ({
  id, day: s.day, at: s.at, label: s.label || '', files: s.files, notes: s.notes, bytes: s.bytes,
});

/** Every copy, newest first. */
export async function list() {
  const keys = (await db().keys()).filter(k => typeof k === 'string' && k.startsWith(PREFIX));
  const out = [];
  for (const k of keys) {
    const s = await db().get(k);
    if (s && typeof s.vfs === 'string') out.push(meta(k, s));
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** How many copies there are and the bytes they use, summed from the copies themselves. */
export async function usage() {
  const all = await list();
  return { count: all.length, bytes: all.reduce((n, s) => n + s.bytes, 0) };
}

/* keep within MAX_KEEP copies and MAX_BYTES, oldest first; the newest always stays */
async function trim() {
  const all = await list();
  let total = all.reduce((n, s) => n + s.bytes, 0);
  for (let i = all.length - 1; i > 0; i--) {
    if (i < MAX_KEEP && total <= MAX_BYTES) break;
    await db().del(all[i].id);
    total -= all[i].bytes;
  }
}

/** Copy the files and notes now. `label` names a copy made for a reason ("Before restoring…"); an
    automatic one has none. Resolves null when nothing has changed since the last copy. */
export async function takeNow(label = '') {
  if (!keepable()) return null;
  const tree = profiles.local.getItem(vfsKey()) || '';
  const notes = store.get('notes', null);
  const folders = store.get('noteFolders', null);
  const noteText = JSON.stringify([notes, folders]);
  const sig = fnv(tree + '\u0000' + noteText);
  const all = await list();
  if (!label && all[0] && (await db().get(all[0].id))?.sig === sig) return null;
  const now = new Date();
  const day = dayOf(now);
  const id = !label && !all.some(s => s.id === PREFIX + day) ? PREFIX + day : `${PREFIX}${day}@${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${String(now.getMilliseconds()).padStart(3, '0')}`;
  const stored = {
    v: 1, day, at: now.toISOString(), label, sig, vfs: tree,
    notesList: Array.isArray(notes) ? notes : null, noteFolders: Array.isArray(folders) ? folders : null,
    files: countFiles(parse(tree)), notes: Array.isArray(notes) ? notes.length : 0,
    bytes: sizeOf(tree) + sizeOf(noteText),
  };
  await db().set(id, stored);
  await trim();
  bus.emit('snapshots:change');
  return meta(id, stored);
}

async function load(id) {
  const s = typeof id === 'string' && id.startsWith(PREFIX) ? await db().get(id) : null;
  return s && typeof s.vfs === 'string' ? s : null;
}

/** The files inside a copy: [{ path (below your home folder), bytes, kept }]. `kept` is false for
    files whose bytes are kept in the database, which a snapshot doesn't hold. */
export async function browse(id) {
  const s = await load(id);
  const root = s && parse(s.vfs);
  const out = [];
  const walk = (n, trail) => {
    if (!n || typeof n !== 'object') return;
    if (n.t === 'f') {
      const text = typeof n.x === 'string' ? n.x : '';
      out.push({ path: trail.join('/'), bytes: Number.isFinite(n.z) ? n.z : sizeOf(text), kept: !text.startsWith(MEDIA) });
    } else if (n.t === 'd' && Array.isArray(n.c)) for (const k of n.c) walk(k, [...trail, k.n]);
  };
  if (root && root.t === 'd' && Array.isArray(root.c)) for (const k of root.c) walk(k, [k.n]);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Put one file back as a copy beside your own, in “Restored from <day>” in your home folder.
    Nothing you have now is replaced. Returns the path it was written to. */
export async function restoreFile(id, rel) {
  const s = await load(id);
  const root = s && parse(s.vfs);
  if (!root) throw new Error('That copy is not there any more.');
  let n = root;
  for (const name of String(rel).split('/')) {
    n = n && n.t === 'd' && Array.isArray(n.c) ? n.c.find(k => k.n === name) : null;
  }
  if (!n || n.t !== 'f') throw new Error('That file is not in this copy. It may be one StaticOS ships.');
  const text = typeof n.x === 'string' ? n.x : '';
  if (text.startsWith(MEDIA)) throw new Error('This file’s bytes are kept in the database, which a snapshot doesn’t hold. Restore it from a backup.');
  const dir = `${HOME}/Restored from ${s.day}`;
  vfs.mkdir(dir);
  const parts = String(rel).split('/');
  let at = dir;
  for (const part of parts.slice(0, -1)) { at += '/' + part; vfs.mkdir(at); }
  let dest = `${at}/${parts[parts.length - 1]}`;
  for (let i = 2; vfs.node(dest); i++) dest = `${at}/${i} ${parts[parts.length - 1]}`;
  vfs.write(dest, text);
  return dest;
}

/** Put the files and notes back as they were in this copy, and reload. A copy of what is there
    now is taken first, so this can itself be undone from the list. */
export async function restoreAll(id) {
  const s = await load(id);
  if (!s) throw new Error('That copy is not there any more.');
  await takeNow(`Before restoring ${s.day}`);
  if (Array.isArray(s.notesList)) store.set('notes', s.notesList);
  if (Array.isArray(s.noteFolders)) store.set('noteFolders', s.noteFolders);
  /* let the store write the notes out before it is told to stop */
  await new Promise(r => setTimeout(r, 400));
  store.hold(true);
  holdFiles(true);
  if (s.vfs) profiles.local.setItem(vfsKey(), s.vfs); else profiles.local.removeItem(vfsKey());
  profiles.freeze();
  setTimeout(() => location.reload(), 300);
  return true;
}

export async function remove(id) { await db().del(id); bus.emit('snapshots:change'); }
export async function clear() {
  for (const s of await list()) await db().del(s.id);
  bus.emit('snapshots:change');
}

let started = false;
/** Take today's copy when it is due, and look again once an hour (a tab left open past midnight). */
export function init() {
  if (started) return;
  started = true;
  const due = async () => {
    if (!enabled() || !keepable()) return;
    const today = PREFIX + dayOf(new Date());
    if ((await db().keys()).includes(today)) return;
    await takeNow();
  };
  const first = () => { due().catch(() => {}); setInterval(() => due().catch(() => {}), 3600000); };
  /* off the start-up path: after the desktop has settled */
  setTimeout(first, 6000);
  if (typeof window !== 'undefined') window.Static && (window.Static.snapshots = { takeNow, list, usage, browse, restoreFile, restoreAll, remove, clear, due });
}

export default { enabled, init, takeNow, list, usage, browse, restoreAll, restoreFile, remove, clear, MAX_KEEP, MAX_BYTES };
