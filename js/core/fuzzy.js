/* ============================================================
   fuzzy.js — typo-tolerant title search over a big list
   (the ~9,000-game catalogue behind Static Play).

     const ix = createIndex(rows, { title: r => r.title, hay: r => 'tags…' })
     ix.search('subwy surfrs') -> {
       hits:   [{ row, i, tier, score }]   best first
       title:  n    hits whose TITLE matches the words as typed
       hay:    n    hits found only in tags / studio / categories
       fuzzy:  n    hits found only by spelling tolerance
       total:  n    all hits (hits is cut to opts.limit when one is given)
       suggestion:  'Subway Surfers' | null   ("Did you mean …", only
                    when no title matches the words as typed)
       ms:     time spent in this call
     }
     ix.warm()  builds everything now (call it when the page is idle)

   ORDER
   Exact and prefix matches always lead; spelling tolerance only adds
   what the plain search could not find:
     7 EXACT   the title is the query (punctuation and spaces aside:
               "pacman" is "Pac-Man")
     6 PREFIX  the title starts with it
     5 WORD    a word inside the title starts with it
     4 SUB     it appears inside the title
     3 WORDS   every word typed starts a word of the title, any order
     2 HAY     it appears in the tags, studio or categories
     1 FUZZY   close spelling (scored, best first)
   Within a tier, rows keep the order they were given in. Close spellings
   are only looked for when the words as typed find fewer than 12 rows.
   When no TITLE matches as typed (and few tags do) they lead instead, and
   the best reading becomes the suggestion; otherwise only very close
   ones (85% of the letters right, every word typed found) are added
   after the real matches.

   HOW THE SPELLING TOLERANCE WORKS
   A vocabulary of every title word (plus each pair of neighbouring words
   written together, so "subwaysurfers" and "mine craft" still meet their
   titles) is indexed by trigram. Each typed word looks up the vocabulary
   words it shares a trigram with, keeps those within a small length
   difference, and checks them with a bounded Damerau-Levenshtein
   distance (optimal string alignment: a swapped pair of letters is one
   edit, so "minecarft" is one edit from "minecraft"). Allowed edits grow
   with the word: 0 up to 3 letters, 1 for 4-6, 2 for 7-10, 3 beyond.
   The last word typed may also be the start of a longer word (with one
   edit fewer).
   Titles then add up their best word per typed word (a small DP lets two
   typed words match one written-together title word, or the reverse),
   and the closest titles lead.

   COST
   Nothing is built until the first search. Normalised titles are made
   once (~9,000 short strings); the vocabulary and trigram lists only when
   a search first needs spelling tolerance. After that a search is a few
   milliseconds.
   ============================================================ */

export const T_EXACT = 7, T_PREFIX = 6, T_WORD = 5, T_SUB = 4, T_WORDS = 3, T_HAY = 2, T_FUZZY = 1;

/* a handful of entities the feeds really send; the rest just become a gap */
const ENT = { amp: '&', apos: "'", quot: '"', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', uacute: 'ú', iacute: 'í', ntilde: 'ñ', ouml: 'ö', uuml: 'ü', auml: 'ä' };
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/** Lowercase letters and digits separated by single spaces: "Minecraft &times; Counter-Strike: 2.5D" -> "minecraft counter strike 2 5d". */
export function norm(s) {
  let t = String(s == null ? '' : s);
  if (t.indexOf('&') >= 0) {
    t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENT[e.toLowerCase()] || ' ';
    });
  }
  t = t.toLowerCase();
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(t)) t = t.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  /* "Papa's" and "papas" are the same word */
  return t.replace(/['’`]/g, '').replace(NON_WORD, ' ').trim();
}

/* ------------------------------------------------------------------ *
 *  bounded Damerau-Levenshtein (optimal string alignment)
 * ------------------------------------------------------------------ */
let r0 = new Int32Array(64), r1 = new Int32Array(64), r2 = new Int32Array(64);
/** Edit distance between a and b, or max + 1 as soon as it must exceed max. */
export function osa(a, b, max = 3) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (!n || !m) return Math.max(n, m);
  if (m + 1 > r0.length) { const L = (m + 1) * 2; r0 = new Int32Array(L); r1 = new Int32Array(L); r2 = new Int32Array(L); }
  let pp = r0, prev = r1, cur = r2;            // rows i-2, i-1, i
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let low = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ai === bj ? 0 : 1);
      const del = prev[j] + 1, ins = cur[j - 1] + 1;
      if (del < v) v = del;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj && pp[j - 2] + 1 < v) v = pp[j - 2] + 1;
      cur[j] = v;
      if (v < low) low = v;
    }
    if (low > max) return max + 1;
    const t = pp; pp = prev; prev = cur; cur = t;
  }
  return prev[m] > max ? max + 1 : prev[m];
}

/** Edits a typed word of this length may carry. */
export const allowedEdits = n => (n <= 3 ? 0 : n <= 6 ? 1 : n <= 10 ? 2 : 3);

const PREFIX_COST = 0.3;      // "surf" is the start of "surfers"
const FUZZY_PREFIX = 0.45;    // "srufe" is a misspelt start of "surfers"
const MAX_TOKENS = 6;
/* words people add that a title often leaves out: unmatched, they cost little */
const STOP = new Set(['the', 'and', 'of', 'a', 'an', 'in', 'on', 'to', 'for', 'with', 'vs', 'game', 'games', 'online', 'free', 'unblocked']);
const MIN_SIM = 0.6;          // titles further than this are not offered
const REL_CUT = 0.1;          // ...nor ones this far behind the best reading
const ADD_SIM = 0.85;         // close spellings added after real matches must be this close

function trigrams(padded, out) {
  for (let k = 0; k + 3 <= padded.length; k++) out.push(padded.slice(k, k + 3));
  return out;
}

/* ------------------------------------------------------------------ *
 *  the index
 * ------------------------------------------------------------------ */
export function createIndex(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const titleOf = opts.title || (r => r.title);
  const hayOf = opts.hay || null;
  const N = list.length;

  let T = null;       // normalised titles
  let W = null;       // ' ' + title, for word-boundary checks
  let C = null;       // titles with the spaces taken out
  let V = null;       // vocabulary, built on the first fuzzy search

  function prepare() {
    if (T) return;
    T = new Array(N); W = new Array(N); C = new Array(N);
    for (let i = 0; i < N; i++) {
      const t = norm(titleOf(list[i]));
      T[i] = t; W[i] = ' ' + t; C[i] = t.replace(/ /g, '');
    }
  }

  function vocab() {
    if (V) return V;
    prepare();
    const id = new Map();
    const words = [];      // the vocabulary entry ("subwaysurfers")
    const label = [];      // how to write it in a suggestion ("subway surfers")
    const post = [];       // titles that contain it
    const add = (w, lab, i) => {
      let k = id.get(w);
      if (k === undefined) { k = words.length; id.set(w, k); words.push(w); label.push(lab); post.push([]); }
      const p = post[k];
      if (p[p.length - 1] !== i) p.push(i);
    };
    for (let i = 0; i < N; i++) {
      const ws = T[i] ? T[i].split(' ') : [];
      for (let k = 0; k < ws.length; k++) {
        add(ws[k], ws[k], i);
        if (k + 1 < ws.length) add(ws[k] + ws[k + 1], `${ws[k]} ${ws[k + 1]}`, i);
      }
    }
    const grams = new Map();
    for (let k = 0; k < words.length; k++) {
      const p = ` ${words[k]} `;
      for (let j = 0; j + 3 <= p.length; j++) {
        const g = p.slice(j, j + 3);
        const l = grams.get(g);
        if (!l) grams.set(g, [k]);
        else if (l[l.length - 1] !== k) l.push(k);      // a word repeating a trigram is listed once
      }
    }
    V = { words, label, post: post.map(p => Int32Array.from(p)), grams, seen: new Int32Array(words.length) };
    return V;
  }

  /**
   * Vocabulary words a typed word could mean: Map wordId -> cost
   * (0 the same word, 0.3 its start, n edits, n + 0.45 a misspelt start).
   */
  let stamp = 0;
  function wordsFor(tok, prefixOK, cap = 3) {
    const v = vocab();
    const n = tok.length;
    const d = Math.min(cap, allowedEdits(n));
    const out = new Map();
    const tg = [];
    trigrams(prefixOK ? ` ${tok}` : ` ${tok} `, tg);
    if (!tg.length) tg.push(` ${tok}`.slice(0, 3));
    if (++stamp > 0x3fffffff) { stamp = 1; v.seen.fill(0); }
    const cand = [];
    for (const g of tg) {
      const l = v.grams.get(g);
      if (!l) continue;
      for (let k = 0; k < l.length; k++) {
        const w = l[k];
        if (v.seen[w] !== stamp) { v.seen[w] = stamp; cand.push(w); }
      }
    }
    for (const w of cand) {
      const word = v.words[w];
      const m = word.length;
      if (word === tok) { out.set(w, 0); continue; }
      if (m > n && n >= 2 && word.startsWith(tok)) { out.set(w, PREFIX_COST); continue; }
      if (!d) continue;
      let best = Infinity;
      if (Math.abs(m - n) <= d) {
        const e = osa(tok, word, d);
        if (e <= d) best = e;
      }
      /* the word still being typed: compare with the start of longer words,
         allowing one edit fewer than a whole word gets */
      const dp = Math.max(1, d - 1);
      if (prefixOK && n >= 4 && m > n && best > dp) {
        for (let L = n - 1; L <= n + 1; L++) {
          if (L >= m) break;
          const e = osa(tok, word.slice(0, L), dp);
          if (e <= dp && e + FUZZY_PREFIX < best) best = e + FUZZY_PREFIX;
        }
      }
      if (best < Infinity) out.set(w, best);
    }
    return out;
  }

  /** per title: the best cost of each typed word (and of each neighbouring pair written together) */
  function fuzzyHits(toks, open, skip) {
    const v = vocab();
    const m = toks.length;
    const units = [];                     // { from, to, cost: Float32Array, word: Int32Array }
    const touched = new Set();
    const addUnit = (from, to, tok, prefixOK, cap) => {
      const matches = wordsFor(tok, prefixOK, cap);
      if (!matches.size) return;
      const cost = new Float32Array(N).fill(Infinity);
      const word = new Int32Array(N).fill(-1);
      for (const [w, c] of matches) {
        const p = v.post[w];
        for (let k = 0; k < p.length; k++) {
          const i = p[k];
          if (c < cost[i]) { cost[i] = c; word[i] = w; touched.add(i); }
        }
      }
      units.push({ from, to, cost, word });
    };
    for (let k = 0; k < m; k++) addUnit(k, k + 1, toks[k], open && k === m - 1);
    /* two typed words written together ("mine carft" -> "minecraft"): one
       edit at most, and never as an unfinished start — otherwise a whole
       typed word could vanish into the edits */
    for (let k = 0; k + 1 < m; k++) addUnit(k, k + 2, toks[k] + toks[k + 1], false, 1);

    const lens = toks.map(t => t.length);
    const total = lens.reduce((a, b) => a + b, 0);
    /* a word of one or two letters ("io", "3d", "of") may go unmatched for a
       small price; with two or more words typed, one longer word may too, at
       the full price of its letters (so it rarely clears MIN_SIM unless the
       rest is long and right: "minecraft xyz" still finds Minecraft) */
    const minor = toks.map(t => t.length <= 2 || STOP.has(t));
    const missCost = lens.map((L, k) => (minor[k] ? 0.5 : L));
    const maxMiss = m >= 2 ? 1 : 0;
    const out = [];
    const f = new Float64Array(m + 1), miss = new Int8Array(m + 1);
    const pick = new Array(m + 1);
    for (const i of touched) {
      if (skip && skip.has(i)) continue;
      /* f[k]: cheapest way to account for the first k typed words. Every
         step moves forward, so one pass in order of k sees every path. */
      f.fill(Infinity); f[0] = 0; miss[0] = 0;
      for (let k = 0; k < m; k++) {
        if (f[k] === Infinity) continue;
        for (const u of units) {
          if (u.from !== k) continue;
          const c = u.cost[i];
          if (c === Infinity) continue;
          if (f[k] + c < f[u.to]) { f[u.to] = f[k] + c; miss[u.to] = miss[k]; pick[u.to] = { w: u.word[i], from: k }; }
        }
        /* typed word k left unmatched */
        const isMiss = minor[k] ? 0 : 1;
        if (f[k] + missCost[k] < f[k + 1] && miss[k] + isMiss <= maxMiss) {
          f[k + 1] = f[k] + missCost[k]; miss[k + 1] = miss[k] + isMiss; pick[k + 1] = { w: -1, from: k };
        }
      }
      if (f[m] === Infinity) continue;
      const sim = 1 - f[m] / Math.max(1, total);
      if (sim < MIN_SIM) continue;
      /* which vocabulary words carried the match, in typed order: [{ w, from, to }] */
      const used = [];
      for (let k = m; k > 0;) {
        const p = pick[k];
        used.unshift({ w: p.w, from: p.from, to: k });
        k = p.from;
      }
      const matched = used.filter(x => x.w >= 0).map(x => x.w);
      if (!matched.length) continue;
      /* small nudges: a title that starts with the first word matched, keeps
         the typed order, and has few extra words reads as the one meant */
      const tw = T[i].split(' ');
      const pos = matched.map(w => tw.indexOf(v.label[w].split(' ')[0]));
      let bonus = 0;
      if (pos[0] === 0) bonus += 0.06;
      if (pos.every((p, k) => k === 0 || p > pos[k - 1])) bonus += 0.03;
      const covered = matched.reduce((s, w) => s + v.label[w].split(' ').length, 0);
      bonus -= 0.015 * Math.min(6, Math.max(0, tw.length - covered));
      out.push({ i, sim, score: sim + bonus, used, missed: used.length - matched.length });
    }
    out.sort((a, b) => b.score - a.score || a.i - b.i);
    /* a clearly better reading drowns out the also-rans: "srufers" is Subway
       Surfers, not every title with "super" in it */
    const floor = out.length ? out[0].score - REL_CUT : 0;
    return out.filter(x => x.score >= floor);
  }

  function search(q, o = {}) {
    const t0 = now();
    prepare();
    const qn = norm(q);
    const raw = String(q == null ? '' : q).trim().toLowerCase();
    const res = { hits: [], title: 0, hay: 0, fuzzy: 0, suggestion: null, ms: 0 };
    if (!qn && !raw) { res.ms = now() - t0; return res; }
    const qc = qn.replace(/ /g, '');
    const toks = qn ? qn.split(' ').slice(0, MAX_TOKENS) : [];
    const wq = ' ' + qn;
    const wt = toks.map(x => ' ' + x);

    /* pass 1: what the words as typed match — a linear scan of short strings */
    const exact = [];
    const hay = [];
    const found = new Set();
    for (let i = 0; i < N; i++) {
      let tier = 0;
      if (qn) {
        const t = T[i], c = C[i];
        if (t === qn || (qc && c === qc)) tier = T_EXACT;
        else if (t.startsWith(qn) || (qc.length > 2 && c.startsWith(qc))) tier = T_PREFIX;
        else if (W[i].includes(wq)) tier = T_WORD;
        else if (t.includes(qn) || (qc.length > 3 && c.includes(qc))) tier = T_SUB;
        else if (toks.length > 1) {
          let all = true;
          for (let k = 0; k < wt.length && all; k++) all = W[i].includes(wt[k]);
          if (all) tier = T_WORDS;
        }
      }
      if (tier) { exact.push({ i, tier }); found.add(i); continue; }
      if (hayOf && raw) {
        const h = hayOf(list[i]);
        if (h && h.includes(raw)) { hay.push({ i, tier: T_HAY }); found.add(i); }
      }
    }
    exact.sort((a, b) => b.tier - a.tier || a.i - b.i);
    res.title = exact.length;
    res.hay = hay.length;

    /* pass 2: spelling tolerance, only where the plain search came up short */
    const few = o.few ?? 12;
    let fuzzy = [];
    const wantFuzzy = toks.length && o.fuzzy !== false && exact.length + hay.length < few;
    if (wantFuzzy) {
      const open = !/\s$/.test(String(q));
      fuzzy = fuzzyHits(toks, open, found).map(x => ({ ...x, tier: T_FUZZY }));
    }
    res.fuzzy = fuzzy.length;

    /* nothing in any title as typed: the close spellings lead, and the best
       one is offered as "Did you mean" */
    let order;
    if (!exact.length && fuzzy.length && hay.length < few) {
      order = [...fuzzy, ...hay];
      const top = fuzzy[0];
      const v = V;
      /* the words that matched, in typed order; a word that matched nothing is left out */
      const words = top.used.filter(x => x.w >= 0).map(x => v.label[x.w]).join(' ');
      if (words && words !== qn) {
        res.suggestion = words === T[top.i] ? cleanTitle(titleOf(list[top.i])) : words;
      }
    } else {
      /* the typed words did match something: only very close spellings join them */
      fuzzy = fuzzy.filter(x => x.sim >= ADD_SIM && !x.missed);
      res.fuzzy = fuzzy.length;
      order = [...exact, ...hay, ...fuzzy];
    }
    const lim = o.limit > 0 ? o.limit : order.length;
    res.hits = order.slice(0, lim).map(x => ({ row: list[x.i], i: x.i, tier: x.tier, score: x.score ?? x.tier }));
    res.total = order.length;
    res.ms = now() - t0;
    return res;
  }

  return {
    rows: list,
    search,
    /** build the titles and the vocabulary now, so the first typo search is as fast as the rest */
    warm() { prepare(); vocab(); return this; },
    get warmed() { return !!V; },
    get size() { return N; },
  };
}

/* titles as they should read in "Did you mean": entities decoded, spaces tidied */
function cleanTitle(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] || ' ';
  }).replace(/\s+/g, ' ').trim();
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export default { createIndex, norm, osa, allowedEdits, T_EXACT, T_PREFIX, T_WORD, T_SUB, T_WORDS, T_HAY, T_FUZZY };
