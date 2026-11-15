/* ============================================================
   codeedit.js — the text work behind Static Code's editing keys.

   Pure functions: they take the text and the selection and say what
   to change, as one replacement { from, to, insert, selStart, selEnd }
   (selStart/selEnd are positions in the text after the change), or
   null when there is nothing to do. The editor applies each one as a
   single edit, so Undo takes it back in one step.

     toggleComment(text, s, e, lang)       //, CSS block comments, <!-- -->, #, --
     duplicateLines(text, s, e, down)      a copy below (or above)
     indentLines / outdentLines(text, s, e, unit)
     enterEdit(text, s, e, lang, unit)     Enter: keep the indent, one
                                           more after { ( [ and after a
                                           Python ':', one less after
                                           return/pass/break/continue/raise
     pairEdit(ch, text, s, e, lang)        auto-close ( [ { " ' `; type
                                           over a closer that is already there
     backspacePair(text, s, e)             () "" [] {} '' `` go together
     closeTagEdit(text, s, e)              <div> typed → </div> after the caret
     fixWhitespace(text, { unit, tabs, md }) leading tabs ↔ spaces, trailing
                                           spaces off, one final newline
     prettyJson(text, unit)                JSON laid out again without
                                           going through numbers (so
                                           1e400 and 0.10 stay as written)
     detectIndent(text)                    { tabs, size } or null

   lang is Code's highlighter id: 'js' (also TypeScript, C, Rust),
   'css', 'html', 'md', 'py', 'json', 'conf', 'sql', 'glsl' or null.
   unit is the text one indent is: '  ', '    ' or '\t'.
   ============================================================ */

/* how each language comments a line out; [open, close] for block-only ones */
export const COMMENT = {
  js: ['//'], glsl: ['//'], py: ['#'], conf: ['#'], sql: ['--'],
  css: ['/*', '*/'], html: ['<!--', '-->'], md: ['<!--', '-->'],
};

/** [start of the first line, end of the last line] the selection touches.
    A selection that ends at the very start of a line leaves that line out. */
export function lineSpan(text, s, e) {
  let end = e;
  if (e > s && text[e - 1] === '\n') end = e - 1;
  const from = text.lastIndexOf('\n', s - 1) + 1;
  let to = text.indexOf('\n', end);
  if (to < 0) to = text.length;
  return [from, Math.max(from, to)];
}

const leadOf = line => (line.match(/^[ \t]*/) || [''])[0];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function toggleComment(text, s, e, lang) {
  const mark = COMMENT[lang];
  if (!mark) return null;
  const [from, to] = lineSpan(text, s, e);
  const lines = text.slice(from, to).split('\n');
  const used = lines.filter(l => l.trim());
  if (!used.length) return null;
  const [open, close] = mark;
  const isOn = l => {
    const t = l.trim();
    return close ? t.startsWith(open) && t.endsWith(close) && t.length >= open.length + close.length : t.startsWith(open);
  };
  const off = used.every(isOn);
  const ind = Math.min(...used.map(l => leadOf(l).length));
  const out = lines.map(l => {
    if (!l.trim()) return l;
    if (off) {
      const lead = leadOf(l);
      let body = l.slice(lead.length);
      body = body.replace(new RegExp(`^${esc(open)} ?`), '');
      if (close) body = body.replace(new RegExp(` ?${esc(close)}$`), '');
      return lead + body;
    }
    return close ? `${l.slice(0, ind)}${open} ${l.slice(ind)} ${close}` : `${l.slice(0, ind)}${open} ${l.slice(ind)}`;
  }).join('\n');
  if (out === text.slice(from, to)) return null;
  /* a lone caret stays where it was in its line's text */
  if (s === e) {
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    const old = text.slice(lineStart, (text.indexOf('\n', s) + 1 || text.length + 1) - 1);
    const col = s - lineStart;
    let next = col;
    if (old.trim() && !off) next = col >= ind ? col + open.length + 1 : col;
    else if (old.trim()) {
      const lead = leadOf(old).length;
      const cut = open.length + (old[lead + open.length] === ' ' ? 1 : 0);
      next = col >= lead + cut ? col - cut : Math.min(col, lead);
    }
    const k = text.slice(from, lineStart).split('\n').length - 1;
    const outStart = from + out.split('\n').slice(0, k).reduce((n, l) => n + l.length + 1, 0);
    return { from, to, insert: out, selStart: outStart + next, selEnd: outStart + next };
  }
  return { from, to, insert: out, selStart: from, selEnd: from + out.length };
}

export function duplicateLines(text, s, e, down = true) {
  const [from, to] = lineSpan(text, s, e);
  const block = text.slice(from, to);
  if (down) return { from: to, to, insert: `\n${block}`, selStart: s + block.length + 1, selEnd: e + block.length + 1 };
  return { from, to: from, insert: `${block}\n`, selStart: s, selEnd: e };
}

export function indentLines(text, s, e, unit) {
  const [from, to] = lineSpan(text, s, e);
  const lines = text.slice(from, to).split('\n');
  let addFirst = 0, add = 0;
  const out = lines.map((l, i) => {
    if (!l.trim() && lines.length > 1) return l;
    if (i === 0) addFirst = unit.length;
    add += unit.length;
    return unit + l;
  }).join('\n');
  return { from, to, insert: out, selStart: s + addFirst, selEnd: e + add };
}

export function outdentLines(text, s, e, unit) {
  const [from, to] = lineSpan(text, s, e);
  const lines = text.slice(from, to).split('\n');
  const w = unit === '\t' ? 4 : unit.length;
  let cutFirst = 0, cut = 0;
  const out = lines.map((l, i) => {
    let n = 0;
    if (l[0] === '\t') n = 1;
    else while (n < w && l[n] === ' ') n++;
    if (i === 0) cutFirst = n;
    cut += n;
    return l.slice(n);
  }).join('\n');
  if (!cut) return null;
  const firstLineStart = from;
  return {
    from, to, insert: out,
    selStart: Math.max(firstLineStart, s - cutFirst),
    selEnd: Math.max(firstLineStart, e - cut),
  };
}

const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);
const QUOTES = new Set(['"', "'", '`']);
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

/** What Enter should type at the caret. */
export function enterEdit(text, s, e, lang, unit) {
  const ls = text.lastIndexOf('\n', s - 1) + 1;
  const before = text.slice(ls, s);
  const ind = leadOf(before);
  const after = text.slice(e, e + 1);
  const prev = before.replace(/\s+$/, '');
  const last = prev.slice(-1);
  let extra = '';
  let lead = ind;
  if (lang === 'py') {
    const code = prev.replace(/\s*#.*$/, '');
    if (/:$/.test(code)) extra = unit;
    else if (/^\s*(return|pass|break|continue|raise)\b/.test(prev) && ind.length) {
      lead = ind.endsWith('\t') ? ind.slice(0, -1) : ind.slice(0, Math.max(0, ind.length - unit.length));
    }
  } else if (OPENERS[last] || (lang === 'html' && /<([a-z][\w-]*)\b[^<>]*>$/i.test(prev) && !/\/>$/.test(prev) && after === '<')) {
    extra = unit;
  }
  /* between a pair ( {|} or <p>|</p> ): the closer goes on a line of its own */
  const between = (OPENERS[last] && after === OPENERS[last]) || (lang === 'html' && extra && text.slice(e, e + 2) === '</');
  if (between) {
    const insert = `\n${ind}${extra}\n${ind}`;
    return { from: s, to: e, insert, selStart: s + 1 + ind.length + extra.length, selEnd: s + 1 + ind.length + extra.length };
  }
  const insert = `\n${lead}${extra}`;
  return { from: s, to: e, insert, selStart: s + insert.length, selEnd: s + insert.length };
}

/** A typed ( [ { " ' ` or closer: pair it, wrap the selection in it, or step over the closer already there. */
export function pairEdit(ch, text, s, e, lang) {
  if (!lang || lang === 'md') return null;
  const next = text.slice(e, e + 1);
  if ((CLOSERS.has(ch) || QUOTES.has(ch)) && s === e && next === ch) {
    /* the closer is already there: step over it */
    return { from: s, to: s, insert: '', selStart: s + 1, selEnd: s + 1 };
  }
  const close = PAIRS[ch];
  if (!close) return null;
  if (s !== e) {
    const sel = text.slice(s, e);
    return { from: s, to: e, insert: ch + sel + close, selStart: s + 1, selEnd: e + 1 };
  }
  const prev = text.slice(Math.max(0, s - 1), s);
  if (QUOTES.has(ch)) {
    if (ch === '`' && lang !== 'js' && lang !== 'md') return null;
    const word = /[\w$]/.test(prev);
    /* Python's f'…', r"…", b'…' are strings, not apostrophes */
    const pyPrefix = lang === 'py' && /(^|[^\w])[fFrRbBuU]{1,2}$/.test(text.slice(Math.max(0, s - 3), s));
    if (word && !pyPrefix) return null;
    if (next && /[\w$]/.test(next)) return null;
    /* CSS and HTML text between tags keep their apostrophes */
    if (lang === 'html' && !insideTag(text, s)) return null;
  } else if (next && /[\w$]/.test(next)) {
    return null;            /* typing ( before a word wraps nothing: leave it single */
  }
  return { from: s, to: s, insert: ch + close, selStart: s + 1, selEnd: s + 1 };
}

const insideTag = (text, s) => {
  const lt = text.lastIndexOf('<', s - 1), gt = text.lastIndexOf('>', s - 1);
  return lt > gt;
};

export function backspacePair(text, s, e) {
  if (s !== e || s < 1) return null;
  const a = text[s - 1], b = text[s];
  if (PAIRS[a] && PAIRS[a] === b) return { from: s - 1, to: s + 1, insert: '', selStart: s - 1, selEnd: s - 1 };
  return null;
}

/* elements that never have a closing tag */
export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** '>' typed at the end of an opening tag: add its closing tag after the caret. */
export function closeTagEdit(text, s, e) {
  if (s !== e) return null;
  const before = text.slice(Math.max(0, s - 400), s);
  const m = /<([a-zA-Z][\w:-]*)(?:\s+[^<>]*?)?$/.exec(before);
  if (!m || /\/$/.test(before)) return null;
  /* inside a quoted attribute value, '>' is only text */
  const attrs = before.slice(m.index);
  if (((attrs.match(/"/g) || []).length % 2) || ((attrs.match(/'/g) || []).length % 2)) return null;
  const tag = m[1];
  if (VOID.has(tag.toLowerCase())) return null;
  const closing = `</${tag}>`;
  if (text.slice(e, e + closing.length).toLowerCase() === closing.toLowerCase()) return null;
  return { from: s, to: s, insert: `>${closing}`, selStart: s + 1, selEnd: s + 1 };
}

/** Leading tabs or spaces to the file's indent, trailing spaces off, one final newline. */
export function fixWhitespace(text, { unit = '  ', md = false } = {}) {
  const tabs = unit === '\t';
  const size = tabs ? 4 : unit.length;
  let changed = 0;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = lines.map(l => {
    let line = l;
    const lead = leadOf(line);
    if (lead) {
      let col = 0;
      for (const c of lead) col = c === '\t' ? col + size - (col % size) : col + 1;
      const next = tabs ? '\t'.repeat(Math.floor(col / size)) + ' '.repeat(col % size) : ' '.repeat(col);
      line = next + line.slice(lead.length);
    }
    /* Markdown's two trailing spaces are a line break: keep those */
    const keep = md && / {2,}$/.test(line) && line.trim() ? '  ' : '';
    line = line.replace(/[ \t]+$/, '') + keep;
    if (line !== l) changed++;
    return line;
  });
  while (out.length > 1 && out[out.length - 1] === '' && out[out.length - 2] === '') { out.pop(); changed++; }
  let result = out.join('\n');
  if (result && !result.endsWith('\n')) { result += '\n'; changed++; }
  if (/\r/.test(text)) changed++;
  return { text: result, changed: result === text ? 0 : Math.max(1, changed) };
}

/** JSON laid out with one value per line. Valid JSON only; numbers and
    strings are copied as written (so nothing is rounded or re-escaped). */
export function prettyJson(text, unit = '  ') {
  try { JSON.parse(text); }
  catch (err) {
    const m = /position (\d+)/.exec(err.message) || /column (\d+)/.exec(err.message);
    let line = null;
    if (m && /position/.test(m[0])) line = text.slice(0, Number(m[1])).split('\n').length;
    const lm = /line (\d+)/.exec(err.message);
    if (lm) line = Number(lm[1]);
    return { ok: false, error: err.message.replace(/^JSON\.parse: /, ''), line };
  }
  const re = /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])|(\s+)/gy;
  let out = '', depth = 0, m;
  const nl = () => `\n${unit.repeat(depth)}`;
  let last = '';
  while ((m = re.exec(text))) {
    if (m[5] !== undefined) continue;
    const t = m[0];
    if (t === '{' || t === '[') {
      out += t; depth++;
      last = t;
      continue;
    }
    if (t === '}' || t === ']') {
      depth--;
      out += (last === '{' || last === '[') ? t : nl() + t;
      last = t;
      continue;
    }
    if (last === '{' || last === '[') out += nl();
    if (t === ',') { out += `,${nl()}`; last = ','; continue; }
    if (t === ':') { out += ': '; last = ':'; continue; }
    out += t;
    last = t;
  }
  return { ok: true, text: `${out}\n` };
}

/** How a file is indented: mostly tabs, or the step its space-indented lines move in. */
export function detectIndent(text) {
  const lines = text.split('\n').slice(0, 2000);
  let tabs = 0, spaces = 0;
  const steps = new Map();
  let prev = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    const lead = leadOf(l);
    if (lead.startsWith('\t')) { tabs++; continue; }
    const n = lead.length;
    if (n) spaces++;
    const d = Math.abs(n - prev);
    if (d >= 2 && d <= 8) steps.set(d, (steps.get(d) || 0) + 1);
    prev = n;
  }
  if (!tabs && !spaces) return null;
  if (tabs > spaces) return { tabs: true, size: 4 };
  let best = 0, size = 0;
  for (const [k, v] of steps) if (v > best || (v === best && k < size)) { best = v; size = k; }
  return size ? { tabs: false, size: size === 3 ? 4 : size > 4 ? 8 : size } : null;
}

export default { COMMENT, lineSpan, toggleComment, duplicateLines, indentLines, outdentLines, enterEdit, pairEdit, backspacePair, closeTagEdit, fixWhitespace, prettyJson, detectIndent, VOID };
