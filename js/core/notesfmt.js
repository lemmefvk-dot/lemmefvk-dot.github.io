/* ============================================================
   notesfmt.js — the format a note's body is kept in.

   A note used to be plain text. Since Notes got real formatting it
   is a small, line-based Markdown: one line is one block.

     # Title   ## Heading   ### Subheading
     - bullet            1. numbered
     - [ ] to do         - [x] done
     ![name](/home/static/Pictures/cat.jpg)      a picture: a vfs path,
                                                 never the bytes
     **bold**  *italic*  \* a literal star       inside any line
     anything else is a paragraph; an empty line is an empty paragraph

   A note that has been converted carries fmt: 2. Notes written by
   something that does not know the format (the Notes widget,
   Spotlight's "New Note", an older build) have no fmt, and their body
   is plain text: fromPlain() turns it into the same words, line for
   line — only the checklists and headings that Notes' View mode
   already drew become real ones; every other character is escaped so
   it reads exactly as it did.

   No DOM here: Notes (js/apps/notes.js) draws the blocks, and the
   Spotlight index (js/core/textindex.js) reads plainOf().
   ============================================================ */

export const FMT = 2;

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
/* { t: 'p'|'h1'|'h2'|'h3'|'ul'|'ol'|'check'|'img', runs, done?, path?, alt? } */

const RE_H = /^(#{1,6})\s+(.*)$/;
const RE_CHECK = /^\s*[-*+]\s\[( |x|X)\]\s?(.*)$/;
const RE_UL = /^\s*[-*+]\s+(.*)$/;
const RE_OL = /^\s*\d{1,9}[.)]\s+(.*)$/;
const RE_IMG = /^!\[((?:[^\]\\]|\\.)*)\]\(([^)\s]*)\)\s*$/;

/* a picture's path is %-encoded where it would break the (…) */
export const encPath = p => String(p).replace(/[%() <>\\\n]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
export const decPath = p => { try { return decodeURIComponent(p); } catch (e) { return p; } };

/** Body source -> blocks, one per line. */
export function parse(md) {
  const lines = String(md ?? '').split('\n');
  return lines.map(line => {
    let m = line.match(RE_IMG);
    if (m) return { t: 'img', alt: m[1].replace(/\\(.)/g, '$1'), path: decPath(m[2]), runs: [] };
    m = line.match(RE_H);
    if (m) return { t: `h${Math.min(3, m[1].length)}`, runs: parseInline(m[2]) };
    m = line.match(RE_CHECK);
    if (m) return { t: 'check', done: m[1] !== ' ', runs: parseInline(m[2]) };
    m = line.match(RE_UL);
    if (m) return { t: 'ul', runs: parseInline(m[1]) };
    m = line.match(RE_OL);
    if (m) return { t: 'ol', runs: parseInline(m[1]) };
    return { t: 'p', runs: parseInline(line) };
  });
}

/** A paragraph whose text would read as block syntax gets its marker escaped. */
function escLead(src, t) {
  if (t === 'p') {
    if (/^\s*#/.test(src)) return src.replace(/^(\s*)#/, '$1\\#');
    if (/^\s*[-+]\s/.test(src)) return src.replace(/^(\s*)([-+])/, '$1\\$2');
    if (/^\s*\d{1,9}[.)]\s/.test(src)) return src.replace(/^(\s*\d{1,9})([.)])/, '$1\\$2');
    if (/^!\[/.test(src)) return `\\${src}`;
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
    n = b.t === 'ol' ? n + 1 : 0;
    if (b.t === 'img') {
      const alt = String(b.alt || '').replace(/[\\\]]/g, '\\$&').replace(/\n/g, ' ');
      out.push(`![${alt}](${encPath(b.path || '')})`);
      continue;
    }
    const src = inlineMd(b.runs).replace(/\n/g, ' ');
    if (b.t === 'h1' || b.t === 'h2' || b.t === 'h3') out.push(`${'#'.repeat(Number(b.t[1]))} ${src}`);
    else if (b.t === 'ul') out.push(`- ${escLead(src, 'ul')}`);
    else if (b.t === 'ol') out.push(`${n}. ${src}`);
    else if (b.t === 'check') out.push(`- [${b.done ? 'x' : ' '}] ${escLead(src, 'check')}`);
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
  return parse(md).map(b => (b.t === 'img' ? '' : runsText(b.runs))).join('\n');
}

/** Body as blocks, whatever format the note is in. */
export const blocksOf = note => (note && note.fmt === FMT ? parse(note.body) : plainBlocks(note && note.body));

/** The plain words of a note, whatever format it is in. */
export const noteText = note => (note && note.fmt === FMT ? plainOf(note.body) : String((note && note.body) || ''));

/** A note in the current format (the same object when it already is). */
export function migrate(note) {
  if (!note || typeof note !== 'object' || note.fmt === FMT) return note;
  return { ...note, body: fromPlain(note.body || ''), fmt: FMT };
}

/** Every picture a body points at. */
export const pictures = md => parse(md).filter(b => b.t === 'img' && b.path).map(b => b.path);

export default { FMT, parse, serialize, parseInline, inlineMd, mergeRuns, runsText, plainBlocks, fromPlain, plainOf, blocksOf, noteText, migrate, pictures, encPath, decPath };
