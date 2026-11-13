/* ============================================================
   books.js (core) — Static Study's reading list. No DOM here.

   Saved in store('portal.books') as
     { v: 1, books: [{ id, title, author, unit, total, pos, status,
                       notes, finished, added }] }
   Everything in a book is what the person typed: there is no look-up,
   no cover art (a book's tile is a colour made from its title, below)
   and no figure that is not worked out from these fields.

     unit      'pages' or 'chapters'
     total     how many there are (0 = not known)
     pos       the page or chapter you are on (0 = not started)
     status    'want' | 'reading' | 'finished'
     finished  'YYYY-MM-DD', or '' (only kept for a finished book)

   Progress is pos / total as a whole percent, rounded down, and only
   when the total is known — otherwise the book shows its position and
   no percentage. A position is never above the total.
   ============================================================ */
import { store } from './store.js';

export const KEY = 'portal.books';
export const MAX_BOOKS = 500;
export const STATUS = [['want', 'Want to read'], ['reading', 'Reading'], ['finished', 'Finished']];
export const UNITS = [['pages', 'pages'], ['chapters', 'chapters']];
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = n => String(n).padStart(2, '0');

export const uid = () => `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const today = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const validDay = s => {
  const m = DAY_RE.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
};
const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const count = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 0; };

/** One book, cleaned. null when it has no title. */
export function norm(b) {
  const o = b && typeof b === 'object' ? b : {};
  const title = text(o.title, 200);
  if (!title) return null;
  const status = STATUS.some(([v]) => v === o.status) ? o.status : 'want';
  const total = count(o.total);
  let pos = count(o.pos);
  if (total && pos > total) pos = total;
  return {
    id: String(o.id || uid()).slice(0, 60), title, author: text(o.author, 120),
    unit: o.unit === 'chapters' ? 'chapters' : 'pages', total, pos, status,
    notes: String(o.notes == null ? '' : o.notes).replace(/\r\n?/g, '\n').trim().slice(0, 4000),
    finished: status === 'finished' && validDay(o.finished) ? o.finished : '',
    added: Number(o.added) || Date.now(),
  };
}
export function normalize(raw) {
  const list = raw && typeof raw === 'object' && Array.isArray(raw.books) ? raw.books : [];
  const seen = new Set();
  const books = [];
  for (const b of list) {
    const n = norm(b);
    if (!n || seen.has(n.id) || books.length >= MAX_BOOKS) continue;
    seen.add(n.id); books.push(n);
  }
  return { v: 1, books };
}
export const read = () => normalize(store.get(KEY)).books;
export const write = books => { const out = normalize({ books }); store.set(KEY, JSON.parse(JSON.stringify(out))); return out.books; };

/** Problems with a draft that block saving. -> [{ at, text }] */
export function issues(d, books = read()) {
  const o = d || {};
  const out = [];
  if (!text(o.title, 200)) out.push({ at: 'title', text: 'Give the book a title.' });
  for (const [k, label] of [['total', 'total'], ['pos', 'position']]) {
    const raw = String(o[k] == null ? '' : o[k]).trim();
    if (raw && !/^\d+$/.test(raw)) out.push({ at: k, text: `The ${label} has to be a whole number, or empty.` });
  }
  const total = count(o.total), pos = count(o.pos);
  if (total && pos > total) out.push({ at: 'pos', text: `You can’t be past the end: the total is ${total}.` });
  if (o.status === 'finished' && o.finished && !validDay(o.finished)) out.push({ at: 'finished', text: 'Pick the day you finished.' });
  if (!o.id && books.length >= MAX_BOOKS) out.push({ at: 'title', text: `The list holds up to ${MAX_BOOKS} books.` });
  return out;
}

/** Whole-percent progress, or null when the total isn't known. */
export const percent = b => (b.total ? Math.min(100, Math.floor(b.pos / b.total * 100)) : null);
const one = u => (u === 'chapters' ? 'chapter' : 'page');
/** "Page 120 of 300 · 40%", "Chapter 3", "Not started". */
export function progressText(b) {
  if (b.status === 'finished') return b.total ? `Finished · ${b.total} ${b.unit}` : 'Finished';
  if (!b.pos) return b.total ? `Not started · ${b.total} ${b.unit}` : 'Not started';
  const p = percent(b);
  return `${one(b.unit)[0].toUpperCase()}${one(b.unit).slice(1)} ${b.pos}${b.total ? ` of ${b.total}` : ''}${p === null ? '' : ` · ${p}%`}`;
}

/** The colour tile for a title: a hue from its letters, and one or two initials. No art, nothing looked up. */
export function tile(title) {
  const t = String(title || '').trim();
  let hsh = 0;
  for (const ch of t.toLowerCase()) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
  const words = t.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
  const cp = w => [...w];
  const initials = (words.length > 1 ? cp(words[0])[0] + cp(words[1])[0] : cp(words[0] || t).slice(0, 2).join('')).toUpperCase();
  const hue = hsh % 360;
  return { hue, initials: cp(initials).slice(0, 2).join(''), bg: `linear-gradient(150deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 28%))` };
}

/** The list for a tab: newest-added first; finished books by finish date. */
export function view(books, status) {
  const list = status && status !== 'all' ? books.filter(b => b.status === status) : books.slice();
  if (status === 'finished') return list.sort((a, b) => (b.finished || '').localeCompare(a.finished || '') || b.added - a.added);
  return list.sort((a, b) => b.added - a.added);
}
export const counts = books => ({ all: books.length, want: books.filter(b => b.status === 'want').length, reading: books.filter(b => b.status === 'reading').length, finished: books.filter(b => b.status === 'finished').length });

export default { KEY, STATUS, UNITS, norm, normalize, read, write, issues, percent, progressText, tile, view, counts, today, validDay, uid };
