/* ============================================================
   manga-book.js — turn a file the person has into a list of pages.

   openBook(src) -> book
     src: { blob, name }          a CBZ (zip of pictures), an EPUB, or a PDF
          { files: [{name, blob|path}] }   a folder of pictures
   book: { kind: 'images'|'pdf', title, count, page(i) -> Promise<Blob>,
           cover() -> Promise<Blob>, pdfBlob?, close() }
     cover() is the book's own cover: an EPUB's declared cover image when
     it has one, otherwise the first page. It reads the file on this
     device; nothing is fetched.

   · CBZ: core/zip.js reads the table of contents; a page's bytes are
     unpacked only when asked for (entryBytes), so a 500-page volume
     is never held in memory whole.
   · EPUB: a zip too — the pictures its pages show, in reading order.
     An EPUB with no pictures is refused with a plain sentence.
   · PDF: handed to the browser's own PDF viewer (as Files does); no
     page list is made, so spread, direction and zoom are the viewer's.
   · CBR (RAR) is not a format StaticOS can unpack; the error says so.
   Page names are sorted the way a person counts (2 before 10).
   Nothing here touches the DOM.
   ============================================================ */
import { readZip, entryBytes, ZipError } from '../core/zip.js';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
export const extOf = n => { const i = String(n).lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
export const isImageName = n => !!MIME[extOf(n)];
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export const natural = (a, b) => collator.compare(a, b);
const stem = n => String(n).replace(/\.[^.]+$/, '');

export class BookError extends Error { constructor(m, o) { super(m); if (o) Object.assign(this, o); } }

function imagePages(entries) {
  return entries
    .filter(e => !e.dir && isImageName(e.name) && !/(^|\/)(__MACOSX\/|\._|\.DS_Store)/.test(e.name))
    .sort((a, b) => natural(a.path || a.name, b.path || b.name));
}

async function openZipImages(blob, title) {
  const zip = await readZip(blob);
  const pages = imagePages(zip.entries).filter(e => !e.problem);
  if (!pages.length) throw new BookError('There are no pictures in this archive, so there is nothing to read.');
  return {
    kind: 'images', title, count: pages.length,
    async page(i) {
      const e = pages[i];
      const bytes = await entryBytes(blob, e);
      return new Blob([bytes], { type: MIME[extOf(e.name)] });
    },
    cover() { return this.page(0); },
    close() {},
  };
}

/* resolve "../Images/p1.jpg" against "OEBPS/Text/p1.xhtml" */
function resolvePath(base, rel) {
  const clean = String(rel).split('#')[0].split('?')[0];
  if (/^[a-z]+:/i.test(clean)) return null;
  const parts = clean.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const p of decodeURIComponent(clean).split('/')) {
    if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

async function openEpub(blob, title) {
  const zip = await readZip(blob);
  const byPath = new Map(zip.entries.filter(e => !e.dir && !e.problem).map(e => [e.path, e]));
  const text = async path => {
    const e = byPath.get(path);
    return e ? new TextDecoder().decode(await entryBytes(blob, e)) : null;
  };
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const container = await text('META-INF/container.xml');
  const opfPath = container && xml(container).querySelector('rootfile')?.getAttribute('full-path');
  const opfSrc = opfPath && await text(opfPath);
  if (!opfSrc) throw new BookError('This EPUB is missing its table of contents, so it can’t be read.');
  const opf = xml(opfSrc);
  const manifest = new Map([...opf.querySelectorAll('manifest > item')].map(i => [i.getAttribute('id'), i]));
  const order = [];
  const seen = new Set();
  let words = 0, htmlPages = 0;       /* how much reading the spine holds: a picture book has next to none */
  const add = p => { if (p && byPath.has(p) && isImageName(p) && !seen.has(p)) { seen.add(p); order.push(p); } };
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const item = manifest.get(ref.getAttribute('idref'));
    const href = item && item.getAttribute('href');
    const page = href && resolvePath(opfPath, href);
    if (!page) continue;
    if (isImageName(page)) { add(page); continue; }
    const html = await text(page);
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    htmlPages++;
    words += (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim().length;
    for (const el of doc.querySelectorAll('img[src], image')) {
      const src = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href');
      if (src) add(resolvePath(page, src));
    }
  }
  /* a book with real text on its pages (over 400 letters a page, where a comic's pages hold a caption at most) is a text book, whatever pictures it has */
  if (htmlPages && words > 400 * htmlPages) throw new BookError('This EPUB is made of text. Static Manga reads picture books (comics and manga); text books open in Books.', { textBook: true });
  if (!order.length) throw new BookError('This EPUB has no pictures in it. Static Manga reads picture books (comics and manga); text books open in Books.', { textBook: true });
  /* the cover the publisher declared: EPUB 3 properties="cover-image", or EPUB 2 <meta name="cover" content="item id"> */
  let coverPath = null;
  const items = [...manifest.values()];
  const byProp = items.find(i => /(^|\s)cover-image(\s|$)/.test(i.getAttribute('properties') || ''));
  const metaId = opf.querySelector('metadata meta[name="cover"]')?.getAttribute('content');
  const decl = byProp || (metaId && manifest.get(metaId));
  if (decl) { const c = resolvePath(opfPath, decl.getAttribute('href') || ''); if (c && byPath.has(c) && isImageName(c)) coverPath = c; }
  const read = async path => { const e = byPath.get(path); return new Blob([await entryBytes(blob, e)], { type: MIME[extOf(e.name)] }); };
  return {
    kind: 'images', title, count: order.length,
    page: i => read(order[i]),
    cover: () => read(coverPath || order[0]),
    close() {},
  };
}

function openFolder(files, title) {
  const pages = files.filter(f => isImageName(f.name)).sort((a, b) => natural(a.name, b.name));
  if (!pages.length) throw new BookError('There are no pictures in this folder.');
  return {
    kind: 'images', title, count: pages.length,
    async page(i) {
      const f = pages[i];
      const blob = f.blob || (f.read && await f.read());
      if (!blob) throw new BookError(`“${f.name}” has no data in this browser.`);
      return blob.type ? blob : new Blob([blob], { type: MIME[extOf(f.name)] });
    },
    cover() { return this.page(0); },
    close() {},
  };
}

export async function openBook(src) {
  if (src.files) return openFolder(src.files, src.title || 'Folder');
  const { blob, name } = src;
  const ext = extOf(name);
  const title = src.title || stem(name);
  if (ext === 'pdf') {
    const head = await blob.slice(0, 5).text();
    if (head !== '%PDF-') throw new BookError('This file doesn’t start like a PDF, so it can’t be opened.');
    return { kind: 'pdf', title, count: 0, pdfBlob: blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }), page: async () => { throw new BookError('PDF pages are drawn by the browser.'); }, close() {} };
  }
  if (ext === 'cbr' || ext === 'rar') throw new BookError('CBR files are RAR archives, which StaticOS can’t unpack. Open the “Got a CBR file?” guide on the My books tab: turning it into a CBZ takes a minute.');
  try {
    if (ext === 'epub') return await openEpub(blob, title);
    return await openZipImages(blob, title);
  } catch (err) {
    if (err instanceof ZipError) throw new BookError(err.message);
    throw err;
  }
}

/** A small JPEG of a page, for covers and thumbnails. */
export async function thumbOf(blob, width = 240) {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, width / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('no thumbnail'))), 'image/jpeg', 0.7));
  } finally { bmp.close && bmp.close(); }
}
