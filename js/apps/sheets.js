/* ============================================================
   sheets.js — Static Sheets: a spreadsheet.

   The formula engine, CSV and charts live in js/sheets/ (engine.js,
   csv.js, chart.js); this file is the window: the grid, editing,
   clipboard, undo, find, charts panel, sheet tabs and files.

   GRID
   · Virtualised both ways. One scroller holds a sticky header row
     and a body as tall as every row; only the rows and columns in
     view (plus a few spare) exist as elements, and they are reused
     as you scroll, so 10,000 rows cost what 40 do. Row numbers are
     sticky inside each row, so the frozen header row and column are
     plain CSS — scrolling stays on the compositor.
   · ARIA grid: role=grid (one Tab stop, aria-activedescendant on the
     active cell), rows with aria-rowindex, cells with aria-colindex
     and aria-selected, row/column headers. The in-cell editor sits
     outside the grid, over it.
   · Keys: arrows (⇧ selects, ⌘/Ctrl jumps to the data's edge), Enter
     or F2 edits, typing replaces, Delete clears, ⌘C/X/V go through
     the real clipboard as tab-separated text (what Excel and Google
     Sheets use), ⌘Z/⇧⌘Z, ⌘D/⌘R fill, ⌘B/⌘I, ⌘F find, ⌘S save.
     Tab leaves the grid (no keyboard trap); while editing, Tab saves
     and moves right. While typing a formula, arrows or clicks after
     an operator insert a reference (⇧ / drag for a range).
   · Rows are 24px, except a row with wrapped text (as tall as its
     text needs, worked out from the words and the column's width) and
     a row a filter hides (0). Those few are kept in a sorted list with
     a running total, so "where is row r" and "which row is at y" are
     binary searches, and a sheet without any costs nothing.
   · Frozen rows and columns are in-flow sticky elements at the start
     of the body and of each row; everything else stays absolutely
     placed. Merged cells are one box drawn over their area.

   DATA AND FORMAT (each one undoable, and saved in the .sheet file)
   · Sort a range by a column (A → Z, Z → A; a header row is kept on
     top); filters on a header row (values to show, or a condition);
     conditional formatting (first matching rule colours the cell);
     dropdowns and number checks (refused, or allowed and marked);
     freeze, borders, merge, wrap; tab colours; duplicate a sheet.
   · Describe my data sends the selected cells' shown values to the
     model in Settings › AI model (js/portal/llm.js), only when pressed;
     the reply is text in a panel and never goes into a cell.
   · Send to Statistics hands a column (or two, as x and y) to Static
     Study's Statistics tab. Print lays the sheet out as a table.

   FILES
   · .sheet (JSON: every sheet, formulas, formats, widths, charts)
     saves itself a moment after each change, like Notes.
   · An untitled workbook becomes ~/Documents/Untitled sheet.sheet on
     its first change — nothing typed is ever only in memory.
   · .csv / .tsv open from Files. While the workbook is plain values
     on one sheet, edits save straight back to the CSV. Once it holds
     what CSV can't (formulas, formatting, charts, more sheets) it
     stops writing the CSV by itself: ⌘S saves the values (and says
     what was left out), Save as keeps everything as .sheet, and
     unsaved edits wait in IndexedDB to be restored on the next open.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as profiles from '../core/profiles.js';
import media from '../core/media.js';
import { kv } from '../core/db.js';
import * as fileimport from '../core/fileimport.js';
import { roving } from '../core/roving.js';
import * as E from '../sheets/engine.js';
import CSV from '../sheets/csv.js';
import * as Chart from '../sheets/chart.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-sheets-css')) {
  const link = document.createElement('link');
  link.id = 'feat-sheets-css';
  link.rel = 'stylesheet';
  link.href = 'css/feat-sheets.css';
  document.head.appendChild(link);
}

/* geometry — mirrored in css/feat-sheets.css */
const ROW_H = 24, HEAD_H = 24, HEAD_W = 52, COL_W = 100, MIN_W = 28, MAX_W = 800;
const MIN_ROWS = 1000, MIN_COLS = 26, OVER_R = 6;
const BIG = 50000;               /* a selection over this many cells is cut to the data */
const UNDO_MAX = 100;
const VFS_KEY = profiles.key('staticos.vfs.v1'), VFS_ROOM = 2_400_000;   /* this person's (core/profiles.js) */
const NF = [['general', 'General'], ['number', 'Number'], ['percent', 'Percent'], ['currency', 'Currency'], ['date', 'Date']];
const ARROW = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const LK = (r, c) => r * 16384 + c;                 /* a cell's key inside its sheet (engine.js) */
const misc = kv('misc');
const RKEY = p => `sheets.recover:${p}`;
const openDocs = new Map();                           /* path → the window that has it open */
let redirectOn = false, seq = 0;

const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const stemOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };
const safeName = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtOf = x => (x && x.s && x.s.nf ? { nf: x.s.nf, dp: x.s.dp } : x ? x.auto : null);
const rectOf = (a, b) => ({ r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });
function sameStyle(a, b) {
  const A = a || {}, B = b || {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if (A[k] !== B[k]) return false;
  return true;
}
function cleanStyle(s) {
  const o = {};
  if (s.b) o.b = true;
  if (s.i) o.i = true;
  if (s.al) o.al = s.al;
  if (s.nf) { o.nf = s.nf; if (Number.isFinite(s.dp)) o.dp = s.dp; }
  if (s.wr) o.wr = true;
  const bd = typeof s.bd === 'string' ? 'tblr'.split('').filter(k => s.bd.includes(k)).join('') : '';
  if (bd) o.bd = bd;
  return Object.keys(o).length ? o : null;
}

/* ---- what a sheet keeps besides its cells (sheet.meta, saved in the .sheet file) ----
   freeze  { r, c }               rows above r and columns left of c stay put
   merges  [{ r1, c1, r2, c2 }]   one cell drawn over the area (the top-left one's);
                                  the cells under it are kept, and come back on unmerge
   filter  { r1, c1, r2, c2, by } r1 is the header row; by[col] = { vals?, op?, a? }
   cf      [{ r1…c2, op, a, b, fill, bold }]   conditional formatting: first rule that matches
   dv      [{ r1…c2, kind, opts, min, max, strict }]  a dropdown list or a number check
   tab     1-8                    the tab's colour (--chart-N)
   Every part is checked when a file is read: a rule that doesn't make sense is dropped. */
const CF_OPS = [['gt', 'Greater than'], ['lt', 'Less than'], ['ge', 'At least'], ['le', 'At most'], ['eq', 'Equal to'], ['ne', 'Not equal to'], ['between', 'Between'], ['text', 'Text contains'], ['empty', 'Is empty'], ['filled', 'Is not empty']];
const FILLS = [['red', 'Red', 8], ['orange', 'Orange', 2], ['yellow', 'Yellow', 4], ['green', 'Green', 3], ['blue', 'Blue', 1], ['purple', 'Purple', 7], ['pink', 'Pink', 5]];
const TAB_COLORS = [['', 'No colour'], [1, 'Blue'], [2, 'Orange'], [3, 'Green'], [4, 'Yellow'], [5, 'Pink'], [6, 'Dark green'], [7, 'Purple'], [8, 'Red']];
const FILTER_OPS = [['', 'No condition'], ['gt', 'Greater than'], ['lt', 'Less than'], ['eq', 'Equal to'], ['ne', 'Not equal to'], ['text', 'Contains'], ['empty', 'Is empty'], ['filled', 'Is not empty']];
const CF_MAX = 100, DV_MAX = 100, MERGE_MAX = 500, MERGE_AREA = 20000, FILTER_VALS = 2000, FREEZE_R = 30, FREEZE_C = 12;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function cleanRect(o) {
  if (!o || typeof o !== 'object') return null;
  const { r1, c1, r2, c2 } = o;
  if (![r1, r2].every(v => isInt(v, 0, E.MAX_ROWS - 1)) || ![c1, c2].every(v => isInt(v, 0, E.MAX_COLS - 1)) || r2 < r1 || c2 < c1) return null;
  return { r1, c1, r2, c2 };
}
const overlaps = (a, b) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
const shortText = (v, n) => (typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
function cleanMeta(m) {
  const o = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return o;
  if (m.freeze && (isInt(m.freeze.r, 0, FREEZE_R) || isInt(m.freeze.c, 0, FREEZE_C))) {
    const r = isInt(m.freeze.r, 0, FREEZE_R) ? m.freeze.r : 0, c = isInt(m.freeze.c, 0, FREEZE_C) ? m.freeze.c : 0;
    if (r || c) o.freeze = { r, c };
  }
  if (Array.isArray(m.merges)) {
    const out = [];
    for (const x of m.merges.slice(0, MERGE_MAX)) {
      const g = cleanRect(x);
      if (!g || (g.r1 === g.r2 && g.c1 === g.c2) || (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > MERGE_AREA || out.some(y => overlaps(y, g))) continue;
      out.push(g);
    }
    if (out.length) o.merges = out;
  }
  if (m.filter) {
    const g = cleanRect(m.filter);
    if (g && g.c2 - g.c1 < 200) {
      const by = {};
      for (const [k, v] of Object.entries(m.filter.by && typeof m.filter.by === 'object' ? m.filter.by : {})) {
        const c = Number(k);
        if (!isInt(c, g.c1, g.c2) || !v || typeof v !== 'object') continue;
        const f = {};
        if (Array.isArray(v.vals)) f.vals = v.vals.filter(x => typeof x === 'string').slice(0, FILTER_VALS).map(x => x.slice(0, 200));
        if (FILTER_OPS.some(p => p[0] && p[0] === v.op)) { f.op = v.op; f.a = shortText(v.a, 200); }
        if (f.vals || f.op) by[c] = f;
      }
      o.filter = { ...g, by };
    }
  }
  if (Array.isArray(m.cf)) {
    const out = [];
    for (const x of m.cf.slice(0, CF_MAX)) {
      const g = cleanRect(x);
      if (!g || !CF_OPS.some(p => p[0] === x.op) || !FILLS.some(f => f[0] === x.fill)) continue;
      out.push({ ...g, op: x.op, a: shortText(x.a, 200), b: shortText(x.b, 200), fill: x.fill, bold: x.bold === true });
    }
    if (out.length) o.cf = out;
  }
  if (Array.isArray(m.dv)) {
    const out = [];
    for (const x of m.dv.slice(0, DV_MAX)) {
      const g = cleanRect(x);
      if (!g || !['list', 'int', 'num'].includes(x.kind)) continue;
      const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const opts = x.kind === 'list' && Array.isArray(x.opts) ? [...new Set(x.opts.filter(s => typeof s === 'string').map(s => s.trim().slice(0, 100)).filter(Boolean))].slice(0, 100) : [];
      if (x.kind === 'list' && !opts.length) continue;
      out.push({ ...g, kind: x.kind, opts, min: num(x.min), max: num(x.max), strict: x.strict !== false });
    }
    if (out.length) o.dv = out;
  }
  if (isInt(m.tab, 1, 8)) o.tab = m.tab;
  return o;
}
/** one cell's value against a rule's condition (conditional formatting and filters) */
function testOp(op, v, shown, a, b) {
  if (op === 'empty') return v == null || v === '';
  if (op === 'filled') return !(v == null || v === '');
  if (op === 'text') return !!a && String(shown).toLowerCase().includes(String(a).toLowerCase());
  if (v == null || v === '') return false;
  const A = E.parseLiteral(String(a ?? '').trim()).v, B = E.parseLiteral(String(b ?? '').trim()).v;
  const num = typeof v === 'number' && typeof A === 'number';
  const d = num ? (Math.abs(v - A) < 1e-12 ? 0 : v < A ? -1 : 1)
    : String(shown).toLowerCase().localeCompare(String(a ?? '').trim().toLowerCase(), undefined, { sensitivity: 'base' });
  switch (op) {
    case 'gt': return (num || typeof A !== 'number') && d > 0;
    case 'lt': return (num || typeof A !== 'number') && d < 0;
    case 'ge': return (num || typeof A !== 'number') && d >= 0;
    case 'le': return (num || typeof A !== 'number') && d <= 0;
    case 'eq': return d === 0;
    case 'ne': return d !== 0;
    case 'between': {
      if (typeof v !== 'number' || typeof A !== 'number' || typeof B !== 'number') return false;
      return v >= Math.min(A, B) && v <= Math.max(A, B);
    }
    default: return false;
  }
}
/** does a value pass a dropdown / number check? (an empty cell always does) */
function dvPass(d, v, shown) {
  if (v == null || v === '') return true;
  if (d.kind === 'list') return d.opts.some(o => o.toLowerCase() === String(shown).trim().toLowerCase());
  if (typeof v !== 'number') return false;
  if (d.kind === 'int' && !Number.isInteger(v)) return false;
  return (d.min == null || v >= d.min) && (d.max == null || v <= d.max);
}
const dvSays = d => {
  if (d.kind === 'list') return `one of: ${d.opts.slice(0, 6).join(', ')}${d.opts.length > 6 ? '…' : ''}`;
  const what = d.kind === 'int' ? 'a whole number' : 'a number';
  if (d.min != null && d.max != null) return `${what} from ${E.general(d.min)} to ${E.general(d.max)}`;
  if (d.min != null) return `${what} of at least ${E.general(d.min)}`;
  if (d.max != null) return `${what} of at most ${E.general(d.max)}`;
  return what;
};
/** sort order: numbers, then text (A–Z, any case), then TRUE/FALSE, then errors; blanks always last */
function sortKey(a, b, desc) {
  const blank = v => v == null || v === '';
  if (blank(a) || blank(b)) return blank(a) === blank(b) ? 0 : blank(a) ? 1 : -1;
  const rank = v => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3);
  let d = rank(a) - rank(b);
  if (!d) {
    if (typeof a === 'number') d = a - b;
    else if (typeof a === 'string') d = a.localeCompare(b, undefined, { sensitivity: 'base' });
    else if (typeof a === 'boolean') d = (a ? 1 : 0) - (b ? 1 : 0);
    else d = String(a.code).localeCompare(String(b.code));
  }
  return desc ? -d : d;
}
const lowerBound = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };
const sheetNameFor = stem => (String(stem || '').replace(/[[\]*?/\\:]+/g, ' ').trim().slice(0, 60) || 'Sheet1');
let mctx = null;
const textW = (t, font) => { mctx = mctx || document.createElement('canvas').getContext('2d'); mctx.font = font; return mctx.measureText(t).width; };
/** the grid's font, from the tokens (the stylesheet may still be loading) */
function gridFont(bold = false) {
  const cs = getComputedStyle(document.documentElement);
  const k = parseFloat(cs.getPropertyValue('--fs-k')) || 1;
  const fam = cs.getPropertyValue('--font').trim() || 'system-ui, sans-serif';
  return `${bold ? '700 ' : ''}${Math.round(12 * k)}px ${fam}`;
}

defineApp({
  id: 'sheets',
  name: 'Static Sheets',
  icon: 'table',
  g1: '#8ee6b0', g2: '#14794a',
  category: 'Productivity',
  keywords: ['spreadsheet', 'sheet', 'sheets', 'excel', 'csv', 'tsv', 'table', 'formula', 'chart', 'budget', 'numbers', 'cells', 'sort', 'filter', 'conditional formatting', 'dropdown', 'freeze', 'merge', 'scatter', 'trend line', 'xlookup'],
  desc: 'Spreadsheets with formulas and charts; opens and saves CSV',
  pinned: true,
  handles: ['sheet'],
  win: { w: 920, h: 600, minW: 520, minH: 360 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['Up / Down / Left / Right', 'Move; with Shift, select'],
    ['Mod+Up / Mod+Down / Mod+Left / Mod+Right', 'Jump to the edge of the data'],
    ['Enter / F2', 'Edit the cell (typing replaces it)'],
    ['Enter / Tab', 'While editing: keep it and move down / right'],
    ['Esc', 'Cancel the edit'],
    ['Delete', 'Clear the selected cells'],
    ['Mod+C / Mod+X / Mod+V', 'Copy, cut, paste (tab-separated, like other spreadsheets)'],
    ['Mod+Z / Mod+Shift+Z', 'Undo / redo'],
    ['Mod+D / Mod+R', 'Fill down / fill right'],
    ['Mod+B / Mod+I', 'Bold / italic'],
    ['Mod+F', 'Find'],
    ['Mod+S', 'Save'],
    ['Mod+A', 'Select everything'],
    ['Shift+Space', 'Select the row'],
    ['Shift+F10', 'Cell menu: fill, clear, charts, column width'],
    ['Alt+Down', 'Open a filter header’s or a dropdown cell’s list'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs } = api;
    const uid = `ss${++seq}`;
    const MODK = api.fmt.modLabel === '⌘' ? '⌘' : 'Ctrl+';
    const SHIFT = api.fmt.modLabel === '⌘' ? '⇧' : 'Shift+';

    /* a file that is already open in a Sheets window brings that window forward */
    if (!redirectOn && api.wm && api.wm.redirectApp) {
      redirectOn = true;
      api.wm.redirectApp('sheets', o => {
        const p = o && o.path ? vfs.norm(o.path) : null;
        const w = p ? openDocs.get(p) : null;
        if (!w) return undefined;
        if (w.min) w.restore(); else w.focus();
        return w;
      });
    }

    /* ---------------- state ---------------- */
    const S = {
      book: null, sid: 0,
      cur: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 },
      views: new Map(),
      edit: null,
      doc: { path: null, kind: null, readOnly: false, gone: false, written: null, delim: ',', auto: false },
      dirty: false, problem: '', warnedBig: false,
      charts: [], showCharts: false, chartSeq: 0,
      undo: [], redo: [],
      clip: null,
      find: { open: false, hits: [], set: null, i: -1, now: -1 },
      dead: false,
    };

    /* ---------------- chrome ---------------- */
    const live = h('div.sr', { 'aria-live': 'polite' });
    let sayT = 0;
    const say = t => { clearTimeout(sayT); live.textContent = ''; sayT = setTimeout(() => { live.textContent = t; }, 40); };
    const tb = (ic, label, fn, keys, cls = '.tip--below') => h(`button.ibtn.tip${cls}`, {
      type: 'button', 'data-tip': keys ? `${label}  ${keys}` : label, 'aria-label': label, onclick: fn,
    }, icon(ic));
    const sep = () => h('span.ss-sep', { 'aria-hidden': 'true' });

    const bUndo = tb('undo', 'Undo', () => undo(), `${MODK}Z`);
    const bRedo = tb('redo', 'Redo', () => redo(), `${SHIFT}${MODK}Z`);
    const bBold = tb('bold', 'Bold', () => toggleStyle('b'), `${MODK}B`);
    const bItal = tb('italic', 'Italic', () => toggleStyle('i'), `${MODK}I`);
    const bAl = { left: tb('align-left', 'Align left', () => align('left')), center: tb('align-center', 'Align centre', () => align('center')), right: tb('align-right', 'Align right', () => align('right')) };
    const selFmt = h('select.select', { 'aria-label': 'Number format', onchange: () => setFormat(selFmt.value) },
      NF.map(([v, t]) => h('option', { value: v, text: t })));
    const decBtn = (txt, label, d) => h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': label, 'aria-label': label, onclick: () => decimals(d) },
      h('span.ss-dec', { text: txt, 'aria-hidden': 'true' }));
    const bLess = decBtn('.0−', 'Fewer decimal places', -1);
    const bMore = decBtn('.00+', 'More decimal places', 1);
    const bFillD = tb('arrow-down', 'Fill down', () => fill('down'), `${MODK}D`);
    const bFillR = tb('arrow-right', 'Fill right', () => fill('right'), `${MODK}R`);
    const chartCount = h('span.ss-bar__count');
    const bCharts = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Charts panel', 'aria-label': 'Charts panel', 'aria-pressed': 'false', onclick: () => toggleCharts() }, icon('sidebar'), chartCount);
    /* after a toolbar action the keyboard goes back to the grid (unless a dialog took it) */
    const backToGrid = () => { if (!S.dead && !app.querySelector('.ss-dlg') && !aiPanel.contains(document.activeElement)) grid.focus({ preventScroll: true }); };
    /* a toolbar button that opens a menu under itself */
    const mb = (ic, label, items) => {
      const b = tb(ic, label, () => {
        const r = b.getBoundingClientRect();
        const wrapIt = it => (it && typeof it === 'object' && it.onClick ? { ...it, onClick: () => { it.onClick(); backToGrid(); } } : it);
        api.menu(items().map(wrapIt), r.left, r.bottom + 4, { label });
      });
      b.setAttribute('aria-haspopup', 'menu');
      return b;
    };
    const bWrap = h('button.ibtn.tip.tip--below', { type: 'button', 'data-tip': 'Wrap text', 'aria-label': 'Wrap text', 'aria-pressed': 'false', onclick: () => { toggleStyle('wr'); backToGrid(); } },
      h('span.ss-dec', { text: 'a↵b', 'aria-hidden': 'true' }));
    const bar = h('div.app__bar.ss-bar', { role: 'toolbar', 'aria-label': 'Sheet tools' },
      bUndo, bRedo, sep(), bBold, bItal, bWrap, sep(), bAl.left, bAl.center, bAl.right, sep(), selFmt, bLess, bMore, sep(),
      bFillD, bFillR, sep(),
      mb('grid', 'Borders and merging', () => formatItems()),
      mb('filter', 'Sort and filter', () => dataItems()),
      mb('snowflake', 'Freeze rows and columns', () => freezeItems()),
      sep(),
      tb('bar-chart', 'Bar chart from selection', () => addChart('bar')),
      tb('line-chart', 'Line chart from selection', () => addChart('line')),
      tb('pie-chart', 'Pie chart from selection', () => addChart('pie')),
      mb('trending-up', 'More charts', () => Chart.TYPES.filter(t => !['bar', 'line', 'pie'].includes(t)).map(t => ({ label: `${Chart.TYPE_NAMES[t]} chart`, icon: Chart.TYPE_ICONS[t], onClick: () => addChart(t) }))),
      h('div.ss-grow'),
      tb('sparkles', 'Describe my data (AI)', () => describeData()),
      tb('search', 'Find', () => openFind(), `${MODK}F`), bCharts);

    const nameBox = h('input.ss-name', { 'aria-label': 'Cell reference — type one and press Enter to go there', spellcheck: 'false', autocomplete: 'off' });
    const fx = h('textarea.ss-input', { 'aria-label': 'Cell contents', spellcheck: 'false', rows: '1', autocomplete: 'off' });
    const fxRow = h('div.ss-fx', nameBox, h('span.ss-fxlabel', { text: 'fx', 'aria-hidden': 'true' }), fx);

    const findIn = h('input', { type: 'search', placeholder: 'Find in this sheet', 'aria-label': 'Find in this sheet', spellcheck: 'false' });
    const findN = h('span.ss-find__n', { 'aria-live': 'polite' });
    const findBar = h('div.ss-find', { role: 'search', hidden: true },
      h('div.field', icon('search'), findIn), findN,
      tb('chevron-up', 'Previous match', () => findStep(-1), `${SHIFT}Enter`),
      tb('chevron-down', 'Next match', () => findStep(1), 'Enter'),
      h('div.ss-grow'), tb('x', 'Close find', () => closeFind(), 'Esc'));
    const banner = h('div.ss-banner', { hidden: true, role: 'status' });

    const corner = h('div.ss-corner', { role: 'columnheader', 'aria-colindex': '1', 'aria-label': 'Row numbers (click to select everything)' });
    const head = h('div.ss-head', { role: 'row', 'aria-rowindex': '1' }, corner);
    const selBox = h('div.ss-sel', { 'aria-hidden': 'true' });
    const curBox = h('div.ss-cur', { 'aria-hidden': 'true' });
    const clipBox = h('div.ss-clip', { 'aria-hidden': 'true' });
    const ptBox = h('div.ss-pt', { 'aria-hidden': 'true' });
    const body = h('div.ss-body', selBox, clipBox, ptBox, curBox);
    const grid = h('div.ss-scroll', { id: `${uid}-grid`, role: 'grid', tabindex: '0', 'aria-multiselectable': 'true', dataset: { ownArrows: '' } }, head, body);
    const editor = h('textarea.ss-editor', { 'aria-label': 'Edit cell', spellcheck: 'false', rows: '1', autocomplete: 'off' });
    const wrap = h('div.ss-wrap', grid, editor);
    const panel = h('aside.ss-charts', { hidden: true, 'aria-label': 'Charts' });
    const mid = h('div.ss-mid', wrap, panel);

    const tabs = h('div.ss-tabs', { role: 'tablist', 'aria-label': 'Sheets' });
    const status = h('div.ss-status');
    const foot = h('div.app__bar.app__bar--foot.ss-foot', tabs, tb('plus', 'Add sheet', () => addSheet(), null, ''), h('div.ss-grow'), status);
    const picker = h('input', { type: 'file', accept: '.csv,.tsv,text/csv,text/tab-separated-values', hidden: true });
    const app = h('div.app.app--col.ss', bar, fxRow, findBar, banner, mid, foot, live, picker);
    root.appendChild(app);
    const offRove = roving(bar, { items: 'button, select', orientation: 'horizontal' });
    /* ⌘Z / ⇧⌘Z work from the toolbar too, straight after pressing one of its buttons */
    bar.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
    });

    win.setTools(
      h('button.ibtn.tip', { type: 'button', 'data-tip': `Save  ${MODK}S`, 'aria-label': 'Save', onclick: () => saveCmd() }, icon('save')),
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'File', 'aria-label': 'File menu', 'aria-haspopup': 'menu', onclick: e => fileMenu(e.currentTarget) }, icon('more-horizontal')),
    );

    /* ================= geometry ================= */
    let nRows = MIN_ROWS, nCols = 0, colX = new Float64Array(1), colsDirty = true, totalW = 0, lastW = -1, lastH = -1, lastRC = '';
    const sheet = () => S.book.sheet(S.sid);
    const width = c => sheet().colW.get(c) || COL_W;
    /* rows that aren't ROW_H tall: sorted, with acc[j] = how much taller than
       ROW_H the rows before the j-th one are, all together */
    let RG = { rows: [], hs: [], acc: [0] };
    let hidden = new Set();                         /* rows the filter hides */
    let FR = 0, FC = 0;                             /* frozen rows, frozen columns */
    const rowTop = r => (RG.rows.length ? r * ROW_H + RG.acc[lowerBound(RG.rows, r)] : r * ROW_H);
    const rowH = r => { if (!RG.rows.length) return ROW_H; const j = lowerBound(RG.rows, r); return RG.rows[j] === r ? RG.hs[j] : ROW_H; };
    /** the row at y (body px): the last row that starts at or above it */
    function rowAt(y) {
      if (y <= 0) return 0;
      if (!RG.rows.length) return Math.floor(y / ROW_H);
      let lo = 0, hi = Math.max(nRows, RG.rows[RG.rows.length - 1] + 1) - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rowTop(m) <= y) lo = m; else hi = m - 1; }
      return lo;
    }
    const frozenH = () => (FR ? rowTop(FR) : 0);
    const frozenW = () => (FC ? colX[Math.min(FC, nCols)] : 0);
    function layout() {
      const ext = S.book.extentOf(S.sid);
      const fr = Number.isFinite(S.focus.r) ? S.focus.r : 0, fc = Number.isFinite(S.focus.c) ? S.focus.c : 0;
      const rows = Math.min(E.MAX_ROWS, Math.max(MIN_ROWS, ext.r + 101, S.cur.r + 51, fr + 51));
      const cols = Math.min(E.MAX_COLS, Math.max(MIN_COLS, ext.c + 6, S.cur.c + 6, fc + 6, FC + 6));
      if (cols !== nCols || colsDirty) {
        nCols = cols;
        colX = new Float64Array(cols + 1);
        for (let c = 0; c < cols; c++) colX[c + 1] = colX[c] + width(c);
        colsDirty = false;
      }
      nRows = rows;
      totalW = HEAD_W + colX[nCols];
      if (totalW !== lastW) { head.style.width = `${totalW}px`; body.style.width = `${totalW}px`; lastW = totalW; }
      const hh = rowTop(nRows);
      if (hh !== lastH) { body.style.height = `${hh}px`; lastH = hh; }
      const rc = `${nRows + 1}x${nCols + 1}`;
      if (rc !== lastRC) { grid.setAttribute('aria-rowcount', String(nRows + 1)); grid.setAttribute('aria-colcount', String(nCols + 1)); lastRC = rc; }
    }
    /** the column under x (content px, row numbers excluded) */
    function colAt(x) {
      if (x <= 0) return 0;
      let lo = 0, hi = nCols - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (colX[m] <= x) lo = m; else hi = m - 1; }
      return lo;
    }

    /* ================= what the sheet keeps besides cells ================= */
    /* indexes over sheet.meta, rebuilt when the meta object changes (every
       change makes a new one, so identity says when) */
    let IX = { meta: null, merges: [], mergeRows: new Map(), cf: [], dv: [], filter: null };
    function ix() {
      const m = sheet().meta || {};
      if (IX.meta === m) return IX;
      const mergeRows = new Map();
      for (const g of m.merges || []) for (let r = g.r1; r <= g.r2; r++) { const a = mergeRows.get(r); if (a) a.push(g); else mergeRows.set(r, [g]); }
      IX = { meta: m, merges: m.merges || [], mergeRows, cf: m.cf || [], dv: m.dv || [], filter: m.filter || null };
      return IX;
    }
    const mergeAt = (r, c) => { const a = ix().mergeRows.get(r); return a ? a.find(g => c >= g.c1 && c <= g.c2) || null : null; };
    const ruleAt = (list, r, c) => list.find(g => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) || null;
    const shownOf = x => (x && x.raw !== '' ? E.formatValue(x.v, fmtOf(x)) : '');
    /** the filter's range as it stands: the header row, and the data under it down to where it ends */
    function filterSpan(f = ix().filter) {
      if (!f) return null;
      const ext = S.book.extentOf(S.sid);
      let r2 = f.r2;
      const rowFilled = r => { for (let c = f.c1; c <= f.c2; c++) if (filled(r, c)) return true; return false; };
      while (r2 < ext.r && rowFilled(r2 + 1)) r2++;
      return { ...f, r2 };
    }
    /** which rows the filter hides now (worked out when it changes, as other spreadsheets do) */
    let fltEnd = -1;                                /* the filter's last row, when it was applied */
    function applyFilter() {
      const f = filterSpan();
      const out = new Set();
      fltEnd = f ? f.r2 : -1;
      if (f && Object.keys(f.by).length) {
        for (let r = f.r1 + 1; r <= f.r2; r++) {
          for (const [k, rule] of Object.entries(f.by)) {
            const x = S.book.cell(S.sid, r, Number(k)), v = x ? x.v : null, shown = shownOf(x);
            if ((rule.vals && !rule.vals.includes(shown)) || (rule.op && !testOp(rule.op, v, shown, rule.a))) { out.add(r); break; }
          }
        }
      }
      hidden = out;
    }
    /* how tall a wrapped cell's text is in its column, measured with the grid's font */
    function wrapLines(text, wpx, font) {
      let n = 0;
      for (const para of String(text).split('\n')) {
        n++;
        let line = '';
        for (const word of para.split(/(\s+)/)) {
          const next = line + word;
          if (!line || textW(next, font) <= wpx) { line = next; continue; }
          n++;
          line = word.trimStart();
          while (line && textW(line, font) > wpx && line.length > 1) {        /* a word longer than the column */
            let k = line.length;
            while (k > 1 && textW(line.slice(0, k), font) > wpx) k--;
            line = line.slice(k);
            if (line) n++;
          }
        }
        if (n > 40) return 40;
      }
      return n;
    }
    function rebuildRows() {
      const sh = sheet(), hs = new Map();
      for (const r of hidden) hs.set(r, 0);
      let font = null, k = 0;
      for (const x of sh.cells.values()) {
        if (!x.s || !x.s.wr || x.raw === '' || hidden.has(x.r) || mergeAt(x.r, x.c)) continue;
        if (++k > 4000) break;
        font = font || gridFont();
        const want = Math.min(600, Math.max(ROW_H, wrapLines(shownOf(x), width(x.c) - 13, font) * 16 + 8));
        if (want > (hs.get(x.r) || ROW_H)) hs.set(x.r, want);
      }
      const rows = [...hs.keys()].sort((a, b) => a - b);
      const out = { rows, hs: rows.map(r => hs.get(r)), acc: [0] };
      for (let j = 0; j < rows.length; j++) out.acc.push(out.acc[j] + out.hs[j] - ROW_H);
      RG = out;
      lastH = -1;
    }
    /** after sheet.meta (or the sheet shown) changed: indexes, filter, rows, freeze, a full repaint */
    function metaChanged() {
      ix();
      const fz = sheet().meta.freeze;
      const nr = fz ? fz.r : 0, nc = fz ? fz.c : 0;
      if (nr !== FR || nc !== FC) { FR = nr; FC = nc; resetRows(); }
      applyFilter();
      rebuildRows();
      paint(true);
    }

    /* ================= painting ================= */
    const rowsOn = new Map(), spare = [], headCells = [], fzRows = new Map(), fzHead = [], mgEls = [];
    let win0 = { r0: -1, r1: -1, c0: -1, c1: -1 };
    let activeCel = null;
    const stats = { paints: 0, ms: 0, worst: 0 };
    function paint(force = false) {
      if (S.dead || !S.book) return;
      const t0 = performance.now();
      layout();
      const st = grid.scrollTop, sl = grid.scrollLeft;
      const vh = grid.clientHeight || 400, vw = grid.clientWidth || 600;
      const FH = frozenH(), FW = frozenW();
      const r0 = Math.max(FR, rowAt(st + FH) - OVER_R);
      const r1 = Math.min(nRows - 1, rowAt(st + vh - HEAD_H) + OVER_R);
      const c0 = Math.max(FC, colAt(sl + FW) - 1);
      const c1 = Math.max(c0, Math.min(nCols - 1, colAt(sl + vw - HEAD_W) + 1));
      const colsChanged = force || c0 !== win0.c0 || c1 !== win0.c1;
      if (colsChanged || r0 !== win0.r0 || r1 !== win0.r1) {
        for (const [r, el] of rowsOn) if (r < r0 || r > r1 || hidden.has(r)) { rowsOn.delete(r); spare.push(el); }
        for (let r = r0; r <= r1; r++) {
          if (hidden.has(r)) continue;
          let el = rowsOn.get(r);
          if (!el) {
            el = spare.pop() || makeRow();
            rowsOn.set(r, el);
            if (el.parentNode !== body) body.appendChild(el);
            fillRow(el, r, c0, c1);
          } else if (colsChanged) fillRow(el, r, c0, c1);
        }
        for (const el of spare) if (el.parentNode) el.remove();
        if (colsChanged) { fillHead(c0, c1); paintFrozenRows(c0, c1); }
        win0 = { r0, r1, c0, c1 };
      }
      paintMerges();
      paintSel();
      const ms = performance.now() - t0;
      stats.paints++; stats.ms = ms;
      if (ms > stats.worst) stats.worst = ms;
    }
    function makeRow() {
      const rh = h('div.ss-rh', { role: 'rowheader', 'aria-colindex': '1' });
      const el = h('div.ss-row', { role: 'row' }, rh);
      el._rh = rh; el._cells = []; el._fz = []; el._r = -1; el._w = -1; el._h = ROW_H;
      return el;
    }
    /* the frozen rows: in-flow and sticky at the top of the body, in order */
    function paintFrozenRows(c0, c1) {
      for (const [r, el] of fzRows) if (r >= FR || hidden.has(r)) { fzRows.delete(r); el.remove(); }
      let prev = null;
      for (let r = 0; r < FR; r++) {
        if (hidden.has(r)) continue;
        let el = fzRows.get(r);
        if (!el) { el = makeRow(); el.classList.add('is-frz'); fzRows.set(r, el); }
        if (prev ? prev.nextSibling !== el : body.firstChild !== el) { if (prev) prev.after(el); else body.prepend(el); }
        fillRow(el, r, c0, c1, true);
        el.classList.remove('is-frzl');
        prev = el;
      }
      if (prev) prev.classList.add('is-frzl');       /* the line under the frozen rows */
    }
    function fillRow(el, r, c0, c1, frozen = false) {
      const top = frozen ? HEAD_H + rowTop(r) : rowTop(r), hh = rowH(r);
      if (el._r !== r) {
        el._r = r;
        el.setAttribute('aria-rowindex', String(r + 2));
        el._rh.textContent = String(r + 1);
      }
      if (el._top !== top) { el._top = top; el.style.top = `${top}px`; }
      if (el._h !== hh) { el._h = hh; el.style.height = hh === ROW_H ? '' : `${hh}px`; }
      if (el._w !== totalW) { el._w = totalW; el.style.width = `${totalW}px`; }
      /* row numbers under an active filter are tinted, as other spreadsheets do */
      const f = ix().filter;
      const inFlt = !!f && hidden.size > 0 && r > f.r1 && r <= fltEnd;
      if (el._flt !== inFlt) { el._flt = inFlt; el._rh.classList.toggle('is-flt', inFlt); }
      /* frozen columns: in-flow and sticky, straight after the row number */
      const fz = el._fz;
      while (fz.length < FC) { const x = h('div.ss-c.is-fz', { role: 'gridcell' }); x._c = -1; (fz.length ? fz[fz.length - 1] : el._rh).after(x); fz.push(x); }
      while (fz.length > FC) fz.pop().remove();
      for (let c = 0; c < FC; c++) fillCell(fz[c], r, c, true);
      const need = c1 - c0 + 1, cells = el._cells;
      while (cells.length < need) { const x = h('div.ss-c', { role: 'gridcell' }); x._c = -1; cells.push(x); el.appendChild(x); }
      while (cells.length > need) cells.pop().remove();
      for (let i = 0; i < need; i++) fillCell(cells[i], r, c0 + i);
    }
    /** what a cell looks like: { text, cls } */
    function cellLook(r, c) {
      const cell = S.book.cell(S.sid, r, c);
      let text = '', cls = 'ss-c';
      if (cell) {
        const v = cell.v;
        if (cell.raw !== '') {
          text = E.formatValue(v, fmtOf(cell));
          if (typeof v === 'number') cls += ' is-num';
          else if (typeof v === 'boolean') cls += ' is-bool';
          else if (v instanceof E.CellError) cls += ' is-err';
        }
        const s = cell.s;
        if (s) {
          if (s.b) cls += ' is-b'; if (s.i) cls += ' is-i'; if (s.al) cls += ` al-${s.al[0]}`;
          if (s.wr) cls += ' is-wrap';
          if (s.bd) for (const k of s.bd) cls += ` bd-${k}`;
        }
      }
      const I = ix();
      if (I.cf.length) {
        const v = cell ? cell.v : null, shown = cell && cell.raw !== '' ? text : '';
        const rule = I.cf.find(g => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2 && testOp(g.op, v, shown, g.a, g.b));
        if (rule) { cls += ` cf-${rule.fill}`; if (rule.bold && !cls.includes(' is-b')) cls += ' is-b'; }
      }
      if (I.dv.length) {
        const d = ruleAt(I.dv, r, c);
        if (d) {
          if (d.kind === 'list') cls += ' has-dd';
          if (cell && cell.raw !== '' && !dvPass(d, cell.v, text)) cls += ' is-bad';
        }
      }
      const f = I.filter;
      if (f && r === f.r1 && c >= f.c1 && c <= f.c2) cls += f.by[c] ? ' has-flt is-flt' : ' has-flt';
      if (S.find.set && S.find.set.has(LK(r, c))) cls += S.find.now === LK(r, c) ? ' is-hit is-now' : ' is-hit';
      return { text, cls };
    }
    function fillCell(x, r, c, frozen = false) {
      const look = cellLook(r, c), text = look.text;
      const cls = frozen ? `${look.cls} is-fz${c === FC - 1 ? ' is-fzl' : ''}` : look.cls;
      if (x._c !== c) { x._c = c; x.setAttribute('aria-colindex', String(c + 2)); }
      const left = HEAD_W + colX[c], w = colX[c + 1] - colX[c];
      if (x._x !== left) { x._x = left; x.style.left = `${left}px`; }
      if (x._wd !== w) { x._wd = w; x.style.width = `${w}px`; }
      if (x._t !== text) { x._t = text; x.textContent = text; }
      if (x._k !== cls) { x._k = cls; x.className = cls; }
    }
    function fillHead(c0, c1) {
      const need = c1 - c0 + 1;
      const put = (x, c) => {
        if (x._c !== c) { x._c = c; x._lab.textContent = E.colName(c); x.setAttribute('aria-colindex', String(c + 2)); x.dataset.c = String(c); }
        const left = HEAD_W + colX[c], w = colX[c + 1] - colX[c];
        if (x._x !== left) { x._x = left; x.style.left = `${left}px`; }
        if (x._wd !== w) { x._wd = w; x.style.width = `${w}px`; }
      };
      const mk = () => { const x = h('div.ss-ch', { role: 'columnheader' }, h('span'), h('div.ss-grip', { 'aria-hidden': 'true' })); x._lab = x.firstChild; x._c = -1; return x; };
      while (fzHead.length < FC) { const x = mk(); x.classList.add('is-fz'); (fzHead.length ? fzHead[fzHead.length - 1] : corner).after(x); fzHead.push(x); }
      while (fzHead.length > FC) fzHead.pop().remove();
      for (let c = 0; c < FC; c++) put(fzHead[c], c);
      while (headCells.length < need) { const x = mk(); headCells.push(x); head.appendChild(x); }
      while (headCells.length > need) headCells.pop().remove();
      for (let i = 0; i < need; i++) put(headCells[i], c0 + i);
    }
    /** an area of cells in body px, as it is drawn now: frozen rows and columns
        stay put while the rest scrolls under them. null when nothing of it shows. */
    function areaRect(g) {
      if (g.r1 > nRows - 1 || g.c1 > nCols - 1) return null;
      const r2 = Math.min(g.r2, nRows - 1), c2 = Math.min(g.c2, nCols - 1);
      const st = grid.scrollTop, sl = grid.scrollLeft;
      let y = rowTop(g.r1), y2 = rowTop(r2 + 1), x = HEAD_W + colX[g.c1], x2 = HEAD_W + colX[c2 + 1];
      if (FR) {
        const FH = frozenH();
        if (g.r1 < FR) y += st; else y = Math.max(y, st + FH);
        y2 = r2 < FR ? y2 + st : g.r1 < FR ? Math.max(y2, st + FH) : y2;
        if (g.r1 >= FR && y2 <= st + FH) return null;
      }
      /* columns: nothing is drawn over the row numbers or the frozen columns */
      const minX = sl + HEAD_W + frozenW();
      if (g.c1 < FC) x += sl; else x = Math.max(x, minX);
      x2 = c2 < FC ? x2 + sl : g.c1 < FC ? Math.max(x2, minX) : x2;
      if (g.c1 >= FC && x2 <= minX) return null;
      if (y2 <= y || x2 <= x) return null;
      return { x, y, w: x2 - x, h: y2 - y, frozen: g.r1 < FR || g.c1 < FC };
    }
    function box(el, g) {
      const a = g && areaRect(g);
      if (!a) { if (el._on) { el.style.display = 'none'; el._on = false; } return; }
      el.style.cssText = `display:block;left:${a.x - 1}px;top:${a.y - 1}px;width:${a.w + 1}px;height:${a.h + 1}px`;
      el._on = true;
    }
    /* merged cells: one box over each area that is in view, drawn as its top-left cell */
    function paintMerges() {
      const list = ix().merges;
      let n = 0;
      if (list.length) {
        const { r0, r1, c0, c1 } = win0;
        for (const g of list) {
          const inRows = (g.r2 >= r0 && g.r1 <= r1) || g.r1 < FR, inCols = (g.c2 >= c0 && g.c1 <= c1) || g.c1 < FC;
          if (!inRows || !inCols) continue;
          const a = areaRect(g);
          if (!a) continue;
          let el = mgEls[n];
          if (!el) { el = h('div', { 'aria-hidden': 'true' }); mgEls.push(el); }
          if (el.parentNode !== body) body.appendChild(el);
          const look = cellLook(g.r1, g.c1);
          const cls = `${look.cls} ss-mg${a.frozen ? ' is-mgfz' : ''}`;
          if (el._k !== cls) { el._k = cls; el.className = cls; }
          if (el._t !== look.text) { el._t = look.text; el.textContent = look.text; }
          el.style.cssText = `left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px`;
          n++;
        }
      }
      while (mgEls.length > n) mgEls.pop().remove();
    }
    function paintSel() {
      const g = selRect();
      const multi = g.r1 !== g.r2 || g.c1 !== g.c2;
      const m = mergeAt(S.cur.r, S.cur.c);
      box(selBox, multi && !(m && m.r1 === g.r1 && m.c1 === g.c1 && m.r2 === g.r2 && m.c2 === g.c2) ? g : null);
      box(curBox, m || { r1: S.cur.r, c1: S.cur.c, r2: S.cur.r, c2: S.cur.c });
      box(clipBox, S.clip && S.clip.sid === S.sid ? S.clip.g : null);
      box(ptBox, S.edit && S.edit.point && S.edit.point.g ? S.edit.point.g : null);
      const allRows = [...rowsOn, ...fzRows];
      for (const [r, el] of allRows) {
        const rs = r >= g.r1 && r <= g.r2;
        if (el._rs !== rs) { el._rs = rs; el._rh.classList.toggle('is-sel', rs); }
        for (const x of el._fz.length ? [...el._fz, ...el._cells] : el._cells) {
          const s = rs && x._c >= g.c1 && x._c <= g.c2;
          if (x._s !== s) { x._s = s; x.setAttribute('aria-selected', String(s)); }
        }
      }
      for (const x of fzHead.length ? [...fzHead, ...headCells] : headCells) { const s = x._c >= g.c1 && x._c <= g.c2; if (x._s !== s) { x._s = s; x.classList.toggle('is-sel', s); } }
      const row = rowsOn.get(S.cur.r) || fzRows.get(S.cur.r);
      const cel = row ? (S.cur.c < FC ? row._fz[S.cur.c] : row._cells.find(x => x._c === S.cur.c)) || null : null;
      if (activeCel && activeCel !== cel) { activeCel.removeAttribute('id'); activeCel.removeAttribute('aria-label'); }
      activeCel = cel || null;
      if (cel) {
        cel.id = `${uid}-cur`;
        const raw = rawAt(S.cur.r, S.cur.c);
        const d = ix().dv.length ? ruleAt(ix().dv, S.cur.r, S.cur.c) : null;
        const extra = `${m ? `, merged ${E.rangeName(m)}` : ''}${d && d.kind === 'list' ? ', has a dropdown (Alt+Down)' : ''}${/ is-bad/.test(cel._k || '') ? `, doesn’t pass its check: ${dvSays(d)}` : ''}`;
        const label = `${E.cellName(S.cur.r, S.cur.c)}, ${cel._t || 'blank'}${E.isFormula(raw) ? `, formula ${raw}` : ''}${extra}`;
        if (cel.getAttribute('aria-label') !== label) cel.setAttribute('aria-label', label);
        if (grid.getAttribute('aria-activedescendant') !== cel.id) grid.setAttribute('aria-activedescendant', cel.id);
      } else grid.removeAttribute('aria-activedescendant');
    }

    /* ================= selection ================= */
    const rawAt = (r, c) => { const x = S.book.cell(S.sid, r, c); return x ? x.raw : ''; };
    const filled = (r, c) => { const x = S.book.cell(S.sid, r, c); return !!x && x.raw !== ''; };
    /** the selection as drawn: whole rows/columns run to the grid's edge */
    function selRect() {
      const a = S.anchor, f = S.focus;
      const fin = (v, max) => (Number.isFinite(v) ? Math.min(v, max) : max);
      const ar = fin(a.r, nRows - 1), fr = fin(f.r, nRows - 1), ac = fin(a.c, nCols - 1), fc = fin(f.c, nCols - 1);
      const g = { r1: Math.min(ar, fr), r2: Math.max(ar, fr), c1: Math.min(ac, fc), c2: Math.max(ac, fc) };
      return ix().merges.length ? withMerges(g) : g;
    }
    /* a selection that cuts into a merged area takes all of it in */
    function withMerges(g) {
      for (let grew = true; grew;) {
        grew = false;
        for (const m of IX.merges) {
          if (!overlaps(m, g) || (m.r1 >= g.r1 && m.r2 <= g.r2 && m.c1 >= g.c1 && m.c2 <= g.c2)) continue;
          g = { r1: Math.min(g.r1, m.r1), r2: Math.max(g.r2, m.r2), c1: Math.min(g.c1, m.c1), c2: Math.max(g.c2, m.c2) };
          grew = true;
        }
      }
      return g;
    }
    /** the selection as worked on: whole rows/columns (and huge areas) stop at the data */
    function opRect() {
      const g = selRect(), ext = S.book.extentOf(S.sid);
      if (!Number.isFinite(S.anchor.r) || !Number.isFinite(S.focus.r)) g.r2 = Math.max(g.r1, Math.min(g.r2, ext.r));
      if (!Number.isFinite(S.anchor.c) || !Number.isFinite(S.focus.c)) g.c2 = Math.max(g.c1, Math.min(g.c2, ext.c));
      if ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > BIG) {
        g.r2 = Math.max(g.r1, Math.min(g.r2, ext.r));
        g.c2 = Math.max(g.c1, Math.min(g.c2, ext.c));
      }
      return g;
    }
    const inSel = (r, c) => { const g = selRect(); return r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2; };
    const finFocus = () => ({ r: Number.isFinite(S.focus.r) ? S.focus.r : nRows - 1, c: Number.isFinite(S.focus.c) ? S.focus.c : nCols - 1 });
    function selName() {
      const a = S.anchor, f = S.focus;
      if (!Number.isFinite(f.r) && !Number.isFinite(f.c)) return 'All cells';
      if (!Number.isFinite(f.r)) return `${E.colName(Math.min(a.c, f.c))}:${E.colName(Math.max(a.c, f.c))}`;
      if (!Number.isFinite(f.c)) return `${Math.min(a.r, f.r) + 1}:${Math.max(a.r, f.r) + 1}`;
      return E.rangeName(selRect());
    }
    /* scroll so the cell shows — below the frozen rows and right of the frozen columns */
    function reveal(r, c) {
      layout();
      if (r >= FR) {
        const top = rowTop(r), bot = top + Math.max(ROW_H, rowH(r)), vh = grid.clientHeight - HEAD_H, FH = frozenH();
        if (top < grid.scrollTop + FH) grid.scrollTop = top - FH;
        else if (bot > grid.scrollTop + vh) grid.scrollTop = bot - vh;
      }
      if (c >= FC) {
        const L = colX[c], R = colX[c + 1], vw = grid.clientWidth - HEAD_W, FW = frozenW();
        if (L < grid.scrollLeft + FW) grid.scrollLeft = L - FW;
        else if (R > grid.scrollLeft + vw) grid.scrollLeft = Math.min(L - FW, R - vw);
      }
    }
    function select(cur, anchor = cur, focus = cur, { show = true } = {}) {
      /* the active cell of a merged area is its top-left cell */
      const m = ix().merges.length && Number.isFinite(cur.r) && Number.isFinite(cur.c) ? mergeAt(cur.r, cur.c) : null;
      if (m) {
        cur = { r: m.r1, c: m.c1 };
        if (anchor.r === focus.r && anchor.c === focus.c) { anchor = cur; focus = cur; }
      }
      S.cur = { ...cur }; S.anchor = { ...anchor }; S.focus = { ...focus };
      if (show) {
        const f = Number.isFinite(focus.r) && Number.isFinite(focus.c) ? focus : cur;
        reveal(f.r, f.c);
      }
      paint();
      syncBars();
    }
    function moveTo(r, c, extend = false, show = true) {
      const p = { r: clamp(r, 0, E.MAX_ROWS - 1), c: clamp(c, 0, E.MAX_COLS - 1) };
      if (extend) select(S.cur, S.anchor, p, { show });
      else select(p, p, p, { show });
    }
    const topRow = () => rowAt(grid.scrollTop + frozenH());
    /** one step from a cell: out of the far side of a merged area, and past rows a filter hides */
    function stepFrom(p, dr, dc) {
      const m = mergeAt(p.r, p.c);
      let r = p.r + dr, c = p.c + dc;
      if (m) { if (dr > 0) r = m.r2 + 1; if (dc > 0) c = m.c2 + 1; if (dr < 0) r = m.r1 - 1; if (dc < 0) c = m.c1 - 1; if (!dr) r = p.r; if (!dc) c = p.c; }
      for (let k = 0; dr && hidden.has(r) && k < 100000; k++) r += dr;
      return { r: clamp(r, 0, E.MAX_ROWS - 1), c: clamp(c, 0, E.MAX_COLS - 1) };
    }
    function selectCols(a, b) { select({ r: topRow(), c: a }, { r: 0, c: a }, { r: Infinity, c: b }, { show: false }); }
    function selectRows(a, b) { select({ r: a, c: S.cur.c }, { r: a, c: 0 }, { r: b, c: Infinity }, { show: false }); }
    function selectAll() { select({ r: S.cur.r, c: S.cur.c }, { r: 0, c: 0 }, { r: Infinity, c: Infinity }, { show: false }); say('Everything selected'); }
    /** ⌘/Ctrl+arrow: to the far side of a block of data, or to the next one */
    function edgeFrom(r, c, dr, dc) {
      const ext = S.book.extentOf(S.sid);
      const maxR = nRows - 1, maxC = nCols - 1;
      const inb = (y, x) => y >= 0 && x >= 0 && y <= maxR && x <= maxC;
      let nr = r + dr, nc = c + dc;
      if (!inb(nr, nc)) return { r, c };
      if (filled(r, c) && filled(nr, nc)) {
        while (inb(nr + dr, nc + dc) && filled(nr + dr, nc + dc)) { nr += dr; nc += dc; }
        return { r: nr, c: nc };
      }
      while (!filled(nr, nc)) {
        if ((dr > 0 && nr > ext.r) || (dc > 0 && nc > ext.c)) return { r: dr ? maxR : nr, c: dc ? maxC : nc };
        if (!inb(nr + dr, nc + dc)) break;
        nr += dr; nc += dc;
      }
      return { r: nr, c: nc };
    }

    /* ================= keyboard on the grid ================= */
    grid.addEventListener('keydown', e => {
      if (S.edit || e.target !== grid) return;
      const k = e.key, mod = e.ctrlKey || e.metaKey;
      if (ARROW[k]) {
        /* Alt+↓ opens the cell's filter or dropdown */
        if (k === 'ArrowDown' && e.altKey && !mod && !e.shiftKey && cellPopup(S.cur.r, S.cur.c)) { e.preventDefault(); return; }
        if (e.altKey) return;                       /* ⌃⌥ / ⌘⌥ arrows snap the window */
        e.preventDefault();
        const [dr, dc] = ARROW[k];
        const from = e.shiftKey ? finFocus() : S.cur;
        const to = mod ? edgeFrom(from.r, from.c, dr, dc) : stepFrom(from, dr, dc);
        moveTo(to.r, to.c, e.shiftKey);
        return;
      }
      const printable = k.length === 1 && (!mod || (e.ctrlKey && e.altKey));      /* AltGr types */
      if (printable && !(k === ' ' && e.shiftKey)) { e.preventDefault(); beginEdit(k, 'enter'); return; }
      if (k === 'Dead' || k === 'Process') { beginEdit('', 'enter'); return; }      /* the composition lands in the editor */
      if (mod && !e.altKey) {
        const key = k.toLowerCase();
        if (key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (key === 'y') { e.preventDefault(); redo(); }
        else if (key === 'b') { e.preventDefault(); toggleStyle('b'); }
        else if (key === 'i') { e.preventDefault(); toggleStyle('i'); }
        else if (key === 'd') { e.preventDefault(); fill('down'); }
        else if (key === 'r') { e.preventDefault(); fill('right'); }
        else if (key === 'f') { e.preventDefault(); openFind(); }
        else if (key === 's') { e.preventDefault(); saveCmd(); }
        else if (key === 'a') { e.preventDefault(); selectAll(); }
        else if (k === 'Home') { e.preventDefault(); moveTo(0, 0, e.shiftKey); }
        else if (k === 'End') { e.preventDefault(); const x = S.book.recount(S.sid); moveTo(Math.max(0, x.r), Math.max(0, x.c), e.shiftKey); }
        else if (key === 'c' || key === 'x' || key === 'v') clipFallback(key);   /* the real copy/cut/paste event follows */
        return;
      }
      switch (k) {
        case 'Enter': e.preventDefault(); beginEdit(rawAt(S.cur.r, S.cur.c), 'edit'); return;
        case 'F2': e.preventDefault(); beginEdit(rawAt(S.cur.r, S.cur.c), 'edit'); return;
        case 'Delete': case 'Backspace': e.preventDefault(); clearContents(); return;
        case 'Escape': if (S.clip) { S.clip = null; paintSel(); } return;
        case 'Home': e.preventDefault(); moveTo(e.shiftKey ? finFocus().r : S.cur.r, 0, e.shiftKey); return;
        case 'End': { e.preventDefault(); const ext = S.book.extentOf(S.sid); moveTo(e.shiftKey ? finFocus().r : S.cur.r, Math.max(0, ext.c), e.shiftKey); return; }
        case 'PageDown': case 'PageUp': {
          e.preventDefault();
          const n = Math.max(1, Math.floor((grid.clientHeight - HEAD_H) / ROW_H) - 1) * (k === 'PageDown' ? 1 : -1);
          const f = e.shiftKey ? finFocus() : S.cur;
          grid.scrollTop += n * ROW_H;
          moveTo(f.r + n, f.c, e.shiftKey);
          return;
        }
        case ' ': if (e.shiftKey) { e.preventDefault(); selectRows(S.cur.r, S.cur.r); } return;
        case 'ContextMenu': e.preventDefault(); menuAtCursor(); return;
        case 'F10': if (e.shiftKey) { e.preventDefault(); menuAtCursor(); } return;
        default:
      }
    });

    /* ================= editing ================= */
    function beginEdit(text, mode, via = 'cell') {
      if (S.edit) return;
      const { r, c } = S.cur;
      reveal(r, c);
      paint();
      S.edit = { r, c, mode, point: null, el: via === 'bar' ? fx : editor, hold: false };
      editor.value = text;
      fx.value = text;
      editor.style.display = 'block';
      placeEditor();
      sizeEditor();
      if (via !== 'bar') {
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(text.length, text.length);
      }
    }
    function placeEditor() {
      if (!S.edit) return;
      const { r, c } = S.edit;
      editor.style.left = `${HEAD_W + colX[c] - (c < FC ? 0 : grid.scrollLeft) - 1}px`;
      editor.style.top = `${HEAD_H + rowTop(r) - (r < FR ? 0 : grid.scrollTop) - 1}px`;
    }
    function sizeEditor() {
      if (!S.edit) return;
      const { r, c } = S.edit;
      const m = mergeAt(r, c);
      const lines = editor.value.split('\n');
      const isF = editor.value.startsWith('=');
      const font = isF ? `${Math.round(12 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-k')) || 1))}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}` : gridFont();
      const w = lines.reduce((mx, l) => Math.max(mx, textW(l, font)), 0) + 18;
      const cw = (m ? colX[m.c2 + 1] - colX[m.c1] : colX[c + 1] - colX[c]) + 2;
      const ch = (m ? rowTop(m.r2 + 1) - rowTop(m.r1) : rowH(r)) + 2;
      const room = Math.max(cw, wrap.clientWidth - (HEAD_W + colX[c] - grid.scrollLeft) - 6);
      editor.style.width = `${Math.min(Math.max(cw, w), room)}px`;
      editor.style.height = `${Math.max(ROW_H + 2, ch, lines.length * 16 + 10)}px`;
      editor.classList.toggle('is-formula', isF);
      fx.style.height = lines.length > 1 ? `${Math.min(92, lines.length * 16 + 10)}px` : '';
    }
    function endEdit() {
      S.edit = null;
      editor.style.display = 'none';
      fx.style.height = '';
      paintSel();
    }
    /** close any ( a formula left open, as other spreadsheets do */
    function closeParens(raw) {
      let depth = 0, q = false;
      for (const ch of raw) { if (ch === '"') q = !q; else if (!q) { if (ch === '(') depth++; else if (ch === ')') depth--; } }
      return depth > 0 && !q ? raw + ')'.repeat(depth) : raw;
    }
    function commitEdit(dr = 0, dc = 0, refocus = true) {
      if (!S.edit) return;
      const { r, c } = S.edit;
      let raw = editEl().value;
      endEdit();
      if (E.isFormula(raw)) raw = closeParens(raw);
      /* a cell with a check that refuses: what doesn't pass isn't put in */
      const d = ix().dv.length ? ruleAt(IX.dv, r, c) : null;
      if (d && d.strict && raw !== '' && raw !== rawAt(r, c)) {
        const v = E.isFormula(raw) ? E.evaluateFormula(S.book, S.sid, raw) : E.parseLiteral(raw).v;
        const x = S.book.cell(S.sid, r, c);
        const shown = E.formatValue(v, x && x.s && x.s.nf ? fmtOf(x) : E.parseLiteral(raw).fmt);
        if (!dvPass(d, v, shown)) {
          const msg = `${E.cellName(r, c)} takes ${dvSays(d)}, so “${raw.slice(0, 40)}” wasn’t put in.`;
          api.notify({ app: 'Static Sheets', icon: 'alert', title: 'That doesn’t fit this cell', message: msg, timeout: 6000 });
          say(msg);
          paint();
          syncBars();
          if (refocus) grid.focus({ preventScroll: true });
          return;
        }
      }
      applyChanges([{ r, c, raw }], 'Edit');
      /* a formula that worked out to a real value (not an error) — Achievements count it */
      { const x = E.isFormula(raw) ? S.book.cell(S.sid, r, c) : null; if (x && x.f && !E.isErr(x.v)) api.bus.emit('sheets:formula', { raw }); }
      if (dr || dc) moveTo(r + dr, c + dc); else paint();
      syncBars();
      if (refocus) grid.focus({ preventScroll: true });
    }
    function cancelEdit() {
      if (!S.edit) return;
      endEdit();
      syncBars();
      grid.focus({ preventScroll: true });
    }
    function insertNewline(el) {
      const s = el.selectionStart, t = el.selectionEnd;
      el.value = el.value.slice(0, s) + '\n' + el.value.slice(t);
      el.setSelectionRange(s + 1, s + 1);
      el.dispatchEvent(new Event('input'));
    }
    /* pointing: while a formula waits for a value (after =, (, an operator
       or a comma) arrows and clicks write a reference instead of moving on */
    const editEl = () => (S.edit && S.edit.el) || editor;
    function pointable() {
      const ed = S.edit;
      if (!ed) return false;
      const el = editEl(), v = el.value, pos = el.selectionStart;
      if (!v.startsWith('=') || el.selectionEnd !== pos) return false;
      if (ed.point && pos === ed.point.end) return true;
      return /[=(,;+\-*/^&<>:]$/.test(v.slice(0, pos).replace(/\s+$/, ''));
    }
    function pointTo(anchor, focus) {
      const ed = S.edit, el = editEl();
      if (!ed.point || el.selectionStart !== ed.point.end) ed.point = { start: el.selectionStart, end: el.selectionStart };
      const p = ed.point, g = rectOf(anchor, focus), text = E.rangeName(g);
      el.value = el.value.slice(0, p.start) + text + el.value.slice(p.end);
      p.end = p.start + text.length; p.g = g; p.anchor = anchor; p.at = focus;
      el.setSelectionRange(p.end, p.end);
      (el === editor ? fx : editor).value = el.value;
      sizeEditor();
      paintSel();
    }
    function stepPoint(dr, dc, extend) {
      const ed = S.edit, p = ed.point && ed.point.g ? ed.point : null;
      const from = p ? p.at : { r: ed.r, c: ed.c };
      const at = { r: clamp(from.r + dr, 0, E.MAX_ROWS - 1), c: clamp(from.c + dc, 0, E.MAX_COLS - 1) };
      pointTo(extend ? (p ? p.anchor : { r: ed.r, c: ed.c }) : at, at);
      reveal(at.r, at.c);
      paint();
      placeEditor();
    }
    function onEditKey(e) {
      if (!S.edit || e.isComposing) return;
      const k = e.key, mod = e.ctrlKey || e.metaKey;
      if (k === 'Enter') {
        e.preventDefault();
        if (e.altKey || mod) insertNewline(e.currentTarget);
        else commitEdit(e.shiftKey ? -1 : 1, 0);
        return;
      }
      if (k === 'Tab') { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); return; }
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); return; }
      if (k === 'F2') { e.preventDefault(); S.edit.mode = S.edit.mode === 'enter' ? 'edit' : 'enter'; return; }
      if (ARROW[k] && !mod && !e.altKey) {
        const [dr, dc] = ARROW[k];
        if (pointable()) { e.preventDefault(); stepPoint(dr, dc, e.shiftKey); return; }
        if (S.edit.mode === 'enter' && !e.shiftKey && e.currentTarget === editor) { e.preventDefault(); commitEdit(dr, dc); }
      }
    }
    function onEditOut(e) {
      if (!S.edit || S.edit.hold) return;          /* a click that points at a cell keeps the edit open */
      if (e.relatedTarget === editor || e.relatedTarget === fx) return;
      setTimeout(() => {
        if (S.edit && document.activeElement !== editor && document.activeElement !== fx) commitEdit(0, 0, false);
      }, 0);
    }
    editor.addEventListener('keydown', onEditKey);
    fx.addEventListener('keydown', onEditKey);
    editor.addEventListener('focusout', onEditOut);
    fx.addEventListener('focusout', onEditOut);
    editor.addEventListener('input', () => { if (!S.edit) return; fx.value = editor.value; S.edit.point = null; sizeEditor(); paintSel(); });
    fx.addEventListener('focus', () => { if (!S.edit) beginEdit(rawAt(S.cur.r, S.cur.c), 'edit', 'bar'); else S.edit.el = fx; });
    editor.addEventListener('focus', () => { if (S.edit) S.edit.el = editor; });
    fx.addEventListener('input', () => {
      if (!S.edit) { beginEdit(fx.value, 'edit', 'bar'); return; }
      editor.value = fx.value; S.edit.point = null; sizeEditor(); paintSel();
    });
    nameBox.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); goTo(nameBox.value); }
      else if (e.key === 'Escape') { e.preventDefault(); nameBox.value = selName(); grid.focus(); }
    });
    nameBox.addEventListener('focus', () => nameBox.select());
    nameBox.addEventListener('blur', () => { nameBox.value = selName(); nameBox.removeAttribute('aria-invalid'); });
    function goTo(text) {
      let t = String(text || '').trim(), sid = S.sid;
      const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(t);
      if (m) {
        const sh = S.book.sheetNamed((m[1] || m[2]).replace(/''/g, "'"));
        if (!sh) { nameBox.setAttribute('aria-invalid', 'true'); say(`There’s no sheet called ${m[1] || m[2]}`); return; }
        sid = sh.id; t = m[3];
      }
      const g = E.parseRangeName(t);
      if (!g) { nameBox.setAttribute('aria-invalid', 'true'); say(`“${text}” isn’t a cell like B7 or a range like A1:C3`); return; }
      nameBox.removeAttribute('aria-invalid');
      if (sid !== S.sid) switchSheet(sid);
      select({ r: g.r1, c: g.c1 }, { r: g.r1, c: g.c1 }, { r: g.r2, c: g.c2 });
      grid.focus({ preventScroll: true });
    }

    /* ================= mouse ================= */
    let drag = null;
    function hitAt(e) {
      const rect = grid.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      /* over the frozen rows and columns, the page hasn't scrolled */
      const by = y - HEAD_H, bx = x - HEAD_W;
      const r = clamp(rowAt(FR && by < frozenH() ? by : by + grid.scrollTop), 0, nRows - 1);
      const c = clamp(colAt(FC && bx < frozenW() ? bx : bx + grid.scrollLeft), 0, nCols - 1);
      const kind = y < HEAD_H ? (x < HEAD_W ? 'all' : 'col') : x < HEAD_W ? 'row' : 'cell';
      /* how far from the right edge of its cell (or merged area) the pointer is: the ▾ of a filter or dropdown */
      const m = kind === 'cell' ? mergeAt(r, c) : null;
      const cellRight = HEAD_W + colX[(m ? m.c2 : c) + 1] - (c < FC ? 0 : grid.scrollLeft);
      return { kind, r, c, outside: x > grid.clientWidth || y > grid.clientHeight, fromRight: cellRight - x };
    }
    function autoScroll(e) {
      const rect = grid.getBoundingClientRect();
      if (e.clientY > rect.bottom - 14) grid.scrollTop += ROW_H;
      else if (e.clientY < rect.top + HEAD_H) grid.scrollTop -= ROW_H;
      if (e.clientX > rect.right - 14) grid.scrollLeft += 40;
      else if (e.clientX < rect.left + HEAD_W) grid.scrollLeft -= 40;
    }
    grid.addEventListener('pointerdown', e => {
      const grip = e.target.closest && e.target.closest('.ss-grip');
      if (grip) { startResize(e, grip, Number(grip.parentNode.dataset.c)); return; }
      const hit = hitAt(e);
      if (hit.outside) return;                                   /* the scrollbars */
      if (e.button === 2) { if (hit.kind === 'cell' && !inSel(hit.r, hit.c)) moveTo(hit.r, hit.c, false, false); return; }
      if (e.button !== 0) return;
      if (S.edit) {
        if (hit.kind === 'cell' && pointable()) {
          e.preventDefault();
          const at = { r: hit.r, c: hit.c };
          S.edit.hold = true;
          pointTo(at, at);
          drag = { kind: 'point', anchor: at };
          grid.setPointerCapture(e.pointerId);
          return;
        }
        commitEdit(0, 0, false);
      }
      e.preventDefault();
      grid.focus({ preventScroll: true });
      /* the ▾ at a filter header's or a dropdown cell's right edge */
      if (hit.kind === 'cell' && !e.shiftKey && hit.fromRight >= 0 && hit.fromRight <= 18) {
        const at = mergeAt(hit.r, hit.c) || { r1: hit.r, c1: hit.c };
        if (popupKind(at.r1, at.c1)) { moveTo(at.r1, at.c1, false, false); cellPopup(at.r1, at.c1); return; }
      }
      if (hit.kind === 'cell') { moveTo(hit.r, hit.c, e.shiftKey, false); drag = { kind: 'cell' }; }
      else if (hit.kind === 'col') { const a = e.shiftKey && !Number.isFinite(S.focus.r) ? S.anchor.c : hit.c; selectCols(a, hit.c); drag = { kind: 'col', a }; }
      else if (hit.kind === 'row') { const a = e.shiftKey && !Number.isFinite(S.focus.c) ? S.anchor.r : hit.r; selectRows(a, hit.r); drag = { kind: 'row', a }; }
      else selectAll();
      grid.setPointerCapture(e.pointerId);
    });
    grid.addEventListener('pointermove', e => {
      if (!drag) return;
      autoScroll(e);
      const hit = hitAt(e);
      if (drag.kind === 'cell') {
        if (hit.r !== S.focus.r || hit.c !== S.focus.c) { S.focus = { r: hit.r, c: hit.c }; paint(); syncBars(); }
      } else if (drag.kind === 'col') { if (hit.c !== S.focus.c) selectCols(drag.a, hit.c); }
      else if (drag.kind === 'row') { if (hit.r !== S.focus.r) selectRows(drag.a, hit.r); }
      else if (drag.kind === 'point' && S.edit && S.edit.point) {
        const at = S.edit.point.at;
        if (!at || at.r !== hit.r || at.c !== hit.c) pointTo(drag.anchor, { r: hit.r, c: hit.c });
      }
    });
    const endDrag = e => {
      if (!drag) return;
      const was = drag.kind;
      drag = null;
      try { grid.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (was === 'point' && S.edit) {
        /* back to typing, right after the reference */
        S.edit.hold = false;
        const el = editEl(), at = S.edit.point ? S.edit.point.end : el.value.length;
        el.focus({ preventScroll: true });
        el.setSelectionRange(at, at);
      }
    };
    grid.addEventListener('pointerup', endDrag);
    grid.addEventListener('pointercancel', endDrag);
    grid.addEventListener('dblclick', e => {
      const grip = e.target.closest && e.target.closest('.ss-grip');
      if (grip) { const c = Number(grip.parentNode.dataset.c); applyChanges([], 'Fit column', { cols: [{ c, w: fitWidth(c) }] }); return; }
      const hit = hitAt(e);
      if (hit.kind === 'cell' && !S.edit) { moveTo(hit.r, hit.c, false, false); beginEdit(rawAt(hit.r, hit.c), 'edit'); }
    });
    grid.addEventListener('contextmenu', e => { e.preventDefault(); if (S.edit) commitEdit(0, 0); cellMenu(e.clientX, e.clientY); });

    /* ---- column widths ---- */
    function startResize(e, grip, c) {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, w0 = width(c), had = sheet().colW.has(c) ? w0 : null;
      grip.classList.add('is-on');
      grip.setPointerCapture(e.pointerId);
      const move = ev => { setColW(S.sid, c, clamp(Math.round(w0 + ev.clientX - x0), MIN_W, MAX_W)); paint(true); placeEditor(); };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        grip.classList.remove('is-on');
        const w = width(c);
        setColW(S.sid, c, had);
        if (w !== w0) applyChanges([], 'Column width', { cols: [{ c, w }] }); else paint(true);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    }
    function setColW(sid, c, w) {
      const sh = S.book.sheet(sid);
      if (!sh) return;
      if (w == null || w === COL_W) sh.colW.delete(c); else sh.colW.set(c, w);
      if (sid === S.sid) colsDirty = true;
    }
    /** the width a column's contents need */
    function fitWidth(c, sid = S.sid) {
      const sh = S.book.sheet(sid), font = gridFont(), bold = gridFont(true);
      let w = 0, n = 0;
      for (const x of sh.cells.values()) {
        if (x.c !== c || x.raw === '') continue;
        const t = E.formatValue(x.v, fmtOf(x)).split('\n')[0];
        w = Math.max(w, textW(t, x.s && x.s.b ? bold : font));
        if (++n > 5000) break;
      }
      return n ? clamp(Math.ceil(w + 16), 40, 480) : COL_W;
    }
    /** a CSV's columns, widened (never narrowed) to fit what they hold */
    function fitColumns(book, sh) {
      const font = gridFont(), want = new Map();
      let n = 0;
      for (const x of sh.cells.values()) {
        if (x.raw === '' || x.c > 80) continue;
        const t = E.formatValue(x.v, fmtOf(x)).split('\n')[0];
        if (t.length * 8 + 16 <= COL_W) continue;              /* short enough to fit any width it gets */
        want.set(x.c, Math.max(want.get(x.c) || 0, textW(t, font)));
        if (++n > 20000) break;
      }
      for (const [c, w] of want) if (w + 16 > COL_W) sh.colW.set(c, clamp(Math.ceil(w + 16), COL_W, 320));
    }

    /* ================= changes + undo ================= */
    const snapSel = () => ({ cur: { ...S.cur }, anchor: { ...S.anchor }, focus: { ...S.focus } });
    function put(sid, r, c, st, keys) {
      S.book.setStyle(sid, r, c, st.s);
      const k = S.book.set(sid, r, c, st.raw);
      if (k != null) keys.push(k);
    }
    /** Every edit goes through here: [{ r, c, raw?, s? }] → one undo step.
        cols: column widths; meta: fn(copy of sheet.meta) → what the sheet keeps
        besides cells (freeze, merges, filter, rules, tab colour) changes too. */
    function applyChanges(list, label, { sid = S.sid, cols = null, meta = null, refilter = false } = {}) {
      const rec = { label, sid, cells: [], cols: [], meta: null, refilter, sel: snapSel() };
      const keys = [];
      for (const ch of list) {
        const x = S.book.cell(sid, ch.r, ch.c);
        const before = { raw: x ? x.raw : '', s: x && x.s ? { ...x.s } : null };
        const after = { raw: ch.raw !== undefined ? String(ch.raw) : before.raw, s: ch.s !== undefined ? (ch.s ? cleanStyle(ch.s) : null) : before.s };
        if (after.raw === before.raw && sameStyle(after.s, before.s)) continue;
        rec.cells.push({ r: ch.r, c: ch.c, before, after });
        put(sid, ch.r, ch.c, after, keys);
      }
      if (cols) {
        const sh = S.book.sheet(sid);
        for (const { c, w } of cols) {
          const before = sh.colW.get(c) || null, after = w === COL_W ? null : w;
          if (before === after) continue;
          rec.cols.push({ c, before, after });
          setColW(sid, c, after);
        }
      }
      if (meta) {
        const sh = S.book.sheet(sid), before = sh.meta || {};
        const copy = JSON.parse(JSON.stringify(before));
        const out = meta(copy);
        const next = cleanMeta(out === undefined ? copy : out);
        if (JSON.stringify(next) !== JSON.stringify(before)) { rec.meta = { before, after: next }; sh.meta = next; }
      }
      if (!rec.cells.length && !rec.cols.length && !rec.meta) return false;
      S.undo.push(rec);
      if (S.undo.length > UNDO_MAX) S.undo.shift();
      S.redo.length = 0;
      afterChange(keys, rec);
      return true;
    }
    function afterChange(keys, rec = null) {
      if (keys.length) S.book.recalc(keys);
      if (S.find.open && findIn.value) runFind();
      if (rec && (rec.meta || rec.refilter) && rec.sid === S.sid) { metaChanged(); if (rec.meta) renderTabs(); }
      else { rebuildRows(); paint(true); }
      syncBars();
      drawCharts();
      markDirty();
    }
    function replay(rec, side) {
      if (!S.book.sheet(rec.sid)) return;
      if (rec.sid !== S.sid) switchSheet(rec.sid);
      const keys = [];
      const list = side === 'before' ? [...rec.cells].reverse() : rec.cells;
      for (const x of list) put(rec.sid, x.r, x.c, x[side], keys);
      for (const x of rec.cols) setColW(rec.sid, x.c, x[side]);
      if (rec.meta) S.book.sheet(rec.sid).meta = rec.meta[side];
      S.cur = { ...rec.sel.cur }; S.anchor = { ...rec.sel.anchor }; S.focus = { ...rec.sel.focus };
      afterChange(keys, rec);
      reveal(S.cur.r, S.cur.c);
      paint();
    }
    function undo() {
      if (S.edit) cancelEdit();
      const rec = S.undo.pop();
      if (!rec) { say('Nothing to undo'); return; }
      replay(rec, 'before');
      S.redo.push(rec);
      syncBars();
      say(`Undid ${rec.label.toLowerCase()}`);
    }
    function redo() {
      if (S.edit) cancelEdit();
      const rec = S.redo.pop();
      if (!rec) { say('Nothing to redo'); return; }
      replay(rec, 'after');
      S.undo.push(rec);
      syncBars();
      say(`Redid ${rec.label.toLowerCase()}`);
    }

    /* ================= formatting, clearing, filling ================= */
    /** the cells of g that exist (cheap for a whole column of a big sheet) */
    function eachExisting(g, fn) {
      const sh = sheet();
      const area = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
      if (area > sh.cells.size) {
        for (const x of [...sh.cells.values()]) if (x.r >= g.r1 && x.r <= g.r2 && x.c >= g.c1 && x.c <= g.c2 && !hidden.has(x.r)) fn(x);
      } else {
        for (let r = g.r1; r <= g.r2; r++) { if (hidden.has(r)) continue; for (let c = g.c1; c <= g.c2; c++) { const x = S.book.cell(S.sid, r, c); if (x) fn(x); } }
      }
    }
    function restyle(label, fn) {
      if (S.edit) commitEdit(0, 0, false);
      const g = opRect(), list = [];
      for (let r = g.r1; r <= g.r2; r++) {
        if (hidden.has(r)) continue;                 /* rows a filter hides are left as they are */
        for (let c = g.c1; c <= g.c2; c++) {
          const x = S.book.cell(S.sid, r, c);
          const s = { ...((x && x.s) || {}) };
          fn(s, r, c);
          list.push({ r, c, s });
        }
      }
      return applyChanges(list, label);
    }
    const activeStyle = () => { const x = S.book.cell(S.sid, S.cur.r, S.cur.c); return (x && x.s) || {}; };
    function toggleStyle(k) {
      const on = !activeStyle()[k];
      const name = k === 'b' ? 'Bold' : k === 'wr' ? 'Wrap text' : 'Italic';
      if (restyle(name, s => { s[k] = on; })) say(`${name} ${on ? 'on' : 'off'}`);
    }
    function align(al) {
      const next = activeStyle().al === al ? null : al;
      if (restyle('Alignment', s => { if (next) s.al = next; else delete s.al; })) say(next ? `Aligned ${next}` : 'Default alignment');
    }
    function setFormat(nf) {
      restyle('Number format', s => { s.nf = nf; delete s.dp; });
      say(`${NF.find(f => f[0] === nf)?.[1] || nf} format`);
      grid.focus({ preventScroll: true });
    }
    function decimals(d) {
      const x = S.book.cell(S.sid, S.cur.r, S.cur.c);
      const f = fmtOf(x) || { nf: 'general' };
      let nf = f.nf, dp = Number.isFinite(f.dp) ? f.dp : (E.DEFAULT_DP[nf] || 0);
      if (nf === 'general' || nf === 'date' || nf === 'datetime') {
        nf = 'number';
        const t = x && typeof x.v === 'number' ? E.general(x.v) : '';
        dp = t.includes('.') && !t.includes('E') ? t.length - t.indexOf('.') - 1 : 0;
      }
      dp = clamp(dp + d, 0, 10);
      if (restyle('Decimal places', s => { s.nf = nf; s.dp = dp; })) say(`${dp} decimal place${dp === 1 ? '' : 's'}`);
    }
    function clearContents() {
      const list = [];
      eachExisting(opRect(), x => { if (x.raw !== '') list.push({ r: x.r, c: x.c, raw: '' }); });
      if (applyChanges(list, 'Clear')) say(`Cleared ${list.length} cell${list.length === 1 ? '' : 's'}`);
    }
    function clearFormatting() {
      const list = [];
      eachExisting(opRect(), x => { if (x.s) list.push({ r: x.r, c: x.c, s: null }); });
      if (applyChanges(list, 'Clear formatting')) say('Formatting cleared');
    }
    /** ⌘D: the top row of the selection (or the row above one row) down the
        rest of it; ⌘R the same across. Relative references follow. */
    function fill(dir) {
      if (S.edit) commitEdit(0, 0, false);
      const g = opRect(), list = [];
      if (dir === 'down') {
        const src = g.r1 === g.r2 ? g.r1 - 1 : g.r1, from = g.r1 === g.r2 ? g.r1 : g.r1 + 1;
        if (src < 0) return;
        for (let c = g.c1; c <= g.c2; c++) {
          const x = S.book.cell(S.sid, src, c);
          for (let r = from; r <= g.r2; r++) if (!hidden.has(r)) list.push({ r, c, raw: x ? E.shiftFormula(x.raw, r - src, 0) : '', s: x && x.s ? { ...x.s } : null });
        }
      } else {
        const src = g.c1 === g.c2 ? g.c1 - 1 : g.c1, from = g.c1 === g.c2 ? g.c1 : g.c1 + 1;
        if (src < 0) return;
        for (let r = g.r1; r <= g.r2; r++) {
          if (hidden.has(r)) continue;
          const x = S.book.cell(S.sid, r, src);
          for (let c = from; c <= g.c2; c++) list.push({ r, c, raw: x ? E.shiftFormula(x.raw, 0, c - src) : '', s: x && x.s ? { ...x.s } : null });
        }
      }
      if (applyChanges(list, dir === 'down' ? 'Fill down' : 'Fill right')) say(`Filled ${dir}`);
    }

    /* ================= clipboard ================= */
    /* The real clipboard, as tab-separated text: what Excel, Numbers and
       Google Sheets read and write. A copy inside Sheets also keeps the
       formulas and formats, used when that same text is pasted back. */
    function copySel(cut) {
      if (S.edit) commitEdit(0, 0, false);
      const g = opRect(), rows = [], cells = [], from = [];
      for (let r = g.r1; r <= g.r2; r++) {
        if (hidden.has(r)) continue;               /* as other spreadsheets: only the rows a filter shows */
        from.push(r);
        const row = [], cr = [];
        for (let c = g.c1; c <= g.c2; c++) {
          const x = S.book.cell(S.sid, r, c);
          row.push(x && x.raw !== '' ? E.formatValue(x.v, fmtOf(x)) : '');
          cr.push(x ? { raw: x.raw, s: x.s ? { ...x.s } : null } : null);
        }
        rows.push(row); cells.push(cr);
      }
      const tsv = CSV.write(rows, '\t').replace(/\n$/, '');
      S.clip = { sid: S.sid, g, cells, tsv, cut, from };
      paintSel();
      const n = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
      say(`${cut ? 'Cut' : 'Copied'} ${n === 1 ? E.cellName(g.r1, g.c1) : `${n} cells`}`);
      return tsv;
    }
    function pasteText(text) {
      if (text == null || S.dead) return;
      if (S.edit) commitEdit(0, 0, false);
      if (S.clip && text === S.clip.tsv && S.book.sheet(S.clip.sid)) { pasteInternal(); return; }
      const rows = CSV.parse(String(text), '\t');
      if (!rows.length) return;
      const g = opRect(), list = [];
      if (rows.length === 1 && rows[0].length === 1 && (g.r2 > g.r1 || g.c2 > g.c1)) {
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) list.push({ r, c, raw: rows[0][0] });
        if (applyChanges(list, 'Paste')) say(`Pasted into ${list.length} cells`);
        return;
      }
      const w = rows.reduce((m, x) => Math.max(m, x.length), 0);
      for (let i = 0; i < rows.length && g.r1 + i < E.MAX_ROWS; i++) {
        for (let j = 0; j < w && g.c1 + j < E.MAX_COLS; j++) list.push({ r: g.r1 + i, c: g.c1 + j, raw: rows[i][j] ?? '' });
      }
      applyChanges(list, 'Paste');
      const end = { r: Math.min(g.r1 + rows.length - 1, E.MAX_ROWS - 1), c: Math.min(g.c1 + w - 1, E.MAX_COLS - 1) };
      select({ r: g.r1, c: g.c1 }, { r: g.r1, c: g.c1 }, end, { show: false });
      say(`Pasted ${rows.length} row${rows.length === 1 ? '' : 's'} × ${w} column${w === 1 ? '' : 's'}`);
    }
    function pasteInternal() {
      const C = S.clip, g = opRect();
      const dr = g.r1 - C.g.r1, dc = g.c1 - C.g.c1;
      const clears = [], list = [];
      if (C.cut) C.cells.forEach((row, i) => row.forEach((x, j) => clears.push({ r: C.from ? C.from[i] : C.g.r1 + i, c: C.g.c1 + j, raw: '', s: null })));
      if (C.cut && C.sid === S.sid) list.push(...clears);
      C.cells.forEach((row, i) => row.forEach((x, j) => {
        const r = g.r1 + i, c = g.c1 + j;
        if (r >= E.MAX_ROWS || c >= E.MAX_COLS) return;
        const rdr = C.from ? r - C.from[i] : dr;
        list.push({ r, c, raw: x ? (C.cut ? x.raw : E.shiftFormula(x.raw, rdr, dc)) : '', s: x && x.s ? { ...x.s } : null });
      }));
      applyChanges(list, C.cut ? 'Move' : 'Paste');
      if (C.cut && C.sid !== S.sid) applyChanges(clears, 'Move', { sid: C.sid });
      if (C.cut) S.clip = null;
      select({ r: g.r1, c: g.c1 }, { r: g.r1, c: g.c1 }, { r: g.r1 + C.cells.length - 1, c: g.c1 + C.cells[0].length - 1 }, { show: false });
      say(C.cut ? 'Moved' : 'Pasted');
    }
    let clipEvent = false;
    const mine = () => !S.dead && !S.edit && document.activeElement === grid;
    const onCopy = e => {
      if (!mine()) return;
      clipEvent = true;
      e.preventDefault();
      e.clipboardData.setData('text/plain', copySel(e.type === 'cut'));
    };
    const onPaste = e => {
      if (!mine()) return;
      clipEvent = true;
      e.preventDefault();
      pasteText(e.clipboardData.getData('text/plain'));
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    /** a browser that fires no copy/paste event for a focused grid gets the async clipboard instead */
    function clipFallback(key) {
      clipEvent = false;
      setTimeout(() => {
        if (clipEvent || S.dead) return;
        if (key === 'v') navigator.clipboard?.readText?.().then(pasteText, () => say('The browser didn’t let Sheets read the clipboard'));
        else writeClip(copySel(key === 'x'));
      }, 0);
    }
    function writeClip(text) {
      navigator.clipboard?.writeText?.(text).catch(() => say('The browser didn’t let Sheets use the clipboard'));
      api.bus.emit('clipboard:add', { text, source: 'sheets' });
    }
    function menuPaste() {
      if (!navigator.clipboard?.readText) { say(`Press ${MODK}V to paste`); return; }
      navigator.clipboard.readText().then(pasteText, () => api.notify({
        app: 'Static Sheets', icon: 'clipboard', title: `Press ${MODK}V to paste`,
        message: 'The browser only lets a page read the clipboard when you paste with the keyboard (or allow it when asked).',
      }));
    }

    /* ================= find ================= */
    function openFind() {
      if (S.edit) commitEdit(0, 0, false);
      S.find.open = true;
      findBar.hidden = false;
      findIn.focus();
      findIn.select();
      if (findIn.value) runFind();
    }
    function closeFind() {
      S.find.open = false;
      findBar.hidden = true;
      S.find.set = null; S.find.now = -1; S.find.hits = []; S.find.i = -1;
      findN.textContent = '';
      paint(true);
      grid.focus({ preventScroll: true });
    }
    /** every cell whose shown value — or formula — contains the text (any case) */
    function runFind() {
      const q = findIn.value.toLowerCase(), hits = [];
      if (q) {
        for (const x of sheet().cells.values()) {
          if (x.raw === '') continue;
          if (E.formatValue(x.v, fmtOf(x)).toLowerCase().includes(q) || (x.f && x.raw.toLowerCase().includes(q))) hits.push({ r: x.r, c: x.c });
        }
      }
      hits.sort((a, b) => a.r - b.r || a.c - b.c);
      S.find.hits = hits;
      S.find.set = new Set(hits.map(p => LK(p.r, p.c)));
      S.find.i = -1; S.find.now = -1;
      findN.textContent = !q ? '' : hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'No matches';
      paint(true);
    }
    function findStep(d) {
      const hits = S.find.hits;
      if (!hits.length) { findN.textContent = findIn.value ? 'No matches' : ''; return; }
      let i;
      if (S.find.i < 0) {
        const at = LK(S.cur.r, S.cur.c);
        if (d > 0) { i = hits.findIndex(p => LK(p.r, p.c) >= at); if (i < 0) i = 0; }
        else { i = -1; for (let j = hits.length - 1; j >= 0; j--) if (LK(hits[j].r, hits[j].c) < at) { i = j; break; } if (i < 0) i = hits.length - 1; }
      } else i = (S.find.i + d + hits.length) % hits.length;
      S.find.i = i;
      const p = hits[i];
      S.find.now = LK(p.r, p.c);
      moveTo(p.r, p.c);
      paint(true);
      findN.textContent = `${i + 1} of ${hits.length}`;
    }
    findIn.addEventListener('input', () => runFind());
    findIn.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });

    /* ================= charts ================= */
    const showAt = sid => (r, c) => { const x = S.book.cell(sid, r, c); return x ? E.formatValue(x.v, fmtOf(x)) : ''; };
    const chartSpec = ch => ({ type: ch.type, title: ch.title, xLabel: ch.xLabel || '', yLabel: ch.yLabel || '', trend: ch.trend !== false, data: Chart.chartData(S.book, ch.sid, ch.g, showAt(ch.sid), ch.type) });
    /** the block of data around a cell (what a chart uses when one cell is selected) */
    function regionAround(r, c) {
      const ext = S.book.extentOf(S.sid);
      const g = { r1: r, r2: r, c1: c, c2: c };
      const any = (r1, r2, c1, c2) => {
        for (let i = Math.max(0, r1); i <= r2; i++) for (let j = Math.max(0, c1); j <= c2; j++) if (filled(i, j)) return true;
        return false;
      };
      for (let grew = true; grew;) {
        grew = false;
        if (g.r1 > 0 && any(g.r1 - 1, g.r1 - 1, g.c1 - 1, g.c2 + 1)) { g.r1--; grew = true; }
        if (g.r2 < ext.r && any(g.r2 + 1, g.r2 + 1, g.c1 - 1, g.c2 + 1)) { g.r2++; grew = true; }
        if (g.c1 > 0 && any(g.r1 - 1, g.r2 + 1, g.c1 - 1, g.c1 - 1)) { g.c1--; grew = true; }
        if (g.c2 < ext.c && any(g.r1 - 1, g.r2 + 1, g.c2 + 1, g.c2 + 1)) { g.c2++; grew = true; }
      }
      return g;
    }
    function addChart(type) {
      if (S.edit) commitEdit(0, 0, false);
      let g = opRect();
      if (g.r1 === g.r2 && g.c1 === g.c2) g = regionAround(g.r1, g.c1);
      const data = Chart.chartData(S.book, S.sid, g, showAt(S.sid), type);
      if (!data.series.length) {
        const scatter = type === 'scatter';
        api.notify({ app: 'Static Sheets', icon: 'bar-chart', title: 'Nothing to chart yet', message: scatter
          ? 'A scatter chart needs two columns of numbers side by side: x on the left, y on the right. Select them, then pick Scatter.'
          : 'Select cells with numbers in them — a column of names beside them becomes the labels — then pick a chart.' });
        say(scatter ? 'Select two columns of numbers first' : 'Select some numbers to chart first');
        return null;
      }
      const one = data.series.length === 1 && !/^(Column|Row) /.test(data.series[0].name);
      const ch = { id: ++S.chartSeq, sid: S.sid, g, type, title: one ? data.series[0].name : `Chart ${S.charts.filter(x => x.sid === S.sid).length + 1}`, xLabel: data.xy ? '' : data.labelHead || '', yLabel: '', trend: true };
      S.charts.push(ch);
      S.showCharts = true;
      renderCharts();
      markDirty();
      say(`${Chart.TYPE_NAMES[type]} chart of ${E.rangeName(g)} added`);
      return ch;
    }
    const cards = new Map();
    let theme = null;
    function toggleCharts(on = !S.showCharts) { S.showCharts = on; renderCharts(); paint(); }
    function renderCharts() {
      const list = S.charts.filter(c => c.sid === S.sid);
      chartCount.textContent = list.length ? String(list.length) : '';
      bCharts.setAttribute('aria-pressed', String(S.showCharts));
      panel.hidden = !S.showCharts;
      cards.clear();
      api.clear(panel);
      if (!S.showCharts) return;
      panel.append(h('div.ss-charts__head', h('b', { text: 'Charts' }), h('div.ss-grow'), tb('x', 'Hide charts', () => toggleCharts(false), null, '')));
      if (!list.length) {
        panel.append(h('div.empty', icon('bar-chart'), h('b', { text: 'No charts on this sheet' }),
          h('small', { text: 'Select a range with numbers and pick Bar, Line or Pie in the toolbar (More charts has stacked bar, stacked area and scatter).' })));
        return;
      }
      for (const ch of list) panel.append(chartCard(ch));
      drawCharts();
    }
    function chartCard(ch) {
      const canvas = h('canvas', { role: 'img' });
      const tip = h('div.ss-tip', { hidden: true, 'aria-hidden': 'true' });
      const title = h('input.ss-chart__title', { 'aria-label': 'Chart title', spellcheck: 'false' });
      title.value = ch.title;
      title.addEventListener('input', () => { ch.title = title.value; drawOne(ch); markDirty(); });
      const type = h('select.select', { 'aria-label': 'Chart type' }, Chart.TYPES.map(t => h('option', { value: t, text: Chart.TYPE_NAMES[t] })));
      type.value = ch.type;
      type.addEventListener('change', () => { ch.type = type.value; drawOne(ch); paintAxes(); markDirty(); say(`${Chart.TYPE_NAMES[ch.type]} chart`); });
      const more = h('button.ibtn', { type: 'button', 'aria-label': `Chart menu: ${ch.title || 'chart'}`, 'aria-haspopup': 'menu', onclick: e => chartMenu(ch, e.currentTarget) }, icon('more-horizontal'));
      const note = h('span.dim');
      const sh = S.book.sheet(ch.sid);
      /* axis titles, and a scatter's trend line */
      const axis = (k, label) => {
        const inp = h('input.ss-chart__axis', { 'aria-label': label, placeholder: label, spellcheck: 'false', maxlength: '80' });
        inp.value = ch[k] || '';
        inp.addEventListener('input', () => { ch[k] = inp.value.slice(0, 80); drawOne(ch); markDirty(); });
        return inp;
      };
      const trend = h('input', { type: 'checkbox', 'aria-label': 'Trend line', checked: ch.trend !== false ? true : null,
        onchange: e => { ch.trend = e.target.checked; drawOne(ch); markDirty(); say(ch.trend ? 'Trend line on' : 'Trend line off'); } });
      const trendRow = h('label.ss-chart__trend', trend, h('span', { text: 'Trend line (least squares)' }));
      const axes = h('div.ss-chart__axes', axis('xLabel', 'X axis title'), axis('yLabel', 'Y axis title'));
      function paintAxes() { axes.hidden = !Chart.hasAxes(ch.type); trendRow.hidden = ch.type !== 'scatter'; }
      paintAxes();
      const el = h('div.ss-chart', { dataset: { chart: String(ch.id) } },
        h('div.ss-chart__top', title, type, more), canvas, axes, trendRow,
        h('div.ss-chart__foot', h('code', { text: `${E.quoteSheet(sh ? sh.name : '?')}!${E.rangeName(ch.g)}` }), h('div.ss-grow'), note), tip);
      cards.set(ch.id, { el, canvas, tip, note, layout: null });
      canvas.addEventListener('pointermove', e => hoverChart(ch, e));
      canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
      return el;
    }
    function drawCharts() { for (const ch of S.charts) if (cards.has(ch.id)) drawOne(ch); }
    function drawOne(ch) {
      const card = cards.get(ch.id);
      if (!card || S.dead) return;
      const cv = card.canvas;
      const w = Math.max(80, cv.clientWidth || 300), hh = Math.max(80, cv.clientHeight || 210);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      theme = theme || Chart.readTheme(panel);
      const spec = chartSpec(ch);
      /* the card's title field names it on screen; the exported PNG draws the title in */
      card.layout = Chart.drawChart(g, w, hh, { ...spec, title: '' }, theme);
      cv.setAttribute('aria-label', Chart.describe(spec, v => E.general(v)));
      card.note.textContent = spec.data.note || '';
    }
    function hoverChart(ch, e) {
      const card = cards.get(ch.id), L = card && card.layout;
      if (!L || !theme) return;
      const rect = card.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      let headText = '', rows = [];
      if (L.kind === 'pie' && L.pie) {
        const dx = x - L.pie.cx, dy = y - L.pie.cy;
        if (Math.hypot(dx, dy) <= L.pie.R) {
          let a = Math.atan2(dy, dx);
          if (a < -Math.PI / 2) a += Math.PI * 2;
          const i = L.slices.findIndex(s => a >= s.a0 && a < s.a1);
          if (i >= 0) { const s = L.slices[i]; headText = s.label; rows = [{ color: theme.colors[i], text: `${E.general(s.v)} · ${Math.round(s.share * 1000) / 10}%` }]; }
        }
      } else if (L.kind === 'scatter' && L.pts) {
        /* the nearest point, within 12px */
        let best = null, bd = 144;
        for (const p of L.pts) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
        if (best) {
          const sp = chartSpec(ch).data.series[best.k];
          headText = sp ? sp.name : 'Point';
          rows = [{ color: theme.colors[best.k], text: `x ${E.general(best.vx)}, y ${E.general(best.vy)}` }];
        }
      } else if (L.plot && y >= L.plot.top - 8 && y <= L.plot.bottom + 18) {
        const cat = L.cats.find(k => x >= k.x0 && x < k.x1);
        if (cat) { headText = cat.label; rows = cat.values.map((v, i) => ({ color: theme.colors[i], text: `${v.name}: ${v.v == null ? '—' : E.general(v.v)}` })); }
      }
      if (!headText) { card.tip.hidden = true; return; }
      api.render(card.tip, h('b', { text: headText }), ...rows.map(r => h('div', h('i', { style: { background: r.color } }), r.text)));
      card.tip.hidden = false;
      const cr = card.el.getBoundingClientRect();
      const tw = card.tip.offsetWidth;
      card.tip.style.left = `${clamp(e.clientX - cr.left + 12, 4, Math.max(4, cr.width - tw - 4))}px`;
      card.tip.style.top = `${e.clientY - cr.top + 14}px`;
    }
    function chartMenu(ch, anchor) {
      const r = anchor.getBoundingClientRect();
      api.menu([
        { label: 'Save as PNG to Pictures', icon: 'image', onClick: () => exportChart(ch) },
        { label: 'Select its data', icon: 'table', onClick: () => { select({ r: ch.g.r1, c: ch.g.c1 }, { r: ch.g.r1, c: ch.g.c1 }, { r: ch.g.r2, c: ch.g.c2 }); grid.focus(); } },
        { label: 'Use the selected cells', icon: 'edit-3', onClick: () => { ch.g = opRect(); renderCharts(); markDirty(); say(`Chart now shows ${E.rangeName(ch.g)}`); } },
        '-',
        { label: 'Delete chart', icon: 'trash', danger: true, onClick: () => { S.charts = S.charts.filter(x => x !== ch); renderCharts(); markDirty(); say('Chart deleted'); } },
      ], r.left, r.bottom + 4, { label: 'Chart' });
    }
    /** a real PNG in ~/Pictures, drawn at 1600×1000 on the chart's own surface */
    async function exportChart(ch) {
      try {
        const W = 800, H = 500, k = 2;
        const cv = document.createElement('canvas');
        cv.width = W * k; cv.height = H * k;
        const g = cv.getContext('2d');
        g.scale(k, k);
        Chart.drawChart(g, W, H, chartSpec(ch), theme || Chart.readTheme(panel));
        const blob = await new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('The chart could not be drawn.'))), 'image/png'));
        const { path } = await media.save(`${vfs.HOME}/Pictures`, `${safeName(ch.title) || 'Chart'}.png`, blob);
        api.notify({ app: 'Static Sheets', icon: 'image', title: 'Chart saved to Pictures', message: vfs.baseName(path), actions: [{ label: 'Open', onClick: () => api.openFile(path) }] });
        say(`Saved ${vfs.baseName(path)} to Pictures`);
        return path;
      } catch (err) {
        api.notify({ app: 'Static Sheets', icon: 'alert', title: 'Couldn’t save the chart', message: (err && err.message) || String(err) });
        return null;
      }
    }

    /* ================= sheet tabs ================= */
    let renaming = null;
    function renderTabs() {
      api.clear(tabs);
      for (const sh of S.book.sheets) {
        if (renaming === sh.id) {
          const inp = h('input.ss-tabin', { 'aria-label': 'Sheet name', spellcheck: 'false' });
          inp.value = sh.name;
          let done = false;
          const finish = ok => {
            if (done) return;
            done = true; renaming = null;
            if (ok) renameSheet(sh.id, inp.value.trim());
            renderTabs();
            tabs.querySelector('.ss-tab[aria-selected="true"]')?.focus();
          };
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
          });
          inp.addEventListener('blur', () => finish(true));
          tabs.append(inp);
          setTimeout(() => { inp.focus(); inp.select(); }, 0);
          continue;
        }
        const on = sh.id === S.sid;
        const tc = sh.meta && sh.meta.tab;
        const t = h('button.ss-tab', { type: 'button', role: 'tab', 'aria-selected': String(on), 'aria-controls': grid.id, tabindex: on ? '0' : '-1', dataset: { sid: String(sh.id) }, text: sh.name,
          class: tc ? 'has-color' : null, style: tc ? { '--tab': `var(--chart-${tc})` } : null,
          'aria-description': tc ? `${TAB_COLORS.find(c => c[0] === tc)[1].toLowerCase()} tab` : null });
        t.addEventListener('click', () => switchSheet(sh.id));
        t.addEventListener('dblclick', () => { renaming = sh.id; renderTabs(); });
        t.addEventListener('contextmenu', e => { e.preventDefault(); tabMenu(sh, e.clientX, e.clientY); });
        t.addEventListener('keydown', e => {
          const all = [...tabs.querySelectorAll('.ss-tab')], i = all.indexOf(t);
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            const n = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
            switchSheet(Number(n.dataset.sid), true);
          } else if (e.key === 'F2') { e.preventDefault(); renaming = sh.id; renderTabs(); }
          else if (e.key === 'Delete') { e.preventDefault(); deleteSheet(sh.id); }
          else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); const r = t.getBoundingClientRect(); tabMenu(sh, r.left, r.top - 4); }
        });
        tabs.append(t);
      }
    }
    function tabMenu(sh, x, y) {
      const cur = (sh.meta && sh.meta.tab) || '';
      api.menu([
        { label: 'Rename…', icon: 'edit-3', hint: 'F2', onClick: () => { renaming = sh.id; renderTabs(); } },
        { label: 'Duplicate', icon: 'copy', onClick: () => duplicateSheet(sh.id) },
        { label: 'Tab colour', icon: 'palette', items: TAB_COLORS.map(([n, name]) => ({ label: name, checked: n === cur, onClick: () => setTabColor(sh.id, n) })) },
        '-',
        { label: 'Delete sheet', icon: 'trash', danger: true, disabled: S.book.sheets.length < 2, onClick: () => deleteSheet(sh.id) },
      ], x, y, { label: `Sheet ${sh.name}` });
    }
    function resetRows() {
      for (const [r, el] of rowsOn) { rowsOn.delete(r); spare.push(el); el.remove(); }
      for (const [r, el] of fzRows) { fzRows.delete(r); el.remove(); }
      /* rows come back from the pool with the frozen columns' cells rebuilt */
      for (const el of spare) { for (const x of el._fz) x.remove(); el._fz = []; }
      win0 = { r0: -1, r1: -1, c0: -1, c1: -1 };
      colsDirty = true;
    }
    function gridLabel() { grid.setAttribute('aria-label', `${sheet().name} — ${S.doc.path ? vfs.baseName(S.doc.path) : 'Untitled sheet'}`); }
    function switchSheet(sid, focusTab = false) {
      if (!S.book.sheet(sid)) return;
      if (sid !== S.sid) {
        if (S.edit) commitEdit(0, 0, false);
        S.views.set(S.sid, { cur: S.cur, anchor: S.anchor, focus: S.focus, top: grid.scrollTop, left: grid.scrollLeft });
        S.sid = sid;
        const v = S.views.get(sid) || { cur: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 }, top: 0, left: 0 };
        S.cur = v.cur; S.anchor = v.anchor; S.focus = v.focus;
        resetRows();
        FR = -1;                               /* metaChanged sets this sheet's frozen panes */
        metaChanged();
        layout();
        grid.scrollTop = v.top; grid.scrollLeft = v.left;
        if (S.find.open) runFind();
        paint(true);
        renderCharts();
        syncBars();
        gridLabel();
        say(`${sheet().name}`);
      }
      renderTabs();
      if (focusTab) tabs.querySelector(`.ss-tab[data-sid="${sid}"]`)?.focus();
    }
    function addSheet() {
      if (S.edit) commitEdit(0, 0, false);
      const sh = S.book.addSheet();
      S.book.relinkAll();                    /* formulas that named it now find it */
      switchSheet(sh.id);
      markDirty();
      grid.focus({ preventScroll: true });
    }
    function renameSheet(sid, name) {
      const sh = S.book.sheet(sid);
      if (!sh || !name || name === sh.name) return;
      if (name.length > 60 || /[[\]*?/\\:]/.test(name)) {
        api.notify({ app: 'Static Sheets', icon: 'alert', title: 'That name won’t work', message: 'Sheet names can’t have [ ] * ? / \\ or : in them, or be longer than 60 characters.' });
        return;
      }
      const old = sh.name;
      if (!S.book.renameSheet(sid, name)) {
        api.notify({ app: 'Static Sheets', icon: 'alert', title: 'That name is taken', message: `There’s already a sheet called “${name}”.` });
        return;
      }
      /* undo steps and the clipboard keep pointing at the right sheet */
      for (const rec of [...S.undo, ...S.redo]) for (const x of rec.cells) { x.before.raw = E.renameSheetIn(x.before.raw, old, name); x.after.raw = E.renameSheetIn(x.after.raw, old, name); }
      if (S.clip) for (const row of S.clip.cells) for (const x of row) if (x) x.raw = E.renameSheetIn(x.raw, old, name);
      paint(true); renderCharts(); gridLabel(); markDirty();
      say(`Renamed to ${name}`);
    }
    async function deleteSheet(sid) {
      const sh = S.book.sheet(sid);
      if (!sh) return;
      if (S.book.sheets.length < 2) { say('A workbook keeps at least one sheet'); return; }
      const ok = await api.confirm({
        title: `Delete “${sh.name}”?`, ok: 'Delete sheet', danger: true,
        message: 'Its cells and charts go for good — this can’t be undone. Formulas on other sheets that use it will show #REF!.',
      });
      if (!ok || S.dead || !S.book.sheet(sid)) return;
      const i = S.book.sheets.indexOf(sh);
      if (S.sid === sid) switchSheet((S.book.sheets[i + 1] || S.book.sheets[i - 1]).id);
      S.book.removeSheet(sid);
      S.charts = S.charts.filter(c => c.sid !== sid);
      S.undo = S.undo.filter(r => r.sid !== sid);
      S.redo = S.redo.filter(r => r.sid !== sid);
      S.views.delete(sid);
      if (S.clip && S.clip.sid === sid) S.clip = null;
      paint(true); renderTabs(); renderCharts(); syncBars(); markDirty();
      say(`${sh.name} deleted`);
    }

    /* ================= borders, merge, freeze ================= */
    function formatItems() {
      const m = mergeAt(S.cur.r, S.cur.c), g = opRect();
      const multi = g.r1 !== g.r2 || g.c1 !== g.c2;
      return [
        { label: 'All borders', icon: 'grid', onClick: () => borders('all') },
        { label: 'Outside borders', icon: 'square', onClick: () => borders('outside') },
        { label: 'Bottom border', icon: 'minus', onClick: () => borders('bottom') },
        { label: 'No borders', icon: 'x', onClick: () => borders('none') },
        '-',
        m ? { label: `Unmerge ${E.rangeName(m)}`, icon: 'minimize-2', onClick: () => unmerge() }
          : { label: 'Merge cells', icon: 'maximize-2', disabled: !multi, onClick: () => mergeCells() },
        { label: 'Wrap text', icon: 'type', checked: !!activeStyle().wr, onClick: () => toggleStyle('wr') },
        '-',
        { label: 'Conditional formatting…', icon: 'droplet', onClick: () => cfDialog() },
        { label: 'Dropdown or number check…', icon: 'check-circle', onClick: () => dvDialog() },
        { label: 'Clear formatting', icon: 'type', onClick: clearFormatting },
      ];
    }
    /* borders are part of each cell's style: t b l r */
    function borders(kind) {
      const g = opRect();
      const sides = (r, c) => {
        if (kind === 'none') return '';
        if (kind === 'all') return 'tblr';
        if (kind === 'bottom') return r === g.r2 ? 'b' : '';
        return `${r === g.r1 ? 't' : ''}${r === g.r2 ? 'b' : ''}${c === g.c1 ? 'l' : ''}${c === g.c2 ? 'r' : ''}`;
      };
      const label = { all: 'All borders', outside: 'Outside borders', bottom: 'Bottom border', none: 'No borders' }[kind];
      if (restyle(label, (s, r, c) => {
        const keep = kind === 'none' || kind === 'all' ? '' : (s.bd || '');
        const next = [...new Set((keep + sides(r, c)).split(''))].join('');
        if (next) s.bd = next; else delete s.bd;
      })) say(label);
    }
    function mergeCells() {
      if (S.edit) commitEdit(0, 0, false);
      const g = opRect();
      if (g.r1 === g.r2 && g.c1 === g.c2) { say('Select two or more cells to merge'); return; }
      if ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > MERGE_AREA) { api.notify({ app: 'Static Sheets', icon: 'alert', title: 'That’s too big to merge', message: `A merged area can hold up to ${MERGE_AREA.toLocaleString()} cells.` }); return; }
      const f = ix().filter;
      if (f && overlaps(g, { r1: f.r1, c1: f.c1, r2: fltEnd, c2: f.c2 })) { api.notify({ app: 'Static Sheets', icon: 'alert', title: 'Can’t merge inside a filter', message: 'Remove the filter first, then merge.' }); return; }
      let hiddenOnes = 0;
      eachExisting(g, x => { if (x.raw !== '' && !(x.r === g.r1 && x.c === g.c1)) hiddenOnes++; });
      if (applyChanges([], 'Merge cells', { meta: m => { m.merges = [...(m.merges || []).filter(x => !overlaps(x, g)), g]; } })) {
        select({ r: g.r1, c: g.c1 });
        say(`Merged ${E.rangeName(g)}`);
        if (hiddenOnes) api.notify({ app: 'Static Sheets', icon: 'info', title: `Merged ${E.rangeName(g)}`, message: `Only the top-left cell shows. The ${hiddenOnes === 1 ? 'other cell that had something in it is' : `${hiddenOnes} other cells that had something in them are`} kept under it, and come back if you unmerge.`, timeout: 8000 });
      }
    }
    function unmerge() {
      const m = mergeAt(S.cur.r, S.cur.c);
      if (!m) return;
      if (applyChanges([], 'Unmerge', { meta: mm => { mm.merges = (mm.merges || []).filter(x => !(x.r1 === m.r1 && x.c1 === m.c1)); } })) {
        select({ r: m.r1, c: m.c1 }, { r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 });
        say(`Unmerged ${E.rangeName(m)}`);
      }
    }
    function freezeItems() {
      const fz = sheet().meta.freeze || { r: 0, c: 0 };
      const at = { r: S.cur.r, c: S.cur.c };
      return [
        { label: 'Freeze the top row', icon: 'snowflake', checked: fz.r === 1 && !fz.c, onClick: () => freeze(1, 0) },
        { label: 'Freeze the first column', icon: 'snowflake', checked: fz.c === 1 && !fz.r, onClick: () => freeze(0, 1) },
        { label: `Freeze rows above and columns left of ${E.cellName(at.r, at.c)}`, icon: 'snowflake', disabled: !at.r && !at.c, onClick: () => freeze(at.r, at.c) },
        '-',
        { label: 'Unfreeze', icon: 'x', disabled: !fz.r && !fz.c, onClick: () => freeze(0, 0) },
      ];
    }
    function freeze(r, c) {
      if (r > FREEZE_R || c > FREEZE_C) { api.notify({ app: 'Static Sheets', icon: 'alert', title: 'That’s a lot to freeze', message: `Up to ${FREEZE_R} rows and ${FREEZE_C} columns can be frozen.` }); return; }
      /* what stays put has to leave room to scroll the rest */
      if (r && rowTop(r) > grid.clientHeight - HEAD_H - ROW_H * 2) { api.notify({ app: 'Static Sheets', icon: 'alert', title: 'Those rows don’t fit', message: 'Frozen rows have to leave room in the window for the rest to scroll. Freeze fewer, or make the window taller.' }); return; }
      if (c && colX[Math.min(c, nCols)] > grid.clientWidth - HEAD_W - 60) { api.notify({ app: 'Static Sheets', icon: 'alert', title: 'Those columns don’t fit', message: 'Frozen columns have to leave room in the window for the rest to scroll.' }); return; }
      const label = !r && !c ? 'Unfreeze' : 'Freeze';
      if (applyChanges([], label, { meta: m => { if (r || c) m.freeze = { r, c }; else delete m.freeze; } })) {
        say(!r && !c ? 'Nothing frozen' : `Frozen: ${r ? `${r} row${r === 1 ? '' : 's'}` : ''}${r && c ? ' and ' : ''}${c ? `${c} column${c === 1 ? '' : 's'}` : ''}`);
      }
    }

    /* ================= sort and filter ================= */
    function dataItems() {
      const f = ix().filter, c = S.cur.c;
      const inFlt = f && c >= f.c1 && c <= f.c2;
      return [
        { label: `Sort A → Z by column ${E.colName(c)}`, icon: 'arrow-down', onClick: () => sortCmd(false) },
        { label: `Sort Z → A by column ${E.colName(c)}`, icon: 'arrow-up', onClick: () => sortCmd(true) },
        '-',
        f ? { label: 'Remove the filter', icon: 'x', onClick: () => removeFilter() } : { label: 'Filter', icon: 'filter', onClick: () => addFilter() },
        f && inFlt ? { label: `Filter column ${E.colName(c)}…`, icon: 'filter', onClick: () => filterPanel(c) } : null,
        f ? { label: 'Reapply the filter', icon: 'refresh', disabled: !Object.keys(f.by).length, onClick: () => { applyFilter(); rebuildRows(); paint(true); syncBars(); say(`Showing ${visibleCount()} rows`); } } : null,
        '-',
        { label: 'Dropdown or number check…', icon: 'check-circle', onClick: () => dvDialog() },
        { label: 'Send to Statistics', icon: 'bar-chart', onClick: () => sendToStats() },
      ].filter(Boolean);
    }
    /** the area to sort or filter: the selection, or the block of data around one cell */
    const dataArea = () => { const g = opRect(); return g.r1 === g.r2 && g.c1 === g.c2 ? regionAround(g.r1, g.c1) : g; };
    /* a top row of text over a column with numbers in it, or the filter's own header, is a header */
    function hasHeader(g) {
      const f = ix().filter;
      if (f && f.r1 === g.r1 && f.c1 <= g.c1 && f.c2 >= g.c2) return true;
      if (g.r2 <= g.r1) return false;
      let text = 0, cells = 0, numsBelow = false;
      for (let c = g.c1; c <= g.c2; c++) {
        const x = S.book.cell(S.sid, g.r1, c);
        if (x && x.raw !== '') { cells++; if (typeof x.v === 'string') text++; }
        for (let r = g.r1 + 1; r <= Math.min(g.r2, g.r1 + 20) && !numsBelow; r++) { const y = S.book.cell(S.sid, r, c); if (y && typeof y.v === 'number') numsBelow = true; }
      }
      return cells > 0 && text === cells && numsBelow;
    }
    function sortCmd(desc, col = S.cur.c, area = null) {
      if (S.edit) commitEdit(0, 0, false);
      const f = ix().filter;
      let g = area || (f && col >= f.c1 && col <= f.c2 ? { r1: f.r1, c1: f.c1, r2: fltEnd, c2: f.c2 } : dataArea());
      if (col < g.c1 || col > g.c2) g = { ...g, c1: Math.min(g.c1, col), c2: Math.max(g.c2, col) };
      if (ix().merges.some(m => overlaps(m, g))) { api.notify({ app: 'Static Sheets', icon: 'alert', title: 'Merged cells can’t be sorted', message: 'Unmerge the cells in that range first, then sort.' }); return false; }
      const head = hasHeader(g), top = head ? g.r1 + 1 : g.r1;
      if (top >= g.r2) { say('There’s nothing to sort there'); return false; }
      const rows = [];
      for (let r = top; r <= g.r2; r++) {
        const key = S.book.cell(S.sid, r, col);
        const cells = [];
        for (let c = g.c1; c <= g.c2; c++) { const x = S.book.cell(S.sid, r, c); cells.push(x ? { raw: x.raw, s: x.s ? { ...x.s } : null } : null); }
        rows.push({ r, v: key && key.raw !== '' ? key.v : null, cells });
      }
      rows.sort((a, b) => sortKey(a.v, b.v, desc) || a.r - b.r);          /* stable: ties keep their order */
      const list = [];
      rows.forEach((row, i) => {
        const nr = top + i;
        row.cells.forEach((x, j) => list.push({ r: nr, c: g.c1 + j, raw: x ? E.shiftFormula(x.raw, nr - row.r, 0) : '', s: x ? x.s : null }));
      });
      const label = `Sort ${desc ? 'Z → A' : 'A → Z'}`;
      const did = applyChanges(list, label, { refilter: !!f });
      const where = `${E.rangeName({ r1: top, c1: g.c1, r2: g.r2, c2: g.c2 })} by column ${E.colName(col)}, ${desc ? 'Z → A' : 'A → Z'}${head ? ` (row ${g.r1 + 1} stays on top as the header)` : ''}`;
      say(did ? `Sorted ${where}` : `Already in that order: ${where}`);
      if (did) select({ r: top, c: col }, { r: top, c: g.c1 }, { r: g.r2, c: g.c2 }, { show: false });
      return did;
    }
    function visibleCount() { const f = filterSpan(); if (!f) return 0; let n = 0; for (let r = f.r1 + 1; r <= f.r2; r++) if (!hidden.has(r)) n++; return n; }
    function addFilter() {
      if (S.edit) commitEdit(0, 0, false);
      const g = dataArea();
      if (g.r2 <= g.r1 && !filled(g.r1, g.c1)) { api.notify({ app: 'Static Sheets', icon: 'filter', title: 'Nothing to filter yet', message: 'Click in a table with a header row (names on top, data under them), then choose Filter.' }); return; }
      if (ix().merges.some(m => overlaps(m, g))) { api.notify({ app: 'Static Sheets', icon: 'alert', title: 'Can’t filter merged cells', message: 'Unmerge the cells in that table first.' }); return; }
      if (applyChanges([], 'Filter', { meta: m => { m.filter = { ...g, by: {} }; } })) {
        say(`Filter on ${E.rangeName(g)}: row ${g.r1 + 1} is the header. Press Alt+Down on a header cell to filter that column.`);
      }
    }
    function removeFilter() {
      if (applyChanges([], 'Remove filter', { meta: m => { delete m.filter; } })) say('Filter removed: every row shows');
    }
    /* the ▾ on a cell: a filter header first, then a dropdown */
    function popupKind(r, c) {
      const f = ix().filter;
      if (f && r === f.r1 && c >= f.c1 && c <= f.c2) return 'filter';
      const d = IX.dv.length ? ruleAt(IX.dv, r, c) : null;
      return d && d.kind === 'list' ? 'list' : null;
    }
    function cellPopup(r, c) {
      const k = popupKind(r, c);
      if (k === 'filter') { filterPanel(c); return true; }
      if (k === 'list') { listMenu(r, c); return true; }
      return false;
    }
    function listMenu(r, c) {
      const d = ruleAt(ix().dv, r, c);
      const x = S.book.cell(S.sid, r, c), cur = shownOf(x).toLowerCase();
      const cel = activeCel && activeCel.isConnected ? activeCel.getBoundingClientRect() : grid.getBoundingClientRect();
      /* an option that would read as something else (007, 1/2) goes in as text */
      const rawFor = o => (E.formatValue(E.parseLiteral(o).v, E.parseLiteral(o).fmt) === o && !E.isFormula(o) ? o : `'${o}`);
      api.menu([
        ...d.opts.map(o => ({ label: o, checked: o.toLowerCase() === cur, onClick: () => { applyChanges([{ r, c, raw: rawFor(o) }], 'Choose'); grid.focus({ preventScroll: true }); say(`${E.cellName(r, c)}: ${o}`); } })),
        '-',
        { label: 'Clear', icon: 'x', disabled: !x || x.raw === '', onClick: () => { applyChanges([{ r, c, raw: '' }], 'Clear'); grid.focus({ preventScroll: true }); } },
      ], cel.left, cel.bottom + 2, { label: `Choose for ${E.cellName(r, c)}` });
    }

    /* a small sheet over the window, like Save as: focus stays inside, Esc closes */
    function dialog(title, build, { wide = false } = {}) {
      if (S.edit) commitEdit(0, 0, false);
      if (app.querySelector('.ss-dlg')) return null;
      const close = () => { dlg.remove(); grid.focus({ preventScroll: true }); };
      const card = h(`form.ss-dlg__card${wide ? '.is-wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', { text: title }));
      const dlg = h('div.ss-dlg', { onpointerdown: e => { if (e.target === dlg) close(); } }, card);
      card.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        if (e.key === 'Tab') {
          const f = [...card.querySelectorAll('input:not([disabled]), select, button:not([disabled]), textarea')].filter(n => n.offsetParent !== null);
          const i = f.indexOf(document.activeElement);
          if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      });
      build(card, close);
      app.appendChild(dlg);
      const first = card.querySelector('input, select, textarea, button');
      if (first) first.focus();
      return { card, close };
    }
    function filterPanel(c) {
      const f0 = filterSpan();
      if (!f0) return;
      const head = shownOf(S.book.cell(S.sid, f0.r1, c)) || `Column ${E.colName(c)}`;
      const vals = new Map();
      for (let r = f0.r1 + 1; r <= f0.r2 && vals.size < 5000; r++) { const t = shownOf(S.book.cell(S.sid, r, c)); vals.set(t, (vals.get(t) || 0) + 1); }
      const all = [...vals.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      const rule = f0.by[c] || {};
      const on = new Set(rule.vals || all);
      const SHOWN = 300;
      dialog(`Filter “${head.slice(0, 40)}”`, (card, close) => {
        const search = h('input', { type: 'search', placeholder: 'Search the values', 'aria-label': 'Search the values', spellcheck: 'false' });
        const list = h('div.ss-flt__list', { role: 'group', 'aria-label': 'Values to show' });
        const note = h('p.ss-flt__note');
        const paintList = () => {
          api.clear(list);
          const q = search.value.trim().toLowerCase();
          const hits = all.filter(v => !q || v.toLowerCase().includes(q));
          for (const v of hits.slice(0, SHOWN)) {
            list.append(h('label.ss-flt__item', h('input', { type: 'checkbox', checked: on.has(v) ? true : null, onchange: e => { if (e.target.checked) on.add(v); else on.delete(v); } }),
              h('span', { text: v === '' ? '(Blanks)' : v }), h('small', { text: String(vals.get(v)) })));
          }
          note.textContent = hits.length > SHOWN ? `Showing the first ${SHOWN} of ${hits.length} values — search, or use a condition below.` : '';
        };
        search.addEventListener('input', paintList);
        const op = h('select', { 'aria-label': 'Condition' }, FILTER_OPS.map(([v, t]) => h('option', { value: v, text: t })));
        op.value = rule.op || '';
        const a = h('input', { 'aria-label': 'Condition value', spellcheck: 'false', placeholder: 'Value' });
        a.value = rule.a || '';
        const paintOp = () => { a.hidden = !op.value || op.value === 'empty' || op.value === 'filled'; };
        op.addEventListener('change', paintOp);
        paintOp();
        const btn = (text, fn, cls = '') => h(`button.btn.btn--sm${cls}`, { type: 'button', text, onclick: fn });
        card.append(
          h('div.ss-dlg__row', btn('Sort A → Z', () => { close(); sortCmd(false, c); }), btn('Sort Z → A', () => { close(); sortCmd(true, c); })),
          h('label', 'Show rows with these values', search),
          h('div.ss-dlg__row', btn('Select all', () => { for (const v of all) on.add(v); paintList(); }, '.btn--ghost'), btn('Clear all', () => { on.clear(); paintList(); }, '.btn--ghost')),
          list, note,
          h('label', 'And where the value is', op, a),
          h('div.ss-dlg__btns',
            h('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: close }),
            h('button.btn.btn--ghost', { type: 'button', text: 'Clear this filter', disabled: !f0.by[c] ? true : null, onclick: () => { close(); setColumnFilter(c, null); } }),
            h('button.btn.btn--primary', { type: 'submit', text: 'Show' })));
        card.addEventListener('submit', e => {
          e.preventDefault();
          const next = {};
          if (on.size < all.length) next.vals = all.filter(v => on.has(v));
          if (op.value) { next.op = op.value; next.a = a.value.trim(); }
          close();
          setColumnFilter(c, Object.keys(next).length ? next : null);
        });
        paintList();
      }, { wide: true });
    }
    function setColumnFilter(c, rule) {
      const end = fltEnd;
      const did = applyChanges([], rule ? `Filter column ${E.colName(c)}` : `Clear the filter on ${E.colName(c)}`, { meta: m => {
        if (!m.filter) return;
        m.filter.r2 = Math.max(m.filter.r2, end);
        if (rule) m.filter.by[c] = rule; else delete m.filter.by[c];
      } });
      if (!did) { applyFilter(); rebuildRows(); paint(true); }
      const f = filterSpan();
      say(f ? `Showing ${visibleCount()} of ${f.r2 - f.r1} rows` : 'Filter changed');
    }

    /* ================= conditional formatting ================= */
    function cfDialog() {
      const g = opRect();
      dialog('Conditional formatting', (card, close) => {
        const listEl = h('div.ss-cf__list', { role: 'list', 'aria-label': 'Rules on this sheet' });
        const paintRules = () => {
          api.clear(listEl);
          const rules = ix().cf;
          if (!rules.length) { listEl.append(h('p.ss-flt__note', { text: 'No rules on this sheet yet.' })); return; }
          rules.forEach((x, i) => {
            const opName = CF_OPS.find(o => o[0] === x.op)[1];
            const what = x.op === 'empty' || x.op === 'filled' ? opName.toLowerCase() : x.op === 'between' ? `between ${x.a} and ${x.b}` : `${opName.toLowerCase()} ${x.a}`;
            listEl.append(h('div.ss-cf__rule', { role: 'listitem' },
              h('span.ss-cf__sw', { class: `cf-${x.fill}`, 'aria-hidden': 'true' }),
              h('span.grow', { text: `${E.rangeName(x)}: ${what}${x.bold ? ', bold' : ''}` }),
              h('button.ibtn', { type: 'button', 'aria-label': `Delete the rule for ${E.rangeName(x)}`, onclick: () => { applyChanges([], 'Delete rule', { meta: m => { m.cf = (m.cf || []).filter((_, j) => j !== i); } }); paintRules(); } }, icon('trash'))));
          });
        };
        const op = h('select', { 'aria-label': 'Condition' }, CF_OPS.map(([v, t]) => h('option', { value: v, text: t })));
        const a = h('input', { 'aria-label': 'Value', spellcheck: 'false', placeholder: 'Value' });
        const b = h('input', { 'aria-label': 'And', spellcheck: 'false', placeholder: 'and' });
        const paintOp = () => { a.hidden = op.value === 'empty' || op.value === 'filled'; b.hidden = op.value !== 'between'; };
        op.addEventListener('change', paintOp);
        paintOp();
        const fill = h('div.ss-cf__fills', { role: 'radiogroup', 'aria-label': 'Colour' },
          FILLS.map(([id, name], i) => h('label.ss-cf__fill', { title: name },
            h('input.sr', { type: 'radio', name: `${uid}-cf`, value: id, checked: i === 0 ? true : null, 'aria-label': name }),
            h('span.ss-cf__sw', { class: `cf-${id}` }))));
        const bold = h('input', { type: 'checkbox' });
        const why = h('div.ss-dlg__why', { role: 'alert' });
        card.append(listEl,
          h('div.side__label', { text: `New rule for ${E.rangeName(g)}` }),
          h('label', 'Colour the cell when it is', op, a, b),
          h('div.ss-dlg__row', fill, h('label.ss-dlg__check', bold, h('span', { text: 'Bold' }))),
          why,
          h('div.ss-dlg__btns', h('button.btn.btn--ghost', { type: 'button', text: 'Done', onclick: close }), h('button.btn.btn--primary', { type: 'submit', text: 'Add rule' })));
        card.addEventListener('submit', e => {
          e.preventDefault();
          const needA = op.value !== 'empty' && op.value !== 'filled';
          if (needA && !a.value.trim()) { why.textContent = 'Give it a value to compare with.'; a.focus(); return; }
          if (op.value === 'between' && (typeof E.parseLiteral(a.value.trim()).v !== 'number' || typeof E.parseLiteral(b.value.trim()).v !== 'number')) { why.textContent = 'Between needs two numbers.'; return; }
          if (ix().cf.length >= CF_MAX) { why.textContent = `A sheet holds up to ${CF_MAX} rules.`; return; }
          const fillId = card.querySelector(`input[name="${uid}-cf"]:checked`)?.value || 'red';
          applyChanges([], 'Conditional formatting', { meta: m => { m.cf = [...(m.cf || []), { ...g, op: op.value, a: needA ? a.value.trim() : '', b: op.value === 'between' ? b.value.trim() : '', fill: fillId, bold: bold.checked }]; } });
          why.textContent = '';
          a.value = ''; b.value = '';
          paintRules();
          say(`Rule added for ${E.rangeName(g)}`);
        });
        paintRules();
      }, { wide: true });
    }

    /* ================= dropdowns and number checks ================= */
    function dvDialog() {
      const g = opRect();
      const had = ix().dv.find(d => overlaps(d, g)) || null;
      dialog(`Check what goes in ${E.rangeName(g)}`, (card, close) => {
        const kind = h('select', { 'aria-label': 'Allow' },
          h('option', { value: 'list', text: 'A choice from a list (dropdown)' }), h('option', { value: 'int', text: 'A whole number' }), h('option', { value: 'num', text: 'A number' }));
        kind.value = had ? had.kind : 'list';
        const opts = h('textarea.ss-dlg__ta', { 'aria-label': 'Choices, one per line or separated by commas', rows: '4', spellcheck: 'false' });
        opts.value = had && had.kind === 'list' ? had.opts.join('\n') : '';
        const min = h('input', { 'aria-label': 'Smallest', inputmode: 'decimal', placeholder: 'No smallest' });
        const max = h('input', { 'aria-label': 'Largest', inputmode: 'decimal', placeholder: 'No largest' });
        if (had && had.kind !== 'list') { min.value = had.min == null ? '' : String(had.min); max.value = had.max == null ? '' : String(had.max); }
        const strict = h('select', { 'aria-label': 'When something else is typed' },
          h('option', { value: 'yes', text: 'Refuse it' }), h('option', { value: 'no', text: 'Allow it, but mark the cell' }));
        strict.value = had && had.strict === false ? 'no' : 'yes';
        const optsBox = h('label', 'Choices (one per line, or separated by commas)', opts);
        const range = h('div.ss-dlg__row', h('label', 'From', min), h('label', 'To', max));
        const paintKind = () => { optsBox.hidden = kind.value !== 'list'; range.hidden = kind.value === 'list'; };
        kind.addEventListener('change', paintKind);
        paintKind();
        const why = h('div.ss-dlg__why', { role: 'alert' });
        card.append(h('label', 'Allow', kind), optsBox, range, h('label', 'When something else is typed', strict), why,
          h('div.ss-dlg__btns',
            h('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: close }),
            h('button.btn.btn--ghost', { type: 'button', text: 'Remove check', disabled: had ? null : true, onclick: () => {
              applyChanges([], 'Remove check', { meta: m => { m.dv = (m.dv || []).filter(d => !overlaps(d, g)); } });
              close(); say(`No check on ${E.rangeName(g)}`);
            } }),
            h('button.btn.btn--primary', { type: 'submit', text: 'Save' })));
        card.addEventListener('submit', e => {
          e.preventDefault();
          const rule = { ...g, kind: kind.value, strict: strict.value === 'yes', opts: [], min: null, max: null };
          if (rule.kind === 'list') {
            rule.opts = [...new Set(opts.value.split(/[\n,]/).map(s => s.trim()).filter(Boolean))];
            if (!rule.opts.length) { why.textContent = 'Type at least one choice.'; opts.focus(); return; }
          } else {
            for (const [k, inp] of [['min', min], ['max', max]]) {
              const t = inp.value.trim();
              if (!t) continue;
              const v = E.parseLiteral(t).v;
              if (typeof v !== 'number') { why.textContent = `“${t}” isn’t a number.`; inp.focus(); return; }
              rule[k] = v;
            }
            if (rule.min != null && rule.max != null && rule.min > rule.max) { why.textContent = 'From has to be smaller than To.'; return; }
          }
          applyChanges([], rule.kind === 'list' ? 'Dropdown' : 'Number check', { meta: m => { m.dv = [...(m.dv || []).filter(d => !overlaps(d, g)), rule]; } });
          close();
          const bad = [];
          eachExisting(g, x => { if (x.raw !== '' && !dvPass(rule, x.v, shownOf(x))) bad.push(E.cellName(x.r, x.c)); });
          say(`${E.rangeName(g)} takes ${dvSays(rule)}${bad.length ? `. ${bad.length} cell${bad.length === 1 ? '' : 's'} already in it don’t, and are marked: ${bad.slice(0, 4).join(', ')}` : ''}`);
        });
      });
    }

    /* ================= describe my data (AI, only when asked) ================= */
    const AI_CELLS = 2000, AI_CHARS = 12000;
    const aiOut = h('div.ss-ai__out', { 'aria-live': 'polite' });
    const aiState = h('p.ss-ai__state');
    const aiFine = h('p.ss-ai__fine');
    const aiCopy = h('button.btn.btn--sm', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(aiOut.textContent); aiState.textContent = 'Copied.'; } catch (e) { aiState.textContent = 'Copying was blocked here — select the text instead.'; } } }, icon('copy'), h('span', { text: 'Copy' }));
    const aiAgain = h('button.btn.btn--sm', { type: 'button', onclick: () => describeData(AI.g) }, icon('refresh'), h('span', { text: 'Ask again' }));
    const aiPanel = h('aside.ss-ai', { hidden: true, 'aria-label': 'Describe my data' },
      h('div.ss-ai__head', icon('sparkles'), h('b', { text: 'About this data' }), h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: () => closeAI() }, icon('x'))),
      aiState, aiOut, h('div.ss-ai__acts', aiCopy, aiAgain), aiFine);
    aiPanel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeAI(); } });
    app.appendChild(aiPanel);
    const AI = { ctl: null, g: null };
    function closeAI() { AI.ctl?.abort(); AI.ctl = null; aiPanel.hidden = true; grid.focus({ preventScroll: true }); }
    async function describeData(area) {
      if (S.edit) commitEdit(0, 0, false);
      let g = area || opRect();
      if (!area && g.r1 === g.r2 && g.c1 === g.c2) g = regionAround(g.r1, g.c1);
      const ext = S.book.recount(S.sid);
      g = { r1: g.r1, c1: g.c1, r2: Math.min(g.r2, ext.r), c2: Math.min(g.c2, ext.c) };
      if (g.r2 < g.r1 || g.c2 < g.c1) { api.notify({ app: 'Static Sheets', icon: 'sparkles', title: 'Nothing to describe yet', message: 'Select some cells with data in them first.' }); return; }
      /* what is sent: the cells' shown values as tab-separated rows, and nothing else */
      const rows = [];
      let n = 0, cut = false;
      for (let r = g.r1; r <= g.r2 && !cut; r++) {
        if (hidden.has(r)) continue;
        const row = [];
        for (let c = g.c1; c <= g.c2; c++) { row.push(shownOf(S.book.cell(S.sid, r, c)).replace(/[\t\n]+/g, ' ')); n++; }
        rows.push(row);
        if (n >= AI_CELLS) cut = r < g.r2;
      }
      let tsv = rows.map(r => r.join('\t')).join('\n');
      if (tsv.length > AI_CHARS) { tsv = tsv.slice(0, AI_CHARS); cut = true; }
      if (!tsv.replace(/\s/g, '')) { api.notify({ app: 'Static Sheets', icon: 'sparkles', title: 'Those cells are empty', message: 'Select some cells with data in them first.' }); return; }
      AI.ctl?.abort();
      const ctl = new AbortController();
      AI.ctl = ctl; AI.g = g;
      const range = `${E.quoteSheet(sheet().name)}!${E.rangeName(g)}`;
      const LLM = await import('../portal/llm.js');
      const { describe } = await import('../portal/aimodel.js');
      if (S.dead || AI.ctl !== ctl) return;
      const who = describe();
      aiOut.textContent = '';
      aiState.textContent = `Asking ${who.name || 'the model'}…`;
      aiFine.textContent = `Only the shown values of ${range}${cut ? ' (the first part of it)' : ''}${hidden.size ? ', without the rows a filter hides,' : ''} were sent, to ${who.host}, because you pressed the button. A model can get things wrong: check what it says against your data. Nothing in the sheet is changed.`;
      aiCopy.disabled = true;
      aiPanel.hidden = false;
      try {
        const text = await LLM.stream([
          { role: 'system', content: 'You describe a small table from a student’s spreadsheet. Use only the data given; say plainly when it is too little to tell. Reply in plain text, no tables: one sentence on what the data seems to be, then 3 to 6 short points on totals, ranges, trends or anything that stands out, each on its own line starting with "- ". Do not invent numbers: any number you give must come from the data or be a simple sum or average of it.' },
          { role: 'user', content: `Cells ${range}, tab-separated, one row per line:\n\n${tsv}` },
        ], {
          signal: ctl.signal,
          onText: t => { if (AI.ctl === ctl) aiOut.textContent = t; },
          onWait: w => { if (AI.ctl === ctl) aiState.textContent = w.reason === 'busy' ? 'The model is busy — trying again in a moment…' : 'Waiting for another request to finish…'; },
        });
        if (AI.ctl !== ctl) return;
        aiOut.textContent = text;
        aiState.textContent = `From ${who.name || 'the model'}, about ${range}.`;
      } catch (err) {
        if (AI.ctl !== ctl || err.name === 'AbortError') return;
        aiState.textContent = String(err && err.message || err);
      }
      aiCopy.disabled = !aiOut.textContent;
    }

    /* ================= send to Static Study › Statistics ================= */
    function sendToStats() {
      if (S.edit) commitEdit(0, 0, false);
      let g = opRect();
      if (g.r1 === g.r2 && g.c1 === g.c2) { const a = regionAround(g.r1, g.c1); g = { r1: a.r1, r2: a.r2, c1: g.c1, c2: g.c1 }; }
      const ext = S.book.recount(S.sid);
      g = { ...g, r2: Math.min(g.r2, ext.r) };
      const num = (r, c) => { const x = S.book.cell(S.sid, r, c); return x && typeof x.v === 'number' && Number.isFinite(x.v) ? x.v : null; };
      const visible = r => !hidden.has(r);
      let stats = null, what = '';
      if (g.c2 > g.c1) {
        const pts = [];
        for (let r = g.r1; r <= g.r2; r++) { const x = num(r, g.c1), y = num(r, g.c1 + 1); if (visible(r) && x != null && y != null) pts.push(`${E.general(x)}, ${E.general(y)}`); }
        if (pts.length) { stats = { mode: 'pairs', text: pts.join('\n') }; what = `${pts.length} x, y pairs from columns ${E.colName(g.c1)} and ${E.colName(g.c1 + 1)}`; }
      } else {
        const vals = [];
        for (let r = g.r1; r <= g.r2; r++) { const v = num(r, g.c1); if (visible(r) && v != null) vals.push(E.general(v)); }
        if (vals.length) { stats = { mode: 'list', text: vals.join('\n') }; what = `${vals.length} number${vals.length === 1 ? '' : 's'} from ${E.rangeName(g)}`; }
      }
      if (!stats) { api.notify({ app: 'Static Sheets', icon: 'bar-chart', title: 'No numbers to send', message: 'Select a column of numbers (or two side by side for x and y), then Send to Statistics.' }); return; }
      if (!api.getApp('study')) { api.notify({ app: 'Static Sheets', icon: 'alert', title: 'Static Study isn’t installed', message: 'Statistics lives in Static Study.' }); return; }
      api.openApp('study', { tab: 'stats', stats: { ...stats, from: `${sheet().name}!${E.rangeName(g)}` } });
      say(`Sent ${what} to Statistics`);
    }

    /* ================= print ================= */
    let printEl = null;
    function printSheet() {
      if (S.edit) commitEdit(0, 0, false);
      const sh = sheet(), ext = S.book.recount(S.sid);
      printEl?.remove();
      const covered = new Set();
      const table = h('table');
      for (let r = 0; r <= ext.r && r < 5000; r++) {
        if (hidden.has(r)) continue;
        const tr = h('tr');
        for (let c = 0; c <= ext.c && c < 200; c++) {
          if (covered.has(LK(r, c))) continue;
          const m = mergeAt(r, c);
          const look = cellLook(r, c);
          const td = h('td', { class: look.cls.replace(/\b(ss-c|is-hit|is-now|has-dd|has-flt|is-flt)\b/g, '').trim() || null, text: look.text });
          if (m && m.r1 === r && m.c1 === c) {
            for (let i = m.r1; i <= m.r2; i++) for (let j = m.c1; j <= m.c2; j++) covered.add(LK(i, j));
            const rs = [...Array(m.r2 - m.r1 + 1).keys()].filter(i => !hidden.has(m.r1 + i)).length;
            if (rs > 1) td.rowSpan = rs;
            if (m.c2 > m.c1) td.colSpan = m.c2 - m.c1 + 1;
          }
          tr.append(td);
        }
        table.append(tr);
      }
      const name = S.doc.path ? vfs.baseName(S.doc.path) : 'Untitled sheet';
      printEl = h('div.ss-print', { 'aria-hidden': 'true' },
        h('h1', { text: S.book.sheets.length > 1 ? `${name} — ${sh.name}` : name }),
        h('p', { text: `Printed ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${hidden.size ? ` · ${hidden.size} row${hidden.size === 1 ? '' : 's'} hidden by a filter left out` : ''}` }),
        ext.r < 0 ? h('p', { text: 'This sheet is empty.' }) : table);
      document.body.appendChild(printEl);
      document.documentElement.classList.add('ss-printing');
      const done = () => { document.documentElement.classList.remove('ss-printing'); printEl?.remove(); printEl = null; window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      setTimeout(done, 120000);
      try { window.print(); } catch (e) { done(); }
    }

    /* ================= tab colours, duplicate a sheet ================= */
    function setTabColor(sid, n) {
      if (applyChanges([], 'Tab colour', { sid, meta: m => { if (n) m.tab = n; else delete m.tab; } })) {
        if (sid !== S.sid) renderTabs();
        say(n ? `${S.book.sheet(sid).name}: ${TAB_COLORS.find(t => t[0] === n)[1].toLowerCase()} tab` : 'Tab colour removed');
      }
    }
    function duplicateSheet(sid) {
      if (S.edit) commitEdit(0, 0, false);
      const src = S.book.sheet(sid);
      if (!src) return;
      let name;
      for (let i = 2; ; i++) { name = `${src.name.slice(0, 54)} (${i})`; if (!S.book.sheetNamed(name)) break; }
      const sh = S.book.addSheet(name);
      /* right after the one it copies */
      S.book.sheets.splice(S.book.sheets.indexOf(sh), 1);
      S.book.sheets.splice(S.book.sheets.indexOf(src) + 1, 0, sh);
      for (const x of src.cells.values()) {
        if (x.s) S.book.setStyle(sh.id, x.r, x.c, { ...x.s });
        if (x.raw !== '') S.book.set(sh.id, x.r, x.c, x.raw);
      }
      for (const [c, w] of src.colW) sh.colW.set(c, w);
      sh.meta = cleanMeta(JSON.parse(JSON.stringify(src.meta || {})));
      for (const ch of S.charts.filter(c => c.sid === sid)) S.charts.push({ ...ch, id: ++S.chartSeq, sid: sh.id, g: { ...ch.g } });
      S.book.relinkAll();
      switchSheet(sh.id);
      markDirty();
      say(`Made ${name}, a copy of ${src.name}`);
      grid.focus({ preventScroll: true });
    }

    /* ================= menus ================= */
    function cellMenu(x, y) {
      api.menu([
        { label: 'Cut', icon: 'copy', hint: `${MODK}X`, onClick: () => writeClip(copySel(true)) },
        { label: 'Copy', icon: 'copy', hint: `${MODK}C`, onClick: () => writeClip(copySel(false)) },
        { label: 'Paste', icon: 'clipboard', hint: `${MODK}V`, onClick: menuPaste },
        '-',
        { label: 'Fill down', icon: 'arrow-down', hint: `${MODK}D`, onClick: () => fill('down') },
        { label: 'Fill right', icon: 'arrow-right', hint: `${MODK}R`, onClick: () => fill('right') },
        { label: 'Clear contents', icon: 'x', hint: 'Del', onClick: clearContents },
        { label: 'Clear formatting', icon: 'type', onClick: clearFormatting },
        '-',
        { label: 'Select row', icon: 'arrow-right', hint: `${SHIFT}Space`, onClick: () => selectRows(S.cur.r, S.cur.r) },
        { label: 'Select column', icon: 'arrow-down', onClick: () => selectCols(S.cur.c, S.cur.c) },
        '-',
        { label: 'Sort and filter', icon: 'filter', items: dataItems() },
        { label: 'Borders and merging', icon: 'grid', items: formatItems() },
        { label: 'Describe my data (AI)', icon: 'sparkles', onClick: () => describeData() },
        '-',
        { label: 'Chart from selection', icon: 'bar-chart', items: Chart.TYPES.map(t => ({ label: `${Chart.TYPE_NAMES[t]} chart`, icon: Chart.TYPE_ICONS[t], onClick: () => addChart(t) })) },
        { label: 'Column width', icon: 'sliders', items: [
          { label: 'Wider', onClick: () => colWidths(w => w + 24) },
          { label: 'Narrower', onClick: () => colWidths(w => w - 24) },
          { label: 'Fit to contents', onClick: () => colWidths((w, c) => fitWidth(c)) },
          { label: 'Reset', onClick: () => colWidths(() => COL_W) },
        ] },
      ], x, y, { label: 'Cell' });
    }
    function menuAtCursor() {
      const r = (activeCel || grid).getBoundingClientRect();
      cellMenu(r.left + 8, r.bottom);
    }
    function colWidths(fn) {
      const g = opRect(), cols = [];
      for (let c = g.c1; c <= g.c2 && c < nCols; c++) cols.push({ c, w: clamp(Math.round(fn(width(c), c)), MIN_W, MAX_W) });
      if (applyChanges([], 'Column width', { cols })) say('Column width changed');
    }
    function fileMenu(anchor) {
      const r = anchor.getBoundingClientRect();
      api.menu([
        { label: 'New sheet', icon: 'plus', onClick: () => api.openApp('sheets', {}) },
        { label: 'Open from Files…', icon: 'folder-open', onClick: () => api.openApp('files', { path: `${vfs.HOME}/Documents` }) },
        { label: 'Import CSV from this computer…', icon: 'upload', onClick: () => picker.click() },
        '-',
        { label: 'Save', icon: 'save', hint: `${MODK}S`, onClick: () => saveCmd() },
        { label: 'Save as…', icon: 'edit-3', onClick: () => saveAs() },
        '-',
        { label: 'Export CSV to Documents', icon: 'file-text', onClick: () => exportCsv() },
        { label: 'Download CSV', icon: 'download', onClick: () => downloadCsv() },
        { label: 'Print or save as PDF…', icon: 'printer', onClick: () => printSheet() },
        S.doc.path && '-',
        S.doc.path && { label: 'Show in Files', icon: 'folder', onClick: () => api.openApp('files', { path: vfs.parentPath(S.doc.path) }) },
      ].filter(Boolean), r.left, r.bottom + 4, { label: 'File' });
    }

    /* ================= files ================= */
    let tSave = 0, tRec = 0;
    function setDoc(path, kind, extra = {}) {
      if (S.doc.path && openDocs.get(S.doc.path) === win) openDocs.delete(S.doc.path);
      S.doc = { path, kind, readOnly: false, gone: false, written: null, delim: ',', auto: false, ...extra };
      if (path) openDocs.set(path, win);
      win.setTitle(path ? vfs.baseName(path) : 'Untitled sheet');
      win.setSubtitle(S.doc.readOnly ? '— read-only' : '');
      if (S.book) gridLabel();
    }
    function chartsOf(data, book) {
      return (Array.isArray(data.charts) ? data.charts : []).map(c => {
        const sh = c && book.sheetNamed(String(c.sheet || ''));
        const g = c && E.parseRangeName(c.range);
        const txt = v => (typeof v === 'string' ? v.slice(0, 80) : '');
        return sh && g && Chart.TYPES.includes(c.type) ? { id: ++S.chartSeq, sid: sh.id, g, type: c.type, title: String(c.title || ''), xLabel: txt(c.xLabel), yLabel: txt(c.yLabel), trend: c.trend !== false } : null;
      }).filter(Boolean);
    }
    function blankBook() { const b = new E.Book(); b.addSheet('Sheet1'); return b; }
    /** file text → { book, charts, active, delim } */
    function bookFromText(text, name) {
      if (extOf(name) === 'sheet') {
        if (!String(text).trim()) return { book: blankBook(), charts: [] };
        const data = JSON.parse(text);
        const book = E.Book.fromJSON(data);
        return { book, charts: chartsOf(data, book), active: data.active };
      }
      const delim = CSV.sniff(text, name);
      const rows = CSV.parse(text, delim);
      const book = new E.Book();
      const sh = book.addSheet(sheetNameFor(stemOf(name)));
      for (let r = 0; r < rows.length && r < E.MAX_ROWS; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length && c < E.MAX_COLS; c++) if (row[c] !== '') book.set(sh.id, r, c, row[c]);
      }
      book.recalcAll();
      fitColumns(book, sh);
      return { book, charts: [], delim };
    }
    function loadBook(book, charts = [], activeName = null) {
      for (const sh of book.sheets) sh.meta = cleanMeta(sh.meta);
      S.book = book;
      S.sid = ((activeName && book.sheetNamed(activeName)) || book.sheets[0]).id;
      S.charts = charts;
      S.showCharts = charts.some(c => c.sid === S.sid);
      S.views.clear(); S.undo = []; S.redo = []; S.clip = null;
      S.cur = { r: 0, c: 0 }; S.anchor = { r: 0, c: 0 }; S.focus = { r: 0, c: 0 };
      theme = null;
      resetRows();
      FR = -1;
      metaChanged();
      grid.scrollTop = 0; grid.scrollLeft = 0;
      paint(true);
      renderTabs(); renderCharts(); syncBars(); gridLabel();
    }
    /** Open a file from the file system (Files, Spotlight, a desktop icon). */
    async function openPath(path) {
      const n = vfs.node(path);
      if (!n || n.type !== 'file') {
        api.notify({ app: 'Static Sheets', icon: 'alert', title: 'That file isn’t there any more', message: path });
        setDoc(null, null);
        return;
      }
      const name = vfs.baseName(path);
      let text = n.content || '', readOnly = false, why = '';
      if (media.isMedia(n)) {
        /* too big for the text store: kept as a blob — open it, but don't write over it */
        const blob = await media.blobOf(n).catch(() => null);
        if (S.dead) return;
        text = blob ? await blob.text() : '';
        readOnly = true;
        why = `${name} is kept as a large file in this browser, so it opens read-only. Save as a new file or download a CSV to keep changes.`;
      }
      let res;
      try { res = bookFromText(text, name); }
      catch (err) {
        res = { book: blankBook(), charts: [] };
        readOnly = true;
        why = `${name} couldn’t be read: ${(err && err.message) || err}. Nothing will be written to it.`;
      }
      if (S.dead) return;
      setDoc(path, extOf(name) === 'sheet' ? 'sheet' : 'csv', { readOnly, delim: res.delim || ',', written: text });
      loadBook(res.book, res.charts, res.active);
      S.dirty = false;
      hideBanner();
      if (why) showBanner(why);
      else if (S.doc.kind === 'csv') offerRecovery(path, n.mtime);
      paintStatus();
    }
    function offerRecovery(path, mtime) {
      misc.get(RKEY(path)).then(rec => {
        if (S.dead || !rec || S.doc.path !== path || S.dirty) return;
        if (!(rec.at > Date.parse(mtime || 0))) { misc.del(RKEY(path)).catch(() => {}); return; }
        showBanner(`There are unsaved changes to ${vfs.baseName(path)} from ${api.fmt.fmtAgo(new Date(rec.at).toISOString())}.`, [
          ['Restore', () => {
            try {
              const data = JSON.parse(rec.json), book = E.Book.fromJSON(data);
              loadBook(book, chartsOf(data, book), data.active);
              hideBanner();
              markDirty();
              say('Unsaved changes restored');
            } catch (err) { showBanner('Those changes couldn’t be read back.'); }
          }],
          ['Discard', () => { misc.del(RKEY(path)).catch(() => {}); hideBanner(); say('Discarded'); }],
        ]);
      }).catch(() => {});
    }
    function showBanner(text, actions = []) {
      api.render(banner, icon('info'), h('span.grow', { text }),
        ...actions.map(([label, fn]) => h('button.btn.btn--sm', { type: 'button', text: label, onclick: fn })));
      banner.hidden = false;
    }
    function hideBanner() { banner.hidden = true; api.clear(banner); }

    const bookJSON = () => S.book.toJSON({
      active: sheet().name,
      charts: S.charts.filter(c => S.book.sheet(c.sid)).map(c => ({ sheet: S.book.sheet(c.sid).name, range: E.rangeName(c.g), type: c.type, title: c.title,
        ...(c.xLabel ? { xLabel: c.xLabel } : {}), ...(c.yLabel ? { yLabel: c.yLabel } : {}), ...(c.trend === false ? { trend: false } : {}) })),
    });
    /** plain values on one sheet: a CSV can hold all of it */
    function csvSafe() {
      if (S.book.sheets.length !== 1 || S.charts.length) return false;
      if (Object.keys(S.book.sheets[0].meta || {}).length) return false;      /* filters, freeze, merges, rules */
      for (const x of S.book.sheets[0].cells.values()) if (x.f || x.s) return false;
      return true;
    }
    /** what a cell writes into CSV: formulas as their shown results, typed
        values exactly as typed (so an untouched file saves byte for byte) */
    function csvField(x) {
      if (!x || x.raw === '') return '';
      if (x.f || (x.s && x.s.nf && typeof x.v === 'number')) return E.formatValue(x.v, fmtOf(x));
      return x.raw[0] === "'" ? x.raw.slice(1) : x.raw;
    }
    function csvText(sid = S.sid, delim = ',') {
      const sh = S.book.sheet(sid), ext = S.book.recount(sid), rows = [];
      for (let r = 0; r <= ext.r; r++) {
        const row = [];
        for (let c = 0; c <= ext.c; c++) row.push(csvField(sh.cells.get(LK(r, c))));
        rows.push(row);
      }
      return CSV.write(rows, delim);
    }
    /** will the file system (localStorage, ~2.5 MB for every file) take this? */
    function fits(path, text) {
      let cur = 0;
      try { cur = (profiles.local.getItem(VFS_KEY) || '').length; } catch (e) { cur = 0; }
      const old = vfs.read(path);
      return cur + JSON.stringify(text).length - (old == null ? 0 : JSON.stringify(old).length) < VFS_ROOM;
    }
    function saveNow() {
      clearTimeout(tSave); tSave = 0;
      const d = S.doc;
      if (!d.path || d.readOnly || d.gone) return false;
      const text = d.kind === 'csv' ? csvText(S.sid, d.delim) : JSON.stringify(bookJSON());
      if (!fits(d.path, text)) {
        S.problem = 'Too big to save in this browser’s file storage — Download CSV keeps a copy';
        if (!S.warnedBig) {
          S.warnedBig = true;
          api.notify({ app: 'Static Sheets', icon: 'alert', title: 'This sheet is too big to save here', message: 'StaticOS keeps files in this browser’s storage, which holds a few MB in all. Download it as CSV to keep a copy.', actions: [{ label: 'Download CSV', onClick: () => downloadCsv() }], timeout: 15000 });
        }
        paintStatus();
        return false;
      }
      S.problem = '';
      d.written = text;
      const n = vfs.node(d.path);
      if (!n || n.content !== text) {
        vfs.write(d.path, text);
        api.bus.emit('file:saved', { path: d.path, app: 'sheets' });
      }
      S.dirty = false;
      if (d.kind === 'csv') misc.del(RKEY(d.path)).catch(() => {});
      paintStatus();
      return true;
    }
    function saveRecovery() {
      clearTimeout(tRec); tRec = 0;
      if (!S.doc.path || !S.dirty) return;
      misc.set(RKEY(S.doc.path), { at: Date.now(), json: JSON.stringify(bookJSON()) }).catch(() => {});
    }
    /** an untitled workbook becomes a real file the first time it changes */
    function createUntitled() {
      const dir = `${vfs.HOME}/Documents`;
      if (!vfs.node(dir)) vfs.mkdir(dir);
      let name = 'Untitled sheet.sheet';
      for (let i = 2; vfs.node(`${dir}/${name}`); i++) name = `Untitled sheet ${i}.sheet`;
      setDoc(`${dir}/${name}`, 'sheet', { auto: true });
    }
    function markDirty() {
      S.dirty = true;
      const d = S.doc;
      if (!d.readOnly && !d.gone && !S.dead) {
        if (!d.path) createUntitled();
        clearTimeout(tSave); clearTimeout(tRec); tSave = 0; tRec = 0;
        if (S.doc.kind === 'sheet' || csvSafe()) tSave = setTimeout(saveNow, 500);
        else tRec = setTimeout(saveRecovery, 800);
      }
      paintStatus();
    }
    function saveCmd() {
      if (S.edit) commitEdit(0, 0, false);
      const d = S.doc;
      if (d.readOnly || d.gone) { saveAs('sheet'); return; }
      if (!d.path) createUntitled();
      const lossy = S.doc.kind === 'csv' && !csvSafe();
      if (!saveNow()) return;
      if (lossy) {
        api.notify({
          app: 'Static Sheets', icon: 'alert', title: `Saved ${vfs.baseName(S.doc.path)} with values only`, timeout: 12000,
          message: 'A CSV file holds values only: formulas were saved as their results, and formatting, other sheets and charts were left out. Save a .sheet copy to keep all of it.',
          actions: [{ label: 'Save as .sheet', onClick: () => saveAs('sheet') }],
        });
      }
      say(`Saved ${vfs.baseName(S.doc.path)}`);
    }
    /** Save as… — a name, a folder and a format, in a small sheet over the window */
    function saveAs(kind) {
      if (S.edit) commitEdit(0, 0, false);
      if (app.querySelector('.ss-dlg')) return;
      const k0 = kind || (S.doc.kind === 'csv' && csvSafe() ? 'csv' : 'sheet');
      const folders = [['Documents', `${vfs.HOME}/Documents`], ['Desktop', `${vfs.HOME}/Desktop`], ['Downloads', `${vfs.HOME}/Downloads`]];
      const here = S.doc.path ? vfs.parentPath(S.doc.path) : null;
      if (here && !folders.some(f => f[1] === here)) folders.unshift([here.replace(vfs.HOME, '~'), here]);
      const nameIn = h('input', { spellcheck: 'false', autocomplete: 'off' });
      nameIn.value = S.doc.path && !S.doc.auto ? stemOf(vfs.baseName(S.doc.path)) : 'Untitled sheet';
      const dirSel = h('select', {}, folders.map(([l, p]) => h('option', { value: p, text: l })));
      dirSel.value = here && folders.some(f => f[1] === here) ? here : folders[0][1];
      const fmtSel = h('select', {}, h('option', { value: 'sheet', text: 'Static Sheets (.sheet) — keeps everything' }), h('option', { value: 'csv', text: 'CSV (.csv) — this sheet’s values' }));
      fmtSel.value = k0;
      const why = h('div.ss-dlg__why', { role: 'alert' });
      const close = () => { dlg.remove(); grid.focus({ preventScroll: true }); };
      const card = h('form.ss-dlg__card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Save as' },
        h('h2', { text: 'Save as' }),
        h('label', 'Name', nameIn), h('label', 'Folder', dirSel), h('label', 'Format', fmtSel), why,
        h('div.ss-dlg__btns',
          h('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: close }),
          h('button.btn.btn--primary', { type: 'submit', text: 'Save' })));
      const dlg = h('div.ss-dlg', { onpointerdown: e => { if (e.target === dlg) close(); } }, card);
      card.addEventListener('submit', e => {
        e.preventDefault();
        const err = doSaveAs(nameIn.value, dirSel.value, fmtSel.value);
        if (err) why.textContent = err; else close();
      });
      card.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        if (e.key === 'Tab') {                                  /* keep Tab inside the sheet */
          const f = [...card.querySelectorAll('input, select, button')];
          const i = f.indexOf(document.activeElement);
          if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      });
      app.appendChild(dlg);
      nameIn.focus(); nameIn.select();
    }
    function doSaveAs(name, dir, kind) {
      const base = safeName(String(name || '').replace(/\.(sheet|csv|tsv)$/i, ''));
      if (!base) return 'Give it a name.';
      if (!vfs.node(dir) && !vfs.mkdir(dir)) return 'That folder can’t be made.';
      const path = vfs.norm(`${dir}/${base}.${kind}`);
      const prev = { ...S.doc };
      if (path !== prev.path && vfs.node(path)) return `There’s already a file called “${base}.${kind}” there.`;
      if (openDocs.has(path) && openDocs.get(path) !== win) return 'That file is open in another window.';
      setDoc(path, kind, { delim: ',' });
      const lossy = kind === 'csv' && !csvSafe();
      if (!saveNow()) { setDoc(prev.path, prev.kind, prev); return S.problem || 'It couldn’t be saved.'; }
      if (prev.auto && prev.path && prev.path !== path && vfs.node(prev.path)) vfs.rm(prev.path, { permanent: true });
      if (prev.kind === 'csv' && prev.path && prev.path !== path) misc.del(RKEY(prev.path)).catch(() => {});
      hideBanner();
      if (lossy) api.notify({ app: 'Static Sheets', icon: 'alert', title: `${base}.csv holds values only`, message: 'Formulas were saved as their results; formatting, other sheets and charts were left out.', timeout: 9000 });
      say(`Saved as ${base}.${kind}`);
      return null;
    }
    const exportStem = () => {
      const stem = S.doc.path && !S.doc.auto ? stemOf(vfs.baseName(S.doc.path)) : 'Untitled sheet';
      return safeName(S.book.sheets.length > 1 ? `${stem} - ${sheet().name}` : stem) || 'Sheet';
    };
    /** Export CSV: this sheet's values as a new .csv beside the workbook */
    function exportCsv() {
      if (S.edit) commitEdit(0, 0, false);
      const dir = S.doc.path ? vfs.parentPath(S.doc.path) : `${vfs.HOME}/Documents`;
      if (!vfs.node(dir)) vfs.mkdir(dir);
      const stem = exportStem();
      let name = `${stem}.csv`;
      for (let i = 2; vfs.node(`${dir}/${name}`); i++) name = `${stem} ${i}.csv`;
      const path = `${dir}/${name}`;
      const text = csvText(S.sid, ',');
      if (!fits(path, text)) {
        api.notify({ app: 'Static Sheets', icon: 'alert', title: 'Too big for the file storage here', message: 'Download the CSV instead.', actions: [{ label: 'Download CSV', onClick: () => downloadText(text, name) }] });
        return null;
      }
      vfs.write(path, text);
      api.bus.emit('file:saved', { path, app: 'sheets' });
      api.notify({
        app: 'Static Sheets', icon: 'file-text', title: 'CSV exported', message: `${name} — the values of ${sheet().name}`, timeout: 8000,
        actions: [{ label: 'Show in Files', onClick: () => api.openApp('files', { path: dir }) }, { label: 'Download', onClick: () => downloadText(text, name) }],
      });
      say(`Exported ${name}`);
      return path;
    }
    function downloadText(text, name) {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = h('a', { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    function downloadCsv() { if (S.edit) commitEdit(0, 0, false); downloadText(csvText(S.sid, ','), `${exportStem()}.csv`); }
    picker.addEventListener('change', async () => {
      const f = picker.files && picker.files[0];
      picker.value = '';
      if (!f) return;
      try {
        const [r] = await fileimport.importFiles(`${vfs.HOME}/Documents`, [f]);
        if (!r || !r.ok) { api.notify({ app: 'Static Sheets', icon: 'alert', title: `Couldn’t import ${f.name}`, message: (r && r.why) || 'It wasn’t saved.' }); return; }
        const empty = !S.doc.path && !S.dirty && S.book.sheets.every(sh => !sh.cells.size);
        if (empty) openPath(r.path); else api.openFile(r.path, 'sheets');
      } catch (err) { api.notify({ app: 'Static Sheets', icon: 'alert', title: `Couldn’t import ${f.name}`, message: (err && err.message) || String(err) }); }
    });
    /* the file changed or went away underneath us */
    const offFs = api.bus.on('fs:change', (dir, p) => {
      const d = S.doc;
      if (S.dead || !d.path || (p && p !== d.path && dir !== vfs.parentPath(d.path))) return;
      const n = vfs.node(d.path);
      if (!n) { if (!d.gone) { d.gone = true; clearTimeout(tSave); tSave = 0; paintStatus(); } return; }
      if (d.gone) { d.gone = false; paintStatus(); }
      if (n.content !== d.written && !S.dirty && !S.edit && !d.readOnly && !media.isMedia(n)) {
        const keep = snapSel(), top = grid.scrollTop, left = grid.scrollLeft;
        openPath(d.path);
        S.cur = keep.cur; S.anchor = keep.anchor; S.focus = keep.focus;
        grid.scrollTop = top; grid.scrollLeft = left;
        paint(true); syncBars();
      }
    });

    /* ================= status + toolbar state ================= */
    function paintStatus() {
      if (S.dead || !S.book) return;
      const parts = [];
      const g = opRect();
      if (g.r1 !== g.r2 || g.c1 !== g.c2) {
        let sum = 0, nums = 0, count = 0;
        eachExisting(g, x => { if (x.raw === '') return; count++; if (typeof x.v === 'number') { sum += x.v; nums++; } });
        if (nums) parts.push(h('span', 'Sum ', h('b', { text: E.general(sum) })), h('span', 'Average ', h('b', { text: E.general(sum / nums) })));
        parts.push(h('span', 'Count ', h('b', { text: String(count) })));
      } else {
        const x = S.book.cell(S.sid, S.cur.r, S.cur.c);
        if (x && x.v instanceof E.CellError) parts.push(h('span.ss-status__err', { text: `${x.v.code} ${x.v.why}` }));
      }
      if (hidden.size) { const f = filterSpan(); if (f) parts.push(h('span.ss-status__flt', icon('filter'), ' Showing ', h('b', { text: String(visibleCount()) }), ` of ${f.r2 - f.r1} rows`)); }
      const d = S.doc;
      let ic, text;
      if (S.problem) { ic = 'alert'; text = S.problem; }
      else if (d.readOnly) { ic = 'lock'; text = 'Read-only'; }
      else if (d.gone) { ic = 'alert'; text = 'The file was moved or deleted — Save as keeps this'; }
      else if (!d.path) { ic = 'edit-3'; text = 'Saves to Documents as soon as you type'; }
      else if (S.dirty && tSave) { ic = 'refresh'; text = 'Saving…'; }
      else if (S.dirty) { ic = 'alert'; text = d.kind === 'csv' ? `Not saved — a CSV holds values only (${MODK}S saves them)` : 'Unsaved changes'; }
      else { ic = 'check'; text = `Saved to ${d.path.replace(vfs.HOME, '~')}`; }
      const tip = S.dirty && d.kind === 'csv' && !tSave ? 'This workbook has formulas, formatting, charts or more sheets, which a CSV file can’t hold. Save as… keeps everything in a .sheet file; your edits are kept aside meanwhile.' : d.path || '';
      parts.push(h('span.row.ss-status__file', { title: tip }, icon(ic), h('span.trunc', { text })));
      api.render(status, ...parts);
    }
    function syncBars() {
      if (S.dead || !S.book) return;
      if (document.activeElement !== nameBox) nameBox.value = selName();
      if (!S.edit && document.activeElement !== fx) fx.value = rawAt(S.cur.r, S.cur.c);
      const x = S.book.cell(S.sid, S.cur.r, S.cur.c), s = (x && x.s) || {};
      bBold.setAttribute('aria-pressed', String(!!s.b));
      bItal.setAttribute('aria-pressed', String(!!s.i));
      bWrap.setAttribute('aria-pressed', String(!!s.wr));
      for (const [k, b] of Object.entries(bAl)) b.setAttribute('aria-pressed', String(s.al === k));
      const f = fmtOf(x);
      selFmt.value = f && NF.some(n => n[0] === f.nf) ? f.nf : f && f.nf === 'datetime' ? 'date' : 'general';
      bUndo.disabled = !S.undo.length;
      bRedo.disabled = !S.redo.length;
      paintStatus();
    }

    /* ================= wiring ================= */
    let rafScroll = 0;
    grid.addEventListener('scroll', () => {
      if (rafScroll) return;
      rafScroll = requestAnimationFrame(() => { rafScroll = 0; paint(); placeEditor(); });
    }, { passive: true });
    grid.addEventListener('focus', () => { paintSel(); });
    const ro = new ResizeObserver(() => { if (S.dead) return; paint(); placeEditor(); drawCharts(); });
    ro.observe(grid);
    ro.observe(panel);
    /* theme, accent or contrast changed: the charts' colours come from tokens */
    let rafTheme = 0;
    const mo = new MutationObserver(() => {
      if (rafTheme) return;
      rafTheme = requestAnimationFrame(() => { rafTheme = 0; theme = null; drawCharts(); });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'data-contrast'] });

    /* for tests and the console: the live book and how long painting takes */
    app.sheetsDebug = {
      get book() { return S.book; }, get state() { return S; }, stats, get rowsInDom() { return rowsOn.size; },
      openPath, exportChart, exportCsv,
      get hidden() { return [...hidden]; }, get frozen() { return { r: FR, c: FC }; }, rowTop: r => rowTop(r), rowH: r => rowH(r),
    };

    /* ================= start ================= */
    S.book = blankBook();
    S.sid = S.book.sheets[0].id;
    setDoc(null, null);
    paint(true);
    renderTabs(); renderCharts(); syncBars();
    if (opts && opts.path) openPath(vfs.norm(opts.path));
    requestAnimationFrame(() => { if (!S.dead && !app.querySelector('.ss-dlg')) grid.focus({ preventScroll: true }); });

    win.state.save = saveCmd;              /* File › Save in the menu bar */
    win.state.print = printSheet;          /* File › Print */

    return () => {
      if (S.edit) commitEdit(0, 0, false);
      if (tSave) saveNow();
      if (tRec) saveRecovery();
      S.dead = true;
      AI.ctl?.abort();
      if (printEl) { printEl.remove(); document.documentElement.classList.remove('ss-printing'); }
      clearTimeout(tSave); clearTimeout(tRec); clearTimeout(sayT);
      cancelAnimationFrame(rafScroll); cancelAnimationFrame(rafTheme);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
      ro.disconnect(); mo.disconnect(); offRove(); offFs();
      if (S.doc.path && openDocs.get(S.doc.path) === win) openDocs.delete(S.doc.path);
    };
  },
});
