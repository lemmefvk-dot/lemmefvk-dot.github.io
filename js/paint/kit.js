/* ============================================================
   kit.js — the small, pure pieces behind Static Paint (js/apps/paint.js):
   symmetry transforms, flood-fill region, soft brush stamps, pen
   pressure, and whole-image flip / turn / invert. Nothing here keeps
   state about the document; the app passes canvases and numbers in.
   ============================================================ */

export const SYMMETRY = [
  { id: 'off',  label: 'Symmetry: off' },
  { id: 'h',    label: 'Mirror left–right' },
  { id: 'v',    label: 'Mirror top–bottom' },
  { id: 'hv',   label: 'Mirror both ways' },
  { id: 'k4',   label: 'Kaleidoscope · 4' },
  { id: 'k6',   label: 'Kaleidoscope · 6' },
  { id: 'k8',   label: 'Kaleidoscope · 8' },
];

const IDENT = [1, 0, 0, 1, 0, 0];

/** The 2-D transforms (a,b,c,d,e,f) that repeat a mark about the middle of a w × h picture.
    The first one is always the identity, so drawing with each of them includes the real mark. */
export function symMatrices(mode, w, h) {
  const cx = w / 2, cy = h / 2;
  /* x' = cx + (x-cx)·sx, y' = cy + (y-cy)·sy */
  const mirror = (sx, sy) => [sx, 0, 0, sy, cx - cx * sx, cy - cy * sy];
  const rot = a => {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, s, -s, c, cx - cx * c + cy * s, cy - cx * s - cy * c];
  };
  if (mode === 'h') return [IDENT, mirror(-1, 1)];
  if (mode === 'v') return [IDENT, mirror(1, -1)];
  if (mode === 'hv') return [IDENT, mirror(-1, 1), mirror(1, -1), mirror(-1, -1)];
  const m = /^k(\d+)$/.exec(mode || '');
  if (m) {
    const n = Math.max(2, Math.min(16, Number(m[1])));
    const out = [];
    for (let k = 0; k < n; k++) {
      const r = rot((Math.PI * 2 * k) / n);
      out.push(k === 0 ? IDENT : r);
    }
    /* a mirror image of each wedge makes it a kaleidoscope rather than a pinwheel */
    const flip = mirror(-1, 1);
    for (let k = 0; k < n; k++) out.push(mul(rot((Math.PI * 2 * k) / n), flip));
    return out;
  }
  return [IDENT];
}
/** m1 after m2 (apply m2 first) */
function mul(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}
export const applyM = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Pressure from a pointer event: a pen reports it; a mouse (a fixed 0.5 while pressed) and an
    engine without the field give full pressure. Never below a thin line, so a stroke never vanishes. */
export function pressureOf(e) {
  if (!e || typeof e.pressure !== 'number' || !isFinite(e.pressure)) return 1;
  if (e.pointerType === 'mouse' || e.pointerType === '') return 1;
  if (e.pointerType === 'touch' && (e.pressure === 0.5 || e.pressure === 0)) return 1;   /* touch without a force sensor */
  if (e.pressure <= 0) return 1;                                                         /* hover, or a pen that doesn't say */
  return Math.max(0.08, Math.min(1, e.pressure));
}

/** Which pixels would a fill reach? `data` is RGBA; the colour at (px,py) is matched within `tol`
    (the sum of the four channel differences). Returns a mask the size of the image, or null. */
export function floodMask(data, W, H, px, py, tol) {
  const si = (py * W + px) * 4;
  const tr = data[si], tg = data[si + 1], tb = data[si + 2], ta = data[si + 3];
  const matchC = i => (Math.abs(data[i] - tr) + Math.abs(data[i + 1] - tg) + Math.abs(data[i + 2] - tb) + Math.abs(data[i + 3] - ta)) <= tol;
  const seen = new Uint8Array(W * H);
  const stack = [px, py];
  while (stack.length) {
    const y = stack.pop(), x0 = stack.pop();
    let x = x0;
    while (x > 0 && !seen[y * W + (x - 1)] && matchC((y * W + (x - 1)) * 4)) x--;
    let up = false, down = false;
    while (x < W) {
      const p = y * W + x;
      if (seen[p] || !matchC(p * 4)) break;
      seen[p] = 1;
      if (y > 0) { const pu = p - W; const m = !seen[pu] && matchC(pu * 4); if (m && !up) { stack.push(x, y - 1); up = true; } else if (!m) up = false; }
      if (y < H - 1) { const pd = p + W; const m = !seen[pd] && matchC(pd * 4); if (m && !down) { stack.push(x, y + 1); down = true; } else if (!m) down = false; }
      x++;
    }
  }
  return seen;
}

const sprites = new Map();
/** A round brush dab, soft at the edge: opaque out to `hard` of the radius, fading to nothing.
    Cached per colour / size / hardness. Returns a canvas `d` × `d` device pixels. */
export function softSprite(color, d, hard) {
  d = Math.max(2, Math.round(d));
  hard = Math.max(0, Math.min(99, Math.round(hard)));
  const key = `${color}|${d}|${hard}`;
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = d;
  const g = c.getContext('2d');
  const r = d / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(hard / 100, color);
  grad.addColorStop(1, rgba0(color));
  g.fillStyle = grad;
  g.fillRect(0, 0, d, d);
  if (sprites.size > 80) sprites.delete(sprites.keys().next().value);
  sprites.set(key, c);
  return c;
}
function rgba0(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
}

/** A new canvas the same size as `src`, or `w` × `h`. */
export function blank(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return c;
}
export function flipped(src, horizontal) {
  const c = blank(src.width, src.height);
  const g = c.getContext('2d');
  if (horizontal) { g.translate(src.width, 0); g.scale(-1, 1); } else { g.translate(0, src.height); g.scale(1, -1); }
  g.drawImage(src, 0, 0);
  return c;
}
/** a quarter turn: clockwise, or anticlockwise */
export function turned(src, clockwise) {
  const c = blank(src.height, src.width);
  const g = c.getContext('2d');
  if (clockwise) { g.translate(src.height, 0); g.rotate(Math.PI / 2); } else { g.translate(0, src.width); g.rotate(-Math.PI / 2); }
  g.drawImage(src, 0, 0);
  return c;
}
export function resized(src, w, h) {
  const c = blank(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}
/** colours inverted, transparency kept */
export function invertInPlace(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
  g.putImageData(img, 0, 0);
}
