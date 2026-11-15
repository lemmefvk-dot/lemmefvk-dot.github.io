/* ============================================================
   arcade/wordladder-logic.js — the rules of Word Ladder, no DOM.

   A ladder goes from a start word to a target word of the same
   length, changing exactly one letter at each step, every step a
   real word. The words come from the Arcade's own list (words.js,
   data/words/en.txt): steps may use the everyday and the familiar
   words (tiers 1 and 2); pairs are chosen from the everyday ones.
   The par of a pair is the length of its shortest ladder, found by
   breadth-first search — so a pair is only ever dealt when a ladder
   exists (makePair checks it, and the test suite checks every daily
   pair for months ahead).

   ladder(lex, len) -> { words: [...], has(w), next(w) -> neighbours }
   ============================================================ */
import { rng } from './kit.js';
import { hash32 } from './challenge.js';

export const LENGTHS = [3, 4, 5];
export const DAILY_LENGTH = 4;
/* the par a dealt pair may have, by word length */
export const SPAN = { 3: [3, 5], 4: [4, 7], 5: [4, 7] };
const cache = new WeakMap();

/** the word graph of one length: every tier 1–2 word, and who is one letter away from whom */
export function ladder(lex, len) {
  let per = cache.get(lex);
  if (!per) { per = {}; cache.set(lex, per); }
  if (per[len]) return per[len];
  const words = [];
  for (const t of [1, 2]) for (const w of lex.byTier[t]) if (w.length === len) words.push(w);
  words.sort();
  const set = new Set(words), buckets = new Map();
  for (const w of words) for (let i = 0; i < len; i++) {
    const key = w.slice(0, i) + '_' + w.slice(i + 1);
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push(w);
  }
  const nb = new Map();
  const next = w => {
    let r = nb.get(w);
    if (r) return r;
    r = [];
    for (let i = 0; i < len; i++) for (const o of buckets.get(w.slice(0, i) + '_' + w.slice(i + 1)) || []) if (o !== w) r.push(o);
    nb.set(w, r);
    return r;
  };
  return (per[len] = { len, words, has: w => set.has(w), next, tier: w => lex.tier(w) });
}

/** the shortest ladder from a to b (both included), or null */
export function shortest(L, a, b) {
  if (!L.has(a) || !L.has(b)) return null;
  if (a === b) return [a];
  const prev = new Map([[a, null]]);
  const q = [a];
  for (let h = 0; h < q.length; h++) {
    const w = q[h];
    for (const o of L.next(w)) {
      if (prev.has(o)) continue;
      prev.set(o, w);
      if (o === b) { const path = []; for (let x = b; x !== null; x = prev.get(x)) path.push(x); return path.reverse(); }
      q.push(o);
    }
  }
  return null;
}

/** how far every word reachable from `a` is, in steps: Map word -> steps */
export function distances(L, a) {
  const d = new Map([[a, 0]]);
  const q = [a];
  for (let h = 0; h < q.length; h++) for (const o of L.next(q[h])) if (!d.has(o)) { d.set(o, d.get(q[h]) + 1); q.push(o); }
  return d;
}

/** can this word follow `cur`? exactly one letter changed, and it is on the list */
export const isStep = (L, cur, w) => w.length === cur.length && L.has(w) && L.next(cur).includes(w);

/** a pair for `seed`: { from, to, par, path } — the same on every device with the same list */
export function makePair(lex, len, seed) {
  const L = ladder(lex, len);
  const [lo, hi] = SPAN[len] || [4, 7];
  const everyday = L.words.filter(w => L.tier(w) === 1 && L.next(w).length >= 2);
  if (!everyday.length) return null;
  const r = rng(seed >>> 0);
  let fallback = null;
  for (let tries = 0; tries < 60; tries++) {
    const from = everyday[(r() * everyday.length) | 0];
    const d = distances(L, from);
    const far = [];
    for (const [w, k] of d) if (k >= lo && k <= hi && L.tier(w) === 1) far.push(w);
    if (far.length) {
      far.sort();
      const to = far[(r() * far.length) | 0];
      const path = shortest(L, from, to);
      if (path) return { from, to, par: path.length - 1, path };
    }
    if (!fallback) {
      let best = null;
      for (const [w, k] of d) if (L.tier(w) === 1 && k >= 3 && (!best || k > best[1] || (k === best[1] && w < best[0]))) best = [w, k];
      if (best) fallback = { from, to: best[0], par: best[1], path: shortest(L, from, best[0]) };
    }
  }
  return fallback;
}

export const dailyPair = (lex, seed) => makePair(lex, DAILY_LENGTH, seed);
export const seedOfPair = (len, n) => hash32(`staticos-wordladder:${len}:${n}`);

export default { LENGTHS, DAILY_LENGTH, ladder, shortest, distances, isStep, makePair, dailyPair };
