/* ============================================================
   voxels.js — the block grid behind Voxel Studio.

   A scene is a 16 × 16 × 16 grid (x and z along the floor, y up). Each cell
   is 0 (empty) or a palette number from 1. Everything here is plain data in,
   plain data out, so the app and its tests use the same code.

     SIZE                 16
     createGrid()         Uint8Array(SIZE³)
     idx(x, y, z)         the cell's place in the array, or -1 outside
     quads(grid, palette) one quad per exposed face, wound so its normal points
                          out: [{ v: [[x,y,z]×4], c: [r,g,b], n: [nx,ny,nz] }]
     meshOf(quads)        { pos, col } for core/mini3d.js (two triangles a quad)
     pick(grid, ray)      what a ray from the camera first meets:
                          { cell, face: [nx,ny,nz], t } for a block, or the floor
                          { cell, floor: true, t }, or null
     serialize / parse    the .blocks file (JSON)
     count(grid)          blocks placed
   ============================================================ */

export const SIZE = 16;
export const PALETTE = [
  ['#ef6f6c', 'Coral'], ['#f4a259', 'Amber'], ['#f2d45c', 'Lemon'], ['#8ac879', 'Lime'],
  ['#3fb8a0', 'Teal'], ['#5cb3e8', 'Sky'], ['#5a6bd8', 'Indigo'], ['#a56bd8', 'Plum'],
  ['#e879a8', 'Rose'], ['#d9c3a0', 'Sand'], ['#7d8699', 'Slate'], ['#eef0f6', 'Cloud'],
];

export const createGrid = () => new Uint8Array(SIZE * SIZE * SIZE);
export const idx = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= SIZE || y >= SIZE || z >= SIZE ? -1 : x + SIZE * (z + SIZE * y));
export const inside = (x, y, z) => idx(x, y, z) >= 0;
export const count = grid => { let n = 0; for (let i = 0; i < grid.length; i++) if (grid[i]) n++; return n; };

export const hexRgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); const n = m ? parseInt(m[1], 16) : 0x888888; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

/* the six faces: neighbour direction and four corners, counter-clockwise seen from outside */
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

export function quads(grid, palette = PALETTE.map(p => p[0])) {
  const out = [];
  for (let y = 0; y < SIZE; y++) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const c = grid[idx(x, y, z)];
    if (!c) continue;
    const rgb = hexRgb(palette[c - 1]);
    for (const f of FACES) {
      const j = idx(x + f.n[0], y + f.n[1], z + f.n[2]);
      if (j >= 0 && grid[j]) continue;                      /* hidden by a neighbour */
      out.push({ v: f.c.map(p => [x + p[0], y + p[1], z + p[2]]), c: rgb, n: f.n });
    }
  }
  return out;
}

export function meshOf(qs) {
  const pos = new Float32Array(qs.length * 18), col = new Uint8Array(qs.length * 6);
  qs.forEach((q, i) => {
    const [a, b, c, d] = q.v;
    pos.set([...a, ...b, ...c, ...a, ...c, ...d], i * 18);
    col.set([...q.c, ...q.c], i * 6);
  });
  return { pos, col };
}

export function pick(grid, ray) {
  let best = null;
  const { o, d } = ray;
  for (let y = 0; y < SIZE; y++) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    if (!grid[idx(x, y, z)]) continue;
    const lo = [x, y, z];
    let t0 = -Infinity, t1 = Infinity, axis = -1;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > lo[a] + 1) { t1 = -1; break; } continue; }
      let ta = (lo[a] - o[a]) / d[a], tb = (lo[a] + 1 - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) { t0 = ta; axis = a; }
      if (tb < t1) t1 = tb;
    }
    if (t1 < 0 || t0 > t1 || axis < 0 || t0 < 0) continue;
    if (!best || t0 < best.t) {
      const face = [0, 0, 0]; face[axis] = d[axis] > 0 ? -1 : 1;
      best = { cell: [x, y, z], face, t: t0 };
    }
  }
  if (d[1] < -1e-9) {
    const t = -o[1] / d[1];
    if (t > 0 && (!best || t < best.t)) {
      const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
      if (x >= 0 && x < SIZE && z >= 0 && z < SIZE) return { cell: [Math.floor(x), 0, Math.floor(z)], floor: true, t };
    }
  }
  return best;
}

export function serialize(grid, palette) {
  const blocks = [];
  for (let y = 0; y < SIZE; y++) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) { const c = grid[idx(x, y, z)]; if (c) blocks.push([x, y, z, c]); }
  return JSON.stringify({ format: 'staticos-blocks', v: 1, size: SIZE, palette: palette.slice(), blocks });
}

/** a .blocks file (untrusted) → { grid, palette } or throws */
export function parse(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('That is not a blocks file.'); }
  if (!j || j.format !== 'staticos-blocks' || !Array.isArray(j.blocks)) throw new Error('That is not a blocks file.');
  const palette = PALETTE.map((p, i) => (Array.isArray(j.palette) && /^#[0-9a-f]{6}$/i.test(j.palette[i]) ? j.palette[i] : p[0]));
  const grid = createGrid();
  for (const b of j.blocks) {
    if (!Array.isArray(b) || b.length < 4 || !b.every(Number.isInteger)) continue;
    const i = idx(b[0], b[1], b[2]);
    if (i >= 0 && b[3] >= 1 && b[3] <= PALETTE.length) grid[i] = b[3];
  }
  return { grid, palette };
}

export default { SIZE, PALETTE, createGrid, idx, inside, count, quads, meshOf, pick, serialize, parse, hexRgb };
