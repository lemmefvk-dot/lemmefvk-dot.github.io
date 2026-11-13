/* ============================================================
   arcade/jigsaw-logic.js — the geometry and rules of Photo Jigsaw,
   with no DOM and no image data.

   A puzzle is cols × rows pieces cut from a picture. Pieces are
   numbered row-major (id = row * cols + col). Lengths are in "board
   units": the board is 1 wide and `1 / aspect` tall. A piece's
   position is the top-left corner of its body (the rectangle it
   would fill, without its tabs); it is in the right place when that
   equals (col / cols, row * pieceHeight).

   Real interlocking shapes: every inner edge between two pieces gets
   one tab, drawn once. The piece on one side gets it as a knob, the
   piece on the other as a socket, because both walk the same curve
   (one of them backwards). edgeSegs() makes the curve, piecePath()
   walks a piece's four edges clockwise. The tab's direction, centre
   and size come from the puzzle's seed.

   Paths are lists of cubic segments { c1, c2, to } after a start
   point, so the page can feed them to Path2D and tests can measure
   them.
   ============================================================ */
import { rng } from './kit.js';

export const COUNTS = [12, 24, 48, 70, 100];
export const SNAP = 0.3;               /* of the smaller piece side: how near a drop snaps */
export const TAB = 0.25;               /* knob height, as a part of the smaller piece side */
export const MARGIN = 0.31;            /* room a piece's canvas leaves for its knobs (same unit) */
export const MAX_SIDE = 1280;          /* the longest side of the picture kept in memory */
export const MIN_ASPECT = 0.5, MAX_ASPECT = 2;

/* The grid for a wanted piece count and a picture's width / height: the
   rows × columns whose product is nearest the count, with squarish pieces. */
export function gridFor(count, aspect) {
  const a = Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, Number(aspect) || 1));
  let best = null;
  for (let rows = 2; rows <= 14; rows++) {
    for (const dc of [-1, 0, 1]) {
      const cols = Math.max(2, Math.round(rows * a) + dc);
      const n = cols * rows, pieceAspect = (a / cols) / (1 / rows);   /* piece width / height */
      const cost = Math.abs(n - count) / count + 0.5 * Math.abs(Math.log(pieceAspect));
      if (!best || cost < best.cost) best = { cols, rows, cost };
    }
  }
  return { cols: best.cols, rows: best.rows };
}

/* the size the kept picture should have: the longest side at most MAX_SIDE, the aspect clamped (by a centre crop) */
export function workSize(w, h) {
  const a = Math.max(MIN_ASPECT, Math.min(MAX_ASPECT, w / h));
  let cw = w, ch = h;                                   /* the crop of the source */
  if (w / h > a) cw = Math.round(h * a); else if (w / h < a) ch = Math.round(w / a);
  const s = Math.min(1, MAX_SIDE / Math.max(cw, ch));
  return { sx: Math.floor((w - cw) / 2), sy: Math.floor((h - ch) / 2), sw: cw, sh: ch, w: Math.max(1, Math.round(cw * s)), h: Math.max(1, Math.round(ch * s)) };
}

/* ---------- the shapes ---------- */
/* signs, centres and sizes of every inner edge. hor[r-1][c]: the edge between rows r-1 and r in column c.
   ver[r][c-1]: the edge between columns c-1 and c in row r. sign +1: the knob points down / right. */
export function makeEdges(cols, rows, seed) {
  const r = rng((seed >>> 0) ^ 0x9e3779b9);
  const one = () => ({ s: r() < 0.5 ? -1 : 1, o: (r() - 0.5) * 0.1, k: 0.92 + r() * 0.16 });
  const hor = Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, one));
  const ver = Array.from({ length: rows }, () => Array.from({ length: cols - 1 }, one));
  return { cols, rows, hor, ver };
}

/* one edge from (x0,y0) to (x1,y1), which runs right or down; `m` scales the knob. p = null: a flat border. */
export function edgeSegs(x0, y0, x1, y1, p, m) {
  const dx = x1 - x0, dy = y1 - y0;
  const nx = dy === 0 ? 0 : 1, ny = dy === 0 ? 1 : 0;       /* the s = +1 side: down for a horizontal edge, right for a vertical one */
  const P = (u, v) => [x0 + dx * u + nx * (p ? p.s : 0) * v * m * (p ? p.k : 1), y0 + dy * u + ny * (p ? p.s : 0) * v * m * (p ? p.k : 1)];
  const seg = (c1, c2, to) => ({ c1: P(...c1), c2: P(...c2), to: P(...to) });
  const line = (a, b) => seg([a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + 2 * (b[0] - a[0]) / 3, a[1] + 2 * (b[1] - a[1]) / 3], b);
  if (!p) return [line([0, 0], [1, 0])];
  const e = 0.5 + p.o, t = TAB;
  return [
    line([0, 0], [e - 0.11, 0]),
    seg([e - 0.05, 0], [e - 0.075, 0.04], [e - 0.075, 0.09]),
    seg([e - 0.17, 0.12], [e - 0.16, t], [e, t]),
    seg([e + 0.16, t], [e + 0.17, 0.12], [e + 0.075, 0.09]),
    seg([e + 0.075, 0.04], [e + 0.05, 0], [e + 0.11, 0]),
    line([e + 0.11, 0], [1, 0]),
  ];
}
const withStart = (segs, start) => { segs.start = start; return segs; };
function edge(x0, y0, x1, y1, p, m) {
  return withStart(edgeSegs(x0, y0, x1, y1, p, m), [x0, y0]);
}
/* the same curve walked the other way */
function backwards(segs) {
  const out = [];
  let from = segs[segs.length - 1].to;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i], prev = i > 0 ? segs[i - 1].to : segs.start;
    out.push({ c1: s.c2, c2: s.c1, to: prev });
  }
  return withStart(out, from);
}

/* A piece's outline, clockwise from its top-left corner: { start, segs }.
   pw, ph: the body's size; (ox, oy): where its top-left corner sits. */
export function piecePath(edges, c, r, pw, ph, ox = 0, oy = 0) {
  const { cols, rows } = edges, m = Math.min(pw, ph);
  const x0 = ox, y0 = oy, x1 = ox + pw, y1 = oy + ph;
  const top = edge(x0, y0, x1, y0, r > 0 ? edges.hor[r - 1][c] : null, m);
  const right = edge(x1, y0, x1, y1, c < cols - 1 ? edges.ver[r][c] : null, m);
  const bottom = backwards(edge(x0, y1, x1, y1, r < rows - 1 ? edges.hor[r][c] : null, m));
  const left = backwards(edge(x0, y0, x0, y1, c > 0 ? edges.ver[r][c - 1] : null, m));
  return { start: [x0, y0], segs: [...top, ...right, ...bottom, ...left] };
}

/* the outline's extent, from its control points (a safe bound) */
export function bounds(path) {
  let a = path.start[0], b = path.start[1], c = a, d = b;
  for (const s of path.segs) for (const q of [s.c1, s.c2, s.to]) { a = Math.min(a, q[0]); c = Math.max(c, q[0]); b = Math.min(b, q[1]); d = Math.max(d, q[1]); }
  return { x0: a, y0: b, x1: c, y1: d };
}

/* ---------- the rules ---------- */
export function geometry(cols, rows, aspect) {
  const pw = 1 / cols, ph = 1 / aspect / rows;
  return { cols, rows, pw, ph, boardH: 1 / aspect, m: Math.min(pw, ph), snap: SNAP * Math.min(pw, ph) };
}
export const home = (geo, id) => ({ x: (id % geo.cols) * geo.pw, y: Math.floor(id / geo.cols) * geo.ph });
export const slotAt = (geo, x, y) => {
  const c = Math.floor(x / geo.pw), r = Math.floor(y / geo.ph);
  return c < 0 || r < 0 || c >= geo.cols || r >= geo.rows ? -1 : r * geo.cols + c;
};
/* does a piece dropped with its top-left at (x, y) snap into slot `id`? */
export function snaps(geo, id, x, y) {
  const h = home(geo, id);
  return Math.hypot(x - h.x, y - h.y) <= geo.snap;
}
/* the slot whose top-left is nearest (x, y) — where the keyboard and tidy-ups put things */
export function nearestSlot(geo, x, y) {
  let best = 0, bd = Infinity;
  for (let id = 0; id < geo.cols * geo.rows; id++) {
    const h = home(geo, id), d = Math.hypot(x - h.x, y - h.y);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

/* Scatter loose pieces over `area` ({ x0, y0, x1, y1 } for piece top-left corners),
   keeping off the board where there is room. Deterministic for a seed. */
export function scatter(geo, seed, area, count = geo.cols * geo.rows) {
  const r = rng((seed >>> 0) ^ 0x85ebca6b);
  const out = [];
  const onBoard = (x, y) => x > -geo.pw * 0.6 && y > -geo.ph * 0.6 && x < 1 - geo.pw * 0.4 && y < geo.boardH - geo.ph * 0.4;
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0;
    for (let t = 0; t < 40; t++) {
      x = area.x0 + r() * (area.x1 - area.x0);
      y = area.y0 + r() * (area.y1 - area.y0);
      if (!onBoard(x, y)) break;
    }
    out.push({ x, y });
  }
  return out;
}

/* ---------- saved progress (no picture in it) ---------- */
export const isSource = s => !!s && typeof s === 'object' && (s.kind === 'path' || s.kind === 'asset') && typeof s.ref === 'string' && s.ref.length > 0 && s.ref.length < 400;

export function packState({ src, count, cols, rows, seed, aspect, elapsed, pieces }) {
  const q = v => Math.round(v * 10000) / 10000;
  return {
    v: 1, src: { kind: src.kind, ref: src.ref }, count, cols, rows, seed: seed >>> 0, aspect: q(aspect), elapsed: Math.round(elapsed),
    pieces: pieces.map(p => [q(p.x), q(p.y), p.locked ? 1 : 0]),
  };
}
/* a saved state that is safe to use, or null */
export function unpackState(s) {
  if (!s || typeof s !== 'object' || s.v !== 1 || !isSource(s.src)) return null;
  const { cols, rows } = s;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 20 || rows > 20) return null;
  if (!Array.isArray(s.pieces) || s.pieces.length !== cols * rows) return null;
  if (!s.pieces.every(p => Array.isArray(p) && p.length === 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null;
  const aspect = Number(s.aspect);
  if (!(aspect >= MIN_ASPECT && aspect <= MAX_ASPECT)) return null;
  return {
    src: { kind: s.src.kind, ref: s.src.ref }, count: Number(s.count) || cols * rows, cols, rows, seed: s.seed >>> 0, aspect,
    elapsed: Math.max(0, Number(s.elapsed) || 0),
    pieces: s.pieces.map(p => ({ x: p[0], y: p[1], locked: !!p[2] })),
  };
}
export const placedCount = pieces => pieces.reduce((n, p) => n + (p.locked ? 1 : 0), 0);
