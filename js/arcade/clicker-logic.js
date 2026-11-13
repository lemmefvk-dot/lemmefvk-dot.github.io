/* ============================================================
   arcade/clicker-logic.js — the rules of Static Clicker, no DOM.

   The idea: a faint signal is lost in the static. Tune it (click),
   build antennas, dishes and satellites that tune it for you, and
   lock the signal by collecting GOAL Static in one run. That is the
   end of the game: the round finishes and the time is the score.

   What is deliberately NOT here: purchases with real money, ads,
   timers that count down to something you'd lose, "come back now"
   prompts. Nothing is lost by closing the game. While it is closed
   it keeps working for you, up to OFFLINE_CAP_HOURS (8) at your rate
   — never more, however far the clock has moved — and it says so.

   Prestige ("Reboot"): start the run over, keep Clarity — each point
   is +10% to everything. Clarity gained = floor(sqrt(this run's
   Static / REBOOT_BASE)); the first point needs REBOOT_BASE Static.

   Numbers are doubles; the biggest the game ever holds is a few
   times GOAL (1e10), well inside what they store exactly enough.
   ============================================================ */

export const GOAL = 1e10;                 /* Static collected in one run to lock the signal */
export const OFFLINE_CAP_HOURS = 8;
export const OFFLINE_CAP = OFFLINE_CAP_HOURS * 3600;   /* seconds of offline production credited, at most */
export const REBOOT_BASE = 1e6;
export const CLARITY_BONUS = 0.1;         /* +10% of the base rate per Clarity */
export const GROWTH = 1.15;

export const GENS = [
  { id: 'antenna',     name: 'Antenna',        base: 15,     rate: 0.1,   blurb: 'A bent coat hanger that finds a little signal.' },
  { id: 'receiver',    name: 'Receiver',       base: 100,    rate: 1,     blurb: 'A radio with the knobs actually connected.' },
  { id: 'dish',        name: 'Dish',           base: 1100,   rate: 8,     blurb: 'A rooftop dish pointed at the sky.' },
  { id: 'relay',       name: 'Relay',          base: 12000,  rate: 47,    blurb: 'Passes the signal along, a little cleaner.' },
  { id: 'tower',       name: 'Tower',          base: 130000, rate: 260,   blurb: 'Tall, blinking, and very good at listening.' },
  { id: 'satellite',   name: 'Satellite',      base: 1.4e6,  rate: 1400,  blurb: 'Listens from above the weather.' },
  { id: 'beacon',      name: 'Beacon',         base: 2e7,    rate: 7800,  blurb: 'Locks onto a signal and does not let go.' },
  { id: 'observatory', name: 'Observatory',    base: 3.3e8,  rate: 44000, blurb: 'A big quiet room full of patient instruments.' },
  { id: 'array',       name: 'Orbital Array',  base: 5.1e9,  rate: 260000, blurb: 'Forty dishes acting as one ear.' },
];

/* what each upgrade does; ids are stable because they are saved */
const TIERS = [10, 25, 50, 100];                  /* owned count that unlocks a generator's tune-ups */
const TIER_COST = [10, 50, 1000, 100000];         /* × the generator's base cost */
const CLICK_COST = [100, 1000, 1e4, 1e5, 1e6, 1e7];
const GLOBAL_AT = [1e4, 1e6, 1e8, 1e9];          /* run Static that reveals each global boost */
const GLOBAL_COST = [5e3, 5e5, 5e7, 5e8];

export const UPGRADES = [
  ...CLICK_COST.map((cost, i) => ({ id: `click${i + 1}`, kind: 'click', name: `Finer dial ${'I II III IV V VI'.split(' ')[i]}`, desc: 'Each click makes twice as much Static.', cost, show: s => s.lifetime >= cost / 4 && (i === 0 || has(s, `click${i}`)) })),
  ...GENS.flatMap((g, gi) => TIERS.map((n, t) => ({
    id: `${g.id}${t + 1}`, kind: 'gen', gen: gi, name: `${g.name} tune-up ${'I II III IV'.split(' ')[t]}`, desc: `${g.name}s make twice as much Static.`,
    cost: g.base * TIER_COST[t], show: s => s.count[gi] >= n && (t === 0 || has(s, `${g.id}${t}`)),
  }))),
  ...GLOBAL_AT.map((at, i) => ({ id: `boost${i + 1}`, kind: 'all', name: `Signal boost ${'I II III IV'.split(' ')[i]}`, desc: 'Everything makes 25% more Static.', cost: GLOBAL_COST[i], show: s => s.lifetime >= at && (i === 0 || has(s, `boost${i}`)) })),
];
const BY_ID = new Map(UPGRADES.map(u => [u.id, u]));
const has = (s, id) => s.owned.includes(id);
export const upgradeById = id => BY_ID.get(id) || null;

/* ---------- the state ---------- */
export function newState(now = 0) {
  return {
    v: 1, static: 0, lifetime: 0, count: GENS.map(() => 0), owned: [], clarity: 0, reboots: 0,
    clicks: 0, runSeconds: 0, won: false, savedAt: now, offlineTotal: 0,
  };
}

/* ---------- the economy ---------- */
export const costOf = (s, i, extra = 0) => Math.ceil(GENS[i].base * Math.pow(GROWTH, s.count[i] + extra));
/* the price of `n` more of generator i in one go (a geometric sum), and how many Static can buy at most */
export function costOfMany(s, i, n) {
  if (n <= 0) return 0;
  const first = GENS[i].base * Math.pow(GROWTH, s.count[i]);
  return Math.ceil(first * (Math.pow(GROWTH, n) - 1) / (GROWTH - 1));
}
export function maxBuyable(s, i) {
  const first = GENS[i].base * Math.pow(GROWTH, s.count[i]);
  if (s.static < first) return 0;
  let n = Math.floor(Math.log(s.static * (GROWTH - 1) / first + 1) / Math.log(GROWTH));
  while (n > 0 && costOfMany(s, i, n) > s.static) n--;
  while (costOfMany(s, i, n + 1) <= s.static) n++;
  return n;
}
const mult = (s, pred) => s.owned.reduce((m, id) => { const u = BY_ID.get(id); return u && pred(u) ? m * (u.kind === 'all' ? 1.25 : 2) : m; }, 1);
export const clarityMult = s => 1 + CLARITY_BONUS * s.clarity;
export const genRate = (s, i) => s.count[i] * GENS[i].rate * mult(s, u => u.kind === 'gen' && u.gen === i);
export const rate = s => GENS.reduce((sum, _, i) => sum + genRate(s, i), 0) * mult(s, u => u.kind === 'all') * clarityMult(s);
export const clickValue = s => 1 * mult(s, u => u.kind === 'click') * mult(s, u => u.kind === 'all') * clarityMult(s) + rate(s) * 0.01;

const earn = (s, amount) => {
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  s.static += amount; s.lifetime += amount;
  if (s.lifetime >= GOAL) s.won = true;
};
export function click(s) {
  if (s.won) return 0;
  const v = clickValue(s);
  earn(s, v); s.clicks++;
  return v;
}
/* dt seconds of play. Returns what was earned. */
export function tick(s, dt) {
  if (s.won || !(dt > 0)) return 0;
  const d = Math.min(dt, OFFLINE_CAP);
  const before = s.lifetime, r = rate(s);
  earn(s, r * d);
  s.runSeconds += d;
  return s.lifetime - before;
}
export function buy(s, i, qty = 1) {
  if (s.won) return 0;
  const n = qty === 'max' ? maxBuyable(s, i) : Math.max(0, Math.floor(qty));
  if (n <= 0) return 0;
  const cost = costOfMany(s, i, n);
  if (cost > s.static) return 0;
  s.static -= cost; s.count[i] += n;
  return n;
}
export const availableUpgrades = s => UPGRADES.filter(u => !has(s, u.id) && u.show(s));
export function buyUpgrade(s, id) {
  const u = BY_ID.get(id);
  if (s.won || !u || has(s, id) || !u.show(s) || s.static < u.cost) return false;
  s.static -= u.cost; s.owned.push(id);
  return true;
}

/* ---------- reboot (prestige) ---------- */
export const rebootGain = s => Math.floor(Math.sqrt(Math.max(0, s.lifetime) / REBOOT_BASE));
export function reboot(s) {
  const gain = rebootGain(s);
  if (s.won || gain < 1) return 0;
  s.clarity += gain; s.reboots++;
  s.static = 0; s.lifetime = 0; s.count = GENS.map(() => 0); s.owned = []; s.clicks = 0; s.runSeconds = 0;
  return gain;
}

/* ---------- time away ---------- */
/* What `now` (ms since 1970) is worth since the state was saved. The clock is
   not trusted: a clock set back credits nothing, and a clock set forward credits
   at most OFFLINE_CAP seconds of production, at the rate the player left with. */
export function awayReport(s, now) {
  const away = Number.isFinite(now) && Number.isFinite(s.savedAt) && s.savedAt > 0 ? Math.max(0, (now - s.savedAt) / 1000) : 0;
  const credited = Math.min(away, OFFLINE_CAP);
  return { away, credited, capped: away > OFFLINE_CAP, rate: rate(s) };
}
export function applyAway(s, now) {
  const rep = awayReport(s, now);
  let earned = 0;
  if (rep.credited > 0 && !s.won) { earned = tick(s, rep.credited); s.offlineTotal += earned; }
  s.savedAt = now;
  return { ...rep, earned };
}

/* ---------- saving ---------- */
const num = (v, d = 0, max = 1e300) => (Number.isFinite(v) && v >= 0 ? Math.min(v, max) : d);
export function serialize(s, now) {
  return { v: 1, static: s.static, lifetime: s.lifetime, count: s.count.slice(), owned: s.owned.slice(), clarity: s.clarity, reboots: s.reboots, clicks: s.clicks, runSeconds: Math.round(s.runSeconds * 10) / 10, won: s.won, savedAt: now, offlineTotal: s.offlineTotal };
}
/* a saved object that is safe to play, or a fresh state */
export function deserialize(o, now = 0) {
  const s = newState(now);
  if (!o || typeof o !== 'object' || o.v !== 1) return s;
  s.static = num(o.static); s.lifetime = Math.max(s.static, num(o.lifetime));
  if (Array.isArray(o.count)) s.count = GENS.map((_, i) => Math.floor(num(o.count[i], 0, 1e6)));
  if (Array.isArray(o.owned)) s.owned = [...new Set(o.owned.filter(id => BY_ID.has(id)))];
  s.clarity = Math.floor(num(o.clarity, 0, 1e9)); s.reboots = Math.floor(num(o.reboots, 0, 1e6));
  s.clicks = Math.floor(num(o.clicks, 0, 1e12)); s.runSeconds = num(o.runSeconds, 0, 1e9);
  s.won = o.won === true || s.lifetime >= GOAL;
  s.savedAt = Number.isFinite(o.savedAt) && o.savedAt > 0 ? o.savedAt : now;
  s.offlineTotal = num(o.offlineTotal);
  return s;
}

/* ---------- reading numbers ---------- */
const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
/* 999 → "999", 1234 → "1.23K", 12345678 → "12.3M", 1e12 → "1T"; past 10^36 it falls back to 1.23e40 */
export function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  if (n < 0) return `-${fmt(-n)}`;
  if (n < 1000) return n < 10 ? String(Math.round(n * 100) / 100) : n < 100 ? String(Math.round(n * 10) / 10) : String(Math.round(n));
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIX.length) { const [m, e] = n.toExponential(2).split('e'); return `${m}e${e.replace('+', '')}`; }
  const scaled = n / Math.pow(1000, tier);
  const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  const text = String(Math.round(scaled * Math.pow(10, digits)) / Math.pow(10, digits));
  if (Number(text) >= 1000) return fmt(Math.pow(1000, tier + 1));       /* 999.9K rounds up to 1M */
  return `${text}${SUFFIX[tier]}`;
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = sec % 60;
  if (hh) return `${hh} h ${mm} min`;
  if (mm) return `${mm} min ${ss} s`;
  return `${ss} s`;
}
