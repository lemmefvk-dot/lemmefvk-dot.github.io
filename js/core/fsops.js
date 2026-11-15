/* ============================================================
   fsops.js — what Files and Static Downloads do to files, in one
   place, so both can undo it and both mean the same thing by it.

   · Trash / Put Back. vfs.rm remembers where an item came from
     (node.trashedFrom, kept in the saved snapshot), so Put Back works
     after a reload. A folder that is gone is made again; a name that
     was taken in the meantime is kept alongside ("name 2").
   · Undo. Every trash, move, rename, batch rename and paste writes one
     line into a short journal (store 'portal.fsundo', this person's own,
     the last 25). The lines are paths, not objects, so they replay after
     a reload. An undo that can't be done (the item left the Trash for
     good) says which one and why.
   · Cut, Copy, Paste. One clipboard for every Files window.
   · Batch rename plans (prefix / numbers / find and replace) with the
     names that would clash flagged before anything changes.
   · Measuring: Get Info, the largest files, smart folders (Today, This
     week, Images, Documents), what uses space. A file that is listed
     with a size but holds no bytes (vfs "hollow" files) is never added
     into a total: it is counted separately and said so.
   No DOM here.
   ============================================================ */
import { vfs } from './vfs.js';
import { store } from './store.js';
import { bus } from './bus.js';
import media from './media.js';
import { t as tr } from './i18n.js';

export const HOME = vfs.HOME;
export const TRASH = `${HOME}/Trash`;
const JOURNAL = 'portal.fsundo';
const JOURNAL_MAX = 25;

const at = (dir, name) => `${dir === '/' ? '' : dir}/${name}`;
const inTrash = p => p === TRASH || p.startsWith(`${TRASH}/`);
const hasText = n => n.type === 'file' && !media.isMedia(n) && typeof n.content === 'string' && n.content.length > 0;
/** Listed with a size, but no bytes are stored for it anywhere. */
export const isHollow = n => !!n && n.type === 'file' && !media.isMedia(n) && !hasText(n) && (n.size || 0) > 0;
const byteLen = s => new TextEncoder().encode(s || '').length;

/** name, or "name 2", "name 3"… — whichever is free in dir. */
export function uniqueIn(dir, name) {
  if (!vfs.node(at(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (vfs.node(at(dir, `${stem} ${i}${ext}`))) i++;
  return `${stem} ${i}${ext}`;
}
/** Make dir and every folder above it that is missing. */
export function mkdirp(dir) {
  const path = vfs.norm(dir);
  if (vfs.node(path)) return vfs.node(path).type === 'dir' ? vfs.node(path) : null;
  if (!mkdirp(vfs.parentPath(path))) return null;
  return vfs.mkdir(path);
}
const label = (names, w = 'item') => (names.length === 1 ? `“${names[0]}”` : `${names.length} ${w}s`);

/* ------------------------------------------------------------------ */
/*  the journal                                                        */
/* ------------------------------------------------------------------ */
const readJournal = () => { const v = store.get(JOURNAL); return Array.isArray(v) ? v : []; };
function record(text, ops) {
  if (!ops.length) return;
  store.set(JOURNAL, [...readJournal(), { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: text, at: Date.now(), ops }].slice(-JOURNAL_MAX));
  bus.emit('fsundo:change');
}
export const canUndo = () => readJournal().length > 0;
/** Forget what can no longer be taken back: a trash line whose item has since left the Trash for good.
    Files calls it after Empty Trash or Delete forever, so Undo never offers something that is gone. */
export function prune() {
  const all = readJournal();
  const next = all.map(e => ({ ...e, ops: e.ops.filter(op => op.t !== 'trash' || vfs.node(at(TRASH, op.name))) })).filter(e => e.ops.length);
  if (JSON.stringify(next) !== JSON.stringify(all)) { store.set(JOURNAL, next); bus.emit('fsundo:change'); }
}
/** An id for the newest line in the journal — a window that wants to undo only its own change checks it is still the newest. */
export const journalTop = () => readJournal().slice(-1)[0]?.id || null;
/** What Undo would take back, for a menu or a tooltip ("Move to Trash “a.txt”"). */
export const undoLabel = () => readJournal().slice(-1)[0]?.label || '';

/** Two steps, so a swap (a→b while b→c) can't trip on itself. pairs: [[old, new], …] inside dir. */
function renameSet(dir, pairs) {
  const done = [], failed = [];
  if (pairs.length === 1) {                       /* no swap to worry about: rename straight away */
    const [from, to] = pairs[0];
    if (from === to) return { done, failed };
    if (!vfs.node(at(dir, from))) failed.push({ name: from, why: 'it is no longer there' });
    else if (vfs.node(at(dir, to))) failed.push({ name: from, why: tr('“{to}” is taken', { to }) });
    else if (vfs.rename(at(dir, from), to)) done.push([from, to]);
    else failed.push({ name: from, why: 'it could not be renamed' });
    return { done, failed };
  }
  const tmp = [];
  for (const [from, to] of pairs) {
    if (from === to) continue;
    if (!vfs.node(at(dir, from))) { failed.push({ name: from, why: 'it is no longer there' }); continue; }
    const t = `.rn-${Math.random().toString(36).slice(2, 8)}-${tmp.length}`;
    if (vfs.rename(at(dir, from), t)) tmp.push([t, to, from]); else failed.push({ name: from, why: 'it could not be renamed' });
  }
  for (const [t, to, from] of tmp) {
    if (!vfs.node(at(dir, to)) && vfs.rename(at(dir, t), to)) done.push([from, to]);
    else { vfs.rename(at(dir, t), from); failed.push({ name: from, why: tr('“{to}” is taken', { to }) }); }
  }
  return { done, failed };
}

/* ------------------------------------------------------------------ */
/*  Trash, Put Back                                                    */
/* ------------------------------------------------------------------ */
/** Move these to the Trash (what is already in it is left alone). Undoable. */
export function trash(paths, { record: rec = true } = {}) {
  const ops = [], names = [];
  let failed = 0;
  for (const p of paths.map(vfs.norm)) {
    const n = vfs.node(p);
    if (!n || inTrash(p)) { failed++; continue; }
    if (vfs.rm(p)) { ops.push({ t: 'trash', from: p, name: n.name }); names.push(vfs.baseName(p)); } else failed++;
  }
  if (rec) record(`Move ${label(names)} to Trash`, ops);
  return { done: ops.length, failed, names };
}

/** Where a Trash item will go back to, or null when nothing remembers (items trashed by an older build). */
export function originOf(n) { return n && typeof n.trashedFrom === 'string' ? n.trashedFrom : null; }

/** Put these Trash items back where they were. Undoable. */
export function putBack(names, { record: rec = true } = {}) {
  const ops = [], back = [], problems = [];
  for (const nm of names) {
    const n = vfs.node(at(TRASH, nm));
    if (!n) { problems.push({ name: nm, why: 'it is no longer in the Trash' }); continue; }
    const origin = originOf(n);
    if (!origin) { problems.push({ name: nm, why: 'nothing remembers where it came from — use Move to' }); continue; }
    const dir = vfs.parentPath(origin);
    if (inTrash(dir) || !mkdirp(dir)) { problems.push({ name: nm, why: 'its folder can’t be made again' }); continue; }
    const want = vfs.baseName(origin);
    const as = uniqueIn(dir, want);
    if (!vfs.mv(at(TRASH, nm), dir, { as })) { problems.push({ name: nm, why: 'it could not be moved' }); continue; }
    ops.push({ t: 'restore', to: at(dir, as), name: nm });
    back.push({ name: as, dir, renamed: as !== want, from: want });
  }
  if (rec) record(`Put back ${label(back.map(b => b.name))}`, ops);
  return { back, problems };
}

/* ------------------------------------------------------------------ */
/*  move, rename (journaled)                                           */
/* ------------------------------------------------------------------ */
/** Move paths into dir; a name that is taken there is kept alongside as "name 2". Undoable. */
export function moveInto(paths, dir, { record: rec = true } = {}) {
  const d = vfs.norm(dir);
  const ops = [], moved = [], problems = [];
  for (const p0 of paths) {
    const p = vfs.norm(p0);
    const n = vfs.node(p);
    if (!n) { problems.push({ name: vfs.baseName(p), why: 'it is no longer there' }); continue; }
    if (vfs.parentPath(p) === d) { problems.push({ name: n.name, why: 'it is already in that folder' }); continue; }
    if (n.type === 'dir' && (d === p || d.startsWith(`${p}/`))) { problems.push({ name: n.name, why: 'a folder can’t go inside itself' }); continue; }
    const as = uniqueIn(d, n.name);
    if (!vfs.mv(p, d, { as })) { problems.push({ name: n.name, why: 'it could not be moved' }); continue; }
    ops.push({ t: 'move', from: p, to: at(d, as) });
    moved.push({ name: as, renamed: as !== vfs.baseName(p), from: vfs.baseName(p) });
  }
  if (rec) record(`Move ${label(moved.map(m => m.name))}`, ops);
  return { moved, problems, ops };
}
/** Rename one or several items in a folder: pairs [[old, new], …]. Undoable. */
export function renameMany(dir, pairs, { record: rec = true } = {}) {
  const { done, failed } = renameSet(vfs.norm(dir), pairs);
  if (rec && done.length) record(done.length === 1 ? `Rename “${done[0][0]}”` : `Rename ${done.length} items`, [{ t: 'renameset', dir: vfs.norm(dir), pairs: done }]);
  return { done, failed };
}

/* ------------------------------------------------------------------ */
/*  Undo                                                               */
/* ------------------------------------------------------------------ */
/** Take back the last thing in the journal. Resolves { label, ok, problems } or null when there is nothing. */
export function undo() {
  const all = readJournal();
  const entry = all.slice(-1)[0];
  if (!entry) return null;
  store.set(JOURNAL, all.slice(0, -1));
  const problems = [];
  let ok = 0;
  for (const op of [...entry.ops].reverse()) {
    if (op.t === 'trash') {
      const dir = vfs.parentPath(op.from);
      const n = vfs.node(at(TRASH, op.name));
      if (!n) { problems.push({ name: op.name, why: 'it is no longer in the Trash' }); continue; }
      if (!mkdirp(dir)) { problems.push({ name: op.name, why: 'its folder can’t be made again' }); continue; }
      if (vfs.mv(at(TRASH, op.name), dir, { as: uniqueIn(dir, vfs.baseName(op.from)) })) ok++; else problems.push({ name: op.name, why: 'it could not be moved' });
    } else if (op.t === 'restore') {
      /* undoing a Put Back: into the Trash again */
      if (vfs.node(op.to) && vfs.rm(op.to)) ok++; else problems.push({ name: vfs.baseName(op.to), why: 'it is no longer there' });
    } else if (op.t === 'move') {
      const n = vfs.node(op.to);
      const dir = vfs.parentPath(op.from);
      if (!n) { problems.push({ name: vfs.baseName(op.to), why: 'it is no longer there' }); continue; }
      if (!mkdirp(dir)) { problems.push({ name: n.name, why: 'its folder can’t be made again' }); continue; }
      if (vfs.mv(op.to, dir, { as: uniqueIn(dir, vfs.baseName(op.from)) })) ok++; else problems.push({ name: n.name, why: 'it could not be moved' });
    } else if (op.t === 'renameset') {
      const r = renameSet(op.dir, op.pairs.map(([a, b]) => [b, a]));
      ok += r.done.length;
      problems.push(...r.failed);
    } else if (op.t === 'make') {
      if (vfs.node(op.path) && vfs.rm(op.path)) ok++; else problems.push({ name: vfs.baseName(op.path), why: 'it is no longer there' });
    }
  }
  bus.emit('fsundo:change');
  return { label: entry.label, ok, problems };
}

/* ------------------------------------------------------------------ */
/*  Cut, Copy, Paste                                                   */
/* ------------------------------------------------------------------ */
const clip = { mode: null, paths: [] };
export const clipboard = () => ({ mode: clip.mode, paths: [...clip.paths] });
export function setClipboard(mode, paths) {
  clip.mode = paths.length ? mode : null;
  clip.paths = paths.map(vfs.norm);
  bus.emit('fsclip:change', clipboard());
}
export const clipCount = () => clip.paths.filter(p => vfs.node(p)).length;

/* A copy points at the same bytes (media blobs never change, and media.gc keeps one
   while any file points at it); its size is what it really holds. */
function cloneInto(n, dest) {
  if (n.type === 'dir') {
    const d = vfs.mkdir(dest);
    if (!d) return null;
    for (const c of [...n.children]) cloneInto(c, `${dest}/${c.name}`);
    return d;
  }
  const f = vfs.touch(dest, typeof n.content === 'string' ? n.content : '');
  if (!f) return null;
  f.size = media.isMedia(n) ? (n.size || 0) : byteLen(f.content);
  return f;
}
/** Copy paths into dir (a copy next to its original is "name copy"). Undoable. */
export function copyInto(paths, dir, { record: rec = true } = {}) {
  const d = vfs.norm(dir);
  const ops = [], made = [], problems = [];
  for (const p0 of paths) {
    const p = vfs.norm(p0);
    const n = vfs.node(p);
    if (!n) { problems.push({ name: vfs.baseName(p), why: 'it is no longer there' }); continue; }
    if (n.type === 'dir' && (d === p || d.startsWith(`${p}/`))) { problems.push({ name: n.name, why: 'a folder can’t be copied into itself' }); continue; }
    let want = n.name;
    if (vfs.parentPath(p) === d) {
      const dot = n.type === 'file' ? n.name.lastIndexOf('.') : -1;
      want = dot > 0 ? `${n.name.slice(0, dot)} copy${n.name.slice(dot)}` : `${n.name} copy`;
    }
    const name = uniqueIn(d, want);
    if (!cloneInto(n, at(d, name))) { problems.push({ name: n.name, why: 'it could not be copied' }); continue; }
    ops.push({ t: 'make', path: at(d, name) });
    made.push({ name, hollow: isHollow(n) });
  }
  if (rec) record(`Copy ${label(made.map(m => m.name))}`, ops);
  return { made, problems };
}
/** Paste what Cut or Copy holds into dir. A cut moves (and empties the clipboard). */
export function paste(dir) {
  const mode = clip.mode;
  const paths = clip.paths.filter(p => vfs.node(p));
  if (!mode || !paths.length) return { mode: null, names: [], problems: [] };
  if (mode === 'cut') {
    const r = moveInto(paths, dir, { record: false });
    record(`Move ${label(r.moved.map(m => m.name))}`, r.ops);
    clip.mode = null; clip.paths = [];
    bus.emit('fsclip:change', clipboard());
    const same = r.problems.filter(x => x.why === 'it is already in that folder').length;
    return { mode, names: r.moved.map(m => m.name), problems: r.problems.filter(x => x.why !== 'it is already in that folder'), same };
  }
  const r = copyInto(paths, dir);
  return { mode, names: r.made.map(m => m.name), problems: r.problems, hollow: r.made.filter(m => m.hollow).length };
}

/* ------------------------------------------------------------------ */
/*  new files from templates                                           */
/* ------------------------------------------------------------------ */
export const TEMPLATES = [
  { id: 'txt', label: tr('Text file'), icon: 'file-text', name: 'untitled.txt', body: '' },
  { id: 'md', label: tr('Markdown note'), icon: 'file-text', name: 'untitled.md', body: '# Title\n\nWrite here.\n' },
  { id: 'html', label: tr('HTML page'), icon: 'file-code', name: 'untitled.html',
    body: '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Untitled</title>\n</head>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>\n' },
];
/** Make a file from a template in dir; resolves its name, or null. */
export function newFromTemplate(dir, id) {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) return null;
  const name = uniqueIn(dir, t.name);
  return vfs.touch(at(dir, name), t.body) ? name : null;
}

/* ------------------------------------------------------------------ */
/*  batch rename                                                       */
/* ------------------------------------------------------------------ */
const splitName = name => { const i = name.lastIndexOf('.'); return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, '']; };
/**
 * What each name would become. spec:
 *   { mode: 'replace', find, replace, ignoreCase }
 *   { mode: 'prefix',  prefix, suffix }          (suffix goes before the extension)
 *   { mode: 'number',  base, start, digits, sep }
 * The extension is kept. Returns [{ name, next, state: 'same' | 'ok' | 'bad', why }]; a name that
 * another item in the folder already holds (and that isn't itself being renamed away) is 'bad'.
 */
export function planRename(dir, names, spec) {
  const d = vfs.norm(dir);
  const out = names.map((name, i) => {
    const [stem, ext] = splitName(name);
    let next = name;
    if (spec.mode === 'replace') {
      const find = String(spec.find || '');
      if (find) {
        const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), spec.ignoreCase ? 'gi' : 'g');
        next = stem.replace(re, () => String(spec.replace ?? '')) + ext;
      }
    } else if (spec.mode === 'prefix') {
      next = `${spec.prefix || ''}${stem}${spec.suffix || ''}${ext}`;
    } else if (spec.mode === 'number') {
      const digits = Math.max(1, Math.min(8, Number(spec.digits) || 1));
      const num = String(Math.max(0, Math.floor(Number(spec.start) || 0)) + i).padStart(digits, '0');
      const base = spec.base === undefined ? 'File' : String(spec.base);
      next = `${base}${base && spec.sep !== '' ? (spec.sep ?? ' ') : ''}${num}${ext}`;
    }
    return { name, next, state: next === name ? 'same' : 'ok', why: '' };
  });
  const renaming = new Set(names);
  const seen = new Map();
  for (const r of out) seen.set(r.next, (seen.get(r.next) || 0) + 1);
  for (const r of out) {
    if (r.state === 'same') continue;
    if (!r.next.trim()) { r.state = 'bad'; r.why = 'the name would be empty'; }
    else if (/[/]/.test(r.next) || r.next === '.' || r.next === '..') { r.state = 'bad'; r.why = 'names can’t contain “/”'; }
    else if (r.next.length > 200) { r.state = 'bad'; r.why = 'the name is too long'; }
    else if (seen.get(r.next) > 1) { r.state = 'bad'; r.why = 'two items would get this name'; }
    else if (vfs.node(at(d, r.next)) && !renaming.has(r.next)) { r.state = 'bad'; r.why = 'another item here has this name'; }
  }
  /* an unchanged name that another renamed item lands on is a clash too */
  for (const r of out) {
    if (r.state !== 'same') continue;
    if (out.some(o => o !== r && o.state !== 'same' && o.next === r.name)) { const o = out.find(x => x !== r && x.state !== 'same' && x.next === r.name); o.state = 'bad'; o.why = 'two items would get this name'; }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  measuring                                                          */
/* ------------------------------------------------------------------ */
/** Bytes really held: a hollow file adds nothing here. */
export function realBytes(n) {
  if (!n) return 0;
  if (n.type === 'file') return isHollow(n) ? 0 : (n.size || 0);
  return n.children.reduce((a, c) => a + realBytes(c), 0);
}
/** Everything Get Info says about these paths: counts and sizes measured by walking them. */
export function info(paths) {
  const out = { items: 0, files: 0, folders: 0, bytes: 0, hollow: 0, hollowBytes: 0, newest: 0, oldest: Infinity, kinds: new Map() };
  const visit = n => {
    const t = Date.parse(n.mtime);
    if (Number.isFinite(t)) { out.newest = Math.max(out.newest, t); out.oldest = Math.min(out.oldest, t); }
    if (n.type === 'dir') { out.folders++; for (const c of n.children) visit(c); return; }
    out.files++;
    if (isHollow(n)) { out.hollow++; out.hollowBytes += n.size || 0; return; }
    out.bytes += n.size || 0;
  };
  for (const p of paths) {
    const n = vfs.node(p);
    if (!n) continue;
    out.items++;
    visit(n);
  }
  /* "folders" counts the ones inside, not the ones asked about */
  const asked = paths.filter(p => vfs.node(p)?.type === 'dir').length;
  out.folders -= asked;
  return out;
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'heic', 'ico']);
const DOC_EXT = new Set(['txt', 'md', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'csv', 'tsv', 'sheet', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key', 'epub']);
export const SMART = [
  { id: 'today', label: tr('Today'), icon: 'sun', note: tr('Files you made or changed today.') },
  { id: 'week', label: tr('This week'), icon: 'calendar', note: tr('Files you made or changed in the last 7 days.') },
  { id: 'images', label: tr('Images'), icon: 'image', note: tr('Every picture in Home.') },
  { id: 'documents', label: tr('Docs'), icon: 'file-text', note: tr('Text, notes, PDFs, spreadsheets and slides in Home.') },
];
const visibleHit = (path, hidden) => !inTrash(path) && (hidden || !path.slice(HOME.length + 1).split('/').some(s => s.startsWith('.')));
/** Files in Home (never the Trash or dotfiles) that match a smart folder, newest first. */
export function smart(id, now = Date.now()) {
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const since = id === 'today' ? day0.getTime() : id === 'week' ? day0.getTime() - 6 * 86400000 : 0;
  const hits = [];
  vfs.walk(HOME, (n, path) => {
    if (n.type !== 'file' || !visibleHit(path, false)) return;
    const ext = vfs.extOf(n.name);
    if (id === 'images') { if (!IMAGE_EXT.has(ext)) return; }
    else if (id === 'documents') { if (!DOC_EXT.has(ext)) return; }
    else {
      /* shipped files are furniture, not something the person made or changed */
      if (n.seed || !(Date.parse(n.mtime) >= since)) return;
    }
    hits.push({ node: n, path });
  });
  return hits.sort((a, b) => Date.parse(b.node.mtime) - Date.parse(a.node.mtime));
}
/** The biggest files with bytes behind them, in Home (the Trash counts: it is space too). */
export function largest(limit = 50, start = HOME) {
  const hits = [];
  vfs.walk(start, (n, path) => {
    if (n.type !== 'file' || isHollow(n) || !(n.size > 0)) return;
    if (path.slice(HOME.length + 1).split('/').some(s => s.startsWith('.'))) return;
    hits.push({ node: n, path, bytes: n.size });
  });
  return hits.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}
/** What the Trash holds, for Clean up. */
export function trashInfo() {
  const kids = vfs.ls(TRASH, { hidden: true });
  return { count: kids.length, bytes: kids.reduce((a, k) => a + realBytes(k), 0) };
}

const KIND_OF = ext => (IMAGE_EXT.has(ext) ? 'Pictures' : /^(mp4|webm|mov|m4v|mkv|ogv)$/.test(ext) ? 'Videos'
  : /^(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/.test(ext) ? 'Music' : DOC_EXT.has(ext) ? 'Documents'
    : /^(zip|tar|gz|7z|rar)$/.test(ext) ? 'Archives' : 'Other');
/**
 * What uses space under path: { total, hollow, hollowBytes, children: [{ name, path, dir, bytes, files }], kinds: [[name, bytes]] },
 * biggest first. Sizes are the stored ones; files that list a size but hold no bytes are left out and counted in `hollow`.
 */
export function usage(path) {
  const n = vfs.node(path);
  const res = { total: 0, hollow: 0, hollowBytes: 0, children: [], kinds: [] };
  if (!n || n.type !== 'dir') return res;
  const kinds = new Map();
  const files = c => (c.type === 'file' ? 1 : c.children.reduce((a, k) => a + files(k), 0));
  const tally = c => {
    if (c.type === 'dir') { for (const k of c.children) tally(k); return; }
    if (isHollow(c)) { res.hollow++; res.hollowBytes += c.size || 0; return; }
    const b = c.size || 0;
    res.total += b;
    const k = KIND_OF(vfs.extOf(c.name));
    kinds.set(k, (kinds.get(k) || 0) + b);
  };
  for (const c of n.children) {
    tally(c);
    res.children.push({ name: c.name, path: at(vfs.norm(path), c.name), dir: c.type === 'dir', bytes: realBytes(c), files: files(c) });
  }
  res.children.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  res.kinds = [...kinds].filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
  return res;
}

export default {
  TRASH, trash, putBack, originOf, moveInto, renameMany, undo, canUndo, prune, undoLabel, journalTop, clipboard, setClipboard, clipCount,
  copyInto, paste, TEMPLATES, newFromTemplate, planRename, uniqueIn, mkdirp, isHollow, realBytes, info, SMART, smart, largest, trashInfo, usage,
};
