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
       The hand is blocked the same way when the same few cards only go
       round: nobody has played a card they held, each player just
       drawing one card and playing it straight back, for two full
       rounds of everything left to draw (players × those cards × 2
       turns in a row). With no other way out that can go on for ever:
       say the four eights are all that is left to draw, and each
       player names a suit the next one doesn't hold.

   HOUSE RULES, each a switch, all off by default (off = the rules
   above). The first five are among the variations Pagat lists for
   Crazy Eights (pagat.com/eights/crazy8s.html); the last is a common
   family house rule that Pagat doesn't list:
     twos       a two makes the next player draw 2 and miss their
                turn, unless they play a two on it: then the player
                after them owes 4, and so on. While cards are owed only
                a two can be played; take() draws them all at once.
     queens     a queen skips the next player (with two players you
                go again).
     aces       an ace turns the order of play round. With two players
                the order makes no difference, so it does nothing.
     drawOne    "draw one": with nothing to play you draw ONE card;
                play a card if you now can, or pass.
     eightSuit  an eight may only be played on the suit in force (or
                on another eight); it still names the next suit.
     noEightOut you may not go out on an eight: an eight can't be
                your last card.
   The card turned up to start never has an effect, the points stay
   the same, and the computer plays by exactly the same rules.

   Randomness comes from rnd, a () => [0,1) function (the game seeds
   one from crypto, tests seed their own), so a deal is repeatable.
   The computer's choices use it only to break ties.
   ============================================================ */
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];
export const handSize = n => (n === 2 ? 7 : 5);
export const pointsOf = c => (c.r === 8 ? 50 : c.r >= 10 ? 10 : c.r);
export const handPoints = hand => hand.reduce((a, c) => a + pointsOf(c), 0);
export const codeOf = c => `${RANKS[c.r - 1]}${'CDHS'[c.s]}`;
/** '10H', 'QS', 'a2' … -> { r, s }, or null */
export function parseCode(str) {
  const m = /^(10|[A2-9JQK])([CDHS])$/i.exec(String(str).trim());
  return m ? { r: RANKS.indexOf(m[1].toUpperCase()) + 1, s: 'CDHS'.indexOf(m[2].toUpperCase()) } : null;
}

/* the house rules: id, the switch's words, and what it does in one line */
export const HOUSE = [
  { id: 'twos', label: 'Twos: draw two', note: 'A two makes the next player draw 2 and miss their turn, unless they play a two on it; then the next one owes 4, and so on.' },
  { id: 'queens', label: 'Queens skip', note: 'A queen skips the next player (with two players you go again).' },
  { id: 'aces', label: 'Aces reverse', note: 'An ace turns the order of play round. With two players it does nothing.' },
  { id: 'drawOne', label: 'Draw one, then pass', note: 'Nothing to play? Draw one card; play a card if you now can, or pass.' },
  { id: 'eightSuit', label: 'Eights follow suit', note: 'An eight can only go on the suit in force (or on another eight).' },
  { id: 'noEightOut', label: 'No going out on an eight', note: 'Your last card can’t be an eight.' },
];
/** every house rule as a boolean (anything but true is off) */
export const houseRules = r => Object.fromEntries(HOUSE.map(x => [x.id, r?.[x.id] === true]));
/** the rules in play, said plainly in one line (n: players, for the aces rule) */
export function rulesSummary(rules, n = 2) {
  const R = houseRules(rules);
  const out = [R.drawOne ? 'draw one card, then play or pass' : 'draw until you can play'];
  out.push(R.eightSuit ? 'eights only on their suit' : 'eights on anything');
  out.push(R.noEightOut ? 'no going out on an eight' : 'you may go out on an eight');
  if (R.twos) out.push('a two makes the next player draw 2 (a two on it passes them on)');
  if (R.queens) out.push('queens skip the next player');
  if (R.aces) out.push(n > 2 ? 'aces reverse the order' : 'aces reverse (no effect with two players)');
  if (!R.twos && !R.queens && !R.aces) out.push('no other card does anything special');
  const on = HOUSE.filter(x => R[x.id]).length;
  return `${on ? `House rules (${on}): ` : 'Classic rules: '}${out.join(' · ')}.`;
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

/** a new hand for n players (2–4); `first` plays first; rules: the house rules (see HOUSE) */
export function newGame(n, rnd, first = 0, rules = null) {
  /* dir: 1 or -1 (aces); pending: cards the player to move owes (twos); fx: what the last play did */
  const st = { n, rnd, hands: [], stock: shuffle(deck(), rnd), pile: [], suit: 0, turn: first % n, drawn: 0, passes: 0, over: null, plays: 0,
    rules: Object.freeze(houseRules(rules)), dir: 1, pending: 0, fx: null, idle: 0 };
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
  return { ...st, hands: st.hands.map(h => h.slice()), stock: st.stock.slice(), pile: st.pile.slice(), over: st.over ? { ...st.over } : null, fx: st.fx ? { ...st.fx } : null };
}

const NONE = Object.freeze(houseRules(null));
const rulesOf = st => st.rules || NONE;
export const top = st => st.pile[st.pile.length - 1];
/** may the player to move play card c (from their own hand)? */
export function playable(st, c) {
  const R = rulesOf(st);
  if (st.pending > 0) return c.r === 2;                       /* cards are owed: only a two answers */
  if (c.r === 8) {
    if (R.noEightOut && st.hands[st.turn].length === 1) return false;
    return !R.eightSuit || c.s === st.suit || top(st).r === 8;
  }
  return c.s === st.suit || c.r === top(st).r;
}
/** hand indexes the player to move may play */
export const legalPlays = st => (st.over ? [] : st.hands[st.turn].map((c, i) => (playable(st, c) ? i : -1)).filter(i => i >= 0));
/** is there anything left to draw (the pile under the top card counts) */
export const canDraw = st => st.stock.length + st.pile.length - 1 > 0;
/** you may draw only with nothing playable, and only if there is a card to draw
    (with "draw one", only one card a turn; while cards are owed, take() instead) */
export const mustDraw = st => !st.over && !(st.pending > 0) && legalPlays(st).length === 0 && canDraw(st) && !(rulesOf(st).drawOne && st.drawn > 0);
/** twos: the player to move owes cards and may take them now (or play a two) */
export const canTake = st => !st.over && st.pending > 0;
/** pass: with nothing to play or draw — or, with "draw one", once you have drawn */
export const canPass = st => !st.over && !(st.pending > 0)
  && ((rulesOf(st).drawOne && st.drawn > 0) || (legalPlays(st).length === 0 && !canDraw(st)));
export const mustPass = st => canPass(st) && legalPlays(st).length === 0;
/** who plays k turns from now */
export const nextPlayer = (st, k = 1) => (((st.turn + st.dir * k) % st.n) + st.n) % st.n;

function advance(st, step = 1) { st.turn = nextPlayer(st, step); st.drawn = 0; }

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
  st.fx = null;
  if (!hand.length) { finish(st, st.turn, false); return c; }
  /* the one card just drawn, played straight back: nothing the player held could go. When that
     is all anyone has done for two rounds of everything left to draw, the hand is blocked */
  st.idle = st.drawn === 1 ? (st.idle || 0) + 1 : 0;
  if (st.idle >= idleLimit(st)) { block(st); return c; }
  /* the house rules' actions: owed cards, a skip, a reversal */
  const R = rulesOf(st);
  const fx = { by: st.turn, skip: -1, reverse: false, owed: 0 };
  if (R.twos && c.r === 2) { st.pending += 2; fx.owed = st.pending; }
  if (R.aces && c.r === 1 && st.n > 2) { st.dir = -st.dir; fx.reverse = true; }
  let step = 1;
  if (R.queens && c.r === 12) { fx.skip = nextPlayer(st, 1); step = 2; }
  if (fx.owed || fx.reverse || fx.skip >= 0) st.fx = fx;
  advance(st, step);
  return c;
}

/* one card off the draw pile; an empty one is made from the pile under the top card */
function drawOne(st) {
  if (!st.stock.length) {
    if (st.pile.length < 2) return null;
    const keep = st.pile.pop();
    st.stock = shuffle(st.pile.splice(0), st.rnd);
    st.pile.push(keep);
  }
  return st.stock.pop();
}

/** draw one card (only when nothing is playable). Returns the card, or null. */
export function draw(st) {
  if (!mustDraw(st)) return null;
  const c = drawOne(st);
  st.hands[st.turn].push(c);
  st.drawn++;
  return c;
}

/** twos: take every owed card (as many as there are to draw); the turn passes. Returns the cards, or null. */
export function take(st) {
  if (!canTake(st)) return null;
  const got = [];
  for (let i = 0; i < st.pending; i++) { const c = drawOne(st); if (!c) break; got.push(c); }
  st.hands[st.turn].push(...got);
  st.pending = 0;
  st.fx = null;
  st.idle = 0;
  /* nothing at all to take counts as a pass, so a hand can still end blocked */
  if (!got.length && passBlocks(st)) return got;
  if (got.length) st.passes = 0;
  advance(st);
  return got;
}

/* one more pass in a row; true when that blocks the hand (every player passed) */
function passBlocks(st) {
  st.passes++;
  if (st.passes < st.n) return false;
  block(st);
  return true;
}
/* a blocked hand: the fewest points left wins it (then the fewest cards) */
function block(st) {
  let best = 0;
  for (let p = 1; p < st.n; p++) {
    const a = handPoints(st.hands[p]), b = handPoints(st.hands[best]);
    if (a < b || (a === b && st.hands[p].length < st.hands[best].length)) best = p;
  }
  finish(st, best, true);
}
/** turns in a row of only drawing a card and playing it back before the hand is blocked */
export const idleLimit = st => 2 * st.n * Math.max(1, st.stock.length + st.pile.length);

/** pass (only when nothing is playable and nothing can be drawn — or, with "draw one", after the draw) */
export function pass(st) {
  if (!canPass(st)) return false;
  st.fx = null;
  st.idle = 0;
  /* "draw one": a pass after drawing isn't a stuck table; only passes with nothing to draw can block the hand */
  if (rulesOf(st).drawOne && st.drawn > 0) st.passes = 0;
  else if (passBlocks(st)) return true;
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
 *   { type: 'play', idx, suit? } | { type: 'draw' } | { type: 'take' } | { type: 'pass' }
 * level 'random' plays any legal move; 'smart' (the game's level) keeps eights for
 * when they are needed, plays heavy cards first, and steers toward the suit it holds most of.
 * Both only ever pick from legalPlays(), so they keep the house rules in play; 'smart' also
 * passes owed cards on with a two, and plays a two, queen or ace sooner when the next
 * player is close to going out.
 */
export function choose(st, level = 'smart') {
  const plays = legalPlays(st);
  if (!plays.length) return canTake(st) ? { type: 'take' } : mustDraw(st) ? { type: 'draw' } : { type: 'pass' };
  const hand = st.hands[st.turn];
  const rnd = st.rnd;
  if (level === 'random') {
    const idx = plays[Math.floor(rnd() * plays.length)];
    return hand[idx].r === 8 ? { type: 'play', idx, suit: Math.floor(rnd() * 4) } : { type: 'play', idx };
  }
  const count = s => hand.reduce((a, c) => a + (c.s === s ? 1 : 0), 0);
  /* cards are owed: a two passes them on (the one of the suit we hold most of) — always better than taking them */
  if (st.pending > 0) return { type: 'play', idx: plays.reduce((b, i) => (count(hand[i].s) > count(hand[b].s) ? i : b), plays[0]) };
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
  const R = rulesOf(st);
  const left = p => st.hands[p].length;
  let best = -1, bestScore = -Infinity;
  for (const i of plain) {
    const c = hand[i];
    /* after this card the suit in force is c.s: staying with a suit we hold plenty of keeps options open;
       heavy cards go first because they cost the most if someone else goes out */
    let score = pointsOf(c) * 1.0 + (count(c.s) - 1) * 2.2 + rnd() * 0.01;
    /* house rules: an action card is worth more when the next player is close to going out */
    if (R.twos && c.r === 2) score += left(nextPlayer(st, 1)) <= 3 ? 9 : 3;
    if (R.queens && c.r === 12) score += left(nextPlayer(st, 1)) <= 2 ? 8 : 1;
    if (R.aces && c.r === 1 && st.n > 2 && left(nextPlayer(st, 1)) < left(nextPlayer(st, -1))) score += 6;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return { type: 'play', idx: best };
}

/** play out one whole hand between two policies (index = player); returns the finished state */
export function simulate(n, rnd, levels, first = 0, limit = 600, rules = null) {
  const st = newGame(n, rnd, first, rules);
  let guard = 0;
  while (!st.over && guard++ < limit) {
    const m = choose(st, levels[st.turn] || 'smart');
    if (m.type === 'play') play(st, m.idx, m.suit);
    else if (m.type === 'draw') draw(st);
    else if (m.type === 'take') take(st);
    else pass(st);
  }
  return st;
}

export default { RANKS, SUIT_NAMES, HOUSE, houseRules, rulesSummary, newGame, copy, play, draw, take, pass, choose, legalPlays, playable, mustDraw, mustPass, canPass, canTake, canDraw, nextPlayer, handPoints, pointsOf, bestSuit, simulate, rng32, shuffle, deck, top, codeOf, parseCode, idleLimit };
