/* ============================================================
   archive.js — ZIP files in the StaticOS file system.

   core/zip.js knows the format; this knows where the bytes live.

   Compress: every selected file and folder (folders all the way
   down, empty ones included) goes into one real .zip saved beside
   them through media.save — "<name>.zip" for one item, "Archive.zip"
   for several, " 2", " 3"… when the name is taken. Nothing is ever
   overwritten. A file's bytes are its text (vfs), its blob
   (IndexedDB) or, for the pictures and clips StaticOS ships with,
   the file fetched from the site. A file listed with a size but no
   bytes in this browser is left out and named in the result.

   Extract: entries go into a new folder named after the archive
   (one that is only a folder of that name, as Compress makes, is
   not nested twice), or straight into the archive's own folder
   ("Extract here", where a clashing name gets " 2"), by
   the same rules as importing from the computer
   (core/fileimport.js): plain text stays editable text, pictures,
   videos and music become real media files, anything else is kept
   as a file. Names come from core/zip.js's safeParts, so nothing
   can land outside the target; ".." names, encrypted entries and
   unsupported methods are skipped and listed with the reason.
   At most zip.MAX_TOTAL bytes and zip.MAX_ENTRIES entries are
   unpacked, and never more than the browser says it has room for.

     compress(dir, names, { onProgress })  -> { path, name, size, files, folders, skipped }
     extract(zipPath, { here, onProgress }) -> { dir, folder, files, folders, skipped, bytes }
     listing(zipPath)                       -> { entries, comment, size }
   ============================================================ */
import vfs from './vfs.js';
import media from './media.js';
import * as fileimport from './fileimport.js';
import * as Z from './zip.js';

export const { ZipError } = Z;
export const isZip = n => !!n && n.type === 'file' && vfs.extOf(n.name) === 'zip';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  ogv: 'video/ogg', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus', weba: 'audio/webm',
  pdf: 'application/pdf', zip: 'application/zip', json: 'application/json', txt: 'text/plain', md: 'text/markdown',
  csv: 'text/csv', html: 'text/html', css: 'text/css', js: 'text/javascript', xml: 'application/xml',
};
export const mimeFor = name => MIME[vfs.extOf(name)] || '';

const at = (dir, name) => `${dir === '/' ? '' : dir}/${name}`;
const stemOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const enc = new TextEncoder();

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

const hasText = n => typeof n.content === 'string' && n.content.length > 0 && !media.isMedia(n);
const isHollow = n => n.type === 'file' && !media.isMedia(n) && !hasText(n) && (n.size || 0) > 0;
const dateOf = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? new Date() : d; };

/* ---------------- compress ---------------- */
export async function compress(dir, names, { onProgress } = {}) {
  const why = fileimport.importBlock(dir);
  if (why) throw new ZipError('blocked', why);
  const roots = [...new Set(names)].map(name => ({ name, n: vfs.node(at(dir, name)) })).filter(r => r.n);
  if (!roots.length) throw new ZipError('empty', 'Nothing to compress — select files or folders first.');

  const items = [];
  const skipped = [];
  let files = 0, folders = 0;
  const walk = (n, rel) => {
    if (n.type === 'dir') {
      folders++;
      items.push({ name: `${rel}/`, dir: true, date: dateOf(n.mtime) });
      for (const c of n.children) walk(c, `${rel}/${c.name}`);
      return;
    }
    if (isHollow(n)) { skipped.push({ name: rel, why: 'It has no content in this browser, so there was nothing to put in.' }); return; }
    files++;
    items.push({
      name: rel, date: dateOf(n.mtime), size: n.size || 0,
      read: async () => {
        if (!media.isMedia(n)) return enc.encode(n.content || '');
        let b = null;
        try { b = await media.blobOf(n); } catch (e) { b = null; }
        if (!b) { files--; throw new ZipError('skip', 'Its bytes couldn’t be read in this browser, so it was left out.'); }
        return b;
      },
    });
  };
  for (const r of roots) walk(r.n, r.name);

  const made = await Z.makeZip(items, { onProgress });
  skipped.push(...made.skipped);
  if (!made.count) throw new ZipError('empty', 'Nothing could be compressed — none of it has content in this browser.');
  const want = roots.length === 1 ? `${roots[0].name}.zip` : 'Archive.zip';
  const saved = await media.save(dir, want, made.blob);
  return { path: saved.path, name: vfs.baseName(saved.path), size: made.blob.size, files, folders, skipped, deflated: made.deflated, stored: made.stored };
}

/* ---------------- read ---------------- */
async function blobFor(zipPath) {
  const n = vfs.node(zipPath);
  if (!n || n.type !== 'file') throw new ZipError('missing', 'That archive is no longer here.');
  if (!media.isMedia(n)) throw new ZipError('missing', isHollow(n) ? 'It has no content in this browser.' : 'It isn’t a ZIP archive.');
  let blob = null;
  try { blob = await media.blobOf(n); } catch (e) { blob = null; }
  if (!blob) throw new ZipError('missing', 'Its bytes are missing from this browser.');
  return { n, blob };
}

export async function listing(zipPath) {
  const { blob } = await blobFor(zipPath);
  const { entries, comment } = await Z.readZip(blob);
  return { entries, comment, size: blob.size };
}

/* ---------------- extract ---------------- */
export async function extract(zipPath, { here = false, onProgress } = {}) {
  const dir = vfs.parentPath(zipPath);
  const why = fileimport.importBlock(dir);
  if (why) throw new ZipError('blocked', why);
  const { n: zn, blob } = await blobFor(zipPath);
  const { entries } = await Z.readZip(blob);
  const skipped = entries.filter(e => e.problem).map(e => ({ name: e.name, why: e.problem }));
  const good = entries.filter(e => !e.problem);
  const bytes = good.reduce((a, e) => a + (e.dir ? 0 : e.size), 0);
  if (bytes > Z.MAX_TOTAL) {
    throw new ZipError('too-big', `It unpacks to ${fileimport.fmtSize(bytes)}; StaticOS unpacks up to ${fileimport.fmtSize(Z.MAX_TOTAL)} at a time.`);
  }
  const free = await fileimport.freeBytes();
  if (free !== null && bytes > free) {
    throw new ZipError('no-room', `It unpacks to ${fileimport.fmtSize(bytes)}, but this browser only has about ${fileimport.fmtSize(free)} left for StaticOS.`);
  }

  /* an archive that is one folder named like itself ("ZipMe.zip" holding
     "ZipMe/") unpacks to that folder, not to ZipMe/ZipMe */
  const stem = stemOf(zn.name) || 'Archive';
  const single = !here && good.length > 0 && good.every(e => e.parts[0] === stem && (e.dir || e.parts.length > 1));
  const partsOf = e => (single ? e.parts.slice(1) : e.parts);

  let target = dir;
  if (!here) {
    const name = uniqueIn(dir, stem);
    if (!vfs.mkdir(at(dir, name))) throw new ZipError('blocked', `A folder can’t be made in ${fileimport.folderLabel(dir)}.`);
    target = at(dir, name);
  }

  /* "Extract here": a top-level folder that clashes with something already
     there gets its own name (" 2"), so nothing is merged or overwritten */
  const tops = new Map();
  const topName = name => {
    if (!tops.has(name)) tops.set(name, vfs.node(at(dir, name)) ? uniqueIn(dir, name) : name);
    return tops.get(name);
  };
  let folders = 0;
  const ensureDir = parts => {
    let cur = target;
    for (let i = 0; i < parts.length; i++) {
      const name = here && i === 0 ? topName(parts[i]) : parts[i];
      const next = at(cur, name);
      const n = vfs.node(next);
      if (n && n.type !== 'dir') return null;
      if (!n) { if (!vfs.mkdir(next)) return null; folders++; }
      cur = next;
    }
    return cur;
  };

  let files = 0, done = 0;
  for (let i = 0; i < good.length; i++) {
    const e = good[i];
    try { onProgress?.({ index: i + 1, total: good.length, name: e.path, done, bytes }); } catch (err) { /* a view that went away */ }
    const parts = partsOf(e);
    if (e.dir) {
      const d = ensureDir(parts);
      if (!d) skipped.push({ name: e.name, why: 'A file of the same name is in the way.' });
      else if (e.date) vfs.node(d).mtime = e.date.toISOString();
      continue;
    }
    const parent = ensureDir(parts.slice(0, -1));
    if (!parent) { skipped.push({ name: e.name, why: 'A file of the same name is in the way of its folder.' }); continue; }
    let data;
    try { data = await Z.entryBytes(blob, e); }
    catch (err) { skipped.push({ name: e.name, why: err?.message || String(err) }); continue; }
    done += e.size;
    const fname = parts[parts.length - 1];
    const file = new File([data], fname, { type: mimeFor(fname), lastModified: e.date ? e.date.getTime() : Date.now() });
    const [r] = await fileimport.importFiles(parent, [file]);
    if (r?.ok) files++;
    else skipped.push({ name: e.name, why: r?.why || 'It couldn’t be saved.' });
  }
  return { dir, folder: here ? null : target, files, folders, skipped, bytes: done };
}

export default { compress, extract, listing, isZip, mimeFor, uniqueIn, ZipError };
