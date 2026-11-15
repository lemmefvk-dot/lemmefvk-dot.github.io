/* ============================================================
   paintbynumber.js — turn a picture into a colour-by-number puzzle.
   Everything runs here, on this device; the picture is never sent anywhere.

     buildPuzzle(imageData, { colours })  ->  {
        w, h,                      the grid (the picture, shrunk)
        palette: ['#rrggbb', …],   colour n+1 is palette[n]
        cell: Uint8Array,          palette index of every cell
        region: Uint16Array,       region id of every cell (a region is one
                                   connected patch of a single colour)
        regions: [{ id, colour, area, x, y }]   x, y: the cell farthest from
                                   the region's edge — where its number goes
     }

   How:
     1. a light 3x3 blur takes the noise out of the picture
     2. k-means (k-means++ start, a fixed seed, so a picture always gives the
        same puzzle) picks the palette from the picture's own colours
     3. each cell takes its nearest colour; a 3x3 majority pass smooths ragged
        edges
     4. patches smaller than `minArea` cells are folded into the neighbour they
        share the most edge with, so every patch is big enough to hold a number
     5. colours no patch uses any more are dropped and the rest renumbered; each
        palette colour is the real average of the picture under its patches
   ============================================================ */

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296; }

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function blur(px, w, h) {
  const out = new Float32Array(px.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const i = (yy * w + xx) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return out;
}

function kmeans(px, n, k, rand) {
  /* k-means++ start */
  const cent = [];
  const first = Math.floor(rand() * n);
  cent.push([px[first * 4], px[first * 4 + 1], px[first * 4 + 2]]);
  const d2 = new Float64Array(n).fill(Infinity);
  while (cent.length < k) {
    const c = cent[cent.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const dr = px[i * 4] - c[0], dg = px[i * 4 + 1] - c[1], db = px[i * 4 + 2] - c[2];
      d2[i] = Math.min(d2[i], dr * dr + dg * dg + db * db); total += d2[i];
    }
    if (total === 0) break;                          /* a flat picture has fewer colours than asked for */
    let t = rand() * total, pick = n - 1;
    for (let i = 0; i < n; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
    cent.push([px[pick * 4], px[pick * 4 + 1], px[pick * 4 + 2]]);
  }
  const lab = new Uint8Array(n);
  for (let it = 0; it < 10; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cent.length; c++) {
        const dr = px[i * 4] - cent[c][0], dg = px[i * 4 + 1] - cent[c][1], db = px[i * 4 + 2] - cent[c][2], d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      lab[i] = best; const s = sum[best]; s[0] += px[i * 4]; s[1] += px[i * 4 + 1]; s[2] += px[i * 4 + 2]; s[3]++;
    }
    cent.forEach((c, j) => { const s = sum[j]; if (s[3]) { c[0] = s[0] / s[3]; c[1] = s[1] / s[3]; c[2] = s[2] / s[3]; } });
  }
  return lab;
}

/** Label connected patches of one colour (4-neighbours). Returns { region, count }. */
function components(cell, w, h) {
  const region = new Uint16Array(w * h).fill(65535);
  let count = 0;
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (region[s] !== 65535) continue;
    const id = count++, col = cell[s];
    region[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      if (x > 0 && region[i - 1] === 65535 && cell[i - 1] === col) { region[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && region[i + 1] === 65535 && cell[i + 1] === col) { region[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && region[i - w] === 65535 && cell[i - w] === col) { region[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && region[i + w] === 65535 && cell[i + w] === col) { region[i + w] = id; stack.push(i + w); }
    }
  }
  return { region, count };
}

export function buildPuzzle(img, { colours = 10, seed = 7, minArea = 14 } = {}) {
  const { width: w, height: h } = img, n = w * h;
  const k = Math.max(2, Math.min(24, Math.round(colours)));
  const px = blur(img.data, w, h);
  let cell = kmeans(px, n, k, rng(seed));

  /* smooth: a cell takes the colour most of its 3x3 neighbourhood has */
  const smooth = c => {
    const out = new Uint8Array(c);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const tally = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const v = c[yy * w + xx]; tally.set(v, (tally.get(v) || 0) + 1);
      }
      let best = c[y * w + x], bn = tally.get(best) || 0;
      for (const [v, m] of tally) if (m > bn) { best = v; bn = m; }
      out[y * w + x] = best;
    }
    return out;
  };
  cell = smooth(cell);

  /* fold small patches into the neighbour they touch the most */
  let comp = components(cell, w, h);
  for (let pass = 0; pass < 12; pass++) {
    const area = new Uint32Array(comp.count);
    for (let i = 0; i < n; i++) area[comp.region[i]]++;
    const small = [];
    for (let id = 0; id < comp.count; id++) if (area[id] < minArea) small.push(id);
    if (!small.length || comp.count <= 2) break;
    const touch = new Map();                          /* small id -> Map(neighbour colour -> shared edges) */
    for (const id of small) touch.set(id, new Map());
    const edge = (i, j) => {
      const a = comp.region[i], b = comp.region[j];
      if (a === b) return;
      if (touch.has(a)) { const m = touch.get(a); m.set(cell[j], (m.get(cell[j]) || 0) + 1); }
      if (touch.has(b)) { const m = touch.get(b); m.set(cell[i], (m.get(cell[i]) || 0) + 1); }
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (x < w - 1) edge(i, i + 1); if (y < h - 1) edge(i, i + w); }
    const to = new Map();
    for (const [id, m] of touch) { let best = -1, bn = 0; for (const [c, e] of m) if (e > bn) { best = c; bn = e; } if (best >= 0) to.set(id, best); }
    if (!to.size) break;
    for (let i = 0; i < n; i++) { const t = to.get(comp.region[i]); if (t !== undefined) cell[i] = t; }
    comp = components(cell, w, h);
  }

  /* drop unused colours, renumber, average the real colours under each */
  const used = [...new Set(cell)].sort((a, b) => a - b);
  const renum = new Map(used.map((c, i) => [c, i]));
  const sums = used.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const c = renum.get(cell[i]); cell[i] = c;
    const s = sums[c]; s[0] += img.data[i * 4]; s[1] += img.data[i * 4 + 1]; s[2] += img.data[i * 4 + 2]; s[3]++;
  }
  const palette = sums.map(s => hex(s[0] / s[3], s[1] / s[3], s[2] / s[3]));
  return describe(w, h, palette, cell);
}

/** The patches of a grid of palette indexes, and where each one's number goes. A saved puzzle is rebuilt with this. */
export function describe(w, h, palette, cell) {
  const n = w * h;
  const comp = components(cell, w, h);

  /* where each number goes: the cell farthest from its patch's edge (chamfer distance) */
  const region = comp.region;
  const dist = new Float32Array(n);
  const INF = 1e6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, id = region[i];
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || region[i - 1] !== id || region[i + 1] !== id || region[i - w] !== id || region[i + w] !== id;
    dist[i] = edge ? 1 : INF;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let d = dist[i];
    if (x > 0) d = Math.min(d, dist[i - 1] + 1); if (y > 0) d = Math.min(d, dist[i - w] + 1);
    if (x > 0 && y > 0) d = Math.min(d, dist[i - w - 1] + 1.4); if (x < w - 1 && y > 0) d = Math.min(d, dist[i - w + 1] + 1.4);
    dist[i] = d;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let d = dist[i];
    if (x < w - 1) d = Math.min(d, dist[i + 1] + 1); if (y < h - 1) d = Math.min(d, dist[i + w] + 1);
    if (x < w - 1 && y < h - 1) d = Math.min(d, dist[i + w + 1] + 1.4); if (x > 0 && y < h - 1) d = Math.min(d, dist[i + w - 1] + 1.4);
    dist[i] = d;
  }
  const regions = Array.from({ length: comp.count }, (_, id) => ({ id, colour: 0, area: 0, x: 0, y: 0, d: -1 }));
  for (let i = 0; i < n; i++) {
    const r = regions[region[i]]; r.area++; r.colour = cell[i];
    if (dist[i] > r.d) { r.d = dist[i]; r.x = i % w; r.y = (i / w) | 0; }
  }
  return { w, h, palette, cell, region, regions: regions.map(({ id, colour, area, x, y }) => ({ id, colour, area, x, y })) };
}
