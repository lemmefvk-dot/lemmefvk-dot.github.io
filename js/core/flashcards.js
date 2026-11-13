/* ============================================================
   flashcards.js (core) — Static Study's decks, spaced-repetition
   scheduler, CSV/TSV import and export. No DOM here.

   Saved in store('portal.flashcards') as
     { v: 1,
       decks: [{ id, name, created, cards: [card] }],
       log:   { 'YYYY-MM-DD': { n, again, hard, good, easy } } }
   a card is
     { id, front, back, img,            img: a ~/Pictures path or ''
       ease, interval, reps, lapses,    the scheduler's memory
       due, last }                      'YYYY-MM-DD' / null while new

   Scheduling is SM-2 in the shape Anki popularised (the numbers are
   shown in the app, so they are written down here too):
     Again  q=1  reps -> 0, lapses +1, ease -0.20 (floor 1.30),
                 interval 0: it is due again today, and the session
                 shows it once more before it ends
     Hard   q=3  ease -0.14      Good q=4  ease +0.00      Easy q=5  ease +0.10
                 ease' = ease + 0.1 - (5-q)(0.08 + (5-q)(0.02)), floor 1.30
     a pass is the n-th in a row (n = reps + 1):
       n = 1   Hard 1 day   Good 1 day    Easy 3 days
       n = 2   Hard 3 days  Good 6 days   Easy 8 days
       n >= 3  Hard max(I+1, round(I*1.2))
               Good max(I+1, round(I*ease'))
               Easy max(I+1, round(I*ease'*1.3))     I = previous interval
   Dates are the computer's own calendar days, so "due today" is
   every card whose due day is today or earlier.

   Every count shown anywhere comes from the cards and the review
   log below; the log gets one entry per real grade in a real
   study session (cram mode writes nothing).
   ============================================================ */
import { store } from './store.js';
import { bus } from './bus.js';

export const KEY = 'portal.flashcards';
export const GRADES = ['again', 'hard', 'good', 'easy'];
export const NEW_PER_SESSION = 20;
export const MAX_CARDS = 2000;       /* per deck */
export const MAX_DECKS = 100;
export const MATURE_DAYS = 21;
const TEXT_MAX = 1000;
const MIN_EASE = 1.3;
const LOG_DAYS = 800;

export const uid = p => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/* ---------- days ---------- */
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const parseDay = s => { const m = DAY_RE.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
export const today = (now = Date.now()) => ymd(new Date(now));
export function addDays(day, n) {
  const d = parseDay(day) || new Date();
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);

/* ---------- shapes ---------- */
const clean = (v, max = TEXT_MAX) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max);
export function normCard(c) {
  const o = c && typeof c === 'object' ? c : {};
  const ease = Number(o.ease);
  return {
    id: String(o.id || uid('c')).slice(0, 60),
    front: clean(o.front), back: clean(o.back),
    img: typeof o.img === 'string' ? o.img.slice(0, 300) : '',
    ease: Number.isFinite(ease) ? Math.max(MIN_EASE, Math.min(4, Math.round(ease * 100) / 100)) : 2.5,
    interval: Math.max(0, Math.floor(Number(o.interval) || 0)),
    reps: Math.max(0, Math.floor(Number(o.reps) || 0)),
    lapses: Math.max(0, Math.floor(Number(o.lapses) || 0)),
    due: parseDay(o.due) ? o.due : null,
    last: parseDay(o.last) ? o.last : null,
  };
}
export function normDeck(d) {
  const o = d && typeof d === 'object' ? d : {};
  const seen = new Set();
  const cards = [];
  for (const c of Array.isArray(o.cards) ? o.cards : []) {
    const n = normCard(c);
    if ((!n.front && !n.img) || seen.has(n.id) || cards.length >= MAX_CARDS) continue;
    seen.add(n.id);
    cards.push(n);
  }
  return { id: String(o.id || uid('d')).slice(0, 60), name: clean(o.name, 60) || 'Untitled deck', created: Number(o.created) || Date.now(), cards };
}
function normLog(l) {
  const out = {};
  const days = Object.keys(l && typeof l === 'object' ? l : {}).filter(k => parseDay(k)).sort().slice(-LOG_DAYS);
  for (const k of days) {
    const e = l[k] || {};
    const f = x => Math.max(0, Math.floor(Number(x) || 0));
    const rec = { again: f(e.again), hard: f(e.hard), good: f(e.good), easy: f(e.easy) };
    rec.n = rec.again + rec.hard + rec.good + rec.easy;
    if (rec.n) out[k] = rec;
  }
  return out;
}
export function normalize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const decks = [];
  for (const d of Array.isArray(o.decks) ? o.decks : []) {
    const n = normDeck(d);
    if (seen.has(n.id) || decks.length >= MAX_DECKS) continue;
    seen.add(n.id);
    decks.push(n);
  }
  return { v: 1, decks, log: normLog(o.log) };
}
const copy = d => JSON.parse(JSON.stringify(d));

export const read = () => normalize(store.get(KEY));
/** Save (always a fresh copy: store.set ignores the same object twice). */
export function write(data) {
  const out = copy(normalize(data));
  store.set(KEY, out);
  return out;
}

/* ---------- the scheduler ---------- */
const Q = { hard: 3, good: 4, easy: 5 };
const FIRST = { hard: 1, good: 1, easy: 3 };
const SECOND = { hard: 3, good: 6, easy: 8 };

/** What grading `card` would do, without doing it: the card as it would become. */
export function schedule(card, grade, now = Date.now()) {
  const c = normCard(card);
  const day = today(now);
  if (grade === 'again') {
    return { ...c, reps: 0, lapses: c.lapses + 1, ease: Math.max(MIN_EASE, Math.round((c.ease - 0.2) * 100) / 100), interval: 0, due: day, last: day };
  }
  const q = Q[grade];
  if (!q) throw new Error(`unknown grade: ${grade}`);
  const ease = Math.max(MIN_EASE, Math.round((c.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)) * 100) / 100);
  const n = c.reps + 1;
  let interval;
  if (n === 1) interval = FIRST[grade];
  else if (n === 2) interval = SECOND[grade];
  else {
    const I = c.interval;
    const raw = grade === 'hard' ? I * 1.2 : grade === 'good' ? I * ease : I * ease * 1.3;
    interval = Math.max(I + 1, Math.round(raw));
  }
  return { ...c, reps: n, ease, interval, due: addDays(day, interval), last: day };
}

/** "<1 day" / "1 day" / "6 days" / "2 months" — how far off grading would put the card. */
export function intervalText(days) {
  if (days < 1) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) { const m = Math.round(days / 30); return `${m} month${m === 1 ? '' : 's'}`; }
  const y = Math.round(days / 36.5) / 10;
  return `${y} year${y === 1 ? '' : 's'}`;
}

export const isNew = c => c.due === null;
export const isDue = (c, now = Date.now()) => c.due !== null && c.due <= today(now);
export const isLearned = c => c.due !== null && c.reps >= 1;
export const isMature = c => isLearned(c) && c.interval >= MATURE_DAYS;

/** { total, due, fresh, learned, mature } for a deck's cards, at `now`. */
export function counts(cards, now = Date.now()) {
  return {
    total: cards.length,
    due: cards.filter(c => isDue(c, now)).length,
    fresh: cards.filter(isNew).length,
    learned: cards.filter(isLearned).length,
    mature: cards.filter(isMature).length,
  };
}

/** Today's study queue: every due card (oldest first), then up to NEW_PER_SESSION new ones. */
export function queue(cards, now = Date.now()) {
  const due = cards.filter(c => isDue(c, now)).sort((a, b) => a.due.localeCompare(b.due));
  const fresh = cards.filter(isNew).slice(0, NEW_PER_SESSION);
  return [...due, ...fresh].map(c => c.id);
}

/** Cram: every card, shuffled. Touches nothing. */
export function shuffled(cards, rnd = Math.random) {
  const a = cards.map(c => c.id);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Grade a card for real: writes its new schedule and one review into the log. -> the new card or null */
export function review(deckId, cardId, grade, now = Date.now()) {
  const data = read();
  const deck = data.decks.find(d => d.id === deckId);
  const i = deck ? deck.cards.findIndex(c => c.id === cardId) : -1;
  if (i < 0) return null;
  const next = schedule(deck.cards[i], grade, now);
  deck.cards[i] = next;
  const day = today(now);
  const rec = data.log[day] || { n: 0, again: 0, hard: 0, good: 0, easy: 0 };
  rec[grade]++;
  rec.n++;
  data.log[day] = rec;
  write(data);
  bus.emit('flashcards:review', { deckId, cardId, grade });      /* the Achievements count real reviews */
  return next;
}

/** The last `days` days, oldest first: [{ day, n }] — from the log only. */
export function perDay(days = 14, now = Date.now(), log = read().log) {
  const out = [];
  const t = today(now);
  for (let k = days - 1; k >= 0; k--) { const day = addDays(t, -k); out.push({ day, n: (log[day] && log[day].n) || 0 }); }
  return out;
}

/* ---------- import / export ---------- */
/** Split delimited text into rows (quotes may hold the delimiter and line breaks). */
export function parseRows(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false, any = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') { q = true; any = true; }
    else if (ch === delim) { row.push(cell); cell = ''; any = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      if (any || cell !== '' || row.length) { row.push(cell); rows.push(row); }
      row = []; cell = ''; any = false;
    } else { cell += ch; any = true; }
  }
  if (any || cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADS = [['front', 'back'], ['question', 'answer'], ['term', 'definition'], ['word', 'meaning']];

/**
 * Cards from CSV or TSV text (front,back). The delimiter is a tab when the
 * first line has one, else a comma. A first row of "front,back" (or
 * question,answer …) is a header and is left out. Rows without both sides,
 * and rows past MAX_CARDS, are counted in `skipped`, never silently lost.
 * -> { cards: [{front, back}], skipped, delimiter, header }
 */
export function parseImport(text, room = MAX_CARDS) {
  const s = String(text || '');
  const first = s.split(/\r?\n/, 1)[0] || '';
  const delimiter = first.includes('\t') ? '\t' : ',';
  let rows = parseRows(s, delimiter);
  let header = false;
  if (rows.length) {
    const a = clean(rows[0][0]).toLowerCase(), b = clean(rows[0][1]).toLowerCase();
    if (HEADS.some(([x, y]) => x === a && y === b)) { header = true; rows = rows.slice(1); }
  }
  const cards = [];
  let skipped = 0;
  for (const r of rows) {
    const front = clean(r[0]), back = clean(r[1]);
    if (!front && !back && r.every(x => !String(x).trim())) continue;   /* a blank line is not a card */
    if (!front || !back || cards.length >= room) { skipped++; continue; }
    cards.push({ front, back });
  }
  return { cards, skipped, delimiter, header };
}

const cellOut = (v, delim) => (/["\n\r\t,]/.test(v) || v !== v.trim() || v.includes(delim) ? `"${v.replace(/"/g, '""')}"` : v);
/** A deck as CSV text: a "front,back" header, then one row per card. Pictures and schedules are not part of it. */
export function toCSV(deck, delim = ',') {
  const lines = [`front${delim}back`];
  for (const c of deck.cards) lines.push(`${cellOut(c.front, delim)}${delim}${cellOut(c.back, delim)}`);
  return lines.join('\n') + '\n';
}

export function addDeck(name) {
  const data = read();
  if (data.decks.length >= MAX_DECKS) return null;
  const d = normDeck({ name });
  data.decks.push(d);
  write(data);
  return d;
}

export default { KEY, GRADES, NEW_PER_SESSION, MAX_CARDS, normalize, read, write, schedule, intervalText, counts, queue, shuffled, review, perDay, parseImport, parseRows, toCSV, addDeck, today, addDays, ymd };
