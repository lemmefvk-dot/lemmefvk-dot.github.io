/* ============================================================
   flashcards.js (core) — Static Study's decks, spaced-repetition
   scheduler, CSV/TSV import and export. No DOM here.

   Saved in store('portal.flashcards') as
     { v: 1,
       decks: [{ id, name, created, newPerDay, cards: [card] }],
       log:   { 'YYYY-MM-DD': { n, again, hard, good, easy } } }
   a card is
     { id, front, back, img,            img: a ~/Pictures path or ''
       kind, note, cloze, tags,         see "Kinds of card" below
       ease, interval, reps, lapses,    the scheduler's memory
       due, last, first }               'YYYY-MM-DD' / null while new;
                                        first: the day it was first graded
   newPerDay is how many new cards a deck brings in a day (20 unless
   you change it); a card counts against it on the day it is first
   graded. Decks and cards saved before any of these existed load with
   kind 'basic', no tags and 20 a day: their schedules are untouched.

   Kinds of card. Every card is scheduled on its own, so a card made
   from another is never "the same card twice":
     basic   front -> back
     rev     the other way round: back -> front. It shares a `note` id
             with the basic card it was made with, and editing either
             edits both (each keeps its own schedule)
     cloze   front is text with gaps, "The {{mitochondria}} makes ATP";
             each gap is its own card (cloze = which gap it hides), the
             cards of one text share a `note`. {{c2::…}} numbers a gap
             (gaps with one number hide together), {{…::hint}} shows
             the hint in the gap. back is extra text for the answer side.

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
export const KINDS = ['basic', 'rev', 'cloze'];
export const MAX_TAGS = 12;
export const MAX_NEW_PER_DAY = 999;

/** "Bio #Unit-3  cells" -> ['bio', 'unit-3', 'cells']: lower case, no '#', no spaces, each once. */
export function normTags(v) {
  const list = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[\s,]+/);
  const out = [];
  for (const t of list) {
    const k = String(t == null ? '' : t).trim().replace(/^#+/, '').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (k && !out.includes(k) && out.length < MAX_TAGS) out.push(k);
  }
  return out;
}

export function normCard(c) {
  const o = c && typeof c === 'object' ? c : {};
  const ease = Number(o.ease);
  const kind = KINDS.includes(o.kind) ? o.kind : 'basic';
  const cz = Math.floor(Number(o.cloze));
  return {
    id: String(o.id || uid('c')).slice(0, 60),
    front: clean(o.front), back: clean(o.back),
    img: typeof o.img === 'string' ? o.img.slice(0, 300) : '',
    kind, note: typeof o.note === 'string' ? o.note.slice(0, 60) : '',
    cloze: kind === 'cloze' && cz >= 1 && cz <= 99 ? cz : 0,
    tags: normTags(o.tags),
    ease: Number.isFinite(ease) ? Math.max(MIN_EASE, Math.min(4, Math.round(ease * 100) / 100)) : 2.5,
    interval: Math.max(0, Math.floor(Number(o.interval) || 0)),
    reps: Math.max(0, Math.floor(Number(o.reps) || 0)),
    lapses: Math.max(0, Math.floor(Number(o.lapses) || 0)),
    due: parseDay(o.due) ? o.due : null,
    last: parseDay(o.last) ? o.last : null,
    first: parseDay(o.first) ? o.first : null,
  };
}
const perDayOf = v => { const n = Math.floor(Number(v)); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? NEW_PER_SESSION : Math.max(0, Math.min(MAX_NEW_PER_DAY, n)); };
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
  return { id: String(o.id || uid('d')).slice(0, 60), name: clean(o.name, 60) || 'Untitled deck', created: Number(o.created) || Date.now(), newPerDay: perDayOf(o.newPerDay), cards };
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
  /* the day a new card is first graded: what the daily new-card limit counts */
  if (c.due === null && !c.first) c.first = day;
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

/** Today's study queue: every due card (oldest first), then up to `newMax` new ones (NEW_PER_SESSION unless said). */
export function queue(cards, now = Date.now(), newMax = NEW_PER_SESSION) {
  const due = cards.filter(c => isDue(c, now)).sort((a, b) => a.due.localeCompare(b.due));
  const fresh = cards.filter(isNew).slice(0, Math.max(0, newMax));
  return [...due, ...fresh].map(c => c.id);
}
/** New cards first graded today, in a list of cards. */
export const newToday = (cards, now = Date.now()) => { const t = today(now); return cards.filter(c => c.first === t).length; };
/** How many more new cards the deck brings in today: its newPerDay less the ones already started today. */
export const newLeft = (deck, now = Date.now()) => Math.max(0, normDeck(deck).newPerDay - newToday(deck.cards, now));
/** A deck's queue for today, its daily new-card limit applied. `only` narrows it to some cards (a tag). */
export function deckQueue(deck, now = Date.now(), only = null) {
  const cards = only ? deck.cards.filter(only) : deck.cards;
  return queue(cards, now, newLeft(deck, now));
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

/** The last `weeks` whole weeks (Monday first) up to this one, from the log: [[{ day, n, future }] × 7] per week, oldest first. */
export function weekGrid(weeks = 12, now = Date.now(), log = read().log) {
  const t = parseDay(today(now));
  const monday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
  const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (weeks - 1));
  const tk = today(now);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const day = ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
      col.push({ day, n: day > tk ? 0 : (log[day] && log[day].n) || 0, future: day > tk });
    }
    out.push(col);
  }
  return out;
}

/** Cards you keep missing: "Again" at least `min` times (lapses), most first. -> [{ deck, card }] */
export function missed(decks, min = 2) {
  const out = [];
  for (const d of decks) for (const c of d.cards) if (c.lapses >= min) out.push({ deck: d, card: c });
  return out.sort((a, b) => b.card.lapses - a.card.lapses || String(a.card.due || '').localeCompare(String(b.card.due || '')));
}

/* ---------- cloze ---------- */
const GAP_RE = /\{\{([^{}]+?)\}\}/g;
export const hasCloze = text => /\{\{[^{}]*\S[^{}]*\}\}/.test(String(text || ''));
/**
 * A cloze text in pieces: [{ text } | { n, answer, hint }]. "{{c2::x}}" is gap 2;
 * unnumbered gaps take the numbers left over, in order (1, 2, 3 …).
 */
export function clozeParts(text) {
  const s = String(text || '');
  const raw = [];
  let at = 0;
  for (const m of s.matchAll(GAP_RE)) {
    if (m.index > at) raw.push({ text: s.slice(at, m.index) });
    const bits = m[1].split('::');
    let n = 0;
    if (bits.length > 1 && /^c\d{1,2}$/i.test(bits[0].trim())) n = Number(bits.shift().trim().slice(1)) || 0;
    const answer = bits[0].trim(), hint = bits.slice(1).join('::').trim();
    raw.push(answer ? { n, answer, hint } : { text: m[0] });
    at = m.index + m[0].length;
  }
  if (at < s.length) raw.push({ text: s.slice(at) });
  const used = new Set(raw.filter(p => p.n).map(p => p.n));
  let next = 1;
  for (const p of raw) {
    if (p.answer === undefined || p.n) continue;
    while (used.has(next)) next++;
    p.n = Math.min(99, next); used.add(p.n);
  }
  return raw;
}
/** gap number -> the words it hides ("a|b" when one number hides two gaps) */
function gapWords(text) {
  const m = new Map();
  for (const p of clozeParts(text)) if (p.answer !== undefined) m.set(p.n, m.has(p.n) ? `${m.get(p.n)}|${p.answer.toLowerCase()}` : p.answer.toLowerCase());
  return m;
}
/** The gap numbers a cloze text makes cards for, smallest first. */
export const clozeNums = text => [...new Set(clozeParts(text).filter(p => p.answer !== undefined).map(p => p.n))].sort((a, b) => a - b);
/**
 * One side of cloze card `n`, as segments to draw: [{ t, gap }]. The front shows
 * gap n as "[…]" (or "[hint]") and every other gap filled in; the back fills
 * them all and marks gap n.
 */
export function clozeSide(text, n, back) {
  return clozeParts(text).map(p => (p.answer === undefined ? { t: p.text, gap: false }
    : p.n !== n ? { t: p.answer, gap: false }
      : { t: back ? p.answer : `[${p.hint || '…'}]`, gap: true }));
}
export const clozeText = (text, n, back) => clozeSide(text, n, back).map(x => x.t).join('');

/* ---------- making and editing cards ---------- */
/**
 * The cards one entry makes: a cloze text makes one per gap; front/back makes
 * a basic card, and a reverse one too when `reverse`. -> [card] (fresh schedules)
 */
export function makeCards({ front, back, img = '', tags = [], reverse = false } = {}) {
  const f = clean(front), b = clean(back), t = normTags(tags);
  if (hasCloze(f)) {
    const note = uid('n');
    return clozeNums(f).map(n => normCard({ kind: 'cloze', note, cloze: n, front: f, back: b, img, tags: t }));
  }
  if (!reverse) return [normCard({ front: f, back: b, img, tags: t })];
  const note = uid('n');
  return [normCard({ front: f, back: b, img, tags: t, note }), normCard({ kind: 'rev', front: f, back: b, img, tags: t, note })];
}
/** The cards made with this one (itself included): its note's cards, or just itself. */
export const siblings = (deck, card) => (card.note ? deck.cards.filter(c => c.note === card.note) : [card]);
/** Does this card have a reverse card made with it? */
export const hasReverse = (deck, card) => card.kind !== 'cloze' && siblings(deck, card).some(c => c.kind === 'rev' && c.id !== card.id);

/**
 * Edit a card in a deck (in place) — and the cards made with it, each keeping its
 * own schedule. A cloze text that gains a gap gets a new card for it; a gap taken
 * out takes its card with it. `reverse` true/false adds or removes the reverse card
 * of a basic card. -> { ok, added, removed } or { ok:false, error }
 */
export function editCard(deck, cardId, { front, back, img, tags, reverse } = {}) {
  const card = deck.cards.find(c => c.id === cardId);
  if (!card) return { ok: false, error: 'That card isn’t in the deck any more.' };
  const f = front === undefined ? card.front : clean(front);
  const b = back === undefined ? card.back : clean(back);
  const pic = img === undefined ? card.img : String(img || '').slice(0, 300);
  const tg = tags === undefined ? card.tags : normTags(tags);
  const sib = siblings(deck, card);
  let added = 0, removed = 0;
  if (card.kind === 'cloze' || (hasCloze(f) && !hasReverse(deck, card) && card.kind === 'basic')) {
    if (!hasCloze(f)) return { ok: false, error: 'A cloze card needs at least one gap in {{double braces}}.' };
    const note = card.note || uid('n');
    const wasText = card.kind === 'cloze' ? card.front : '';
    if (card.kind !== 'cloze') { card.kind = 'cloze'; card.note = note; card.cloze = 0; }
    const group = deck.cards.filter(c => c.note === note);
    /* each card follows ITS gap: matched by the words it hides, then by number, so
       a gap put in front of the others doesn't hand their schedules round */
    const was = gapWords(wasText), now = gapWords(f);
    const free = new Set(now.keys());
    const place = new Map();
    for (const c of group) { const w = was.get(c.cloze); const hit = [...free].find(n => w !== undefined && now.get(n) === w); if (hit !== undefined) { place.set(c.id, hit); free.delete(hit); } }
    for (const c of group) if (!place.has(c.id) && free.has(c.cloze)) { place.set(c.id, c.cloze); free.delete(c.cloze); }
    if (!place.has(card.id) && free.size) { const n = Math.min(...free); place.set(card.id, n); free.delete(n); }
    for (const c of group) Object.assign(c, { front: f, back: b, img: pic, tags: tg, cloze: place.get(c.id) || 0 });
    const gone = new Set(group.filter(c => !place.has(c.id)).map(c => c.id));
    if (gone.size) { deck.cards = deck.cards.filter(c => !gone.has(c.id)); removed = gone.size; }
    for (const n of [...free].sort((x, y) => x - y)) {
      if (deck.cards.length >= MAX_CARDS) break;
      deck.cards.push(normCard({ kind: 'cloze', note, cloze: n, front: f, back: b, img: pic, tags: tg }));
      added++;
    }
    return { ok: true, added, removed };
  }
  for (const c of sib) Object.assign(c, { front: f, back: b, img: pic, tags: tg });
  if (reverse === true && !hasReverse(deck, card) && card.kind === 'basic' && deck.cards.length < MAX_CARDS) {
    if (!card.note) card.note = uid('n');
    deck.cards.splice(deck.cards.indexOf(card) + 1, 0, normCard({ kind: 'rev', front: f, back: b, img: pic, tags: tg, note: card.note }));
    added++;
  } else if (reverse === false && card.kind === 'basic' && hasReverse(deck, card)) {
    const revs = new Set(sib.filter(c => c.kind === 'rev').map(c => c.id));
    deck.cards = deck.cards.filter(c => !revs.has(c.id));
    removed = revs.size;
  }
  return { ok: true, added, removed };
}

/** What a card asks and answers, whatever its kind: { q, a, qText, aText, qImg, aImg, cloze } (q/a are segments). */
export function faces(card) {
  if (card.kind === 'cloze') {
    const q = clozeSide(card.front, card.cloze, false), a = clozeSide(card.front, card.cloze, true);
    return { q, a, qText: q.map(x => x.t).join(''), aText: a.map(x => x.t).join(''), extra: card.back, qImg: card.img, aImg: '', cloze: true };
  }
  const f = [{ t: card.front, gap: false }], b = [{ t: card.back, gap: false }];
  return card.kind === 'rev'
    ? { q: b, a: f, qText: card.back, aText: card.front, extra: '', qImg: '', aImg: card.img, cloze: false }
    : { q: f, a: b, qText: card.front, aText: card.back, extra: '', qImg: card.img, aImg: '', cloze: false };
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

/* what a line can be split at: a pasted two-column block from a document, a
   "term :: definition" note, a "word - meaning" list, a semicolon CSV */
export const SEPARATORS = [['auto', 'Work it out'], ['\t', 'Tab'], [',', 'Comma'], [';', 'Semicolon'], ['::', '“::”'], ['-', 'A dash ( - )']];
const DASH_RE = /\s+[-–—]\s+/;
/** The separator text most likely uses: a tab, then "::", then a spaced dash, then ";" — a comma otherwise. */
export function guessSeparator(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim()).slice(0, 60);
  if (!lines.length) return ',';
  if (lines[0].includes('\t')) return '\t';
  const most = test => lines.filter(test).length >= Math.ceil(lines.length / 2);
  if (most(l => l.includes('::'))) return '::';
  if (most(l => DASH_RE.test(l)) && !most(l => l.includes(','))) return '-';
  if (most(l => l.includes(';')) && !lines.some(l => l.includes(','))) return ';';
  return ',';
}
/** Rows split at the first "::" or spaced dash on each line (no quoting there). */
function splitLines(text, sep) {
  return String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(l => {
    if (sep === '::') { const i = l.indexOf('::'); return i < 0 ? [l] : [l.slice(0, i), l.slice(i + 2)]; }
    const m = DASH_RE.exec(l);
    return m ? [l.slice(0, m.index), l.slice(m.index + m[0].length)] : [l];
  });
}

/**
 * Cards from text: CSV or TSV (front,back), or lines split at "::", a spaced
 * dash or a semicolon. `sep` is one of SEPARATORS ('auto' guesses). A first row of
 * "front,back" (or question,answer …) is a header and is left out; a header with
 * a third "tags" column reads tags from it. A line with {{gaps}} is a cloze card
 * and needs no back. Rows without both sides, and rows past `room`, are counted
 * in `skipped`, never silently lost.
 * -> { cards: [{front, back, tags}], skipped, delimiter, header }
 */
export function parseImport(text, room = MAX_CARDS, sep = 'auto') {
  const s = String(text || '');
  const delimiter = SEPARATORS.some(([v]) => v === sep) && sep !== 'auto' ? sep : guessSeparator(s);
  let rows = delimiter === '::' || delimiter === '-' ? splitLines(s, delimiter) : parseRows(s, delimiter);
  let header = false, tagCol = -1;
  if (rows.length) {
    const a = clean(rows[0][0]).toLowerCase(), b = clean(rows[0][1]).toLowerCase();
    if (HEADS.some(([x, y]) => x === a && y === b)) {
      header = true;
      tagCol = rows[0].findIndex((x, i) => i > 1 && clean(x).toLowerCase() === 'tags');
      rows = rows.slice(1);
    }
  }
  const cards = [];
  let skipped = 0;
  for (const r of rows) {
    const front = clean(r[0]), back = clean(r[1]);
    if (!front && !back && r.every(x => !String(x).trim())) continue;   /* a blank line is not a card */
    const cz = hasCloze(front);
    if (!front || (!back && !cz) || cards.length >= room) { skipped++; continue; }
    cards.push({ front, back, tags: tagCol > 0 ? normTags(r[tagCol]) : [] });
  }
  return { cards, skipped, delimiter, header };
}

const cellOut = (v, delim) => (/["\n\r\t,]/.test(v) || v !== v.trim() || v.includes(delim) ? `"${v.replace(/"/g, '""')}"` : v);
/** One entry per thing you wrote: a reverse card is its basic card's twin, a cloze text is one entry for all its gaps. */
export function entries(deck) {
  const seen = new Set();
  const out = [];
  for (const c of deck.cards) {
    if (c.note && seen.has(c.note)) continue;
    if (c.note) seen.add(c.note);
    const sib = c.note ? deck.cards.filter(x => x.note === c.note) : [c];
    out.push({ card: c, front: c.front, back: c.back, tags: c.tags, img: c.img, reverse: c.kind !== 'cloze' && sib.some(x => x.kind === 'rev') && sib.some(x => x.kind === 'basic'), cloze: c.kind === 'cloze', n: sib.length });
  }
  return out;
}
/**
 * A deck as CSV text: a "front,back" header (",tags" too when a card has tags), then
 * one row per entry — a cloze text once, a card and its reverse once. Pictures and
 * schedules are not part of it.
 */
export function toCSV(deck, delim = ',') {
  const list = entries(deck);
  const tags = list.some(e => e.tags.length);
  const lines = [`front${delim}back${tags ? `${delim}tags` : ''}`];
  for (const e of list) lines.push(`${cellOut(e.front, delim)}${delim}${cellOut(e.back, delim)}${tags ? `${delim}${cellOut(e.tags.join(' '), delim)}` : ''}`);
  return lines.join('\n') + '\n';
}

/* ---------- a deck in a link ---------- */
/* What travels: the deck's name and, per entry, front, back, tags and whether it has
   a reverse card — never pictures (they are files on this device) or schedules. */
export function packDeck(deck) {
  return { n: deck.name, c: entries(deck).map(e => [e.front, e.back, e.tags.join(' '), e.reverse ? 1 : 0]) };
}
/** A packed deck back, checked field by field -> { name, entries: [{front, back, tags, reverse}], cards: n } or null */
export function unpackDeck(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.c)) return null;
  const list = [];
  for (const r of o.c.slice(0, MAX_CARDS)) {
    if (!Array.isArray(r)) continue;
    const front = clean(r[0]), back = clean(r[1]);
    if (!front || (!back && !hasCloze(front))) continue;
    list.push({ front, back, tags: normTags(r[2]), reverse: r[3] === 1 && !hasCloze(front) });
  }
  if (!list.length) return null;
  let cards = 0;
  for (const e of list) cards += hasCloze(e.front) ? clozeNums(e.front).length : e.reverse ? 2 : 1;
  return { name: clean(o.n, 60) || 'Shared deck', entries: list, cards };
}

export function addDeck(name) {
  const data = read();
  if (data.decks.length >= MAX_DECKS) return null;
  const d = normDeck({ name });
  data.decks.push(d);
  write(data);
  return d;
}

export default { KEY, GRADES, KINDS, NEW_PER_SESSION, MAX_CARDS, normalize, read, write, schedule, intervalText, counts, queue, deckQueue, newLeft, shuffled, review, perDay, weekGrid, missed, parseImport, guessSeparator, parseRows, toCSV, entries, packDeck, unpackDeck, makeCards, editCard, faces, clozeParts, clozeNums, clozeSide, hasCloze, normTags, addDeck, today, addDays, ymd };
