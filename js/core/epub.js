/* ============================================================
   epub.js — read a text EPUB: its chapters, contents list and cover,
   and turn a chapter into safe HTML.

   openEpub(blob) -> {
     title, author, language,
     chapters: [{ path, size }]          the reading order (spine)
     toc:      [{ title, chapter, hash, level }]
     chapterHtml(i) -> Promise<string>   the chapter as clean HTML (see below)
     coverBlob() -> Promise<Blob|null>   the picture the book names as its cover
     weights                             each chapter's share of the book, by the
                                         bytes its text takes (for a progress bar)
   }

   An EPUB is a zip (core/zip.js reads it here, on this device). A book is
   somebody else's file, so what it holds is never trusted:
   · the chapter is parsed as HTML and rebuilt from an allow-list of tags
     and attributes. Scripts, styles, frames, forms, objects, SVG, MathML,
     event handlers and the book's own style sheets are dropped, and the
     text inside the dropped ones with them. Only the reader's own look
     is applied.
   · pictures become data: pictures read out of the zip. Nothing is
     fetched, so a book can't ask the network for anything.
   · links stay inside the book (data-ch / data-hash) or, for web
     addresses, are marked data-ext for the reader to open in a new tab
     with noopener. Every other link is flattened to its text.
   Nothing here draws anything.
   ============================================================ */
import { readZip, entryBytes, ZipError } from './zip.js';

export class EpubError extends Error {}

const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };
const extOf = n => { const i = String(n).lastIndexOf('.'); return i > 0 ? String(n).slice(i + 1).toLowerCase() : ''; };
const IMG_CAP = 6 * 1024 * 1024;          /* a picture bigger than this is left out */

/* tags kept (everything else is unwrapped, or dropped with its content: DROP) */
const KEEP = new Set(('a abbr b bdi bdo blockquote br caption cite code dd del dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp section article aside header footer main nav details summary small span strong sub sup table tbody td tfoot th thead tr u ul var').split(' '));
const DROP = new Set(('script style iframe frame frameset object embed applet form input button textarea select option link meta base noscript template audio video source track canvas svg math head title map area dialog').split(' '));
const ATTRS = new Set(['id', 'title', 'lang', 'dir', 'colspan', 'rowspan', 'alt', 'start', 'reversed']);

/* resolve "../Images/p1.jpg" against "OEBPS/Text/p1.xhtml" → "OEBPS/Images/p1.jpg"; null for a web address */
export function resolvePath(base, rel) {
  const clean = String(rel || '').split('#')[0].split('?')[0];
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  let dec;
  try { dec = decodeURIComponent(clean); } catch (e) { dec = clean; }
  const parts = dec.startsWith('/') ? [] : String(base).split('/').slice(0, -1);
  for (const p of dec.split('/')) {
    if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

const textOf = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const b64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function openEpub(blob) {
  let zip;
  try { zip = await readZip(blob); } catch (e) {
    if (e instanceof ZipError) throw new EpubError(`This file isn’t an EPUB I can open: ${e.message}`);
    throw e;
  }
  const byPath = new Map(zip.entries.filter(e => !e.dir && !e.problem).map(e => [e.path, e]));
  const lower = new Map([...byPath.keys()].map(p => [p.toLowerCase(), p]));
  const find = p => byPath.get(p) || byPath.get(lower.get(String(p).toLowerCase()));
  const bytes = async p => { const e = find(p); return e ? entryBytes(blob, e) : null; };
  const text = async p => { const b = await bytes(p); return b ? new TextDecoder().decode(b) : null; };
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const html = s => new DOMParser().parseFromString(s, 'text/html');
  const tag = (doc, name) => [...doc.getElementsByTagName('*')].filter(e => e.localName === name);

  const container = await text('META-INF/container.xml');
  const rootfile = container && tag(xml(container), 'rootfile')[0];
  const opfPath = rootfile && rootfile.getAttribute('full-path');
  const opfSrc = opfPath && await text(opfPath);
  if (!opfSrc) throw new EpubError('This EPUB is missing its package file, so it can’t be read.');
  const opf = xml(opfSrc);
  if (opf.getElementsByTagName('parsererror').length) throw new EpubError('This EPUB’s package file is damaged, so it can’t be read.');

  const manifest = new Map(tag(opf, 'item').map(i => [i.getAttribute('id'), i]));
  const item = id => manifest.get(id);
  const meta = n => textOf(tag(opf, n)[0]);
  const title = meta('title');
  const author = tag(opf, 'creator').map(textOf).filter(Boolean).join(', ');
  const language = meta('language');

  const chapters = [];
  for (const ref of tag(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const it = item(ref.getAttribute('idref'));
    const href = it && it.getAttribute('href');
    const path = href && resolvePath(opfPath, href);
    const e = path && find(path);
    if (!e) continue;
    const mt = it.getAttribute('media-type') || '';
    if (!/html|xml/.test(mt) && !/x?html?$/.test(extOf(e.path))) continue;
    chapters.push({ path: e.path, size: e.size || 1 });
  }
  if (!chapters.length) throw new EpubError('This EPUB has no readable chapters. If it is a comic or manga, Static Manga opens it.');
  const total = chapters.reduce((a, c) => a + c.size, 0) || 1;
  const weights = chapters.map(c => c.size / total);
  const chapterOf = new Map(chapters.map((c, i) => [c.path, i]));

  /* contents: EPUB 3 nav document, else the EPUB 2 NCX */
  const toc = [];
  const addToc = (label, href, base, level) => {
    const path = resolvePath(base, href);
    const ch = path ? chapterOf.get((find(path) || {}).path) : undefined;
    if (ch === undefined || !label) return;
    toc.push({ title: label, chapter: ch, hash: String(href).includes('#') ? String(href).split('#')[1] : '', level });
  };
  const navItem = [...manifest.values()].find(i => /(^|\s)nav(\s|$)/.test(i.getAttribute('properties') || ''));
  const ncxItem = [...manifest.values()].find(i => (i.getAttribute('media-type') || '') === 'application/x-dtbncx+xml');
  if (navItem) {
    const navPath = resolvePath(opfPath, navItem.getAttribute('href'));
    const src = navPath && await text(navPath);
    if (src) {
      const doc = html(src);
      const nav = [...doc.querySelectorAll('nav')].find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || doc.querySelector('nav');
      const walk = (ol, level) => {
        for (const li of ol.children) {
          const a = li.querySelector(':scope > a, :scope > span');
          if (a) addToc(textOf(a), a.getAttribute('href') || '', navPath, level);
          const sub = li.querySelector(':scope > ol');
          if (sub) walk(sub, level + 1);
        }
      };
      const ol = nav && nav.querySelector('ol');
      if (ol) walk(ol, 0);
    }
  }
  if (!toc.length && ncxItem) {
    const ncxPath = resolvePath(opfPath, ncxItem.getAttribute('href'));
    const src = ncxPath && await text(ncxPath);
    if (src) {
      const walk = (parent, level) => {
        for (const np of [...parent.children].filter(c => c.localName === 'navPoint')) {
          const label = textOf(tag(np, 'text')[0]);
          const content = [...np.children].find(c => c.localName === 'content');
          if (content) addToc(label, content.getAttribute('src') || '', ncxPath, level);
          walk(np, level + 1);
        }
      };
      const map = tag(xml(src), 'navMap')[0];
      if (map) walk(map, 0);
    }
  }

  /* the cover the publisher declared: EPUB 3 properties="cover-image", or EPUB 2 <meta name="cover"> */
  const coverItem = (() => {
    const byProp = [...manifest.values()].find(i => /(^|\s)cover-image(\s|$)/.test(i.getAttribute('properties') || ''));
    if (byProp) return byProp;
    const m = tag(opf, 'meta').find(x => x.getAttribute('name') === 'cover');
    return m && item(m.getAttribute('content'));
  })();
  async function coverBlob() {
    const href = coverItem && coverItem.getAttribute('href');
    const p = href && resolvePath(opfPath, href);
    const e = p && find(p);
    if (!e || !IMG_MIME[extOf(e.path)] || e.size > IMG_CAP) return null;
    return new Blob([await entryBytes(blob, e)], { type: IMG_MIME[extOf(e.path)] });
  }

  async function chapterHtml(i) {
    const ch = chapters[i];
    if (!ch) throw new EpubError('There is no such chapter.');
    const src = await text(ch.path);
    if (src == null) throw new EpubError('This chapter’s file is missing from the book.');
    const doc = html(src);
    return clean(doc.body || doc.documentElement, ch.path);
  }

  /* rebuild an element's children from the allow-list */
  async function clean(root, base) {
    const out = document.implementation.createHTMLDocument('');
    const pending = [];
    const walk = (from, into) => {
      for (const n of [...from.childNodes]) {
        if (n.nodeType === 3) { into.appendChild(out.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        const name = n.localName;
        if (DROP.has(name)) {
          /* an SVG that only wraps a picture (a cover page) keeps the picture */
          if (name === 'svg') {
            const im = [...n.getElementsByTagName('*')].find(e => e.localName === 'image');
            if (im) {
              const img = out.createElement('img');
              img.setAttribute('alt', '');
              pending.push(setImage(img, im.getAttribute('href') || im.getAttribute('xlink:href'), base));
              into.appendChild(img);
            }
          }
          continue;
        }
        if (!KEEP.has(name)) { walk(n, into); continue; }
        const el = out.createElement(name);
        for (const a of n.attributes) {
          const an = a.name.toLowerCase();
          if (ATTRS.has(an)) el.setAttribute(an, a.value.slice(0, 2000));
        }
        if (name === 'img') {
          if (!el.hasAttribute('alt')) el.setAttribute('alt', '');
          pending.push(setImage(el, n.getAttribute('src'), base));
        } else if (name === 'a') {
          const href = (n.getAttribute('href') || '').trim();
          if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) el.setAttribute('data-ext', href);
          else if (href.startsWith('#')) el.setAttribute('href', `#${href.slice(1)}`);
          else if (href) {
            const p = resolvePath(base, href);
            const ci = p ? chapterOf.get((find(p) || {}).path) : undefined;
            if (ci !== undefined) { el.setAttribute('data-ch', String(ci)); el.setAttribute('data-hash', href.includes('#') ? href.split('#')[1] : ''); el.setAttribute('href', '#'); }
          }
        }
        walk(n, el);
        into.appendChild(el);
      }
    };
    walk(root, out.body);
    await Promise.all(pending);
    for (const img of [...out.body.querySelectorAll('img')]) if (!img.getAttribute('src')) img.remove();
    return out.body.innerHTML;
  }
  async function setImage(img, src, base) {
    const p = src && resolvePath(base, src);
    const e = p && find(p);
    const mime = e && IMG_MIME[extOf(e.path)];
    if (!e || !mime || e.size > IMG_CAP) return;
    try { img.setAttribute('src', `data:${mime};base64,${b64(await entryBytes(blob, e))}`); } catch (err) { /* the picture is left out */ }
  }

  return { title, author, language, chapters, toc, weights, chapterHtml, coverBlob };
}

export default { openEpub, resolvePath, EpubError };
