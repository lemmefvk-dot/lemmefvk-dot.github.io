/* ============================================================
   Sticker maker (Picture Tools, #113) — cut a shape out of a picture
   and use it as a sticker.

   Pick a picture, then choose how to cut it out:
     Lasso      drag freehand around it
     Polygon    click the corners; double-click, Enter, or click the
                first corner to close it; Esc starts over
     Ellipse    drag from one corner of its box to the other
     Rectangle  the same
     Magic wand click a colour; every touching pixel within the
                tolerance of it is picked (tick "Invert" to keep
                everything else — the way to remove a background)

   Feather softens the cut edge; Outline adds the white border that
   makes a sticker look like a sticker. The result is a PNG with a
   transparent background, cropped to the cut-out. "Save" keeps it in
   ~/Pictures/Stickers. "Put on desktop" saves it too and adds it to
   the desktop sticker layer (js/shell/halloween-fun.js, the one the
   Halloween treats use): drag it, or right-click to remove it.

   Everything is worked out on one selection mask — a byte per pixel of
   the working copy (the picture, scaled so its long side is at most
   1400 px) — whichever tool made it.
   ============================================================ */
import { pickerView, blobOfSource, bitmapOf, sizeOfBitmap, sourceOfPath, encode, saveBlob, stemOf, clamp, picturesDir } from './pt-common.js';
import * as HW from '../core/halloween.js';
import { hasIcon } from '../core/icons.js';

const MAX_SIDE = 1400;
export const STICKER_DIR = () => `${picturesDir()}/Stickers`;
const MODES = [
  { id: 'lasso', label: 'Lasso', icon: 'scan', hint: 'Drag around what you want to keep.' },
  { id: 'polygon', label: 'Polygon', icon: 'star', hint: 'Click each corner. Double-click, press Enter or click the first corner to finish; Esc starts over.' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle', hint: 'Drag from one corner of the oval’s box to the other.' },
  { id: 'rect', label: 'Rectangle', icon: 'square', hint: 'Drag from one corner to the opposite one.' },
  { id: 'wand', label: 'Magic wand', icon: 'sparkles', hint: 'Click a colour. Touching pixels within the tolerance are picked.' },
];

/** Blur a byte-per-pixel alpha plane (two box passes ≈ a soft edge about `r` px wide each side). */
export function blurAlpha(a, w, hgt, r) {
  r = Math.round(r);
  if (r < 1) return Uint8ClampedArray.from(a);
  let src = Float32Array.from(a);
  let dst = new Float32Array(w * hgt);
  const k = 1 / (2 * r + 1);
  const pass = (len, lines, stride, step) => {
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      let sum = 0;
      for (let i = -r; i <= r; i++) if (i >= 0 && i < len) sum += src[base + i * step];
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = sum * k;
        const add = i + r + 1, del = i - r;
        if (add < len) sum += src[base + add * step];
        if (del >= 0) sum -= src[base + del * step];
      }
    }
    [src, dst] = [dst, src];
  };
  for (let n = 0; n < 2; n++) { pass(w, hgt, w, 1); pass(hgt, w, 1, w); }
  return Uint8ClampedArray.from(src);
}

/** Flood fill by colour. px = RGBA bytes of the picture; returns a 0/255 mask. */
export function wandMask(px, w, hgt, sx, sy, tol, contiguous = true) {
  const mask = new Uint8Array(w * hgt);
  const o = (sy * w + sx) * 4;
  const r0 = px[o], g0 = px[o + 1], b0 = px[o + 2];
  const lim = (tol * 3) ** 2;
  const near = i => { const dr = px[i] - r0, dg = px[i + 1] - g0, db = px[i + 2] - b0; return dr * dr + dg * dg + db * db <= lim; };
  if (!contiguous) {
    for (let p = 0; p < w * hgt; p++) if (near(p * 4)) mask[p] = 255;
    return mask;
  }
  const stack = [sy * w + sx];
  mask[stack[0]] = 255;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p - x) / w;
    const tryAt = q => { if (!mask[q] && near(q * 4)) { mask[q] = 255; stack.push(q); } };
    if (x > 0) tryAt(p - 1);
    if (x < w - 1) tryAt(p + 1);
    if (y > 0) tryAt(p - w);
    if (y < hgt - 1) tryAt(p + w);
  }
  return mask;
}

export function mountSticker({ api, root, opts }) {
  const { h, icon } = api;
  const S = {
    src: null, bmp: null, W: 0, H: 0, px: null, base: null,
    mode: 'ellipse', tol: 25, contiguous: true, invert: false, feather: 4, outline: true, outlinePx: 10,
    mask: null, dim: null, wand: null,
    draw: null,                    /* the shape being drawn: { kind, pts | a,b } */
    alive: true, busy: false, raf: 0, out: null, outInfo: null, savedPath: '', dirty: true, seq: 0,
  };

  const cv = h('canvas.pt-st__canvas', { 'aria-label': 'Picture to cut out. Drag on it to cut a shape.', tabindex: 0 });
  const g = cv.getContext('2d');
  const empty = h('div.pt__empty', icon('image'), h('b', { text: 'Pick a picture' }), h('small', { text: 'Choose one on the right, then cut a shape out of it.' }));
  const paper = h('div.pt-st__paper', { hidden: true }, cv);
  const stage = h('div.pt__stage', empty, paper);
  const foot = h('div.pt__foot', { role: 'status', 'aria-live': 'polite' });

  /* ---------- the picture ---------- */
  async function load(src) {
    const seq = ++S.seq;
    try {
      const bmp = await bitmapOf(await blobOfSource(src));
      if (!S.alive || seq !== S.seq) return;
      const { w, h: hh } = sizeOfBitmap(bmp);
      const k = Math.min(1, MAX_SIDE / Math.max(w, hh));
      S.W = Math.max(1, Math.round(w * k)); S.H = Math.max(1, Math.round(hh * k));
      const base = document.createElement('canvas');
      base.width = S.W; base.height = S.H;
      const bg = base.getContext('2d', { willReadFrequently: true });
      bg.imageSmoothingQuality = 'high';
      bg.drawImage(bmp, 0, 0, S.W, S.H);
      try { bmp.close?.(); } catch (e) { /* not an ImageBitmap */ }
      S.base = base;
      S.px = bg.getImageData(0, 0, S.W, S.H).data;
      S.src = src; S.bmp = true;
      S.mask = null; S.dim = null; S.wand = null; S.draw = null;
      cv.width = S.W; cv.height = S.H;
      empty.hidden = true; paper.hidden = false;
      changed();
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Can’t use that picture', message: err?.message || String(err) });
    }
  }

  /* ---------- the selection mask ---------- */
  const eff = i => (S.invert ? 255 - S.mask[i] : S.mask[i]);
  function setMaskFromPath(paint) {
    const c = document.createElement('canvas');
    c.width = S.W; c.height = S.H;
    const cg = c.getContext('2d', { willReadFrequently: true });
    cg.fillStyle = '#fff';
    paint(cg);
    const d = cg.getImageData(0, 0, S.W, S.H).data;
    const m = new Uint8Array(S.W * S.H);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
    S.mask = m; S.wand = null;
    changed();
  }
  function commitShape(d) {
    if (d.kind === 'poly') {
      if (d.pts.length < 3) return;
      setMaskFromPath(cg => { cg.beginPath(); d.pts.forEach(([x, y], i) => (i ? cg.lineTo(x, y) : cg.moveTo(x, y))); cg.closePath(); cg.fill(); });
    } else {
      const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]), w = Math.abs(d.a[0] - d.b[0]), hh = Math.abs(d.a[1] - d.b[1]);
      if (w < 3 || hh < 3) return;
      setMaskFromPath(cg => { cg.beginPath(); if (d.kind === 'ellipse') cg.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2); else cg.rect(x, y, w, hh); cg.fill(); });
    }
  }
  function runWand() {
    if (!S.wand) return;
    S.mask = wandMask(S.px, S.W, S.H, S.wand.x, S.wand.y, S.tol, S.contiguous);
    changed();
  }
  function selectAll() { if (!S.px) return; S.mask = new Uint8Array(S.W * S.H).fill(255); S.wand = null; changed(); }
  function clearSel() { S.mask = null; S.wand = null; S.draw = null; changed(); }

  /* ---------- build the sticker ---------- */
  function bounds() {
    if (!S.mask) return null;
    let x0 = S.W, y0 = S.H, x1 = -1, y1 = -1;
    for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
      if (eff(y * S.W + x) > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function build() {
    const b = bounds();
    if (!b) return null;
    const f = S.feather, o = S.outline ? S.outlinePx : 0;
    const P = Math.ceil(f + o) + 2;
    const ow = b.w + 2 * P, oh = b.h + 2 * P;
    const hard = new Uint8ClampedArray(ow * oh);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) hard[(y + P) * ow + x + P] = eff((y + b.y) * S.W + x + b.x);
    const plane = (a, white) => {
      const c = document.createElement('canvas');
      c.width = ow; c.height = oh;
      const cg = c.getContext('2d');
      const im = cg.createImageData(ow, oh);
      for (let i = 0; i < a.length; i++) { const j = i * 4; im.data[j] = im.data[j + 1] = im.data[j + 2] = white ? 255 : 0; im.data[j + 3] = a[i]; }
      cg.putImageData(im, 0, 0);
      return c;
    };
    const soft = f > 0 ? blurAlpha(hard, ow, oh, Math.ceil(f / 2)) : hard;
    const cut = document.createElement('canvas');
    cut.width = ow; cut.height = oh;
    const cg = cut.getContext('2d');
    cg.drawImage(S.base, P - b.x, P - b.y);
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(plane(soft, true), 0, 0);
    let out = cut;
    if (o > 0) {
      out = document.createElement('canvas');
      out.width = ow; out.height = oh;
      const og = out.getContext('2d');
      const sil = plane(hard, true);
      og.drawImage(sil, 0, 0);
      for (const [r, share] of [[o, 1], [o * 0.7, 0.6], [o * 0.4, 0.4], [o * 0.2, 0.25]]) {
        const n = clamp(Math.ceil(Math.PI * r / 1.5 * share) + 8, 12, 80);
        for (let i = 0; i < n; i++) og.drawImage(sil, Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r);
      }
      og.drawImage(cut, 0, 0);
    }
    return { canvas: out, info: { w: ow, h: oh, pad: P, sel: b } };
  }

  /* ---------- drawing ---------- */
  function rebuildDim() {
    if (!S.mask) { S.dim = null; return; }
    const c = document.createElement('canvas');
    c.width = S.W; c.height = S.H;
    const cg = c.getContext('2d');
    const im = cg.createImageData(S.W, S.H);
    for (let i = 0; i < S.mask.length; i++) im.data[i * 4 + 3] = Math.round((255 - eff(i)) * 0.6);
    cg.putImageData(im, 0, 0);
    S.dim = c;
  }
  function paintStage() {
    S.raf = 0;
    if (!S.alive || !S.base) return;
    const aw = Math.max(120, stage.clientWidth - 40), ah = Math.max(120, stage.clientHeight - 40);
    const k = Math.min(aw / S.W, ah / S.H, 4);
    cv.style.width = `${Math.round(S.W * k)}px`; cv.style.height = `${Math.round(S.H * k)}px`;
    g.clearRect(0, 0, S.W, S.H);
    g.drawImage(S.base, 0, 0);
    if (S.dim) g.drawImage(S.dim, 0, 0);
    const d = S.draw;
    if (d) {
      const lw = 2 / k;
      g.save();
      g.lineWidth = lw; g.lineJoin = 'round';
      const trace = () => {
        g.beginPath();
        if (d.kind === 'poly') {
          d.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          if (d.cur) g.lineTo(d.cur[0], d.cur[1]);
          if (d.closed) g.closePath();
        } else if (d.b) {
          const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]), w = Math.abs(d.a[0] - d.b[0]), hh = Math.abs(d.a[1] - d.b[1]);
          if (d.kind === 'ellipse') g.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2); else g.rect(x, y, w, hh);
        }
      };
      trace(); g.strokeStyle = '#000'; g.lineWidth = lw * 3; g.stroke();
      trace(); g.strokeStyle = '#fff'; g.setLineDash([6 / k, 5 / k]); g.lineWidth = lw * 1.4; g.stroke();
      if (d.kind === 'poly') { g.setLineDash([]); g.fillStyle = '#ff456d'; for (const [x, y] of d.pts) { g.beginPath(); g.arc(x, y, 4 / k, 0, 7); g.fill(); } }
      g.restore();
    }
  }
  const redraw = () => { if (!S.raf) S.raf = requestAnimationFrame(paintStage); };

  /* the sticker preview, on a checkerboard, a moment after the last change */
  const pv = h('canvas.pt-st__preview', { 'aria-label': 'Sticker preview' });
  const pvg = pv.getContext('2d');
  const pvWrap = h('div.pt-st__pvwrap', pv);
  let pvT = 0;
  function paintPreview() {
    pvT = 0;
    if (!S.alive) return;
    const r = S.base && S.mask ? build() : null;
    S.out = r?.canvas || null; S.outInfo = r?.info || null;
    pvg.clearRect(0, 0, pv.width, pv.height);
    pvWrap.dataset.empty = r ? 'false' : 'true';
    if (r) {
      const k = Math.min(pv.width / r.info.w, pv.height / r.info.h, 1);
      const dw = r.info.w * k, dh = r.info.h * k;
      pvg.imageSmoothingQuality = 'high';
      pvg.drawImage(r.canvas, (pv.width - dw) / 2, (pv.height - dh) / 2, dw, dh);
    }
    saveBtn.disabled = deskBtn.disabled = S.busy || !r;
    paintFoot();
  }
  pv.width = 280; pv.height = 200;
  function paintFoot() {
    const i = S.outInfo;
    foot.textContent = !S.base ? 'Pick a picture to begin'
      : i ? `Sticker ${i.w} × ${i.h} px · transparent PNG · saved in Pictures/Stickers`
        : MODES.find(m => m.id === S.mode).hint;
  }
  function changed() {
    S.dirty = true; S.savedPath = '';
    rebuildDim();
    redraw();
    clearTimeout(pvT);
    pvT = setTimeout(paintPreview, 40);
  }

  /* ---------- pointer ---------- */
  const at = e => {
    const r = cv.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width * S.W, 0, S.W - 1), clamp((e.clientY - r.top) / r.height * S.H, 0, S.H - 1)];
  };
  const scale = () => cv.getBoundingClientRect().width / S.W || 1;
  function closePoly() {
    const d = S.draw;
    if (d?.kind === 'poly' && d.pts.length >= 3) { S.draw = null; commitShape(d); } else redraw();
  }
  cv.addEventListener('pointerdown', e => {
    if (!S.base || e.button !== 0) return;
    cv.focus();
    const p = at(e);
    if (S.mode === 'wand') {
      S.wand = { x: Math.floor(p[0]), y: Math.floor(p[1]) };
      runWand();
      return;
    }
    if (S.mode === 'polygon') {
      const d = S.draw?.kind === 'poly' ? S.draw : (S.draw = { kind: 'poly', pts: [] });
      const first = d.pts[0];
      if (first && d.pts.length >= 3 && Math.hypot(first[0] - p[0], first[1] - p[1]) * scale() < 10) { closePoly(); return; }
      if (e.detail >= 2 && d.pts.length >= 3) { closePoly(); return; }
      d.pts.push(p); d.cur = null;
      redraw();
      return;
    }
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    S.draw = S.mode === 'lasso' ? { kind: 'poly', pts: [p], free: true } : { kind: S.mode, a: p, b: p };
    redraw();
  });
  cv.addEventListener('pointermove', e => {
    const d = S.draw;
    if (!d || !S.base) return;
    const p = at(e);
    if (d.kind === 'poly') {
      if (d.free) { const l = d.pts[d.pts.length - 1]; if (Math.hypot(l[0] - p[0], l[1] - p[1]) * scale() >= 2) d.pts.push(p); }
      else d.cur = p;
    } else if (e.buttons) d.b = p;
    redraw();
  });
  const release = e => {
    const d = S.draw;
    if (!d || !S.base) return;
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
    if (d.kind === 'poly' && !d.free) return;       /* a polygon waits for its closing click */
    S.draw = null;
    commitShape(d);
    redraw();
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', () => { if (S.draw?.free || (S.draw && S.draw.kind !== 'poly')) { S.draw = null; redraw(); } });
  cv.addEventListener('keydown', e => {
    if (e.key === 'Enter' && S.draw?.kind === 'poly') { e.preventDefault(); closePoly(); }
    else if (e.key === 'Escape' && S.draw) { e.preventDefault(); e.stopPropagation(); S.draw = null; redraw(); }
    else if (e.key === 'Backspace' && S.draw?.kind === 'poly' && !S.draw.free) { e.preventDefault(); S.draw.pts.pop(); redraw(); }
  });

  /* ---------- controls ---------- */
  const modeBtns = new Map();
  const modeRow = h('div.pt__seg.pt-st__modes', { role: 'radiogroup', 'aria-label': 'How to cut it out' }, MODES.map(m => {
    const b = h('button.pt__segbtn', {
      type: 'button', role: 'radio', 'aria-checked': 'false', title: m.hint, dataset: { mode: m.id }, onclick: () => setMode(m.id),
    }, icon(hasIcon(m.icon) ? m.icon : 'image'), h('span', { text: m.label }));
    modeBtns.set(m.id, b);
    return b;
  }));
  const hint = h('small.pt__hint');
  function setMode(id) {
    S.mode = id; S.draw = null;
    for (const [k, b] of modeBtns) b.setAttribute('aria-checked', String(k === id));
    wandBox.hidden = id !== 'wand';
    hint.textContent = MODES.find(m => m.id === id).hint;
    cv.style.cursor = id === 'wand' ? 'copy' : 'crosshair';
    redraw(); paintFoot();
  }
  const slider = (label, key, min, max, unit, after) => {
    const out = h('output', { text: `${S[key]}${unit}` });
    const input = h('input', { type: 'range', min, max, step: 1, value: S[key], 'aria-label': label, dataset: { key },
      oninput: () => { S[key] = Number(input.value); out.textContent = `${S[key]}${unit}`; after(); } });
    return h('label.pt__slider', h('span', { text: label }), input, out);
  };
  const check = (label, key, after) => h('label.pt__line.pt-st__check',
    h('input', { type: 'checkbox', checked: S[key], 'aria-label': label, onchange: e => { S[key] = e.target.checked; after(); } }), h('span', { text: label }));
  const tolRow = slider('Tolerance', 'tol', 0, 100, '', runWand);
  const wandBox = h('div.pt__group', { hidden: true }, tolRow, check('Only touching pixels', 'contiguous', runWand));
  const outlineRow = slider('Outline width', 'outlinePx', 2, 40, ' px', changed);
  const outlineBox = h('div.pt__group', check('White outline', 'outline', () => { outlineRow.hidden = !S.outline; changed(); }), outlineRow);

  const saveBtn = h('button.btn', { type: 'button', 'aria-label': 'Save sticker to Pictures', disabled: true, onclick: () => save(false) }, icon('save'), h('span', { text: 'Save PNG' }));
  const deskBtn = h('button.btn.btn--primary', { type: 'button', 'aria-label': 'Put sticker on the desktop', disabled: true, onclick: () => save(true) }, icon('sparkles'), h('span', { text: 'Put on desktop' }));

  async function save(toDesktop) {
    if (pvT) { clearTimeout(pvT); paintPreview(); }      /* a slider moved a moment ago: save what is on screen */
    if (S.busy || !S.out) return;
    S.busy = true; saveBtn.disabled = deskBtn.disabled = true;
    try {
      let path = S.savedPath;
      if (!path) {
        const blob = await encode(S.out, 'image/png');
        if (!blob) throw new Error('This browser couldn’t make a PNG.');
        path = await saveBlob(api, toDesktop ? 'Sticker maker' : 'Picture Tools', STICKER_DIR(), `${stemOf(S.src.name)} sticker.png`, blob, { title: toDesktop ? 'Sticker saved' : 'Sticker saved' });
        S.savedPath = path; S.dirty = false;
      }
      if (toDesktop) {
        const { w, h: hh } = S.outInfo;
        const k = Math.min(1, 160 / Math.max(w, hh));
        const vw = innerWidth, vh = innerHeight;
        const dw = Math.max(24, Math.round(w * k)), dh = Math.max(24, Math.round(hh * k));
        HW.placeUserSticker(path, { w: dw, h: dh, name: stemOf(S.src.name) },
          { x: Math.round(vw - dw - 80 - Math.random() * 120), y: Math.round(vh * 0.25 + Math.random() * vh * 0.2) });   /* the right edge, clear of the toasts */
        api.notify({ app: 'Sticker maker', icon: 'sparkles', title: 'On your desktop', message: 'Drag it where you like. Right-click it to remove it.' });
      }
    } catch (err) {
      api.notify({ app: 'Picture Tools', icon: 'alert', title: 'Not saved', message: err?.message || String(err) });
    } finally {
      S.busy = false;
      saveBtn.disabled = deskBtn.disabled = !S.out;
    }
  }

  const picker = pickerView(api, { label: 'Pictures to cut out', onChange: (list, src, added) => { if (added) load(src); } });
  const side = h('div.pt__side',
    h('div.pt__group', h('b.pt__label', { text: 'Cut out' }), modeRow, hint, wandBox,
      h('div.pt__rowhead',
        h('label.pt-st__check', h('input', { type: 'checkbox', 'aria-label': 'Invert the selection', onchange: e => { S.invert = e.target.checked; changed(); } }), h('span', { text: ' Invert' })),
        h('span.pt__spacer'),
        h('button.btn.btn--sm', { type: 'button', onclick: selectAll }, h('span', { text: 'All' })),
        h('button.btn.btn--sm', { type: 'button', onclick: clearSel }, icon('x'), h('span', { text: 'Clear' })))),
    h('div.pt__group', h('b.pt__label', { text: 'Edge' }), slider('Feather', 'feather', 0, 20, ' px', changed), outlineBox),
    h('div.pt__group', h('b.pt__label', { text: 'Sticker' }), pvWrap),
    h('div.pt__group', h('b.pt__label', { text: 'Pictures' }), picker.el),
    h('div.pt__actions', saveBtn, deskBtn));
  root.append(h('div.pt__split', h('div.pt__col', stage, foot), side));
  setMode(S.mode);
  pvWrap.dataset.empty = 'true';
  paintFoot();

  const ro = new ResizeObserver(() => redraw());
  ro.observe(stage);
  const first = opts?.path && sourceOfPath(opts.path);
  if (first) picker.pick(first);

  root.stickerPeek = () => ({
    W: S.W, H: S.H, mode: S.mode, has: !!S.mask, out: S.outInfo, saved: S.savedPath, feather: S.feather,
    outline: S.outline ? S.outlinePx : 0, invert: S.invert, selected: S.mask ? bounds() : null, drawing: S.draw ? S.draw.kind : null,
    points: S.draw?.pts?.length || 0,
  });

  return () => {
    S.alive = false; S.seq++;
    cancelAnimationFrame(S.raf); clearTimeout(pvT);
    ro.disconnect();
    picker.destroy();
    cv.width = cv.height = 0;
  };
}
