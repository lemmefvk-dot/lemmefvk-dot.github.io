/* ============================================================
   pixelops.js — the pure parts of Asset Lab's newer tools: shapes,
   flips and turns, outline and shadow, colour replacing and
   snapping, regions, frame tags, the sprite-sheet .json, and the
   16-step jingle. No DOM here, so each can be checked on its own.

   Pixels are RGBA Uint8ClampedArrays, row after row.

   Frame tags are { name, from, to }: frame numbers, 0-based and
   inclusive (idle [0, 3] is the first four frames). That is the
   shape Static Studio's sheet.js reads from a sheet's .json.
   ============================================================ */

const blank = (w, h) => new Uint8ClampedArray(w * h * 4);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const rgbaOf = hex => { const n = parseInt(String(hex).slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };
export const hexOf = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const CLEAR = [0, 0, 0, 0];
function put(px, w, h, x, y, c) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
}

/* An ellipse filling the box between two corners: every cell whose centre is inside it
   (filled), or just the cells on its edge (outline). */
export function ellipsePts(x0, y0, x1, y1, filled, fn) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
  const inside = (x, y) => x >= ax && x <= bx && y >= ay && y <= by && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) fn(x, y);
    }
  }
}

/** flip left-right ('h') or top-bottom ('v'); always a new buffer */
export function flipPx(px, w, h, axis) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = axis === 'h' ? w - 1 - x : x, sy = axis === 'v' ? h - 1 - y : y;
      const s = (sy * w + sx) * 4, d = (y * w + x) * 4;
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3];
    }
  }
  return out;
}
/** a quarter turn clockwise; the result is h wide and w tall */
export function rotatePx(px, w, h) {
  const out = blank(h, w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = (x * h + (h - 1 - y)) * 4;
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3];
    }
  }
  return out;
}
/** a 1-pixel outline around the drawing, in rgba; -> { px, count } */
export function outlinePx(px, w, h, rgba, diag = false) {
  const out = px.slice();
  let count = 0;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3]) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)
        || (diag && (solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1)))) {
        put(out, w, h, x, y, rgba);
        count++;
      }
    }
  }
  return { px: out, count };
}
/** the drawing's shadow, dx/dy cells away, laid only where nothing is; -> { px, count } */
export function shadowPx(px, w, h, rgba, dx = 1, dy = 1) {
  const out = px.slice();
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!px[(y * w + x) * 4 + 3]) continue;
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h || px[(ty * w + tx) * 4 + 3] || out[(ty * w + tx) * 4 + 3]) continue;
      put(out, w, h, tx, ty, rgba);
      count++;
    }
  }
  return { px: out, count };
}
/** every pixel that is exactly `from` (an [r,g,b]) becomes `to`; -> { px, count } */
export function replaceColorPx(px, from, to) {
  const out = px.slice();
  let count = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] && out[i] === from[0] && out[i + 1] === from[1] && out[i + 2] === from[2]) {
      out[i] = to[0]; out[i + 1] = to[1]; out[i + 2] = to[2]; out[i + 3] = 255;
      count++;
    }
  }
  return { px: out, count };
}
/** each colour in use over some frames, with its pixel count: Map('#rrggbb' -> n) */
export function usedColors(frames) {
  const m = new Map();
  for (const px of frames) {
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const hex = hexOf(px[i], px[i + 1], px[i + 2]);
      m.set(hex, (m.get(hex) || 0) + 1);
    }
  }
  return m;
}
/** mostly-clear pixels go clear; the rest become the nearest colour of `colors` (hex strings), by distance in RGB */
export function snapPx(px, colors) {
  const pal = colors.map(rgbaOf);
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    let best = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const d = (px[i] - pal[k][0]) ** 2 + (px[i + 1] - pal[k][1]) ** 2 + (px[i + 2] - pal[k][2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    out[i] = pal[best][0]; out[i + 1] = pal[best][1]; out[i + 2] = pal[best][2]; out[i + 3] = 255;
  }
  return out;
}
/** the piece r = {x,y,w,h} of a w×h frame (cells outside it come back clear) */
export function regionPx(px, w, h, r) {
  const out = blank(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x, sy = r.y + y;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const s = (sy * w + sx) * 4, d = (y * r.w + x) * 4;
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3];
    }
  }
  return out;
}
/** lay a piece over a frame at (ox, oy); only its opaque cells land */
export function stampPx(dst, w, h, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 4;
      if (src[s + 3]) put(dst, w, h, ox + x, oy + y, [src[s], src[s + 1], src[s + 2], src[s + 3]]);
    }
  }
}
export function clearPx(px, w, h, r) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) put(px, w, h, x, y, CLEAR);
}

/* ---------- frame tags -------------------------------------------------
   While frames are added, removed or dragged about, a tag follows the
   FRAMES it covered (by id), then covers everything between the first and
   last of them. */
export const tagsToIds = (tags, frames) => (tags || []).map(t => ({ name: t.name, ids: frames.slice(t.from, t.to + 1).map(f => f.id) }));
export function idsToTags(sets, frames) {
  const out = [];
  for (const t of sets) {
    const at = t.ids.map(id => frames.findIndex(f => f.id === id)).filter(i => i >= 0);
    if (at.length) out.push({ name: t.name, from: Math.min(...at), to: Math.max(...at) });
  }
  return out;
}
export const TAG_NAME_MAX = 24;
/** tags read back from stored data: only well-formed ones, inside the frame count */
export function cleanTags(raw, count) {
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const name = String(t && t.name || '').trim().slice(0, TAG_NAME_MAX);
    const from = Math.round(Number(t && t.from)), to = Math.round(Number(t && t.to));
    if (!name || !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from || from >= count) continue;
    out.push({ name, from, to: Math.min(to, count - 1) });
  }
  return out.slice(0, 32);
}

/* ---------- the sprite sheet layout and its .json ---------------------- */
export function sheetLayout(n, w, h, mode = 'horizontal', scale = 1) {
  const cols = mode === 'grid' ? Math.ceil(Math.sqrt(n)) : n;
  const rows = Math.ceil(n / cols);
  const rects = Array.from({ length: n }, (_, i) => ({ index: i, x: (i % cols) * w * scale, y: Math.floor(i / cols) * h * scale, w: w * scale, h: h * scale }));
  return { cols, rows, width: cols * w * scale, height: rows * h * scale, rects };
}
export function sheetJson({ name, mode, scale = 1, w, h, n, fps, tags }) {
  const L = sheetLayout(n, w, h, mode, scale);
  const json = { image: name, layout: mode, size: { w: L.width, h: L.height }, frame: { w: w * scale, h: h * scale },
    columns: L.cols, rows: L.rows, fps, frames: L.rects };
  if (tags && tags.length) json.tags = tags.map(t => ({ name: t.name, from: t.from, to: t.to }));
  return json;
}
/** the same sheet as a Studio asset's `sheet` ({ fw, fh, fps, frames:[[x,y,w,h]], tags }) */
export function studioSheet(o) {
  const j = sheetJson(o);
  return { fw: j.frame.w, fh: j.frame.h, fps: o.fps, frames: j.frames.map(r => [r.x, r.y, r.w, r.h]), tags: j.tags || [] };
}

/* ---------- the 16-step jingle ---------------------------------------- */
export const JINGLE_STEPS = 16;
export const JINGLE_ROWS = 8;
export const SCALES = [
  { id: 'major-pent', label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minor-pent', label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'major', label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
];
export const JINGLE_WAVES = ['square', 'triangle', 'saw', 'sine'];
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = m => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
export const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
export const DEFAULT_JINGLE = { bpm: 140, wave: 'square', scale: 'major-pent', root: 60, loop: false, steps: new Array(JINGLE_STEPS).fill(0) };

/** a jingle read back from stored data (always a new, valid object) */
export function normJingle(j = {}) {
  const steps = new Array(JINGLE_STEPS).fill(0);
  if (Array.isArray(j.steps)) for (let i = 0; i < JINGLE_STEPS; i++) steps[i] = (Number(j.steps[i]) | 0) & ((1 << JINGLE_ROWS) - 1);
  return {
    bpm: clamp(Math.round(Number(j.bpm)) || DEFAULT_JINGLE.bpm, 60, 240),
    wave: JINGLE_WAVES.includes(j.wave) ? j.wave : 'square',
    scale: SCALES.some(s => s.id === j.scale) ? j.scale : 'major-pent',
    root: clamp(Math.round(Number(j.root)) || 60, 36, 72),
    loop: !!j.loop, steps,
  };
}
/** the MIDI note on a grid row (0 = lowest) */
export function rowMidi(j, row) {
  const sc = SCALES.find(s => s.id === j.scale) || SCALES[0];
  return j.root + sc.steps[row % sc.steps.length] + 12 * Math.floor(row / sc.steps.length);
}
export const stepSeconds = j => 60 / clamp(j.bpm, 60, 240) / 4;      /* a sixteenth note */

/** The jingle as samples (mono, `rate` Hz): each note a short tone with a quick attack and a falling
    tail, all added and scaled so the loudest point is 0.8. Same input, same samples. */
export function renderJingle(jin, rate = 44100) {
  const j = normJingle(jin);
  const step = stepSeconds(j);
  const tail = 0.18;
  const total = Math.ceil((step * JINGLE_STEPS + tail) * rate);
  const out = new Float32Array(total);
  const noteLen = Math.max(0.05, step * 1.6);
  for (let s = 0; s < JINGLE_STEPS; s++) {
    for (let r = 0; r < JINGLE_ROWS; r++) {
      if (!(j.steps[s] & (1 << r))) continue;
      const hz = midiHz(rowMidi(j, r));
      const start = Math.round(s * step * rate);
      const len = Math.min(total - start, Math.round(noteLen * rate));
      for (let i = 0; i < len; i++) {
        const t = i / rate, ph = (t * hz) % 1;
        let v = j.wave === 'square' ? (ph < 0.5 ? 1 : -1) * 0.6
          : j.wave === 'triangle' ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph)
            : j.wave === 'saw' ? (2 * ph - 1) * 0.7 : Math.sin(2 * Math.PI * ph);
        const a = Math.min(1, t / 0.004), d = Math.exp(-t / (noteLen * 0.45));
        out[start + i] += v * a * d * 0.3;
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) { const k = 0.8 / peak; for (let i = 0; i < out.length; i++) out[i] *= k; }
  return out;
}

export default { ellipsePts, flipPx, rotatePx, outlinePx, shadowPx, replaceColorPx, usedColors, snapPx, regionPx, stampPx, clearPx,
  tagsToIds, idsToTags, cleanTags, sheetLayout, sheetJson, studioSheet, normJingle, rowMidi, renderJingle };
