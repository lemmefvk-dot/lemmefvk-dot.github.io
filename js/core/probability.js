/* ============================================================
   probability.js — dice, coins and spinners with real tallies.
   No DOM; unit-tested.

   Every number in a tally comes from a roll this file actually made
   with `rand()` (Math.random by default). The theoretical values are
   worked out exactly from the setup (counting outcomes, not
   simulating), and are labelled as theory wherever they are shown.
   ============================================================ */

/** A whole number 0..n-1 from the random source. */
export const randInt = (n, rand = Math.random) => Math.min(n - 1, Math.floor(rand() * n));

/** A setup is { kind: 'dice', dice, sides } | { kind: 'coins', coins } |
    { kind: 'spinner', weights: [..], names: [..] }. The outcomes it can
    land on, in order, as labels. */
export function outcomes(s) {
  if (s.kind === 'dice') return Array.from({ length: s.dice * s.sides - s.dice + 1 }, (_, i) => String(i + s.dice));
  if (s.kind === 'coins') return Array.from({ length: s.coins + 1 }, (_, i) => String(i));
  return s.names.map((n, i) => n || `Sector ${i + 1}`);
}

/** One roll: the index into outcomes(s). Dice are the sum of all the dice;
    coins count heads. */
export function roll(s, rand = Math.random) {
  if (s.kind === 'dice') { let t = 0; for (let i = 0; i < s.dice; i++) t += randInt(s.sides, rand) + 1; return t - s.dice; }
  if (s.kind === 'coins') { let t = 0; for (let i = 0; i < s.coins; i++) t += randInt(2, rand); return t; }
  const total = s.weights.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < s.weights.length; i++) { x -= s.weights[i]; if (x < 0) return i; }
  return s.weights.length - 1;
}

/** The exact chance of each outcome, by counting. */
export function theory(s) {
  if (s.kind === 'spinner') { const t = s.weights.reduce((a, b) => a + b, 0); return s.weights.map(w => w / t); }
  if (s.kind === 'coins') {
    const n = s.coins; let c = 1; const out = [];
    for (let k = 0; k <= n; k++) { out.push(c / 2 ** n); c = c * (n - k) / (k + 1); }
    return out;
  }
  let dist = [1];                                  /* ways to make each sum, built one die at a time */
  for (let d = 0; d < s.dice; d++) {
    const next = new Array(dist.length + s.sides - 1).fill(0);
    dist.forEach((w, i) => { for (let f = 0; f < s.sides; f++) next[i + f] += w; });
    dist = next;
  }
  const all = s.sides ** s.dice;
  return dist.map(w => w / all);
}

/** A tally of rolls: counts per outcome and the total. */
export function makeTally(n) { return { counts: new Array(n).fill(0), total: 0, last: [] }; }
export function record(t, idx) { t.counts[idx]++; t.total++; t.last.push(idx); if (t.last.length > 20) t.last.shift(); }
