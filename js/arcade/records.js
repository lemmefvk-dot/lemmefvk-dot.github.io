/* ============================================================
   arcade/records.js — what this device knows about the rounds
   played in Static Arcade. Data only: the shell (js/apps/arcade.js)
   writes it when a round really ends, and its Stats tab, the
   cabinets and the result card read it.

   Everything here comes from rounds actually played on this device
   — nothing is estimated and nothing is filled in. A game with no
   rounds has no entry; counting began with this version (`since`),
   so a best from before then can exist with no rounds behind it.

   Store 'portal.arcade' (shared with the shell's best / filter /
   sound; each writer keeps the other fields):
     tops:  { [id]: [{ s, at, seed? }] }  the best three 1-player scores
                                          that set a record, best first
                                          (a mode other than a game's first
                                          keeps its own, as `<id>:<mode>`)
     stats: { [id]: { n, ms, last } }     rounds finished, time playing
                                          (only while a round runs, not
                                          paused), when last played
     since: ms                            when this counting began
     fav:   [id]                          favourite games, newest first
     weekly:{ [week]: { game, seed, best, tries, at } }
     vs:    { [id]: { [key]: { w, l, d, label } } }
                                          board games against the computer:
                                          games won, lost and drawn at each
                                          level (key: the game's own, e.g.
                                          '3' or '13-2'; label: 'Hard',
                                          '13×13 · Medium'). A game reports
                                          it in onEnd({ vs: { key, label,
                                          result: 'win'|'loss'|'draw' } })
     h2h:   { [fp]: { name, at, games: { [id]: { w, l, d } } } }
                                          online matches against a friend
                                          (fp: their Friends fingerprint,
                                          known only when the room's friend
                                          tags matched — see room.js): a
                                          match counts once it has a result
                                          (one game, or a best-of decided);
                                          one left early never does
   ============================================================ */
import { store } from '../core/store.js';

export const KEY = 'portal.arcade';
export const TOP_N = 3;
const read = () => { const v = store.get(KEY, null); return v && typeof v === 'object' ? v : {}; };
const write = patch => store.set(KEY, { ...read(), ...patch });
const num = v => (Number.isFinite(v) ? v : null);
const better = (dir, a, b) => (dir === 'low' ? a < b : a > b);

/* ---------------- best three ---------------- */
/** The best three 1-player scores for a game, best first: [{ s, at, seed? }].
    A best saved before the three were kept comes back alone, with at: null
    (its date was never recorded, so none is shown). */
export function tops(id) {
  const v = read();
  const list = v.tops?.[id];
  if (Array.isArray(list) && list.length) return list.filter(t => t && Number.isFinite(t.s)).map(t => ({ ...t, at: num(t.at) })).slice(0, TOP_N);
  const old = v.best?.[id];
  return Number.isFinite(old) ? [{ s: old, at: null }] : [];
}
/** Where a score would land among the best three (0 = a new best), or -1 if it wouldn't. */
export function placeOf(id, s, dir) {
  if (!Number.isFinite(s)) return -1;
  const t = tops(id);
  const i = t.findIndex(x => better(dir, s, x.s));
  return i >= 0 ? i : t.length < TOP_N ? t.length : -1;
}

/* ---------------- a round ---------------- */
/**
 * A round ended. counts: a 1-player round that may go in the record
 * (not two players, online, slowed or assisted). key: where its best
 * three are kept — the game's id, or `<id>:<mode>` for a mode other than
 * its first (./modes.js); the rounds and time are always the game's.
 * -> { place } (0..2, or -1)
 */
export function recordRound({ id, key = id, score, dir = 'high', counts = false, ms = 0, seed = null, at = Date.now() }) {
  const cur = read();
  const stats = { ...(cur.stats || {}) };
  const st = stats[id] || { n: 0, ms: 0, last: 0 };
  stats[id] = { n: (st.n || 0) + 1, ms: Math.round((st.ms || 0) + Math.max(0, ms || 0)), last: at };
  const patch = { stats, since: Number(cur.since) > 0 ? cur.since : at };
  let place = -1;
  if (counts && Number.isFinite(score)) {
    place = placeOf(key, score, dir);
    if (place >= 0) {
      const entry = { s: score, at, ...(Number.isInteger(seed) ? { seed: seed >>> 0 } : {}) };
      const list = tops(key);
      list.splice(place, 0, entry);
      patch.tops = { ...(cur.tops || {}), [key]: list.slice(0, TOP_N) };
    }
  }
  write(patch);
  return { place };
}
/** Time spent in a round that did not end (Back, Restart, closing the window). */
export function addTime(id, ms) {
  if (!(ms > 250)) return;
  const cur = read();
  const stats = { ...(cur.stats || {}) };
  const st = stats[id] || { n: 0, ms: 0, last: 0 };
  stats[id] = { ...st, ms: Math.round((st.ms || 0) + ms), last: Date.now() };
  write({ stats, since: Number(cur.since) > 0 ? cur.since : Date.now() });
}
/** { n, ms, last } or null */
export function statsOf(id) {
  const st = read().stats?.[id];
  return st && typeof st === 'object' ? { n: st.n | 0, ms: Math.max(0, num(st.ms) || 0), last: num(st.last) || 0 } : null;
}
export const allStats = () => { const s = read().stats; return s && typeof s === 'object' ? s : {}; };
export const since = () => num(read().since);

/* ---------------- against the computer, by level ---------------- */
const VS_KEY = /^[\w.-]{1,24}$/;
const RESULT = { win: 'w', loss: 'l', draw: 'd' };
const cleanVs = e => (e && typeof e === 'object'
  ? { w: Math.max(0, e.w | 0), l: Math.max(0, e.l | 0), d: Math.max(0, e.d | 0), label: typeof e.label === 'string' ? e.label.slice(0, 40) : '' }
  : null);
/** A finished game against the computer: { key, label, result }. Anything else is ignored. */
export function recordVs(id, vs) {
  if (!vs || typeof vs !== 'object' || !VS_KEY.test(String(vs.key ?? '')) || !RESULT[vs.result]) return null;
  const cur = read();
  const all = { ...(cur.vs || {}) };
  const game = { ...(all[id] || {}) };
  const e = cleanVs(game[vs.key]) || { w: 0, l: 0, d: 0, label: '' };
  e[RESULT[vs.result]]++;
  if (typeof vs.label === 'string' && vs.label) e.label = vs.label.slice(0, 40);
  game[vs.key] = e;
  all[id] = game;
  write({ vs: all });
  return { ...e };
}
/** { w, l, d, label } at one level, or null when none was played there */
export function vsOf(id, key) {
  return cleanVs(read().vs?.[id]?.[key]);
}
/** every level played against the computer in this game: [{ key, label, w, l, d }], in key order */
export function vsAll(id) {
  const g = read().vs?.[id];
  if (!g || typeof g !== 'object') return [];
  return Object.keys(g).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(key => ({ key, ...cleanVs(g[key]) })).filter(e => e.w + e.l + e.d > 0);
}

/* ---------------- favourites ---------------- */
export const favs = () => (Array.isArray(read().fav) ? read().fav.filter(x => typeof x === 'string') : []);
export const isFav = id => favs().includes(id);
export function toggleFav(id) {
  const cur = favs();
  const on = !cur.includes(id);
  write({ fav: on ? [id, ...cur] : cur.filter(x => x !== id) });
  return on;
}

/* ---------------- the weekly challenge ---------------- */
export function weeklyOf(week) {
  const w = read().weekly?.[week];
  return w && typeof w === 'object' && Number.isFinite(w.tries) ? w : null;
}
/** a try at this week's challenge; -> the entry, with newBest */
export function recordWeekly({ week, game, seed, score, dir = 'high', at = Date.now() }) {
  const cur = read();
  const all = { ...(cur.weekly || {}) };
  const w = all[week] && all[week].game === game ? all[week] : { game, seed, best: null, tries: 0, at };
  const newBest = Number.isFinite(score) && (w.best === null || better(dir, score, w.best));
  all[week] = { ...w, seed, tries: (w.tries || 0) + 1, best: newBest ? score : w.best, at: newBest ? at : w.at };
  /* keep the last dozen weeks: an old week's result is still yours to see */
  const keys = Object.keys(all).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 12))) delete all[k];
  write({ weekly: all });
  return { ...all[week], newBest };
}

/* ---------------- head to head, against each friend ---------------- */
const FP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const H2H_MAX = 60;                       /* as many friends as core/friends.js keeps */
const cleanWld = e => ({ w: Math.max(0, (e?.w | 0)), l: Math.max(0, (e?.l | 0)), d: Math.max(0, (e?.d | 0)) });
/** A finished online match against a friend: result 'win' | 'loss' | 'draw'. -> that friend's totals, or null */
export function recordH2H(fp, { name = '', game, result, at = Date.now() } = {}) {
  if (!FP_RE.test(String(fp || '')) || typeof game !== 'string' || !/^[a-z0-9-]{1,24}$/.test(game) || !RESULT[result]) return null;
  const all = { ...(read().h2h || {}) };
  const e = all[fp] && typeof all[fp] === 'object' ? all[fp] : { name: '', at: 0, games: {} };
  const games = { ...(e.games || {}) };
  const g = cleanWld(games[game]);
  g[RESULT[result]]++;
  games[game] = g;
  all[fp] = { name: typeof name === 'string' && name ? name.slice(0, 24) : e.name || '', at, games };
  /* the friends played longest ago go first when there are too many */
  const fps = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  for (const k of fps.slice(H2H_MAX)) delete all[k];
  write({ h2h: all });
  return h2hOf(fp);
}
/** { name, at, w, l, d, games: { [id]: { w, l, d } } } against one friend, or null before the first match */
export function h2hOf(fp) {
  const e = read().h2h?.[fp];
  if (!e || typeof e !== 'object') return null;
  const games = {};
  const tot = { w: 0, l: 0, d: 0 };
  for (const [id, v] of Object.entries(e.games || {})) {
    const c = cleanWld(v);
    if (!(c.w + c.l + c.d)) continue;
    games[id] = c;
    tot.w += c.w; tot.l += c.l; tot.d += c.d;
  }
  if (!(tot.w + tot.l + tot.d)) return null;
  return { name: typeof e.name === 'string' ? e.name : '', at: num(e.at), ...tot, games };
}
/** every friend with a finished match, most recent first: [{ fp, ...h2hOf(fp) }] */
export function h2hAll() {
  const all = read().h2h;
  if (!all || typeof all !== 'object') return [];
  return Object.keys(all).map(fp => ({ fp, ...h2hOf(fp) })).filter(e => e.at !== undefined && e.w + e.l + e.d > 0).sort((a, b) => (b.at || 0) - (a.at || 0));
}

export default { KEY, TOP_N, tops, placeOf, recordRound, addTime, statsOf, allStats, since, recordVs, vsOf, vsAll, favs, isFav, toggleFav, weeklyOf, recordWeekly, recordH2H, h2hOf, h2hAll };
