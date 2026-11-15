/* ============================================================
   notesmeta.js — what Notes works out from your notes, with no DOM:
   #tags, [[links]] between notes and who links where, sorting and
   pins, when a note was made, the daily note, templates, the lines
   that become tasks or flashcards, find and replace inside runs, and
   reading time. Notes (js/apps/notes.js, notestools.js) draws it all.

   TAGS are words that start with # in a note's text: "#biology",
   "#year-9", "#maths/algebra". A tag needs a letter in it (so "#1" and
   "#2026" are just numbers) and starts after a space, a bracket or the
   start of a line (so a web address's "#section" is not one). Tags
   are matched without case or accents: #Café and #cafe are one tag,
   shown the way it was first written.

   LINKS: [[Another note]] points at the note with that title (case and
   accents aside). Two notes with one title make a link ambiguous; it
   goes to the one edited last, and Notes warns about the pair.

   WHEN A NOTE WAS MADE is its `ctime`. Notes made before ctime existed
   carry the moment in their id (note-<base36 ms>-…) when Notes, Lens,
   the Terminal or Clipboard made them; others have no known date and
   say so — nothing is guessed.

   READING TIME is the words at 200 a minute, rounded — an estimate
   at a stated rate, and Notes says that rate where it shows one.
   ============================================================ */
import { fold } from './textindex.js';
import { noteText, runsText, mergeRuns, serialize, rowOf, blocksOf } from './notesfmt.js';

export const WPM = 200;
export const LINK_MAX = 120;
const TAG_RE = /(^|[\s([{])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]{0,39})/gu;
const LINK_RE = /\[\[([^[\]\n]{1,120})\]\]/g;
const HEXISH = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const key = s => fold(String(s || '').replace(/\s+/g, ' ').trim());
/* a note's words, worked out again only when its body changes (the list asks often) */
const memo = new WeakMap();
function textOf(n) {
  if (!n || typeof n !== 'object') return '';
  const m = memo.get(n);
  if (m && m.body === n.body && m.fmt === n.fmt) return m.text;
  const text = noteText(n);
  memo.set(n, { body: n.body, fmt: n.fmt, text, tags: null, links: null });
  return text;
}
const cached = (n, k, make) => { textOf(n); const m = memo.get(n); if (!m) return make(); if (m[k] === null || m.title !== n.title) { m.title = n.title; m.tags = null; m.links = null; m[k] = make(); } return m[k]; };
export const isTrashed = n => !!(n && n.trashed);
export const live = list => (list || []).filter(n => n && !n.trashed);
const titleOf = n => String((n && n.title) || '').trim();

/* ---------- tags ---------- */
/** The tags in some text, in order, once each: [{ tag, key }]. */
export function tagsIn(text) {
  const out = [], seen = new Set();
  for (const m of String(text || '').matchAll(TAG_RE)) {
    const tag = m[2].replace(/[-/]+$/, '');
    if (!/\p{L}/u.test(tag) || (HEXISH.test(tag) && /\d/.test(tag))) continue;
    const k = fold(tag);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ tag, key: k });
  }
  return out;
}
export const tagsOf = n => cached(n, 'tags', () => tagsIn(`${titleOf(n)}\n${textOf(n)}`));
/** Every tag across notes (the Trash left out): [{ tag, key, count }], most used first. */
export function allTags(notes) {
  const by = new Map();
  for (const n of live(notes)) {
    for (const t of tagsOf(n)) {
      const e = by.get(t.key);
      if (e) e.count++; else by.set(t.key, { tag: t.tag, key: t.key, count: 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
export const hasTag = (n, k) => tagsOf(n).some(t => t.key === k);

/* ---------- links between notes ---------- */
/** [[titles]] in some text, in order, once each (as written, trimmed). */
export function linksIn(text) {
  const out = [], seen = new Set();
  for (const m of String(text || '').matchAll(LINK_RE)) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    const k = key(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
/** The note a title points at: same title (case and accents aside), the
    one edited last when there are two. The Trash is left out. */
export function byTitle(notes, title) {
  const k = key(title);
  if (!k) return null;
  let best = null;
  for (const n of live(notes)) {
    if (n.path || key(n.title) !== k) continue;
    if (!best || new Date(n.mtime) > new Date(best.mtime)) best = n;
  }
  return best;
}
/** Notes that link to this one with [[its title]]. */
export function linkedFrom(notes, note) {
  const k = key(note && note.title);
  if (!k) return [];
  return live(notes).filter(n => n.id !== note.id && !n.path && cached(n, 'links', () => linksIn(textOf(n))).some(t => key(t) === k))
    .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}
/** Other notes with the same title (the Trash and the default "Untitled note" left out). */
export function sameTitle(notes, note) {
  const k = key(note && note.title);
  if (!k || k === key('Untitled note')) return [];
  return live(notes).filter(n => n.id !== note.id && !n.path && key(n.title) === k);
}

/* ---------- when it was made, and the order of the list ---------- */
const ID_TIME = /^note-([0-9a-z]{6,10})-/;
const EARLIEST = Date.UTC(2015, 0, 1);
/** ms when the note was made, or null when that isn't known. */
export function created(n, now = Date.now()) {
  if (!n) return null;
  const c = Date.parse(n.ctime);
  if (Number.isFinite(c)) return c;
  const m = ID_TIME.exec(String(n.id || ''));
  if (m) {
    const t = parseInt(m[1], 36);
    if (t >= EARLIEST && t <= now + 86400000) return t;
  }
  return null;
}
export const SORTS = [
  ['edited', 'Last edited'],
  ['created', 'Date created'],
  ['title', 'Title'],
];
const coll = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
/** Pinned first, then by `by`. Notes with no known creation date go last under 'created'. */
export function sortNotes(list, by = 'edited') {
  const mt = n => new Date(n.mtime).getTime() || 0;
  const cmp = {
    edited: (a, b) => mt(b) - mt(a),
    created: (a, b) => {
      const ca = created(a), cb = created(b);
      if (ca === null || cb === null) return (ca === null) - (cb === null) || mt(b) - mt(a);
      return cb - ca;
    },
    title: (a, b) => (coll ? coll.compare(titleOf(a) || 'Untitled note', titleOf(b) || 'Untitled note') : titleOf(a).localeCompare(titleOf(b))) || mt(b) - mt(a),
  }[by] || ((a, b) => mt(b) - mt(a));
  return [...list].sort((a, b) => (!!b.pinned - !!a.pinned) || cmp(a, b));
}

/* ---------- days ---------- */
const pad = n => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const longDate = (d = new Date()) => d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
export const shortDate = (d = new Date()) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
/** The daily note for a day: the note made as that day's note (its `daily`). */
export const dailyNote = (notes, day) => live(notes).find(n => n.daily === day) || null;

/* ---------- templates ---------- */
const P = text => ({ t: 'p', runs: text ? [{ text, b: false, i: false }] : [] });
const H = (lv, text) => ({ t: `h${lv}`, runs: [{ text, b: false, i: false }] });
const L = (t, text, extra = {}) => ({ t, runs: text ? [{ text, b: false, i: false }] : [], ...extra });
const B = (label, rest = '') => ({ t: 'p', runs: [{ text: label, b: true, i: false }, ...(rest ? [{ text: rest, b: false, i: false }] : [])] });
const cell = text => (text ? [{ text, b: false, i: false }] : []);
/* each template: its name, a line about it, and its blocks for a day */
export const TEMPLATES = [
  {
    id: 'cornell', name: 'Cornell notes', about: 'Cues on the left, notes on the right, a summary under them',
    title: d => `Cornell notes — ${shortDate(d)}`,
    blocks: d => [
      B('Topic: '), B('Date: ', longDate(d)),
      rowOf([cell('Cues and questions'), cell('Notes')]),
      rowOf([cell(''), cell('')]), rowOf([cell(''), cell('')]), rowOf([cell(''), cell('')]),
      H(2, 'Summary'), P('In a few sentences, what was this about?'),
    ],
  },
  {
    id: 'lecture', name: 'Lecture', about: 'Course, key points, terms and what to ask',
    title: d => `Lecture — ${shortDate(d)}`,
    blocks: d => [
      B('Course: '), B('Date: ', longDate(d)), B('Topic: '),
      H(2, 'Key points'), L('ul', ''),
      H(2, 'Terms'), P('term :: what it means'),
      H(2, 'Questions to ask'), L('check', '', { done: false }),
      H(2, 'Summary'), P(''),
    ],
  },
  {
    id: 'meeting', name: 'Meeting', about: 'Who came, the agenda, decisions and action items',
    title: d => `Meeting — ${shortDate(d)}`,
    blocks: d => [
      B('Date: ', longDate(d)), B('Who came: '),
      H(2, 'Agenda'), L('ol', ''),
      H(2, 'Notes'), P(''),
      H(2, 'Decisions'), L('ul', ''),
      H(2, 'Action items'), L('check', '', { done: false }),
    ],
  },
  {
    id: 'reading', name: 'Reading', about: 'A book or article: summary, quotes, ideas and words',
    title: d => `Reading notes — ${shortDate(d)}`,
    blocks: () => [
      B('Title: '), B('Author: '), B('Pages or chapters: '),
      H(2, 'Summary'), P(''),
      H(2, 'Quotes'), L('quote', ''),
      H(2, 'Big ideas'), L('ul', ''),
      H(2, 'New words'), P('word :: what it means'),
      H(2, 'Questions'), L('check', '', { done: false }),
    ],
  },
];
export const template = id => TEMPLATES.find(t => t.id === id) || null;
export const templateBody = (id, d = new Date()) => { const t = template(id); return t ? serialize(t.blocks(d)) : ''; };

/* ---------- lines that become something else ---------- */
const TEXTY = new Set(['p', 'ul', 'ol', 'check', 'quote', 'h1', 'h2', 'h3']);
/** Checklist lines: [{ i, text, done }]. */
export const checklist = blocks => (blocks || []).map((b, i) => ({ b, i })).filter(x => x.b.t === 'check')
  .map(x => ({ i: x.i, text: runsText(x.b.runs).replace(/\s+/g, ' ').trim(), done: !!x.b.done })).filter(x => x.text);
const CARD_RE = /^(.+?)\s*::\s*(.+)$/;
/** "term :: definition" lines: [{ i, front, back }]. */
export function cardLines(blocks) {
  const out = [];
  (blocks || []).forEach((b, i) => {
    if (!TEXTY.has(b.t)) return;
    const m = CARD_RE.exec(runsText(b.runs).replace(/\s+/g, ' ').trim());
    if (m && m[1].trim() && m[2].trim()) out.push({ i, front: m[1].trim(), back: m[2].trim() });
  });
  return out;
}

/* ---------- find and replace, on runs ---------- */
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Every match of q in each block's text: [{ i, o, len }]. Case and accents are
    ignored unless `exact`; fold() keeps lengths, so offsets are the real ones. */
export function findIn(blocks, q, { exact = false } = {}) {
  const want = exact ? String(q || '') : fold(String(q || ''));
  if (!want) return [];
  const re = new RegExp(esc(want), 'g');
  const out = [];
  (blocks || []).forEach((b, i) => {
    if (b.t === 'img' || b.t === 'hr' || b.sep) return;
    const text = runsText(b.runs);
    const hay = exact ? text : fold(text);
    for (const m of hay.matchAll(re)) out.push({ i, o: m.index, len: m[0].length });
  });
  return out;
}
/** runs with [at, at+len) replaced by `text`, which takes the marks of what it replaces. */
export function replaceRuns(runs, at, len, text) {
  const head = [], tail = [];
  let pos = 0, mark = null;
  for (const r of runs || []) {
    const a = pos, z = pos + r.text.length;
    pos = z;
    if (z <= at) { head.push({ ...r }); continue; }
    if (a >= at + len) { tail.push({ ...r }); continue; }
    if (!mark) mark = r;
    if (a < at) head.push({ ...r, text: r.text.slice(0, at - a) });
    if (z > at + len) tail.push({ ...r, text: r.text.slice(at + len - a) });
  }
  const m = mark || tail[0] || head[head.length - 1] || { b: false, i: false };
  return mergeRuns([...head, ...(text ? [{ text, b: !!m.b, i: !!m.i }] : []), ...tail]);
}
/** Replace every match (or one: { only: index into the matches }) in the blocks, in place. -> how many. */
export function replaceIn(blocks, q, text, { exact = false, only = null } = {}) {
  const hits = findIn(blocks, q, { exact });
  const pick = only === null ? hits : hits[only] ? [hits[only]] : [];
  const clean = String(text || '').replace(/\n/g, ' ');
  /* from the end, so earlier offsets stay right */
  for (const x of [...pick].reverse()) {
    const b = blocks[x.i];
    b.runs = replaceRuns(b.runs, x.o, x.len, b.t === 'row' ? clean.replace(/\t/g, ' ') : clean);
  }
  return pick.length;
}

/* ---------- reading time ---------- */
/** Whole minutes at WPM, at least 1 for any words, 0 for none. */
export const readMinutes = words => (words > 0 ? Math.max(1, Math.round(words / WPM)) : 0);

/** The text of a note as it is read aloud or sent to a model: one line per block, cells apart. */
export const spoken = blocks => (blocks || []).map(b => (b.t === 'img' || b.t === 'hr' || b.sep ? '' : runsText(b.runs).replace(/\t/g, ' · '))).join('\n');
export const textForAI = n => spoken(blocksOf(n));

export default {
  WPM, key, isTrashed, live, tagsIn, tagsOf, allTags, hasTag, linksIn, byTitle, linkedFrom, sameTitle, created, SORTS, sortNotes,
  dayKey, longDate, shortDate, dailyNote, TEMPLATES, template, templateBody, checklist, cardLines, findIn, replaceRuns, replaceIn, readMinutes, spoken, textForAI,
};
