/* ============================================================
   Collage maker (Picture Tools, #110) — several pictures in one.

   Pick a layout (2–6 cells; grids and mosaics), then click pictures in
   the list: each goes into the picked cell and the pick moves on. Drag a
   picture inside its cell to pan it, scroll over it (or use the Zoom
   slider) to zoom. Gap, corner radius and background colour apply to the
   whole collage. Export is a PNG or JPEG at a chosen size, drawn fresh at
   that size from the original pictures (not the preview's pixels).

   Layouts are rectangles in a unit square, [x, y, w, h]; the same numbers
   give the preview and the export, whatever the export's shape. Gap and
   radius are percentages (of the shorter side, and of half a cell's
   shorter side), so they look the same at every size.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, encode, saveBlob, clamp, picturesDir, listPictures } from './pt-common.js';

const R = (x, y, w, h) => [x, y, w, h];
const t3 = 1 / 3, t23 = 2 / 3;
export const LAYOUTS = [
  { id: '2-cols', n: 2, name: 'Side by side', cells: [R(0, 0, .5, 1), R(.5, 0, .5, 1)] },
  { id: '2-rows', n: 2, name: 'Stacked', cells: [R(0, 0, 1, .5), R(0, .5, 1, .5)] },
  { id: '2-big', n: 2, name: 'Big and small', cells: [R(0, 0, t23, 1), R(t23, 0, t3, 1)] },
  { id: '3-cols', n: 3, name: 'Three columns', cells: [R(0, 0, t3, 1), R(t3, 0, t3, 1), R(t23, 0, t3, 1)] },
  { id: '3-left', n: 3, name: 'Mosaic: big left', cells: [R(0, 0, .6, 1), R(.6, 0, .4, .5), R(.6, .5, .4, .5)] },
  { id: '3-top', n: 3, name: 'Mosaic: wide top', cells: [R(0, 0, 1, .6), R(0, .6, .5, .4), R(.5, .6, .5, .4)] },
  { id: '4-grid', n: 4, name: '2 × 2 grid', cells: [R(0, 0, .5, .5), R(.5, 0, .5, .5), R(0, .5, .5, .5), R(.5, .5, .5, .5)] },
  { id: '4-left', n: 4, name: 'Mosaic: big left', cells: [R(0, 0, .6, 1), R(.6, 0, .4, t3), R(.6, t3, .4, t3), R(.6, t23, .4, t3)] },
  { id: '4-cols', n: 4, name: 'Four columns', cells: [R(0, 0, .25, 1), R(.25, 0, .25, 1), R(.5, 0, .25, 1), R(.75, 0, .25, 1)] },
  { id: '5-mosaic', n: 5, name: 'Mosaic: 2 over 3', cells: [R(0, 0, .5, .5), R(.5, 0, .5, .5), R(0, .5, t3, .5), R(t3, .5, t3, .5), R(t23, .5, t3, .5)] },
  { id: '5-big', n: 5, name: 'Big and four', cells: [R(0, 0, .5, 1), R(.5, 0, .25, .5), R(.75, 0, .25, .5), R(.5, .5, .25, .5), R(.75, .5, .25, .5)] },
  { id: '6-grid', n: 6, name: '3 × 2 grid', cells: [R(0, 0, t3, .5), R(t3, 0, t3, .5), R(t23, 0, t3, .5), R(0, .5, t3, .5), R(t3, .5, t3, .5), R(t23, .5, t3, .5)] },
  { id: '6-tall', n: 6, name: '2 × 3 grid', cells: [R(0, 0, .5, t3), R(.5, 0, .5, t3), R(0, t3, .5, t3), R(.5, t3, .5, t3), R(0, t23, .5, t3), R(.5, t23, .5, t3)] },
  { id: '6-mosaic', n: 6, name: 'Mosaic: big and five', cells: [R(0, 0, t23, t23), R(t23, 0, t3, t3), R(t23, t3, t3, t3), R(0, t23, t3, t3), R(t3, t23, t3, t3), R(t23, t23, t3, t3)] },
];
export const SIZES = [
  { id: '1080x1080', w: 1080, h: 1080, label: '1080 × 1080 (square)' },
  { id: '1920x1080', w: 1920, h: 1080, label: '1920 × 1080 (wide)' },
  { id: '1080x1920', w: 1080, h: 1920, label: '1080 × 1920 (tall)' },
  { id: '2048x2048', w: 2048, h: 2048, label: '2048 × 2048 (big square)' },
  { id: 'custom', w: 0, h: 0, label: 'Custom…' },
];
const EPS = 1e-6;

/** Pixel rectangles for a layout drawn at W × H with gap g (px). */
export function cellRects(layout, W, H, g) {
  return layout.cells.map(([x, y, w, h]) => {
    const l = x < EPS ? g : g / 2, t = y < EPS ? g : g / 2;
    const r = x + w > 1 - EPS ? g : g / 2, b = y + h > 1 - EPS ? g : g / 2;
    const px = x * W + l, py = y * H + t;
    return { x: px, y: py, w: Math.max(1, (x + w) * W - r - px), h: Math.max(1, (y + h) * H - b - py) };
  });
}

/** Paint the collage on a 2D context at W × H. cells[i] = { bmp, zoom, px, py } | null */
export function paintCollage(g, W, H, { layout, cells, gapPct, radiusPct, bg, selected = -1 }) {
  g.save();
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const gap = gapPct / 100 * Math.min(W, H);
  const rects = cellRects(layout, W, H, gap);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  rects.forEach((r, i) => {
    const c = cells[i];
    const rad = radiusPct / 100 * Math.min(r.w, r.h) / 2;
    g.save();
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, rad);
    if (!c?.bmp) {
      g.fillStyle = 'rgba(128,128,128,.28)';
      g.fill();
      g.clip();
      g.strokeStyle = 'rgba(128,128,128,.7)';
      g.lineWidth = Math.max(2, Math.min(r.w, r.h) * 0.01);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, k = Math.min(r.w, r.h) * 0.08;
      g.beginPath(); g.moveTo(cx - k, cy); g.lineTo(cx + k, cy); g.moveTo(cx, cy - k); g.lineTo(cx, cy + k); g.stroke();
    } else {
      g.clip();
      const { w: iw, h: ih } = sizeOfBitmap(c.bmp);
      const s = Math.max(r.w / iw, r.h / ih) * c.zoom;
      const dw = iw * s, dh = ih * s;
      const ox = r.x + r.w / 2 - dw / 2 + c.px * (dw - r.w) / 2;
      const oy = r.y + r.h / 2 - dh / 2 + c.py * (dh - r.h) / 2;
      g.drawImage(c.bmp, ox, oy, dw, dh);
    }
    g.restore();
    if (i === selected) {
      g.save();
      g.beginPath();
      g.roundRect(r.x, r.y, r.w, r.h, rad);
      g.lineWidth = Math.max(3, Math.min(W, H) * 0.004);
      g.strokeStyle = '#ff456d';
      g.stroke();
      g.restore();
    }
  });
  g.restore();
}

export function mountCollage({ api, root, opts }) {
  const { h, icon } = api;
  const S = {
    layout: LAYOUTS.find(l => l.id === '4-grid'), cells: Array(6).fill(null), sel: 0,
    gap: 2, radius: 0, bg: '#ffffff', size: '1080x1080', cw: 1080, ch: 1080, fmt: 'png', q: 90,
    alive: true, busy: false, drag: null, raf: 0,
  };
  const cells = () => S.cells.slice(0, S.layout.n);

  const cv = h('canvas.pt-col__canvas', { 'aria-label': 'Collage preview', tabindex: 0 });
  const g = cv.getContext('2d');
  const stage = h('div.pt__stage', h('div.pt-col__paper', cv));
  const foot = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });

  /* ---------- preview ---------- */
  function previewSize() {
    const aw = Math.max(120, stage.clientWidth - 40), ah = Math.max(120, stage.clientHeight - 40);
    const asp = S.cw / S.ch;
    let w = aw, hh = w / asp;
    if (hh > ah) { hh = ah; w = hh * asp; }
    return { w: Math.max(60, Math.round(w)), h: Math.max(60, Math.round(hh)) };
  }
  function draw() {
    S.raf = 0;
    if (!S.alive) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const p = previewSize();
    const bw = Math.round(p.w * dpr), bh = Math.round(p.h * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    cv.style.width = `${p.w}px`; cv.style.height = `${p.h}px`;
    paintCollage(g, bw, bh, { layout: S.layout, cells: cells(), gapPct: S.gap, radiusPct: S.radius, bg: S.bg, selected: S.sel });
    const filled = cells().filter(Boolean).length;
    foot.textContent = `${S.layout.name} · ${filled} of ${S.layout.n} filled · exports at ${S.cw} × ${S.ch} px`;
    saveBtn.disabled = S.busy || filled === 0;
    paintCellPanel();
  }
  const redraw = () => { if (!S.raf) S.raf = requestAnimationFrame(draw); };

  /* ---------- layout + settings ---------- */
  const layoutBtns = new Map();
  const layoutRow = h('div.pt-col__layouts', { role: 'radiogroup', 'aria-label': 'Layout' }, LAYOUTS.map(l => {
    const tile = h('svg', { viewBox: '0 0 30 30', 'aria-hidden': 'true' },
      l.cells.map(([x, y, w, hh]) => h('rect', { x: x * 30 + 1.2, y: y * 30 + 1.2, width: w * 30 - 2.4, height: hh * 30 - 2.4, rx: 1.5 })));
    const b = h('button.pt-col__layout', {
      type: 'button', role: 'radio', 'aria-checked': 'false', title: `${l.n} pictures · ${l.name}`, dataset: { layout: l.id, n: l.n },
      'aria-label': `${l.n} pictures, ${l.name}`, onclick: () => setLayout(l.id),
    }, tile, h('span', { text: String(l.n) }));
    layoutBtns.set(l.id, b);
    return b;
  }));
  function setLayout(id) {
    S.layout = LAYOUTS.find(l => l.id === id) || S.layout;
    S.sel = clamp(S.sel, 0, S.layout.n - 1);
    for (const [k, b] of layoutBtns) b.setAttribute('aria-checked', String(k === S.layout.id));
    redraw();
  }
  const slider = (label, key, min, max, unit, onchange) => {
    const out = h('output', { text: `${S[key]}${unit}` });
    const input = h('input', { type: 'range', min, max, step: 1, value: S[key], 'aria-label': label, dataset: { key },
      oninput: () => { S[key] = Number(input.value); out.textContent = `${S[key]}${unit}`; (onchange || redraw)(); } });
    return h('label.pt__slider', h('span', { text: label }), input, out);
  };
  const bgInput = h('input.pt-col__bg', { type: 'color', value: S.bg, 'aria-label': 'Background colour', oninput: () => { S.bg = bgInput.value; redraw(); } });
  const sizeSel = h('select', { 'aria-label': 'Export size', onchange: () => {
    S.size = sizeSel.value;
    const s = SIZES.find(x => x.id === S.size);
    if (s.w) { S.cw = s.w; S.ch = s.h; cw.value = s.w; ch.value = s.h; }
    customRow.hidden = S.size !== 'custom';
    redraw();
  } }, SIZES.map(s => h('option', { value: s.id, text: s.label })));
  const cw = h('input', { type: 'number', min: 64, max: 8192, step: 1, value: S.cw, 'aria-label': 'Export width in pixels',
    oninput: () => { S.cw = clamp(Math.round(Number(cw.value) || 64), 64, 8192); redraw(); } });
  const ch = h('input', { type: 'number', min: 64, max: 8192, step: 1, value: S.ch, 'aria-label': 'Export height in pixels',
    oninput: () => { S.ch = clamp(Math.round(Number(ch.value) || 64), 64, 8192); redraw(); } });
  const customRow = h('div.pt__pair', { hidden: true }, cw, h('span', { text: '×' }), ch, h('span', { text: 'px' }));
  const fmtSel = h('select', { 'aria-label': 'Export format', onchange: () => { S.fmt = fmtSel.value; qRow.hidden = S.fmt !== 'jpeg'; } },
    h('option', { value: 'png', text: 'PNG (sharp, larger)' }), h('option', { value: 'jpeg', text: 'JPEG (smaller)' }));
  const qOut = h('output', { text: `${S.q}%` });
  const qIn = h('input', { type: 'range', min: 40, max: 100, step: 1, value: S.q, 'aria-label': 'JPEG quality', oninput: () => { S.q = Number(qIn.value); qOut.textContent = `${S.q}%`; } });
  const qRow = h('label.pt__slider', { hidden: true }, h('span', { text: 'Quality' }), qIn, qOut);

  /* ---------- the picked cell ---------- */
  const zoomOut = h('output', { text: '100%' });
  const zoomIn = h('input', { type: 'range', min: 100, max: 400, step: 1, value: 100, 'aria-label': 'Zoom the picture in this cell',
    oninput: () => { const c = S.cells[S.sel]; if (!c) return; c.zoom = Number(zoomIn.value) / 100; clampPan(c); redraw(); } });
  const cellName = h('b', { text: '' });
  const resetCell = h('button.btn.btn--sm', { type: 'button', onclick: () => { const c = S.cells[S.sel]; if (c) { c.zoom = 1; c.px = 0; c.py = 0; redraw(); } } }, icon('refresh'), h('span', { text: 'Reset' }));
  const clearCell = h('button.btn.btn--sm', { type: 'button', onclick: () => { S.cells[S.sel] = null; syncPicker(); redraw(); } }, icon('x'), h('span', { text: 'Empty cell' }));
  const cellPanel = h('div.pt-col__cell', h('div.pt__rowhead', cellName, h('span.pt__spacer'), resetCell, clearCell),
    h('label.pt__slider', h('span', { text: 'Zoom' }), zoomIn, zoomOut));
  function paintCellPanel() {
    const c = S.cells[S.sel];
    cellName.textContent = c ? `Cell ${S.sel + 1}: ${c.name}` : `Cell ${S.sel + 1} is empty. Click a picture to fill it.`;
    zoomIn.disabled = resetCell.disabled = clearCell.disabled = !c;
    zoomIn.value = c ? Math.round(c.zoom * 100) : 100;
    zoomOut.textContent = `${zoomIn.value}%`;
  }
  /* pan is a fraction of what overflows the cell, so zoom 1 on a matching shape has nothing to pan */
  const clampPan = c => { c.px = clamp(c.px, -1, 1); c.py = clamp(c.py, -1, 1); };

  /* ---------- pictures ---------- */
  const picker = pickerView(api, { multi: true, label: 'Pictures for the collage', onChange: (list, src, added) => {
    if (added) put(src); else { const i = S.cells.findIndex(c => c && c.src.key === src.key); if (i >= 0) { S.cells[i] = null; redraw(); } }
  } });
  function syncPicker() {
    const keep = new Set(cells().filter(Boolean).map(c => c.src.key));
    for (const s of picker.selected()) if (!keep.has(s.key)) picker.unpick(s);
  }
  async function put(src) {
    let target = S.sel;
    if (S.cells[target]) { const free = cells().findIndex(c => !c); if (free >= 0) target = free; }
    try {
      const bmp = await bitmapOf(await blobOfSource(src));
      if (!S.alive) return;
      S.cells[target] = { src, name: src.name, bmp, zoom: 1, px: 0, py: 0 };
      const next = cells().findIndex((c, i) => !c && i !== target);
      S.sel = next >= 0 ? next : target;
      redraw();
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Can’t use that picture', message: err?.message || String(err) });
    }
  }
  const autoFill = () => {
    const have = new Set(cells().filter(Boolean).map(c => c.src.key));
    const free = listPictures().filter(s => !have.has(s.key));
    let i = 0;
    for (const s of free) { if (i >= S.layout.n) break; picker.pick(s); i++; }
  };
  const fillBtn = h('button.btn.btn--sm', { type: 'button', onclick: autoFill, title: 'Fill the empty cells with pictures from your library' }, icon('shuffle'), h('span', { text: 'Fill from library' }));

  /* ---------- pan and zoom on the canvas ---------- */
  function cellAt(e) {
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * S.cw, y = (e.clientY - r.top) / r.height * S.ch;
    const rects = cellRects(S.layout, S.cw, S.ch, S.gap / 100 * Math.min(S.cw, S.ch));
    return { i: rects.findIndex(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h), rects, k: r.width / S.cw };
  }
  cv.addEventListener('pointerdown', e => {
    const { i } = cellAt(e);
    if (i < 0) return;
    S.sel = i;
    const c = S.cells[i];
    S.drag = c ? { i, x: e.clientX, y: e.clientY, px: c.px, py: c.py } : null;
    if (S.drag) { try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } }
    redraw();
  });
  cv.addEventListener('pointermove', e => {
    const d = S.drag, c = d && S.cells[d.i];
    if (!c) return;
    const { rects, k } = cellAt(e);
    const r = rects[d.i];
    const { w: iw, h: ih } = sizeOfBitmap(c.bmp);
    const s = Math.max(r.w / iw, r.h / ih) * c.zoom;
    const ovx = (iw * s - r.w) / 2, ovy = (ih * s - r.h) / 2;
    /* dragging the picture right moves it right: its centre goes the same way as the pointer */
    if (ovx > 0.5) c.px = d.px - (e.clientX - d.x) / k / ovx; else c.px = 0;
    if (ovy > 0.5) c.py = d.py - (e.clientY - d.y) / k / ovy; else c.py = 0;
    clampPan(c);
    redraw();
  });
  const endDrag = () => { S.drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', e => {
    const { i } = cellAt(e);
    const c = i >= 0 && S.cells[i];
    if (!c) return;
    e.preventDefault();
    S.sel = i;
    c.zoom = clamp(c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 1, 4);
    clampPan(c);
    redraw();
  }, { passive: false });

  /* ---------- export ---------- */
  const saveBtn = h('button.btn.btn--primary', { type: 'button', 'aria-label': 'Save collage to Pictures', onclick: () => save() }, icon('save'), h('span', { text: 'Save to Pictures' }));
  async function save() {
    if (S.busy) return;
    S.busy = true;
    saveBtn.disabled = true;
    try {
      const W = S.cw, H = S.ch;
      if (W * H > 48_000_000) throw new Error('That size is too big for this browser. Try something smaller.');
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const gg = c.getContext('2d');
      const bg = S.fmt === 'jpeg' && !S.bg ? '#ffffff' : S.bg;
      paintCollage(gg, W, H, { layout: S.layout, cells: cells(), gapPct: S.gap, radiusPct: S.radius, bg, selected: -1 });
      const type = S.fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
      const blob = await encode(c, type, S.q / 100);
      c.width = c.height = 0;
      if (!blob) throw new Error(`This browser couldn’t make a ${S.fmt === 'jpeg' ? 'JPEG' : 'PNG'}.`);
      await saveBlob(api, 'Picture Tools', picturesDir(), `Collage ${W}x${H}.${S.fmt === 'jpeg' ? 'jpg' : 'png'}`, blob, { title: 'Collage saved' });
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Not saved', message: err?.message || String(err) });
    } finally {
      S.busy = false;
      if (S.alive) redraw();
    }
  }

  const side = h('div.pt__side',
    h('div.pt__group', h('b.pt__label', { text: 'Layout' }), layoutRow),
    cellPanel,
    h('div.pt__group',
      slider('Gap', 'gap', 0, 10, '%'), slider('Corners', 'radius', 0, 100, '%'),
      h('label.pt__line', h('span', { text: 'Background' }), bgInput)),
    h('div.pt__group', h('b.pt__label', { text: 'Export' }),
      h('label.pt__line', h('span', { text: 'Size' }), sizeSel), customRow,
      h('label.pt__line', h('span', { text: 'Format' }), fmtSel), qRow),
    h('div.pt__group', h('div.pt__rowhead', h('b.pt__label', { text: 'Pictures' }), h('span.pt__spacer'), fillBtn), picker.el),
    h('div.pt__actions', saveBtn));
  root.append(h('div.pt__split', h('div.pt__col', stage, foot), side));
  setLayout(S.layout.id);
  qRow.hidden = true;

  const ro = new ResizeObserver(() => redraw());
  ro.observe(stage);
  const first = opts?.path && sourceOfPath(opts.path);
  if (first) picker.pick(first);

  root.collagePeek = () => ({ layout: S.layout.id, cells: cells().map(c => c && { name: c.name, zoom: c.zoom, px: c.px, py: c.py }), sel: S.sel, cw: S.cw, ch: S.ch });

  return () => {
    S.alive = false;
    cancelAnimationFrame(S.raf);
    ro.disconnect();
    picker.destroy();
    for (const c of S.cells) try { c?.bmp?.close?.(); } catch (e) { /* already closed */ }
    cv.width = cv.height = 0;
  };
}
