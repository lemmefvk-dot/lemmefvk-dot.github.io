/* ============================================================
   librivox.js — public-domain audiobooks from LibriVox, through archive.org.

   LibriVox's volunteers record books that are out of copyright and give the
   recordings to the public domain; every LibriVox recording is also kept on
   archive.org, which answers browser requests (it sends
   Access-Control-Allow-Origin: *, checked for the search, the metadata and
   the audio files). LibriVox's own API (librivox.org/api) does NOT: it sends
   no CORS header, so a page can't call it, and this module doesn't try.
   Nothing here needs a key or a server of ours.

     search(text, { page, rows, signal }) -> { total, books: [card] }
        card: { id, title, author, runtime, downloads }
        no text = the most listened to
     loadBook(id, { signal })             -> book
        book: { id, title, author, runtime, readers, about, chapters, cover,
                archiveUrl, librivoxUrl }
        chapters: [{ title, url, len }]    len in seconds, or 0 when not stated
     shelf() / remember(book, ch, t) / forget(id)   what you have started, kept for
        this person (the store, portal.audiobooks): chapter and second, never a
        made-up percentage

   Credit: the recordings are LibriVox's and their readers' (shown with each
   book, with links to the LibriVox page and the archive.org page); archive.org
   hosts the files. Only text from archive.org's metadata is shown, as text.
   ============================================================ */
import { store } from './store.js';

const ORIGIN = 'https://archive.org';
const KEY = 'portal.audiobooks';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
export const isId = s => ID.test(String(s || ''));

export class LibriVoxError extends Error {}

async function getJSON(url, signal) {
  let res;
  try { res = await fetch(url, { signal, headers: { Accept: 'application/json' } }); } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new LibriVoxError(typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'You’re offline. Audiobooks come from archive.org, so they need the internet.'
      : 'Couldn’t reach archive.org. It may be down, or this network blocks it.');
  }
  if (!res.ok) throw new LibriVoxError(`archive.org answered with an error (${res.status}). Try again in a minute.`);
  try { return await res.json(); } catch (e) { throw new LibriVoxError('archive.org sent something that wasn’t readable. Try again in a minute.'); }
}

const first = v => (Array.isArray(v) ? v[0] : v);
const str = v => String(first(v) ?? '').trim();

/* Lucene's own punctuation would break the search or change what it means: words only */
const words = s => String(s || '').normalize('NFKD').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function search(text, { page = 1, rows = 24, signal } = {}) {
  const w = words(text);
  const parts = ['collection:librivoxaudio', 'mediatype:audio'];
  if (w) parts.push(`(${w.split(' ').map(x => `(title:${x} OR creator:${x})`).join(' AND ')})`);
  const qs = new URLSearchParams();
  qs.set('q', parts.join(' AND '));
  for (const f of ['identifier', 'title', 'creator', 'runtime', 'downloads']) qs.append('fl[]', f);
  qs.append('sort[]', 'downloads desc');
  qs.set('rows', String(rows));
  qs.set('page', String(page));
  qs.set('output', 'json');
  const d = await getJSON(`${ORIGIN}/advancedsearch.php?${qs}`, signal);
  const r = d && d.response;
  if (!r || !Array.isArray(r.docs)) throw new LibriVoxError('archive.org’s answer wasn’t what was expected. Try again in a minute.');
  return {
    total: Number(r.numFound) || 0,
    books: r.docs.filter(x => isId(x.identifier)).map(x => ({
      id: x.identifier, title: str(x.title) || x.identifier, author: str(x.creator), runtime: str(x.runtime), downloads: Number(x.downloads) || 0,
    })),
  };
}

const PREF = ['64Kbps MP3', 'VBR MP3', '128Kbps MP3'];
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const seconds = v => {
  const s = String(v ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = /^(?:(\d+):)?(\d+):(\d+)$/.exec(s);
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : 0;
};
const encPath = name => String(name).split('/').map(encodeURIComponent).join('/');

/** "<a>LibriVox</a> recording of <i>X</i>, by Y. Read by Z.\n\n…" as plain text, with the readers and the LibriVox page picked out */
function readDescription(html) {
  let text = '', lv = '';
  try {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    for (const a of doc.querySelectorAll('a[href]')) {
      const m = /^https?:\/\/librivox\.org\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)\/?$/i.exec(a.getAttribute('href') || '');
      if (m && !/^(about|api|forum|catalog|search)\b/i.test(m[1]) && !lv) lv = `https://librivox.org/${m[1]}/`;
    }
    for (const br of doc.querySelectorAll('br')) br.replaceWith('\n');
    for (const p of doc.querySelectorAll('p,div')) p.append('\n');
    text = doc.body.textContent.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) { text = ''; }
  const rd = /\bRead by ([^\n.]{2,120})/i.exec(text) || /\bReaders?: ([^\n.]{2,120})/i.exec(text);
  const cut = text.split(/\n\s*\n/).slice(1).filter(p => !/For further information|visit LibriVox|Download M4B|^LibriVox recording/i.test(p));
  return { readers: rd ? rd[1].trim() : '', about: cut.join('\n\n').slice(0, 900), librivoxUrl: lv };
}

const cache = new Map();
export async function loadBook(id, { signal } = {}) {
  if (!isId(id)) throw new LibriVoxError('That isn’t a valid audiobook address.');
  if (cache.has(id)) return cache.get(id);
  const d = await getJSON(`${ORIGIN}/metadata/${encodeURIComponent(id)}`, signal);
  const m = d && d.metadata;
  if (!m || !Array.isArray(d.files)) throw new LibriVoxError('That audiobook couldn’t be found on archive.org.');
  const format = PREF.find(f => d.files.some(x => x.format === f && /\.mp3$/i.test(x.name || '')));
  const files = d.files.filter(x => x.format === format && /\.mp3$/i.test(x.name || ''))
    .sort((a, b) => (parseInt(a.track, 10) || 0) - (parseInt(b.track, 10) || 0) || collator.compare(a.name, b.name));
  if (!files.length) throw new LibriVoxError('This recording has no chapter files that a browser can play.');
  const info = readDescription(first(m.description));
  const book = {
    id,
    title: str(m.title) || id,
    author: str(m.creator),
    runtime: str(m.runtime),
    readers: info.readers,
    about: info.about,
    chapters: files.map((f, i) => ({
      title: str(f.title) || String(f.name).replace(/\.[^.]+$/, '') || `Chapter ${i + 1}`,
      url: `${ORIGIN}/download/${encodeURIComponent(id)}/${encPath(f.name)}`,
      len: seconds(f.length),
    })),
    cover: `${ORIGIN}/services/img/${encodeURIComponent(id)}`,
    archiveUrl: `${ORIGIN}/details/${encodeURIComponent(id)}`,
    librivoxUrl: info.librivoxUrl,
  };
  cache.set(id, book);
  return book;
}

/* ---- what you have started (per person, through the store) ---- */
const read = () => (store.get(KEY) || {}).shelf || {};
const write = shelf => store.set(KEY, { ...(store.get(KEY) || {}), shelf });

/** Started books, most recent first: [{ id, title, author, ch, t, done, at, chapters }] */
export const shelf = () => Object.entries(read()).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.at || 0) - (a.at || 0));
export const placeOf = id => read()[id] || null;
export function remember(book, ch, t, done = false) {
  const s = read();
  write({ ...s, [book.id]: { title: book.title, author: book.author, chapters: book.chapters.length, ch, t: Math.max(0, Math.floor(t || 0)), done: !!done, at: Date.now() } });
}
export function forget(id) { const s = { ...read() }; delete s[id]; write(s); }

export default { search, loadBook, shelf, placeOf, remember, forget, isId, LibriVoxError };
