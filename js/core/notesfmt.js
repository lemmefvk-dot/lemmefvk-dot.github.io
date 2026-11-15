/* ============================================================
   notesfmt.js — the format a note's body is kept in.

   A note used to be plain text. Since Notes got real formatting it
   is a small, line-based Markdown: one line is one block.

     # Title   ## Heading   ### Subheading
     - bullet            1. numbered
     - [ ] to do         - [x] done
     ![name](/home/static/Pictures/cat.jpg)      a picture: a vfs path,
                                                 never the bytes
     > a quote line      ---  a divider
     | cell | cell |    a table row; the first row of a table is its
                        header (no |---| line: export as .md adds one)
     **bold**  *italic*  \* a literal star       inside any line
     anything else is a paragraph; an empty line is an empty paragraph

   A table row is one block whose runs hold its cells with a tab
   between them (cellsOf / rowOf), so one line is still one block for
   the editor, the outline, Write Together and the word count. A
   literal | inside a cell is written \|.

   A note in this format carries fmt: 3. fmt: 2 is the same format from
   before quotes, dividers and tables: there a line such as "> 5" or
   "---" was a paragraph that read exactly like that, so upgrade()
   escapes just those lines and leaves every other byte alone. Notes
   written by something that does not know the format (the Notes
   widget, Spotlight's "New Note", an older build) have no fmt, and
   their body is plain text: fromPlain() turns it into the same words,
   line for line — only the checklists and headings that Notes' View
   mode already drew become real ones; every other character is
   escaped so it reads exactly as it did.

   toMarkdown() / fromMarkdown() are the .md files Notes exports and
   imports: ordinary Markdown, which this format is close to.

   No DOM here: Notes (js/apps/notes.js) draws the blocks, and the
   Spotlight index (js/core/textindex.js) reads plainOf().
   ============================================================ */

export const FMT = 3;

/* ---------- inline: **bold**, *italic*, \escapes ------------------ */

/** Inline source -> runs [{ text, b, i }]. A marker with no partner is
    an ordinary star, so "2*3" written by hand still reads 2*3. */
export function parseInline(src) {
  const s = String(src || '');
  const toks = [];                       /* { t: 'txt', v } | { t: 'b'|'i' } */
  let buf = '';
  const flush = () => { if (buf) { toks.push({ t: 'txt', v: buf }); buf = ''; } };
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && k + 1 < s.length) { buf += s[k + 1]; k++; continue; }
    if (c === '*') {
      flush();
      if (s[k + 1] === '*') { toks.push({ t: 'b' }); k++; } else toks.push({ t: 'i' });
      continue;
    }
    buf += c;
  }
  flush();
  /* pair markers of each kind in order; an odd one out is literal */
  for (const kind of ['b', 'i']) {
    const at = [];
    toks.forEach((t, k) => { if (t.t === kind) at.push(k); });
    if (at.length % 2) { const k = at[at.length - 1]; toks[k] = { t: 'txt', v: kind === 'b' ? '**' : '*' }; }
  }
  const runs = [];
  let b = false, i = false;
  for (const t of toks) {
    if (t.t === 'b') { b = !b; continue; }
    if (t.t === 'i') { i = !i; continue; }
    const last = runs[runs.length - 1];
    if (last && last.b === b && last.i === i) last.text += t.v;
    else runs.push({ text: t.v, b, i });
  }
  return runs;
}

const escText = s => String(s).replace(/[\\*]/g, '\\$&');

/** Runs -> inline source. */
export function inlineMd(runs) {
  let out = '', b = false, i = false;
  for (const r of mergeRuns(runs)) {
    if (!r.text) continue;
    if (i && !r.i) { out += '*'; i = false; }
    if (b && !r.b) { out += '**'; b = false; }
    if (r.b && !b) { out += '**'; b = true; }
    if (r.i && !i) { out += '*'; i = true; }
    out += escText(r.text);
  }
  if (i) out += '*';
  if (b) out += '**';
  return out;
}

/** Adjacent runs with the same marks become one; empty ones go. */
export function mergeRuns(runs) {
  const out = [];
  for (const r of runs || []) {
    if (!r || !r.text) continue;
    const last = out[out.length - 1];
    if (last && !!last.b === !!r.b && !!last.i === !!r.i) last.text += r.text;
    else out.push({ text: r.text, b: !!r.b, i: !!r.i });
  }
  return out;
}

export const runsText = runs => (runs || []).map(r => r.text).join('');

/* ---------- blocks ----------------------------------------------- */
/* { t: 'p'|'h1'|'h2'|'h3'|'ul'|'ol'|'check'|'quote'|'hr'|'row'|'img', runs, done?, path?, alt? }
   parse() can also give { t: 'row', sep: true } for the |---| line under a
   Markdown table's header (a .md file opened from Files): it keeps one block
   per line there, and is never drawn. A note never holds one: blocksOf()
   leaves it out, and serialize() never writes it. */

export const TAB = '\t';           /* between the cells of a table row */
const RE_H = /^(#{1,6})\s+(.*)$/;
const RE_CHECK = /^\s*[-*+]\s\[( |x|X)\]\s?(.*)$/;
const RE_UL = /^\s*[-*+]\s+(.*)$/;
const RE_OL = /^\s*\d{1,9}[.)]\s+(.*)$/;
const RE_IMG = /^!\[((?:[^\]\\]|\\.)*)\]\(([^)\s]*)\)\s*$/;
const RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_QUOTE = /^\s*>\s?(.*)$/;
const RE_ROW = /^\s*\|(.*)\|\s*$/;
const RE_SEP = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

/* a picture's path is %-encoded where it would break the (…) */
export const encPath = p => String(p).replace(/[%() <>\\\n]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
export const decPath = p => { try { return decodeURIComponent(p); } catch (e) { return p; } };

/* ---------- table rows ------------------------------------------- */
/** A row's cells, each its own runs. A row always has at least one. */
export function cellsOf(b) {
  const cells = [[]];
  for (const r of (b && b.runs) || []) {
    String(r.text).split(TAB).forEach((p, k) => {
      if (k) cells.push([]);
      if (p) cells[cells.length - 1].push({ text: p, b: !!r.b, i: !!r.i });
    });
  }
  return cells;
}
/** Cells (each runs) -> one row block. A tab inside a cell would read as a new cell: it becomes a space. */
export function rowOf(cells) {
  const runs = [];
  (cells && cells.length ? cells : [[]]).forEach((c, k) => {
    if (k) runs.push({ text: TAB, b: false, i: false });
    for (const r of c || []) runs.push({ text: String(r.text || '').replace(/\t/g, ' '), b: !!r.b, i: !!r.i });
  });
  return { t: 'row', runs: mergeRuns(runs) };
}
/* "| a | b \| c |" -> [' a ', ' b \| c ']: split at each | that isn't escaped */
function splitCells(inner) {
  const out = [];
  let cur = '';
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k];
    if (c === '\\' && k + 1 < inner.length) { cur += c + inner[k + 1]; k++; continue; }
    if (c === '|') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
/* the space serialize() puts either side of a cell is not part of it */
const pad1 = s => s.replace(/^ /, '').replace(/ $/, '');
const rowFrom = (inner, trim) => rowOf(splitCells(inner).map(c => parseInline(trim ? c.trim() : pad1(c))));
function rowMd(b) {
  const cells = cellsOf(b).map(c => inlineMd(c).replace(/\|/g, '\\|'));
  /* a row of only dashes would read as a table's |---| line */
  if (cells.every(c => /^:?-+:?$/.test(c))) cells[0] = `\\${cells[0]}`;
  return `| ${cells.join(' | ')} |`;
}

/** Body source -> blocks, one per line. */
export function parse(md) {
  const out = [];
  for (const line of String(md ?? '').split('\n')) {
    const prev = out[out.length - 1];
    let m = line.match(RE_IMG);
    if (m) { out.push({ t: 'img', alt: m[1].replace(/\\(.)/g, '$1'), path: decPath(m[2]), runs: [] }); continue; }
    m = line.match(RE_H);
    if (m) { out.push({ t: `h${Math.min(3, m[1].length)}`, runs: parseInline(m[2]) }); continue; }
    if (RE_HR.test(line)) { out.push({ t: 'hr', runs: [] }); continue; }
    m = line.match(RE_CHECK);
    if (m) { out.push({ t: 'check', done: m[1] !== ' ', runs: parseInline(m[2]) }); continue; }
    m = line.match(RE_UL);
    if (m) { out.push({ t: 'ul', runs: parseInline(m[1]) }); continue; }
    m = line.match(RE_OL);
    if (m) { out.push({ t: 'ol', runs: parseInline(m[1]) }); continue; }
    m = line.match(RE_QUOTE);
    if (m) { out.push({ t: 'quote', runs: parseInline(m[1]) }); continue; }
    if (prev && prev.t === 'row' && RE_SEP.test(line)) { out.push({ t: 'row', sep: true, runs: [] }); continue; }
    m = line.match(RE_ROW);
    if (m) { out.push(rowFrom(m[1], false)); continue; }
    out.push({ t: 'p', runs: parseInline(line) });
  }
  return out;
}

/** A paragraph whose text would read as block syntax gets its marker escaped. */
function escLead(src, t) {
  if (t === 'p') {
    if (/^\s*#/.test(src)) return src.replace(/^(\s*)#/, '$1\\#');
    if (/^\s*[-+]\s/.test(src)) return src.replace(/^(\s*)([-+])/, '$1\\$2');
    if (/^\s*\d{1,9}[.)]\s/.test(src)) return src.replace(/^(\s*\d{1,9})([.)])/, '$1\\$2');
    if (/^!\[/.test(src)) return `\\${src}`;
    if (/^\s*>/.test(src)) return src.replace(/^(\s*)>/, '$1\\>');
    if (RE_HR.test(src)) return src.replace(/^(\s*)(\S)/, '$1\\$2');
    if (/^\s*\|/.test(src)) return src.replace(/^(\s*)\|/, '$1\\|');
  }
  /* "- [ ] x" typed as the words of a bullet must not become a checkbox */
  if ((t === 'ul' || t === 'check') && /^\[( |x|X)\]/.test(src)) return `\\${src}`;
  return src;
}

/** Blocks -> body source. */
export function serialize(blocks) {
  const out = [];
  let n = 0;
  for (const b of blocks || []) {
    if (b.sep) continue;
    n = b.t === 'ol' ? n + 1 : 0;
    if (b.t === 'img') {
      const alt = String(b.alt || '').replace(/[\\\]]/g, '\\$&').replace(/\n/g, ' ');
      out.push(`![${alt}](${encPath(b.path || '')})`);
      continue;
    }
    if (b.t === 'hr') { out.push('---'); continue; }
    if (b.t === 'row') { out.push(rowMd(b)); continue; }
    const src = inlineMd(b.runs).replace(/\n/g, ' ');
    if (b.t === 'h1' || b.t === 'h2' || b.t === 'h3') out.push(`${'#'.repeat(Number(b.t[1]))} ${src}`);
    else if (b.t === 'ul') out.push(`- ${escLead(src, 'ul')}`);
    else if (b.t === 'ol') out.push(`${n}. ${src}`);
    else if (b.t === 'check') out.push(`- [${b.done ? 'x' : ' '}] ${escLead(src, 'check')}`);
    else if (b.t === 'quote') out.push(src ? `> ${src}` : '>');
    else out.push(escLead(src, 'p'));
  }
  return out.join('\n');
}

/* ---------- plain text (old notes, search, previews) ------------- */

const OLD_CHECK = /^(\s*[-*]\s\[)( |x|X)(\]\s?)(.*)$/;
const OLD_HEAD = /^(#{1,3})\s+(.*)$/;

/** A plain-text note -> blocks that read exactly the same. Checklist
    and heading lines (what Notes' View mode always drew) become real
    ones; every other line stays word for word. */
export function plainBlocks(text) {
  return String(text ?? '').split('\n').map(line => {
    const c = line.match(OLD_CHECK);
    if (c) return { t: 'check', done: c[2] !== ' ', runs: [{ text: c[4], b: false, i: false }] };
    const hd = line.match(OLD_HEAD);
    if (hd) return { t: `h${hd[1].length}`, runs: [{ text: hd[2], b: false, i: false }] };
    return { t: 'p', runs: line ? [{ text: line, b: false, i: false }] : [] };
  });
}
export const fromPlain = text => serialize(plainBlocks(text));

/** The words of a note, without any syntax: one block per line. */
export function plainOf(md) {
  return parse(md).filter(b => !b.sep).map(b => (b.t === 'img' || b.t === 'hr' ? '' : runsText(b.runs))).join('\n');
}

/* ---------- fmt 2 -> 3 ------------------------------------------- */
/* In fmt 2 these lines were paragraphs; now they would be quotes, dividers or rows */
const NEWLY = line => RE_HR.test(line) || RE_QUOTE.test(line) || RE_ROW.test(line);
/** A fmt 2 body in fmt 3: only the lines that would now read differently are
    escaped (each was a paragraph in fmt 2 — no other kind starts > | --- *** ___). */
function upgrade2(body) {
  const s = String(body ?? '');
  if (!/^\s*(?:>|\||-{3}|\*{3}|_{3})/m.test(s)) return s;
  return s.split('\n').map(line => (NEWLY(line) ? escLead(inlineMd(parseInline(line)), 'p') : line)).join('\n');
}
/** A body in format `fmt` (3, 2, or none: plain text) in the current format. */
export function upgrade(body, fmt) {
  if (fmt === FMT) return String(body ?? '');
  if (fmt === 2) return upgrade2(body);
  return fromPlain(body);
}

/** Body as blocks, whatever format the note is in. */
export function blocksOf(note) {
  if (note && note.fmt === FMT) return parse(note.body).filter(b => !b.sep);
  if (note && note.fmt === 2) return parse(upgrade2(note.body));
  return plainBlocks(note && note.body);
}

/** The plain words of a note, whatever format it is in. */
export function noteText(note) {
  if (note && note.fmt === FMT) return plainOf(note.body);
  if (note && note.fmt === 2) return plainOf(upgrade2(note.body));
  return String((note && note.body) || '');
}

/** A note in the current format (the same object when it already is). */
export function migrate(note) {
  if (!note || typeof note !== 'object' || note.fmt === FMT) return note;
  return { ...note, body: upgrade(note.body, note.fmt), fmt: FMT };
}

/** Every picture a body points at. */
export const pictures = md => parse(md).filter(b => b.t === 'img' && b.path).map(b => b.path);

/* ---------- .md files: export and import ------------------------- */
const LISTS = new Set(['ul', 'ol', 'check']);

/** A note as an ordinary Markdown file: its title as the first heading,
    then the body. Each line of the note stays its own line when the file
    is read by any Markdown reader: paragraphs get a blank line between
    them, a table gets its |---| line, a divider never turns the line above
    it into a heading. */
export function toMarkdown(title, blocks) {
  const groups = [];
  for (const b of blocks || []) {
    if (b.sep) continue;
    if (b.t === 'p' && !runsText(b.runs).trim()) continue;      /* spacing: the blank lines below are the spacing */
    const kind = LISTS.has(b.t) || b.t === 'row' || b.t === 'quote' ? b.t : null;
    const last = groups[groups.length - 1];
    if (kind && last && last.kind === kind) last.blocks.push(b);
    else groups.push({ kind, blocks: [b] });
  }
  const out = [];
  if (String(title || '').trim()) out.push(`# ${inlineMd([{ text: String(title).replace(/\s+/g, ' ').trim() }])}`);
  for (const g of groups) {
    if (g.kind === 'row') {
      const rows = g.blocks.map(b => rowMd(b));
      const width = Math.max(...g.blocks.map(b => cellsOf(b).length));
      rows.splice(1, 0, `|${' --- |'.repeat(width)}`);
      out.push(rows.join('\n'));
    } else if (g.kind === 'quote') out.push(g.blocks.map(b => serialize([b])).join('\n>\n'));
    else out.push(serialize(g.blocks));
  }
  return `${out.join('\n\n')}\n`;
}

/* Markdown's own inline marks, as this format has them: _x_ and __x__ are
   italic and bold, a link keeps its words and its address (the address is
   what View mode makes clickable), a trailing hard break goes */
function mdInline(s) {
  let t = String(s || '').replace(/(?: {2,}|\\)$/, '');
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, url) => (alt ? `${alt} (${url})` : url));
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, words, url) => (words === url ? url : `${words} (${url})`));
  t = t.replace(/(^|[^\w\\])__(?=\S)(.+?\S)__(?!\w)/g, '$1**$2**');
  t = t.replace(/(^|[^\w\\_])_(?=\S)(.+?\S)_(?![\w_])/g, '$1*$2*');
  return parseInline(t);
}
const MD_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const mdRow = line => rowOf(splitCells(line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1')).map(c => mdInline(c.trim())));

/** A .md file -> { title, blocks }. Blank lines only separate things in
    Markdown, so they go; every other line becomes a line of the note. A
    first "# Heading" is the title. Fenced code is kept word for word, as
    plain lines. A picture is kept only when it points into this computer's
    files (a /home/… path); one from the web keeps its words and address. */
export function fromMarkdown(src) {
  const lines = String(src ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let title = '', fence = false, table = false;
  const lit = line => ({ t: 'p', runs: line ? [{ text: line, b: false, i: false }] : [] });
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (/^\s*(?:```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) { out.push(lit(line)); continue; }
    if (!line.trim()) { table = false; continue; }
    if (table) {
      if (line.includes('|')) { out.push(mdRow(line)); continue; }
      table = false;
    }
    if (line.includes('|') && k + 1 < lines.length && MD_SEP.test(lines[k + 1]) && lines[k + 1].includes('-')) {
      out.push(mdRow(line));
      k++;
      table = true;
      continue;
    }
    let m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/);
    if (m) {
      if (!title && !out.length && m[1].length === 1) { title = runsText(mdInline(m[2])).trim(); continue; }
      out.push({ t: `h${Math.min(3, m[1].length)}`, runs: mdInline(m[2]) });
      continue;
    }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { out.push({ t: 'hr', runs: [] }); continue; }
    m = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) { out.push({ t: 'check', done: m[1] !== ' ', runs: mdInline(m[2]) }); continue; }
    m = line.match(/^\s*[-*+]\s+(.*)$/);
    if (m) { out.push({ t: 'ul', runs: mdInline(m[1]) }); continue; }
    m = line.match(/^\s*\d{1,9}[.)]\s+(.*)$/);
    if (m) { out.push({ t: 'ol', runs: mdInline(m[1]) }); continue; }
    m = line.match(/^\s{0,3}>\s?(.*)$/);
    if (m) {
      const inner = m[1].replace(/^(?:\s*>\s?)+/, '');
      if (inner.trim()) out.push({ t: 'quote', runs: mdInline(inner) });
      continue;
    }
    m = line.match(/^\s*!\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (m && /^\/(?!\/)/.test(m[2]) && !m[2].split('/').includes('..')) {
      const path = decPath(m[2]);
      out.push({ t: 'img', path, alt: m[1].replace(/\\(.)/g, '$1') || path.split('/').pop(), runs: [] });
      continue;
    }
    out.push({ t: 'p', runs: mdInline(line.trim()) });
  }
  return { title, blocks: out };
}

export default {
  FMT, TAB, parse, serialize, parseInline, inlineMd, mergeRuns, runsText, plainBlocks, fromPlain, plainOf, blocksOf, noteText,
  migrate, upgrade, pictures, encPath, decPath, cellsOf, rowOf, toMarkdown, fromMarkdown,
};
