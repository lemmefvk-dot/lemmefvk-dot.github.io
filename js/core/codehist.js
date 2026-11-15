/* ============================================================
   codehist.js — earlier versions of a project in Static Code.

   A version is a snapshot of a project's text files (the folder in
   ~/Projects the file belongs to): every file's path and text. They
   are taken
   · when a file of the project is saved — but a save less than a
     minute after the last saved version replaces that one, so a run
     of ⌘S presses keeps one version, not twenty (the first save of a
     project with no history also keeps how it was before, reason
     'first');
   · when you press "Save a version" (with a name, if you give one);
   · right before a restore, so a restore can itself be undone.
   A version identical to the newest one is not stored again.

   Where they live: this person's IndexedDB (db.js store 'misc',
   through core/profiles.js, so each person keeps their own and a
   guest keeps nothing once the tab closes), one record per project:
   key 'codehist:<folder path>' = { key, versions: [oldest … newest],
   blobs: { id: text } }. A text that several versions share is kept
   once (blobs), so a version of a ten-file project where one file
   changed costs one file.

   Caps, so storage can't run away:
   · CAPS.perProject   40 versions per project (oldest dropped first;
                        named versions are dropped last);
   · CAPS.projectChars 2 million characters of distinct text per project;
   · CAPS.totalChars   6 million across every project (the oldest
                        version anywhere goes first).
   A folder renamed in Code takes its history with it (move()).

     record(dir, files, { reason, name, file })  files: [{ path, text }]
     list(dir)            -> versions, newest first: { id, t, reason, name, file, count, chars }
     files(dir, id)       -> [{ path, text }] of that version
     remove(dir, id), move(from, to), clear(dir)
   ============================================================ */
import { kv } from './db.js';

export const CAPS = { perProject: 40, projectChars: 2_000_000, totalChars: 6_000_000, mergeMs: 60_000 };
const PREFIX = 'codehist:';
const db = kv('misc');

/* one write at a time: every change is read-modify-write */
let chain = Promise.resolve();
const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

/* a short name for a text (cyrb53), plus its length */
function idOf(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${text.length.toString(36)}`;
}

async function load(dir) {
  const rec = await db.get(PREFIX + dir);
  if (rec && Array.isArray(rec.versions) && rec.blobs && typeof rec.blobs === 'object') return rec;
  return { key: dir, versions: [], blobs: {} };
}

const charsOf = rec => Object.values(rec.blobs).reduce((n, t) => n + t.length, 0);

/* drop texts no version uses any more */
function sweep(rec) {
  const used = new Set();
  for (const v of rec.versions) for (const id of Object.values(v.files)) used.add(id);
  for (const id of Object.keys(rec.blobs)) if (!used.has(id)) delete rec.blobs[id];
}

/* the version to let go of first: the oldest unnamed one, else the oldest */
function dropOne(rec) {
  if (rec.versions.length <= 1) return false;
  const keep = rec.versions.length - 1;          /* never the newest */
  let at = rec.versions.findIndex((v, i) => i < keep && !v.name);
  if (at < 0) at = 0;
  rec.versions.splice(at, 1);
  sweep(rec);
  return true;
}

function sameFiles(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => a[k] === b[k]);
}

/** Keep a version of the project in dir. Resolves with { saved, merged } . */
export function record(dir, files, { reason = 'save', name = '', file = '', now = Date.now() } = {}) {
  return serial(async () => {
    const rec = await load(dir);
    const map = {};
    for (const f of files) {
      const text = String(f.text ?? '');
      let id = idOf(text);
      /* two different texts with one name would be a collision: keep both */
      while (rec.blobs[id] !== undefined && rec.blobs[id] !== text) id += '~';
      rec.blobs[id] = text;
      map[f.path] = id;
    }
    const last = rec.versions[rec.versions.length - 1];
    const label = String(name || '').trim().slice(0, 60);
    if (last && sameFiles(last.files, map) && !label) { sweep(rec); return { saved: false, merged: false }; }
    let merged = false;
    if (last && reason === 'save' && last.reason === 'save' && !last.name && now - last.t < CAPS.mergeMs) {
      rec.versions.pop();
      merged = true;
    }
    rec.versions.push({ id: `v${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: now, reason, name: label, file: String(file || ''), files: map });
    sweep(rec);
    while (rec.versions.length > CAPS.perProject && dropOne(rec)) { /* keep dropping */ }
    while (charsOf(rec) > CAPS.projectChars && dropOne(rec)) { /* keep dropping */ }
    await db.set(PREFIX + dir, rec);
    await enforceTotal();
    return { saved: true, merged };
  });
}

/* every project together stays under totalChars: the oldest version anywhere goes */
async function enforceTotal() {
  const keys = (await db.keys()).filter(k => String(k).startsWith(PREFIX));
  if (keys.length < 2) return;
  const recs = [];
  for (const k of keys) { const r = await db.get(k); if (r && Array.isArray(r.versions) && r.blobs) recs.push([k, r]); }
  let total = recs.reduce((n, [, r]) => n + charsOf(r), 0);
  const dirty = new Set();
  while (total > CAPS.totalChars) {
    let at = null;
    for (const [k, r] of recs) if (r.versions.length > 1 && (!at || r.versions[0].t < at[1].versions[0].t)) at = [k, r];
    if (!at) break;
    const before = charsOf(at[1]);
    at[1].versions.shift();
    sweep(at[1]);
    total -= before - charsOf(at[1]);
    dirty.add(at[0]);
  }
  for (const [k, r] of recs) if (dirty.has(k)) await db.set(k, r);
}

const summary = (rec, v) => {
  const ids = Object.values(v.files);
  return { id: v.id, t: v.t, reason: v.reason, name: v.name || '', file: v.file || '', count: ids.length, chars: ids.reduce((n, id) => n + (rec.blobs[id] || '').length, 0), paths: Object.keys(v.files) };
};

/** The project's versions, newest first (without their texts). */
export async function list(dir) {
  await chain;
  const rec = await load(dir);
  return rec.versions.map(v => summary(rec, v)).reverse();
}

/** The files of one version, sorted by path. */
export async function files(dir, id) {
  await chain;
  const rec = await load(dir);
  const v = rec.versions.find(x => x.id === id);
  if (!v) return null;
  return Object.entries(v.files).map(([path, bid]) => ({ path, text: rec.blobs[bid] ?? '' })).sort((a, b) => a.path.localeCompare(b.path));
}

export function remove(dir, id) {
  return serial(async () => {
    const rec = await load(dir);
    const i = rec.versions.findIndex(v => v.id === id);
    if (i < 0) return false;
    rec.versions.splice(i, 1);
    sweep(rec);
    if (rec.versions.length) await db.set(PREFIX + dir, rec); else await db.del(PREFIX + dir);
    return true;
  });
}

/** A project folder was renamed or moved: its history goes with it. */
export function move(from, to) {
  return serial(async () => {
    const rec = await db.get(PREFIX + from);
    if (!rec) return false;
    rec.key = to;
    await db.set(PREFIX + to, rec);
    await db.del(PREFIX + from);
    return true;
  });
}

export function clear(dir) { return serial(() => db.del(PREFIX + dir)); }

export default { CAPS, record, list, files, remove, move, clear };
