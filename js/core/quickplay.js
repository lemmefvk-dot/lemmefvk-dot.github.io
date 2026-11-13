/* ============================================================
   quickplay.js — "pick something for me", from real signals only.

     pick({ minutes, players, mood, avoidIds }) -> { kind, id, title, art, reason, ... }
     launch(item, api)                          -> the opened window, or null

   pick() is synchronous: it reads what is already in memory — the
   catalogue (call ready() once first to have all of it; before that
   it works from the built-in curated shelf and starts the full load
   itself, so an early pick never pins the shelf), the Static Arcade list
   and this device's own history. It never invents a signal.

   WHAT IT WEIGHS
     · favourites ............ portal.games.favs
     · thumbs-down ........... portal.games.thumbs (thumbs.js): a game you
                               gave a thumbs-down is never picked
     · what you played ........ plays.js (every kind) + portal.games.recent;
                               something played before is preferred, but
                               NOT something from the last hour
     · this week's play log ... portal.games.playlog
     · session length ......... minutes <= 5 -> Arcade games whose round
                               fits, or catalogue games tagged
                               hypercasual / clicker (a filter);
                               6-19 -> a lean toward short rounds
                               (Arcade, hypercasual) — not a filter,
                               since nearly anything fits 15 minutes;
                               >= 20 -> catalogue games in the kinds
                               people settle into (adventure,
                               strategy, sandbox, idle, survival) and
                               not tagged hypercasual / clicker (a filter)
     · players = 2 ............ Arcade games that really take two on one
                               device, or catalogue cat '2player' / tag
                               '2 player'
     · mood words ............. scary -> horror, relax -> puzzle / idle /
                               'relaxation', race -> racing, hard ->
                               skill / strategy / fighting, friend -> 2
                               players; anything else is searched as text
   Every constraint is a filter. If nothing passes them all, the least
   important one is dropped (time, then mood, then players) and the
   reason SAYS it was dropped. The reason is always a real sentence
   built from the signals that chose the game.
   About four picks in ten come from games you have NOT played yet
   (the hand-picked shelf, games like your last one, mood matches),
   so Quick Play is not just a replay button for your favourites.

   RATINGS AND PLAY COUNTS
   The catalogue's `plays` and `rating` are placeholders today:
   tools/sync-games.mjs fills them from a hash of the id, and
   catalog.js marks its curated numbers as placeholders too. So
   measured(g) is false for every current row and nothing here (or in
   Static Play) ranks by, or shows, those numbers. Rows whose numbers
   do not match the stand-in formula count as measured, so a future
   sync that stores real figures switches them on without a code
   change here.
   ============================================================ */
import { store } from './store.js';
import * as plays from './plays.js';
import * as catalogue from '../portal/games.data.js';
import { ARCADE, arcadeById } from '../arcade/index.js';
import { hiddenKeys } from './thumbs.js';

const K_FAV = 'portal.games.favs';
const K_RECENT = 'portal.games.recent';
const K_LOG = 'portal.games.playlog';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const arr = v => (Array.isArray(v) ? v : []);
const low = s => String(s || '').toLowerCase();

/* Some feed titles and descriptions arrive HTML-escaped ("GLIM &amp; GLO").
   Decoded from a fixed table — never through innerHTML. */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…', zwnj: '', zwj: '', trade: '™', reg: '®', copy: '©', eacute: 'é', egrave: 'è',
  times: '×', bull: '•', middot: '·', rarr: '→', deg: '°', laquo: '«', raquo: '»', infin: '∞', iexcl: '¡',
  aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ouml: 'ö', uuml: 'ü' };
export function cleanText(s) {
  const t = String(s == null ? '' : s);
  /* feed titles also carry runs of spaces where a symbol was stripped
     ("Kick Pong   Table Soccer") */
  if (t.indexOf('&') < 0) return /\s\s|^\s|\s$/.test(t) ? t.replace(/\s+/g, ' ').trim() : t;
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 31 && n < 0x110000 && n !== 127 ? String.fromCodePoint(n) : '';
    }
    const k = e.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
  }).replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 *  measured numbers — see the header
 * ------------------------------------------------------------------ */
/* catalog.js: "plays and rating are PLACEHOLDER engagement numbers" */
const PLACEHOLDER_SOURCES = new Set(['madkid', 'direct']);
const fnv = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/* the stand-in tools/sync-games.mjs writes when a feed has no metrics */
const standIn = id => 40000 + fnv(String(id)) % 860000;

/** Are this row's plays and rating real measurements? */
export function measured(g) {
  if (!g || !g.hasStats || PLACEHOLDER_SOURCES.has(g.source)) return false;
  return g.plays !== standIn(g.id);
}

/* ------------------------------------------------------------------ *
 *  this device's history
 * ------------------------------------------------------------------ */
export const favIds = () => arr(store.get(K_FAV, [])).filter(x => typeof x === 'string');

/** kind:id -> last time it was launched on this device (ms). */
export function lastPlayed() {
  const m = new Map();
  for (const r of arr(store.get(K_RECENT, []))) {
    if (r && typeof r.id === 'string' && Number.isFinite(r.at)) m.set(`web:${r.id}`, r.at);
  }
  for (const r of plays.recent(80)) {
    const k = `${r.kind}:${r.id}`;
    if (!m.has(k) || m.get(k) < r.at) m.set(k, r.at);
  }
  return m;
}

/** web id -> launches in the past seven days, from the Static Games play log. */
export function weekCounts(now = Date.now()) {
  const log = store.get(K_LOG, {});
  const m = new Map();
  if (!log || typeof log !== 'object' || Array.isArray(log)) return m;
  for (const [id, list] of Object.entries(log)) {
    const n = arr(list).filter(t => typeof t === 'number' && now - t < WEEK).length;
    if (n) m.set(id, n);
  }
  return m;
}

/** "3 hours ago", "yesterday", "5 days ago" — for reason lines. */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, now - at);
  if (s < 60000) return 'just now';
  if (s < HOUR) { const n = Math.floor(s / 60000); return `${n} minute${n === 1 ? '' : 's'} ago`; }
  if (s < DAY) { const n = Math.floor(s / HOUR); return `${n} hour${n === 1 ? '' : 's'} ago`; }
  if (s < 2 * DAY) return 'yesterday';
  if (s < 60 * DAY) return `${Math.floor(s / DAY)} days ago`;
  const d = new Date(at);
  return `on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/* ------------------------------------------------------------------ *
 *  moods
 * ------------------------------------------------------------------ */
export const MOODS = [
  { id: 'scary', re: /\b(scary|scare|horror|spooky|creepy|fright\w*|terrify\w*|haunted)\b/i,
    label: 'something scary', cats: ['horror'], tags: ['horror', 'scary', 'zombie'], arcade: ['spooky'] },
  { id: 'relax', re: /\b(relax\w*|chill|calm|cozy|cosy|unwind|peaceful|easy|zen)\b/i,
    label: 'something relaxing', cats: ['puzzle', 'idle'], tags: ['relaxation'], arcade: ['puzzle'] },
  { id: 'race', re: /\b(race|racing|drive|driving|cars?|speed|kart\w*)\b/i,
    label: 'a race', cats: ['racing'], tags: ['race', 'racing', 'driving'], arcade: ['racing'] },
  { id: 'hard', re: /\b(hard|difficult|challeng\w*|tough|skill|intense|sweaty)\b/i,
    label: 'a challenge', cats: ['strategy', 'fighting'], tags: ['skill', 'hard'], arcade: ['skill'] },
  { id: 'shoot', re: /\b(shoot\w*|guns?|sniper|fps)\b/i,
    label: 'a shooter', cats: ['shooter'], tags: ['shooting'], arcade: [] },
  { id: 'think', re: /\b(puzzles?|brain|think\w*|logic|smart)\b/i,
    label: 'something to think about', cats: ['puzzle'], tags: ['brain', 'logic'], arcade: ['puzzle', 'memory'] },
  { id: 'sport', re: /\b(sports?|football|soccer|basketball|golf|tennis|cricket)\b/i,
    label: 'a sports game', cats: ['sports'], tags: ['football', 'soccer'], arcade: ['sports'] },
];
const FRIEND = /\b(friends?|two|2 ?p|2 players?|together|versus|vs|co-?op|buddy|sibling|brother|sister)\b/i;

/** What a free-text mood asks for. Unknown words become a text search. */
export function moodOf(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const hits = MOODS.filter(m => m.re.test(t));
  const players2 = FRIEND.test(t);
  if (!hits.length) {
    const rest = t.replace(FRIEND, ' ').replace(/\b(with|a|an|the|my|me|and|game|games|something|play)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return { ids: [], label: rest ? `“${rest}”` : '', cats: [], tags: [], arcade: [], text: rest.length >= 3 ? rest : '', players2 };
  }
  return {
    ids: hits.map(m => m.id),
    label: hits.map(m => m.label).join(' and '),
    cats: [...new Set(hits.flatMap(m => m.cats))],
    tags: [...new Set(hits.flatMap(m => m.tags))],
    arcade: [...new Set(hits.flatMap(m => m.arcade))],
    text: '', players2,
  };
}

/* ------------------------------------------------------------------ *
 *  candidates
 * ------------------------------------------------------------------ */
/* the catalogue kinds you settle into for a while — the only session-length
   signal the catalogue has besides the hypercasual / clicker tags */
const LONG_CATS = ['adventure', 'strategy', 'sandbox', 'idle', 'survival'];
const isLong = g => g.cats.some(c => LONG_CATS.includes(c)) && !isQuick(g);
const is2p = g => g.cats.includes('2player') || g.tags.some(t => /^2 players?( games)?$/i.test(t));
const isQuick = g => g.tags.some(t => /^(hypercasual|clicker)$/i.test(t));
const catName = id => catalogue.catMeta(id).name;

/* n distinct rows by a partial Fisher–Yates: no retry loop, so even a
   degenerate rng (a constant, in tests) cannot stall it */
function sample(list, n, rng) {
  if (list.length <= n) return list.slice();
  const a = list.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.min(a.length - i - 1, Math.floor(rng() * (a.length - i)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const q = opts => catalogue.query({ sort: 'catalogue', perPage: 400, ...opts }).items;

function webCand(g) {
  return { kind: 'web', id: g.id, title: cleanText(g.title), art: g.art || null, g };
}
function arcadeCand(a) {
  return { kind: 'arcade', id: a.id, title: a.title, art: null, a };
}

/** Whole pool for one request: personal rows + rows that fit each constraint. */
function pool(spec, rng) {
  const out = new Map();
  /* a thumbs-down hides a game from Static Play, Quick Play included */
  const hidden = hiddenKeys();
  const add = (c, force) => {
    if (!c) return;
    const k = `${c.kind}:${c.id}`;
    if (!out.has(k) && (force || !hidden.has(k))) out.set(k, c);
  };

  for (const a of ARCADE) add(arcadeCand(a));
  for (const g of catalogue.byIds(favIds())) add(webCand(g));
  for (const k of spec.last.keys()) {
    const [kind, ...rest] = k.split(':');
    const id = rest.join(':');
    if (kind === 'web') { const g = catalogue.byId(id); if (g) add(webCand(g)); }
    else if (kind === 'creation') {
      const r = plays.recent(80, 'creation').find(x => x.id === id);
      if (r) add({ kind: 'creation', id, title: r.title, art: r.art || null });
    }
  }
  for (const id of spec.week.keys()) { const g = catalogue.byId(id); if (g) add(webCand(g)); }

  const mood = spec.mood;
  if (mood) {
    for (const c of mood.cats) sample(q({ category: c }), 60, rng).forEach(g => add(webCand(g)));
    for (const t of mood.tags) sample(q({ tag: t }), 30, rng).forEach(g => add(webCand(g)));
    if (mood.text) q({ q: mood.text, perPage: 60, sort: 'popular' }).forEach(g => add(webCand(g)));
  }
  if (spec.players >= 2) {
    sample(q({ category: '2player' }), 60, rng).forEach(g => add(webCand(g)));
    sample(q({ tag: '2 player' }), 40, rng).forEach(g => add(webCand(g)));
  }
  if (spec.minutes && spec.minutes < 20) {
    sample(q({ tag: 'hypercasual' }), 50, rng).forEach(g => add(webCand(g)));
    sample(q({ tag: 'clicker' }), 30, rng).forEach(g => add(webCand(g)));
  }
  if (spec.minutes >= 20) {
    for (const c of LONG_CATS) sample(q({ category: c }), 30, rng).forEach(g => add(webCand(g)));
  }
  /* always some breadth: the hand-picked shelf, and games like your last one */
  sample(q({ category: 'featured' }), 40, rng).forEach(g => add(webCand(g)));
  if (spec.lastWeb) catalogue.related(spec.lastWeb, 10).forEach(g => { const c = webCand(g); c.likeOf = spec.lastWeb; add(c); });
  /* pick() never comes back empty: only if every game it could reach was
     hidden does the Arcade come back */
  if (!out.size) for (const a of ARCADE) add(arcadeCand(a), true);
  return [...out.values()];
}

/* ---- constraint fits ------------------------------------------------ */
const FITS = {
  minutes(c, spec) {
    const m = spec.minutes;
    if (!m || (m > 5 && m < 20)) return true;   // 6-19 minutes leans, it does not filter
    if (m <= 5) {
      if (c.kind === 'arcade') return c.a.minutes <= Math.max(1, m);
      if (c.kind === 'web') return isQuick(c.g);
      return false;                              // a creation's length is unknown
    }
    return c.kind === 'web' && isLong(c.g);     // Arcade rounds are short; a creation's length is unknown
  },
  players(c, spec) {
    if (spec.players < 2) return true;
    if (c.kind === 'arcade') return c.a.players.includes(2);
    if (c.kind === 'web') return is2p(c.g);
    return false;
  },
  mood(c, spec) {
    const m = spec.mood;
    if (!m || (!m.cats.length && !m.tags.length && !m.text)) return true;
    if (c.kind === 'arcade') {
      if (m.text) return low(`${c.a.title} ${c.a.blurb} ${c.a.tags.join(' ')}`).includes(low(m.text));
      return c.a.tags.some(t => m.arcade.includes(t));
    }
    if (c.kind === 'web') {
      if (m.text) return low(`${c.g.title} ${c.g.tags.join(' ')} ${c.g.cats.join(' ')}`).includes(low(m.text));
      return c.g.cats.some(x => m.cats.includes(x)) || c.g.tags.some(t => m.tags.includes(low(t)));
    }
    return false;
  },
};
/* dropped first to last when nothing fits every one */
const RELAX_ORDER = ['minutes', 'mood', 'players'];
/* how often a pick comes from games you haven't played yet (see pick()) */
const FRESH_SHARE = 0.4;

/* ---- scoring --------------------------------------------------------- */
function score(c, spec, rng) {
  const k = `${c.kind}:${c.id}`;
  let s = rng() * 1.4;
  const why = [];
  const at = spec.last.get(k);
  if (c.kind === 'web' && spec.favs.has(c.id)) { s += 3; why.push(['fav']); }
  if (at) {
    if (spec.now - at < HOUR) s -= 6;
    else { s += 2; why.push(['played', at]); }
  }
  const wk = c.kind === 'web' ? spec.week.get(c.id) || 0 : 0;
  if (wk) { s += 0.5 * Math.min(wk, 4); if (wk >= 2) why.push(['week', wk]); }
  if (c.kind === 'creation') { s += 1; why.push(['mine']); }
  if (c.likeOf && !at) { s += 0.8; why.push(['like', c.likeOf]); }
  if (c.kind === 'web' && c.g.curated) { s += 0.6; why.push(['curated']); }
  if (c.kind === 'web' && measured(c.g) && c.g.rating >= 4.5) s += 0.6;
  if (c.kind === 'arcade') {
    if (spec.minutes && spec.minutes < 20) s += 0.8;
    if (spec.players >= 2) s += 0.8;           // these really work on one device
    why.push(['arcade']);
  }
  if (c.kind === 'web' && spec.minutes > 5 && spec.minutes < 20 && isQuick(c.g)) s += 0.4;
  if (spec.mood && c.kind === 'web' && spec.mood.cats.some(x => c.g.cats.includes(x))) s += 1;
  return { s, why };
}

/* ---- the sentence ------------------------------------------------------ */
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const an = w => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);

function reasonFor(c, why, spec, dropped, onlyRepeats = false) {
  /* lead: the two strongest personal signals, else what the thing is */
  const has = t => why.find(w => w[0] === t);
  const personal = [];
  if (has('fav')) personal.push('one of your favorites');
  if (has('mine')) personal.push('your own creation');
  if (has('week')) personal.push(`you’ve played it ${has('week')[1]} times this week`);
  else if (has('played')) personal.push(`you last played it ${ago(has('played')[1], spec.now)}`);
  if (has('like')) personal.push(`it’s like ${cleanText(has('like')[1].title)}, which you played`);
  let lead;
  let generic = false;
  if (personal.length) lead = cap(personal.slice(0, 2).join(', and '));
  else if (c.kind === 'arcade') lead = 'Built into StaticOS, so it starts instantly';
  else if (has('curated')) lead = 'From the hand-picked shelf';
  else { generic = true; lead = cap(`${an(catName(c.g.cats.find(x => x !== 'featured') || c.g.cats[0]).toLowerCase())} game from the catalogue`); }

  const fits = [];
  const quickTag = g => g.tags.find(t => /^(hypercasual|clicker)$/i.test(t));
  const mins = n => `${n} minute${n === 1 ? '' : 's'}`;
  if (spec.minutes && spec.minutes <= 5 && !dropped.includes('minutes')) {
    if (c.kind === 'arcade') fits.push(`a round takes about ${mins(c.a.minutes)}`);
    else if (c.kind === 'web') fits.push(`tagged ${quickTag(c.g).toLowerCase()}, so it’s quick to pick up`);
  } else if (spec.minutes > 5 && spec.minutes < 20) {
    /* only say something about time when there is something true to say */
    if (c.kind === 'arcade') fits.push(`a round takes about ${mins(c.a.minutes)}, so a few rounds fit into ${spec.minutes}`);
    else if (c.kind === 'web' && quickTag(c.g)) fits.push(`tagged ${quickTag(c.g).toLowerCase()}, so it fits a short session`);
  } else if (spec.minutes >= 20 && c.kind === 'web' && !dropped.includes('minutes')) {
    const cat = c.g.cats.find(x => LONG_CATS.includes(x));
    fits.push(`${an(catName(cat).toLowerCase())} game — the kind you can settle into, since you have ${spec.minutes}+ minutes`);
  }
  if (spec.players >= 2 && !dropped.includes('players')) {
    if (c.kind === 'arcade') fits.push(c.a.input.includes('keyboard') ? 'two players share one keyboard' : 'two players take turns on one device');
    else fits.push('made for two players');
  }
  if (spec.mood && spec.mood.label && !dropped.includes('mood')) {
    const m = spec.mood;
    if (m.text) {
      /* say where the words were found — the title, or the publisher's tags */
      const t = low(m.text);
      const inTitle = low(c.title).includes(t);
      if (c.kind === 'arcade') fits.push(`its ${inTitle ? 'name' : 'description'} matches ${m.label}`);
      else if (inTitle) fits.push(`its title matches ${m.label}`);
      else if (c.g.tags.some(x => low(x).includes(t))) fits.push(`its publisher tagged it ${m.label}`);
      else {
        const cat = c.g.cats.find(x => low(x).includes(t));
        fits.push(cat ? `it’s filed under ${catName(cat)}, which matches ${m.label}` : `it matches ${m.label}`);
      }
    } else if (c.kind === 'web') {
      const cat = c.g.cats.find(x => m.cats.includes(x));
      const tag = c.g.tags.find(t => m.tags.includes(t.toLowerCase()));
      fits.push(cat ? `${an(catName(cat).toLowerCase())} game, since you asked for ${m.label}`
        : `tagged “${tag ? tag.toLowerCase() : m.label}”, since you asked for ${m.label}`);
    } else if (c.kind === 'arcade') {
      const tag = c.a.tags.find(t => m.arcade.includes(t));
      fits.push(`${an(tag || 'arcade')} game, since you asked for ${m.label}`);
    }
  }

  /* "From the hand-picked shelf." alone doesn't say what you're getting */
  if (!fits.length && !personal.length && c.kind === 'web' && has('curated')) {
    const cat = c.g.cats.find(x => x !== 'featured');
    if (cat) lead += `: ${an(catName(cat).toLowerCase())} game`;
  }
  /* a generic "an action game from the catalogue" adds nothing next to a real fit */
  let out = generic && fits.length ? '' : `${lead}.`;
  if (fits.length) out += `${out ? ' ' : ''}${cap(fits.join('; '))}.`;
  if (dropped.length) {
    const what = { minutes: 'how long you have', mood: 'the mood', players: 'two players' };
    out += onlyRepeats
      ? ` You’ve just had the games that fit everything you asked for, so this one skips ${dropped.map(d => what[d]).join(' and ')}.`
      : ` Nothing fit everything you asked for, so this one skips ${dropped.map(d => what[d]).join(' and ')}.`;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  pick
 * ------------------------------------------------------------------ */
/**
 * pick({ minutes, players, mood, avoidIds }) -> { kind, id, title, art, reason, ... }
 *   minutes   number | null   how long you have (<= 5 means a quick game)
 *   players   1 | 2           2 = with a friend on this device
 *   mood      string          free words: 'scary', 'relax', 'race', 'hard', 'with a friend', 'zombies'…
 *   avoidIds  string[]        ids (or kind:id keys) not to pick — e.g. the last few picks
 * Never returns null: the Arcade is always there.
 */
export function pick(opts = {}) {
  /* A read before load() gets the built-in shelf, so start the load before
     the first read. This pick uses the shelf; the full catalogue replaces it
     when it lands. */
  if (!catalogue.isLoaded()) catalogue.load().catch(() => {});
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const mood = moodOf(opts.mood);
  const minutes = Number(opts.minutes) > 0 ? Number(opts.minutes) : null;
  const players = Number(opts.players) >= 2 || mood?.players2 ? 2 : 1;
  const last = lastPlayed();
  let lastWeb = null;
  for (const r of plays.recent(20, 'web')) { lastWeb = catalogue.byId(r.id); if (lastWeb) break; }
  if (!lastWeb) {
    const r = arr(store.get(K_RECENT, [])).find(x => x && catalogue.byId(x.id));
    if (r) lastWeb = catalogue.byId(r.id);
  }
  const spec = { minutes, players, mood, last, week: weekCounts(now), favs: new Set(favIds()), now, lastWeb };

  const avoid = new Set(arr(opts.avoidIds).map(String));
  const avoided = c => avoid.has(c.id) || avoid.has(`${c.kind}:${c.id}`);

  const all = pool(spec, rng);
  const active = ['minutes', 'players', 'mood'].filter(k =>
    (k === 'minutes' && minutes && (minutes <= 5 || minutes >= 20)) || (k === 'players' && players >= 2)
    || (k === 'mood' && mood && (mood.cats.length || mood.tags.length || mood.text)));

  /* Relax constraints (least important first) until something fits that
     was not just picked. Only when even that finds nothing does a recent
     pick come back — "Pick another" should mean another. */
  const fitsAll = (c, keys) => keys.every(k => FITS[k](c, spec));
  function choose(skipAvoided) {
    const ok = c => !skipAvoided || !avoided(c);
    const tryWith = keys => all.filter(c => ok(c) && fitsAll(c, keys));
    let dropped = [];
    let fit = tryWith(active);
    for (const k of RELAX_ORDER) {
      if (fit.length) break;
      if (!active.includes(k)) continue;
      dropped = [...dropped, k];
      fit = tryWith(active.filter(x => !dropped.includes(x)));
    }
    if (!fit.length) fit = all.filter(c => c.kind === 'arcade' && ok(c));
    if (!fit.length) fit = all.filter(ok);
    return { fit, dropped };
  }
  let { fit: usable, dropped } = choose(true);
  if (!usable.length) ({ fit: usable, dropped } = choose(false));
  /* dropped only because everything that fit it all was picked just now */
  const onlyRepeats = dropped.length > 0 && all.some(c => fitsAll(c, active));

  const scored = usable.map(c => ({ c, ...score(c, spec, rng) })).sort((a, b) => b.s - a.s);
  /* Favourites and things you played always outscore the rest, so a plain
     "best six" would only ever hand back games you already know. Some of the
     time the draw is made from the ones you haven't played instead (the
     hand-picked shelf, games like your last one, whatever fits the mood) —
     each still carries its own true reason. */
  const known = x => x.why.some(w => w[0] === 'fav' || w[0] === 'played' || w[0] === 'week' || w[0] === 'mine');
  const familiar = scored.filter(known);
  const fresh = scored.filter(x => !known(x));
  const bag = familiar.length && fresh.length ? (rng() < FRESH_SHARE ? fresh : familiar) : scored;
  /* weighted draw among the best few, so pressing again gives something else
     good; the temperature keeps one strong favourite from winning every time */
  const top = bag.slice(0, 6);
  const w = top.map(x => Math.exp((x.s - top[0].s) / 1.6));
  let r = rng() * w.reduce((a, b) => a + b, 0);
  let chosen = top[0];
  for (let i = 0; i < top.length; i++) { r -= w[i]; if (r <= 0) { chosen = top[i]; break; } }

  const c = chosen.c;
  const item = {
    kind: c.kind, id: c.id, title: c.title, art: c.art || null,
    reason: reasonFor(c, chosen.why, spec, dropped, onlyRepeats),
  };
  if (c.kind === 'arcade') Object.assign(item, { hue: c.a.hue, icon: c.a.icon, minutes: c.a.minutes, players2: players >= 2 && c.a.players.includes(2) });
  if (c.kind === 'web') Object.assign(item, { studio: c.g.studio, cats: c.g.cats });
  return item;
}

/** Load the full catalogue so pick() draws on all of it, not just the built-in shelf. */
export async function ready() {
  try { await catalogue.load(); } catch (e) { /* load() degrades on its own */ }
  return catalogue.all().length;
}

/* ------------------------------------------------------------------ *
 *  launch
 * ------------------------------------------------------------------ */
const APP_NAMES = { 'aether-games': 'Static Games', arcade: 'Static Arcade', forge: 'Static Forge' };

/** Where an item opens: { app, opts }. */
export function targetFor(item) {
  if (!item) return null;
  if (item.kind === 'arcade') {
    return { app: 'arcade', opts: item.players2 ? { game: item.id, players: 2 } : { game: item.id } };
  }
  if (item.kind === 'creation') return { app: 'forge', opts: { project: item.id } };
  return { app: 'aether-games', opts: { url: `static://games/${item.id}` } };
}

/**
 * Open a picked item. Returns whatever openApp returns (the window), or null
 * when the app it needs is not installed in this build — with a toast saying
 * so rather than failing silently.
 */
export function launch(item, api) {
  const t = targetFor(item);
  if (!t || !api || typeof api.openApp !== 'function') return null;
  if (typeof api.getApp === 'function' && !api.getApp(t.app)) {
    api.notify?.({
      app: 'Static Play', icon: 'alert', title: `${APP_NAMES[t.app] || t.app} isn’t available`,
      message: `This build of StaticOS doesn’t include ${APP_NAMES[t.app] || t.app} yet, so “${item.title}” can’t open.`,
    });
    return null;
  }
  return api.openApp(t.app, t.opts) || null;
}

export { arcadeById };
export default { pick, launch, ready, targetFor, moodOf, measured, favIds, lastPlayed, weekCounts, ago, cleanText, MOODS };
