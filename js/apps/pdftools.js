/* ============================================================
   pdftools.js — Static PDF tools: mark up, sign, merge and split PDFs.

   ANNOTATE  open a PDF from Files or the computer and write on it: pen,
             highlight, text, and your signature. The page is drawn by
             pdf.js (Mozilla's, vendored, Apache-2.0); the marks are drawn
             into a copy by pdf-lib (MIT). Both load only when a PDF opens
             (core/pdfkit.js) and run on this device.
   SIGN      draw your signature once; it is kept on this device, for this
             person (the store, portal.pdftools), and placed with a click.
             Forget it any time. A drawn signature is a picture of your
             handwriting, not a certificate: nothing here proves who signed.
   MERGE     pick PDFs, set the order, save one new PDF.
   SPLIT     type the pages you want ("1-3, 5"): each part is saved as its
             own PDF, or every page on its own.
   Saving always writes a NEW file to Files and never changes the original.
   Nothing is uploaded; a password-protected PDF is refused with a plain
   sentence. Everything from a file or its names is set as text, never HTML.
   Keys: P pen, H highlight, T text, S signature, Left / Right or Page Up /
   Down turn pages, + / - zoom, Ctrl or Cmd+Z undo, Ctrl or Cmd+S save a copy;
   with the page focused, Enter puts the text or signature in the middle.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import vfs from '../core/vfs.js';
import media from '../core/media.js';
import * as K from '../core/pdfkit.js';

const KEY = 'portal.pdftools';
const COLORS = [['#111111', 'Black'], ['#d12027', 'Red'], ['#1f5fd1', 'Blue'], ['#14833b', 'Green']];
const HL_COLORS = [['#ffe14d', 'Yellow'], ['#7bf08a', 'Green'], ['#ff9fd0', 'Pink'], ['#8ad6ff', 'Blue']];
const WIDTHS = [['Thin', 0.0025], ['Medium', 0.005], ['Thick', 0.01]];
const TEXT_SIZES = [['Small', 0.022], ['Medium', 0.032], ['Large', 0.05]];
const SIG_W = 0.28;           /* a placed signature is this fraction of the page's width */

const CSS = `
.pt{flex:1;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--font);color:var(--ink-1);font-size:var(--fs-13);position:relative}
.pt *{box-sizing:border-box}
.pt button,.pt input,.pt select{font:inherit;color:inherit}
.pt__top{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-1)}
.pt__top h1{font-size:var(--fs-15);margin:0;color:var(--ink-0)}
.pt__tabs{display:flex;gap:2px;margin-left:auto}
.pt__btn{height:28px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.pt__btn:disabled{opacity:.45;cursor:default}
.pt__btn[aria-pressed=true],.pt__btn[aria-selected=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff)}
.pt .pt__btn--go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff);font-weight:600}
/* the four accents whose white ink reads below 4.5:1 get the dark ink here, as Markets does */
:root:is([data-accent=aether],[data-accent=azure],[data-accent=violet],[data-accent=pink]):not([data-contrast=high]) .pt{--accent-ink:#14060a}
.pt .icon{display:inline-flex;width:16px;height:16px;flex:none}.pt .icon svg{width:100%;height:100%}
.pt button:focus-visible,.pt input:focus-visible,.pt select:focus-visible,.pt__sheet:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.pt__msg{padding:var(--sp-2) var(--sp-4);font-size:var(--fs-12);background:var(--fill-1);border-bottom:1px solid var(--line-1);display:flex;gap:var(--sp-3);align-items:center}
.pt__msg[hidden]{display:none}
.pt__msg[data-kind=error]{color:var(--danger,#ef5b5b)}
.pt__body{flex:1;min-height:0;overflow:auto;padding:var(--sp-4)}
.pt h2{font-size:var(--fs-13);margin:var(--sp-4) 0 var(--sp-3);color:var(--ink-0)}
.pt p{margin:var(--sp-2) 0}
.pt__rows{display:flex;flex-direction:column;border:1px solid var(--line-2);border-radius:var(--r-md,10px);overflow:hidden}
.pt__row{display:flex;align-items:center;gap:var(--sp-3);padding:6px var(--sp-3);border-top:1px solid var(--line-1)}
.pt__row:first-child{border-top:0}
.pt__row>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt__row small{color:var(--ink-2)}
.pt__row[aria-selected=true]{background:var(--fill-2)}
.pt__empty{padding:var(--sp-5);text-align:center;color:var(--ink-2)}
.pt__field{display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:center;margin:var(--sp-3) 0}
.pt__field input[type=text]{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);padding:0 var(--sp-3);flex:1 1 200px;min-width:0}
.pt__tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px var(--sp-3);border-bottom:1px solid var(--line-1);background:var(--bg-2,var(--fill-1))}
.pt__tools select{height:28px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--fill-1);padding:0 6px}
.pt__sw{width:22px;height:22px;border-radius:50%;border:2px solid var(--line-2);cursor:pointer;padding:0}
.pt__sw[aria-pressed=true]{border-color:var(--ink-0);box-shadow:0 0 0 2px var(--accent)}
.pt__sep{width:1px;height:20px;background:var(--line-2);margin:0 2px}
.pt__stage{flex:1;min-height:0;overflow:auto;background:var(--fill-2);display:flex;padding:var(--sp-4)}
.pt__sheet{position:relative;margin:auto;box-shadow:0 2px 14px rgba(0,0,0,.35);background:#fff;flex:none;outline:none;touch-action:none}
.pt__sheet canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.pt__sheet[data-tool=pen],.pt__sheet[data-tool=hl]{cursor:crosshair}
.pt__sheet[data-tool=text]{cursor:text}
.pt__sheet[data-tool=sign]{cursor:copy}
.pt__say{position:absolute;z-index:2;min-width:120px;border:1px dashed var(--accent);background:rgba(255,255,255,.85);color:#111;padding:0 2px;font-family:Helvetica,Arial,sans-serif;line-height:1.2;resize:none;overflow:hidden}
.pt__foot{padding:4px var(--sp-4);font-size:var(--fs-12);color:var(--ink-2);border-top:1px solid var(--line-1);display:flex;gap:var(--sp-4);align-items:center}
.pt__sig{border:1px solid var(--line-2);border-radius:var(--r-md,10px);background:var(--fill-1);padding:var(--sp-4);margin:var(--sp-4);max-width:520px;align-self:flex-start}
.pt__sig canvas{display:block;width:100%;height:150px;background:#fff;border-radius:var(--r-sm);touch-action:none;cursor:crosshair}
.pt__sig[hidden]{display:none}
.pt__acts{display:flex;gap:var(--sp-3);flex-wrap:wrap;margin-top:var(--sp-3)}
`;

const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const stemOf = n => n.replace(/\.[^.]+$/, '');
const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cleanName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'document';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

defineApp({
  id: 'pdftools',
  name: 'PDF tools',
  icon: 'file-text',
  g1: '#ef4b4b', g2: '#8e1018',
  category: 'Productivity',
  keywords: ['pdf', 'annotate', 'markup', 'highlight', 'sign', 'signature', 'merge', 'split', 'combine', 'extract pages', 'form', 'document', 'write on pdf', 'mozilla', 'pdf.js'],
  desc: 'Write on a PDF, sign it, merge PDFs or split one into parts; saves a new file and never changes the original',
  singleton: true,
  win: { w: 940, h: 700, minW: 420, minH: 420 },
  shortcuts: [['P / H / T / S', 'Pen, highlight, text, signature'], ['Left / Right', 'Previous / next page'], ['Plus / -', 'Zoom in / out'],
    ['Mod+Z', 'Undo the last mark'], ['Mod+S', 'Save a copy'], ['Enter', 'Put the text or signature in the middle of the page']],

  mount({ root, win, opts, api }) { return build(root, win, opts, api); },
});

function build(root, win, opts, api) {
  let dead = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

  /* ---------------- saved: the signature only ---------------- */
  const P = () => store.get(KEY) || {};
  const sig = () => P().sig || null;
  const setSig = v => store.set(KEY, { ...P(), sig: v });

  /* ---------------- the shell ---------------- */
  const msg = h('div.pt__msg', { hidden: true, role: 'status' });
  let msgActs = [];
  const say = (text, kind, acts) => {
    msg.replaceChildren(h('span', { text: text || '' }), ...(acts || []));
    msg.hidden = !text; msg.dataset.kind = kind || '';
  };
  const S = { tab: 'annotate', doc: null, tool: 'pen', color: '#d12027', hl: '#ffe14d', width: 0.005, tsize: 0.032, zoom: 1, merge: [], splitSrc: null };
  const tabBtn = (id, label, ic) => h('button.pt__btn', { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': 'false', onclick: () => setTab(id) }, icon(ic), label);
  const tabs = { annotate: tabBtn('annotate', 'Mark up', 'edit-3'), merge: tabBtn('merge', 'Merge', 'copy'), split: tabBtn('split', 'Split', 'filter') };
  const top = h('div.pt__top', h('h1', { text: 'PDF tools' }), h('div.pt__tabs', { role: 'tablist' }, tabs.annotate, tabs.merge, tabs.split));
  const body = h('div.pt__body');
  const shell = h('div.pt', h('style', { text: CSS }), top, msg, body);
  root.replaceChildren(shell);

  function setTab(id) {
    if (S.tab === 'annotate' && S.doc) endText(true);
    S.tab = id;
    for (const [k, b] of Object.entries(tabs)) b.setAttribute('aria-selected', String(k === id));
    paint();
  }

  /* ---------------- the PDFs in Files ---------------- */
  const pdfsInFiles = () => {
    const out = [];
    vfs.walk(vfs.HOME, (n, path) => {
      if (path.startsWith(`${vfs.HOME}/Trash`)) return;
      if (n.type === 'file' && extOf(n.name) === 'pdf' && media.isMedia(n)) out.push({ path, name: n.name, size: n.size || 0 });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  };
  async function bytesOf(src) {
    const blob = src.blob || await media.blobOf(src.path);
    if (!blob) throw new K.PdfError('The bytes of this PDF are missing from this browser.');
    return new Uint8Array(await blob.arrayBuffer());
  }
  const dirFor = src => (src && src.path ? vfs.parentPath(src.path) : `${vfs.HOME}/Documents`);

  async function saveNew(dir, name, bytes) {
    const { path } = await media.save(dir, name, new Blob([bytes], { type: 'application/pdf' }));
    return path;
  }
  const showInFiles = path => h('button.pt__btn', { type: 'button', 'data-act': 'show', onclick: () => api.openApp('files', { path: vfs.parentPath(path) }) }, icon('folder-open'), 'Show in Files');

  /* the file chooser shared by the three tabs */
  const fileIn = h('input', { type: 'file', accept: '.pdf,application/pdf', multiple: true, hidden: true, 'aria-label': 'Choose PDF files' });
  let onPick = null;
  fileIn.addEventListener('change', () => {
    const files = [...fileIn.files].filter(f => extOf(f.name) === 'pdf' || f.type === 'application/pdf');
    fileIn.value = '';
    if (!files.length) { say('Choose a file ending in .pdf.', 'error'); return; }
    if (onPick) onPick(files);
  });
  const choose = (fn) => { onPick = fn; fileIn.click(); };
  shell.append(fileIn);

  function paint() {
    if (dead) return;
    if (S.tab === 'annotate') paintAnnotate();
    else if (S.tab === 'merge') paintMerge();
    else paintSplit();
  }

  /* ============================================================
     MARK UP
     ============================================================ */
  const D = () => S.doc;
  const marksOf = n => { const d = D(); return (d.edits[n] = d.edits[n] || { marks: [] }).marks; };
  const total = () => { let n = 0; for (const e of Object.values(D().edits)) n += e.marks.length; return n; };
  let sheet = null, base = null, over = null, pageLbl = null, saveBtn = null, undoBtn = null, sigPanel = null, tools = null, footEl = null;
  let drawing = null, textBox = null, renderTok = 0;
  const sigImgs = new Map();

  function paintAnnotate() {
    body.replaceChildren();
    body.style.padding = '0';
    if (!D()) {
      body.style.padding = '';
      const files = pdfsInFiles();
      body.append(h('p', { text: 'Open a PDF to write on it, highlight it or sign it. Your original is never changed: Save a copy writes a new file.' }),
        h('div.pt__field', h('button.pt__btn.pt__btn--go', { type: 'button', 'data-act': 'open', onclick: () => choose(fs => openFile({ blob: fs[0], name: fs[0].name })) }, icon('upload'), 'Open from your computer')),
        h('h2', { text: `PDFs in your files · ${files.length}` }));
      if (!files.length) body.append(h('div.pt__empty', { text: 'No PDFs in Files yet.' }));
      else {
        const rows = h('div.pt__rows');
        for (const f of files) rows.append(h('div.pt__row', { 'data-path': f.path }, icon('file-text'), h('span', { text: f.name, title: f.path }), h('small', { text: fmtSize(f.size) }),
          h('button.pt__btn', { type: 'button', 'data-act': 'mark', onclick: () => openFile(f) }, 'Mark up')));
        body.append(rows);
      }
      return;
    }
    buildEditor();
    showPage(D().page);
  }

  async function openFile(src) {
    say(`Opening “${src.name}”…`);
    try {
      const bytes = await bytesOf(src);
      const pdf = await K.openPdf(bytes);
      if (dead) { pdf.close(); return; }
      if (S.doc) S.doc.pdf.close();
      S.doc = { name: src.name, path: src.path || null, bytes, pdf, page: 1, edits: {}, sizes: new Map() };
      S.zoom = 1;
      say('');
      S.tab = 'annotate';
      for (const [k, b] of Object.entries(tabs)) b.setAttribute('aria-selected', String(k === 'annotate'));
      paint();
    } catch (err) { say(err instanceof K.PdfError ? err.message : 'That PDF could not be opened.', 'error'); }
  }

  const tbtn = (label, ic, fn, extra = {}) => h('button.pt__btn', { type: 'button', 'aria-label': label, title: label, onclick: fn, ...extra }, icon(ic));

  function buildEditor() {
    const toolBtn = (id, label, ic, key) => h('button.pt__btn', { type: 'button', 'data-tool': id, 'aria-pressed': String(S.tool === id), title: `${label} (${key})`, 'aria-label': label,
      onclick: () => setTool(id) }, icon(ic), label);
    tools = h('div.pt__tools',
      h('button.pt__btn', { type: 'button', 'data-act': 'close', onclick: closeDoc }, icon('arrow-left'), 'PDFs'),
      h('span', { text: D().name, title: D().name, style: { fontWeight: 600, maxWidth: '18em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
      h('span.pt__sep'),
      toolBtn('pen', 'Pen', 'edit-3', 'P'), toolBtn('hl', 'Highlight', 'sparkles', 'H'), toolBtn('text', 'Text', 'type', 'T'), toolBtn('sign', 'Sign', 'pin', 'S'),
      h('button.pt__btn', { type: 'button', 'data-act': 'sig-menu', title: 'Draw, replace or delete your saved signature', 'aria-label': 'Your signature', onclick: () => { sigPanel.hidden = !sigPanel.hidden; } }, icon('more-horizontal')),
      h('span.pt__sep'),
      h('span', { 'data-swatches': '' }),
      h('select', { 'aria-label': 'Pen thickness', 'data-act': 'width', onchange: e => { S.width = Number(e.target.value); } },
        WIDTHS.map(([n, v]) => h('option', { value: String(v), text: n, selected: v === S.width }))),
      h('select', { 'aria-label': 'Text size', 'data-act': 'tsize', onchange: e => { S.tsize = Number(e.target.value); } },
        TEXT_SIZES.map(([n, v]) => h('option', { value: String(v), text: `${n} text`, selected: v === S.tsize }))),
      h('span.pt__sep'),
      undoBtn = h('button.pt__btn', { type: 'button', 'data-act': 'undo', title: 'Undo the last mark (Ctrl or Cmd+Z)', 'aria-label': 'Undo', onclick: undo }, icon('undo'), 'Undo'),
      tbtn('Zoom out', 'zoom-out', () => zoom(-0.25), { 'data-act': 'zoomout' }), tbtn('Zoom in', 'zoom-in', () => zoom(0.25), { 'data-act': 'zoomin' }),
      tbtn('Previous page', 'chevron-left', () => showPage(D().page - 1), { 'data-act': 'prev' }),
      pageLbl = h('span', { 'data-page': '', 'aria-live': 'polite' }),
      tbtn('Next page', 'chevron-right', () => showPage(D().page + 1), { 'data-act': 'next' }),
      saveBtn = h('button.pt__btn.pt__btn--go', { type: 'button', 'data-act': 'save', title: 'Save a copy (Ctrl or Cmd+S)', onclick: saveCopy }, icon('download'), 'Save a copy'));
    sheet = h('div.pt__sheet', { tabindex: '0', role: 'application', 'aria-label': 'PDF page. Draw with the mouse; press Enter to place text or a signature in the middle.', 'data-tool': S.tool });
    base = h('canvas', { 'aria-hidden': 'true' });
    over = h('canvas', { 'aria-hidden': 'true' });
    sheet.append(base, over);
    sheet.addEventListener('pointerdown', onDown);
    sheet.addEventListener('pointermove', onMove);
    sheet.addEventListener('pointerup', onUp);
    sheet.addEventListener('pointercancel', onUp);
    sheet.addEventListener('keydown', e => { if (e.key === 'Enter' && (S.tool === 'text' || S.tool === 'sign') && e.target === sheet) { e.preventDefault(); place(0.5, 0.5); } });
    const stage = h('div.pt__stage', sheet);
    sigPanel = buildSigPanel();
    footEl = h('div.pt__foot', h('span', { 'data-count': '' }));
    body.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tools, h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', position: 'relative' } }, stage, sigPanel), footEl));
    paintSwatches();
  }

  function paintSwatches() {
    const holder = tools.querySelector('[data-swatches]');
    holder.replaceChildren();
    const list = S.tool === 'hl' ? HL_COLORS : COLORS;
    const cur = S.tool === 'hl' ? S.hl : S.color;
    for (const [c, n] of list) holder.append(h('button.pt__sw', { type: 'button', 'aria-label': n, title: n, 'aria-pressed': String(cur === c), style: { background: c }, 'data-color': c,
      onclick: () => { if (S.tool === 'hl') S.hl = c; else S.color = c; paintSwatches(); } }));
    holder.style.display = 'inline-flex'; holder.style.gap = '4px';
  }

  function setTool(id) {
    if (S.tool === 'text') endText(true);
    S.tool = id;
    for (const b of tools.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    sheet.dataset.tool = id;
    paintSwatches();
    if (id === 'sign' && !sig()) { sigPanel.hidden = false; say('Draw your signature once; it is kept on this device only.'); }
    else if (id === 'sign') say('Click the page where the signature goes.');
    else if (id === 'text') say('Click the page where the text goes. Enter finishes; Shift+Enter starts a new line.');
    else say('');
  }

  function closeDoc() {
    endText(false);
    if (D() && total() && !confirmedLoss()) return;
    if (S.doc) S.doc.pdf.close();
    S.doc = null; sheet = base = over = null;
    paint();
  }
  const confirmedLoss = () => {
    if (S.discard) { S.discard = false; return true; }
    S.discard = true;
    say(`You have ${plural(total(), 'mark')} that aren’t saved. Press PDFs again to leave without saving, or Save a copy first.`, 'error');
    later(() => { S.discard = false; }, 6000);
    return false;
  };

  /* ---- showing a page ---- */
  async function showPage(n) {
    const d = D();
    if (!d || !sheet) return;
    endText(true);
    n = clamp(n, 1, d.pdf.pages);
    d.page = n;
    const tok = ++renderTok;
    sheet.dataset.ready = 'false';
    try {
      /* zoom 1 fits the whole page in the window */
      const sz = await K.pageSize(d.pdf.doc, n);
      const availW = Math.max(260, (sheet.parentElement.clientWidth || 700) - 40);
      const availH = Math.max(260, (sheet.parentElement.clientHeight || 600) - 40);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const css = Math.round(Math.min(availW, availH * sz.w / sz.h, 1000) * S.zoom);
      const canvas = await K.renderPage(d.pdf.doc, n, Math.round(css * dpr));
      if (tok !== renderTok || dead || !sheet) return;
      base.width = canvas.width; base.height = canvas.height;
      base.getContext('2d').drawImage(canvas, 0, 0);
      over.width = canvas.width; over.height = canvas.height;
      sheet.style.width = `${css}px`;
      sheet.style.height = `${Math.round(css * canvas.height / canvas.width)}px`;
      sheet.dataset.ready = 'true';
      sheet.dataset.page = String(n);
      redraw();
      paintBits();
    } catch (err) { if (tok === renderTok && !dead) say('This page could not be drawn.', 'error'); }
  }
  function zoom(d) { S.zoom = clamp(S.zoom + d, 0.5, 3); showPage(D().page); }

  function paintBits() {
    const d = D();
    if (!d || !tools) return;
    pageLbl.textContent = `Page ${d.page} of ${d.pdf.pages}`;
    tools.querySelector('[data-act="prev"]').disabled = d.page <= 1;
    tools.querySelector('[data-act="next"]').disabled = d.page >= d.pdf.pages;
    undoBtn.disabled = !total();
    const n = total();
    footEl.querySelector('[data-count]').textContent = n ? `${plural(n, 'mark')} on ${plural(Object.values(d.edits).filter(e => e.marks.length).length, 'page')}, not saved yet` : 'No marks yet. Your original file is never changed.';
  }

  /* ---- drawing the marks on the page ---- */
  function imgFor(png) {
    let im = sigImgs.get(png);
    if (!im) { im = new Image(); im.onload = () => redraw(); im.src = png; sigImgs.set(png, im); }
    return im;
  }
  function paintMark(ctx, m, W, H) {
    if (m.t === 'pen') {
      ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = Math.max(1, m.w * W); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      m.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      if (m.pts.length === 1) ctx.lineTo(m.pts[0][0] * W + 0.01, m.pts[0][1] * H);
      ctx.stroke();
    } else if (m.t === 'hl') {
      ctx.globalAlpha = 0.4; ctx.fillStyle = m.color; ctx.fillRect(m.x * W, m.y * H, m.w * W, m.h * H); ctx.globalAlpha = 1;
    } else if (m.t === 'text') {
      const size = m.size * W;
      ctx.fillStyle = m.color; ctx.font = `${size}px Helvetica, Arial, sans-serif`; ctx.textBaseline = 'alphabetic';
      String(m.text).split(/\r?\n/).forEach((ln, i) => ctx.fillText(ln, m.x * W, m.y * H + (0.8 + 1.2 * i) * size));
    } else if (m.t === 'img') {
      const im = imgFor(m.png);
      if (im.complete && im.naturalWidth) ctx.drawImage(im, m.x * W, m.y * H, m.w * W, m.h * H);
    }
  }
  function redraw(extra) {
    if (!over) return;
    const ctx = over.getContext('2d');
    ctx.clearRect(0, 0, over.width, over.height);
    for (const m of marksOf(D().page)) paintMark(ctx, m, over.width, over.height);
    if (extra) paintMark(ctx, extra, over.width, over.height);
  }

  /* ---- pointer: pen, highlight, and clicks ---- */
  const fracOf = e => {
    const r = sheet.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / (r.width || 1), 0, 1), clamp((e.clientY - r.top) / (r.height || 1), 0, 1)];
  };
  function onDown(e) {
    if (!D() || sheet.dataset.ready !== 'true' || e.button > 0) return;
    if (e.target.closest && e.target.closest('.pt__say')) return;
    const [x, y] = fracOf(e);
    if (S.tool === 'pen') {
      drawing = { t: 'pen', color: S.color, w: S.width, pts: [[x, y]] };
      sheet.setPointerCapture && sheet.setPointerCapture(e.pointerId);
      redraw(drawing);
    } else if (S.tool === 'hl') {
      drawing = { t: 'hl', color: S.hl, x, y, w: 0, h: 0, ax: x, ay: y };
      sheet.setPointerCapture && sheet.setPointerCapture(e.pointerId);
    } else if (S.tool === 'text' || S.tool === 'sign') {
      e.preventDefault();
      place(x, y);
      if (S.tool === 'sign') sheet.focus({ preventScroll: true });
      return;
    }
    sheet.focus({ preventScroll: true });
  }
  function onMove(e) {
    if (!drawing) return;
    const [x, y] = fracOf(e);
    if (drawing.t === 'pen') drawing.pts.push([x, y]);
    else { drawing.x = Math.min(drawing.ax, x); drawing.y = Math.min(drawing.ay, y); drawing.w = Math.abs(x - drawing.ax); drawing.h = Math.abs(y - drawing.ay); }
    redraw(drawing);
  }
  function onUp() {
    if (!drawing) return;
    const m = drawing;
    drawing = null;
    if (m.t === 'hl') { if (m.w < 0.004 || m.h < 0.004) { redraw(); return; } delete m.ax; delete m.ay; }
    marksOf(D().page).push(m);
    redraw();
    paintBits();
  }

  /* ---- text ---- */
  function place(x, y) {
    if (S.tool === 'sign') {
      const s = sig();
      if (!s) { sigPanel.hidden = false; return; }
      const w = SIG_W, hh = w * (s.h / s.w) * (over.width / over.height);
      marksOf(D().page).push({ t: 'img', png: s.png, x: clamp(x - w / 2, 0, 1 - w), y: clamp(y - hh / 2, 0, 1 - hh), w, h: hh });
      redraw(); paintBits();
      return;
    }
    endText(true);
    const r = sheet.getBoundingClientRect();
    const size = S.tsize * r.width;
    const ta = h('textarea.pt__say', { rows: 1, 'aria-label': 'Text to put on the page', style: { left: `${x * 100}%`, top: `${y * 100}%`, fontSize: `${size}px`, color: S.color, height: `${size * 1.4}px` } });
    ta.dataset.x = String(x); ta.dataset.y = String(y);
    const fit = () => { const n = ta.value.split('\n').length; ta.style.height = `${size * (0.2 + 1.2 * n)}px`; };
    ta.addEventListener('input', fit);
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endText(true); sheet.focus({ preventScroll: true }); }
      else if (e.key === 'Escape') { e.preventDefault(); endText(false); sheet.focus({ preventScroll: true }); }
    });
    ta.addEventListener('blur', () => later(() => { if (textBox === ta) endText(true); }, 0));
    ta.addEventListener('pointerdown', e => e.stopPropagation());
    sheet.append(ta);
    textBox = ta;
    ta.focus();
  }
  function endText(commit) {
    const ta = textBox;
    if (!ta) return;
    textBox = null;
    const text = ta.value.replace(/\s+$/, '');
    const x = Number(ta.dataset.x), y = Number(ta.dataset.y), color = ta.style.color;
    ta.remove();
    if (commit && text && D()) {
      marksOf(D().page).push({ t: 'text', color: S.color, x, y, size: S.tsize, text });
      redraw(); paintBits();
    }
  }

  function undo() {
    const d = D();
    if (!d) return;
    endText(false);
    const ms = marksOf(d.page);
    if (ms.length) ms.pop();
    else {                       /* nothing on this page: take back the last mark anywhere */
      const last = Object.entries(d.edits).filter(([, e]) => e.marks.length).pop();
      if (last) { last[1].marks.pop(); showPage(Number(last[0])); return; }
    }
    redraw(); paintBits();
  }

  /* ---- the signature ---- */
  function buildSigPanel() {
    const pad = h('canvas', { width: 520, height: 200, 'aria-label': 'Draw your signature here', 'data-sigpad': '' });
    const ctx = pad.getContext('2d');
    let down = false, any = false, bounds = null;
    const at = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
    const reset = () => { ctx.clearRect(0, 0, pad.width, pad.height); any = false; bounds = null; };
    const grow = (x, y) => { bounds = bounds ? [Math.min(bounds[0], x), Math.min(bounds[1], y), Math.max(bounds[2], x), Math.max(bounds[3], y)] : [x, y, x, y]; };
    pad.addEventListener('pointerdown', e => {
      down = true; any = true; pad.setPointerCapture && pad.setPointerCapture(e.pointerId);
      const [x, y] = at(e);
      ctx.strokeStyle = '#0b1f4d'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y); ctx.stroke(); grow(x, y);
    });
    pad.addEventListener('pointermove', e => { if (!down) return; const [x, y] = at(e); ctx.lineTo(x, y); ctx.stroke(); grow(x, y); });
    const up = () => { down = false; };
    pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
    const use = () => {
      if (!any || !bounds) { say('Draw your signature in the box first.', 'error'); return; }
      const pad4 = 6;
      const x0 = Math.max(0, bounds[0] - pad4), y0 = Math.max(0, bounds[1] - pad4);
      const w = Math.min(pad.width, bounds[2] + pad4) - x0, hh = Math.min(pad.height, bounds[3] + pad4) - y0;
      const out = document.createElement('canvas');
      out.width = Math.max(2, Math.round(w)); out.height = Math.max(2, Math.round(hh));
      out.getContext('2d').drawImage(pad, x0, y0, w, hh, 0, 0, out.width, out.height);
      setSig({ png: out.toDataURL('image/png'), w: out.width, h: out.height, at: Date.now() });
      panel.hidden = true; reset();
      say('Signature kept on this device. Click the page where it goes.');
      setTool('sign');
      paintForget();
    };
    const forget = h('button.pt__btn', { type: 'button', 'data-act': 'forget-sig', onclick: () => { setSig(null); sigImgs.clear(); paintForget(); panel.hidden = true; say('Your saved signature was deleted from this device.'); } }, icon('trash'), 'Forget my signature');
    const redo = h('button.pt__btn', { type: 'button', 'data-act': 'new-sig', onclick: () => { panel.hidden = false; } }, icon('edit-3'), 'Draw a new one');
    const paintForget = () => { forget.hidden = !sig(); redo.hidden = !sig(); };
    const panel = h('div.pt__sig', { hidden: true, 'data-sigpanel': '' },
      h('b', { text: 'Your signature' }),
      h('p', { text: 'Draw it with the mouse or a finger. It is kept on this device, for you only, and is a picture of your handwriting, not a certificate.' }),
      pad,
      h('div.pt__acts',
        h('button.pt__btn.pt__btn--go', { type: 'button', 'data-act': 'use-sig', onclick: use }, icon('check'), 'Keep and use'),
        h('button.pt__btn', { type: 'button', 'data-act': 'clear-sig', onclick: reset }, 'Clear'),
        h('button.pt__btn', { type: 'button', onclick: () => { panel.hidden = true; } }, 'Cancel'),
        forget, redo));
    paintForget();
    return panel;
  }

  /* ---- Save a copy ---- */
  let saving = false;
  async function saveCopy() {
    const d = D();
    if (!d || saving) return;
    endText(true);
    if (!total()) { say('There is nothing to save yet: draw, highlight, type or sign something first.', 'error'); return; }
    saving = true; saveBtn.disabled = true;
    say('Saving a copy…');
    try {
      const { bytes, replaced } = await K.annotate(d.bytes, d.edits);
      const path = await saveNew(dirFor(d), `${stemOf(d.name)} (marked up).pdf`, bytes);
      for (const e of Object.values(d.edits)) e.marks.length = 0;
      S.discard = false;
      say(`Saved ${vfs.baseName(path)} to ${vfs.parentPath(path) === vfs.HOME ? 'Home' : vfs.baseName(vfs.parentPath(path))}. The original is unchanged.${replaced ? ` ${plural(replaced, 'character')} that Helvetica can’t write became “?”.` : ''}`, '', [showInFiles(path)]);
      redraw(); paintBits();
    } catch (err) { say(err instanceof K.PdfError ? err.message : `Couldn’t save the copy: ${err.message || 'unknown error'}`, 'error'); }
    saving = false;
    if (saveBtn) saveBtn.disabled = false;
  }

  /* ============================================================
     MERGE
     ============================================================ */
  function paintMerge() {
    body.replaceChildren();
    body.style.padding = '';
    const files = pdfsInFiles();
    const nameIn = h('input', { type: 'text', value: 'Merged.pdf', 'aria-label': 'Name of the merged file', 'data-merge-name': '' });
    const goBtn = h('button.pt__btn.pt__btn--go', { type: 'button', 'data-act': 'merge', disabled: S.merge.length < 2, onclick: () => doMerge(nameIn.value, goBtn) }, icon('copy'), S.merge.length ? `Merge ${S.merge.length} PDFs` : 'Merge');
    body.append(h('p', { text: 'Pick PDFs in the order they should go. The merged file is saved as a new PDF; the originals stay as they are.' }),
      h('div.pt__field', h('button.pt__btn', { type: 'button', 'data-act': 'merge-add-computer', onclick: () => choose(fs => { for (const f of fs) S.merge.push({ blob: f, name: f.name, size: f.size }); paintMerge(); }) }, icon('upload'), 'Add from your computer')),
      h('h2', { text: `Merge order · ${S.merge.length}` }));
    if (!S.merge.length) body.append(h('div.pt__empty', { text: 'Nothing chosen yet. Add PDFs from the list below.' }));
    else {
      const rows = h('div.pt__rows', { 'data-merge-list': '' });
      S.merge.forEach((m, i) => rows.append(h('div.pt__row', { 'data-i': String(i) }, h('b', { text: `${i + 1}` }), h('span', { text: m.name, title: m.name }), h('small', { text: fmtSize(m.size) }),
        h('button.pt__btn', { type: 'button', 'aria-label': `Move ${m.name} up`, 'data-act': 'up', disabled: i === 0, onclick: () => { [S.merge[i - 1], S.merge[i]] = [S.merge[i], S.merge[i - 1]]; paintMerge(); } }, icon('arrow-up')),
        h('button.pt__btn', { type: 'button', 'aria-label': `Move ${m.name} down`, 'data-act': 'down', disabled: i === S.merge.length - 1, onclick: () => { [S.merge[i + 1], S.merge[i]] = [S.merge[i], S.merge[i + 1]]; paintMerge(); } }, icon('arrow-down')),
        h('button.pt__btn', { type: 'button', 'aria-label': `Remove ${m.name}`, 'data-act': 'drop', onclick: () => { S.merge.splice(i, 1); paintMerge(); } }, icon('x')))));
      body.append(rows, h('div.pt__field', nameIn, goBtn));
    }
    body.append(h('h2', { text: `PDFs in your files · ${files.length}` }));
    if (!files.length) body.append(h('div.pt__empty', { text: 'No PDFs in Files yet.' }));
    else {
      const rows = h('div.pt__rows');
      for (const f of files) rows.append(h('div.pt__row', { 'data-path': f.path }, icon('file-text'), h('span', { text: f.name, title: f.path }), h('small', { text: fmtSize(f.size) }),
        h('button.pt__btn', { type: 'button', 'data-act': 'merge-add', onclick: () => { S.merge.push({ path: f.path, name: f.name, size: f.size }); paintMerge(); } }, icon('plus'), 'Add')));
      body.append(rows);
    }
  }
  async function doMerge(name, btn) {
    if (S.merge.length < 2) { say('Choose at least two PDFs to merge.', 'error'); return; }
    btn.disabled = true;
    say('Merging…');
    try {
      const list = [];
      for (const m of S.merge) list.push(await bytesOf(m));
      const bytes = await K.mergePdfs(list);
      const first = S.merge[0];
      const nm = cleanName(name).replace(/\.pdf$/i, '') + '.pdf';
      const path = await saveNew(dirFor(first), nm, bytes);
      say(`Saved ${vfs.baseName(path)}: ${plural(S.merge.length, 'PDF')} in one file.`, '', [showInFiles(path)]);
      S.merge = [];
      paintMerge();
    } catch (err) { say(err instanceof K.PdfError ? err.message : `Couldn’t merge: ${err.message || 'unknown error'}`, 'error'); btn.disabled = false; }
  }

  /* ============================================================
     SPLIT
     ============================================================ */
  async function chooseSplit(src) {
    say(`Reading “${src.name}”…`);
    try {
      const bytes = await bytesOf(src);
      const pdf = await K.openPdf(bytes);
      const pages = pdf.pages;
      pdf.close();
      S.splitSrc = { ...src, bytes, pages };
      say('');
      paintSplit();
    } catch (err) { say(err instanceof K.PdfError ? err.message : 'That PDF could not be read.', 'error'); }
  }
  function paintSplit() {
    body.replaceChildren();
    body.style.padding = '';
    const sp = S.splitSrc;
    if (!sp) {
      const files = pdfsInFiles();
      body.append(h('p', { text: 'Pick a PDF, then say which pages you want. Each part is saved as its own new PDF.' }),
        h('div.pt__field', h('button.pt__btn', { type: 'button', 'data-act': 'split-computer', onclick: () => choose(fs => chooseSplit({ blob: fs[0], name: fs[0].name })) }, icon('upload'), 'Open from your computer')),
        h('h2', { text: `PDFs in your files · ${files.length}` }));
      if (!files.length) body.append(h('div.pt__empty', { text: 'No PDFs in Files yet.' }));
      else {
        const rows = h('div.pt__rows');
        for (const f of files) rows.append(h('div.pt__row', { 'data-path': f.path }, icon('file-text'), h('span', { text: f.name, title: f.path }), h('small', { text: fmtSize(f.size) }),
          h('button.pt__btn', { type: 'button', 'data-act': 'split-pick', onclick: () => chooseSplit(f) }, 'Split this')));
        body.append(rows);
      }
      return;
    }
    const rangeIn = h('input', { type: 'text', placeholder: 'Pages, like 1-3, 5', 'aria-label': 'Pages to keep', 'data-ranges': '', value: S.splitRanges || '',
      oninput: () => { S.splitRanges = rangeIn.value; }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); doSplit(rangeIn.value, go); } } });
    const go = h('button.pt__btn.pt__btn--go', { type: 'button', 'data-act': 'split', onclick: () => doSplit(rangeIn.value, go) }, icon('filter'), 'Split');
    body.append(h('p', { text: `“${sp.name}” has ${plural(sp.pages, 'page')}.` }),
      h('p', { text: 'Each part, separated by commas, becomes its own PDF: “1-3, 5” makes two files. A part like “7-” goes to the last page.' }),
      h('div.pt__field', rangeIn, go,
        h('button.pt__btn', { type: 'button', 'data-act': 'every', onclick: () => { rangeIn.value = Array.from({ length: sp.pages }, (_, i) => i + 1).join(', '); S.splitRanges = rangeIn.value; } }, 'Every page on its own')),
      h('div.pt__field', h('button.pt__btn', { type: 'button', 'data-act': 'split-other', onclick: () => { S.splitSrc = null; S.splitRanges = ''; paintSplit(); } }, icon('arrow-left'), 'Pick another PDF')));
  }
  async function doSplit(text, btn) {
    const sp = S.splitSrc;
    let parts;
    try { parts = K.parseRanges(text, sp.pages); } catch (err) { say(err.message, 'error'); return; }
    btn.disabled = true;
    say('Splitting…');
    try {
      const dir0 = dirFor(sp);
      let dir = dir0;
      if (parts.length > 1) {                      /* several files: their own folder, so they don't bury the original */
        dir = `${dir0}/${cleanName(stemOf(sp.name))} split`;
        let i = 2;
        while (vfs.node(dir)) dir = `${dir0}/${cleanName(stemOf(sp.name))} split ${i++}`;
      }
      const made = [];
      for (const run of parts) {
        const bytes = await K.extractPages(sp.bytes, run);
        const label = run.length === 1 ? `page ${run[0]}` : `pages ${run[0]}-${run[run.length - 1]}`;
        made.push(await saveNew(dir, `${stemOf(sp.name)} (${label}).pdf`, bytes));
      }
      say(`Saved ${plural(made.length, 'new PDF')}${parts.length > 1 ? ` in the folder “${vfs.baseName(dir)}”` : ''}. The original is unchanged.`, '', [showInFiles(made[0])]);
    } catch (err) { say(err instanceof K.PdfError ? err.message : `Couldn’t split: ${err.message || 'unknown error'}`, 'error'); }
    btn.disabled = false;
  }

  /* ---------------- keys ---------------- */
  const onKey = e => {
    if (dead || S.tab !== 'annotate' || !D() || !sheet) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); undo(); return; }
    if (mod && (k === 's' || k === 'S')) { e.preventDefault(); saveCopy(); return; }
    if (mod || e.altKey) return;
    if (k === 'p' || k === 'P') setTool('pen');
    else if (k === 'h' || k === 'H') setTool('hl');
    else if (k === 't' || k === 'T') setTool('text');
    else if (k === 's' || k === 'S') setTool('sign');
    else if (k === 'ArrowRight' || k === 'PageDown') showPage(D().page + 1);
    else if (k === 'ArrowLeft' || k === 'PageUp') showPage(D().page - 1);
    else if (k === '+' || k === '=') zoom(0.25);
    else if (k === '-' || k === '_') zoom(-0.25);
    else return;
    e.preventDefault();
  };
  shell.addEventListener('keydown', onKey);

  win.onReopen && win.onReopen(o => { if (o && typeof o.path === 'string') openPath(o.path); });
  async function openPath(p) {
    const n = vfs.node(p);
    if (!n || n.type !== 'file') { say('That PDF is no longer in Files.', 'error'); return; }
    await openFile({ path: p, name: n.name });
  }
  const offFs = api.bus.on('fs:change', () => { if (!dead && !S.doc) later(paint, 250); });

  setTab(opts && opts.tab && tabs[opts.tab] ? opts.tab : 'annotate');
  if (opts && typeof opts.path === 'string') openPath(opts.path);

  return () => {
    dead = true;
    for (const t of timers) clearTimeout(t);
    if (typeof offFs === 'function') offFs();
    if (S.doc) { try { S.doc.pdf.close(); } catch (e) { /* gone */ } S.doc = null; }
    root.replaceChildren();
  };
}
