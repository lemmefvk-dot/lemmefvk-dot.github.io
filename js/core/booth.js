/* ============================================================
   booth.js — Camera's spooky photo booth.

   During the spooky season (season.js spookyOn(): 24 October to the
   end of 1 November, with Spooky Season on) Camera's Photo mode gets
   a Booth panel: three filters (night vision, ghostly glow, blood
   moon), three frames that sit on the edge of the picture, and
   stickers (pumpkin, bat, witch hat, ghost, cat, spider, candy) to
   place and drag on the viewfinder. Out of season, or in Video mode,
   none of it shows and Camera is exactly what it was.

   One drawing function makes both pictures: the live preview — a
   canvas laid over the viewfinder and redrawn for every camera frame
   — and the photo, at the camera's full resolution. Everything is
   placed in fractions of the picture, and every effect is
   deterministic (scanlines, not random grain), so the saved file
   holds exactly what the preview shows, only sharper.

   The canvas is the only thing you see: a sticker on screen is the
   sticker drawn into the picture, with an invisible handle over it
   to drag (pointer or arrow keys), resize (+ and −) or remove
   (Delete, or right-click).

   Works without ctx.filter: a pixel-math fallback grades the
   picture, and the glow is a scale down and up, not a blur filter.
   Art: the Halloween stickers of js/core/halloween.js and a witch
   hat drawn here; frames are canvas paths plus that art. Nothing is
   fetched.

   createBooth(opts) → { button, panel, layer, applies(), capture(g, w, h),
                          sync(), close(), isOpen(), state(), destroy() }
   ============================================================ */
import * as HW from './halloween.js';
import * as SEASON from './season.js';

export const FILTERS = [
  { id: 'none', name: 'None' },
  { id: 'night', name: 'Night vision' },
  { id: 'ghostly', name: 'Ghostly glow' },
  { id: 'bloodmoon', name: 'Blood moon' },
];
export const FRAMES = [
  { id: 'none', name: 'None' },
  { id: 'cobwebs', name: 'Cobwebs' },
  { id: 'pumpkins', name: 'Pumpkins' },
  { id: 'bats', name: 'Bats' },
];

const HAT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
  + '<ellipse cx="50" cy="80" rx="47" ry="11" fill="#1b0f26"/>'
  + '<path d="M26 80C35 62 40 41 47 25c4-9 12-17 25-21-6 8-9 18-8 30 1 16 5 31 11 46z" fill="#2c1740"/>'
  + '<path d="M68 6c-5 8-7 17-6 28 1 15 4 30 10 46h3c-6-16-9-31-10-46-1-11 1-20 6-28z" fill="#4a2a66" opacity=".75"/>'
  + '<path d="M29 70q21 8 46 0l3 9q-26 9-52 0z" fill="#ff7a1a"/>'
  + '<rect x="45" y="68.5" width="12" height="11" rx="2" fill="none" stroke="#ffd451" stroke-width="3"/>'
  + '<ellipse cx="50" cy="79" rx="45" ry="8.5" fill="none" stroke="#3d2154" stroke-width="1.5"/>'
  + '</svg>';

/* ar = width / height of the art's own viewBox */
export const STICKERS = [
  { id: 'pumpkin', name: 'Pumpkin', ar: 1 },
  { id: 'bat', name: 'Bat', ar: 100 / 60 },
  { id: 'hat', name: 'Witch hat', ar: 1, url: HW.svgUrl(HAT_SVG) },
  { id: 'ghost', name: 'Ghost', ar: 1 },
  { id: 'cat', name: 'Black cat', ar: 1 },
  { id: 'spider', name: 'Spider', ar: 1 },
  { id: 'candy', name: 'Candy', ar: 100 / 60 },
];
const stickerDef = id => STICKERS.find(s => s.id === id) || null;
const MAX_STICKERS = 12;
const PREVIEW_MAX = 1280;          /* widest the live preview canvas gets, in pixels */
const SIZE = { def: 0.26, min: 0.08, max: 0.7 };
/* where the next new sticker lands: centre first, then around it */
const SLOTS = [[0.5, 0.5], [0.3, 0.32], [0.7, 0.32], [0.3, 0.7], [0.7, 0.7], [0.5, 0.24], [0.5, 0.78]];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- art: loaded once, shared by every Camera window ---------- */
const ART = new Map();
function art(id) {
  if (ART.has(id)) return ART.get(id);
  const d = stickerDef(id);
  const rec = { img: null, ok: false, ready: Promise.resolve(), ar: d ? d.ar : 1 };
  if (d && typeof Image === 'function') {
    const img = new Image();
    img.decoding = 'async';
    img.src = d.url || HW.artUrl('sticker', id);
    rec.img = img;
    rec.ready = (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; }))
      .then(() => { rec.ok = true; }, () => { rec.ok = img.complete && img.naturalWidth > 0; });
  }
  ART.set(id, rec);
  return rec;
}
const artUrl = id => stickerDef(id)?.url || HW.artUrl('sticker', id);

/* ---------- drawing (the same for the preview and the photo) ---------- */
let FILTER_OK = null;
function canFilter() {
  if (FILTER_OK !== null) return FILTER_OK;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.filter = 'grayscale(1)';
    g.fillStyle = 'rgb(255,0,0)';
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    FILTER_OK = Math.abs(d[0] - d[1]) < 10 && Math.abs(d[1] - d[2]) < 10;
  } catch (err) { FILTER_OK = false; }
  return FILTER_OK;
}

const scratch = { c: null, g: null };
function scratchOf(w, h) {
  if (!scratch.c) { scratch.c = document.createElement('canvas'); scratch.g = scratch.c.getContext('2d'); }
  if (scratch.c.width !== w || scratch.c.height !== h) { scratch.c.width = w; scratch.c.height = h; }
  return scratch;
}

/** Grade the picture already on `g` through CSS filter functions
    (grayscale, contrast, brightness), or the same maths by hand. */
function regrade(g, w, h, ops) {
  if (canFilter()) {
    const s = scratchOf(w, h);
    s.g.drawImage(g.canvas, 0, 0);
    g.save();
    g.filter = ops.map(([f, v]) => `${f}(${v})`).join(' ');
    g.drawImage(s.c, 0, 0);
    g.restore();
    return;
  }
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (const [op, v] of ops) {
    if (op === 'grayscale') {
      const s = 1 - Math.min(1, v);
      const m = [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s,
        0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s,
        0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s];
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gr = d[i + 1], b = d[i + 2];
        d[i] = m[0] * r + m[1] * gr + m[2] * b;
        d[i + 1] = m[3] * r + m[4] * gr + m[5] * b;
        d[i + 2] = m[6] * r + m[7] * gr + m[8] * b;
      }
    } else {
      const k = v, o = op === 'contrast' ? 127.5 * (1 - v) : 0;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = k * d[i] + o; d[i + 1] = k * d[i + 1] + o; d[i + 2] = k * d[i + 2] + o;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

function wash(g, w, h, mode, color, alpha = 1) {
  g.save();
  g.globalCompositeOperation = mode;
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.restore();
}

function vignette(g, w, h, color, inner) {
  const r = Math.hypot(w, h) / 2;
  const grd = g.createRadialGradient(w / 2, h / 2, r * inner, w / 2, h / 2, r);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, color);
  g.save();
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/* a soft glow: the picture scaled down and back up, screened over itself */
const small = { c: null, g: null };
function glow(g, w, h, alpha) {
  const sw = Math.max(4, Math.round(w / 22)), sh = Math.max(4, Math.round(h / 22));
  if (!small.c) { small.c = document.createElement('canvas'); small.g = small.c.getContext('2d'); }
  small.c.width = sw; small.c.height = sh;
  small.g.imageSmoothingEnabled = true;
  small.g.imageSmoothingQuality = 'high';
  small.g.drawImage(g.canvas, 0, 0, sw, sh);
  g.save();
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small.c, 0, 0, w, h);
  g.restore();
}

function grade(g, w, h, id) {
  if (id === 'night') {
    regrade(g, w, h, [['grayscale', 1], ['contrast', 1.35], ['brightness', 1.2]]);
    wash(g, w, h, 'multiply', 'rgb(70,255,120)');
    /* 120 scanlines whatever the size, placed in fractions of the height (not
       snapped to pixels), so a small preview and a full-size photo match */
    const N = 120, period = h / N;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.28)';
    for (let i = 0; i < N; i++) g.fillRect(0, i * period, w, period * 0.4);
    g.restore();
    vignette(g, w, h, 'rgba(0,14,0,.85)', 0.38);
  } else if (id === 'ghostly') {
    regrade(g, w, h, [['grayscale', 0.8], ['brightness', 1.1], ['contrast', 0.92]]);
    glow(g, w, h, 0.55);
    wash(g, w, h, 'soft-light', 'rgb(110,165,255)', 0.8);
    wash(g, w, h, 'screen', 'rgb(120,150,255)', 0.14);
    vignette(g, w, h, 'rgba(225,232,255,.55)', 0.42);
  } else if (id === 'bloodmoon') {
    regrade(g, w, h, [['grayscale', 1], ['contrast', 1.3], ['brightness', 1.05]]);
    wash(g, w, h, 'multiply', 'rgb(255,52,44)');
    wash(g, w, h, 'screen', 'rgb(70,0,4)', 0.6);
    vignette(g, w, h, 'rgba(22,0,0,.9)', 0.36);
  }
}

/* the frame's border: the whole picture minus a rounded window */
function band(g, w, h, t, r, fill, shadow) {
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  const x = t, y = t, iw = w - 2 * t, ih = h - 2 * t;
  g.moveTo(x + r, y);
  g.arcTo(x + iw, y, x + iw, y + ih, r);
  g.arcTo(x + iw, y + ih, x, y + ih, r);
  g.arcTo(x, y + ih, x, y, r);
  g.arcTo(x, y, x + iw, y, r);
  g.closePath();
  g.fillStyle = fill;
  if (shadow) { g.shadowColor = shadow; g.shadowBlur = t * 0.9; }
  g.fill('evenodd');
  g.restore();
}

/* a cobweb in a corner: threads fanning out from (cx, cy), rings between them */
function cobweb(g, cx, cy, R, from, lw) {
  const N = 7, rings = 5;
  const ang = k => from + (k / (N - 1)) * (Math.PI / 2);
  g.save();
  g.strokeStyle = 'rgba(236,232,248,.82)';
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.beginPath();
  for (let k = 0; k < N; k++) { g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang(k)) * R, cy + Math.sin(ang(k)) * R); }
  for (let i = 1; i <= rings; i++) {
    const r = (R * i) / (rings + 0.4);
    for (let k = 0; k < N - 1; k++) {
      const a0 = ang(k), a1 = ang(k + 1), am = (a0 + a1) / 2, sag = r * 0.82;
      if (k === 0) g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
      g.quadraticCurveTo(cx + Math.cos(am) * sag, cy + Math.sin(am) * sag, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    }
  }
  g.stroke();
  g.restore();
}

function drawArt(g, id, cx, cy, hgt) {
  const a = art(id);
  if (!a.ok) return;
  const wd = hgt * a.ar;
  g.drawImage(a.img, cx - wd / 2, cy - hgt / 2, wd, hgt);
}

function drawFrame(g, w, h, id) {
  if (!id || id === 'none') return;
  const m = Math.min(w, h), t = m * 0.05, r = m * 0.06;
  if (id === 'cobwebs') {
    band(g, w, h, t, r, 'rgb(20,11,30)', 'rgba(0,0,0,.75)');
    const lw = Math.max(1, m / 300);
    cobweb(g, 0, 0, m * 0.42, 0, lw);
    cobweb(g, w, 0, m * 0.34, Math.PI / 2, lw);
    cobweb(g, w, h, m * 0.28, Math.PI, lw);
    drawArt(g, 'spider', w * 0.8, m * 0.13, m * 0.26);
  } else if (id === 'pumpkins') {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#ffa23a');
    grd.addColorStop(1, '#c2410c');
    band(g, w, h, t, r, grd, 'rgba(60,16,0,.7)');
    const p = m * 0.27, n = Math.max(3, Math.round((w / h) * 3));
    for (let i = 0; i < n; i++) {
      const x = p * 0.55 + (i * (w - p * 1.1)) / (n - 1);
      drawArt(g, 'pumpkin', x, h - p * 0.36 - (i % 2) * p * 0.06, p * (i % 2 ? 0.82 : 1));
    }
  } else if (id === 'bats') {
    band(g, w, h, t, r, 'rgb(36,12,54)', 'rgba(8,0,16,.8)');
    g.save();
    g.fillStyle = '#f7e8b4';
    g.shadowColor = 'rgba(255,226,150,.85)';
    g.shadowBlur = m * 0.07;
    g.beginPath();
    g.arc(w - m * 0.17, m * 0.17, m * 0.075, 0, Math.PI * 2);
    g.fill();
    g.restore();
    for (const [x, y, s] of [[0.1, 0.09, 0.12], [0.24, 0.17, 0.08], [0.4, 0.07, 0.1], [0.58, 0.14, 0.07], [0.72, 0.27, 0.09], [0.14, 0.88, 0.08]]) {
      drawArt(g, 'bat', w * x, h * y, m * s);
    }
  }
}

function drawStickers(g, w, h, list) {
  for (const s of list) {
    const a = art(s.id);
    if (!a.ok) continue;
    const dh = s.s * h, dw = dh * a.ar;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.45)';
    g.shadowBlur = h * 0.02;
    g.shadowOffsetY = h * 0.008;
    g.drawImage(a.img, s.x * w - dw / 2, s.y * h - dh / 2, dw, dh);
    g.restore();
  }
}

/** The booth's part of a picture, over a canvas that already holds the camera frame. */
export function paint(g, w, h, look) {
  if (look.filter && look.filter !== 'none') grade(g, w, h, look.filter);
  drawFrame(g, w, h, look.frame);
  drawStickers(g, w, h, look.stickers || []);
}

/* ======================================================================== */

/**
 * opts: { api, frameEl, video, base(g, w, h), photoMode(), live(),
 *         load(), save(v), onOpen() }
 * base draws the camera picture the way Camera does (look, mirror);
 * the booth paints over it.
 */
export function createBooth(opts) {
  const { api, frameEl, video } = opts;
  const { h, icon } = api;
  const saved = (() => { try { return opts.load?.() || {}; } catch (err) { return {}; } })();
  const S = {
    filter: FILTERS.some(f => f.id === saved.filter) ? saved.filter : 'none',
    frame: FRAMES.some(f => f.id === saved.frame) ? saved.frame : 'none',
    stickers: (Array.isArray(saved.stickers) ? saved.stickers : [])
      .filter(s => s && stickerDef(s.id) && [s.x, s.y, s.s].every(Number.isFinite))
      .slice(0, MAX_STICKERS)
      .map((s, i) => ({ uid: `s${Date.now().toString(36)}${i}`, id: s.id, x: clamp(s.x, 0, 1), y: clamp(s.y, 0, 1), s: clamp(s.s, SIZE.min, SIZE.max) })),
    open: saved.open === true,
    dead: false,
  };
  let seq = 0;
  STICKERS.forEach(s => art(s.id).ready.then(() => { if (!S.dead) draw(); }));

  const persist = () => {
    try {
      opts.save?.({ filter: S.filter, frame: S.frame, open: S.open,
        stickers: S.stickers.map(({ id, x, y, s }) => ({ id, x: +x.toFixed(4), y: +y.toFixed(4), s: +s.toFixed(4) })) });
    } catch (err) { /* only the next visit loses it */ }
  };

  /* ---------------- the viewfinder layer ---------------- */
  const cv = h('canvas.cam-booth__cv', { 'aria-hidden': 'true', hidden: true });
  const cg = cv.getContext('2d');
  const handles = h('div.cam-booth__stks');
  const layer = h('div.cam-booth', { hidden: true }, cv, handles);

  /* ---------------- the panel ---------------- */
  const chip = (kind, item, pick) => h('button.cam-chip', {
    type: 'button', dataset: { [kind]: item.id }, 'aria-pressed': 'false', onclick: () => pick(item.id),
  }, item.name);
  const filterChips = FILTERS.map(f => chip('filter', f, setFilter));
  const frameChips = FRAMES.map(f => chip('frame', f, setFrame));
  const clearBtn = h('button.cam-chip.cam-chip--clear', { type: 'button', onclick: () => clearStickers() }, icon('trash'), h('span', { text: 'Clear' }));
  const stickerBtns = STICKERS.map(s => h('button.cam-stkbtn', {
    type: 'button', dataset: { add: s.id }, title: s.name, 'aria-label': `Add a ${s.name.toLowerCase()} sticker`,
    onclick: () => addSticker(s.id),
  }, h('img', { src: artUrl(s.id), alt: '', draggable: 'false' })));
  const group = (label, kids) => h('div.cam-booth__grp', { role: 'group', 'aria-label': label },
    h('span.cam-booth__lbl', { 'aria-hidden': 'true', text: label === 'Spooky filter' ? 'Filter' : label }), kids);
  const panel = h('div.cam__booth', { role: 'group', 'aria-label': 'Photo booth', hidden: true },
    h('div.cam-booth__in',
      h('div.cam-booth__row', group('Spooky filter', filterChips), group('Frame', frameChips)),
      h('div.cam-booth__row', group('Stickers', [...stickerBtns, clearBtn]))));

  const button = h('button.cam-tool.cam-tool--booth', {
    type: 'button', hidden: true, 'aria-label': 'Photo booth', title: 'Photo booth — Halloween filters, frames and stickers',
    onclick: () => setOpen(!S.open),
  }, icon('pumpkin'), h('span.cam-tool__lbl', { text: 'Booth' }));

  /* ---------------- state ---------------- */
  const inSeason = () => SEASON.spookyOn();
  const shown = () => !S.dead && inSeason() && opts.photoMode();
  const applies = () => shown() && (S.filter !== 'none' || S.frame !== 'none' || S.stickers.length > 0);
  const running = () => applies() && opts.live();

  function setOpen(on) {
    S.open = !!on;
    persist();
    if (S.open) opts.onOpen?.();
    sync();
  }
  function setFilter(id) { S.filter = id; persist(); sync(); }
  function setFrame(id) { S.frame = id; persist(); sync(); }

  function addSticker(id) {
    if (S.stickers.length >= MAX_STICKERS) return;
    const taken = S.stickers.map(s => `${s.x.toFixed(2)},${s.y.toFixed(2)}`);
    const slot = SLOTS.find(([x, y]) => !taken.includes(`${x.toFixed(2)},${y.toFixed(2)}`)) || SLOTS[S.stickers.length % SLOTS.length];
    const st = { uid: `n${++seq}`, id, x: slot[0], y: slot[1], s: SIZE.def };
    S.stickers.push(st);
    persist();
    sync();
    handles.querySelector(`[data-uid="${st.uid}"]`)?.focus({ preventScroll: true });
  }
  function removeSticker(uid) {
    S.stickers = S.stickers.filter(s => s.uid !== uid);
    persist();
    sync();
  }
  function clearStickers() {
    S.stickers = [];
    persist();
    sync();
  }

  /* ---------------- sticker handles ---------------- */
  const frameAr = () => (cv.width && cv.height ? cv.width / cv.height
    : (video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9));
  function placeHandle(el, st) {
    const hw = (st.s * art(st.id).ar) / frameAr();
    el.style.left = `${(st.x - hw / 2) * 100}%`;
    el.style.top = `${(st.y - st.s / 2) * 100}%`;
    el.style.width = `${hw * 100}%`;
    el.style.height = `${st.s * 100}%`;
  }

  function handleEl(st) {
    const name = stickerDef(st.id).name;
    const el = h('button.cam-stk', {
      type: 'button', dataset: { uid: st.uid, sticker: st.id }, title: name,
      'aria-label': `${name} sticker. Drag or use the arrow keys to move it, plus and minus to resize it, Delete to remove it.`,
    });
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      const r = frameEl.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const sx = e.clientX, sy = e.clientY, x0 = st.x, y0 = st.y;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('is-drag');
      const move = ev => {
        st.x = clamp(x0 + (ev.clientX - sx) / r.width, 0, 1);
        st.y = clamp(y0 + (ev.clientY - sy) / r.height, 0, 1);
        placeHandle(el, st);
        draw();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('is-drag');
        persist();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.08 : 0.02;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        st.x = clamp(st.x + mv[0], 0, 1);
        st.y = clamp(st.y + mv[1], 0, 1);
      } else if (e.key === '+' || e.key === '=') st.s = clamp(st.s * 1.15, SIZE.min, SIZE.max);
      else if (e.key === '-' || e.key === '_') st.s = clamp(st.s / 1.15, SIZE.min, SIZE.max);
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSticker(st.uid); return; }
      else return;
      e.preventDefault();
      placeHandle(el, st);
      draw();
      persist();
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      api.menu([
        { label: 'Bigger', icon: 'plus', onClick: () => { st.s = clamp(st.s * 1.2, SIZE.min, SIZE.max); persist(); sync(); } },
        { label: 'Smaller', icon: 'minus', onClick: () => { st.s = clamp(st.s / 1.2, SIZE.min, SIZE.max); persist(); sync(); } },
        '-',
        { label: 'Remove Sticker', icon: 'trash', onClick: () => removeSticker(st.uid) },
        { label: 'Remove All Stickers', icon: 'x', danger: true, onClick: () => clearStickers() },
      ], e.clientX, e.clientY);
    });
    return el;
  }

  function paintHandles() {
    const keep = new Set(S.stickers.map(s => s.uid));
    for (const el of [...handles.children]) if (!keep.has(el.dataset.uid)) el.remove();
    for (const st of S.stickers) {
      let el = handles.querySelector(`[data-uid="${st.uid}"]`);
      if (!el) { el = handleEl(st); handles.appendChild(el); }
      placeHandle(el, st);
    }
  }

  /* ---------------- the live preview ---------------- */
  function sizePreview() {
    const vw = video.videoWidth, vh = video.videoHeight, box = frameEl.clientWidth;
    if (!vw || !vh || !box) return false;
    /* sharp on the screen, never bigger than the camera's picture, and capped so a
       retina screen doesn't redraw 4K thirty times a second (the photo is full size) */
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.min(vw, Math.round(box * dpr), PREVIEW_MAX));
    const hh = Math.max(2, Math.round((w * vh) / vw));
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; paintHandles(); }
    return true;
  }

  function render(g, w, hh) {
    opts.base(g, w, hh);
    paint(g, w, hh, S);
  }

  function draw() {
    if (!running() || !sizePreview()) return;
    try { render(cg, cv.width, cv.height); cv.hidden = false; } catch (err) { /* the next frame tries again */ }
  }

  let loop = 0, loopKind = '';
  function tick() {
    loop = 0;
    if (!running()) return;
    draw();
    if (typeof video.requestVideoFrameCallback === 'function') { loopKind = 'v'; loop = video.requestVideoFrameCallback(tick); }
    else { loopKind = 'r'; loop = requestAnimationFrame(tick); }
  }
  function stopLoop() {
    if (!loop) return;
    if (loopKind === 'v') video.cancelVideoFrameCallback?.(loop); else cancelAnimationFrame(loop);
    loop = 0;
  }

  /** Re-read season, mode and camera state; redraw. Camera calls it from its paint. */
  function sync() {
    if (S.dead) return;
    const show = shown();
    button.hidden = !show;
    button.classList.toggle('is-on', show && S.open);
    button.setAttribute('aria-expanded', String(show && S.open));
    panel.hidden = !(show && S.open);
    for (const b of filterChips) { const on = b.dataset.filter === S.filter; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const b of frameChips) { const on = b.dataset.frame === S.frame; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
    clearBtn.hidden = !S.stickers.length;
    for (const b of stickerBtns) b.disabled = S.stickers.length >= MAX_STICKERS;

    const run = running();
    layer.hidden = !run;
    if (!run) { stopLoop(); cv.hidden = true; return; }
    paintHandles();
    draw();
    if (!loop) tick();
  }

  /** Draw the photo: the camera frame at w×h with everything the preview shows. */
  async function capture(g, w, hh) {
    await Promise.all(STICKERS.map(s => art(s.id).ready));
    render(g, w, hh);
  }

  function destroy() {
    S.dead = true;
    stopLoop();
    cv.width = cv.height = 0;
  }

  return {
    button, panel, layer, applies, capture, sync, destroy,
    close: () => { if (S.open) setOpen(false); },
    isOpen: () => S.open,
    state: () => ({ filter: S.filter, frame: S.frame, stickers: S.stickers.map(s => ({ ...s })) }),
  };
}

export default { createBooth, paint, FILTERS, FRAMES, STICKERS };
