/* ============================================================
   docscan.js — the picture maths behind Picture Tools' Scan tab.

   Pure functions on pixel arrays (no DOM, so they run anywhere and
   nothing here can send a picture anywhere):

     toGray(rgba, w, h)                       -> Uint8ClampedArray (luma)
     detectCorners(gray, w, h)                -> { corners:[TL,TR,BR,BL], found }
     warpGray(gray, w, h, corners, outW, outH)-> Uint8ClampedArray  (perspective-corrected)
     outputSize(corners, maxSide)             -> { w, h }
     binarize(gray, w, h, { detail })         -> Uint8ClampedArray, 0 or 255
     pack1bit(bw, w, h)                       -> Uint8Array, rows padded to a byte, 1 = white

   Finding the page: the picture is shrunk, blurred and split into light
   and dark at Otsu's threshold; the biggest light blob is taken as the
   page, its outline's convex hull is trimmed to the four most prominent
   corners (smallest-triangle removal), and the four are put in order
   top-left, top-right, bottom-right, bottom-left. When no page stands
   out the corners fall back to a frame just inside the picture, and
   `found` is false so the screen can say so.

   Black and white: Bradley–Roth adaptive threshold. Each pixel is
   compared with the mean of the window around it (via an integral
   image), so a shadow or a lamp's gradient across the page doesn't turn
   half of it black the way one global cut-off does. A pixel much darker
   than the page's own paper is always black, so a solid block stays solid.
   ============================================================ */

export function toGray(rgba, w, h) {
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 151 + rgba[i + 2] * 28) >> 8;
  return out;
}

/* ---------- finding the page ---------- */

function shrink(gray, w, h, maxSide) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  if (k === 1) return { g: Float32Array.from(gray), w, h, k: 1 };
  const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
  const g = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) / k)));
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) / k)));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += gray[yy * w + xx]; n++; }
      g[y * sw + x] = s / n;
    }
  }
  return { g, w: sw, h: sh, k };
}

function boxBlur(g, w, h, r) {
  const tmp = new Float32Array(g.length), out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let x = 0; x < Math.min(w, r + 1); x++) { s += g[y * w + x]; n++; }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      const add = x + r + 1, del = x - r;
      if (add < w) { s += g[y * w + add]; n++; }
      if (del >= 0) { s -= g[y * w + del]; n--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let y = 0; y < Math.min(h, r + 1); y++) { s += tmp[y * w + x]; n++; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      const add = y + r + 1, del = y - r;
      if (add < h) { s += tmp[add * w + x]; n++; }
      if (del >= 0) { s -= tmp[del * w + x]; n--; }
    }
  }
  return out;
}

export function otsu(g) {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, Math.round(g[i])))]++;
  let total = g.length, sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sumB = 0, best = 0, bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

/* the biggest 4-connected blob of `mask`, as a Uint8Array of 0/1 and its area */
function biggestBlob(mask, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0, bestId = 0, id = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    id++;
    let sp = 0, n = 0;
    stack[sp++] = s; label[s] = id;
    while (sp) {
      const p = stack[--sp];
      n++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack[sp++] = p + w; }
    }
    if (n > best) { best = n; bestId = id; }
  }
  const out = new Uint8Array(w * h);
  if (bestId) for (let i = 0; i < out.length; i++) if (label[i] === bestId) out[i] = 1;
  return { blob: out, area: best };
}

function convexHull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/* trim a convex polygon to n vertices by repeatedly dropping the one whose
   triangle with its neighbours is smallest */
function trimTo(poly, n) {
  const pts = poly.slice();
  const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  while (pts.length > n) {
    let bi = 0, ba = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = tri(pts[(i + pts.length - 1) % pts.length], pts[i], pts[(i + 1) % pts.length]);
      if (a < ba) { ba = a; bi = i; }
    }
    pts.splice(bi, 1);
  }
  return pts;
}

const polyArea = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

/** Top-left, top-right, bottom-right, bottom-left, whatever order four points arrive in. */
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const byAngle = pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));   /* clockwise on screen */
  let first = 0;
  for (let i = 1; i < 4; i++) if (byAngle[i].x + byAngle[i].y < byAngle[first].x + byAngle[first].y) first = i;
  return [0, 1, 2, 3].map(i => byAngle[(first + i) % 4]);
}

export function defaultCorners(w, h) {
  const mx = Math.round(w * 0.04), my = Math.round(h * 0.04);
  return [{ x: mx, y: my }, { x: w - mx, y: my }, { x: w - mx, y: h - my }, { x: mx, y: h - my }];
}

export function detectCorners(gray, w, h) {
  const fallback = { corners: defaultCorners(w, h), found: false };
  if (w < 16 || h < 16) return fallback;
  const sm = shrink(gray, w, h, 320);
  const g = boxBlur(boxBlur(sm.g, sm.w, sm.h, 2), sm.w, sm.h, 2);
  const T = otsu(g);
  const mask = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) mask[i] = g[i] > T ? 1 : 0;
  const { blob, area } = biggestBlob(mask, sm.w, sm.h);
  const frac = area / (sm.w * sm.h);
  if (frac < 0.12 || frac > 0.9) return fallback;
  const edge = [];
  for (let y = 0; y < sm.h; y++) for (let x = 0; x < sm.w; x++) {
    const p = y * sm.w + x;
    if (!blob[p]) continue;
    if (x === 0 || y === 0 || x === sm.w - 1 || y === sm.h - 1 || !blob[p - 1] || !blob[p + 1] || !blob[p - sm.w] || !blob[p + sm.w]) edge.push([x, y]);
  }
  if (edge.length < 8) return fallback;
  const hull = convexHull(edge);
  if (hull.length < 4) return fallback;
  const quad = trimTo(hull, 4);
  if (polyArea(quad) < 0.1 * sm.w * sm.h) return fallback;
  /* blurring rounds the page's corners off, so don't trust the hull's own
     vertices: fit a straight line along each side, then intersect neighbours */
  const fitted = fitSides(quad, edge, sm.w, sm.h);
  /* back to the full picture */
  const pts = fitted.map(([x, y]) => ({ x: Math.max(0, Math.min(w - 1, (x + 0.5) / sm.k)), y: Math.max(0, Math.min(h - 1, (y + 0.5) / sm.k)) }));
  return { corners: orderCorners(pts), found: true };
}

/* a line through the boundary pixels lying along each side of the quad
   (the middle of the side only: the ends are the rounded part) */
function fitSides(quad, edge, w, h) {
  const n = quad.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = quad[i], b = quad[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    let sx = 0, sy = 0, c = 0;
    const near = [];
    for (const [x, y] of edge) {
      const t = ((x - a[0]) * ux + (y - a[1]) * uy) / len;
      const d = Math.abs((x - a[0]) * -uy + (y - a[1]) * ux);
      if (t > 0.15 && t < 0.85 && d < Math.max(3, len * 0.04)) { near.push([x, y]); sx += x; sy += y; c++; }
    }
    if (c < 6) { lines.push(null); continue; }
    const mx = sx / c, my = sy / c;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of near) { sxx += (x - mx) * (x - mx); sxy += (x - mx) * (y - my); syy += (y - my) * (y - my); }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({ px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang) });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n], l2 = lines[i];
    const v = quad[i];
    if (!l1 || !l2) { out.push(v); continue; }
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 0.05) { out.push(v); continue; }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    const x = l1.px + l1.dx * t, y = l1.py + l1.dy * t;
    /* a wild intersection means a bad fit: keep the hull's vertex */
    out.push(Math.hypot(x - v[0], y - v[1]) < 0.15 * Math.max(w, h) ? [x, y] : v);
  }
  return out;
}

/* ---------- straightening ---------- */

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The size a straightened page should have: the longer of each pair of opposite sides, capped. */
export function outputSize(c, maxSide = 2000) {
  let w = Math.max(dist(c[0], c[1]), dist(c[3], c[2]));
  let h = Math.max(dist(c[0], c[3]), dist(c[1], c[2]));
  const k = Math.min(1, maxSide / Math.max(w, h, 1));
  return { w: Math.max(8, Math.round(w * k)), h: Math.max(8, Math.round(h * k)) };
}

/* the projective map from the unit square onto the quad (Heckbert) */
export function squareToQuad(c) {
  const [p0, p1, p2, p3] = c;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, hh = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    hh = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return { a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + hh * p3.x, c: p0.x, d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + hh * p3.y, f: p0.y, g, h: hh };
}

export function warpGray(gray, w, h, corners, outW, outH) {
  const m = squareToQuad(corners);
  const out = new Uint8ClampedArray(outW * outH);
  for (let j = 0; j < outH; j++) {
    const v = (j + 0.5) / outH;
    for (let i = 0; i < outW; i++) {
      const u = (i + 0.5) / outW;
      const den = m.g * u + m.h * v + 1;
      const x = (m.a * u + m.b * v + m.c) / den - 0.5, y = (m.d * u + m.e * v + m.f) / den - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const xa = Math.max(0, Math.min(w - 1, x0)), xb = Math.max(0, Math.min(w - 1, x0 + 1));
      const ya = Math.max(0, Math.min(h - 1, y0)), yb = Math.max(0, Math.min(h - 1, y0 + 1));
      const top = gray[ya * w + xa] * (1 - fx) + gray[ya * w + xb] * fx;
      const bot = gray[yb * w + xa] * (1 - fx) + gray[yb * w + xb] * fx;
      out[j * outW + i] = top * (1 - fy) + bot * fy;
    }
  }
  return out;
}

/* ---------- black and white ---------- */

/** detail: 0 (cleanest, only strong marks) … 1 (keeps faint pencil). */
export function binarize(gray, w, h, { detail = 0.5 } = {}) {
  const win = Math.max(15, Math.round(Math.max(w, h) / 12)) | 1;
  const r = win >> 1;
  const W1 = w + 1;
  const integral = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; integral[(y + 1) * W1 + x + 1] = integral[y * W1 + x + 1] + row; }
  }
  /* the paper's own brightness: the 90th percentile of the grey levels */
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let acc = 0, paper = 255;
  for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= gray.length * 0.9) { paper = t; break; } }
  const t = 0.30 - 0.22 * Math.max(0, Math.min(1, detail));          /* 0.30 … 0.08 below the local mean */
  const dark = paper * 0.4;
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * W1 + x1 + 1] - integral[y0 * W1 + x1 + 1] - integral[(y1 + 1) * W1 + x0] + integral[y0 * W1 + x0];
      const v = gray[y * w + x];
      out[y * w + x] = v < dark || v * n < sum * (1 - t) ? 0 : 255;
    }
  }
  return out;
}

/** 1 bit a pixel, most significant bit first, rows padded to whole bytes, 1 = white. */
export function pack1bit(bw, w, h) {
  const rowBytes = (w + 7) >> 3;
  const out = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bw[y * w + x] > 127) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}

export default { toGray, detectCorners, orderCorners, defaultCorners, outputSize, warpGray, binarize, pack1bit, squareToQuad, otsu };
