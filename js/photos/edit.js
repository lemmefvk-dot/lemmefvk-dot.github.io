/* ============================================================
   photos/edit.js — Photos' Edit mode. Opened from the viewer
   (the Edit button or E) or a picture's menu; it covers the
   Photos window until it is closed.

   Crop & rotate: a crop box with eight handles over the picture
   (drag a handle, drag inside to move it, arrows nudge it), aspect
   presets Free · Original · 1:1 · 4:3 · 16:9 (4:3 and 16:9 follow
   the picture's orientation: 3:4 on a portrait one), rotate 90°
   either way, flip across and down, and Straighten (−45° … 45°),
   which turns the picture and zooms it just enough that no empty
   corner shows (the largest rectangle of the picture's own shape
   that fits inside the turned one).
   Adjust: Exposure (±2 stops, in linear light), Brightness (a
   gamma curve, so whites don't clip), Contrast, Saturation and
   Warmth, previewed live on a screen-sized copy.
   Before / After shows the untouched picture; Reset puts every
   setting back; Undo / Redo (⌘Z, ⇧⌘Z) step through every change.

   Saving starts again from the file's own full-resolution pixels
   (never the preview): one drawImage through the whole geometry,
   then the colour pass on every pixel.
   · Save as copy (the default) writes "<name> (edited).jpg" for a
     JPEG — kept as JPEG, quality 0.92 — and "<name> (edited).png"
     for anything else, beside the original, which is not touched.
   · Replace original… asks first, then puts the new bytes behind
     the same file through media.replace() (renamed to .png if its
     format can't be written back).

   Tests read the editor through root.photoEditPeek() — a read-only
   snapshot (the edit, the output size, where the crop box is on
   screen). Nothing else uses it.
   ============================================================ */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import * as media from '../core/media.js';
import { vfs } from '../core/vfs.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-photo-edit-css')) {
  const l = document.createElement('link');
  l.id = 'feat-photo-edit-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-photo-edit.css';
  document.head.appendChild(l);
}

const FLIP_H = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M9 7 4 17h5z"/><path d="M15 7l5 10h-5z"/></svg>';
const FLIP_V = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18"/><path d="M7 9 17 4v5z"/><path d="M7 15l10 5v-5z"/></svg>';
const CONTRAST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>';

export const ADJUST = [
  { key: 'exposure', label: 'Exposure', icon: 'sun' },
  { key: 'brightness', label: 'Brightness', icon: 'brightness' },
  { key: 'contrast', label: 'Contrast', svg: CONTRAST },
  { key: 'saturation', label: 'Saturation', icon: 'droplet' },
  { key: 'warmth', label: 'Warmth', icon: 'thermometer' },
];
export const ASPECTS = [
  { key: 'free', label: 'Free' },
  { key: 'orig', label: 'Original' },
  { key: '1:1', label: '1:1', r: 1 },
  { key: '4:3', label: '4:3', r: 4 / 3 },
  { key: '16:9', label: '16:9', r: 16 / 9 },
];
const MAX_ANGLE = 45;
const HISTORY_MAX = 200;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clone = E => JSON.parse(JSON.stringify(E));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------
   the edit, as data — and the pure maths that turn it into pixels
   ------------------------------------------------------------------ */
export const identity = () => ({
  rot: 0, flipH: false, flipV: false, angle: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 }, aspect: 'free',
  adj: { exposure: 0, brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
});
/** the picture after its quarter turns */
export const oriented = (E, sw, sh) => (E.rot % 2 ? { ow: sh, oh: sw } : { ow: sw, oh: sh });
/** Straighten by `deg`: the share of a w × h picture still showing once
    it is turned and zoomed so its own shape fits inside the turned one. */
export function fillScale(w, h, deg) {
  const a = Math.abs(deg) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return Math.min(w / (w * c + h * s), h / (w * s + h * c));
}
/** what Save writes: the crop of the oriented picture, in pixels */
export function outputSize(E, sw, sh) {
  const { ow, oh } = oriented(E, sw, sh);
  return { w: Math.max(1, Math.round(E.crop.w * ow)), h: Math.max(1, Math.round(E.crop.h * oh)) };
}
/** Draw the straightened picture (ow × oh before `scale`) onto g, the crop's
    corner at the origin when `cropped`. One drawImage: one resampling. */
export function drawEdit(g, src, sw, sh, E, scale = 1, cropped = false) {
  const { ow, oh } = oriented(E, sw, sh);
  const k = 1 / fillScale(ow, oh, E.angle);
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.scale(scale, scale);
  if (cropped) g.translate(-E.crop.x * ow, -E.crop.y * oh);
  g.translate(ow / 2, oh / 2);
  g.rotate(E.angle * Math.PI / 180);
  g.scale(k, k);
  g.rotate(E.rot * Math.PI / 2);
  g.scale(E.flipH ? -1 : 1, E.flipV ? -1 : 1);
  g.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  g.restore();
}

export const isPlain = adj => ADJUST.every(a => !adj[a.key]);
const toLin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
/** Per-channel tables for exposure, warmth, brightness and contrast (in that order). */
export function adjustTables(adj) {
  const ex = 2 ** ((adj.exposure || 0) / 50);
  const wm = (adj.warmth || 0) / 100;
  const gain = [1 + wm * 0.2, 1 + wm * 0.04, 1 - wm * 0.2];
  const b = (adj.brightness || 0) / 100;
  const gamma = b >= 0 ? 1 / (1 + b * 0.8) : 1 - b * 0.8;
  const c = (adj.contrast || 0) / 100;
  const f = c >= 0 ? 1 + c * 1.2 : Math.max(0.15, 1 + c * 0.85);
  return gain.map(gn => {
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = toSrgb(Math.min(1, toLin(v / 255) * ex));
      x = Math.min(1, x * gn);
      x = x ** gamma;
      x = (x - 0.5) * f + 0.5;
      t[v] = Math.round(clamp(x, 0, 1) * 255);
    }
    return t;
  });
}
/** The colour pass, in place on RGBA bytes. */
export function applyAdjust(data, adj) {
  if (isPlain(adj)) return data;
  const [tr, tg, tb] = adjustTables(adj);
  const sat = 1 + (adj.saturation || 0) / 100;
  const doSat = sat !== 1;
  for (let i = 0; i < data.length; i += 4) {
    let r = tr[data[i]], g = tg[data[i + 1]], b = tb[data[i + 2]];
    if (doSat) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b;      /* Uint8ClampedArray rounds and clamps */
  }
  return data;
}

/* crop boxes follow the picture when it turns or flips */
const turnCW = c => ({ x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w });
const turnCCW = c => ({ x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w });

/* ------------------------------------------------------------------
   reading the picture, and writing it back
   ------------------------------------------------------------------ */
async function decode(path) {
  const blob = await media.blobOf(path);
  if (!blob) throw new Error('This picture’s bytes are no longer in this browser’s storage.');
  try {
    const bmp = await createImageBitmap(blob);
    return { src: bmp, sw: bmp.width, sh: bmp.height, mime: blob.type || (await media.mimeOf(path)) || '' };
  } catch (err) {
    /* SVG and a few others decode only through an <img> */
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('This picture has no pixel size to edit.');
      const bmp = await createImageBitmap(img);
      return { src: bmp, sw: bmp.width, sh: bmp.height, mime: blob.type || '' };
    } finally { URL.revokeObjectURL(url); }
  }
}

const stemOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };
const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const toBlob = (cv, type, q) => new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('The browser could not encode the picture.'))), type, q));

/** The finished picture at full resolution, encoded. */
export async function renderFile(src, sw, sh, E, mime) {
  const { w, h: hh } = outputSize(E, sw, sh);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = hh;
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('This picture is too big for the browser to edit.');
  drawEdit(g, src, sw, sh, E, 1, true);
  if (!isPlain(E.adj)) {
    const id = g.getImageData(0, 0, w, hh);
    applyAdjust(id.data, E.adj);
    g.putImageData(id, 0, 0);
  }
  const jpeg = /jpe?g/i.test(mime);
  const blob = await toBlob(cv, jpeg ? 'image/jpeg' : 'image/png', jpeg ? 0.92 : undefined);
  cv.width = cv.height = 0;
  return { blob, w, h: hh };
}

/* ------------------------------------------------------------------
   the editor
   ------------------------------------------------------------------ */
/** host: the element to cover; path: the picture; api: the app's api;
    onSaved({ path, replaced }), onClose(). Returns { close() }. */
export function openEditor({ host, path, api, onSaved, onClose }) {
  const name = vfs.baseName(path);
  let E = identity();
  let hist = [clone(E)], at = 0;
  let tab = 'crop', before = false, busy = '', dead = false;
  let pic = null;                   /* { src, sw, sh, mime } */
  const P = { key: '', base: null, data: null, adjKey: '', out: null };
  let drag = null, view = null;
  let rq = 0;

  const ib = (ic, label, fn, cls = '') => h(`button.ibtn.tip.tip--below${cls}`, { type: 'button', 'aria-label': label, 'data-tip': label, onclick: fn },
    typeof ic === 'string' && ic.startsWith('<') ? h('span.icon', { html: ic }) : icon(ic));
  /* top bar */
  const undoBtn = ib('corner-up-left', 'Undo (⌘Z)', () => undo());
  const redoBtn = ib('corner-up-left', 'Redo (⇧⌘Z)', () => redo(), '.pe-mirror');
  const beforeBtn = h('button.btn.btn--sm.pe__before', { type: 'button', 'aria-pressed': 'false', title: 'Show the picture as it was', onclick: () => setBefore(!before) },
    icon('eye'), h('span', { text: 'Before' }));
  const resetBtn = h('button.btn.btn--sm.btn--ghost', { type: 'button', title: 'Put every setting back', onclick: () => reset() }, icon('refresh'), h('span', { text: 'Reset' }));
  const replaceBtn = h('button.btn.btn--sm.btn--ghost.pe__replace', { type: 'button', title: 'Overwrite the original file (asks first)', onclick: () => save(true) },
    h('span', { text: 'Replace original…' }));
  const saveBtn = h('button.btn.btn--sm.btn--primary.pe__save', { type: 'button', title: 'Save the edit as a new file beside the original', onclick: () => save(false) },
    icon('save'), h('span', { text: 'Save as copy' }));
  const top = h('div.pe__top',
    ib('x', 'Cancel (Esc)', () => cancel(), '.pe__cancel'),
    h('div.pe__t', h('b', { text: 'Edit' }), h('small', { text: name })),
    h('div.grow'),
    undoBtn, redoBtn, h('span.pe__sep'), beforeBtn, resetBtn, h('span.pe__sep'), replaceBtn, saveBtn);

  /* stage */
  const cv = h('canvas.pe__cv', { 'aria-hidden': 'true' });
  const status = h('div.pe__status', { role: 'status' });
  const stage = h('div.pe__stage', { tabindex: '0', 'aria-label': 'Picture being edited. In Crop, the arrow keys move the crop box; with Shift, further.' }, cv, status);

  /* side panel: Crop | Adjust */
  const tabBtn = (key, ic, label) => h('button.pe__tab', { type: 'button', role: 'tab', dataset: { tab: key }, 'aria-selected': 'false', onclick: () => setTab(key) }, icon(ic), h('span', { text: label }));
  const tabs = h('div.pe__tabs', { role: 'tablist', 'aria-label': 'Edit tools' }, tabBtn('crop', 'crop', 'Crop & rotate'), tabBtn('adjust', 'sliders', 'Adjust'));
  const aspectBtns = ASPECTS.map(a => h('button', { type: 'button', dataset: { aspect: a.key }, 'aria-pressed': 'false', onclick: () => setAspect(a.key) }, a.label));
  const sizeEl = h('span.pe__size');
  const angleIn = h('input.slider.pe__range', { type: 'range', min: String(-MAX_ANGLE), max: String(MAX_ANGLE), step: '0.5', value: '0', 'aria-label': 'Straighten, degrees' });
  const angleVal = h('output.pe__val');
  angleIn.addEventListener('input', () => { E.angle = Number(angleIn.value); paintSide(); queue(); });
  angleIn.addEventListener('change', commit);
  const cropPane = h('div.pe__pane', { dataset: { pane: 'crop' } },
    h('div.pe__lbl', { text: 'Aspect' }),
    h('div.seg.pe__aspects', { role: 'group', 'aria-label': 'Crop aspect' }, aspectBtns),
    h('div.pe__lbl', { text: 'Rotate & flip' }),
    h('div.pe__row',
      h('button.btn.btn--sm', { type: 'button', title: 'Rotate left 90°', 'aria-label': 'Rotate left', onclick: () => turn(-1) }, icon('rotate-ccw'), h('span', { text: '90°' })),
      h('button.btn.btn--sm.pe-mirror', { type: 'button', title: 'Rotate right 90°', 'aria-label': 'Rotate right', onclick: () => turn(1) }, icon('rotate-ccw'), h('span', { text: '90°' })),
      h('button.btn.btn--sm', { type: 'button', title: 'Flip across (mirror)', 'aria-label': 'Flip horizontally', onclick: () => flip('h') }, h('span.icon', { html: FLIP_H })),
      h('button.btn.btn--sm', { type: 'button', title: 'Flip upside down', 'aria-label': 'Flip vertically', onclick: () => flip('v') }, h('span.icon', { html: FLIP_V }))),
    h('div.pe__lbl', h('span', { text: 'Straighten' }), angleVal),
    h('div.pe__slide', angleIn,
      h('button.btn.btn--sm.btn--ghost', { type: 'button', title: 'Back to 0°', onclick: () => { E.angle = 0; commit(); } }, h('span', { text: '0°' }))),
    h('div.pe__lbl', h('span', { text: 'Saved size' }), sizeEl));
  const adjIns = {};
  const adjVals = {};
  const adjPane = h('div.pe__pane', { dataset: { pane: 'adjust' } }, ADJUST.map(a => {
    const input = adjIns[a.key] = h('input.slider.pe__range', { type: 'range', min: '-100', max: '100', step: '1', value: '0', 'aria-label': a.label, dataset: { adj: a.key } });
    adjVals[a.key] = h('output.pe__val');
    input.addEventListener('input', () => { E.adj[a.key] = Number(input.value); paintSide(); queue(); });
    input.addEventListener('change', commit);
    return h('div.pe__adj',
      h('div.pe__lbl', { title: 'Double-click to put it back to 0', ondblclick: () => { E.adj[a.key] = 0; commit(); } },
        a.svg ? h('span.icon', { html: a.svg }) : icon(a.icon), h('span', { text: a.label }), adjVals[a.key]),
      input);
  }));
  const note = h('p.pe__note');
  const side = h('aside.pe__side', { 'aria-label': 'Edit tools' }, tabs, cropPane, adjPane, note);
  const busyEl = h('div.pe__busy', { hidden: true, role: 'status' }, h('i.ph-spin'), h('span'));
  const root = h('div.pe', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Edit ${name}` }, top, h('div.pe__body', stage, side), busyEl);
  host.appendChild(root);
  const g = cv.getContext('2d');

  /* ---------------- state changes ---------------- */
  function commit() {
    if (dead) return;
    if (!same(E, hist[at])) {
      hist = hist.slice(0, at + 1);
      hist.push(clone(E));
      if (hist.length > HISTORY_MAX) hist.shift();
      at = hist.length - 1;
    }
    paintAll();
  }
  function undo() { if (at > 0 && !busy) { E = clone(hist[--at]); paintAll(); } }
  function redo() { if (at < hist.length - 1 && !busy) { E = clone(hist[++at]); paintAll(); } }
  function reset() { if (busy) return; E = identity(); commit(); }
  function setBefore(v) { before = !!v; paintAll(); }
  function setTab(t) { tab = t; paintAll(); }
  const dirty = () => !same(E, identity());

  function turn(d) {
    E.rot = (E.rot + (d > 0 ? 1 : 3)) % 4;
    E.crop = d > 0 ? turnCW(E.crop) : turnCCW(E.crop);
    commit();
  }
  function flip(axis) {
    /* across / down as the picture is seen now, whatever its quarter turns */
    const h2 = axis === 'h';
    if ((E.rot % 2 === 0) === h2) E.flipH = !E.flipH; else E.flipV = !E.flipV;
    E.angle = -E.angle || 0;
    E.crop = h2 ? { ...E.crop, x: 1 - E.crop.x - E.crop.w } : { ...E.crop, y: 1 - E.crop.y - E.crop.h };
    commit();
  }
  /** the locked shape (w / h in pixels) for the current aspect, or null */
  function ratioOf(key = E.aspect, forCrop = true) {
    if (!pic) return null;
    const { ow, oh } = oriented(E, pic.sw, pic.sh);
    if (key === 'orig') return ow / oh;
    const a = ASPECTS.find(x => x.key === key);
    if (!a || !a.r) return null;
    const portrait = forCrop ? E.crop.h * oh > E.crop.w * ow : oh > ow;
    return portrait ? 1 / a.r : a.r;
  }
  function setAspect(key) {
    E.aspect = key;
    const r = ratioOf(key, false);
    if (r && pic) {
      /* the biggest box of that shape, centred where the crop is */
      const { ow, oh } = oriented(E, pic.sw, pic.sh);
      let w = ow, hh = ow / r;
      if (hh > oh) { hh = oh; w = oh * r; }
      const cx = (E.crop.x + E.crop.w / 2) * ow, cy = (E.crop.y + E.crop.h / 2) * oh;
      const x = clamp(cx - w / 2, 0, ow - w), y = clamp(cy - hh / 2, 0, oh - hh);
      E.crop = { x: x / ow, y: y / oh, w: w / ow, h: hh / oh };
    }
    commit();
  }

  /* ---------------- painting ---------------- */
  function paintAll() { paintTop(); paintSide(); queue(); }
  function paintTop() {
    undoBtn.disabled = at <= 0 || !!busy;
    redoBtn.disabled = at >= hist.length - 1 || !!busy;
    beforeBtn.setAttribute('aria-pressed', String(before));
    beforeBtn.classList.toggle('is-on', before);
    resetBtn.disabled = !dirty() || !!busy;
    saveBtn.disabled = replaceBtn.disabled = !pic || !!busy;
  }
  const signed = (v, unit = '') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}${unit}`;
  function paintSide() {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    cropPane.hidden = tab !== 'crop';
    adjPane.hidden = tab !== 'adjust';
    for (const b of aspectBtns) { const on = b.dataset.aspect === E.aspect; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    angleIn.value = String(E.angle);
    angleVal.textContent = `${signed(E.angle)}°`;
    for (const a of ADJUST) { adjIns[a.key].value = String(E.adj[a.key]); adjVals[a.key].textContent = signed(E.adj[a.key]); }
    if (pic) { const o = outputSize(E, pic.sw, pic.sh); sizeEl.textContent = `${o.w.toLocaleString()} × ${o.h.toLocaleString()} px`; }
  }
  function queue() { if (!rq && !dead) rq = requestAnimationFrame(() => { rq = 0; draw(); }); }

  /* the straightened picture at screen size, then its colour pass */
  function preview(maxSide) {
    const { ow, oh } = oriented(E, pic.sw, pic.sh);
    const scale = Math.min(1, maxSide / Math.max(ow, oh));
    const key = `${E.rot}|${E.flipH}|${E.flipV}|${E.angle}|${scale.toFixed(4)}`;
    if (P.key !== key) {
      const b = P.base || (P.base = document.createElement('canvas'));
      b.width = Math.max(1, Math.round(ow * scale));
      b.height = Math.max(1, Math.round(oh * scale));
      const bg = b.getContext('2d', { willReadFrequently: true });
      bg.clearRect(0, 0, b.width, b.height);
      drawEdit(bg, pic.src, pic.sw, pic.sh, E, scale);
      P.key = key;
      P.data = null;
      P.adjKey = '';
    }
    const ak = JSON.stringify(E.adj);
    if (P.adjKey !== ak) {
      if (isPlain(E.adj)) P.out = P.base;
      else {
        const b = P.base;
        if (!P.data) P.data = b.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, b.width, b.height);
        const o = P.adj || (P.adj = document.createElement('canvas'));
        o.width = b.width;
        o.height = b.height;
        const id = new ImageData(new Uint8ClampedArray(P.data.data), b.width, b.height);
        applyAdjust(id.data, E.adj);
        o.getContext('2d').putImageData(id, 0, 0);
        P.out = o;
      }
      P.adjKey = ak;
    }
    return P.out;
  }
  function fit(w, hh, W, H, pad) {
    const s = Math.min((W - pad * 2) / w, (H - pad * 2) / hh);
    const vw = w * s, vh = hh * s;
    return { x: (W - vw) / 2, y: (H - vh) / 2, w: vw, h: vh, s };
  }
  function draw() {
    if (dead) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    view = null;
    if (!pic || W < 10 || H < 10) return;
    const pad = W < 520 ? 14 : 30;
    if (before) {
      const v = fit(pic.sw, pic.sh, W, H, pad);
      g.imageSmoothingQuality = 'high';
      g.drawImage(pic.src, v.x, v.y, v.w, v.h);
      badge('Before', v);
      return;
    }
    const { ow, oh } = oriented(E, pic.sw, pic.sh);
    const img = preview(clamp(Math.max(W, H) * dpr, 480, 2000));
    if (tab === 'crop') {
      const v = fit(ow, oh, W, H, pad + 8);
      view = { ...v, ow, oh };
      g.drawImage(img, v.x, v.y, v.w, v.h);
      const c = cropScreen();
      g.save();
      g.beginPath();
      g.rect(v.x, v.y, v.w, v.h);
      g.rect(c.x, c.y, c.w, c.h);
      g.fillStyle = 'rgba(0,0,0,.58)';
      g.fill('evenodd');
      g.restore();
      /* thirds, and a finer grid while straightening */
      g.strokeStyle = 'rgba(255,255,255,.32)';
      g.lineWidth = 1;
      g.beginPath();
      const n = drag?.kind === 'angle' ? 9 : 3;
      for (let i = 1; i < n; i++) {
        g.moveTo(c.x + (c.w * i) / n, c.y); g.lineTo(c.x + (c.w * i) / n, c.y + c.h);
        g.moveTo(c.x, c.y + (c.h * i) / n); g.lineTo(c.x + c.w, c.y + (c.h * i) / n);
      }
      g.stroke();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.strokeRect(c.x, c.y, c.w, c.h);
      g.fillStyle = '#fff';
      const L = Math.min(18, c.w / 3, c.h / 3);
      for (const hd of handles(c)) {
        if (hd.k.length === 2) {
          /* corner brackets, their arms along the box's edges */
          const sx = hd.k.includes('w') ? 1 : -1, sy = hd.k.includes('n') ? 1 : -1;
          g.fillRect(Math.min(hd.x - sx * 2, hd.x + sx * L), hd.y - 2, L + 2, 4);
          g.fillRect(hd.x - 2, Math.min(hd.y - sy * 2, hd.y + sy * L), 4, L + 2);
        } else if (hd.k === 'n' || hd.k === 's') g.fillRect(hd.x - 9, hd.y - 2, 18, 4);
        else g.fillRect(hd.x - 2, hd.y - 9, 4, 18);
      }
    } else {
      const cw = E.crop.w * ow, ch = E.crop.h * oh;
      const v = fit(cw, ch, W, H, pad);
      view = { ...v, ow, oh };
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, E.crop.x * img.width, E.crop.y * img.height, E.crop.w * img.width, E.crop.h * img.height, v.x, v.y, v.w, v.h);
    }
  }
  function badge(text, v) {
    g.font = '600 12px Inter,ui-sans-serif,system-ui,sans-serif';
    const w = g.measureText(text).width + 16;
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.beginPath();
    g.roundRect ? g.roundRect(v.x + 10, v.y + 10, w, 24, 12) : g.rect(v.x + 10, v.y + 10, w, 24);
    g.fill();
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(text, v.x + 18, v.y + 22);
  }
  function cropScreen() {
    const v = view;
    return { x: v.x + E.crop.x * v.w, y: v.y + E.crop.y * v.h, w: E.crop.w * v.w, h: E.crop.h * v.h };
  }
  function handles(c) {
    const xs = { w: c.x, m: c.x + c.w / 2, e: c.x + c.w }, ys = { n: c.y, m: c.y + c.h / 2, s: c.y + c.h };
    return [
      { k: 'nw', x: xs.w, y: ys.n }, { k: 'n', x: xs.m, y: ys.n }, { k: 'ne', x: xs.e, y: ys.n },
      { k: 'e', x: xs.e, y: ys.m }, { k: 'se', x: xs.e, y: ys.s }, { k: 's', x: xs.m, y: ys.s },
      { k: 'sw', x: xs.w, y: ys.s }, { k: 'w', x: xs.w, y: ys.m },
    ];
  }

  /* ---------------- crop box: pointer & keys ---------------- */
  const local = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function grabAt(p) {
    if (!view || tab !== 'crop' || before) return null;
    const c = cropScreen();
    let best = null, bd = 16;
    for (const hd of handles(c)) { const d = Math.hypot(p.x - hd.x, p.y - hd.y); if (d < bd) { bd = d; best = hd.k; } }
    if (best) return best;
    if (p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h) return 'move';
    return null;
  }
  const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move' };
  function onDown(e) {
    if (e.button > 0 || busy) return;
    const p = local(e);
    const k = grabAt(p);
    if (!k) return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    const { ow, oh } = view;
    drag = { k, p0: p, r0: { x: E.crop.x * ow, y: E.crop.y * oh, w: E.crop.w * ow, h: E.crop.h * oh }, id: e.pointerId };
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  }
  function onMove(e) {
    const p = local(e);
    if (!drag) { stage.style.cursor = CURSOR[grabAt(p)] || ''; return; }
    if (e.pointerId !== drag.id) return;
    const s = view.s;
    resize(drag.k, drag.r0, (p.x - drag.p0.x) / s, (p.y - drag.p0.y) / s);
    paintSide();
    queue();
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    commit();
  }
  /** Move or resize the crop box from r0 (pixels of the straightened picture). */
  function resize(k, r0, dx, dy) {
    const { ow, oh, s } = view;
    const min = Math.max(8, 36 / s);
    let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
    if (k === 'move') {
      const x = clamp(x0 + dx, 0, ow - r0.w), y = clamp(y0 + dy, 0, oh - r0.h);
      E.crop = { x: x / ow, y: y / oh, w: r0.w / ow, h: r0.h / oh };
      return;
    }
    if (k.includes('w')) x0 = clamp(x0 + dx, 0, x1 - min);
    if (k.includes('e')) x1 = clamp(x1 + dx, x0 + min, ow);
    if (k.includes('n')) y0 = clamp(y0 + dy, 0, y1 - min);
    if (k.includes('s')) y1 = clamp(y1 + dy, y0 + min, oh);
    const R = ratioOf();
    if (R) {
      if (k.length === 2) {
        /* a corner: the opposite corner stays put */
        const ax = k.includes('e') ? r0.x : r0.x + r0.w, ay = k.includes('s') ? r0.y : r0.y + r0.h;
        let w = x1 - x0, hh = y1 - y0;
        if (w / hh > R) w = hh * R; else hh = w / R;
        const maxW = k.includes('e') ? ow - ax : ax, maxH = k.includes('s') ? oh - ay : ay;
        if (w > maxW) { w = maxW; hh = w / R; }
        if (hh > maxH) { hh = maxH; w = hh * R; }
        if (w < min) { w = min; hh = w / R; }
        x0 = k.includes('e') ? ax : ax - w;
        y0 = k.includes('s') ? ay : ay - hh;
        x1 = x0 + w; y1 = y0 + hh;
      } else if (k === 'e' || k === 'w') {
        /* a side: the other side stays, the box stays centred the other way */
        const cy = r0.y + r0.h / 2;
        let w = x1 - x0, hh = w / R;
        const maxH = 2 * Math.min(cy, oh - cy);
        if (hh > maxH) { hh = maxH; w = hh * R; if (k === 'e') x1 = x0 + w; else x0 = x1 - w; }
        y0 = cy - hh / 2; y1 = cy + hh / 2;
      } else {
        const cx = r0.x + r0.w / 2;
        let hh = y1 - y0, w = hh * R;
        const maxW = 2 * Math.min(cx, ow - cx);
        if (w > maxW) { w = maxW; hh = w / R; if (k === 's') y1 = y0 + hh; else y0 = y1 - hh; }
        x0 = cx - w / 2; x1 = cx + w / 2;
      }
    }
    E.crop = { x: x0 / ow, y: y0 / oh, w: (x1 - x0) / ow, h: (y1 - y0) / oh };
  }
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('keydown', e => {
    if (tab !== 'crop' || before || !view || busy) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 0.05 : 0.01;
    E.crop = { ...E.crop, x: clamp(E.crop.x + d[0] * step, 0, 1 - E.crop.w), y: clamp(E.crop.y + d[1] * step, 0, 1 - E.crop.h) };
    commit();
  });
  const ro = new ResizeObserver(() => queue());
  ro.observe(stage);

  /* ---------------- keys for the whole editor ---------------- */
  const onKey = e => {
    if (dead || !root.isConnected) return;
    const win = root.closest('.win');
    if (win && !win.classList.contains('is-active')) return;
    if (document.querySelector('.spot-wrap [role="dialog"]')) return;       /* a confirm is open */
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape' && !mod) { e.preventDefault(); e.stopPropagation(); cancel(); }
  };
  window.addEventListener('keydown', onKey, true);

  /* ---------------- saving ---------------- */
  function setBusy(text) {
    busy = text;
    busyEl.hidden = !text;
    busyEl.lastChild.textContent = text || '';
    paintTop();
  }
  async function save(replace) {
    if (!pic || busy) return;
    const dir = vfs.parentPath(path);
    const jpeg = /jpe?g/i.test(pic.mime);
    if (replace) {
      const ok = await api.confirm({
        title: `Replace “${name}”?`,
        message: `The original picture is overwritten with this edit${jpeg || /png/i.test(pic.mime) ? '' : ', as a PNG'}. Undo can’t bring it back once it is saved; Save as copy keeps both.`,
        ok: 'Replace', danger: true,
      });
      if (!ok || dead) return;
    }
    setBusy(replace ? 'Replacing…' : 'Saving a copy…');
    try {
      const { blob, w, h: hh } = await renderFile(pic.src, pic.sw, pic.sh, E, pic.mime);
      if (dead) return;
      const ext = blob.type === 'image/jpeg' ? (['jpg', 'jpeg'].includes(extOf(name)) ? extOf(name) : 'jpg') : 'png';
      let out;
      if (replace) {
        const keep = ext === extOf(name) || (ext === 'jpg' && extOf(name) === 'jpeg');
        out = await media.replace(path, blob, { name: keep ? name : `${stemOf(name)}.${ext}` });
      } else {
        out = await media.save(dir, `${stemOf(name)} (edited).${ext}`, blob);
      }
      if (dead) return;
      api.notify({ app: 'Photos', icon: 'image', title: replace ? 'Original replaced' : 'Saved a copy', message: `${vfs.baseName(out.path)} · ${w.toLocaleString()} × ${hh.toLocaleString()} px` });
      close();
      onSaved?.({ path: out.path, replaced: replace });
    } catch (err) {
      setBusy('');
      const full = /quota/i.test(`${err?.name} ${err?.message}`);
      api.notify({ app: 'Photos', icon: 'alert', title: 'Couldn’t save the edit', timeout: 9000,
        message: full ? 'This browser has run out of room for StaticOS’s files. Emptying the Trash in Files frees space.' : (err?.message || 'The picture could not be written.') });
    }
  }
  async function cancel() {
    if (busy) return;
    if (dirty()) {
      const ok = await api.confirm({ title: 'Discard your edits?', message: `The changes to “${name}” haven’t been saved.`, ok: 'Discard', danger: true });
      if (!ok || dead) return;
    }
    close();
  }
  function close() {
    if (dead) return;
    dead = true;
    if (rq) cancelAnimationFrame(rq);
    window.removeEventListener('keydown', onKey, true);
    ro.disconnect();
    root.remove();
    try { pic?.src?.close?.(); } catch (err) { /* already closed */ }
    for (const c of [P.base, P.adj]) if (c) c.width = c.height = 0;
    onClose?.();
  }

  /* ---------------- start ---------------- */
  root.photoEditPeek = () => {
    const o = pic ? outputSize(E, pic.sw, pic.sh) : null;
    return {
      ready: !!pic, busy, tab, before, edit: clone(E), out: o, src: pic ? { w: pic.sw, h: pic.sh, mime: pic.mime } : null,
      undo: at, redo: hist.length - 1 - at,
      view: view ? { x: view.x, y: view.y, w: view.w, h: view.h, s: view.s } : null,
      crop: view && tab === 'crop' ? cropScreen() : null,
    };
  };
  paintAll();
  status.textContent = 'Opening…';
  decode(path).then(d => {
    if (dead) { try { d.src.close?.(); } catch (err) { /* gone */ } return; }
    pic = d;
    status.textContent = '';
    if (/gif/i.test(pic.mime)) note.textContent = 'A GIF is saved as a still PNG of its first frame.';
    else if (/svg/i.test(pic.mime)) note.textContent = `A drawing (SVG) is saved as a PNG at ${pic.sw} × ${pic.sh} px.`;
    else if (!/jpe?g|png/i.test(pic.mime)) note.textContent = 'Saved as PNG.';
    paintAll();
    stage.focus({ preventScroll: true });
  }).catch(err => {
    if (dead) return;
    status.textContent = err?.message || 'This picture can’t be opened for editing.';
    status.classList.add('is-err');
  });

  return { close, get dirty() { return dirty(); } };
}
