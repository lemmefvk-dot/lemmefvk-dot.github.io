/* ============================================================
   textindex.js — find a word inside your notes and text files.

   Spotlight asks query(); this module keeps a small index so that
   answering does not mean reading every file on every keystroke.

   What is indexed: every note (its title and words, js/core/notesfmt
   .js) and every text file in your home folder — .txt .md .csv .json,
   code and config files — up to the first 200,000 characters of each.
   Not the Trash, not hidden folders, not pictures/video/music.

   The index: for each document, a folded copy of its text (lower
   case, accents off, same length as the original so a match maps
   straight back to it) and its set of words; for each word, the
   documents that have it; for each two-letter start, the words that
   begin with it. A query looks each typed word up as a word START
   ("plan" finds "planning") in that table and intersects the result
   — the work per keystroke grows with how many words match, not with
   how much text there is. Only the few results shown get a snippet.

   It is built in 6 ms slices the first time Spotlight opens (or when
   the page is idle after start-up), and kept current: an fs:change
   marks that folder, a change to the stored notes marks the notes;
   the next query re-reads just those first.
   ============================================================ */
import { bus } from './bus.js';
import { store } from './store.js';
import { vfs } from './vfs.js';
import { noteText } from './notesfmt.js';

/* ---------- folding: case and accents off, length kept ---------- */
const FOLD = new Map();
function foldChar(ch) {
  let v = FOLD.get(ch);
  if (v === undefined) {
    const base = ch.normalize('NFD')[0] || ch;
    const low = base.toLowerCase();
    v = low.length === 1 ? low : base.length === 1 ? base : ch;
    FOLD.set(ch, v);
  }
  return v;
}
/** Lower case without accents, the same length as the input (so an index
    into the folded text is an index into the original). */
export function fold(s) {
  const str = String(s ?? '');
  if (!/[^\x00-\x7f]/.test(str)) return str.toLowerCase();
  const out = str.replace(/[^\x00-\x7f]/g, foldChar).toLowerCase();
  if (out.length === str.length) return out;
  let slow = '';
  for (const ch of str.split('')) slow += /[A-Z]/.test(ch) ? ch.toLowerCase() : /[^\x00-\x7f]/.test(ch) ? foldChar(ch) : ch;
  return slow;
}

const WORD = /[\p{L}\p{N}]+/gu;
const WCH = /[\p{L}\p{N}]/u;
const MIN_WORD = 2, MAX_WORD = 48;
export const MAX_DOC = 200_000;

/** The words of a query: folded, two letters or more. */
export const words = q => [...new Set((fold(q).match(WORD) || []).filter(w => w.length >= MIN_WORD))];

/* ---------- what counts as a text file -------------------------- */
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'conf', 'cfg', 'toml', 'yml', 'yaml', 'ini', 'env.example',
  'xml', 'html', 'htm', 'css', 'scss', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rs', 'c', 'h', 'cpp', 'hpp',
  'java', 'kt', 'go', 'rb', 'php', 'sh', 'bash', 'zsh', 'lua', 'sql', 'tex', 'srt', 'vtt', 'rtf',
]);
const HOME = vfs.HOME;
const TRASH = `${HOME}/Trash`;
const skipPath = p => p === TRASH || p.startsWith(`${TRASH}/`) || /\/\./.test(p);
function isText(n) {
  if (!n || n.type !== 'file') return false;
  if (!TEXT_EXT.has(vfs.extOf(n.name))) return false;
  const c = n.content;
  return typeof c === 'string' && !c.startsWith('staticos-media:') && !c.startsWith('staticos-asset:');
}

/* ---------- the index ------------------------------------------- */
const docs = new Map();      /* key ('f:<path>' | 'n:<id>') -> doc */
const post = new Map();      /* word -> Set(key) */
const pre2 = new Map();      /* first two letters -> Set(word) */

function index(doc) {
  for (const t of doc.toks) {
    let s = post.get(t);
    if (!s) {
      post.set(t, s = new Set());
      const p = t.slice(0, 2);
      let b = pre2.get(p);
      if (!b) pre2.set(p, b = new Set());
      b.add(t);
    }
    s.add(doc.key);
  }
}
function unindex(doc) {
  for (const t of doc.toks) {
    const s = post.get(t);
    if (!s) continue;
    s.delete(doc.key);
    if (s.size) continue;
    post.delete(t);
    const p = t.slice(0, 2), b = pre2.get(p);
    if (b) { b.delete(t); if (!b.size) pre2.delete(p); }
  }
}
function put(doc) {
  const old = docs.get(doc.key);
  if (old) unindex(old);
  docs.set(doc.key, doc);
  index(doc);
}
function drop(key) {
  const old = docs.get(key);
  if (!old) return;
  unindex(old);
  docs.delete(key);
}

function makeDoc(key, kind, ref, title, text, src, mtime) {
  const body = text.length > MAX_DOC ? text.slice(0, MAX_DOC) : text;
  const ftext = fold(body), ftitle = fold(title);
  const toks = new Set();
  for (const part of [ftitle, ftext]) {
    for (const w of part.match(WORD) || []) if (w.length >= MIN_WORD && w.length <= MAX_WORD) toks.add(w);
  }
  return { key, kind, ref, title, text: body, fold: ftext, ftitle, toks, src, mtime: Date.parse(mtime) || 0 };
}
const fileDoc = (path, n) => makeDoc(`f:${path}`, 'f', path, n.name, n.content || '', n.content, n.mtime);
const noteDoc = n => Object.assign(makeDoc(`n:${n.id}`, 'n', n.id, n.title || 'Untitled note', noteText(n), n.body, n.mtime), { fmt: n.fmt });

/* ---------- keeping it current ---------------------------------- */
let built = false;
let job = null;
let notesDirty = true;
const dirtyDirs = new Set();
const readyFns = new Set();
const stat = { docs: 0, words: 0, buildMs: 0, lastMs: 0, built: false };

function syncNotes() {
  notesDirty = false;
  const list = store.get('notes');
  const seen = new Set();
  if (Array.isArray(list)) {
    for (const n of list) {
      if (!n || !n.id) continue;
      const key = `n:${n.id}`;
      seen.add(key);
      const old = docs.get(key);
      if (old && old.src === n.body && old.title === (n.title || 'Untitled note') && old.fmt === n.fmt) continue;
      put(noteDoc(n));
    }
  }
  for (const key of [...docs.keys()]) if (key.startsWith('n:') && !seen.has(key)) drop(key);
}

/** Re-read one folder (and everything under it). */
function syncDir(dir) {
  let d = vfs.norm(dir);
  if (d !== HOME && !d.startsWith(`${HOME}/`)) {
    if (!`${HOME}/`.startsWith(d === '/' ? '/' : `${d}/`)) return;     /* outside home */
    d = HOME;                                                            /* '/', '/home' */
  }
  const seen = new Set();
  const node = vfs.node(d);
  if (node && node.type === 'dir' && !skipPath(d)) {
    vfs.walk(d, (n, path) => {
      if (n.type !== 'file' || !isText(n) || skipPath(vfs.parentPath(path))) return;
      const key = `f:${path}`;
      seen.add(key);
      const old = docs.get(key);
      if (old && old.src === n.content && old.title === n.name) return;
      put(fileDoc(path, n));
    });
  }
  const pfx = `${d}/`;
  for (const key of [...docs.keys()]) {
    if (key.startsWith('f:') && key.slice(2).startsWith(pfx) && !seen.has(key)) drop(key);
  }
}

function flush() {
  if (notesDirty) syncNotes();
  if (dirtyDirs.size && (built || job)) {
    const dirs = [...dirtyDirs];
    dirtyDirs.clear();
    /* a folder whose parent is also marked is covered by the parent */
    for (const d of dirs) if (!dirs.some(o => o !== d && d.startsWith(`${o}/`))) syncDir(d);
  }
}

const later = fn => setTimeout(fn, 0);

/** Build the whole index in small slices; resolves when it is done. */
export function build() {
  if (built) return Promise.resolve();
  if (job) return job;
  const t0 = performance.now();
  let busy = 0;
  const queue = [];
  dirtyDirs.clear();
  vfs.walk(HOME, (n, path) => { if (n.type === 'file' && isText(n) && !skipPath(vfs.parentPath(path))) queue.push(path); });
  job = new Promise(resolve => {
    const step = () => {
      const s = performance.now();
      if (notesDirty) syncNotes();
      while (queue.length && performance.now() - s < 6) {
        const p = queue.pop();
        const n = vfs.node(p);
        if (n && isText(n)) {
          const old = docs.get(`f:${p}`);
          if (!old || old.src !== n.content || old.title !== n.name) put(fileDoc(p, n));
        }
      }
      busy += performance.now() - s;
      if (queue.length) { later(step); return; }
      built = true;
      job = null;
      stat.buildMs = Math.round(busy * 10) / 10;
      stat.wallMs = Math.round(performance.now() - t0);
      flush();
      resolve();
      for (const fn of readyFns) { try { fn(); } catch (e) { console.error(e); } }
      bus.emit('textindex:ready', stats());
    };
    later(step);
  });
  return job;
}

/* ---------- searching ------------------------------------------- */
function candidates(w) {
  const out = new Set();
  const bucket = pre2.get(w.slice(0, 2));
  if (!bucket) return out;
  for (const t of bucket) {
    if (!t.startsWith(w)) continue;
    for (const k of post.get(t)) out.add(k);
    if (out.size === docs.size) break;
  }
  return out;
}

const isStart = (s, i) => i === 0 || !WCH.test(s[i - 1]);
/** Where w first appears at the start of a word in s (folded), or -1. */
function wordAt(s, w, from = 0) {
  let i = s.indexOf(w, from);
  while (i >= 0 && !isStart(s, i)) i = s.indexOf(w, i + 1);
  return i;
}

/** A line of context around the first match, and where each word lands in it. */
function snippet(d, ws) {
  let best = -1, word = ws[0];
  for (const w of ws) {
    const at = wordAt(d.fold, w);
    if (at >= 0 && (best < 0 || at < best)) { best = at; word = w; }
  }
  const T = d.text;
  if (best < 0) {
    /* only the title matched */
    const first = T.replace(/\s+/g, ' ').trim();
    return { snip: { text: first.slice(0, 120), marks: [], pre: false, post: first.length > 120 }, at: -1, line: 1, word };
  }
  const ls = T.lastIndexOf('\n', best - 1) + 1;
  let le = T.indexOf('\n', best);
  if (le < 0) le = T.length;
  let s = Math.max(ls, best - 36);
  if (s > ls) { const sp = T.indexOf(' ', s); if (sp > 0 && sp < best) s = sp + 1; }
  const e = Math.min(le, Math.max(best + 90, s + 120));
  const raw = T.slice(s, e);
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const marks = [];
  for (const w of ws) {
    let i = wordAt(d.fold, w, s);
    while (i >= 0 && i + w.length <= e) {
      marks.push([i - s - lead, i - s - lead + w.length]);
      i = wordAt(d.fold, w, i + w.length);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const m of marks) {
    if (m[0] < 0 || m[1] > text.length) continue;
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push(m.slice());
  }
  let line = 1;
  for (let k = T.indexOf('\n'); k >= 0 && k < best; k = T.indexOf('\n', k + 1)) line++;
  /* … only where the line itself is cut short */
  return { snip: { text, marks: merged, pre: s > ls, post: e < le }, at: best, line, word };
}

/**
 * Notes and files whose text has every typed word (as the start of a word).
 *   opts.limit  how many to return with a snippet (8)
 *   opts.kinds  ['n'] notes only, ['f'] files only
 *   opts.skip   Set of keys ('n:<id>', 'f:<path>') already shown elsewhere
 * -> { hits: [{ key, kind, ref, title, snip, at, line, word }], total, ready, ms }
 */
export function query(q, { limit = 8, kinds = null, skip = null } = {}) {
  const t0 = performance.now();
  if (!built && !job) build();
  flush();
  const ws = words(q);
  if (!ws.length) return { hits: [], total: 0, ready: built, ms: 0 };
  const sets = ws.map(candidates).sort((a, b) => a.size - b.size);
  const res = [];
  for (const k of sets[0]) {
    if (skip && skip.has(k)) continue;
    if (kinds && !kinds.includes(k[0])) continue;
    if (sets.every(s => s.has(k))) res.push(k);
  }
  const scored = res.map(k => {
    const d = docs.get(k);
    let s = 0;
    for (const w of ws) {
      s += d.toks.has(w) ? 3 : 1;                                   /* the whole word beats a word start */
      if (wordAt(d.ftitle, w) >= 0) s += 2;
    }
    return [d, s];
  }).sort((a, b) => b[1] - a[1] || b[0].mtime - a[0].mtime);
  const hits = scored.slice(0, limit).map(([d]) => ({ key: d.key, kind: d.kind, ref: d.ref, title: d.title, ...snippet(d, ws) }));
  stat.lastMs = performance.now() - t0;
  return { hits, total: res.length, ready: built, ms: stat.lastMs };
}

/** Numbers about the index (System Monitor, tests). */
export function stats() {
  return { ...stat, docs: docs.size, words: post.size, built, lastMs: Math.round(stat.lastMs * 100) / 100 };
}
export const ready = () => built;
/** Called (again) whenever a build finishes. Returns an unsubscribe. */
export function onReady(fn) { readyFns.add(fn); return () => readyFns.delete(fn); }

let started = false;
/** Listen for changes, and build when the page is idle after start-up. */
export function init() {
  if (started) return;
  started = true;
  bus.on('fs:change', dir => { if (typeof dir === 'string') dirtyDirs.add(vfs.norm(dir)); });
  store.sub('notes', () => { notesDirty = true; });
  const warm = () => (typeof requestIdleCallback === 'function'
    ? requestIdleCallback(() => build(), { timeout: 15000 })
    : setTimeout(() => build(), 3000));
  bus.once('boot:ready', () => setTimeout(warm, 2500));
}

export default { init, build, query, stats, ready, onReady, fold, words, MAX_DOC };
