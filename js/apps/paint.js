/* ============================================================
   paint.js — Static Paint: a real drawing app on a <canvas>.

   The document is a fixed-resolution image (like a file on disk):
   the chosen size is the LOGICAL size, and the backing store is
   size × devicePixelRatio (clamped to 2), so strokes stay crisp on
   HiDPI screens and an exported PNG is full resolution. Every canvas
   has the context transform (sx,0,0,sy), so tools are authored in
   logical pixels; flood-fill and the eyedropper work directly on the
   device pixels via getImageData.

   Layers: the picture is a stack of transparent layers (each with a
   name, an eye and an opacity) over a paper that is white, or clear
   when Transparent background is on. The canvas you see (.pnt__canvas)
   is the stack flattened; tools draw into the active layer. A stroke
   being drawn lives on a "wet" canvas that is shown right above the
   active layer, so Opacity applies to the whole stroke at once and an
   overlap doesn't darken; on release it is stamped into the layer.
   The eraser rubs the layer out. Fill reads the flattened picture and
   writes into the active layer. Text is typed into a box and then
   drawn into the layer as pixels (system fonts, plus Anton and Bangers
   which ship with StaticOS). Select (a marquee) can be moved, copied,
   cut, deleted and pasted; a picture pasted from the clipboard is only
   read when the person pastes (the paste event), never by polling.

   Zoom and pan: the paper is resized by CSS (the pixels are unchanged),
   pointer positions are measured against the canvas's own rectangle, so
   a stroke lands under the pointer at every zoom and scroll position.
   Past 400% the pixel grid can be shown and the canvas stops smoothing.
   Pen pressure uses PointerEvent.pressure for a pen (a mouse and engines
   without it draw at full pressure). Symmetry repeats a mark with a list
   of transforms (js/paint/kit.js).

   Undo/redo keeps a capped stack of whole-picture snapshots (one PNG per
   layer, reused when a layer didn't change; each entry also records the
   size so undoing a resize brings it back). The current drawing is
   persisted to IndexedDB (db.js kv 'misc'), capped so a huge canvas
   never overflows the store; a drawing saved before layers existed loads
   as a single layer. Tool, colour, size and options persist in the store
   under 'portal.paint'.

   Export saves a genuine PNG to ~/Pictures with core/media.js (it then
   opens in Photos), offers a plain Download, copies the picture, or
   sends it on (Picture Tools, Markup, the wallpaper) by saving the PNG
   to ~/Pictures first and opening that app on the file. Nothing here is
   faked: every pixel is drawn in the browser and every saved file is real.

   Draw together: one person starts a room (a six-character code and
   an invite link, #draw=<CODE>), a friend joins with it, and both draw
   on the same canvas at once. While in a room the canvas is one picture
   (the flattened layers as the base) plus a shared stroke log
   (core/drawsync.js): each stroke is sent as compact point lists, batched
   while it's drawn, with its tool, colour and size, and the other side
   replays it; each sees the other's cursor and name. Layers, text,
   selections and the soft / see-through / mirrored brushes are off in a
   room (the panel says so): strokes are shared as plain lines. Undo/redo
   take back only your own strokes (the snapshot history is set aside for
   the session). The friend who joins gets the current canvas: over the
   direct link (WebRTC) the base picture and the whole log; without one,
   only the most recent strokes from the room (the base picture can't be
   sent through the public server, and the panel says so). Leaving keeps
   your copy as one layer, and one Undo afterwards brings back what you
   had before joining. Canvas size and Open image are off while in a room.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { save as mediaSave } from '../core/media.js';
import { kv } from '../core/db.js';
import { openPair } from '../core/pair.js';
import { isCode, normalizeCode, spaced } from '../core/roomcode.js';
import * as D from '../core/drawsync.js';
import * as live from '../portal/live.js';
import * as K from '../paint/kit.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-paint-css')) {
  const l = document.createElement('link');
  l.id = 'feat-paint-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-paint.css';
  document.head.appendChild(l);
}

const misc = kv('misc');
const DOC_KEY = 'portal.paint.doc';
const PREF_KEY = 'portal.paint';
const PAPER = '#ffffff';
const HISTORY_CAP = 24;
const PERSIST_MAX = 4.5 * 1024 * 1024;   /* skip persisting drawings larger than this data-URL */
const MAX_SIZE = 64;                     /* biggest brush, logical px */
const RECENT_CAP = 8;
const MAX_LAYERS = 10;
const MAX_PIXELS = 2_400_000;            /* the biggest picture Resize allows, logical px */
const ID = [1, 0, 0, 1, 0, 0];

const ERASER_SVG   = '<svg viewBox="0 0 24 24"><path d="M7 16.5 13 10.5a2 2 0 0 1 2.9 0l1.6 1.6a2 2 0 0 1 0 2.9L13.5 19H9z"/><path d="M4 20h16"/></svg>';
const PIPETTE_SVG  = '<svg viewBox="0 0 24 24"><path d="M10.6 11.5 4.8 17.3a2 2 0 0 0-.5.9L3.6 21l2.8-.7a2 2 0 0 0 .9-.5l5.8-5.8"/><path d="m9.6 10.5 8-8a2.1 2.1 0 0 1 3 3l-8 8z"/><path d="m8 12 4 4"/></svg>';
const REDO_SVG     = '<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
const SELECT_SVG   = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2.4"/></svg>';
const GRAD_SVG     = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 20 20 8M4 16 16 4M12 20l8-8M4 10l6-6"/></svg>';
const POLY_SVG     = '<svg viewBox="0 0 24 24"><path d="M12 3.5 20 9.5 17 19.5H7L4 9.5z"/></svg>';
const RRECT_SVG    = '<svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="4.5"/></svg>';
const HAND_SVG     = '<svg viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5A6 6 0 0 1 8.2 18L4.6 13a1.5 1.5 0 0 1 2.2-2L8 12.5"/></svg>';
const FLIP_SVG     = '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="m8 7-5 5 5 5zM16 7l5 5-5 5z"/></svg>';

const TOOLS = [
  { id: 'brush',      label: 'Brush',       icon: 'edit-3',  key: 'B' },
  { id: 'eraser',     label: 'Eraser',      svg: ERASER_SVG, key: 'E' },
  { id: 'line',       label: 'Line',        icon: 'minus',   key: 'L' },
  { id: 'rect',       label: 'Rectangle',   icon: 'square',  key: 'R' },
  { id: 'rrect',      label: 'Rounded rectangle', svg: RRECT_SVG, key: 'U' },
  { id: 'ellipse',    label: 'Ellipse',     icon: 'circle',  key: 'O' },
  { id: 'poly',       label: 'Polygon',     svg: POLY_SVG,  key: 'P' },
  { id: 'fill',       label: 'Fill area',   icon: 'droplet', key: 'G' },
  { id: 'gradient',   label: 'Gradient',    svg: GRAD_SVG,  key: 'D' },
  { id: 'text',       label: 'Text',        icon: 'type',    key: 'T' },
  { id: 'select',     label: 'Select',      svg: SELECT_SVG, key: 'M' },
  { id: 'eyedropper', label: 'Eyedropper',  svg: PIPETTE_SVG, key: 'I' },
  { id: 'hand',       label: 'Hand (pan)',  svg: HAND_SVG,  key: 'H' },
];
/* what a Draw Together room can share: plain strokes, as lines, boxes and fills */
const ROOM_TOOLS = new Set(['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'eyedropper', 'hand']);
const ROOM_WHY = 'Not in a Draw Together room — everyone shares one picture of plain strokes. Leave the room to use it.';
/* tools that put paint into a layer */
const PAINTS = new Set(['brush', 'eraser', 'line', 'rect', 'rrect', 'ellipse', 'poly', 'fill', 'gradient', 'text']);

const SIZES = [
  { key: 'md',   label: '800 × 600',  w: 800,  h: 600 },
  { key: 'sq',   label: '560 × 560',  w: 560,  h: 560 },
  { key: 'wide', label: '1024 × 640', w: 1024, h: 640 },
  { key: 'hd',   label: '1280 × 720', w: 1280, h: 720 },
  { key: 'sm',   label: '420 × 320',  w: 420,  h: 320 },
  { key: 'px',   label: '128 × 128 (pixel art)', w: 128, h: 128 },
];

const PALETTE = [
  '#000000', '#454b54', '#8a939b', '#c9ced4', '#ffffff',
  '#e11d48', '#f97316', '#f59e0b', '#facc15', '#22c55e',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#d946ef', '#ec4899', '#78350f',
];

/* system fonts, plus the two OFL fonts that ship with StaticOS (css/fonts) */
const FONTS = [
  ['sys',     'System',          'system-ui, -apple-system, "Segoe UI", sans-serif'],
  ['arial',   'Arial',           'Arial, Helvetica, sans-serif'],
  ['georgia', 'Georgia',         'Georgia, "Times New Roman", serif'],
  ['times',   'Times',           '"Times New Roman", Times, serif'],
  ['mono',    'Courier',         '"Courier New", Courier, monospace'],
  ['comic',   'Comic',           '"Comic Sans MS", "Comic Neue", cursive'],
  ['anton',   'Anton',           'Anton, Impact, "Arial Narrow Bold", sans-serif'],
  ['bangers', 'Bangers',         'Bangers, "Comic Sans MS", cursive'],
];
const LINE_H = 1.25;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function normHex(v) {
  let s = String(v || '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map(c => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(s)) return '#' + s;
  return null;
}
function hexToRgb(hex) {
  const h = normHex(hex) || '#000000';
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}
const toHex2 = n => clamp(n | 0, 0, 255).toString(16).padStart(2, '0');
const rgbToHex = (r, g, b) => '#' + toHex2(r) + toHex2(g) + toHex2(b);

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const loadImg = url => new Promise(res => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => res(null);
  img.src = url;
});
const inRect = (r, p) => !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/* the path of one shape; the caller strokes or fills it */
function rrPath(cx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
}
function shapePath(cx, tool, a, b, radius) {
  cx.beginPath();
  if (tool === 'line') { cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); }
  else if (tool === 'rect') { cx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
  else if (tool === 'rrect') { rrPath(cx, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y), radius || 0); }
  else if (tool === 'ellipse') {
    cx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  }
}
/* o: { mats, filled, radius } — a mark is repeated once per transform */
function drawShape(cx, tool, a, b, color, size, o = {}) {
  for (const m of o.mats || [ID]) {
    cx.save();
    cx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    cx.strokeStyle = color; cx.fillStyle = color; cx.lineWidth = size;
    shapePath(cx, tool, a, b, o.radius);
    if (o.filled && tool !== 'line') cx.fill(); else cx.stroke();
    cx.restore();
  }
}
function drawPoly(cx, pts, closed, color, size, o = {}) {
  if (!pts.length) return;
  for (const m of o.mats || [ID]) {
    cx.save();
    cx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    cx.strokeStyle = color; cx.fillStyle = color; cx.lineWidth = size;
    cx.beginPath();
    cx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i].x, pts[i].y);
    if (closed) cx.closePath();
    if (closed && o.filled) cx.fill(); else cx.stroke();
    cx.restore();
  }
}

defineApp({
  id: 'paint',
  name: 'Static Paint',
  icon: 'edit-3',
  g1: '#ff6fae', g2: '#c4246c',
  category: 'Media',
  keywords: ['draw', 'paint', 'canvas', 'sketch', 'brush', 'art', 'doodle', 'image', 'png', 'colour', 'color', 'fill', 'draw together', 'friend', 'multiplayer', 'layers', 'text', 'gradient', 'symmetry', 'kaleidoscope', 'pixel art', 'transparent'],
  desc: 'Draw and paint with layers, text, shapes and fill — then save a real PNG',
  singleton: true,
  win: { w: 940, h: 660, minW: 380, minH: 420 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['B', 'Brush'],
    ['E', 'Eraser'],
    ['L', 'Line'],
    ['R', 'Rectangle'],
    ['U', 'Rounded rectangle'],
    ['O', 'Ellipse'],
    ['P', 'Polygon (Enter or double-click to close)'],
    ['G', 'Fill'],
    ['D', 'Gradient'],
    ['T', 'Text'],
    ['M', 'Select'],
    ['I', 'Eyedropper'],
    ['H / Space', 'Pan'],
    ['[ / ]', 'Smaller / bigger brush'],
    ['Plus / - / 0', 'Zoom in / out / fit'],
    ['Mod+C / X / V', 'Copy, cut, paste the selection or a picture'],
    ['Mod+Z', 'Undo'],
    ['Mod+Shift+Z / Mod+Y', 'Redo'],
  ],

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, store, vfs, notify } = api;

    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion:reduce)').matches);
    const phone = () => document.body.classList.contains('is-mobile');

    /* ---------------- persisted prefs ---------------- */
    const saved = (store.get(PREF_KEY) && typeof store.get(PREF_KEY) === 'object') ? store.get(PREF_KEY) : {};
    const S = {
      tool: TOOLS.some(t => t.id === saved.tool) ? saved.tool : 'brush',
      color: normHex(saved.color) || '#111318',
      color2: normHex(saved.color2) || '#3b82f6',
      size: clamp(Number(saved.size) || 6, 1, MAX_SIZE),
      sizeKey: SIZES.some(s => s.key === saved.sizeKey) ? saved.sizeKey : 'md',
      recent: Array.isArray(saved.recent) ? saved.recent.map(normHex).filter(Boolean).slice(0, RECENT_CAP) : [],
      opacity: clamp(Number(saved.opacity) || 100, 5, 100),
      soft: clamp(Number(saved.soft) || 0, 0, 100),
      smooth: clamp(Number(saved.smooth) || 0, 0, 90),
      pressure: saved.pressure !== false,
      sym: K.SYMMETRY.some(s => s.id === saved.sym) ? saved.sym : 'off',
      filled: saved.filled === true,
      radius: clamp(Number(saved.radius) || 24, 0, 200),
      tol: clamp(saved.tol === undefined ? 42 : Number(saved.tol), 0, 200),
      grad: saved.grad === 'radial' ? 'radial' : 'linear',
      fade: saved.fade === true,
      font: FONTS.some(f => f[0] === saved.font) ? saved.font : 'sys',
      fsize: clamp(Number(saved.fsize) || 32, 8, 300),
      bold: saved.bold === true,
      grid: saved.grid === true,
      layers: saved.layers === undefined ? !phone() : saved.layers !== false,
    };

    const DPR = clamp(window.devicePixelRatio || 1, 1, 2);
    let dead = false, busy = false, touched = false;

    /* live doc geometry (set by setDoc) */
    let viewW = 0, viewH = 0, backW = 0, backH = 0, sx = 1, sy = 1;
    let Z = 1, fitMode = true;           /* screen px per logical px */

    /* history */
    const undo = [], redo = [];
    /* Draw together (see the header): the room, the shared stroke log, the base picture */
    const TG = { on: false, open: false, room: null, offs: [], me: 'h', log: D.makeLog(), redo: [], lamport: 0, n: 0, cur: null,
      base: null, pre: null, gotDoc: false, sentCanvas: false, img: null, imgDone: false, err: '', note: '', joinCode: '', rq: 0, flushT: 0, curT: 0, curPending: null, peerAt: null };

    /* ---------------- the picture: layers over a paper ---------------- */
    const layers = [];
    let ai = 0;                          /* the active layer */
    let paperOn = true;                  /* false: Transparent background */
    let layerSeq = 0, nameSeq = 0;
    let roomCv = null, roomCx = null;    /* in a room the picture is one opaque canvas */
    let mctx = null;                     /* where paint goes: the active layer, or the room canvas */
    const wetCv = document.createElement('canvas');   /* the stroke being drawn */
    const wetCx = wetCv.getContext('2d');
    let wet = null;                      /* { alpha } while there is something on it */
    let sel = null;                      /* the marquee, logical ints { x, y, w, h } */
    let flt = null;                      /* pasted pixels not yet put down { cv, x, y, before } */

    /* ---------------- DOM ---------------- */
    const main = h('canvas.pnt__canvas', { 'aria-hidden': 'true' });
    const overlay = h('canvas.pnt__overlay', { role: 'img', 'aria-label': 'Drawing area — draw with the mouse, touch or pen', tabindex: '0' });
    const gridEl = h('div.pnt__pgrid', { 'aria-hidden': 'true', hidden: true });
    const paper = h('div.pnt__paper', main, gridEl, overlay);
    const stage = h('div.pnt__stage', paper);
    const mainCx = main.getContext('2d', { willReadFrequently: true });
    const octx = overlay.getContext('2d');

    /* tools */
    const toolBtns = new Map();
    const seg = h('div.pnt__seg', { role: 'toolbar', 'aria-label': 'Tools' });
    for (const t of TOOLS) {
      const b = h('button.pnt__tool.tip', {
        type: 'button', 'aria-pressed': 'false',
        'aria-label': `${t.label} (${t.key})`, 'data-tip': `${t.label} · ${t.key}`,
        dataset: { tool: t.id },
        onclick: () => setTool(t.id),
      }, t.svg ? h('span.icon', { html: t.svg }) : icon(t.icon));
      toolBtns.set(t.id, b);
      seg.appendChild(b);
    }

    const sizeSel = h('select.pnt__sel', {
      'aria-label': 'Canvas size',
      onchange: e => setSizeKey(e.target.value),
    }, SIZES.map(s => h('option', { value: s.key, text: s.label })));
    sizeSel.value = S.sizeKey;

    const undoBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Undo', 'data-tip': 'Undo · Ctrl/⌘ Z', onclick: () => doUndo() }, icon('rotate-ccw'));
    const redoBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Redo', 'data-tip': 'Redo · Ctrl/⌘ ⇧ Z', onclick: () => doRedo() }, h('span.icon', { html: REDO_SVG }));
    const clearBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Clear canvas', 'data-tip': 'Clear', onclick: () => clearCanvas() }, icon('trash'));
    /* aria-disabled rather than disabled in a room, so a click can say why */
    const openBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Open an image onto the canvas', 'data-tip': 'Open image', onclick: () => onOpenClick() }, icon('image'));
    const saveBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Save PNG to Pictures', 'data-tip': 'Save to Pictures', onclick: () => saveToPictures() }, icon('save'));
    const copyBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Copy picture', 'data-tip': 'Copy picture', onclick: () => copyPicture() }, icon('copy'));
    const dlBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Download PNG', 'data-tip': 'Download', onclick: () => download() }, icon('download'));
    const imageBtn = h('button.btn.btn--sm.pnt__menubtn', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Image menu', onclick: () => imageMenu() }, h('span', { text: 'Image' }), icon('chevron-down'));
    const sendBtn = h('button.btn.btn--sm.pnt__menubtn', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Send to', onclick: () => sendMenu() }, h('span', { text: 'Send to' }), icon('chevron-down'));
    const layersBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Layers', 'aria-pressed': String(S.layers), 'data-tip': 'Layers', onclick: () => toggleLayers() }, icon('layers'));
    const tgBtn = h('button.btn.btn--sm.pnt__tgbtn', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => togglePanel() }, icon('users'), h('span', { text: 'Draw together' }));
    const acts = h('div.pnt__acts', undoBtn, redoBtn, clearBtn, h('div.pnt__div'), openBtn, saveBtn, copyBtn, dlBtn, h('div.pnt__div'), imageBtn, sendBtn, layersBtn, h('div.pnt__div'), tgBtn);

    const fileIn = h('input.pnt__native', { type: 'file', accept: 'image/*', 'aria-label': 'Open an image', tabindex: '-1', onchange: onFilePicked });

    const bar = h('div.pnt__bar',
      h('div.pnt__group', seg),
      h('div.pnt__group', sizeSel),
      h('div.pnt__spring'),
      h('div.pnt__group', acts),
      fileIn);

    /* ---- options for the tool in hand, and zoom ---- */
    const optEls = [];
    function opt(forTools, label, ...kids) {
      const el = h('label.pnt__opt', { dataset: { for: forTools } }, h('span.pnt__lbl', { text: label }), ...kids);
      optEls.push(el);
      return el;
    }
    function rangeOpt(forTools, label, min, max, get, set, fmt = v => String(v)) {
      const out = h('span.pnt__val');
      const inp = h('input.slider.pnt__oslider', {
        type: 'range', min: String(min), max: String(max), value: String(get()), 'aria-label': label,
        oninput: e => { set(Number(e.target.value)); out.textContent = fmt(get()); },
      });
      out.textContent = fmt(get());
      return { el: opt(forTools, label, inp, out), inp, out };
    }
    const O = {};
    O.opacity = rangeOpt('brush line rect rrect ellipse poly gradient text', 'Opacity', 5, 100, () => S.opacity, v => { S.opacity = v; savePrefsSoon(); }, v => v + '%');
    O.soft = rangeOpt('brush eraser', 'Soft edge', 0, 100, () => S.soft, v => { S.soft = v; savePrefsSoon(); }, v => v + '%');
    O.smooth = rangeOpt('brush', 'Smoothing', 0, 90, () => S.smooth, v => { S.smooth = v; savePrefsSoon(); }, v => (v ? v + '%' : 'off'));
    O.pressure = h('input', { type: 'checkbox', 'aria-label': 'Pen pressure', onchange: e => { S.pressure = e.target.checked; savePrefsSoon(); } });
    O.pressure.checked = S.pressure;
    const pressureOpt = opt('brush', 'Pen pressure', O.pressure);
    O.sym = h('select.pnt__osel', { 'aria-label': 'Symmetry', onchange: e => { S.sym = e.target.value; drawOverlay(); savePrefsSoon(); } },
      K.SYMMETRY.map(s => h('option', { value: s.id, text: s.label })));
    O.sym.value = S.sym;
    const symOpt = opt('brush eraser line rect rrect ellipse poly', 'Symmetry', O.sym);
    O.filled = h('select.pnt__osel', { 'aria-label': 'Shape style', onchange: e => { S.filled = e.target.value === 'filled'; savePrefsSoon(); } },
      h('option', { value: 'outline', text: 'Outline' }), h('option', { value: 'filled', text: 'Filled' }));
    O.filled.value = S.filled ? 'filled' : 'outline';
    const filledOpt = opt('rect rrect ellipse poly', 'Shape', O.filled);
    O.radius = rangeOpt('rrect', 'Corners', 0, 200, () => S.radius, v => { S.radius = v; savePrefsSoon(); }, v => String(v));
    O.tol = rangeOpt('fill', 'Tolerance', 0, 200, () => S.tol, v => { S.tol = v; savePrefsSoon(); }, v => String(v));
    O.grad = h('select.pnt__osel', { 'aria-label': 'Gradient shape', onchange: e => { S.grad = e.target.value; savePrefsSoon(); } },
      h('option', { value: 'linear', text: 'Linear' }), h('option', { value: 'radial', text: 'Radial' }));
    O.grad.value = S.grad;
    O.color2 = h('input.pnt__c2', { type: 'color', value: S.color2, 'aria-label': 'Gradient second colour', title: 'Second colour', oninput: e => { S.color2 = normHex(e.target.value) || S.color2; savePrefsSoon(); } });
    O.fade = h('input', { type: 'checkbox', 'aria-label': 'Fade to clear', onchange: e => { S.fade = e.target.checked; savePrefsSoon(); } });
    O.fade.checked = S.fade;
    const gradOpt = opt('gradient', 'Gradient', O.grad, O.color2, h('span.pnt__lbl', { text: 'fade out' }), O.fade);
    O.font = h('select.pnt__osel', { 'aria-label': 'Font', onchange: e => { S.font = e.target.value; loadFont(); restyleText(); savePrefsSoon(); } },
      FONTS.map(f => h('option', { value: f[0], text: f[1] })));
    O.font.value = S.font;
    O.fsize = h('input.pnt__num', { type: 'number', min: '8', max: '300', value: String(S.fsize), 'aria-label': 'Text size', onchange: e => { S.fsize = clamp(Math.round(Number(e.target.value) || 32), 8, 300); e.target.value = String(S.fsize); restyleText(); savePrefsSoon(); } });
    O.bold = h('input', { type: 'checkbox', 'aria-label': 'Bold', onchange: e => { S.bold = e.target.checked; loadFont(); restyleText(); savePrefsSoon(); } });
    O.bold.checked = S.bold;
    const textOpt = opt('text', 'Font', O.font, O.fsize, h('span.pnt__lbl', { text: 'bold' }), O.bold);
    const selOpt = opt('select', 'Selection',
      h('button.btn.btn--sm', { type: 'button', onclick: () => selectAll() }, h('span', { text: 'Select all' })),
      h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Copy selection', onclick: () => copySel(false) }, h('span', { text: 'Copy' })),
      h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Cut selection', onclick: () => copySel(true) }, h('span', { text: 'Cut' })),
      h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Delete selection', onclick: () => deleteSel() }, h('span', { text: 'Delete' })),
      h('span.pnt__hint', { text: 'Drag to select, drag inside to move. Paste with Ctrl/⌘ V.' }));
    const hint = h('span.pnt__hint.pnt__roomhint', { hidden: true });

    const zOut = h('button.ibtn', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out (−)', onclick: () => zoomBy(1 / 1.25) }, icon('zoom-out'));
    const zIn = h('button.ibtn', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => zoomBy(1.25) }, icon('zoom-in'));
    const zoomLbl = h('button.pnt__zlbl', { type: 'button', 'aria-label': 'Zoom to fit', title: 'Zoom to fit (0)', onclick: () => zoomFit() });
    const gridBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Pixel grid', 'aria-pressed': String(S.grid), 'data-tip': 'Pixel grid', onclick: () => { S.grid = !S.grid; gridBtn.setAttribute('aria-pressed', String(S.grid)); updateGrid(); savePrefsSoon(); } }, icon('grid'));
    const zoomGroup = h('div.pnt__group.pnt__zoom', zOut, zoomLbl, zIn, gridBtn);

    const optsBar = h('div.pnt__opts', { role: 'group', 'aria-label': 'Tool options' }, ...optEls, hint, h('div.pnt__spring'), zoomGroup);

    /* dock: colour + size */
    const nativeColor = h('input.pnt__native', { type: 'color', value: S.color, 'aria-hidden': 'true', tabindex: '-1', oninput: e => setColor(e.target.value, true) });
    const currentSw = h('button.pnt__current.tip', { type: 'button', 'aria-label': 'Current colour — click for a full picker', 'data-tip': 'Colour picker', onclick: () => nativeColor.click() });
    const hexIn = h('input.pnt__hex', {
      type: 'text', spellcheck: 'false', 'aria-label': 'Hex colour', maxlength: '7', value: S.color,
      onchange: e => { const n = normHex(e.target.value); if (n) setColor(n, true); else e.target.value = S.color; },
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
    });
    const swatches = h('div.pnt__swatches', PALETTE.map(c => h('button.pnt__sw', {
      type: 'button', 'aria-label': c, 'aria-pressed': 'false',
      style: { background: c }, dataset: { c }, onclick: () => setColor(c, true),
    })));
    const recentWrap = h('div.pnt__recent');

    const slider = h('input.slider.pnt__slider', {
      type: 'range', min: '1', max: String(MAX_SIZE), value: String(S.size), 'aria-label': 'Brush size',
      oninput: e => setSize(Number(e.target.value)),
    });
    const sizeVal = h('span.pnt__val', { text: String(S.size) });
    const dotInner = h('i');
    const dotPrev = h('div.pnt__dot', { 'aria-hidden': 'true' }, dotInner);
    const dimEl = h('span.pnt__dim');

    const dock = h('div.pnt__dock',
      h('div.pnt__block', currentSw, hexIn),
      h('div.pnt__block', h('span.pnt__lbl', { text: 'Palette' }), swatches),
      h('div.pnt__block', h('span.pnt__lbl', { text: 'Recent' }), recentWrap),
      h('div.pnt__block.pnt__size', h('span.pnt__lbl', { text: 'Size' }), slider, sizeVal, dotPrev),
      nativeColor, dimEl);

    /* ---- the layers panel ---- */
    const lyList = h('div.pnt-ly__list', { role: 'listbox', 'aria-label': 'Layers' });
    const lyOp = h('input.slider.pnt__oslider', { type: 'range', min: '0', max: '100', value: '100', 'aria-label': 'Layer opacity',
      oninput: e => layerOpacity(Number(e.target.value), false), onchange: e => layerOpacity(Number(e.target.value), true) });
    const lyOpVal = h('span.pnt__val', { text: '100%' });
    const lyNote = h('p.pnt-ly__note', { role: 'status', hidden: true, text: 'Layers are off while you draw together: everyone shares one picture of plain strokes. Leave the room to use them again — what you drew stays, as one layer.' });
    const lyBtn = (label, ic, fn) => h('button.ibtn.tip', { type: 'button', 'aria-label': label, 'data-tip': label, onclick: fn }, typeof ic === 'string' ? icon(ic) : h('span.icon', { html: ic.svg }));
    const lyBtns = {
      add: lyBtn('Add layer', 'plus', () => addLayer()),
      dup: lyBtn('Duplicate layer', 'copy', () => dupLayer()),
      del: lyBtn('Delete layer', 'trash', () => deleteLayer()),
      up: lyBtn('Move layer up', 'arrow-up', () => moveLayer(1)),
      down: lyBtn('Move layer down', 'arrow-down', () => moveLayer(-1)),
      merge: h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Merge layer down', onclick: () => mergeDown() }, h('span', { text: 'Merge down' })),
    };
    const lyPanel = h('aside.pnt-ly', { 'aria-label': 'Layers', hidden: !S.layers },
      h('div.pnt-ly__head', h('b', { text: 'Layers' }), h('div.pnt-ly__tools', lyBtns.add, lyBtns.dup, lyBtns.up, lyBtns.down, lyBtns.del)),
      lyNote, lyList,
      h('label.pnt-ly__op', h('span.pnt__lbl', { text: 'Opacity' }), lyOp, lyOpVal),
      lyBtns.merge);

    const body = h('div.pnt__body', stage, lyPanel);
    const pnt = h('div.pnt', bar, optsBar, body, dock);
    root.appendChild(h('div.app.app--col', pnt));

    const applyStill = () => pnt.classList.toggle('is-still', reduced());
    applyStill();
    const offReduce = store.sub('prefs.reduceMotion', applyStill);

    /* ---------------- doc geometry ---------------- */
    function prepCtx(cx) {
      cx.setTransform(sx, 0, 0, sy, 0, 0);
      cx.lineCap = 'round'; cx.lineJoin = 'round';
    }
    function mkLayer(name, cv) {
      const c = cv || K.blank(backW, backH);
      const L = { id: ++layerSeq, name, cv: c, cx: c.getContext('2d', { willReadFrequently: true }), vis: true, op: 1, url: null };
      prepCtx(L.cx);
      return L;
    }
    const retarget = () => { mctx = TG.on ? roomCx : layers[ai]?.cx || null; };
    function fillRoom() {
      roomCx.save(); roomCx.setTransform(1, 0, 0, 1, 0, 0);
      roomCx.fillStyle = PAPER; roomCx.fillRect(0, 0, backW, backH);
      roomCx.restore();
    }
    /* The size of the picture. Without `preserve` it starts again from one clear layer;
       with it every layer keeps what it had at the top left. */
    function setDoc(w, h2, o = {}) {
      const prev = o.preserve ? layers.slice() : null;
      viewW = w; viewH = h2;
      backW = Math.max(1, Math.round(w * DPR)); backH = Math.max(1, Math.round(h2 * DPR));
      sx = backW / viewW; sy = backH / viewH;
      main.width = backW; main.height = backH; overlay.width = backW; overlay.height = backH;
      wetCv.width = backW; wetCv.height = backH;
      prepCtx(octx); prepCtx(wetCx);
      layers.length = 0;
      if (prev) {
        for (const p of prev) {
          const L = mkLayer(p.name);
          L.vis = p.vis; L.op = p.op;
          L.cx.save(); L.cx.setTransform(1, 0, 0, 1, 0, 0); L.cx.drawImage(p.cv, 0, 0); L.cx.restore();
          layers.push(L);
        }
        ai = clamp(ai, 0, layers.length - 1);
      } else { layers.push(mkLayer(`Layer ${++nameSeq}`)); ai = 0; }
      wet = null; sel = null; flt = null;
      if (TG.on) {
        roomCv = K.blank(backW, backH);
        roomCx = roomCv.getContext('2d', { willReadFrequently: true });
        prepCtx(roomCx); fillRoom();
      }
      retarget();
      if (dimEl) dimEl.textContent = `${w} × ${h2}`;
      composite(); drawOverlay(); renderLayers();
    }
    function clearOverlay() {
      octx.save(); octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, backW, backH); octx.restore();
    }
    /* ---- zoom and pan ---- */
    function fitScale() {
      const availW = stage.clientWidth - 34, availH = stage.clientHeight - 34;
      if (availW <= 0 || availH <= 0 || !viewW) return Z;
      return Math.min(availW / viewW, availH / viewH, 1);
    }
    function applyZoom() {
      paper.style.width = Math.max(1, viewW * Z) + 'px';
      paper.style.height = Math.max(1, viewH * Z) + 'px';
      zoomLbl.textContent = Math.round(Z * 100) + '%';
      main.classList.toggle('is-zoomed', Z >= 3);
      updateGrid(); drawOverlay(); restyleText();
    }
    /* back to the fit-to-window scale when in fit mode (the window or the picture changed size) */
    function fitCanvas() {
      if (fitMode) Z = fitScale();
      applyZoom();
    }
    function zoomFit() { fitMode = true; fitCanvas(); }
    function setZoom(z, at) {
      z = clamp(z, 0.1, 32);
      if (Math.abs(z - Z) < 1e-6) return;
      let docPt = null;
      if (at) { const r = paper.getBoundingClientRect(); docPt = { x: (at.x - r.left) / Z, y: (at.y - r.top) / Z }; }
      else { const r = stage.getBoundingClientRect(), p = paper.getBoundingClientRect(); docPt = { x: (r.left + r.width / 2 - p.left) / Z, y: (r.top + r.height / 2 - p.top) / Z }; at = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      fitMode = false; Z = z; applyZoom();
      const r2 = paper.getBoundingClientRect();
      stage.scrollLeft += (r2.left + docPt.x * Z) - at.x;
      stage.scrollTop += (r2.top + docPt.y * Z) - at.y;
    }
    function zoomBy(f, at) { setZoom(Z * f, at); }
    /* a 1px grid, one cell per picture pixel, once cells are big enough to see */
    function updateGrid() {
      const show = S.grid && Z >= 4;
      gridEl.hidden = !show;
      if (show) gridEl.style.backgroundSize = `${Z}px ${Z}px`;
      gridBtn.classList.toggle('is-dim', S.grid && !show);
    }

    /* ---------------- the flattened picture ---------------- */
    function drawExtras(g, op) {
      if (op <= 0) return;
      if (wet) {
        g.globalAlpha = wet.alpha * op;
        g.drawImage(wetCv, 0, 0);
      }
      if (flt) {
        g.globalAlpha = op;
        g.drawImage(flt.cv, Math.round(flt.x * sx), Math.round(flt.y * sy));
      }
      g.globalAlpha = 1;
    }
    function composite() {
      if (!backW) return;
      const g = mainCx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, backW, backH);
      if (TG.on) {
        g.fillStyle = PAPER; g.fillRect(0, 0, backW, backH);
        g.drawImage(roomCv, 0, 0);
        drawExtras(g, 1);
        return;
      }
      if (paperOn) { g.fillStyle = PAPER; g.fillRect(0, 0, backW, backH); }
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        if (L.vis) { g.globalAlpha = L.op; g.drawImage(L.cv, 0, 0); g.globalAlpha = 1; }
        if (i === ai) drawExtras(g, L.vis ? L.op : 0);
      }
    }
    let compQ = 0;
    const compositeSoon = () => { if (!compQ) compQ = requestAnimationFrame(() => { compQ = 0; if (!dead) composite(); }); };
    const flushComposite = () => { if (compQ) { cancelAnimationFrame(compQ); compQ = 0; } composite(); };
    main.classList.toggle('is-clear', !paperOn);

    function wetBegin(alpha) { wet = { alpha }; wetCx.save(); wetCx.setTransform(1, 0, 0, 1, 0, 0); wetCx.clearRect(0, 0, backW, backH); wetCx.restore(); }
    function wetClear() { if (!wet) return; wet = null; wetCx.save(); wetCx.setTransform(1, 0, 0, 1, 0, 0); wetCx.clearRect(0, 0, backW, backH); wetCx.restore(); }
    /* the stroke on the wet canvas goes into the layer (or the room's picture) */
    function wetFlush() {
      if (!wet) return;
      const g = mctx;
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = wet.alpha; g.drawImage(wetCv, 0, 0);
      g.restore();
      wetClear();
    }

    /* ---------------- history ---------------- */
    const layerUrl = L => L.url || (L.url = L.cv.toDataURL('image/png'));
    const dirty = L => { if (L) L.url = null; };
    const dirtyAll = () => layers.forEach(dirty);
    /* the whole picture as data: one PNG per layer (reused while a layer is unchanged) */
    function snapEntry() {
      if (TG.on) return { w: viewW, h: viewH, paper: true, ai: 0, layers: [{ n: 'Layer 1', v: 1, o: 1, url: roomCv.toDataURL('image/png') }] };
      return { w: viewW, h: viewH, paper: paperOn, ai, layers: layers.map(L => ({ n: L.name, v: L.vis ? 1 : 0, o: L.op, url: layerUrl(L) })) };
    }
    /* put a snapshot (or a drawing saved before layers existed) back as the picture */
    async function loadDoc(e) {
      const list = Array.isArray(e.layers) ? e.layers : [{ n: 'Layer 1', v: 1, o: 1, url: e.url }];
      const imgs = await Promise.all(list.map(l => loadImg(l.url)));
      if (dead) return;
      setDoc(e.w, e.h);
      layers.length = 0;
      list.forEach((l, i) => {
        const L = mkLayer(String(l.n || `Layer ${i + 1}`).slice(0, 40));
        L.vis = l.v !== 0 && l.v !== false; L.op = clamp(Number(l.o) || (l.o === 0 ? 0 : 1), 0, 1);
        if (imgs[i]) { L.cx.save(); L.cx.setTransform(1, 0, 0, 1, 0, 0); L.cx.drawImage(imgs[i], 0, 0, backW, backH); L.cx.restore(); L.url = l.url; }
        layers.push(L);
      });
      if (!layers.length) layers.push(mkLayer('Layer 1'));
      nameSeq = Math.max(nameSeq, layers.length);
      ai = clamp(Number.isInteger(e.ai) ? e.ai : layers.length - 1, 0, layers.length - 1);
      paperOn = e.paper !== false;
      main.classList.toggle('is-clear', !paperOn);
      retarget(); syncSizeSel(); fitCanvas(); flushComposite(); renderLayers();
    }
    function commit(before) {
      touched = true;
      if (!TG.on) dirty(layers[ai]);
      if (TG.on) { updateHistory(); persistSoon(); composite(); return; }     /* in a room, undo works on strokes instead */
      undo.push(before); if (undo.length > HISTORY_CAP) undo.shift();
      redo.length = 0;
      updateHistory(); persistSoon(); renderLayers(); flushComposite();
    }
    function updateHistory() {
      if (TG.on) {
        undoBtn.disabled = !TG.log.list.some(st => st.a === TG.me && !st.undone);
        redoBtn.disabled = !TG.redo.length;
        return;
      }
      undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length;
    }
    async function doUndo() {
      if (TG.on) { tgUndo(); return; }
      settleTools();
      if (busy || !undo.length) return;
      busy = true; pnt.classList.add('is-busy');
      redo.push(snapEntry()); if (redo.length > HISTORY_CAP) redo.shift();
      await loadDoc(undo.pop());
      busy = false; pnt.classList.remove('is-busy');
      updateHistory(); persistSoon();
    }
    async function doRedo() {
      if (TG.on) { tgRedo(); return; }
      settleTools();
      if (busy || !redo.length) return;
      busy = true; pnt.classList.add('is-busy');
      undo.push(snapEntry()); if (undo.length > HISTORY_CAP) undo.shift();
      await loadDoc(redo.pop());
      busy = false; pnt.classList.remove('is-busy');
      updateHistory(); persistSoon();
    }
    function syncSizeSel() {
      const m = SIZES.find(s => s.w === viewW && s.h === viewH);
      let custom = sizeSel.querySelector('option[value="custom"]');
      if (m) { S.sizeKey = m.key; sizeSel.value = m.key; custom?.remove(); }
      else {
        if (!custom) { custom = h('option', { value: 'custom' }); sizeSel.appendChild(custom); }
        custom.textContent = `${viewW} × ${viewH}`;
        sizeSel.value = 'custom';
      }
    }
    /* anything half-done (typed text, a pasted picture, a polygon) is put down before the picture changes */
    function settleTools() {
      commitText(); commitFloat(); cancelPoly();
    }

    /* ---------------- tools / colour / size ---------------- */
    function setTool(id) {
      if (!TOOLS.some(t => t.id === id)) return;
      if (TG.on && !ROOM_TOOLS.has(id)) { say('Not in a Draw Together room', ROOM_WHY.replace('Not in a Draw Together room — ', '')); return; }
      if (id !== S.tool) { commitText(); commitFloat(); cancelPoly(); }
      S.tool = id;
      for (const [tid, b] of toolBtns) b.setAttribute('aria-pressed', String(tid === id));
      overlay.dataset.tool = id;
      for (const el of optEls) el.hidden = !el.dataset.for.split(' ').includes(id);
      applyRoomLocks();
      drawOverlay();
      savePrefsSoon();
    }
    function setColor(c, user) {
      const n = normHex(c); if (!n) return;
      S.color = n;
      currentSw.style.background = n;
      if (hexIn.value.toLowerCase() !== n) hexIn.value = n;
      try { nativeColor.value = n; } catch (e) { /* some engines reject non #rrggbb — already normalised */ }
      for (const b of swatches.children) b.setAttribute('aria-pressed', String((b.dataset.c || '').toLowerCase() === n));
      if (user) pushRecent(n);
      restyleText();
      savePrefsSoon();
    }
    function pushRecent(c) {
      const next = [c, ...S.recent.filter(x => x !== c)].slice(0, RECENT_CAP);
      S.recent = next; renderRecents(); savePrefsSoon();
    }
    function renderRecents() {
      while (recentWrap.firstChild) recentWrap.removeChild(recentWrap.firstChild);
      if (!S.recent.length) { recentWrap.appendChild(h('span.pnt__none', { text: 'none yet' })); return; }
      for (const c of S.recent) {
        recentWrap.appendChild(h('button.pnt__sw', {
          type: 'button', 'aria-label': c, style: { background: c }, dataset: { c },
          onclick: () => setColor(c, true),
        }));
      }
    }
    function setSize(n) {
      S.size = clamp(Math.round(n), 1, MAX_SIZE);
      if (Number(slider.value) !== S.size) slider.value = String(S.size);
      sizeVal.textContent = String(S.size);
      const d = clamp(S.size, 2, 26);
      dotInner.style.width = d + 'px'; dotInner.style.height = d + 'px';
      savePrefsSoon();
    }
    function setSizeKey(key) {
      const s = SIZES.find(x => x.key === key); if (!s) { syncSizeSel(); return; }
      if (s.w === viewW && s.h === viewH) { S.sizeKey = key; savePrefsSoon(); return; }
      settleTools();
      const before = snapEntry();
      setDoc(s.w, s.h, { preserve: true });
      dirtyAll();
      S.sizeKey = key;
      syncSizeSel();
      commit(before); fitCanvas(); savePrefsSoon();
    }
    const say = (title, message, extra = {}) => notify({ app: 'Static Paint', icon: 'info', title, message, ...extra });

    let prefTimer = 0;
    const prefsNow = () => ({
      tool: S.tool, color: S.color, color2: S.color2, size: S.size, sizeKey: S.sizeKey, recent: S.recent.slice(),
      opacity: S.opacity, soft: S.soft, smooth: S.smooth, pressure: S.pressure, sym: S.sym, filled: S.filled, radius: S.radius,
      tol: S.tol, grad: S.grad, fade: S.fade, font: S.font, fsize: S.fsize, bold: S.bold, grid: S.grid, layers: S.layers,
    });
    function savePrefsSoon() {
      clearTimeout(prefTimer);
      prefTimer = setTimeout(() => {
        prefTimer = 0;
        store.set(PREF_KEY, prefsNow());
      }, 350);
    }

    /* ---------------- persistence of the drawing ---------------- */
    let persistTimer = 0;
    function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 800); }
    async function persistNow() {
      persistTimer = 0;
      try {
        const e = snapEntry();
        if (e.layers.reduce((n, l) => n + l.url.length, 0) > PERSIST_MAX) return;   /* too big to keep — a reload will start fresh */
        await misc.set(DOC_KEY, { v: 2, ...e, at: Date.now() });
      } catch (err) { /* store unavailable — drawing still works this session */ }
    }

    /* ---------------- layers ---------------- */
    const layerBusy = () => TG.on || busy;
    function selectLayer(i) {
      if (TG.on || i === ai || !layers[i]) return;
      settleTools();
      ai = i; retarget(); renderLayers(); composite();
    }
    function addLayer() {
      if (layerBusy()) return;
      if (layers.length >= MAX_LAYERS) { say('That’s the most layers', `A picture holds up to ${MAX_LAYERS} layers here — merge a couple first.`); return; }
      settleTools();
      const before = snapEntry();
      layers.splice(ai + 1, 0, mkLayer(`Layer ${++nameSeq}`));
      ai += 1; retarget();
      commit(before);
    }
    function dupLayer() {
      if (layerBusy()) return;
      if (layers.length >= MAX_LAYERS) { say('That’s the most layers', `A picture holds up to ${MAX_LAYERS} layers here — merge a couple first.`); return; }
      settleTools();
      const before = snapEntry();
      const src = layers[ai];
      const L = mkLayer(`${src.name} copy`.slice(0, 40));
      L.vis = src.vis; L.op = src.op;
      L.cx.save(); L.cx.setTransform(1, 0, 0, 1, 0, 0); L.cx.drawImage(src.cv, 0, 0); L.cx.restore();
      layers.splice(ai + 1, 0, L); ai += 1; retarget();
      commit(before);
    }
    function deleteLayer() {
      if (layerBusy() || layers.length < 2) return;
      settleTools();
      const before = snapEntry();
      layers.splice(ai, 1);
      ai = clamp(ai - 1, 0, layers.length - 1); retarget();
      commit(before);
    }
    function moveLayer(dir) {
      if (layerBusy()) return;
      const j = ai + dir;
      if (j < 0 || j >= layers.length) return;
      settleTools();
      const before = snapEntry();
      [layers[ai], layers[j]] = [layers[j], layers[ai]];
      ai = j; retarget();
      commit(before);
    }
    function mergeDown() {
      if (layerBusy() || ai < 1) return;
      settleTools();
      const before = snapEntry();
      const top = layers[ai], low = layers[ai - 1];
      if (top.vis) {
        low.cx.save(); low.cx.setTransform(1, 0, 0, 1, 0, 0);
        low.cx.globalAlpha = top.op; low.cx.drawImage(top.cv, 0, 0);
        low.cx.restore();
      }
      dirty(low);
      layers.splice(ai, 1); ai -= 1; retarget();
      commit(before);
    }
    function toggleVis(i) {
      if (layerBusy() || !layers[i]) return;
      settleTools();
      const before = snapEntry();
      layers[i].vis = !layers[i].vis;
      commit(before);
    }
    function renameLayer(i, name) {
      const L = layers[i]; const nm = String(name || '').trim().slice(0, 40);
      if (!L || !nm || nm === L.name) { renderLayers(); return; }
      const before = snapEntry();
      L.name = nm;
      commit(before);
    }
    let opBefore = null;
    function layerOpacity(pct, done) {
      if (layerBusy()) return;
      const L = layers[ai]; if (!L) return;
      if (!opBefore) opBefore = snapEntry();
      L.op = clamp(pct / 100, 0, 1);
      lyOpVal.textContent = Math.round(L.op * 100) + '%';
      if (done) { const b = opBefore; opBefore = null; if (b.layers[ai] && Math.abs(b.layers[ai].o - L.op) > 1e-6) commit(b); }
      else flushComposite();
    }
    function toggleLayers(force) {
      S.layers = typeof force === 'boolean' ? force : !S.layers;
      lyPanel.hidden = !S.layers;
      layersBtn.setAttribute('aria-pressed', String(S.layers));
      if (S.layers) renderLayers();
      fitCanvas(); savePrefsSoon();
    }
    function renderLayers() {
      if (dead || !S.layers) { return; }
      lyNote.hidden = !TG.on;
      for (const b of Object.values(lyBtns)) b.disabled = TG.on;
      lyOp.disabled = TG.on;
      lyBtns.del.disabled = TG.on || layers.length < 2;
      lyBtns.up.disabled = TG.on || ai >= layers.length - 1;
      lyBtns.down.disabled = TG.on || ai < 1;
      lyBtns.merge.disabled = TG.on || ai < 1;
      lyBtns.add.disabled = lyBtns.dup.disabled = TG.on;
      const cur = layers[ai];
      lyOp.value = String(Math.round((cur?.op ?? 1) * 100));
      lyOpVal.textContent = Math.round((cur?.op ?? 1) * 100) + '%';
      const rows = [];
      for (let i = layers.length - 1; i >= 0; i--) {
        const L = layers[i];
        const th = K.blank(34, 26);
        const g = th.getContext('2d');
        const k = Math.min(34 / L.cv.width, 26 / L.cv.height);
        g.fillStyle = '#fff'; g.fillRect(0, 0, 34, 26);
        g.drawImage(L.cv, 0, 0, L.cv.width * k, L.cv.height * k);
        th.className = 'pnt-ly__thumb';
        const nameEl = h('span.pnt-ly__name', { text: L.name, title: 'Double-click to rename', ondblclick: e => { e.stopPropagation(); startRename(i, nameEl); } });
        rows.push(h('div.pnt-ly__row' + (i === ai ? '.is-active' : '') + (L.vis ? '' : '.is-hidden'), {
          role: 'option', 'aria-selected': String(i === ai), tabindex: '0', dataset: { layer: String(i) },
          onclick: () => selectLayer(i),
          onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLayer(i); } },
        },
        h('button.ibtn.pnt-ly__eye', { type: 'button', 'aria-label': `${L.vis ? 'Hide' : 'Show'} ${L.name}`, 'aria-pressed': String(L.vis), onclick: e => { e.stopPropagation(); toggleVis(i); } }, icon(L.vis ? 'eye' : 'eye-off')),
        th, nameEl));
      }
      lyList.replaceChildren(...rows);
    }
    function startRename(i, el) {
      const inp = h('input.pnt-ly__rename', { type: 'text', maxlength: '40', value: layers[i].name, 'aria-label': 'Layer name',
        onclick: e => e.stopPropagation(),
        onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); else if (e.key === 'Escape') { inp.value = layers[i].name; inp.blur(); } },
        onblur: () => renameLayer(i, inp.value) });
      el.replaceWith(inp);
      inp.focus(); inp.select();
    }

    /* ---------------- drawing ---------------- */
    const pos = e => {
      const r = main.getBoundingClientRect();
      return {
        x: clamp((e.clientX - r.left) / r.width * viewW, 0, viewW),
        y: clamp((e.clientY - r.top) / r.height * viewH, 0, viewH),
      };
    };
    const dev = (x, y) => ({ x: clamp(Math.round(x * sx), 0, backW - 1), y: clamp(Math.round(y * sy), 0, backH - 1) });
    /* a brush dab, and a piece of stroke from a to b — repeated for each symmetry transform */
    function inkDot(cx, p, w, color, hard, mats) {
      for (const m of mats) {
        cx.save(); cx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        if (hard >= 100) { cx.fillStyle = color; cx.beginPath(); cx.arc(p.x, p.y, Math.max(0.4, w / 2), 0, Math.PI * 2); cx.fill(); }
        else cx.drawImage(K.softSprite(color, Math.max(2, w * sx), hard), p.x - w / 2, p.y - w / 2, w, w);
        cx.restore();
      }
    }
    function inkSeg(cx, a, b, w, color, hard, mats) {
      for (const m of mats) {
        cx.save(); cx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        if (hard >= 100) {
          cx.strokeStyle = color; cx.lineWidth = w;
          cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
        } else {
          const sp = K.softSprite(color, Math.max(2, w * sx), hard);
          const dist = Math.hypot(b.x - a.x, b.y - a.y), step = Math.max(0.5, w * 0.12);
          const n = Math.max(1, Math.ceil(dist / step));
          for (let i = 1; i <= n; i++) {
            const t = i / n;
            cx.drawImage(sp, a.x + (b.x - a.x) * t - w / 2, a.y + (b.y - a.y) * t - w / 2, w, w);
          }
        }
        cx.restore();
      }
    }

    function floodFill(px, py, hex, tol = 42) {
      const W = backW, H = backH;
      if (!TG.on) flushComposite();
      const sctx = TG.on ? roomCx : mainCx;                 /* what you see decides the region ... */
      const sImg = sctx.getImageData(0, 0, W, H);
      const d = sImg.data;
      const si = (py * W + px) * 4;
      const { r, g, b } = hexToRgb(hex);
      if (d[si] === r && d[si + 1] === g && d[si + 2] === b && d[si + 3] === 255) return false;
      const mask = K.floodMask(d, W, H, px, py, TG.on ? 42 : tol);
      const wImg = TG.on ? sImg : mctx.getImageData(0, 0, W, H);   /* ... and the active layer takes the colour */
      const wd = wImg.data;
      for (let p = 0, n = W * H; p < n; p++) {
        if (!mask[p]) continue;
        const i = p * 4;
        wd[i] = r; wd[i + 1] = g; wd[i + 2] = b; wd[i + 3] = 255;
      }
      mctx.putImageData(wImg, 0, 0);
      return true;
    }
    function pickAt(x, y) {
      flushComposite();
      const p = dev(x, y);
      const d = mainCx.getImageData(p.x, p.y, 1, 1).data;
      return d[3] ? rgbToHex(d[0], d[1], d[2]) : null;
    }

    /* what the brush looks like right now (in a room: plain, so the log can replay it) */
    const plain = () => ({ alpha: 1, hard: 100, mats: [ID], press: false, smooth: 0, filled: false, radius: 0 });
    const brushOpts = () => TG.on ? plain() : {
      alpha: S.opacity / 100, hard: 100 - S.soft, mats: K.symMatrices(S.sym, viewW, viewH),
      press: S.pressure, smooth: S.smooth, filled: S.filled, radius: S.radius,
    };

    /* pointer interaction */
    let drawing = null;   /* { tool, start, last, before, moved, ... } */
    let pan = null;
    let spaceDown = false;
    let poly = null;      /* { pts, hover, before } */
    let textEd = null;    /* { ta, x, y } */

    function layerOk() {
      if (TG.on) return true;
      const L = layers[ai];
      if (L && L.vis) return true;
      say('That layer is hidden', 'Show the layer (the eye next to it) to draw on it.');
      return false;
    }
    function onDown(e) {
      if (busy) return;
      if (e.button === 2) return;
      if (TG.on && !TG.gotDoc) return;                       /* joining: the friend's canvas is on its way */
      try { overlay.setPointerCapture?.(e.pointerId); } catch (err) { /* synthetic pointer */ }
      if (S.tool === 'hand' || e.button === 1 || spaceDown) {
        pan = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop, pid: e.pointerId };
        overlay.classList.add('is-panning');
        e.preventDefault();
        return;
      }
      const p = pos(e);
      if (S.tool !== 'text') commitText();
      if (flt && !(S.tool === 'select' && inRect({ x: flt.x, y: flt.y, w: flt.cv.width / sx, h: flt.cv.height / sy }, p))) commitFloat();

      if (S.tool === 'eyedropper') { const c = pickAt(p.x, p.y); if (c) setColor(c, true); e.preventDefault(); return; }
      if (S.tool === 'select') { selectDown(e, p); return; }
      if (!layerOk()) return;
      if (S.tool === 'fill') {
        const before = TG.on ? null : snapEntry();
        const d = dev(p.x, p.y);
        if (floodFill(d.x, d.y, S.color, S.tol)) { if (TG.on) tgStroke('fill', [p.x, p.y]); commit(before); }
        e.preventDefault();
        return;
      }
      if (S.tool === 'text') { startText(p); e.preventDefault(); return; }
      if (S.tool === 'poly') { polyDown(e, p); return; }

      const o = brushOpts();
      const before = TG.on ? null : snapEntry();
      drawing = { tool: S.tool, start: p, last: p, raw: p, before, moved: false, o, pid: e.pointerId, pr: K.pressureOf(e), erase: S.tool === 'eraser' };
      if (S.tool === 'brush' || S.tool === 'eraser') {
        const w = widthFor(drawing);
        if (drawing.erase) {
          dirty(layers[ai]);
          if (TG.on) { roomCx.fillStyle = PAPER; inkDot(roomCx, p, w, PAPER, o.hard, [ID]); }
          else { mctx.save(); mctx.globalCompositeOperation = 'destination-out'; inkDot(mctx, p, w, '#000000', o.hard, o.mats); mctx.restore(); }
        } else {
          wetBegin(o.alpha);
          inkDot(wetCx, p, w, S.color, o.hard, o.mats);
        }
        if (TG.on) tgBegin(p);
        compositeSoon();
      } else if (S.tool === 'gradient') {
        wetBegin(o.alpha);
      }
      e.preventDefault();
    }
    const widthFor = dr => Math.max(1, dr.o.press ? S.size * (0.15 + 0.85 * dr.pr) : S.size);
    function feedStroke(dr, p, pressure) {
      const k = dr.o.smooth ? Math.max(0.06, 1 - (dr.o.smooth / 100) * 0.94) : 1;
      const np = k >= 1 ? p : { x: dr.last.x + (p.x - dr.last.x) * k, y: dr.last.y + (p.y - dr.last.y) * k };
      if (dr.o.press) dr.pr += (pressure - dr.pr) * 0.5;
      const w = widthFor(dr);
      if (Math.hypot(np.x - dr.last.x, np.y - dr.last.y) < 0.05) return;
      if (dr.erase) {
        if (TG.on) inkSeg(roomCx, dr.last, np, w, PAPER, dr.o.hard, [ID]);
        else { mctx.save(); mctx.globalCompositeOperation = 'destination-out'; inkSeg(mctx, dr.last, np, w, '#000000', dr.o.hard, dr.o.mats); mctx.restore(); }
      } else inkSeg(wetCx, dr.last, np, w, S.color, dr.o.hard, dr.o.mats);
      dr.last = np;
    }
    function previewShape(dr, p) {
      wetBegin(dr.o.alpha);
      if (dr.tool === 'gradient') { paintGradient(wetCx, dr.start, p); }
      else drawShape(wetCx, dr.tool, dr.start, p, S.color, S.size, { mats: dr.o.mats, filled: dr.o.filled, radius: dr.o.radius });
      compositeSoon();
    }
    function onMove(e) {
      if (pan) {
        if (e.pointerId !== pan.pid) return;
        stage.scrollLeft = pan.l - (e.clientX - pan.x);
        stage.scrollTop = pan.t - (e.clientY - pan.y);
        return;
      }
      if (TG.on) tgCursor(pos(e));
      if (poly && !drawing) { poly.hover = pos(e); polyPreview(); return; }
      if (!drawing) return;
      if (e.pointerId !== drawing.pid) return;
      const dr = drawing;
      if (dr.tool === 'select') { selectMove(e); return; }
      const p = pos(e);
      dr.moved = true; dr.raw = p;
      if (dr.tool === 'brush' || dr.tool === 'eraser') {
        const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
        const list = evs && evs.length ? evs : [e];
        for (const ev of list) feedStroke(dr, pos(ev), K.pressureOf(ev));
        if (TG.on) tgPoint(p);
        compositeSoon();
      } else {
        previewShape(dr, p);
      }
      e.preventDefault();
    }
    function onUp(e) {
      if (pan) { if (e.pointerId === pan.pid) { pan = null; overlay.classList.remove('is-panning'); } return; }
      if (!drawing) return;
      const dr = drawing;
      if (dr.tool === 'select') { drawing = null; selectUp(e, dr); return; }
      if (poly) return;
      drawing = null;
      const p = pos(e);
      if (dr.tool === 'brush' || dr.tool === 'eraser') {
        if (dr.o.smooth) feedStroke({ ...dr, o: { ...dr.o, smooth: 0 } }, p, dr.pr);
        if (!dr.erase) wetFlush();
        if (TG.on) tgEnd();
      } else if (dr.tool === 'gradient') {
        previewShape(dr, p);
        if (Math.hypot(p.x - dr.start.x, p.y - dr.start.y) < 2) { wetClear(); flushComposite(); try { overlay.releasePointerCapture?.(e.pointerId); } catch (err) { /* not captured */ } return; }
        wetFlush();
      } else {                                            /* line, rect, rrect, ellipse */
        previewShape(dr, p);
        wetFlush();
        if (TG.on) tgStroke(dr.tool, [dr.start.x, dr.start.y, p.x, p.y]);
      }
      if (!dr.erase && dr.tool !== 'gradient') pushRecent(S.color);
      commit(dr.before);
      try { overlay.releasePointerCapture?.(e.pointerId); } catch (err) { /* not captured */ }
    }
    function onCancel(e) {
      if (pan) { pan = null; overlay.classList.remove('is-panning'); return; }
      if (!drawing) return;
      const dr = drawing; drawing = null;
      if (dr.tool === 'select') { selectUp(e, dr, true); return; }
      if (dr.tool === 'brush' || dr.tool === 'eraser') {
        if (!dr.erase) wetFlush();
        if (TG.on) tgEnd();
        commit(dr.before);                   /* freehand ink is already on the canvas */
      } else { wetClear(); flushComposite(); }   /* nothing committed to the drawing yet — just drop the preview */
    }
    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onCancel);
    overlay.addEventListener('contextmenu', e => e.preventDefault());
    const onDbl = () => { if (poly && poly.pts.length >= 3) polyClose(); };   /* the second click of a double-click adds no corner (same spot) */
    overlay.addEventListener('dblclick', onDbl);
    const onLeaveCanvas = () => { if (TG.on) tgCursor(null); };
    overlay.addEventListener('pointerleave', onLeaveCanvas);
    /* ⌘/Ctrl + wheel (and a trackpad pinch) zooms about the pointer */
    const onWheel = e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), { x: e.clientX, y: e.clientY });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });

    /* ---- gradient ---- */
    function paintGradient(cx, a, b) {
      const { r, g, b: bl } = hexToRgb(S.color);
      const c2 = S.fade ? `rgba(${r},${g},${bl},0)` : S.color2;
      const R = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const gr = S.grad === 'radial' ? cx.createRadialGradient(a.x, a.y, 0, a.x, a.y, R) : cx.createLinearGradient(a.x, a.y, b.x, b.y);
      gr.addColorStop(0, S.color); gr.addColorStop(1, c2);
      cx.save();
      if (sel) { cx.beginPath(); cx.rect(sel.x, sel.y, sel.w, sel.h); cx.clip(); }
      cx.fillStyle = gr; cx.fillRect(0, 0, viewW, viewH);
      cx.restore();
    }

    /* ---- polygon: click corners, double-click or Enter to close ---- */
    function polyPreview() {
      if (!poly) return;
      const o = brushOpts();
      wetBegin(o.alpha);
      const pts = poly.hover ? [...poly.pts, poly.hover] : poly.pts;
      drawPoly(wetCx, pts, false, S.color, S.size, { mats: o.mats });
      /* corner marks, so the first one can be seen and clicked to close */
      wetCx.save(); wetCx.fillStyle = S.color;
      for (const q of poly.pts) { wetCx.beginPath(); wetCx.arc(q.x, q.y, Math.max(2, S.size / 2 + 1) , 0, Math.PI * 2); wetCx.fill(); }
      wetCx.restore();
      compositeSoon();
    }
    function polyDown(e, p) {
      e.preventDefault();
      if (!poly) poly = { pts: [], hover: null, before: TG.on ? null : snapEntry() };
      const first = poly.pts[0];
      const near = first && poly.pts.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) * Z < 9;
      if (near) { polyClose(); return; }
      const last = poly.pts[poly.pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) poly.pts.push(p);
      polyPreview();
    }
    function polyClose() {
      if (!poly) return;
      const pg = poly; poly = null;
      wetClear();
      if (pg.pts.length < 2) { flushComposite(); return; }
      const o = brushOpts();
      wetBegin(o.alpha);
      drawPoly(wetCx, pg.pts, pg.pts.length >= 3, S.color, S.size, { mats: o.mats, filled: o.filled });
      wetFlush();
      pushRecent(S.color);
      commit(pg.before);
    }
    function cancelPoly() {
      if (!poly) return;
      poly = null; wetClear(); flushComposite();
    }

    /* ---- text: typed into a box over the picture, then drawn into the layer as pixels ---- */
    const fontDef = () => FONTS.find(f => f[0] === S.font) || FONTS[0];
    const fontCss = px => `${S.bold ? '700 ' : ''}${px}px ${fontDef()[2]}`;
    function loadFont() { try { document.fonts?.load?.(fontCss(S.fsize), 'Aa').catch(() => {}); } catch (err) { /* the fallback draws */ } }
    function startText(p) {
      commitText();
      loadFont();
      const ta = h('textarea.pnt__text', {
        rows: 1, spellcheck: 'false', autocomplete: 'off', wrap: 'off',
        'aria-label': 'Text to draw — Enter places it, Shift+Enter starts a new line, Escape cancels',
        oninput: () => restyleText(),
        onkeydown: e => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
        },
        onblur: () => { if (textEd && textEd.ta === ta) commitText(); },
        onpointerdown: e => e.stopPropagation(),
      });
      textEd = { ta, x: p.x, y: p.y };
      paper.appendChild(ta);
      restyleText();
      ta.focus({ preventScroll: true });
    }
    function restyleText() {
      const t = textEd; if (!t) return;
      const lines = t.ta.value.split('\n');
      const c = restyleText.m || (restyleText.m = document.createElement('canvas').getContext('2d'));
      c.font = fontCss(S.fsize * Z);
      const wpx = Math.max(...lines.map(l => c.measureText(l || ' ').width));
      Object.assign(t.ta.style, {
        left: `${t.x * Z}px`, top: `${t.y * Z}px`, font: fontCss(S.fsize * Z), lineHeight: String(LINE_H), color: S.color,
        width: `${Math.max(S.fsize * Z * 2, wpx + S.fsize * Z)}px`, height: `${lines.length * S.fsize * Z * LINE_H + 2}px`,
        opacity: String(S.opacity / 100),
      });
    }
    function cancelText() {
      const t = textEd; if (!t) return;
      textEd = null; t.ta.remove();
      overlay.focus({ preventScroll: true });
    }
    function commitText() {
      const t = textEd; if (!t) return;
      textEd = null;
      const txt = t.ta.value.replace(/\s+$/, '');
      t.ta.remove();
      if (!txt.trim() || TG.on || !layers[ai]?.vis) return;
      const before = snapEntry();
      const g = mctx, px = S.fsize;
      g.save();
      g.globalAlpha = S.opacity / 100;
      g.fillStyle = S.color; g.font = fontCss(px); g.textBaseline = 'top';
      txt.split('\n').forEach((l, i) => g.fillText(l, t.x, t.y + (LINE_H - 1) / 2 * px + i * px * LINE_H));
      g.restore();
      pushRecent(S.color);
      commit(before);
    }

    /* ---- select, move, copy, paste ---- */
    let clip = null;      /* the last thing copied inside Paint: a canvas in device pixels */
    const devRect = r => ({ x: Math.round(r.x * sx), y: Math.round(r.y * sy), w: Math.max(1, Math.round(r.w * sx)), h: Math.max(1, Math.round(r.h * sy)) });
    function regionCanvas(r) {
      const d = devRect(r);
      const c = K.blank(d.w, d.h);
      c.getContext('2d').drawImage(layers[ai].cv, d.x, d.y, d.w, d.h, 0, 0, d.w, d.h);
      return c;
    }
    function wipeRegion(r) {
      const d = devRect(r);
      mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(d.x, d.y, d.w, d.h); mctx.restore();
    }
    function stampCanvas(c, x, y) {
      mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.drawImage(c, Math.round(x * sx), Math.round(y * sy));
      mctx.restore();
    }
    function selectAll() {
      if (TG.on) return;
      setTool('select');
      commitFloat();
      sel = { x: 0, y: 0, w: viewW, h: viewH };
      drawOverlay();
    }
    function selectDown(e, p) {
      e.preventDefault();
      if (TG.on) return;
      const q = { x: Math.round(p.x), y: Math.round(p.y) };
      if (flt && inRect(fltRect(), p)) {
        drawing = { tool: 'select', mode: 'float', start: p, ox: flt.x, oy: flt.y, pid: e.pointerId, moved: false };
        return;
      }
      if (sel && inRect(sel, p)) {
        if (!layerOk()) return;
        drawing = { tool: 'select', mode: 'move', start: p, before: snapEntry(), rect: { ...sel }, pid: e.pointerId, moved: false };
        return;
      }
      sel = null;
      drawing = { tool: 'select', mode: 'marquee', start: q, pid: e.pointerId, moved: false };
      drawOverlay();
    }
    const fltRect = () => flt && ({ x: flt.x, y: flt.y, w: flt.cv.width / sx, h: flt.cv.height / sy });
    function selectMove(e) {
      const dr = drawing, p = pos(e);
      dr.moved = true;
      if (dr.mode === 'marquee') {
        const q = { x: Math.round(p.x), y: Math.round(p.y) };
        sel = { x: Math.min(dr.start.x, q.x), y: Math.min(dr.start.y, q.y), w: Math.abs(q.x - dr.start.x), h: Math.abs(q.y - dr.start.y) };
        drawOverlay();
      } else if (dr.mode === 'float') {
        flt.x = dr.ox + (p.x - dr.start.x); flt.y = dr.oy + (p.y - dr.start.y);
        sel = { x: Math.round(flt.x), y: Math.round(flt.y), w: Math.round(flt.cv.width / sx), h: Math.round(flt.cv.height / sy) };
        compositeSoon(); drawOverlay();
      } else if (dr.mode === 'move') {
        if (!flt) {                                      /* lift the pixels out of the layer on the first move */
          flt = { cv: regionCanvas(dr.rect), x: dr.rect.x, y: dr.rect.y, before: dr.before, lifted: true };
          wipeRegion(dr.rect);
        }
        flt.x = dr.rect.x + Math.round(p.x - dr.start.x); flt.y = dr.rect.y + Math.round(p.y - dr.start.y);
        sel = { x: flt.x, y: flt.y, w: dr.rect.w, h: dr.rect.h };
        compositeSoon(); drawOverlay();
      }
      e.preventDefault();
    }
    function selectUp(e, dr, cancelled) {
      try { overlay.releasePointerCapture?.(e.pointerId); } catch (err) { /* not captured */ }
      if (dr.mode === 'marquee') {
        if (!sel || sel.w < 2 || sel.h < 2) sel = null;
        else { sel.x = clamp(sel.x, 0, viewW); sel.y = clamp(sel.y, 0, viewH); }
        drawOverlay();
        return;
      }
      if (dr.mode === 'move' && flt && flt.lifted) {
        const f = flt; flt = null;                       /* put it down where it was dropped: one step to undo */
        if (cancelled || !dr.moved) { stampCanvas(f.cv, dr.rect.x, dr.rect.y); sel = { ...dr.rect }; flushComposite(); drawOverlay(); return; }
        stampCanvas(f.cv, f.x, f.y);
        dirty(layers[ai]);
        commit(f.before);
        drawOverlay();
      }
    }
    /* a pasted picture is put into the active layer */
    function commitFloat() {
      if (!flt) return;
      const f = flt; flt = null;
      if (TG.on || !layers[ai]) { flushComposite(); return; }
      stampCanvas(f.cv, f.x, f.y);
      sel = { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.cv.width / sx), h: Math.round(f.cv.height / sy) };
      commit(f.before);
      drawOverlay();
    }
    function startFloat(cv) {
      if (TG.on) { say('Not while drawing together', 'Leave the room to paste a picture.'); return; }
      if (!layerOk()) return;
      settleTools();
      setTool('select');
      /* a picture bigger than the canvas is shrunk to fit */
      const k = Math.min(1, viewW * sx / cv.width, viewH * sy / cv.height);
      let c = cv;
      if (k < 1) { c = K.blank(Math.max(1, Math.round(cv.width * k)), Math.max(1, Math.round(cv.height * k))); c.getContext('2d').drawImage(cv, 0, 0, c.width, c.height); }
      /* land where the person is looking */
      const r = stage.getBoundingClientRect(), pr = paper.getBoundingClientRect();
      const wl = c.width / sx, hl = c.height / sy;
      const x0 = clamp(((Math.max(r.left, pr.left) - pr.left) / Z) + 8, 0, Math.max(0, viewW - wl));
      const y0 = clamp(((Math.max(r.top, pr.top) - pr.top) / Z) + 8, 0, Math.max(0, viewH - hl));
      flt = { cv: c, x: Math.round(x0), y: Math.round(y0), before: snapEntry() };
      sel = { x: flt.x, y: flt.y, w: Math.round(wl), h: Math.round(hl) };
      flushComposite(); drawOverlay();
    }
    async function clipboardWrite(cv) {
      try {
        if (typeof ClipboardItem !== 'function' || !navigator.clipboard?.write) return;
        const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
        if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } catch (err) { /* the browser said no — the copy still works inside Paint */ }
    }
    function copySel(cut) {
      if (TG.on) return;
      let r = sel;
      if (flt) { clip = flt.cv; clipboardWrite(clip); if (cut) { flt = null; sel = null; flushComposite(); drawOverlay(); } return; }
      if (!r) { say('Nothing selected', 'Drag a box with the Select tool first.'); return; }
      clip = regionCanvas(r);
      clipboardWrite(clip);
      if (cut && layerOk()) {
        const before = snapEntry();
        wipeRegion(r); dirty(layers[ai]);
        commit(before);
      }
    }
    function deleteSel() {
      if (TG.on) return;
      if (flt) { flt = null; sel = null; flushComposite(); drawOverlay(); return; }
      if (!sel || !layerOk()) return;
      const before = snapEntry();
      wipeRegion(sel); dirty(layers[ai]);
      commit(before);
    }
    /* only ever called from a paste the person made */
    let pasteSeen = false;
    function onPaste(e) {
      if (dead || !win.el.classList.contains('is-active')) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      pasteSeen = true;
      const files = [...(e.clipboardData?.files || [])];
      const f = files.find(x => /^image\//.test(x.type));
      if (f) {
        e.preventDefault();
        if (TG.on) { say('Not while drawing together', 'Leave the room to paste a picture.'); return; }
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); if (dead) return; const c = K.blank(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0); startFloat(c); };
        img.onerror = () => { URL.revokeObjectURL(url); say('Couldn’t paste that', 'The picture on the clipboard couldn’t be read.', { icon: 'image' }); };
        img.src = url;
        return;
      }
      if (clip && !(e.clipboardData && e.clipboardData.getData('text/plain'))) { e.preventDefault(); startFloat(clip); }
    }
    window.addEventListener('paste', onPaste);

    /* the marquee, the symmetry axes, a pasted picture's edge */
    function drawOverlay() {
      if (!backW) return;
      clearOverlay();
      const lw = 1.5 / Z;
      const ants = r => {
        octx.save();
        octx.lineWidth = lw;
        octx.strokeStyle = '#fff'; octx.setLineDash([]); octx.strokeRect(r.x, r.y, r.w, r.h);
        octx.strokeStyle = '#111'; octx.setLineDash([5 / Z, 4 / Z]); octx.strokeRect(r.x, r.y, r.w, r.h);
        octx.restore();
      };
      if (sel && S.tool === 'select') ants(sel);
      if (!TG.on && S.sym !== 'off' && ['brush', 'eraser', 'line', 'rect', 'rrect', 'ellipse', 'poly'].includes(S.tool)) {
        octx.save();
        octx.lineWidth = lw; octx.strokeStyle = 'rgba(80,160,255,.55)'; octx.setLineDash([6 / Z, 5 / Z]);
        octx.beginPath();
        if (S.sym !== 'v') { octx.moveTo(viewW / 2, 0); octx.lineTo(viewW / 2, viewH); }
        if (S.sym !== 'h') { octx.moveTo(0, viewH / 2); octx.lineTo(viewW, viewH / 2); }
        octx.stroke();
        octx.restore();
      }
    }

    /* ---------------- clear / import / export ---------------- */
    async function clearCanvas() {
      settleTools();
      const several = !TG.on && layers.length > 1;
      const ok = await api.confirm(several
        ? { title: 'Clear this layer?', message: `This wipes “${layers[ai].name}” only; the other layers stay. You can still undo it afterwards.`, ok: 'Clear layer', danger: true }
        : { title: 'Clear the canvas?', message: 'This wipes the whole drawing. You can still undo it afterwards.', ok: 'Clear', danger: true });
      if (!ok || dead) return;
      const before = TG.on ? null : snapEntry();
      if (TG.on) { fillRoom(); tgStroke('clear', []); }
      else { mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, backW, backH); mctx.restore(); sel = null; drawOverlay(); }
      commit(before);
    }

    const roomOff = (what) => {
      say(`${what} is off while you draw together`, 'Everyone in a room draws on one shared picture. Leave the room first, then it works on your own canvas again.');
    };
    function onOpenClick() {
      if (TG.on) { roomOff('Open image'); return; }
      fileIn.click();
    }
    function placeImage(img) {
      if (TG.on) { roomOff('Open image'); return; }
      settleTools();
      const before = snapEntry();
      layers.length = 0;
      const L = mkLayer(`Layer ${++nameSeq}`); layers.push(L); ai = 0; paperOn = true; retarget();
      main.classList.remove('is-clear');
      const s = Math.min(viewW / img.width, viewH / img.height);
      const dw = img.width * s, dh = img.height * s;
      mctx.drawImage(img, (viewW - dw) / 2, (viewH - dh) / 2, dw, dh);
      sel = null; drawOverlay();
      commit(before);
    }
    function onFilePicked(e) {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) { notify({ app: 'Static Paint', icon: 'image', title: 'Not an image', message: 'Pick a PNG, JPG, GIF or WebP.' }); return; }
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => { if (!dead) placeImage(img); URL.revokeObjectURL(url); };
      img.onerror = () => { URL.revokeObjectURL(url); notify({ app: 'Static Paint', icon: 'image', title: 'Could not open that image', message: f.name }); };
      img.src = url;
    }

    const dlUrls = new Set();
    const toBlob = () => { settleTools(); flushComposite(); return new Promise(res => main.toBlob(res, 'image/png')); };

    async function saveToPictures() {
      try {
        const blob = await toBlob();
        if (!blob) throw new Error('The canvas could not be encoded.');
        const dir = vfs.HOME + '/Pictures';
        const { path } = await mediaSave(dir, `Static Paint ${stamp()}.png`, blob);
        notify({
          app: 'Static Paint', icon: 'image', title: 'Saved to Pictures', message: path,
          actions: [{ label: 'Open in Photos', onClick: () => api.openFile(path) }],
        });
      } catch (err) {
        notify({ app: 'Static Paint', icon: 'alert', title: 'Could not save', message: String(err && err.message || err) });
      }
    }
    /* the drawing as a picture on the clipboard (Static Clipboard keeps a small copy: its engine wraps write()) */
    async function copyPicture() {
      try {
        if (typeof ClipboardItem !== 'function' || !navigator.clipboard?.write) throw new Error('This browser doesn’t let pages copy pictures.');
        const blob = await toBlob();
        if (!blob) throw new Error('The canvas could not be encoded.');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        notify({ app: 'Static Paint', icon: 'copy', title: 'Picture copied', message: 'Paste it anywhere that takes pictures.' });
      } catch (err) {
        notify({ app: 'Static Paint', icon: 'alert', title: 'Could not copy', message: String(err && err.message || err) });
      }
    }
    async function download() {
      try {
        const blob = await toBlob();
        if (!blob) throw new Error('encode failed');
        const url = URL.createObjectURL(blob); dlUrls.add(url);
        const a = h('a', { href: url, download: `Static Paint ${stamp()}.png` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { if (dlUrls.has(url)) { URL.revokeObjectURL(url); dlUrls.delete(url); } }, 8000);
      } catch (err) {
        notify({ app: 'Static Paint', icon: 'alert', title: 'Download failed', message: 'The browser blocked the download.' });
      }
    }

    /* ---- Send to: the picture is saved to ~/Pictures, then that app opens on the file ---- */
    function menuAt(btn, items, label) {
      const r = btn.getBoundingClientRect();
      api.menu(items, r.left, r.bottom + 4, { label });
    }
    function sendMenu() {
      menuAt(sendBtn, [
        { label: 'Picture Tools · Meme', icon: 'type', onClick: () => sendTo('picturetools', { tool: 'meme' }) },
        { label: 'Picture Tools · Convert', icon: 'refresh', onClick: () => sendTo('picturetools', { tool: 'convert' }) },
        { label: 'Picture Tools · Sticker', icon: 'star', onClick: () => sendTo('picturetools', { tool: 'sticker' }) },
        { label: 'Markup', icon: 'edit-3', onClick: () => sendTo('markup', {}) },
        '-',
        { label: 'Desktop wallpaper', icon: 'image', onClick: () => sendTo('wallpaper', {}) },
      ], 'Send to');
    }
    async function sendTo(where, extra) {
      try {
        const blob = await toBlob();
        if (!blob) throw new Error('The canvas could not be encoded.');
        const { path } = await mediaSave(vfs.HOME + '/Pictures', `Static Paint ${stamp()}.png`, blob);
        if (dead) return;
        if (where === 'wallpaper') {
          const WP = await import('../portal/wallpapers.js');
          const entry = WP.addFile(store, path);
          WP.setActive(store, entry.id);
          notify({ app: 'Static Paint', icon: 'image', title: 'Wallpaper set', message: `${vfs.baseName(path)} is on your desktop. It stays in Pictures.` });
        } else api.openApp(where, { ...extra, path });
      } catch (err) {
        notify({ app: 'Static Paint', icon: 'alert', title: 'Could not send it', message: String(err && err.message || err) });
      }
    }

    /* ---- Image menu: flip, turn, invert, resize, transparent background ---- */
    function imageMenu() {
      const off = TG.on ? 'Not in a Draw Together room' : undefined;
      const it = (label, ic, fn) => ({ label, icon: ic, disabled: TG.on, hint: off, onClick: fn });
      menuAt(imageBtn, [
        it('Flip left–right', 'repeat', () => imageOp('flipx')),
        it('Flip top–bottom', 'repeat', () => imageOp('flipy')),
        it('Turn right 90°', 'refresh', () => imageOp('cw')),
        it('Turn left 90°', 'rotate-ccw', () => imageOp('ccw')),
        it('Invert colours (this layer)', 'sliders', () => imageOp('invert')),
        it('Resize picture…', 'maximize', () => openResize()),
        '-',
        it(paperOn ? 'Make the background transparent' : 'Make the background white', 'image', () => imageOp('paper')),
      ], 'Image');
    }
    function reshape(newW, newH, make) {
      const prev = layers.map(L => ({ L, src: make(L.cv) }));
      const keep = ai;
      setDoc(newW, newH);
      layers.length = 0;
      for (const { L: old, src } of prev) {
        const N = mkLayer(old.name); N.vis = old.vis; N.op = old.op;
        N.cx.save(); N.cx.setTransform(1, 0, 0, 1, 0, 0); N.cx.imageSmoothingQuality = 'high';
        N.cx.drawImage(src, 0, 0, backW, backH); N.cx.restore();
        layers.push(N);
      }
      ai = keep; retarget();
    }
    function imageOp(kind) {
      if (TG.on || busy) return;
      settleTools();
      const before = snapEntry();
      sel = null;
      if (kind === 'flipx') { reshape(viewW, viewH, c => K.flipped(c, true)); }
      else if (kind === 'flipy') { reshape(viewW, viewH, c => K.flipped(c, false)); }
      else if (kind === 'cw' || kind === 'ccw') { reshape(viewH, viewW, c => K.turned(c, kind === 'cw')); }
      else if (kind === 'invert') { K.invertInPlace(layers[ai].cv); }
      else if (kind === 'paper') { paperOn = !paperOn; main.classList.toggle('is-clear', !paperOn); }
      dirtyAll();
      syncSizeSel(); fitCanvas();
      commit(before);
    }
    const rsPanel = h('div.pnt-rs', { role: 'dialog', 'aria-label': 'Resize picture', hidden: true });
    pnt.appendChild(rsPanel);
    function openResize() {
      if (TG.on) return;
      let ratio = viewW / viewH, lock = true;
      const wIn = h('input.pnt__num', { type: 'number', min: '8', max: '4000', value: String(viewW), 'aria-label': 'Width in pixels' });
      const hIn = h('input.pnt__num', { type: 'number', min: '8', max: '4000', value: String(viewH), 'aria-label': 'Height in pixels' });
      wIn.oninput = () => { if (lock) hIn.value = String(Math.round(Number(wIn.value) / ratio) || ''); };
      hIn.oninput = () => { if (lock) wIn.value = String(Math.round(Number(hIn.value) * ratio) || ''); };
      const msg = h('p.pnt-rs__msg', { role: 'alert' });
      const apply = () => {
        const w = Math.round(Number(wIn.value)), hh = Math.round(Number(hIn.value));
        if (!(w >= 8 && hh >= 8)) { msg.textContent = 'Both sizes need to be at least 8 pixels.'; return; }
        if (w * hh > MAX_PIXELS) { msg.textContent = `That’s more than ${(MAX_PIXELS / 1e6).toFixed(1)} million pixels — pick something smaller.`; return; }
        rsPanel.hidden = true;
        if (w === viewW && hh === viewH) return;
        settleTools();
        const before = snapEntry();
        sel = null;
        reshape(w, hh, c => c);
        dirtyAll(); syncSizeSel(); fitCanvas();
        commit(before);
      };
      rsPanel.replaceChildren(
        h('div.pnt-tg__head', icon('maximize'), h('b', { text: 'Resize picture' }), h('button.ibtn', { type: 'button', 'aria-label': 'Close', onclick: () => { rsPanel.hidden = true; } }, icon('x'))),
        h('p', { text: 'The whole picture, every layer, is stretched to the new size.' }),
        h('div.pnt-rs__row', wIn, h('span', { text: '×' }), hIn, h('span', { text: 'px' })),
        h('label.pnt-rs__lock', h('input', { type: 'checkbox', checked: true, 'aria-label': 'Keep the shape', onchange: e => { lock = e.target.checked; } }), h('span', { text: 'Keep the shape' })),
        msg,
        h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: apply }, h('span', { text: 'Resize' })));
      rsPanel.hidden = false;
      wIn.focus(); wIn.select();
    }

    /* drop an image onto the stage */
    function onDragOver(e) { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); } }
    function onDrop(e) {
      const f = [...(e.dataTransfer?.files || [])].find(x => /^image\//.test(x.type));
      if (!f) return;
      e.preventDefault();
      if (TG.on) { roomOff('Open image'); return; }
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => { if (!dead) placeImage(img); URL.revokeObjectURL(url); };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    }
    stage.addEventListener('dragover', onDragOver);
    stage.addEventListener('drop', onDrop);

    /* in a room some things are off, and each says why */
    function applyRoomLocks() {
      const on = TG.on;
      for (const [id, b] of toolBtns) {
        const no = on && !ROOM_TOOLS.has(id);
        b.classList.toggle('is-off', no);
        b.setAttribute('aria-disabled', String(no));
        const t = TOOLS.find(x => x.id === id);
        b.dataset.tip = no ? `${t.label} · off in a room` : `${t.label} · ${t.key}`;
      }
      for (const key of ['opacity', 'soft', 'smooth']) O[key].inp.disabled = on;
      O.pressure.disabled = O.sym.disabled = O.filled.disabled = O.radius.inp.disabled = on;
      O.tol.inp.disabled = on;
      imageBtn.disabled = on;
      imageBtn.title = on ? 'Flip, turn, resize and the rest are off while you draw together' : '';
      openBtn.setAttribute('aria-disabled', String(on));
      openBtn.dataset.tip = on ? 'Open image is off while you draw together' : 'Open image';
      sizeSel.disabled = on;
      sizeSel.title = on ? 'Canvas size is fixed while you draw together' : '';
      hint.hidden = !on;
      hint.textContent = on ? 'Drawing together: plain strokes only — brushes, lines, boxes, ellipses and fill. Layers, text, selections, soft or see-through brushes and symmetry are off in a room.' : '';
    }

    /* ---------------- draw together ---------------- */
    const TG_ERR = {
      invalid: 'That isn’t a room code — codes are 6 letters and numbers, like K7QM2X.',
      nobody: 'No Draw Together room answered that code. Check it, and that your friend still has the room open.',
      full: 'That room already has two people.',
      insecure: 'Draw Together needs a secure (https) page for its encryption.',
    };
    const TG_LINK = {
      connecting: 'Setting up a direct link…',
      direct: 'Direct link — strokes go straight between you two',
      failed: 'No direct link — strokes go through the public server',
      lost: 'The direct link dropped — strokes go through the public server',
    };
    const tgPanel = h('div.pnt-tg', { role: 'dialog', 'aria-label': 'Draw together', hidden: true });
    const peerEl = h('div.pnt-peer', { hidden: true, 'aria-hidden': 'true' }, h('i'), h('span'));
    paper.appendChild(peerEl);
    pnt.appendChild(tgPanel);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const tgInviteLink = code => { try { return `${location.origin}${location.pathname}#draw=${code}`; } catch (e) { return ''; } };
    function copyCanvas(src) {
      const c = document.createElement('canvas');
      c.width = backW; c.height = backH;
      const cx = c.getContext('2d');
      cx.fillStyle = PAPER; cx.fillRect(0, 0, backW, backH);
      if (src) cx.drawImage(src, 0, 0, backW, backH);
      return c;
    }
    const paired = () => !!TG.room && TG.room.phase === 'paired';
    const peerName = () => TG.room?.peer?.name || 'your friend';
    function lockOverlay() { overlay.classList.toggle('is-waiting', TG.on && !TG.gotDoc); }

    /* one stroke onto the drawing, from the log */
    function replay(st) {
      const P = st.p;
      if (st.tool === 'clear') { fillRoom(); return; }
      if (!P.length || P.some(v => v === undefined)) return;
      if (st.tool === 'fill') { const d = dev(P[0], P[1]); floodFill(d.x, d.y, st.c, 42); return; }
      if (st.tool === 'line' || st.tool === 'rect' || st.tool === 'ellipse') {
        if (P.length >= 4) drawShape(mctx, st.tool, { x: P[0], y: P[1] }, { x: P[2], y: P[3] }, st.c, st.w);
        return;
      }
      drawFrom(st, 0);
    }
    /* brush / eraser points from index `from` on (a dot first, when starting) */
    function drawFrom(st, from) {
      const P = st.p, col = st.tool === 'eraser' ? PAPER : st.c, n = P.length / 2;
      mctx.fillStyle = col; mctx.strokeStyle = col; mctx.lineWidth = st.w;
      if (from === 0) { mctx.beginPath(); mctx.arc(P[0], P[1], Math.max(0.4, st.w / 2), 0, Math.PI * 2); mctx.fill(); }
      const start = Math.max(0, from - 1);
      if (n - start < 2) return;
      mctx.beginPath();
      mctx.moveTo(P[start * 2], P[start * 2 + 1]);
      for (let k = start + 1; k < n; k++) mctx.lineTo(P[k * 2], P[k * 2 + 1]);
      mctx.stroke();
    }
    function rerender() {
      if (TG.rq) { cancelAnimationFrame(TG.rq); TG.rq = 0; }
      fillRoom();
      if (TG.base) { mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(TG.base, 0, 0, backW, backH); mctx.restore(); }
      for (const st of TG.log.list) if (!st.undone) replay(st);
      composite();
      touched = true;
      persistSoon();
    }
    const rerenderSoon = () => { if (!TG.rq) TG.rq = requestAnimationFrame(() => { TG.rq = 0; if (!dead) rerender(); }); };
    /* the oldest strokes are drawn into the base and can no longer be undone (the same rule on both sides) */
    function fold() {
      const out = TG.log.shift(D.LIMITS.fold);
      fillRoom();
      if (TG.base) { mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(TG.base, 0, 0, backW, backH); mctx.restore(); }
      for (const st of out) if (!st.undone) replay(st);
      TG.base = copyCanvas(roomCv);
      rerender();
    }

    /* ---- my strokes ---- */
    const newId = () => `${TG.me}${(++TG.n).toString(36)}`;
    function addMine(st) {
      if (TG.log.size >= D.LIMITS.log) fold();
      TG.log.insert(st);
      TG.redo = [];
      updateHistory();
    }
    function tgBegin(p) {
      const st = { id: newId(), a: TG.me, s: ++TG.lamport, tool: S.tool, c: S.color, w: S.size, p: [Math.round(p.x), Math.round(p.y)], undone: false, sent: 0 };
      addMine(st);
      TG.cur = st;
      clearInterval(TG.flushT);
      TG.flushT = setInterval(() => flushCur(false), 50);
    }
    function tgPoint(p) {
      const st = TG.cur;
      if (!st) return;
      const x = Math.round(p.x), y = Math.round(p.y), L = st.p.length;
      if (st.p[L - 2] === x && st.p[L - 1] === y) return;
      if (L / 2 >= D.LIMITS.pts - 1) { tgEnd(); tgBegin(p); return; }   /* a very long drag carries on as a new stroke */
      st.p.push(x, y);
    }
    function flushCur(final) {
      const st = TG.cur;
      if (!st) return;
      const total = st.p.length / 2;
      do {
        const end = Math.min(total, st.sent + D.LIMITS.batch);
        const msg = { id: st.id, s: st.s, tool: st.tool, c: st.c, w: st.w, i: st.sent, p: st.p.slice(st.sent * 2, end * 2) };
        if (final && end === total) msg.n = total;
        if (msg.p.length || msg.n !== undefined) TG.room?.send('sk', msg);
        st.sent = end;
      } while (st.sent < total);
    }
    function tgEnd() {
      const st = TG.cur;
      if (!st) return;
      clearInterval(TG.flushT);
      flushCur(true);
      st.n = st.p.length / 2;
      TG.cur = null;
    }
    function tgStroke(tool, pts) {
      const st = { id: newId(), a: TG.me, s: ++TG.lamport, tool, c: S.color, w: S.size, p: pts.map(v => Math.round(v)), undone: false };
      st.n = st.p.length / 2;
      addMine(st);
      for (const ch of D.chunks(st)) TG.room?.send('sk', ch);
    }
    /* QoS 0 may lose one; un/re are idempotent, so say them twice */
    const sayTwice = (t, body) => { const room = TG.room; room?.send(t, body); setTimeout(() => { if (TG.room === room) room?.send(t, body); }, 450); };
    function tgUndo() {
      const list = TG.log.list;
      for (let k = list.length - 1; k >= 0; k--) {
        const st = list[k];
        if (st.a !== TG.me || st.undone || st === TG.cur) continue;
        st.undone = true;
        TG.redo.push(st.id);
        sayTwice('un', { id: st.id });
        rerender();
        updateHistory();
        return;
      }
    }
    function tgRedo() {
      const id = TG.redo.pop();
      const st = id ? TG.log.byId.get(id) : null;
      if (st) { st.undone = false; sayTwice('re', { id }); rerender(); }
      updateHistory();
    }

    /* ---- cursors ---- */
    function tgCursor(p) {
      if (!paired()) return;
      TG.curPending = p ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: -1, y: -1 };
      if (TG.curT) return;
      TG.curT = setTimeout(() => {
        TG.curT = 0;
        if (TG.curPending && paired()) TG.room.send('cur', TG.curPending);
        TG.curPending = null;
      }, 70);
    }
    function showPeerCursor(m) {
      if (m.x < 0) { peerEl.hidden = true; TG.peerAt = null; return; }
      TG.peerAt = { x: m.x, y: m.y };
      peerEl.hidden = false;
      peerEl.style.left = `${(Math.min(m.x, viewW) / viewW) * 100}%`;
      peerEl.style.top = `${(Math.min(m.y, viewH) / viewH) * 100}%`;
      peerEl.style.setProperty('--h', String(TG.room?.peer?.color ?? 200));
      peerEl.lastChild.textContent = TG.room?.peer?.name || 'Friend';
    }

    /* ---- the friend's strokes ---- */
    function onChunk(m) {
      if (m.id[0] === TG.me) return;                        /* their ids start with their own letter */
      let st = TG.log.byId.get(m.id);
      if (!st) {
        if (TG.log.size >= D.LIMITS.log) fold();
        st = { id: m.id, a: m.id[0], s: m.s, tool: m.tool, c: m.c, w: m.w, p: [], undone: false };
        TG.lamport = Math.max(TG.lamport, m.s);
        TG.log.insert(st);
      }
      const have = st.p.length / 2;
      if (m.i > have) st.gap = true;
      if (m.i < have) st.dirty = true;
      for (let k = 0; k < m.p.length; k++) st.p[m.i * 2 + k] = m.p[k];
      if (m.n !== undefined) st.n = m.n;
      const L = TG.log.list;
      const last = L[L.length - 1] === st || (TG.cur && L[L.length - 2] === st && L[L.length - 1] === TG.cur);
      if (!st.undone && m.i === have && !st.gap && !st.dirty) {
        if (st.tool === 'brush' || st.tool === 'eraser') { if (m.p.length) drawFrom(st, m.i); }
        else if (m.n !== undefined && D.complete(st)) replay(st);
        if (!last) st.dirty = true;                          /* drawn now; put in its place once it's whole */
      }
      if (m.n !== undefined) {
        if (!D.complete(st)) {
          if ((st.asked || 0) < 2) { st.asked = (st.asked || 0) + 1; TG.room?.send('need', { id: st.id }); }
        } else if (st.dirty || st.gap) { st.dirty = st.gap = false; rerenderSoon(); }
      }
      touched = true;
      compositeSoon();
      persistSoon();
    }
    function onTg({ t, m }) {
      if (t === 'sk') { onChunk(m); return; }
      if (t === 'cur') { showPeerCursor(m); return; }
      if (t === 'un' || t === 're') {
        const st = TG.log.byId.get(m.id);
        if (!st || st.a === TG.me) return;                    /* only their own strokes */
        const u = t === 'un';
        if (st.undone !== u) { st.undone = u; rerenderSoon(); }
        return;
      }
      if (t === 'need') {
        const st = TG.log.byId.get(m.id);
        if (!st || st.a !== TG.me || (st.resent || 0) >= 3) return;
        st.resent = (st.resent || 0) + 1;
        for (const ch of D.chunks(st)) { if (st === TG.cur) delete ch.n; TG.room?.send('sk', ch); }
        return;
      }
      if (t === 'doc') {
        if (TG.me !== 'g' || TG.gotDoc) return;
        TG.gotDoc = true;
        if (m.w !== viewW || m.h !== viewH) { setDoc(m.w, m.h); syncSizeSel(); fitCanvas(); }
        TG.base = copyCanvas(null);
        TG.note = m.base ? '' : `There’s no direct link, so ${peerName()}’s picture from before the room couldn’t be copied — you have the strokes drawn in the room, and everything from now on.`;
        rerender();
        lockOverlay();
        paintPanel();
        return;
      }
      if (t === 'img') { if (TG.me === 'g' && !TG.imgDone) TG.img = { size: m.size, got: 0, parts: [] }; return; }
      if (t === 'imge') {
        const im = TG.img;
        TG.img = null;
        if (!im || im.got !== im.size) return;
        TG.imgDone = true;
        const url = URL.createObjectURL(new Blob(im.parts, { type: 'image/png' }));
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          if (dead || !TG.on) return;
          TG.base = copyCanvas(img);
          rerender();
        };
        img.onerror = () => { URL.revokeObjectURL(url); TG.note = `${peerName()}’s picture from before the room couldn’t be read.`; paintPanel(); };
        img.src = url;
      }
    }
    function onImgBytes(buf) {
      const im = TG.img;
      if (!im) return;
      im.got += buf.byteLength;
      if (im.got > im.size) { TG.img = null; return; }      /* more than it said: dropped */
      im.parts.push(buf);
    }

    /* ---- host: hand the canvas to whoever joins ---- */
    async function sendCanvas(direct) {
      const room = TG.room;
      if (!room || room.phase !== 'paired' || TG.sentCanvas) return;
      TG.sentCanvas = true;
      let blob = null;
      if (direct && TG.base) blob = await new Promise(r => TG.base.toBlob(r, 'image/png'));
      if (TG.room !== room || room.phase !== 'paired') return;
      if (blob && blob.size > D.LIMITS.img) blob = null;
      const via = direct ? 'rtc' : 'auto';
      room.send('doc', { w: viewW, h: viewH, base: !!blob }, { via });
      if (blob) {
        room.send('img', { size: blob.size }, { via: 'rtc' });
        const buf = await blob.arrayBuffer();
        for (let at = 0; at < buf.byteLength; at += 16384) {
          if (room.buffered > 1024 * 1024 && !(await room.drained())) return;
          if (!room.sendBinary(buf.slice(at, at + 16384))) return;
        }
        room.send('imge', {}, { via: 'rtc' });
      }
      const list = TG.log.list.slice(direct ? 0 : -D.LIMITS.replayMqtt);
      let k = 0;
      for (const st of list) {
        if (TG.room !== room) return;
        for (const ch of D.chunks(st)) {
          if (st === TG.cur) delete ch.n;
          room.send('sk', ch, { via });
          if (++k % (direct ? 200 : 20) === 0) await sleep(direct ? 20 : 800);
        }
        if (st.undone) room.send('un', { id: st.id }, { via });
      }
    }
    function hostMaybeSend() {
      if (!TG.room || TG.room.role !== 'host' || !paired() || TG.sentCanvas) return;
      if (TG.room.link === 'direct') sendCanvas(true);
      else if (TG.room.link === 'failed' || TG.room.link === 'lost') sendCanvas(false);
    }

    /* ---- the room ---- */
    function tgStart(role, code) {
      tgStop(false);
      TG.err = '';
      TG.note = '';
      const room = openPair({ kind: 'draw', role, code, types: D.checkers, rtc: true, binary: true });
      if (room.phase === 'closed') { TG.err = TG_ERR[room.error] || TG_ERR.nobody; paintPanel(); return; }
      settleTools();
      if (drawing) { drawing = null; wetClear(); }
      TG.room = room;
      TG.me = role === 'host' ? 'h' : 'g';
      TG.pre = snapEntry();
      TG.log.clear();
      TG.redo = [];
      TG.lamport = 0; TG.n = 0; TG.cur = null;
      TG.gotDoc = role === 'host';
      TG.sentCanvas = false;
      TG.img = null; TG.imgDone = false;
      flushComposite();
      TG.base = copyCanvas(main);                             /* the layers, flattened, are the base of the shared picture */
      roomCv = K.blank(backW, backH);
      roomCx = roomCv.getContext('2d', { willReadFrequently: true });
      prepCtx(roomCx); fillRoom();
      roomCx.save(); roomCx.setTransform(1, 0, 0, 1, 0, 0); roomCx.drawImage(TG.base, 0, 0); roomCx.restore();
      TG.on = true;
      sel = null; flt = null;
      retarget();
      touched = true;                                         /* a saved drawing must not load over the shared one */
      if (!ROOM_TOOLS.has(S.tool)) setTool('brush'); else applyRoomLocks();
      renderLayers(); composite(); drawOverlay();
      TG.offs = [room.on((type, data) => {
        if (dead || TG.room !== room) return;
        if (type === 'phase') {
          if (data === 'closed' && room.error) { TG.err = TG_ERR[room.error] || TG_ERR.nobody; tgStop(false); return; }
        } else if (type === 'peer' || type === 'link') hostMaybeSend();
        else if (type === 'left') {
          TG.note = `${data.peer?.name || 'Your friend'} ${data.reason === 'quiet' ? 'went quiet' : 'left'} — your copy of the drawing stays.`;
          tgStop(false);
          return;
        } else if (type === 'msg') { onTg(data); return; }
        else if (type === 'bin') { onImgBytes(data); return; }
        paintPanel(); paintBtn();
      })];
      updateHistory(); lockOverlay(); paintPanel(); paintBtn();
    }
    function tgStop(sayBye = true) {
      TG.offs.forEach(f => f());
      TG.offs = [];
      clearInterval(TG.flushT); clearTimeout(TG.curT); TG.curT = 0;
      if (TG.rq) { cancelAnimationFrame(TG.rq); TG.rq = 0; }
      const room = TG.room;
      TG.room = null;
      if (room) { try { room.leave(); } catch (e) { /* gone */ } }
      const was = TG.on;
      TG.on = false;
      TG.cur = null;
      TG.img = null;
      peerEl.hidden = true;
      if (was) {
        /* your copy stays, as one layer; one Undo brings back what you had before the room */
        wetClear();
        layers.length = 0;
        const L = mkLayer(`Layer ${++nameSeq}`);
        L.cx.save(); L.cx.setTransform(1, 0, 0, 1, 0, 0); L.cx.drawImage(roomCv, 0, 0); L.cx.restore();
        layers.push(L); ai = 0; paperOn = true;
        main.classList.remove('is-clear');
        roomCv = roomCx = null;
        undo.length = 0; redo.length = 0;
        if (TG.pre) undo.push(TG.pre);
        TG.pre = null;
        TG.log.clear(); TG.redo = []; TG.base = null;
        persistSoon();
      }
      retarget(); applyRoomLocks(); renderLayers(); flushComposite(); drawOverlay();
      updateHistory(); lockOverlay(); paintPanel(); paintBtn();
    }

    /* ---- the panel ---- */
    function togglePanel(force) {
      TG.open = typeof force === 'boolean' ? force : !TG.open;
      tgPanel.hidden = !TG.open;
      tgBtn.setAttribute('aria-expanded', String(TG.open));
      if (TG.open) paintPanel();
    }
    async function copyTgInvite(code) {
      const link = tgInviteLink(code);
      const text = `Draw with me in Static Paint — room code ${code}${link ? ` · ${link}` : ''}`;
      try { await navigator.clipboard.writeText(text); notify({ app: 'Static Paint', icon: 'copy', title: 'Invite copied', message: `Room code ${code}.` }); }
      catch (e) { notify({ app: 'Static Paint', icon: 'info', title: `Room code ${code}`, message: 'Copying was blocked here — read the code out instead.' }); }
    }
    function paintPanel() {
      if (!TG.open || dead) return;
      const room = TG.room;
      const kids = [h('div.pnt-tg__head', icon('users'), h('b', { text: 'Draw together' }),
        h('button.ibtn', { type: 'button', 'aria-label': 'Hide this panel', onclick: () => togglePanel(false) }, icon('x')))];
      if (!room) {
        const input = h('input.pnt-tg__in', { type: 'text', maxlength: '80', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'Friend’s code', 'aria-label': 'Room code from your friend', value: TG.joinCode || '' });
        kids.push(
          h('p', { text: 'Draw on the same canvas as a friend, at the same time. You each see the other’s cursor, and Undo only takes back your own strokes.' }),
          h('button.btn.btn--primary.pnt-tg__start', { type: 'button', onclick: () => tgStart('host') }, icon('users'), h('span', { text: 'Start a room' })),
          h('div.pnt-tg__or', { text: 'or join theirs' }),
          h('form.pnt-tg__join', { onsubmit: e => {
            e.preventDefault();
            const c = normalizeCode(input.value);
            TG.joinCode = c;
            if (!isCode(c)) { TG.err = TG_ERR.invalid; paintPanel(); return; }
            tgStart('guest', c);
          } }, input, h('button.btn', { type: 'submit' }, h('span', { text: 'Join' }))),
          h('p.pnt-tg__fine', { text: 'Joining puts your friend’s canvas in place of yours. Leaving keeps a copy of the shared drawing, and Undo then brings yours back.' }),
          h('p.pnt-tg__fine', { text: 'In a room everyone shares one picture of plain strokes, so layers, text, selections, soft or see-through brushes, symmetry and resizing are off until you leave. If you have layers now, the room starts from them flattened.' }));
        if (TG.err) kids.push(h('p.pnt-tg__err', { role: 'alert', text: TG.err }));
        if (TG.note) kids.push(h('p.pnt-tg__note', { role: 'status', text: TG.note }));
      } else {
        const ph = room.phase;
        if (ph === 'paired') {
          kids.push(h('p.pnt-tg__with', { style: { '--h': String(room.peer?.color ?? 200) } }, h('i'), h('span', { text: `Drawing with ${peerName()}` })));
          if (TG_LINK[room.link]) kids.push(h('p.pnt-tg__link', { dataset: { link: room.link }, text: TG_LINK[room.link] }));
          if (TG.me === 'g' && !TG.gotDoc) kids.push(h('p.pnt-tg__wait', h('i.pnt-tg__spin'), h('span', { text: `Getting ${peerName()}’s canvas…` })));
        } else if (room.role === 'host') {
          kids.push(h('p', { text: 'Your room code' }),
            h('div.pnt-tg__code', { 'aria-label': `Room code ${spaced(room.code)}`, dataset: { code: room.code } }, [...room.code].map(c => h('span', { text: c, 'aria-hidden': 'true' }))),
            h('button.btn.btn--sm', { type: 'button', onclick: () => copyTgInvite(room.code) }, icon('copy'), h('span', { text: 'Copy invite' })),
            h('p.pnt-tg__wait', h('i.pnt-tg__spin'), h('span', { text: ph === 'waiting' ? 'Waiting for your friend — keep drawing, they’ll get it all.' : 'Opening the room…' })));
        } else kids.push(h('p.pnt-tg__wait', h('i.pnt-tg__spin'), h('span', { text: `Joining ${room.code}…` })));
        if (ph !== 'paired' && live.status() === 'offline') kids.push(h('p.pnt-tg__err', { text: 'Can’t reach the live server — this network may block it. Trying again…' }));
        if (TG.note) kids.push(h('p.pnt-tg__note', { role: 'status', text: TG.note }));
        kids.push(h('button.btn.btn--sm.pnt-tg__leave', { type: 'button', onclick: () => { TG.note = 'You left the room — your copy of the drawing stays.'; tgStop(true); } }, h('span', { text: 'Leave' })));
      }
      kids.push(h('p.pnt-tg__fine', { text: 'Rooms run over StaticOS’s live connection, a free public server. Strokes and names are sealed with the room code, but anyone who has the code can join — treat it like a password. When a direct link works, strokes go straight between you two (it shows each of you the other’s network address); otherwise they go through that server. Names aren’t verified.' }));
      tgPanel.replaceChildren(...kids);
    }
    function paintBtn() {
      tgBtn.classList.toggle('is-on', TG.on);
      tgBtn.lastChild.textContent = paired() ? `With ${peerName()}` : TG.on ? 'Room open' : 'Draw together';
    }
    const offLiveTg = live.onStatus(() => { if (TG.open && TG.room && TG.room.phase !== 'paired') paintPanel(); });

    /* ---------------- keyboard ---------------- */
    function onKey(e) {
      if (dead || !win.el.classList.contains('is-active')) return;
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;                       /* let the hex field keep its own undo/typing */
      if (e.key === ' ' && !(el && (el.tagName === 'BUTTON' || el.tagName === 'SELECT'))) {
        spaceDown = true; overlay.classList.add('is-hand'); e.preventDefault(); return;
      }
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
        else if (k === 'y') { e.preventDefault(); doRedo(); }
        else if (k === 'c' && !e.shiftKey) { if (sel || flt) { e.preventDefault(); copySel(false); } }
        else if (k === 'x' && !e.shiftKey) { if (sel || flt) { e.preventDefault(); copySel(true); } }
        else if (k === 'a' && !e.shiftKey) { e.preventDefault(); selectAll(); }
        else if (k === 'v' && !e.shiftKey) {
          /* the browser answers ⌘/Ctrl V with a paste event, which is what brings a picture in from the
             clipboard; if none comes (nothing focused to paste into), a picture copied inside Paint is used */
          if (clip && !TG.on) { pasteSeen = false; setTimeout(() => { if (!pasteSeen && !dead && clip && !flt) startFloat(clip); }, 90); }
        }
        return;
      }
      if (e.altKey) return;
      if (e.key === 'Enter') {
        if (poly) { e.preventDefault(); polyClose(); }
        else if (flt) { e.preventDefault(); commitFloat(); }
        return;
      }
      if (e.key === 'Escape') {
        if (poly) { e.preventDefault(); cancelPoly(); }
        else if (sel && S.tool === 'select') { e.preventDefault(); commitFloat(); sel = null; drawOverlay(); }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (sel || flt) && S.tool === 'select') { e.preventDefault(); deleteSel(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.25); return; }
      if (e.key === '0') { e.preventDefault(); zoomFit(); return; }
      const t = TOOLS.find(x => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) { e.preventDefault(); setTool(t.id); }
      else if (e.key === '[') { e.preventDefault(); setSize(S.size - 1); }
      else if (e.key === ']') { e.preventDefault(); setSize(S.size + 1); }
    }
    const onKeyUp = e => { if (e.key === ' ' && spaceDown) { spaceDown = false; overlay.classList.remove('is-hand'); } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);

    /* ---------------- resize tracking ---------------- */
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => fitCanvas()); ro.observe(stage); }
    else { window.addEventListener('resize', fitCanvas); }

    /* ---------------- init ---------------- */
    setDoc(SIZES.find(s => s.key === S.sizeKey).w, SIZES.find(s => s.key === S.sizeKey).h);
    setTool(S.tool); setColor(S.color, false); setSize(S.size); renderRecents();
    updateHistory(); applyRoomLocks();
    requestAnimationFrame(fitCanvas);

    /* restore a persisted drawing, unless the person already started one. A drawing saved
       before layers existed is { url, w, h }: it comes back as one layer. */
    (async () => {
      let rec = null;
      try { rec = await misc.get(DOC_KEY); } catch (e) { rec = null; }
      if (dead || touched || !rec || !rec.w || !rec.h) return;
      if (!rec.url && !(Array.isArray(rec.layers) && rec.layers.length)) return;
      await loadDoc(rec);
    })();

    /* ---------------- opening with a room code (#draw=CODE) ---------------- */
    function fromOpts(o) {
      if (!o || !o.together || TG.room) return;
      TG.joinCode = normalizeCode(o.together).slice(0, 6);
      TG.err = '';
      togglePanel(true);
      setTimeout(() => tgPanel.querySelector('.pnt-tg__join button')?.focus({ preventScroll: true }), 40);
    }
    win.onReopen(fromOpts);
    fromOpts(opts);

    /* for the play-tests */
    pnt.paintPeek = () => ({
      on: TG.on, me: TG.me, phase: TG.room?.phase || 'none', code: TG.room?.code || null, topic: TG.room?.topic || null,
      link: TG.room?.link || null, peer: TG.room?.peer || null, gotDoc: TG.gotDoc, note: TG.note, peerAt: TG.peerAt,
      log: TG.log.list.map(st => ({ id: st.id, a: st.a, tool: st.tool, undone: st.undone, n: st.p.length / 2 })),
      stats: TG.room?.stats?.() || null, viewW, viewH, backW, backH, undo: undo.length,
      zoom: Z, tool: S.tool, ai, paper: paperOn, sel: sel && { ...sel }, floating: !!flt,
      layers: layers.map(L => ({ name: L.name, vis: L.vis, op: L.op })),
    });

    /* ---------------- teardown ---------------- */
    return () => {
      commitText();
      tgStop(true);
      offLiveTg();
      dead = true;
      cancelAnimationFrame(compQ);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('resize', fitCanvas);
      overlay.removeEventListener('pointerdown', onDown);
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointercancel', onCancel);
      overlay.removeEventListener('pointerleave', onLeaveCanvas);
      overlay.removeEventListener('dblclick', onDbl);
      stage.removeEventListener('dragover', onDragOver);
      stage.removeEventListener('drop', onDrop);
      stage.removeEventListener('wheel', onWheel);
      offReduce?.();
      ro?.disconnect();
      if (prefTimer) { clearTimeout(prefTimer); store.set(PREF_KEY, prefsNow()); }
      if (persistTimer) { clearTimeout(persistTimer); if (touched) persistNow(); }
      for (const u of dlUrls) { try { URL.revokeObjectURL(u); } catch (e) {} }
      dlUrls.clear();
    };
  },
});
