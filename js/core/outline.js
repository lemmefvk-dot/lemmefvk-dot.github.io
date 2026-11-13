/* ============================================================
   outline.js — the outline of a note, and the edits that reorder it.
   No DOM here; Notes' outline panel (js/apps/notesplan.js) draws it.

   A note is a list of blocks (js/core/notesfmt.js). Its outline is its
   headings: h1, h2 and h3. A section is a heading and everything under
   it, up to the next heading of the same or a higher level — so an h2
   carries its h3s, pictures, checklists and paragraphs with it. What
   comes before the first heading is the lead-in; it stays at the top.

   The note's list formats have no indent levels (a bullet is a bullet),
   so lists are not tree nodes: each one belongs to the heading above it,
   and a heading's row says what is under it (words, list items, ticked
   items, pictures), counted from the blocks and nothing else.

   Every edit is a pure function: blocks in, a new array of the *same*
   block objects out (a heading whose level changes is copied with the
   new type). Runs, ticked boxes and picture paths are never rebuilt, so
   nothing is lost; the one effect on content is that a numbered list is
   renumbered by whatever now comes before it — that is how the list
   works anywhere in Notes. A failed edit returns { error }.
   ============================================================ */
import { runsText } from './notesfmt.js';
import { countWords } from './wordtools.js';

const LV = { h1: 1, h2: 2, h3: 3 };
export const levelOf = b => (b && LV[b.t]) || 0;
const textOf = b => (b && b.t !== 'img' ? runsText(b.runs) : '');

/** Headings as a tree. -> { lead, nodes } — nodes are
    { i, level, title, end, bodyEnd, stats, children, parent } where i is
    the heading's block index, [i, end) its whole section and [i+1, bodyEnd)
    what sits directly under it. */
export function outline(blocks) {
  const bl = blocks || [];
  const flat = [];
  bl.forEach((b, i) => { if (levelOf(b)) flat.push({ i, level: levelOf(b), title: textOf(b), children: [], parent: null }); });
  flat.forEach((n, k) => {
    n.bodyEnd = k + 1 < flat.length ? flat[k + 1].i : bl.length;
    let e = n.bodyEnd;
    for (let j = k + 1; j < flat.length; j++) { if (flat[j].level <= n.level) { e = flat[j].i; break; } e = bl.length; }
    n.end = e;
    n.stats = statsOf(bl, n.i + 1, n.bodyEnd);
  });
  const stack = [];
  const nodes = [];
  for (const n of flat) {
    while (stack.length && stack[stack.length - 1].level >= n.level) stack.pop();
    const p = stack[stack.length - 1] || null;
    n.parent = p;
    (p ? p.children : nodes).push(n);
    stack.push(n);
  }
  const first = flat.length ? flat[0].i : bl.length;
  return { lead: { end: first, stats: statsOf(bl, 0, first) }, nodes, flat };
}

/** What a stretch of blocks holds, counted: words (the Words tab's rule),
    list items, ticked and total checklist items, pictures. */
export function statsOf(blocks, from, to) {
  const s = { words: 0, items: 0, checks: 0, ticked: 0, pictures: 0 };
  for (let i = from; i < to; i++) {
    const b = blocks[i];
    if (!b) continue;
    if (b.t === 'img') { s.pictures++; continue; }
    s.words += countWords(textOf(b));
    if (b.t === 'ul' || b.t === 'ol' || b.t === 'check') s.items++;
    if (b.t === 'check') { s.checks++; if (b.done) s.ticked++; }
  }
  return s;
}

/** The row's second line, from its stats: "12 words · 3 list items · 1 of 2 ticked". */
export function describe(s) {
  const parts = [];
  const n = (v, w) => `${v} ${w}${v === 1 ? '' : 's'}`;
  parts.push(n(s.words, 'word'));
  if (s.items) parts.push(n(s.items, 'list item'));
  if (s.checks) parts.push(`${s.ticked} of ${s.checks} ticked`);
  if (s.pictures) parts.push(n(s.pictures, 'picture'));
  return parts.join(' · ');
}

const nodeAt = (blocks, i) => outline(blocks).flat.find(n => n.i === i) || null;

function relevel(b, d) {
  const lv = levelOf(b);
  return lv && d ? { ...b, t: `h${lv + d}` } : b;
}

/** Make the section at heading i one level higher (d = -1) or lower (+1),
    with every heading inside it. */
export function shift(blocks, i, d) {
  const n = nodeAt(blocks, i);
  if (!n) return { error: 'That heading is gone.' };
  for (let k = n.i; k < n.end; k++) {
    const lv = levelOf(blocks[k]);
    if (lv && (lv + d < 1 || lv + d > 3)) {
      return { error: d < 0 ? 'It is already at the top level.' : 'Headings only go three levels deep, so it can’t go lower.' };
    }
  }
  return { blocks: blocks.map((b, k) => (k >= n.i && k < n.end ? relevel(b, d) : b)), at: n.i };
}

/** Move the section at heading i before or after the section at heading `to`.
    The moved section takes the level of the one it lands beside (its own
    headings keep their depth under it), so the outline never reshapes the
    sections around it. */
export function move(blocks, i, to, where) {
  const o = outline(blocks);
  const a = o.flat.find(n => n.i === i), t = o.flat.find(n => n.i === to);
  if (!a || !t) return { error: 'That heading is gone.' };
  if (to >= a.i && to < a.end) return { error: 'A section can’t go inside itself.' };
  const d = t.level - a.level;
  for (let k = a.i; k < a.end; k++) {
    const lv = levelOf(blocks[k]);
    if (lv && (lv + d < 1 || lv + d > 3)) return { error: 'That section has too many levels to sit there. Promote its sub-headings first.' };
  }
  const moved = blocks.slice(a.i, a.end).map(b => relevel(b, d));
  const rest = [...blocks.slice(0, a.i), ...blocks.slice(a.end)];
  /* where it lands, in `rest` */
  const cut = a.end - a.i;
  const base = where === 'after' ? t.end : t.i;
  const at = base > a.i ? base - cut : base;
  if (at === a.i && d === 0) return { error: 'It is already there.' };
  return { blocks: [...rest.slice(0, at), ...moved, ...rest.slice(at)], at };
}

/** One step up or down among the heading's siblings (same parent, same level). */
export function step(blocks, i, dir) {
  const n = nodeAt(blocks, i);
  if (!n) return { error: 'That heading is gone.' };
  const sibs = n.parent ? n.parent.children : outline(blocks).nodes;
  const k = sibs.findIndex(s => s.i === i);
  const other = sibs[k + dir];
  if (!other) return { error: dir < 0 ? 'It is already first.' : 'It is already last.' };
  return move(blocks, i, other.i, dir < 0 ? 'before' : 'after');
}

export default { levelOf, outline, statsOf, describe, shift, move, step };
