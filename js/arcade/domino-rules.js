/* ============================================================
   arcade/domino-rules.js — Dominoes, the double-six draw game for
   two, and its computer player. Pure (no DOM); shared by the game
   (./domino.js), the thinking worker (./think.js) and the tests.

   THE RULES (the game says the same):
   · A double-six set of 28 tiles, shuffled. Each side takes 7; the
     other 14 are the boneyard (the stock).
   · The side holding the highest double leads it (no double: the
     heaviest tile leads). Later rounds start the same way.
   · Then in turn you play a tile from your hand to either end of
     the line, with a matching number against the end. A double is
     laid like any other tile (there is no spinner).
   · If you cannot play you must draw from the boneyard, one tile at
     a time, until you can play — and if the boneyard is empty you
     pass.
   · The round ends when a side plays its last tile ("domino"): it
     scores the pips left in the other hand. It also ends when the
     game is BLOCKED (both sides pass in a row): the side with fewer
     pips left wins the round and scores the difference; a tie
     scores nothing.
   · The match is won by the first side to reach the target (50 or
     100 points, your choice; 25 for a quick one) at the end of a round.

   Side 0 is the person, side 1 the computer.
   Tiles are numbers 0..27 (see TILES: [low, high] with low <= high).

   THE COMPUTER: Easy plays any legal tile at random. Medium plays
   the heaviest tile (a double first) while keeping a spread of
   numbers on its own side. Hard works from what it can know — its
   own hand, the line, the boneyard's size and the numbers your
   passes showed you lack — deals your hidden tiles at random many
   times and plays each candidate out to the end of the round,
   picking the move that scores best on average.
   ============================================================ */
export const TILES = [];
for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) TILES.push([a, b]);
export const pips = id => TILES[id][0] + TILES[id][1];
export const LEVELS = {
  1: { name: 'Easy' },
  2: { name: 'Medium' },
  3: { name: 'Hard', samples: 14 },
};

export function shuffle(rnd) {
  const a = TILES.map((_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** which side leads first: the highest double, else the heaviest tile (ties to the higher end) */
export function opener(hands) {
  let best = null;
  hands.forEach((h, side) => h.forEach(id => {
    const [a, b] = TILES[id];
    const key = (a === b ? 100 : 0) + a + b + Math.max(a, b) / 10;
    if (!best || key > best.key) best = { key, side, id };
  }));
  return best;
}

/** a new round dealt from `rnd` (() => [0,1)); scores / round carry over from `prev` */
export function deal(rnd, prev = null, target = 100) {
  const order = shuffle(rnd);
  const hands = [order.slice(0, 7), order.slice(7, 14)];
  const g = {
    hands, yard: order.slice(14), chain: [], ends: null, turn: 0, passes: 0, phase: 'play',
    scores: prev ? prev.scores.slice() : [0, 0], round: prev ? prev.round + 1 : 1, target,
    voids: [[], []], opened: null, last: null, result: null, log: [],
  };
  const o = opener(hands);
  g.turn = o.side;
  g.opened = o.id;
  return g;
}
export const copy = g => ({
  ...g, hands: g.hands.map(h => h.slice()), yard: g.yard.slice(), chain: g.chain.map(c => ({ ...c })), ends: g.ends && g.ends.slice(),
  scores: g.scores.slice(), voids: g.voids.map(v => v.slice()), log: g.log.slice(), result: g.result && { ...g.result },
});

/** the ways tile `id` may be laid: 'L' and / or 'R' (an empty line takes it as 'L') */
export function sidesFor(g, id) {
  if (!g.chain.length) return g.turn >= 0 && (id === g.opened || g.opened === null) ? ['L'] : [];
  const [a, b] = TILES[id], out = [];
  if (a === g.ends[0] || b === g.ends[0]) out.push('L');
  if (a === g.ends[1] || b === g.ends[1]) out.push('R');
  return out;
}
/** every legal move for the side to move: { k: 'play', id, side } | { k: 'draw' } | { k: 'pass' } */
export function moves(g) {
  if (g.phase !== 'play') return [];
  const out = [];
  for (const id of g.hands[g.turn]) for (const side of sidesFor(g, id)) out.push({ k: 'play', id, side });
  if (out.length) return out;
  return g.yard.length ? [{ k: 'draw' }] : [{ k: 'pass' }];
}
export const isLegal = (g, m) => !!m && moves(g).some(x => x.k === m.k && (m.k !== 'play' || (x.id === m.id && x.side === m.side)));

const handPips = h => h.reduce((s, id) => s + pips(id), 0);

/** make a move (checked): returns false if it is not legal. A draw takes the top of the boneyard. */
export function apply(g, m) {
  if (!isLegal(g, m)) return false;
  const me = g.turn;
  g.last = { side: me, ...m };
  if (m.k === 'draw') { g.hands[me].push(g.yard.pop()); g.log.push({ side: me, k: 'draw' }); return true; }
  if (m.k === 'pass') {
    g.voids[me] = g.ends ? [...new Set([...g.voids[me], g.ends[0], g.ends[1]])] : g.voids[me];
    g.passes++;
    g.turn = 1 - me;
    g.log.push({ side: me, k: 'pass' });
    if (g.passes >= 2) endBlocked(g);
    return true;
  }
  const [a, b] = TILES[m.id];
  g.hands[me].splice(g.hands[me].indexOf(m.id), 1);
  g.passes = 0;
  if (!g.chain.length) {
    g.chain.push({ id: m.id, l: a, r: b });
    g.ends = [a, b];
  } else if (m.side === 'L') {
    const out = a === g.ends[0] ? b : a, inn = a === g.ends[0] ? a : b;
    g.chain.unshift({ id: m.id, l: out, r: inn });
    g.ends[0] = out;
  } else {
    const inn = a === g.ends[1] ? a : b, out = a === g.ends[1] ? b : a;
    g.chain.push({ id: m.id, l: inn, r: out });
    g.ends[1] = out;
  }
  g.log.push({ side: me, k: 'play', id: m.id, side2: m.side });
  if (!g.hands[me].length) {
    const pts = handPips(g.hands[1 - me]);
    finish(g, me, pts, 'domino');
  } else g.turn = 1 - me;
  return true;
}
function endBlocked(g) {
  const p = [handPips(g.hands[0]), handPips(g.hands[1])];
  if (p[0] === p[1]) finish(g, -1, 0, 'blocked', p);
  else { const w = p[0] < p[1] ? 0 : 1; finish(g, w, p[1 - w] - p[w], 'blocked', p); }
}
function finish(g, winner, pts, how, p = [handPips(g.hands[0]), handPips(g.hands[1])]) {
  if (winner >= 0) g.scores[winner] += pts;
  g.phase = 'round';
  g.result = { winner, pts, how, left: p, matchOver: false, matchWinner: -1 };
  if (g.scores[0] >= g.target || g.scores[1] >= g.target) {
    g.phase = 'over';
    g.result.matchOver = true;
    g.result.matchWinner = g.scores[0] === g.scores[1] ? -1 : g.scores[0] > g.scores[1] ? 0 : 1;
  }
}

/* ------------------------------ the computer ------------------------------ */
/** what side `me` can know: its hand, the line, the boneyard's size, and what passes showed */
export function viewFor(g, me) {
  return {
    me, hand: g.hands[me].slice(), chain: g.chain.map(c => ({ ...c })), ends: g.ends && g.ends.slice(), oppCount: g.hands[1 - me].length,
    yardCount: g.yard.length, opened: g.opened, voids: g.voids[1 - me].slice(), passes: g.passes, target: g.target, scores: g.scores.slice(),
  };
}
/* rebuild a full game from a view by dealing the hidden tiles at random (respecting the numbers the other side lacks, where it can) */
function determinize(v, rnd) {
  const known = new Set(v.hand);
  v.chain.forEach(c => known.add(c.id));
  const unseen = TILES.map((_, i) => i).filter(i => !known.has(i));
  let opp = null;
  for (let tries = 0; tries < 24 && !opp; tries++) {
    const pool = unseen.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const hand = pool.slice(0, v.oppCount);
    if (!hand.some(id => v.voids.some(x => TILES[id][0] === x || TILES[id][1] === x)) || tries === 23) opp = { hand, yard: pool.slice(v.oppCount) };
  }
  const hands = [];
  hands[v.me] = v.hand.slice();
  hands[1 - v.me] = opp.hand;
  return {
    hands, yard: opp.yard, chain: v.chain.map(c => ({ ...c })), ends: v.ends && v.ends.slice(), turn: v.me, passes: v.passes, phase: 'play',
    scores: [0, 0], round: 1, target: 1e9, voids: [[], []], opened: v.opened, last: null, result: null, log: [],
  };
}
/* a quick policy: heaviest tile, doubles first, a little care for variety */
function heavy(g, rnd) {
  const ms = moves(g);
  if (ms[0].k !== 'play') return ms[0];
  const mine = g.hands[g.turn];
  let best = null, bv = -Infinity;
  for (const m of ms) {
    const [a, b] = TILES[m.id];
    const out = m.side === 'L' ? (a === (g.ends ? g.ends[0] : -1) ? b : a) : (a === (g.ends ? g.ends[1] : -1) ? b : a);
    const keep = mine.filter(id => id !== m.id);
    const inHand = keep.filter(id => TILES[id][0] === out || TILES[id][1] === out).length;   /* keeping a number I can follow with */
    const v = a + b + (a === b ? 3 : 0) + inHand * 0.8 + rnd() * 0.5;
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}
const randomMove = (g, rnd) => { const ms = moves(g); return ms[Math.floor(rnd() * ms.length)]; };

/** play a round out from here with both sides on `heavy`; returns points for side `me` (positive = good) */
function rollout(g, me, rnd) {
  const t = copy(g);
  let guard = 0;
  while (t.phase === 'play' && guard++ < 80) apply(t, heavy(t, rnd));
  const r = t.result;
  if (!r) return 0;
  return r.winner < 0 ? 0 : (r.winner === me ? r.pts : -r.pts);
}

/** the move for the side the view belongs to. opts: level, rnd, samples */
export function think(v, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const level = opts.level || 2;
  const g = determinize(v, rnd);          /* a legal game from this side's point of view: used for its move list */
  const ms = moves(g);
  if (ms.length === 1) return ms[0];
  if (level === 1) return ms[Math.floor(rnd() * ms.length)];
  if (level === 2) return heavy(g, rnd);
  const samples = opts.samples || LEVELS[3].samples;
  const total = new Array(ms.length).fill(0);
  for (let s = 0; s < samples; s++) {
    const world = determinize(v, rnd);
    ms.forEach((m, i) => {
      const w = copy(world);
      if (!apply(w, m)) return;
      total[i] += w.phase === 'play' ? rollout(w, v.me, rnd) : (w.result.winner < 0 ? 0 : (w.result.winner === v.me ? w.result.pts : -w.result.pts));
    });
  }
  let bi = 0;
  total.forEach((t, i) => { if (t > total[bi]) bi = i; });
  return ms[bi];
}

/** play a whole round between two policies (side -> (view, opts) => move), for tests; returns the finished game */
export function playRound(g, pick) {
  let guard = 0;
  while (g.phase === 'play' && guard++ < 200) {
    const side = g.turn;
    const m = pick[side](viewFor(g, side), g);
    if (!apply(g, m)) throw new Error(`illegal move by side ${side}: ${JSON.stringify(m)}`);
  }
  return g;
}
export const randomPolicy = rnd => (v, g) => randomMove(g, rnd);
