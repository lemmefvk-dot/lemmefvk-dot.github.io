/* ============================================================
   arcade/mahjong-rules.js — Mahjong Solitaire's layouts, tiles,
   rules and dealer. Pure (no DOM), shared by ./mahjong.js and the
   play-tests.

   A position is { x, y, z } in half-tile units (a tile is 2 × 2),
   so two tiles side by side are 2 apart and a tile on a layer above
   sits over the ones it overlaps (|dx| < 2 and |dy| < 2).

   FREE. A tile can be picked when nothing lies on top of it (any
   tile one layer up, or higher, that overlaps it) and its left side
   or its right side is open (no tile on the same layer exactly one
   tile to that side, with |dy| < 2).

   FACES. 0–8 Coins, 9–17 Sticks, 18–26 Leaves (nine of each, four
   copies), 27–30 Winds, 31–33 Dragons (four copies), 34–37 Flowers
   and 38–41 Seasons (one of each). Equal faces match; any flower
   matches any flower and any season any season (matchKey).

   EVERY DEAL IS SOLVABLE. deal() works backwards from the finished
   board: it removes pairs of tiles that are free at that moment,
   giving each pair matching faces, until the layout is empty. Played
   in that order the deal always clears, so `order` (the pairs as
   tile indexes, first move first) is a proof. When a try gets stuck
   (the last two tiles stacked on each other) it starts again.
   ============================================================ */
const grid = (layer, cols, rows) => {
  const out = [];
  for (const [r, [c0, c1]] of Object.entries(rows)) for (let c = c0; c <= c1; c++) out.push({ x: c * 2, y: Number(r) * 2, z: layer });
  return out;
};
const block = (z, c0, c1, r0, r1) => {
  const o = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) o.push({ x: c * 2, y: r * 2, z });
  return o;
};

function turtle() {
  const rows = { 0: [1, 12], 1: [3, 10], 2: [2, 11], 3: [1, 12], 4: [1, 12], 5: [2, 11], 6: [3, 10], 7: [1, 12] };
  return [
    ...grid(0, 0, rows),
    { x: 0, y: 7, z: 0 }, { x: 26, y: 7, z: 0 }, { x: 28, y: 7, z: 0 },
    ...block(1, 4, 9, 1, 6), ...block(2, 5, 8, 2, 5), ...block(3, 6, 7, 3, 4),
    { x: 13, y: 7, z: 4 },
  ];
}
function pyramid() {
  return [...block(0, 0, 11, 0, 5), ...block(1, 1, 10, 1, 4), ...block(2, 2, 9, 2, 3), ...block(3, 4, 7, 2, 3)];
}
function fortress() {
  /* two towers joined by a low wall */
  const tower = (c0) => [...block(0, c0, c0 + 2, 0, 5), ...block(1, c0, c0 + 2, 1, 4), ...block(2, c0 + 0, c0 + 2, 2, 3)];
  return [...tower(0), ...tower(9), ...block(0, 3, 8, 2, 3), ...block(1, 3, 8, 2, 3), ...block(0, 3, 8, 0, 0), ...block(0, 3, 8, 5, 5)];
}

export const LAYOUTS = {
  turtle: { name: 'Turtle', blurb: 'The classic: 144 tiles', make: turtle },
  pyramid: { name: 'Pyramid', blurb: 'A stepped hill: 136 tiles', make: pyramid },
  fortress: { name: 'Fortress', blurb: 'Two towers and a wall', make: fortress },
};
export const layoutIds = Object.keys(LAYOUTS);

export const COINS = 0, STICKS = 9, LEAVES = 18, WINDS = 27, DRAGONS = 31, FLOWERS = 34, SEASONS = 38, FACES = 42;
/** tiles that match each other share a key */
export const matchKey = f => (f >= SEASONS ? 'S' : f >= FLOWERS ? 'F' : f);
export const matches = (a, b) => matchKey(a) === matchKey(b);
const faceMatch = matches;

/** the 72 pairs of a full set: two of each plain face, two flower pairs, two season pairs */
export function pairPool() {
  const out = [];
  for (let f = 0; f < FLOWERS; f++) out.push([f, f], [f, f]);
  out.push([34, 35], [36, 37], [38, 39], [40, 41]);
  return out;
}

/* a mulberry32 stream */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (a, rand) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** tiles: [{x,y,z}], gone: Uint8Array/Set-like by index. Is tile i free? */
export function isFree(tiles, i, gone) {
  const t = tiles[i];
  let left = false, right = false;
  for (let j = 0; j < tiles.length; j++) {
    if (j === i || gone[j]) continue;
    const o = tiles[j];
    const dy = Math.abs(o.y - t.y);
    if (dy >= 2) continue;
    const dx = o.x - t.x;
    if (o.z > t.z && Math.abs(dx) < 2) return false;
    if (o.z === t.z) { if (dx === -2) left = true; else if (dx === 2) right = true; }
  }
  return !(left && right);
}
export const freeList = (tiles, gone) => { const out = []; for (let i = 0; i < tiles.length; i++) if (!gone[i] && isFree(tiles, i, gone)) out.push(i); return out; };

/** every free matching pair [i, j] (i < j) among the tiles that are left */
export function availablePairs(tiles, faces, gone) {
  const fr = freeList(tiles, gone), out = [];
  for (let a = 0; a < fr.length; a++) for (let b = a + 1; b < fr.length; b++) if (faceMatch(faces[fr[a]], faces[fr[b]])) out.push([fr[a], fr[b]]);
  return out;
}

/**
 * Deal a solvable board. `positions` default to the layout's; `pairs` is the pool of face pairs to use
 * (default: a random half of the full set sized to fit). Returns { tiles, faces, order } or null.
 */
export function dealOn(tiles, pairs, seed) {
  const rand = rng(seed);
  const n = tiles.length;
  for (let attempt = 0; attempt < 400; attempt++) {
    const gone = new Uint8Array(n);
    const faces = new Array(n).fill(-1);
    const order = [];
    const pool = shuffle(pairs.slice(), rand);
    let left = n, ok = true;
    for (let k = 0; left > 0; k++) {
      const fr = freeList(tiles, gone);
      if (fr.length < 2) { ok = false; break; }
      /* prefer pairs whose removal leaves the board with free tiles to continue */
      let a = fr[Math.floor(rand() * fr.length)], b;
      do { b = fr[Math.floor(rand() * fr.length)]; } while (b === a);
      const [fa, fb] = pool[k];
      faces[a] = fa; faces[b] = fb;
      gone[a] = gone[b] = 1;
      order.push([a, b]);
      left -= 2;
    }
    if (ok) return { tiles, faces, order };
  }
  return null;
}
export function deal(layoutId, seed) {
  const tiles = LAYOUTS[layoutId].make();
  const rand = rng(seed ^ 0x9e3779b9);
  const pool = shuffle(pairPool(), rand).slice(0, tiles.length / 2);
  return dealOn(tiles, pool, seed);
}

/** turn the faces left on the board back into pairs (for a shuffle) */
export function pairsOf(faces, gone) {
  const by = new Map();
  faces.forEach((f, i) => { if (!gone[i]) { const k = matchKey(f); (by.get(k) || by.set(k, []).get(k)).push(f); } });
  const out = [];
  for (const list of by.values()) for (let i = 0; i + 1 < list.length; i += 2) out.push([list[i], list[i + 1]]);
  return out;
}
/** re-deal the tiles still on the board so that they can be cleared */
export function reshuffle(tiles, faces, gone, seed) {
  const idx = [];
  tiles.forEach((_, i) => { if (!gone[i]) idx.push(i); });
  const sub = idx.map(i => tiles[i]);
  const d = dealOn(sub, pairsOf(faces, gone), seed);
  if (!d) return null;
  const nf = faces.slice();
  idx.forEach((i, k) => { nf[i] = d.faces[k]; });
  return { faces: nf, order: d.order.map(([a, b]) => [idx[a], idx[b]]) };
}

/** can this position be cleared? A depth-first search with a node limit (null: undecided) */
export function solve(tiles, faces, gone, limit = 40000) {
  const g = Uint8Array.from(gone);
  const seen = new Set();
  let nodes = 0;
  const path = [];
  const key = () => g.join('');
  function dfs() {
    if (g.every(Boolean)) return true;
    if (++nodes > limit) return null;
    const k = key();
    if (seen.has(k)) return false;
    const prs = availablePairs(tiles, faces, g);
    for (const [a, b] of prs) {
      g[a] = g[b] = 1; path.push([a, b]);
      const r = dfs();
      if (r) return true;
      g[a] = g[b] = 0; path.pop();
      if (r === null) return null;
    }
    seen.add(k);
    return false;
  }
  return dfs() ? path.slice() : null;
}
