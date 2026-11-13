/* ============================================================
   arcade/cardrules.js — the rules of Solitaire (Klondike), Spider
   and FreeCell, with no drawing in it. js/arcade/cards.js puts a
   table on screen around these; the tests drive them through it.

   A game is a list of piles, each { t, i, c: [card…] } where t is
   stock | waste | found | tab | cell | done and a card is
   { id, r: 1–13, s: 0–3 (♣ ♦ ♥ ♠, Microsoft's order), up }.

   Klondike (draw 1 or 3)
     7 columns of 1–7 cards, the top one face up; the rest is the
     stock. Columns build down in alternating colours; only a King
     (or a run headed by one) fills an empty column. The four
     foundations build up by suit from the Ace. The stock turns
     over 1 or 3 cards at a time, as often as you like. A face-down
     card left on top of a column turns itself over.
   Spider (1, 2 or 4 suits)
     104 cards (two decks; one suit uses spades eight times, two
     use spades and hearts). 10 columns of 6, 6, 6, 6, 5 … 5 cards.
     Any card goes on a card one rank higher, but only a run of one
     suit moves together. A whole King-to-Ace run of one suit is
     taken off by itself. Each of the five deals puts one card on
     every column, and needs every column to have a card.
   FreeCell (Microsoft's numbered deals)
     All 52 cards face up in 8 columns, 4 free cells, 4 foundations.
     One card moves at a time; a run moves when there is room to do
     it one card at a time: (free cells + 1) × 2^(empty columns),
     not counting an empty column it is moving into.
     Deal n is dealt exactly as Microsoft's FreeCell deals game n
     (its C runtime's rand(), seeded with n), so game #1 here is
     the same layout as game #1 everywhere else.
   ============================================================ */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = 'CDHS';
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
export const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
export const isRed = s => s === 1 || s === 2;
/** "10H", "AS", "QD" — the usual short name of a card */
export const codeOf = c => `${RANKS[c.r - 1]}${SUITS[c.s]}`;
export const nameOf = c => `${RANK_NAMES[c.r - 1]} of ${SUIT_NAMES[c.s]}`;
export function parseCode(str) {
  const m = /^(10|[A2-9TJQK])([CDHS])$/i.exec(String(str).trim());
  if (!m) return null;
  const rk = m[1].toUpperCase() === 'T' ? '10' : m[1].toUpperCase();
  return { r: RANKS.indexOf(rk) + 1, s: SUITS.indexOf(m[2].toUpperCase()) };
}

export const KINDS = ['klondike', 'spider', 'freecell'];
export const FREECELL_MAX = 1_000_000;

/* ---------------- random numbers ---------------- */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rnd) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Microsoft FreeCell's deal n: 52 numbers in the order they are dealt
    (left to right, row by row); number c is rank floor(c/4)+1 of suit c%4
    (♣ ♦ ♥ ♠). The generator is MSVC's rand():
    seed = seed × 214013 + 2531011 (mod 2^31), returning seed >> 16. */
export function msDeal(n) {
  let seed = Math.floor(Number(n)) % 2147483648;
  const rand = () => {
    seed = (seed * 214013 + 2531011) % 2147483648;   /* < 2^49: exact in a double */
    return Math.floor(seed / 65536);
  };
  const deck = Array.from({ length: 52 }, (_, i) => 51 - i);
  for (let i = 0; i < 51; i++) {
    const j = 51 - (rand() % (52 - i));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ---------------- making a game ---------------- */
const pile = (t, i = 0) => ({ t, i, c: [] });

function frame(kind) {
  const P = [];
  const ix = { stock: -1, waste: -1, done: -1, found: [], tab: [], cells: [] };
  const add = (t, i) => { P.push(pile(t, i)); return P.length - 1; };
  if (kind === 'klondike') {
    ix.stock = add('stock');
    ix.waste = add('waste');
    for (let i = 0; i < 4; i++) ix.found.push(add('found', i));
    for (let i = 0; i < 7; i++) ix.tab.push(add('tab', i));
  } else if (kind === 'freecell') {
    for (let i = 0; i < 4; i++) ix.cells.push(add('cell', i));
    for (let i = 0; i < 4; i++) ix.found.push(add('found', i));
    for (let i = 0; i < 8; i++) ix.tab.push(add('tab', i));
  } else {
    ix.done = add('done');
    ix.stock = add('stock');
    for (let i = 0; i < 10; i++) ix.tab.push(add('tab', i));
  }
  return { P, ix };
}

/** The cards of one game: 52, or Spider's 104 in its suits. */
function deckFor(kind, suits) {
  const out = [];
  if (kind !== 'spider') {
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) out.push({ r, s });
  } else {
    const set = suits === 4 ? [0, 1, 2, 3] : suits === 2 ? [3, 2] : [3];
    for (let k = 0; k < 8; k++) for (let r = 1; r <= 13; r++) out.push({ r, s: set[k % set.length] });
  }
  return out.map((c, id) => ({ id, r: c.r, s: c.s, up: false }));
}

/** A new game. opt: { draw } (klondike), { suits } (spider), { deal } (freecell);
    seed shuffles Klondike and Spider. */
export function newGame(kind, opt = {}, seed = 1) {
  const draw = opt.draw === 3 ? 3 : 1;
  const suits = [1, 2, 4].includes(opt.suits) ? opt.suits : 1;
  const deal = kind === 'freecell' ? clampDeal(opt.deal) : null;
  const { P, ix } = frame(kind);
  const cards = deckFor(kind, suits);
  const st = { kind, draw, suits, deal, seed: seed >>> 0, P, ix, cards, moves: 0, passes: 0 };
  if (kind === 'freecell') {
    const order = msDeal(deal);
    const byCode = new Map(cards.map(c => [(c.r - 1) * 4 + c.s, c]));
    order.forEach((n, k) => { const c = byCode.get(n); c.up = true; P[ix.tab[k % 8]].c.push(c); });
    return st;
  }
  const deck = shuffle(cards.slice(), rng32(seed));
  if (kind === 'klondike') {
    for (let row = 0; row < 7; row++) for (let col = row; col < 7; col++) P[ix.tab[col]].c.push(deck.pop());
    for (const t of ix.tab) P[t].c[P[t].c.length - 1].up = true;
    P[ix.stock].c = deck;                     /* the rest, face down; the top is the end */
  } else {
    for (let k = 0; k < 54; k++) P[ix.tab[k % 10]].c.push(deck.pop());
    for (const t of ix.tab) P[t].c[P[t].c.length - 1].up = true;
    P[ix.stock].c = deck;                     /* 50 cards: five deals of ten */
  }
  return st;
}

export const clampDeal = n => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 1 && v <= FREECELL_MAX ? v : 1;
};

/** A game laid out by hand — only for tests (cards.js setNextDeal). Every
    pile is a list of codes; a "!" before a code means face down. found
    lists each foundation's top card (the cards below it are implied);
    done is how many Spider runs are already off. Cards nobody placed
    are left out of the game. */
export function fromLayout(kind, opt, L) {
  const st = newGame(kind, opt, 1);
  for (const p of st.P) p.c = [];
  const pool = st.cards.slice();
  const take = (str, up) => {
    const want = parseCode(String(str).replace(/^!/, ''));
    if (!want) throw new Error(`Not a card: ${str}`);
    const i = pool.findIndex(c => c.r === want.r && c.s === want.s);
    if (i < 0) throw new Error(`No ${str} left to place`);
    const [c] = pool.splice(i, 1);
    c.up = up && !String(str).startsWith('!');
    return c;
  };
  const fill = (pi, list, up = true) => { for (const s of list || []) st.P[pi].c.push(take(s, up)); };
  (L.tab || []).forEach((list, k) => fill(st.ix.tab[k], list));
  (L.cells || []).forEach((s, k) => { if (s) fill(st.ix.cells[k], [s]); });
  (L.found || []).forEach((top, k) => {
    if (!top) return;
    const t = parseCode(top);
    for (let r = 1; r <= t.r; r++) fill(st.ix.found[k], [`${RANKS[r - 1]}${SUITS[t.s]}`]);
  });
  if (st.ix.waste >= 0) fill(st.ix.waste, L.waste);
  if (st.ix.stock >= 0) fill(st.ix.stock, L.stock, false);
  if (kind === 'spider') {
    for (let k = 0; k < (L.done || 0); k++) {
      const suit = pool.find(c => c.r === 13)?.s ?? 3;
      for (let r = 1; r <= 13; r++) fill(st.ix.done, [`${RANKS[r - 1]}${SUITS[suit]}`]);
    }
  }
  st.cards = st.cards.filter(c => !pool.includes(c));
  return st;
}

/* ---------------- looking at a game ---------------- */
export const top = p => p.c[p.c.length - 1] || null;
export const totalCards = st => st.cards.length;
export function homeCount(st) {
  if (st.kind === 'spider') return st.P[st.ix.done].c.length;
  return st.ix.found.reduce((n, f) => n + st.P[f].c.length, 0);
}
export const isWon = st => homeCount(st) === st.cards.length;

/** Do cards[idx…] of this column form a run that may move as one? */
export function runOk(st, p, idx) {
  const c = p.c;
  if (idx < 0 || idx >= c.length) return false;
  for (let k = idx; k < c.length; k++) if (!c[k].up) return false;
  for (let k = idx; k < c.length - 1; k++) {
    const a = c[k], b = c[k + 1];
    if (b.r !== a.r - 1) return false;
    if (st.kind === 'spider' ? a.s !== b.s : isRed(a.s) === isRed(b.s)) return false;
  }
  return true;
}

/** FreeCell: the most cards that may move to pile `to` at once. */
export function maxMove(st, to) {
  if (st.kind !== 'freecell') return Infinity;
  const free = st.ix.cells.filter(i => !st.P[i].c.length).length;
  const empty = st.ix.tab.filter(i => i !== to && !st.P[i].c.length).length;
  return (free + 1) * 2 ** empty;
}

/** May the cards from P[from].c[idx] up be lifted? */
export function canPick(st, from, idx) {
  const p = st.P[from];
  if (!p || idx < 0 || idx >= p.c.length) return false;
  const last = idx === p.c.length - 1;
  switch (p.t) {
    case 'waste': return last;
    case 'cell': return last;
    case 'found': return last && st.kind === 'klondike';
    case 'tab': return runOk(st, p, idx);
    default: return false;
  }
}

/** May the cards from P[from].c[idx] up go on pile `to`? */
export function canDrop(st, from, idx, to) {
  if (from === to || !canPick(st, from, idx)) return false;
  const src = st.P[from], dst = st.P[to];
  if (!dst) return false;
  const n = src.c.length - idx, base = src.c[idx], t = top(dst);
  switch (dst.t) {
    case 'found':
      if (st.kind === 'spider' || n !== 1) return false;
      return t ? t.s === base.s && base.r === t.r + 1 : base.r === 1;
    case 'cell':
      return st.kind === 'freecell' && n === 1 && !t;
    case 'tab':
      if (st.kind === 'klondike') return t ? t.up && t.r === base.r + 1 && isRed(t.s) !== isRed(base.s) : base.r === 13;
      if (st.kind === 'freecell') return n <= maxMove(st, to) && (!t || (t.r === base.r + 1 && isRed(t.s) !== isRed(base.s)));
      return !t || (t.up && t.r === base.r + 1);
    default:
      return false;
  }
}

/* ---------------- changing a game ---------------- */
/** Spider: take every finished King-to-Ace run of one suit off the table. */
function collectRuns(st) {
  const off = [];
  for (const ti of st.ix.tab) {
    const c = st.P[ti].c;
    if (c.length < 13) continue;
    const at = c.length - 13;
    let ok = c[at].r === 13;
    for (let k = at; ok && k < c.length; k++) ok = c[k].up && c[k].s === c[at].s && c[k].r === 13 - (k - at);
    if (!ok) continue;
    const run = c.splice(at, 13);
    st.P[st.ix.done].c.push(...run.reverse());     /* each run of 13 ends with its King */
    off.push({ col: ti, s: run[0].s });
    flipTop(st, ti);
  }
  return off;
}
function flipTop(st, pi) {
  const t = top(st.P[pi]);
  if (st.P[pi].t === 'tab' && t && !t.up) { t.up = true; return t; }
  return null;
}

/** Move cards[idx…] of `from` onto `to`. Returns what happened, or null if not legal. */
export function move(st, from, idx, to) {
  if (!canDrop(st, from, idx, to)) return null;
  const run = st.P[from].c.splice(idx);
  st.P[to].c.push(...run);
  const flipped = flipTop(st, from);
  const off = st.kind === 'spider' ? collectRuns(st) : [];
  st.moves++;
  return { from, to, n: run.length, cards: run, flipped, off };
}

/** Click on the stock: Klondike turns over 1 or 3 (or puts the waste back),
    Spider deals a row. Returns null when nothing can happen, or
    { blocked: 'empty' } when Spider has an empty column. */
export function drawStock(st) {
  const S = st.P[st.ix.stock];
  if (st.kind === 'klondike') {
    const W = st.P[st.ix.waste];
    if (S.c.length) {
      const n = Math.min(st.draw, S.c.length);
      const drawn = [];
      for (let k = 0; k < n; k++) { const c = S.c.pop(); c.up = true; W.c.push(c); drawn.push(c); }
      st.moves++;
      return { drew: drawn };
    }
    if (!W.c.length) return null;
    S.c = W.c.reverse();
    for (const c of S.c) c.up = false;
    W.c = [];
    st.passes++;
    st.moves++;
    return { redeal: true };
  }
  if (st.kind !== 'spider' || !S.c.length) return null;
  if (st.ix.tab.some(t => !st.P[t].c.length)) return { blocked: 'empty' };
  const dealt = [];
  for (const t of st.ix.tab) { const c = S.c.pop(); c.up = true; st.P[t].c.push(c); dealt.push(c); }
  const off = collectRuns(st);
  st.moves++;
  return { dealt, off };
}

/* ---------------- choosing a move ---------------- */
const tabs = st => st.ix.tab;

/** Where a click sends cards[idx…] of `from`: a foundation first (one
    card), then a column with cards (Spider: same suit first), then an
    empty column, then a free cell. null when nowhere is legal. */
export function autoTarget(st, from, idx) {
  if (!canPick(st, from, idx)) return null;
  const src = st.P[from];
  const n = src.c.length - idx;
  if (n === 1 && src.t !== 'found') for (const f of st.ix.found) if (canDrop(st, from, idx, f)) return f;
  const filled = tabs(st).filter(t => t !== from && st.P[t].c.length && canDrop(st, from, idx, t));
  if (st.kind === 'spider') {
    const same = filled.find(t => top(st.P[t]).s === src.c[idx].s);
    if (same !== undefined) return same;
  }
  if (filled.length) return filled[0];
  /* a run that already heads its column gains nothing from an empty one */
  if (!(src.t === 'tab' && idx === 0)) {
    const empty = tabs(st).find(t => t !== from && !st.P[t].c.length && canDrop(st, from, idx, t));
    if (empty !== undefined) return empty;
  }
  if (st.kind === 'freecell' && n === 1 && src.t !== 'cell') {
    const cell = st.ix.cells.find(c => canDrop(st, from, idx, c));
    if (cell !== undefined) return cell;
  }
  return null;
}

/** The foundation this pile's top card can go to, or null (double-click). */
export function foundationFor(st, from) {
  const p = st.P[from];
  if (!p || !p.c.length || p.t === 'found') return null;
  const idx = p.c.length - 1;
  return st.ix.found.find(f => canDrop(st, from, idx, f)) ?? null;
}

/** Keyboard drop: the biggest legal run from `from` onto `to` (its index), or -1. */
export function dropIndex(st, from, to) {
  const p = st.P[from];
  if (!p) return -1;
  const dst = st.P[to];
  if (dst && (dst.t === 'found' || dst.t === 'cell')) return canDrop(st, from, p.c.length - 1, to) ? p.c.length - 1 : -1;
  for (let idx = 0; idx < p.c.length; idx++) if (canDrop(st, from, idx, to)) return idx;
  return -1;
}

/** The deepest card that can be lifted from this pile (keyboard pick-up), or -1. */
export function liftIndex(st, from) {
  const p = st.P[from];
  if (!p) return -1;
  for (let idx = 0; idx < p.c.length; idx++) if (canPick(st, from, idx)) return idx;
  return -1;
}

/* ---------------- undo ---------------- */
export function snapshot(st) {
  return { p: st.P.map(p => p.c.map(c => c.id * 2 + (c.up ? 1 : 0))), moves: st.moves, passes: st.passes };
}
export function restore(st, snap) {
  const byId = new Map(st.cards.map(c => [c.id, c]));
  snap.p.forEach((list, k) => {
    st.P[k].c = list.map(v => { const c = byId.get(v >> 1); c.up = !!(v & 1); return c; });
  });
  st.moves = snap.moves;
  st.passes = snap.passes;
}
function clone(st) {
  const cards = st.cards.map(c => ({ ...c }));
  const byId = new Map(cards.map(c => [c.id, c]));
  return { ...st, cards, P: st.P.map(p => ({ ...p, c: p.c.map(c => byId.get(c.id)) })) };
}

/* ---------------- finishing by itself ---------------- */
/** When the rest of the game needs no choices — every card face up and
    each one can go home in turn — the moves that finish it, as
    [{ from, idx, to } | { draw: true }]. Otherwise null. */
export function autoPlan(st) {
  if (isWon(st)) return null;
  for (const t of tabs(st)) if (st.P[t].c.some(c => !c.up)) return null;
  const s = clone(st);
  const plan = [];
  if (st.kind === 'spider') {
    if (s.P[s.ix.stock].c.length) return null;
    for (let guard = 0; guard < 400 && !isWon(s); guard++) {
      let step = null;
      for (const a of tabs(s)) {
        const pa = s.P[a];
        if (!pa.c.length) continue;
        let idx = pa.c.length - 1;
        while (idx > 0 && runOk(s, pa, idx - 1)) idx--;
        const base = pa.c[idx];
        const b = tabs(s).find(t => t !== a && top(s.P[t]) && top(s.P[t]).s === base.s && top(s.P[t]).r === base.r + 1);
        if (b !== undefined) { step = { from: a, idx, to: b }; break; }
      }
      if (!step) return null;
      plan.push(step);
      move(s, step.from, step.idx, step.to);
    }
    return isWon(s) ? plan : null;
  }
  const sources = () => [...(s.ix.waste >= 0 ? [s.ix.waste] : []), ...s.ix.cells, ...tabs(s)];
  const limit = s.kind === 'klondike' ? 2 * (Math.ceil(24 / s.draw) + 2) : 0;
  let idle = 0;
  for (let guard = 0; guard < 2000 && !isWon(s); guard++) {
    let step = null;
    for (const a of sources()) {
      const pa = s.P[a];
      if (!pa.c.length) continue;
      const to = foundationFor(s, a);
      if (to !== null) { step = { from: a, idx: pa.c.length - 1, to }; break; }
    }
    if (step) { plan.push(step); move(s, step.from, step.idx, step.to); idle = 0; continue; }
    if (s.kind === 'klondike' && (s.P[s.ix.stock].c.length || s.P[s.ix.waste].c.length) && ++idle <= limit) {
      plan.push({ draw: true });
      drawStock(s);
      continue;
    }
    return null;
  }
  return isWon(s) ? plan : null;
}
