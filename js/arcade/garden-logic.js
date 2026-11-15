/* ============================================================
   arcade/garden-logic.js — the rules and the solver of Gravity Garden.

   A walled garden of squares. Water pours from taps and falls; flowers
   drink what reaches them. You plant seeds and set sunbeams so that
   every flower gets water.

   LEVEL: { name, rows, leaves, suns, par }
     rows    strings: '.' open · '#' stone · 'T' tap · 'F' flower · 'I' ice
     leaves  how many seeds you may plant · suns how many sunbeams you may set
     par     the fewest things (seeds + sunbeams) that water every flower

   WHAT YOU PLACE
     seed     grows at once into a leaf: a solid square, so water landing on it
              runs off to both sides
     sunbeam  sits on an open square and melts every ice square touching it
              (up, down, left, right); a sunbeam square lets water through

   HOW WATER FLOWS (the same rule everywhere, worked out to a fixed point):
     · a tap's square, and a square of melted ice, hold water
     · water in a square falls to the one below if that is open (an open
       square, a sunbeam, a tap square or melted ice); off the bottom edge it
       drains away
     · if what lies below is solid (stone, a leaf, ice that is still frozen)
       the water runs sideways into the open squares to the left and right,
       and from there it falls or runs on by the same rules
     · a flower is watered the moment water falls into it from above or runs
       into it from the side; it drinks it all (the water goes no further)
   Water never rises and never fills a pit: it runs along the top of things.

   solve() tries every way of placing up to your seeds and sunbeams (only
   squares where a sunbeam can matter, next to ice; only squares water can
   reach for a seed) and finds the fewest that water everything, so par is
   exact (the play-tests check it against a plain search over every open square). Pure functions, no DOM: the
   play-tests import this file directly.
   ============================================================ */

/** a level read into what the rules use */
export function parse(level) {
  const rows = level.rows, h = rows.length, w = rows[0].length;
  const cell = new Uint8Array(w * h);                  /* 0 open, 1 stone, 2 tap, 3 flower, 4 ice */
  const flowers = [], taps = [], ice = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const i = y * w + x;
    if (ch === '#') cell[i] = 1;
    else if (ch === 'T') { cell[i] = 2; taps.push(i); }
    else if (ch === 'F') { cell[i] = 3; flowers.push(i); }
    else if (ch === 'I') { cell[i] = 4; ice.push(i); }
  }));
  return { w, h, cell, flowers, taps, ice };
}

/** squares where a seed or a sunbeam may be set: the open ones */
export const isOpen = (P, i) => P.cell[i] === 0;

/**
 * Where the water goes, with `leaves` (a set of squares) and `suns` (a set of squares) placed.
 * -> { wet: Set of squares holding water, watered: Set of flowers drunk, melted: Set of ice squares gone }
 */
export function flow(P, leaves, suns) {
  const { w, h, cell } = P;
  const leaf = new Set(leaves), sun = new Set(suns);
  const melted = new Set();
  for (const i of P.ice) {
    const x = i % w, y = (i - x) / w;
    if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => a >= 0 && b >= 0 && a < w && b < h && sun.has(b * w + a))) melted.add(i);
  }
  const solid = i => cell[i] === 1 || leaf.has(i) || (cell[i] === 4 && !melted.has(i));
  const wet = new Set(), watered = new Set(), todo = [];
  const add = i => { if (!wet.has(i)) { wet.add(i); todo.push(i); } };
  for (const t of P.taps) add(t);
  for (const m of melted) add(m);
  for (let q = 0; q < todo.length; q++) {
    const i = todo[q], x = i % w, y = (i - x) / w;
    const into = j => { if (cell[j] === 3) watered.add(j); else if (!solid(j)) add(j); };
    if (y + 1 >= h) continue;                               /* drains off the bottom */
    const below = i + w;
    if (cell[below] === 3) { watered.add(below); continue; }
    if (!solid(below)) { add(below); continue; }
    if (x > 0) into(i - 1);
    if (x < w - 1) into(i + 1);
  }
  return { wet, watered, melted };
}
export const solved = (P, leaves, suns) => { const r = flow(P, leaves, suns); return P.flowers.every(f => r.watered.has(f)); };

/** squares a sunbeam could matter on: open squares touching ice */
export function sunSpots(P) {
  const out = [];
  for (let i = 0; i < P.cell.length; i++) {
    if (P.cell[i] !== 0) continue;
    const x = i % P.w, y = (i - x) / P.w;
    if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => a >= 0 && b >= 0 && a < P.w && b < P.h && P.cell[b * P.w + a] === 4)) out.push(i);
  }
  return out;
}

/* squares water could ever be in, whatever is placed: reachable from a tap or an ice square by going down, left or right
   through anything that is not stone — a seed anywhere else cannot change where the water goes */
function relevant(P) {
  const seen = new Set(), q = [...P.taps, ...P.ice];
  q.forEach(i => seen.add(i));
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % P.w, y = (i - x) / P.w;
    for (const [a, b] of [[x, y + 1], [x - 1, y], [x + 1, y]]) {
      if (a < 0 || b < 0 || a >= P.w || b >= P.h) continue;
      const j = b * P.w + a;
      if (P.cell[j] !== 1 && !seen.has(j)) { seen.add(j); q.push(j); }
    }
  }
  return seen;
}

function* choose(list, k, from = 0) {
  if (k === 0) { yield []; return; }
  for (let i = from; i <= list.length - k; i++) for (const rest of choose(list, k - 1, i + 1)) yield [list[i], ...rest];
}

/**
 * The fewest things that water every flower: { par, solutions: [{ leaves, suns }, …] (all of that size) } or null.
 * `maxLeaves` / `maxSuns` cap what may be used (default: up to 6 / the sunbeam spots).
 */
export function solve(P, maxLeaves = 6, maxSuns = 3, maxTotal = 6, keep = 12) {
  const rel = relevant(P);
  const opens = []; for (let i = 0; i < P.cell.length; i++) if (P.cell[i] === 0 && rel.has(i)) opens.push(i);
  const spots = sunSpots(P);
  for (let total = 0; total <= maxTotal; total++) {
    const found = [];
    for (let s = 0; s <= Math.min(maxSuns, total); s++) {
      const l = total - s;
      if (l > maxLeaves) continue;
      for (const sunSet of choose(spots, s)) {
        for (const leafSet of choose(opens.filter(i => !sunSet.includes(i)), l)) {
          if (solved(P, leafSet, sunSet)) { found.push({ leaves: leafSet, suns: sunSet }); if (found.length >= keep) break; }
        }
        if (found.length >= keep) break;
      }
      if (found.length >= keep) break;
    }
    if (found.length) return { par: total, solutions: found };
  }
  return null;
}
