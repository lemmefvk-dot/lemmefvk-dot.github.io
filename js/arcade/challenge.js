/* ============================================================
   arcade/challenge.js — seeded rounds people share: "Beat this"
   links and the weekly challenge. Pure functions, no DOM, no network.

   A seeded game (`seeded` in ./index.js) builds its whole course from
   ctx.seed, so the same game + seed is the same round on any device.

   BEAT THIS — a link to one round and the score to beat:
     #arcade=<id>&seed=<base36>&beat=<score>[&by=<name>][&mode=<mode>]
   (mode: one of the game's modes other than its first, ./modes.js —
   the same seed in another mode is another round)
   The friend's Arcade opens the same game on the same seed and, when
   their round ends, compares the two scores on their own device. The
   score and the name are only what the link says: anyone can edit a
   link, so the card says "the link says", never "they scored".

   WEEKLY — one game and one seed for everyone in the same week, made
   from the week alone (ISO weeks in UTC, so the whole world changes
   over at the same moment, Monday 00:00 UTC). No server: two devices
   agree because they do the same sum. The rotation below must only
   ever grow at the end, or past weeks would change their game.
   ============================================================ */

export const WEEKLY_GAMES = ['flap', 'snake', 'racer', 'blocks', 'g2048', 'stacker', 'skyhop'];
const DAY = 86400_000;
/* Monday 5 January 1970, 00:00 UTC: week 0 of the rotation */
const EPOCH_MONDAY = 4 * DAY;

/** 32-bit FNV-1a of a string */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export const randomSeed = () => {
  try { return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0; } catch (e) { return (Math.random() * 2 ** 32) >>> 0; }
};
export const seedText = seed => (seed >>> 0).toString(36);
export function parseSeed(s) {
  const t = String(s ?? '').trim().toLowerCase();
  if (!/^[0-9a-z]{1,7}$/.test(t)) return null;
  const n = parseInt(t, 36);
  return Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff ? n >>> 0 : null;
}

/** ISO week (UTC) of a moment: 'YYYY-Www' */
export function weekKey(t = Date.now()) {
  const d = new Date(t);
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  u.setUTCDate(u.getUTCDate() + 4 - (u.getUTCDay() || 7));
  const y = u.getUTCFullYear();
  const w = Math.ceil(((u - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** when this UTC week began and ends (ms) */
export function weekSpan(t = Date.now()) {
  const n = Math.floor((t - EPOCH_MONDAY) / (7 * DAY));
  const start = EPOCH_MONDAY + n * 7 * DAY;
  return { index: n, start, end: start + 7 * DAY };
}
/** this week's challenge: { week, game, seed, start, end } */
export function weekly(t = Date.now()) {
  const { index, start, end } = weekSpan(t);
  const week = weekKey(t);
  return { week, game: WEEKLY_GAMES[((index % WEEKLY_GAMES.length) + WEEKLY_GAMES.length) % WEEKLY_GAMES.length], seed: hash32(`staticos/arcade/weekly/v1/${week}`), start, end };
}

/* ---------------- Beat this ---------------- */
const NAME_MAX = 24;
const MODE = /^[a-z0-9-]{1,16}$/;
const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>]/g, '').trim().slice(0, NAME_MAX);
/** the hash part (no '#') of a Beat-this link */
export function beatHash({ game, seed, score, by = '', mode = '' }) {
  const p = new URLSearchParams();
  p.set('arcade', game);
  p.set('seed', seedText(seed));
  p.set('beat', String(score));
  const name = cleanName(by);
  if (name) p.set('by', name);
  if (MODE.test(mode || '')) p.set('mode', mode);
  return p.toString();
}
export function beatLink(o) {
  try { return `${location.origin}${location.pathname}#${beatHash(o)}`; } catch (e) { return ''; }
}
/** what a link (or opts.beat) says, read strictly: { seed, score, by, mode } or null ('' mode: the first) */
export function readBeat(o) {
  if (!o || typeof o !== 'object') return null;
  const seed = typeof o.seed === 'number' && Number.isInteger(o.seed) && o.seed >= 0 && o.seed <= 0xffffffff ? o.seed >>> 0 : parseSeed(o.seed);
  if (seed === null) return null;
  const t = String(o.score ?? '').trim();
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const score = Number(t);
  if (!Number.isFinite(score)) return null;
  const mode = o.mode == null || o.mode === '' ? '' : String(o.mode);
  if (mode && !MODE.test(mode)) return null;
  return { seed, score, by: cleanName(o.by), mode };
}

export default { WEEKLY_GAMES, hash32, randomSeed, seedText, parseSeed, weekKey, weekSpan, weekly, beatHash, beatLink, readBeat };
