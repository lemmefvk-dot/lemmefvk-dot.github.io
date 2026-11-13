/* ============================================================
   arcade/blackjack-rules.js — Blackjack's rules, for points only.

   Pure (no DOM), shared by the game (./blackjack.js) and the
   play-tests. Cards are { r: 1–13 (A…K), s: 0–3 } like ./cardrules.js.
   The points are a score kept for fun: nothing here is money, and
   nothing can be bought, sold or exchanged.

   THE RULE SET (the usual American table rules):
     · six decks, shuffled when a quarter is left at the start of a hand;
     · cards count their number, J Q K count 10, an ace is 11 unless
       that would go over 21, then 1 (a "soft" hand holds an ace
       counted as 11);
     · you put some of your points in play, then you and the dealer get
       two cards each; one dealer card stays face down;
     · the dealer checks for blackjack at once when showing an ace or a
       ten-count card; a dealer blackjack ends the hand (your own
       blackjack is then a push, otherwise you lose);
     · a BLACKJACK (an ace and a ten-count card as your first two
       cards) scores 3 for every 2 points in play; split hands that
       reach 21 are an ordinary 21, not a blackjack;
     · HIT takes a card, STAND stops, over 21 is a bust and loses at once;
     · DOUBLE (any first two cards, also after a split): double the points
       in play, take exactly one card, then stand;
     · SPLIT two cards of the same value into two hands, each with its own
       points in play; up to four hands, but aces split only once and
       each split ace gets one card only;
     · the dealer plays last and draws to 16 and STANDS ON EVERY 17,
       soft 17 included; the dealer does not draw when every one of your
       hands has busted;
     · a win returns your points in play plus the same again, a push
       returns them, a loss keeps them. No insurance, no surrender.

   Randomness comes from rnd, a () => [0,1) function (the game seeds one
   from crypto, tests seed their own).
   ============================================================ */
export const RULES = Object.freeze({
  decks: 6, reshuffleAt: 0.25, dealerStandsSoft17: true, blackjackPays: '3 to 2', doubleAny: true, doubleAfterSplit: true,
  maxHands: 4, resplitAces: false, insurance: false, surrender: false,
});
export const STAKES = [10, 20, 50, 100];
export const START_POINTS = 500;
export const MIN_STAKE = STAKES[0];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const valueOf = c => (c.r === 1 ? 11 : Math.min(10, c.r));
export const codeOf = c => `${RANKS[c.r - 1]}${'CDHS'[c.s]}`;
export function parseCode(str) {
  const m = /^(10|[A2-9JQK])([CDHS])$/i.exec(String(str).trim());
  return m ? { r: RANKS.indexOf(m[1].toUpperCase()) + 1, s: 'CDHS'.indexOf(m[2].toUpperCase()) } : null;
}

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const cryptoSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;

/** { total, soft } — the best total not over 21; soft when an ace counts 11 */
export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += c.r === 1 ? 1 : Math.min(10, c.r); if (c.r === 1) aces++; }
  if (aces && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}
export const isBust = cards => handValue(cards).total > 21;
/** a natural: two cards, 21, and not from a split */
export const isBlackjack = (cards, fromSplit = false) => !fromSplit && cards.length === 2 && handValue(cards).total === 21;
export const textOf = cards => {
  const v = handValue(cards);
  return v.total > 21 ? `Bust (${v.total})` : v.soft && v.total < 21 ? `Soft ${v.total}` : String(v.total);
};

function freshShoe(rnd, decks) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }
  return shoe;
}

/** a table: a shoe and some points. */
export function newTable(rnd, points = START_POINTS, { manual = false } = {}) {
  return { manual, rnd, shoe: freshShoe(rnd, RULES.decks), shuffled: 1, points, phase: 'idle', dealer: [], hands: [], active: 0, hole: false, results: null, net: 0, rounds: 0 };
}
function take(t) {
  if (!t.shoe.length) { t.shoe = freshShoe(t.rnd, RULES.decks); t.shuffled++; }
  return t.shoe.pop();
}
const live = h => !h.done;
const mkHand = (cards, stake, fromSplit = false, aces = false) => ({ cards, stake, fromSplit, doubled: false, done: false, splitAces: aces, outcome: null, delta: 0 });

export const canDeal = (t, stake) => (t.phase === 'idle' || t.phase === 'settled') && STAKES.includes(stake) && stake <= t.points;
export const broke = t => (t.phase === 'idle' || t.phase === 'settled') && t.points < MIN_STAKE;

/** start a hand with `stake` points in play. Returns false when it is not allowed. */
export function deal(t, stake) {
  if (!canDeal(t, stake)) return false;
  if (t.shoe.length < 52 * RULES.decks * RULES.reshuffleAt) { t.shoe = freshShoe(t.rnd, RULES.decks); t.shuffled++; }
  t.points -= stake;
  t.rounds++;
  const p1 = take(t), d1 = take(t), p2 = take(t), d2 = take(t);
  t.dealer = [d1, d2];
  t.hands = [mkHand([p1, p2], stake)];
  t.active = 0;
  t.hole = true;
  t.results = null;
  t.net = 0;
  const dealerBJ = isBlackjack(t.dealer), playerBJ = isBlackjack(t.hands[0].cards);
  const peek = valueOf(d1) >= 10;
  if ((peek && dealerBJ) || playerBJ) { t.hole = false; t.hands[0].done = true; settle(t); return true; }
  t.phase = 'play';
  return true;
}

export const current = t => (t.phase === 'play' ? t.hands[t.active] : null);
export const canHit = t => { const h = current(t); return !!h && !h.done && !h.splitAces; };
export const canStand = t => { const h = current(t); return !!h && !h.done; };
export const canDouble = t => { const h = current(t); return !!h && !h.done && h.cards.length === 2 && !h.splitAces && t.points >= h.stake && (!h.fromSplit || RULES.doubleAfterSplit); };
export const canSplit = t => {
  const h = current(t);
  return !!h && !h.done && h.cards.length === 2 && valueOf(h.cards[0]) === valueOf(h.cards[1]) && t.hands.length < RULES.maxHands
    && t.points >= h.stake && !(h.splitAces && !RULES.resplitAces);
};

function nextHand(t) {
  /* move to the next hand still to play; a split hand waiting for its second card gets it now */
  while (t.active < t.hands.length) {
    const h = t.hands[t.active];
    if (!h.done) {
      if (h.cards.length === 1) { h.cards.push(take(t)); if (h.splitAces || handValue(h.cards).total === 21) h.done = true; if (h.done) { t.active++; continue; } }
      return;
    }
    t.active++;
  }
  dealerPlay(t);
}

export function hit(t) {
  if (!canHit(t)) return null;
  const h = current(t), c = take(t);
  h.cards.push(c);
  const v = handValue(h.cards).total;
  if (v >= 21) { h.done = true; nextHand(t); }
  return c;
}
export function stand(t) {
  if (!canStand(t)) return false;
  current(t).done = true;
  t.active++;
  nextHand(t);
  return true;
}
export function double(t) {
  if (!canDouble(t)) return null;
  const h = current(t);
  t.points -= h.stake;
  h.stake *= 2;
  h.doubled = true;
  const c = take(t);
  h.cards.push(c);
  h.done = true;
  t.active++;
  nextHand(t);
  return c;
}
export function split(t) {
  if (!canSplit(t)) return false;
  const h = current(t);
  t.points -= h.stake;
  const [a, b] = h.cards;
  const aces = a.r === 1;
  const first = mkHand([a], h.stake, true, aces), second = mkHand([b], h.stake, true, aces);
  t.hands.splice(t.active, 1, first, second);
  nextHand(t);
  return true;
}

/** the dealer's turn: reveal, then draw to 16 (stand on all 17s). */
export function dealerPlay(t) {
  t.phase = 'dealer';
  t.hole = false;
  if (t.hands.every(h => handValue(h.cards).total > 21)) { settle(t); return; }
  /* a table made with { manual: true } leaves the draws to dealerStep() so the game can show them one at a time */
  if (!t.manual) while (dealerStep(t));
}
/** one dealer draw if the dealer must draw; returns the card, or null (then settle) */
export function dealerStep(t) {
  if (t.phase !== 'dealer') return null;
  const v = handValue(t.dealer);
  const draws = v.total < 17 || (v.total === 17 && v.soft && !RULES.dealerStandsSoft17);
  if (!draws || t.hands.every(h => handValue(h.cards).total > 21)) { settle(t); return null; }
  const c = take(t);
  t.dealer.push(c);
  return c;
}

/** score every hand against the dealer and pay out. */
export function settle(t) {
  const d = handValue(t.dealer).total, dBJ = isBlackjack(t.dealer);
  let net = 0;
  for (const h of t.hands) {
    const v = handValue(h.cards).total;
    let out, pay;
    if (v > 21) { out = 'bust'; pay = 0; }
    else if (isBlackjack(h.cards, h.fromSplit)) { if (dBJ) { out = 'push'; pay = h.stake; } else { out = 'blackjack'; pay = h.stake * 2.5; } }
    else if (dBJ) { out = 'lose'; pay = 0; }
    else if (d > 21 || v > d) { out = 'win'; pay = h.stake * 2; }
    else if (v === d) { out = 'push'; pay = h.stake; }
    else { out = 'lose'; pay = 0; }
    h.outcome = out;
    h.delta = pay - h.stake;
    t.points += pay;
    net += h.delta;
  }
  t.net = net;
  t.results = t.hands.map(h => ({ outcome: h.outcome, delta: h.delta, total: handValue(h.cards).total }));
  t.phase = 'settled';
  t.hole = false;
}

export default { RULES, STAKES, START_POINTS, newTable, deal, hit, stand, double, split, dealerStep, dealerPlay, settle, handValue, isBlackjack, isBust, textOf, canHit, canStand, canDouble, canSplit, canDeal, broke, current, codeOf, parseCode, valueOf };
