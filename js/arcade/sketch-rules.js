/* ============================================================
   arcade/sketch-rules.js — Sketch & Guess without a screen: the word
   list, guess matching, scoring, the schema every message must pass,
   and the host's turn engine. Pure (no DOM, no network, no clock but
   the one it is given), shared by ./sketch.js and the play-tests.

   HOW A ROOM RUNS (the engine is the host's; ./sketch.js carries it):
     lobby → rounds of turns → end. In a turn one player (the drawer)
     draws a secret word and the others type guesses. A right guess
     scores for the guesser (more the sooner it comes, a bonus for the
     first) and for the drawer; the turn ends when everyone has it, the
     time is up, or the drawer leaves. Then the word is shown, and the
     next player draws. Everyone present draws once a round.
       · a player who arrives after the game began waits and joins at
         the next round (they can watch, not guess);
       · if the drawer leaves, the turn ends at once and the next
         player draws; with fewer than two players left the room goes
         back to the lobby;
       · the host can remove a player: their guesses stop showing, and
         the same session or name can't knock again.

   WHO KNOWS THE WORD. Only the drawer's device ever holds it. The
   host chooses whose turn it is, never the word. Guesses are sealed
   to the drawer with a key made for that turn (ECDH, see sketch.js),
   so even the other guessers can't read a right answer off the wire;
   the drawer's device compares by normalised text and announces
   only "this player got it" (or shows a wrong guess as text). The
   word itself is sent once, after the turn is over.

   Everything that arrives passes check(m) below: a cleaned copy or
   null. Strokes are the Draw Together stroke (../core/drawsync.js)
   with a smaller cap; names and guesses are plain text, never HTML.
   ============================================================ */
import { checkers as drawCheckers } from '../core/drawsync.js';
import { safeName, cleanText, hueOf } from '../core/roomcode.js';

export const CANVAS = Object.freeze({ w: 600, h: 400 });
export const LIMITS = Object.freeze({
  players: 10, strokesPerTurn: 400, pointsPerStroke: 400, batch: 60, guessLen: 40, guessesPerTurn: 40, wordLen: 30,
  revealMs: 4500, quietMs: 14000, turnChoices: [45000, 75000, 120000], roundChoices: [1, 2, 3], strokeMsgsPerSec: 60, guessGapMs: 600,
});
export const PHASES = ['lobby', 'draw', 'reveal', 'end'];
const WHYS = new Set(['', 'time', 'all', 'left', 'few']);
const ID_RE = /^[a-z0-9]{10}$/;
const TID_RE = /^[a-z0-9]{6}$/;
const B64 = /^[A-Za-z0-9+/=]+$/;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/* ---------------------------- words ---------------------------- */
/* Original list, plain things a student can draw. Short words first in each group. */
export const WORDS = [
  /* animals */ 'cat', 'dog', 'fish', 'bird', 'horse', 'cow', 'pig', 'duck', 'frog', 'snake', 'spider', 'butterfly', 'elephant', 'giraffe', 'penguin', 'owl', 'shark', 'whale', 'turtle', 'rabbit', 'monkey', 'lion', 'bee', 'snail', 'octopus', 'camel', 'kangaroo', 'dolphin', 'bat', 'crab',
  /* food */ 'apple', 'banana', 'pizza', 'cake', 'cheese', 'carrot', 'bread', 'egg', 'ice cream', 'sandwich', 'popcorn', 'cookie', 'pear', 'grapes', 'lemon', 'pancake', 'soup', 'cherry', 'pumpkin', 'corn', 'watermelon', 'donut', 'hot dog', 'taco',
  /* home and school */ 'chair', 'table', 'bed', 'lamp', 'door', 'window', 'clock', 'key', 'book', 'pencil', 'scissors', 'backpack', 'ruler', 'globe', 'desk', 'computer', 'phone', 'camera', 'umbrella', 'glasses', 'toothbrush', 'candle', 'mirror', 'broom', 'bucket', 'ladder', 'envelope', 'calendar', 'headphones', 'battery',
  /* nature and weather */ 'sun', 'moon', 'star', 'cloud', 'rain', 'snowman', 'tree', 'flower', 'mountain', 'river', 'volcano', 'rainbow', 'island', 'cactus', 'leaf', 'waterfall', 'lightning', 'tornado', 'beach', 'forest', 'cave', 'desert',
  /* transport and places */ 'car', 'bus', 'train', 'boat', 'plane', 'bicycle', 'rocket', 'helicopter', 'tractor', 'submarine', 'bridge', 'castle', 'house', 'school', 'lighthouse', 'tent', 'farm', 'hospital', 'airport', 'skateboard', 'sailboat', 'tunnel', 'windmill',
  /* things and fun */ 'ball', 'kite', 'drum', 'guitar', 'piano', 'robot', 'crown', 'balloon', 'trophy', 'treasure map', 'magnet', 'telescope', 'compass', 'anchor', 'puzzle', 'dice', 'bowling', 'swing', 'slide', 'trampoline', 'campfire', 'fireworks', 'ghost', 'dragon', 'pirate', 'astronaut', 'wizard', 'mermaid', 'scarecrow', 'snow globe',
  /* more things to draw */ 'sock', 'shoe', 'hat', 'jacket', 'bottle', 'spoon', 'fork', 'cup', 'plate', 'pizza slice', 'basket', 'bell', 'flag', 'ring', 'coin', 'wallet', 'purse', 'lock', 'brush', 'comb', 'towel', 'soap', 'pillow', 'blanket', 'couch', 'fridge', 'oven', 'toaster', 'kettle', 'teapot', 'fan', 'heater', 'radio', 'television', 'microphone', 'flashlight', 'hammer', 'saw', 'screwdriver', 'wrench', 'shovel', 'rake', 'wheelbarrow', 'garden', 'fence', 'gate', 'mailbox', 'street lamp', 'traffic light', 'stop sign', 'crosswalk', 'fire truck', 'ambulance', 'police car', 'school bus', 'taxi', 'motorcycle', 'scooter', 'wagon', 'canoe', 'raft', 'ferry', 'ship', 'parachute', 'hot air balloon', 'blimp', 'spaceship', 'moon rover', 'satellite', 'alien', 'comet', 'planet', 'galaxy', 'eclipse', 'sunrise', 'sunset', 'snowflake', 'icicle', 'puddle', 'fog', 'wind', 'thunder', 'earthquake', 'flood', 'campsite', 'sleeping bag', 'backpacker', 'hiking boots', 'binoculars', 'fishing rod', 'net', 'trap', 'nest', 'egg carton', 'beehive', 'anthill', 'cobweb', 'worm', 'ladybug', 'dragonfly', 'firefly', 'grasshopper', 'scorpion', 'squirrel', 'hedgehog', 'raccoon', 'skunk', 'fox', 'wolf', 'bear', 'deer', 'moose', 'zebra', 'hippo', 'rhino', 'gorilla', 'parrot', 'flamingo', 'peacock', 'eagle', 'swan', 'seal', 'jellyfish', 'starfish', 'seahorse', 'lobster', 'clam',
  /* actions */ 'swimming', 'reading', 'sleeping', 'dancing', 'jumping', 'painting', 'fishing', 'cooking', 'singing', 'climbing', 'sneezing', 'brushing teeth', 'riding a bike', 'flying a kite', 'planting a seed', 'walking the dog',
];

export const norm = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const squash = s => norm(s).replace(/^(a|an|the) /, '').replace(/ /g, '');
/** does this guess match the word? Case, accents, punctuation, spaces, a leading a/an/the and a plural s don't matter. */
export function isMatch(guess, word) {
  const a = squash(guess), b = squash(word);
  return a.length > 0 && (a === b || a === `${b}s` || `${a}s` === b);
}
/** the lengths of the word's parts, e.g. "ice cream" → [3, 5]: what guessers are shown */
export const lensOf = word => norm(word).split(' ').filter(Boolean).slice(0, 4).map(w => Math.min(20, w.length));
/** a random word not in `used` (a Set); the list restarts when every word is used */
export function pickWord(rnd, used = new Set()) {
  let pool = WORDS.filter(w => !used.has(w));
  if (!pool.length) { used.clear(); pool = WORDS.slice(); }
  const w = pool[Math.floor(rnd() * pool.length)];
  used.add(w);
  return w;
}

/* ---------------------------- scoring ---------------------------- */
/** the guesser's points: 60 to 200 by how much time was left, +20 for the first */
export const guesserPoints = (left, total, first) => 60 + Math.round(140 * Math.max(0, Math.min(1, left / Math.max(1, total)))) + (first ? 20 : 0);
export const drawerPoints = () => 40;

/* ---------------------------- the message schema ---------------------------- */
const tidOf = m => (typeof m.tid === 'string' && TID_RE.test(m.tid) ? m.tid : null);
const idOf = v => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const pkOf = v => (typeof v === 'string' && v.length === 88 && B64.test(v) ? v : null);

export const CHECK = {
  join: m => ({ n: safeName(m.n) || 'Friend', c: hueOf(m.c) }),
  hb: () => ({}),
  bye: () => ({}),
  wel: m => { const to = idOf(m.to); return to ? { to } : null; },
  full: m => { const to = idOf(m.to); return to ? { to } : null; },
  kick: m => { const to = idOf(m.to); return to ? { to } : null; },
  st: m => {
    const tid = m.tid === '' ? '' : tidOf(m);
    if (tid === null || !PHASES.includes(m.ph) || !int(m.rd, 0, 9) || !int(m.nrd, 1, 5) || !int(m.tn, 0, 99) || !int(m.tt, 0, 99)) return null;
    const dr = m.dr === '' ? '' : idOf(m.dr);
    if (dr === null || !int(m.left, 0, 300000) || !int(m.tot, 0, 300000) || !WHYS.has(m.why) || !Array.isArray(m.ros) || m.ros.length > LIMITS.players + 2) return null;
    const ros = [];
    for (const r of m.ros) {
      if (!Array.isArray(r) || r.length !== 6) return null;
      const pid = idOf(r[0]);
      if (!pid || typeof r[1] !== 'string' || !int(r[3], 0, 1e6) || (r[4] !== 0 && r[4] !== 1) || (r[5] !== 0 && r[5] !== 1)) return null;
      ros.push([pid, safeName(r[1]) || 'Friend', hueOf(r[2]), r[3], r[4], r[5]]);
    }
    return { tid, ph: m.ph, rd: m.rd, nrd: m.nrd, tn: m.tn, tt: m.tt, dr, left: m.left, tot: m.tot, why: m.why, ros };
  },
  wd: m => {
    const tid = tidOf(m), pk = pkOf(m.pk);
    if (!tid || !pk || !Array.isArray(m.lens) || m.lens.length < 1 || m.lens.length > 4 || !m.lens.every(n => int(n, 1, 20))) return null;
    return { tid, pk, lens: m.lens.slice() };
  },
  sk: m => {
    const tid = tidOf(m);
    if (!tid || !['brush', 'eraser', 'line', 'rect', 'ellipse', 'clear'].includes(m.tool)) return null;
    /* the same check Draw Together uses, then this game's smaller limits */
    const c = drawCheckers.sk({ ...m, id: typeof m.id === 'string' && /^h[0-9a-z]{1,9}$/.test(m.id) ? m.id : null });
    if (!c) return null;
    if (c.i + c.p.length / 2 > LIMITS.pointsPerStroke || c.p.length > LIMITS.batch * 2) return null;
    if (c.n !== undefined && c.n > LIMITS.pointsPerStroke) return null;
    if (!c.p.every((v, i) => (i % 2 ? v >= -16 && v <= CANVAS.h + 16 : v >= -16 && v <= CANVAS.w + 16))) return null;
    return { tid, ...c };
  },
  gs: m => {
    const tid = tidOf(m), pk = pkOf(m.pk);
    if (!tid || !pk || typeof m.iv !== 'string' || m.iv.length !== 16 || !B64.test(m.iv) || typeof m.ct !== 'string' || m.ct.length < 24 || m.ct.length > 260 || !B64.test(m.ct)) return null;
    return { tid, pk, iv: m.iv, ct: m.ct };
  },
  gr: m => {
    const tid = tidOf(m), p = idOf(m.p);
    if (!tid || !p || (m.ok !== 0 && m.ok !== 1)) return null;
    return m.ok ? { tid, p, ok: 1 } : { tid, p, ok: 0, txt: cleanText(m.txt, LIMITS.guessLen) };
  },
  rev: m => {
    const tid = tidOf(m);
    const word = cleanText(m.word, LIMITS.wordLen);
    return tid && word ? { tid, word } : null;
  },
  rq: m => { const tid = tidOf(m); return tid ? { tid } : null; },
};
/** a cleaned copy of a message ({ t, f, …body }) or null */
export function check(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.v !== 1 || typeof m.t !== 'string' || !Object.hasOwn(CHECK, m.t) || !idOf(m.f)) return null;
  const body = CHECK[m.t](m);
  return body ? { t: m.t, f: m.f, ...body } : null;
}

/* ---------------------------- the host's turn engine ---------------------------- */
const tid6 = rnd => Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd() * 36)]).join('');

/**
 * createHost({ pid, name, hue, now, rnd }) — one room's turns and scores.
 * Times come from now() (ms); call tick() often. snapshot() is the 'st' message body.
 */
export function createHost({ pid, name, hue = 200, now = () => performance.now(), rnd = Math.random, rounds = 2, turnMs = 75000 }) {
  const E = {
    phase: 'lobby', rd: 0, nrd: rounds, turnMs, revealMs: LIMITS.revealMs, order: [], idx: 0, drawer: '', tid: '', endsAt: 0, revealAt: 0, why: '', got: new Set(), seq: 0,
    players: new Map(), banned: new Set(), bannedNames: new Set(), joined: 0, firstGot: false,
  };
  const add = (id, n, c, active) => E.players.set(id, { name: safeName(n) || 'Friend', hue: hueOf(c), score: 0, active, seen: now(), n: E.joined++ });
  add(pid, name, hue, true);
  const present = () => [...E.players.keys()];
  const activeIds = () => present().filter(id => E.players.get(id).active);
  const key = n => norm(n);

  function startRound() {
    E.rd++;
    for (const p of E.players.values()) p.active = true;      /* a late joiner plays from this round */
    E.order = activeIds();
    E.idx = -1;
    nextTurn();
  }
  function nextTurn() {
    E.idx++;
    while (E.idx < E.order.length && !E.players.has(E.order[E.idx])) E.idx++;
    if (E.idx >= E.order.length) {
      if (E.rd >= E.nrd) { E.phase = 'end'; E.drawer = ''; E.tid = ''; E.why = ''; return; }
      startRound();
      return;
    }
    E.drawer = E.order[E.idx];
    E.tid = tid6(rnd);
    E.got = new Set();
    E.firstGot = false;
    E.endsAt = now() + E.turnMs;
    E.why = '';
    E.phase = 'draw';
  }
  function endTurn(why) {
    E.phase = 'reveal';
    E.why = why;
    E.revealAt = now() + E.revealMs;
  }
  const guessers = () => activeIds().filter(id => id !== E.drawer);
  function toLobby(why) { E.phase = 'lobby'; E.why = why; E.drawer = ''; E.tid = ''; E.rd = 0; E.order = []; for (const p of E.players.values()) { p.active = true; } }

  return {
    get phase() { return E.phase; },
    get drawer() { return E.drawer; },
    get tid() { return E.tid; },
    get players() { return E.players; },
    get banned() { return E.banned; },
    has: id => E.players.has(id),
    setOptions({ rounds: r, turnMs: t } = {}) {
      if (E.phase !== 'lobby' && E.phase !== 'end') return false;
      if (LIMITS.roundChoices.includes(r)) E.nrd = r;
      if (LIMITS.turnChoices.includes(t)) E.turnMs = t;
      return true;
    },
    join(id, n, c) {
      if (E.players.has(id)) { E.players.get(id).seen = now(); return 'ok'; }
      if (E.banned.has(id) || E.bannedNames.has(key(safeName(n)))) return 'banned';
      if (E.players.size >= LIMITS.players) return 'full';
      add(id, n, c, E.phase === 'lobby' || E.phase === 'end');
      return 'ok';
    },
    seen(id) { const p = E.players.get(id); if (p) p.seen = now(); },
    leave(id) {
      if (id === pid || !E.players.delete(id)) return false;
      E.got.delete(id);
      if (E.phase === 'draw' || E.phase === 'reveal') {
        if (activeIds().length < 2) { toLobby('few'); return true; }
        if (E.phase === 'draw' && id === E.drawer) endTurn('left');
      }
      return true;
    },
    kick(id) {
      if (id === pid || !E.players.has(id)) return false;
      const n = E.players.get(id).name;
      E.banned.add(id);
      E.bannedNames.add(key(n));
      return this.leave(id);
    },
    /** drop everyone not heard from lately; returns who */
    sweep() {
      const gone = [];
      for (const [id, p] of E.players) if (id !== pid && now() - p.seen > LIMITS.quietMs) gone.push(id);
      gone.forEach(id => this.leave(id));
      return gone;
    },
    start() {
      if (E.phase !== 'lobby' && E.phase !== 'end') return false;
      if (E.players.size < 2) return false;
      for (const p of E.players.values()) p.score = 0;
      E.rd = 0;
      startRound();
      return true;
    },
    /** the drawer says `id` guessed right; true when it counted */
    correct(from, tid, id) {
      if (E.phase !== 'draw' || from !== E.drawer || tid !== E.tid || id === E.drawer || E.got.has(id)) return null;
      const p = E.players.get(id), d = E.players.get(E.drawer);
      if (!p || !p.active || !d) return null;
      const left = Math.max(0, E.endsAt - now());
      const gain = guesserPoints(left, E.turnMs, !E.firstGot);
      E.firstGot = true;
      E.got.add(id);
      p.score += gain;
      d.score += drawerPoints();
      return { guesser: gain, drawer: drawerPoints() };
    },
    tick() {
      if (E.phase === 'draw') {
        if (now() >= E.endsAt) endTurn('time');
        else if (guessers().length && guessers().every(id => E.got.has(id))) endTurn('all');
      } else if (E.phase === 'reveal' && now() >= E.revealAt) nextTurn();
      return E.phase;
    },
    snapshot() {
      const t = now();
      const left = E.phase === 'draw' ? Math.max(0, Math.round(E.endsAt - t)) : 0;
      return {
        tid: E.tid, ph: E.phase, rd: E.rd, nrd: E.nrd, tn: Math.max(0, E.idx + 1), tt: E.order.length, dr: E.drawer, left, tot: E.turnMs, why: E.why,
        ros: present().map(id => { const p = E.players.get(id); return [id, p.name, p.hue, p.score, p.active ? 1 : 0, E.got.has(id) ? 1 : 0]; }),
      };
    },
    options: () => ({ rounds: E.nrd, turnMs: E.turnMs }),
    /* tests only: a shorter pause between turns */
    testReveal(ms) { if (Number.isInteger(ms) && ms >= 100 && ms <= LIMITS.revealMs) E.revealMs = ms; },
  };
}

export default { WORDS, CANVAS, LIMITS, norm, isMatch, lensOf, pickWord, guesserPoints, drawerPoints, check, CHECK, createHost };
