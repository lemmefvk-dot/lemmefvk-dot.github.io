/* ============================================================
   notehistory.js — earlier versions of a note (Notes › History).

   A version is a snapshot of a note's title and body. They are taken:
   · on idle — IDLE_MS (30 s) after the last edit to a note, however it
     was edited (this module watches store 'notes', so the Notes window
     does not have to be open for the timer to run out);
   · when the Notes window closes or another note is picked (flush());
   · right before a restore (record(), called by the History panel).
   A text file edited in Notes (.txt, .md) uses the same mechanism, keyed
   by its path, so a renamed file starts a new history.

   Where they live: IndexedDB, db.js store 'misc', one record per note,
   key 'notehist:<note id>' = { key, versions: [oldest … newest] }. Notes
   itself is in localStorage (about 5 MB for the whole OS), so history
   stays out of it. Nothing is kept for a note that has not changed.

   Caps, so storage can't run away:
   · CAPS.perNote   50 versions per note — the oldest is dropped first;
   · CAPS.totalChars  3 million characters of text across all notes —
     the oldest version anywhere is dropped until it fits;
   · a version identical to one already kept is not stored again;
   · the history of a note that was deleted is removed 7 days later.
   ============================================================ */
import { kv } from './db.js';
import { store } from './store.js';
import { bus } from './bus.js';
import { vfs } from './vfs.js';
import * as NF from './notesfmt.js';

export const CAPS = { perNote: 50, totalChars: 3_000_000, idleMs: 30_000, graceDays: 7 };
const PREFIX = 'notehist:';
const db = kv('misc');

/* the words a version shows in the list */
const textOf = v => (v.fmt === NF.FMT ? NF.plainOf(v.body) : String(v.body || ''));
const summaryOf = v => {
  const text = textOf(v).replace(/\s+/g, ' ').trim();
  return { text: text.slice(0, 90), words: text ? text.split(' ').length : 0 };
};
const sizeOf = v => (v.title || '').length + (v.body || '').length;
const sameContent = (a, b) => (a.title || '') === (b.title || '') && (a.body || '') === (b.body || '');

/* ---- one write at a time: every change is read-modify-write ------- */
let chain = Promise.resolve();
const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

async function load(key) {
  const rec = await db.get(PREFIX + key);
  return rec && Array.isArray(rec.versions) ? rec : { key, versions: [] };
}

/** The saved versions of a note, newest first. */
export async function list(key) {
  await chain;
  return (await load(key)).versions.slice().reverse();
}

/** Drop the oldest versions anywhere until the total fits. Run after a record. */
async function enforceTotal() {
  const keys = (await db.keys()).filter(k => String(k).startsWith(PREFIX));
  const recs = [];
  let total = 0;
  for (const k of keys) {
    const r = await db.get(k);
    if (!r || !Array.isArray(r.versions)) continue;
    recs.push([k, r]);
    for (const v of r.versions) total += sizeOf(v);
  }
  const dirty = new Set();
  while (total > CAPS.totalChars) {
    let at = null;
    for (const [k, r] of recs) {
      if (r.versions.length && (!at || r.versions[0].t < at[1].versions[0].t)) at = [k, r];
    }
    if (!at) break;
    total -= sizeOf(at[1].versions.shift());
    dirty.add(at[0]);
  }
  for (const [k, r] of recs) {
    if (!dirty.has(k)) continue;
    if (r.versions.length) await db.set(k, r); else await db.del(k);
  }
}

/** Keep a version of a note. snap = { title, body, fmt }. Skipped when the
    same content is already kept. Resolves to true when one was stored. */
export function record(key, snap, why = 'Edited', t = Date.now()) {
  return serial(async () => {
    const rec = await load(key);
    const v = { t, title: String(snap.title || ''), body: String(snap.body || ''), fmt: snap.fmt || null, why };
    if (rec.versions.some(x => sameContent(x, v))) return false;
    rec.versions.push(v);
    rec.versions.sort((a, b) => a.t - b.t);
    while (rec.versions.length > CAPS.perNote) rec.versions.shift();
    await db.set(PREFIX + key, rec);
    await enforceTotal();
    bus.emit('notehistory:change', { key });
    return true;
  });
}

/** A version with its list text added: [{ …version, summary, words }]. */
export const describe = v => ({ ...v, ...(s => ({ summary: s.text, words: s.words }))(summaryOf(v)) });
export const plainText = textOf;

export async function drop(key) { await serial(() => db.del(PREFIX + key)); bus.emit('notehistory:change', { key }); }

/* ---- watching notes ------------------------------------------------ */
/* key -> { base, cur, timer }: base is the content at the last snapshot (or
   when we first saw the note), cur the latest content waiting for idle. */
const watch = new Map();
const snapOf = n => ({ title: n.title || '', body: n.body || '', fmt: n.fmt || null });

function arm(key, base) {
  const w = watch.get(key) || { base, cur: base, timer: 0 };
  watch.set(key, w);
  return w;
}

function schedule(key, cur) {
  const w = arm(key, cur);
  if (sameContent(w.cur, cur) && !w.timer) { w.cur = cur; return; }
  w.cur = cur;
  clearTimeout(w.timer);
  w.timer = setTimeout(() => commit(key), CAPS.idleMs);
}

async function commit(key) {
  const w = watch.get(key);
  if (!w) return false;
  clearTimeout(w.timer);
  w.timer = 0;
  if (sameContent(w.base, w.cur)) return false;
  /* the first change to a note also keeps what it said before, so the original can come back */
  const had = (await list(key)).length;
  if (!had && (w.base.title || w.base.body)) await record(key, w.base, 'Original', w.baseT || Date.now() - 1);
  const made = await record(key, w.cur, 'Edited');
  w.base = w.cur;
  w.baseT = Date.now();
  return made;
}

/** Snapshot every note that has unsnapshotted edits now (window closed, note switched, page leaving). */
export function flush() {
  return Promise.all([...watch.keys()].filter(k => watch.get(k).timer).map(commit));
}

/** Tell the history what a note says before anyone edits it (a text file opened in Notes). */
export function baseline(key, snap) {
  const w = watch.get(key);
  if (w) return;
  watch.set(key, { base: snap, cur: snap, timer: 0, baseT: Date.now() });
}

function onNotes(list) {
  if (!Array.isArray(list)) return;
  for (const n of list) {
    if (!n || !n.id) continue;
    const key = n.id;
    const w = watch.get(key);
    if (!w) { watch.set(key, { base: snapOf(n), cur: snapOf(n), timer: 0, baseT: Date.parse(n.mtime) || Date.now() }); continue; }
    const next = snapOf(n);
    /* Notes converting an old plain-text note to its format changes the body, not the words: not an edit */
    if (next.fmt !== w.cur.fmt && next.title === w.cur.title && textOf(next) === textOf(w.cur) && !w.timer) { w.base = w.cur = next; continue; }
    schedule(key, next);
  }
}

let started = false;
export function init() {
  if (started) return;
  started = true;
  onNotes(store.get('notes'));
  store.sub('notes', onNotes);
  bus.on('file:saved', ({ path, app } = {}) => {
    if (app !== 'notes' || !path) return;
    const n = vfs.node(path);
    if (!n || n.type !== 'file') return;
    schedule(`file:${vfs.norm(path)}`, { title: vfs.baseName(path), body: n.content || '', fmt: null });
  });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { flush(); });
  /* a deleted note's history goes a week after the note */
  setTimeout(prune, 5000);
}

async function prune() {
  try {
    const live = new Set((store.get('notes') || []).map(n => n && n.id));
    const cutoff = Date.now() - CAPS.graceDays * 86400000;
    for (const k of await db.keys()) {
      if (!String(k).startsWith(PREFIX)) continue;
      const key = String(k).slice(PREFIX.length);
      const gone = key.startsWith('file:') ? !vfs.node(key.slice(5)) : !live.has(key);
      if (!gone) continue;
      const rec = await db.get(k);
      const last = rec && rec.versions && rec.versions.length ? rec.versions[rec.versions.length - 1].t : 0;
      if (last < cutoff) await db.del(k);
    }
  } catch (e) { /* storage unavailable */ }
}

export default { CAPS, init, list, record, describe, plainText, drop, flush, baseline };
