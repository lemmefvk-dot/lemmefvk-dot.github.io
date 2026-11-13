/* ============================================================
   drills/sched.js — what to ask next, and what the record says.

   Pure functions, no DOM and no storage, so the maths of "weak things
   come up more often" can be unit-tested and read in one place. Every
   number here comes from attempts that really happened; nothing is
   estimated for something that was never tried.

   A stat is { n, ok, ms, nm }: attempts, correct answers, and the total
   time of the correct answers that were timed (nm of them).
   ============================================================ */

/* a small seeded generator, for tests and repeatable runs */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SLOW_FROM = 3000;       /* ms: an answer slower than this starts to count as slow */
export const SLOW_TO = 9000;         /* ms: and from here it counts as fully slow */
export const MAX_MS = 30000;         /* a longer pause was a break, not thinking: it is not a speed */

/** Average time of the correct, timed answers, or null if there are none. */
export const avgMs = st => (st && st.nm > 0 ? st.ms / st.nm : null);
/** Share answered correctly (0–1), or null if never tried. */
export const accuracy = st => (st && st.n > 0 ? st.ok / st.n : null);

/** Add one attempt. ms may be null (an untimed answer, or a pause that was a break). */
export function record(st, ok, ms) {
  const o = { n: 0, ok: 0, ms: 0, nm: 0, ...(st || {}) };
  o.n++;
  if (ok) o.ok++;
  if (ok && Number.isFinite(ms) && ms > 0 && ms <= MAX_MS) { o.ms += ms; o.nm++; }
  return o;
}

/** How likely a fact is to be asked, relative to others: 0.4 for one that is
    always right and quick, up to about 7.9 for one that is always missed and slow;
    a fact never asked is 1.5, so new things still turn up but mastered ones come last. */
export function factWeight(st) {
  if (!st || !st.n) return 1.5;
  const miss = (st.n - st.ok) / st.n;
  const s = avgMs(st);
  const slow = s == null ? 0 : Math.max(0, Math.min(1, (s - SLOW_FROM) / (SLOW_TO - SLOW_FROM))) * 1.5;
  return 0.4 + 6 * miss + slow;
}

/** Pick one of `items` with chance proportional to weightOf(item). `avoid` is not
    repeated straight away unless it is the only choice. */
export function pickWeighted(items, weightOf, rng = Math.random, avoid) {
  const list = items.length > 1 && avoid !== undefined ? items.filter(x => x !== avoid) : items;
  if (!list.length) return undefined;
  let total = 0;
  const ws = list.map(x => { const w = Math.max(0.0001, Number(weightOf(x)) || 0); total += w; return w; });
  let r = rng() * total;
  for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r < 0) return list[i]; }
  return list[list.length - 1];
}

/* ---- the last few results of one thing (letters, countries): a string of 1s and 0s ---- */
export const RECENT = 8;
export const addRecent = (r, ok) => (String(r || '') + (ok ? '1' : '0')).slice(-RECENT);
export function recentWeight(r) {
  const s = String(r || '');
  if (!s) return 2;
  const miss = (s.length - [...s].filter(c => c === '1').length) / s.length;
  return 0.4 + 6 * miss;
}
/** Known when it has been tried at least 4 times lately and 75% or more were right. */
export const isKnown = r => { const s = String(r || ''); return s.length >= 4 && [...s].filter(c => c === '1').length / s.length >= 0.75; };

/* ---- spelling: boxes (a Leitner system with five steps) ----
   A right answer moves the word up a box, a wrong one back to the start. */
export const BOXES = 5;
const BOX_WEIGHT = [6, 4, 2.5, 1.5, 0.8, 0.4];
export function spellGrade(st, ok, turn) {
  const o = { box: 0, n: 0, miss: 0, last: -1, lastOk: null, ...(st || {}) };
  o.n++;
  if (ok) o.box = Math.min(BOXES, o.box + 1); else { o.box = 0; o.miss++; }
  o.lastOk = !!ok;
  o.last = turn;
  return o;
}
/** Words never asked weigh 2; a missed word weighs most, and more again if the last try was wrong. */
export function spellWeight(st) {
  if (!st || !st.n) return 2;
  return BOX_WEIGHT[Math.max(0, Math.min(BOXES, st.box))] + (st.lastOk === false ? 3 : 0);
}

/** Choose a round of words, missed ones the likeliest. No word twice in one round. */
export function pickRound(words, stats, count, rng) {
  const left = [...words];
  const out = [];
  while (out.length < count && left.length) {
    const w = pickWeighted(left, x => spellWeight(stats[x.toLowerCase()]), rng);
    out.push(w);
    left.splice(left.indexOf(w), 1);
  }
  return out;
}
