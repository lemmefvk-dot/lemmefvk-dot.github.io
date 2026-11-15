/* ============================================================
   mangafind.js — which comic and manga books are in this person's
   files, and which of them is the title being looked at.

   Used by Static Manga (its "My books" shelf) and by Static Anime's
   manga pages ("Is it in my files?"), so it lives here and works
   without Static Manga's window being open. Nothing leaves the device:
   it only reads names from the files system.

   bookFiles()      -> [{ key, path, name, kind, size }]
                       CBZ and EPUB anywhere under Home, PDFs and
                       folders of pictures inside ~/Manga and ~/Comics.
   matchBooks(title, books) -> the books whose names fit the title
   ============================================================ */
import vfs from './vfs.js';

export const BOOK_EXT = new Set(['cbz', 'epub', 'cbr']);
export const MANGA_DIRS = ['Manga', 'Comics'];
const IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function bookFiles(extraPaths = []) {
  const out = new Map();
  const inMangaDir = p => MANGA_DIRS.some(d => p.startsWith(`${vfs.HOME}/${d}/`));
  const add = (path, n, kind) => out.set(path, { key: path, path, name: n.name, kind, size: n.size || 0 });
  vfs.walk(vfs.HOME, (n, path) => {
    if (path.startsWith(`${vfs.HOME}/Trash`)) return;
    if (n.type === 'file') {
      const e = extOf(n.name);
      if (BOOK_EXT.has(e) || (e === 'pdf' && inMangaDir(path))) add(path, n, e);
    } else if (n.type === 'dir' && inMangaDir(`${path}/`) && path !== `${vfs.HOME}/Manga` && path !== `${vfs.HOME}/Comics`) {
      if (n.children.filter(c => c.type === 'file' && IMG.test(c.name)).length >= 2) add(path, n, 'folder');
    }
  });
  for (const p of extraPaths) { const n = vfs.node(p); if (n && !out.has(p)) add(p, n, n.type === 'dir' ? 'folder' : extOf(n.name)); }
  return [...out.values()].sort((a, b) => collator.compare(a.name, b.name));
}

/* "Dr. STONE (vol 3).cbz" and "Dr Stone" should meet: lower case, no extension, letters and digits only */
const squash = s => String(s).normalize('NFKD').replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'of', 'no', 'wa', 'to', 'vol', 'volume', 'v', 'ch', 'chapter']);

export function matchBooks(title, books = bookFiles()) {
  const want = squash(title);
  if (!want) return [];
  const words = want.split(' ').filter(w => !STOP.has(w));
  return books.filter(b => {
    const have = squash(b.name);
    if (have.includes(want)) return true;
    return words.length >= 2 && words.every(w => have.includes(w));
  });
}

export default { bookFiles, matchBooks, BOOK_EXT, MANGA_DIRS };
