/* ============================================================
   arcade/railswitch-logic.js — the rules of Rail Switch, no DOM.

   A level is a little rail network. Trains leave the depot one at
   a time, in a fixed order and colours, and roll forwards through
   JUNCTIONS to a STATION at the end. Every junction has one way in
   and two ways out, and sits on one of them; a train follows the
   way it is set. A coloured train must reach a station of its own
   colour; any other station is a crash.
   · You may flip a junction by hand before any train leaves; every
     flip counts as one move.
   · An AUTOMATIC junction can't be flipped by hand: it swaps to its
     other way by itself after each train that passes through it.
   The settings carry over from one train to the next.

   A level: { layers, nodes: [{ id, layer, row, kind: 'junction'|
   'station', outs: [a, b] (junctions), color (stations), auto }],
   first (the junction a train enters first), init (a bit per
   junction: which way it starts), trains: [colour…], par }.
   Junction bit k belongs to junctions[k]. Colours are 0, 1, 2.

   The par is the fewest flips that deliver every train, found
   exactly by dynamic programming over every setting of the
   junctions (solve()): after each train the settings are known, so
   the cheapest way to the next train's setting is a Hamming
   distance. Levels are made from a seeded generator (makeLevel(i)):
   a triangular network, random wiring directions, automatic
   junctions and train orders, kept only when solvable with a par
   worth having. The test suite solves all twelve.
   ============================================================ */
import { rng } from './kit.js';

export const LEVELS = 12;
const hash = (a, b) => (Math.imul(a + 1, 73856093) ^ Math.imul(b + 7, 19349663) ^ 0x51ed270b) >>> 0;
const pop = n => { let c = 0; for (; n; n &= n - 1) c++; return c; };

/** the network of a level shape: depth D (junction layers), each layer ℓ has ℓ+1 junctions; stations after the last */
function network(depth, r, colorsN) {
  const nodes = [];
  const layerSize = l => l + 1;                          /* layers 0..depth-1 junctions, layer depth = stations */
  for (let l = 0; l <= depth; l++) for (let row = 0; row < layerSize(l); row++) nodes.push({ id: nodes.length, layer: l, row });
  const at = (l, row) => nodes.find(n => n.layer === l && n.row === row).id;
  for (const n of nodes) {
    if (n.layer < depth) {
      n.kind = 'junction';
      const a = at(n.layer + 1, n.row), b = at(n.layer + 1, n.row + 1);
      n.outs = r() < 0.5 ? [a, b] : [b, a];
    } else n.kind = 'station';
  }
  /* station colours: every colour on at least one station */
  const st = nodes.filter(n => n.kind === 'station');
  const colors = st.map((_, k) => k % colorsN);
  for (let k = colors.length - 1; k > 0; k--) { const j = (r() * (k + 1)) | 0; [colors[k], colors[j]] = [colors[j], colors[k]]; }
  st.forEach((n, k) => { n.color = colors[k]; });
  return nodes;
}

export const junctionsOf = L => L.nodes.filter(n => n.kind === 'junction');

/** where a train goes from the settings `mask`: { station (node id), path: [node ids], flips: bitmask of the automatic junctions it passed } */
export function route(L, mask) {
  const js = junctionsOf(L), bit = new Map(js.map((n, k) => [n.id, k]));
  let id = L.first, flips = 0;
  const path = [id];
  for (let guard = 0; guard < 40; guard++) {
    const n = L.nodes[id];
    if (n.kind === 'station') return { station: id, path, flips };
    const k = bit.get(id);
    if (n.auto) flips |= 1 << k;
    id = n.outs[(mask >> k) & 1];
    path.push(id);
  }
  return { station: -1, path, flips };
}

/** the fewest hand flips that deliver every train: { par, plan: [mask before each train] } or null */
export function solve(L) {
  const js = junctionsOf(L), K = js.length, M = 1 << K;
  const autoMask = js.reduce((a, n, k) => a | (n.auto ? 1 << k : 0), 0);
  const info = [];
  for (let m = 0; m < M; m++) { const r = route(L, m); info.push({ color: L.nodes[r.station]?.color ?? -1, flips: r.flips }); }
  const INF = 1e9;
  let dp = new Array(M).fill(INF), from = [];
  dp[L.init] = 0;
  for (let t = 0; t < L.trains.length; t++) {
    const next = new Array(M).fill(INF), back = new Array(M).fill(-1);
    for (let pm = 0; pm < M; pm++) {
      if (dp[pm] >= INF) continue;
      for (let p = 0; p < M; p++) {
        if (info[p].color !== L.trains[t] || ((p ^ pm) & autoMask)) continue;
        const cost = dp[pm] + pop(p ^ pm), after = p ^ info[p].flips;
        if (cost < next[after]) { next[after] = cost; back[after] = pm * M + p; }
      }
    }
    from.push(back);
    dp = next;
  }
  let best = INF, at = -1;
  for (let m = 0; m < M; m++) if (dp[m] < best) { best = dp[m]; at = m; }
  if (best >= INF) return null;
  const plan = [];
  for (let t = L.trains.length - 1; t >= 0; t--) { const b = from[t][at]; plan.unshift(b % M); at = Math.floor(b / M); }
  return { par: best, plan };
}

function attempt(i, n) {
  const r = rng(hash(i, n));
  const depth = i < 3 ? 2 : i < 8 ? 3 : 4;
  const colorsN = i < 5 ? 2 : 3;
  const nodes = network(depth, r, colorsN);
  const js = nodes.filter(x => x.kind === 'junction');
  const autos = i < 2 ? 0 : Math.min(js.length - 1, 1 + (i >> 2));
  const order = js.map((_, k) => k);
  for (let k = order.length - 1; k > 0; k--) { const j = (r() * (k + 1)) | 0; [order[k], order[j]] = [order[j], order[k]]; }
  for (let k = 0; k < autos; k++) js[order[k]].auto = true;
  const present = [...new Set(nodes.filter(x => x.kind === 'station').map(x => x.color))];
  const count = Math.min(8, 3 + (i >> 1));
  const trains = Array.from({ length: count }, () => present[(r() * present.length) | 0]);
  let init = 0;
  for (let k = 0; k < js.length; k++) if (r() < 0.5) init |= 1 << k;
  return { layers: depth + 1, nodes, first: 0, init, trains, colors: colorsN };
}

const cache = new Map();
/** level i (0..11) — the same on every device */
export function makeLevel(i) {
  i = Math.max(0, Math.min(LEVELS - 1, i | 0));
  if (cache.has(i)) return cache.get(i);
  const want = 2 + (i >> 1);
  let pick = null;
  for (let n = 0; n < 600 && !(pick && pick.par >= want); n++) {
    const L = attempt(i, n);
    const s = solve(L);
    if (!s) continue;
    L.par = s.par;
    if (!pick || s.par > pick.par) pick = L;
  }
  cache.set(i, pick);
  return pick;
}

export default { LEVELS, makeLevel, solve, route, junctionsOf };
