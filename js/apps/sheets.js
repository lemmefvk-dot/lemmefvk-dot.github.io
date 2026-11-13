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
  return Object.keys(o).length ? o : null;
}
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
  keywords: ['spreadsheet', 'sheet', 'sheets', 'excel', 'csv', 'tsv', 'table', 'formula', 'chart', 'budget', 'numbers', 'cells'],
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
    const bar = h('div.app__bar.ss-bar', { role: 'toolbar', 'aria-label': 'Sheet tools' },
      bUndo, bRedo, sep(), bBold, bItal, sep(), bAl.left, bAl.center, bAl.right, sep(), selFmt, bLess, bMore, sep(),
      bFillD, bFillR, sep(),
      tb('bar-chart', 'Bar chart from selection', () => addChart('bar')),
      tb('line-chart', 'Line chart from selection', () => addChart('line')),
      tb('pie-chart', 'Pie chart from selection', () => addChart('pie')),
      h('div.ss-grow'),
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

    win.setTools(
      h('button.ibtn.tip', { type: 'button', 'data-tip': `Save  ${MODK}S`, 'aria-label': 'Save', onclick: () => saveCmd() }, icon('save')),
      h('button.ibtn.tip', { type: 'button', 'data-tip': 'File', 'aria-label': 'File menu', 'aria-haspopup': 'menu', onclick: e => fileMenu(e.currentTarget) }, icon('more-horizontal')),
    );

    /* ================= geometry ================= */
    let nRows = MIN_ROWS, nCols = 0, colX = new Float64Array(1), colsDirty = true, totalW = 0, lastW = -1, lastH = -1, lastRC = '';
    const sheet = () => S.book.sheet(S.sid);
    const width = c => sheet().colW.get(c) || COL_W;
    function layout() {
      const ext = S.book.extentOf(S.sid);
      const fr = Number.isFinite(S.focus.r) ? S.focus.r : 0, fc = Number.isFinite(S.focus.c) ? S.focus.c : 0;
      const rows = Math.min(E.MAX_ROWS, Math.max(MIN_ROWS, ext.r + 101, S.cur.r + 51, fr + 51));
      const cols = Math.min(E.MAX_COLS, Math.max(MIN_COLS, ext.c + 6, S.cur.c + 6, fc + 6));
      if (cols !== nCols || colsDirty) {
        nCols = cols;
        colX = new Float64Array(cols + 1);
        for (let c = 0; c < cols; c++) colX[c + 1] = colX[c] + width(c);
        colsDirty = false;
      }
      nRows = rows;
      totalW = HEAD_W + colX[nCols];
      if (totalW !== lastW) { head.style.width = `${totalW}px`; body.style.width = `${totalW}px`; lastW = totalW; }
      const hh = nRows * ROW_H;
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

    /* ================= painting ================= */
    const rowsOn = new Map(), spare = [], headCells = [];
    let win0 = { r0: -1, r1: -1, c0: -1, c1: -1 };
    let activeCel = null;
    const stats = { paints: 0, ms: 0, worst: 0 };
    function paint(force = false) {
      if (S.dead || !S.book) return;
      const t0 = performance.now();
      layout();
      const st = grid.scrollTop, sl = grid.scrollLeft;
      const vh = grid.clientHeight || 400, vw = grid.clientWidth || 600;
      const r0 = Math.max(0, Math.floor(st / ROW_H) - OVER_R);
      const r1 = Math.min(nRows - 1, Math.ceil((st + vh - HEAD_H) / ROW_H) + OVER_R);
      const c0 = Math.max(0, colAt(sl) - 1);
      const c1 = Math.min(nCols - 1, colAt(sl + vw - HEAD_W) + 1);
      const colsChanged = force || c0 !== win0.c0 || c1 !== win0.c1;
      if (colsChanged || r0 !== win0.r0 || r1 !== win0.r1) {
        for (const [r, el] of rowsOn) if (r < r0 || r > r1) { rowsOn.delete(r); spare.push(el); }
        for (let r = r0; r <= r1; r++) {
          let el = rowsOn.get(r);
          if (!el) {
            el = spare.pop() || makeRow();
            rowsOn.set(r, el);
            if (el.parentNode !== body) body.appendChild(el);
            fillRow(el, r, c0, c1);
          } else if (colsChanged) fillRow(el, r, c0, c1);
        }
        for (const el of spare) if (el.parentNode) el.remove();
        if (colsChanged) fillHead(c0, c1);
        win0 = { r0, r1, c0, c1 };
      }
      paintSel();
      const ms = performance.now() - t0;
      stats.paints++; stats.ms = ms;
      if (ms > stats.worst) stats.worst = ms;
    }
    function makeRow() {
      const rh = h('div.ss-rh', { role: 'rowheader', 'aria-colindex': '1' });
      const el = h('div.ss-row', { role: 'row' }, rh);
      el._rh = rh; el._cells = []; el._r = -1; el._w = -1;
      return el;
    }
    function fillRow(el, r, c0, c1) {
      if (el._r !== r) {
        el._r = r;
        el.style.top = `${r * ROW_H}px`;
        el.setAttribute('aria-rowindex', String(r + 2));
        el._rh.textContent = String(r + 1);
      }
      if (el._w !== totalW) { el._w = totalW; el.style.width = `${totalW}px`; }
      const need = c1 - c0 + 1, cells = el._cells;
      while (cells.length < need) { const x = h('div.ss-c', { role: 'gridcell' }); x._c = -1; cells.push(x); el.appendChild(x); }
      while (cells.length > need) cells.pop().remove();
      for (let i = 0; i < need; i++) fillCell(cells[i], r, c0 + i);
    }
    function fillCell(x, r, c) {
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
        if (s) { if (s.b) cls += ' is-b'; if (s.i) cls += ' is-i'; if (s.al) cls += ` al-${s.al[0]}`; }
      }
      if (S.find.set && S.find.set.has(LK(r, c))) cls += S.find.now === LK(r, c) ? ' is-hit is-now' : ' is-hit';
      if (x._c !== c) { x._c = c; x.setAttribute('aria-colindex', String(c + 2)); }
      const left = HEAD_W + colX[c], w = colX[c + 1] - colX[c];
      if (x._x !== left) { x._x = left; x.style.left = `${left}px`; }
      if (x._wd !== w) { x._wd = w; x.style.width = `${w}px`; }
      if (x._t !== text) { x._t = text; x.textContent = text; }
      if (x._k !== cls) { x._k = cls; x.className = cls; }
    }
    function fillHead(c0, c1) {
      const need = c1 - c0 + 1;
      while (headCells.length < need) {
        const x = h('div.ss-ch', { role: 'columnheader' }, h('span'), h('div.ss-grip', { 'aria-hidden': 'true' }));
        x._lab = x.firstChild; x._c = -1;
        headCells.push(x); head.appendChild(x);
      }
      while (headCells.length > need) headCells.pop().remove();
      for (let i = 0; i < need; i++) {
        const x = headCells[i], c = c0 + i;
        if (x._c !== c) { x._c = c; x._lab.textContent = E.colName(c); x.setAttribute('aria-colindex', String(c + 2)); x.dataset.c = String(c); }
        const left = HEAD_W + colX[c], w = colX[c + 1] - colX[c];
        if (x._x !== left) { x._x = left; x.style.left = `${left}px`; }
        if (x._wd !== w) { x._wd = w; x.style.width = `${w}px`; }
      }
    }
    function box(el, g) {
      if (!g || g.r1 > nRows - 1 || g.c1 > nCols - 1) { if (el._on) { el.style.display = 'none'; el._on = false; } return; }
      const r2 = Math.min(g.r2, nRows - 1), c2 = Math.min(g.c2, nCols - 1);
      const x = HEAD_W + colX[g.c1], y = g.r1 * ROW_H, w = colX[c2 + 1] - colX[g.c1], hh = (r2 - g.r1 + 1) * ROW_H;
      el.style.cssText = `display:block;left:${x - 1}px;top:${y - 1}px;width:${w + 1}px;height:${hh + 1}px`;
      el._on = true;
    }
    function paintSel() {
      const g = selRect();
      const multi = g.r1 !== g.r2 || g.c1 !== g.c2;
      box(selBox, multi ? g : null);
      box(curBox, { r1: S.cur.r, c1: S.cur.c, r2: S.cur.r, c2: S.cur.c });
      box(clipBox, S.clip && S.clip.sid === S.sid ? S.clip.g : null);
      box(ptBox, S.edit && S.edit.point && S.edit.point.g ? S.edit.point.g : null);
      for (const [r, el] of rowsOn) {
        const rs = r >= g.r1 && r <= g.r2;
        if (el._rs !== rs) { el._rs = rs; el._rh.classList.toggle('is-sel', rs); }
        for (const x of el._cells) {
          const s = rs && x._c >= g.c1 && x._c <= g.c2;
          if (x._s !== s) { x._s = s; x.setAttribute('aria-selected', String(s)); }
        }
      }
      for (const x of headCells) { const s = x._c >= g.c1 && x._c <= g.c2; if (x._s !== s) { x._s = s; x.classList.toggle('is-sel', s); } }
      const row = rowsOn.get(S.cur.r);
      const cel = row ? row._cells.find(x => x._c === S.cur.c) : null;
      if (activeCel && activeCel !== cel) { activeCel.removeAttribute('id'); activeCel.removeAttribute('aria-label'); }
      activeCel = cel || null;
      if (cel) {
        cel.id = `${uid}-cur`;
        const raw = rawAt(S.cur.r, S.cur.c);
        const label = `${E.cellName(S.cur.r, S.cur.c)}, ${cel._t || 'blank'}${E.isFormula(raw) ? `, formula ${raw}` : ''}`;
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
      return { r1: Math.min(ar, fr), r2: Math.max(ar, fr), c1: Math.min(ac, fc), c2: Math.max(ac, fc) };
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
    function reveal(r, c) {
      layout();
      const top = r * ROW_H, vh = grid.clientHeight - HEAD_H;
      if (top < grid.scrollTop) grid.scrollTop = top;
      else if (top + ROW_H > grid.scrollTop + vh) grid.scrollTop = top + ROW_H - vh;
      const L = colX[c], R = colX[c + 1], vw = grid.clientWidth - HEAD_W;
      if (L < grid.scrollLeft) grid.scrollLeft = L;
      else if (R > grid.scrollLeft + vw) grid.scrollLeft = Math.min(L, R - vw);
    }
    function select(cur, anchor = cur, focus = cur, { show = true } = {}) {
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
    const topRow = () => Math.floor(grid.scrollTop / ROW_H);
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
        if (e.altKey) return;                       /* ⌃⌥ / ⌘⌥ arrows snap the window */
        e.preventDefault();
        const [dr, dc] = ARROW[k];
        const from = e.shiftKey ? finFocus() : S.cur;
        const to = mod ? edgeFrom(from.r, from.c, dr, dc) : { r: from.r + dr, c: from.c + dc };
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
      editor.style.left = `${HEAD_W + colX[c] - grid.scrollLeft - 1}px`;
      editor.style.top = `${HEAD_H + r * ROW_H - grid.scrollTop - 1}px`;
    }
    function sizeEditor() {
      if (!S.edit) return;
      const { c } = S.edit;
      const lines = editor.value.split('\n');
      const isF = editor.value.startsWith('=');
      const font = isF ? `${Math.round(12 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-k')) || 1))}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}` : gridFont();
      const w = lines.reduce((m, l) => Math.max(m, textW(l, font)), 0) + 18;
      const cw = colX[c + 1] - colX[c] + 2;
      const room = Math.max(cw, wrap.clientWidth - (HEAD_W + colX[c] - grid.scrollLeft) - 6);
      editor.style.width = `${Math.min(Math.max(cw, w), room)}px`;
      editor.style.height = `${Math.max(ROW_H + 2, lines.length * 16 + 10)}px`;
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
      const r = clamp(Math.floor((y - HEAD_H + grid.scrollTop) / ROW_H), 0, nRows - 1);
      const c = clamp(colAt(x - HEAD_W + grid.scrollLeft), 0, nCols - 1);
      const kind = y < HEAD_H ? (x < HEAD_W ? 'all' : 'col') : x < HEAD_W ? 'row' : 'cell';
      return { kind, r, c, outside: x > grid.clientWidth || y > grid.clientHeight };
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
    /** Every edit goes through here: [{ r, c, raw?, s? }] → one undo step. */
    function applyChanges(list, label, { sid = S.sid, cols = null } = {}) {
      const rec = { label, sid, cells: [], cols: [], sel: snapSel() };
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
      if (!rec.cells.length && !rec.cols.length) return false;
      S.undo.push(rec);
      if (S.undo.length > UNDO_MAX) S.undo.shift();
      S.redo.length = 0;
      afterChange(keys);
      return true;
    }
    function afterChange(keys) {
      if (keys.length) S.book.recalc(keys);
      if (S.find.open && findIn.value) runFind();
      paint(true);
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
      S.cur = { ...rec.sel.cur }; S.anchor = { ...rec.sel.anchor }; S.focus = { ...rec.sel.focus };
      afterChange(keys);
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
        for (const x of [...sh.cells.values()]) if (x.r >= g.r1 && x.r <= g.r2 && x.c >= g.c1 && x.c <= g.c2) fn(x);
      } else {
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const x = S.book.cell(S.sid, r, c); if (x) fn(x); }
      }
    }
    function restyle(label, fn) {
      if (S.edit) commitEdit(0, 0, false);
      const g = opRect(), list = [];
      for (let r = g.r1; r <= g.r2; r++) {
        for (let c = g.c1; c <= g.c2; c++) {
          const x = S.book.cell(S.sid, r, c);
          const s = { ...((x && x.s) || {}) };
          fn(s);
          list.push({ r, c, s });
        }
      }
      return applyChanges(list, label);
    }
    const activeStyle = () => { const x = S.book.cell(S.sid, S.cur.r, S.cur.c); return (x && x.s) || {}; };
    function toggleStyle(k) {
      const on = !activeStyle()[k];
      const name = k === 'b' ? 'Bold' : 'Italic';
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
          for (let r = from; r <= g.r2; r++) list.push({ r, c, raw: x ? E.shiftFormula(x.raw, r - src, 0) : '', s: x && x.s ? { ...x.s } : null });
        }
      } else {
        const src = g.c1 === g.c2 ? g.c1 - 1 : g.c1, from = g.c1 === g.c2 ? g.c1 : g.c1 + 1;
        if (src < 0) return;
        for (let r = g.r1; r <= g.r2; r++) {
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
      const g = opRect(), rows = [], cells = [];
      for (let r = g.r1; r <= g.r2; r++) {
        const row = [], cr = [];
        for (let c = g.c1; c <= g.c2; c++) {
          const x = S.book.cell(S.sid, r, c);
          row.push(x && x.raw !== '' ? E.formatValue(x.v, fmtOf(x)) : '');
          cr.push(x ? { raw: x.raw, s: x.s ? { ...x.s } : null } : null);
        }
        rows.push(row); cells.push(cr);
      }
      const tsv = CSV.write(rows, '\t').replace(/\n$/, '');
      S.clip = { sid: S.sid, g, cells, tsv, cut };
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
      if (C.cut) C.cells.forEach((row, i) => row.forEach((x, j) => clears.push({ r: C.g.r1 + i, c: C.g.c1 + j, raw: '', s: null })));
      if (C.cut && C.sid === S.sid) list.push(...clears);
      C.cells.forEach((row, i) => row.forEach((x, j) => {
        const r = g.r1 + i, c = g.c1 + j;
        if (r >= E.MAX_ROWS || c >= E.MAX_COLS) return;
        list.push({ r, c, raw: x ? (C.cut ? x.raw : E.shiftFormula(x.raw, dr, dc)) : '', s: x && x.s ? { ...x.s } : null });
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
    const chartSpec = ch => ({ type: ch.type, title: ch.title, data: Chart.chartData(S.book, ch.sid, ch.g, showAt(ch.sid)) });
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
      const data = Chart.chartData(S.book, S.sid, g, showAt(S.sid));
      if (!data.series.length) {
        api.notify({ app: 'Static Sheets', icon: 'bar-chart', title: 'Nothing to chart yet', message: 'Select cells with numbers in them — a column of names beside them becomes the labels — then pick a chart.' });
        say('Select some numbers to chart first');
        return null;
      }
      const one = data.series.length === 1 && !/^(Column|Row) /.test(data.series[0].name);
      const ch = { id: ++S.chartSeq, sid: S.sid, g, type, title: one ? data.series[0].name : `Chart ${S.charts.filter(x => x.sid === S.sid).length + 1}` };
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
          h('small', { text: 'Select a range with numbers and pick Bar, Line or Pie in the toolbar.' })));
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
      type.addEventListener('change', () => { ch.type = type.value; drawOne(ch); markDirty(); say(`${Chart.TYPE_NAMES[ch.type]} chart`); });
      const more = h('button.ibtn', { type: 'button', 'aria-label': `Chart menu: ${ch.title || 'chart'}`, 'aria-haspopup': 'menu', onclick: e => chartMenu(ch, e.currentTarget) }, icon('more-horizontal'));
      const note = h('span.dim');
      const sh = S.book.sheet(ch.sid);
      const el = h('div.ss-chart', { dataset: { chart: String(ch.id) } },
        h('div.ss-chart__top', title, type, more), canvas,
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
        const t = h('button.ss-tab', { type: 'button', role: 'tab', 'aria-selected': String(on), 'aria-controls': grid.id, tabindex: on ? '0' : '-1', dataset: { sid: String(sh.id) }, text: sh.name });
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
      api.menu([
        { label: 'Rename…', icon: 'edit-3', hint: 'F2', onClick: () => { renaming = sh.id; renderTabs(); } },
        { label: 'Delete sheet', icon: 'trash', danger: true, disabled: S.book.sheets.length < 2, onClick: () => deleteSheet(sh.id) },
      ], x, y, { label: `Sheet ${sh.name}` });
    }
    function resetRows() {
      for (const [r, el] of rowsOn) { rowsOn.delete(r); spare.push(el); el.remove(); }
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
        { label: 'Chart from selection', icon: 'bar-chart', items: Chart.TYPES.map(t => ({ label: `${Chart.TYPE_NAMES[t]} chart`, icon: t === 'line' ? 'line-chart' : `${t}-chart`, onClick: () => addChart(t) })) },
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
        return sh && g && Chart.TYPES.includes(c.type) ? { id: ++S.chartSeq, sid: sh.id, g, type: c.type, title: String(c.title || '') } : null;
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
      S.book = book;
      S.sid = ((activeName && book.sheetNamed(activeName)) || book.sheets[0]).id;
      S.charts = charts;
      S.showCharts = charts.some(c => c.sid === S.sid);
      S.views.clear(); S.undo = []; S.redo = []; S.clip = null;
      S.cur = { r: 0, c: 0 }; S.anchor = { r: 0, c: 0 }; S.focus = { r: 0, c: 0 };
      theme = null;
      resetRows();
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
      charts: S.charts.filter(c => S.book.sheet(c.sid)).map(c => ({ sheet: S.book.sheet(c.sid).name, range: E.rangeName(c.g), type: c.type, title: c.title })),
    });
    /** plain values on one sheet: a CSV can hold all of it */
    function csvSafe() {
      if (S.book.sheets.length !== 1 || S.charts.length) return false;
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
    };

    /* ================= start ================= */
    S.book = blankBook();
    S.sid = S.book.sheets[0].id;
    setDoc(null, null);
    paint(true);
    renderTabs(); renderCharts(); syncBars();
    if (opts && opts.path) openPath(vfs.norm(opts.path));
    requestAnimationFrame(() => { if (!S.dead && !app.querySelector('.ss-dlg')) grid.focus({ preventScroll: true }); });

    return () => {
      if (S.edit) commitEdit(0, 0, false);
      if (tSave) saveNow();
      if (tRec) saveRecovery();
      S.dead = true;
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
