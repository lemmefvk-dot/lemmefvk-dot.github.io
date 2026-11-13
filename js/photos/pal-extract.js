/* ============================================================
   pal-extract.js — the main colours of a picture (Static Color › From picture, #114).

   Median cut on a small copy of the picture:
     1. pixels are counted by colour (5 bits a channel), so a flat block of
        one colour is a single entry however big it is;
     2. the box of colours with the widest spread is cut in two at the
        weighted median of its widest channel, until there are `k` boxes
        (or no box has two colours left to separate);
     3. each box becomes one swatch: the true average of the pixels in it,
        and its share of all the opaque pixels.
   Everything is measured from the pixels; nothing is invented.
   ============================================================ */

/** px = RGBA bytes. Returns [{ r, g, b, share }] biggest share first. */
export function medianCut(px, k = 6) {
  const bins = new Map();
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    let e = bins.get(key);
    if (!e) bins.set(key, e = { n: 0, r: 0, g: 0, b: 0 });
    e.n++; e.r += px[i]; e.g += px[i + 1]; e.b += px[i + 2];
    total++;
  }
  if (!total) return [];
  const entries = [...bins.values()].map(e => ({ n: e.n, sr: e.r, sg: e.g, sb: e.b, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }));
  const stats = list => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    let n = 0;
    for (const e of list) {
      const c = [e.r, e.g, e.b];
      for (let j = 0; j < 3; j++) { if (c[j] < lo[j]) lo[j] = c[j]; if (c[j] > hi[j]) hi[j] = c[j]; }
      n += e.n;
    }
    const range = hi.map((v, j) => v - lo[j]);
    const ch = range[0] >= range[1] && range[0] >= range[2] ? 0 : range[1] >= range[2] ? 1 : 2;
    return { n, ch, spread: range[ch] };
  };
  const mk = list => ({ list, ...stats(list) });
  const boxes = [mk(entries)];
  while (boxes.length < k) {
    let best = -1, bestP = 0;
    boxes.forEach((b, i) => {
      if (b.list.length < 2) return;
      const p = b.spread * Math.sqrt(b.n);
      if (p > bestP) { bestP = p; best = i; }
    });
    if (best < 0) break;
    const b = boxes[best];
    const key = ['r', 'g', 'b'][b.ch];
    const sorted = b.list.slice().sort((x, y) => x[key] - y[key]);
    let cum = 0, cut = 1;
    for (let i = 0; i < sorted.length; i++) { cum += sorted[i].n; if (cum >= b.n / 2) { cut = i + 1; break; } }
    cut = Math.max(1, Math.min(sorted.length - 1, cut));
    boxes.splice(best, 1, mk(sorted.slice(0, cut)), mk(sorted.slice(cut)));
  }
  return boxes.map(b => {
    let n = 0, r = 0, g = 0, bl = 0;
    for (const e of b.list) { n += e.n; r += e.sr; g += e.sg; bl += e.sb; }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n), share: n / total };
  }).sort((a, b) => b.share - a.share);
}
