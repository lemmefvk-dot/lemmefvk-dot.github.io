/* ============================================================
   arcade/stars.js — the Daily Stars puzzle: one a day, made from
   the date, the same on every device.

   THE PUZZLE (a one-star "Star Battle"): an n×n grid split into n
   coloured regions. Place n stars so every row, every column and
   every region holds exactly one, and no two stars touch — not even
   at a corner.

   ONE A DAY. The local date ('2026-11-16') is hashed into a seed for
   a small PRNG, and everything after that is arithmetic on it, so
   the same date gives the same puzzle in every browser and nothing
   is fetched or sent. Size follows the weekday: 7×7 Monday and
   Tuesday, 8×8 Wednesday to Friday, 9×9 at the weekend.

   SOLVABLE, AND ONE ANSWER. A star layout is placed first (one per
   row and column, none touching), then regions grow outward from its
   stars, so that layout is always an answer. A solver then looks
   for a second answer; while one exists, a cell that the second
   answer uses (never one of the first answer's stars) moves to a
   neighbouring region, which breaks that answer. This repeats until
   the solver finds exactly one, re-trying from the next seeded
   layout if a region would split. generate() reports `unique`, and
   the play-tests check it. The game accepts ANY placement that keeps
   the rules, so it can never reject a right answer.
   ============================================================ */
const SIZE_BY_WEEKDAY = [9, 7, 7, 8, 8, 8, 9];          /* Sun … Sat */
/* one hue per region, far apart (the game and the Arcade's home card share them) */
export const REGION_HUES = [8, 205, 46, 280, 140, 330, 96, 232, 176];

export const pad2 = n => String(n).padStart(2, '0');
/** the local date as 'YYYY-MM-DD' */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const isDayKey = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export function parseDay(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export const addDays = (key, n) => { const d = parseDay(key); d.setDate(d.getDate() + n); return dayKey(d); };
export const sizeFor = key => SIZE_BY_WEEKDAY[parseDay(key).getDay()];

/* FNV-1a, then a mulberry32 stream */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, n) => Math.floor(rnd() * n);
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = pick(rnd, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* one star per row and column, no two touching (rows next to each other differ by 2+ columns) */
function placeStars(n, rnd) {
  const col = new Int8Array(n).fill(-1), used = new Uint8Array(n);
  const go = r => {
    if (r === n) return true;
    for (const c of shuffle([...Array(n).keys()], rnd)) {
      if (used[c] || (r && Math.abs(c - col[r - 1]) < 2)) continue;
      col[r] = c; used[c] = 1;
      if (go(r + 1)) return true;
      used[c] = 0;
    }
    col[r] = -1;
    return false;
  };
  return go(0) ? col : null;
}

const NB4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/* every cell joins a region grown from one of the stars */
function growRegions(n, stars, rnd) {
  const reg = new Int8Array(n * n).fill(-1);
  for (let r = 0; r < n; r++) reg[r * n + stars[r]] = r;
  let left = n * n - n;
  while (left > 0) {
    /* a random unassigned cell next to a region joins one of its neighbours */
    const edge = [];
    for (let i = 0; i < n * n; i++) {
      if (reg[i] >= 0) continue;
      const r = Math.floor(i / n), c = i % n;
      for (const [dr, dc] of NB4) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && reg[rr * n + cc] >= 0) { edge.push(i); break; }
      }
    }
    const i = edge[pick(rnd, edge.length)];
    const r = Math.floor(i / n), c = i % n;
    const opts = [];
    for (const [dr, dc] of NB4) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && reg[rr * n + cc] >= 0) opts.push(reg[rr * n + cc]);
    }
    reg[i] = opts[pick(rnd, opts.length)];
    left--;
  }
  return reg;
}

/** up to `limit` answers, each the star's column per row */
export function solve(n, reg, limit = 2) {
  const out = [], col = new Int8Array(n), usedC = new Uint8Array(n), usedR = new Uint8Array(n);
  const go = r => {
    if (out.length >= limit) return;
    if (r === n) { out.push(col.slice()); return; }
    for (let c = 0; c < n; c++) {
      const g = reg[r * n + c];
      if (usedC[c] || usedR[g] || (r && Math.abs(c - col[r - 1]) < 2)) continue;
      col[r] = c; usedC[c] = 1; usedR[g] = 1;
      go(r + 1);
      usedC[c] = 0; usedR[g] = 0;
      if (out.length >= limit) return;
    }
  };
  go(0);
  return out;
}

/* is region g still in one piece without cell `skip`? */
function connected(n, reg, g, skip) {
  const cells = [];
  for (let i = 0; i < n * n; i++) if (reg[i] === g && i !== skip) cells.push(i);
  if (!cells.length) return false;
  const seen = new Set([cells[0]]), todo = [cells[0]];
  while (todo.length) {
    const i = todo.pop(), r = Math.floor(i / n), c = i % n;
    for (const [dr, dc] of NB4) {
      const rr = r + dr, cc = c + dc, j = rr * n + cc;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n || j === skip || reg[j] !== g || seen.has(j)) continue;
      seen.add(j); todo.push(j);
    }
  }
  return seen.size === cells.length;
}

/* move cells until the stars are the only answer; false if a region would split */
function makeUnique(n, reg, stars, rnd) {
  for (let round = 0; round < 80; round++) {
    const sols = solve(n, reg, 2);
    if (sols.length === 1) return true;
    const alt = sols.find(s => s.some((c, r) => c !== stars[r]));
    if (!alt) return true;
    const cand = shuffle([...Array(n).keys()].filter(r => alt[r] !== stars[r]).map(r => r * n + alt[r]), rnd);
    let moved = false;
    for (const q of cand) {
      const r = Math.floor(q / n), c = q % n, from = reg[q];
      if (!connected(n, reg, from, q)) continue;
      const to = shuffle(NB4.map(([dr, dc]) => [r + dr, c + dc]).filter(([rr, cc]) => rr >= 0 && rr < n && cc >= 0 && cc < n)
        .map(([rr, cc]) => reg[rr * n + cc]).filter(g => g !== from), rnd);
      if (!to.length) continue;
      reg[q] = to[0];
      moved = true;
      break;
    }
    if (!moved) return false;
  }
  return solve(n, reg, 2).length === 1;
}

const cache = new Map();
/**
 * The puzzle for a day: { day, n, regions: Int8Array(n*n), solution: Int8Array(n), unique, tries }.
 * Regions are renumbered in reading order (the first cell's region is 0).
 */
export function generate(day) {
  if (cache.has(day)) return cache.get(day);
  const n = sizeFor(day);
  const rnd = rng(hashStr(`staticos-stars:${day}`));
  let best = null, tries = 0;
  for (; tries < 400; tries++) {
    const stars = placeStars(n, rnd);
    if (!stars) continue;
    const reg = growRegions(n, stars, rnd);
    const ok = makeUnique(n, reg, stars, rnd);
    best = { reg, stars, ok };
    if (ok) break;
  }
  /* renumber regions in reading order, so colours follow the grid */
  const map = new Map(), regions = new Int8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const g = best.reg[i];
    if (!map.has(g)) map.set(g, map.size);
    regions[i] = map.get(g);
  }
  const out = { day, n, regions, solution: best.stars, unique: best.ok, tries: tries + 1 };
  if (cache.size > 8) cache.clear();
  cache.set(day, out);
  return out;
}

/**
 * Check a board. stars: a Set (or array) of cell indices with a star.
 * { solved, count, bad: Set of starred cells that break a rule }
 */
export function check(n, regions, stars) {
  const list = [...stars].filter(i => Number.isInteger(i) && i >= 0 && i < n * n);
  const bad = new Set();
  const byRow = new Map(), byCol = new Map(), byReg = new Map();
  const add = (m, k, i) => { const a = m.get(k) || []; a.push(i); m.set(k, a); };
  for (const i of list) { add(byRow, Math.floor(i / n), i); add(byCol, i % n, i); add(byReg, regions[i], i); }
  for (const m of [byRow, byCol, byReg]) for (const a of m.values()) if (a.length > 1) a.forEach(i => bad.add(i));
  const set = new Set(list);
  for (const i of list) {
    const r = Math.floor(i / n), c = i % n;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && set.has(rr * n + cc)) bad.add(i);
    }
  }
  const solved = list.length === n && bad.size === 0 && byRow.size === n && byCol.size === n && byReg.size === n;
  return { solved, count: list.length, bad };
}

export default { dayKey, addDays, sizeFor, generate, solve, check };
