/* ============================================================
   paint.js — Static Paint: a real drawing app on a <canvas>.

   The document is a fixed-resolution image (like a file on disk):
   the chosen size is the LOGICAL size, and the backing store is
   size × devicePixelRatio (clamped to 2), so strokes stay crisp on
   HiDPI screens and an exported PNG is full resolution. The context
   transform is set to (sx,0,0,sy) so tools are authored in logical
   pixels; flood-fill and the eyedropper work directly on the device
   pixels via getImageData.

   Two stacked canvases share the paper: the lower one IS the drawing;
   the upper transparent overlay shows the live preview while dragging
   a line / rectangle / ellipse, and the shape is committed to the
   drawing on pointer-up. Pointer events drive both mouse and touch.

   Undo/redo keeps a capped stack of PNG snapshots (small for the
   usual mostly-white drawing; each entry also records the doc size so
   undoing a resize brings the size back). The current drawing is
   persisted to IndexedDB (db.js kv 'misc') so a reload doesn't lose
   it, capped so a huge canvas never overflows the store. Tool, colour,
   size and recent colours persist in the store under 'portal.paint'.

   Export saves a genuine PNG to ~/Pictures with core/media.js (it then
   opens in Photos) and offers a plain Download. Import draws a picked
   PNG onto the canvas to paint over. Nothing here is faked: every
   pixel is drawn in the browser and every saved file is real.

   Draw together: one person starts a room (a six-character code and
   an invite link, #draw=<CODE>), a friend joins with it, and both draw
   on the same canvas at once. While in a room the canvas is a base
   picture plus a shared stroke log (core/drawsync.js): each stroke is
   sent as compact point lists, batched while it's drawn, with its
   tool, colour and size, and the other side replays it; each sees
   the other's cursor and name. Undo/redo take back only your own
   strokes (the snapshot history is set aside for the session). The
   friend who joins gets the current canvas: over the direct link
   (WebRTC) the base picture and the whole log; without one, only
   the most recent strokes from the room (the base picture can't be
   sent through the public server, and the panel says so). Leaving
   keeps your copy, and one Undo afterwards brings back what you had
   before joining. Canvas size and Open image are off while in a room.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { save as mediaSave } from '../core/media.js';
import { kv } from '../core/db.js';
import { openPair } from '../core/pair.js';
import { isCode, normalizeCode, spaced } from '../core/roomcode.js';
import * as D from '../core/drawsync.js';
import * as live from '../portal/live.js';

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

const ERASER_SVG   = '<svg viewBox="0 0 24 24"><path d="M7 16.5 13 10.5a2 2 0 0 1 2.9 0l1.6 1.6a2 2 0 0 1 0 2.9L13.5 19H9z"/><path d="M4 20h16"/></svg>';
const PIPETTE_SVG  = '<svg viewBox="0 0 24 24"><path d="M10.6 11.5 4.8 17.3a2 2 0 0 0-.5.9L3.6 21l2.8-.7a2 2 0 0 0 .9-.5l5.8-5.8"/><path d="m9.6 10.5 8-8a2.1 2.1 0 0 1 3 3l-8 8z"/><path d="m8 12 4 4"/></svg>';
const REDO_SVG     = '<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

const TOOLS = [
  { id: 'brush',      label: 'Brush',       icon: 'edit-3',  key: 'B' },
  { id: 'eraser',     label: 'Eraser',      svg: ERASER_SVG, key: 'E' },
  { id: 'line',       label: 'Line',        icon: 'minus',   key: 'L' },
  { id: 'rect',       label: 'Rectangle',   icon: 'square',  key: 'R' },
  { id: 'ellipse',    label: 'Ellipse',     icon: 'circle',  key: 'O' },
  { id: 'fill',       label: 'Fill area',   icon: 'droplet', key: 'G' },
  { id: 'eyedropper', label: 'Eyedropper',  svg: PIPETTE_SVG, key: 'I' },
];

const SIZES = [
  { key: 'md',   label: '800 × 600',  w: 800,  h: 600 },
  { key: 'sq',   label: '560 × 560',  w: 560,  h: 560 },
  { key: 'wide', label: '1024 × 640', w: 1024, h: 640 },
  { key: 'sm',   label: '420 × 320',  w: 420,  h: 320 },
];

const PALETTE = [
  '#000000', '#454b54', '#8a939b', '#c9ced4', '#ffffff',
  '#e11d48', '#f97316', '#f59e0b', '#facc15', '#22c55e',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#d946ef', '#ec4899', '#78350f',
];

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

defineApp({
  id: 'paint',
  name: 'Static Paint',
  icon: 'edit-3',
  g1: '#ff6fae', g2: '#c4246c',
  category: 'Media',
  keywords: ['draw', 'paint', 'canvas', 'sketch', 'brush', 'art', 'doodle', 'image', 'png', 'colour', 'color', 'fill', 'draw together', 'friend', 'multiplayer'],
  desc: 'Draw and paint on a canvas — brushes, shapes, fill, then save a real PNG',
  singleton: true,
  win: { w: 940, h: 660, minW: 380, minH: 420 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['B', 'Brush'],
    ['E', 'Eraser'],
    ['L', 'Line'],
    ['R', 'Rectangle'],
    ['O', 'Ellipse'],
    ['G', 'Fill'],
    ['I', 'Eyedropper'],
    ['[ / ]', 'Smaller / bigger brush'],
    ['Mod+Z', 'Undo'],
    ['Mod+Shift+Z / Mod+Y', 'Redo'],
  ],

  mount(ctx) {
    const { root, win, api, opts } = ctx;
    const { h, icon, store, vfs, notify } = api;

    const reduced = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion:reduce)').matches);

    /* ---------------- persisted prefs ---------------- */
    const saved = (store.get(PREF_KEY) && typeof store.get(PREF_KEY) === 'object') ? store.get(PREF_KEY) : {};
    const S = {
      tool: TOOLS.some(t => t.id === saved.tool) ? saved.tool : 'brush',
      color: normHex(saved.color) || '#111318',
      size: clamp(Number(saved.size) || 6, 1, MAX_SIZE),
      sizeKey: SIZES.some(s => s.key === saved.sizeKey) ? saved.sizeKey : 'md',
      recent: Array.isArray(saved.recent) ? saved.recent.map(normHex).filter(Boolean).slice(0, RECENT_CAP) : [],
    };

    const DPR = clamp(window.devicePixelRatio || 1, 1, 2);
    let dead = false, busy = false, touched = false;

    /* live doc geometry (set by setDoc) */
    let viewW = 0, viewH = 0, backW = 0, backH = 0, sx = 1, sy = 1;

    /* history */
    const undo = [], redo = [];
    /* Draw together (see the header): the room, the shared stroke log, the base picture */
    const TG = { on: false, open: false, room: null, offs: [], me: 'h', log: D.makeLog(), redo: [], lamport: 0, n: 0, cur: null,
      base: null, pre: null, gotDoc: false, sentCanvas: false, img: null, imgDone: false, err: '', note: '', joinCode: '', rq: 0, flushT: 0, curT: 0, curPending: null, peerAt: null };

    /* ---------------- DOM ---------------- */
    const main = h('canvas.pnt__canvas', { 'aria-hidden': 'true' });
    const overlay = h('canvas.pnt__overlay', { role: 'img', 'aria-label': 'Drawing area — draw with the mouse, touch or pen', tabindex: '0' });
    const paper = h('div.pnt__paper', main, overlay);
    const stage = h('div.pnt__stage', paper);
    const mctx = main.getContext('2d', { willReadFrequently: true });
    const octx = overlay.getContext('2d');

    /* tools */
    const toolBtns = new Map();
    const seg = h('div.pnt__seg', { role: 'toolbar', 'aria-label': 'Tools' });
    for (const t of TOOLS) {
      const b = h('button.pnt__tool.tip', {
        type: 'button', 'aria-pressed': 'false',
        'aria-label': `${t.label} (${t.key})`, 'data-tip': `${t.label} · ${t.key}`,
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
    const openBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Open an image onto the canvas', 'data-tip': 'Open image', onclick: () => fileIn.click() }, icon('image'));
    const saveBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Save PNG to Pictures', 'data-tip': 'Save to Pictures', onclick: () => saveToPictures() }, icon('save'));
    const dlBtn = h('button.ibtn.tip', { type: 'button', 'aria-label': 'Download PNG', 'data-tip': 'Download', onclick: () => download() }, icon('download'));
    const tgBtn = h('button.btn.btn--sm.pnt__tgbtn', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => togglePanel() }, icon('users'), h('span', { text: 'Draw together' }));
    const acts = h('div.pnt__acts', undoBtn, redoBtn, clearBtn, h('div.pnt__div'), openBtn, saveBtn, dlBtn, h('div.pnt__div'), tgBtn);

    const fileIn = h('input.pnt__native', { type: 'file', accept: 'image/*', onchange: onFilePicked });

    const bar = h('div.pnt__bar',
      h('div.pnt__group', seg),
      h('div.pnt__group', sizeSel),
      h('div.pnt__spring'),
      h('div.pnt__group', acts),
      fileIn);

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

    const pnt = h('div.pnt', bar, stage, dock);
    root.appendChild(h('div.app.app--col', pnt));

    const applyStill = () => pnt.classList.toggle('is-still', reduced());
    applyStill();
    const offReduce = store.sub('prefs.reduceMotion', applyStill);

    /* ---------------- doc geometry ---------------- */
    function fillPaper() {
      mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.fillStyle = PAPER; mctx.fillRect(0, 0, backW, backH);
      mctx.restore();
    }
    function prepCtx(cx) {
      cx.setTransform(sx, 0, 0, sy, 0, 0);
      cx.lineCap = 'round'; cx.lineJoin = 'round';
    }
    function setDoc(w, h2, opts = {}) {
      let tmp = null;
      if (opts.preserve && backW && backH) {
        tmp = document.createElement('canvas'); tmp.width = backW; tmp.height = backH;
        tmp.getContext('2d').drawImage(main, 0, 0);
      }
      viewW = w; viewH = h2;
      backW = Math.max(1, Math.round(w * DPR)); backH = Math.max(1, Math.round(h2 * DPR));
      sx = backW / viewW; sy = backH / viewH;
      main.width = backW; main.height = backH; overlay.width = backW; overlay.height = backH;
      prepCtx(mctx); prepCtx(octx);
      fillPaper();
      if (tmp) { mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(tmp, 0, 0); mctx.restore(); }
      if (dimEl) dimEl.textContent = `${w} × ${h2}`;
    }
    function clearOverlay() {
      octx.save(); octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, backW, backH); octx.restore();
    }
    function fitCanvas() {
      const availW = stage.clientWidth - 34, availH = stage.clientHeight - 34;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / viewW, availH / viewH, 1);
      paper.style.width = Math.max(1, Math.round(viewW * scale)) + 'px';
      paper.style.height = Math.max(1, Math.round(viewH * scale)) + 'px';
    }

    function drawURL(url) {
      return new Promise(res => {
        const img = new Image();
        img.onload = () => {
          mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0);
          mctx.clearRect(0, 0, backW, backH);
          mctx.drawImage(img, 0, 0, backW, backH);
          mctx.restore(); res(true);
        };
        img.onerror = () => res(false);
        img.src = url;
      });
    }

    /* ---------------- history ---------------- */
    const snapEntry = () => ({ url: main.toDataURL('image/png'), w: viewW, h: viewH });
    function commit(before) {
      touched = true;
      if (TG.on) { updateHistory(); persistSoon(); return; }     /* in a room, undo works on strokes instead */
      undo.push(before); if (undo.length > HISTORY_CAP) undo.shift();
      redo.length = 0;
      updateHistory(); persistSoon();
    }
    function updateHistory() {
      if (TG.on) {
        undoBtn.disabled = !TG.log.list.some(st => st.a === TG.me && !st.undone);
        redoBtn.disabled = !TG.redo.length;
        return;
      }
      undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length;
    }
    async function applyEntry(e) {
      if (e.w !== viewW || e.h !== viewH) { setDoc(e.w, e.h); syncSizeSel(); }
      await drawURL(e.url); fitCanvas();
    }
    async function doUndo() {
      if (TG.on) { tgUndo(); return; }
      if (busy || !undo.length) return;
      busy = true; pnt.classList.add('is-busy');
      redo.push(snapEntry()); if (redo.length > HISTORY_CAP) redo.shift();
      await applyEntry(undo.pop());
      busy = false; pnt.classList.remove('is-busy');
      updateHistory(); persistSoon();
    }
    async function doRedo() {
      if (TG.on) { tgRedo(); return; }
      if (busy || !redo.length) return;
      busy = true; pnt.classList.add('is-busy');
      undo.push(snapEntry()); if (undo.length > HISTORY_CAP) undo.shift();
      await applyEntry(redo.pop());
      busy = false; pnt.classList.remove('is-busy');
      updateHistory(); persistSoon();
    }
    function syncSizeSel() {
      const m = SIZES.find(s => s.w === viewW && s.h === viewH);
      if (m) { S.sizeKey = m.key; sizeSel.value = m.key; }
    }

    /* ---------------- tools / colour / size ---------------- */
    function setTool(id) {
      if (!TOOLS.some(t => t.id === id)) return;
      S.tool = id;
      for (const [tid, b] of toolBtns) b.setAttribute('aria-pressed', String(tid === id));
      overlay.dataset.tool = id;
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
      const s = SIZES.find(x => x.key === key); if (!s) return;
      if (s.w === viewW && s.h === viewH) { S.sizeKey = key; savePrefsSoon(); return; }
      const before = snapEntry();
      setDoc(s.w, s.h, { preserve: true });
      S.sizeKey = key;
      commit(before); fitCanvas(); savePrefsSoon();
    }

    let prefTimer = 0;
    function savePrefsSoon() {
      clearTimeout(prefTimer);
      prefTimer = setTimeout(() => {
        prefTimer = 0;
        store.set(PREF_KEY, { tool: S.tool, color: S.color, size: S.size, sizeKey: S.sizeKey, recent: S.recent.slice() });
      }, 350);
    }

    /* ---------------- persistence of the drawing ---------------- */
    let persistTimer = 0;
    function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 800); }
    async function persistNow() {
      persistTimer = 0;
      try {
        const url = main.toDataURL('image/png');
        if (url.length > PERSIST_MAX) return;              /* too big to keep — a reload will start fresh */
        await misc.set(DOC_KEY, { url, w: viewW, h: viewH, at: Date.now() });
      } catch (e) { /* store unavailable — drawing still works this session */ }
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

    function strokeStyleFor(cx) {
      cx.strokeStyle = S.tool === 'eraser' ? PAPER : S.color;
      cx.fillStyle = S.tool === 'eraser' ? PAPER : S.color;
      cx.lineWidth = S.size;
    }
    function dot(x, y) {
      strokeStyleFor(mctx);
      mctx.beginPath(); mctx.arc(x, y, Math.max(0.4, S.size / 2), 0, Math.PI * 2); mctx.fill();
    }
    function segLine(a, b) {
      strokeStyleFor(mctx);
      mctx.beginPath(); mctx.moveTo(a.x, a.y); mctx.lineTo(b.x, b.y); mctx.stroke();
    }
    function drawShape(cx, tool, a, b, preview, color = S.color, size = S.size) {
      cx.strokeStyle = color; cx.lineWidth = size;
      cx.beginPath();
      if (tool === 'line') { cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); }
      else if (tool === 'rect') { cx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
      else if (tool === 'ellipse') {
        cx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      }
      cx.stroke();
    }

    function floodFill(px, py, hex) {
      const W = backW, H = backH;
      const img = mctx.getImageData(0, 0, W, H);
      const d = img.data;
      const si = (py * W + px) * 4;
      const tr = d[si], tg = d[si + 1], tb = d[si + 2], ta = d[si + 3];
      const { r, g, b } = hexToRgb(hex);
      if (tr === r && tg === g && tb === b && ta === 255) return false;
      const tol = 42;
      const matchC = i => (Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) + Math.abs(d[i + 3] - ta)) <= tol;
      const seen = new Uint8Array(W * H);
      const stack = [px, py];
      while (stack.length) {
        const y = stack.pop(), x0 = stack.pop();
        let x = x0;
        while (x > 0 && !seen[y * W + (x - 1)] && matchC(((y * W + (x - 1)) * 4))) x--;
        let up = false, down = false;
        while (x < W) {
          const p = y * W + x, i = p * 4;
          if (seen[p] || !matchC(i)) break;
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; seen[p] = 1;
          if (y > 0) { const pu = p - W; const m = !seen[pu] && matchC(pu * 4); if (m && !up) { stack.push(x, y - 1); up = true; } else if (!m) up = false; }
          if (y < H - 1) { const pd = p + W; const m = !seen[pd] && matchC(pd * 4); if (m && !down) { stack.push(x, y + 1); down = true; } else if (!m) down = false; }
          x++;
        }
      }
      mctx.putImageData(img, 0, 0);
      return true;
    }
    function pickAt(x, y) {
      const p = dev(x, y);
      const d = mctx.getImageData(p.x, p.y, 1, 1).data;
      return rgbToHex(d[0], d[1], d[2]);
    }

    /* pointer interaction */
    let drawing = null;   /* { tool, start, last, before, moved } */
    function onDown(e) {
      if (busy || e.button === 2) return;
      if (TG.on && !TG.gotDoc) return;                       /* joining: the friend's canvas is on its way */
      overlay.setPointerCapture?.(e.pointerId);
      const p = pos(e);

      if (S.tool === 'eyedropper') { setColor(pickAt(p.x, p.y), true); return; }
      if (S.tool === 'fill') {
        const before = TG.on ? null : snapEntry();
        const d = dev(p.x, p.y);
        if (floodFill(d.x, d.y, S.color)) { if (TG.on) tgStroke('fill', [p.x, p.y]); commit(before); }
        return;
      }
      const before = TG.on ? null : snapEntry();
      drawing = { tool: S.tool, start: p, last: p, before, moved: false };
      if (S.tool === 'brush' || S.tool === 'eraser') { dot(p.x, p.y); if (TG.on) tgBegin(p); }
      e.preventDefault();
    }
    function onMove(e) {
      if (TG.on) tgCursor(pos(e));
      if (!drawing) return;
      const p = pos(e);
      drawing.moved = true;
      if (drawing.tool === 'brush' || drawing.tool === 'eraser') {
        segLine(drawing.last, p); drawing.last = p;
        if (TG.on) tgPoint(p);
      } else {
        clearOverlay();
        drawShape(octx, drawing.tool, drawing.start, p, true);
      }
      e.preventDefault();
    }
    function onUp(e) {
      if (!drawing) return;
      const p = pos(e);
      const dr = drawing; drawing = null;
      if (dr.tool === 'line' || dr.tool === 'rect' || dr.tool === 'ellipse') {
        clearOverlay();
        drawShape(mctx, dr.tool, dr.start, p, false);
        if (TG.on) tgStroke(dr.tool, [dr.start.x, dr.start.y, p.x, p.y]);
      } else if (TG.on) tgEnd();
      if (dr.tool !== 'eraser' && S.tool !== 'eraser') pushRecent(S.color);
      commit(dr.before);
      try { overlay.releasePointerCapture?.(e.pointerId); } catch (err) { /* not captured */ }
    }
    function onCancel() {
      if (!drawing) return;
      const dr = drawing; drawing = null;
      if (dr.tool === 'line' || dr.tool === 'rect' || dr.tool === 'ellipse') {
        clearOverlay();                      /* nothing committed to the drawing yet — just drop the preview */
      } else {
        if (TG.on) tgEnd();
        commit(dr.before);                   /* freehand ink is already on the canvas */
      }
    }
    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onCancel);
    overlay.addEventListener('contextmenu', e => e.preventDefault());
    const onLeaveCanvas = () => { if (TG.on) tgCursor(null); };
    overlay.addEventListener('pointerleave', onLeaveCanvas);

    /* ---------------- clear / import / export ---------------- */
    async function clearCanvas() {
      const ok = await api.confirm({ title: 'Clear the canvas?', message: 'This wipes the whole drawing. You can still undo it afterwards.', ok: 'Clear', danger: true });
      if (!ok || dead) return;
      const before = TG.on ? null : snapEntry();
      fillPaper(); clearOverlay();
      if (TG.on) tgStroke('clear', []);
      commit(before);
    }

    function placeImage(img) {
      if (TG.on) { notify({ app: 'Static Paint', icon: 'info', title: 'Not while drawing together', message: 'Leave the room to open a picture onto the canvas.' }); return; }
      const before = snapEntry();
      fillPaper();
      const s = Math.min(viewW / img.width, viewH / img.height);
      const dw = img.width * s, dh = img.height * s;
      mctx.drawImage(img, (viewW - dw) / 2, (viewH - dh) / 2, dw, dh);
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
    const toBlob = () => new Promise(res => main.toBlob(res, 'image/png'));

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

    /* drop an image onto the stage */
    function onDragOver(e) { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); } }
    function onDrop(e) {
      const f = [...(e.dataTransfer?.files || [])].find(x => /^image\//.test(x.type));
      if (!f) return;
      e.preventDefault();
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => { if (!dead) placeImage(img); URL.revokeObjectURL(url); };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    }
    stage.addEventListener('dragover', onDragOver);
    stage.addEventListener('drop', onDrop);

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
      if (st.tool === 'clear') { fillPaper(); return; }
      if (!P.length || P.some(v => v === undefined)) return;
      if (st.tool === 'fill') { const d = dev(P[0], P[1]); floodFill(d.x, d.y, st.c); return; }
      if (st.tool === 'line' || st.tool === 'rect' || st.tool === 'ellipse') {
        if (P.length >= 4) drawShape(mctx, st.tool, { x: P[0], y: P[1] }, { x: P[2], y: P[3] }, false, st.c, st.w);
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
      fillPaper();
      if (TG.base) { mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(TG.base, 0, 0, backW, backH); mctx.restore(); }
      for (const st of TG.log.list) if (!st.undone) replay(st);
      touched = true;
      persistSoon();
    }
    const rerenderSoon = () => { if (!TG.rq) TG.rq = requestAnimationFrame(() => { TG.rq = 0; if (!dead) rerender(); }); };
    /* the oldest strokes are drawn into the base and can no longer be undone (the same rule on both sides) */
    function fold() {
      const out = TG.log.shift(D.LIMITS.fold);
      fillPaper();
      if (TG.base) { mctx.save(); mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(TG.base, 0, 0, backW, backH); mctx.restore(); }
      for (const st of out) if (!st.undone) replay(st);
      TG.base = copyCanvas(main);
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
      if (drawing) { drawing = null; clearOverlay(); }
      TG.room = room;
      TG.me = role === 'host' ? 'h' : 'g';
      TG.pre = snapEntry();
      TG.log.clear();
      TG.redo = [];
      TG.lamport = 0; TG.n = 0; TG.cur = null;
      TG.gotDoc = role === 'host';
      TG.sentCanvas = false;
      TG.img = null; TG.imgDone = false;
      TG.base = copyCanvas(main);
      TG.on = true;
      touched = true;                                         /* a saved drawing must not load over the shared one */
      sizeSel.disabled = true;
      openBtn.disabled = true;
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
      sizeSel.disabled = false;
      openBtn.disabled = false;
      if (was) {
        /* your copy stays; one Undo brings back what you had before the room */
        undo.length = 0; redo.length = 0;
        if (TG.pre) undo.push(TG.pre);
        TG.pre = null;
        TG.log.clear(); TG.redo = []; TG.base = null;
        persistSoon();
      }
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
          h('p.pnt-tg__fine', { text: 'Joining puts your friend’s canvas in place of yours. Leaving keeps a copy of the shared drawing, and Undo then brings yours back.' }));
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
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
        else if (k === 'y') { e.preventDefault(); doRedo(); }
        return;
      }
      if (e.altKey) return;
      const t = TOOLS.find(x => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) { e.preventDefault(); setTool(t.id); }
      else if (e.key === '[') { e.preventDefault(); setSize(S.size - 1); }
      else if (e.key === ']') { e.preventDefault(); setSize(S.size + 1); }
    }
    window.addEventListener('keydown', onKey);

    /* ---------------- resize tracking ---------------- */
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => fitCanvas()); ro.observe(stage); }
    else { window.addEventListener('resize', fitCanvas); }

    /* ---------------- init ---------------- */
    setTool(S.tool); setColor(S.color, false); setSize(S.size); renderRecents();
    setDoc(SIZES.find(s => s.key === S.sizeKey).w, SIZES.find(s => s.key === S.sizeKey).h);
    updateHistory();
    requestAnimationFrame(fitCanvas);

    /* restore a persisted drawing, unless the person already started one */
    (async () => {
      let rec = null;
      try { rec = await misc.get(DOC_KEY); } catch (e) { rec = null; }
      if (dead || touched || !rec || !rec.url || !rec.w || !rec.h) return;
      setDoc(rec.w, rec.h); syncSizeSel();
      await drawURL(rec.url);
      fitCanvas();
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
    });

    /* ---------------- teardown ---------------- */
    return () => {
      tgStop(true);
      offLiveTg();
      dead = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fitCanvas);
      overlay.removeEventListener('pointerdown', onDown);
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointercancel', onCancel);
      overlay.removeEventListener('pointerleave', onLeaveCanvas);
      stage.removeEventListener('dragover', onDragOver);
      stage.removeEventListener('drop', onDrop);
      offReduce?.();
      ro?.disconnect();
      if (prefTimer) { clearTimeout(prefTimer); store.set(PREF_KEY, { tool: S.tool, color: S.color, size: S.size, sizeKey: S.sizeKey, recent: S.recent.slice() }); }
      if (persistTimer) { clearTimeout(persistTimer); if (touched) persistNow(); }
      for (const u of dlUrls) { try { URL.revokeObjectURL(u); } catch (e) {} }
      dlUrls.clear();
    };
  },
});
