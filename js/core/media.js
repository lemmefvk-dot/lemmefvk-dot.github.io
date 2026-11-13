/* ============================================================
   media.js — real pictures, videos and music in the file system.

   The vfs keeps text in localStorage (a few MB for the whole OS),
   so a photo can't live there. A media file in the vfs is a tiny
   reference, and the bytes live somewhere real:

     staticos-media:<id>      a Blob in IndexedDB (db.js kv('media')) —
                              what Camera, screenshots and "Import"
                              save. The file's size is the blob's.
     staticos-asset:<url>     a file shipped with the site (assets/…),
                              used for the pictures and clips StaticOS
                              comes with.

   Anything that opens a picture, video or song asks this module for
   a URL it can put in <img>/<video>/<audio>; nothing else needs to
   know where the bytes are.

     save(dir, name, blob)          -> { path, id, node }
     replace(path, blob, { name })  -> { path, id, node }   (new bytes, same file)
     importFiles(dir, files)        -> [{ path, ... }]   (from <input type=file> / drop)
     urlOf(pathOrNode)              -> Promise<string|null>
     blobOf(pathOrNode)             -> Promise<Blob|null>
     isMedia(node), kindOf(nameOrMime) -> 'image'|'video'|'audio'|null
     gc()                           -> removes blobs no file points at
   Emits bus 'media:change' { path } after a save.
   ============================================================ */
import { kv } from './db.js';
import { vfs } from './vfs.js';
import { bus } from './bus.js';

export const MEDIA = 'staticos-media:';
export const ASSET = 'staticos-asset:';

const db = kv('media');
const urls = new Map();          /* id -> object URL, kept while the page lives */
const URL_CAP = 80;              /* oldest object URLs are revoked past this */

const EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
};
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'video/webm': 'webm', 'video/mp4': 'mp4', 'audio/webm': 'weba', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
};

/** 'image' | 'video' | 'audio' | null, from a file name or a MIME type. */
export function kindOf(v) {
  const s = String(v || '').toLowerCase();
  if (s.includes('/')) {
    const top = s.split('/')[0];
    return top === 'image' || top === 'video' || top === 'audio' ? top : null;
  }
  const ext = s.includes('.') ? s.split('.').pop() : s;
  for (const [k, list] of Object.entries(EXT)) if (list.includes(ext)) return k;
  return null;
}

export const extFor = mime => MIME_EXT[String(mime || '').split(';')[0]] || null;

const nodeOf = p => (p && typeof p === 'object' ? p : vfs.node(p));

/** Does this vfs file have real bytes behind it? */
export function isMedia(p) {
  const n = nodeOf(p);
  const c = n && typeof n.content === 'string' ? n.content : '';
  return c.startsWith(MEDIA) || c.startsWith(ASSET);
}

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

function uniqueName(dir, name) {
  if (!vfs.node(`${dir}/${name}`)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (vfs.node(`${dir}/${stem} ${i}${ext}`)) i++;
  return `${stem} ${i}${ext}`;
}

function mkdirs(dir) {
  const parts = vfs.norm(dir).split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += `/${part}`;
    if (!vfs.node(cur)) vfs.mkdir(cur);
  }
  return !!vfs.node(dir);
}

/** Keep a Blob as a real file at dir/name. The name gets " 2", " 3"… if taken. */
export async function save(dir, name, blob) {
  if (!(blob instanceof Blob)) throw new Error('Nothing to save.');
  if (!mkdirs(dir)) throw new Error(`${dir} can't be created.`);
  const id = newId();
  await db.set(id, { blob, mime: blob.type || '', name, at: Date.now() });
  const finalName = uniqueName(dir, String(name || 'file').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'file');
  const path = `${vfs.norm(dir)}/${finalName}`;
  const node = vfs.touch(path, `${MEDIA}${id}`);
  if (!node) { await db.del(id); throw new Error(`${path} can't be written.`); }
  node.size = blob.size;
  node.mtime = new Date().toISOString();
  bus.emit('fs:change', vfs.parentPath(path), path);     /* persist the real size */
  bus.emit('media:change', { path });
  bus.emit('file:saved', { path });
  return { path, id, node };
}

/** Put new bytes behind an existing file (Markup's "Replace original").
    The file keeps its place; its size and date are the new blob's. With
    { name } it is renamed too (a .jpg replaced by a PNG becomes .png). The
    old blob stays until gc() finds nothing pointing at it. */
export async function replace(p, blob, { name } = {}) {
  if (!(blob instanceof Blob)) throw new Error('Nothing to save.');
  const path = vfs.norm(p);
  const node = vfs.node(path);
  if (!node || node.type !== 'file') throw new Error('That file is no longer there.');
  const id = newId();
  await db.set(id, { blob, mime: blob.type || '', name: name || node.name, at: Date.now() });
  const dir = vfs.parentPath(path);
  let final = path;
  if (name && name !== node.name) {
    const next = uniqueName(dir, String(name).replace(/[\\/:*?"<>|]+/g, ' ').trim() || node.name);
    if (vfs.rename(path, next)) final = `${dir === '/' ? '' : dir}/${next}`;
  }
  node.content = `${MEDIA}${id}`;
  node.size = blob.size;
  node.mtime = new Date().toISOString();
  delete node.seed;
  bus.emit('fs:change', dir, final);
  bus.emit('media:change', { path: final });
  bus.emit('file:saved', { path: final });
  return { path: final, id, node };
}

/** Save files a person picked or dropped. Skips anything that isn't a picture, video or song. */
export async function importFiles(dir, files) {
  const out = [];
  for (const file of Array.from(files || [])) {
    if (!kindOf(file.type) && !kindOf(file.name)) continue;
    out.push(await save(dir, file.name, file));
  }
  return out;
}

function refOf(p) {
  const n = nodeOf(p);
  const c = n && typeof n.content === 'string' ? n.content : '';
  if (c.startsWith(MEDIA)) return { type: 'media', id: c.slice(MEDIA.length) };
  if (c.startsWith(ASSET)) return { type: 'asset', url: c.slice(ASSET.length) };
  return null;
}

/** The bytes behind a media file, or null. */
export async function blobOf(p) {
  const r = refOf(p);
  if (!r) return null;
  if (r.type === 'asset') {
    const res = await fetch(r.url);
    return res.ok ? res.blob() : null;
  }
  const rec = await db.get(r.id);
  return rec?.blob || null;
}

/** A URL for <img>/<video>/<audio>, or null when the file has no bytes. */
export async function urlOf(p) {
  const r = refOf(p);
  if (!r) return null;
  if (r.type === 'asset') return r.url;
  if (urls.has(r.id)) return urls.get(r.id);
  const rec = await db.get(r.id);
  if (!rec?.blob) return null;
  const u = URL.createObjectURL(rec.blob);
  urls.set(r.id, u);
  while (urls.size > URL_CAP) {
    const [oldId, oldUrl] = urls.entries().next().value;
    urls.delete(oldId);
    try { URL.revokeObjectURL(oldUrl); } catch (e) {}
  }
  return u;
}

/** The MIME type of a media file, as best we know it. */
export async function mimeOf(p) {
  const r = refOf(p);
  if (!r) return null;
  if (r.type === 'media') return (await db.get(r.id))?.mime || null;
  const k = kindOf(r.url);
  const ext = r.url.split('.').pop().toLowerCase();
  return k ? `${k}/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}` : null;
}

/** Drop stored blobs that no file in the vfs points at any more (deleted
    for good, or the Trash emptied). Safe to run any time. */
export async function gc() {
  const live = new Set();
  vfs.walk('/', n => {
    if (n.type === 'file' && typeof n.content === 'string' && n.content.startsWith(MEDIA)) live.add(n.content.slice(MEDIA.length));
  });
  let removed = 0;
  for (const id of await db.keys()) {
    if (live.has(id)) continue;
    await db.del(id);
    const u = urls.get(id);
    if (u) { urls.delete(id); try { URL.revokeObjectURL(u); } catch (e) {} }
    removed++;
  }
  return removed;
}

export default { save, replace, importFiles, urlOf, blobOf, mimeOf, isMedia, kindOf, extFor, gc, MEDIA, ASSET };
