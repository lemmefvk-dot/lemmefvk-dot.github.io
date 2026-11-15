/* ============================================================
   fractal.js — escape-time fractals: Mandelbrot and Julia sets.

   No DOM in here, so the same file runs in the page (tests, the
   no-Worker fallback) and in the Worker that draws the window
   (js/apps/mathlab-fractal-worker.js).

   A point either stays bounded under z -> z² + c or runs away. The
   number of steps it takes to pass the bailout radius is its
   "escape count"; a point that survives `max` steps is taken to be
   inside the set (that is a limit of the method, not a proof). The
   smooth value used for colour follows n + 1 - log2(ln|z|) so bands
   fade into each other.
   ============================================================ */

export const BAILOUT = 256;           /* |z|² past which a point is called escaped */

/** Mandelbrot: z starts at 0 and c is the point. Julia: z starts at the
    point and c is fixed. Returns { n, smooth }: n is the number of steps
    taken when it escaped, or -1 if it never did within `max`. */
export function escape(mode, x, y, max, c) {
  let zr, zi, cr, ci;
  if (mode === 'julia') { zr = x; zi = y; cr = c[0]; ci = c[1]; }
  else {
    zr = 0; zi = 0; cr = x; ci = y;
    /* the main cardioid and the period-2 bulb are inside: skip their long runs */
    const q = (x - 0.25) * (x - 0.25) + y * y;
    if (q * (q + (x - 0.25)) <= 0.25 * y * y) return { n: -1, smooth: 0 };
    if ((x + 1) * (x + 1) + y * y <= 0.0625) return { n: -1, smooth: 0 };
  }
  for (let n = 1; n <= max; n++) {
    const t = zr * zr - zi * zi + cr;
    zi = 2 * zr * zi + ci;
    zr = t;
    const r2 = zr * zr + zi * zi;
    if (r2 > BAILOUT) return { n, smooth: n + 1 - Math.log2(Math.log(r2) / 2) };
  }
  return { n: -1, smooth: 0 };
}

/* palettes: smooth escape value -> [r, g, b] */
const mix = (a, b, t) => a + (b - a) * t;
const STOPS = {
  fire: [[0, 0, 20], [90, 10, 90], [220, 40, 40], [255, 190, 40], [255, 255, 220]],
  ocean: [[0, 8, 30], [10, 60, 140], [30, 160, 210], [150, 230, 240], [255, 255, 255]],
  forest: [[5, 20, 10], [20, 90, 40], [110, 190, 60], [230, 240, 130], [255, 255, 240]],
  grey: [[0, 0, 0], [255, 255, 255]],
};
export const PALETTES = Object.keys(STOPS);
export function colour(palette, smooth) {
  const st = STOPS[palette] || STOPS.fire;
  const t = ((smooth * 0.045) % 1 + 1) % 1;                /* the bands repeat as you go deeper */
  const u = t * (st.length - 1), i = Math.min(st.length - 2, Math.floor(u)), f = u - i;
  return [mix(st[i][0], st[i + 1][0], f), mix(st[i][1], st[i + 1][1], f), mix(st[i][2], st[i + 1][2], f)];
}

/** Draw rows y0..y1-1 of a w×h picture into RGBA bytes. The view is the
    complex point at the centre and how many units one pixel is wide. */
export function renderRows(o, y0, y1) {
  const { mode, cx, cy, scale, w, h, max, palette, c } = o;
  const out = new Uint8ClampedArray(w * (y1 - y0) * 4);
  let p = 0;
  for (let py = y0; py < y1; py++) {
    const y = cy + (py - h / 2) * scale;
    for (let px = 0; px < w; px++) {
      const x = cx + (px - w / 2) * scale;
      const e = escape(mode, x, y, max, c);
      if (e.n < 0) { out[p++] = 0; out[p++] = 0; out[p++] = 0; }
      else { const k = colour(palette, e.smooth); out[p++] = k[0]; out[p++] = k[1]; out[p++] = k[2]; }
      out[p++] = 255;
    }
  }
  return out;
}

/** The view a fresh window starts at. */
export const HOME = { mandelbrot: { cx: -0.5, cy: 0, width: 3.4 }, julia: { cx: 0, cy: 0, width: 3.2 } };
export const JULIA_PRESETS = [['Dendrite', 0, 1], ['Rabbit', -0.123, 0.745], ['Dragon', -0.8, 0.156], ['Spiral', -0.7269, 0.1889], ['Snowflake', -0.4, 0.6], ['Dust', 0.285, 0.01]];
