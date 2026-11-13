/* ============================================================
   arcade.js — Static Arcade: quick games built into StaticOS.

   Two screens inside one dark "cabinet" window:

   · Home — a grid of game cabinets drawn from js/arcade/index.js
     (title, blurb, players, what input it reads, a typical round,
     and this device's best score in the right direction), filters
     (All · Quick · 2 Player · Skill · Puzzle · Classic), a Random
     quick game button, and a Clips tab. Above the grid (All and
     Puzzle) sits "Today's puzzle": Daily Stars for today's date,
     with a tick once it is solved, the time, and this device's
     streak (js/arcade/daily-state.js). It repaints when the game
     saves and when the date changes while the Arcade is open.
   · Play — a HUD (score, best, 1P/2P when the game has it, pause,
     restart, record, sound, fullscreen, back) over the game, which
     is mounted into the stage through the module contract in
     js/arcade/index.js. Loading, pause, error and the end-of-round
     card are overlays on the stage.

   Everything shown is real: players are same-device players, bests
   are this browser's, and nothing pretends to be online. A game
   whose file is missing gets a "could not load" card instead of a
   crash; the rest of the Arcade keeps working.

   Scores: store 'portal.arcade' = { best: { [id]: n }, filter, sound }.
   Only 1-player rounds set a best (two people on one keyboard is
   not one person's score); every round end still emits
   bus 'arcade:score' { game, score, best, newBest, hadBest, players, won? }
     (won only when the game itself reports a boolean win/loss)
   and every start calls plays.record({ kind: 'arcade', … }).

   Static Replay: when the game draws to a <canvas>, Record captures
   it (canvas.captureStream(30) + MediaRecorder) for up to 30 s of
   play — pausing the game pauses the clip — and saves it to
   IndexedDB (db.js kv('clips')) as
   { id, game, title, at, mime, blob, durationMs }. The Clips tab
   plays, downloads and deletes them; every object URL is revoked
   on repaint and teardown. Where the browser cannot record, the
   button is replaced by a note that says why. Every save or delete
   emits bus 'clips:change' { id, kind: 'save'|'delete' }, and the
   Clips tab repaints when anything else emits it.

   Controllers: while a game is on screen and the person has turned
   on "Play keyboard games with a controller" (padmap.isEnabled()),
   the shared gamepad → keyboard bridge runs (padmap.start/stop), so
   the D-pad, stick and buttons drive every keyboard game. The HUD
   says when a pad is present — and, honestly, when the bridge is
   off so the pad would do nothing.

   Cabinets have a context menu (right-click, the Menu key, or the
   visible … button): Play, Add to Desktop, Add to collection….

   Online: games marked `online` in js/arcade/index.js can be played
   against a friend on another device. Choosing Online (the HUD's
   player switch, a cabinet's menu, the Online filter, or "Join a
   friend" at the top) opens a room through js/arcade/room.js on the
   live connection: Make a room shows a six-character code (and an
   invite link, #arcade=<id>&room=<CODE>); the friend types it in.
   The host starts each round, both sides count down 3-2-1 with the
   same seed, and the game gets ctx.online to talk to its twin. The
   HUD shows the friend's score beside yours, the end card says who
   won, and Rematch starts another round once both ask. Online rounds
   never change a best (the clock and the rules differ), and they are
   reported as 'arcade:score' { …, players: 2, online: true }. The
   lobby says plainly that the room runs on a free public server
   anyone with the code can join, and when the network blocks it.

   Free Classics: old games their makers released for free, on a shelf
   of their own (All and the Old Games filter). They are not in
   ARCADE: they download once, run in a sandboxed frame, and have no
   score. js/classics/ has the games, the frame and the card; the view
   'classic' here is only the window around them. Opening one by id
   ({ game: 'classic-sky' }) works like any other Arcade game, so the
   Library and Desktop shortcuts need nothing special.
   ============================================================ */
import { defineApp } from '../core/registry.js';
import { ARCADE, arcadeById } from '../arcade/index.js';
import * as plays from '../core/plays.js';
import * as DB from '../core/db.js';
import * as padmap from '../core/padmap.js';
import { addToDesktop } from '../core/shortcuts.js';
import { pickMenu } from '../core/collections.js';
import { openRoom, normalizeCode, isCode } from '../arcade/room.js';
import { sharer, watcherView } from '../arcade/watchui.js';
import * as live from '../portal/live.js';
import * as daily from '../arcade/daily-state.js';
import { dayKey, parseDay, REGION_HUES } from '../arcade/stars.js';
import { CLASSICS, classicFromGameId } from '../classics/catalog.js';
import { ART_SPORTS2 } from '../arcade/art-sports2.js';

if (typeof document !== 'undefined' && !document.getElementById('feat-arcade-css')) {
  const l = document.createElement('link');
  l.id = 'feat-arcade-css';
  l.rel = 'stylesheet';
  l.href = 'css/feat-arcade.css';
  document.head.appendChild(l);
}

const KEY = 'portal.arcade';
const REC_MAX_MS = 30_000;
const AUTO_STOP_MS = 1500;           /* keep filming this long after a round ends */

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'quick', label: 'Quick', title: 'A round takes 2 minutes or less', test: g => g.minutes <= 2 },
  { id: 'duo', label: '2 Player', title: 'Two people on one keyboard or screen', test: g => g.players.includes(2) },
  { id: 'online', label: 'Online', title: 'Play a friend on another device, with a room code', test: g => !!g.online || g.tags.includes('multiplayer') },
  { id: 'skill', label: 'Skill', test: g => g.tags.includes('skill') },
  { id: 'puzzle', label: 'Puzzle', test: g => g.tags.includes('puzzle') },
  { id: 'classic', label: 'Classic', test: g => g.tags.includes('classic') },
  { id: 'cards', label: 'Cards', title: 'Solitaire, Spider, FreeCell, Crazy Eights and Blackjack', test: g => g.tags.includes('cards') },
  /* not ARCADE games: its own shelf, see js/classics/ */
  { id: 'freeclassics', label: 'Old Games', title: 'Free Classics: old games their makers released for free', test: () => false, count: () => CLASSICS.length },
];
const filterOf = id => FILTERS.find(f => f.id === id) || FILTERS[0];

const INPUTS = {
  keyboard: { icon: 'keyboard', label: 'Keyboard' },
  mouse: { icon: 'mouse-pointer', label: 'Mouse' },
  touch: { icon: null, label: 'Touch' },
};
/* no touch glyph in the icon set: a static phone outline */
const TOUCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';

/* What each game's score counts, so a number never stands alone.
   (Checked against what each module passes to onScore / onEnd.) */
const UNITS = {
  snake: 'length', pong: 'points', breakout: 'points', flap: 'pipes', racer: 'metres', g2048: 'points', blocks: 'points',
  reaction: 'ms', aim: 'ms', typing: 'WPM', memory: 'moves', mines: 'seconds', echo: 'in a row',
  'ghost-hunt': 'points', 'candy-catcher': 'points', 'haunted-maze': 'seconds',
  daily: 'seconds', chess: 'moves', connect4: 'moves', ttt: 'marks', dnb: 'boxes',
  mancala: 'stones', crazy8: 'points', blackjack: 'points', sketch: 'points',
  solitaire: 'seconds', spider: 'seconds', freecell: 'seconds',
  stacker: 'points', defenders: 'points', hopper: 'points', bubbles: 'points',
  gems: 'points', sudoku: 'seconds', nonogram: 'seconds', wordsearch: 'seconds',
  hangman: 'in a row', mahjong: 'seconds', reversi: 'discs', checkers: 'moves',
  battleship: 'shots', minigolf: 'strokes', pinball: 'points', skyhop: 'metres',
  chaser: 'points', runner: 'metres', moles: 'points', slicer: 'points',
  jumper: 'levels',
  rhythm: 'points', sliding: 'seconds', lightsout: 'moves', towerdefense: 'points',
  snakebattle: 'apples', airhockey: 'goals', bowling: 'pins', basketball: 'points',
  darts: 'darts', 'darts-clock': 'darts', pool: 'shots', archery: 'points', laprush: 'seconds',
  fivedice: 'points', dominoes: 'points', go: 'points', gomoku: 'stones',
  pipelink: 'seconds', jigsaw: 'seconds', clicker: 'seconds',
  lettergrid: 'points', unscramble: 'points', crossword: 'seconds', sumgrid: 'seconds',
};
const SHORT_UNITS = { metres: 'm', seconds: 's' };
const unitOf = id => UNITS[id] || '';
const shortUnit = id => { const u = unitOf(id); return SHORT_UNITS[u] || (u === 'ms' || u === 'WPM' ? u : ''); };

const fmtN = n => (typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(n ?? '—'));
const dur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const bytes = n => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/* ---------- online play ---------- */
const COUNTDOWN = 3;
const LIVE_TEXT = {
  idle: 'Not connected yet',
  connecting: 'Connecting to the live server…',
  live: 'Connected to the live server',
  offline: 'Can’t reach the live server — this network may block it. Trying again…',
};
const JOIN_ERR = {
  invalid: ['That isn’t a room code', 'Room codes are 6 letters and numbers, like K7QM2X.'],
  nobody: ['No room answered', 'Nobody has a room open with that code right now. Check the code, and that your friend still has the room open.'],
  full: ['That room is full', 'It already has two players.'],
  game: ['Can’t play that room here', 'It is playing a game this StaticOS doesn’t have.'],
};
const spaced = code => String(code || '').split('').join(' ');
const watchLink = (id, code) => {
  try { return `${location.origin}${location.pathname}#arcade=${encodeURIComponent(id)}&spectate=${code}`; } catch (err) { return ''; }
};
const inviteLink = (id, code) => {
  try { return `${location.origin}${location.pathname}#arcade=${encodeURIComponent(id)}&room=${code}`; } catch (err) { return ''; }
};

/* ---------------------------------------------------------------
   WebM duration. MediaRecorder writes WebM with no Duration in the
   header (it does not know it until the end), so players show no
   length and cannot seek until they have read the whole file — in
   ours and in whatever player a downloaded clip is opened with. We
   know the length, so before saving we add Segment › Info › Duration.
   Anything unexpected in the layout keeps the original blob.
   --------------------------------------------------------------- */
const EBML = { HEADER: 0x1A45DFA3, SEGMENT: 0x18538067, INFO: 0x1549A966, DURATION: 0x4489, SCALE: 0x2AD7B1 };

/* an element ID at b[i] (marker bits kept, as the spec writes IDs) */
function ebmlId(b, i) {
  const first = b[i];
  if (!first) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || i + len > b.length) return null;
  let id = 0;
  for (let k = 0; k < len; k++) id = id * 256 + b[i + k];
  return { len, id };
}
/* an element size at b[i]; `unknown` = all value bits set */
function ebmlSize(b, i) {
  const first = b[i];
  if (!first) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  const mask = (0x80 >> (len - 1)) - 1;
  let value = first & mask, ones = (first & mask) === mask;
  for (let k = 1; k < len; k++) { value = value * 256 + b[i + k]; if (b[i + k] !== 0xff) ones = false; }
  return { len, value, unknown: ones };
}
function ebmlSizeBytes(value, len) {
  const out = new Uint8Array(len);
  let v = value;
  for (let k = len - 1; k >= 0; k--) { out[k] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

async function webmWithDuration(blob, ms) {
  try {
    if (!/webm/i.test(blob.type) || !(ms > 0)) return blob;
    const b = new Uint8Array(await blob.arrayBuffer());
    const head = ebmlId(b, 0);
    if (!head || head.id !== EBML.HEADER) return blob;
    const hs = ebmlSize(b, head.len);
    if (!hs || hs.unknown) return blob;
    const segAt = head.len + hs.len + hs.value;
    const seg = ebmlId(b, segAt);
    if (!seg || seg.id !== EBML.SEGMENT) return blob;
    const ss = ebmlSize(b, segAt + seg.len);
    if (!ss) return blob;
    const segBody = segAt + seg.len + ss.len;
    const segEnd = ss.unknown ? b.length : Math.min(b.length, segBody + ss.value);
    for (let j = segBody; j < segEnd;) {
      const el = ebmlId(b, j);
      const sz = el && ebmlSize(b, j + el.len);
      if (!el || !sz || sz.unknown) return blob;        /* reached a live-streamed Cluster first */
      const body = j + el.len + sz.len, end = body + sz.value;
      if (end > b.length) return blob;
      if (el.id !== EBML.INFO) { j = end; continue; }
      let scale = 1e6;
      for (let k = body; k < end;) {
        const c = ebmlId(b, k);
        const cs = c && ebmlSize(b, k + c.len);
        if (!c || !cs || cs.unknown) return blob;
        const cb = k + c.len + cs.len;
        if (c.id === EBML.DURATION) return blob;        /* already has one */
        if (c.id === EBML.SCALE && cs.value <= 8) { let v = 0; for (let q = 0; q < cs.value; q++) v = v * 256 + b[cb + q]; if (v > 0) scale = v; }
        k = cb + cs.value;
      }
      /* Duration is a float64 in TimecodeScale units (ns per tick) */
      const dur = new Uint8Array(11);
      dur.set([0x44, 0x89, 0x88]);
      new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / scale);
      const infoSize = ebmlSizeBytes(sz.value + dur.length, 8);
      const head2 = b.slice(0, j + el.len);
      if (!ss.unknown) {                               /* a sized Segment grows by what we add */
        const grown = ss.value + (infoSize.length - sz.len) + dur.length;
        if (grown >= 2 ** (7 * ss.len) - 1) return blob;
        head2.set(ebmlSizeBytes(grown, ss.len), segAt + seg.len);
      }
      return new Blob([head2, infoSize, b.subarray(body, end), dur, b.subarray(end)], { type: blob.type });
    }
  } catch (err) { /* keep the clip as recorded */ }
  return blob;
}

/* what this browser can record, decided once */
function recordSupport() {
  if (typeof MediaRecorder === 'undefined') return { ok: false, why: 'This browser has no MediaRecorder, so it cannot record video.' };
  if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return { ok: false, why: 'This browser cannot turn a canvas into video (no captureStream).' };
  }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4']
    .find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (err) { return false; } });
  if (!mime) return { ok: false, why: 'This browser cannot record WebM or MP4 video.' };
  return { ok: true, mime };
}

/* ==================================================================== */

defineApp({
  id: 'arcade',
  name: 'Static Arcade',
  icon: 'gamepad',
  g1: '#bb6ff8', g2: '#6a1cc4',
  category: 'Games',
  keywords: ['games', 'arcade', 'play', 'snake', 'pong', 'breakout', 'flappy', 'flap', 'racing', '2048', 'block fit', 'blocks',
    'block puzzle', 'puzzle', 'online', 'play a friend', 'room code', 'versus', 'race',
    'reaction', 'aim', 'typing', 'memory', 'minesweeper', 'high score', 'best score', 'clips', 'replay', 'record', '2 player',
    'halloween', 'spooky', 'ghost', 'ghost hunt', 'candy', 'candy catcher', 'maze', 'haunted maze',
    'chess', 'connect four', 'connect 4', 'four in a row', 'board games', 'daily puzzle', 'puzzle of the day', 'daily stars', 'star battle', 'streak',
    'cards', 'card games', 'solitaire', 'klondike', 'spider', 'spider solitaire', 'freecell',
    'stacker', 'falling blocks', 'tetromino', 'space defenders', 'invaders', 'shooter', 'road hopper', 'frog', 'bubble pop', 'bubble shooter',
    'gem swap', 'match three', 'match 3', 'gems', 'sudoku', 'nonogram', 'nonograms', 'picross', 'word search', 'wordsearch', 'logic',
    'hangman', 'word game', 'mahjong', 'mahjong solitaire', 'tiles', 'reversi', 'othello', 'checkers', 'draughts',
    'battleship', 'warships', 'sea battle', 'mini golf', 'minigolf', 'putt', 'golf', 'pinball', 'flippers', 'sky hop', 'doodle jump', 'jumper',
    'dot chaser', 'maze chase', 'ghosts', 'endless runner', 'runner', 'jump', 'whack a mole', 'whack-a-mole', 'moles', 'fruit slice', 'fruit ninja', 'slice', 'reflex',
    'rhythm', 'rhythm tap', 'music game', 'beat', 'sliding puzzle', '15 puzzle', 'lights out', 'tower defense', 'td', 'strategy',
    'free classics', 'old games', 'freeware', 'beneath a steel sky', 'adventure', 'point and click', 'micropolis', 'city builder', 'sopwith', 'biplane',
    'darts', 'dartboard', '501', 'around the clock', 'pool', '8 ball', 'billiards', 'archery', 'bow', 'lap rush', 'time trial', 'ghost lap',
    'snake battle', 'two snakes', 'snake versus', 'air hockey', 'hockey', 'puck', 'bowling', 'strike', 'spare', 'ten pin', 'basketball', 'free throw', 'hoops', 'sports',
    'five dice', 'dice', 'dominoes', 'domino', 'go', 'baduk', 'weiqi', 'gomoku', 'five in a row', 'tabletop',
    'letter grid', 'word grid', 'find words', 'unscramble', 'anagram', 'anagrams', 'jumble', 'crossword', 'mini crossword', 'crosswords', 'sum grid', 'killer sudoku', 'cages', 'number logic'],
  desc: `${ARCADE.length} quick games built into StaticOS, with best scores and clip recording`,
  singleton: true,
  win: { w: 980, h: 680, minW: 380, minH: 460 },
  /* keys listed on the shortcut sheet (hold ⌘ / Ctrl): each one is bound below */
  shortcuts: [
    ['P / Esc', 'Pause or resume the game'],
    ['Enter', 'Play again when a round is over'],
  ],

  mount(ctx) {
    const { root, win, opts, api } = ctx;
    const { h, icon, clear, store, bus } = api;
    const REC = recordSupport();

    const readState = () => { const v = store.get(KEY, null); return v && typeof v === 'object' ? v : {}; };
    const writeState = patch => store.set(KEY, { ...readState(), ...patch });
    const getBest = id => { const b = readState().best?.[id]; return Number.isFinite(b) ? b : null; };
    const setBest = (id, n) => { const cur = readState(); writeState({ best: { ...(cur.best || {}), [id]: n } }); };
    const soundOn = () => readState().sound !== false && store.get('prefs.muted', false) !== true;
    const reducedMotion = () => !!store.get('prefs.reduceMotion')
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff456d';
    const notify = n => api.notify({ app: 'Static Arcade', icon: 'gamepad', ...n });

    const S = {
      view: 'games',             /* games | clips | play | classic */
      filter: filterOf(readState().filter).id,
      game: null, players: 1,
      inst: null, token: 0,
      status: 'idle',            /* idle | loading | playing | paused | over | error */
      error: null, result: null,
      rec: null, autoStop: 0,
      clipUrls: [], clipTimers: [], clipsToken: 0, clipCount: null,
      padOn: false,               /* we started padmap's shared bridge */
      online: false,              /* this game is being played against a friend online */
      net: null,                  /* the online session — see netStart() */
      watch: null,                /* a friend's game being watched — see startWatch() */
      lastScore: null,
      dead: false,
    };
    const offs = [];

    /* ============================ skeleton ============================ */
    const uid = `arc-${Math.random().toString(36).slice(2, 8)}`;
    const onTabKey = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const next = e.key === 'Home' ? 'games' : e.key === 'End' ? 'clips' : S.view === 'games' ? 'clips' : 'games';
      go(next);
      (next === 'games' ? tabGames : tabClips).focus();
    };
    const tabGames = h('button.arc-tab', { type: 'button', role: 'tab', id: `${uid}-tg`, 'aria-controls': `${uid}-panel`, onclick: () => go('games'), onkeydown: onTabKey },
      icon('grid-9'), h('span', { text: 'Games' }));
    const clipCountEl = h('span.arc-tab__n', { 'aria-hidden': 'true' });
    const tabClips = h('button.arc-tab', { type: 'button', role: 'tab', id: `${uid}-tc`, 'aria-controls': `${uid}-panel`, onclick: () => go('clips'), onkeydown: onTabKey },
      icon('film'), h('span', { text: 'Clips' }), clipCountEl);
    const randomBtn = h('button.arc-rand', { type: 'button', onclick: randomQuick, title: 'Start a random game that takes 2 minutes or less' },
      icon('shuffle'), h('span', { text: 'Random quick game' }));
    const joinOpenBtn = h('button.arc-rand.arc-rand--join', {
      type: 'button', 'aria-expanded': 'false', 'aria-controls': `${uid}-join`,
      title: 'Type the room code a friend sent you', onclick: () => toggleJoinBar(),
    }, icon('globe'), h('span', { text: 'Join a friend' }));
    /* the home screen's join form: a code from a friend → their room */
    const joinInput = h('input.arc-net__input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '80',
      placeholder: 'Room code, e.g. K7QM2X', 'aria-label': 'Room code from your friend', id: `${uid}-jcode`,
    });
    const joinStatus = h('div.arc-joinbar__status', { role: 'status', 'aria-live': 'polite' });
    const joinBar = h('form.arc-joinbar', {
      id: `${uid}-join`, hidden: true,
      onsubmit: e => { e.preventDefault(); joinOnline(joinInput.value, 'home'); },
    },
      h('label.arc-joinbar__lab', { for: `${uid}-jcode` }, icon('globe'), h('span', { text: 'Join a friend’s room' })),
      h('div.arc-joinbar__row', joinInput,
        h('button.btn.btn--primary', { type: 'submit' }, h('span', { text: 'Join' })),
        h('button.btn.arc-joinbar__watch', { type: 'button', title: 'Watch a friend’s shared game with their watch code', onclick: () => startWatch(joinInput.value) }, icon('eye'), h('span', { text: 'Watch' })),
        h('button.btn.btn--ghost', { type: 'button', onclick: () => toggleJoinBar(false) }, h('span', { text: 'Cancel' }))),
      joinStatus,
      h('div.arc-joinbar__note', { text: 'Online rooms and watching use StaticOS’s live connection, a free public server: anyone with the code can join or watch, and nothing is saved. Watching needs a watch code, which a player makes with the eye button in their game.' }));
    const top = h('header.arc-top',
      h('div.arc-brand',
        h('span.arc-brand__logo', icon('gamepad')),
        h('div.arc-brand__txt',
          h('div.arc-brand__name', h('span', { text: 'Static' }), h('b', { text: 'Arcade' })),
          h('div.arc-brand__sub', { text: `${ARCADE.length} games built in · scores and clips stay on this device` }))),
      h('div.arc-top__right',
        h('div.arc-tabs', { role: 'tablist', 'aria-label': 'Arcade sections' }, tabGames, tabClips),
        joinOpenBtn, randomBtn));
    const filtersEl = h('div.arc-filters', { role: 'toolbar', 'aria-label': 'Filter games' });
    const main = h('div.arc-scroll', { role: 'tabpanel', id: `${uid}-panel`, 'aria-labelledby': `${uid}-tg` });
    const home = h('section.arc-home', top, joinBar, filtersEl, main);

    /* play view */
    const backBtn = h('button.arc-ib.arc-ib--back', { type: 'button', 'aria-label': 'Back to the Arcade', title: 'Back to the Arcade', onclick: () => go('games') },
      icon('chevron-left'), h('span', { text: 'Arcade' }));
    const hudDot = h('span.arc-hud__dot');
    const hudName = h('span.arc-hud__name');
    const scoreEl = h('b.arc-hud__num', { text: '0' });
    const bestEl = h('b.arc-hud__num.arc-hud__num--best', { text: '—' });
    const bestLab = h('span.arc-hud__lab', { text: 'Best' });
    const scoreLab = h('span.arc-hud__lab', { text: 'Score' });
    const stats = h('div.arc-hud__stats', { 'aria-label': 'Score' },
      h('div.arc-hud__stat', scoreLab, scoreEl),
      h('div.arc-hud__stat', bestLab, bestEl));
    const segEl = h('div.arc-seg', { role: 'group', 'aria-label': 'Players' });
    const pauseBtn = h('button.arc-ib', { type: 'button', onclick: () => (S.status === 'paused' ? resume() : pause()) });
    const restartBtn = h('button.arc-ib', { type: 'button', 'aria-label': 'Restart', title: 'Restart', onclick: () => startRound() }, icon('rotate-ccw'));
    const recSlot = h('div.arc-recslot');
    const soundBtn = h('button.arc-ib', { type: 'button', onclick: toggleSound });
    const canFs = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
    const fsBtn = canFs ? h('button.arc-ib', { type: 'button', onclick: toggleFs }) : null;
    const padSlot = h('div.arc-padslot', { 'aria-live': 'polite' });
    const roomChip = h('span.arc-room', { hidden: true });
    /* spectating: "let friends watch" on the player's side (js/arcade/watchui.js), nothing until they press Start sharing */
    const shareKit = sharer({ notify, linkFor: (id, code) => watchLink(id, code) });
    shareKit.setSource(() => snapshotNow());
    const hud = h('div.arc-hud',
      h('div.arc-hud__left', backBtn, h('div.arc-hud__title', hudDot, hudName), roomChip, padSlot),
      stats,
      h('div.arc-hud__tools', segEl, shareKit.btn, pauseBtn, restartBtn, recSlot, soundBtn, fsBtn));
    const gameHost = h('div.arc-stage__game');
    const overlay = h('div.arc-stage__ov', { 'aria-live': 'polite' });
    const stage = h('div.arc-stage', { tabindex: '0', 'aria-label': 'Game' }, gameHost, overlay);
    const play = h('section.arc-play', hud, shareKit.panel, stage);
    const watchSec = h('div.arc-watchsec', { hidden: true, style: { display: 'flex', flex: '1', minHeight: '0', flexDirection: 'column' } });

    /* Free Classics: loaded when first wanted, so the Arcade itself stays as quick to open */
    let classics = null;
    const classicsReady = () => classics ? Promise.resolve(classics) : import('../classics/ui.js').then(m => {
      if (!classics && !S.dead) {
        classics = m.classicsUI({
          api, h, icon, clear, plays, soundOn,
          onOpen: id => openClassic(id),
          onBack: () => go('games'),
          onToggleSound: () => writeState({ sound: readState().sound === false }),
          soundBtnPaint: paintSoundOn,
          onToggleFs: canFs ? v => {
            if (document.fullscreenElement === v) document.exitFullscreen().catch(() => {});
            else v.requestFullscreen?.().catch(err => notify({ icon: 'alert', title: 'Full screen was refused', message: err.message }));
            classics?.focus();
          } : null,
          fsBtnPaint: paintFsOn,
        });
      }
      return classics;
    });
    const classicSlot = h('div.arc-clslot', { hidden: true });

    const shell = h('div.arc', home, play, watchSec, classicSlot);
    root.appendChild(h('div.app.app--col.arc-app', shell));
    /* the online session's read-only snapshot, for automated play-tests (like .arc-mount's arcadePeek) */
    shell.arcadeNet = () => {
      const N = S.net, room = N?.room;
      return N ? {
        phase: N.phase, peerScore: N.peerScore, error: N.err,
        room: room ? { code: room.code, role: room.role, game: room.game, phase: room.phase, round: room.round, peer: room.peer ? { ...room.peer } : null, stats: room.stats(), wantAgain: room.wantAgain, peerAgain: room.peerAgain } : null,
      } : null;
    };

    /* spectating's read-only snapshot, for automated play-tests: the sharing side and the watching side */
    shell.arcadeSpec = () => ({
      share: shareKit.active() ? { code: shareKit.code(), stats: shareKit.stats() } : null,
      watch: S.watch ? { phase: S.watch.W.phase, error: S.watch.W.error, game: S.watch.W.game, count: S.watch.W.watchers.count, names: S.watch.W.watchers.names, stats: S.watch.W.stats() } : null,
    });

    /* the game should get the keyboard whenever the play area is touched */
    stage.addEventListener('pointerdown', () => {
      if (!stage.contains(document.activeElement)) focusStage();
    }, true);
    const focusStage = () => { if (!S.dead && S.view === 'play') stage.focus({ preventScroll: true }); };

    /* ============================ navigation ============================ */
    function go(view) {
      if (view === S.view) return;
      if (S.view === 'classic' && view !== 'classic') leaveClassic();
      if (S.view === 'play' && view !== 'play') {
        stopRound();
        leaveOnline();
        S.game = null;
        shareKit.sync(null);
        if (document.fullscreenElement === play) document.exitFullscreen().catch(() => {});
      }
      if (S.view === 'watch' && view !== 'watch') stopWatch();
      if (S.view === 'clips') { S.clipsToken++; revokeClipUrls(); }   /* the players go with the tab */
      S.view = view;
      paintView();
      if (view === 'games') { paintFilters(); paintGrid(); }
      if (view === 'clips') paintClips();
    }

    function paintView() {
      const playing = S.view === 'play';
      const classic = S.view === 'classic';
      home.hidden = playing || classic || S.view === 'watch';
      play.hidden = !playing;
      watchSec.hidden = S.view !== 'watch';
      watchSec.style.display = S.view === 'watch' ? 'flex' : 'none';
      classicSlot.hidden = !classic;
      shell.classList.toggle('is-playing', playing || classic);
      filtersEl.hidden = S.view !== 'games';
      tabGames.classList.toggle('is-on', S.view === 'games');
      tabClips.classList.toggle('is-on', S.view === 'clips');
      tabGames.setAttribute('aria-selected', String(S.view === 'games'));
      tabClips.setAttribute('aria-selected', String(S.view === 'clips'));
      tabGames.tabIndex = S.view === 'clips' ? -1 : 0;
      tabClips.tabIndex = S.view === 'clips' ? 0 : -1;
      main.setAttribute('aria-labelledby', S.view === 'clips' ? tabClips.id : tabGames.id);
      const cg = classic ? classics?.current() : null;
      win.setSubtitle?.(cg ? cg.title : playing && S.game ? S.game.title : S.view === 'clips' ? 'Clips' : '');
      /* the game in this window, for Screen Time (js/core/screentime.js) */
      const now = cg ? { kind: 'arcade', id: `classic-${cg.id}`, title: cg.title, icon: cg.icon || null }
        : playing && S.game ? { kind: 'arcade', id: S.game.id, title: S.game.title, icon: S.game.icon || null } : null;
      if ((win.state.playing && win.state.playing.id) !== (now && now.id)) { win.state.playing = now; bus.emit('win:playing', win); }
      if (playing) shell.style.setProperty('--h', S.game?.hue ?? 300);
      else shell.style.removeProperty('--h');
      syncPad();
    }

    /* ============================ controllers ============================ */
    /* The bridge runs only while a game is on screen and the person has
       the toggle on; it follows the toggle live (store.sub below). */
    function syncPad() {
      const want = !S.dead && S.view === 'play' && padmap.isEnabled();
      if (want && !S.padOn) {
        try { padmap.start({ target: window }); S.padOn = true; } catch (err) { console.error('[arcade] padmap', err); }
      } else if (!want && S.padOn) {
        S.padOn = false;
        try { padmap.stop(); } catch (err) { /* already stopped */ }
      }
      paintPad();
    }

    function paintPad() {
      clear(padSlot);
      if (S.dead || S.view !== 'play') return;
      let n = 0;
      try { n = padmap.connectedPads().length; } catch (err) { n = 0; }
      if (!n) return;
      if (S.padOn) {
        const map = padmap.getConfig().mapping;
        const lab = id => padmap.codeLabel(map[id]) || 'nothing';
        const tip = `Your controller drives this game: D-pad and left stick → arrow keys, A → ${lab('a')}, B → ${lab('b')}, Start → ${lab('start')}. Change it in Controller Center.`;
        padSlot.append(h('span.arc-pad', { title: tip, role: 'status', 'aria-label': `Controller connected. ${tip}` },
          icon('gamepad'), h('span', { text: 'Controller connected' })));
      } else {
        const tip = 'A controller is connected, but "Play keyboard games with a controller" is off, so it does nothing here. Click to turn it on.';
        padSlot.append(h('button.arc-pad.arc-pad--off', {
          type: 'button', title: tip, 'aria-label': tip,
          onclick: () => { padmap.setEnabled(true); focusStage(); },
        }, icon('gamepad'), h('span', { text: 'Controller found · use it' })));
      }
    }
    const onPads = () => { if (!S.dead) paintPad(); };
    window.addEventListener('gamepadconnected', onPads);
    window.addEventListener('gamepaddisconnected', onPads);
    offs.push(() => {
      window.removeEventListener('gamepadconnected', onPads);
      window.removeEventListener('gamepaddisconnected', onPads);
    });
    offs.push(store.sub(padmap.KEY, () => { if (!S.dead) syncPad(); }));

    function paintTabs() {
      clipCountEl.textContent = S.clipCount ? String(S.clipCount) : '';
      clipCountEl.hidden = !S.clipCount;
    }

    function refreshClipCount() {
      DB.kv('clips').keys().then(k => {
        if (S.dead) return;
        S.clipCount = k.length;
        paintTabs();
      }).catch(() => {});
    }

    /* ============================ home ============================ */
    function paintFilters() {
      clear(filtersEl);
      for (const f of FILTERS) {
        const n = f.count ? f.count() : ARCADE.filter(f.test).length;
        filtersEl.append(h('button.arc-chip', {
          type: 'button', class: f.id === S.filter ? 'is-on' : '',
          'aria-pressed': String(f.id === S.filter), title: f.title || null,
          onclick: () => {
            S.filter = f.id;
            writeState({ filter: f.id });
            paintFilters();
            paintGrid();
          },
        }, h('span', { text: f.label }), h('small', { text: String(n) })));
      }
    }

    /* the shelf, once its module has loaded; a placeholder of the same place until then */
    function appendClassicShelf() {
      const slot = h('div.arc-clsslot', { dataset: { state: 'loading' } });
      main.append(slot);
      classicsReady().then(ui => {
        if (S.dead || !slot.isConnected) return;
        slot.dataset.state = 'ready';
        slot.append(ui.shelf());
      }).catch(err => {
        console.error('[arcade] free classics', err);
        slot.dataset.state = 'error';
        slot.append(h('div.arc-note', icon('alert'), h('span', { text: 'Free Classics could not load. Check your connection and open the Arcade again.' })));
      });
    }

    function leaveClassic() {
      if (document.fullscreenElement && classicSlot.contains(document.fullscreenElement)) document.exitFullscreen().catch(() => {});
      classics?.stop();
      classics?.view.remove();
    }

    function openClassic(id) {
      return classicsReady().then(ui => {
        if (S.dead || !ui) return;
        /* the same game again (the Library, a Desktop icon): carry on, do not restart it */
        if (S.view === 'classic' && ui.current()?.id === id) { ui.focus(); return; }
        if (S.view === 'play' || S.view === 'clips' || S.view === 'watch') go('games');
        if (document.fullscreenElement === play) document.exitFullscreen().catch(() => {});
        if (!ui.open(id)) return;
        /* in the page only while a game is open: it shares the HUD's classes with the Arcade's own player */
        classicSlot.append(ui.view);
        S.view = 'classic';
        paintView();
      }).catch(err => notify({ icon: 'alert', title: 'That game could not open', message: err?.message || String(err) }));
    }

    function paintGrid() {
      clear(main);
      const f = filterOf(S.filter);
      if (f.id === 'freeclassics') { appendClassicShelf(); return; }
      /* the puzzle of the day is its own card on top, not a cabinet in the grid */
      const withDaily = (f.id === 'all' || f.id === 'puzzle') && !!arcadeById('daily');
      if (withDaily) { const c = dailyCard(); if (c) main.append(c); }
      const list = ARCADE.filter(f.test).filter(g => !(withDaily && g.id === 'daily'));
      if (!list.length && withDaily) return;
      if (!list.length) {
        main.append(h('div.arc-empty', icon('gamepad'), h('b', { text: 'Nothing in this filter' }),
          h('small', { text: 'Try All.' })));
        return;
      }
      main.append(h('div.arc-grid', list.map(cabinet)));
      if (f.id === 'all') appendClassicShelf();
    }

    /* ---------- Today's puzzle ---------- */
    function dailyCard() {
      let st;
      try { st = daily.status(); } catch (err) { console.error('[arcade] daily', err); return null; }
      const when = parseDay(st.day);
      const short = when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      const long = when.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      const art = h('canvas.arc-daily__art', { 'aria-hidden': 'true' });
      drawDaily(art, st);
      const state = st.solved
        ? h('span.arc-daily__state.is-solved', icon('check'), h('span', { text: `Solved · ${dur(st.ms)}` }))
        : st.started
          ? h('span.arc-daily__state', icon('clock'), h('span', { text: `In progress · ${dur(st.ms)}` }))
          : h('span.arc-daily__state.is-new', icon('play', { fill: true }), h('span', { text: 'Play today’s puzzle' }));
      const days = n => `${n} day${n === 1 ? '' : 's'}`;
      const streak = h('span.arc-daily__streak', { title: `Days in a row you have solved it on this device · best ${days(st.best)}` },
        icon('flame'), h('b', { text: String(st.streak) }), h('span', { text: 'day streak' }),
        st.best > st.streak ? h('small', { text: `best ${st.best}` }) : null);
      const label = [
        `Today’s puzzle: Daily Stars for ${long}, ${st.n} by ${st.n}`,
        st.solved ? `Solved in ${dur(st.ms)}` : st.started ? `In progress, ${dur(st.ms)} so far` : 'Not started',
        `Streak ${days(st.streak)}, best ${days(st.best)}`,
      ].join('. ');
      return h('button.arc-daily', {
        type: 'button', 'aria-label': label, style: { '--h': arcadeById('daily')?.hue ?? 45 },
        dataset: { solved: String(!!st.solved), day: st.day }, onclick: () => launch('daily'),
      },
        h('span.arc-daily__screen', art, st.solved ? h('span.arc-daily__tick', { title: 'Solved today' }, icon('check')) : null),
        h('span.arc-daily__body',
          h('span.arc-daily__kicker', icon('calendar'), h('span', { text: `Today’s puzzle · ${short}` })),
          h('span.arc-daily__title', h('span', { text: 'Daily Stars' }), h('small', { text: `${st.n}×${st.n}` })),
          h('span.arc-daily__blurb', { text: 'A new puzzle every day — the same one for everyone who plays today. Your time and streak stay on this device.' })),
        h('span.arc-daily__side', state, streak));
    }
    function repaintDaily() {
      if (S.dead || S.view !== 'games') return;
      const old = main.querySelector('.arc-daily');
      if (!old) return;
      const fresh = dailyCard();
      if (fresh) old.replaceWith(fresh);
    }
    let dailyDay = dayKey();
    offs.push(store.sub(daily.KEY, () => repaintDaily()));
    const dayTimer = setInterval(() => {
      const d = dayKey();
      if (d === dailyDay) return;
      dailyDay = d;
      repaintDaily();
    }, 30_000);
    offs.push(() => clearInterval(dayTimer));

    function inputIcon(k) {
      const d = INPUTS[k];
      if (!d) return null;
      const glyph = d.icon ? icon(d.icon) : h('span.icon', { html: TOUCH_SVG });
      return h('span.arc-in', { title: d.label }, glyph);
    }

    function cabinet(g) {
      const best = getBest(g.id);
      const two = g.players.includes(2);
      const art = h('canvas.arc-cab__art', { 'aria-hidden': 'true' });
      drawArt(art, g);
      const inputs = g.input.map(k => INPUTS[k]?.label).filter(Boolean).join(', ');
      const label = [
        `${g.title}. ${g.blurb.replace(/[.!?]+$/, '')}`,
        two ? '1 or 2 players' : '1 player',
        g.online ? 'can be played online with a friend' : null,
        inputs,
        `about ${g.minutes} minute${g.minutes === 1 ? '' : 's'}`,
        best !== null ? `your best ${fmtN(best)}${g.better === 'low' ? ', lower is better' : ''}` : 'no score yet',
      ].filter(Boolean).join('. ');
      const su = shortUnit(g.id);
      const more = h('button.arc-cab__more', {
        type: 'button', 'aria-label': `More for ${g.title}`, title: 'More', 'aria-haspopup': 'menu',
        onclick: e => {
          e.stopPropagation();
          const r = more.getBoundingClientRect();
          cabMenu(g, r.left, r.bottom + 4);
        },
      }, icon('more-horizontal'));
      const main = h('button.arc-cab__main', {
        type: 'button', 'aria-label': label,
        onclick: () => launch(g.id),
        /* the keyboard way to the menu, where the browser does not turn it into contextmenu */
        onkeydown: e => {
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault();
            e.stopPropagation();
            const r = main.getBoundingClientRect();
            cabMenu(g, r.left + 16, r.top + 40);
          }
        },
      },
        h('div.arc-cab__screen',
          art,
          h('span.arc-cab__badge', icon(g.icon)),
          best !== null
            ? h('span.arc-cab__best', { title: `Your best on this device${unitOf(g.id) ? `, in ${unitOf(g.id)}` : ''}${g.better === 'low' ? ' (lower is better)' : ''}` },
              icon('star', { fill: true }), h('b', { text: fmtN(best) + (su ? ` ${su}` : '') }), g.better === 'low' ? h('small', { text: 'low wins' }) : null)
            : null,
          h('span.arc-cab__go', icon('play', { fill: true }))),
        h('div.arc-cab__body',
          h('div.arc-cab__title', { text: g.title }),
          h('div.arc-cab__blurb', { text: g.blurb }),
          h('div.arc-cab__meta',
            h('span.arc-meta', { title: two ? '1 or 2 players on this device' : '1 player' },
              icon(two ? 'users' : 'user'), h('span', { text: two ? '1–2P' : '1P' })),
            g.online ? h('span.arc-meta.arc-meta--online', { title: 'Play a friend on another device with a room code' },
              icon('globe'), h('span', { text: 'Online' })) : null,
            h('span.arc-meta.arc-meta--in', g.input.map(inputIcon)),
            h('span.arc-meta.arc-meta--min', { title: 'A typical round' }, icon('clock'), h('span', { text: `~${g.minutes} min` })))));
      return h('div.arc-cab', {
        style: { '--h': g.hue }, dataset: { game: g.id },
        oncontextmenu: e => {
          e.preventDefault();
          /* the Menu key / Shift+F10 fire this with no pointer position */
          if (!e.clientX && !e.clientY) { const r = main.getBoundingClientRect(); cabMenu(g, r.left + 16, r.top + 40); }
          else cabMenu(g, e.clientX, e.clientY);
        },
      }, main, more);
    }

    function cabMenu(g, x, y) {
      if (S.dead) return;
      const item = { kind: 'arcade', id: g.id, title: g.title };
      const two = g.players.includes(2);
      api.menu([
        { header: true, label: g.title },
        { label: 'Play', icon: 'play', onClick: () => launch(g.id, 1) },
        two ? { label: 'Play with 2 players', icon: 'users', hint: 'same device', onClick: () => launch(g.id, 2) } : null,
        g.online ? { label: 'Play a friend online', icon: 'globe', hint: 'room code', onClick: () => launch(g.id, 'online') } : null,
        '-',
        { label: 'Add to Desktop', icon: 'monitor', onClick: () => addToDesktop(item) },
        { label: 'Add to collection…', icon: 'bookmark', onClick: () => pickMenu(api, item, x, y) },
      ].filter(Boolean), x, y);
    }

    function randomQuick() {
      const pool = ARCADE.filter(g => g.minutes <= 2);
      if (!pool.length) return;
      launch(pool[Math.floor(Math.random() * pool.length)].id);
    }

    /* ============================ clips ============================ */
    function revokeClipUrls() {
      for (const u of S.clipUrls) URL.revokeObjectURL(u);
      S.clipUrls = [];
      S.clipTimers.forEach(clearTimeout);
      S.clipTimers = [];
    }

    async function paintClips() {
      const token = ++S.clipsToken;
      revokeClipUrls();
      clear(main);
      const notes = [];
      if (!REC.ok) notes.push(h('div.arc-note', icon('info'), h('span', { text: `Recording is not available here. ${REC.why}` })));
      if (!DB.persistent) notes.push(h('div.arc-note', icon('alert'), h('span', { text: 'This browser is not letting StaticOS store files, so clips only last until you close it.' })));
      const head = h('div.arc-clips__head',
        h('div.arc-clips__title', { text: 'Your clips' }),
        h('div.arc-clips__sub', { text: 'Press Record while playing a canvas game to keep up to 30 seconds. Clips are saved in this browser only.' }),
        notes);
      main.append(head);
      let list = [];
      try { list = await DB.kv('clips').all(); } catch (err) { list = []; }
      if (token !== S.clipsToken || S.dead || S.view !== 'clips') return;
      list = list.filter(c => c && c.blob instanceof Blob).sort((a, b) => (b.at || 0) - (a.at || 0));
      S.clipCount = list.length;
      paintTabs();
      if (!list.length) {
        main.append(h('div.arc-empty', icon('film'), h('b', { text: 'No clips yet' }),
          h('small', { text: REC.ok ? 'Start a game and press Record in the bar above it.' : 'This browser cannot record, so there is nothing to show.' })));
        return;
      }
      main.append(h('div.arc-clips', list.map(clipCard)));
    }

    function clipCard(c) {
      const url = URL.createObjectURL(c.blob);
      S.clipUrls.push(url);
      const meta = arcadeById(c.game);
      const video = h('video.arc-clip__video', {
        src: url, controls: true, preload: 'metadata', playsinline: true, 'aria-label': `${c.title} clip`,
      });
      /* Clips saved before the header fix (webmWithDuration) have no
         length: seek to the end once so the player learns it, then come
         back — with the controls hidden meanwhile, so Play cannot start
         from the far end. The CSS shows a small "Preparing…" note. */
      video.addEventListener('loadedmetadata', () => {
        if (video.duration !== Infinity) return;
        const frame = video.parentElement;
        const done = () => {
          clearTimeout(t);
          video.removeEventListener('durationchange', onDur);
          if (Number.isFinite(video.duration) && video.currentTime !== 0) video.currentTime = 0;
          video.controls = true;
          frame?.classList.remove('is-prep');
        };
        const onDur = () => { if (Number.isFinite(video.duration)) done(); };
        const t = setTimeout(done, 4000);
        S.clipTimers.push(t);
        video.controls = false;
        frame?.classList.add('is-prep');
        video.addEventListener('durationchange', onDur);
        video.currentTime = 1e101;
      }, { once: true });
      const ext = /mp4/.test(c.mime || '') ? 'mp4' : 'webm';
      const d = new Date(c.at || Date.now());
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const when = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return h('article.arc-clip', { style: { '--h': meta?.hue ?? 300 } },
        h('div.arc-clip__frame', video),
        h('div.arc-clip__info',
          h('div.arc-clip__title', h('span.arc-clip__dot'), h('span', { text: c.title || c.game })),
          h('div.arc-clip__sub', { text: `${when} · ${dur(c.durationMs || 0)} · ${bytes(c.blob.size)}` })),
        h('div.arc-clip__acts',
          h('a.btn.btn--sm', { href: url, download: `static-arcade-${c.game}-${stamp}.${ext}`, 'aria-label': `Download the ${c.title} clip` },
            icon('download'), h('span', { text: 'Download' })),
          h('button.btn.btn--sm.btn--ghost', { type: 'button', 'aria-label': `Delete the ${c.title} clip`, onclick: () => deleteClip(c) },
            icon('trash'), h('span', { text: 'Delete' }))));
    }

    async function deleteClip(c) {
      const ok = await api.confirm({ title: 'Delete this clip?', message: `${c.title} · ${dur(c.durationMs || 0)}. It is only stored here, so this cannot be undone.`, ok: 'Delete', danger: true });
      if (!ok || S.dead) return;
      try {
        await DB.kv('clips').del(c.id);
      } catch (err) {
        notify({ icon: 'alert', title: 'Could not delete the clip', message: err.message });
        return;
      }
      bus.emit('clips:change', { id: c.id, kind: 'delete' });   /* our own listener repaints */
    }

    /* anyone (us, the Library) saving or deleting a clip */
    let clipsLater = 0;
    offs.push(bus.on('clips:change', () => {
      clearTimeout(clipsLater);
      clipsLater = setTimeout(() => {
        if (S.dead) return;
        if (S.view === 'clips') paintClips(); else refreshClipCount();
      }, 60);
    }));
    offs.push(() => clearTimeout(clipsLater));

    /* ============================ play ============================ */
    /* players: 1 | 2 | 'online'; room: an already-joined room to play in */
    async function launch(id, players, room = null) {
      const g = arcadeById(id);
      if (!g || S.dead) return;
      if (S.view === 'play') stopRound();
      if (S.view === 'clips') { S.clipsToken++; revokeClipUrls(); clear(main); }
      if (S.view === 'classic') leaveClassic();
      if (S.view === 'watch') stopWatch();
      const online = !!g.online && (players === 'online' || !!room);
      if (S.net && S.net.room !== room) leaveOnline();
      if (S.homeRoom && S.homeRoom !== room) toggleJoinBar(false);   /* a join still knocking from the home screen stops */
      S.game = g;
      S.online = online;
      S.players = online ? 1 : g.players.includes(Number(players)) ? Number(players) : g.players[0];
      S.view = 'play';
      paintView();
      if (online) {
        if (!S.net) netStart(room);
        else if (room && S.net.room === room && room.peer && S.net.phase === 'joining') S.net.phase = 'ready';
        paintHud();
        setStatus('online');
        return;
      }
      paintHud();
      await startRound();
    }

    function paintHud() {
      const g = S.game;
      if (!g) return;
      hudName.textContent = g.title;
      stage.setAttribute('aria-label', `${g.title} — play area`);
      clear(segEl);
      const modes = [1, ...(g.players.includes(2) ? [2] : []), ...(g.online ? ['online'] : [])];
      segEl.hidden = modes.length < 2;
      if (modes.length > 1) {
        for (const n of modes) {
          const on = n === 'online' ? S.online : !S.online && S.players === n;
          segEl.append(h('button', {
            type: 'button', class: on ? 'is-on' : '', 'aria-pressed': String(on),
            title: n === 'online' ? 'Play a friend on another device' : n === 1 ? 'One player' : 'Two players on this device',
            onclick: () => {
              if (on) { focusStage(); return; }
              if (n === 'online') { launch(g.id, 'online'); return; }
              if (S.online) { stopRound(); leaveOnline(); S.online = false; }
              S.players = n;
              paintHud();
              startRound();
            },
          }, n === 'online' ? icon('globe') : null, h('span', { text: n === 'online' ? 'Online' : `${n}P` })));
        }
      }
      paintRoomChip();
      shareKit.sync(g.id);
      paintBest();
      paintControls();
      paintRec();
      paintSound();
      paintFs();
    }

    function paintBest() {
      const g = S.game;
      if (!g) return;
      if (S.online) {
        const peer = S.net?.room?.peer;
        scoreLab.textContent = 'You';
        bestLab.textContent = peer ? peer.name : 'Friend';
        bestLab.title = peer ? `${peer.name} — names aren’t verified` : '';
        const ps = S.net?.peerScore;
        bestEl.textContent = ps === null || ps === undefined ? '—' : fmtN(ps);
        bestEl.parentElement.title = peer ? `${peer.name}’s score this round` : 'Your friend’s score, once they join';
        return;
      }
      bestLab.title = '';
      const best = getBest(g.id);
      bestEl.textContent = S.players === 2 ? '—' : fmtN(best ?? '—');
      const su = shortUnit(g.id);
      scoreLab.textContent = su ? `Score · ${su}` : 'Score';
      bestLab.textContent = g.better === 'low' ? 'Best ↓' : 'Best';
      bestEl.parentElement.title = S.players === 2
        ? 'Two-player rounds do not change your best'
        : g.better === 'low' ? 'Your best on this device — lower is better' : 'Your best on this device';
    }

    function setScore(n) {
      S.lastScore = Number.isFinite(n) ? n : null;
      scoreEl.textContent = fmtN(n);
    }

    function paintControls() {
      const canPause = !!S.inst?.pause && (S.status === 'playing' || S.status === 'paused');
      pauseBtn.hidden = S.online || (!S.inst?.pause && S.status !== 'loading');
      restartBtn.hidden = S.online;
      pauseBtn.disabled = !canPause;
      clear(pauseBtn);
      const paused = S.status === 'paused';
      pauseBtn.append(icon(paused ? 'play' : 'pause'));
      pauseBtn.setAttribute('aria-label', paused ? 'Resume (P or Esc)' : 'Pause (P or Esc)');
      pauseBtn.title = paused ? 'Resume (P or Esc)' : 'Pause (P or Esc)';
      restartBtn.disabled = S.status === 'loading';
    }

    async function startRound() {
      if (!S.game || S.dead) return;
      /* an online round starts only from the room (both sides at once) */
      if (S.online && S.net?.phase !== 'countdown') return;
      stopRound();
      const g = S.game;
      const token = ++S.token;
      const net = S.online ? S.net : null;
      setStatus('loading');
      let mod;
      try {
        mod = await g.load();
      } catch (err) {
        if (token !== S.token || S.dead) return;
        S.error = err;
        setStatus('error');
        return;
      }
      if (token !== S.token || S.dead) return;
      const impl = mod?.default;
      if (!impl || typeof impl.mount !== 'function') {
        S.error = new Error('The game file loaded but does not provide a mount() function.');
        setStatus('error');
        return;
      }
      const el = h('div.arc-mount');
      gameHost.replaceChildren(el);
      let ended = false;
      const gctx = {
        players: S.players,
        best: S.players === 1 ? getBest(g.id) : null,
        reduced: reducedMotion(),
        accent: accent(),
        get sound() { return soundOn(); },
        get volume() { return Math.max(0, Math.min(1, (store.get('prefs.volume', 62) || 0) / 100)); },
        onScore: n => { if (token === S.token && !ended && !S.dead) setScore(n); },
        onEnd: r => {
          if (token !== S.token || ended || S.dead) return;
          ended = true;
          finish(r || {});
        },
      };
      if (net && net.room) {
        const room = net.room;
        net.peerScore = null;
        gctx.online = Object.freeze({
          role: room.role, seed: room.seed, round: room.round,
          peer: Object.freeze({ ...room.peer }),
          /* still open after the round ends: the twin may need a lost move again */
          send: d => (token === S.token ? room.send(d) : false),
          on: fn => { net.listeners.add(fn); return () => net.listeners.delete(fn); },
          peerScore: n => {
            if (token !== S.token || S.dead || !Number.isFinite(n)) return;
            net.peerScore = n;
            paintBest();
          },
          rtt: () => room.rtt(),
        });
        net.phase = 'playing';
      }
      setScore(0);
      try {
        S.inst = impl.mount(el, gctx) || null;
        /* the game's read-only snapshot, for automated play-tests */
        if (typeof S.inst?.peek === 'function') el.arcadePeek = S.inst.peek;
        if (typeof S.inst?.hook === 'function') el.arcadeHook = S.inst.hook;   /* test hook: inert unless a test calls it */
      } catch (err) {
        console.error('[arcade] mount failed', err);
        S.inst = null;
        gameHost.replaceChildren();
        S.error = err;
        setStatus('error');
        return;
      }
      if (ended) return;                 /* a game may end inside mount */
      setStatus('playing');
      paintBest();
      plays.record({ kind: 'arcade', id: g.id, title: g.title });
      focusStage();
    }

    /* stop the running game (and its recording), leave the stage empty */
    /* keepFrame: closing the window — stop the game but leave its last frame
       up, so the window fades out with the picture instead of going black */
    function stopRound(keepFrame = false) {
      S.token++;
      if (S.rec) stopRec('round');
      clearTimeout(S.autoStop);
      /* games remove their own canvas when stopped, so copy the last frame first */
      const still = keepFrame ? stillOf(gameHost.querySelector('canvas')) : null;
      if (S.inst) {
        try { S.inst.stop?.(); } catch (err) { console.error('[arcade] stop failed', err); }
      }
      S.inst = null;
      if (S.net) S.net.listeners.clear();
      if (!keepFrame) gameHost.replaceChildren();
      else if (still && still.home.isConnected && !still.home.querySelector('canvas')) still.home.appendChild(still.el);
      S.result = null;
      S.error = null;
      S.status = 'idle';
    }

    function finish(r) {
      const g = S.game;
      const score = Number.isFinite(r.score) ? r.score : null;
      const prev = getBest(g.id);
      if (S.online && S.net) {
        const v = r.versus && typeof r.versus === 'object' ? r.versus : {};
        const won = typeof r.won === 'boolean' ? r.won : null;
        bus.emit('arcade:score', { game: g.id, score, best: prev, newBest: false, hadBest: prev !== null, players: 2, online: true,
          ...(won !== null && !r.void ? { won } : {}) });
        S.result = {
          score, online: true, won, void: !!r.void,
          me: Number.isFinite(v.me) ? v.me : score, them: Number.isFinite(v.them) ? v.them : S.net.peerScore,
          detail: typeof r.detail === 'string' ? r.detail : '',
        };
        if (score !== null) setScore(score);
        S.net.phase = 'result';
        S.net.peerScore = S.result.them;
        paintBest();
        setStatus('over');
        if (S.rec) S.autoStop = setTimeout(() => stopRec('end'), AUTO_STOP_MS);
        return;
      }
      const counts = score !== null && S.players === 1;
      let newBest = false;
      if (counts && (prev === null || (g.better === 'low' ? score < prev : score > prev))) {
        newBest = true;
        setBest(g.id, score);
      }
      const best = getBest(g.id);
      bus.emit('arcade:score', { game: g.id, score, best, newBest, hadBest: prev !== null, players: S.players,
        ...(typeof r.won === 'boolean' ? { won: r.won } : {}) });
      S.result = { score, best, newBest, hadBest: prev !== null, won: !!r.won, detail: typeof r.detail === 'string' ? r.detail : '', counts };
      if (score !== null) setScore(score);
      paintBest();
      setStatus('over');
      if (S.rec) S.autoStop = setTimeout(() => stopRec('end'), AUTO_STOP_MS);
    }

    function pause() {
      if (S.status !== 'playing' || !S.inst?.pause) return;
      try { S.inst.pause(); } catch (err) { console.error(err); return; }
      pauseRec();
      setStatus('paused');
    }
    function resume() {
      if (S.status !== 'paused') return;
      try { S.inst?.resume?.(); } catch (err) { console.error(err); }
      resumeRec();
      setStatus('playing');
      focusStage();
    }

    /* ---------- overlays ---------- */
    function setStatus(st) {
      S.status = st;
      clear(overlay);
      overlay.className = 'arc-stage__ov';
      stage.classList.toggle('is-covered', st !== 'playing');
      const g = S.game;
      if (st === 'loading') {
        overlay.append(h('div.arc-load', h('i.arc-spin'), h('span', { text: `Loading ${g.title}…` })));
      } else if (st === 'error') {
        const again = h('button.btn.btn--primary', { type: 'button', onclick: () => startRound() }, icon('refresh'), h('span', { text: 'Try again' }));
        overlay.append(h('div.arc-card.arc-card--err', { role: 'alert' },
          h('span.arc-card__ic', icon('alert')),
          h('div.arc-card__title', { text: `Couldn’t load ${g.title}` }),
          h('div.arc-card__text', { text: 'This game’s file is missing or failed to start. The other games still work.' }),
          S.error?.message ? h('code.arc-card__code', { text: String(S.error.message).slice(0, 160) }) : null,
          h('div.arc-card__row', again,
            h('button.btn', { type: 'button', onclick: () => go('games') }, icon('chevron-left'), h('span', { text: 'Arcade' })))));
        setTimeout(() => { if (overlay.contains(again)) again.focus({ preventScroll: true }); }, 30);
      } else if (st === 'paused') {
        const res = h('button.btn.btn--primary', { type: 'button', onclick: resume }, icon('play', { fill: true }), h('span', { text: 'Resume' }));
        overlay.append(h('div.arc-card', { role: 'dialog', 'aria-label': 'Paused' },
          h('div.arc-card__kicker', { text: g.title }),
          h('div.arc-card__title.arc-card__title--big', { text: 'Paused' }),
          h('div.arc-card__row', res,
            h('button.btn', { type: 'button', onclick: () => startRound() }, icon('rotate-ccw'), h('span', { text: 'Restart' })),
            h('button.btn.btn--ghost', { type: 'button', onclick: () => go('games') }, icon('chevron-left'), h('span', { text: 'Arcade' }))),
          h('div.arc-card__hint', { text: 'Press P or Esc to resume' })));
        setTimeout(() => { if (overlay.contains(res)) res.focus({ preventScroll: true }); }, 30);
      } else if (st === 'over' || st === 'online') {
        const card = st === 'online' ? netCard() : S.online ? netResultCard() : resultCard();
        /* an online card repainted on the same step ("waiting…", "wants a rematch")
           doesn't pop in again */
        const step = st === 'online' ? S.net?.phase : S.online ? 'result' : null;
        if (step && S.net?.shown === step) card.classList.add('arc-card--still');   /* the countdown's number still pops on its own */
        overlay.append(card);
      }
      if (S.net) S.net.shown = st === 'online' ? S.net.phase : st === 'over' && S.online ? 'result' : null;
      paintControls();
      paintRec();
    }

    function resultCard() {
      const g = S.game, r = S.result;
      const title = S.players === 2 ? 'Match over' : r.won ? 'You win!' : 'Game over';
      let badge = null;
      if (r.newBest && r.hadBest) badge = h('div.arc-res__new', icon('sparkles'), h('span', { text: 'New best!' }));
      else if (r.newBest) badge = h('div.arc-res__first', icon('star', { fill: true }), h('span', { text: 'First score saved on this device' }));
      else if (S.players === 2) badge = h('div.arc-res__note', { text: 'Two-player rounds don’t change your best' });
      else if (r.best !== null) badge = h('div.arc-res__best', { text: `Your best ${fmtN(r.best)}${shortUnit(g.id) ? ` ${shortUnit(g.id)}` : ''}${g.better === 'low' ? ' · lower wins' : ''}` });
      const again = h('button.btn.btn--primary.arc-res__again', { type: 'button', onclick: () => startRound() },
        icon('rotate-ccw'), h('span', { text: 'Play again' }));
      setTimeout(() => { if (overlay.contains(again)) again.focus({ preventScroll: true }); }, 40);
      return h('div.arc-card.arc-res', { role: 'dialog', 'aria-label': `${title}. Score ${r.score === null ? 'none' : fmtN(r.score)}` },
        h('div.arc-card__kicker', { text: g.title }),
        h('div.arc-card__title', { text: title }),
        h('div.arc-res__score', { text: r.score === null ? '—' : fmtN(r.score) }),
        h('div.arc-res__lab', { text: r.score === null ? 'No score this round' : unitOf(g.id) ? `Score · ${unitOf(g.id)}` : 'Score' }),
        badge,
        r.detail ? h('div.arc-res__detail', { text: r.detail }) : null,
        h('div.arc-card__row', again,
          h('button.btn', { type: 'button', onclick: () => go('games') }, icon('chevron-left'), h('span', { text: 'Arcade' }))),
        h('div.arc-card__hint', { text: 'Enter to play again' }));
    }

    /* ============================ online ============================ */
    /* S.net = { room, phase, err, peerScore, listeners, live, cd, gone }
       phase: lobby | hosting | joining | ready | countdown | playing | result | left | error */
    function netStart(room = null) {
      const N = S.net = { room: null, phase: 'lobby', err: null, peerScore: null, listeners: new Set(), live: 'idle', cd: 0, cdN: 0, gone: null, off: null, liveEl: null };
      /* connect as soon as Online is chosen, so the lobby can say whether this
         network allows it before anyone makes a room (a room reports its own) */
      N.offLive = live.onStatus(st => {
        if (S.net !== N || N.room) return;
        N.live = st;
        if (N.liveEl?.isConnected) paintLive(N.liveEl, st);
      });
      try { live.start(); } catch (err) { /* shown as not connected */ }
      if (room) attachRoom(room);
    }

    function attachRoom(room) {
      const N = S.net;
      N.room = room;
      N.err = null;
      N.gone = null;
      N.live = room.live();
      N.off = room.on((type, data) => onRoom(room, type, data));
      N.phase = room.peer ? 'ready' : room.role === 'host' ? 'hosting' : 'joining';
    }

    function dropRoom(N) {
      clearTimeout(N.cd);
      try { N.off?.(); } catch (err) { /* gone */ }
      try { N.room?.leave(); } catch (err) { /* gone */ }
      N.listeners.clear();
    }

    function leaveOnline() {
      const N = S.net;
      S.net = null;
      S.online = false;
      if (N) {
        dropRoom(N);
        try { N.offLive?.(); } catch (err) { /* gone */ }
      }
      paintRoomChip();
    }

    /* back to the "make or join" card, dropping whatever room there was */
    function netReset() {
      if (!S.net) { netStart(); return; }
      const N = S.net;
      if (N.phase === 'playing' || N.phase === 'countdown') stopRound();
      dropRoom(N);
      Object.assign(N, { room: null, phase: 'lobby', err: null, peerScore: null, gone: null, off: null, live: live.status() });
    }

    function makeRoom() {
      if (!S.game?.online) return;
      netReset();
      attachRoom(openRoom({ role: 'host', game: S.game.id }));
      paintNet();
      /* a game night's host (core/friends.js) passes this code to the friend invited */
      bus.emit('arcade:room', { game: S.game.id, code: S.net.room.code });
    }

    function dropHomeRoom() {
      if (!S.homeRoom) return;
      try { S.homeOff?.(); } catch (err) { /* gone */ }
      try { S.homeRoom.leave(); } catch (err) { /* gone */ }
      S.homeRoom = null;
      S.homeOff = null;
    }

    /* a code typed on the home screen ('home') or in a game's lobby ('lobby') */
    function joinOnline(raw, from) {
      const code = normalizeCode(raw);
      if (!isCode(code)) {
        if (from === 'home') joinNote('invalid', code);
        else { netReset(); S.net.phase = 'error'; S.net.err = 'invalid'; paintNet(); }
        return;
      }
      const room = openRoom({ role: 'guest', code });
      if (from === 'home') {
        dropHomeRoom();
        S.homeRoom = room;
        joinNote('joining', code);
        S.homeOff = room.on(type => {
          if (S.dead || S.homeRoom !== room) return;
          if (type === 'peer') {
            try { S.homeOff?.(); } catch (err) { /* gone */ }
            S.homeRoom = null; S.homeOff = null;
            toggleJoinBar(false);
            launch(room.game, 'online', room);
          } else if (type === 'phase' && room.phase === 'closed') {
            try { S.homeOff?.(); } catch (err) { /* gone */ }
            S.homeRoom = null; S.homeOff = null;
            joinNote(room.error || 'nobody', code);
          } else if (type === 'live') joinNote('joining', code);
        });
        return;
      }
      netReset();
      attachRoom(room);
      paintNet();
    }

    function onRoom(room, type, data) {
      if (S.dead) return;
      const N = S.net;
      if (!N || N.room !== room) return;
      if (type === 'live') {
        N.live = data;
        if (N.liveEl?.isConnected) paintLive(N.liveEl, data);
        return;
      }
      if (type === 'game') {
        N.listeners.forEach(fn => { try { fn(data); } catch (err) { console.error('[arcade] online game', err); } });
        return;
      }
      if (type === 'peer') {
        /* a guest learns the game from the room: switch to it if needed */
        if (room.role === 'guest' && room.game && S.game?.id !== room.game) { launch(room.game, 'online', room); return; }
        N.phase = 'ready';
        if (room.role === 'host') notify({ icon: 'users', title: `${data.name} joined your room`, message: `${S.game.title} · room ${room.code}. Start when you’re both ready.` });
        paintNet();
        return;
      }
      if (type === 'start') { countdown(); return; }
      if (type === 'again') { if (N.phase === 'result') paintNet(); return; }
      if (type === 'left') {
        const who = data?.peer?.name || 'Your friend';
        if (N.phase === 'result') { N.gone = { who, reason: data?.reason }; paintNet(); return; }
        const wasPlaying = N.phase === 'playing' || N.phase === 'countdown';
        clearTimeout(N.cd);
        if (wasPlaying) stopRound(true);
        N.phase = 'left';
        N.gone = { who, reason: data?.reason, wasPlaying };
        paintNet();
        return;
      }
      if (type === 'phase') {
        if (data === 'closed' && room.error) { N.phase = 'error'; N.err = room.error; paintNet(); }
        else if ((data === 'waiting' || data === 'joining') && (N.phase === 'hosting' || N.phase === 'joining')) paintNet();
      }
    }

    function countdown() {
      const N = S.net;
      if (!N || S.dead) return;
      stopRound();
      clearTimeout(N.cd);
      N.phase = 'countdown';
      N.gone = null;
      N.cdN = COUNTDOWN;
      const tick = () => {
        if (S.dead || S.net !== N || N.phase !== 'countdown') return;
        if (N.cdN <= 0) { startRound(); return; }
        paintNet();
        N.cdN -= 1;
        N.cd = setTimeout(tick, 1000);
      };
      tick();
    }

    function rematch() {
      const N = S.net;
      if (!N?.room || N.phase !== 'result' || N.gone) return;
      N.room.rematch();
      paintNet();
    }

    /* repaint the online card (only while no game is running) */
    function paintNet() {
      if (S.dead || !S.online || !S.net) return;
      paintRoomChip();
      paintBest();
      if (S.net.phase === 'result') { if (S.result) setStatus('over'); return; }
      if (S.net.phase === 'playing') return;
      setStatus('online');
    }

    function paintRoomChip() {
      const room = S.online ? S.net?.room : null;
      roomChip.hidden = !room;
      if (!room) { roomChip.textContent = ''; roomChip.title = ''; return; }
      roomChip.textContent = `Online · ${room.code}`;
      roomChip.title = room.peer ? `Room ${room.code} with ${room.peer.name}` : `Room ${room.code}`;
    }

    function paintLive(el, st) {
      el.dataset.st = st;
      el.lastChild.textContent = LIVE_TEXT[st] || LIVE_TEXT.idle;
    }
    const liveLine = N => {
      const el = h('div.arc-net__live', { role: 'status' }, h('i.arc-net__dot'), h('span'));
      paintLive(el, N.live);
      N.liveEl = el;
      return el;
    };

    async function copyInvite(room) {
      const link = inviteLink(S.game.id, room.code);
      const text = `Play ${S.game.title} with me in Static Arcade — room code ${room.code}${link ? ` · ${link}` : ''}`;
      try {
        await navigator.clipboard.writeText(text);
        notify({ icon: 'copy', title: 'Invite copied', message: `Room code ${room.code}. Send it to your friend.` });
      } catch (err) {
        notify({ icon: 'info', title: `Room code ${room.code}`, message: 'Copying was blocked here — read the code out or type it to your friend.' });
      }
    }

    function netCard() {
      const g = S.game, N = S.net;
      const room = N?.room;
      const peer = room?.peer?.name || 'your friend';
      const kicker = h('div.arc-card__kicker', { text: `${g.title} · Online` });
      const rules = g.onlineRules ? h('div.arc-card__text', { text: g.onlineRules }) : null;
      const toArcade = h('button.btn.btn--ghost', { type: 'button', onclick: () => go('games') }, icon('chevron-left'), h('span', { text: 'Arcade' }));
      const leave = label => h('button.btn', { type: 'button', onclick: () => { netReset(); paintNet(); } }, h('span', { text: label }));
      const focus = el => setTimeout(() => { if (overlay.contains(el)) el.focus({ preventScroll: true }); }, 40);
      const fine = () => h('div.arc-net__fine', { text: `Room ${room.code}. Names aren’t verified — anyone can pick any name.` });
      const card = (...kids) => h('div.arc-card.arc-net', { role: 'dialog', 'aria-label': `${g.title} online`, dataset: { phase: N?.phase || 'lobby' } }, kicker, ...kids);
      const phase = N?.phase || 'lobby';

      if (phase === 'lobby') {
        const make = h('button.btn.btn--primary', { type: 'button', onclick: makeRoom }, icon('plus'), h('span', { text: 'Make a room' }));
        const input = h('input.arc-net__input', {
          type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '80',
          placeholder: 'Their room code', 'aria-label': 'Room code from your friend',
        });
        focus(make);
        return card(
          h('div.arc-card__title', { text: 'Play a friend online' }),
          rules,
          h('div.arc-card__row', make),
          h('div.arc-net__or', h('span', { text: 'or join theirs' })),
          h('form.arc-net__join', { onsubmit: e => { e.preventDefault(); joinOnline(input.value, 'lobby'); } },
            input, h('button.btn', { type: 'submit' }, h('span', { text: 'Join' }))),
          h('div.arc-net__note', { text: 'Rooms run on StaticOS’s live connection, a free public server: anyone with the code can join, nothing is saved, and some school or work networks block it.' }),
          liveLine(N), h('div.arc-card__row', toArcade));
      }
      if (phase === 'hosting') {
        const copy = h('button.btn.btn--primary', { type: 'button', onclick: () => copyInvite(room) }, icon('copy'), h('span', { text: 'Copy invite' }));
        focus(copy);
        return card(
          h('div.arc-card__title', { text: 'Your room code' }),
          h('div.arc-net__code', { 'aria-label': `Room code ${spaced(room.code)}`, dataset: { code: room.code } },
            [...room.code].map(ch => h('span', { text: ch, 'aria-hidden': 'true' }))),
          h('div.arc-card__text', { text: 'Send it to your friend. On their StaticOS: Static Arcade → Join a friend, then type the code.' }),
          h('div.arc-card__row', copy, leave('Cancel')),
          h('div.arc-net__wait', h('i.arc-spin'), h('span', { text: room.phase === 'waiting' ? 'Waiting for your friend to join…' : 'Opening the room…' })),
          liveLine(N));
      }
      if (phase === 'joining') {
        const cancel = leave('Cancel');
        focus(cancel);
        return card(
          h('div.arc-card__title', { text: `Joining ${room.code}` }),
          h('div.arc-net__wait', h('i.arc-spin'), h('span', { text: room.phase === 'joining' ? 'Knocking on the room…' : 'Connecting…' })),
          h('div.arc-card__row', cancel), liveLine(N));
      }
      if (phase === 'ready') {
        if (room.role === 'host') {
          const go1 = h('button.btn.btn--primary', { type: 'button', onclick: () => room.start() }, icon('play', { fill: true }), h('span', { text: 'Start match' }));
          focus(go1);
          return card(
            h('div.arc-card__title', { text: `${peer} joined!` }),
            rules,
            h('div.arc-card__row', go1, leave('Leave room')),
            fine());
        }
        const out = leave('Leave room');
        focus(out);
        return card(
          h('div.arc-card__title', { text: `You’re in ${peer}’s room` }),
          rules,
          h('div.arc-net__wait', h('i.arc-spin'), h('span', { text: `Waiting for ${peer} to start…` })),
          h('div.arc-card__row', out),
          fine());
      }
      if (phase === 'countdown') {
        return h('div.arc-card.arc-net.arc-net--count', { role: 'status', 'aria-label': `Starting in ${N.cdN}`, dataset: { phase } },
          h('div.arc-card__kicker', { text: `${g.title} · you vs ${peer}` }),
          h('div.arc-net__count', { text: String(Math.max(1, N.cdN)) }),
          h('div.arc-card__text', { text: 'Get ready…' }));
      }
      if (phase === 'error') {
        const [title, text] = JOIN_ERR[N.err] || JOIN_ERR.nobody;
        const back = h('button.btn.btn--primary', { type: 'button', onclick: () => { netReset(); paintNet(); } }, h('span', { text: 'Back' }));
        focus(back);
        return card(h('div.arc-card__title', { text: title }), h('div.arc-card__text', { text }), h('div.arc-card__row', back, toArcade));
      }
      if (phase === 'left') {
        const gone = N.gone || {};
        const again = h('button.btn.btn--primary', { type: 'button', onclick: makeRoom }, icon('plus'), h('span', { text: 'Make a new room' }));
        focus(again);
        return card(
          h('div.arc-card__title', { text: gone.reason === 'quiet' ? `Lost touch with ${gone.who}` : `${gone.who} left the room` }),
          h('div.arc-card__text', { text: gone.reason === 'quiet'
            ? `Nothing arrived from ${gone.who} for 9 seconds — their connection may have dropped.${gone.wasPlaying ? ' The match has no result.' : ''}`
            : `${gone.wasPlaying ? 'The match ended early and has no result. ' : ''}You can make a new room and send them the code again.` }),
          h('div.arc-card__row', again, toArcade));
      }
      return card(h('div.arc-card__title', { text: 'Online' }));
    }

    function netResultCard() {
      const g = S.game, r = S.result, N = S.net;
      const room = N?.room;
      const peer = room?.peer?.name || 'Friend';
      const title = r.void ? 'No result' : r.won === true ? 'You win!' : r.won === false ? `${peer} wins` : 'It’s a draw';
      const fmtS = n => (Number.isFinite(n) ? fmtN(n) : '—');
      let again;
      if (N?.gone) again = h('button.btn', { type: 'button', disabled: true }, h('span', { text: `${N.gone.who} left` }));
      else if (room?.wantAgain) again = h('button.btn', { type: 'button', disabled: true }, h('i.arc-spin'), h('span', { text: `Waiting for ${peer}…` }));
      else again = h('button.btn.btn--primary.arc-res__again', { type: 'button', onclick: rematch },
        icon('rotate-ccw'), h('span', { text: room?.peerAgain ? `Rematch — ${peer} is in` : 'Rematch' }));
      const out = h('button.btn', { type: 'button', onclick: () => { netReset(); paintNet(); } }, h('span', { text: 'Leave room' }));
      setTimeout(() => {
        if (overlay.contains(again) && !again.disabled) again.focus({ preventScroll: true });
        else if (overlay.contains(out)) out.focus({ preventScroll: true });
      }, 40);
      return h('div.arc-card.arc-res.arc-net', {
        role: 'dialog', 'aria-label': `${title}. You ${fmtS(r.me)}, ${peer} ${fmtS(r.them)}`,
        dataset: { phase: 'result', won: r.void ? 'void' : r.won === null ? 'draw' : String(r.won) },
      },
        h('div.arc-card__kicker', { text: `${g.title} · you vs ${peer}` }),
        h('div.arc-card__title', { text: title }),
        h('div.arc-vs',
          h('div.arc-vs__side.is-me', h('b', { text: fmtS(r.me) }), h('span', { text: 'You' })),
          h('i', { text: '–', 'aria-hidden': 'true' }),
          h('div.arc-vs__side', h('b', { text: fmtS(r.them) }), h('span', { text: peer }))),
        r.detail ? h('div.arc-res__detail', { text: r.detail }) : null,
        room?.peerAgain && !room?.wantAgain && !N?.gone ? h('div.arc-res__new.arc-res__new--quiet', icon('users'), h('span', { text: `${peer} wants a rematch` })) : null,
        h('div.arc-res__note', { text: 'Online matches don’t change your best' }),
        h('div.arc-card__row', again, out),
        h('div.arc-card__hint', { text: 'Enter asks for a rematch' }));
    }

    function toggleJoinBar(open = joinBar.hidden) {
      joinBar.hidden = !open;
      joinOpenBtn.setAttribute('aria-expanded', String(open));
      joinOpenBtn.classList.toggle('is-on', open);
      if (open) setTimeout(() => joinInput.focus({ preventScroll: true }), 30);
      else { dropHomeRoom(); clear(joinStatus); joinStatus.className = 'arc-joinbar__status'; }
    }
    function joinNote(kind, code) {
      clear(joinStatus);
      joinStatus.className = 'arc-joinbar__status';
      if (kind === 'joining') {
        const st = S.homeRoom?.live?.() || 'idle';
        joinStatus.append(h('i.arc-spin'), h('span', { text: st === 'offline' ? LIVE_TEXT.offline : `Joining ${code}…` }));
        return;
      }
      const [title, text] = JOIN_ERR[kind] || JOIN_ERR.nobody;
      joinStatus.classList.add('is-err');
      joinStatus.append(icon('alert'), h('span', h('b', { text: `${title}. ` }), text));
    }

    /* ---------- sound + fullscreen ---------- */
    function paintSoundOn(btn) {
      const on = readState().sound !== false;
      clear(btn);
      btn.append(icon(on ? 'volume' : 'volume-x'));
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Game sound on' : 'Game sound off');
      btn.title = store.get('prefs.muted', false) ? 'StaticOS is muted' : on ? 'Game sound on' : 'Game sound off';
    }
    function paintSound() { paintSoundOn(soundBtn); }
    function toggleSound() {
      writeState({ sound: readState().sound === false });
      paintSound();
      focusStage();
    }

    function paintFsOn(btn, el) {
      const on = document.fullscreenElement === el;
      clear(btn);
      btn.append(icon(on ? 'minimize-2' : 'maximize-2'));
      btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      btn.title = on ? 'Exit full screen' : 'Full screen';
    }
    function paintFs() {
      if (!fsBtn) return;
      paintFsOn(fsBtn, play);
      play.classList.toggle('is-fs', document.fullscreenElement === play);
    }
    /* only ever leaves OUR full screen: when StaticOS itself is full
       screen (topbar › Enter Full Screen) the game goes full screen on
       top of it, and leaving returns to the full-screen desktop */
    function toggleFs() {
      if (document.fullscreenElement === play) document.exitFullscreen().catch(() => {});
      else play.requestFullscreen?.().catch(err => notify({ icon: 'alert', title: 'Full screen was refused', message: err.message }));
      focusStage();
    }
    const onFsChange = () => {
      if (S.dead) return;
      paintFs();
      focusStage();
      if (S.view === 'classic') { classics?.paintFs(); classics?.focus(); }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    offs.push(() => document.removeEventListener('fullscreenchange', onFsChange));

    /* ============================ Static Replay ============================ */
    const canvasOf = () => gameHost.querySelector('canvas');

    function paintRec() {
      clear(recSlot);
      if (!S.game) return;
      if (!REC.ok) {
        recSlot.append(h('span.arc-recnote', { title: REC.why, role: 'note', 'aria-label': `Can’t record: ${REC.why}` }, icon('info'), h('span', { text: 'Can’t record' })));
        return;
      }
      if (!S.rec && S.status !== 'loading' && S.status !== 'error' && S.status !== 'idle' && S.status !== 'online' && !canvasOf()) {
        const why = 'Static Replay records games drawn on a canvas; this one is built from page elements.';
        recSlot.append(h('span.arc-recnote', { title: why, role: 'note', 'aria-label': `Can’t record this game: ${why}` }, icon('info'), h('span', { text: 'Not recordable' })));
        return;
      }
      const on = !!S.rec;
      const btn = h('button.arc-ib.arc-rec', {
        type: 'button', class: on ? 'is-on' : '',
        disabled: !on && S.status !== 'playing',
        'aria-pressed': String(on),
        'aria-label': on ? 'Stop recording and save the clip' : 'Record a clip (up to 30 seconds)',
        title: on ? 'Stop and save' : 'Record a clip (up to 30 s)',
        onclick: () => { if (S.rec) stopRec('user'); else startRec(); focusStage(); },
      }, h('i.arc-rec__dot'), h('span.arc-rec__txt', { text: on ? recLabel() : 'Record' }));
      recSlot.append(btn);
    }
    const recElapsed = r => r.activeMs + (r.paused ? 0 : performance.now() - r.since);
    const recLabel = () => `${dur(Math.min(REC_MAX_MS, recElapsed(S.rec)))} / 0:30`;

    function startRec() {
      if (S.rec || !REC.ok || S.status !== 'playing') return;
      const cv = canvasOf();
      if (!cv) return;
      let stream, mr;
      try {
        stream = cv.captureStream(30);
        mr = new MediaRecorder(stream, { mimeType: REC.mime, videoBitsPerSecond: 5_000_000 });
      } catch (err) {
        stream?.getTracks().forEach(t => t.stop());
        notify({ icon: 'alert', title: 'Recording could not start', message: err.message });
        return;
      }
      const rec = { mr, stream, chunks: [], game: S.game, activeMs: 0, since: performance.now(), paused: false, timer: 0, saved: false, reason: '' };
      mr.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      mr.onstop = () => saveClip(rec);
      mr.onerror = e => { console.error('[arcade] recorder error', e.error || e); };
      try { mr.start(1000); } catch (err) {
        stream.getTracks().forEach(t => t.stop());
        notify({ icon: 'alert', title: 'Recording could not start', message: err.message });
        return;
      }
      S.rec = rec;
      rec.timer = setInterval(() => {
        if (S.rec !== rec) return;
        if (recElapsed(rec) >= REC_MAX_MS) stopRec('limit');
        else { const t = recSlot.querySelector('.arc-rec__txt'); if (t) t.textContent = recLabel(); }
      }, 250);
      paintRec();
    }

    function pauseRec() {
      const r = S.rec;
      if (!r || r.paused) return;
      r.activeMs += performance.now() - r.since;
      r.paused = true;
      try { if (r.mr.state === 'recording') r.mr.pause(); } catch (err) { /* keeps recording a still frame */ }
    }
    function resumeRec() {
      const r = S.rec;
      if (!r || !r.paused) return;
      r.since = performance.now();
      r.paused = false;
      try { if (r.mr.state === 'paused') r.mr.resume(); } catch (err) { /* nothing to resume */ }
    }

    function stopRec(reason) {
      const r = S.rec;
      if (!r) return;
      S.rec = null;
      clearInterval(r.timer);
      clearTimeout(S.autoStop);
      r.durationMs = Math.round(Math.min(REC_MAX_MS, recElapsed(r)));
      r.reason = reason;
      try {
        if (r.mr.state !== 'inactive') r.mr.stop();
        else saveClip(r);
      } catch (err) { saveClip(r); }
      if (!S.dead) paintRec();
    }

    async function saveClip(r) {
      if (r.saved) return;
      r.saved = true;
      r.stream.getTracks().forEach(t => t.stop());
      const type = (r.mr.mimeType || REC.mime || 'video/webm').split(';')[0];
      const raw = new Blob(r.chunks, { type });
      r.chunks = [];
      if (!raw.size || r.durationMs < 400) {
        notify({ icon: 'film', title: 'Clip not saved', message: 'That recording was too short to keep.' });
        return;
      }
      const blob = await webmWithDuration(raw, r.durationMs);
      const clip = {
        id: `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        game: r.game.id, title: r.game.title, at: Date.now(), mime: type, blob, durationMs: r.durationMs,
      };
      try {
        await DB.kv('clips').set(clip.id, clip);
      } catch (err) {
        notify({ icon: 'alert', title: 'Clip could not be saved', message: err.message });
        return;
      }
      const limit = r.reason === 'limit' ? ' (the 30 s limit)' : '';
      const where = DB.persistent ? 'Find it in Static Arcade › Clips.' : 'Storage is unavailable here, so it is kept only until you close StaticOS.';
      notify({
        icon: 'film', title: 'Clip saved',
        message: `${clip.title} · ${dur(clip.durationMs)}${limit}. ${where}`,
        actions: [{
          label: 'View clips',
          onClick: () => {
            if (!S.dead) { win.focus?.(); go('clips'); }
            else api.openApp('arcade', { view: 'clips' });
          },
        }],
      });
      bus.emit('clips:change', { id: clip.id, kind: 'save' });   /* the Library, Files and our Clips tab listen */
    }

    /* ============================ keyboard + focus ============================ */
    /* The shell decides after the game has seen the key: a game that uses
       P or Esc itself (and says so with preventDefault) keeps it. */
    const onKey = e => {
      if (S.dead || S.view !== 'play' || !win.el.classList.contains('is-active')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const k = e.key;
      if (k !== 'Escape' && k !== 'p' && k !== 'P' && k !== 'Enter') return;
      const t = e.target;
      const typing = !!t?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]');
      const onButton = !!t?.closest?.('button,a,[role="button"]');
      setTimeout(() => {
        if (S.dead || e.defaultPrevented) return;
        if (k === 'Enter') {
          if (S.status === 'over' && !onButton && !typing) { if (S.online) rematch(); else startRound(); }
          return;
        }
        if ((k === 'p' || k === 'P') && typing) return;
        if (S.status === 'playing') pause();
        else if (S.status === 'paused') resume();
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    offs.push(() => window.removeEventListener('keydown', onKey));

    /* leaving the window or the tab pauses a game that can pause */
    const autoPause = () => { if (!S.dead && S.status === 'playing' && S.inst?.pause) pause(); };
    win.onBlur?.(autoPause);
    const onVis = () => { if (document.hidden) autoPause(); };
    document.addEventListener('visibilitychange', onVis);
    offs.push(() => document.removeEventListener('visibilitychange', onVis));

    const offMute = store.sub?.('prefs.muted', () => {
      if (S.dead) return;
      if (S.view === 'play') paintSound();
      if (S.view === 'classic') classics?.setMuted(!soundOn());
    });
    if (offMute) offs.push(offMute);
    /* a minimised classic goes quiet, and its sound comes back with its window */
    offs.push(bus.on('win:minimize', w => { if (w?.el === win.el && S.view === 'classic') classics?.setMuted(true); }));
    offs.push(bus.on('win:restore', w => { if (w?.el === win.el && S.view === 'classic') classics?.setMuted(!soundOn()); }));

    /* opts: { game, players } opens straight into a game; { game, online: true, host: true }
       makes an online room for it (bus 'arcade:room' says its code); { view: 'clips' } the Clips tab */
    win.onReopen?.(o => {
      if (S.dead || !o) return;
      if (o.join) { openJoin(o.join); return; }
      if (o.spectate) { openSpectate(o.spectate); return; }
      if (classicFromGameId(o.game)) { openClassic(classicFromGameId(o.game).id); return; }
      if (o.game && arcadeById(o.game)) { launch(o.game, o.online ? 'online' : o.players); if (o.online && o.host) makeRoom(); }
      else if (o.view === 'clips' || o.view === 'games') go(o.view);
    });
    /* ---- spectating ---- */
    /* what a watcher gets: a board game's own small snapshot, else the score so far */
    function snapshotNow() {
      if (!S.game || S.view !== 'play') return null;
      let snap = null;
      try { snap = S.inst?.spectate?.() || null; } catch (err) { snap = null; }
      if (snap) return snap;
      const over = S.status === 'over';
      return { k: 'score', score: S.lastScore ?? null, unit: unitOf(S.game.id), st: over ? 'over' : S.status === 'paused' ? 'paused' : 'playing',
        txt: over && S.result?.detail ? S.result.detail : S.inst ? '' : 'Between rounds' };
    }
    function startWatch(raw) {
      const code = normalizeCode(raw);
      if (!isCode(code)) { joinNote('invalid', code); return; }
      stopWatch();
      toggleJoinBar(false);
      const v = watcherView({ code, onLeave: () => { if (S.view === 'watch') go('games'); } });
      S.watch = v;
      watchSec.replaceChildren(v.el);
      if (S.view !== 'watch') go('watch'); else paintView();
    }
    function stopWatch() {
      const v = S.watch;
      S.watch = null;
      if (v) { try { v.stop(); } catch (err) { /* gone */ } }
      watchSec.replaceChildren();
    }
    /* a watch link (#arcade=<id>&spectate=<CODE>): the code is filled in, the person presses Watch */
    function openSpectate(code) {
      if (S.view !== 'games') go('games');
      toggleJoinBar(true);
      joinInput.value = normalizeCode(code);
      clear(joinStatus);
      joinStatus.className = 'arc-joinbar__status';
      joinStatus.append(icon('eye'), h('span', { text: 'Press Watch to watch this game live. You can’t play or change anything.' }));
    }

    /* an invite link (#arcade=<id>&room=<CODE>) or opts.join: straight into the room */
    function openJoin(code) {
      if (S.view !== 'games') go('games');
      toggleJoinBar(true);
      joinInput.value = normalizeCode(code);
      joinOnline(joinInput.value, 'home');
    }

    /* ============================ start ============================ */
    paintTabs();
    refreshClipCount();
    if (opts?.join || opts?.spectate) {
      paintView();
      paintFilters();
      paintGrid();
      if (opts.join) openJoin(opts.join); else openSpectate(opts.spectate);
    } else if (classicFromGameId(opts?.game)) {
      paintView();
      paintFilters();
      paintGrid();
      openClassic(classicFromGameId(opts.game).id);
    } else if (opts?.game && arcadeById(opts.game)) {
      launch(opts.game, opts.online ? 'online' : opts.players);
      if (opts.online && opts.host) makeRoom();      /* { online, host }: straight to a room of your own */
    } else {
      if (opts?.view === 'clips') S.view = 'clips';
      paintView();
      paintFilters();
      if (S.view === 'clips') paintClips(); else paintGrid();
    }

    return () => {
      if (S.dead) return;
      stopRound(true);                     /* stops the game; a live clip is finalised and saved */
      classics?.destroy();                 /* removes the game's frame: its code and sound end with it */
      leaveOnline();
      dropHomeRoom();
      shareKit.stop();
      stopWatch();
      S.dead = true;
      clearTimeout(S.autoStop);
      if (S.padOn) { S.padOn = false; try { padmap.stop(); } catch (err) { /* already stopped */ } }
      revokeClipUrls();
      offs.forEach(f => { try { f(); } catch (err) { /* already gone */ } });
      if (document.fullscreenElement && (document.fullscreenElement === play || play.contains(document.fullscreenElement))) {
        document.exitFullscreen().catch(() => {});
      }
    };
  },
});

/* A copy of a game canvas's current picture, to leave on screen while the
   window fades out (a WebGL canvas without preserveDrawingBuffer copies blank,
   which is no worse than before). */
function stillOf(c) {
  if (!c || !c.width || !c.height || !c.parentElement) return null;
  try {
    const el = document.createElement('canvas');
    el.width = c.width; el.height = c.height;
    el.className = c.className; el.style.cssText = c.style.cssText;
    el.getContext('2d').drawImage(c, 0, 0);
    return { el, home: c.parentElement };
  } catch (err) { return null; }
}

/* ============================================================
   Cabinet art — a small still of each game, drawn once per card.
   Pure decoration: no numbers that could read as statistics.
   ============================================================ */
const MONO = '"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';
const SANS = 'Inter,ui-sans-serif,system-ui,sans-serif';

function drawArt(cv, game) {
  const W = 320, H = 180;
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  cv.width = W * dpr;
  cv.height = H * dpr;
  const g = cv.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  const hue = game.hue;
  const C = (l, a = 1, s = 100, hh = hue) => `hsla(${hh},${s}%,${l}%,${a})`;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#07050c');
  bg.addColorStop(1, C(9, 1, 55));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, W * 0.6);
  glow.addColorStop(0, C(50, 0.26));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const neon = (blur = 12, l = 60, hh = hue) => { g.shadowBlur = blur; g.shadowColor = C(l, 0.9, 100, hh); };
  const off = () => { g.shadowBlur = 0; };
  try { (ART[game.id] || ART.default)(g, W, H, C, neon, off, game); }
  catch (err) { /* art is decoration; a failure leaves the plain screen */ }
}

function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
  }
  g.closePath();
  g.fill();
}

/* the home card's picture of today's real puzzle, with this device's stars on it */
function drawDaily(cv, st) {
  const n = st.n, S = 132;
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  cv.width = S * dpr;
  cv.height = S * dpr;
  const g = cv.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  const k = S / n;
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n;
    g.fillStyle = `hsl(${REGION_HUES[st.regions[i] % REGION_HUES.length]} 52% ${(r + c) % 2 ? 34 : 37}%)`;
    g.fillRect(c * k, r * k, k + 0.5, k + 0.5);
  }
  g.strokeStyle = '#0b0810';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n;
    if (c + 1 < n && st.regions[i] !== st.regions[i + 1]) { g.moveTo((c + 1) * k, r * k); g.lineTo((c + 1) * k, (r + 1) * k); }
    if (r + 1 < n && st.regions[i] !== st.regions[i + n]) { g.moveTo(c * k, (r + 1) * k); g.lineTo((c + 1) * k, (r + 1) * k); }
  }
  g.stroke();
  g.fillStyle = '#ffe066';
  g.shadowBlur = st.solved ? 8 : 0;
  g.shadowColor = 'rgba(255,224,102,.9)';
  [...(st.marks || '')].forEach((m, i) => { if (m === '2') star(g, (i % n + 0.5) * k, (Math.floor(i / n) + 0.5) * k, k * 0.36); });
}

function rrect(g, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

function floorGrid(g, W, H, C, hz) {
  g.strokeStyle = C(60, 0.18);
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < 9; i++) { const y = hz + (H - hz) * (i / 9) ** 1.8; g.moveTo(0, y); g.lineTo(W, y); }
  for (let i = -8; i <= 8; i++) { g.moveTo(W / 2 + i * 8, hz); g.lineTo(W / 2 + i * 70, H); }
  g.stroke();
}

/* the card games: a fan of five cards, each game's own suits */
function cardArt(g, W, H, C, neon, off, game) {
  const hands = {
    solitaire: [['K', 3], ['Q', 2], ['J', 0], ['10', 1], ['A', 2]],
    spider: [['K', 3], ['Q', 3], ['J', 3], ['10', 3], ['9', 3]],
    freecell: [['A', 0], ['2', 1], ['3', 2], ['4', 3], ['5', 1]],
  }[game.id] || [];
  const shape = (s, x, y, k) => {
    g.beginPath();
    if (s === 1) { g.moveTo(x, y - k); g.lineTo(x + k * 0.72, y); g.lineTo(x, y + k); g.lineTo(x - k * 0.72, y); g.closePath(); return; }
    if (s === 2 || s === 3) {
      const d = s === 2 ? 1 : -1;
      g.moveTo(x, y + k * d);
      g.bezierCurveTo(x - k * 1.1, y + k * 0.1 * d, x - k * 0.8, y - k * 0.95 * d, x, y - k * 0.4 * d);
      g.bezierCurveTo(x + k * 0.8, y - k * 0.95 * d, x + k * 1.1, y + k * 0.1 * d, x, y + k * d);
      if (s === 3) { g.moveTo(x, y + k * 0.2); g.lineTo(x - k * 0.35, y + k * 1.05); g.lineTo(x + k * 0.35, y + k * 1.05); g.closePath(); }
      return;
    }
    for (const [dx, dy] of [[0, -0.45], [-0.48, 0.15], [0.48, 0.15]]) { g.moveTo(x + dx * k + k * 0.45, y + dy * k); g.arc(x + dx * k, y + dy * k, k * 0.45, 0, Math.PI * 2); }
    g.moveTo(x, y); g.lineTo(x - k * 0.3, y + k); g.lineTo(x + k * 0.3, y + k); g.closePath();
  };
  const cw = 58, ch = 82;
  hands.forEach(([rank, s], i) => {
    const a = (i - 2) * 0.24;
    g.save();
    g.translate(W / 2, H + 46);
    g.rotate(a);
    g.translate(-cw / 2, -150);
    neon(14, 55);
    g.fillStyle = '#f7f4ee';
    rrect(g, 0, 0, cw, ch, 7); g.fill();
    off();
    g.strokeStyle = C(70, 0.7);
    g.lineWidth = 1.5;
    rrect(g, 0.5, 0.5, cw - 1, ch - 1, 7); g.stroke();
    const ink = s === 1 || s === 2 ? '#d01236' : '#16161d';
    g.fillStyle = ink;
    g.font = `800 15px ${SANS}`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(rank, 6, 6);
    shape(s, cw / 2, ch / 2 + 6, 13);
    g.fill('nonzero');
    g.restore();
  });
  if (game.id === 'freecell') {
    g.strokeStyle = C(70, 0.55);
    g.lineWidth = 1.5;
    g.setLineDash([4, 4]);
    for (let i = 0; i < 4; i++) { rrect(g, W - 136 + i * 30, 16, 24, 32, 4); g.stroke(); }
    g.setLineDash([]);
  }
}

const ART = {
  ...ART_SPORTS2,
  snake(g, W, H, C, neon, off) {
    g.fillStyle = C(70, 0.12);
    for (let y = 19; y < H; y += 18) for (let x = 17; x < W; x += 18) g.fillRect(x - 1, y - 1, 2, 2);
    const X = i => 17 + i * 18, Y = j => 19 + j * 18;
    const path = [[2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [6, 6], [6, 5], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [10, 5], [11, 5], [12, 5]];
    const line = () => { g.beginPath(); path.forEach(([i, j], n) => (n ? g.lineTo(X(i), Y(j)) : g.moveTo(X(i), Y(j)))); };
    neon(16, 50);
    g.strokeStyle = C(52);
    g.lineWidth = 13;
    line(); g.stroke();
    off();
    g.strokeStyle = C(72, 0.5);
    g.lineWidth = 4;
    line(); g.stroke();
    const [hi, hj] = path[path.length - 1];
    g.fillStyle = C(66);
    g.beginPath(); g.arc(X(hi), Y(hj), 8.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#eafff1';
    for (const s of [-1, 1]) { g.beginPath(); g.arc(X(hi) + 2.5, Y(hj) + s * 3.6, 2.2, 0, Math.PI * 2); g.fill(); }
    neon(16, 60, 330);
    g.fillStyle = C(62, 1, 95, 330);
    g.beginPath(); g.arc(X(15), Y(5), 6, 0, Math.PI * 2); g.fill();
    off();
    g.strokeStyle = C(62, 0.9);
    g.lineWidth = 2;
    neon(10, 50);
    rrect(g, 6, 8, W - 12, H - 16, 8);
    g.stroke();
    off();
  },

  pong(g, W, H, C, neon, off) {
    g.fillStyle = C(75, 0.28);
    for (let y = 10; y < H; y += 17) g.fillRect(W / 2 - 1.5, y, 3, 9);
    g.font = `700 30px ${MONO}`;
    g.textAlign = 'center';
    g.fillStyle = C(72, 0.85);
    g.fillText('3', W / 2 - 42, 46);
    g.fillStyle = C(72, 0.85, 100, 330);
    g.fillText('5', W / 2 + 42, 46);
    neon(16, 55);
    g.fillStyle = C(66);
    rrect(g, 26, 70, 8, 52, 4); g.fill();
    neon(16, 55, 330);
    g.fillStyle = C(66, 1, 100, 330);
    rrect(g, W - 34, 48, 8, 52, 4); g.fill();
    off();
    for (let i = 0; i < 6; i++) {
      g.fillStyle = C(80, 0.05 + i * 0.05);
      g.beginPath(); g.arc(120 + i * 16, 128 - i * 8.5, 3 + i * 0.6, 0, Math.PI * 2); g.fill();
    }
    neon(18, 70);
    g.fillStyle = '#f2fbff';
    g.beginPath(); g.arc(222, 74, 7, 0, Math.PI * 2); g.fill();
    off();
  },

  breakout(g, W, H, C, neon, off) {
    const hues = [330, 350, 8, 26, 46];
    const cols = 9, bw = 30, bh = 11, gap = 3;
    const ox = (W - (cols * bw + (cols - 1) * gap)) / 2;
    const gone = new Set(['3,4', '4,4', '4,3', '5,4', '2,4', '6,4', '4,2']);
    hues.forEach((hh, r) => {
      for (let c = 0; c < cols; c++) {
        if (gone.has(`${c},${r}`)) continue;
        neon(8, 50, hh);
        g.fillStyle = C(58, 1, 92, hh);
        rrect(g, ox + c * (bw + gap), 20 + r * (bh + gap), bw, bh, 3); g.fill();
        off();
        g.fillStyle = 'rgba(255,255,255,.25)';
        g.fillRect(ox + c * (bw + gap) + 3, 20 + r * (bh + gap) + 2, bw - 6, 2);
      }
    });
    neon(16, 55);
    g.fillStyle = C(62);
    rrect(g, 128, 156, 64, 8, 4); g.fill();
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(255,240,220,${0.06 + i * 0.05})`;
      g.beginPath(); g.arc(150 + i * 7, 150 - i * 11, 2.5 + i * 0.4, 0, Math.PI * 2); g.fill();
    }
    neon(16, 70, 45);
    g.fillStyle = '#fff6e6';
    g.beginPath(); g.arc(186, 96, 6, 0, Math.PI * 2); g.fill();
    off();
  },

  flap(g, W, H, C, neon, off) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#070716');
    sky.addColorStop(1, '#3b1d2c');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,250,230,.7)';
    [[30, 20], [70, 40], [150, 16], [260, 30], [290, 60], [210, 50], [110, 60]].forEach(([x, y]) => g.fillRect(x, y, 2, 2));
    g.fillStyle = C(88, 0.9, 90);
    g.beginPath(); g.arc(262, 36, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0d0818';
    [[0, 40], [30, 62], [70, 34], [110, 52], [160, 30], [200, 58], [240, 44], [280, 60]].forEach(([x, hgt]) => g.fillRect(x, 160 - hgt, 34, hgt));
    const pipe = (x, y, hh, top) => {
      g.fillStyle = '#261c07';
      g.fillRect(x, y, 34, hh);
      neon(12, 55);
      g.strokeStyle = C(62);
      g.lineWidth = 2;
      g.strokeRect(x, y, 34, hh);
      const cy = top ? y + hh - 10 : y;
      g.fillStyle = '#2e2208';
      g.fillRect(x - 3, cy, 40, 10);
      g.strokeRect(x - 3, cy, 40, 10);
      off();
    };
    pipe(70, -2, 58, true); pipe(70, 118, 42, false);
    pipe(220, -2, 80, true); pipe(220, 138, 22, false);
    g.fillStyle = C(62);
    g.fillRect(0, 160, W, 2);
    g.fillStyle = '#0c0714';
    g.fillRect(0, 162, W, 18);
    g.save();
    g.translate(150, 88);
    g.rotate(-0.25);
    neon(16, 55);
    g.fillStyle = C(60);
    g.beginPath(); g.ellipse(0, 0, 15, 12, 0, 0, Math.PI * 2); g.fill();
    off();
    g.fillStyle = C(48, 1, 100, 38);
    g.beginPath(); g.ellipse(-5, 1, 8, 5, -0.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(6, -4, 4.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a0f05';
    g.beginPath(); g.arc(7.5, -4, 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff7a2e';
    g.beginPath(); g.moveTo(12, 0); g.lineTo(20, 2); g.lineTo(12, 5); g.closePath(); g.fill();
    g.restore();
  },

  racer(g, W, H, C, neon, off) {
    const hz = 92;
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#07021a');
    sky.addColorStop(0.6, '#260a3d');
    sky.addColorStop(1, C(32, 1, 85, 320));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, hz);
    const sun = g.createLinearGradient(0, hz - 60, 0, hz);
    sun.addColorStop(0, '#ffe46b');
    sun.addColorStop(0.6, '#ff7a59');
    sun.addColorStop(1, C(55, 1, 100, 325));
    g.save();
    g.beginPath(); g.rect(0, 0, W, hz); g.clip();
    neon(30, 60, 330);
    g.fillStyle = sun;
    g.beginPath(); g.arc(W / 2, hz - 8, 40, 0, Math.PI * 2); g.fill();
    off();
    g.fillStyle = sky;
    for (let i = 0; i < 5; i++) g.fillRect(W / 2 - 42, hz - 30 + i * 7, 84, 1.5 + i);
    g.restore();
    g.fillStyle = '#12041f';
    g.beginPath();
    g.moveTo(0, hz);
    [[0, 70], [40, 80], [70, 62], [110, 84], [150, hz], [180, hz], [210, 76], [250, 64], [290, 80], [320, 70], [320, hz]].forEach(([x, y]) => g.lineTo(x, y));
    g.closePath();
    g.fill();
    g.fillStyle = '#12031d';
    g.fillRect(0, hz, W, H - hz);
    floorGrid(g, W, H, C, hz);
    g.fillStyle = '#0b0413';
    g.beginPath();
    g.moveTo(W / 2 - 3, hz); g.lineTo(W / 2 + 3, hz); g.lineTo(W / 2 + 130, H); g.lineTo(W / 2 - 130, H);
    g.closePath();
    g.fill();
    neon(12, 60);
    g.strokeStyle = C(68);
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(W / 2 - 3, hz); g.lineTo(W / 2 - 130, H); g.moveTo(W / 2 + 3, hz); g.lineTo(W / 2 + 130, H); g.stroke();
    off();
    g.strokeStyle = 'rgba(255,220,250,.7)';
    g.lineWidth = 2;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const t1 = 0.12 + i * 0.24, t2 = t1 + 0.1;
        g.beginPath();
        g.moveTo(W / 2 + s * 43 * t1, hz + (H - hz) * t1);
        g.lineTo(W / 2 + s * 43 * t2, hz + (H - hz) * t2);
        g.stroke();
      }
    }
    const car = (x, y, w, hh) => {
      g.fillStyle = C(22, 1, 70);
      rrect(g, x - w / 2, y - hh * 0.72, w, hh * 0.72, 4); g.fill();
      g.fillStyle = C(14, 1, 50);
      g.beginPath(); g.moveTo(x - w * 0.34, y - hh * 0.7); g.lineTo(x - w * 0.24, y - hh); g.lineTo(x + w * 0.24, y - hh); g.lineTo(x + w * 0.34, y - hh * 0.7); g.fill();
      neon(12, 60);
      g.strokeStyle = C(68);
      g.lineWidth = 1.5;
      rrect(g, x - w / 2, y - hh * 0.72, w, hh * 0.72, 4); g.stroke();
      g.shadowColor = '#ff2d55';
      g.fillStyle = '#ff4d6d';
      g.fillRect(x - w * 0.44, y - hh * 0.5, w * 0.22, hh * 0.12);
      g.fillRect(x + w * 0.22, y - hh * 0.5, w * 0.22, hh * 0.12);
      off();
    };
    car(W / 2 + 26, 124, 26, 16);
    car(W / 2, 172, 62, 34);
  },

  g2048(g, W, H, C, neon, off) {
    const COL = { 2: ['#2c241a', '#f5e6cf'], 4: ['#3b2e1e', '#f7e3c4'], 8: ['#f08c3a', '#1f0d00'], 16: ['#f37335', '#1f0800'], 32: ['#f4543c', '#fff2ec'], 64: ['#ec3357', '#fff0f3'], 128: ['#f7c948', '#2a1a00'], 256: ['#f6b92b', '#2a1700'], 512: ['#f5a524', '#2a1400'], 1024: ['#ffd84d', '#2a1a00'], 2048: ['#fff27a', '#2a2000'] };
    const board = [[2, 0, 4, 0], [8, 16, 0, 2], [32, 64, 128, 4], [256, 512, 1024, 2048]];
    const size = 156, gap = 5, cell = (size - gap * 5) / 4;
    const ox = (W - size) / 2, oy = (H - size) / 2;
    neon(24, 45);
    g.fillStyle = '#16100b';
    rrect(g, ox, oy, size, size, 10); g.fill();
    off();
    board.forEach((row, r) => row.forEach((v, c) => {
      const x = ox + gap + c * (cell + gap), y = oy + gap + r * (cell + gap);
      if (!v) { g.fillStyle = '#211811'; rrect(g, x, y, cell, cell, 5); g.fill(); return; }
      const [b, ink] = COL[v];
      if (v >= 128) { g.shadowBlur = 12; g.shadowColor = b; }
      g.fillStyle = b;
      rrect(g, x, y, cell, cell, 5); g.fill();
      off();
      const d = String(v).length;
      g.font = `800 ${d <= 2 ? 15 : d === 3 ? 12 : 10}px ${SANS}`;
      g.fillStyle = ink;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(v), x + cell / 2, y + cell / 2 + 1);
    }));
  },

  blocks(g, W, H, C, neon, off) {
    /* a 10 × 10 grid mid-game, one row about to clear, the tray beside it */
    const k = 15, ox = 26, oy = 15;
    const block = (x, y, s, hh, a = 1) => {
      const grd = g.createLinearGradient(0, y, 0, y + s);
      grd.addColorStop(0, `hsla(${hh},95%,68%,${a})`);
      grd.addColorStop(1, `hsla(${hh},80%,42%,${a})`);
      g.fillStyle = grd;
      rrect(g, x + 0.8, y + 0.8, s - 1.6, s - 1.6, s * 0.2); g.fill();
      g.fillStyle = `rgba(255,255,255,${0.3 * a})`;
      g.fillRect(x + s * 0.2, y + s * 0.15, s * 0.6, s * 0.13);
    };
    neon(22, 45);
    g.fillStyle = '#0b0d1c';
    rrect(g, ox - 5, oy - 5, k * 10 + 10, k * 10 + 10, 7); g.fill();
    off();
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      g.fillStyle = (r + c) % 2 ? '#141838' : '#11142e';
      rrect(g, ox + c * k + 1, oy + r * k + 1, k - 2, k - 2, 3); g.fill();
    }
    /* rows of squares: hue per shape, '.' empty */
    const rows = {
      4: '22.......5', 5: '22..33.115', 6: '7773344115', 7: '7.6666.1.5', 8: '0011100445', 9: '0011.88445',
    };
    const HUES = [26, 212, 188, 148, 268, 328, 118, 52, 2];
    for (const [r, line] of Object.entries(rows)) [...line].forEach((ch, c) => { if (ch !== '.') block(ox + c * k, oy + r * k, k, HUES[ch]); });
    /* the row that is about to clear */
    neon(16, 80, 210);
    g.fillStyle = 'rgba(255,255,255,.18)';
    rrect(g, ox, oy + 6 * k, k * 10, k, 4); g.fill();
    off();
    /* a shape being dropped into the gap, with its ghost */
    for (const [r, c] of [[7, 1], [7, 6]]) {
      g.strokeStyle = 'rgba(190,230,255,.75)';
      g.lineWidth = 1.2;
      g.setLineDash([3, 2]);
      rrect(g, ox + c * k + 2, oy + r * k + 2, k - 4, k - 4, 3); g.stroke();
      g.setLineDash([]);
    }
    /* the tray */
    const tx = 200, tw = 96;
    [[0, [[0, 0], [1, 0], [1, 1]], 212], [1, [[0, 0], [0, 1], [0, 2], [0, 3]], 268], [2, [[0, 0], [0, 1], [1, 0], [1, 1]], 26]].forEach(([i, cells, hh]) => {
      const y = 14 + i * 52;
      g.fillStyle = i === 0 ? C(30, 0.4) : 'rgba(255,255,255,.035)';
      rrect(g, tx, y, tw, 46, 8); g.fill();
      g.strokeStyle = i === 0 ? C(75, 0.75) : 'rgba(255,255,255,.08)';
      g.lineWidth = 1;
      rrect(g, tx + 0.5, y + 0.5, tw - 1, 45, 8); g.stroke();
      const s = 11;
      const cols = Math.max(...cells.map(q => q[1])) + 1, rws = Math.max(...cells.map(q => q[0])) + 1;
      for (const [r, c] of cells) block(tx + tw / 2 - (cols * s) / 2 + c * s, y + 23 - (rws * s) / 2 + r * s, s, hh);
    });
    /* the floating score */
    g.font = `800 16px ${SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    neon(12, 70, 50);
    g.fillStyle = '#fff6c8';
    g.fillText('+30', ox + k * 5, oy + 5.6 * k - 22);
    off();
  },

  reaction(g, W, H, C, neon, off) {
    floorGrid(g, W, H, C, 120);
    neon(40, 50);
    g.fillStyle = C(48, 1, 85);
    g.beginPath(); g.arc(W / 2, 82, 48, 0, Math.PI * 2); g.fill();
    off();
    g.strokeStyle = C(80, 0.6);
    g.lineWidth = 2;
    g.beginPath(); g.arc(W / 2, 82, 58, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#04200a';
    g.font = `800 20px ${SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('CLICK!', W / 2, 83);
  },

  aim(g, W, H, C, neon, off) {
    floorGrid(g, W, H, C, 130);
    const target = (x, y, r) => {
      neon(14, 55);
      for (let i = 3; i >= 1; i--) {
        g.fillStyle = i % 2 ? C(58) : '#1a0508';
        g.beginPath(); g.arc(x, y, (r * i) / 3, 0, Math.PI * 2); g.fill();
      }
      off();
    };
    target(80, 60, 18); target(236, 104, 24); target(150, 132, 11);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(236, 104, 34, 0, Math.PI * 2);
    g.moveTo(236 - 44, 104); g.lineTo(236 - 26, 104);
    g.moveTo(236 + 26, 104); g.lineTo(236 + 44, 104);
    g.moveTo(236, 104 - 44); g.lineTo(236, 104 - 26);
    g.moveTo(236, 104 + 26); g.lineTo(236, 104 + 44);
    g.stroke();
  },

  typing(g, W, H, C, neon, off) {
    g.font = `700 26px ${MONO}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const word = 'static', typed = 3;
    const w = g.measureText(word).width;
    const x0 = W / 2 - w / 2;
    neon(14, 60);
    g.fillStyle = C(75);
    g.fillText(word.slice(0, typed), x0, 50);
    off();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillText(word.slice(typed), x0 + g.measureText(word.slice(0, typed)).width, 50);
    g.fillStyle = C(70);
    g.fillRect(x0 + g.measureText(word.slice(0, typed)).width + 1, 36, 2.5, 28);
    const rows = [10, 9, 7];
    const lit = new Set(['0,4', '1,1', '2,3']);
    rows.forEach((n, r) => {
      const kw = 24, gap = 4, rw = n * kw + (n - 1) * gap;
      for (let i = 0; i < n; i++) {
        const x = (W - rw) / 2 + i * (kw + gap), y = 92 + r * 27;
        const on = lit.has(`${r},${i}`);
        if (on) neon(12, 60);
        g.fillStyle = on ? C(62) : 'rgba(255,255,255,.07)';
        rrect(g, x, y, kw, 22, 5); g.fill();
        off();
        g.strokeStyle = on ? C(80) : C(70, 0.2);
        g.lineWidth = 1;
        rrect(g, x + 0.5, y + 0.5, kw - 1, 21, 5); g.stroke();
      }
    });
  },

  memory(g, W, H, C, neon, off) {
    const cw = 52, ch = 66, gap = 10;
    const ox = (W - (4 * cw + 3 * gap)) / 2, oy = (H - (2 * ch + gap)) / 2;
    const up = new Set([1, 6]);
    for (let i = 0; i < 8; i++) {
      const x = ox + (i % 4) * (cw + gap), y = oy + Math.floor(i / 4) * (ch + gap);
      if (up.has(i)) {
        neon(16, 60);
        g.fillStyle = '#fbeff6';
        rrect(g, x, y, cw, ch, 7); g.fill();
        off();
        g.fillStyle = C(58);
        const cx = x + cw / 2, cy = y + ch / 2;
        g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx + 12, cy); g.lineTo(cx, cy + 16); g.lineTo(cx - 12, cy); g.closePath(); g.fill();
      } else {
        const grd = g.createLinearGradient(x, y, x + cw, y + ch);
        grd.addColorStop(0, C(34, 1, 70));
        grd.addColorStop(1, C(18, 1, 70));
        g.fillStyle = grd;
        rrect(g, x, y, cw, ch, 7); g.fill();
        g.strokeStyle = C(70, 0.35);
        g.lineWidth = 1.2;
        rrect(g, x + 5, y + 5, cw - 10, ch - 10, 4); g.stroke();
      }
    }
  },

  mines(g, W, H, C, neon, off) {
    const cols = 11, rows = 6, s = 22;
    const ox = (W - cols * s) / 2, oy = (H - rows * s) / 2;
    const nums = { '1,1': 1, '2,1': 2, '3,1': 2, '4,1': 1, '1,2': 1, '4,2': 1, '1,3': 1, '2,3': 1, '3,3': 1, '4,3': 1 };
    const revealed = new Set(['1,1', '2,1', '3,1', '4,1', '1,2', '2,2', '3,2', '4,2', '1,3', '2,3', '3,3', '4,3', '0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '0,1', '0,2', '0,3', '0,4', '1,4', '2,4', '3,4', '4,4', '5,4', '5,1', '5,2', '5,3']);
    const ink = { 1: '#7cc4ff', 2: '#7ef0a8' };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = ox + c * s, y = oy + r * s, k = `${c},${r}`;
      if (revealed.has(k)) {
        g.fillStyle = '#0c1422';
        g.fillRect(x + 1, y + 1, s - 2, s - 2);
        const n = nums[k];
        if (n) {
          g.fillStyle = ink[n];
          g.font = `800 12px ${MONO}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(n), x + s / 2, y + s / 2 + 1);
        }
      } else {
        g.fillStyle = C(30, 1, 55);
        rrect(g, x + 1, y + 1, s - 2, s - 2, 3); g.fill();
        g.fillStyle = 'rgba(255,255,255,.12)';
        g.fillRect(x + 3, y + 3, s - 6, 2);
      }
    }
    const fx = ox + 2 * s + s / 2, fy = oy + 2 * s + s / 2;
    g.fillStyle = C(30, 1, 55);
    rrect(g, ox + 2 * s + 1, oy + 2 * s + 1, s - 2, s - 2, 3); g.fill();
    g.fillStyle = C(30, 1, 55);
    rrect(g, ox + 3 * s + 1, oy + 2 * s + 1, s - 2, s - 2, 3); g.fill();
    neon(10, 55, 0);
    g.fillStyle = '#ff4d5e';
    g.beginPath(); g.moveTo(fx - 3, fy - 7); g.lineTo(fx + 6, fy - 3); g.lineTo(fx - 3, fy + 1); g.closePath(); g.fill();
    off();
    g.strokeStyle = '#e8eef7';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(fx - 3, fy - 7); g.lineTo(fx - 3, fy + 7); g.stroke();
  },

  echo(g, W, H, C, neon, off) {
    const cx = W / 2, cy = H / 2, R = 70, r = 26;
    const pads = [[180, -Math.PI, -Math.PI / 2], [120, -Math.PI / 2, 0], [50, 0, Math.PI / 2], [330, Math.PI / 2, Math.PI]];
    pads.forEach(([hh, a0, a1], i) => {
      const lit = i === 1;
      if (lit) neon(28, 60, hh);
      g.fillStyle = C(lit ? 60 : 26, 1, lit ? 100 : 70, hh);
      g.beginPath();
      g.arc(cx, cy, R, a0 + 0.06, a1 - 0.06);
      g.arc(cx, cy, r + 6, a1 - 0.14, a0 + 0.14, true);
      g.closePath();
      g.fill();
      off();
    });
    g.fillStyle = '#07050c';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = C(70, 0.5);
    g.lineWidth = 1.5;
    g.stroke();
  },

  'ghost-hunt'(g, W, H, C, neon, off) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#06030f');
    sky.addColorStop(1, '#22123d');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(235,225,255,.6)';
    [[24, 18], [70, 34], [140, 14], [200, 40], [300, 70], [110, 52], [40, 70]].forEach(([x, y]) => g.fillRect(x, y, 1.6, 1.6));
    neon(30, 80, 50);
    g.fillStyle = '#f6ecc8';
    g.beginPath(); g.arc(262, 40, 20, 0, Math.PI * 2); g.fill();
    off();
    g.fillStyle = '#0c0718';
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) g.lineTo(x, 146 + Math.sin(x * 0.03) * 6);
    g.lineTo(W, H); g.fill();
    [[30, 150, 12], [74, 146, 9], [236, 148, 11], [286, 152, 8]].forEach(([x, y, s]) => {
      g.beginPath(); g.moveTo(x - s, y); g.lineTo(x - s, y - s * 1.3); g.arc(x, y - s * 1.3, s, Math.PI, 0); g.lineTo(x + s, y); g.fill();
    });
    const ghost = (x, y, r, hh, l) => {
      neon(18, 70, hh);
      g.fillStyle = C(l, 0.95, 70, hh);
      g.beginPath();
      g.arc(x, y, r, Math.PI, 0);
      g.lineTo(x + r, y + r * 0.9);
      for (let i = 0; i < 4; i++) {
        const x0 = x + r - (i * 2 * r) / 4, x1 = x + r - ((i + 1) * 2 * r) / 4;
        g.quadraticCurveTo((x0 + x1) / 2, y + r * 1.25, x1, y + r * 0.9);
      }
      g.closePath(); g.fill();
      off();
      g.fillStyle = '#160b2a';
      g.beginPath(); g.ellipse(x - r * 0.34, y - r * 0.1, r * 0.15, r * 0.21, 0, 0, Math.PI * 2); g.ellipse(x + r * 0.34, y - r * 0.1, r * 0.15, r * 0.21, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(x, y + r * 0.34, r * 0.12, r * 0.16, 0, 0, Math.PI * 2); g.fill();
    };
    ghost(78, 70, 15, 190, 76);
    ghost(240, 92, 13, 46, 66);
    ghost(156, 84, 26, 260, 92);
    g.strokeStyle = C(80, 0.95, 100, 315);
    g.lineWidth = 1.6;
    neon(10, 60, 315);
    g.beginPath(); g.arc(160, 86, 34, 0, Math.PI * 2);
    g.moveTo(160 - 48, 86); g.lineTo(160 - 26, 86); g.moveTo(160 + 26, 86); g.lineTo(160 + 48, 86);
    g.moveTo(160, 86 - 48); g.lineTo(160, 86 - 26); g.moveTo(160, 86 + 26); g.lineTo(160, 86 + 48);
    g.stroke();
    off();
  },

  'candy-catcher'(g, W, H, C, neon, off) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#07041a');
    sky.addColorStop(0.75, '#3a1638');
    sky.addColorStop(1, '#5a2440');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffeec8';
    g.beginPath(); g.arc(46, 34, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1f0d2c';
    g.beginPath(); g.arc(53, 31, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#140a1f';
    [[0, 112, 54, 50], [70, 100, 48, 62], [196, 106, 60, 56], [262, 96, 58, 66]].forEach(([x, y, w, hh]) => {
      g.fillRect(x, y, w, hh);
      g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + w / 2, y - w * 0.4); g.lineTo(x + w + 4, y); g.fill();
    });
    neon(10, 60, 35);
    g.fillStyle = '#ffb347';
    [[14, 124], [86, 114], [214, 120], [280, 110], [300, 130]].forEach(([x, y]) => g.fillRect(x, y, 9, 10));
    off();
    g.fillStyle = '#1a0f16';
    g.fillRect(0, 162, W, 18);
    /* candy in the air */
    const wrap = (x, y, hh, rot) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = C(38, 1, 80, hh);
      g.beginPath(); g.moveTo(-8, 0); g.lineTo(-15, -6); g.lineTo(-15, 6); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(8, 0); g.lineTo(15, -6); g.lineTo(15, 6); g.closePath(); g.fill();
      g.fillStyle = C(60, 1, 90, hh);
      g.beginPath(); g.ellipse(0, 0, 9, 6.5, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    };
    wrap(70, 40, 330, 0.4); wrap(250, 64, 200, -0.3); wrap(180, 30, 140, 0.9);
    g.save(); g.translate(120, 72);
    g.beginPath(); g.moveTo(0, 11); g.lineTo(-8, -8); g.quadraticCurveTo(0, -12, 8, -8); g.closePath(); g.clip();
    g.fillStyle = '#ffd23d'; g.fillRect(-10, -14, 20, 9);
    g.fillStyle = '#ff7f1a'; g.fillRect(-10, -5, 20, 8);
    g.fillStyle = '#fff6e8'; g.fillRect(-10, 3, 20, 10);
    g.restore();
    g.strokeStyle = 'rgba(230,225,240,.45)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(214, 0); g.lineTo(214, 92); g.stroke();
    g.fillStyle = '#0d0712';
    g.strokeStyle = '#0d0712';
    g.lineWidth = 2;
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(214, 100); g.quadraticCurveTo(214 + s * 9, 92 + i * 4, 214 + s * 13, 98 + i * 4); g.stroke(); }
    g.beginPath(); g.ellipse(214, 101, 7, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff3b4e';
    g.beginPath(); g.arc(212, 95, 1.3, 0, Math.PI * 2); g.arc(216, 95, 1.3, 0, Math.PI * 2); g.fill();
    /* the bucket */
    neon(24, 55, 28);
    const b = g.createRadialGradient(150, 134, 4, 160, 146, 46);
    b.addColorStop(0, '#ffad4a'); b.addColorStop(1, '#c4560c');
    g.fillStyle = b;
    g.beginPath(); g.moveTo(124, 122); g.bezierCurveTo(118, 146, 132, 166, 146, 166); g.lineTo(174, 166); g.bezierCurveTo(188, 166, 202, 146, 196, 122); g.closePath(); g.fill();
    off();
    g.fillStyle = '#2a0e02';
    g.beginPath(); g.ellipse(160, 122, 36, 6, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1b1210'; g.lineWidth = 3;
    g.beginPath(); g.arc(160, 124, 33, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    neon(10, 70, 48);
    g.fillStyle = '#ffd24a';
    g.beginPath(); g.moveTo(140, 140); g.lineTo(150, 140); g.lineTo(145, 132); g.closePath();
    g.moveTo(170, 140); g.lineTo(180, 140); g.lineTo(175, 132); g.closePath();
    g.moveTo(140, 148); g.quadraticCurveTo(160, 162, 180, 148); g.quadraticCurveTo(160, 154, 140, 148); g.fill();
    off();
  },

  'haunted-maze'(g, W, H, C, neon, off) {
    g.fillStyle = '#030504';
    g.fillRect(0, 0, W, H);
    const k = 20, ox = 10, oy = 0;
    /* a fixed little maze: each string is a row of walls, '#' wall */
    const rows = [
      '###############',
      '#.....#.......#',
      '#.###.#.#####.#',
      '#.#...#.....#.#',
      '#.#.#######.#.#',
      '#...#.......#..',
      '###.#.#######.#',
      '#.....#.......#',
      '###############',
    ];
    const cx = 2.5 * k + ox, cy = 5.5 * k + oy;
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      const px = ox + x * k, py = oy + y * k;
      const d = Math.hypot(px + k / 2 - cx, py + k / 2 - cy);
      const lit = Math.max(0.1, 1 - d / 95);
      if (ch === '#') {
        g.fillStyle = `rgba(48,44,66,${lit})`;
        g.fillRect(px, py, k, k);
        g.fillStyle = `rgba(190,180,220,${lit * 0.3})`;
        g.fillRect(px, py, k, 2);
      } else {
        g.fillStyle = `rgba(36,40,38,${lit})`;
        g.fillRect(px, py, k, k);
      }
    }));
    const lg = g.createRadialGradient(cx, cy, 6, cx, cy, 90);
    lg.addColorStop(0, 'rgba(255,160,60,.28)');
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    /* the door's green light on the right */
    const dx = ox + 15 * k, dy = 5.5 * k + oy;
    const dg = g.createRadialGradient(dx, dy, 0, dx, dy, 46);
    dg.addColorStop(0, C(60, 0.75, 100, 150));
    dg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = dg;
    g.fillRect(dx - 50, dy - 50, 100, 100);
    /* you, a lantern-lit pumpkin */
    neon(20, 55, 28);
    g.fillStyle = '#f07812';
    g.beginPath(); g.ellipse(cx, cy, 8.5, 7.5, 0, 0, Math.PI * 2); g.fill();
    off();
    g.fillStyle = '#3d6b1c';
    g.fillRect(cx - 1.5, cy - 10, 3, 4);
    g.fillStyle = '#ffe27a';
    g.beginPath(); g.moveTo(cx - 5, cy - 1); g.lineTo(cx - 1.5, cy - 1); g.lineTo(cx - 3.2, cy - 4); g.closePath();
    g.moveTo(cx + 1.5, cy - 1); g.lineTo(cx + 5, cy - 1); g.lineTo(cx + 3.2, cy - 4); g.closePath();
    g.moveTo(cx - 5, cy + 2); g.quadraticCurveTo(cx, cy + 6, cx + 5, cy + 2); g.fill();
  },

  chess(g, W, H, C, neon, off) {
    /* a board in perspective, a few pieces mid-game */
    const top = 40, bot = H - 6, cx = W / 2, wTop = 150, wBot = 300;
    const at = (f, r) => {
      const t = r / 8, y = top + (bot - top) * (t ** 1.15);
      const w = wTop + (wBot - wTop) * (t ** 1.15);
      return { x: cx - w / 2 + (w / 8) * f, y, w: w / 8 };
    };
    neon(30, 45);
    g.fillStyle = '#0e1412';
    const a0 = at(0, 0), a1 = at(8, 0), b0 = at(0, 8), b1 = at(8, 8);
    g.beginPath();
    g.moveTo(a0.x - 4, a0.y - 3); g.lineTo(a1.x + 4, a1.y - 3); g.lineTo(b1.x + 6, b1.y + 2); g.lineTo(b0.x - 6, b0.y + 2); g.closePath(); g.fill();
    off();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const p = at(f, r), q = at(f, r + 1), p2 = at(f + 1, r), q2 = at(f + 1, r + 1);
      g.fillStyle = (r + f) % 2 ? '#4f8a78' : '#d6e4da';
      if ((r === 3 && f === 4) || (r === 5 && f === 4)) g.fillStyle = (r + f) % 2 ? '#9fb050' : '#e8e27a';
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p2.x, p2.y); g.lineTo(q2.x, q2.y); g.lineTo(q.x, q.y); g.closePath(); g.fill();
    }
    const piece = (f, r, white, kind) => {
      const p = at(f + 0.5, r + 0.6), s = p.w * 0.9;
      g.save();
      g.translate(p.x, p.y);
      g.fillStyle = white ? '#f4f1ea' : '#241f2b';
      g.strokeStyle = white ? '#141118' : '#cbbfe0';
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(0, 0, s * 0.42, s * 0.14, 0, 0, Math.PI * 2);
      g.fill(); g.stroke();
      const tall = kind === 'k' ? 0.95 : kind === 'b' ? 0.82 : 0.7;
      g.beginPath();
      g.moveTo(-s * 0.26, 0); g.quadraticCurveTo(-s * 0.18, -s * 0.5, -s * 0.12, -s * tall);
      g.lineTo(s * 0.12, -s * tall); g.quadraticCurveTo(s * 0.18, -s * 0.5, s * 0.26, 0); g.closePath();
      g.fill(); g.stroke();
      g.beginPath(); g.arc(0, -s * (tall + 0.07), s * (kind === 'p' ? 0.17 : 0.2), 0, Math.PI * 2); g.fill(); g.stroke();
      if (kind === 'k') { g.fillStyle = g.strokeStyle; g.fillRect(-1, -s * 1.42, 2, s * 0.3); g.fillRect(-s * 0.1, -s * 1.33, s * 0.2, 2); }
      g.restore();
    };
    piece(4, 0, false, 'k'); piece(2, 1, false, 'p'); piece(5, 1, false, 'p'); piece(3, 2, false, 'b');
    piece(4, 3, false, 'p'); piece(4, 5, true, 'p'); piece(2, 5, true, 'b'); piece(5, 6, true, 'p'); piece(3, 7, true, 'k');
  },

  ttt(g, W, H, C, neon, off) {
    const q = 60, ox = (W - 3 * q) / 2, oy = (H - 3 * q) / 2;
    neon(14, 55, 210);
    g.strokeStyle = 'rgba(170,210,255,.9)'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 1; i < 3; i++) {
      g.beginPath(); g.moveTo(ox + i * q, oy + 4); g.lineTo(ox + i * q, oy + 3 * q - 4); g.stroke();
      g.beginPath(); g.moveTo(ox + 4, oy + i * q); g.lineTo(ox + 3 * q - 4, oy + i * q); g.stroke();
    }
    off();
    const X = (c, r, col) => { const x = ox + (c + 0.5) * q, y = oy + (r + 0.5) * q, a = q * 0.28; neon(10, 90, 0); g.strokeStyle = col; g.lineWidth = 5; g.beginPath(); g.moveTo(x - a, y - a); g.lineTo(x + a, y + a); g.moveTo(x + a, y - a); g.lineTo(x - a, y + a); g.stroke(); off(); };
    const O = (c, r, col) => { const x = ox + (c + 0.5) * q, y = oy + (r + 0.5) * q; neon(10, 90, 200); g.strokeStyle = col; g.lineWidth = 5; g.beginPath(); g.arc(x, y, q * 0.28, 0, Math.PI * 2); g.stroke(); off(); };
    X(0, 0, '#4dd2ff'); O(1, 0, '#ff4d6d'); X(1, 1, '#4dd2ff'); O(0, 1, '#ff4d6d'); X(2, 2, '#4dd2ff'); O(2, 0, '#ff4d6d');
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(ox + 0.5 * q - 6, oy + 0.5 * q - 6); g.lineTo(ox + 2.5 * q + 6, oy + 2.5 * q + 6); g.stroke();
  },

  dnb(g, W, H, C, neon, off) {
    const n = 4, s = 30, ox = (W - n * s) / 2, oy = (H - n * s) / 2;
    const owner = ['b', 'b', '', '', 'p', 'b', '', '', 'p', 'p', '', '', '', '', '', ''];
    owner.forEach((v, i) => { if (!v) return; g.fillStyle = v === 'b' ? 'rgba(77,210,255,.35)' : 'rgba(255,77,109,.35)'; g.fillRect(ox + (i % n) * s + 3, oy + Math.floor(i / n) * s + 3, s - 6, s - 6); });
    g.lineCap = 'round'; g.lineWidth = 4; g.strokeStyle = 'rgba(215,228,255,.92)';
    const line = (r1, c1, r2, c2) => { g.beginPath(); g.moveTo(ox + c1 * s, oy + r1 * s); g.lineTo(ox + c2 * s, oy + r2 * s); g.stroke(); };
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [1, 2], [2, 2]]) line(r, c, r, c + 1);
    for (const [r, c] of [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 3]]) line(r, c, r + 1, c);
    neon(12, 90, 150); g.strokeStyle = '#fff'; line(3, 2, 3, 3); off();
    g.fillStyle = '#e8eeff';
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) { g.beginPath(); g.arc(ox + c * s, oy + r * s, 3.5, 0, Math.PI * 2); g.fill(); }
  },

  connect4(g, W, H, C, neon, off) {
    const cols = 7, rows = 6, k = 22, ox = (W - cols * k) / 2, oy = 28;
    const grid = ['.......', '.......', '...2...', '..21...', '.2112..', '21121.1'];
    const win = [[5, 0], [4, 1], [3, 2], [2, 3]];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      if (v === '.') continue;
      g.fillStyle = v === '1' ? '#ffd23f' : '#ff4d6d';
      g.beginPath(); g.arc(ox + (c + 0.5) * k, oy + (r + 0.5) * k, k * 0.4, 0, Math.PI * 2); g.fill();
    }
    neon(24, 55, 225);
    g.fillStyle = '#2346e8';
    g.beginPath();
    rrect(g, ox - 6, oy - 4, cols * k + 12, rows * k + 8, 8);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = ox + (c + 0.5) * k, y = oy + (r + 0.5) * k;
      g.moveTo(x + k * 0.42, y); g.arc(x, y, k * 0.42, 0, Math.PI * 2, true);
    }
    g.fill('evenodd');
    off();
    neon(14, 90, 60);
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.lineWidth = 2;
    for (const [r, c] of win) { g.beginPath(); g.arc(ox + (c + 0.5) * k, oy + (r + 0.5) * k, k * 0.4, 0, Math.PI * 2); g.stroke(); }
    off();
    /* a disc on its way down */
    neon(14, 60, 48);
    g.fillStyle = '#ffd23f';
    g.beginPath(); g.arc(ox + 4.5 * k, oy - 12, k * 0.4, 0, Math.PI * 2); g.fill();
    off();
  },

  daily(g, W, H, C, neon, off) {
    const n = 7, k = 20, ox = (W - n * k) / 2, oy = (H - n * k) / 2;
    const reg = ['aabbbbc', 'aaadbcc', 'eaaaffc', 'eagafff', 'eggffff', 'egggfff', 'gggggff'];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      g.fillStyle = `hsl(${REGION_HUES['abcdefg'.indexOf(reg[r][c])]} 52% 36%)`;
      g.fillRect(ox + c * k, oy + r * k, k, k);
    }
    neon(16, 70, 48);
    g.fillStyle = '#ffe066';
    for (const [r, c] of [[0, 5], [1, 3], [3, 1]]) star(g, ox + (c + 0.5) * k, oy + (r + 0.5) * k, k * 0.36);
    off();
  },
  solitaire: cardArt,
  spider: cardArt,
  freecell: cardArt,
  stacker(g, W, H, C, neon, off) {
    /* a well with a half-built stack, a falling piece and its ghost */
    const k = 15, ox = 110, oy = 8;
    const cell = (c, r, hh, a = 1) => {
      g.fillStyle = `hsla(${hh},85%,58%,${a})`;
      rrect(g, ox + c * k + 1, oy + r * k + 1, k - 2, k - 2, 3); g.fill();
      g.fillStyle = `rgba(255,255,255,${0.3 * a})`;
      g.fillRect(ox + c * k + 3, oy + r * k + 3, k - 6, 2);
    };
    neon(22, 45);
    g.fillStyle = '#0a0d1c';
    rrect(g, ox - 4, oy - 4, k * 10 + 8, k * 11 + 8, 6); g.fill();
    off();
    const rows = { 7: '.....1....', 8: '..2.11.4..', 9: '3322117444', 10: '3.2255.446' };
    const HUES = [0, 190, 50, 285, 120, 0, 225, 30];
    for (const [r, line] of Object.entries(rows)) [...line].forEach((ch, c) => { if (ch !== '.') cell(c, +r, HUES[+ch] || 30); });
    for (const [r, c] of [[0, 4], [1, 4], [2, 4], [2, 5]]) cell(c, r, 30);
    g.strokeStyle = 'rgba(255,200,120,.7)'; g.lineWidth = 1.2; g.setLineDash([3, 2]);
    for (const [r, c] of [[6, 4], [7, 4], [8, 4], [8, 5]].slice(0, 2)) { rrect(g, ox + c * k + 2.5, oy + r * k + 2.5, k - 5, k - 5, 3); g.stroke(); }
    g.setLineDash([]);
    /* hold and next */
    g.fillStyle = 'rgba(255,255,255,.05)'; rrect(g, 20, 14, 62, 50, 8); g.fill(); rrect(g, 250, 14, 62, 110, 8); g.fill();
    [[0, 0], [1, 0], [2, 0], [1, 1]].forEach(([c, r]) => { g.fillStyle = C(60, 1, 85, 285); g.fillRect(34 + c * 11, 28 + r * 11, 10, 10); });
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([c, r]) => { g.fillStyle = C(60, 1, 85, 50); g.fillRect(270 + c * 11, 28 + r * 11, 10, 10); });
    [[0, 0], [0, 1], [0, 2], [0, 3]].forEach(([c, r]) => { g.fillStyle = C(60, 1, 85, 190); g.fillRect(284 + c * 0, 70 + r * 11, 10, 10); });
  },

  defenders(g, W, H, C, neon, off) {
    g.fillStyle = 'rgba(220,230,255,.5)';
    [[20, 14], [90, 30], [150, 10], [230, 22], [290, 40], [60, 80], [270, 90]].forEach(([x, y]) => g.fillRect(x, y, 1.6, 1.6));
    /* the formation */
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
      const x = 52 + c * 29, y = 28 + r * 22, hh = [300, 175, 175, 95][r];
      neon(8, 60, hh);
      g.fillStyle = C(62, 1, 85, hh);
      if (r === 0) { g.beginPath(); g.ellipse(x, y, 8, 6, 0, 0, Math.PI * 2); g.fill(); }
      else if (r < 3) rrect(g, x - 8, y - 5, 16, 10, 3), g.fill();
      else { g.beginPath(); g.arc(x, y, 8, Math.PI, 0); g.lineTo(x + 8, y + 5); g.lineTo(x - 8, y + 5); g.fill(); }
    }
    off();
    /* the mystery ship */
    g.fillStyle = C(62, 1, 90, 330); g.beginPath(); g.ellipse(250, 12, 14, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = C(80, 1, 90, 330); g.beginPath(); g.ellipse(250, 9, 7, 5, 0, Math.PI, 0); g.fill();
    /* shields */
    g.fillStyle = C(52, 1, 70, 140);
    [40, 115, 190, 265].forEach((x, i) => { rrect(g, x, 128, 34, 20, 8); g.fill(); g.fillStyle = '#07050c'; g.fillRect(x + 12, 140, 10, 8); if (i === 1) g.fillRect(x + 5, 131, 6, 5); g.fillStyle = C(52, 1, 70, 140); });
    /* shots and the cannon */
    g.strokeStyle = '#f4fbff'; g.lineWidth = 2; g.beginPath(); g.moveTo(158, 122); g.lineTo(158, 98); g.stroke();
    g.strokeStyle = C(62, 1, 100, 30); g.beginPath(); g.moveTo(196, 80); g.lineTo(202, 86); g.lineTo(196, 92); g.lineTo(202, 98); g.stroke();
    neon(10, 60, 200);
    g.fillStyle = C(62, 1, 85, 200); rrect(g, 144, 160, 28, 9, 3); g.fill(); rrect(g, 150, 155, 16, 8, 3); g.fill(); g.fillRect(156, 148, 4, 9);
    off();
  },

  hopper(g, W, H, C, neon, off) {
    const rh = 22;
    g.fillStyle = C(20, 1, 55, 205); g.fillRect(0, 0, W, rh * 3);
    g.fillStyle = '#1b2a1e'; g.fillRect(0, rh * 3, W, rh); g.fillRect(0, rh * 7, W, 20);
    g.fillStyle = '#1b1f2a'; g.fillRect(0, rh * 4, W, rh * 3);
    g.fillStyle = 'rgba(255,255,255,.14)'; for (let x = 0; x < W; x += 40) { g.fillRect(x + 6, rh * 5 - 1, 20, 2); g.fillRect(x + 6, rh * 6 - 1, 20, 2); }
    /* logs and turtles */
    g.fillStyle = C(32, 1, 55, 28); rrect(g, 20, 4, 90, 14, 7); g.fill(); rrect(g, 160, 4, 70, 14, 7); g.fill();
    rrect(g, 70, rh + 4, 120, 14, 7); g.fill(); rrect(g, 240, rh + 4, 60, 14, 7); g.fill();
    g.fillStyle = C(42, 1, 55, 150);
    [[30, 2], [60, 2], [220, 2], [250, 2]].forEach(([x, r]) => { g.beginPath(); g.arc(x, rh * r + 11, 8, 0, Math.PI * 2); g.fill(); });
    /* traffic */
    [[30, 4, 190], [150, 4, 190], [80, 5, 30], [220, 6, 330]].forEach(([x, r, hh], i) => {
      neon(8, 55, hh); g.fillStyle = C(55, 1, 80, hh);
      rrect(g, x, rh * r + 4, i === 2 ? 44 : 24, 14, 5); g.fill();
    });
    off();
    /* homes with one filled */
    g.fillStyle = C(14, 0.9, 50, 205);
    [30, 100, 160, 220, 290].forEach(x => { rrect(g, x - 12, -8, 24, 20, 6); g.fill(); });
    /* the frog */
    neon(14, 60, 110);
    g.fillStyle = C(55, 1, 75, 110);
    g.beginPath(); g.ellipse(160, 160, 11, 13, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = C(55, 1, 75, 110); g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(151, 166); g.lineTo(144, 174); g.moveTo(169, 166); g.lineTo(176, 174); g.moveTo(152, 154); g.lineTo(145, 150); g.moveTo(168, 154); g.lineTo(175, 150); g.stroke();
    off();
    g.fillStyle = '#eaffe0'; g.beginPath(); g.arc(155, 149, 3.4, 0, Math.PI * 2); g.arc(165, 149, 3.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#10200a'; g.beginPath(); g.arc(155, 148, 1.5, 0, Math.PI * 2); g.arc(165, 148, 1.5, 0, Math.PI * 2); g.fill();
  },

  bubbles(g, W, H, C, neon, off) {
    const R = 14, cx = W / 2;
    const HUES = [352, 38, 130, 195, 265, 312];
    const bub = (x, y, c) => {
      const grd = g.createRadialGradient(x - 4, y - 5, 1, x, y, R);
      grd.addColorStop(0, `hsl(${HUES[c]},95%,78%)`); grd.addColorStop(1, `hsl(${HUES[c]},80%,42%)`);
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, R - 1, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(x - 5, y - 5, 2.4, 0, Math.PI * 2); g.fill();
    };
    const rows = ['0011233', '124410', '3320411', '40233'];
    rows.forEach((row, r) => [...row].forEach((ch, c) => bub(cx - (row.length * R) + R + c * 2 * R, 18 + r * R * 1.73, +ch)));
    /* the aim line and the launcher */
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(cx + i * 9, 150 - i * 12, 2, 0, Math.PI * 2); g.fill(); }
    neon(12, 55, 265);
    g.fillStyle = C(38, 0.9, 30, 265); g.beginPath(); g.arc(cx, 176, 22, Math.PI, 0); g.fill();
    g.save(); g.translate(cx, 168); g.rotate(0.5); g.fillStyle = C(50, 0.95, 40, 265); rrect(g, -6, -32, 12, 32, 4); g.fill(); g.restore();
    off();
    bub(cx, 160, 2);
  },

  gems(g, W, H, C, neon, off) {
    const HU = [352, 28, 52, 128, 200, 282], k = 30, ox = 100, oy = 14;
    const rows = ['0132', '2041', '1503', '3214', '4025', '0351'];
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      const x = ox + c * k + k / 2, y = oy + r * k + k / 2, hh = HU[+ch];
      g.fillStyle = 'rgba(255,255,255,.05)'; rrect(g, ox + c * k + 1, oy + r * k + 1, k - 2, k - 2, 5); g.fill();
      g.fillStyle = `hsl(${hh},85%,58%)`;
      g.beginPath();
      if (+ch % 3 === 0) g.arc(x, y, 10, 0, Math.PI * 2);
      else if (+ch % 3 === 1) { g.moveTo(x, y - 11); g.lineTo(x + 11, y); g.lineTo(x, y + 11); g.lineTo(x - 11, y); g.closePath(); }
      else rrect(g, x - 9, y - 9, 18, 18, 5);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(x - 3, y - 4, 2.2, 0, Math.PI * 2); g.fill();
    }));
    neon(14, 70, 50); g.strokeStyle = 'rgba(255,230,140,.95)'; g.lineWidth = 2.5; rrect(g, ox + 1 * k + 2, oy + 2 * k + 2, k * 2 - 4, k - 4, 8); g.stroke(); off();
  },

  sudoku(g, W, H, C, neon, off) {
    const k = 17, ox = 80, oy = 12;
    g.fillStyle = '#0d1020'; rrect(g, ox - 4, oy - 4, k * 9 + 8, k * 9 + 8, 6); g.fill();
    g.strokeStyle = C(60, 0.25); g.lineWidth = 1;
    for (let i = 0; i <= 9; i++) { g.lineWidth = i % 3 ? 0.6 : 2; g.beginPath(); g.moveTo(ox + i * k, oy); g.lineTo(ox + i * k, oy + 9 * k); g.moveTo(ox, oy + i * k); g.lineTo(ox + 9 * k, oy + i * k); g.stroke(); }
    const nums = ['5.3.7....', '6..195...', '.98....6.', '8...6...3', '4..8.3..1', '7...2...6', '.6....28.', '...419..5', '....8..79'];
    g.font = '700 12px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    nums.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.') { g.fillStyle = (r + c) % 4 === 1 ? C(70, 1, 90, 40) : C(85); g.fillText(ch, ox + c * k + k / 2, oy + r * k + k / 2 + 1); } }));
    neon(10, 60); g.strokeStyle = C(65); g.lineWidth = 2; g.strokeRect(ox + 3 * k + 1, oy + 4 * k + 1, k - 2, k - 2); off();
  },

  nonogram(g, W, H, C, neon, off) {
    const pic = ['.#.#.', '#####', '#####', '.###.', '..#..'], k = 22, ox = 130, oy = 48;
    g.font = '700 11px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = C(80);
    const cols = ['1 1', '3', '4', '3', '1 1'], rws = ['1 1', '5', '5', '3', '1'];
    pic.forEach((row, r) => { g.fillText(rws[r], ox - 18, oy + r * k + k / 2); });
    cols.forEach((t, c) => { t.split(' ').forEach((n, i, a) => g.fillText(n, ox + c * k + k / 2, oy - 8 - (a.length - 1 - i) * 12)); });
    pic.forEach((row, r) => [...row].forEach((ch, c) => {
      g.fillStyle = ch === '#' ? C(60) : 'rgba(255,255,255,.06)';
      if (ch === '#') neon(8, 60);
      rrect(g, ox + c * k + 1, oy + r * k + 1, k - 2, k - 2, 3); g.fill(); off();
    }));
  },

  wordsearch(g, W, H, C, neon, off) {
    const rows = ['QWLIONK', 'XEAGLEB', 'OTIGERA', 'WZEBRAT', 'LMOOSEE', 'PANDAYM'], k = 24, ox = 76, oy = 12;
    g.font = '700 14px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    neon(10, 60); g.strokeStyle = C(62, 0.9); g.lineWidth = 15; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ox + 2 * k + 12, oy + 12); g.lineTo(ox + 5 * k + 12, oy + 12); g.stroke(); off();
    g.strokeStyle = C(55, 0.55, 100, 160); g.lineWidth = 15;
    g.beginPath(); g.moveTo(ox + 1 * k + 12, oy + 2 * k + 12); g.lineTo(ox + 5 * k + 12, oy + 2 * k + 12); g.stroke();
    rows.forEach((row, r) => [...row].forEach((ch, c) => { g.fillStyle = C(92); g.fillText(ch, ox + c * k + 12 + 18, oy + r * k + 13 + 22); }));
    g.fillStyle = C(80); g.font = '600 11px Inter,system-ui,sans-serif'; g.textAlign = 'left';
    ['LION', 'EAGLE', 'TIGER'].forEach((t, i) => g.fillText(t, 20, 40 + i * 16));
  },

  hangman(g, W, H, C, neon, off) {
    /* the gallows, a smiling figure with a few parts, and the word's blanks */
    const cx = W / 2, by = H - 52;
    neon(24, 40);
    g.strokeStyle = '#d9a86c'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(cx - 80, by); g.lineTo(cx - 80, 24); g.lineTo(cx - 28, 24); g.moveTo(cx - 80, 50); g.lineTo(cx - 58, 24); g.stroke();
    g.beginPath(); g.moveTo(cx - 100, by + 2); g.lineTo(cx - 40, by + 2); g.stroke();
    off();
    g.strokeStyle = '#f0d9a8'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 28, 24); g.lineTo(cx - 28, 38); g.stroke();
    g.fillStyle = '#ffcf6b'; g.strokeStyle = '#ffcf6b'; g.lineWidth = 6;
    g.beginPath(); g.arc(cx - 28, 52, 14, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(cx - 28, 66); g.lineTo(cx - 28, 104); g.moveTo(cx - 28, 76); g.lineTo(cx - 46, 92); g.moveTo(cx - 28, 76); g.lineTo(cx - 10, 92); g.stroke();
    g.fillStyle = '#3a2a14'; g.beginPath(); g.arc(cx - 33, 50, 1.8, 0, Math.PI * 2); g.arc(cx - 23, 50, 1.8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2a14'; g.lineWidth = 1.6; g.beginPath(); g.arc(cx - 28, 54, 6, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.font = '800 26px Inter,system-ui,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    'GA_ME'.split('').forEach((ch, i) => {
      const x = cx + 14 + i * 26;
      g.fillStyle = '#8cf0b0'; if (ch !== '_') g.fillText(ch, x, by - 12);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x, by - 6, 20, 3);
    });
  },

  mahjong(g, W, H, C, neon, off) {
    const tile = (x, y, w, h, draw) => {
      g.fillStyle = '#1f7a68'; rrect(g, x - 4, y + 4, w, h, 5); g.fill();
      g.fillStyle = '#f7ecd2'; rrect(g, x, y, w, h, 5); g.fill();
      g.strokeStyle = 'rgba(80,60,30,.5)'; g.lineWidth = 1; g.stroke();
      draw(x + w / 2, y + h / 2);
    };
    const w = 44, hh = 58, ox = (W - 5 * w) / 2, oy = 34;
    neon(18, 50);
    for (let i = 0; i < 5; i++) tile(ox + i * (w + 2) - 4, oy + 28, w, hh, (cx, cy) => {
      g.fillStyle = ['#1b6f8a', '#2b7a3d', '#b8322d', '#1b6f8a', '#2b7a3d'][i];
      if (i % 3 === 0) { g.beginPath(); g.arc(cx, cy, 12, 0, Math.PI * 2); g.fill(); g.fillStyle = '#f7ecd2'; g.beginPath(); g.arc(cx, cy, 6.5, 0, Math.PI * 2); g.fill(); }
      else if (i % 3 === 1) { rrect(g, cx - 5, cy - 16, 10, 32, 4); g.fill(); g.fillStyle = '#f7ecd2'; g.fillRect(cx - 5, cy - 2, 10, 4); }
      else { g.beginPath(); g.moveTo(cx, cy - 16); g.quadraticCurveTo(cx + 14, cy - 3, cx, cy + 16); g.quadraticCurveTo(cx - 14, cy - 3, cx, cy - 16); g.fill(); }
    });
    off();
    for (let i = 0; i < 3; i++) tile(ox + 44 + i * (w + 2), oy - 4, w, hh, (cx, cy) => {
      g.fillStyle = ['#c4302b', '#d94f7a', '#e08a1e'][i]; g.beginPath(); g.arc(cx, cy - 2, 12 - i, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(cx, cy - 2, 4, 0, Math.PI * 2); g.fill();
    });
  },

  fivedice(g, W, H, C, neon, off) {
    const s = 56, ox = [38, 112, 186, 252], oy = [46, 24, 58, 28], rot = [-0.18, 0.12, -0.06, 0.2], val = [5, 3, 6, 2];
    const pips = { 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
    for (let i = 0; i < 4; i++) {
      const held = i === 0 || i === 2;
      g.save();
      g.translate(ox[i] + s / 2, oy[i] + s / 2 + 28);
      g.rotate(rot[i]);
      held ? neon(18, 60) : neon(8, 30);
      const gr = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, held ? '#bfe6ff' : '#d6d8e4');
      g.fillStyle = gr;
      rrect(g, -s / 2, -s / 2, s, s, 10); g.fill();
      off();
      if (held) { g.strokeStyle = C(62, 1); g.lineWidth = 3; rrect(g, -s / 2, -s / 2, s, s, 10); g.stroke(); }
      g.fillStyle = '#1c1f33';
      for (const [dx, dy] of pips[val[i]]) { g.beginPath(); g.arc(dx * s * 0.25, dy * s * 0.25, s * 0.085, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    g.fillStyle = C(70, 0.9);
    for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(W / 2 + (k - 1) * 14, H - 16, 4, 0, Math.PI * 2); g.fill(); }
  },

  dominoes(g, W, H, C, neon, off) {
    const PIPS = { 0: [], 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]] };
    const tile = (cx, cy, a, b, w = 56, hh = 28, vert = false) => {
      g.save();
      g.translate(cx, cy);
      if (vert) g.rotate(Math.PI / 2);
      neon(10, 40);
      g.fillStyle = '#f3efe2';
      rrect(g, -w / 2, -hh / 2, w, hh, 5); g.fill();
      off();
      g.strokeStyle = 'rgba(28,31,51,.45)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -hh * 0.36); g.lineTo(0, hh * 0.36); g.stroke();
      g.fillStyle = '#1c1f33';
      [[-w / 4, a], [w / 4, b]].forEach(([x, v]) => { for (const [dx, dy] of PIPS[v]) { g.beginPath(); g.arc(x + dx * 6.5, dy * 6.5, 2.2, 0, Math.PI * 2); g.fill(); } });
      g.restore();
    };
    tile(W / 2 - 62, H / 2 - 4, 6, 3); tile(W / 2 - 4, H / 2 - 4, 3, 3, 28, 56 / 2, false); tile(W / 2 + 52, H / 2 - 4, 3, 5); tile(W / 2 + 108, H / 2 + 24, 5, 1, 56, 28, false);
    tile(W / 2 - 40, H / 2 + 44, 2, 4); tile(W / 2 + 22, H / 2 + 50, 0, 6);
  },

  go(g, W, H, C, neon, off) {
    const n = 9, k = 17, ox = (W - (n - 1) * k) / 2, oy = (H - (n - 1) * k) / 2;
    g.fillStyle = 'rgba(70,90,150,.55)';
    rrect(g, ox - 14, oy - 14, (n - 1) * k + 28, (n - 1) * k + 28, 8); g.fill();
    g.strokeStyle = 'rgba(205,218,255,.55)'; g.lineWidth = 1;
    for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(ox + i * k, oy); g.lineTo(ox + i * k, oy + (n - 1) * k); g.moveTo(ox, oy + i * k); g.lineTo(ox + (n - 1) * k, oy + i * k); g.stroke(); }
    const rows = ['.........', '..xo.....', '.xxoo....', '..xo.o...', '.xxxooo..', '..o.xx...', '...oox...', '..o.x....', '.........'];
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === '.') return;
      const x = ox + c * k, y = oy + r * k, light = ch === 'o';
      const gr = g.createRadialGradient(x - 3, y - 4, 1, x, y, k * 0.48);
      gr.addColorStop(0, light ? '#fff' : '#5a5d78'); gr.addColorStop(1, light ? '#cfc9b8' : '#06060b');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, k * 0.47, 0, Math.PI * 2); g.fill();
    }));
    neon(10, 70); g.strokeStyle = '#ff4d6d'; g.lineWidth = 2; g.beginPath(); g.arc(ox + 4 * k, oy + 5 * k, k * 0.22, 0, Math.PI * 2); g.stroke(); off();
  },

  gomoku(g, W, H, C, neon, off) {
    const n = 11, k = 14, ox = (W - (n - 1) * k) / 2, oy = (H - (n - 1) * k) / 2;
    g.fillStyle = 'rgba(70,90,150,.55)';
    rrect(g, ox - 12, oy - 12, (n - 1) * k + 24, (n - 1) * k + 24, 8); g.fill();
    g.strokeStyle = 'rgba(205,218,255,.5)'; g.lineWidth = 1;
    for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(ox + i * k, oy); g.lineTo(ox + i * k, oy + (n - 1) * k); g.moveTo(ox, oy + i * k); g.lineTo(ox + (n - 1) * k, oy + i * k); g.stroke(); }
    const stones = [[3, 3, 0], [4, 4, 1], [5, 5, 0], [6, 6, 1], [4, 6, 0], [3, 7, 1], [5, 3, 1], [6, 4, 0], [7, 5, 1], [5, 6, 0], [6, 7, 0], [4, 5, 1], [7, 7, 1], [8, 8, 1]];
    stones.forEach(([c, r, light]) => {
      const x = ox + c * k, y = oy + r * k;
      const gr = g.createRadialGradient(x - 2, y - 3, 1, x, y, k * 0.46);
      gr.addColorStop(0, light ? '#fff' : '#5a5d78'); gr.addColorStop(1, light ? '#cfc9b8' : '#06060b');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, k * 0.44, 0, Math.PI * 2); g.fill();
    });
    neon(14, 65, 50); g.strokeStyle = '#ffd23f'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(ox + 3 * k, oy + 3 * k); g.lineTo(ox + 7 * k, oy + 7 * k); g.stroke(); off();
  },

  reversi(g, W, H, C, neon, off) {
    const k = 22, ox = (W - 8 * k) / 2, oy = (H - 8 * k) / 2 + 4;
    neon(24, 45);
    g.fillStyle = '#176b44'; rrect(g, ox - 6, oy - 6, 8 * k + 12, 8 * k + 12, 8); g.fill();
    off();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(ox + i * k, oy); g.lineTo(ox + i * k, oy + 8 * k); g.moveTo(ox, oy + i * k); g.lineTo(ox + 8 * k, oy + i * k); g.stroke(); }
    const rows = ['........', '........', '..oxx...', '..xxo...', '.oooxx..', '..xo....', '........', '........'];
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === '.') return;
      const x = ox + (c + 0.5) * k, y = oy + (r + 0.5) * k;
      const gr = g.createRadialGradient(x - 3, y - 4, 1, x, y, k * 0.42);
      gr.addColorStop(0, ch === 'x' ? '#555873' : '#fff'); gr.addColorStop(1, ch === 'x' ? '#0b0b11' : '#cdc7b8');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, k * 0.4, 0, Math.PI * 2); g.fill();
    }));
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (const [r, c] of [[2, 5], [4, 6], [5, 4], [4, 1]]) { g.beginPath(); g.arc(ox + (c + 0.5) * k, oy + (r + 0.5) * k, 3, 0, Math.PI * 2); g.fill(); }
  },

  checkers(g, W, H, C, neon, off) {
    const k = 22, ox = (W - 8 * k) / 2, oy = (H - 8 * k) / 2 + 4;
    neon(18, 50);
    g.fillStyle = '#3a2a22'; rrect(g, ox - 6, oy - 6, 8 * k + 12, 8 * k + 12, 8); g.fill();
    off();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { g.fillStyle = (r + c) % 2 ? '#6b4a37' : '#e4d2ac'; g.fillRect(ox + c * k, oy + r * k, k, k); }
    const piece = (r, c, red, king) => {
      const x = ox + (c + 0.5) * k, y = oy + (r + 0.5) * k;
      const gr = g.createRadialGradient(x - 3, y - 4, 1, x, y, k * 0.4);
      gr.addColorStop(0, red ? '#ff8a93' : '#fff'); gr.addColorStop(1, red ? '#a81f2e' : '#cdbf9c');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, k * 0.38, 0, Math.PI * 2); g.fill();
      if (king) { g.fillStyle = '#ffd84d'; g.beginPath(); g.moveTo(x - 5, y + 3); g.lineTo(x - 6, y - 3); g.lineTo(x - 2, y); g.lineTo(x, y - 5); g.lineTo(x + 2, y); g.lineTo(x + 6, y - 3); g.lineTo(x + 5, y + 3); g.fill(); }
    };
    for (const [r, c] of [[0, 1], [0, 5], [1, 2], [1, 6], [2, 3]]) piece(r, c, false, false);
    for (const [r, c] of [[5, 0], [5, 4], [6, 3], [7, 2]]) piece(r, c, true, false);
    piece(4, 5, true, true); piece(3, 4, false, true);
    g.strokeStyle = 'rgba(255,230,120,.9)'; g.lineWidth = 2; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(ox + 5.5 * k, oy + 4.5 * k); g.lineTo(ox + 3.5 * k, oy + 2.5 * k); g.lineTo(ox + 1.5 * k, oy + 0.5 * k); g.stroke(); g.setLineDash([]);
  },

  battleship(g, W, H, C, neon, off) {
    /* two seas: pegs on the left, a fleet on the right */
    const k = 17, grid = (ox, oy) => {
      g.fillStyle = '#0a2c52'; rrect(g, ox - 3, oy - 3, k * 8 + 6, k * 8 + 6, 6); g.fill();
      g.strokeStyle = 'rgba(150,210,255,.25)'; g.lineWidth = 1; g.beginPath();
      for (let i = 0; i <= 8; i++) { g.moveTo(ox + i * k, oy); g.lineTo(ox + i * k, oy + 8 * k); g.moveTo(ox, oy + i * k); g.lineTo(ox + 8 * k, oy + i * k); }
      g.stroke();
    };
    grid(14, 22); grid(170, 22);
    const peg = (x, y, hit) => { g.fillStyle = hit ? '#ff5a3c' : 'rgba(235,245,255,.85)'; g.beginPath(); g.arc(x, y, hit ? 5.5 : 3, 0, 7); g.fill(); };
    [[1, 1, 0], [3, 2, 0], [5, 5, 0], [2, 6, 0], [6, 1, 0], [4, 3, 1], [4, 4, 1], [4, 5, 1], [1, 4, 1]].forEach(([c, r, h]) => peg(14 + (c + 0.5) * k, 22 + (r + 0.5) * k, h));
    const ship = (c, r, len, v) => { g.fillStyle = '#8fa6bd'; g.strokeStyle = '#1d2a3a'; g.lineWidth = 1.5; rrect(g, 170 + c * k + 2, 22 + r * k + 3, v ? k - 4 : len * k - 4, v ? len * k - 4 : k - 6, 5); g.fill(); g.stroke(); };
    ship(0, 1, 4, 0); ship(5, 0, 3, 1); ship(1, 4, 3, 0); ship(6, 5, 2, 1); ship(2, 7, 2, 0);
    neon(12, 60, 20); peg(170 + 2.5 * k, 22 + 1.5 * k, 1); peg(170 + 6.5 * k, 22 + 5.5 * k, 1); off();
    g.fillStyle = C(80, 1, 90, 205); g.font = '700 10px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('ENEMY', 14 + 4 * k, 16); g.fillText('YOU', 170 + 4 * k, 16);
  },

  minigolf(g, W, H, C, neon, off) {
    g.fillStyle = '#133318'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2e8b3e'; rrect(g, 24, 30, 272, 120, 10); g.fill();
    g.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 24; x < 296; x += 40) g.fillRect(x, 30, 20, 120);
    g.fillStyle = '#d8c079'; rrect(g, 120, 30, 46, 52, 6); g.fill();
    g.fillStyle = '#2b7fd1'; rrect(g, 190, 94, 56, 56, 6); g.fill();
    g.strokeStyle = '#a8703a'; g.lineWidth = 6; rrect(g, 24, 30, 272, 120, 10); g.stroke();
    g.save(); g.translate(150, 110); g.rotate(0.5); g.lineWidth = 6;
    [0, 1, 2, 3].forEach(i => { g.rotate(Math.PI / 2); g.strokeStyle = i % 2 ? '#fff4e0' : '#e23d3d'; g.beginPath(); g.moveTo(0, 0); g.lineTo(26, 0); g.stroke(); });
    g.restore();
    g.fillStyle = '#05080a'; g.beginPath(); g.arc(262, 66, 7, 0, 7); g.fill();
    g.strokeStyle = '#f4f4f4'; g.lineWidth = 2; g.beginPath(); g.moveTo(262, 66); g.lineTo(262, 36); g.stroke();
    g.fillStyle = '#ff4d5e'; g.beginPath(); g.moveTo(262, 36); g.lineTo(278, 42); g.lineTo(262, 48); g.fill();
    g.setLineDash([5, 5]); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(66, 100); g.lineTo(110, 70); g.stroke(); g.setLineDash([]);
    neon(10, 80, 130); g.fillStyle = '#fff'; g.beginPath(); g.arc(54, 108, 6, 0, 7); g.fill(); off();
  },

  pinball(g, W, H, C, neon, off) {
    neon(16, 55, 270); g.strokeStyle = C(55, 1, 90, 270); g.lineWidth = 4;
    g.beginPath(); g.moveTo(96, 170); g.lineTo(96, 60); g.quadraticCurveTo(96, 8, 160, 8); g.quadraticCurveTo(224, 8, 224, 60); g.lineTo(224, 170); g.stroke(); off();
    [[130, 62, 15], [190, 62, 15], [160, 104, 15]].forEach(([x, y, r]) => { neon(14, 60, 330); const gr = g.createRadialGradient(x - 4, y - 4, 1, x, y, r); gr.addColorStop(0, '#ffb3dc'); gr.addColorStop(1, '#b3146b'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); off(); });
    g.strokeStyle = '#3ad6ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(96, 140); g.lineTo(130, 162); g.moveTo(224, 140); g.lineTo(190, 162); g.stroke();
    g.lineCap = 'round'; g.lineWidth = 9; g.strokeStyle = '#5b6fe0'; g.beginPath(); g.moveTo(132, 164); g.lineTo(152, 156); g.moveTo(188, 164); g.lineTo(168, 156); g.stroke();
    g.fillStyle = '#ffd23f'; [[118, 26], [160, 18], [202, 26]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); });
    g.fillStyle = '#fff'; g.beginPath(); g.arc(176, 128, 5, 0, 7); g.fill();
  },

  /* sports and head-to-head */
  snakebattle(g, W, H, C, neon, off) {
    g.fillStyle = '#071a18'; rrect(g, 20, 20, 280, 140, 10); g.fill();
    g.strokeStyle = C(60, 0.5, 70, 170); g.lineWidth = 2; rrect(g, 20, 20, 280, 140, 10); g.stroke();
    g.fillStyle = 'rgba(120,255,220,.05)'; for (let x = 20; x < 300; x += 20) for (let y = 20; y < 160; y += 20) if (((x + y) / 20) & 1) g.fillRect(x, y, 20, 20);
    const snake = (pts, hh) => {
      neon(12, 55, hh);
      for (const [w, l, a] of [[15, 26, 1], [11, 52, 1], [3.5, 74, 0.7]]) {
        g.strokeStyle = `hsla(${hh},80%,${l}%,${a})`; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); off();
      }
      const [hx, hy] = pts[0]; g.fillStyle = `hsl(${hh},80%,58%)`; g.beginPath(); g.arc(hx, hy, 9, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(hx + 3, hy - 3, 2.6, 0, 7); g.arc(hx + 3, hy + 3, 2.6, 0, 7); g.fill();
      g.fillStyle = '#0a1210'; g.beginPath(); g.arc(hx + 4, hy - 3, 1.2, 0, 7); g.arc(hx + 4, hy + 3, 1.2, 0, 7); g.fill();
    };
    snake([[150, 70], [120, 70], [90, 70], [60, 70], [60, 105], [90, 125], [128, 125]], 140);
    snake([[170, 110], [200, 110], [236, 110], [260, 110], [260, 70], [236, 45], [200, 45]], 330);
    neon(14, 60, 5); g.fillStyle = '#ff4a5a'; g.beginPath(); g.arc(160, 90, 7, 0, 7); g.fill(); off();
  },
  airhockey(g, W, H, C, neon, off) {
    g.fillStyle = '#0b2036'; rrect(g, 16, 16, 288, 148, 20); g.fill();
    g.strokeStyle = C(70, 0.55, 80, 200); g.lineWidth = 3; rrect(g, 16, 16, 288, 148, 20); g.stroke();
    g.strokeStyle = 'rgba(255,90,90,.55)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(160, 18); g.lineTo(160, 162); g.stroke();
    g.beginPath(); g.arc(160, 90, 26, 0, 7); g.stroke();
    g.fillStyle = '#010305'; g.fillRect(12, 60, 8, 60); g.fillRect(300, 60, 8, 60);
    const mallet = (x, y, hh) => {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(x + 2, y + 3, 17, 0, 7); g.fill();
      neon(16, 55, hh); g.fillStyle = `hsl(${hh},90%,55%)`; g.beginPath(); g.arc(x, y, 17, 0, 7); g.fill(); off();
      g.strokeStyle = `hsl(${hh},100%,32%)`; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 10.5, 0, 7); g.stroke();
      g.fillStyle = `hsl(${hh},80%,86%)`; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
    };
    mallet(70, 100, 200); mallet(250, 72, 22);
    g.strokeStyle = 'rgba(255,230,190,.3)'; g.setLineDash([4, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(92, 96); g.lineTo(190, 86); g.stroke(); g.setLineDash([]);
    neon(10, 60, 40); g.fillStyle = '#16181d'; g.beginPath(); g.arc(196, 85, 9, 0, 7); g.fill(); off();
    g.strokeStyle = '#f2b24a'; g.lineWidth = 2; g.beginPath(); g.arc(196, 85, 6, 0, 7); g.stroke();
  },
  bowling(g, W, H, C, neon, off) {
    const wood = g.createLinearGradient(80, 0, 240, 0); wood.addColorStop(0, '#9a6a34'); wood.addColorStop(0.5, '#d6a45e'); wood.addColorStop(1, '#9a6a34');
    g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
    g.fillStyle = wood; g.beginPath(); g.moveTo(120, 8); g.lineTo(200, 8); g.lineTo(256, 172); g.lineTo(64, 172); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(60,35,15,.4)'; g.lineWidth = 1; for (let i = 1; i < 8; i++) { const t = i / 8; g.beginPath(); g.moveTo(120 + 80 * t, 8); g.lineTo(64 + 192 * t, 172); g.stroke(); }
    g.fillStyle = '#12161c'; g.beginPath(); g.moveTo(112, 8); g.lineTo(120, 8); g.lineTo(64, 172); g.lineTo(44, 172); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(200, 8); g.lineTo(208, 8); g.lineTo(276, 172); g.lineTo(256, 172); g.closePath(); g.fill();
    const pin = (x, y, r) => { g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(x + 1.5, y + 2, r, 0, 7); g.fill(); g.fillStyle = '#fbfaf5'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = '#d3321f'; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, r * 0.62, 0, 7); g.stroke(); };
    [[160, 24], [152, 17], [168, 17], [144, 10], [160, 10], [176, 10]].forEach(([x, y]) => pin(x, y + 8, 5.2));
    neon(12, 55, 220); const bg2 = g.createRadialGradient(150, 134, 2, 154, 138, 22); bg2.addColorStop(0, '#6aa0ff'); bg2.addColorStop(0.6, '#1d3f9a'); bg2.addColorStop(1, '#0a1740');
    g.fillStyle = bg2; g.beginPath(); g.arc(154, 138, 22, 0, 7); g.fill(); off();
    g.fillStyle = 'rgba(2,6,20,.85)'; [[-6, -8], [6, -8], [0, 4]].forEach(([x, y]) => { g.beginPath(); g.arc(154 + x, 138 + y, 2.8, 0, 7); g.fill(); });
    g.setLineDash([5, 5]); g.strokeStyle = 'rgba(255,230,160,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(154, 116); g.quadraticCurveTo(160, 70, 160, 40); g.stroke(); g.setLineDash([]);
  },
  basketball(g, W, H, C, neon, off) {
    const wall = g.createLinearGradient(0, 0, 0, 150); wall.addColorStop(0, '#120b1f'); wall.addColorStop(1, '#2a1830'); g.fillStyle = wall; g.fillRect(0, 0, W, H);
    const fl = g.createLinearGradient(0, 150, 0, H); fl.addColorStop(0, '#c98d4e'); fl.addColorStop(1, '#8a5a2e'); g.fillStyle = fl; g.fillRect(0, 150, W, H - 150);
    g.fillStyle = 'rgba(200,230,255,.35)'; g.fillRect(246, 30, 6, 64); g.strokeStyle = 'rgba(255,90,60,.9)'; g.lineWidth = 2; g.strokeRect(226, 56, 20, 22);
    g.fillStyle = '#4b4f5a'; g.fillRect(266, 40, 6, 112); g.fillRect(240, 80, 30, 4);
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i <= 6; i++) { const t = i / 6 - 0.5; g.moveTo(204 + t * 40, 86); g.quadraticCurveTo(204 + t * 26, 98, 204 + t * 16, 108); } g.stroke();
    neon(8, 55, 20); g.strokeStyle = '#e0561a'; g.lineWidth = 4; g.beginPath(); g.ellipse(204, 86, 20, 4, 0, 0, 7); g.stroke(); off();
    g.setLineDash([4, 5]); g.strokeStyle = 'rgba(255,200,120,.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(62, 100); g.quadraticCurveTo(130, -10, 204, 84); g.stroke(); g.setLineDash([]);
    neon(10, 60, 22); const bl = g.createRadialGradient(150, 22, 1, 154, 28, 14); bl.addColorStop(0, '#ffb066'); bl.addColorStop(1, '#c4531a'); g.fillStyle = bl; g.beginPath(); g.arc(152, 26, 13, 0, 7); g.fill(); off();
    g.strokeStyle = 'rgba(60,20,5,.8)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(139, 26); g.lineTo(165, 26); g.moveTo(152, 13); g.lineTo(152, 39); g.stroke();
    g.fillStyle = '#3a8fd6'; rrect(g, 44, 104, 26, 40, 6); g.fill(); g.fillStyle = '#e0b48a'; g.beginPath(); g.arc(58, 94, 9, 0, 7); g.fill();
    g.strokeStyle = '#3a2a22'; g.lineWidth = 6; g.beginPath(); g.moveTo(52, 144); g.lineTo(50, 168); g.moveTo(64, 144); g.lineTo(68, 168); g.stroke();
    g.fillStyle = 'rgba(8,6,12,.7)'; rrect(g, 12, 40, 16, 96, 6); g.fill(); g.fillStyle = 'rgba(255,190,60,.4)'; g.fillRect(14, 70, 12, 24); g.fillStyle = 'rgba(70,230,110,.9)'; g.fillRect(14, 76, 12, 12); g.fillStyle = '#fff'; g.fillRect(12, 80, 16, 3);
  },

  skyhop(g, W, H, C, neon, off) {
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#1a2a6c'); sky.addColorStop(1, '#58b8e0'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.7)'; [[30, 20], [90, 50], [250, 30], [290, 80], [200, 12]].forEach(([x, y]) => g.fillRect(x, y, 2, 2));
    const cloud = (x, y, w, c1, c2) => { const gr = g.createLinearGradient(0, y - 6, 0, y + 6); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; rrect(g, x, y - 6, w, 12, 6); g.fill(); g.beginPath(); g.arc(x + w * 0.3, y - 6, 7, 0, 7); g.arc(x + w * 0.6, y - 8, 9, 0, 7); g.fill(); };
    cloud(40, 160, 80, '#fff', '#b9d4ee'); cloud(190, 130, 80, '#b9f0ff', '#58b8e0'); cloud(80, 96, 80, '#d9b48a', '#8a6038'); cloud(220, 62, 80, '#fff', '#b9d4ee');
    g.strokeStyle = '#d7d7e6'; g.lineWidth = 2; g.beginPath(); g.moveTo(244, 60); for (let i = 0; i < 3; i++) { g.lineTo(256, 56 - i * 3); g.lineTo(244, 54 - i * 3); } g.stroke();
    g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(160, 60); g.lineTo(160, 118); g.stroke(); g.setLineDash([]);
    neon(14, 60, 110); g.fillStyle = '#7be07b'; g.beginPath(); g.ellipse(160, 46, 14, 15, 0, 0, 7); g.fill(); off();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(156, 40, 4.5, 0, 7); g.arc(166, 40, 4.5, 0, 7); g.fill(); g.fillStyle = '#10200a'; g.beginPath(); g.arc(157, 40, 2, 0, 7); g.arc(167, 40, 2, 0, 7); g.fill();
  },

  jumper(g, W, H, C, neon, off) {
    /* Pip on a grassy ledge, a spike bed, a spark and the beacon */
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#5db4ec'); sky.addColorStop(1, '#d9f1ff'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#a8dca0'; g.beginPath(); g.moveTo(0, 120); g.lineTo(70, 70); g.lineTo(140, 120); g.lineTo(210, 60); g.lineTo(290, 120); g.lineTo(320, 100); g.lineTo(320, 160); g.lineTo(0, 160); g.fill();
    const tile = (x, y) => { g.fillStyle = '#86603a'; g.fillRect(x, y, 24, 24); g.fillStyle = '#4fb840'; g.fillRect(x, y, 24, 7); g.fillStyle = '#7fe06c'; g.fillRect(x, y, 24, 3); };
    for (let x = 0; x < 110; x += 24) for (let y = 112; y < 160; y += 24) tile(x, y);
    for (let x = 190; x < 320; x += 24) for (let y = 112; y < 160; y += 24) tile(x, y);
    g.fillStyle = '#c9964f'; g.fillRect(116, 80, 56, 7); g.fillStyle = '#e6c07f'; g.fillRect(116, 80, 56, 2);
    g.fillStyle = '#dfe8f4'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(112 + i * 20, 160); g.lineTo(122 + i * 20, 138); g.lineTo(132 + i * 20, 160); g.fill(); }
    neon(10, 55, 45); g.fillStyle = '#ffd166'; g.beginPath(); g.moveTo(144, 52); g.lineTo(152, 62); g.lineTo(144, 72); g.lineTo(136, 62); g.closePath(); g.fill(); off();
    g.fillStyle = '#4b5470'; g.fillRect(278, 70, 4, 42); neon(14, 60, 45); g.fillStyle = '#ffd166'; g.beginPath(); g.arc(280, 66, 9, 0, 7); g.fill(); off();
    neon(12, 60, 175); g.fillStyle = '#38d6c4'; g.fillRect(48, 80, 26, 32); g.fillStyle = '#a8f5ea'; g.fillRect(52, 98, 18, 8); off();
    g.fillStyle = '#fff'; g.fillRect(58, 86, 12, 12); g.fillStyle = '#0d1b2a'; g.fillRect(64, 90, 6, 6);
    g.fillStyle = '#ffd166'; g.fillRect(58, 72, 6, 6); g.fillStyle = '#12625d'; g.fillRect(60, 76, 2, 5);
  },

  /* reflex games */
  chaser(g, W, H, C, neon, off) {
    /* a corner of the maze: raised neon slabs, dots, a pellet, a ghost and the silver bot */
    const slab = (x, y, w, h) => {
      g.fillStyle = C(20, 1, 80); rrect(g, x, y + 3, w, h, 9); g.fill();
      g.fillStyle = C(66, 1, 80); rrect(g, x, y - 1.5, w, h, 9); g.fill();
      g.fillStyle = C(38, 1, 80); rrect(g, x, y, w, h, 9); g.fill();
    };
    neon(16, 55); slab(24, 24, 120, 48); slab(176, 24, 120, 48); slab(24, 124, 272, 36); off();
    g.fillStyle = 'rgba(244,236,255,.85)';
    for (let x = 40; x < 300; x += 22) { if (x < 190 || x > 232) g.fillRect(x, 96, 4, 4); }
    neon(12, 70); g.strokeStyle = C(74, 1, 80); g.lineWidth = 2.5; g.beginPath(); g.arc(210, 98, 8, 0, Math.PI * 2); g.stroke(); off();
    g.fillStyle = '#f6f6f6'; g.beginPath(); g.arc(210, 98, 4.5, 0, Math.PI * 2); g.fill();
    neon(14, 60, 270); g.fillStyle = C(58, 1, 85, 270);
    g.beginPath(); g.arc(90, 96, 14, Math.PI, 0); g.lineTo(104, 112); g.lineTo(97, 108); g.lineTo(90, 112); g.lineTo(83, 108); g.lineTo(76, 112); g.closePath(); g.fill(); off();
    g.fillStyle = '#111'; g.fillRect(80, 91, 20, 7); g.fillStyle = '#fff'; g.fillRect(83, 93, 3, 3); g.fillRect(92, 93, 3, 3);
    neon(12, 80, 205); g.fillStyle = 'hsl(205,18%,88%)'; g.beginPath(); g.arc(254, 98, 15, 0, Math.PI * 2); g.fill(); off();
    g.fillStyle = 'hsl(205,14%,66%)'; g.beginPath(); g.arc(254, 102, 11, 0.15, Math.PI - 0.15); g.fill();
    g.strokeStyle = 'hsl(205,14%,70%)'; g.lineWidth = 2; g.beginPath(); g.moveTo(254, 83); g.lineTo(256, 76); g.stroke();
    g.fillStyle = C(66, 1, 80); g.beginPath(); g.arc(256, 75, 2.6, 0, 7); g.fill();
    g.fillStyle = '#10141c'; g.beginPath(); g.arc(252, 95, 2.6, 0, 7); g.arc(260, 95, 2.6, 0, 7); g.fill();
  },
  runner(g, W, H, C, neon, off) {
    /* mountains, the runner mid-jump, a spike and a drone */
    g.fillStyle = C(20, 0.8, 50, 230); g.beginPath(); g.moveTo(0, 130); g.lineTo(60, 70); g.lineTo(130, 130); g.lineTo(200, 60); g.lineTo(280, 130); g.lineTo(320, 100); g.lineTo(320, 150); g.lineTo(0, 150); g.fill();
    g.fillStyle = C(14, 0.8, 55, 140); g.fillRect(0, 150, W, H - 150);
    g.fillStyle = C(58, 1, 80, 120); g.fillRect(0, 150, W, 4);
    neon(10, 55, 20); g.fillStyle = C(55, 1, 100, 20);
    g.beginPath(); g.moveTo(222, 150); g.lineTo(236, 112); g.lineTo(250, 150); g.fill(); off();
    neon(10, 55, 350); g.fillStyle = C(55, 1, 90, 350); rrect(g, 240, 70, 50, 20, 9); g.fill(); off();
    neon(12, 60, 195); g.fillStyle = C(60, 1, 85, 195); rrect(g, 90, 84, 22, 30, 9); g.fill(); g.beginPath(); g.arc(103, 76, 10, 0, 7); g.fill();
    g.strokeStyle = C(60, 1, 85, 195); g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(98, 112); g.lineTo(86, 124); g.moveTo(106, 112); g.lineTo(122, 106); g.stroke(); off();
    g.strokeStyle = C(60, 0.9, 85, 345); g.lineWidth = 4; g.beginPath(); g.moveTo(92, 80); g.quadraticCurveTo(70, 84, 56, 76); g.stroke();
  },
  moles(g, W, H, C, neon, off) {
    /* a 3 x 3 lawn, one mole up and a mallet */
    for (let i = 0; i < 9; i++) {
      const x = 62 + (i % 3) * 98, y = 40 + Math.floor(i / 3) * 52;
      g.fillStyle = C(24, 0.9, 40, 28); g.beginPath(); g.ellipse(x, y + 4, 34, 13, 0, 0, 7); g.fill();
      g.fillStyle = C(8, 1, 40, 28); g.beginPath(); g.ellipse(x, y, 28, 10, 0, 0, 7); g.fill();
      if (i === 4) {
        g.fillStyle = C(36, 1, 45, 28); g.beginPath(); g.ellipse(x, y - 8, 20, 22, 0, Math.PI, 0); g.rect(x - 20, y - 8, 40, 10); g.fill();
        g.fillStyle = C(80, 1, 70, 350); g.beginPath(); g.arc(x, y - 14, 4, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 8, y - 22, 4, 0, 7); g.arc(x + 8, y - 22, 4, 0, 7); g.fill();
        g.fillStyle = '#111'; g.fillRect(x - 9, y - 23, 3, 3); g.fillRect(x + 7, y - 23, 3, 3);
      }
      g.fillStyle = C(30, 1, 40, 28); g.beginPath(); g.ellipse(x, y + 4, 34, 13, 0, 0, Math.PI); g.fill();
    }
    neon(8, 55, 30); g.save(); g.translate(236, 48); g.rotate(-0.6); g.fillStyle = C(40, 1, 35, 28); g.fillRect(-3, 0, 6, 46); g.fillStyle = C(46, 1, 50, 14); rrect(g, -15, -14, 30, 20, 5); g.fill(); g.restore(); off();
  },
  slicer(g, W, H, C, neon, off) {
    /* a fruit cut in two and a blade streak, a bomb below */
    for (const s of [-1, 1]) {
      g.save(); g.translate(150 + s * 14, 70 + s * 4); g.rotate(s * 0.5 + Math.PI / 2 * (s < 0 ? 0 : 0));
      g.fillStyle = C(40, 1, 50, 120); g.beginPath(); g.arc(0, 0, 34, s < 0 ? 0 : Math.PI, s < 0 ? Math.PI : 2 * Math.PI); g.fill();
      g.fillStyle = C(72, 1, 70, 350); g.beginPath(); g.arc(0, 0, 28, s < 0 ? 0 : Math.PI, s < 0 ? Math.PI : 2 * Math.PI); g.fill();
      g.restore();
    }
    neon(12, 90, 190); g.strokeStyle = C(92, 0.9, 80, 190); g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(60, 130); g.quadraticCurveTo(150, 60, 250, 20); g.stroke(); off();
    g.fillStyle = C(10, 1, 20, 230); g.beginPath(); g.arc(250, 142, 20, 0, 7); g.fill();
    g.strokeStyle = C(70, 0.9, 80, 35); g.lineWidth = 3; g.beginPath(); g.moveTo(252, 122); g.quadraticCurveTo(262, 110, 272, 114); g.stroke();
    g.fillStyle = C(60, 1, 60, 40); g.beginPath(); g.arc(272, 114, 4, 0, 7); g.fill();
    g.fillStyle = C(46, 1, 45, 120); g.beginPath(); g.arc(70, 150, 18, 0, 7); g.fill();
  },

  rhythm(g, W, H, C, neon, off) {
    /* four lanes of falling notes over a hit line */
    const x0 = 100, lw = 30;
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.08)'; g.fillRect(x0 + i * lw, 6, lw, H - 12); }
    [[0, 30], [2, 62], [1, 96], [3, 70], [0, 120], [2, 20]].forEach(([l, y], i) => { neon(10, 60, [350, 42, 140, 205][l]); g.fillStyle = `hsl(${[350, 42, 140, 205][l]},85%,58%)`; rrect(g, x0 + l * lw + 4, y, lw - 8, 12, 4); g.fill(); });
    off(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x0, 140); g.lineTo(x0 + 4 * lw, 140); g.stroke();
    g.fillStyle = C(80); g.font = '700 11px Inter,system-ui,sans-serif'; g.textAlign = 'center';
    ['D', 'F', 'J', 'K'].forEach((t, i) => g.fillText(t, x0 + i * lw + lw / 2, 158));
  },

  sliding(g, W, H, C, neon, off) {
    const k = 40, ox = 80, oy = 10, t = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 14, 0];
    g.font = '800 18px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    t.forEach((v, i) => { if (!v) return; const x = ox + (i % 4) * k, y = oy + Math.floor(i / 4) * k; g.fillStyle = `hsl(${(190 + (v % 4) * 30 + Math.floor(v / 4) * 28) % 360},62%,46%)`; rrect(g, x + 2, y + 2, k - 4, k - 4, 7); g.fill(); g.fillStyle = '#fff'; g.fillText(String(v), x + k / 2, y + k / 2 + 1); });
    neon(12, 60); g.strokeStyle = C(70, 0.9); g.lineWidth = 2; g.strokeRect(ox + 2 * k + 3, oy + 3 * k + 3, k - 6, k - 6); off();
  },

  lightsout(g, W, H, C, neon, off) {
    const k = 30, ox = 85, oy = 14, on = [1, 5, 6, 7, 11, 13, 17, 18, 19, 23];
    for (let i = 0; i < 25; i++) {
      const x = ox + (i % 5) * k, y = oy + Math.floor(i / 5) * k, lit = on.includes(i);
      if (lit) neon(14, 60, 48); else off();
      g.fillStyle = lit ? 'hsl(48,100%,62%)' : '#222736'; rrect(g, x + 2, y + 2, k - 4, k - 4, 6); g.fill();
    }
    off();
  },

  pipelink(g, W, H, C, neon, off) {
    /* a 5×5 board of coloured pipes and their dots */
    const k = 30, ox = 85, oy = 14, cols = [350, 205, 140, 48, 28];
    const paths = [[0, 5, 10, 15, 20], [1, 2, 3, 8, 13], [4, 9, 14, 19, 24], [6, 7, 12, 17, 22], [11, 16, 21]];
    g.fillStyle = 'rgba(255,255,255,.06)'; rrect(g, ox - 4, oy - 4, k * 5 + 8, k * 5 + 8, 8); g.fill();
    paths.forEach((p, i) => {
      neon(8, 50, cols[i]); g.strokeStyle = `hsl(${cols[i]},85%,58%)`; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      p.forEach((c, j) => { const x = ox + (c % 5) * k + k / 2, y = oy + Math.floor(c / 5) * k + k / 2; j ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      off(); g.fillStyle = `hsl(${cols[i]},85%,66%)`;
      [p[0], p[p.length - 1]].forEach(c => { g.beginPath(); g.arc(ox + (c % 5) * k + k / 2, oy + Math.floor(c / 5) * k + k / 2, 10, 0, 7); g.fill(); });
    });
  },

  jigsaw(g, W, H, C, neon, off) {
    /* a picture cut into pieces, one lifted out */
    const k = 46, ox = 84, oy = 20;
    for (let i = 0; i < 9; i++) {
      const x = ox + (i % 3) * k, y = oy + Math.floor(i / 3) * k;
      if (i === 4) continue;
      g.fillStyle = `hsl(${(200 + i * 22) % 360},60%,${42 + (i % 3) * 8}%)`; rrect(g, x + 1, y + 1, k - 2, k - 2, 6); g.fill();
      g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(x + k, y + k / 2, 7, 0, 7); g.fill();
    }
    neon(14, 60, 25); g.save(); g.translate(ox + 1.5 * k + 22, oy + 1.5 * k - 30); g.rotate(0.22);
    g.fillStyle = 'hsl(30,75%,56%)'; rrect(g, -k / 2, -k / 2, k, k, 7); g.fill(); g.beginPath(); g.arc(k / 2, 0, 9, 0, 7); g.fill(); g.restore(); off();
  },

  clicker(g, W, H, C, neon, off) {
    /* a button in a haze of static, with a signal line climbing */
    const r = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.2})`; g.fillRect(r() * W, r() * H, 3, 3); }
    neon(22, 60, 275); g.fillStyle = 'hsl(275,80%,58%)'; g.beginPath(); g.arc(W / 2, 96, 36, 0, 7); g.fill(); off();
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(W / 2 - 10, 108); g.lineTo(W / 2 - 4, 94); g.lineTo(W / 2 + 2, 104); g.lineTo(W / 2 + 12, 82); g.stroke();
    g.strokeStyle = C(70, 0.7, 80, 275); g.lineWidth = 2; g.beginPath(); g.moveTo(20, 150); [[70, 140], [120, 146], [170, 128], [220, 134], [270, 112], [300, 104]].forEach(([x, y]) => g.lineTo(x, y)); g.stroke();
  },

  lettergrid(g, W, H, C, neon, off) {
    const rows = ['TARE', 'SOLP', 'HNEK', 'CUDY'], k = 38, ox = 84, oy = 14, path = [[0, 0], [1, 1], [2, 1], [2, 2]];
    g.font = '800 20px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      const on = path.some(([pr, pc]) => pr === r && pc === c);
      if (on) neon(12, 60); else off();
      g.fillStyle = on ? C(52, 0.95) : 'rgba(255,255,255,.13)'; rrect(g, ox + c * k + 2, oy + r * k + 2, k - 4, k - 4, 7); g.fill(); off();
      g.fillStyle = '#fff'; g.fillText(ch, ox + c * k + k / 2, oy + r * k + k / 2 + 1);
    }));
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
    path.forEach(([r, c], i) => g[i ? 'lineTo' : 'moveTo'](ox + c * k + k / 2, oy + r * k + k / 2)); g.stroke();
  },

  unscramble(g, W, H, C, neon, off) {
    const k = 40, top = 'ETSAL', ox = (W - 5 * k) / 2;
    g.font = '800 22px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [...top].forEach((ch, i) => {
      g.save(); g.translate(ox + i * k + k / 2, 52); g.rotate(((i * 37) % 11 - 5) * 0.035);
      g.fillStyle = 'rgba(255,255,255,.18)'; rrect(g, -k / 2 + 2, -22, k - 4, 44, 8); g.fill(); g.fillStyle = '#fff'; g.fillText(ch, 0, 1); g.restore();
    });
    [...'SLATE'].forEach((ch, i) => {
      const on = i < 3;
      if (on) neon(10, 60); else off();
      g.strokeStyle = on ? C(62, 0.9) : 'rgba(255,255,255,.3)'; g.lineWidth = 2; g.setLineDash(on ? [] : [5, 4]);
      rrect(g, ox + i * k + 2, 108, k - 4, 44, 8); g.stroke(); g.setLineDash([]); off();
      if (on) { g.fillStyle = C(80); g.fillText(ch, ox + i * k + k / 2, 131); }
    });
  },

  crossword(g, W, H, C, neon, off) {
    const rows = ['FINAL', 'R#O#I', 'ALBUM', 'M#L#I', 'EVENT'].map(r => r.replace(/#/g, '.')), k = 30, ox = 85, oy = 15;
    g.font = '800 15px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      const x = ox + c * k, y = oy + r * k;
      if (ch === '.') { g.fillStyle = '#15121f'; g.fillRect(x, y, k - 1, k - 1); return; }
      const hot = r === 2;
      if (hot) neon(8, 60); else off();
      g.fillStyle = hot ? C(80, 1, 70) : '#f6f3ea'; g.fillRect(x, y, k - 1, k - 1); off();
      g.fillStyle = '#1b1730'; g.fillText(ch, x + k / 2, y + k / 2 + 1);
    }));
  },

  sumgrid(g, W, H, C, neon, off) {
    const k = 42, ox = 76, oy = 6, n = 4, v = ['3', '', '1', '4', '', '2', '', '', '2', '', '', '1', '', '1', '3', ''];
    g.fillStyle = '#0d1020'; rrect(g, ox - 4, oy - 4, k * n + 8, k * n + 8, 6); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
    for (let i = 0; i <= n; i++) { g.lineWidth = i % 2 ? 0.6 : 2; g.beginPath(); g.moveTo(ox + i * k, oy); g.lineTo(ox + i * k, oy + n * k); g.moveTo(ox, oy + i * k); g.lineTo(ox + n * k, oy + i * k); g.stroke(); }
    neon(8, 60); g.strokeStyle = C(70, 0.95); g.lineWidth = 2; g.setLineDash([5, 4]);
    [[0, 0, 2, 1], [2, 0, 1, 2], [0, 2, 1, 2], [1, 2, 2, 1], [3, 1, 1, 2]].forEach(([c, r, w, hh]) => rrect(g, ox + c * k + 4, oy + r * k + 4, w * k - 8, hh * k - 8, 6) || g.stroke());
    g.setLineDash([]); off();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    v.forEach((t, i) => { if (!t) return; g.font = '800 20px Inter,system-ui,sans-serif'; g.fillStyle = C(85); g.fillText(t, ox + (i % n) * k + k / 2, oy + Math.floor(i / n) * k + k / 2 + 1); });
    g.font = '700 10px Inter,system-ui,sans-serif'; g.textAlign = 'left'; g.fillStyle = '#fff';
    [['5', 0, 0], ['6', 2, 0], ['7', 0, 2], ['3', 1, 2], ['4', 3, 1]].forEach(([t, c, r]) => g.fillText(t, ox + c * k + 8, oy + r * k + 12));
  },

  towerdefense(g, W, H, C, neon, off) {
    g.strokeStyle = '#6b5a3c'; g.lineWidth = 22; g.beginPath(); g.moveTo(0, 40); g.lineTo(230, 40); g.lineTo(230, 110); g.lineTo(60, 110); g.lineTo(60, 160); g.lineTo(W, 160); g.stroke();
    g.lineWidth = 1;
    [[110, 76, 200], [170, 76, 28], [120, 136, 185]].forEach(([x, y, hh]) => { neon(10, 60, hh); g.fillStyle = `hsl(${hh},80%,58%)`; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill(); });
    off(); [[40, 40, 130], [160, 40, 8], [230, 80, 130]].forEach(([x, y, hh]) => { g.fillStyle = `hsl(${hh},70%,52%)`; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); });
    g.strokeStyle = 'rgba(120,200,255,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(110, 76); g.lineTo(160, 42); g.stroke();
  },

  mancala(g, W, H, C, neon, off) {
    const bw = W - 36, bh = 88, bx = 18, by = (H - bh) / 2, pw = (bw - 52) / 6;
    g.fillStyle = 'hsl(24,48%,24%)'; rrect(g, bx, by, bw, bh, 22); g.fill();
    g.fillStyle = 'rgba(15,8,3,.7)'; rrect(g, bx + 6, by + 10, 22, bh - 20, 11); g.fill(); rrect(g, bx + bw - 28, by + 10, 22, bh - 20, 11); g.fill();
    for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) {
      const x = bx + 34 + pw * (c + 0.5), y = by + 24 + r * 40;
      g.fillStyle = 'rgba(15,8,3,.7)'; g.beginPath(); g.arc(x, y, 15, 0, 7); g.fill();
      for (let i = 0; i < (c + r) % 4 + 1; i++) { neon(6, 62, [18, 42, 160, 200][i % 4]); g.fillStyle = `hsl(${[18, 42, 160, 200][i % 4]},80%,60%)`; g.beginPath(); g.arc(x + Math.cos(i * 2.4) * 6, y + Math.sin(i * 2.4) * 6, 4, 0, 7); g.fill(); }
    }
    off();
    neon(10, 60); g.strokeStyle = C(70, 0.7); g.lineWidth = 2; rrect(g, 6, 8, W - 12, H - 16, 8); g.stroke(); off();
  },
  crazy8(g, W, H, C, neon, off) {
    const card = (x, y, a, label, red) => {
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#fbfaf6'; rrect(g, -24, -34, 48, 68, 6); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = red ? '#c8102e' : '#15151c'; g.font = '800 26px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, 2); g.restore();
    };
    card(W / 2 - 52, H / 2 + 6, -0.3, '5', true); card(W / 2 - 18, H / 2 - 2, -0.1, 'K', false); card(W / 2 + 18, H / 2 - 2, 0.1, 'J', true);
    neon(16, 60); card(W / 2 + 52, H / 2 + 6, 0.3, '8', false); off();
    neon(10, 60); g.strokeStyle = C(70, 0.7); g.lineWidth = 2; rrect(g, 6, 8, W - 12, H - 16, 8); g.stroke(); off();
  },
  blackjack(g, W, H, C, neon, off) {
    const card = (x, y, a, label, red) => {
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#fbfaf6'; rrect(g, -26, -37, 52, 74, 6); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = red ? '#c8102e' : '#15151c'; g.font = '800 30px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, 2); g.restore();
    };
    card(W / 2 - 22, H / 2, -0.12, 'A', false); neon(16, 60); card(W / 2 + 22, H / 2 - 2, 0.1, 'K', true); off();
    g.fillStyle = C(62); g.font = '800 22px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('21', W - 38, 30);
    neon(10, 60); g.strokeStyle = C(70, 0.7); g.lineWidth = 2; rrect(g, 6, 8, W - 12, H - 16, 8); g.stroke(); off();
  },
  sketch(g, W, H, C, neon, off) {
    g.fillStyle = 'rgba(255,255,255,.07)'; rrect(g, 40, 22, W - 80, H - 60, 10); g.fill();
    neon(12, 60); g.strokeStyle = C(68); g.lineWidth = 5;
    g.beginPath(); g.moveTo(66, H - 62); g.bezierCurveTo(96, 30, 120, 120, 150, 62); g.bezierCurveTo(170, 36, 190, 90, W - 70, 44); g.stroke(); off();
    g.fillStyle = C(70); g.beginPath(); g.arc(W - 70, 44, 5, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 14px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('_ _ _ _ _', W / 2, H - 22);
    neon(10, 60); g.strokeStyle = C(70, 0.7); g.lineWidth = 2; rrect(g, 6, 8, W - 12, H - 16, 8); g.stroke(); off();
  },
  default(g, W, H, C, neon, off) {
    floorGrid(g, W, H, C, 110);
    neon(30, 55);
    g.fillStyle = C(58);
    g.beginPath(); g.arc(W / 2, 80, 26, 0, Math.PI * 2); g.fill();
    off();
  },
};
