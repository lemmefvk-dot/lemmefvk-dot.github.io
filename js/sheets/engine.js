/* ============================================================
   js/sheets/engine.js — Static Sheets' workbook and formula engine.
   No DOM in here: the app (js/apps/sheets.js) draws, this computes.

   FORMULAS
   · A hand-written tokenizer + recursive-descent parser. NO eval(),
     NO Function(). Precedence, lowest first (Excel's):
         =  <>  <  >  <=  >=
         &                       (join text)
         +  −
         ×  ÷
         ^                       (left to right, as Excel: 2^3^2 = 64)
         %                       (postfix: 50% = 0.5)
         unary −  +              (binds tighter than ^, so -2^2 = 4)
         :                       (range: A1:B3)
   · References: A1, $A$1, A$1, $A1, ranges A1:B3, whole columns A:B,
     other sheets Sheet2!A1 and 'My sheet'!A1:B2.
   · Values are numbers, text, TRUE/FALSE, blank (null) or an error
     (CellError): #DIV/0! #REF! #NAME? #VALUE! #CIRC! #N/A #NUM!, and
     #ERROR! for a formula that can't be read.

   RECALCULATION
   · Every formula's precedents are indexed when it is entered: single
     cells in `deps` (cell → formulas that read it) and ranges in
     per-column buckets (`rdeps`), so "who reads this cell?" is a map
     lookup plus a short scan, not a walk over the whole sheet.
   · recalc(changed) takes the cells that were edited, collects every
     formula downstream of them (and the volatile TODAY()/NOW() ones),
     orders those topologically (Kahn) and evaluates each exactly once.
     Nothing else is touched; `stats.evaluated` says how many ran.
   · Whatever Kahn can't order sits on or behind a cycle. Tarjan's SCC
     (iterative — a 10,000-cell chain must not blow the stack) finds
     the real cycles; their cells become #CIRC!, and cells that merely
     read a cycle are evaluated after it (so they show #CIRC! too,
     propagated like any other error).

   DATES are serial numbers, as in other spreadsheets: days since
   1899-12-30, so 2026-01-01 is 46023 and date arithmetic just works.
   ============================================================ */

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;
const RSPAN = 16384;              /* 2^14: columns per row in a key   */
const SSPAN = 17179869184;        /* 2^34: rows × columns per sheet    */

/** One number per cell of the whole book: sheet id, row and column. */
export const keyOf = (sid, r, c) => sid * SSPAN + r * RSPAN + c;
export const unkey = k => ({ sid: Math.floor(k / SSPAN), r: Math.floor(k / RSPAN) % MAX_ROWS, c: k % RSPAN });

/* ------------------------------------------------------------------ */
/*  errors                                                            */
/* ------------------------------------------------------------------ */
export class CellError {
  constructor(code, why = '') { this.code = code; this.why = why; }
  toString() { return this.code; }
}
export const ERR = Object.freeze({
  DIV0: new CellError('#DIV/0!', 'Division by zero'),
  REF: new CellError('#REF!', 'A reference points off the sheet, or to a sheet that doesn’t exist'),
  NAME: new CellError('#NAME?', 'Unknown function or name'),
  VALUE: new CellError('#VALUE!', 'A value has the wrong type for this operation'),
  CIRC: new CellError('#CIRC!', 'Circular reference: this formula depends on its own result'),
  NA: new CellError('#N/A', 'No match found'),
  NUM: new CellError('#NUM!', 'The result is not a valid number'),
  ERROR: new CellError('#ERROR!', 'The formula could not be read'),
});
const ERR_BY_CODE = new Map(Object.values(ERR).map(e => [e.code, e]));
ERR_BY_CODE.set('#NULL!', ERR.VALUE);
export const isErr = v => v instanceof CellError;

/* ------------------------------------------------------------------ */
/*  A1 names                                                          */
/* ------------------------------------------------------------------ */
export function colName(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function colIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) & 31);
  return n - 1;
}
export const cellName = (r, c) => colName(c) + (r + 1);
/** 'B3' / '$B$3' → { r, c } (zero-based), or null */
export function parseCellName(s) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(s || '').trim());
  if (!m) return null;
  const c = colIndex(m[1]), r = Number(m[2]) - 1;
  return r >= 0 && r < MAX_ROWS && c >= 0 && c < MAX_COLS ? { r, c } : null;
}
/** 'A1:C3' (or one cell) → { r1, c1, r2, c2 } normalised, or null */
export function parseRangeName(s) {
  const [a, b, extra] = String(s || '').split(':');
  if (extra !== undefined) return null;
  const A = parseCellName(a), B = b === undefined ? A : parseCellName(b);
  if (!A || !B) return null;
  return { r1: Math.min(A.r, B.r), c1: Math.min(A.c, B.c), r2: Math.max(A.r, B.r), c2: Math.max(A.c, B.c) };
}
export const rangeName = g => (g.r1 === g.r2 && g.c1 === g.c2 ? cellName(g.r1, g.c1) : `${cellName(g.r1, g.c1)}:${cellName(g.r2, g.c2)}`);
/** A sheet name as a formula writes it: Sheet2 or 'My sheet' */
export function quoteSheet(name) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(true|false)$/i.test(name)
    ? name : `'${String(name).replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ */
/*  dates                                                             */
/* ------------------------------------------------------------------ */
const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;
export const dateSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY;
/** the local wall-clock moment as a serial (whole days + fraction) */
export const nowSerial = (d = new Date()) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EPOCH) / DAY;
const pad2 = n => String(n).padStart(2, '0');
function fmtDate(serial, withTime) {
  const d = new Date(EPOCH + Math.round(serial * DAY / 1000) * 1000);
  if (Number.isNaN(d.getTime())) return '#NUM!';
  const day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return withTime ? `${day} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : day;
}

/* ------------------------------------------------------------------ */
/*  typed input → value                                               */
/* ------------------------------------------------------------------ */
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const GROUPED_RE = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
const decimals = x => { const i = x.indexOf('.'); return i < 0 ? 0 : x.length - i - 1; };
const plainNum = x => (NUM_RE.test(x) ? Number(x) : GROUPED_RE.test(x) ? Number(x.replace(/,/g, '')) : null);

/** What a typed (or imported) entry means: { v, fmt? }. Numbers, 1,234,
    12.5%, $9.99, TRUE/FALSE, 2026-10-29 and 10/29/2026 dates, error codes;
    anything else is text. A leading apostrophe forces text ('007). */
export function parseLiteral(raw) {
  if (raw == null || raw === '') return { v: null };
  const s = String(raw);
  if (s[0] === "'") return { v: s.slice(1) };
  const t = s.trim();
  if (!t) return { v: s };
  if (NUM_RE.test(t)) return { v: Number(t) };
  if (GROUPED_RE.test(t)) return { v: Number(t.replace(/,/g, '')), fmt: { nf: 'number', dp: decimals(t) } };
  if (t.endsWith('%')) {
    const x = t.slice(0, -1).trim(), n = plainNum(x);
    if (n != null) return { v: n / 100, fmt: { nf: 'percent', dp: decimals(x) } };
  }
  const cur = /^([+-]?)\$\s?([\d.,]+)$/.exec(t) || /^\$([+-])\s?([\d.,]+)$/.exec(t);
  if (cur) {
    const n = plainNum(cur[2]);
    if (n != null) return { v: cur[1] === '-' ? -n : n, fmt: { nf: 'currency', dp: decimals(cur[2]) || 2 } };
  }
  if (/^(true|false)$/i.test(t)) return { v: t.toLowerCase() === 'true' };
  const e = ERR_BY_CODE.get(t.toUpperCase());
  if (e) return { v: e };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m && validDate(+m[1], +m[2], +m[3])) return { v: dateSerial(+m[1], +m[2], +m[3]), fmt: { nf: 'date' } };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m && validDate(+m[3], +m[1], +m[2])) return { v: dateSerial(+m[3], +m[1], +m[2]), fmt: { nf: 'date' } };
  return { v: s };
}
function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || y < 1900) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/* ------------------------------------------------------------------ */
/*  value → text                                                      */
/* ------------------------------------------------------------------ */
export const FORMATS = ['general', 'number', 'percent', 'currency', 'date'];
export const DEFAULT_DP = { general: 0, number: 2, percent: 0, currency: 2, date: 0, datetime: 0 };
const nfCache = new Map();
function nf(dp) {
  let f = nfCache.get(dp);
  if (!f) { f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); nfCache.set(dp, f); }
  return f;
}
/** General: whole numbers as they are, others to 10 significant digits */
export function general(n) {
  if (Object.is(n, -0)) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const a = Math.abs(n);
  if (a >= 1e15 || a < 1e-6) return n.toExponential(5).replace(/\.?0+e/, 'e').replace('e', 'E');
  return String(Number(n.toPrecision(10)));
}
/** Text a value turns into when joined with & or CONCAT (15 digits, like Excel) */
export function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof CellError) return v.code;
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(15)));
}
/** What a cell shows. fmt: { nf, dp } (the cell's own number format, or
    the one its input implied). */
export function formatValue(v, fmt) {
  if (v == null) return '';
  if (v instanceof CellError) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '#NUM!';
  const kind = (fmt && fmt.nf) || 'general';
  const dp = Math.max(0, Math.min(10, fmt && Number.isFinite(fmt.dp) ? fmt.dp : DEFAULT_DP[kind] || 0));
  switch (kind) {
    case 'number': return noNegZero(nf(dp).format(v));
    case 'percent': return noNegZero(nf(dp).format(v * 100)) + '%';
    case 'currency': {
      const s = nf(dp).format(Math.abs(v));
      return (v < 0 && /[1-9]/.test(s) ? '-$' : '$') + s;
    }
    case 'date': return fmtDate(v, false);
    case 'datetime': return fmtDate(v, true);
    default: return general(v);
  }
}
const noNegZero = s => (/^-[0.,]+$/.test(s) ? s.slice(1) : s);

/* ------------------------------------------------------------------ */
/*  tokenizer                                                         */
/* ------------------------------------------------------------------ */
const NUM = 1, STR = 2, BOOL = 3, REF = 4, COLS = 5, FUNC = 6, NAME = 7, OP = 8, LP = 9, RP = 10, SEP = 11, ERRT = 12;
export const TOKEN = { NUM, STR, BOOL, REF, COLS, FUNC, NAME, OP, LP, RP, SEP, ERR: ERRT };

const SHEET = String.raw`(?:'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_.]*)!)?`;
const RX_REF = new RegExp(SHEET + String.raw`(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(.!])`, 'y');
const RX_COLS = new RegExp(SHEET + String.raw`(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(.!])`, 'y');
const RX_NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const RX_ERR = /#(?:DIV\/0!|REF!|NAME\?|VALUE!|N\/A|NUM!|CIRC!|ERROR!|NULL!)/iy;
const RX_ID = /[A-Za-z_][A-Za-z0-9_.]*/y;

class ParseError extends Error {}

/** src: a formula without its leading '='. Tokens keep their place in the
    source (s, e) so fill and rename can rewrite references in place. */
export function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const at = rx => { rx.lastIndex = i; return rx.exec(src); };
  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    const s = i;
    let m;
    if ((m = at(RX_REF))) {
      const sheet = m[1] != null ? m[1].replace(/''/g, "'") : m[2] != null ? m[2] : null;
      const c = colIndex(m[4]), r = Number(m[6]) - 1;
      i = RX_REF.lastIndex;
      const ps = s + m[0].length - (m[3].length + m[4].length + m[5].length + m[6].length);
      if (r < 0 || r >= MAX_ROWS || c >= MAX_COLS) out.push({ k: ERRT, v: ERR.REF, s, e: i });
      else out.push({ k: REF, s, e: i, ps, sheet, r, c, ac: !!m[3], ar: !!m[5] });
      continue;
    }
    if ((m = at(RX_COLS))) {
      const sheet = m[1] != null ? m[1].replace(/''/g, "'") : m[2] != null ? m[2] : null;
      const c1 = colIndex(m[4]), c2 = colIndex(m[6]);
      i = RX_COLS.lastIndex;
      const ps = s + (m[1] != null ? m[1].length + 3 : m[2] != null ? m[2].length + 1 : 0);
      if (c1 >= MAX_COLS || c2 >= MAX_COLS) out.push({ k: ERRT, v: ERR.REF, s, e: i });
      else out.push({ k: COLS, s, e: i, ps, sheet, c1, c2, ac1: !!m[3], ac2: !!m[5] });
      continue;
    }
    if ((ch >= '0' && ch <= '9') || (ch === '.' && /\d/.test(src[i + 1] || ''))) {
      m = at(RX_NUM);
      i = RX_NUM.lastIndex;
      out.push({ k: NUM, v: Number(m[0]), s, e: i });
      continue;
    }
    if (ch === '"') {
      let v = '';
      i++;
      for (;;) {
        if (i >= n) throw new ParseError('A piece of text is missing its closing quote');
        if (src[i] === '"') { if (src[i + 1] === '"') { v += '"'; i += 2; continue; } i++; break; }
        v += src[i++];
      }
      out.push({ k: STR, v, s, e: i });
      continue;
    }
    if (ch === '#') {
      if ((m = at(RX_ERR))) { i = RX_ERR.lastIndex; out.push({ k: ERRT, v: ERR_BY_CODE.get(m[0].toUpperCase()), s, e: i }); continue; }
      throw new ParseError(`“${src.slice(i, i + 8)}” isn’t something a formula understands`);
    }
    if ((m = at(RX_ID))) {
      i = RX_ID.lastIndex;
      let j = i;
      while (src[j] === ' ') j++;
      const word = m[0];
      if (src[j] === '(') out.push({ k: FUNC, v: word.toUpperCase(), s, e: i });
      else if (/^(true|false)$/i.test(word)) out.push({ k: BOOL, v: word.toLowerCase() === 'true', s, e: i });
      else out.push({ k: NAME, v: word, s, e: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ k: OP, v: two, s, e: i + 2 }); i += 2; continue; }
    if ('+-*/^&=<>%:'.includes(ch)) { out.push({ k: OP, v: ch, s, e: i + 1 }); i++; continue; }
    if (ch === '(') { out.push({ k: LP, s, e: i + 1 }); i++; continue; }
    if (ch === ')') { out.push({ k: RP, s, e: i + 1 }); i++; continue; }
    if (ch === ',' || ch === ';') { out.push({ k: SEP, s, e: i + 1 }); i++; continue; }
    throw new ParseError(`“${ch}” isn’t something a formula understands`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  parser                                                            */
/* ------------------------------------------------------------------ */
const CMP = new Set(['=', '<>', '<', '>', '<=', '>=']);

/** src (no leading '=') → { ast, refs, ranges, volatile } or throws */
export function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = v => toks[p] && toks[p].k === OP && toks[p].v === v;
  const fail = msg => { throw new ParseError(msg); };

  function expr() { return cmp(); }
  function cmp() {
    let a = concat();
    while (toks[p] && toks[p].k === OP && CMP.has(toks[p].v)) { const op = toks[p++].v; a = { t: 'bin', op, a, b: concat() }; }
    return a;
  }
  function concat() {
    let a = add();
    while (isOp('&')) { p++; a = { t: 'bin', op: '&', a, b: add() }; }
    return a;
  }
  function add() {
    let a = mul();
    while (isOp('+') || isOp('-')) { const op = toks[p++].v; a = { t: 'bin', op, a, b: mul() }; }
    return a;
  }
  function mul() {
    let a = pow();
    while (isOp('*') || isOp('/')) { const op = toks[p++].v; a = { t: 'bin', op, a, b: pow() }; }
    return a;
  }
  function pow() {
    let a = pct();
    while (isOp('^')) { p++; a = { t: 'bin', op: '^', a, b: pct() }; }
    return a;
  }
  function pct() {
    let a = unary();
    while (isOp('%')) { p++; a = { t: 'pct', a }; }
    return a;
  }
  function unary() {
    if (isOp('-')) { p++; return { t: 'neg', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return range();
  }
  function range() {
    let a = primary();
    while (isOp(':')) {
      p++;
      const b = primary();
      if (a.t !== 'ref' || b.t !== 'ref') fail('“:” joins two cells into a range, like A1:B3');
      if (b.sheet && (b.sheet || '').toLowerCase() !== (a.sheet || '').toLowerCase()) fail('A range has to stay on one sheet');
      a = { t: 'range', sheet: a.sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
    }
    return a;
  }
  function primary() {
    const t = peek();
    if (!t) fail('The formula ends too soon');
    p++;
    switch (t.k) {
      case NUM: return { t: 'num', v: t.v };
      case STR: return { t: 'str', v: t.v };
      case BOOL: return { t: 'bool', v: t.v };
      case ERRT: return { t: 'err', v: t.v };
      case REF: return { t: 'ref', sheet: t.sheet, r: t.r, c: t.c };
      case COLS: return { t: 'range', sheet: t.sheet, r1: 0, r2: MAX_ROWS - 1, c1: Math.min(t.c1, t.c2), c2: Math.max(t.c1, t.c2) };
      case NAME: return { t: 'name', v: t.v };
      case LP: {
        const e = expr();
        if (!peek() || peek().k !== RP) fail('A “(” is missing its “)”');
        p++;
        return e;
      }
      case FUNC: {
        p++;                       /* its '(' */
        const args = [];
        if (peek() && peek().k === RP) { p++; }
        else {
          for (;;) {
            const q = peek();
            if (!q) fail(`${t.v}( is missing its “)”`);
            args.push(q.k === SEP || q.k === RP ? { t: 'empty' } : expr());
            const sep = peek();
            if (!sep) fail(`${t.v}( is missing its “)”`);
            p++;
            if (sep.k === RP) break;
            if (sep.k !== SEP) fail(`Expected “,” or “)” in ${t.v}(…)`);
          }
        }
        const f = FUNCS[t.v];
        if (f && (args.length < f.min || args.length > f.max)) {
          fail(f.min === f.max ? `${t.v} takes ${f.min} argument${f.min === 1 ? '' : 's'}`
            : args.length < f.min ? `${t.v} needs at least ${f.min} argument${f.min === 1 ? '' : 's'}`
              : `${t.v} takes at most ${f.max} arguments`);
        }
        return { t: 'fn', name: t.v, args };
      }
      default:
        fail(t.k === OP ? `“${t.v}” can’t go there` : t.k === RP ? 'There’s a “)” without a “(”' : 'Something is missing between two values');
    }
    return null;
  }

  if (!toks.length) fail('The formula is empty');
  const ast = expr();
  if (p < toks.length) {
    const t = toks[p];
    fail(t.k === RP ? 'There’s a “)” without a “(”' : `Unexpected “${src.slice(t.s, t.e)}”`);
  }
  const refs = [], ranges = [];
  let volatile = false;
  (function walk(n) {
    if (!n) return;
    if (n.t === 'ref') refs.push(n);
    else if (n.t === 'range') ranges.push(n);
    else if (n.t === 'fn') { if (FUNCS[n.name]?.volatile) volatile = true; n.args.forEach(walk); }
    else { walk(n.a); walk(n.b); }
  })(ast);
  return { ast, refs, ranges, volatile };
}

export const isFormula = raw => typeof raw === 'string' && raw.length > 1 && raw[0] === '=';

/** Move a formula's relative references by (dr, dc) — what fill and paste
    do. $-anchored parts stay. A reference pushed off the sheet becomes
    #REF!. The rest of the text (spacing, case) is kept as typed. */
export function shiftFormula(raw, dr, dc) {
  if (!isFormula(raw) || (!dr && !dc)) return raw;
  const src = raw.slice(1);
  let toks;
  try { toks = tokenize(src); } catch (e) { return raw; }
  const cellAt = t => {
    const r = t.ar ? t.r : t.r + dr, c = t.ac ? t.c : t.c + dc;
    if (r < 0 || r >= MAX_ROWS || c < 0 || c >= MAX_COLS) return null;
    return (t.ac ? '$' : '') + colName(c) + (t.ar ? '$' : '') + (r + 1);
  };
  let out = '', last = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === REF) {
      const pre = src.slice(t.s, t.ps);
      const nx = toks[i + 1], b = toks[i + 2];
      if (nx && nx.k === OP && nx.v === ':' && b && b.k === REF) {
        const A = cellAt(t), B = cellAt(b);
        out += src.slice(last, t.s) + (A && B ? pre + A + src.slice(t.e, b.ps) + B : '#REF!');
        last = b.e; i += 2;
        continue;
      }
      const A = cellAt(t);
      out += src.slice(last, t.s) + (A ? pre + A : '#REF!');
      last = t.e;
    } else if (t.k === COLS) {
      const c1 = t.ac1 ? t.c1 : t.c1 + dc, c2 = t.ac2 ? t.c2 : t.c2 + dc;
      const okc = c1 >= 0 && c2 >= 0 && c1 < MAX_COLS && c2 < MAX_COLS;
      out += src.slice(last, t.s) + (okc ? `${src.slice(t.s, t.ps)}${t.ac1 ? '$' : ''}${colName(c1)}:${t.ac2 ? '$' : ''}${colName(c2)}` : '#REF!');
      last = t.e;
    }
  }
  return '=' + out + src.slice(last);
}

/** Point every reference to sheet `from` at sheet `to` instead (rename). */
export function renameSheetIn(raw, from, to) {
  if (!isFormula(raw)) return raw;
  const src = raw.slice(1);
  let toks;
  try { toks = tokenize(src); } catch (e) { return raw; }
  const low = from.toLowerCase();
  let out = '', last = 0;
  for (const t of toks) {
    if ((t.k === REF || t.k === COLS) && t.sheet != null && t.sheet.toLowerCase() === low) {
      out += src.slice(last, t.s) + quoteSheet(to) + '!';
      last = t.ps;
    }
  }
  return last ? '=' + out + src.slice(last) : raw;
}

/* ------------------------------------------------------------------ */
/*  coercion                                                          */
/* ------------------------------------------------------------------ */
/** A rectangle of cells handed to a function (not yet read). */
export class Rng {
  constructor(sid, r1, c1, r2, c2) { this.sid = sid; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
  get single() { return this.r1 === this.r2 && this.c1 === this.c2; }
  get rows() { return this.r2 - this.r1 + 1; }
  get cols() { return this.c2 - this.c1 + 1; }
}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null) return 0;
  if (v instanceof CellError) return v;
  const n = parseLiteral(v).v;
  return typeof n === 'number' ? n : ERR.VALUE;
}
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v == null) return false;
  if (v instanceof CellError) return v;
  const s = String(v).trim().toLowerCase();
  return s === 'true' ? true : s === 'false' ? false : ERR.VALUE;
}
const numEq = (a, b) => a === b || Math.abs(a - b) <= 1e-15 * Math.max(Math.abs(a), Math.abs(b));
const rank = v => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3);
/** -1 / 0 / 1, Excel's order: numbers < text < logicals; text ignores case */
function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) a = typeof b === 'number' ? 0 : typeof b === 'string' ? '' : false;
  if (b == null) b = typeof a === 'number' ? 0 : typeof a === 'string' ? '' : false;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 1) return numEq(a, b) ? 0 : a < b ? -1 : 1;
  if (ra === 2) { const x = a.toLowerCase(), y = b.toLowerCase(); return x === y ? 0 : x < y ? -1 : 1; }
  return a === b ? 0 : a ? 1 : -1;
}
function wildcard(s) {
  let rx = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '~' && (s[i + 1] === '*' || s[i + 1] === '?' || s[i + 1] === '~')) { rx += '\\' + s[++i]; continue; }
    rx += ch === '*' ? '[\\s\\S]*' : ch === '?' ? '[\\s\\S]' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${rx}$`, 'i');
}
const numText = v => { const n = parseLiteral(v).v; return typeof n === 'number' ? n : null; };
/** SUMIF/COUNTIF criteria: 5, ">5", "<=10", "<>x", "app*", "" … → test(value) */
function criterion(c) {
  if (c instanceof CellError) return v => v instanceof CellError && v.code === c.code;
  if (typeof c === 'number') return v => (typeof v === 'number' ? numEq(v, c) : typeof v === 'string' && v.trim() !== '' && numText(v) === c);
  if (typeof c === 'boolean') return v => v === c;
  let s = c == null ? '' : String(c);
  let op = '=';
  const m = /^(<=|>=|<>|<|>|=)/.exec(s);
  if (m) { op = m[1]; s = s.slice(op.length); }
  const lit = s.trim() === '' ? null : parseLiteral(s).v;
  const isNum = typeof lit === 'number';
  if (op === '=' || op === '<>') {
    let test;
    if (s === '') test = v => v == null || v === '';
    else if (isNum) test = v => (typeof v === 'number' && numEq(v, lit)) || (typeof v === 'string' && v.trim() !== '' && numText(v) === lit);
    else if (typeof lit === 'boolean') test = v => v === lit;
    else { const rx = wildcard(s); test = v => typeof v === 'string' && rx.test(v); }
    return op === '=' ? test : v => !test(v);
  }
  const ok = d => (op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0);
  if (isNum) return v => typeof v === 'number' && ok(compare(v, lit));
  return v => typeof v === 'string' && ok(compare(v, s));
}
const fin = n => (Number.isFinite(n) ? n : ERR.NUM);

/* ------------------------------------------------------------------ */
/*  functions                                                         */
/* ------------------------------------------------------------------ */
/* Each gets (args, book) — a range argument arrives as an Rng, anything
   else as a value. `lazy` ones get the unevaluated nodes (IF only runs
   the branch it takes). */
const FUNCS = Object.create(null);
const def = (name, min, max, fn, extra = {}) => { FUNCS[name] = { min, max, fn, ...extra }; };
const MANY = 255;

/** numbers for SUM/AVERAGE/MIN/MAX: from ranges only real numbers count;
    typed arguments are converted (TRUE → 1, "3" → 3). An error wins. */
function numbers(args, book) {
  const out = [];
  for (const a of args) {
    if (a instanceof Rng) {
      let bad = null;
      book.each(a, v => {
        if (v instanceof CellError) { bad = v; return false; }
        if (typeof v === 'number') out.push(v);
        return true;
      });
      if (bad) return bad;
    } else if (a != null) {
      const n = toNum(a);
      if (n instanceof CellError) return n;
      out.push(n);
    }
  }
  return out;
}
/** the one value a scalar argument stands for (a 1-cell range is fine) */
function one(a, book) {
  if (a instanceof Rng) return a.single ? book.valueIn(a.sid, a.r1, a.c1) : ERR.VALUE;
  return a;
}
const numArg = (a, book) => { const v = one(a, book); return v instanceof CellError ? v : toNum(v); };
const textArg = (a, book) => { const v = one(a, book); return v instanceof CellError ? v : toText(v); };
const firstErr = (...v) => v.find(x => x instanceof CellError);

def('SUM', 1, MANY, (a, b) => { const n = numbers(a, b); return n instanceof CellError ? n : n.reduce((s, x) => s + x, 0); });
def('AVERAGE', 1, MANY, (a, b) => { const n = numbers(a, b); return n instanceof CellError ? n : n.length ? n.reduce((s, x) => s + x, 0) / n.length : ERR.DIV0; });
def('MIN', 1, MANY, (a, b) => { const n = numbers(a, b); return n instanceof CellError ? n : n.length ? Math.min(...n) : 0; });
def('MAX', 1, MANY, (a, b) => { const n = numbers(a, b); return n instanceof CellError ? n : n.length ? Math.max(...n) : 0; });
def('COUNT', 1, MANY, (args, book) => {
  let n = 0;
  for (const a of args) {
    if (a instanceof Rng) book.each(a, v => { if (typeof v === 'number') n++; return true; });
    else if (typeof a === 'number' || typeof a === 'boolean' || (typeof a === 'string' && numText(a) != null)) n++;
  }
  return n;
});
def('COUNTA', 1, MANY, (args, book) => {
  let n = 0;
  for (const a of args) {
    if (a instanceof Rng) book.each(a, v => { if (v != null) n++; return true; });
    else if (a != null) n++;
  }
  return n;
});
def('IF', 1, 3, (args, book, ev, asRange) => {
  const c = toBool(one(ev(args[0], true), book));
  if (c instanceof CellError) return c;
  const pick = c ? args[1] : args[2];
  if (!pick) return c;
  if (pick.t === 'empty') return 0;
  return ev(pick, asRange);
}, { lazy: true });
function logic(args, book, fold, start) {
  let acc = start, seen = false;
  for (const a of args) {
    if (a instanceof Rng) {
      let bad = null;
      book.each(a, v => {
        if (v instanceof CellError) { bad = v; return false; }
        if (typeof v === 'boolean' || typeof v === 'number') { acc = fold(acc, typeof v === 'boolean' ? v : v !== 0); seen = true; }
        return true;
      });
      if (bad) return bad;
    } else if (a != null) {
      const v = toBool(a);
      if (v instanceof CellError) return v;
      acc = fold(acc, v); seen = true;
    }
  }
  return seen ? acc : ERR.VALUE;
}
def('AND', 1, MANY, (a, b) => logic(a, b, (x, y) => x && y, true));
def('OR', 1, MANY, (a, b) => logic(a, b, (x, y) => x || y, false));
def('NOT', 1, 1, (a, b) => { const v = toBool(one(a[0], b)); return v instanceof CellError ? v : !v; });
def('ROUND', 1, 2, (a, b) => {
  const x = numArg(a[0], b), d = a[1] == null ? 0 : numArg(a[1], b);
  const e = firstErr(x, d);
  if (e) return e;
  const k = Math.trunc(d), m = 10 ** k;
  const scaled = Number((Math.abs(x) * m).toPrecision(15));
  return fin(Math.sign(x) * Math.round(scaled) / m) || 0;
});
def('ABS', 1, 1, (a, b) => { const x = numArg(a[0], b); return x instanceof CellError ? x : Math.abs(x); });
def('SQRT', 1, 1, (a, b) => { const x = numArg(a[0], b); return x instanceof CellError ? x : x < 0 ? ERR.NUM : Math.sqrt(x); });
def('POWER', 2, 2, (a, b) => {
  const x = numArg(a[0], b), y = numArg(a[1], b);
  return firstErr(x, y) || (x === 0 && y < 0 ? ERR.DIV0 : fin(x ** y));
});
def('MOD', 2, 2, (a, b) => {
  const x = numArg(a[0], b), y = numArg(a[1], b);
  const e = firstErr(x, y);
  if (e) return e;
  if (y === 0) return ERR.DIV0;
  const r = x - y * Math.floor(x / y);
  return Number(r.toPrecision(15));
});
def('CONCAT', 1, MANY, (args, book) => {
  let s = '';
  for (const a of args) {
    if (a instanceof Rng) {
      let bad = null;
      book.each(a, v => { if (v instanceof CellError) { bad = v; return false; } s += toText(v); return true; }, true);
      if (bad) return bad;
    } else if (a instanceof CellError) return a;
    else s += toText(a);
  }
  return s;
});
def('LEN', 1, 1, (a, b) => { const t = textArg(a[0], b); return t instanceof CellError ? t : [...t].length; });
def('UPPER', 1, 1, (a, b) => { const t = textArg(a[0], b); return t instanceof CellError ? t : t.toUpperCase(); });
def('LOWER', 1, 1, (a, b) => { const t = textArg(a[0], b); return t instanceof CellError ? t : t.toLowerCase(); });
def('TRIM', 1, 1, (a, b) => { const t = textArg(a[0], b); return t instanceof CellError ? t : t.replace(/ +/g, ' ').trim(); });
def('LEFT', 1, 2, (a, b) => {
  const t = textArg(a[0], b), n = a[1] == null ? 1 : numArg(a[1], b);
  return firstErr(t, n) || (n < 0 ? ERR.VALUE : [...t].slice(0, Math.trunc(n)).join(''));
});
def('RIGHT', 1, 2, (a, b) => {
  const t = textArg(a[0], b), n = a[1] == null ? 1 : numArg(a[1], b);
  if (firstErr(t, n)) return firstErr(t, n);
  if (n < 0) return ERR.VALUE;
  const ch = [...t], k = Math.trunc(n);
  return k ? ch.slice(-k).join('') : '';
});
def('MID', 3, 3, (a, b) => {
  const t = textArg(a[0], b), s = numArg(a[1], b), n = numArg(a[2], b);
  return firstErr(t, s, n) || (s < 1 || n < 0 ? ERR.VALUE : [...t].slice(Math.trunc(s) - 1, Math.trunc(s) - 1 + Math.trunc(n)).join(''));
});
def('TODAY', 0, 0, (a, book) => Math.floor(nowSerial(book.now())), { volatile: true });
def('NOW', 0, 0, (a, book) => nowSerial(book.now()), { volatile: true });
def('VLOOKUP', 3, 4, (args, book) => {
  const key = one(args[0], book), rng = args[1];
  if (key instanceof CellError) return key;
  if (!(rng instanceof Rng)) return ERR.VALUE;
  const col = numArg(args[2], book);
  if (col instanceof CellError) return col;
  const k = Math.trunc(col);
  if (k < 1) return ERR.VALUE;
  if (k > rng.cols) return ERR.REF;
  const approx = args[3] == null ? true : toBool(one(args[3], book));
  if (approx instanceof CellError) return approx;
  const last = Math.min(rng.r2, book.extentOf(rng.sid).r);
  if (!approx) {
    const rx = typeof key === 'string' && /[*?~]/.test(key) ? wildcard(key) : null;
    for (let r = rng.r1; r <= last; r++) {
      const v = book.valueIn(rng.sid, r, rng.c1);
      if (v == null) continue;
      if (rx ? typeof v === 'string' && rx.test(v) : rank(v) === rank(key) && compare(v, key) === 0) return book.valueIn(rng.sid, r, rng.c1 + k - 1);
    }
    return ERR.NA;
  }
  /* approximate: the last row whose key is ≤ the one wanted (data sorted A→Z) */
  let hit = -1;
  for (let r = rng.r1; r <= last; r++) {
    const v = book.valueIn(rng.sid, r, rng.c1);
    if (v == null || rank(v) !== rank(key)) continue;
    if (compare(v, key) <= 0) hit = r; else break;
  }
  return hit < 0 ? ERR.NA : book.valueIn(rng.sid, hit, rng.c1 + k - 1);
});
/** walk a criteria range and its (same-shaped) partner range together */
function matching(rng, crit, other, book, fn) {
  const test = criterion(crit);
  const ext = book.extentOf(rng.sid);
  const r2 = Math.min(rng.r2, ext.r), c2 = Math.min(rng.c2, ext.c);
  for (let r = rng.r1; r <= r2; r++) {
    for (let c = rng.c1; c <= c2; c++) {
      if (test(book.valueIn(rng.sid, r, c))) fn(other ? book.valueIn(other.sid, other.r1 + r - rng.r1, other.c1 + c - rng.c1) : null);
    }
  }
  /* blank cells past the end of the data match "" too */
  const seen = Math.max(0, r2 - rng.r1 + 1) * Math.max(0, c2 - rng.c1 + 1);
  return { blanks: test(null) ? rng.rows * rng.cols - seen : 0 };
}
def('COUNTIF', 2, 2, (args, book) => {
  if (!(args[0] instanceof Rng)) return ERR.VALUE;
  const crit = one(args[1], book);
  let n = 0;
  const { blanks } = matching(args[0], crit, null, book, () => { n++; });
  return n + blanks;
});
function ifSum(args, book) {
  if (!(args[0] instanceof Rng)) return ERR.VALUE;
  if (args[2] != null && !(args[2] instanceof Rng)) return ERR.VALUE;
  const crit = one(args[1], book);
  const other = args[2] || args[0];
  let sum = 0, n = 0, bad = null;
  matching(args[0], crit, other, book, v => {
    if (v instanceof CellError) { bad = bad || v; return; }
    if (typeof v === 'number') { sum += v; n++; }
  });
  return bad || { sum, n };
}
def('SUMIF', 2, 3, (a, b) => { const r = ifSum(a, b); return r instanceof CellError ? r : r.sum; });
def('AVERAGEIF', 2, 3, (a, b) => { const r = ifSum(a, b); return r instanceof CellError ? r : r.n ? r.sum / r.n : ERR.DIV0; });

export const FUNCTION_NAMES = Object.keys(FUNCS).sort();

/* ------------------------------------------------------------------ */
/*  the book                                                          */
/* ------------------------------------------------------------------ */
const same = (a, b) => a === b || (a instanceof CellError && b instanceof CellError && a.code === b.code)
  || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));

export class Book {
  constructor() {
    this.sheets = [];
    this.byId = new Map();
    this.seq = 1;
    this.deps = new Map();       /* cell key → Set of formula keys that read it */
    this.rdeps = new Map();      /* sid·col bucket → [{ r1, r2, k }] ranges that cover that column */
    this.vol = new Set();        /* TODAY()/NOW() formulas: run on every recalc */
    this.now = () => new Date();
    this.stats = { evaluated: 0, ms: 0, cycles: 0 };
  }

  /* ---- sheets ---- */
  addSheet(name) {
    const sheet = { id: this.seq++, name: name || this.freeName(), cells: new Map(), colW: new Map(), maxR: -1, maxC: -1 };
    this.sheets.push(sheet);
    this.byId.set(sheet.id, sheet);
    return sheet;
  }
  freeName(base = 'Sheet') {
    for (let i = this.sheets.length + 1; ; i++) if (!this.sheetNamed(`${base}${i}`)) return `${base}${i}`;
  }
  sheet(sid) { return this.byId.get(sid) || null; }
  sheetNamed(name) {
    const low = String(name).toLowerCase();
    return this.sheets.find(s => s.name.toLowerCase() === low) || null;
  }
  /** rename; every formula that pointed at the old name follows it */
  renameSheet(sid, name) {
    const sh = this.sheet(sid);
    if (!sh || !name || (this.sheetNamed(name) && this.sheetNamed(name) !== sh)) return false;
    const old = sh.name;
    sh.name = name;
    for (const s of this.sheets) for (const cell of s.cells.values()) if (cell.f) cell.raw = renameSheetIn(cell.raw, old, name);
    this.relinkAll();
    return true;
  }
  removeSheet(sid) {
    const i = this.sheets.findIndex(s => s.id === sid);
    if (i < 0 || this.sheets.length < 2) return false;
    this.sheets.splice(i, 1);
    this.byId.delete(sid);
    this.relinkAll();
    return true;
  }

  /* ---- reading ---- */
  cell(sid, r, c) { const sh = this.byId.get(sid); return sh ? sh.cells.get(r * RSPAN + c) || null : null; }
  valueIn(sid, r, c) { const sh = this.byId.get(sid); const cell = sh && sh.cells.get(r * RSPAN + c); return cell ? cell.v : null; }
  cellByKey(k) { const { sid, r, c } = unkey(k); return this.cell(sid, r, c); }
  /** last used row/column of a sheet (an over-estimate after deletes) */
  extentOf(sid) { const sh = this.byId.get(sid); return sh ? { r: sh.maxR, c: sh.maxC } : { r: -1, c: -1 }; }
  /** the exact extent, recounted */
  recount(sid) {
    const sh = this.byId.get(sid);
    if (!sh) return { r: -1, c: -1 };
    let r = -1, c = -1;
    for (const cell of sh.cells.values()) if (cell.raw !== '') { if (cell.r > r) r = cell.r; if (cell.c > c) c = cell.c; }
    sh.maxR = r; sh.maxC = c;
    return { r, c };
  }
  /** call fn(value) for the cells of a range that hold something (or every
      cell up to the data's edge with `blanks`); fn returns false to stop */
  each(rng, fn, blanks = false) {
    const sh = this.byId.get(rng.sid);
    if (!sh) return;
    const r2 = Math.min(rng.r2, sh.maxR), c2 = Math.min(rng.c2, sh.maxC);
    const area = (r2 - rng.r1 + 1) * (c2 - rng.c1 + 1);
    if (area <= 0) return;
    if (!blanks && area > sh.cells.size * 4) {
      /* a big, sparse range: walk the cells that exist instead of the area */
      for (const cell of sh.cells.values()) {
        if (cell.r < rng.r1 || cell.r > r2 || cell.c < rng.c1 || cell.c > c2 || cell.v == null) continue;
        if (fn(cell.v) === false) return;
      }
      return;
    }
    for (let r = rng.r1; r <= r2; r++) {
      for (let c = rng.c1; c <= c2; c++) {
        const cell = sh.cells.get(r * RSPAN + c);
        const v = cell ? cell.v : null;
        if (v == null && !blanks) continue;
        if (fn(v) === false) return;
      }
    }
  }

  /* ---- writing ---- */
  /** Put typed input in a cell. Returns the cell's key when its content
      changed (hand those to recalc), or null when nothing changed. */
  set(sid, r, c, raw) {
    raw = raw == null ? '' : String(raw);
    const sh = this.byId.get(sid);
    if (!sh) return null;
    const lk = r * RSPAN + c, k = keyOf(sid, r, c);
    let cell = sh.cells.get(lk);
    if ((cell ? cell.raw : '') === raw) return null;
    if (cell && cell.links) this.unlink(k, cell);
    if (raw === '' && !(cell && cell.s)) { sh.cells.delete(lk); return k; }
    if (!cell) { cell = { r, c, raw: '', v: null, f: null, s: null, auto: null, links: null }; sh.cells.set(lk, cell); }
    cell.raw = raw;
    if (raw !== '') { if (r > sh.maxR) sh.maxR = r; if (c > sh.maxC) sh.maxC = c; }
    this.compile(sid, k, cell);
    return k;
  }
  /** a cell's style ({ b, i, al, nf, dp }) — no recalculation needed */
  setStyle(sid, r, c, s) {
    const sh = this.byId.get(sid);
    if (!sh) return;
    const lk = r * RSPAN + c;
    let cell = sh.cells.get(lk);
    const clean = s && Object.keys(s).length ? s : null;
    if (!cell) {
      if (!clean) return;
      cell = { r, c, raw: '', v: null, f: null, s: null, auto: null, links: null };
      sh.cells.set(lk, cell);
    }
    cell.s = clean;
    if (!clean && cell.raw === '') sh.cells.delete(lk);
  }
  compile(sid, k, cell) {
    cell.f = null; cell.auto = null; cell.links = null;
    this.vol.delete(k);
    if (isFormula(cell.raw)) {
      try {
        const { ast, refs, ranges, volatile } = parse(cell.raw.slice(1));
        cell.f = ast;
        if (ast.t === 'fn' && (ast.name === 'TODAY' || ast.name === 'NOW')) cell.auto = { nf: ast.name === 'TODAY' ? 'date' : 'datetime' };
        this.link(sid, k, cell, refs, ranges);
        if (volatile) this.vol.add(k);
      } catch (e) {
        cell.f = { t: 'err', v: new CellError('#ERROR!', e instanceof ParseError ? e.message : 'The formula could not be read') };
      }
      cell.v = null;
    } else {
      const L = parseLiteral(cell.raw);
      cell.v = L.v;
      cell.auto = L.fmt || null;
    }
  }
  link(sid, k, cell, refs, ranges) {
    const keys = [], rs = [];
    const sidOf = name => (name == null ? sid : (this.sheetNamed(name) || {}).id);
    for (const ref of refs) {
      const s = sidOf(ref.sheet);
      if (s == null) continue;
      const rk = keyOf(s, ref.r, ref.c);
      let set = this.deps.get(rk);
      if (!set) { set = new Set(); this.deps.set(rk, set); }
      set.add(k);
      keys.push(rk);
    }
    for (const g of ranges) {
      const s = sidOf(g.sheet);
      if (s == null) continue;
      const e = { r1: g.r1, r2: g.r2, k };
      for (let c = g.c1; c <= g.c2; c++) {
        const bk = s * RSPAN + c;
        let list = this.rdeps.get(bk);
        if (!list) { list = []; this.rdeps.set(bk, list); }
        list.push(e);
      }
      rs.push({ sid: s, c1: g.c1, c2: g.c2, e });
    }
    cell.links = { keys, rs };
  }
  unlink(k, cell) {
    const L = cell.links;
    if (!L) return;
    for (const rk of L.keys) { const set = this.deps.get(rk); if (set) { set.delete(k); if (!set.size) this.deps.delete(rk); } }
    for (const { sid, c1, c2, e } of L.rs) {
      for (let c = c1; c <= c2; c++) {
        const bk = sid * RSPAN + c;
        const list = this.rdeps.get(bk);
        if (!list) continue;
        const i = list.indexOf(e);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.rdeps.delete(bk);
      }
    }
    cell.links = null;
    this.vol.delete(k);
  }
  /** re-read every formula (after sheets were added, renamed or removed) */
  relinkAll() {
    this.deps.clear(); this.rdeps.clear(); this.vol.clear();
    for (const sh of this.sheets) for (const cell of sh.cells.values()) {
      cell.links = null;
      if (isFormula(cell.raw)) this.compile(sh.id, keyOf(sh.id, cell.r, cell.c), cell);
    }
    return this.recalcAll();
  }

  /* ---- recalculation ---- */
  dependents(k) {
    const out = new Set(this.deps.get(k));
    const { sid, r, c } = unkey(k);
    const list = this.rdeps.get(sid * RSPAN + c);
    if (list) for (const e of list) if (r >= e.r1 && r <= e.r2) out.add(e.k);
    return out;
  }
  recalcAll() {
    const all = [];
    for (const sh of this.sheets) for (const cell of sh.cells.values()) if (cell.f) all.push(keyOf(sh.id, cell.r, cell.c));
    return this.recalc(all);
  }
  /** Bring every formula downstream of `seeds` (changed cells' keys) up to
      date. Returns the set of keys whose value changed. */
  recalc(seeds) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const adj = new Map();
    const stack = [...seeds, ...this.vol];
    while (stack.length) {
      const k = stack.pop();
      if (adj.has(k)) continue;
      const d = this.dependents(k);
      adj.set(k, d);
      for (const x of d) if (!adj.has(x)) stack.push(x);
    }
    const F = [];
    for (const k of adj.keys()) { const cell = this.cellByKey(k); if (cell && cell.f) F.push(k); }
    const changed = new Set(seeds);
    let evaluated = 0;
    const run = k => {
      const cell = this.cellByKey(k);
      const old = cell.v;
      cell.v = this.evaluate(k, cell);
      evaluated++;
      if (!same(old, cell.v)) changed.add(k);
    };
    const kahn = (nodes, skip) => {
      const indeg = new Map();
      for (const k of nodes) indeg.set(k, 0);
      for (const k of nodes) for (const d of adj.get(k)) if (indeg.has(d)) indeg.set(d, indeg.get(d) + 1);
      const queue = [];
      for (const [k, n] of indeg) if (n === 0) queue.push(k);
      while (queue.length) {
        const k = queue.pop();
        run(k);
        for (const d of adj.get(k)) {
          if (!indeg.has(d)) continue;
          const n = indeg.get(d) - 1;
          indeg.set(d, n);
          if (n === 0) queue.push(d);
        }
      }
      return nodes.filter(k => indeg.get(k) > 0 && !(skip && skip.has(k)));
    };
    const rest = kahn(F);
    let cycles = 0;
    if (rest.length) {
      const cyc = this.cyclic(rest, adj);
      cycles = cyc.size;
      for (const k of cyc) {
        const cell = this.cellByKey(k);
        if (!same(cell.v, ERR.CIRC)) changed.add(k);
        cell.v = ERR.CIRC;
      }
      kahn(rest.filter(k => !cyc.has(k)));
    }
    this.stats = { evaluated, ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0, cycles };
    return changed;
  }
  /** keys (among `nodes`) that sit on a cycle — iterative Tarjan SCC */
  cyclic(nodes, adj) {
    const inSet = new Set(nodes);
    const index = new Map(), low = new Map(), onStack = new Set(), st = [], out = new Set();
    let next = 0;
    for (const root of nodes) {
      if (index.has(root)) continue;
      const work = [[root, [...adj.get(root)].filter(d => inSet.has(d)), 0]];
      index.set(root, next); low.set(root, next); next++; st.push(root); onStack.add(root);
      while (work.length) {
        const top = work[work.length - 1];
        const [v, kids] = top;
        if (top[2] < kids.length) {
          const w = kids[top[2]++];
          if (!index.has(w)) {
            index.set(w, next); low.set(w, next); next++; st.push(w); onStack.add(w);
            work.push([w, [...adj.get(w)].filter(d => inSet.has(d)), 0]);
          } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
          continue;
        }
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u), low.get(v))); }
        if (low.get(v) === index.get(v)) {
          const comp = [];
          let w;
          do { w = st.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
          if (comp.length > 1 || adj.get(v).has(v)) comp.forEach(x => out.add(x));
        }
      }
    }
    return out;
  }
  evaluate(k, cell) {
    const { sid, r, c } = unkey(k);
    let v;
    try { v = this.ev(cell.f, sid); }
    catch (e) { v = e instanceof CellError ? e : ERR.VALUE; }
    if (v instanceof Rng) v = v.single ? this.valueIn(v.sid, v.r1, v.c1) : ERR.VALUE;
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : ERR.NUM;
    return v;
  }
  /** evaluate a node; asRange keeps a reference as an Rng (function args) */
  ev(n, sid, asRange = false) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': return n.v;
      case 'empty': return null;
      case 'name': return ERR.NAME;
      case 'ref': {
        const s = n.sheet == null ? sid : (this.sheetNamed(n.sheet) || {}).id;
        if (s == null) return ERR.REF;
        return asRange ? new Rng(s, n.r, n.c, n.r, n.c) : this.valueIn(s, n.r, n.c);
      }
      case 'range': {
        const s = n.sheet == null ? sid : (this.sheetNamed(n.sheet) || {}).id;
        if (s == null) return ERR.REF;
        const g = new Rng(s, n.r1, n.c1, n.r2, n.c2);
        return asRange ? g : g.single ? this.valueIn(s, g.r1, g.c1) : ERR.VALUE;
      }
      case 'neg': { const x = toNum(this.ev(n.a, sid)); return x instanceof CellError ? x : -x; }
      case 'pct': { const x = toNum(this.ev(n.a, sid)); return x instanceof CellError ? x : x / 100; }
      case 'bin': {
        const A = this.ev(n.a, sid), B = this.ev(n.b, sid);
        if (A instanceof CellError) return A;
        if (B instanceof CellError) return B;
        if (n.op === '&') return toText(A) + toText(B);
        if (CMP.has(n.op)) {
          const d = compare(A, B);
          switch (n.op) {
            case '=': return d === 0;
            case '<>': return d !== 0;
            case '<': return d < 0;
            case '>': return d > 0;
            case '<=': return d <= 0;
            default: return d >= 0;
          }
        }
        const x = toNum(A), y = toNum(B);
        if (x instanceof CellError) return x;
        if (y instanceof CellError) return y;
        switch (n.op) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          case '/': return y === 0 ? ERR.DIV0 : x / y;
          default: return x === 0 && y < 0 ? ERR.DIV0 : fin(x ** y);
        }
      }
      case 'fn': {
        const f = FUNCS[n.name];
        if (!f) return ERR.NAME;
        if (f.lazy) return f.fn(n.args, this, (node, keep) => this.ev(node, sid, keep), asRange);
        const args = n.args.map(a => this.ev(a, sid, true));
        return f.fn(args, this);
      }
      default: return ERR.VALUE;
    }
  }

  /* ---- saving ---- */
  /** the book as plain data: what a .sheet file holds */
  toJSON(extra = {}) {
    return {
      type: 'staticos-sheet', v: 1,
      sheets: this.sheets.map(sh => {
        const cells = {};
        const list = [...sh.cells.values()].sort((a, b) => a.r - b.r || a.c - b.c);
        for (const cell of list) {
          if (cell.raw === '' && !cell.s) continue;
          cells[cellName(cell.r, cell.c)] = cell.s ? { v: cell.raw, s: cell.s } : cell.raw;
        }
        const cols = {};
        for (const [c, w] of [...sh.colW].sort((a, b) => a[0] - b[0])) cols[colName(c)] = w;
        return { name: sh.name, cells, cols };
      }),
      ...extra,
    };
  }
  static fromJSON(data) {
    if (!data || data.type !== 'staticos-sheet' || !Array.isArray(data.sheets)) throw new Error('This isn’t a Static Sheets file.');
    const book = new Book();
    for (const s of data.sheets) {
      const sh = book.addSheet(String(s.name || book.freeName()));
      for (const [name, val] of Object.entries(s.cells || {})) {
        const at = parseCellName(name);
        if (!at) continue;
        const raw = typeof val === 'string' ? val : val && typeof val.v === 'string' ? val.v : '';
        const style = val && typeof val === 'object' && val.s && typeof val.s === 'object' ? { ...val.s } : null;
        const lk = at.r * RSPAN + at.c;
        sh.cells.set(lk, { r: at.r, c: at.c, raw, v: null, f: null, s: style, auto: null, links: null });
        if (raw !== '') { if (at.r > sh.maxR) sh.maxR = at.r; if (at.c > sh.maxC) sh.maxC = at.c; }
      }
      for (const [name, w] of Object.entries(s.cols || {})) {
        const c = /^[A-Za-z]{1,3}$/.test(name) ? colIndex(name) : -1;
        if (c >= 0 && c < MAX_COLS && Number.isFinite(w)) sh.colW.set(c, Math.max(24, Math.min(800, w)));
      }
    }
    if (!book.sheets.length) book.addSheet();
    /* compile every cell: values first, then formulas (whose links need every sheet to exist) */
    for (const sh of book.sheets) for (const cell of sh.cells.values()) if (!isFormula(cell.raw)) book.compile(sh.id, keyOf(sh.id, cell.r, cell.c), cell);
    book.relinkAll();
    return book;
  }
}

/** one evaluation outside any cell — what the formula bar previews */
export function evaluateFormula(book, sid, raw) {
  try { const { ast } = parse(String(raw).replace(/^=/, '')); return book.evaluate(keyOf(sid, 0, 0), { f: ast }); }
  catch (e) { return new CellError('#ERROR!', e.message); }
}
