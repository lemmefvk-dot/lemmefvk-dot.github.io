/* ============================================================
   sorts.js — sorting algorithms as step-by-step generators, for the
   visualiser. No DOM; unit-tested.

   Each algorithm is a generator over an array it sorts in place. It
   yields one event per thing it does:
     { t: 'cmp', i, j }   compared a[i] with a[j]
     { t: 'swap', i, j }  swapped them
     { t: 'set', i }      wrote a value to a[i] (merge sort's merge)
   Nothing is counted by hand: the counters shown are tallies of the
   events a run really produced.
   ============================================================ */

function* bubble(a) {
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let j = 0; j < n - i - 1; j++) {
      yield { t: 'cmp', i: j, j: j + 1 };
      if (a[j] > a[j + 1]) { [a[j], a[j + 1]] = [a[j + 1], a[j]]; swapped = true; yield { t: 'swap', i: j, j: j + 1 }; }
    }
    if (!swapped) break;
  }
}
function* insertion(a) {
  for (let i = 1; i < a.length; i++) {
    for (let j = i; j > 0; j--) {
      yield { t: 'cmp', i: j - 1, j };
      if (a[j - 1] <= a[j]) break;
      [a[j - 1], a[j]] = [a[j], a[j - 1]];
      yield { t: 'swap', i: j - 1, j };
    }
  }
}
function* selection(a) {
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let m = i;
    for (let j = i + 1; j < n; j++) { yield { t: 'cmp', i: m, j }; if (a[j] < a[m]) m = j; }
    if (m !== i) { [a[i], a[m]] = [a[m], a[i]]; yield { t: 'swap', i, j: m }; }
  }
}
function* merge(a, lo = 0, hi = a.length) {
  if (hi - lo < 2) return;
  const mid = (lo + hi) >> 1;
  yield* merge(a, lo, mid);
  yield* merge(a, mid, hi);
  const left = a.slice(lo, mid), right = a.slice(mid, hi);
  let i = 0, j = 0, k = lo;
  while (i < left.length && j < right.length) {
    yield { t: 'cmp', i: lo + i, j: mid + j };
    if (left[i] <= right[j]) a[k++] = left[i++]; else a[k++] = right[j++];
    yield { t: 'set', i: k - 1 };
  }
  while (i < left.length) { a[k++] = left[i++]; yield { t: 'set', i: k - 1 }; }
  while (j < right.length) { a[k++] = right[j++]; yield { t: 'set', i: k - 1 }; }
}
function* quick(a, lo = 0, hi = a.length - 1) {
  if (lo >= hi) return;
  const p = hi;                                   /* Lomuto partition, last item as the pivot */
  let s = lo;
  for (let j = lo; j < hi; j++) {
    yield { t: 'cmp', i: j, j: p };
    if (a[j] < a[p]) { if (s !== j) { [a[s], a[j]] = [a[j], a[s]]; yield { t: 'swap', i: s, j }; } s++; }
  }
  if (s !== p) { [a[s], a[p]] = [a[p], a[s]]; yield { t: 'swap', i: s, j: p }; }
  yield* quick(a, lo, s - 1);
  yield* quick(a, s + 1, hi);
}
function* heap(a) {
  const n = a.length;
  function* sift(i, size) {
    for (;;) {
      let m = i;
      const l = 2 * i + 1, r = l + 1;
      if (l < size) { yield { t: 'cmp', i: l, j: m }; if (a[l] > a[m]) m = l; }
      if (r < size) { yield { t: 'cmp', i: r, j: m }; if (a[r] > a[m]) m = r; }
      if (m === i) return;
      [a[i], a[m]] = [a[m], a[i]]; yield { t: 'swap', i, j: m };
      i = m;
    }
  }
  for (let i = (n >> 1) - 1; i >= 0; i--) yield* sift(i, n);
  for (let end = n - 1; end > 0; end--) { [a[0], a[end]] = [a[end], a[0]]; yield { t: 'swap', i: 0, j: end }; yield* sift(0, end); }
}

/* what the textbook says; shown as theory, never as a measurement */
export const ALGORITHMS = {
  bubble: { name: 'Bubble sort', run: bubble, best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', note: 'Swaps neighbours that are out of order; stops after a pass with no swaps.' },
  insertion: { name: 'Insertion sort', run: insertion, best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', note: 'Slides each item back to where it belongs among those before it.' },
  selection: { name: 'Selection sort', run: selection, best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)', note: 'Finds the smallest of what is left and puts it next.' },
  merge: { name: 'Merge sort', run: merge, best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', note: 'Sorts each half, then merges the halves. Writes values back instead of swapping.' },
  quick: { name: 'Quicksort', run: quick, best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n²)', note: 'Splits around a pivot (here the last item), then sorts each side.' },
  heap: { name: 'Heapsort', run: heap, best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', note: 'Builds a max-heap, then keeps taking the biggest off the end.' },
};

/** Run to the end; returns the tallies. Sorts `a` in place. */
export function runAll(name, a) {
  const c = { cmp: 0, swap: 0, set: 0 };
  for (const ev of ALGORITHMS[name].run(a)) c[ev.t]++;
  return c;
}

/** A starting array of n heights in the chosen order. */
export function makeData(n, kind = 'random', rnd = Math.random) {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  if (kind === 'sorted') return a;
  if (kind === 'reversed') return a.reverse();
  if (kind === 'nearly') { for (let k = 0; k < Math.max(1, n >> 4); k++) { const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  if (kind === 'few') return shuffle(a.map(v => Math.ceil(v / (n / 5))));
  return shuffle(a);
}
