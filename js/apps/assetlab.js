/* ============================================================
   assetlab.js — Asset Lab: sprites and sound effects for your
   game projects.

   Three tabs in one window:

   · Sprite — a pixel editor. The document is { w, h, frames[], cur }
     and every frame is an RGBA Uint8ClampedArray. A frame's buffer is
     never changed once a stroke ends: a stroke first COPIES the frame
     it paints on. So an undo snapshot is only the frames array (the
     buffers are shared, not copied), and 100 steps of history for a
     128×128, 16-frame sprite cost a few MB instead of hundreds.
     Tools: pencil, eraser, flood fill, eyedropper, line, rectangle
     (Shift = filled) and mirror-X drawing. Onion skin shows the
     previous frame; the preview plays the frames at the chosen fps.
     PNG exports come straight from a canvas.
   · Sound — an sfxr-style synth built from WebAudio nodes. A sound is
     rendered ONCE with an OfflineAudioContext, and that one buffer is
     what the waveform shows, what Play plays and what the WAV holds
     (16-bit PCM mono, encoded here). What you hear is what you export.
   · Library — what you saved, kept in IndexedDB (db.js store 'assets',
     keys 'assetlab:<id>'), next to one of your game projects' assets
     (projects.js), with add and remove.

   The AI sprite draft is experimental and says so. It sends ONLY the
   typed prompt, the 16-colour palette and one worked format example to
   the free model (llm.js), asks for 16 rows of 16 hex digits ("." =
   transparent) and checks the answer strictly. If it is not exactly
   that, nothing is drawn and the reason is shown, with the raw answer
   one click away. There is no silent repair and no stand-in art. While
   llm.js queues or retries (onWait) the panel says "Waiting for the
   model…" and why.

   Options (on open and on reopen): { project } — made for that game
   (Studio's "Open Asset Lab"): Save offers it first and a chip says so;
   { tab } — 'sprite' | 'sound' | 'library'; { prompt } — prefills the
   AI draft (never sends it by itself); { edit: { project, asset } } —
   opens one of a game's images in the sprite editor. Adding to a
   project never replaces an asset (Studio points at them by id): a
   taken name becomes name-2, name-3, …

   Send to Studio (sprite tab): one menu, one click. It lists your game
   projects (the one Asset Lab was opened for and the one last open in
   Studio first), adds the frame you are on as a PNG to that project's
   assets and opens it in Static Studio, where it is in the Assets list
   ready to use as a sprite. "New Studio game with this sprite" starts a
   blank Studio project for it first. (Static Forge has no asset list of
   its own, so there is nothing there to send to.)

   The open sprite and sound are autosaved as a draft
   ('assetlab:draft'), so a reload does not lose work. Small prefs
   (tool, colour, recent colours, grid, onion, fps, tab, project) live
   in store 'portal.assetlab'.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import * as DB from '../core/db.js';
import * as Projects from '../core/projects.js';
import * as LLM from '../portal/llm.js';
import { template as studioTemplate } from '../studio/templates.js';
import { buildDoc } from '../studio/runtime.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-assetlab-css')) {
  const l = document.createElement('link');
  l.id = 'feat-assetlab-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-assetlab.css';
  document.head.appendChild(l);
}

/* ---------- constants ------------------------------------------------ */
/* Sweetie 16 by GrafxKid: a well-balanced 16-colour pixel-art palette.
   The names are what the AI draft is told, so they describe the colour. */
export const PALETTE = [
  ['#1a1c2c', 'near-black'], ['#5d275d', 'dark purple'], ['#b13e53', 'crimson red'], ['#ef7d57', 'orange'],
  ['#ffcd75', 'light yellow'], ['#a7f070', 'lime green'], ['#38b764', 'green'], ['#257179', 'dark teal'],
  ['#29366f', 'navy blue'], ['#3b5dc9', 'blue'], ['#41a6f6', 'sky blue'], ['#73eff7', 'cyan'],
  ['#f4f4f4', 'white'], ['#94b0c2', 'light grey'], ['#566c86', 'slate grey'], ['#333c57', 'dark slate'],
];
const SIZES = [8, 16, 24, 32, 48, 64];
const MAX_SIDE = 128;
const MAX_FRAMES = 64;
const HISTORY = 100;
const ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];
const PKEY = 'portal.assetlab';
const LIBKEY = 'assetlab:';
const DRAFT = 'assetlab:draft';
const SR = 44100;
const AI_SIZE = 16;

const TOOLS = [
  { id: 'pencil', label: 'Pencil', key: 'B', hint: 'right-click erases, Alt-click picks a colour' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'picker', label: 'Eyedropper', key: 'I' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rectangle', key: 'R', hint: 'hold Shift for a filled one' },
];

/* tool glyphs the shared icon set does not have — static SVG only */
const GLYPH = {
  pencil: '<path d="M4 20l1.1-4.4L15.8 4.9a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8L8.4 18.9z"/><path d="M14 6.7l3.3 3.3"/>',
  eraser: '<path d="M9 20h11"/><path d="M4.6 14.4l9.2-9.2a2 2 0 0 1 2.8 0l2.8 2.8a2 2 0 0 1 0 2.8L11 19.2a2.7 2.7 0 0 1-3.8 0l-2.6-2.6a1.6 1.6 0 0 1 0-2.2z"/><path d="M9.2 9.8l5 5"/>',
  fill: '<path d="M4.6 11.2 11.2 4.6l7.4 7.4-6.3 6.3a2 2 0 0 1-2.8 0l-4.9-4.9a1.6 1.6 0 0 1 0-2.2z"/><path d="M4.4 12.4h14"/><path d="M8.2 2.6 11 5.4"/><path d="M20.6 15.4s1.6 2.1 1.6 3.2a1.6 1.6 0 0 1-3.2 0c0-1.1 1.6-3.2 1.6-3.2z"/>',
  picker: '<path d="M16.4 3.6a2.3 2.3 0 0 1 3.3 3.3l-2.1 2.1-3.3-3.3z"/><path d="M13.1 6.9l4 4"/><path d="M15.1 8.9 6.6 17.4 4 20l2.6-2.6"/><path d="M6.6 17.4 5.2 18.8"/>',
  line: '<path d="M6 18 18 6"/><rect x="3.5" y="15.5" width="5" height="5" rx="1"/><rect x="15.5" y="3.5" width="5" height="5" rx="1"/>',
  rect: '<rect x="4" y="5.5" width="16" height="13" rx="1.5"/>',
  mirror: '<path d="M12 3v2.2M12 8.4v2.2M12 13.4v2.2M12 18.8V21"/><path d="M9 7.5 4 12l5 4.5z"/><path d="M15 7.5l5 4.5-5 4.5z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  onion: '<rect x="3" y="7" width="11" height="11" rx="2" stroke-dasharray="2.2 2"/><rect x="9" y="4" width="11" height="11" rx="2"/>',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uid = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
  .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'asset';
const isHex = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
const kb = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const dataBytes = url => { const i = String(url).indexOf(','); return i < 0 ? 0 : Math.floor((url.length - i - 1) * 3 / 4); };

/* ---------- pixels (pure) -------------------------------------------- */
const rgbaOf = hex => { const n = parseInt(String(hex).slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };
const hexOf = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const CLEAR = [0, 0, 0, 0];
const blank = (w, h) => new Uint8ClampedArray(w * h * 4);

function put(px, w, h, x, y, c) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
}
const at = (px, w, x, y) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
/* every fully transparent pixel counts as the same colour, whatever its rgb */
const same = (a, b) => (a[3] === 0 && b[3] === 0) || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);

/** 4-way flood fill of the region under (x0, y0). Returns false when
    nothing would change. */
export function floodFill(px, w, h, x0, y0, c) {
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;
  const target = at(px, w, x0, y0);
  if (same(target, c)) return false;
  const seen = new Uint8Array(w * h);
  const stack = [y0 * w + x0];
  seen[y0 * w + x0] = 1;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p - x) / w;
    put(px, w, h, x, y, c);
    const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of next) {
      if (q < 0 || seen[q]) continue;
      const qx = q % w;
      if (same(at(px, w, qx, (q - qx) / w), target)) { seen[q] = 1; stack.push(q); }
    }
  }
  return true;
}

/** Bresenham: every cell on the line, both ends included. */
export function linePts(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 4096; guard++) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function rectPts(x0, y0, x1, y1, filled, fn) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) if (filled || y === ay || y === by || x === ax || x === bx) fn(x, y);
  }
}

/* canvas resize keeps the art centred (crops or pads evenly) */
function resizeBuf(px, w, h, nw, nh) {
  const out = blank(nw, nh);
  const ox = Math.floor((nw - w) / 2), oy = Math.floor((nh - h) / 2);
  for (let y = 0; y < h; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= nh) continue;
    for (let x = 0; x < w; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= nw) continue;
      const s = (y * w + x) * 4, d = (ty * nw + tx) * 4;
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3];
    }
  }
  return out;
}
const isBlank = px => { for (let i = 3; i < px.length; i += 4) if (px[i]) return false; return true; };
const countPx = px => { let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) n++; return n; };
const equalPx = (a, b) => { if (a === b) return true; if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/* ---------- canvases --------------------------------------------------- */
function frameCanvas(px, w, h, scale = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
  if (scale === 1) return c;
  const s = document.createElement('canvas');
  s.width = w * scale; s.height = h * scale;
  const g = s.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, s.width, s.height);
  return s;
}
/** Where each frame sits on a sprite sheet: one row ('horizontal') or a near-square grid. */
export function sheetLayout(n, w, h, mode = 'horizontal', scale = 1) {
  const cols = mode === 'grid' ? Math.ceil(Math.sqrt(n)) : n;
  const rows = Math.ceil(n / cols);
  const rects = Array.from({ length: n }, (_, i) => ({ index: i, x: (i % cols) * w * scale, y: Math.floor(i / cols) * h * scale, w: w * scale, h: h * scale }));
  return { cols, rows, width: cols * w * scale, height: rows * h * scale, rects };
}
function sheetCanvas(frames, w, h, scale = 1, mode = 'horizontal') {
  const L = sheetLayout(frames.length, w, h, mode, scale);
  const c = document.createElement('canvas');
  c.width = L.width; c.height = L.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  frames.forEach((px, i) => g.drawImage(frameCanvas(px, w, h), L.rects[i].x, L.rects[i].y, w * scale, h * scale));
  return c;
}
const canvasBlob = c => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('The PNG could not be encoded.'))), 'image/png'));
const blobDataUrl = b => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error || new Error('read failed'));
  r.readAsDataURL(b);
});
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- the AI draft ----------------------------------------------- */
/* The format: 16 labelled rows ("r00:" … "r15:"), each 16 pixels apart
   by single spaces, one hex digit per pixel (a palette index) and "."
   for transparent. Tested against the free model (GPT-OSS 20B): with
   the pixels run together ("..066.."), a run of dots is one token to
   it, so it lost count in most answers; spaced pixels and row labels
   got the count right far more often. One worked example (sent as an
   earlier chat turn) pins the format down. It is a potion flask, not
   something round and red, because an apple example was sent back
   for "a red heart"; an answer that is (nearly) the example is still
   rejected unless a potion was asked for. */
const HEXD = '0123456789abcdef';
const AI_EXAMPLE = {
  prompt: 'a blue potion bottle',
  subject: /\b(potions?|flasks?|bottles?|vials?|elixirs?)\b/i,
  grid: [
    '................', '......0000......', '......0330......', '.....000000.....',
    '......0dd0......', '......0dc0......', '....00dddd00....', '...0dcdddddd0...',
    '..0dcbbbbbbbd0..', '..0cbbbbbbbbb0..', '..0bbbbbbbbba0..', '..0abbbbbbbaa0..',
    '...0aaaaaaa70...', '....07777770....', '.....000000.....', '................',
  ],
};
const aiRow = (r, i) => `r${String(i).padStart(2, '0')}: ${[...r].join(' ')}`;
export const AI_SYSTEM = [
  'You draw tiny 16x16 pixel-art sprites for 2D video games.',
  'Reply with ONLY one JSON object and nothing else (no prose, no markdown, no code fences): {"grid":[16 strings]}',
  'There are exactly 16 rows, r00 to r15. Each string starts with its row label ("r00: " … "r15: ") and then has exactly 16 pixels separated by single spaces.',
  'A pixel is a palette index written as ONE hex digit (0-9, a-f), or "." for a transparent pixel.',
  'Palette: ' + PALETTE.map(([, name], i) => `${HEXD[i]} = ${name}`).join(', ') + '.',
  'The background is ".". Centre the subject and make it fill most of the grid. Outline it with 0, shade it with two or three tones of its own colour and add one small highlight (c).',
  'Keep your reasoning short: do not plan pixel by pixel, write the grid straight away.',
  'The earlier example only shows the format. Always draw a NEW picture of exactly what is asked.',
].join('\n');
export function aiMessages(prompt) {
  return [
    { role: 'system', content: AI_SYSTEM },
    { role: 'user', content: `Draw this as a 16x16 sprite: ${AI_EXAMPLE.prompt}` },
    { role: 'assistant', content: JSON.stringify({ grid: AI_EXAMPLE.grid.map(aiRow) }) },
    { role: 'user', content: `Draw this as a 16x16 sprite: ${prompt}` },
  ];
}
/* sent with every draft: low reasoning effort leaves the free tier's
   1,500-token answer for the grid (at the default effort the model can
   think for the whole budget and send nothing), and a fresh seed,
   because the service caches identical requests and a retry of a bad
   answer should not get the same answer back */
export const aiParams = () => ({ reasoning_effort: 'low', seed: 1 + Math.floor(Math.random() * 1e9) });
const EXAMPLE_KEY = AI_EXAMPLE.grid.join('');

/* How far a model's grid may be off and still be read. The free model
   cannot count characters reliably: in tests most answers were right
   except for a row a pixel too long or short, or a row missing, always
   in the transparent margin. Those are evened out ONLY by adding or
   trimming transparent pixels at the edges (never a coloured one), and
   the result says so. Anything further off is rejected. */
const SLACK = 2;
const ROW_LABEL = /^\s*(?:r(?:ow)?\s*)?\d{1,2}\s*[:=]\s*/i;

/* one row (a string like ". . 0 6 6" or "..066", or an array of
   integers / null) as cells of -1..15, or the reason it is not one */
function cellsOf(row, y) {
  if (typeof row === 'string') {
    const out = [];
    for (const ch of row.replace(ROW_LABEL, '').replace(/[\s,|]/g, '')) {
      if (ch === '.') out.push(-1);
      else if (/^[0-9a-f]$/i.test(ch)) out.push(parseInt(ch, 16));
      else return { error: `Row ${y + 1} has “${ch.slice(0, 4)}”, which is not a palette index (0–9, a–f) or “.”.` };
    }
    return { cells: out };
  }
  if (Array.isArray(row)) {
    const out = [];
    for (let x = 0; x < row.length; x++) {
      const v = row[x] === null ? -1 : row[x];
      if (!Number.isInteger(v) || v < -1 || v > 15) {
        return { error: `Row ${y + 1}, cell ${x + 1} is ${JSON.stringify(v).slice(0, 12)}, which is not a palette index (0–15 or -1).` };
      }
      out.push(v);
    }
    return { cells: out };
  }
  return { error: `Row ${y + 1} is not a row of pixels.` };
}

/* fit a row that is a little too long or short to `size` by trimming or
   adding transparent cells at its ends, choosing the ends that line it
   up best with the row above it; null when that would cut the drawing */
function alignRow(cells, size, ref) {
  const d = cells.length - size;
  if (!d) return cells;
  if (Math.abs(d) > SLACK) return null;
  const opts = [];
  if (d > 0) {
    for (let o = d; o >= 0; o--) {                       /* o = trimmed from the left */
      const cut = [...cells.slice(0, o), ...cells.slice(cells.length - (d - o))];
      if (cut.every(v => v < 0)) opts.push(cells.slice(o, cells.length - (d - o)));
    }
  } else {
    for (let o = 0; o <= -d; o++) opts.push([...Array(o).fill(-1), ...cells, ...Array(-d - o).fill(-1)]);
  }
  if (!opts.length) return null;
  if (!ref) return opts[0];
  const score = r => r.reduce((n, v, x) => n + ((v >= 0) === (ref[x] >= 0) ? 1 : 0), 0);
  return opts.reduce((best, r) => (score(r) > score(best) ? r : best), opts[0]);
}

/* the rows of a grid inside the answer: a JSON object or array first,
   then (for an answer cut off at the end) quoted rows one by one */
function rowsOf(raw) {
  const tries = [];
  const gi = raw.search(/"(?:grid|pixels|rows)"\s*:/);
  const g1 = gi > 0 ? raw.lastIndexOf('{', gi) : -1, g2 = gi >= 0 ? raw.indexOf('}', gi) : -1;
  if (g1 >= 0 && g2 > g1) tries.push(raw.slice(g1, g2 + 1));
  const o1 = raw.indexOf('{'), o2 = raw.lastIndexOf('}');
  if (o1 >= 0 && o2 > o1) tries.push(raw.slice(o1, o2 + 1));
  const a1 = raw.indexOf('['), a2 = raw.lastIndexOf(']');
  if (a1 >= 0 && a2 > a1) tries.push(raw.slice(a1, a2 + 1));
  let json = false;
  for (const t of tries) {
    let data;
    try { data = JSON.parse(t); } catch (err) { continue; }
    json = true;
    const rows = Array.isArray(data) ? data : (data && (data.grid || data.pixels || data.rows));
    if (Array.isArray(rows) && rows.length && rows.every(r => typeof r === 'string' || Array.isArray(r))) return { rows };
  }
  const quoted = [...raw.matchAll(/"((?:\s*(?:r(?:ow)?\s*)?\d{1,2}\s*[:=])?[\s.0-9a-fA-F,|]{8,})"/g)].map(m => m[1]).filter(s => /[.0-9a-f]/i.test(s));
  if (quoted.length >= AI_SIZE - SLACK) return { rows: quoted, loose: true };
  return { error: json ? 'The answer had no "grid" array of rows.' : 'The answer was not valid JSON.' };
}

/** Read a model's answer as a size×size grid of palette indices
    (-1 = transparent). Every cell must be a palette index; a grid that
    is off by a pixel or two in its transparent margin is evened out and
    the fix is reported in `fixes`. Anything else is rejected with a
    reason a person can read. opts.prompt lets an asked-for apple pass
    the "copied the example" check. */
export function parseGrid(text, size = AI_SIZE, opts = {}) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '').trim();
  if (!raw) return { ok: false, error: 'The answer was empty.' };
  const found = rowsOf(raw);
  if (found.error) return { ok: false, error: found.error };
  const rows = found.rows;
  if (Math.abs(rows.length - size) > SLACK) return { ok: false, error: `The grid had ${rows.length} rows instead of ${size}.` };
  const parsed = [];
  for (let y = 0; y < rows.length; y++) {
    const r = cellsOf(rows[y], y);
    if (r.error) return { ok: false, error: r.error };
    parsed.push(r.cells);
  }
  /* columns: rows of the right length first, then the others lined up
     with their neighbour above (or the first good row) */
  const grid = [];
  let long = 0, short = 0;
  const firstGood = parsed.find(r => r.length === size) || null;
  for (let y = 0; y < parsed.length; y++) {
    const cells = parsed[y];
    const fit = alignRow(cells, size, grid[y - 1] || firstGood);
    if (!fit) {
      return { ok: false, error: Math.abs(cells.length - size) > SLACK
        ? `Row ${y + 1} had ${cells.length} cells instead of ${size}.`
        : `Row ${y + 1} had ${cells.length} cells instead of ${size}, and the extra ones are part of the drawing.` };
    }
    if (cells.length > size) long++; else if (cells.length < size) short++;
    grid.push(fit);
  }
  /* rows: add or drop fully transparent rows at the edges, keeping the
     drawing as centred as it was */
  const blankRow = r => r.every(v => v < 0);
  const edge = () => {
    let top = 0, bottom = 0;
    while (top < grid.length && blankRow(grid[top])) top++;
    while (bottom < grid.length - top && blankRow(grid[grid.length - 1 - bottom])) bottom++;
    return { top, bottom };
  };
  const rowsWere = grid.length;
  while (grid.length < size) {
    const { top, bottom } = edge();
    if (bottom <= top) grid.push(Array(size).fill(-1)); else grid.unshift(Array(size).fill(-1));
  }
  while (grid.length > size) {
    const { top, bottom } = edge();
    if (!top && !bottom) return { ok: false, error: `The grid had ${rowsWere} rows instead of ${size}, and the extra ones are part of the drawing.` };
    if (bottom >= top) grid.pop(); else grid.shift();
  }
  const cellsAll = grid.flat();
  const used = new Set(cellsAll);
  if (used.size === 1) return { ok: false, error: used.has(-1) ? 'The grid was completely empty.' : 'The grid was one solid colour.' };
  const inked = cellsAll.filter(v => v >= 0).length;
  if (inked < 8) return { ok: false, error: `The grid had only ${inked} coloured pixel${inked === 1 ? '' : 's'}, which is not a drawing.` };
  if (size === AI_SIZE && !AI_EXAMPLE.subject.test(String(opts.prompt || ''))) {
    const ex = EXAMPLE_KEY;
    let same = 0;
    cellsAll.forEach((v, i) => { if ((v < 0 ? '.' : HEXD[v]) === ex[i]) same++; });
    if (same / cellsAll.length >= 0.9) return { ok: false, error: 'The model sent back its format example (a potion bottle) instead of a new drawing.' };
  }
  const fixes = [];
  if (long || short) {
    const parts = [];
    if (long) parts.push(`${long} row${long > 1 ? 's' : ''} a pixel or two too long`);
    if (short) parts.push(`${short} row${short > 1 ? 's' : ''} a pixel or two short`);
    fixes.push(parts.join(' and '));
  }
  if (rowsWere !== size) fixes.push(`${rowsWere} rows instead of ${size}`);
  return { ok: true, grid, fixes, loose: !!found.loose };
}

/** The model's answer made readable for "Show what it sent": a grid
    of rows is printed one row per line so the attempt can be seen. */
export function prettyRaw(text) {
  const raw = String(text || '');
  try {
    const gi = raw.search(/"grid"\s*:/);
    const a = gi >= 0 ? raw.indexOf('[', gi) : -1;
    let depth = 0, b = -1;
    for (let i = a; a >= 0 && i < raw.length; i++) {
      if (raw[i] === '[') depth++;
      else if (raw[i] === ']' && --depth === 0) { b = i; break; }
    }
    if (a < 0 || b < 0) return raw;
    const rows = JSON.parse(raw.slice(a, b + 1));
    if (!Array.isArray(rows)) return raw;
    const lines = rows.map(r => (Array.isArray(r) ? r.join(',') : String(r)));
    const before = raw.slice(0, raw.lastIndexOf('{', gi) >= 0 ? raw.lastIndexOf('{', gi) : gi).trim();
    return (before ? before + '\n' : '') + lines.join('\n');
  } catch (err) { return raw; }
}

/* ---------- sound (WebAudio) -------------------------------------------- */
export const WAVES = [
  { id: 'square', label: 'Square' }, { id: 'sine', label: 'Sine' },
  { id: 'saw', label: 'Saw' }, { id: 'noise', label: 'Noise' },
];
/* per-wave loudness so a square and a sine at the same Volume feel alike */
const LEVEL = { square: 0.62, saw: 0.7, sine: 0.95, noise: 0.85 };

const fmtHz = v => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 2)} kHz` : `${Math.round(v)} Hz`);
const fmtS = v => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
export const KNOBS = [
  { k: 'f0', label: 'Start pitch', group: 'Pitch', min: 40, max: 4000, log: true, fmt: fmtHz },
  { k: 'f1', label: 'End pitch', group: 'Pitch', min: 40, max: 4000, log: true, fmt: fmtHz },
  { k: 'jump', label: 'Pitch jump', group: 'Pitch', min: -12, max: 24, step: 1, fmt: v => (v ? `${v > 0 ? '+' : ''}${v} semitones` : 'off') },
  { k: 'jumpAt', label: 'Jump at', group: 'Pitch', min: 0.05, max: 0.95, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { k: 'dur', label: 'Length', group: 'Envelope', min: 0.04, max: 1.5, step: 0.01, fmt: fmtS },
  { k: 'attack', label: 'Attack', group: 'Envelope', min: 0, max: 0.5, step: 0.005, fmt: fmtS },
  { k: 'decay', label: 'Decay', group: 'Envelope', min: 0, max: 1.5, step: 0.01, fmt: fmtS },
  { k: 'vibDepth', label: 'Vibrato depth', group: 'Vibrato', min: 0, max: 2, step: 0.05, fmt: v => (v ? `${v.toFixed(2)} st` : 'off') },
  { k: 'vibSpeed', label: 'Vibrato speed', group: 'Vibrato', min: 0.5, max: 30, step: 0.5, fmt: v => `${v.toFixed(1)} Hz` },
  { k: 'volume', label: 'Volume', group: 'Output', min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
];
const DEFAULT_SOUND = { wave: 'square', f0: 880, f1: 880, jump: 0, jumpAt: 0.5, dur: 0.09, attack: 0, decay: 0.05, vibDepth: 0, vibSpeed: 8, volume: 0.6, seed: 7 };

/** Every field clamped into its range; always a NEW object. */
export function normSound(p = {}) {
  const out = { ...DEFAULT_SOUND };
  out.wave = WAVES.some(w => w.id === p.wave) ? p.wave : DEFAULT_SOUND.wave;
  for (const k of KNOBS) {
    const v = Number(p[k.k]);
    out[k.k] = Number.isFinite(v) ? clamp(v, k.min, k.max) : DEFAULT_SOUND[k.k];
    if (k.step === 1) out[k.k] = Math.round(out[k.k]);
  }
  out.seed = Number.isInteger(p.seed) && p.seed > 0 ? p.seed : 1 + Math.floor(Math.random() * 1e9);
  return out;
}

const R = (a, b) => a + Math.random() * (b - a);
const RL = (a, b) => a * Math.pow(b / a, Math.random());
const pick = a => a[Math.floor(Math.random() * a.length)];
/* sfxr-style: every click on a preset rolls a new variation of that kind */
export const PRESETS = [
  { id: 'coin', label: 'Coin', icon: 'star', make: () => { const f = RL(700, 1500); return { wave: pick(['square', 'square', 'sine']), f0: f, f1: f, jump: pick([4, 5, 7, 12]), jumpAt: R(0.12, 0.35), dur: R(0.22, 0.42), attack: 0, decay: R(0.14, 0.3), vibDepth: 0 }; } },
  { id: 'jump', label: 'Jump', icon: 'arrow-up', make: () => { const f = RL(220, 420); return { wave: pick(['square', 'square', 'sine']), f0: f, f1: f * R(1.8, 3), jump: 0, dur: R(0.2, 0.34), attack: 0, decay: R(0.12, 0.24), vibDepth: 0 }; } },
  { id: 'hit', label: 'Hit', icon: 'zap', make: () => { const noise = Math.random() < 0.5; const f = noise ? RL(700, 1800) : RL(260, 700); return { wave: noise ? 'noise' : pick(['saw', 'square']), f0: f, f1: f * R(0.15, 0.35), jump: 0, dur: R(0.12, 0.24), attack: 0, decay: R(0.08, 0.18), vibDepth: 0 }; } },
  { id: 'explosion', label: 'Explosion', icon: 'flame', make: () => ({ wave: 'noise', f0: RL(260, 800), f1: RL(40, 80), jump: 0, dur: R(0.6, 1.1), attack: 0, decay: R(0.45, 0.9), vibDepth: Math.random() < 0.4 ? R(0.3, 1) : 0, vibSpeed: R(4, 14) }) },
  { id: 'powerup', label: 'Power-up', icon: 'sparkles', make: () => { const f = RL(200, 420); return { wave: pick(['square', 'saw', 'sine']), f0: f, f1: f * R(2.2, 4), jump: 0, dur: R(0.45, 0.8), attack: R(0, 0.03), decay: R(0.2, 0.4), vibDepth: R(0.4, 1.2), vibSpeed: R(10, 22) }; } },
  { id: 'laser', label: 'Laser', icon: 'send', make: () => { const f = RL(1200, 2800); return { wave: pick(['saw', 'square', 'sine']), f0: f, f1: f * R(0.08, 0.25), jump: 0, dur: R(0.14, 0.3), attack: 0, decay: R(0.08, 0.2), vibDepth: Math.random() < 0.3 ? R(0.2, 0.8) : 0, vibSpeed: R(15, 30) }; } },
  { id: 'blip', label: 'Blip', icon: 'circle', make: () => { const f = RL(500, 1300); return { wave: pick(['square', 'sine']), f0: f, f1: f, jump: 0, dur: R(0.05, 0.11), attack: 0, decay: R(0.02, 0.06), vibDepth: 0 }; } },
  { id: 'random', label: 'Random', icon: 'shuffle', make: () => ({ wave: pick(WAVES).id, f0: RL(60, 3000), f1: RL(60, 3000), jump: Math.random() < 0.35 ? pick([-12, -5, 3, 4, 5, 7, 12]) : 0, jumpAt: R(0.15, 0.7), dur: R(0.08, 0.9), attack: Math.random() < 0.7 ? 0 : R(0, 0.2), decay: R(0.05, 0.6), vibDepth: Math.random() < 0.4 ? R(0.1, 1.5) : 0, vibSpeed: R(2, 25) }) },
];
export const makePreset = id => {
  const p = PRESETS.find(x => x.id === id) || PRESETS[0];
  return normSound({ ...DEFAULT_SOUND, volume: 0.6, jumpAt: 0.5, vibSpeed: 8, ...p.make(), seed: 1 + Math.floor(Math.random() * 1e9) });
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the node graph in an OfflineAudioContext and render it.
    Resolves to the AudioBuffer (mono, 44.1 kHz). */
export function renderSound(params) {
  const p = normSound(params);
  const Offline = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!Offline) return Promise.reject(new Error('This browser cannot render audio offline (no OfflineAudioContext).'));
  const dur = p.dur;
  const ac = new Offline(1, Math.max(1, Math.round(dur * SR)), SR);

  let src, pitch, k;
  if (p.wave === 'noise') {
    /* seeded white noise, looped; playbackRate stands in for pitch the
       way sfxr's noise does (about 32 new values per pitch period) */
    const nb = ac.createBuffer(1, SR, SR);
    const d = nb.getChannelData(0);
    const rnd = mulberry(p.seed);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    src = ac.createBufferSource();
    src.buffer = nb;
    src.loop = true;
    pitch = src.playbackRate;
    k = 32 / SR;
  } else {
    src = ac.createOscillator();
    src.type = p.wave === 'saw' ? 'sawtooth' : p.wave;
    pitch = src.frequency;
    k = 1;
  }

  /* slide from f0 to f1 (exponential, like a pitch sweep), with an
     optional jump by `jump` semitones at jumpAt of the length */
  const cap = f => Math.min(20000, Math.max(1, f));
  pitch.setValueAtTime(k * cap(p.f0), 0);
  if (p.jump) {
    const tj = p.jumpAt * dur;
    const fj = p.f0 * Math.pow(p.f1 / p.f0, p.jumpAt);
    const m = Math.pow(2, p.jump / 12);
    pitch.exponentialRampToValueAtTime(k * cap(fj), tj);
    pitch.setValueAtTime(k * cap(fj * m), tj);
    pitch.exponentialRampToValueAtTime(k * cap(p.f1 * m), dur);
  } else {
    pitch.exponentialRampToValueAtTime(k * cap(p.f1), dur);
  }

  if (p.vibDepth > 0 && src.detune) {
    const lfo = ac.createOscillator();
    lfo.frequency.value = p.vibSpeed;
    const depth = ac.createGain();
    depth.gain.value = p.vibDepth * 100;           /* semitones -> cents */
    lfo.connect(depth).connect(src.detune);
    lfo.start(0);
    lfo.stop(dur + 0.01);
  }

  /* envelope: rise over `attack`, hold, fall over `decay` to silence at
     the end. A few ms at each edge are kept so the edges never click. */
  const env = ac.createGain();
  const v = p.volume * LEVEL[p.wave];
  const A = clamp(p.attack, 0.002, Math.max(0.002, dur - 0.004));
  const D = clamp(p.decay, 0.004, Math.max(0.004, dur - A));
  const g = env.gain;
  g.setValueAtTime(0, 0);
  g.linearRampToValueAtTime(v, A);
  g.setValueAtTime(v, Math.max(A, dur - D));
  g.linearRampToValueAtTime(0, dur);

  src.connect(env).connect(ac.destination);
  src.start(0);
  src.stop(dur + 0.005);
  return ac.startRendering();
}

/** 16-bit PCM mono WAV, little-endian, 44-byte header. */
export function encodeWav(samples, rate = SR) {
  const n = samples.length;
  const out = new ArrayBuffer(44 + n * 2);
  const v = new DataView(out);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

function peaksOf(samples, n) {
  const out = [];
  const step = samples.length / n;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = Math.floor(i * step), e = Math.floor((i + 1) * step); j < e; j++) m = Math.max(m, Math.abs(samples[j]));
    out.push(Math.round(m * 1000) / 1000);
  }
  return out;
}

/* ---------- the library (IndexedDB) ------------------------------------- */
const LIB = DB.kv('assets');
async function libList() {
  const all = await LIB.all();
  return all.filter(v => v && v.app === 'assetlab' && (v.kind === 'sprite' || v.kind === 'sound'))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/* ======================================================================= */

defineApp({
  id: 'assetlab',
  name: 'Asset Lab',
  icon: 'image',
  g1: '#ff6fae', g2: '#c4246c',
  category: 'Create',
  keywords: ['sprite', 'pixel', 'pixel art', 'animation', 'spritesheet', 'png', 'draw', 'sound', 'sfx',
    'sfxr', 'synth', 'wav', 'sound effect', 'game assets', 'forge'],
  desc: 'Draw pixel sprites and make sound effects for your games',
  singleton: true,
  win: { w: 980, h: 640, minW: 400, minH: 440 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['B', 'Pencil'],
    ['E', 'Eraser'],
    ['G', 'Fill'],
    ['I', 'Eyedropper'],
    ['L', 'Line'],
    ['R', 'Rectangle'],
    ['M', 'Mirror drawing on or off'],
    ['O', 'Onion skin on or off'],
    [', / .', 'Previous / next frame'],
    ['Plus / -', 'Zoom in / out'],
    ['0', 'Fit the sprite'],
    ['Mod+Z', 'Undo'],
    ['Mod+Shift+Z / Mod+Y', 'Redo'],
    ['P', 'Play the sound (Sound tab)'],
  ],

  mount(ctx) {
    const { root, win, api } = ctx;
    const { h, icon, clear, store, bus } = api;

    const reducedMotion = () => !!store.get('prefs.reduceMotion')
      || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const pref = () => { const v = store.get(PKEY, null); return v && typeof v === 'object' ? v : {}; };
    const setPref = patch => store.set(PKEY, { ...pref(), ...patch });
    const P0 = pref();

    /* everything that must be undone on close goes through these */
    const offs = [];
    const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); offs.push(() => t.removeEventListener(ev, fn, o)); };
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!S.dead) fn(); }, ms); timers.add(id); return id; };
    const cancel = id => { if (id) { clearTimeout(id); timers.delete(id); } };
    const debounce = (fn, ms) => { let t = 0; return () => { cancel(t); t = later(() => { t = 0; fn(); }, ms); }; };
    const glyph = name => h('span.icon', { html: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${GLYPH[name]}</svg>` });
    /* focus in something that is not this window (a shell menu, a confirm
       sheet, Spotlight) means keys and pastes are not meant for us */
    const focusElsewhere = () => {
      const t = document.activeElement;
      return !!t && t !== document.body && t !== document.documentElement && !(win.el && win.el.contains(t));
    };

    const S = {
      dead: false,
      tab: ['sprite', 'sound', 'library'].includes(P0.tab) ? P0.tab : 'sprite',
      doc: { w: 16, h: 16, frames: [{ id: uid('f'), px: blank(16, 16) }], cur: 0 },
      past: [], future: [],
      tool: TOOLS.some(t => t.id === P0.tool) ? P0.tool : 'pencil',
      mirror: !!P0.mirror, grid: P0.grid !== false, onion: !!P0.onion, onionMode: ['prev', 'next', 'both'].includes(P0.onionMode) ? P0.onionMode : 'prev', onionOp: clamp(Math.round(+P0.onionOp) || 30, 10, 80),
      color: isHex(P0.color) ? P0.color.toLowerCase() : PALETTE[6][0],
      recent: Array.isArray(P0.recent) ? P0.recent.filter(isHex).slice(0, 8) : [],
      fps: clamp(Math.round(+P0.fps) || 8, 1, 24),
      fit: true, zoom: 16, dpr: 1,
      spriteName: 'sprite', spriteLib: null,
      stroke: null, hover: null, kbd: null, kbdLast: null, anchor: null,
      playing: !reducedMotion(), pframe: 0,
      ai: { busy: false, ac: null },
      snd: normSound(DEFAULT_SOUND), sndName: 'blip', sndLib: null, buf: null, renderSeq: 0,
      actx: null, player: null, autoplay: P0.autoplay !== false,
      projects: [], projectId: typeof P0.projectId === 'string' ? P0.projectId : '',
      lib: [], libFilter: ['all', 'sprite', 'sound'].includes(P0.libFilter) ? P0.libFilter : 'all',
      touched: false, audioEl: null, sheet: null, forProject: null,
      fromAsset: null,             /* { project, asset, name } when opened from a game's image */
    };

    /* ================================ shell ================================ */
    const TABS = [
      { id: 'sprite', label: 'Sprite', icon: 'image' },
      { id: 'sound', label: 'Sound', icon: 'volume' },
      { id: 'library', label: 'Library', icon: 'layers' },
    ];
    const libCount = h('span.al-tab__n');
    const tabBtns = TABS.map(t => h('button.al-tab', {
      type: 'button', role: 'tab', id: `al-tab-${t.id}`, 'aria-controls': `al-view-${t.id}`,
      dataset: { tab: t.id }, onclick: () => setTab(t.id),
      onkeydown: e => {
        const i = TABS.findIndex(x => x.id === t.id);
        const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length
          : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
        if (j < 0) return;
        e.preventDefault();
        setTab(TABS[j].id);
        tabBtns[j].focus();
      },
    }, icon(t.icon), h('span.al-tab__t', { text: t.label }), t.id === 'library' ? libCount : null));
    const tabList = h('div.al-tabs', { role: 'tablist', 'aria-label': 'Asset Lab' }, tabBtns);

    /* one place that renames the open sprite or sound, so the title over
       the waveform (and the draft) always match what was typed */
    function setName(kind, v) {
      v = String(v || '').slice(0, 40);
      if (kind === 'sound') { S.sndName = v; sndTitle.textContent = v.trim() || 'sound'; } else S.spriteName = v;
      if (S.tab === kind && nameIn.value !== v) nameIn.value = v;
      touch();
    }
    const nameIn = h('input.al-name', {
      type: 'text', maxlength: '40', spellcheck: 'false', 'aria-label': 'Name',
      oninput: e => setName(S.tab === 'sound' ? 'sound' : 'sprite', e.target.value),
      onblur: e => {
        if (e.target.value.trim() || S.tab === 'library') return;
        setName(S.tab, S.tab === 'sound' ? 'sound' : 'sprite');
      },
    });
    const nameWrap = h('label.al-namewrap', h('span.al-namewrap__ic'), nameIn);
    const acts = h('div.al-acts');
    /* shown when Asset Lab was opened for a game (from Studio): where
       Save sends things, one click from the sheet that does it */
    const forChip = h('button.al-for', {
      type: 'button', hidden: true,
      onclick: e => { if (S.tab === 'library') projSel.focus(); else openSheet(S.tab, e.currentTarget); },
    });
    const top = h('header.al-top', tabList, h('span.al-grow'), forChip, nameWrap, acts);

    const sayEl = h('div.al-say', { role: 'status', 'aria-live': 'polite' });
    const infoEl = h('div.al-info');
    const status = h('footer.al-status', infoEl, sayEl);
    let sayT = 0;
    function say(msg, kind = '') {
      sayEl.textContent = msg || '';
      sayEl.dataset.kind = kind;
      cancel(sayT);
      if (msg) sayT = later(() => { sayEl.textContent = ''; }, kind === 'err' ? 9000 : 5500);
    }

    const views = {
      sprite: h('div.al-view.al-sp', { id: 'al-view-sprite', role: 'tabpanel', 'aria-labelledby': 'al-tab-sprite' }),
      sound: h('div.al-view.al-snd', { id: 'al-view-sound', role: 'tabpanel', 'aria-labelledby': 'al-tab-sound' }),
      library: h('div.al-view.al-lib', { id: 'al-view-library', role: 'tabpanel', 'aria-labelledby': 'al-tab-library' }),
    };
    const al = h('div.al', top, h('div.al-views', views.sprite, views.sound, views.library), status);
    root.appendChild(h('div.app.app--col', al));

    function setTab(t) {
      S.tab = t;
      setPref({ tab: t });
      tabBtns.forEach(b => {
        const on = b.dataset.tab === t;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      for (const [k, v] of Object.entries(views)) v.hidden = k !== t;
      nameWrap.hidden = t === 'library';
      nameIn.value = t === 'sound' ? S.sndName : S.spriteName;
      nameIn.setAttribute('aria-label', t === 'sound' ? 'Sound name' : 'Sprite name');
      nameWrap.firstChild.replaceChildren(icon(t === 'sound' ? 'volume' : 'image'));
      paintActs();
      paintInfo();
      if (t === 'sprite') { layout(); syncPreviewLoop(); } else stopPreviewLoop();
      if (t === 'sound') { drawWave(); if (!S.buf) rerender(); }
      if (t === 'library') { refreshLib(); refreshProjects(); }
    }

    function actBtn(ic, label, onclick, cls = '', title = label) {
      return h(`button.btn.btn--sm.al-act${cls}`, { type: 'button', onclick, title, 'aria-label': label }, icon(ic), h('span.al-act__t', { text: label }));
    }
    function paintActs() {
      clear(acts);
      if (S.tab === 'sprite') {
        acts.append(...[
          actBtn('plus', 'New', newSprite),
          actBtn('upload', 'Import', () => importIn.click(), '', 'Import an image (you can also drop or paste one)'),
          actBtn('download', 'Export', e => exportMenu(e.currentTarget)),
          api.getApp('studio') ? actBtn('send', 'Send to Studio', e => sendMenu(e.currentTarget), '', 'Add this sprite to a game in Static Studio') : null,
          actBtn('save', 'Save', e => openSheet('sprite', e.currentTarget), '.btn--primary'),
        ].filter(Boolean));
      } else if (S.tab === 'sound') {
        acts.append(
          actBtn('download', 'Export WAV', exportWav),
          actBtn('save', 'Save', e => openSheet('sound', e.currentTarget), '.btn--primary'));
      }
    }

    function paintInfo() {
      if (S.tab === 'sprite') {
        const { w, h: hh, frames, cur } = S.doc;
        const c = S.kbd || S.hover;
        infoEl.textContent = `${w}×${hh} · frame ${cur + 1} of ${frames.length}${c ? ` · x ${c[0]}, y ${c[1]}` : ''}`;
      } else if (S.tab === 'sound') {
        const b = S.buf;
        infoEl.textContent = b ? `${fmtS(b.duration)} · 44.1 kHz · 16-bit mono WAV · ${kb(44 + b.length * 2)}` : 'Rendering…';
      } else {
        infoEl.textContent = DB.persistent
          ? 'Saved in this browser (IndexedDB). Clearing site data removes it.'
          : 'IndexedDB is unavailable here, so the library only lasts until StaticOS closes.';
      }
    }

    /* the draft: autosaved work in progress */
    const draftData = () => {
      const d = S.doc;
      return {
        app: 'assetlab', kind: 'draft', at: Date.now(),
        sprite: { w: d.w, h: d.h, frames: d.frames.map(f => f.px), cur: d.cur, name: S.spriteName, lib: S.spriteLib, fps: S.fps, src: S.fromAsset },
        sound: { params: S.snd, name: S.sndName, lib: S.sndLib },
      };
    };
    const saveDraft = debounce(() => { LIB.set(DRAFT, draftData()).catch(() => {}); }, 700);
    function touch() { S.touched = true; saveDraft(); }

    /* ============================== SPRITE ============================== */

    /* ---- history ---- */
    const snap = () => ({ w: S.doc.w, h: S.doc.h, frames: S.doc.frames.slice(), cur: S.doc.cur, name: S.spriteName, lib: S.spriteLib, src: S.fromAsset });
    const trimHistory = () => { while (S.past.length > HISTORY) S.past.shift(); };
    /* a stroke passes keepFuture: its step is only kept (and redo only
       dropped, and the oldest step only trimmed) once it changed a pixel */
    function pushHistory(keepFuture = false) {
      S.past.push(snap());
      if (!keepFuture) { S.future = []; trimHistory(); }
    }
    /* `named` marks steps that also changed the sprite's name or library
       entry (open, import, new, AI draft): only those put the name back,
       so undoing a stroke never reverts a rename typed in between */
    function applySnap(s) {
      S.doc = { w: s.w, h: s.h, frames: s.frames.slice(), cur: clamp(s.cur, 0, s.frames.length - 1) };
      if (s.named || s.lib !== S.spriteLib) { S.spriteLib = s.lib; S.spriteName = s.name; S.fromAsset = s.src || null; if (S.tab === 'sprite') nameIn.value = s.name; }
      S.anchor = null;
      refreshSprite();
      touch();
    }
    function undo() {
      if (S.stroke) return;
      if (!S.past.length) { say('Nothing to undo.'); return; }
      const s = S.past.pop();
      S.future.push({ ...snap(), named: s.named });
      applySnap(s);
    }
    function redo() {
      if (S.stroke) return;
      if (!S.future.length) { say('Nothing to redo.'); return; }
      const s = S.future.pop();
      S.past.push({ ...snap(), named: s.named });
      applySnap(s);
    }
    /* a structural change (frames, size, load): one history step */
    function change(fn) {
      const name = S.spriteName, lib = S.spriteLib, src = S.fromAsset;
      pushHistory();
      fn();
      if (S.spriteName !== name || S.spriteLib !== lib || S.fromAsset !== src) S.past[S.past.length - 1].named = true;
      S.doc.cur = clamp(S.doc.cur, 0, S.doc.frames.length - 1);
      refreshSprite();
      touch();
    }

    /* ---- tools rail ---- */
    const toolBtns = new Map();
    const mirrorBtn = h('button.al-tool', { type: 'button', title: 'Mirror X (M) — draw both halves at once', 'aria-label': 'Mirror drawing (M)', onclick: () => setMirror(!S.mirror) }, glyph('mirror'));
    const undoBtn = h('button.al-tool', { type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: undo }, glyph('undo'));
    const redoBtn = h('button.al-tool', { type: 'button', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', onclick: redo }, glyph('redo'));
    const rail = h('div.al-rail', { role: 'toolbar', 'aria-label': 'Drawing tools', 'aria-orientation': 'vertical' },
      TOOLS.map(t => {
        const b = h('button.al-tool', {
          type: 'button', title: `${t.label} (${t.key})${t.hint ? ' — ' + t.hint : ''}`,
          'aria-label': `${t.label} (${t.key})`, onclick: () => setTool(t.id),
        }, glyph(t.id));
        toolBtns.set(t.id, b);
        return b;
      }),
      h('i.al-rail__sep'), mirrorBtn, h('i.al-rail__sep'), undoBtn, redoBtn);
    /* a toolbar: arrow keys move between its buttons (either direction,
       since it runs across the top in a narrow window) */
    listen(rail, 'keydown', e => {
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      const edge = e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : '';
      if (!d && !edge) return;
      const btns = [...rail.querySelectorAll('.al-tool:not([disabled])')];
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const j = edge === 'first' ? 0 : edge === 'last' ? btns.length - 1 : (i + d + btns.length) % btns.length;
      btns[j].focus();
    });

    function setTool(id) {
      S.tool = id;
      S.anchor = null;
      setPref({ tool: id });
      toolBtns.forEach((b, k) => { b.classList.toggle('is-on', k === id); b.setAttribute('aria-pressed', String(k === id)); });
      cv.dataset.tool = id;
      schedule();
    }
    function setMirror(on) {
      S.mirror = on;
      setPref({ mirror: on });
      mirrorBtn.classList.toggle('is-on', on);
      mirrorBtn.setAttribute('aria-pressed', String(on));
      schedule();
    }

    /* ---- stage ---- */
    const cv = h('canvas.al-cv', {
      tabindex: '0', role: 'application', 'aria-roledescription': 'pixel canvas',
      'aria-label': 'Sprite canvas. Arrow keys move the cursor, Space or Enter uses the current tool.',
    });
    const cvBox = h('div.al-cvbox', cv);
    const stage = h('div.al-stage', cvBox);

    const sizeSel = h('select.al-select', { 'aria-label': 'Canvas size', onchange: () => onSize() },
      SIZES.map(n => h('option', { value: String(n), text: `${n} × ${n}` })),
      h('option', { value: 'custom', text: 'Custom…' }));
    const cwIn = h('input.al-num', { type: 'number', min: '1', max: String(MAX_SIDE), 'aria-label': 'Width in pixels' });
    const chIn = h('input.al-num', { type: 'number', min: '1', max: String(MAX_SIDE), 'aria-label': 'Height in pixels' });
    const customBox = h('form.al-custom', {
      hidden: true, novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        const w = Math.round(+cwIn.value), hh = Math.round(+chIn.value);
        if (!(w >= 1 && w <= MAX_SIDE && hh >= 1 && hh <= MAX_SIDE)) { say(`Width and height must be 1 to ${MAX_SIDE}.`, 'err'); return; }
        resizeDoc(w, hh);
      },
    }, cwIn, h('span.al-x', { text: '×' }), chIn, h('button.btn.btn--sm', { type: 'submit', text: 'Apply' }));
    const gridBtn = h('button.al-ib', { type: 'button', title: 'Pixel grid', 'aria-label': 'Show pixel grid', onclick: () => { S.grid = !S.grid; setPref({ grid: S.grid }); paintToggles(); schedule(); } }, icon('grid-9'));
    const onionBtn = h('button.al-ib', { type: 'button', title: 'Onion skin (O) — see the frames either side, faintly', 'aria-label': 'Onion skin (O)', onclick: () => setOnion(!S.onion) }, glyph('onion'));
    const onionMode = h('select.al-select', { 'aria-label': 'Onion skin shows', onchange: () => { S.onionMode = onionMode.value; setPref({ onionMode: S.onionMode }); schedule(); } },
      [['prev', 'Previous frame'], ['next', 'Next frame'], ['both', 'Both']].map(([v, l]) => h('option', { value: v, text: l, selected: v === S.onionMode })));
    const onionOpOut = h('output.al-onionop__v', { text: `${S.onionOp}%` });
    const onionOp = h('input.al-range', { type: 'range', min: '10', max: '80', step: '5', value: String(S.onionOp), 'aria-label': 'Onion skin opacity',
      oninput: () => { S.onionOp = +onionOp.value; onionOpOut.textContent = `${S.onionOp}%`; setPref({ onionOp: S.onionOp }); schedule(); } });
    const onionBox = h('span.al-onionbox', { hidden: !S.onion }, onionMode, onionOp, onionOpOut);
    const zoomLbl = h('span.al-zoom', { 'aria-live': 'off' });
    const zoomOut = h('button.al-ib', { type: 'button', title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: () => zoomBy(-1) }, icon('minus'));
    const zoomIn = h('button.al-ib', { type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => zoomBy(1) }, icon('plus'));
    const fitBtn = h('button.al-ib', { type: 'button', title: 'Fit to window (0)', 'aria-label': 'Fit to window', onclick: () => { S.fit = true; layout(); } }, icon('expand'));
    const stageBar = h('div.al-stagebar',
      h('span.al-lbl', { text: 'Canvas' }), sizeSel, customBox, h('span.al-grow'),
      gridBtn, onionBtn, onionBox, h('i.al-vsep'), zoomOut, zoomLbl, zoomIn, fitBtn);

    function setOnion(on) { S.onion = on; setPref({ onion: on }); paintToggles(); schedule(); }
    function paintToggles() {
      gridBtn.classList.toggle('is-on', S.grid); gridBtn.setAttribute('aria-pressed', String(S.grid));
      onionBtn.classList.toggle('is-on', S.onion); onionBtn.setAttribute('aria-pressed', String(S.onion));
      onionBox.hidden = !S.onion;
    }

    /* ---- frames strip ---- */
    const frameList = h('div.al-frlist', { role: 'group', 'aria-label': 'Frames' });
    const frCount = h('span.al-frames__n');
    const frOps = {
      add: h('button.al-ib', { type: 'button', title: 'New blank frame', 'aria-label': 'New blank frame', onclick: () => addFrame(false) }, icon('plus')),
      dup: h('button.al-ib', { type: 'button', title: 'Duplicate frame', 'aria-label': 'Duplicate frame', onclick: () => addFrame(true) }, icon('copy')),
      left: h('button.al-ib', { type: 'button', title: 'Move frame earlier', 'aria-label': 'Move frame earlier', onclick: () => moveFrame(-1) }, icon('chevron-left')),
      right: h('button.al-ib', { type: 'button', title: 'Move frame later', 'aria-label': 'Move frame later', onclick: () => moveFrame(1) }, icon('chevron-right')),
      del: h('button.al-ib.al-ib--danger', { type: 'button', title: 'Delete frame', 'aria-label': 'Delete frame', onclick: delFrame }, icon('trash')),
    };
    const frameBar = h('div.al-frames',
      h('div.al-frames__head', h('b', { text: 'Frames' }), frCount),
      frameList,
      h('div.al-frames__ops', frOps.add, frOps.dup, frOps.left, frOps.right, frOps.del));
    const thumbs = new Map();       /* frame id -> canvas */

    function paintFrames() {
      clear(frameList);
      thumbs.clear();
      const { frames, cur, w, h: hh } = S.doc;
      const k = Math.min(40 / w, 40 / hh);
      frames.forEach((f, i) => {
        const c = h('canvas.al-fr__cv', { width: String(w), height: String(hh), style: { width: Math.max(1, Math.round(w * k)) + 'px', height: Math.max(1, Math.round(hh * k)) + 'px' } });
        thumbs.set(f.id, c);
        drawThumb(f);
        frameList.append(h('button.al-fr', {
          type: 'button', class: i === cur ? 'is-on' : null,
          'aria-label': `Frame ${i + 1} of ${frames.length}`, 'aria-pressed': String(i === cur),
          onclick: () => selectFrame(i),
        }, h('span.al-fr__box', c), h('span.al-fr__i', { text: String(i + 1) })));
      });
      frCount.textContent = `${cur + 1} / ${frames.length}`;
      frOps.del.disabled = frames.length < 2;
      frOps.left.disabled = cur === 0;
      frOps.right.disabled = cur === frames.length - 1;
      frOps.add.disabled = frOps.dup.disabled = frames.length >= MAX_FRAMES;
      revealFrame();
    }
    /* keep the chosen thumbnail in view by scrolling the strip only;
       scrollIntoView would also scroll the whole view in a narrow window */
    function revealFrame() {
      const b = frameList.children[S.doc.cur];
      if (!b) return;
      const l = b.offsetLeft - frameList.offsetLeft, r = l + b.offsetWidth;
      if (l < frameList.scrollLeft) frameList.scrollLeft = l - 8;
      else if (r > frameList.scrollLeft + frameList.clientWidth) frameList.scrollLeft = r - frameList.clientWidth + 8;
    }
    function drawThumb(f) {
      const c = thumbs.get(f.id);
      if (!c) return;
      c.getContext('2d').putImageData(new ImageData(f.px, S.doc.w, S.doc.h), 0, 0);
    }
    function selectFrame(i) {
      if (S.stroke) return;
      S.doc.cur = clamp(i, 0, S.doc.frames.length - 1);
      S.anchor = null;
      [...frameList.children].forEach((b, j) => { b.classList.toggle('is-on', j === S.doc.cur); b.setAttribute('aria-pressed', String(j === S.doc.cur)); });
      frCount.textContent = `${S.doc.cur + 1} / ${S.doc.frames.length}`;
      frOps.left.disabled = S.doc.cur === 0;
      frOps.right.disabled = S.doc.cur === S.doc.frames.length - 1;
      revealFrame();
      paintInfo();
      schedule();
    }
    function addFrame(copy) {
      if (S.doc.frames.length >= MAX_FRAMES) { say(`A sprite can have up to ${MAX_FRAMES} frames.`); return; }
      change(() => {
        const f = S.doc.frames[S.doc.cur];
        S.doc.frames.splice(S.doc.cur + 1, 0, { id: uid('f'), px: copy ? f.px : blank(S.doc.w, S.doc.h) });
        S.doc.cur += 1;
      });
    }
    function delFrame() {
      if (S.doc.frames.length < 2) return;
      const n = S.doc.cur + 1;
      change(() => { S.doc.frames.splice(S.doc.cur, 1); S.doc.cur = Math.min(S.doc.cur, S.doc.frames.length - 1); });
      say(`Deleted frame ${n}. Ctrl+Z brings it back.`);
    }
    function moveFrame(d) {
      const i = S.doc.cur, j = i + d;
      if (j < 0 || j >= S.doc.frames.length) return;
      change(() => { const f = S.doc.frames; [f[i], f[j]] = [f[j], f[i]]; S.doc.cur = j; });
    }

    /* ---- colour panel ---- */
    const curSw = h('span.al-cur__sw');
    const curHex = h('code.al-cur__hex');
    const curName = h('b.al-cur__name');
    const picker = h('input.al-picker', {
      type: 'color', 'aria-label': 'Pick a custom colour',
      oninput: e => setColor(e.target.value, false),
      onchange: e => setColor(e.target.value, true),
    });
    const palBtns = PALETTE.map(([hex, name], i) => h('button.al-sw', {
      type: 'button', style: { '--c': hex }, title: `${name} ${hex}`,
      'aria-label': `Colour ${i + 1}: ${name}`, onclick: () => setColor(hex, false),
    }));
    const recentRow = h('div.al-recent', { role: 'group', 'aria-labelledby': 'al-recent-l' });
    const colorSec = h('section.al-sec',
      h('h3.al-sec__h', { text: 'Colour' }),
      h('div.al-cur', curSw, h('div.al-cur__t', curName, curHex),
        h('label.al-pickbtn', { title: 'Custom colour' }, picker, icon('palette'), h('span', { text: 'Custom' }))),
      h('div.al-pal', { role: 'group', 'aria-label': 'Palette (Sweetie 16)' }, palBtns),
      h('div.al-recentrow', h('span.al-sec__sub', { id: 'al-recent-l', text: 'Recent' }), recentRow));

    function setColor(hex, remember) {
      if (!isHex(hex)) return;
      S.color = hex.toLowerCase();
      if (remember) pushRecent(S.color);
      setPref({ color: S.color });
      if (S.tool === 'eraser' || S.tool === 'picker') setTool('pencil');
      paintColor();
    }
    function pushRecent(hex) {
      S.recent = [hex, ...S.recent.filter(c => c !== hex)].slice(0, 8);
      setPref({ recent: S.recent });
      paintRecent();
    }
    function paintColor() {
      curSw.style.setProperty('--c', S.color);
      curHex.textContent = S.color.toUpperCase();
      const named = PALETTE.find(p => p[0] === S.color);
      curName.textContent = named ? named[1][0].toUpperCase() + named[1].slice(1) : 'Custom colour';
      picker.value = S.color;
      palBtns.forEach((b, i) => { const on = PALETTE[i][0] === S.color; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      [...recentRow.querySelectorAll('.al-sw')].forEach(b => b.classList.toggle('is-on', b.dataset.c === S.color));
    }
    function paintRecent() {
      clear(recentRow);
      if (!S.recent.length) { recentRow.append(h('span.al-fine', { text: 'Colours you use appear here.' })); return; }
      S.recent.forEach(hex => recentRow.append(h('button.al-sw.al-sw--sm', {
        type: 'button', style: { '--c': hex }, dataset: { c: hex }, title: hex.toUpperCase(),
        'aria-label': `Recent colour ${hex.toUpperCase()}`, onclick: () => setColor(hex, false),
      })));
      paintColor();
    }

    /* ---- preview panel ---- */
    const pv = h('canvas.al-pv__cv', { 'aria-hidden': 'true' });
    const pvPlay = h('button.al-ib', { type: 'button', onclick: () => { S.playing = !S.playing; syncPreviewLoop(); paintPvCtl(); } });
    const fpsOut = h('output.al-pv__fps');
    const fpsIn = h('input.al-range', {
      type: 'range', min: '1', max: '24', step: '1', value: String(S.fps), 'aria-label': 'Frames per second',
      oninput: e => { S.fps = +e.target.value; setPref({ fps: S.fps }); paintPvCtl(); touch(); },
    });
    const pvSec = h('section.al-sec',
      h('h3.al-sec__h', { text: 'Preview' }),
      h('div.al-pv', h('div.al-pv__box', pv)),
      h('div.al-pv__ctl', pvPlay, fpsIn, fpsOut));
    function paintPvCtl() {
      const many = S.doc.frames.length > 1;
      pvPlay.replaceChildren(icon(S.playing && many ? 'pause' : 'play', { fill: true }));
      pvPlay.setAttribute('aria-label', S.playing ? 'Pause preview' : 'Play preview');
      pvPlay.title = S.playing ? 'Pause' : 'Play';
      pvPlay.disabled = !many;
      fpsOut.textContent = `${S.fps} fps`;
      fpsIn.style.setProperty('--p', `${((S.fps - 1) / 23) * 100}%`);
    }
    let pvRaf = 0, pvLast = 0, pvAcc = 0;
    function drawPreview(i) {
      const { w, h: hh, frames } = S.doc;
      const f = frames[clamp(i, 0, frames.length - 1)];
      if (pv.width !== w || pv.height !== hh) {
        pv.width = w; pv.height = hh;
        const k = Math.min(82 / w, 82 / hh);
        const s = k >= 1 ? Math.floor(k) : k;
        pv.style.width = Math.round(w * s) + 'px';
        pv.style.height = Math.round(hh * s) + 'px';
      }
      pv.getContext('2d').putImageData(new ImageData(f.px, w, hh), 0, 0);
    }
    function pvTick(t) {
      pvRaf = 0;
      if (S.dead) return;
      if (!pvLast) pvLast = t;
      pvAcc += t - pvLast;
      pvLast = t;
      const step = 1000 / S.fps;
      if (pvAcc >= step) {
        pvAcc %= step;
        S.pframe = (S.pframe + 1) % S.doc.frames.length;
        drawPreview(S.pframe);
      }
      pvRaf = requestAnimationFrame(pvTick);
    }
    function stopPreviewLoop() { if (pvRaf) cancelAnimationFrame(pvRaf); pvRaf = 0; pvLast = 0; }
    function syncPreviewLoop() {
      const run = S.playing && S.doc.frames.length > 1 && S.tab === 'sprite' && !S.dead;
      if (run && !pvRaf) { pvLast = 0; pvAcc = 0; pvRaf = requestAnimationFrame(pvTick); }
      if (!run) { stopPreviewLoop(); drawPreview(S.doc.cur); }
    }

    /* ---- AI draft panel ---- */
    const aiIn = h('input.al-in', {
      type: 'text', maxlength: '120', placeholder: 'e.g. a green slime', 'aria-label': 'Describe a sprite for the AI to draft',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); if (!S.ai.busy) aiGo(); } },
    });
    const aiBtn = h('button.btn.btn--sm.al-ai__go', { type: 'button', onclick: () => (S.ai.busy ? S.ai.ac?.abort() : aiGo()) });
    /* the live region is repainted only when the phase changes; the
       ticking seconds sit in an aria-hidden span so a screen reader is
       not told the time every second */
    const aiOut = h('div.al-ai__out', { 'aria-live': 'polite' });
    const aiSec = h('section.al-sec.al-ai',
      h('h3.al-sec__h', h('span', { text: 'AI draft' }), h('span.al-badge', { text: 'Experimental' })),
      h('div.al-ai__row', aiIn, aiBtn),
      aiOut,
      h('p.al-fine', { text: `Sends only your words, the palette and one format example to ${LLM.MODEL_LABEL} (free, ${LLM.HOST}). Drafts are rough, 16×16, and can take a minute or two. An answer that is not a valid grid draws nothing.` }));

    const AI_IDLE = { busy: false, ac: null, phase: '', t0: 0, chars: 0, attempt: 0, round: 1, why: '', error: '', raw: '', done: '', fix: '' };
    /* the smallest canvas that fits a 16×16 draft without cropping */
    const aiFit = () => [Math.max(S.doc.w, AI_SIZE), Math.max(S.doc.h, AI_SIZE)];
    S.ai = { ...AI_IDLE };
    let aiTick = 0;
    const aiMeta = h('span.al-ai__meta', { 'aria-hidden': 'true' });
    function paintAiMeta() {
      const a = S.ai;
      if (!a.busy) return;
      const secs = Math.max(0, Math.round((Date.now() - a.t0) / 1000));
      aiMeta.textContent = a.chars ? `${a.chars} chars · ${secs} s` : `${secs} s`;
    }
    function aiClock() {
      cancel(aiTick);
      aiTick = 0;
      if (!S.ai.busy) return;
      paintAiMeta();
      aiTick = later(aiClock, 1000);
    }
    function aiPhase(phase, extra = {}) {
      if (S.ai.phase === phase && !Object.keys(extra).length) return;
      S.ai = { ...S.ai, phase, ...extra };
      paintAI();
    }
    /* the model's answer, one click away; a grid keeps one row per line
       (scrolling sideways in a narrow panel) so its shape can be seen */
    const rawBox = raw => h('details.al-raw', h('summary', { text: 'Show what the model sent' }),
      h(`pre${/"(?:grid|pixels|rows)"\s*:/.test(raw) ? '.is-grid' : ''}`, { text: prettyRaw(raw).slice(0, 4000), tabindex: '0', 'aria-label': 'The model’s answer' }));
    function paintAI() {
      const a = S.ai;
      aiBtn.replaceChildren(icon(a.busy ? 'square' : 'sparkles', a.busy ? { fill: true } : undefined), h('span', { text: a.busy ? 'Stop' : 'Draft' }));
      aiBtn.classList.toggle('btn--primary', !a.busy);
      aiBtn.classList.toggle('is-busy', a.busy);
      aiBtn.setAttribute('aria-label', a.busy ? 'Stop the AI draft' : 'Draft a sprite with AI');
      aiIn.disabled = a.busy;
      clear(aiOut);
      if (a.busy) {
        const msg = {
          queued: ['Waiting for the model…', 'Another AI request in StaticOS goes first (Forge, Studio or Lens). Yours starts right after it.'],
          busy: ['Waiting for the model…', `The free service is busy, so it tries again by itself${a.attempt ? ` (retry ${a.attempt} of 3)` : ''}.`],
          again: ['Asking once more…', `The first answer was not usable (${a.why}), so it gets one more try.`],
          think: ['The model is thinking…', 'It plans first, then writes 16 rows of pixels.'],
          write: ['Writing the grid…', 'Checked as soon as it is finished.'],
        }[a.phase] || [`Asking ${LLM.MODEL_LABEL}…`, 'Free models can take a minute or two. Stop cancels it.'];
        if (a.round > 1 && a.phase !== 'again') msg[0] = msg[0].replace(/…$/, ' (second try)…');
        aiOut.append(h('div.al-ai__wait', { dataset: { phase: a.phase || 'ask' } },
          h('span.al-ai__dots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          h('div.al-ai__wt', h('b', { text: msg[0] }), h('small', { text: msg[1] })),
          aiMeta));
        paintAiMeta();
      } else if (a.error) {
        aiOut.append(h('div.al-ai__err', icon('alert'), h('div.al-ai__et',
          h('b', { text: a.error }),
          h('div.al-ai__acts',
            a.fix === 'size'
              ? h('button.btn.btn--sm', { type: 'button', onclick: () => { resizeDoc(...aiFit()); S.ai = { ...AI_IDLE }; paintAI(); } }, icon('grid'), h('span', { text: `Make it ${aiFit().join('×')}` }))
              : h('button.btn.btn--sm', { type: 'button', onclick: () => aiGo() }, icon('refresh'), h('span', { text: 'Try again' }))),
          a.raw ? rawBox(a.raw) : null)));
      } else if (a.done) {
        aiOut.append(h('div.al-ai__ok', icon('check'), h('div.al-ai__et',
          h('span', { text: a.done }),
          a.raw ? rawBox(a.raw) : null)));
      }
    }

    async function aiGo() {
      if (S.ai.busy) return;
      const prompt = aiIn.value.trim().slice(0, 120);
      if (!prompt) { aiIn.focus(); say('Describe the sprite first, e.g. "a green slime".'); return; }
      if (S.doc.w < AI_SIZE || S.doc.h < AI_SIZE) {
        S.ai = { ...AI_IDLE, fix: 'size', error: `AI drafts are 16×16, and this canvas is ${S.doc.w}×${S.doc.h}. It needs to be at least 16×16 (the art you have stays in the middle).` };
        paintAI();
        return;
      }
      if (S.doc.frames.length >= MAX_FRAMES) { say(`A sprite can have up to ${MAX_FRAMES} frames.`); return; }
      const ac = new AbortController();
      /* the prompt field locks while busy; keep keyboard focus on the
         Stop button instead of letting it fall to the page */
      const hadFocus = aiSec.contains(document.activeElement);
      S.ai = { ...AI_IDLE, busy: true, ac, phase: 'ask', t0: Date.now() };
      paintAI();
      if (hadFocus && !aiSec.contains(document.activeElement)) aiBtn.focus({ preventScroll: true });
      aiClock();
      const mine = () => !S.dead && S.ai.ac === ac;
      const fail = (error, raw = '') => {
        const f = aiSec.contains(document.activeElement);
        S.ai = { ...AI_IDLE, error, raw };
        cancel(aiTick);
        paintAI();
        if (f && !aiSec.contains(document.activeElement)) aiBtn.focus({ preventScroll: true });
      };
      const ask = () => LLM.stream(aiMessages(prompt), {
        signal: ac.signal,
        params: aiParams(),
        onWait: info => { if (mine()) aiPhase(info && info.reason === 'busy' ? 'busy' : 'queued', { attempt: (info && info.attempt) || 0 }); },
        onThink: () => { if (mine() && S.ai.phase !== 'write') aiPhase('think'); },
        onText: t => {
          if (!mine()) return;
          S.ai.chars = t.length;
          if (S.ai.phase !== 'write') aiPhase('write'); else paintAiMeta();
        },
      });
      /* the free model gets the grid wrong now and then; one unusable (or
         empty) answer is followed by one more try, in plain view */
      const ROUNDS = 2;
      let text = '', res = null, empty = false;
      for (let round = 1; round <= ROUNDS; round++) {
        if (round > 1) aiPhase('again', { round, chars: 0, why: empty ? 'it spent its whole answer thinking and sent no grid' : res.error.replace(/\.$/, '') });
        empty = false;
        try {
          text = await ask();
        } catch (err) {
          if (!mine()) return;
          if (err.name === 'AbortError') { fail('Stopped. Nothing was drawn.'); return; }
          if (err.code === 'empty') { empty = true; if (round < ROUNDS) continue; break; }
          if (err.code === 'http') {
            const st = +((String(err.message).match(/HTTP (\d+)/) || [])[1] || 0);
            fail(st >= 500
              ? `The free model's server ${st === 524 || st === 504 ? 'did not answer in time' : 'had a problem'} (HTTP ${st}); it is probably overloaded. Nothing was drawn. Try again in a few minutes.`
              : `${err.message} Nothing was drawn.`);
          } else fail(`${err.message} Nothing was drawn.`);
          return;
        }
        if (!mine()) return;
        res = parseGrid(text, AI_SIZE, { prompt });
        if (res.ok) break;
      }
      if (empty) {
        fail(`The model spent its whole answer thinking and sent no grid${ROUNDS > 1 ? ', twice' : ''}. Nothing was drawn. Try again in a moment, or describe it more simply.`);
        return;
      }
      if (!res.ok) {
        fail(`The model's answer wasn't a usable 16×16 grid${ROUNDS > 1 ? ' (on both tries)' : ''}: ${res.error} Nothing was drawn. Try again, or describe it more simply.`, text);
        return;
      }
      const secondTry = S.ai.round > 1;
      const { w, h: hh } = S.doc;
      const s = Math.max(1, Math.floor(Math.min(w, hh) / AI_SIZE));
      const ox = Math.floor((w - AI_SIZE * s) / 2), oy = Math.floor((hh - AI_SIZE * s) / 2);
      const px = blank(w, hh);
      res.grid.forEach((row, y) => row.forEach((v, x) => {
        if (v < 0) return;
        const c = rgbaOf(PALETTE[v][0]);
        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(px, w, hh, ox + x * s + dx, oy + y * s + dy, c);
      }));
      /* a brand-new sprite (one empty frame) gets the draft in that frame,
         so the animation does not start with a blank; otherwise it is
         added as a new frame after the current one */
      const intoEmpty = S.doc.frames.length === 1 && isBlank(S.doc.frames[0].px);
      change(() => {
        if (intoEmpty) S.doc.frames = [{ id: uid('f'), px }];
        else { S.doc.frames.splice(S.doc.cur + 1, 0, { id: uid('f'), px }); S.doc.cur += 1; }
        if (S.spriteName === 'sprite' && !S.spriteLib) S.spriteName = slug(prompt).slice(0, 24);
      });
      if (S.tab === 'sprite') nameIn.value = S.spriteName;
      cancel(aiTick);
      /* anything that had to be evened out is said, with the answer one
         click away, so a draft is never quietly different from the reply */
      const evened = res.fixes.length
        ? ` The model's grid was a little off (${res.fixes.join('; ')}), so only its transparent edges were evened out.` : '';
      const loose = res.loose ? ' Its answer was not quite valid JSON, so the rows were read one by one.' : '';
      S.ai = {
        ...AI_IDLE,
        done: `Drew “${prompt}” as ${intoEmpty ? 'the first frame' : `a new frame (${S.doc.cur + 1})`}${s > 1 ? `, scaled ${s}×` : ''}${secondTry ? ', on the second try' : ''}.${evened}${loose} It is a rough draft to edit; Ctrl+Z takes it away.`,
        raw: evened || loose ? text : '',
      };
      paintAI();
    }

    const side = h('aside.al-side', colorSec, pvSec, aiSec);
    const stageWrap = h('div.al-stagewrap', stageBar, stage);
    views.sprite.append(rail, stageWrap, frameBar, side);

    /* ---- canvas layout & painting ---- */
    let raf = 0;
    const schedule = () => { if (!raf && !S.dead) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
    const offC = document.createElement('canvas');
    const offX = offC.getContext('2d');
    function off(px) {
      const { w, h: hh } = S.doc;
      if (offC.width !== w || offC.height !== hh) { offC.width = w; offC.height = hh; }
      offX.putImageData(new ImageData(px, w, hh), 0, 0);
      return offC;
    }
    let chkKey = '', chkPat = null;
    function checker(g, size) {
      const key = String(size);
      if (key === chkKey && chkPat) return chkPat;
      const c = document.createElement('canvas');
      c.width = c.height = size * 2;
      const x = c.getContext('2d');
      x.fillStyle = '#2c2a31'; x.fillRect(0, 0, size * 2, size * 2);
      x.fillStyle = '#232128'; x.fillRect(size, 0, size, size); x.fillRect(0, size, size, size);
      chkKey = key;
      chkPat = g.createPattern(c, 'repeat');
      return chkPat;
    }

    function fitZoom() {
      const pad = 36;
      const W = stage.clientWidth - pad, H = stage.clientHeight - pad;
      if (W <= 0 || H <= 0) return S.zoom;
      const z = Math.floor(Math.min(W / S.doc.w, H / S.doc.h));
      return clamp(z, 1, 64);
    }
    function layout() {
      if (S.dead || views.sprite.hidden) return;
      if (S.fit) S.zoom = fitZoom();
      const maxZ = Math.max(1, Math.floor(3072 / Math.max(S.doc.w, S.doc.h)));
      S.zoom = clamp(S.zoom, 1, Math.min(64, maxZ));
      S.dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = S.doc.w * S.zoom, cssH = S.doc.h * S.zoom;
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
      const bw = Math.round(cssW * S.dpr), bh = Math.round(cssH * S.dpr);
      if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; chkKey = ''; }
      zoomLbl.textContent = `${S.zoom}×`;
      fitBtn.classList.toggle('is-on', S.fit);
      fitBtn.setAttribute('aria-pressed', String(S.fit));
      paint();
    }
    function zoomBy(d) {
      const i = ZOOMS.findIndex(z => z >= S.zoom);
      const cur = i < 0 ? ZOOMS.length - 1 : i;
      const next = d > 0 ? ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS[cur] > S.zoom ? cur : cur + 1)] : ZOOMS[Math.max(0, cur - 1)];
      S.fit = false;
      S.zoom = next;
      layout();
    }

    function paint() {
      if (S.dead || views.sprite.hidden) return;
      const { w, h: hh, frames, cur } = S.doc;
      const g = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const cell = W / w;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, W, H);
      g.fillStyle = checker(g, Math.max(Math.round(4 * S.dpr), Math.round(S.zoom >= 8 ? cell / 2 : cell)));
      g.fillRect(0, 0, W, H);
      if (S.onion && frames.length > 1) {
        const pi = (cur - 1 + frames.length) % frames.length, ni = (cur + 1) % frames.length;
        g.globalAlpha = S.onionOp / 100;
        if (S.onionMode !== 'next') g.drawImage(off(frames[pi].px), 0, 0, W, H);
        if (S.onionMode !== 'prev' && !(S.onionMode === 'both' && ni === pi)) g.drawImage(off(frames[ni].px), 0, 0, W, H);
        g.globalAlpha = 1;
      }
      g.drawImage(off(frames[cur].px), 0, 0, W, H);

      if (S.grid && S.zoom >= 4) {
        const ink = major => { g.fillStyle = major ? 'rgba(255,255,255,.17)' : 'rgba(255,255,255,.075)'; };
        for (let x = 1; x < w; x++) { ink(x % 8 === 0); g.fillRect(Math.round(x * cell), 0, 1, H); }
        for (let y = 1; y < hh; y++) { ink(y % 8 === 0); g.fillRect(0, Math.round(y * cell), W, 1); }
      }
      if (S.mirror) {
        const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#ff456d';
        g.save();
        g.strokeStyle = accent;
        g.globalAlpha = 0.8;
        g.lineWidth = Math.max(1, S.dpr);
        g.setLineDash([4 * S.dpr, 4 * S.dpr]);
        g.beginPath();
        g.moveTo(W / 2, 0); g.lineTo(W / 2, H);
        g.stroke();
        g.restore();
      }
      /* the cell under the pointer or keyboard cursor (and its mirror) */
      const c = S.stroke ? null : (S.kbd || S.hover);
      const mark = (x, y, strong) => {
        if (x < 0 || y < 0 || x >= w || y >= hh) return;
        const X = Math.round(x * cell), Y = Math.round(y * cell), s = Math.round(cell);
        if ((S.tool === 'pencil' || S.tool === 'line' || S.tool === 'rect') && cell >= 3) {
          g.fillStyle = S.color; g.globalAlpha = 0.55; g.fillRect(X, Y, s, s); g.globalAlpha = 1;
        }
        const lw = Math.max(1, Math.round(S.dpr * (strong ? 2 : 1)));
        g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = lw + 2;
        g.strokeRect(X + lw / 2, Y + lw / 2, s - lw, s - lw);
        g.strokeStyle = '#fff'; g.lineWidth = lw;
        g.strokeRect(X + lw / 2, Y + lw / 2, s - lw, s - lw);
      };
      if (S.anchor) mark(S.anchor[0], S.anchor[1], true);
      if (c) {
        mark(c[0], c[1], !!S.kbd);
        if (S.mirror && w - 1 - c[0] !== c[0]) mark(w - 1 - c[0], c[1], false);
      }
      drawThumb(frames[cur]);
      if (!pvRaf) drawPreview(cur);
    }

    function refreshSprite() {
      const { w, h: hh } = S.doc;
      const square = w === hh && SIZES.includes(w);
      sizeSel.value = square ? String(w) : 'custom';
      customBox.hidden = square;
      cwIn.value = String(w); chIn.value = String(hh);
      undoBtn.disabled = !S.past.length;
      redoBtn.disabled = !S.future.length;
      paintFrames();
      paintPvCtl();
      syncPreviewLoop();
      paintInfo();
      layout();
    }
    function onSize() {
      if (sizeSel.value === 'custom') { customBox.hidden = false; cwIn.focus(); return; }
      const n = +sizeSel.value;
      resizeDoc(n, n);
    }
    function resizeDoc(w, hh) {
      if (w === S.doc.w && hh === S.doc.h) { refreshSprite(); return; }
      const { w: ow, h: oh } = S.doc;
      /* shrinking keeps the middle; say so when that cut off real pixels */
      const next = S.doc.frames.map(f => ({ id: f.id, px: resizeBuf(f.px, ow, oh, w, hh) }));
      const cropped = next.some((f, i) => countPx(f.px) !== countPx(S.doc.frames[i].px));
      S.fit = true;
      change(() => {
        S.doc.frames = next;
        S.doc.w = w; S.doc.h = hh;
      });
      const art = S.doc.frames.some(f => !isBlank(f.px));
      say(cropped
        ? `Canvas is now ${w}×${hh}. Pixels outside the middle were cut off; Ctrl+Z brings them back.`
        : `Canvas is now ${w}×${hh}${art ? ' (art kept centred)' : ''}.`);
    }
    function newSprite() {
      S.fit = true;
      change(() => {
        S.doc.frames = [{ id: uid('f'), px: blank(S.doc.w, S.doc.h) }];
        S.doc.cur = 0;
        S.spriteLib = null;
        S.spriteName = 'sprite';
        S.fromAsset = null;
      });
      if (S.tab === 'sprite') nameIn.value = S.spriteName;
      say('New sprite. Ctrl+Z brings the last one back.');
    }

    /* ---- drawing ---- */
    const plotM = (px, x, y, c) => {
      const { w, h: hh } = S.doc;
      put(px, w, hh, x, y, c);
      if (S.mirror) put(px, w, hh, w - 1 - x, y, c);
    };
    function shape(st, x, y) {
      st.px.set(st.base);
      if (st.tool === 'line') linePts(st.start[0], st.start[1], x, y, (a, b) => plotM(st.px, a, b, st.c));
      else rectPts(st.start[0], st.start[1], x, y, st.filled, (a, b) => plotM(st.px, a, b, st.c));
    }
    function pickAt(x, y) {
      const { w, h: hh, frames, cur } = S.doc;
      if (x < 0 || y < 0 || x >= w || y >= hh) return;
      const [r, g, b, a] = at(frames[cur].px, w, x, y);
      if (!a) { say('That pixel is transparent — use the eraser to paint transparency.'); return; }
      setColor(hexOf(r, g, b), true);
      say(`Picked ${S.color.toUpperCase()}.`);
    }
    function beginStroke(tool, x, y, { erase = false, filled = false } = {}) {
      const { w, h: hh } = S.doc;
      if (x < 0 || y < 0 || x >= w || y >= hh) return false;
      /* redo survives until the stroke really changes something */
      pushHistory(true);
      const f = S.doc.frames[S.doc.cur];
      const px = f.px.slice();
      S.doc.frames[S.doc.cur] = { id: f.id, px };
      const c = erase || tool === 'eraser' ? CLEAR : rgbaOf(S.color);
      const st = S.stroke = { tool, base: f.px, px, start: [x, y], last: [x, y], c, filled, erase };
      if (tool === 'pencil' || tool === 'eraser') plotM(px, x, y, c);
      else if (tool === 'fill') {
        floodFill(px, w, hh, x, y, c);
        if (S.mirror) floodFill(px, w, hh, w - 1 - x, y, c);
      } else shape(st, x, y);
      schedule();
      return true;
    }
    function moveStroke(x, y) {
      const st = S.stroke;
      if (!st) return;
      const { w, h: hh } = S.doc;
      x = clamp(x, -1, w); y = clamp(y, -1, hh);
      if (st.tool === 'pencil' || st.tool === 'eraser') {
        linePts(st.last[0], st.last[1], x, y, (a, b) => plotM(st.px, a, b, st.c));
      } else if (st.tool === 'line' || st.tool === 'rect') {
        shape(st, clamp(x, 0, w - 1), clamp(y, 0, hh - 1));
      }
      st.last = [x, y];
      schedule();
    }
    function endStroke() {
      const st = S.stroke;
      if (!st) return;
      S.stroke = null;
      if (equalPx(st.px, st.base)) {
        /* nothing changed: no history step, keep the original buffer */
        S.past.pop();
        S.doc.frames[S.doc.cur] = { id: S.doc.frames[S.doc.cur].id, px: st.base };
      } else {
        S.future = [];
        trimHistory();
        if (!st.erase && st.tool !== 'eraser') pushRecent(S.color);
        touch();
      }
      undoBtn.disabled = !S.past.length;
      redoBtn.disabled = !S.future.length;
      schedule();
    }

    function cellAt(e) {
      const r = cv.getBoundingClientRect();
      return [Math.floor(((e.clientX - r.left) / r.width) * S.doc.w), Math.floor(((e.clientY - r.top) / r.height) * S.doc.h)];
    }
    listen(cv, 'contextmenu', e => e.preventDefault());
    listen(cv, 'pointerdown', e => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      cv.focus({ preventScroll: true });
      S.kbd = null;
      const [x, y] = cellAt(e);
      if (S.tool === 'picker' || (e.altKey && S.tool !== 'eraser')) { pickAt(x, y); schedule(); return; }
      const erase = e.button === 2;
      if (beginStroke(S.tool, x, y, { erase, filled: e.shiftKey })) {
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        if (S.tool === 'fill') endStroke();
      }
    });
    listen(cv, 'pointermove', e => {
      const [x, y] = cellAt(e);
      if (S.stroke) { moveStroke(x, y); return; }
      const inside = x >= 0 && y >= 0 && x < S.doc.w && y < S.doc.h;
      const next = inside ? [x, y] : null;
      if (String(next) !== String(S.hover)) { S.hover = next; paintInfo(); schedule(); }
    });
    const up = () => { if (S.stroke) endStroke(); };
    listen(cv, 'pointerup', up);
    listen(cv, 'pointercancel', up);
    listen(cv, 'lostpointercapture', up);
    listen(cv, 'pointerleave', () => { if (!S.stroke && S.hover) { S.hover = null; paintInfo(); schedule(); } });

    /* keyboard drawing: a cell cursor on the canvas */
    /* the keyboard cursor comes back where it was when the canvas gets
       focus again (after picking a colour, say), or starts in the middle */
    const kbdStart = () => (S.kbdLast && S.kbdLast[0] < S.doc.w && S.kbdLast[1] < S.doc.h ? S.kbdLast : [S.doc.w >> 1, S.doc.h >> 1]);
    listen(cv, 'focus', () => { if (!S.kbd && cv.matches(':focus-visible')) { S.kbd = kbdStart(); paintInfo(); schedule(); } });
    listen(cv, 'blur', () => { if (S.kbd) S.kbdLast = S.kbd; S.kbd = null; S.anchor = null; paintInfo(); schedule(); });
    listen(cv, 'keydown', e => {
      const step = e.shiftKey ? 4 : 1;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        const c = S.kbd || kbdStart();
        S.kbd = [clamp(c[0] + mv[0], 0, S.doc.w - 1), clamp(c[1] + mv[1], 0, S.doc.h - 1)];
        paintInfo();
        schedule();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!S.kbd) S.kbd = kbdStart();
        const [x, y] = S.kbd;
        if (S.tool === 'picker') { pickAt(x, y); return; }
        if (S.tool === 'line' || S.tool === 'rect') {
          if (!S.anchor) { S.anchor = [x, y]; say(`Start set at ${x}, ${y}. Move, then press Space again to draw the ${S.tool === 'line' ? 'line' : 'rectangle'}. Esc cancels.`); schedule(); return; }
          const [ax, ay] = S.anchor;
          S.anchor = null;
          if (beginStroke(S.tool, ax, ay, { filled: e.shiftKey })) { moveStroke(x, y); endStroke(); }
          return;
        }
        if (beginStroke(S.tool, x, y, {})) endStroke();
        return;
      }
      if (e.key === 'Escape' && S.anchor) { e.preventDefault(); S.anchor = null; schedule(); }
    });

    /* ---- import ---- */
    const importIn = h('input', {
      type: 'file', accept: 'image/png,image/gif,image/webp,image/jpeg', hidden: true, 'aria-hidden': 'true', tabindex: '-1',
      onchange: async e => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (file) await importImage(file);
      },
    });
    views.sprite.append(importIn);

    /* drop an image on the sprite view, or paste one, to import it */
    const hasImage = dt => [...(dt?.items || [])].some(i => i.kind === 'file' && /^image\//.test(i.type));
    listen(views.sprite, 'dragover', e => { if (!hasImage(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; views.sprite.classList.add('is-drop'); });
    listen(views.sprite, 'dragleave', e => { if (!views.sprite.contains(e.relatedTarget)) views.sprite.classList.remove('is-drop'); });
    listen(views.sprite, 'drop', e => {
      views.sprite.classList.remove('is-drop');
      const f = [...(e.dataTransfer?.files || [])].find(x => /^image\//.test(x.type));
      if (!f) return;
      e.preventDefault();
      importImage(f);
    });
    listen(window, 'paste', e => {
      if (S.dead || S.tab !== 'sprite' || S.sheet || (api.wm?.getActive && api.wm.getActive() !== win) || focusElsewhere()) return;
      const t = document.activeElement;
      if (t && (t.tagName === 'INPUT' && t.type === 'text' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const f = [...(e.clipboardData?.files || [])].find(x => /^image\//.test(x.type));
      if (!f) return;
      e.preventDefault();
      importImage(new File([f], f.name && f.name !== 'image.png' ? f.name : 'pasted.png', { type: f.type }));
    });

    async function importImage(file, { asNew = false, source = null } = {}) {
      let bmp;
      try { bmp = await createImageBitmap(file); }
      catch (err) { say(`“${file.name}” could not be read as an image.`, 'err'); return; }
      if (S.dead) return;
      const iw = bmp.width, ih = bmp.height;
      const read = (sx, sy, sw, sh, dw, dh, smooth) => {
        const c = document.createElement('canvas');
        c.width = dw; c.height = dh;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = smooth;
        g.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
        return new Uint8ClampedArray(g.getImageData(0, 0, dw, dh).data);
      };
      const base = file.name.replace(/\.[^.]+$/, '').replace(/-sheet$/, '');
      let note = '';
      /* a strip of square cells is probably a spritesheet, but a wide
         sprite looks the same, so ask (unless it is too big to be one) */
      const cells = iw % ih === 0 ? iw / ih : 0;
      let split = cells >= 2 && cells <= MAX_FRAMES && ih <= MAX_SIDE && iw > MAX_SIDE;
      if (!split && cells >= 2 && cells <= MAX_FRAMES && ih <= MAX_SIDE) {
        split = await api.confirm({
          title: 'Split into frames?',
          message: `“${file.name}” is ${iw}×${ih}, which looks like a spritesheet of ${cells} frames of ${ih}×${ih}. Split it into frames, or keep it as one ${iw}×${ih} image?`,
          ok: `Split into ${cells} frames`, cancel: 'Keep as one image',
        });
        if (S.dead) { bmp.close?.(); return; }
      }
      if (split) {
        const frames = [];
        for (let i = 0; i < cells; i++) frames.push({ id: uid('f'), px: read(i * ih, 0, ih, ih, ih, ih, false) });
        S.fit = true;
        change(() => { S.doc = { w: ih, h: ih, frames, cur: 0 }; S.spriteName = slug(base).slice(0, 24); S.spriteLib = null; S.fromAsset = source; });
        note = `Split the ${iw}×${ih} sheet into ${cells} frames of ${ih}×${ih}. Ctrl+Z goes back.`;
      } else if (iw <= MAX_SIDE && ih <= MAX_SIDE) {
        const px = read(0, 0, iw, ih, iw, ih, false);
        if (!asNew && iw === S.doc.w && ih === S.doc.h && !(S.doc.frames.length === 1 && isBlank(S.doc.frames[0].px))) {
          if (S.doc.frames.length >= MAX_FRAMES) { say(`A sprite can have up to ${MAX_FRAMES} frames.`); bmp.close?.(); return; }
          change(() => { S.doc.frames.splice(S.doc.cur + 1, 0, { id: uid('f'), px }); S.doc.cur += 1; });
          note = `Imported “${file.name}” as frame ${S.doc.cur + 1}.`;
        } else {
          S.fit = true;
          change(() => { S.doc = { w: iw, h: ih, frames: [{ id: uid('f'), px }], cur: 0 }; S.spriteName = slug(base).slice(0, 24); S.spriteLib = null; S.fromAsset = source; });
          note = `Opened “${file.name}” (${iw}×${ih}). Ctrl+Z goes back.`;
        }
      } else {
        const k = MAX_SIDE / Math.max(iw, ih);
        const nw = Math.max(1, Math.round(iw * k)), nh = Math.max(1, Math.round(ih * k));
        const px = read(0, 0, iw, ih, nw, nh, true);
        S.fit = true;
        change(() => { S.doc = { w: nw, h: nh, frames: [{ id: uid('f'), px }], cur: 0 }; S.spriteName = slug(base).slice(0, 24); S.spriteLib = null; S.fromAsset = source; });
        note = `“${file.name}” is ${iw}×${ih}; Asset Lab edits up to ${MAX_SIDE}×${MAX_SIDE}, so it was scaled down to ${nw}×${nh}.`;
      }
      bmp.close?.();
      if (S.tab === 'sprite') nameIn.value = S.spriteName;
      say(note);
    }

    /* ---- export ---- */
    const spriteFrames = () => S.doc.frames.map(f => f.px);
    async function exportPng(kind, scale, mode = 'horizontal', withJson = false) {
      const { w, h: hh, frames, cur } = S.doc;
      const c = kind === 'sheet' ? sheetCanvas(spriteFrames(), w, hh, scale, mode) : frameCanvas(frames[cur].px, w, hh, scale);
      try {
        const blob = await canvasBlob(c);
        const name = `${slug(S.spriteName)}${kind === 'sheet' ? (mode === 'grid' ? '-grid' : '-sheet') : frames.length > 1 ? `-${cur + 1}` : ''}${scale > 1 ? `@${scale}x` : ''}.png`;
        download(blob, name);
        if (withJson) {
          const L = sheetLayout(frames.length, w, hh, mode, scale);
          const json = { image: name, layout: mode, size: { w: L.width, h: L.height }, frame: { w: w * scale, h: hh * scale },
            columns: L.cols, rows: L.rows, fps: S.fps, frames: L.rects };
          download(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), name.replace(/\.png$/, '.json'));
        }
        say(`Downloaded ${name}${withJson ? ' and its .json' : ''} (${c.width}×${c.height}).`);
        return name;
      } catch (err) { say(err.message, 'err'); return ''; }
    }
    /* an animated GIF of every frame at S.fps, the pixels blown up with no smoothing; clear pixels stay clear */
    async function exportGif(scale) {
      const { w, h: hh } = S.doc;
      try {
        const { encodeGif } = await import('../core/gif.js');
        const frames = spriteFrames().map(px => {
          const c = frameCanvas(px, w, hh, scale);
          return { data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, delay: 1000 / S.fps };
        });
        const bytes = encodeGif({ width: w * scale, height: hh * scale, frames, loop: true, dither: false });
        const name = `${slug(S.spriteName)}${scale > 1 ? `@${scale}x` : ''}.gif`;
        download(new Blob([bytes], { type: 'image/gif' }), name);
        say(`Downloaded ${name} (${w * scale}×${hh * scale}, ${frames.length} frame${frames.length > 1 ? 's' : ''}, ${S.fps} fps).`);
        return name;
      } catch (err) { say(err.message || 'The GIF could not be made.', 'err'); return ''; }
    }
    function exportMenu(btn) {
      const r = btn.getBoundingClientRect();
      const n = S.doc.frames.length;
      api.menu([
        { header: true, label: 'Download PNG' },
        { label: 'This frame', hint: `${S.doc.w}×${S.doc.h}`, icon: 'image', onClick: () => exportPng('frame', 1) },
        { label: 'This frame, 8× bigger', hint: `${S.doc.w * 8}×${S.doc.h * 8}`, icon: 'maximize-2', onClick: () => exportPng('frame', 8) },
        { label: `Spritesheet (${n} frame${n > 1 ? 's' : ''})`, hint: `${S.doc.w * n}×${S.doc.h}`, icon: 'grid', onClick: () => exportPng('sheet', 1) },
        { label: 'Spritesheet, 4× bigger', hint: `${S.doc.w * n * 4}×${S.doc.h * 4}`, icon: 'maximize-2', onClick: () => exportPng('sheet', 4) },
        { header: true, label: 'Sprite sheet + frame data (.json)' },
        { label: 'One row + JSON', hint: `${S.doc.w * n}×${S.doc.h}`, icon: 'grid', onClick: () => exportPng('sheet', 1, 'horizontal', true) },
        { label: 'Grid + JSON', hint: `${sheetLayout(n, S.doc.w, S.doc.h, 'grid').width}×${sheetLayout(n, S.doc.w, S.doc.h, 'grid').height}`, icon: 'grid-9', onClick: () => exportPng('sheet', 1, 'grid', true) },
        { header: true, label: `Animated GIF (${S.fps} fps, loops)` },
        { label: 'GIF', hint: `${S.doc.w}×${S.doc.h}`, icon: 'film', onClick: () => exportGif(1) },
        { label: 'GIF, 8× bigger', hint: `${S.doc.w * 8}×${S.doc.h * 8}`, icon: 'maximize-2', onClick: () => exportGif(8) },
      ], r.left, r.bottom + 6);
    }

    /* =============================== SOUND =============================== */
    const presetBtns = PRESETS.map(p => h('button.al-preset', { type: 'button', dataset: { preset: p.id }, onclick: () => usePreset(p.id) },
      h('span.al-preset__ic', icon(p.icon)), h('span', { text: p.label })));
    const presetsCol = h('div.al-presets',
      h('h3.al-sec__h', { text: 'Presets' }),
      h('div.al-presets__list', { role: 'group', 'aria-label': 'Sound presets' }, presetBtns),
      h('p.al-fine', { text: 'Each click rolls a new variation, like sfxr. Everything is made in your browser.' }));

    const waveCv = h('canvas.al-wave__cv', { 'aria-hidden': 'true' });
    const playhead = h('i.al-wave__head');
    const playBtn = h('button.al-play', { type: 'button', 'aria-label': 'Play sound', title: 'Play (P)', onclick: () => playSound() }, icon('play', { fill: true }));
    const sndTitle = h('b.al-wave__t');
    const sndMeta = h('span.al-wave__m');
    const autoIn = h('input', { type: 'checkbox', checked: S.autoplay, onchange: e => { S.autoplay = e.target.checked; setPref({ autoplay: S.autoplay }); } });
    const waveCard = h('div.al-wave',
      h('div.al-wave__box', waveCv, playhead),
      h('div.al-wave__foot', playBtn, h('div.al-wave__txt', sndTitle, sndMeta), h('span.al-grow'),
        h('label.al-check', autoIn, h('span', { text: 'Play on change' }))));

    const waveBtns = WAVES.map(wv => h('button.al-wv', {
      type: 'button', role: 'radio', dataset: { wave: wv.id }, text: wv.label,
      onclick: () => setSnd({ wave: wv.id }, true),
      onkeydown: e => {
        const i = WAVES.findIndex(x => x.id === S.snd.wave);
        const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % WAVES.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + WAVES.length - 1) % WAVES.length : -1;
        if (j < 0) return;
        e.preventDefault();
        setSnd({ wave: WAVES[j].id }, true);
        waveBtns[j].focus();
      },
    }));
    const knobEls = new Map();
    const toSlider = (k, v) => (k.log ? Math.round((Math.log(v / k.min) / Math.log(k.max / k.min)) * 1000) : v);
    const fromSlider = (k, s) => (k.log ? k.min * Math.pow(k.max / k.min, s / 1000) : s);
    function knob(k) {
      const id = `al-k-${k.k}`;
      const inp = h('input.al-range', {
        id, type: 'range',
        min: String(k.log ? 0 : k.min), max: String(k.log ? 1000 : k.max), step: String(k.log ? 1 : k.step),
        oninput: e => setSnd({ [k.k]: fromSlider(k, +e.target.value) }, false),
        onchange: () => { if (S.autoplay) playSound(); },
      });
      const out = h('output.al-knob__v', { for: id });
      knobEls.set(k.k, { inp, out, k });
      return h('div.al-knob', h('label.al-knob__l', { for: id, text: k.label }), inp, out);
    }
    const groups = ['Pitch', 'Envelope', 'Vibrato', 'Output'];
    const params = h('div.al-params',
      h('div.al-pgroup.al-pgroup--wave',
        h('h3.al-sec__h', { text: 'Wave' }),
        h('div.al-waves', { role: 'radiogroup', 'aria-label': 'Waveform' }, waveBtns)),
      groups.map(g => h('div.al-pgroup', h('h3.al-sec__h', { text: g }), KNOBS.filter(k => k.group === g).map(knob))));
    views.sound.append(presetsCol, h('div.al-sndmain', waveCard, params));

    function paintSnd() {
      const p = S.snd;
      waveBtns.forEach(b => { const on = b.dataset.wave === p.wave; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      for (const { inp, out, k } of knobEls.values()) {
        const v = p[k.k];
        inp.value = String(toSlider(k, v));
        const lo = +inp.min, hi = +inp.max;
        inp.style.setProperty('--p', `${((+inp.value - lo) / (hi - lo)) * 100}%`);
        out.textContent = k.fmt(v);
      }
      const jump = knobEls.get('jumpAt');
      jump.inp.disabled = !p.jump;
      const vs = knobEls.get('vibSpeed');
      vs.inp.disabled = !p.vibDepth;
      sndTitle.textContent = S.sndName || 'sound';
    }
    const rerenderSoon = debounce(() => rerender(), 60);
    function setSnd(patch, playNow) {
      S.snd = normSound({ ...S.snd, ...patch });
      S.buf = null;
      paintSnd();
      touch();
      if (playNow) rerender().then(b => { if (b && S.autoplay) playSound(); });
      else rerenderSoon();
    }
    function usePreset(id) {
      S.snd = makePreset(id);
      /* a default or preset name follows the preset, and a new name means a
         new sound (not the saved one it was called after); a name you typed
         stays, with the library entry it belongs to */
      if (!S.sndName.trim() || /^(sound|coin|jump|hit|explosion|power-up|laser|blip|random)(-\d+)?$/.test(S.sndName)) {
        S.sndLib = null;
        setName('sound', id === 'powerup' ? 'power-up' : id);
      }
      S.buf = null;
      presetBtns.forEach(b => b.classList.toggle('is-on', b.dataset.preset === id));
      paintSnd();
      touch();
      rerender().then(b => { if (b) playSound(); });
    }

    async function rerender() {
      const seq = ++S.renderSeq;
      try {
        const buf = await renderSound(S.snd);
        if (S.dead || seq !== S.renderSeq) return S.buf;
        S.buf = buf;
        drawWave();
        paintInfo();
        sndMeta.textContent = `${fmtS(buf.duration)} · ${WAVES.find(w => w.id === S.snd.wave).label.toLowerCase()} · ${kb(44 + buf.length * 2)} WAV`;
        return buf;
      } catch (err) {
        if (!S.dead) say(`Couldn't render the sound: ${err.message}`, 'err');
        return null;
      }
    }
    function drawWave() {
      if (S.dead || views.sound.hidden) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(1, waveCv.clientWidth), chh = Math.max(1, waveCv.clientHeight);
      const W = Math.round(cw * dpr), H = Math.round(chh * dpr);
      if (waveCv.width !== W || waveCv.height !== H) { waveCv.width = W; waveCv.height = H; }
      const g = waveCv.getContext('2d');
      g.clearRect(0, 0, W, H);
      const mid = H / 2;
      g.fillStyle = 'rgba(255,255,255,.06)';
      for (let i = 1; i < 4; i++) g.fillRect(0, Math.round((H * i) / 4), W, 1);
      const b = S.buf;
      if (!b) return;
      const d = b.getChannelData(0);
      const css = getComputedStyle(root);
      const accent = css.getPropertyValue('--accent').trim() || '#ff456d';
      const soft = css.getPropertyValue('--accent-soft').trim() || accent;
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, soft); grad.addColorStop(0.5, accent); grad.addColorStop(1, soft);
      /* per column: the sample range, and the loudness around it */
      const per = d.length / W;
      const lo = new Float32Array(W), hi = new Float32Array(W), pk = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        let a = 1, z = -1;
        for (let i = Math.floor(x * per), e = Math.max(i + 1, Math.floor((x + 1) * per)); i < e && i < d.length; i++) {
          const s = d[i];
          if (s < a) a = s;
          if (s > z) z = s;
        }
        lo[x] = a; hi[x] = z; pk[x] = Math.max(Math.abs(a), Math.abs(z));
      }
      const amp = mid * 0.92, r = Math.round(6 * dpr);
      g.globalAlpha = 0.2;
      g.fillStyle = accent;
      g.beginPath();
      g.moveTo(0, mid);
      const env = x => { let m = 0; for (let j = Math.max(0, x - r); j <= Math.min(W - 1, x + r); j++) m = Math.max(m, pk[j]); return m; };
      const envs = Array.from({ length: W }, (_, x) => (hi[x] < lo[x] ? 0 : env(x)));
      for (let x = 0; x < W; x++) g.lineTo(x, mid - envs[x] * amp);
      for (let x = W - 1; x >= 0; x--) g.lineTo(x, mid + envs[x] * amp);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = grad;
      for (let x = 0; x < W; x++) {
        if (hi[x] < lo[x]) continue;
        const y0 = mid - hi[x] * amp, y1 = mid - lo[x] * amp;
        g.fillRect(x, y0, Math.max(1, Math.round(dpr)), Math.max(Math.round(dpr), y1 - y0));
      }
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.fillRect(0, Math.round(mid), W, 1);
    }

    let headRaf = 0;
    function stopSound() {
      if (S.player) { try { S.player.src.onended = null; S.player.src.stop(); } catch (err) { /* already ended */ } S.player = null; }
      if (headRaf) cancelAnimationFrame(headRaf);
      headRaf = 0;
      playhead.classList.remove('is-on');
      playBtn.classList.remove('is-playing');
    }
    async function playSound() {
      if (store.get('prefs.muted', false) === true) { say('StaticOS is muted. Unmute to hear it; exporting still works.'); return; }
      if (+store.get('prefs.volume', 62) === 0) say('StaticOS volume is at 0, so this plays silently.');
      const buf = S.buf || await rerender();
      if (!buf || S.dead) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { say('This browser has no Web Audio playback. Export still works.', 'err'); return; }
      stopSound();
      try {
        if (!S.actx) S.actx = new AC();
        if (S.actx.state === 'suspended') await S.actx.resume().catch(() => {});
        if (S.dead) return;
        const src = S.actx.createBufferSource();
        src.buffer = buf;
        const vol = S.actx.createGain();
        vol.gain.value = clamp((store.get('prefs.volume', 62) ?? 62) / 100, 0, 1);
        src.connect(vol).connect(S.actx.destination);
        src.onended = () => { if (S.player && S.player.src === src) stopSound(); };
        src.start();
        S.player = { src, t0: S.actx.currentTime, dur: buf.duration };
        playBtn.classList.add('is-playing');
        if (!reducedMotion()) {
          playhead.classList.add('is-on');
          const tick = () => {
            headRaf = 0;
            if (!S.player || S.dead) return;
            const f = clamp((S.actx.currentTime - S.player.t0) / S.player.dur, 0, 1);
            playhead.style.transform = `translateX(${f * waveCv.clientWidth}px)`;
            if (f < 1) headRaf = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch (err) { say(`Couldn't play: ${err.message}`, 'err'); }
    }
    async function wavBlob() {
      const buf = S.buf || await rerender();
      if (!buf) throw new Error('The sound could not be rendered.');
      return new Blob([encodeWav(buf.getChannelData(0), buf.sampleRate)], { type: 'audio/wav' });
    }
    async function exportWav() {
      try {
        const blob = await wavBlob();
        const name = `${slug(S.sndName)}.wav`;
        download(blob, name);
        say(`Downloaded ${name} (${kb(blob.size)}).`);
        return name;
      } catch (err) { say(err.message, 'err'); return ''; }
    }

    /* ============================== LIBRARY ============================== */
    const filterBtns = [['all', 'All'], ['sprite', 'Sprites'], ['sound', 'Sounds']].map(([id, label]) => h('button', {
      type: 'button', dataset: { f: id }, text: label, onclick: () => { S.libFilter = id; setPref({ libFilter: id }); paintLib(); },
    }));
    const libGrid = h('div.al-libgrid');
    const libHead = h('div.al-libhead', h('h2.al-h2', { text: 'My library' }), h('span.al-grow'), h('div.seg.al-seg', { role: 'group', 'aria-label': 'Show' }, filterBtns));
    const projSel = h('select.al-select.al-projsel', { 'aria-label': 'Game project', onchange: e => { S.projectId = e.target.value; setPref({ projectId: S.projectId }); paintProj(); paintLib(); } });
    const projBody = h('div.al-projbody');
    const studioBtn = h('button.btn.btn--sm.al-studio', { type: 'button', hidden: true, onclick: () => { const p = curProject(); if (p) api.openApp('studio', { project: p.id }); } }, icon('code'), h('span', { text: 'Open in Studio' }));
    const projPane = h('section.al-proj', h('div.al-libhead', h('h2.al-h2', { text: 'Game project' }), h('span.al-grow'), studioBtn), projSel, projBody);
    views.library.append(h('section.al-libmain', libHead, libGrid), projPane);

    async function refreshLib() {
      try { S.lib = await libList(); } catch (err) { S.lib = []; }
      if (S.dead) return;
      libCount.textContent = S.lib.length ? String(S.lib.length) : '';
      paintLib();
      paintInfo();
    }
    async function refreshProjects() {
      try { S.projects = await Projects.list(); } catch (err) { S.projects = []; }
      if (S.dead) return;
      if (!S.projects.some(p => p.id === S.projectId)) S.projectId = S.projects[0]?.id || '';
      clear(projSel);
      S.projects.forEach(p => projSel.append(h('option', { value: p.id, text: `${p.name} · ${(p.assets || []).length} asset${(p.assets || []).length === 1 ? '' : 's'}` })));
      projSel.value = S.projectId;
      projSel.hidden = !S.projects.length;
      if (S.forProject && !S.projects.some(p => p.id === S.forProject)) S.forProject = null;
      paintFor();
      paintProj();
      if (!views.library.hidden) paintLib();
      if (S.sheet) S.sheet.paintProjects();
    }
    const curProject = () => S.projects.find(p => p.id === S.projectId) || null;

    function libThumb(item) {
      if (item.kind === 'sprite' && item.sprite?.frames?.[0]) {
        const { w, h: hh, frames } = item.sprite;
        const c = frameCanvas(frames[0], w, hh);
        c.className = 'al-card__cv';
        const k = Math.min(96 / w, 72 / hh);
        const s = k >= 1 ? Math.floor(k) : k;
        c.style.width = Math.max(1, Math.round(w * s)) + 'px';
        c.style.height = Math.max(1, Math.round(hh * s)) + 'px';
        return h('div.al-card__art.al-checker', c);
      }
      const peaks = Array.isArray(item.peaks) ? item.peaks : [];
      const c = h('canvas.al-card__wave', { width: '192', height: '72', 'aria-hidden': 'true' });
      const g = c.getContext('2d');
      const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#ff456d';
      g.fillStyle = accent;
      const bw = 192 / Math.max(1, peaks.length);
      peaks.forEach((p, i) => { const hh = Math.max(2, p * 64); g.fillRect(i * bw + 1, 36 - hh / 2, Math.max(1, bw - 2), hh); });
      return h('div.al-card__art.al-card__art--snd', c,
        h('button.al-card__play', { type: 'button', 'aria-label': `Play ${item.name}`, title: 'Play', onclick: () => playUrl(item.wav) }, icon('play', { fill: true })));
    }
    function playUrl(url) {
      if (!/^data:audio\//.test(String(url || ''))) return;
      if (store.get('prefs.muted', false) === true) { say('StaticOS is muted. Unmute to hear it.'); return; }
      try { S.audioEl?.pause(); } catch (err) { /* nothing playing */ }
      const a = new Audio(url);
      a.volume = clamp((store.get('prefs.volume', 62) ?? 62) / 100, 0, 1);
      S.audioEl = a;
      a.play().catch(() => say('The browser refused to play it.', 'err'));
    }
    function paintLib() {
      filterBtns.forEach(b => b.classList.toggle('is-on', b.dataset.f === S.libFilter));
      clear(libGrid);
      const items = S.lib.filter(i => S.libFilter === 'all' || i.kind === S.libFilter);
      if (!items.length) {
        libGrid.append(h('div.al-empty',
          h('span.al-empty__ic', icon(S.libFilter === 'sound' ? 'volume' : 'image')),
          h('b', { text: S.lib.length ? 'Nothing of this kind yet' : 'Your library is empty' }),
          h('small', { text: 'Press Save in the Sprite or Sound tab to keep something here. It stays in this browser and you can reopen and edit it any time.' })));
        return;
      }
      const proj = curProject();
      items.forEach(item => {
        const meta = item.kind === 'sprite'
          ? `${item.sprite.w}×${item.sprite.h}${item.sprite.frames.length > 1 ? ` · ${item.sprite.frames.length} frames` : ''}`
          : `${fmtS(item.dur || item.sound?.dur || 0)} · ${item.sound?.wave || 'sound'}`;
        libGrid.append(h('article.al-card', { dataset: { id: item.id } },
          libThumb(item),
          h('div.al-card__body',
            h('div.al-card__name', { text: item.name, title: item.name }),
            h('div.al-card__meta', icon(item.kind === 'sprite' ? 'image' : 'volume'), h('span', { text: meta }))),
          h('div.al-card__acts',
            h('button.btn.btn--sm', { type: 'button', onclick: () => openItem(item), 'aria-label': `Open ${item.name}` }, icon('edit-3'), h('span', { text: 'Open' })),
            h('button.al-ib', {
              type: 'button', disabled: !proj, onclick: () => addItemToProject(item),
              title: proj ? `Add to “${proj.name}”` : 'No game project to add to', 'aria-label': proj ? `Add ${item.name} to ${proj.name}` : 'No game project to add to',
            }, icon('send')),
            h('button.al-ib', { type: 'button', title: 'Download', 'aria-label': `Download ${item.name}`, onclick: () => downloadItem(item) }, icon('download')),
            h('button.al-ib.al-ib--danger', { type: 'button', title: 'Delete', 'aria-label': `Delete ${item.name}`, onclick: () => deleteItem(item) }, icon('trash')))));
      });
    }
    function itemAsset(item) {
      if (item.kind === 'sprite') {
        const sheet = item.sprite.frames.length > 1;
        return { name: `${slug(item.name)}${sheet ? '-sheet' : ''}.png`, kind: 'image', dataUrl: item.png };
      }
      return { name: `${slug(item.name)}.wav`, kind: 'audio', dataUrl: item.wav };
    }
    /* a name the project does not use yet (hero.png, hero-2.png, …).
       Adding never replaces: Studio points at assets by id, so a
       replaced asset would silently break the game. */
    async function freeName(pid, name) {
      const p = await Projects.get(pid);
      const taken = new Set((p?.assets || []).map(a => String(a.name).toLowerCase()));
      if (!taken.has(name.toLowerCase())) return name;
      const m = name.match(/^(.*?)(\.[a-z0-9]+)?$/i);
      for (let i = 2; i < 1000; i++) {
        const n = `${m[1]}-${i}${m[2] || ''}`;
        if (!taken.has(n.toLowerCase())) return n;
      }
      return name;
    }
    /** Add one asset to a project under a free name. Resolves to
        { asset, renamed } or throws with a readable message. */
    async function addToProject(pid, asset) {
      const name = await freeName(pid, asset.name);
      const a = await Projects.addAsset(pid, { ...asset, name });
      if (!a) throw new Error('That project no longer exists.');
      return { asset: a, renamed: name !== asset.name ? asset.name : '' };
    }

    /* ---- Send to Studio: the frame you are on, into a game's assets ---- */
    let sending = false;
    async function sendMenu(btn) {
      await refreshProjects();
      if (S.dead || !btn.isConnected) return;
      const r = btn.getBoundingClientRect();
      const last = (store.get('portal.studio', null) || {}).last;
      /* the game Asset Lab was opened for, then the one open in Studio, then newest first */
      const first = [S.forProject, last].filter(Boolean);
      const seen = new Set();
      const ordered = [...first.map(id => S.projects.find(p => p.id === id)), ...S.projects]
        .filter(p => p && !seen.has(p.id) && seen.add(p.id));
      const n = S.doc.frames.length;
      const items = [{ header: true, label: n > 1 ? `Send frame ${S.doc.cur + 1} of ${n} to Static Studio` : 'Send this sprite to Static Studio' }];
      for (const p of ordered.slice(0, 8)) {
        const k = (p.assets || []).length;
        items.push({
          label: p.name, icon: 'gamepad',
          hint: p.id === S.forProject ? 'making assets for it' : p.id === last ? 'last open in Studio' : `${k} asset${k === 1 ? '' : 's'}`,
          onClick: () => sendToStudio(p.id),
        });
      }
      if (ordered.length > 8) items.push({ label: 'Another project…', icon: 'more-horizontal', onClick: () => openSheet('sprite', btn) });
      if (ordered.length) items.push('-');
      items.push({ label: 'New Studio game with this sprite', icon: 'plus', onClick: () => sendToStudio(null) });
      api.menu(items, r.left, r.bottom + 6);
    }
    async function sendToStudio(pid) {
      if (sending) return;
      sending = true;
      try {
        if (!pid) {
          const t = studioTemplate('blank');
          const scene = t.scene();
          const p = await Projects.create({ name: scene.title, html: buildDoc(scene), source: 'studio', note: `Started from the ${t.name} template`, by: 'you' });
          pid = p.id;
        }
        const { asset: a, renamed } = await addToProject(pid, { name: `${slug(S.spriteName)}.png`, kind: 'image', dataUrl: await spriteDataUrl('frame') });
        const p = await Projects.get(pid);
        if (S.dead) return;
        S.projectId = pid;
        setPref({ projectId: pid });
        say(`Sent ${a.name} to “${p ? p.name : 'the game'}”${renamed ? ` (it already had a ${renamed})` : ''}. It is in Studio’s Assets list.`);
        api.openApp('studio', { project: pid });
      } catch (err) { say(`Couldn't send it: ${err.message}`, 'err'); }
      finally { sending = false; }
    }
    async function addItemToProject(item) {
      const proj = curProject();
      if (!proj) return;
      try {
        const { asset: a, renamed } = await addToProject(proj.id, itemAsset(item));
        say(`Added ${a.name} to “${proj.name}”${renamed ? ` (it already had a ${renamed})` : ''}.`);
      } catch (err) { say(`Couldn't add it: ${err.message}`, 'err'); }
    }
    async function downloadItem(item) {
      const a = itemAsset(item);
      try {
        const blob = await (await fetch(a.dataUrl)).blob();
        download(blob, a.name);
        say(`Downloaded ${a.name}.`);
      } catch (err) { say(`Couldn't download it: ${err.message}`, 'err'); }
    }
    async function deleteItem(item) {
      const ok = await api.confirm({ title: `Delete “${item.name}”?`, message: 'It is removed from your library in this browser. Copies already added to a game project stay there.', ok: 'Delete', danger: true });
      if (!ok || S.dead) return;
      await LIB.del(LIBKEY + item.id).catch(() => {});
      api.bus.emit('assets:change', { kind: 'delete', id: item.id });
      if (S.spriteLib === item.id) S.spriteLib = null;
      if (S.sndLib === item.id) S.sndLib = null;
      say(`Deleted “${item.name}”.`);
      refreshLib();
    }
    function openItem(item) {
      if (item.kind === 'sprite') {
        const { w, h: hh, frames, fps } = item.sprite;
        S.fit = true;
        change(() => {
          S.doc = { w, h: hh, frames: frames.map(px => ({ id: uid('f'), px: new Uint8ClampedArray(px) })), cur: 0 };
          S.spriteName = item.name; S.spriteLib = item.id; S.fromAsset = null;
        });
        if (fps) { S.fps = clamp(fps, 1, 24); fpsIn.value = String(S.fps); paintPvCtl(); }
        setTab('sprite');
        say(`Opened “${item.name}”. Ctrl+Z goes back to what you had.`);
      } else {
        S.snd = normSound(item.sound);
        S.sndName = item.name; S.sndLib = item.id;
        S.buf = null;
        presetBtns.forEach(b => b.classList.remove('is-on'));
        paintSnd();
        touch();
        setTab('sound');
        say(`Opened “${item.name}”.`);
      }
    }

    /* buttons to the apps that make game projects, when they exist */
    function makerBtns(before) {
      const out = [];
      if (api.getApp('forge')) out.push(h('button.btn.btn--sm', { type: 'button', onclick: () => { before?.(); api.openApp('forge'); } }, icon('sparkles'), h('span', { text: 'Static Forge' })));
      if (api.getApp('studio')) out.push(h('button.btn.btn--sm', { type: 'button', onclick: () => { before?.(); api.openApp('studio'); } }, icon('code'), h('span', { text: 'Static Studio' })));
      return out.length ? h('div.al-makers', out) : null;
    }
    const NO_PROJECTS = 'Game projects are made in Static Forge (describe a game) or Static Studio (build one). Make one there and it shows up here, ready for your sprites and sounds. Until then you can download PNG and WAV files.';
    function paintProj() {
      clear(projBody);
      studioBtn.hidden = !S.projects.length || !api.getApp('studio');
      if (!S.projects.length) {
        projBody.append(h('div.al-empty.al-empty--proj',
          h('span.al-empty__ic', icon('gamepad')),
          h('b', { text: 'No game projects yet' }),
          h('small', { text: NO_PROJECTS }),
          makerBtns()));
        return;
      }
      const p = curProject();
      const assets = p?.assets || [];
      if (!assets.length) {
        projBody.append(h('p.al-fine.al-proj__none', { text: `“${p.name}” has no assets yet. Use the send button on a library card, or Save in the Sprite or Sound tab.` }));
        return;
      }
      projBody.append(h('div.al-pa-list', assets.map(a => {
        const isImg = a.kind === 'image' && /^data:image\//.test(String(a.dataUrl || ''));
        const isAud = a.kind === 'audio' && /^data:audio\//.test(String(a.dataUrl || ''));
        const art = isImg
          ? h('span.al-pa__art.al-checker', h('img', { src: a.dataUrl, alt: '', draggable: 'false', onload: e => { dim.textContent = `${e.target.naturalWidth}×${e.target.naturalHeight} · `; } }))
          : h('button.al-pa__art.al-pa__art--snd', { type: 'button', disabled: !isAud, 'aria-label': `Play ${a.name}`, title: 'Play', onclick: () => playUrl(a.dataUrl) }, icon(isAud ? 'play' : 'file', { fill: isAud }));
        const dim = h('span');
        return h('div.al-pa',
          art,
          h('div.al-pa__t', h('b', { text: a.name, title: a.name }), h('small', dim, h('span', { text: `${a.kind === 'audio' ? 'sound · ' : ''}${kb(dataBytes(a.dataUrl || ''))}` }))),
          h('button.al-ib.al-ib--danger', { type: 'button', title: 'Remove from project', 'aria-label': `Remove ${a.name} from ${p.name}`, onclick: () => removeAsset(p, a) }, icon('trash')));
      })));
    }
    async function removeAsset(p, a) {
      const ok = await api.confirm({ title: `Remove ${a.name}?`, message: `It is taken out of “${p.name}”. Anything in the game that uses it will stop finding it. Your library copy, if any, stays.`, ok: 'Remove', danger: true });
      if (!ok || S.dead) return;
      try { await Projects.removeAsset(p.id, a.id); say(`Removed ${a.name} from “${p.name}”.`); }
      catch (err) { say(`Couldn't remove it: ${err.message}`, 'err'); }
    }
    offs.push(bus.on('projects:change', () => { if (!S.dead) refreshProjects(); }));

    /* ============================== SAVE SHEET ============================== */
    async function spriteDataUrl(mode) {
      const { w, h: hh, frames, cur } = S.doc;
      const c = mode === 'sheet' ? sheetCanvas(spriteFrames(), w, hh) : frameCanvas(frames[cur].px, w, hh);
      return blobDataUrl(await canvasBlob(c));
    }
    async function saveToLibrary(kind, asCopy) {
      const now = Date.now();
      if (kind === 'sprite') {
        const id = (!asCopy && S.spriteLib) || uid('s');
        const prev = S.lib.find(i => i.id === id);
        const frames = S.doc.frames.map(f => f.px.slice());
        const png = await spriteDataUrl('sheet');
        const name = (S.spriteName || 'sprite').trim().slice(0, 40) || 'sprite';
        await LIB.set(LIBKEY + id, { app: 'assetlab', id, kind: 'sprite', name, createdAt: prev?.createdAt || now, updatedAt: now, sprite: { w: S.doc.w, h: S.doc.h, frames, fps: S.fps }, png });
        /* tell the rest of the OS — Static Downloads lists saved assets and
           had no way to know one had appeared (drafts stay silent) */
        api.bus.emit('assets:change', { kind: 'save', id, type: 'sprite' });
        S.spriteLib = id;
        touch();
        return name;
      }
      const buf = S.buf || await rerender();
      if (!buf) throw new Error('The sound could not be rendered.');
      const id = (!asCopy && S.sndLib) || uid('a');
      const prev = S.lib.find(i => i.id === id);
      const wav = await blobDataUrl(new Blob([encodeWav(buf.getChannelData(0), buf.sampleRate)], { type: 'audio/wav' }));
      const name = (S.sndName || 'sound').trim().slice(0, 40) || 'sound';
      await LIB.set(LIBKEY + id, { app: 'assetlab', id, kind: 'sound', name, createdAt: prev?.createdAt || now, updatedAt: now, sound: { ...S.snd }, wav, peaks: peaksOf(buf.getChannelData(0), 48), dur: buf.duration });
      api.bus.emit('assets:change', { kind: 'save', id, type: 'sound' });
      S.sndLib = id;
      touch();
      return name;
    }

    function openSheet(kind, opener) {
      closeSheet();
      const isSprite = kind === 'sprite';
      const n = S.doc.frames.length;
      let mode = isSprite && n > 1 ? 'sheet' : 'frame';
      const sName = h('input.al-in#al-sheet-name', {
        type: 'text', maxlength: '40', value: isSprite ? S.spriteName : S.sndName, spellcheck: 'false',
        oninput: e => setName(kind, e.target.value),
      });
      /* each section answers right under its own buttons, so the result
         is where the eye already is (also on a phone, where the sheet
         scrolls) */
      const mkMsg = () => h('div.al-sheet__msg', { role: 'status', 'aria-live': 'polite' });
      const libMsg = mkMsg(), projMsg = mkMsg(), dlMsg = mkMsg();
      const note = (el, t, bad, extra) => {
        clear(el);
        el.dataset.kind = bad ? 'err' : 'ok';
        if (t) el.append(icon(bad ? 'alert' : 'check'), h('span', { text: t }), extra || null);
      };
      const busy = async (btn, el, fn) => {
        if (btn.disabled) return;
        btn.disabled = true;
        try { await fn(); } catch (err) { note(el, err.message || String(err), true); }
        finally {
          btn.disabled = false;
          /* a disabled button drops focus to <body>; give it back (to the
             same control, even if its row was rebuilt meanwhile) */
          if (S.sheet && S.sheet.wrap === wrap && !card.contains(document.activeElement)) {
            (btn.isConnected ? btn : card.querySelector(`[data-k="${btn.dataset.k}"]`))?.focus({ preventScroll: true });
          }
        }
      };
      const modeBtns = ['sheet', 'frame'].map(m => h('button', {
        type: 'button', role: 'radio', dataset: { m }, class: m === mode ? 'is-on' : null, 'aria-checked': String(m === mode), tabindex: m === mode ? '0' : '-1',
        text: m === 'sheet' ? `Spritesheet · ${n} frames (${S.doc.w * n}×${S.doc.h})` : `Frame ${S.doc.cur + 1} only (${S.doc.w}×${S.doc.h})`,
        onclick: () => setMode(m),
        onkeydown: e => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          setMode(mode === 'sheet' ? 'frame' : 'sheet');
          modeBtns.find(b => b.dataset.m === mode).focus();
        },
      }));
      function setMode(m) {
        mode = m;
        modeBtns.forEach(b => { const on = b.dataset.m === m; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      }
      const modeRow = isSprite && n > 1 ? h('div.al-sheet__row', h('span.al-sheet__lbl', { id: 'al-sheet-mode', text: 'Image' }),
        h('div.seg.al-seg', { role: 'radiogroup', 'aria-labelledby': 'al-sheet-mode' }, modeBtns)) : null;

      /* the library button says what it will do: save a new entry, or
         update the one this came from (with "Save as a copy" beside it) */
      const libBtn = h('button.btn.btn--primary', { type: 'button', dataset: { k: 'lib' } });
      const copyBtn = h('button.btn', { type: 'button', dataset: { k: 'copy' } }, icon('copy'), h('span', { text: 'Save as a copy' }));
      const libEntry = () => (isSprite ? S.spriteLib : S.sndLib);
      const paintLibBtns = () => {
        libBtn.replaceChildren(icon('save'), h('span', { text: libEntry() ? 'Update in library' : 'Save to library' }));
        copyBtn.hidden = !libEntry();
      };
      paintLibBtns();
      libBtn.onclick = () => busy(libBtn, libMsg, async () => {
        const updating = !!libEntry() && S.lib.some(i => i.id === libEntry());
        const nm = await saveToLibrary(kind, false);
        note(libMsg, updating ? `Updated “${nm}” in your library.` : `Saved “${nm}” to your library.`);
        paintLibBtns();
        refreshLib();
      });
      copyBtn.onclick = () => busy(copyBtn, libMsg, async () => {
        const nm = await saveToLibrary(kind, true);
        note(libMsg, `Saved “${nm}” as a new copy. Updates now go to the copy.`);
        paintLibBtns();
        refreshLib();
      });

      const projWrap = h('div.al-sheet__proj');
      let projKey = null;
      /* rebuilt only when the list of projects changes: every add fires
         'projects:change', and a rebuild then would drop keyboard focus */
      function paintProjects() {
        const key = S.projects.map(p => `${p.id}\u0001${p.name}`).join('\u0002');
        if (key === projKey) {
          const sel = projWrap.querySelector('select');
          if (sel && S.projects.some(p => p.id === S.projectId)) sel.value = S.projectId;
          paintSource();
          return;
        }
        projKey = key;
        const focusK = projWrap.contains(document.activeElement) ? document.activeElement.dataset.k : '';
        clear(projWrap);
        if (!S.projects.length) {
          projWrap.append(h('p.al-fine.al-sheet__none', { text: 'You have no game projects yet. ' + NO_PROJECTS.replace(' Until then you can download PNG and WAV files.', ' You can download the file below instead.') }),
            makerBtns(() => closeSheet()));
          return;
        }
        const sel = h('select.al-select', {
          'aria-label': 'Project to add to', dataset: { k: 'proj' },
          onchange: e => { S.projectId = e.target.value; setPref({ projectId: S.projectId }); paintProj(); paintSource(); },
        }, S.projects.map(p => h('option', { value: p.id, text: p.name })));
        sel.value = S.projects.some(p => p.id === S.projectId) ? S.projectId : S.projects[0].id;
        const addBtn = h('button.btn', { type: 'button', dataset: { k: 'add' } }, icon('send'), h('span', { text: 'Add to project' }));
        addBtn.onclick = () => busy(addBtn, projMsg, async () => {
          const pid = sel.value;
          const p = S.projects.find(x => x.id === pid);
          const base = slug(isSprite ? S.spriteName : S.sndName);
          const asset = isSprite
            ? { name: `${base}${mode === 'sheet' ? '-sheet' : ''}.png`, kind: 'image', dataUrl: await spriteDataUrl(mode) }
            : { name: `${base}.wav`, kind: 'audio', dataUrl: await blobDataUrl(await wavBlob()) };
          const { asset: a, renamed } = await addToProject(pid, asset);
          const open = api.getApp('studio')
            ? h('button.al-link', { type: 'button', onclick: () => { closeSheet(); api.openApp('studio', { project: pid }); } }, h('span', { text: 'Open in Static Studio' }), icon('arrow-right'))
            : null;
          note(projMsg, `Added ${a.name} to “${p ? p.name : 'the project'}”${renamed ? ` (it already had a ${renamed})` : ''}.`, false, open);
        });
        projWrap.append(h('div.al-sheet__line', sel, addBtn), srcNote, projMsg);
        paintSource();
        if (focusK) projWrap.querySelector(`[data-k="${focusK}"]`)?.focus({ preventScroll: true });
      }
      /* opened from one of a game's images ("Edit in Asset Lab"): adding
         can only add a new asset next to it, so say that plainly */
      const srcNote = h('p.al-fine.al-sheet__src');
      function paintSource() {
        const src = isSprite ? S.fromAsset : null;
        const sel = projWrap.querySelector('select');
        const p = src && sel && sel.value === src.project ? S.projects.find(x => x.id === src.project) : null;
        srcNote.hidden = !p;
        if (p) srcNote.textContent = `This came from ${src.name} in “${p.name}”. Asset Lab cannot overwrite a game’s file, so adding saves a new asset beside it; switch the game to it in Static Studio.`;
      }
      paintProjects();

      const dlBtn = h('button.btn', { type: 'button', dataset: { k: 'dl' } }, icon('download'), h('span', { text: isSprite ? 'Download PNG' : 'Download WAV' }));
      dlBtn.onclick = () => busy(dlBtn, dlMsg, async () => {
        const nm = isSprite ? await exportPng(mode, 1) : await exportWav();
        if (nm) note(dlMsg, `Downloaded ${nm}.`);
      });

      const closeBtn = h('button.al-ib', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => closeSheet() }, icon('x'));
      const card = h('div.al-sheet__card', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'al-sheet-title' },
        h('div.al-sheet__head', h('span.al-sheet__ic', icon(isSprite ? 'image' : 'volume')), h('h2#al-sheet-title', { text: isSprite ? 'Save sprite' : 'Save sound' }), h('span.al-grow'), closeBtn),
        h('div.al-sheet__row', h('label.al-sheet__lbl', { for: 'al-sheet-name', text: 'Name' }), sName),
        modeRow,
        h('div.al-sheet__sec',
          h('div.al-sheet__st', h('b', { text: 'My library' }), h('small', { text: 'Kept in this browser. Reopen and edit it any time.' })),
          h('div.al-sheet__line', libBtn, copyBtn), libMsg),
        h('div.al-sheet__sec',
          h('div.al-sheet__st', h('b', { text: 'Game project' }), h('small', { text: isSprite ? 'Adds the PNG to the project’s assets, ready to use in Static Studio.' : 'Adds the WAV to the project’s assets, ready to use in Static Studio.' })),
          projWrap),
        h('div.al-sheet__sec',
          h('div.al-sheet__st', h('b', { text: 'Download' }), h('small', { text: isSprite ? 'A PNG file on this computer.' : '16-bit PCM WAV, 44.1 kHz mono.' })),
          h('div.al-sheet__line', dlBtn), dlMsg));
      const wrap = h('div.al-sheet', { onpointerdown: e => { if (e.target === wrap) closeSheet(); } }, card);
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
        if (e.key !== 'Tab') return;
        const f = [...card.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary')].filter(x => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      };
      wrap.addEventListener('keydown', onKey);
      al.appendChild(wrap);
      S.sheet = { wrap, opener, paintProjects };
      sName.focus();
      sName.select();
      refreshProjects();
    }
    function closeSheet() {
      const s = S.sheet;
      if (!s) return;
      S.sheet = null;
      s.wrap.remove();
      if (s.opener && s.opener.isConnected) s.opener.focus({ preventScroll: true });
    }

    /* ============================== KEYS ============================== */
    listen(window, 'keydown', e => {
      if (S.dead || e.defaultPrevented) return;
      const active = api.wm && api.wm.getActive ? api.wm.getActive() : null;
      if (active !== win || focusElsewhere()) return;
      if (S.sheet) {
        if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
        return;
      }
      const t = document.activeElement;
      const typing = t && (t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT'
        || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button'].includes(t.type)));
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (S.tab === 'sprite') {
        if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (mod && k === 'y') { e.preventDefault(); redo(); return; }
        if (mod || e.altKey) return;
        const tool = TOOLS.find(x => x.key.toLowerCase() === k);
        if (tool) { e.preventDefault(); setTool(tool.id); return; }
        if (k === 'm') { e.preventDefault(); setMirror(!S.mirror); return; }
        if (k === 'o') { e.preventDefault(); setOnion(!S.onion); return; }
        if (k === ',') { e.preventDefault(); selectFrame(S.doc.cur - 1); return; }
        if (k === '.') { e.preventDefault(); selectFrame(S.doc.cur + 1); return; }
        if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1); return; }
        if (k === '-' || k === '_') { e.preventDefault(); zoomBy(-1); return; }
        if (k === '0') { e.preventDefault(); S.fit = true; layout(); }
      } else if (S.tab === 'sound' && !mod && !e.altKey && k === 'p') {
        e.preventDefault();
        playSound();
      }
    });

    /* ============================== OPTIONS ============================== */
    /* { project } (Studio's "Open Asset Lab"): Save offers that game
       first. { tab }: 'sprite' | 'sound' | 'library'. Also on reopen. */
    function paintFor() {
      const p = S.forProject && S.projects.find(x => x.id === S.forProject);
      forChip.hidden = !p;
      if (!p) return;
      forChip.replaceChildren(icon('gamepad'), h('span.al-for__pre', { text: 'Making assets for' }), h('span.al-for__t', { text: p.name }));
      forChip.title = `Making assets for “${p.name}”. Save adds them to its assets.`;
      forChip.setAttribute('aria-label', `Making assets for ${p.name}. Open the save options.`);
    }
    /* { edit: { project, asset } }: open one of a game's images in the
       sprite editor (a strip of square frames can be split again) */
    async function editProjectAsset(pid, aid) {
      let a = null;
      try { a = (await Projects.get(pid))?.assets?.find(x => x.id === aid) || null; } catch (err) { a = null; }
      if (S.dead) return;
      if (!a) { say('That asset was not found in the project; it may have been removed.', 'err'); return; }
      if (a.kind !== 'image' || !/^data:image\//.test(String(a.dataUrl || ''))) {
        say(`${a.name} is a sound file. Asset Lab can reopen sounds it made (they keep their settings in your library), not other audio.`, 'err');
        return;
      }
      setTab('sprite');
      try {
        const blob = await (await fetch(a.dataUrl)).blob();
        if (S.dead) return;
        await importImage(new File([blob], a.name, { type: blob.type || 'image/png' }), { asNew: true, source: { project: pid, asset: a.id, name: a.name } });
      } catch (err) { say(`Couldn't open ${a.name}: ${err.message}`, 'err'); }
    }
    function applyOpts(o) {
      if (!o || typeof o !== 'object') return;
      if (TABS.some(t => t.id === o.tab)) setTab(o.tab);
      if (typeof o.prompt === 'string' && o.prompt.trim()) {
        setTab('sprite');
        if (!S.ai.busy) { aiIn.value = o.prompt.trim().slice(0, 120); aiIn.focus({ preventScroll: false }); }
      }
      const ed = o.edit && typeof o.edit === 'object' && typeof o.edit.project === 'string' && typeof o.edit.asset === 'string' ? o.edit : null;
      if (ed) {
        editProjectAsset(ed.project, ed.asset);
        if (typeof o.project !== 'string') o = { ...o, project: ed.project };
      }
      if (typeof o.project === 'string' && o.project) {
        const want = o.project;
        S.projectId = want;
        setPref({ projectId: want });
        refreshProjects().then(() => {
          if (S.dead) return;
          const p = S.projects.find(x => x.id === want);
          S.forProject = p ? p.id : null;
          paintFor();
          /* when editing one of its assets, that step reports instead */
          if (!p) say('That game project was not found; it may have been deleted.', 'err');
          else if (!ed) say(`Making assets for “${p.name}”. Save adds sprites and sounds to it.`);
        });
      }
    }
    win.onReopen?.(o => { if (!S.dead) applyOpts(o); });

    /* ============================== START ============================== */
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (S.dead) return;
      if (!views.sprite.hidden && S.fit) layout();
      if (!views.sound.hidden) drawWave();
    }) : null;
    ro?.observe(stage);
    ro?.observe(waveCv);
    offs.push(() => ro?.disconnect());

    setTool(S.tool);
    setMirror(S.mirror);
    paintToggles();
    paintColor();
    paintRecent();
    paintAI();
    paintSnd();
    refreshSprite();
    setTab(S.tab);
    refreshLib();
    if (ctx.opts && (typeof ctx.opts.project === 'string' || ctx.opts.edit)) applyOpts(ctx.opts);
    else { refreshProjects(); applyOpts(ctx.opts); }

    /* bring back the autosaved draft, unless work already started */
    LIB.get(DRAFT).then(d => {
      if (!d || S.dead || S.touched) return;
      const sp = d.sprite;
      if (sp && sp.w >= 1 && sp.h >= 1 && sp.w <= MAX_SIDE && sp.h <= MAX_SIDE && Array.isArray(sp.frames) && sp.frames.length
        && sp.frames.every(px => px && px.length === sp.w * sp.h * 4)) {
        S.doc = { w: sp.w, h: sp.h, frames: sp.frames.slice(0, MAX_FRAMES).map(px => ({ id: uid('f'), px: new Uint8ClampedArray(px) })), cur: clamp(sp.cur | 0, 0, Math.min(sp.frames.length, MAX_FRAMES) - 1) };
        S.spriteName = String(sp.name || 'sprite').slice(0, 40);
        S.spriteLib = typeof sp.lib === 'string' ? sp.lib : null;
        S.fromAsset = sp.src && typeof sp.src.project === 'string' && typeof sp.src.name === 'string' ? { project: sp.src.project, asset: String(sp.src.asset || ''), name: sp.src.name } : null;
        if (sp.fps) { S.fps = clamp(sp.fps | 0, 1, 24); fpsIn.value = String(S.fps); }
      }
      const so = d.sound;
      if (so && so.params) {
        S.snd = normSound(so.params);
        S.sndName = String(so.name || 'sound').slice(0, 40);
        S.sndLib = typeof so.lib === 'string' ? so.lib : null;
        S.buf = null;
      }
      S.fit = true;
      nameIn.value = S.tab === 'sound' ? S.sndName : S.spriteName;
      paintSnd();
      refreshSprite();
      if (S.tab === 'sound') rerender();
    }).catch(() => {});

    const teardown = () => {
      if (S.dead) return;
      /* flush the draft before going */
      if (S.touched) {
        try { LIB.set(DRAFT, draftData()).catch(() => {}); } catch (err) { /* nothing to save */ }
      }
      S.dead = true;
      closeSheet();
      S.ai.ac?.abort();
      stopSound();
      stopPreviewLoop();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      offs.forEach(fn => { try { fn(); } catch (err) { /* already gone */ } });
      offs.length = 0;
      try { S.audioEl?.pause(); } catch (err) { /* nothing playing */ }
      S.audioEl = null;
      try { S.actx?.close(); } catch (err) { /* already closed */ }
      S.actx = null;
    };
    return teardown;
  },
});
