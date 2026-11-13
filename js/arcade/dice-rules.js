/* ============================================================
   arcade/dice-rules.js — Five Dice: rules, scoring and the
   computer player. Pure (no DOM); shared by the game (./dice.js),
   the thinking worker (./think.js) and the tests.

   THE RULES (the game states the same):
   · Five dice, and thirteen turns — one for each box on your card.
   · On your turn you roll all five dice, then you may roll again
     twice, keeping any dice you like each time: three rolls at most.
     You may stop early. Then you must write the result in ONE empty
     box (a box that scores nothing takes a zero).
   · Upper boxes (Ones … Sixes) score the sum of the dice showing
     that number. If your upper boxes add up to 63 or more (three of
     each number) you get a bonus of 35.
   · Lower boxes: Three Alike and Four Alike (at least that many the
     same) score the sum of all five dice; Full House (three of one
     number and two of another) 25; Small Run (four in sequence) 30;
     Large Run (five in sequence) 40; Five Alike (all five the same)
     50; Chance (anything) the sum of all five.
   · EXTRA FIVE: after you have scored 50 in Five Alike, every
     further Five Alike earns a bonus of 100. You must still use it
     in a box: the matching upper box if it is empty; otherwise any
     empty lower box (Full House, Small Run and Large Run then score
     their full 25 / 30 / 40); otherwise any empty upper box for a
     zero. If you scratched Five Alike (scored 0 there) there is no
     bonus, but the same placing rules apply.
   · A game is a full card; the best possible is far above 300, a
     careful average somewhere near 200.

   RANDOMNESS comes from crypto.getRandomValues (rejection-sampled,
   so every face is exactly one in six). Tests pass a seed and get a
   repeatable sequence.
   ============================================================ */
export const CATS = [
  { id: 'ones', name: 'Ones', upper: 1, hint: 'Add up the ones' },
  { id: 'twos', name: 'Twos', upper: 2, hint: 'Add up the twos' },
  { id: 'threes', name: 'Threes', upper: 3, hint: 'Add up the threes' },
  { id: 'fours', name: 'Fours', upper: 4, hint: 'Add up the fours' },
  { id: 'fives', name: 'Fives', upper: 5, hint: 'Add up the fives' },
  { id: 'sixes', name: 'Sixes', upper: 6, hint: 'Add up the sixes' },
  { id: 'three', name: 'Three Alike', hint: 'Three or more the same: sum of all dice' },
  { id: 'four', name: 'Four Alike', hint: 'Four or more the same: sum of all dice' },
  { id: 'house', name: 'Full House', hint: 'Three of one, two of another: 25' },
  { id: 'small', name: 'Small Run', hint: 'Four in sequence: 30' },
  { id: 'large', name: 'Large Run', hint: 'Five in sequence: 40' },
  { id: 'five', name: 'Five Alike', hint: 'All five the same: 50' },
  { id: 'chance', name: 'Chance', hint: 'Any dice: sum of all dice' },
];
export const IDS = CATS.map(c => c.id);
export const UPPER_BONUS_AT = 63, UPPER_BONUS = 35, EXTRA_FIVE = 100;

/* ------------------------------ randomness ------------------------------ */
function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
}
/** a source of uniform 32-bit integers: crypto, or a seeded generator when a seed is given */
export function makeRng(seed = null) {
  if (Number.isFinite(seed)) return mulberry(seed);
  const buf = new Uint32Array(16);
  let at = 16;
  return () => {
    if (at >= 16) { (globalThis.crypto || crypto).getRandomValues(buf); at = 0; }
    return buf[at++];
  };
}
/** one fair die, 1..6 (rejection sampling, no modulo bias) */
export function die(rng) {
  const limit = Math.floor(4294967296 / 6) * 6;
  let x;
  do { x = rng(); } while (x >= limit);
  return (x % 6) + 1;
}
/** roll every die that is not held (held: array of 5 booleans); returns a new array */
export function roll(rng, dice, held) {
  return dice.map((v, i) => (held && held[i] ? v : die(rng)));
}

/* ------------------------------ scoring ------------------------------ */
export const counts = dice => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const v of dice) c[v]++; return c; };
const sum = dice => dice.reduce((a, b) => a + b, 0);
export const isFive = dice => dice.length === 5 && dice.every(v => v === dice[0]);
const run = (c, len) => {
  for (let s = 1; s + len - 1 <= 6; s++) { let ok = true; for (let k = 0; k < len; k++) if (!c[s + k]) { ok = false; break; } if (ok) return true; }
  return false;
};
/** points for putting `dice` in box `cat`, as if it were a normal roll (no extra-five joker) */
export function rawScore(cat, dice) {
  const c = counts(dice), top = Math.max(...c);
  const i = IDS.indexOf(cat);
  if (i < 0) return 0;
  if (i < 6) return c[i + 1] * (i + 1);
  switch (cat) {
    case 'three': return top >= 3 ? sum(dice) : 0;
    case 'four': return top >= 4 ? sum(dice) : 0;
    case 'house': return top === 3 && c.includes(2) ? 25 : 0;
    case 'small': return run(c, 4) ? 30 : 0;
    case 'large': return run(c, 5) ? 40 : 0;
    case 'five': return top === 5 ? 50 : 0;
    default: return sum(dice);
  }
}

export const newCard = () => ({ s: Object.fromEntries(IDS.map(id => [id, null])), extra: 0 });
export const cardCopy = c => ({ s: { ...c.s }, extra: c.extra });
export const open = card => IDS.filter(id => card.s[id] === null);
export const isFull = card => open(card).length === 0;

/** does this roll count as an extra five (a Five Alike when the Five box is already filled)? */
export const isExtraFive = (card, dice) => isFive(dice) && card.s.five !== null;

/** the boxes this roll may go in: everything open, except the joker restrictions after an extra five */
export function allowed(card, dice) {
  const o = open(card);
  if (!o.length) return [];
  if (!isExtraFive(card, dice)) return o;
  const upperId = IDS[dice[0] - 1];
  if (card.s[upperId] === null) return [upperId];
  const lower = o.filter(id => !CATS[IDS.indexOf(id)].upper);
  return lower.length ? lower : o;
}
/** what the roll would score in `cat` on `card`, including the joker values for Full House and the runs */
export function scoreFor(card, dice, cat) {
  if (isExtraFive(card, dice) && allowed(card, dice).includes(cat)) {
    if (cat === 'house') return 25;
    if (cat === 'small') return 30;
    if (cat === 'large') return 40;
  }
  return rawScore(cat, dice);
}
/** write `dice` into `cat`; returns the points (null if the box is not allowed) and adds the extra-five bonus */
export function fill(card, dice, cat) {
  if (!allowed(card, dice).includes(cat)) return null;
  const pts = scoreFor(card, dice, cat);
  if (isExtraFive(card, dice) && card.s.five === 50) card.extra += EXTRA_FIVE;
  card.s[cat] = pts;
  return pts;
}
export function totals(card) {
  let upper = 0, lower = 0;
  CATS.forEach(c => { const v = card.s[c.id] || 0; if (c.upper) upper += v; else lower += v; });
  const bonus = upper >= UPPER_BONUS_AT ? UPPER_BONUS : 0;
  return { upper, bonus, lower, extra: card.extra, total: upper + bonus + lower + card.extra, toBonus: Math.max(0, UPPER_BONUS_AT - upper) };
}

/* ------------------------------ the computer ------------------------------ */
/* roughly what a box is worth on average: a zero costs this much, a score above it is a gain */
const PAR = { ones: 2.6, twos: 5.2, threes: 7.8, fours: 10.4, fives: 13, sixes: 15.6, three: 21, four: 13, house: 22, small: 28, large: 30, five: 16, chance: 22 };
const worth = (card, dice, cat) => {
  const pts = scoreFor(card, dice, cat);
  let v = pts - PAR[cat];
  const up = CATS[IDS.indexOf(cat)].upper;
  if (up) v += (pts - 3 * up) * 0.5;                         /* three of a number keeps the bonus alive */
  if (isExtraFive(card, dice) && card.s.five === 50) v += EXTRA_FIVE;
  return v;
};

/* every multiset of five dice, indexed; and for each the ways to hold some and reroll the rest */
const KEYS = [], KEY_AT = new Map();
(function build() {
  const rec = (left, min, cur) => {
    if (!left) { KEY_AT.set(cur.join(''), KEYS.length); KEYS.push(cur.slice()); return; }
    for (let v = min; v <= 6; v++) { cur.push(v); rec(left - 1, v, cur); cur.pop(); }
  };
  rec(5, 1, []);
})();
const keyOf = dice => KEY_AT.get(dice.slice().sort((a, b) => a - b).join(''));
const FACT = [1, 1, 2, 6, 24, 120];
/* distribution of k fresh dice as multisets: [{ key (sorted digits), p }] */
const REROLL = (() => {
  const out = [[{ d: [], p: 1 }]];
  for (let k = 1; k <= 5; k++) {
    const list = [];
    const rec = (left, min, cur) => {
      if (!left) {
        const c = counts(cur);
        let ways = FACT[k];
        for (let v = 1; v <= 6; v++) ways /= FACT[c[v]];
        list.push({ d: cur.slice(), p: ways / 6 ** k });
        return;
      }
      for (let v = min; v <= 6; v++) { cur.push(v); rec(left - 1, v, cur); cur.pop(); }
    };
    rec(k, 1, []);
    out.push(list);
  }
  return out;
})();
/* for each multiset, each distinct hold of some of its dice: the chance of landing on each final multiset after rerolling the rest */
const TRANS = KEYS.map(dice => {
  const seen = new Map();
  for (let m = 0; m < 31; m++) {
    const kept = dice.filter((_, i) => m & (1 << i));
    const k = kept.join('');
    if (!seen.has(k)) seen.set(k, kept);
  }
  return [...seen.values()].map(kept => REROLL[5 - kept.length].map(o => [KEY_AT.get([...kept, ...o.d].sort((x, y) => x - y).join('')), o.p]));
});
const evOf = (list, V) => { let ev = 0; for (const [k, p] of list) ev += p * V[k]; return ev; };

/**
 * The computer's turn, step by step. Given the card, the current dice and
 * how many rolls are left, returns { hold: [bool x 5] } (all true = stop
 * rolling) or, with no rolls left, { cat }.
 */
export function think(card, dice, rollsLeft) {
  if (rollsLeft <= 0) {
    let best = null, bv = -Infinity;
    for (const id of allowed(card, dice)) { const v = worth(card, dice, id); if (v > bv) { bv = v; best = id; } }
    return { cat: best, value: bv };
  }
  /* V[0][key]: the best box value for a final roll; V[r][key]: the best value with r rolls left */
  const final = KEYS.map(ks => {
    let best = -Infinity;
    for (const id of allowed(card, ks)) best = Math.max(best, worth(card, ks, id));
    return best;
  });
  const V = [final];
  for (let r = 1; r < rollsLeft; r++) {
    const prev = V[r - 1];
    V.push(KEYS.map((_, ki) => {
      let best = prev[ki];
      for (const list of TRANS[ki]) { const ev = evOf(list, prev); if (ev > best) best = ev; }
      return best;
    }));
  }
  /* choose among the holds of the actual roll: stopping scores `final`, holding m scores the average of V[rollsLeft - 1] after the reroll */
  const prev = V[rollsLeft - 1];
  let bestMask = 31, bestV = final[keyOf(dice)];
  for (let m = 0; m < 31; m++) {
    const kept = dice.filter((_, i) => m & (1 << i));
    let ev = 0;
    for (const o of REROLL[5 - kept.length]) ev += o.p * prev[KEY_AT.get([...kept, ...o.d].sort((x, y) => x - y).join(''))];
    if (ev > bestV + 1e-9) { bestV = ev; bestMask = m; }
  }
  return { hold: dice.map((_, i) => !!(bestMask & (1 << i))), value: bestV };
}

/** play one whole solo game with a policy, for tests and for measuring: returns the final card */
export function playGame(rng, pick) {
  const card = newCard();
  for (let turn = 0; turn < 13; turn++) {
    let dice = roll(rng, [0, 0, 0, 0, 0], null), left = 2;
    while (left > 0) {
      const d = pick.hold(card, dice, left);
      if (d.every(Boolean)) break;
      dice = roll(rng, dice, d);
      left--;
    }
    fill(card, dice, pick.cat(card, dice));
  }
  return card;
}
export const COMPUTER = {
  hold: (card, dice, left) => think(card, dice, left).hold,
  cat: (card, dice) => think(card, dice, 0).cat,
};
