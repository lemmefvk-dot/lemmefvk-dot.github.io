/* ============================================================
   arcade/friendplay.js — Static Arcade with friends: leaderboards,
   Beat-this challenges and cups (knock-out brackets of 4 or 8).

   All of it rides the private friend channels of core/friends.js
   ('arc' messages, sealed per friendship). There is no server board
   and nobody else: a friend's score is here only because that friend
   pressed Share, it is shown only while they are your friend, and
   "Stop sharing" takes yours back off their devices.

   Messages (body of 'arc', checked strictly here; anything else is
   dropped):
     sc   { l: [[game, score], …] }    bests a friend shares with you
     scx  { g? }                       they stopped sharing one / all
     wk   { w, g, s }                  their best in a weekly challenge
     bt   { g, sd, s }                 "beat this": a round and a score
     cup  { id, ti, g, sd, pl, rs, u, x }   a cup's bracket, from its host
     cupr { id, r, s }                 a player's match score, to the host
     cupq { id }                       "send me the bracket again"

   CUPS. The host's copy is the real one (like game nights in
   friends.js): players report to the host, the host decides each
   match and sends the bracket to everyone in it. A match is one round
   each of the same seeded course (the cup's seed and the round number
   make it); your first finished round is your score; the better score
   goes through and a tie goes to whoever finished first. Players see
   names only for people who are their own friends — anyone else in the
   bracket is "a friend of <host>".

   Store 'portal.arcadeFriends' (per person, via store):
     { scores: { fp: { game: { s, at } } }, weekly: { fp: { w, g, s, at } },
       mine: { game: { s, at } }, cups: [cup] }
   ============================================================ */
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import api from '../core/api.js?v=ps5-cloud-proxy-v11';
import { arcadeById } from './index.js';
import { hash32 } from './challenge.js';
import { t as tr } from '../core/i18n.js';

export const KEY = 'portal.arcadeFriends';
const FP_RE = /^[0-9a-f]{32}$/;
const ID_RE = /^[a-z0-9]{12}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const MAX_GAMES = 120, MAX_CUPS = 12, TITLE_MAX = 40;
export const SIZES = [4, 8];
const okScore = s => typeof s === 'number' && Number.isFinite(s) && Math.abs(s) < 1e9;
const okSeed = s => Number.isInteger(s) && s >= 0 && s <= 0xffffffff;
const MODE_RE = /^[a-z0-9-]{1,16}$/;
/* the game by its canonical id, and only a seeded one where a round has to be the same for both */
const gameOf = (id, seeded = false) => { const g = typeof id === 'string' ? arcadeById(id) : null; return g && g.id === id && (!seeded || g.seeded) ? g : null; };
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>]/g, '').trim().slice(0, max);
const rid = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return [...a].map(b => (b % 36).toString(36)).join(''); };
const better = (dir, a, b) => (dir === 'low' ? a < b : a > b);
const FR = () => import('../core/friends.js');
const notify = n => { try { api.notify({ app: 'Static Arcade', icon: 'gamepad', timeout: 9000, ...n }); } catch (e) { /* no shell */ } };

function D() {
  const v = store.get(KEY, null);
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return { scores: obj(o.scores), weekly: obj(o.weekly), mine: obj(o.mine), cups: Array.isArray(o.cups) ? o.cups.filter(c => c && ID_RE.test(c.id)) : [] };
}
const save = patch => { store.set(KEY, { ...D(), ...patch }); bus.emit('arcade:friends', { kind: 'save' }); };

/* ---------------- what arrives ---------------- */
let noteAt = 0;
const mayNote = () => { const now = Date.now(); if (now - noteAt < 1500) return false; noteAt = now; return true; };

/** A message from friend `fp` (called by core/friends.js). */
export async function receive(fp, m) {
  if (!FP_RE.test(fp) || !m || typeof m !== 'object') return;
  const F = await FR();
  const friend = F.friends().find(f => f.fp === fp);
  if (!friend) return;
  const name = friend.display;
  if (m.k === 'sc') {
    if (!Array.isArray(m.l) || m.l.length > MAX_GAMES) return;
    const mineFrom = { ...(D().scores[fp] || {}) };
    let n = 0;
    for (const e of m.l) {
      if (!Array.isArray(e) || !gameOf(e[0]) || !okScore(e[1])) continue;
      mineFrom[e[0]] = { s: e[1], at: Date.now() };
      n++;
    }
    if (!n) return;
    save({ scores: { ...D().scores, [fp]: mineFrom } });
  } else if (m.k === 'scx') {
    const all = { ...D().scores };
    if (m.g === undefined) delete all[fp];
    else if (gameOf(m.g) && all[fp]) { const x = { ...all[fp] }; delete x[m.g]; all[fp] = x; }
    else return;
    save({ scores: all });
  } else if (m.k === 'wk') {
    if (!WEEK_RE.test(m.w || '') || !gameOf(m.g, true) || !okScore(m.s)) return;
    save({ weekly: { ...D().weekly, [fp]: { w: m.w, g: m.g, s: m.s, at: Date.now() } } });
  } else if (m.k === 'bt') {
    const g = gameOf(m.g, true);
    if (!g || !okSeed(m.sd) || !okScore(m.s)) return;
    if (!mayNote()) return;
    const open = () => { try { api.openApp('arcade', { game: g.id, beat: { seed: m.sd, score: String(m.s), by: name, mode: MODE_RE.test(m.md || '') ? m.md : '' } }); } catch (e) { /* no shell */ } };
    notify({
      key: `arcade-beat-${fp}-${g.id}-${m.sd}`, from: fp, title: tr('{name} challenged you in {title}', { name, title: g.title }),
      message: tr('Beat {s} on the same round. Nothing starts until you press Play.', { s: m.s }),
      actions: [{ label: tr('Open'), onClick: open }], onClick: open,
    });
  } else if (m.k === 'cup') onCup(fp, m, F, name);
  else if (m.k === 'cupr') onCupResult(fp, m, F);
  else if (m.k === 'cupq') {
    const c = D().cups.find(x => x.id === m.id && x.host === F.myFp());
    if (c && c.players.includes(fp)) F.sendArcade([fp], wireCup(c));
  }
}

/* ---------------- leaderboards ---------------- */
/** Send these bests to friends (fps: a list, or null for every friend). list: [[game, score]] */
export async function shareBests(list, fps = null) {
  const l = (list || []).filter(e => Array.isArray(e) && gameOf(e[0]) && okScore(e[1])).slice(0, MAX_GAMES);
  if (!l.length) return { sent: 0, total: 0, empty: true };
  const F = await FR();
  const r = await F.sendArcade(fps, { k: 'sc', l });
  if (!r.unavailable) {
    const mine = { ...D().mine };
    for (const [g, s] of l) mine[g] = { s, at: Date.now() };
    save({ mine });
  }
  return r;
}
/** Take my shared bests back off friends' devices (one game, or all). */
export async function withdraw(game = null) {
  const F = await FR();
  const r = await F.sendArcade(null, game ? { k: 'scx', g: game } : { k: 'scx' });
  if (!r.unavailable) {
    const mine = { ...D().mine };
    if (game) delete mine[game]; else for (const k of Object.keys(mine)) delete mine[k];
    save({ mine });
  }
  return r;
}
export const shared = () => D().mine;
export async function shareWeekly(week, game, score) {
  if (!WEEK_RE.test(week) || !gameOf(game, true) || !okScore(score)) return { sent: 0, total: 0 };
  const F = await FR();
  const r = await F.sendArcade(null, { k: 'wk', w: week, g: game, s: score });
  if (!r.unavailable) save({ mine: { ...D().mine, [`week:${week}`]: { s: score, at: Date.now() } } });
  return r;
}
/* mode: one of the game's modes other than its first (./modes.js), or '' */
export async function sendBeat(fp, game, seed, score, mode = '') {
  if (!FP_RE.test(fp) || !gameOf(game, true) || !okSeed(seed) || !okScore(score)) return { sent: 0, total: 0 };
  const F = await FR();
  return F.sendArcade([fp], { k: 'bt', g: game, sd: seed, s: score, ...(MODE_RE.test(mode || '') ? { md: mode } : {}) });
}

/** The friends' board for a game: [{ fp, name, s, at }], best first — only current friends who shared it. */
export function board(game, friends) {
  const g = gameOf(game);
  if (!g) return [];
  const known = new Map((friends || []).map(f => [f.fp, f]));
  const out = [];
  for (const [fp, games] of Object.entries(D().scores)) {
    const e = games && games[game];
    if (!known.has(fp) || !e || !okScore(e.s)) continue;
    out.push({ fp, name: known.get(fp).display, hue: known.get(fp).hue, s: e.s, at: e.at || 0 });
  }
  return out.sort((a, b) => (better(g.better, a.s, b.s) ? -1 : better(g.better, b.s, a.s) ? 1 : a.at - b.at));
}
/** Games any current friend has shared a score for */
export function boardGames(friends) {
  const known = new Set((friends || []).map(f => f.fp));
  const ids = new Set();
  for (const [fp, games] of Object.entries(D().scores)) if (known.has(fp)) for (const g of Object.keys(games || {})) if (gameOf(g)) ids.add(g);
  return [...ids];
}
/** friends' shared results for one week: [{ fp, name, s, at }], best first */
export function weeklyBoard(week, game, friends) {
  const g = gameOf(game);
  const known = new Map((friends || []).map(f => [f.fp, f]));
  const out = [];
  for (const [fp, e] of Object.entries(D().weekly)) {
    if (!known.has(fp) || !e || e.w !== week || e.g !== game || !okScore(e.s)) continue;
    out.push({ fp, name: known.get(fp).display, hue: known.get(fp).hue, s: e.s, at: e.at || 0 });
  }
  return g ? out.sort((a, b) => (better(g.better, a.s, b.s) ? -1 : better(g.better, b.s, a.s) ? 1 : a.at - b.at)) : out;
}

/* ---------------- cups ---------------- */
export const roundsOf = size => (size === 8 ? 3 : 2);
export const roundSeed = (cup, r) => hash32(`staticos/arcade/cup/${cup.seed}/${r}`);
const wireCup = c => ({ k: 'cup', id: c.id, ti: c.title, g: c.game, sd: c.seed, pl: c.players, rs: c.res, u: c.updated, x: !!c.cancelled });
const cleanSide = v => (v && typeof v === 'object' && okScore(v.s) && Number.isFinite(v.at) ? { s: v.s, at: v.at } : null);

function cleanCup(m, host) {
  if (!ID_RE.test(m.id || '') || !gameOf(m.g, true) || !okSeed(m.sd)) return null;
  if (!Array.isArray(m.pl) || !SIZES.includes(m.pl.length) || !m.pl.every(x => typeof x === 'string' && FP_RE.test(x)) || new Set(m.pl).size !== m.pl.length) return null;
  if (!m.pl.includes(host) || !Number.isFinite(m.u) || m.u <= 0) return null;
  const res = {};
  const rounds = roundsOf(m.pl.length);
  if (m.rs && typeof m.rs === 'object' && !Array.isArray(m.rs)) {
    for (const [k, v] of Object.entries(m.rs).slice(0, 8)) {
      const mm = /^(\d)\.(\d)$/.exec(k);
      if (!mm || +mm[1] >= rounds || +mm[2] >= m.pl.length >> (+mm[1] + 1) || !v || typeof v !== 'object') continue;
      res[k] = { a: cleanSide(v.a), b: cleanSide(v.b), w: v.w === 0 || v.w === 1 ? v.w : null, wo: v.wo === true };
    }
  }
  return { id: m.id, host, title: clean(m.ti, TITLE_MAX), game: m.g, seed: m.sd >>> 0, players: m.pl.slice(), res, updated: m.u, cancelled: m.x === true };
}

/** The bracket, round by round: [[{ r, m, a, b, res, w }]] — a / b / w are fps or null (not decided yet). */
export function bracket(c) {
  const out = [];
  let cur = c.players.slice();
  for (let r = 0; r < roundsOf(c.players.length); r++) {
    const ms = [], next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const res = c.res[`${r}.${i / 2}`] || { a: null, b: null, w: null };
      const a = cur[i] || null, b = cur[i + 1] || null;
      const w = res.w === 0 ? a : res.w === 1 ? b : null;
      ms.push({ r, m: i / 2, a, b, res, w });
      next.push(w);
    }
    out.push(ms);
    cur = next;
  }
  return out;
}
export const champion = c => { const b = bracket(c); return b[b.length - 1][0].w; };
/** my match still to play in a cup: { r, m, side: 'a'|'b', opp, seed } or null */
export function myMatch(c, me) {
  if (c.cancelled || champion(c)) return null;
  for (const round of bracket(c)) for (const x of round) {
    if (x.w || !x.a || !x.b) continue;
    const side = x.a === me ? 'a' : x.b === me ? 'b' : null;
    /* pend: a score this device sent the host that the host's bracket doesn't show yet */
    if (side && !x.res[side] && c.pend?.[`${x.r}.${x.m}`] === undefined) return { r: x.r, m: x.m, side, opp: side === 'a' ? x.b : x.a, seed: roundSeed(c, x.r) };
  }
  return null;
}
/** where I am in a cup: 'play' (a match to play) | 'wait' (played, waiting) | 'out' | 'won' | 'over' | 'off' */
export function myState(c, me) {
  if (c.cancelled) return 'off';
  const champ = champion(c);
  if (champ) return champ === me ? 'won' : 'over';
  if (myMatch(c, me)) return 'play';
  for (const round of bracket(c)) for (const x of round) if (x.w && (x.a === me || x.b === me) && x.w !== me) return 'out';
  return 'wait';
}

export const cups = () => D().cups.slice().sort((a, b) => b.updated - a.updated);
export const cupById = id => D().cups.find(c => c.id === id) || null;

/* decide a match once both scores are in: the better one; a tie goes to whoever finished first */
function decide(res, dir) {
  if (res.w !== null || !res.a || !res.b) return res;
  const w = better(dir, res.a.s, res.b.s) ? 0 : better(dir, res.b.s, res.a.s) ? 1 : res.a.at <= res.b.at ? 0 : 1;
  return { ...res, w };
}
async function putCup(c, notifyAll = true) {
  const d = D();
  const others = d.cups.filter(x => x.id !== c.id);
  save({ cups: [c, ...others].slice(0, MAX_CUPS) });
  if (!notifyAll) return;
  const F = await FR();
  const fps = c.players.filter(fp => fp !== F.myFp());
  await F.sendArcade(fps, wireCup(c));
}

/** Start a cup: you and 3 or 7 friends. -> { ok, cup?, error? } */
export async function createCup({ game, fps, title = '' }) {
  const g = gameOf(game, true);
  if (!g) return { ok: false, error: 'game' };
  const F = await FR();
  if (!F.available()) return { ok: false, error: 'guest' };
  await F.ready();
  const me = F.myFp();
  const mine = new Set(F.friends().map(f => f.fp));
  const list = [...new Set(fps || [])].filter(fp => mine.has(fp));
  if (!SIZES.includes(list.length + 1)) return { ok: false, error: 'size' };
  /* the draw: a fair shuffle, so the host isn't always first */
  const players = [me, ...list];
  const r = new Uint32Array(players.length);
  crypto.getRandomValues(r);
  for (let i = players.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [players[i], players[j]] = [players[j], players[i]]; }
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  const cup = { id: rid(), host: me, title: clean(title, TITLE_MAX), game: g.id, seed: seed[0] >>> 0, players, res: {}, updated: Date.now(), cancelled: false };
  await putCup(cup);
  return { ok: true, cup };
}

/** My score for my current match: the host decides it here; a player sends it to the host. -> text for the result card */
export async function reportCup(id, score) {
  const c = cupById(id);
  if (!c || !okScore(score)) return null;
  const F = await FR();
  const me = F.myFp();
  const mm = myMatch(c, me);
  if (!mm) return null;
  if (c.host === me) {
    applyResult(c, me, mm, score);
    return tr('Your score is in the bracket.');
  }
  /* kept here until the host's bracket shows it, and sent again when the cup is opened */
  const d = D();
  save({ cups: d.cups.map(x => (x.id === id ? { ...x, pend: { ...(x.pend || {}), [`${mm.r}.${mm.m}`]: score } } : x)) });
  const r = await F.sendArcade([c.host], { k: 'cupr', id, r: mm.r, s: score });
  return r.sent ? tr('Your score went to the cup’s host.') : tr('Your score goes to the cup’s host when you are both online; opening the cup sends it again.');
}

function applyResult(c, fp, mm, score) {
  const g = gameOf(c.game);
  const key = `${mm.r}.${mm.m}`;
  const cur = c.res[key] || { a: null, b: null, w: null };
  if (cur[mm.side] || cur.w !== null) return false;       /* your first finished round is your score */
  const res = decide({ ...cur, [mm.side]: { s: score, at: Date.now() } }, g ? g.better : 'high');
  const next = { ...c, res: { ...c.res, [key]: res }, updated: Math.max(Date.now(), c.updated + 1) };
  putCup(next);
  return true;
}

function onCupResult(fp, m, F) {
  const c = cupById(m.id);
  if (!c || c.host !== F.myFp() || c.cancelled || !c.players.includes(fp) || !okScore(m.s) || !Number.isInteger(m.r)) return;
  const mm = myMatch(c, fp);
  if (!mm || mm.r !== m.r) {
    /* old news: make sure they have the bracket as it stands */
    F.sendArcade([fp], wireCup(c));
    return;
  }
  applyResult(c, fp, mm, m.s);
}

function onCup(fp, m, F, hostName) {
  const n = cleanCup(m, fp);
  if (!n) return;
  const me = F.myFp();
  const d = D();
  const cur = d.cups.find(x => x.id === n.id);
  if (cur && cur.host !== fp) return;                       /* not theirs to change */
  if (cur && cur.updated >= n.updated) return;
  if (!n.players.includes(me)) { if (cur) save({ cups: d.cups.filter(x => x.id !== n.id) }); return; }
  if (!cur && d.cups.length >= MAX_CUPS) return;
  const before = cur ? myMatch(cur, me) : null;
  /* a score I sent stays pending only until the host's bracket has it */
  if (cur?.pend) {
    const pend = {};
    for (const [k, s] of Object.entries(cur.pend)) {
      const [r, m] = k.split('.').map(Number);
      const x = bracket(n)[r]?.[m];
      const side = x?.a === me ? 'a' : x?.b === me ? 'b' : null;
      if (side && !x.res[side] && !x.w) pend[k] = s;
    }
    if (Object.keys(pend).length) n.pend = pend;
  }
  save({ cups: [n, ...d.cups.filter(x => x.id !== n.id)].slice(0, MAX_CUPS) });
  const g = gameOf(n.game);
  const open = () => { try { api.openApp('arcade', { view: 'friends', cup: n.id }); } catch (e) { /* no shell */ } };
  const now = myMatch(n, me);
  if (!cur && !n.cancelled) {
    notify({ key: `arcade-cup-${n.id}`, from: fp, title: tr('{hostName} put you in a {title} cup', { hostName, title: g.title }), message: tr('{length} players, knock-out. Open it to see the bracket and play your match.', { length: n.players.length }), actions: [{ label: tr('Open'), onClick: open }], onClick: open });
  } else if (cur && !cur.cancelled && n.cancelled) {
    notify({ key: `arcade-cup-${n.id}`, from: fp, title: tr('{hostName} called off the {title} cup', { hostName, title: g.title }) });
  } else if (now && (!before || before.r !== now.r)) {
    notify({ key: `arcade-cup-${n.id}`, from: fp, title: tr('Your next match in {hostName}’s {title} cup', { hostName, title: g.title }), message: tr('Open the cup to play it.'), actions: [{ label: tr('Open'), onClick: open }], onClick: open });
  } else if (champion(n) && !champion(cur || n)) {
    notify({ key: `arcade-cup-${n.id}`, from: fp, title: champion(n) === me ? tr('{title} cup: you won!', { title: g.title }) : tr('{title} cup: it’s over', { title: g.title }) });
  }
}

/** Ask the hosts of the cups I'm in for their latest bracket (when the Friends view opens). */
export async function refreshCups() {
  const F = await FR();
  if (!F.available()) return;
  await F.ready().catch(() => {});
  const me = F.myFp();
  for (const c of D().cups) {
    if (c.host === me || c.cancelled || champion(c)) continue;
    for (const [k, s] of Object.entries(c.pend || {})) F.sendArcade([c.host], { k: 'cupr', id: c.id, r: Number(k.split('.')[0]), s });
    F.sendArcade([c.host], { k: 'cupq', id: c.id });
  }
}
/** The host only: call it off, or give a player a walkover when the other hasn't played. */
export async function cancelCup(id) {
  const c = cupById(id);
  const F = await FR();
  if (!c || c.host !== F.myFp() || c.cancelled) return false;
  await putCup({ ...c, cancelled: true, updated: Math.max(Date.now(), c.updated + 1) });
  return true;
}
export async function walkover(id, r, m, side) {
  const c = cupById(id);
  const F = await FR();
  if (!c || c.host !== F.myFp() || c.cancelled || (side !== 'a' && side !== 'b')) return false;
  const x = bracket(c)[r]?.[m];
  if (!x || x.w || !x.a || !x.b) return false;
  const key = `${r}.${m}`;
  const res = { ...(c.res[key] || { a: null, b: null }), w: side === 'a' ? 0 : 1, wo: true };
  await putCup({ ...c, res: { ...c.res, [key]: res }, updated: Math.max(Date.now(), c.updated + 1) });
  return true;
}
/** Forget a finished or cancelled cup on this device. */
export function forgetCup(id) { save({ cups: D().cups.filter(c => c.id !== id) }); }

export default { KEY, SIZES, receive, shareBests, withdraw, shared, shareWeekly, sendBeat, board, boardGames, weeklyBoard,
  roundsOf, roundSeed, bracket, champion, myMatch, myState, cups, cupById, createCup, reportCup, refreshCups, cancelCup, walkover, forgetCup };
