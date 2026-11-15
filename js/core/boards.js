/* ============================================================
   boards.js (core) — Static Board's data, for what reads it without
   Board's window open, and the formats Board reads and writes:

     dueCards()       cards with a due date, for Calendar's Board layer
                      (core/callayers.js): not archived, not in a Done
                      column, on any board
     TEMPLATES        Homework tracker, Project, Revision by subject
     toFile(board)    a board as a .json file: { type:'staticos-board', v:1, board }
     fromFile(obj)    that back (or a bare board object) -> { name, cols } | throws
     fromMarkdown(t)  a board from Markdown: ## headings are columns (or #
                      ones when there are no ##), list items cards, with
                      their indented notes, [ ] / [x] checklist items and
                      "due 2026-11-20"; a top-level [x] item goes to Done
     fromTaskList(l)  a Static Tasks list: To do and Done columns, subtasks
                      as checklist items, due dates kept

   What these return is plain data in Board's shape; Board's own
   normalize() still checks every part of it, as it does the store. The
   store is store('portal.board') (core/profiles.js keeps it per person).
   A column is "done" when it says so (col.done), or — for boards saved
   before columns had that — when it is called Done.
   ============================================================ */
import { store } from './store.js';
import { validDay } from './tasks.js';

export const STORE_KEY = 'portal.board';
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);
const line = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export const colDone = col => (typeof col.done === 'boolean' ? col.done : /^done$/i.test(String(col.name || '').trim()));

/** Cards with a due date that still count: -> [{ board, col, card }] */
export function dueCards(raw = store.get(STORE_KEY, null)) {
  const out = [];
  const d = isObj(raw) ? raw : {};
  for (const b of arr(d.boards)) {
    if (!isObj(b)) continue;
    for (const col of arr(b.cols)) {
      if (!isObj(col) || colDone(col)) continue;
      for (const card of arr(col.cards)) {
        if (!isObj(card) || !validDay(card.due)) continue;
        const title = line(card.title, 200);
        if (title) out.push({ board: { id: String(b.id || ''), name: line(b.name, 60) || 'Untitled board' }, col: { id: String(col.id || ''), name: line(col.name, 40) || 'Untitled' }, card: { id: String(card.id || ''), title, due: card.due, color: String(card.color || 'none') } });
      }
    }
  }
  return out;
}

/* templates: columns (and a work-in-progress limit where it helps); no made-up cards */
export const TEMPLATES = [
  { id: 'homework', name: 'Homework tracker', icon: 'clipboard', blurb: 'To do, Doing, Handed in — add due dates and see them on Calendar.',
    cols: [{ name: 'To do' }, { name: 'Doing', limit: 3 }, { name: 'Handed in', done: true }] },
  { id: 'project', name: 'Project', icon: 'box', blurb: 'Ideas to Done, with room for review.',
    cols: [{ name: 'Ideas' }, { name: 'To do' }, { name: 'Doing', limit: 3 }, { name: 'Review' }, { name: 'Done', done: true }] },
  { id: 'revision', name: 'Revision by subject', icon: 'star', blurb: 'A column for each subject; move a topic to Confident when you know it.',
    cols: [{ name: 'Maths' }, { name: 'English' }, { name: 'Science' }, { name: 'History' }, { name: 'Confident', done: true }] },
];

/* ---------------- files ---------------- */
export const FILE_TYPE = 'staticos-board';
/** A board as a file. Pictures stay in Board (they are too big for a file
    here); the file says how many were left out. */
export function toFile(b) {
  let pics = 0;
  const card = c => {
    if (c.image) pics++;
    const o = { title: c.title, notes: c.notes, color: c.color, checklist: c.checklist.map(i => ({ text: i.text, done: i.done })), links: c.links.map(l => ({ kind: l.kind, ref: l.ref, title: l.title })), pinned: c.pinned, due: c.due || null, created: c.created };
    if (c.reactions && c.reactions.length) o.reactions = c.reactions.slice();
    return o;
  };
  const board = {
    name: b.name,
    cols: b.cols.map(col => ({ name: col.name, limit: col.limit || 0, done: !!col.done, cards: col.cards.map(card) })),
    archive: (b.archive || []).map(a => ({ col: a.colName, at: a.at, card: card(a.card) })),
  };
  return { type: FILE_TYPE, v: 1, saved: new Date().toISOString(), board, picturesLeftOut: pics };
}
/** A board file (or a bare board) back -> { name, cols, archive } */
export function fromFile(o) {
  const b = isObj(o) && o.type === FILE_TYPE && isObj(o.board) ? o.board : isObj(o) && Array.isArray(o.cols) ? o : null;
  if (!b) throw new Error('That file isn’t a Static Board board.');
  const cols = arr(b.cols).filter(isObj);
  if (!cols.length) throw new Error('That board has no columns in it.');
  return { name: line(b.name, 60) || 'Imported board', cols, archive: arr(b.archive).filter(isObj) };
}

const LABEL_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
/** Markdown -> { name, cols }. Reads what Board's own Save as Markdown writes, and plain lists. */
export function fromMarkdown(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const h2 = lines.some(l => /^##\s+\S/.test(l));
  const heads = lines.filter(l => /^#\s+\S/.test(l));
  let name = '';
  const cols = [];
  let col = null, card = null, done = null;
  const colNamed = n => { let c = cols.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!c) { c = { name: n, cards: [] }; cols.push(c); } return c; };
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^(#{1,6})\s+(.+)$/.exec(l))) {
      const level = m[1].length, t = line(m[2], 60);
      /* with ## headings: # names the board, ## are columns. Without: one # is the
         name, several # are columns. Other levels are left out. */
      if (h2) { if (level === 1 && !name) name = t; else if (level === 2) { col = colNamed(line(t, 40)); card = null; } continue; }
      if (level === 1 && heads.length > 1) { col = colNamed(line(t, 40)); card = null; continue; }
      if (level === 1 && !name) name = t;
      continue;
    }
    if ((m = /^[-*+]\s+(.*)$|^\d+[.)]\s+(.*)$/.exec(l))) {
      let t = (m[1] ?? m[2] ?? '').trim();
      let checked = null;
      const cb = /^\[( |x|X)\]\s*(.*)$/.exec(t);
      if (cb) { checked = cb[1] !== ' '; t = cb[2]; }
      const c = { title: '', notes: '', color: 'none', checklist: [], pinned: false, due: null, reactions: [] };
      if (t.startsWith('📌')) { c.pinned = true; t = t.slice(2).trim(); }
      const due = /(?:\s+[—–-]\s+|\s+·\s+|\s+)due\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(t);
      if (due && validDay(due[1])) { c.due = due[1]; t = t.slice(0, due.index); }
      const reacts = /\s+((?:👍|❤️|🔥|😂|🎉|💡|👀)+)\s*$/u.exec(t);
      if (reacts) { c.reactions = [...reacts[1].matchAll(/👍|❤️|🔥|😂|🎉|💡|👀/gu)].map(x => x[0]); t = t.slice(0, reacts.index); }
      const label = /\s+\((red|orange|yellow|green|blue|purple|pink)\)\s*$/i.exec(t);
      if (label && LABEL_NAMES.includes(label[1].toLowerCase())) { c.color = label[1].toLowerCase(); t = t.slice(0, label.index); }
      c.title = line(t.replace(/^\*\*(.+)\*\*$/, '$1').replace(/\*\*/g, ''), 200);
      if (!c.title) continue;
      let target = col;
      if (!target) {
        if (checked) { done = done || colNamed('Done'); target = done; } else target = colNamed(cols.length && cols[0].name !== 'Done' ? cols[0].name : 'To do');
      }
      if (target === done) target.done = true;
      target.cards.push(c);
      card = c;
      continue;
    }
    if ((m = /^\s{2,}[-*+]\s+(.*)$/.exec(l)) && card) {
      const t = m[1];
      const cb = /^\[( |x|X)\]\s+(.*)$/.exec(t);
      if (cb) card.checklist.push({ text: line(cb[2], 200), done: cb[1] !== ' ' });
      else card.notes += `${card.notes ? '\n' : ''}${t.trim()}`;
      continue;
    }
    if (/^\s{2,}\S/.test(l) && card) {
      const t = l.trim();
      if (/^\[Picture/.test(t)) continue;          /* a picture Board kept on the device it came from */
      card.notes += `${card.notes ? '\n' : ''}${t}`;
      continue;
    }
    if (/^_No cards_$/.test(l.trim())) continue;
  }
  /* ticked items from a plain list go in a Done column, at the end */
  if (done && cols[cols.length - 1] !== done) cols.push(...cols.splice(cols.indexOf(done), 1));
  const kept = cols.filter(c => c.cards.length || h2 || heads.length > 1);
  if (!kept.some(c => c.cards.length)) throw new Error('No cards were found in it: a card is a line that starts with “- ”.');
  if (kept.length && /^done$/i.test(kept[kept.length - 1].name) && kept[kept.length - 1].done === undefined) kept[kept.length - 1].done = true;
  return { name: name || 'Imported board', cols: kept };
}

/** A Static Tasks list -> { name, cols }: To do and Done, subtasks as checklist items. */
export function fromTaskList(list) {
  const card = t => ({
    title: line(t.text, 200) || 'Untitled task', notes: String(t.notes || ''), due: validDay(t.due) ? t.due : null,
    checklist: arr(t.subs).map(s => ({ text: line(s.text, 200), done: !!s.done })).filter(i => i.text),
  });
  const tasks = arr(list && list.tasks);
  return {
    name: line(list && list.name, 60) || 'Tasks',
    cols: [{ name: 'To do', cards: tasks.filter(t => !t.done).map(card) }, { name: 'Done', done: true, cards: tasks.filter(t => t.done).map(card) }],
  };
}

export default { STORE_KEY, colDone, dueCards, TEMPLATES, FILE_TYPE, toFile, fromFile, fromMarkdown, fromTaskList };
