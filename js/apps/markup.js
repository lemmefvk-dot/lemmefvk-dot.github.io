/* ============================================================
   Markup — draw on a picture before keeping it.

   Opened with { path } from a screenshot's notification, Photos
   (menu, viewer) or Files (right-click a picture). Without one it
   offers the newest pictures in ~/Pictures.

   The picture is drawn at its own size on one <canvas> that is
   both what you see (scaled to fit, or zoomed) and what is saved:
   Save re-draws the picture and every mark onto it and encodes
   that canvas as a PNG, so the saved pixels are the preview's.

   Marks stay objects until then: arrows, boxes, freehand pen
   strokes, text (typed in place; click it with the Text tool to
   select or drag it, click again or Enter to edit, Delete to
   remove) and blur, which pixelates the region under it in
   blocks so what was there can't be read. Colour and thickness
   apply to the next mark. Undo / redo keep every change.

   Save keeps a copy — "<name> (marked up).png" beside the
   original (" 2"… if taken). "Replace original" is a separate,
   confirmed choice: the file gets the new bytes (a .jpg becomes
   .png, since that is what it now is), through media.replace.

   Keys: A arrow, R box, P pen, T text, B blur; ⌘/Ctrl+Z undo,
   ⌘/Ctrl+Shift+Z (or Ctrl+Y) redo; Esc cancels the mark being
   drawn (or ends typing); Delete removes the selected text; 0 fits,
   + and − zoom, ⌘/Ctrl+S saves a copy. Pointer events, so a finger
   draws on a phone the same as a mouse.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as media from '../core/media.js';
import { importBlock } from '../core/fileimport.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-markup-css')) {
  const l = document.createElement('link');
  l.id = 'feat-markup-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-markup.css';
  document.head.appendChild(l);
}

const ARROW_SVG = '<svg viewBox="0 0 24 24"><path d="M5 19 18 6"/><path d="M9 5h10v10"/></svg>';
const BLUR_SVG = '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 12h17M12 3.5v17"/><path d="M4 4h8v8H4zM12 12h8v8h-8z" fill="currentColor" stroke="none" opacity=".45"/></svg>';
const REDO_SVG = '<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

const TOOLS = [
  { id: 'arrow', label: 'Arrow', key: 'A', svg: ARROW_SVG },
  { id: 'rect', label: 'Box', key: 'R', icon: 'square' },
  { id: 'pen', label: 'Pen', key: 'P', icon: 'edit-3' },
  { id: 'text', label: 'Text', key: 'T', icon: 'type' },
  { id: 'blur', label: 'Blur', key: 'B', svg: BLUR_SVG },
];
const COLORS = [
  ['#ff3b5c', 'Red'], ['#ff9500', 'Orange'], ['#ffd60a', 'Yellow'], ['#30d158', 'Green'],
  ['#2f8cff', 'Blue'], ['#ffffff', 'White'], ['#111111', 'Black'],
];
/* line width in picture pixels at 1200 px across; bigger pictures scale up */
const SIZES = [{ id: 's', label: 'Thin', w: 3 }, { id: 'm', label: 'Medium', w: 6 }, { id: 'l', label: 'Thick', w: 11 }];
const PREF = 'portal.markup';
const LINE = 1.25;                         /* text line height */
const HIST_CAP = 120;
const MAX_SIDE = 16384;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stemOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };
const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
function luma(hex) {
  const v = parseInt(hex.slice(1), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

function loadImage(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  return img.decode().then(() => img);
}

defineApp({
  id: 'markup',
  name: 'Markup',
  icon: 'edit-3',
  g1: '#ff6b8e', g2: '#d01848',
  category: 'Media',
  keywords: ['markup', 'annotate', 'draw on picture', 'arrow', 'highlight', 'blur', 'pixelate', 'redact', 'screenshot'],
  desc: 'Draw arrows, boxes, text and blur on a picture, then save it',
  hidden: true,
  win: { w: 980, h: 680, minW: 420, minH: 380 },

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, vfs, store } = api;
    const pref = (() => { const v = store.get(PREF); return v && typeof v === 'object' ? v : {}; })();

    const S = {
      path: null, name: '', W: 0, H: 0, base: null, unit: 1,
      tool: TOOLS.some(t => t.id === pref.tool) ? pref.tool : 'arrow',
      color: isHex(pref.color) ? pref.color : COLORS[0][0],
      size: SIZES.some(s => s.id === pref.size) ? pref.size : 'm',
      shapes: [], undo: [], redo: [],
      live: null,          /* the mark being drawn, or the text being dragged */
      drag: null,          /* { kind:'draw'|'move', id, x0, y0, ... } */
      sel: null,           /* id of the selected text */
      edit: null,          /* { id, isNew, before, ta } — text being typed */
      zoom: 1, fitMode: true,
      busy: false, dirty: false, seq: 0, alive: true,
    };
    const savePref = () => store.set(PREF, { tool: S.tool, color: S.color, size: S.size });

    /* ---------------- canvases ---------------- */
    const cv = h('canvas.mk__canvas', { 'aria-label': 'Picture being marked up' });
    const dctx = cv.getContext('2d', { willReadFrequently: true });
    const comp = document.createElement('canvas');          /* the picture + every finished mark */
    const cctx = comp.getContext('2d', { willReadFrequently: true });
    const meas = document.createElement('canvas').getContext('2d');

    /* ---------------- chrome ---------------- */
    const toolBtns = TOOLS.map(t => h('button.mk__tool', {
      type: 'button', dataset: { tool: t.id }, 'aria-label': `${t.label} (${t.key})`, title: `${t.label} (${t.key})`,
      'aria-pressed': 'false', onclick: () => setTool(t.id),
    }, t.svg ? h('span.icon', { html: t.svg }) : icon(t.icon)));
    const swatches = COLORS.map(([c, label]) => h('button.mk__swatch', {
      type: 'button', dataset: { color: c }, 'aria-label': label, title: label, 'aria-pressed': 'false',
      style: { '--sw': c }, onclick: () => setColor(c),
    }));
    const custom = h('input.mk__custom', { type: 'color', value: S.color, 'aria-label': 'Other colour', title: 'Other colour',
      oninput: e => setColor(e.target.value) });
    const sizeBtns = SIZES.map(s => h('button.mk__size', {
      type: 'button', dataset: { size: s.id }, 'aria-label': s.label, title: s.label, 'aria-pressed': 'false',
      onclick: () => setSize(s.id),
    }, h('i', { style: { '--d': `${4 + s.w * 1.1}px` } })));
    const undoBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'aria-label': 'Undo', 'data-tip': 'Undo (⌘Z)', onclick: () => undo() }, icon('rotate-ccw'));
    const redoBtn = h('button.ibtn.tip.tip--below', { type: 'button', 'aria-label': 'Redo', 'data-tip': 'Redo (⇧⌘Z)', onclick: () => redo() }, h('span.icon', { html: REDO_SVG }));
    const zoomLbl = h('button.mk__zlbl', { type: 'button', title: 'Zoom to fit (0)', 'aria-label': 'Zoom to fit', onclick: () => fit() });
    const zOut = h('button.ibtn', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out (−)', onclick: () => zoomBy(1 / 1.25) }, icon('zoom-out'));
    const zIn = h('button.ibtn', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => zoomBy(1.25) }, icon('zoom-in'));
    const saveBtn = h('button.btn.btn--sm.btn--primary.mk__save', { type: 'button', 'aria-label': 'Save copy', onclick: () => save(false), title: 'Save a marked-up copy beside the original (⌘S)' },
      icon('save'), h('span', { text: 'Save copy' }));
    const replaceBtn = h('button.btn.btn--sm.mk__replace', { type: 'button', 'aria-label': 'Replace original', onclick: () => save(true), title: 'Overwrite the original picture with the marked-up one' },
      icon('refresh'), h('span', { text: 'Replace original' }));

    const bar = h('div.mk__bar', { role: 'toolbar', 'aria-label': 'Markup tools' },
      h('div.mk__seg', { role: 'group', 'aria-label': 'Tool' }, toolBtns),
      h('div.mk__group', { role: 'group', 'aria-label': 'Colour' }, swatches, custom),
      h('div.mk__group.mk__sizes', { role: 'group', 'aria-label': 'Thickness' }, sizeBtns),
      h('div.mk__spring'),
      h('div.mk__group', undoBtn, redoBtn),
      h('div.mk__group.mk__zoom', zOut, zoomLbl, zIn),
      h('div.mk__group', replaceBtn, saveBtn));
    const selBox = h('div.mk__selbox', { hidden: true, 'aria-hidden': 'true' });
    const paper = h('div.mk__paper', cv, selBox);
    const stage = h('div.mk__stage', paper);
    const foot = h('div.mk__foot', { role: 'status', 'aria-live': 'polite' });
    const app = h('div.app.mk', bar, stage, foot);
    root.appendChild(app);

    /* ---------------- drawing ---------------- */
    const family = () => (getComputedStyle(document.body).getPropertyValue('--font').trim() || 'system-ui, sans-serif');
    const fontOf = px => `600 ${px}px ${family()}`;
    const sizeOf = () => SIZES.find(s => s.id === S.size) || SIZES[1];
    const strokeW = () => Math.max(1, Math.round(sizeOf().w * S.unit));
    const textPx = () => Math.round((14 + sizeOf().w * 3) * S.unit);
    const blockPx = () => Math.max(6, Math.round(sizeOf().w * 2.4 * S.unit));

    function drawArrow(g, s) {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) return;
      const ang = Math.atan2(dy, dx);
      const head = Math.min(len * 0.6, Math.max(10, s.w * 3.4));
      g.strokeStyle = g.fillStyle = s.color;
      g.lineWidth = s.w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(s.x1, s.y1);
      g.lineTo(s.x2 - Math.cos(ang) * head * 0.7, s.y2 - Math.sin(ang) * head * 0.7);
      g.stroke();
      g.beginPath();
      g.moveTo(s.x2, s.y2);
      g.lineTo(s.x2 - head * Math.cos(ang - 0.42), s.y2 - head * Math.sin(ang - 0.42));
      g.lineTo(s.x2 - head * Math.cos(ang + 0.42), s.y2 - head * Math.sin(ang + 0.42));
      g.closePath();
      g.fill();
    }
    function drawPen(g, s) {
      const p = s.pts;
      g.strokeStyle = g.fillStyle = s.color;
      g.lineWidth = s.w;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      if (p.length <= 2) { g.beginPath(); g.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2); g.fill(); return; }
      g.beginPath();
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length - 2; i += 2) g.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
      g.lineTo(p[p.length - 2], p[p.length - 1]);
      g.stroke();
    }
    function drawText(g, s) {
      if (!s.text) return;
      g.font = fontOf(s.size);
      g.textBaseline = 'top';
      g.lineJoin = 'round';
      const lines = s.text.split('\n');
      const lh = s.size * LINE;
      /* a halo in the opposite tone keeps text readable on any picture */
      g.lineWidth = Math.max(2, s.size / 6);
      g.strokeStyle = luma(s.color) > 0.55 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.85)';
      lines.forEach((l, i) => g.strokeText(l, s.x, s.y + i * lh));
      g.fillStyle = s.color;
      lines.forEach((l, i) => g.fillText(l, s.x, s.y + i * lh));
    }
    /** Blocks of the average colour: what was under it can't be read back. */
    function pixelate(g, s) {
      const x0 = clamp(Math.floor(s.x), 0, S.W), y0 = clamp(Math.floor(s.y), 0, S.H);
      const x1 = clamp(Math.ceil(s.x + s.width), 0, S.W), y1 = clamp(Math.ceil(s.y + s.height), 0, S.H);
      const w = x1 - x0, hh = y1 - y0;
      if (w < 1 || hh < 1) return;
      const img = g.getImageData(x0, y0, w, hh);
      const d = img.data;
      const b = Math.max(2, s.block | 0);
      for (let by = 0; by < hh; by += b) {
        for (let bx = 0; bx < w; bx += b) {
          const bw = Math.min(b, w - bx), bh = Math.min(b, hh - by);
          let r = 0, gg = 0, bl = 0, a = 0;
          for (let y = by; y < by + bh; y++) {
            for (let x = bx, i = (y * w + bx) * 4; x < bx + bw; x++, i += 4) { r += d[i]; gg += d[i + 1]; bl += d[i + 2]; a += d[i + 3]; }
          }
          const n = bw * bh;
          r = Math.round(r / n); gg = Math.round(gg / n); bl = Math.round(bl / n); a = Math.round(a / n);
          for (let y = by; y < by + bh; y++) {
            for (let x = bx, i = (y * w + bx) * 4; x < bx + bw; x++, i += 4) { d[i] = r; d[i + 1] = gg; d[i + 2] = bl; d[i + 3] = a; }
          }
        }
      }
      g.putImageData(img, x0, y0);
    }
    function drawShape(g, s) {
      g.save();
      if (s.type === 'arrow') drawArrow(g, s);
      else if (s.type === 'rect') {
        g.strokeStyle = s.color;
        g.lineWidth = s.w;
        g.lineJoin = 'round';
        g.strokeRect(s.x, s.y, s.width, s.height);
      } else if (s.type === 'pen') drawPen(g, s);
      else if (s.type === 'text') drawText(g, s);
      else if (s.type === 'blur') pixelate(g, s);
      g.restore();
    }
    const hiddenNow = s => (S.edit && s.id === S.edit.id) || (S.drag?.kind === 'move' && s.id === S.drag.id);

    /** Redraw the picture and every finished mark, then the screen. */
    function rebuild() {
      if (!S.base) return;
      cctx.clearRect(0, 0, S.W, S.H);
      cctx.drawImage(S.base, 0, 0, S.W, S.H);
      for (const s of S.shapes) if (!hiddenNow(s)) drawShape(cctx, s);
      paint();
    }
    function paint() {
      if (!S.base) return;
      dctx.clearRect(0, 0, S.W, S.H);
      dctx.drawImage(comp, 0, 0);
      if (S.live) drawShape(dctx, S.live);
      paintSel();
    }
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };

    /* ---------------- text boxes ---------------- */
    function textBox(s) {
      meas.font = fontOf(s.size);
      const lines = (s.text || ' ').split('\n');
      const w = Math.max(...lines.map(l => meas.measureText(l || ' ').width));
      return { x: s.x, y: s.y, w: Math.max(w, s.size * 0.6), h: lines.length * s.size * LINE };
    }
    function textAt(x, y) {
      for (let i = S.shapes.length - 1; i >= 0; i--) {
        const s = S.shapes[i];
        if (s.type !== 'text') continue;
        const b = textBox(s);
        const pad = 6 * S.unit;
        if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return s;
      }
      return null;
    }
    const byId = id => S.shapes.find(s => s.id === id) || null;
    function paintSel() {
      const s = S.sel && !S.edit ? byId(S.sel) : null;
      if (!s) { selBox.hidden = true; return; }
      const b = textBox(s);
      const z = S.zoom, pad = 4;
      selBox.hidden = false;
      Object.assign(selBox.style, {
        left: `${b.x * z - pad}px`, top: `${b.y * z - pad}px`, width: `${b.w * z + pad * 2}px`, height: `${b.h * z + pad * 2}px`,
      });
    }

    /** Type into a text box. `before` is the state to undo back to. */
    function startEdit(s, isNew, before = snapshot()) {
      finishEdit();
      S.sel = s.id;
      const ta = h('textarea.mk__text', {
        spellcheck: 'false', autocomplete: 'off', rows: 1, wrap: 'off',
        'aria-label': 'Text on the picture — Escape when done',
        oninput: () => { s.text = ta.value; sizeEditor(); },
        onkeydown: e => {
          e.stopPropagation();
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishEdit(); }
        },
        onpointerdown: e => e.stopPropagation(),
      });
      ta.value = s.text || '';               /* a property, not an attribute, for a textarea */
      S.edit = { id: s.id, isNew, before, ta, start: s.text || '' };
      paper.appendChild(ta);
      sizeEditor();
      rebuild();
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(ta.value.length, ta.value.length);
      paintBar();
    }
    function sizeEditor() {
      const ed = S.edit;
      const s = ed && byId(ed.id);
      if (!s) return;
      const z = S.zoom;
      const b = textBox({ ...s, text: s.text || ' ' });
      const halo = luma(s.color) > 0.55 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.85)';
      Object.assign(ed.ta.style, {
        left: `${s.x * z}px`, top: `${s.y * z}px`,
        width: `${(b.w + s.size) * z}px`, height: `${b.h * z + 2}px`,
        font: fontOf(s.size * z), lineHeight: String(LINE), color: s.color,
        textShadow: `0 0 ${Math.max(1, s.size * z / 8)}px ${halo}`,
      });
    }
    /** Stop typing: an empty box goes away; a change is one step to undo. */
    function finishEdit() {
      const ed = S.edit;
      if (!ed) return;
      S.edit = null;
      ed.ta.remove();
      const s = byId(ed.id);
      if (s) {
        s.text = s.text.replace(/\s+$/, '');
        if (!s.text.trim()) {
          S.shapes = S.shapes.filter(x => x !== s);
          if (S.sel === s.id) S.sel = null;
          if (!ed.isNew) record(ed.before);
        } else if (ed.isNew) {
          record(ed.before);
        } else if (s.text !== ed.start) {
          record(ed.before);
        }
      }
      rebuild();
      paintBar();
      if (S.alive && (document.activeElement === document.body || !document.activeElement)) paper.focus({ preventScroll: true });
    }

    /* ---------------- history ---------------- */
    const snapshot = () => JSON.stringify(S.shapes);
    /** The state before a change goes on the undo stack. */
    function record(before) {
      S.undo.push(before ?? snapshot());
      if (S.undo.length > HIST_CAP) S.undo.shift();
      S.redo.length = 0;
      S.dirty = true;
    }
    function restore(json) {
      S.shapes = JSON.parse(json);
      if (S.sel && !byId(S.sel)) S.sel = null;
      S.dirty = true;
      rebuild();
      paintBar();
    }
    function undo() {
      cancelLive();
      finishEdit();
      if (!S.undo.length) return;
      S.redo.push(snapshot());
      restore(S.undo.pop());
    }
    function redo() {
      cancelLive();
      finishEdit();
      if (!S.redo.length) return;
      S.undo.push(snapshot());
      restore(S.redo.pop());
    }
    function removeSelected() {
      const s = S.sel && byId(S.sel);
      if (!s) return;
      const before = snapshot();
      S.shapes = S.shapes.filter(x => x !== s);
      S.sel = null;
      record(before);
      rebuild();
      paintBar();
    }

    /* ---------------- pointer ---------------- */
    function local(e) {
      const r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * S.W) / r.width, y: ((e.clientY - r.top) * S.H) / r.height };
    }
    const newId = () => `m${++S.seq}`;
    function cancelLive() {
      if (!S.drag) return;
      const d = S.drag;
      S.drag = null;
      S.live = null;
      if (d.kind === 'move') { const s = byId(d.id); if (s) { s.x = d.sx; s.y = d.sy; } rebuild(); }
      else paint();
      try { if (d.pid != null) paper.releasePointerCapture(d.pid); } catch (e) { /* already released */ }
    }

    function onDown(e) {
      if (!S.base || S.busy) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      if (S.drag) return;                      /* a second finger while drawing */
      if (S.edit) { finishEdit(); if (S.tool === 'text') { e.preventDefault(); return; } }
      e.preventDefault();
      const p = local(e);
      const base = { pid: e.pointerId, x0: p.x, y0: p.y };
      if (S.tool === 'text') {
        const hit = textAt(p.x, p.y);
        if (hit) {
          S.drag = { ...base, kind: 'move', id: hit.id, sx: hit.x, sy: hit.y, wasSel: S.sel === hit.id, moved: false, before: snapshot() };
          S.sel = hit.id;
          S.live = hit;
          rebuild();
        } else {
          S.sel = null;
          const before = snapshot();
          const s = { id: newId(), type: 'text', x: p.x, y: p.y - textPx() * 0.5, text: '', color: S.color, size: textPx() };
          S.shapes.push(s);
          startEdit(s, true, before);
          return;
        }
      } else {
        S.sel = null;
        const common = { id: newId(), color: S.color, w: strokeW() };
        if (S.tool === 'arrow') S.live = { ...common, type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        else if (S.tool === 'rect') S.live = { ...common, type: 'rect', x: p.x, y: p.y, width: 0, height: 0 };
        else if (S.tool === 'pen') S.live = { ...common, type: 'pen', pts: [p.x, p.y] };
        else if (S.tool === 'blur') S.live = { id: common.id, type: 'blur', x: p.x, y: p.y, width: 0, height: 0, block: blockPx() };
        S.drag = { ...base, kind: 'draw' };
        paint();
      }
      try { paper.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    }
    function onMove(e) {
      const d = S.drag;
      if (!d || e.pointerId !== d.pid) return;
      const p = local(e);
      const s = S.live;
      if (d.kind === 'move') {
        const dx = p.x - d.x0, dy = p.y - d.y0;
        if (!d.moved && Math.hypot(dx, dy) * S.zoom < 3) return;
        d.moved = true;
        s.x = d.sx + dx;
        s.y = d.sy + dy;
      } else if (s.type === 'arrow') { s.x2 = p.x; s.y2 = p.y; }
      else if (s.type === 'pen') {
        const n = s.pts.length;
        if (Math.hypot(p.x - s.pts[n - 2], p.y - s.pts[n - 1]) * S.zoom >= 1.5) s.pts.push(p.x, p.y);
      } else {
        s.x = Math.min(d.x0, p.x); s.y = Math.min(d.y0, p.y);
        s.width = Math.abs(p.x - d.x0); s.height = Math.abs(p.y - d.y0);
      }
      schedule();
    }
    function onUp(e) {
      const d = S.drag;
      if (!d || e.pointerId !== d.pid) return;
      if (e.type === 'pointercancel') { cancelLive(); return; }
      S.drag = null;
      const s = S.live;
      S.live = null;
      try { paper.releasePointerCapture(d.pid); } catch (err) { /* released */ }
      if (d.kind === 'move') {
        if (d.moved) record(d.before);
        rebuild();
        paintBar();
        /* a click (no drag) on text that was already selected edits it */
        if (!d.moved && d.wasSel) startEdit(s, false);
        return;
      }
      const min = 3 / S.zoom;
      const tiny = s.type === 'arrow' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < min
        : s.type === 'pen' ? false
        : s.width < min || s.height < min;
      if (tiny) { paint(); return; }
      const before = snapshot();
      S.shapes.push(s);
      record(before);
      rebuild();
      paintBar();
    }
    paper.addEventListener('pointerdown', onDown);
    paper.addEventListener('pointermove', onMove);
    paper.addEventListener('pointerup', onUp);
    paper.addEventListener('pointercancel', onUp);
    paper.addEventListener('dblclick', e => {
      if (S.tool !== 'text' || S.edit) return;
      const p = local(e);
      const hit = textAt(p.x, p.y);
      if (hit) startEdit(hit, false);
    });

    /* ---------------- zoom ---------------- */
    function applyZoom() {
      paper.style.width = `${Math.max(1, Math.round(S.W * S.zoom))}px`;
      paper.style.height = `${Math.max(1, Math.round(S.H * S.zoom))}px`;
      zoomLbl.textContent = `${Math.round(S.zoom * 100)}%`;
      if (S.edit) sizeEditor();
      paintSel();
      paintFoot();
    }
    function fitZoom() {
      const pad = 24;
      const aw = Math.max(40, stage.clientWidth - pad * 2), ah = Math.max(40, stage.clientHeight - pad * 2);
      return S.W ? Math.min(1, aw / S.W, ah / S.H) : 1;
    }
    function fit() { if (!S.base) return; S.fitMode = true; S.zoom = fitZoom(); applyZoom(); }
    function zoomBy(f) { if (!S.base) return; S.fitMode = false; S.zoom = clamp(S.zoom * f, 0.05, 8); applyZoom(); }
    const ro = new ResizeObserver(() => { if (S.base && S.fitMode) { S.zoom = fitZoom(); applyZoom(); } });
    ro.observe(stage);

    /* ---------------- tool state ---------------- */
    function setTool(id) {
      if (!TOOLS.some(t => t.id === id)) return;
      cancelLive();
      finishEdit();
      if (id !== 'text') S.sel = null;
      S.tool = id;
      savePref();
      paint();
      paintBar();
    }
    function setColor(c) {
      if (!isHex(c)) return;
      S.color = c.toLowerCase();
      custom.value = S.color;
      /* a selected text box takes the colour too */
      const s = S.sel && byId(S.sel);
      if (s && s.color !== S.color) {
        const before = S.edit ? S.edit.before : snapshot();
        s.color = S.color;
        if (S.edit) sizeEditor(); else { record(before); rebuild(); }
      }
      savePref();
      paintBar();
    }
    function setSize(id) {
      S.size = id;
      const s = S.sel && byId(S.sel);
      if (s && !S.edit && s.size !== textPx()) { const before = snapshot(); s.size = textPx(); record(before); rebuild(); }
      else if (s && S.edit) { s.size = textPx(); sizeEditor(); }
      savePref();
      paintBar();
    }
    function paintBar() {
      for (const b of toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool));
      for (const b of swatches) b.setAttribute('aria-pressed', String(b.dataset.color === S.color));
      for (const b of sizeBtns) b.setAttribute('aria-pressed', String(b.dataset.size === S.size));
      paper.dataset.tool = S.tool;
      const none = !S.base;
      undoBtn.disabled = none || !S.undo.length;
      redoBtn.disabled = none || !S.redo.length;
      saveBtn.disabled = replaceBtn.disabled = none || S.busy;
      zOut.disabled = zIn.disabled = zoomLbl.disabled = none;
      paintFoot();
    }
    function paintFoot() {
      if (!S.base) { foot.textContent = ''; return; }
      const marks = S.shapes.length;
      const hint = S.edit ? 'Typing — Esc when done'
        : S.sel ? 'Text selected — drag to move, click to edit, Delete to remove'
        : `${TOOLS.find(t => t.id === S.tool).label}: ${S.tool === 'text' ? 'click to type' : 'drag on the picture'}`;
      foot.textContent = `${S.name} · ${S.W} × ${S.H} px · ${Math.round(S.zoom * 100)}% · ${marks ? `${marks} mark${marks === 1 ? '' : 's'}` : 'no marks yet'}${S.dirty ? ' · not saved' : ''} · ${hint}`;
    }

    /* ---------------- open ---------------- */
    function message(title, body) {
      api.render(stage, h('div.mk__msg', icon('image'), h('b', { text: title }), body ? h('small', { text: body }) : null));
    }
    async function open(path) {
      const n = path && vfs.node(path);
      if (!n || n.type !== 'file' || media.kindOf(n.name) !== 'image') { chooser(path ? 'That picture is no longer there.' : ''); return; }
      S.base = null;
      paintBar();
      message('Opening…');
      let img = null, why = '';
      try {
        const url = await media.urlOf(n);
        if (!url) why = 'Its bytes are missing from this browser.';
        else img = await loadImage(url);
      } catch (err) { why = 'Your browser couldn’t decode this picture.'; }
      if (!S.alive) return;
      const W = img?.naturalWidth || 0, H = img?.naturalHeight || 0;
      if (img && (!W || !H)) why = 'This picture has no size of its own, so it can’t be marked up.';
      const maxPx = document.body.classList.contains('is-mobile') ? 16_000_000 : 40_000_000;
      if (img && (W > MAX_SIDE || H > MAX_SIDE || W * H > maxPx)) why = `At ${W} × ${H} pixels it is too big to mark up in this browser.`;
      if (why) { message('Can’t mark up this picture', why); return; }
      S.path = vfs.norm(path);
      S.name = n.name;
      S.W = W; S.H = H;
      S.unit = Math.max(1, Math.max(W, H) / 1200);
      S.base = img;
      S.shapes = []; S.undo = []; S.redo = []; S.sel = null; S.dirty = false;
      cv.width = comp.width = W;
      cv.height = comp.height = H;
      api.render(stage, paper);
      win.setTitle(`${n.name} — Markup`);
      fit();
      rebuild();
      paintBar();
      paper.focus({ preventScroll: true });
    }
    /* no picture given: the newest ones in ~/Pictures */
    function chooser(note) {
      S.base = null;
      win.setTitle('Markup');
      const pics = [];
      vfs.walk(`${vfs.HOME}/Pictures`, (n, p) => {
        if (n.type === 'file' && media.kindOf(n.name) === 'image' && media.isMedia(n)) pics.push({ n, p });
      });
      pics.sort((a, b) => Date.parse(b.n.mtime) - Date.parse(a.n.mtime));
      const grid = h('div.mk__pick', pics.slice(0, 24).map(({ n, p }) => {
        const img = h('img', { alt: '', draggable: 'false' });
        media.urlOf(n).then(u => { if (u && S.alive) img.src = u; }).catch(() => {});
        return h('button.mk__pic', { type: 'button', title: n.name, onclick: () => open(p) }, img, h('span', { text: n.name }));
      }));
      api.render(stage, h('div.mk__msg.mk__msg--pick', icon('edit-3'),
        h('b', { text: note || 'Pick a picture to mark up' }),
        h('small', { text: pics.length
          ? 'Or use “Mark up” in Photos, in Files, or on a screenshot’s notification.'
          : 'There are no pictures in ~/Pictures yet. Take a screenshot or import one in Photos.' }),
        pics.length ? grid : null));
      paintBar();
    }

    /* ---------------- save ---------------- */
    const say = (title, message, extra = {}) => api.notify({ app: 'Markup', icon: 'edit-3', title, message, ...extra });
    async function save(replace) {
      if (!S.base || S.busy) return;
      cancelLive();
      finishEdit();
      const src = vfs.node(S.path);
      if (!src) { say('The original is gone', 'It was moved or deleted. Save a copy instead — it goes to ~/Pictures.'); if (replace) return; }
      const dir = src && !importBlock(vfs.parentPath(S.path)) ? vfs.parentPath(S.path) : `${vfs.HOME}/Pictures`;
      const pngName = `${stemOf(S.name)}.png`;
      if (replace) {
        const renamed = pngName !== S.name;
        const ok = await api.confirm({
          title: `Replace “${S.name}”?`,
          message: renamed
            ? `The original picture is replaced by the marked-up one, saved as a PNG named “${pngName}”. This can’t be undone.`
            : 'The original picture is replaced by the marked-up one. This can’t be undone.',
          ok: 'Replace original', danger: true,
        });
        if (!ok || !S.alive || !vfs.node(S.path)) return;
      }
      S.busy = true;
      paintBar();
      try {
        S.sel = null;
        rebuild();                               /* the screen is now exactly what gets saved */
        const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
        if (!blob) throw new Error('The picture could not be encoded as a PNG.');
        let path;
        if (replace) {
          ({ path } = await media.replace(S.path, blob, { name: pngName }));
          /* the marks are part of the picture now */
          const url = URL.createObjectURL(blob);
          try { S.base = await loadImage(url); } finally { URL.revokeObjectURL(url); }
          S.path = path;
          S.name = vfs.baseName(path);
          S.shapes = []; S.undo = []; S.redo = [];
          win.setTitle(`${S.name} — Markup`);
          if (S.alive) rebuild();
        } else {
          ({ path } = await media.save(dir, `${stemOf(S.name)} (marked up).png`, blob));
        }
        S.dirty = false;
        say(replace ? 'Original replaced' : 'Marked-up copy saved', `${vfs.baseName(path)} · ${api.fmt.fmtBytes(blob.size)}`, {
          actions: [
            { label: 'Open', onClick: () => api.openFile(path) },
            { label: 'Show in Files', onClick: () => api.openApp('files', { path }) },
          ],
        });
      } catch (err) {
        say('Not saved', err?.message || String(err), { icon: 'alert' });
      } finally {
        S.busy = false;
        if (S.alive) paintBar();
      }
    }

    /* ---------------- keyboard ---------------- */
    const onKey = e => {
      if (!S.alive || !win.el.classList.contains('is-active')) return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && !win.el.contains(ae)) return;
      if (S.edit) return;                       /* the text box handles its own keys */
      const tag = ae?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (mod && !e.altKey && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && !e.altKey && !e.shiftKey && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
      if (mod && !e.altKey && !e.shiftKey && (k === 's' || k === 'S')) { e.preventDefault(); save(false); return; }
      if (k === 'Escape') {
        if (S.drag) { e.preventDefault(); e.stopPropagation(); cancelLive(); return; }
        if (S.sel) { e.preventDefault(); S.sel = null; paint(); paintBar(); }
        return;
      }
      if ((k === 'Delete' || k === 'Backspace') && S.sel) { e.preventDefault(); removeSelected(); return; }
      if (k === 'Enter' && S.sel && tag !== 'BUTTON') { const s = byId(S.sel); if (s) { e.preventDefault(); startEdit(s, false); } return; }
      if (mod || e.altKey) return;
      if (k === '0') { e.preventDefault(); fit(); return; }
      if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1.25); return; }
      if (k === '-' || k === '_') { e.preventDefault(); zoomBy(1 / 1.25); return; }
      const t = TOOLS.find(x => x.key === k.toUpperCase());
      if (t && k.length === 1) { e.preventDefault(); setTool(t.id); }
    };
    window.addEventListener('keydown', onKey);

    /* the text font may arrive after the first draw: draw again with it */
    const onFonts = () => { if (S.alive && S.base && !S.busy) { rebuild(); if (S.edit) sizeEditor(); } };
    document.fonts?.addEventListener?.('loadingdone', onFonts);

    paper.tabIndex = 0;
    paper.setAttribute('role', 'application');
    paper.setAttribute('aria-label', 'Drawing area');
    paintBar();
    if (opts?.path) open(opts.path); else chooser('');

    return () => {
      S.alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.fonts?.removeEventListener?.('loadingdone', onFonts);
      ro.disconnect();
      cv.width = cv.height = comp.width = comp.height = 0;
    };
  },
});
