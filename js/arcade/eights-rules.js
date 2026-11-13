/* ============================================================
   arcade/eights-rules.js — Crazy Eights' rules and its computer player.

   Pure (no DOM), shared by the game (./crazy8.js) and the play-tests.
   Cards are { r: 1–13 (A…K), s: 0–3 (♣ ♦ ♥ ♠) } like ./cardrules.js.

   THE RULE SET is the common "draw until you can" Crazy Eights:
     · one 52-card deck; 2 players are dealt 7 cards each, 3 or 4
       players 5 each; one card is turned up to start the pile (an
       eight is put back and another is turned);
     · play a card that matches the top card's SUIT or RANK, or the
       suit an eight has just named;
     · an EIGHT is wild: play it on anything and name the suit that
       must be followed;
     · if you have no playable card you must draw, one card at a
       time, until you draw one you can play (and you then play it,
       or any other playable card). If the draw pile runs out the
       pile under the top card is shuffled to make a new one; if
       there is nothing left to draw you pass;
     · no other card has a special action; play goes round one way;
     · the first to empty their hand wins the hand and scores the
       points left in everyone else's: an eight 50, K Q J 10 each,
       an ace 1, any other card its number. If every player passes
       in a row (nobody can move) the hand is blocked and the player
       with the fewest points left wins it, scoring the others' total.

   Randomness comes from rnd, a () => [0,1) function (the game seeds
   one from crypto, tests seed their own), so a deal is repeatable.
   The computer's choices use it only to break ties.
   ============================================================ */
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
export const handSize = n => (n === 2 ? 7 : 5);
export const pointsOf = c => (c.r === 8 ? 50 : c.r >= 10 ? 10 : c.r);
export const handPoints = hand => hand.reduce((a, c) => a + pointsOf(c), 0);

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** a random 32-bit seed from the browser's crypto */
export const cryptoSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;

export function shuffle(list, rnd) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
export const deck = () => { const d = []; for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ r, s }); return d; };

/** a new hand for n players (2–4); `first` plays first */
export function newGame(n, rnd, first = 0) {
  const st = { n, rnd, hands: [], stock: shuffle(deck(), rnd), pile: [], suit: 0, turn: first % n, drawn: 0, passes: 0, over: null, plays: 0 };
  const per = handSize(n);
  for (let p = 0; p < n; p++) st.hands.push([]);
  for (let i = 0; i < per; i++) for (let p = 0; p < n; p++) st.hands[p].push(st.stock.pop());
  /* the starter: never an eight */
  let k = st.stock.length - 1;
  while (st.stock[k].r === 8) k--;
  st.pile.push(st.stock.splice(k, 1)[0]);
  st.suit = st.pile[0].s;
  return st;
}
export function copy(st) {
  return { ...st, hands: st.hands.map(h => h.slice()), stock: st.stock.slice(), pile: st.pile.slice(), over: st.over ? { ...st.over } : null };
}

export const top = st => st.pile[st.pile.length - 1];
export const playable = (st, c) => c.r === 8 || c.s === st.suit || c.r === top(st).r;
/** hand indexes the player to move may play */
export const legalPlays = st => (st.over ? [] : st.hands[st.turn].map((c, i) => (playable(st, c) ? i : -1)).filter(i => i >= 0));
/** is there anything left to draw (the pile under the top card counts) */
export const canDraw = st => st.stock.length + st.pile.length - 1 > 0;
/** you may draw only with nothing playable, and only if there is a card to draw */
export const mustDraw = st => !st.over && legalPlays(st).length === 0 && canDraw(st);
export const mustPass = st => !st.over && legalPlays(st).length === 0 && !canDraw(st);

function advance(st) { st.turn = (st.turn + 1) % st.n; st.drawn = 0; }

function finish(st, winner, blocked) {
  let pts = 0;
  for (let p = 0; p < st.n; p++) if (p !== winner) pts += handPoints(st.hands[p]);
  st.over = { winner, points: pts, blocked: !!blocked, left: st.hands.map(handPoints) };
}

/** play hand[idx]; an eight needs `suit` (0–3). Returns the card or null when illegal. */
export function play(st, idx, suit) {
  if (st.over) return null;
  const hand = st.hands[st.turn];
  const c = hand[idx];
  if (!c || !playable(st, c)) return null;
  if (c.r === 8 && !(Number.isInteger(suit) && suit >= 0 && suit <= 3)) return null;
  hand.splice(idx, 1);
  st.pile.push(c);
  st.suit = c.r === 8 ? suit : c.s;
  st.passes = 0;
  st.plays++;
  if (!hand.length) { finish(st, st.turn, false); return c; }
  advance(st);
  return c;
}

/** draw one card (only when nothing is playable). Returns the card, or null. */
export function draw(st) {
  if (!mustDraw(st)) return null;
  if (!st.stock.length) {
    const keep = st.pile.pop();
    st.stock = shuffle(st.pile.splice(0), st.rnd);
    st.pile.push(keep);
  }
  const c = st.stock.pop();
  st.hands[st.turn].push(c);
  st.drawn++;
  return c;
}

/** pass (only when nothing is playable and nothing can be drawn) */
export function pass(st) {
  if (!mustPass(st)) return false;
  st.passes++;
  if (st.passes >= st.n) {
    let best = 0;
    for (let p = 1; p < st.n; p++) {
      const a = handPoints(st.hands[p]), b = handPoints(st.hands[best]);
      if (a < b || (a === b && st.hands[p].length < st.hands[best].length)) best = p;
    }
    finish(st, best, true);
    return true;
  }
  advance(st);
  return true;
}

/** the suit an eight should name: the one the hand has most of (ties: more points) */
export function bestSuit(hand, skipIdx = -1) {
  const n = [0, 0, 0, 0], pts = [0, 0, 0, 0];
  hand.forEach((c, i) => { if (i === skipIdx || c.r === 8) return; n[c.s]++; pts[c.s] += pointsOf(c); });
  let best = 0;
  for (let s = 1; s < 4; s++) if (n[s] > n[best] || (n[s] === n[best] && pts[s] > pts[best])) best = s;
  return best;
}

/**
 * The computer's move for the player to move:
 *   { type: 'play', idx, suit? } | { type: 'draw' } | { type: 'pass' }
 * level 'random' plays any legal move; 'smart' (the game's level) keeps eights for
 * when they are needed, plays heavy cards first, and steers toward the suit it holds most of.
 */
export function choose(st, level = 'smart') {
  const plays = legalPlays(st);
  if (!plays.length) return mustDraw(st) ? { type: 'draw' } : { type: 'pass' };
  const hand = st.hands[st.turn];
  const rnd = st.rnd;
  if (level === 'random') {
    const idx = plays[Math.floor(rnd() * plays.length)];
    return hand[idx].r === 8 ? { type: 'play', idx, suit: Math.floor(rnd() * 4) } : { type: 'play', idx };
  }
  const plain = plays.filter(i => hand[i].r !== 8);
  /* going out wins on the spot: an eight as the last card, or any last card */
  if (hand.length === 1) return hand[plays[0]].r === 8 ? { type: 'play', idx: plays[0], suit: 0 } : { type: 'play', idx: plays[0] };
  if (!plain.length) {
    const idx = plays[0];
    return { type: 'play', idx, suit: bestSuit(hand, idx) };
  }
  /* an eight while the hand is nearly empty can be the way out next turn */
  const eight = plays.find(i => hand[i].r === 8);
  if (eight !== undefined && hand.length <= 2) return { type: 'play', idx: eight, suit: bestSuit(hand, eight) };
  const count = s => hand.reduce((a, c) => a + (c.s === s ? 1 : 0), 0);
  let best = -1, bestScore = -Infinity;
  for (const i of plain) {
    const c = hand[i];
    /* after this card the suit in force is c.s: staying with a suit we hold plenty of keeps options open;
       heavy cards go first because they cost the most if someone else goes out */
    const score = pointsOf(c) * 1.0 + (count(c.s) - 1) * 2.2 + rnd() * 0.01;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return { type: 'play', idx: best };
}

/** play out one whole hand between two policies (index = player); returns the finished state */
export function simulate(n, rnd, levels, first = 0, limit = 600) {
  const st = newGame(n, rnd, first);
  let guard = 0;
  while (!st.over && guard++ < limit) {
    const m = choose(st, levels[st.turn] || 'smart');
    if (m.type === 'play') play(st, m.idx, m.suit);
    else if (m.type === 'draw') draw(st);
    else pass(st);
  }
  return st;
}

export default { RANKS, SUIT_NAMES, newGame, copy, play, draw, pass, choose, legalPlays, playable, mustDraw, mustPass, canDraw, handPoints, pointsOf, bestSuit, simulate, rng32, shuffle, deck, top };
