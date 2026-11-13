/* ============================================================
   Comic maker (Picture Tools, #118) — panels, speech bubbles and
   stickers on one page, saved as a picture.

   Pick a page shape and a layout of 1–6 panels (the same layouts the
   collage uses), then click pictures in the list: each fills the picked
   panel. Drag a picture inside its panel to pan it; the Zoom slider or
   the mouse wheel zooms it. Add speech, thought and caption bubbles:
   drag one to move it, drag the round handle at its corner to resize
   it, drag the pink dot on its tail to point it at someone. The text is
   sized to fill the bubble (type more and it gets smaller). Stickers
   come from the ones StaticOS ships and the ones you made in the
   sticker maker (~/Pictures/Stickers); shapes are boxes, ovals, stars
   and bursts. "Save PNG" draws the page afresh at its real size.

   Lettering is Bangers (Vernon Adams / the Bangers Project Authors),
   bundled in css/fonts/ under the SIL Open Font License 1.1 — licence
   file beside it, credited in About.

   Page coordinates are pixels of the page at its export size; the
   preview just scales the drawing.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, encode, saveBlob, clamp, picturesDir, listPictures } from './pt-common.js';
import { LAYOUTS, cellRects } from './pt-collage.js';
import * as media from '../core/media.js';
import * as HW from '../core/halloween.js';

export const COMIC_FONT = '"Bangers", "Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive, sans-serif';
export const PAGES = [
  { id: 'portrait', w: 1200, h: 1600, label: 'Portrait page · 1200 × 1600' },
  { id: 'landscape', w: 1600, h: 1200, label: 'Landscape page · 1600 × 1200' },
  { id: 'square', w: 1400, h: 1400, label: 'Square page · 1400 × 1400' },
];
const ONE = { id: '1-full', n: 1, name: 'One panel', cells: [[0, 0, 1, 1]] };
export const COMIC_LAYOUTS = [ONE, ...LAYOUTS];
const GAP_PCT = 3;
const KINDS = { speech: 'Speech', thought: 'Thought', caption: 'Caption' };
const SHAPES = { rect: 'Box', ellipse: 'Oval', star: 'Star', burst: 'Burst' };

/** Wrap upper-case text into lines no wider than maxW at the font already set on `m`. */
function wrap(m, text, maxW) {
  const out = [];
  for (const para of String(text).toUpperCase().split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (line && m.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
/** The biggest size at which the text fits the box. */
export function fitText(m, text, maxW, maxH) {
  const body = String(text || '').trim() ? text : ' ';
  for (let px = 120; px >= 12; px -= 2) {
    m.font = `${px}px ${COMIC_FONT}`;
    const lines = wrap(m, body, maxW);
    if (lines.length * px * 1.12 <= maxH && lines.every(l => m.measureText(l).width <= maxW)) return { px, lines };
  }
  m.font = `12px ${COMIC_FONT}`;
  return { px: 12, lines: wrap(m, body, maxW) };
}

const textBox = b => (b.kind === 'caption'
  ? { w: b.w * 0.92, h: b.h * 0.8 }
  : b.kind === 'thought' ? { w: b.w * 0.66, h: b.h * 0.58 } : { w: b.w * 0.7, h: b.h * 0.62 });

function bubblePath(b) {
  const p = new Path2D();
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2;
  if (b.kind === 'caption') { p.rect(b.x, b.y, b.w, b.h); return p; }
  const dx = (b.tx - cx) / rx, dy = (b.ty - cy) / ry;
  const far = dx * dx + dy * dy > 1.25;
  if (b.kind === 'thought') {
    p.ellipse(cx, cy, rx * 0.86, ry * 0.86, 0, 0, Math.PI * 2);
    const r = Math.min(rx, ry) * 0.3;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      const x = cx + Math.cos(a) * (rx - r * 0.55), y = cy + Math.sin(a) * (ry - r * 0.55);
      p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2);
    }
    if (far) {
      const th = Math.atan2(dy, dx);
      const sx = cx + Math.cos(th) * rx, sy = cy + Math.sin(th) * ry;
      [[0.28, 0.13], [0.58, 0.09], [0.86, 0.06]].forEach(([t, k]) => {
        const x = sx + (b.tx - sx) * t, y = sy + (b.ty - sy) * t, rr = Math.min(rx, ry) * k + 3;
        p.moveTo(x + rr, y); p.arc(x, y, rr, 0, Math.PI * 2);
      });
    }
    return p;
  }
  p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (far) {
    const th = Math.atan2(dy, dx);
    const A = th - 0.32, B = th + 0.32;
    p.moveTo(cx + Math.cos(A) * rx, cy + Math.sin(A) * ry);
    p.lineTo(b.tx, b.ty);
    p.lineTo(cx + Math.cos(B) * rx, cy + Math.sin(B) * ry);
    p.closePath();
  }
  return p;
}

function shapePath(s) {
  const p = new Path2D();
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, rx = s.w / 2, ry = s.h / 2;
  if (s.shape === 'rect') p.rect(s.x, s.y, s.w, s.h);
  else if (s.shape === 'ellipse') p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  else {
    const n = s.shape === 'star' ? 5 : 14, inner = s.shape === 'star' ? 0.42 : 0.68;
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n, k = i % 2 ? inner : 1;
      const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k;
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    p.closePath();
  }
  return p;
}

/** Draw a whole page in page coordinates. panels[i] = { bmp, zoom, px, py } | null */
export function paintPage(g, W, H, { layout, panels, items, imgs, ui = null }) {
  const m = g.canvas.__m || (g.canvas.__m = document.createElement('canvas').getContext('2d'));
  g.save();
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const lw = Math.max(3, W * 0.0042);
  const rects = cellRects(layout, W, H, GAP_PCT / 100 * Math.min(W, H));
  rects.forEach((r, i) => {
    const c = panels[i];
    g.save();
    g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    if (c?.bmp) {
      const { w: iw, h: ih } = sizeOfBitmap(c.bmp);
      const s = Math.max(r.w / iw, r.h / ih) * c.zoom;
      const dw = iw * s, dh = ih * s;
      g.drawImage(c.bmp, r.x + r.w / 2 - dw / 2 + c.px * (dw - r.w) / 2, r.y + r.h / 2 - dh / 2 + c.py * (dh - r.h) / 2, dw, dh);
    } else if (ui) {
      g.fillStyle = '#e6e6ea'; g.fillRect(r.x, r.y, r.w, r.h);
      g.fillStyle = '#9a9aa6';
      g.font = `${Math.max(14, r.h * 0.05)}px ${COMIC_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('CLICK A PICTURE', r.x + r.w / 2, r.y + r.h / 2);
    } else { g.fillStyle = '#fff'; g.fillRect(r.x, r.y, r.w, r.h); }
    g.restore();
    g.lineWidth = lw * 1.3; g.strokeStyle = '#111'; g.lineJoin = 'miter';
    g.strokeRect(r.x, r.y, r.w, r.h);
  });
  for (const it of items) {
    g.save();
    g.lineJoin = 'round';
    if (it.type === 'bubble') {
      const path = bubblePath(it);
      g.lineWidth = lw * 2; g.strokeStyle = '#111'; g.stroke(path);
      g.fillStyle = it.kind === 'caption' ? '#ffe9a6' : '#fff'; g.fill(path);
      const tb = textBox(it);
      const f = fitText(m, it.text, tb.w, tb.h);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${f.px}px ${COMIC_FONT}`;
      const lh = f.px * 1.12, y0 = it.y + it.h / 2 - (f.lines.length - 1) * lh / 2;
      f.lines.forEach((l, k) => g.fillText(l, it.x + it.w / 2, y0 + k * lh));
    } else if (it.type === 'sticker') {
      const img = imgs.get(it.key);
      if (img) g.drawImage(img, it.x, it.y, it.w, it.h);
    } else {
      const path = shapePath(it);
      g.fillStyle = it.fill; g.fill(path);
      g.lineWidth = lw * 1.4; g.strokeStyle = '#111'; g.stroke(path);
    }
    g.restore();
  }
  if (ui) {
    const sel = ui.sel;
    const k = ui.k || 1;
    const hl = (x, y, w, hh) => { g.save(); g.lineWidth = 2 / k; g.strokeStyle = '#ff456d'; g.setLineDash([8 / k, 5 / k]); g.strokeRect(x, y, w, hh); g.restore(); };
    const dot = (x, y, fill) => { g.save(); g.beginPath(); g.arc(x, y, 9 / k, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 2 / k; g.strokeStyle = '#fff'; g.stroke(); g.restore(); };
    if (sel?.kind === 'panel' && rects[sel.i]) { const r = rects[sel.i]; g.save(); g.lineWidth = 5 / k; g.strokeStyle = '#ff456d'; g.strokeRect(r.x, r.y, r.w, r.h); g.restore(); }
    if (sel?.kind === 'item') {
      const it = items.find(x => x.id === sel.id);
      if (it) {
        hl(it.x, it.y, it.w, it.h);
        dot(it.x + it.w, it.y + it.h, '#6a4bff');
        if (it.type === 'bubble' && it.kind !== 'caption') dot(it.tx, it.ty, '#ff456d');
      }
    }
  }
  g.restore();
}

export function mountComic({ api, root, opts }) {
  const { h, icon } = api;
  const S = {
    page: PAGES[0], layout: ONE, panels: Array(6).fill(null), items: [], sel: { kind: 'panel', i: 0 },
    imgs: new Map(), alive: true, busy: false, raf: 0, drag: null, nextId: 1, fill: '#ffd166',
  };
  const W = () => S.page.w, H = () => S.page.h;
  const panels = () => S.panels.slice(0, S.layout.n);
  const rectsNow = () => cellRects(S.layout, W(), H(), GAP_PCT / 100 * Math.min(W(), H()));
  const selItem = () => (S.sel?.kind === 'item' ? S.items.find(i => i.id === S.sel.id) : null);

  const cv = h('canvas.pt-comic__canvas', { 'aria-label': 'Comic page', tabindex: 0 });
  const g = cv.getContext('2d');
  const stage = h('div.pt__stage', h('div.pt-col__paper', cv));
  const foot = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });
  const meas = document.createElement('canvas').getContext('2d');

  /* ---------- drawing ---------- */
  function previewSize() {
    const aw = Math.max(120, stage.clientWidth - 40), ah = Math.max(120, stage.clientHeight - 40);
    const asp = W() / H();
    let w = aw, hh = w / asp;
    if (hh > ah) { hh = ah; w = hh * asp; }
    return { w: Math.max(60, Math.round(w)), h: Math.max(60, Math.round(hh)) };
  }
  let kPrev = 1;
  function draw() {
    S.raf = 0;
    if (!S.alive) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const p = previewSize();
    const bw = Math.round(p.w * dpr), bh = Math.round(p.h * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    cv.style.width = `${p.w}px`; cv.style.height = `${p.h}px`;
    kPrev = bw / W();
    g.setTransform(kPrev, 0, 0, kPrev, 0, 0);
    paintPage(g, W(), H(), { layout: S.layout, panels: panels(), items: S.items, imgs: S.imgs, ui: { sel: S.sel, k: kPrev } });
    const filled = panels().filter(Boolean).length;
    foot.textContent = `${S.layout.name} · ${filled} of ${S.layout.n} panels filled · ${S.items.length} on top · page ${W()} × ${H()} px`;
    saveBtn.disabled = S.busy;
    paintSide();
  }
  const redraw = () => { if (!S.raf) S.raf = requestAnimationFrame(draw); };

  /* ---------- page and layout ---------- */
  const layoutBtns = new Map();
  const layoutRow = h('div.pt-col__layouts', { role: 'radiogroup', 'aria-label': 'Panel layout' }, COMIC_LAYOUTS.map(l => {
    const tile = h('svg', { viewBox: '0 0 30 30', 'aria-hidden': 'true' },
      l.cells.map(([x, y, w, hh]) => h('rect', { x: x * 30 + 1.2, y: y * 30 + 1.2, width: w * 30 - 2.4, height: hh * 30 - 2.4, rx: 1.5 })));
    const b = h('button.pt-col__layout', {
      type: 'button', role: 'radio', 'aria-checked': 'false', title: `${l.n} ${l.n === 1 ? 'panel' : 'panels'} · ${l.name}`, dataset: { layout: l.id, n: l.n },
      'aria-label': `${l.n} ${l.n === 1 ? 'panel' : 'panels'}, ${l.name}`, onclick: () => setLayout(l.id),
    }, tile, h('span', { text: String(l.n) }));
    layoutBtns.set(l.id, b);
    return b;
  }));
  function setLayout(id) {
    S.layout = COMIC_LAYOUTS.find(l => l.id === id) || S.layout;
    if (S.sel?.kind === 'panel') S.sel = { kind: 'panel', i: clamp(S.sel.i, 0, S.layout.n - 1) };
    for (const [k, b] of layoutBtns) b.setAttribute('aria-checked', String(k === S.layout.id));
    redraw();
  }
  const pageSel = h('select', { 'aria-label': 'Page size', onchange: () => {
    const to = PAGES.find(p => p.id === pageSel.value) || S.page;
    const sx = to.w / S.page.w, sy = to.h / S.page.h;
    for (const it of S.items) {
      it.x *= sx; it.y *= sy; it.w *= sx; it.h *= sx;
      if (it.type === 'bubble') { it.tx *= sx; it.ty *= sy; }
    }
    S.page = to;
    redraw();
  } }, PAGES.map(p => h('option', { value: p.id, text: p.label })));

  /* ---------- the picked panel ---------- */
  const zoomOut = h('output', { text: '100%' });
  const zoomIn = h('input', { type: 'range', min: 100, max: 400, step: 1, value: 100, 'aria-label': 'Zoom the picture in this panel',
    oninput: () => { const c = S.panels[S.sel?.i]; if (S.sel?.kind !== 'panel' || !c) return; c.zoom = Number(zoomIn.value) / 100; redraw(); } });
  const panelName = h('b', { text: '' });
  const resetPanel = h('button.btn.btn--sm', { type: 'button', onclick: () => { const c = S.sel?.kind === 'panel' && S.panels[S.sel.i]; if (c) { c.zoom = 1; c.px = 0; c.py = 0; redraw(); } } }, icon('refresh'), h('span', { text: 'Reset' }));
  const emptyPanel = h('button.btn.btn--sm', { type: 'button', onclick: () => { if (S.sel?.kind === 'panel') { S.panels[S.sel.i] = null; redraw(); } } }, icon('x'), h('span', { text: 'Empty' }));
  const panelBox = h('div.pt-col__cell', h('div.pt__rowhead', panelName, h('span.pt__spacer'), resetPanel, emptyPanel),
    h('label.pt__slider', h('span', { text: 'Zoom' }), zoomIn, zoomOut));

  /* ---------- the picked item ---------- */
  const textIn = h('textarea.pt-comic__text', { rows: 3, 'aria-label': 'Bubble text', placeholder: 'What are they saying?',
    oninput: () => { const it = selItem(); if (it?.type === 'bubble') { it.text = textIn.value; redraw(); } } });
  const sizeOut = h('output', { text: '' });
  const sizeIn = h('input', { type: 'range', min: 4, max: 100, step: 1, value: 30, 'aria-label': 'Size of the picked item',
    oninput: () => {
      const it = selItem();
      if (!it) return;
      const w = Number(sizeIn.value) / 100 * W(), k = w / it.w;
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      it.w = w; it.h *= k; it.x = cx - it.w / 2; it.y = cy - it.h / 2;
      if (it.type === 'bubble') { it.tx = cx + (it.tx - cx) * k; it.ty = cy + (it.ty - cy) * k; }
      redraw();
    } });
  const fillIn = h('input', { type: 'color', value: S.fill, 'aria-label': 'Shape colour',
    oninput: () => { S.fill = fillIn.value; const it = selItem(); if (it?.type === 'shape') { it.fill = S.fill; redraw(); } } });
  const delBtn = h('button.btn.btn--sm', { type: 'button', 'aria-label': 'Remove the picked item', onclick: () => removeSel() }, icon('trash'), h('span', { text: 'Remove' }));
  const frontBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => { const it = selItem(); if (it) { S.items = S.items.filter(x => x !== it).concat(it); redraw(); } } }, icon('layers'), h('span', { text: 'To front' }));
  const itemName = h('b', { text: '' });
  const textRow = h('div.pt__group', h('b.pt__label', { text: 'Text' }), textIn);
  const fillRow = h('label.pt__line', h('span', { text: 'Colour' }), fillIn);
  const itemBox = h('div.pt-col__cell.pt-comic__item', { hidden: true },
    h('div.pt__rowhead', itemName, h('span.pt__spacer'), frontBtn, delBtn),
    textRow, fillRow, h('label.pt__slider', h('span', { text: 'Size' }), sizeIn, sizeOut));
  function paintSide() {
    const it = selItem();
    itemBox.hidden = !it;
    panelBox.hidden = !!it;
    if (it) {
      itemName.textContent = it.type === 'bubble' ? `${KINDS[it.kind]} bubble` : it.type === 'sticker' ? 'Sticker' : SHAPES[it.shape];
      textRow.hidden = it.type !== 'bubble';
      fillRow.hidden = it.type !== 'shape';
      if (it.type === 'bubble' && document.activeElement !== textIn) textIn.value = it.text;
      if (it.type === 'shape') fillIn.value = it.fill;
      sizeIn.value = String(Math.round(it.w / W() * 100));
      sizeOut.textContent = `${sizeIn.value}%`;
    } else {
      const i = S.sel?.kind === 'panel' ? S.sel.i : 0;
      const c = S.panels[i];
      panelName.textContent = c ? `Panel ${i + 1}: ${c.name}` : `Panel ${i + 1} is empty. Click a picture to fill it.`;
      zoomIn.disabled = resetPanel.disabled = emptyPanel.disabled = !c;
      zoomIn.value = c ? Math.round(c.zoom * 100) : 100;
      zoomOut.textContent = `${zoomIn.value}%`;
    }
  }
  function removeSel() {
    const it = selItem();
    if (!it) return;
    S.items = S.items.filter(x => x !== it);
    S.sel = { kind: 'panel', i: 0 };
    redraw();
  }

  /* ---------- adding things ---------- */
  function centre() {
    const rs = rectsNow();
    const r = S.sel?.kind === 'panel' ? rs[S.sel.i] : null;
    return r ? { x: r.x + r.w / 2, y: r.y + r.h * 0.3 } : { x: W() / 2, y: H() * 0.3 };
  }
  function addItem(it) {
    it.id = S.nextId++;
    S.items.push(it);
    S.sel = { kind: 'item', id: it.id };
    redraw();
    return it;
  }
  function addBubble(kind) {
    const c = centre();
    const w = W() * (kind === 'caption' ? 0.4 : 0.34), hh = W() * (kind === 'caption' ? 0.1 : 0.2);
    const it = addItem({ type: 'bubble', kind, x: clamp(c.x - w / 2, 0, W() - w), y: clamp(c.y - hh / 2, 0, H() - hh), w, h: hh,
      text: kind === 'caption' ? 'Meanwhile…' : kind === 'thought' ? 'Hmm…' : 'Hello!', tx: 0, ty: 0 });
    it.tx = it.x + w * 0.3; it.ty = it.y + hh + W() * 0.09;
    if (kind !== 'caption') { textIn.focus(); textIn.select(); }
  }
  function addShape(shape) {
    const c = centre(), w = W() * 0.2;
    addItem({ type: 'shape', shape, x: clamp(c.x - w / 2, 0, W() - w), y: clamp(c.y - w / 2, 0, H() - w), w, h: w, fill: S.fill });
  }
  async function imgFor(key, url) {
    if (S.imgs.has(key)) return S.imgs.get(key);
    const img = new Image();
    img.src = url;
    await img.decode();
    S.imgs.set(key, img);
    return img;
  }
  async function addSticker(key, url, name) {
    try {
      const img = await imgFor(key, url);
      if (!S.alive) return;
      const iw = img.naturalWidth || 100, ih = img.naturalHeight || 100;
      const w = W() * 0.2, hh = w * ih / iw, c = centre();
      addItem({ type: 'sticker', key, name, x: clamp(c.x - w / 2, 0, W() - w), y: clamp(c.y - hh / 2, 0, Math.max(0, H() - hh)), w, h: hh });
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Can’t use that sticker', message: err?.message || String(err) });
    }
  }
  const bubbleBtns = Object.entries(KINDS).map(([k, label]) => h('button.btn.btn--sm', { type: 'button', dataset: { add: k }, onclick: () => addBubble(k) }, icon('message-circle'), h('span', { text: label })));
  const shapeBtns = Object.entries(SHAPES).map(([k, label]) => h('button.btn.btn--sm', { type: 'button', dataset: { shape: k }, onclick: () => addShape(k) }, h('span', { text: label })));
  const stickerGrid = h('div.pt-comic__stickers', { role: 'group', 'aria-label': 'Stickers' });
  function fillStickers() {
    const cells = HW.STICKERS.map(s => h('button.pt-comic__sticker', {
      type: 'button', title: s.name, 'aria-label': `Add the ${s.name} sticker`, dataset: { sticker: s.id }, onclick: () => addSticker(`hw:${s.id}`, HW.artUrl('sticker', s.id), s.name),
    }, h('img', { src: HW.artUrl('sticker', s.id), alt: '', draggable: 'false' })));
    const mine = listPictures().filter(p => p.path.includes('/Pictures/Stickers/'));
    for (const p of mine) {
      const img = h('img', { alt: '', draggable: 'false' });
      media.urlOf(p.path).then(u => { if (u && S.alive) img.src = u; }).catch(() => {});
      cells.push(h('button.pt-comic__sticker', {
        type: 'button', title: p.name, 'aria-label': `Add your sticker ${p.name}`, dataset: { sticker: `user:${p.name}` },
        onclick: async () => { const u = await media.urlOf(p.path); if (u) addSticker(`user:${p.path}`, u, p.name); },
      }, img));
    }
    stickerGrid.replaceChildren(...cells);
  }

  /* ---------- pictures ---------- */
  const picker = pickerView(api, { label: 'Pictures for the panels', onChange: async (list, src, added) => {
    if (!added) return;
    picker.clear();
    const i = S.sel?.kind === 'panel' ? S.sel.i : Math.max(0, panels().findIndex(c => !c));
    try {
      const bmp = await bitmapOf(await blobOfSource(src));
      if (!S.alive) return;
      S.panels[i] = { src, name: src.name, bmp, zoom: 1, px: 0, py: 0 };
      const next = panels().findIndex((c, k) => !c && k !== i);
      S.sel = { kind: 'panel', i: next >= 0 ? next : i };
      redraw();
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Can’t use that picture', message: err?.message || String(err) });
    }
  } });

  /* ---------- the mouse ---------- */
  const toPage = e => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W(), y: (e.clientY - r.top) / r.height * H(), k: r.width / W() };
  };
  function hit(p) {
    const it = selItem();
    const near = (x, y) => Math.hypot(p.x - x, p.y - y) * p.k <= 12;
    if (it) {
      if (it.type === 'bubble' && it.kind !== 'caption' && near(it.tx, it.ty)) return { what: 'tail', it };
      if (near(it.x + it.w, it.y + it.h)) return { what: 'size', it };
    }
    for (let i = S.items.length - 1; i >= 0; i--) {
      const q = S.items[i];
      if (p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h) return { what: 'move', it: q };
    }
    const i = rectsNow().findIndex(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    return i >= 0 && i < S.layout.n ? { what: 'panel', i } : null;
  }
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    cv.focus();
    const p = toPage(e), t = hit(p);
    if (!t) { S.sel = null; redraw(); return; }
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    if (t.what === 'panel') {
      S.sel = { kind: 'panel', i: t.i };
      const c = S.panels[t.i];
      S.drag = c ? { what: 'pan', i: t.i, x: p.x, y: p.y, px: c.px, py: c.py } : null;
    } else {
      S.sel = { kind: 'item', id: t.it.id };
      const it = t.it;
      S.drag = { what: t.what, it, x: p.x, y: p.y, o: { x: it.x, y: it.y, w: it.w, h: it.h, tx: it.tx, ty: it.ty } };
    }
    redraw();
  });
  cv.addEventListener('pointermove', e => {
    const d = S.drag;
    if (!d) return;
    const p = toPage(e), dx = p.x - d.x, dy = p.y - d.y;
    if (d.what === 'pan') {
      const c = S.panels[d.i], r = rectsNow()[d.i];
      const { w: iw, h: ih } = sizeOfBitmap(c.bmp);
      const s = Math.max(r.w / iw, r.h / ih) * c.zoom;
      const ovx = (iw * s - r.w) / 2, ovy = (ih * s - r.h) / 2;
      c.px = ovx > 0.5 ? clamp(d.px - dx / ovx, -1, 1) : 0;
      c.py = ovy > 0.5 ? clamp(d.py - dy / ovy, -1, 1) : 0;
    } else if (d.what === 'move') {
      const it = d.it;
      it.x = d.o.x + dx; it.y = d.o.y + dy;
      if (it.type === 'bubble') { it.tx = d.o.tx + dx; it.ty = d.o.ty + dy; }
    } else if (d.what === 'tail') {
      d.it.tx = d.o.tx + dx; d.it.ty = d.o.ty + dy;
    } else if (d.what === 'size') {
      const it = d.it;
      const w = Math.max(40, d.o.w + dx);
      it.w = w;
      it.h = it.type === 'sticker' ? w * d.o.h / d.o.w : Math.max(30, d.o.h + dy);
    }
    redraw();
  });
  const endDrag = () => { S.drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', e => {
    const t = hit(toPage(e));
    if (t?.what !== 'panel' || !S.panels[t.i]) return;
    e.preventDefault();
    const c = S.panels[t.i];
    S.sel = { kind: 'panel', i: t.i };
    c.zoom = clamp(c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 1, 4);
    redraw();
  }, { passive: false });
  cv.addEventListener('keydown', e => {
    const it = selItem();
    if (!it) return;
    const step = e.shiftKey ? 40 : 8;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) {
      e.preventDefault();
      it.x += mv[0]; it.y += mv[1];
      if (it.type === 'bubble') { it.tx += mv[0]; it.ty += mv[1]; }
      redraw();
    } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); }
  });

  /* ---------- export ---------- */
  const saveBtn = h('button.btn.btn--primary', { type: 'button', 'aria-label': 'Save comic page to Pictures', onclick: () => save() }, icon('save'), h('span', { text: 'Save PNG' }));
  async function save() {
    if (S.busy) return;
    S.busy = true; saveBtn.disabled = true;
    try {
      try { await document.fonts.load(`40px ${COMIC_FONT}`); } catch (e) { /* the fallback font is fine */ }
      const c = document.createElement('canvas');
      c.width = W(); c.height = H();
      paintPage(c.getContext('2d'), W(), H(), { layout: S.layout, panels: panels(), items: S.items, imgs: S.imgs, ui: null });
      const blob = await encode(c, 'image/png');
      c.width = c.height = 0;
      if (!blob) throw new Error('This browser couldn’t make a PNG.');
      await saveBlob(api, 'Picture Tools', picturesDir(), `Comic ${W()}x${H()}.png`, blob, { title: 'Comic saved' });
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Not saved', message: err?.message || String(err) });
    } finally {
      S.busy = false;
      if (S.alive) redraw();
    }
  }

  const side = h('div.pt__side',
    h('div.pt__group', h('b.pt__label', { text: 'Page' }), pageSel, layoutRow),
    panelBox, itemBox,
    h('div.pt__group', h('b.pt__label', { text: 'Bubbles' }), h('div.pt-comic__adds', bubbleBtns)),
    h('div.pt__group', h('b.pt__label', { text: 'Shapes' }), h('div.pt-comic__adds', shapeBtns)),
    h('div.pt__group', h('b.pt__label', { text: 'Stickers' }), stickerGrid),
    h('div.pt__group', h('b.pt__label', { text: 'Pictures' }), picker.el),
    h('div.pt__actions', saveBtn));
  root.append(h('div.pt__split', h('div.pt__col', stage, foot), side));
  fillStickers();
  setLayout(S.layout.id);
  document.fonts?.load?.(`40px ${COMIC_FONT}`).then(() => redraw()).catch(() => {});

  const ro = new ResizeObserver(() => redraw());
  ro.observe(stage);
  const first = opts?.path && sourceOfPath(opts.path);
  if (first) picker.pick(first);

  root.comicPeek = () => ({
    W: W(), H: H(), page: S.page.id, layout: S.layout.id, sel: S.sel,
    rects: rectsNow().slice(0, S.layout.n),
    panels: panels().map(c => c && { name: c.name, zoom: c.zoom, px: c.px, py: c.py }),
    items: S.items.map(i => ({ ...i, fontPx: i.type === 'bubble' ? fitText(meas, i.text, textBox(i).w, textBox(i).h).px : 0 })),
    preview: (() => { const r = cv.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })(),
  });

  return () => {
    S.alive = false;
    cancelAnimationFrame(S.raf);
    ro.disconnect();
    picker.destroy();
    for (const c of S.panels) try { c?.bmp?.close?.(); } catch (e) { /* already closed */ }
    cv.width = cv.height = 0;
  };
}
