/* ============================================================
   fileimport.js — bring files in from the real computer.

   One set of rules for every way in: Files' Import button, a drop
   on a Files window, and a drop on the desktop wallpaper.

   Where the bytes go:
   · Plain text up to 200 KB goes into the vfs as text (localStorage),
     so Notes and Code can edit it. That store is a few MB for the
     whole OS, so vfs.js stops saving past 2.5M characters; the room
     left is checked before each file.
   · Everything else — pictures, videos, music, PDFs, archives, any
     other file — is kept as a real Blob in IndexedDB (media.save), and
     the vfs holds a small reference to it. Text too big to edit (or
     with no text room left) is kept that way as well, read-only, and
     the report says why.
   · The browser's own quota is the limit for blobs. Before each one
     navigator.storage.estimate() is asked how much is left; a file
     bigger than that is turned away by name, with both sizes.
   · If IndexedDB refuses (a private window, storage blocked) db.js
     keeps the bytes in memory for the session; that is reported per
     file — "kept until this tab closes" — never passed off as saved.

   Names are the file's own (a clash gets " 2", " 3"…), sizes are the
   real byte counts (file.size), and the MIME type is kept with the
   blob. Folders can't be imported; they are named in the report.

     importBlock(dir)                       -> reason string | null
     importFiles(dir, files, { folders, onProgress }) -> results[]
       result: { ok, name, as, path, size, kind, note?, why? }
   ============================================================ */
import vfs from './vfs.js';
import { bus } from './bus.js';
import media from './media.js';
import * as db from './db.js';
import { key, local } from './profiles.js';

/* plain text that becomes an editable vfs file */
export const TEXT_EXT = new Set(['txt', 'md', 'json', 'js', 'css', 'html', 'csv',
  'log', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'sh', 'py', 'ts', 'tsv']);
export const TEXT_MAX = 200 * 1024;
const VFS_KEY = key('staticos.vfs.v1');
const VFS_ROOM = 2_400_000;

/* a dropped file with no extension still gets a sensible one when its type says what it is */
const MIME_EXT = {
  'application/pdf': 'pdf', 'application/zip': 'zip', 'application/json': 'json',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'text/html': 'html',
};

export const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

const HOME = vfs.HOME;
const TRASH = `${HOME}/Trash`;
const inHome = p => p === HOME || p.startsWith(`${HOME}/`);
const isTrash = p => p === TRASH || p.startsWith(`${TRASH}/`);
export const folderLabel = p => (p === HOME ? 'Home' : p === '/' ? 'Static Drive' : vfs.baseName(p));

/** Why files can't be imported into dir — or null when they can. */
export function importBlock(dir) {
  const n = vfs.node(dir);
  if (!n || n.type !== 'dir') return 'This folder no longer exists.';
  if (isTrash(dir)) return 'Files can’t be imported into the Trash.';
  if (!inHome(dir)) return 'Only folders inside Home are kept after a reload — open a folder in Home to import.';
  return null;
}

/** name, or "name 2", "name 3"… — whichever is free in dir. */
function uniqueIn(dir, name) {
  const at = x => `${dir === '/' ? '' : dir}/${x}`;
  if (!vfs.node(at(name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (vfs.node(at(`${stem} ${i}${ext}`))) i++;
  return `${stem} ${i}${ext}`;
}

const vfsChars = () => { try { return (local.getItem(VFS_KEY) || '').length; } catch (e) { return 0; } };

/** Bytes the browser says StaticOS may still store, or null when it won't say. */
export async function freeBytes() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return quota ? Math.max(0, quota - usage) : null;
  } catch (e) { return null; }
}

/** What a kept file is, in a word or two, for the report. */
function kindLabel(name, mime) {
  const mk = media.kindOf(mime) || media.kindOf(name);
  if (mk) return mk;
  const e = extOf(name);
  if (e === 'pdf' || mime === 'application/pdf') return 'PDF';
  if (TEXT_EXT.has(e)) return 'text';
  return e ? `${e.toUpperCase()} file` : 'file';
}

function stampDate(node, file) {
  if (node && file.lastModified > 0) node.mtime = new Date(file.lastModified).toISOString();
}

/** The name a file is kept under: its own, made safe, with an extension when its type gives one. */
function nameFor(file) {
  let name = String(file.name || '').replace(/[\\/]+/g, ' ').trim() || 'file';
  if (!extOf(name)) {
    const type = String(file.type || '').split(';')[0];
    const mk = media.kindOf(type);
    const sub = type.split('/')[1]?.split(/[;+]/)[0];
    const ext = MIME_EXT[type] || (mk ? (media.extFor(type) || sub || mk) : '');
    if (ext) name = `${name}.${ext}`;
  }
  return name;
}

async function keepBlob(dir, file, name, room, note) {
  const free = room.free === undefined ? (room.free = await freeBytes()) : room.free;
  if (free !== null && file.size > free) {
    return { ok: false, name: file.name || name,
      why: `It is ${fmtSize(file.size)}, but this browser only has about ${fmtSize(free)} left for StaticOS. Free some space (empty the Trash, delete big videos) and try again.` };
  }
  let r;
  try { r = await media.save(dir, name, file); }
  catch (err) {
    const full = err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message));
    return { ok: false, name: file.name || name, why: full ? 'This browser is out of storage space for StaticOS.' : `It couldn’t be saved (${err?.message || err}).` };
  }
  if (!r) return { ok: false, name: file.name || name, why: 'The browser didn’t hand over its bytes.' };
  stampDate(r.node, file);
  if (room.free !== null) room.free = Math.max(0, room.free - file.size);
  /* db.js falls back to memory when IndexedDB refuses a write */
  const sessionOnly = !db.persistent;
  return {
    ok: true, name: file.name || name, as: vfs.baseName(r.path), path: r.path, size: file.size,
    kind: kindLabel(name, file.type),
    note: sessionOnly ? 'kept only until this tab closes — this browser isn’t letting StaticOS store files' : note || '',
    session: sessionOnly,
  };
}

async function importOne(dir, file, room) {
  const name = nameFor(file);
  const ext = extOf(name);
  const isText = TEXT_EXT.has(ext) && !media.kindOf(name);
  if (!isText) return keepBlob(dir, file, name, room);

  /* plain text: editable in the vfs when it fits, otherwise kept read-only */
  if (file.size > TEXT_MAX) {
    return keepBlob(dir, file, name, room, `read-only — text over ${fmtSize(TEXT_MAX)} is too big to edit here`);
  }
  let text;
  try { text = await file.text(); } catch (err) { return { ok: false, name: file.name || name, why: `The browser couldn’t read it (${err?.message || err}).` }; }
  if (text.includes('\u0000')) return keepBlob(dir, file, name, room, 'kept as a file — it contains binary data, so it can’t be edited as text');
  if (text.length > room.text) return keepBlob(dir, file, name, room, 'read-only — there’s no room left for more editable text in this browser');
  const finalName = uniqueIn(dir, name);
  const node = vfs.touch(`${dir === '/' ? '' : dir}/${finalName}`, text);
  if (!node) return { ok: false, name: file.name || name, why: `${folderLabel(dir)} can’t be written to.` };
  node.size = file.size;                 /* the real byte count, not the character count */
  stampDate(node, file);
  delete node.seed;
  room.text -= text.length;
  return { ok: true, name: file.name || name, as: finalName, path: `${dir === '/' ? '' : dir}/${finalName}`, size: file.size, kind: 'text' };
}

/**
 * Import files (and name refused folders) into dir, one at a time.
 * onProgress({ index, total, current }) is called before each file.
 */
export async function importFiles(dir, list, { folders = [], onProgress } = {}) {
  const files = Array.from(list || []);
  const results = folders.map(name => ({ ok: false, name, why: 'Folders can’t be imported. Open it on your computer and drop the files inside.' }));
  const why = importBlock(dir);
  if (why) {
    for (const f of files) results.push({ ok: false, name: f.name, why });
    return results;
  }
  const room = { text: VFS_ROOM - vfsChars(), free: undefined };
  for (let i = 0; i < files.length; i++) {
    try { onProgress?.({ index: i + 1, total: files.length, current: files[i].name, results }); } catch (e) { /* a view that went away */ }
    const r = await importOne(dir, files[i], room);
    /* media.save announces the files it stores; text goes straight into the
       file system, so say it here (achievements count a first save) */
    if (r.ok && r.kind === 'text') bus.emit('file:saved', { path: r.path, app: 'files' });
    results.push(r);
  }
  return results;
}

/** One line for a toast: "Saved 3 files to Desktop" / "2 of 3 saved…". */
export function summary(results, label) {
  const ok = results.filter(r => r.ok).length;
  const no = results.length - ok;
  if (!ok) return 'Nothing was imported';
  if (no) return `Imported ${ok} of ${results.length} into ${label}`;
  return `Imported ${plural(ok, 'file')} into ${label}`;
}

/** Split a drop into files and the names of folders (which can't be imported). */
export function fromDrop(dt) {
  const folders = [];
  for (const it of [...(dt?.items || [])]) {
    if (it.kind !== 'file') continue;
    let entry = null;
    try { entry = it.webkitGetAsEntry?.() || null; } catch (e) { entry = null; }
    if (entry?.isDirectory) folders.push(entry.name);
  }
  const files = [...(dt?.files || [])].filter(f => !folders.includes(f.name));
  return { files, folders };
}

export default { importFiles, importBlock, fromDrop, summary, freeBytes, folderLabel, fmtSize, TEXT_EXT, TEXT_MAX };
