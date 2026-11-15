/* ============================================================
   arcade/blackjack-rules.js — Blackjack's rules, for points only.

   Pure (no DOM), shared by the game (./blackjack.js) and the
   play-tests. Cards are { r: 1–13 (A…K), s: 0–3 } like ./cardrules.js.
   The points are a score kept for fun: nothing here is money, and
   nothing can be bought, sold or exchanged.

   THE RULE SET (the usual American table rules):
     · a shoe of 1, 2, 4, 6 or 8 decks (six unless you choose another),
       shuffled before a hand once three quarters of it have been dealt
       (fewer than a quarter left: 13 of 52 with one deck, 78 of 312
       with six); if it ever runs out during a hand, the cards that are
       not on the table are shuffled into a new shoe;
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
/* decks: the shoe a new table starts with (a table keeps its own, t.decks) */
export const RULES = Object.freeze({
  decks: 6, reshuffleAt: 0.25, dealerStandsSoft17: true, blackjackPays: '3 to 2', doubleAny: true, doubleAfterSplit: true,
  maxHands: 4, resplitAces: false, insurance: false, surrender: false,
});
export const DECKS = [1, 2, 4, 6, 8];
export const deckCount = n => (DECKS.includes(n) ? n : RULES.decks);
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

/** a table: a shoe of `decks` decks and some points. */
export function newTable(rnd, points = START_POINTS, { manual = false, decks = RULES.decks } = {}) {
  const n = deckCount(decks);
  return { manual, rnd, decks: n, shoe: freshShoe(rnd, n), shuffled: 1, points, phase: 'idle', dealer: [], hands: [], active: 0, hole: false, results: null, net: 0, rounds: 0 };
}
/** the shoe's full size, and the count below which it is shuffled before a hand */
export const shoeSize = t => 52 * t.decks;
export const cutAt = t => Math.ceil(shoeSize(t) * RULES.reshuffleAt);
export const needsShuffle = t => t.shoe.length < cutAt(t);
export function reshuffle(t) { t.shoe = freshShoe(t.rnd, t.decks); t.shuffled++; }
/** a new shoe of n decks, between hands only. Returns false when not allowed. */
export function setDecks(t, n) {
  if (!DECKS.includes(n) || t.phase === 'play' || t.phase === 'dealer') return false;
  t.decks = n;
  reshuffle(t);
  return true;
}
function take(t) {
  if (!t.shoe.length) {
    /* ran out mid-hand: a new shoe without the cards on the table */
    const shoe = freshShoe(t.rnd, t.decks);
    for (const c of [...t.dealer, ...t.hands.flatMap(h => h.cards)]) { const i = shoe.findIndex(x => x.r === c.r && x.s === c.s); if (i >= 0) shoe.splice(i, 1); }
    t.shoe = shoe;
    t.shuffled++;
  }
  return t.shoe.pop();
}
const live = h => !h.done;
const mkHand = (cards, stake, fromSplit = false, aces = false) => ({ cards, stake, fromSplit, doubled: false, done: false, splitAces: aces, outcome: null, delta: 0 });

export const canDeal = (t, stake) => (t.phase === 'idle' || t.phase === 'settled') && STAKES.includes(stake) && stake <= t.points;
export const broke = t => (t.phase === 'idle' || t.phase === 'settled') && t.points < MIN_STAKE;

/** start a hand with `stake` points in play. Returns false when it is not allowed. */
export function deal(t, stake) {
  if (!canDeal(t, stake)) return false;
  if (needsShuffle(t)) reshuffle(t);
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

/* ============================================================
   BASIC STRATEGY — the best move for your cards against the
   dealer's up card, for this game's rules. Copied cell by cell from
   Michael Shackleford's published charts at The Wizard of Odds
   (wizardofodds.com/games/blackjack/strategy/ — the "Dealer Stands
   on Soft 17" chart for each shoe: "Single-Deck" (1-deck page),
   "Double-Deck" (2-decks page) and "4-8 Decks" (4-decks page)).
   Those charts assume what this game does: the dealer stands on
   soft 17 and peeks for blackjack, double on any first two cards,
   split up to four hands. One chart per shoe: 1 deck, 2 decks, and
   the 4–8 deck chart for 4, 6 and 8.
   Their codes, and how this game reads them (it allows doubling
   after a split and has no surrender):
     H hit · S stand · Dh double if allowed, else hit · Ds double if
     allowed, else stand · P split · Ph split if doubling after a
     split is allowed (it is), else hit · Pd split if doubling after
     a split is allowed (it is), else double · Rh / Rs surrender if
     allowed (it isn't), else hit / stand.
   Columns: the dealer's 2 3 4 5 6 7 8 9 10 A. A row number is your
   total; the first hard row covers everything below it, the last
   hard and soft rows everything above. Pairs are by card value
   (11 = aces); 5s and 10s have no row: they are played as 10 and 20.
   ============================================================ */
const row = s => s.split(' ');
export const CHARTS = {
  1: {
    hard: {
      7: row('H H H H H H H H H H'),
      8: row('H H H Dh Dh H H H H H'),
      9: row('Dh Dh Dh Dh Dh H H H H H'),
      10: row('Dh Dh Dh Dh Dh Dh Dh Dh H H'),
      11: row('Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh'),
      12: row('H H S S S H H H H H'),
      13: row('S S S S S H H H H H'),
      14: row('S S S S S H H H H H'),
      15: row('S S S S S H H H H H'),
      16: row('S S S S S H H H Rh Rh'),
      17: row('S S S S S S S S S S'),
    },
    soft: {
      13: row('H H Dh Dh Dh H H H H H'),
      14: row('H H Dh Dh Dh H H H H H'),
      15: row('H H Dh Dh Dh H H H H H'),
      16: row('H H Dh Dh Dh H H H H H'),
      17: row('Dh Dh Dh Dh Dh H H H H H'),
      18: row('S Ds Ds Ds Ds S S H H S'),
      19: row('S S S S Ds S S S S S'),
      20: row('S S S S S S S S S S'),
    },
    pair: {
      2: row('Ph P P P P P H H H H'),
      3: row('Ph Ph P P P P Ph H H H'),
      4: row('H H Ph Pd Pd H H H H H'),
      6: row('P P P P P Ph H H H H'),
      7: row('P P P P P P Ph H Rs H'),
      8: row('P P P P P P P P P P'),
      9: row('P P P P P S P P S S'),
      11: row('P P P P P P P P P P'),
    },
  },
  2: {
    hard: {
      8: row('H H H H H H H H H H'),
      9: row('Dh Dh Dh Dh Dh H H H H H'),
      10: row('Dh Dh Dh Dh Dh Dh Dh Dh H H'),
      11: row('Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh'),
      12: row('H H S S S H H H H H'),
      13: row('S S S S S H H H H H'),
      14: row('S S S S S H H H H H'),
      15: row('S S S S S H H H Rh H'),
      16: row('S S S S S H H H Rh Rh'),
      17: row('S S S S S S S S S S'),
    },
    soft: {
      13: row('H H H Dh Dh H H H H H'),
      14: row('H H H Dh Dh H H H H H'),
      15: row('H H Dh Dh Dh H H H H H'),
      16: row('H H Dh Dh Dh H H H H H'),
      17: row('H Dh Dh Dh Dh H H H H H'),
      18: row('S Ds Ds Ds Ds S S H H H'),
      19: row('S S S S S S S S S S'),
    },
    pair: {
      2: row('Ph Ph P P P P H H H H'),
      3: row('Ph Ph P P P P H H H H'),
      4: row('H H H Ph Ph H H H H H'),
      6: row('P P P P P Ph H H H H'),
      7: row('P P P P P P Ph H H H'),
      8: row('P P P P P P P P P P'),
      9: row('P P P P P S P P S S'),
      11: row('P P P P P P P P P P'),
    },
  },
  4: {
    hard: {
      8: row('H H H H H H H H H H'),
      9: row('H Dh Dh Dh Dh H H H H H'),
      10: row('Dh Dh Dh Dh Dh Dh Dh Dh H H'),
      11: row('Dh Dh Dh Dh Dh Dh Dh Dh Dh H'),
      12: row('H H S S S H H H H H'),
      13: row('S S S S S H H H H H'),
      14: row('S S S S S H H H H H'),
      15: row('S S S S S H H H Rh H'),
      16: row('S S S S S H H Rh Rh Rh'),
      17: row('S S S S S S S S S S'),
    },
    soft: {
      13: row('H H H Dh Dh H H H H H'),
      14: row('H H H Dh Dh H H H H H'),
      15: row('H H Dh Dh Dh H H H H H'),
      16: row('H H Dh Dh Dh H H H H H'),
      17: row('H Dh Dh Dh Dh H H H H H'),
      18: row('S Ds Ds Ds Ds S S H H H'),
      19: row('S S S S S S S S S S'),
    },
    pair: {
      2: row('Ph Ph P P P P H H H H'),
      3: row('Ph Ph P P P P H H H H'),
      4: row('H H H Ph Ph H H H H H'),
      6: row('Ph P P P P H H H H H'),
      7: row('P P P P P P H H H H'),
      8: row('P P P P P P P P P P'),
      9: row('P P P P P S P P S S'),
      11: row('P P P P P P P P P P'),
    },
  },
};
/** the chart for a shoe of n decks */
export const chartFor = n => CHARTS[n >= 4 ? 4 : n === 2 ? 2 : 1];
/* the chart's cell for a total: below the first row is the first row, above the last the last */
function cell(rows, total, col) {
  const keys = Object.keys(rows).map(Number);
  const k = Math.max(keys[0], Math.min(keys[keys.length - 1], total));
  return rows[k][col];
}

/**
 * The basic-strategy move for `cards` against the dealer's up card,
 * with what the table allows right now:
 *   basicMove(cards, up, { decks, canDouble, canSplit })
 *     -> { move: 'hit'|'stand'|'double'|'split', code, chart: 'hard'|'soft'|'pair', total }
 */
export function basicMove(cards, up, { decks = RULES.decks, canDouble = false, canSplit = false } = {}) {
  const ch = chartFor(decks);
  const col = valueOf(up) === 11 ? 9 : valueOf(up) - 2;           /* 2…9 → 0…7, a ten-card → 8, an ace → 9 */
  const v = handValue(cards);
  const pairVal = cards.length === 2 && valueOf(cards[0]) === valueOf(cards[1]) ? valueOf(cards[0]) : 0;
  const read = code => {
    if (code === 'Dh') return canDouble ? 'double' : 'hit';
    if (code === 'Ds') return canDouble ? 'double' : 'stand';
    if (code === 'P') return 'split';
    if (code === 'Ph') return RULES.doubleAfterSplit ? 'split' : 'hit';
    if (code === 'Pd') return RULES.doubleAfterSplit ? 'split' : canDouble ? 'double' : 'hit';
    if (code === 'S' || code === 'Rs') return 'stand';      /* no surrender here */
    return 'hit';                                           /* H, Rh */
  };
  if (pairVal && ch.pair[pairVal]) {
    const code = ch.pair[pairVal][col], move = read(code);
    /* a split the table won't allow (four hands, not enough points): play the total instead */
    if (move !== 'split' || canSplit) return { move, code, chart: 'pair', total: v.total };
  }
  if (v.soft && v.total <= 12) return { move: 'hit', code: 'H', chart: 'soft', total: v.total };   /* two aces that can't be split */
  const chart = v.soft ? 'soft' : 'hard';
  const code = cell(ch[chart], v.total, col);
  return { move: read(code), code, chart, total: v.total };
}

const PAST = { hit: 'hit', stand: 'stood', double: 'doubled', split: 'split' };
const upWords = c => (c.r === 1 ? 'an ace' : valueOf(c) === 8 ? 'an 8' : `a ${valueOf(c)}`);
const pairWords = c => (c.r === 1 ? 'aces' : `${valueOf(c)}s`);
/** "double 11 against a 6", "split 8s against a 10", "stand on soft 18 against a 7" */
export function adviceWords(cards, up, adv) {
  const v = handValue(cards);
  const pair = cards.length === 2 && valueOf(cards[0]) === valueOf(cards[1]);
  const what = pair && adv.chart === 'pair' ? `a pair of ${pairWords(cards[0])}` : v.soft ? `soft ${v.total}` : String(v.total);
  const verb = adv.move === 'split' ? `split ${pairWords(cards[0])}` : adv.move === 'stand' ? `stand on ${what}` : `${adv.move} ${what}`;
  return `${verb} against ${upWords(up)}`;
}
/**
 * One line after a hand. moves: [{ cards, up, choice, adv }] in the order made
 * (adv = basicMove() at that moment, with what the table allowed then).
 */
export function tipText(moves) {
  if (!moves.length) return 'No moves to check: the hand was over at the deal.';
  const off = moves.filter(m => m.adv.move !== m.choice);
  if (!off.length) return moves.length === 1 ? 'Basic strategy agrees with your move.' : `Basic strategy agrees with all ${moves.length} of your moves.`;
  const say = m => `${adviceWords(m.cards, m.up, m.adv)} — you ${PAST[m.choice]}`;
  const more = off.length > 2 ? ` (and ${off.length - 2} more)` : '';
  return `Basic strategy: ${off.slice(0, 2).map(say).join('; ')}${more}.`;
}

export default { RULES, DECKS, STAKES, START_POINTS, newTable, deal, hit, stand, double, split, dealerStep, dealerPlay, settle, handValue, isBlackjack, isBust, textOf, canHit, canStand, canDouble, canSplit, canDeal, broke, current, codeOf, parseCode, valueOf, setDecks, reshuffle, needsShuffle, shoeSize, cutAt, basicMove, adviceWords, tipText, chartFor };
